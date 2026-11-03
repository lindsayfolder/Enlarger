/* Enlarger service worker.
   To publish an update: change VERSION here, in app.js (APP_VERSION) and in version.json,
   then upload the files. Installed apps find it under Settings > App updates. */
const VERSION = '1.0.2';
const SHELL = 'enlarger-shell-' + VERSION;
const RUNTIME = 'enlarger-runtime-v1';
const SHELL_FILES = [
  './', './index.html', './app.js', './encoders.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' }))))
  );
  // No skipWaiting here: the new version waits until the person taps "Install update".
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('enlarger-shell-') && k !== SHELL) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION' && event.ports[0]) event.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Always ask the server for the latest version info.
  if (url.origin === location.origin && url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

  // The app itself: served from this version's offline copy.
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      if (req.mode === 'navigate') {
        return (await cache.match('./index.html')) || fetch(req);
      }
      return (await cache.match(req, { ignoreSearch: true })) || fetch(req);
    })());
    return;
  }

  // AI libraries, AI model files and fonts: download once, then keep for offline use.
  if (/(^|\.)(jsdelivr\.net|googleapis\.com|gstatic\.com)$/.test(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })());
  }
});
