/* Grocery Planner — service worker
 *
 * Strategy
 *   - App shell: precached on install so the first offline launch works.
 *   - Navigations: network-first, falling back to the cached shell.
 *   - Other same-origin GETs: stale-while-revalidate (fast, self-healing).
 *
 * IMPORTANT: bump VERSION whenever you deploy so phones pick up new files.
 */

const VERSION = '0.3.0';
const SHELL_CACHE = `gp-shell-${VERSION}`;
const RUNTIME_CACHE = `gp-runtime-${VERSION}`;

// Everything needed for a cold offline start. Paths are relative to the SW
// scope so the app keeps working under /<repo>/ on GitHub Pages.
const SHELL_ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/config.js',
  './js/model.js',
  './js/store.js',
  './js/ui.js',
  './js/pwa.js',
  './js/views/plan.js',
  './js/views/list.js',
  './js/views/recipes.js',
  './js/views/more.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request) {
  const runtime = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) runtime.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await runtime.match(request);
    if (cached) return cached;

    const shell = await caches.open(SHELL_CACHE);
    return (await shell.match('./index.html')) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const runtime = await caches.open(RUNTIME_CACHE);
        await runtime.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || (await network) || Response.error();
}
