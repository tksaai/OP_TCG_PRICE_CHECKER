const CACHE_PREFIX = 'op-tcg-price-checker';
const APP_VERSION = '2.1.0';
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${APP_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-${APP_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './search-utils.js',
  './pwa-update.js',
  './scripts/lib/card-identity.mjs',
  './scripts/lib/op-tcg-db-collection.mjs',
  './data/db-price-aliases.json',
  './manifest.webmanifest',
  './icons/app-icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request) {
  const url = new URL(request.url);
  const cacheName = url.pathname.includes('/data/') ? RUNTIME_CACHE : SHELL_CACHE;
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html', { ignoreSearch: true });
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(networkFirst(request));
});
