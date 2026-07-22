// ============================================================================
// js/vietlott.js — LẤY KẾT QUẢ MỚI NHẤT TRỰC TIẾP TỪ vietlott.vn
//
// Trang "winning-number-{655|645|535}" của Vietlott là HTML dựng sẵn phía server
// (không cần chạy JS) → parse thẳng, tươi hơn bản sao GitHub (vốn trễ vài giờ).
// Dùng cho: (1) bơm kết quả mới nhất vào /api/data để app "báo ngay"; (2) cron
// /api/notify dò & báo trúng ngay trong đêm. LUÔN có fallback nên không bao giờ vỡ.
// ============================================================================
const PAGE = { power655: '655', power645: '645', power535: '535' };

// Parse bảng kết quả. cfg: { mainCount, mainMax, special }.
export function parseVietlott(html, cfg) {
  const draws = [];
  const rowRe = /<td>(\d{2}\/\d{2}\/\d{4})<\/td>\s*<td>\s*<a[^>]*>\s*(\d+)\s*<\/a>[\s\S]*?<div class="day_so_ket_qua[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const dateStr = m[1], period = m[2], ballsHtml = m[3];
    // số chính đứng trước dấu "|", số đặc biệt (nếu có) đứng sau.
    const parts = ballsHtml.split(/bong_tron-sperator/);
    const nums = (frag) => [...frag.matchAll(/<span class="bong_tron[^"]*">\s*(\d+)\s*<\/span>/g)].map((x) => Number(x[1]));
    const main = nums(parts[0]);
    const special = parts[1] ? (nums(parts[1])[0] ?? null) : null;
    if (main.length !== cfg.mainCount) continue;
    if (main.some((n) => n < 1 || n > cfg.mainMax) || new Set(main).size !== main.length) continue;
    const [d, mo, y] = dateStr.split('/');
    draws.push({ id: String(period).padStart(5, '0'), date: `${y}-${mo}-${d}`, main: main.slice().sort((a, b) => a - b), special: cfg.special ? special : null });
  }
  return draws;
}

// Trả về các kỳ mới nhất (mảng, cũ→mới) hoặc [] nếu lỗi/không parse được.
export async function fetchVietlottLatest(product, cfg) {
  const code = PAGE[product]; if (!code) return [];
  const url = `https://vietlott.vn/vi/trung-thuong/ket-qua-trung-thuong/winning-number-${code}`;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        'Referer': 'https://vietlott.vn/vi/trung-thuong/ket-qua-trung-thuong',
      },
    });
    if (!r.ok) return [];
    const draws = parseVietlott(await r.text(), cfg);
    draws.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.id) - Number(b.id)));
    return draws;
  } catch (_) { return []; } finally { clearTimeout(t); }
}

// Gộp kết quả tươi từ vietlott vào danh sách draws (theo id), giữ nguyên nếu lỗi.
export async function mergeFreshDraws(product, cfg, draws) {
  try {
    const fresh = await fetchVietlottLatest(product, cfg);
    if (!fresh.length) return 0;
    const have = new Set(draws.map((d) => d.id));
    let added = 0;
    for (const f of fresh) if (!have.has(f.id)) { draws.push(f); have.add(f.id); added++; }
    if (added) draws.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.id) - Number(b.id)));
    return added;
  } catch (_) { return 0; }
}
