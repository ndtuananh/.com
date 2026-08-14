/* ══════════════════════════════════════════════════════════════════════════════
   RoadAI · Driver Radar (Bạn Uống Tôi Lái) — TẦNG LÕI (ENGINE). KHÔNG CÓ GIAO DIỆN.

   File này chỉ làm 6 việc, theo đúng thứ tự:
       NGUỒN DỮ LIỆU → CHUẨN HOÁ → LỌC TRÙNG → ĐẶC TRƯNG → DỰ BÁO → KHUYẾN NGHỊ
   và trả ra ĐÚNG MỘT vật: getDecision() — thứ duy nhất giao diện được phép đọc.

   Ai vẽ gì lên màn hình là chuyện của js/radar-ui.js.
   Ai nói chuyện với máy chủ là chuyện của js/radar-sync.js.
   Đụng document.querySelector / innerHTML trong file này là sai tầng.

   NGUYÊN TẮC KHÔNG ĐỔI (đã chốt với anh chủ, đừng phá):
   1) MỘT THANG ĐIỂM DUY NHẤT. Mọi nơi đọc r.p — "khả năng nổ được 1 cuốc nếu đứng
      ở đây 15 phút tới". Bảng xếp hạng duy nhất là m.byHot.
   2) KHÔNG BỊA SỐ. Quán thật (OpenStreetMap/Overture), thời tiết thật (Open-Meteo),
      AI chỉ học từ cuốc THẬT tài xế bấm ✅/❌.
   3) HỌC TOÀN CỤC: cuốc của MỌI máy cùng mã tài xế đều nuôi chung một bộ não
      (xem TWIN + TWIN_NET bên dưới) — một người ghi, mọi máy khá lên.
   ══════════════════════════════════════════════════════════════════════════════ */
'use strict';

/* ═══════════════════ PHẦN 1 · TIỆN ÍCH & HẰNG SỐ ═══════════════════ */
const WIN_MIN = 15;            // cửa sổ dự báo (phút)
const CITY_KMH = 26;           // tốc độ nội đô ban đêm
const ROAD_FACTOR = 1.35;      // đường thực > đường chim bay
const TICK_MS = 30000;         // cập nhật mỗi 30 giây
const RECO_FLAMES = 6;
const COVER_R = 5000;          // bán kính phủ sóng quanh tài xế (m)

const R = 6371000, toRad = d => d * Math.PI / 180;
function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sigmoid = x => 1 / (1 + Math.exp(-clamp(x, -30, 30)));
const fmtDist = m => m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km';
const fmtMin = m => m < 1 ? '<1 phút' : Math.round(m) + ' phút';
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
function drift(prev, target, vol) { return clamp(lerp(prev, target, 0.25) + (Math.random() - 0.5) * vol, 0.05, 3); }
function gmapsDir(lat, lng) { return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`; }

/* NGUỒN DỮ LIỆU MỘT ĐIỂM — 4 loại, KHÔNG được nhập nhèm với nhau:
   'butl'   = ĐIỂM ĐÓN THẬT, đọc từ ảnh chuyến BUTL của chính tài xế (js/learned-spots.js).
   'mine'   = tài xế tự bấm ➕ tại chỗ.
   'doitac' = quán ĐỐI TÁC BUTL (js/butl-partners.js) — khách quán này hay gọi lái hộ,
              nhưng CHƯA nổ cuốc thật ở đây.
   'osm'    = quán lấy từ bản đồ mở, tên ĐÃ đối chiếu. 'osm-addr' = chưa tra được tên. */
const NGUON_TEN = { google: 'Google Maps', vietmap: 'bản đồ VietMap', overture: 'Overture Maps (dữ liệu mở)', 'đệm': 'bản đồ (bản đã lưu)' };
const isZone = sp => sp.source === 'butl' || sp.source === 'mine';
// LUÔN dẫn đường tới đúng VỊ TRÍ (toạ độ) — không search theo tên để tránh ra quán đã đóng cửa
function navUrl(sp) { return gmapsDir(sp.lat, sp.lng); }
const cleanName = sp => (sp.name || '').replace(/^★\s*/, '');

const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const rid = n => { let s = ''; const A = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)]; return s; };

/* ═══════════════════ PHẦN 2 · KHUNG GIỜ CẦU LÁI HỘ ═══════════════════ */
function hourDist(a, b) { const d = Math.abs(a - b); return Math.min(d, 24 - d); }
function makeCurve(floor, peaks) {
  const c = [];
  for (let h = 0; h < 24; h++) { let v = floor; for (const p of peaks) v += p.w * Math.exp(-((hourDist(h, p.h) / (p.s || 1)) ** 2)); c.push(v); }
  const mx = Math.max(...c); return c.map(v => v / mx);
}
const CURVES = {
  phonhau:  makeCurve(0.02, [{ h: 20, w: .5, s: 1.4 }, { h: 22.5, w: 1, s: 1.6 }, { h: 0, w: .9, s: 1.7 }]),
  beerclub: makeCurve(0.02, [{ h: 23, w: 1, s: 1.6 }, { h: 1, w: .85, s: 1.7 }]),
  bar:      makeCurve(0.01, [{ h: 0, w: 1, s: 1.7 }, { h: 2, w: .8, s: 1.6 }, { h: 22.5, w: .55, s: 1.3 }]),
  karaoke:  makeCurve(0.03, [{ h: 22, w: 1, s: 1.7 }, { h: 0.5, w: .85, s: 1.6 }]),
  nhahang:  makeCurve(0.03, [{ h: 21, w: 1, s: 1.5 }, { h: 22.5, w: .55, s: 1.2 }]),
  tieccuoi: makeCurve(0.01, [{ h: 19.5, w: 1, s: 1.15 }, { h: 20.8, w: .55, s: .9 }]),
  sanbong:  makeCurve(0.02, [{ h: 23, w: 1, s: 1.9 }, { h: 1, w: .7, s: 1.6 }]),
  vanphong: makeCurve(0.02, [{ h: 20.5, w: 1, s: 1.3 }, { h: 22, w: .5, s: 1.1 }]),
  // ĐIỂM ĐÓN: địa chỉ khách (nhà/chung cư/hẻm) đã từng nổ cuốc thật — không có giờ đóng cửa.
  diemdon:  makeCurve(0.05, [{ h: 21, w: .85, s: 1.9 }, { h: 23, w: 1, s: 1.9 }, { h: 1, w: .7, s: 1.7 }]),
};
function curveAt(cat, h) { const c = CURVES[cat] || CURVES.phonhau; const f = ((h % 24) + 24) % 24; const i = Math.floor(f), n = (i + 1) % 24; return lerp(c[i], c[n], f - i); }
const VOL = { phonhau: .28, beerclub: .35, bar: .5, karaoke: .38, nhahang: .3, tieccuoi: .45, sanbong: .55, vanphong: .32, diemdon: .3 };
const CAT_VI = { phonhau: 'Phố/quán nhậu', beerclub: 'Beer club', bar: 'Bar / Pub', karaoke: 'Karaoke', nhahang: 'Nhà hàng / tiệc', tieccuoi: 'Tiệc cưới / hội nghị', sanbong: 'Quán bóng đá', vanphong: 'Khu VP (after-work)', diemdon: 'Điểm đón (địa chỉ khách)' };
const CLOSE_H = { phonhau: 0, beerclub: 1.5, bar: 2, karaoke: 1.5, nhahang: 22.75, tieccuoi: 21.5, sanbong: 1, vanphong: 22, diemdon: 2 };
const OPEN_H = { phonhau: 16, beerclub: 18, bar: 18, karaoke: 14, nhahang: 11, tieccuoi: 10, sanbong: 16, vanphong: 17, diemdon: 15 };

/* TỈ LỆ KHÁCH RỜI QUÁN THẬT SỰ CẦN LÁI HỘ (mấu chốt xếp hạng).
   Nhà hàng/tiệc cưới ĐÔNG người nhưng phần lớn đi gia đình, có người tỉnh lái về.
   Không nhân tỉ lệ này thì "Tiệc cưới White Palace" luôn leo top giờ vàng — sai thực tế. */
const LAIHO_RATE = { phonhau: 1, beerclub: .95, bar: .85, karaoke: .6, sanbong: .5, vanphong: .45, nhahang: .3, tieccuoi: .22, diemdon: 1 };
const laihoRate = sp => LAIHO_RATE[sp.cat] != null ? LAIHO_RATE[sp.cat] : .7;
const NAME_CAT = [
  [/tiệc cưới|hội nghị|wedding|palace|trung tâm tiệc|nhà hàng tiệc|hội trường/i, 'tieccuoi'],
  [/karaoke|icool|\bktv\b/i, 'karaoke'],
  [/beer ?club|bia hơi|bia tươi|brewing|brewery|beer garden/i, 'beerclub'],
  [/\bbar\b|\bpub\b|lounge|cocktail|whisky/i, 'bar'],
  [/nhậu|lẩu|nướng|hải sản|ẩm thực|quán ốc|ốc ngon|quán dê|dê núi|bò tơ|quán bia|vườn bia|bia sài gòn/i, 'phonhau'],
];
function autoCat(name, cat) {
  if (cat === 'diemdon') return cat;
  const s = String(name || '');
  for (const [re, c] of NAME_CAT) {
    if (!re.test(s)) continue;
    if (c === 'tieccuoi' || c === 'karaoke') return c;
    if (cat === 'nhahang' || !cat) return c;
    return cat;
  }
  return cat;
}
function fmtClose(ch) { ch = ((ch % 24) + 24) % 24; const h = Math.floor(ch), m = Math.round((ch - h) * 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
const SERVICE_FROM = 14;        // đề xuất + báo về điện thoại từ 14h; ngoài khung 14h–03h thì KHÔNG
function withinService(hour) { return hour >= SERVICE_FROM || hour < 3; }
function isOpen(sp, hour) {     // quán ĐANG MỞ? (xử lý qua nửa đêm) — ưu tiên giờ THẬT từ bản đồ
  let o = sp.gioMo != null ? sp.gioMo : (OPEN_H[sp.cat] != null ? OPEN_H[sp.cat] : 16), c = sp.closeH;
  if (c <= o) c += 24;
  /* Dời sang ngày hôm sau khi giờ hiện tại nằm TRƯỚC CẢ khung dung sai 30 phút.
     Bản cũ so `h < o`: quán mở 16h thì lúc 15:45 bị dời thành 39:45 → luôn báo
     ĐÓNG, tức là dòng "o - 0.5" bên dưới thành vô nghĩa. Đúng nửa tiếng trước
     giờ mở là lúc tài xế cần biết để chạy tới đón đầu. */
  let h = hour; if (h < o - 0.5) h += 24;
  return h >= o - 0.5 && h <= c + 0.25;
}

/* ═══════════════════ PHẦN 3 · DATA SERVICE ═══════════════════
   MỘT cửa duy nhất gom 5 nguồn điểm rồi chuẩn hoá + lọc trùng:
     ① js/spots.js hoặc /api/spots  → quán DÙNG CHUNG (global, mọi máy như nhau)
     ② /api/quanh (Overture)        → quán KHU tài xế đang đứng (cache của máy)
     ③ js/learned-spots.js          → điểm đón THẬT từ ảnh chuyến BUTL (global)
     ④ js/butl-partners.js          → quán đối tác BUTL (global)
     ⑤ PICKS_ALL                    → điểm tự nạp, đã GỘP mọi máy (dữ liệu USER)
   Giao diện KHÔNG được gọi thẳng nguồn nào ở trên. */
const SEED_FALLBACK = [
  ['Phố nhậu Đường Tên Lửa', 'phonhau', 10.74406, 106.61316, 16, 5, 'Bình Tân'],
  ['Nhậu Kinh Dương Vương', 'phonhau', 10.74169, 106.61434, 12, 6, 'Bình Tân'],
  ['Phố Tây Bùi Viện', 'bar', 10.76700, 106.69260, 14, 5, 'Quận 1'],
  ['Phố nhậu Phạm Văn Đồng', 'phonhau', 10.83958, 106.73850, 14, 9, 'Bình Thạnh'],
];
const OSM_SPOTS = (typeof window !== 'undefined' && window.LAIHO_SPOTS && window.LAIHO_SPOTS.length) ? window.LAIHO_SPOTS : SEED_FALLBACK;

/* ---- ĐIỂM ĐÓN TỰ NẠP (➕) — có DANH TÍNH, có BẰNG CHỨNG, ĐỒNG BỘ NHIỀU MÁY ----
   MY_PICKS   = phần đóng góp của RIÊNG máy này (thứ gửi lên máy chủ)
   PICKS_ALL  = bản đã GỘP mọi máy (thứ app dùng để chạy & hiển thị)
   Tách 2 cái này là BẮT BUỘC: lấy số đã gộp gửi ngược lên thì máy chủ cộng dồn
   lần nữa → số cuốc phồng gấp đôi, tức là app tự bịa số. */
const MYPICK_LS = 'roadai_laiho_mypickups_v1';      // bản cũ, chỉ đọc 1 lần để chuyển đổi
const PICKS_LS = 'roadai_butl_picks_v2';
const PICK_MERGE_M = 55;                            // dưới 55m coi như cùng một quán
const isAutoName = s => /^★ Nổ cuốc|^Điểm đón của tôi/.test(s || '');

let MY_PICKS = ls(PICKS_LS, null);
if (!Array.isArray(MY_PICKS)) {                     // chuyển đổi từ bản cũ, không mất điểm nào
  MY_PICKS = (ls(MYPICK_LS, []) || []).filter(Array.isArray).map((a, i) => ({
    id: 'm' + rid(7), name: a[0], cat: a[1], lat: +a[2], lng: +a[3], quan: a[6] || 'Tôi thêm',
    ts: Date.now() - (1000 - i), n: 0, win: 0, fix: 0, del: 0,
  }));
  lsSet(PICKS_LS, MY_PICKS);
}
let PICKS_ALL = MY_PICKS.slice();
function savePicks() { lsSet(PICKS_LS, MY_PICKS); rebuildPicksAll(); }
function livePicks(a) { return a.filter(p => !p.del); }
// gộp tại chỗ khi chưa gọi được máy chủ (mất mạng) — cùng luật 55m như máy chủ
function rebuildPicksAll() {
  const kept = [];
  for (const p of livePicks(MY_PICKS).slice().sort((a, b) => a.ts - b.ts)) {
    const hit = kept.find(k => haversine(k, p) < PICK_MERGE_M);
    if (!hit) { kept.push({ ...p }); continue; }
    hit.n += p.n; hit.win += p.win;
    if (isAutoName(hit.name) && !isAutoName(p.name)) hit.name = p.name;
  }
  PICKS_ALL = kept;
}
/* Ô thứ 18 (xeKhai) = LOẠI XE TÀI XẾ KHAI lúc thêm quán. Đây là LỜI KHAI, không
   phải cuốc đếm được — cố ý để riêng, không cộng vào oto/may (thứ đếm từ cuốc
   thật). Trộn hai cái là app tự bịa thành tích. */
const pickRow = p => [p.name, p.cat || 'phonhau', p.lat, p.lng, 13, 7, p.quan || 'Tôi thêm', 'mine', p.id,
  p.addr || '', '', '', undefined, undefined, null, null, '', p.xe || ''];
/* LỌC TRÙNG 3 kho điểm THẬT: chỉ gộp khi gần như chắc chắn LÀ MỘT CHỖ —
   cùng tên & dưới 250m, hoặc sát nhau dưới 35m. Gộp bừa theo khoảng cách sẽ nuốt
   quán thật (Nam Phương Lầu và Warning Zone Võ Văn Tần cách ~100m nhưng là 2 quán). */
const nameKeyOf = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
function sameSpot(a, b) {
  const d = haversine({ lat: a[2], lng: a[3] }, { lat: b[2], lng: b[3] });
  if (d < 35) return true;
  if (d > 250) return false;
  const ka = nameKeyOf(a[0]), kb = nameKeyOf(b[0]);
  if (!ka.length || !kb.length) return false;
  const hit = ka.filter(w => kb.includes(w)).length;
  return hit / Math.min(ka.length, kb.length) >= 0.6;
}
function extraSpots() {
  const W = typeof window !== 'undefined' ? window : {};
  const all = livePicks(PICKS_ALL).map(pickRow).concat(W.LEARNED_SPOTS || [], W.BUTL_SPOTS || []);
  const kept = [];
  for (const r of all) { if (!kept.some(k => sameSpot(k, r))) kept.push(r); }
  return kept;
}
const myPick = id => PICKS_ALL.find(p => p.id === id) || null;
const ownPick = id => MY_PICKS.find(p => p.id === id) || null;
function nearPick(list, lat, lng, m) { let best = null, bd = m == null ? PICK_MERGE_M : m; for (const p of list) { if (p.del) continue; const d = haversine({ lat, lng }, p); if (d < bd) { bd = d; best = p; } } return best; }
/* Thêm điểm — TRÙNG CHỖ THÌ GỘP, không đẻ chấm mới. Trả về {p, gop}. */
function upsertPick(name, lat, lng, cat, quan, xe, addr) {
  lat = +(+lat).toFixed(5); lng = +(+lng).toFixed(5);
  const hit = nearPick(MY_PICKS, lat, lng);
  if (hit) {
    if (name && !isAutoName(name) && isAutoName(hit.name)) hit.name = name;
    if (cat) hit.cat = cat;
    if (xe) hit.xe = xe;                 // khai lại loại xe thì lấy lời khai mới nhất
    if (addr) hit.addr = String(addr).slice(0, 120);
    if (quan) hit.quan = String(quan).slice(0, 40);
    hit.ts = Date.now(); hit.del = 0;
    savePicks(); return { p: hit, gop: true };
  }
  const p = { id: 'm' + rid(7), name: (name || 'Điểm đón của tôi').trim().slice(0, 70), cat: cat || 'phonhau',
    lat, lng, quan: (quan || 'Tôi thêm').slice(0, 40), addr: String(addr || '').slice(0, 120),
    xe: xe || '', ts: Date.now(), n: 0, win: 0, fix: 0, del: 0 };
  MY_PICKS.push(p); savePicks(); return { p, gop: false };
}
/* NẮN TOẠ ĐỘ: mỗi cuốc thật ở đây kéo điểm về đúng chỗ GPS đo được (trung bình động). */
function refinePick(p, lat, lng) {
  if (!p || !isFinite(lat) || !isFinite(lng)) return;
  const w = 1 / Math.min(8, (p.fix || 0) + 2);
  const nlat = +(p.lat + (lat - p.lat) * w).toFixed(5), nlng = +(p.lng + (lng - p.lng) * w).toFixed(5);
  if (nlat === p.lat && nlng === p.lng) return;
  p.lat = nlat; p.lng = nlng; p.fix = (p.fix || 0) + 1; p.ts = Date.now();
}
/* Ghi 1 cuốc thật vào đúng điểm tự nạp. Điểm do MÁY KIA nạp thì máy này chưa có bản
   ghi riêng → phải tạo bản ghi TRẮNG (n=0/win=0) rồi mới cộng. Chép số đã gộp vào đây
   là lần sau máy chủ cộng thêm lần nữa → phồng số. */
function creditPick(id, win, gpsLat, gpsLng, xe, chiQuanSat) {
  let p = ownPick(id);
  if (!p) {
    const m = myPick(id); if (!m) return null;
    p = { ...m, n: 0, win: 0, fix: 0, del: 0, ts: Date.now() };
    MY_PICKS.push(p);
  }
  if (chiQuanSat) { p.dong = (p.dong || 0) + 1; p.ts = Date.now(); savePicks(); return p; }
  p.n++; if (win) p.win++;
  if (win && xe === 'oto') p.oto = (p.oto || 0) + 1;
  if (win && xe === 'may') p.may = (p.may || 0) + 1;
  if (win && gpsLat != null) refinePick(p, gpsLat, gpsLng);
  p.ts = Date.now(); savePicks(); return p;
}
/* Trạng thái kiểm chứng của 1 điểm — dùng CHÍNH số cuốc thật, không suy đoán */
function pickStatus(p) {
  const n = p.n || 0, w = p.win || 0, rate = n ? w / n : 0;
  if (n < 3) return { k: 'moi', vi: 'Đang thu thập', cls: 'st-new', rate, n, w, note: `cần ${3 - n} cuốc nữa để kết luận` };
  if (rate >= 0.5) return { k: 'tot', vi: 'Đã chứng minh', cls: 'st-good', rate, n, w, note: 'điểm ăn — app đẩy lên ưu tiên' };
  if (n >= 6 && rate < 0.17) return { k: 'yeu', vi: 'Ít hiệu quả', cls: 'st-bad', rate, n, w, note: 'chạy nhiều mà ít khách — cân nhắc xoá' };
  return { k: 'thuong', vi: 'Bình thường', cls: 'st-mid', rate, n, w, note: 'có khách nhưng chưa đều' };
}
function mergeLearned(base) {
  const Ls = extraSpots(); if (!Ls.length) return base;
  const near = (a, b) => { const dLat = a[2] - b[2], dLng = a[3] - b[3]; return dLat * dLat + dLng * dLng < 0.0013 * 0.0013; };
  return Ls.concat(base.filter(b => !Ls.some(l => near(l, b))));
}

/* ═══ QUÁN KHU MỚI (chạy sang tỉnh khác) — TÁCH LÀM HAI THỨ KHÁC NHAU ═══
   SỔ KHU (ZONE_REG)  = DỮ LIỆU TÀI KHOẢN. Chỉ ghi Ô LƯỚI + tên + tâm + mốc thời
       gian. Đồng bộ lên máy chủ: MỘT máy nạp được khu nào là CẢ TÀI KHOẢN có khu
       đó, máy khác đang mở app tự nạp theo trong ~12 giây, không ai phải bấm gì.
   KHO QUÁN KHU (VUNG) = CACHE CỦA MÁY. Danh sách quán thật, lấy từ /api/quanh.
       KHÔNG đồng bộ, và KHÔNG CẦN đồng bộ: /api/quanh làm tròn toạ độ về ô lưới
       0,01° rồi trả bản chụp CDN, nên mọi máy hỏi cùng ô luôn nhận CÙNG danh sách,
       CÙNG MÃ BẢN. Nhét cả danh sách quán lên máy chủ chỉ làm gói đồng bộ phình
       ~36KB mỗi lần kéo mà không chắc chắn hơn được tí nào.
   Trước bản 12/08/2026 chỉ có VUNG: anh Long chạy sang Biên Hoà, máy A nạp được
   quán, máy B mở lên vẫn trống trơn — dữ liệu tài khoản bị lưu nhầm thành dữ liệu
   của máy, đúng thứ §22 cấm. */
const VUNG_LS = 'roadai_laiho_vung_v1';
const ZONEREG_LS = 'roadai_butl_zones_v1';
/* 16 KHU — BẰNG ĐÚNG sức chứa sổ khu trên máy chủ (MAX_ZONES trong api/pickups.js).
   Trước để 6 "khu gần chỗ đang đứng nhất" cho nhẹ máy, nhưng thế thì máy A ở Bình Tân
   và máy B ở Biên Hoà giữ hai bộ khu khác nhau → KHÔNG bao giờ đồng nhất 100% được.
   Giữ hết sổ thì mọi máy có y hệt nhau, kiểm chứng được bằng MÃ QUÁN (banQuan()).
   Giá phải trả: ~640 điểm khu + ~400 điểm dùng chung ≈ 1.040 điểm — đã đo, một vòng
   tính lại vẫn dưới 250ms, và 128KB trong bộ nhớ máy (giới hạn ~5MB). */
const VUNG_TOI_DA = 16;
const VUNG_HAN = 45 * 864e5;           // quá 45 ngày không tới thì bỏ, quán cũng đổi rồi
const VUNG_GAN = 4000;                 // xét "khu này app có quán chưa" trong bán kính 4km
const VUNG_IT = 6;                     // dưới 6 quán trong 4km = coi như khu chưa có dữ liệu
const vungKey = (lat, lng) => (Math.round(lat / 0.01) * 0.01).toFixed(2) + ',' + (Math.round(lng / 0.01) * 0.01).toFixed(2);
const vungHopLe = v => v && Array.isArray(v.spots) && v.spots.length && isFinite(v.lat) && isFinite(v.lng) && typeof v.key === 'string';
let VUNG = (() => {
  const a = ls(VUNG_LS, []);
  return Array.isArray(a) ? a.filter(v => vungHopLe(v) && (Date.now() - (v.ts || 0)) < VUNG_HAN).slice(0, VUNG_TOI_DA) : [];
})();
/* Lưu AN TOÀN: máy đầy thì bỏ dần khu cũ rồi thử lại, chứ KHÔNG nuốt lỗi.
   Bản cũ catch rỗng nên app cứ như bị hỏng mà không ai biết vì sao. */
function luuVung() {
  for (let i = 0; i < VUNG_TOI_DA + 2; i++) {
    if (lsSet(VUNG_LS, VUNG)) { G.boNhoDay = false; return true; }
    if (VUNG.length > 1) { VUNG.sort((a, b) => b.ts - a.ts); VUNG.pop(); continue; }
    if (!G._daDonNhatKy) { G._daDonNhatKy = true; donNhatKy(400); continue; }
    G.boNhoDay = true; return false;
  }
  G.boNhoDay = true; return false;
}
const vungRows = () => VUNG.flatMap(v => v.spots.map(r => { const x = r.slice(); x[8] = 'vung:' + v.key; return x; }));

/* ---- SỔ KHU DÙNG CHUNG ---- */
let ZONE_REG = (() => { const a = ls(ZONEREG_LS, []); return Array.isArray(a) ? a : []; })();
// máy cũ nâng cấp lên: khu nào đang có trong máy thì đưa vào sổ, để đẩy lên cho máy kia
if (!ZONE_REG.length && VUNG.length) {
  ZONE_REG = VUNG.map(v => ({ key: v.key, ten: v.ten || '', lat: +(+v.lat).toFixed(2), lng: +(+v.lng).toFixed(2),
    r: v.r || VUNG_GAN, ts: v.ts || Date.now(), rev: v.rev || '', n: (v.spots || []).length, del: 0 }));
  lsSet(ZONEREG_LS, ZONE_REG);
}
const luuSoKhu = () => lsSet(ZONEREG_LS, ZONE_REG);
const soKhuSong = () => ZONE_REG.filter(z => !z.del);
function ghiSoKhu(z) {
  const i = ZONE_REG.findIndex(x => x.key === z.key);
  if (i < 0) ZONE_REG.push(z); else ZONE_REG[i] = z;
  luuSoKhu();
}
/* Máy chủ trả sổ khu đã gộp → máy này theo, rồi TỰ ĐI NẠP những khu chưa có.
   Đây chính là "một máy nạp xong, mọi máy đang mở đều có" — không thao tác tay. */
function applyZones(list) {
  if (!Array.isArray(list)) return false;
  const truoc = soKhuSong().map(z => z.key).sort().join('|');
  ZONE_REG = list.map(z => ({ ...z })); luuSoKhu();
  // khu bị máy khác xoá → bỏ luôn kho quán của khu đó ở máy này
  const song = new Set(soKhuSong().map(z => z.key));
  const truocN = VUNG.length;
  VUNG = VUNG.filter(v => song.has(v.key));
  if (VUNG.length !== truocN) { luuVung(); buildSpots(null); }
  const sau = [...song].sort().join('|');
  napKhuThieu();
  return truoc !== sau;
}
/* Nạp nốt những khu có trong sổ mà máy này chưa có quán. Chỉ giữ VUNG_TOI_DA khu
   GẦN CHỖ ĐANG ĐỨNG NHẤT — sổ có thể tới 16 khu, nhưng điện thoại tài xế không cần
   ôm hết cả nước; khu nào xa thì lúc chạy tới sẽ nạp. */
let _dangNapThieu = false;
async function napKhuThieu() {
  if (_dangNapThieu || !G.autoData) return;
  const co = new Set(VUNG.map(v => v.key));
  const can = soKhuSong()
    .map(z => ({ z, d: haversine(G.you, z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, VUNG_TOI_DA)
    // _daThuVung: khu nào đã thử trong phiên này thì thôi. Thiếu chốt này, một khu
    // rỗng (kho không có quán nào) sẽ bị gọi lại mỗi 12 giây suốt buổi tối.
    .filter(x => !co.has(x.z.key) && !_daThuVung.has(x.z.key));
  if (!can.length) return;
  _dangNapThieu = true;
  try {
    for (const { z } of can) {
      // nạp theo ĐÚNG ô lưới trong sổ (không phải chỗ mình đang đứng) và KHÔNG ghi
      // lại mốc thời gian — ghi lại là hai máy đẩy qua đẩy lại nhau không dứt.
      const ok = await napVung(false, z);
      if (!ok) break;                      // mạng hỏng thì thôi, lát nữa hỏi lại
    }
  } finally { _dangNapThieu = false; }
}
function themVung(base) {
  const rows = vungRows(); if (!rows.length) return base;
  const G80 = 0.00072;                                     // ~80m theo độ, khỏi gọi haversine 100.000 lần
  const moi = rows.filter(r => !base.some(b => Math.abs(b[2] - r[2]) < G80 && Math.abs(b[3] - r[3]) < G80));
  return base.concat(moi);
}

/* ═══ QUÁN NHẬU BỔ SUNG (danh sách chủ app cung cấp) — /api/quan ═══
   Khác hai kho trên ở chỗ: kho này có GIỜ MỞ/ĐÓNG THẬT của từng quán. App vốn phải
   ƯỚC giờ tan quán theo nhóm ("quán nhậu ~0h"); có giờ thật thì sóng tan quán tính
   đúng chỗ và tài xế canh đón đầu được — đây là thứ quý nhất của danh sách này.
   Là DỮ LIỆU DÙNG CHUNG: mọi máy nhận cùng một bản chụp CDN, cùng MÃ BẢN. Cache
   xuống máy để mất mạng vẫn còn; /api/quan còn có bản tĩnh nằm trong mã nguồn nên
   Supabase ngủ cũng không ai mất dữ liệu. */
const QUANBO_LS = 'roadai_butl_quanbo_v1';
let QUAN_BO = (() => { const c = ls(QUANBO_LS, null); return (c && Array.isArray(c.spots)) ? c.spots : []; })();
const G80 = 0.00072;   // ~80m tính theo độ — đủ để coi là một chỗ, khỏi gọi haversine 100.000 lần
function themBo(base) {
  if (!QUAN_BO.length) return base;
  const moi = QUAN_BO.filter(r => !base.some(b => Math.abs(b[2] - r[2]) < G80 && Math.abs(b[3] - r[3]) < G80));
  return base.concat(moi);
}
let refreshingBo = false;
async function refreshQuanBo(force) {
  if (refreshingBo) return false;
  const c = ls(QUANBO_LS, null);
  if (!force && c && (Date.now() - (c.ts || 0)) < 6 * 3600e3) return false;   // 6 tiếng/lần là đủ
  refreshingBo = true;
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
    let r; try { r = await fetch('/api/quan', { cache: 'no-store', signal: ctl.signal }); } finally { clearTimeout(to); }
    if (!r.ok) return false;
    const j = await r.json();
    if (!(j && j.ok && Array.isArray(j.spots) && j.spots.length >= 10)) return false;
    const doi = !c || c.rev !== j.rev;
    lsSet(QUANBO_LS, { ts: Date.now(), rev: j.rev, nguon: j.nguon, coGio: j.coGio, spots: j.spots });
    QUAN_BO = j.spots;
    G.quanBo = { rev: j.rev, so: j.spots.length, coGio: j.coGio, nguon: j.nguon, at: Date.now() };
    if (doi) { buildSpots(null); G.lastBestId = null; recompute(); }
    return true;
  } catch (e) { return false; } finally { refreshingBo = false; }
}

let SPOTS = [], DMAT = [];
/* Một HÀNG của bảng khoảng cách quán–quán, tính khi cần rồi giữ lại.
   Bản cũ tính TRƯỚC toàn bộ n×n: 645 quán = 416.000 phép = 2,1 GIÂY mỗi lần dựng lại.
   Thực tế chỉ ~40 hàng được dùng. */
function dongDMAT(i) {
  let d = DMAT[i];
  if (d) return d;
  const a = SPOTS[i]; if (!a) return null;
  d = DMAT[i] = new Float64Array(SPOTS.length);
  for (let j = 0; j < SPOTS.length; j++) d[j] = haversine(a, SPOTS[j]);
  return d;
}
/* BASE_SPOTS = danh sách quán dùng chung đang hiệu lực (đã đồng bộ từ server).
   Phải nhớ lại: mỗi lần thêm/xoá điểm đón mà gọi buildSpots() không kèm dữ liệu thì
   rơi ngược về danh sách dựng sẵn → 2 máy lệch nhau ngay. */
let BASE_SPOTS = null;
function buildSpots(data) {
  if (data && data.length) BASE_SPOTS = data;
  // thứ tự nối: dùng chung → khu tự nạp → danh sách bổ sung → điểm THẬT (đè lên trên cùng)
  const src = mergeLearned(themBo(themVung(BASE_SPOTS && BASE_SPOTS.length ? BASE_SPOTS : OSM_SPOTS)));
  SPOTS = src.map(([name, cat0, lat, lng, size, homeKm, quan, source, pid, addr, prec, evi, gioMo, gioDong, sao, luot, ghiChu, xeKhai], i) => {
    const cat = autoCat(name, cat0);
    /* CHỐT CHẶN CUỐI: dòng nào KHÔNG ghi rõ nguồn đã kiểm thì coi là CHƯA KIỂM ĐƯỢC TÊN
       → app tự thay tên bằng địa chỉ thật, không bao giờ hiện tên chưa tra. */
    // 'ds' = danh sách quán nhậu chủ app cung cấp, toạ độ đã tra bản đồ thật → tên dùng được
    const srcOk = source === 'butl' || source === 'mine' || source === 'doitac' || source === 'osm' || source === 'ds';
    const src2 = srcOk ? source : 'osm-addr';
    const nameOut = src2 === 'osm-addr' ? (CAT_VI[cat] || 'Điểm') + ' · ' + (String(addr || '').split(',')[0].trim() || quan || 'chưa rõ địa chỉ') : name;
    return {
      id: 's' + i, pid: pid || null, name: nameOut, cat, cat0, lat, lng, size, homeKm, quan, source: src2,
      vung: (typeof pid === 'string' && pid.indexOf('vung:') === 0) ? pid.slice(5) : null,
      addr: addr || '', prec: prec || '', evi: evi || '', ghiChu: ghiChu || '',
      // LỜI KHAI của tài xế lúc thêm quán — dùng khi chưa có cuốc thật nào để đếm
      xeKhai: (xeKhai === 'oto' || xeKhai === 'may' || xeKhai === 'ca2') ? xeKhai : '',
      sao: sao || null, luot: luot || null, gioMo: soThat(gioMo),
      /* ⚠️ PHẢI DÙNG Number.isFinite, KHÔNG dùng isFinite.
         isFinite(null) === TRUE (JS ép null thành 0). Dòng quán đi qua JSON (từ
         /api/quan, /api/spots) mang gioDong = null cho quán KHÔNG BIẾT GIỜ → app
         tuyên bố "giờ thật" và chốt giờ tan quán = 00:00. Tức là bịa giờ đóng cửa
         cho hàng trăm quán, rồi canh sóng tan quán sai bét. Bộ tự kiểm bắt được. */
      gioThat: soThat(gioDong) != null,
      closeH: soThat(gioDong) != null ? soThat(gioDong) : (CLOSE_H[cat] != null ? CLOSE_H[cat] : 0) + (Math.random() - .5) * 0.5,
      noise: 0.9 + Math.random() * 0.2,
    };
  });
  DMAT = [];
  if (G && G.dataStatus) {
    const c = spotCounts(); G.dataStatus.count = c.shared; G.dataStatus.mine = c.mine; G.dataStatus.vung = c.vung; G.dataStatus.total = c.total;
  }
}
/* Số THẬT hay không có số — null/''/undefined đều là KHÔNG CÓ.
   Viết riêng vì isFinite(null) trả về true, đã làm app bịa giờ đóng cửa (xem buildSpots). */
function soThat(v) { if (v == null || v === '') return null; const n = +v; return Number.isFinite(n) ? n : null; }
const spotKey = sp => sp.name + '@' + (+sp.lat).toFixed(4) + ',' + (+sp.lng).toFixed(4);

/* ═══ MÃ QUÁN — vân tay của TOÀN BỘ kho điểm máy này đang chạy ═══
   Hai máy mở mục Chẩn đoán, thấy MÃ QUÁN giống nhau = dữ liệu quán giống nhau
   100%, không phải tin suông. Khác mã = còn khu nào đó chưa nạp xong.
   Băm trên danh sách ĐÃ SẮP XẾP nên không phụ thuộc thứ tự gộp; cố ý bỏ id
   (đánh theo vị trí) và closeH (có nhiễu ngẫu nhiên) ra ngoài. */
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h.toString(36).toUpperCase().padStart(7, '0').slice(-7); }
function banQuan() {
  /* Phải trừ ĐIỂM ĐÃ ẨN ra. Điểm bị báo "đóng cửa/sai" vẫn nằm trong SPOTS nhưng
     không được đề xuất, nên hai máy lệch nhau đúng chỗ đó mà mã vẫn giống thì mã
     này vô dụng. Băm trên đúng thứ đang CHẠY. (Bộ tự kiểm bắt được lỗi này.) */
  const a = SPOTS.filter(s => !HIDDEN.has(spotKey(s)))
    .map(s => s.source + '|' + (+s.lat).toFixed(5) + ',' + (+s.lng).toFixed(5) + '|' + s.name).sort();
  return { ma: fnv(a.join('\n')), n: a.length };
}
/* Đếm TÁCH BẠCH 3 loại — 2 máy chỉ buộc phải khớp nhau ở "quán dùng chung". */
function spotCounts() {
  let mine = 0, vung = 0;
  for (const s of SPOTS) { if (s.source === 'mine') mine++; else if (s.vung) vung++; }
  return { shared: SPOTS.length - mine - vung, mine, vung, total: SPOTS.length };
}

/* ═══════════════════ PHẦN 4 · TRẠNG THÁI CHUNG ═══════════════════ */
const LKEYS = ['demand', 'eta', 'trend', 'twin'];
const G = {
  you: { lat: 10.7420, lng: 106.6110 },   // mặc định An Lạc/Tên Lửa (GPS ghi đè)
  hasGps: false, youFromGps: false, online: true, simHour: null,
  dayType: 'weekday', match: false,
  rain: 0, rainManual: false, weather: null,
  filter: 'all', base: 'dark', tick: 0,
  metrics: null, decision: null, lastBestId: null, pendingLog: null, chainFrom: null,
  jobsN: 0, dataStatus: null, notifOn: true, autoData: true, showForecast: true,
  hienHet: false,        // "hiện hết quán (kể cả đang đóng)" — mặc định TẮT
  // Hiệu chuẩn THẬT: điểm tốt nhất giờ vàng ~70–80%, điểm thường ~30%, điểm yếu ~10%.
  theta: [-3.6, 2.4, 1.6, 0.8, 0.6],       // [bias, demand, eta, trend, twin]
  weights: { demand: 1, eta: 1, trend: 0.7, twin: 0.8 },
  meanX: [0.4, 0.5, 0.5, 0.5], meanY: 0.3, cov: [0, 0, 0, 0],
  brierModelEma: 0.25, brierBaseEma: 0.25, skill: 0, skillHist: [], resolved: 0,
  days: 0, lastDay: null, brainSaved: 0,
  session: { start: Date.now(), suggested: 0, accepted: 0, rides: 0 },
};
const THETA0 = G.theta.slice();

/* NÃO AI LƯU VĨNH VIỄN — mỗi ngày mở app là thông minh hơn hôm qua.
   Đây là DEVICE DATA (trọng số mô hình đã hiệu chuẩn theo chính máy này);
   dữ liệu nghiệp vụ sinh ra nó (cuốc thật) thì nằm ở máy chủ, xem PHẦN 5. */
const BRAIN_LS = 'roadai_laiho_brain_v1';
const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const okArr = (a, n) => Array.isArray(a) && a.length === n && a.every(x => typeof x === 'number' && isFinite(x));
function saveBrain() {
  const ok = lsSet(BRAIN_LS, {
    v: 1, theta: G.theta, weights: G.weights, meanX: G.meanX, meanY: G.meanY, cov: G.cov,
    brierModelEma: G.brierModelEma, brierBaseEma: G.brierBaseEma, skill: G.skill,
    skillHist: G.skillHist.slice(-120), resolved: G.resolved, days: G.days, lastDay: G.lastDay, ts: Date.now(),
  });
  if (ok) G.brainSaved = Date.now();
}
function loadBrain() {
  const b = ls(BRAIN_LS, null);
  if (b && okArr(b.theta, 5)) G.theta = b.theta.slice();
  if (b && b.weights) for (const k of LKEYS) if (isFinite(b.weights[k])) G.weights[k] = clamp(b.weights[k], 0.1, 2.2);
  if (b && okArr(b.meanX, 4)) G.meanX = b.meanX.slice();
  if (b && isFinite(b.meanY)) G.meanY = clamp(b.meanY, 0.02, 0.98);
  if (b && okArr(b.cov, 4)) G.cov = b.cov.slice();
  if (b && isFinite(b.brierModelEma)) G.brierModelEma = b.brierModelEma;
  if (b && isFinite(b.brierBaseEma)) G.brierBaseEma = b.brierBaseEma;
  if (b && isFinite(b.skill)) G.skill = clamp(b.skill, 0, 1);
  if (b && Array.isArray(b.skillHist)) G.skillHist = b.skillHist.filter(isFinite).slice(-120);
  if (b && isFinite(b.resolved)) G.resolved = b.resolved;
  G.days = (b && isFinite(b.days)) ? b.days : 0;
  G.lastDay = (b && b.lastDay) || null;
  const t = todayKey();
  if (G.lastDay !== t) { if (G.lastDay) G.days++; G.lastDay = t; saveBrain(); }
}
const DAY_MULT = { weekday: 1, weekend: 1.8, payday: 1.35, holiday: 2.4 };
const DAY_VI = { weekday: 'Ngày thường', weekend: 'Cuối tuần', payday: 'Ngày lương', holiday: 'Lễ / cận Tết' };

/* KHUNG GIỜ NGHỀ LÁI HỘ — học theo TỪNG GIỜ (24 ô) thì cả đời tài xế cũng không đủ
   mẫu; gom về 4 khung đúng nhịp nghề thì vài cuốc là mỗi khung đã có tiếng nói. */
const BANDS = [
  { k: 'chieu', vi: 'Chiều 14–18h', ico: '🌤️' },
  { k: 'toi',   vi: 'Tối 18–21h',   ico: '🌆' },
  { k: 'vang',  vi: 'Giờ vàng 21–24h', ico: '🍺' },
  { k: 'khuya', vi: 'Khuya 00–03h', ico: '🌙' },
];
const BAND_VI = BANDS.reduce((o, b) => (o[b.k] = b.vi, o), { ngoai: 'Ngoài giờ lái hộ' });
function bandOf(h) {
  const f = ((h % 24) + 24) % 24;
  if (f >= 21) return 'vang';
  if (f < 3) return 'khuya';
  if (f >= 18) return 'toi';
  if (f >= 14) return 'chieu';
  return 'ngoai';
}

/* ═══════════════════ PHẦN 5 · KHO CUỐC THẬT + DIGITAL TWIN ═══════════════════
   ĐÂY LÀ DỮ LIỆU NGHIỆP VỤ (USER DATA), KHÔNG PHẢI DỮ LIỆU CỦA MÁY.
   Trước bản này nhật ký cuốc chỉ nằm trong localStorage một máy: anh ghi 40 cuốc ở
   máy A thì máy B vẫn ngu như ngày đầu. Giờ tách đúng như đã làm với điểm tự nạp:

     MY_TRIPS  = cuốc do CHÍNH MÁY NÀY ghi   → thứ gửi lên máy chủ
     NET_TRIPS = cuốc các MÁY KHÁC ghi       → máy chủ trả về (đã lọc bỏ máy này)
     allTrips() = hợp của hai cái trên, lọc trùng theo id → thứ mọi thống kê đọc

   TWIN (bộ đếm học được) cũng tách y hệt:
     TWIN     = cộng dồn tại chỗ từ cuốc của máy này (giữ nguyên lịch sử cũ, không mất)
     TWIN_NET = dựng lại từ NET_TRIPS mỗi lần máy chủ trả bản mới
   Đọc thì cộng cả hai (twinGet). Không thể cộng nhầm: mỗi cuốc chỉ nằm ở đúng một bên. */
const TWIN_LS = 'roadai_laiho_twin_v1';
const TRIPS_LS = 'roadai_butl_trips_v3';     // cuốc của RIÊNG máy này (có id)
const NET_LS = 'roadai_butl_trips_net_v3';   // bản chụp cuốc máy khác (để mở app offline vẫn thông minh)
const JOBS_LS = 'roadai_laiho_jobs_v1';      // bản CŨ — chỉ đọc 1 lần để chuyển đổi, không xoá
const TRIP_MAX = 1500;

const emptyTwin = () => ({ cat: {}, hour: {}, slot: {}, spot: {}, band: {}, cb: {}, sb: {}, xe: {}, obs: {} });
let TWIN = (() => {
  const empty = emptyTwin(), t = ls(TWIN_LS, {}) || {};
  for (const k in empty) if (t[k] && typeof t[k] === 'object') empty[k] = t[k];
  return empty;
})();
let TWIN_NET = emptyTwin();
function saveTwin() { lsSet(TWIN_LS, TWIN); }

/* ---- kho cuốc ---- */
let MY_TRIPS = ls(TRIPS_LS, null);
if (!Array.isArray(MY_TRIPS)) {                 // chuyển nhật ký cũ sang, KHÔNG mất cuốc nào
  MY_TRIPS = (ls(JOBS_LS, []) || []).filter(j => j && typeof j === 'object')
    .map(j => ({ ...j, id: j.id || ('t' + rid(10)) }));
  lsSet(TRIPS_LS, MY_TRIPS);
}
let NET_TRIPS = (() => { const a = ls(NET_LS, []); return Array.isArray(a) ? a : []; })();
let _allTrips = null, _nkIdx = null;
function invalidateTrips() { _allTrips = null; _nkIdx = null; }
function allTrips() {
  if (_allTrips) return _allTrips;
  const seen = new Set(), out = [];
  for (const t of MY_TRIPS.concat(NET_TRIPS)) {
    const k = t && (t.id || (t.ts + '|' + t.key));
    if (!t || seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  _allTrips = out; return out;
}
function saveMyTrips() { if (MY_TRIPS.length > TRIP_MAX) MY_TRIPS = MY_TRIPS.slice(0, TRIP_MAX); lsSet(TRIPS_LS, MY_TRIPS); invalidateTrips(); }
/* Ghi 1 sự kiện cuốc. event_id sinh tại máy → gửi lại 2 lần (mạng chập chờn, bấm 2 lần,
   app tự retry) máy chủ vẫn chỉ giữ MỘT bản ghi. Đây là idempotency key. */
function addTrip(j) {
  const t = { id: 't' + rid(10) + Date.now().toString(36), ...j };
  MY_TRIPS.unshift(t); saveMyTrips();
  G.jobsN = allTrips().length;
  return t;
}
// Máy chủ trả về bản đã gộp → tách phần của máy khác ra làm NET_TRIPS, dựng lại TWIN_NET.
function applyNetTrips(list, myDev) {
  const net = (Array.isArray(list) ? list : []).filter(t => t && t.dev && t.dev !== myDev);
  NET_TRIPS = net.slice(0, TRIP_MAX);
  lsSet(NET_LS, NET_TRIPS);
  rebuildTwinNet();
  invalidateTrips();
  G.jobsN = allTrips().length;
}
function rebuildTwinNet() {
  TWIN_NET = emptyTwin();
  for (const t of NET_TRIPS) {
    if (!t || !t.key) continue;
    if (t.type === 'dong') { TWIN_NET.obs[t.key + '|' + (t.band || bandOf(t.hour))] = (TWIN_NET.obs[t.key + '|' + (t.band || bandOf(t.hour))] || 0) + 1; continue; }
    twinBump(TWIN_NET, t.cat, t.hour, !!t.win, t.key, t.xe);
  }
}
// Cắt nhật ký cuốc còn n bản ghi gần nhất — CHỈ khi bộ nhớ máy thật sự chật.
function donNhatKy(n) { MY_TRIPS = MY_TRIPS.slice(0, n); lsSet(TRIPS_LS, MY_TRIPS); NET_TRIPS = NET_TRIPS.slice(0, n); lsSet(NET_LS, NET_TRIPS); invalidateTrips(); }

/* ---- bộ đếm Digital Twin ---- */
function twinBump(T, cat, hour, win, key, xe) {
  const b = bandOf(hour);
  const bump = (obj, k) => { if (k == null) return; obj[k] = obj[k] || { n: 0, win: 0 }; obj[k].n++; if (win) obj[k].win++; };
  bump(T.cat, cat); bump(T.hour, hour); bump(T.slot, cat + '|' + hour);
  bump(T.spot, key); bump(T.band, b); bump(T.cb, cat + '|' + b); bump(T.sb, key + '|' + b);
  /* LOẠI XE: cuốc ô tô và xe máy là hai nghề khác nhau — tài chạy xe máy tới quán toàn
     nổ cuốc ô tô thì đứng cả tối cũng công cốc. Học riêng theo quán. */
  if (win && (xe === 'oto' || xe === 'may')) T.xe[key + '|' + xe] = (T.xe[key + '|' + xe] || 0) + 1;
}
function twinLearn(cat, hour, win, key, xe) { twinBump(TWIN, cat, hour, win, key, xe); }
// ĐỌC = cuốc máy này + cuốc máy khác. Đây là chỗ "một người ghi, mọi máy khá lên".
function twinGet(bucket, key) {
  if (key == null) return null;
  const a = TWIN[bucket] && TWIN[bucket][key], b = TWIN_NET[bucket] && TWIN_NET[bucket][key];
  if (!a && !b) return null;
  return { n: (a ? a.n : 0) + (b ? b.n : 0), win: (a ? a.win : 0) + (b ? b.win : 0) };
}
const twinNum = (bucket, key) => (TWIN[bucket][key] || 0) + (TWIN_NET[bucket][key] || 0);
function twinAffinity(cat, hour, key) {
  const v = (o, d) => o ? o.win / Math.max(3, o.n) : d;
  const b = bandOf(hour);
  return clamp(
      0.20 * v(twinGet('cat', cat), .5)
    + 0.12 * v(twinGet('band', b), .5)
    + 0.20 * v(twinGet('cb', cat + '|' + b), .5)
    + 0.22 * v(twinGet('spot', key), .5)
    + 0.26 * v(twinGet('sb', key + '|' + b), .5), 0, 1);
}
/* Quán này hay nổ cuốc XE GÌ — đếm thẳng từ cuốc thật đã ghi, không suy đoán */
function xeCua(key) {
  const oto = twinNum('xe', key + '|oto'), may = twinNum('xe', key + '|may');
  return (oto || may) ? { oto, may } : null;
}
/* XE CỦA MỘT ĐIỂM — gộp 2 nguồn THẬT: cuốc tài xế tự bấm ghi ở chính điểm này,
   và các chuyến BUTL đọc từ ảnh (mỗi điểm đón thật đã kèm sẵn "xe hơi"/"xe máy"). */
function xeCuaSpot(sp) {
  const t = xeCua(spotKey(sp)) || { oto: 0, may: 0 };
  let oto = t.oto, may = t.may;
  const e = String(sp.evi || '');
  if (/xe hơi|xe hoi|ô ?tô|oto/i.test(e)) oto++;
  else if (/xe máy|xe may/i.test(e)) may++;
  /* CHƯA có cuốc thật nào để đếm → dùng LỜI KHAI của tài xế lúc thêm quán, và
     đánh dấu khai:true để màn hình nói rõ "tài xế khai" chứ không khoe thành
     "N/M cuốc". Điểm mới thêm mà im lặng thì bộ lọc 🚗/🏍️ không lọc ra được nó,
     tức là nhập xong như không nhập. */
  if (!oto && !may) return sp.xeKhai ? { oto: 0, may: 0, chinh: sp.xeKhai, khai: true } : null;
  return { oto, may, chinh: oto === may ? 'ca2' : (oto > may ? 'oto' : 'may'), khai: false };
}
const XE_ICON = { oto: '🚗', may: '🏍️', ca2: '🚗🏍️' };

/* QUAN SÁT "QUÁN ĐANG ĐÔNG" — KHÔNG phải cuốc, nên không trộn vào tỉ lệ nổ cuốc.
   Nó trả lời câu khác: "đứng chờ ở đây có đáng không?" */
const CHO_MS = 90 * 60 * 1000;             // "chờ được" = 90 phút
function nkIndex() {
  if (_nkIdx) return _nkIdx;
  const m = new Map();
  for (const j of allTrips()) {
    if (!j || !j.key) continue;
    const e = m.get(j.key) || { dong: [], win: [] };
    if (j.type === 'dong') e.dong.push(j); else if (j.win) e.win.push(j);
    m.set(j.key, e);
  }
  _nkIdx = m; return m;
}
function choTaiCho(key, hour) {
  const e = nkIndex().get(key); if (!e || !e.dong.length) return null;
  const b = bandOf(hour);
  const dong = e.dong.filter(d => (d.band || bandOf(d.hour)) === b);
  if (!dong.length) return null;
  const noSau = dong.filter(d => e.win.some(w => w.ts > d.ts && w.ts - d.ts <= CHO_MS)).length;
  return { n: dong.length, no: noSau, band: b };
}
/* CAO ĐIỂM HỌC ĐƯỢC của riêng quán này: khung giờ này ăn hơn hay kém hơn MỨC TRUNG BÌNH
   của CHÍNH quán đó → không lẫn với chuyện quán ngon/quán dở. */
function bandLift(key, hour) {
  const b = bandOf(hour);
  const here = twinGet('sb', key + '|' + b), all = twinGet('spot', key);
  if (!here || !all || here.n < 2 || all.n < 3) return null;
  const pHere = (here.win + 1) / (here.n + 2);        // Laplace: 0/2 không thành "0% tuyệt đối"
  const pAll = (all.win + 1) / (all.n + 2);
  const w = clamp(here.n / (here.n + 5), 0, .85);
  return { band: b, n: here.n, win: here.win, pHere, pAll, delta: w * (pHere - pAll) };
}
function bestBandOf(key) {
  let best = null;
  for (const b of BANDS) {
    const o = twinGet('sb', key + '|' + b.k);
    if (!o || o.n < 2) continue;
    const r = o.win / o.n;
    if (!best || r > best.rate || (r === best.rate && o.n > best.n)) best = { ...b, n: o.n, win: o.win, rate: r };
  }
  return best;
}
// Wilson lower bound của tỉ lệ nổ cuốc THẬT → điểm thắng nhiều lần xếp trên điểm ăn may 1 lần.
function wilson(win, n, z) { if (!n) return 0; z = z || 1; const p = win / n, z2 = z * z; return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n); }
function empOf(key) { const o = twinGet('spot', key); if (!o || !o.n) return null; return { n: o.n, win: o.win, rate: o.win / o.n, conf: wilson(o.win, o.n, 1) }; }

/* Yêu thích + ghi chú + điểm bị ẩn */
const FAV_LS = 'roadai_laiho_fav_v1', NOTE_LS = 'roadai_laiho_notes_v1';
let FAV = new Set(ls(FAV_LS, []) || []);
let NOTES = ls(NOTE_LS, {}) || {};
function saveFav() { lsSet(FAV_LS, [...FAV]); }
function saveNotes() { lsSet(NOTE_LS, NOTES); }
/* Ẩn kèm MỐC THỜI GIAN để đồng bộ nhiều máy: máy nào bấm SAU thì máy đó thắng.
   Không có mốc thời gian thì "bỏ ẩn" ở máy A sẽ bị máy B đẩy ẩn trở lại. */
const HIDE_LS = 'roadai_laiho_hidden_v1', HIDELOG_LS = 'roadai_butl_hidelog_v1';
let HIDDEN = new Set(ls(HIDE_LS, []) || []);
let HIDE_LOG = ls(HIDELOG_LS, null);
if (!HIDE_LOG || typeof HIDE_LOG !== 'object') { HIDE_LOG = {}; for (const k of HIDDEN) HIDE_LOG[k] = { ts: 1, on: 1 }; lsSet(HIDELOG_LS, HIDE_LOG); }
function saveHidden() { lsSet(HIDE_LS, [...HIDDEN]); lsSet(HIDELOG_LS, HIDE_LOG); }
function hideSpotKey(k) { HIDDEN.add(k); HIDE_LOG[k] = { ts: Date.now(), on: 1 }; saveHidden(); }
function unhideKey(k) { HIDDEN.delete(k); HIDE_LOG[k] = { ts: Date.now(), on: 0 }; saveHidden(); }
const hideLogArr = () => Object.keys(HIDE_LOG).slice(0, 3000).map(k => ({ k, ts: HIDE_LOG[k].ts, on: HIDE_LOG[k].on }));
let SKIPPED = new Set();   // điểm vừa "Bỏ qua" (tạm trong phiên) — để đề xuất điểm KHÁC

/* ═══════════════════ PHẦN 6 · CHẤM ĐIỂM & DỰ BÁO ═══════════════════ */
function realHour() { const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
function curHour() { return G.simHour != null ? G.simHour : realHour(); }
function isGolden(h) { return h >= 22 || h < 1.5; }
function contextMult(sp) {
  let m = DAY_MULT[G.dayType] || 1;
  if (G.match) m *= sp.cat === 'sanbong' ? 2.6 : 1.25;
  if (G.dayType !== 'weekday' && sp.cat === 'vanphong') m *= 0.5;
  m *= 1 + 0.3 * G.rain;                       // mưa → người đã uống càng cần lái hộ
  return m;
}
function minsToClose(sp, hour) { let dh = sp.closeH - hour; if (dh > 12) dh -= 24; if (dh < -12) dh += 24; return dh * 60; }
// Sóng tan quán — mạnh ở quán nhậu (cả bàn say), yếu ở tiệc cưới/nhà hàng (khách tự về)
function closingSurge(sp, hour) { const dh = minsToClose(sp, hour); return (dh <= 55 && dh >= -20) ? 1 + 0.9 * laihoRate(sp) * Math.exp(-(((dh - 10) / 22) ** 2)) : 1; }
const srcBoost = sp => (sp.source === 'butl' || sp.source === 'mine') ? 1.25 : sp.source === 'doitac' ? 1.15 : 1;
// λ = số khách SAY CẦN LÁI HỘ quanh điểm đó trong 15' (không phải số khách nói chung).
function demandOf(sp, hour) { return sp.size * curveAt(sp.cat, hour) * sp.noise * contextMult(sp) * closingSurge(sp, hour) * laihoRate(sp) * srcBoost(sp); }
function congestionNow() { const h = curHour(); return clamp(0.2 + 0.5 * (Math.exp(-((hourDist(h, 8) / 1.3) ** 2)) + Math.exp(-((hourDist(h, 18) / 1.6) ** 2))) + 0.25 * G.rain, 0, 1); }
function trendOf(sp, hour) { const now = curveAt(sp.cat, hour), soon = curveAt(sp.cat, hour + 10 / 60); return clamp((soon - now) * 5 + 0.5, 0.05, 0.95); }

/* MỘT CON SỐ DUY NHẤT: r.p = "khả năng bạn nổ được 1 cuốc nếu đứng ở đây 15 phút tới".
   Mọi màn hình, mọi bảng xếp hạng, mọi thông báo đều đọc đúng con số này. */
function scoreOf(r) {
  let z = G.theta.reduce((s, t, i) => s + t * r.feat[i], 0);
  if (r.emp && r.emp.n >= 2) z += 2.2 * (r.emp.conf - 0.35);   // đã nổ cuốc thật ở đây bao nhiêu lần
  if (r.bl) z += clamp(2.8 * r.bl.delta, -1.4, 1.4);           // cao điểm theo khung giờ, học được
  if (isZone(r.sp)) z += 0.35;                                  // điểm đón THẬT
  /* Quan sát "quán đang đông" chỉ đẩy khi ĐÃ được chứng minh — tức những lần thấy đông
     trước đây có dẫn tới cuốc thật trong 90'. Thấy đông mà chẳng bao giờ nổ thì kéo XUỐNG. */
  if (r.cho && r.cho.n >= 2) z += clamp(1.6 * (r.cho.no / r.cho.n - 0.35), -0.6, 0.9);
  z -= 0.09 * Math.max(0, r.eta - 6);                           // chạy càng xa càng dễ mất khách
  if (r.dist > COVER_R) z -= 1.2;
  if (!r.open) return -12;
  return z;
}
function computeAll() {
  const hour = curHour(), hInt = Math.floor(hour) % 24;
  const serving = withinService(hour);
  const trafficK = CITY_KMH * (1 - 0.3 * G.rain) * lerp(1, .72, congestionNow());
  const raw = SPOTS.map((sp, si) => ({ sp, si })).filter(o => !HIDDEN.has(spotKey(o.sp))).map(({ sp, si }) => {
    const open = isOpen(sp, hour);
    const lambda = open ? demandOf(sp, hour) : 0;
    const straight = haversine(G.you, sp);
    const dist = straight * ROAD_FACTOR;
    const eta = (dist / 1000) / Math.max(6, trafficK) * 60;
    const usable = clamp((WIN_MIN - eta) / WIN_MIN, 0, 1);
    const expWait = lambda > 0 ? Math.min(WIN_MIN, WIN_MIN / (lambda + 0.15)) : WIN_MIN;
    return { sp, si, open, lambda, straight, dist, eta, usable, expWait, trend: trendOf(sp, hour), mins: minsToClose(sp, hour), hour: hInt };
  });
  // Chuẩn hoá "đông khách" theo CHÍNH KHU 5KM của tài xế — không lấy max toàn thành phố.
  const inCover = raw.filter(r => r.open && r.dist <= COVER_R);
  const scaleSet = inCover.length >= 3 ? inCover : raw.filter(r => r.open);
  const maxL = Math.max(...scaleSet.map(r => r.lambda), 0.001);
  raw.forEach(r => {
    r.sDemand = clamp(r.lambda / maxL, 0, 1);
    r.sEta = r.usable;
    r.sTrend = r.trend;
    const _spk = spotKey(r.sp);
    r.key = _spk;
    r.sTwin = twinAffinity(r.sp.cat, r.hour, _spk);
    r.emp = empOf(_spk);
    r.bl = bandLift(_spk, hour);
    r.cho = choTaiCho(_spk, hour);
    r.band = bandOf(hour);
    r.feat = [1, r.sDemand, r.sEta, r.sTrend, r.sTwin];
    r.z = scoreOf(r);
    // Chặn trần 92%: nghề này không bao giờ chắc chắn — dù đã nổ 20/20 cuốc ở đó.
    r.p = clamp(sigmoid(r.z), 0.02, 0.92);
    r.pModel = r.p;
    r.margin = clamp(Math.round(100 * Math.sqrt(r.p * (1 - r.p) / (r.lambda + 8))), 2, 12);
    r.hotScore = Math.round(r.p * 100);
    r.tier = !r.open ? 0 : r.p >= 0.50 ? 3 : r.p >= 0.35 ? 2 : r.p >= 0.22 ? 1 : 0;
  });
  const openBase = serving ? inCover.slice() : [];
  let pool0 = openBase.filter(r => !SKIPPED.has(r.sp.id));
  if (openBase.length && !pool0.length) { SKIPPED.clear(); pool0 = openBase; }
  const pool = (G.filter && G.filter !== 'all') ? pool0.filter(r => matchFilter(r)) : pool0;
  const byHot = [...pool].sort((a, b) => b.p - a.p || a.eta - b.eta);
  byHot.forEach((r, i) => r.hotRank = i);
  let best = byHot[0] || null;
  // giữ điểm cũ nếu vẫn còn tốt tương đương (đỡ nhảy loạn mỗi 30 giây)
  if (best && G.lastBestId) { const prev = byHot.find(r => r.sp.id === G.lastBestId); if (prev && prev.p >= best.p - 0.03) best = prev; }
  if (best) { G.lastBestId = best.sp.id; best.isBest = true; }
  byHot.slice(0, RECO_FLAMES).forEach(r => r.isFlame = true);
  return { raw, byHot, best, hour, golden: isGolden(hour), serving, offHours: !serving, cover: inCover };
}
/* Bộ lọc trên màn chính rút còn 3 lựa chọn: Tất cả · 🚗 Ô tô · 🏍️ Xe máy —
   lọc theo LOẠI XE điểm đó thường nổ (dữ liệu thật), không phải theo loại quán. */
function matchFilter(r) {
  if (G.filter === 'all') return true;
  const x = xeCuaSpot(r.sp);
  if (G.filter === 'oto') return !!x && (x.chinh === 'oto' || x.chinh === 'ca2');
  if (G.filter === 'may') return !!x && (x.chinh === 'may' || x.chinh === 'ca2');
  return r.sp.cat === G.filter;
}

/* ĐIỂM CHỜ TỐI ƯU: đứng giữa cụm quán (bán kính đi bộ ~750m) để với tới nhiều quán nhất.
   CHẶN 60 TÂM CỤM ĐỂ THỬ (đo 12/08/2026): quét hết mọi quán làm tâm là O(n²) —
   650 quán trong một khu dày đặc mất 287ms mỗi vòng, tức app giật 30 giây một lần
   trên điện thoại tài xế. Tâm cụm đúng bao giờ cũng nằm cạnh quán ĐÔNG nhất, nên
   thử 60 chỗ đông nhất là ra cùng kết quả mà chỉ tốn 1/7 thời gian. */
const WAIT_CANDS = 60;
function optimalWait(m) {
  const WALK = 750; let best = null;
  const pool = (m.cover && m.cover.length) ? m.cover : m.raw.filter(r => r.open);
  const cands = pool.length > WAIT_CANDS
    ? pool.slice().sort((a, b) => b.lambda - a.lambda).slice(0, WAIT_CANDS)
    : pool;
  for (const c of cands) {
    let cl = 0, cnt = 0, sLat = 0, sLng = 0, wsum = 0;
    const trong = [];
    const hang = dongDMAT(c.si);   // DMAT đánh chỉ số theo SPOTS, dùng si (không dùng vị trí trong raw)
    for (const r of m.raw) {
      const d = (hang && hang[r.si] != null) ? hang[r.si] : haversine(c.sp, r.sp);
      if (d <= WALK && r.open) { const db = isZone(r.sp) ? 1.8 : 1, w = r.lambda * db * (1 - d / WALK); cl += r.lambda * db; cnt++; sLat += r.sp.lat * w; sLng += r.sp.lng * w; wsum += w; trong.push(r); }
    }
    if (cnt < 2 || wsum <= 0) continue;
    const center = { lat: sLat / wsum, lng: sLng / wsum };
    const distYou = haversine(G.you, center);
    const eta = (distYou * ROAD_FACTOR / 1000) / Math.max(6, CITY_KMH * lerp(1, .72, congestionNow())) * 60;
    const score = cl / (1 + eta / 12);
    if (!best || score > best.score) best = { center, cl, cnt, eta, distYou, score, trong };
  }
  /* GIỮ LẠI DANH SÁCH QUÁN TRONG CỤM. Đứng ở 🅿️ mà không biết quanh mình có quán
     nào thì đứng để làm gì — tài xế cần tên quán cụ thể để còn chạy tới đón. */
  if (best) best.trong = best.trong.sort((a, b) => b.p - a.p).slice(0, 6);
  return best;
}
/* CUNG ĐƯỜNG RÀ CUỐC: xâu chuỗi vài điểm mạnh nhất trong vùng phủ sóng thành 1 vòng
   chạy ngắn — tham lam theo "điểm cao mà gần" (mỗi 220m đường đổi lấy 1 điểm xác suất). */
function goldenRoute(m, n = 4) {
  const cand = (m.byHot || []).filter(r => r.dist <= COVER_R && r.p >= 0.2).slice(0, 16);
  if (cand.length < 2) return null;
  const seq = []; const left = cand.slice();
  let cur = { lat: G.you.lat, lng: G.you.lng }, legs = 0;
  while (seq.length < n && left.length) {
    let bi = -1, bs = -Infinity;
    left.forEach((r, i) => {
      const d = haversine(cur, r.sp) * ROAD_FACTOR;
      if (seq.length && d > 4200) return;
      const s = r.p * 100 - d / 220;
      if (s > bs) { bs = s; bi = i; }
    });
    if (bi < 0) break;
    const pick = left.splice(bi, 1)[0];
    legs += haversine(cur, pick.sp) * ROAD_FACTOR;
    seq.push(pick); cur = pick.sp;
  }
  if (seq.length < 2) return null;
  const kmh = Math.max(6, CITY_KMH * lerp(1, .72, congestionNow()));
  const mins = (legs / 1000) / kmh * 60;
  // ĐI NGANG BAO NHIÊU QUÁN: số ĐẾM ĐƯỢC, không phải xác suất — BUTL phát cuốc cho tài gần nhất.
  const path = [{ lat: G.you.lat, lng: G.you.lng }, ...seq.map(r => r.sp)];
  const samples = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], d = haversine(a, b), steps = Math.max(1, Math.round(d / 350));
    for (let s = 0; s <= steps; s++) samples.push({ lat: lerp(a.lat, b.lat, s / steps), lng: lerp(a.lng, b.lng, s / steps) });
  }
  const passed = (m.cover || []).filter(r => samples.some(s => haversine(s, r.sp) <= 800));
  return { seq, dist: legs, mins, passN: passed.length, topP: Math.max(...seq.map(r => r.p)) };
}
function routeUrl(rt) {
  if (!rt) return '#';
  const pts = rt.seq.map(r => `${r.sp.lat},${r.sp.lng}`);
  const dest = pts.pop();
  const wp = pts.length ? `&waypoints=${pts.join('|')}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${G.you.lat},${G.you.lng}&destination=${dest}${wp}&travelmode=driving`;
}

/* ═══ KHI NÀO ĐÁNG ĐI — trả lời câu hỏi thứ 4 mà app đang bỏ trống ═══
   15:45 mở app ra thì cả bản đồ là một biển "2%": đúng sự thật (giờ đó gần như
   không ai gọi lái hộ) nhưng VÔ DỤNG, tài xế không biết nên nghỉ tới lúc nào.
   Hàm này chạy CHÍNH công thức hiện tại ở các mốc 30 phút sắp tới — cùng mô hình,
   cùng thang điểm, chỉ đổi giờ. KHÔNG phải con số bịa, và kiểm chứng được: tới
   giờ đó mở app ra sẽ thấy đúng con số này.
   Thời gian chạy tới nơi lấy theo hiện tại (giao thông tương lai thì không đoán) —
   đây là số hạng phụ, không đổi thứ hạng.
   Chỉ tính khi THẬT SỰ cần (điểm tốt nhất đang dưới ngưỡng nên đi) và nhớ lại theo
   ô 15 phút, để không tốn máy mỗi 30 giây. */
let _dbCache = null;
function duBaoSom(m) {
  const now = curHour();
  /* Xét MỌI điểm trong vùng phủ sóng, kể cả điểm ĐANG ĐÓNG — vì chỗ đáng đi lúc
     22h gần như luôn là chỗ giờ này chưa mở (bar, beer club mở 18h). Lấy m.cover
     (chỉ gồm chỗ đang mở) là bỏ sót đúng thứ cần tìm. */
  const set = m.raw.filter(r => r.dist <= COVER_R);
  if (!set.length) return null;
  const ck = Math.floor(now * 4) + '|' + set.length + '|' + G.dayType + '|' + Math.round(G.rain * 10) + '|' + (G.match ? 1 : 0);
  if (_dbCache && _dbCache.ck === ck) return _dbCache.v;
  let best = null;
  for (let dh = 0.5; dh <= 9; dh += 0.5) {
    const h = (((now + dh) % 24) + 24) % 24;
    if (!withinService(h)) continue;
    const hInt = Math.floor(h);
    let maxL = 0.001;
    const ls = [];
    for (const r of set) {
      const open = isOpen(r.sp, h);
      const lam = open ? demandOf(r.sp, h) : 0;
      if (lam > maxL) maxL = lam;
      ls.push({ r, open, lam });
    }
    for (const x of ls) {
      if (!x.open) continue;
      const r = x.r, k = spotKey(r.sp);
      const p = clamp(sigmoid(scoreOf({
        sp: r.sp, open: true, eta: r.eta, dist: r.dist,
        emp: r.emp, bl: bandLift(k, h), cho: choTaiCho(k, h),
        feat: [1, clamp(x.lam / maxL, 0, 1), r.sEta, trendOf(r.sp, h), twinAffinity(r.sp.cat, hInt, k)],
      })), 0.02, 0.92);
      if (!best || p > best.p) best = { hour: h, p, sp: r.sp, after: dh };
    }
  }
  _dbCache = { ck, v: best };
  return best;
}

/* ═══════════════════ PHẦN 7 · KHUYẾN NGHỊ (thứ DUY NHẤT giao diện đọc) ═══════════════
   Giao diện KHÔNG được biết OSM/Overture/Digital Twin/feature/theta là gì.
   Nó nhận đúng một vật phẳng và vẽ ra. Muốn thêm gì cho tài xế thì thêm ở đây. */
const STAY_M = 400;   // đang đứng trong 400m điểm tốt nhất = coi như "đã ở đúng chỗ"
/* ĐỘ TIN CẬY — KHÔNG bịa. Ghép từ 3 thứ ĐO ĐƯỢC:
     · evi = số cuốc thật đã ghi ở chính điểm này (bão hoà ở 8 cuốc)
     · skill = kỹ năng dự báo của mô hình, đo bằng Brier skill score trên cuốc đã ghi
     · spread = dải sai số của chính ước lượng (r.margin, hẹp thì chắc hơn)
   Sàn 25% / trần 95%: chưa có cuốc nào thì app phải nói thẳng là chưa chắc. */
function confidenceOf(r) {
  const evi = r.emp ? clamp(r.emp.n / 8, 0, 1) : 0;
  const skl = clamp(G.skill, 0, 1);
  const spr = clamp(1 - r.margin / 12, 0, 1);
  return Math.round(100 * clamp(0.30 + 0.30 * evi + 0.25 * skl + 0.15 * spr, 0.25, 0.95));
}
/* LÝ DO (LEVEL 2 — chỉ hiện khi tài xế bấm "Vì sao?").
   Tối đa 4 dòng, mỗi dòng là một sự thật đếm được. */
function reasonsOf(r, m) {
  const out = [];
  if (r.emp && r.emp.n >= 2) out.push({ ico: '✅', t: `Đã nổ ${r.emp.win}/${r.emp.n} cuốc thật ở đây` });
  if (r.bl && r.bl.delta > 0.05) out.push({ ico: '🔺', t: `${BAND_VI[r.bl.band]} là cao điểm của điểm này (${r.bl.win}/${r.bl.n})` });
  else if (r.bl && r.bl.delta < -0.05) out.push({ ico: '🔻', t: `Khung này bạn hay hụt ở đây (${r.bl.win}/${r.bl.n})` });
  if (r.cho && r.cho.n >= 2) out.push({ ico: r.cho.no * 2 >= r.cho.n ? '⏳' : '🚶', t: r.cho.no * 2 >= r.cho.n ? `Đáng chờ: ${r.cho.no}/${r.cho.n} lần thấy đông là có cuốc trong 90′` : `Nên đi tiếp: ${r.cho.n} lần thấy đông chỉ ${r.cho.no} lần nổ cuốc` });
  if (r.mins > 0 && r.mins <= 45) out.push({ ico: '🕛', t: `Còn ${Math.round(r.mins)} phút nữa tan quán` });
  else if (r.mins <= 0 && r.mins > -20) out.push({ ico: '🚪', t: 'Đang tan quán — khách ra về' });
  if (r.sDemand > 0.7) out.push({ ico: '🍺', t: 'Đông khách nhất khu vực' });
  if (m && m.golden) out.push({ ico: '🌙', t: 'Giờ vàng — cầu lái hộ cao nhất đêm' });
  if (G.rain > 0.3) out.push({ ico: '🌧️', t: `Mưa ${Math.round(G.rain * 100)}% — khách say càng cần lái hộ` });
  if (r.sEta > 0.75) out.push({ ico: '📍', t: `Rất gần — ${fmtMin(r.eta)}` });
  return out.slice(0, 4);
}
/* ĐỐI TƯỢNG KHUYẾN NGHỊ. Đây là hợp đồng giữa engine và giao diện. */
function getDecision(m) {
  const now = curHour();
  const base = {
    ok: false, status: 'LOW', action: 'WAIT',
    demand_score: 0, confidence: 0,
    recommended_area: '', recommended_name: '', recommended_addr: '',
    distance: 0, eta: 0, estimated_wait: 0, close_in: null,
    vehicle: null, nav: '', spot_id: null, reasons: [], here: false, peak: null, wait: null,
    clock: fmtClose(now), temp: G.weather ? Math.round(G.weather.temp) : null,
    rain: Math.round(G.rain * 100), golden: isGolden(now),
  };
  if (!G.online) return { ...base, status: 'OFF', action: 'REST', headline: 'Đang nghỉ', sub: 'Bấm để nhận khách' };
  if (!m) return { ...base, status: 'LOW', action: 'WAIT', headline: 'Đang khởi động…', sub: '' };
  if (m.offHours) return { ...base, status: 'REST', action: 'REST', headline: 'Chưa tới giờ', sub: 'App tìm điểm từ 14h mỗi ngày' };
  const r = m.best;
  if (!r) {
    // Bộ lọc đang bật mà rỗng ≠ hết quán. Nói đúng lý do, không thì tài xế tưởng app hỏng.
    if (G.filter && G.filter !== 'all') return { ...base, status: 'LOW', action: 'WAIT',
      headline: 'Chưa có điểm nào hợp bộ lọc', sub: 'Bấm "Tất cả" để xem mọi điểm quanh bạn' };
    if (G.quanGan != null && G.quanGan < VUNG_IT) return { ...base, status: 'LOW', action: 'WAIT',
      headline: 'Khu này chưa có dữ liệu', sub: 'Bấm nút cam để tìm điểm quanh đây' };
    return { ...base, status: 'LOW', action: 'WAIT', headline: 'Quanh đây quán đã đóng', sub: 'Thử chạy sang khu khác' };
  }

  const x = xeCuaSpot(r.sp);
  const p = r.hotScore;
  const dist = (bestRouteDist(r) != null ? bestRouteDist(r) : r.dist) / 1000;
  const eta = bestRouteEta(r) != null ? bestRouteEta(r) : r.eta;
  const here = r.dist <= STAY_M;
  /* Điểm tốt nhất đang dưới ngưỡng nên đi → nói luôn KHI NÀO đáng đi và đáng đi ĐÂU.
     Chỉ nhắc khi giờ đó thật sự khá hơn hẳn (≥35% và hơn hiện tại ít nhất 12 điểm),
     không thì thành câu nhảm "22h được 20%". */
  let peak = null;
  if (p < 50) {
    const s = duBaoSom(m);
    if (s && s.p >= 0.35 && s.p * 100 - p >= 12) peak = {
      at: fmtClose(s.hour), p: Math.round(s.p * 100),
      name: cleanName(s.sp), area: s.sp.quan || '', after: s.after,
    };
  }
  /* ĐIỂM CHỜ TỐI ƯU 🅿️ — đứng giữa cụm quán để với tới nhiều chỗ cùng lúc.
     Chỉ đề xuất khi nó phủ được từ 3 quán trở lên. */
  const w = m.wait && m.wait.cnt >= 3 ? m.wait : null;
  return {
    ...base, ok: true, peak,
    wait: w ? { lat: w.center.lat, lng: w.center.lng, n: w.cnt,
                km: +(w.distYou * ROAD_FACTOR / 1000).toFixed(1), eta: Math.round(w.eta),
                nav: gmapsDir(w.center.lat, w.center.lng),
                // tên quán cụ thể trong cụm, để tài xế đứng đó biết chạy tới đâu
                spots: (w.trong || []).map(r => ({
                  id: r.sp.id, name: cleanName(r.sp), addr: r.sp.addr || '',
                  p: r.hotScore, m: Math.round(haversine(w.center, r.sp)),
                  xe: (xeCuaSpot(r.sp) || {}).chinh || null, nav: navUrl(r.sp),
                })) } : null,
    status: p >= 50 ? 'HOT' : p >= 35 ? 'OK' : 'LOW',
    action: p < 35 ? 'WAIT' : here ? 'STAY' : 'MOVE',
    demand_score: p,
    confidence: confidenceOf(r),
    recommended_area: r.sp.quan || '',
    recommended_name: cleanName(r.sp),
    recommended_addr: r.sp.addr || '',
    distance: +dist.toFixed(1),
    eta: Math.round(eta),
    estimated_wait: Math.round(r.expWait),
    close_in: (r.sp.cat !== 'diemdon' && r.mins > 0 && r.mins <= 120) ? Math.round(r.mins) : null,
    vehicle: x ? x.chinh : null,
    nav: navUrl(r.sp),
    spot_id: r.sp.id,
    reasons: reasonsOf(r, m),
    here,
  };
}

/* ═══════════════════ PHẦN 8 · HỌC TỪ CUỐC THẬT ═══════════════════ */
function subScores(r) { return [r.sDemand, r.sEta, r.sTrend, r.sTwin]; }
function observe(r, y) {
  const lr = 0.08, l2 = 0.002, err = y - r.pModel;
  for (let i = 0; i < G.theta.length; i++) G.theta[i] = clamp(G.theta[i] + lr * (err * r.feat[i] - l2 * G.theta[i]), -6, 6);
  const a = 0.06; G.meanY = (1 - a) * G.meanY + a * y;
  const xs = subScores(r);
  for (let k = 0; k < LKEYS.length; k++) { G.meanX[k] = (1 - a) * G.meanX[k] + a * xs[k]; G.cov[k] = (1 - a) * G.cov[k] + a * (xs[k] - G.meanX[k]) * (y - G.meanY); }
  G.resolved++;
  return [(r.pModel - y) ** 2, (G.meanY - y) ** 2];
}
function updateSkill(bm, bb) {
  if (!bm.length) return;
  G.brierModelEma = lerp(G.brierModelEma, mean(bm), 0.15);
  G.brierBaseEma = lerp(G.brierBaseEma, mean(bb), 0.15);
  G.skill = clamp(1 - G.brierModelEma / Math.max(1e-3, G.brierBaseEma), 0, 1);
  G.skillHist.push(G.skill); if (G.skillHist.length > 120) G.skillHist.shift();
}
function shiftWeights() {
  let tsum = 0; const tgt = {};
  for (let k = 0; k < LKEYS.length; k++) { tgt[LKEYS[k]] = Math.max(0.1, 0.7 + G.cov[k] * 45); tsum += tgt[LKEYS[k]]; }
  for (const key of LKEYS) G.weights[key] = clamp(lerp(G.weights[key], tgt[key] / tsum * LKEYS.length, 0.12), 0.1, 2.2);
}
function stepDemand() { for (const sp of SPOTS) sp.noise = drift(sp.noise, 1, (VOL[sp.cat] || .3) * 0.5); }

/* GHI 1 CUỐC THẬT → Digital Twin + mô hình học ngay (nguồn học DUY NHẤT).
   Trả về đối tượng cuốc để tầng đồng bộ đẩy lên máy chủ (một người ghi, mọi máy thấy). */
function logJob(r, win, xe) {
  const capLat = G.you.lat, capLng = G.you.lng;   // vị trí THẬT lúc bấm
  twinLearn(r.sp.cat, r.hour, win, spotKey(r.sp), xe); saveTwin();
  const [bm, bb] = observe(r, win ? 1 : 0); updateSkill([bm], [bb]); shiftWeights();
  saveBrain();
  // Ghi kèm % app ĐÃ DỰ BÁO trước khi biết kết quả → sau này đối chiếu dự báo vs thực tế
  const trip = addTrip({ ts: Date.now(), spotId: r.sp.id, name: r.sp.name, cat: r.sp.cat, quan: r.sp.quan,
    hour: r.hour, band: r.band || bandOf(r.hour), p: +r.p.toFixed(3), key: spotKey(r.sp), win: !!win, xe: xe || '' });
  G.pendingLog = null;
  // BẰNG CHỨNG cho điểm tự nạp: cộng vào ĐÚNG điểm đó (theo id, không theo tên).
  if (r.sp.source === 'mine' && r.sp.pid) creditPick(r.sp.pid, win, (G.hasGps && G.youFromGps) ? capLat : null, capLng, xe);
  let captured = false;
  if (win) {
    G.session.rides++;
    /* Nhận khách xong chạy liền, khỏi gõ tay → app TỰ tạo 1 chấm theo GPS thật.
       Trong 55m thì GỘP vào điểm cũ và nắn toạ độ, không đẻ chấm rác. */
    if (G.hasGps && G.youFromGps) {
      const near = nearPick(MY_PICKS, capLat, capLng);
      if (near) { refinePick(near, capLat, capLng); savePicks(); }
      else if (!SPOTS.some(s => haversine({ lat: capLat, lng: capLng }, s) <= 150)) {
        upsertPick('★ Nổ cuốc (GPS)', capLat, capLng, r.sp.cat || 'phonhau', r.sp.quan || 'Tôi thêm');
        buildSpots(); captured = true;
      }
    }
    G.chainFrom = r.sp.name;
  }
  recompute();
  return { trip, captured };
}
/* GHI NHẬN "QUÁN ĐANG ĐÔNG" — quan sát, chưa phải cuốc.
   Cố ý KHÔNG tính vào tỉ lệ nổ cuốc; nó trả lời câu "đứng chờ có đáng không". */
function logDong(r) {
  const key = spotKey(r.sp);
  TWIN.obs[key + '|' + bandOf(r.hour)] = (TWIN.obs[key + '|' + bandOf(r.hour)] || 0) + 1;
  saveTwin();
  const trip = addTrip({ ts: Date.now(), spotId: r.sp.id, name: r.sp.name, cat: r.sp.cat, quan: r.sp.quan,
    hour: r.hour, band: r.band || bandOf(r.hour), key, type: 'dong', win: false });
  if (r.sp.source === 'mine' && r.sp.pid) creditPick(r.sp.pid, false, null, null, '', true);
  recompute();
  return { trip, cho: choTaiCho(key, r.hour) };
}

/* ═══════════════════ PHẦN 9 · THỐNG KÊ (cho màn Điều phối) ═══════════════════ */
function jobStats() {
  const jobs = allTrips(); if (!jobs.length) return null;
  const byQuan = {}, byHour = {};
  for (const j of jobs) {
    if (j.type === 'dong') continue;
    const q = j.quan || '—';
    (byQuan[q] = byQuan[q] || { n: 0, win: 0 }).n++; if (j.win) byQuan[q].win++;
    const hb = BAND_VI[j.band || bandOf(j.hour)] || 'Ngoài giờ';
    (byHour[hb] = byHour[hb] || { n: 0, win: 0 }).n++; if (j.win) byHour[hb].win++;
  }
  const rank = o => Object.entries(o).map(([k, v]) => ({ k, r: v.win / v.n, n: v.n })).sort((a, b) => b.r - a.r || b.n - a.n);
  const real = jobs.filter(j => j.type !== 'dong');
  const wins = real.filter(j => j.win).length;
  // ĐÊM NAY: tính từ 12h trưa hôm nay (ca lái hộ vắt qua nửa đêm nên không cắt theo 0h)
  const shiftStart = new Date(); shiftStart.setHours(12, 0, 0, 0);
  if (new Date().getHours() < 6) shiftStart.setDate(shiftStart.getDate() - 1);
  const tj = real.filter(j => j.ts >= shiftStart.getTime());
  const oto = real.filter(j => j.win && j.xe === 'oto').length;
  const may = real.filter(j => j.win && j.xe === 'may').length;
  const dong = jobs.filter(j => j.type === 'dong');
  const dongNo = dong.filter(d => real.some(w => w.key === d.key && w.win && w.ts > d.ts && w.ts - d.ts <= CHO_MS)).length;
  return { n: real.length, wins, rate: real.length ? wins / real.length : 0,
    today: { n: tj.length, wins: tj.filter(j => j.win).length },
    oto, may, dong: dong.length, dongNo,
    quan: rank(byQuan).slice(0, 3), hour: rank(byHour).slice(0, 3) };
}
/* CHỨNG MINH ĐIỀU HƯỚNG CÓ KẾT QUẢ THẬT: mỗi cuốc lưu kèm % app đã dự báo TRƯỚC khi
   biết kết quả. Bảng này so dự báo với thực tế — app nói phét là lộ ngay ở đây. */
function calibReport() {
  const jobs = allTrips().filter(j => typeof j.p === 'number' && j.type !== 'dong');
  if (jobs.length < 4) return null;
  const bands = [
    { k: 'App báo ≥50% (nên đi)', lo: .5, hi: 1.01 },
    { k: 'App báo 35–50% (cân nhắc)', lo: .35, hi: .5 },
    { k: 'App báo dưới 35% (nên chờ)', lo: -1, hi: .35 },
  ];
  const rows = bands.map(b => {
    const g = jobs.filter(j => j.p >= b.lo && j.p < b.hi);
    return { k: b.k, n: g.length, win: g.filter(j => j.win).length, pred: g.length ? mean(g.map(j => j.p)) : 0 };
  }).filter(b => b.n);
  return rows.length ? { rows, n: jobs.length } : null;
}
function bandStats() {
  const jobs = allTrips().filter(j => j.type !== 'dong'); if (!jobs.length) return null;
  const out = BANDS.map(b => {
    const g = jobs.filter(j => (j.band || bandOf(j.hour)) === b.k);
    return { ...b, n: g.length, win: g.filter(x => x.win).length };
  }).filter(b => b.n);
  return out.length ? out : null;
}
/* Quán × khung giờ mát tay nhất — gộp cả cuốc máy này lẫn máy khác (twinGet). */
function peakSpots(limit = 6) {
  const keys = new Set([...Object.keys(TWIN.sb), ...Object.keys(TWIN_NET.sb)]);
  const out = [];
  for (const k of keys) {
    const o = twinGet('sb', k); if (!o || o.n < 2) continue;
    const i = k.lastIndexOf('|'); if (i < 0) continue;
    const name = k.slice(0, i).split('@')[0], b = k.slice(i + 1);
    if (!BAND_VI[b] || b === 'ngoai') continue;
    out.push({ name, band: b, n: o.n, win: o.win, rate: o.win / o.n, conf: wilson(o.win, o.n, 1) });
  }
  return out.sort((a, b) => b.conf - a.conf || b.n - a.n).slice(0, limit);
}

/* ═══════════════════ PHẦN 10 · NGUỒN NGOÀI (chạy nền, không chặn UI) ═══════════════════ */
/* --- Thời tiết thật (Open-Meteo) --- */
const WMO = { 0: '☀️ Trời quang', 1: '🌤️ Ít mây', 2: '⛅ Có mây', 3: '☁️ Nhiều mây', 45: '🌫️ Sương mù', 48: '🌫️ Sương mù', 51: '🌦️ Mưa phùn', 53: '🌦️ Mưa phùn', 55: '🌦️ Mưa phùn', 61: '🌧️ Mưa nhẹ', 63: '🌧️ Mưa', 65: '🌧️ Mưa to', 80: '🌦️ Mưa rào', 81: '🌧️ Mưa rào', 82: '⛈️ Mưa rào mạnh', 95: '⛈️ Dông', 96: '⛈️ Dông', 99: '⛈️ Dông' };
async function fetchWeather() {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${G.you.lat.toFixed(3)}&longitude=${G.you.lng.toFixed(3)}&current=temperature_2m,precipitation,weather_code&hourly=precipitation_probability&forecast_hours=6&timezone=Asia%2FBangkok`;
    const r = await fetch(u); if (!r.ok) return;
    const j = await r.json(); const c = j.current || {};
    const prob = (j.hourly && j.hourly.precipitation_probability && j.hourly.precipitation_probability[0]) || 0;
    G.weather = { temp: c.temperature_2m, code: c.weather_code, prob, precip: c.precipitation || 0 };
    if (!G.rainManual) G.rain = clamp(Math.max(G.weather.precip > 0 ? 0.6 : 0, prob / 100), 0, 1);
    recompute();
  } catch (e) {}
}

/* --- Quãng đường THẬT theo đường đi (OSRM) cho điểm đang đề xuất --- */
function bestRouteDist(r) { return (r && G.bestRoute && G.bestRoute.id === r.sp.id) ? G.bestRoute.dist : null; }
function bestRouteEta(r) { return (r && G.bestRoute && G.bestRoute.id === r.sp.id) ? G.bestRoute.dur : null; }
async function routeBest(best) {
  if (!best) { G.bestRoute = null; return; }
  if (G.bestRoute && G.bestRoute.id === best.sp.id) return;
  try {
    const u = `https://router.project-osrm.org/route/v1/driving/${G.you.lng},${G.you.lat};${best.sp.lng},${best.sp.lat}?overview=false`;
    const r = await fetch(u); if (!r.ok) return; const j = await r.json();
    if (j.code === 'Ok' && j.routes && j.routes[0]) { G.bestRoute = { id: best.sp.id, dist: j.routes[0].distance, dur: j.routes[0].duration / 60 }; paint(); }
  } catch (e) {}
}

/* --- Danh sách quán DÙNG CHUNG: đối chiếu MÃ BẢN (rev) mỗi lần mở app / bật màn hình ---
   TUYỆT ĐỐI không thêm ?v=… để phá cache CDN: chính cache CDN bảo đảm mọi máy nhận
   CÙNG một bản chụp. Phá nó thì mỗi máy bắt server hỏi Overpass riêng → ra kết quả khác. */
const SPOTS_CACHE = 'roadai_laiho_spots_cache';
const SYNC_MS = 30 * 60 * 1000;
const trongVN = (la, lo) => la > 8 && la < 23.6 && lo > 102 && lo < 110;
function validSpots(a) { return Array.isArray(a) && a.length >= 120 && a.every(r => Array.isArray(r) && r.length >= 7 && typeof r[0] === 'string' && trongVN(r[2], r[3])); }
function loadSpotsCache() { const c = ls(SPOTS_CACHE, null); return (c && validSpots(c.spots) && (Date.now() - (c.ts || 0)) < 7 * 864e5) ? c : null; }
function hotSwap(spots, source, updatedAt, rev, extra) {
  buildSpots(spots); G.lastBestId = null; G.pendingLog = null; G.chainFrom = null;
  const c = spotCounts();
  G.dataStatus = Object.assign({ count: c.shared, mine: c.mine, vung: c.vung, total: c.total, updatedAt: updatedAt || null, source, rev: rev || null }, extra || {});
  recompute();
}
let refreshing = false, lastSync = 0;
async function refreshSpots(force, loud) {
  if (refreshing) return false;
  if (!force && Date.now() - lastSync < 60000) return false;
  refreshing = true;
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
    let r; try { r = await fetch('/api/spots', { cache: force ? 'reload' : 'no-store', signal: ctl.signal }); } finally { clearTimeout(to); }
    if (!r.ok) return false;
    const j = await r.json();
    if (!(j && j.ok && validSpots(j.spots))) return false;
    lastSync = Date.now();
    const cur = G.dataStatus && G.dataStatus.rev;
    lsSet(SPOTS_CACHE, { ts: Date.now(), spots: j.spots, updatedAt: j.updatedAt, rev: j.rev || null });
    if (cur && j.rev && cur === j.rev) {   // đã đúng bản rồi — không dựng lại bản đồ cho khỏi giật
      G.dataStatus.checkedAt = Date.now();
      if (loud) UIsay('Dữ liệu đã mới nhất.');
      return true;
    }
    hotSwap(j.spots, j.fresh === false ? 'dự phòng' : 'đã đồng bộ', j.updatedAt, j.rev,
      { named: j.named, addrOnly: j.addrOnly, nameCheck: j.nameCheck });
    G.dataStatus.checkedAt = Date.now();
    if (loud) UIsay('✓ Đã cập nhật dữ liệu.');
    return true;
  } catch (e) { return false; } finally { refreshing = false; }
}
/* Xoá bản chụp cũ + cache service worker rồi nạp lại từ đầu — nút cho ADMIN khi 2 máy lệch số. */
async function hardResync() {
  UIsay('Đang đồng bộ lại máy này…');
  try { localStorage.removeItem(SPOTS_CACHE); } catch (e) {}
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      await new Promise(res => {
        const ch = new MessageChannel(); ch.port1.onmessage = () => res();
        navigator.serviceWorker.controller.postMessage({ type: 'PURGE' }, [ch.port2]);
        setTimeout(res, 2500);
      });
    }
    const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
    await Promise.all(regs.map(r => r.update().catch(() => {})));
  } catch (e) {}
  if (G.dataStatus) G.dataStatus.rev = null;
  const ok = await refreshSpots(true, true);
  if (!ok) { UIsay('Chưa lấy được dữ liệu — kiểm tra mạng rồi thử lại.'); return; }
  setTimeout(() => location.reload(), 900);
}

/* Kho dữ liệu có sống không — hỏi /api/health (endpoint này cũng là thứ giữ cho
   project Supabase gói free không rơi vào trạng thái ngủ). */
async function kiemKho() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    G.kho = r.ok ? await r.json() : { ok: false, db: 'khong_noi_duoc' };
  } catch (e) { G.kho = { ok: false, db: 'khong_noi_duoc' }; }
  return G.kho;
}

/* --- Quán khu đang đứng (/api/quanh) — CHẠY NGẦM, tài xế không phải hiểu quy trình --- */
const _daThuVung = new Set();
let _dangNapVung = false;
function demQuanGan(m) {
  const RR = m || VUNG_GAN; let n = 0;
  for (const s of SPOTS) if (haversine(G.you, s) <= RR) n++;
  return n;
}
const vungHienTai = () => VUNG.find(v => v.key === vungKey(G.you.lat, G.you.lng)) || null;
/* ĐIỂM P CAO NHẤT của một khu — bằng chứng khu vừa nạp đã được chấm điểm thật,
   chạy chung MỘT thang với quán TP.HCM chứ không có thang riêng.
   Ngoài giờ lái hộ (trước 14h) thì mọi quán đóng cửa → không có P, nói thẳng. */
function pCaoNhat(key) {
  const m = G.metrics; if (!m) return null;
  const ds = m.raw.filter(r => r.sp.vung === key && r.open);
  if (!ds.length) return null;
  const b = ds.reduce((a, r) => (r.p > a.p ? r : a), ds[0]);
  return { p: b.hotScore, ten: cleanName(b.sp).slice(0, 22) };
}
/* napVung(tay, khu)
     tay  = tài xế tự bấm nút (luôn nạp, kể cả khu đã có dữ liệu)
     khu  = nạp theo Ô LƯỚI CỦA MÁY KHÁC lấy từ sổ khu dùng chung. Có `khu` thì
            KHÔNG ghi mốc thời gian mới vào sổ — ghi lại là hai máy đẩy qua đẩy
            lại nhau, mỗi vòng đồng bộ lại tưởng có thay đổi, không bao giờ dứt. */
async function napVung(tay, khu) {
  if (_dangNapVung) return false;
  const lat = khu ? khu.lat : G.you.lat, lng = khu ? khu.lng : G.you.lng;
  const key = khu ? khu.key : vungKey(lat, lng);
  if (!tay && !khu && _daThuVung.has(key)) return false;   // mỗi khu chỉ tự thử MỘT LẦN mỗi phiên
  if (!tay && !khu && demQuanGan() >= VUNG_IT) return false;
  _daThuVung.add(key);
  _dangNapVung = true; G.napVungLoi = ''; paint();
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
    let r; try { r = await fetch(`/api/quanh?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`, { cache: 'no-store', signal: ctl.signal }); } finally { clearTimeout(to); }
    const j = r.ok ? await r.json() : null;
    if (!j || !j.ok) {
      G.napVungLoi = (j && j.loi) || 'Chưa hỏi được máy chủ.';
      if (tay) UIsay('⚠️ ' + G.napVungLoi);
      return false;
    }
    const rows = (j.spots || []).filter(x => Array.isArray(x) && x.length >= 7 && trongVN(x[2], x[3]));
    const ten = (j.vung && j.vung.ten) || '';
    if (!rows.length) {
      G.napVungLoi = j.trong || 'Khu này chưa có quán nào trong kho dữ liệu.';
      if (tay) UIsay('📍 ' + G.napVungLoi);
      return false;
    }
    const zlat = (j.vung && j.vung.lat) != null ? j.vung.lat : lat;
    const zlng = (j.vung && j.vung.lng) != null ? j.vung.lng : lng;
    const zr = (j.vung && j.vung.r) || VUNG_GAN;
    VUNG = VUNG.filter(v => v.key !== key);
    VUNG.unshift({ key, ten, lat: zlat, lng: zlng, r: zr, ts: Date.now(), rev: j.rev || null, quanhDay: j.quanhDay || rows.length, spots: rows });
    VUNG = VUNG.slice(0, VUNG_TOI_DA);
    const luuDuoc = luuVung();
    /* GHI VÀO SỔ KHU DÙNG CHUNG rồi đẩy lên ngay → máy kia đang mở app sẽ tự nạp
       khu này trong ~12 giây. Đây là chỗ biến "máy nào chạy tới đâu biết tới đó"
       thành "một máy biết là cả tài khoản biết".
       Nạp theo ô lưới của máy khác (có `khu`) thì giữ nguyên mốc thời gian cũ. */
    if (!khu) {
      ghiSoKhu({ key, ten, lat: +zlat.toFixed(2), lng: +zlng.toFixed(2), r: zr, ts: Date.now(), rev: j.rev || '', n: rows.length, del: 0 });
      if (typeof SYNC !== 'undefined') SYNC.dirty('zone', key);
    }
    buildSpots(null); G.lastBestId = null;
    const c = spotCounts();
    if (G.dataStatus) { G.dataStatus.count = c.shared; G.dataStatus.mine = c.mine; G.dataStatus.vung = c.vung; G.dataStatus.total = c.total; G.dataStatus.napAt = Date.now(); }
    recompute();
    /* BÁO LUÔN ĐIỂM P CAO NHẤT của khu vừa nạp. Chỉ nói "đã có 40 điểm" thì tài xế
       không biết nạp xong có dùng được không — con số P mới là thứ chứng minh khu
       này đã chạy chung một thang điểm với TP.HCM. */
    const cao = pCaoNhat(key);
    if (tay || (!khu && rows.length)) UIsay(
      `✓ ${rows.length} điểm ở ${ten || 'khu này'}` +
      (cao ? ` · điểm cao nhất ${cao.p}% (${cao.ten})` : ' · ngoài giờ lái hộ nên chưa chấm điểm') +
      (luuDuoc ? '' : ' ⚠️ bộ nhớ máy đầy'), 6000);
    return true;
  } catch (e) {
    G.napVungLoi = 'Mạng chậm hoặc mất sóng.';
    if (tay) UIsay('⚠️ ' + G.napVungLoi);
    return false;
  } finally { _dangNapVung = false; paint(); }
}
/* Xoá khu = "bia mộ" trong sổ dùng chung rồi đẩy lên, KHÔNG xoá trắng.
   Xoá trắng thì vòng đồng bộ sau máy kia còn giữ khu đó sẽ đẩy về — xoá xong nó sống lại. */
function xoaVung(key) {
  const z = ZONE_REG.find(x => x.key === key);
  const v = VUNG.find(x => x.key === key);
  if (!z && !v) return false;
  ghiSoKhu({ ...(z || { key, ten: (v && v.ten) || '', lat: +(+(v ? v.lat : 0)).toFixed(2), lng: +(+(v ? v.lng : 0)).toFixed(2), r: VUNG_GAN, rev: '', n: 0 }), del: 1, ts: Date.now() });
  VUNG = VUNG.filter(x => x.key !== key); luuVung(); _daThuVung.delete(key);
  buildSpots(null); recompute();
  if (typeof SYNC !== 'undefined') SYNC.dirty('zone', key);
  return true;
}

/* ═══════════════════ PHẦN 11 · THÔNG BÁO ═══════════════════ */
function canNotify() { return typeof Notification !== 'undefined' && Notification.permission === 'granted'; }
function notify(title, body, data, actions) {
  try {
    if (!G.notifOn || !canNotify()) return;
    const opt = { body, icon: 'icon.svg', badge: 'icon.svg', tag: 'radar-hot', renotify: true, vibrate: [90, 50, 90], data: data || {}, actions: actions || [] };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opt)).catch(() => { try { new Notification(title, { body, icon: 'icon.svg' }); } catch (e) {} });
    else new Notification(title, { body, icon: 'icon.svg' });
  } catch (e) {}
}
function notifyBest(isTest) {
  const d = G.decision; if (!d || !d.ok) return false;
  notify((isTest ? '[Thử] ' : '🔥 ') + d.demand_score + '% · ' + d.recommended_name,
    `${d.recommended_area || ''} · ${d.distance} km · ${d.eta} phút`,
    { url: '/kiem-cuoc', gmap: d.nav },
    [{ action: 'nav', title: '🧭 Chỉ đường' }, { action: 'open', title: 'Mở app' }]);
  return true;
}
let notifCd = 0, goldNotified = false;
function maybeNotify() {
  const d = G.decision;
  if (!G.notifOn || !G.online || !d || !d.ok) return;
  if (!withinService(realHour())) return;   // KHÔNG báo ngoài giờ (vd 9h sáng) — theo GIỜ THỰC
  if (isGolden(realHour()) && !goldNotified) {
    goldNotified = true;
    notify('🍺 Giờ vàng đã tới', `Nên đứng: ${d.recommended_name} · ${d.demand_score}%`,
      { url: '/kiem-cuoc', gmap: d.nav }, [{ action: 'nav', title: '🧭 Chỉ đường' }, { action: 'open', title: 'Mở app' }]);
    notifCd = 8; return;
  }
  if (!isGolden(realHour())) goldNotified = false;
  if (notifCd > 0) { notifCd--; return; }
  if (d.demand_score >= 50 && d.eta <= 8) { notifyBest(false); notifCd = 12; }
}
async function enableNotif() {
  if (typeof Notification === 'undefined') { UIsay('Máy không hỗ trợ thông báo.'); return false; }
  let p = Notification.permission;
  if (p !== 'granted') p = await Notification.requestPermission();
  if (p !== 'granted') { UIsay('Chưa cho phép thông báo.'); return false; }
  G.notifOn = true; flagSet('roadai_laiho_notif', true);
  return true;
}

/* ═══════════════════ PHẦN 12 · VÒNG CHẠY ═══════════════════
   recompute() = tính lại toàn bộ rồi BÁO cho giao diện qua đúng một cửa: paint().
   Engine không biết giao diện vẽ gì; giao diện không biết engine tính thế nào. */
function UIsay(msg) { if (typeof window !== 'undefined' && window.UI && UI.toast) UI.toast(msg); }
function paint() { if (typeof window !== 'undefined' && window.UI && UI.paint) UI.paint(G.metrics, G.decision); }
function recompute() {
  const m = computeAll();
  m.wait = optimalWait(m);
  m.route = goldenRoute(m);
  G.metrics = m;
  if (!m.best || (G.bestRoute && G.bestRoute.id !== m.best.sp.id)) G.bestRoute = null;
  G.decision = getDecision(m);
  paint();
  if (m.best) routeBest(m.best);
  /* Chạy ra khỏi vùng dữ liệu → TỰ nạp quán khu đó, khỏi bắt tài xế nhớ bấm nút.
     Chỉ tự nạp khi GPS thật: kéo tay cái chấm trên bản đồ mà cũng nạp thì kho đầy
     những khu tài xế chưa từng đặt chân tới. */
  G.quanGan = demQuanGan();
  if (G.autoData && G.quanGan < VUNG_IT && G.hasGps && G.youFromGps && G.online) napVung(false);
}
function tick() { G.tick++; stepDemand(); recompute(); maybeNotify(); }

/* ═══════════════════ PHẦN 13 · HÀNH ĐỘNG (giao diện gọi) ═══════════════════ */
/* CỜ BẬT/TẮT ghi bằng setItem THÔ, KHÔNG qua lsSet.
   lsSet chạy JSON.stringify nên '0' bị lưu thành '"0"' (có nháy) — đọc lại bằng
   `getItem(k) !== '0'` sẽ luôn ra true, tức là tắt xong mở app lại nó tự bật.
   Đã dính đúng lỗi này với cờ "đang nghỉ"; giữ hai kiểu ghi tách bạch cho khỏi lặp. */
const flagSet = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) {} };
const flagGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v === '1'; } catch (e) { return d; } };
function setOnline(v) { G.online = v; flagSet('roadai_butl_online', v); recompute(); }
function setFilter(f) { G.filter = f; G.lastBestId = null; recompute(); }
function skipBest() {
  const r = G.metrics && G.metrics.best; if (!r) return null;
  SKIPPED.add(r.sp.id); G.lastBestId = null; G.session.suggested++;
  recompute();
  return G.metrics && G.metrics.best;
}
/* THÊM QUÁN. Backend tự: gộp trùng trong 55m → chấm điểm → lưu → đồng bộ mọi máy. */
function addPointHere(name, cat, xe, addr, quan) {
  const { p, gop } = upsertPick(name || '★ Điểm đón của tôi', G.you.lat, G.you.lng, cat || 'phonhau', quan, xe, addr);
  buildSpots(); G.lastBestId = null; SKIPPED.clear(); recompute();
  return { p, gop };
}
/* ĐỊA CHỈ THEO ĐỊNH VỊ — hỏi máy chủ (VietMap, hụt thì OpenStreetMap).
   Nhớ theo toạ độ làm tròn: bấm ➕ mấy lần liền ở cùng chỗ chỉ hỏi một lần. */
const _dcCache = new Map();
async function diaChiTaiDay(lat, lng) {
  const la = +(+(lat != null ? lat : G.you.lat)).toFixed(5), lo = +(+(lng != null ? lng : G.you.lng)).toFixed(5);
  const k = la + ',' + lo;
  if (_dcCache.has(k)) return _dcCache.get(k);
  let kq = { ok: false, addr: '', quan: '' };
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
    let r; try { r = await fetch(`/api/diachi?lat=${la}&lng=${lo}`, { signal: ctl.signal }); } finally { clearTimeout(to); }
    if (r.ok) { const j = await r.json(); if (j && j.ok) kq = { ok: true, addr: j.addr || '', quan: j.quan || '' }; }
  } catch (e) {}
  _dcCache.set(k, kq);
  return kq;
}
/* CẬP NHẬT một quán ĐÃ CÓ (loại xe / địa chỉ) thay vì đẻ chấm mới.
   Quán lấy từ bản đồ (không phải điểm tự nạp) thì tạo một điểm tự nạp NGAY TẠI
   TOẠ ĐỘ CỦA NÓ — máy chủ gộp <55m nên vẫn là một chỗ, không sinh chấm trùng. */
function spotById(id) {
  const r = findR(id); if (r) return r.sp;
  return SPOTS.find(s => s.id === id) || null;
}
function capNhatQuan(spotId, xe, addr) {
  const sp = spotById(spotId); if (!sp) return null;
  if (sp.source === 'mine' && sp.pid) {
    let own = ownPick(sp.pid);
    if (!own) { const m = myPick(sp.pid); if (!m) return null; own = { ...m, n: 0, win: 0, fix: 0, del: 0 }; MY_PICKS.push(own); }
    if (xe) own.xe = xe;
    if (addr) own.addr = String(addr).slice(0, 120);
    own.ts = Date.now(); savePicks();
  } else {
    upsertPick(cleanName(sp), sp.lat, sp.lng, sp.cat, sp.quan, xe, addr || sp.addr);
  }
  buildSpots(); G.lastBestId = null; recompute();
  return sp;
}
const setXe = (spotId, xe) => !!capNhatQuan(spotId, xe, null);

/* ═══ CHỐNG TRÙNG THEO TÊN ═══
   upsertPick chỉ gộp khi cách dưới 55m. Nhưng toạ độ quán trên bản đồ có thể lệch
   cả trăm mét, và GPS lúc trời mưa còn lệch hơn — nên gõ đúng tên một quán ĐÃ CÓ
   rồi bấm LƯU vẫn đẻ ra chấm thứ hai cùng tên. Chạy vài lần là kho đầy chấm rác,
   không chấm nào đủ cuốc để app kết luận được gì.
   Ở đây soi theo TÊN + khoảng cách trước khi tạo:
     · dưới 60m  → chắc chắn cùng chỗ, khỏi cần khớp tên
     · dưới 400m → phải khớp tên (trùng hẳn, chứa nhau, hoặc ≥70% số từ)
   Trả về danh sách ứng viên để MÀN HÌNH HỎI LẠI tài xế, không tự quyết. */
function timTrung(name, lat, lng, banKinh) {
  const R2 = banKinh || 400;
  const k = boDau(name), tu = k.split(' ').filter(w => w.length > 1);
  if (!k) return [];
  const diem = { lat: lat != null ? lat : G.you.lat, lng: lng != null ? lng : G.you.lng };
  const ra = [];
  for (const sp of SPOTS) {
    const d = haversine(diem, sp);
    if (d > R2) continue;
    const t = boDau(cleanName(sp));
    let khop = 0;
    if (t === k) khop = 100;
    else if (t.includes(k) || k.includes(t)) khop = 85;
    else if (tu.length) { const hit = tu.filter(w => t.includes(w)).length; khop = Math.round(hit / tu.length * 100); }
    if (d < 60 && khop >= 40) khop = Math.max(khop, 80);   // sát nhau vậy thì gần như chắc là một
    if (khop < 70) continue;
    ra.push({ sp, d, khop });
  }
  return ra.sort((a, b) => b.khop - a.khop || a.d - b.d).slice(0, 3);
}
/* GỢI Ý QUÁN ĐÃ CÓ khi tài xế gõ tên — chống nhập trùng.
   Bài học cũ: gõ tay mỗi lần một kiểu ("Ốc Quyên", "oc quyen", "Quán Ốc Quyên")
   sinh 3 chấm khác nhau cho CÙNG một quán, không chấm nào đủ cuốc để kết luận gì.
   Xếp theo: khớp tên → GẦN CHỖ ĐANG ĐỨNG → ưu tiên điểm mình đã nạp. */
const boDau = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
function timQuanGan(q, n) {
  const k = boDau(q);
  const ds = [];
  for (const sp of SPOTS) {
    const d = haversine(G.you, sp);
    if (d > 3000 && !k) continue;                 // chưa gõ gì thì chỉ gợi ý quán trong 3km
    let diem = 0;
    if (k) {
      const t = boDau(sp.name), a = boDau(sp.addr);
      if (t.startsWith(k)) diem = 100; else if (t.includes(k)) diem = 70; else if (a.includes(k)) diem = 40;
      else { const tu = k.split(' ').filter(Boolean); diem = (tu.length && tu.every(w => t.includes(w))) ? 55 : 0; }
      if (!diem) continue;
    }
    diem += d < 150 ? 60 : d < 400 ? 40 : d < 1500 ? 20 : d < 5000 ? 8 : 0;
    if (sp.source === 'mine') diem += 25;
    else if (sp.source === 'butl') diem += 15;
    ds.push({ sp, d, diem });
  }
  ds.sort((a, b) => b.diem - a.diem || a.d - b.d);
  return ds.slice(0, n || 6);
}
function renamePick(pid, name) {
  const own = ownPick(pid) || myPick(pid); if (!own) return false;
  const o = ownPick(pid);
  if (o) { o.name = String(name).trim().slice(0, 70); o.ts = Date.now(); }
  else MY_PICKS.push({ ...own, name: String(name).trim().slice(0, 70), ts: Date.now(), n: 0, win: 0 });
  savePicks(); buildSpots(); recompute(); return true;
}
function delPick(pid) {
  const p = ownPick(pid) || myPick(pid); if (!p) return null;
  const s = pickStatus(p);
  const own = ownPick(pid);
  // Xoá = "bia mộ" kèm mốc thời gian rồi đẩy lên máy chủ. Xoá trắng thì lần đồng bộ
  // sau máy kia lại đẩy điểm đó về — xoá xong nó sống lại.
  if (own) { own.del = 1; own.ts = Date.now(); } else MY_PICKS.push({ ...p, del: 1, ts: Date.now(), n: 0, win: 0 });
  savePicks(); buildSpots(); recompute(); return s;
}
function findR(id) { return (G.metrics && G.metrics.raw || []).find(x => x.sp.id === id) || null; }
function toggleFav(id) { const r = findR(id); if (!r) return false; const k = spotKey(r.sp); FAV.has(k) ? FAV.delete(k) : FAV.add(k); saveFav(); recompute(); return FAV.has(k); }
function setNote(id, txt) { const r = findR(id); if (!r) return; const k = spotKey(r.sp); if (txt && txt.trim()) NOTES[k] = txt.trim(); else delete NOTES[k]; saveNotes(); recompute(); }
function hideSpot(id) { const r = findR(id); if (!r) return false; hideSpotKey(spotKey(r.sp)); G.lastBestId = null; recompute(); return true; }
function unhideAll() { const n = HIDDEN.size; for (const k of [...HIDDEN]) unhideKey(k); G.lastBestId = null; recompute(); return n; }
/* Dời điểm về đúng chỗ đang đứng (GPS) — dữ liệu bản đồ chỉ gần đúng, tài xế đứng tại chỗ mới biết. */
function fixSpot(id) {
  const r = findR(id); if (!r) return false;
  if (!G.hasGps) return false;
  if (r.sp.source === 'mine' && r.sp.pid) {
    const own = ownPick(r.sp.pid);
    if (own) { own.lat = +G.you.lat.toFixed(5); own.lng = +G.you.lng.toFixed(5); own.fix = (own.fix || 0) + 1; own.ts = Date.now(); savePicks(); }
  } else {
    hideSpotKey(spotKey(r.sp));
    upsertPick(cleanName(r.sp), G.you.lat, G.you.lng, r.sp.cat, r.sp.quan || '');
  }
  buildSpots(); G.lastBestId = null; SKIPPED.clear(); recompute(); return true;
}
function resetBrain() {
  TWIN = emptyTwin(); saveTwin();
  G.theta = THETA0.slice(); G.weights = { demand: 1, eta: 1, trend: 0.7, twin: 0.8 };
  G.meanX = [0.4, 0.5, 0.5, 0.5]; G.meanY = 0.3; G.cov = [0, 0, 0, 0];
  G.brierModelEma = 0.25; G.brierBaseEma = 0.25; G.skill = 0; G.skillHist = []; G.resolved = 0; G.days = 0;
  saveBrain(); recompute();
}
/* setYou — fromGps = toạ độ do GPS THẬT đo được (không phải app tự dời/kéo tay).
   Quan trọng: chỉ toạ độ GPS thật mới được phép tự nạp điểm, không thì kho đầy chấm rác. */
function setYou(lat, lng, fromGps) {
  G.you = { lat, lng }; if (fromGps) G.youFromGps = true;
}

/* ═══════════════════ PHẦN 14 · KHỞI ĐỘNG ═══════════════════ */
function boot() {
  const c0 = loadSpotsCache();
  buildSpots(c0 ? c0.spots : null);
  const c = spotCounts();
  G.dataStatus = { count: c.shared, mine: c.mine, vung: c.vung, total: c.total,
    updatedAt: c0 ? c0.updatedAt : null, rev: c0 ? (c0.rev || null) : null,
    source: c0 ? 'đã lưu' : 'bản dựng sẵn' };
  rebuildPicksAll();
  rebuildTwinNet();
  G.jobsN = allTrips().length;
  loadBrain();
  G.hienHet = flagGet('roadai_laiho_hienhet', false);
  G.notifOn = flagGet('roadai_laiho_notif', true);
  G.autoData = flagGet('roadai_butl_autodata', true);
  G.showForecast = flagGet('roadai_butl_forecast', true);
  G.online = flagGet('roadai_butl_online', true);
  try { G.base = localStorage.getItem('roadai_butl_base') || 'dark'; } catch (e) {}
  recompute();
  setInterval(tick, TICK_MS);
  if (G.autoData) {
    refreshSpots(true, false); setInterval(() => { if (G.autoData) refreshSpots(false, false); }, SYNC_MS);
    refreshQuanBo(false); setInterval(() => { if (G.autoData) refreshQuanBo(false); }, 6 * 3600e3);
  }
  fetchWeather(); setInterval(fetchWeather, 20 * 60 * 1000);
  window.addEventListener('online', () => { if (G.autoData) refreshSpots(true, false); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (G.autoData) refreshSpots(false, false);
    try { if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.update().catch(() => {}))); } catch (e) {}
  });
  startGps();
}
/* GPS: có CHỐNG DỘI hai lớp — đi quá 250m HOẶC quá 20 giây mới tính lại toàn bộ.
   Không chống dội thì mỗi giây watchPosition bắn một lần là máy tính lại 400 quán liên tục. */
let _lastFix = null, _lastRecalc = 0;
function startGps() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(p => {
    G.hasGps = true; setYou(p.coords.latitude, p.coords.longitude, true);
    _lastFix = { ...G.you }; recompute(); fetchWeather();
    if (window.UI && UI.centerMap) UI.centerMap(true);
  }, () => {}, { enableHighAccuracy: false, timeout: 6000 });
  if (!navigator.geolocation.watchPosition) return;
  navigator.geolocation.watchPosition(p => {
    G.hasGps = true;
    const nx = { lat: p.coords.latitude, lng: p.coords.longitude };
    const moved = _lastFix ? haversine(_lastFix, nx) : Infinity;
    G.you = nx; G.youFromGps = true;
    if (window.UI && UI.moveMe) UI.moveMe(nx);
    if (moved > 250 && Date.now() - _lastRecalc > 20000) { _lastFix = nx; _lastRecalc = Date.now(); G.lastBestId = null; recompute(); }
  }, () => {}, { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 });
}
function locateNow() {
  if (!navigator.geolocation) return Promise.resolve(false);
  return new Promise(res => navigator.geolocation.getCurrentPosition(p => {
    G.hasGps = true; setYou(p.coords.latitude, p.coords.longitude, true);
    _lastFix = { ...G.you }; _lastRecalc = Date.now();
    G.pendingLog = null; G.chainFrom = null; SKIPPED.clear(); G.lastBestId = null;
    recompute(); fetchWeather(); res(true);
  }, () => res(false), { enableHighAccuracy: true, timeout: 8000 }));
}

/* Mặt tiền cho giao diện + tầng đồng bộ. Đây là danh sách ĐẦY ĐỦ những gì
   js/radar-ui.js được phép dùng — thêm gì thì thêm ở đây, đừng thò tay vào trong. */
const RADAR = {
  G, boot, recompute, paint,
  // dữ liệu
  spots: () => SPOTS, metrics: () => G.metrics, decision: () => G.decision, findR,
  picks: { my: () => MY_PICKS, all: () => PICKS_ALL, status: pickStatus, live: livePicks },
  trips: { all: allTrips, mine: () => MY_TRIPS, addNet: applyNetTrips, invalidate: invalidateTrips },
  hidden: { set: () => HIDDEN, log: hideLogArr, add: hideSpotKey, del: unhideKey, save: saveHidden },
  vung: { list: () => VUNG, cur: vungHienTai, nap: napVung, xoa: xoaVung, near: demQuanGan,
          busy: () => _dangNapVung || _dangNapThieu, min: VUNG_IT, max: VUNG_TOI_DA,
          // sổ khu dùng chung — tầng đồng bộ đọc/ghi qua đây
          reg: () => ZONE_REG, live: soKhuSong, apply: applyZones, fill: napKhuThieu, pCao: pCaoNhat },
  banQuan, health: kiemKho,
  quanBo: { info: () => G.quanBo || (ls(QUANBO_LS, null) || null), nap: refreshQuanBo, so: () => QUAN_BO.length },
  flags: { set: flagSet, get: flagGet, canNotify },
  // MÃ BẢN danh sách quán dùng chung máy này đang chạy — để máy khác biết mình có cũ không
  spotsRev: () => (G.dataStatus && G.dataStatus.rev) || '',
  spotsAt: () => (G.dataStatus && (G.dataStatus.checkedAt || 0)) || 0,
  stats: { jobs: jobStats, calib: calibReport, band: bandStats, peak: peakSpots, counts: spotCounts },
  /* Cửa DUY NHẤT để tầng đồng bộ (js/radar-sync.js) ghi bản đã gộp từ máy chủ vào kho.
     Không cho ai khác đụng thẳng vào biến — sai một chỗ là 2 máy lệch số ngay. */
  store: {
    setPicksAll(list) { PICKS_ALL = Array.isArray(list) ? list : []; },
    saveMyPicks() { lsSet(PICKS_LS, MY_PICKS); },
    buildSpots, savePicks, rebuildPicksAll, saveHidden,
    hiddenSet: () => HIDDEN,
    hiddenAdd(k) { if (!HIDDEN.has(k)) { HIDDEN.add(k); if (!HIDE_LOG[k]) HIDE_LOG[k] = { ts: 1, on: 1 }; } },
    hiddenDel(k) { HIDDEN.delete(k); HIDE_LOG[k] = { ts: (HIDE_LOG[k] && HIDE_LOG[k].ts) || Date.now(), on: 0 }; },
    ls, lsSet, rid,
  },
  // hành động
  act: { setOnline, setFilter, skipBest, addPointHere, renamePick, delPick, toggleFav, setNote,
         setXe, capNhatQuan, timQuanGan, timTrung, spotById, diaChiTaiDay,
         hideSpot, unhideAll, fixSpot, resetBrain, logJob, logDong, locateNow, setYou,
         refreshSpots, hardResync, enableNotif, notifyBest, fetchWeather },
  // tiện ích dùng chung
  util: { haversine, fmtDist, fmtMin, fmtClose, cleanName, spotKey, navUrl, gmapsDir, routeUrl,
          bandOf, bestBandOf, choTaiCho, xeCuaSpot, empOf, curHour, realHour, isGolden, withinService, clamp },
  K: { CAT_VI, BAND_VI, BANDS, DAY_VI, XE_ICON, WMO, COVER_R, NGUON_TEN, FAV: () => FAV, NOTES: () => NOTES },
};
if (typeof window !== 'undefined') window.RADAR = RADAR;
if (typeof module !== 'undefined' && module.exports) module.exports = RADAR;   // cho bộ thử chạy trong node
