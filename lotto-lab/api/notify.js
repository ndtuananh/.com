// ============================================================================
// api/notify.js — TỰ BÁO TRÚNG VỀ ĐIỆN THOẠI (qua email → Gmail đẩy notification)
//
// Cron chạy 1 lần/ngày sau các giờ quay. Với mỗi sản phẩm có kỳ quay HÔM NAY:
//   1. Dựng lại đúng bộ số app gợi ý TRƯỚC kỳ đó (deterministic, cùng seed).
//   2. Đối chiếu với kết quả thật của kỳ đó → tính bậc giải (prizeFor).
//   3. Gửi email tổng hợp về Gmail của chủ app (báo trúng giải mấy).
//
// Không cần CSDL: bộ số được tái tạo bằng thuật toán tất định nên server tự biết
// app đã gợi ý gì mà không phải lưu trạng thái. Chạy 1 lần/ngày ⇒ không trùng lặp.
// ============================================================================
import nodemailer from 'nodemailer';
import webpush from 'web-push';
import { list, put } from '@vercel/blob';
import {
  buildFeatures, backtest, monteCarlo, prizeFor, PRIZES, DEFAULT_WEIGHTS, specialFor,
} from '../js/engine.js';
import { mergeFreshDraws } from '../js/vietlott.js';
import { fetchXSMN, xsmnStats, xsmnBacktest, XSMN_SCHEDULE } from '../js/minhngoc.js';
import { loadHistory as loadXsmnHistory, saveHistory as saveXsmnHistory, mergeHistory as mergeXsmnHistory } from '../js/xsmn-store.js';

const PRODUCTS = {
  power655: { file: 'power655.jsonl', mainCount: 6, mainMax: 55, special: true,  specialMax: 55, label: 'Power 6/55' },
  power645: { file: 'power645.jsonl', mainCount: 6, mainMax: 45, special: false, specialMax: 0,  label: 'Mega 6/45' },
  power535: { file: 'power535.jsonl', mainCount: 5, mainMax: 35, special: true,  specialMax: 12, label: 'Lotto 5/35' },
};
const SOURCES = [
  (f) => `https://raw.githubusercontent.com/vietvudanh/vietlott-data/master/data/${f}`,
  (f) => `https://cdn.jsdelivr.net/gh/vietvudanh/vietlott-data@master/data/${f}`,
];

async function loadDraws(cfg) {
  let text = '';
  for (const src of SOURCES) {
    try {
      const r = await fetch(src(cfg.file), { headers: { 'User-Agent': 'lotto-lab/1.0' } });
      if (r.ok) { text = await r.text(); if (text.length > 50) break; }
    } catch { /* thử nguồn kế */ }
  }
  const draws = [];
  for (const line of text.split('\n')) {
    const s = line.trim(); if (!s) continue;
    let r; try { r = JSON.parse(s); } catch { continue; }
    const res = (r.result || []).map(Number);
    const main = res.slice(0, cfg.mainCount);
    if (main.length !== cfg.mainCount || main.some((n) => n < 1 || n > cfg.mainMax) || new Set(main).size !== main.length) continue;
    draws.push({ id: String(r.id), date: r.date, main: main.slice().sort((a, b) => a - b), special: cfg.special ? (res[cfg.mainCount] ?? null) : null });
  }
  draws.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.id) - Number(b.id)));
  return draws;
}

const ictDate = (offsetDays = 0) =>
  new Date(Date.now() + 7 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10);
const todayICT = () => ictDate(0);
// Nguồn dữ liệu công bố kết quả buổi tối trễ vài giờ (khoảng 00:00 UTC), nên cron
// chạy sáng hôm sau (giờ ICT) và xét các kỳ có ngày = HÔM NAY hoặc HÔM QUA.
const recentDates = () => new Set([ictDate(0), ictDate(-1)]);

// Dựng lại bộ số app từng gợi ý dựa trên LỊCH SỬ TRƯỚC kỳ mục tiêu (khớp client).
function reconstructPicks(history, cfg, product) {
  const feat = buildFeatures(history, cfg, { pairs: true, recentWindow: 60 });
  const bt = backtest(history, cfg, { lookback: 250, minHistory: 120, weights: DEFAULT_WEIGHTS });
  const champion = bt.rows[0].strategy;
  const mc = monteCarlo(feat, { n: 200000, strategy: champion, weights: DEFAULT_WEIGHTS, topK: 12, seed: 20260713 });
  return { picks: mc.top.slice(0, 2).map((t) => t.set), champion, expectedRandom: bt.expectedRandom };
}

// Đánh giá 1 sản phẩm cho các kỳ quay HÔM NAY. Trả về mảng kết quả (rỗng nếu không có).
async function evalProductToday(product) {
  const cfg = PRODUCTS[product];
  const draws = await loadDraws(cfg);
  await mergeFreshDraws(product, cfg, draws); // kết quả TƯƠI từ vietlott.vn → báo ngay trong đêm
  if (draws.length < 130) return [];
  const dates = recentDates();
  const out = [];
  // Có thể có >1 kỳ/ngày (vd Lotto 5/35) → xét mọi kỳ có ngày hôm nay/hôm qua.
  for (let i = 0; i < draws.length; i++) {
    if (!dates.has(draws[i].date)) continue;
    const target = draws[i];
    const history = draws.slice(0, i); // chỉ dữ liệu trước kỳ này
    if (history.length < 130) continue;
    const { picks, champion } = reconstructPicks(history, cfg, product);
    const actual = new Set(target.main);
    const evalPicks = picks.map((set) => {
      const matched = set.filter((n) => actual.has(n));
      const hitSpecial = target.special != null && (
        (product === 'power655' && set.includes(target.special)) ||
        (product === 'power535' && specialFor(set, product) === target.special)
      );
      return { set, matched, hits: matched.length, prize: prizeFor(product, matched.length, hitSpecial) };
    });
    const wins = evalPicks.map((p) => p.prize).filter(Boolean);
    const bestPrize = wins.length ? wins.reduce((a, b) => (b.rank < a.rank ? b : a)) : null;
    out.push({ product, label: cfg.label, cfg, target, champion, evalPicks, bestPrize });
  }
  return out;
}

function fmtBalls(nums, special) {
  const s = nums.map((n) => String(n).padStart(2, '0')).join(' ');
  return special != null ? `${s} | <b>${String(special).padStart(2, '0')}</b>` : s;
}

function renderEmail(results) {
  const best = results.map((r) => r.bestPrize).filter(Boolean).sort((a, b) => a.rank - b.rank)[0];
  const meaningful = best && best.label !== 'Giải KK';
  let html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a">
    <h2 style="color:#e6483c">🎯 Lotto Lab — Kết quả & dò số hôm nay (${todayICT()})</h2>`;
  if (best && best.jackpot) html += `<p style="font-size:17px;background:#fff0c2;border:1px solid #e0a91f;padding:12px 16px;border-radius:10px;color:#7a5200">🎊 <b>Trời ơi anh ơi — bộ gợi ý chạm ${best.label}!</b> 🎉 Quá tự hào, xem chi tiết bên dưới nhé!</p>`;
  else if (meaningful) html += `<p style="font-size:16px;background:#e6f7ee;border:1px solid #37d67a;padding:11px 15px;border-radius:10px;color:#1f7a4d">🎉 <b>Chúc mừng anh! Bộ gợi ý hôm nay trúng ${best.label}.</b> Niềm vui nho nhỏ mỗi ngày 😊</p>`;
  else if (best) html += `<p style="font-size:14px;background:#fff7e0;border:1px solid #ffcc4d;padding:9px 13px;border-radius:10px;color:#7a5200">😊 <b>Có tin vui nho nhỏ!</b> Hôm nay chạm giải Khuyến khích (10.000đ — trùng số đặc biệt, chủ yếu may rủi). Vẫn vui phải không anh!</p>`;
  else html += `<p style="font-size:13px;color:#888;background:#f4f4f6;border:1px solid #e3e3e8;padding:8px 12px;border-radius:10px">Hôm nay chưa tới giải — nhưng mai lại có kỳ mới, cơ hội mới 💪 Cứ chơi vui và trong khả năng anh nhé.</p>`;

  for (const r of results) {
    const bp = r.bestPrize;
    html += `<div style="border:1px solid #e3e3e8;border-radius:12px;padding:14px;margin:14px 0">
      <div style="font-weight:700;font-size:15px">${r.label} — kỳ #${r.target.id}</div>
      <div style="font-size:15px;margin:6px 0">Kết quả: <b style="letter-spacing:1px">${fmtBalls(r.target.main, r.target.special)}</b></div>`;
    if (bp) {
      const jp = bp.jackpot;
      html += `<div style="margin:8px 0;padding:8px 12px;border-radius:8px;font-weight:700;${jp ? 'background:#fff0c2;color:#7a5200;border:1px solid #e0a91f' : 'background:#e6f7ee;color:#1f7a4d;border:1px solid #37d67a'}">🏆 Bộ gợi ý đạt: ${bp.label} <span style="font-weight:400;color:#666">(${bp.amount})</span></div>`;
    } else {
      html += `<div style="margin:8px 0;color:#888">➖ Kỳ này chưa bộ nào tới bậc giải.</div>`;
    }
    r.evalPicks.forEach((p, i) => {
      const tag = p.prize ? ` — <b style="color:${p.prize.jackpot ? '#b8860b' : '#1f7a4d'}">${p.prize.label}</b>` : '';
      const sp = specialFor(p.set, r.product);
      const spStr = sp != null ? ` <span style="color:#b8860b">| ĐB ${String(sp).padStart(2, '0')}</span>` : '';
      html += `<div style="font-size:14px;margin:3px 0">Bộ #${i + 1}: <code>${p.set.map((n) => String(n).padStart(2, '0')).join(' ')}</code>${spStr} — trúng ${p.hits}/${r.cfg.mainCount}${tag}</div>`;
    });
    html += `<div style="font-size:12px;color:#999;margin-top:6px">Chiến lược: ${r.champion}. Bộ số được tái tạo từ dữ liệu trước kỳ quay.</div></div>`;
  }
  html += `<p style="font-size:12px;color:#999;border-top:1px solid #eee;padding-top:10px">⚠️ Đối chiếu trung thực mang tính thống kê. Xổ số là ngẫu nhiên độc lập — công cụ không làm tăng xác suất trúng. Chơi có trách nhiệm.</p></div>`;
  return html;
}

// Sổ chống trùng (Vercel Blob): lưu các kỳ đã báo để cron/ping chạy nhiều lần không lặp.
const NOTIFIED_KEY = 'notified/log.json';
async function loadNotified() {
  const token = process.env.BLOB_READ_WRITE_TOKEN; if (!token) return { set: new Set(), token: null };
  try {
    const l = await list({ token, prefix: 'notified/' });
    const b = l.blobs.find((x) => x.pathname === NOTIFIED_KEY);
    if (!b) return { set: new Set(), token };
    const arr = await (await fetch(b.url)).json();
    return { set: new Set(Array.isArray(arr) ? arr : []), token };
  } catch (_) { return { set: new Set(), token }; }
}
async function saveNotified(token, set) {
  if (!token) return;
  try { await put(NOTIFIED_KEY, JSON.stringify([...set].slice(-800)), { access: 'public', token, addRandomSuffix: false, contentType: 'application/json' }); } catch (_) { /* bỏ qua */ }
}

// Gửi Web Push tới mọi thiết bị đã đăng ký (đọc từ Vercel Blob).
async function sendPush(title, body, url = '/') {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const pub = process.env.VAPID_PUBLIC, priv = process.env.VAPID_PRIVATE;
  if (!token || !pub || !priv) return { pushed: 0, reason: 'blob/vapid chưa cấu hình' };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@lotto-lab', pub, priv);
  const l = await list({ token, prefix: 'subs/' });
  const payload = JSON.stringify({ title, body, url, tag: 'lotto-win' });
  let pushed = 0, dead = 0;
  for (const b of l.blobs) {
    try {
      const rec = await (await fetch(b.url)).json();
      await webpush.sendNotification(rec.sub, payload);
      pushed++;
    } catch (e) {
      // 404/410 = subscription hết hạn → xoá
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        try { const { del } = await import('@vercel/blob'); await del(b.url, { token }); dead++; } catch { /* bỏ qua */ }
      }
    }
  }
  return { pushed, dead };
}

async function sendEmail(subject, html) {
  const user = process.env.GMAIL_USER || 'nguyendinhtuananh1992@gmail.com';
  const to = process.env.NOTIFY_EMAIL || user;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) return { sent: false, reason: 'GMAIL_APP_PASSWORD chưa cấu hình' };
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await transporter.sendMail({ from: user, to, subject, html });
  return { sent: true, to };
}

// Báo cáo XSMN TRUNG THỰC hằng ngày: kết quả hôm nay + sổ theo dõi (≈ ngẫu nhiên) +
// gợi ý NGHIÊN CỨU cho ngày mai (KHÔNG phải "số chắc trúng"). Không cam kết thu nhập.
async function buildXsmnReport() {
  const fresh = await fetchXSMN();
  if (!fresh.length) return { ok: false };
  const { token, days: stored } = await loadXsmnHistory();
  let merged = stored;
  if (stored.length || token) { const m = mergeXsmnHistory(stored, fresh); merged = m.merged; if (token) await saveXsmnHistory(token, merged); }
  const history = merged.length ? merged : fresh;
  const stats = xsmnStats(history);
  const bt = xsmnBacktest(history);
  const today = fresh[0];

  let html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:18px auto 0;color:#1a1a1a;border-top:2px solid #e6483c;padding-top:12px">
    <h2 style="color:#e6483c">🎲 Xổ số Miền Nam — báo cáo hôm nay (${today.date})</h2>`;
  for (const p of today.provinces) {
    html += `<div style="border:1px solid #e3e3e8;border-radius:10px;padding:10px 12px;margin:8px 0">
      <b>${p.province}</b> <span style="color:#888;font-size:12px">${p.code}</span> — ĐỀ: <b style="color:#e6483c;font-size:16px">${p.de}</b>
      <div style="font-size:12px;color:#555;margin-top:4px">Lô: ${p.lo2.join(' ')}</div></div>`;
  }
  const s = bt.suggestion;
  if (s && s.total) {
    const diff = (s.hitRate - s.randomRate) * 100;
    html += `<div style="background:#f4f4f6;border:1px solid #e3e3e8;border-radius:10px;padding:10px 12px;margin:10px 0">
      📒 <b>Sổ theo dõi gợi ý (backtest không rò rỉ):</b> đã về <b>${s.hits}/${s.total}</b> = <b>${(s.hitRate * 100).toFixed(1)}%</b> · mức ngẫu nhiên ≈ <b>${(s.randomRate * 100).toFixed(1)}%</b> (chênh ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} điểm — ${Math.abs(diff) < 3 ? '≈ ngẫu nhiên' : 'đáng xem'}).</div>`;
  }
  const tmrWd = new Date(Date.now() + 7 * 3600 * 1000 + 86400 * 1000).getUTCDay();
  const provStats = new Map((stats.provinces || []).map((p) => [p.slug || p.name, p]));
  const tmrProvs = XSMN_SCHEDULE[tmrWd] || [];
  if (tmrProvs.length) {
    html += `<div style="margin:10px 0"><b>🎯 Gợi ý nghiên cứu cho ngày mai (2 số/đài — KHÔNG cam kết):</b><div style="font-size:14px;margin-top:4px;line-height:1.8">`;
    for (const [slug, name] of tmrProvs) {
      const ps = provStats.get(slug);
      const top = (ps ? ps.loHot : stats.loHot).slice(0, 2).map((x) => x.n);
      html += `${name}: <code>${top.join(' · ')}</code>&nbsp;&nbsp; `;
    }
    html += `</div></div>`;
  }
  if (s && s.total) {
    html += `<p style="font-size:12px;color:#666">💸 <b>Sự thật cho tiền của anh:</b> gợi ý "về" ${(s.hitRate * 100).toFixed(1)}% — gần y hệt bốc số ngẫu nhiên ${(s.randomRate * 100).toFixed(1)}%. Chọn số "nóng" KHÔNG trúng nhiều hơn; đường dài đặt tiền chắc chắn lỗ. Đây là báo cáo nghiên cứu, KHÔNG phải số chắc trúng.</p>`;
  }
  html += `<p style="font-size:11px;color:#999;border-top:1px solid #eee;padding-top:8px">⚠️ Thống kê nghiên cứu trên dữ liệu quá khứ (nguồn: minhngoc.net.vn). Xổ số ngẫu nhiên độc lập — không dự đoán, không cam kết thu nhập. Chơi có trách nhiệm.</p></div>`;
  return { ok: true, html, dateKey: today.date };
}

export default async function handler(req, res) {
  // Bảo vệ endpoint: Vercel Cron gửi Authorization: Bearer <CRON_SECRET>; cho phép ?key= để test tay.
  const secret = process.env.CRON_SECRET;
  const q = (req.query || {});
  if (secret) {
    const ok = req.headers.authorization === `Bearer ${secret}` || q.key === secret;
    if (!ok) { res.status(401).json({ error: 'unauthorized' }); return; }
  }

  try {
    const products = q.product ? [String(q.product)] : Object.keys(PRODUCTS);
    let results = [];
    for (const p of products) {
      if (!PRODUCTS[p]) continue;
      const r = await evalProductToday(p);
      results = results.concat(r);
    }

    // Báo cáo XSMN trung thực (1 lần/ngày): kết quả + sổ theo dõi ≈ ngẫu nhiên.
    let xsmn = { ok: false };
    try { xsmn = await buildXsmnReport(); } catch (_) { /* nguồn lỗi → bỏ qua, vẫn gửi Vietlott */ }

    if (results.length === 0 && !xsmn.ok && q.test) {
      const email = await sendEmail('🎯 Lotto Lab — email thử hoạt động ✅',
        `<p>Kênh email đã hoạt động (${todayICT()}). Anh sẽ nhận báo cáo kết quả + đối chiếu tự động tại đây.</p>`);
      const push = await sendPush('🎯 Lotto Lab — thử thông báo ✅', 'Web Push hoạt động.');
      res.status(200).json({ ok: true, mode: 'test', email, push });
      return;
    }

    // Chống trùng: Vietlott theo kỳ, XSMN theo ngày.
    const { set: notified, token: blobToken } = await loadNotified();
    const freshViet = results.filter((r) => !notified.has(`${r.product}-${r.target.id}`));
    const xsmnKey = xsmn.ok ? `xsmn-${xsmn.dateKey}` : null;
    const xsmnNew = !!xsmnKey && !notified.has(xsmnKey);

    if (freshViet.length === 0 && !xsmnNew) {
      res.status(200).json({ ok: true, emailed: false, reason: 'không có kỳ/báo cáo mới' });
      return;
    }

    // Email GỘP, trung thực: Vietlott (nếu có kỳ mới) + báo cáo Miền Nam (1 lần/ngày).
    const best = freshViet.map((r) => r.bestPrize).filter(Boolean).sort((a, b) => a.rank - b.rank)[0];
    const meaningful = best && best.label !== 'Giải KK';
    let html = '';
    if (freshViet.length) html += renderEmail(freshViet);
    if (xsmnNew) html += xsmn.html;
    const subject = best && best.jackpot
      ? `🎊 Vietlott chạm ${best.label}! + báo cáo Miền Nam`
      : meaningful
        ? `🎉 Vietlott: ${best.label} + báo cáo Miền Nam hôm nay`
        : `🎯 Lotto Lab — kết quả & đối chiếu hôm nay (${todayICT()})`;
    const email = await sendEmail(subject, html);

    const pushTitle = best && best.jackpot ? `🎊 Vietlott chạm ${best.label}!`
      : meaningful ? `🎉 Vietlott trúng ${best.label}`
      : '🎯 Đã có kết quả — báo cáo hôm nay';
    const pushParts = [];
    if (freshViet.length) pushParts.push(...freshViet.map((r) => `${r.label} #${r.target.id}: ${r.bestPrize ? r.bestPrize.label : Math.max(0, ...r.evalPicks.map((p) => p.hits)) + '/' + r.cfg.mainCount}`));
    if (xsmnNew) pushParts.push('Miền Nam: kết quả + sổ theo dõi (≈ ngẫu nhiên)');
    const push = await sendPush(pushTitle, pushParts.join(' · '));

    // Ghi nhận đã báo để lần sau không lặp lại.
    for (const r of freshViet) notified.add(`${r.product}-${r.target.id}`);
    if (xsmnNew) notified.add(xsmnKey);
    await saveNotified(blobToken, notified);

    res.status(200).json({ ok: true, vietlott: freshViet.length, xsmnReported: xsmnNew, email, push });
  } catch (e) {
    res.status(500).json({ error: 'notify failed', detail: String(e.message || e) });
  }
}
