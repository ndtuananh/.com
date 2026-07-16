// /api/notify-user — ĐẨY THÔNG BÁO TỚI KHÁCH khi admin xử lý yêu cầu của họ.
// Gọi từ trang admin sau mỗi thao tác: hoàn tất link, từ chối, duyệt/từ chối rút tiền…
// Web Push (PWA) -> tới thiết bị khách kể cả khi KHÔNG mở app. Bấm vào mở đúng màn hình.
//
// Body JSON: { kind, request_id?, withdrawal_id?, user_id?, code?, amount?, note? }
//   kind: 'ready' | 'rejected' | 'wd_approved' | 'wd_rejected' | 'credit'
// Chỉ ADMIN mới được gọi (xác thực bằng access token).

import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nxvcsotzybjxykadbxbr.supabase.co';
const ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dmNzb3R6eWJqeHlrYWRieGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NDg5MzIsImV4cCI6MjA5OTMyNDkzMn0.JtKX-tQIoI3NaGh6aul0XC3nSLOMgSe26aS9DAvmo_4';
const SR = process.env.SUPABASE_SERVICE_ROLE || '';

function sbFetch(path, opts){
  return fetch(SUPABASE_URL+path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SR, Authorization:'Bearer '+SR, 'Content-Type':'application/json' }, (opts&&opts.headers)||{})
  }));
}
function vnd(n){return Math.round(+n||0).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.')+'đ';}
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
  if(!SR) return res.status(200).json({ok:false,note:'no service role'});

  const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!(await isAdmin(bearer))) return res.status(401).json({error:'Chỉ admin'});

  let b=req.body; if(typeof b==='string'){try{b=JSON.parse(b);}catch(e){b={};}}
  const kind=(b&&b.kind)||'';
  let user_id=(b&&b.user_id)||null, code=(b&&b.code)||'', amount=+(b&&b.amount)||0, note=(b&&b.note)||'';

  // Suy ra khách từ request_id / withdrawal_id nếu chưa có
  try{
    if(!user_id && b && b.request_id){
      const r=await sbFetch('/rest/v1/ag_requests?select=user_id,code&id=eq.'+encodeURIComponent(b.request_id)).then(r=>r.json()).catch(()=>[]);
      if(r&&r[0]){user_id=r[0].user_id;code=code||r[0].code;}
    }
    if(!user_id && b && b.withdrawal_id){
      const r=await sbFetch('/rest/v1/withdrawals?select=user_id,amount&id=eq.'+encodeURIComponent(b.withdrawal_id)).then(r=>r.json()).catch(()=>[]);
      if(r&&r[0]){user_id=r[0].user_id;amount=amount||r[0].amount;}
    }
  }catch(e){}
  if(!user_id) return res.status(200).json({ok:false,note:'no target user'});

  // Nội dung theo loại sự kiện
  let title,body,url,ref;
  if(kind==='ready'){ title='🎉 Link của bạn đã sẵn sàng!'; body='Yêu cầu '+code+' đã có link hoa hồng — bấm để mở sản phẩm mua & nhận hoàn tiền ngay.'; url='/?go=req&open='+encodeURIComponent(code); ref=code; }
  else if(kind==='rejected'){ title='⚠️ Yêu cầu '+code+' chưa đổi được'; body=note||'Mở app xem chi tiết và thử gửi link khác nhé.'; url='/?go=req'; ref=code; }
  else if(kind==='wd_approved'){ title='✅ Đã chuyển tiền cho bạn!'; body='Rút '+vnd(amount)+' đã chuyển về ngân hàng. Kiểm tra tài khoản nhé.'; url='/?go=wallet'; ref='withdraw'; }
  else if(kind==='wd_rejected'){ title='⚠️ Yêu cầu rút bị từ chối'; body=note||'Mở app phần Ví để xem lý do và tạo lại yêu cầu.'; url='/?go=wallet'; ref='withdraw'; }
  else if(kind==='credit'){ title='💵 +'+vnd(amount)+' hoa hồng vào ví'; body='Đơn của bạn đã đối soát xong và được cộng hoa hồng. Xem ở phần Ví.'; url='/?go=wallet'; ref='cashback'; }
  else return res.status(400).json({error:'kind không hợp lệ'});

  // Lưu thông báo cho khách (best-effort — không chặn nếu bảng chưa có)
  try{ await sbFetch('/rest/v1/notifications',{method:'POST',headers:{Prefer:'return=minimal'},
    body:JSON.stringify({user_id,kind:(kind==='ready'||kind==='rejected')?'request':'wallet',title,body,ref})}); }catch(e){}

  // Push tới thiết bị khách đã bật thông báo
  let pushed=0;
  if(process.env.VAPID_PRIVATE && process.env.VAPID_PUBLIC){
    try{
      webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@antigravity.app', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
      const prof=await sbFetch('/rest/v1/profiles?select=push_sub&id=eq.'+user_id+'&push_sub=not.is.null').then(r=>r.json()).catch(()=>[]);
      const sub=prof&&prof[0]&&prof[0].push_sub;
      if(sub){ const payload=JSON.stringify({title,body,url});
        try{ await webpush.sendNotification(sub,payload); pushed++; }
        catch(err){ // subscription hết hạn -> xoá để lần sau khỏi lỗi
          if(err&&(err.statusCode===404||err.statusCode===410)){
            try{ await sbFetch('/rest/v1/profiles?id=eq.'+user_id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({push_sub:null})}); }catch(e){}
          }
        }
      }
    }catch(e){}
  }
  return res.status(200).json({ok:true,pushed});
}
