'use strict';

// Only public, static site files enter this cache. Device details stay in the
// page's local storage; config.json uses the page's sanitized last-good copy.
// Bump RELEASE when changing this list. Successful network responses always win.
const RELEASE = '2026-09-22-1';
const PREFIX = 'ssh-shell:' + self.registration.scope + ':';
const CACHE = PREFIX + RELEASE;
const FILES = [
  'index.html', 'apply.html', 'stay.html', 'update.html', 'favicon.ico',
  'assets/apply-stay.js', 'assets/favicon.svg', 'assets/qrcode.min.js',
  'assets/fonts/Themysion.ttf', 'assets/fonts/inter-latin.woff2',
  'assets/fonts/special-elite-latin.woff2',
  'assets/art/awning.png', 'assets/art/crest.png', 'assets/art/doodle-frame.png',
  'assets/art/gator.png', 'assets/art/heron-gator.png', 'assets/art/house.png',
  'assets/art/ribbon.png', 'assets/art/table.png', 'assets/art/tile-about.png',
  'assets/art/tile-food.png', 'assets/art/tile-lake.png', 'assets/art/tile-legend.png',
  'assets/art/tile-local-favorites.png', 'assets/art/tile-streaming.png',
  'assets/art/house-aerial.png', 'assets/art/tile-wifi.png', 'assets/art/walden-map.png', 'assets/art/weather-doodle.png'
];
const URLS = new Set(FILES.map(file => new URL(file, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...URLS].map(url => new Request(url, {cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const canonical = new URL(url.href);
  canonical.search = '';
  canonical.hash = '';
  if (canonical.href === self.registration.scope) canonical.pathname += 'index.html';
  if (!URLS.has(canonical.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(event.request, {signal:controller.signal, cache:'no-store'});
      if (!response.ok) throw new Error('site response ' + response.status);
      // Never persist a request/response whose URL might contain a guest update.
      if (!url.search) await cache.put(canonical.href, response.clone());
      return response;
    } catch (error) {
      const saved = await cache.match(canonical.href);
      if (saved) return saved;
      throw error;
    } finally { clearTimeout(timer); }
  })());
});
