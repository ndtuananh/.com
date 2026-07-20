// /api/sync-orders — TỰ ĐỘNG kéo đơn AccessTrade → cộng 50% HOA HỒNG THẬT cho khách.
// Gộp chung sổ với đối soát CSV (bảng report_orders, mã đơn duy nhất) -> KHÔNG cộng trùng.
// Chạy bằng cron (10 phút/lần) hoặc admin mở app. Chỉ đơn "đã duyệt" mới cộng.

import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nxvcsotzybjxykadbxbr.supabase.co';
const ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dmNzb3R6eWJqeHlrYWRieGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NDg5MzIsImV4cCI6MjA5OTMyNDkzMn0.JtKX-tQIoI3NaGh6aul0XC3nSLOMgSe26aS9DAvmo_4';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';
const AT_TOKEN = process.env.ACCESSTRADE_TOKEN || '';
const AT_API   = process.env.ACCESSTRADE_API || 'https://api.accesstrade.vn/v1/order-list';
const CRON     = process.env.CRON_SECRET || '';
const SHARE    = parseFloat(process.env.CASHBACK_SHARE || '50');   // % HOA HỒNG hoàn cho khách

function pick(o, keys){ for(let i=0;i<keys.length;i++){ const v=o[keys[i]]; if(v!=null && v!=='') return v; } return null; }
function toInt(v){ if(v==null) return 0; const n=Math.round(parseFloat((''+v).replace(/[^\d.]/g,''))); return isNaN(n)?0:n; }
function mapStatus(s){
  const v=(''+s).toLowerCase().trim();
  if(v==='1'||v==='approved'||v==='approve'||v==='confirmed'||v==='success'||v==='completed'||/duyệt|duyet|thành công|thanh cong|hợp lệ|hop le/.test(v)) return 'approved';
  if(v==='2'||v==='rejected'||v==='reject'||v==='cancelled'||v==='canceled'||v==='cancel'||v==='invalid'||/hủy|huy|từ chối|tu choi/.test(v)) return 'cancelled';
  return 'pending';
}
function ymd(d){ return d.toISOString().slice(0,10); }

async function sb(path, opts){
  opts = opts || {};
  opts.headers = Object.assign({ apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE, 'Content-Type': 'application/json' }, opts.headers||{});
  const r = await fetch(SUPABASE_URL + '/rest/v1' + path, opts);
  const t = await r.text(); let d=null; try{ d = t?JSON.parse(t):null; }catch(e){ d=t; }
  if(!r.ok) throw new Error('supabase '+r.status+': '+t);
  return d;
}

async function pushAdmins(title, body){
  try{
    const pub=process.env.VAPID_PUBLIC, priv=process.env.VAPID_PRIVATE;
    if(!pub||!priv) return;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@app', pub, priv);
    const admins = await sb('/profiles?select=push_sub&is_admin=eq.true&push_sub=not.is.null');
    const payload = JSON.stringify({ title, body, url:'/' });
    for(const a of (admins||[])){ try{ await webpush.sendNotification(a.push_sub, payload); }catch(e){} }
  }catch(e){}
}

async function authorize(req){
  if(CRON && req.query && req.query.key === CRON) return true;
  const bearer = (req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(CRON && bearer === CRON) return true;
  if(!bearer) return false;
  const ur = await fetch(SUPABASE_URL+'/auth/v1/user',{ headers:{ apikey:ANON, Authorization:'Bearer '+bearer } });
  if(!ur.ok) return false;
  const u = await ur.json(); if(!u||!u.id) return false;
  const rows = await sb('/profiles?select=is_admin&id=eq.'+u.id);
  return !!(rows && rows[0] && rows[0].is_admin);
}

export default async function handler(req, res){
  try{
    if(!SERVICE_ROLE) return res.status(500).json({ ok:false, error:'Chưa đặt SUPABASE_SERVICE_ROLE' });
    if(!AT_TOKEN)     return res.status(500).json({ ok:false, error:'Chưa đặt ACCESSTRADE_TOKEN' });
    if(!(await authorize(req))) return res.status(401).json({ ok:false, error:'Không có quyền' });

    // kéo đơn 30 ngày gần nhất
    const until = new Date();
    const since = new Date(until.getTime() - 30*24*3600*1000);
    const url = AT_API + '?since=' + ymd(since) + '&until=' + ymd(until) + '&page=1&limit=500';
    const atRes = await fetch(url, { headers: { Authorization: 'Token ' + AT_TOKEN } });
    const atText = await atRes.text();
    let atJson=null; try{ atJson=JSON.parse(atText); }catch(e){}
    if(!atRes.ok || !atJson) return res.status(200).json({ ok:false, error:'AccessTrade lỗi', status:atRes.status, body:atText.slice(0,400) });
    const orders = atJson.data || atJson.results || atJson.orders || (Array.isArray(atJson)?atJson:[]);

    // DEBUG: xem cấu trúc field thật khi có đơn
    if(req.query && req.query.debug){
      return res.status(200).json({ ok:true, count:orders.length, fields: orders[0]?Object.keys(orders[0]):[], sample: orders.slice(0,2) });
    }

    // chuẩn hóa -> {order_code, phone, amount, commission, status}
    const rows = orders.map(o => ({
      order_code: String(pick(o, ['order_id','order_code','order_number','transaction_id','conversion_id','id']) || '').trim(),
      phone:      String(pick(o, ['utm_content','aff_sub','aff_sub1','sub1','utm_campaign']) || '').replace(/\D/g,''),
      amount:     toInt(pick(o, ['sales','order_amount','amount','value','order_value','sale_amount'])),
      commission: toInt(pick(o, ['pub_commission','commission','pub_commission_amount','pub_commission_value'])),
      status:     mapStatus(pick(o, ['status','order_status','conversion_status']))
    })).filter(r => r.order_code);

    if(!rows.length) return res.status(200).json({ ok:true, processed:0, credited:0, note:'Chưa có đơn (Shopee báo trễ vài giờ)' });

    // 🔒 KHÓA AN TOÀN TIỀN BẠC: chỉ cộng thật khi env AUTO_CREDIT='on' (admin bật sau khi
    //    đã xác minh đúng field hoa hồng với đơn thật). Mặc định = XEM TRƯỚC, không đụng tiền.
    if(process.env.AUTO_CREDIT !== 'on'){
      const approved = rows.filter(r => r.status==='approved').length;
      const wouldCredit = rows.filter(r => r.status==='approved' && r.commission>0 && r.phone).length;
      return res.status(200).json({ ok:true, mode:'PREVIEW (chưa bật cộng tự động)', processed:rows.length,
        approved, wouldCredit, share:SHARE, sample: rows.slice(0,3) });
    }

    // 🔒 LỚP CHỐNG CỘNG NHẦM: hoa hồng KHÔNG thể > 50% giá đơn (Shopee ~1-15%, TikTok ~20%).
    //    Đơn "đã duyệt" mà hoa hồng bất thường -> KHÔNG cộng, đẩy cảnh báo để kiểm tay.
    const safe = [], suspicious = [];
    for(const r of rows){
      if(r.status==='approved' && r.commission>0 && r.amount>0 && r.commission > r.amount*0.5) suspicious.push(r);
      else safe.push(r);
    }

    // Cộng qua CÙNG hàm/sổ (mã đơn duy nhất) -> không trùng, đúng 50% hoa hồng thật, có audit
    const result = await sb('/rpc/reconcile_orders_srv', { method:'POST', body: JSON.stringify({ rows: safe, share: SHARE }) });
    const credited = (result||[]).filter(x => (x.result||'').indexOf('DA_CONG')===0).length;
    const pending  = (result||[]).filter(x => (x.result||'').indexOf('cho_duyet')===0).length;
    const noUser   = (result||[]).filter(x => (x.result||'').indexOf('chua_co_tai_khoan')===0).length;

    // Tự báo push cho admin (minh bạch, khỏi phải theo dõi)
    if(credited > 0) await pushAdmins('✅ Đã tự cộng hoa hồng', 'Vừa cộng cho '+credited+' đơn đã duyệt.');
    if(suspicious.length > 0) await pushAdmins('⚠️ Đơn hoa hồng bất thường', suspicious.length+' đơn có hoa hồng > 50% giá — chưa cộng, kiểm tra giúp nhé.');

    return res.status(200).json({ ok:true, mode:'LIVE', processed:rows.length, credited, pending, noUser, suspicious:suspicious.length, share:SHARE });
  }catch(e){
    // TỰ GIÁM SÁT: lỗi hệ thống (DB/hàm/kết nối) -> đẩy cảnh báo về admin ngay.
    // Cron gọi mỗi 10 phút -> app tự soi liên tục, hỏng là biết liền.
    try{ await pushAdmins('🚨 Hệ thống đối soát LỖI', String(e && e.message || e).slice(0,120)); }catch(_){}
    return res.status(200).json({ ok:false, error: String(e && e.message || e) });
  }
}
