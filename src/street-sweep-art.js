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
  roadDamage(scene);
  roadMarkings(scene);
  wetAndContact(scene);
  streetLights(scene);
}
