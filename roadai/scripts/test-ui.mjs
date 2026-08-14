/* ══════════════════════════════════════════════════════════════════════════════
   BỘ TỰ KIỂM GIAO DIỆN — chạy:  node scripts/test-ui.mjs

   Nạp THẬT kiem-cuoc.html + 3 file js vào một trình duyệt giả (jsdom) rồi:
     · chạy UI.boot() như khi mở app;
     · bấm thử từng nút, mở từng màn, ghi thử một cuốc;
     · đếm CHỮ trên màn chính (mục tiêu của lần refactor này: giảm 50–70%);
     · soi xem có chữ kỹ thuật nào lọt lên màn tài xế không (OSM, rev, Overture…).
   Leaflet được thay bằng một Proxy tự trả về chính nó — đủ để code chạy hết đường,
   mà không cần trình duyệt thật.

   Cần: npm i --no-save jsdom
   ══════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
/* T() chỉ nhận hàm ĐỒNG BỘ. Đưa hàm async vào thì nó trả về Promise, `r === false`
   không bao giờ đúng → test luôn báo ĐẠT dù bên trong hỏng. Đã dính đúng bẫy này
   nên chặn thẳng: cần chờ thì dùng Ta(). */
const T = (n, f) => {
  try {
    const r = f();
    if (r && typeof r.then === 'function') throw new Error('hàm async phải dùng Ta(), không phải T()');
    if (r === false) throw new Error('false');
    console.log('  ✓ ' + n); pass++;
  } catch (e) { console.log('  ✗ ' + n + '\n      → ' + (e.message || e)); fail++; }
};
const Ta = async (n, f) => {
  try { const r = await f(); if (r === false) throw new Error('false'); console.log('  ✓ ' + n); pass++; }
  catch (e) { console.log('  ✗ ' + n + '\n      → ' + (e.message || e)); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'sai'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} — chờ ${JSON.stringify(b)}, nhận ${JSON.stringify(a)}`); };

/* ---------- LEAFLET GIẢ: Proxy tự trả về chính nó cho mọi thứ ---------- */
function fakeL() {
  const rec = { markers: 0, layers: 0, popups: 0 };
  const self = new Proxy(function () {}, {
    get(_, k) {
      if (k === 'then') return undefined;                 // đừng để await tưởng đây là promise
      if (k === 'getBounds') return () => ({ contains: () => true, pad: () => ({ contains: () => true, getWest: () => 106.5, getSouth: () => 10.7 }), getWest: () => 106.5, getSouth: () => 10.7 });
      if (k === 'getZoom') return () => 14;
      if (k === 'latLngToLayerPoint') return (ll) => ({ x: (ll[1] || ll.lng || 0) * 1e4, y: (ll[0] || ll.lat || 0) * 1e4 });
      if (k === 'getElement') return () => null;
      if (k === 'getLatLng') return () => ({ lat: 10.74, lng: 106.61 });
      return self;
    },
    apply() { return self; },
    construct() { return self; },
  });
  const L = new Proxy({}, { get(_, k) {
    if (k === 'map') return () => { rec.layers++; return self; };
    if (k === 'marker') return () => { rec.markers++; return self; };
    /* Popup phải là đối tượng THẬT tự trả về chính nó, không dùng Proxy chung —
       Proxy chung trả về `self` nên chuỗi .setLatLng().setContent() rơi ra ngoài
       và không ghi lại được nội dung. Đây là chỗ soi app định hiện gì cho tài xế. */
    if (k === 'popup') return () => {
      rec.popups++;
      const P = { setLatLng: () => P, openOn: () => P, getElement: () => null,
        on: () => P, addTo: () => P, remove: () => P, update: () => P,
        setContent: h => { rec.popupHtml = h; return P; } };
      return P;
    };
    return () => self;
  } });
  return { L, rec };
}

/* ---------- DỰNG TRANG ---------- */
const html = fs.readFileSync(path.join(ROOT, 'kiem-cuoc.html'), 'utf8')
  .replace(/<script src="https:\/\/unpkg[\s\S]*?<\/script>/g, '')          // bỏ Leaflet CDN
  .replace(/<link rel="stylesheet" href="https:\/\/unpkg[\s\S]*?\/>/g, '')
  .replace(/<script src="js\/[\s\S]*?<\/script>/g, '')                     // tự nạp js bên dưới
  .replace(/<script>[\s\S]*?<\/script>/g, '');                             // bỏ đoạn service worker

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://roadai-vn.vercel.app/kiem-cuoc' });
const w = dom.window;
const { L, rec } = fakeL();
w.L = L;
w.fetch = () => Promise.reject(new Error('offline trong bộ thử'));
w.setInterval = () => 0;
w.scrollTo = () => {};
w.alert = () => {}; w.confirm = () => true; w.prompt = () => null;
w.open = () => null;
Object.defineProperty(w.navigator, 'onLine', { value: true, configurable: true });
delete w.navigator.geolocation;                                            // không có GPS trong bộ thử
const store = new Map();
Object.defineProperty(w, 'localStorage', { value: {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k), clear: () => store.clear(), get length() { return store.size; },
}, configurable: true });

const run = f => w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
w.eval('var window = globalThis;');
run('js/spots.js'); run('js/butl-partners.js'); run('js/learned-spots.js');
run('js/positioning.js'); run('js/radar-sync.js'); run('js/radar-ui.js');

const $ = s => w.document.querySelector(s);
const txt = s => ($(s) ? ($(s).textContent || '').replace(/\s+/g, ' ').trim() : '');
// form thêm quán vẽ lại sau 260ms chống dội khi gõ — bộ thử gọi thẳng cho khỏi chờ
const paintAddSync = () => { const i = $('#add-name'); if (i && i._t) clearTimeout(i._t); w.UI.openSheet('#sheet-add'); };

console.log('\nGIAO DIỆN · nạp thật kiem-cuoc.html + 3 file js vào jsdom');
T('3 tầng nạp được, không lỗi', () => ok(w.RADAR && w.SYNC && w.UI, 'thiếu tầng nào đó'));

w.RADAR.G.simHour = 22;
w.UI.boot();
w.RADAR.G.simHour = 22; w.RADAR.recompute();

T('boot() chạy trót lọt, có dựng bản đồ', () => ok(rec.layers >= 1, 'không dựng bản đồ'));
T('có vẽ chấm điểm lên bản đồ', () => ok(rec.markers > 0, 'không có chấm nào'));
T('thanh trạng thái hiện đúng 1 dòng', () => {
  const t = txt('#statusbar');
  ok(t.length > 0 && t.length <= 46, 'dài ' + t.length + ' ký tự: "' + t + '"');
  ok(/ĐANG CÓ KHÁCH|CHỜ KHÁCH|ÍT CẦU|CHƯA TỚI GIỜ|ĐANG NGHỈ/.test(t), 'không có trạng thái: ' + t);
});
T('thẻ quyết định có ĐÚNG 1 con số lớn (%) + 1 nút hành động', () => {
  const h = $('#card').innerHTML;
  const pcts = (txt('#card').match(/\d+%/g) || []);
  eq(pcts.length, 1, 'có ' + pcts.length + ' con số % trên thẻ: ' + pcts.join(','));
  ok(/c-go/.test(h), 'thiếu nút hành động');
});
T('màn chính KHÔNG có đoạn văn dài (§11)', () => {
  for (const id of ['#statusbar', '#card', '#filters', '#nav']) {
    for (const s of txt(id).split(/[.·\n]/)) ok(s.trim().length < 60, id + ' có câu dài: "' + s.trim() + '"');
  }
});
T('màn chính KHÔNG lộ chữ kỹ thuật cho tài xế (§1)', () => {
  const t = (txt('#statusbar') + ' ' + txt('#card') + ' ' + txt('#filters') + ' ' + txt('#nav')).toLowerCase();
  for (const bad of ['osm', 'overture', 'digital twin', 'mã bản', 'rev', 'vietmap', 'đồng bộ', 'api', 'database', 'mô phỏng'])
    ok(!t.includes(bad), 'lộ "' + bad + '" ra màn chính');
});

/* ĐẾM CHỮ — yêu cầu là giảm 50–70% so với bản cũ (~950 ký tự → phải dưới ~475).
   Đo HAI trường hợp, vì màn hình có một dòng chỉ hiện khi cần:
     · nền: lúc đang có điểm đáng đi, không cần nhắc gì thêm;
     · xấu nhất: giờ vắng, có thêm dòng "khi nào đáng đi" — dòng này đắt chữ
       nhưng là thứ duy nhất cứu màn hình toàn 2% khỏi vô dụng, nên đáng giữ. */
const demChu = () => ['#statusbar', '#card', '#filters', '#nav'].reduce((s, id) => s + txt(id).length, 0);
const coPeak = !!$('#c-peak') || !!$('#c-wait');
const chuMoi = demChu();
console.log(`     · chữ trên màn chính: ${chuMoi} ký tự${coPeak ? ' (có dòng gợi ý giờ)' : ''}`);
T('màn chính giảm ít nhất 65% so với bản cũ (~950 ký tự)', () => ok(chuMoi < 335, chuMoi + ' ký tự'));
T('bỏ dòng gợi ý giờ ra thì màn chính dưới 220 ký tự', () => {
  const pk = $('#c-peak') || $('#c-wait');
  const rieng = pk ? (pk.textContent || '').replace(/\s+/g, ' ').trim().length : 0;
  ok(chuMoi - rieng < 220, (chuMoi - rieng) + ' ký tự khi không có dòng gợi ý');
});

console.log('\nTHAO TÁC · bấm thử từng nút như tài xế');
T('bấm "Vì sao?" → mở đúng màn giải thích, có lý do', () => {
  $('#c-why').onclick();
  ok(!$('#sheet-why').hidden, 'màn không mở');
  const t = txt('#why-body');
  ok(t.length > 40, 'trống trơn');
  ok(/Khả năng có khách/.test(t), 'thiếu câu trả lời chính');
  w.UI.closeSheets();
});
T('bấm 📊 Điều phối → đúng 3 con số ở tầng 1', () => {
  $('#nav-dash').onclick();
  ok(!$('#sheet-dash').hidden);
  eq($('#dash-body').querySelectorAll('.kpi').length, 3, 'không phải 3 chỉ số');
  ok(!!$('#dash-more'), 'thiếu nút XEM CHI TIẾT');
  ok($('#dash-detail').hidden, 'chi tiết phải ẩn sẵn (progressive disclosure)');
});
T('bấm XEM CHI TIẾT → mới hiện tầng 2', () => {
  $('#dash-more').onclick();
  ok(!$('#dash-detail').hidden, 'không mở ra');
  ok(txt('#dash-detail').length > 30, 'tầng 2 trống');
  w.UI.closeSheets();
});
T('bấm ⚙️ Cài đặt → đúng 4 công tắc, KHÔNG có số liệu kỹ thuật', () => {
  $('#nav-set').onclick();
  eq($('#set-body').querySelectorAll('.sw').length, 4, 'số công tắc sai');
  const t = txt('#set-body').toLowerCase();
  for (const bad of ['osm', 'overture', 'mã bản dữ liệu', 'rev', 'database'])
    ok(!t.includes(bad), 'lộ "' + bad + '" ở màn Cài đặt');
  ok(t.includes('chẩn đoán'), 'thiếu lối vào Chẩn đoán');
  ok(!t.includes('mô phỏng'), 'vẫn còn chữ "mô phỏng" — đây là app thật');
});
T('Cài đặt có nút NẠP QUÁN tay + ngày giờ nạp lần cuối', () => {
  ok(!!$('#set-nap'), 'thiếu nút nạp quán thủ công');
  const t = txt('#set-body');
  ok(t.includes('Nạp lần cuối'), 'không ghi ngày giờ nạp');
  ok(t.includes('Điểm đang dùng'), 'không cho biết đang có bao nhiêu điểm');
});
T('Chẩn đoán hệ thống (tầng 3) mới là nơi có OSM / MÃ BẢN / đồng bộ', () => {
  $('#set-diag').onclick();
  ok(!$('#sheet-diag').hidden, 'không mở');
  const t = txt('#diag-body');
  for (const need of ['MÃ BẢN', 'Đồng bộ', 'Mã máy', 'Mã tài xế'])
    ok(t.includes(need), 'thiếu "' + need + '" ở màn chẩn đoán');
});
T('Chẩn đoán có MÃ QUÁN để đối chiếu 2 máy, và tình trạng kho dữ liệu', () => {
  const t = txt('#diag-body');
  ok(t.includes('MÃ QUÁN'), 'không có cách nào kiểm 2 máy giống nhau 100%');
  ok(/[A-Z0-9]{7}/.test(t), 'mã quán rỗng');
  ok(t.includes('Kho dữ liệu'), 'không hiện tình trạng kho');
  ok(!!$('#dg-health'), 'thiếu nút kiểm tra kho');
  ok(!!$('#dg-nap'), 'thiếu nút nạp khu trong chẩn đoán');
  w.UI.closeSheets();
});
T('MÃ QUÁN đổi khi kho điểm đổi, không đổi khi chỉ dựng lại', () => {
  const a = w.RADAR.banQuan().ma;
  w.RADAR.store.buildSpots(null);
  eq(w.RADAR.banQuan().ma, a, 'dựng lại ra mã khác → tài xế tưởng 2 máy lệch');
  const r = w.RADAR.metrics().best;
  w.RADAR.act.hideSpot(r.sp.id);
  ok(w.RADAR.banQuan().ma !== a || w.RADAR.spots().length === 0, 'ẩn điểm mà mã không đổi');
});
T('🅿️ điểm chờ tối ưu: bấm vào phải có ĐI ĐẾN + tên quán trong cụm', () => {
  const d = w.RADAR.decision();
  if (!d.wait) { console.log('      (cụm quanh vị trí thử chưa đủ 3 quán — bỏ qua)'); return true; }
  w.UI.openWait();
  const html = String(rec.popupHtml || '');
  ok(/ĐI ĐẾN/.test(html), 'popup 🅿️ không có nút dẫn đường');
  ok(/maps\/dir/.test(html), 'không có link Google Maps');
  ok(/wlist|Đứng giữa cụm/.test(html), 'không kể tên quán trong cụm');
});
T('bấm ➕ → form đủ 4 phần: tên, địa chỉ, tick loại xe, nút lưu', () => {
  $('#btn-add').onclick();
  ok(!$('#sheet-add').hidden, 'không mở màn thêm quán');
  ok(!!$('#add-name'), 'thiếu ô gõ tên quán');
  ok(!!$('#add-addr'), 'thiếu ô địa chỉ theo định vị');
  eq(w.document.querySelectorAll('#add-body .vch').length, 3, 'thiếu lựa chọn loại xe');
  eq(w.document.querySelectorAll('#add-body .vch .tick').length, 3, 'loại xe không có ô tick');
  ok(!!$('#add-relocate'), 'thiếu nút lấy lại vị trí');
  ok(!!$('#add-save'), 'thiếu nút lưu');
});
T('CHƯA gõ gì thì KHÔNG đổ gợi ý (đẩy nút lưu xuống dưới màn hình)', () => {
  eq(w.document.querySelectorAll('#add-body .goi-r').length, 0,
    'gợi ý hiện ngay lúc mở form → tưởng chỉ chọn được quán có sẵn, không thêm tay được');
});
T('gõ đủ 2 chữ mới gợi ý, và nút lưu vẫn nằm trong form', () => {
  $('#add-name').value = 'Qu'; paintAddSync();
  ok(!!$('#add-save'), 'mất nút lưu khi có gợi ý');
  ok(!!$('#add-addr'), 'mất ô địa chỉ khi có gợi ý');
});
T('tick loại xe hiện dấu ✓ ở đúng ô được chọn', () => {
  const bs = [...w.document.querySelectorAll('#add-body .vch')];
  bs[1].onclick();                                  // ô tô
  const ticks = [...w.document.querySelectorAll('#add-body .vch')].map(b => (b.querySelector('.tick').textContent || '').trim());
  eq(ticks.filter(t => t === '✓').length, 1, 'số ô được tick sai: ' + JSON.stringify(ticks));
  eq(ticks[1], '✓', 'tick nhầm ô');
  bs[1].onclick();                                  // bấm lại = bỏ chọn
  eq([...w.document.querySelectorAll('#add-body .vch .tick')].filter(t => (t.textContent || '').trim()).length, 0, 'không bỏ tick được');
});
T('thiếu tên hoặc thiếu loại xe thì KHÔNG lưu (không đẻ điểm trống)', () => {
  const n0 = w.RADAR.picks.my().length;
  $('#add-save').onclick();                       // chưa gõ gì
  eq(w.RADAR.picks.my().length, n0, 'lưu được điểm không tên');
  $('#add-name').value = 'Quán Thử Nghiệm';
  $('#add-save').onclick();                       // có tên, chưa chọn xe
  eq(w.RADAR.picks.my().length, n0, 'lưu được điểm không rõ loại xe');
});
await Ta('điền đủ rồi lưu → có điểm mới kèm tên, ĐỊA CHỈ, loại xe, và xếp hàng đẩy lên', async () => {
  const n0 = w.RADAR.picks.my().length, q0 = w.SYNC.status().pending;
  w.document.querySelectorAll('#add-body .vch')[0].onclick();   // xe máy
  $('#add-name').value = 'Quán Thử Nghiệm';
  $('#add-addr').value = '53 Đường 30, P. Hiệp Bình';
  await $('#add-save').onclick();
  eq(w.RADAR.picks.my().length, n0 + 1, 'không lưu được');
  const p = w.RADAR.picks.my()[w.RADAR.picks.my().length - 1];
  eq(p.name, 'Quán Thử Nghiệm');
  eq(p.xe, 'may', 'không lưu loại xe');
  eq(p.addr, '53 Đường 30, P. Hiệp Bình', 'không lưu địa chỉ');
  ok(w.SYNC.status().pending > q0, 'không xếp hàng đẩy lên máy chủ');
});
T('địa chỉ đã lưu phải đi vào kho điểm (hiện được trên bản đồ)', () => {
  w.RADAR.store.buildSpots(); w.RADAR.recompute();
  const sp = w.RADAR.spots().find(s => s.name === 'Quán Thử Nghiệm');
  ok(sp, 'điểm không vào kho');
  eq(sp.addr, '53 Đường 30, P. Hiệp Bình', 'địa chỉ rơi mất giữa đường');
});
T('loại xe đã khai làm điểm đó lọc được ngay bằng 🏍️ (chưa cần cuốc nào)', () => {
  w.RADAR.store.buildSpots(); w.RADAR.recompute();
  const sp = w.RADAR.spots().find(s => s.name === 'Quán Thử Nghiệm');
  ok(sp, 'điểm không vào kho');
  const x = w.RADAR.util.xeCuaSpot(sp);
  ok(x && x.chinh === 'may', 'không nhận ra loại xe: ' + JSON.stringify(x));
  eq(x.khai, true, 'lời khai bị tính thành cuốc thật → app tự bịa thành tích');
  eq(x.oto + x.may, 0, 'lời khai bị cộng vào số cuốc đếm được');
});
T('gõ tên trùng → gợi ý quán đã có, không bắt tạo chấm mới', () => {
  const g = w.RADAR.act.timQuanGan('Quán Thử', 5);
  ok(g.length && g[0].sp.name === 'Quán Thử Nghiệm', 'không gợi ý ra quán vừa thêm');
  w.UI.closeSheets();
});
T('bấm 📝 Ghi cuốc → hiện 3 nút to', () => {
  $('#nav-log').onclick();
  ok(!!$('#lg-yes') && !!$('#lg-busy') && !!$('#lg-no'), 'thiếu nút ghi cuốc');
});
T('✅ CÓ KHÁCH → hỏi loại xe rồi mới ghi', () => {
  $('#lg-yes').onclick();
  ok(!!$('#lg-oto') && !!$('#lg-may'), 'không hỏi ô tô / xe máy');
});
T('chọn 🚗 Ô TÔ → ghi được cuốc thật, AI học ngay', () => {
  const n0 = w.RADAR.trips.all().length;
  $('#lg-oto').onclick();
  eq(w.RADAR.trips.all().length, n0 + 1, 'không ghi được cuốc');
  const t = w.RADAR.trips.mine()[0];
  eq(t.xe, 'oto'); ok(t.id, 'cuốc thiếu idempotency key'); ok(typeof t.p === 'number', 'không lưu % đã dự báo');
});
T('ghi cuốc xong → xếp hàng đẩy lên máy chủ (không im lặng nuốt)', () => {
  ok(w.SYNC.status().pending > 0, 'không có việc nào trong hàng đợi');
});
T('mất mạng thì hàng đợi giữ nguyên, không mất dữ liệu (§26)', () => {
  const q = JSON.parse(store.get('roadai_butl_queue_v1') || '[]');
  ok(q.length > 0, 'hàng đợi không được ghi xuống máy → tắt app là mất');
});
T('👀 "quán đang đông" ghi được và KHÔNG tính vào tỉ lệ nổ cuốc', () => {
  const r = w.RADAR.metrics().best;
  const key = w.RADAR.util.spotKey(r.sp);
  const before = w.RADAR.util.empOf(key) || { n: 0 };
  w.RADAR.G.pendingLog = r; w.UI.paint();
  $('#lg-busy').onclick();
  eq((w.RADAR.util.empOf(key) || { n: 0 }).n, before.n, 'quan sát bị tính thành cuốc');
});
T('nút ↻ đổi sang điểm khác được', () => {
  w.RADAR.G.pendingLog = null; w.UI.paint();
  const a = w.RADAR.decision().recommended_name;
  $('#c-skip').onclick();
  ok(w.RADAR.decision().recommended_name !== a || w.RADAR.metrics().byHot.length < 2, 'không đổi điểm');
});
T('bộ lọc 🚗 / 🏍️ đổi được danh sách', () => {
  const btns = [...w.document.querySelectorAll('#filters button')];
  eq(btns.length, 3, 'số nút lọc sai');
  btns[1].onclick(); eq(w.RADAR.G.filter, 'oto');
  btns[0].onclick(); eq(w.RADAR.G.filter, 'all');
});
T('nút "Nhận khách / Nghỉ" bật tắt được', () => {
  const on0 = w.RADAR.G.online;
  $('#tb-online').onclick();
  eq(w.RADAR.G.online, !on0);
  $('#tb-online').onclick();
  eq(w.RADAR.G.online, on0);
});
T('chỉ báo đồng bộ 🟢/🟡/🔴 có cập nhật', () => {
  w.UI.syncBadge(w.SYNC.status());
  ok(/[🟢🟡🔴]/.test(txt('#syncdot')), 'không có chỉ báo: ' + txt('#syncdot'));
});
T('mọi id giao diện js đi tìm đều tồn tại (trong html tĩnh hoặc do chính js dựng ra)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/radar-ui.js'), 'utf8');
  const co = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) co.add(m[1]);          // id trong html tĩnh
  for (const m of src.matchAll(/id="([a-z0-9-]+)"/gi)) co.add(m[1]);       // id do js dựng
  const thieu = [];
  for (const m of src.matchAll(/\$\('#([a-z0-9-]+)'\)/gi)) if (!co.has(m[1])) thieu.push('#' + m[1]);
  eq(thieu.length, 0, 'js đi tìm id không tồn tại: ' + thieu.join(', '));
  // các id CÓ TRONG HTML TĨNH phải tồn tại ngay từ đầu
  for (const id of ['#map', '#statusbar', '#filters', '#card', '#nav', '#toast', '#btn-center', '#btn-add',
    '#newzone', '#syncdot', '#sheet-why', '#sheet-dash', '#sheet-set', '#sheet-diag',
    '#why-body', '#dash-body', '#set-body', '#diag-body', '#nav-log', '#nav-dash', '#nav-set'])
    ok(!!$(id), 'thiếu ' + id + ' trong kiem-cuoc.html');
});
T('không có id trùng nhau trong html', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  eq(new Set(ids).size, ids.length, 'id bị trùng');
});
T('không còn tham chiếu tới file/hàm đã bỏ', () => {
  const h = fs.readFileSync(path.join(ROOT, 'kiem-cuoc.html'), 'utf8');
  ok(!/css\/style\.css/.test(h), 'vẫn nạp style.css (trang này không cần nữa)');
  for (const f of ['js/positioning.js', 'js/radar-sync.js', 'js/radar-ui.js']) ok(h.includes(f), 'thiếu ' + f);
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  for (const f of ['radar-sync.js', 'radar-ui.js']) ok(sw.includes(f), 'sw.js chưa cache ' + f);
});

console.log(`\n${'═'.repeat(56)}\n  ĐẠT ${pass}  ·  HỎNG ${fail}\n${'═'.repeat(56)}\n`);
process.exit(fail ? 1 : 0);
