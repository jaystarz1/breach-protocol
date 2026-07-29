const CACHE = 'breach-protocol-v95-seeded-mission-variants';
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
  'assets/characters/materials/fabric074-normal.webp',
  'assets/characters/materials/fabric074-roughness.webp',
  'assets/weapons/AssaultRifleWest.glb',
  'assets/weapons/NOTICE.md',
  'assets/vehicles/CarSedan.glb',
  'assets/vehicles/CarSUV.glb',
  'assets/vehicles/BrokenCar.glb',
  'assets/vehicles/kiri_sedan/kiri10.glb',
  'assets/vehicles/generic_suv/generic_suv.glb',
  'assets/vehicles/covered_car/covered_car_1k.gltf',
  'assets/vehicles/covered_car/covered_car.bin',
  'assets/vehicles/covered_car/textures/covered_car_diff_1k.jpg',
  'assets/vehicles/covered_car/textures/covered_car_nor_gl_1k.jpg',
  'assets/vehicles/covered_car/textures/covered_car_arm_1k.jpg',
  'assets/vehicles/abandoned_sedan/scene.gltf',
  'assets/vehicles/abandoned_sedan/scene.bin',
  'assets/vehicles/abandoned_sedan/license.txt',
  'assets/vehicles/abandoned_sedan/textures/Material_1_baseColor.webp',
  'assets/vehicles/abandoned_sedan/textures/Material_1_metallicRoughness.webp',
  'assets/vehicles/abandoned_sedan/textures/Material_1_normal.webp',
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
