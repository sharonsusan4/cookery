// Keeps the app's own files on the phone so it opens without internet.
// Always tries the network first, so updates show up straight away.
// Requests to the sheet and to thumbnails are left alone.

const CACHE = 'recipes-v2';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'links.js', 'welcome.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('/api')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        if (res.ok && !url.search) caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./')))
  );
});
