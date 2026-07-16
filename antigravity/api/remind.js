// /api/remind — NHẮC ADMIN việc còn tồn đọng để xử lý KỊP THỜI cho khách.
// Đẩy push nếu còn yêu cầu đổi link / rút tiền chưa xử lý.
// Gọi bằng cron Vercel (hằng ngày) hoặc cron-job.org (dày hơn):
//   https://<app>/api/remind?key=<CRON_SECRET>
import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nxvcsotzybjxykadbxbr.supabase.co';
const ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dmNzb3R6eWJqeHlrYWRieGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NDg5MzIsImV4cCI6MjA5OTMyNDkzMn0.JtKX-tQIoI3NaGh6aul0XC3nSLOMgSe26aS9DAvmo_4';
const SR = process.env.SUPABASE_SERVICE_ROLE || '';
const CRON = process.env.CRON_SECRET || '';

function sbFetch(path, opts){ return fetch(SUPABASE_URL+path, Object.assign({}, opts, {
  headers: Object.assign({ apikey: SR, Authorization:'Bearer '+SR }, (opts&&opts.headers)||{}) })); }
async function isAdmin(bearer){
  if(!bearer) return false;
  const u = await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:ANON,Authorization:'Bearer '+bearer}}).then(r=>r.ok?r.json():null).catch(()=>null);
  if(!u||!u.id) return false;
  const rows = await sbFetch('/rest/v1/profiles?select=is_admin&id=eq.'+u.id).then(r=>r.json()).catch(()=>[]);
  return !!(rows&&rows[0]&&rows[0].is_admin);
}
async function countRows(table, filter){
  const r = await sbFetch('/rest/v1/'+table+'?select=id&'+filter, { headers:{ Prefer:'count=exact', Range:'0-0' } });
  const cr = r.headers.get('content-range')||'*/0';
  return parseInt(cr.split('/')[1]||'0',10) || 0;
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(!SR) return res.status(500).json({error:'Thiếu SUPABASE_SERVICE_ROLE'});
  const key=(req.query&&req.query.key)||'';
  const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  const authed = (CRON && (key===CRON || bearer===CRON)) || (await isAdmin(bearer));
  if(!authed) return res.status(401).json({error:'Không có quyền'});

  const reqPending = await countRows('ag_requests','status=eq.pending');
  const wdPending  = await countRows('withdrawals','status=eq.pending');
  let pushed = 0;

  if((reqPending + wdPending) > 0 && process.env.VAPID_PRIVATE && process.env.VAPID_PUBLIC){
    try{
      webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@antigravity.app', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
      const parts=[];
      if(reqPending>0) parts.push('🔗 '+reqPending+' link chờ đổi');
      if(wdPending>0)  parts.push('💸 '+wdPending+' yêu cầu rút');
      const payload=JSON.stringify({ title:'⏰ AntiGravity — việc cần xử lý', body: parts.join(' · ')+' — mở app xử lý cho khách nhé!', url:'/' });
      const admins=await sbFetch('/rest/v1/profiles?select=push_sub&is_admin=eq.true&push_sub=not.is.null').then(r=>r.json()).catch(()=>[]);
      for(const a of (admins||[])){ try{ await webpush.sendNotification(a.push_sub, payload); pushed++; }catch(e){} }
    }catch(e){}
  }
  return res.status(200).json({ ok:true, pending_requests:reqPending, pending_withdrawals:wdPending, pushed });
}
