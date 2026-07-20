// Service Worker — nhận Web Push và hiển thị thông báo trên điện thoại (kể cả
// khi app đã đóng). Chỉ xử lý thông báo; không cache nội dung để luôn mới.
const ICON = 'icon.svg';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || '🎯 Lotto Lab';
  const options = {
    body: data.body || 'Có kết quả dò số mới.',
    icon: ICON, badge: ICON, tag: data.tag || 'lotto', renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cls) => {
      for (const c of cls) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
