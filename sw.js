// Service worker: offline support for the Solar System app.
//
// Strategy:
//   - Heavy immutable assets (textures/models/fonts/lib/icons) — cache-first
//     with write-through: fetched once, then served locally forever.
//   - App shell + code (HTML/CSS/JS) — network-first so a deploy shows up on
//     the next reload, falling back to the cache when offline.
//
// Every CacheStorage call is fenced: if the storage backend is unavailable or
// corrupted (it can throw UnknownError on open()), the worker degrades to a
// transparent network passthrough instead of failing the request.
//
// Bump VERSION on deploys that must invalidate previously cached files.
// window.SOLAR.clearCaches() in the app console wipes everything manually.
const VERSION = 'solar-v1';
const RUNTIME = `${VERSION}-runtime`;

async function fromCache(request) {
  try {
    const cache = await caches.open(RUNTIME);
    return await cache.match(request);
  } catch {
    return undefined;
  }
}

async function putCache(request, response) {
  try {
    const cache = await caches.open(RUNTIME);
    await cache.put(request, response);
  } catch { /* storage unavailable — serve from network only */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Best-effort shell precache so offline navigation works from day one.
    try {
      const cache = await caches.open(RUNTIME);
      await cache.addAll(['index.html', 'manifest.webmanifest']);
    } catch { /* ignore */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      for (const key of await caches.keys()) {
        if (key !== RUNTIME) await caches.delete(key);
      }
    } catch { /* ignore */ }
    await self.clients.claim();
  })());
});

const ASSET_PATH = /\/(textures|models|fonts|lib|icons)\//;

async function handle(request, isAsset) {
  if (isAsset) {
    const hit = await fromCache(request);
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok) putCache(request, res.clone());
    return res;
  }
  try {
    const res = await fetch(request);
    if (res.ok) putCache(request, res.clone());
    return res;
  } catch (err) {
    const hit = await fromCache(request);
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await fromCache('index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  // Last-ditch fence: no matter what breaks inside handle(), fall back to a
  // plain network fetch rather than failing the request with ERR_FAILED.
  event.respondWith(
    handle(event.request, ASSET_PATH.test(url.pathname))
      .catch(() => fetch(event.request)),
  );
});
