// ============================================================================
// ENGINE — lõi tính toán thuần (không đụng DOM), dùng chung cho UI và Web Worker.
//
//   MODULE 04 · Feature Engineering   · buildFeatures()
//   MODULE 05 · Statistical Engine     · buildFeatures() + describeStats()
//   MODULE 06 · Monte Carlo Lab        · monteCarlo()
//   MODULE 07 · Strategy Lab           · STRATEGIES + generateCandidate()
//   MODULE 08 · Backtest Engine        · backtest()  (rolling-window, no leakage)
//   MODULE 09 · Transparent Ranking    · scoreSet()  (điểm minh bạch + lý do)
//
//  QUAN TRỌNG: Mọi con số ở đây là THỐNG KÊ MÔ TẢ trên dữ liệu quá khứ. Xổ số là
//  sự kiện ngẫu nhiên độc lập — không công cụ nào (kể cả cái này) làm tăng xác
//  suất trúng. Điểm số chỉ phản ánh mức độ "khớp" của một bộ số với các đặc
//  trưng thống kê lịch sử, KHÔNG phải xác suất trúng thưởng.
// ============================================================================

// ---- PRNG có hạt giống (mulberry32) → mô phỏng & backtest tái lập được -------
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Bộ trọng số của "mô hình" xếp hạng (Module 09 & 11 tinh chỉnh cái này) --
export const DEFAULT_WEIGHTS = {
  sum: 1.0,        // tổng các số gần vùng trung bình lịch sử
  oddEven: 1.0,    // cân bằng chẵn/lẻ
  lowHigh: 1.0,    // cân bằng thấp/cao
  overdue: 1.0,    // ưu tiên số "lâu chưa ra" (gap lớn)
  pair: 1.0,       // sức mạnh cặp (tần suất đi cùng nhau trong lịch sử)
  spread: 1.0,     // trải đều theo các chục, không dồn cục
  unpopular: 1.2,  // ƯU THẾ KỲ VỌNG THẬT: thiên về số ÍT người chọn (>31, tránh
                   // cụm ngày sinh) → không đổi xác suất trúng, nhưng NẾU trúng
                   // thì ít chia giải hơn ⇒ tiền kỳ vọng cao hơn.
};

// ---- Cơ cấu giải thưởng chính thức (để "báo trúng giải mấy") ---------------
// tiers xếp từ CAO → THẤP; điều kiện: số main trùng ≥ min (và trùng số đặc biệt
// nếu special=true). Số tiền chỉ mang tính tham khảo (Jackpot cộng dồn theo kỳ).
export const PRIZES = {
  power655: { name: 'Power 6/55', special: 'số Power (đặc biệt)', tiers: [
    { min: 6, label: 'JACKPOT 1', amount: '≥ 30 tỷ (cộng dồn)', jackpot: true },
    { min: 5, special: true, label: 'JACKPOT 2', amount: '≥ 3 tỷ (cộng dồn)', jackpot: true },
    { min: 5, label: 'Giải Nhất', amount: '40.000.000đ' },
    { min: 4, label: 'Giải Nhì', amount: '500.000đ' },
    { min: 3, label: 'Giải Ba', amount: '50.000đ' },
  ] },
  power645: { name: 'Mega 6/45', special: null, tiers: [
    { min: 6, label: 'JACKPOT', amount: '≥ 12 tỷ (cộng dồn)', jackpot: true },
    { min: 5, label: 'Giải Nhất', amount: '10.000.000đ' },
    { min: 4, label: 'Giải Nhì', amount: '300.000đ' },
    { min: 3, label: 'Giải Ba', amount: '30.000đ' },
  ] },
  // Cơ cấu THẬT theo vietlott.vn (7 hạng, quay 2 lần/ngày). Số đặc biệt 1–12 quay
  // riêng. "Giải KK" chỉ cần trùng số đặc biệt (kèm ≤2 số chính) → tỉ lệ trúng cao.
  power535: { name: 'Lotto 5/35', special: 'số đặc biệt 1–12', tiers: [
    { min: 5, special: true, label: 'Độc đắc', amount: '≥ 6 tỷ (tích lũy)', jackpot: true },
    { min: 5, label: 'Giải Nhất', amount: '10.000.000đ' },
    { min: 4, special: true, label: 'Giải Nhì', amount: '5.000.000đ' },
    { min: 4, label: 'Giải Ba', amount: '500.000đ' },
    { min: 3, special: true, label: 'Giải Tư', amount: '100.000đ' },
    { min: 3, label: 'Giải Năm', amount: '30.000đ' },
    { min: 0, special: true, label: 'Giải KK', amount: '10.000đ', note: 'Chỉ cần trùng số đặc biệt (kèm ≤ 2 số chính)' },
  ] },
};

// Số đặc biệt (1–12) cho một bộ 5 số Lotto 5/35 — CHỌN TẤT ĐỊNH từ chính bộ số để
// client & server luôn khớp. Số đặc biệt thuần may rủi (1/12), không có tín hiệu, nên
// quy tắc nào cũng tương đương; ở đây suy ra từ tổng bộ số. Trả null cho sản phẩm khác.
export function specialFor(set, product) {
  if (product !== 'power535') return null;
  const s = set.reduce((a, b) => a + b, 0);
  return (s % 12) + 1;
}

// Trả về bậc giải trúng (hoặc null nếu không trúng). rank nhỏ = giải cao.
export function prizeFor(product, mainMatches, hitSpecial = false) {
  const table = PRIZES[product]; if (!table) return null;
  for (let i = 0; i < table.tiers.length; i++) {
    const t = table.tiers[i];
    if (mainMatches >= t.min && (!t.special || hitSpecial)) {
      return { rank: i, label: t.label, amount: t.amount, jackpot: !!t.jackpot, note: t.note || null };
    }
  }
  return null;
}

export const STRATEGIES = [
  { key: 'hot',      label: 'Hot — số nóng',       desc: 'Ưu tiên số xuất hiện nhiều gần đây.' },
  { key: 'cold',     label: 'Cold — số nguội',     desc: 'Ưu tiên số ít xuất hiện gần đây.' },
  { key: 'overdue',  label: 'Overdue — lâu chưa ra',desc: 'Ưu tiên số có khoảng cách (gap) lớn nhất.' },
  { key: 'balanced', label: 'Balanced — cân bằng', desc: 'Ép cân bằng chẵn/lẻ, thấp/cao, tổng vào vùng phổ biến.' },
  { key: 'hybrid',   label: 'Hybrid — lai',        desc: 'Trộn nóng + lâu chưa ra + ngẫu nhiên, rồi cân chỉnh.' },
  { key: 'random',   label: 'Random — ngẫu nhiên', desc: 'Chọn ngẫu nhiên đều — mốc so sánh (baseline).' },
];

// ============================================================================
// MODULE 04 & 05 — FEATURE ENGINEERING + STATISTICS
// draws: [{ main:[...] }] đã sắp xếp cũ→mới. Trả về toàn bộ đặc trưng.
// opts.recentWindow: cửa sổ tính "nóng/nguội" gần đây (mặc định 60 kỳ).
// opts.pairs: có tính ma trận cặp không (backtest tắt để chạy nhanh).
// ============================================================================
export function buildFeatures(draws, cfg, opts = {}) {
  const N = cfg.mainMax;
  const K = cfg.mainCount;
  const W = opts.recentWindow || 60;
  const withPairs = opts.pairs !== false;
  const T = draws.length;

  const freq = new Float64Array(N + 1);
  const recentFreq = new Float64Array(N + 1);
  const lastSeen = new Int32Array(N + 1).fill(T); // số kỳ kể từ lần cuối xuất hiện
  const gapSum = new Float64Array(N + 1);
  const gapCount = new Int32Array(N + 1);
  const gapMax = new Int32Array(N + 1);
  const prevIdx = new Int32Array(N + 1).fill(-1);

  const sums = new Array(T);
  let oddTotal = 0, lowTotal = 0;
  const half = N / 2;

  for (let i = 0; i < T; i++) {
    const m = draws[i].main;
    let s = 0, odd = 0, low = 0;
    for (let j = 0; j < m.length; j++) {
      const n = m[j];
      freq[n]++;
      s += n;
      if (n % 2 === 1) odd++;
      if (n <= half) low++;
      // gap giữa các lần xuất hiện
      if (prevIdx[n] >= 0) {
        const g = i - prevIdx[n];
        gapSum[n] += g; gapCount[n]++;
        if (g > gapMax[n]) gapMax[n] = g;
      }
      prevIdx[n] = i;
      if (i >= T - W) recentFreq[n]++;
    }
    sums[i] = s;
    oddTotal += odd; lowTotal += low;
  }

  // lastSeen hiện tại = số kỳ tính từ lần cuối tới kỳ mới nhất
  for (let n = 1; n <= N; n++) {
    lastSeen[n] = prevIdx[n] < 0 ? T : (T - 1 - prevIdx[n]);
  }

  const expected = (T * K) / N; // kỳ vọng tần suất nếu hoàn toàn ngẫu nhiên
  const nums = [];
  for (let n = 1; n <= N; n++) {
    nums.push({
      n,
      freq: freq[n],
      recentFreq: recentFreq[n],
      lastSeen: lastSeen[n],
      avgGap: gapCount[n] ? gapSum[n] / gapCount[n] : T,
      maxGap: gapMax[n],
      deviation: freq[n] - expected, // dương = ra nhiều hơn kỳ vọng
    });
  }

  const hot = [...nums].sort((a, b) => b.recentFreq - a.recentFreq || b.freq - a.freq);
  const cold = [...nums].sort((a, b) => a.recentFreq - b.recentFreq || a.freq - b.freq);
  const overdue = [...nums].sort((a, b) => b.lastSeen - a.lastSeen || b.avgGap - a.avgGap);

  // Thống kê tổng (sum) — Module 05
  const sumMean = mean(sums);
  const sumStd = std(sums, sumMean) || 1;

  // Ma trận cặp — Module 04 (Pair Score)
  let pairFreq = null, pairMax = 1, topPairs = [];
  if (withPairs) {
    pairFreq = new Map();
    for (let i = 0; i < T; i++) {
      const m = draws[i].main;
      for (let a = 0; a < m.length; a++) {
        for (let b = a + 1; b < m.length; b++) {
          const key = m[a] * 100 + m[b];
          const v = (pairFreq.get(key) || 0) + 1;
          pairFreq.set(key, v);
          if (v > pairMax) pairMax = v;
        }
      }
    }
    topPairs = [...pairFreq.entries()]
      .map(([k, v]) => ({ a: Math.floor(k / 100), b: k % 100, count: v }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 12);
  }

  return {
    T, N, K, expected, half,
    freq, recentFreq, lastSeen,
    nums, hot, cold, overdue,
    sumMean, sumStd, sumMin: Math.min(...sums), sumMax: Math.max(...sums),
    oddMean: oddTotal / T, lowMean: lowTotal / T,
    pairFreq, pairMax, topPairs,
  };
}

// ============================================================================
// MODULE 09 — TRANSPARENT SCORING. Trả về điểm 0–100 + phân rã + lý do.
// ============================================================================
export function scoreSet(set, feat, weights = DEFAULT_WEIGHTS) {
  const K = feat.K, N = feat.N, half = feat.half;
  let sum = 0, odd = 0, low = 0;
  for (const n of set) { sum += n; if (n % 2 === 1) odd++; if (n <= half) low++; }

  // Tổng gần trung bình lịch sử (gaussian trong ±3σ)
  const z = Math.abs(sum - feat.sumMean) / feat.sumStd;
  const pSum = Math.exp(-0.5 * z * z);

  // Cân bằng chẵn/lẻ và thấp/cao (đỉnh tại K/2)
  const pOdd = 1 - Math.abs(odd - K / 2) / (K / 2);
  const pLow = 1 - Math.abs(low - K / 2) / (K / 2);

  // Ưu tiên số lâu chưa ra (chuẩn hoá theo lastSeen tối đa)
  let maxSeen = 1;
  for (const x of feat.nums) if (x.lastSeen > maxSeen) maxSeen = x.lastSeen;
  let seen = 0; for (const n of set) seen += feat.lastSeen[n];
  const pOver = (seen / K) / maxSeen;

  // Sức mạnh cặp
  let pPair = 0;
  if (feat.pairFreq) {
    const arr = [...set].sort((a, b) => a - b);
    let acc = 0, cnt = 0;
    for (let a = 0; a < arr.length; a++)
      for (let b = a + 1; b < arr.length; b++) { acc += feat.pairFreq.get(arr[a] * 100 + arr[b]) || 0; cnt++; }
    pPair = cnt ? (acc / cnt) / feat.pairMax : 0;
  }

  // Trải đều theo các chục (spread) — số nhóm chục khác nhau / tối đa
  const decades = new Set(); for (const n of set) decades.add(Math.floor((n - 1) / 10));
  const maxDec = Math.min(K, Math.ceil(N / 10));
  const pSpread = decades.size / maxDec;

  // "Ít bị chọn trùng" (EV): người chơi thật hay chọn số ≤31 (ngày sinh) và các
  // số nhỏ. Thưởng cho bộ có nhiều số > ngưỡng calendar ⇒ nếu trúng, ít chia giải.
  const calThresh = Math.min(31, Math.round(N * 0.57));
  let highCal = 0; for (const n of set) if (n > calThresh) highCal++;
  const pUnpop = clamp01(highCal / Math.max(1, Math.ceil(K / 2)));

  const parts = { sum: pSum, oddEven: pOdd, lowHigh: pLow, overdue: pOver, pair: pPair, spread: pSpread, unpopular: pUnpop };
  let wsum = 0, tot = 0;
  for (const k in parts) { const w = weights[k] ?? 0; tot += w * clamp01(parts[k]); wsum += w; }
  const total = wsum ? (tot / wsum) * 100 : 0;

  // Lý do người-đọc-được: nêu 3 thành phần đóng góp cao nhất
  const reasons = Object.entries(parts)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `${LABELS[k]} ${(v * 100).toFixed(0)}%`);

  return { total, parts, reasons, features: { sum, odd, even: K - odd, low, high: K - low, decades: decades.size } };
}

const LABELS = { sum: 'Tổng cân đối', oddEven: 'Chẵn/lẻ', lowHigh: 'Thấp/cao', overdue: 'Lâu chưa ra', pair: 'Cặp mạnh', spread: 'Trải đều', unpopular: 'Ít bị chọn trùng' };

// ============================================================================
// MODULE 07 — STRATEGY LAB. Sinh 1 bộ số theo chiến lược.
// ============================================================================
export function generateCandidate(strategy, feat, r) {
  const K = feat.K, N = feat.N;
  const eps = 0.15; // làm mượt để không bao giờ khoá cứng 1 tập số

  const weightsBy = (fn) => {
    const w = new Float64Array(N + 1);
    for (const x of feat.nums) w[x.n] = Math.max(0, fn(x)) + eps;
    return w;
  };

  let w;
  switch (strategy) {
    case 'hot':     w = weightsBy((x) => x.recentFreq); break;
    case 'cold':    w = weightsBy((x) => 1 / (1 + x.recentFreq)); break;
    case 'overdue': w = weightsBy((x) => x.lastSeen); break;
    case 'hybrid': {
      const s = new Set();
      const hotW = weightsBy((x) => x.recentFreq);
      const ovW = weightsBy((x) => x.lastSeen);
      sampleInto(s, hotW, Math.ceil(K / 3), r);
      sampleInto(s, ovW, Math.ceil(K / 3), r);
      const flat = new Float64Array(N + 1).fill(1);
      sampleInto(s, flat, K, r);
      return repairBalanced([...s].slice(0, K), feat, r);
    }
    case 'balanced': {
      const flat = new Float64Array(N + 1).fill(1);
      const s = new Set(); sampleInto(s, flat, K, r);
      return repairBalanced([...s], feat, r);
    }
    case 'random':
    default:        w = new Float64Array(N + 1).fill(1); break;
  }
  const s = new Set(); sampleInto(s, w, K, r);
  return [...s].sort((a, b) => a - b);
}

// Lấy mẫu KHÔNG hoàn lại theo trọng số cho tới khi set đủ `count` phần tử.
function sampleInto(set, weights, count, r) {
  const N = weights.length - 1;
  let guard = 0;
  while (set.size < count && guard++ < 5000) {
    let total = 0;
    for (let n = 1; n <= N; n++) if (!set.has(n)) total += weights[n];
    if (total <= 0) break;
    let x = r() * total;
    for (let n = 1; n <= N; n++) {
      if (set.has(n)) continue;
      x -= weights[n];
      if (x <= 0) { set.add(n); break; }
    }
  }
}

// Sửa bộ số về hướng cân bằng chẵn/lẻ & tổng nằm trong vùng phổ biến.
function repairBalanced(set, feat, r) {
  const K = feat.K, N = feat.N, half = feat.half;
  let arr = [...new Set(set)];
  while (arr.length < K) { const n = 1 + Math.floor(r() * N); if (!arr.includes(n)) arr.push(n); }
  arr = arr.slice(0, K);

  for (let iter = 0; iter < 24; iter++) {
    const odd = arr.filter((n) => n % 2 === 1).length;
    const sum = arr.reduce((a, b) => a + b, 0);
    const needOddFix = Math.abs(odd - K / 2) > 1;
    const needSumFix = Math.abs(sum - feat.sumMean) > 1.4 * feat.sumStd;
    if (!needOddFix && !needSumFix) break;

    // thay 1 số để tiến gần mục tiêu
    const i = Math.floor(r() * K);
    let cand = 1 + Math.floor(r() * N);
    let tries = 0;
    while ((arr.includes(cand)) && tries++ < 40) cand = 1 + Math.floor(r() * N);
    const trial = arr.slice(); trial[i] = cand;
    const badBefore = Math.abs(odd - K / 2) + Math.abs(sum - feat.sumMean) / feat.sumStd;
    const odd2 = trial.filter((n) => n % 2 === 1).length;
    const sum2 = trial.reduce((a, b) => a + b, 0);
    const badAfter = Math.abs(odd2 - K / 2) + Math.abs(sum2 - feat.sumMean) / feat.sumStd;
    if (badAfter < badBefore) arr = trial;
  }
  return arr.sort((a, b) => a - b);
}

// ============================================================================
// MODULE 06 — MONTE CARLO LAB. Sinh nhiều bộ số, chấm điểm, xếp hạng, lưu top-K.
// ============================================================================
export function monteCarlo(feat, { n = 100000, strategy = 'balanced', weights = DEFAULT_WEIGHTS, topK = 10, seed = 12345 } = {}) {
  const r = rng(seed);
  const top = [];
  let minTop = -1;
  const bins = new Array(20).fill(0); // histogram điểm 0..100
  let sumScore = 0;

  for (let i = 0; i < n; i++) {
    const set = generateCandidate(strategy, feat, r);
    const sc = scoreSet(set, feat, weights);
    sumScore += sc.total;
    bins[Math.min(19, Math.floor(sc.total / 5))]++;

    if (top.length < topK) {
      top.push({ set, score: sc.total, reasons: sc.reasons, parts: sc.parts, feat: sc.features });
      if (top.length === topK) { top.sort((a, b) => a.score - b.score); minTop = top[0].score; }
    } else if (sc.total > minTop) {
      // loại bộ trùng để top đa dạng
      const sig = set.join('-');
      if (!top.some((t) => t.set.join('-') === sig)) {
        top[0] = { set, score: sc.total, reasons: sc.reasons, parts: sc.parts, feat: sc.features };
        top.sort((a, b) => a.score - b.score); minTop = top[0].score;
      }
    }
  }
  top.sort((a, b) => b.score - a.score);
  return { top, scanned: n, avgScore: sumScore / n, hist: bins };
}

// ============================================================================
// MODULE 08 — BACKTEST ENGINE (rolling-window, KHÔNG rò rỉ dữ liệu tương lai).
// Với mỗi kỳ kiểm thử, chỉ dùng dữ liệu TRƯỚC kỳ đó để sinh bộ số, rồi so với
// kết quả thật của chính kỳ đó. So sánh mọi chiến lược với baseline ngẫu nhiên.
// ============================================================================
export function backtest(draws, cfg, { lookback = 250, minHistory = 120, strategies = STRATEGIES.map((s) => s.key), weights = DEFAULT_WEIGHTS, seed = 777 } = {}) {
  const T = draws.length;
  const start = Math.max(minHistory, T - lookback);
  const K = cfg.mainCount;
  const stats = {};
  for (const s of strategies) stats[s] = { hist: new Array(K + 1).fill(0), totalMatches: 0, tests: 0, best: 0 };

  for (let i = start; i < T; i++) {
    const history = draws.slice(0, i);                 // chỉ quá khứ — no leakage
    const feat = buildFeatures(history, cfg, { pairs: false, recentWindow: 60 });
    const actual = new Set(draws[i].main);
    for (const s of strategies) {
      const r = rng(seed + i * 131 + s.length * 7);    // hạt giống ổn định theo kỳ
      const pick = generateCandidate(s, feat, r);
      let m = 0; for (const n of pick) if (actual.has(n)) m++;
      const st = stats[s];
      st.hist[m]++; st.totalMatches += m; st.tests++; if (m > st.best) st.best = m;
    }
  }

  // Kỳ vọng ngẫu nhiên (siêu hình học): E[trùng] = K*K/N
  const expectedRandom = (K * K) / cfg.mainMax;
  const rows = strategies.map((s) => {
    const st = stats[s];
    return {
      strategy: s,
      tests: st.tests,
      avgMatches: st.tests ? st.totalMatches / st.tests : 0,
      best: st.best,
      hist: st.hist,
      pctGE: st.tests ? (100 * st.hist.slice(3).reduce((a, b) => a + b, 0)) / st.tests : 0, // % kỳ trùng ≥3
    };
  }).sort((a, b) => b.avgMatches - a.avgMatches);

  return { rows, expectedRandom, tests: rows[0] ? rows[0].tests : 0, window: [start, T - 1] };
}

// ---- tiện ích ---------------------------------------------------------------
function mean(a) { let s = 0; for (const x of a) s += x; return s / a.length; }
function std(a, m) { let s = 0; for (const x of a) s += (x - m) * (x - m); return Math.sqrt(s / a.length); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

export function describeStats(feat) {
  return [
    { label: 'Số kỳ đã phân tích', value: feat.T, hint: 'Toàn bộ lịch sử thu thập được.' },
    { label: 'Tần suất kỳ vọng / số', value: feat.expected.toFixed(1), hint: 'Nếu hoàn toàn ngẫu nhiên, mỗi số nên xuất hiện ngần này lần.' },
    { label: 'Tổng trung bình 1 kỳ', value: feat.sumMean.toFixed(1), hint: `Độ lệch chuẩn ±${feat.sumStd.toFixed(1)}. Vùng tổng phổ biến: ${Math.round(feat.sumMean - feat.sumStd)}–${Math.round(feat.sumMean + feat.sumStd)}.` },
    { label: 'Chẵn/lẻ trung bình', value: `${feat.oddMean.toFixed(1)} lẻ / ${(feat.K - feat.oddMean).toFixed(1)} chẵn`, hint: 'Phân bố chẵn/lẻ điển hình mỗi kỳ.' },
    { label: 'Thấp/cao trung bình', value: `${feat.lowMean.toFixed(1)} thấp / ${(feat.K - feat.lowMean).toFixed(1)} cao`, hint: `Ngưỡng thấp = ≤ ${feat.half}.` },
  ];
}

// ============================================================================
// MODULE 12 — CHƠI KIỂU CHUYÊN GIA (dàn vé & bao số / covering design)
//
//  KHÔNG đổi xác suất của MỘT vé — điều đó bất khả (mỗi kỳ độc lập, đã kiểm chứng
//  bằng backtest, kiểm định độc lập & mô hình ML: mọi cách chọn số = ngẫu nhiên).
//  Thay vào đó, trên một NGÂN SÁCH nhiều vé cố định, nó tối ưu HÌNH DẠNG kết quả:
//   • diversifiedTickets → giảm trùng lặp giữa các vé ⇒ tăng P(trúng ÍT NHẤT 1 giải)
//                          ~4–5% tương đối so với mua ngẫu nhiên (đo bằng mô phỏng).
//   • buildWheel (bao số) → ĐẢM BẢO toán học: nếu ≥ m số trúng nằm trong nhóm đã
//                          chọn thì chắc chắn có ≥ 1 vé trúng ≥ t số; và khuếch đại
//                          số vé trúng khi nhóm "nóng" (gấp ~20–36× khi pool dính ≥4).
//  RTP vẫn ~30% — đây là tối ưu tổ hợp trên ngân sách, KHÔNG thắng được nhà cái.
// ============================================================================

function _popcount(x) { let c = 0; while (x) { x &= x - 1; c++; } return c; }
// Mọi k-tập con của [0..P-1] biểu diễn bằng bitmask (P nhỏ ≤ ~18).
function _combMasks(P, k) {
  const out = []; if (k < 0 || k > P) return out;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    let mask = 0; for (const i of idx) mask |= (1 << i); out.push(mask);
    let p = k - 1; while (p >= 0 && idx[p] === P - k + p) p--;
    if (p < 0) break; idx[p]++; for (let q = p + 1; q < k; q++) idx[q] = idx[q - 1] + 1;
  }
  return out;
}

// Bao số: pool = mảng số thật; đảm bảo "≥ t trúng nếu ≥ m số nhóm được quay".
// Trả về { tickets, guarantee, verified, count }. Dùng greedy set-cover (hợp lệ,
// gần tối ưu) rồi CHỨNG MINH lại guarantee bằng verifyWheel.
export function buildWheel(pool, K, t = 3, m = 4) {
  const P = pool.length;
  if (P < K || m > P || t > Math.min(m, K) || t < 1) return { tickets: [], guarantee: { t, m }, verified: false, count: 0 };
  const subs = _combMasks(P, m), cands = _combMasks(P, K);
  const covered = new Uint8Array(subs.length);
  const chosen = []; let remaining = subs.length, guard = 0;
  while (remaining > 0 && guard++ < 4000) {
    let best = -1, bestGain = -1, bestList = null;
    for (const c of cands) {
      let gain = 0, list = null;
      for (let s = 0; s < subs.length; s++) if (!covered[s] && _popcount(c & subs[s]) >= t) { gain++; (list || (list = [])).push(s); }
      if (gain > bestGain) { bestGain = gain; best = c; bestList = list; }
    }
    if (bestGain <= 0) break;
    chosen.push(best); for (const s of bestList) covered[s] = 1; remaining -= bestGain;
  }
  const tickets = chosen.map((mask) => { const tk = []; for (let i = 0; i < P; i++) if (mask & (1 << i)) tk.push(pool[i]); return tk.sort((a, b) => a - b); });
  return { tickets, guarantee: { t, m }, verified: verifyWheel(tickets, pool, t, m), count: tickets.length };
}

// Chứng minh guarantee: mọi m-tập con của pool phải được ≥1 vé phủ với ≥ t phần tử.
export function verifyWheel(tickets, pool, t, m) {
  const P = pool.length; const pos = new Map(pool.map((n, i) => [n, i]));
  const masks = tickets.map((tk) => { let mk = 0; for (const n of tk) { const i = pos.get(n); if (i != null) mk |= (1 << i); } return mk; });
  for (const s of _combMasks(P, m)) { let ok = false; for (const mk of masks) if (_popcount(mk & s) >= t) { ok = true; break; } if (!ok) return false; }
  return true;
}

// Dàn vé tối ưu: B vé trải đều trên `universe`, ít trùng nhau nhất (giảm tương quan
// giữa các vé ⇒ tăng P(trúng ≥1 giải) trên cùng ngân sách).
export function diversifiedTickets(universe, K, B, r) {
  const tickets = []; let bag = [];
  const reshuffle = () => { bag = universe.slice(); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } };
  reshuffle();
  for (let b = 0; b < B; b++) { if (bag.length < K) reshuffle(); tickets.push(bag.slice(0, K).sort((a, b) => a - b)); bag = bag.slice(K); }
  return tickets;
}

// Gợi ý một nhóm P số cho bao số: nghiêng "ít người chọn" (>31, tránh cụm ngày sinh)
// nhưng vẫn rải để giữ đa dạng. Không tăng xác suất trúng — chỉ giảm chia giải nếu trúng.
export function suggestPool(feat, size, r, { unpopular = true } = {}) {
  const N = feat.N;
  const shuffleTake = (arr, k) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, Math.max(0, k)); };
  let pick;
  if (unpopular) {
    const cal = Math.min(31, Math.round(N * 0.57)); const high = [], low = [];
    for (let n = 1; n <= N; n++) (n > cal ? high : low).push(n);
    const kHigh = Math.min(high.length, Math.ceil(size * 0.7));
    pick = shuffleTake(high, kHigh).concat(shuffleTake(low, size - kHigh));
  } else {
    pick = shuffleTake(Array.from({ length: N }, (_, i) => i + 1), size);
  }
  return [...new Set(pick)].slice(0, size).sort((a, b) => a - b);
}

// Ước lượng (Monte Carlo) P(trúng ≥1 giải), TB số trùng cao nhất, TB số vé trúng,
// kèm baseline "mua ngẫu nhiên cùng ngân sách" để so sánh TRUNG THỰC.
export function simulateTickets(tickets, cfg, { trials = 20000, seed = 12345 } = {}) {
  const N = cfg.mainMax, K = cfg.mainCount, r = rng(seed);
  const tks = tickets.map((t) => new Set(t)); const B = tickets.length;
  let anyPrize = 0, sumBest = 0, sumPrizes = 0, anyRandom = 0;
  for (let it = 0; it < trials; it++) {
    const drawn = new Set(); while (drawn.size < K) drawn.add(1 + Math.floor(r() * N));
    let best = 0, prizes = 0;
    for (const tk of tks) { let mt = 0; for (const n of drawn) if (tk.has(n)) mt++; if (mt > best) best = mt; if (mt >= 3) prizes++; }
    if (best >= 3) anyPrize++; sumBest += best; sumPrizes += prizes;
    let rbest = 0;
    for (let b = 0; b < B; b++) { const rt = new Set(); while (rt.size < K) rt.add(1 + Math.floor(r() * N)); let mt = 0; for (const n of drawn) if (rt.has(n)) mt++; if (mt > rbest) rbest = mt; }
    if (rbest >= 3) anyRandom++;
  }
  return { pAnyPrize: anyPrize / trials, eBest: sumBest / trials, ePrizes: sumPrizes / trials, pAnyPrizeRandom: anyRandom / trials, trials, B };
}

// P(≥ m trong K số quay rơi vào một nhóm P số) — siêu hình học (cho phần "may rủi").
export function poolHitProb(N, K, P, m) {
  const logC = (n, k) => { if (k < 0 || k > n) return -Infinity; let s = 0; for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1); return s; };
  let p = 0; for (let k = m; k <= Math.min(K, P); k++) p += Math.exp(logC(P, k) + logC(N - P, K - k) - logC(N, K));
  return p;
}

// ============================================================================
// MODULE 13 — THỜI ĐIỂM VÀNG (EV theo jackpot). Nguyên lý MIT Cash WinFall:
//  xác suất trúng KHÔNG đổi, nhưng EV/vé TĂNG theo jackpot. Chơi khi jackpot lớn
//  = thời điểm toán học ít tệ nhất; vượt "điểm hòa vốn" ⇒ EV ≥ giá vé (TRƯỚC khi
//  chia giải). Đây là đòn bẩy "kết quả" thật của giới chuyên gia thế giới.
// ============================================================================
function _logCg(n, k) { if (k < 0 || k > n) return -Infinity; let s = 0; for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1); return s; }
function _hypEq(N, K, k) { return Math.exp(_logCg(K, k) + _logCg(N - K, K - k) - _logCg(N, K)); } // P(đúng k số chính trùng)

// EV/vé 10.000đ ở một mức jackpot. jackpots: {j1,j2} (Power) hoặc {j} (Mega/Lotto).
export function evPerTicket(product, jackpots = {}) {
  const T = 10000; let ev = 0, pWin = 0;
  if (product === 'power655') {
    const N = 55, K = 6, p5 = _hypEq(N, K, 5);
    const pJ1 = _hypEq(N, K, 6), pJ2 = p5 * (1 / 49), pG1 = p5 * (48 / 49), p4 = _hypEq(N, K, 4), p3 = _hypEq(N, K, 3);
    ev = pJ1 * (jackpots.j1 || 0) + pJ2 * (jackpots.j2 || 0) + pG1 * 40e6 + p4 * 500e3 + p3 * 50e3;
    pWin = pJ1 + p5 + p4 + p3;
  } else if (product === 'power645') {
    const N = 45, K = 6, pJ = _hypEq(N, K, 6), p5 = _hypEq(N, K, 5), p4 = _hypEq(N, K, 4), p3 = _hypEq(N, K, 3);
    ev = pJ * (jackpots.j || 0) + p5 * 10e6 + p4 * 300e3 + p3 * 30e3;
    pWin = pJ + p5 + p4 + p3;
  } else if (product === 'power535') {
    const N = 35, K = 5, ps = 1 / 12, pn = 11 / 12;
    const P5 = _hypEq(N, K, 5), P4 = _hypEq(N, K, 4), P3 = _hypEq(N, K, 3), Ple2 = _hypEq(N, K, 0) + _hypEq(N, K, 1) + _hypEq(N, K, 2);
    ev = P5 * ps * (jackpots.j || 0) + P5 * pn * 10e6 + P4 * ps * 5e6 + P4 * pn * 500e3 + P3 * ps * 100e3 + P3 * pn * 30e3 + Ple2 * ps * 10e3;
    pWin = ps + pn * (P3 + P4 + P5);
  }
  return { ev, rtp: ev / T, pWin, ticket: T };
}

// Mức jackpot để EV = giá vé (hòa vốn, bỏ qua chia giải). Trả về {value, feasibleHint}.
export function breakEvenJackpot(product, otherJackpots = {}) {
  const T = 10000;
  if (product === 'power655') { const pJ1 = _hypEq(55, 6, 6); const evNo = evPerTicket(product, { j1: 0, j2: otherJackpots.j2 || 4e9 }).ev; return (T - evNo) / pJ1; }
  if (product === 'power645') { const pJ = _hypEq(45, 6, 6); const evNo = evPerTicket(product, { j: 0 }).ev; return (T - evNo) / pJ; }
  if (product === 'power535') { const pJ = _hypEq(35, 5, 5) * (1 / 12); const evNo = evPerTicket(product, { j: 0 }).ev; return (T - evNo) / pJ; }
  return null;
}
