// ============================================================================
// api/xsmn.js — Serverless collector cho Xổ số Kiến thiết Miền Nam (nguồn: minhngoc).
// Trả JSON đã chuẩn hoá: các ngày gần đây + thống kê MÔ TẢ 00–99 (đề/lô). Có cache
// + fallback cache cũ nếu nguồn lỗi. KHÔNG dự đoán — chỉ nghiên cứu trên lịch sử.
// ============================================================================
import { fetchXSMN, xsmnStats } from '../js/minhngoc.js';

let cache = { at: 0, payload: null };
const TTL_MS = 5 * 60 * 1000;

export default async function handler(req, res) {
  const warm = req.query && req.query.warm;
  if (cache.payload && !warm && Date.now() - cache.at < TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'HIT');
    res.status(200).json(cache.payload);
    return;
  }
  try {
    const days = await fetchXSMN();
    if (!days.length) throw new Error('Không lấy được kết quả XSMN từ nguồn');
    const stats = xsmnStats(days);
    const payload = {
      region: 'mien-nam',
      label: 'Xổ số Kiến thiết Miền Nam',
      source: 'minhngoc.net.vn',
      collectedAt: new Date().toISOString(),
      latestDate: days[0].date,
      days,
      stats,
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
