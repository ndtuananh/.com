/* RoadAI service worker — cache vỏ app để mở nhanh & chạy offline cơ bản.
   Tile bản đồ, OSRM, Nominatim luôn lấy mạng (không cache) để dữ liệu mới. */
const CACHE = 'roadai-v8';
const SHELL = [
  './', './index.html', './kiem-cuoc.html',
  './css/style.css', './css/positioning.css',
  './js/app.js', './js/data.js', './js/config.js', './js/positioning.js', './js/spots.js', './js/learned-spots.js',
  './manifest.webmanifest', './radar.webmanifest', './icon.svg'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// bấm vào thông báo → mở/focus Driver Radar (mở app luôn thay vì tab mới)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './kiem-cuoc';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.includes('kiem-cuoc') && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // mạng-ưu-tiên cho map/routing/geocoding
  if (/tile|osrm|nominatim|basemaps|unpkg|vietmap|vietqr|\/api\//.test(url.host + url.pathname)) return;
  // cache-first cho vỏ app
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});
