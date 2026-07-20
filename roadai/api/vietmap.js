/* RoadAI — proxy VietMap (Vercel serverless, ESM) — ĐÃ VÁ BẢO MẬT.
   Vá:
   1) KHOÁ NGUỒN GỌI: chỉ phục vụ request phát ra từ chính web RoadAI (same-origin),
      chặn người ngoài curl thẳng /api/vietmap để xài chùa key trả phí của bạn.
   2) LỌC PATH: chỉ cho các endpoint app dùng (tile, autocomplete, place, route),
      chặn sanitize ký tự lạ (không SSRF, không gọi endpoint đắt tiền khác).
   Env: VIETMAP_TILE_KEY (bản đồ), VIETMAP_API_KEY (dữ liệu). */
function fromApp(req){
  const h = req.headers || {};
  const sfs = (h['sec-fetch-site'] || '').toLowerCase();
  if (sfs) return sfs === 'same-origin' || sfs === 'same-site';   // trình duyệt thật
  const host = (h['host'] || '').toLowerCase();
  const ref = h['referer'] || h['origin'] || '';
  if (ref) { try { return new URL(ref).host.toLowerCase() === host; } catch { /* noop */ } }
  return false;                                                    // curl/tool trực tiếp → chặn
}
const ALLOW = [/^tm\/\d+\/\d+\/\d+(@2x)?\.(png|jpg|jpeg|webp)$/, /^maps\//, /^autocomplete\/v\d+$/, /^place\/v\d+$/, /^route$/, /^reverse\/v\d+$/, /^geocode\/v\d+$/];

export default async function handler(req, res) {
  const TILE_KEY = (process.env.VIETMAP_TILE_KEY || '').trim();
  const API_KEY  = (process.env.VIETMAP_API_KEY || process.env.VIETMAP_KEY || '').trim();
  const q = req.query || {};
  const path = q.path;
  res.setHeader('Cache-Control', 'no-store');

  // __status: công khai (chỉ trả true/false, không lộ gì) để app dò nguồn bản đồ
  if (path === '__status') {
    return res.status(200).json({ ok: !!(TILE_KEY || API_KEY), tile: !!TILE_KEY, api: !!API_KEY });
  }
  // mọi request khác phải đến từ chính web RoadAI
  if (!fromApp(req)) return res.status(403).json({ error: 'forbidden' });
  if (!path) return res.status(400).json({ error: 'thiếu tham số path' });

  const clean = String(path).replace(/^\/+/, '');
  if (!/^[A-Za-z0-9/_.\-@]+$/.test(clean)) return res.status(400).json({ error: 'path không hợp lệ' });
  if (!ALLOW.some(re => re.test(clean)))   return res.status(403).json({ error: 'endpoint không được phép' });

  const isTile = clean.startsWith('tm/') || clean.startsWith('maps/');
  const KEY = isTile ? TILE_KEY : API_KEY;
  if (!KEY) return res.status(503).json({ error: (isTile ? 'VIETMAP_TILE_KEY' : 'VIETMAP_API_KEY') + ' chưa cấu hình' });

  const base = isTile ? `https://maps.vietmap.vn/${clean}` : `https://maps.vietmap.vn/api/${clean}`;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (k === 'path') continue;
    if (Array.isArray(v)) v.forEach(x => params.append(k, x)); else params.append(k, v);
  }
  params.append('apikey', KEY);

  try {
    const r = await fetch(`${base}?${params.toString()}`);
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', isTile ? 'public, max-age=86400, s-maxage=86400' : 'no-store');
    return res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    return res.status(502).json({ error: 'proxy VietMap thất bại', detail: String((e && e.message) || e) });
  }
}
