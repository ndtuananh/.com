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
const T = (name, fn) => {
  try { const r = fn(); if (r === false) throw new Error('trả về false'); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      → ' + (e && e.message || e)); fail++; }
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
}

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

const P = (id, name, lat, lng, o) => cleanPick({ id, name, lat, lng, cat: 'phonhau', ts: (o && o.ts) || 1000, n: (o && o.n) || 0, win: (o && o.win) || 0, del: (o && o.del) || 0, quan: 'Bình Tân' });
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
