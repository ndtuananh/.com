/* ================= RoadAI · AI Lái Hộ — Định vị tài xế lái hộ thông minh =================
   Bài toán THẬT: bạn là tài xế LÁI HỘ (chở người đã uống rượu bia về nhà bằng chính xe
   của họ). Thu nhập phụ thuộc việc ĐỨNG ĐÚNG CHỖ, ĐÚNG GIỜ — nơi sắp có khách say cần về.

   Điểm mấu chốt của nghề lái hộ (khác xe ôm/taxi):
   • Cầu = KHÁCH SAY cần người lái hộ, tập trung ở phố nhậu / beer club / bar / karaoke.
   • Cầu lái hộ TRỄ hơn giờ nhậu ~2–3 tiếng → đỉnh vào GIỜ VÀNG lúc tan quán (22:30–01:00).
   • Chi phí lớn nhất là QUAY VỀ: chở khách về nhà (có thể xa) rồi phải quay lại vùng nhậu.
   • Yếu tố đêm: cuối tuần, ngày lương, cận Tết/tất niên, đêm có bóng đá → cầu tăng vọt.

   Chạy 100% ở trình duyệt (không backend, không API key) bằng một bộ MÔ PHỎNG thời gian
   thực để dùng được ngay. Đây là "mô hình tiên nghiệm": khi có dữ liệu thật (điểm quán từ
   bản đồ + nhật ký cuốc do tài xế ghi + lịch sử của chính bạn) sẽ thay dần lớp SIM.

   An toàn: dịch vụ này giúp người đã uống KHÔNG tự lái xe — đúng tinh thần Nghị định 100.
==================================================================================== */
'use strict';

/* ========================= HẰNG SỐ & TIỆN ÍCH ========================= */
const WIN_MIN = 15;                 // cửa sổ dự báo (phút)
const CITY_KMH = 26;                // tốc độ nội đô ban đêm (đường thoáng hơn)
const ROAD_FACTOR = 1.35;           // hệ số đường vòng
const FUEL_PER_KM = 1100;           // chi phí đi tới điểm chờ (đ/km)
const LH_BASE = 160000;             // giá mở cửa lái hộ (≈3km đầu) — tham khảo HCM
const LH_PERKM = 18000;             // +mỗi km tiếp theo
const RETURN_PERKM = 9000;          // chi phí tài xế QUAY VỀ vùng nhậu (grab/xe ôm/xe gấp)
const RETURN_KMH = 26;
const TICK_MS = 30000;              // cập nhật thời gian thực mỗi 30 giây
const RECO_FLAMES = 6;
const SAT_RATIO = 1.25;             // cung ≥ cầu×tỉ lệ này ⇒ "đủ tài xế" (balancer)

const R = 6371000, toRad = d => d * Math.PI / 180;
function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sigmoid = x => 1 / (1 + Math.exp(-clamp(x, -30, 30)));
const fmtVnd = n => Math.round(n).toLocaleString('vi-VN') + 'đ';
const fmtKvnd = n => { const s = n < 0 ? '-' : ''; n = Math.abs(n); return s + (n >= 10000 ? Math.round(n / 1000) + 'k' : Math.round(n).toLocaleString('vi-VN')); };
const fmtDist = m => m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km';
const fmtMin = m => m < 1 ? '<1 phút' : Math.round(m) + ' phút';
const pct = x => Math.round(x * 100) + '%';
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let toastT; function toast(msg, ms = 2600) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }
function drift(prev, target, vol) { return clamp(lerp(prev, target, 0.25) + (Math.random() - 0.5) * vol, 0.05, 3); }

/* ========================= KHUNG GIỜ CẦU LÁI HỘ (đêm-trọng, đỉnh lúc tan quán) ========================= */
function hourDist(a, b) { const d = Math.abs(a - b); return Math.min(d, 24 - d); }
function makeCurve(floor, peaks) {
  const c = [];
  for (let h = 0; h < 24; h++) { let v = floor; for (const p of peaks) v += p.w * Math.exp(-((hourDist(h, p.h) / (p.s || 1)) ** 2)); c.push(v); }
  const mx = Math.max(...c); return c.map(v => v / mx);
}
// Đỉnh đặt vào lúc KHÁCH SAY tan quán cần về, không phải lúc bắt đầu nhậu.
const CURVES = {
  phonhau:  makeCurve(0.02, [{ h: 20, w: .5, s: 1.4 }, { h: 22.5, w: 1, s: 1.6 }, { h: 0, w: .9, s: 1.7 }]),   // phố/quán nhậu
  beerclub: makeCurve(0.02, [{ h: 23, w: 1, s: 1.6 }, { h: 1, w: .85, s: 1.7 }]),                              // beer club
  bar:      makeCurve(0.01, [{ h: 0, w: 1, s: 1.7 }, { h: 2, w: .8, s: 1.6 }, { h: 22.5, w: .55, s: 1.3 }]),   // bar/pub/phố Tây
  karaoke:  makeCurve(0.03, [{ h: 22, w: 1, s: 1.7 }, { h: 0.5, w: .85, s: 1.6 }]),                            // karaoke
  nhahang:  makeCurve(0.03, [{ h: 21, w: 1, s: 1.5 }, { h: 22.5, w: .55, s: 1.2 }]),                           // nhà hàng/tiệc (tan sớm hơn)
  sanbong:  makeCurve(0.02, [{ h: 23, w: 1, s: 1.9 }, { h: 1, w: .7, s: 1.6 }]),                               // quán bóng đá (đông khi có trận)
  vanphong: makeCurve(0.02, [{ h: 20.5, w: 1, s: 1.3 }, { h: 22, w: .5, s: 1.1 }]),                            // khu VP nhậu after-work (ngày thường)
};
function curveAt(cat, h) { const c = CURVES[cat]; const f = ((h % 24) + 24) % 24; const i = Math.floor(f), n = (i + 1) % 24; return lerp(c[i], c[n], f - i); }
const VOL = { phonhau: .28, beerclub: .35, bar: .5, karaoke: .38, nhahang: .3, sanbong: .55, vanphong: .32 };
const CAT_VI = { phonhau: 'Phố/quán nhậu', beerclub: 'Beer club', bar: 'Bar / Pub', karaoke: 'Karaoke', nhahang: 'Nhà hàng / tiệc', sanbong: 'Quán bóng đá', vanphong: 'Khu VP (after-work)' };
// Giờ đóng cửa TB theo nhóm (0 = 24:00). Cầu lái hộ SPIKE quanh giờ tan quán (khách ra về cùng lúc).
const CLOSE_H = { phonhau: 0, beerclub: 1.5, bar: 2, karaoke: 1.5, nhahang: 22.75, sanbong: 1, vanphong: 22 };
function fmtClose(ch) { ch = ((ch % 24) + 24) % 24; const h = Math.floor(ch), m = Math.round((ch - h) * 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }

/* ========================= ĐIỂM NÓNG LÁI HỘ (nhậu/bar HCM) =========================
   [tên, nhóm, lat, lng, size(khách say/đêm lúc đỉnh), homeKm(khách thường về xa bao nhiêu)] */
// Fallback vài điểm Bình Tân (khi js/spots.js chưa nạp). [tên, nhóm, lat, lng, size, homeKm, quận]
const SEED_FALLBACK = [
  // --- KHU TÊN LỬA — BÌNH TÂN (sân chính của tài xế) ---
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
  ['Nhà hàng tiệc cưới Bình Tân', 'nhahang', 10.74800, 106.61350, 8, 7, 'Bình Tân'],
  // --- ĐIỂM NHẬU LỚN TOÀN TP.HCM (chạy thêm chút nếu đáng đi) ---
  ['Phố Tây Bùi Viện', 'bar', 10.76700, 106.69260, 14, 5, 'Quận 1'],
  ['Phố nhậu Vĩnh Khánh', 'phonhau', 10.75920, 106.70130, 15, 6, 'Quận 4'],
  ['Phố nhậu Phạm Văn Đồng', 'phonhau', 10.83958, 106.73850, 14, 9, 'Bình Thạnh'],
  ['Bar D2 — Nguyễn Gia Trí', 'bar', 10.80120, 106.71480, 11, 6, 'Bình Thạnh'],
  ['Ẩm thực Phan Xích Long', 'phonhau', 10.80063, 106.68434, 13, 6, 'Phú Nhuận'],
  ['Bar/Pub Bà Huyện Thanh Quan', 'bar', 10.77918, 106.68562, 10, 5, 'Quận 3'],
  ['Beer club Phú Mỹ Hưng', 'beerclub', 10.74111, 106.72134, 11, 7, 'Quận 7'],
  ['Nhậu Nguyễn Tri Phương', 'phonhau', 10.76135, 106.66872, 12, 6, 'Quận 10'],
  ['Bar khu Thảo Điền', 'bar', 10.80051, 106.73365, 10, 7, 'TP Thủ Đức'],
  ['Nhậu Nguyễn Trãi (Chợ Lớn)', 'phonhau', 10.75650, 106.67606, 10, 6, 'Quận 5'],
  ['Nhậu Hồ Con Rùa', 'phonhau', 10.78270, 106.69580, 9, 5, 'Quận 3'],
  ['Beer club Ngã 6 Phù Đổng', 'beerclub', 10.76900, 106.69260, 10, 5, 'Quận 1'],
];
// Danh sách quán THẬT ở TP.HCM từ js/spots.js (OpenStreetMap + Bình Tân hiệu chỉnh tay).
const OSM_SPOTS = (typeof window !== 'undefined' && window.LAIHO_SPOTS && window.LAIHO_SPOTS.length) ? window.LAIHO_SPOTS : SEED_FALLBACK;
// Gộp ĐIỂM ĐÓN THẬT học từ app BUTL (nguồn butl) lên ĐẦU, ưu tiên hơn OSM, dedup OSM trong ~150m.
function mergeLearned(base) {
  const Ls = (typeof window !== 'undefined' && window.LEARNED_SPOTS) || [];
  if (!Ls.length) return base;
  const near = (a, b) => { const dLat = a[2] - b[2], dLng = a[3] - b[3]; return dLat * dLat + dLng * dLng < 0.0013 * 0.0013; };
  return Ls.concat(base.filter(b => !Ls.some(l => near(l, b))));
}
const SEED_SPOTS = mergeLearned(OSM_SPOTS);

let SPOTS = [], DMAT = [];
function buildSpots(data) {
  const src = mergeLearned((data && data.length) ? data : OSM_SPOTS);
  SPOTS = src.map(([name, cat, lat, lng, size, homeKm, quan, source], i) => ({
    id: 's' + i, name, cat, lat, lng, size, homeKm, quan, source: source || 'osm', closeH: (CLOSE_H[cat] || 0) + (Math.random() - .5) * 0.5, noise: 0.9 + Math.random() * 0.2,
  }));
  DMAT = SPOTS.map(a => SPOTS.map(b => haversine(a, b))); // ma trận khoảng cách quán↔quán, tính 1 lần (điểm cố định)
}
// khoá ỔN ĐỊNH theo tên+toạ độ (không theo index) để Yêu thích/Ghi chú/nhật ký sống sót khi data tự cập nhật
const spotKey = sp => sp.name + '@' + (+sp.lat).toFixed(4) + ',' + (+sp.lng).toFixed(4);

/* ========================= TRẠNG THÁI ========================= */
const LKEYS = ['demand', 'eta', 'contention', 'trend', 'twin', 'ev'];
const G = {
  you: { lat: 10.8280, lng: 106.7220 },   // mặc định: Phạm Văn Đồng/Hiệp Bình, Thủ Đức (sân thật theo data BUTL; GPS ghi đè)
  hasGps: false,
  online: true,
  simHour: null,
  dayType: 'weekday',            // weekday | weekend | payday | holiday
  match: false,                  // đêm có bóng đá lớn
  rain: 0,
  event: null,
  fleetSize: 24,                 // số tài xế lái hộ khác trong khu (ước tính)
  showFleet: true,
  filter: 'all',                 // lọc theo loại: all|phonhau|beerclub|bar|karaoke|nhahang|sanbong
  base: 'dark',
  tick: 0,
  parkedAt: null,
  metrics: null,
  lastBestId: null,
  pendingLog: null,             // đang chờ ghi kết quả cuốc tại 1 điểm
  chainFrom: null,              // vừa trả khách ở đâu (để gợi ý chuỗi cuốc)
  jobsN: 0,                     // số cuốc THẬT đã ghi
  theta: [-1.0, 2.4, 1.9, 1.7, 0.8, 0.6],
  weights: { demand: 1, eta: 1, contention: 1, trend: 0.7, twin: 0.6, ev: 1 },
  meanX: [0.4, 0.5, 0.5, 0.5, 0.5, 0.5], meanY: 0.3, cov: [0, 0, 0, 0, 0, 0],
  brierModelEma: 0.25, brierBaseEma: 0.25, skill: 0, skillHist: [],
  resolved: 0,
  session: { start: Date.now(), suggested: 0, accepted: 0, rides: 0, revenue: 0, emptyKm: 0, rating: 4.8 },
};
const DAY_MULT = { weekday: 1, weekend: 1.8, payday: 1.35, holiday: 2.4 };
const DAY_VI = { weekday: 'Ngày thường', weekend: 'Cuối tuần', payday: 'Ngày lương', holiday: 'Lễ / cận Tết' };

/* Digital Twin — nhớ nhóm quán & khung giờ bạn hiệu quả nhất (lưu localStorage) */
const TWIN_LS = 'roadai_laiho_twin_v1';
let TWIN = loadTwin();
function loadTwin() { try { const t = JSON.parse(localStorage.getItem(TWIN_LS) || '{}'); return { cat: t.cat || {}, hour: t.hour || {} }; } catch (e) { return { cat: {}, hour: {} }; } }
function saveTwin() { try { localStorage.setItem(TWIN_LS, JSON.stringify(TWIN)); } catch (e) {} }
function twinAffinity(cat, hour) {
  const c = TWIN.cat[cat], h = TWIN.hour[hour];
  const cv = c ? c.win / Math.max(3, c.n) : 0.5, hv = h ? h.win / Math.max(3, h.n) : 0.5;
  return clamp(0.6 * cv + 0.4 * hv, 0, 1);
}
function twinLearn(cat, hour, win) { for (const [obj, key] of [[TWIN.cat, cat], [TWIN.hour, hour]]) { obj[key] = obj[key] || { n: 0, win: 0 }; obj[key].n++; if (win) obj[key].win++; } }

/* Nhật ký cuốc THẬT (crowdsource cá nhân) — nuôi Digital Twin bằng dữ liệu thật, lưu localStorage */
const JOBS_LS = 'roadai_laiho_jobs_v1';
function loadJobs() { try { return JSON.parse(localStorage.getItem(JOBS_LS) || '[]'); } catch (e) { return []; } }
function saveJob(j) { const a = loadJobs(); a.unshift(j); try { localStorage.setItem(JOBS_LS, JSON.stringify(a.slice(0, 500))); } catch (e) {} }

/* Yêu thích ♥ + ghi chú cá nhân cho từng quán (localStorage) */
const FAV_LS = 'roadai_laiho_fav_v1', NOTE_LS = 'roadai_laiho_notes_v1';
let FAV = new Set(); try { FAV = new Set(JSON.parse(localStorage.getItem(FAV_LS) || '[]')); } catch (e) {}
let NOTES = {}; try { NOTES = JSON.parse(localStorage.getItem(NOTE_LS) || '{}'); } catch (e) {}
function saveFav() { try { localStorage.setItem(FAV_LS, JSON.stringify([...FAV])); } catch (e) {} }
function saveNotes() { try { localStorage.setItem(NOTE_LS, JSON.stringify(NOTES)); } catch (e) {} }

/* ========================= TÀI XẾ LÁI HỘ KHÁC (cung/cạnh tranh + tín hiệu học) ========================= */
let FLEET = [];
function buildFleet() {
  FLEET = [];
  for (let i = 0; i < G.fleetSize; i++) { const s = SPOTS[Math.floor(Math.random() * SPOTS.length)]; FLEET.push({ lat: s.lat + (Math.random() - .5) * .02, lng: s.lng + (Math.random() - .5) * .02, target: null, cooldown: 0 }); }
}
function setFleetSize(n) {
  n = clamp(n | 0, 0, 120);
  if (n > FLEET.length) for (let i = FLEET.length; i < n; i++) { const s = SPOTS[Math.floor(Math.random() * SPOTS.length)]; FLEET.push({ lat: s.lat + (Math.random() - .5) * .02, lng: s.lng + (Math.random() - .5) * .02, target: null, cooldown: 0 }); }
  else FLEET.length = n;
  G.fleetSize = n;
}

/* ========================= LÕI: CẦU, CUNG & CHẤM ĐIỂM ========================= */
function curHour() { if (G.simHour != null) return G.simHour; const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
function isGolden(h) { return h >= 22 || h < 1.5; }        // GIỜ VÀNG: khách say tan quán cần về
function contextMult(sp) {
  let m = DAY_MULT[G.dayType] || 1;
  if (G.match) m *= sp.cat === 'sanbong' ? 2.6 : 1.25;    // đêm bóng đá
  if (G.dayType === 'weekday' && sp.cat === 'vanphong') m *= 1; else if (sp.cat === 'vanphong') m *= 0.5; // VP chủ yếu nhậu ngày thường
  m *= 1 + 0.15 * G.rain;                                  // mưa: người đã uống càng cần lái hộ (nhẹ)
  if (G.event && G.event.spotId === sp.id) m *= G.event.mult;
  return m;
}
// phút tới giờ đóng cửa (âm = vừa đóng). Cầu lái hộ SPIKE trong ~1 tiếng quanh giờ tan quán.
function minsToClose(sp, hour) { let dh = sp.closeH - hour; if (dh > 12) dh -= 24; if (dh < -12) dh += 24; return dh * 60; }
function closingSurge(sp, hour) { const dh = minsToClose(sp, hour); return (dh <= 55 && dh >= -20) ? 1 + 0.9 * Math.exp(-(((dh - 10) / 22) ** 2)) : 1; }
function demandOf(sp, hour) { return sp.size * curveAt(sp.cat, hour) * sp.noise * contextMult(sp) * closingSurge(sp, hour) * (sp.source === 'butl' ? 1.3 : 1); } // λ: khách say cần lái hộ / 15' (điểm đón thật BUTL được đẩy cầu)
function supplyOf(sp) {
  let n = 0; for (const f of FLEET) if (haversine(f, sp) < 700) n++;
  const tgt = FLEET.filter(f => f.target === sp.id).length;
  if (G.parkedAt === sp.id) n++;
  return n + tgt * 0.8;
}
function congestionNow() { const h = curHour(); return clamp(0.2 + 0.5 * (Math.exp(-((hourDist(h, 8) / 1.3) ** 2)) + Math.exp(-((hourDist(h, 18) / 1.6) ** 2))) + 0.25 * G.rain, 0, 1); }
function trendOf(sp, hour) { const now = curveAt(sp.cat, hour), soon = curveAt(sp.cat, hour + 10 / 60); return clamp((soon - now) * 5 + 0.5, 0.05, 0.95); }

function computeAll() {
  const hour = curHour(), hInt = Math.floor(hour) % 24;
  const raw = SPOTS.map(sp => {
    const lambda = demandOf(sp, hour);
    const supply = supplyOf(sp);
    const straight = haversine(G.you, sp);
    const dist = straight * ROAD_FACTOR;
    const trafficK = CITY_KMH * (1 - 0.3 * G.rain) * lerp(1, .72, congestionNow());
    const eta = (dist / 1000) / Math.max(6, trafficK) * 60;
    const parkedHere = G.parkedAt === sp.id;
    const share = lambda / (supply + (parkedHere ? 0 : 1));
    const usable = clamp((WIN_MIN - eta) / WIN_MIN, 0, 1);
    const pTrue = 1 - Math.exp(-share * usable);
    // KINH TẾ LÁI HỘ: giá cuốc theo quãng khách về; chi phí QUAY VỀ vùng nhậu; chi phí tới điểm chờ
    const homeKm = sp.homeKm;
    const fare = LH_BASE + Math.max(0, homeKm - 3) * LH_PERKM;
    const driveMin = homeKm / (CITY_KMH * lerp(1, .8, congestionNow())) * 60;   // lái khách về
    const returnKm = homeKm * 0.9, returnCost = returnKm * RETURN_PERKM, returnMin = returnKm / RETURN_KMH * 60;
    const emptyCost = (dist / 1000) * FUEL_PER_KM;
    const expWait = share > 0 ? Math.min(WIN_MIN, WIN_MIN / (share + 0.15)) : WIN_MIN;
    const trend = trendOf(sp, hour);
    const sdRatio = supply / (lambda + 0.4);
    const saturated = sdRatio >= SAT_RATIO && lambda > 0.4;
    const balPenalty = 1 / (1 + Math.max(0, sdRatio - 0.8) * 0.9);
    return { sp, lambda, supply, dist, straight, eta, share, usable, pTrue, fare, homeKm, emptyCost, returnCost, driveMin, returnMin, expWait, trend, mins: minsToClose(sp, hour), hour: hInt, saturated, balPenalty };
  });
  const maxL = Math.max(...raw.map(r => r.lambda), 0.001);
  const maxEta = Math.max(...raw.map(r => r.eta), 1);
  raw.forEach(r => {
    r.sDemand = r.lambda / maxL;
    r.sEta = 1 - r.eta / maxEta;
    r.sContention = 1 - r.supply / (r.supply + r.lambda + 0.001);
    r.sTrend = r.trend;
    r.sTwin = twinAffinity(r.sp.cat, r.hour);
    r.feat = [1, r.sDemand, r.sEta, r.sContention, r.sTrend, r.sTwin];
    r.pModel = sigmoid(G.theta.reduce((s, t, i) => s + t * r.feat[i], 0));
    r.ev = r.pModel * (r.fare - r.returnCost) - r.emptyCost;                     // lãi kỳ vọng 1 cuốc (trừ quay về + tới điểm)
    const cycleMin = r.eta + r.expWait + r.pModel * (r.driveMin + r.returnMin);  // 1 vòng kỳ vọng
    r.cycleMin = cycleMin;
    r.ratePerHr = r.ev / (cycleMin / 60);                                        // ĐỒNG/GIỜ
    r.margin = clamp(Math.round(100 * Math.sqrt(r.pModel * (1 - r.pModel) / (r.lambda + r.supply + 8))), 2, 12);
  });
  const maxRate = Math.max(...raw.map(r => Math.abs(r.ratePerHr)), 1);
  const W = G.weights, wsum = W.demand + W.eta + W.contention + W.trend + W.twin + W.ev;
  raw.forEach(r => {
    r.sEv = clamp(0.5 + r.ratePerHr / (2 * maxRate), 0, 1);
    const base = (W.demand * r.sDemand + W.eta * r.sEta + W.contention * r.sContention + W.trend * r.sTrend + W.twin * r.sTwin + W.ev * r.sEv) / wsum;
    r.composite = base * r.balPenalty;
    r.hotScore = Math.round(100 * (0.42 * r.sDemand + 0.20 * r.pModel + 0.14 * r.sTrend + 0.12 * r.sEv + 0.12 * r.sContention));
  });
  // xếp hạng — chỉ trong nhóm đang lọc (nếu có); heatmap vẫn giữ toàn bộ điểm
  const pool = (G.filter && G.filter !== 'all') ? raw.filter(r => r.sp.cat === G.filter) : raw;
  const byHot = [...pool].sort((a, b) => b.hotScore - a.hotScore);
  byHot.forEach((r, i) => r.hotRank = i);
  const eligible = pool.filter(r => !r.saturated);
  const byComposite = [...(eligible.length ? eligible : pool.length ? pool : raw)].sort((a, b) => b.composite - a.composite);
  let best = byComposite[0];
  if (G.lastBestId) { const prev = byComposite.find(r => r.sp.id === G.lastBestId); if (prev && prev.composite >= best.composite * 0.92) best = prev; }
  if (best) { G.lastBestId = best.sp.id; best.isBest = true; }
  byHot.slice(0, RECO_FLAMES).forEach(r => r.isFlame = true);
  const sortedL = [...raw].map(r => r.lambda).sort((a, b) => a - b);
  const q = p => sortedL[Math.floor(p * (sortedL.length - 1))];
  const q1 = q(.45), q2 = q(.72), q3 = q(.9);
  raw.forEach(r => r.tier = r.lambda >= q3 ? 3 : r.lambda >= q2 ? 2 : r.lambda >= q1 ? 1 : 0);
  return { raw, byHot, byComposite, best, hour, golden: isGolden(hour) };
}

// Google Maps dẫn đường thật (mở app/web Google Maps, không cần API key)
function gmapsDir(lat, lng) { return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`; }
// ĐIỂM CHỜ TỐI ƯU: vị trí đứng GIỮA một cụm quán (bán kính đi bộ ~750m) để tiếp cận nhiều cơ hội nhất,
// đỡ chạy vòng. Chấm điểm = tổng cầu cụm × (ít cạnh tranh) ÷ (thời gian chạy tới từ bạn).
function optimalWait(m) {
  const WALK = 750, raw = m.raw, n = raw.length; let best = null;
  const trafficK = Math.max(6, CITY_KMH * lerp(1, .72, congestionNow()));
  for (let ci = 0; ci < n; ci++) {
    const drow = DMAT[ci] || null; let cl = 0, cnt = 0, sLat = 0, sLng = 0, wsum = 0, sup = 0;
    for (let ri = 0; ri < n; ri++) {
      const d = drow ? drow[ri] : haversine(raw[ci].sp, raw[ri].sp);
      if (d <= WALK) { const r = raw[ri]; const w = r.lambda * (1 - d / WALK); cl += r.lambda; sup += r.supply; cnt++; sLat += r.sp.lat * w; sLng += r.sp.lng * w; wsum += w; }
    }
    if (cnt < 2 || wsum <= 0) continue;
    const center = { lat: sLat / wsum, lng: sLng / wsum };
    const distYou = haversine(G.you, center);
    const eta = (distYou * ROAD_FACTOR / 1000) / trafficK * 60;
    const contention = 1 - sup / (sup + cl + 0.001);
    const score = cl * (0.5 + 0.5 * contention) / (1 + eta / 12);
    if (!best || score > best.score) best = { center, cl, cnt, eta, distYou, score };
  }
  return best;
}

/* ========================= HỌC TRỰC TUYẾN (prediction vs actual) ========================= */
function subScores(r) { return [r.sDemand, r.sEta, r.sContention, r.sTrend, r.sTwin, r.sEv]; }
function observe(r, y) {
  const lr = 0.06, l2 = 0.002, err = y - r.pModel;
  for (let i = 0; i < G.theta.length; i++) G.theta[i] = clamp(G.theta[i] + lr * (err * r.feat[i] - l2 * G.theta[i]), -6, 6);
  const a = 0.03; G.meanY = (1 - a) * G.meanY + a * y;
  const xs = subScores(r);
  for (let k = 0; k < LKEYS.length; k++) { G.meanX[k] = (1 - a) * G.meanX[k] + a * xs[k]; G.cov[k] = (1 - a) * G.cov[k] + a * (xs[k] - G.meanX[k]) * (y - G.meanY); }
  G.resolved++;
  return [(r.pModel - y) ** 2, (G.meanY - y) ** 2];
}
function updateSkill(bm, bb) {
  if (!bm.length) return;
  G.brierModelEma = lerp(G.brierModelEma, mean(bm), 0.12);
  G.brierBaseEma = lerp(G.brierBaseEma, mean(bb), 0.12);
  G.skill = clamp(1 - G.brierModelEma / Math.max(1e-3, G.brierBaseEma), 0, 1);
  G.skillHist.push(G.skill); if (G.skillHist.length > 120) G.skillHist.shift();
}
function shiftWeights() {
  let tsum = 0; const tgt = {};
  for (let k = 0; k < LKEYS.length; k++) { tgt[LKEYS[k]] = Math.max(0.1, 0.6 + G.cov[k] * 45); tsum += tgt[LKEYS[k]]; }
  for (const key of LKEYS) G.weights[key] = clamp(lerp(G.weights[key], tgt[key] / tsum * LKEYS.length, 0.08), 0.1, 2.2);
}
function learnStep(metrics) {
  const raw = metrics.raw, bm = [], bb = [];
  for (const f of FLEET) {
    if (f.cooldown > 0) { f.cooldown--; continue; }
    if (f.target && Math.random() < 0.5) { const r = raw.find(x => x.sp.id === f.target); if (r) { const y = Math.random() < r.pTrue ? 1 : 0; const [m, b] = observe(r, y); bm.push(m); bb.push(b); f.cooldown = 1 + (Math.random() * 2 | 0); } }
  }
  updateSkill(bm, bb); shiftWeights();
}
function moveFleet(metrics) {
  const top = metrics.byComposite.slice(0, 12);
  for (const f of FLEET) {
    if (!f.target || Math.random() < 0.15) {
      let bestS = -1, pick = null;
      for (const r of top) { const d = haversine(f, r.sp); const s = r.composite * 1000 - d / 400 - (r.saturated ? 500 : 0) + Math.random() * 40; if (s > bestS) { bestS = s; pick = r.sp; } }
      f.target = pick ? pick.id : null;
    }
    const tsp = SPOTS.find(s => s.id === f.target);
    if (tsp) { f.lat = lerp(f.lat, tsp.lat + (f.lat - tsp.lat) * 0.02, 0.28); f.lng = lerp(f.lng, tsp.lng, 0.28); }
  }
}
function stepDemand() {
  for (const sp of SPOTS) sp.noise = drift(sp.noise, 1, VOL[sp.cat] * 0.5);
  if (G.event) { G.event.until--; if (G.event.until <= 0) { const s = SPOTS.find(x => x.id === G.event.spotId); toast('🎉 Sự kiện tại ' + (s ? s.name : '') + ' đã kết thúc.'); G.event = null; } }
}

/* ========================= BẢN ĐỒ ========================= */
const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([G.you.lat, G.you.lng], 13);
const OSM = { dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', sub: 'abcd' }, light: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', sub: 'abcd' } };
let baseLayer = null;
function buildBase() { if (baseLayer) map.removeLayer(baseLayer); const st = OSM[G.base] || OSM.dark; baseLayer = L.tileLayer(st.url, { maxZoom: 20, subdomains: st.sub }).addTo(map); document.body.classList.toggle('light-base', G.base === 'light'); }
buildBase();
const heatLayer = L.layerGroup().addTo(map), markerLayer = L.layerGroup().addTo(map), fleetLayer = L.layerGroup().addTo(map);
let youMarker = null, targetLine = null;
const TIER_COLOR = ['#22c55e', '#eab308', '#f97316', '#ef4444'];
const TIER_EMOJI = ['🟢', '🟡', '🟠', '🔴'];

function setYou(lat, lng, fly) {
  G.you = { lat, lng };
  if (!youMarker) {
    const icon = L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
    youMarker = L.marker([lat, lng], { icon, zIndexOffset: 1200, draggable: true }).addTo(map);
    youMarker.on('dragend', e => { const p = e.target.getLatLng(); G.you = { lat: p.lat, lng: p.lng }; G.parkedAt = null; G.pendingLog = null; G.chainFrom = null; recompute(); });
  } else youMarker.setLatLng([lat, lng]);
  if (fly) map.setView([lat, lng], Math.max(13, map.getZoom()));
}
function drawMap(m) {
  heatLayer.clearLayers(); markerLayer.clearLayers();
  for (const r of m.raw) { const col = TIER_COLOR[r.tier]; L.circle([r.sp.lat, r.sp.lng], { radius: 150 + r.sDemand * 320, color: col, weight: 0, fillColor: col, fillOpacity: 0.10 + r.sDemand * 0.20, interactive: false }).addTo(heatLayer); }
  for (const r of m.raw) {
    if (G.filter !== 'all' && r.sp.cat !== G.filter) continue;
    const emoji = r.isBest ? '⭐' : r.isFlame ? '🔥' : TIER_EMOJI[r.tier];
    const cls = 'hp' + (r.isBest ? ' hp-best' : r.isFlame ? ' hp-flame' : '');
    const fav = FAV.has(spotKey(r.sp)) ? '<i class="fav-badge">♥</i>' : '';
    const icon = L.divIcon({ className: '', html: `<div class="${cls}"><span>${emoji}</span>${fav}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    L.marker([r.sp.lat, r.sp.lng], { icon, zIndexOffset: r.isBest ? 1000 : r.isFlame ? 800 : (r.tier * 100) }).addTo(markerLayer).on('click', () => openSpot(r));
  }
  if (targetLine) { map.removeLayer(targetLine); targetLine = null; }
  if (m.best) targetLine = L.polyline([[G.you.lat, G.you.lng], [m.best.sp.lat, m.best.sp.lng]], { color: '#2dd4bf', weight: 3, opacity: .8, dashArray: '6 8' }).addTo(map);
  // 🅿️ điểm chờ tối ưu + vòng bán kính đi bộ ~750m
  if (m.wait) {
    L.circle([m.wait.center.lat, m.wait.center.lng], { radius: 750, color: '#fbbf24', weight: 1.5, opacity: .6, fillColor: '#fbbf24', fillOpacity: .06, dashArray: '4 6', interactive: false }).addTo(heatLayer);
    const wi = L.divIcon({ className: '', html: '<div class="hp hp-wait"><span>🅿️</span></div>', iconSize: [30, 30], iconAnchor: [15, 15] });
    L.marker([m.wait.center.lat, m.wait.center.lng], { icon: wi, zIndexOffset: 900 }).addTo(markerLayer)
      .on('click', () => L.popup({ className: 'sp-popup', maxWidth: 240 }).setLatLng([m.wait.center.lat, m.wait.center.lng])
        .setContent(`<div class="sp-pop"><b>🅿️ Điểm chờ tối ưu</b><div class="sp-sub">Đứng giữa cụm quán</div><div class="sp-rows"><span>Quán trong 750m</span><b>${m.wait.cnt}</b><span>Tổng cầu cụm</span><b>${m.wait.cl.toFixed(1)}</b><span>Chạy tới</span><b>${fmtMin(m.wait.eta)} · ${fmtDist(m.wait.distYou * ROAD_FACTOR)}</b></div><a class="sp-go" style="display:block;text-align:center;text-decoration:none" href="${gmapsDir(m.wait.center.lat, m.wait.center.lng)}" target="_blank" rel="noopener">🧭 Google Maps dẫn tới đây</a></div>`).openOn(map));
  }
  drawFleet();
}
function drawFleet() {
  fleetLayer.clearLayers(); if (!G.showFleet) return;
  for (const f of FLEET) { const icon = L.divIcon({ className: '', html: '<div class="drv"></div>', iconSize: [8, 8], iconAnchor: [4, 4] }); L.marker([f.lat, f.lng], { icon, interactive: false, zIndexOffset: 200 }).addTo(fleetLayer); }
}

/* ========================= THẺ ĐỀ XUẤT (⭐ điểm đứng chờ tốt nhất) ========================= */
function reasonsFor(r, golden) {
  const out = [];
  if (r.mins > 0 && r.mins <= 45) out.push(`🕛 Còn ${Math.round(r.mins)}′ nữa tan quán → tới ngay`);
  else if (r.mins <= 0 && r.mins > -20) out.push('🚪 Đang tan quán — khách ra về');
  if (r.sEta > 0.75) out.push(`Rất gần — tới nơi ~${fmtMin(r.eta)}`); else out.push(`Tới nơi ~${fmtMin(r.eta)} · ${fmtDist(r.dist)}`);
  if (r.sContention > 0.6) out.push('Ít tài xế lái hộ cạnh tranh');
  if (r.mins > 45 && golden && r.sTrend > 0.55) out.push('Sắp giờ tan quán — khách say cần về');
  else if (r.sTrend > 0.62) out.push('Khách say sắp tăng');
  if (r.sDemand > 0.7) out.push('Đông khách nhất khu vực');
  if (r.homeKm >= 8) out.push(`Khách hay về xa (~${r.homeKm|0}km) → cuốc to`);
  if (twinAffinity(r.sp.cat, r.hour) > 0.62) out.push('Hợp gu chạy của bạn');
  return out.slice(0, 3);
}
function moveStrip(m) {
  const best = m.best; if (!best) return '';
  let near = null, nd = Infinity;
  for (const r of m.raw) if (r.straight < nd) { nd = r.straight; near = r; }
  if (near && best.sp.id !== near.sp.id && best.composite > near.composite * 1.22 && best.eta < 9)
    return `<div class="reco-move">🔀 <b>Di chuyển ${fmtDist(best.dist)} tới ${best.sp.name}.</b> Khả năng có khách cao hơn (${pct(best.pModel)} vs ${pct(near.pModel)}), tới nơi ~${fmtMin(best.eta)}, ít cạnh tranh hơn.</div>`;
  return '';
}
// CHUỖI CUỐC: vừa trả khách xong → nếu có điểm nhậu gần chỗ đó thì bắt tiếp, khỏi chạy rỗng quay về
function chainStrip(m) {
  if (!G.chainFrom || !m.best) return '';
  const d = m.best.straight;
  if (d > 3000) return `<div class="reco-move">🔗 <b>Vừa trả khách ở ${G.chainFrom}.</b> Quanh đây chưa có điểm nhậu gần — cân nhắc quay lại vùng trung tâm.</div>`;
  return `<div class="reco-move">🔗 <b>Chuỗi cuốc:</b> ${m.best.sp.name} chỉ cách chỗ vừa trả khách ${fmtDist(d)} — bắt tiếp, đỡ chạy rỗng về!</div>`;
}
// 🅿️ điểm chờ tối ưu (đứng giữa cụm quán) — thứ tài xế cần hơn cả 1 quán lẻ
function waitStrip(m) {
  const w = m.wait; if (!w) return '';
  return `<div class="reco-wait">🅿️ <b>Điểm chờ tối ưu</b> — trong 750m có <b>${w.cnt} quán</b> (cầu ~${w.cl.toFixed(0)}), chạy tới ~${fmtMin(w.eta)}. Đứng giữa cụm, đỡ chạy vòng.
    <a class="wait-go" href="${gmapsDir(w.center.lat, w.center.lng)}" target="_blank" rel="noopener">🧭 Đứng ở đây</a></div>`;
}
function renderReco(m) {
  const box = $('#reco');
  if (G.pendingLog) return renderLogPrompt(G.pendingLog);
  const r = m.best;
  if (!G.online) { box.innerHTML = `<div class="reco-off">⏸️ Đang <b>nghỉ</b> — bật "Nhận khách" để AI điều phối.<button id="go-online" class="primary" style="margin-top:10px">▶ Bắt đầu nhận khách lái hộ</button></div>`; $('#go-online').onclick = () => setOnline(true); return; }
  if (!r) { box.innerHTML = '<div class="reco-off">Đang tính toán mạng lưới…</div>'; return; }
  const weak = r.ratePerHr <= 0;
  const warn = weak ? `<div class="reco-warn">⚠️ Giờ này quanh bạn ít khách say — cân nhắc <b>chờ tới giờ vàng (22:30–01:00) hoặc nghỉ</b>. AI sẽ báo ngay khi có điểm đáng đi.</div>` : '';
  const gold = m.golden ? `<div class="reco-gold">🍺 <b>GIỜ VÀNG</b> — khách bắt đầu tan quán, cầu lái hộ cao nhất trong đêm.</div>` : '';
  box.innerHTML = `
    ${gold}${waitStrip(m)}${chainStrip(m)}${moveStrip(m)}${warn}
    <div class="reco-head">
      <div class="reco-star">⭐</div>
      <div class="reco-t"><b>${r.sp.name}</b><small>${TIER_EMOJI[r.tier]} ${CAT_VI[r.sp.cat]} · điểm đứng chờ tốt nhất</small></div>
      <div class="reco-p"><span class="reco-pv">${pct(r.pModel)}</span><small>±${r.margin}% · có khách trong 15′</small></div>
    </div>
    <div class="reco-grid">
      <div class="rm"><b>${fmtMin(r.eta)}</b><span>Tới điểm chờ</span></div>
      <div class="rm"><b>${fmtDist(r.dist)}</b><span>Chạy tới · -${fmtKvnd(r.emptyCost)}đ</span></div>
      <div class="rm"><b>~${fmtMin(r.expWait)}</b><span>Chờ có khách</span></div>
      <div class="rm"><b>${r.supply.toFixed(0)}</b><span>Tài xế lái hộ quanh</span></div>
      <div class="rm"><b>${fmtVnd(r.fare)}</b><span>Cuốc ~ (về ${r.homeKm|0}km)</span></div>
      <div class="rm ${r.ratePerHr > 0 ? 'good' : 'bad'}"><b>${r.ratePerHr > 0 ? '+' : ''}${fmtKvnd(r.ratePerHr)}đ</b><span>Lãi ~ mỗi giờ</span></div>
    </div>
    <div class="reco-reasons">${reasonsFor(r, m.golden).map(x => `<span class="chip">${x}</span>`).join('')}</div>
    <div class="reco-actions">
      <button id="reco-go" class="primary">🚗 ${weak ? 'Vẫn tới đứng chờ' : 'Tới điểm đứng chờ'}</button>
      <a id="reco-nav" class="ghostbtn" href="${gmapsDir(r.sp.lat, r.sp.lng)}" target="_blank" rel="noopener">🧭 Google Maps</a>
      <button id="reco-skip" class="ghostbtn">Bỏ qua</button>
    </div>`;
  $('#reco-go').onclick = () => goTo(r);
  $('#reco-skip').onclick = () => { G.session.suggested++; recompute(); toast('Đã bỏ qua — AI tìm điểm khác phù hợp hơn.'); };
}
// "Tới điểm đứng chờ": di chuyển tới điểm rồi CHỜ GHI KẾT QUẢ THẬT (không tự bịa kết quả)
function goTo(r) {
  G.session.suggested++; G.session.accepted++; G.session.emptyKm += r.dist / 1000;
  G.parkedAt = r.sp.id; G.pendingLog = r; G.chainFrom = null;
  setYou(r.sp.lat + (Math.random() - .5) * .003, r.sp.lng + (Math.random() - .5) * .003, true);
  toast(`🚗 Tới ${r.sp.name} đứng chờ. Có/chưa có khách thì bấm ghi kết quả nhé.`);
  recompute();
}
// Ghi 1 cuốc: cập nhật Digital Twin + mô hình + (nếu thật) lưu nhật ký; thắng thì gợi ý CHUỖI CUỐC
function logJob(r, win, revenue, isSim) {
  twinLearn(r.sp.cat, r.hour, win); saveTwin();
  const [bm, bb] = observe(r, win ? 1 : 0); updateSkill([bm], [bb]);
  if (!isSim) { saveJob({ ts: Date.now(), spotId: r.sp.id, name: r.sp.name, cat: r.sp.cat, quan: r.sp.quan, hour: r.hour, win, revenue: win ? revenue : 0, homeKm: r.homeKm }); G.jobsN = loadJobs().length; }
  G.pendingLog = null; G.parkedAt = null;
  if (win) {
    G.session.rides++; G.session.revenue += revenue;
    // CHUỖI CUỐC: sau khi trả khách bạn đang ở gần nhà khách (cách ~homeKm) → tìm điểm gần đó, khỏi chạy rỗng về
    const brg = Math.random() * 2 * Math.PI, dkm = r.homeKm;
    const dLat = (dkm / 111) * Math.cos(brg), dLng = (dkm / (111 * Math.cos(toRad(r.sp.lat)))) * Math.sin(brg);
    G.chainFrom = r.sp.name;
    setYou(r.sp.lat + dLat, r.sp.lng + dLng, true);
    toast(`✅ +${fmtVnd(revenue)}! Đã trả khách cách ~${dkm | 0}km. AI tìm điểm gần đây để đỡ chạy rỗng.`);
  } else toast('⌛ Chưa có khách — đã ghi nhận, AI điều chỉnh. Thử điểm kế tiếp.');
  recompute();
}
function renderLogPrompt(r) {
  const box = $('#reco');
  const closeTxt = (r.mins > 0 && r.mins <= 60) ? ` · quán tan ~${fmtClose(r.sp.closeH)} (còn ${Math.round(r.mins)}′)` : '';
  box.innerHTML = `
    <div class="reco-head"><div class="reco-star">📝</div>
      <div class="reco-t"><b>Đang chờ tại ${r.sp.name}</b><small>${CAT_VI[r.sp.cat]}${closeTxt}</small></div></div>
    <p class="sheet-hint" style="margin:6px 0 8px">Bạn có bắt được khách lái hộ ở đây không? (ghi thật để AI học đúng gu của bạn)</p>
    <div class="log-rev"><span>Tiền cuốc (đ)</span><input id="log-rev" class="key-input" style="margin:0" type="number" inputmode="numeric" value="${Math.round(r.fare)}" /></div>
    <div class="reco-actions" style="margin-top:10px">
      <button id="log-yes" class="primary">✅ Có khách</button>
      <button id="log-no" class="ghostbtn">❌ Chưa có</button>
      <button id="log-sim" class="ghostbtn">🔮 Mô phỏng</button>
    </div>`;
  $('#log-yes').onclick = () => logJob(r, true, Math.max(0, Math.round(+($('#log-rev').value) || r.fare)), false);
  $('#log-no').onclick = () => logJob(r, false, 0, false);
  $('#log-sim').onclick = () => logJob(r, Math.random() < r.pTrue, Math.round(r.fare), true);
}

/* ========================= POPUP CHI TIẾT 1 ĐIỂM ========================= */
function openSpot(r) {
  const html = `<div class="sp-pop">
    <b>${r.isBest ? '⭐ ' : r.isFlame ? '🔥 ' : TIER_EMOJI[r.tier] + ' '}${r.sp.name}</b>
    <div class="sp-sub">${CAT_VI[r.sp.cat]} · HotScore ${r.hotScore}${r.saturated ? ' · <span style="color:#fca5a5">đủ tài xế</span>' : ''}</div>
    ${r.sp.source === 'butl' ? '<div class="sp-butl">✅ Điểm đón THẬT — đã từng nổ cuốc lái hộ ở đây (BUTL)</div>' : ''}
    <div class="sp-rows">
      <span>Khách say 15′</span><b>${r.lambda.toFixed(1)}</b>
      <span>Tài xế lái hộ quanh</span><b>${r.supply.toFixed(0)}</b>
      <span>Xác suất có khách</span><b>${pct(r.pModel)} ±${r.margin}%</b>
      <span>Tới nơi · chạy tới</span><b>${fmtMin(r.eta)} · ${fmtDist(r.dist)}</b>
      <span>Quán tan ~</span><b>${fmtClose(r.sp.closeH)}${r.mins > 0 && r.mins <= 90 ? ` · còn ${Math.round(r.mins)}′` : ''}</b>
      <span>Cuốc ~ (về ${r.homeKm|0}km)</span><b>${fmtVnd(r.fare)}</b>
      <span>Lãi ~ mỗi giờ</span><b style="color:${r.ratePerHr > 0 ? '#86efac' : '#fca5a5'}">${r.ratePerHr > 0 ? '+' : ''}${fmtKvnd(r.ratePerHr)}đ</b>
    </div>
    ${NOTES[spotKey(r.sp)] ? `<div class="sp-note">📝 ${NOTES[spotKey(r.sp)]}</div>` : ''}
    <div class="sp-fav"><button onclick="__toggleFav('${r.sp.id}')" class="sp-fbtn">${FAV.has(spotKey(r.sp)) ? '♥ Đã thích' : '♡ Yêu thích'}</button><button onclick="__editNote('${r.sp.id}')" class="sp-fbtn">📝 Ghi chú</button></div>
    <button onclick="__goSpot('${r.sp.id}')" class="sp-go">🚗 Tới điểm đứng chờ</button>
    <a class="sp-go" style="display:block;margin-top:6px;text-align:center;text-decoration:none;background:var(--panel2);color:var(--txt)" href="${gmapsDir(r.sp.lat, r.sp.lng)}" target="_blank" rel="noopener">🧭 Google Maps dẫn đường</a>
  </div>`;
  L.popup({ className: 'sp-popup', maxWidth: 260 }).setLatLng([r.sp.lat, r.sp.lng]).setContent(html).openOn(map);
}
window.__goSpot = id => { const r = (G.metrics && G.metrics.raw || []).find(x => x.sp.id === id); if (r) { map.closePopup(); goTo(r); } };
window.__toggleFav = id => { const r = (G.metrics && G.metrics.raw || []).find(x => x.sp.id === id); if (!r) return; const k = spotKey(r.sp); FAV.has(k) ? FAV.delete(k) : FAV.add(k); saveFav(); if (G.metrics) drawMap(G.metrics); openSpot(r); toast(FAV.has(k) ? '♥ Đã lưu vào Yêu thích.' : 'Đã bỏ yêu thích.'); };
window.__editNote = id => { const r = (G.metrics && G.metrics.raw || []).find(x => x.sp.id === id); if (!r) return; const k = spotKey(r.sp); const t = window.prompt('📝 Ghi chú cho quán này (giờ đông, bảo vệ hỗ trợ, chỗ đỗ xe, khách VIP…):', NOTES[k] || ''); if (t == null) return; if (t.trim()) NOTES[k] = t.trim(); else delete NOTES[k]; saveNotes(); openSpot(r); toast('Đã lưu ghi chú.'); };

/* ========================= TRUNG TÂM ĐIỀU PHỐI (Dashboard) ========================= */
function spark(vals, w = 160, h = 40, color = '#2dd4bf') {
  if (vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), rng = hi - lo || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - (v - lo) / rng * h).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
}
// tổng hợp hiệu quả THẬT từ nhật ký cuốc: top quận, top khung giờ, tỉ lệ, doanh thu
function jobStats() {
  const jobs = loadJobs(); if (!jobs.length) return null;
  const spById = {}; for (const s of SPOTS) spById[s.id] = s;
  const byQuan = {}, byHour = {};
  for (const j of jobs) {
    const q = j.quan || (spById[j.spotId] || {}).quan || '—';
    (byQuan[q] = byQuan[q] || { n: 0, win: 0 }).n++; if (j.win) byQuan[q].win++;
    const hb = (j.hour >= 21 || j.hour < 2) ? 'Giờ vàng (21–02h)' : j.hour >= 18 ? 'Tối (18–21h)' : (j.hour >= 2 && j.hour < 6) ? 'Khuya (02–06h)' : 'Ngoài giờ';
    (byHour[hb] = byHour[hb] || { n: 0, win: 0 }).n++; if (j.win) byHour[hb].win++;
  }
  const rank = o => Object.entries(o).map(([k, v]) => ({ k, r: v.win / v.n, n: v.n })).sort((a, b) => b.r - a.r || b.n - a.n);
  const wins = jobs.filter(j => j.win).length;
  return { n: jobs.length, wins, rate: wins / jobs.length, rev: jobs.reduce((s, j) => s + (j.revenue || 0), 0), quan: rank(byQuan).slice(0, 3), hour: rank(byHour).slice(0, 3) };
}
function renderDash(m) {
  const el = $('#dash-body'); if (!el || !m || $('#dash-sheet').hidden) return;
  const rs = jobStats();
  const avgEta = mean(m.raw.map(r => r.eta));
  const avgEmpty = mean(m.byComposite.slice(0, 12).map(r => r.dist / 1000));
  const totLambda = m.raw.reduce((s, r) => s + r.lambda, 0);
  const totSupply = FLEET.length + 1;
  const balance = clamp(totSupply / Math.max(1, totLambda), 0, 2);
  const balTxt = balance < 0.8 ? 'Thiếu tài xế' : balance > 1.3 ? 'Thừa tài xế' : 'Cân bằng tốt';
  const skillPct = Math.round(G.skill * 100);
  const acceptRate = G.session.suggested ? Math.round(G.session.accepted / G.session.suggested * 100) : 0;
  const hNow = curHour();
  const fc = t => Math.round(SPOTS.reduce((s, sp) => s + demandOf(sp, (hNow + t) % 24), 0));
  const wLbl = { demand: 'Đông khách', eta: 'Gần', contention: 'Ít cạnh tranh', trend: 'Sắp tan quán', twin: 'Digital Twin', ev: 'Lãi/giờ' };
  const wmax = Math.max(...LKEYS.map(k => G.weights[k]));
  el.innerHTML = `
    <div class="kpis">
      <div class="kpi"><b>${fmtMin(avgEta)}</b><span>Tới điểm TB</span></div>
      <div class="kpi"><b>${avgEmpty.toFixed(1)} km</b><span>Chạy rỗng TB</span></div>
      <div class="kpi"><b>${skillPct}<small style="font-size:11px">/100</small></b><span>Kỹ năng dự báo</span></div>
      <div class="kpi"><b>${fmtVnd(G.session.revenue)}</b><span>Thu nhập đêm nay</span></div>
      <div class="kpi"><b>${balance.toFixed(2)}</b><span>Cung/Cầu · ${balTxt}</span></div>
      <div class="kpi"><b>${G.jobsN.toLocaleString('vi-VN')}</b><span>Cuốc thật đã ghi</span></div>
    </div>
    ${rs ? `<div class="dash-sec"><h4>🎯 Hiệu quả THẬT của bạn (${rs.n} cuốc đã ghi)</h4>
      <div class="kpis" style="grid-template-columns:repeat(3,1fr)"><div class="kpi"><b>${Math.round(rs.rate * 100)}%</b><span>Tỉ lệ có khách</span></div><div class="kpi"><b>${fmtVnd(rs.rev)}</b><span>Tổng thu đã ghi</span></div><div class="kpi"><b>${rs.wins}</b><span>Cuốc thành công</span></div></div>
      <div class="twin" style="margin-top:8px">${rs.quan.map(q => `<div class="tw"><b>📍 ${q.k}</b><span>${Math.round(q.r * 100)}% có khách · ${q.n} lần</span></div>`).join('')}${rs.hour.map(h => `<div class="tw"><b>🕒 ${h.k}</b><span>${Math.round(h.r * 100)}% có khách · ${h.n} lần</span></div>`).join('')}</div>
      <p class="dash-note">Top quận & khung giờ bạn “mát tay” nhất — càng ghi cuốc, AI càng đề xuất đúng khu của bạn.</p></div>` : ''}
    <div class="dash-sec"><h4>📈 Dự báo khách say cần lái hộ (toàn TP)</h4>
      <div class="fc"><div class="fcv"><b>${fc(0.25)}</b><span>15 phút</span></div>
        <div class="fcv"><b>${fc(0.5)}</b><span>30 phút</span></div>
        <div class="fcv"><b>${fc(1)}</b><span>60 phút</span></div>
        <div class="fcv"><b>${Math.round(totLambda)}</b><span>đang cần (15′)</span></div></div>
      ${m.golden ? '<p class="dash-note" style="color:var(--accent)">🍺 Đang trong GIỜ VÀNG — cầu lái hộ cao nhất đêm.</p>' : ''}
    </div>
    <div class="dash-sec"><h4>🕒 Lịch giờ vàng lái hộ</h4>
      <div class="sched">
        <div class="sch ${hNow >= 18 && hNow < 20 ? 'on' : ''}"><b>18–20h</b><span>Quán bắt đầu đông</span></div>
        <div class="sch ${hNow >= 20 && hNow < 23 ? 'on' : ''}"><b>20–23h</b><span>Khách dùng dịch vụ cao</span></div>
        <div class="sch ${(hNow >= 23 || hNow < 1.5) ? 'on' : ''}"><b>23–01:30</b><span>Khách về — đỉnh lái hộ</span></div>
      </div>
    </div>
    <div class="dash-sec"><h4>🧠 Mô hình đang học — kỹ năng dự báo tăng dần</h4>
      <div class="learn">${spark(G.skillHist)}<div class="learn-txt"><b>${skillPct}</b><small>Brier Skill Score · ${G.resolved.toLocaleString('vi-VN')} mẫu</small></div></div>
      <div class="wbars">${LKEYS.map(k => `<div class="wb"><span>${wLbl[k]}</span><i style="width:${Math.round(G.weights[k] / wmax * 100)}%"></i><em>${G.weights[k].toFixed(2)}</em></div>`).join('')}</div>
      <p class="dash-note">Kỹ năng dự báo = mức mô hình thắng dự báo “tỉ lệ nền” (0 = ngang). AI tự tăng/giảm trọng số theo biến thật sự dự báo đúng có khách.</p>
    </div>
    <div class="dash-sec"><h4>🔥 Top điểm đứng chờ (${m.raw.length} điểm · theo HotScore)</h4>
      <div class="toplist">${m.byHot.slice(0, 12).map((r, i) => `
        <div class="tl"><span class="tl-r">${i + 1}</span>
          <div class="tl-m"><b>${TIER_EMOJI[r.tier]} ${r.sp.name}</b><small>khách ${r.lambda.toFixed(1)} · tx ${r.supply.toFixed(0)} · ${fmtMin(r.eta)} · ${r.ratePerHr > 0 ? '+' : ''}${fmtKvnd(r.ratePerHr)}đ/giờ</small></div>
          <span class="tl-h">${r.hotScore}${r.saturated ? '⛔' : ''}</span></div>`).join('')}</div>
    </div>
    <div class="dash-sec"><h4>⚖️ Phân bố cung / cầu</h4>
      <div class="dist">
        <div class="dist-row"><span>Khách say (cầu 15′)</span><div class="bar"><i style="width:${clamp(totLambda / (totLambda + totSupply) * 100, 4, 96)}%;background:linear-gradient(90deg,#f59e0b,#ef4444)"></i></div><b>${Math.round(totLambda)}</b></div>
        <div class="dist-row"><span>Tài xế lái hộ (cung)</span><div class="bar"><i style="width:${clamp(totSupply / (totLambda + totSupply) * 100, 4, 96)}%"></i></div><b>${totSupply}</b></div>
      </div>
      <p class="dash-note">Demand Balancer: điểm đủ tài xế (⛔) bị hạ ưu tiên mượt để không dồn hết về một chỗ.</p>
    </div>
    <div class="dash-sec"><h4>📡 Nguồn dữ liệu quán (tự cập nhật)</h4>
      <p class="dash-note">${G.dataStatus ? `<b>${G.dataStatus.count}</b> quán · nguồn <b>${G.dataStatus.source}</b>${G.dataStatus.updatedAt ? ' · cập nhật ' + new Date(G.dataStatus.updatedAt).toLocaleString('vi-VN') : ''}.<br>App tự làm mới danh sách quán từ OpenStreetMap (Overpass) — quán mới hiện thêm, quán đóng tự rớt; có tự-kiểm dữ liệu trước khi áp.` : 'Đang tải…'}</p>
      <button id="refresh-spots" class="ghost" style="width:100%;margin-top:4px">🔄 Cập nhật quán ngay</button></div>`;
  const rb = $('#refresh-spots'); if (rb) rb.onclick = () => { toast('Đang cập nhật quán từ OpenStreetMap…'); refreshSpots().then(() => renderDash(G.metrics)); };
}

/* ========================= DRIVER SCORE + DIGITAL TWIN ========================= */
function driverScore() {
  const s = G.session, onlineMin = (Date.now() - s.start) / 60000;
  const accept = s.suggested ? s.accepted / s.suggested : 0.8;
  const success = s.accepted ? s.rides / s.accepted : 0.5;
  const emptyEff = s.emptyKm > 0 ? clamp(s.revenue / (s.emptyKm * FUEL_PER_KM) / 20, 0, 1) : 0.6;
  const parts = [
    { k: 'Thời gian online', v: clamp(onlineMin / 120, 0, 1), w: .12 },
    { k: 'Tỉ lệ nhận gợi ý', v: accept, w: .16 },
    { k: 'Tỉ lệ có khách', v: success, w: .22 },
    { k: 'Hiệu quả chạy rỗng', v: emptyEff, w: .2 },
    { k: 'Điểm đánh giá', v: s.rating / 5, w: .18 },
    { k: 'Độ đúng giờ', v: .9, w: .12 },
  ];
  return { score: Math.round(parts.reduce((a, p) => a + p.v * p.w, 0) * 100), parts };
}
function renderScore() {
  const el = $('#score-body'); if (!el || $('#score-sheet').hidden) return;
  const d = driverScore();
  const twinTop = Object.entries(TWIN.cat).map(([k, v]) => ({ k, r: v.win / Math.max(1, v.n), n: v.n })).filter(x => x.n >= 2).sort((a, b) => b.r - a.r).slice(0, 3);
  el.innerHTML = `
    <div class="dscore"><div class="ds-ring" style="--v:${d.score}"><b>${d.score}</b><span>Driver Score</span></div>
      <p class="dash-note">Dùng để phân tích hiệu quả & minh bạch. Cá nhân hoá gợi ý dựa vào Digital Twin (khu vực & khung giờ bạn hiệu quả), không dùng làm tiêu chí phân công.</p></div>
    <div class="ds-parts">${d.parts.map(p => `<div class="wb"><span>${p.k}</span><i style="width:${Math.round(p.v * 100)}%"></i><em>${Math.round(p.v * 100)}</em></div>`).join('')}</div>
    <div class="dash-sec"><h4>👤 Digital Twin — gu chạy lái hộ của bạn</h4>
      ${twinTop.length ? `<div class="twin">${twinTop.map(t => `<div class="tw"><b>${CAT_VI[t.k] || t.k}</b><span>${Math.round(t.r * 100)}% có khách · ${t.n} lần</span></div>`).join('')}</div>` : '<p class="dash-note">Chưa đủ dữ liệu — cứ nhận vài gợi ý, AI sẽ học nhóm quán & khung giờ bạn hiệu quả nhất.</p>'}
      <div class="ds-sess">Đêm nay: <b>${G.session.rides}</b> cuốc · <b>${fmtVnd(G.session.revenue)}</b> · rỗng <b>${G.session.emptyKm.toFixed(1)} km</b></div>
    </div>`;
}

/* ========================= TÌM KIẾM + BỘ LỌC + TOP 20 ========================= */
const FILTERS = [['all', 'Tất cả'], ['phonhau', 'Quán nhậu'], ['beerclub', 'Beer club'], ['bar', 'Bar/Pub'], ['karaoke', 'Karaoke'], ['nhahang', 'Nhà hàng'], ['sanbong', 'Bóng đá']];
function renderFind() {
  const el = $('#find-body'); if (!el || $('#find-sheet').hidden) return;
  const m = G.metrics; if (!m) return;
  const qtext = ($('#find-search').value || '').trim().toLowerCase();
  $('#find-chips').innerHTML = FILTERS.map(([k, lbl]) => `<button class="fchip${G.filter === k ? ' on' : ''}" data-f="${k}">${lbl}</button>`).join('');
  $$('#find-chips .fchip').forEach(b => b.onclick = () => { G.filter = b.dataset.f; recompute(); renderFind(); });
  let list = qtext
    ? m.raw.filter(r => (r.sp.name + ' ' + (r.sp.quan || '')).toLowerCase().includes(qtext)).sort((a, b) => b.hotScore - a.hotScore)
    : m.byHot.slice();
  list = list.slice(0, 20);
  const favList = m.raw.filter(r => FAV.has(spotKey(r.sp)));
  const row = r => `<div class="fl" onclick="__flyTo('${r.sp.id}')">
      <span class="fl-h" style="background:${TIER_COLOR[r.tier]}22;color:${TIER_COLOR[r.tier]}">${r.hotScore}</span>
      <div class="fl-m"><b>${FAV.has(spotKey(r.sp)) ? '♥ ' : ''}${r.sp.name}</b><small>${CAT_VI[r.sp.cat]} · ${r.sp.quan || ''} · ${fmtMin(r.eta)} · ${fmtDist(r.dist)}</small></div>
      <span class="fl-p">${pct(r.pModel)}</span></div>`;
  el.innerHTML = (favList.length && !qtext ? `<h4 class="find-h">♥ Yêu thích (${favList.length})</h4>${favList.map(row).join('')}` : '')
    + `<h4 class="find-h">${qtext ? 'Kết quả tìm' : 'Top 20 điểm đáng đến'} (${list.length})</h4>${list.map(row).join('') || '<p class="dash-note">Không có điểm phù hợp.</p>'}`;
}
window.__flyTo = id => { const r = (G.metrics && G.metrics.raw || []).find(x => x.sp.id === id); if (!r) return; $('#find-sheet').hidden = true; map.setView([r.sp.lat, r.sp.lng], 16); openSpot(r); };

/* ========================= VÒNG CẬP NHẬT ========================= */
function recompute() { const m = computeAll(); m.wait = optimalWait(m); G.metrics = m; drawMap(m); renderReco(m); renderDash(m); renderScore(); updateStatus(); }
let proxCd = 0;
function checkProximity() {
  if (!G.online || !G.metrics || G.pendingLog) return;
  if (proxCd > 0) { proxCd--; return; }
  for (const r of G.metrics.byHot.slice(0, 8)) {
    const d = haversine(G.you, r.sp);
    if (d < 700 && r.sp.id !== G.parkedAt && r.lambda > 2 && r.pModel > 0.4) {
      toast(`📣 Cách ${r.sp.name} ${fmtDist(d)} — khu nhu cầu cao giờ này, ghé chờ ngay!`, 4200); proxCd = 5; return;
    }
  }
}
function tick() { G.tick++; stepDemand(); const m = computeAll(); G.metrics = m; if (G.online) { moveFleet(m); learnStep(m); } recompute(); checkProximity(); maybeNotify(G.metrics); }
function updateStatus() {
  const h = curHour(), hh = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');
  const wx = G.rain > 0.05 ? `🌧️ mưa` : '☀️ khô';
  const ctx = DAY_VI[G.dayType] + (G.match ? ' · ⚽ bóng đá' : '');
  const gold = isGolden(h) ? ' · 🍺 GIỜ VÀNG' : '';
  const st = $('#status'); if (st) st.innerHTML = `<b>${G.online ? '🟢 Nhận khách' : '⏸️ Nghỉ'}</b> · 🕒 ${hh}${gold} · ${ctx} · ${wx} · 🚗 ${FLEET.length} tx`;
}

/* ========================= ĐIỀU KHIỂN / UI WIRING ========================= */
function setOnline(v) { G.online = v; const b = $('#online-toggle'); if (b) { b.classList.toggle('on', v); b.textContent = v ? 'Nhận khách' : 'Nghỉ'; } recompute(); toast(v ? '🟢 Bắt đầu nhận khách — AI điều phối.' : '⏸️ Đã nghỉ.'); }
function setBase(b) { G.base = b; buildBase(); $$('#base-seg button').forEach(x => x.classList.toggle('active', x.dataset.base === b)); }
function openSheet(id) { $$('.sheet').forEach(s => s.hidden = true); $(id).hidden = false; if (id === '#dash-sheet') renderDash(G.metrics); if (id === '#score-sheet') renderScore(); if (id === '#set-sheet') syncSettings(); if (id === '#find-sheet') renderFind(); }
function closeSheets() { $$('.sheet').forEach(s => s.hidden = true); }
function syncSettings() {
  $('#hour-slider').value = G.simHour == null ? -1 : G.simHour;
  $('#hour-lbl').textContent = G.simHour == null ? 'Giờ thực' : String(G.simHour).padStart(2, '0') + ':00' + (isGolden(G.simHour) ? ' 🍺' : '');
  $('#rain-slider').value = Math.round(G.rain * 100); $('#rain-lbl').textContent = G.rain > 0.05 ? Math.round(G.rain * 100) + '%' : 'Tắt';
  $('#fleet-slider').value = G.fleetSize; $('#fleet-lbl').textContent = G.fleetSize + ' xe';
  $('#fleet-toggle').checked = G.showFleet;
  $('#match-toggle').checked = G.match;
  $$('#day-seg button').forEach(b => b.classList.toggle('active', b.dataset.day === G.dayType));
}
/* ===== PWA CÀI ĐẶT + THÔNG BÁO ĐIỆN THOẠI (điểm dễ nổ cuốc) ===== */
let deferredPrompt = null;
try { window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; const b = $('#btn-install'); if (b) b.hidden = false; }); } catch (e) {}
try { G.notifOn = localStorage.getItem('roadai_laiho_notif') === '1'; } catch (e) { G.notifOn = false; }
function canNotify() { return typeof Notification !== 'undefined' && Notification.permission === 'granted'; }
function notify(title, body, data) {
  try {
    if (!G.notifOn || !canNotify()) return;
    if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(reg => reg.showNotification(title, { body, icon: 'icon.svg', badge: 'icon.svg', tag: 'radar-hot', renotify: true, vibrate: [80, 40, 80], data: data || {} })).catch(() => { try { new Notification(title, { body, icon: 'icon.svg' }); } catch (e) {} });
    else new Notification(title, { body, icon: 'icon.svg' });
  } catch (e) {}
}
let notifCd = 0, goldNotified = false;
// chỉ báo tin CÓ GIÁ TRỊ: giờ vàng vừa tới, hoặc điểm GẦN + dễ nổ cuốc; siết cooldown để không spam
function maybeNotify(m) {
  if (!G.notifOn || !G.online || !m || !m.best) return;
  if (m.golden && !goldNotified) { goldNotified = true; notify('🍺 Giờ vàng đã tới!', `Cầu lái hộ cao nhất đêm. Gợi ý đứng: ${m.best.sp.name} — ${pct(m.best.pModel)} có khách.`, { url: '/kiem-cuoc' }); notifCd = 8; return; }
  if (!m.golden) goldNotified = false;
  if (notifCd > 0) { notifCd--; return; }
  const b = m.best;
  if (b.pModel >= 0.55 && b.eta <= 8 && !b.saturated) {
    notify('🔥 Điểm dễ nổ cuốc gần bạn', `${b.sp.name} · ${pct(b.pModel)} có khách · ${fmtMin(b.eta)} · ~${fmtKvnd(b.ratePerHr)}đ/giờ. Đi ngay!`, { url: '/kiem-cuoc', gmap: gmapsDir(b.sp.lat, b.sp.lng) });
    notifCd = 12;
  }
}
async function enableNotif() {
  if (typeof Notification === 'undefined') { toast('Thiết bị không hỗ trợ thông báo.'); return false; }
  let p = Notification.permission;
  if (p !== 'granted') p = await Notification.requestPermission();
  if (p !== 'granted') { toast('Chưa cho phép thông báo — bật lại trong cài đặt trình duyệt.'); return false; }
  G.notifOn = true; try { localStorage.setItem('roadai_laiho_notif', '1'); } catch (e) {}
  notify('🔔 Đã bật thông báo', 'Driver Radar sẽ nhắc khi có điểm dễ nổ cuốc & khi vào giờ vàng.');
  return true;
}

function wire() {
  $('#back-nav').onclick = () => location.href = 'index.html';
  $('#online-toggle').onclick = () => setOnline(!G.online);
  $('#btn-center').onclick = () => map.setView([G.you.lat, G.you.lng], Math.max(14, map.getZoom()));
  $('#btn-gps').onclick = () => {
    if (!navigator.geolocation) return toast('Thiết bị không hỗ trợ GPS');
    toast('Đang định vị…');
    navigator.geolocation.getCurrentPosition(p => { G.hasGps = true; setYou(p.coords.latitude, p.coords.longitude, true); G.parkedAt = null; G.pendingLog = null; G.chainFrom = null; recompute(); toast('📍 Đã lấy vị trí của bạn.'); },
      () => toast('Không lấy được GPS — cho phép quyền vị trí, hoặc kéo chấm xanh trên bản đồ.'), { enableHighAccuracy: true, timeout: 8000 });
  };
  $('#btn-log').onclick = () => { const m = G.metrics; if (!m || !m.best) return toast('Chưa có điểm để ghi.'); G.session.suggested++; G.pendingLog = m.best; recompute(); };
  $('#find-btn').onclick = () => openSheet('#find-sheet');
  $('#find-search').oninput = () => renderFind();
  $('#btn-dash').onclick = () => openSheet('#dash-sheet');
  $('#btn-score').onclick = () => openSheet('#score-sheet');
  $('#btn-set').onclick = () => openSheet('#set-sheet');
  $$('.sheet-close').forEach(b => b.onclick = closeSheets);
  $('#hour-slider').oninput = e => { const v = +e.target.value; G.simHour = v < 0 ? null : v; syncSettings(); recompute(); };
  $('#rain-slider').oninput = e => { G.rain = +e.target.value / 100; syncSettings(); recompute(); };
  $('#fleet-slider').oninput = e => { setFleetSize(+e.target.value); syncSettings(); recompute(); };
  $('#fleet-toggle').onchange = e => { G.showFleet = e.target.checked; drawFleet(); };
  $('#match-toggle').onchange = e => { G.match = e.target.checked; recompute(); };
  $$('#day-seg button').forEach(b => b.onclick = () => { G.dayType = b.dataset.day; syncSettings(); recompute(); });
  $$('#base-seg button').forEach(b => b.onclick = () => setBase(b.dataset.base));
  $('#btn-event').onclick = () => { const sp = SPOTS[Math.floor(Math.random() * 12)]; G.event = { spotId: sp.id, mult: 2.4, until: 8 }; sp.noise = Math.max(sp.noise, 1.4); toast(`🎉 Tiệc lớn tại ${sp.name} — khách say tăng vọt, xem AI điều phối lại.`); recompute(); };
  $('#btn-ff').onclick = () => { for (let i = 0; i < 40; i++) { stepDemand(); const m = computeAll(); G.metrics = m; moveFleet(m); learnStep(m); } recompute(); toast('⏩ Đã tua nhanh 40 cửa sổ — xem “Kỹ năng dự báo” tăng ở 📊.'); };
  $('#reset-twin').onclick = () => { TWIN = { cat: {}, hour: {} }; saveTwin(); toast('Đã xoá Digital Twin.'); renderScore(); };
  const ib = $('#btn-install'); if (ib) ib.onclick = async () => {
    if (!deferredPrompt) { toast('iPhone: bấm Chia sẻ → “Thêm vào MH chính”. Chrome/Android sẽ tự hiện nút cài.', 4600); return; }
    deferredPrompt.prompt(); const r = await deferredPrompt.userChoice.catch(() => ({})); deferredPrompt = null; ib.hidden = true;
    toast(r && r.outcome === 'accepted' ? '✅ Đã cài Driver Radar vào máy!' : 'Đã đóng hộp cài.');
  };
  const nt = $('#notif-toggle'); if (nt) { nt.checked = G.notifOn && canNotify(); nt.onchange = async () => {
    if (nt.checked) { nt.checked = await enableNotif(); }
    else { G.notifOn = false; try { localStorage.setItem('roadai_laiho_notif', '0'); } catch (e) {} toast('Đã tắt thông báo.'); }
  }; }
}

/* ===== TỰ CẬP NHẬT DỮ LIỆU QUÁN LIÊN TỤC (có tự-kiểm) =====
   Client luôn có 154 quán "dựng sẵn" làm SÀN. Mỗi lần mở + mỗi 6h, gọi /api/spots
   (server tự kéo OpenStreetMap, tự kiểm) → nếu data mới HỢP LỆ & đủ lớn thì hot-swap,
   lưu cache localStorage để lần sau mở là có ngay. Lỗi/offline → giữ nguyên data hiện có. */
const SPOTS_CACHE = 'roadai_laiho_spots_cache';
function validSpots(a) { return Array.isArray(a) && a.length >= 120 && a.every(r => Array.isArray(r) && r.length >= 7 && typeof r[0] === 'string' && r[2] > 10.6 && r[2] < 10.95 && r[3] > 106.5 && r[3] < 106.9); }
function loadSpotsCache() { try { const c = JSON.parse(localStorage.getItem(SPOTS_CACHE) || 'null'); if (c && validSpots(c.spots) && (Date.now() - (c.ts || 0)) < 7 * 864e5) return c; } catch (e) {} return null; }
function hotSwap(spots, source, updatedAt) {
  buildSpots(spots); buildFleet(); G.lastBestId = null; G.parkedAt = null; G.pendingLog = null; G.chainFrom = null;
  G.dataStatus = { count: SPOTS.length, updatedAt: updatedAt || null, source };
  let m0 = computeAll(); for (let i = 0; i < 3; i++) { moveFleet(m0); m0 = computeAll(); }
  recompute();
}
let refreshing = false;
async function refreshSpots() {
  if (refreshing) return; refreshing = true;
  try {
    const r = await fetch('/api/spots', { cache: 'no-store' }); if (!r.ok) return;
    const j = await r.json();
    if (j && j.ok && validSpots(j.spots)) {
      try { localStorage.setItem(SPOTS_CACHE, JSON.stringify({ ts: Date.now(), spots: j.spots, updatedAt: j.updatedAt })); } catch (e) {}
      hotSwap(j.spots, 'OSM · tự cập nhật', j.updatedAt);
      toast('🔄 Đã cập nhật ' + SPOTS.length + ' quán mới nhất từ OpenStreetMap.', 3000);
    }
  } catch (e) { /* offline/lỗi → giữ nguyên data hiện có */ }
  finally { refreshing = false; }
}

/* ========================= KHỞI ĐỘNG ========================= */
const _cache = loadSpotsCache();
buildSpots(_cache ? _cache.spots : null);
G.dataStatus = _cache ? { count: SPOTS.length, updatedAt: _cache.updatedAt, source: 'OSM · đã lưu' } : { count: SPOTS.length, updatedAt: null, source: 'OSM · bản dựng sẵn' };
buildFleet(); G.jobsN = loadJobs().length; wire();
// Mở app ban ngày (5:00–18:00) — chưa tới giờ lái hộ — xem trước GIỜ VÀNG 22:00 cho hữu ích ngay.
let previewed = false;
{ const rh = new Date().getHours(); if (rh >= 5 && rh < 18) { G.simHour = 22; previewed = true; } }
$$('#base-seg button').forEach(x => x.classList.toggle('active', x.dataset.base === G.base));
setOnline(true);
setYou(G.you.lat, G.you.lng, false);
{ let m0 = computeAll(); for (let i = 0; i < 5; i++) { moveFleet(m0); m0 = computeAll(); } for (let i = 0; i < 10; i++) { stepDemand(); m0 = computeAll(); moveFleet(m0); learnStep(m0); } }
recompute();
setInterval(tick, TICK_MS);
refreshSpots();                               // tự lấy quán mới nhất ngay khi mở
setInterval(refreshSpots, 6 * 3600 * 1000);   // và tự làm mới mỗi 6 giờ nếu app mở lâu
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(p => { G.hasGps = true; setYou(p.coords.latitude, p.coords.longitude, true); G.parkedAt = null; recompute(); }, () => {}, { enableHighAccuracy: false, timeout: 6000 });
  if (navigator.geolocation.watchPosition) navigator.geolocation.watchPosition(p => { if (G.parkedAt) return; G.hasGps = true; G.you = { lat: p.coords.latitude, lng: p.coords.longitude }; if (youMarker) youMarker.setLatLng([G.you.lat, G.you.lng]); }, () => {}, { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
toast(previewed
  ? '🍺 Đang xem trước GIỜ VÀNG 22:00 (ban ngày chưa có khách). Kéo ⚙️ đổi giờ/loại ngày, ⏩ xem AI học.'
  : '🍺 AI Lái Hộ sẵn sàng. Kéo chấm xanh đổi vị trí, chỉnh giờ/ngày ở ⚙️, bấm ⏩ để xem AI học.', 4800);
