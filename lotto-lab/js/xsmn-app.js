// ============================================================================
// js/xsmn-app.js — Giao diện Xổ số Miền Nam. Hai thứ, không thêm gì:
//   ĐỀ 2 SỐ và LÔ 2 SỐ cho từng đài.
//
// Mọi phần chứng minh phương pháp (bảng nhánh, kiểm định giữ lại, đường học, thống kê
// mô tả) vẫn chạy đủ ở máy chủ và vẫn tải về — chỉ nằm trong ngăn kéo đóng sẵn. Ẩn đi
// KHÔNG phải bỏ đi: khi nào cần cãi nhau bằng số liệu thì mở ra là có ngay.
//
// Luật duy nhất không được phá: mỗi tỉ lệ hiện ra đều phải kèm MỐC BỐC MÙ tính đúng cho
// chính kỳ đó và CỠ MẪU. "Về 40%" trần trụi là con số vô nghĩa — chơi 10 số bao giờ cũng
// "về" nhiều hơn chơi 2 số, kể cả khi bốc mù hoàn toàn.
// ============================================================================
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const sgn = (x, d = 1) => (x >= 0 ? '+' : '') + (x * 100).toFixed(d);
const vnDate = (ymd) => { const [, m, d] = ymd.split('-'); return `${d}/${m}`; };
const hhmm = (iso) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const tone = (edge) => (edge > 0.005 ? 'up' : edge < -0.005 ? 'down' : 'flat');

let DATA = null;
let chainLeft = 0;   // số lượt "đi tiếp" còn được phép trong lần mở trang này

async function load(sync = false) {
  const r = await fetch('/api/xsmn' + (sync ? '?sync=1' : ''), { cache: 'no-store' });
  if (!r.ok) throw new Error('api');
  return r.json();
}

// Kho nạp dở dang thì tự gọi lại để đi tiếp — mỗi lượt bò thêm được một đoạn, thay vì
// đứng chờ cron ngày hôm sau. Có TRẦN LƯỢT: kho lớn dần là việc nhiều tháng, không thể
// để một tab mở sẵn quay vòng vô hạn mà nướng hết hạn mức máy chủ.
const CHAIN_MAX = 4;
async function chainSync() {
  if (chainLeft <= 0) return;
  chainLeft--;
  try {
    const d = await load(true);
    render(d);
    if (d.sync && d.sync.more) setTimeout(chainSync, 1500);
  } catch (_) { /* lượt sau thử lại */ }
}

// ---------------------------------------------------------------------------
// 1 · DÀN SỐ KỲ TỚI
// ---------------------------------------------------------------------------

// Dòng tỉ lệ dưới mỗi dàn số. Ưu tiên SỔ CAM KẾT (`t`) vì đó là bằng chứng thật: dàn số
// đã nằm trong kho có dấu thời gian trước khi kỳ đó quay. Chỉ khi sổ chưa đủ dày mới rơi
// về số walk-forward (`w` — máy tự chấm bài mình trên quá khứ), và khi đó phải NÓI RÕ là
// đang lấy từ đâu. Trộn im lặng hai nguồn này là cách dễ nhất để biến một con số yếu
// thành một con số trông mạnh.
const MIN_LEDGER_N = 8;

function rateLine(t, w, k) {
  if (t && t.n >= MIN_LEDGER_N) {
    return {
      html: `<b>${t.hits}/${t.n}</b> kỳ đã chấm = <b class="${tone(t.edge)}">${pct(t.rate)}</b>` +
        `<span class="vs">bốc mù ${pct(t.expRate)}</span>`,
      src: 'đo trên sổ cam kết của chính đài này',
      weak: t.n < 30,
    };
  }
  if (w && w.provN >= 12 && w.provRate != null) {
    return {
      html: `<b>${w.provHits}/${w.provN}</b> kỳ trong kho = <b class="${tone(w.provRate - w.provExp)}">${pct(w.provRate)}</b>` +
        `<span class="vs">bốc mù ${pct(w.provExp)}</span>`,
      src: 'máy tự chấm lại trên lịch sử đài này — chưa phải số đã cam kết trước',
      weak: true,
    };
  }
  if (w && w.armN && w.armRate != null) {
    return {
      html: `<b class="${tone(w.armRate - w.armExp)}">${pct(w.armRate)}</b> trên ${w.armN} lượt toàn miền` +
        `<span class="vs">bốc mù ${pct(w.armExp)}</span>`,
      src: 'đài này chưa đủ kỳ — đang mượn số của cả miền',
      weak: true,
    };
  }
  return { html: `<span class="muted">chưa đủ kỳ để đo — chơi ${k} số/kỳ</span>`, src: '', weak: true };
}

function numRow(kind, label, nums, t, w) {
  const row = el('div', 'pred-row ' + kind);
  const head = el('div', 'pred-lab');
  head.innerHTML = `<span class="tag-${kind}">${label}</span><small>${nums.length} số</small>`;
  row.appendChild(head);

  const box = el('div', 'pred-nums');
  for (const v of nums) box.appendChild(el('span', 'num', v));
  row.appendChild(box);

  const r = rateLine(t, w, nums.length);
  const why = el('div', 'pred-why' + (r.weak ? ' weak' : ''));
  why.innerHTML = r.html + (r.src ? `<i title="${r.src}">ⓘ</i>` : '');
  if (w && w.armName) why.title = `nhánh đang dùng: ${w.armName}${r.src ? ' · ' + r.src : ''}`;
  row.appendChild(why);
  return row;
}

function renderPrediction(d) {
  const p = d.prediction;
  const box = $('#pred-grid'); box.innerHTML = '';
  const lock = $('#pred-lock'); lock.innerHTML = '';
  const foot = $('#pred-foot'); foot.innerHTML = '';
  $('#pred-date').textContent = p ? `kỳ ${vnDate(p.forDate)}` : '';

  if (!p || !p.provinces.length) {
    box.appendChild(el('div', 'muted small', 'Chưa xác định được đài mở thưởng cho kỳ tới.'));
    return;
  }
  if (p.lockedAt) {
    lock.innerHTML = `🔒 đã khoá lúc <b>${hhmm(p.lockedAt)}</b> — không đổi nữa cho tới khi có kết quả`;
    lock.title = 'Máy học thêm mỗi ngày nên hôm nay nó có thể nghĩ khác. Nhưng số đem đi chấm điểm phải đúng là số anh đã nhìn thấy, nếu không thì phần đối chiếu bên dưới đo một thứ anh chưa từng thấy.';
  }
  for (const q of p.provinces) {
    const c = el('div', 'pred-card');
    c.appendChild(el('div', 'pred-head', `<span class="xsmn-name">${q.province}</span>`));
    c.appendChild(numRow('de', 'ĐỀ', q.de.picks, q.track ? q.track.de : null, q.de));
    c.appendChild(numRow('lo', 'LÔ', q.lo.picks, q.track ? q.track.lo : null, q.lo));
    box.appendChild(c);
  }

  const graded = d.ledger && d.ledger.summary ? d.ledger.summary.total : 0;
  const brainN = d.brain ? d.brain.gradedDraws : 0;
  foot.innerHTML = `Tự kiểm liên tục: <b>${graded}</b> lượt đài đã cam kết trước rồi chấm bằng kết quả thật · ` +
    `bộ não học lại trên <b>${brainN.toLocaleString('vi-VN')}</b> lượt mỗi lần chạy. ` +
    `Tỉ lệ dưới mỗi dàn số là <b>số đã đo của chính đài đó</b>, luôn kèm mốc bốc mù cùng số lượng số.`;
}

// ---------------------------------------------------------------------------
// 2 · ĐỐI CHIẾU
// ---------------------------------------------------------------------------
function statLine(name, s, k) {
  return `<div class="ov-row"><span class="ov-lab tag-${name === 'ĐỀ' ? 'de' : 'lo'}">${name}</span>` +
    `<span class="ov-val ${tone(s.rate - s.expRate)}">${pct(s.rate)}</span>` +
    `<span class="ov-sub">${s.hits}/${s.total} kỳ · ${k} số/kỳ · bốc mù ${pct(s.expRate)} · ${sgn(s.rate - s.expRate)} điểm</span></div>`;
}

function renderLedger(d) {
  const L = d.ledger || {}; const S = L.summary || { total: 0, rows: [] };
  const sum = $('#led-summary'); sum.innerHTML = '';
  const pend = $('#led-pending'); pend.innerHTML = '';
  const rows = $('#led-rows'); rows.innerHTML = '';
  $('#led-meta').textContent = S.total ? `${S.total} lượt đài · ${S.days} ngày` : '';

  if (!S.total) {
    sum.appendChild(el('div', 'note small', 'Sổ vừa mở. Máy đã ghi số cho kỳ tới xuống kho kèm dấu thời gian; kết quả về là chấm ngay. Chưa có dòng nào thì chưa có gì để khoe — và app sẽ không bịa ra.'));
  } else {
    const box = el('div', 'overview');
    box.innerHTML = statLine('ĐỀ', { ...S.de, total: S.total }, S.de.k) + statLine('LÔ', { ...S.lo, total: S.total }, S.lo.k);
    sum.appendChild(box);
    if (S.total < 90) {
      sum.appendChild(el('div', 'note small', `Mới ${S.total} lượt — cỡ mẫu này còn nhỏ, chênh lệch vài điểm hoàn toàn có thể là may rủi. Con số chỉ bắt đầu đáng tin từ khoảng 300 lượt.`));
    }
    if (S.byProvince && S.byProvince.length) sum.appendChild(provinceTable(S.byProvince));
  }

  const pending = L.pending || [];
  if (pending.length) {
    const p = pending[0];
    const box = el('div', 'led-pending');
    box.appendChild(el('div', 'led-pending-head', `⏳ đang chờ kết quả ngày <b>${vnDate(p.forDate)}</b> · số đã khoá lúc ${hhmm(p.madeAt)}`));
    for (const it of p.items) {
      box.appendChild(el('div', 'led-pending-row',
        `<span class="xsmn-name">${it.province}</span>` +
        `<span class="led-tag de">ĐỀ</span>${it.de.map((n) => `<span class="num">${n}</span>`).join('')}` +
        `<span class="led-tag lo">LÔ</span>${it.lo.map((n) => `<span class="num">${n}</span>`).join('')}`));
    }
    pend.appendChild(box);
  }

  let curDate = null, dayBox = null;
  for (const r of S.rows) {
    if (r.date !== curDate) {
      curDate = r.date;
      dayBox = el('div', 'led-day');
      dayBox.appendChild(el('div', 'led-day-head', r.date));
      rows.appendChild(dayBox);
    }
    const row = el('div', 'led-row');
    row.appendChild(el('div', 'led-prov', r.province));
    const de = el('div', 'led-line');
    de.innerHTML = `<span class="led-tag de">ĐỀ</span>` +
      r.de.map((n) => `<span class="num${r.deMatch.includes(n) ? ' hit' : ''}">${n}</span>`).join('') +
      `<span class="led-actual">kết quả <b>${r.actualDe}</b></span>` +
      `<span class="led-verdict ${r.deHit ? 'good' : 'bad'}">${r.deHit ? 'trúng' : 'trượt'}</span>`;
    const lo = el('div', 'led-line');
    lo.innerHTML = `<span class="led-tag lo">LÔ</span>` +
      r.lo.map((n) => `<span class="num${r.loMatch.includes(n) ? ' hit' : ''}">${n}</span>`).join('') +
      `<span class="led-verdict ${r.loHit ? 'good' : 'bad'}">${r.loHit ? `về ${r.loMatch.length} số` : 'trượt'}</span>`;
    row.appendChild(de); row.appendChild(lo);
    dayBox.appendChild(row);
  }
}

// Bảng tỉ lệ theo từng đài — trả lời đúng câu "đài nào máy đang đoán khá hơn".
// Cột "bốc mù" đứng ngay cạnh cột tỉ lệ có chủ ý: hai đài chơi khác số lượng số thì tỉ
// lệ thô không so được với nhau, chỉ phần chênh mới so được.
function provinceTable(list) {
  const wrap = el('details', 'sub-drawer');
  wrap.appendChild(el('summary', null, `Tỉ lệ theo từng đài <small>(${list.length} đài đã có kỳ chấm)</small>`));
  const t = el('div', 'ptable');
  t.appendChild(el('div', 'ptable-row head', '<span>Đài</span><span>Kỳ</span><span>ĐỀ</span><span>chênh</span><span>LÔ</span><span>chênh</span>'));
  for (const p of list) {
    const r = el('div', 'ptable-row');
    r.innerHTML =
      `<span class="pt-name">${p.province}</span>` +
      `<span class="muted">${p.n}</span>` +
      `<span title="${p.de.hits}/${p.n} kỳ, chơi ${p.de.k} số — bốc mù ${pct(p.de.expRate)}"><b>${pct(p.de.rate)}</b></span>` +
      `<span class="${tone(p.de.edge)}">${sgn(p.de.edge)}</span>` +
      `<span title="${p.lo.hits}/${p.n} kỳ, chơi ${p.lo.k} số — bốc mù ${pct(p.lo.expRate)}"><b>${pct(p.lo.rate)}</b></span>` +
      `<span class="${tone(p.lo.edge)}">${sgn(p.lo.edge)}</span>`;
    t.appendChild(r);
  }
  wrap.appendChild(t);
  wrap.appendChild(el('div', 'muted small', 'Cột "chênh" = tỉ lệ đo được trừ mốc bốc số mù, tính riêng cho đúng số lượng số mỗi đài đang chơi. Số dương không có nghĩa là đài đó "dễ ăn": với vài chục kỳ, chênh ±10 điểm vẫn nằm gọn trong khoảng may rủi.'));
  return wrap;
}

// ---------------------------------------------------------------------------
// 3 · KẾT QUẢ ĐẦY ĐỦ (ngăn kéo)
// ---------------------------------------------------------------------------
function provinceCard(p) {
  const c = el('div', 'xsmn-prov');
  c.appendChild(el('div', 'xsmn-prov-head', `<span class="xsmn-name">${p.province}</span><span class="muted small">${p.code}</span>`));
  c.appendChild(el('div', 'xsmn-de', `ĐỀ <b>${p.de}</b>`));
  const wrap = el('div', 'lo-chips');
  for (const n of p.lo2) wrap.appendChild(el('span', 'lo-chip' + (n === p.de ? ' de' : ''), n));
  c.appendChild(wrap);
  return c;
}

// ---------------------------------------------------------------------------
// 4 · NGĂN KÉO KỸ THUẬT — vẫn chạy đủ, chỉ đóng sẵn
// ---------------------------------------------------------------------------
const gateChip = (ok, label, detail) => `<span class="gate ${ok ? 'pass' : 'fail'}" title="${detail}">${ok ? '✔' : '✘'} ${label}</span>`;

function renderTrack(t) {
  const box = $('#brain-track'); box.innerHTML = '';
  if (!t || !t.bandit || !t.bandit.n) {
    box.appendChild(el('div', 'muted small', 'Kho chưa đủ dữ liệu để chấm điểm các nhánh.'));
    return;
  }

  const gates = el('div', 'gates');
  gates.innerHTML =
    gateChip(t.passStat, 'Vượt ngẫu nhiên sau chỉnh đa so sánh', 'Holm p < 0.01') +
    gateChip(t.passHold, 'Sống sót đoạn dữ liệu giữ lại', 'Chọn nhà vô địch bằng 75% đầu, đo trên 25% cuối') +
    `<span class="gate ${t.evidence ? 'pass' : 'fail'}">${t.evidence ? 'CÓ tín hiệu — vẫn chưa đủ để đặt tiền' : 'CHƯA có bằng chứng vượt ngẫu nhiên'}</span>`;
  box.appendChild(gates);

  const h = t.holdout;
  if (h) {
    box.appendChild(el('div', 'note small',
      `<b>Kiểm định giữ lại:</b> chọn nhà vô địch <b>“${h.name}”</b> chỉ bằng ${h.trainN} lượt đầu (ở đó nó về ${pct(h.trainRate)}), rồi đo trên ${h.testN} lượt cuối kể từ ${h.cutDate} — đoạn nó chưa từng được nhìn để chọn: về <b>${pct(h.testRate)}</b> so với bốc mù ${pct(h.testExp)} (${sgn(h.testEdge)} điểm, z=${h.z.toFixed(2)}, p=${h.p.toFixed(3)}) → <b class="${h.survived ? 'up' : 'down'}">${h.survived ? 'SỐNG SÓT' : 'KHÔNG sống sót'}</b>.`));
  }

  // Bảng nhánh — đo ở mức CHƠI (đúng số lượng số trang chủ đưa ra), không phải mức học.
  const tbl = el('div', 'arm-table');
  const showRank = t.arms.some((a) => a.meanRank != null);
  tbl.appendChild(el('div', 'arm-row head',
    `<span class="arm-name">Nhánh chiến lược</span><span>về</span><span>bốc mù</span><span>chênh</span>` +
    (showRank ? '<span title="Hạng trung bình của đáp án thật trong 100 số máy xếp. Bốc mù = 50.5. Đây là thước đo nhạy nhất.">hạng TB</span>' : '<span>z</span>') +
    `<span>trọng số</span>`));
  for (const a of t.arms) {
    const isCtrl = a.key === 'rand' || a.key === 'deRand';
    const row = el('div', 'arm-row' + (a.kind === 'meta' ? ' meta' : '') + (isCtrl ? ' ctrl' : ''));
    row.innerHTML =
      `<span class="arm-name" title="${a.desc}">${a.name}${isCtrl ? ' <i>← mốc sự thật</i>' : ''}</span>` +
      `<span><b>${pct(a.showRate)}</b></span>` +
      `<span class="muted">${pct(a.showExp)}</span>` +
      `<span class="${tone(a.showEdge)}">${sgn(a.showEdge)}</span>` +
      (showRank ? `<span class="muted">${a.meanRank == null ? '—' : a.meanRank.toFixed(1)}</span>` : `<span class="muted">${a.showZ.toFixed(2)}</span>`) +
      (a.weight == null
        ? `<span class="muted small" title="Nhánh gộp/chọn — không nằm trong thang trọng số">—</span>`
        : `<span class="wbar"><i style="width:${Math.min(100, a.weight * 100 * 3).toFixed(1)}%"></i><em>${(a.weight * 100).toFixed(1)}%</em></span>`);
    tbl.appendChild(row);
  }
  box.appendChild(tbl);
  box.appendChild(el('div', 'muted small', `Đo trên <b>${t.bandit.n}</b> lượt đài, ở đúng mức <b>${t.show} số/đài</b> mà trang chủ đưa ra. Nhánh <b>“Ngẫu nhiên (đối chứng)”</b> được đóng khung có chủ ý: nếu nó nằm lẫn giữa bảng thì mọi mẹo nóng/nguội/gan/bóng ở trên <b>không hơn bốc số mù</b>.`));

  const nBase = t.arms.filter((a) => a.kind === 'base').length;
  box.appendChild(el('div', 'hit-summary',
    `Máy tự chọn nhánh đạt <b>${pct(t.bandit.rate)}</b> (ở mức học ${t.headK} số), trong khi trung bình cả ${nBase} nhánh chỉ được ${pct(t.avgBaseRate)} → phần tự học mang lại <b class="${t.learnGain > 0 ? 'up' : 'down'}">${sgn(t.learnGain, 2)} điểm</b>. Đây là thứ máy THẬT SỰ học được: chọn đúng nhánh mạnh cho từng đài. Nó không đồng nghĩa với thắng được xổ số — trần của mọi nhánh vẫn là mức bốc mù.`));

  if (t.bandit.coverage) {
    const cov = el('div', 'cov');
    cov.appendChild(el('div', 'muted small', 'Chơi càng nhiều số càng dễ “về” — nhưng bốc mù cũng vậy. Cột dưới là mốc bốc mù cùng số lượng:'));
    const g = el('div', 'cov-grid');
    for (const c of t.bandit.coverage) {
      const e = c.rate - c.expRate;
      g.appendChild(el('div', 'cov-cell', `<b>${c.k} số</b><span>${pct(c.rate)}</span><i>bốc mù ${pct(c.expRate)}</i><u class="${tone(e)}">${sgn(e)}</u>`));
    }
    cov.appendChild(g);
    box.appendChild(cov);
  }

  // Vẽ CHÊNH LỆCH so với mốc bốc mù, không vẽ tỉ lệ thô: mọi giá trị đều quanh 30% nên
  // cột tính từ mốc 0 trông cao gần bằng nhau, nhìn không ra gì.
  if (t.curve && t.curve.length) {
    const c = el('div', 'curve');
    c.appendChild(el('div', 'muted small', 'Đường học theo thời gian — chênh lệch so với bốc mù (vạch giữa = ngang bốc mù):'));
    const devs = t.curve.map((b) => b.rate - b.expRate);
    const span = Math.max(0.03, ...devs.map(Math.abs)) * 1.2;
    const bars = el('div', 'curve-bars dev');
    t.curve.forEach((b, i) => {
      const dv = devs[i];
      const bar = el('div', 'curve-bar');
      bar.title = `${b.from} → ${b.to} · ${b.n} lượt · về ${pct(b.rate)} · bốc mù ${pct(b.expRate)} · chênh ${sgn(dv)} điểm`;
      bar.innerHTML = `<i class="${dv >= 0 ? 'up' : 'down'}" style="height:${(Math.abs(dv) / span * 50).toFixed(1)}%;${dv >= 0 ? 'bottom:50%' : 'top:50%'}"></i><s style="bottom:50%"></s><em>${vnDate(b.to)}</em>`;
      bars.appendChild(bar);
    });
    c.appendChild(bars);
    c.appendChild(el('div', 'muted small', `Mỗi cột ${t.curve[0].n} lượt đài. Cột nhảy lên nhảy xuống quanh vạch giữa <b>là dấu hiệu của nhiễu, không phải của học</b>.`));
    box.appendChild(c);
  }

  box.appendChild(el('div', 'note small', `<b>Kết luận đường ${t.label}:</b> ${t.verdict}`));
}

function renderBrain(d) {
  const b = d.brain; if (!b) return;
  $('#brain-scope').textContent = `${b.gradedDraws} lượt đài đã chấm trên ${d.db.brainDays} ngày lịch sử`;
  const v = $('#brain-verdict'); v.innerHTML = '';
  const any = b.lo.evidence || b.de.evidence;
  v.appendChild(el('div', 'ev-verdict ' + (any ? 'mid' : 'bad'),
    any ? 'Có tín hiệu nhỏ vượt ngẫu nhiên trên mẫu hiện tại — CHƯA đủ cơ sở để đặt tiền'
      : 'KHÔNG nhánh nào vượt ngẫu nhiên — chọn số theo nóng/nguội/gan/bóng không giúp trúng nhiều hơn'));
  let cur = 'de';
  const paint = () => {
    for (const btn of document.querySelectorAll('#track-tabs button')) btn.classList.toggle('active', btn.dataset.track === cur);
    renderTrack(b[cur]);
  };
  for (const btn of document.querySelectorAll('#track-tabs button')) btn.onclick = () => { cur = btn.dataset.track; paint(); };
  paint();
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

function renderStats(d) {
  const st = d.stats;
  $('#xsmn-window').textContent = `${st.days} ngày · ${st.loN.toLocaleString('vi-VN')} lượt lô · ${st.deN.toLocaleString('vi-VN')} kỳ đề`;
  fillRank('#xsmn-hot', st.loHot);
  fillRank('#xsmn-cold', st.loCold);
  fillRank('#xsmn-dehot', st.deHot);

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

  // Kho: Blob (chính) + Supabase (thứ hai). Hiện cả trạng thái LỖI nếu có — kho im lặng
  // chết là cái bẫy đã sập một lần: app tưởng đang tích luỹ, thực tế không lưu được gì.
  const q = $('#xsmn-storage'); if (!q) return;
  q.innerHTML = '';
  const item = (val, label, cls = '') => {
    const b = el('div', 'q-item ' + cls);
    b.innerHTML = `<div class="q-val">${val}</div><div class="q-label">${label}</div>`;
    return b;
  };
  const db = d.db || {};
  q.appendChild(item(db.totalDays || 0, `ngày trong kho (${db.oldest || '—'} → ${db.newest || '—'})`, db.persisted ? 'ok' : 'warn'));
  q.appendChild(item(db.brainDays || 0, 'ngày não đọc mỗi lần chạy'));
  q.appendChild(item(d.sync ? d.sync.daysBehind : '—', 'ngày kho đang chậm', d.sync && d.sync.daysBehind <= 1 ? 'ok' : 'warn'));
  const sb = d.supabase || {};
  q.appendChild(item(
    !sb.enabled ? 'tắt' : sb.skipped ? 'chờ cron' : sb.ok ? '✔' : '✘',
    !sb.enabled ? 'Supabase — chưa đặt biến môi trường'
      : sb.skipped ? 'Supabase — chỉ đẩy ở lượt cron/sync'
        : sb.ok ? `Supabase — đã đẩy ${sb.days} kỳ, ${sb.commits} cam kết, ${sb.accuracy} dòng tỉ lệ`
          : `Supabase lỗi: ${(sb.errors || []).join(' · ')}`,
    !sb.enabled ? '' : sb.ok ? 'ok' : sb.skipped ? '' : 'warn'));
}

// ---------------------------------------------------------------------------
function deviceNotify(title, body) {
  try { if (('Notification' in window) && Notification.permission === 'granted') new Notification(title, { body, tag: 'xsmn' }); } catch (_) { /* bỏ qua */ }
}

// Báo về máy khi sổ vừa chấm xong một ngày có trúng — mỗi ngày báo một lần.
function notifyIfGraded(d) {
  try {
    const S = d.ledger && d.ledger.summary;
    if (!S || !S.rows || !S.rows.length) return;
    const latest = S.rows[0].date;
    if (localStorage.getItem('xsmn:notified') === latest) return;
    const rows = S.rows.filter((r) => r.date === latest);
    const de = rows.filter((r) => r.deHit), lo = rows.filter((r) => r.loHit);
    if (!de.length && !lo.length) return;
    deviceNotify(`Đối chiếu ${latest}: đề ${de.length}/${rows.length} · lô ${lo.length}/${rows.length}`,
      rows.map((r) => `${r.province}: đề ${r.deHit ? '✓' : '✗'} lô ${r.loHit ? '✓' : '✗'}`).join(' · '));
    localStorage.setItem('xsmn:notified', latest);
  } catch (_) { /* bỏ qua */ }
}

function renderFreshness(d) {
  const s = d.sync; if (!s) return '';
  if (s.daysBehind <= 1) return `<span class="fresh ok">dữ liệu tới ${vnDate(s.newest)}</span>`;
  return `<span class="fresh warn">kho chậm ${s.daysBehind} ngày — đang tự nạp bù…</span>`;
}

function render(d) {
  DATA = d;
  $('#xsmn-date').textContent = d.latestDate;
  $('#xsmn-live').innerHTML = `<span class="dot"></span> ${d.source} · ${new Date(d.collectedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  $('#xsmn-fresh').innerHTML = renderFreshness(d);

  renderPrediction(d);
  renderLedger(d);

  const box = $('#xsmn-today'); box.innerHTML = '';
  for (const p of (d.days[0] ? d.days[0].provinces : [])) box.appendChild(provinceCard(p));

  // Ngăn kéo kỹ thuật chỉ dựng khi được mở lần đầu — dựng sẵn bảng 30 nhánh + 100 ô nhiệt
  // cho một thứ đóng kín là bắt máy yếu vẽ thừa mỗi lần làm mới.
  const tech = $('#drawer-tech');
  const paintTech = () => { renderBrain(DATA); renderStats(DATA); };
  if (tech.open) paintTech();
  else if (!tech.dataset.bound) {
    tech.dataset.bound = '1';
    tech.addEventListener('toggle', () => { if (tech.open) paintTech(); }, { once: false });
  }

  notifyIfGraded(d);
  document.body.classList.remove('busy');
}

async function run(forceSync = false) {
  document.body.classList.add('busy');
  try {
    const d = await load(forceSync);
    render(d);
    if (d.sync && d.sync.more) { chainLeft = CHAIN_MAX; setTimeout(chainSync, 1200); }
  } catch (_) {
    $('#xsmn-live').innerHTML = 'chưa tải được dữ liệu — thử lại sau';
    document.body.classList.remove('busy');
  }
}

// Gắn nút bấm. MỌI thứ ở đây phải chịu được lỗi: đây là mã chạy ở thân module, một
// ngoại lệ ném ra là cả module chết — kể cả `run()` bên dưới. Người dùng sẽ thấy một
// trang trắng vĩnh viễn, chỉ vì cái nút chuông không đổi được màu. Notification là chỗ
// dễ ném nhất (trình duyệt cũ, trang không chạy https, chế độ riêng tư).
try {
  $('#xsmn-refresh').onclick = () => run(true);
  const nb = $('#xsmn-notif');
  if (nb && window.Notification) {
    nb.onclick = async () => {
      try { nb.classList.toggle('on', (await window.Notification.requestPermission()) === 'granted'); } catch (_) { /* bỏ qua */ }
    };
    if (window.Notification.permission === 'granted') nb.classList.add('on');
  } else if (nb) {
    nb.style.display = 'none';   // không hỗ trợ thì giấu, đừng để nút bấm vào không có gì xảy ra
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
} catch (_) { /* nút hỏng thì thôi — dữ liệu vẫn phải lên */ }

run();
setInterval(() => { if (!document.hidden) run(); }, 5 * 60 * 1000);
