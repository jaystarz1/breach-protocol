// Desktop visual replacements for authored collision/blockout props.
import * as THREE from 'three';
import { quality } from './quality.js';
import { rng } from './world.js';

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
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
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

function roundedProfile(points, depth, bevel = 0.06) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  // Curve the visible upper contour while keeping the sill/floor edge straight. The previous
  // line-to polygon advertised every control point as a hard corner, which is why a nominally
  // rounded car still read like a Roblox wedge from ten metres away.
  const straightTail = points.length >= 8 ? 2 : 1;
  const curveEnd = points.length - straightTail;
  shape.splineThru(points.slice(1, curveEnd).map(([x, y]) => new THREE.Vector2(x, y)));
  for (let i = curveEnd; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSegments: 3,
    bevelSize: bevel, bevelThickness: bevel, curveSegments: 8,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

const SEDAN_LOWER = roundedProfile([
  [-2.2, 0.34], [-2.08, 0.72], [-1.68, 0.91], [1.65, 0.92],
  [2.12, 0.73], [2.22, 0.4], [1.96, 0.27], [-1.98, 0.27],
], 1.76, 0.09);
const SEDAN_CABIN = roundedProfile([
  [-1.12, 0.88], [-0.62, 1.45], [-0.34, 1.56], [0.78, 1.53],
  [1.34, 0.94],
], 1.58, 0.055);
const SEDAN_WINDOW = roundedProfile([
  [-0.96, 0.96], [-0.52, 1.42], [-0.28, 1.47], [0.68, 1.45], [1.15, 0.98],
], 0.022, 0.015);
const HATCH_LOWER = roundedProfile([
  [-2.02, 0.32], [-1.92, 0.72], [-1.5, 0.91], [1.57, 0.93],
  [1.98, 0.72], [2.03, 0.35], [1.78, 0.26], [-1.78, 0.26],
], 1.74, 0.095);
const HATCH_CABIN = roundedProfile([
  [-1.18, 0.87], [-0.63, 1.48], [-0.34, 1.59], [1.18, 1.57],
  [1.61, 1.18], [1.67, 0.92],
], 1.57, 0.06);
const HATCH_WINDOW = roundedProfile([
  [-1.01, 0.96], [-0.52, 1.44], [-0.25, 1.5], [1.07, 1.49],
  [1.47, 1.14], [1.5, 0.98],
], 0.022, 0.015);
const SUV_LOWER = roundedProfile([
  [-2.26, 0.4], [-2.17, 0.82], [-1.75, 1.02], [1.78, 1.03],
  [2.2, 0.84], [2.28, 0.43], [2.02, 0.3], [-2.02, 0.3],
], 1.86, 0.1);
const SUV_CABIN = roundedProfile([
  [-1.24, 0.97], [-0.77, 1.61], [-0.47, 1.74], [1.45, 1.72],
  [1.78, 1.38], [1.8, 1.02],
], 1.67, 0.065);
const SUV_WINDOW = roundedProfile([
  [-1.07, 1.08], [-0.66, 1.57], [-0.38, 1.65], [1.32, 1.64],
  [1.62, 1.33], [1.63, 1.09],
], 0.022, 0.015);
const VEHICLE_TYPES = [
  {
    key: 'sedan', lower: SEDAN_LOWER, cabin: SEDAN_CABIN, window: SEDAN_WINDOW,
    wheels: [-1.42, 1.42], screen: [-0.79, 1.19, 0.53, 0.99],
    bodyHalf: 0.97, cabinHalf: 0.845, front: -2.3, rear: 2.34,
  },
  {
    key: 'hatch', lower: HATCH_LOWER, cabin: HATCH_CABIN, window: HATCH_WINDOW,
    wheels: [-1.29, 1.34], screen: [-0.84, 1.48, 0.56, 1.12],
    bodyHalf: 0.965, cabinHalf: 0.845, front: -2.13, rear: 2.13,
  },
  {
    key: 'suv', lower: SUV_LOWER, cabin: SUV_CABIN, window: SUV_WINDOW,
    wheels: [-1.47, 1.47], screen: [-0.92, 1.62, 0.61, 1.22],
    bodyHalf: 1.03, cabinHalf: 0.9, front: -2.37, rear: 2.4,
  },
];
const TYRE_GEO = new THREE.TorusGeometry(0.36, 0.105, 10, 24);
const HUB_GEO = new THREE.CylinderGeometry(0.23, 0.23, 0.045, 20);
const CAP_GEO = new THREE.CylinderGeometry(0.075, 0.075, 0.052, 16);
const ARCH_GEO = new THREE.CylinderGeometry(0.43, 0.43, 0.035, 24);
const MIRROR_GEO = new THREE.SphereGeometry(0.11, 12, 8);
const HANDLE_GEO = new THREE.CapsuleGeometry(0.018, 0.11, 3, 8);
const HEADREST_GEO = new THREE.CapsuleGeometry(0.12, 0.13, 4, 8);
const VEHICLE_SHADOW_GEO = new THREE.CircleGeometry(1, 32);
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
  const paint = material('vehicle-paint-instanced', () => new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.24, metalness: 0.38,
    clearcoat: 0.72, clearcoatRoughness: 0.2, envMapIntensity: 1.35,
  }));
  const trim = standard('vehicle-trim', 0x11161a, 0.54, 0.16);
  const rubber = standard('vehicle-rubber', 0x090b0d, 0.96, 0);
  const rim = standard('vehicle-rim', 0x7e8991, 0.24, 0.82);
  const interior = standard('vehicle-interior', 0x171a1c, 0.82, 0.02);
  const plate = standard('vehicle-plate', 0xc7c8bd, 0.42, 0.16);
  const contactShadow = material('vehicle-contact-shadow', () => new THREE.MeshBasicMaterial({
    color: 0x050708, transparent: true, opacity: 0.18, depthWrite: false,
  }));
  const glass = material('vehicle-glass', () => new THREE.MeshPhysicalMaterial({
    color: 0x08131b, roughness: 0.15, metalness: 0.08,
    transmission: 0, transparent: false,
    clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.05,
  }));
  const grime = standard('vehicle-road-grime', 0x282824, 0.98, 0.01);
  const shattered = standard('vehicle-shattered-glass', 0x10171b, 0.88, 0.03);

  // A low sun made the old cast shadow a hard 4x2m black rectangle. A tight translucent
  // contact patch anchors the car while keeping the silhouette legible on dark asphalt.
  batcher.add('vehicle-contact-shadows', VEHICLE_SHADOW_GEO, contactShadow,
    instanceMatrix(parent, 0, 0.018, 0, 1.95, 0.76, 1, -Math.PI / 2));
  batcher.add(`vehicle-${type.key}-lower`, type.lower, paint, parent, false, bodyColor);
  batcher.add(`vehicle-${type.key}-cabin`, type.cabin, paint, parent, false, bodyColor);
  const glassSide = type.cabinHalf + 0.014;
  const trimSide = type.bodyHalf + 0.028;
  const wheelSide = type.bodyHalf + 0.06;
  for (const side of [-1, 1]) {
    batcher.add(`vehicle-${type.key}-side-glass`, type.window, wrecked ? shattered : glass,
      instanceMatrix(parent, 0, 0, side * glassSide, 1, 1, 1));
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
  }

  // The glasshouse is a volume, not a dark decal pasted on each side. Angled front/rear
  // panes, a visible interior and pillars prevent the profile from reading as two stacked
  // boxes when the player approaches from either end.
  const [frontX, rearX, frontTilt, rearTilt] = type.screen;
  batcher.add(`vehicle-${type.key}-windscreen`, UNIT_BOX, wrecked ? shattered : glass,
    instanceMatrix(parent, frontX, type.key === 'suv' ? 1.35 : 1.23, 0,
      0.035, type.key === 'suv' ? 0.72 : 0.6, type.key === 'suv' ? 1.61 : 1.52,
      0, 0, -frontTilt));
  batcher.add(`vehicle-${type.key}-rear-glass`, UNIT_BOX, wrecked ? shattered : glass,
    instanceMatrix(parent, rearX, type.key === 'suv' ? 1.39 : 1.24, 0,
      0.035, type.key === 'suv' ? 0.65 : 0.52, type.key === 'suv' ? 1.59 : 1.48,
      0, 0, rearTilt));
  for (const side of [-0.45, 0.45]) {
    batcher.add('vehicle-seats', UNIT_BOX, interior,
      instanceMatrix(parent, 0.12, 0.96, side, 0.42, 0.58, 0.44, 0, 0, -0.08));
    batcher.add('vehicle-headrests', HEADREST_GEO, interior,
      instanceMatrix(parent, 0.18, 1.34, side, 0.9, 0.9, 0.9));
  }

  for (const x of type.wheels) for (const side of [-1, 1]) {
    batcher.add('vehicle-wheel-wells', ARCH_GEO, interior,
      instanceMatrix(parent, x, 0.4, side * (wheelSide - 0.02), 1, 1, 1, Math.PI / 2));
    batcher.add('vehicle-tyres', TYRE_GEO, rubber,
      instanceMatrix(parent, x, 0.4, side * wheelSide, 1, 1, 1), false);
    batcher.add('vehicle-hubs', HUB_GEO, rim,
      instanceMatrix(parent, x, 0.4, side * (wheelSide + 0.025), 1, 1, 1, Math.PI / 2));
    batcher.add('vehicle-caps', CAP_GEO, trim,
      instanceMatrix(parent, x, 0.4, side * (wheelSide + 0.055), 1, 1, 1, Math.PI / 2));
  }

  for (const side of [-0.56, 0.56]) {
    batcher.add('vehicle-headlights', UNIT_BOX,
      material('headlamp', () => new THREE.MeshPhysicalMaterial({
        color: 0xdde8df, emissive: 0xa9b5ab, emissiveIntensity: 0.08,
        roughness: 0.14, metalness: 0.06, clearcoat: 1,
      })),
      instanceMatrix(parent, type.front - 0.012, 0.67, side, 0.035, 0.17, 0.42));
    batcher.add('vehicle-taillights', UNIT_BOX,
      standard('taillamp', 0x8f1514, 0.18, 0),
      instanceMatrix(parent, type.rear + 0.012, 0.67, side, 0.035, 0.18, 0.4));
  }
  for (const x of [type.front - 0.025, type.rear + 0.025]) {
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, x, 0.34, 0, 0.12, 0.13, 1.58));
  }
  batcher.add('vehicle-grilles', UNIT_BOX, trim,
    instanceMatrix(parent, type.front - 0.02, 0.52, 0, 0.035, 0.22, 0.86));
  for (const z of [-0.31, -0.1, 0.1, 0.31]) {
    batcher.add('vehicle-grille-slats', UNIT_BOX, rim,
      instanceMatrix(parent, type.front - 0.042, 0.52, z, 0.02, 0.15, 0.025));
  }
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
        instanceMatrix(parent, 0, 0.008, side * (glassSide + 0.006), 0.98, 0.96, 1));
      batcher.add('vehicle-dent', UNIT_BOX, grime,
        instanceMatrix(parent, 1.22, 0.71, -side * (trimSide + 0.01), 0.58, 0.32, 0.022,
          0, 0, damage === 2 ? 0.11 : -0.08));
    }
    if (wrecked) {
      batcher.add('vehicle-missing-hub', CAP_GEO, rubber,
        instanceMatrix(parent, type.wheels[1], 0.4, wheelSide + 0.065,
          1.35, 1.35, 1.1, Math.PI / 2));
      // Ash on the bonnet and a dropped bumper sell an abandoned strike-damaged shell.
      batcher.add('vehicle-burn-scars', UNIT_BOX, grime,
        instanceMatrix(parent, -1.38, 0.91, 0, 0.82, 0.025, 1.16, 0, 0, -0.08));
      batcher.add('vehicle-dropped-bumpers', UNIT_BOX, trim,
        instanceMatrix(parent, type.rear + 0.03, 0.2, 0.17,
          0.12, 0.11, 1.5, 0.16, 0.04, 0.12));
    }
  }

  if (def.police) {
    const white = standard('police-white', 0xe5eaed, 0.38, 0.18);
    for (const side of [-1, 1]) {
      batcher.add('police-doors', UNIT_BOX, white,
        instanceMatrix(parent, 0.15, 0.67, side * 0.91, 1.45, 0.5, 0.025));
    }
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, 0.18, 1.59, 0, 0.32, 0.07, 1.34));
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, type.front - 0.16, 0.54, 0, 0.07, 0.09, 1.52));
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, type.front - 0.16, 0.88, 0, 0.07, 0.09, 1.52));
    for (const z of [-0.52, 0.52]) {
      batcher.add('vehicle-trim-box', UNIT_BOX, trim,
        instanceMatrix(parent, type.front - 0.14, 0.78, z, 0.1, 0.76, 0.08));
    }
    for (const [z, col] of [[-0.38, 0xd51f28], [0.38, 0x245dff]]) {
      batcher.add(`police-lens-${col}`, UNIT_BOX,
        material(`police-lens-${col}`, () => new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0.76,
        })),
        instanceMatrix(parent, 0.18, 1.68, z, 0.28, 0.14, 0.54));
    }
  }
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
    color: 0x162635, roughness: 0.12, metalness: 0.12,
    transparent: true, opacity: 0.78, clearcoat: 1,
    clearcoatRoughness: 0.08, envMapIntensity: 2.1,
  }));
  const floorH = def.floorH ?? 3;
  const step = def.step ?? 3;
  const litChance = def.lit ?? 0.34;
  // This district has been on the contact line for weeks. A mostly pristine repeated grid
  // reads as an office-park generator even when the masonry beneath it is excellent.
  const damageChance = def.damage ?? 0.42;
  const warmRoom = material('window-room-warm', () => new THREE.MeshStandardMaterial({
    color: 0xffbd78, emissive: 0xffbd78, emissiveIntensity: 0.18, roughness: 0.92,
  }));
  const coolRoom = material('window-room-cool', () => new THREE.MeshStandardMaterial({
    color: 0x9cc8ef, emissive: 0x9cc8ef, emissiveIntensity: 0.18, roughness: 0.92,
  }));
  const warmPane = material('window-pane-warm', () => new THREE.MeshPhysicalMaterial({
    color: 0xffbd78, emissive: 0xffbd78, emissiveIntensity: 0.28,
    roughness: 0.16, transparent: true, opacity: 0.68,
  }));
  const coolPane = material('window-pane-cool', () => new THREE.MeshPhysicalMaterial({
    color: 0x9cc8ef, emissive: 0x9cc8ef, emissiveIntensity: 0.28,
    roughness: 0.16, transparent: true, opacity: 0.68,
  }));
  const sillMat = standard('window-sill', 0x8f969a, 0.82, 0.02);
  const blindMat = standard('blind', 0xb9ae9d, 0.9, 0);
  const boardMat = standard('window-boards', 0x5a4533, 0.94, 0);
  const brokenMat = standard('window-void', 0x030506, 1, 0);
  const sootMat = material('facade-soot', () => new THREE.MeshBasicMaterial({
    color: 0x0a0b0b, transparent: true, opacity: 0.66,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  const shardMat = material('window-shards', () => new THREE.MeshPhysicalMaterial({
    color: 0x7892a1, roughness: 0.18, metalness: 0.08,
    transparent: true, opacity: 0.58, side: THREE.DoubleSide,
  }));
  const utilityMat = standard('facade-utility', 0x394043, 0.7, 0.48);
  const acMat = standard('facade-ac', 0x596166, 0.82, 0.28);

  const facadeParent = new THREE.Matrix4().compose(
    new THREE.Vector3(
      (def.x1 + def.x2) / 2 + nx * (def.out ?? 0.2),
      def.yBase,
      (def.z1 + def.z2) / 2 + nz * (def.out ?? 0.2),
    ),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(1, 1, 1),
  );
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
      const roomMat = lit ? (warm ? warmRoom : coolRoom) : recessMat;
      const paneMat = destroyed || boarded
        ? brokenMat
        : (lit ? (warm ? warmPane : coolPane) : glassDark);
      batcher.add(
        lit ? (warm ? 'recess-warm' : 'recess-cool') : 'recess-dark',
        UNIT_BOX, roomMat, instanceMatrix(parent, 0, 0, -0.12, 1.96, 1.74, 0.18));
      if (!boarded) {
        batcher.add(
          lit ? (warm ? 'pane-warm' : 'pane-cool') : 'pane-dark',
          UNIT_PLANE, paneMat, instanceMatrix(parent, 0, 0, 0.025, 1.68, 1.45, 1));
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
          instanceMatrix(parent, x, y, 0.08, w, h, 0.09));
      }
      batcher.add('window-sills', UNIT_BOX, sillMat,
        instanceMatrix(parent, 0, -0.88, 0.1, 2.16, 0.11, 0.32));
      if (boarded) {
        for (const [offset, angle] of [[-0.42, 0.1], [0, -0.06], [0.42, 0.14]]) {
          batcher.add('window-boards', UNIT_BOX, boardMat,
            instanceMatrix(parent, 0, offset, 0.14, 1.88, 0.14, 0.09,
              0, 0, angle));
        }
      } else if (destroyed || cracked) {
        for (const [x, y, rz, sx] of [
          [-0.54, -0.45, 0.18, 0.55], [0.5, -0.52, -0.12, 0.62], [0.56, 0.45, 0.2, 0.42],
        ]) {
          if (cracked && x > 0) continue;
          batcher.add('window-shards', SHARD_GEO, shardMat,
            instanceMatrix(parent, x, y, 0.13, sx, 0.48, 1, 0, 0, rz));
        }
        if (destroyed) {
          // One bent mullion and a soot bloom stop a blown opening from reading as the same
          // pristine kit with its glass material merely switched to black.
          batcher.add('window-bent-frames', UNIT_BOX, frameMat,
            instanceMatrix(parent, -0.2, 0.12, 0.13, 0.065, 1.28, 0.09,
              0, 0, -0.24));
          if (R() < 0.74) {
            batcher.add('facade-soot', FACADE_SCAR_GEO, sootMat,
              instanceMatrix(parent, R() * 0.34 - 0.17, 0.95, 0.012,
                1.15 + R() * 0.5, 0.82 + R() * 0.46, 1, 0, 0, R() * 0.4 - 0.2));
          }
        }
      } else if (lit && R() < 0.58) {
        const partial = R() < 0.5;
        batcher.add('window-blinds', UNIT_PLANE, blindMat,
          instanceMatrix(parent, partial ? -0.47 : 0, 0.37, 0.045,
            partial ? 0.68 : 1.58, 0.65, 1));
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

export function addVisualProps(scene, props = []) {
  const batcher = new InstanceBatcher(scene);
  let marketIndex = 0;
  for (const def of props) {
    if (def.kind === 'vehicle') addVehicle(batcher, def);
    else if (def.kind === 'facade') addFacade(batcher, def);
    else if (def.kind === 'market-stall') addMarketStall(batcher, scene, def, marketIndex++);
    else if (def.kind === 'roof-cap') addRoofCap(batcher, def);
  }
  batcher.flush();
}
