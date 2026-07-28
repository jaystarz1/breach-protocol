// Shared surface textures. Photographed PBR families cover the large close surfaces; compact
// procedural maps remain the offline fallback and cover metal, timber and fabric without
// multiplying material variants. Every photo is shared by a whole family, so adding detail
// does not add draw calls.
import * as THREE from 'three';
import { quality } from './quality.js';

const SIZE = 256;
const PHOTO_ROOT = './assets/street-sweep/';
const MATERIAL_ROOT = './assets/materials/';

let photoCache = null;
if (quality.textures) {
  try {
    const loader = new THREE.TextureLoader();
    const names = ['asphalt', 'sidewalk', 'brick', 'plaster'];
    const loaded = await Promise.all(names.flatMap(name => [
      loader.loadAsync(`${PHOTO_ROOT}${name}.jpg`),
      loader.loadAsync(`${PHOTO_ROOT}${name}-height.jpg`),
    ]));
    photoCache = {};
    for (let i = 0; i < names.length; i++) {
      const map = loaded[i * 2];
      const height = loaded[i * 2 + 1];
      map.colorSpace = THREE.SRGBColorSpace;
      height.colorSpace = THREE.NoColorSpace;
      map.wrapS = map.wrapT = height.wrapS = height.wrapT = THREE.RepeatWrapping;
      map.anisotropy = height.anisotropy = 8;
      photoCache[names[i]] = { map, height };
    }
    const [concreteMap, concreteNormal, concreteRoughness] = await Promise.all([
      loader.loadAsync(`${MATERIAL_ROOT}concrete/concrete-color.webp`),
      loader.loadAsync(`${MATERIAL_ROOT}concrete/concrete-normal.webp`),
      loader.loadAsync(`${MATERIAL_ROOT}concrete/concrete-roughness.webp`),
    ]);
    concreteMap.colorSpace = THREE.SRGBColorSpace;
    concreteNormal.colorSpace = concreteRoughness.colorSpace = THREE.NoColorSpace;
    for (const texture of [concreteMap, concreteNormal, concreteRoughness]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
    }
    photoCache.concrete = {
      map: concreteMap,
      normalMap: concreteNormal,
      roughnessMap: concreteRoughness,
    };
  } catch (error) {
    console.warn('[bp] photographic surface set unavailable; using procedural materials', error);
  }
}

export function photoSurfaces() {
  return photoCache;
}

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

// Sobel the luminance of a height image into a tangent-space normal map. Without this,
// colour and roughness maps still leave a wall perfectly flat under any light — the grain
// is painted on rather than standing up. SIZE is a power of two so the wrap mask works and
// the derived map tiles seamlessly with the colour map it came from.
function heightToNormal(srcCanvas, strength = 2.0) {
  const { c, x } = canvas2d();
  const src = srcCanvas.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
  const out = x.createImageData(SIZE, SIZE);
  const M = SIZE - 1;
  const h = (i, j) => src[(((j & M) * SIZE) + (i & M)) * 4] / 255;
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const dx = (h(i + 1, j - 1) + 2 * h(i + 1, j) + h(i + 1, j + 1))
               - (h(i - 1, j - 1) + 2 * h(i - 1, j) + h(i - 1, j + 1));
      const dy = (h(i - 1, j + 1) + 2 * h(i, j + 1) + h(i + 1, j + 1))
               - (h(i - 1, j - 1) + 2 * h(i, j - 1) + h(i + 1, j - 1));
      const nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const o = (j * SIZE + i) * 4;
      out.data[o] = (nx / l * 0.5 + 0.5) * 255;
      out.data[o + 1] = (ny / l * 0.5 + 0.5) * 255;
      out.data[o + 2] = (nz / l * 0.5 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  x.putImageData(out, 0, 0);
  const t = finish(c, 1);
  t.colorSpace = THREE.NoColorSpace;   // normal data is not colour; sRGB decode would skew it
  return t;
}

function concreteCanvas() {
  const { c, x } = canvas2d();
  x.fillStyle = '#b8b8b8';
  x.fillRect(0, 0, SIZE, SIZE);
  speckle(x, { base: 184, spread: 46, density: 1 });
  // shallow pits and a few hairline cracks, which is what the normal pass turns into relief
  x.strokeStyle = 'rgba(120,120,120,0.5)';
  for (let i = 0; i < 14; i++) {
    x.lineWidth = 0.6 + Math.random();
    x.beginPath();
    let px = Math.random() * SIZE, py = Math.random() * SIZE;
    x.moveTo(px, py);
    for (let s = 0; s < 6; s++) { px += (Math.random() - 0.5) * 40; py += (Math.random() - 0.5) * 40; x.lineTo(px, py); }
    x.stroke();
  }
  return c;
}

// Roughness map: brighter = rougher. Concrete is rough everywhere, slightly polished in
// patches so light rakes across it unevenly instead of reading as one flat sheet.
function concreteRoughCanvas() {
  const { c, x } = canvas2d();
  x.fillStyle = '#d8d8d8';
  x.fillRect(0, 0, SIZE, SIZE);
  speckle(x, { base: 216, spread: 60, density: 1, dot: 0.4 });
  return c;
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
  return c;
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
  // Return the canvas like every other source generator. surfaces() performs the one and only
  // CanvasTexture wrap; returning a Texture here made it try to upload a Texture object as if
  // it were an HTML image, which WebGL rejects on the desktop PBR path.
  return c;
}

function fabricCanvas() {
  const { c, x } = canvas2d();
  x.fillStyle = '#b8b8b8';
  x.fillRect(0, 0, SIZE, SIZE);
  // Fine ripstop weave. Kept close in value so it reads through grazing light without
  // turning uniforms into patterned camouflage at medium range.
  for (let i = 0; i < SIZE; i += 4) {
    x.strokeStyle = i % 8 ? 'rgba(255,255,255,.045)' : 'rgba(20,20,20,.055)';
    x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, SIZE); x.stroke();
    x.beginPath(); x.moveTo(0, i + 0.5); x.lineTo(SIZE, i + 0.5); x.stroke();
  }
  speckle(x, { base: 184, spread: 18, density: 0.22, dot: 0.12 });
  return c;
}

function fabricRoughCanvas() {
  const { c, x } = canvas2d();
  x.fillStyle = '#e0e0e0';
  x.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < SIZE; i += 4) {
    x.strokeStyle = 'rgba(20,20,20,.08)';
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, SIZE); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(SIZE, i); x.stroke();
  }
  return c;
}

function timberCanvas() {
  const { c, x } = canvas2d();
  x.fillStyle = '#a9a29a';
  x.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 1100; i++) {
    const y = Math.random() * SIZE;
    const wave = Math.sin(y * 0.075) * 7;
    x.strokeStyle = Math.random() > 0.45
      ? `rgba(255,255,255,${0.025 + Math.random() * 0.055})`
      : `rgba(30,20,14,${0.025 + Math.random() * 0.07})`;
    x.beginPath();
    x.moveTo(-10, y);
    x.bezierCurveTo(70, y + wave, 175, y - wave, 270, y + Math.sin(y) * 3);
    x.stroke();
  }
  return c;
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

// The sky dome canvas doubles as the IBL source, so reflections agree with what is actually
// overhead instead of a separate invented gradient. Falls back to the old gradient path when
// no dome exists (the indoor levels).
export function environmentFrom(renderer, canvas, key) {
  if (envCache.has(key)) return envCache.get(key);
  const tex = new THREE.CanvasTexture(canvas);
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
  const cc = concreteCanvas(), cr = concreteRoughCanvas();
  const mc = metalMap(), mr = metalRough();
  const fc = fabricCanvas(), fr = fabricRoughCanvas();
  const wc = timberCanvas();
  cache = {
    // The colour canvas is reused as the height field: its luminance variation IS the relief.
    concrete: { map: finish(cc), roughnessMap: finish(cr), normalMap: heightToNormal(cc, 1.4) },
    metal: { map: finish(mc), roughnessMap: finish(mr), normalMap: heightToNormal(mc, 1.1) },
    fabric: { map: finish(fc, 2), roughnessMap: finish(fr, 2), normalMap: heightToNormal(fc, 0.72) },
    timber: { map: finish(wc), normalMap: heightToNormal(wc, 0.82) },
  };
  return cache;
}
