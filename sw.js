const CACHE = 'salat-v27';
const ASSETS = [
  './',
  './admin/index.html',
  './admin/app.js',
  './admin/manifest.json',
  './agent/index.html',
  './agent/agent.js',
  './agent/manifest.json',
  './courier/index.html',
  './courier/courier.js',
  './courier/manifest.json',
  './client.html',
  './client.js',
  './style.css',
  './admin/app-icon.png',
  './agent/agent-icon.png',
  './courier/courier-icon.png',
  './icon192.png',
  './icon512.png'
];

const CDN_ASSETS = [
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js',
  'https://telegram.org/js/telegram-web-app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => {
      const allToCache = [...ASSETS, ...CDN_ASSETS];
      return Promise.all(
        allToCache.map(asset => {
          return c.add(asset).catch(err => console.log('Cache fail for', asset, err));
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

function getNavigationFallback(urlStr) {
  const url = urlStr.toLowerCase();
  if (url.includes('/admin')) return './admin/index.html';
  if (url.includes('/agent')) return './agent/index.html';
  if (url.includes('/courier')) return './courier/index.html';
  if (url.includes('/client') || url.includes('client.html')) return './client.html';
  return './';
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url || '';
  if (!url.startsWith('http')) return;

  // Do not intercept or cache volatile streaming or Firestore/AI/Telegram API calls
  if (url.includes('firestore.googleapis.com') ||
      url.includes('generativelanguage.googleapis.com') ||
      url.includes('api.telegram.org')) {
    return;
  }

  // 1. Navigation requests (HTML pages)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then(cache => cache.put(e.request, copy));
          }
          return res;
        })
        .catch(async () => {
          const match = await caches.match(e.request, { ignoreSearch: true });
          if (match) return match;
          const fallbackPath = getNavigationFallback(url);
          return (await caches.match(fallbackPath, { ignoreSearch: true })) || (await caches.match('./'));
        })
    );
    return;
  }

  // 2. Static and CDN assets: Cache-first / Stale-While-Revalidate with runtime cache
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      const fetchPromise = fetch(e.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
          const copy = networkResponse.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, copy));
        }
        return networkResponse;
      }).catch(err => {
        if (cached) return cached;
        throw err;
      });

      return cached || fetchPromise;
    })
  );
});
