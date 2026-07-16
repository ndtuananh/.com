// /api/notify-admin — có yêu cầu đổi link mới -> đẩy thông báo cho admin.
// Lưu 1 dòng vào bảng notifications (cho admin) + push tới thiết bị admin đã bật.
// Gọi từ trang khách sau khi tạo yêu cầu (không chặn giao diện).

import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nxvcsotzybjxykadbxbr.supabase.co';
const ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dmNzb3R6eWJqeHlrYWRieGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NDg5MzIsImV4cCI6MjA5OTMyNDkzMn0.JtKX-tQIoI3NaGh6aul0XC3nSLOMgSe26aS9DAvmo_4';
const SR = process.env.SUPABASE_SERVICE_ROLE || '';

function sbFetch(path, opts){
  return fetch(SUPABASE_URL+path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SR, Authorization:'Bearer '+SR, 'Content-Type':'application/json' }, (opts&&opts.headers)||{})
  }));
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','authorization,content-type');return res.status(204).end();}
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  if(!SR) return res.status(200).json({ok:false,note:'no service role'});

  // Xác thực nhẹ: người gọi phải là user đã đăng nhập.
  const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  const u = bearer ? await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:ANON,Authorization:'Bearer '+bearer}}).then(r=>r.ok?r.json():null).catch(()=>null) : null;
  if(!u||!u.id) return res.status(401).json({error:'Cần đăng nhập'});

  let b=req.body; if(typeof b==='string'){try{b=JSON.parse(b);}catch(e){b={};}}
  const kind=(b&&b.kind)||'request';
  const code=(b&&b.code)||'', platform=(b&&b.platform)||'', phone=(b&&b.phone)||'';
  let title, body, nkind, ref;
  if(kind==='withdraw'){
    const amount=Math.round(+(b&&b.amount)||0);
    nkind='withdraw';
    title='💸 Yêu cầu RÚT TIỀN';
    body=(phone||'Khách')+' rút '+amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.')+'đ';
    ref='withdraw';
  } else {
    nkind='new_request';
    title='🟠 Yêu cầu ĐỔI LINK mới';
    body=code+' · '+(platform==='tiktok'?'TikTok Shop':'Shopee')+(phone?(' · '+phone):'');
    ref=code;
  }

  // 1) Lưu notification cho ADMIN (user_id = null). Khách KHÔNG có thông báo.
  try{ await sbFetch('/rest/v1/notifications',{method:'POST',headers:{Prefer:'return=minimal'},
    body:JSON.stringify({user_id:null,kind:nkind,title,body,ref})}); }catch(e){}

  // 2) Push tới admin đã bật thông báo
  let pushed=0;
  if(process.env.VAPID_PRIVATE && process.env.VAPID_PUBLIC){
    try{
      webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@antigravity.app', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
      const admins=await sbFetch('/rest/v1/profiles?select=push_sub&is_admin=eq.true&push_sub=not.is.null').then(r=>r.json()).catch(()=>[]);
      const payload=JSON.stringify({title,body,url:'/'});
      for(const a of (admins||[])){ try{ await webpush.sendNotification(a.push_sub,payload); pushed++; }catch(e){} }
    }catch(e){}
  }
  return res.status(200).json({ ok:true, pushed });
}
