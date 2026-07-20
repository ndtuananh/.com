/* ================= RoadAI — điều hướng thông minh cho tài xế Việt =================
   Bản đồ: Leaflet. Provider có thể chọn:
     • VietMap  (khi có API key) — tile + tìm kiếm + routing tối ưu VN, có xe máy thật.
     • OpenStreetMap (mặc định, không cần key) — tile CARTO + OSRM + Nominatim.
   Lõi khác Google: KHÔNG chỉ chọn đường ngắn nhất — chấm điểm kiểu tài xế
   (trừ điểm camera / CSGT / ngập / kẹt / cấm, thưởng đường tắt) → chọn route "nhanh thật".
   Cảnh báo giọng nói tiếng Việt (Web Speech API). Chạy 100% client, deploy tĩnh được.
================================================================================= */
'use strict';

/* ---------- STATE ---------- */
const S = {
  vehicle: 'motorbike',
  from: null, to: null,
  reports: [], markers: {}, routeLayers: [], routes: [], activeRoute: null,
  meMarker: null, meLatLng: null, watchId: null, navOn: false,
  spokenCam: new Set(),
  layerOn: { camera:true, police:true, restrict:true, hazard:true, traffic:true },
  voiceOn: true,
  // VietMap có 2 key riêng: Tilemap (bản đồ) và Default/API (dữ liệu)
  vmTileKey: (localStorage.getItem('roadai_vm_tilekey') || '').trim(),
  vmApiKey:  (localStorage.getItem('roadai_vm_apikey')  || '').trim(),
  vmTileMode: null,     // null | 'key' | 'proxy'  → tile bản đồ
  vmApiMode:  null,     // null | 'key' | 'proxy'  → search/routing
  provider: 'osm',      // 'osm' | 'vietmap'
  baseStyle: (localStorage.getItem('roadai_basestyle') || 'light'), // 'light' | 'dark'
  baseLayer: null,
  vmTileFailed: false,
  dataSaver: (localStorage.getItem('roadai_datasaver')==='1'),  // dùng nền OSM để tiết kiệm transaction VietMap
};
// cache trong phiên để KHÔNG gọi lại VietMap (tiết kiệm transaction/tiền)
const acCache = new Map();      // query -> gợi ý
const placeCache = new Map();   // refid -> {lat,lng}
const routeCache = new Map();   // key -> raw routes
let pendingSearch = false;      // chờ đăng nhập xong tự tìm đường
// Nền OSM miễn phí, sáng & nhiều nhãn/POI (giống VietMap/Google), không cần key
const OSM_STYLES = {
  light: { url:'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', sub:'abcd', attr:'© OpenStreetMap © CARTO · Routing OSRM' },
  dark:  { url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',            sub:'abcd', attr:'© OpenStreetMap © CARTO · Routing OSRM' },
};

/* ---------- MAP ---------- */
const map = L.map('map', { zoomControl:false, attributionControl:false })
  .setView([10.7769, 106.7009], 13);
L.control.zoom({ position:'bottomleft' }).addTo(map);
const attrib = L.control.attribution({ position:'bottomright', prefix:false }).addTo(map);

function buildBaseLayer(){
  if(S.baseLayer){ map.removeLayer(S.baseLayer); S.baseLayer=null; }
  if(S.provider==='vietmap' && vmTileActive() && !S.vmTileFailed && !S.dataSaver){
    const tileUrl = S.vmTileMode==='key'
      ? `https://maps.vietmap.vn/tm/{z}/{x}/{y}.png?apikey=${encodeURIComponent(S.vmTileKey)}`
      : `/api/vietmap?path=tm/{z}/{x}/{y}.png`;
    S.baseLayer = L.tileLayer(tileUrl, { maxZoom: 20, tileSize: 256 });
    let errs=0;
    S.baseLayer.on('tileerror', ()=>{ if(++errs>=3 && !S.vmTileFailed){ S.vmTileFailed=true; toast('Tile VietMap lỗi → dùng bản đồ OSM.'); buildBaseLayer(); } });
    attrib.setPrefix(''); attrib._container && (attrib._container.innerHTML='© VietMap · Routing VietMap · RoadAI');
  } else {
    const st = OSM_STYLES[S.baseStyle] || OSM_STYLES.light;
    S.baseLayer = L.tileLayer(st.url, { maxZoom:20, subdomains:st.sub });
    attrib._container && (attrib._container.innerHTML = st.attr + ' · RoadAI');
  }
  S.baseLayer.addTo(map);
  document.body.classList.toggle('light-base', !vmTileActive() && S.baseStyle==='light');
  syncBaseSeg();
  updateBrandSub();
}
function syncBaseSeg(){
  const on = !vmTileActive();
  $$('#base-seg button').forEach(b=> b.classList.toggle('active', on && b.dataset.base===S.baseStyle));
}
function updateBrandSub(){
  const el=document.getElementById('brand-sub'); if(!el) return;
  el.textContent = (vmTileActive() && !S.vmTileFailed) ? 'Chạy trên VietMap 🇻🇳' : 'Lái nhanh kiểu tài xế Việt';
}

/* ---------- VietMap provider — 2 key riêng (Tilemap & Default/API), client key HOẶC proxy ---------- */
function vmTileActive(){ return S.vmTileMode==='key' || S.vmTileMode==='proxy'; }
function vmApiActive(){  return S.vmApiMode==='key'  || S.vmApiMode==='proxy';  }
function vmActive(){ return vmTileActive() || vmApiActive(); }
// build URL REST API VietMap (dùng Default/API key); hỗ trợ tham số mảng (vd 2 'point')
function vmApi(path, paramsObj){
  const parts=[];
  for(const [k,v] of Object.entries(paramsObj||{})){
    if(Array.isArray(v)) v.forEach(x=>parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(x)}`));
    else parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  const qs = parts.length ? '&'+parts.join('&') : '';
  if(S.vmApiMode==='key'){
    return `https://maps.vietmap.vn/api/${path}?apikey=${encodeURIComponent(S.vmApiKey)}${qs}`;
  }
  return `/api/vietmap?path=${encodeURIComponent(path)}${qs}`;
}
// khởi động: client key trước, thiếu cái nào thì dò proxy máy chủ; còn lại OSM
async function initProvider(){
  if(S.vmTileKey) S.vmTileMode='key';
  if(S.vmApiKey)  S.vmApiMode='key';
  if(!S.vmTileKey || !S.vmApiKey){
    try{
      const r=await fetch('/api/vietmap?path=__status',{cache:'no-store'});
      if(r.ok){ const j=await r.json();
        if(!S.vmTileKey && j && j.tile) S.vmTileMode='proxy';
        if(!S.vmApiKey  && j && j.api)  S.vmApiMode='proxy';
      }
    }catch(e){/* không có proxy */}
  }
  S.provider = vmActive() ? 'vietmap' : 'osm';
  buildBaseLayer();
  if(vmActive()){
    const bits=[]; if(vmTileActive())bits.push('bản đồ'); if(vmApiActive())bits.push('tìm đường/xe máy');
    toast('Đã bật VietMap 🇻🇳 · '+bits.join(' + ')+'.');
  }
}

/* ================= HELPERS ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const R = 6371000, toRad = d => d*Math.PI/180;
function haversine(a, b){
  const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
function distToSeg(p, a, b){
  const kx = Math.cos(toRad(p.lat))*111320, ky=110540;
  const px=(p.lng-a.lng)*kx, py=(p.lat-a.lat)*ky, bx=(b.lng-a.lng)*kx, by=(b.lat-a.lat)*ky;
  const len2 = bx*bx+by*by || 1e-9;
  let t = (px*bx+py*by)/len2; t=Math.max(0,Math.min(1,t));
  const dx=px-t*bx, dy=py-t*by; return Math.sqrt(dx*dx+dy*dy);
}
function distToPath(p, path){ let m=Infinity; for(let i=0;i<path.length-1;i++) m=Math.min(m, distToSeg(p, path[i], path[i+1])); return m; }
const fmtDist = m => m<1000 ? Math.round(m)+' m' : (m/1000).toFixed(m<10000?1:0)+' km';
const fmtMin  = s => Math.max(1,Math.round(s/60))+' phút';
let toastT; function toast(msg, ms=2600){ const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true, ms); }

/* ================= VOICE (vi-VN) ================= */
let viVoice=null;
function pickVoice(){ const vs=speechSynthesis.getVoices(); viVoice = vs.find(v=>/vi(-|_)?VN/i.test(v.lang)) || vs.find(v=>/^vi/i.test(v.lang)) || null; }
if('speechSynthesis' in window){ pickVoice(); speechSynthesis.onvoiceschanged=pickVoice; }
function say(text){
  if(!S.voiceOn || !('speechSynthesis' in window)) return;
  try{ const u=new SpeechSynthesisUtterance(text); u.lang='vi-VN'; if(viVoice)u.voice=viVoice; u.rate=1.02; speechSynthesis.cancel(); speechSynthesis.speak(u); }catch(e){}
}

/* ================= REPORTS ================= */
const LS='roadai_reports_v1';
function loadReports(){
  let community=[]; try{ community=JSON.parse(localStorage.getItem(LS)||'[]'); }catch(e){}
  S.reports=(window.ROADAI_SEED||[]).map((r,i)=>({id:'seed'+i,votes:3,verified:true,...r})).concat(community);
}
function saveCommunity(){ localStorage.setItem(LS, JSON.stringify(S.reports.filter(r=>!String(r.id).startsWith('seed')))); }
const ICONS={camera:'📷',police:'👮',restrict:'🚫',accident:'💥',flood:'🌊',jam:'🚦'};
function layerOf(t){ if(t==='camera')return'camera'; if(t==='police')return'police'; if(t==='restrict')return'restrict'; if(t==='jam')return'traffic'; return'hazard'; }
function labelOf(t){return{camera:'Camera',police:'CSGT',restrict:'Đường cấm/biển báo',accident:'Tai nạn',flood:'Ngập nước',jam:'Kẹt xe'}[t]||t;}
function drawReports(){
  Object.values(S.markers).forEach(m=>map.removeLayer(m)); S.markers={};
  for(const r of S.reports){
    if(!S.layerOn[layerOf(r.type)]) continue;
    const icon=L.divIcon({className:'',html:`<div class="mk mk-${r.type}"><span>${ICONS[r.type]}</span></div>`,iconSize:[30,30],iconAnchor:[15,28]});
    const m=L.marker([r.lat,r.lng],{icon}).addTo(map);
    const verified=r.verified||r.votes>=5;
    m.bindPopup(`<b>${ICONS[r.type]} ${labelOf(r.type)}</b><br>${r.note||''}
      <br><small>${verified?'✅ Đã xác minh':'⏳ Chờ xác minh'} · ${r.votes||1} lượt</small>
      <br><button onclick="voteReport('${r.id}')" style="margin-top:6px">👍 Xác nhận còn</button>
      ${String(r.id).startsWith('seed')?'':`<button onclick="removeReport('${r.id}')" style="margin-left:6px">🗑 Gỡ</button>`}`);
    S.markers[r.id]=m;
  }
}
window.voteReport=id=>{ const r=S.reports.find(x=>x.id===id); if(!r)return; r.votes=(r.votes||1)+1; if(r.votes>=5)r.verified=true; saveCommunity(); drawReports(); toast('Cảm ơn! AI xác minh khi đủ 5 lượt.'); };
window.removeReport=id=>{ S.reports=S.reports.filter(x=>x.id!==id); saveCommunity(); drawReports(); toast('Đã gỡ báo cáo.'); };

/* ================= GEOCODING (provider) =================
   Trả về danh sách gợi ý chuẩn hoá: {label, sub, lat?, lng?, refid?}
   OSM: có sẵn lat/lng. VietMap: chỉ có refid, lấy toạ độ khi user chọn (Place v4). */
async function suggest(q){
  const ck=(vmApiActive()?'v|':'o|')+q.toLowerCase();
  if(acCache.has(ck)) return acCache.get(ck);          // tiết kiệm: không gọi lại
  let out=[];
  if(S.provider==='vietmap' && vmApiActive()){
    try{
      const params={text:q}; if(S.meLatLng) params.focus=`${S.meLatLng.lat},${S.meLatLng.lng}`;
      const r=await fetch(vmApi('autocomplete/v4', params));
      if(r.ok){ const j=await r.json();
        if(Array.isArray(j)) out=j.slice(0,6).map(p=>({label:p.name||p.display, sub:p.address||p.display, refid:p.ref_id}));
      }
    }catch(e){ /* rơi xuống OSM */ }
  }
  if(!out.length){
    const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=vn&limit=6&accept-language=vi&q=${encodeURIComponent(q)}`,{headers:{Accept:'application/json'}});
    if(r.ok){ const j=await r.json(); out=j.map(p=>{ const name=p.display_name.split(',').slice(0,2).join(','); return {label:name, sub:p.display_name, lat:+p.lat, lng:+p.lon}; }); }
  }
  if(out.length) acCache.set(ck, out);
  return out;
}
async function resolvePoint(s){
  if(s.lat!=null && s.lng!=null) return {lat:s.lat,lng:s.lng,label:s.label};
  if(s.refid){
    if(placeCache.has(s.refid)){ const c=placeCache.get(s.refid); return {lat:c.lat,lng:c.lng,label:s.label}; }
    if(vmApiActive()){
      const r=await fetch(vmApi('place/v4', {refid:s.refid}));
      if(r.ok){ const j=await r.json(); if(j&&j.lat!=null){ placeCache.set(s.refid,{lat:j.lat,lng:j.lng}); return {lat:j.lat,lng:j.lng,label:s.label}; } }
    }
  }
  return null;
}
let acT;
function attachAutocomplete(input, which){
  input.addEventListener('input', ()=>{
    const q=input.value.trim(); clearTimeout(acT);
    if(q.length<3){ $('#suggests').hidden=true; return; }
    acT=setTimeout(async()=>{
      const res=await suggest(q).catch(()=>[]); const box=$('#suggests'); box.innerHTML='';
      if(!res.length){ box.hidden=true; return; }
      res.forEach(p=>{
        const d=document.createElement('div'); d.innerHTML=`${p.label}<small>${p.sub||''}</small>`;
        d.onclick=async()=>{
          box.hidden=true; input.value=p.label;
          const pt=await resolvePoint(p);
          if(!pt){ toast('Không lấy được toạ độ điểm này'); return; }
          S[which]=pt; map.setView([pt.lat,pt.lng],15);
        };
        box.appendChild(d);
      });
      box.hidden=false;
    }, 500); // debounce lâu hơn để bớt gọi API (tiết kiệm transaction)
  });
}
attachAutocomplete($('#from'),'from'); attachAutocomplete($('#to'),'to');
document.addEventListener('click',e=>{ if(!e.target.closest('.fields')) $('#suggests').hidden=true; });

/* ================= GPS ================= */
function setMe(lat,lng){
  S.meLatLng={lat,lng};
  const icon=L.divIcon({className:'',html:'<div class="me-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]});
  if(!S.meMarker) S.meMarker=L.marker([lat,lng],{icon,zIndexOffset:1000}).addTo(map); else S.meMarker.setLatLng([lat,lng]);
}
$('#use-gps').onclick=()=>{
  if(!navigator.geolocation) return toast('Thiết bị không hỗ trợ GPS');
  toast('Đang định vị…');
  navigator.geolocation.getCurrentPosition(pos=>{
    const {latitude:lat,longitude:lng}=pos.coords; setMe(lat,lng); map.setView([lat,lng],16);
    S.from={lat,lng,label:'Vị trí của tôi'}; $('#from').value='Vị trí của tôi';
  }, ()=>toast('Không lấy được GPS — hãy cho phép quyền vị trí'), {enableHighAccuracy:true,timeout:8000});
};

/* ================= ROUTING (provider) → route CHUẨN HOÁ =================
   route = { path:[{lat,lng}], distance(m), duration(s), steps:[{lat,lng,instr,arrow}] } */
const VEH_VM={ motorbike:'motorcycle', car:'car', delivery:'motorcycle', taxi:'car' };

function ghArrow(sign){ if(sign===4)return'🏁'; if(sign===6)return'↻'; if(sign<=-2&&sign>=-3)return'↰'; if(sign===-1||sign===-7)return'↰'; if(sign===1||sign===7)return'↱'; if(sign>=2&&sign<=3)return'↱'; if(Math.abs(sign)===8)return'↶'; return'↑'; }
function ghVi(sign, street){
  const road=street?` vào ${street}`:'';
  const m={ '4':'Đã tới nơi 🏁','6':'Vào vòng xuyến','-3':'Rẽ gấp trái','-2':'Rẽ trái','-1':'Chếch trái','-7':'Đi bên trái',
    '0':'Đi thẳng','1':'Chếch phải','2':'Rẽ phải','3':'Rẽ gấp phải','7':'Đi bên phải','8':'Quay đầu','-8':'Quay đầu' };
  return (m[String(sign)]||'Đi thẳng')+(sign===4?'':road);
}
async function vietmapRoutes(from,to){
  const veh=VEH_VM[S.vehicle]||'car';
  const url=vmApi('route', {
    'api-version':'1.1', point:[`${from.lat},${from.lng}`,`${to.lat},${to.lng}`],
    vehicle:veh, points_encoded:'false', algorithm:'alternative_route', 'alternative_route.max_paths':'3'
  });
  const r=await fetch(url); if(!r.ok) throw new Error('VietMap '+r.status);
  const j=await r.json(); const paths=j.paths||[]; if(!paths.length) throw new Error('VietMap không có tuyến');
  return paths.map(p=>{
    const coords=(p.points&&p.points.coordinates)||[];
    const path=coords.map(c=>({lat:c[1],lng:c[0]}));
    const steps=(p.instructions||[]).map(ins=>{ const i=(ins.interval&&ins.interval[0])||0; const pt=path[Math.min(i,path.length-1)]||path[0];
      return pt?{lat:pt.lat,lng:pt.lng,instr:ghVi(ins.sign,ins.street_name),arrow:ghArrow(ins.sign)}:null; }).filter(Boolean);
    return { path, distance:p.distance, duration:(p.time||0)/1000, steps };
  }).filter(x=>x.path.length>1);
}
async function osrmRoutes(from,to){
  const url=`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?alternatives=3&overview=full&geometries=geojson&steps=true`;
  const r=await fetch(url); if(!r.ok) throw new Error('OSRM '+r.status);
  const j=await r.json(); if(j.code!=='Ok'||!j.routes?.length) throw new Error('Không tìm được đường');
  return j.routes.map(rt=>{
    const path=rt.geometry.coordinates.map(c=>({lat:c[1],lng:c[0]}));
    const steps=(rt.legs?.[0]?.steps||[]).map(s=>({lat:s.maneuver.location[1],lng:s.maneuver.location[0],instr:osrmVi(s.maneuver,s.name),arrow:osrmArrow(s.maneuver)}));
    return { path, distance:rt.distance, duration:rt.duration, steps };
  });
}
function osrmArrow(m){ const mod=m.modifier||''; if(m.type==='arrive')return'🏁'; if(/left/.test(mod))return'↰'; if(/right/.test(mod))return'↱'; if(/uturn/.test(mod))return'↶'; return'↑'; }
function osrmVi(m,name){ const road=name?` vào ${name}`:''; const mod=m.modifier||'';
  if(m.type==='arrive')return'Đã tới nơi 🏁'; if(m.type==='roundabout'||m.type==='rotary')return'Vào vòng xuyến'+road;
  if(/slight left/.test(mod))return'Chếch trái'+road; if(/slight right/.test(mod))return'Chếch phải'+road;
  if(/sharp left/.test(mod))return'Rẽ gấp trái'+road; if(/sharp right/.test(mod))return'Rẽ gấp phải'+road;
  if(/left/.test(mod))return'Rẽ trái'+road; if(/right/.test(mod))return'Rẽ phải'+road; if(/uturn/.test(mod))return'Quay đầu'+road; return'Đi thẳng'+road; }

async function getRoutes(from,to){
  if(S.provider==='vietmap' && vmApiActive()){
    try{ const rs=await vietmapRoutes(from,to); if(rs.length) return rs; }
    catch(e){ toast('VietMap routing lỗi → dùng OSRM. ('+e.message+')'); }
  }
  return osrmRoutes(from,to);
}

/* ---------- Driver AI scoring ---------- */
const PROFILE={
  motorbike:{ distW:0.02, cam:80, police:130, restrict:70,  flood:220, jam:150, accident:120, shortcutBonus:60 },
  car:      { distW:0.05, cam:150,police:180, restrict:400, flood:300, jam:200, accident:160, shortcutBonus:0  },
  delivery: { distW:0.03, cam:120,police:150, restrict:300, flood:260, jam:220, accident:150, shortcutBonus:30 },
  taxi:     { distW:0.04, cam:140,police:170, restrict:380, flood:280, jam:200, accident:160, shortcutBonus:10 },
};
function analyze(route){
  const p=PROFILE[S.vehicle], path=route.path;
  const hits={camera:[],police:[],restrict:[],flood:[],jam:[],accident:[]};
  for(const r of S.reports){ const d=distToPath({lat:r.lat,lng:r.lng},path); if(d<55) (hits[r.type]||(hits[r.type]=[])).push({...r,d}); }
  const penalty=hits.camera.length*p.cam+hits.police.length*p.police+hits.restrict.length*p.restrict
    +hits.flood.length*p.flood+hits.jam.length*p.jam+hits.accident.length*p.accident;
  const cost=route.duration+route.distance*p.distW+penalty;
  return { route, path, hits, penalty, cost, dur:route.duration, dist:route.distance };
}

function routeKey(f,t,v){ return `${v}|${f.lat.toFixed(4)},${f.lng.toFixed(4)}|${t.lat.toFixed(4)},${t.lng.toFixed(4)}`; }
async function findRoutes(){
  if(!S.from) return toast('Chọn điểm đi (hoặc bấm 📍 GPS)');
  if(!S.to)   return toast('Chọn điểm đến');
  const acc=curAcct();
  if(!acc){ pendingSearch=true; openLogin(); return; }                 // yêu cầu đăng nhập email
  if(remaining(acc)<=0){ toast('Bạn đã dùng hết hạn mức tháng này 😢'); openAccount(); return; } // hết → nâng cấp
  $('#find').textContent='Đang tính…'; $('#find').disabled=true;
  try{
    const key=routeKey(S.from,S.to,S.vehicle);
    let raw, cached=false;
    if(routeCache.has(key)){ raw=routeCache.get(key); cached=true; }    // trùng tuyến → không tốn transaction/lượt
    else { raw=await getRoutes(S.from,S.to); routeCache.set(key, raw); }
    const p=PROFILE[S.vehicle];
    let list=raw.map((rt,i)=>({ i, ...analyze(rt) }));
    const minDist=Math.min(...list.map(r=>r.dist));
    list.forEach(r=>{ if(r.dist<=minDist*1.02 && p.shortcutBonus) r.cost-=p.shortcutBonus; });
    list.sort((a,b)=>a.cost-b.cost);
    S.routes=list; renderRoutes(list);
    if(!cached){ consume(); renderAccountChip(); }                      // chỉ trừ hạn mức khi gọi API thật
  }catch(e){ toast('Lỗi định tuyến: '+e.message); }
  finally{ $('#find').textContent='Tìm đường thông minh'; $('#find').disabled=false; }
}

/* ---------- vẽ + panel ---------- */
function clearRouteLayers(){ S.routeLayers.forEach(l=>map.removeLayer(l)); S.routeLayers=[]; }
function drawRoute(route, best){
  const ll=route.path.map(p=>[p.lat,p.lng]);
  const outline=L.polyline(ll,{color:'#04121a',weight:best?9:7,opacity:.9}).addTo(map);
  const line=L.polyline(ll,{color:best?'#2dd4bf':'#64748b',weight:best?6:4,opacity:best?1:.75}).addTo(map);
  S.routeLayers.push(outline,line);
}
const vehName=()=>({motorbike:'xe máy',car:'ô tô',delivery:'xe giao hàng',taxi:'taxi'})[S.vehicle];
function renderRoutes(list){
  clearRouteLayers();
  [...list].reverse().forEach(r=> drawRoute(r, r===list[0]));
  const best=list[0];
  map.fitBounds(L.polyline(best.path.map(p=>[p.lat,p.lng])).getBounds(),{padding:[60,60]});
  const byTime=[...list].sort((a,b)=>a.dur-b.dur)[0];
  const gg=fmtMin(byTime.dur), ra=fmtMin(best.dur); const saved=Math.round((byTime.dur-best.dur)/60);
  let cmp=`<b>RoadAI</b> ưu tiên đường ít rủi ro cho ${vehName()}${vmApiActive()?' · dữ liệu VietMap':''}.`;
  if(best!==byTime){
    const avoided=byTime.hits.camera.length+byTime.hits.police.length+byTime.hits.flood.length;
    cmp=`Kiểu Google: <b style="color:#94a3b8">${gg}</b> nhưng qua ${byTime.hits.camera.length}📷 ${byTime.hits.police.length}👮.<br>`
       +`<b>RoadAI: ${ra}</b> — né ${avoided} điểm rủi ro${saved>0?`, nhanh hơn ~${saved}′`:''}. 🏆`;
  }
  $('#compare').innerHTML=cmp;
  $('#route-list').innerHTML='';
  list.forEach((r,idx)=>{
    const c=document.createElement('div'); c.className='route-card'+(idx===0?' best':'');
    const tags=[];
    if(r.hits.camera.length) tags.push(`<span class="tag bad">📷 ${r.hits.camera.length} camera</span>`);
    if(r.hits.police.length) tags.push(`<span class="tag bad">👮 ${r.hits.police.length} CSGT</span>`);
    if(r.hits.flood.length)  tags.push(`<span class="tag bad">🌊 ngập</span>`);
    if(r.hits.jam.length)    tags.push(`<span class="tag bad">🚦 kẹt</span>`);
    if(r.hits.restrict.length)tags.push(`<span class="tag bad">🚫 cấm</span>`);
    if(!tags.length) tags.push(`<span class="tag good">✅ đường thoáng</span>`);
    c.innerHTML=`<div class="rc-time">${fmtMin(r.dur)}</div>
      <div class="rc-meta">${fmtDist(r.dist)} · ${idx===0?'RoadAI đề xuất':'Tuyến thay thế '+idx}
        <div class="tags">${tags.join('')}</div></div>
      <div class="rc-badge ${idx===0?'':'warn'}">${idx===0?'🏆 Tốt nhất':'#'+(idx+1)}</div>`;
    c.onclick=()=>selectRoute(r); $('#route-list').appendChild(c);
  });
  selectRoute(best,false); $('#routes').hidden=false; $('#start-nav').hidden=false;
}
function selectRoute(r, refit=true){
  S.activeRoute=r; $$('.route-card').forEach((c,i)=>c.classList.toggle('best', S.routes[i]===r));
  clearRouteLayers(); [...S.routes].reverse().forEach(x=>drawRoute(x, x===r));
  if(refit) map.fitBounds(L.polyline(r.path.map(p=>[p.lat,p.lng])).getBounds(),{padding:[60,60]});
}

/* ================= NAVIGATION + VOICE ================= */
function announceRoute(r){ const c=r.hits.camera.length,pl=r.hits.police.length;
  let t=`Quãng đường ${fmtDist(r.dist)}, dự kiến ${fmtMin(r.dur)}.`;
  t+= (c||pl) ? ` Lưu ý ${c} camera và ${pl} chốt công an trên tuyến.` : ' Tuyến khá thoáng.'; return t; }
function startNav(){
  if(!S.activeRoute) return; if(!navigator.geolocation) return toast('Không có GPS để dẫn đường');
  S.navOn=true; S.spokenCam.clear();
  $('#routes').hidden=true; $('#searchbar').hidden=true; $('#hud').hidden=false;
  say(`Bắt đầu dẫn đường cho ${vehName()}. ${announceRoute(S.activeRoute)}`);
  saveTrip({from:(S.from&&S.from.label)||'', to:(S.to&&S.to.label)||'', dist:S.activeRoute.dist, dur:S.activeRoute.dur, veh:S.vehicle, ts:Date.now()});
  S.watchId=navigator.geolocation.watchPosition(onPos, ()=>{}, {enableHighAccuracy:true,maximumAge:1000,timeout:10000});
}
function stopNav(){ S.navOn=false; if(S.watchId!=null){navigator.geolocation.clearWatch(S.watchId);S.watchId=null;} $('#hud').hidden=true; $('#searchbar').hidden=false; speechSynthesis&&speechSynthesis.cancel(); }
function onPos(pos){
  const {latitude:lat,longitude:lng}=pos.coords; setMe(lat,lng);
  if(S.navOn) map.setView([lat,lng], Math.max(16,map.getZoom()));
  const me={lat,lng}, r=S.activeRoute; if(!r) return;
  const {remainM}=remainingAlong(me,r.path,r.dist);
  const remainSec=r.dur*(remainM/Math.max(1,r.dist));
  $('#hud-eta').textContent=fmtMin(remainSec); $('#hud-dist').textContent=fmtDist(remainM);
  updateInstruction(me,r); proximityAlerts(me);
}
function remainingAlong(me, path, total){
  let best=Infinity, idx=0;
  for(let i=0;i<path.length-1;i++){ const d=distToSeg(me,path[i],path[i+1]); if(d<best){best=d;idx=i;} }
  let remain=0; for(let i=idx;i<path.length-1;i++) remain+=haversine(path[i],path[i+1]);
  return {idx, remainM:Math.min(total,remain)};
}
function updateInstruction(me, r){
  let nearest=null,nd=Infinity;
  for(const s of r.steps){ const d=haversine(me,{lat:s.lat,lng:s.lng}); if(d<nd && d<600){nd=d;nearest=s;} }
  if(nearest){ $('#hud-arrow').textContent=nearest.arrow; $('#hud-instr').textContent=nearest.instr; $('#hud-next').textContent=`Còn ${fmtDist(nd)}`; }
  else { $('#hud-arrow').textContent='↑'; $('#hud-instr').textContent='Đi thẳng theo tuyến'; $('#hud-next').textContent=''; }
}
const ALERT_THRESHOLDS=[500,200,100];
function proximityAlerts(me){
  const r=S.activeRoute; if(!r) return; let shown=null;
  const items=[...r.hits.camera.map(x=>({...x,em:'📷',w:'camera'})),
    ...r.hits.police.map(x=>({...x,em:'👮',w:'công an'})),
    ...r.hits.flood.map(x=>({...x,em:'🌊',w:'điểm ngập'})),
    ...r.hits.restrict.map(x=>({...x,em:'🚫',w:'biển cấm'})),
    ...r.hits.jam.map(x=>({...x,em:'🚦',w:'điểm kẹt xe'}))];
  for(const it of items){
    const d=haversine(me,{lat:it.lat,lng:it.lng});
    for(const th of ALERT_THRESHOLDS){
      const key=`${it.id}@${th}`;
      if(d<=th && d>th-90 && !S.spokenCam.has(key)){
        S.spokenCam.add(key);
        const kind=it.w==='camera'&&it.kind==='speed'&&it.speed?`camera tốc độ ${it.speed} km/h`:it.w;
        say(`Còn ${th} mét có ${kind}${it.w==='camera'?', chú ý tốc độ':''}.`);
        shown=`${it.em} Còn ${th}m: ${it.note||labelOf(it.type)}`;
      }
    }
    if(d<=520 && !shown) shown=`${it.em} Cách ${fmtDist(d)}: ${it.note||labelOf(it.type)}`;
  }
  const al=$('#hud-alert'); if(shown){ al.hidden=false; al.textContent=shown; } else al.hidden=true;
}

/* ================= REPORT SHEET (+) ================= */
$('#fab').onclick=()=>{ $('#report-sheet').hidden=!$('#report-sheet').hidden; };
$('#sheet-close').onclick=()=>$('#report-sheet').hidden=true;
$$('.rep').forEach(b=> b.onclick=()=>{
  const type=b.dataset.type, at=S.meLatLng||{lat:map.getCenter().lat,lng:map.getCenter().lng};
  S.reports.push({id:'u'+Date.now(),type,lat:at.lat,lng:at.lng,votes:1,verified:false,note:labelOf(type)+' (cộng đồng báo)'});
  saveCommunity(); drawReports(); $('#report-sheet').hidden=true;
  toast(`Đã thêm ${ICONS[type]} ${labelOf(type)} — cảm ơn bạn!`); say(`Đã ghi nhận ${labelOf(type)} tại vị trí của bạn.`);
});

/* ================= SETTINGS (VietMap key) ================= */
$('#settings-btn').onclick=()=>{ $('#vm-tilekey').value=S.vmTileKey; $('#vm-apikey').value=S.vmApiKey; $('#settings-sheet').hidden=false; };
$('#settings-close').onclick=()=>$('#settings-sheet').hidden=true;
$('#vm-save').onclick=async()=>{
  const tk=$('#vm-tilekey').value.trim(), ak=$('#vm-apikey').value.trim();
  S.vmTileKey=tk; S.vmApiKey=ak; S.vmTileFailed=false; S.vmTileMode=null; S.vmApiMode=null;
  tk?localStorage.setItem('roadai_vm_tilekey',tk):localStorage.removeItem('roadai_vm_tilekey');
  ak?localStorage.setItem('roadai_vm_apikey',ak):localStorage.removeItem('roadai_vm_apikey');
  await initProvider();
  $('#settings-sheet').hidden=true;
  if(!vmActive()) toast('Đã dùng OpenStreetMap.');
  if(S.routes.length) findRoutes();
};
$('#vm-clear').onclick=async()=>{
  $('#vm-tilekey').value=''; $('#vm-apikey').value=''; S.vmTileKey=''; S.vmApiKey=''; S.vmTileMode=null; S.vmApiMode=null; S.vmTileFailed=false;
  localStorage.removeItem('roadai_vm_tilekey'); localStorage.removeItem('roadai_vm_apikey');
  await initProvider(); toast(vmActive()?'Đã xoá key — dùng VietMap qua máy chủ.':'Đã xoá key máy — dùng OpenStreetMap.');
};

/* ================= TÀI KHOẢN + GÓI + HẠN MỨC (theo email) ================= */
const TRIP_LS='roadai_trips', ACCTS_LS='roadai_accounts', CUR_LS='roadai_current';
const VEH_EMOJI={motorbike:'🏍️',car:'🚗',delivery:'📦',taxi:'🚕'};
// Bảng gói — theo số "lượt tìm đường thông minh" mỗi tháng. Giá cân đối để giữ chân & upsell.
const PLANS={
  trial:{name:'Dùng thử', price:'Miễn phí', per:'',       quota:60,    feats:['Bản đồ VietMap 🇻🇳','Cảnh báo camera/CSGT','Giọng nói cơ bản','Báo cáo cộng đồng']},
  basic:{name:'Cơ bản',   price:'39.000đ', per:'/tháng',  quota:1500,  feats:['Mọi thứ gói Dùng thử','Tắt quảng cáo','Giọng nói AI rõ hơn']},
  pro:{  name:'Phổ biến', price:'69.000đ', per:'/tháng',  quota:5000,  pop:true, feats:['Mọi thứ gói Cơ bản','📊 Dashboard thống kê','🧠 AI đường tắt tối ưu','Đa điểm dừng']},
  max:{  name:'Không giới hạn', price:'99.000đ', per:'/tháng', quota:20000, feats:['Mọi thứ gói Phổ biến','Bản đồ offline','Ưu tiên xử lý','Hỗ trợ 24/7']},
};
const PLAN_IDS=['trial','basic','pro','max'];
function loadAccts(){ try{return JSON.parse(localStorage.getItem(ACCTS_LS)||'{}');}catch(e){return {};} }
function saveAccts(a){ localStorage.setItem(ACCTS_LS, JSON.stringify(a)); }
function monthKey(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function curEmail(){ return (localStorage.getItem(CUR_LS)||''); }
function curAcct(){ const e=curEmail(); if(!e)return null; return loadAccts()[e]||null; }
function ensureUsage(acc){ const m=monthKey(); if(!acc.usage||acc.usage.month!==m) acc.usage={month:m,count:0}; return acc.usage; }
function planOf(acc){ return PLANS[acc&&acc.plan] || PLANS.trial; }
function remaining(acc){ if(!acc)return 0; ensureUsage(acc); return Math.max(0, planOf(acc).quota-acc.usage.count); }
function persist(acc){ const a=loadAccts(); a[acc.email]=acc; saveAccts(a); }
function login(email,name){
  email=(email||'').trim().toLowerCase(); if(!email) return false;
  const a=loadAccts();
  if(!a[email]) a[email]={email, name:((name||'').trim()||email.split('@')[0]), plan:'trial', usage:{month:monthKey(),count:0}, created:Date.now()};
  else if(name) a[email].name=name.trim();
  saveAccts(a); localStorage.setItem(CUR_LS,email); return true;
}
function logout(){ localStorage.removeItem(CUR_LS); }
function consume(){ const acc=curAcct(); if(!acc)return; ensureUsage(acc); acc.usage.count++; persist(acc); }
function setPlan(plan){ const acc=curAcct(); if(!acc)return; acc.plan=plan; ensureUsage(acc); persist(acc); }
function loadTrips(){ try{ return JSON.parse(localStorage.getItem(TRIP_LS)||'[]'); }catch(e){ return []; } }
function saveTrip(t){ const a=loadTrips(); a.unshift(t); localStorage.setItem(TRIP_LS, JSON.stringify(a.slice(0,100))); }

function renderAccountChip(){
  const b=$('#pro-btn'); if(!b) return; const acc=curAcct();
  if(acc){ b.textContent=(acc.name[0]||'U').toUpperCase(); b.classList.add('acc-chip'); b.title=`${acc.name} · gói ${planOf(acc).name} · còn ${remaining(acc)} lượt`; }
  else { b.textContent='⭐'; b.classList.remove('acc-chip'); b.title='Đăng nhập / Gói dịch vụ'; }
}
function renderAccountSheet(){
  const acc=curAcct(); const box=$('#acc-box');
  if(acc){
    const p=planOf(acc), u=ensureUsage(acc), rem=remaining(acc), pct=Math.min(100,Math.round(u.count/p.quota*100));
    box.innerHTML=`
      <div class="acc-row"><div class="acc-ava">${(acc.name[0]||'U').toUpperCase()}</div>
        <div class="acc-meta"><b>${acc.name}</b><small>${acc.email}</small></div>
        <button id="logout-btn" class="mini ghost">Đăng xuất</button></div>
      <div class="usage">
        <div class="usage-top"><span>Gói <b>${p.name}</b></span><span>${u.count.toLocaleString('vi-VN')}/${p.quota.toLocaleString('vi-VN')} lượt</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <small>${rem>0?`Còn <b>${rem.toLocaleString('vi-VN')}</b> lượt tìm đường trong tháng`:'Đã hết hạn mức — nâng cấp để tiếp tục dùng'}</small>
      </div>`;
    const lb=$('#logout-btn'); if(lb) lb.onclick=()=>{ logout(); renderAll(); toast('Đã đăng xuất.'); };
  } else {
    box.innerHTML=`<p class="sheet-hint">Chưa đăng nhập. Đăng nhập bằng email để lưu hạn mức & lịch sử của bạn.</p>
      <button id="to-login" class="primary">Đăng nhập / Đăng ký (miễn phí)</button>`;
    const tl=$('#to-login'); if(tl) tl.onclick=()=>{ $('#pro-sheet').hidden=true; openLogin(); };
  }
  $('#plans-list').innerHTML = PLAN_IDS.map(id=>{ const p=PLANS[id]; const cur=acc&&acc.plan===id;
    return `<div class="plan-card${p.pop?' pop':''}${cur?' current':''}">
      ${p.pop?'<em class="pop-tag">Phổ biến</em>':''}
      <div class="pc-head"><b>${p.name}</b><span class="pc-price">${p.price}<small>${p.per}</small></span></div>
      <div class="pc-quota">${p.quota.toLocaleString('vi-VN')} lượt tìm đường / tháng</div>
      <ul>${p.feats.map(f=>`<li>${f}</li>`).join('')}</ul>
      ${cur?'<button class="pc-btn cur" disabled>✓ Đang dùng</button>'
           :`<button class="pc-btn" data-plan="${id}">${id==='trial'?'Chọn gói này':'Nâng cấp'}</button>`}
    </div>`; }).join('');
  $$('#plans-list .pc-btn[data-plan]').forEach(btn=> btn.onclick=()=>{
    if(!curAcct()){ $('#pro-sheet').hidden=true; return openLogin(); }
    const id=btn.dataset.plan;
    if(id==='trial'){ setPlan('trial'); renderAll(); return toast('Đã chuyển về gói Dùng thử.'); }
    openPay(id);   // gói trả phí → mở màn thanh toán QR
  });
}
function renderAll(){ renderAccountChip(); if(!$('#pro-sheet').hidden) renderAccountSheet(); }
function openAccount(){ renderAccountSheet(); $('#pro-sheet').hidden=false; }
function openDash(){
  const acc=curAcct();
  if(!acc || !['pro','max'].includes(acc.plan)){ openAccount(); return toast('📊 Dashboard có ở gói Phổ biến trở lên.'); }
  const trips=loadTrips();
  const km=trips.reduce((s,t)=>s+(t.dist||0),0)/1000, min=Math.round(trips.reduce((s,t)=>s+(t.dur||0),0)/60);
  $('#dash-stats').innerHTML=`
    <div class="stat"><b>${trips.length}</b><span>chuyến</span></div>
    <div class="stat"><b>${km.toFixed(1)}</b><span>km</span></div>
    <div class="stat"><b>${min}</b><span>phút lái</span></div>`;
  $('#dash-list').innerHTML = trips.length ? trips.slice(0,20).map(t=>`
    <div class="trip"><span>${VEH_EMOJI[t.veh]||'🚗'}</span>
      <div class="trip-txt"><b>${t.to||'—'}</b><small>${t.from||''} · ${fmtDist(t.dist||0)} · ${fmtMin(t.dur||0)}</small></div>
      <em>${new Date(t.ts).toLocaleDateString('vi-VN')}</em></div>`).join('')
    : '<p class="sheet-hint">Chưa có chuyến nào — bắt đầu dẫn đường để ghi lịch sử.</p>';
  $('#dash-sheet').hidden=false;
}
$('#pro-btn').onclick=openAccount;
$('#pro-close').onclick=()=>$('#pro-sheet').hidden=true;
$('#dash-close').onclick=()=>$('#dash-sheet').hidden=true;

/* ---------- ĐĂNG NHẬP ---------- */
function openLogin(){ const acc=curAcct(); $('#login-email').value=acc?acc.email:''; $('#login-name').value=acc?acc.name:''; $('#login-sheet').hidden=false; setTimeout(()=>$('#login-email').focus(),100); }
$('#login-close').onclick=()=>{ $('#login-sheet').hidden=true; pendingSearch=false; };
$('#login-go').onclick=()=>{
  const em=$('#login-email').value.trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast('Email chưa hợp lệ.');
  login(em, $('#login-name').value); $('#login-sheet').hidden=true; renderAll();
  const acc=curAcct(); toast(`Xin chào ${acc.name}! Bạn có ${remaining(acc)} lượt/tháng gói ${planOf(acc).name}.`);
  if(pendingSearch){ pendingSearch=false; findRoutes(); }
};

/* ---------- THANH TOÁN (QR chuyển khoản) + KÍCH HOẠT ---------- */
let payPlanId=null;
function payCode(email,plan){ // nội dung CK để đối soát: RADI <plan> <5 ký tự từ email>
  const s=(email||'').replace(/[^a-z0-9]/gi,'').slice(0,5).toUpperCase()||'USER';
  return `RADI ${plan.toUpperCase()} ${s}`;
}
function openPay(planId){
  const acc=curAcct(); if(!acc){ openLogin(); return; }
  payPlanId=planId; const p=PLANS[planId];
  const cfg=window.ROADAI_PAY||{};
  const amount=({basic:39000,pro:69000,max:99000})[planId]||0;
  const content=payCode(acc.email,planId);
  // QR: ưu tiên VietQR động (đúng số tiền + nội dung) nếu có cấu hình ngân hàng; nếu không, dùng ảnh QR tĩnh của bạn
  let qrSrc='';
  if(cfg.bankId && cfg.accountNo){
    qrSrc=`https://img.vietqr.io/image/${cfg.bankId}-${cfg.accountNo}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}${cfg.accountName?`&accountName=${encodeURIComponent(cfg.accountName)}`:''}`;
  } else if(cfg.qrImage){ qrSrc=cfg.qrImage; }
  $('#pay-body').innerHTML=`
    <div class="pay-plan">Nâng cấp <b>${p.name}</b> — <b class="pay-amt">${amount.toLocaleString('vi-VN')}đ</b>/tháng</div>
    <div class="pay-qr">${qrSrc?`<img src="${qrSrc}" alt="QR chuyển khoản" onerror="this.parentNode.innerHTML='&lt;div class=qr-holder&gt;Chưa cấu hình QR — sửa js/config.js&lt;/div&gt;'"/>`:'<div class="qr-holder">Đặt QR của bạn ở js/config.js<br>(bankId+accountNo hoặc qrImage)</div>'}</div>
    ${cfg.bankName?`<div class="pay-bank">${cfg.bankName}${cfg.accountNo?` · ${cfg.accountNo}`:''}${cfg.accountName?` · ${cfg.accountName}`:''}</div>`:''}
    <div class="pay-note">Nội dung chuyển khoản (bắt buộc):<br><b class="pay-content">${content}</b></div>
    <p class="sheet-hint">Chuyển khoản đúng số tiền & nội dung trên. Sau khi ${cfg.contact||'shop'} xác nhận, bạn nhận <b>mã kích hoạt</b> — dán vào ô dưới để mở gói ngay.</p>
    <div class="key-actions"><input id="act-code" class="key-input" placeholder="Dán mã kích hoạt…" style="margin:0"/><button id="act-go" class="primary" style="width:auto">Kích hoạt</button></div>
    <p class="sheet-hint" id="act-msg"></p>`;
  const ag=$('#act-go'); if(ag) ag.onclick=redeemCode;
  $('#pay-sheet').hidden=false;
}
$('#pay-close').onclick=()=>$('#pay-sheet').hidden=true;
async function redeemCode(){
  const code=($('#act-code').value||'').trim(); const msg=$('#act-msg');
  if(!code) return;
  msg.textContent='Đang kiểm tra…';
  try{
    const r=await fetch('/api/license?action=verify&token='+encodeURIComponent(code));
    const j=await r.json();
    if(!j.ok){ msg.textContent='❌ Mã không hợp lệ hoặc đã hết hạn.'; return; }
    const acc=curAcct();
    if(acc && j.email && j.email.toLowerCase()!==acc.email.toLowerCase()){ msg.textContent='❌ Mã này dành cho email khác: '+j.email; return; }
    setPlan(j.plan); renderAll(); $('#pay-sheet').hidden=true;
    toast(`🎉 Đã kích hoạt gói ${planOf(curAcct()).name}! Còn ${remaining(curAcct()).toLocaleString('vi-VN')} lượt/tháng.`);
  }catch(e){ msg.textContent='Lỗi kết nối, thử lại.'; }
}

/* ================= UI WIRING ================= */
$('#vehicles').addEventListener('click',e=>{ const b=e.target.closest('.veh'); if(!b)return;
  $$('.veh').forEach(v=>v.classList.remove('active')); b.classList.add('active'); S.vehicle=b.dataset.veh;
  if(S.routes.length) findRoutes(); });
$('#swap').onclick=()=>{ [S.from,S.to]=[S.to,S.from]; const a=$('#from').value; $('#from').value=$('#to').value; $('#to').value=a; };
$('#find').onclick=findRoutes;
$('#routes-close').onclick=()=>{ $('#routes').hidden=true; clearRouteLayers(); };
$('#start-nav').onclick=startNav; $('#stop-nav').onclick=stopNav;
$('#voice-toggle').onchange=e=>{ S.voiceOn=e.target.checked; if(S.voiceOn) say('Đã bật cảnh báo giọng nói.'); };
$$('#layers input[data-layer]').forEach(cb=> cb.onchange=()=>{ S.layerOn[cb.dataset.layer]=cb.checked; drawReports(); });
$$('#base-seg button').forEach(b=> b.onclick=()=>{
  S.baseStyle=b.dataset.base; localStorage.setItem('roadai_basestyle',S.baseStyle);
  if(vmTileActive()){ toast('Đang dùng bản đồ VietMap — chuyển Sáng/Tối áp dụng khi ở nền OSM.'); }
  buildBaseLayer();
});
const dsToggle=$('#datasaver-toggle');
if(dsToggle){ dsToggle.checked=S.dataSaver; dsToggle.onchange=()=>{
  S.dataSaver=dsToggle.checked; localStorage.setItem('roadai_datasaver', S.dataSaver?'1':'0');
  S.vmTileFailed=false; buildBaseLayer();
  toast(S.dataSaver?'💾 Bật tiết kiệm dữ liệu — nền OSM, VietMap chỉ dùng cho tìm đường.':'Đã tắt tiết kiệm — nền bản đồ VietMap.');
}; }
$('#locate').onclick=()=>{
  if(S.meLatLng){ map.setView([S.meLatLng.lat,S.meLatLng.lng], Math.max(16,map.getZoom())); return; }
  if(!navigator.geolocation) return toast('Thiết bị không hỗ trợ GPS');
  toast('Đang định vị…');
  navigator.geolocation.getCurrentPosition(p=>{ setMe(p.coords.latitude,p.coords.longitude); map.setView([p.coords.latitude,p.coords.longitude],16); }, ()=>toast('Hãy cho phép quyền vị trí'), {enableHighAccuracy:true,timeout:8000});
};
/* ---------- Chạm bản đồ → tra ĐỊA CHỈ CHÍNH XÁC (reverse geocode, tới số nhà) ---------- */
let lastPick=null;
async function reverseGeocode(lat,lng){
  if(vmApiActive()){
    try{ const r=await fetch(vmApi('reverse/v3',{lat,lng}));
      if(r.ok){ const j=await r.json(); const it=Array.isArray(j)?j[0]:(j&&j.data?j.data[0]:j);
        if(it && (it.display||it.address||it.name)) return it.display||it.address||it.name; } }catch(e){}
  }
  try{ const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=vi`);
    if(r.ok){ const j=await r.json(); return j.display_name; } }catch(e){}
  return null;
}
window.useLastPick=()=>{ if(!lastPick)return; S.to=lastPick; $('#to').value=lastPick.label; map.closePopup(); toast('🎯 Điểm đến: '+lastPick.label); };
window.pickAsFrom=()=>{ if(!lastPick)return; S.from={...lastPick}; $('#from').value=lastPick.label; map.closePopup(); toast('🟢 Điểm đi: '+lastPick.label); };
map.on('click', async e=>{
  if(!$('#report-sheet').hidden){ S.meLatLng={lat:e.latlng.lat,lng:e.latlng.lng}; toast('Đã chọn vị trí đặt báo cáo. Chọn loại bên dưới.'); return; }
  const {lat,lng}=e.latlng;
  const pop=L.popup({closeButton:true}).setLatLng(e.latlng).setContent('📍 Đang tra địa chỉ…').openOn(map);
  const addr=await reverseGeocode(lat,lng) || `Vị trí (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  lastPick={lat,lng,label:addr};
  pop.setContent(`<b>📍 ${addr}</b><div style="margin-top:8px;display:flex;gap:6px">
    <button onclick="pickAsFrom()">🟢 Điểm đi</button>
    <button onclick="useLastPick()">🎯 Điểm đến</button></div>`);
});

/* ================= INIT ================= */
initProvider(); loadReports(); drawReports(); renderAccountChip();
/* Deep-link từ AI Điều Phối: index.html?to=lat,lng,Tên điểm → đặt sẵn điểm đến */
try{ const _to=new URLSearchParams(location.search).get('to');
  if(_to){ const _p=_to.split(','); const _lat=+_p[0], _lng=+_p[1];
    if(isFinite(_lat)&&isFinite(_lng)){ const _lb=decodeURIComponent(_p.slice(2).join(',')||'Điểm đến');
      S.to={lat:_lat,lng:_lng,label:_lb}; const _t=$('#to'); if(_t)_t.value=_lb; map.setView([_lat,_lng],15);
      toast('🎯 Điểm đến từ AI Điều Phối: '+_lb+'. Bấm “Tìm đường thông minh”.',4200); } } }catch(e){}
if(navigator.geolocation){
  navigator.geolocation.getCurrentPosition(pos=>{ const {latitude:lat,longitude:lng}=pos.coords; setMe(lat,lng); map.setView([lat,lng],15);
    S.from={lat,lng,label:'Vị trí của tôi'}; if(!$('#from').value)$('#from').value='Vị trí của tôi'; }, ()=>{}, {enableHighAccuracy:false,timeout:5000});
}
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
toast('RoadAI sẵn sàng — chọn điểm đến rồi bấm “Tìm đường thông minh”. Vào ⚙️ để bật VietMap 🇻🇳.', 4600);
