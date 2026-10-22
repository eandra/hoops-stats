// Network-first for everything (app files, generated data, ESPN), falling
// back to the last cached copy so the app still opens offline.
const CACHE = 'hoops-v3';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const old = (await caches.keys()).filter(k => k !== CACHE);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    // Pages opened under an older worker may be running stale app code
    // (v1 served the app cache-first, v2 let the browser's HTTP cache serve
    // it for up to 10 min after a deploy), so reload them once.
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
  // Our own files always revalidate with the server (cheap: 304 if unchanged),
  // so a deploy shows up on the next load instead of after GitHub Pages' 10 min max-age.
  e.respondWith(fetch(e.request, espn ? undefined : { cache: 'no-cache' })
    .then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    })
    .catch(() => caches.match(e.request)));
});
