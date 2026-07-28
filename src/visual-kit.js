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
    for (const batch of this.batches.values()) {
      const out = new THREE.InstancedMesh(
        batch.geometry, batch.mat, batch.matrices.length);
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
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSegments: 3,
    bevelSize: bevel, bevelThickness: bevel, curveSegments: 4,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

const CAR_LOWER = roundedProfile([
  [-2.2, 0.34], [-2.08, 0.72], [-1.68, 0.91], [1.65, 0.92],
  [2.12, 0.73], [2.22, 0.4], [1.96, 0.27], [-1.98, 0.27],
], 1.76, 0.09);
const CAR_CABIN = roundedProfile([
  [-1.12, 0.88], [-0.62, 1.45], [-0.34, 1.56], [0.78, 1.53],
  [1.34, 0.94],
], 1.58, 0.055);
const CAR_WINDOW = roundedProfile([
  [-0.96, 0.96], [-0.52, 1.42], [-0.28, 1.47], [0.68, 1.45], [1.15, 0.98],
], 0.022, 0.015);
const TYRE_GEO = new THREE.TorusGeometry(0.36, 0.105, 10, 24);
const HUB_GEO = new THREE.CylinderGeometry(0.23, 0.23, 0.045, 20);
const CAP_GEO = new THREE.CylinderGeometry(0.075, 0.075, 0.052, 16);
const MIRROR_GEO = new THREE.SphereGeometry(0.11, 12, 8);
const HANDLE_GEO = new THREE.CapsuleGeometry(0.018, 0.11, 3, 8);
const HEADLIGHT_GEO = new THREE.SphereGeometry(0.16, 14, 8);

function addVehicle(batcher, def) {
  const parent = new THREE.Matrix4().compose(
    new THREE.Vector3(def.x, 0.01, def.z),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), def.rotZAxis ? Math.PI / 2 : 0),
    new THREE.Vector3(1, 1, 1),
  );
  const paint = standard('vehicle-paint-instanced', 0xffffff, 0.28, 0.34);
  const trim = standard('vehicle-trim', 0x11161a, 0.54, 0.16);
  const rubber = standard('vehicle-rubber', 0x090b0d, 0.96, 0);
  const rim = standard('vehicle-rim', 0x7e8991, 0.24, 0.82);
  const glass = material('vehicle-glass', () => new THREE.MeshPhysicalMaterial({
    color: 0x24384a, roughness: 0.08, metalness: 0.05,
    transmission: 0.18, transparent: true, opacity: 0.72,
    clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.8,
  }));

  batcher.add('vehicle-lower', CAR_LOWER, paint, parent, true, def.color);
  batcher.add('vehicle-cabin', CAR_CABIN, paint, parent, true, def.color);
  for (const side of [-1, 1]) {
    batcher.add('vehicle-window', CAR_WINDOW, glass,
      instanceMatrix(parent, 0, 0, side * 0.804, 1, 1, 1));
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, 0.18, 1.2, side * 0.83, 0.085, 0.55, 0.055));
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, 0.08, 0.95, side * 0.83, 2.15, 0.055, 0.06));
    batcher.add('vehicle-mirror', MIRROR_GEO, trim,
      instanceMatrix(parent, -0.92, 1.12, side * 0.98, 1.35, 0.65, 0.75));
    for (const x of [-0.72, 0.86]) {
      batcher.add('vehicle-trim-box', UNIT_BOX, trim,
        instanceMatrix(parent, x, 0.65, side * 0.902, 0.018, 0.62, 0.014));
      batcher.add('vehicle-handles', HANDLE_GEO, trim,
        instanceMatrix(parent, x + 0.23, 0.83, side * 0.916, 1, 1, 1, 0, 0, Math.PI / 2));
    }
  }

  for (const x of [-1.42, 1.42]) for (const side of [-1, 1]) {
    batcher.add('vehicle-tyres', TYRE_GEO, rubber,
      instanceMatrix(parent, x, 0.4, side * 0.89, 1, 1, 1), true);
    batcher.add('vehicle-hubs', HUB_GEO, rim,
      instanceMatrix(parent, x, 0.4, side * 0.905, 1, 1, 1, Math.PI / 2));
    batcher.add('vehicle-caps', CAP_GEO, trim,
      instanceMatrix(parent, x, 0.4, side * 0.935, 1, 1, 1, Math.PI / 2));
  }

  for (const side of [-0.56, 0.56]) {
    batcher.add('vehicle-headlights', HEADLIGHT_GEO,
      standard('headlamp', 0xeef4e8, 0.12, 0.08),
      instanceMatrix(parent, -2.19, 0.67, side, 0.32, 0.65, 1));
    batcher.add('vehicle-taillights', UNIT_BOX,
      standard('taillamp', 0x8f1514, 0.18, 0),
      instanceMatrix(parent, 2.18, 0.67, side, 0.05, 0.18, 0.4));
  }
  for (const x of [-2.23, 2.23]) {
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, x, 0.34, 0, 0.12, 0.13, 1.58));
  }

  if (def.police) {
    const white = standard('police-white', 0xe5eaed, 0.38, 0.18);
    for (const side of [-1, 1]) {
      batcher.add('police-doors', UNIT_BOX, white,
        instanceMatrix(parent, 0.15, 0.67, side * 0.91, 1.45, 0.5, 0.025));
    }
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, 0.18, 1.59, 0, 0.32, 0.07, 1.34));
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
      const lit = R() < litChance;
      const warm = R() < 0.72;
      const roomMat = lit ? (warm ? warmRoom : coolRoom) : recessMat;
      const paneMat = lit ? (warm ? warmPane : coolPane) : glassDark;
      batcher.add(
        lit ? (warm ? 'recess-warm' : 'recess-cool') : 'recess-dark',
        UNIT_BOX, roomMat, instanceMatrix(parent, 0, 0, -0.12, 1.96, 1.74, 0.18));
      batcher.add(
        lit ? (warm ? 'pane-warm' : 'pane-cool') : 'pane-dark',
        UNIT_PLANE, paneMat, instanceMatrix(parent, 0, 0, 0.025, 1.68, 1.45, 1));
      for (const [w, h, x, y] of [
        [1.98, 0.09, 0, -0.81], [1.98, 0.09, 0, 0.81],
        [0.09, 1.7, -0.94, 0], [0.09, 1.7, 0.94, 0],
        [0.065, 1.52, 0, 0], [1.78, 0.055, 0, 0.18],
      ]) {
        batcher.add('window-frames', UNIT_BOX, frameMat,
          instanceMatrix(parent, x, y, 0.08, w, h, 0.09));
      }
      batcher.add('window-sills', UNIT_BOX, sillMat,
        instanceMatrix(parent, 0, -0.88, 0.1, 2.16, 0.11, 0.32));
      if (lit && R() < 0.58) {
        const partial = R() < 0.5;
        batcher.add('window-blinds', UNIT_PLANE, blindMat,
          instanceMatrix(parent, partial ? -0.47 : 0, 0.37, 0.045,
            partial ? 0.68 : 1.58, 0.65, 1));
      }
    }
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

export function addVisualProps(scene, props = []) {
  const batcher = new InstanceBatcher(scene);
  let marketIndex = 0;
  for (const def of props) {
    if (def.kind === 'vehicle') addVehicle(batcher, def);
    else if (def.kind === 'facade') addFacade(batcher, def);
    else if (def.kind === 'market-stall') addMarketStall(batcher, scene, def, marketIndex++);
  }
  batcher.flush();
}
