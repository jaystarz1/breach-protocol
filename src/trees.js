// Steppe vegetation: real trees for the shelterbelt country the DEM depicts.
//
// Eastern-Ukraine field belts (лісосмуги) are 2-3 staggered rows of black locust mixed
// with birch, poplar and pine over a caragana/honeysuckle shrub base, with low hedgerow
// scrub along every road shoulder and rail formation. Everything here is built the way
// the roads and rail were: declarative runs on the level def, stamped onto the sampled
// terrain, merged into one vertex-coloured flat-shaded mesh.
//
// The one hard rule: NOTHING long and rigid ever touches the ground. A belt is not a
// 300m prop dropped on undulating land — every trunk, every shrub cluster samples the
// terrain at its own footprint and is planted there, sunk slightly into the grade. The
// merged mesh is a draw-call optimization applied after placement, never before it.
//
// Collision contract: trunks are solid to everything (invisible geo boxes via
// treeTrunkColliders); canopy and shrubs stop only aircraft (foliage AABBs handed to
// drone.js via setDroneFoliage) so gunfire passes through leaves but an airframe cannot.
import * as THREE from 'three';
import { terrainSampler } from './terrain.js';
import { makeBox } from './physics.js';

// ---------------------------------------------------------------- deterministic random
// (rng/hash/acc/vert/tube/blob are shared with the hamlet building kit — see exports.)
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Position-keyed hash: duplicated vertices of a non-indexed template hash identically,
// so jittering a blob never tears its surface open.
function hash(a, b, c) {
  let h = (Math.round(a * 511) * 374761393 + Math.round(b * 511) * 668265263
    + Math.round(c * 511) * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- palette (sRGB 0-255)
const BARK = [74, 61, 46];
const BARK_DARK = [58, 48, 38];
const BIRCH_BARK = [146, 144, 138];
const BIRCH_BAND = [52, 48, 42];
const POPLAR_BARK = [104, 98, 86];
const CHARRED = [42, 38, 34];
const LOCUST_GREEN = [76, 94, 47];
const BIRCH_GREEN = [108, 122, 58];
const POPLAR_GREEN = [82, 98, 50];
const PINE_GREEN = [50, 70, 40];
const SPRUCE_GREEN = [40, 60, 32];
const SHRUB_GREENS = [[70, 85, 45], [61, 75, 41], [78, 88, 44]];

// ---------------------------------------------------------------- geometry accumulator
function makeAcc() {
  return { positions: [], colors: [], color: new THREE.Color() };
}

function vert(acc, x, y, z, src, shade) {
  acc.positions.push(x, y, z);
  acc.color.setRGB(
    Math.min(1, src[0] / 255 * shade),
    Math.min(1, src[1] / 255 * shade),
    Math.min(1, src[2] / 255 * shade),
    THREE.SRGBColorSpace);
  acc.colors.push(acc.color.r, acc.color.g, acc.color.b);
}

// Tapered tube along a bent spine — trunks and branches. Rings are horizontal, which at
// this poly count reads fine even on angled limbs. colorFn(ringIndex) picks the bark
// tone per ring (birch uses it for the dark bands).
function tube(acc, spine, radii, sides, colorFn) {
  const rings = spine.map(([x, y, z], i) => {
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + i * 0.35;
      ring.push([x + Math.cos(a) * radii[i], y, z + Math.sin(a) * radii[i]]);
    }
    return ring;
  });
  for (let i = 0; i < rings.length - 1; i++) {
    const [srcA, shadeA] = colorFn(i);
    const [srcB, shadeB] = colorFn(i + 1);
    for (let k = 0; k < sides; k++) {
      const m = (k + 1) % sides;
      const a = rings[i][k], b = rings[i][m], c = rings[i + 1][k], d = rings[i + 1][m];
      vert(acc, ...a, srcA, shadeA); vert(acc, ...b, srcA, shadeA); vert(acc, ...c, srcB, shadeB);
      vert(acc, ...b, srcA, shadeA); vert(acc, ...d, srcB, shadeB); vert(acc, ...c, srcB, shadeB);
    }
  }
  // Cap the top with a small fan so snags and bare pines do not show a hollow pipe.
  const top = spine[spine.length - 1];
  const [srcT, shadeT] = colorFn(spine.length - 1);
  const lastRing = rings[rings.length - 1];
  for (let k = 0; k < sides; k++) {
    const m = (k + 1) % sides;
    vert(acc, ...lastRing[k], srcT, shadeT * 0.9);
    vert(acc, top[0], top[1] + radii[radii.length - 1] * 0.6, top[2], srcT, shadeT * 0.9);
    vert(acc, ...lastRing[m], srcT, shadeT * 0.9);
  }
}

// Foliage mass: an icosahedron with position-hashed vertex displacement, squashed per
// axis. Lower vertices darken, upper lighten — cheap ambient occlusion that makes the
// canopy read as a lit volume instead of a green ball.
const ICO = new THREE.IcosahedronGeometry(1, 0).attributes.position;
function blob(acc, cx, cy, cz, rx, ry, rz, src, salt, toneJitter = 0.26) {
  for (let i = 0; i < ICO.count; i++) {
    const px = ICO.getX(i), py = ICO.getY(i), pz = ICO.getZ(i);
    const j = 0.74 + 0.52 * hash(px + salt, py - salt, pz + salt * 0.7);
    const wy = cy + py * ry * j;
    const shade = (0.74 + 0.42 * (py * 0.5 + 0.5))
      * (1 - toneJitter / 2 + toneJitter * hash(px - salt, py + salt, pz));
    vert(acc, cx + px * rx * j, wy, cz + pz * rz * j, src, shade);
  }
}

// Sagging-rim cone for spruce tiers.
function droopCone(acc, cx, cy, cz, r, h, src, salt) {
  const SEG = 7;
  const rim = [];
  for (let k = 0; k < SEG; k++) {
    const a = (k / SEG) * Math.PI * 2 + salt;
    const jr = r * (0.82 + 0.36 * hash(k, salt, 3));
    rim.push([cx + Math.cos(a) * jr, cy - 0.16 * h * hash(k, salt, 7), cz + Math.sin(a) * jr]);
  }
  for (let k = 0; k < SEG; k++) {
    const m = (k + 1) % SEG;
    const shade = 0.8 + 0.34 * hash(k, salt, 11);
    vert(acc, ...rim[k], src, shade * 0.78);
    vert(acc, cx, cy + h, cz, src, shade * 1.12);
    vert(acc, ...rim[m], src, shade * 0.78);
  }
}

// ---------------------------------------------------------------- species
// Each is (acc, R, x, y, z, s) with y already the sampled-and-sunk ground height and s
// the per-plant scale. World units are 3.5 m; a mature belt tree tops out around 6u.

function locust(acc, R, x, y, z, s) {
  // Crooked forking trunk, airy irregular canopy with gaps: the belt-dominant acacia.
  const lean = (R() - 0.5) * 0.5 * s;
  const leanZ = (R() - 0.5) * 0.5 * s;
  const spine = [[x, y, z], [x + lean * 0.5, y + 1.5 * s, z + leanZ * 0.5],
    [x + lean, y + 2.9 * s, z + leanZ]];
  tube(acc, spine, [0.2 * s, 0.15 * s, 0.09 * s], 5,
    i => [BARK, 0.82 + 0.3 * hash(x, i, z)]);
  const blobs = 4 + Math.floor(R() * 2);
  const topX = x + lean, topZ = z + leanZ;
  for (let i = 0; i < blobs; i++) {
    const a = R() * Math.PI * 2;
    const d = (0.5 + R() * 1.2) * s;
    const bx = topX + Math.cos(a) * d, bz = topZ + Math.sin(a) * d;
    const by = y + (2.9 + R() * 1.8) * s;
    if (i < 2) {
      tube(acc, [[topX, y + 2.2 * s, topZ], [bx, by - 0.4 * s, bz]],
        [0.07 * s, 0.045 * s], 4, () => [BARK_DARK, 0.9]);
    }
    blob(acc, bx, by, bz, (0.8 + R() * 0.6) * s, (0.6 + R() * 0.45) * s,
      (0.8 + R() * 0.6) * s, LOCUST_GREEN, R() * 100);
  }
}

function birch(acc, R, x, y, z, s) {
  const lean = (R() - 0.5) * 0.6 * s;
  const spine = [[x, y, z], [x + lean * 0.4, y + 1.8 * s, z],
    [x + lean, y + 3.4 * s, z + (R() - 0.5) * 0.3 * s]];
  // White bark broken by dark bands at ring joints.
  tube(acc, spine, [0.13 * s, 0.09 * s, 0.05 * s], 5,
    i => hash(x, i * 3 + 1, z) < 0.6
      ? [BIRCH_BARK, 0.92 + 0.16 * hash(z, i, x)]
      : [BIRCH_BAND, 0.9]);
  const blobs = 2 + Math.floor(R() * 2);
  for (let i = 0; i < blobs; i++) {
    const a = R() * Math.PI * 2;
    const d = (0.25 + R() * 0.7) * s;
    blob(acc, x + lean + Math.cos(a) * d, y + (3.1 + R() * 1.1) * s,
      z + Math.sin(a) * d, (0.65 + R() * 0.5) * s, (0.55 + R() * 0.4) * s,
      (0.65 + R() * 0.5) * s, BIRCH_GREEN, R() * 100, 0.34);
  }
}

function poplar(acc, R, x, y, z, s) {
  // The Lombardy column planted along every road and rail line.
  tube(acc, [[x, y, z], [x, y + 1.4 * s, z]], [0.15 * s, 0.11 * s], 5,
    () => [POPLAR_BARK, 0.85 + 0.2 * hash(x, 5, z)]);
  blob(acc, x, y + 3.6 * s, z, (0.85 + R() * 0.25) * s, (2.5 + R() * 0.6) * s,
    (0.85 + R() * 0.25) * s, POPLAR_GREEN, R() * 100, 0.2);
}

function pine(acc, R, x, y, z, s) {
  // Plantation pine: bare stem two-thirds up, crown mass on top.
  const lean = (R() - 0.5) * 0.35 * s;
  tube(acc, [[x, y, z], [x + lean * 0.5, y + 2 * s, z], [x + lean, y + 3.7 * s, z]],
    [0.17 * s, 0.12 * s, 0.07 * s], 5,
    i => [i > 0 ? BARK : BARK_DARK, 0.86 + 0.24 * hash(x, i + 9, z)]);
  blob(acc, x + lean, y + 4.1 * s, z, (1.1 + R() * 0.4) * s, (0.65 + R() * 0.3) * s,
    (1.1 + R() * 0.4) * s, PINE_GREEN, R() * 100, 0.22);
  blob(acc, x + lean + (R() - 0.5) * 0.8 * s, y + 3.4 * s, z + (R() - 0.5) * 0.8 * s,
    (0.75 + R() * 0.3) * s, 0.5 * s, (0.75 + R() * 0.3) * s, PINE_GREEN, R() * 100, 0.22);
}

function spruce(acc, R, x, y, z, s) {
  tube(acc, [[x, y, z], [x, y + 1.1 * s, z]], [0.15 * s, 0.1 * s], 5,
    () => [BARK_DARK, 0.85]);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    droopCone(acc, x, y + (0.9 + 2.5 * t) * s, z,
      (1.7 - 1.05 * t) * (0.9 + R() * 0.2) * s, (1.5 - 0.5 * t) * s,
      SPRUCE_GREEN, R() * 10);
  }
}

function shrub(acc, R, x, y, z, s) {
  // Caragana/honeysuckle scrub: the hedgerow and understory unit. No trunk.
  const clumps = 1 + Math.floor(R() * 2.4);
  const src = SHRUB_GREENS[Math.floor(R() * SHRUB_GREENS.length)];
  for (let i = 0; i < clumps; i++) {
    const a = R() * Math.PI * 2;
    const d = R() * 0.5 * s;
    blob(acc, x + Math.cos(a) * d, y + (0.3 + R() * 0.15) * s, z + Math.sin(a) * d,
      (0.5 + R() * 0.4) * s, (0.35 + R() * 0.3) * s, (0.5 + R() * 0.4) * s,
      src, R() * 100, 0.3);
  }
}

function snag(acc, R, x, y, z, s) {
  // Shell-shattered trunk stub — the shelled-treeline garnish, used sparingly.
  const lean = (R() - 0.5) * 0.7 * s;
  const h = (1.6 + R() * 1.2) * s;
  tube(acc, [[x, y, z], [x + lean, y + h, z + (R() - 0.5) * 0.5 * s]],
    [0.17 * s, 0.04 * s], 5, i => [i ? CHARRED : BARK_DARK, 0.8 + 0.2 * R()]);
  if (R() < 0.7) {
    tube(acc, [[x, y + h * 0.55, z], [x + (R() - 0.5) * 2 * s, y + h * 0.35, z + (R() - 0.5) * 2 * s]],
      [0.06 * s, 0.02 * s], 4, () => [CHARRED, 0.85]);
  }
}

const SPECIES = { locust, birch, poplar, pine, spruce, shrub, snag };

// Coarse canopy AABB per species, in units of s: [yCenter, w, h, d]. Trunk-only species
// get no foliage box; the drone hits the trunk collider instead.
const CANOPY_BOX = {
  locust: [3.6, 4.6, 3.4, 4.6],
  birch: [3.5, 3.0, 2.6, 3.0],
  poplar: [3.6, 2.2, 5.6, 2.2],
  pine: [3.8, 3.2, 2.2, 3.2],
  spruce: [2.4, 3.2, 4.0, 3.2],
  shrub: [0.5, 2.0, 1.3, 2.0],
};

// Slim solid trunk box per species, [w, h] in units of s (snags too — hard wood).
const TRUNK_BOX = {
  locust: [0.42, 2.9], birch: [0.3, 3.4], poplar: [0.32, 2.6],
  pine: [0.36, 3.7], spruce: [0.34, 2.2], snag: [0.36, 2.0],
};

// ---------------------------------------------------------------- species mixes
const MIX = {
  shelterbelt: [['locust', 0.4], ['birch', 0.18], ['poplar', 0.1], ['pine', 0.1],
    ['spruce', 0.07], ['snag', 0.05], ['shrub', 0.1]],
  hedge: [['shrub', 0.78], ['poplar', 0.08], ['locust', 0.1], ['snag', 0.04]],
  pines: [['pine', 0.55], ['spruce', 0.3], ['birch', 0.15]],
  yard: [['locust', 0.35], ['birch', 0.3], ['poplar', 0.2], ['shrub', 0.15]],
};

function pick(mix, t) {
  let acc = 0;
  for (const [name, w] of mix) { acc += w; if (t < acc) return name; }
  return mix[0][0];
}

// ---------------------------------------------------------------- right of way
// Nothing grows on a road surface or a rail formation. Built once per level from the
// same declarations the ribbons and track are built from, so vegetation always clears
// whatever infrastructure exists — including anything added later.
export function rightOfWay(roadPaint = [], railLines = []) {
  const avoid = [];
  for (const run of roadPaint) {
    avoid.push({ points: run.points, half: (run.width ?? 7) / 2 + 1.2 });
  }
  for (const run of railLines) avoid.push({ points: run.points, half: 7 });
  return avoid;
}

function nearAvoid(x, z, avoid) {
  for (const a of avoid) {
    // Circle entries: settlement yards, the OP pad — anywhere plants must not stand.
    if (a.at) {
      if (Math.hypot(x - a.at[0], z - a.at[1]) < a.r) return true;
      continue;
    }
    const pts = a.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const abx = bx - ax, abz = bz - az;
      const t = Math.max(0, Math.min(1,
        ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz || 1)));
      if (Math.hypot(x - (ax + abx * t), z - (az + abz * t)) < a.half) return true;
    }
  }
  return false;
}

// Hedgerow stands derived from the road/rail polylines themselves: offset scrub runs
// down both shoulders. Vegetation follows the infrastructure — no hand-placed verges.
export function hedgeStands(roadPaint = [], railLines = []) {
  const stands = [];
  for (const run of roadPaint) {
    // Narrow dirt field tracks run along the belts, which already give them a verge;
    // only real roads get their own hedgerows.
    if ((run.width ?? 7) < 5) continue;
    const off = (run.width ?? 7) / 2 + 2.4;
    for (const side of [-1, 1]) {
      stands.push({ kind: 'hedge', points: run.points, offset: off * side, density: 0.55 });
    }
  }
  for (const run of railLines) {
    for (const side of [-1, 1]) {
      stands.push({ kind: 'hedge', points: run.points, offset: 8.6 * side, density: 0.35 });
    }
  }
  return stands;
}

// ---------------------------------------------------------------- placement
// Deterministic plant list from the declarative stands. The single source of truth for
// visuals AND both collider sets — same plan + seed always yields the same forest.
export function treePlacements(plan, seed) {
  const stands = plan.stands || plan;
  const avoid = plan.avoid || [];
  const out = [];
  const put = (x, z, s, species) => {
    if (nearAvoid(x, z, avoid)) return;
    out.push({ x, z, s, species });
  };
  stands.forEach((stand, si) => {
    const R = rng((seed * 7919 + si * 1299721) >>> 0);
    if (stand.kind === 'belt') {
      // 2 staggered tree rows across the band plus a scrub base along both edges: the
      // layered wall a real лісосмуга reads as from field level.
      const [x1, z1] = stand.from, [x2, z2] = stand.to;
      const width = stand.width ?? 10;
      const step = stand.step ?? 9;
      const len = Math.hypot(x2 - x1, z2 - z1);
      const nx = -(z2 - z1) / (len || 1), nz = (x2 - x1) / (len || 1);
      const n = Math.max(2, Math.round(len / step));
      const mix = MIX[stand.mix || 'shelterbelt'];
      for (let row = 0; row < 2; row++) {
        const lane = (row === 0 ? -1 : 1) * width / 4;
        for (let i = 0; i <= n; i++) {
          const t = (i + (row === 1 ? 0.5 : 0)) / n;
          if (t > 1) continue;
          const jx = (R() - 0.5) * 4 + nx * (lane + (R() - 0.5) * width * 0.2);
          const jz = (R() - 0.5) * 4 + nz * (lane + (R() - 0.5) * width * 0.2);
          const species = pick(mix, R());
          const s = species === 'shrub' ? 0.9 + R() * 0.5
            : (species === 'poplar' ? 1.05 : 0.85) + R() * 0.5;
          put(x1 + (x2 - x1) * t + jx, z1 + (z2 - z1) * t + jz, s, species);
        }
      }
      // Understory scrub on both faces of the belt.
      const un = Math.max(2, Math.round(len / 6));
      for (let i = 0; i <= un; i++) {
        if (R() > 0.8) continue;
        const t = i / un;
        const side = (R() < 0.5 ? -1 : 1) * (width / 2 + 0.5 + R() * 1.5);
        put(x1 + (x2 - x1) * t + nx * side + (R() - 0.5) * 2,
          z1 + (z2 - z1) * t + nz * side + (R() - 0.5) * 2,
          0.8 + R() * 0.6, 'shrub');
      }
    } else if (stand.kind === 'hedge') {
      // Offset scrub run along a polyline, stamped every few metres, occasional
      // emergent tree breaking the line the way real verges do.
      const pts = stand.points;
      const off = stand.offset ?? 0;
      const density = stand.density ?? 0.6;
      const mix = MIX[stand.mix || 'hedge'];
      for (let sgi = 0; sgi < pts.length - 1; sgi++) {
        const [ax, az] = pts[sgi], [bx, bz] = pts[sgi + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const nx = -(bz - az) / (len || 1), nz = (bx - ax) / (len || 1);
        const n = Math.max(1, Math.round(len / 4));
        for (let i = 0; i <= n; i++) {
          if (R() > density) continue;
          const t = i / n;
          const species = pick(mix, R());
          const s = species === 'shrub' ? 0.7 + R() * 0.6 : 0.8 + R() * 0.45;
          put(ax + (bx - ax) * t + nx * off + (R() - 0.5) * 1.6,
            az + (bz - az) * t + nz * off + (R() - 0.5) * 1.6, s, species);
        }
      }
    } else if (stand.kind === 'clump') {
      const [cx, cz] = stand.at;
      const count = stand.count ?? 8;
      const mix = MIX[stand.mix || 'pines'];
      for (let i = 0; i < count; i++) {
        const a = R() * Math.PI * 2;
        const d = Math.sqrt(R()) * (stand.r ?? 20);
        put(cx + Math.cos(a) * d, cz + Math.sin(a) * d,
          0.8 + R() * 0.55, pick(mix, R()));
      }
    }
  });
  return out;
}

// Shared low-level geometry kit for the other steppe scenery builders (hamlet.js).
export const prims = { rng, hash, makeAcc, vert, tube, blob };

// ---------------------------------------------------------------- builders
const SINK = 0.25;   // roots sit slightly into the grade so slopes never show air

export function buildTreeStands(def, plan, seed) {
  const sample = terrainSampler(def);
  const acc = makeAcc();
  const places = treePlacements(plan, seed);
  places.forEach((p, i) => {
    const R = rng((seed * 104729 + i * 7907) >>> 0);
    SPECIES[p.species](acc, R, p.x, sample(p.x, p.z) - SINK, p.z, p.s);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(acc.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(acc.colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'terrain-trees';
  mesh.userData.dispose = () => { geometry.dispose(); material.dispose(); };
  return mesh;
}

// Invisible solid geo entries, one slim box per trunk: players walk into wood, bullets
// hit wood, nothing collides with leaves.
export function treeTrunkColliders(def, plan, seed) {
  const sample = terrainSampler(def);
  const out = [];
  for (const p of treePlacements(plan, seed)) {
    const dims = TRUNK_BOX[p.species];
    if (!dims) continue;
    const [w, h] = dims;
    const y = sample(p.x, p.z) - SINK;
    out.push([p.x, y + h * p.s / 2, p.z, w * p.s, h * p.s, w * p.s, 0x000000, true, false, false]);
  }
  return out;
}

// Coarse canopy AABBs for aircraft only — handed to drone.js, never into `solids`.
export function treeFoliageColliders(def, plan, seed) {
  const sample = terrainSampler(def);
  const out = [];
  for (const p of treePlacements(plan, seed)) {
    const box = CANOPY_BOX[p.species];
    if (!box) continue;
    const [cy, w, h, d] = box;
    const y = sample(p.x, p.z) - SINK;
    out.push(makeBox(p.x, y + cy * p.s, p.z, w * p.s, h * p.s, d * p.s));
  }
  return out;
}
