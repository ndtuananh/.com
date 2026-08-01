/* RoadAI · Driver Radar — /api/pickups
   ĐỒNG BỘ ĐIỂM TỰ NẠP giữa nhiều máy của CÙNG một tài xế — LƯU TRÊN SUPABASE.

   Vì sao cần: điểm tài xế tự thêm (➕) và bằng chứng "đã nổ bao nhiêu cuốc thật ở đây"
   trước đây chỉ nằm trong localStorage của MỘT máy. Anh Long thêm điểm ở máy A thì máy B
   không bao giờ thấy → 2 máy học 2 kiểu, app không thể khá lên theo cấp số nhân.

   Kho: bảng Postgres  public.butl_sync  (khoá chính: mã tài xế + mã máy).
   MỖI MÁY GIỮ ĐÚNG MỘT DÒNG của riêng nó, máy chủ GỘP các dòng lại khi đọc →
   2 máy ghi cùng lúc không đè nhau. Postgres đọc-sau-ghi là thấy ngay, không trễ
   như kho file (bản trước dùng Vercel Blob bị trả bản cũ vài giây, đã bỏ).

   Quy tắc gộp (cố định, máy nào gọi cũng ra y hệt — có 'rev' để tự kiểm chứng):
   · Mỗi điểm có id riêng. Trùng id → lấy bản ts MỚI NHẤT cho tên/toạ độ/loại.
   · Số cuốc thật (n/win) thì CỘNG DỒN các máy — vì mỗi máy ghi những cuốc khác nhau.
   · Hai điểm cách nhau <55m coi như MỘT quán → gộp làm một, giữ id cũ nhất, cộng dồn cuốc.
   · Xoá/ẩn dùng "bia mộ" kèm mốc thời gian → máy nào sửa sau thì thắng, không hồi sinh bừa.

   Bảo mật: bảng bật RLS và KHÔNG có policy nào → khoá anon (nằm công khai trong app)
   tuyệt đối không đọc/ghi được. Chỉ service_role dùng ở đây (chạy trên máy chủ) đi qua được.
   Cần đặt trên Vercel:  SUPABASE_URL , SUPABASE_SERVICE_ROLE
*/
export const config = { maxDuration: 30 };

const CODE_RE = /^[A-Z0-9]{6,16}$/;
const DEV_RE = /^[a-z0-9]{6,24}$/;
const CATS = new Set(['phonhau', 'beerclub', 'bar', 'karaoke', 'nhahang', 'sanbong', 'vanphong']);
const MAX_PICKS = 500, MAX_HIDDEN = 3000, MAX_DEVICES = 12;
const R = 6371000, toR = d => d * Math.PI / 180;
function hav(a1, o1, a2, o2) { const dLat = toR(a2 - a1), dLng = toR(o2 - o1); const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a1)) * Math.cos(toR(a2)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
function revOf(o) { let h = 0x811c9dc5; const s = JSON.stringify(o); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h.toString(36).toUpperCase().padStart(7, '0').slice(-7); }

const num = (v, lo, hi) => { const n = +v; return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const str = (v, max) => String(v == null ? '' : v).split('').filter(c => { const n = c.charCodeAt(0); return n >= 32 && n !== 127; }).join('').trim().slice(0, max);

// Lọc sạch dữ liệu máy gửi lên — không tin bừa cái gì từ ngoài vào
function cleanPick(p) {
  if (!p || typeof p !== 'object') return null;
  const id = str(p.id, 24).replace(/[^a-zA-Z0-9_-]/g, ''); if (!id) return null;
  const lat = num(p.lat, 8.0, 24.0), lng = num(p.lng, 102.0, 110.5);   // trong lãnh thổ VN
  if (lat == null || lng == null) return null;
  const name = str(p.name, 70) || 'Điểm đón của tôi';
  const cat = CATS.has(p.cat) ? p.cat : 'phonhau';
  const ts = num(p.ts, 0, 4e12) || 0;
  const n = Math.max(0, Math.min(9999, Math.round(num(p.n, 0, 9999) || 0)));
  const win = Math.max(0, Math.min(n, Math.round(num(p.win, 0, 9999) || 0)));
  // oto/may = cuốc thắng theo LOẠI XE; dong = số lần tài xế ghi "quán đang đông" (chưa phải cuốc)
  const oto = Math.max(0, Math.min(win, Math.round(num(p.oto, 0, 9999) || 0)));
  const may = Math.max(0, Math.min(win, Math.round(num(p.may, 0, 9999) || 0)));
  const dong = Math.max(0, Math.min(9999, Math.round(num(p.dong, 0, 9999) || 0)));
  return { id, name, cat, lat: +lat.toFixed(5), lng: +lng.toFixed(5), quan: str(p.quan, 40), ts, del: p.del ? 1 : 0, n, win, oto, may, dong };
}
function cleanHidden(h) {
  if (!h || typeof h !== 'object') return null;
  const k = str(h.k, 130); if (!k) return null;
  return { k, ts: num(h.ts, 0, 4e12) || 0, on: h.on ? 1 : 0 };
}

/* GỘP — thứ tự cố định để 2 máy luôn nhận cùng một chuỗi byte (rev giống nhau) */
function merge(files) {
  const byId = new Map();
  for (const f of files) for (const p of (f.picks || [])) {
    const cur = byId.get(p.id);
    if (!cur) { byId.set(p.id, { ...p }); continue; }
    cur.n += p.n; cur.win += p.win;                    // mỗi máy ghi cuốc khác nhau → cộng dồn
    cur.oto += p.oto; cur.may += p.may; cur.dong += p.dong;
    if (p.ts > cur.ts) { cur.name = p.name; cur.cat = p.cat; cur.lat = p.lat; cur.lng = p.lng; cur.quan = p.quan; cur.del = p.del; cur.ts = p.ts; }
  }
  let all = [...byId.values()].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Gộp theo khoảng cách: 2 điểm <55m là cùng một quán (GPS lệch, hoặc 2 máy tự nạp cùng chỗ)
  const auto = s => /^★ Nổ cuốc|^Điểm đón của tôi/.test(s || '');
  const kept = [], tomb = [];
  for (const p of all) {
    const hit = kept.find(k => hav(k.lat, k.lng, p.lat, p.lng) < 55);
    if (!hit) { kept.push({ ...p }); continue; }
    hit.n += p.n; hit.win += p.win; hit.oto += p.oto; hit.may += p.may; hit.dong += p.dong;
    if (auto(hit.name) && !auto(p.name)) hit.name = p.name;   // tên thật thắng tên tự đặt
    if (p.del && p.ts > hit.ts) hit.del = 1;
    if (p.id !== hit.id) tomb.push({ id: p.id, into: hit.id });   // máy khác biết mà xoá bản trùng
  }
  for (const p of kept) if (p.del) tomb.push({ id: p.id, into: null });

  const hid = new Map();
  for (const f of files) for (const h of (f.hidden || [])) {
    const cur = hid.get(h.k);
    if (!cur || h.ts > cur.ts) hid.set(h.k, h);
  }
  const cmp = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const picks = kept.filter(p => !p.del).sort(cmp);
  return {
    picks,
    tomb: tomb.sort(cmp).filter((t, i, a) => i === 0 || t.id !== a[i - 1].id),
    hidden: [...hid.values()].filter(h => h.on).map(h => h.k).sort(),
  };
}

/* ---------------- SUPABASE (PostgREST, dùng service_role nên đi xuyên RLS) ---------------- */
const SB_URL = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TABLE = 'butl_sync';
function sbHeaders(extra) {
  const k = SB_KEY();
  return Object.assign({ apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }, extra || {});
}
async function sbFetch(path, opts) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
  try { return await fetch(SB_URL() + '/rest/v1' + path, Object.assign({ signal: ctl.signal, cache: 'no-store' }, opts)); }
  finally { clearTimeout(to); }
}
// Đọc mọi dòng của 1 mã tài xế rồi lọc sạch — mỗi máy 1 dòng
async function readAll(code) {
  const r = await sbFetch('/' + TABLE + '?code=eq.' + encodeURIComponent(code) + '&select=device,picks,hidden&limit=' + MAX_DEVICES, { headers: sbHeaders() });
  if (!r.ok) throw new Error('supabase_doc_loi_' + r.status + '_' + (await r.text()).slice(0, 90));
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).map(x => ({
    dev: str(x.device, 24),
    picks: (Array.isArray(x.picks) ? x.picks : []).map(cleanPick).filter(Boolean),
    hidden: (Array.isArray(x.hidden) ? x.hidden : []).map(cleanHidden).filter(Boolean),
  })).sort((a, b) => (a.dev < b.dev ? -1 : a.dev > b.dev ? 1 : 0));   // thứ tự cố định → rev ổn định
}
// Ghi đè ĐÚNG dòng của máy này (khoá chính code+device) — máy khác không đụng tới
async function writeOne(code, dev, picks, hidden) {
  const r = await sbFetch('/' + TABLE + '?on_conflict=code,device', {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{ code, device: dev, picks, hidden, updated_at: new Date().toISOString() }]),
  });
  if (!r.ok) throw new Error('supabase_ghi_loi_' + r.status + '_' + (await r.text()).slice(0, 90));
}

function reply(res, files, extra) {
  const m = merge(files);
  const rev = revOf(m);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, store: 'supabase', rev, devices: files.length, ...m, ...(extra || {}), updatedAt: new Date().toISOString() });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SB_URL() || !SB_KEY()) return res.status(200).json({ ok: false, reason: 'supabase_chua_cau_hinh' });
  const code = str((req.query || {}).code, 16).toUpperCase();
  if (!CODE_RE.test(code)) return res.status(200).json({ ok: false, reason: 'ma_tai_xe_khong_hop_le' });

  try {
    if (req.method === 'GET') return reply(res, await readAll(code));

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      if (!body || typeof body !== 'object') return res.status(200).json({ ok: false, reason: 'body_hong' });
      const dev = str(body.deviceId, 24).toLowerCase();
      if (!DEV_RE.test(dev)) return res.status(200).json({ ok: false, reason: 'ma_may_khong_hop_le' });
      const picks = (Array.isArray(body.picks) ? body.picks : []).map(cleanPick).filter(Boolean).slice(0, MAX_PICKS);
      const hidden = (Array.isArray(body.hidden) ? body.hidden : []).map(cleanHidden).filter(Boolean).slice(0, MAX_HIDDEN);
      await writeOne(code, dev, picks, hidden);
      // Postgres ghi xong đọc lại là thấy ngay (không như kho file), nên đọc thẳng cho chắc.
      return reply(res, await readAll(code), { saved: picks.length });
    }
    return res.status(405).json({ ok: false, reason: 'method' });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: String((e && e.message) || e).slice(0, 160) });
  }
}
