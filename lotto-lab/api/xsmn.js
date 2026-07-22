// ============================================================================
// api/xsmn.js — Collector + "DATABASE NẠP LIÊN TỤC" cho Xổ số Miền Nam.
//
//  Mỗi lần chạy (cache-miss): lấy kết quả mới nhất từ minhngoc → gộp vào kho Blob
//  → (khi ?sync=1) crawl LÙI thêm vài trang để kho dày dần → lưu lại → thống kê
//  trên TOÀN BỘ lịch sử tích luỹ (tổng hợp + theo từng đài). KHÔNG dự đoán.
// ============================================================================
import { fetchXSMN, fetchXSMNByDate, xsmnStats, xsmnBacktest } from '../js/minhngoc.js';
import { loadHistory, saveHistory, mergeHistory, addDays } from '../js/xsmn-store.js';

let cache = { at: 0, payload: null };
const TTL_MS = 5 * 60 * 1000;
const BACKFILL_STEPS = 5; // mỗi lần sync crawl lùi tối đa 5 trang (~35 ngày)

export default async function handler(req, res) {
  const q = req.query || {};
  const warm = q.warm, sync = q.sync;
  if (cache.payload && !warm && Date.now() - cache.at < TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'HIT');
    res.status(200).json(cache.payload);
    return;
  }

  try {
    const fresh = await fetchXSMN(); // 7 ngày mới nhất (đầy đủ giải, để hiển thị)
    if (!fresh.length && !cache.payload) throw new Error('Không lấy được kết quả XSMN từ nguồn');

    // ---- Nạp kho Blob + gộp mới + backfill lùi (khi sync) ----
    const { token, days: stored } = await loadHistory();
    let { merged, added } = mergeHistory(stored, fresh);
    let backfilled = 0;
    if (sync && token && merged.length) {
      let cursor = merged[merged.length - 1].date; // ngày cũ nhất hiện có
      for (let i = 0; i < BACKFILL_STEPS && cursor; i++) {
        const older = await fetchXSMNByDate(addDays(cursor, -1));
        if (!older.length) break;
        const m = mergeHistory(merged, older);
        if (m.added === 0) break; // không còn ngày mới → dừng
        merged = m.merged; backfilled += m.added; cursor = merged[merged.length - 1].date;
      }
    }
    const persisted = token ? await saveHistory(token, merged) : false;

    // Thống kê trên toàn bộ kho (nếu có), ngược lại trên 7 ngày mới nhất.
    const historyForStats = merged.length ? merged : fresh;
    const stats = xsmnStats(historyForStats);
    const backtest = xsmnBacktest(historyForStats); // chỉ số hiệu quả thực tế (không rò rỉ)

    const payload = {
      region: 'mien-nam',
      label: 'Xổ số Kiến thiết Miền Nam',
      source: 'minhngoc.net.vn',
      collectedAt: new Date().toISOString(),
      latestDate: fresh[0] ? fresh[0].date : historyForStats[0].date,
      today: fresh[0] || null,
      days: fresh, // danh sách ngày mới (đầy đủ giải) để hiển thị
      db: {
        persisted,
        totalDays: merged.length,
        oldest: merged.length ? merged[merged.length - 1].date : null,
        newest: merged.length ? merged[0].date : null,
        addedThisRun: added,
        backfilledThisRun: backfilled,
      },
      stats,
      backtest,
    };
    cache = { at: Date.now(), payload };
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json(payload);
  } catch (e) {
    if (cache.payload) { res.setHeader('X-Cache', 'STALE'); res.status(200).json(cache.payload); return; }
    res.status(502).json({ error: 'Thu thập XSMN thất bại', detail: String(e.message || e) });
  }
}
