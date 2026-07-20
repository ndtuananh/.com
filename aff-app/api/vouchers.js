// /api/vouchers?merchant=shopee
// Kéo voucher/khuyến mãi từ AccessTrade (offers_informations), trả JSON gọn.
// Cache CDN 30 phút → nhẹ cho app + cập nhật liên tục, token ẩn phía server.

const AT_TOKEN = process.env.ACCESSTRADE_TOKEN || '';

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  // CHỐNG SAO CHÉP: chỉ phục vụ web của anh (chặn web nhái)
  const ref = (req.headers.referer || req.headers.origin || '');
  if (ref && !/aff-app-ten\.vercel\.app/i.test(ref)) return res.status(403).json({ ok:false, error:'forbidden', vouchers:[] });
  // Vercel CDN giữ 30 phút, phục vụ bản cũ trong lúc làm mới ngầm
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');

  if(!AT_TOKEN) return res.status(200).json({ ok:false, error:'Chưa cấu hình token', vouchers:[] });
  try{
    const merchant = String((req.query && req.query.merchant) || 'shopee').replace(/[^a-z0-9_]/gi,'').slice(0,20) || 'shopee';
    const r = await fetch('https://api.accesstrade.vn/v1/offers_informations?merchant=' + merchant + '&limit=40', {
      headers: { Authorization: 'Token ' + AT_TOKEN }
    });
    const j = await r.json();
    const vouchers = (j.data || []).map(o => {
      let code = '';
      if(Array.isArray(o.coupons) && o.coupons.length){
        const c = o.coupons[0];
        code = typeof c === 'string' ? c : (c.code || c.coupon_code || c.coupon || '');
      }
      return {
        name: o.name || '',
        image: o.image || '',
        end: o.end_time || '',
        link: o.aff_link || o.link || '',
        code: code
      };
    }).filter(v => v.link && v.name);
    return res.status(200).json({ ok:true, count: vouchers.length, vouchers });
  }catch(e){
    return res.status(200).json({ ok:false, error: String(e && e.message || e), vouchers:[] });
  }
}
