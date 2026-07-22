// ============================================================================
// js/xsmn-store.js — "DATABASE NẠP LIÊN TỤC" cho XSMN, lưu bền trên Vercel Blob.
//
// Mỗi lần /api/xsmn chạy: nạp lịch sử cũ từ Blob → gộp kết quả mới → (khi sync)
// crawl LÙI thêm vài trang theo ngày → lưu lại. Kho lớn dần theo thời gian, phục
// vụ thống kê per-đài & backtest. Dạng nén: mỗi đài chỉ giữ {slug,province,code,de,lo2}.
// ============================================================================
import { list, put } from '@vercel/blob';

const KEY = 'xsmn/history.json';

export async function loadHistory() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { token: null, days: [] };
  try {
    const l = await list({ token, prefix: 'xsmn/' });
    const b = l.blobs.find((x) => x.pathname === KEY);
    if (!b) return { token, days: [] };
    const arr = await (await fetch(b.url)).json();
    return { token, days: Array.isArray(arr) ? arr : [] };
  } catch (_) { return { token, days: [] }; }
}

export async function saveHistory(token, days) {
  if (!token) return false;
  try {
    await put(KEY, JSON.stringify(days), { access: 'public', token, addRandomSuffix: false, contentType: 'application/json' });
    return true;
  } catch (_) { return false; }
}

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
