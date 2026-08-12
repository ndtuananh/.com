/* RoadAI service worker — cache vỏ app để mở nhanh & chạy offline cơ bản.
   Tile bản đồ, OSRM, Nominatim luôn lấy mạng (không cache) để dữ liệu mới.

   ⚠️ SỬA LỖI 2 MÁY LỆCH NHAU (máy A 289 quán, máy B 652 quán):
   Bản cũ cache-first cho CẢ code (js/spots.js, js/positioning.js…). Máy nào cài trước thì
   giữ luôn code cũ + danh sách quán cũ, không bao giờ nhận bản mới → 2 máy khác dữ liệu.
   Bản này: CODE (html/js/css) luôn lấy MẠNG TRƯỚC, chỉ dùng cache khi mất sóng.
   → Mở app có mạng là 2 máy luôn chạy CÙNG một bản. */
const CACHE = 'roadai-v52';
const SHELL = [
  './', './index.html', './kiem-cuoc.html',
  './css/style.css', './css/positioning.css',
  './js/app.js', './js/data.js', './js/config.js',
  './js/positioning.js', './js/radar-sync.js', './js/radar-ui.js',
  './js/spots.js', './js/butl-partners.js', './js/learned-spots.js',
  './manifest.webmanifest', './radar.webmanifest', './icon.svg'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// app bấm "Đồng bộ lại 2 máy" → xoá sạch cache rồi nạp bản mới
self.addEventListener('message', e => {
  const t = e.data && e.data.type;
  if (t === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (t === 'PURGE') e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).then(() => {
    if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true });
  }));
});
// bấm vào thông báo → mở/focus Driver Radar (mở app luôn thay vì tab mới)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  // bấm nút 🧭 Chỉ đường -> mở thẳng Google Maps dẫn tới điểm nóng
  if (e.action === 'nav' && d.gmap) { e.waitUntil(self.clients.openWindow(d.gmap)); return; }
  const url = d.url || './kiem-cuoc';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.includes('kiem-cuoc') && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (_) { return; }
  // mạng-ưu-tiên tuyệt đối cho map/routing/geocoding/API — không đụng cache
  if (/tile|osrm|nominatim|basemaps|unpkg|vietmap|vietqr|open-meteo|\/api\//.test(url.host + url.pathname)) return;
  if (url.origin !== self.location.origin) return;

  // CODE của app (trang, js, css): MẠNG TRƯỚC — có mạng là luôn chạy bản mới nhất,
  // mất mạng mới rơi về cache. Đây chính là chỗ trước đây làm 2 máy chạy 2 bản khác nhau.
  const isCode = req.mode === 'navigate' || url.pathname === '/' ||
    /\.(?:html|js|css|webmanifest)$/.test(url.pathname) || /\/(?:kiem-cuoc|admin|index)$/.test(url.pathname);
  if (isCode) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match('./kiem-cuoc.html')))
    );
    return;
  }
  // ảnh/icon tĩnh: cache-first cho nhanh
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => hit))
  );
});
