// Desktop visual replacements for authored collision/blockout props.
import * as THREE from 'three';
import { quality } from './quality.js';
import { rng } from './world.js';

const mats = {};
const material = (key, make) => mats[key] || (mats[key] = make());
const standard = (key, color, roughness = 0.7, metalness = 0) =>
  material(key, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));

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

function addVehicle(scene, def) {
  const root = new THREE.Group();
  root.position.set(def.x, 0.01, def.z);
  root.rotation.y = def.rotZAxis ? Math.PI / 2 : 0;

  const paint = standard(`paint-${def.color}`, def.color, 0.28, 0.34);
  const trim = standard('vehicle-trim', 0x11161a, 0.54, 0.16);
  const rubber = standard('vehicle-rubber', 0x090b0d, 0.96, 0);
  const rim = standard('vehicle-rim', 0x7e8991, 0.24, 0.82);
  const glass = material('vehicle-glass', () => new THREE.MeshPhysicalMaterial({
    color: 0x24384a, roughness: 0.08, metalness: 0.05,
    transmission: 0.18, transparent: true, opacity: 0.72,
    clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.8,
  }));

  root.add(mesh(roundedProfile([
    [-2.2, 0.34], [-2.08, 0.72], [-1.68, 0.91], [1.65, 0.92],
    [2.12, 0.73], [2.22, 0.4], [1.96, 0.27], [-1.98, 0.27],
  ], 1.76, 0.09), paint));
  root.add(mesh(roundedProfile([
    [-1.12, 0.88], [-0.62, 1.45], [-0.34, 1.56], [0.78, 1.53],
    [1.34, 0.94],
  ], 1.58, 0.055), paint));

  const sideWindowGeo = roundedProfile([
    [-0.96, 0.96], [-0.52, 1.42], [-0.28, 1.47], [0.68, 1.45], [1.15, 0.98],
  ], 0.022, 0.015);
  for (const side of [-1, 1]) {
    const window = mesh(sideWindowGeo, glass, false);
    window.position.z = side * 0.804;
    root.add(window);
    const pillar = mesh(new THREE.BoxGeometry(0.085, 0.55, 0.055), trim);
    pillar.position.set(0.18, 1.2, side * 0.83);
    root.add(pillar);
    const sill = mesh(new THREE.BoxGeometry(2.15, 0.055, 0.06), trim);
    sill.position.set(0.08, 0.95, side * 0.83);
    root.add(sill);
    const mirror = mesh(new THREE.SphereGeometry(0.11, 12, 8), trim);
    mirror.scale.set(1.35, 0.65, 0.75);
    mirror.position.set(-0.92, 1.12, side * 0.98);
    root.add(mirror);
    for (const x of [-0.72, 0.86]) {
      const seam = mesh(new THREE.BoxGeometry(0.018, 0.62, 0.014), trim, false);
      seam.position.set(x, 0.65, side * 0.902);
      root.add(seam);
      const handle = mesh(new THREE.CapsuleGeometry(0.018, 0.11, 3, 8), trim, false);
      handle.rotation.z = Math.PI / 2;
      handle.position.set(x + 0.23, 0.83, side * 0.916);
      root.add(handle);
    }
  }

  for (const x of [-1.42, 1.42]) for (const side of [-1, 1]) {
    const tyre = mesh(new THREE.TorusGeometry(0.36, 0.105, 10, 24), rubber);
    tyre.position.set(x, 0.4, side * 0.89);
    root.add(tyre);
    const hub = mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.045, 20), rim);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(x, 0.4, side * 0.905);
    root.add(hub);
    const cap = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.052, 16), trim);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(x, 0.4, side * 0.935);
    root.add(cap);
  }

  for (const side of [-0.56, 0.56]) {
    const head = mesh(new THREE.SphereGeometry(0.16, 14, 8),
      standard('headlamp', 0xeef4e8, 0.12, 0.08), false);
    head.scale.set(0.32, 0.65, 1);
    head.position.set(-2.19, 0.67, side);
    root.add(head);
    const tail = mesh(new THREE.BoxGeometry(0.05, 0.18, 0.4),
      standard('taillamp', 0x8f1514, 0.18, 0), false);
    tail.position.set(2.18, 0.67, side);
    root.add(tail);
  }
  for (const x of [-2.23, 2.23]) {
    const bumper = mesh(new THREE.BoxGeometry(0.12, 0.13, 1.58), trim);
    bumper.position.set(x, 0.34, 0);
    root.add(bumper);
  }

  if (def.police) {
    const white = standard('police-white', 0xe5eaed, 0.38, 0.18);
    for (const side of [-1, 1]) {
      const door = mesh(new THREE.BoxGeometry(1.45, 0.5, 0.025), white);
      door.position.set(0.15, 0.67, side * 0.91);
      root.add(door);
    }
    const barBase = mesh(new THREE.BoxGeometry(0.32, 0.07, 1.34), trim);
    barBase.position.set(0.18, 1.59, 0);
    root.add(barBase);
    for (const [z, col] of [[-0.38, 0xd51f28], [0.38, 0x245dff]]) {
      const lens = mesh(new THREE.BoxGeometry(0.28, 0.14, 0.54),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.76 }), false);
      lens.position.set(0.18, 1.68, z);
      root.add(lens);
    }
  }
  scene.add(root);
}

function addFacade(scene, def) {
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

  for (let fy = def.yBase + 1.2; fy < def.yBase + def.height - 1.3; fy += floorH) {
    for (let s = 1.8; s < len - 1.8; s += step) {
      if ((def.skip || []).some(g => s > g.from - 1.2 && s < g.to + 1.2)) continue;
      const root = new THREE.Group();
      root.position.set(
        def.x1 + ux * s + nx * (def.out ?? 0.2),
        fy + 0.74,
        def.z1 + uz * s + nz * (def.out ?? 0.2),
      );
      root.rotation.y = yaw;
      const lit = R() < litChance;
      const roomColor = R() < 0.72 ? 0xffbd78 : 0x9cc8ef;
      const recess = mesh(new THREE.BoxGeometry(1.96, 1.74, 0.18),
        lit ? standard(`room-${roomColor}`, roomColor, 0.92, 0) : recessMat, false);
      recess.position.z = -0.12;
      root.add(recess);
      const paneMat = lit
        ? new THREE.MeshPhysicalMaterial({
            color: roomColor, emissive: roomColor, emissiveIntensity: 0.28,
            roughness: 0.16, transparent: true, opacity: 0.68,
          })
        : glassDark;
      const pane = mesh(new THREE.PlaneGeometry(1.68, 1.45), paneMat, false);
      pane.position.z = 0.025;
      root.add(pane);
      for (const [w, h, x, y] of [
        [1.98, 0.09, 0, -0.81], [1.98, 0.09, 0, 0.81],
        [0.09, 1.7, -0.94, 0], [0.09, 1.7, 0.94, 0],
        [0.065, 1.52, 0, 0], [1.78, 0.055, 0, 0.18],
      ]) {
        const frame = mesh(new THREE.BoxGeometry(w, h, 0.09), frameMat);
        frame.position.set(x, y, 0.08);
        root.add(frame);
      }
      const sill = mesh(new THREE.BoxGeometry(2.16, 0.11, 0.32),
        standard('window-sill', 0x8f969a, 0.82, 0.02));
      sill.position.set(0, -0.88, 0.1);
      root.add(sill);
      if (lit && R() < 0.58) {
        const blind = mesh(new THREE.PlaneGeometry(R() < 0.5 ? 0.68 : 1.58, 0.65),
          standard('blind', 0xb9ae9d, 0.9, 0), false);
        blind.position.set(R() < 0.5 ? -0.47 : 0, 0.37, 0.045);
        root.add(blind);
      }
      scene.add(root);
    }
  }
}

function addMarketStall(scene, def, index) {
  const root = new THREE.Group();
  root.position.set(def.x, 0, def.z);
  const steel = standard('stall-steel', 0x343a3f, 0.42, 0.72);
  const timber = standard('stall-timber', 0x70513a, 0.82, 0.02);
  const cloth = standard(`stall-cloth-${def.color}`, def.color, 0.94, 0);
  cloth.side = THREE.DoubleSide;
  const produce = [
    standard('produce-red', 0x9b2925, 0.86, 0),
    standard('produce-green', 0x476c35, 0.9, 0),
    standard('produce-orange', 0xc2742d, 0.88, 0),
  ];
  const counter = mesh(new THREE.BoxGeometry(4.8, 0.16, 1.7), timber);
  counter.position.y = 1.04;
  root.add(counter);
  const cabinet = mesh(new THREE.BoxGeometry(4.55, 0.9, 1.48), timber);
  cabinet.position.y = 0.52;
  root.add(cabinet);
  for (const x of [-2.28, 2.28]) for (const z of [-0.92, 0.92]) {
    const post = mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.05, 10), steel);
    post.position.set(x, 1.52, z);
    root.add(post);
  }
  // Slightly sagged cloth canopy: enough curvature and thickness to stop reading as a slab.
  const canopyGeo = new THREE.PlaneGeometry(5.35, 2.65, 10, 5);
  const pos = canopyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) / 2.68;
    pos.setZ(i, -0.12 * (1 - px * px));
  }
  canopyGeo.computeVertexNormals();
  const canopy = mesh(canopyGeo, cloth);
  canopy.rotation.x = -Math.PI / 2;
  canopy.position.y = 3.02;
  root.add(canopy);
  for (let i = 0; i < 14; i++) {
    const item = mesh(new THREE.SphereGeometry(0.12 + (i % 3) * 0.015, 9, 6),
      produce[i % produce.length], false);
    item.position.set(-1.65 + (i % 7) * 0.52, 1.18, -0.42 + Math.floor(i / 7) * 0.8);
    root.add(item);
  }
  const bulb = mesh(new THREE.SphereGeometry(0.075, 10, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd39b }), false);
  bulb.position.set(0, 2.72, 0);
  root.add(bulb);
  if (index % 4 === 0) {
    const pool = new THREE.PointLight(0xffb86d, 2.2, 12, 2);
    pool.position.set(0, 2.65, 0);
    root.add(pool);
  }
  scene.add(root);
}

export function addVisualProps(scene, props = []) {
  let marketIndex = 0;
  for (const def of props) {
    if (def.kind === 'vehicle') addVehicle(scene, def);
    else if (def.kind === 'facade') addFacade(scene, def);
    else if (def.kind === 'market-stall') addMarketStall(scene, def, marketIndex++);
  }
}
