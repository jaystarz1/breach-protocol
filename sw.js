const CACHE = 'breach-protocol-v74-photographic-window-interiors';
const ASSETS = [
  './', 'index.html', 'manifest.json',
  'lib/three.module.js', 'lib/GLTFLoader.js', 'lib/SkeletonUtils.js', 'lib/BufferGeometryUtils.js',
  'src/main.js', 'src/input.js', 'src/player.js', 'src/weapons.js', 'src/enemies.js',
  'src/civilians.js', 'src/breach.js', 'src/hud.js', 'src/audio.js', 'src/physics.js',
  'src/levelgen.js', 'src/difficulty.js', 'src/save.js', 'src/levels/index.js', 'src/navgrid.js',
  'src/quality.js', 'src/textures.js', 'src/world.js', 'src/squad.js', 'src/street-sweep-art.js',
  'src/visual-kit.js', 'src/character-assets.js', 'src/interior-mission-art.js',
  'src/frontline-art.js',
  'src/drone.js',
  'src/campaign.js', 'src/renderer/capabilities.js', 'src/renderer/render-pipeline.js',
  'src/renderer/telemetry.js',
  'assets/street-sweep/asphalt.jpg', 'assets/street-sweep/asphalt-height.jpg',
  'assets/street-sweep/sidewalk.jpg', 'assets/street-sweep/sidewalk-height.jpg',
  'assets/street-sweep/brick.jpg', 'assets/street-sweep/brick-height.jpg',
  'assets/street-sweep/plaster.jpg', 'assets/street-sweep/plaster-height.jpg',
  'assets/street-sweep/road-damage-atlas.webp',
  'assets/materials/concrete/concrete-color.webp',
  'assets/materials/concrete/concrete-normal.webp',
  'assets/materials/concrete/concrete-roughness.webp',
  'assets/materials/NOTICE.md',
  'assets/characters/SWAT.glb',
  'assets/characters/CivilianCasual.glb',
  'assets/characters/CivilianLongSleeve.glb',
  'assets/characters/CivilianWoman.glb',
  'assets/characters/NOTICE.md',
  'assets/weapons/AssaultRifleWest.glb',
  'assets/weapons/NOTICE.md',
  'assets/vehicles/CarSedan.glb',
  'assets/vehicles/CarSUV.glb',
  'assets/vehicles/BrokenCar.glb',
  'assets/vehicles/NOTICE.md',
  'assets/windows/frontline-interiors-atlas-v2.webp',
  'assets/windows/NOTICE.md',
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
