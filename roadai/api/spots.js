/* RoadAI · Driver Radar — /api/spots (Vercel serverless, ESM).
   TỰ CẬP NHẬT: kéo quán THẬT ở TP.HCM từ OpenStreetMap (Overpass API, miễn phí, không key),
   tự chuẩn hoá + TỰ KIỂM (đủ số lượng, toạ độ trong HCM, đúng nhóm) rồi trả JSON.
   Edge-cache 1 ngày (s-maxage) + stale-while-revalidate 7 ngày → luôn nhanh, tự làm mới nền.
   Nguồn: © OpenStreetMap contributors (ODbL).

   ═══ TỰ KIỂM TÊN MỖI NGÀY (thêm 01/08/2026) ═══
   Yêu cầu của anh chủ: "không tự kiểm được thì đừng hiện tên vị trí".
   Trước đây app bê nguyên tên OSM lên bản đồ kèm dòng "CHƯA kiểm chứng" — tức là vẫn
   hiện một cái tên có thể sai (vd "Aeon Mall Bình Tân (nhà hàng)" là tên tự đặt).
   Giờ MỖI LẦN làm mới danh sách (cron 18h VN + khi cache hết hạn), server tự đối chiếu
   từng quán với bản đồ VietMap:
     · Bản đồ CÓ đúng quán tên đó, cách dưới 400m  → nguồn 'osm', GIỮ tên + gắn địa chỉ thật.
     · Bản đồ KHÔNG có                              → nguồn 'osm-addr', BỎ TÊN, tên hiển thị
                                                      thay bằng ĐỊA CHỈ THẬT lấy từ reverse
                                                      geocode ("Quán nhậu · 48 Tên Lửa").
   Không có key VietMap / gọi lỗi / hết giờ → coi như CHƯA kiểm được → vẫn bỏ tên.
   Nghĩa là app không bao giờ hiện một cái tên mà chính nó không tra được. */
export const config = { maxDuration: 60 };
import { FALLBACK } from './_fallback.js';
import { MAPCACHE } from './_mapcache.js';
import { OVERTURE } from './_overture.js';
import { G_KEY, timTheoTen, quanhDay, nhomQuan, tenCua, viTriCua, diaChiCua, dongVinhVien, gioDongHomNay, gioMoHomNay } from './_google.js';

const BB = '10.68,106.55,10.89,106.83';
const Q = `[out:json][timeout:25];
(
  node["amenity"~"^(bar|pub|nightclub|biergarten)$"](${BB});
  way["amenity"~"^(bar|pub|nightclub|biergarten)$"](${BB});
  node["name"~"[Kk]araoke|KTV",i](${BB});
  node["amenity"="restaurant"]["name"~"[Nn]hậu|[Bb]ia hơi|[Bb]eer|Ốc|ốc|[Nn]ướng|[Ll]ẩu|BBQ",i](${BB});
);
out center 700;`;

const CURATED = [
  ['Phố nhậu Đường Tên Lửa', 'phonhau', 10.74406, 106.61316, 16, 5, 'Bình Tân'],
  ['Beer club Aeon Tên Lửa', 'beerclub', 10.74480, 106.61250, 13, 6, 'Bình Tân'],
  ['Aeon Mall Bình Tân (nhà hàng)', 'nhahang', 10.74430, 106.61360, 11, 6, 'Bình Tân'],
  ['Karaoke ICOOL Tên Lửa', 'karaoke', 10.74560, 106.61180, 10, 6, 'Bình Tân'],
  ['Nhậu Đường số 7 (Tên Lửa)', 'phonhau', 10.74630, 106.60980, 11, 5, 'Bình Tân'],
  ['Nhậu Vành Đai Trong', 'phonhau', 10.74250, 106.60760, 10, 6, 'Bình Tân'],
  ['Nhậu Kinh Dương Vương', 'phonhau', 10.74169, 106.61434, 12, 6, 'Bình Tân'],
  ['Vòng xoay An Lạc', 'phonhau', 10.72381, 106.60169, 11, 7, 'Bình Tân'],
  ['Quán quanh Bến xe Miền Tây', 'phonhau', 10.74020, 106.61938, 10, 8, 'Bình Tân'],
  ['Nhậu Tỉnh Lộ 10', 'phonhau', 10.75664, 106.59038, 10, 6, 'Bình Tân'],
  ['Nhậu Võ Văn Kiệt (An Lạc)', 'phonhau', 10.72647, 106.61974, 10, 6, 'Bình Tân'],
  ['Bar/Pub khu Aeon', 'bar', 10.74360, 106.61400, 9, 6, 'Bình Tân'],
  ['Nhậu An Dương Vương (An Lạc)', 'phonhau', 10.74840, 106.62251, 9, 6, 'Bình Tân'],
  ['Ẩm thực đêm Bình Trị Đông', 'phonhau', 10.75637, 106.60828, 10, 5, 'Bình Tân'],
  ['Nhậu Lê Văn Quới', 'phonhau', 10.77617, 106.61128, 11, 6, 'Bình Tân'],
  ['Nhậu Mã Lò', 'phonhau', 10.78810, 106.59956, 9, 6, 'Bình Tân'],
  ['Nhậu Chiến Lược', 'phonhau', 10.76212, 106.60184, 9, 6, 'Bình Tân'],
  ['Karaoke Nnice Kinh Dương Vương', 'karaoke', 10.74050, 106.61600, 9, 6, 'Bình Tân'],
  ['Quán bóng đá khu Tên Lửa', 'sanbong', 10.74300, 106.61120, 11, 5, 'Bình Tân'],
  ['Nhậu Hồ Học Lãm (Ehome)', 'phonhau', 10.72739, 106.60934, 8, 7, 'Bình Tân'],
  ['Nhậu Bà Hom', 'phonhau', 10.76243, 106.59072, 9, 6, 'Bình Tân'],
  ['Nhậu Tân Kỳ Tân Quý', 'phonhau', 10.78954, 106.60187, 9, 7, 'Bình Tân'],
  ['Beer club Bình Phú', 'beerclub', 10.73539, 106.62753, 9, 6, 'Quận 6'],
  ['Nhậu Hương Lộ 2', 'phonhau', 10.77547, 106.59237, 9, 6, 'Bình Tân'],
];

/* ═══ MỘT SỐ HÀM CÓ `export` — DÙNG CHUNG VỚI /api/quanh ═══
   /api/quanh (nạp quán quanh chỗ tài xế đang đứng, ở BẤT KỲ đâu) phải tính khoảng cách,
   sắp thứ tự chuẩn và tính MÃ BẢN (rev) y hệt file này — nếu không thì hai đường vào cho
   ra hai kết quả khác nhau, rồi 2 máy lại lệch số như hồi 289 vs 652 quán.
   Đừng chép các hàm này sang file khác: chép là sớm muộn hai bên lệch luật. */
const R = 6371000, toR = d => d * Math.PI / 180;
export function hav(a1, o1, a2, o2) { const dLat = toR(a2 - a1), dLng = toR(o2 - o1); const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a1)) * Math.cos(toR(a2)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function catOf(t) { const a = t.amenity, nm = (t.name || '').toLowerCase(); if (/karaoke|ktv/.test(nm)) return 'karaoke'; if (a === 'nightclub' || a === 'biergarten' || /beer ?club|bia/.test(nm)) return 'beerclub'; if (a === 'bar' || a === 'pub') return 'bar'; if (/nhậu|ốc|nướng|hải sản|lẩu|bbq/.test(nm)) return 'phonhau'; if (a === 'restaurant') return 'nhahang'; return 'phonhau'; }
export const SIZE = { beerclub: 12, bar: 10, karaoke: 9, phonhau: 10, nhahang: 8, sanbong: 11 };
function normQuan(d) {
  d = (d || '').trim(); if (!d) return null;
  if (/bình tân|binh tan/i.test(d)) return 'Bình Tân'; if (/bình thạnh|binh thanh/i.test(d)) return 'Bình Thạnh';
  if (/phú nhuận|phu nhuan/i.test(d)) return 'Phú Nhuận'; if (/tân bình|tan binh/i.test(d)) return 'Tân Bình';
  if (/tân phú|tan phu/i.test(d)) return 'Tân Phú'; if (/gò vấp|go vap/i.test(d)) return 'Gò Vấp';
  if (/thủ đức|thu duc/i.test(d)) return 'TP Thủ Đức';
  // Huyện ngoại thành: có quán thật (Trung Sơn, Bà Điểm…) nên phải gọi đúng tên, không nhét vào quận
  if (/bình chánh|binh chanh/i.test(d)) return 'Bình Chánh'; if (/hóc môn|hoc mon/i.test(d)) return 'Hóc Môn';
  if (/nhà bè|nha be/i.test(d)) return 'Nhà Bè'; if (/củ chi|cu chi/i.test(d)) return 'Củ Chi';
  if (/cần giờ|can gio/i.test(d)) return 'Cần Giờ';
  const m = d.match(/(?:quận|quan|district|d)?\s*0*(\d{1,2})\b/i); if (m && +m[1] >= 1 && +m[1] <= 12) return 'Quận ' + m[1];
  return null;
}
function coarseQuan(la, lo) {
  if (lo < 106.635 && la > 10.71 && la < 10.81) return 'Bình Tân';
  if (lo >= 106.72) return 'TP Thủ Đức';
  if (la < 10.752 && lo > 106.68 && lo < 106.74) return 'Quận 7';
  if (lo >= 106.685 && lo <= 106.715 && la >= 10.765 && la <= 10.79) return 'Quận 1';
  if (lo >= 106.675 && lo < 106.69 && la >= 10.775 && la <= 10.795) return 'Quận 3';
  if (lo >= 106.69 && lo <= 106.715 && la >= 10.755 && la < 10.772) return 'Quận 4';
  if (lo >= 106.69 && lo <= 106.72 && la > 10.79) return 'Bình Thạnh';
  if (lo >= 106.665 && lo < 106.69 && la >= 10.79) return 'Phú Nhuận';
  if (lo >= 106.63 && lo < 106.67 && la >= 10.785) return 'Tân Bình';
  if (lo >= 106.60 && lo < 106.635 && la >= 10.77) return 'Tân Phú';
  if (lo >= 106.64 && lo < 106.68 && la >= 10.745 && la < 10.775) return 'Quận 6';
  if (la < 10.745 && lo >= 106.63 && lo < 106.70) return 'Quận 8';
  return 'TP.HCM';
}

/* Mỗi mirror chỉ cho 14 giây. Bản cũ cho mirror ĐẦU TIÊN tới 50 giây — nó chậm là hết luôn
   thời gian của hàm (tối đa 60s), 2 mirror còn lại không bao giờ được thử → lỗi 504, app
   không đồng bộ được. Giờ chậm là nhảy mirror khác ngay, 3 mirror vẫn gọn trong 42 giây.
   kumi thường nhanh nhất nên để lên đầu. */
async function fetchOverpass() {
  const eps = ['https://overpass.kumi.systems/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter', 'https://overpass-api.de/api/interpreter'];
  for (const ep of eps) {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 14000);
      let txt;
      try {
        const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': 'roadai-driverradar/1.0' }, body: Q, signal: ctl.signal });
        txt = await r.text();
      } finally { clearTimeout(to); }
      if (txt && txt.trim()[0] === '{') { const els = JSON.parse(txt).elements || []; if (els.length) return els; }
    } catch (e) { /* thử mirror kế */ }
  }
  return null;
}

/* ═══════════ TỰ KIỂM TÊN QUÁN VỚI BẢN ĐỒ VIETMAP ═══════════ */
/* LƯU Ý: file này có hàm tên `process(els)` → nó CHE MẤT biến toàn cục `process` của Node,
   viết `process.env` ở đây là văng lỗi 500 ngay. Phải lấy env qua globalThis. */
const ENV = (globalThis.process && globalThis.process.env) || {};
export const VM_KEY = () => (ENV.VIETMAP_API_KEY || ENV.VIETMAP_KEY || '').trim();
export async function vmGet(path, params, ms) {
  const key = VM_KEY(); if (!key) return null;
  const u = new URL('https://maps.vietmap.vn/api/' + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('apikey', key);
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), ms || 5000);
  try { const r = await fetch(u, { signal: ctl.signal }); return r.ok ? await r.json() : null; }
  catch (e) { return null; } finally { clearTimeout(to); }
}
// So tên: bỏ dấu, bỏ chữ đệm vô nghĩa; phải trùng phần lớn tên thì mới coi là CÙNG một quán.
const VSTOP = new Set(['quan', 'nha', 'hang', 'duong', 'pho', 'tiem', 'the', 'and', 'cua', 'khu']);
const vtok = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1 && !VSTOP.has(w));
/* Phải phủ được phần lớn TÊN MÌNH ĐANG HỎI (a), không phải phần lớn tên bản đồ (b).
   So theo tên ngắn hơn thì "Karaoke ICOOL Tên Lửa" khớp với con đường "Tên Lửa" (2/2 chữ =
   100%) → app hiện tên đường thành tên quán. Tính theo (a): 2/4 = 50% → loại đúng. */
function nameMatch(a, b) {
  const x = vtok(a), y = vtok(b); if (!x.length || !y.length) return false;
  const hit = x.filter(w => y.includes(w)).length;
  return hit >= 1 && hit / x.length >= 0.6;
}
/* CHẶN VÒNG LẶP: VietMap có cả bản ghi ĐỊA CHỈ lẫn QUÁN. Nếu không chặn, cái nhãn
   "Bar/Pub · 109 Cô Giang" mà app tự sinh hôm trước sẽ khớp với bản ghi địa chỉ
   "109 Đường Cô Giang" → hôm sau app tưởng đã tra ra TÊN QUÁN và hiện "109 Đường Cô Giang"
   như một cái tên. Đó vẫn là bịa. Ứng viên chỉ được tính là TÊN QUÁN khi tên của nó
   KHÁC địa chỉ của chính nó. */
const nk = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  .replace(/\b(duong|hem|ngo|so nha)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function laBanGhiDiaChi(c) {
  const ten = nk(c && c.name), dc = nk(String((c && c.address) || '').split(',')[0]);
  return !ten || !dc || ten === dc || (dc.length > 4 && ten.startsWith(dc));
}
const laNhanTuSinh = s => String(s || '').includes(' · ');
/* VietMap mã hoá LOẠI BẢN GHI ngay trong ref_id (đã dò trên hàng chục mẫu):
     auto:RAkPYDc… = CON ĐƯỜNG   ("Tên Lửa", "Tỉnh Lộ 10")  → không phải tên quán
     auto:RAkPcic… / auto:RApFCSI… = ĐỊA CHỈ nhà ("205 Đường Số 32") → không phải tên quán
     auto:RAkPYyw… / auto:RAlSCTM… = ĐỊA ĐIỂM (quán, cửa hàng, bến xe) → mới được lấy tên
   Cứ dựa vào mã này thì "Phố nhậu Đường Tên Lửa" không còn bị bản đồ trả về con đường
   "Tên Lửa" rồi app tưởng đó là tên quán. */
const laDuongHoacDiaChi = c => /^auto:(RAkPYDc|RAkPcic|RApFCSI)/.test(String((c && c.ref_id) || ''));

/* ═══ DỌN TÊN: chỉ giữ TÊN QUÁN, bỏ đuôi vị trí ═══
   VietMap hay ghi kèm chỗ đứng vào tên: "Gammer Beer Đường Pasteur", "Bia Góc Lô K1",
   "777 Hai Huỳnh Mẫn Đạt". Trên bản đồ thì đường đã hiện sẵn, nhắc lại chỉ làm rối mắt.
   Chỉ cắt khi khúc đuôi đó ĐÚNG LÀ ĐỊA CHỈ của quán (đối chiếu địa chỉ reverse geocode),
   để không cắt nhầm tên thật kiểu "Quán Đường Xưa". */
function tenDuong(addr) {
  const seg = String(addr || '').split(',')[0].trim();
  return seg.replace(/^[0-9][^\s]*\s+/, '').trim();          // bỏ số nhà: "107 Đường Pasteur" → "Đường Pasteur"
}
/* addr = địa chỉ tại toạ độ mình có; addr2 = địa chỉ của chính bản ghi VietMap khớp tên.
   Phải xét cả hai: "Karaoke Hollywood Đường Bình Long" đứng ở toạ độ mà reverse ra
   "1 Đường Số 5" — chỉ nhìn addr thì tưởng "Đường Bình Long" là tên, thật ra là chỗ đứng. */
function donTen(name, addr, addr2) {
  let s = String(name || '').trim();
  const d1 = nk(tenDuong(addr)), d2 = nk(tenDuong(addr2));
  const dNorm = d1 || d2, aNorm = nk(addr) + ' | ' + nk(addr2);
  // "Đường Số 70A", "Hẻm Số 12" — luôn là chỗ đứng, không đời nào là tên quán → cắt thẳng
  s = s.replace(/[\s,-]+(Đường|Hẻm|Ngõ)\s+Số\s*\S+$/i, '');
  // 1) Cắt đuôi bắt đầu bằng từ chỉ vị trí (Đường/Hẻm/Lô/KDC/Khu phố…) nếu đuôi đó nằm trong địa chỉ
  s = s.replace(/\s+(Đường|Ngõ|Hẻm|Lô|Khu Dân Cư|Khu Phố|Kdc|Kp)\s+.+$/i, m => {
    const duoi = nk(m).replace(/^(duong|ngo|hem|lo|khu dan cu|khu pho|kdc|kp)\s*/, '');
    if (!duoi) return m;
    if (dNorm.includes(duoi) || aNorm.includes(duoi)) return '';
    // Bản đồ hay ghi cụt ("…Đường Phan Khiêm Ch" trong khi đường là "Phan Khiêm Ích") →
    // so từng chữ, trùng phần lớn thì vẫn là mô tả vị trí, cắt.
    const w = duoi.split(' ').filter(Boolean);
    const hop = (d1 + ' ' + d2).split(' ').filter(Boolean);
    const trung = w.filter(x => hop.some(y => y === x || (x.length > 2 && y.startsWith(x)))).length;
    if (w.length && trung / w.length >= 0.6) return '';
    /* Bản đồ nhiều chỗ chỉ trả tới phường (không có tên đường) nên không đối chiếu được.
       Nhưng đuôi "Đường/Hẻm/Ngõ + tên" đứng cuối tên quán thì gần như luôn là chỗ đứng.
       Chỉ cắt khi phần đầu còn đủ dài để vẫn là một cái tên (≥2 chữ, ≥6 ký tự) —
       nhờ vậy "Quán Đường Xưa" (đầu chỉ còn "Quán") vẫn giữ nguyên. */
    const dau = s.slice(0, s.length - m.length).trim();
    return (dau.split(/\s+/).filter(Boolean).length >= 2 && dau.length >= 6) ? '' : m;
  });
  // 2) Cắt đuôi là chính TÊN ĐƯỜNG (không có chữ "Đường"): "777 Hai Huỳnh Mẫn Đạt" → "777 Hai"
  const duong = [d1, d2].map(x => x.replace(/^duong\s*/, '')).filter(x => x.length > 3);
  for (const dTruc of duong) {
    if (!nk(s).endsWith(dTruc)) continue;
    const cut = s.slice(0, s.length - dTruc.length).replace(/[\s,.-]+$/, '');
    if (nk(cut).length >= 3) { s = cut; break; }
  }
  // 3) Cắt đuôi phường/quận/thành phố
  s = s.replace(/[\s,-]+(Phường\s+[^,]*|P\.?\s*\d+|Quận\s*[^,]*|Q\.?\s*\d{1,2}|Tp\.?\s*Hcm|Tphcm|Thành Phố\s+[^,]*)$/i, '');
  s = s.replace(/\s{2,}/g, ' ').replace(/^[\s,.-]+|[\s,.-]+$/g, '');
  // 4) Còn lại quá ngắn, hoặc CHÍNH LÀ TÊN ĐƯỜNG ("Tên Lửa", "Tỉnh Lộ 10") → không phải tên quán
  if (s.length < 3 || nk(s) === dNorm || duong.includes(nk(s)) || nk(s) === d1 || nk(s) === d2) return '';
  return s;
}
const CAT_VI = { phonhau: 'Quán nhậu', beerclub: 'Beer club', bar: 'Bar/Pub', karaoke: 'Karaoke', nhahang: 'Nhà hàng', sanbong: 'Quán bóng đá' };
export const shortAddr = a => String(a || '').replace(',Thành Phố Hồ Chí Minh', '').replace(/,\s*/g, ', ').trim();
/* Nhãn ngắn = số nhà + đường. Bản đồ đôi khi trả "Plus Code" (7P28RPR4+PG) thay cho số nhà —
   chuỗi đó vô nghĩa với tài xế, gặp thì lấy đoạn sau (phường) cho còn đọc được. */
const laPlusCode = t => /^[A-Z0-9]{4,8}\+[A-Z0-9]{2,4}$/i.test(String(t || '').trim());
function nhanDiaChi(addr) {
  const ph = String(addr || '').split(',').map(x => x.trim()).filter(Boolean);
  for (const x of ph) if (!laPlusCode(x)) return x;
  return '';
}

/* Kiểm 1 quán. Trả [name, cat, lat, lng, size, homeKm, quan, source, null, addr]
   source 'osm'      = bản đồ xác nhận đúng tên quán ở đúng chỗ → giữ tên.
   source 'osm-addr' = không xác nhận được → tên bị thay bằng địa chỉ thật. */
const LA_TEN_DUONG = /^(tỉnh lộ|quốc lộ|hương lộ|xa lộ|đại lộ|liên tỉnh lộ)\b/i;
const escRe = s => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "Phố nhậu Đường Tên Lửa" mà bản đồ trả về "Tên Lửa" → chính danh sách của mình đã nói
// đó là TÊN ĐƯỜNG, không phải tên quán.
const nguonNoiLaDuong = (osmName, vmName) =>
  !!vmName && new RegExp('(đường|hẻm|ngõ)\\s+' + escRe(vmName) + '\\s*$', 'i').test(String(osmName || ''));

async function checkOne(row, deadline) {
  const [nm, cat, la, lo, size, homeKm] = row;
  let quan = row[6];
  const dem = MC.get(mcKey(la, lo)) || { addr: '', ten: '' };
  const hetGio = () => Date.now() > deadline;
  let addr = '';
  if (!hetGio()) {
    const rev = await vmGet('reverse/v3', { lat: la, lng: lo }, 4500);
    const f = Array.isArray(rev) ? rev[0] : null;
    if (f) {
      addr = [f.name, shortAddr(f.address)].filter(Boolean).join(', ');
      // QUẬN cũng lấy từ bản đồ luôn. Trước đây đoán theo ô toạ độ (coarseQuan) nên sai bét:
      // quán ở "10 Trần Nhân Tôn, Quận 10" bị ghi là Quận 6 → lọc theo quận ra kết quả sai.
      const b = (f.boundaries || []).find(x => x.type === 1);
      const q = normQuan(b && (b.full_name || b.name));
      if (q) quan = q;
    }
  }
  if (!addr) addr = dem.addr || '';                 // bản đồ lỗi/bị chặn → dùng địa chỉ đã đệm
  quan = quanTuDiaChi(addr, quan);                  // kể cả khi rơi về đệm, quận vẫn phải khớp địa chỉ
  let ten = '', hoiDuoc = false;

  /* ═══ ƯU TIÊN GOOGLE PLACES (nếu đã cắm key) ═══
     Google là kho quán đầy đủ nhất VN và cho luôn GIỜ ĐÓNG CỬA THẬT + trạng thái
     đóng vĩnh viễn — hai thứ app đang phải đoán. Không có key thì bỏ qua, chạy VietMap. */
  if (G_KEY() && !hetGio() && !laNhanTuSinh(nm)) {
    const ds = await timTheoTen(nm, la, lo, 500, 4500);
    for (const p of ds) {
      const tenG = tenCua(p), v = viTriCua(p);
      if (!tenG || !v || hav(la, lo, v.lat, v.lng) > 400) continue;
      if (!nameMatch(nm, tenG)) continue;
      hoiDuoc = true;
      if (dongVinhVien(p)) return 'BO';             // quán đã đóng hẳn → bỏ khỏi bản đồ
      const dcG = diaChiCua(p);
      const t = donTen(tenG, dcG || addr, dcG);
      if (!t) break;
      return [t, cat, +v.lat.toFixed(5), +v.lng.toFixed(5), size, homeKm, quanTuDiaChi(dcG, quan),
        'osm', null, dcG || addr, 'google', '', gioMoHomNay(p), gioDongHomNay(p),
        p.rating || null, p.userRatingCount || null];
    }
  }
  if (!hetGio() && !laNhanTuSinh(nm)) {
    const ac = await vmGet('autocomplete/v3', { text: nm, focus: la + ',' + lo }, 4500);
    if (Array.isArray(ac)) {
      hoiDuoc = true;                                // hỏi được thật → kết quả "không có tên" là KẾT LUẬN
      for (const c of ac.slice(0, 3)) {
        if (laDuongHoacDiaChi(c) || laBanGhiDiaChi(c)) continue;   // con đường / địa chỉ, không phải tên quán
        if (LA_TEN_DUONG.test(c.name) || nguonNoiLaDuong(nm, c.name)) continue;
        if (!nameMatch(nm, c.name)) continue;
        const p = await vmGet('place/v3', { refid: c.ref_id }, 4500);
        if (p && p.lat != null && hav(la, lo, p.lat, p.lng) < 400) {
          // Hiện ĐÚNG TÊN BẢN ĐỒ GHI (không phải tên trong danh sách của mình: "Aeon Mall Bình Tân
          // (nhà hàng)" — chữ "(nhà hàng)" là tự thêm), và CHỈ phần tên quán, bỏ đuôi đường/lô/phường.
          ten = donTen(c.name, addr || shortAddr(c.address), shortAddr(c.address));
        }
        break;   // ứng viên khớp tên nhưng ở xa → chính là bằng chứng KHÔNG phải quán này
      }
    }
  }
  // Hỏi không được (mạng lỗi/bị chặn) thì giữ nguyên tên đã kiểm hôm trước, KHÔNG tự ý bỏ.
  if (!ten && !hoiDuoc) ten = dem.ten || '';
  if (ten) return [ten, cat, la, lo, size, homeKm, quan, 'osm', null, addr, dem.ten === ten ? 'đệm' : 'vietmap'];
  // Không tra được tên → tên hiển thị = ĐỊA CHỈ THẬT (hoặc quận nếu bản đồ cũng không có địa chỉ).
  // Nhãn chỉ lấy SỐ NHÀ + ĐƯỜNG cho gọn, phường/quận đã hiện sẵn ở dòng dưới trong app.
  const nhan = (CAT_VI[cat] || 'Điểm') + ' · ' + (nhanDiaChi(addr) || quan || 'chưa rõ địa chỉ');
  return [nhan, cat, la, lo, size, homeKm, quan, 'osm-addr', null, addr];
}
/* ═══ BỘ NHỚ ĐỆM + XOAY VÒNG ═══
   Không gọi VietMap cho cả danh sách mỗi lần: vừa tốn tiền vừa bị chặn ("Too many requests").
   · Điểm ĐÃ CÓ trong đệm → dùng luôn kết quả đệm.
   · Mỗi ngày chỉ đi hỏi lại 1/CHU_KY danh sách (chọn theo NGÀY nên mọi máy ra cùng kết quả),
     cộng với mọi điểm MỚI chưa có trong đệm → sau 6 ngày là quét hết một lượt, ngày nào cũng tươi.
   Bản đồ chặn/lỗi → rơi về đệm, không bao giờ hiện tên chưa kiểm. */
const CHU_KY = 6;
const MC = new Map(MAPCACHE.map(([la, lo, addr, ten]) => [(+la).toFixed(5) + ',' + (+lo).toFixed(5), { addr, ten }]));
const mcKey = (la, lo) => (+la).toFixed(5) + ',' + (+lo).toFixed(5);
const ngayTrongNam = () => Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 864e5);
// Quận lấy từ chính địa chỉ (kể cả khi dùng bản đệm) — không để lệch kiểu "địa chỉ Quận 5, cột ghi Quận 6"
const quanTuDiaChi = (addr, mac) => normQuan((String(addr || '').match(/(Quận [^,]+|Thành Phố Thủ Đức|Huyện [^,]+|Thị Xã [^,]+)/) || [])[1]) || mac;
const tuDem = (r) => {
  const [nm, cat, la, lo, size, homeKm] = r;
  const c = MC.get(mcKey(la, lo));
  const addr = (c && c.addr) || '';
  const quan = quanTuDiaChi(addr, r[6]);
  if (c && c.ten) return [c.ten, cat, la, lo, size, homeKm, quan, 'osm', null, addr];
  const nhan = (CAT_VI[cat] || 'Điểm') + ' · ' + (nhanDiaChi(addr) || quan || 'chưa rõ địa chỉ');
  return [nhan, cat, la, lo, size, homeKm, quan, 'osm-addr', null, addr];
};

/* ═══ TỰ QUÉT QUÁN MỚI TỪ GOOGLE (chỉ chạy khi đã cắm key) ═══
   OSM ở TP.HCM bỏ sót rất nhiều quán nhậu. Mỗi ngày quét 2 vùng (xoay vòng hết 12 vùng
   trong 6 ngày) quanh chính những nơi anh Long ĐÃ NỔ CUỐC THẬT — chứ không quét cả thành phố
   cho tốn tiền. Quán mới cách quán cũ dưới 80m thì coi như trùng, bỏ. */
const VUNG_LAI_HO = [
  [10.8357, 106.7032, 'Bình Thạnh'], [10.8196, 106.7031, 'Bình Thạnh'], [10.8222, 106.7011, 'Bình Thạnh'],
  [10.8304, 106.7329, 'TP Thủ Đức'], [10.7988, 106.7340, 'TP Thủ Đức'], [10.8565, 106.7573, 'TP Thủ Đức'],
  [10.8421, 106.6647, 'Gò Vấp'], [10.8367, 106.6670, 'Gò Vấp'],
  [10.7336, 106.6529, 'Quận 8'], [10.7369, 106.6705, 'Quận 8'],
  [10.7412, 106.7089, 'Quận 7'], [10.7499, 106.6087, 'Bình Tân'],
];
async function quetVungGoogle(daCo, deadline) {
  if (!G_KEY()) return [];
  const phien = ngayTrongNam() % 6;
  const vung = VUNG_LAI_HO.filter((_, i) => i % 6 === phien);
  const them = [];
  for (const [la, lo, quan] of vung) {
    if (Date.now() > deadline - 6000) break;
    let ds = [];
    try { ds = await quanhDay(la, lo, 900, ['bar', 'night_club', 'restaurant'], 6000); } catch (e) { ds = []; }
    for (const p of ds) {
      const v = viTriCua(p), ten = tenCua(p);
      if (!v || !ten || dongVinhVien(p)) continue;
      if ((p.userRatingCount || 0) < 5) continue;              // quán chưa ai đánh giá → chưa chắc có thật
      const cat = nhomQuan(p);
      if (cat === 'nhahang' && !/nhậu|bia|beer|ốc|nướng|lẩu|hải sản/i.test(ten)) continue;   // nhà hàng cơm gia đình thì bỏ
      if (daCo.some(r => hav(r[2], r[3], v.lat, v.lng) < 80)) continue;
      if (them.some(r => hav(r[2], r[3], v.lat, v.lng) < 80)) continue;
      const dc = diaChiCua(p);
      const t = donTen(ten, dc, dc) || ten;
      them.push([t, cat, +v.lat.toFixed(5), +v.lng.toFixed(5), SIZE[cat] || 10,
        Math.max(4, Math.min(12, Math.round(4 + hav(10.776, 106.700, v.lat, v.lng) / 1000 * 0.35))),
        quanTuDiaChi(dc, quan), 'osm', null, dc, 'google', '',
        gioMoHomNay(p), gioDongHomNay(p), p.rating || null, p.userRatingCount || null]);
    }
  }
  return them;
}

async function checkAll(rows, deadline) {
  if (!VM_KEY()) return rows.map(tuDem);
  const phien = ngayTrongNam() % CHU_KY;
  const canHoi = rows.map((r, i) => (!MC.has(mcKey(r[2], r[3])) || i % CHU_KY === phien));
  const out = rows.map(tuDem);
  const ds = rows.map((r, i) => i).filter(i => canHoi[i]);
  let p = 0;
  await Promise.all(Array.from({ length: Math.min(6, ds.length) }, async () => {
    while (p < ds.length) {
      const k = ds[p++];
      try {
        const kq = await checkOne(rows[k], deadline);
        if (kq === 'BO') out[k] = null;              // Google báo đóng vĩnh viễn → xoá khỏi bản đồ
        else if (kq) out[k] = kq;
      } catch (e) { /* giữ bản đệm */ }
    }
  }));
  return out.filter(Array.isArray);
}

/* ĐỒNG BỘ 2 MÁY: mọi bước dưới đây phải cho ra ĐÚNG MỘT kết quả với cùng dữ liệu OSM.
   Trước đây thứ tự phần tử Overpass trả về khác nhau mỗi lần gọi → lọc trùng/cắt danh sách
   ra kết quả khác nhau → máy A 289 quán, máy B 652 quán. Giờ sắp xếp chuẩn TRƯỚC khi lọc. */
export const canon = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || a[2] - b[2] || a[3] - b[3] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
export function revOf(rows) { let h = 0x811c9dc5; const s = JSON.stringify(rows); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h.toString(36).toUpperCase().padStart(7, '0').slice(-7); }

function process(els) {
  let rows = [];
  for (const el of els) {
    const t = el.tags || {}; const nm = (t.name || '').trim(); if (!nm || nm.length < 2) continue;
    const la = el.lat != null ? el.lat : (el.center && el.center.lat); const lo = el.lon != null ? el.lon : (el.center && el.center.lon);
    if (la == null || lo == null) continue;
    const cat = catOf(t);
    const size = Math.max(5, Math.min(16, SIZE[cat] + (hash(nm) % 5) - 2));
    const homeKm = Math.max(4, Math.min(12, Math.round(4 + hav(10.776, 106.700, la, lo) / 1000 * 0.35)));
    const quan = normQuan(t['addr:district'] || t['addr:suburb']) || coarseQuan(la, lo);
    rows.push([nm, cat, +la.toFixed(5), +lo.toFixed(5), size, homeKm, quan]);
  }
  rows.sort(canon);                       // ← chốt thứ tự trước, các bước sau mới ổn định
  const near = (a, b) => hav(a[2], a[3], b[2], b[3]) < 150;
  rows = rows.filter(r => !CURATED.some(c => near(r, c)));
  const seen = new Set(); rows = rows.filter(r => { const k = r[0].toLowerCase() + '|' + r[2].toFixed(3) + ',' + r[3].toFixed(3); if (seen.has(k)) return false; seen.add(k); return true; });
  const bucket = {}; rows = rows.filter(r => { const k = r[2].toFixed(3) + ',' + r[3].toFixed(3); bucket[k] = (bucket[k] || 0) + 1; return bucket[k] <= 3; });
  const pri = { beerclub: 0, bar: 1, karaoke: 2, phonhau: 3, nhahang: 4, sanbong: 5 };
  rows.sort((a, b) => pri[a[1]] - pri[b[1]] || b[4] - a[4] || canon(a, b));   // hoà điểm → so tên/toạ độ, không phụ thuộc thứ tự Overpass
  const perQ = {}; rows = rows.filter(r => { perQ[r[6]] = (perQ[r[6]] || 0) + 1; return perQ[r[6]] <= 16; });
  rows = rows.slice(0, 130);
  rows.sort(canon);                       // xuất ra theo thứ tự chuẩn → 2 máy nhận đúng 1 chuỗi byte
  return CURATED.concat(rows);
}

// TỰ KIỂM: đủ số lượng + toạ độ trong HCM + đúng nhóm
const CATS = new Set(['phonhau', 'beerclub', 'bar', 'karaoke', 'nhahang', 'sanbong']);
const selfCheck = a => a.length >= 120 && a.every(r => r[2] > 10.6 && r[2] < 10.95 && r[3] > 106.5 && r[3] < 106.9 && CATS.has(r[1]));

function send(res, req, all, source, fresh, chk, quanMoi) {
  // rev = vân tay của đúng danh sách này. 2 máy cùng rev = chắc chắn cùng dữ liệu, khỏi đoán.
  const rev = revOf(all);
  // Bản dự phòng chỉ giữ cache ngắn để Overpass sống lại là quay về dữ liệu tươi ngay.
  res.setHeader('Cache-Control', fresh ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'public, s-maxage=300, stale-while-revalidate=86400');
  res.setHeader('ETag', '"' + rev + '"');
  if ((req.headers['if-none-match'] || '').includes(rev)) return res.status(304).end();
  // named/addrOnly: app hiện thẳng cho tài xế biết hôm nay tra được tên bao nhiêu quán.
  const named = all.filter(r => r[7] === 'osm').length;
  const google = all.filter(r => r[10] === 'google').length;
  return res.status(200).json({
    ok: true, rev, count: all.length, spots: all, source, fresh: !!fresh,
    named, addrOnly: all.length - named, nameCheck: chk || 'không chạy',
    google, gioThat: all.filter(r => isFinite(r[13])).length, quanMoi: quanMoi || 0,
    updatedAt: new Date().toISOString(),
  });
}

export default async function handler(req, res) {
  /* QUY TẮC: KHÔNG BAO GIỜ trả tay không. Overpass chết mà server im lặng thì mỗi máy giữ một
     bản chụp cũ khác nhau — đúng cái lỗi 2 máy lệch số. Thà trả bản dự phòng cố định để mọi
     máy GIỐNG NHAU, rồi Overpass sống lại thì tự đổi về dữ liệu tươi. */
  const t0 = Date.now();
  let all = null;
  try {
    const els = await fetchOverpass();
    if (els) { const p = process(els); if (selfCheck(p)) all = p; }
  } catch (e) { /* rơi xuống bản dự phòng */ }

  // Chừa lại thời gian cho khâu tự kiểm tên: hàm tối đa 60s, cắt ở giây thứ 50 cho an toàn.
  const deadline = t0 + 50000;
  const chk = VM_KEY() ? 'VietMap · ' + new Date().toISOString() : 'thiếu VIETMAP_API_KEY → bỏ hết tên';

  const nguon = (goc) => goc + ' · tên đối chiếu ' + (G_KEY() ? 'Google Maps' : 'VietMap') + ' · quán bổ sung Overture Maps';
  /* Quán từ Overture Maps: dữ liệu mở, ĐÃ có tên + địa chỉ thật, giấy phép cho phép hiển thị.
     KHÔNG đưa qua khâu đối chiếu VietMap — làm vậy chỉ tổ biến một cái tên thật thành nhãn
     địa chỉ khi VietMap không biết quán đó. Trùng chỗ quán sẵn có (<80m) thì bỏ. */
  const themOverture = rows => rows.concat(OVERTURE.filter(o => !rows.some(r => hav(r[2], r[3], o[2], o[3]) < 80)));

  if (all) {
    const checked = await checkAll(all, deadline);
    const moi = await quetVungGoogle(checked, deadline);          // quán Google có mà OSM thiếu
    return send(res, req, themOverture(checked.concat(moi)).sort(canon), nguon('OpenStreetMap · Overpass'), true, chk, moi.length);
  }
  const fb = CURATED.concat(FALLBACK.filter(r => !CURATED.some(c => hav(r[2], r[3], c[2], c[3]) < 150))).sort(canon);
  if (!selfCheck(fb)) { res.setHeader('Cache-Control', 'public, s-maxage=120'); return res.status(200).json({ ok: false, reason: 'overpass_unavailable' }); }
  const fbChecked = await checkAll(fb, deadline);
  const moi = await quetVungGoogle(fbChecked, deadline);
  return send(res, req, themOverture(fbChecked.concat(moi)).sort(canon), nguon('OSM · bản dự phòng'), false, chk, moi.length);
}
