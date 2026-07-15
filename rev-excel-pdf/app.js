// REV Excel → PDF — cập nhật số "No. Required" (số cạnh mã lắp) theo Total Qnty trong Excel BOM.
// Chạy hoàn toàn client-side. Nhận diện theo HÌNH HỌC: khớp mã lắp trực tiếp rồi tìm
// số nguyên nằm ngay cạnh mã (kiểu Tekla "MARK  N"), không phụ thuộc vào nhãn text cứng.
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';

const { PDFDocument, StandardFonts, rgb } = PDFLib;
const $ = (s) => document.querySelector(s);
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DISPLAY_W = 1000;          // bề rộng canvas hiển thị (px)
const INT_RE = /^\d{1,4}$/;      // ứng viên "No. Required" là số nguyên 1–4 chữ số

const S = {
  workbook: null, rows: [], headerRow: 0, memberCol: 0, valueCol: 0,
  map: new Map(), pdfBytes: null, pdfDoc: null, pages: [], pickPage: null,
};

// ---------- Drop helpers ----------
function bindDrop(dropId, inputId, handler) {
  const drop = $(dropId), input = $(inputId);
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => e.target.files[0] && handler(e.target.files[0]));
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && handler(e.dataTransfer.files[0]));
}

// ================= EXCEL =================
async function onExcel(file) {
  const buf = await file.arrayBuffer();
  S.workbook = XLSX.read(buf, { type: 'array' });
  $('#excel-name').textContent = file.name;
  $('#excel-config').classList.remove('hidden');
  const sel = $('#sel-sheet'); sel.innerHTML = '';
  S.workbook.SheetNames.forEach((n, i) => sel.add(new Option(n, i)));
  sel.value = 0;
  loadSheet();
}

function loadSheet() {
  const ws = S.workbook.Sheets[S.workbook.SheetNames[$('#sel-sheet').value]];
  S.rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
  let hr = S.rows.findIndex((r) => r.some((c) => /member\s*no/i.test(String(c ?? ''))));
  if (hr < 0) hr = 0;
  const selH = $('#sel-header'); selH.innerHTML = '';
  for (let i = 0; i < Math.min(S.rows.length, 15); i++)
    selH.add(new Option(`Dòng ${i + 1}: ${(S.rows[i] || []).slice(0, 3).join(' | ').slice(0, 40)}`, i));
  selH.value = hr;
  buildColSelectors();
}

function buildColSelectors() {
  S.headerRow = +$('#sel-header').value;
  const header = S.rows[S.headerRow] || [];
  const ncol = Math.max(...S.rows.map((r) => r.length), header.length);
  const colLabel = (i) => `${XLSX.utils.encode_col(i)} — ${String(header[i] ?? '').slice(0, 26) || '(trống)'}`;
  const selM = $('#sel-member'), selV = $('#sel-value');
  selM.innerHTML = ''; selV.innerHTML = '';
  for (let i = 0; i < ncol; i++) { selM.add(new Option(colLabel(i), i)); selV.add(new Option(colLabel(i), i)); }
  let mIdx = header.findIndex((c) => /member\s*no/i.test(String(c ?? '')));
  if (mIdx < 0) mIdx = 0;
  const pref = [/^total\s*qnty$/i, /^total\s*qty$/i, /\bqnty\b/i, /\bqty\b/i, /required/i, /\bno\.?\b/i];
  let vIdx = -1;
  for (const rx of pref) { vIdx = header.findIndex((c) => rx.test(String(c ?? '').trim())); if (vIdx >= 0) break; }
  if (vIdx < 0) vIdx = Math.min(6, ncol - 1);
  selM.value = mIdx; selV.value = vIdx;
  buildMap();
}

function buildMap() {
  S.memberCol = +$('#sel-member').value;
  S.valueCol = +$('#sel-value').value;
  S.map.clear();
  for (let i = S.headerRow + 1; i < S.rows.length; i++) {
    const r = S.rows[i]; if (!r) continue;
    const m = r[S.memberCol], v = r[S.valueCol];
    if (m == null || String(m).trim() === '' || v == null || String(v).trim() === '') continue;
    const key = norm(m);
    if (key.length >= 3) S.map.set(key, { member: String(m).trim(), value: String(v).trim() });
  }
  renderExcelPreview();
  $('#step-pdf').classList.remove('disabled');
  if (S.pdfDoc) reprocess();
}

function renderExcelPreview() {
  const entries = [...S.map.values()];
  const head = S.rows[S.headerRow] || [];
  let html = `<table><thead><tr><th>Member No</th><th>${esc(String(head[S.valueCol] ?? 'Giá trị'))}</th></tr></thead><tbody>`;
  for (const e of entries.slice(0, 300)) html += `<tr><td>${esc(e.member)}</td><td class="val">${esc(e.value)}</td></tr>`;
  html += `</tbody></table><div class="pv-note">Đọc được <b>${entries.length}</b> member từ Excel.</div>`;
  $('#excel-preview').innerHTML = html;
}

// Khớp một chuỗi text với 1 member trong Excel (chính xác → chứa nhau → dài nhất thắng).
function matchMember(str) {
  const n = norm(str);
  if (n.length < 3) return null;
  if (S.map.has(n)) return { info: S.map.get(n), key: n };
  let best = null;
  for (const [k, v] of S.map) {
    if (k.length < 5) continue;
    if (n.includes(k) || k.includes(n)) { if (!best || k.length > best.key.length) best = { info: v, key: k }; }
  }
  return best;
}

// ================= PDF =================
async function onPdf(file) {
  $('#pdf-name').textContent = file.name;
  const status = $('#pdf-status'); status.classList.remove('hidden');
  status.innerHTML = '<span class="spinner"></span> Đang đọc & khớp từng trang…';
  S.pdfBytes = await file.arrayBuffer();
  S.pdfDoc = await pdfjsLib.getDocument({ data: S.pdfBytes.slice(0) }).promise;
  await reprocess();
}

async function reprocess() {
  if (!S.pdfDoc) return;
  const status = $('#pdf-status');
  S.pages = [];
  for (let p = 1; p <= S.pdfDoc.numPages; p++) {
    if (status) status.innerHTML = `<span class="spinner"></span> Đang xử lý trang ${p}/${S.pdfDoc.numPages}…`;
    const page = await S.pdfDoc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.map((it) => box(it, viewport)).filter(Boolean);
    const st = { pageNum: p, page, viewport, items, member: null, targets: [], scale: DISPLAY_W / viewport.width };
    detectPage(st);
    S.pages.push(st);
  }
  if (status) status.innerHTML = `Đã đọc <b>${S.pdfDoc.numPages}</b> trang.`;
  $('#step-review').classList.remove('disabled');
  $('#step-export').classList.remove('disabled');
  await renderAll();
}

// bbox 1 text item trong toạ độ device (scale 1, gốc trên-trái).
function box(item, viewport) {
  if (!item.str || !item.str.trim()) return null;
  const m = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const h = item.height || Math.hypot(m[2], m[3]) || 8;
  const w = item.width || Math.hypot(m[0], m[1]) * (item.str.length * 0.5) || 6;
  const x = m[4], y = m[5] - h;
  return { s: item.str.trim(), x, y, w: Math.max(w, 1), h: Math.max(h, 6), right: x + w, cx: x + w / 2, cy: y + h / 2 };
}

// Định dạng số mới: zero-pad thành 2 chữ số (1→"01", 4→"04", 12→"12").
const fmt = (v) => { const n = String(v ?? '').trim(); return /^\d$/.test(n) ? '0' + n : n; };

// -------- QUY TẮC DUY NHẤT: neo vào nhãn "No. Required" trong khối MATERIAL LIST FOR --------
// Số cần đổi = số nguyên đứng NGAY TRƯỚC (bên trái) nhãn "No. Required", cùng hàng.
// Member = mã cùng hàng bên trái số đó, khớp cột Member No trong Excel → lấy Total Qnty.
function detectPage(st) {
  st.member = null; st.targets = [];

  // mọi item khớp Member No trong Excel (để xác định member + fallback trang)
  const marks = [];
  for (const it of st.items) { const mm = matchMember(it.s); if (mm) marks.push({ it, info: mm.info }); }
  if (marks.length) {
    const freq = new Map();
    for (const mk of marks) freq.set(mk.info.member, (freq.get(mk.info.member) || 0) + 1);
    st.member = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // nhãn "No. Required" (khớp chữ "Required", chịu được tách item "No." + "Required")
  const labels = st.items.filter((it) => /required/i.test(it.s));
  const seen = new Set();

  for (const L of labels) {
    const rowTol = Math.max(L.h, 8) * 1.2;
    // số nguyên gần nhãn nhất, nằm BÊN TRÁI nhãn, cùng hàng
    let num = null;
    for (const it of st.items) {
      if (!INT_RE.test(it.s)) continue;
      if (Math.abs(it.cy - L.cy) > rowTol) continue;
      if (it.right > L.x + L.h * 0.6) continue;               // phải nằm bên trái nhãn
      if (!num || it.right > num.right) num = it;              // sát nhãn nhất
    }
    let target = null;
    if (num) target = { kind: 'separate', box: num, old: num.s };

    // mã cùng hàng, bên trái số → member cho ô này
    let rowInfo = null;
    for (const mk of marks) {
      if (Math.abs(mk.it.cy - L.cy) > rowTol) continue;
      if (num && mk.it.x >= num.x) continue;                  // mã phải ở bên trái số
      if (!rowInfo || mk.it.x > rowInfo.it.x) rowInfo = mk;   // mã gần số nhất
    }

    // fallback: số dính liền trong item mã "TD-...-0054 4" nếu không thấy số riêng
    if (!target && rowInfo) {
      const em = rowInfo.it.s.match(/^(.*\S)\s+(\d{1,4})$/);
      if (em) target = { kind: 'embedded', box: rowInfo.it, old: em[2], fullStr: rowInfo.it.s, num: em[2] };
    }
    if (!target) continue;

    const info = rowInfo ? rowInfo.info : (marks.find((m) => m.info.member === st.member) || {}).info;
    if (!info) continue;                                       // không suy ra được member → để user chọn tay

    const k = Math.round(target.box.x) + ':' + Math.round(target.box.y);
    if (seen.has(k)) continue; seen.add(k);
    // khoảng trống của ô số: từ mép phải mã → mép trái nhãn "No. Required" (để đặt số cho khít)
    if (target.kind === 'separate') {
      target.cellL = rowInfo ? rowInfo.it.right : (target.box.x - target.box.h);
      target.cellR = L.x;
    }
    target.newVal = fmt(info.value); target.member = info.member; target.enabled = true; target.conf = 'high';
    st.member = info.member;
    st.targets.push(target);
  }
}

// ================= RENDER TỪNG TRANG =================
async function renderAll() {
  const wrap = $('#pages'); wrap.innerHTML = '';
  let willChange = 0, same = 0, skipped = 0;

  for (const st of S.pages) {
    const changed = st.targets.filter((t) => String(t.old) !== String(t.newVal));
    if (!st.targets.length) skipped++;
    else { willChange += changed.length ? 1 : 0; if (!changed.length) same++; }

    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.p = st.pageNum;

    const stateCls = !st.member ? 'nomatch' : (!st.targets.length ? 'nomatch' : 'match');
    const memberTxt = st.member
      ? `<span class="member ${stateCls}">${esc(st.member)}</span>`
      : `<span class="member nomatch">không khớp member</span>`;
    const valTxt = st.targets.length
      ? `→ <b class="new">${esc(st.targets[0].newVal)}</b>`
      : (st.member ? '· chưa dò được số' : '');

    el.innerHTML = `
      <div class="page-head">
        <span class="pno">Trang ${st.pageNum}</span>
        ${memberTxt}
        <span class="muted">${valTxt}</span>
        <span class="spacer"></span>
        <button class="btn sm pick" data-p="${st.pageNum}">🎯 Chọn ô khác</button>
      </div>
      <div class="canvas-wrap"><canvas></canvas><div class="overlay"></div></div>`;
    wrap.appendChild(el);

    // render canvas
    const canvas = el.querySelector('canvas');
    const vp = st.page.getViewport({ scale: st.scale });
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    canvas.style.width = canvas.width + 'px';
    await st.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

    drawOverlay(st, el);
    el.querySelector('.pick').addEventListener('click', () => togglePick(st, el));
  }

  $('#review-summary').textContent = `${willChange} trang đổi số · ${same} giữ nguyên · ${skipped} chưa dò`;
  $('#btn-export').disabled = !S.pages.some((st) => st.targets.some((t) => t.enabled && String(t.old) !== String(t.newVal)));
  checkWarnings();
}

// Vẽ các ô tô sáng (target đã dò) lên overlay của 1 trang.
function drawOverlay(st, el) {
  const ov = el.querySelector('.overlay');
  ov.innerHTML = '';
  for (const t of st.targets) {
    const changed = String(t.old) !== String(t.newVal);
    const b = document.createElement('div');
    b.className = 'box' + (t.enabled ? '' : ' off') + (changed ? '' : ' same');
    const s = st.scale;
    Object.assign(b.style, {
      left: (t.box.x * s - 3) + 'px', top: (t.box.y * s - 3) + 'px',
      width: (t.box.w * s + 6) + 'px', height: (t.box.h * s + 6) + 'px',
    });
    b.innerHTML = `<span class="lbl">${esc(t.old)} → ${esc(t.newVal)}</span>`;
    b.title = 'Bấm để bật/tắt cập nhật ô này';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      t.enabled = !t.enabled;
      drawOverlay(st, el);
      refreshExport();
    });
    ov.appendChild(b);
  }
}

// Chế độ "Chọn ô khác": hiện MỌI số nguyên trên trang, click 1 số để đặt làm target.
function togglePick(st, el) {
  const ov = el.querySelector('.overlay');
  const on = el.classList.toggle('picking');
  el.querySelector('.pick').textContent = on ? '✓ Xong' : '🎯 Chọn ô khác';
  if (!on) { drawOverlay(st, el); return; }
  ov.innerHTML = '';
  const s = st.scale;
  for (const it of st.items) {
    if (!INT_RE.test(it.s)) continue;
    const b = document.createElement('div');
    b.className = 'box cand';
    Object.assign(b.style, {
      left: (it.x * s - 2) + 'px', top: (it.y * s - 2) + 'px',
      width: (it.w * s + 4) + 'px', height: (it.h * s + 4) + 'px',
    });
    b.innerHTML = `<span class="lbl">${esc(it.s)}</span>`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const raw = st.member ? String((S.map.get(norm(st.member)) || {}).value ?? it.s) : it.s;
      const nv = fmt(raw);
      st.targets = [{ kind: 'separate', box: it, old: it.s, newVal: nv, member: st.member || '(thủ công)', enabled: true, conf: 'manual' }];
      el.classList.remove('picking');
      el.querySelector('.pick').textContent = '🎯 Chọn ô khác';
      // cập nhật dòng tiêu đề
      const head = el.querySelector('.page-head .muted');
      if (head) head.innerHTML = `→ <b class="new">${esc(nv)}</b>`;
      drawOverlay(st, el);
      refreshExport();
    });
    ov.appendChild(b);
  }
}

function refreshExport() {
  let willChange = 0, same = 0, skipped = 0;
  for (const st of S.pages) {
    const en = st.targets.filter((t) => t.enabled);
    if (!en.length) { skipped++; continue; }
    if (en.some((t) => String(t.old) !== String(t.newVal))) willChange++; else same++;
  }
  $('#review-summary').textContent = `${willChange} trang đổi số · ${same} giữ nguyên · ${skipped} chưa dò`;
  $('#btn-export').disabled = !S.pages.some((st) => st.targets.some((t) => t.enabled && String(t.old) !== String(t.newVal)));
}

function checkWarnings() {
  const el = $('#warnings');
  const w = [];
  const noMark = S.pages.filter((st) => !st.member);
  if (noMark.length) w.push(`Trang ${noMark.map((s) => s.pageNum).join(', ')}: không tìm thấy member khớp Excel. Kiểm tra lại mã hoặc dùng “Chọn ô khác”.`);
  const markNoNum = S.pages.filter((st) => st.member && !st.targets.length);
  if (markNoNum.length) w.push(`Trang ${markNoNum.map((s) => s.pageNum).join(', ')}: có member nhưng chưa dò được số cạnh mã — bấm “Chọn ô khác” để chỉ định.`);
  if (!w.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = '<b>⚠️ Cần chú ý:</b><ul>' + w.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>';
}

// ================= EXPORT =================
async function doExport() {
  const btn = $('#btn-export'); btn.disabled = true;
  $('#export-status').innerHTML = '<span class="spinner"></span> Đang tạo PDF…';
  try {
    const doc = await PDFDocument.load(S.pdfBytes.slice(0));
    const font = await doc.embedFont(StandardFonts.HelveticaOblique); // chữ nghiêng để dễ nhận ra chỗ đã sửa
    const pages = doc.getPages();
    let count = 0, touchedPages = 0;
    for (const st of S.pages) {
      let touched = false;
      for (const t of st.targets) {
        if (!t.enabled || String(t.old) === String(t.newVal)) continue;
        const pdfPage = pages[st.pageNum - 1];
        if (t.kind === 'embedded') drawEmbedded(pdfPage, font, st.viewport, t);
        else drawReplacement(pdfPage, font, st.viewport, t);
        count++; touched = true;
      }
      if (touched) touchedPages++;
    }
    const bytes = await doc.save();
    download(bytes, 'shopdrawing_No-Required_updated.pdf');
    $('#export-status').innerHTML = `✅ Đã cập nhật <b>${count}</b> ô trên <b>${touchedPages}</b> trang. File đã tải xuống.`;
  } catch (err) {
    console.error(err);
    $('#export-status').innerHTML = `<span style="color:var(--red)">Lỗi: ${esc(err.message)}</span>`;
  } finally { btn.disabled = false; }
}

// Số là item riêng: che số cũ rồi DÁN CHỒNG số mới NGAY VỊ TRÍ số cũ (canh trái đúng chỗ),
// chỉ thu nhỏ nếu sắp đè lên nhãn "No. Required". Chữ nghiêng (font truyền vào là Oblique).
function drawReplacement(pdfPage, font, vp, t) {
  const b = t.box;
  const [x0, y0] = vp.convertToPdfPoint(b.x, b.y);
  const [x1, y1] = vp.convertToPdfPoint(b.x + b.w, b.y + b.h);
  const left = Math.min(x0, x1), right = Math.max(x0, x1);
  const bottom = Math.min(y0, y1), top = Math.max(y0, y1);
  const w = right - left, h = top - bottom, pad = Math.max(1, h * 0.12);
  pdfPage.drawRectangle({ x: left - pad, y: bottom - pad, width: w + 2 * pad, height: h + 2 * pad, color: rgb(1, 1, 1) });

  // giới hạn phải = mép trái nhãn "No. Required" (nếu biết) để không đè lên nhãn
  let limitR = right + h * 2.5;
  if (t.cellR != null) { const [cr] = vp.convertToPdfPoint(t.cellR, b.y); limitR = cr - h * 0.25; }

  let size = h * 0.98;                                    // xấp xỉ cỡ số cũ
  let tw = font.widthOfTextAtSize(t.newVal, size);
  const availW = Math.max(limitR - left, h);
  if (tw > availW) { size *= availW / tw; }
  // dán chồng: canh trái đúng vị trí số cũ
  pdfPage.drawText(t.newVal, { x: left, y: bottom + h * 0.12, size, font, color: rgb(0, 0, 0) });
}

// Số dính liền "MARK  N": chỉ che phần số cuối, vẽ số mới ngay đó, giữ nguyên phần mã.
function drawEmbedded(pdfPage, font, vp, t) {
  const b = t.box, full = t.fullStr, num = t.num;
  const wFull = font.widthOfTextAtSize(full, 100) || 1;
  const beforeNum = full.slice(0, full.length - num.length);   // phần trước số cuối (gồm space)
  const fracStart = Math.min(0.98, (font.widthOfTextAtSize(beforeNum, 100) / wFull));
  const startXcanvas = b.x + b.w * fracStart;

  const [x0, y0] = vp.convertToPdfPoint(startXcanvas, b.y);
  const [x1, y1] = vp.convertToPdfPoint(b.x + b.w, b.y + b.h);
  const left = Math.min(x0, x1), right = Math.max(x0, x1);
  const bottom = Math.min(y0, y1), top = Math.max(y0, y1);
  const w = right - left, h = top - bottom, pad = Math.max(0.8, h * 0.12);
  pdfPage.drawRectangle({ x: left - pad, y: bottom - pad, width: w + 2 * pad, height: h + 2 * pad, color: rgb(1, 1, 1) });

  let size = h * 0.9;
  let tw = font.widthOfTextAtSize(t.newVal, size);
  const maxW = Math.max(w * 1.3, w + h);
  if (tw > maxW) { size *= maxW / tw; }
  pdfPage.drawText(t.newVal, { x: left + h * 0.08, y: bottom + h * 0.16, size, font, color: rgb(0, 0, 0) });
}

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ================= WIRE UP =================
bindDrop('#drop-excel', '#file-excel', onExcel);
bindDrop('#drop-pdf', '#file-pdf', onPdf);
$('#sel-sheet').addEventListener('change', loadSheet);
$('#sel-header').addEventListener('change', buildColSelectors);
$('#sel-member').addEventListener('change', buildMap);
$('#sel-value').addEventListener('change', buildMap);
$('#btn-export').addEventListener('click', doExport);
