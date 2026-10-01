'use strict';

// Only public, static site files enter this cache. Device details stay in the
// page's local storage; config.json uses the page's sanitized last-good copy.
// Bump RELEASE when changing this list. Successful network responses always win.
// A ?v=<digits> request is the stay script the page asked for. It is cached
// under that exact URL. Any other query, including a guest update, is not stored.
const RELEASE = '2026-10-01-2';
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
const VERSIONED = ['assets/apply-stay.js?v=10'];

function siteCachePlan(requestHref, scope) {
  const url = new URL(requestHref);
  const canonical = new URL(url.href);
  canonical.search = '';
  canonical.hash = '';
  if (canonical.href === scope) canonical.pathname += 'index.html';
  const listed = FILES.some(file => new URL(file, scope).href === canonical.href);
  const keys = [];
  url.searchParams.forEach((value, key) => { keys.push(key); });
  const version = url.searchParams.get('v') || '';
  const versioned = listed && keys.length === 1 && keys[0] === 'v' && /^\d+$/.test(version);
  const exact = new URL(url.href);
  exact.hash = '';
  return {
    listed: listed,
    versioned: versioned,
    canonical: canonical.href,
    exact: exact.href,
    store: !listed || (url.search && !versioned) ? null : (versioned ? exact.href : canonical.href),
    offline: versioned ? exact.href : canonical.href
  };
}

if (typeof self !== 'undefined' && self.addEventListener) {
  const PREFIX = 'ssh-shell:' + self.registration.scope + ':';
  const CACHE = PREFIX + RELEASE;
  const URLS = new Set(FILES.map(file => new URL(file, self.registration.scope).href));
  self.addEventListener('install', event => {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([...URLS].map(url => new Request(url, {cache:'reload'})));
      await cache.addAll(VERSIONED.map(file => new Request(new URL(file, self.registration.scope).href, {cache:'reload'})));
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
    const plan = siteCachePlan(event.request.url, self.registration.scope);
    if (!plan.listed) return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(event.request, {signal:controller.signal, cache:'no-store'});
        if (!response.ok) throw new Error('site response ' + response.status);
        if (plan.store) await cache.put(plan.store, response.clone());
        return response;
      } catch (error) {
        const saved = await cache.match(plan.offline);
        if (saved) return saved;
        throw error;
      } finally { clearTimeout(timer); }
    })());
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RELEASE: RELEASE, FILES: FILES, VERSIONED: VERSIONED, siteCachePlan: siteCachePlan };
}
