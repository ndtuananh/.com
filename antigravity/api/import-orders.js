// /api/import-orders — NẠP BÁO CÁO ĐỐI SOÁT (Shopee + TikTok) rồi tự cộng ví.
// Nhận JSON { orders:[{order_id, track_code, commission, order_value, status,
//   order_time, platform, shop_name, product_title}, ...] } từ trang admin.
//
// Thiết kế cho quy mô lớn:
//  • BULK UPSERT theo lô 500 dòng, chống trùng bằng order_id (unique).
//  • Khớp track_code (mã AG) -> user_id bằng 1 truy vấn gộp, không N+1.
//  • Cộng ví bằng 1 lệnh SET-BASED (RPC ag_reconcile) — chịu triệu đơn.
//  • Idempotent: nạp lại cùng báo cáo không cộng tiền 2 lần.

import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nxvcsotzybjxykadbxbr.supabase.co';
const ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dmNzb3R6eWJqeHlrYWRieGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NDg5MzIsImV4cCI6MjA5OTMyNDkzMn0.JtKX-tQIoI3NaGh6aul0XC3nSLOMgSe26aS9DAvmo_4';
const SR = process.env.SUPABASE_SERVICE_ROLE || '';

// Tỷ lệ hoa hồng chia cho khách (0.5 = khách nhận 50%, app giữ 50%). Đổi qua env COMMISSION_SHARE.
// CÔNG THỨC ẨN — không hiển thị cho khách; khách chỉ thấy số tiền đã cộng.
const COMMISSION_SHARE = parseFloat(process.env.COMMISSION_SHARE || '0.5');
// Số ngày "giam" trước khi cho rút. 0 = cộng THẲNG vào số dư ngay khi đối soát.
const HOLD_DAYS = parseInt(process.env.HOLD_DAYS || '0', 10);

function sbFetch(path, opts){
  return fetch(SUPABASE_URL + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' }, (opts && opts.headers) || {})
  }));
}
async function isAdmin(bearer){
  if(!bearer) return false;
  const u = await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:ANON,Authorization:'Bearer '+bearer}}).then(r=>r.ok?r.json():null).catch(()=>null);
  if(!u||!u.id) return false;
  const rows = await sbFetch('/rest/v1/profiles?select=is_admin&id=eq.'+u.id).then(r=>r.json()).catch(()=>[]);
  return !!(rows&&rows[0]&&rows[0].is_admin);
}
function toISO(s){ if(!s) return null;
  // hỗ trợ "12:07 12-07-2026", "12-07-2026", "2026-07-12", ISO...
  s=String(s).trim();
  let m=s.match(/(\d{1,2}):(\d{2})\s+(\d{1,2})-(\d{1,2})-(\d{4})/);
  if(m) return new Date(+m[5],+m[4]-1,+m[3],+m[1],+m[2]).toISOString();
  m=s.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if(m) return new Date(+m[3],+m[2]-1,+m[1]).toISOString();
  // dd/mm/yyyy [hh:mm[:ss]]  (TikTok)
  m=s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if(m) return new Date(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0)).toISOString();
  const d=new Date(s); return isNaN(d)?null:d.toISOString();
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','authorization,content-type');return res.status(204).end();}
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  if(!SR) return res.status(500).json({error:'Thiếu SUPABASE_SERVICE_ROLE trên Vercel'});

  const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!(await isAdmin(bearer))) return res.status(401).json({error:'Chỉ admin'});

  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body);}catch(e){return res.status(400).json({error:'JSON không hợp lệ'});}}
  const orders=(body&&body.orders)||[];
  if(!Array.isArray(orders)||!orders.length) return res.status(400).json({error:'Không có đơn nào'});
  if(orders.length>50000) return res.status(413).json({error:'Tối đa 50.000 đơn mỗi lần nạp'});

  // 1a) Gom mã AG (Sub_id Shopee) -> tra user_id 1 lần (không N+1)
  const codes=[...new Set(orders.map(o=>(o.track_code||'').toUpperCase()).filter(c=>/^AG\d{4,}$/.test(c)))];
  const codeToUser={};
  for(let i=0;i<codes.length;i+=300){
    const chunk=codes.slice(i,i+300);
    const q='/rest/v1/ag_requests?select=id,code,user_id&code=in.('+chunk.map(encodeURIComponent).join(',')+')';
    const rows=await sbFetch(q).then(r=>r.json()).catch(()=>[]);
    (Array.isArray(rows)?rows:[]).forEach(r=>{ codeToUser[r.code]={user_id:r.user_id,request_id:r.id}; });
  }

  // 1b) Khớp qua MÃ ĐƠN khách đã nhận (dùng cho cả TikTok lẫn Shopee)
  const oids=[...new Set(orders.map(o=>String(o.order_id||'').trim().toUpperCase()).filter(Boolean))];
  const orderToUser={};
  for(let i=0;i<oids.length;i+=200){
    const chunk=oids.slice(i,i+200);
    const q='/rest/v1/ag_claims?select=order_id,user_id,request_id&order_id=in.('+chunk.map(encodeURIComponent).join(',')+')';
    const rows=await sbFetch(q).then(r=>r.json()).catch(()=>[]);
    (Array.isArray(rows)?rows:[]).forEach(r=>{ orderToUser[r.order_id]={user_id:r.user_id,request_id:r.request_id}; });
  }

  // 2) Chuẩn hoá + tính phần chia cho khách
  const clean=orders.map(o=>{
    const code=(o.track_code||'').toUpperCase();
    const oid2=String(o.order_id||'').trim().toUpperCase();
    // ưu tiên khớp mã AG (Sub_id, chống giả); nếu không có thì khớp mã đơn khách nhận
    const link=codeToUser[code]||orderToUser[oid2]||{};
    const comm=Math.max(0,Math.round(+o.commission||0));
    const platform=/tiktok/i.test(o.platform||'')?'tiktok':'shopee';
    return {
      order_id:String(o.order_id).trim(),
      track_code:/^AG\d{4,}$/.test(code)?code:null,
      request_id:link.request_id||null,
      user_id:link.user_id||null,
      platform,
      shop_name:(o.shop_name||'').slice(0,180)||null,
      product_title:(o.product_title||'').slice(0,300)||null,
      order_value:Math.max(0,Math.round(+o.order_value||0)),
      commission:comm,
      user_commission:Math.round(comm*COMMISSION_SHARE),
      status:['approved','rejected','pending'].includes(o.status)?o.status:'pending',
      order_time:toISO(o.order_time)
    };
  }).filter(o=>o.order_id);

  // 3) BULK UPSERT theo lô (merge-duplicates trên order_id). Cập nhật trạng thái
  //    để đơn từ "pending" -> "approved"/"rejected" được đối soát lại đúng.
  let upserted=0;
  for(let i=0;i<clean.length;i+=500){
    const batch=clean.slice(i,i+500);
    const r=await sbFetch('/rest/v1/ag_orders?on_conflict=order_id',{
      method:'POST',
      headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify(batch)
    });
    if(!r.ok){ const t=await r.text(); return res.status(500).json({error:'Lỗi lưu đơn: '+t.slice(0,300),upserted}); }
    upserted+=batch.length;
  }

  // 4) ĐỐI SOÁT SET-BASED: cộng chờ / chuyển khả dụng / thu hồi — 1 lệnh.
  let reconcile=null;
  try{
    const r=await sbFetch('/rest/v1/rpc/ag_reconcile',{method:'POST',body:JSON.stringify({p_hold_days:HOLD_DAYS})});
    reconcile=await r.json().catch(()=>null);
    // thưởng giới thiệu (tách riêng, idempotent) — không chặn nếu chưa cập nhật schema
    await sbFetch('/rest/v1/rpc/ag_referral_bonus',{method:'POST',body:'{}'}).catch(()=>{});
  }catch(e){}

  // 5) PUSH tới khách VỪA được cộng hoa hồng (đối soát xong). Dựa vào balance_log
  //    cashback mới tạo (reconcile idempotent nên nạp lại không phát sinh dòng mới -> không báo trùng).
  let notified=0;
  try{
    if(process.env.VAPID_PRIVATE && process.env.VAPID_PUBLIC){
      const since=new Date(Date.now()-180000).toISOString();
      const logs=await sbFetch('/rest/v1/balance_log?select=user_id,change&reason=eq.cashback&created_at=gte.'+encodeURIComponent(since)).then(r=>r.json()).catch(()=>[]);
      const sum={};
      (Array.isArray(logs)?logs:[]).forEach(l=>{ if(l&&l.user_id&&l.change>0) sum[l.user_id]=(sum[l.user_id]||0)+(+l.change||0); });
      const uids=Object.keys(sum);
      if(uids.length){
        webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@antigravity.app', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
        for(let i=0;i<uids.length;i+=200){
          const chunk=uids.slice(i,i+200);
          const profs=await sbFetch('/rest/v1/profiles?select=id,push_sub&push_sub=not.is.null&id=in.('+chunk.map(encodeURIComponent).join(',')+')').then(r=>r.json()).catch(()=>[]);
          for(const p of (Array.isArray(profs)?profs:[])){
            const amt=Math.round(sum[p.id]||0);
            const payload=JSON.stringify({title:'💵 +'+amt.toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.')+'đ hoa hồng vào ví',
              body:'Đơn của bạn đã đối soát xong và được cộng hoa hồng. Mở app phần Ví để xem nhé.',url:'/?go=wallet'});
            try{ await webpush.sendNotification(p.push_sub,payload); notified++; }catch(e){}
          }
        }
      }
    }
  }catch(e){}

  const matchedUsers=clean.filter(o=>o.user_id).length;
  return res.status(200).json({ ok:true, received:orders.length, upserted, matched:matchedUsers, reconcile, notified });
}
