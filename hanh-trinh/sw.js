// Service worker riêng cho Hành trình - Qi: mở được khi mất mạng, luôn lấy bản mới khi có mạng
const VERSION = 'hanh-trinh-v3';
const SHELL = ['./', 'index.html', 'secret.json', 'manifest.webmanifest', 'icons/qi-avatar.jpg', 'icons/apple-touch-icon.png', 'icons/icon-192.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hanh-trinh-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('version.json')) return; // luôn hỏi thẳng máy chủ
  // Luôn hỏi máy chủ bản mới nhất (tạo yêu cầu mới theo URL để Safari không bỏ qua)
  const fresh = new Request(url.href, { cache: 'no-store', credentials: 'same-origin' });
  e.respondWith(fetch(fresh).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
