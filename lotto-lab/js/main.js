// ============================================================================
// MAIN — điều phối toàn bộ pipeline & dựng giao diện.
//   Data (API) → Features → Backtest → Champion (Module 11) → Monte Carlo
//   → Dashboard (Module 10) → Ranking (Module 09) → Nhật ký AI.
// ============================================================================
import {
  buildFeatures, backtest, scoreSet, describeStats,
  STRATEGIES, DEFAULT_WEIGHTS, rng, generateCandidate,
  prizeFor, PRIZES, specialFor,
  buildWheel, diversifiedTickets, suggestPool, simulateTickets, poolHitProb,
  evPerTicket, breakEvenJackpot,
} from './engine.js';

const PRODUCTS = {
  power655: { file: 'power655.jsonl', mainCount: 6, mainMax: 55, special: true,  specialMax: 55, label: 'Power 6/55' },
  power645: { file: 'power645.jsonl', mainCount: 6, mainMax: 45, special: false, specialMax: 0,  label: 'Mega 6/45' },
  power535: { file: 'power535.jsonl', mainCount: 5, mainMax: 35, special: true,  specialMax: 12, label: 'Lotto 5/35' },
};

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = (n, d = 0) => Number(n).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });

const state = {
  product: localStorage.getItem('lotto-lab:product') || 'power535', // mặc định game tỉ lệ trúng cao nhất
  weights: { ...DEFAULT_WEIGHTS },
  data: null, feat: null, bt: null, champion: null,
  log: [],
};

function logAI(msg, kind = 'info') {
  const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.log.unshift({ time, msg, kind });
  renderLog();
}

// ---- Tải dữ liệu: ưu tiên API serverless, dự phòng đọc thẳng CDN (CORS ok) --
async function loadData(product) {
  const cfg = PRODUCTS[product];
  try {
    const r = await fetch(`/api/data?product=${product}&_t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j.draws && j.draws.length) return j; }
    throw new Error('api-empty');
  } catch (_) {
    logAI('API nội bộ không sẵn sàng → dùng nguồn CDN dự phòng.', 'warn');
    const url = `https://cdn.jsdelivr.net/gh/vietvudanh/vietlott-data@master/data/${cfg.file}`;
    const text = await (await fetch(url)).text();
    const draws = [];
    for (const line of text.split('\n')) {
      const s = line.trim(); if (!s) continue;
      let r; try { r = JSON.parse(s); } catch { continue; }
      const res = (r.result || []).map(Number);
      const main = res.slice(0, cfg.mainCount);
      if (main.length !== cfg.mainCount || main.some((n) => n < 1 || n > cfg.mainMax) || new Set(main).size !== main.length) continue;
      draws.push({ id: String(r.id), date: r.date, main: main.sort((a, b) => a - b), special: cfg.special ? (res[cfg.mainCount] ?? null) : null });
    }
    draws.sort((a, b) => (a.date < b.date ? -1 : 1));
    return {
      product, label: cfg.label,
      config: { mainCount: cfg.mainCount, mainMax: cfg.mainMax, special: cfg.special, specialMax: cfg.specialMax },
      meta: { total: draws.length, firstDate: draws[0].date, lastDate: draws[draws.length - 1].date, latestId: draws[draws.length - 1].id, source: 'fallback-cdn', quality: { missing: 0, duplicate: 0, wrongNumber: 0, invalidDate: 0 }, collectedAt: new Date().toISOString() },
      draws,
    };
  }
}

// ---------------------------------------------------------------------------
// preloaded: dữ liệu đã tải sẵn (từ vòng poll) để không phải tải lại.
async function run(preloaded = null) {
  const product = state.product;
  const cfg = PRODUCTS[product];
  setBusy(true);
  $('#pill-product').textContent = cfg.label;

  let data = preloaded;
  if (!data) {
    logAI(`Thu thập & kiểm định lịch sử ${cfg.label}…`);
    data = await loadData(product);
  }
  state.data = data;
  logAI(`Đã nạp ${fmt(data.meta.total)} kỳ (${data.meta.firstDate} → ${data.meta.lastDate}), nguồn: ${data.meta.source}.`, 'ok');

  // TỰ DÒ SỐ: nếu phiếu dự đoán cũ đã có kết quả kỳ mục tiêu → chấm ngay.
  evaluatePending(data);
  renderHitReport(data);

  const feat = buildFeatures(data.draws, data.config, { pairs: true, recentWindow: 60 });
  state.feat = feat;

  // Module 08 — Backtest rolling-window
  logAI('Chạy backtest cuốn chiếu (không rò rỉ dữ liệu tương lai)…');
  const bt = backtest(data.draws, data.config, { lookback: 250, minHistory: 120, weights: state.weights });
  state.bt = bt;

  // Module 11 — chọn/giữ nhà vô địch minh bạch (deploy nếu tốt hơn, giữ nếu không)
  chooseChampion(product, bt);

  // Render các phần tĩnh
  renderLatest(data, feat);
  renderStats(feat);
  renderNumbers(feat);
  renderPairs(feat);
  renderBacktest(bt);
  renderDataQuality(data);
  renderTrends(feat);

  // Module 06 — Monte Carlo (worker) → Module 09/10 top picks (lưu phiếu mới)
  await runMonteCarlo();

  renderHitReport(data); // cập nhật trạng thái "đang chờ kỳ tiếp theo" sau khi lưu phiếu
  renderResultsTable();  // bảng kết quả & giải ở cuối app (kể cả khi chưa có kỳ nào)
  renderExpertDiversify(); renderExpertWheel(); // Module 12 — dàn vé & bao số mặc định
  renderEVTiming(); // Module 13 — thời điểm vàng (EV theo jackpot)
  updateLive();
  setBusy(false);
  logAI('Hoàn tất phân tích. Mọi con số chỉ mang tính tham khảo thống kê.', 'ok');
}

function chooseChampion(product, bt) {
  const key = `lotto-lab:${product}:champion`;
  const prev = JSON.parse(localStorage.getItem(key) || 'null');
  const best = bt.rows[0]; // đã sort theo avgMatches
  // "Deploy" nếu tốt hơn nhà vô địch cũ, ngược lại "rollback" (giữ nguyên).
  let champion = best.strategy;
  if (prev && prev.avg != null && best.avgMatches <= prev.avg + 1e-9) {
    champion = prev.strategy;
    logAI(`Nhà vô địch mới (${labelOf(best.strategy)}, ${best.avgMatches.toFixed(3)} trùng/kỳ) KHÔNG vượt bản cũ (${labelOf(prev.strategy)}, ${prev.avg.toFixed(3)}) → GIỮ bản cũ (rollback).`, 'warn');
  } else {
    logAI(`Cập nhật nhà vô địch → ${labelOf(best.strategy)} (${best.avgMatches.toFixed(3)} trùng/kỳ). Deploy.`, 'ok');
    localStorage.setItem(key, JSON.stringify({ strategy: best.strategy, avg: best.avgMatches, date: state.data.meta.lastDate }));
  }
  state.champion = champion;

  // Trung thực: đánh giá ý nghĩa thống kê so với ngẫu nhiên.
  const diff = best.avgMatches - bt.expectedRandom;
  const note = diff > 0.15
    ? 'nhỉnh hơn ngẫu nhiên trên tập quá khứ, nhưng khác biệt vẫn trong biên độ nhiễu và KHÔNG đảm bảo lặp lại.'
    : 'gần như trùng mức ngẫu nhiên — đúng như kỳ vọng của một xổ số công bằng.';
  logAI(`Baseline ngẫu nhiên ≈ ${bt.expectedRandom.toFixed(3)} trùng/kỳ. Chiến lược tốt nhất ${note}`, 'info');
}

const labelOf = (k) => (STRATEGIES.find((s) => s.key === k) || { label: k }).label;

// ---- Monte Carlo qua worker (fallback: chạy đồng bộ nếu worker lỗi) --------
let worker = null;
function runMonteCarlo() {
  return new Promise((resolve) => {
    const n = Number($('#mc-size').value);
    const strategy = state.champion || 'balanced';
    $('#mc-status').textContent = `Đang mô phỏng ${fmt(n)} bộ số theo chiến lược ${labelOf(strategy)}…`;
    logAI(`Monte Carlo: ${fmt(n)} mô phỏng, chiến lược ${labelOf(strategy)}.`);
    const options = { n, strategy, weights: state.weights, topK: 12, seed: 20260713 };
    const done = (res) => { renderMonteCarlo(res, strategy); renderDashboardPicks(res); resolve(); };

    try {
      if (!worker) worker = new Worker(new URL('./mc-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        if (e.data.ok) { logAI(`Monte Carlo xong sau ${e.data.res.ms}ms, điểm TB ${e.data.res.avgScore.toFixed(1)}.`, 'ok'); done(e.data.res); }
        else { logAI('Worker lỗi → chạy đồng bộ.', 'warn'); done(syncMC(n, strategy)); }
      };
      worker.postMessage({ draws: state.data.draws, cfg: state.data.config, options });
    } catch (_) {
      done(syncMC(n, strategy));
    }
  });
}
function syncMC(n, strategy) {
  // fallback nhỏ hơn để không treo UI
  const capped = Math.min(n, 40000);
  const feat = state.feat;
  const r = rng(20260713); const top = []; let minTop = -1; const hist = new Array(20).fill(0); let sum = 0;
  for (let i = 0; i < capped; i++) {
    const set = generateCandidate(strategy, feat, r); const sc = scoreSet(set, feat, state.weights);
    sum += sc.total; hist[Math.min(19, Math.floor(sc.total / 5))]++;
    if (top.length < 12) { top.push({ set, score: sc.total, reasons: sc.reasons, parts: sc.parts, feat: sc.features }); if (top.length === 12) { top.sort((a, b) => a.score - b.score); minTop = top[0].score; } }
    else if (sc.total > minTop && !top.some((t) => t.set.join('-') === set.join('-'))) { top[0] = { set, score: sc.total, reasons: sc.reasons, parts: sc.parts, feat: sc.features }; top.sort((a, b) => a.score - b.score); minTop = top[0].score; }
  }
  top.sort((a, b) => b.score - a.score);
  return { top, scanned: capped, avgScore: sum / capped, hist, ms: 0 };
}

// ============================ RENDER =========================================
function balls(nums, special, cls = '', matched = null) {
  const wrap = el('div', 'balls ' + cls);
  for (const n of nums) {
    const hit = matched && matched.has(n);
    wrap.appendChild(el('span', 'ball' + (hit ? ' hit' : ''), String(n).padStart(2, '0')));
  }
  if (special != null) { const sep = el('span', 'ball-sep', '|'); wrap.appendChild(sep); wrap.appendChild(el('span', 'ball ball-special', String(special).padStart(2, '0'))); }
  return wrap;
}

function renderLatest(data, feat) {
  const d = data.draws[data.draws.length - 1];
  const box = $('#latest'); box.innerHTML = '';
  box.appendChild(el('div', 'muted', `Kỳ mới nhất #${d.id} · ${d.date}`));
  box.appendChild(balls(d.main, d.special, 'big'));
  const s = d.main.reduce((a, b) => a + b, 0);
  const odd = d.main.filter((n) => n % 2 === 1).length;
  box.appendChild(el('div', 'muted small', `Tổng ${s} · ${odd} lẻ/${feat.K - odd} chẵn · ${d.main.filter((n) => n <= feat.half).length} thấp/${feat.K - d.main.filter((n) => n <= feat.half).length} cao`));
}

function renderStats(feat) {
  const box = $('#stats'); box.innerHTML = '';
  for (const s of describeStats(feat)) {
    const c = el('div', 'stat');
    c.appendChild(el('div', 'stat-val', String(s.value)));
    c.appendChild(el('div', 'stat-label', s.label));
    c.appendChild(el('div', 'stat-hint', s.hint));
    box.appendChild(c);
  }
}

function renderNumbers(feat) {
  // Heatmap tần suất
  const heat = $('#heatmap'); heat.innerHTML = '';
  const maxF = Math.max(...feat.nums.map((x) => x.freq));
  for (const x of feat.nums) {
    const t = x.freq / maxF;
    const cell = el('div', 'cell', `<b>${String(x.n).padStart(2, '0')}</b><i>${x.freq}</i>`);
    cell.style.background = `rgba(230,72,60,${0.08 + t * 0.85})`;
    cell.style.color = t > 0.55 ? '#fff' : '#111';
    cell.title = `Số ${x.n}: ra ${x.freq} lần · lần cuối cách ${x.lastSeen} kỳ · gap TB ${x.avgGap.toFixed(1)}`;
    heat.appendChild(cell);
  }
  fillRank('#hot', feat.hot.slice(0, 8), (x) => `${x.recentFreq} lần/60 kỳ`);
  fillRank('#cold', feat.cold.slice(0, 8), (x) => `${x.recentFreq} lần/60 kỳ`);
  fillRank('#overdue', feat.overdue.slice(0, 8), (x) => `cách ${x.lastSeen} kỳ`);
}
function fillRank(sel, list, sub) {
  const box = $(sel); box.innerHTML = '';
  for (const x of list) {
    const row = el('div', 'rank-row');
    row.appendChild(el('span', 'ball small', String(x.n).padStart(2, '0')));
    row.appendChild(el('span', 'rank-sub', sub(x)));
    box.appendChild(row);
  }
}

function renderPairs(feat) {
  const box = $('#pairs'); box.innerHTML = '';
  for (const p of feat.topPairs.slice(0, 6)) {
    const row = el('div', 'pair-row');
    row.appendChild(balls([p.a, p.b], null));
    row.appendChild(el('span', 'rank-sub', `đi cùng ${p.count} kỳ`));
    box.appendChild(row);
  }
}

function renderTrends(feat) {
  const box = $('#trends'); box.innerHTML = '';
  const items = [
    `🔥 Nóng nhất: <b>${feat.hot.slice(0, 3).map((x) => x.n).join(', ')}</b>`,
    `❄️ Nguội nhất: <b>${feat.cold.slice(0, 3).map((x) => x.n).join(', ')}</b>`,
    `⏳ Lâu chưa ra nhất: <b>${feat.overdue.slice(0, 3).map((x) => `${x.n} (${x.lastSeen} kỳ)`).join(', ')}</b>`,
    `➕ Vùng tổng phổ biến: <b>${Math.round(feat.sumMean - feat.sumStd)}–${Math.round(feat.sumMean + feat.sumStd)}</b>`,
  ];
  for (const t of items) box.appendChild(el('div', 'trend', t));
}

function renderBacktest(bt) {
  const box = $('#backtest'); box.innerHTML = '';
  const head = el('div', 'muted small', `Kiểm thử ${bt.tests} kỳ gần nhất · baseline ngẫu nhiên ≈ ${bt.expectedRandom.toFixed(3)} số trùng/kỳ`);
  box.appendChild(head);
  const tbl = el('table', 'bt-table');
  tbl.innerHTML = `<thead><tr><th>Chiến lược</th><th>Trùng TB/kỳ</th><th>vs ngẫu nhiên</th><th>Tốt nhất</th><th>% kỳ ≥3</th></tr></thead>`;
  const tb = el('tbody');
  for (const r of bt.rows) {
    const diff = r.avgMatches - bt.expectedRandom;
    const tr = el('tr', r.strategy === state.champion ? 'champ' : '');
    tr.innerHTML = `<td>${labelOf(r.strategy)}${r.strategy === state.champion ? ' 👑' : ''}</td>
      <td><b>${r.avgMatches.toFixed(3)}</b></td>
      <td class="${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '+' : ''}${diff.toFixed(3)}</td>
      <td>${r.best} số</td><td>${r.pctGE.toFixed(1)}%</td>`;
    tb.appendChild(tr);
  }
  tbl.appendChild(tb); box.appendChild(tbl);
  box.appendChild(el('div', 'note small', '⚠️ Khác biệt giữa các chiến lược trên dữ liệu quá khứ nằm trong biên độ nhiễu thống kê. Không có bằng chứng nào cho thấy một chiến lược sẽ trúng nhiều hơn ở tương lai.'));
}

function renderMonteCarlo(res, strategy) {
  $('#mc-status').textContent = `Đã quét ${fmt(res.scanned)} bộ số · điểm TB ${res.avgScore.toFixed(1)}/100 · ${res.ms || 0}ms`;
  const box = $('#mc-top'); box.innerHTML = '';
  res.top.slice(0, 6).forEach((t, i) => box.appendChild(pickCard(t, i)));
}

function renderDashboardPicks(res) {
  const box = $('#ai-picks'); box.innerHTML = '';
  // Ghi RÕ 2 bộ số gợi ý này là cho KỲ NÀO (kỳ kế tiếp = mã mới nhất + 1) → tránh nhầm.
  const kyEl = $('#picks-ky');
  if (kyEl && state.data) kyEl.textContent = 'cho kỳ #' + String(Number(state.data.meta.latestId) + 1).padStart(5, '0');
  res.top.slice(0, 2).forEach((t, i) => box.appendChild(pickCard(t, i, true)));
  // Lưu "phiếu dự đoán" nhắm tới KỲ TIẾP THEO để tự dò khi có kết quả.
  savePending(res.top.slice(0, 2).map((t) => t.set));
}

function pickCard(t, i, big = false) {
  const card = el('div', 'pick' + (big ? ' pick-big' : ''));
  const head = el('div', 'pick-head');
  head.appendChild(el('span', 'pick-rank', `#${i + 1}`));
  head.appendChild(el('span', 'pick-score', `${t.score.toFixed(1)}<small>/100</small>`));
  card.appendChild(head);
  card.appendChild(balls(t.set, specialFor(t.set, state.product), big ? 'big' : ''));
  card.appendChild(el('div', 'pick-reasons', t.reasons.map((r) => `<span class="tag">${r}</span>`).join('')));
  card.appendChild(el('div', 'muted small', `Tổng ${t.feat.sum} · ${t.feat.odd} lẻ/${t.feat.even} chẵn · ${t.feat.low} thấp/${t.feat.high} cao · ${t.feat.decades} nhóm chục`));
  return card;
}

function renderDataQuality(data) {
  const q = data.meta.quality; const box = $('#quality'); box.innerHTML = '';
  const items = [
    ['Tổng kỳ hợp lệ', fmt(data.meta.total), 'ok'],
    ['Thiếu kỳ (gap mã kỳ)', q.missing, q.missing ? 'warn' : 'ok'],
    ['Trùng kỳ', q.duplicate, q.duplicate ? 'warn' : 'ok'],
    ['Sai số/định dạng', q.wrongNumber, q.wrongNumber ? 'warn' : 'ok'],
    ['Ngày lỗi', q.invalidDate, q.invalidDate ? 'warn' : 'ok'],
    ['Nguồn', data.meta.source, 'ok'],
  ];
  for (const [k, v, s] of items) {
    const c = el('div', 'q-item ' + s);
    c.appendChild(el('div', 'q-val', String(v)));
    c.appendChild(el('div', 'q-label', k));
    box.appendChild(c);
  }
}

// ===========================================================================
// MODULE 12 — CHƠI KIỂU CHUYÊN GIA (dàn vé tối ưu & bao số). Mọi con số hiển thị
// là mô phỏng/kiểm chứng trung thực, KHÔNG phải dự đoán số trúng.
// ===========================================================================
const newSeed = () => (Math.floor(Math.random() * 2 ** 31)) >>> 0;

function renderExpertDiversify() {
  if (!state.feat || !state.data) return;
  const cfg = state.data.config;
  const B = Number($('#ex-budget').value);
  const seed = newSeed();
  const universe = Array.from({ length: cfg.mainMax }, (_, i) => i + 1);
  const tickets = diversifiedTickets(universe, cfg.mainCount, B, rng(seed));
  const sim = simulateTickets(tickets, cfg, { trials: 16000, seed: seed ^ 0x1234 });
  const out = $('#ex-div-out'); out.innerHTML = '';
  const rel = sim.pAnyPrizeRandom > 0 ? (sim.pAnyPrize / sim.pAnyPrizeRandom - 1) * 100 : 0;
  const stat = el('div', 'expert-stat');
  stat.innerHTML = `Chi phí <b>${fmt(B)}</b> vé × 10.000đ = <b>${fmt(B * 10000)}đ</b> · P(trúng ≥1 giải) ≈ <b class="pos">${(sim.pAnyPrize * 100).toFixed(1)}%</b> <span class="muted small">(mua ngẫu nhiên ${(sim.pAnyPrizeRandom * 100).toFixed(1)}% → nhỉnh hơn ${rel >= 0 ? '+' : ''}${rel.toFixed(0)}% nhờ ít trùng)</span>`;
  out.appendChild(stat);
  const grid = el('div', 'ticket-grid');
  tickets.forEach((tk, i) => { const c = el('div', 'ticket'); c.appendChild(el('span', 'ticket-no', `#${i + 1}`)); c.appendChild(balls(tk, null, 'mini')); grid.appendChild(c); });
  out.appendChild(grid);
}

function renderExpertWheel() {
  if (!state.feat || !state.data) return;
  const cfg = state.data.config, feat = state.feat;
  const P = Number($('#ex-pool').value);
  const unpop = $('#ex-unpop').checked;
  const pool = suggestPool(feat, P, rng(newSeed()), { unpopular: unpop });
  const t = 3, m = 4;
  const wheel = buildWheel(pool, cfg.mainCount, t, m);
  const out = $('#ex-wheel-out'); out.innerHTML = '';
  if (!wheel.count) { out.appendChild(el('div', 'muted small', 'Nhóm quá nhỏ để bao số — tăng số lượng.')); return; }
  const B = wheel.count;
  const hit = poolHitProb(cfg.mainMax, cfg.mainCount, P, m) * 100;
  const head = el('div', 'expert-stat');
  head.innerHTML = `Nhóm <b>${P}</b> số → <b>${B}</b> vé (<b>${fmt(B * 10000)}đ</b>) · <span class="prize-tag${wheel.verified ? '' : ' none'}">ĐẢM BẢO ${wheel.verified ? '✔' : '✗'}</span>`;
  out.appendChild(head);
  const guar = el('div', 'expert-stat guarantee');
  guar.innerHTML = `Nếu <b>${m}/${cfg.mainCount}</b> số trúng rơi vào nhóm ⇒ <b class="pos">chắc chắn</b> có vé trúng ≥ <b>${t}</b> số. <span class="muted small">Xác suất nhóm dính ≥${m} số ≈ ${hit.toFixed(2)}% (phần may rủi) — khi đó bao số gom nhiều vé trúng cùng lúc.</span>`;
  out.appendChild(guar);
  out.appendChild(el('div', 'muted small', 'Nhóm số đã chọn:'));
  out.appendChild(balls(pool, null, 'mini'));
  const grid = el('div', 'ticket-grid');
  wheel.tickets.forEach((tk, i) => { const c = el('div', 'ticket'); c.appendChild(el('span', 'ticket-no', `#${i + 1}`)); c.appendChild(balls(tk, null, 'mini')); grid.appendChild(c); });
  out.appendChild(grid);
}

// --- Module 13: Thời điểm vàng (EV theo jackpot) ---------------------------
const evKey = () => `lotto-lab:${state.product}:jackpot`;
function defaultJackpot(product) {
  if (product === 'power655') return { j1: 38e9, j2: 3.2e9 };
  if (product === 'power645') return { j: 30e9 };
  return { j: 8e9 };
}
function loadJackpot() {
  let saved = null; try { saved = JSON.parse(localStorage.getItem(evKey()) || 'null'); } catch (_) { /* ignore */ }
  return { ...defaultJackpot(state.product), ...(saved || {}) };
}
function renderEVTiming() {
  if (!state.data) return;
  const product = state.product;
  const jk = loadJackpot();
  const out = $('#ev-out'); const ctl = $('#ev-controls'); if (!out || !ctl) return;
  const tyStr = (v) => (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' tỷ';
  const paint = () => {
    const { rtp } = evPerTicket(product, jk);
    const be = breakEvenJackpot(product);
    let verdict, cls;
    if (rtp >= 1) { verdict = '🟢 THỜI ĐIỂM VÀNG — nên dồn vé (kèm số ít người chọn + bao số)'; cls = 'good'; }
    else if (rtp >= 0.65) { verdict = '🟡 Khá — cân nhắc; càng gần hòa vốn càng đáng chơi'; cls = 'mid'; }
    else { verdict = '🔴 Nghèo — toán học nói nên BỎ QUA kỳ này'; cls = 'bad'; }
    const note = product === 'power535'
      ? ' — Lotto 5/35 jackpot quá nhỏ để chạm mốc này; thế mạnh của nó là TỈ LỆ TRÚNG. Muốn săn EV, chuyển sang Power/Mega.'
      : ` — dồn vé khi jackpot ≥ ${tyStr(be)}, kỳ thường nên bỏ qua.`;
    out.innerHTML = `<div class="ev-verdict ${cls}">${verdict}</div>
      <div class="ev-stat">EV hiện tại ≈ <b>${(rtp * 100).toFixed(1)}%</b> giá vé · điểm hòa vốn (EV=100%): jackpot ≈ <b>${be > 0 ? tyStr(be) : '—'}</b>${note}</div>`;
  };
  ctl.innerHTML = '';
  const mkInput = (label, key) => {
    const wrap = el('label', 'ev-inp'); wrap.appendChild(el('span', null, `${label} (tỷ đồng)`));
    const inp = el('input'); inp.type = 'number'; inp.min = '0'; inp.step = '0.5'; inp.value = String(jk[key] / 1e9);
    inp.oninput = () => { jk[key] = Math.max(0, Number(inp.value)) * 1e9; localStorage.setItem(evKey(), JSON.stringify(jk)); paint(); };
    wrap.appendChild(inp); ctl.appendChild(wrap);
  };
  if (product === 'power655') { mkInput('Jackpot 1 hiện tại', 'j1'); mkInput('Jackpot 2 hiện tại', 'j2'); }
  else mkInput('Jackpot/Độc đắc hiện tại', 'j');
  paint();
}

function renderLog() {
  const box = $('#ai-log'); if (!box) return; box.innerHTML = '';
  for (const l of state.log.slice(0, 40)) {
    const row = el('div', 'log-row ' + l.kind);
    row.appendChild(el('span', 'log-time', l.time));
    row.appendChild(el('span', 'log-msg', l.msg));
    box.appendChild(row);
  }
}

// ===========================================================================
// TỰ DÒ SỐ (Module 10) — phiếu dự đoán được lưu TRƯỚC kỳ quay, khi có kết quả
// thật của đúng kỳ đó thì tự đối chiếu & báo trúng. Kèm sổ theo dõi độ chính xác.
// ===========================================================================
const pKey = () => `lotto-lab:${state.product}:pending`;
const lKey = () => `lotto-lab:${state.product}:ledger`;

// Lưu phiếu dự đoán nhắm tới kỳ tiếp theo (mã kỳ = mã mới nhất + 1).
function savePending(picks) {
  const latestId = Number(state.data.meta.latestId);
  const pending = {
    targetId: latestId + 1,
    madeAfterId: latestId,
    madeDate: new Date().toISOString(),
    champion: state.champion,
    picks,
  };
  localStorage.setItem(pKey(), JSON.stringify(pending));
}

// Khi có dữ liệu mới: nếu kỳ mục tiêu đã có kết quả → dò số, ghi vào sổ.
function evaluatePending(data) {
  const pending = JSON.parse(localStorage.getItem(pKey()) || 'null');
  if (!pending) return;
  const target = data.draws.find((d) => Number(d.id) === pending.targetId);
  if (!target) return; // kỳ mục tiêu chưa quay

  const actual = new Set(target.main);
  // Chỉ Power 6/55 mới đánh giá được "trùng số đặc biệt" vì bộ số gồm 6 số cùng
  // dải 1–55; Lotto 5/35 có số đặc biệt ở dải 1–12 riêng nên không suy ra được.
  const evalPicks = pending.picks.map((set) => {
    const matched = set.filter((n) => actual.has(n));
    const hitSpecial = target.special != null && (
      (state.product === 'power655' && set.includes(target.special)) ||
      (state.product === 'power535' && specialFor(set, state.product) === target.special)
    );
    const prize = prizeFor(state.product, matched.length, hitSpecial);
    return { set, matched, hits: matched.length, hitSpecial, prize };
  });
  const best = Math.max(0, ...evalPicks.map((p) => p.hits));
  // Giải cao nhất trong các bộ (rank nhỏ = cao); null nếu không bộ nào trúng.
  const wins = evalPicks.map((p) => p.prize).filter(Boolean);
  const bestPrize = wins.length ? wins.reduce((a, b) => (b.rank < a.rank ? b : a)) : null;

  const ledger = JSON.parse(localStorage.getItem(lKey()) || '[]');
  if (!ledger.some((e) => e.targetId === pending.targetId)) {
    ledger.unshift({
      targetId: pending.targetId, id: target.id, date: target.date,
      actual: target.main, special: target.special,
      champion: pending.champion, picks: evalPicks, best, bestPrize,
    });
    localStorage.setItem(lKey(), JSON.stringify(ledger.slice(0, 60)));
    const prizeMsg = bestPrize ? ` — 🏆 TRÚNG ${bestPrize.label}!` : ' (chưa tới bậc giải)';
    logAI(`🎟️ Đã có kết quả kỳ #${target.id} — tự dò: bộ trúng cao nhất ${best}/${data.config.mainCount} số${prizeMsg}`, bestPrize ? 'ok' : 'info');
    // Báo trúng NGAY trên thiết bị nếu đã bật thông báo (khi app đang mở).
    if (bestPrize) {
      const jp = bestPrize.jackpot;
      deviceNotify(jp ? `🎊 KHÔNG THỂ TIN NỔI — ${bestPrize.label}!` : `🎉 Chúc mừng anh! Trúng ${bestPrize.label}`,
        `${PRODUCTS[state.product].label} kỳ #${target.id}: bộ gợi ý trúng ${best}/${data.config.mainCount} số (${bestPrize.amount}). 🎉`);
    } else {
      deviceNotify(`🎯 Đã có kết quả kỳ #${target.id}`, `${PRODUCTS[state.product].label}: bộ gợi ý cao nhất ${best}/${data.config.mainCount} số. Mai lại có kỳ mới 💪`);
    }
  }
  localStorage.removeItem(pKey()); // phiếu đã được chấm
}

function renderHitReport(data) {
  const cfg = data.config;
  const ledger = JSON.parse(localStorage.getItem(lKey()) || '[]');
  const pending = JSON.parse(localStorage.getItem(pKey()) || 'null');
  const box = $('#hitreport'); box.innerHTML = '';

  // Trạng thái phiếu đang chờ
  const status = $('#compare'); status.innerHTML = '';
  if (pending) {
    status.appendChild(el('div', 'small', `🎟️ Đang chờ kết quả kỳ <b>#${String(pending.targetId).padStart(5, '0')}</b> để tự dò bộ số đã gợi ý (chốt lúc ${new Date(pending.madeDate).toLocaleString('vi-VN')}).`));
  } else {
    status.appendChild(el('div', 'muted small', 'Bộ số Top 2 phía trên sẽ được lưu làm phiếu dự đoán cho kỳ kế tiếp và tự dò khi có kết quả.'));
  }

  if (!ledger.length) {
    box.appendChild(el('div', 'muted small', 'Chưa có phiếu nào được chấm. Sau kỳ quay tới, app sẽ tự đối chiếu và báo trúng ngay tại đây.'));
    return;
  }

  // Kỳ vừa chấm gần nhất — hiển thị nổi bật
  const last = ledger[0];
  const card = el('div', 'hit-latest');
  card.appendChild(el('div', 'muted small', `Kết quả kỳ #${last.id} · ${last.date}`));
  card.appendChild(balls(last.actual, last.special, 'big'));

  // Banner giải trúng cao nhất của kỳ này
  const bp = last.bestPrize;
  const banner = el('div', 'prize-banner ' + (bp ? (bp.jackpot ? 'jackpot' : 'win') : 'none'));
  banner.innerHTML = bp
    ? `🏆 Kỳ này bộ gợi ý đạt: <b>${bp.label}</b> <span class="muted small">(${bp.amount})</span>`
    : '➖ Kỳ này chưa bộ nào đạt bậc giải. Đã ghi vào sổ theo dõi.';
  card.appendChild(banner);

  const actualSet = new Set(last.actual);
  last.picks.forEach((p, i) => {
    const row = el('div', 'hit-pick');
    const head = el('div', 'hit-pick-head');
    head.appendChild(el('span', 'muted small', `Bộ #${i + 1} đã gợi ý`));
    const tag = p.prize ? `<span class="prize-tag${p.prize.jackpot ? ' jp' : ''}">${p.prize.label}</span>` : '';
    head.appendChild(el('span', 'hit-count' + (p.hits >= 3 ? ' good' : ''), `trúng ${p.hits}/${cfg.mainCount} ${tag}`));
    row.appendChild(head);
    row.appendChild(balls(p.set, specialFor(p.set, state.product), '', actualSet)); // tô sáng số trúng (+ số ĐB cho 5/35)
    card.appendChild(row);
  });
  box.appendChild(card);

  // Sổ theo dõi độ chính xác — trung thực so với baseline ngẫu nhiên
  const evaluated = ledger.length;
  const avgBest = ledger.reduce((a, e) => a + e.best, 0) / evaluated;
  const expRandom = (cfg.mainCount * cfg.mainCount) / cfg.mainMax;
  const summary = el('div', 'hit-summary');
  summary.innerHTML = `📒 <b>Sổ theo dõi:</b> đã dò <b>${evaluated}</b> kỳ · bộ tốt nhất trúng TB <b>${avgBest.toFixed(2)}</b> số/kỳ · mốc ngẫu nhiên ≈ ${expRandom.toFixed(2)} số/kỳ.`;
  box.appendChild(summary);

  // Lịch sử ngắn
  const hist = el('div', 'hit-hist');
  for (const e of ledger.slice(0, 8)) {
    const chip = el('span', 'hit-chip' + (e.best >= 3 ? ' good' : ''), `#${e.id}: ${e.best}★`);
    chip.title = `Kỳ #${e.id} (${e.date}) — trúng cao nhất ${e.best} số`;
    hist.appendChild(chip);
  }
  box.appendChild(hist);
  box.appendChild(el('div', 'note small', '⚠️ Đây là đối chiếu trung thực, không phải bằng chứng "trúng được". Về dài hạn con số này sẽ dao động quanh mốc ngẫu nhiên — đúng bản chất xổ số công bằng.'));
}

// Bảng kết quả ở CUỐI app: từng kỳ đã dò kèm cột "Trúng giải mấy".
function renderResultsTable() {
  const box = $('#results-table'); if (!box) return; box.innerHTML = '';
  const ledger = JSON.parse(localStorage.getItem(lKey()) || '[]');
  const info = PRIZES[state.product];
  if (!ledger.length) {
    box.appendChild(el('div', 'muted small', `Chưa có kỳ nào được dò cho ${info.name}. Sau mỗi kỳ quay, một dòng kết quả kèm bậc giải sẽ tự xuất hiện ở đây.`));
    return;
  }
  let jackpots = 0, wins = 0;
  const tbl = el('table', 'res-table');
  tbl.innerHTML = `<thead><tr><th>Kỳ</th><th>Ngày</th><th>Kết quả</th><th>Bộ trúng cao nhất</th><th>Trúng giải</th></tr></thead>`;
  const tb = el('tbody');
  for (const e of ledger) {
    const bp = e.bestPrize;
    if (bp) { wins++; if (bp.jackpot) jackpots++; }
    const resStr = e.actual.map((n) => String(n).padStart(2, '0')).join(' ') + (e.special != null ? ` | ${String(e.special).padStart(2, '0')}` : '');
    const prizeCell = bp
      ? `<span class="prize-tag${bp.jackpot ? ' jp' : ''}">${bp.label}</span> <span class="muted small">${bp.amount}</span>`
      : '<span class="muted small">—</span>';
    const tr = el('tr', bp ? (bp.jackpot ? 'row-jp' : 'row-win') : '');
    tr.innerHTML = `<td>#${e.id}</td><td>${e.date}</td><td class="mono">${resStr}</td><td><b>${e.best}/${PRODUCTS[state.product].mainCount}</b> số</td><td>${prizeCell}</td>`;
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  const summary = el('div', 'small', `Đã dò <b>${ledger.length}</b> kỳ · trúng bậc giải <b>${wins}</b> kỳ${jackpots ? ` · trong đó <b>${jackpots}</b> jackpot/độc đắc` : ''}. ${info.special ? `(Ghi chú: bậc cao nhất của ${info.name} còn cần trùng ${info.special} — công cụ chỉ gợi ý dãy số chính.)` : ''}`);
  box.appendChild(summary);
  const wrap = el('div', 'res-wrap'); wrap.appendChild(tbl); box.appendChild(wrap);
}

// ---- Thông báo trên thiết bị (khi app đang mở) ------------------------------
const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%230f1220'/%3E%3Ctext y='.9em' x='8' font-size='72'%3E%F0%9F%8E%AF%3C/text%3E%3C/svg%3E";
function deviceNotify(title, body) {
  try {
    if (('Notification' in window) && Notification.permission === 'granted') {
      new Notification(title, { body, icon: ICON, tag: 'lotto-win' });
    }
  } catch (_) { /* bỏ qua */ }
}
function refreshNotifBtn() {
  const nb = $('#notif'); if (!nb) return;
  if (!('Notification' in window)) { nb.style.display = 'none'; return; }
  const pushed = localStorage.getItem('lotto-lab:push') === '1' && Notification.permission === 'granted';
  const g = Notification.permission === 'granted';
  nb.textContent = pushed ? '🔔 Đã bật (điện thoại)' : (g ? '🔔 Đã bật báo trúng' : '🔔 Bật báo trúng');
  nb.classList.toggle('on', g);
}

const urlB64ToUint8 = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
};

// Đăng ký Web Push: server sẽ đẩy thông báo về điện thoại kể cả khi app đóng.
async function enableWebPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const meta = await (await fetch('/api/subscribe')).json();
  if (!meta.publicKey) { logAI('Máy chủ chưa có khoá đẩy (VAPID). Chỉ bật thông báo tại chỗ.', 'warn'); return false; }
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(meta.publicKey) });
  const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) });
  if (r.ok) { localStorage.setItem('lotto-lab:push', '1'); return true; }
  return false;
}

async function toggleNotif() {
  if (!('Notification' in window)) return;
  const p = await Notification.requestPermission();
  if (p !== 'granted') { logAI('Anh chưa cho phép thông báo — bật lại trong cài đặt trình duyệt nếu cần.', 'warn'); refreshNotifBtn(); return; }
  logAI('Đã cho phép thông báo. Đang đăng ký đẩy về điện thoại…', 'ok');
  let pushOk = false;
  try { pushOk = await enableWebPush(); } catch (e) { logAI('Không đăng ký được Web Push: ' + (e.message || e), 'warn'); }
  refreshNotifBtn();
  if (pushOk) {
    logAI('✅ Đã bật báo trúng về điện thoại (Web Push). Trúng là điện thoại tự kêu, kể cả khi đóng app.', 'ok');
    deviceNotify('✅ Đã bật báo trúng!', 'Khi bộ số gợi ý trúng giải, điện thoại sẽ tự thông báo — kể cả khi app đóng.');
  } else {
    logAI('Đã bật thông báo tại chỗ (khi app mở). Web Push chưa sẵn sàng trên thiết bị này.', 'warn');
    deviceNotify('✅ Đã bật báo trúng', 'Khi bộ số gợi ý trúng giải, anh sẽ nhận thông báo. Email dò số cũng tự gửi về Gmail.');
  }
}

// ---- Tự cập nhật liên tục ---------------------------------------------------
let pollTimer = null;
const POLL_MS = 90 * 1000; // 90s — kiểm kết quả Vietlott mới thường xuyên hơn

function updateLive(checked = false) {
  const live = $('#live'); if (!live) return;
  const t = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  live.innerHTML = `<span class="dot"></span> Tự cập nhật · kiểm ${t}`;
}

async function poll() {
  if (document.body.classList.contains('busy')) return;
  try {
    const r = await fetch(`/api/data?product=${state.product}&_t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    updateLive(true);
    if (j.draws && j.draws.length && j.meta.latestId !== state.data.meta.latestId) {
      logAI(`🔔 Phát hiện kỳ mới #${j.meta.latestId} — tự nạp & dò số.`, 'ok');
      run(j); // chạy lại toàn bộ pipeline với dữ liệu mới → tự dò phiếu cũ
    }
  } catch (_) { /* im lặng, thử lại lần sau */ }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
  // Khi người dùng quay lại tab, kiểm tra ngay.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}

// ---- UI plumbing -----------------------------------------------------------
function setBusy(b) { document.body.classList.toggle('busy', b); $('#refresh').disabled = b; }

function buildWeightControls() {
  const box = $('#weights'); box.innerHTML = '';
  const labels = { sum: 'Tổng cân đối', oddEven: 'Chẵn/lẻ', lowHigh: 'Thấp/cao', overdue: 'Lâu chưa ra', pair: 'Cặp mạnh', spread: 'Trải đều', unpopular: 'Ít bị chọn trùng (EV)' };
  for (const k of Object.keys(DEFAULT_WEIGHTS)) {
    const row = el('label', 'w-row');
    row.innerHTML = `<span>${labels[k]}</span>`;
    const inp = el('input'); inp.type = 'range'; inp.min = '0'; inp.max = '2'; inp.step = '0.1'; inp.value = String(state.weights[k]);
    const out = el('span', 'w-val', state.weights[k].toFixed(1));
    inp.oninput = () => { state.weights[k] = Number(inp.value); out.textContent = Number(inp.value).toFixed(1); };
    row.appendChild(inp); row.appendChild(out); box.appendChild(row);
  }
}

function init() {
  // product selector
  const sel = $('#product');
  for (const k of Object.keys(PRODUCTS)) { const o = el('option'); o.value = k; o.textContent = PRODUCTS[k].label; if (k === state.product) o.selected = true; sel.appendChild(o); }
  sel.onchange = () => { state.product = sel.value; localStorage.setItem('lotto-lab:product', sel.value); run(); };
  $('#refresh').onclick = () => run();
  $('#notif').onclick = toggleNotif;
  refreshNotifBtn();
  $('#mc-rerun').onclick = () => runMonteCarlo();
  $('#mc-size').oninput = () => { $('#mc-size-val').textContent = fmt(Number($('#mc-size').value)); };
  $('#mc-size-val').textContent = fmt(Number($('#mc-size').value));
  buildWeightControls();
  $('#apply-weights').onclick = () => { logAI('Áp dụng bộ trọng số mới → chạy lại Monte Carlo.'); runMonteCarlo(); };
  // Module 12 — chơi kiểu chuyên gia
  $('#ex-budget').oninput = () => { $('#ex-budget-val').textContent = $('#ex-budget').value; };
  $('#ex-pool').oninput = () => { $('#ex-pool-val').textContent = $('#ex-pool').value; };
  $('#ex-diversify').onclick = renderExpertDiversify;
  $('#ex-wheel').onclick = renderExpertWheel;
  $('#ex-unpop').onchange = renderExpertWheel;
  run().then(startPolling); // sau lần chạy đầu, bật tự cập nhật liên tục
}
document.addEventListener('DOMContentLoaded', init);
