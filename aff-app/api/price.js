// /api/price?url=<link Shopee/TikTok>
// Đọc GIÁ + TÊN sản phẩm theo 3 lớp:
//   1) DATAFEED AccessTrade (miễn phí, chính thức) — cho SP Shopee trong kho affiliate
//   2) SCRAPER trả phí (ScraperAPI) — phủ 100% mọi SP Shopee + TikTok, cần SCRAPER_API_KEY
//   3) Không có → app cho nhập giá tay
// Đặt env SCRAPER_API_KEY (ScraperAPI, có gói free 1000 lượt/tháng) để bật lớp 2.

const AT_TOKEN   = process.env.ACCESSTRADE_TOKEN || '';
const SCRAPER    = process.env.SCRAPER_API_KEY || '';
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';

function isShopee(u){ return /shopee\.|shp\.ee/i.test(u); }
function isTiktok(u){ return /tiktok\.|tiktokv\./i.test(u); }

// tách itemid Shopee
function shopeeItemId(u){
  let m = u.match(/i\.(\d+)\.(\d+)/) || u.match(/\/product\/(\d+)\/(\d+)/);
  if(m) return m[2];
  const m2 = u.match(/(\d{6,})(?:[/?#]|$)/);
  return m2 ? m2[1] : null;
}

// lấy giá từ HTML thô (đã render) — thử nhiều nguồn
function extractFromHtml(html){
  let title = null, price = null;
  const t = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || html.match(/<title>([^<]+)<\/title>/i);
  if(t) title = t[1].replace(/\s*[|\-–]\s*(Shopee|TikTok).*$/i,'').trim();
  // Shopee nhúng "price": micro (x100000); TikTok "sale_price"/"price"
  let m = html.match(/"price"\s*:\s*"?(\d{6,})"?/) ;
  if(m){ let p = parseInt(m[1],10); if(p > 100000000) p = Math.round(p/100000); price = p; }
  if(!price){
    const mp = html.match(/product:price:amount["'][^>]+content=["']([\d.]+)["']/i)
            || html.match(/"sale_price"\s*:\s*"?([\d.]+)"?/i)
            || html.match(/[₫đ]\s*([\d][\d.,]{3,})/);
    if(mp){ let p = Math.round(parseFloat((''+mp[1]).replace(/[.,](?=\d{3})/g,''))); if(p) price = p; }
  }
  return { title, price };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // CHỐNG SAO CHÉP: chỉ phục vụ request từ web của anh (chặn web nhái)
  const ref = (req.headers.referer || req.headers.origin || '');
  if (ref && !/aff-app-ten\.vercel\.app/i.test(ref)) return res.status(403).json({ ok:false, error:'forbidden' });
  let url = (req.query.url || '').trim();
  if(!isShopee(url) && !isTiktok(url)) return res.status(400).json({ ok:false, error:'Chỉ hỗ trợ Shopee/TikTok' });

  try {
    // Resolve link rút gọn để có URL đầy đủ
    let finalUrl = url;
    if(!/i\.\d+\.\d+|\/product\/\d+\/\d+|tiktok/i.test(url)){
      try { const r0 = await fetch(url, { redirect:'follow', headers:{ 'User-Agent':UA } }); finalUrl = r0.url || url; } catch(e){}
    }

    // ---- LỚP 1: datafeed AccessTrade (chỉ Shopee) ----
    if(isShopee(finalUrl) && AT_TOKEN){
      const itemid = shopeeItemId(finalUrl);
      if(itemid){
        try{
          const fr = await fetch('https://api.accesstrade.vn/v1/datafeeds?merchant=shopee&sku=' + encodeURIComponent(itemid), { headers:{ Authorization:'Token '+AT_TOKEN } });
          const fj = await fr.json();
          const p = (fj.data || [])[0];
          if(p && p.price) return res.status(200).json({ ok:true, title:p.name||null, price:Math.round(p.price), image:p.image||null, source:'datafeed', finalUrl });
        }catch(e){}
      }
    }

    // ---- LỚP 2: scraper trả phí (Shopee + TikTok) ----
    if(SCRAPER){
      try{
        // ultra_premium = proxy dân cư mạnh nhất, cần để vượt chặn của Shopee
        const api = 'https://api.scraperapi.com/?api_key=' + SCRAPER + '&render=true&ultra_premium=true&country_code=vn&url=' + encodeURIComponent(finalUrl);
        const sr = await fetch(api, { headers:{ 'User-Agent':UA } });
        const html = await sr.text();
        const got = extractFromHtml(html);
        if(got.price) return res.status(200).json({ ok:true, title:got.title, price:got.price, source:'scraper', finalUrl });
      }catch(e){}
    }

    // ---- LỚP 3: chưa lấy được → nhập tay ----
    return res.status(200).json({ ok:false, error: SCRAPER ? 'Chưa đọc được giá SP này' : 'Sản phẩm ngoài kho — nhập giá tay', finalUrl });
  } catch (e) {
    return res.status(200).json({ ok:false, error: String(e && e.message || e) });
  }
}
