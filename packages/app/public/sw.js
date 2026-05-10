// SPDX-License-Identifier: AGPL-3.0-only
// Roller Coaster Designer service worker.
//
// Strategy: stale-while-revalidate for everything in the same origin.
// On install we precache the absolute minimum app-shell so the page can
// render offline; once the SW is in control, every successful GET is
// cached and served from cache on repeat visits, with a background
// fetch updating the cache.
//
// Bumping CACHE_VERSION purges the previous cache on activate. The
// manifest URL is stable ("./manifest.webmanifest") and the index.html
// is stable; everything else (hashed JS / CSS bundles) gets cached on
// first fetch.

const CACHE_VERSION = 'rcd-shell-v1';
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin requests. Cross-origin (CDN, analytics that
  // don't exist in this app, etc.) bypass the cache.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        // Stale-while-revalidate: serve cache, refresh in background.
        event.waitUntil(networkPromise);
        return cached;
      }
      const network = await networkPromise;
      if (network) return network;
      // Offline + uncached: fall back to the cached shell so the SPA
      // can boot and show its empty state.
      const fallback = await cache.match('./index.html');
      return (
        fallback ?? new Response('Offline', { status: 503, statusText: 'Offline' })
      );
    })(),
  );
});
