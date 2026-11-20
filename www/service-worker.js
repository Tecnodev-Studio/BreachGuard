'use strict';
// Static app-shell cache only. It never caches or intercepts cross-origin
// requests, so password-range and email API traffic always goes straight to
// the network and is never stored.
const CACHE_NAME = 'breachguard-static-v4';
const PRECACHE = [
  './', './index.html', './offline.html', './styles.css', './app.js',
  './js/lib.js', './js/i18n.js', './js/render.js',
  './manifest.webmanifest', './icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'
];
const PRECACHE_URLS = new Set(PRECACHE.map((p) => new URL(p, self.location).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch third-party/API traffic

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match('./index.html')) || (await caches.match('./offline.html')))
    );
    return;
  }
  if (PRECACHE_URLS.has(url.href)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
