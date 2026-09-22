const CACHE = 'salat-v6';
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
  './style.css',
  './admin/app-icon.png',
  './agent/agent-icon.png',
  './courier/courier-icon.png',
  './icon192.png',
  './icon512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => {
      return Promise.all(
        ASSETS.map(asset => {
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

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
