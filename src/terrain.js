// Heightfield terrain from real DEM data (see tools/fetch-terrain.py).
//
// The box-geometry engine treats the ground as y=0 everywhere. A terrain level replaces
// that assumption with a sampled height grid: the mesh here is the visible land, and the
// sampler is the single source of truth every system (drone floor, vehicles, munitions,
// jammer line-of-sight) reads. Nothing raycasts the terrain mesh — sampling the grid is
// exact and three orders of magnitude cheaper.
import * as THREE from 'three';

// Decode the generated module's compact string into a Float32 grid, once.
function gridOf(def) {
  if (def._grid) return def._grid;
  const grid = new Float32Array(def.nx * def.nz);
  const rows = def.data.split(';');
  for (let iz = 0; iz < def.nz; iz++) {
    const vals = rows[iz].split(',');
    for (let ix = 0; ix < def.nx; ix++) grid[iz * def.nx + ix] = vals[ix] / 10;
  }
  def._grid = grid;
  return grid;
}

// Smooth value noise for the apron: bilinear over a hashed lattice, two octaves.
function valueNoise(x, z, period) {
  const fx = x / period, fz = z / period;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  return hash(ix, iz) * (1 - sx) * (1 - sz) + hash(ix + 1, iz) * sx * (1 - sz)
    + hash(ix, iz + 1) * (1 - sx) * sz + hash(ix + 1, iz + 1) * sx * sz;
}

// Rolling countryside beyond the DEM patch: fades in from 0 at the grid seam so the two
// surfaces meet exactly, then undulates gently forever. Deterministic, so the drone floor,
// vehicles and the visible apron mesh all agree on it.
function apronHeight(def, x, z) {
  const dOut = Math.max(
    def.x0 - x, x - (def.x0 + (def.nx - 1) * def.cell),
    z - def.z0, (def.z0 - (def.nz - 1) * def.cell) - z, 0);
  if (dOut <= 0) return 0;
  const fade = Math.min(1, dOut / 300);
  const n = (valueNoise(x, z, 340) - 0.5) * 2 * 3.2 + (valueNoise(x, z, 130) - 0.5) * 2 * 1.1;
  return n * fade * fade * (3 - 2 * fade);
}

// Bilinear height at any world (x, z); outside the grid the procedural apron takes over.
// Row 0 is the SOUTH edge; north is -z.
export function terrainSampler(def) {
  const grid = gridOf(def);
  const { x0, z0, cell, nx, nz } = def;
  return (x, z) => {
    const fx = (x - x0) / cell;
    const fz = (z0 - z) / cell;
    if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return apronHeight(def, x, z);
    const cx = Math.min(nx - 1.001, Math.max(0, fx));
    const cz = Math.min(nz - 1.001, Math.max(0, fz));
    const ix = Math.floor(cx), iz = Math.floor(cz);
    const tx = cx - ix, tz = cz - iz;
    const i = iz * nx + ix;
    return grid[i] * (1 - tx) * (1 - tz) + grid[i + 1] * tx * (1 - tz)
      + grid[i + nx] * (1 - tx) * tz + grid[i + nx + 1] * tx * tz;
  };
}

export function terrainMin(def) {
  const grid = gridOf(def);
  let min = Infinity;
  for (let i = 0; i < grid.length; i++) min = Math.min(min, grid[i]);
  return min;
}

// Deterministic hash noise for crop-band jitter — Math.random would rebuild a different
// countryside on every retry.
function hash(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The visible land: one indexed mesh, flat-shaded so the facets match the box aesthetic,
// vertex-coloured so the crop strips live IN the terrain instead of floating over it.
// A perimeter skirt drops to the (lowered) backdrop plate so gullies never expose the void.
// Crop bands along z, the same farmland read the flat overlays used to give, plus scrub
// on the slopes and damp dark soil in the gully bottoms. Shared by the DEM mesh and the
// apron so the seam between them is invisible.
const BANDS = [
  [0x51, 0x50, 0x2f], [0x47, 0x4a, 0x30], [0x55, 0x50, 0x37],
  [0x42, 0x46, 0x36], [0x4e, 0x4b, 0x2e],
];
const SCRUB = [0x45, 0x47, 0x31];
const DAMP = [0x3a, 0x3d, 0x2c];

function bandColor(color, x, z, ix, iz, src) {
  const jitter = 0.92 + hash(ix, iz) * 0.16;
  // Authored values are sRGB like every hex colour in the game; convert into the
  // renderer's linear working space or the land renders washed-out white.
  color.setRGB(
    src[0] / 255 * jitter, src[1] / 255 * jitter, src[2] / 255 * jitter,
    THREE.SRGBColorSpace);
  return color;
}

function bandFor(z) {
  return BANDS[(Math.floor((z + hash(0, Math.floor(z / 160)) * 90) / 160)
    % BANDS.length + BANDS.length) % BANDS.length];
}

export function buildTerrainMesh(def, skirtY) {
  const grid = gridOf(def);
  const { x0, z0, cell, nx, nz } = def;
  const positions = [];
  const colors = [];
  const indices = [];
  const bands = BANDS;
  const scrub = SCRUB;
  const damp = DAMP;
  const color = new THREE.Color();

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * cell;
      const z = z0 - iz * cell;
      const h = grid[iz * nx + ix];
      positions.push(x, h, z);
      // slope from grid neighbours
      const hx = grid[iz * nx + Math.min(nx - 1, ix + 1)] - grid[iz * nx + Math.max(0, ix - 1)];
      const hz = grid[Math.min(nz - 1, iz + 1) * nx + ix] - grid[Math.max(0, iz - 1) * nx + ix];
      const slope = Math.hypot(hx, hz) / (2 * cell);
      const band = bands[(Math.floor((z + hash(0, Math.floor(z / 160)) * 90) / 160)
        % bands.length + bands.length) % bands.length];
      const src = slope > 0.16 ? scrub : h < -1.6 ? damp : band;
      const jitter = 0.92 + hash(ix, iz) * 0.16;
      // Authored values are sRGB like every hex colour in the game; convert into the
      // renderer's linear working space or the land renders washed-out white.
      color.setRGB(
        src[0] / 255 * jitter, src[1] / 255 * jitter, src[2] / 255 * jitter,
        THREE.SRGBColorSpace);
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix;
      indices.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
    }
  }

  // Skirt: duplicate each perimeter vertex at skirtY and wall down to it.
  const edge = [];
  for (let ix = 0; ix < nx; ix++) edge.push(ix);                       // south row
  for (let iz = 1; iz < nz; iz++) edge.push(iz * nx + (nx - 1));       // east col
  for (let ix = nx - 2; ix >= 0; ix--) edge.push((nz - 1) * nx + ix);  // north row
  for (let iz = nz - 2; iz >= 1; iz--) edge.push(iz * nx);             // west col
  const skirtStart = positions.length / 3;
  for (const vi of edge) {
    positions.push(positions[vi * 3], skirtY, positions[vi * 3 + 2]);
    colors.push(colors[vi * 3] * 0.55, colors[vi * 3 + 1] * 0.55, colors[vi * 3 + 2] * 0.55);
  }
  for (let e = 0; e < edge.length; e++) {
    const a = edge[e], b = edge[(e + 1) % edge.length];
    const sa = skirtStart + e, sb = skirtStart + (e + 1) % edge.length;
    indices.push(a, sa, b, b, sa, sb);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  mesh.userData.dispose = () => { geometry.dispose(); material.dispose(); };
  return mesh;
}

// Roads are painted onto the land, not stacked over it. Each run is a triangle ribbon
// draped on the sampled surface — three vertices across so the crown follows the ground,
// resampled every few metres so dips and rises never open a gap underneath, and depth-
// biased so it wins the z-fight against the terrain triangles it sits on. The old
// draped-box roads floated at the max height of each 34m segment, which over a dip left
// air you could fly under; a ribbon cannot do that.
export function buildRoadRibbons(def, runs) {
  const sample = terrainSampler(def);
  const STEP = 6;
  const LIFT = 0.3;
  const SURFACE = [0x3b, 0x38, 0x33];
  const positions = [];
  const colors = [];
  const indices = [];
  const color = new THREE.Color();
  for (const run of runs) {
    const pts = run.points;
    const width = run.width ?? 7;
    // Resample the polyline at a fixed step, keeping every authored corner.
    const line = [];
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / STEP));
      for (let i = s === 0 ? 0 : 1; i <= n; i++) {
        line.push([ax + (bx - ax) * (i / n), az + (bz - az) * (i / n)]);
      }
    }
    const base = positions.length / 3;
    for (let i = 0; i < line.length; i++) {
      const [x, z] = line[i];
      // Tangent from the neighbours (averaged at corners, so bends get a mitre).
      const [px, pz] = line[Math.max(0, i - 1)];
      const [qx, qz] = line[Math.min(line.length - 1, i + 1)];
      let tx = qx - px, tz = qz - pz;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      for (const o of [-width / 2, 0, width / 2]) {
        const wx = x - tz * o, wz = z + tx * o;
        positions.push(wx, sample(wx, wz) + LIFT, wz);
        const jitter = 0.88 + hash(Math.round(wx * 2), Math.round(wz * 2)) * 0.24;
        color.setRGB(
          SURFACE[0] / 255 * jitter, SURFACE[1] / 255 * jitter, SURFACE[2] / 255 * jitter,
          THREE.SRGBColorSpace);
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let i = 0; i < line.length - 1; i++) {
      const a = base + i * 3;
      indices.push(
        a, a + 1, a + 3, a + 1, a + 4, a + 3,
        a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.94, metalness: 0.02,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain-roads';
  mesh.userData.dispose = () => { geometry.dispose(); material.dispose(); };
  return mesh;
}

// A railway is earthworks first: the land is cut and filled to meet the line, not the
// other way round. This edits the height grid itself along each run — the centreline
// profile is smoothed hard and clamped to a ruling gradient, then every cell near the
// line is pulled toward that grade, full strength across the formation and feathering
// out over the cutting and embankment slopes. Because the grid is the single source of
// truth, the terrain mesh, the sampler, the drone floor and the wagons all agree on the
// re-shaped ground. Call once per def, before anything samples it.
export function carveRailGrade(def, runs) {
  const grid = gridOf(def);
  const { x0, z0, cell, nx, nz } = def;
  const HALF = 6;        // full-grade half-width of the formation
  const BLEND = 24;      // cut/fill slopes feather back into the land over this
  const MAX_SLOPE = 0.03;
  const sample = terrainSampler(def);
  for (const run of runs) {
    const pts = run.points;
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.ceil(len / cell));
      const raw = [];
      for (let i = 0; i <= n; i++) {
        raw.push(sample(ax + (bx - ax) * (i / n), az + (bz - az) * (i / n)));
      }
      // Wide moving average, then a two-way gradient clamp: the profile a survey crew
      // would peg, riding through the mean of the ground it crosses.
      const prof = raw.map((_, i) => {
        let sum = 0, count = 0;
        for (let k = -8; k <= 8; k++) {
          sum += raw[Math.min(n, Math.max(0, i + k))]; count++;
        }
        return sum / count;
      });
      const maxStep = MAX_SLOPE * (len / n);
      for (let i = 1; i <= n; i++) {
        prof[i] = Math.min(prof[i - 1] + maxStep, Math.max(prof[i - 1] - maxStep, prof[i]));
      }
      for (let i = n - 1; i >= 0; i--) {
        prof[i] = Math.min(prof[i + 1] + maxStep, Math.max(prof[i + 1] - maxStep, prof[i]));
      }
      const reach = HALF + BLEND;
      const abx = bx - ax, abz = bz - az;
      const ab2 = abx * abx + abz * abz || 1;
      const ix0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / cell));
      const ix1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / cell));
      const iz0 = Math.max(0, Math.floor((z0 - Math.max(az, bz) - reach) / cell));
      const iz1 = Math.min(nz - 1, Math.ceil((z0 - Math.min(az, bz) + reach) / cell));
      for (let iz = iz0; iz <= iz1; iz++) {
        const wz = z0 - iz * cell;
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = x0 + ix * cell;
          const t = Math.min(1, Math.max(0, ((wx - ax) * abx + (wz - az) * abz) / ab2));
          const d = Math.hypot(wx - (ax + abx * t), wz - (az + abz * t));
          if (d >= reach) continue;
          const f = t * n, fi = Math.floor(f);
          const grade = prof[fi] + (prof[Math.min(n, fi + 1)] - prof[fi]) * (f - fi);
          const u = Math.max(0, (d - HALF) / BLEND);
          const w = 1 - u * u * (3 - 2 * u);
          const i = iz * nx + ix;
          grid[i] = grid[i] * (1 - w) + grade * w;
        }
      }
    }
  }
}

// Track furniture heights, shared with the level authors: a wagon's wheels touch the
// railhead when its authored y offset is RAIL_TOP minus the wheel-bottom height.
export const RAIL_TOP = 0.05 + 0.3 + 0.13 + 0.17;   // lift + ballast + tie + rail
export const RAIL_GAUGE = 0.75;                      // rail centreline offset from track axis

// The permanent way, draped on the carved formation: a ballast prism with battered
// shoulders, creosote ties at scale spacing, and two steel rails the rolling stock
// overhangs — instead of the old 8-wide slab with rails wider than the wagons. One
// merged vertex-coloured mesh; the corridor under it is already flattened by
// carveRailGrade, so everything rides the centreline sample and stays rigid across.
export function buildRailLine(def, runs) {
  const sample = terrainSampler(def);
  const STEP = 4;
  const LIFT = 0.05;
  const BALLAST_H = 0.3, BALLAST_HALF = 2.3, BALLAST_TOP_HALF = 1.5;
  const TIE_SPACING = 2.1, TIE_HALF_LEN = 1.1, TIE_HALF_W = 0.13, TIE_H = 0.13;
  const RAIL_HALF_W = 0.07, RAIL_H = 0.17;
  const BALLAST_C = [0x4e, 0x49, 0x43];
  const TIE_C = [0x38, 0x2c, 0x21];
  const STEEL_C = [0x70, 0x73, 0x74];
  const positions = [];
  const colors = [];
  const indices = [];
  const color = new THREE.Color();
  const vert = (x, y, z, src, jitter) => {
    positions.push(x, y, z);
    color.setRGB(
      src[0] / 255 * jitter, src[1] / 255 * jitter, src[2] / 255 * jitter,
      THREE.SRGBColorSpace);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };
  const quad = (a, b, c, d) => indices.push(a, b, c, a, c, d);
  for (const run of runs) {
    const pts = run.points;
    const line = [];
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / STEP));
      for (let i = s === 0 ? 0 : 1; i <= n; i++) {
        line.push([ax + (bx - ax) * (i / n), az + (bz - az) * (i / n)]);
      }
    }
    // Ballast prism and the two rails: quad strips over the resampled centreline.
    const strip = (offsets, heights, src, jitterFn) => {
      const base = positions.length / 3;
      for (let i = 0; i < line.length; i++) {
        const [x, z] = line[i];
        const [px, pz] = line[Math.max(0, i - 1)];
        const [qx, qz] = line[Math.min(line.length - 1, i + 1)];
        let tx = qx - px, tz = qz - pz;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        const cy = sample(x, z) + LIFT;
        for (let k = 0; k < offsets.length; k++) {
          const o = offsets[k];
          vert(x - tz * o, cy + heights[k], z + tx * o, src, jitterFn(x, z, k));
        }
      }
      const across = offsets.length;
      for (let i = 0; i < line.length - 1; i++) {
        const a = base + i * across;
        for (let k = 0; k < across - 1; k++) {
          quad(a + k, a + k + 1, a + k + 1 + across, a + k + across);
        }
      }
    };
    strip(
      [-BALLAST_HALF, -BALLAST_TOP_HALF, BALLAST_TOP_HALF, BALLAST_HALF],
      [0, BALLAST_H, BALLAST_H, 0], BALLAST_C,
      (x, z, k) => 0.78 + hash(Math.round(x * 2) + k, Math.round(z * 2)) * 0.44);
    const railBase = BALLAST_H + TIE_H;
    for (const side of [-RAIL_GAUGE, RAIL_GAUGE]) {
      strip(
        [side - RAIL_HALF_W, side - RAIL_HALF_W, side + RAIL_HALF_W, side + RAIL_HALF_W],
        [railBase, railBase + RAIL_H, railBase + RAIL_H, railBase], STEEL_C,
        () => 0.96 + hash(Math.round(side * 100), 7) * 0.08);
    }
    // Ties: oriented boxes walked along the line at scale spacing, tops flush with the
    // rail seats so the steel visibly sits on the timber.
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      let tx = (bx - ax) / (len || 1), tz = (bz - az) / (len || 1);
      for (let d = TIE_SPACING / 2; d < len; d += TIE_SPACING) {
        const x = ax + tx * d, z = az + tz * d;
        const yb = sample(x, z) + LIFT + BALLAST_H - 0.04;
        const yt = sample(x, z) + LIFT + railBase;
        const jitter = 0.85 + hash(Math.round(x * 3), Math.round(z * 3)) * 0.3;
        const corners = [];
        for (const [alo, aco] of [[-TIE_HALF_W, -TIE_HALF_LEN], [TIE_HALF_W, -TIE_HALF_LEN],
          [TIE_HALF_W, TIE_HALF_LEN], [-TIE_HALF_W, TIE_HALF_LEN]]) {
          const cx = x + tx * alo - tz * aco, cz = z + tz * alo + tx * aco;
          corners.push([cx, cz]);
        }
        const lo = corners.map(([cx, cz]) => vert(cx, yb, cz, TIE_C, jitter * 0.8));
        const hi = corners.map(([cx, cz]) => vert(cx, yt, cz, TIE_C, jitter));
        quad(hi[0], hi[1], hi[2], hi[3]);
        for (let k = 0; k < 4; k++) {
          const m = (k + 1) % 4;
          quad(lo[k], lo[m], hi[m], hi[k]);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.86, metalness: 0.1,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain-rail';
  mesh.userData.dispose = () => { geometry.dispose(); material.dispose(); };
  return mesh;
}

// Rolling procedural countryside from the DEM patch's edge out past the fog. Four coarse
// band meshes sampling the same combined sampler the flight model reads, so what the
// pilot sees at the boundary is exactly what the airframe would hit.
export function buildTerrainApron(def) {
  const sample = terrainSampler(def);
  const X0 = def.x0, X1 = def.x0 + (def.nx - 1) * def.cell;
  const ZS = def.z0, ZN = def.z0 - (def.nz - 1) * def.cell;
  const EXT = 2600, CELL = 60;
  const positions = [];
  const colors = [];
  const indices = [];
  const color = new THREE.Color();
  const patches = [
    [X0 - EXT, X1 + EXT, ZS + EXT, ZS],   // south band (za south edge, zb at the grid)
    [X0 - EXT, X1 + EXT, ZN, ZN - EXT],   // north band
    [X0 - EXT, X0, ZS, ZN],               // west band
    [X1, X1 + EXT, ZS, ZN],               // east band
  ];
  for (const [xa, xb, za, zb] of patches) {
    const pnx = Math.max(2, Math.round((xb - xa) / CELL) + 1);
    const pnz = Math.max(2, Math.round((za - zb) / CELL) + 1);
    const base = positions.length / 3;
    for (let iz = 0; iz < pnz; iz++) {
      const z = za - (za - zb) * (iz / (pnz - 1));
      const band = bandFor(z);
      for (let ix = 0; ix < pnx; ix++) {
        const x = xa + (xb - xa) * (ix / (pnx - 1));
        positions.push(x, sample(x, z), z);
        bandColor(color, x, z, Math.round(x / CELL), Math.round(z / CELL), band);
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let iz = 0; iz < pnz - 1; iz++) {
      for (let ix = 0; ix < pnx - 1; ix++) {
        const a = base + iz * pnx + ix;
        indices.push(a, a + 1, a + pnx, a + 1, a + pnx + 1, a + pnx);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.97, metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain-apron';
  mesh.userData.dispose = () => { geometry.dispose(); material.dispose(); };
  return mesh;
}
