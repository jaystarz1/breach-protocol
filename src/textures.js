// Procedural surface textures, drawn to canvas at boot.
//
// Deliberately no image files: this is an offline-capable PWA and every byte here would be
// a download plus a cache entry plus a licence to track. Canvas noise costs a few ms once.
//
// Each texture is generated greyscale-ish and TINTED at draw time by the mesh's existing
// vertex colours, so the whole level still renders in one draw call with one material.
import * as THREE from 'three';

const SIZE = 256;

function canvas2d() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return { c, x: c.getContext('2d') };
}

function finish(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

// Value noise, cheap and good enough for grain. Not Perlin — we want speckle, not clouds.
function speckle(x, { base, spread, density = 1, dot = 1 }) {
  const img = x.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.random() > density) continue;
    const v = base + (Math.random() - 0.5) * spread;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  // a few darker pits so flat walls aren't perfectly uniform at grazing angles
  x.globalAlpha = 0.5;
  for (let i = 0; i < 220 * dot; i++) {
    const r = 1 + Math.random() * 2.5;
    x.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.12})`;
    x.beginPath();
    x.arc(Math.random() * SIZE, Math.random() * SIZE, r, 0, 7);
    x.fill();
  }
  x.globalAlpha = 1;
}

function concreteMap() {
  const { c, x } = canvas2d();
  x.fillStyle = '#b8b8b8';
  x.fillRect(0, 0, SIZE, SIZE);
  speckle(x, { base: 184, spread: 46, density: 1 });
  return finish(c, 1);
}

// Roughness map: brighter = rougher. Concrete is rough everywhere, slightly polished in
// patches so light rakes across it unevenly instead of reading as one flat sheet.
function concreteRough() {
  const { c, x } = canvas2d();
  x.fillStyle = '#d8d8d8';
  x.fillRect(0, 0, SIZE, SIZE);
  speckle(x, { base: 216, spread: 60, density: 1, dot: 0.4 });
  return finish(c, 1);
}

function metalMap() {
  const { c, x } = canvas2d();
  x.fillStyle = '#9aa0a6';
  x.fillRect(0, 0, SIZE, SIZE);
  // brushed streaks
  for (let i = 0; i < 1400; i++) {
    const y = Math.random() * SIZE;
    const w = 20 + Math.random() * 90;
    x.strokeStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
    x.beginPath();
    x.moveTo(Math.random() * SIZE, y);
    x.lineTo(Math.random() * SIZE + w, y + (Math.random() - 0.5));
    x.stroke();
  }
  for (let i = 0; i < 700; i++) {
    const y = Math.random() * SIZE;
    x.strokeStyle = `rgba(0,0,0,${Math.random() * 0.07})`;
    x.beginPath();
    x.moveTo(Math.random() * SIZE, y);
    x.lineTo(Math.random() * SIZE + 60, y);
    x.stroke();
  }
  return finish(c, 1);
}

function metalRough() {
  const { c, x } = canvas2d();
  x.fillStyle = '#6a6a6a';
  x.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 1200; i++) {
    const y = Math.random() * SIZE;
    x.strokeStyle = `rgba(255,255,255,${Math.random() * 0.12})`;
    x.beginPath();
    x.moveTo(Math.random() * SIZE, y);
    x.lineTo(Math.random() * SIZE + 80, y);
    x.stroke();
  }
  return finish(c, 1);
}

// ---------- Environment ----------
// A metal with nothing to reflect renders BLACK, which is why naive PBR conversions look
// worse than the Lambert they replaced. three's RoomEnvironment lives in examples/jsm and
// isn't in the bundled core module, so build a cheap equirect sky/ground gradient here and
// let PMREM convolve it. Tinted per level so reflections match that level's palette.
let envCache = new Map();

export function environment(renderer, skyHex, fogHex) {
  const key = `${skyHex}|${fogHex}`;
  if (envCache.has(key)) return envCache.get(key);

  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  const sky = new THREE.Color(skyHex), ground = new THREE.Color(fogHex);
  // brighten the upper hemisphere: an interior still gets most of its bounce from above
  const up = sky.clone().multiplyScalar(1.9);
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, `#${up.getHexString()}`);
  g.addColorStop(0.48, `#${sky.getHexString()}`);
  g.addColorStop(0.52, `#${ground.clone().multiplyScalar(0.7).getHexString()}`);
  g.addColorStop(1, `#${ground.clone().multiplyScalar(0.35).getHexString()}`);
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 128);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  envCache.set(key, env);
  return env;
}

let cache = null;

// Built once, shared by every material. Safe to call repeatedly.
export function surfaces() {
  if (cache) return cache;
  cache = {
    concrete: { map: concreteMap(), roughnessMap: concreteRough() },
    metal: { map: metalMap(), roughnessMap: metalRough() },
  };
  return cache;
}
