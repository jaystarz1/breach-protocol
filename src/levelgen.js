import * as THREE from 'three';
import { makeBox } from './physics.js';

// geo entries: [x, y, z, w, h, d, color, solid=true]
// Merges all static boxes into one mesh with vertex colors for a single draw call.
export function buildStaticGeometry(scene, geo) {
  const solids = [];
  const positions = [], normals = [], colors = [], indices = [];
  let vtx = 0;
  const c = new THREE.Color();
  for (const [x, y, z, w, h, d, color, solid] of geo) {
    if (solid !== false) solids.push(makeBox(x, y, z, w, h, d));
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const pos = g.attributes.position, norm = g.attributes.normal, idx = g.index;
    c.setHex(color);
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      colors.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vtx);
    vtx += pos.count;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.setIndex(indices);
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(mesh);
  return { solids, mesh };
}

// ---------- Low-poly humanoid ----------
function limb(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

// Enemy: dark tactical gear + visible rifle. Civilian: bright clothes, hands raised, NO weapon.
export function makeCharacter({ hostile, hostage, skin = 0xc8a888 }) {
  const g = new THREE.Group();
  const gear = hostile ? 0x2b2f33 : [0xef9a9a, 0x90caf9, 0xfff59d, 0xa5d6a7, 0xce93d8][Math.floor(Math.random() * 5)];
  const pants = hostile ? 0x1c1f22 : 0x546e7a;
  // legs
  g.add(limb(0.16, 0.75, 0.16, pants, -0.12, 0.375, 0));
  g.add(limb(0.16, 0.75, 0.16, pants, 0.12, 0.375, 0));
  // torso
  g.add(limb(0.5, 0.62, 0.28, gear, 0, 1.06, 0));
  // head
  g.add(limb(0.26, 0.26, 0.26, hostile ? 0x15181b : skin, 0, 1.53, 0)); // enemies wear balaclava
  if (hostile) {
    // rifle held across chest — THE visual tell
    const rifle = limb(0.08, 0.1, 0.85, 0x0a0a0a, 0.18, 1.1, 0.28);
    rifle.rotation.x = -0.25;
    g.add(rifle);
    g.add(limb(0.14, 0.5, 0.14, gear, -0.32, 1.1, 0.1)); // arms forward
    g.add(limb(0.14, 0.5, 0.14, gear, 0.32, 1.1, 0.18));
  } else {
    // hands up — unarmed silhouette
    const la = limb(0.13, 0.55, 0.13, gear, -0.34, 1.45, 0);
    const ra = limb(0.13, 0.55, 0.13, gear, 0.34, 1.45, 0);
    la.rotation.z = 0.25; ra.rotation.z = -0.25;
    g.add(la, ra);
  }
  if (hostage) { g.scale.y = 0.62; } // kneeling
  return g;
}

// Breachable door mesh
export function makeDoor(w = 1.4, h = 2.4) {
  const g = new THREE.Group();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.12),
    new THREE.MeshLambertMaterial({ color: 0x6d4c41 })
  );
  panel.position.y = h / 2;
  g.add(panel);
  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.2), new THREE.MeshLambertMaterial({ color: 0xffc107 }));
  knob.position.set(w / 2 - 0.18, h / 2, 0);
  g.add(knob);
  return g;
}

// ---------- Level authoring helpers (produce geo arrays) ----------
export const C = {
  street: 0x23272b, sidewalk: 0x3a4045, building: 0x4a5560, buildingB: 0x5d6a75,
  interiorFloor: 0x424a50, interiorWall: 0x5b666e, roof: 0x333a40, crate: 0x6d5b44,
  concrete: 0x757f87, metal: 0x37474f, tunnel: 0x2e3438, platform: 0x49525a,
  accent: 0x8d6e63, glassWall: 0x4f6472,
};

export function floorSlab(x, z, w, d, y = 0, t = 0.4, color = C.interiorFloor) {
  return [[x, y - t / 2, z, w, t, d, color]];
}

// Wall along X or Z with optional gaps (doorways). gaps: [{off, w, h}] offset from wall start.
export function wall(x1, z1, x2, z2, h, color = C.interiorWall, gaps = [], yBase = 0, thick = 0.3) {
  const out = [];
  const len = Math.hypot(x2 - x1, z2 - z1);
  const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
  let cursor = 0;
  const segs = [];
  const sorted = [...gaps].sort((a, b) => a.off - b.off);
  for (const gap of sorted) {
    if (gap.off > cursor) segs.push({ off: cursor, len: gap.off - cursor, h, y: yBase });
    // lintel above the gap
    const gh = gap.h ?? 2.4;
    if (gh < h) segs.push({ off: gap.off, len: gap.w, h: h - gh, y: yBase + gh });
    cursor = gap.off + gap.w;
  }
  if (cursor < len) segs.push({ off: cursor, len: len - cursor, h, y: yBase });
  for (const s of segs) {
    const cx = x1 + ux * (s.off + s.len / 2), cz = z1 + uz * (s.off + s.len / 2);
    const w = Math.abs(ux) > 0.5 ? s.len : thick;
    const d = Math.abs(uz) > 0.5 ? s.len : thick;
    out.push([cx, s.y + s.h / 2, cz, w, s.h, d, color]);
  }
  return out;
}

// Staircase from (x,z) heading dir ('n','s','e','w'), climbing `height` over `run` length.
export function stairs(x, z, dir, run, height, width = 1.6, color = C.concrete, yBase = 0) {
  const steps = Math.max(4, Math.round(height / 0.25));
  const stepH = height / steps, stepL = run / steps;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * stepL;
    let sx = x, sz = z, w = width, d = stepL + 0.02;
    if (dir === 'n') sz = z - t;
    if (dir === 's') sz = z + t;
    if (dir === 'e') { sx = x + t; w = stepL + 0.02; d = width; }
    if (dir === 'w') { sx = x - t; w = stepL + 0.02; d = width; }
    const h = stepH * (i + 1);
    out.push([sx, yBase + h / 2, sz, w, h, d, color]);
  }
  return out;
}

export function crate(x, z, y = 0, s = 1.0) {
  return [[x, y + s / 2, z, s, s, s, C.crate]];
}

export function car(x, z, rotZAxis = false) {
  // simple parked car: body + cabin
  const body = rotZAxis ? [x, 0.45, z, 1.8, 0.9, 4.2] : [x, 0.45, z, 4.2, 0.9, 1.8];
  const cab = rotZAxis ? [x, 1.15, z, 1.6, 0.55, 2.0] : [x, 1.15, z, 2.0, 0.55, 1.6];
  const col = [0x7a2e2e, 0x2e4a7a, 0x666666, 0x3f5c3f][Math.floor(Math.random() * 4)];
  return [[...body, col], [...cab, col]];
}
