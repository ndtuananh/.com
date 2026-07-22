// ============================================================================
// js/xsmn-app.js — Giao diện Xổ số Miền Nam (tách riêng khỏi Vietlott).
// Chỉ THỐNG KÊ MÔ TẢ + xếp hạng nghiên cứu. Không dự đoán, không cam kết.
// ============================================================================
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

async function load() {
  const r = await fetch('/api/xsmn', { cache: 'no-store' });
  if (!r.ok) throw new Error('api');
  return r.json();
}

function chips(nums, deVal) {
  const wrap = el('div', 'lo-chips');
  for (const n of nums) wrap.appendChild(el('span', 'lo-chip' + (n === deVal ? ' de' : ''), n));
  return wrap;
}

function provinceCard(p) {
  const c = el('div', 'xsmn-prov');
  c.appendChild(el('div', 'xsmn-prov-head', `<span class="xsmn-name">${p.province}</span><span class="muted small">${p.code}</span>`));
  c.appendChild(el('div', 'xsmn-de', `ĐỀ <b>${p.de}</b>`));
  c.appendChild(el('div', 'muted small', 'Lô (2 số cuối 18 giải):'));
  c.appendChild(chips(p.lo2, p.de));
  return c;
}

function fillRank(sel, list) {
  const b = $(sel); if (!b) return; b.innerHTML = '';
  for (const x of list) {
    const row = el('div', 'rank-row');
    row.appendChild(el('span', 'ball small', x.n));
    row.appendChild(el('span', 'rank-sub', `${x.c} lần`));
    b.appendChild(row);
  }
}

function renderEffect(bt) {
  const box = $('#xsmn-effect'); if (!box) return; box.innerHTML = '';
  if (!bt || !bt.provinceDraws) { box.appendChild(el('div', 'muted small', 'Đang tích luỹ dữ liệu để đo hiệu quả…')); return; }
  const eff = bt.effective;
  box.appendChild(el('div', 'ev-verdict ' + (eff ? 'mid' : 'bad'),
    eff ? '🟡 Có tín hiệu nhỏ trên mẫu hiện tại — CHƯA đủ cơ sở để đặt tiền'
      : '🔴 KHÔNG vượt ngẫu nhiên — xếp hạng nóng/lạnh không giúp trúng nhiều hơn'));
  const g = el('div', 'effect-grid');
  g.innerHTML = `
    <div class="effect-cell"><div class="effect-val">${bt.lo.ratio.toFixed(2)}×</div><div class="effect-lab">Lô: trúng thực tế / ngẫu nhiên<br><span class="muted small">1.00× = không hơn ngẫu nhiên</span></div></div>
    <div class="effect-cell"><div class="effect-val">${(bt.de.matchRate * 100).toFixed(1)}%</div><div class="effect-lab">Đề top-1 khớp thực tế<br><span class="muted small">ngẫu nhiên = 1.0%</span></div></div>
    <div class="effect-cell"><div class="effect-val">${bt.testedDays}</div><div class="effect-lab">ngày đã kiểm thử<br><span class="muted small">${bt.provinceDraws} lượt đài</span></div></div>`;
  box.appendChild(g);
  box.appendChild(el('div', 'note small', `<b>Kết luận:</b> ${bt.verdict}`));
}

function render(data) {
  $('#xsmn-date').textContent = '· ' + data.latestDate;
  $('#xsmn-live').innerHTML = `<span class="dot"></span> ${data.source} · ${new Date(data.collectedAt).toLocaleTimeString('vi-VN')}`;

  const today = data.days[0];
  const box = $('#xsmn-today'); box.innerHTML = '';
  for (const p of today.provinces) box.appendChild(provinceCard(p));

  renderEffect(data.backtest);

  const st = data.stats;
  const dbTxt = data.db && data.db.totalDays ? ` · 💾 kho: ${data.db.totalDays} ngày (${data.db.oldest}→${data.db.newest})` : '';
  $('#xsmn-window').textContent = `${st.days} ngày (${st.loN} lượt lô · ${st.deN} kỳ đề)${dbTxt}`;
  fillRank('#xsmn-hot', st.loHot);
  fillRank('#xsmn-cold', st.loCold);
  fillRank('#xsmn-dehot', st.deHot);

  // Heatmap 00–99 theo tần suất lô
  const heat = $('#xsmn-heatmap'); heat.innerHTML = '';
  const maxF = Math.max(1, ...st.loFreq);
  for (let n = 0; n < 100; n++) {
    const t = st.loFreq[n] / maxF;
    const cell = el('div', 'cell', `<b>${String(n).padStart(2, '0')}</b><i>${st.loFreq[n]}</i>`);
    cell.style.background = `rgba(230,72,60,${0.08 + t * 0.85})`;
    cell.style.color = t > 0.55 ? '#fff' : '#111';
    cell.title = `Cặp ${String(n).padStart(2, '0')}: ${st.loFreq[n]} lần / ${st.days} ngày`;
    heat.appendChild(cell);
  }

  // Cặp số nghiên cứu THEO TỪNG ĐÀI (từ lịch sử tích luỹ) — trung thực, không dự đoán
  const rbox = $('#xsmn-research'); rbox.innerHTML = '';
  const provStats = new Map((st.provinces || []).map((p) => [p.slug || p.name, p]));
  const todayProvs = data.today ? data.today.provinces : (today ? today.provinces : []);
  for (const tp of todayProvs) {
    const ps = provStats.get(tp.slug || tp.province);
    const deep = ps && ps.draws >= 8;
    const top = (deep ? ps.loHot : st.loHot).slice(0, 2);
    const c = el('div', 'xsmn-prov');
    c.appendChild(el('div', 'xsmn-prov-head', `<span class="xsmn-name">${tp.province}</span><span class="muted small">${ps ? ps.draws + ' kỳ' : 'nghiên cứu'}</span>`));
    const pair = el('div', 'balls');
    for (const x of top) pair.appendChild(el('span', 'ball', x.n));
    c.appendChild(pair);
    c.appendChild(el('div', 'muted small', deep
      ? `Top 2 lô theo lịch sử ĐÀI này (${ps.draws} kỳ). Xếp hạng thống kê — không dự đoán.`
      : 'Đang tích luỹ lịch sử đài (tạm dùng top toàn miền). Kho lớn dần mỗi ngày. Không dự đoán.'));
    rbox.appendChild(c);
  }

  document.body.classList.remove('busy');
}

async function run() {
  document.body.classList.add('busy');
  try { render(await load()); }
  catch (_) { $('#xsmn-live').innerHTML = '⚠️ Chưa tải được dữ liệu — thử lại sau.'; document.body.classList.remove('busy'); }
}

$('#xsmn-refresh').onclick = run;
document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
run();
setInterval(() => { if (!document.hidden) run(); }, 3 * 60 * 1000);
