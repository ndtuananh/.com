/* ══════════════════════════════════════════════════════════════════════════════
   RoadAI · Driver Radar — /api/health

   Làm ĐÚNG hai việc:

   ① GIỮ CHO KHO DỮ LIỆU KHÔNG CHẾT.
      Project Supabase đang dùng là gói FREE — nó **tự ngủ (INACTIVE)** khi lâu
      không có truy vấn nào, và lúc đó mọi thao tác đồng bộ của tài xế đều lỗi.
      Đánh thức lại mất 2–3 phút, mà tài xế thì đang đứng ngoài đường lúc 11 giờ
      đêm. Vercel cron gọi endpoint này mỗi ngày (xem vercel.json) → luôn có
      truy vấn → kho không bao giờ rơi vào trạng thái ngủ.

   ② NÓI THẬT KHO CÓ SỐNG KHÔNG.
      Trả về độ trễ đo được và số dòng đang giữ. Màn "Chẩn đoán hệ thống" đọc
      cái này. Không có nó thì kho chết mà app vẫn im lặng, đúng kiểu lỗi khó
      chịu nhất: tài xế bấm ghi cuốc, thấy chữ "đã ghi", mà thật ra không lên
      được máy chủ.

   KHÔNG trả về bất cứ dữ liệu nghiệp vụ nào của tài xế — chỉ đếm và đo.
   ══════════════════════════════════════════════════════════════════════════════ */
export const config = { maxDuration: 20 };

const SB_URL = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const t0 = Date.now();
  if (!SB_URL() || !SB_KEY()) {
    return res.status(200).json({ ok: false, db: 'chua_cau_hinh', reason: 'thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE' });
  }
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
  try {
    /* Đếm dòng bằng Prefer: count=exact + Range 0-0 → Postgres trả đúng con số
       trong header Content-Range mà KHÔNG kéo dữ liệu về. Vừa rẻ vừa đủ để
       đánh thức kho. */
    const k = SB_KEY();
    const r = await fetch(SB_URL() + '/rest/v1/butl_sync?select=device&limit=1', {
      headers: { apikey: k, Authorization: 'Bearer ' + k, Prefer: 'count=exact', Range: '0-0' },
      signal: ctl.signal, cache: 'no-store',
    });
    const ms = Date.now() - t0;
    if (!r.ok) return res.status(200).json({ ok: false, db: 'loi', status: r.status, ms, reason: (await r.text()).slice(0, 120) });
    const cr = r.headers.get('content-range') || '';          // dạng "0-0/42"
    const rows = parseInt(cr.split('/')[1], 10);
    // cột trips/zones đã thêm chưa — để màn Chẩn đoán khỏi phải đoán
    const c = await fetch(SB_URL() + '/rest/v1/butl_sync?select=trips,zones&limit=1', {
      headers: { apikey: k, Authorization: 'Bearer ' + k }, signal: ctl.signal, cache: 'no-store',
    });
    return res.status(200).json({
      ok: true, db: 'song', ms, rows: Number.isFinite(rows) ? rows : null,
      schema: c.ok ? 'day_du' : 'thieu_cot',
      at: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(200).json({ ok: false, db: 'khong_noi_duoc', ms: Date.now() - t0, reason: String((e && e.message) || e).slice(0, 120) });
  } finally { clearTimeout(to); }
}
