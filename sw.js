const CACHE = 'nhlpool-v1';
const ASSETS = [
  '/nhlpool/',
  '/nhlpool/index.html',
  '/nhlpool/data.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', e => {
  // Always fetch data.json fresh from network, fall back to cache
  if (e.request.url.includes('data.json')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  // For everything else, cache first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
