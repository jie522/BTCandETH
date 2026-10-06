/* Service Worker:讓 App 可以「加到主畫面」、離線也打得開
 *
 * 策略是 network-first:每次都先問伺服器拿最新的,拿不到(沒網路)才用快取。
 * 交易所行情 API 是跨網域,一律直接走網路,不進快取。
 * 改版時把 CACHE 的日期換掉,舊快取會在啟用時自動清掉。
 */
const CACHE = 'ethgrid-20261006b';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=20261006b',
  './css/viz.css?v=20261006b',
  './js/store.js?v=20261006b',
  './js/ui.js?v=20261006b',
  './js/market.js?v=20261006b',
  './js/grid.js?v=20261006b',
  './js/viz.js?v=20261006b',
  './js/signal.js?v=20261006b',
  './js/app.js?v=20261006b',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
