const CACHE = 'breach-protocol-v7';
const ASSETS = [
  './', 'index.html', 'manifest.json',
  'lib/three.module.js',
  'src/main.js', 'src/input.js', 'src/player.js', 'src/weapons.js', 'src/enemies.js',
  'src/civilians.js', 'src/breach.js', 'src/hud.js', 'src/audio.js', 'src/physics.js',
  'src/levelgen.js', 'src/difficulty.js', 'src/save.js', 'src/levels/index.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
