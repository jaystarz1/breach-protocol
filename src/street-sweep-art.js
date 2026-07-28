// Authored visual layer for mission 02. Gameplay/collision stays on the cheap merged blockout;
// this high-tier layer adds real material separation, edge catches, grime and contact cues.
import * as THREE from 'three';
import { quality } from './quality.js';
import { rng } from './world.js';

const ROOT = './assets/street-sweep/';
let kit = null;

function texture(name, rx, ry, data = false) {
  const t = new THREE.TextureLoader().load(`${ROOT}${name}.jpg`);
  t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  return t;
}

function contactShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 61);
  g.addColorStop(0, 'rgba(0,0,0,.9)');
  g.addColorStop(0.52, 'rgba(0,0,0,.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function wornPaintTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const R = rng(44027);
  x.fillStyle = '#d2cfb7';
  x.fillRect(0, 0, 256, 256);
  // Alpha damage, not grey dots painted onto the stripe. The asphalt underneath must show
  // through the missing paint for a crosswalk to read as worn rather than merely dirty.
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 180; i++) {
    x.globalAlpha = 0.18 + R() * 0.65;
    x.save();
    x.translate(R() * 256, R() * 256);
    x.rotate(R() * Math.PI);
    x.fillRect(-2 - R() * 8, -0.7 - R() * 2.4, 4 + R() * 18, 1.2 + R() * 4.5);
    x.restore();
  }
  for (let i = 0; i < 28; i++) {
    x.globalAlpha = 0.3 + R() * 0.45;
    x.beginPath();
    x.arc(R() * 256, R() * 256, 2 + R() * 8, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  const out = new THREE.CanvasTexture(c);
  out.colorSpace = THREE.SRGBColorSpace;
  out.wrapS = out.wrapT = THREE.RepeatWrapping;
  out.anisotropy = 8;
  return out;
}

function roadDamageTexture() {
  const out = new THREE.TextureLoader().load(`${ROOT}road-damage-atlas.webp`);
  out.colorSpace = THREE.SRGBColorSpace;
  out.wrapS = out.wrapT = THREE.ClampToEdgeWrapping;
  out.anisotropy = 8;
  return out;
}

function materials() {
  if (kit) return kit;
  const mat = (name, rx, ry, roughness, bumpScale, color = 0xffffff) =>
    new THREE.MeshStandardMaterial({
      color,
      map: texture(name, rx, ry),
      bumpMap: texture(`${name}-height`, rx, ry, true),
      bumpScale,
      roughness,
      metalness: 0,
    });
  kit = {
    asphalt: mat('asphalt', 8, 18, 0.9, 0.045, 0x9ca3aa),
    sidewalk: mat('sidewalk', 2, 24, 0.86, 0.025, 0xb8bdc0),
    brick: mat('brick', 22, 3, 0.82, 0.055, 0xb6aaa2),
    plaster: mat('plaster', 17, 2.4, 0.88, 0.04, 0x9fa9b2),
    curb: mat('sidewalk', 1, 28, 0.9, 0.022, 0x999fa3),
    roadPaint: new THREE.MeshStandardMaterial({
      map: wornPaintTexture(), transparent: true, alphaTest: 0.16,
      roughness: 0.82, metalness: 0, depthWrite: false,
    }),
    roadDamage: new THREE.MeshStandardMaterial({
      color: 0x8a847c, map: roadDamageTexture(), transparent: true, alphaTest: 0.035,
      roughness: 0.96, metalness: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0x3d454b, roughness: 0.72, metalness: 0.05 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x70767a, roughness: 0.9 }),
    damp: new THREE.MeshStandardMaterial({
      color: 0x242a2e, transparent: true, opacity: 0.42,
      roughness: 0.98, depthWrite: false,
    }),
    wet: new THREE.MeshPhysicalMaterial({
      color: 0x101820, roughness: 0.18, metalness: 0.05,
      transparent: true, opacity: 0.48, envMapIntensity: 1.7,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }),
    shadow: new THREE.MeshBasicMaterial({
      map: contactShadow(), transparent: true, opacity: 0.48,
      depthWrite: false, blending: THREE.MultiplyBlending,
    }),
  };
  // A separate tint with the same uploaded plaster maps gives the shop interiors less bounce
  // without allocating another base/height texture pair.
  kit.shopInterior = kit.plaster.clone();
  kit.shopInterior.color.setHex(0x4d5150);
  kit.shopInterior.roughness = 0.96;
  kit.storefrontMetal = new THREE.MeshStandardMaterial({
    color: 0x33383a, roughness: 0.68, metalness: 0.48,
  });
  return kit;
}

function groundBatch(scene, name, items, material) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const angle = item.rot || 0;
    const right = [Math.cos(angle), 0, -Math.sin(angle)];
    const forward = [-Math.sin(angle), 0, -Math.cos(angle)];
    const hw = item.w / 2, hd = item.d / 2;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    for (const [side, ahead] of corners) {
      positions.push(
        item.x + right[0] * side + forward[0] * ahead,
        item.y,
        item.z + right[2] * side + forward[2] * ahead,
      );
      normals.push(0, 1, 0);
    }
    const tile = item.tile ?? null;
    const col = tile == null ? 0 : tile % 4;
    const row = tile == null ? 0 : Math.floor(tile / 4);
    const u0 = tile == null ? 0 : col / 4;
    const u1 = tile == null ? 1 : (col + 1) / 4;
    const v0 = tile == null ? 0 : 1 - (row + 1) / 4;
    const v1 = tile == null ? 1 : 1 - row / 4;
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    const base = i * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const out = new THREE.Mesh(geometry, material);
  out.name = name;
  out.receiveShadow = quality.shadows;
  out.userData.itemCount = items.length;
  scene.add(out);
  return out;
}

function wallBatch(scene, name, items, material, sourceRepeat = [1, 1]) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const nx = item.nx, nz = item.nz;
    const right = [nz, 0, -nx];
    const hw = item.w / 2, hh = item.h / 2;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    for (const [side, up] of corners) {
      positions.push(item.x + right[0] * side, item.y + up, item.z + right[2] * side);
      normals.push(nx, 0, nz);
    }
    const targetU = item.repeatU ?? Math.max(1, item.w / 2.4);
    const targetV = item.repeatV ?? Math.max(1, item.h / 2.1);
    const u1 = targetU / sourceRepeat[0], v1 = targetV / sourceRepeat[1];
    uvs.push(0, 0, u1, 0, u1, v1, 0, v1);
    const base = i * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const out = new THREE.Mesh(geometry, material);
  out.name = name;
  out.castShadow = out.receiveShadow = quality.shadows;
  out.userData.itemCount = items.length;
  scene.add(out);
  return out;
}

function instanceBatch(scene, name, geometry, material, items, shadows = true) {
  const out = new THREE.InstancedMesh(geometry, material, items.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    dummy.position.set(item.x, item.y, item.z);
    dummy.rotation.set(item.rx || 0, item.ry || 0, item.rz || 0);
    dummy.scale.set(item.w || 1, item.h || 1, item.d || 1);
    dummy.updateMatrix();
    out.setMatrixAt(i, dummy.matrix);
  }
  out.instanceMatrix.needsUpdate = true;
  out.name = name;
  out.userData.instanceCount = items.length;
  out.castShadow = shadows && quality.shadows;
  out.receiveShadow = quality.shadows;
  scene.add(out);
  return out;
}

function storefronts(scene) {
  const m = materials();
  const shops = [
    { x: 11, z: 20, w: 9, d: 7, face: 'w', finish: 'plaster', damage: 0 },
    { x: 11, z: -5, w: 9, d: 7, face: 'w', finish: 'plaster', damage: 1 },
    { x: -11, z: -25, w: 9, d: 7, face: 'e', finish: 'brick', damage: 2 },
  ];
  const plaster = [], brick = [], interiors = [];
  const frames = [], shutters = [], thresholds = [], bollards = [];
  let slatCount = 0;

  const worldPart = (shop, cx, cz, yaw, lx, y, lz, w, h, d, extra = {}) => {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    return {
      x: cx + cos * lx + sin * lz,
      y,
      z: cz - sin * lx + cos * lz,
      w, h, d, ry: yaw, ...extra,
    };
  };

  for (const shop of shops) {
    const west = shop.face === 'w';
    const nx = west ? -1 : 1;
    const faceX = shop.x + nx * (shop.w / 2 + 0.161);
    const rearX = shop.x - nx * (shop.w / 2 + 0.161);
    const rearInsideX = shop.x - nx * (shop.w / 2 - 0.161);
    const yaw = west ? -Math.PI / 2 : Math.PI / 2;
    const finish = shop.finish === 'brick' ? brick : plaster;

    // Photographic exterior skins over the two blank side walls, the rear return, the solid
    // one-metre storefront piers and the lintel. The collision boxes remain authoritative.
    for (const side of [-1, 1]) {
      finish.push({
        x: shop.x, y: 1.5, z: shop.z + side * (shop.d / 2 + 0.161),
        w: shop.w, h: 3, nx: 0, nz: side,
      });
      finish.push({
        x: faceX, y: 1.5, z: shop.z + side * 3,
        w: 1, h: 3, nx, nz: 0, repeatU: 1, repeatV: 1.4,
      });
    }
    finish.push({ x: rearX, y: 1.5, z: shop.z, w: shop.d, h: 3, nx: -nx, nz: 0 });
    finish.push({
      x: faceX, y: 2.8, z: shop.z, w: shop.d - 2, h: 0.4,
      nx, nz: 0, repeatU: 2, repeatV: 1,
    });
    // The real rear collision wall is visible through the five-metre opening. A darker copy
    // of the same plaster maps creates convincing room depth without a black cardboard plane.
    interiors.push({
      x: rearInsideX + nx * 0.012, y: 1.5, z: shop.z,
      w: shop.d - 0.5, h: 2.9, nx, nz: 0,
    });

    const cx = faceX, cz = shop.z;
    for (const lx of [-2.43, 2.43]) {
      frames.push(worldPart(shop, cx, cz, yaw, lx, 1.34, 0.055, 0.13, 2.68, 0.16));
    }
    frames.push(worldPart(shop, cx, cz, yaw, 0, 2.66, 0.055, 4.98, 0.13, 0.16));
    thresholds.push(worldPart(shop, cx, cz, yaw, 0, 0.055, 0.11, 4.82, 0.08, 0.34));
    shutters.push(worldPart(shop, cx, cz, yaw, 0, 2.82, 0.02, 5.18, 0.28, 0.3));
    for (let i = 0; i < 7; i++) {
      const bent = shop.damage === 1 && i > 4;
      shutters.push(worldPart(
        shop, cx, cz, yaw,
        bent ? 0.1 + (i - 4) * 0.12 : 0,
        2.58 - i * 0.085,
        0.105,
        4.76 - (bent ? (i - 4) * 0.22 : 0),
        0.055,
        0.045,
        { rz: bent ? -0.025 * (i - 4) : 0 },
      ));
      slatCount++;
    }
    for (const lx of [-1.72, 1.72]) {
      const part = worldPart(shop, cx, cz, yaw, lx, 0.42, 0.72, 1, 1, 1);
      bollards.push({ ...part, w: 1, h: 1, d: 1 });
    }
  }

  wallBatch(scene, 'storefront-plaster-shells', plaster, m.plaster, [17, 2.4]);
  wallBatch(scene, 'storefront-brick-shells', brick, m.brick, [22, 3]);
  wallBatch(scene, 'storefront-interior-backs', interiors, m.shopInterior, [17, 2.4]);
  instanceBatch(scene, 'storefront-frames', new THREE.BoxGeometry(1, 1, 1),
    m.storefrontMetal, frames);
  instanceBatch(scene, 'storefront-shutters', new THREE.BoxGeometry(1, 1, 1),
    m.storefrontMetal, shutters);
  instanceBatch(scene, 'storefront-thresholds', new THREE.BoxGeometry(1, 1, 1),
    m.stone, thresholds, false);
  instanceBatch(scene, 'storefront-bollards', new THREE.CylinderGeometry(0.075, 0.095, 0.84, 10),
    m.storefrontMetal, bollards);
  scene.userData.storefrontStats = {
    shops: shops.length,
    shellPanels: plaster.length + brick.length,
    interiorBacks: interiors.length,
    frames: frames.length,
    shutters: shutters.length,
    slats: slatCount,
    bollards: bollards.length,
  };
}

function plane(scene, w, h, material, x, y, z, rx = -Math.PI / 2, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.receiveShadow = quality.shadows;
  scene.add(mesh);
  return mesh;
}

function box(scene, w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = quality.shadows;
  scene.add(mesh);
  return mesh;
}

function facade(scene, x, normal, material, seedOffset, batches) {
  // wall() is a 30cm-thick box, so its street face is already 15cm proud of the authored
  // centreline. Clear that face by 12mm or the finish plane sits invisibly inside the wall.
  plane(scene, 110, 8.9, material, x + normal * 0.162, 4.5, 0, 0,
    normal > 0 ? Math.PI / 2 : -Math.PI / 2);
  // Raised floor bands and pilasters break the 110m wall into human-sized bays and catch
  // grazing light. Texture detail cannot repair an unbroken box silhouette by itself.
  for (const y of [3.0, 6.0, 8.75]) {
    batches.stone.push({ x: x + normal * 0.20, y, z: 0, w: 0.22, h: 0.14, d: 110 });
  }
  for (let z = -52 + seedOffset; z < 53; z += 12.8) {
    batches.trim.push({ x: x + normal * 0.21, y: 4.45, z, w: 0.24, h: 8.8, d: 0.28 });
  }
  plane(scene, 110, 0.75, materials().damp, x + normal * 0.166, 0.5, 0, 0,
    normal > 0 ? Math.PI / 2 : -Math.PI / 2);
}

function roadMarkings(scene) {
  const markings = [];
  for (let z = -47; z < 52; z += 5) {
    markings.push({ x: 0, y: 0.026, z, w: 0.24, d: 2.35 });
  }
  for (const z of [-42, 28]) {
    for (let x = -7; x <= 7; x += 2) {
      markings.push({ x, y: 0.027, z, w: 1.05, d: 4.2 });
    }
  }
  groundBatch(scene, 'road-markings-batch', markings, materials().roadPaint);
  const covers = [[4.2, 17], [-4.4, -5], [3.1, -43]].map(([x, z]) => ({
    x, y: 0.02, z, w: 1, h: 1, d: 1,
  }));
  instanceBatch(scene, 'utility-covers', new THREE.CylinderGeometry(0.56, 0.56, 0.025, 24),
    materials().trim, covers, false);
}

function roadDamage(scene) {
  const R = rng(202607281);
  const tiles = [0, 2, 3, 6, 7, 8, 10, 11, 14, 15];
  const items = [
    { x: -3.5, y: 0.021, z: 14, w: 4.6, d: 6.8, rot: 0.08, tile: 1 },
    { x: 4.7, y: 0.021, z: -12, w: 3.5, d: 5.6, rot: -0.04, tile: 9 },
    { x: -2, y: 0.021, z: -39, w: 6.4, d: 2.8, rot: 1.46, tile: 1 },
    { x: 2.8, y: 0.021, z: 36, w: 4.7, d: 4.4, rot: 0.32, tile: 0 },
    { x: -2.7, y: 0.021, z: -2, w: 4.4, d: 4.0, rot: -0.45, tile: 8 },
    { x: 3.6, y: 0.021, z: -30, w: 4.9, d: 4.2, rot: 0.68, tile: 0 },
  ];
  for (let i = 0; i < 31; i++) {
    const tile = tiles[Math.floor(R() * tiles.length)];
    const stain = [2, 6, 7, 10, 14, 15].includes(tile);
    const tyre = tile === 3 || tile === 11;
    const base = stain ? 1.45 : tyre ? 2.4 : 2.0;
    items.push({
      x: -7.0 + R() * 14.0,
      y: 0.020 + (i % 3) * 0.0006,
      z: -54 + R() * 108,
      w: base * (0.75 + R() * 1.0),
      d: base * (0.72 + R() * 1.25),
      rot: R() * Math.PI * 2,
      tile,
    });
  }
  const mesh = groundBatch(scene, 'road-damage-atlas', items, materials().roadDamage);
  mesh.userData.signature = items.reduce(
    (sum, item, i) => (sum + Math.round(item.x * 31 + item.z * 17) + item.tile * (i + 3)) >>> 0,
    0,
  );
}

function wetAndContact(scene) {
  const wet = [];
  for (const [x, z, sx, sz, r] of [
    [-6.7, 17, 2.6, 7.5, .18], [6.4, -10, 1.8, 5.2, -.12],
    [-7.2, -35, 2.0, 6.8, .08], [7.1, 36, 1.4, 4.5, -.2],
  ]) {
    wet.push({ x, y: 0.022, z, w: sx * 2, d: sz * 2, rot: r });
  }
  groundBatch(scene, 'wet-patches-batch', wet, materials().wet);
  const contacts = [];
  for (const [x, z, sx, sz] of [
    [-4, 25, 5.2, 2.4], [3, 5, 2.4, 5.2], [-2, -18, 5.2, 2.4],
    [5, -35, 2.4, 5.2], [-6, 33, 5.2, 2.4], [6, -28, 2.4, 5.2],
  ]) {
    contacts.push({ x, y: 0.024, z, w: sx, d: sz });
  }
  groundBatch(scene, 'contact-shadows-batch', contacts, materials().shadow);
}

function streetLights(scene) {
  // Six non-shadowing point lights are six passes, versus 36 passes with cube shadows.
  for (const [x, z] of [
    [-11.5, 46], [11.5, 25], [-11.5, 18],
    [11.5, -3], [-11.5, -10], [11.5, -31],
  ]) {
    const light = new THREE.PointLight(0xffd29a, 3.2, 15, 2);
    light.position.set(x, 5.7, z);
    scene.add(light);
  }
}

export function addStreetSweepArt(scene) {
  if (!quality.pbr) return;
  const m = materials();
  const facadeBatches = { stone: [], trim: [] };
  plane(scene, 60, 130, m.asphalt, 0, 0.006, 0);
  plane(scene, 8, 120, m.sidewalk, -12, 0.156, 0);
  plane(scene, 8, 120, m.sidewalk, 12, 0.156, 0);
  box(scene, 0.22, 0.15, 120, m.curb, -8.03, 0.075, 0);
  box(scene, 0.22, 0.15, 120, m.curb, 8.03, 0.075, 0);
  facade(scene, -16, 1, m.brick, 0, facadeBatches);
  facade(scene, 16, -1, m.plaster, 5.5, facadeBatches);
  instanceBatch(scene, 'facade-floor-bands', new THREE.BoxGeometry(1, 1, 1),
    m.stone, facadeBatches.stone);
  instanceBatch(scene, 'facade-pilasters', new THREE.BoxGeometry(1, 1, 1),
    m.trim, facadeBatches.trim);
  storefronts(scene);
  roadDamage(scene);
  roadMarkings(scene);
  wetAndContact(scene);
  streetLights(scene);
}
