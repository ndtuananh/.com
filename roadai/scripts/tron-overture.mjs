/* RoadAI · Driver Radar — TRỘN DỮ LIỆU QUÁN TỪ OVERTURE MAPS VÀO APP.
   ─────────────────────────────────────────────────────────────────────────────
   VÌ SAO DÙNG OVERTURE: đây là kho địa điểm mở của Overture Maps Foundation
   (giấy phép CDLA-Permissive 2.0 — ĐƯỢC PHÉP hiển thị và phát hành lại, chỉ cần
   ghi nguồn). Khác hẳn Google Places: dữ liệu Google chỉ được hiện kèm bản đồ
   Google và không được lưu quá 30 ngày, không hợp với app đang chạy nền VietMap.
   Overture cho TP.HCM ~9.900 quán nhậu/bar/karaoke/ốc/nướng có tên + địa chỉ.

   FILE NÀY LÀM 2 VIỆC (chạy ở máy, không chạy trên server):
     A. VÁ TÊN cho những quán app đang phải hiện địa chỉ vì bản đồ VietMap không
        tra ra tên — nếu Overture có đúng một quán ngay tại đó thì lấy tên thật.
     B. BỔ SUNG quán mà OpenStreetMap còn thiếu, rải đều theo ô lưới ~1,3 km để
        bản đồ không bị dồn cục một chỗ và app vẫn nhẹ.

   CÁCH CHẠY (cần DuckDB CLI, không cần key gì cả):
     duckdb -c ".read scripts/overture-hcm.sql"        → sinh overture-hcm.json
     node scripts/tron-overture.mjs overture-hcm.json spots-hien-tai.json
   Kết quả ghi ra: api/_overture.js (quán bổ sung) + api/_mapcache.js (tên đã vá).
   ───────────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [fileOverture, fileSpots] = process.argv.slice(2);
if (!fileOverture || !fileSpots) {
  console.error('Thiếu tham số: node scripts/tron-overture.mjs <overture-hcm.json> <spots.json>');
  process.exit(1);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // đường dẫn có dấu tiếng Việt → phải giải mã URL
const OV = JSON.parse(fs.readFileSync(fileOverture, 'utf8'));
const SP = JSON.parse(fs.readFileSync(fileSpots, 'utf8')).spots || [];

const R = 6371000, rad = d => d * Math.PI / 180;
const hav = (a1, o1, a2, o2) => { const dLat = rad(a2 - a1), dLng = rad(o2 - o1); const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
const nk = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['quan', 'nha', 'hang', 'duong', 'pho', 'tiem', 'the', 'and', 'cua', 'khu', 'bar', 'beer', 'club']);
const toks = s => nk(s).split(' ').filter(w => w.length > 1 && !STOP.has(w));
function giong(a, b) {                    // độ giống 2 tên, tính theo tên NGẮN hơn
  const x = toks(a), y = toks(b); if (!x.length || !y.length) return 0;
  const hit = x.filter(w => y.includes(w)).length;
  return hit / Math.min(x.length, y.length);
}
/* Overture có vài bản ghi bị dính 2–3 tên quán vào nhau ("303 Garden Station - Hộp Đêm
   Phạm Văn Đồng - New Space Ember Lounge") — hiện lên bản đồ thì tài xế không biết đường nào.
   Tên quá dài hoặc có từ 2 dấu gạch ngang trở lên thì bỏ, thà hiện địa chỉ. */
const tenXai = t => {
  const s = String(t || '').trim();
  return s.length >= 3 && s.length <= 46 && (s.match(/ - /g) || []).length <= 1;
};

/* Overture phân loại theo chuẩn quốc tế → quy về 6 nhóm app đang dùng */
const NHOM = {
  bar: 'bar', pub: 'bar', cocktail_bar: 'bar', wine_bar: 'bar', sports_bar: 'bar',
  beer_bar: 'beerclub', beer_garden: 'beerclub', brewery: 'beerclub', brewpub: 'beerclub', night_club: 'beerclub',
  karaoke: 'karaoke',
  seafood_restaurant: 'phonhau', barbecue_restaurant: 'phonhau', hot_pot_restaurant: 'phonhau',
};
const nhomApp = (nhom, ten) => NHOM[nhom]
  || (/nhậu|bia|beer|ốc|nướng|lẩu|hải sản/i.test(ten) ? 'phonhau' : 'nhahang');
const UU_TIEN = { phonhau: 3, beerclub: 3, bar: 2.4, karaoke: 2.2, nhahang: 1 };

/* Quận: ưu tiên đọc trong địa chỉ Overture, không có thì lấy theo quán gần nhất đã biết quận */
function quanCua(diachi, la, lo) {
  const d = String(diachi || '');
  const m = d.match(/Quận\s*([0-9]{1,2}|[^,]+)/i);
  if (m) {
    const t = m[1].trim();
    if (/^\d+$/.test(t)) return 'Quận ' + t;
    if (/bình tân/i.test(t)) return 'Bình Tân'; if (/bình thạnh/i.test(t)) return 'Bình Thạnh';
    if (/gò vấp/i.test(t)) return 'Gò Vấp'; if (/phú nhuận/i.test(t)) return 'Phú Nhuận';
    if (/tân bình/i.test(t)) return 'Tân Bình'; if (/tân phú/i.test(t)) return 'Tân Phú';
  }
  if (/thủ đức/i.test(d)) return 'TP Thủ Đức';
  let best = null, bd = 3000;
  for (const s of SP) { const k = hav(la, lo, s[2], s[3]); if (k < bd) { bd = k; best = s; } }
  return (best && best[6]) || 'TP.HCM';
}

/* ═══ A. VÁ TÊN cho quán app đang hiện địa chỉ ═══ */
let vaTen = 0;
const capNhatTen = new Map();       // "lat,lng" → { ten, diachi }
for (const s of SP) {
  const [ten0, , la, lo, , , , nguon] = s;
  const gan = OV.filter(o => hav(la, lo, o.lat, o.lng) < 70 && tenXai(o.ten));
  if (!gan.length) continue;
  // 1) khớp tên với tên OSM → chắc chắn cùng một quán
  let chon = gan.map(o => ({ o, g: giong(ten0, o.ten) })).sort((a, b) => b.g - a.g)[0];
  let ly = 'khớp tên OSM';
  if (!chon || chon.g < 0.5) {
    // 2) app đang KHÔNG có tên (chỉ hiện địa chỉ) mà ngay đó Overture có ĐÚNG MỘT quán
    //    thuộc nhóm khách uống → lấy tên đó, vì vị trí đã trùng khít.
    if (nguon !== 'osm-addr') continue;
    const rat = gan.filter(o => hav(la, lo, o.lat, o.lng) < 45 && NHOM[o.nhom] && o.tincay >= 0.5);
    if (rat.length !== 1) continue;
    chon = { o: rat[0], g: 1 }; ly = 'trùng vị trí, chỉ có 1 quán';
  }
  capNhatTen.set(la.toFixed(5) + ',' + lo.toFixed(5), { ten: chon.o.ten, diachi: chon.o.diachi, ly });
  vaTen++;
}

/* ═══ B. BỔ SUNG quán OSM còn thiếu — rải đều theo ô lưới ~1,3 km ═══ */
const O_CACH = 0.012;
const key = (la, lo) => Math.round(la / O_CACH) + ':' + Math.round(lo / O_CACH);
const daCo = SP.map(s => [s[2], s[3]]);
const theoO = new Map();
for (const o of OV) {
  if (!o.ten || o.tincay < 0.45 || !tenXai(o.ten)) continue;
  if (!o.diachi || o.diachi.trim().length < 5) continue;   // không có địa chỉ tử tế thì bỏ, khỏi dẫn tài xế tới chỗ mơ hồ
  const cat = nhomApp(o.nhom, o.ten);
  if (cat === 'nhahang') continue;                       // nhà hàng thường: khách ít gọi lái hộ
  if (/cà phê|cafe|coffee|trà sữa|bánh|cơm tấm|phở|bún|xôi|chay/i.test(o.ten) && cat === 'phonhau') continue;
  /* Overture xếp cả công ty bán thiết bị karaoke, chỗ cho thuê loa… vào nhóm 'karaoke'.
     Đó không phải chỗ khách ngồi uống → lọc bỏ, không thì tài xế chạy tới nơi ngơ ngác. */
  if (/\b(công ty|cty|tnhh|cổ phần|cp\.|cho thuê|cung cấp|nội thất|thiết bị|âm thanh|sửa chữa|lắp đặt|showroom|đại lý|kho |vật liệu|xây dựng|vận tải|in ấn|quảng cáo|spa|massage|nhà nghỉ|khách sạn|hotel|motel|karaoke box giá|bán )/i.test(o.ten)) continue;
  if (daCo.some(([a, b]) => hav(a, b, o.lat, o.lng) < 80)) continue;
  const k = key(o.lat, o.lng);
  const arr = theoO.get(k) || []; arr.push({ ...o, cat, diem: UU_TIEN[cat] * o.tincay }); theoO.set(k, arr);
}
/* Ưu tiên quán nằm trong VÙNG ANH LONG HAY CHẠY (12 nơi đã nổ cuốc thật):
   cùng điểm tin cậy thì quán ở sân nhà có ích hơn quán ở đầu kia thành phố. */
const VUNG = [[10.8357, 106.7032], [10.8196, 106.7031], [10.8222, 106.7011], [10.8304, 106.7329],
  [10.7988, 106.7340], [10.8565, 106.7573], [10.8421, 106.6647], [10.8367, 106.6670],
  [10.7336, 106.6529], [10.7369, 106.6705], [10.7412, 106.7089], [10.7499, 106.6087]];
const ganVung = (la, lo) => VUNG.some(([a, b]) => hav(a, b, la, lo) < 2500);

const them = [];
for (const arr of theoO.values()) {
  arr.forEach(o => { o.diem *= ganVung(o.lat, o.lng) ? 1.6 : 1; });
  arr.sort((a, b) => b.diem - a.diem);
  for (const o of arr.slice(0, 3)) {
    if (them.some(t => hav(t.lat, t.lng, o.lat, o.lng) < 80)) continue;
    them.push(o);
  }
}
them.sort((a, b) => b.diem - a.diem);
/* Chia hạn ngạch theo nhóm: không để bản đồ toàn quán ốc/nướng mà thiếu karaoke, bar —
   khách karaoke/bar say không kém, và đó là chỗ nổ cuốc lúc khuya. */
const HAN = { phonhau: 110, karaoke: 45, bar: 35, beerclub: 25 };
const dem = {}; const CHON = [];
for (const o of them) {
  dem[o.cat] = dem[o.cat] || 0;
  if (dem[o.cat] >= (HAN[o.cat] || 0)) continue;
  dem[o.cat]++; CHON.push(o);
}
CHON.sort((a, b) => (a.ten < b.ten ? -1 : a.ten > b.ten ? 1 : 0) || a.lat - b.lat);

const SIZE = { beerclub: 12, bar: 10, karaoke: 9, phonhau: 10, nhahang: 8 };
const rows = CHON.map(o => [
  o.ten.trim().slice(0, 70), o.cat, +o.lat.toFixed(5), +o.lng.toFixed(5),
  SIZE[o.cat] || 10, Math.max(4, Math.min(12, Math.round(4 + hav(10.776, 106.700, o.lat, o.lng) / 1000 * 0.35))),
  quanCua(o.diachi, o.lat, o.lng), 'osm', null, (o.diachi || '').trim(), 'overture',
]);

fs.writeFileSync(path.join(ROOT, 'api/_overture.js'),
  `/* RoadAI — QUÁN BỔ SUNG TỪ OVERTURE MAPS (bản dữ liệu 2026-07-22).
   Nguồn: Overture Maps Foundation, giấy phép CDLA-Permissive 2.0 — được phép hiển thị
   và phát hành lại, chỉ cần ghi nguồn (app ghi ở 📊 Điều phối → Nguồn dữ liệu).
   Đây là quán THẬT có tên + địa chỉ mà OpenStreetMap còn thiếu, lọc theo nhóm khách
   hay say (bar/pub/beer club/karaoke/ốc/nướng/lẩu), rải đều theo ô lưới ~1,3 km.
   Sinh lại: node scripts/tron-overture.mjs overture-hcm.json spots.json
   [tên, nhóm, lat, lng, size, homeKm, quận, nguồn, pid, địa chỉ, nguồn tên] */
export const OVERTURE = [
${rows.map(r => '  ' + JSON.stringify(r) + ',').join('\n')}
];
`);

/* Cập nhật _mapcache.js: vá tên + giữ nguyên địa chỉ đã có */
const mcSrc = fs.readFileSync(path.join(ROOT, 'api/_mapcache.js'), 'utf8');
const iMc = mcSrc.indexOf('export const MAPCACHE');          // phần chú thích phía trên cũng có dấu [ ]
const cu = JSON.parse(mcSrc.slice(mcSrc.indexOf('[', iMc), mcSrc.lastIndexOf(']') + 1).replace(/,(\s*])/, '$1'));
const mc = new Map(cu.map(r => [r[0].toFixed(5) + ',' + r[1].toFixed(5), r]));
for (const [k, v] of capNhatTen) {
  const r = mc.get(k) || [+k.split(',')[0], +k.split(',')[1], '', ''];
  r[2] = r[2] || v.diachi || ''; r[3] = v.ten;
  mc.set(k, r);
}
const mcRows = [...mc.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
fs.writeFileSync(path.join(ROOT, 'api/_mapcache.js'),
  mcSrc.slice(0, mcSrc.indexOf('export const MAPCACHE')) +
  'export const MAPCACHE = [\n' + mcRows.map(r => '  ' + JSON.stringify(r) + ',').join('\n') + '\n];\n');

console.log('A. Vá tên từ Overture cho', vaTen, 'quán app đang phải hiện địa chỉ');
console.log('B. Bổ sung', rows.length, 'quán OSM còn thiếu (từ', OV.length, 'địa điểm Overture)');
console.log('   nhóm:', JSON.stringify(rows.reduce((o, r) => (o[r[1]] = (o[r[1]] || 0) + 1, o), {})));
