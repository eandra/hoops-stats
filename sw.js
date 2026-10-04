// Network-first for everything (app files, generated data, ESPN), falling
// back to the last cached copy so the app still opens offline.
const CACHE = 'hoops-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const old = (await caches.keys()).filter(k => k !== CACHE);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    // Pages opened under an older worker may be running stale app code
    // (v1 served the app cache-first), so reload them once.
    if (old.length) {
      for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
    }
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const espn = url.hostname.endsWith('espn.com') && url.pathname.startsWith('/apis/');
  if (!espn && url.origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    })
    .catch(() => caches.match(e.request)));
});
