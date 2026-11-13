// Offline support. Hashed files (engine, JS, CSS) never change, so they're cache-first forever;
// art and audio come from cache and refresh in the background; pages go to the network first so
// a deploy shows up immediately, with the cached copy as the offline fallback.
const CACHE = 'high-card-v2'; // bump when art or audio is replaced in place

self.addEventListener('activate', (e) =>
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))),
);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  const immutable = /^\/(chdb-[0-9a-f]+|assets)\//.test(url.pathname);
  const media = /^\/(art|audio|icons)\//.test(url.pathname);

  if (immutable) e.respondWith(cacheFirst(req));
  else if (media) e.respondWith(staleWhileRevalidate(req, e));
  else if (req.mode === 'navigate') e.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  // no-cache: revalidate with the server (a cheap 304 when nothing changed), never the day-old HTTP cache.
  const fresh = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  if (hit) {
    e.waitUntil(fresh.catch(() => {}));
    return hit;
  }
  return fresh;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('/', res.clone());
    return res;
  } catch {
    return (await cache.match('/')) ?? Response.error();
  }
}
