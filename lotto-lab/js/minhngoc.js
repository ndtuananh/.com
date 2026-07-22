// ============================================================================
// js/minhngoc.js — CRAWLER + PARSER cho Xổ số Kiến thiết Miền Nam (minhngoc.net.vn)
//
// Trang mien-nam.html dựng sẵn phía server (không cần JS). Mỗi ngày ~3–4 đài; mỗi
// đài 18 giải. Ta chuẩn hoá: ĐỀ = 2 số cuối Giải Đặc Biệt; LÔ = 2 số cuối của cả 18
// giải. TẤT CẢ chỉ là THỐNG KÊ MÔ TẢ trên dữ liệu quá khứ — xổ số là ngẫu nhiên độc
// lập, không công cụ nào dự đoán được kỳ tới. Đây là nền tảng NGHIÊN CỨU, không cam kết.
// ============================================================================
const SRC = 'https://www.minhngoc.net.vn/ket-qua-xo-so/mien-nam.html';
const GIAI = ['giai8', 'giai7', 'giai6', 'giai5', 'giai4', 'giai3', 'giai2', 'giai1', 'giaidb'];

// Lịch mở thưởng XSMN theo thứ (0=CN … 6=T7) → [slug, tên đài].
export const XSMN_SCHEDULE = {
  0: [['tien-giang', 'Tiền Giang'], ['kien-giang', 'Kiên Giang'], ['da-lat', 'Đà Lạt']],
  1: [['tp-hcm', 'TP. HCM'], ['dong-thap', 'Đồng Tháp'], ['ca-mau', 'Cà Mau']],
  2: [['ben-tre', 'Bến Tre'], ['vung-tau', 'Vũng Tàu'], ['bac-lieu', 'Bạc Liêu']],
  3: [['dong-nai', 'Đồng Nai'], ['can-tho', 'Cần Thơ'], ['soc-trang', 'Sóc Trăng']],
  4: [['tay-ninh', 'Tây Ninh'], ['an-giang', 'An Giang'], ['binh-thuan', 'Bình Thuận']],
  5: [['vinh-long', 'Vĩnh Long'], ['binh-duong', 'Bình Dương'], ['tra-vinh', 'Trà Vinh']],
  6: [['tp-hcm', 'TP. HCM'], ['long-an', 'Long An'], ['binh-phuoc', 'Bình Phước'], ['hau-giang', 'Hậu Giang']],
};

export function parseXSMN(html) {
  const days = [];
  const tables = html.split(/<table[^>]*class="bkqmiennam"/i).slice(1);
  for (const t of tables) {
    const dm = t.match(/ket-qua-xo-so\/(\d{2})-(\d{2})-(\d{4})\.html/);
    if (!dm) continue;
    const date = `${dm[3]}-${dm[2]}-${dm[1]}`;
    const provBlocks = t.split(/<table[^>]*class="rightcl"/i).slice(1);
    const provinces = [];
    for (const pb of provBlocks) {
      const end = pb.indexOf('</table>');
      const block = end >= 0 ? pb.slice(0, end) : pb;
      const nameM = block.match(/class="tinh">\s*<a[^>]*>([^<]+)<\/a>/);
      if (!nameM) continue;
      const slugM = block.match(/xo-so-mien-nam\/([a-z0-9-]+)\.html/);
      const codeM = block.match(/class="matinh">\s*([^<]+?)\s*</);
      const prizes = {};
      for (const g of GIAI) {
        const gm = block.match(new RegExp(`class="${g}">([\\s\\S]*?)</td>`));
        prizes[g] = gm ? [...gm[1].matchAll(/<div[^>]*>\s*(\d+)\s*<\/div>/g)].map((x) => x[1]) : [];
      }
      const all = Object.values(prizes).flat();
      if (all.length < 18) continue; // kỳ chưa đủ / đang cập nhật
      const lo2 = all.map((n) => n.slice(-2).padStart(2, '0'));
      const de = (prizes.giaidb[0] || '').slice(-2).padStart(2, '0');
      provinces.push({ province: nameM[1].trim(), slug: slugM ? slugM[1] : '', code: codeM ? codeM[1].trim() : '', de, lo2, prizes });
    }
    if (provinces.length) days.push({ date, provinces });
  }
  return days; // mới → cũ (theo thứ tự trang)
}

export async function fetchXSMN() {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(SRC, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; antigravity-research/1.0)' } });
    if (!r.ok) return [];
    return parseXSMN(await r.text());
  } catch (_) { return []; } finally { clearTimeout(t); }
}

// Trang theo ngày: trả 7 ngày KẾT THÚC ở ngày đó (ymd = 'YYYY-MM-DD') → dùng backfill lùi.
export async function fetchXSMNByDate(ymd) {
  const [y, m, d] = ymd.split('-'); if (!y || !m || !d) return [];
  const url = `https://www.minhngoc.net.vn/ket-qua-xo-so/mien-nam/${d}-${m}-${y}.html`;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; antigravity-research/1.0)' } });
    if (!r.ok) return [];
    return parseXSMN(await r.text());
  } catch (_) { return []; } finally { clearTimeout(t); }
}

// Thống kê MÔ TẢ: tần suất 00–99 của ĐỀ và LÔ trên cửa sổ ngày gần đây (mọi đài).
// KHÔNG phải xác suất kỳ tới — mỗi kỳ độc lập. Baseline: đề đều = deN/100, lô đều = loN/100.
const _rank = (arr) => arr.map((c, n) => ({ n: String(n).padStart(2, '0'), c })).sort((a, b) => b.c - a.c || Number(a.n) - Number(b.n));

// ============================================================================
// BACKTEST KHÔNG RÒ RỈ — "chỉ số hiệu quả khớp với thực tế".
// Mỗi ngày CHỈ dùng lịch sử TRƯỚC ngày đó để xếp hạng nóng, rồi so với kết quả THẬT
// của chính ngày đó, đối chiếu baseline NGẪU NHIÊN. Nếu công cụ không có sức dự đoán
// (đúng bản chất xổ số công bằng), mọi tỉ số sẽ ≈ mức ngẫu nhiên.
//   • Lô: chơi top-K cặp nóng → tỉ số (số trúng thực tế / kỳ vọng ngẫu nhiên). ~1.0 = vô ích.
//   • Đề: top-1 nóng có khớp đề thật hơn 1/100 không? top-5 có hơn 5/100 không?
// ============================================================================
// Permutation p-value cho đề: baseline ĐÚNG. "Số nóng" vốn hay khớp mẫu quá khứ nên
// z ngây thơ (so 1/100) phóng đại; xáo trộn đề thật để dựng phân bố null trung thực.
function _permP(pred, act, B = 3000) {
  let obs = 0; for (let i = 0; i < pred.length; i++) if (pred[i] === act[i]) obs++;
  const n = act.length, arr = act.slice(); let x = 123456789 >>> 0, ge = 0;
  for (let b = 0; b < B; b++) {
    for (let i = n - 1; i > 0; i--) { x = (1103515245 * x + 12345) >>> 0; const j = x % (i + 1); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    let m = 0; for (let i = 0; i < n; i++) if (pred[i] === arr[i]) m++;
    if (m >= obs) ge++;
  }
  return { obs, p: (ge + 1) / (B + 1) };
}

export function xsmnBacktest(days, { warmup = 14, K = 10 } = {}) {
  const asc = [...days].sort((a, b) => (a.date < b.date ? -1 : 1)); // cũ → mới
  const loFreq = new Array(100).fill(0), deFreq = new Array(100).fill(0);
  let stratHits = 0, randExp = 0, provDraws = 0, anyHitStrat = 0;
  let deMatch = 0, deTop5 = 0, deTrials = 0, tested = 0;
  let s2hit = 0, s2rand = 0; const sugLedger = [];
  const provLo = new Map(), provCount = new Map();
  const dePred = [], deAct = [];
  for (let i = 0; i < asc.length; i++) {
    const d = asc[i];
    if (i >= warmup) {
      const loOrdered = _rank(loFreq).map((x) => Number(x.n));
      const topK = new Set(loOrdered.slice(0, K));
      const top2 = loOrdered.slice(0, 2);
      const deRank = _rank(deFreq).map((x) => Number(x.n));
      const deTop = deRank[0], deTop5set = new Set(deRank.slice(0, 5));
      for (const p of d.provinces) {
        const actual = new Set(p.lo2.map(Number));
        const dDistinct = actual.size;
        let hits = 0; for (const n of topK) if (actual.has(n)) hits++;
        stratHits += hits; randExp += K * dDistinct / 100; provDraws++;
        if (hits > 0) anyHitStrat++;
        // Gợi ý "2 số/đài" theo LỊCH SỬ TỪNG ĐÀI (đủ ≥4 kỳ); mới thì tạm dùng top toàn miền.
        const slug = p.slug || p.province;
        const pf = provLo.get(slug);
        const pTop2 = (pf && (provCount.get(slug) || 0) >= 4) ? _rank(pf).slice(0, 2).map((x) => Number(x.n)) : top2;
        const hit2 = pTop2.some((n) => actual.has(n));
        if (hit2) s2hit++;
        s2rand += 1 - ((100 - dDistinct) / 100) * ((99 - dDistinct) / 99);
        sugLedger.push({ date: d.date, prov: p.province, sug: pTop2.map((n) => String(n).padStart(2, '0')), hit: hit2 });
        const deA = Number(p.de);
        dePred.push(deTop); deAct.push(deA);
        if (deTop === deA) deMatch++;
        if (deTop5set.has(deA)) deTop5++;
        deTrials++;
      }
      tested++;
    }
    for (const p of d.provinces) {
      deFreq[Number(p.de)]++; for (const l of p.lo2) loFreq[Number(l)]++;
      const slug = p.slug || p.province;
      let pf = provLo.get(slug); if (!pf) { pf = new Array(100).fill(0); provLo.set(slug, pf); }
      for (const l of p.lo2) pf[Number(l)]++;
      provCount.set(slug, (provCount.get(slug) || 0) + 1);
    }
  }
  // Ý nghĩa thống kê ĐÚNG: lô dùng z; đề dùng PERMUTATION (baseline trung thực).
  // Ngưỡng thận trọng, đã tính đa so sánh: cần bằng chứng mạnh mới dám nói "có lợi thế".
  const loZ = randExp > 0 ? (stratHits - randExp) / Math.sqrt(randExp) : 0;
  const dePerm = deTrials ? _permP(dePred, deAct) : { obs: 0, p: 1 };
  const evidence = dePerm.p < 0.01 || Math.abs(loZ) >= 3.5;
  return {
    warmup, K, testedDays: tested, provinceDraws: provDraws,
    lo: {
      strategyHitsPerDraw: provDraws ? stratHits / provDraws : 0,
      randomHitsPerDraw: provDraws ? randExp / provDraws : 0,
      ratio: randExp > 0 ? stratHits / randExp : 0, // ≈ 1.0 nghĩa là KHÔNG hơn ngẫu nhiên
      anyHitRate: provDraws ? anyHitStrat / provDraws : 0,
    },
    de: {
      matchRate: deTrials ? deMatch / deTrials : 0, baselineMatch: 0.01,
      top5Rate: deTrials ? deTop5 / deTrials : 0, baselineTop5: 0.05, trials: deTrials,
      permP: dePerm.p,
    },
    suggestion: {
      hitRate: provDraws ? s2hit / provDraws : 0,
      randomRate: provDraws ? s2rand / provDraws : 0,
      hits: s2hit, total: provDraws,
      ledger: sugLedger.slice(-24).reverse(),
    },
    significance: { loZ, dePermP: dePerm.p },
    effective: evidence,
    verdict: evidence
      ? 'Có tín hiệu nhỉnh hơn ngẫu nhiên trên dữ liệu HIỆN CÓ, nhưng mẫu còn nhỏ — CHƯA đủ cơ sở để đặt tiền. Cần thêm dữ liệu để xác nhận.'
      : 'KHÔNG có bằng chứng vượt ngẫu nhiên. Xếp hạng nóng/lạnh KHÔNG giúp trúng nhiều hơn — đúng bản chất xổ số công bằng. Đừng đặt tiền kỳ vọng có lợi thế.',
  };
}

export function xsmnStats(days) {
  const deFreq = new Array(100).fill(0), loFreq = new Array(100).fill(0);
  let deN = 0, loN = 0;
  const byProv = new Map(); // slug -> {name, code, deFreq, loFreq, draws}
  for (const d of days) for (const p of d.provinces) {
    const de = Number(p.de); deFreq[de]++; deN++;
    for (const l of p.lo2) { loFreq[Number(l)]++; loN++; }
    const key = p.slug || p.province;
    let pv = byProv.get(key);
    if (!pv) { pv = { name: p.province, code: p.code || '', slug: p.slug || '', deFreq: new Array(100).fill(0), loFreq: new Array(100).fill(0), draws: 0 }; byProv.set(key, pv); }
    pv.deFreq[de]++; pv.draws++;
    for (const l of p.lo2) pv.loFreq[Number(l)]++;
  }
  const provinces = [...byProv.values()].map((pv) => ({
    name: pv.name, code: pv.code, slug: pv.slug, draws: pv.draws,
    loHot: _rank(pv.loFreq).slice(0, 6), deHot: _rank(pv.deFreq).slice(0, 6),
  })).sort((a, b) => b.draws - a.draws);
  return {
    deFreq, loFreq, deN, loN, days: days.length,
    loHot: _rank(loFreq).slice(0, 10), loCold: _rank(loFreq).slice(-10).reverse(), deHot: _rank(deFreq).slice(0, 10),
    provinces,
  };
}
