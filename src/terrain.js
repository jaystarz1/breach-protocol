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

// Bilinear height at any world (x, z). Row 0 is the SOUTH edge; north is -z.
export function terrainSampler(def) {
  const grid = gridOf(def);
  const { x0, z0, cell, nx, nz } = def;
  return (x, z) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / cell));
    const fz = Math.min(nz - 1.001, Math.max(0, (z0 - z) / cell));
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
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
export function buildTerrainMesh(def, skirtY) {
  const grid = gridOf(def);
  const { x0, z0, cell, nx, nz } = def;
  const positions = [];
  const colors = [];
  const indices = [];

  // Crop bands along z, the same farmland read the flat overlays used to give, plus scrub
  // on the slopes and damp dark soil in the gully bottoms. Band boundaries jitter by row.
  const bands = [
    [0x51, 0x50, 0x2f], [0x47, 0x4a, 0x30], [0x55, 0x50, 0x37],
    [0x42, 0x46, 0x36], [0x4e, 0x4b, 0x2e],
  ];
  const scrub = [0x45, 0x47, 0x31];
  const damp = [0x3a, 0x3d, 0x2c];
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
