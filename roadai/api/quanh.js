/* RoadAI · Driver Radar — /api/quanh?lat=…&lng=…
   ═══════════════════════════════════════════════════════════════════════════
   VÌ SAO CÓ FILE NÀY (anh Long báo 06/08/2026):
     "Đi địa điểm mới không nạp dữ liệu quán vào được nữa nên không canh P
      theo khu vực mới được. Data nhiều nó không cho nạp nữa hay sao ấy."
   Không phải tại data nhiều. Tại thiết kế cũ chỉ biết đúng TP.HCM:
     · /api/spots hỏi OpenStreetMap trong MỘT KHUNG cố định 10,68–10,89 /
       106,55–106,83. Chạy sang Biên Hoà, Bình Dương, Long An, Vũng Tàu, hay
       cả Củ Chi – Cần Giờ là ra ngoài khung → 0 quán.
     · App lại còn tự loại mọi quán nằm ngoài khung đó, nên có dữ liệu cũng vứt.
   ⇒ Bản đồ khu mới trống trơn. Không có quán thì không có gì để chấm điểm P.

   VÌ SAO KHÔNG HỎI THẲNG OPENSTREETMAP LÚC CHẠY (đã đo thật 06/08/2026):
     Overpass quanh Biên Hoà bán kính 4km → 0 quán, sau 69 GIÂY chờ.
     Cùng chỗ đó Overture Maps có 113 quán, đủ tên + địa chỉ.
     OSM ở tỉnh gần như trống, mà chờ 69 giây thì tài xế đã chạy đi chỗ khác rồi.
   ⇒ Kho quán CẢ NƯỚC nằm sẵn trong app (api/_quanvn.js — 23.921 quán, Overture
     Maps, giấy phép CDLA-Permissive 2.0 nên được phép hiển thị & phát hành lại).
     Hỏi phát trả lời ngay, không phụ thuộc máy chủ ngoài, không lo bị chặn.

   GIỮ ĐÚNG 2 NGUYÊN TẮC CŨ:
     1) MỘT THANG ĐIỂM DUY NHẤT — trả về đúng định dạng dòng quán của /api/spots,
        nên quán khu mới chạy chung công thức P với quán TP.HCM. Không có thang riêng.
     2) KHÔNG BỊA SỐ, KHÔNG BỊA TÊN — tên + địa chỉ là nguyên văn Overture (nguồn
        thật, xem được, phát hành lại được), app ghi rõ nguồn tên là 'overture'.
        Đếm được bao nhiêu quán thì trả bấy nhiêu, khu nào ít quán thì nói thẳng.

   ĐỒNG BỘ 2 MÁY: toạ độ hỏi được LÀM TRÒN VỀ Ô LƯỚI 0,01° (~1,1km) trước khi tra.
   Hai máy đứng cùng khu → cùng ô → cùng URL → cùng bản chụp trên CDN → cùng MÃ BẢN
   (rev). Không làm tròn thì mỗi máy một toạ độ, mỗi máy một bản chụp — đúng cái lỗi
   máy A 289 quán / máy B 652 quán ngày xưa. */
export const config = { maxDuration: 30 };
import { hav, SIZE, vmGet, VM_KEY, canon, revOf, shortAddr } from './spots.js';
import { QUANVN_TXT, QUANVN_NGUON } from './_quanvn.js';

/* Chỉ phục vụ trong lãnh thổ VN: app là app lái hộ ở VN, và đây cũng là hàng rào
   để endpoint miễn phí này không bị mượn đi quét chỗ khác. */
const trongVN = (la, lo) => la > 8.0 && la < 23.6 && lo > 102.0 && lo < 110.0;

const O_LUOI = 0.01;                                  // ~1,1km — 2 máy cùng khu thì cùng ô
const BAN_KINH = 4000, BK_MAX = 8000, BK_MIN = 1500;  // 4km = đúng vùng phủ sóng app đang vẽ
const TOI_DA = 40;                                    // bản đồ app cũng chỉ vẽ 40 chỗ mạnh nhất

/* Kho quán để dạng CHUỖI trong _quanvn.js: chỉ tách dòng khi thật sự có người hỏi,
   tách xong giữ lại cho những lần sau trong cùng một tiến trình. Để sẵn dạng mảng
   thì mỗi lần máy chủ khởi động lạnh phải dựng 24.000 mảng con — trả tiền cho việc
   không ai dùng tới. */
let KHO = null;
function kho() {
  if (KHO) return KHO;
  KHO = [];
  for (const dong of QUANVN_TXT.split('\n')) {
    const c = dong.split('\t');
    if (c.length < 4) continue;
    const la = +c[2], lo = +c[3];
    if (!isFinite(la) || !isFinite(lo)) continue;
    KHO.push({ ten: c[0], cat: c[1], la, lo, dc: c[4] || '', khu: c[5] || '' });
  }
  return KHO;
}

/* Bản đồ đôi khi ghi địa chỉ bằng Plus Code ("7P28RPR4+PG") — với tài xế thì chuỗi đó
   vô nghĩa. Gặp thì bỏ đoạn đó, giữ phần đọc được. */
const laPlusCode = t => /^[A-Z0-9]{4,8}\+[A-Z0-9]{2,4}$/i.test(String(t || '').trim());
const donDiaChi = a => String(a || '').split(',').map(x => x.trim()).filter(x => x && !laPlusCode(x)).join(', ');

/* TÊN KHU — hỏi bản đồ, KHÔNG đoán theo toạ độ.
   coarseQuan() của /api/spots chỉ biết TP.HCM: hỏi nó ở Biên Hoà là nó trả "TP.HCM",
   sai trắng trợn mà tài xế không có cách nào biết. Ở đây hỏi reverse geocode; hỏi
   không được thì lấy tên khu Overture ghi kèm quán; không có nữa thì để trống chứ
   không bịa. */
async function tenKhu(la, lo, ds) {
  const rev = VM_KEY() ? await vmGet('reverse/v3', { lat: la, lng: lo }, 5000) : null;
  const f = Array.isArray(rev) ? rev[0] : null;
  if (f) {
    const bs = Array.isArray(f.boundaries) ? f.boundaries : [];
    const lay = t => { const b = bs.find(x => x.type === t); return String((b && (b.name || b.full_name)) || '').trim(); };
    const ten = [lay(1), lay(0)].filter(Boolean).join(' · ');
    if (ten) return ten;
    const ph = shortAddr(f.address).split(',').map(x => x.trim()).filter(Boolean);
    if (ph.length) return ph.slice(-2).join(' · ');
  }
  /* Bản đồ im lặng → lấy tên khu mà 10 QUÁN GẦN NHẤT ghi nhiều nhất.
     Xét cả bán kính 4km thì ở ranh giới quận sẽ lấy nhầm tên quận bên cạnh (thử ở Tạ
     Hiện – Hoàn Kiếm ra "Quận Long Biên"); xét 10 quán gần nhất thì bám đúng chỗ đứng,
     mà vẫn không bị một bản ghi ghi sai kéo đi. */
  const dem = {};
  for (const o of ds.slice().sort((a, b) => hav(la, lo, a.la, a.lo) - hav(la, lo, b.la, b.lo)).slice(0, 10)) {
    if (o.khu) dem[o.khu] = (dem[o.khu] || 0) + 1;
  }
  const top = Object.entries(dem).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return top ? top[0] : '';
}

export default async function handler(req, res) {
  const q = req.query || {};
  const la0 = parseFloat(q.lat), lo0 = parseFloat(q.lng);
  if (!isFinite(la0) || !isFinite(lo0)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ ok: false, reason: 'thieu_toa_do', loi: 'Thiếu lat/lng.' }); }
  if (!trongVN(la0, lo0)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ ok: false, reason: 'ngoai_vn', loi: 'Toạ độ nằm ngoài Việt Nam — app chỉ có dữ liệu quán trong nước.' }); }

  const la = +(Math.round(la0 / O_LUOI) * O_LUOI).toFixed(2);
  const lo = +(Math.round(lo0 / O_LUOI) * O_LUOI).toFixed(2);
  const bk = Math.max(BK_MIN, Math.min(BK_MAX, parseInt(q.r, 10) || BAN_KINH));
  const t0 = Date.now();

  /* Lọc thô bằng khung vuông trước (so sánh số, rẻ), rồi mới tính khoảng cách thật.
     dLat 1° ≈ 111km; dLng co lại theo vĩ độ nhưng ở VN (8–23,6°) hệ số nhỏ nhất vẫn
     ~0,916 nên chia cho 100km là chắc chắn không cắt nhầm quán nào. */
  const dLat = bk / 111000, dLng = bk / 100000;
  const gan = [];
  for (const o of kho()) {
    if (o.la < la - dLat || o.la > la + dLat || o.lo < lo - dLng || o.lo > lo + dLng) continue;
    const d = hav(la, lo, o.la, o.lo);
    if (d <= bk) gan.push({ o, d });
  }

  const khu = await tenKhu(la, lo, gan.map(x => x.o));

  /* Chọn 40 chỗ: gần trước, nhóm khách hay say trước. Sắp bằng số liệu cố định
     (khoảng cách + nhóm + tên) nên hai máy hỏi cùng ô luôn nhận cùng danh sách. */
  const UU = { phonhau: 0, beerclub: 0, bar: 1, karaoke: 1 };
  gan.sort((x, y) =>
    (UU[x.o.cat] || 2) - (UU[y.o.cat] || 2) || x.d - y.d ||
    (x.o.ten < y.o.ten ? -1 : x.o.ten > y.o.ten ? 1 : 0));
  const rows = gan.slice(0, TOI_DA).map(({ o }) => [
    o.ten, o.cat, o.la, o.lo, SIZE[o.cat] || 10, 7,
    o.khu || khu || '', 'osm', null, donDiaChi(o.dc), 'overture',
  ]).sort(canon);

  const rev = revOf(rows);
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.setHeader('ETag', '"' + rev + '"');
  if ((req.headers['if-none-match'] || '').includes(rev)) return res.status(304).end();
  return res.status(200).json({
    ok: true, rev, o: la.toFixed(2) + ',' + lo.toFixed(2) + '/' + bk,
    count: rows.length, spots: rows,
    coTen: rows.length,                                  // Overture có sẵn tên thật cho cả 40
    quanhDay: gan.length,                                // đếm được bao nhiêu quán trong bán kính (không cắt)
    vung: { ten: khu, lat: la, lng: lo, r: bk },
    // Nói thẳng khi khu này thưa quán — im lặng thì tài xế tưởng app hỏng
    trong: gan.length ? '' : 'Bán kính ' + (bk / 1000) + 'km quanh đây kho dữ liệu không có quán nhậu/bar/karaoke nào.',
    source: QUANVN_NGUON + ' (CDLA-Permissive 2.0)',
    ms: Date.now() - t0, updatedAt: new Date().toISOString(),
  });
}
