// ============================================================================
// js/xsmn-store.js — "DATABASE NẠP LIÊN TỤC" cho XSMN, lưu bền trên Vercel Blob.
//
// Mỗi lần /api/xsmn chạy: nạp lịch sử cũ từ Blob → gộp kết quả mới → (khi sync)
// crawl LÙI thêm vài trang theo ngày → lưu lại. Kho lớn dần theo thời gian, phục
// vụ thống kê per-đài & backtest. Dạng nén: mỗi đài chỉ giữ {slug,province,code,de,lo2}.
// ============================================================================
import { list, put } from '@vercel/blob';

const KEY = 'xsmn/history.json';
const LEDGER_KEY = 'xsmn/ledger.json';

// Đọc một file JSON trong kho Blob. LUÔN phá cache CDN: Blob URL còn trả bản cũ vài
// giây sau khi ghi đè, không phá thì kho không bao giờ lớn lên được.
async function readBlobJson(token, key, fallback) {
  try {
    const l = await list({ token, prefix: 'xsmn/' });
    const b = l.blobs.find((x) => x.pathname === key);
    if (!b) return fallback;
    const bust = b.url + (b.url.includes('?') ? '&' : '?') + 't=' + Date.now();
    const v = await (await fetch(bust, { cache: 'no-store' })).json();
    return v == null ? fallback : v;
  } catch (_) { return fallback; }
}

// allowOverwrite BẮT BUỘC phải có. @vercel/blob v2 từ chối ghi đè một đường dẫn đã tồn
// tại nếu thiếu cờ này — và vì lỗi bị nuốt im lặng, kho lịch sử đã ĐỨNG YÊN suốt nhiều
// ngày mà không ai biết: app tưởng mình đang tích luỹ dữ liệu, thực tế không lưu được gì.
// Nuốt lỗi mà không kêu là cách chắc chắn nhất để một tính năng chết mà vẫn trông sống.
async function writeBlobJson(token, key, data) {
  if (!token) return false;
  try {
    await put(key, JSON.stringify(data), {
      access: 'public', token, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
    });
    return true;
  } catch (e) {
    console.error(`[xsmn-store] GHI KHO THẤT BẠI ${key}:`, e && e.message);
    return false;
  }
}

export async function loadHistory() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { token: null, days: [] };
  const arr = await readBlobJson(token, KEY, []);
  return { token, days: Array.isArray(arr) ? arr : [] };
}

export const saveHistory = (token, days) => writeBlobJson(token, KEY, days);

// ---------------------------------------------------------------------------
// SỔ CAM KẾT TRƯỚC — bằng chứng không thể ngụy tạo.
//
// Máy ghi số xuống kho khi ngày đó CHƯA CÓ KẾT QUẢ, đóng dấu thời gian. Hôm sau kết
// quả về thì mới chấm. Vì bản ghi đã nằm sẵn trong kho từ trước, không có cách nào
// sửa lại cho đẹp. Đây là khác biệt giữa "backtest tự chấm" (ai cũng làm đẹp được)
// và "dự đoán thật đã công bố trước" (không cãi được).
// ---------------------------------------------------------------------------
export const loadLedger = (token) => readBlobJson(token, LEDGER_KEY, { v: 4, commits: [] })
  .then((l) => (l && Array.isArray(l.commits) ? l : { v: 4, commits: [] }));

export const saveLedger = (token, ledger) => writeBlobJson(token, LEDGER_KEY, ledger);

// Gộp các day-object (đầy đủ) vào lịch sử (nén), khoá theo ngày. Trả {merged, added}.
export function mergeHistory(history, incoming) {
  const map = new Map(history.map((d) => [d.date, d]));
  let added = 0;
  for (const d of incoming) {
    if (!d || !d.date || !d.provinces) continue;
    if (!map.has(d.date)) added++;
    map.set(d.date, {
      date: d.date,
      provinces: d.provinces.map((p) => ({ slug: p.slug, province: p.province, code: p.code || '', de: p.de, lo2: p.lo2 })),
    });
  }
  const merged = [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1)); // mới → cũ
  return { merged, added };
}

// Cộng/trừ ngày cho chuỗi 'YYYY-MM-DD' (UTC, đủ chính xác cho lịch ngày).
export function addDays(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  const dt = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}
