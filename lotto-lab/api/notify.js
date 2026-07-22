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

    // Cho phép ?test=1 để gửi email + push thử ngay cả khi hôm nay chưa có kỳ.
    if (results.length === 0 && q.test) {
      const email = await sendEmail('🎯 Lotto Lab — email thử hoạt động ✅',
        `<p>Kênh thông báo qua email đã hoạt động. Khi có kết quả, anh sẽ nhận email dò số tự động tại đây (${todayICT()}).</p>`);
      const push = await sendPush('🎯 Lotto Lab — thử thông báo ✅', 'Nếu anh thấy thông báo này thì Web Push đã hoạt động. Khi trúng, điện thoại sẽ tự báo.');
      res.status(200).json({ ok: true, mode: 'test', email, push });
      return;
    }

    if (results.length === 0) {
      res.status(200).json({ ok: true, drawsToday: 0, emailed: false });
      return;
    }

    // Chống trùng: chỉ báo những kỳ CHƯA từng báo (an toàn khi cron/ping chạy nhiều lần).
    const { set: notified, token: blobToken } = await loadNotified();
    const freshOnly = results.filter((r) => !notified.has(`${r.product}-${r.target.id}`));
    if (freshOnly.length === 0) {
      res.status(200).json({ ok: true, drawsToday: results.length, emailed: false, reason: 'các kỳ này đã báo trước đó' });
      return;
    }
    results = freshOnly;

    const best = results.map((r) => r.bestPrize).filter(Boolean).sort((a, b) => a.rank - b.rank)[0];
    const meaningful = best && best.label !== 'Giải KK';
    const anyWin = !!best;
    // Thông báo VUI VẺ, ấm áp — nhưng đúng mức: reo hò cho giải thật, nhẹ nhàng cho KK.
    const subject = best && best.jackpot
      ? `🎊🎉 KHÔNG THỂ TIN NỔI — bộ gợi ý chạm ${best.label}! 🎉🎊`
      : meaningful
        ? `🎉 Chúc mừng anh! Bộ gợi ý hôm nay TRÚNG ${best.label} 🎉`
        : best
          ? `😊 Lotto Lab — hôm nay có tin vui nho nhỏ (${best.label})`
          : `🎯 Lotto Lab — kết quả & dò số hôm nay (${results.length} kỳ)`;
    const email = await sendEmail(subject, renderEmail(results));

    const pushTitle = best && best.jackpot ? `🎊 Chạm ${best.label}! Không thể tin nổi!`
      : meaningful ? `🎉 Chúc mừng anh! Trúng ${best.label}`
      : best ? `😊 Có tin vui nho nhỏ hôm nay (${best.label})`
      : '🎯 Đã có kết quả — đã dò số';
    const pushBody = results.map((r) => `${r.label} #${r.target.id}: ${r.bestPrize ? r.bestPrize.label : Math.max(0, ...r.evalPicks.map((p) => p.hits)) + '/' + r.cfg.mainCount + ' số'}`).join(' · ');
    const push = await sendPush(pushTitle, pushBody);

    // Ghi nhận đã báo để lần chạy sau không lặp lại.
    for (const r of results) notified.add(`${r.product}-${r.target.id}`);
    await saveNotified(blobToken, notified);

    res.status(200).json({ ok: true, drawsToday: results.length, anyWin, email, push,
      summary: results.map((r) => ({ product: r.product, id: r.target.id, prize: r.bestPrize ? r.bestPrize.label : null })) });
  } catch (e) {
    res.status(500).json({ error: 'notify failed', detail: String(e.message || e) });
  }
}
