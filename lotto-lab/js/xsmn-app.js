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

function render(data) {
  $('#xsmn-date').textContent = '· ' + data.latestDate;
  $('#xsmn-live').innerHTML = `<span class="dot"></span> ${data.source} · ${new Date(data.collectedAt).toLocaleTimeString('vi-VN')}`;

  const today = data.days[0];
  const box = $('#xsmn-today'); box.innerHTML = '';
  for (const p of today.provinces) box.appendChild(provinceCard(p));

  const st = data.stats;
  $('#xsmn-window').textContent = `${st.days} ngày gần đây (${st.loN} lượt lô · ${st.deN} kỳ đề)`;
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

  // Cặp số nghiên cứu (Top lô nóng toàn miền) — trung thực, không dự đoán
  const rbox = $('#xsmn-research'); rbox.innerHTML = '';
  const card = el('div', 'xsmn-prov');
  card.appendChild(el('div', 'xsmn-prov-head', '<span class="xsmn-name">Top 2 lô xếp hạng cao (toàn miền)</span><span class="muted small">nghiên cứu</span>'));
  const pair = el('div', 'balls big');
  for (const x of st.loHot.slice(0, 2)) pair.appendChild(el('span', 'ball', x.n));
  card.appendChild(pair);
  card.appendChild(el('div', 'muted small', `Hai cặp số có tần suất lô cao nhất trong ${st.days} ngày gần đây. Xếp hạng thống kê — KHÔNG dự đoán kỳ tới; dài hạn sẽ hồi quy về mức ngẫu nhiên.`));
  rbox.appendChild(card);

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
