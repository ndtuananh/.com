/* RoadAI · Driver Radar — ĐÓNG GÓI KHO QUÁN CẢ NƯỚC (chạy ở máy, không chạy trên server).
   ─────────────────────────────────────────────────────────────────────────────
   Đầu vào : overture-vn.json   (sinh bởi: duckdb -c ".read scripts/overture-vn.sql")
   Đầu ra  : api/_quanvn.js     — kho quán cả nước cho /api/quanh.

   VÌ SAO KHÔNG HỎI THẲNG LÚC CHẠY: đã đo thật ngày 06/08/2026 — Overpass quanh
   Biên Hoà bán kính 4km trả về ĐÚNG 0 quán sau 69 giây chờ. OpenStreetMap ở tỉnh
   gần như trống. Overture cùng chỗ đó có 113 quán có tên + địa chỉ. Nên kho quán
   phải nằm sẵn trong app, hỏi phát ra ngay, không phụ thuộc máy chủ bên ngoài.

   ĐỊNH DẠNG FILE: một quán một dòng, các cột cách nhau bằng ký tự TAB:
     tên ⇥ nhóm ⇥ lat ⇥ lng ⇥ địa chỉ ⇥ khu
   Cố ý KHÔNG để dạng mảng JS: 24.000 dòng viết thành mảng thì máy chủ phải dựng
   24.000 mảng con ngay khi khởi động, còn để dạng chuỗi thì chỉ tách khi có người
   thật sự hỏi (và tách xong giữ lại dùng tiếp).

   Nguồn: © Overture Maps Foundation — giấy phép CDLA-Permissive 2.0, được phép
   hiển thị và phát hành lại, chỉ cần ghi nguồn (app ghi ở 📊 Điều phối).
   ───────────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [fileVN] = process.argv.slice(2);
if (!fileVN) { console.error('Thiếu tham số: node scripts/tron-vn.mjs <overture-vn.json>'); process.exit(1); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OV = JSON.parse(fs.readFileSync(fileVN, 'utf8'));

const don = s => String(s || '').replace(/[\t\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
/* Khu = tên đơn vị hành chính Overture ghi kèm quán. Bỏ tiền tố "Huyện/Thành phố/Thị xã"
   cho gọn màn hình điện thoại, nhưng GIỮ "Quận 1"… vì bỏ đi là mất nghĩa. */
const donKhu = s => don(s).replace(/^(Huyện|Thành phố|Thành Phố|Thị xã|Thị Xã|Xã|Phường)\s+/i, m => /^(xã|phường)/i.test(m) ? m : '');

const CAT_OK = new Set(['phonhau', 'beerclub', 'bar', 'karaoke']);
const seen = new Set();
const rows = [];
for (const o of OV) {
  const ten = don(o.ten), cat = o.cat, diachi = don(o.diachi);
  if (!ten || !CAT_OK.has(cat)) continue;
  const lat = +(+o.lat).toFixed(5), lng = +(+o.lng).toFixed(5);
  if (!isFinite(lat) || !isFinite(lng)) continue;
  const k = ten.toLowerCase() + '|' + lat.toFixed(4) + ',' + lng.toFixed(4);
  if (seen.has(k)) continue; seen.add(k);
  rows.push([ten.slice(0, 70), cat, lat, lng, diachi.slice(0, 90), donKhu(o.xa).slice(0, 40)]);
}
// Sắp theo vĩ độ: /api/quanh quét từ trên xuống, dữ liệu xếp theo dải ngang thì bỏ qua
// được cả vùng không liên quan chỉ bằng 1 phép so sánh.
rows.sort((a, b) => a[2] - b[2] || a[3] - b[3] || (a[0] < b[0] ? -1 : 1));

const txt = rows.map(r => r.join('\t')).join('\n');
const dem = rows.reduce((o, r) => (o[r[1]] = (o[r[1]] || 0) + 1, o), {});

fs.writeFileSync(path.join(ROOT, 'api/_quanvn.js'),
  `/* RoadAI — KHO QUÁN CẢ NƯỚC (Overture Maps, bản dữ liệu 2026-07-22).
   ${rows.length.toLocaleString('vi-VN')} quán có TÊN THẬT + ĐỊA CHỈ THẬT trên toàn Việt Nam,
   nhóm khách hay say: ${Object.entries(dem).map(([k, v]) => k + ' ' + v).join(' · ')}.
   Đây là thứ trả lời câu hỏi của anh Long "đi khu mới sao không có quán nào" —
   /api/quanh lấy quán quanh chỗ tài xế đang đứng từ chính file này, ở bất kỳ đâu.
   Nguồn: © Overture Maps Foundation, giấy phép CDLA-Permissive 2.0 (được phép hiển thị
   và phát hành lại — app ghi nguồn ở 📊 Điều phối → Nguồn dữ liệu quán).

   MỘT QUÁN MỘT DÒNG, các cột cách nhau bằng TAB:  tên ⇥ nhóm ⇥ lat ⇥ lng ⇥ địa chỉ ⇥ khu
   Sinh lại (bản Overture mới ra hằng tháng):
     duckdb -c ".read scripts/overture-vn.sql"
     node scripts/tron-vn.mjs overture-vn.json                                   */
export const QUANVN_TXT = ${JSON.stringify(txt)};
export const QUANVN_NGUON = 'Overture Maps 2026-07-22';
`);

console.log('Đã ghi api/_quanvn.js —', rows.length, 'quán');
console.log('  nhóm:', JSON.stringify(dem));
console.log('  dung lượng:', (Buffer.byteLength(txt) / 1048576).toFixed(2), 'MB');
