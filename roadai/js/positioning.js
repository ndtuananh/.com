/* ============ RoadAI · Driver Radar — Bạn Uống Tôi Lái (BUTL) ============
   Trả lời 1 câu: "TỐI NAY ĐỨNG ĐÂU để dễ nổ cuốc nhất?"

   NGUYÊN TẮC: KHÔNG bịa dữ liệu.
   • Quán là THẬT (OpenStreetMap tự cập nhật) + điểm đón THẬT từ chuyến BUTL của tài xế.
   • Thời tiết THẬT (Open-Meteo).
   • ĐÃ BỎ: mọi tính toán tiền/giá cước (không ai biết trước cuốc bao nhiêu tiền)
             và mọi "tài xế ảo" mô phỏng (không có dữ liệu vị trí tài xế thật).
   • AI CHỈ học từ cuốc THẬT tài xế bấm "Có khách / Chưa có".
========================================================================= */
'use strict';

/* ========================= HẰNG SỐ & TIỆN ÍCH ========================= */
const WIN_MIN = 15;            // cửa sổ dự báo (phút)
const CITY_KMH = 26;           // tốc độ nội đô ban đêm
const ROAD_FACTOR = 1.35;      // đường thực > đường chim bay
const TICK_MS = 30000;         // cập nhật mỗi 30 giây
const RECO_FLAMES = 6;

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
const pct = x => Math.round(x * 100) + '%';
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let toastT; function toast(msg, ms = 2800) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }
function drift(prev, target, vol) { return clamp(lerp(prev, target, 0.25) + (Math.random() - 0.5) * vol, 0.05, 3); }
function gmapsDir(lat, lng) { return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`; }
/* NGUỒN DỮ LIỆU MỘT ĐIỂM — 4 loại, KHÔNG được nhập nhèm với nhau:
   'butl'   = ĐIỂM ĐÓN THẬT, đọc từ ảnh chuyến BUTL của chính tài xế (js/learned-spots.js).
              Tên + địa chỉ y như app BUTL hiện, toạ độ tra bản đồ, có ghi độ chính xác.
   'mine'   = tài xế tự bấm ➕ tại chỗ.
   'doitac' = quán ĐỐI TÁC BUTL (js/butl-partners.js) — khách quán này hay gọi lái hộ,
              nhưng CHƯA nổ cuốc thật ở đây. Trước đây gắn nhầm nguồn 'butl' nên app
              khoe "đã từng nổ cuốc ở đây" cho cả 96 quán chưa chạy bao giờ → đã tách ra.
   'osm'    = quán lấy từ OpenStreetMap, tên CHƯA kiểm chứng. */
// Nguồn TÊN của quán OSM — hiện thẳng cho tài xế biết tên đó ai xác nhận (Google bắt buộc ghi nguồn)
const NGUON_TEN = { google: 'Google Maps', vietmap: 'bản đồ VietMap', overture: 'Overture Maps (dữ liệu mở)', 'đệm': 'bản đồ (bản đã lưu)' };
const isZone = sp => sp.source === 'butl' || sp.source === 'mine';
const isData = sp => isZone(sp) || sp.source === 'doitac';   // đã đối chiếu dữ liệu thật
// LUÔN dẫn đường tới đúng VỊ TRÍ (toạ độ) — không search theo tên để tránh ra quán đã đóng cửa
function navUrl(sp) { return gmapsDir(sp.lat, sp.lng); }
const cleanName = sp => (sp.name || '').replace(/^★\s*/, '');

/* ========================= KHUNG GIỜ CẦU LÁI HỘ (đỉnh lúc tan quán) ========================= */
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
  tieccuoi: makeCurve(0.01, [{ h: 19.5, w: 1, s: 1.15 }, { h: 20.8, w: .55, s: .9 }]),   // tiệc cưới/hội nghị: tan ~20–21h30, KHÔNG phải giờ vàng
  sanbong:  makeCurve(0.02, [{ h: 23, w: 1, s: 1.9 }, { h: 1, w: .7, s: 1.6 }]),
  vanphong: makeCurve(0.02, [{ h: 20.5, w: 1, s: 1.3 }, { h: 22, w: .5, s: 1.1 }]),
  // ĐIỂM ĐÓN: địa chỉ khách (nhà/chung cư/hẻm) đã từng nổ cuốc thật — không phải quán,
  // nên KHÔNG có giờ đóng cửa. Khách gọi lái hộ ở đây rải từ tối tới khuya.
  diemdon:  makeCurve(0.05, [{ h: 21, w: .85, s: 1.9 }, { h: 23, w: 1, s: 1.9 }, { h: 1, w: .7, s: 1.7 }]),
};
function curveAt(cat, h) { const c = CURVES[cat] || CURVES.phonhau; const f = ((h % 24) + 24) % 24; const i = Math.floor(f), n = (i + 1) % 24; return lerp(c[i], c[n], f - i); }
const VOL = { phonhau: .28, beerclub: .35, bar: .5, karaoke: .38, nhahang: .3, tieccuoi: .45, sanbong: .55, vanphong: .32, diemdon: .3 };
const CAT_VI = { phonhau: 'Phố/quán nhậu', beerclub: 'Beer club', bar: 'Bar / Pub', karaoke: 'Karaoke', nhahang: 'Nhà hàng / tiệc', tieccuoi: 'Tiệc cưới / hội nghị', sanbong: 'Quán bóng đá', vanphong: 'Khu VP (after-work)', diemdon: 'Điểm đón (địa chỉ khách)' };
const CLOSE_H = { phonhau: 0, beerclub: 1.5, bar: 2, karaoke: 1.5, nhahang: 22.75, tieccuoi: 21.5, sanbong: 1, vanphong: 22, diemdon: 2 };
const OPEN_H = { phonhau: 16, beerclub: 18, bar: 18, karaoke: 14, nhahang: 11, tieccuoi: 10, sanbong: 16, vanphong: 17, diemdon: 15 };  // giờ mở cửa TB

/* ======= TỈ LỆ KHÁCH RỜI QUÁN THẬT SỰ CẦN LÁI HỘ (mấu chốt xếp hạng) =======
   Nhà hàng/tiệc cưới ĐÔNG người nhưng phần lớn đi gia đình, có người tỉnh lái về.
   Quán nhậu/beer club ít người hơn nhưng gần như ai cũng say → mới là chỗ nổ cuốc BUTL.
   Không nhân tỉ lệ này thì "Tiệc cưới White Palace" luôn leo top giờ vàng — sai thực tế. */
const LAIHO_RATE = { phonhau: 1, beerclub: .95, bar: .85, karaoke: .6, sanbong: .5, vanphong: .45, nhahang: .3, tieccuoi: .22, diemdon: 1 };
const laihoRate = sp => LAIHO_RATE[sp.cat] != null ? LAIHO_RATE[sp.cat] : .7;
/* Tự nhận diện lại loại quán theo TÊN — điểm tài xế tự thêm hay OSM hay gắn sai nhóm.
   Chỉ sửa khi tên nói rõ ràng, không đoán mò. */
const NAME_CAT = [
  [/tiệc cưới|hội nghị|wedding|palace|trung tâm tiệc|nhà hàng tiệc|hội trường/i, 'tieccuoi'],
  [/karaoke|icool|\bktv\b/i, 'karaoke'],
  [/beer ?club|bia hơi|bia tươi|brewing|brewery|beer garden/i, 'beerclub'],
  [/\bbar\b|\bpub\b|lounge|cocktail|whisky/i, 'bar'],
  [/nhậu|lẩu|nướng|hải sản|ẩm thực|quán ốc|ốc ngon|quán dê|dê núi|bò tơ|quán bia|vườn bia|bia sài gòn/i, 'phonhau'],
];
function autoCat(name, cat) {
  if (cat === 'diemdon') return cat;   // địa chỉ khách — tên có chữ "nhà hàng/nhậu" cũng không phải quán
  const s = String(name || '');
  for (const [re, c] of NAME_CAT) {
    if (!re.test(s)) continue;
    // tiệc cưới / karaoke: tên đã nói rõ thì luôn sửa. Nhóm nhậu: chỉ nâng từ nhà hàng lên (không hạ nhóm đã đúng).
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
  if (c <= o) c += 24; let h = hour; if (h < o) h += 24;
  return h >= o - 0.5 && h <= c + 0.25;
}

/* ========================= ĐIỂM QUÁN ========================= */
const SEED_FALLBACK = [
  ['Phố nhậu Đường Tên Lửa', 'phonhau', 10.74406, 106.61316, 16, 5, 'Bình Tân'],
  ['Nhậu Kinh Dương Vương', 'phonhau', 10.74169, 106.61434, 12, 6, 'Bình Tân'],
  ['Phố Tây Bùi Viện', 'bar', 10.76700, 106.69260, 14, 5, 'Quận 1'],
  ['Phố nhậu Phạm Văn Đồng', 'phonhau', 10.83958, 106.73850, 14, 9, 'Bình Thạnh'],
];
const OSM_SPOTS = (typeof window !== 'undefined' && window.LAIHO_SPOTS && window.LAIHO_SPOTS.length) ? window.LAIHO_SPOTS : SEED_FALLBACK;
/* ================= ĐIỂM ĐÓN TỰ NẠP (➕) — có DANH TÍNH, có BẰNG CHỨNG, ĐỒNG BỘ 2 MÁY =========
   Bản cũ: mảng-trong-mảng, không id, không dedup → mỗi lần nổ cuốc lại đẻ thêm một chấm
   "★ Nổ cuốc (GPS)" mới, thêm 2 lần cùng quán là ra 2 chấm, và không máy nào thấy của máy nào.
   Bản này mỗi điểm có:
     id  — danh tính cố định, đổi tên/nắn toạ độ vẫn giữ nguyên bằng chứng
     n/win — số cuốc THẬT đã chạy ở đây (của RIÊNG máy này; máy chủ cộng dồn các máy)
     fix — số lần toạ độ được nắn lại theo GPS thật → càng chạy càng đúng chỗ
   MY_PICKS   = phần đóng góp của RIÊNG máy này (thứ gửi lên máy chủ)
   PICKS_ALL  = bản đã GỘP mọi máy (thứ app dùng để chạy & hiển thị)
   Tách 2 cái này là bắt buộc: nếu lấy số đã gộp gửi ngược lên thì lần sau cộng dồn lần nữa
   → số cuốc phồng lên gấp đôi, tức là app tự bịa số. */
const MYPICK_LS = 'roadai_laiho_mypickups_v1';      // bản cũ, chỉ đọc 1 lần để chuyển đổi
const PICKS_LS = 'roadai_butl_picks_v2';
const PICK_MERGE_M = 55;                            // dưới 55m coi như cùng một quán
const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const rid = n => { let s = ''; const A = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)]; return s; };
const isAutoName = s => /^★ Nổ cuốc|^Điểm đón của tôi/.test(s || '');

let MY_PICKS = ls(PICKS_LS, null);
if (!Array.isArray(MY_PICKS)) {                     // chuyển đổi từ bản cũ, không mất điểm nào
  MY_PICKS = (ls(MYPICK_LS, []) || []).filter(Array.isArray).map((a, i) => ({
    id: 'm' + rid(7), name: a[0], cat: a[1], lat: +a[2], lng: +a[3], quan: a[6] || 'Tôi thêm',
    ts: Date.now() - (1000 - i), n: 0, win: 0, fix: 0, del: 0,
  }));
  lsSet(PICKS_LS, MY_PICKS);
}
let PICKS_ALL = MY_PICKS.slice();                   // chưa đồng bộ thì bản gộp = bản của máy này
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
const pickRow = p => [p.name, p.cat || 'phonhau', p.lat, p.lng, 13, 7, p.quan || 'Tôi thêm', 'mine', p.id];
/* Gộp 3 kho điểm THẬT theo thứ tự ưu tiên: tự nạp (mine) > đã nổ cuốc (butl) > đối tác (doitac).
   CHỈ gộp khi gần như chắc chắn LÀ MỘT CHỖ: cùng tên & dưới 250m, hoặc sát nhau dưới 35m
   (2 chấm sát vậy trên bản đồ là một). Gộp bừa theo khoảng cách sẽ nuốt mất quán thật —
   vd Nam Phương Lầu và Warning Zone Võ Văn Tần cách nhau ~100m nhưng là 2 quán khác nhau. */
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
function upsertPick(name, lat, lng, cat, quan) {
  lat = +(+lat).toFixed(5); lng = +(+lng).toFixed(5);
  const hit = nearPick(MY_PICKS, lat, lng);
  if (hit) {
    if (name && !isAutoName(name) && isAutoName(hit.name)) hit.name = name;   // tên thật thay tên máy tự đặt
    if (cat) hit.cat = cat;
    hit.ts = Date.now(); hit.del = 0;
    savePicks(); return { p: hit, gop: true };
  }
  const p = { id: 'm' + rid(7), name: (name || 'Điểm đón của tôi').trim().slice(0, 70), cat: cat || 'phonhau', lat, lng, quan: quan || 'Tôi thêm', ts: Date.now(), n: 0, win: 0, fix: 0, del: 0 };
  MY_PICKS.push(p); savePicks(); return { p, gop: false };
}
/* NẮN TOẠ ĐỘ: mỗi cuốc thật ở đây kéo điểm về đúng chỗ GPS đo được (trung bình động).
   Càng chạy nhiều, chấm càng nằm đúng cửa quán thay vì lệch ra giữa đường. */
function refinePick(p, lat, lng) {
  if (!p || !isFinite(lat) || !isFinite(lng)) return;
  const w = 1 / Math.min(8, (p.fix || 0) + 2);       // lần đầu kéo mạnh, sau nhẹ dần cho ổn định
  const nlat = +(p.lat + (lat - p.lat) * w).toFixed(5), nlng = +(p.lng + (lng - p.lng) * w).toFixed(5);
  if (nlat === p.lat && nlng === p.lng) return;
  p.lat = nlat; p.lng = nlng; p.fix = (p.fix || 0) + 1; p.ts = Date.now();
}
/* Ghi 1 cuốc thật vào đúng điểm tự nạp → đây là "bằng chứng" hiển thị cho tài xế.
   Điểm do MÁY KIA nạp thì máy này chưa có bản ghi riêng → phải tạo bản ghi trắng (n=0/win=0)
   rồi mới cộng. Thiếu bước này thì máy B chạy bao nhiêu cuốc cũng không được tính (đã dính lúc thử).
   BẮT BUỘC bắt đầu từ 0: chép số đã gộp vào đây là lần sau máy chủ cộng thêm lần nữa → phồng số. */
function creditPick(id, win, gpsLat, gpsLng, xe, chiQuanSat) {
  let p = ownPick(id);
  if (!p) {
    const m = myPick(id); if (!m) return null;
    p = { ...m, n: 0, win: 0, fix: 0, del: 0, ts: Date.now() };
    MY_PICKS.push(p);
  }
  /* chiQuanSat = chỉ ghi nhận "quán đang đông", CHƯA phải cuốc → không được cộng vào n/win,
     không thì tỉ lệ nổ cuốc bị loãng và app tự bịa thành tích. Đếm riêng ở 'dong'. */
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
const SEED_SPOTS = mergeLearned(OSM_SPOTS);

let SPOTS = [], DMAT = [];
/* BASE_SPOTS = danh sách quán dùng chung đang hiệu lực (đã đồng bộ từ server).
   LỖI CŨ: mỗi lần thêm/xoá/sửa điểm đón, code gọi buildSpots() KHÔNG kèm dữ liệu →
   rơi ngược về danh sách dựng sẵn trong js/spots.js, mất luôn bản đã đồng bộ.
   Chỉ cần 1 máy thêm 1 điểm là 2 máy lệch nhau ngay. Giờ nhớ lại bản đang dùng. */
let BASE_SPOTS = null;
function buildSpots(data) {
  if (data && data.length) BASE_SPOTS = data;
  const src = mergeLearned(BASE_SPOTS && BASE_SPOTS.length ? BASE_SPOTS : OSM_SPOTS);
  // addr/prec/evi: địa chỉ nguyên văn BUTL, độ chính xác toạ độ, bằng chứng cuốc thật.
  // Có 3 thứ này thì app KHÔNG phải nói chung chung "tên có thể khác" nữa — nó chỉ ra
  // đúng địa chỉ và tự khai sai số, tài xế tự kiểm chứng được.
  SPOTS = src.map(([name, cat0, lat, lng, size, homeKm, quan, source, pid, addr, prec, evi, gioMo, gioDong, sao, luot, ghiChu], i) => {
    const cat = autoCat(name, cat0);   // "Hội nghị Tiệc cưới White Palace" ≠ quán nhậu — phân loại lại theo tên
    /* CHỐT CHẶN CUỐI: dòng nào KHÔNG ghi rõ nguồn đã kiểm (butl/mine/doitac/osm) thì coi là
       CHƯA KIỂM ĐƯỢC TÊN → app tự thay tên bằng địa chỉ thật, không bao giờ hiện tên chưa tra.
       Cần chốt ở đây vì máy có thể còn giữ bản chụp cũ trong localStorage, hoặc đang chạy
       danh sách gói sẵn trong js/spots.js — cả hai đều là tên OSM chưa đối chiếu. */
    const srcOk = source === 'butl' || source === 'mine' || source === 'doitac' || source === 'osm';
    const src2 = srcOk ? source : 'osm-addr';
    const nameOut = src2 === 'osm-addr' ? (CAT_VI[cat] || 'Điểm') + ' · ' + (String(addr || '').split(',')[0].trim() || quan || 'chưa rõ địa chỉ') : name;
    return {
      id: 's' + i, pid: pid || null, name: nameOut, cat, cat0, lat, lng, size, homeKm, quan, source: src2,
      addr: addr || '', prec: prec || '', evi: evi || '', ghiChu: ghiChu || '',
      sao: sao || null, luot: luot || null, gioMo: isFinite(gioMo) ? +gioMo : null,
      // GIỜ TAN QUÁN: có giờ THẬT (Google) thì dùng giờ thật, không thì mới ước theo nhóm quán.
      // Đây là con số tài xế canh để tới đón đầu — có thật thì đừng đoán.
      gioThat: isFinite(gioDong),
      closeH: isFinite(gioDong) ? +gioDong : (CLOSE_H[cat] != null ? CLOSE_H[cat] : 0) + (Math.random() - .5) * 0.5,
      noise: 0.9 + Math.random() * 0.2,
    };
  });
  DMAT = SPOTS.map(a => SPOTS.map(b => haversine(a, b)));
  if (G && G.dataStatus && typeof spotCounts === 'function') {   // thêm/xoá điểm riêng → cập nhật lại 2 con số cho đúng
    const c = spotCounts(); G.dataStatus.count = c.shared; G.dataStatus.mine = c.mine; G.dataStatus.total = c.total;
  }
}
const spotKey = sp => sp.name + '@' + (+sp.lat).toFixed(4) + ',' + (+sp.lng).toFixed(4);

/* ========================= TRẠNG THÁI ========================= */
const LKEYS = ['demand', 'eta', 'trend', 'twin'];   // 4 yếu tố — không còn tiền, không còn cạnh tranh ảo
const G = {
  you: { lat: 10.7420, lng: 106.6110 },   // mặc định An Lạc/Tên Lửa (GPS ghi đè)
  hasGps: false, online: true, simHour: null,
  dayType: 'weekday', match: false,
  rain: 0, rainManual: false, weather: null,
  filter: 'all', base: 'dark', tick: 0,
  metrics: null, lastBestId: null, pendingLog: null, chainFrom: null,
  jobsN: 0, simpleMode: true, dataStatus: null, notifOn: false,
  hienHet: false,        // ⚙️ "hiện hết quán (kể cả đang đóng)" — mặc định TẮT cho bản đồ dễ nhìn
  recoBig: false, recoOpen: true,   // thẻ gợi ý mặc định THU GỌN để bản đồ to
  // Hiệu chuẩn THẬT: điểm tốt nhất giờ vàng ~70–80%, điểm thường ~30%, điểm yếu ~10%.
  // (Bộ số cũ cho ra 96% cho gần như mọi điểm → vô nghĩa, và lệch hẳn với điểm trong danh sách.)
  theta: [-3.6, 2.4, 1.6, 0.8, 0.6],       // [bias, demand, eta, trend, twin]
  weights: { demand: 1, eta: 1, trend: 0.7, twin: 0.8 },
  meanX: [0.4, 0.5, 0.5, 0.5], meanY: 0.3, cov: [0, 0, 0, 0],
  brierModelEma: 0.25, brierBaseEma: 0.25, skill: 0, skillHist: [], resolved: 0,
  days: 0, lastDay: null, brainSaved: 0,
  session: { start: Date.now(), suggested: 0, accepted: 0, rides: 0, rating: 4.8 },
};
const THETA0 = G.theta.slice();

/* ===== NÃO AI LƯU VĨNH VIỄN — mỗi ngày mở app là thông minh hơn hôm qua =====
   Trước đây mô hình chỉ nằm trong RAM: đóng app là quên sạch, học bao nhiêu cũng bằng 0.
   Giờ mọi thứ AI học được (trọng số, hiệu chuẩn, kỹ năng, số ngày) đều ghi xuống máy. */
const BRAIN_LS = 'roadai_laiho_brain_v1';
const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const okArr = (a, n) => Array.isArray(a) && a.length === n && a.every(x => typeof x === 'number' && isFinite(x));
function saveBrain() {
  try {
    localStorage.setItem(BRAIN_LS, JSON.stringify({
      v: 1, theta: G.theta, weights: G.weights, meanX: G.meanX, meanY: G.meanY, cov: G.cov,
      brierModelEma: G.brierModelEma, brierBaseEma: G.brierBaseEma, skill: G.skill,
      skillHist: G.skillHist.slice(-120), resolved: G.resolved, days: G.days, lastDay: G.lastDay, ts: Date.now(),
    }));
    G.brainSaved = Date.now();
  } catch (e) {}
}
function loadBrain() {
  let b = null; try { b = JSON.parse(localStorage.getItem(BRAIN_LS) || 'null'); } catch (e) {}
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
  if (G.lastDay !== t) { if (G.lastDay) G.days++; G.lastDay = t; saveBrain(); }   // mở app ngày mới = +1 ngày kinh nghiệm
}
const DAY_MULT = { weekday: 1, weekend: 1.8, payday: 1.35, holiday: 2.4 };
const DAY_VI = { weekday: 'Ngày thường', weekend: 'Cuối tuần', payday: 'Ngày lương', holiday: 'Lễ / cận Tết' };

/* ===== KHUNG GIỜ NGHỀ LÁI HỘ =====
   Học theo TỪNG GIỜ (24 ô) thì cả đời tài xế cũng không đủ mẫu để ô nào ra kết luận.
   Gom về 4 khung đúng nhịp nghề → chỉ vài cuốc là mỗi khung đã có tiếng nói. */
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

/* ===== Digital Twin — học 5 tầng từ cuốc THẬT =====
   nhóm quán · khung giờ · nhóm×khung · từng quán · VÀ QUÁN×KHUNG GIỜ (tầng quan trọng nhất).
   Tầng cuối trả lời đúng câu hỏi của nghề: "quán NÀY cao điểm vào khung NÀO?"
   Trước đây không có tầng này: app biết "bạn mát tay ở quán X" và "bạn mát tay giờ vàng",
   nhưng không bao giờ biết "quán X chỉ ăn giờ vàng, chiều tới là ngồi không". */
const TWIN_LS = 'roadai_laiho_twin_v1';
let TWIN = loadTwin();
function loadTwin() {
  const empty = { cat: {}, hour: {}, slot: {}, spot: {}, band: {}, cb: {}, sb: {} };
  try {
    const t = JSON.parse(localStorage.getItem(TWIN_LS) || '{}');
    for (const k in empty) if (t[k] && typeof t[k] === 'object') empty[k] = t[k];   // dữ liệu cũ giữ nguyên, tầng mới thêm vào
    return empty;
  } catch (e) { return empty; }
}
function saveTwin() { try { localStorage.setItem(TWIN_LS, JSON.stringify(TWIN)); } catch (e) {} }
function twinAffinity(cat, hour, key) {
  const v = (o, d) => o ? o.win / Math.max(3, o.n) : d;
  const b = bandOf(hour);
  return clamp(
      0.20 * v(TWIN.cat[cat], .5)
    + 0.12 * v(TWIN.band[b], .5)
    + 0.20 * v(TWIN.cb[cat + '|' + b], .5)
    + 0.22 * v(key && TWIN.spot[key], .5)
    + 0.26 * v(key && TWIN.sb[key + '|' + b], .5), 0, 1);
}
function twinLearn(cat, hour, win, key, xe) {
  const b = bandOf(hour);
  const bump = (obj, k) => { if (k == null) return; obj[k] = obj[k] || { n: 0, win: 0 }; obj[k].n++; if (win) obj[k].win++; };
  bump(TWIN.cat, cat); bump(TWIN.hour, hour); bump(TWIN.slot, cat + '|' + hour);
  bump(TWIN.spot, key); bump(TWIN.band, b); bump(TWIN.cb, cat + '|' + b); bump(TWIN.sb, key + '|' + b);
  /* LOẠI XE (anh Long đề xuất 01/08): cuốc ô tô và xe máy là hai nghề khác nhau — tài chạy
     xe máy tới quán toàn nổ cuốc ô tô thì đứng cả tối cũng công cốc. Học riêng theo quán. */
  if (win && (xe === 'oto' || xe === 'may')) {
    TWIN.xe = TWIN.xe || {};
    const k = key + '|' + xe;
    TWIN.xe[k] = (TWIN.xe[k] || 0) + 1;
  }
}
/* Quán này hay nổ cuốc XE GÌ — đếm thẳng từ cuốc thật đã ghi, không suy đoán */
function xeCua(key) {
  const x = TWIN.xe || {};
  const oto = x[key + '|oto'] || 0, may = x[key + '|may'] || 0;
  return (oto || may) ? { oto, may } : null;
}
/* XE CỦA MỘT ĐIỂM — gộp 2 nguồn THẬT, không đoán theo loại quán:
   · cuốc anh Long tự bấm ghi (🚗/🏍️) ở chính điểm này;
   · các chuyến BUTL đọc từ ảnh: mỗi điểm đón thật đã kèm sẵn "xe hơi" hay "xe máy".
   Điểm nào chưa có dữ liệu thì trả về null — bản đồ để trống, không gắn bừa ký hiệu. */
function xeCuaSpot(sp) {
  const t = xeCua(spotKey(sp)) || { oto: 0, may: 0 };
  let oto = t.oto, may = t.may;
  const e = String(sp.evi || '');
  if (/xe hơi|xe hoi|ô ?tô|oto/i.test(e)) oto++;
  else if (/xe máy|xe may/i.test(e)) may++;
  if (!oto && !may) return null;
  return { oto, may, chinh: oto === may ? 'ca2' : (oto > may ? 'oto' : 'may') };
}
const XE_ICON = { oto: '🚗', may: '🏍️', ca2: '🚗🏍️' };
const XE_CHU = { oto: 'hay nổ cuốc Ô TÔ', may: 'hay nổ cuốc XE MÁY', ca2: 'nổ cả ô tô lẫn xe máy' };

/* ═══ QUAN SÁT "QUÁN ĐANG ĐÔNG" (anh Long đề xuất 01/08) ═══
   Tài xế tới quán, chưa có cuốc nhưng thấy khách đang nhậu đông → bấm ghi nhận.
   Đây KHÔNG phải cuốc, nên không trộn vào tỉ lệ nổ cuốc (không được làm bẩn con số thật).
   Nó trả lời câu hỏi khác: "đứng chờ ở đây có đáng không?" — app đếm bao nhiêu lần anh
   ghi đông ở khung giờ này, và trong số đó bao nhiêu lần SAU ĐÓ nổ cuốc thật trong 90 phút. */
function obsLearn(key, hour) {
  TWIN.obs = TWIN.obs || {};
  const k = key + '|' + bandOf(hour);
  TWIN.obs[k] = (TWIN.obs[k] || 0) + 1;
}
const CHO_MS = 90 * 60 * 1000;             // "chờ được" = 90 phút
/* Chỉ mục nhật ký theo quán — dựng MỘT LẦN rồi dùng lại.
   Không có chỉ mục thì mỗi vòng tính điểm phải đọc lại nhật ký 400 lần (mỗi quán một lần),
   app giật ngay trên điện thoại cũ. Ghi nhật ký mới → xoá chỉ mục để dựng lại. */
let _nkIdx = null;
function nkIndex() {
  if (_nkIdx) return _nkIdx;
  const m = new Map();
  for (const j of loadJobs()) {
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
   của chính quán đó. So với chính nó nên không bị lẫn với chuyện quán ngon/quán dở. */
function bandLift(key, hour) {
  const b = bandOf(hour);
  const here = key && TWIN.sb[key + '|' + b], all = key && TWIN.spot[key];
  if (!here || !all || here.n < 2 || all.n < 3) return null;
  const pHere = (here.win + 1) / (here.n + 2);        // Laplace: 0/2 không thành "0% tuyệt đối"
  const pAll = (all.win + 1) / (all.n + 2);
  const w = clamp(here.n / (here.n + 5), 0, .85);     // càng nhiều mẫu càng dám tin
  return { band: b, n: here.n, win: here.win, pHere, pAll, delta: w * (pHere - pAll) };
}
// Khung giờ MÁT TAY NHẤT của bạn ở 1 quán — để hiện cho tài xế thấy app học được gì
function bestBandOf(key) {
  let best = null;
  for (const b of BANDS) {
    const o = key && TWIN.sb[key + '|' + b.k];
    if (!o || o.n < 2) continue;
    const r = o.win / o.n;
    if (!best || r > best.rate || (r === best.rate && o.n > best.n)) best = { ...b, n: o.n, win: o.win, rate: r };
  }
  return best;
}
// ĐIỂM THỰC NGHIỆM theo TỪNG ĐIỂM (đúng KPI: chauffeur_score/visit_count/confidence, chạy 100% client-side).
// Wilson lower bound của tỉ lệ nổ cuốc THẬT → điểm thắng nhiều lần xếp trên điểm ăn may 1 lần. Càng log càng chuẩn.
function wilson(win, n, z) { if (!n) return 0; z = z || 1; const p = win / n, z2 = z * z; return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n); }
function empOf(key) { const o = key && TWIN.spot[key]; if (!o || !o.n) return null; return { n: o.n, win: o.win, rate: o.win / o.n, conf: wilson(o.win, o.n, 1) }; }
/* Nhật ký cuốc THẬT */
const JOBS_LS = 'roadai_laiho_jobs_v1';
function loadJobs() { try { return JSON.parse(localStorage.getItem(JOBS_LS) || '[]'); } catch (e) { return []; } }
function saveJob(j) { const a = loadJobs(); a.unshift(j); try { localStorage.setItem(JOBS_LS, JSON.stringify(a.slice(0, 500))); } catch (e) {} _nkIdx = null; }
/* Yêu thích + ghi chú */
const FAV_LS = 'roadai_laiho_fav_v1', NOTE_LS = 'roadai_laiho_notes_v1';
let FAV = new Set(); try { FAV = new Set(JSON.parse(localStorage.getItem(FAV_LS) || '[]')); } catch (e) {}
let NOTES = {}; try { NOTES = JSON.parse(localStorage.getItem(NOTE_LS) || '{}'); } catch (e) {}
function saveFav() { try { localStorage.setItem(FAV_LS, JSON.stringify([...FAV])); } catch (e) {} }
function saveNotes() { try { localStorage.setItem(NOTE_LS, JSON.stringify(NOTES)); } catch (e) {} }
/* Điểm bị ẩn (tài xế báo đã đóng cửa / sai) — không đề xuất, không vẽ. Xác thực bằng người thật.
   Có kèm MỐC THỜI GIAN để đồng bộ 2 máy: máy nào bấm SAU thì máy đó thắng. Không có mốc thời gian
   thì "bỏ ẩn" ở máy A sẽ bị máy B đẩy ẩn trở lại ở lần đồng bộ kế — bỏ ẩn xong nó tự hiện lại. */
const HIDE_LS = 'roadai_laiho_hidden_v1', HIDELOG_LS = 'roadai_butl_hidelog_v1';
let HIDDEN = new Set(); try { HIDDEN = new Set(JSON.parse(localStorage.getItem(HIDE_LS) || '[]')); } catch (e) {}
let HIDE_LOG = ls(HIDELOG_LS, null);
if (!HIDE_LOG || typeof HIDE_LOG !== 'object') { HIDE_LOG = {}; for (const k of HIDDEN) HIDE_LOG[k] = { ts: 1, on: 1 }; lsSet(HIDELOG_LS, HIDE_LOG); }
function saveHidden() { try { localStorage.setItem(HIDE_LS, JSON.stringify([...HIDDEN])); } catch (e) {} lsSet(HIDELOG_LS, HIDE_LOG); }
function hideSpotKey(k) { HIDDEN.add(k); HIDE_LOG[k] = { ts: Date.now(), on: 1 }; saveHidden(); }
function unhideKey(k) { HIDDEN.delete(k); HIDE_LOG[k] = { ts: Date.now(), on: 0 }; saveHidden(); }
const hideLogArr = () => Object.keys(HIDE_LOG).slice(0, 3000).map(k => ({ k, ts: HIDE_LOG[k].ts, on: HIDE_LOG[k].on }));
let SKIPPED = new Set();   // điểm vừa "Bỏ qua" (tạm trong phiên) — để đề xuất điểm KHÁC, xoay vòng

/* ========================= LÕI: CẦU & CHẤM ĐIỂM ========================= */
function realHour() { const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
function curHour() { if (G.simHour != null) return G.simHour; return realHour(); }
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
// λ = số khách SAY CẦN LÁI HỘ quanh điểm đó trong 15' (không phải số khách nói chung).
// Nhân laihoRate là điểm mấu chốt: nhà hàng/tiệc cưới đông nhưng ít ai gọi lái hộ.
// Đẩy cầu theo NGUỒN: nơi đã nổ cuốc thật (butl/mine) mạnh nhất; quán đối tác BUTL đẩy nhẹ
// (khách quán đó dùng app BUTL nhưng bạn chưa từng ăn cuốc ở đây); OSM không đẩy.
const srcBoost = sp => (sp.source === 'butl' || sp.source === 'mine') ? 1.25 : sp.source === 'doitac' ? 1.15 : 1;
function demandOf(sp, hour) { return sp.size * curveAt(sp.cat, hour) * sp.noise * contextMult(sp) * closingSurge(sp, hour) * laihoRate(sp) * srcBoost(sp); }
function congestionNow() { const h = curHour(); return clamp(0.2 + 0.5 * (Math.exp(-((hourDist(h, 8) / 1.3) ** 2)) + Math.exp(-((hourDist(h, 18) / 1.6) ** 2))) + 0.25 * G.rain, 0, 1); }
function trendOf(sp, hour) { const now = curveAt(sp.cat, hour), soon = curveAt(sp.cat, hour + 10 / 60); return clamp((soon - now) * 5 + 0.5, 0.05, 0.95); }

/* ===== MỘT CON SỐ DUY NHẤT =====
   Trước đây app có 3 thang điểm khác nhau cho cùng 1 quán:
     • thẻ đề xuất hiện pModel (96%)  • danh sách tìm kiếm hiện hotScore (88)  • xếp hạng lại chạy theo composite
   ⇒ số ở 3 màn không khớp nhau, và điểm #1 của thẻ đề xuất không phải #1 của danh sách.
   Từ bản này chỉ còn DUY NHẤT r.p = "khả năng bạn nổ được 1 cuốc nếu đứng ở đây 15 phút tới".
   Mọi nơi (đề xuất · tìm kiếm · điều phối · popup · thông báo · màu chấm) đều đọc đúng con số đó,
   và mọi bảng xếp hạng đều sắp theo đúng con số đó. hotScore chỉ là round(p*100). */
const COVER_R = 5000;                     // bán kính phủ sóng quanh tài xế (m)
function scoreOf(r) {
  // 1) phần MÔ HÌNH HỌC ĐƯỢC (4 yếu tố, tự chỉnh theo cuốc thật của chính tài xế)
  let z = G.theta.reduce((s, t, i) => s + t * r.feat[i], 0);
  // 2) phần BẰNG CHỨNG CỨNG — cộng thẳng vào log-odds nên kết quả vẫn là 1 xác suất
  if (r.emp && r.emp.n >= 2) z += 2.2 * (r.emp.conf - 0.35);   // đã nổ cuốc thật ở đây bao nhiêu lần
  // CAO ĐIỂM THEO KHUNG GIỜ HỌC ĐƯỢC: quán này giờ này ăn hơn/kém hơn chính nó ngày thường.
  // Đây là chỗ dữ liệu anh em nạp vào biến thành đề xuất khác đi theo từng khung giờ.
  if (r.bl) z += clamp(2.8 * r.bl.delta, -1.4, 1.4);
  if (isZone(r.sp)) z += 0.35;                                  // điểm đón THẬT (BUTL / bạn tự thêm)
  /* QUAN SÁT "QUÁN ĐANG ĐÔNG" của chính tài xế (anh Long đề xuất): chỉ đẩy khi quan sát đó
     ĐÃ được chứng minh — tức là những lần thấy đông trước đây có dẫn tới cuốc thật trong 90'.
     Thấy đông mà chẳng bao giờ nổ cuốc thì kéo XUỐNG, để khỏi rủ tài xế đứng chờ vô ích. */
  if (r.cho && r.cho.n >= 2) z += clamp(1.6 * (r.cho.no / r.cho.n - 0.35), -0.6, 0.9);
  z -= 0.09 * Math.max(0, r.eta - 6);                           // chạy càng xa, khách càng dễ mất về tay tài gần hơn
  if (r.dist > COVER_R) z -= 1.2;                               // ngoài vùng phủ sóng 5km
  if (!r.open) return -12;
  return z;
}
function computeAll() {
  const hour = curHour(), hInt = Math.floor(hour) % 24;
  const serving = withinService(hour);
  const trafficK = CITY_KMH * (1 - 0.3 * G.rain) * lerp(1, .72, congestionNow());
  const raw = SPOTS.map((sp, si) => ({ sp, si })).filter(o => !HIDDEN.has(spotKey(o.sp))).map(({ sp, si }) => {
    const open = isOpen(sp, hour);
    const lambda = open ? demandOf(sp, hour) : 0;   // quán đóng ⇒ không có cầu, không đề xuất
    const straight = haversine(G.you, sp);
    const dist = straight * ROAD_FACTOR;
    const eta = (dist / 1000) / Math.max(6, trafficK) * 60;
    const usable = clamp((WIN_MIN - eta) / WIN_MIN, 0, 1);   // tới muộn ⇒ cửa sổ còn hẹp
    const expWait = lambda > 0 ? Math.min(WIN_MIN, WIN_MIN / (lambda + 0.15)) : WIN_MIN;
    return { sp, si, open, lambda, straight, dist, eta, usable, expWait, trend: trendOf(sp, hour), mins: minsToClose(sp, hour), hour: hInt };
  });
  // Chuẩn hoá "đông khách" theo CHÍNH KHU 5KM của tài xế — không lấy max toàn thành phố nữa.
  // (Cách cũ khiến quán tốt nhất quanh bạn vẫn chỉ được 0.4 chỉ vì có quán to hơn ở cách 20km.)
  const inCover = raw.filter(r => r.open && r.dist <= COVER_R);
  const scaleSet = inCover.length >= 3 ? inCover : raw.filter(r => r.open);
  const maxL = Math.max(...scaleSet.map(r => r.lambda), 0.001);
  raw.forEach(r => {
    r.sDemand = clamp(r.lambda / maxL, 0, 1);
    r.sEta = r.usable;                     // thang TUYỆT ĐỐI: còn bao nhiêu phần cửa sổ 15' sau khi chạy tới
    r.sTrend = r.trend;
    const _spk = spotKey(r.sp);
    r.sTwin = twinAffinity(r.sp.cat, r.hour, _spk);
    r.emp = empOf(_spk);
    r.bl = bandLift(_spk, hour);          // cao điểm theo khung giờ, học từ cuốc thật ở CHÍNH quán này
    r.cho = choTaiCho(_spk, hour);        // "thấy đông rồi có nổ cuốc không" — dữ liệu tài xế tự ghi
    r.band = bandOf(hour);
    r.feat = [1, r.sDemand, r.sEta, r.sTrend, r.sTwin];
    r.z = scoreOf(r);
    // ⭐ CON SỐ DUY NHẤT. Chặn trần 92%: nghề này không bao giờ chắc chắn — dù bạn đã nổ 20/20 cuốc ở đó.
    r.p = clamp(sigmoid(r.z), 0.02, 0.92);
    r.pModel = r.p;                        // giữ tên cũ cho tương thích
    r.margin = clamp(Math.round(100 * Math.sqrt(r.p * (1 - r.p) / (r.lambda + 8))), 2, 12);
    r.hotScore = Math.round(r.p * 100);    // badge trong Tìm kiếm & Điều phối = ĐÚNG % của thẻ đề xuất
    // Mức "khách cần lái hộ" — ngưỡng tuyệt đối, khớp với chữ CAO/VỪA/THẤP và với màu chấm trên bản đồ
    r.tier = !r.open ? 0 : r.p >= 0.50 ? 3 : r.p >= 0.35 ? 2 : r.p >= 0.22 ? 1 : 0;
  });
  // CHỈ đề xuất quán ĐANG MỞ, trong giờ lái hộ (từ 14h), và trong VÙNG PHỦ SÓNG 5km từ chỗ đứng.
  const openBase = serving ? inCover.slice() : [];
  // "Bỏ qua" → loại điểm vừa bỏ để đề xuất điểm KHÁC; bỏ hết rồi thì xoay vòng lại (không bao giờ bí)
  let pool0 = openBase.filter(r => !SKIPPED.has(r.sp.id));
  if (openBase.length && !pool0.length) { SKIPPED.clear(); pool0 = openBase; }
  const pool = (G.filter && G.filter !== 'all') ? pool0.filter(r => r.sp.cat === G.filter) : pool0;
  // MỘT bảng xếp hạng duy nhất cho tất cả các màn hình
  const byHot = [...pool].sort((a, b) => b.p - a.p || a.eta - b.eta);
  byHot.forEach((r, i) => r.hotRank = i);
  let best = byHot[0] || null;
  // giữ điểm cũ nếu vẫn còn tốt tương đương (đỡ nhảy loạn mỗi 30 giây)
  if (best && G.lastBestId) { const prev = byHot.find(r => r.sp.id === G.lastBestId); if (prev && prev.p >= best.p - 0.03) best = prev; }
  if (best) { G.lastBestId = best.sp.id; best.isBest = true; }
  byHot.slice(0, RECO_FLAMES).forEach(r => r.isFlame = true);
  return { raw, byHot, byComposite: byHot, best, hour, golden: isGolden(hour), serving, offHours: !serving, cover: inCover };
}

// ĐIỂM CHỜ TỐI ƯU: đứng giữa cụm quán (bán kính đi bộ ~750m) để với tới nhiều quán nhất
function optimalWait(m) {
  const WALK = 750; let best = null;
  // Chỉ xét TÂM CỤM nằm trong vùng phủ sóng 5km — trước đây điểm 🅿️ có thể nhảy ra tận cụm cách 20km.
  const cands = (m.cover && m.cover.length) ? m.cover : m.raw.filter(r => r.open);
  for (const c of cands) {
    let cl = 0, cnt = 0, sLat = 0, sLng = 0, wsum = 0;
    for (const r of m.raw) {
      // DMAT đánh chỉ số theo SPOTS, dùng si (không dùng vị trí trong raw — sai khi có điểm bị ẩn)
      const d = (DMAT[c.si] && DMAT[c.si][r.si] != null) ? DMAT[c.si][r.si] : haversine(c.sp, r.sp);
      if (d <= WALK && r.open) { const db = isZone(r.sp) ? 1.8 : 1, w = r.lambda * db * (1 - d / WALK); cl += r.lambda * db; cnt++; sLat += r.sp.lat * w; sLng += r.sp.lng * w; wsum += w; }
    }
    if (cnt < 2 || wsum <= 0) continue;
    const center = { lat: sLat / wsum, lng: sLng / wsum };
    const distYou = haversine(G.you, center);
    const eta = (distYou * ROAD_FACTOR / 1000) / Math.max(6, CITY_KMH * lerp(1, .72, congestionNow())) * 60;
    const score = cl / (1 + eta / 12);
    if (!best || score > best.score) best = { center, cl, cnt, eta, distYou, score };
  }
  return best;
}

/* ===== CUNG ĐƯỜNG RÀ CUỐC (yêu cầu của tài xế: "tìm ra cung đường di chuyển vẫn có khả năng nhận cuốc cao") =====
   Thay vì cắm 1 chỗ, app xâu chuỗi vài điểm mạnh nhất trong vùng phủ sóng thành 1 vòng chạy rà ngắn:
   tham lam theo "điểm cao mà gần" — mỗi 220m đường đổi lấy 1 điểm xác suất. */
function goldenRoute(m, n = 4) {
  const cand = (m.byHot || []).filter(r => r.dist <= COVER_R && r.p >= 0.2).slice(0, 16);
  if (cand.length < 2) return null;
  const seq = []; const left = cand.slice();
  let cur = { lat: G.you.lat, lng: G.you.lng }, legs = 0;
  while (seq.length < n && left.length) {
    let bi = -1, bs = -Infinity;
    left.forEach((r, i) => {
      const d = haversine(cur, r.sp) * ROAD_FACTOR;
      if (seq.length && d > 4200) return;              // không bắt tài chạy nhảy cóc quá xa giữa 2 chặng
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
  // ĐI NGANG BAO NHIÊU QUÁN: lấy mẫu dọc đường mỗi ~350m, đếm quán đang mở trong 800m quanh đường.
  // Đây là con số ĐẾM ĐƯỢC, không phải xác suất bịa — BUTL phát cuốc cho tài gần nhất nên "đi ngang" mới là cái ăn tiền.
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

/* ========================= HỌC TỪ CUỐC THẬT (chỉ khi tài xế bấm Có/Chưa) ========================= */
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

/* ========================= BẢN ĐỒ ========================= */
const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([G.you.lat, G.you.lng], 13);
const OSM = { dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', sub: 'abcd' }, light: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', sub: 'abcd' } };
let baseLayer = null;
function buildBase() { if (baseLayer) map.removeLayer(baseLayer); const st = OSM[G.base] || OSM.dark; baseLayer = L.tileLayer(st.url, { maxZoom: 20, subdomains: st.sub }).addTo(map); document.body.classList.toggle('light-base', G.base === 'light'); }
buildBase();
const heatLayer = L.layerGroup().addTo(map), markerLayer = L.layerGroup().addTo(map);
let youMarker = null, targetLine = null;
const TIER_COLOR = ['#22c55e', '#eab308', '#f97316', '#ef4444'];
const TIER_EMOJI = ['🟢', '🟡', '🟠', '🔴'];

/* fromGps = toạ độ này do GPS THẬT đo được (không phải app tự dời/kéo tay).
   Quan trọng: sau mỗi cuốc thắng app dời chấm ~6km để giả lập chở khách về. Nếu tin toạ độ giả
   đó rồi tự nạp điểm thì kho điểm đầy chấm rác ở giữa đường — sai hoàn toàn. */
function setYou(lat, lng, fly, fromGps) {
  G.you = { lat, lng }; G.youFromGps = !!fromGps;
  if (!youMarker) {
    const icon = L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
    youMarker = L.marker([lat, lng], { icon, zIndexOffset: 1200, draggable: true }).addTo(map);
    youMarker.on('dragend', e => { const p = e.target.getLatLng(); G.you = { lat: p.lat, lng: p.lng }; G.pendingLog = null; G.chainFrom = null; SKIPPED.clear(); G.lastBestId = null; recompute(); });
  } else youMarker.setLatLng([lat, lng]);
  if (fly) map.setView([lat, lng], Math.max(13, map.getZoom()));
}
function drawMap(m) {
  heatLayer.clearLayers(); markerLayer.clearLayers();
  // VÙNG PHỦ SÓNG 5km — bám theo chỗ tài xế đang đứng/đang chạy (yêu cầu của anh Long)
  // ĐÊM DỄ NHÌN: viền dày + sáng hơn, có viền tối lót dưới nên nổi hẳn trên nền bản đồ đen.
  L.circle([G.you.lat, G.you.lng], { radius: COVER_R, color: '#04121f', weight: 8, opacity: .55, fillOpacity: 0, interactive: false }).addTo(heatLayer);
  L.circle([G.you.lat, G.you.lng], { radius: COVER_R, color: '#7dd3fc', weight: 4, opacity: 1, dashArray: '14 10', fillColor: '#38bdf8', fillOpacity: .06, interactive: false }).addTo(heatLayer);
  /* ═══ CHỌN THỨ ĐÁNG VẼ ═══ (sửa 01/08/2026 — bản đồ trước đây vẽ HẾT hơn 400 quán,
     kể cả quán đang đóng và quán cách 20km, thành ra 13h chiều mở app là một rừng vòng
     tròn xám, bác tài 50 tuổi nhìn không ra cái gì. Giờ chỉ vẽ thứ đi được NGAY:
       · Ngoài giờ lái hộ (trước 14h) → chỉ hiện ĐIỂM ĐÓN THẬT, còn lại ẩn sạch.
       · Trong giờ → quán ĐANG MỞ trong vùng 5km, lấy 40 chỗ mạnh nhất.
       · Quán đóng cửa / ngoài 5km → KHÔNG vẽ (mở lại ở ⚙️ Cài đặt nếu muốn xem hết). */
  const trongVung = r => r.dist <= COVER_R;
  const hopFilter = r => G.filter === 'all' || r.sp.cat === G.filter;
  let ve;
  if (G.hienHet) {
    ve = m.raw.filter(hopFilter);
  } else if (m.offHours) {
    ve = m.raw.filter(r => hopFilter(r) && isZone(r.sp) && trongVung(r));
  } else {
    const manh = m.byHot.filter(r => hopFilter(r) && r.open && trongVung(r)).slice(0, 40);
    const diemDon = m.raw.filter(r => hopFilter(r) && isZone(r.sp) && trongVung(r));
    const ids = new Set();
    ve = [...manh, ...diemDon, ...(m.best ? [m.best] : [])].filter(r => !ids.has(r.sp.id) && ids.add(r.sp.id));
  }

  // Quầng nhiệt: CHỈ cho 12 chỗ mạnh nhất đang mở — vẽ hết thì cả bản đồ là một đám mây,
  // không còn phân biệt được chỗ nào hơn chỗ nào.
  const quang = ve.filter(r => r.open).sort((a, b) => b.p - a.p).slice(0, 12);
  for (const r of quang) {
    const col = TIER_COLOR[r.tier];
    L.circle([r.sp.lat, r.sp.lng], { radius: 170 + r.sDemand * 300, color: col, weight: 2, opacity: .75, fillColor: col, fillOpacity: 0.05 + r.sDemand * 0.10, interactive: false }).addTo(heatLayer);
  }
  // ĐIỂM ĐÓN THẬT = vòng teal, luôn nổi nhất vì đây là chỗ ĐÃ nổ cuốc
  for (const r of ve) {
    if (!isZone(r.sp)) continue;
    L.circleMarker([r.sp.lat, r.sp.lng], { radius: 15, color: '#04121f', weight: 6, opacity: .6, fill: false, interactive: false }).addTo(heatLayer);
    L.circleMarker([r.sp.lat, r.sp.lng], { radius: 15, color: '#5eead4', weight: 4, opacity: 1, fillColor: '#2dd4bf', fillOpacity: .38, interactive: false }).addTo(heatLayer);
  }
  for (const r of ve) {
    const zone = isZone(r.sp);                       // điểm đón THẬT (đã nổ cuốc)
    const doitac = r.sp.source === 'doitac';         // quán đối tác BUTL
    const emoji = r.isBest ? '⭐' : r.isFlame ? '🔥' : zone ? '📍' : doitac ? '🤝' : TIER_EMOJI[r.tier];
    const cls = 'hp' + (r.isBest ? ' hp-best' : r.isFlame ? ' hp-flame' : zone ? ' hp-data' : '');
    const fav = FAV.has(spotKey(r.sp)) ? '<i class="fav-badge">♥</i>' : '';
    /* KÝ HIỆU LOẠI XE ngay trên chấm bản đồ (anh Long yêu cầu 01/08): liếc bản đồ là biết
       điểm này thường cần Ô TÔ hay XE MÁY, khỏi phải mở từng cái ra xem. Chỉ gắn khi CÓ
       dữ liệu thật (cuốc đã ghi hoặc chuyến BUTL trong ảnh) — không có thì để trống. */
    const xe = xeCuaSpot(r.sp);
    const xeB = xe ? `<i class="xe-badge${xe.chinh === 'ca2' ? ' xe-ca2' : ''}">${XE_ICON[xe.chinh]}</i>` : '';
    // chấm to lên cho dễ nhìn ban đêm → khung icon phải to theo, không thì lệch khỏi đúng toạ độ
    const sz = r.isBest ? 48 : r.isFlame ? 38 : zone ? 36 : 32;
    const icon = L.divIcon({ className: '', html: `<div class="${cls}"><span>${r.open ? emoji : '⚫'}</span>${fav}${xeB}</div>`, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] });
    const mk = L.marker([r.sp.lat, r.sp.lng], { icon, zIndexOffset: r.isBest ? 1000 : r.isFlame ? 800 : zone ? 600 : doitac ? 400 : (r.open ? r.tier * 100 : -50) }).addTo(markerLayer);
    if (!r.open) mk.setOpacity(0.4);
    mk.on('click', () => openSpot(r));
  }
  if (targetLine) { map.removeLayer(targetLine); targetLine = null; }
  if (m.best) targetLine = L.polyline([[G.you.lat, G.you.lng], [m.best.sp.lat, m.best.sp.lng]], { color: '#5eead4', weight: 5, opacity: 1, dashArray: '8 9', lineCap: 'round' }).addTo(map);
  // CUNG ĐƯỜNG RÀ CUỐC — vệt cam nối các điểm mạnh nhất trong vùng phủ sóng
  // Vệt tối lót dưới + vệt cam sáng đè lên: tối chạy xe liếc một cái là thấy đường.
  if (m.route) {
    const pts = [[G.you.lat, G.you.lng], ...m.route.seq.map(r => [r.sp.lat, r.sp.lng])];
    L.polyline(pts, { color: '#0b1220', weight: 12, opacity: .6, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(heatLayer);
    L.polyline(pts, { color: '#fbbf24', weight: 7, opacity: .95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(heatLayer);
    m.route.seq.forEach((r, i) => {
      const ri = L.divIcon({ className: '', html: `<div class="hp hp-route"><span>${i + 1}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      L.marker([r.sp.lat, r.sp.lng], { icon: ri, zIndexOffset: 950 }).addTo(markerLayer).on('click', () => openSpot(r));
    });
  }
  if (m.wait) {
    L.circle([m.wait.center.lat, m.wait.center.lng], { radius: 750, color: '#0b1220', weight: 7, opacity: .5, fillOpacity: 0, interactive: false }).addTo(heatLayer);
    L.circle([m.wait.center.lat, m.wait.center.lng], { radius: 750, color: '#fcd34d', weight: 3.5, opacity: 1, fillColor: '#fbbf24', fillOpacity: .13, dashArray: '8 7', interactive: false }).addTo(heatLayer);
    const wi = L.divIcon({ className: '', html: '<div class="hp hp-wait"><span>🅿️</span></div>', iconSize: [40, 40], iconAnchor: [20, 20] });
    L.marker([m.wait.center.lat, m.wait.center.lng], { icon: wi, zIndexOffset: 900 }).addTo(markerLayer)
      .on('click', () => L.popup({ className: 'sp-popup', maxWidth: 250 }).setLatLng([m.wait.center.lat, m.wait.center.lng])
        .setContent(`<div class="sp-pop"><b>🅿️ Điểm chờ tối ưu</b><div class="sp-sub">Đứng giữa cụm quán</div><div class="sp-rows"><span>Quán trong 750m</span><b>${m.wait.cnt}</b><span>Chạy tới</span><b>${fmtMin(m.wait.eta)} · ${fmtDist(m.wait.distYou * ROAD_FACTOR)}</b></div><a class="sp-go" style="display:block;text-align:center;text-decoration:none" href="${gmapsDir(m.wait.center.lat, m.wait.center.lng)}" target="_blank" rel="noopener">🧭 Google Maps</a></div>`).openOn(map));
  }
}

/* ========================= THẺ ĐỀ XUẤT ========================= */
// Ngưỡng DÙNG CHUNG: giống hệt ngưỡng màu chấm (tier) và giống hệt kết luận NÊN ĐI/CÂN NHẮC/CHỜ
function chanceOf(p) { return p >= 0.5 ? ['CAO', 'hi'] : p >= 0.35 ? ['VỪA', 'mid'] : ['THẤP', 'lo']; }
function reasonsFor(r, golden) {
  const out = [];
  if (r.mins > 0 && r.mins <= 45) out.push(`🕛 Còn ${Math.round(r.mins)}′ nữa tan quán → tới ngay`);
  else if (r.mins <= 0 && r.mins > -20) out.push('🚪 Đang tan quán — khách ra về');
  if (r.sEta > 0.75) out.push(`Rất gần — ${fmtMin(r.eta)}`); else out.push(`${fmtMin(r.eta)} · ${fmtDist(r.dist)}`);
  if (r.mins > 45 && golden && r.sTrend > 0.55) out.push('Sắp giờ tan quán');
  else if (r.sTrend > 0.62) out.push('Khách say sắp tăng');
  if (r.sDemand > 0.7) out.push('Đông khách nhất khu vực');
  if (twinAffinity(r.sp.cat, r.hour, spotKey(r.sp)) > 0.62) out.push('Bạn hay nổ cuốc ở đây giờ này');
  if (r.emp && r.emp.n >= 2) out.unshift(`✅ Đã nổ ${r.emp.win}/${r.emp.n} cuốc thật ở đây`);   // bằng chứng thật lên đầu
  // "ĐI HAY CHỜ": trả lời bằng chính số lần anh ghi "quán đang đông" rồi có nổ cuốc thật hay không
  const cho = choTaiCho(spotKey(r.sp), r.hour);
  if (cho && cho.n >= 2) out.unshift(cho.no * 2 >= cho.n
    ? `⏳ ĐÁNG CHỜ: ${cho.no}/${cho.n} lần anh thấy quán đông ở khung này là có cuốc trong 90′`
    : `🚶 Nên đi tiếp: ${cho.n} lần thấy đông mà chỉ ${cho.no} lần nổ cuốc trong 90′`);
  const xe = xeCuaSpot(r.sp);
  if (xe) out.push(`${XE_ICON[xe.chinh]} Điểm này ${XE_CHU[xe.chinh]}${(xe.oto + xe.may) > 1 ? ` (${xe.oto > xe.may ? xe.oto : xe.may}/${xe.oto + xe.may} cuốc)` : ''}`);
  // bằng chứng theo KHUNG GIỜ lên trên cùng — đây là thứ tài xế cần nhất khi quyết định đứng đâu lúc này
  if (r.bl && r.bl.delta > 0.05) out.unshift(`🔺 ${BAND_VI[r.bl.band]} là cao điểm của quán này với bạn (${r.bl.win}/${r.bl.n})`);
  else if (r.bl && r.bl.delta < -0.05) out.push(`🔻 Khung này bạn hay hụt ở đây (${r.bl.win}/${r.bl.n})`);
  return out.slice(0, 3);
}
function waitStrip(m) {
  const w = m.wait; if (!w) return '';
  return `<div class="reco-wait">🅿️ <b>Điểm chờ tối ưu</b> — trong 750m có <b>${w.cnt} quán</b>, chạy tới ~${fmtMin(w.eta)}. Đứng giữa cụm, đỡ chạy vòng.
    <a class="wait-go" href="${gmapsDir(w.center.lat, w.center.lng)}" target="_blank" rel="noopener">🧭 Đứng ở đây</a></div>`;
}
function routeStrip(m) {
  const rt = m.route; if (!rt) return '';
  const names = rt.seq.map((r, i) => `<b>${i + 1}.</b> ${cleanName(r.sp)} <em>${r.hotScore}%</em>`).join(' → ');
  return `<div class="reco-route">🛣️ <b>Cung đường rà cuốc</b> — vòng ${fmtDist(rt.dist)} · ~${fmtMin(rt.mins)}, đi ngang <b>${rt.passN} quán đang mở</b>, điểm mạnh nhất trên đường <b>${Math.round(rt.topP * 100)}%</b>.
    <div class="rr-seq">${names}</div>
    <a class="wait-go" href="${routeUrl(rt)}" target="_blank" rel="noopener">🧭 Chạy cung đường này</a></div>`;
}
function chainStrip(m) {
  if (!G.chainFrom || !m.best) return '';
  const d = m.best.straight;
  if (d > 3000) return `<div class="reco-move">🔗 <b>Vừa trả khách ở ${G.chainFrom}.</b> Quanh đây chưa có điểm nhậu gần — cân nhắc quay lại vùng trung tâm.</div>`;
  return `<div class="reco-move">🔗 <b>Chuỗi cuốc:</b> ${m.best.sp.name} chỉ cách chỗ vừa trả khách ${fmtDist(d)} — bắt tiếp, đỡ chạy rỗng!</div>`;
}
// TRUNG THỰC TÊN QUÁN: chỉ data mình xác nhận (butl/mine) mới chắc tên; OSM chỉ là gợi ý CHƯA kiểm chứng → KHÔNG báo bừa
function nameNote(sp) {
  if (sp.source === 'mine') return '<div class="reco-zone">✅ <b>Điểm đón THẬT bạn đã lưu</b> — vị trí do bạn xác nhận tại chỗ.</div>';
  if (sp.source === 'butl') return `<div class="reco-zone">✅ <b>Điểm đón THẬT</b> — chép nguyên từ chuyến BUTL của bạn${sp.evi ? ' (' + sp.evi + ')' : ''}.
    ${sp.addr ? '🏠 ' + sp.addr : ''}${sp.prec ? ' · vị trí <b>' + sp.prec + '</b>' : ''}</div>`;
  if (sp.source === 'doitac') return `<div class="reco-zone">🤝 <b>Quán đối tác BUTL</b> — khách ở đây hay gọi lái hộ (bạn CHƯA có cuốc thật nào tại đây).
    ${sp.addr ? '🏠 ' + sp.addr : ''}${sp.prec ? ' · vị trí <b>' + sp.prec + '</b>' : ''}</div>`;
  if (sp.source === 'osm-addr') return `<div class="reco-zone">📍 <b>Chưa tra được tên quán ở đây</b> — app KHÔNG đoán tên, chỉ hiện địa chỉ thật lấy từ bản đồ${sp.addr ? ': <b>' + sp.addr + '</b>' : ''}. Tới nơi biết tên thì bấm 📝 ghi chú lại.</div>`;
  return `<div class="reco-zone">✅ <b>Tên quán đã đối chiếu bản đồ VietMap</b> (app tự kiểm lại mỗi ngày).${sp.addr ? ' 🏠 ' + sp.addr : ''} Tới nơi thấy đóng/sai thì bấm 🚫 để app bỏ.</div>`;
}
// VẤN ĐỀ 2: minh bạch NGƯỠNG & bức tranh khu vực — bao nhiêu quán mở, phân bố 🔴🟠🟡🟢/🔥, khi nào NÊN đi
function areaSummary(m) {
  const near = m.cover || [];
  const n = near.length; if (!n || !m.best) return '';
  const c = [0, 0, 0, 0]; near.forEach(x => c[x.tier]++);
  const fire = near.filter(x => x.isFlame).length;
  const p = Math.round(m.best.p * 100);
  const verdict = p >= 50 ? ['NÊN ĐI', 'good'] : p >= 35 ? ['CÂN NHẮC', ''] : ['NÊN CHỜ/NGHỈ', 'bad'];
  return `<div class="reco-area">🍺 <b>Vùng phủ sóng 5km:</b> ${n} quán mở · 🔴${c[3]} 🟠${c[2]} 🟡${c[1]} 🟢${c[0]}${fire ? ` · 🔥${fire}` : ''}
    <span class="area-verdict ${verdict[1]}">${verdict[0]} · ${p}%</span>
    <small>${p}% là điểm của <b>${cleanName(m.best.sp)}</b> — đúng con số hiện trong 🔍 Tìm kiếm và 📊 Điều phối.
    ≥50% NÊN ĐI · 35–50% cân nhắc · dưới 35% nên chờ giờ vàng.</small></div>`;
}
// VẤN ĐỀ 3: chiến lược cạnh tranh với tài BUTL khác (thật, không bịa số tài) — đón đầu & đứng cụm
function strategyTip(m) {
  const r = m.best; if (!r) return '';
  if (m.golden) {
    if (r.mins > 5 && r.mins <= 40) return `<div class="reco-strat">🎯 <b>Cao điểm — nhiều tài:</b> quán còn ~${Math.round(r.mins)}′ là tan. Tới ĐÓN ĐẦU ngay, đừng đợi tan mới tới (tài khác đã cắm sẵn).</div>`;
    return `<div class="reco-strat">🎯 <b>Cao điểm — nhiều tài:</b> ưu tiên quán SẮP tan để đón đầu; quán vừa tan thường bị tài khác cắm — né bớt, đảo qua điểm kế.</div>`;
  }
  if (m.wait && m.wait.cnt >= 3) return `<div class="reco-strat">🎯 <b>Giờ ít tài:</b> đứng 🅿️ giữa cụm ${m.wait.cnt} quán để phủ nhiều quán cùng lúc — BUTL phát cuốc tần số ngắn, gần là ăn.</div>`;
  return '';
}
// ƯỚC TÍNH số tài lái hộ đang chạy quanh đây (mô phỏng theo quy luật cung tài xế theo giờ × mật độ quán mở).
// KHÔNG phải số liệu live từ BUTL — chỉ để ước lượng mức cạnh tranh. Đỉnh cung tài ~22h30.
function driverEstimate(m) {
  if (!m.best) return 0;
  const near = m.raw.filter(x => x.open && x.dist <= 3000).length;
  const supply = Math.exp(-((hourDist(m.hour, 22.5) / 3.2) ** 2));
  return Math.max(0, Math.round(near * (0.22 + 0.6 * supply)));
}
function compChip(de) { return de <= 2 ? '🙂 Ít tài lái hộ cạnh tranh' : de >= 6 ? '⚔️ Đông tài — cạnh tranh cao' : '🚕 Cạnh tranh vừa'; }
function setRecoBig(v) { G.recoBig = v; document.body.classList.toggle('reco-mini', !v); if (G.metrics) renderReco(G.metrics); }
function setRecoOpen(v) { G.recoOpen = v; document.body.classList.toggle('reco-hidden', !v); }
function renderReco(m) {
  const box = $('#reco'); if (!box) return;
  if (G.pendingLog) return renderLogPrompt(G.pendingLog);
  const r = m.best;
  if (!G.online) { box.innerHTML = `<div class="reco-off">⏸️ Đang <b>nghỉ</b>.<button id="go-online" class="primary" style="margin-top:10px">▶ Bắt đầu nhận khách</button></div>`; const g = $('#go-online'); if (g) g.onclick = () => setOnline(true); return; }
  if (!r) { box.innerHTML = m.offHours ? '<div class="reco-off">🕒 <b>Chưa tới giờ lái hộ.</b><br><small>App đề xuất từ <b>14h</b> mỗi ngày (giờ có khách nhậu). Cứ nghỉ ngơi, tối mở lại.</small></div>' : '<div class="reco-off">🚪 <b>Quanh đây quán đã đóng cửa.</b><br><small>Thử kéo bản đồ sang khu khác, hoặc chờ tới giờ quán mở.</small></div>'; return; }
  const [ch, cls] = chanceOf(r.p);
  const p = r.hotScore;   // ĐÚNG con số hiện ở Tìm kiếm & Điều phối
  const de = driverEstimate(m);
  const weak = r.lambda < 0.6;
  const warn = weak ? `<div class="reco-warn">⚠️ Giờ này quanh bạn ít khách say — cân nhắc <b>chờ tới giờ vàng (22:30–01:00) hoặc nghỉ</b>.</div>` : '';
  const gold = m.golden ? `<div class="reco-gold">🍺 <b>GIỜ VÀNG</b> — khách bắt đầu tan quán, cầu lái hộ cao nhất đêm.</div>` : '';
  box.innerHTML = `
    <div class="reco-bar"><button id="reco-min" class="reco-mini-btn">${G.recoBig ? '▾ Thu gọn' : '▴ Xem thêm'}</button><button id="reco-x" class="reco-mini-btn">✕ Ẩn</button></div>
    ${gold}${areaSummary(m)}${strategyTip(m)}${routeStrip(m)}${waitStrip(m)}${chainStrip(m)}${warn}
    <div class="reco-head">
      <div class="reco-star">⭐</div>
      <div class="reco-t"><b>${(() => { const x = xeCuaSpot(r.sp); return x ? XE_ICON[x.chinh] + ' ' : ''; })()}${cleanName(r.sp)}</b><small>${r.sp.addr ? '🏠 ' + r.sp.addr : TIER_EMOJI[r.tier] + ' ' + CAT_VI[r.sp.cat]}${r.sp.ghiChu ? ' · ' + r.sp.ghiChu : ''}</small></div>
      <div class="reco-p"><span class="reco-pv ${cls}">${p}%</span><small>khả năng có khách</small></div>
    </div>
    ${nameNote(r.sp)}
    <div class="reco-grid">
      <div class="rm"><b>${dEta(r)}</b><span>Tới nơi (đường thật)</span></div>
      <div class="rm"><b>${dDist(r)}</b><span>Quãng đường</span></div>
      <div class="rm"><b>~${fmtMin(r.expWait)}</b><span>Chờ tại điểm</span></div>
      <div class="rm"><b>${de}</b><span>Tài xế quanh · ước tính</span></div>
      <div class="rm"><b>${fmtClose(r.sp.closeH)}</b><span>Quán tan</span></div>
      <div class="rm ${cls === 'hi' ? 'good' : cls === 'lo' ? 'bad' : ''}"><b>${ch}</b><span>Khả năng ±${r.margin}%</span></div>
    </div>
    <div class="reco-reasons">${[...reasonsFor(r, m.golden), compChip(de)].map(x => `<span class="chip">${x}</span>`).join('')}</div>
    <div class="reco-actions">
      <button id="reco-go" class="primary">🚗 Tới điểm đứng chờ</button>
      <a id="reco-nav" class="ghostbtn" href="${navUrl(r.sp)}" target="_blank" rel="noopener">🧭 Google Maps</a>
      <button id="reco-skip" class="ghostbtn">Bỏ qua</button>
    </div>`;
  const g1 = $('#reco-go'); if (g1) g1.onclick = () => goTo(r);
  const g2 = $('#reco-skip'); if (g2) g2.onclick = () => { SKIPPED.add(r.sp.id); G.lastBestId = null; G.session.suggested++; recompute(); const nb = G.metrics && G.metrics.best; toast(nb && nb.sp.id !== r.sp.id ? '↪️ Đã đổi: ' + cleanName(nb.sp) : 'Đã xem hết điểm gần — quay lại từ đầu.'); };
  const mn = $('#reco-min'); if (mn) mn.onclick = () => setRecoBig(!G.recoBig);
  const xx = $('#reco-x'); if (xx) xx.onclick = () => setRecoOpen(false);
}

/* ========================= ĐI & GHI CUỐC THẬT ========================= */
function goTo(r) {
  G.session.suggested++; G.session.accepted++;
  G.pendingLog = r; G.chainFrom = null;
  setYou(r.sp.lat + (Math.random() - .5) * .003, r.sp.lng + (Math.random() - .5) * .003, true);
  toast(`🚗 Tới ${r.sp.name}. Có/chưa có khách thì bấm ghi kết quả nhé.`);
  recompute();
}
/* ═══ GHI NHẬN "QUÁN ĐANG ĐÔNG KHÁCH" — chưa có cuốc nhưng thấy khách đang nhậu ═══
   (anh Long: "tài xế thấy có khách và dự đoán có thể có cuốc thì cho nhập để radar hiểu
   giờ quán thường nổ, để quyết định ĐI hay CHỜ").
   Cố ý KHÔNG tính vào tỉ lệ nổ cuốc — đây là quan sát, không phải kết quả. */
function logDong(r) {
  const key = spotKey(r.sp);
  obsLearn(key, r.hour); saveTwin();
  saveJob({ ts: Date.now(), spotId: r.sp.id, name: r.sp.name, cat: r.sp.cat, quan: r.sp.quan,
    hour: r.hour, band: r.band || bandOf(r.hour), key, type: 'dong', win: false });
  if (r.sp.source === 'mine' && r.sp.pid) creditPick(r.sp.pid, false, null, null, '', true);
  const c = choTaiCho(key, r.hour);
  G.jobsN = loadJobs().length;
  recompute(); syncPicks(false);
  const ten = cleanName(r.sp).slice(0, 26);
  if (c && c.n >= 2) toast(`👀 Đã ghi: ${ten} đang đông. Khung ${BAND_VI[c.band]}: anh ghi đông ${c.n} lần → ${c.no} lần nổ cuốc trong 90 phút. ${c.no * 2 >= c.n ? 'ĐÁNG CHỜ.' : 'Ít nổ — cân nhắc đi điểm khác.'}`, 6200);
  else toast(`👀 Đã ghi: ${ten} đang đông khách lúc ${fmtClose(r.hour)}. Ghi thêm vài lần nữa app sẽ nói được nên chờ hay nên đi.`, 5200);
}

/* Báo NGAY cho tài xế biết cú bấm ✅/❌ vừa rồi dạy được app điều gì —
   không có dòng này thì tài xế bấm mà không thấy app khá lên, bấm vài hôm là bỏ. */
function learnToast(r, win) {
  const key = spotKey(r.sp), b = bandOf(r.hour), o = TWIN.sb[key + '|' + b];
  const name = cleanName(r.sp).slice(0, 26);
  if (!o) return;
  const rate = Math.round(o.win / o.n * 100);
  const cmp = bandLift(key, r.hour);
  let tail = '';
  if (cmp && Math.abs(cmp.pHere - cmp.pAll) > 0.12)
    tail = cmp.pHere > cmp.pAll ? ' → app sẽ ĐẨY quán này lên đúng khung giờ này.' : ' → app sẽ HẠ quán này ở khung giờ này.';
  else if (o.n < 3) tail = ' → thêm 1–2 cuốc nữa ở khung này là app chốt được quy luật.';
  toast(`🧠 Đã học: ${name} · ${BAND_VI[b]} → ${o.win}/${o.n} cuốc (${rate}%).${tail}`, 5200);
}
// Ghi 1 cuốc THẬT → Digital Twin + mô hình học ngay (đây là nguồn học DUY NHẤT)
function logJob(r, win, xe) {
  const capLat = G.you.lat, capLng = G.you.lng;   // vị trí THẬT lúc bấm (dùng cho Vấn đề 4)
  twinLearn(r.sp.cat, r.hour, win, spotKey(r.sp), xe); saveTwin();
  const [bm, bb] = observe(r, win ? 1 : 0); updateSkill([bm], [bb]); shiftWeights();
  saveBrain();   // ghi xuống máy NGAY — hôm sau mở app là não vẫn còn, không học lại từ đầu
  // Ghi kèm % app ĐÃ DỰ BÁO trước khi biết kết quả → sau này đối chiếu được dự báo vs thực tế
  saveJob({ ts: Date.now(), spotId: r.sp.id, name: r.sp.name, cat: r.sp.cat, quan: r.sp.quan, hour: r.hour, band: r.band || bandOf(r.hour), p: +r.p.toFixed(3), key: spotKey(r.sp), win, xe: xe || '' });
  G.jobsN = loadJobs().length;
  G.pendingLog = null;
  // BẰNG CHỨNG cho điểm tự nạp: cộng vào ĐÚNG điểm đó (theo id, không theo tên) → đổi tên hay
  // nắn toạ độ vẫn giữ nguyên thành tích. Thắng thì kéo toạ độ về chỗ GPS thật luôn.
  if (r.sp.source === 'mine' && r.sp.pid) creditPick(r.sp.pid, win, (G.hasGps && G.youFromGps) ? capLat : null, capLng, xe);
  if (win) {
    G.session.rides++;
    // VẤN ĐỀ 4: nhận khách xong chạy liền, khỏi gõ tay → app TỰ tạo 1 chấm theo GPS thật (nếu chưa có điểm nào <150m)
    // ĐÃ SỬA: trước đây mỗi cuốc thắng lại đẻ thêm một chấm "★ Nổ cuốc (GPS)" mới, chạy 20 cuốc
    // ra 20 chấm rác chồng nhau. Giờ trong 55m thì GỘP vào điểm cũ và nắn toạ độ cho chuẩn hơn.
    let captured = false;
    if (G.hasGps && G.youFromGps) {   // chỉ tin toạ độ do GPS thật đo, không tin chấm app tự dời
      const near = nearPick(MY_PICKS, capLat, capLng);
      if (near) { refinePick(near, capLat, capLng); savePicks(); }
      else if (!SPOTS.some(s => haversine({ lat: capLat, lng: capLng }, s) <= 150)) {
        upsertPick('★ Nổ cuốc (GPS)', capLat, capLng, r.sp.cat || 'phonhau', r.sp.quan || 'Tôi thêm');
        buildSpots(); captured = true;
      }
    }
    const brg = Math.random() * 2 * Math.PI, dkm = r.sp.homeKm || 6;   // r.homeKm không tồn tại — quãng đường về nhà nằm ở r.sp.homeKm
    const dLat = (dkm / 111) * Math.cos(brg), dLng = (dkm / (111 * Math.cos(toRad(r.sp.lat)))) * Math.sin(brg);
    G.chainFrom = r.sp.name;
    setYou(r.sp.lat + dLat, r.sp.lng + dLng, true);
    if (captured) toast('✅ Đã ghi CÓ KHÁCH + tự lưu điểm GPS 📍');
  }
  recompute();
  syncPicks(true);      // đẩy bằng chứng vừa ghi sang máy kia ngay
  learnToast(r, win);   // để CUỐI: đây là thông báo tài xế cần thấy nhất — app vừa học được gì
}
function renderLogPrompt(r) {
  const box = $('#reco'); if (!box) return;
  const closeTxt = (r.mins > 0 && r.mins <= 60) ? ` · quán tan ~${fmtClose(r.sp.closeH)} (còn ${Math.round(r.mins)}′)` : '';
  box.innerHTML = `
    <div class="reco-head"><div class="reco-star">📝</div>
      <div class="reco-t"><b>Đang chờ tại ${r.sp.name}</b><small>${CAT_VI[r.sp.cat]}${closeTxt}</small></div></div>
    <p class="sheet-hint" style="margin:6px 0 10px">Bạn có bắt được khách ở đây không? (ghi thật để AI học đúng gu của bạn)</p>
    <div class="reco-actions">
      <button id="log-oto" class="primary">✅ Có khách · 🚗 Ô tô</button>
      <button id="log-may" class="primary">✅ Có khách · 🏍️ Xe máy</button>
    </div>
    <div class="reco-actions" style="margin-top:6px">
      <button id="log-busy" class="ghostbtn">👀 Quán đang đông (chưa có cuốc)</button>
      <button id="log-no" class="ghostbtn">❌ Chưa có</button>
    </div>`;
  const yo = $('#log-oto'); if (yo) yo.onclick = () => logJob(r, true, 'oto');
  const ym = $('#log-may'); if (ym) ym.onclick = () => logJob(r, true, 'may');
  const yb = $('#log-busy'); if (yb) yb.onclick = () => logDong(r);
  const n = $('#log-no'); if (n) n.onclick = () => logJob(r, false);
}

/* ========================= POPUP 1 ĐIỂM ========================= */
function openSpot(r) {
  const [ch] = chanceOf(r.p);
  const html = `<div class="sp-pop">
    <b>${r.isBest ? '⭐ ' : r.isFlame ? '🔥 ' : TIER_EMOJI[r.tier] + ' '}${cleanName(r.sp)}</b>
    <div class="sp-sub">${CAT_VI[r.sp.cat]} · ${r.sp.quan || ''}${r.open ? '' : ` · <span style="color:#fca5a5">${r.sp.cat === 'diemdon' ? 'ngoài khung giờ hay có khách' : 'đang đóng cửa'}</span>`}</div>
    ${r.sp.addr && !r.sp.name.includes(r.sp.addr) ? `<div class="sp-note">🏠 <b>Địa chỉ:</b> ${r.sp.addr}${r.sp.prec && !NGUON_TEN[r.sp.prec] ? ` <span style="color:${r.sp.prec === 'chuẩn' ? '#5eead4' : '#fcd34d'}">· vị trí ${r.sp.prec}</span>` : ''}</div>` : ''}
    ${r.sp.ghiChu ? `<div class="sp-note" style="color:#cbd5e1">${r.sp.ghiChu}</div>` : ''}
    ${r.sp.sao ? `<div class="sp-note">⭐ <b>${String(r.sp.sao).replace('.', ',')}</b>/5 trên Google${r.sp.luot ? ` · ${r.sp.luot.toLocaleString('vi-VN')} lượt đánh giá` : ''}</div>` : ''}
    ${r.sp.source === 'butl' ? `<div class="sp-butl">✅ Điểm đón THẬT — bạn đã nổ cuốc ở đây${r.sp.evi ? ' (' + r.sp.evi + ')' : ''}</div>` : ''}
    ${r.sp.source === 'doitac' ? '<div class="sp-note" style="color:#93c5fd">🤝 <b>Quán đối tác BUTL</b> — khách quán này hay gọi lái hộ. Chưa có cuốc thật nào của bạn ở đây.</div>' : ''}
    ${r.sp.source === 'mine' ? (() => {
      const p = myPick(r.sp.pid); const s = p ? pickStatus(p) : null;
      return `<div class="sp-butl">✅ Điểm đón bạn TỰ THÊM <button onclick="__delMyPick('${r.sp.pid}')" style="float:right;background:transparent;color:#fca5a5;border:0;cursor:pointer;font-weight:600">🗑 Xoá</button></div>`
        + (s ? `<div class="pk-badge ${s.cls}"><b>${s.vi}</b><span>${s.n ? `${s.w}/${s.n} cuốc thật · ${Math.round(s.rate * 100)}%` : 'chưa có cuốc nào'} — ${s.note}</span>${p.fix ? `<span>📍 toạ độ đã tự nắn ${p.fix} lần theo GPS thật</span>` : ''}</div>` : '');
    })() : ''}
    ${(r.sp.source || 'osm') === 'osm' ? `<div class="sp-note" style="color:#5eead4">✅ Tên đã đối chiếu ${NGUON_TEN[r.sp.prec] || 'bản đồ'} — app tự kiểm lại mỗi ngày.</div>` : ''}
    ${r.sp.source === 'osm-addr' ? '<div class="sp-note" style="color:#fcd34d">📍 Bản đồ không tra ra tên quán ở đây nên app <b>không hiện tên</b> — chỉ hiện địa chỉ thật ở trên. Biết tên rồi thì bấm 📝 Ghi chú.</div>' : ''}
    <div class="sp-rows">
      <span>Khả năng nổ cuốc</span><b>${r.hotScore}% · ${ch} ±${r.margin}%</b>
      <span>Khách cần lái hộ</span><b>${TIER_EMOJI[r.tier]} ${['Thấp','Vừa','Cao','Rất cao'][r.tier]}</b>
      ${r.emp && r.emp.n ? `<span>Cuốc thật ở đây</span><b>✅ ${r.emp.win}/${r.emp.n} (${Math.round(r.emp.rate * 100)}%)</b>` : ''}
      ${(() => { const bb = bestBandOf(spotKey(r.sp)); return bb ? `<span>Khung giờ mát tay</span><b>${bb.ico} ${bb.vi} · ${bb.win}/${bb.n}</b>` : ''; })()}
      ${(() => {
        const x = xeCuaSpot(r.sp); if (!x) return '';
        const tong = x.oto + x.may, nhieu = Math.max(x.oto, x.may);
        const t = x.chinh === 'ca2' ? `🚗 ${x.oto} · 🏍️ ${x.may}` : `${XE_ICON[x.chinh]} ${x.chinh === 'oto' ? 'Ô TÔ' : 'XE MÁY'}${tong > 1 ? ` (${nhieu}/${tong} cuốc)` : ''}`;
        return `<span>Điểm này cần xe</span><b>${t}</b>`;
      })()}
      ${(() => { const c = choTaiCho(spotKey(r.sp), r.hour); return c ? `<span>Anh ghi “đang đông” ${BAND_VI[c.band]}</span><b>${c.n} lần → ${c.no} lần nổ cuốc trong 90′</b>` : ''; })()}
      ${r.bl ? `<span>${BAND_VI[r.bl.band]} ở đây</span><b>${r.bl.delta > 0.03 ? '🔺 cao điểm của quán này' : r.bl.delta < -0.03 ? '🔻 thấp điểm' : '➖ bình thường'} (${r.bl.win}/${r.bl.n})</b>` : ''}
      <span>Tới nơi</span><b>${fmtMin(r.eta)} · ${fmtDist(r.dist)}</b>
      ${r.sp.cat === 'diemdon' ? '' : `<span>Quán tan ${r.sp.gioThat ? '' : '~'}</span><b>${fmtClose(r.sp.closeH)}${r.mins > 0 && r.mins <= 90 ? ` · còn ${Math.round(r.mins)}′` : ''}${r.sp.gioThat ? ' <span style="color:#5eead4">giờ thật</span>' : ' <span style="color:#94a3b8">ước tính</span>'}</b>`}
    </div>
    ${NOTES[spotKey(r.sp)] ? `<div class="sp-note">📝 ${NOTES[spotKey(r.sp)]}</div>` : ''}
    <div class="sp-fav"><button onclick="__toggleFav('${r.sp.id}')" class="sp-fbtn">${FAV.has(spotKey(r.sp)) ? '♥ Đã thích' : '♡ Yêu thích'}</button><button onclick="__fixSpot('${r.sp.id}')" class="sp-fbtn">📍 Sửa vị trí</button><button onclick="__editNote('${r.sp.id}')" class="sp-fbtn">📝 Ghi chú</button><button onclick="__hideSpot('${r.sp.id}')" class="sp-fbtn" style="color:#fca5a5">🚫 Đã đóng/sai</button></div>
    <button onclick="__goSpot('${r.sp.id}')" class="sp-go">🚗 Tới điểm đứng chờ</button>
    <a class="sp-go" style="display:block;margin-top:6px;text-align:center;text-decoration:none;background:var(--panel2);color:var(--txt)" href="${navUrl(r.sp)}" target="_blank" rel="noopener">🧭 Dẫn tới (Google Maps)</a>
  </div>`;
  L.popup({ className: 'sp-popup', maxWidth: 265 }).setLatLng([r.sp.lat, r.sp.lng]).setContent(html).openOn(map);
}
const findR = id => (G.metrics && G.metrics.raw || []).find(x => x.sp.id === id);
window.__goSpot = id => { const r = findR(id); if (r) { map.closePopup(); goTo(r); } };
window.__toggleFav = id => { const r = findR(id); if (!r) return; const k = spotKey(r.sp); FAV.has(k) ? FAV.delete(k) : FAV.add(k); saveFav(); if (G.metrics) drawMap(G.metrics); openSpot(r); toast(FAV.has(k) ? '♥ Đã lưu Yêu thích.' : 'Đã bỏ yêu thích.'); };
window.__editNote = id => { const r = findR(id); if (!r) return; const k = spotKey(r.sp); const t = window.prompt('📝 Ghi chú (giờ đông, bảo vệ, chỗ đỗ xe…):', NOTES[k] || ''); if (t == null) return; if (t.trim()) NOTES[k] = t.trim(); else delete NOTES[k]; saveNotes(); openSpot(r); toast('Đã lưu ghi chú.'); };
window.__flyTo = id => { const r = findR(id); if (!r) return; closeSheets(); map.setView([r.sp.lat, r.sp.lng], 16); openSpot(r); };
window.__hideSpot = id => { const r = findR(id); if (!r) return; hideSpotKey(spotKey(r.sp)); G.lastBestId = null; map.closePopup(); recompute(); syncPicks(true); toast('🚫 Đã ẩn điểm này (báo đóng cửa/sai) — không đề xuất nữa, máy kia cũng ẩn theo. Bỏ ẩn ở ⚙️.', 4400); };
function addMyPick(name, lat, lng, cat) {
  const { p, gop } = upsertPick(name, lat, lng, cat);
  buildSpots(); G.lastBestId = null; SKIPPED.clear(); recompute(); syncPicks(true);
  const ev = p.n ? ` (đã có ${p.win}/${p.n} cuốc thật ở đây)` : '';
  toast(gop ? `🔗 Chỗ này đã có điểm rồi — app GỘP vào “${p.name}”${ev}, không tạo chấm trùng.`
            : '✅ Đã lưu điểm đón — app sẽ ưu tiên đứng ở đây & học từ đây.', 4200);
}
// Nạp thủ công: tài xế đang ĐỨNG NGAY quán → thêm chính vị trí mình vào não app (chân thực, tự đối soát)
/* ═══ "TÔI ĐANG Ở QUÁN" — GÕ TÊN, APP GỢI Ý TỪ CHÍNH DỮ LIỆU RADAR ═══
   (anh Long 01/08: "gõ tên quán A1 thì link ra đúng quán A1 đã có, cho đỡ nhập trùng và
   thu được đúng địa điểm + giờ").
   Trước đây bấm ➕ là hiện 2 hộp prompt trắng trơn: gõ tay tên quán → mỗi lần gõ một kiểu
   ("Ốc Quyên", "oc quyen", "Quán Ốc Quyên") → sinh 3 chấm khác nhau cho CÙNG một quán,
   thành ra không quán nào đủ số cuốc để app kết luận được gì. */
const boDau = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
function goiYQuan(q) {
  const k = boDau(q);
  const ds = SPOTS.map(sp => {
    const d = haversine(G.you, sp);
    let diem = 0;
    if (k) {
      const t = boDau(sp.name), a = boDau(sp.addr);
      if (t.startsWith(k)) diem = 100; else if (t.includes(k)) diem = 70; else if (a.includes(k)) diem = 40;
      else { const tu = k.split(' ').filter(Boolean); const hit = tu.filter(w => t.includes(w)).length; diem = tu.length && hit === tu.length ? 55 : 0; }
      if (!diem) return null;
    }
    // Ưu tiên quán GẦN CHỖ ĐANG ĐỨNG: đang đứng ở quán thì nó phải nằm trong vài trăm mét
    diem += d < 150 ? 60 : d < 400 ? 40 : d < 1500 ? 20 : d < 5000 ? 8 : 0;
    if (sp.source === 'mine') diem += 25;          // điểm chính anh tự nạp → ưu tiên nhất
    if (sp.source === 'butl') diem += 15;
    return { sp, d, diem };
  }).filter(Boolean);
  ds.sort((a, b) => b.diem - a.diem || a.d - b.d);
  return ds.slice(0, 12);
}
function renderHere() {
  const el = $('#here-body'); if (!el) return;
  const q = (($('#here-search') && $('#here-search').value) || '').trim();
  const ds = goiYQuan(q);
  const dong = ds.map(x => `<div class="fl" onclick="__toiDangO('${x.sp.id}')">
      <span class="fl-h" style="background:rgba(45,212,191,.18);color:#5eead4">${x.sp.source === 'mine' ? '📌' : x.sp.source === 'butl' ? '📍' : x.sp.source === 'doitac' ? '🤝' : '🍺'}</span>
      <div class="fl-m"><b>${x.sp.name}</b><small>${x.sp.addr ? x.sp.addr + ' · ' : ''}${x.sp.quan || ''} · cách ${fmtDist(x.d)}</small></div>
      <span class="fl-go">›</span></div>`).join('');
  el.innerHTML = (dong || '<p class="sheet-hint">Không thấy quán nào khớp.</p>') +
    `<div class="fl" onclick="__themQuanMoi()" style="border-bottom:0;margin-top:6px">
       <span class="fl-h" style="background:rgba(249,115,22,.2);color:#fdba74">➕</span>
       <div class="fl-m"><b>Thêm quán mới${q ? ` “${q}”` : ''}</b><small>Lưu ngay tại chỗ anh đang đứng (GPS)</small></div>
       <span class="fl-go">›</span></div>`;
}
window.__toiDangO = id => {
  const sp = SPOTS.find(s => s.id === id); if (!sp) return;
  const r = (G.metrics && G.metrics.raw || []).find(x => x.sp.id === id);
  closeSheets();
  map.setView([sp.lat, sp.lng], Math.max(16, map.getZoom()));
  if (r) { G.pendingLog = r; setSimple(false); recompute(); openSpot(r); }
  toast(`✅ Đang ở “${cleanName(sp)}” lúc ${fmtClose(realHour())}. Có khách thì bấm ✅ (chọn ô tô/xe máy), đông mà chưa có cuốc thì bấm 👀.`, 6000);
};
window.__themQuanMoi = () => {
  const q = (($('#here-search') && $('#here-search').value) || '').trim();
  const nm = q || window.prompt('Tên quán anh đang đứng:', '');
  if (!nm || !nm.trim()) return;
  const cats = ['phonhau', 'beerclub', 'bar', 'karaoke', 'nhahang'];
  const pick = window.prompt('Loại quán? Gõ số:\n1. Quán nhậu\n2. Bia/Beer club\n3. Bar/Pub\n4. Karaoke\n5. Nhà hàng', '1');
  if (pick == null) return;
  const n = parseInt(pick, 10);
  addMyPick(nm.trim(), G.you.lat, G.you.lng, cats[(n >= 1 && n <= 5) ? n - 1 : 0]);
  closeSheets();
  map.setView([G.you.lat, G.you.lng], Math.max(16, map.getZoom()));
};
function quickAddHere() {
  openSheet('#here-sheet');
  const inp = $('#here-search'); if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 120); }
  renderHere();
}
/* Xoá = đánh dấu "bia mộ" kèm mốc thời gian rồi đẩy lên máy chủ, KHÔNG xoá trắng tại chỗ.
   Xoá trắng thì lần đồng bộ sau máy kia lại đẩy điểm đó về — xoá xong nó sống lại. */
window.__delMyPick = id => {
  const p = ownPick(id) || myPick(id); if (!p) return;
  const s = pickStatus(p);
  if (p.n >= 3 && !window.confirm(`“${p.name}” đã ghi ${p.win}/${p.n} cuốc thật. Xoá là mất luôn bằng chứng này. Vẫn xoá?`)) return;
  const own = ownPick(id);
  if (own) { own.del = 1; own.ts = Date.now(); } else MY_PICKS.push({ ...p, del: 1, ts: Date.now(), n: 0, win: 0 });
  savePicks(); buildSpots(); map.closePopup(); recompute(); syncPicks(true);
  toast('🗑 Đã xoá điểm đón' + (s.n ? ` (${s.w}/${s.n} cuốc)` : '') + ' — máy kia cũng sẽ xoá theo.', 4000);
};
// VẤN ĐỀ 1: toạ độ dữ liệu chỉ gần đúng → tài xế đứng đúng chỗ, bấm "Sửa vị trí" để DỜI điểm về GPS thật (ẩn điểm cũ sai)
window.__fixSpot = id => {
  const r = findR(id); if (!r) return;
  if (!G.hasGps) { toast('Bật GPS (📍) & đứng đúng ngay quán, rồi bấm lại để sửa vị trí cho chuẩn.', 4200); return; }
  // Sửa CHÍNH điểm tự nạp thì nắn toạ độ luôn, khỏi đẻ thêm chấm mới rồi ẩn chấm cũ
  if (r.sp.source === 'mine' && r.sp.pid) {
    const own = ownPick(r.sp.pid);
    if (own) { own.lat = +G.you.lat.toFixed(5); own.lng = +G.you.lng.toFixed(5); own.fix = (own.fix || 0) + 1; own.ts = Date.now(); savePicks(); }
  } else {
    hideSpotKey(spotKey(r.sp));
    upsertPick(cleanName(r.sp), G.you.lat, G.you.lng, r.sp.cat, r.sp.quan || '');
  }
  buildSpots(); G.lastBestId = null; SKIPPED.clear(); map.closePopup(); recompute(); syncPicks(true);
  toast('📍 Đã dời điểm về đúng chỗ bạn đang đứng (GPS). App sẽ dẫn tới toạ độ này.', 4200);
};

/* ========================= CHẾ ĐỘ ĐƠN GIẢN (mặc định) ========================= */
function renderSimple(m) {
  const box = $('#simple'); if (!box) return;
  if (!G.simpleMode) { box.hidden = true; return; }
  box.hidden = false;
  // đổi điểm đề xuất thì thu bảng chọn xe lại, khỏi lỡ tay ghi cuốc cho quán khác
  const bl = $('#sp-log'), bx = $('#sp-xe'); if (bl) bl.hidden = false; if (bx) bx.hidden = true;
  const on = $('#sp-online'); if (on) { on.textContent = G.online ? '🟢 Nhận khách' : '⏸️ Đang nghỉ'; on.classList.toggle('off', !G.online); }
  const nm = $('#sp-name'), mt = $('#sp-meta'), ch = $('#sp-chance'), nv = $('#sp-nav'), wn = $('#sp-warn');
  const r = m && m.best;
  if (!G.online || !r) {
    if (nm) nm.textContent = !G.online ? 'Đang nghỉ' : m.offHours ? 'Chưa tới giờ lái hộ' : 'Quán quanh đây đã đóng';
    if (mt) mt.textContent = !G.online ? '' : m.offHours ? 'App đề xuất từ 14h mỗi ngày' : 'Thử kéo bản đồ sang khu khác';
    if (ch) { ch.textContent = ''; ch.className = 'sp-chance'; }
    if (wn) wn.textContent = ''; if (nv) nv.removeAttribute('href');
    return;
  }
  /* TÊN QUÁN to nhất · ĐỊA CHỈ nhỏ ngay dưới · khoảng cách + bằng chứng ở dòng kế.
     Trước đây nhét địa chỉ chung vào dòng khoảng cách nên bác tài đọc rối, mà cái cần
     thấy đầu tiên (tên quán) thì lại lẫn với cái phụ. */
  const xe = xeCuaSpot(r.sp);
  if (nm) nm.textContent = (xe ? XE_ICON[xe.chinh] + ' ' : '') + cleanName(r.sp);
  const ad = $('#sp-addr');
  if (ad) ad.textContent = [r.sp.addr, r.sp.ghiChu].filter(Boolean).join(' · ');
  if (mt) mt.textContent = 'cách ' + dDist(r) + ' — ' + dEta(r) + (r.sp.source === 'butl' ? ' · ✅ đã nổ cuốc' : '');
  const [txt, cls] = chanceOf(r.p);
  if (ch) { ch.textContent = `Khả năng có khách: ${txt} · ${r.hotScore}%`; ch.className = 'sp-chance ' + cls; }
  if (nv) nv.href = navUrl(r.sp);
  if (wn) wn.textContent = m.golden ? '🍺 Giờ vàng — khách say cần về, tới ngay!' : (r.mins > 0 && r.mins <= 45 ? `🕛 Còn ${Math.round(r.mins)} phút nữa quán tan` : '');
}
function setSimple(v) {
  G.simpleMode = v; try { localStorage.setItem('roadai_laiho_simple', v ? '1' : '0'); } catch (e) {}
  const box = $('#simple'); if (box) box.hidden = !v;
  if (v && G.metrics) renderSimple(G.metrics);
}

/* ========================= TÌM & LỌC ========================= */
const CAT_LIST = [['all', 'Tất cả'], ['diemdon', '📍 Điểm đón thật'], ['phonhau', 'Quán nhậu'], ['beerclub', 'Beer club'], ['bar', 'Bar/Pub'], ['karaoke', 'Karaoke'], ['nhahang', 'Nhà hàng'], ['tieccuoi', 'Tiệc cưới'], ['sanbong', 'Bóng đá']];
function renderFind(m) {
  const el = $('#find-body'); if (!el || !m || $('#find-sheet').hidden) return;
  const q = (($('#find-search') && $('#find-search').value) || '').trim().toLowerCase();
  const favList = m.raw.filter(r => FAV.has(spotKey(r.sp)));
  const row = r => `<div class="fl" onclick="__flyTo('${r.sp.id}')">
      <span class="fl-h" style="background:${TIER_COLOR[r.tier]}22;color:${TIER_COLOR[r.tier]}">${r.hotScore}<i>%</i></span>
      <div class="fl-m"><b>${(() => { const x = xeCuaSpot(r.sp); return x ? XE_ICON[x.chinh] + ' ' : ''; })()}${r.sp.source === 'butl' ? '✅ ' : r.sp.source === 'doitac' ? '🤝 ' : ''}${FAV.has(spotKey(r.sp)) ? '♥ ' : ''}${r.sp.name}</b><small>${r.sp.addr ? r.sp.addr + ' · ' : CAT_VI[r.sp.cat] + ' · '}${r.sp.quan || ''} · ${fmtMin(r.eta)} · ${fmtDist(r.dist)}${r.dist > COVER_R ? ' · ngoài 5km' : ''}</small></div>
      <span class="fl-go">›</span></div>`;
  const list = q ? m.raw.filter(r => (r.sp.name + ' ' + (r.sp.quan || '')).toLowerCase().includes(q)).sort((a, b) => b.p - a.p).slice(0, 30) : m.byHot.slice(0, 20);
  el.innerHTML = `
    <div class="chips">${CAT_LIST.map(([k, v]) => `<button class="fchip${G.filter === k ? ' on' : ''}" data-cat="${k}">${v}</button>`).join('')}</div>
    ${!q && favList.length ? `<h4 class="fh">♥ Yêu thích</h4>${favList.slice(0, 8).map(row).join('')}` : ''}
    <h4 class="fh">${q ? 'Kết quả tìm' : '🔥 Top 20 điểm đáng đến (trong 5km)'}</h4>
    ${list.length ? list.map(row).join('') : '<p class="sheet-hint">Không tìm thấy.</p>'}
    <p class="sheet-hint">Số % ở đây là <b>cùng một con số</b> với thẻ ⭐ đề xuất và 📊 điều phối: khả năng bạn nổ được 1 cuốc nếu đứng ở đó 15 phút tới.</p>`;
  $$('#find-body .fchip').forEach(b => b.onclick = () => { G.filter = b.dataset.cat; recompute(); renderFind(G.metrics); });
}

/* ========================= TRUNG TÂM ĐIỀU PHỐI ========================= */
function spark(vals, w = 160, h = 40, color = '#2dd4bf') {
  if (vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), rng = hi - lo || 1;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><polyline points="${vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - (v - lo) / rng * h).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
}
function jobStats() {
  const jobs = loadJobs(); if (!jobs.length) return null;
  const byQuan = {}, byHour = {};
  for (const j of jobs) {
    const q = j.quan || '—';
    (byQuan[q] = byQuan[q] || { n: 0, win: 0 }).n++; if (j.win) byQuan[q].win++;
    const hb = (j.hour >= 21 || j.hour < 2) ? 'Giờ vàng (21–02h)' : j.hour >= 18 ? 'Tối (18–21h)' : (j.hour >= 2 && j.hour < 6) ? 'Khuya (02–06h)' : 'Ngoài giờ';
    (byHour[hb] = byHour[hb] || { n: 0, win: 0 }).n++; if (j.win) byHour[hb].win++;
  }
  const rank = o => Object.entries(o).map(([k, v]) => ({ k, r: v.win / v.n, n: v.n })).sort((a, b) => b.r - a.r || b.n - a.n);
  const wins = jobs.filter(j => j.win).length;
  // ĐÊM NAY: tính từ 12h trưa hôm nay (ca lái hộ vắt qua nửa đêm nên không cắt theo 0h)
  const shiftStart = new Date(); shiftStart.setHours(12, 0, 0, 0);
  if (new Date().getHours() < 6) shiftStart.setDate(shiftStart.getDate() - 1);
  const tj = jobs.filter(j => j.ts >= shiftStart.getTime());
  const today = { n: tj.length, wins: tj.filter(j => j.win).length };
  // Thống kê theo LOẠI XE và số lần ghi "quán đang đông" (dữ liệu anh Long đề xuất thu thêm)
  const oto = jobs.filter(j => j.win && j.xe === 'oto').length;
  const may = jobs.filter(j => j.win && j.xe === 'may').length;
  const dong = jobs.filter(j => j.type === 'dong').length;
  const dongNo = jobs.filter(j => j.type === 'dong').filter(d => jobs.some(w => w.key === d.key && w.win && w.ts > d.ts && w.ts - d.ts <= CHO_MS)).length;
  return { n: jobs.length, wins, rate: wins / jobs.length, today, oto, may, dong, dongNo, quan: rank(byQuan).slice(0, 3), hour: rank(byHour).slice(0, 3) };
}
/* ===== CHỨNG MINH ĐIỀU HƯỚNG CÓ KẾT QUẢ THẬT =====
   Mỗi cuốc đều lưu kèm % app đã dự báo TRƯỚC khi biết kết quả.
   Bảng này gom lại: app báo ≥50% thì thực tế nổ bao nhiêu phần trăm?
   Nếu app nói phét, chính bảng này sẽ tố cáo — đó mới là minh bạch thật. */
function calibReport() {
  const jobs = loadJobs().filter(j => typeof j.p === 'number');
  if (jobs.length < 4) return null;
  const bands = [
    { k: '🔴 App báo ≥50% (NÊN ĐI)', lo: .5, hi: 1.01 },
    { k: '🟠 App báo 35–50% (cân nhắc)', lo: .35, hi: .5 },
    { k: '🟡 App báo dưới 35% (nên chờ)', lo: -1, hi: .35 },
  ];
  const rows = bands.map(b => {
    const g = jobs.filter(j => j.p >= b.lo && j.p < b.hi);
    return { k: b.k, n: g.length, win: g.filter(j => j.win).length, pred: g.length ? mean(g.map(j => j.p)) : 0 };
  }).filter(b => b.n);
  return rows.length ? { rows, n: jobs.length } : null;
}
/* Khung giờ nào bạn thật sự nổ cuốc — học từ chính nhật ký, không phải lý thuyết */
function bandStats() {
  const jobs = loadJobs(); if (!jobs.length) return null;
  const out = BANDS.map(b => {
    const g = jobs.filter(j => (j.band || bandOf(j.hour)) === b.k);
    return { ...b, n: g.length, win: g.filter(x => x.win).length };
  }).filter(b => b.n);
  return out.length ? out : null;
}
/* Quán × khung giờ bạn mát tay nhất — đúng câu "quán nào cao điểm khung nào" */
function peakSpots(limit = 6) {
  const out = [];
  for (const k in TWIN.sb) {
    const o = TWIN.sb[k]; if (!o || o.n < 2) continue;
    const i = k.lastIndexOf('|'); if (i < 0) continue;
    const name = k.slice(0, i).split('@')[0], b = k.slice(i + 1);
    if (!BAND_VI[b] || b === 'ngoai') continue;
    out.push({ name, band: b, n: o.n, win: o.win, rate: o.win / o.n, conf: wilson(o.win, o.n, 1) });
  }
  return out.sort((a, b) => b.conf - a.conf || b.n - a.n).slice(0, limit);
}
function renderDash(m) {
  const el = $('#dash-body'); if (!el || !m || $('#dash-sheet').hidden) return;
  const rs = jobStats();
  // Mọi con số dưới đây tính trong VÙNG PHỦ SÓNG 5km quanh tài xế — không phải cả thành phố (số cả TP vô nghĩa với người đang đứng 1 chỗ)
  const near = (m.cover && m.cover.length) ? m.cover : m.raw.filter(r => r.open);
  const avgEta = mean(near.map(r => r.eta));
  const totLambda = near.reduce((s, r) => s + r.lambda, 0);
  const skillPct = Math.round(G.skill * 100);
  const hNow = curHour();
  const fc = t => Math.round(near.reduce((s, r) => s + (isOpen(r.sp, (hNow + t) % 24) ? demandOf(r.sp, (hNow + t) % 24) : 0), 0));
  const wLbl = { demand: 'Đông khách', eta: 'Gần', trend: 'Sắp tan quán', twin: 'Gu của bạn' };
  const wmax = Math.max(...LKEYS.map(k => G.weights[k]));
  const cal = calibReport(), bst = bandStats(), pk = peakSpots();
  const curBand = bandOf(curHour());
  el.innerHTML = `
    <div class="kpis">
      <div class="kpi"><b>${fmtMin(avgEta)}</b><span>Tới điểm TB</span></div>
      <div class="kpi"><b>${skillPct}<small style="font-size:11px">/100</small></b><span>Kỹ năng dự báo</span></div>
      <div class="kpi"><b>${G.jobsN.toLocaleString('vi-VN')}</b><span>Cuốc thật đã ghi</span></div>
    </div>
    ${rs ? `<div class="dash-sec"><h4>🎯 Hiệu quả THẬT của bạn (${rs.n} cuốc)</h4>
      <div class="kpis" style="grid-template-columns:repeat(3,1fr)"><div class="kpi"><b>${Math.round(rs.rate * 100)}%</b><span>Tỉ lệ có khách</span></div><div class="kpi"><b>${rs.wins}</b><span>Cuốc thành công</span></div><div class="kpi"><b>${rs.today.wins}<small style="font-size:11px">/${rs.today.n}</small></b><span>Ca đêm nay</span></div></div>
      ${(rs.oto || rs.may || rs.dong) ? `<div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-top:6px">
        <div class="kpi"><b>🚗 ${rs.oto}</b><span>Cuốc ô tô</span></div>
        <div class="kpi"><b>🏍️ ${rs.may}</b><span>Cuốc xe máy</span></div>
        <div class="kpi"><b>${rs.dongNo}<small style="font-size:11px">/${rs.dong}</small></b><span>Thấy đông → có cuốc</span></div></div>
        <p class="dash-note">“Thấy đông → có cuốc” = trong ${rs.dong} lần anh bấm 👀 quán đang đông, có ${rs.dongNo} lần nổ cuốc thật trong 90 phút sau đó. Tỉ lệ này càng cao thì <b>đứng chờ</b> càng đáng; thấp thì nên chạy sang điểm khác.</p>` : ''}
      <div class="twin" style="margin-top:8px">${rs.quan.map(q => `<div class="tw"><b>📍 ${q.k}</b><span>${Math.round(q.r * 100)}% · ${q.n} lần</span></div>`).join('')}${rs.hour.map(h => `<div class="tw"><b>🕒 ${h.k}</b><span>${Math.round(h.r * 100)}% · ${h.n} lần</span></div>`).join('')}</div>
      <p class="dash-note">Top quận & khung giờ bạn “mát tay” nhất.</p></div>` : '<p class="dash-note">Chưa có cuốc thật nào — bấm ✅/❌ sau mỗi lần đứng chờ để AI học.</p>'}
    <div class="dash-sec"><h4>📈 Dự báo khách cần lái hộ (trong 5km quanh bạn)</h4>
      <div class="fc"><div class="fcv"><b>${fc(0.25)}</b><span>15 phút</span></div><div class="fcv"><b>${fc(0.5)}</b><span>30 phút</span></div><div class="fcv"><b>${fc(1)}</b><span>60 phút</span></div><div class="fcv"><b>${Math.round(totLambda)}</b><span>đang cần</span></div></div>
      ${m.golden ? '<p class="dash-note" style="color:var(--accent)">🍺 Đang trong GIỜ VÀNG.</p>' : ''}
      <p class="dash-note">🌦️ Thời tiết thật: <b>${G.weather ? (WMO[G.weather.code] || '—') + ' · ' + Math.round(G.weather.temp) + '°C · mưa ' + G.weather.prob + '%' : 'đang lấy…'}</b>${G.rain > 0.05 ? ' → mưa làm khách say càng cần lái hộ.' : ''}</p>
    </div>
    ${cal ? `<div class="dash-sec"><h4>🎯 Điều hướng của app có đúng không? (${cal.n} cuốc đã đối chiếu)</h4>
      <div class="calib">${cal.rows.map(r => {
        const act = r.win / r.n, ok = Math.abs(act - r.pred) <= 0.15;
        return `<div class="cal"><span class="cal-k">${r.k}</span>
          <span class="cal-v">thực tế <b>${r.win}/${r.n} = ${Math.round(act * 100)}%</b></span>
          <span class="cal-b ${ok ? 'ok' : 'off'}">${ok ? '✓ khớp' : act > r.pred ? '↑ app báo thấp' : '↓ app báo cao'}</span></div>`;
      }).join('')}</div>
      <p class="dash-note">Mỗi cuốc lưu kèm % app dự báo <b>trước</b> khi biết kết quả. Bảng này so dự báo với thực tế — app nói phét là lộ ngay ở đây. Càng nhiều cuốc, hàng nào lệch app sẽ tự kéo về.</p>
    </div>` : '<p class="dash-note">Bấm ✅/❌ đủ 4 cuốc là app mở bảng đối chiếu <b>dự báo vs thực tế</b> để bạn tự kiểm chứng.</p>'}
    ${bst ? `<div class="dash-sec"><h4>🕒 Khung giờ THẬT SỰ nổ cuốc của bạn</h4>
      <div class="twin">${bst.map(b => `<div class="tw${b.k === curBand ? ' now' : ''}"><b>${b.ico} ${b.vi}${b.k === curBand ? ' · đang ở khung này' : ''}</b><span>${Math.round(b.win / b.n * 100)}% · ${b.n} lần</span></div>`).join('')}</div>
      <p class="dash-note">Học từ nhật ký của chính bạn, không phải lý thuyết chung.</p></div>` : ''}
    ${pk.length ? `<div class="dash-sec"><h4>📍 Quán × khung giờ cao điểm (app đã học được)</h4>
      <div class="toplist">${pk.map(p => `<div class="tl"><span class="tl-r">${p.win}/${p.n}</span>
        <div class="tl-m"><b>${p.name.replace(/^★\s*/, '').slice(0, 34)}</b><small>${BAND_VI[p.band]}${p.band === curBand ? ' · ĐANG TỚI GIỜ' : ''}</small></div>
        <span class="tl-h">${Math.round(p.rate * 100)}%</span></div>`).join('')}</div>
      <p class="dash-note">Đây chính là thứ app dùng để <b>đẩy quán lên đúng khung giờ của nó</b> và hạ xuống ở khung khác. Cần ≥2 cuốc/khung mới tính.</p></div>` : ''}
    <div class="dash-sec"><h4>🧠 Não AI — mỗi ngày một khá hơn</h4>
      <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi"><b>${G.days}</b><span>Ngày đã học</span></div>
        <div class="kpi"><b>${G.resolved}</b><span>Cuốc đã học</span></div>
        <div class="kpi"><b>${skillPct}<small style="font-size:11px">/100</small></b><span>Kỹ năng dự báo</span></div>
      </div>
      <div class="learn" style="margin-top:8px">${spark(G.skillHist)}<div class="learn-txt"><b>${skillPct}</b><small>${G.resolved} cuốc đã học</small></div></div>
      <div class="wbars">${LKEYS.map(k => `<div class="wb"><span>${wLbl[k]}</span><i style="width:${Math.round(G.weights[k] / wmax * 100)}%"></i><em>${G.weights[k].toFixed(2)}</em></div>`).join('')}</div>
      <p class="dash-note">🔒 Não AI được <b>lưu thẳng vào máy</b>: đóng app, tắt máy, hôm sau mở lại vẫn nhớ nguyên. Mỗi lần bạn bấm ✅/❌ là nó chỉnh lại trọng số &amp; hiệu chuẩn % cho sát thực tế của <i>chính bạn</i> — càng chạy càng chuẩn. AI không dùng dữ liệu bịa.</p>
    </div>
    <div class="dash-sec"><h4>🔥 Top điểm đứng chờ (trong 5km)</h4>
      <div class="toplist">${m.byHot.slice(0, 12).map((r, i) => `<div class="tl"><span class="tl-r">${i + 1}</span>
        <div class="tl-m"><b>${TIER_EMOJI[r.tier]} ${r.sp.name}</b><small>${CAT_VI[r.sp.cat]} · ${r.sp.quan || ''} · ${fmtMin(r.eta)} · tan ${fmtClose(r.sp.closeH)}</small></div>
        <span class="tl-h">${r.hotScore}%</span></div>`).join('')}</div>
      <p class="dash-note">Cùng thang % với thẻ ⭐ và 🔍 Tìm kiếm — #1 ở đây chính là điểm app đang đề xuất.</p>
    </div>
    ${m.route ? `<div class="dash-sec"><h4>🛣️ Cung đường rà cuốc</h4>
      <div class="toplist">${m.route.seq.map((r, i) => `<div class="tl"><span class="tl-r">${i + 1}</span>
        <div class="tl-m"><b>${cleanName(r.sp)}</b><small>${r.sp.quan || ''} · ${fmtMin(r.eta)}</small></div>
        <span class="tl-h">${r.hotScore}%</span></div>`).join('')}</div>
      <p class="dash-note">Vòng ${fmtDist(m.route.dist)} (~${fmtMin(m.route.mins)}), <b>đi ngang ${m.route.passN} quán đang mở</b> trong bán kính 800m quanh đường. BUTL phát cuốc cho tài gần nhất — rà đúng cung này là luôn nằm sát nhiều quán cùng lúc.</p>
      <a class="ghostbtn" style="display:block;text-align:center;margin-top:6px;text-decoration:none" href="${routeUrl(m.route)}" target="_blank" rel="noopener">🧭 Mở cung đường trên Google Maps</a>
    </div>` : ''}
    <div class="dash-sec"><h4>📍 Điểm anh tự nạp — kiểm chứng bằng cuốc thật</h4>${myPicksBlock()}</div>
    <div class="dash-sec"><h4>📡 Nguồn dữ liệu quán</h4>${dataSrcBlock()}</div>`;
  const rb = $('#refresh-spots'); if (rb) rb.onclick = () => { toast('Đang cập nhật quán…'); refreshSpots(true, true).then(() => renderDash(G.metrics)); };
  const rs2 = $('#resync-spots'); if (rs2) rs2.onclick = hardResync;
  const pp = $('#pair-dev'); if (pp) pp.onclick = pairDevice;
  const ps = $('#sync-picks'); if (ps) ps.onclick = () => { toast('Đang đồng bộ điểm tự nạp…'); syncPicks(true).then(() => { renderDash(G.metrics); toast(G.pickSync.state === 'đã đồng bộ' ? '✅ Đã đồng bộ ' + livePicks(PICKS_ALL).length + ' điểm · bản #' + G.pickSync.rev : '⚠️ ' + G.pickSync.state + ' — ' + (G.pickSync.err || ''), 4600); }); };
}

/* BẢNG KIỂM CHỨNG ĐIỂM TỰ NẠP — mỗi dòng là số cuốc THẬT đã chạy ở đó, không phải % suy đoán.
   Đây là chỗ tài xế soi được "app học có ra kết quả không", và soi được 2 máy đã khớp chưa. */
function myPicksBlock() {
  const list = livePicks(PICKS_ALL).slice().sort((a, b) => (b.n - a.n) || (b.win - a.win) || (b.ts - a.ts));
  const s = G.pickSync || {};
  const done = list.filter(p => pickStatus(p).k === 'tot').length;
  const weak = list.filter(p => pickStatus(p).k === 'yeu').length;
  const tot = list.reduce((x, p) => x + (p.n || 0), 0), wins = list.reduce((x, p) => x + (p.win || 0), 0);
  const head = `<div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><b>${list.length}</b><span>Điểm tự nạp</span></div>
      <div class="kpi"><b>${wins}<small style="font-size:11px">/${tot}</small></b><span>Cuốc thật ở đó</span></div>
      <div class="kpi"><b>${done}</b><span>Đã chứng minh</span></div>
    </div>`;
  const rows = list.length ? `<div class="pk-list">${list.slice(0, 20).map(p => {
    const st = pickStatus(p);
    return `<div class="pk"><div class="pk-m"><b>${p.name.replace(/^★\s*/, '').slice(0, 40)}</b>
        <small>${CAT_VI[p.cat] || p.cat} · ${p.quan || ''}${p.fix ? ' · 📍 nắn ' + p.fix + ' lần' : ''}</small></div>
      <div class="pk-r"><i class="pk-st ${st.cls}">${st.vi}</i><em>${st.n ? st.w + '/' + st.n : '—'}</em></div></div>`;
  }).join('')}</div>` : '<p class="dash-note">Chưa có điểm nào. Đang đứng ở quán thì bấm <b>➕</b> trên bản đồ để nạp — app sẽ theo dõi giúp anh điểm đó có ra cuốc thật hay không.</p>';
  const warn = weak ? `<p class="dash-note" style="color:#fca5a5">⚠️ ${weak} điểm chạy ≥6 lần mà dưới 17% có khách — bấm vào chấm trên bản đồ rồi 🗑 Xoá cho nhẹ danh sách.</p>` : '';
  return head + rows + warn + `
    <div class="sync-card" style="margin-top:8px">
      <div class="sync-row"><span>Trạng thái đồng bộ</span><b>${s.state || '—'}${s.devices > 1 ? ' · ' + s.devices + ' máy' : ''}</b></div>
      <div class="sync-row"><span>Lần đồng bộ gần nhất</span><b>${s.at ? new Date(s.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'chưa'}</b></div>
      ${s.err ? `<div class="sync-row"><span>Lỗi</span><b style="color:#fca5a5">${s.err}</b></div>` : ''}
      <div class="sync-rev">MÃ TÀI XẾ<b>${BUTL_CODE}</b></div>
    </div>
    <p class="dash-note"><b>Ghép 2 máy:</b> mở mục này ở máy kia, bấm 🔗 rồi gõ đúng mã <b>${BUTL_CODE}</b>. Từ đó điểm tự nạp, số cuốc thật và điểm đã ẩn của 2 máy dùng chung — máy nào học được gì máy kia biết ngay.</p>
    <button id="sync-picks" class="ghost" style="width:100%;margin-top:4px">🔄 Đồng bộ điểm tự nạp ngay</button>
    <button id="pair-dev" class="ghost" style="width:100%;margin-top:6px">🔗 Ghép máy / đổi mã tài xế</button>`;
}

/* Khối "Nguồn dữ liệu quán" — hiện MÃ BẢN (rev) để anh soi 2 máy có trùng nhau không.
   2 máy cùng mã = cùng dữ liệu, khỏi phải đoán. Khác mã = bấm "Đồng bộ lại máy này". */
function dataSrcBlock() {
  const d = G.dataStatus;
  if (!d) return '<p class="dash-note">Đang tải…</p>';
  const upd = d.updatedAt ? new Date(d.updatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—';
  const chk = d.checkedAt ? new Date(d.checkedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'chưa';
  // Đếm THẲNG trên danh sách đang chạy — 3 loại nguồn tách bạch, không gộp cho đẹp số
  const nButl = SPOTS.filter(s => s.source === 'butl').length;
  const nPart = SPOTS.filter(s => s.source === 'doitac').length;
  const nWait = (window.BUTL_UNVERIFIED || []).length;
  const nNamed = SPOTS.filter(s => s.source === 'osm').length;
  const nAddr = SPOTS.filter(s => s.source === 'osm-addr').length;
  const nGoogle = SPOTS.filter(s => s.prec === 'google').length;
  return `<div class="sync-card">
      <div class="sync-row"><span>📍 Điểm đón THẬT (từ ảnh chuyến BUTL)</span><b>${nButl}</b></div>
      <div class="sync-row"><span>🤝 Quán đối tác BUTL (đã dò đúng vị trí)</span><b>${nPart}</b></div>
      <div class="sync-row"><span>⏳ Quán đối tác chưa dò ra vị trí — chưa hiện</span><b>${nWait}</b></div>
      <div class="sync-row"><span>✅ Quán OSM tra được tên trên bản đồ</span><b>${nNamed}</b></div>
      <div class="sync-row"><span>📍 Quán chưa tra được tên → chỉ hiện địa chỉ</span><b>${nAddr}</b></div>
      ${nGoogle ? `<div class="sync-row"><span>🕒 Quán có GIỜ ĐÓNG CỬA THẬT (không phải ước tính)</span><b>${SPOTS.filter(s => s.gioThat).length}</b></div>` : ''}
      <div class="sync-row"><span>Quán dùng chung</span><b>${d.count}</b></div>
      <div class="sync-row"><span>Điểm anh tự thêm (riêng máy này)</span><b>${d.mine || 0}</b></div>
      <div class="sync-row"><span>Nguồn</span><b>${d.source}</b></div>
      <div class="sync-row"><span>OSM cập nhật</span><b>${upd}</b></div>
      <div class="sync-row"><span>Máy này kiểm lúc</span><b>${chk}</b></div>
      <div class="sync-rev">MÃ BẢN DỮ LIỆU<b>#${d.rev || '—'}</b></div>
    </div>
    <p class="dash-note">Nguồn dữ liệu quán: <b>OpenStreetMap</b> (© OpenStreetMap contributors, ODbL) · <b>Overture Maps</b> (© Overture Maps Foundation, CDLA-Permissive 2.0) · tên &amp; địa chỉ đối chiếu <b>VietMap</b>${nGoogle ? ' và <b>Google Maps</b> (Powered by Google)' : ''}. Quán nào bản đồ không tra ra tên thì app chỉ hiện địa chỉ, không tự đặt tên.</p>
    <p class="dash-note"><b>Cách kiểm 2 máy có giống nhau chưa:</b> mở mục này trên cả 2 máy — <b>MÃ BẢN</b> và số <b>quán dùng chung</b> phải y hệt. (Dòng “điểm anh tự thêm” thì mỗi máy một khác là đúng, vì đó là điểm riêng của từng máy.)</p>
    <button id="refresh-spots" class="ghost" style="width:100%;margin-top:6px">🔄 Cập nhật quán ngay</button>
    <button id="resync-spots" class="ghost" style="width:100%;margin-top:6px">🔁 Đồng bộ lại máy này (khi 2 máy lệch số)</button>
    <p class="dash-note">Nút 🔁 xoá bản cũ đang kẹt trong máy rồi tải lại từ đầu — bấm ở máy nào lệch là máy đó về đúng bản chung.</p>`;
}

/* ========================= ĐIỂM CỦA TÔI ========================= */
function driverScore() {
  const s = G.session, onlineMin = (Date.now() - s.start) / 60000;
  const parts = [
    { k: 'Thời gian online', v: clamp(onlineMin / 120, 0, 1), w: .18 },
    { k: 'Tỉ lệ nhận gợi ý', v: s.suggested ? s.accepted / s.suggested : .8, w: .22 },
    { k: 'Tỉ lệ có khách', v: s.accepted ? s.rides / s.accepted : .5, w: .3 },
    { k: 'Điểm đánh giá', v: s.rating / 5, w: .3 },
  ];
  return { score: Math.round(parts.reduce((a, p) => a + p.v * p.w, 0) * 100), parts };
}
function renderScore() {
  const el = $('#score-body'); if (!el || $('#score-sheet').hidden) return;
  const d = driverScore();
  const twinTop = Object.entries(TWIN.cat).map(([k, v]) => ({ k, r: v.win / Math.max(1, v.n), n: v.n })).filter(x => x.n >= 2).sort((a, b) => b.r - a.r).slice(0, 3);
  const slotTop = Object.entries(TWIN.slot).map(([k, v]) => ({ k, r: v.win / Math.max(1, v.n), n: v.n })).filter(x => x.n >= 2).sort((a, b) => b.r - a.r).slice(0, 3);
  el.innerHTML = `
    <div class="dscore"><div class="ds-ring" style="--v:${d.score}"><b>${d.score}</b><span>Driver Score</span></div>
      <p class="dash-note">Dùng để tự theo dõi. Gợi ý được cá nhân hoá bằng Digital Twin (khu & giờ bạn hiệu quả).</p></div>
    <div class="ds-parts">${d.parts.map(p => `<div class="wb"><span>${p.k}</span><i style="width:${Math.round(p.v * 100)}%"></i><em>${Math.round(p.v * 100)}</em></div>`).join('')}</div>
    <div class="dash-sec"><h4>👤 Digital Twin — gu chạy của bạn</h4>
      ${twinTop.length ? `<div class="twin">${twinTop.map(t => `<div class="tw"><b>${CAT_VI[t.k] || t.k}</b><span>${Math.round(t.r * 100)}% · ${t.n} lần</span></div>`).join('')}</div>` : '<p class="dash-note">Chưa đủ dữ liệu — bấm ✅/❌ sau mỗi lần đứng chờ.</p>'}
      ${slotTop.length ? `<h4 class="fh" style="margin-top:10px">🕒 Điểm × Giờ bạn mát tay</h4><div class="twin">${slotTop.map(t => { const [c, h] = t.k.split('|'); return `<div class="tw"><b>${CAT_VI[c] || c} — ${h}h</b><span>${Math.round(t.r * 100)}% · ${t.n} lần</span></div>`; }).join('')}</div>` : ''}
      <div class="ds-sess">Đêm nay: <b>${G.session.rides}</b> cuốc có khách</div>
    </div>`;
}

/* ========================= THỜI TIẾT THẬT ========================= */
const WMO = { 0: '☀️ Trời quang', 1: '🌤️ Ít mây', 2: '⛅ Có mây', 3: '☁️ Nhiều mây', 45: '🌫️ Sương mù', 48: '🌫️ Sương mù', 51: '🌦️ Mưa phùn', 53: '🌦️ Mưa phùn', 55: '🌦️ Mưa phùn', 61: '🌧️ Mưa nhẹ', 63: '🌧️ Mưa', 65: '🌧️ Mưa to', 80: '🌦️ Mưa rào', 81: '🌧️ Mưa rào', 82: '⛈️ Mưa rào mạnh', 95: '⛈️ Dông', 96: '⛈️ Dông', 99: '⛈️ Dông' };
function wxText() { const w = G.weather; if (!w) return G.rain > 0.05 ? '🌧️ mưa' : '☀️ khô'; return `${(WMO[w.code] || '☁️').split(' ')[0]} ${Math.round(w.temp)}°${w.prob >= 30 ? ' · mưa ' + w.prob + '%' : ''}`; }
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

/* ========================= PWA + THÔNG BÁO ========================= */
let deferredPrompt = null;
try { window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; const b = $('#btn-install'); if (b) b.hidden = false; }); } catch (e) {}
try { G.notifOn = localStorage.getItem('roadai_laiho_notif') === '1'; } catch (e) {}
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
  const m = G.metrics; if (!m || !m.best) { toast('Chưa có điểm để gửi thử.'); return false; }
  const b = m.best, [ch] = chanceOf(b.p);
  notify((isTest ? '📨 [Thử] ' : '🔥 ') + 'Điểm nên tới ngay',
    `${cleanName(b.sp)}\nKhả năng nổ cuốc: ${b.hotScore}% (${ch}) · ${fmtMin(b.eta)} · ${fmtDist(b.dist)}`,
    { url: '/kiem-cuoc', gmap: navUrl(b.sp) },
    [{ action: 'nav', title: '🧭 Chỉ đường' }, { action: 'open', title: 'Mở app' }]);
  return true;
}
let notifCd = 0, goldNotified = false;
function maybeNotify(m) {
  if (!G.notifOn || !G.online || !m || !m.best) return;
  if (!withinService(realHour())) return;   // KHÔNG báo ngoài giờ (vd 9h sáng) — theo GIỜ THỰC
  const b = m.best;
  if (isGolden(realHour()) && !goldNotified) {
    goldNotified = true;
    notify('🍺 Giờ vàng đã tới!', `Cầu lái hộ cao nhất đêm.\nNên đứng: ${cleanName(b.sp)}`,
      { url: '/kiem-cuoc', gmap: navUrl(b.sp) }, [{ action: 'nav', title: '🧭 Chỉ đường' }, { action: 'open', title: 'Mở app' }]);
    notifCd = 8; return;
  }
  if (!isGolden(realHour())) goldNotified = false;
  if (notifCd > 0) { notifCd--; return; }
  if (b && b.p >= 0.5 && b.eta <= 8) { notifyBest(false); notifCd = 12; }
}
async function enableNotif() {
  if (typeof Notification === 'undefined') { toast('Thiết bị không hỗ trợ thông báo.'); return false; }
  let p = Notification.permission;
  if (p !== 'granted') p = await Notification.requestPermission();
  if (p !== 'granted') { toast('Chưa cho phép thông báo — bật lại trong cài đặt trình duyệt.'); return false; }
  G.notifOn = true; try { localStorage.setItem('roadai_laiho_notif', '1'); } catch (e) {}
  notify('🔔 Đã bật thông báo', 'Driver Radar sẽ nhắc khi tới giờ vàng & có điểm dễ nổ cuốc.');
  return true;
}

/* ========================= TỰ CẬP NHẬT + ĐỒNG BỘ DANH SÁCH QUÁN =========================
   VÌ SAO 2 MÁY TỪNG LỆCH NHAU (289 vs 652 quán):
   1) Service worker giữ code cũ → máy cài trước chạy js/spots.js đời cũ (đã sửa trong sw.js).
   2) Mỗi máy giữ 1 bản chụp riêng trong localStorage tới 7 ngày, không có cách nào biết là đã cũ.
   3) /api/spots trả thứ tự khác nhau mỗi lần → lọc trùng ra kết quả khác (đã sửa trong api/spots.js).
   Cách chữa ở đây: server phát kèm mã bản "rev". Máy nào cũng đối chiếu rev mỗi lần mở app /
   mỗi lần bật lại màn hình. Khác rev là thay dữ liệu ngay. Màn hình hiện rev để anh soi 2 máy
   có trùng không — không phải tin suông. */
const SPOTS_CACHE = 'roadai_laiho_spots_cache';
const SYNC_MS = 30 * 60 * 1000;   // mở app / bật lại màn hình là đối chiếu; nền thì 30 phút 1 lần
function validSpots(a) { return Array.isArray(a) && a.length >= 120 && a.every(r => Array.isArray(r) && r.length >= 7 && typeof r[0] === 'string' && r[2] > 10.6 && r[2] < 10.95 && r[3] > 106.5 && r[3] < 106.9); }
function loadSpotsCache() { try { const c = JSON.parse(localStorage.getItem(SPOTS_CACHE) || 'null'); if (c && validSpots(c.spots) && (Date.now() - (c.ts || 0)) < 7 * 864e5) return c; } catch (e) {} return null; }
// Đếm TÁCH BẠCH: quán dùng chung (2 máy phải bằng nhau) vs điểm anh tự thêm (riêng từng máy).
// Trước đây gộp chung một số → chỉ cần 1 máy thêm vài điểm là 2 máy đã hiện số khác nhau.
function spotCounts() { let mine = 0; for (const s of SPOTS) if (s.source === 'mine') mine++; return { shared: SPOTS.length - mine, mine, total: SPOTS.length }; }
function hotSwap(spots, source, updatedAt, rev, extra) {
  buildSpots(spots); G.lastBestId = null; G.pendingLog = null; G.chainFrom = null;
  const c = spotCounts();
  G.dataStatus = Object.assign({ count: c.shared, mine: c.mine, total: c.total, updatedAt: updatedAt || null, source, rev: rev || null }, extra || {});
  recompute();
}
let refreshing = false, lastSync = 0;
// force = bỏ qua mọi cache khi gọi. loud = có báo toast khi máy đã đúng bản (chỉ khi anh bấm nút).
async function refreshSpots(force, loud) {
  if (refreshing) return false;
  if (!force && Date.now() - lastSync < 60000) return false;
  refreshing = true;
  try {
    /* CHỈ bỏ qua cache của TRÌNH DUYỆT, TUYỆT ĐỐI KHÔNG thêm ?v=... để phá cache CDN.
       Lý do: cache CDN chính là thứ bảo đảm 2 máy nhận ĐÚNG MỘT bản chụp. Nếu mỗi máy tự
       phá cache thì mỗi máy lại bắt server hỏi OpenStreetMap riêng, ra 2 kết quả khác nhau
       — đúng cái lỗi đang đi sửa. (Thử thật: gọi kèm ?v= mất 60s rồi lỗi 504.) */
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);   // mạng 4G yếu thì thôi, giữ bản cũ, lát sau hỏi lại
    let r; try { r = await fetch('/api/spots', { cache: force ? 'reload' : 'no-store', signal: ctl.signal }); } finally { clearTimeout(to); }
    if (!r.ok) return false;
    const j = await r.json();
    if (!(j && j.ok && validSpots(j.spots))) return false;
    lastSync = Date.now();
    const cur = G.dataStatus && G.dataStatus.rev;
    try { localStorage.setItem(SPOTS_CACHE, JSON.stringify({ ts: Date.now(), spots: j.spots, updatedAt: j.updatedAt, rev: j.rev || null })); } catch (e) {}
    if (cur && j.rev && cur === j.rev) {   // đã đúng bản rồi — không dựng lại bản đồ cho khỏi giật
      G.dataStatus.checkedAt = Date.now();
      if (loud) toast('✅ Máy này đang đúng bản mới nhất (#' + j.rev + ').');
      return true;
    }
    // nói thật khi đang chạy bản dự phòng (OpenStreetMap đang lỗi) — không giả vờ là dữ liệu tươi
    hotSwap(j.spots, j.fresh === false ? '⚠️ OSM lỗi · đang dùng bản dự phòng' : 'OSM · đã đồng bộ', j.updatedAt, j.rev,
      { named: j.named, addrOnly: j.addrOnly, nameCheck: j.nameCheck });
    G.dataStatus.checkedAt = Date.now();
    toast('🔄 Đã đồng bộ ' + G.dataStatus.count + ' quán · bản #' + (j.rev || '—'));
    if ($('#dash-sheet') && !$('#dash-sheet').hidden) renderDash(G.metrics);
    return true;
  } catch (e) { return false; } finally { refreshing = false; }
}
/* NÚT "ĐỒNG BỘ LẠI 2 MÁY": xoá sạch bản chụp cũ + cache service worker rồi nạp lại từ đầu.
   Đây là nút bấm khi 2 máy hiện 2 con số khác nhau — sau khi bấm, 2 máy phải cùng rev. */
async function hardResync() {
  toast('⏳ Đang đồng bộ lại máy này…', 4000);
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
  if (G.dataStatus) G.dataStatus.rev = null;   // ép nhận lại bản mới (không xoá trắng, lỡ mạng hỏng còn dữ liệu mà chạy)
  const ok = await refreshSpots(true, true);
  if (!ok) { toast('⚠️ Chưa lấy được dữ liệu — kiểm tra mạng rồi bấm lại.', 4500); return; }
  setTimeout(() => location.reload(), 900);   // nạp lại để chắc chắn code cũng là bản mới nhất
}

/* ============ ĐỒNG BỘ ĐIỂM TỰ NẠP + BẰNG CHỨNG GIỮA CÁC MÁY ============
   MÃ TÀI XẾ = chìa khoá ghép 2 máy. Máy đầu tự sinh mã; máy thứ 2 nhập đúng mã đó là
   dùng chung kho điểm. Không có mã thì mỗi máy một kho, y như trước. */
const CODE_LS = 'roadai_butl_code', DEV_LS = 'roadai_butl_dev';
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // bỏ O/0/I/1 cho khỏi đọc nhầm khi đọc qua Zalo
function newCode() { let s = ''; for (let i = 0; i < 8; i++) s += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]; return s; }
let BUTL_CODE = ''; try { BUTL_CODE = (localStorage.getItem(CODE_LS) || '').toUpperCase(); } catch (e) {}
if (!/^[A-Z0-9]{6,16}$/.test(BUTL_CODE)) { BUTL_CODE = newCode(); try { localStorage.setItem(CODE_LS, BUTL_CODE); } catch (e) {} }
let DEV_ID = ''; try { DEV_ID = localStorage.getItem(DEV_LS) || ''; } catch (e) {}
if (!/^[a-z0-9]{6,24}$/.test(DEV_ID)) { DEV_ID = rid(12); try { localStorage.setItem(DEV_LS, DEV_ID); } catch (e) {} }
G.pickSync = { state: 'chưa đồng bộ', at: 0, rev: null, devices: 0, err: null };

// Nhận kết quả GỘP từ máy chủ → đây mới là bản app dùng để chạy
function applyMerged(j) {
  if (!j || !j.ok) return false;
  // máy chủ báo điểm nào bị gộp/xoá → sửa lại kho của RIÊNG máy này cho khớp
  for (const t of (j.tomb || [])) {
    const own = MY_PICKS.find(p => p.id === t.id); if (!own) continue;
    if (t.into) { const tgt = MY_PICKS.find(p => p.id === t.into); if (tgt) { tgt.n += own.n; tgt.win += own.win; own.del = 1; own.n = 0; own.win = 0; } else own.id = t.into; }
    else own.del = 1;
  }
  lsSet(PICKS_LS, MY_PICKS);
  PICKS_ALL = (j.picks || []).map(p => ({ ...p }));
  for (const h of (j.hidden || [])) { if (!HIDDEN.has(h)) { HIDDEN.add(h); if (!HIDE_LOG[h]) HIDE_LOG[h] = { ts: 1, on: 1 }; } }
  // máy chủ KHÔNG còn ẩn khoá nào đó mà máy này đang ẩn → bỏ ẩn theo (máy kia đã bỏ ẩn sau)
  const srv = new Set(j.hidden || []);
  for (const k of [...HIDDEN]) if (!srv.has(k) && HIDE_LOG[k] && HIDE_LOG[k].on) { HIDDEN.delete(k); HIDE_LOG[k] = { ts: HIDE_LOG[k].ts, on: 0 }; }
  saveHidden();
  G.pickSync = { state: 'đã đồng bộ', at: Date.now(), rev: j.rev || null, devices: j.devices || 1, err: null };
  return true;
}
let syncing = false, syncQueued = false, lastPickSync = 0;
async function syncPicks(push) {
  if (syncing) { if (push) syncQueued = true; return false; }
  if (!push && Date.now() - lastPickSync < 45000) return false;
  syncing = true;
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
    let r;
    try {
      r = push
        ? await fetch('/api/pickups?code=' + BUTL_CODE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: ctl.signal, body: JSON.stringify({ deviceId: DEV_ID, picks: MY_PICKS, hidden: hideLogArr() }) })
        : await fetch('/api/pickups?code=' + BUTL_CODE, { cache: 'no-store', signal: ctl.signal });
    } finally { clearTimeout(to); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j.ok) { G.pickSync = { ...G.pickSync, state: 'lỗi', err: j.reason || 'không rõ' }; return false; }
    lastPickSync = Date.now();
    const before = JSON.stringify(PICKS_ALL.map(p => p.id + ':' + p.n + ':' + p.win + ':' + p.name));
    applyMerged(j);
    if (JSON.stringify(PICKS_ALL.map(p => p.id + ':' + p.n + ':' + p.win + ':' + p.name)) !== before) { buildSpots(); G.lastBestId = null; recompute(); }
    if ($('#dash-sheet') && !$('#dash-sheet').hidden) renderDash(G.metrics);
    return true;
  } catch (e) {
    G.pickSync = { ...G.pickSync, state: 'chưa nối được', err: String(e.message || e).slice(0, 60) };
    return false;
  } finally {
    syncing = false;
    if (syncQueued) { syncQueued = false; setTimeout(() => syncPicks(true), 400); }
  }
}
/* Ghép máy thứ 2 vào cùng kho: nhập mã của máy thứ nhất */
async function pairDevice() {
  const cur = BUTL_CODE;
  const v = window.prompt('🔗 GHÉP 2 MÁY DÙNG CHUNG ĐIỂM TỰ NẠP\n\nMã máy này: ' + cur + '\n\n• Muốn máy KIA theo máy này: mở app máy kia, vào đây, gõ mã trên.\n• Muốn máy NÀY theo máy kia: gõ mã của máy kia vào ô dưới.\n\nMã tài xế:', cur);
  if (v == null) return;
  const code = v.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,16}$/.test(code)) { toast('Mã không hợp lệ — gồm 6–16 chữ/số.', 4000); return; }
  if (code === cur) { toast('Vẫn giữ mã cũ. Đọc mã ' + cur + ' cho máy kia nhập là xong.', 4600); return; }
  BUTL_CODE = code; try { localStorage.setItem(CODE_LS, code); } catch (e) {}
  toast('🔗 Đang ghép vào mã ' + code + '…');
  await syncPicks(true);
  buildSpots(); G.lastBestId = null; recompute(); renderDash(G.metrics);
  toast('✅ Đã ghép. 2 máy giờ dùng chung ' + livePicks(PICKS_ALL).length + ' điểm tự nạp.', 5000);
}

/* ========================= VÒNG CẬP NHẬT ========================= */
// Khoảng cách + thời gian THẬT theo đường đi (OSRM, free) cho điểm ⭐ — không phải chim bay
function bestRoute(r) { return (r && G.bestRoute && G.bestRoute.id === r.sp.id) ? G.bestRoute : null; }
function dEta(r) { const rr = bestRoute(r); return rr ? fmtMin(rr.dur) : fmtMin(r.eta); }
function dDist(r) { const rr = bestRoute(r); return rr ? fmtDist(rr.dist) : fmtDist(r.dist); }
async function routeBest(best) {
  if (!best) { G.bestRoute = null; return; }
  if (G.bestRoute && G.bestRoute.id === best.sp.id) return;
  try {
    const u = `https://router.project-osrm.org/route/v1/driving/${G.you.lng},${G.you.lat};${best.sp.lng},${best.sp.lat}?overview=false`;
    const r = await fetch(u); if (!r.ok) return; const j = await r.json();
    if (j.code === 'Ok' && j.routes && j.routes[0]) { G.bestRoute = { id: best.sp.id, dist: j.routes[0].distance, dur: j.routes[0].duration / 60 }; renderReco(G.metrics); renderSimple(G.metrics); }
  } catch (e) {}
}
function recompute() {
  const m = computeAll(); m.wait = optimalWait(m); m.route = goldenRoute(m); G.metrics = m;
  if (!m.best || (G.bestRoute && G.bestRoute.id !== m.best.sp.id)) G.bestRoute = null;
  drawMap(m); renderReco(m); renderSimple(m); renderDash(m); renderScore(); renderFind(m); updateStatus();
  if (m.best) routeBest(m.best);
}
function tick() { G.tick++; stepDemand(); recompute(); maybeNotify(G.metrics); }
function updateStatus() {
  const h = curHour(), hh = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');
  const gold = isGolden(h) ? ' · 🍺 GIỜ VÀNG' : '';
  const st = $('#status'); if (st) st.innerHTML = `<b>${G.online ? '🟢 Nhận khách' : '⏸️ Nghỉ'}</b> · 🕒 ${hh}${gold} · ${DAY_VI[G.dayType]}${G.match ? ' · ⚽' : ''} · ${wxText()}`;
}

/* ========================= ĐIỀU KHIỂN ========================= */
function setOnline(v) { G.online = v; const b = $('#online-toggle'); if (b) { b.classList.toggle('on', v); b.textContent = v ? 'Nhận khách' : 'Nghỉ'; } recompute(); toast(v ? '🟢 Bắt đầu nhận khách.' : '⏸️ Đã nghỉ.'); }
function setBase(b) { G.base = b; buildBase(); $$('#base-seg button').forEach(x => x.classList.toggle('active', x.dataset.base === b)); }
function openSheet(id) { $$('.sheet').forEach(s => s.hidden = true); const el = $(id); if (el) el.hidden = false; if (id === '#dash-sheet') renderDash(G.metrics); if (id === '#score-sheet') renderScore(); if (id === '#find-sheet') renderFind(G.metrics); if (id === '#set-sheet') syncSettings(); }
function closeSheets() { $$('.sheet').forEach(s => s.hidden = true); }
function syncSettings() {
  const hs = $('#hour-slider'); if (hs) hs.value = G.simHour == null ? -1 : G.simHour;
  const hl = $('#hour-lbl'); if (hl) hl.textContent = G.simHour == null ? 'Giờ thực' : String(G.simHour).padStart(2, '0') + ':00' + (isGolden(G.simHour) ? ' 🍺' : '');
  const rsl = $('#rain-slider'); if (rsl) rsl.value = Math.round(G.rain * 100);
  const rl = $('#rain-lbl'); if (rl) rl.textContent = (G.rain > 0.05 ? Math.round(G.rain * 100) + '%' : 'Tắt') + (G.rainManual ? ' · chỉnh tay' : ' · tự động');
  const mt = $('#match-toggle'); if (mt) mt.checked = G.match;
  $$('#day-seg button').forEach(b => b.classList.toggle('active', b.dataset.day === G.dayType));
}
function wire() {
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  on('#back-nav', () => location.href = 'index.html');
  on('#online-toggle', () => setOnline(!G.online));
  /* MỘT nút vị trí thay vì hai (◎ về chỗ tôi + 📍 dùng GPS): bấm là vừa xin GPS vừa kéo
     bản đồ về chỗ mình. Bác tài không phải nhớ nút nào làm gì. GPS hỏng thì vẫn về chấm xanh. */
  on('#btn-center', () => {
    map.setView([G.you.lat, G.you.lng], Math.max(14, map.getZoom()));
    if (!navigator.geolocation) return;
    toast('Đang định vị…');
    navigator.geolocation.getCurrentPosition(p => { G.hasGps = true; setYou(p.coords.latitude, p.coords.longitude, true, true); G.pendingLog = null; G.chainFrom = null; SKIPPED.clear(); G.lastBestId = null; recompute(); fetchWeather(); toast('📍 Đã lấy đúng vị trí của anh.'); },
      () => toast('Chưa lấy được GPS — cho phép quyền vị trí, hoặc kéo chấm xanh tới chỗ anh đứng.', 4200), { enableHighAccuracy: true, timeout: 8000 });
  });
  // Chú thích: bấm vào mở bảng đầy đủ, khỏi chiếm chỗ trên bản đồ
  on('#legend', () => toast('⭐ nên tới · 📍 chỗ đã nổ cuốc thật · 🤝 quán đối tác BUTL · 🅿️ chỗ đứng chờ · 🛣️ cung đường rà · ⭕ vùng phủ 5km · 🔴 đông → 🟢 vắng · Ký hiệu 🚗/🏍️ ở góc chấm = điểm đó thường nổ cuốc xe gì (theo cuốc thật)', 8000));
  const at = $('#all-toggle');
  if (at) {
    at.checked = G.hienHet;
    at.onchange = () => { G.hienHet = at.checked; try { localStorage.setItem('roadai_laiho_hienhet', at.checked ? '1' : '0'); } catch (e) {} recompute(); toast(at.checked ? '🗺️ Đang hiện HẾT quán.' : '✅ Chỉ hiện quán đang mở trong 5km — bản đồ dễ nhìn hơn.'); };
  }
  on('#btn-log', () => { const m = G.metrics; if (!m || !m.best) return toast('Chưa có điểm.'); G.session.suggested++; G.pendingLog = m.best; setSimple(false); recompute(); });
  on('#btn-dash', () => openSheet('#dash-sheet'));
  on('#btn-score', () => openSheet('#score-sheet'));
  on('#find-btn', () => openSheet('#find-sheet'));
  on('#btn-set', () => openSheet('#set-sheet'));
  $$('.sheet-close').forEach(b => b.onclick = closeSheets);
  const fq = $('#find-search'); if (fq) fq.oninput = () => renderFind(G.metrics);
  const hq = $('#here-search'); if (hq) hq.oninput = renderHere;
  const hs = $('#hour-slider'); if (hs) hs.oninput = e => { const v = +e.target.value; G.simHour = v < 0 ? null : v; syncSettings(); recompute(); };
  const rsl = $('#rain-slider'); if (rsl) rsl.oninput = e => { G.rain = +e.target.value / 100; G.rainManual = true; syncSettings(); recompute(); };
  const mt = $('#match-toggle'); if (mt) mt.onchange = e => { G.match = e.target.checked; recompute(); };
  $$('#day-seg button').forEach(b => b.onclick = () => { G.dayType = b.dataset.day; syncSettings(); recompute(); });
  $$('#base-seg button').forEach(b => b.onclick = () => setBase(b.dataset.base));
  on('#reset-twin', () => {
    if (!window.confirm('Xoá toàn bộ những gì AI đã học (' + G.days + ' ngày · ' + G.resolved + ' cuốc) và bắt đầu lại từ đầu?')) return;
    TWIN = { cat: {}, hour: {}, slot: {}, spot: {} }; saveTwin();
    G.theta = THETA0.slice(); G.weights = { demand: 1, eta: 1, trend: 0.7, twin: 0.8 };
    G.meanX = [0.4, 0.5, 0.5, 0.5]; G.meanY = 0.3; G.cov = [0, 0, 0, 0];
    G.brierModelEma = 0.25; G.brierBaseEma = 0.25; G.skill = 0; G.skillHist = []; G.resolved = 0; G.days = 0;
    saveBrain(); recompute(); toast('🧹 Đã xoá não AI — học lại từ đầu.');
  });
  on('#btn-unhide', () => { const n = HIDDEN.size; for (const k of [...HIDDEN]) unhideKey(k); G.lastBestId = null; recompute(); syncPicks(true); toast('👁️ Đã bỏ ẩn ' + n + ' điểm (máy kia cũng bỏ ẩn theo).'); });
  on('#btn-addpick', quickAddHere);
  on('#btn-addhere', quickAddHere);
  on('#sp-add', quickAddHere);
  on('#btn-install', async () => {
    const ib = $('#btn-install');
    if (!deferredPrompt) { toast('iPhone: bấm Chia sẻ → “Thêm vào MH chính”. Android sẽ tự hiện nút cài.', 4600); return; }
    deferredPrompt.prompt(); const r = await deferredPrompt.userChoice.catch(() => ({})); deferredPrompt = null; if (ib) ib.hidden = true;
    toast(r && r.outcome === 'accepted' ? '✅ Đã cài Driver Radar!' : 'Đã đóng hộp cài.');
  });
  on('#btn-testnotif', async () => {
    if (!G.notifOn || !canNotify()) { const ok = await enableNotif(); if (!ok) return; const n = $('#notif-toggle'); if (n) n.checked = true; }
    if (notifyBest(true)) toast('📨 Đã gửi! Kéo thanh thông báo xem — có nút 🧭 Chỉ đường.', 5000);
  });
  const nt = $('#notif-toggle'); if (nt) { nt.checked = G.notifOn && canNotify(); nt.onchange = async () => { if (nt.checked) nt.checked = await enableNotif(); else { G.notifOn = false; try { localStorage.setItem('roadai_laiho_notif', '0'); } catch (e) {} toast('Đã tắt thông báo.'); } }; }
  // Chế độ đơn giản
  on('#sp-full', () => setSimple(false));
  on('#btn-simple', () => { setSimple(true); closeSheets(); });
  on('#sp-online', () => setOnline(!G.online));
  /* CÓ KHÁCH → hỏi ngay XE GÌ (2 nút to), rồi mới ghi cuốc. Hỏi sau chứ không hỏi trước,
     vì lúc khách vừa gọi thì bấm 1 phát là xong, chọn xe chỉ mất thêm 1 giây. */
  const hienXe = v => { const a = $('#sp-log'), b = $('#sp-xe'); if (a) a.hidden = v; if (b) b.hidden = !v; };
  on('#sp-yes', () => { if (G.metrics && G.metrics.best) hienXe(true); });
  const ghiXe = xe => { const b = G.metrics && G.metrics.best; hienXe(false); if (b) logJob(b, true, xe); };
  on('#sp-oto', () => ghiXe('oto'));
  on('#sp-may', () => ghiXe('may'));
  on('#sp-busy', () => { const b = G.metrics && G.metrics.best; if (b) logDong(b); });
  on('#sp-no', () => { hienXe(false); const b = G.metrics && G.metrics.best; if (b) logJob(b, false); });
  const snav = $('#sp-nav'); if (snav) snav.addEventListener('click', () => { const b = G.metrics && G.metrics.best; if (b) { G.session.suggested++; G.session.accepted++; } });
  on('#reco-reopen', () => setRecoOpen(true));
}

/* ========================= KHỞI ĐỘNG ========================= */
const _cache = loadSpotsCache();
buildSpots(_cache ? _cache.spots : null);
{
  const c = spotCounts();
  G.dataStatus = { count: c.shared, mine: c.mine, total: c.total, updatedAt: _cache ? _cache.updatedAt : null, rev: _cache ? (_cache.rev || null) : null, source: _cache ? 'OSM · đã lưu' : 'OSM · bản dựng sẵn' };
}
G.jobsN = loadJobs().length;
loadBrain();   // 🧠 nạp lại toàn bộ thứ AI đã học từ những ngày trước
try { const s = localStorage.getItem('roadai_laiho_simple'); G.simpleMode = s == null ? true : s === '1'; } catch (e) { G.simpleMode = true; }
try { G.hienHet = localStorage.getItem('roadai_laiho_hienhet') === '1'; } catch (e) { G.hienHet = false; }
wire();
document.body.classList.toggle('reco-mini', !G.recoBig);
$$('#base-seg button').forEach(x => x.classList.toggle('active', x.dataset.base === G.base));
setOnline(true);
setYou(G.you.lat, G.you.lng, false);
recompute();
setSimple(G.simpleMode);
setInterval(tick, TICK_MS);
// ĐỒNG BỘ: đối chiếu ngay khi mở app, mỗi lần bật lại màn hình, và 30 phút/lần khi đang chạy.
// (Bản cũ 6 tiếng mới hỏi 1 lần + bản chụp giữ 7 ngày → 2 máy lệch nhau cả tuần mà không biết.)
refreshSpots(true, false); setInterval(() => refreshSpots(false, false), SYNC_MS);
// Điểm tự nạp: đẩy lên + kéo bản gộp về ngay khi mở app, rồi 5 phút/lần khi đang chạy
rebuildPicksAll(); syncPicks(true); setInterval(() => syncPicks(false), 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  refreshSpots(false, false); syncPicks(false);
  try { if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.update().catch(() => {}))); } catch (e) {}
});
window.addEventListener('online', () => { refreshSpots(true, false); syncPicks(true); });
fetchWeather(); setInterval(fetchWeather, 20 * 60 * 1000);
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(p => { G.hasGps = true; setYou(p.coords.latitude, p.coords.longitude, true, true); recompute(); fetchWeather(); }, () => {}, { enableHighAccuracy: false, timeout: 6000 });
  // BÁM THEO XE ĐANG CHẠY: trước đây chỉ dời cái chấm xanh, còn vùng phủ sóng/đề xuất thì đứng yên.
  // Giờ đi quá 250m là tính lại toàn bộ — vòng tròn 5km, cung đường và % đều chạy theo bánh xe.
  let _lastFix = { lat: G.you.lat, lng: G.you.lng };
  if (navigator.geolocation.watchPosition) navigator.geolocation.watchPosition(p => {
    G.hasGps = true;
    const nx = { lat: p.coords.latitude, lng: p.coords.longitude };
    const moved = haversine(_lastFix, nx);
    G.you = nx; G.youFromGps = true;   // GPS thật đã về → lại được phép tự nạp điểm theo vị trí này
    if (youMarker) youMarker.setLatLng([nx.lat, nx.lng]);
    if (moved > 250) { _lastFix = nx; G.lastBestId = null; recompute(); }
  }, () => {}, { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 });
}
// Service worker: updateViaCache 'none' để trình duyệt không giữ luôn file sw.js cũ.
// Có bản mới → tự nạp lại 1 lần, nên 2 máy không bao giờ kẹt ở 2 phiên bản code khác nhau.
if ('serviceWorker' in navigator && navigator.serviceWorker.register) {
  let _reloaded = false;
  const _hadCtrl = !!navigator.serviceWorker.controller;   // lần cài đầu tiên thì KHÔNG reload cho khỏi chớp màn hình
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_reloaded || !_hadCtrl) return; _reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    reg.update().catch(() => {});
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) w.postMessage({ type: 'SKIP_WAITING' }); });
    });
  }).catch(() => {});
}
toast('🍺 Driver Radar sẵn sàng. Chỉ đề xuất quán đang mở, từ 14h mỗi ngày.', 4200);
