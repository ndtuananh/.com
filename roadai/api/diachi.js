/* ══════════════════════════════════════════════════════════════════════════════
   RoadAI · Driver Radar — /api/diachi?lat=…&lng=…

   Trả ĐỊA CHỈ THẬT của chỗ tài xế đang đứng, để form "➕ Thêm quán" điền sẵn.
   Trước đây form chỉ hiện toạ độ "10.81234, 106.72345" — với tài xế thì chuỗi đó
   vô nghĩa, mà lưu vào kho cũng không ai đối chiếu được sau này.

   HAI NGUỒN, THỬ THEO THỨ TỰ (không có nguồn nào thì nói thẳng, KHÔNG bịa):
     ① VietMap reverse — địa chỉ tiếng Việt sát nhất, có ranh giới phường/quận.
     ② Nominatim (OpenStreetMap) — dự phòng khi VietMap chưa cấu hình key hoặc lỗi.
        Gọi từ MÁY CHỦ và có User-Agent đàng hoàng; gọi thẳng từ trình duyệt sẽ bị
        OSM trả 403 và còn lộ vị trí tài xế cho bên thứ ba.

   Làm tròn toạ độ về 5 chữ số (~1m) trước khi hỏi rồi cache ở CDN 1 ngày: hai máy
   đứng cùng chỗ nhận cùng địa chỉ, và không đốt hạn mức API cho mỗi lần bấm.
   ══════════════════════════════════════════════════════════════════════════════ */
export const config = { maxDuration: 15 };

const trongVN = (la, lo) => la > 8 && la < 23.6 && lo > 102 && lo < 110;
const laPlusCode = t => /^[A-Z0-9]{4,8}\+[A-Z0-9]{2,4}$/i.test(String(t || '').trim());
// Bản đồ đôi khi ghi địa chỉ bằng Plus Code ("7P28RPR4+PG") — vô nghĩa với tài xế, bỏ đi.
const don = a => String(a || '').split(',').map(x => x.trim())
  .filter(x => x && !laPlusCode(x)).join(', ').slice(0, 120);

/* "Có ĐƯỜNG hay chưa": địa chỉ dừng ở cấp phường/quận thì tài xế không dùng được —
   ra tới nơi vẫn không biết đứng ở đâu. Địa chỉ dùng được phải có tên đường
   (kèm số nhà càng tốt). */
const coDuong = a => /(\d+[a-zA-Z]?\/?\d*\s)|(đường|hẻm|phố|ngõ|quốc lộ|tỉnh lộ|đại lộ|khu phố|ấp)\s/i.test(String(a || ''));

async function vietmap(la, lo, host) {
  const KEY = (process.env.VIETMAP_API_KEY || process.env.VIETMAP_KEY || '').trim();
  if (!KEY) return null;
  const u = `https://maps.vietmap.vn/api/reverse/v3?lat=${la}&lng=${lo}&apikey=${KEY}`;
  const r = await fetch(u, { headers: { 'User-Agent': 'RoadAI/1.0 (+https://' + host + ')' } });
  if (!r.ok) return null;
  const j = await r.json();
  const ds = Array.isArray(j) ? j : [];
  if (!ds.length) return null;
  /* Bản đồ trả nhiều lớp: số nhà, con đường, rồi ranh giới phường/quận. Lấy [0] là
     hay vớ phải lớp phường ("Phường 25, Quận Bình Thạnh, TP.HCM") — đúng mà vô dụng.
     Chọn bản ghi CỤ THỂ NHẤT: có tên đường trước, rồi mới tới cái dài nhất. */
  const diaChiCua = f => don(f.address || f.display || f.name);
  const f = ds.find(x => coDuong(diaChiCua(x))) || ds[0];
  const bs = Array.isArray(f.boundaries) ? f.boundaries : [];
  const lay = t => { const b = bs.find(x => x.type === t); return String((b && (b.name || b.full_name)) || '').trim(); };
  let addr = diaChiCua(f);
  // Bản ghi là một POI (tên quán/toà nhà) thì ghép tên vào trước cho dễ nhận ra chỗ đứng
  const ten = String(f.name || '').trim();
  if (ten && !addr.toLowerCase().includes(ten.toLowerCase()) && ten.length <= 40) addr = don(ten + ', ' + addr);
  return { addr, quan: lay(1) || lay(0) || '', nguon: 'vietmap', du: coDuong(addr) };
}
async function osm(la, lo, host) {
  const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${lo}&zoom=18&addressdetails=1&accept-language=vi`;
  const r = await fetch(u, { headers: { 'User-Agent': 'RoadAI/1.0 (+https://' + host + ')' } });
  if (!r.ok) return null;
  const j = await r.json();
  const a = j.address || {};
  const so = [a.house_number, a.road].filter(Boolean).join(' ');
  const ph = a.quarter || a.suburb || a.village || a.town || '';
  const qu = a.city_district || a.county || a.district || a.city || '';
  const addr = don([so, ph, qu].filter(Boolean).join(', ') || j.display_name);
  return addr ? { addr, quan: qu || ph || '', nguon: 'osm', du: coDuong(addr) } : null;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const la0 = parseFloat(q.lat), lo0 = parseFloat(q.lng);
  if (!isFinite(la0) || !isFinite(lo0)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ ok: false, loi: 'Thiếu lat/lng.' }); }
  if (!trongVN(la0, lo0)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ ok: false, loi: 'Toạ độ ngoài Việt Nam.' }); }
  const la = +la0.toFixed(5), lo = +lo0.toFixed(5);
  const host = (req.headers && req.headers.host) || 'roadai-vn.vercel.app';

  /* Thử VietMap trước. Nếu nó chỉ ra tới cấp phường (không có tên đường) thì hỏi
     thêm OpenStreetMap — OSM hay có sẵn số nhà + tên đường. Cái nào CỤ THỂ hơn thì
     lấy; cả hai đều chung chung thì lấy VietMap (tiếng Việt sát hơn). */
  let kq = null, du = null;
  for (const f of [vietmap, osm]) {
    let x = null;
    try { x = await f(la, lo, host); } catch (e) { x = null; }
    if (!x || !x.addr) continue;
    if (x.du) { kq = x; break; }        // đã có tên đường → dùng luôn, khỏi hỏi tiếp
    if (!du) du = x;                     // giữ làm bản dự phòng
  }
  if (!kq) kq = du;
  res.setHeader('Cache-Control', kq ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'no-store');
  if (!kq) return res.status(200).json({ ok: false, lat: la, lng: lo, loi: 'Bản đồ chưa tra được địa chỉ chỗ này — anh gõ tay giúp em.' });
  return res.status(200).json({ ok: true, lat: la, lng: lo, ...kq });
}
