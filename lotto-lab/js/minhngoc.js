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
