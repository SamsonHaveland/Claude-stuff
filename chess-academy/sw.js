/* Service worker: makes Chess Academy work offline once installed.
 * Strategy: precache the whole app shell; serve from cache, refresh the cache
 * in the background (stale-while-revalidate) so updates arrive on next launch.
 * Bump VERSION whenever any file changes. */
const VERSION = 'chess-academy-v2';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/vendor/chess.js', './js/board.js', './js/engine.js', './js/curriculum.js',
  './js/openings.js', './js/openings-more.js', './js/whynot.js', './js/library.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-64.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
