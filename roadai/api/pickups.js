/* ══════════════════════════════════════════════════════════════════════════════
   RoadAI · Driver Radar — /api/pickups   ★ NGUỒN SỰ THẬT DUY NHẤT ★

   Đồng bộ dữ liệu NGHIỆP VỤ của một tài xế giữa TẤT CẢ các máy của người đó:
       · picks   điểm đón tự nạp  + bằng chứng (bao nhiêu cuốc thật ở đó)
       · trips   NHẬT KÝ CUỐC THẬT  ← thêm 12/08/2026, đây là thứ nuôi AI
       · hidden  điểm đã báo đóng cửa / sai

   VÌ SAO PHẢI THÊM `trips` (lỗi kiến trúc của bản cũ):
     Điểm tự nạp thì đồng bộ, nhưng NHẬT KÝ CUỐC — thứ quan trọng nhất, thứ AI học —
     lại chỉ nằm trong localStorage của MỘT máy. Anh Long ghi 40 cuốc ở máy A thì máy B
     vẫn ngu như ngày đầu, và hai máy đưa ra hai đề xuất khác nhau cho cùng một chỗ
     đứng. Vi phạm thẳng nguyên tắc "một người cập nhật — mọi thiết bị đều thấy".

   KHO: Postgres  public.butl_sync  (khoá chính: code + device).
   MỖI MÁY GIỮ ĐÚNG MỘT DÒNG của riêng nó → 2 máy ghi cùng lúc KHÔNG đè nhau.
   Máy chủ GỘP các dòng khi đọc. Toàn bộ một lần POST = MỘT lệnh upsert = nguyên tử (§24).

   LUẬT GỘP (cố định — máy nào gọi cũng ra y hệt, có 'rev' để tự kiểm chứng):
     · picks: trùng id → bản ts mới nhất thắng về tên/toạ độ; n/win CỘNG DỒN các máy.
              hai điểm cách nhau <55m = MỘT quán → gộp, giữ id cũ nhất (§23).
     · trips: gộp theo `id` (idempotency key sinh tại máy) → gửi lại 10 lần vẫn 1 bản ghi (§25).
     · hidden/xoá: "bia mộ" kèm mốc thời gian → máy nào sửa SAU thì thắng, không hồi sinh bừa.

   BẢO MẬT (§33): bảng bật RLS và CỐ TÌNH không có policy nào → khoá anon (nằm công khai
   trong app) tuyệt đối không đọc/ghi được. Chỉ service_role dùng ở đây (chạy trên máy chủ
   Vercel) mới đi qua được. Frontend chỉ gửi request, máy chủ quyết định quyền.
   Cần đặt trên Vercel:  SUPABASE_URL , SUPABASE_SERVICE_ROLE

   TƯƠNG THÍCH NGƯỢC: nếu cột `trips`/`meta` chưa được thêm vào bảng (chưa chạy
   supabase/schema.sql bản mới), API tự lùi về bộ cột cũ và trả `tripsReady:false`.
   App vẫn chạy y như trước, không hỏng gì — chỉ là chưa học chung được.
   ══════════════════════════════════════════════════════════════════════════════ */
export const config = { maxDuration: 30 };

const CODE_RE = /^[A-Z0-9]{6,16}$/;
const DEV_RE = /^[a-z0-9]{6,24}$/;
const CATS = new Set(['phonhau', 'beerclub', 'bar', 'karaoke', 'nhahang', 'sanbong', 'vanphong', 'tieccuoi', 'diemdon']);
const MAX_PICKS = 500, MAX_HIDDEN = 3000, MAX_DEVICES = 12;
const MAX_TRIPS_DEV = 1000;    // giữ tối đa 1000 cuốc/máy trong kho
const MAX_TRIPS_OUT = 900;     // trả về tối đa 900 cuốc gần nhất (giữ payload 4G nhẹ)
const MAX_ZONES = 16;          // sổ khu của cả tài khoản (mỗi máy tự chọn 6 khu gần nó nhất)
const R = 6371000, toR = d => d * Math.PI / 180;
function hav(a1, o1, a2, o2) { const dLat = toR(a2 - a1), dLng = toR(o2 - o1); const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a1)) * Math.cos(toR(a2)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h.toString(36).toUpperCase().padStart(7, '0').slice(-7); }
const revOf = o => fnv(JSON.stringify(o));

const num = (v, lo, hi) => { const n = +v; return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const str = (v, max) => String(v == null ? '' : v).split('').filter(c => { const n = c.charCodeAt(0); return n >= 32 && n !== 127; }).join('').trim().slice(0, max);

/* ---------------- LỌC SẠCH DỮ LIỆU MÁY GỬI LÊN (không tin bừa cái gì từ ngoài) --------------- */
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
/* MỘT CUỐC = một sự kiện bất biến. Chỉ giữ đúng những trường AI cần, cắt sạch phần
   thừa (tên dài, id nội bộ của máy) để gói dữ liệu qua 4G còn nhẹ.
   `id` là IDEMPOTENCY KEY do máy sinh: gửi lại bao nhiêu lần cũng chỉ ra 1 bản ghi. */
function cleanTrip(t) {
  if (!t || typeof t !== 'object') return null;
  const id = str(t.id, 32).replace(/[^a-zA-Z0-9_-]/g, ''); if (!id) return null;
  const ts = num(t.ts, 0, 4e12); if (ts == null) return null;
  const key = str(t.key, 130); if (!key) return null;
  const o = { id, ts, key,
    cat: CATS.has(t.cat) ? t.cat : 'phonhau',
    quan: str(t.quan, 40),
    hour: Math.max(0, Math.min(23, Math.round(num(t.hour, 0, 23.99) || 0))),
    band: ['chieu', 'toi', 'vang', 'khuya', 'ngoai'].includes(t.band) ? t.band : '',
    win: t.win ? 1 : 0 };
  if (t.type === 'dong') { o.type = 'dong'; o.win = 0; }
  if (t.xe === 'oto' || t.xe === 'may') o.xe = t.xe;
  const p = num(t.p, 0, 1); if (p != null) o.p = +p.toFixed(3);
  return o;
}
function cleanMeta(m) {
  if (!m || typeof m !== 'object') return null;
  return { app: str(m.app, 32), platform: str(m.platform, 24), seen: num(m.seen, 0, 4e12) || Date.now(),
    // MÃ BẢN danh sách quán dùng chung máy đó đang chạy + lúc nó lấy về. Máy nào thấy
    // máy khác có mã KHÁC mà MỚI HƠN thì tự đi lấy lại ngay, khỏi đợi hết 30 phút.
    srev: str(m.srev, 12), sat: num(m.sat, 0, 4e12) || 0 };
}
/* MỘT KHU ĐÃ NẠP — chỉ THÔNG TIN KHU, không kèm danh sách quán.
   Quán lấy từ /api/quanh theo đúng ô lưới này: mọi máy hỏi cùng ô → cùng bản chụp
   CDN → cùng MÃ BẢN. Đồng bộ cái ô lưới là đủ, và gói dữ liệu nhẹ hơn ~100 lần. */
function cleanZone(z) {
  if (!z || typeof z !== 'object') return null;
  const key = str(z.key, 24); if (!/^-?\d+\.\d+,-?\d+\.\d+$/.test(key)) return null;
  const lat = num(z.lat, 8.0, 24.0), lng = num(z.lng, 102.0, 110.5);
  if (lat == null || lng == null) return null;
  return { key, ten: str(z.ten, 60), lat: +lat.toFixed(2), lng: +lng.toFixed(2),
    r: Math.max(1000, Math.min(8000, Math.round(num(z.r, 0, 8000) || 4000))),
    ts: num(z.ts, 0, 4e12) || 0, del: z.del ? 1 : 0,
    rev: str(z.rev, 12), n: Math.max(0, Math.min(999, Math.round(num(z.n, 0, 999) || 0))) };
}

/* ---------------- GỘP (thứ tự cố định để mọi máy nhận cùng một chuỗi byte) --------------- */
function merge(files) {
  /* ---- ĐIỂM TỰ NẠP ---- */
  const byId = new Map();
  for (const f of files) for (const p of (f.picks || [])) {
    const cur = byId.get(p.id);
    if (!cur) { byId.set(p.id, { ...p }); continue; }
    cur.n += p.n; cur.win += p.win;                    // mỗi máy ghi cuốc khác nhau → cộng dồn
    cur.oto += p.oto; cur.may += p.may; cur.dong += p.dong;
    if (p.ts > cur.ts) { cur.name = p.name; cur.cat = p.cat; cur.lat = p.lat; cur.lng = p.lng; cur.quan = p.quan; cur.del = p.del; cur.ts = p.ts; }
  }
  const all = [...byId.values()].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Gộp theo khoảng cách: 2 điểm <55m là cùng một quán (GPS lệch, hoặc 2 máy tự nạp cùng chỗ)
  const auto = s => /^★ Nổ cuốc|^★ Điểm đón|^Điểm đón của tôi/.test(s || '');
  const kept = [], tomb = [];
  for (const p of all) {
    const hit = kept.find(k => hav(k.lat, k.lng, p.lat, p.lng) < 55);
    if (!hit) { kept.push({ ...p }); continue; }
    hit.n += p.n; hit.win += p.win; hit.oto += p.oto; hit.may += p.may; hit.dong += p.dong;
    if (auto(hit.name) && !auto(p.name)) hit.name = p.name;   // tên thật thắng tên máy tự đặt
    if (p.del && p.ts > hit.ts) hit.del = 1;
    if (p.id !== hit.id) tomb.push({ id: p.id, into: hit.id });   // máy khác biết mà xoá bản trùng
  }
  for (const p of kept) if (p.del) tomb.push({ id: p.id, into: null });

  /* ---- ĐIỂM ẨN (last-write-wins theo mốc thời gian) ---- */
  const hid = new Map();
  for (const f of files) for (const h of (f.hidden || [])) {
    const cur = hid.get(h.k);
    if (!cur || h.ts > cur.ts) hid.set(h.k, h);
  }

  /* ---- CUỐC THẬT: gộp theo id. Gắn kèm `dev` để máy con biết cuốc nào của mình
         (máy con đã cộng cuốc của nó vào não rồi, cộng lần nữa là phồng số). ---- */
  const tri = new Map();
  for (const f of files) for (const t of (f.trips || [])) {
    if (!tri.has(t.id)) tri.set(t.id, { ...t, dev: f.dev });
  }
  const trips = [...tri.values()].sort((a, b) => b.ts - a.ts || (a.id < b.id ? -1 : 1)).slice(0, MAX_TRIPS_OUT);

  /* ---- KHU ĐÃ NẠP: gộp theo ô lưới, bản ts MỚI NHẤT thắng (kể cả bản xoá).
         Máy nào nạp được khu nào là cả tài khoản có khu đó — không bắt từng máy
         phải tự chạy tới nơi mới có dữ liệu. ---- */
  const zon = new Map();
  for (const f of files) for (const z of (f.zones || [])) {
    const cur = zon.get(z.key);
    if (!cur || z.ts > cur.ts) zon.set(z.key, z);
  }
  const zones = [...zon.values()].filter(z => !z.del)
    .sort((a, b) => b.ts - a.ts).slice(0, MAX_ZONES)
    .sort((a, b) => (a.key < b.key ? -1 : 1));

  /* ---- THIẾT BỊ: ai đang dùng chung tài khoản này, chạy bản nào, online lúc nào.
         Chỉ dùng cho màn Chẩn đoán (§36) và để lan truyền MÃ BẢN danh sách quán. ---- */
  const devs = files.filter(f => f.meta).map(f => ({ dev: f.dev, ...f.meta }))
    .sort((a, b) => (a.dev < b.dev ? -1 : 1));

  const cmp = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    picks: kept.filter(p => !p.del).sort(cmp),
    tomb: tomb.sort(cmp).filter((t, i, a) => i === 0 || t.id !== a[i - 1].id),
    hidden: [...hid.values()].filter(h => h.on).map(h => h.k).sort(),
    trips, zones, devs,
  };
}

/* ---------------- SUPABASE (PostgREST, service_role nên đi xuyên RLS) ---------------- */
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
/* Bảng chưa có cột mới thì Postgres kêu 42703. Bắt đúng lỗi đó để lùi về bộ cột cũ —
   app cũ vẫn chạy bình thường, chỉ mất phần học chung, và nói thật ra `tripsReady:false`. */
const thieuCot = txt => /42703|does not exist|column .* of relation/i.test(String(txt || ''));
let COT_MOI = true;   // nhớ trong tiến trình, khỏi thử đi thử lại mỗi request

/* Gọi một câu SQL; nếu Postgres kêu THIẾU CỘT (42703) thì hạ cờ COT_MOI rồi thử lại
   bằng bộ cột cũ. Nhờ vậy bảng chưa chạy migration vẫn chạy y như trước, không hỏng. */
async function sbTry(fnMoi, fnCu) {
  let r = await (COT_MOI ? fnMoi() : fnCu());
  if (r.ok) return r;
  const txt = await r.text();
  if (COT_MOI && thieuCot(txt)) { COT_MOI = false; r = await fnCu(); if (r.ok) return r; }
  throw new Error('supabase_loi_' + r.status + '_' + txt.slice(0, 90));
}
async function readAll(code) {
  const q = c => '/' + TABLE + '?code=eq.' + encodeURIComponent(code) + '&select=' + c + '&limit=' + MAX_DEVICES;
  const r = await sbTry(
    () => sbFetch(q('device,picks,hidden,trips,meta,zones'), { headers: sbHeaders() }),
    () => sbFetch(q('device,picks,hidden'), { headers: sbHeaders() }));
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).map(x => ({
    dev: str(x.device, 24),
    picks: (Array.isArray(x.picks) ? x.picks : []).map(cleanPick).filter(Boolean),
    hidden: (Array.isArray(x.hidden) ? x.hidden : []).map(cleanHidden).filter(Boolean),
    trips: (Array.isArray(x.trips) ? x.trips : []).map(cleanTrip).filter(Boolean),
    zones: (Array.isArray(x.zones) ? x.zones : []).map(cleanZone).filter(Boolean),
    meta: cleanMeta(x.meta),
  })).sort((a, b) => (a.dev < b.dev ? -1 : a.dev > b.dev ? 1 : 0));   // thứ tự cố định → rev ổn định
}
/* HỎI RẺ: chỉ lấy mốc thời gian các dòng để biết "có gì mới không". Không gộp, không
   trả nội dung → máy con hỏi 12 giây/lần vẫn không tốn 4G của tài xế. */
async function readTag(code) {
  const r = await sbFetch('/' + TABLE + '?code=eq.' + encodeURIComponent(code) + '&select=device,updated_at&limit=' + MAX_DEVICES, { headers: sbHeaders() });
  if (!r.ok) throw new Error('supabase_doc_loi_' + r.status);
  const rows = await r.json();
  const a = (Array.isArray(rows) ? rows : []).map(x => str(x.device, 24) + '@' + String(x.updated_at || '')).sort();
  return { tag: fnv(a.join('|')), devices: a.length };
}
/* Ghi đè ĐÚNG dòng của máy này (khoá chính code+device) — máy khác không đụng tới.
   Một lệnh upsert = một giao dịch = nguyên tử (§24): không có chuyện lưu được nửa vời. */
async function writeOne(code, dev, row) {
  const put = extra => sbFetch('/' + TABLE + '?on_conflict=code,device', {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([Object.assign(
      { code, device: dev, picks: row.picks, hidden: row.hidden, updated_at: new Date().toISOString() }, extra)]),
  });
  await sbTry(() => put({ trips: row.trips, meta: row.meta, zones: row.zones }), () => put({}));
}

function reply(res, files, extra) {
  const m = merge(files);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true, store: 'supabase', rev: revOf(m), devices: files.length,
    tripsReady: COT_MOI, ...m, ...(extra || {}), updatedAt: new Date().toISOString(),
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SB_URL() || !SB_KEY()) return res.status(200).json({ ok: false, reason: 'supabase_chua_cau_hinh' });
  const q = req.query || {};
  const code = str(q.code, 16).toUpperCase();
  if (!CODE_RE.test(code)) return res.status(200).json({ ok: false, reason: 'ma_tai_xe_khong_hop_le' });

  try {
    // ① HỎI RẺ — "dữ liệu có đổi không?" Máy con hỏi câu này 12 giây/lần.
    if (req.method === 'GET' && q.probe) {
      const t = await readTag(code);
      return res.status(200).json({ ok: true, ...t, tripsReady: COT_MOI });
    }
    // ② KÉO BẢN ĐẦY ĐỦ
    if (req.method === 'GET') {
      const files = await readAll(code);
      const t = await readTag(code).catch(() => ({ tag: null }));
      return reply(res, files, { tag: t.tag });
    }
    // ③ ĐẨY LÊN — một lệnh upsert, nguyên tử. Gửi lại 2 lần không đẻ bản ghi trùng.
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      if (!body || typeof body !== 'object') return res.status(200).json({ ok: false, reason: 'body_hong' });
      const dev = str(body.deviceId, 24).toLowerCase();
      if (!DEV_RE.test(dev)) return res.status(200).json({ ok: false, reason: 'ma_may_khong_hop_le' });

      const picks = (Array.isArray(body.picks) ? body.picks : []).map(cleanPick).filter(Boolean).slice(0, MAX_PICKS);
      const hidden = (Array.isArray(body.hidden) ? body.hidden : []).map(cleanHidden).filter(Boolean).slice(0, MAX_HIDDEN);
      const gui = (Array.isArray(body.trips) ? body.trips : []).map(cleanTrip).filter(Boolean);
      const zones = (Array.isArray(body.zones) ? body.zones : []).map(cleanZone).filter(Boolean).slice(0, MAX_ZONES);
      const meta = cleanMeta(body.device) || cleanMeta({});

      /* Cuốc thì HỢP NHẤT vào những gì dòng này đã có, không ghi đè.
         Máy chỉ cần gửi phần CHƯA gửi (delta) → gói nhẹ, mà gửi trùng cũng vô hại vì
         gộp theo id. Muốn gửi lại toàn bộ thì đặt tripsFull:true (dùng khi máy nghi
         máy chủ mất dòng của mình). */
      const truoc = await readAll(code);
      const mine = truoc.find(f => f.dev === dev);
      const cu = (!body.tripsFull && mine) ? mine.trips : [];
      const map = new Map();
      for (const t of cu.concat(gui)) if (!map.has(t.id)) map.set(t.id, t);
      const trips = [...map.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_TRIPS_DEV);

      await writeOne(code, dev, { picks, hidden, trips, zones, meta });
      // Postgres ghi xong đọc lại là thấy ngay → trả bản GỘP MỚI NHẤT luôn cho chắc.
      const files = await readAll(code);
      const t = await readTag(code).catch(() => ({ tag: null }));
      return reply(res, files, { tag: t.tag, saved: picks.length, mineTrips: trips.length });
    }
    return res.status(405).json({ ok: false, reason: 'method' });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: String((e && e.message) || e).slice(0, 160) });
  }
}

/* Xuất ra để bộ thử (scripts/test-sync.mjs) chạy thẳng luật gộp, không cần máy chủ.
   Luật gộp mà sai thì mọi máy sai theo — phải thử được nó một cách độc lập. */
export { merge, cleanPick, cleanTrip, cleanHidden, cleanZone };
