// Arnav Flight Radar service worker.
//  • App shell (HTML) is network-first, falling back to the cached copy offline.
//  • Hashed build assets are cache-first (their URLs change on every deploy).
//  • Airport data and brand files are stale-while-revalidate.
//  • /api/* (live data) is NEVER cached: stale aircraft must not look live.
//  • Third-party requests (map tiles, photos, radar) are never intercepted or stored.

const SHELL = 'arnav-shell-v1';
const ASSETS = 'arnav-assets-v1';
const DATA = 'arnav-data-v1';
const PRECACHE = ['/', '/manifest.webmanifest', '/brand/favicon.svg', '/brand/icon-192.png', '/brand/arnav-mark-animated.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL, ASSETS, DATA];
      for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put('/', res.clone());
    return res;
  } catch {
    return (await cache.match('/')) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    void trim(ASSETS, 120);
  }
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone()).then(() => trim(DATA, 400));
      return res;
    })
    .catch(() => hit ?? Response.error());
  return hit ?? refresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.pathname.startsWith('/data/') || url.pathname.startsWith('/brand/')) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
