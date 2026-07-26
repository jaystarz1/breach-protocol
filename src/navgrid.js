// Multi-layer navigation grid built from the level's AABB solids.
// Layers matter: a tower stacks several walkable surfaces over the same (x,z),
// so each cell holds a LIST of standing heights, not one.
const CELL = 1.4;
const STEP_UP = 0.75;   // max height an actor can walk up between adjacent cells
const BODY = 1.55;      // headroom required to stand
const CLEAR = 0.34;     // actor radius used for clearance tests
const BUCKET = 8;       // spatial bucket size for solid lookup

function overlaps(s, x0, y0, z0, x1, y1, z1) {
  return s.min.x < x1 && s.max.x > x0 && s.min.y < y1 && s.max.y > y0 && s.min.z < z1 && s.max.z > z0;
}

// Is the body cylinder at (x,z) standing on height y obstructed?
// Anything whose top is within a step of your feet is something you walk ONTO, not a
// ceiling. Without this every stair tread rejects itself, because the next tread up
// intrudes into the clearance cylinder and reads as a blocked head.
function blockedAt(near, x, z, y) {
  for (const s of near(x, z)) {
    if (s.max.y <= y + STEP_UP) continue;
    if (overlaps(s, x - CLEAR, y + 0.2, z - CLEAR, x + CLEAR, y + BODY, z + CLEAR)) return true;
  }
  return false;
}

export function buildNavGrid(solids) {
  // level bounds from solids, ignoring the huge ground slabs' vertical extent
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of solids) {
    minX = Math.min(minX, s.min.x); maxX = Math.max(maxX, s.max.x);
    minZ = Math.min(minZ, s.min.z); maxZ = Math.max(maxZ, s.max.z);
  }
  minX -= 1; maxX += 1; minZ -= 1; maxZ += 1;

  let cell = CELL;
  let nx = Math.ceil((maxX - minX) / cell), nz = Math.ceil((maxZ - minZ) / cell);
  while (nx * nz > 45000) { // keep load time sane on huge outdoor levels
    cell *= 1.35;
    nx = Math.ceil((maxX - minX) / cell); nz = Math.ceil((maxZ - minZ) / cell);
  }

  // bucket solids so per-cell work only inspects nearby geometry
  const bx = Math.ceil((maxX - minX) / BUCKET) + 1, bz = Math.ceil((maxZ - minZ) / BUCKET) + 1;
  const buckets = new Array(bx * bz);
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    const i0 = Math.max(0, Math.floor((s.min.x - minX) / BUCKET)), i1 = Math.min(bx - 1, Math.floor((s.max.x - minX) / BUCKET));
    const j0 = Math.max(0, Math.floor((s.min.z - minZ) / BUCKET)), j1 = Math.min(bz - 1, Math.floor((s.max.z - minZ) / BUCKET));
    for (let j = j0; j <= j1; j++) for (let i2 = i0; i2 <= i1; i2++) {
      const k = j * bx + i2;
      (buckets[k] || (buckets[k] = [])).push(s);
    }
  }
  const near = (x, z) => {
    const i = Math.max(0, Math.min(bx - 1, Math.floor((x - minX) / BUCKET)));
    const j = Math.max(0, Math.min(bz - 1, Math.floor((z - minZ) / BUCKET)));
    return buckets[j * bx + i] || [];
  };

  // --- nodes ---
  const nodeX = [], nodeY = [], nodeZ = [];
  const cellNodes = new Array(nx * nz);   // cell index -> array of node ids

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + (i + 0.5) * cell, z = minZ + (j + 0.5) * cell;
      const list = near(x, z);
      // candidate standing surfaces under this column
      const tops = [];
      for (const s of list) {
        if (x < s.min.x || x > s.max.x || z < s.min.z || z > s.max.z) continue;
        tops.push(s.max.y);
      }
      if (!tops.length) continue;
      tops.sort((a, b) => a - b);
      const surfaces = [];
      for (const t of tops) if (!surfaces.length || t - surfaces[surfaces.length - 1] > 0.4) surfaces.push(t);
      for (const y of surfaces) {
        if (blockedAt(near, x, z, y)) continue;
        const id = nodeX.length;
        nodeX.push(x); nodeY.push(y); nodeZ.push(z);
        const ci = j * nx + i;
        (cellNodes[ci] || (cellNodes[ci] = [])).push(id);
      }
    }
  }

  // --- edges (4-connected; diagonals come from path smoothing) ---
  const neighbors = new Array(nodeX.length);
  for (let n = 0; n < nodeX.length; n++) neighbors[n] = [];
  const clearBetween = (x, z, y) => !blockedAt(near, x, z, y);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const ci = j * nx + i;
      const here = cellNodes[ci];
      if (!here) continue;
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const i2 = i + di, j2 = j + dj;
        if (i2 >= nx || j2 >= nz) continue;
        const there = cellNodes[j2 * nx + i2];
        if (!there) continue;
        for (const a of here) for (const b of there) {
          const dy = Math.abs(nodeY[a] - nodeY[b]);
          if (dy <= STEP_UP) {
            // sample across the span, not just the midpoint: a single centre probe can
            // slip through a thin wall and invent a route that does not exist
            const yTop = Math.max(nodeY[a], nodeY[b]);
            let ok = true;
            for (const t of [0.25, 0.5, 0.75]) {
              const px = nodeX[a] + (nodeX[b] - nodeX[a]) * t;
              const pz = nodeZ[a] + (nodeZ[b] - nodeZ[a]) * t;
              if (!clearBetween(px, pz, yTop)) { ok = false; break; }
            }
            if (!ok) continue;
          } else if (dy <= 2.0) {
            // A staircase climbs faster than one cell's step allowance, so a plain
            // height test severs every stairwell. Walk the span in small samples
            // instead: if each sample is a short step from the last, it is a ramp.
            if (!rampWalkable(near, nodeX[a], nodeZ[a], nodeY[a], nodeX[b], nodeZ[b], nodeY[b])) continue;
          } else continue;
          neighbors[a].push(b); neighbors[b].push(a);
        }
      }
    }
  }

  return { cell, minX, minZ, nx, nz, nodeX, nodeY, nodeZ, cellNodes, neighbors, near, clearBetween };
}

// Can an actor walk the sloped span from A to B, treading whatever surfaces lie between?
function rampWalkable(near, ax, az, ay, bx, bz, by) {
  const SAMPLES = 6;
  const hi = Math.max(ay, by), lo = Math.min(ay, by);
  let prevY = ay;
  for (let s = 1; s <= SAMPLES; s++) {
    const t = s / SAMPLES;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const wantY = ay + (by - ay) * t;
    let bestY = null;
    for (const sol of near(x, z)) {
      if (x < sol.min.x || x > sol.max.x || z < sol.min.z || z > sol.max.z) continue;
      const top = sol.max.y;
      if (top > hi + 0.35 || top < lo - 0.35) continue;
      if (bestY === null || Math.abs(top - wantY) < Math.abs(bestY - wantY)) bestY = top;
    }
    if (bestY === null) return false;
    if (Math.abs(bestY - prevY) > STEP_UP) return false;
    if (blockedAt(near, x, z, bestY)) return false;
    prevY = bestY;
  }
  return Math.abs(prevY - by) <= STEP_UP;
}

export function nearestNode(nav, x, y, z) {
  const i = Math.floor((x - nav.minX) / nav.cell), j = Math.floor((z - nav.minZ) / nav.cell);
  let best = -1, bestD = Infinity;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= nav.nx || j2 >= nav.nz) continue;
      const list = nav.cellNodes[j2 * nav.nx + i2];
      if (!list) continue;
      for (const n of list) {
        const dy = Math.abs(nav.nodeY[n] - y);
        if (dy > 2.2) continue;
        const d = (nav.nodeX[n] - x) ** 2 + (nav.nodeZ[n] - z) ** 2 + dy * dy * 4;
        if (d < bestD) { bestD = d; best = n; }
      }
    }
  }
  return best;
}

// A* with a hard expansion cap so a hopeless query can never stall a frame.
export function findPath(nav, sx, sy, sz, tx, ty, tz, maxExpand = 900) {
  const start = nearestNode(nav, sx, sy, sz);
  const goal = nearestNode(nav, tx, ty, tz);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [{ x: tx, y: ty, z: tz }];

  const { nodeX, nodeY, nodeZ, neighbors } = nav;
  const h = n => Math.hypot(nodeX[n] - nodeX[goal], nodeZ[n] - nodeZ[goal]) + Math.abs(nodeY[n] - nodeY[goal]) * 2;

  const gScore = new Map(), came = new Map();
  gScore.set(start, 0);
  const open = [{ n: start, f: h(start) }];
  let expanded = 0;

  while (open.length) {
    // small frontier: linear extract-min beats heap bookkeeping here
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0].n;
    if (cur === goal) break;
    if (++expanded > maxExpand) return null;
    const cg = gScore.get(cur);
    for (const nb of neighbors[cur]) {
      const step = Math.hypot(nodeX[nb] - nodeX[cur], nodeZ[nb] - nodeZ[cur]) + Math.abs(nodeY[nb] - nodeY[cur]) * 1.5;
      const ng = cg + step;
      if (gScore.has(nb) && gScore.get(nb) <= ng) continue;
      gScore.set(nb, ng);
      came.set(nb, cur);
      open.push({ n: nb, f: ng + h(nb) });
    }
  }
  if (!came.has(goal) && start !== goal) return null;

  const raw = [];
  let n = goal;
  while (n !== undefined && n !== start) { raw.push(n); n = came.get(n); }
  raw.reverse();
  if (!raw.length) return null;

  // string-pull: drop waypoints we can walk straight past
  const pts = raw.map(id => ({ x: nodeX[id], y: nodeY[id], z: nodeZ[id] }));
  pts.push({ x: tx, y: ty, z: tz });
  const out = [];
  let from = { x: sx, y: sy, z: sz };
  let i = 0;
  while (i < pts.length) {
    let far = i;
    for (let k = pts.length - 1; k > i; k--) {
      if (straightClear(nav, from, pts[k])) { far = k; break; }
    }
    out.push(pts[far]);
    from = pts[far];
    i = far + 1;
  }
  return out;
}

function straightClear(nav, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
  const dist = Math.hypot(dx, dz);
  if (dist > 26) return false;                 // don't string-pull across huge spans
  // never smooth across a height change: a straight line over a staircase leaves the
  // treads and walks the follower into the stairwell edge
  if (Math.abs(dy) > 0.5) return false;
  const steps = Math.max(2, Math.ceil(dist / 0.55));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = a.x + dx * t, z = a.z + dz * t, y = a.y + dy * t;
    if (!nav.clearBetween(x, z, y)) return false;
  }
  return true;
}
