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

// Lịch mở thưởng XSMN theo thứ (0=CN … 6=T7) → [slug, tên đài].
const SCHEDULE = {
  0: [['tien-giang', 'Tiền Giang'], ['kien-giang', 'Kiên Giang'], ['da-lat', 'Đà Lạt']],
  1: [['tp-hcm', 'TP. HCM'], ['dong-thap', 'Đồng Tháp'], ['ca-mau', 'Cà Mau']],
  2: [['ben-tre', 'Bến Tre'], ['vung-tau', 'Vũng Tàu'], ['bac-lieu', 'Bạc Liêu']],
  3: [['dong-nai', 'Đồng Nai'], ['can-tho', 'Cần Thơ'], ['soc-trang', 'Sóc Trăng']],
  4: [['tay-ninh', 'Tây Ninh'], ['an-giang', 'An Giang'], ['binh-thuan', 'Bình Thuận']],
  5: [['vinh-long', 'Vĩnh Long'], ['binh-duong', 'Bình Dương'], ['tra-vinh', 'Trà Vinh']],
  6: [['tp-hcm', 'TP. HCM'], ['long-an', 'Long An'], ['binh-phuoc', 'Bình Phước'], ['hau-giang', 'Hậu Giang']],
};

function deviceNotify(title, body) {
  try { if (('Notification' in window) && Notification.permission === 'granted') new Notification(title, { body, tag: 'xsmn' }); } catch (_) { /* bỏ qua */ }
}

function renderTomorrow(data) {
  const box = $('#xsmn-tomorrow'); if (!box) return; box.innerHTML = '';
  const st = data.stats;
  const provStats = new Map((st.provinces || []).map((p) => [p.slug || p.name, p]));
  const tmr = new Date(Date.now() + 86400000);
  const provs = SCHEDULE[tmr.getDay()] || [];
  box.appendChild(el('div', 'muted small', `Đài mở thưởng ngày mai (${tmr.toLocaleDateString('vi-VN')}):`));
  const grid = el('div', 'xsmn-grid');
  for (const [slug, name] of provs) {
    const ps = provStats.get(slug);
    const top = (ps ? ps.loHot : st.loHot).slice(0, 2).map((x) => x.n);
    const c = el('div', 'xsmn-prov');
    c.appendChild(el('div', 'xsmn-prov-head', `<span class="xsmn-name">${name}</span><span class="muted small">${ps ? ps.draws + ' kỳ' : 'toàn miền'}</span>`));
    const pair = el('div', 'balls'); for (const n of top) pair.appendChild(el('span', 'ball', n));
    c.appendChild(pair);
    grid.appendChild(c);
  }
  box.appendChild(grid);
}

function renderTrack(data) {
  const box = $('#xsmn-track'); if (!box) return; box.innerHTML = '';
  const s = data.backtest && data.backtest.suggestion;
  if (!s || !s.total) { box.appendChild(el('div', 'muted small', 'Đang tích luỹ dữ liệu để chấm gợi ý…')); return; }
  const diff = (s.hitRate - s.randomRate) * 100;
  box.appendChild(el('div', 'hit-summary', `📒 Gợi ý 2 số/đài đã <b>về ${s.hits}/${s.total}</b> lần = <b>${(s.hitRate * 100).toFixed(1)}%</b> · mức ngẫu nhiên ≈ <b>${(s.randomRate * 100).toFixed(1)}%</b> (chênh ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} điểm — ${Math.abs(diff) < 3 ? '≈ ngẫu nhiên' : 'đáng xem'}).`));
  const hist = el('div', 'hit-hist');
  for (const e of s.ledger) {
    const chip = el('span', 'hit-chip' + (e.hit ? ' good' : ''), `${e.prov} ${e.sug.join('·')} ${e.hit ? '✓' : '✗'}`);
    chip.title = `${e.date} · ${e.prov}: gợi ý ${e.sug.join(', ')} — ${e.hit ? 'VỀ' : 'trượt'}`;
    hist.appendChild(chip);
  }
  box.appendChild(hist);
  box.appendChild(el('div', 'note small', '⚠️ "Về" = ≥1 trong 2 số gợi ý xuất hiện trong 18 lô của đài. Đây là hiệu quả THẬT; nếu ≈ ngẫu nhiên thì gợi ý không giúp thắng nhiều hơn — đừng đặt tiền kỳ vọng có lợi thế.'));
  // Báo về máy khi có gợi ý VỀ ở ngày mới nhất (một lần / ngày).
  try {
    const latest = s.ledger.length ? s.ledger[0].date : null;
    const hitsLatest = s.ledger.filter((e) => e.date === latest && e.hit);
    if (latest && hitsLatest.length && localStorage.getItem('xsmn:notified') !== latest) {
      deviceNotify(`🎯 Gợi ý VỀ ${hitsLatest.length} đài (${latest})`, hitsLatest.map((e) => `${e.prov}: ${e.sug.join(',')}`).join(' · '));
      localStorage.setItem('xsmn:notified', latest);
    }
  } catch (_) { /* bỏ qua */ }
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

  renderTomorrow(data);
  renderTrack(data);

  document.body.classList.remove('busy');
}

async function run() {
  document.body.classList.add('busy');
  try { render(await load()); }
  catch (_) { $('#xsmn-live').innerHTML = '⚠️ Chưa tải được dữ liệu — thử lại sau.'; document.body.classList.remove('busy'); }
}

$('#xsmn-refresh').onclick = run;
const nb = $('#xsmn-notif');
if (nb) nb.onclick = async () => {
  if (!('Notification' in window)) return;
  const p = await Notification.requestPermission();
  nb.textContent = p === 'granted' ? '🔔 Đã bật báo' : '🔔 Bật báo';
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
run();
setInterval(() => { if (!document.hidden) run(); }, 3 * 60 * 1000);
