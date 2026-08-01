/* RoadAI · Driver Radar — TẦNG DỮ LIỆU GOOGLE PLACES (Places API mới, v1).
   ─────────────────────────────────────────────────────────────────────────────
   VÌ SAO THÊM: OpenStreetMap ở TP.HCM thiếu quán nhậu/karaoke, VietMap thì tra
   được tên cho ~15% quán. Google Places là kho quán đầy đủ nhất Việt Nam, lại có
   3 thứ app đang phải ĐOÁN:
     · GIỜ ĐÓNG CỬA THẬT  → thay cho giờ tan quán ước lượng theo nhóm quán.
     · ĐÓNG CỬA VĨNH VIỄN → tự xoá quán chết khỏi bản đồ.
     · SỐ SAO / SỐ LƯỢT ĐÁNH GIÁ → quán đông thật hay vắng.

   Chuẩn gọi: REST Places API (New) — https://places.googleapis.com/v1/…
   (tham khảo googlemaps/openapi-specification; ở đây gọi thẳng bằng fetch cho nhẹ,
   không kéo thêm thư viện vào hàm serverless).
   Bắt buộc có header X-Goog-FieldMask, chỉ xin đúng trường cần → rẻ hơn nhiều.

   ⚠️ ĐIỀU KHOẢN GOOGLE (phải biết trước khi bật ở bản thương mại):
     · Nội dung Places chỉ được hiển thị KÈM BẢN ĐỒ GOOGLE, không được vẽ lên nền
       bản đồ khác (app đang dùng nền VietMap/OSM). Muốn dùng hợp lệ: đổi nền bản đồ
       sang Google Maps, HOẶC chỉ dùng Places để đối chiếu nội bộ.
     · Chỉ được lưu lâu dài `place_id`; nội dung khác (tên/giờ/sao) cache tối đa 30 ngày.
     · Phải ghi nguồn "Powered by Google" ở chỗ hiển thị dữ liệu đó.
   App đã ghi rõ nguồn tên từng điểm; bộ đệm chỉ giữ tên + địa chỉ, và làm mới liên tục.

   BẬT: đặt biến môi trường GOOGLE_MAPS_API_KEY trên Vercel (bật Places API (New)
   trong Google Cloud Console + gắn hạn mức để không cháy tiền). Không có key thì
   toàn bộ file này ngủ, app chạy y như cũ bằng VietMap. */

const ENV = (globalThis.process && globalThis.process.env) || {};
export const G_KEY = () => (ENV.GOOGLE_MAPS_API_KEY || ENV.GOOGLE_PLACES_API_KEY || '').trim();

const MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.shortFormattedAddress',
  'places.location', 'places.businessStatus', 'places.primaryType', 'places.types',
  'places.rating', 'places.userRatingCount', 'places.regularOpeningHours.periods',
].join(',');

async function gPost(path, body, ms) {
  const key = G_KEY(); if (!key) return null;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), ms || 5000);
  try {
    const r = await fetch('https://places.googleapis.com/v1/' + path, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': MASK },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(to); }
}

/* Tìm đúng quán theo TÊN, quanh toạ độ mình có (bán kính mặc định 500m). */
export async function timTheoTen(ten, lat, lng, banKinh, ms) {
  const j = await gPost('places:searchText', {
    textQuery: String(ten || '').slice(0, 120),
    languageCode: 'vi', regionCode: 'VN', maxResultCount: 3,
    locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: banKinh || 500 } },
  }, ms);
  return (j && Array.isArray(j.places)) ? j.places : [];
}

/* Quét quán THẬT quanh một điểm — dùng để bổ sung quán OSM còn thiếu.
   Nhóm Google: bar / night_club / restaurant. Karaoke Google không có nhóm riêng
   nên tìm bằng chữ (searchText) ở hàm dưới. */
export async function quanhDay(lat, lng, banKinh, nhom, ms) {
  const j = await gPost('places:searchNearby', {
    includedTypes: nhom && nhom.length ? nhom : ['bar', 'night_club', 'restaurant'],
    maxResultCount: 20, languageCode: 'vi', rankPreference: 'POPULARITY',
    locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: banKinh || 900 } },
  }, ms);
  return (j && Array.isArray(j.places)) ? j.places : [];
}
export async function timTheoChu(chu, lat, lng, banKinh, ms) {
  const j = await gPost('places:searchText', {
    textQuery: chu, languageCode: 'vi', regionCode: 'VN', maxResultCount: 20,
    locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: banKinh || 1500 } },
  }, ms);
  return (j && Array.isArray(j.places)) ? j.places : [];
}

/* ===== Đọc dữ liệu trả về ===== */
export const tenCua = p => (p && p.displayName && p.displayName.text) || '';
export const viTriCua = p => (p && p.location) ? { lat: p.location.latitude, lng: p.location.longitude } : null;
export const dongVinhVien = p => p && p.businessStatus === 'CLOSED_PERMANENTLY';

/* Địa chỉ gọn: bỏ ", Việt Nam" và phần "Thành phố Hồ Chí Minh" cho đỡ dài. */
export function diaChiCua(p) {
  const a = (p && (p.shortFormattedAddress || p.formattedAddress)) || '';
  return a.replace(/,?\s*Việt Nam\s*$/i, '').replace(/,\s*(Thành phố\s*)?Hồ Chí Minh\s*$/i, '').trim();
}

/* GIỜ ĐÓNG CỬA THẬT của hôm nay → số giờ thập phân (23.5 = 23h30, 25 = 01h sáng mai).
   periods[i] = { open:{day,hour,minute}, close:{day,hour,minute} }  · day: 0=CN…6=T7
   Quán mở qua đêm thì close.day là ngày hôm sau → cộng 24 cho khớp cách app tính. */
export function gioDongHomNay(p, thu) {
  const ps = p && p.regularOpeningHours && p.regularOpeningHours.periods;
  if (!Array.isArray(ps) || !ps.length) return null;
  const hn = (thu == null ? new Date().getDay() : thu);
  for (const k of ps) {
    if (!k || !k.open || k.open.day !== hn) continue;
    if (!k.close) return 24;                      // mở 24/24 → coi như tới 24h
    let h = k.close.hour + (k.close.minute || 0) / 60;
    if (k.close.day !== k.open.day) h += 24;      // đóng sau nửa đêm
    return +h.toFixed(2);
  }
  return null;
}
export function gioMoHomNay(p, thu) {
  const ps = p && p.regularOpeningHours && p.regularOpeningHours.periods;
  if (!Array.isArray(ps) || !ps.length) return null;
  const hn = (thu == null ? new Date().getDay() : thu);
  for (const k of ps) if (k && k.open && k.open.day === hn) return +(k.open.hour + (k.open.minute || 0) / 60).toFixed(2);
  return null;
}

/* Nhóm quán của app, suy từ loại của Google + tên. */
export function nhomQuan(p) {
  const t = [].concat(p.primaryType || [], p.types || []).join(' ').toLowerCase();
  const nm = tenCua(p).toLowerCase();
  if (/karaoke|ktv/.test(nm)) return 'karaoke';
  if (/night_club/.test(t)) return 'beerclub';
  if (/\bbar\b|pub|wine_bar/.test(t)) return 'bar';
  if (/bia|beer|nhậu|ốc|nướng|lẩu|hải sản/.test(nm)) return 'phonhau';
  if (/restaurant|food/.test(t)) return 'nhahang';
  return 'phonhau';
}
