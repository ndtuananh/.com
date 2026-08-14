/* ══════════════════════════════════════════════════════════════════════════════
   RoadAI · Driver Radar — /api/quan
   DANH SÁCH QUÁN NHẬU BỔ SUNG (chủ app cung cấp) — ONLINE 24/7, KHÔNG BAO GIỜ CHẾT.

   BA LỚP, hụt lớp này thì rơi xuống lớp dưới, không có đường nào trả về rỗng:

     ① SUPABASE  public.quan_bo   — nguồn sự thật, sửa được không cần deploy
             ↓ (kho ngủ / mất kết nối / chưa cài)
     ② BẢN TĨNH  api/_quanbo.js   — nằm ngay trong mã nguồn đã deploy, luôn có
             ↓ (khách hàng mất mạng)
     ③ CACHE     localStorage máy tài xế (xem js/positioning.js)

   Kho Supabase gói free có ngủ thì lớp ② vẫn phục vụ đủ; app chỉ mất khả năng
   NHẬN SỬA ĐỔI MỚI, chứ tài xế không bao giờ mở ra thấy bản đồ trống.
   Trả kèm `nguon` và `tuoi` để màn Chẩn đoán nói thật đang chạy lớp nào.

   CDN giữ 6 tiếng: mọi máy trong khoảng đó nhận CÙNG một bản chụp, cùng MÃ BẢN —
   đúng nguyên tắc "hai máy cùng mã bản = chắc chắn cùng dữ liệu".
   ══════════════════════════════════════════════════════════════════════════════ */
export const config = { maxDuration: 20 };
import { QUANBO, QUANBO_REV, QUANBO_SO } from './_quanbo.js';

const SB_URL = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h.toString(36).toUpperCase().padStart(7, '0').slice(-7); }
// thứ tự CỐ ĐỊNH → hai máy hỏi cùng lúc luôn nhận cùng chuỗi byte, cùng mã bản
const canon = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || a[2] - b[2] || a[3] - b[3];
const num = v => { const n = +v; return Number.isFinite(n) ? n : null; };
const NHOM = new Set(['phonhau', 'beerclub', 'bar', 'karaoke', 'nhahang', 'tieccuoi', 'sanbong', 'vanphong']);

/* Một dòng quán, ĐÚNG định dạng dòng của /api/spots để chạy chung một thang điểm P.
   [tên, nhóm, lat, lng, size, homeKm, quận, nguồn, pid, địa chỉ, prec, evi, giờ mở, giờ đóng] */
function dong(r) {
  const la = num(r.lat), lo = num(r.lng);
  if (la == null || lo == null || la < 8 || la > 23.6 || lo < 102 || lo > 110) return null;
  const ten = String(r.ten || '').trim(); if (!ten) return null;
  return [ten, NHOM.has(r.nhom) ? r.nhom : 'phonhau', +la.toFixed(5), +lo.toFixed(5),
    Math.max(4, Math.min(20, Math.round(num(r.size) || 9))), 7,
    String(r.quan || '').slice(0, 40), 'ds', null,
    String(r.dia_chi || '').slice(0, 120), String(r.prec || '').slice(0, 24), '',
    num(r.gio_mo), num(r.gio_dong)];
}

async function tuSupabase() {
  if (!SB_URL() || !SB_KEY()) return null;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
  try {
    const k = SB_KEY();
    const r = await fetch(SB_URL() + '/rest/v1/quan_bo?select=ten,nhom,lat,lng,size,quan,dia_chi,prec,gio_mo,gio_dong&limit=2000', {
      headers: { apikey: k, Authorization: 'Bearer ' + k }, signal: ctl.signal, cache: 'no-store',
    });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length < 10) return null;   // ít bất thường → giữ bản tĩnh
    const spots = rows.map(dong).filter(Boolean).sort(canon);
    return spots.length >= 10 ? spots : null;
  } catch (e) { return null; } finally { clearTimeout(to); }
}

export default async function handler(req, res) {
  const t0 = Date.now();
  let spots = await tuSupabase(), nguon = 'supabase';
  if (!spots) { spots = QUANBO.slice().sort(canon); nguon = 'ban-tinh'; }
  const rev = fnv(JSON.stringify(spots));
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=604800');
  res.setHeader('ETag', '"' + rev + '"');
  if ((req.headers['if-none-match'] || '').includes(rev)) return res.status(304).end();
  return res.status(200).json({
    ok: true, rev, nguon, count: spots.length,
    coGio: spots.filter(s => s[13] != null).length,          // quán có GIỜ ĐÓNG THẬT
    banTinh: { rev: QUANBO_REV, so: QUANBO_SO },
    spots, ms: Date.now() - t0, updatedAt: new Date().toISOString(),
  });
}
