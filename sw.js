// Service worker：只快取 app 外殼（頁面、manifest、圖示），讓「加入主畫面」後開得起來。
// 不碰 API：翻譯走 WebSocket（generativelanguage.googleapis.com），service worker 本來就攔不到，
// 這裡也只處理同網域的 GET 請求，其他一律直接走網路、不快取。
// 頁面用「網路優先」：有網路就拿最新版（更新馬上生效），沒網路才用快取。
// 改了外殼檔案清單時，把 VERSION 加一，舊快取會被清掉。
const VERSION = 'v1';
const CACHE = 'interp-shell-' + VERSION;
const SHELL = [
  './', './index.html', './interpreter.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('interp-shell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // API 和其他網域：不處理
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && SHELL.some(p => new URL(p, self.registration.scope).pathname === url.pathname)) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./interpreter.html')))
  );
});
