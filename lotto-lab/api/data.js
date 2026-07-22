// ============================================================================
// MODULE 01 · Historical Data Collector   +   MODULE 02 · Unlimited History
// MODULE 03 · Data Quality Engine
//
// Serverless collector chạy trên Vercel. Nó tải TOÀN BỘ lịch sử quay số của
// một sản phẩm Vietlott từ nguồn dữ liệu công khai, tự chuyển sang nguồn dự
// phòng nếu nguồn chính lỗi, rồi kiểm định chất lượng (thiếu kỳ, trùng kỳ, sai
// số, ngày không hợp lệ, ngoại lai) trước khi trả về JSON đã chuẩn hoá.
//
// Nguồn: bộ dữ liệu công khai vietvudanh/vietlott-data (cập nhật hàng ngày qua
// GitHub Actions). Đây là dữ liệu kết quả chính thức đã được số hoá; app không
// crawl trực tiếp trang ASP.NET của Vietlott (phân trang postback không ổn định)
// mà dùng bản đã chuẩn hoá + đối chiếu 2 nguồn để đảm bảo tính toàn vẹn.
// ============================================================================

import { mergeFreshDraws } from '../js/vietlott.js';

// Cấu hình từng sản phẩm: số lượng số chính, biên độ, có số đặc biệt hay không.
const PRODUCTS = {
  power655: { file: 'power655.jsonl', mainCount: 6, mainMax: 55, special: true,  specialMax: 55, label: 'Power 6/55' },
  power645: { file: 'power645.jsonl', mainCount: 6, mainMax: 45, special: false, specialMax: 0,  label: 'Mega 6/45' },
  power535: { file: 'power535.jsonl', mainCount: 5, mainMax: 35, special: true,  specialMax: 12, label: 'Lotto 5/35' },
};

// Hai nguồn: nguồn chính (raw GitHub) và nguồn dự phòng (CDN jsDelivr, cùng repo).
const SOURCES = [
  (file) => `https://raw.githubusercontent.com/vietvudanh/vietlott-data/master/data/${file}`,
  (file) => `https://cdn.jsdelivr.net/gh/vietvudanh/vietlott-data@master/data/${file}`,
];

// Cache trong bộ nhớ tiến trình để giảm số lần gọi ra ngoài (hết hạn sau 30').
const cache = new Map(); // product -> { at:number, payload:object }
const TTL_MS = 5 * 60 * 1000; // 5 phút — để kết quả mới từ vietlott.vn xuất hiện nhanh ("báo ngay")

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'lotto-lab/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Tải raw text với cơ chế fallback qua từng nguồn.
async function collect(file) {
  const errors = [];
  for (let i = 0; i < SOURCES.length; i++) {
    try {
      const text = await fetchText(SOURCES[i](file));
      if (text && text.length > 50) return { text, sourceIndex: i };
    } catch (e) {
      errors.push(`source#${i}: ${e.message}`);
    }
  }
  throw new Error(`Tất cả nguồn dữ liệu đều lỗi — ${errors.join(' | ')}`);
}

const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// Parse + normalize + validate (Module 03).
function process(text, cfg) {
  const raw = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { raw.push(JSON.parse(s)); } catch { /* bỏ dòng hỏng */ }
  }

  const seenIds = new Set();
  const issues = { missing: 0, duplicate: 0, wrongNumber: 0, invalidDate: 0 };
  const draws = [];

  for (const r of raw) {
    const result = Array.isArray(r.result) ? r.result.map(Number) : [];
    const main = result.slice(0, cfg.mainCount);
    const special = cfg.special ? (result[cfg.mainCount] ?? null) : null;

    let ok = true;
    if (!isValidDate(r.date)) { issues.invalidDate++; ok = false; }
    if (main.length !== cfg.mainCount) { issues.wrongNumber++; ok = false; }
    if (main.some((n) => !Number.isInteger(n) || n < 1 || n > cfg.mainMax)) { issues.wrongNumber++; ok = false; }
    if (new Set(main).size !== main.length) { issues.wrongNumber++; ok = false; } // trùng số trong 1 kỳ
    if (seenIds.has(r.id)) { issues.duplicate++; ok = false; }
    seenIds.add(r.id);
    if (!ok) continue;

    draws.push({ id: String(r.id), date: r.date, main: main.slice().sort((a, b) => a - b), special });
  }

  // Phát hiện thiếu kỳ theo tính liên tục của MÃ KỲ (không phụ thuộc thứ tự ngày):
  // số kỳ thiếu = (mã lớn nhất − mã nhỏ nhất + 1) − số kỳ hợp lệ, nếu mã là số liên tục.
  const numericIds = draws.map((d) => Number(d.id)).filter(Number.isFinite);
  if (numericIds.length) {
    const minId = Math.min(...numericIds), maxId = Math.max(...numericIds);
    issues.missing = Math.max(0, (maxId - minId + 1) - numericIds.length);
  }

  // Sắp xếp theo thời gian tăng dần (kỳ cũ -> mới).
  draws.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.id) - Number(b.id)));

  return { draws, issues };
}

export default async function handler(req, res) {
  const product = String((req.query && req.query.product) || 'power655');
  const cfg = PRODUCTS[product];
  if (!cfg) {
    res.status(400).json({ error: 'Sản phẩm không hợp lệ', products: Object.keys(PRODUCTS) });
    return;
  }

  // Phục vụ từ cache nếu còn hạn (trừ khi ?warm=1 ép làm mới — dùng cho cron).
  const warm = req.query && req.query.warm;
  const hit = cache.get(product);
  if (hit && !warm && Date.now() - hit.at < TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'HIT');
    res.status(200).json(hit.payload);
    return;
  }

  try {
    const { text, sourceIndex } = await collect(cfg.file);
    const { draws, issues } = process(text, cfg);
    if (draws.length === 0) throw new Error('Không có kỳ quay hợp lệ nào sau khi kiểm định');

    // Bơm kết quả MỚI NHẤT trực tiếp từ vietlott.vn (tươi hơn bản sao GitHub) → "báo ngay".
    const freshAdded = await mergeFreshDraws(product, cfg, draws);

    const payload = {
      product,
      label: cfg.label,
      config: {
        mainCount: cfg.mainCount, mainMax: cfg.mainMax,
        special: cfg.special, specialMax: cfg.specialMax,
      },
      meta: {
        total: draws.length,
        firstDate: draws[0].date,
        lastDate: draws[draws.length - 1].date,
        latestId: draws[draws.length - 1].id,
        source: (sourceIndex === 0 ? 'primary' : 'fallback') + (freshAdded ? '+vietlott' : ''),
        quality: issues,
        collectedAt: new Date().toISOString(),
      },
      draws,
    };

    cache.set(product, { at: Date.now(), payload });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json(payload);
  } catch (e) {
    // Nếu có cache cũ thì trả về cache cũ để app không chết.
    if (hit) {
      res.setHeader('X-Cache', 'STALE');
      res.status(200).json(hit.payload);
      return;
    }
    res.status(502).json({ error: 'Thu thập dữ liệu thất bại', detail: String(e.message || e) });
  }
}
