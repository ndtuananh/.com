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
import { fetchXSMN } from '../js/minhngoc.js';
import {
  loadHistory as loadXsmnHistory, saveHistory as saveXsmnHistory, mergeHistory as mergeXsmnHistory,
  addDays as xsmnAddDays, loadLedger, saveLedger,
} from '../js/xsmn-store.js';
import { brainAnalyze, brainPredict, armStatsFor, randomHitProb, BRAIN_MAX_DAYS } from '../js/xsmn-brain.js';
import { addCommit, gradeCommits, ledgerSummary } from '../js/xsmn-ledger.js';
import { committableFrom } from '../js/xsmn-sync.js';
import { pushToSupabase } from '../js/xsmn-supabase.js';

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
// allowOverwrite bắt buộc với @vercel/blob v2 khi ghi đè đường dẫn cố định. Thiếu nó,
// danh sách "đã báo" không lưu được ⇒ cron hôm sau tưởng chưa báo và gửi email trùng.
async function saveNotified(token, set) {
  if (!token) return;
  try {
    await put(NOTIFIED_KEY, JSON.stringify([...set].slice(-800)), {
      access: 'public', token, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
    });
  } catch (e) { console.error('[notify] không lưu được danh sách đã báo:', e && e.message); }
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

// Báo cáo XSMN hằng ngày. Bốn phần, theo đúng thứ tự người đọc cần:
//   1. ĐỐI CHIẾU cam kết hôm trước với kết quả vừa về — phần quan trọng nhất, vì đó là
//      thứ duy nhất chứng minh được máy đúng hay sai (số đã khoá trong kho trước khi quay).
//   2. Kết quả hôm nay.
//   3. Số cho kỳ tới: CẢ dàn ĐỀ lẫn dàn LÔ cho từng đài.
//   4. Sổ cộng dồn + sự thật về kỳ vọng.
// Ba đường, cùng thứ tự với trang web. Email và web phải nói y hệt nhau — đọc hai nơi
// ra hai kiểu trình bày là tự tạo nghi ngờ về số liệu.
const MAILTRACKS = [
  { key: 'dau', label: 'ĐẦU', sub: 'giải 8' },
  { key: 'de', label: 'ĐUÔI', sub: 'giải ĐB' },
  { key: 'lo', label: 'LÔ', sub: '18 giải' },
];

async function buildXsmnReport() {
  const fresh = await fetchXSMN();
  if (!fresh.length) return { ok: false };
  const { token, days: stored } = await loadXsmnHistory();
  let merged = stored;
  if (stored.length || token) { const m = mergeXsmnHistory(stored, fresh); merged = m.merged; if (token) await saveXsmnHistory(token, merged); }
  const history = merged.length ? merged : fresh;
  const today = fresh[0];
  const nowISO = new Date().toISOString();

  // Sổ cam kết dùng CHUNG kho với /api/xsmn: chấm trước, ghi sau.
  let ledger = token ? await loadLedger(token) : { v: 4, commits: [] };
  ledger = gradeCommits(ledger, history, nowISO).ledger;
  const brain = brainAnalyze(history.slice(0, BRAIN_MAX_DAYS));

  // Cùng luật với /api/xsmn: chỉ dự báo kỳ CHƯA QUAY. Email chạy lúc 22h30 giờ VN, tức
  // là sau giờ quay của hôm nay — nếu lấy "ngày sau ngày mới nhất trong kho" mà kho chậm
  // thì email sẽ khoe một dự báo cho kỳ đã có kết quả.
  const safeFrom = committableFrom();
  const afterStore = xsmnAddDays(history[0].date, 1);
  let prediction = brainPredict(brain, afterStore > safeFrom ? afterStore : safeFrom);
  ledger = addCommit(ledger, prediction, nowISO, safeFrom).ledger;

  // SỐ TRONG EMAIL PHẢI LÀ SỐ ĐÃ KHOÁ TRÊN WEB.
  // /api/xsmn chạy trước và đã khoá bộ số cho kỳ này. Não học thêm cả ngày nên nếu email
  // in bản mới nhất, anh sẽ nhận hai bộ số khác nhau cho cùng một kỳ — và bộ đem đi chấm
  // điểm là bộ trên web, không phải bộ trong email.
  const locked = ledger.commits.find((x) => x.forDate === prediction.forDate);
  if (locked) {
    const bySlug = new Map(locked.items.map((it) => [it.slug, it]));
    prediction = {
      ...prediction, lockedAt: locked.madeAt,
      provinces: prediction.provinces.map((p) => {
        const it = bySlug.get(p.slug);
        if (!it) return p;
        const put = (tk, picks, arm, armName) => {
          if (!picks || !picks.length) return p[tk];
          const s = armStatsFor(brain, tk, arm, p.slug);
          return { ...p[tk], ...(s || {}), picks, arm, armName: (s && s.armName) || armName };
        };
        return {
          ...p,
          dau: put('dau', it.dau, it.dauArm, it.dauArmName),
          de: put('de', it.de, it.deArm, it.deArmName),
          lo: put('lo', it.lo, it.loArm, it.loArmName),
        };
      }),
    };
  }
  if (token) await saveLedger(token, ledger);
  const sum = ledgerSummary(ledger, randomHitProb);

  // Kho thứ hai — im lặng bỏ qua nếu chưa đặt biến môi trường Supabase.
  await pushToSupabase({ days: history, ledger, byProvince: sum.byProvince, snapshotDate: today.date });

  const CARD = 'border:1px solid #e3e3e8;border-radius:10px;padding:10px 12px;margin:8px 0';
  const CHIP = 'display:inline-block;padding:3px 8px;margin:2px 3px 2px 0;border-radius:6px;border:1px solid #ddd;background:#fafafa;font-family:Consolas,monospace;font-weight:700';
  const HIT = 'display:inline-block;padding:3px 8px;margin:2px 3px 2px 0;border-radius:6px;border:1px solid #1f9e5a;background:#e6f9ee;color:#0d7a42;font-family:Consolas,monospace;font-weight:700';

  let html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:18px auto 0;color:#1a1a1a;border-top:2px solid #e6483c;padding-top:12px">
    <h2 style="color:#e6483c">🎲 Xổ số Miền Nam — báo cáo ngày ${today.date}</h2>`;

  // ---- 1 · ĐỐI CHIẾU ----
  const last = ledger.commits.filter((c) => c.graded && c.graded.rows.length)
    .sort((a, b) => (a.forDate < b.forDate ? 1 : -1))[0];
  if (last) {
    const g = last.graded;
    html += `<div style="${CARD};border-color:#5b8cff;background:#f5f8ff">
      <b>📌 Đối chiếu số máy đã khoá cho ngày ${last.forDate}</b>
      <div style="font-size:12px;color:#666;margin:2px 0 8px">Khoá lúc ${new Date(last.madeAt).toLocaleString('vi-VN')} — trước khi kỳ này quay, không sửa lại được.</div>`;
    for (const r of g.rows) {
      html += `<div style="border-top:1px solid #e8e8ee;padding:7px 0"><b>${r.province}</b>`;
      for (const m of MAILTRACKS) {
        const picks = r[m.key] || [];
        if (!picks.length) continue;
        const match = r[m.key + 'Match'] || [];
        const hit = r[m.key + 'Hit'];
        const actual = m.key === 'dau' ? r.actualDau : m.key === 'de' ? r.actualDe : null;
        html += `<div style="font-size:13px;margin-top:4px">${m.label} ${picks.map((n) => `<span style="${match.includes(n) ? HIT : CHIP}">${n}</span>`).join('')}` +
          (actual != null ? `<span style="color:#666">→ kết quả <b style="color:#e6483c">${actual}</b></span>` : '') +
          `<b style="color:${hit ? '#0d7a42' : '#999'}">${hit ? (m.key === 'lo' && match.length > 1 ? ` ✓ về ${match.length} số` : ' ✓ TRÚNG') : ' ✗ trượt'}</b></div>`;
      }
      html += `</div>`;
    }
    html += `<div style="font-size:13px;margin-top:8px;font-weight:700">Ngày này: ĐẦU ${g.dauHits || 0}/${g.dauTotal || 0} · ĐUÔI ${g.deHits}/${g.total} · LÔ ${g.loHits}/${g.total} đài</div></div>`;
  } else {
    html += `<div style="${CARD};background:#f5f8ff;border-color:#5b8cff">📌 <b>Sổ đối chiếu vừa mở.</b> Máy đã khoá số cho kỳ tới vào kho. Từ ngày mai, mục này hiện đúng số máy đã đoán đặt cạnh kết quả thật.</div>`;
  }

  // ---- 2 · KẾT QUẢ HÔM NAY ----
  for (const p of today.provinces) {
    html += `<div style="${CARD}">
      <b>${p.province}</b> <span style="color:#888;font-size:12px">${p.code}</span> — ĐỀ: <b style="color:#e6483c;font-size:16px">${p.de}</b>
      <div style="font-size:12px;color:#555;margin-top:4px">Lô: ${p.lo2.join(' ')}</div></div>`;
  }

  // ---- 3 · SỐ CHO KỲ TỚI: ĐỀ + LÔ ----
  if (prediction.provinces.length) {
    html += `<div style="${CARD};border-color:#e6a23c;background:#fffaf0">
      <b>🎯 Số cho kỳ ngày ${prediction.forDate}</b>
      <div style="font-size:12px;color:#666;margin:2px 0 6px">Gợi ý nghiên cứu, KHÔNG cam kết trúng.
      ${prediction.lockedAt
        ? `Đây đúng là bộ số đã khoá trên web lúc ${new Date(prediction.lockedAt).toLocaleString('vi-VN')} — email và web luôn cùng một bộ.`
        : 'Số vừa được ghi vào kho, đóng dấu thời gian để mai đối chiếu.'}</div>`;
    // Tỉ lệ đi kèm ưu tiên SỔ CAM KẾT của chính đài đó (bằng chứng thật, đã khoá trước
    // khi quay). Chưa đủ kỳ thì mới rơi về số walk-forward, và phải nói rõ là đang lấy
    // từ đâu — hai nguồn này khác hẳn nhau về sức nặng.
    const score = new Map((sum.byProvince || []).map((x) => [x.slug, x]));
    const rate = (q, tk) => {
      const t = score.get(q.slug);
      if (t && t.n >= 8) {
        const s = t[tk];
        return `sổ đã chấm ${s.hits}/${t.n} kỳ = <b>${(s.rate * 100).toFixed(1)}%</b> · bốc mù ${(s.expRate * 100).toFixed(1)}%`;
      }
      const w = q[tk];
      if (w.provN >= 12 && w.provRate != null) {
        return `máy tự chấm lại ${w.provHits}/${w.provN} kỳ = <b>${(w.provRate * 100).toFixed(1)}%</b> · bốc mù ${(w.provExp * 100).toFixed(1)}% <i>(chưa phải số đã cam kết trước)</i>`;
      }
      if (w.armN) return `toàn miền <b>${(w.armRate * 100).toFixed(1)}%</b> · bốc mù ${(w.armExp * 100).toFixed(1)}% <i>(đài này chưa đủ kỳ)</i>`;
      return 'chưa đủ kỳ để đo';
    };
    const BIG = 'display:inline-block;padding:6px 14px;margin-right:6px;border-radius:8px;border:1px solid #e0a91f;background:#fff8e6;color:#7a5200;font-family:Consolas,monospace;font-weight:800;font-size:20px;letter-spacing:1px';
    for (const q of prediction.provinces) {
      html += `<div style="border-top:1px solid #f0e4cc;padding:9px 0"><b>${q.province}</b>`;
      for (const m of MAILTRACKS) {
        const w = q[m.key];
        if (!w || !w.picks || !w.picks.length) continue;
        html += `<div style="margin-top:6px">
          <span style="font-size:11px;font-weight:800;color:#888;letter-spacing:.05em">${m.label}</span>
          <span style="font-size:10px;color:#aaa"> ${m.sub}</span><br>
          ${w.picks.map((n) => `<span style="${BIG}">${n}</span>`).join('')}
          <span style="font-size:11px;color:#888">${rate(q, m.key)}</span></div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  // ---- 4 · SỔ CỘNG DỒN + SỰ THẬT ----
  if (sum.total) {
    const f = (s) => `${s.hits}/${s.total} = <b>${(s.rate * 100).toFixed(1)}%</b> · bốc mù ${(s.expRate * 100).toFixed(1)}% (z=${s.z.toFixed(2)})`;
    html += `<div style="${CARD};background:#f4f4f6">
      📒 <b>Sổ cam kết trước — cộng dồn ${sum.total} lượt đài / ${sum.days} ngày:</b>
      ${MAILTRACKS.filter((m) => sum[m.key] && sum[m.key].total)
        .map((m) => `<div style="font-size:13px;margin-top:3px">${m.label} (${sum[m.key].k} số/đài): ${f(sum[m.key])}</div>`).join('')}
      ${sum.total < 90 ? '<div style="font-size:11px;color:#a06000;margin-top:5px">⚠️ Mẫu còn nhỏ — chênh vài điểm hoàn toàn có thể là may rủi, chưa kết luận được gì.</div>' : ''}</div>`;
  }
  html += `<div style="${CARD};background:#fafafa">
    🧠 <b>Bộ não (walk-forward trên ${brain.gradedDraws} lượt đài):</b>
    ${MAILTRACKS.map((m) => {
      const b = brain[m.key];
      if (!b || !b.bandit) return '';
      return `<div style="font-size:12px;color:#555;margin-top:4px">${m.label} (${b.show} số/đài) — máy tự chọn nhánh đạt ${(b.bandit.showRate * 100).toFixed(2)}% so với bốc mù ${(b.bandit.showExp * 100).toFixed(2)}%. ${b.evidence ? 'CÓ tín hiệu nhỏ.' : 'Chưa có bằng chứng vượt ngẫu nhiên.'}</div>`;
    }).join('')}</div>`;
  html += `<p style="font-size:12px;color:#666">💸 <b>Sự thật cho tiền của anh:</b> mọi nhánh trong máy — nóng, nguội, gan, bóng, lộn, tổng — đều đang cho kết quả sát mức bốc số mù. Cộng phần nhà cái ăn, đặt tiền đường dài <b>chắc chắn lỗ</b> dù chọn số kiểu gì. App này để nghiên cứu và giải trí, KHÔNG phải công cụ kiếm tiền.</p>`;
  html += `<p style="font-size:11px;color:#999;border-top:1px solid #eee;padding-top:8px">⚠️ Nguồn: minhngoc.net.vn. Xổ số ngẫu nhiên độc lập — không dự đoán, không cam kết thu nhập. Chơi có trách nhiệm, đủ 18+.</p></div>`;
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
