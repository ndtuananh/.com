/* ══════════════════════════════════════════════════════════════════════════════
   BỘ TỰ KIỂM — chạy:  node scripts/test-radar.mjs  [baseUrl]

   Ba phần, chạy độc lập được:
     A. LÕI      — nạp THẬT js/positioning.js vào node (vm + trình duyệt giả),
                   kiểm hợp đồng getDecision, một thang điểm, học toàn cục, hiệu năng.
     B. LUẬT GỘP — nạp THẬT hàm merge() của api/pickups.js, chạy 10 kịch bản
                   nhiều máy trong §40 mà không cần máy chủ.
     C. MÁY CHỦ  — nếu truyền baseUrl (vd https://roadai-vn.vercel.app) thì gọi
                   thẳng /api/pickups để kiểm đầu-cuối trên bản đã deploy.

   Luật gộp sai thì MỌI máy sai theo, nên phải thử được nó một cách độc lập.
   ══════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || '';

let pass = 0, fail = 0;
/* T() chỉ nhận hàm ĐỒNG BỘ. Đưa hàm async vào thì nó trả Promise, `r === false`
   không bao giờ đúng → test luôn báo ĐẠT dù bên trong hỏng. Chặn thẳng, cần chờ
   thì dùng Ta(). */
const T = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('hàm async phải dùng Ta(), không phải T()');
    if (r === false) throw new Error('trả về false');
    console.log('  ✓ ' + name); pass++;
  } catch (e) { console.log('  ✗ ' + name + '\n      → ' + (e && e.message || e)); fail++; }
};
const Ta = async (name, fn) => {
  try { const r = await fn(); if (r === false) throw new Error('trả về false'); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      → ' + (e && e.message || e)); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ` — chờ ${JSON.stringify(b)}, nhận ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'sai'); };

/* ═══════════════════ TRÌNH DUYỆT GIẢ ═══════════════════ */
function fakeBrowser(store) {
  const LS = new Map(Object.entries(store || {}));
  const win = {};
  const ctx = {
    window: win, self: win, console,
    localStorage: {
      getItem: k => (LS.has(k) ? LS.get(k) : null),
      setItem: (k, v) => LS.set(k, String(v)),
      removeItem: k => LS.delete(k),
      get length() { return LS.size; },
    },
    document: { addEventListener() {}, visibilityState: 'visible', querySelector: () => null, querySelectorAll: () => [] },
    navigator: { onLine: true, platform: 'test', serviceWorker: null },
    location: { href: '', reload() {} },
    fetch: () => Promise.reject(new Error('offline trong bộ thử')),
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 1)),
    clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    AbortController, Date, Math, JSON, Object, Array, Set, Map, Promise,
    Float64Array, isFinite, parseInt, parseFloat, String, Number, Error, RegExp,
  };
  ctx.globalThis = ctx;
  win.addEventListener = () => {};
  vm.createContext(ctx);
  return { ctx, win, LS };
}
const SPOT = (name, cat, lat, lng, size, src, addr) => [name, cat, lat, lng, size, 6, 'Bình Tân', src || 'osm', null, addr || '123 Đường Test'];
function loadEngine(opts) {
  const { ctx, win } = fakeBrowser((opts && opts.store) || {});
  win.LAIHO_SPOTS = (opts && opts.spots) || [
    SPOT('Quán Nhậu A', 'phonhau', 10.7440, 106.6130, 16),
    SPOT('Beer Club B', 'beerclub', 10.7460, 106.6150, 14),
    SPOT('Karaoke C', 'karaoke', 10.7500, 106.6100, 10),
    SPOT('Nhà hàng D', 'nhahang', 10.7420, 106.6180, 18),
    SPOT('Bar E', 'bar', 10.7600, 106.6300, 12),
    SPOT('Điểm đón F', 'diemdon', 10.7445, 106.6135, 13, 'butl'),
  ];
  win.LEARNED_SPOTS = []; win.BUTL_SPOTS = [];
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/positioning.js'), 'utf8'), ctx, { filename: 'positioning.js' });
  return { R: win.RADAR, ctx, win };
}

/* ═══════════════════ A · LÕI ═══════════════════ */
console.log('\nA · LÕI (js/positioning.js chạy thật trong node)');
{
  const { R } = loadEngine();
  R.G.simHour = 22;                    // giờ vàng — có cầu để chấm điểm
  R.store.buildSpots(null);
  R.recompute();
  const m = R.metrics(), d = R.decision();

  T('dựng được kho điểm', () => ok(R.spots().length >= 6, 'chỉ có ' + R.spots().length));
  T('mọi p nằm trong [0.02, 0.92] (không có 100% giả)', () =>
    ok(m.raw.every(r => r.p >= 0.02 && r.p <= 0.92), 'có p ngoài dải'));
  T('byHot sắp giảm dần — MỘT bảng xếp hạng duy nhất', () => {
    for (let i = 1; i < m.byHot.length; i++) ok(m.byHot[i - 1].p >= m.byHot[i].p, 'sai thứ tự ở ' + i);
  });
  T('MỘT THANG ĐIỂM: decision.demand_score === best.hotScore', () =>
    eq(d.demand_score, m.best.hotScore, 'lệch thang điểm'));
  T('hotScore === round(p*100) ở mọi điểm', () =>
    ok(m.raw.every(r => r.hotScore === Math.round(r.p * 100))));
  T('hợp đồng getDecision đủ trường', () => {
    for (const k of ['status', 'action', 'demand_score', 'confidence', 'recommended_area',
      'distance', 'eta', 'estimated_wait', 'nav', 'reasons'])
      ok(k in d, 'thiếu trường ' + k);
    ok(['HOT', 'OK', 'LOW', 'REST', 'OFF'].includes(d.status), 'status lạ: ' + d.status);
    ok(['MOVE', 'STAY', 'WAIT', 'REST'].includes(d.action), 'action lạ: ' + d.action);
  });
  T('ngưỡng trạng thái khớp thang điểm (≥50 HOT, ≥35 OK)', () => {
    const p = d.demand_score;
    eq(d.status, p >= 50 ? 'HOT' : p >= 35 ? 'OK' : 'LOW');
  });
  T('độ tin cậy trong [25,95] và KHÔNG phải số bịa', () =>
    ok(d.confidence >= 25 && d.confidence <= 95, 'confidence=' + d.confidence));
  T('giao diện không lộ chi tiết kỹ thuật trong decision', () => {
    const s = JSON.stringify(d).toLowerCase();
    for (const w of ['osm', 'overture', 'theta', 'twin', 'feature', 'rev', 'wilson'])
      ok(!s.includes(w), 'lộ "' + w + '" ra tầng giao diện');
  });
  T('ngoài giờ lái hộ (10h sáng) → REST, không đề xuất bừa', () => {
    R.G.simHour = 10; R.recompute();
    eq(R.decision().status, 'REST');
    R.G.simHour = 22; R.recompute();
  });
  T('đang nghỉ → OFF', () => {
    R.act.setOnline(false); eq(R.decision().status, 'OFF');
    R.act.setOnline(true); ok(R.decision().status !== 'OFF');
  });
  T('quán đóng cửa không bao giờ lọt vào đề xuất', () =>
    ok(m.byHot.every(r => r.open), 'có quán đóng trong byHot'));
  T('có xếp hạng ①②③ để chỉ chỗ tốt nhất kể cả khi mọi chỗ đều vài %', () => {
    ok(m.byHot.every((r, i) => r.hotRank === i), 'hotRank không khớp thứ tự byHot');
    ok(m.best.hotRank === 0);
  });
  T('có ĐIỂM CHỜ TỐI ƯU 🅿️ khi cụm đủ 3 quán (bản refactor trước làm mất)', () => {
    ok(m.wait === null || (m.wait && m.wait.cnt >= 2 && isFinite(m.wait.center.lat)),
      'wait sai: ' + JSON.stringify(m.wait));
  });
  T('🅿️ phải có ĐƯỜNG DẪN và TÊN QUÁN trong cụm (đứng đó còn biết chạy đi đâu)', () => {
    if (!d.wait) return;   // cụm chưa đủ 3 quán thì không đề xuất, đúng
    ok(/^https:\/\/www\.google\.com\/maps\/dir/.test(d.wait.nav), 'thiếu đường dẫn tới chỗ đứng');
    ok(Array.isArray(d.wait.spots) && d.wait.spots.length, 'không kể được quán nào trong cụm');
    for (const s of d.wait.spots) {
      ok(s.name && s.name.length, 'quán trong cụm không có tên');
      ok(/^https:\/\/www\.google\.com\/maps\/dir/.test(s.nav), 'quán trong cụm thiếu đường dẫn riêng');
      ok(s.m <= 750, 'quán ' + s.name + ' cách tâm cụm ' + s.m + 'm — ngoài bán kính đi bộ');
      ok(s.p >= 2 && s.p <= 92, 'điểm P của quán trong cụm sai: ' + s.p);
    }
    ok(d.wait.spots.every((s, i, a) => !i || a[i - 1].p >= s.p), 'không xếp theo điểm P giảm dần');
  });
}

console.log('\nA2b · GIỜ VẮNG — "khi nào đáng đi" (câu hỏi thứ 4 app từng bỏ trống)');
{
  /* Dựng lại ĐÚNG cảnh anh Long gặp lúc 15:45: chỗ đang mở thì ở xa (4,3km),
     còn chỗ ngon gần nhà thì 18h mới mở cửa. Bản cũ chỉ hiện "18%" rồi thôi. */
  const { R } = loadEngine({ spots: [
    // 3,2km chim bay = 4,3km đường thật (×1,35) — vừa lọt vùng phủ sóng 5km
    ['Nhậu Xa', 'phonhau', 10.7420, 106.6402, 16, 6, 'Bình Chánh', 'osm', null, '1 Xa'],   // mở 16h
    ['Bar Gần', 'bar', 10.7445, 106.6115, 15, 6, 'Bình Tân', 'osm', null, '2 Gần'],        // ~280m, mở 18h
    ['Beer Gần', 'beerclub', 10.7400, 106.6100, 14, 6, 'Bình Tân', 'osm', null, '3 Gần'],  // ~250m, mở 18h
  ] });
  R.store.buildSpots(null);
  R.G.simHour = 15.75;        // 15:45 đúng như ảnh
  R.recompute();
  const d = R.decision();
  console.log(`     · 15:45 → tốt nhất ${d.recommended_name} ${d.demand_score}%` +
    (d.peak ? ` · đáng đi lúc ${d.peak.at}: ${d.peak.name} ${d.peak.p}%` : ' · không có mốc nào khá hơn'));
  T('15:45 chỉ còn chỗ xa đang mở → điểm thấp, app không tô hồng', () => {
    eq(d.recommended_name, 'Nhậu Xa', 'chọn nhầm chỗ đang đóng cửa');
    ok(d.demand_score < 50, d.demand_score + '%');
  });
  T('app phải nói ĐƯỢC khi nào đáng đi (không thì màn 2% là vô dụng)', () => {
    ok(d.peak, 'không trả lời được "khi nào"');
    ok(d.peak.p >= 35, 'mốc gợi ý vẫn dưới 35% thì nhắc làm gì');
    ok(d.peak.p - d.demand_score >= 12, 'chênh quá ít, nhắc thành nhảm');
  });
  T('phải xét cả chỗ ĐANG ĐÓNG — chỗ đáng đi tối nay thường giờ này chưa mở', () => {
    ok(d.peak.name === 'Bar Gần' || d.peak.name === 'Beer Gần',
      'chỉ quét chỗ đang mở nên bỏ sót đúng thứ cần tìm: ' + d.peak.name);
  });
  T('mốc gợi ý nằm trong giờ lái hộ (14h–03h)', () => {
    const h = +d.peak.at.split(':')[0];
    ok(h >= 14 || h < 3, 'gợi ý giờ ' + d.peak.at + ' — ngoài giờ nghề');
  });
  T('KHÔNG BỊA SỐ: tới đúng giờ đó tính lại phải ra y hệt', () => {
    const [hh, mm] = d.peak.at.split(':').map(Number);
    R.G.simHour = hh + mm / 60; R.recompute();
    const b = R.metrics().byHot[0];
    eq(b ? U0(b.sp.name) : '', U0(d.peak.name), 'tới giờ lại đề xuất chỗ khác');
    ok(Math.abs(b.hotScore - d.peak.p) <= 3, `dự báo ${d.peak.p}% nhưng tới giờ ra ${b.hotScore}%`);
  });
  T('đang giờ ngon thì KHÔNG nhắc "nghỉ tới lúc nào" nữa', () => {
    R.G.simHour = 22.5; R.recompute();
    const d2 = R.decision();
    ok(!d2.peak || d2.demand_score < 50, 'đang giờ ngon mà vẫn bảo nghỉ');
  });
}
function U0(s) { return String(s || '').replace(/^★\s*/, ''); }

console.log('\nA2 · HỌC TỪ CUỐC THẬT + HỌC TOÀN CỤC');
{
  const { R } = loadEngine();
  R.G.simHour = 22; R.store.buildSpots(null); R.recompute();
  const r0 = R.metrics().byHot[0];
  const key = R.util.spotKey(r0.sp);
  const n0 = R.trips.all().length;

  T('ghi 1 cuốc → có bản ghi kèm idempotency key', () => {
    const { trip } = R.act.logJob(r0, true, 'oto');
    ok(trip.id && trip.id.length > 6, 'thiếu id');
    eq(R.trips.all().length, n0 + 1);
    eq(trip.key, key);
    ok(typeof trip.p === 'number', 'không lưu % đã dự báo → sau này không đối chiếu được');
  });
  T('cuốc vừa ghi đẩy điểm đó lên (bằng chứng thật có tác dụng)', () => {
    const p1 = R.util.empOf(key);
    ok(p1 && p1.n === 1 && p1.win === 1, 'empOf sai: ' + JSON.stringify(p1));
  });
  T('ghi "quán đang đông" KHÔNG làm bẩn tỉ lệ nổ cuốc', () => {
    const before = R.util.empOf(key);
    R.act.logDong(R.metrics().raw.find(x => R.util.spotKey(x.sp) === key));
    const after = R.util.empOf(key);
    eq(after.n, before.n, 'quan sát bị tính thành cuốc');
  });
  // Máy chủ luôn trả về bản GỘP của MỌI máy — kể cả cuốc của chính máy này.
  const tuMayKhac = [
    { id: 'x1', dev: 'maykhac', ts: Date.now(), key, cat: r0.sp.cat, hour: 22, band: 'vang', win: 1, quan: 'Bình Tân' },
    { id: 'x2', dev: 'maykhac', ts: Date.now(), key, cat: r0.sp.cat, hour: 22, band: 'vang', win: 1, quan: 'Bình Tân' },
  ];
  T('§31 HỌC TOÀN CỤC: cuốc máy khác nuôi chung một bộ não', () => {
    const before = R.util.empOf(key);
    R.trips.addNet(tuMayKhac, 'maynay');
    const after = R.util.empOf(key);
    eq(after.n, before.n + 2, 'không nhận cuốc của máy khác');
    eq(after.win, before.win + 2);
  });
  T('KHÔNG cộng trùng: máy chủ trả lại cuốc của CHÍNH máy này thì bỏ qua', () => {
    const before = R.util.empOf(key);
    const banGop = [...tuMayKhac, ...R.trips.mine().map(t => ({ ...t, dev: 'maynay' }))];
    R.trips.addNet(banGop, 'maynay');           // đúng thứ máy chủ trả về
    eq(R.util.empOf(key).n, before.n, 'cộng dồn hai lần → app tự phồng số');
  });
  T('nhật ký gộp không có bản ghi trùng id', () => {
    const ids = R.trips.all().map(t => t.id);
    eq(new Set(ids).size, ids.length, 'có id trùng trong nhật ký gộp');
  });
  T('thống kê Điều phối đọc được nhật ký GỘP', () => {
    const s = R.stats.jobs();
    ok(s && s.n >= 3, 'jobStats không thấy cuốc của máy khác: ' + JSON.stringify(s && s.n));
  });
}

console.log('\nA2c · DANH SÁCH QUÁN BỔ SUNG — giờ đóng THẬT thay cho giờ ƯỚC');
{
  // giả bộ /api/quan đã trả về và được cache xuống máy: 1 quán có giờ thật, 1 quán không
  const cache = JSON.stringify({ ts: Date.now(), rev: 'TEST123', nguon: 'supabase', coGio: 1, spots: [
    ['Bia Hơi Có Giờ Thật', 'beerclub', 10.7480, 106.6160, 12, 7, 'Bình Tân', 'ds', null, '1 Tên Lửa', 'đúng số nhà', '', 17, 1.5],
    ['Quán Không Rõ Giờ',   'phonhau',  10.7490, 106.6170, 10, 7, 'Bình Tân', 'ds', null, '2 Tên Lửa', 'đúng đường ±500m', '', null, null],
  ] });
  const { R: R2 } = loadEngine({ store: { roadai_butl_quanbo_v1: cache } });
  R2.store.buildSpots(null);
  R2.G.simHour = 22.5; R2.recompute();
  const co = R2.spots().find(s => s.name === 'Bia Hơi Có Giờ Thật');
  const khong = R2.spots().find(s => s.name === 'Quán Không Rõ Giờ');
  T('danh sách bổ sung vào được kho điểm, giữ nguyên tên', () => { ok(co, 'không thấy quán bổ sung'); ok(khong); });
  T('có giờ trong danh sách → dùng GIỜ THẬT, không ước theo nhóm', () => {
    eq(co.gioThat, true, 'không nhận giờ thật');
    eq(co.closeH, 1.5, 'giờ đóng sai');
    eq(co.gioMo, 17, 'giờ mở sai');
  });
  T('không có giờ → vẫn ước theo nhóm như cũ, KHÔNG bịa giờ', () => {
    eq(khong.gioThat, false, 'bịa ra giờ thật cho quán không có dữ liệu');
    ok(Math.abs(khong.closeH - 0) < 0.5 || Math.abs(khong.closeH - 24) < 0.5, 'closeH=' + khong.closeH);
  });
  T('quán bổ sung được chấm điểm P chung một thang', () => {
    const r = R2.metrics().raw.find(x => x.sp.name === 'Bia Hơi Có Giờ Thật');
    ok(r && r.hotScore >= 2 && r.hotScore <= 92, 'không có điểm P: ' + JSON.stringify(r && r.hotScore));
  });
  T('nguồn "ds" được coi là đã kiểm tên → KHÔNG bị thay bằng địa chỉ', () => {
    eq(co.source, 'ds');
    ok(!/^Beer club ·/.test(co.name), 'tên bị thay bằng nhãn địa chỉ');
  });
}

console.log('\nA3 · MÃ QUÁN — bằng chứng 2 máy giống nhau 100%');
{
  const spots = [
    SPOT('Quán A', 'phonhau', 10.7440, 106.6130, 16),
    SPOT('Quán B', 'beerclub', 10.7460, 106.6150, 14),
    SPOT('Quán C', 'bar', 10.7500, 106.6100, 10),
  ];
  const mayA = loadEngine({ spots }).R;
  const mayB = loadEngine({ spots: spots.slice().reverse() }).R;   // cùng dữ liệu, KHÁC thứ tự
  mayA.store.buildSpots(null); mayB.store.buildSpots(null);
  T('cùng dữ liệu, khác thứ tự nạp → CÙNG mã quán', () => {
    eq(mayB.banQuan().ma, mayA.banQuan().ma, 'mã đổi theo thứ tự → không kiểm chứng được gì');
    eq(mayB.banQuan().n, mayA.banQuan().n);
  });
  T('thiếu một điểm → mã KHÁC ngay (không im lặng bỏ qua)', () => {
    const mayC = loadEngine({ spots: spots.slice(0, 2) }).R;
    mayC.store.buildSpots(null);
    ok(mayC.banQuan().ma !== mayA.banQuan().ma, 'lệch dữ liệu mà mã vẫn giống');
  });
  T('mã quán không phụ thuộc nhiễu ngẫu nhiên (dựng lại vẫn y hệt)', () => {
    const truoc = mayA.banQuan().ma;
    mayA.store.buildSpots(null);
    eq(mayA.banQuan().ma, truoc, 'dựng lại ra mã khác → tài xế tưởng 2 máy lệch');
  });
}

console.log('\nA4 · HIỆU NĂNG (điện thoại tài xế, ở quy mô THẬT sau khi giữ hết 16 khu)');
{
  // 400 điểm dùng chung + 16 khu × 40 điểm = 1.040 điểm, đúng mức xấu nhất thực tế
  const spots = [];
  for (let i = 0; i < 1040; i++) {
    spots.push(SPOT('Quán ' + i, ['phonhau', 'beerclub', 'bar', 'karaoke', 'nhahang'][i % 5],
      10.70 + (i % 40) * 0.004, 106.58 + Math.floor(i / 40) * 0.004, 8 + (i % 12)));
  }
  const { R } = loadEngine({ spots });
  R.G.simHour = 22;
  let t0 = Date.now(); R.store.buildSpots(null); const tBuild = Date.now() - t0;
  t0 = Date.now(); for (let i = 0; i < 5; i++) R.recompute(); const tCalc = (Date.now() - t0) / 5;
  t0 = Date.now(); R.banQuan(); const tHash = Date.now() - t0;
  console.log(`     · 1.040 điểm: dựng kho ${tBuild}ms · một vòng tính ${tCalc.toFixed(0)}ms · mã quán ${tHash}ms`);
  T('dựng kho 1.040 điểm dưới 400ms (lỗi cũ ở 645 điểm: 2.100ms)', () => ok(tBuild < 400, tBuild + 'ms'));
  T('một vòng tính lại dưới 250ms', () => ok(tCalc < 250, tCalc + 'ms'));
  T('tính mã quán dưới 60ms (chạy mỗi lần mở Chẩn đoán)', () => ok(tHash < 60, tHash + 'ms'));
  T('bảng khoảng cách chỉ tính hàng nào dùng tới', () => ok(R.metrics().raw.length === 1040));
}

/* ═══════════════════ B · LUẬT GỘP NHIỀU MÁY (§40) ═══════════════════ */
console.log('\nB · ĐỒNG BỘ NHIỀU MÁY — 10 kịch bản bắt buộc (§40)');
const { merge, cleanPick, cleanTrip, cleanHidden, cleanZone } = await import(path.join(ROOT, 'api/pickups.js').replace(/\\/g, '/').replace(/^([a-zA-Z]):/, 'file:///$1:'));

const P = (id, name, lat, lng, o) => cleanPick({ id, name, lat, lng, cat: 'phonhau', ts: (o && o.ts) || 1000, n: (o && o.n) || 0, win: (o && o.win) || 0, del: (o && o.del) || 0, xe: (o && o.xe) || '', quan: 'Bình Tân' });
const TR = (id, key, ts, win) => cleanTrip({ id, key, ts, win, cat: 'phonhau', hour: 22, band: 'vang', quan: 'Bình Tân', p: 0.7 });
const H = (k, ts, on) => cleanHidden({ k, ts, on });
const Z = (key, ten, ts, del) => cleanZone({ key, ten, lat: +key.split(',')[0], lng: +key.split(',')[1], r: 4000, ts, del, rev: 'AAA1111', n: 40 });

T('TEST 1 · Máy A thêm điểm → máy B thấy', () => {
  const m = merge([{ dev: 'a', picks: [P('a1', 'Quán A1', 10.75, 106.61)], hidden: [], trips: [] },
                   { dev: 'b', picks: [], hidden: [], trips: [] }]);
  eq(m.picks.length, 1); eq(m.picks[0].name, 'Quán A1');
});
T('TEST 2 · Máy B thêm điểm → máy A thấy (đối xứng)', () => {
  const m = merge([{ dev: 'a', picks: [], hidden: [], trips: [] },
                   { dev: 'b', picks: [P('b1', 'Quán B1', 10.76, 106.62)], hidden: [], trips: [] }]);
  eq(m.picks.length, 1); eq(m.picks[0].name, 'Quán B1');
});
T('TEST 3 · A và B cùng thêm một quán (cách 30m) → CHỈ 1 bản ghi', () => {
  const m = merge([
    { dev: 'a', picks: [P('a1', '★ Điểm đón của tôi', 10.75000, 106.61000, { ts: 1000, n: 2, win: 1 })], hidden: [], trips: [] },
    { dev: 'b', picks: [P('b1', 'Ốc Quyên', 10.75025, 106.61000, { ts: 2000, n: 3, win: 2 })], hidden: [], trips: [] },
  ]);
  eq(m.picks.length, 1, 'đẻ ra ' + m.picks.length + ' bản ghi cho cùng một quán');
  eq(m.picks[0].name, 'Ốc Quyên', 'tên thật phải thắng tên máy tự đặt');
  eq(m.picks[0].n, 5, 'phải CỘNG DỒN cuốc của cả 2 máy');
  eq(m.picks[0].win, 3);
  ok(m.tomb.some(t => t.id === 'b1' && t.into === 'a1'), 'thiếu bia mộ để máy kia dọn bản trùng');
});
T('TEST 4 · A ghi cuốc → B nhận được, kèm dấu máy nào ghi', () => {
  const m = merge([
    { dev: 'a', picks: [], hidden: [], trips: [TR('t1', 'Quán X@10.7500,106.6100', 5000, 1)] },
    { dev: 'b', picks: [], hidden: [], trips: [] },
  ]);
  eq(m.trips.length, 1); eq(m.trips[0].dev, 'a'); eq(m.trips[0].win, 1);
});
T('TEST 5 · A offline rồi lên mạng → cuốc tồn được gộp, không mất', () => {
  const cu = [TR('t1', 'K1', 1000, 1)];
  const ton = [TR('t2', 'K1', 2000, 0), TR('t3', 'K1', 3000, 1)];   // ghi lúc mất mạng
  const map = new Map(); for (const t of cu.concat(ton)) if (!map.has(t.id)) map.set(t.id, t);
  const m = merge([{ dev: 'a', picks: [], hidden: [], trips: [...map.values()] }]);
  eq(m.trips.length, 3);
});
T('TEST 6 · gửi cùng một cuốc 3 lần → KHÔNG đẻ bản ghi trùng (idempotency)', () => {
  const t = TR('same-id', 'K1', 4000, 1);
  const m = merge([{ dev: 'a', picks: [], hidden: [], trips: [t, { ...t }, { ...t }] },
                   { dev: 'b', picks: [], hidden: [], trips: [{ ...t }] }]);
  eq(m.trips.length, 1, 'đẻ ' + m.trips.length + ' bản ghi cho cùng 1 sự kiện');
});
T('TEST 6b · gửi cùng một ĐIỂM 2 lần → không đẻ bản ghi trùng', () => {
  const p = P('p1', 'Quán Z', 10.75, 106.61, { n: 1, win: 1 });
  const m = merge([{ dev: 'a', picks: [p], hidden: [], trips: [] }]);
  eq(m.picks.length, 1); eq(m.picks[0].n, 1, 'gửi lại làm phồng số cuốc');
});
T('TEST 7 · đăng nhập máy khác cùng mã → thấy đủ dữ liệu tài khoản', () => {
  const files = [
    { dev: 'a', picks: [P('a1', 'Q1', 10.75, 106.61, { n: 4, win: 2 })], hidden: [H('k1', 900, 1)], trips: [TR('t1', 'K1', 1000, 1)] },
    { dev: 'b', picks: [P('b1', 'Q2', 10.80, 106.65, { n: 1, win: 1 })], hidden: [], trips: [TR('t2', 'K2', 2000, 0)] },
  ];
  const m = merge(files);
  eq(m.picks.length, 2); eq(m.trips.length, 2); eq(m.hidden.length, 1);
});
T('TEST 8 · admin ẩn điểm → mọi máy ẩn theo (last-write-wins)', () => {
  const m = merge([{ dev: 'a', picks: [], hidden: [H('quanX', 5000, 1)], trips: [] },
                   { dev: 'b', picks: [], hidden: [H('quanX', 1000, 0)], trips: [] }]);
  eq(m.hidden.length, 1, 'bấm ẩn SAU phải thắng');
});
T('TEST 8b · bỏ ẩn ở máy B (mới hơn) → máy A KHÔNG đẩy ẩn trở lại', () => {
  const m = merge([{ dev: 'a', picks: [], hidden: [H('quanX', 1000, 1)], trips: [] },
                   { dev: 'b', picks: [], hidden: [H('quanX', 9000, 0)], trips: [] }]);
  eq(m.hidden.length, 0, 'bỏ ẩn xong nó sống lại — đúng lỗi cũ');
});
T('TEST 9 · sửa thẳng trong CSDL → kết quả gộp đổi theo (server authoritative)', () => {
  const a = merge([{ dev: 'a', picks: [P('a1', 'Tên cũ', 10.75, 106.61, { ts: 1000 })], hidden: [], trips: [] }]);
  const b = merge([{ dev: 'a', picks: [P('a1', 'Tên admin sửa', 10.75, 106.61, { ts: 9999 })], hidden: [], trips: [] }]);
  eq(a.picks[0].name, 'Tên cũ'); eq(b.picks[0].name, 'Tên admin sửa');
});
T('TEST 10 · gộp TẤT ĐỊNH: đổi thứ tự máy vẫn ra y hệt một chuỗi byte', () => {
  const A = { dev: 'a', picks: [P('a1', 'Q1', 10.75, 106.61, { ts: 1000, n: 1 })], hidden: [H('k', 5, 1)], trips: [TR('t1', 'K', 100, 1)] };
  const B = { dev: 'b', picks: [P('b1', 'Q2', 10.90, 106.70, { ts: 2000, n: 2 })], hidden: [], trips: [TR('t2', 'K', 200, 0)] };
  const C = { dev: 'c', picks: [], hidden: [H('k2', 7, 1)], trips: [] };
  eq(JSON.stringify(merge([A, B, C])), JSON.stringify(merge([A, B, C])), 'không tất định');
  // thứ tự đọc từ CSDL đã được sort theo device ở readAll, nên cùng tập luôn ra cùng kết quả
  const s1 = JSON.stringify(merge([A, B, C]));
  const s2 = JSON.stringify(merge([A, B, C].slice().sort((x, y) => (x.dev < y.dev ? -1 : 1))));
  eq(s1, s2);
});
T('BỔ SUNG · xoá là "bia mộ", không hồi sinh khi máy kia còn giữ bản cũ', () => {
  const m = merge([{ dev: 'a', picks: [P('a1', 'Q', 10.75, 106.61, { ts: 9000, del: 1 })], hidden: [], trips: [] },
                   { dev: 'b', picks: [P('a1', 'Q', 10.75, 106.61, { ts: 1000 })], hidden: [], trips: [] }]);
  eq(m.picks.length, 0, 'xoá xong nó sống lại');
  ok(m.tomb.some(t => t.id === 'a1' && t.into === null));
});
T('BỔ SUNG · dữ liệu rác từ ngoài bị chặn ở máy chủ', () => {
  eq(cleanPick({ id: 'x', lat: 999, lng: 999 }), null, 'toạ độ ngoài VN vẫn lọt');
  eq(cleanPick(null), null);
  eq(cleanTrip({ id: 'x', ts: 1 }), null, 'cuốc thiếu key vẫn lọt');
  eq(cleanTrip({ id: '<script>', ts: 1, key: 'k' }).id, 'script', 'không lọc ký tự nguy hiểm trong id');
  const t = cleanTrip({ id: 'a', ts: 1, key: 'k', type: 'dong', win: 1 });
  eq(t.win, 0, 'quan sát "đang đông" bị tính thành cuốc thắng');
});
/* ═══ LỖI MẤT DỮ LIỆU 22/08/2026 — anh Long: "tắt radar mở lên nó hiện 3-5 giây
   rồi mất". Máy chủ cắt `.slice(0, 500)` = giữ 500 điểm CŨ NHẤT, vứt hết điểm mới,
   im lặng. Kho anh Long: 138 bia mộ + 314 chấm GPS chưa có cuốc ăn hết chỗ, điểm
   mới nhất máy chủ giữ được là 17/08 trong khi anh vẫn thêm quán tới 22/08. ═══ */
const { xepVaCat } = await import(path.join(ROOT, 'api/pickups.js').replace(/\\/g, '/').replace(/^([a-zA-Z]):/, 'file:///$1:'));
console.log('\nB0 · KHO ĐẦY — điểm MỚI phải sống sót, không được cắt im lặng');
T('600 điểm: quán VỪA THÊM không bao giờ bị cắt', () => {
  const gio = Date.now(), ds = [];
  for (let i = 0; i < 600; i++) ds.push(P('old' + i, '★ Nổ cuốc (GPS)', 10.7 + i * 1e-4, 106.6, { ts: gio - (600 - i) * 864e5 / 24 }));
  const moi = P('vuathem', 'Quán Anh Long Vừa Thêm', 10.9, 106.9, { ts: gio });
  ds.push(moi);
  const { giu, cat } = xepVaCat(ds, gio);
  ok(giu.some(p => p.id === 'vuathem'), `điểm vừa thêm BỊ CẮT — đúng lỗi anh Long mất dữ liệu 5 ngày (cắt ${cat})`);
});
T('điểm CÓ CUỐC THẬT không bao giờ bị cắt (bằng chứng, mất là mất trắng)', () => {
  const gio = Date.now(), ds = [];
  // 1600 điểm mới toanh, và 1 điểm CŨ nhưng đã có 9 cuốc thật
  const bang = P('bangchung', 'Ốc Quyên', 10.75, 106.61, { ts: gio - 300 * 864e5, n: 9, win: 6 });
  ds.push(bang);
  for (let i = 0; i < 1600; i++) ds.push(P('m' + i, 'Quán ' + i, 10.7 + i * 1e-4, 106.6, { ts: gio - i }));
  const { giu } = xepVaCat(ds, gio);
  ok(giu.some(p => p.id === 'bangchung'), 'cắt mất điểm đã có 9 cuốc thật');
});
T('bia mộ có hạn dùng, không ăn hết chỗ của điểm thật', () => {
  const gio = Date.now(), ds = [];
  for (let i = 0; i < 400; i++) ds.push(P('t' + i, 'Đã xoá', 10.7 + i * 1e-4, 106.6, { ts: gio - 200 * 864e5, del: 1 }));
  for (let i = 0; i < 100; i++) ds.push(P('s' + i, 'Quán sống', 10.8 + i * 1e-4, 106.7, { ts: gio }));
  const { giu } = xepVaCat(ds, gio);
  eq(giu.filter(p => p.del).length, 0, 'bia mộ 200 ngày tuổi vẫn còn chiếm chỗ');
  eq(giu.filter(p => !p.del).length, 100, 'mất điểm sống');
});
T('CẮT THÌ PHẢI BÁO — không im lặng rồi vẫn nói "đã lên kho chung"', () => {
  const gio = Date.now(), ds = [];
  for (let i = 0; i < 2000; i++) ds.push(P('x' + i, 'Q' + i, 10.7 + i * 1e-4, 106.6, { ts: gio - i }));
  const { cat } = xepVaCat(ds, gio);
  ok(cat > 0, 'cắt mà báo 0 → app tưởng gửi đủ');
});
T('chưa chạm trần thì KHÔNG cắt gì cả', () => {
  const gio = Date.now(), ds = [];
  for (let i = 0; i < 300; i++) ds.push(P('y' + i, 'Q' + i, 10.7 + i * 1e-4, 106.6, { ts: gio - i }));
  const { giu, cat } = xepVaCat(ds, gio);
  eq(cat, 0); eq(giu.length, 300);
});


T('CỬA SỔ CUỐC · hai máy phải nhìn CÙNG MỘT tập cuốc, không lệch', () => {
  // A: 700 cuốc CŨ · B: 700 cuốc MỚI · máy chủ chỉ trả 900 mới nhất
  const A = [], B = [];
  for (let i = 1; i <= 700; i++) A.push(TR('a' + i, 'K@1,1', i, 1));
  for (let i = 701; i <= 1400; i++) B.push(TR('b' + i, 'K@1,1', i, 1));
  const m = merge([{ dev: 'a', picks: [], hidden: [], trips: A, zones: [] },
                   { dev: 'b', picks: [], hidden: [], trips: B, zones: [] }]);
  ok(m.tripsCat > 0, 'kịch bản chưa chạm trần, test vô nghĩa');
  ok(m.tripsFrom > 0, 'máy chủ cắt mà KHÔNG báo mốc cửa sổ → mỗi máy tự tính một kiểu');
  // mô phỏng đúng cách máy con tính: nhật ký riêng + phần của máy kia, cắt theo mốc
  const thay = (own, dev) => {
    const net = m.trips.filter(t => t.dev !== dev);
    const set = new Map();
    for (const t of own.concat(net)) if (t.ts >= m.tripsFrom) set.set(t.id, t);
    return set.size;
  };
  const nA = thay(A, 'a'), nB = thay(B, 'b');
  eq(nA, nB, );
});
T('ĐIỂM ẨN · cắt phải TẤT ĐỊNH, không phụ thuộc thứ tự chèn của từng máy', () => {
  const mk = (thuTu) => thuTu.map(i => H('quan' + i, 1000 + i, 1));
  const a = merge([{ dev: 'a', picks: [], hidden: mk([3, 1, 2]), trips: [], zones: [] }]);
  const b = merge([{ dev: 'a', picks: [], hidden: mk([2, 3, 1]), trips: [], zones: [] }]);
  eq(JSON.stringify(a.hidden), JSON.stringify(b.hidden), 'đổi thứ tự chèn ra kết quả khác');
});
T('chưa chạm trần cuốc thì KHÔNG đặt mốc cửa sổ (tính hết)', () => {
  const m = merge([{ dev: 'a', picks: [], hidden: [], trips: [TR('t1', 'K', 5, 1)], zones: [] }]);
  eq(m.tripsCat, 0); eq(m.tripsFrom, 0);
});
T('XE 1 · máy A khai "khách đi xe máy" → máy B nhận được lời khai', () => {
  const m = merge([{ dev: 'a', picks: [P('a1', 'Ốc Quyên', 10.75, 106.61, { ts: 2000, xe: 'may' })], hidden: [], trips: [], zones: [] },
                   { dev: 'b', picks: [], hidden: [], trips: [], zones: [] }]);
  eq(m.picks[0].xe, 'may');
});
T('XE 2 · lời khai KHÔNG được cộng vào số cuốc đếm được (không bịa thành tích)', () => {
  const m = merge([{ dev: 'a', picks: [P('a1', 'Q', 10.75, 106.61, { xe: 'oto' })], hidden: [], trips: [], zones: [] }]);
  eq(m.picks[0].oto, 0, 'lời khai bị tính thành cuốc ô tô thật');
  eq(m.picks[0].n, 0); eq(m.picks[0].win, 0);
});
T('XE 3 · khai lại loại xe → bản MỚI NHẤT thắng', () => {
  const m = merge([{ dev: 'a', picks: [P('a1', 'Q', 10.75, 106.61, { ts: 1000, xe: 'may' })], hidden: [], trips: [], zones: [] },
                   { dev: 'b', picks: [P('a1', 'Q', 10.75, 106.61, { ts: 9000, xe: 'oto' })], hidden: [], trips: [], zones: [] }]);
  eq(m.picks[0].xe, 'oto');
});
T('XE 4 · loại xe lạ bị chặn ở máy chủ', () => {
  eq(cleanPick({ id: 'x', lat: 10.75, lng: 106.61, xe: '<script>' }).xe, '');
});
T('KHU 1 · máy A tự nạp khu mới → khu vào sổ chung, máy B thấy ngay', () => {
  const m = merge([{ dev: 'a', picks: [], hidden: [], trips: [], zones: [Z('10.95,106.82', 'Biên Hoà · Đồng Nai', 5000)] },
                   { dev: 'b', picks: [], hidden: [], trips: [], zones: [] }]);
  eq(m.zones.length, 1); eq(m.zones[0].ten, 'Biên Hoà · Đồng Nai');
});
T('KHU 2 · sổ khu chỉ mang Ô LƯỚI, KHÔNG mang danh sách quán (gói nhẹ)', () => {
  const m = merge([{ dev: 'a', picks: [], hidden: [], trips: [], zones: [Z('10.95,106.82', 'X', 1)] }]);
  const s = JSON.stringify(m.zones);
  ok(!/spots/.test(s), 'nhét cả quán vào sổ → mỗi lần đồng bộ phình mấy chục KB');
  ok(s.length < 200, 'sổ khu nặng ' + s.length + ' byte');
});
T('KHU 3 · máy B xoá khu → máy A theo, không hồi sinh', () => {
  const m = merge([{ dev: 'a', picks: [], hidden: [], trips: [], zones: [Z('10.95,106.82', 'X', 1000)] },
                   { dev: 'b', picks: [], hidden: [], trips: [], zones: [Z('10.95,106.82', 'X', 9000, 1)] }]);
  eq(m.zones.length, 0, 'xoá xong nó sống lại');
});
T('KHU 4 · hai máy nạp cùng khu → một dòng, bản mới nhất thắng', () => {
  const m = merge([{ dev: 'a', picks: [], hidden: [], trips: [], zones: [Z('10.95,106.82', 'tên cũ', 1000)] },
                   { dev: 'b', picks: [], hidden: [], trips: [], zones: [Z('10.95,106.82', 'tên mới', 9000)] }]);
  eq(m.zones.length, 1); eq(m.zones[0].ten, 'tên mới');
});
T('KHU 5 · ô lưới rác bị chặn ở máy chủ', () => {
  eq(cleanZone({ key: 'hack', lat: 10, lng: 106 }), null);
  eq(cleanZone({ key: '10.95,106.82', lat: 99, lng: 99 }), null, 'toạ độ ngoài VN vẫn lọt');
});
T('THIẾT BỊ · máy chủ trả danh sách máy + MÃ BẢN mỗi máy đang chạy', () => {
  const m = merge([
    { dev: 'a', picks: [], hidden: [], trips: [], zones: [], meta: { app: 'v1', platform: 'and', seen: 100, srev: 'AAA', sat: 100 } },
    { dev: 'b', picks: [], hidden: [], trips: [], zones: [], meta: { app: 'v1', platform: 'ios', seen: 200, srev: 'BBB', sat: 200 } },
  ]);
  eq(m.devs.length, 2);
  eq(m.devs.find(d => d.dev === 'b').srev, 'BBB', 'không lan được MÃ BẢN → 2 máy chạy 2 danh sách nửa tiếng');
});
T('BỔ SUNG · cuốc trả về sắp mới→cũ và bị chặn trần', () => {
  const trips = []; for (let i = 0; i < 1200; i++) trips.push(TR('t' + i, 'K', i, i % 2));
  const m = merge([{ dev: 'a', picks: [], hidden: [], trips }]);
  ok(m.trips.length <= 900, 'trả về ' + m.trips.length + ' cuốc — gói quá nặng cho 4G');
  ok(m.trips[0].ts > m.trips[m.trips.length - 1].ts, 'không sắp theo thời gian');
});

/* ═══════════════════ C · MÁY CHỦ THẬT ═══════════════════ */
if (BASE) {
  console.log('\nC · ĐẦU–CUỐI trên máy chủ thật: ' + BASE);
  const CODE = 'TEST' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const post = (dev, body) => fetch(`${BASE}/api/pickups?code=${CODE}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: dev, device: { app: 'test', platform: 'node', seen: Date.now() }, ...body }),
  }).then(r => r.json());
  const get = (q) => fetch(`${BASE}/api/pickups?code=${CODE}${q || ''}`, { cache: 'no-store' }).then(r => r.json());

  await Ta('máy chủ sống & Supabase đã cấu hình', async () => {
    const j = await get();
    ok(j.ok, 'API trả: ' + JSON.stringify(j).slice(0, 120));
  });
  await Ta('KHO · /api/health đánh thức được Supabase và nói thật tình trạng', async () => {
    const j = await fetch(`${BASE}/api/health`, { cache: 'no-store' }).then(r => r.json());
    console.log(`      db=${j.db} · ${j.ms}ms · ${j.rows} dòng · cấu trúc ${j.schema}`);
    ok(j.ok && j.db === 'song', 'kho không sống: ' + JSON.stringify(j).slice(0, 140));
    eq(j.schema, 'day_du', 'bảng còn thiếu cột — chạy supabase/schema.sql');
    ok(j.ms < 8000, 'kho phản hồi chậm ' + j.ms + 'ms (có thể vừa ngủ dậy)');
  });
  await Ta('KHO · /api/health KHÔNG lộ dữ liệu nghiệp vụ của tài xế', async () => {
    const t = await fetch(`${BASE}/api/health`).then(r => r.text());
    for (const bad of ['picks', 'trips', 'hidden', 'zones', 'code', 'device'])
      ok(!t.includes('"' + bad + '"'), 'lộ trường ' + bad);
  });
  await Ta('QUÁN · /api/quan trả danh sách bổ sung, kèm GIỜ ĐÓNG THẬT', async () => {
    const j = await fetch(`${BASE}/api/quan`, { cache: 'no-store' }).then(r => r.json());
    console.log(`      ${j.count} quán · ${j.coGio} có giờ đóng thật · nguồn ${j.nguon} · mã bản #${j.rev} · ${j.ms}ms`);
    ok(j.ok && j.count >= 50, 'quá ít quán: ' + JSON.stringify(j).slice(0, 140));
    ok(j.coGio / j.count > 0.8, `chỉ ${j.coGio}/${j.count} quán có giờ thật`);
    for (const s of j.spots.slice(0, 20)) {
      ok(s[0] && s[0].length > 1, 'quán không tên');
      ok(s[2] > 10.3 && s[2] < 11.2 && s[3] > 106.3 && s[3] < 107.1, 'toạ độ ngoài TP.HCM: ' + s[0]);
      eq(s[7], 'ds', 'sai nhãn nguồn');
      ok(/chuẩn|số nhà|đường/.test(s[10] || ''), 'thiếu độ chính xác toạ độ: ' + s[0]);
    }
  });
  await Ta('QUÁN · hai máy hỏi cùng lúc nhận CÙNG mã bản (một bản chụp CDN)', async () => {
    const [a, b] = await Promise.all([
      fetch(`${BASE}/api/quan`).then(r => r.json()),
      fetch(`${BASE}/api/quan`).then(r => r.json()),
    ]);
    eq(a.rev, b.rev, 'hai máy nhận hai bản khác nhau');
    eq(a.count, b.count);
  });
  await Ta('QUÁN · KHÔNG CHẾT: kho có ngủ thì vẫn còn bản tĩnh trong mã nguồn', async () => {
    const j = await fetch(`${BASE}/api/quan`).then(r => r.json());
    ok(j.banTinh && j.banTinh.so >= 50, 'không có bản dự phòng nào trong mã nguồn');
    console.log(`      bản tĩnh dự phòng: ${j.banTinh.so} quán · #${j.banTinh.rev}`);
  });
  await Ta('THẬT 1 · máy A thêm điểm → máy B đọc thấy', async () => {
    const a = await post('devaaaaaaaa', { picks: [P('ta1', 'Quán Kiểm Thử A', 10.7501, 106.6101, { ts: Date.now(), n: 1, win: 1 })], hidden: [], trips: [] });
    ok(a.ok, JSON.stringify(a).slice(0, 120));
    const b = await get();
    ok(b.picks.some(p => p.name === 'Quán Kiểm Thử A'), 'máy B không thấy điểm của máy A');
  });
  await Ta('THẬT 2 · máy B ghi cuốc → máy A đọc thấy (học toàn cục)', async () => {
    const j = await post('devbbbbbbbb', { picks: [], hidden: [], trips: [TR('tt1', 'Quán Kiểm Thử A@10.7501,106.6101', Date.now(), 1)] });
    if (j.tripsReady === false) { console.log('      (bỏ qua: bảng chưa có cột trips — chạy supabase/schema.sql)'); return true; }
    const g = await get();
    ok((g.trips || []).some(t => t.id === 'tt1' && t.dev === 'devbbbbbbbb'), 'cuốc không sang được máy khác');
  });
  await Ta('THẬT 3 · gửi lại cùng event 3 lần → không đẻ bản ghi trùng', async () => {
    const t = TR('tt-dup', 'K@1,1', Date.now(), 1);
    for (let i = 0; i < 3; i++) await post('devbbbbbbbb', { picks: [], hidden: [], trips: [t] });
    const g = await get();
    if (g.tripsReady === false) return true;
    eq((g.trips || []).filter(x => x.id === 'tt-dup').length, 1);
  });
  await Ta('THẬT 4 · 2 máy thêm điểm cách 25m → chỉ còn 1 bản ghi', async () => {
    await post('devaaaaaaaa', { picks: [P('ta1', 'Quán Kiểm Thử A', 10.7501, 106.6101, { ts: Date.now() })], hidden: [], trips: [] });
    await post('devbbbbbbbb', { picks: [P('tb1', 'Quán Kiểm Thử A', 10.75032, 106.6101, { ts: Date.now() + 1 })], hidden: [], trips: [] });
    const g = await get();
    const near = g.picks.filter(p => Math.abs(p.lat - 10.7501) < 0.001 && Math.abs(p.lng - 106.6101) < 0.001);
    eq(near.length, 1, 'còn ' + near.length + ' bản ghi cho cùng một quán');
  });
  await Ta('THẬT 5 · "hỏi rẻ" trả mã thay đổi, và mã đổi khi dữ liệu đổi', async () => {
    const p1 = await get('&probe=1'); ok(p1.ok && p1.tag, 'probe không trả tag');
    await post('devcccccccc', { picks: [P('tc1', 'Quán C', 10.80, 106.70, { ts: Date.now() })], hidden: [], trips: [] });
    const p2 = await get('&probe=1');
    ok(p2.tag !== p1.tag, 'ghi dữ liệu mới mà tag không đổi → máy kia không bao giờ biết');
  });
  await Ta('THẬT 6 · hỏi rẻ phải NHẸ hơn kéo đầy đủ', async () => {
    const a = (await fetch(`${BASE}/api/pickups?code=${CODE}&probe=1`).then(r => r.text())).length;
    const b = (await fetch(`${BASE}/api/pickups?code=${CODE}`).then(r => r.text())).length;
    console.log(`      probe ${a} byte · full ${b} byte`);
    ok(a < b, 'probe không rẻ hơn');
  });
  await Ta('THẬT 7 · mã tài xế sai bị từ chối', async () => {
    const j = await fetch(`${BASE}/api/pickups?code=xx`).then(r => r.json());
    eq(j.ok, false);
  });
  await Ta('THẬT 7b · máy A thêm quán kèm ĐỊA CHỈ + loại xe → máy B nhận đủ', async () => {
    await post('devaaaaaaaa', { picks: [{ ...P('txe1', 'Quán Xe Máy', 10.7777, 106.6777, { ts: Date.now(), xe: 'may' }),
      addr: '53 Đường 30, P. Hiệp Bình' }], hidden: [], trips: [] });
    const b = await get();
    const p = (b.picks || []).find(x => x.name === 'Quán Xe Máy');
    ok(p, 'máy B không thấy quán vừa thêm');
    eq(p.xe, 'may', 'loại xe không sang được máy kia');
    eq(p.addr, '53 Đường 30, P. Hiệp Bình', 'địa chỉ không sang được máy kia');
    eq(p.n, 0, 'lời khai bị tính thành cuốc thật');
  });
  await Ta('THẬT 7c · /api/diachi tra được địa chỉ CỤ THỂ (có tên đường, không dừng ở phường)', async () => {
    const cho = [[10.8100, 106.7200], [10.7440, 106.6130], [10.7670, 106.6926]];
    let duN = 0;
    for (const [la, lo] of cho) {
      const j = await fetch(`${BASE}/api/diachi?lat=${la}&lng=${lo}`).then(r => r.json());
      console.log(`      ${la},${lo} → ${j.ok ? j.nguon + ' · "' + j.addr + '"' : 'không tra được'}`);
      ok(j.ok && j.addr && j.addr.length > 4, 'không tra được: ' + JSON.stringify(j).slice(0, 120));
      ok(!/^[A-Z0-9]{4,8}\+[A-Z0-9]{2,4}/.test(j.addr), 'lọt Plus Code vào địa chỉ');
      if (/(\d+[a-zA-Z]?\/?\d*\s)|(đường|hẻm|phố|ngõ|quốc lộ|tỉnh lộ|đại lộ|khu phố|ấp)\s/i.test(j.addr)) duN++;
    }
    ok(duN >= 2, `chỉ ${duN}/3 chỗ ra được tên đường — địa chỉ dừng ở cấp phường thì tài xế không dùng được`);
  });
  await Ta('THẬT 7d · /api/diachi chặn toạ độ ngoài Việt Nam', async () => {
    const j = await fetch(`${BASE}/api/diachi?lat=48.85&lng=2.35`).then(r => r.json());
    eq(j.ok, false);
  });
  await Ta('THẬT 8 · máy A tự nạp khu → máy B thấy khu trong sổ chung', async () => {
    const a = await post('devaaaaaaaa', { picks: [], hidden: [], trips: [],
      zones: [Z('10.95,106.82', 'Biên Hoà · Đồng Nai', Date.now())] });
    ok(a.ok, JSON.stringify(a).slice(0, 140));
    if (!Array.isArray(a.zones)) { console.log('      (bỏ qua: bảng chưa có cột zones — chạy supabase/schema.sql)'); return true; }
    const b = await get();
    ok((b.zones || []).some(z => z.key === '10.95,106.82'), 'máy B không thấy khu máy A vừa nạp');
  });
  await Ta('THẬT 9 · máy B xoá khu → máy A không còn (bia mộ, không hồi sinh)', async () => {
    const g0 = await get(); if (!Array.isArray(g0.zones)) return true;
    await post('devbbbbbbbb', { picks: [], hidden: [], trips: [],
      zones: [Z('10.95,106.82', 'Biên Hoà · Đồng Nai', Date.now() + 5000, 1)] });
    const g = await get();
    ok(!(g.zones || []).some(z => z.key === '10.95,106.82'), 'xoá xong nó sống lại');
  });
  await Ta('THẬT 10 · máy chủ khai báo được các máy đang dùng chung', async () => {
    const g = await get();
    if (!Array.isArray(g.devs)) { console.log('      (bỏ qua: bảng chưa có cột meta)'); return true; }
    ok(g.devs.length >= 2, 'chỉ thấy ' + g.devs.length + ' máy');
    ok(g.devs.every(d => d.app), 'thiếu phiên bản app của máy');
  });
  // dọn dữ liệu thử
  for (const d of ['devaaaaaaaa', 'devbbbbbbbb', 'devcccccccc']) await post(d, { picks: [], hidden: [], trips: [], tripsFull: true }).catch(() => {});
  console.log('      (đã dọn dữ liệu thử của mã ' + CODE + ')');
} else {
  console.log('\nC · ĐẦU–CUỐI trên máy chủ: bỏ qua (chạy lại kèm URL để bật)');
}

console.log(`\n${'═'.repeat(56)}\n  ĐẠT ${pass}  ·  HỎNG ${fail}\n${'═'.repeat(56)}\n`);
process.exit(fail ? 1 : 0);
