/* ══════════════════════════════════════════════════════════════════════════════
   NẠP DANH SÁCH QUÁN NHẬU DO CHỦ APP CUNG CẤP  →  kho dữ liệu chung.

   Chạy:  node scripts/nap-quan.mjs            (tra toạ độ + sinh file, KHÔNG ghi CSDL)
          SB_PAT=sbp_… node scripts/nap-quan.mjs --ghi     (ghi luôn vào Supabase)

   VÀO :  scripts/quan-nhau.csv   — tên quán · địa chỉ · giờ mở-đóng
   RA  :  api/_quanbo.js          — bản tĩnh nằm trong mã nguồn (KHÔNG BAO GIỜ CHẾT)
          scripts/quan-bo.sql     — lệnh nạp vào bảng public.quan_bo

   BỐN NGUYÊN TẮC BẮT BUỘC (đúng luật dữ liệu của app):
   ① KHÔNG BỊA TOẠ ĐỘ. Mỗi quán phải tra được trên bản đồ thật (VietMap). Tra không
      ra → LOẠI HẲN, không ước chừng theo tên quận. Thà thiếu còn hơn chấm sai chỗ,
      vì chấm sai là dẫn tài xế đi lạc lúc nửa đêm.
   ② KHÔNG BỊA TÊN. Tên giữ NGUYÊN VĂN từ danh sách chủ app đưa; toạ độ ghi rõ độ
      chính xác ở trường `prec` để tài xế tự soi.
   ③ LỌC TRÙNG với mọi kho đang có (js/spots.js, butl-partners, learned-spots) và
      trùng trong chính danh sách này. Luật giống hệt app: dưới 60m coi như một chỗ;
      dưới 250m mà tên khớp ≥60% cũng là một chỗ.
   ④ GIỜ MỞ/ĐÓNG LÀ THẬT — đây là thứ quý nhất của danh sách này. App đang phải ƯỚC
      giờ tan quán theo nhóm; có giờ thật thì `gioThat=true`, sóng tan quán tính đúng
      chỗ, và tài xế canh đón đầu được.
   ══════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.RADAR_BASE || 'https://roadai-vn.vercel.app';
const GHI = process.argv.includes('--ghi');
const NGHI = +(process.env.NGHI || 220);           // nghỉ giữa 2 lần hỏi bản đồ (ms)

/* ---------- đọc CSV ---------- */
function docCSV(p) {
  const t = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  const dong = [];
  let o = '', trongNhay = false, hang = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (trongNhay) {
      if (c === '"' && t[i + 1] === '"') { o += '"'; i++; }
      else if (c === '"') trongNhay = false;
      else o += c;
    } else if (c === '"') trongNhay = true;
    else if (c === ',') { hang.push(o); o = ''; }
    else if (c === '\n') { hang.push(o); dong.push(hang); hang = []; o = ''; }
    else if (c !== '\r') o += c;
  }
  if (o || hang.length) { hang.push(o); dong.push(hang); }
  return dong.filter(h => h.length >= 2 && h.some(x => x.trim()));
}

/* ---------- giờ mở / đóng ----------
   "15:30-1:00" → mở 15.5, đóng 1.0 ; "6:00-13:00, 16:00-1:00" → lấy CA TỐI (ca cuối)
   "24/7" → mở 0, đóng 24 ; "17:00-23:00 (T2-T7)" → bỏ phần ghi chú trong ngoặc
   Không đọc được → trả null, app tự ước theo nhóm quán như cũ (không bịa). */
function docGio(s) {
  const t = String(s || '').trim();
  if (!t || t === '—' || t === '-') return null;
  if (/24\s*\/\s*7/.test(t)) return { mo: 0, dong: 24, ca: '24/7' };
  const ca = t.replace(/\([^)]*\)/g, '').split(',').map(x => x.trim()).filter(Boolean);
  const cuoi = ca[ca.length - 1];                       // ca cuối = ca tối, thứ nghề lái hộ cần
  const m = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/.exec(cuoi || '');
  if (!m) return null;
  const mo = +m[1] + +m[2] / 60;
  let dong = +m[3] + +m[4] / 60;
  if (dong <= mo) dong += 0;                            // qua nửa đêm: app tự cộng 24 khi so sánh
  if (mo < 0 || mo >= 24 || dong < 0 || dong > 24) return null;
  return { mo: +mo.toFixed(2), dong: +dong.toFixed(2), ca: cuoi };
}

/* ---------- nhóm quán theo tên (dùng chính luật của app) ---------- */
const NAME_CAT = [
  [/tiệc cưới|hội nghị|wedding|palace|trung tâm tiệc|hội trường/i, 'tieccuoi'],
  [/karaoke|icool|\bktv\b/i, 'karaoke'],
  [/beer ?club|bia hơi|bia tươi|brewing|brewery|beer garden|tiệm bia|bia lạnh|bia sốt|bia tuyết/i, 'beerclub'],
  [/\bbar\b|\bpub\b|lounge|cocktail|whisky|rooftop|izakaya/i, 'bar'],
  [/nhậu|lẩu|nướng|hải sản|ẩm thực|quán ốc|^ốc |quán dê|dê núi|dê tươi|bò tơ|bê thui|bbq|grill|beer|bia/i, 'phonhau'],
];
function nhom(ten) {
  for (const [re, c] of NAME_CAT) if (re.test(ten)) return c;
  return 'nhahang';
}
const SIZE = { beerclub: 12, bar: 10, karaoke: 9, phonhau: 10, nhahang: 8, tieccuoi: 8 };

/* ---------- lọc trùng: dùng ĐÚNG luật sameSpot() của app ---------- */
const R = 6371000, toR = d => d * Math.PI / 180;
const hav = (a, b) => { const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s)); };
/* TỪ CHUNG PHẢI LOẠI TRƯỚC KHI SO TÊN.
   Đo thật: "Quán Nhậu Hùng 33" bị coi là trùng "Quán nhậu · 357-359 Hoàng Sa" chỉ
   vì hai chữ "quán" + "nhậu" — mà chữ đó có trong gần như MỌI tên quán nhậu. Gộp
   kiểu đó là mất trắng quán thật. Chỉ so những từ RIÊNG của tên. */
const TU_CHUNG = new Set(['quan', 'nhau', 'nha', 'hang', 'bia', 'hoi', 'lau', 'nuong', 'oc',
  'hai', 'san', 'thuc', 'tiem', 'food', 'beer', 'bbq', 'grill', 'garden', 'restaurant',
  'ngon', 'dan', 'vuon', 'com', 'buffet', 'hotpot', 'and', 'the']);
const tuKhoa = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
const tuRieng = s => tuKhoa(s).filter(w => !TU_CHUNG.has(w));
/* NGƯỠNG 35m, ĐÚNG BẰNG sameSpot() TRONG APP — không được nới rộng.
   Thử ở 60m: mất trắng "Ốc Oanh", "Quán Ốc Vũ", "Thế Giới Bò" vì chúng nằm cùng
   phố nhậu Vĩnh Khánh với Chilli BBQ. Phố nhậu Sài Gòn (Vĩnh Khánh, Hoàng Sa,
   Trường Sa) quán san sát nhau vài chục mét — nới ngưỡng là xoá sạch đúng những
   chỗ tài xế cần nhất. */
function cungCho(a, b) {
  const d = hav(a, b);
  if (d < 35) return true;
  if (d > 250) return false;
  const ka = tuRieng(a.name), kb = tuRieng(b.name);
  if (!ka.length || !kb.length) return false;  // toàn từ chung → không đủ căn cứ, giữ cả hai
  return ka.filter(w => kb.includes(w)).length / Math.min(ka.length, kb.length) >= 0.6;
}

/* TÊN QUẬN/PHƯỜNG — app dùng để nhóm thống kê và hiện dưới tên quán ("Bình Tân · 4,3 km").
   Cắt bừa đoạn cuối địa chỉ là ra rỗng, vì phần lớn địa chỉ kết thúc bằng
   "Hồ Chí Minh 700000". Bỏ mọi đoạn là TP/mã bưu điện rồi lấy đoạn cuối CÒN LẠI;
   hết cách mới lấy quận bản đồ trả về. Không đoán, không để trống. */
function quanCua(dc, toa) {
  const doan = String(dc).split(',').map(x => x.trim())
    .filter(x => x && !/^h[ồô]\s*ch[íi]\s*minh/i.test(x) && !/^\d{4,6}$/.test(x)
      && !/^(tp\.?|thành phố)\s*h/i.test(x))
    .map(x => x.replace(/\s*\d{4,6}$/, '').trim())
    .filter(Boolean);
  const cuoi = doan.length > 1 ? doan[doan.length - 1] : '';
  if (cuoi && !/^(đ\.|đường|hẻm|ngõ)/i.test(cuoi)) return cuoi.slice(0, 40);
  const m = /,\s*(Quận[^,]+|Huyện[^,]+|Thành Phố Thủ Đức|Phường[^,]+)/i.exec(toa.diaChiMap || '');
  return m ? m[1].trim().slice(0, 40) : '';
}

/* ---------- kho đang có, để đối chiếu trùng ---------- */
function khoHienCo() {
  const W = {};
  const nap = f => { const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    new Function('window', src + '\n;')(W); };
  nap('js/spots.js'); nap('js/butl-partners.js'); nap('js/learned-spots.js');
  const ra = [];
  for (const r of (W.LAIHO_SPOTS || [])) ra.push({ name: r[0], lat: r[2], lng: r[3] });
  for (const r of (W.BUTL_SPOTS || [])) ra.push({ name: r[0], lat: r[2], lng: r[3] });
  for (const r of (W.LEARNED_SPOTS || [])) ra.push({ name: r[0], lat: r[2], lng: r[3] });
  return ra;
}

/* ---------- tra toạ độ THẬT qua proxy VietMap của chính app ---------- */
const HCM = { lat: 10.7769, lng: 106.7009 };
const TRONG_HCM = (la, lo) => la > 10.35 && la < 11.20 && lo > 106.30 && lo < 107.05;
const nghi = ms => new Promise(r => setTimeout(r, ms));
async function vm(pathApi, params) {
  const u = new URL(BASE + '/api/vietmap');
  u.searchParams.set('path', pathApi);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { Referer: BASE + '/kiem-cuoc', 'User-Agent': 'RoadAI-nap-quan/1.0' } });
  if (!r.ok) throw new Error('vietmap ' + r.status);
  return r.json();
}
/* ═══ TRA TOẠ ĐỘ — CÓ ĐỐI CHIẾU, KHÔNG TIN BỪA KẾT QUẢ ĐẦU TIÊN ═══
   Đo thật: hỏi "Quán Nhậu Hùng 33, 111C Hoàng Sa, Tân Định" thì VietMap khớp tên
   mù quáng và trả về "Quán Nhậu Hùng Mập" ở… TỈNH QUẢNG NGÃI. Tin kết quả đầu là
   cắm chấm sai cả trăm cây số.
   Vì vậy mọi ứng viên phải qua 2 cửa:
     · nằm trong khung TP.HCM;
     · TÊN ĐƯỜNG trong địa chỉ bản đồ phải khớp tên đường mình đang hỏi.
   Và độ chính xác ghi ĐÚNG SỰ THẬT ba mức:
     'chuẩn'            bản đồ có đúng POI mang tên quán
     'đúng số nhà'      tra ra số nhà trên đúng đường
     'đúng đường ±500m' chỉ tra được con đường (app hiện nguyên chữ này cho tài xế) */
const boDau = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// "111C Hoàng Sa, Tân Định" → "hoang sa"  (bỏ số nhà, bỏ chữ "Đường")
function duongCua(dc) {
  let d = String(dc || '').split(',')[0];
  d = d.replace(/^[\d/\-a-zA-Z]{1,12}\s+/, '').replace(/^(Đ\.|Đường|Hẻm|Ngõ)\s+/i, '');
  return boDau(d);
}
/* Khớp tên cũng phải bỏ từ chung: "Quán Nhậu X" mà khớp "Quán Nhậu Y" chỉ nhờ hai
   chữ "quán nhậu" thì chấm sẽ cắm vào quán khác hẳn. Phủ ≥60% TỪ RIÊNG mình đang hỏi. */
const khopTen = (canHoi, mapTra) => {
  const a = tuRieng(canHoi), b = boDau(mapTra);
  if (!a.length) return false;
  return a.filter(w => b.includes(w)).length / a.length >= 0.6;
};
async function hoiMap(text, duong) {
  let ds;
  try { ds = await vm('autocomplete/v3', { text, focus: `${HCM.lat},${HCM.lng}` }); }
  catch (e) { await nghi(1200); return null; }
  await nghi(NGHI);
  if (!Array.isArray(ds) || !ds.length) return null;
  // lọc thô cho rẻ: phải là TP.HCM và phải đúng con đường
  const ung = ds.filter(f => f && f.ref_id &&
    /hồ chí minh/i.test(String(f.address || '')) &&
    (!duong || boDau(String(f.address || '') + ' ' + String(f.name || '')).includes(duong)));
  for (const f of ung.slice(0, 2)) {
    let p;
    try { p = await vm('place/v3', { refid: f.ref_id }); } catch (e) { await nghi(1200); continue; }
    await nghi(NGHI);
    const la = +(p && p.lat), lo = +(p && p.lng);
    if (!isFinite(la) || !isFinite(lo) || !TRONG_HCM(la, lo)) continue;
    return { lat: +la.toFixed(5), lng: +lo.toFixed(5), hsNum: String((p && p.hs_num) || '').trim(),
      ten: String(f.name || ''), diaChiMap: String((p && (p.display || p.address)) || '').trim() };
  }
  return null;
}
/* BỘ NHỚ ĐỆM TOẠ ĐỘ — tra bản đồ là phần chậm nhất (~4 phút cho 195 quán) và
   là phần tốn hạn mức API. Nhớ lại theo "tên|địa chỉ" để chạy lại chỉ mất vài
   giây, và để chỉnh luật lọc trùng mà không phải hỏi bản đồ lần nữa. */
const CACHE_F = path.join(ROOT, 'scripts/.toado-cache.json');
const CACHE = fs.existsSync(CACHE_F) ? JSON.parse(fs.readFileSync(CACHE_F, 'utf8')) : {};
let cacheDoi = 0;
const luuCache = () => { if (cacheDoi) fs.writeFileSync(CACHE_F, JSON.stringify(CACHE, null, 0), 'utf8'); };

async function traToaDo(ten, dc) {
  const ck = ten + '|' + dc;
  if (Object.prototype.hasOwnProperty.call(CACHE, ck)) return CACHE[ck];
  const kq = await traToaDoThat(ten, dc);
  CACHE[ck] = kq; cacheDoi++;
  if (cacheDoi % 10 === 0) luuCache();
  return kq;
}
async function traToaDoThat(ten, dc) {
  const goc = String(dc).replace(/,?\s*Hồ Chí Minh[^,]*$/i, '').trim();
  const dcHCM = goc + ', Hồ Chí Minh';
  const duong = duongCua(dc);
  // ① tên quán + địa chỉ → nếu bản đồ có đúng POI mang tên đó thì chuẩn nhất
  const a = await hoiMap(`${ten}, ${dcHCM}`, duong);
  if (a && khopTen(ten, a.ten)) return { ...a, prec: 'chuẩn' };
  // ② chỉ địa chỉ → ít nhất cũng đúng đường, có số nhà thì càng tốt
  const b = await hoiMap(dcHCM, duong);
  if (b) return { ...b, prec: b.hsNum ? 'đúng số nhà' : 'đúng đường ±500m' };
  // ③ ứng viên ở bước ① không khớp tên nhưng đúng đường & trong TP → vẫn dùng được
  if (a) return { ...a, prec: 'đúng đường ±500m' };
  return null;
}

/* ═══════════════════════ CHẠY ═══════════════════════ */
const rows = docCSV(path.join(ROOT, 'scripts/quan-nhau.csv')).slice(1);
console.log(`Đọc ${rows.length} quán từ danh sách.\n`);

const co = khoHienCo();
console.log(`Kho đang có ${co.length} điểm để đối chiếu trùng.\n`);

const ok = [], loai = { khongTra: [], trungKho: [], trungNhau: [], thieu: [] };
let i = 0;
for (const [ten0, dc0, gio0] of rows) {
  i++;
  const ten = String(ten0 || '').trim(), dc = String(dc0 || '').trim();
  if (!ten || !dc) { loai.thieu.push(ten || '(trống)'); continue; }

  const toa = await traToaDo(ten, dc);
  if (!toa) { loai.khongTra.push(ten); process.stdout.write(`\r[${i}/${rows.length}] ✗ ${ten.slice(0, 40)}`.padEnd(80)); continue; }

  const nay = { name: ten, lat: toa.lat, lng: toa.lng };
  const dungKho = co.find(x => cungCho(x, nay));
  if (dungKho) { loai.trungKho.push(`${ten} ≈ ${dungKho.name}`); process.stdout.write(`\r[${i}/${rows.length}] ↺ ${ten.slice(0, 40)}`.padEnd(80)); continue; }
  const dungNay = ok.find(x => cungCho(x, nay));
  if (dungNay) { loai.trungNhau.push(`${ten} ≈ ${dungNay.name}`); process.stdout.write(`\r[${i}/${rows.length}] ↺ ${ten.slice(0, 40)}`.padEnd(80)); continue; }

  const cat = nhom(ten), g = docGio(gio0);
  ok.push({ name: ten, cat, lat: toa.lat, lng: toa.lng, size: SIZE[cat] || 9,
    quan: quanCua(dc, toa),
    addr: dc, prec: toa.prec, gioMo: g ? g.mo : null, gioDong: g ? g.dong : null, gioText: g ? g.ca : '' });
  process.stdout.write(`\r[${i}/${rows.length}] ✓ ${ten.slice(0, 40)}`.padEnd(80));
}
luuCache();
console.log('\n');

/* ---------- kết quả ---------- */
const coGio = ok.filter(x => x.gioDong != null).length;
console.log('═'.repeat(60));
console.log(`  NHẬN   ${ok.length} quán  (${coGio} quán có GIỜ ĐÓNG THẬT)`);
console.log(`  LOẠI   ${loai.khongTra.length} không tra được toạ độ`);
console.log(`         ${loai.trungKho.length} trùng kho đang có`);
console.log(`         ${loai.trungNhau.length} trùng nhau trong danh sách`);
console.log(`         ${loai.thieu.length} thiếu tên/địa chỉ`);
console.log('═'.repeat(60));
for (const k of ['trungKho', 'trungNhau']) if (loai[k].length) console.log(`\n[${k}]\n  ` + loai[k].slice(0, 20).join('\n  '));
if (loai.khongTra.length) console.log(`\n[không tra được toạ độ — LOẠI HẲN, không ước chừng]\n  ` + loai.khongTra.slice(0, 30).join('\n  '));

/* ---------- ① bản TĨNH trong mã nguồn: không bao giờ chết ---------- */
// [tên, nhóm, lat, lng, size, homeKm, quận, nguồn, pid, địa chỉ, độ chính xác, evi, giờ mở, giờ đóng]
const dongJS = x => JSON.stringify([x.name, x.cat, x.lat, x.lng, x.size, 7, x.quan, 'ds', null,
  x.addr, x.prec, '', x.gioMo, x.gioDong]);
const rev = (() => { let h = 0x811c9dc5; const s = JSON.stringify(ok.map(dongJS));
  for (let j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return h.toString(36).toUpperCase().padStart(7, '0').slice(-7); })();

fs.writeFileSync(path.join(ROOT, 'api/_quanbo.js'), `/* RoadAI · Driver Radar — QUÁN NHẬU BỔ SUNG (danh sách chủ app cung cấp).
   ⚠️ FILE NÀY DO MÁY SINH RA. Sửa tay là mất khi chạy lại.
   Sinh lại:  node scripts/nap-quan.mjs        (nguồn: scripts/quan-nhau.csv)

   ${ok.length} quán · ${coGio} quán có GIỜ ĐÓNG THẬT · mã bản #${rev}
   Toạ độ tra bằng VietMap; quán nào bản đồ không tra ra thì LOẠI HẲN chứ không
   ước chừng theo quận — chấm sai chỗ là dẫn tài xế đi lạc lúc nửa đêm.
   Đây là bản DỰ PHÒNG nằm sẵn trong mã nguồn: Supabase có ngủ hay chết thì
   /api/quan vẫn trả đủ danh sách này, tài xế không bao giờ mất dữ liệu.
   [tên, nhóm, lat, lng, size, homeKm, quận, nguồn, pid, địa chỉ, prec, evi, giờ mở, giờ đóng] */
export const QUANBO_REV = '${rev}';
export const QUANBO_SO = ${ok.length};
export const QUANBO = [
${ok.map(x => '  ' + dongJS(x) + ',').join('\n')}
];
`, 'utf8');
console.log(`\n✓ api/_quanbo.js — ${ok.length} quán · mã bản #${rev}`);

/* ---------- ② lệnh SQL nạp vào Supabase ---------- */
const esc = s => String(s == null ? '' : s).replace(/'/g, "''");
const sql = `-- RoadAI · nạp danh sách quán nhậu chủ app cung cấp (máy sinh, mã bản #${rev})
create table if not exists public.quan_bo (
  id      text primary key,
  ten     text not null,
  nhom    text not null,
  lat     double precision not null,
  lng     double precision not null,
  size    int  not null default 9,
  quan    text,
  dia_chi text,
  prec    text,
  gio_mo   double precision,
  gio_dong double precision,
  nguon   text not null default 'ds',
  updated_at timestamptz not null default now()
);
create index if not exists quan_bo_viTri_idx on public.quan_bo (lat, lng);
alter table public.quan_bo enable row level security;
revoke all on public.quan_bo from anon, authenticated;

insert into public.quan_bo (id, ten, nhom, lat, lng, size, quan, dia_chi, prec, gio_mo, gio_dong) values
${ok.map(x => `('${esc(x.lat.toFixed(5) + ',' + x.lng.toFixed(5))}','${esc(x.name)}','${x.cat}',${x.lat},${x.lng},${x.size},'${esc(x.quan)}','${esc(x.addr)}','${esc(x.prec)}',${x.gioMo == null ? 'null' : x.gioMo},${x.gioDong == null ? 'null' : x.gioDong})`).join(',\n')}
on conflict (id) do update set
  ten=excluded.ten, nhom=excluded.nhom, size=excluded.size, quan=excluded.quan,
  dia_chi=excluded.dia_chi, prec=excluded.prec, gio_mo=excluded.gio_mo,
  gio_dong=excluded.gio_dong, updated_at=now();
`;
fs.writeFileSync(path.join(ROOT, 'scripts/quan-bo.sql'), sql, 'utf8');
console.log(`✓ scripts/quan-bo.sql`);

/* ---------- ③ ghi thẳng vào Supabase ---------- */
if (GHI) {
  const PAT = (process.env.SB_PAT || '').trim();
  const REF = (process.env.SB_REF || 'incugzqdezergjzxwote').trim();
  if (!PAT) { console.log('\n(bỏ qua ghi CSDL: thiếu SB_PAT)'); process.exit(0); }
  console.log('\nĐang ghi vào Supabase…');
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + PAT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const txt = await r.text();
  if (!r.ok) { console.error('✗ lỗi ' + r.status + ': ' + txt.slice(0, 300)); process.exit(1); }
  console.log(`✓ Đã ghi ${ok.length} quán vào public.quan_bo`);
}
