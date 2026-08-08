// Crossroad hamlets and lone farmsteads for the steppe DEM — the built half of the
// shelterbelt country. Small plastered khata cottages, long barns, brick ruins, plank
// fences, wells and haystacks, most of them worked over by artillery: this is what
// actually stands at the road junctions the treelines lead to.
//
// Same doctrine as trees.js: a declarative plan on the level def, every building and
// fence post stamped onto its own sampled terrain, one merged vertex-coloured flat-
// shaded mesh, and invisible solid boxes for the wall masses (walls stop bullets and
// bodies AND aircraft — unlike canopy, they are in `solids`).
import * as THREE from 'three';
import { terrainSampler } from './terrain.js';
import { prims } from './trees.js';

const { rng, hash, makeAcc, vert, tube, blob } = prims;

// ---------------------------------------------------------------- palette (sRGB 0-255)
const PLASTERS = [[214, 208, 196], [172, 188, 196], [210, 196, 162], [198, 198, 188]];
const ROOFS = [[126, 78, 50], [88, 92, 98], [116, 120, 124], [104, 84, 60]];
const BRICK = [122, 78, 58];
const WOOD = [92, 76, 54];
const WOOD_DARK = [68, 56, 42];
const OPENING = [16, 17, 20];
const CHAR = [40, 37, 33];
const PAD = [88, 79, 60];
const STONE = [118, 116, 108];
const HAY = [148, 124, 74];
const RUBBLE = [104, 96, 88];

// ---------------------------------------------------------------- local geometry
function quad(acc, a, b, c, d, src, shade) {
  vert(acc, ...a, src, shade); vert(acc, ...b, src, shade); vert(acc, ...c, src, shade);
  vert(acc, ...a, src, shade); vert(acc, ...c, src, shade); vert(acc, ...d, src, shade);
}

// Everything below works in a building-local frame: u along the ridge, v across it,
// rotated by yaw about (x, z) and sitting on the pad level yb.
function frame(x, z, yaw) {
  const cu = Math.cos(yaw), su = Math.sin(yaw);
  return (u, y, v) => [x + u * cu - v * su, y, z + u * su + v * cu];
}

// A wall panel as vertical strips with optional shell-jagged top edge. Grime darkens
// the base course the way rain splash and smoke stain real render.
function wallPanel(acc, R, W, u0, u1, v, yb, h, src, opts = {}) {
  const len = Math.abs(u1 - u0);
  const n = Math.max(1, Math.ceil(len / 1.3));
  const dir = u1 > u0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = u0 + dir * (i / n) * len;
    const b = u0 + dir * ((i + 1) / n) * len;
    const hTop = opts.jagged
      ? h * (0.28 + 0.6 * hash(a, v, h) * (opts.tall ?? 1))
      : h;
    const shade = (0.86 + 0.2 * hash(a, v, 3)) * (opts.charred ? 0.5 : 1);
    quad(acc, W(a, yb, v), W(b, yb, v), W(b, yb + hTop, v), W(a, yb + hTop, v),
      opts.charred ? CHAR : src, shade);
    // darker base course
    quad(acc, W(a, yb, v), W(b, yb, v), W(b, yb + 0.28, v), W(a, yb + 0.28, v),
      opts.charred ? CHAR : src, shade * 0.62);
  }
}

// Dark opening (window/door) proud of the wall plane so it never z-fights.
function opening(acc, W, u, v, yb, y0, w, h, out) {
  const vv = v + out * 0.04;
  quad(acc, W(u - w / 2, yb + y0, vv), W(u + w / 2, yb + y0, vv),
    W(u + w / 2, yb + y0 + h, vv), W(u - w / 2, yb + y0 + h, vv), OPENING, 1);
}

// A wall face with real holes: full-height panels between openings, a sill strip
// under windows, a header over every opening, slim dark jambs framing each hole.
// Openings must be sorted by u and lie inside (u0, u1).
function wallWithOpenings(acc, R, W, u0, u1, v, yb, H, src, openings) {
  let cur = u0;
  for (const o of openings) {
    const a = o.u - o.w / 2, b = o.u + o.w / 2;
    wallPanel(acc, R, W, cur, a, v, yb, H, src);
    if (o.y0 > 0.05) {
      quad(acc, W(a, yb, v), W(b, yb, v), W(b, yb + o.y0, v), W(a, yb + o.y0, v), src, 0.74);
    }
    if (o.y0 + o.h < H - 0.05) {
      quad(acc, W(a, yb + o.y0 + o.h, v), W(b, yb + o.y0 + o.h, v),
        W(b, yb + H, v), W(a, yb + H, v), src, 0.78);
    }
    boxO(acc, W, a, v, yb + o.y0, 0.14, o.h, 0.26, WOOD_DARK, 0.7);
    boxO(acc, W, b, v, yb + o.y0, 0.14, o.h, 0.26, WOOD_DARK, 0.7);
    cur = b;
  }
  wallPanel(acc, R, W, cur, u1, v, yb, H, src);
}

// Small oriented solid box (chimney, posts, well shaft) — all six faces.
function boxO(acc, W, u, v, yb, w, h, d, src, shadeBase = 0.9) {
  const u0 = u - w / 2, u1 = u + w / 2, v0 = v - d / 2, v1 = v + d / 2;
  const y1 = yb + h;
  quad(acc, W(u0, yb, v0), W(u1, yb, v0), W(u1, y1, v0), W(u0, y1, v0), src, shadeBase);
  quad(acc, W(u1, yb, v1), W(u0, yb, v1), W(u0, y1, v1), W(u1, y1, v1), src, shadeBase * 0.92);
  quad(acc, W(u0, yb, v1), W(u0, yb, v0), W(u0, y1, v0), W(u0, y1, v1), src, shadeBase * 0.84);
  quad(acc, W(u1, yb, v0), W(u1, yb, v1), W(u1, y1, v1), W(u1, y1, v0), src, shadeBase * 0.84);
  quad(acc, W(u0, y1, v0), W(u1, y1, v0), W(u1, y1, v1), W(u0, y1, v1), src, shadeBase * 1.05);
}

// Draped dirt yard pad: a fan whose every rim vertex samples the terrain, so the pad
// paints onto the slope exactly like the road ribbons do.
function dirtPad(acc, sample, x, z, r, salt) {
  const SEG = 12;
  const cy = sample(x, z) + 0.06;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const r0 = r * (0.8 + 0.35 * hash(i, salt, 1));
    const r1 = r * (0.8 + 0.35 * hash(i + 1, salt, 1));
    const p0 = [x + Math.cos(a0) * r0, 0, z + Math.sin(a0) * r0];
    const p1 = [x + Math.cos(a1) * r1, 0, z + Math.sin(a1) * r1];
    p0[1] = sample(p0[0], p0[2]) + 0.06;
    p1[1] = sample(p1[0], p1[2]) + 0.06;
    const shade = 0.85 + 0.25 * hash(i, salt, 5);
    vert(acc, x, cy, z, PAD, shade);
    vert(acc, ...p1, PAD, shade);
    vert(acc, ...p0, PAD, shade);
  }
}

// ---------------------------------------------------------------- buildings
// Body dimensions draw from the SAME rng stream in the mesh builder and the collider
// builder, so both see identical footprints. Must stay the first draws per building.
function bodyDims(R, kind) {
  const barn = kind === 'barn';
  const L = barn ? 10.5 + R() * 2 : 7 + R() * 1.5;
  const D = barn ? 5.4 + R() : 4.4 + R() * 0.8;
  return {
    barn, L, D,
    H: barn ? 3.0 : 2.5,
    RH: barn ? 1.4 : 1.7,
    plaster: barn ? WOOD : PLASTERS[Math.floor(R() * PLASTERS.length)],
    roofC: ROOFS[Math.floor(R() * ROOFS.length)],
    // Doors AND windows are REAL holes in the walls, not painted trim: drones hunt
    // through them for the vehicles and troops hiding inside. The wall and roof mass
    // around each opening stays solid — an armed FPV that misses a hole detonates.
    doorU: (R() - 0.5) * L * 0.3,
    doorW: barn ? 3.0 : 1.2,
    doorH: barn ? 2.4 : 1.9,
  };
}

// Openings per long face, derived deterministically from the door position so the
// mesh builder and the collider builder always agree. Front = the -D/2 road face.
export function faceOpenings(p) {
  const { barn, L, doorU, doorW, doorH } = p;
  const win = (u) => ({ u, w: 1.0, y0: 0.9, h: 1.0 });
  const fits = (o) => o.u - o.w / 2 > -L / 2 + 0.6 && o.u + o.w / 2 < L / 2 - 0.6;
  const front = [{ u: doorU, w: doorW, y0: 0, h: doorH }];
  for (const side of barn ? [1] : [-1, 1]) {
    const o = win(doorU + side * (doorW / 2 + 1.9));
    if (fits(o)) front.push(o);
  }
  const back = (barn ? [win(0)] : [win(-1.3), win(1.3)]).filter(fits);
  return { front: front.sort((a, b) => a.u - b.u), back };
}

// Pad level: highest corner keeps every wall base inside the ground on a slope.
function padLevel(sample, x, z, yaw, L, D) {
  const W = frame(x, z, yaw);
  let yb = -Infinity;
  for (const [cu, cv] of [[-L / 2, -D / 2], [L / 2, -D / 2], [-L / 2, D / 2], [L / 2, D / 2]]) {
    const [wx, , wz] = W(cu, 0, cv);
    yb = Math.max(yb, sample(wx, wz));
  }
  return yb - 0.12;
}

// state: 'intact' | 'damaged' | 'gutted'
function house(acc, R, sample, x, z, yaw, kind, state, salt) {
  const { barn, L, D, H, RH, plaster, roofC, doorU, doorW, doorH } = bodyDims(R, kind);
  const W = frame(x, z, yaw);
  const yb = padLevel(sample, x, z, yaw, L, D);
  dirtPad(acc, sample, x, z, Math.max(L, D) * 0.85 + 2, salt);

  const gutted = state === 'gutted';
  const uh = L / 2, vh = D / 2;

  if (gutted) {
    // Shell-gutted: jagged standing walls, charred inner faces implied by DoubleSide,
    // burnt roof timbers leaning through the interior, rubble spilling out.
    for (const [v, tall] of [[-vh, 1], [vh, 0.8]]) {
      wallPanel(acc, R, W, -uh, uh, v, yb, H, plaster, { jagged: true, tall });
    }
    for (const side of [-1, 1]) {
      const Wg = frame(x, z, yaw + Math.PI / 2);
      wallPanel(acc, R, Wg, -vh, vh, side * uh, yb, H, plaster, { jagged: true, tall: 0.9 });
    }
    for (let i = 0; i < 3; i++) {
      const [ax, , az] = W((R() - 0.5) * L * 0.8, 0, (R() - 0.5) * D * 0.8);
      const [bx, , bz] = W((R() - 0.5) * L, 0, (R() - 0.5) * D * 1.4);
      tube(acc, [[ax, yb + 0.1, az], [bx, yb + H * (0.5 + R() * 0.5), bz]],
        [0.09, 0.05], 4, () => [CHAR, 0.8]);
    }
    for (let i = 0; i < 4; i++) {
      const [rx, , rz] = W((R() - 0.5) * L, 0, (R() - 0.5) * (D + 3));
      blob(acc, rx, yb + 0.25, rz, 0.9 + R() * 0.8, 0.4 + R() * 0.3, 0.9 + R() * 0.8,
        i % 2 ? RUBBLE : BRICK, R() * 100, 0.32);
    }
    return { x, z, yaw, L, D, H: H * 0.55, yb };
  }

  // Standing walls, built in pieces around the real openings: full-height panels
  // between them, sills under windows, headers over everything, dark jambs framing.
  const { front, back } = faceOpenings({ barn, L, doorU, doorW, doorH });
  wallWithOpenings(acc, R, W, -uh, uh, -vh, yb, H, plaster, front);
  wallWithOpenings(acc, R, W, -uh, uh, vh, yb, H, plaster, back);
  if (barn) {
    // one barn door leaf swung open against the wall
    const hinge = doorU + doorW / 2 + 0.1;
    quad(acc, W(hinge, yb, -vh - 1.4), W(hinge, yb, -vh - 0.05),
      W(hinge, yb + doorH - 0.15, -vh - 0.05), W(hinge, yb + doorH - 0.15, -vh - 1.4),
      WOOD, 0.62);
  }
  const Wg = frame(x, z, yaw + Math.PI / 2);
  wallPanel(acc, R, Wg, -vh, vh, -uh, yb, H, plaster);
  wallPanel(acc, R, Wg, -vh, vh, uh, yb, H, plaster);
  // Gable triangles.
  for (const side of [-1, 1]) {
    const shade = 0.82;
    vert(acc, ...W(side * uh, yb + H, -vh), plaster, shade);
    vert(acc, ...W(side * uh, yb + H, vh), plaster, shade);
    vert(acc, ...W(side * uh, yb + H + RH, 0), plaster, shade);
  }
  // Scorch tongue over an opening on damaged buildings.
  if (state === 'damaged') {
    opening(acc, W, doorU, -vh, yb, 1.9, 1.3, 0.8, -1.5);
  }

  // Gable roof with overhang; damaged buildings lose part of one slope and their
  // ridge sags — the classic shelled-roof silhouette.
  const ou = uh + 0.35, ov = vh + 0.3;
  const sag = state === 'damaged' ? 0.35 + R() * 0.3 : 0;
  const ridge = (u) => yb + H + RH - sag * (1 - Math.abs(u) / ou);
  const holeSide = R() < 0.5 ? -1 : 1;
  for (const side of [-1, 1]) {
    const segs = [[-ou, -ou * 0.4], [-ou * 0.4, ou * 0.25], [ou * 0.25, ou]];
    segs.forEach(([a, b], i) => {
      if (state === 'damaged' && side === holeSide && i === 1) {
        // torn rim around the hole
        for (const u of [a, b]) {
          vert(acc, ...W(u, ridge(u) - 0.05, 0), CHAR, 0.9);
          vert(acc, ...W(u + 0.4, yb + H + 0.1, side * ov * 0.6), CHAR, 0.9);
          vert(acc, ...W(u - 0.4, yb + H + 0.1, side * ov * 0.6), CHAR, 0.9);
        }
        return;
      }
      const shade = (0.8 + 0.22 * hash(a, side, salt)) * (side < 0 ? 1 : 0.88);
      quad(acc,
        W(a, yb + H, side * ov), W(b, yb + H, side * ov),
        W(b, ridge(b), 0), W(a, ridge(a), 0), roofC, shade);
    });
  }
  // Chimney on cottages.
  if (!barn) boxO(acc, W, -uh * 0.4, 0, yb + H + RH * 0.4, 0.5, 1.1, 0.5, BRICK, 0.85);
  return { x, z, yaw, L, D, H, yb };
}

// Plank fence around a yard rectangle, post by post on the sampled ground, with war
// gaps and a gate opening. Purely visual — no collider, bullets and bodies pass.
function fenceRect(acc, R, sample, x, z, yaw, w, d, salt) {
  const W = frame(x, z, yaw);
  const edges = [
    [[-w / 2, -d / 2], [w / 2, -d / 2]], [[w / 2, -d / 2], [w / 2, d / 2]],
    [[w / 2, d / 2], [-w / 2, d / 2]], [[-w / 2, d / 2], [-w / 2, -d / 2]],
  ];
  const gateEdge = Math.floor(R() * 4);
  for (let e = 0; e < edges.length; e++) {
    const [[u0, v0], [u1, v1]] = edges[e];
    const len = Math.hypot(u1 - u0, v1 - v0);
    const n = Math.max(2, Math.round(len / 2.2));
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = u0 + (u1 - u0) * t, v = v0 + (v1 - v0) * t;
      const [wx, , wz] = W(u, 0, v);
      const gy = sample(wx, wz);
      const gate = e === gateEdge && t > 0.35 && t < 0.62;
      const gap = hash(i, e, salt) < 0.14;
      if (!gate) {
        boxO(acc, frame(wx, wz, yaw), 0, 0, gy - 0.05, 0.14, 1.25, 0.14, WOOD_DARK, 0.85);
      }
      if (prev && !gate && !gap) {
        for (const railH of [0.55, 1.0]) {
          const [px, py, pz] = prev;
          quad(acc, [px, py + railH, pz], [wx, gy + railH, wz],
            [wx, gy + railH + 0.16, wz], [px, py + railH + 0.16, pz],
            WOOD, 0.75 + 0.25 * hash(i, e, salt + 1));
        }
      }
      prev = gate ? null : [wx, gy, wz];
    }
  }
}

function wellAt(acc, sample, x, z, salt) {
  const gy = sample(x, z);
  const W = frame(x, z, salt);
  boxO(acc, W, 0, 0, gy - 0.05, 1.1, 0.8, 1.1, STONE, 0.9);
  boxO(acc, W, -0.65, 0, gy, 0.12, 2.0, 0.12, WOOD_DARK, 0.8);
  boxO(acc, W, 0.65, 0, gy, 0.12, 2.0, 0.12, WOOD_DARK, 0.8);
  quad(acc, W(-0.85, gy + 1.9, -0.8), W(0.85, gy + 1.9, -0.8),
    W(0.85, gy + 2.25, 0), W(-0.85, gy + 2.25, 0), ROOFS[0], 0.85);
  quad(acc, W(-0.85, gy + 1.9, 0.8), W(0.85, gy + 1.9, 0.8),
    W(0.85, gy + 2.25, 0), W(-0.85, gy + 2.25, 0), ROOFS[0], 0.75);
}

// ---------------------------------------------------------------- layout
function nearAvoid(x, z, avoid, extra) {
  for (const a of avoid) {
    if (a.at) {
      if (Math.hypot(x - a.at[0], z - a.at[1]) < a.r + extra) return true;
      continue;
    }
    const pts = a.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const abx = bx - ax, abz = bz - az;
      const t = Math.max(0, Math.min(1,
        ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz || 1)));
      if (Math.hypot(x - (ax + abx * t), z - (az + abz * t)) < a.half + extra) return true;
    }
  }
  return false;
}

// Face the nearest road: buildings on a village street front onto it.
function yawToward(x, z, roads, R) {
  let best = null, bestD = Infinity;
  for (const run of roads || []) {
    if ((run.width ?? 7) < 5) continue;
    const pts = run.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const abx = bx - ax, abz = bz - az;
      const t = Math.max(0, Math.min(1,
        ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz || 1)));
      const px = ax + abx * t, pz = az + abz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestD) { bestD = d; best = [px, pz]; }
    }
  }
  if (!best || bestD > 60) return R() * Math.PI * 2;
  // Door face is -v (local south); aim it at the road point.
  return Math.atan2(best[1] - z, best[0] - x) + Math.PI / 2;
}

// Deterministic building list — shared by the mesh builder and the collider builder.
function layout(plan, seed) {
  const avoid = plan.avoid || [];
  const out = [];
  const clearOf = (x, z) => {
    if (nearAvoid(x, z, avoid, 6)) return false;
    return out.every(b => Math.hypot(b.x - x, b.z - z) > 14);
  };
  (plan.settlements || []).forEach((s, si) => {
    const R = rng((seed * 6151 + si * 947) >>> 0);
    const r = s.r ?? 38;
    const want = s.count ?? 6;
    let placed = 0;
    for (let attempt = 0; attempt < want * 10 && placed < want; attempt++) {
      const a = R() * Math.PI * 2;
      const d = 9 + Math.sqrt(R()) * r;
      const x = s.at[0] + Math.cos(a) * d, z = s.at[1] + Math.sin(a) * d;
      if (!clearOf(x, z)) continue;
      const ruinP = s.ruin ?? 0.5;
      const state = R() < ruinP ? (R() < 0.5 ? 'damaged' : 'gutted') : 'intact';
      out.push({
        x, z, yaw: yawToward(x, z, plan.roads, R),
        kind: R() < 0.28 ? 'barn' : 'khata', state,
        fence: R() < 0.35, well: false, hay: R() < 0.2,
      });
      placed++;
    }
  });
  (plan.farms || []).forEach((f, fi) => {
    const R = rng((seed * 24593 + fi * 4241) >>> 0);
    const yaw = f.yaw ?? R() * Math.PI * 2;
    const ruinP = f.ruin ?? 0.35;
    const state = () => (R() < ruinP ? (R() < 0.5 ? 'damaged' : 'gutted') : 'intact');
    out.push({ x: f.at[0], z: f.at[1], yaw, kind: 'khata', state: state(),
      fence: true, well: true, hay: true, yard: [26, 20] });
    out.push({ x: f.at[0] + Math.cos(yaw) * 16, z: f.at[1] + Math.sin(yaw) * 16,
      yaw: yaw + Math.PI / 2, kind: 'barn', state: state(),
      fence: false, well: false, hay: R() < 0.6 });
  });
  return out;
}

// ---------------------------------------------------------------- builders
export function buildHamlet(def, plan, seed) {
  const sample = terrainSampler(def);
  const acc = makeAcc();
  layout(plan, seed).forEach((b, i) => {
    const R = rng((seed * 31013 + i * 613) >>> 0);
    house(acc, R, sample, b.x, b.z, b.yaw, b.kind, b.state, i * 17 + seed);
    if (b.fence) {
      const [yw, yd] = b.yard || [16 + R() * 6, 12 + R() * 5];
      fenceRect(acc, R, sample, b.x, b.z, b.yaw, yw, yd, i * 29 + 3);
    }
    if (b.well) wellAt(acc, sample, b.x + Math.cos(b.yaw + 2.2) * 6, b.z + Math.sin(b.yaw + 2.2) * 6, i);
    if (b.hay) {
      const hx = b.x + Math.cos(b.yaw - 2.4) * 8, hz = b.z + Math.sin(b.yaw - 2.4) * 8;
      blob(acc, hx, sample(hx, hz) + 0.7, hz, 1.6 + R(), 1.1 + R() * 0.5, 1.6 + R(), HAY, i * 7, 0.25);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(acc.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(acc.colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0.03,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'terrain-hamlets';
  mesh.userData.dispose = () => { geometry.dispose(); material.dispose(); };
  return mesh;
}

// Gutted shells are roofless and hollow — Russians hide vehicles and troops in them,
// so drones must be able to drop inside. Instead of one sealed footprint box, each
// standing wall strip gets its own box replicating wallPanel's jagged silhouette
// (same hash, same 1.3u strips), leaving the interior open from above.
function guttedWallBoxes(out, sample, x, z, yaw, L, D, H) {
  const yb = padLevel(sample, x, z, yaw, L, D);
  const walls = [
    { fy: yaw, u0: -L / 2, u1: L / 2, v: -D / 2, tall: 1 },
    { fy: yaw, u0: -L / 2, u1: L / 2, v: D / 2, tall: 0.8 },
    { fy: yaw + Math.PI / 2, u0: -D / 2, u1: D / 2, v: -L / 2, tall: 0.9 },
    { fy: yaw + Math.PI / 2, u0: -D / 2, u1: D / 2, v: L / 2, tall: 0.9 },
  ];
  for (const { fy, u0, u1, v, tall } of walls) {
    const W = frame(x, z, fy);
    const len = u1 - u0;
    const n = Math.max(1, Math.ceil(len / 1.3));
    const c = Math.abs(Math.cos(fy)), s = Math.abs(Math.sin(fy));
    const seg = len / n;
    for (let i = 0; i < n; i++) {
      const a = u0 + (i / n) * len;
      const hTop = H * (0.28 + 0.6 * hash(a, v, H) * tall);
      const [wx, , wz] = W(a + seg / 2, 0, v);
      out.push([wx, yb + hTop / 2, wz,
        seg * c + 0.4 * s, hTop, seg * s + 0.4 * c, 0x000000, true, false, false]);
    }
  }
}

// Standing buildings are hollow shells too, not sealed blocks: the Russians park
// vehicles and troops inside, so a drone must fit through the doorway. Walls (with a
// real gap at the door), a header over the door, and the gable roof as stacked slabs
// are all solid — the only way in is the opening.
function standingBoxes(out, sample, b) {
  const { L, D, H, RH } = b;
  const yb = padLevel(sample, b.x, b.z, b.yaw, L, D);
  // Oriented run chunked into short boxes so rotated AABBs stay snug to the geometry.
  const chunk = (fy, u0, u1, v, y0, h, thick, step = 1.3) => {
    const len = u1 - u0;
    if (len < 0.05 || h < 0.05) return;
    const W = frame(b.x, b.z, fy);
    const n = Math.max(1, Math.ceil(len / step));
    const c = Math.abs(Math.cos(fy)), s = Math.abs(Math.sin(fy));
    const seg = len / n;
    for (let i = 0; i < n; i++) {
      const [wx, , wz] = W(u0 + (i + 0.5) * seg, 0, v);
      out.push([wx, yb + y0 + h / 2, wz,
        seg * c + thick * s, h, seg * s + thick * c, 0x000000, true, false, false]);
    }
  };
  // Long faces carry the same holes the mesh does: solid between openings, a sill
  // box under each window, a header box over every opening. Doors and windows are
  // genuinely open — a drone threads them, anything else it touches is wall.
  const face = (v, openings) => {
    let cur = -L / 2;
    for (const o of openings) {
      const a = o.u - o.w / 2, e = o.u + o.w / 2;
      chunk(b.yaw, cur, a, v, 0, H, 0.4);
      if (o.y0 > 0.05) chunk(b.yaw, a, e, v, 0, o.y0, 0.4);
      chunk(b.yaw, a, e, v, o.y0 + o.h, H - o.y0 - o.h, 0.4);
      cur = e;
    }
    chunk(b.yaw, cur, L / 2, v, 0, H, 0.4);
  };
  const { front, back } = faceOpenings(b);
  face(-D / 2, front);
  face(D / 2, back);
  chunk(b.yaw + Math.PI / 2, -D / 2, D / 2, -L / 2, 0, H, 0.4);
  chunk(b.yaw + Math.PI / 2, -D / 2, D / 2, L / 2, 0, H, 0.4);
  // Gable roof approximated by two stacked slabs: full-depth eaves course, then a
  // narrower ridge course. Damaged roofs keep solid colliders — a hole in the art is
  // still rafters and sheet to an airframe.
  chunk(b.yaw, -L / 2 - 0.35, L / 2 + 0.35, 0, H, RH * 0.55, D + 0.6, 3);
  chunk(b.yaw, -L / 2 - 0.35, L / 2 + 0.35, 0, H + RH * 0.55, RH * 0.45, D * 0.55, 3);
}

// Deterministic building list WITH body/door parameters — same rng stream the mesh
// builder consumes, so footprints and doorways match exactly. Also the QA hook.
export function hamletLayout(plan, seed) {
  return layout(plan, seed).map((b, i) => {
    const R = rng((seed * 31013 + i * 613) >>> 0);
    return { ...b, ...bodyDims(R, b.kind) };
  });
}

// Invisible solids: gutted shells get jagged open wall stubs, standing buildings get
// hollow wall-and-roof shells with the doorway left open.
export function hamletColliders(def, plan, seed) {
  const sample = terrainSampler(def);
  const out = [];
  for (const b of hamletLayout(plan, seed)) {
    if (b.state === 'gutted') guttedWallBoxes(out, sample, b.x, b.z, b.yaw, b.L, b.D, b.H);
    else standingBoxes(out, sample, b);
  }
  return out;
}
