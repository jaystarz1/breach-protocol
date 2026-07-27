// AABB world collision. Solids are { min:{x,y,z}, max:{x,y,z} }.
export function makeBox(cx, cy, cz, w, h, d) {
  return {
    min: { x: cx - w / 2, y: cy - h / 2, z: cz - d / 2 },
    max: { x: cx + w / 2, y: cy + h / 2, z: cz + d / 2 },
  };
}

// Highest solid top under (x,z) at or below yMax, considering body radius r.
export function groundHeight(solids, x, z, r, yMax) {
  let best = -Infinity;
  for (const s of solids) {
    if (x + r < s.min.x || x - r > s.max.x || z + r < s.min.z || z - r > s.max.z) continue;
    if (s.max.y <= yMax + 0.001 && s.max.y > best) best = s.max.y;
  }
  return best;
}

// Resolve horizontal overlap for a capsule (point + radius) spanning [yLow, yHigh].
// prev (optional) = position before this frame's movement; when the center ends up
// inside a box, eject toward the side the actor came from — otherwise pushing at a
// thin wall can pop you out the far side.
export function resolveXZ(solids, pos, r, yLow, yHigh, prev) {
  for (let pass = 0; pass < 2; pass++) {
    for (const s of solids) {
      if (yHigh <= s.min.y + 0.01 || yLow >= s.max.y - 0.01) continue;
      const cx = Math.max(s.min.x, Math.min(pos.x, s.max.x));
      const cz = Math.max(s.min.z, Math.min(pos.z, s.max.z));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2), push = (r - d) / d;
        pos.x += dx * push; pos.z += dz * push;
      } else {
        const refX = prev ? prev.x : pos.x, refZ = prev ? prev.z : pos.z;
        const sideX = refX >= (s.min.x + s.max.x) / 2 ? 1 : -1;
        const sideZ = refZ >= (s.min.z + s.max.z) / 2 ? 1 : -1;
        const px = sideX > 0 ? s.max.x - pos.x + r : pos.x - s.min.x + r;
        const pz = sideZ > 0 ? s.max.z - pos.z + r : pos.z - s.min.z + r;
        if (px < pz) pos.x += sideX * px;
        else pos.z += sideZ * pz;
      }
    }
  }
}

// Ray vs AABB list. Returns nearest hit distance or Infinity.
export function raycastSolids(solids, ox, oy, oz, dx, dy, dz, maxDist) {
  let nearest = maxDist;
  for (const s of solids) {
    let tmin = 0, tmax = nearest;
    let ok = true;
    for (const [o, d, lo, hi] of [[ox, dx, s.min.x, s.max.x], [oy, dy, s.min.y, s.max.y], [oz, dz, s.min.z, s.max.z]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) { ok = false; break; }
    }
    if (ok && tmin < nearest && tmin > 0.001) nearest = tmin;
  }
  return nearest;
}

// Line of sight between two points (eye heights included by caller).
export function hasLOS(solids, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.01) return true;
  const hit = raycastSolids(solids, ax, ay, az, dx / dist, dy / dist, dz / dist, dist);
  return hit >= dist - 0.05;
}

// Ray vs sphere (for hitting actors). Returns t or Infinity.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(Math.max(0, r * r - d2));
}

// Ray vs a vertical capsule: a finite cylinder with spherical ends. Actor bodies are tall,
// narrow volumes; one large sphere rewards visibly off-target "proximity" shots. Returns the
// nearest positive distance or Infinity.
export function rayVerticalCapsule(ox, oy, oz, dx, dy, dz, cx, y0, y1, cz, r) {
  let nearest = Math.min(
    raySphere(ox, oy, oz, dx, dy, dz, cx, y0, cz, r),
    raySphere(ox, oy, oz, dx, dy, dz, cx, y1, cz, r)
  );
  const rx = ox - cx, rz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-10) return nearest;
  const b = 2 * (rx * dx + rz * dz);
  const c = rx * rx + rz * rz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return nearest;
  const root = Math.sqrt(disc);
  for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (t <= 0 || t >= nearest) continue;
    const y = oy + dy * t;
    if (y >= y0 && y <= y1) nearest = t;
  }
  return nearest;
}
