// /api/health — TỰ KIỂM tra toàn bộ hệ thống + cảnh báo khi có lỗi.
// Chạy bằng: admin bấm "Kiểm tra hệ thống" trong app, HOẶC cron-job.org gọi
//   https://aff-app-ten.vercel.app/api/health?key=<CRON_SECRET>
// Nếu có lỗi + có push -> đẩy cảnh báo về điện thoại admin ngay.

import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nxvcsotzybjxykadbxbr.supabase.co';
const ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dmNzb3R6eWJqeHlrYWRieGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NDg5MzIsImV4cCI6MjA5OTMyNDkzMn0.JtKX-tQIoI3NaGh6aul0XC3nSLOMgSe26aS9DAvmo_4';
const SR   = process.env.SUPABASE_SERVICE_ROLE || '';
const AT   = process.env.ACCESSTRADE_TOKEN || '';
const CRON = process.env.CRON_SECRET || '';

async function isAdmin(bearer){
  if(!bearer) return false;
  const u = await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:ANON,Authorization:'Bearer '+bearer}}).then(r=>r.ok?r.json():null).catch(()=>null);
  if(!u||!u.id) return false;
  const rows = await fetch(SUPABASE_URL+'/rest/v1/profiles?select=is_admin&id=eq.'+u.id,{headers:{apikey:SR,Authorization:'Bearer '+SR}}).then(r=>r.json()).catch(()=>[]);
  return !!(rows&&rows[0]&&rows[0].is_admin);
}

async function checkFn(fn, body){
  try{
    const r = await fetch(SUPABASE_URL+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:SR,Authorization:'Bearer '+SR,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
    const t = await r.text();
    const missing = /PGRST202|Could not find the function/i.test(t);
    return !missing;   // tồn tại (kể cả khi báo lỗi quyền) = OK
  }catch(e){ return false; }
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  const key = (req.query&&req.query.key)||'';
  const bearer = (req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  const authed = (CRON && (key===CRON || bearer===CRON)) || (await isAdmin(bearer));
  if(!authed) return res.status(401).json({ ok:false, error:'Không có quyền' });

  const checks = [];
  const add = (name, ok, note) => checks.push({ name, ok:!!ok, note: note||'' });

  // 1) Database Supabase
  try{ const r=await fetch(SUPABASE_URL+'/rest/v1/profiles?select=id&limit=1',{headers:{apikey:SR,Authorization:'Bearer '+SR}}); add('Database Supabase', r.ok); }
  catch(e){ add('Database Supabase', false, String(e&&e.message)); }

  // 2) AccessTrade (đối soát + đọc giá)
  try{ const r=await fetch('https://api.accesstrade.vn/v1/datafeeds?merchant=shopee&limit=1',{headers:{Authorization:'Token '+AT}}); add('AccessTrade API', r.ok); }
  catch(e){ add('AccessTrade API', false, String(e&&e.message)); }

  // 3) Biến môi trường quan trọng
  add('Cấu hình: service_role', !!SR);
  add('Cấu hình: AccessTrade token', !!AT);
  add('Cấu hình: Email (Resend)', !!process.env.RESEND_API_KEY);
  add('Cấu hình: Thông báo đẩy (VAPID)', !!process.env.VAPID_PRIVATE);
  add('Cấu hình: Bảo mật cron', !!CRON);

  // 4) Các hàm tài chính quan trọng còn nguyên vẹn
  add('Hàm cộng/thu hồi (settle_order)', await checkFn('settle_order',{p_order_id:0}));
  add('Hàm duyệt rút (approve_withdrawal)', await checkFn('approve_withdrawal',{withdrawal_id:0}));
  add('Hàm thống kê (admin_stats)', await checkFn('admin_stats',{}));
  add('Hàm lưu thông báo (save_push_sub)', await checkFn('save_push_sub',{sub:{}}));

  const failed = checks.filter(c=>!c.ok);
  const allOk = failed.length===0;

  // Có lỗi + có push -> cảnh báo admin ngay
  if(!allOk && process.env.VAPID_PRIVATE && SR){
    try{
      webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@app', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
      const admins = await fetch(SUPABASE_URL+'/rest/v1/profiles?select=push_sub&is_admin=eq.true&push_sub=not.is.null',{headers:{apikey:SR,Authorization:'Bearer '+SR}}).then(r=>r.json()).catch(()=>[]);
      const payload = JSON.stringify({ title:'🚨 Hệ thống có lỗi!', body: failed.map(f=>f.name).join(', '), url:'/' });
      for(const a of (admins||[])){ try{ await webpush.sendNotification(a.push_sub, payload); }catch(e){} }
    }catch(e){}
  }

  return res.status(200).json({ ok:allOk, summary: allOk?'Tất cả hệ thống hoạt động tốt':(failed.length+' hạng mục cần kiểm tra'), checks });
}
