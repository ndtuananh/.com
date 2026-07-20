/* RoadAI · Driver Radar — /api/spots (Vercel serverless, ESM).
   TỰ CẬP NHẬT: kéo quán THẬT ở TP.HCM từ OpenStreetMap (Overpass API, miễn phí, không key),
   tự chuẩn hoá + TỰ KIỂM (đủ số lượng, toạ độ trong HCM, đúng nhóm) rồi trả JSON.
   Edge-cache 1 ngày (s-maxage) + stale-while-revalidate 7 ngày → luôn nhanh, tự làm mới nền.
   Nguồn: © OpenStreetMap contributors (ODbL). */
export const config = { maxDuration: 60 };

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

const R = 6371000, toR = d => d * Math.PI / 180;
function hav(a1, o1, a2, o2) { const dLat = toR(a2 - a1), dLng = toR(o2 - o1); const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a1)) * Math.cos(toR(a2)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function catOf(t) { const a = t.amenity, nm = (t.name || '').toLowerCase(); if (/karaoke|ktv/.test(nm)) return 'karaoke'; if (a === 'nightclub' || a === 'biergarten' || /beer ?club|bia/.test(nm)) return 'beerclub'; if (a === 'bar' || a === 'pub') return 'bar'; if (/nhậu|ốc|nướng|hải sản|lẩu|bbq/.test(nm)) return 'phonhau'; if (a === 'restaurant') return 'nhahang'; return 'phonhau'; }
const SIZE = { beerclub: 12, bar: 10, karaoke: 9, phonhau: 10, nhahang: 8, sanbong: 11 };
function normQuan(d) {
  d = (d || '').trim(); if (!d) return null;
  if (/bình tân|binh tan/i.test(d)) return 'Bình Tân'; if (/bình thạnh|binh thanh/i.test(d)) return 'Bình Thạnh';
  if (/phú nhuận|phu nhuan/i.test(d)) return 'Phú Nhuận'; if (/tân bình|tan binh/i.test(d)) return 'Tân Bình';
  if (/tân phú|tan phu/i.test(d)) return 'Tân Phú'; if (/gò vấp|go vap/i.test(d)) return 'Gò Vấp';
  if (/thủ đức|thu duc/i.test(d)) return 'TP Thủ Đức';
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

async function fetchOverpass() {
  const eps = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter'];
  for (const ep of eps) {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 50000);
      const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': 'roadai-driverradar/1.0' }, body: Q, signal: ctl.signal });
      clearTimeout(to);
      const txt = await r.text();
      if (txt.trim()[0] === '{') return JSON.parse(txt).elements || [];
    } catch (e) { /* thử mirror kế */ }
  }
  return null;
}

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
  const near = (a, b) => hav(a[2], a[3], b[2], b[3]) < 150;
  rows = rows.filter(r => !CURATED.some(c => near(r, c)));
  const seen = new Set(); rows = rows.filter(r => { const k = r[0].toLowerCase() + '|' + r[2].toFixed(3) + ',' + r[3].toFixed(3); if (seen.has(k)) return false; seen.add(k); return true; });
  const bucket = {}; rows = rows.filter(r => { const k = r[2].toFixed(3) + ',' + r[3].toFixed(3); bucket[k] = (bucket[k] || 0) + 1; return bucket[k] <= 3; });
  const pri = { beerclub: 0, bar: 1, karaoke: 2, phonhau: 3, nhahang: 4, sanbong: 5 };
  rows.sort((a, b) => pri[a[1]] - pri[b[1]] || b[4] - a[4]);
  const perQ = {}; rows = rows.filter(r => { perQ[r[6]] = (perQ[r[6]] || 0) + 1; return perQ[r[6]] <= 16; });
  rows = rows.slice(0, 130);
  return CURATED.concat(rows);
}

export default async function handler(req, res) {
  try {
    const els = await fetchOverpass();
    if (!els) { res.setHeader('Cache-Control', 'public, s-maxage=600'); return res.status(200).json({ ok: false, reason: 'overpass_unavailable' }); }
    const all = process(els);
    // TỰ KIỂM: đủ số lượng + toạ độ trong HCM + đúng nhóm
    const cats = new Set(['phonhau', 'beerclub', 'bar', 'karaoke', 'nhahang', 'sanbong']);
    const ok = all.length >= 120 && all.every(r => r[2] > 10.6 && r[2] < 10.95 && r[3] > 106.5 && r[3] < 106.9 && cats.has(r[1]));
    if (!ok) { res.setHeader('Cache-Control', 'public, s-maxage=600'); return res.status(200).json({ ok: false, reason: 'self_check_failed', count: all.length }); }
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ ok: true, count: all.length, spots: all, source: 'OpenStreetMap · Overpass', updatedAt: new Date().toISOString() });
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(200).json({ ok: false, reason: String((e && e.message) || e) });
  }
}
