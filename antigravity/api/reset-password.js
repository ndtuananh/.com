// /api/reset-password — ADMIN cấp lại mật khẩu cho khách (đã xác minh qua Zalo).
// An toàn cho app giữ tiền: KHÔNG cho tự đặt lại chỉ bằng SĐT. Chỉ ADMIN gọi được.
// Đặt mật khẩu TẠM + bật cờ user_metadata.force_pw=true -> khách đăng nhập BẮT đổi ngay.
//
// Body JSON: { phone, password }
// Trả: { ok, phone } hoặc { error }

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nxvcsotzybjxykadbxbr.supabase.co';
const ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dmNzb3R6eWJqeHlrYWRieGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NDg5MzIsImV4cCI6MjA5OTMyNDkzMn0.JtKX-tQIoI3NaGh6aul0XC3nSLOMgSe26aS9DAvmo_4';
const SR = process.env.SUPABASE_SERVICE_ROLE || '';

function sbFetch(path, opts){
  return fetch(SUPABASE_URL+path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SR, Authorization:'Bearer '+SR, 'Content-Type':'application/json' }, (opts&&opts.headers)||{})
  }));
}
async function isAdmin(bearer){
  if(!bearer) return false;
  const u = await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:ANON,Authorization:'Bearer '+bearer}}).then(r=>r.ok?r.json():null).catch(()=>null);
  if(!u||!u.id) return false;
  const rows = await sbFetch('/rest/v1/profiles?select=is_admin&id=eq.'+u.id).then(r=>r.json()).catch(()=>[]);
  return !!(rows&&rows[0]&&rows[0].is_admin);
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','authorization,content-type');return res.status(204).end();}
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  if(!SR) return res.status(500).json({error:'Thiếu SUPABASE_SERVICE_ROLE trên Vercel'});

  const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!(await isAdmin(bearer))) return res.status(401).json({error:'Chỉ admin'});

  let b=req.body; if(typeof b==='string'){try{b=JSON.parse(b);}catch(e){b={};}}
  const phone=String((b&&b.phone)||'').replace(/\D/g,'');
  const password=String((b&&b.password)||'');
  const acc=String((b&&b.acc)||'').replace(/\s/g,'');   // (tuỳ chọn) STK rút gần nhất khách đọc để xác minh phụ
  if(!/^0\d{8,10}$/.test(phone)) return res.status(400).json({error:'SĐT không hợp lệ'});
  if(password.length<6) return res.status(400).json({error:'Mật khẩu tạm cần từ 6 ký tự'});

  // Tìm đúng user theo SĐT (profiles.id = auth.users.id)
  const rows = await sbFetch('/rest/v1/profiles?select=id,phone&phone=eq.'+encodeURIComponent(phone)).then(r=>r.json()).catch(()=>[]);
  const target = rows && rows[0];
  if(!target || !target.id) return res.status(404).json({error:'Không tìm thấy tài khoản với SĐT này'});

  // XÁC MINH PHỤ (tuỳ chọn): nếu admin nhập STK -> phải khớp lần rút gần nhất của khách.
  if(acc){
    const wd = await sbFetch('/rest/v1/withdrawals?select=account_no&user_id=eq.'+target.id+'&order=created_at.desc&limit=1').then(r=>r.json()).catch(()=>[]);
    const last = wd && wd[0] && String(wd[0].account_no||'').replace(/\s/g,'');
    if(last && last !== acc) return res.status(403).json({error:'Số tài khoản không khớp lần rút gần nhất — hãy xác minh lại, KHÔNG cấp mật khẩu.'});
    // nếu khách chưa từng rút -> không có gì để đối chiếu, cho qua (chỉ dựa Zalo).
  }

  // GoTrue admin: đặt mật khẩu + cờ buộc đổi (force_pw). user_metadata được merge.
  const r = await sbFetch('/auth/v1/admin/users/'+target.id, {
    method:'PUT',
    body: JSON.stringify({ password: password, user_metadata: { force_pw: true } })
  });
  if(!r.ok){ const t=await r.text(); return res.status(500).json({error:'Không đặt lại được: '+t.slice(0,200)}); }

  return res.status(200).json({ ok:true, phone });
}
