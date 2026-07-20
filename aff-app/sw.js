// Service worker tối giản — giúp app cài được (PWA) + mở nhanh khi offline nhẹ.
// KHÔNG cache /api và Supabase để dữ liệu (số dư, link) luôn mới.
const CACHE = 'hoantien-v2';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Nhận push từ server → hiện thông báo trên điện thoại (kể cả khi app đóng)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Hoàn Tiền Shopee';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'Có cập nhật mới',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    tag: d.tag || 'notify',
    data: { url: d.url || '/' }
  }));
});
// Bấm vào thông báo → mở app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // luôn lấy mạng cho API, Supabase, ảnh QR động
  if (e.request.method !== 'GET' || /\/api\/|supabase\.co|isclix\.com|vietqr\.io|qrserver\.com/.test(url.href)) {
    return; // để trình duyệt xử lý bình thường (network)
  }
  // shell: network-first, fallback cache
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});
