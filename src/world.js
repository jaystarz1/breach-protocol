// World layer: sky, horizon, distant city, and the street-level prop kit.
//
// Everything before this module existed inside a void: scene.background was a flat colour,
// the ground plane stopped at the level's edge, and buildings were unbroken boxes. Textures
// cannot fix that — a grey box with concrete grain on it is wallpaper. What sells depth is
// a sky with a light source in it, geometry receding into fog, and clutter at human scale.
//
// Still zero art assets: canvas gradients and box geometry only.
import * as THREE from 'three';
import { quality } from './quality.js';

// ---------- deterministic noise ----------
// Not Math.random(): the skyline and prop scatter must be identical every time a level
// loads, or a retry after death rebuilds a different city and screenshots never match.
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------- geo tuple helpers ----------
// geo entries are [x, y, z, w, h, d, color, solid, emissive].
// Anything decorative passes solid=false so it never enters the collision set or navgrid.
const box = (x, y, z, w, h, d, color, solid = false, emissive = false) =>
  [x, y, z, w, h, d, color, solid, emissive];

// Standing on the ground with its base sunk 3cm, so no prop's bottom face is ever coplanar
// with the street's top face at y=0. Same class of bug as the floor strobe.
const stand = (x, z, w, h, d, color, solid = false, emissive = false, base = -0.03) =>
  box(x, base + h / 2, z, w, h, d, color, solid, emissive);

// Raise a prop kit onto a roof or down into a trench. Every prop helper places itself on the
// ground at y=0, so without this a rooftop AC unit spawns 24m below the roof it belongs to.
export function lift(geo, dy) {
  return geo.map(e => { const c = e.slice(); c[1] += dy; return c; });
}

export const P = {
  pole: 0x2b3238, lampHead: 0xffd9a0, dark: 0x1b2126, rust: 0x6b4a3a,
  bag: 0x6d6450, tank: 0x4a5259, grille: 0x3a4249, paint: 0x9aa1a8,
  glassOff: 0x141a21, glassWarm: 0xffcf92, glassCool: 0xa8ccf0,
  hydrant: 0x8c2f2a, bench: 0x5a4636, sign: 0x2f6a4a,
};

// ---------- sky ----------
// Equirectangular canvas: top row is the zenith, middle row the horizon. Painted rather
// than shaded because a MeshBasicMaterial dome costs one draw call and no shader compile,
// and every level here is night or dusk so there is no sun disc to get physically right.
const SKY_W = 1024, SKY_H = 512;

function skyCanvas(skyHex, fogHex, seed, opts = {}) {
  const c = document.createElement('canvas');
  c.width = SKY_W; c.height = SKY_H;
  const x = c.getContext('2d');
  const R = rng(seed);
  const sky = new THREE.Color(skyHex);
  const horizon = new THREE.Color(fogHex);
  const hex = col => `#${col.getHexString()}`;

  // vertical gradient: darker overhead, hazier at the horizon where the air is thickest
  const zenith = sky.clone().multiplyScalar(0.42);
  const upper = sky.clone().multiplyScalar(0.85);
  // Restrained: this canvas is also the IBL source, so an over-bright horizon band does not
  // just look wrong, it floods every surface in the level with ambient and blows out concrete.
  const haze = horizon.clone().lerp(new THREE.Color(0xffffff), 0.06).multiplyScalar(1.15);
  const g = x.createLinearGradient(0, 0, 0, SKY_H);
  g.addColorStop(0.00, hex(zenith));
  g.addColorStop(0.30, hex(upper));
  g.addColorStop(0.47, hex(haze));
  g.addColorStop(0.50, hex(haze));
  g.addColorStop(0.52, hex(horizon.clone().multiplyScalar(0.8)));
  g.addColorStop(1.00, hex(horizon.clone().multiplyScalar(0.45)));
  x.fillStyle = g;
  x.fillRect(0, 0, SKY_W, SKY_H);

  const HORIZON_Y = SKY_H * 0.5;

  // stars, thinning toward the horizon haze
  if (opts.stars !== false) {
    for (let i = 0; i < 700; i++) {
      const sy = R() * HORIZON_Y * 0.92;
      const fade = 1 - sy / (HORIZON_Y * 0.92);
      x.globalAlpha = (0.15 + R() * 0.65) * fade;
      x.fillStyle = '#ffffff';
      const r = R() < 0.08 ? 1.4 : 0.7;
      x.beginPath(); x.arc(R() * SKY_W, sy, r, 0, 7); x.fill();
    }
    x.globalAlpha = 1;
  }

  // The moon: the levels are lit by a single directional light from +X/+Y/+Z, so put the
  // source roughly where that light comes from or the sky contradicts the shading.
  const mx = SKY_W * 0.16, my = HORIZON_Y * 0.34;
  const glow = x.createRadialGradient(mx, my, 0, mx, my, 150);
  glow.addColorStop(0, 'rgba(224,236,255,0.55)');
  glow.addColorStop(0.25, 'rgba(190,212,246,0.16)');
  glow.addColorStop(1, 'rgba(190,212,246,0)');
  x.fillStyle = glow;
  x.beginPath(); x.arc(mx, my, 150, 0, 7); x.fill();
  x.fillStyle = 'rgba(240,246,255,0.92)';
  x.beginPath(); x.arc(mx, my, 13, 0, 7); x.fill();

  // Cloud banks, lit from the moon side. Counts are low ON PURPOSE: alpha accumulates where
  // ellipses overlap, and 22 bands of 7 blobs saturated the entire upper sky to near-white.
  for (let band = 0; band < 11; band++) {
    const cy = HORIZON_Y * (0.2 + R() * 0.62);
    const cx = R() * SKY_W;
    const cw = 110 + R() * 260, ch = 10 + R() * 24;
    const lit = 1 - Math.min(1, Math.abs(cx - mx) / (SKY_W * 0.5));
    const tone = sky.clone().lerp(new THREE.Color(0xdfe8ff), 0.12 + lit * 0.3);
    x.globalAlpha = 0.05 + R() * 0.07;
    x.fillStyle = hex(tone);
    for (let p = 0; p < 4; p++) {
      x.beginPath();
      x.ellipse(cx + (R() - 0.5) * cw, cy + (R() - 0.5) * ch, cw * (0.22 + R() * 0.34), ch * (0.4 + R() * 0.6), 0, 0, 7);
      x.fill();
    }
  }
  x.globalAlpha = 1;

  // Distant city baked into the dome. Real geometry can only live inside the fog far plane,
  // so anything past it has to be painted here or the horizon is empty. Two depth layers.
  const layer = (yTop, hMax, tint, winChance) => {
    let px = -40;
    while (px < SKY_W + 40) {
      const bw = 14 + R() * 46;
      const bh = hMax * (0.28 + R() * 0.72);
      const top = yTop - bh;
      x.fillStyle = hex(tint);
      x.fillRect(px, top, bw, yTop - top + 6);
      // window dots: the tell that a silhouette is a building and not a hill
      if (winChance > 0) {
        for (let wy = top + 5; wy < yTop - 3; wy += 6) {
          for (let wx = px + 3; wx < px + bw - 3; wx += 5) {
            if (R() > winChance) continue;
            x.fillStyle = R() < 0.72 ? 'rgba(255,208,150,0.75)' : 'rgba(170,205,240,0.6)';
            x.fillRect(wx, wy, 2, 2.5);
          }
        }
      }
      px += bw + (R() < 0.25 ? 6 + R() * 18 : 0);
    }
  };
  // Far ridge first, nearly dissolved into the haze, then a closer skyline over it.
  // Heights are SMALL: painted buildings are effectively at infinity, so they must hug the
  // horizon line. At SKY_H*0.13 they subtend 13 degrees and read as a city floating in the
  // sky above the real mid-distance ring rather than as distance behind it.
  layer(HORIZON_Y + 2, SKY_H * 0.028, horizon.clone().lerp(sky, 0.45).multiplyScalar(0.85), 0);
  layer(HORIZON_Y + 3, SKY_H * 0.048, sky.clone().multiplyScalar(0.5), 0.2);

  return c;
}

const skyCache = new Map();

// The dome is parented to nothing and re-centred on the camera every frame, so its radius
// only has to beat the nearest real geometry, not the level size. 460 keeps it inside the
// 500 far plane with room for the ground plate to fade out under it.
export function skyDome(skyHex, fogHex, seed) {
  const key = `${skyHex}|${fogHex}|${seed}`;
  let canvas = skyCache.get(key);
  if (!canvas) { canvas = skyCanvas(skyHex, fogHex, seed); skyCache.set(key, canvas); }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(460, 40, 20),
    // fog:false or the dome fades to fog colour and we are back to a flat wash.
    // depthWrite:false + renderOrder -1 so every piece of real geometry paints over it.
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.userData.skyCanvas = canvas;
  return mesh;
}

// ---------- horizon plate + mid-distance city ----------
// A level's own ground stops at its edge and beyond it you saw straight through to the
// background colour. This plate runs past the far plane so the ground always meets the sky.
// Top at -0.06: below every level's y=0 surface, so it cannot z-fight with any of them.
export function groundPlate(cx, cz, color) {
  return [box(cx, -0.06 - 40, cz, 2400, 80, 2400, color, false)];
}

// Buildings ringing the play area, placed to sit INSIDE the fog so they recede instead of
// popping. Non-solid: they are scenery past the level's own walls and must never join the
// collision set or the navgrid, or the AI will try to path into them.
// Budgets are hard, not advisory. The naive version of this scaled building count with ring
// radius, which on the 500m-fog sniper map produced ~274 towers and ~55,000 window panes
// before anything was drawn. Count is capped and width grows with radius instead, so a big
// ring still reads as a continuous skyline without multiplying geometry.
const RING_MAX = 30, RING_MIN = 12;
const PANES_PER_BUILDING = 24;

export function skyline(bounds, fogFar, seed, opts = {}) {
  const geo = [];
  const R = rng(seed);
  const inner = Math.max(bounds.r + 10, fogFar * 0.42);
  const outer = Math.max(inner + 70, fogFar * 0.8);
  const rings = opts.rings ?? (quality.pbr ? 3 : 2);
  // Dark by default. Mid-distance scenery lighter than the sky behind it reads as polystyrene
  // blocks; it needs to sit BELOW the sky in value for the depth cue to work.
  const body = opts.body ?? 0x3c4650;

  for (let ring = 0; ring < rings; ring++) {
    const t = rings === 1 ? 0 : ring / (rings - 1);
    const rad = inner + (outer - inner) * t;
    // Further out means dimmer and bluer: aerial perspective, done in vertex colour because
    // the fog already handles the rest and this costs nothing.
    const fade = 0.86 - t * 0.3;
    const tint = new THREE.Color(body).multiplyScalar(fade).getHex();
    const count = Math.min(RING_MAX, Math.max(RING_MIN, Math.round(rad * 0.18)));
    // arc length one building has to cover to keep the ring from looking like a picket fence
    const arc = (2 * Math.PI * rad) / count;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (R() - 0.5) * 0.1;
      const rr = rad * (0.94 + R() * 0.14);
      const bx = bounds.cx + Math.cos(a) * rr;
      const bz = bounds.cz + Math.sin(a) * rr;
      const w = arc * (0.55 + R() * 0.4), d = arc * (0.5 + R() * 0.35);
      const h = 12 + R() * (24 + t * 46);
      geo.push(box(bx, h / 2, bz, w, h, d, tint, false));
      // roof clutter reads as a city rather than a bar chart
      if (R() < 0.55) geo.push(box(bx + (R() - 0.5) * w * 0.5, h + 1.2, bz + (R() - 0.5) * d * 0.5, w * 0.16, 2.4, d * 0.16, tint, false));
      if (R() < 0.3) geo.push(box(bx + (R() - 0.5) * w * 0.6, h + 3.6, bz + (R() - 0.5) * d * 0.6, 0.6, 7.2, 0.6, tint, false));

      // Lit windows, inner ring only and only on some buildings. Emissive, so they draw
      // unlit and read as light coming OUT rather than as a pale grey square. Anything on
      // an outer ring is deep enough in fog that panes would be invisible anyway.
      if (!quality.textures || ring !== 0 || R() > 0.5) continue;
      const alongX = Math.abs(Math.cos(a)) <= Math.abs(Math.sin(a));
      const sgn = alongX ? -Math.sign(Math.sin(a)) : -Math.sign(Math.cos(a));
      const face = alongX ? bz + sgn * (d / 2 + 0.08) : bx + sgn * (w / 2 + 0.08);
      const span = alongX ? w : d;
      const rowStep = Math.max(3.4, (h - 5) / 6);
      const colStep = Math.max(3.2, span / 5);
      let panes = 0;
      for (let wy = 3.2; wy < h - 2 && panes < PANES_PER_BUILDING; wy += rowStep) {
        for (let off = -span / 2 + 2; off < span / 2 - 2 && panes < PANES_PER_BUILDING; off += colStep) {
          const on = R();
          if (on > 0.55) continue;
          const col = on < 0.34 ? P.glassWarm : P.glassCool;
          geo.push(alongX
            ? box(bx + off, wy, face, 1.6, 1.6, 0.14, col, false, true)
            : box(face, wy, bz + off, 0.14, 1.6, 1.6, col, false, true));
          panes++;
        }
      }
    }
  }
  return geo;
}

// ---------- facade windows on real, walkable buildings ----------
// Stamps a window grid onto one wall run. `nx/nz` is the outward normal so the panes sit
// just proud of the wall face instead of intersecting it and z-fighting.
export function facade(x1, z1, x2, z2, yBase, height, seed, opts = {}) {
  const geo = [];
  const R = rng(seed);
  const len = Math.hypot(x2 - x1, z2 - z1);
  if (len < 3) return geo;
  const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
  let nx = -uz, nz = ux;
  // Deriving "outward" from the winding order of the two points is a trap — get the order
  // backwards and the panes sink into the wall and z-fight. Orient away from the building
  // centre instead, which the caller always knows and cannot get wrong.
  if (opts.away) {
    const mx = (x1 + x2) / 2 - opts.away[0], mz = (z1 + z2) / 2 - opts.away[1];
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
  }
  const out = opts.out ?? 0.2;
  const step = opts.step ?? 3.0;
  const floorH = opts.floorH ?? 3.0;
  const litChance = opts.lit ?? 0.34;
  const skip = opts.skip ?? [];               // [{from,to}] gaps along the run, e.g. doorways

  for (let fy = yBase + 1.2; fy < yBase + height - 1.3; fy += floorH) {
    for (let s = 1.8; s < len - 1.8; s += step) {
      if (skip.some(g => s > g.from - 1.2 && s < g.to + 1.2)) continue;
      const cx = x1 + ux * s + nx * out;
      const cz = z1 + uz * s + nz * out;
      const r = R();
      const col = r < litChance ? (r < litChance * 0.72 ? P.glassWarm : P.glassCool) : P.glassOff;
      const lit = col !== P.glassOff;
      const w = Math.abs(ux) > 0.5 ? 1.7 : 0.16;
      const d = Math.abs(uz) > 0.5 ? 1.7 : 0.16;
      geo.push(box(cx, fy + 0.75, cz, w, 1.5, d, col, false, lit));
      // sill: a thin ledge under each pane, which is what actually catches the key light
      geo.push(box(cx, fy - 0.06, cz, Math.abs(ux) > 0.5 ? 2.0 : 0.3, 0.12, Math.abs(uz) > 0.5 ? 2.0 : 0.3, P.paint, false));
    }
  }
  return geo;
}

// ---------- street props ----------
export function lamp(x, z, h = 6.5, arm = 1.6, dir = 1) {
  return [
    stand(x, z, 0.16, h, 0.16, P.pole),
    box(x + arm * dir * 0.5, h - 0.1, z, arm, 0.12, 0.12, P.pole),
    box(x + arm * dir, h - 0.28, z, 0.62, 0.2, 0.36, P.dark),
    box(x + arm * dir, h - 0.42, z, 0.5, 0.1, 0.28, P.lampHead, false, true),
  ];
}

export function trafficLight(x, z, h = 4.4, dir = 1) {
  const hx = x + dir * 0.55;
  return [
    stand(x, z, 0.18, h, 0.18, P.pole),
    box(x + dir * 0.3, h - 0.2, z, 0.6, 0.12, 0.12, P.pole),
    box(hx, h - 0.75, z, 0.34, 1.0, 0.3, P.dark),
    box(hx, h - 0.42, z + 0.17, 0.18, 0.18, 0.06, 0x8c2f2a, false, true),
    box(hx, h - 0.75, z + 0.17, 0.18, 0.18, 0.06, 0x3a3320, false),
    box(hx, h - 1.08, z + 0.17, 0.18, 0.18, 0.06, 0x1f3a26, false),
  ];
}

export function dumpster(x, z, rot = false) {
  const w = rot ? 1.4 : 2.4, d = rot ? 2.4 : 1.4;
  return [
    stand(x, z, w, 1.2, d, 0x3f5a46, true),
    box(x, 1.28, z, w + 0.1, 0.14, d + 0.1, 0x33493a, false),
  ];
}

export function hydrant(x, z) {
  return [stand(x, z, 0.26, 0.7, 0.26, P.hydrant), box(x, 0.78, z, 0.44, 0.12, 0.2, P.hydrant)];
}

export function bench(x, z, rot = false) {
  const w = rot ? 0.6 : 1.9, d = rot ? 1.9 : 0.6;
  return [
    stand(x, z, w, 0.45, d, P.pole),
    box(x, 0.52, z, w, 0.1, d, P.bench, false),
    box(x + (rot ? -0.26 : 0), 0.85, z + (rot ? 0 : -0.26), rot ? 0.1 : w, 0.55, rot ? d : 0.1, P.bench, false),
  ];
}

// Jersey barrier: two stacked boxes so the profile tapers instead of reading as a slab.
export function barrier(x, z, rot = false) {
  const w = rot ? 0.6 : 2.2, d = rot ? 2.2 : 0.6;
  return [
    stand(x, z, w, 0.5, d, P.paint, true),
    box(x, 0.72, z, rot ? 0.36 : w, 0.45, rot ? d : 0.36, P.paint, true),
  ];
}

// Sandbag stack. The offsets are deliberate: a perfectly aligned grid reads as masonry.
export function sandbags(x, z, cols = 5, rows = 3, rot = false, seed = 7) {
  const geo = [];
  const R = rng(seed);
  for (let r = 0; r < rows; r++) {
    const n = cols - (r % 2 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.52 + (r % 2 ? 0.26 : 0) + (R() - 0.5) * 0.05;
      const y = 0.14 + r * 0.26;
      const tone = new THREE.Color(P.bag).multiplyScalar(0.82 + R() * 0.3).getHex();
      geo.push(rot
        ? box(x + (R() - 0.5) * 0.06, y, z + off, 0.44, 0.25, 0.5, tone, r === 0)
        : box(x + off, y, z + (R() - 0.5) * 0.06, 0.5, 0.25, 0.44, tone, r === 0));
    }
  }
  return geo;
}

// Rooftop kit: what actually distinguishes a roof from the top of a cube.
export function acUnit(x, y, z, s = 1) {
  return [
    box(x, y + 0.35 * s, z, 1.5 * s, 0.7 * s, 1.2 * s, P.tank, true),
    box(x, y + 0.72 * s, z, 1.2 * s, 0.08 * s, 0.95 * s, P.grille, false),
  ];
}

export function waterTank(x, y, z) {
  return [
    box(x, y + 0.3, z, 2.4, 0.6, 2.4, P.pole, true),
    box(x, y + 2.0, z, 2.0, 2.8, 2.0, P.tank, true),
    box(x, y + 3.5, z, 2.2, 0.24, 2.2, P.rust, false),
  ];
}

export function ventStack(x, y, z) {
  return [
    box(x, y + 0.6, z, 0.5, 1.2, 0.5, P.grille, true),
    box(x, y + 1.35, z, 0.72, 0.3, 0.72, P.dark, false),
  ];
}

// Roof access hutch — gives a rooftop an obvious "you came from in there" read.
export function roofHutch(x, y, z, face = 's') {
  const geo = [box(x, y + 1.2, z, 2.6, 2.4, 2.4, 0x6f7b86, true), box(x, y + 2.5, z, 2.9, 0.24, 2.7, 0x4a545c, false)];
  const dz = face === 's' ? 1.22 : -1.22;
  geo.push(box(x, y + 1.05, z + dz, 1.1, 2.1, 0.1, 0x3a2f26, false));
  return geo;
}

// Road centre line. Top at 0.03 so it is never coplanar with the street's y=0 top face.
export function roadLine(x, z1, z2, dash = 2.4, gap = 2.6, w = 0.3) {
  const geo = [];
  for (let z = Math.min(z1, z2); z < Math.max(z1, z2); z += dash + gap) {
    geo.push(box(x, 0.015, z + dash / 2, w, 0.03, dash, 0x8e8a70, false));
  }
  return geo;
}

export function crosswalk(z, x1, x2, bars = 7) {
  const geo = [];
  const span = x2 - x1;
  for (let i = 0; i < bars; i++) {
    geo.push(box(x1 + (i + 0.5) * (span / bars), 0.015, z, span / bars * 0.5, 0.03, 3.4, 0x8f8d80, false));
  }
  return geo;
}

// Utility pole with a catenary-ish sag approximated by segments. Non-solid throughout.
export function poleWire(x1, z1, x2, z2, h = 7.5, segs = 6) {
  const geo = [stand(x1, z1, 0.2, h, 0.2, P.rust), box(x1, h - 0.6, z1, 1.8, 0.12, 0.12, P.rust)];
  const len = Math.hypot(x2 - x1, z2 - z1);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const sag = s => h - 0.5 - Math.sin(s * Math.PI) * 0.9;
    const mx = x1 + (x2 - x1) * (t0 + t1) / 2, mz = z1 + (z2 - z1) * (t0 + t1) / 2;
    const y0 = sag(t0), y1 = sag(t1);
    geo.push(box(mx, (y0 + y1) / 2, mz, Math.abs(x2 - x1) / segs + 0.06, Math.abs(y1 - y0) + 0.06, Math.abs(z2 - z1) / segs + 0.06, P.dark, false));
  }
  return geo;
}

export function awning(x, z, w, d, y = 3.0, color = 0x7a3b3b) {
  return [box(x, y, z, w, 0.14, d, color, false), box(x, y - 0.35, z, w, 0.06, 0.08, P.pole, false)];
}

// ---------- interiors ----------
// A room lit only by scene ambient has no shape at all: every wall returns the same value
// and the eye gets no cue about volume. Outdoors the sun does this work; indoors the roof
// blocks it. So interiors need local sources, and that means geo builders have to be able
// to emit lights as well as boxes.
//
// Collected here rather than returned, because every prop helper's contract is "returns a
// geo array" and threading a second return value through dozens of call sites would be
// worse. Drain with takeLights() immediately after building a level's geo.
let pendingLights = [];
export function takeLights() { const l = pendingLights; pendingLights = []; return l; }

// Flush-mounted ceiling panel. y is the CEILING height, not the fixture height.
export function ceilingLight(x, y, z, opts = {}) {
  const warm = opts.color ?? 0xffe4b8;
  const w = opts.w ?? 1.3, d = opts.d ?? 0.4;
  pendingLights.push({
    pos: [x, y - 0.3, z], color: warm,
    intensity: opts.intensity ?? 4.5, distance: opts.distance ?? 8.5,
  });
  return [
    box(x, y - 0.07, z, w, 0.12, d, P.dark, false),
    box(x, y - 0.17, z, w - 0.16, 0.06, d - 0.1, warm, false, true),
  ];
}

// Bare bulb on a cord: reads as derelict, and the cord gives a vertical the eye can read.
export function hangingBulb(x, y, z, drop = 0.7, opts = {}) {
  const by = y - drop;
  pendingLights.push({
    pos: [x, by - 0.1, z], color: opts.color ?? 0xffdca8,
    intensity: opts.intensity ?? 3.2, distance: opts.distance ?? 7,
  });
  return [
    box(x, y - drop / 2, z, 0.03, drop, 0.03, P.dark, false),
    box(x, by - 0.08, z, 0.16, 0.16, 0.16, 0xffdca8, false, true),
  ];
}

export function exitSign(x, y, z, rot = false) {
  return [
    box(x, y, z, rot ? 0.06 : 0.5, 0.22, rot ? 0.5 : 0.06, 0x1f4a2a, false),
    box(x + (rot ? 0.04 : 0), y, z + (rot ? 0 : 0.04), rot ? 0.03 : 0.42, 0.15, rot ? 0.42 : 0.03, 0x6effa8, false, true),
  ];
}

// Skirting along a wall run. Cheap, and it is what stops a floor/wall junction reading as
// two flat planes butted together — the single highest value-per-box interior detail.
export function baseboard(x1, z1, x2, z2, color = 0x3d444a, h = 0.14, out = 0.03) {
  const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const len = Math.hypot(x2 - x1, z2 - z1);
  return [box(cx, h / 2 + 0.005, cz, alongX ? len : 0.1 + out, h, alongX ? 0.1 + out : len, color, false)];
}

// Chair rail / wainscot band: breaks a 3m wall into two horizontal zones so it has scale.
export function wainscot(x1, z1, x2, z2, y = 1.0, color = 0x4a525a) {
  const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const len = Math.hypot(x2 - x1, z2 - z1);
  return [box(cx, y, cz, alongX ? len : 0.13, 0.09, alongX ? 0.13 : len, color, false)];
}

// Frame around a doorway opening. wall() leaves a bare rectangular hole otherwise.
export function doorFrame(x, z, rot = false, w = 1.6, h = 2.4, color = 0x5b4a3c) {
  const t = 0.1, j = 0.13;
  const out = [];
  if (rot) {
    out.push(box(x, h / 2, z - w / 2, j + 0.1, h, t, color, false));
    out.push(box(x, h / 2, z + w / 2, j + 0.1, h, t, color, false));
    out.push(box(x, h + 0.06, z, j + 0.1, t, w + t * 2, color, false));
  } else {
    out.push(box(x - w / 2, h / 2, z, t, h, j + 0.1, color, false));
    out.push(box(x + w / 2, h / 2, z, t, h, j + 0.1, color, false));
    out.push(box(x, h + 0.06, z, w + t * 2, t, j + 0.1, color, false));
  }
  return out;
}

// Furniture is NON-SOLID on purpose. Procedurally scattered solids sit exactly at capsule
// height, so they swallow enemy and hostage spawn points and carve holes in the navgrid the
// AI then refuses to path through. Walking through a desk looks wrong; being ejected six
// metres through a wall, or a hostage stuck inside a filing cabinet, breaks the mission.
// Cover is what crate() and barrier() are for, and those are placed by hand.
export function desk(x, z, rot = false, color = 0x6b563d) {
  const w = rot ? 0.75 : 1.6, d = rot ? 1.6 : 0.75;
  return [
    box(x, 0.74, z, w, 0.07, d, color, false),
    box(x, 0.37, z, rot ? 0.6 : 0.12, 0.72, rot ? 0.12 : 0.6, 0x4a3c2c, false),
    box(x + (rot ? 0 : w / 2 - 0.2), 0.5, z + (rot ? d / 2 - 0.2 : 0), rot ? 0.6 : 0.36, 0.4, rot ? 0.36 : 0.6, 0x5a4936, false),
  ];
}

export function chair(x, z, rot = false, color = 0x45403a) {
  return [
    box(x, 0.44, z, 0.44, 0.06, 0.44, color, false),
    box(x + (rot ? -0.19 : 0), 0.72, z + (rot ? 0 : -0.19), rot ? 0.06 : 0.44, 0.5, rot ? 0.44 : 0.06, color, false),
    box(x, 0.21, z, 0.1, 0.42, 0.1, P.pole, false),
  ];
}

export function table(x, z, w = 1.2, d = 0.8, color = 0x6b563d) {
  const out = [box(x, 0.72, z, w, 0.08, d, color, false)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    out.push(box(x + sx * (w / 2 - 0.1), 0.34, z + sz * (d / 2 - 0.1), 0.08, 0.68, 0.08, 0x4a3c2c, false));
  }
  return out;
}

export function shelf(x, z, rot = false, h = 1.9, color = 0x574434) {
  const w = rot ? 0.34 : 1.1, d = rot ? 1.1 : 0.34;
  const out = [
    box(x, h / 2, z, rot ? 0.06 : w, h, rot ? d : 0.06, color, false),
  ];
  for (let sy = 0.4; sy < h; sy += 0.45) out.push(box(x, sy, z, w, 0.05, d, color, false));
  return out;
}

export function cabinet(x, z, rot = false, h = 1.4, color = 0x4d565d) {
  const w = rot ? 0.5 : 0.9, d = rot ? 0.9 : 0.5;
  const out = [box(x, h / 2, z, w, h, d, color, false)];
  for (let dy = 0.28; dy < h - 0.1; dy += 0.34) {
    out.push(box(x + (rot ? (d ? 0.26 : 0) : 0), dy, z + (rot ? 0 : 0.26), rot ? 0.02 : w - 0.12, 0.24, rot ? d - 0.12 : 0.02, 0x39424a, false));
  }
  return out;
}

export function mattress(x, z, rot = false) {
  const w = rot ? 0.9 : 1.9, d = rot ? 1.9 : 0.9;
  return [box(x, 0.11, z, w, 0.22, d, 0x8e8574, false), box(x, 0.26, z, w * 0.35, 0.1, d * 0.6, 0x6d6a60, false)];
}

export function rug(x, z, w = 2.4, d = 1.6, color = 0x5a3f3a) {
  return [box(x, 0.02, z, w, 0.04, d, color, false)];
}

export function radiator(x, z, rot = false) {
  const w = rot ? 0.16 : 1.0, d = rot ? 1.0 : 0.16;
  const out = [box(x, 0.42, z, w, 0.6, d, 0x8d9299, false)];
  for (let i = -3; i <= 3; i++) {
    out.push(rot ? box(x + 0.1, 0.42, z + i * 0.13, 0.03, 0.56, 0.05, 0x767c83, false)
                 : box(x + i * 0.13, 0.42, z + 0.1, 0.05, 0.56, 0.03, 0x767c83, false));
  }
  return out;
}

// Conduit / pipe run near the ceiling. Gives an interior an industrial read and, more
// usefully, a strong horizontal line that catches the local lights.
export function pipes(x1, z1, x2, z2, y, n = 2, color = 0x6a5f52) {
  const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const len = Math.hypot(x2 - x1, z2 - z1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * 0.22;
    out.push(alongX
      ? box(cx, y, cz + off, len, 0.11, 0.11, color, false)
      : box(cx + off, y, cz, 0.11, 0.11, len, color, false));
  }
  for (let s = -len / 2 + 1.5; s < len / 2; s += 3.2) {
    out.push(alongX
      ? box(cx + s, y + 0.14, cz, 0.06, 0.18, 0.5, P.pole, false)
      : box(cx, y + 0.14, cz + s, 0.5, 0.18, 0.06, P.pole, false));
  }
  return out;
}

// ---------- wall decoration ----------
// A single flat rectangle on a wall does not read as a poster, it reads as a differently
// coloured patch of wall. What makes printed matter legible is layering: a border, an image
// block that is not the same colour as the border, and a couple of bars where the type goes.
// Four boxes instead of one, and the wall stops being blank.
const POSTER_INK = [
  [0x8f2f2a, 0xe0d6bd],   // red propaganda over off-white stock
  [0x1f4a6b, 0xd8dee4],   // blue notice
  [0x6b5a1f, 0xe6dcc0],   // aged ochre
  [0x2d5a3a, 0xdfe6d8],   // green public-health poster
  [0x3a2d5a, 0xdcd6e6],   // purple gig flyer
  [0x1d2126, 0xc9ccd1],   // black-and-white newsprint
];

// rot=true means the piece lies in the Z/Y plane (mounted on a wall that faces along X).
//
// `dir` is which way the wall faces: +1 for a surface whose front is toward +X (rot) or +Z
// (flat), -1 for the opposite. It is not cosmetic. Every one of these helpers stacks its
// layers a couple of centimetres PROUD of the backing plate, and with the sign wrong the ink
// block, the pinned slips and the clock hands all stack INTO the wall instead of out of it —
// so they either vanish or hang in mid-air behind the thing they belong to.
export function poster(x, z, rot = false, y = 1.7, color = null, seed = 5, dir = 1) {
  const R = rng(seed + Math.round(x * 31 + z * 17));
  const pal = POSTER_INK[Math.floor(R() * POSTER_INK.length)];
  const ink = color ?? pal[0], stock = pal[1];
  const w = 0.62 + R() * 0.34, h = 0.86 + R() * 0.42;
  const t = 0.03, ft = 0.03 * dir;
  const wide = a => (rot ? t : a), deep = a => (rot ? a : t);
  const ox = rot ? ft : 0, oz = rot ? 0 : ft;
  const out = [
    // paper, then the ink block inset inside it, sitting a hair proud so it never z-fights
    box(x, y, z, wide(w), h, deep(w), stock, false),
    box(x + ox, y + h * 0.14, z + oz, wide(w * 0.8), h * 0.5, deep(w * 0.8), ink, false),
  ];
  // type bars under the image: two or three, decreasing in width like a headline and subhead
  const bars = 2 + Math.floor(R() * 2);
  for (let i = 0; i < bars; i++) {
    const bw = w * (0.7 - i * 0.16);
    out.push(box(x + ox, y - h * (0.16 + i * 0.11), z + oz, wide(bw), h * 0.055, deep(bw), ink, false));
  }
  // some are torn: a corner missing is the cheapest possible "this place is not maintained"
  if (R() < 0.35) out.push(box(x + ox * 1.4 + (rot ? 0 : w * 0.32), y + h * 0.36, z + oz * 1.4 + (rot ? w * 0.32 : 0),
    wide(w * 0.3), h * 0.22, deep(w * 0.3), stock, false));
  return out;
}

// A run of posters down a wall, fly-posted over each other at slightly different heights.
// This is what actually fills a corridor: one poster is a decision, six is a place.
export function posterWall(x1, z1, x2, z2, rot = false, seed = 11, n = 4, y = 1.65, dir = 1) {
  const R = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n + (R() - 0.5) * 0.12;
    const px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
    out.push(...poster(px, pz, rot, y + (R() - 0.5) * 0.5, null, seed * 7 + i * 13, dir));
  }
  return out;
}

// Cork notice board: frame, backing, and pinned slips. Axis-aligned boxes cannot rotate, so
// break the grid by varying slip size and offset rather than angle.
export function noticeBoard(x, z, rot = false, y = 1.6, w = 1.5, h = 1.0, seed = 17, dir = 1) {
  const R = rng(seed);
  const t = 0.05;
  const wide = a => (rot ? t : a), deep = a => (rot ? a : t);
  const out = [
    box(x, y, z, wide(w + 0.08), h + 0.08, deep(w + 0.08), 0x4a3a2a, false),
    box(x + (rot ? 0.02 * dir : 0), y, z + (rot ? 0 : 0.02 * dir), wide(w), h, deep(w), 0x6b5a44, false),
  ];
  for (let i = 0; i < 7; i++) {
    const sw = 0.16 + R() * 0.16, sh = 0.14 + R() * 0.16;
    const off = (R() - 0.5) * (w - sw - 0.1), oy = (R() - 0.5) * (h - sh - 0.08);
    out.push(box(x + (rot ? 0.045 * dir : off), y + oy, z + (rot ? off : 0.045 * dir),
      wide(sw), sh, deep(sw), [0xdcd8c8, 0xd0dae0, 0xe0d6b8, 0xc8ccd2][Math.floor(R() * 4)], false));
  }
  return out;
}

// Dry-wipe board / floor plan. Reads as an office or a briefing room instantly.
export function whiteboard(x, z, rot = false, y = 1.65, w = 1.9, h = 1.1, dir = 1) {
  const t = 0.05;
  const wide = a => (rot ? t : a), deep = a => (rot ? a : t);
  const o1 = 0.02 * dir, o2 = 0.04 * dir;
  const out = [
    box(x, y, z, wide(w + 0.06), h + 0.06, deep(w + 0.06), 0x8d949b, false),
    box(x + (rot ? o1 : 0), y, z + (rot ? 0 : o1), wide(w), h, deep(w), 0xd8dce0, false),
    box(x + (rot ? o2 : 0), y - h / 2 - 0.05, z + (rot ? 0 : o2), wide(w * 0.9), 0.05, deep(w * 0.9), 0x9aa1a8, false),
  ];
  // scrawl: a few thin dark bars, uneven, which at any distance reads as writing
  for (let i = 0; i < 5; i++) {
    const bw = w * (0.3 + (i % 3) * 0.2);
    const along = -w * 0.2 + (i % 2) * 0.2;
    out.push(box(x + (rot ? o2 : along), y + h * 0.3 - i * h * 0.15, z + (rot ? along : o2),
      wide(bw), 0.035, deep(bw), 0x2b3a4a, false));
  }
  return out;
}

export function wallClock(x, z, rot = false, y = 2.3, r = 0.15, dir = 1) {
  const t = 0.05;
  const wide = a => (rot ? t : a), deep = a => (rot ? a : t);
  const o1 = 0.02 * dir, o2 = 0.04 * dir;
  return [
    box(x, y, z, wide(r * 2), r * 2, deep(r * 2), 0x2a3038, false),
    box(x + (rot ? o1 : 0), y, z + (rot ? 0 : o1), wide(r * 1.6), r * 1.6, deep(r * 1.6), 0xe4e8ec, false),
    box(x + (rot ? o2 : 0), y + r * 0.35, z + (rot ? 0 : o2), wide(0.02), r * 0.8, deep(0.02), 0x1d2126, false),
    box(x + (rot ? o2 : r * 0.3), y, z + (rot ? r * 0.3 : o2), wide(r * 0.7), 0.02, deep(r * 0.7), 0x1d2126, false),
  ];
}

// Spray paint. Flat, garish, non-solid, and clustered rather than centred, because real
// graffiti is applied by someone standing on the ground with their arm out.
const TAG_COLORS = [0xc4452f, 0x2f7cc4, 0xd8c22f, 0x4fc46b, 0xb44fc4, 0xe0e4e8];
export function graffiti(x, z, rot = false, seed = 23, scale = 1, dir = 1) {
  const R = rng(seed);
  const out = [];
  const col = TAG_COLORS[Math.floor(R() * TAG_COLORS.length)];
  const t = 0.025;
  const y0 = 0.9 + R() * 0.8;
  const n = 4 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) {
    const bw = (0.18 + R() * 0.5) * scale, bh = (0.12 + R() * 0.45) * scale;
    const off = (R() - 0.5) * 2.2 * scale;
    // Every third stroke sits a whisker further out, so overlapping strokes layer in a fixed
    // order instead of coplanar-fighting where two of them cross.
    const p = (i % 3 === 0 ? 0.008 : 0) * dir;
    out.push(box(x + (rot ? p : off), y0 + (R() - 0.5) * 0.6, z + (rot ? off : p),
      rot ? t : bw, bh, rot ? bw : t, c(i, R, col), false));
  }
  return out;
}
function c(i, R, col) {
  return i === 0 ? col : (R() < 0.3 ? TAG_COLORS[Math.floor(R() * TAG_COLORS.length)] : col);
}

// Framed photo / small artwork, for the rooms that should read as somebody's home.
export function picture(x, z, rot = false, y = 1.75, w = 0.42, h = 0.32, dir = 1) {
  const t = 0.04;
  const wide = a => (rot ? t : a), deep = a => (rot ? a : t);
  const o = 0.015 * dir;
  return [
    box(x, y, z, wide(w), h, deep(w), 0x3a2d22, false),
    box(x + (rot ? o : 0), y, z + (rot ? 0 : o), wide(w * 0.82), h * 0.78, deep(w * 0.82), 0x6b7a6b, false),
  ];
}

// Scattered floor rubble. Non-solid so it never snags the character controller or the AI.
export function debris(x, z, radius = 2.2, n = 7, seed = 3) {
  const R = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, r = R() * radius;
    const s = 0.1 + R() * 0.26;
    const tone = new THREE.Color(0x6d7278).multiplyScalar(0.7 + R() * 0.5).getHex();
    out.push(box(x + Math.cos(a) * r, s * 0.35, z + Math.sin(a) * r, s, s * 0.6, s * (0.6 + R() * 0.8), tone, false));
  }
  return out;
}

export function shopSign(x, z, w = 2.2, y = 3.4, rot = false) {
  return [
    box(x, y, z, rot ? 0.12 : w, 0.7, rot ? w : 0.12, P.dark, false),
    box(x + (rot ? 0.09 : 0), y, z + (rot ? 0 : 0.09), rot ? 0.05 : w - 0.3, 0.44, rot ? w - 0.3 : 0.05, P.sign, false, true),
  ];
}
