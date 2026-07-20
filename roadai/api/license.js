/* RoadAI — cấp & xác minh MÃ KÍCH HOẠT (serverless, không cần DB).
   Dùng HMAC-SHA256 ký chuỗi {email, plan, exp} bằng secret trên server → không thể giả mạo.
   Env cần đặt trên Vercel:
     ROADAI_SIGN_SECRET   — bí mật ký mã (chuỗi ngẫu nhiên dài)
     ROADAI_ADMIN_SECRET  — mật khẩu để CHỦ shop cấp mã (dùng ở /admin.html)
   Luồng: khách CK → shop mở /admin.html nhập secret+email+gói → nhận token → gửi khách →
          khách dán token vào app → app gọi ?action=verify → mở gói cho đúng email. */
import crypto from 'crypto';

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64url = s => Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString();
const sign = (payload, secret) => b64url(crypto.createHmac('sha256', secret).update(payload).digest());
// so sánh chuỗi chống timing-attack
function safeEq(a, b){ const x=Buffer.from(String(a)), y=Buffer.from(String(b)); if(x.length!==y.length) return false; try{ return crypto.timingSafeEqual(x,y); }catch{ return false; } }
function fromApp(req){
  const h=req.headers||{}; const sfs=(h['sec-fetch-site']||'').toLowerCase();
  if(sfs) return sfs==='same-origin'||sfs==='same-site';
  const host=(h['host']||'').toLowerCase(), ref=h['referer']||h['origin']||'';
  if(ref){ try{ return new URL(ref).host.toLowerCase()===host; }catch{} }
  return false;
}

export default async function handler(req, res) {
  const SIGN  = (process.env.ROADAI_SIGN_SECRET  || '').trim();
  const ADMIN = (process.env.ROADAI_ADMIN_SECRET || '').trim();
  const q = req.query || {};
  const action = q.action;
  res.setHeader('Cache-Control', 'no-store');

  if (!SIGN) return res.status(503).json({ ok:false, error:'ROADAI_SIGN_SECRET chưa cấu hình trên máy chủ' });

  if (action === 'verify') {
    const token = String(q.token || '');
    const [body, sig] = token.split('.');
    if (!body || !sig) return res.status(200).json({ ok:false });
    const expect = sign(body, SIGN);
    let good = false;
    try { good = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect)); } catch { good = false; }
    if (!good) return res.status(200).json({ ok:false });
    let data; try { data = JSON.parse(unb64url(body)); } catch { return res.status(200).json({ ok:false }); }
    if (data.exp && Date.now() > data.exp) return res.status(200).json({ ok:false, error:'expired' });
    return res.status(200).json({ ok:true, email:data.email, plan:data.plan, exp:data.exp });
  }

  if (action === 'issue') {
    if (!fromApp(req)) return res.status(403).json({ ok:false, error:'forbidden' });
    // admin secret nhận qua HEADER (không nằm trên URL → không lộ vào log/history)
    const given = req.headers['x-roadai-admin'] || '';
    if (!ADMIN || !safeEq(given, ADMIN)) return res.status(403).json({ ok:false, error:'Sai admin secret' });
    const email = String(q.email || '').trim().toLowerCase();
    const plan  = String(q.plan  || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok:false, error:'email không hợp lệ' });
    if (!['basic','pro','max'].includes(plan))     return res.status(400).json({ ok:false, error:'plan phải là basic|pro|max' });
    const days = Math.max(1, Math.min(400, Number(q.days || 31)));
    const body = b64url(JSON.stringify({ email, plan, exp: Date.now() + days*86400000, iat: Date.now() }));
    const token = body + '.' + sign(body, SIGN);
    return res.status(200).json({ ok:true, token, email, plan, days });
  }

  return res.status(400).json({ ok:false, error:'action phải là verify|issue' });
}
