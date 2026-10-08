// Keeps the app's own files on the phone so it opens without internet.
// Always tries the network first, so updates show up straight away.
// Never touches /api/ (YouTube titles) or Supabase (her recipes and sign-in):
// those must always be fresh, and the app keeps its own copy of the list.

const CACHE = 'recipes-v6';
// The database library, pinned to the same version as in index.html. A pinned
// version never changes, so it's served from the cache first.
const LIBRARY = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
const FILES = ['./', 'index.html', 'styles.css', 'config.js', 'app.js', 'links.js', 'welcome.js', 'manifest.webmanifest', 'icons/icon-192.png', LIBRARY];

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
  if (e.request.method !== 'GET') return;

  if (url.href === LIBRARY) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    return;
  }

  // Everything else from another site (Supabase, thumbnails, fonts) and the
  // app's own /api/ is left to the browser as normal.
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

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
