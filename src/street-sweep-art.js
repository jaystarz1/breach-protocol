// Authored visual layer for mission 02. Gameplay/collision stays on the cheap merged blockout;
// this high-tier layer adds real material separation, edge catches, grime and contact cues.
import * as THREE from 'three';
import { quality } from './quality.js';

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
    roadPaint: new THREE.MeshStandardMaterial({ color: 0xc8c5aa, roughness: 0.78 }),
    patch: new THREE.MeshStandardMaterial({ color: 0x171b1e, roughness: 0.96 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x3d454b, roughness: 0.72, metalness: 0.05 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x70767a, roughness: 0.9 }),
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

function facade(scene, x, normal, material, seedOffset) {
  // wall() is a 30cm-thick box, so its street face is already 15cm proud of the authored
  // centreline. Clear that face by 12mm or the finish plane sits invisibly inside the wall.
  plane(scene, 110, 8.9, material, x + normal * 0.162, 4.5, 0, 0,
    normal > 0 ? Math.PI / 2 : -Math.PI / 2);
  // Raised floor bands and pilasters break the 110m wall into human-sized bays and catch
  // grazing light. Texture detail cannot repair an unbroken box silhouette by itself.
  for (const y of [3.0, 6.0, 8.75]) {
    box(scene, 0.22, 0.14, 110, materials().stone, x + normal * 0.20, y, 0);
  }
  for (let z = -52 + seedOffset; z < 53; z += 12.8) {
    box(scene, 0.24, 8.8, 0.28, materials().trim, x + normal * 0.21, 4.45, z);
  }
  const damp = new THREE.MeshStandardMaterial({
    color: 0x242a2e, transparent: true, opacity: 0.42, roughness: 0.98, depthWrite: false,
  });
  plane(scene, 110, 0.75, damp, x + normal * 0.166, 0.5, 0, 0,
    normal > 0 ? Math.PI / 2 : -Math.PI / 2);
}

function roadMarkings(scene) {
  for (let z = -47; z < 52; z += 5) {
    plane(scene, 0.24, 2.35, materials().roadPaint, 0, 0.014, z);
  }
  for (const z of [-42, 28]) {
    for (let x = -7; x <= 7; x += 2) {
      plane(scene, 1.05, 4.2, materials().roadPaint, x, 0.015, z);
    }
  }
  // Patched trenches and utility covers interrupt the mathematically perfect road plane.
  for (const [x, z, w, d, r] of [
    [-3.5, 14, 3.2, 5.8, .08], [4.7, -12, 2.4, 4.6, -.04], [-2, -39, 5.5, 2.1, .03],
  ]) {
    const p = plane(scene, w, d, materials().patch, x, 0.016, z);
    p.rotation.z = r;
  }
  for (const [x, z] of [[4.2, 17], [-4.4, -5], [3.1, -43]]) {
    const cover = new THREE.Mesh(
      new THREE.CylinderGeometry(0.56, 0.56, 0.025, 24), materials().trim);
    cover.position.set(x, 0.02, z);
    cover.receiveShadow = true;
    scene.add(cover);
  }
}

function wetAndContact(scene) {
  for (const [x, z, sx, sz, r] of [
    [-6.7, 17, 2.6, 7.5, .18], [6.4, -10, 1.8, 5.2, -.12],
    [-7.2, -35, 2.0, 6.8, .08], [7.1, 36, 1.4, 4.5, -.2],
  ]) {
    const p = plane(scene, 2, 2, materials().wet, x, 0.022, z);
    p.scale.set(sx, sz, 1);
    p.rotation.z = r;
  }
  for (const [x, z, sx, sz] of [
    [-4, 25, 5.2, 2.4], [3, 5, 2.4, 5.2], [-2, -18, 5.2, 2.4],
    [5, -35, 2.4, 5.2], [-6, 33, 5.2, 2.4], [6, -28, 2.4, 5.2],
  ]) {
    plane(scene, sx, sz, materials().shadow, x, 0.024, z);
  }
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
  plane(scene, 60, 130, m.asphalt, 0, 0.006, 0);
  plane(scene, 8, 120, m.sidewalk, -12, 0.156, 0);
  plane(scene, 8, 120, m.sidewalk, 12, 0.156, 0);
  box(scene, 0.22, 0.15, 120, m.curb, -8.03, 0.075, 0);
  box(scene, 0.22, 0.15, 120, m.curb, 8.03, 0.075, 0);
  facade(scene, -16, 1, m.brick, 0);
  facade(scene, 16, -1, m.plaster, 5.5);
  roadMarkings(scene);
  wetAndContact(scene);
  streetLights(scene);
}
