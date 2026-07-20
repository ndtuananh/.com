// POST /api/export  { items: [ { code, qty } ], filename_hint }
// → load file mẫu (giữ 100% style/formula/merge), ghi 3 cột A/C/H từ dòng START_ROW, trả .xlsx.

import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Cấu hình ánh xạ (khớp SKILL mục 5). Nếu file mẫu thật khác → chỉ sửa 4 dòng này. ──
const SHEET_NAME = process.env.TEMPLATE_SHEET || 'MẪU'; // sheet cần ghi; không thấy thì lấy sheet đầu
const START_ROW = 28;   // item thứ i → dòng (START_ROW - 1 + i)
const COL_STT = 'A';    // STT
const COL_NAME = 'C';   // TÊN CHI TIẾT
const COL_QTY = 'H';    // Số lượng (Tấm)

// Tự tìm file mẫu trong /templates (lấy .xlsx đầu tiên) để anh đặt tên file tùy ý.
function findTemplate() {
  const dir = path.join(__dirname, '..', 'templates');
  let files = [];
  try { files = fs.readdirSync(dir); } catch (_) { return null; }
  const xlsx = files.filter(f => /\.xlsx$/i.test(f) && !f.startsWith('~$'));
  if (!xlsx.length) return null;
  return path.join(dir, xlsx.sort()[0]);
}

const isFormulaCell = (cell) => {
  const v = cell && cell.value;
  return !!(v && typeof v === 'object' && (v.formula != null || v.sharedFormula != null));
};

function sanitizeName(s) {
  return String(s || '').replace(/[^\p{L}\p{N}_.-]+/gu, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items = rawItems
      .map(it => ({ code: String((it && it.code) || '').trim(), qty: Number.parseInt(it && it.qty, 10) }))
      .filter(it => it.code !== '');
    if (!items.length) return res.status(400).json({ ok: false, error: 'Bảng trống — không có dòng nào để xuất.' });

    const tplPath = findTemplate();
    if (!tplPath) {
      return res.status(200).json({
        ok: false,
        error: 'Chưa có file mẫu. Hãy đặt file "LỆNH_VẬT_TƯ...mẫu.xlsx" vào thư mục pictoex/templates/ rồi deploy lại.'
      });
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(tplPath);
    const ws = wb.getWorksheet(SHEET_NAME) || wb.worksheets[0];
    if (!ws) return res.status(200).json({ ok: false, error: 'File mẫu không có sheet nào đọc được.' });

    // Điền số LSX (đọc từ ảnh) vào ô "SỐ:" của form.
    const lsx = String(body.lsx || '').trim().replace(/^lsx[\s:_-]*/i, '');
    if (lsx) {
      const cellStr = (v) => (v && typeof v === 'object')
        ? (v.richText ? v.richText.map(x => x.text).join('') : String(v.text != null ? v.text : ''))
        : String(v == null ? '' : v);
      let done = false;
      for (let r = 1; r <= 8 && !done; r++) {
        ws.getRow(r).eachCell((cell) => {
          if (!done && /^\s*SỐ\s*:/i.test(cellStr(cell.value)) && !isFormulaCell(cell)) {
            cell.value = 'SỐ:  ' + lsx; done = true;
          }
        });
      }
    }

    // GUARD: tuyệt đối không ghi đè ô đang chứa công thức (tránh phá công thức mẫu mà file vẫn "trông đúng").
    for (let i = 0; i < items.length; i++) {
      const row = START_ROW + i;
      for (const col of [COL_STT, COL_NAME, COL_QTY]) {
        if (isFormulaCell(ws.getCell(col + row))) {
          return res.status(200).json({
            ok: false,
            error: 'File mẫu không khớp: ô ' + col + row + ' đang chứa công thức. ' +
              'Kiểm tra lại vị trí bảng (dòng bắt đầu/cột) ở đầu api/export.js — KHÔNG xuất để tránh phá công thức.'
          });
        }
      }
    }

    items.forEach((it, i) => {
      const row = START_ROW + i;
      ws.getCell(COL_STT + row).value = i + 1;
      ws.getCell(COL_NAME + row).value = it.code;
      ws.getCell(COL_QTY + row).value = Number.isFinite(it.qty) ? it.qty : 0;
    });

    // Ép Excel tính lại toàn bộ công thức khi mở file (H/N/L đã đổi).
    wb.calcProperties = wb.calcProperties || {};
    wb.calcProperties.fullCalcOnLoad = true;

    const buf = await wb.xlsx.writeBuffer();
    const hint = sanitizeName(body.filename_hint) || 'LenhSanXuat';
    const fname = 'LenhSanXuat_' + hint + '.xlsx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"; filename*=UTF-8\'\'' + encodeURIComponent(fname));
    return res.status(200).send(Buffer.from(buf));
  } catch (e) {
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
}
