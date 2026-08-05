// ============================================================================
// js/xsmn-brain.js — BỘ NÃO TỰ HỌC cho Xổ số Miền Nam. HAI ĐƯỜNG: LÔ và ĐỀ.
//
// Khác hoàn toàn cách cũ (đếm tần suất → lấy top-2 → hết). Ở đây mỗi đường có một
// DÀN CHIẾN LƯỢC chạy song song, mỗi kỳ đều bị chấm điểm bằng kết quả THẬT, và trọng
// số của nhánh được cập nhật theo LUẬT NHÂN (multiplicative weights / Hedge):
//
//        w ← w · e^(η·thưởng)      → nhánh tốt lên theo cấp SỐ NHÂN, nhánh dở tắt dần
//
// Trên nữa là BANDIT (UCB) tự chọn nhánh nào ra trận cho TỪNG ĐÀI — vì mỗi đài có
// lịch sử riêng, cái hợp Tây Ninh chưa chắc hợp An Giang.
//
// Bốn lớp bảo vệ chống tự lừa mình (thiếu lớp nào cũng thành công cụ dò số vớ vẩn):
//   1. WALK-FORWARD: đứng ở ngày D, não chỉ nhìn dữ liệu < D, ra số, rồi mới mở đáp án.
//   2. BASELINE CHÍNH XÁC: xác suất ngẫu nhiên tính bằng công thức tổ hợp cho từng kỳ.
//   3. HOLM: chỉnh đa so sánh — lấy nhánh tốt nhất trong ~16 nhánh thì p thô luôn đẹp.
//   4. HOLDOUT: chọn nhà vô địch bằng 75% đầu, đo lại trên 25% cuối chưa từng đụng tới.
//
// SỰ THẬT phải nói trước: xổ số công bằng thì KHÔNG nhánh nào vượt được ngẫu nhiên về
// kỳ vọng. Cái máy này học được là "chọn đúng nhánh tốt nhất" và "chứng minh bằng số
// liệu đo được" — nó KHÔNG tạo ra lợi thế thắng tiền.
// ============================================================================

const N = 100;
const f64 = () => new Float64Array(N);
const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// Toán thống kê nền
// ---------------------------------------------------------------------------
function erfc(x) { // Numerical Recipes 6.2 — sai số < 1.2e-7, quá đủ.
  const z = Math.abs(x), t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const pTwoSided = (z) => erfc(Math.abs(z) / Math.SQRT2);

// Khoảng tin cậy Wilson 95% — đúng cả khi mẫu nhỏ (khác hẳn ±1.96·√(p(1−p)/n)).
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n);
  const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

// Xác suất CHÍNH XÁC để một bộ K số cố định trúng ≥1 trong d giá trị phân biệt:
//   1 − C(100−d, K)/C(100, K).  Với ĐỀ thì d = 1 nên rút gọn thành K/100.
export function randomHitProb(distinct, K) {
  let miss = 1;
  for (let j = 0; j < K; j++) {
    const num = N - distinct - j;
    if (num <= 0) return 1;
    miss *= num / (N - j);
  }
  return 1 - miss;
}

// Holm–Bonferroni: lấy "nhánh tốt nhất trong 16" thì p thô bị thổi phồng; Holm trả về
// p đã chỉnh, giữ sai lầm loại I ở mức 5% cho CẢ HỌ nhánh chứ không phải từng nhánh.
function holm(pvals) {
  const idx = pvals.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(pvals.length); let prev = 0;
  for (let r = 0; r < idx.length; r++) {
    const [p, i] = idx[r];
    prev = Math.max(prev, Math.min(1, p * (idx.length - r)));
    out[i] = prev;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Biến đổi số dân gian (bóng / lộn / tổng) — KHÔNG phải chân lý, mà là GIẢ THUYẾT
// đưa vào để máy tự kiểm chứng bằng dữ liệu. Vô dụng thì trọng số sẽ tự tắt.
// ---------------------------------------------------------------------------
const bong = (v) => ((Math.floor(v / 10) + 5) % 10) * 10 + (v % 10 + 5) % 10;
const lon = (v) => (v % 10) * 10 + Math.floor(v / 10);
const digitSum = (v) => (Math.floor(v / 10) + v % 10) % 10;

// PRNG tất định cho nhánh đối chứng (cùng ngày + cùng đài ⇒ cùng số, tái lập được).
function hashSeed(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h || 1; }
function randScore(seedStr) {
  const o = f64(); let x = hashSeed(seedStr);
  for (let i = 0; i < N; i++) { x = (Math.imul(1103515245, x) + 12345) >>> 0; o[i] = x / 4294967296; }
  return o;
}

// ---------------------------------------------------------------------------
// TRẠNG THÁI — cập nhật tăng dần theo từng kỳ (O(100)/kỳ), không tính lại từ đầu.
// ---------------------------------------------------------------------------
function newProv(name, code) {
  return {
    name, code, n: 0,
    app: f64(),                      // số KỲ có mặt trong lô (đơn vị đúng với thước đo "về")
    de: f64(),                       // số kỳ nổ ĐUÔI (2 số cuối giải Đặc Biệt)
    dau: f64(),                      // số kỳ nổ ĐẦU (2 số giải Tám)
    last: new Int32Array(N).fill(-1),
    deLast: new Int32Array(N).fill(-1),
    dauLast: new Int32Array(N).fill(-1),
    ewF: f64(), ewS: f64(), deEw: f64(), dauEw: f64(),
    prev: null, prevDe: -1, prevDau: -1,
  };
}
function newState() {
  return {
    n: 0, app: f64(), de: f64(), dau: f64(),
    last: new Int32Array(N).fill(-1), deLast: new Int32Array(N).fill(-1), dauLast: new Int32Array(N).fill(-1),
    wd: Array.from({ length: 7 }, f64), deWd: Array.from({ length: 7 }, f64),
    dauWd: Array.from({ length: 7 }, f64), wdN: new Float64Array(7),
    prov: new Map(),
  };
}
function getProv(S, slug, name, code) {
  let pv = S.prov.get(slug);
  if (!pv) { pv = newProv(name, code); S.prov.set(slug, pv); }
  return pv;
}

const NEG = (a) => { const o = f64(); for (let i = 0; i < N; i++) o[i] = -a[i]; return o; };
const gapArr = (last, n) => { const o = f64(); for (let i = 0; i < N; i++) o[i] = last[i] < 0 ? n + 20 : n - last[i]; return o; };
function bongScore(prevDe) {
  const o = f64();
  if (prevDe >= 0) { o[bong(prevDe)] += 3; o[lon(prevDe)] += 2; o[bong(lon(prevDe))] += 1.5; o[prevDe] += 1; }
  return o;
}
function tongScore(prevDe) {
  const o = f64(); if (prevDe < 0) return o;
  const t = digitSum(prevDe);
  for (let i = 0; i < N; i++) if (digitSum(i) === t) o[i] = 1;
  return o;
}
const kepScore = () => { const o = f64(); for (let i = 0; i < N; i++) if (i % 11 === 0) o[i] = 1; return o; };

// ---------------------------------------------------------------------------
// ĐƯỜNG 1 — LÔ: 16 nhánh. Chỉ THỨ HẠNG có ý nghĩa, thang điểm không cần so nhau.
// ---------------------------------------------------------------------------
export const LO_STRATS = [
  { key: 'hotG', name: 'Nóng toàn miền', desc: 'Cặp về nhiều nhất trên mọi đài', score: (S) => S.app },
  { key: 'hotP', name: 'Nóng theo đài', desc: 'Cặp về nhiều nhất của riêng đài này', score: (S, c) => c.pv.app },
  { key: 'coldG', name: 'Nguội toàn miền', desc: 'Cặp về ít nhất trên mọi đài', score: (S) => NEG(S.app) },
  { key: 'coldP', name: 'Nguội theo đài', desc: 'Cặp về ít nhất của riêng đài này', score: (S, c) => NEG(c.pv.app) },
  { key: 'gan', name: 'Gan lâu chưa về', desc: 'Lâu nhất chưa xuất hiện ở đài này', score: (S, c) => gapArr(c.pv.last, c.pv.n) },
  { key: 'ganNgan', name: 'Vừa mới về', desc: 'Mới xuất hiện gần đây nhất', score: (S, c) => NEG(gapArr(c.pv.last, c.pv.n)) },
  { key: 'ewF', name: 'Xu hướng nhanh', desc: 'Trung bình mũ ~14 kỳ gần nhất của đài', score: (S, c) => c.pv.ewF },
  { key: 'ewS', name: 'Xu hướng chậm', desc: 'Trung bình mũ ~40 kỳ gần nhất của đài', score: (S, c) => c.pv.ewS },
  {
    key: 'bayes', name: 'Bayes co ngót', desc: 'Tỉ lệ đài co về tỉ lệ toàn miền (chống nhiễu mẫu nhỏ)',
    score: (S, c) => { const o = f64(), tau = 25, gN = Math.max(1, S.n); for (let i = 0; i < N; i++) o[i] = (c.pv.app[i] + tau * (S.app[i] / gN)) / (c.pv.n + tau); return o; },
  },
  { key: 'echo', name: 'Lặp kỳ trước', desc: 'Số đã về ngay kỳ trước của đài này', score: (S, c) => { const o = f64(); if (c.pv.prev) for (const i of c.pv.prev) o[i] = 1; return o; } },
  { key: 'antiEcho', name: 'Né kỳ trước', desc: 'Số KHÔNG về ở kỳ trước của đài này', score: (S, c) => { const o = f64().fill(1); if (c.pv.prev) for (const i of c.pv.prev) o[i] = 0; return o; } },
  { key: 'bong', name: 'Bóng / lộn của ĐỀ', desc: 'Biến đổi dân gian từ ĐỀ kỳ trước của đài', score: (S, c) => bongScore(c.pv.prevDe) },
  { key: 'tong', name: 'Tổng của ĐỀ', desc: 'Cặp có tổng chữ số trùng tổng ĐỀ kỳ trước', score: (S, c) => tongScore(c.pv.prevDe) },
  { key: 'wd', name: 'Theo thứ trong tuần', desc: 'Tần suất riêng của thứ mà đài này quay', score: (S, c) => S.wd[c.wd] },
  { key: 'kep', name: 'Ưu tiên lô kép', desc: '00,11,…,99 rồi mới tới số nóng', score: () => kepScore() },
  { key: 'rand', name: 'Ngẫu nhiên (đối chứng)', desc: 'Bốc số mù — thước đo sự thật cho các nhánh kia', score: (S, c) => randScore('L' + c.date + '|' + c.slug) },
];

// ---------------------------------------------------------------------------
// ĐƯỜNG 2 — ĐỀ (2 số cuối giải Đặc Biệt): 13 nhánh. Đây là thứ anh thật sự mua.
// ---------------------------------------------------------------------------
export const DE_STRATS = [
  { key: 'deHotG', name: 'Đề nóng toàn miền', desc: 'Số nổ đề nhiều nhất trên mọi đài', score: (S) => S.de },
  { key: 'deHotP', name: 'Đề nóng theo đài', desc: 'Số nổ đề nhiều nhất của riêng đài này', score: (S, c) => c.pv.de },
  { key: 'deColdG', name: 'Đề nguội toàn miền', desc: 'Số ít nổ đề nhất trên mọi đài', score: (S) => NEG(S.de) },
  { key: 'deColdP', name: 'Đề nguội theo đài', desc: 'Số ít nổ đề nhất của riêng đài này', score: (S, c) => NEG(c.pv.de) },
  { key: 'deGan', name: 'Đề gan (lâu chưa nổ)', desc: 'Lâu nhất chưa nổ đề ở đài này', score: (S, c) => gapArr(c.pv.deLast, c.pv.n) },
  {
    key: 'deBayes', name: 'Đề Bayes co ngót', desc: 'Tỉ lệ đề của đài co về tỉ lệ toàn miền',
    score: (S, c) => { const o = f64(), tau = 60, gN = Math.max(1, S.n); for (let i = 0; i < N; i++) o[i] = (c.pv.de[i] + tau * (S.de[i] / gN)) / (c.pv.n + tau); return o; },
  },
  { key: 'deEw', name: 'Đề xu hướng gần', desc: 'Trung bình mũ ~17 kỳ đề gần nhất của đài', score: (S, c) => c.pv.deEw },
  { key: 'deBong', name: 'Bóng / lộn ĐỀ kỳ trước', desc: 'Bóng, lộn, bóng-lộn của đề kỳ trước đài này', score: (S, c) => bongScore(c.pv.prevDe) },
  { key: 'deTong', name: 'Tổng ĐỀ kỳ trước', desc: 'Số có tổng chữ số trùng tổng đề kỳ trước', score: (S, c) => tongScore(c.pv.prevDe) },
  { key: 'deWd', name: 'Đề theo thứ trong tuần', desc: 'Tần suất đề riêng của thứ mà đài này quay', score: (S, c) => S.deWd[c.wd] },
  { key: 'deLo', name: 'Theo lô nóng của đài', desc: 'Dân gian: lô về dày thì đề dễ nổ vào đó', score: (S, c) => c.pv.app },
  { key: 'deKep', name: 'Ưu tiên đề kép', desc: '00,11,…,99 rồi mới tới đề nóng', score: () => kepScore() },
  { key: 'deRand', name: 'Ngẫu nhiên (đối chứng)', desc: 'Bốc số mù — thước đo sự thật cho các nhánh kia', score: (S, c) => randScore('D' + c.date + '|' + c.slug) },
];

// ---------------------------------------------------------------------------
// ĐƯỜNG 3 — ĐẦU (2 số giải Tám). Cùng dạng bài toán với ĐUÔI: đáp án DUY NHẤT một
// cặp 00–99 mỗi kỳ. Nhưng lịch sử của ĐẦU và ĐUÔI là hai chuỗi độc lập nhau, nên phải
// có dàn nhánh riêng và bộ đếm riêng — dùng chung số liệu của ĐUÔI là gán cho ĐẦU một
// thành tích nó chưa từng lập.
// ---------------------------------------------------------------------------
export const DAU_STRATS = [
  { key: 'dauHotG', name: 'Đầu nóng toàn miền', desc: 'Số nổ đầu nhiều nhất trên mọi đài', score: (S) => S.dau },
  { key: 'dauHotP', name: 'Đầu nóng theo đài', desc: 'Số nổ đầu nhiều nhất của riêng đài này', score: (S, c) => c.pv.dau },
  { key: 'dauColdG', name: 'Đầu nguội toàn miền', desc: 'Số ít nổ đầu nhất trên mọi đài', score: (S) => NEG(S.dau) },
  { key: 'dauColdP', name: 'Đầu nguội theo đài', desc: 'Số ít nổ đầu nhất của riêng đài này', score: (S, c) => NEG(c.pv.dau) },
  { key: 'dauGan', name: 'Đầu gan (lâu chưa nổ)', desc: 'Lâu nhất chưa nổ đầu ở đài này', score: (S, c) => gapArr(c.pv.dauLast, c.pv.n) },
  {
    key: 'dauBayes', name: 'Đầu Bayes co ngót', desc: 'Tỉ lệ đầu của đài co về tỉ lệ toàn miền',
    score: (S, c) => { const o = f64(), tau = 60, gN = Math.max(1, S.n); for (let i = 0; i < N; i++) o[i] = (c.pv.dau[i] + tau * (S.dau[i] / gN)) / (c.pv.n + tau); return o; },
  },
  { key: 'dauEw', name: 'Đầu xu hướng gần', desc: 'Trung bình mũ ~17 kỳ đầu gần nhất của đài', score: (S, c) => c.pv.dauEw },
  { key: 'dauBong', name: 'Bóng / lộn ĐẦU kỳ trước', desc: 'Bóng, lộn, bóng-lộn của đầu kỳ trước đài này', score: (S, c) => bongScore(c.pv.prevDau) },
  { key: 'dauTong', name: 'Tổng ĐẦU kỳ trước', desc: 'Số có tổng chữ số trùng tổng đầu kỳ trước', score: (S, c) => tongScore(c.pv.prevDau) },
  { key: 'dauTheoDe', name: 'Theo ĐUÔI kỳ trước', desc: 'Dân gian: đầu kỳ này bám bóng/lộn của đuôi kỳ trước', score: (S, c) => bongScore(c.pv.prevDe) },
  { key: 'dauWd', name: 'Đầu theo thứ trong tuần', desc: 'Tần suất đầu riêng của thứ mà đài này quay', score: (S, c) => S.dauWd[c.wd] },
  { key: 'dauLo', name: 'Theo lô nóng của đài', desc: 'Cặp về dày trong lô của đài này', score: (S, c) => c.pv.app },
  { key: 'dauKep', name: 'Ưu tiên đầu kép', desc: '00,11,…,99 rồi mới tới đầu nóng', score: () => kepScore() },
  { key: 'dauRand', name: 'Ngẫu nhiên (đối chứng)', desc: 'Bốc số mù — thước đo sự thật cho các nhánh kia', score: (S, c) => randScore('A' + c.date + '|' + c.slug) },
];

export const ENS_KEY = 'ens', BANDIT_KEY = 'bandit';

// Cấu hình hai đường.
//   head = mức K dùng làm tín hiệu HỌC (thưởng cho luật nhân) — cần dày để học nhanh.
//   show = mức K THẬT SỰ đưa cho người chơi.
//
// Tỉ lệ báo ra phải đo ở mức `show`, KHÔNG phải `head`. Trước đây trang web hiện tỉ lệ
// đo ở head (đề 10 số) ngay cạnh dàn 6 số — người đọc tưởng "6 số này về 9%", trong khi
// 9% đó là của một dàn 10 số họ chưa từng thấy. Vì vậy `show` bắt buộc phải nằm trong
// `ks` để có bộ đếm riêng, và mọi con số hiện ra đều lấy từ bộ đếm đó.
// `show: 1` — MỖI ĐƯỜNG CHỈ MỘT SỐ CHỐT.
//
// Anh Tuấn Anh chốt 04/08/2026: chỉ đưa con chính xác nhất, không rải dàn. Cần nói
// thẳng ý nghĩa của con số này, vì nó dễ bị hiểu ngược:
//
//   Chơi 1 số thì tỉ lệ "về" THẤP HƠN chơi 6 số — và bốc mù cũng vậy. Đầu/đuôi 1 số
//   trúng ~1% mỗi kỳ, 6 số ~6%. Rút từ 6 xuống 1 KHÔNG làm máy đoán giỏi hơn; nó chỉ
//   làm bảng số gọn lại và làm mỗi lần trúng nặng ký hơn. Cái quyết định vẫn là chênh
//   lệch so với bốc mù — mà chênh lệch ấy, đo trên 4.316 lượt đài, vẫn bằng không.
//
// `head` (mức học) vẫn giữ dày: học bằng tín hiệu 1-ăn-99 thì gần như kỳ nào cũng nhận
// thưởng 0, luật nhân không có gì để bám. Học ở mức dày, chốt ở mức 1 — hai việc khác nhau.
export const TRACKS = {
  dau: { key: 'dau', label: 'ĐẦU', sub: '2 số giải Tám', strats: DAU_STRATS, ks: [1, 2, 3, 5, 10, 20], head: 10, show: 1, singleAnswer: true },
  de: { key: 'de', label: 'ĐUÔI', sub: '2 số cuối giải Đặc Biệt', strats: DE_STRATS, ks: [1, 2, 3, 5, 6, 10, 20], head: 10, show: 1, singleAnswer: true },
  lo: { key: 'lo', label: 'LÔ', sub: '2 số cuối của cả 18 giải', strats: LO_STRATS, ks: [1, 2, 3, 4, 5, 10], head: 2, show: 1, singleAnswer: false },
};

const KMAX = 24;                 // giữ 24 số/nhánh để đo được độ phủ tới K = 20
const HEDGE_ETA = 1.2;           // tốc độ học của luật nhân (thưởng dày nên η lớn hơn)
const HEDGE_FLOOR = 0.012;       // rót lại 1.2% về đều — không để nhánh nào chết hẳn
const DISCOUNT = 0.997;          // quên dần quá khứ xa ⇒ bám được nếu nguồn đổi tính chất
const SHRINK_PROV = 40;          // kỳ ảo kéo trung bình đài về trung bình toàn cục
const UCB_C = 0.15;              // thưởng khám phá; lớn hơn thì máy đổi nhánh liên tục vì nhiễu

function rankOrder(score, tie) {
  const idx = new Array(N); for (let i = 0; i < N; i++) idx[i] = i;
  idx.sort((a, b) => (score[b] - score[a]) || (tie ? tie[b] - tie[a] : 0) || (a - b));
  return idx;
}

// Hai bộ đếm TÁCH BẠCH, cố ý:
//   • n/h/expSum/… : đếm nguyên vẹn cả đời → dùng để BÁO CÁO (tỉ lệ, CI, p-value).
//   • dn/dh        : đếm có giảm giá theo thời gian → chỉ dùng cho BANDIT quyết định.
// Trộn hai cái làm một thì tỉ lệ hiện ra sẽ sai vì tử/mẫu không cùng thang.
function newArm(key, name, desc, kind, nk) {
  return {
    key, name, desc, kind, w: 1,
    n: 0, h: 0, expSum: 0, varSum: 0,          // thống kê ở mức K học (head)
    sh: 0, se: 0, sv: 0,                       // thống kê ở mức K CHƠI (show) — cái được báo ra
    dn: 0, dh: 0,
    hK: new Array(nk).fill(0), expK: new Array(nk).fill(0),
    rankSum: 0, rankN: 0,                       // thứ hạng trung bình của đáp án thật
    prov: new Map(),                            // slug → {n, h, dn, dh, sh, se, sv, recent}
    recent: [],                                 // 0/1 gần nhất (tối đa 400) → phong độ
    log: [],                                    // 0/1 CẢ ĐỜI, cùng thứ tự drawLog → holdout
  };
}

// Bandit UCB1 chọn nhánh cho ĐÚNG đài đang xét.
//
// CO NGÓT MẠNH (τ = 40) là có chủ ý: mỗi đài chỉ quay 1 lần/tuần nên sau 1 năm mới có
// ~52 kỳ. Lấy 52 mẫu xếp hạng 16 nhánh thì chênh lệch đọc được gần như toàn nhiễu. Co
// mạnh về mức toàn cục ⇒ máy chỉ tách riêng cho một đài khi đài đó có bằng chứng dày.
function ucbPick(arms, slug, total) {
  let best = null, bv = -Infinity;
  for (const a of arms) {
    if (a.kind === 'meta') continue;
    const ps = a.prov.get(slug) || { dn: 0, dh: 0 };
    const muG = (a.dh + 1) / (a.dn + 2);
    const mu = (ps.dh + SHRINK_PROV * muG) / (ps.dn + SHRINK_PROV);
    const v = mu + UCB_C * Math.sqrt(Math.log(total + 2) / (ps.dn + 1));
    if (v > bv) { bv = v; best = a; }
  }
  return best;
}

// Sinh bộ số của TẤT CẢ nhánh cho một (đài, ngày) trên một đường. Dùng chung cho cả
// lúc chấm điểm walk-forward lẫn lúc ra số thật ⇒ không thể lệch nhau.
function pickAll(S, tr, ctx, total) {
  const orders = tr.base.map((b) => rankOrder(b.st.score(S, ctx), ctx.pv.app));
  const ens = f64(); let wsum = 0;
  for (let s = 0; s < tr.base.length; s++) {
    const w = tr.base[s].arm.w; wsum += w;
    const ord = orders[s];
    for (let r = 0; r < N; r++) ens[ord[r]] += w * (N - r);
  }
  if (wsum > 0) for (let i = 0; i < N; i++) ens[i] /= wsum;
  const ensOrder = rankOrder(ens, ctx.pv.app);

  const picks = new Map(), ranks = new Map();
  tr.base.forEach((b, i) => { picks.set(b.arm.key, orders[i].slice(0, KMAX)); ranks.set(b.arm.key, orders[i]); });
  picks.set(ENS_KEY, ensOrder.slice(0, KMAX)); ranks.set(ENS_KEY, ensOrder);
  const chosen = ucbPick(tr.arms, ctx.slug, total);
  picks.set(BANDIT_KEY, picks.get(chosen.key)); ranks.set(BANDIT_KEY, ranks.get(chosen.key));
  return { picks, ranks, chosen };
}

function absorb(S, slug, name, code, wd, present, de, dau) {
  const pv = getProv(S, slug, name, code);
  for (let i = 0; i < N; i++) { pv.ewF[i] *= 0.88; pv.ewS[i] *= 0.975; pv.deEw[i] *= 0.94; pv.dauEw[i] *= 0.94; }
  for (const i of present) {
    pv.ewF[i] += 1; pv.ewS[i] += 1;
    pv.app[i]++; S.app[i]++; S.wd[wd][i]++;
    pv.last[i] = pv.n; S.last[i] = S.n;
  }
  if (de >= 0) {
    pv.de[de]++; S.de[de]++; S.deWd[wd][de]++; pv.deEw[de] += 1;
    pv.deLast[de] = pv.n; S.deLast[de] = S.n;
  }
  if (dau >= 0) {
    pv.dau[dau]++; S.dau[dau]++; S.dauWd[wd][dau]++; pv.dauEw[dau] += 1;
    pv.dauLast[dau] = pv.n; S.dauLast[dau] = S.n;
  }
  pv.prev = present; pv.prevDe = de; pv.prevDau = dau;
  pv.n++; S.n++; S.wdN[wd]++;
}

// ĐẦU = 2 số cuối giải Tám = phần tử ĐẦU TIÊN của lo2.
//
// parseXSMN ghép các giải theo thứ tự giai8 → giaidb, nên lo2[0] luôn là giải Tám và
// lo2[cuối] luôn là giải Đặc Biệt. Nhờ vậy toàn bộ 1.900 ngày đã nằm trong kho dùng
// được ngay cho đường ĐẦU — không phải crawl lại một trang nào. Đã đối chiếu với
// prizes.giai8 trên dữ liệu thật trước khi dựa vào.
export const dauOf = (p) => (p.lo2 && p.lo2.length ? Number(p.lo2[0]) : -1);

const wdOf = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

function newTrack(cfg) {
  const base = cfg.strats.map((st) => ({ st, arm: newArm(st.key, st.name, st.desc, 'base', cfg.ks.length) }));
  const ens = newArm(ENS_KEY, 'Hợp lực có trọng số', `Gộp thứ hạng ${cfg.strats.length} nhánh theo trọng số đã học`, 'base', cfg.ks.length);
  const bandit = newArm(BANDIT_KEY, '🧠 Bandit tự chọn', 'Tự chọn nhánh mạnh nhất cho TỪNG đài', 'meta', cfg.ks.length);
  const arms = [...base.map((b) => b.arm), ens, bandit];
  return { cfg, base, arms, byKey: new Map(arms.map((a) => [a.key, a])), series: [], drawLog: [], chosen: new Map() };
}

// ---------------------------------------------------------------------------
// CHẠY NÃO trên toàn bộ lịch sử: học tới đâu chấm điểm tới đó, không nhìn trộm.
// ---------------------------------------------------------------------------
export function runBrain(days, { warmupDraws = 30, minProvDraws = 4 } = {}) {
  const asc = [...days].filter((d) => d && d.date && d.provinces && d.provinces.length)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const S = newState();
  const tracks = { dau: newTrack(TRACKS.dau), de: newTrack(TRACKS.de), lo: newTrack(TRACKS.lo) };
  let graded = 0;

  for (const d of asc) {
    const wd = wdOf(d.date);
    const pending = [];
    for (const p of d.provinces) {
      const slug = p.slug || p.province;
      const present = [...new Set(p.lo2.map(Number))];
      const de = Number(p.de);
      const dau = dauOf(p);
      const pv = getProv(S, slug, p.province, p.code || '');

      if (S.n >= warmupDraws && pv.n >= minProvDraws && present.length && de >= 0 && de < N) {
        const ctx = { slug, pv, wd, date: d.date };
        // Đáp án của mỗi đường: LÔ = 18 số về, ĐUÔI = đúng 1 số, ĐẦU = đúng 1 số.
        gradeTrack(tracks.lo, S, ctx, new Set(present), present.length);
        gradeTrack(tracks.de, S, ctx, new Set([de]), 1);
        if (dau >= 0 && dau < N) gradeTrack(tracks.dau, S, ctx, new Set([dau]), 1);
        graded++;
      }
      pending.push({ slug, name: p.province, code: p.code || '', present, de, dau });
    }
    // Chỉ nạp kiến thức của ngày D SAU khi đã chấm xong cả ngày D ⇒ không rò rỉ.
    for (const q of pending) absorb(S, q.slug, q.name, q.code, wd, q.present, q.de, q.dau);
  }
  return { S, tracks, graded };
}

function gradeTrack(tr, S, ctx, answer, distinct) {
  const cfg = tr.cfg;
  const { picks, ranks, chosen } = pickAll(S, tr, ctx, S.n);
  const pHead = randomHitProb(distinct, cfg.head);
  const pShow = randomHitProb(distinct, cfg.show);
  tr.drawLog.push({ date: ctx.date, slug: ctx.slug, p: pHead });

  for (const [key, list] of picks) {
    const a = tr.byKey.get(key);
    let hit = false;
    for (let j = 0; j < cfg.head; j++) if (answer.has(list[j])) { hit = true; break; }
    // Trúng ở mức CHƠI — đo riêng vì đây mới là dàn số người dùng cầm trên tay.
    let hitS = false;
    for (let j = 0; j < cfg.show; j++) if (answer.has(list[j])) { hitS = true; break; }
    a.n++; a.h += hit ? 1 : 0; a.expSum += pHead; a.varSum += pHead * (1 - pHead);
    a.sh += hitS ? 1 : 0; a.se += pShow; a.sv += pShow * (1 - pShow);
    a.dn++; a.dh += hit ? 1 : 0;
    cfg.ks.forEach((k, ki) => {
      let hk = false; for (let j = 0; j < k; j++) if (answer.has(list[j])) { hk = true; break; }
      if (hk) a.hK[ki]++;
      a.expK[ki] += randomHitProb(distinct, k);
    });
    // Thứ hạng của đáp án thật — thước đo NHẠY hơn tỉ lệ trúng rất nhiều: nếu nhánh có
    // thông tin thật thì hạng phải tụt xuống dưới 50.5 một cách bền bỉ.
    // CHỈ tính cho đường ĐỀ: ở đó đáp án là DUY NHẤT nên dưới giả thuyết vô hiệu hạng
    // phân bố Đều(1..100). Đường LÔ có 16–17 đáp án, hạng nhỏ nhất luôn ~6 kể cả khi bốc
    // mù, mốc 50.5 vô nghĩa — áp vào sẽ ra z ≈ −60 cho MỌI nhánh, một con số rác.
    const ord = ranks.get(key);
    if (cfg.singleAnswer) for (let r = 0; r < N; r++) if (answer.has(ord[r])) { a.rankSum += r + 1; a.rankN++; break; }
    // Bộ đếm RIÊNG TỪNG ĐÀI ở mức chơi. Đây là nguồn của "tỉ lệ chính xác cho từng dự
    // báo": dàn số cho Tiền Giang phải được chấm bằng lịch sử của chính Tiền Giang, chứ
    // không phải bằng tỉ lệ trung bình của cả miền — hai đài khác nhau thì nhánh mạnh
    // khác nhau, gộp chung lại là bôi trơn mất đúng thứ người dùng cần biết.
    let ps = a.prov.get(ctx.slug);
    if (!ps) { ps = { n: 0, h: 0, dn: 0, dh: 0, sh: 0, se: 0, sv: 0, recent: [] }; a.prov.set(ctx.slug, ps); }
    ps.n++; ps.h += hit ? 1 : 0; ps.dn++; ps.dh += hit ? 1 : 0;
    ps.sh += hitS ? 1 : 0; ps.se += pShow; ps.sv += pShow * (1 - pShow);
    ps.recent.push(hitS ? 1 : 0); if (ps.recent.length > 60) ps.recent.shift();
    a.recent.push(hit ? 1 : 0); if (a.recent.length > 400) a.recent.shift();
    a.log.push(hit ? 1 : 0);
    if (key === BANDIT_KEY) tr.series.push({ date: ctx.date, hit: hit ? 1 : 0, p: pHead });
  }

  // ---- HỌC: luật nhân. Thưởng DÀY (không nhị phân) để học nhanh hơn nhiều lần:
  // LÔ đếm bao nhiêu số trong top-10 trúng; ĐỀ dùng thứ hạng của đáp án thật.
  let tot = 0;
  for (const b of tr.base) {
    const ord = ranks.get(b.arm.key);
    let reward;
    if (cfg.key === 'lo') { let c = 0; for (let j = 0; j < 10; j++) if (answer.has(ord[j])) c++; reward = c / 10; }
    else { let r = N; for (let j = 0; j < N; j++) if (answer.has(ord[j])) { r = j + 1; break; } reward = 1 - r / N; }
    b.arm.w *= Math.exp(HEDGE_ETA * reward);
    tot += b.arm.w;
  }
  for (const b of tr.base) b.arm.w = (1 - HEDGE_FLOOR) * (b.arm.w / tot) + HEDGE_FLOOR / tr.base.length;
  for (const a of tr.arms) {
    a.dn *= DISCOUNT; a.dh *= DISCOUNT;
    for (const ps of a.prov.values()) { ps.dn *= DISCOUNT; ps.dh *= DISCOUNT; }
  }
  const cl = tr.chosen.get(ctx.slug) || new Map();
  cl.set(chosen.key, (cl.get(chosen.key) || 0) + 1); tr.chosen.set(ctx.slug, cl);
}

// ---------------------------------------------------------------------------
// KIỂM ĐỊNH GIỮ LẠI (holdout) — phép thử thành thật nhất trong cả hệ.
//
// Chọn nhà vô địch CHỈ bằng 75% dữ liệu đầu, rồi đem đo trên 25% cuối mà nó chưa từng
// được nhìn để chọn. Lợi thế thật thì sống sót; ăn may do lấy max của 16 nhánh thì sụp
// về mức ngẫu nhiên. Không có bước này thì mọi bảng xếp hạng đều là tự lừa mình.
// ---------------------------------------------------------------------------
function holdoutTest(arms, drawLog, frac = 0.75) {
  const T = drawLog.length;
  if (T < 200) return null;
  const cut = Math.floor(T * frac);
  const seg = (log, a, b) => { let h = 0; for (let i = a; i < b; i++) h += log[i]; return h; };
  const expSeg = (a, b) => { let s = 0, v = 0; for (let i = a; i < b; i++) { s += drawLog[i].p; v += drawLog[i].p * (1 - drawLog[i].p); } return { s, v }; };

  const cand = arms.filter((a) => a.kind === 'base' && a.log.length === T);
  if (!cand.length) return null;
  let champ = null, bv = -Infinity;
  for (const a of cand) { const r = seg(a.log, 0, cut) / cut; if (r > bv) { bv = r; champ = a; } }

  const nTest = T - cut, hTest = seg(champ.log, cut, T);
  const e = expSeg(cut, T);
  const [lo, hi] = wilson(hTest, nTest);
  const z = e.v > 0 ? (hTest - e.s) / Math.sqrt(e.v) : 0;
  const testRate = hTest / nTest, testExp = e.s / nTest;
  return {
    arm: champ.key, name: champ.name,
    trainN: cut, trainRate: bv, trainExp: expSeg(0, cut).s / cut,
    testN: nTest, testHits: hTest, testRate, testExp, testEdge: testRate - testExp,
    z, p: pTwoSided(z), ciLo: lo, ciHi: hi,
    survived: testRate > testExp && pTwoSided(z) < 0.05,
    cutDate: drawLog[cut] ? drawLog[cut].date : null,
  };
}

function summarize(tr) {
  const cfg = tr.cfg;
  // Chỉ các nhánh gốc mới nằm trong thang trọng số Hedge (cộng lại = 100%). "Hợp lực"
  // và "Bandit" là nhánh gộp/chọn, không có trọng số riêng — hiện số cho chúng thì
  // người đọc tưởng chúng chiếm 100% thang, sai hoàn toàn.
  const weighted = new Set(tr.base.map((b) => b.arm.key));
  const rows = tr.arms.map((a) => {
    const n = a.n, h = a.h;
    const rate = n ? h / n : 0;
    const expRate = n ? a.expSum / n : 0;
    const z = a.varSum > 0 ? (h - a.expSum) / Math.sqrt(a.varSum) : 0;
    const [lo, hi] = wilson(h, n);
    const rec = a.recent.slice(-120);
    // z của thứ hạng trung bình: dưới null, hạng ~ Đều(1..100) ⇒ TB 50.5, phương sai 833.25.
    const meanRank = a.rankN ? a.rankSum / a.rankN : null;
    const rankZ = a.rankN ? (a.rankSum - 50.5 * a.rankN) / Math.sqrt(833.25 * a.rankN) : null;
    // Mức CHƠI: tỉ lệ này mới là thứ được đưa ra màn hình, nên nó cũng phải có đủ
    // mốc ngẫu nhiên + z + khoảng tin cậy của riêng nó, không mượn số của mức học.
    const showRate = n ? a.sh / n : 0;
    const showExp = n ? a.se / n : 0;
    const showZ = a.sv > 0 ? (a.sh - a.se) / Math.sqrt(a.sv) : 0;
    const [sLo, sHi] = wilson(a.sh, n);
    return {
      key: a.key, name: a.name, desc: a.desc, kind: a.kind,
      n, hits: h, rate, expRate, edge: rate - expRate, z, p: pTwoSided(z),
      showK: cfg.show, showHits: a.sh, showRate, showExp, showEdge: showRate - showExp,
      showZ, showP: pTwoSided(showZ), showCiLo: sLo, showCiHi: sHi,
      ciLo: lo, ciHi: hi, weight: weighted.has(a.key) ? a.w : null,
      meanRank, rankZ, rankP: rankZ == null ? null : pTwoSided(rankZ),
      recentRate: rec.length ? rec.reduce((s, x) => s + x, 0) / rec.length : null, recentN: rec.length,
      coverage: cfg.ks.map((k, i) => ({ k, rate: n ? a.hK[i] / n : 0, expRate: n ? a.expK[i] / n : 0 })),
    };
  });
  const adj = holm(rows.map((r) => r.p));
  rows.forEach((r, i) => { r.pHolm = adj[i]; });
  return rows.sort((a, b) => b.rate - a.rate);
}

// Đường học: chia chuỗi kết quả của bandit thành khối để nhìn thấy tiến bộ — hoặc thấy
// rõ là KHÔNG tiến bộ, cũng là thông tin thật và phải hiện ra.
function learningCurve(series, blocks = 8) {
  if (series.length < blocks * 6) return [];
  const size = Math.floor(series.length / blocks), out = [];
  for (let b = 0; b < blocks; b++) {
    const seg = series.slice(b * size, b === blocks - 1 ? series.length : (b + 1) * size);
    if (!seg.length) continue;
    out.push({
      from: seg[0].date, to: seg[seg.length - 1].date, n: seg.length,
      rate: seg.reduce((s, x) => s + x.hit, 0) / seg.length,
      expRate: seg.reduce((s, x) => s + x.p, 0) / seg.length,
    });
  }
  return out;
}

function analyzeTrack(tr) {
  const cfg = tr.cfg;
  const rows = summarize(tr);
  const holdout = holdoutTest(tr.arms, tr.drawLog);
  const bandit = rows.find((x) => x.key === BANDIT_KEY) || null;
  const baseRows = rows.filter((x) => x.kind === 'base');
  const avgBase = baseRows.length ? baseRows.reduce((s, x) => s + x.rate, 0) / baseRows.length : 0;

  // HAI CỬA phải qua cùng lúc mới được nói "có lợi thế":
  //   1. p sau khi chỉnh Holm < 0.01 (không phải 0.05 — vì đang lấy max của ~16 nhánh,
  //      ở mức 0.05 thì cứ ~20 lần chạy là có 1 nhánh "thắng" hoàn toàn do may rủi);
  //   2. nhà vô địch phải SỐNG SÓT trên đoạn dữ liệu giữ lại.
  // Thiếu một trong hai ⇒ coi như chưa có gì. Đây là chỗ đa số công cụ dò số tự lừa mình.
  const strongest = rows.reduce((best, x) => (!best || x.pHolm < best.pHolm ? x : best), null);
  const passStat = !!(strongest && strongest.pHolm < 0.01 && strongest.edge > 0);
  const passHold = !!(holdout && holdout.survived);
  const evidence = passStat && passHold;

  return {
    track: cfg.key, label: cfg.label, sub: cfg.sub, headK: cfg.head, ks: cfg.ks, show: cfg.show,
    arms: rows, bandit, bestBase: baseRows[0] || null, avgBaseRate: avgBase,
    learnGain: bandit ? bandit.rate - avgBase : 0,
    weights: tr.base.map((b) => ({ key: b.arm.key, name: b.arm.name, w: b.arm.w })).sort((a, b) => b.w - a.w),
    curve: learningCurve(tr.series), holdout, evidence, passStat, passHold,
    strongest: strongest ? { key: strongest.key, name: strongest.name, edge: strongest.edge, pHolm: strongest.pHolm } : null,
    verdict: evidence
      ? `Nhánh "${strongest.name}" vượt ngẫu nhiên ${(strongest.edge * 100).toFixed(1)} điểm VÀ sống sót qua đoạn dữ liệu giữ lại. Cực hiếm — vẫn cần thêm nhiều tháng mới dám tin, và tuyệt đối chưa phải tín hiệu đặt tiền.`
      : passStat
        ? `Nhánh "${strongest.name}" nhỉnh hơn trên toàn mẫu nhưng KHÔNG sống sót ở đoạn giữ lại ⇒ đó là ăn may do lấy nhánh tốt nhất trong ${cfg.strats.length}, không phải lợi thế thật.`
        : `Sau khi chỉnh đa so sánh, KHÔNG nhánh nào vượt ngẫu nhiên ở đường ${cfg.label}. Máy vẫn học để chọn nhánh mạnh nhất cho từng đài, nhưng trần của nó vẫn là mức ngẫu nhiên.`,
  };
}

// ---------------------------------------------------------------------------
// API CHÍNH
// ---------------------------------------------------------------------------
export const XSMN_SCHEDULE_BRAIN = {
  0: [['tien-giang', 'Tiền Giang'], ['kien-giang', 'Kiên Giang'], ['da-lat', 'Đà Lạt']],
  1: [['tp-hcm', 'TP. HCM'], ['dong-thap', 'Đồng Tháp'], ['ca-mau', 'Cà Mau']],
  2: [['ben-tre', 'Bến Tre'], ['vung-tau', 'Vũng Tàu'], ['bac-lieu', 'Bạc Liêu']],
  3: [['dong-nai', 'Đồng Nai'], ['can-tho', 'Cần Thơ'], ['soc-trang', 'Sóc Trăng']],
  4: [['tay-ninh', 'Tây Ninh'], ['an-giang', 'An Giang'], ['binh-thuan', 'Bình Thuận']],
  5: [['vinh-long', 'Vĩnh Long'], ['binh-duong', 'Bình Dương'], ['tra-vinh', 'Trà Vinh']],
  6: [['tp-hcm', 'TP. HCM'], ['long-an', 'Long An'], ['binh-phuoc', 'Bình Phước'], ['hau-giang', 'Hậu Giang']],
};

// Cửa sổ lịch sử đưa vào não. Phải là MỘT hằng số duy nhất cho cả trang web lẫn email:
// hai nơi lấy hai cửa sổ khác nhau thì cùng một ngày sẽ hiện hai tỉ lệ khác nhau, và
// người đọc không có cách nào biết bên nào đúng.
//
// 1400 ngày ≈ 4 năm ≈ 4.300 lượt đài. Chọn con số này vì nó là điểm cân: đủ lớn để
// kiểm định có sức phát hiện, mà vẫn chạy xong trong hạn 60s của hàm serverless.
// Nạp kho vượt quá mức này KHÔNG làm dự báo chính xác hơn — não không đọc tới — nên
// api/xsmn.js dừng đào ngược khi kho đã vượt ngưỡng, thay vì crawl vô tận cho vui.
export const BRAIN_MAX_DAYS = 1400;
export const HISTORY_TARGET = 1600;   // kho cần dày hơn cửa sổ một chút để luôn đủ dùng

export const TRACK_KEYS = ['dau', 'de', 'lo'];

export function brainAnalyze(days, opts = {}) {
  const r = runBrain(days, opts);
  const dau = analyzeTrack(r.tracks.dau);
  const de = analyzeTrack(r.tracks.de);
  const lo = analyzeTrack(r.tracks.lo);
  return {
    version: 5, gradedDraws: r.graded, dau, de, lo,
    evidence: dau.evidence || de.evidence || lo.evidence,
    _state: r,
  };
}

// Thành tích của MỘT nhánh cụ thể tại MỘT đài cụ thể, ở mức chơi.
//
// Cần hàm này vì bộ số của ngày mai đã bị KHOÁ từ hôm qua bằng một nhánh có thể khác
// nhánh hôm nay não đang thích. Muốn tỉ lệ đi kèm nói đúng về dàn số đang hiện, phải
// tra thành tích của ĐÚNG nhánh đã khoá — chứ không phải của nhánh mới.
//
// ══ CÁI BẪY ĐÃ SẬP MỘT LẦN, ĐỪNG SẬP LẠI ══
// Phần theo-đài KHÔNG lấy từ nhánh được chọn, mà từ nhánh BANDIT. Lý do:
//
// Bandit chọn cho mỗi đài nhánh mạnh nhất trong ~16 nhánh. Nếu rồi ta lại đi khoe
// thành tích của chính nhánh vừa được chọn, ta đang lấy MAX của 16 con số rồi gọi nó
// là "tỉ lệ của máy" — con số đó cao hơn thực lực một cách có hệ thống, dù máy chẳng
// biết gì cả. Phép thử vô hiệu chứng minh: chạy bộ máy này trên dữ liệu GIẢ NGẪU NHIÊN
// hoàn toàn, cách tính cũ vẫn cho ra "Tây Ninh: đề về 12.9% so với bốc mù 6.0%, z=3.24".
// Không có gì để học trong dữ liệu đó cả — 12.9% chỉ là nhiễu được chọn lọc.
//
// Nhánh `bandit` thì khác: mỗi kỳ nó chọn bằng dữ liệu CÓ TRƯỚC kỳ đó rồi mới ra số,
// nên chuỗi kết quả của nó là chuỗi quyết định thật, không phải bảng xếp hạng nhìn lại.
// Đây mới là "máy đoán đúng bao nhiêu phần trăm ở đài này".
function provLive(tr, slug) {
  const b = tr.byKey.get(BANDIT_KEY);
  const ps = b && b.prov.get(slug);
  const pn = ps ? ps.n : 0;
  const rec = ps && ps.recent.length ? ps.recent : null;
  return {
    provN: pn, provHits: ps ? Math.round(ps.sh) : 0,
    provRate: pn ? ps.sh / pn : null, provExp: pn ? ps.se / pn : null,
    provZ: ps && ps.sv > 0 ? (ps.sh - ps.se) / Math.sqrt(ps.sv) : null,
    provRecent: rec ? rec.reduce((s, x) => s + x, 0) / rec.length : null, provRecentN: rec ? rec.length : 0,
  };
}

export function armStatsFor(analysis, track, armKey, slug) {
  const tr = analysis._state.tracks[track];
  if (!tr) return null;
  const a = tr.byKey.get(armKey);
  if (!a) return null;
  const row = analysis[track].arms.find((x) => x.key === armKey) || null;
  return {
    armName: a.name,
    armRate: row ? row.showRate : null, armExp: row ? row.showExp : null, armN: row ? row.n : 0,
    ...provLive(tr, slug),
  };
}

// Ra số cho một NGÀY CHƯA CÓ KẾT QUẢ, dùng đúng bộ não vừa học xong.
// Trả CẢ HAI: dàn lô và dàn đề (số đặc biệt) — kèm nhánh nào đã chọn và thành tích của nó.
export function brainPredict(analysis, forDate) {
  const { S, tracks } = analysis._state;
  const wd = wdOf(forDate);
  const provs = XSMN_SCHEDULE_BRAIN[wd] || [];
  const stat = {};
  for (const tk of TRACK_KEYS) stat[tk] = new Map(analysis[tk].arms.map((a) => [a.key, a]));
  const out = [];
  for (const [slug, name] of provs) {
    const pv = getProv(S, slug, name, '');
    const ctx = { slug, pv, wd, date: forDate };
    const row = { slug, province: name, draws: pv.n };
    for (const tk of TRACK_KEYS) {
      const tr = tracks[tk];
      const { picks, chosen } = pickAll(S, tr, ctx, S.n);
      const st = stat[tk].get(chosen.key);
      // TỈ LỆ CHÍNH XÁC CỦA ĐÚNG DỰ BÁO NÀY — đo ở đúng số lượng số sẽ hiện ra (`show`),
      // kèm mốc bốc mù của chính kỳ đó. Phần theo-đài lấy từ chuỗi quyết định thật của
      // bandit (xem provLive) chứ không phải từ nhánh vừa được chọn.
      row[tk] = {
        arm: chosen.key, armName: chosen.name,
        picks: picks.get(chosen.key).slice(0, tr.cfg.show).map(pad2),
        // Dàn dự phòng: các số xếp ngay sau con chốt. KHÔNG hiện ở thẻ chính (anh chốt
        // chỉ một số), để trong ngăn kéo cho ai muốn chơi rộng hơn. Giữ lại vì bỏ hẳn
        // thì thứ hạng 2–6 của não — thông tin đã tính xong rồi — bị vứt đi vô ích.
        alt: picks.get(chosen.key).slice(1, 6).map(pad2),
        ens: picks.get(ENS_KEY).slice(0, tr.cfg.show).map(pad2),
        showK: tr.cfg.show, headK: tr.cfg.head, label: tr.cfg.label, sub: tr.cfg.sub,
        // toàn miền, của đúng nhánh đang dùng (mẫu dày)
        armRate: st ? st.showRate : null, armExp: st ? st.showExp : null, armN: st ? st.n : 0,
        // riêng đài này, theo quyết định thật của máy (mẫu mỏng hơn nhưng không thiên vị)
        ...provLive(tr, slug),
      };
    }
    out.push(row);
  }
  return { forDate, weekday: wd, provinces: out };
}
