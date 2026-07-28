// Desktop visual replacements for authored collision/blockout props.
import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { mergeGeometries, toCreasedNormals } from '../lib/BufferGeometryUtils.js';
import { quality } from './quality.js';
import { rng } from './world.js';
import { photoSurfaces } from './textures.js';

let authoredVehicleSources = null;
if (quality.desktop) {
  try {
    const loader = new GLTFLoader();
    const [sedan, suv, wreck] = await Promise.all([
      loader.loadAsync('./assets/vehicles/CarSedan.glb'),
      loader.loadAsync('./assets/vehicles/CarSUV.glb'),
      loader.loadAsync('./assets/vehicles/BrokenCar.glb'),
    ]);
    authoredVehicleSources = {
      sedan: {
        scene: sedan.scene,
        bodyMaterials: new Set(['LightBlue']),
        scale: new THREE.Vector3(1.39, 1.42, 1.18),
      },
      hatch: {
        // The intact sedan and SUV cover ordinary traffic. A shell-struck hatch is supplied
        // separately below, so the former procedural hatch silhouette does not survive merely
        // to create a third nominal body type.
        scene: sedan.scene,
        bodyMaterials: new Set(['LightBlue']),
        scale: new THREE.Vector3(1.3, 1.39, 1.16),
      },
      suv: {
        scene: suv.scene,
        bodyMaterials: new Set(['White']),
        scale: new THREE.Vector3(1.13, 1.2, 0.976),
      },
      wreck: {
        scene: wreck.scene,
        bodyMaterials: new Set(),
        scale: new THREE.Vector3(0.775, 0.955, 0.731),
      },
    };
    for (const source of Object.values(authoredVehicleSources)) {
      source.scene.updateMatrixWorld(true);
      source.cache = new Map();
    }
  } catch (error) {
    console.warn('[bp] authored vehicle assets unavailable; using procedural fleet', error);
  }
}

let frontlineInteriorAtlas = null;
if (quality.desktop) {
  try {
    frontlineInteriorAtlas = await new THREE.TextureLoader().loadAsync(
      './assets/windows/frontline-interiors-atlas-v2.webp');
    frontlineInteriorAtlas.colorSpace = THREE.SRGBColorSpace;
    frontlineInteriorAtlas.anisotropy = Math.min(quality.maxAnisotropy || 4, 8);
    frontlineInteriorAtlas.generateMipmaps = true;
    frontlineInteriorAtlas.wrapS = frontlineInteriorAtlas.wrapT = THREE.ClampToEdgeWrapping;
  } catch (error) {
    console.warn('[bp] photographic window interiors unavailable; using material fallback', error);
  }
}

const mats = {};
const material = (key, make) => mats[key] || (mats[key] = make());
const standard = (key, color, roughness = 0.7, metalness = 0) =>
  material(key, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));

class InstanceBatcher {
  constructor(scene) {
    this.scene = scene;
    this.batches = new Map();
  }

  add(key, geometry, mat, matrix, shadows = false, color = null) {
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { geometry, mat, matrices: [], colors: [], shadows };
      this.batches.set(key, batch);
    }
    batch.matrices.push(matrix.clone());
    batch.colors.push(color == null ? null : new THREE.Color(color));
  }

  flush() {
    for (const [key, batch] of this.batches) {
      const out = new THREE.InstancedMesh(
        batch.geometry, batch.mat, batch.matrices.length);
      out.name = key;
      out.userData.instanceCount = batch.matrices.length;
      for (let i = 0; i < batch.matrices.length; i++) {
        out.setMatrixAt(i, batch.matrices[i]);
        if (batch.colors[i]) out.setColorAt(i, batch.colors[i]);
      }
      out.instanceMatrix.needsUpdate = true;
      if (out.instanceColor) out.instanceColor.needsUpdate = true;
      out.castShadow = batch.shadows && quality.shadows;
      out.receiveShadow = quality.shadows;
      out.frustumCulled = true;
      this.scene.add(out);
    }
  }
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const FACADE_PANEL_GEO = (() => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const uv = geometry.attributes.uv;
  // Four photographic plaster repeats across each property cap. Instanced scale changes the
  // lot width but not the UVs, so this fixed repeat avoids smearing one photograph over 12m.
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 4);
  uv.needsUpdate = true;
  return geometry;
})();
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
const WINDOW_INTERIOR_GEOS = Array.from({ length: 4 }, (_, tile) => {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const uv = geometry.attributes.uv;
  const column = tile % 2;
  const rowFromTop = Math.floor(tile / 2);
  // Image generation left a clean 13px-equivalent black guard around each 512px tile.
  // Crop inside it so minification cannot bleed a neighbouring room through the frame.
  const pad = 0.013;
  const u0 = column * 0.5 + pad;
  const u1 = (column + 1) * 0.5 - pad;
  const v0 = rowFromTop === 0 ? 0.5 + pad : pad;
  const v1 = rowFromTop === 0 ? 1 - pad : 0.5 - pad;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      THREE.MathUtils.lerp(u0, u1, uv.getX(i)),
      THREE.MathUtils.lerp(v0, v1, uv.getY(i)),
    );
  }
  uv.needsUpdate = true;
  return geometry;
});
const STALL_POST = new THREE.CylinderGeometry(0.045, 0.045, 3.05, 10);
const STALL_PRODUCE = new THREE.SphereGeometry(0.13, 9, 6);
const STALL_BULB = new THREE.SphereGeometry(0.075, 10, 6);
const STALL_CANOPY = (() => {
  const geometry = new THREE.PlaneGeometry(5.35, 2.65, 10, 5);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) / 2.68;
    positions.setZ(i, -0.12 * (1 - x * x));
  }
  geometry.computeVertexNormals();
  return geometry;
})();
const localMatrix = new THREE.Matrix4();
const localPosition = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localScale = new THREE.Vector3();
const localEuler = new THREE.Euler();

function instanceMatrix(parent, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  localPosition.set(x, y, z);
  localEuler.set(rx, ry, rz);
  localQuaternion.setFromEuler(localEuler);
  localScale.set(sx, sy, sz);
  localMatrix.compose(localPosition, localQuaternion, localScale);
  return parent.clone().multiply(localMatrix);
}

function mesh(geometry, mat, shadows = true) {
  const out = new THREE.Mesh(geometry, mat);
  out.castShadow = shadows && quality.shadows;
  out.receiveShadow = quality.shadows;
  return out;
}

function bakeVehicleVertexColors(geometry, sourceMaterial, bodyMaterials, tint) {
  const position = geometry.attributes.position;
  const values = new Float32Array(position.count * 3);
  const materials = Array.isArray(sourceMaterial) ? sourceMaterial : [sourceMaterial];
  const tintColor = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.08);
  const fill = (start, count, source) => {
    const colour = bodyMaterials.has(source?.name)
      ? tintColor
      : source?.color || new THREE.Color(0xffffff);
    const end = Math.min(position.count, start + count);
    for (let i = start; i < end; i++) {
      values[i * 3] = colour.r;
      values[i * 3 + 1] = colour.g;
      values[i * 3 + 2] = colour.b;
    }
  };
  if (geometry.groups?.length) {
    for (const group of geometry.groups) {
      fill(group.start, group.count, materials[group.materialIndex] || materials[0]);
    }
  } else {
    fill(0, position.count, materials[0]);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
}

function authoredVehicleGeometry(kind, tint) {
  const source = authoredVehicleSources?.[kind];
  if (!source) return null;
  const key = source.bodyMaterials.size ? new THREE.Color(tint).getHexString() : 'fixed';
  if (source.cache.has(key)) return source.cache.get(key);

  const geometries = [];
  let sourceParts = 0;
  source.scene.traverse(object => {
    if (!object.isMesh || !object.geometry) return;
    const geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    }
    bakeVehicleVertexColors(
      geometry, object.material, source.bodyMaterials, tint);
    geometry.applyMatrix4(object.matrixWorld);
    geometries.push(geometry);
    sourceParts += Array.isArray(object.material)
      ? Math.max(1, object.geometry.groups?.length || object.material.length)
      : 1;
  });
  if (!geometries.length) return null;
  let geometry = mergeGeometries(geometries, false);
  for (const part of geometries) part.dispose();
  if (!geometry) return null;

  // Source vehicles face -Z; the game's local vehicle convention faces -X. Non-uniform scale
  // fits the existing authoritative collision dimensions without making the wheels or cabin
  // unnaturally wide simply to reach the correct bumper-to-bumper length.
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  geometry.scale(source.scale.x, source.scale.y, source.scale.z);
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox.min.y, 0);
  if (kind !== 'wreck') geometry = toCreasedNormals(geometry, Math.PI * 0.25);
  geometry.clearGroups();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.authoredVehicle = true;
  geometry.userData.sourceParts = sourceParts;
  geometry.userData.kind = kind;
  source.cache.set(key, geometry);
  return geometry;
}

function loftedVehicleShell(stations, topWidth = 0.78) {
  // The old vehicles were side silhouettes extruded to a constant width. They looked
  // acceptable exactly side-on, but the constant-width bonnet, cabin and boot exposed the
  // blockout immediately from a first-person three-quarter view. This indexed loft uses a
  // rounded sixteen-point transverse section at every longitudinal station, allowing the nose,
  // shoulders, roof and tail to taper independently while remaining one instanced geometry.
  const smoothStations = [];
  const catmull = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t
      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
      + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  // Three interpolated rings per authored interval remove the long planar bonnet, roof and
  // quarter-panel facets that made the prior "loft" look like a paper model up close.
  for (let i = 0; i < stations.length - 1; i++) {
    const p0 = stations[Math.max(0, i - 1)];
    const p1 = stations[i];
    const p2 = stations[i + 1];
    const p3 = stations[Math.min(stations.length - 1, i + 2)];
    for (let step = 0; step < 3; step++) {
      const t = step / 3;
      smoothStations.push(p1.map((value, axis) => catmull(
        p0[axis], value, p2[axis], p3[axis], t)));
    }
  }
  smoothStations.push(stations[stations.length - 1]);
  const section = [
    [-0.72, 0], [-0.89, 0.045], [-0.98, 0.16], [-1, 0.36],
    [-0.975, 0.55], [-0.91, 0.72], [-topWidth, 0.92], [-topWidth * 0.82, 1],
    [topWidth * 0.82, 1], [topWidth, 0.92], [0.91, 0.72], [0.975, 0.55],
    [1, 0.36], [0.98, 0.16], [0.89, 0.045], [0.72, 0],
  ];
  const positions = [];
  const uvs = [];
  const indices = [];
  const ring = section.length;

  for (let s = 0; s < smoothStations.length; s++) {
    const [x, bottom, top, halfWidth] = smoothStations[s];
    const height = top - bottom;
    for (const [zFactor, yFactor] of section) {
      positions.push(x, bottom + height * yFactor, zFactor * halfWidth);
      uvs.push(s / (smoothStations.length - 1), yFactor);
    }
  }
  for (let s = 0; s < smoothStations.length - 1; s++) {
    const next = (s + 1) * ring;
    const here = s * ring;
    for (let i = 0; i < ring; i++) {
      const j = (i + 1) % ring;
      indices.push(here + i, next + i, next + j, here + i, next + j, here + j);
    }
  }
  // Close both ends. The cap is rarely exposed, but a closed volume gives correct lighting
  // at damaged bumpers and prevents a bright road sliver from showing through the nose.
  for (const [station, reverse] of [[0, true], [smoothStations.length - 1, false]]) {
    const center = positions.length / 3;
    const [x, bottom, top] = smoothStations[station];
    positions.push(x, (bottom + top) / 2, 0);
    uvs.push(station / (smoothStations.length - 1), 0.5);
    const base = station * ring;
    for (let i = 0; i < ring; i++) {
      const j = (i + 1) % ring;
      // Minimum-X faces point outward toward -X; maximum-X faces point toward +X.
      if (reverse) indices.push(center, base + j, base + i);
      else indices.push(center, base + i, base + j);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function doubleSidedWindowPanels(polygons, sideOffset) {
  // Separate panes leave real painted B/C pillars between windows. The previous single black
  // extrusion covered the whole side of the cabin and read as a toy-car sticker.
  const positions = [];
  const uvs = [];
  const indices = [];
  for (const side of [-1, 1]) {
    for (const polygon of polygons) {
      const base = positions.length / 3;
      for (let i = 0; i < polygon.length; i++) {
        const [x, y] = polygon[i];
        positions.push(x, y, side * sideOffset);
        uvs.push(i === 0 || i === polygon.length - 1 ? 0 : 1, y);
      }
      for (let i = 1; i < polygon.length - 1; i++) {
        if (side > 0) indices.push(base, base + i, base + i + 1);
        else indices.push(base, base + i + 1, base + i);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function transverseWindowPane(bottom, top) {
  const [bottomX, bottomY, bottomHalf] = bottom;
  const [topX, topY, topHalf] = top;
  const across = 8;
  const positions = [];
  const uvs = [];
  const indices = [];
  const outward = Math.sign(bottomX - topX) || 1;
  for (let i = 0; i <= across; i++) {
    const t = i / across;
    const side = t * 2 - 1;
    const bow = outward * 0.045 * (1 - side * side);
    positions.push(
      bottomX + bow, bottomY, side * bottomHalf,
      topX + bow, topY, side * topHalf,
    );
    uvs.push(t, 0, t, 1);
  }
  for (let i = 0; i < across; i++) {
    const base = i * 2;
    indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const SEDAN_LOWER = loftedVehicleShell([
  [-2.25, 0.31, 0.49, 0.68], [-2.12, 0.27, 0.76, 0.9],
  [-1.73, 0.25, 0.91, 0.98], [-0.9, 0.24, 0.96, 0.99],
  [0.75, 0.24, 0.96, 1], [1.69, 0.25, 0.9, 0.97],
  [2.12, 0.28, 0.71, 0.88], [2.25, 0.33, 0.48, 0.65],
], 0.8);
const SEDAN_CABIN = loftedVehicleShell([
  [-1.17, 0.88, 0.95, 0.72], [-0.73, 0.89, 1.46, 0.83],
  [-0.39, 0.9, 1.57, 0.86], [0.7, 0.91, 1.55, 0.86],
  [1.15, 0.92, 1.28, 0.82], [1.36, 0.93, 0.99, 0.7],
], 0.72);
const SEDAN_WINDOW = doubleSidedWindowPanels([
  [[-0.98, 0.98], [-0.53, 1.4], [-0.29, 1.47], [0.05, 1.46], [0.05, 0.98]],
  [[0.24, 0.98], [0.24, 1.46], [0.66, 1.44], [1.13, 0.99]],
], 0.86);
const SEDAN_WINDSCREEN = transverseWindowPane(
  [-1.08, 0.97, 0.78], [-0.51, 1.48, 0.72]);
const SEDAN_REAR_GLASS = transverseWindowPane(
  [1.25, 0.98, 0.77], [0.68, 1.47, 0.72]);
const HATCH_LOWER = loftedVehicleShell([
  [-2.06, 0.31, 0.48, 0.66], [-1.94, 0.27, 0.74, 0.88],
  [-1.55, 0.24, 0.91, 0.96], [-0.75, 0.23, 0.96, 0.99],
  [1.15, 0.24, 0.96, 0.99], [1.7, 0.26, 0.88, 0.94],
  [1.98, 0.3, 0.67, 0.82], [2.07, 0.34, 0.47, 0.64],
], 0.8);
const HATCH_CABIN = loftedVehicleShell([
  [-1.2, 0.87, 0.94, 0.71], [-0.69, 0.88, 1.47, 0.82],
  [-0.35, 0.9, 1.6, 0.86], [1.13, 0.92, 1.58, 0.86],
  [1.53, 0.92, 1.27, 0.8], [1.69, 0.92, 0.99, 0.7],
], 0.72);
const HATCH_WINDOW = doubleSidedWindowPanels([
  [[-1.02, 0.97], [-0.55, 1.42], [-0.27, 1.51], [0.08, 1.51], [0.08, 0.97]],
  [[0.27, 0.97], [0.27, 1.51], [1.06, 1.5], [1.45, 1.15], [1.49, 0.98]],
], 0.86);
const HATCH_WINDSCREEN = transverseWindowPane(
  [-1.11, 0.97, 0.78], [-0.53, 1.5, 0.72]);
const HATCH_REAR_GLASS = transverseWindowPane(
  [1.62, 1, 0.76], [1.12, 1.51, 0.72]);
const SUV_LOWER = loftedVehicleShell([
  [-2.31, 0.38, 0.57, 0.72], [-2.18, 0.31, 0.84, 0.96],
  [-1.75, 0.29, 1.01, 1.04], [-0.86, 0.28, 1.06, 1.06],
  [1.42, 0.29, 1.07, 1.06], [1.83, 0.31, 0.99, 1.02],
  [2.2, 0.36, 0.81, 0.94], [2.32, 0.41, 0.57, 0.72],
], 0.82);
const SUV_CABIN = loftedVehicleShell([
  [-1.27, 0.98, 1.06, 0.78], [-0.82, 1, 1.61, 0.89],
  [-0.48, 1.01, 1.74, 0.92], [1.39, 1.02, 1.73, 0.92],
  [1.71, 1.02, 1.42, 0.86], [1.82, 1.02, 1.1, 0.75],
], 0.74);
const SUV_WINDOW = doubleSidedWindowPanels([
  [[-1.08, 1.08], [-0.68, 1.56], [-0.39, 1.66], [0.11, 1.66], [0.11, 1.08]],
  [[0.3, 1.08], [0.3, 1.66], [1.28, 1.65], [1.6, 1.34], [1.63, 1.09]],
], 0.92);
const SUV_WINDSCREEN = transverseWindowPane(
  [-1.17, 1.08, 0.84], [-0.52, 1.67, 0.77]);
const SUV_REAR_GLASS = transverseWindowPane(
  [1.75, 1.09, 0.82], [1.34, 1.66, 0.77]);
const VEHICLE_TYPES = [
  {
    key: 'sedan', lower: SEDAN_LOWER, cabin: SEDAN_CABIN, window: SEDAN_WINDOW,
    windscreen: SEDAN_WINDSCREEN, rearGlass: SEDAN_REAR_GLASS,
    wheels: [-1.42, 1.42],
    bodyHalf: 0.97, cabinHalf: 0.845, front: -2.3, rear: 2.34,
  },
  {
    key: 'hatch', lower: HATCH_LOWER, cabin: HATCH_CABIN, window: HATCH_WINDOW,
    windscreen: HATCH_WINDSCREEN, rearGlass: HATCH_REAR_GLASS,
    wheels: [-1.29, 1.34],
    bodyHalf: 0.965, cabinHalf: 0.845, front: -2.13, rear: 2.13,
  },
  {
    key: 'suv', lower: SUV_LOWER, cabin: SUV_CABIN, window: SUV_WINDOW,
    windscreen: SUV_WINDSCREEN, rearGlass: SUV_REAR_GLASS,
    wheels: [-1.47, 1.47],
    bodyHalf: 1.03, cabinHalf: 0.9, front: -2.37, rear: 2.4,
  },
];
const TYRE_GEO = new THREE.TorusGeometry(0.36, 0.105, 14, 32);
const HUB_GEO = new THREE.CylinderGeometry(0.23, 0.23, 0.045, 24);
const CAP_GEO = new THREE.CylinderGeometry(0.075, 0.075, 0.052, 16);
const RIM_SPOKE_GEO = new THREE.CapsuleGeometry(0.017, 0.13, 3, 7);
const MIRROR_GEO = new THREE.SphereGeometry(0.11, 12, 8);
const HANDLE_GEO = new THREE.CapsuleGeometry(0.018, 0.11, 3, 8);
const HEADREST_GEO = new THREE.CapsuleGeometry(0.12, 0.13, 4, 8);
const VEHICLE_LAMP_GEO = new THREE.SphereGeometry(0.5, 14, 9);
const VEHICLE_BUMPER_GEO = new THREE.CapsuleGeometry(0.08, 1.3, 4, 10);
const POLICE_PUSH_BAR_GEO = new THREE.CapsuleGeometry(0.045, 0.68, 4, 9);
const POLICE_LIGHTBAR_GEO = new THREE.CapsuleGeometry(0.055, 0.42, 4, 10);
const VEHICLE_BURN_SCAR_GEO = (() => {
  const shape = new THREE.Shape();
  const points = [
    [-0.48, -0.08], [-0.34, -0.37], [-0.04, -0.46], [0.25, -0.34],
    [0.48, -0.05], [0.35, 0.29], [0.02, 0.43], [-0.31, 0.3],
  ];
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
})();
const VEHICLE_GRILLE_GEO = (() => {
  const shape = new THREE.Shape();
  const w = 0.88, h = 0.24, r = 0.065;
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return new THREE.ShapeGeometry(shape);
})();
const SHARD_GEO = (() => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.35, 0, -0.18, 0.5, 0,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
})();
const FACADE_SCAR_GEO = (() => {
  const points = [
    [-0.68, -0.18], [-0.5, -0.54], [-0.08, -0.72], [0.3, -0.56],
    [0.71, -0.2], [0.58, 0.18], [0.31, 0.62], [-0.1, 0.74],
    [-0.51, 0.48], [-0.76, 0.11],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
})();
const DAMAGED_PARAPET_GEO = (() => {
  // A shallow extruded wall cap with an irregular shell-struck upper edge. Scaling this
  // geometry produces different lot widths/heights while keeping a real return along the
  // roof, so the silhouette does not collapse into a cardboard plane from oblique angles.
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0.5, 0.28);
  shape.lineTo(0.36, 0.34);
  shape.lineTo(0.23, 0.18);
  shape.lineTo(0.04, 0.43);
  shape.lineTo(-0.13, 0.22);
  shape.lineTo(-0.29, 0.38);
  shape.lineTo(-0.5, 0.29);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.5,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.012,
    bevelThickness: 0.012,
  });
  geometry.translate(0, 0, -0.25);
  geometry.computeVertexNormals();
  return geometry;
})();
function extrudedSkylineProfile(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    steps: 1,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -0.5);
  geometry.computeVertexNormals();
  return geometry;
}
const SKYLINE_GABLE_GEO = extrudedSkylineProfile([
  [-0.5, 0], [0.5, 0], [0.5, 0.08], [0, 0.5], [-0.5, 0.08],
]);
const SKYLINE_SAWTOOTH_GEO = extrudedSkylineProfile([
  [-0.5, 0], [0.5, 0], [0.5, 0.1],
  [0.32, 0.45], [0.32, 0.1],
  [0.13, 0.42], [0.13, 0.1],
  [-0.06, 0.47], [-0.06, 0.1],
  [-0.25, 0.4], [-0.25, 0.1],
  [-0.43, 0.43], [-0.5, 0.14],
]);
const SKYLINE_COLLAPSED_GEO = extrudedSkylineProfile([
  [-0.5, 0], [0.5, 0], [0.5, 0.23], [0.38, 0.19],
  [0.27, 0.4], [0.1, 0.16], [-0.05, 0.34], [-0.18, 0.11],
  [-0.34, 0.28], [-0.5, 0.17],
]);
const DRAIN_GEO = new THREE.CylinderGeometry(0.055, 0.065, 1, 8);
const AC_FAN_GEO = new THREE.CylinderGeometry(0.22, 0.22, 0.035, 12);
const ROOF_CAP_GEO = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0.5, 0.26);
  shape.lineTo(0, 0.62);
  shape.lineTo(-0.5, 0.26);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1, bevelEnabled: false, curveSegments: 1,
  });
  geometry.translate(0, 0, -0.5);
  geometry.computeVertexNormals();
  return geometry;
})();

function addPoliceVehicleDetails(batcher, parent, type) {
  const trim = standard('vehicle-trim', 0x11161a, 0.54, 0.16);
  const white = standard('police-white', 0xe5eaed, 0.38, 0.18);
  for (const side of [-1, 1]) {
    batcher.add('police-doors', UNIT_PLANE, white,
      instanceMatrix(parent, 0.15, 0.67, side * 0.998, 1.45, 0.5, 1,
        0, side < 0 ? Math.PI : 0));
  }
  batcher.add('police-lightbar-base', VEHICLE_BUMPER_GEO, trim,
    instanceMatrix(parent, 0.18, 1.59, 0, 0.52, 0.9, 0.9, Math.PI / 2, 0, 0));
  for (const y of [0.54, 0.88]) {
    batcher.add('police-push-bars', POLICE_PUSH_BAR_GEO, trim,
      instanceMatrix(parent, type.front - 0.16, y, 0, 1.1, 1.9, 1.9,
        Math.PI / 2, 0, 0));
  }
  for (const z of [-0.52, 0.52]) {
    batcher.add('police-push-bars', POLICE_PUSH_BAR_GEO, trim,
      instanceMatrix(parent, type.front - 0.14, 0.76, z, 1.1, 0.8, 1.1));
  }
  for (const [z, col] of [[-0.38, 0xd51f28], [0.38, 0x245dff]]) {
    batcher.add(`police-lens-${col}`, POLICE_LIGHTBAR_GEO,
      material(`police-lens-${col}`, () => new THREE.MeshPhysicalMaterial({
        color: col, emissive: col, emissiveIntensity: 0.22,
        roughness: 0.16, metalness: 0.02, transparent: true, opacity: 0.82,
        clearcoat: 1,
      })),
      instanceMatrix(parent, 0.18, 1.68, z, 1.25, 0.78, 0.78,
        Math.PI / 2, 0, 0));
  }
}

function addAuthoredVehicle(batcher, def, type, bodyColor, parent, wrecked) {
  if (!authoredVehicleSources) return false;
  const kind = wrecked ? 'wreck' : type.key;
  const geometry = authoredVehicleGeometry(kind, bodyColor);
  if (!geometry) return false;
  const fixedColour = wrecked ? 'fixed' : new THREE.Color(bodyColor).getHexString();
  const vehicleMat = material(
    wrecked ? 'authored-vehicle-wreck' : 'authored-vehicle-finish',
    () => new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: wrecked ? 0.78 : 0.42,
      metalness: wrecked ? 0.16 : 0.12,
      clearcoat: wrecked ? 0.04 : 0.55,
      clearcoatRoughness: 0.3,
      envMapIntensity: wrecked ? 0.62 : 1.05,
    }),
  );
  batcher.add(`vehicle-authored-${kind}-${fixedColour}`, geometry, vehicleMat, parent);

  // A close car is now one coherent authored object, so generic boxes no longer stand in for
  // doors, wheel openings or glass. Police equipment remains a shared operational hardware kit.
  if (def.police) addPoliceVehicleDetails(batcher, parent, type);
  return true;
}

function addVehicle(batcher, def) {
  const damage = def.damage ?? Math.abs(Math.round(def.x * 17 + def.z * 31)) % 7;
  const type = VEHICLE_TYPES[def.police ? 0 : Math.abs(def.variant ?? 0) % VEHICLE_TYPES.length];
  const wrecked = !def.police && damage === 0;
  const bodyColor = wrecked ? 0x242321 : def.color;
  const parent = new THREE.Matrix4().compose(
    new THREE.Vector3(def.x, 0.01, def.z),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), def.rotZAxis ? Math.PI / 2 : 0),
    new THREE.Vector3(1, 1, 1),
  );
  if (addAuthoredVehicle(batcher, def, type, bodyColor, parent, wrecked)) return;
  const paint = material('vehicle-paint-instanced', () => new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.32, metalness: 0.04,
    clearcoat: 0.68, clearcoatRoughness: 0.24, envMapIntensity: 1.15,
    side: THREE.DoubleSide,
  }));
  const trim = standard('vehicle-trim', 0x11161a, 0.54, 0.16);
  const rubber = standard('vehicle-rubber', 0x090b0d, 0.96, 0);
  const rim = standard('vehicle-rim', 0x7e8991, 0.24, 0.82);
  const interior = standard('vehicle-interior', 0x171a1c, 0.82, 0.02);
  const plate = standard('vehicle-plate', 0xc7c8bd, 0.42, 0.16);
  const glass = material('vehicle-glass', () => new THREE.MeshPhysicalMaterial({
    // At night automotive glass reads near-black with a restrained sky reflection. The
    // previous bright blue-grey environment response turned every pane into an opaque slab.
    color: 0x071017, roughness: 0.24, metalness: 0.04,
    transmission: 0, transparent: false,
    clearcoat: 0.72, clearcoatRoughness: 0.16, envMapIntensity: 0.58,
    side: THREE.DoubleSide,
  }));
  const grime = standard('vehicle-road-grime', 0x282824, 0.98, 0.01);
  const burnScar = material('vehicle-burn-scar', () => new THREE.MeshBasicMaterial({
    color: 0x171817, transparent: true, opacity: 0.52, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide,
  }));
  const shattered = standard('vehicle-shattered-glass', 0x10171b, 0.88, 0.03);

  // Vehicle shells deliberately do not enter the coarse city shadow map. At street scale
  // its low-angle projection becomes a hard black wedge several metres long, which is more
  // conspicuous than omitting the shadow; contact and depth still come from the wheels,
  // authored soft contact patches and the cars receiving surrounding building shadows.
  batcher.add(`vehicle-${type.key}-lower`, type.lower, paint, parent, false, bodyColor);
  batcher.add(`vehicle-${type.key}-cabin`, type.cabin, paint, parent, false, bodyColor);
  const glassSide = type.cabinHalf + 0.014;
  const trimSide = type.bodyHalf + 0.028;
  const wheelSide = type.bodyHalf + 0.06;
  batcher.add(`vehicle-${type.key}-side-glass`, type.window, wrecked ? shattered : glass,
    parent);
  for (const side of [-1, 1]) {
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, 0.18, 1.2, side * (glassSide + 0.025), 0.085, 0.55, 0.055));
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, -0.58, 1.2, side * (glassSide + 0.026), 0.055, 0.5, 0.052));
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, 0.08, 0.95, side * (glassSide + 0.025), 2.15, 0.055, 0.06));
    batcher.add('vehicle-mirror', MIRROR_GEO, trim,
      instanceMatrix(parent, -0.92, 1.12, side * (type.bodyHalf + 0.1), 1.35, 0.65, 0.75));
    for (const x of [-0.72, 0.86]) {
      batcher.add('vehicle-trim-box', UNIT_BOX, trim,
        instanceMatrix(parent, x, 0.65, side * trimSide, 0.018, 0.62, 0.014));
      batcher.add('vehicle-handles', HANDLE_GEO, trim,
        instanceMatrix(parent, x + 0.23, 0.83, side * (trimSide + 0.014),
          1, 1, 1, 0, 0, Math.PI / 2));
    }
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, -0.02, 0.91, side * trimSide, 3.26, 0.025, 0.016));
  }

  // The glasshouse is a volume, not a dark decal pasted on each side. Angled front/rear
  // panes, a visible interior and pillars prevent the profile from reading as two stacked
  // boxes when the player approaches from either end.
  batcher.add(`vehicle-${type.key}-windscreen`, type.windscreen,
    wrecked ? shattered : glass, parent);
  batcher.add(`vehicle-${type.key}-rear-glass`, type.rearGlass,
    wrecked ? shattered : glass, parent);
  for (const side of [-0.45, 0.45]) {
    batcher.add('vehicle-seats', UNIT_BOX, interior,
      instanceMatrix(parent, 0.12, 0.96, side, 0.42, 0.58, 0.44, 0, 0, -0.08));
    batcher.add('vehicle-headrests', HEADREST_GEO, interior,
      instanceMatrix(parent, 0.18, 1.34, side, 0.9, 0.9, 0.9));
  }

  for (const x of type.wheels) for (const side of [-1, 1]) {
    batcher.add('vehicle-tyres', TYRE_GEO, rubber,
      instanceMatrix(parent, x, 0.4, side * wheelSide, 1, 1, 1), false);
    batcher.add('vehicle-hubs', HUB_GEO, rim,
      instanceMatrix(parent, x, 0.4, side * (wheelSide + 0.025), 1, 1, 1, Math.PI / 2));
    batcher.add('vehicle-caps', CAP_GEO, trim,
      instanceMatrix(parent, x, 0.4, side * (wheelSide + 0.055), 1, 1, 1, Math.PI / 2));
    for (let spoke = 0; spoke < 5; spoke++) {
      const angle = spoke * Math.PI * 2 / 5;
      batcher.add('vehicle-rim-spokes', RIM_SPOKE_GEO, rim,
        instanceMatrix(parent,
          x - Math.sin(angle) * 0.1,
          0.4 + Math.cos(angle) * 0.1,
          side * (wheelSide + 0.061),
          1, 1, 1, 0, 0, angle));
    }
  }

  for (const side of [-0.56, 0.56]) {
    batcher.add('vehicle-headlights', VEHICLE_LAMP_GEO,
      material('headlamp', () => new THREE.MeshPhysicalMaterial({
        color: 0x9da9a4, emissive: 0x727d76, emissiveIntensity: 0.025,
        roughness: 0.18, metalness: 0.05, clearcoat: 1,
      })),
      instanceMatrix(parent, type.front - 0.018, 0.67, side, 0.055, 0.17, 0.39));
    batcher.add('vehicle-taillights', VEHICLE_LAMP_GEO,
      standard('taillamp', 0x8f1514, 0.18, 0),
      instanceMatrix(parent, type.rear + 0.018, 0.67, side, 0.055, 0.18, 0.37));
  }
  for (const x of [type.front - 0.025, type.rear + 0.025]) {
    batcher.add('vehicle-bumpers', VEHICLE_BUMPER_GEO, trim,
      instanceMatrix(parent, x, 0.34, 0, 0.72, 1, 1, Math.PI / 2, 0, 0));
  }
  batcher.add('vehicle-grilles', VEHICLE_GRILLE_GEO, trim,
    instanceMatrix(parent, type.front - 0.036, 0.52, 0, 1, 1, 1, 0, -Math.PI / 2));
  for (const x of [type.front - 0.05, type.rear + 0.05]) {
    batcher.add('vehicle-plates', UNIT_BOX, plate,
      instanceMatrix(parent, x, 0.39, 0, 0.018, 0.13, 0.42));
  }
  // Panel gaps and rocker trim give scale at first-person distance without unique textures.
  for (const side of [-1, 1]) {
    batcher.add('vehicle-panel-lines', UNIT_BOX, trim,
      instanceMatrix(parent, -0.21, 0.68, side * trimSide, 0.018, 0.62, 0.012));
    batcher.add('vehicle-rockers', UNIT_BOX, trim,
      instanceMatrix(parent, 0, 0.28, side * trimSide, 3.38, 0.08, 0.035));
  }
  // Bonnet and boot shut-lines catch a highlight at close range and communicate real panel
  // scale without spending unique textures or meshes per vehicle.
  batcher.add('vehicle-panel-lines', UNIT_BOX, trim,
    instanceMatrix(parent, -1.55, 0.94, 0, 0.022, 0.014, 1.45, 0, 0, -0.08));
  batcher.add('vehicle-panel-lines', UNIT_BOX, trim,
    instanceMatrix(parent, 1.53, 0.93, 0, 0.022, 0.014, 1.42, 0, 0, 0.06));

  // Deterministic wear makes parked cars part of the battered district instead of pristine
  // showroom props. It stays instanced, so an entire street still costs only a few draws.
  if (!def.police) {
    for (const side of [-1, 1]) {
      batcher.add('vehicle-grime', UNIT_BOX, grime,
        instanceMatrix(parent, 0.05, 0.46, side * (trimSide + 0.01), 3.75, 0.23, 0.018));
    }
    if (damage <= 2) {
      const side = damage % 2 ? -1 : 1;
      batcher.add(`vehicle-${type.key}-shattered`, type.window, shattered,
        instanceMatrix(parent, 0, 0.008, side * 0.004, 0.98, 0.96, 1));
      batcher.add('vehicle-dent', UNIT_BOX, grime,
        instanceMatrix(parent, 1.22, 0.71, -side * (trimSide + 0.01), 0.58, 0.32, 0.022,
          0, 0, damage === 2 ? 0.11 : -0.08));
    }
    if (wrecked) {
      batcher.add('vehicle-missing-hub', CAP_GEO, rubber,
        instanceMatrix(parent, type.wheels[1], 0.4, wheelSide + 0.065,
          1.35, 1.35, 1.1, Math.PI / 2));
      // Ash on the bonnet and a dropped bumper sell an abandoned strike-damaged shell.
      batcher.add('vehicle-burn-scars', VEHICLE_BURN_SCAR_GEO, burnScar,
        instanceMatrix(parent, -1.38, 0.972, 0, 0.82, 1.16, 1,
          -Math.PI / 2, 0, -0.08));
      batcher.add('vehicle-dropped-bumpers', UNIT_BOX, trim,
        instanceMatrix(parent, type.rear + 0.03, 0.2, 0.17,
          0.12, 0.11, 1.5, 0.16, 0.04, 0.12));
    }
  }

  if (def.police) addPoliceVehicleDetails(batcher, parent, type);
}

function addFacade(batcher, def) {
  const R = rng(def.seed);
  const dx = def.x2 - def.x1, dz = def.z2 - def.z1;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  let nx = -uz, nz = ux;
  if (def.away) {
    const mx = (def.x1 + def.x2) / 2 - def.away[0];
    const mz = (def.z1 + def.z2) / 2 - def.away[1];
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
  }
  const yaw = Math.atan2(nx, nz);
  const frameMat = standard('window-frame', 0x343b41, 0.56, 0.34);
  const recessMat = standard('window-recess', 0x05080b, 0.96, 0);
  const glassDark = material('architectural-glass', () => new THREE.MeshPhysicalMaterial({
    color: 0x283b45, roughness: 0.22, metalness: 0.1,
    transparent: true, opacity: 0.38, clearcoat: 1,
    clearcoatRoughness: 0.12, envMapIntensity: 1.28,
  }));
  const floorH = def.floorH ?? 3;
  const step = def.step ?? 3;
  // A contact-line district does not have a third of every room blazing. Besides looking
  // implausible, emissive-pane density flattened the facade into a grid of white cards.
  const litChance = Math.min(0.2, def.lit ?? 0.18);
  // This district has been on the contact line for weeks. A mostly pristine repeated grid
  // reads as an office-park generator even when the masonry beneath it is excellent.
  const damageChance = def.damage ?? 0.42;
  const warmRoom = material('window-room-warm', () => new THREE.MeshStandardMaterial({
    color: 0x8f6748, emissive: 0xffa75b, emissiveIntensity: 0.12, roughness: 0.96,
  }));
  const coolRoom = material('window-room-cool', () => new THREE.MeshStandardMaterial({
    color: 0x526c82, emissive: 0x78add7, emissiveIntensity: 0.1, roughness: 0.96,
  }));
  const photoRooms = frontlineInteriorAtlas
    ? [0, 1, 2, 3].map(tile => material(
      `window-room-photo-${tile}`,
      () => new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: frontlineInteriorAtlas,
        emissive: 0xffffff,
        emissiveMap: frontlineInteriorAtlas,
        emissiveIntensity: [0.13, 0.11, 0.018, 0.012][tile],
        roughness: 0.96,
        metalness: 0,
      }),
    ))
    : null;
  const sillMat = standard('window-sill', 0x8f969a, 0.82, 0.02);
  const blindMat = standard('blind', 0xb9ae9d, 0.9, 0);
  const revealMat = standard('window-reveal', 0x555b5d, 0.95, 0.01);
  const curtainMat = standard('window-curtain', 0x554941, 0.98, 0);
  const interiorMat = standard('window-interior-silhouette', 0x141719, 0.92, 0.02);
  const boardMat = standard('window-boards', 0x5a4533, 0.94, 0);
  const sootMat = material('facade-soot', () => new THREE.MeshBasicMaterial({
    color: 0x0a0b0b, transparent: true, opacity: 0.66,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  const shardMat = material('window-shards', () => new THREE.MeshPhysicalMaterial({
    color: 0x3d5968, roughness: 0.22, metalness: 0.06,
    transparent: true, opacity: 0.34, side: THREE.DoubleSide,
  }));
  const utilityMat = standard('facade-utility', 0x394043, 0.7, 0.48);
  const acMat = standard('facade-ac', 0x596166, 0.82, 0.28);
  const shellMat = material('facade-shell-photo', () => {
    const photo = photoSurfaces()?.plaster;
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: photo?.map || null,
      bumpMap: photo?.height || null,
      bumpScale: photo?.height ? 0.026 : 0,
      roughness: 0.92,
      metalness: 0.01,
    });
  });
  const copingMat = standard('facade-coping', 0x63686a, 0.9, 0.025);
  const balconyMat = standard('facade-balcony', 0x686e70, 0.9, 0.03);
  const balconyRailMat = standard('facade-balcony-rail', 0x343b3e, 0.68, 0.48);
  const masonryMat = material('facade-exposed-masonry-photo', () => {
    const photo = photoSurfaces()?.brick;
    return new THREE.MeshStandardMaterial({
      color: 0x8b7668,
      map: photo?.map || null,
      bumpMap: photo?.height || null,
      bumpScale: photo?.height ? 0.045 : 0,
      roughness: 0.96,
      metalness: 0,
    });
  });

  const facadeParent = new THREE.Matrix4().compose(
    new THREE.Vector3(
      (def.x1 + def.x2) / 2 + nx * (def.out ?? 0.2),
      def.yBase,
      (def.z1 + def.z2) / 2 + nz * (def.out ?? 0.2),
    ),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(1, 1, 1),
  );
  // Split even a hundred-metre collision wall into individual property widths. The base wall
  // remains the authoritative collision and photographic skin; these shallow shell pieces
  // create stepped roof massing, party-wall rhythm and damage without changing navigation.
  const lots = [];
  let lotStart = -len / 2;
  while (lotStart < len / 2 - 0.25) {
    const remaining = len / 2 - lotStart;
    const preferred = 7.5 + R() * 5.5;
    const width = remaining < preferred + 4 ? remaining : preferred;
    lots.push({
      start: lotStart,
      width,
      rise: 0.52 + R() * 1.08,
      damaged: R() < damageChance * 0.62,
      tone: R() < 0.42 ? 0x697174 : R() < 0.72 ? 0x858681 : 0x6e6861,
    });
    lotStart += width;
  }
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    const centre = lot.start + lot.width / 2;
    const capWidth = Math.max(0.8, lot.width - 0.14);
    const capGeometry = lot.damaged ? DAMAGED_PARAPET_GEO : FACADE_PANEL_GEO;
    batcher.add(
      lot.damaged ? 'facade-parapets-damaged' : 'facade-parapets',
      capGeometry,
      shellMat,
      instanceMatrix(
        facadeParent,
        centre,
        def.height + lot.rise / 2 - (lot.damaged ? lot.rise * 0.03 : 0),
        -0.28,
        capWidth,
        lot.rise,
        1.05,
      ),
      true,
      lot.tone,
    );
    // Intact caps receive a projecting stone/metal coping. Damaged caps leave their jagged
    // edge exposed rather than drawing an implausibly perfect trim line through the breach.
    if (!lot.damaged) {
      batcher.add('facade-parapet-coping', UNIT_BOX, copingMat,
        instanceMatrix(facadeParent, centre, def.height + lot.rise + 0.045, 0.02,
          capWidth + 0.12, 0.09, 0.46));
    } else {
      // A soot field over photographed wall material and a smaller exposed-brick patch gives
      // shell damage two material depths instead of a black decal standing in for a hole.
      const scarX = centre + (R() - 0.5) * Math.max(0.4, lot.width * 0.36);
      const scarY = def.height - 0.65 - R() * Math.min(1.8, def.height * 0.18);
      batcher.add('facade-shell-scars', FACADE_SCAR_GEO, sootMat,
        instanceMatrix(facadeParent, scarX, scarY, 0.018,
          1.8 + R() * 1.2, 1.35 + R() * 0.75, 1, 0, 0, (R() - 0.5) * 0.28));
      batcher.add('facade-exposed-masonry', FACADE_SCAR_GEO, masonryMat,
        instanceMatrix(facadeParent, scarX + (R() - 0.5) * 0.18, scarY - 0.05, 0.025,
          1.13 + R() * 0.52, 0.78 + R() * 0.38, 1, 0, 0, (R() - 0.5) * 0.18));
    }

    // Real projecting balconies are sparse and deliberately asymmetric. A repeated window
    // grid remains useful for target reading; one damaged balcony every few lots breaks its
    // office-block cadence and gives the facade genuine first-person depth.
    if (def.height >= 5.8 && lot.width > 6.4 && R() < 0.34) {
      const balconyX = centre + (R() - 0.5) * Math.min(2, lot.width * 0.25);
      const balconyY = Math.min(def.height - 1.35, floorH + 0.08 + (R() < 0.24 ? floorH : 0));
      const balconyWidth = Math.min(3.25, Math.max(2.25, lot.width * 0.32));
      const brokenSide = R() < damageChance ? (R() < 0.5 ? -1 : 1) : 0;
      batcher.add('facade-balcony-slabs', UNIT_BOX, balconyMat,
        instanceMatrix(facadeParent, balconyX, balconyY, 0.56,
          balconyWidth, 0.16, 1.18, 0, 0, brokenSide * 0.025), true);
      batcher.add('facade-balcony-front-rails', UNIT_BOX, balconyRailMat,
        instanceMatrix(facadeParent, balconyX - brokenSide * 0.18, balconyY + 0.55, 1.08,
          balconyWidth - (brokenSide ? 0.44 : 0.1), 0.07, 0.055,
          0, 0, brokenSide * 0.065));
      for (const side of [-1, 1]) {
        if (side === brokenSide) continue;
        batcher.add('facade-balcony-side-rails', UNIT_BOX, balconyRailMat,
          instanceMatrix(facadeParent, balconyX + side * (balconyWidth / 2 - 0.05),
            balconyY + 0.55, 0.56, 0.055, 0.07, 1.02));
      }
      for (let bar = -balconyWidth / 2 + 0.28; bar < balconyWidth / 2; bar += 0.48) {
        if (brokenSide && Math.sign(bar) === brokenSide
          && Math.abs(bar) > balconyWidth * 0.24) continue;
        batcher.add('facade-balcony-balusters', UNIT_BOX, balconyRailMat,
          instanceMatrix(facadeParent, balconyX + bar, balconyY + 0.31, 1.08,
            0.045, 0.52, 0.045, 0, 0, brokenSide * 0.035));
      }
    }
  }
  // Party-wall piers project through the window plane and continue above the old flat roof.
  // They make each lot read as a separate building even where the gameplay wall is continuous.
  for (let i = 1; i < lots.length; i++) {
    const x = lots[i].start;
    const top = def.height + Math.min(lots[i - 1].rise, lots[i].rise);
    const base = len > 50 ? Math.max(0, def.height - 1.35) : 0;
    const pierHeight = top - base;
    batcher.add('facade-party-piers', UNIT_BOX, shellMat,
      instanceMatrix(facadeParent, x, base + pierHeight / 2, 0.02,
        len > 50 ? 0.12 : 0.16, pierHeight, 0.44),
      true,
      0x4b5153);
  }
  // Long street walls already carry mission-specific floor bands. On ordinary buildings,
  // interrupted lot-width ledges communicate separate construction dates without drawing a
  // mathematically perfect stripe across the whole block.
  if (len <= 50) {
    for (let y = floorH; y < def.height - 0.35; y += floorH) {
      for (const lot of lots) {
        if (R() < 0.18) continue;
        batcher.add('facade-floor-ledges', UNIT_BOX, copingMat,
          instanceMatrix(facadeParent, lot.start + lot.width / 2, y, 0.075,
            Math.max(0.5, lot.width - 0.22), 0.075, 0.3));
      }
    }
  }
  // Cornices, downpipes and wall-mounted plant break the single-box outline at negligible
  // cost because every repeated element is still one instanced batch.
  const gap = 0.55 + R() * Math.min(2.2, len * 0.12);
  for (const side of [-1, 1]) {
    const segment = Math.max(0.5, len / 2 - gap);
    batcher.add('facade-cornice', UNIT_BOX, frameMat,
      instanceMatrix(facadeParent, side * (len + gap) / 4, def.height - 0.08, 0.08,
        segment, 0.26, 0.42));
  }
  for (const x of [-len / 2 + 0.55, len / 2 - 0.55]) {
    batcher.add('facade-downpipes', DRAIN_GEO, utilityMat,
      instanceMatrix(facadeParent, x, def.height * 0.48, 0.16, 1, def.height * 0.92, 1));
  }
  if (def.height > 5 && len > 8) {
    const acCount = Math.min(3, Math.max(1, Math.floor(len / 15)));
    for (let i = 0; i < acCount; i++) {
      const x = -len * 0.3 + i * (len * 0.6 / Math.max(1, acCount - 1));
      const y = Math.min(def.height - 1.4, 2.5 + (i % 2) * 2.8);
      batcher.add('facade-ac-boxes', UNIT_BOX, acMat,
        instanceMatrix(facadeParent, x, y, 0.27, 0.72, 0.52, 0.38));
      batcher.add('facade-ac-fans', AC_FAN_GEO, utilityMat,
        instanceMatrix(facadeParent, x, y, 0.49, 1, 1, 1, Math.PI / 2));
    }
  }

  for (let fy = def.yBase + 1.2; fy < def.yBase + def.height - 1.3; fy += floorH) {
    for (let s = 1.8; s < len - 1.8; s += step) {
      if ((def.skip || []).some(g => s > g.from - 1.2 && s < g.to + 1.2)) continue;
      const parent = new THREE.Matrix4().compose(
        new THREE.Vector3(
        def.x1 + ux * s + nx * (def.out ?? 0.2),
        fy + 0.74,
        def.z1 + uz * s + nz * (def.out ?? 0.2),
        ),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        new THREE.Vector3(1, 1, 1),
      );
      const damageRoll = R();
      const destroyed = damageRoll < damageChance * 0.38;
      const boarded = !destroyed && damageRoll < damageChance * 0.68;
      const cracked = !destroyed && !boarded && damageRoll < damageChance;
      const lit = !destroyed && !boarded && R() < litChance;
      const warm = R() < 0.72;
      let roomTile = null;
      if (photoRooms && !boarded) {
        if (destroyed) roomTile = 3;
        else if (lit) roomTile = warm ? 0 : 1;
        else roomTile = 2;
      }
      const roomMat = roomTile == null
        ? (lit ? (warm ? warmRoom : coolRoom) : recessMat)
        : photoRooms[roomTile];
      const roomGeometry = roomTile == null ? UNIT_PLANE : WINDOW_INTERIOR_GEOS[roomTile];
      batcher.add(
        roomTile == null
          ? (lit ? (warm ? 'recess-warm' : 'recess-cool') : 'recess-dark')
          : `window-room-photo-${roomTile}`,
        roomGeometry, roomMat, instanceMatrix(parent, 0, 0, -0.03, 1.96, 1.74, 1));
      // Four shallow plaster returns make the 30cm bay legible at an oblique street angle.
      // They sit inside the non-solid facade overlay, so bullets and navigation still use the
      // original wall/collision definitions.
      for (const [w, h, x, y] of [
        [0.12, 1.72, -0.92, 0], [0.12, 1.72, 0.92, 0],
        [1.72, 0.1, 0, -0.78], [1.72, 0.1, 0, 0.78],
      ]) {
        batcher.add('window-reveals', UNIT_BOX, revealMat,
          instanceMatrix(parent, x, y, 0.1, w, h, 0.28));
      }
      if (!boarded && !destroyed) {
        batcher.add('pane-architectural', UNIT_PLANE, glassDark,
          instanceMatrix(parent, 0, 0, 0.235, 1.68, 1.45, 1));
      }
      const frameParts = [
        [1.98, 0.09, 0, -0.81], [1.98, 0.09, 0, 0.81],
        [0.09, 1.7, -0.94, 0], [0.09, 1.7, 0.94, 0],
      ];
      if (!destroyed && !boarded) {
        const frameStyle = Math.floor(R() * 3);
        if (frameStyle !== 1) frameParts.push([0.065, 1.52, 0, 0]);
        if (frameStyle !== 2) frameParts.push([1.78, 0.055, 0, frameStyle ? 0 : 0.18]);
      }
      for (const [w, h, x, y] of frameParts) {
        batcher.add('window-frames', UNIT_BOX, frameMat,
          instanceMatrix(parent, x, y, 0.3, w, h, 0.09));
      }
      batcher.add('window-sills', UNIT_BOX, sillMat,
        instanceMatrix(parent, 0, -0.88, 0.31, 2.16, 0.11, 0.32));
      if (boarded) {
        for (const [offset, angle] of [[-0.42, 0.1], [0, -0.06], [0.42, 0.14]]) {
          batcher.add('window-boards', UNIT_BOX, boardMat,
            instanceMatrix(parent, 0, offset, 0.35, 1.88, 0.14, 0.09,
              0, 0, angle));
        }
      } else if (destroyed || cracked) {
        for (const [x, y, rz, sx] of [
          [-0.54, -0.45, 0.18, 0.55], [0.5, -0.52, -0.12, 0.62], [0.56, 0.45, 0.2, 0.42],
        ]) {
          if (cracked && x > 0) continue;
          batcher.add('window-shards', SHARD_GEO, shardMat,
            instanceMatrix(parent, x, y, 0.33, sx * 0.72, 0.29, 1, 0, 0, rz));
        }
        if (destroyed) {
          // One bent mullion and a soot bloom stop a blown opening from reading as the same
          // pristine kit with its glass material merely switched to black.
          batcher.add('window-bent-frames', UNIT_BOX, frameMat,
            instanceMatrix(parent, -0.2, 0.12, 0.33, 0.065, 1.28, 0.09,
              0, 0, -0.24));
          if (R() < 0.74) {
            batcher.add('facade-soot', FACADE_SCAR_GEO, sootMat,
              instanceMatrix(parent, R() * 0.34 - 0.17, 0.95, 0.012,
                1.15 + R() * 0.5, 0.82 + R() * 0.46, 1, 0, 0, R() * 0.4 - 0.2));
          }
        }
      } else {
        const dressing = R();
        if (dressing < 0.28) {
          // Curtains live behind the glass and leave an irregular centre gap rather than
          // replacing the pane with another featureless rectangle.
          const gap = 0.2 + R() * 0.22;
          for (const side of [-1, 1]) {
            const width = 0.56 - gap * 0.25;
            batcher.add('window-curtains', UNIT_PLANE, curtainMat,
              instanceMatrix(parent, side * (0.52 + gap * 0.25), 0.02, 0.12,
                width, 1.34, 1, 0, 0, side * 0.025));
          }
        } else if (dressing < 0.48) {
          const partial = R() < 0.5;
          batcher.add('window-blinds', UNIT_PLANE, blindMat,
            instanceMatrix(parent, partial ? -0.47 : 0, 0.37, 0.13,
              partial ? 0.68 : 1.58, 0.65, 1));
        }
        if (lit && R() < 0.62) {
          // A cabinet/radiator silhouette creates parallax against the back wall without
          // pretending every window contains a fully modelled room.
          const side = R() < 0.5 ? -1 : 1;
          batcher.add('window-interior-furniture', UNIT_BOX, interiorMat,
            instanceMatrix(parent, side * 0.48, -0.48, 0.035,
              0.48 + R() * 0.18, 0.46 + R() * 0.22, 0.08));
        }
      }
    }
  }
}

function addRoofCap(batcher, def) {
  const parent = new THREE.Matrix4().makeTranslation(def.x, def.y, def.z);
  const roof = standard('roof-cap', 0xffffff, 0.88, 0.03);
  batcher.add('roof-caps', ROOF_CAP_GEO, roof,
    instanceMatrix(parent, 0, 0, 0, def.w * 0.96, Math.min(3.4, def.w * 0.22), def.d * 0.96),
    false, def.color);
}

function addSkylineRoofProfile(batcher, def) {
  const geometries = {
    gabled: SKYLINE_GABLE_GEO,
    industrial: SKYLINE_SAWTOOTH_GEO,
    collapsed: SKYLINE_COLLAPSED_GEO,
  };
  const geometry = geometries[def.style];
  if (!geometry) return;
  const mat = standard('skyline-profile', 0xffffff, 0.96, 0.01);
  const parent = new THREE.Matrix4().compose(
    // The profile geometry is authored from y=0 upward; its origin sits directly on the
    // highest body mass so there is no floating half-height gap under a distant roof.
    new THREE.Vector3(def.x, def.y, def.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), def.yaw || 0),
    new THREE.Vector3(1, 1, 1),
  );
  batcher.add(`skyline-profile-${def.style}`, geometry, mat,
    instanceMatrix(parent, 0, 0, 0, def.w, def.h * 2, def.d),
    false,
    def.color);
}

function addSkylineFacade(batcher, def) {
  const R = rng(def.seed);
  const yaw = Math.atan2(def.nx, def.nz);
  const parent = new THREE.Matrix4().compose(
    new THREE.Vector3(def.x, def.yBase, def.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(1, 1, 1),
  );
  // These faces sit behind the playable architecture and dissolve into fog. Strong white
  // frames would turn them into a procedural grid, so the palette stays close to the wall
  // value and relies on recess, rhythm and silhouette instead of brightness.
  const recessMat = standard('skyline-window-recess', 0x111820, 0.93, 0.015);
  const bandMat = standard('skyline-floor-band', 0xffffff, 0.96, 0);
  const scarMat = material('skyline-shell-scar', () => new THREE.MeshBasicMaterial({
    color: 0x090b0c,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  }));

  const facadeColor = new THREE.Color(def.color);
  const bandColor = facadeColor.clone().multiplyScalar(def.ring ? 0.72 : 0.82).getHex();
  const span = Math.max(3, def.span);
  const floorStep = Math.max(3.05, def.h / 11);
  const rows = Math.max(1, Math.min(11, Math.floor((def.h - 2.2) / floorStep)));
  const columns = Math.max(2, Math.min(7, Math.floor(span / 2.55)));
  const colStep = span / columns;
  const paneW = Math.min(1.35, Math.max(0.7, colStep * 0.48));
  const paneH = Math.min(1.45, Math.max(0.9, floorStep * 0.38));

  for (let row = 0; row < rows; row++) {
    const y = 1.65 + row * floorStep;
    if (y > def.h - 0.9) break;
    // One recessed row may be missing after shelling, and a few individual openings are
    // blanked or destroyed. The variation is deterministic so retries never redraw a city.
    const missingRow = def.profile === 'collapsed' && row === rows - 1;
    for (let col = 0; col < columns; col++) {
      if (missingRow && (col + def.seed) % 3 !== 0) continue;
      if (R() < (def.ring ? 0.14 : 0.09)) continue;
      const x = -span / 2 + colStep * (col + 0.5);
      batcher.add('skyline-window-recesses', UNIT_BOX, recessMat,
        instanceMatrix(parent, x, y, 0, paneW, paneH, 0.13));
    }
    // Shallow slab/cornice lines divide the enormous wall plane into believable storeys.
    // Every segment shares one InstancedMesh, even across the full skyline.
    if (row > 0 && (row % 2 === 0 || def.profile === 'industrial')) {
      batcher.add('skyline-floor-bands', UNIT_BOX, bandMat,
        instanceMatrix(parent, 0, y - floorStep * 0.48, 0.025,
          span * (0.9 + R() * 0.06), 0.11, 0.2),
        false,
        bandColor);
    }
  }

  // A projecting cap catches a narrow highlight and makes the roof edge legible from below.
  batcher.add('skyline-cornices', UNIT_BOX, bandMat,
    instanceMatrix(parent, 0, def.h - 0.16, 0.055, span * 0.96, 0.28, 0.34),
    false,
    bandColor);

  const scarChance = def.profile === 'collapsed' ? 0.96 : def.ring ? 0.16 : 0.28;
  if (R() < scarChance && def.h > 10) {
    const scarY = def.h * (0.38 + R() * 0.38);
    batcher.add('skyline-shell-scars', FACADE_SCAR_GEO, scarMat,
      instanceMatrix(parent, (R() - 0.5) * span * 0.52, scarY, 0.085,
        Math.min(span * 0.24, 3.8 + R() * 2.8),
        3.4 + R() * Math.min(5.5, def.h * 0.16), 1,
        0, 0, R() * 0.42 - 0.21));
  }
}

function addCeilingFixture(batcher, def) {
  const parent = new THREE.Matrix4().makeTranslation(def.x, def.y, def.z);
  const housing = standard('fixture-housing', 0x2b3033, 0.62, 0.42);
  const trim = standard('fixture-trim', 0x596064, 0.5, 0.5);
  const lensKey = `fixture-lens-${def.color}`;
  const lens = material(lensKey, () => new THREE.MeshStandardMaterial({
    color: 0xd8c9ad,
    emissive: new THREE.Color(def.color).multiplyScalar(0.48),
    emissiveIntensity: 0.72,
    roughness: 0.72,
    metalness: 0,
  }));
  batcher.add('ceiling-fixture-housings', UNIT_BOX, housing,
    instanceMatrix(parent, 0, -0.075, 0, def.w + 0.12, 0.13, def.d + 0.1));
  batcher.add(`ceiling-fixture-lenses-${def.color}`, UNIT_BOX, lens,
    instanceMatrix(parent, 0, -0.155, 0, def.w - 0.14, 0.045, def.d - 0.08));
  for (const x of [-def.w / 2 + 0.11, def.w / 2 - 0.11]) {
    batcher.add('ceiling-fixture-endcaps', UNIT_BOX, trim,
      instanceMatrix(parent, x, -0.17, 0, 0.09, 0.075, def.d + 0.04));
  }
  // Protective ribs turn a glowing rectangle into an industrial fitting and give the eye
  // a stable dark edge even when bloom is active.
  for (const x of [-0.24, 0.24]) {
    if (Math.abs(x) > def.w / 2 - 0.12) continue;
    batcher.add('ceiling-fixture-guards', UNIT_BOX, trim,
      instanceMatrix(parent, x, -0.185, 0, 0.025, 0.035, def.d - 0.03));
  }
}

function addMarketStall(batcher, scene, def, index) {
  const parent = new THREE.Matrix4().makeTranslation(def.x, 0, def.z);
  const steel = standard('stall-steel', 0x343a3f, 0.42, 0.72);
  const timber = standard('stall-timber', 0x70513a, 0.82, 0.02);
  const cloth = material('stall-cloth-instanced', () =>
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, side: THREE.DoubleSide }));
  cloth.side = THREE.DoubleSide;
  const produce = [
    standard('produce-red', 0x9b2925, 0.86, 0),
    standard('produce-green', 0x476c35, 0.9, 0),
    standard('produce-orange', 0xc2742d, 0.88, 0),
  ];
  batcher.add('stall-counter', UNIT_BOX, timber,
    instanceMatrix(parent, 0, 1.04, 0, 4.8, 0.16, 1.7), true);
  batcher.add('stall-cabinet', UNIT_BOX, timber,
    instanceMatrix(parent, 0, 0.52, 0, 4.55, 0.9, 1.48), true);
  for (const x of [-2.28, 2.28]) for (const z of [-0.92, 0.92]) {
    batcher.add('stall-posts', STALL_POST, steel,
      instanceMatrix(parent, x, 1.52, z, 1, 1, 1), true);
  }
  batcher.add('stall-canopies', STALL_CANOPY, cloth,
    instanceMatrix(parent, 0, 3.02, 0, 1, 1, 1, -Math.PI / 2), false, def.color);
  for (let i = 0; i < 14; i++) {
    const size = (0.12 + (i % 3) * 0.015) / 0.13;
    batcher.add(`stall-produce-${i % produce.length}`, STALL_PRODUCE,
      produce[i % produce.length],
      instanceMatrix(parent, -1.65 + (i % 7) * 0.52, 1.18,
        -0.42 + Math.floor(i / 7) * 0.8, size, size, size));
  }
  batcher.add('stall-bulbs', STALL_BULB,
    material('stall-bulb', () => new THREE.MeshBasicMaterial({ color: 0xffd39b })),
    instanceMatrix(parent, 0, 2.72, 0, 1, 1, 1));
  if (index % 4 === 0) {
    const pool = new THREE.PointLight(0xffb86d, 2.2, 12, 2);
    pool.position.set(def.x, 2.65, def.z);
    scene.add(pool);
  }
}

const cssHex = value => `#${new THREE.Color(value).getHexString()}`;

function paintPaper(ctx, R, x, y, w, h, fill, ragged = 4) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + R() * ragged, y + R() * ragged);
  ctx.lineTo(x + w - R() * ragged, y + R() * ragged);
  ctx.lineTo(x + w - R() * ragged, y + h - R() * ragged);
  ctx.lineTo(x + R() * ragged, y + h - R() * ragged);
  ctx.closePath();
  ctx.fill();
}

function dirtyTile(ctx, R, size, amount = 48) {
  for (let i = 0; i < amount; i++) {
    const alpha = 0.025 + R() * 0.09;
    ctx.fillStyle = `rgba(${R() < 0.55 ? '39,31,24' : '236,226,202'},${alpha})`;
    const r = 0.4 + R() * 2.2;
    ctx.fillRect(R() * size, R() * size, r, r * (0.45 + R()));
  }
}

function paintPoster(ctx, def, R, size) {
  const pad = 9;
  paintPaper(ctx, R, pad, 5, size - pad * 2, size - 10, cssHex(def.stock), 7);
  const ink = cssHex(def.ink);
  const layout = Math.floor(R() * 4);
  const wash = ctx.createLinearGradient(15, 18, size - 18, size * 0.68);
  wash.addColorStop(0, ink);
  wash.addColorStop(0.55, '#2a3235');
  wash.addColorStop(1, '#8c8474');
  ctx.fillStyle = wash;
  ctx.fillRect(17, 18, size - 34, size * 0.49);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#ece4d0';
  if (layout === 0) {
    ctx.beginPath();
    ctx.moveTo(17, size * 0.56);
    ctx.lineTo(size * 0.48, size * 0.23);
    ctx.lineTo(size - 17, size * 0.48);
    ctx.lineTo(size - 17, size * 0.66);
    ctx.lineTo(17, size * 0.66);
    ctx.fill();
  } else if (layout === 1) {
    ctx.save();
    ctx.translate(size / 2, size * 0.42);
    ctx.rotate(-0.48);
    ctx.fillRect(-size * 0.46, -11, size * 0.92, 22);
    ctx.restore();
    ctx.globalAlpha = 0.5;
    ctx.fillRect(size * 0.18, 22, 4, size * 0.42);
    ctx.fillRect(size * 0.73, 22, 2, size * 0.42);
  } else if (layout === 2) {
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.41, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.41, size * 0.12, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(22, 23, size * 0.31, size * 0.18);
    ctx.fillRect(size * 0.56, 23, size * 0.27, size * 0.18);
    ctx.fillRect(22, size * 0.45, size * 0.61, size * 0.17);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#171c1e';
    ctx.fillRect(size * 0.45, 18, 3, size * 0.49);
  }
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = ink;
  for (let i = 0; i < 4; i++) {
    const width = size * (0.67 - i * 0.09 - R() * 0.08);
    ctx.fillRect(17, size * 0.75 + i * 7, width, i === 0 ? 4 : 2);
  }
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = '#261f19';
  ctx.fillRect(7, 8, 8, 18);
  ctx.fillRect(size - 15, size - 25, 8, 18);
  ctx.globalAlpha = 1;
  dirtyTile(ctx, R, size, 64);
}

function paintNotice(ctx, R, size) {
  ctx.fillStyle = '#372d24';
  ctx.fillRect(3, 3, size - 6, size - 6);
  const cork = ctx.createLinearGradient(8, 8, size - 8, size);
  cork.addColorStop(0, '#826345');
  cork.addColorStop(1, '#594536');
  ctx.fillStyle = cork;
  ctx.fillRect(9, 9, size - 18, size - 18);
  const papers = ['#d7d0b9', '#bdc8ca', '#cabd9c', '#c7c5be'];
  for (let i = 0; i < 8; i++) {
    const w = 24 + R() * 25, h = 21 + R() * 31;
    const x = 13 + R() * (size - w - 26), y = 13 + R() * (size - h - 26);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((R() - 0.5) * 0.18);
    ctx.shadowColor = 'rgba(0,0,0,.3)';
    ctx.shadowBlur = 2;
    paintPaper(ctx, R, -w / 2, -h / 2, w, h, papers[i % papers.length], 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(35,43,47,.55)';
    for (let line = 0; line < 3; line++) {
      ctx.fillRect(-w * 0.34, -h * 0.2 + line * 5, w * (0.45 + R() * 0.22), 1.4);
    }
    ctx.fillStyle = i % 2 ? '#7d2f28' : '#344b5a';
    ctx.beginPath();
    ctx.arc(0, -h * 0.38, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  dirtyTile(ctx, R, size, 36);
}

function paintWhiteboard(ctx, R, size) {
  ctx.fillStyle = '#62686b';
  ctx.fillRect(2, 5, size - 4, size - 10);
  ctx.fillStyle = '#d7d7cf';
  ctx.fillRect(8, 10, size - 16, size - 24);
  ctx.strokeStyle = 'rgba(42,65,74,.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(16 + i * 19, 15);
    ctx.lineTo(12 + i * 21, size - 23);
    ctx.stroke();
  }
  ctx.strokeStyle = '#354f5a';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(15 + R() * 14, 25 + i * 19);
    ctx.bezierCurveTo(42 + R() * 12, 15 + i * 22, 61 + R() * 18, 42 + i * 14,
      size - 14, 24 + i * 20);
    ctx.stroke();
  }
  ctx.strokeStyle = '#8d352e';
  ctx.beginPath();
  ctx.moveTo(size * 0.56, size * 0.29);
  ctx.lineTo(size * 0.76, size * 0.43);
  ctx.lineTo(size * 0.66, size * 0.47);
  ctx.stroke();
  dirtyTile(ctx, R, size, 24);
}

function paintGraffiti(ctx, def, R, size) {
  const primary = cssHex(def.ink);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = primary;
  ctx.shadowColor = primary;
  ctx.shadowBlur = 2.5;
  ctx.lineWidth = 5 + R() * 4;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(11 + R() * 20, 25 + R() * 77);
    ctx.bezierCurveTo(32 + R() * 28, 8 + R() * 102, 71 + R() * 30,
      12 + R() * 105, size - 10, 24 + R() * 76);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = primary;
  for (let i = 0; i < 34; i++) {
    ctx.globalAlpha = 0.18 + R() * 0.46;
    const r = 0.4 + R() * 1.5;
    ctx.beginPath();
    ctx.arc(7 + R() * (size - 14), 10 + R() * (size - 20), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintPicture(ctx, R, size) {
  ctx.fillStyle = '#2f2923';
  ctx.fillRect(4, 7, size - 8, size - 14);
  const sky = ctx.createLinearGradient(10, 12, 10, size - 13);
  sky.addColorStop(0, '#6f7b7c');
  sky.addColorStop(0.55, '#a38f72');
  sky.addColorStop(1, '#343e38');
  ctx.fillStyle = sky;
  ctx.fillRect(11, 14, size - 22, size - 28);
  ctx.fillStyle = 'rgba(31,38,34,.82)';
  ctx.beginPath();
  ctx.moveTo(11, size - 14);
  for (let x = 11; x <= size - 11; x += 12) ctx.lineTo(x, 58 + R() * 35);
  ctx.lineTo(size - 11, size - 14);
  ctx.fill();
  dirtyTile(ctx, R, size, 20);
}

function paintShopSign(ctx, def, R, size) {
  const palettes = [
    ['#263f43', '#c8d2c4', '#8f3d32'],
    ['#473d2c', '#ded3ae', '#677d72'],
    ['#3c3339', '#d4c9bc', '#8b6940'],
  ];
  const labels = ['МАГАЗИН', 'СЕРВІС', 'АПТЕКА'];
  const palette = palettes[def.seed % palettes.length];
  const label = labels[def.seed % labels.length];
  ctx.fillStyle = '#202628';
  ctx.fillRect(2, 6, size - 4, size - 12);
  const wash = ctx.createLinearGradient(7, 8, size - 8, size - 9);
  wash.addColorStop(0, palette[0]);
  wash.addColorStop(0.58, palette[2]);
  wash.addColorStop(1, palette[0]);
  ctx.fillStyle = wash;
  ctx.fillRect(7, 11, size - 14, size - 22);
  ctx.strokeStyle = 'rgba(225,218,191,.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 14, size - 20, size - 28);

  // The square atlas tile maps onto a very wide sign. Horizontally compress the glyphs in
  // texture space so the world transform restores normal letter proportions.
  const aspect = Math.max(2.8, def.w / def.h);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(1 / aspect, 1);
  ctx.fillStyle = palette[1];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 78px Arial, sans-serif';
  ctx.fillText(label, 0, 1);
  ctx.restore();

  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 22; i++) {
    ctx.globalAlpha = 0.12 + R() * 0.38;
    ctx.fillRect(8 + R() * (size - 16), 12 + R() * (size - 24), 1 + R() * 5, 1 + R() * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  dirtyTile(ctx, R, size, 38);
}

function addWallDecals(scene, defs) {
  if (!defs.length) return;
  const tile = 128, cols = 8;
  const usedRows = Math.ceil(defs.length / cols);
  const atlasW = tile * cols;
  const atlasH = Math.pow(2, Math.ceil(Math.log2(Math.max(tile, usedRows * tile))));
  const canvas = document.createElement('canvas');
  canvas.width = atlasW;
  canvas.height = atlasH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, atlasW, atlasH);

  const positions = [], normals = [], uvs = [], indices = [];
  const counts = {};
  let signature = 2166136261;
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const R = rng(def.seed);
    const tx = (i % cols) * tile, ty = Math.floor(i / cols) * tile;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.beginPath();
    ctx.rect(0, 0, tile, tile);
    ctx.clip();
    if (def.style === 'poster') paintPoster(ctx, def, R, tile);
    else if (def.style === 'notice') paintNotice(ctx, R, tile);
    else if (def.style === 'whiteboard') paintWhiteboard(ctx, R, tile);
    else if (def.style === 'graffiti') paintGraffiti(ctx, def, R, tile);
    else if (def.style === 'picture') paintPicture(ctx, R, tile);
    else if (def.style === 'shop-sign') paintShopSign(ctx, def, R, tile);
    ctx.restore();

    counts[def.style] = (counts[def.style] || 0) + 1;
    signature ^= (def.seed + i * 131 + Math.round(def.x * 17) + Math.round(def.z * 29)) >>> 0;
    signature = Math.imul(signature, 16777619) >>> 0;

    const normal = def.rot ? [def.dir, 0, 0] : [0, 0, def.dir];
    const right = def.rot ? [0, 0, -def.dir] : [def.dir, 0, 0];
    const cx = def.x + normal[0] * 0.038, cy = def.y, cz = def.z + normal[2] * 0.038;
    const hw = def.w / 2, hh = def.h / 2;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    for (const [side, up] of corners) {
      positions.push(cx + right[0] * side, cy + up, cz + right[2] * side);
      normals.push(...normal);
    }
    const u0 = tx / atlasW, u1 = (tx + tile) / atlasW;
    const v0 = 1 - (ty + tile) / atlasH, v1 = 1 - ty / atlasH;
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    const base = i * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(quality.maxAnisotropy || 4, 8);
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.08,
    roughness: 0.94,
    metalness: 0,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const out = new THREE.Mesh(geometry, mat);
  out.name = 'wall-decal-atlas';
  out.castShadow = false;
  out.receiveShadow = quality.shadows;
  out.userData.decalCount = defs.length;
  out.userData.decalCounts = counts;
  out.userData.atlasSize = [atlasW, atlasH];
  out.userData.signature = signature;
  scene.userData.wallDecalStats = out.userData;
  scene.add(out);
}

export function addVisualProps(scene, props = []) {
  const batcher = new InstanceBatcher(scene);
  const wallDecals = [];
  let marketIndex = 0;
  for (const def of props) {
    if (def.kind === 'vehicle') addVehicle(batcher, def);
    else if (def.kind === 'facade') addFacade(batcher, def);
    else if (def.kind === 'market-stall') addMarketStall(batcher, scene, def, marketIndex++);
    else if (def.kind === 'roof-cap') addRoofCap(batcher, def);
    else if (def.kind === 'skyline-roof-profile') addSkylineRoofProfile(batcher, def);
    else if (def.kind === 'skyline-facade') addSkylineFacade(batcher, def);
    else if (def.kind === 'ceiling-fixture') addCeilingFixture(batcher, def);
    else if (def.kind === 'wall-decal') wallDecals.push(def);
    else if (def.kind === 'skyline-stats') scene.userData.skylineStats = def.stats;
  }
  batcher.flush();
  addWallDecals(scene, wallDecals);
}
