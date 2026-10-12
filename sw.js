// Service worker: cho app mở được ngoài mạng và tự cập nhật khi có bản mới
const VERSION = 'aurora-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'astro.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Giao diện app: lấy bản mới khi có mạng, dùng bản đã lưu khi mất mạng
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
    return;
  }
  // Bản đồ bờ biển: lưu lại, không cần tải lại
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    })));
  }
  // Dữ liệu NOAA / Open-Meteo: luôn lấy trực tiếp (app tự lưu bản gần nhất)
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
