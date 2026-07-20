// /api/notify-withdrawal
// Khi có yêu cầu rút: (1) gửi EMAIL (Resend, dự phòng FormSubmit) + (2) đẩy
// PUSH NOTIFICATION lên điện thoại admin (Web Push) để xử lý nhanh.

import webpush from 'web-push';

const ADMIN_EMAIL  = 'nguyendinhtuananh1992@gmail.com';
const SITE         = 'https://aff-app-ten.vercel.app';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nxvcsotzybjxykadbxbr.supabase.co';
const ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dmNzb3R6eWJqeHlrYWRieGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NDg5MzIsImV4cCI6MjA5OTMyNDkzMn0.JtKX-tQIoI3NaGh6aul0XC3nSLOMgSe26aS9DAvmo_4';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';
const RESEND_KEY   = process.env.RESEND_API_KEY || '';
const VAPID_PUB    = process.env.VAPID_PUBLIC || '';
const VAPID_PRIV   = process.env.VAPID_PRIVATE || '';
const VAPID_SUBJ   = process.env.VAPID_SUBJECT || 'mailto:' + ADMIN_EMAIL;

function vnd(n){ return (Number(n)||0).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.')+'đ'; }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function buildHtml(d){
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;background:#f7f8fa;padding:20px;border-radius:14px">
    <div style="background:#12233D;color:#fff;padding:18px 20px;border-radius:12px 12px 0 0">
      <div style="font-size:18px;font-weight:700">💸 Yêu cầu rút tiền mới</div>
      <div style="font-size:13px;opacity:.8;margin-top:4px">Hoàn Tiền Shopee</div>
    </div>
    <div style="background:#fff;padding:20px;border:1px solid #e3e7ee;border-top:none">
      <div style="font-size:30px;font-weight:800;color:#EE4D2D;text-align:center;margin-bottom:16px">${vnd(d.amount)}</div>
      <table style="width:100%;font-size:14px;border-collapse:collapse">
        <tr><td style="padding:7px 0;color:#6b7686">Khách (SĐT)</td><td style="padding:7px 0;text-align:right;font-weight:600">${esc(d.phone)}</td></tr>
        <tr><td style="padding:7px 0;color:#6b7686;border-top:1px solid #eef1f6">Ngân hàng</td><td style="padding:7px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6">${esc(d.bank)}</td></tr>
        <tr><td style="padding:7px 0;color:#6b7686;border-top:1px solid #eef1f6">Số tài khoản</td><td style="padding:7px 0;text-align:right;font-weight:700;font-size:16px;border-top:1px solid #eef1f6">${esc(d.acc)}</td></tr>
        <tr><td style="padding:7px 0;color:#6b7686;border-top:1px solid #eef1f6">Chủ tài khoản</td><td style="padding:7px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6">${esc(d.name)}</td></tr>
      </table>
      ${d.qr?`<div style="text-align:center;margin-top:18px"><img src="${esc(d.qr)}" alt="VietQR" style="width:200px;border:1px solid #e3e7ee;border-radius:12px"><div style="font-size:12px;color:#6b7686;margin-top:6px">Mở app MBBank quét mã để chuyển</div></div>`:''}
      <a href="${SITE}" style="display:block;text-align:center;background:#0E8A5F;color:#fff;text-decoration:none;padding:13px;border-radius:10px;font-weight:700;margin-top:18px">Mở app → tab Admin → "Đã chuyển"</a>
    </div>
  </div>`;
}

// GET PostgREST bằng service_role
async function sbGet(path){
  const r = await fetch(SUPABASE_URL + '/rest/v1' + path, {
    headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE }
  });
  return r.ok ? r.json() : [];
}

async function sendEmail(d, subject){
  if(RESEND_KEY){
    const rr = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+RESEND_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ from:'Hoan Tien Shopee <onboarding@resend.dev>', to:[ADMIN_EMAIL], subject, html: buildHtml(d) })
    });
    return { provider:'resend', ok: rr.ok };
  }
  const msg = 'YÊU CẦU RÚT TIỀN MỚI\n\nKhách: '+d.phone+'\nSố tiền: '+vnd(d.amount)+'\nNgân hàng: '+d.bank+'\nSố TK: '+d.acc+'\nChủ TK: '+d.name+'\n\nVietQR: '+d.qr;
  const fr = await fetch('https://formsubmit.co/ajax/'+ADMIN_EMAIL, {
    method:'POST',
    headers:{ 'Content-Type':'application/json','Accept':'application/json','Origin':SITE,'Referer':SITE+'/' },
    body: JSON.stringify({ _subject:subject, name:'Hoan Tien Shopee', message: msg })
  });
  return { provider:'formsubmit', ok: fr.ok };
}

async function sendPush(d){
  if(!VAPID_PUB || !VAPID_PRIV || !SERVICE_ROLE) return { sent:0 };
  webpush.setVapidDetails(VAPID_SUBJ, VAPID_PUB, VAPID_PRIV);
  const admins = await sbGet('/profiles?select=push_sub&is_admin=eq.true&push_sub=not.is.null');
  const payload = JSON.stringify({
    title: '💸 Yêu cầu rút ' + vnd(d.amount),
    body: d.phone + ' • ' + d.bank + ' ' + d.acc,
    url: '/'
  });
  let sent = 0;
  for(const a of (admins||[])){
    try { await webpush.sendNotification(a.push_sub, payload); sent++; } catch(e){}
  }
  return { sent };
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  if(req.method !== 'POST') return res.status(405).json({ ok:false, error:'method' });
  try{
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
    if(!bearer) return res.status(401).json({ ok:false, error:'unauthorized' });
    const ur = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: ANON, Authorization: 'Bearer ' + bearer } });
    if(!ur.ok) return res.status(401).json({ ok:false, error:'unauthorized' });

    const b = (typeof req.body === 'string' ? JSON.parse(req.body||'{}') : (req.body||{}));
    const d = { phone:b.phone||'', amount:b.amount||0, bank:b.bank||'', acc:b.acc||'', name:b.name||'', qr:b.qr||'' };
    const subject = '💸 Rút tiền ' + vnd(d.amount) + ' — ' + d.phone;

    const [email, push] = await Promise.all([
      sendEmail(d, subject).catch(e => ({ error:String(e) })),
      sendPush(d).catch(e => ({ sent:0, error:String(e) }))
    ]);
    return res.status(200).json({ ok:true, email, push });
  }catch(e){
    return res.status(200).json({ ok:false, error: String(e && e.message || e) });
  }
}
