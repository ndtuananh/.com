// POST /api/master  { file: "<base64 .xlsx>" }
// → đọc file Lệnh Sản Xuất (hoặc danh mục), rút DANH SÁCH MÃ CHUẨN (cột TÊN CHI TIẾT) + số lượng (cột Số lượng)
//   để client đối chiếu kết quả OCR. Tự dò cột theo tiêu đề, fallback C/H.

import ExcelJS from 'exceljs';

function cellText(c) {
  const v = c && c.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return '';
  }
  return String(v);
}
function cellNum(c) {
  const v = c && c.value;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof v.result === 'number') return v.result;
  const n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
const norm = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const b64 = String(body.file || body.image || '').replace(/^data:[^,]*,/, '').trim();
    if (!b64) return res.status(400).json({ ok: false, error: 'Thiếu file.' });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(b64, 'base64'));

    // Dò sheet + cột: tìm ô header chứa "TÊN CHI TIẾT" và "SỐ LƯỢNG".
    let ws = null, codeCol = 3, qtyCol = 8, headerRow = 0;
    for (const s of wb.worksheets) {
      const maxR = Math.min(s.rowCount || 0, 60);
      for (let r = 1; r <= maxR && !ws; r++) {
        s.getRow(r).eachCell((cell, col) => {
          if (norm(cellText(cell)).includes('TÊN CHI TIẾT')) { codeCol = col; headerRow = r; ws = s; }
        });
        if (ws) {
          for (let rr = headerRow; rr <= headerRow + 2; rr++) {
            s.getRow(rr).eachCell((cell, col) => {
              if (norm(cellText(cell)).includes('SỐ LƯỢNG')) qtyCol = col;
            });
          }
        }
      }
      if (ws) break;
    }
    if (!ws) ws = wb.worksheets[0];
    if (!ws) return res.status(200).json({ ok: false, error: 'File không đọc được sheet nào.' });

    const items = [];
    const seen = new Set();
    const startR = headerRow ? headerRow + 1 : 1;
    const maxRow = ws.rowCount || 0;
    let blanks = 0;
    for (let r = startR; r <= maxRow; r++) {
      const row = ws.getRow(r);
      const code = cellText(row.getCell(codeCol)).trim();
      // mã hợp lệ: có cả chữ và số, không quá dài, không phải chữ tiêu đề
      const isCode = code && code.length <= 24 && /[A-Za-z]/.test(code) && /\d/.test(code) &&
        !/TÊN|STT|CHI TIẾT|LƯỢNG/i.test(code);
      if (!isCode) { if (items.length) { blanks++; if (blanks > 40) break; } continue; }
      blanks = 0;
      const key = code.toUpperCase().replace(/\s+/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ code, qty: cellNum(row.getCell(qtyCol)) });
    }

    return res.status(200).json({ ok: true, count: items.length, codeCol, qtyCol, items });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
}
