// Lean, instanced frontline dressing for Street Sweep.
// Gameplay collision remains in the authored level geometry; this layer adds the evidence of
// a town held under repeated assault without turning every rubble fragment into a draw call.
import * as THREE from 'three';
import { quality } from './quality.js';
import { rng } from './world.js';

function instanced(scene, geometry, material, transforms, shadows = true) {
  const out = new THREE.InstancedMesh(geometry, material, transforms.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < transforms.length; i++) {
    const t = transforms[i];
    dummy.position.set(t[0], t[1], t[2]);
    dummy.rotation.set(t[3] || 0, t[4] || 0, t[5] || 0);
    dummy.scale.set(t[6] || 1, t[7] || 1, t[8] || 1);
    dummy.updateMatrix();
    out.setMatrixAt(i, dummy.matrix);
  }
  out.instanceMatrix.needsUpdate = true;
  out.castShadow = shadows && quality.shadows;
  out.receiveShadow = quality.shadows;
  scene.add(out);
  return out;
}

function raggedDisc(radius = 1, points = 18, seed = 1) {
  const R = rng(seed);
  const shape = new THREE.Shape();
  for (let i = 0; i < points; i++) {
    const a = i / points * Math.PI * 2;
    const r = radius * (0.72 + R() * 0.34);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

const WATCH_ROOF_GEO = (() => {
  // Triangular section extruded along the cabin width: a real pitched roof silhouette instead
  // of another thin box stacked on top of the tower.
  const shape = new THREE.Shape();
  shape.moveTo(-1.52, 0);
  shape.lineTo(1.52, 0);
  shape.lineTo(0, 0.68);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 4.8, bevelEnabled: true, bevelSegments: 2,
    bevelSize: 0.035, bevelThickness: 0.035, curveSegments: 1,
  });
  geometry.translate(0, 0, -2.4);
  geometry.rotateY(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
})();

function droneModel() {
  const root = new THREE.Group();
  const carbon = new THREE.MeshStandardMaterial({ color: 0x171a1c, roughness: 0.5, metalness: 0.45 });
  const battery = new THREE.MeshStandardMaterial({ color: 0x3f4749, roughness: 0.72 });
  const lens = new THREE.MeshPhysicalMaterial({
    color: 0x162b3b, roughness: 0.08, metalness: 0.18, clearcoat: 1,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.28), battery);
  body.castShadow = quality.shadows;
  root.add(body);
  for (const [x, z] of [[-0.36, -0.32], [0.36, -0.32], [-0.36, 0.32], [0.36, 0.32]]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.52, 8), carbon);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = Math.atan2(z, x);
    arm.position.set(x * 0.52, 0, z * 0.52);
    root.add(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 12), carbon);
    motor.position.set(x, 0.04, z);
    root.add(motor);
    const prop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.29, 0.29, 0.008, 20),
      new THREE.MeshBasicMaterial({ color: 0x252a2d, transparent: true, opacity: 0.38 }));
    prop.position.set(x, 0.09, z);
    root.add(prop);
  }
  const camera = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), lens);
  camera.scale.set(1, 0.72, 0.85);
  camera.position.set(0, -0.08, -0.18);
  root.add(camera);
  root.traverse(o => {
    if (o.isMesh) {
      o.castShadow = quality.shadows;
      o.receiveShadow = quality.shadows;
    }
  });
  return root;
}

export function addFrontlineStreetArt(scene) {
  if (!quality.desktop) return;
  const R = rng(20260728);
  const concrete = new THREE.MeshStandardMaterial({ color: 0x5a5b57, roughness: 0.96 });
  const darkConcrete = new THREE.MeshStandardMaterial({ color: 0x292c2d, roughness: 0.98 });
  const char = new THREE.MeshStandardMaterial({ color: 0x141515, roughness: 1 });
  const sand = new THREE.MeshStandardMaterial({ color: 0x716b56, roughness: 0.94 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x30373a, roughness: 0.62, metalness: 0.62 });
  const timber = new THREE.MeshStandardMaterial({ color: 0x67503a, roughness: 0.9 });

  // Shell craters: one dark floor scar plus a low irregular broken rim.
  for (const [x, z, radius] of [[-3.6, 14, 1.6], [5.4, -8, 1.15], [-4.8, -39, 1.4]]) {
    const scar = new THREE.Mesh(raggedDisc(radius, 22, Math.round((x + 10) * 97)), char);
    scar.rotation.x = -Math.PI / 2;
    scar.position.set(x, 0.031, z);
    scar.receiveShadow = true;
    scene.add(scar);
  }

  const rubble = [];
  for (let i = 0; i < 115; i++) {
    const cluster = i % 3;
    const bases = [[-3.6, 14], [5.4, -8], [-4.8, -39]];
    const [bx, bz] = bases[cluster];
    const a = R() * Math.PI * 2;
    const d = 1 + R() * 2.6;
    rubble.push([
      bx + Math.cos(a) * d, 0.08 + R() * 0.14, bz + Math.sin(a) * d,
      R() * 2, R() * 2, R() * 2,
      0.45 + R() * 0.7, 0.25 + R() * 0.45, 0.45 + R() * 0.7,
    ]);
  }
  instanced(scene, new THREE.DodecahedronGeometry(0.22, 0), concrete, rubble, false);

  // Blast/scorch marks on both occupied façades. These are intentionally large and irregular:
  // damage at this scale must alter the read of the street, not look like decorative dirt.
  const scars = [
    [-15.82, 3.2, 20, 0, Math.PI / 2, 0, 1.7, 1.3, 1],
    [-15.82, 6.5, -12, 0, Math.PI / 2, 0, 1.2, 1.0, 1],
    [-15.82, 4.6, -43, 0, Math.PI / 2, 0, 2.1, 1.5, 1],
    [15.82, 4.0, 31, 0, -Math.PI / 2, 0, 1.5, 1.2, 1],
    [15.82, 6.2, 2, 0, -Math.PI / 2, 0, 1.1, 0.9, 1],
    [15.82, 3.4, -32, 0, -Math.PI / 2, 0, 1.9, 1.4, 1],
  ];
  instanced(scene, raggedDisc(1, 20, 92), char, scars, false);

  // Observation post at the south end: sandbag firing bay, launch table, antenna and cases.
  const bags = [];
  for (let i = 0; i < 10; i++) {
    bags.push([-13.8 + i * 0.58, 0.33, -43.6, 0, 0, Math.PI / 2, 1, 1, 1]);
    if (i < 6) bags.push([-13.8, 0.33, -43.6 + i * 0.55, Math.PI / 2, 0, 0, 1, 1, 1]);
  }
  for (let i = 0; i < 8; i++) {
    bags.push([-13.5 + i * 0.62, 0.64, -43.6, 0, 0, Math.PI / 2, 1, 1, 1]);
  }
  instanced(scene, new THREE.CapsuleGeometry(0.19, 0.42, 4, 8), sand, bags);

  const table = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.13, 0.92), timber);
  table.position.set(-11.15, 1.05, -41.6);
  table.castShadow = table.receiveShadow = true;
  scene.add(table);
  const legs = [
    [-12.0, 0.52, -41.88, 0, 0, 0, 1, 1, 1],
    [-10.3, 0.52, -41.88, 0, 0, 0, 1, 1, 1],
    [-12.0, 0.52, -41.32, 0, 0, 0, 1, 1, 1],
    [-10.3, 0.52, -41.32, 0, 0, 0, 1, 1, 1],
  ];
  instanced(scene, new THREE.BoxGeometry(0.1, 1.0, 0.1), steel, legs);

  const drone = droneModel();
  drone.position.set(-11.15, 1.28, -41.6);
  drone.rotation.y = -0.25;
  scene.add(drone);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 5.4, 10), steel);
  mast.position.set(-14.2, 2.7, -40.5);
  mast.castShadow = true;
  scene.add(mast);
  const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.42), darkConcrete);
  antenna.position.set(-14.2, 4.95, -40.5);
  antenna.rotation.y = 0.35;
  scene.add(antenna);

  const cases = [
    [-9.75, 0.28, -42.35, 0, 0.25, 0, 1.2, 0.6, 0.8],
    [-10.1, 0.22, -40.8, 0, -0.2, 0, 0.9, 0.5, 0.65],
    [-12.7, 0.25, -40.75, 0, 0.1, 0, 1.0, 0.55, 0.7],
  ];
  instanced(scene, new THREE.BoxGeometry(0.75, 0.52, 0.48), darkConcrete, cases);

  // Sagging field cable from the relay into the launch table.
  const cablePoints = [];
  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    cablePoints.push(new THREE.Vector3(
      -14.2 + t * 3.0,
      4.65 * (1 - t) + 1.15 * t - Math.sin(t * Math.PI) * 0.65,
      -40.5 - t * 1.1,
    ));
  }
  const cable = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(cablePoints),
    new THREE.LineBasicMaterial({ color: 0x111315 }));
  scene.add(cable);
}

// Low-cost common language shared by the other outdoor missions. The layout remains authored;
// this pass only makes the perimeter and approach read as a district under sustained fire.
export function addFrontlineAmbientArt(scene, levelId, bounds) {
  if (!quality.desktop || !bounds || levelId === 2) return;
  const R = rng(81001 + levelId * 997);
  const concrete = new THREE.MeshStandardMaterial({ color: 0x555956, roughness: 0.98 });
  const char = new THREE.MeshStandardMaterial({ color: 0x17191a, roughness: 1 });
  const chunks = [];
  const craters = [];
  const radius = Math.max(10, Math.min(bounds.r * 0.78, 42));

  for (let cluster = 0; cluster < 4; cluster++) {
    const angle = R() * Math.PI * 2;
    const distance = radius * (0.48 + R() * 0.42);
    const x = bounds.cx + Math.cos(angle) * distance;
    const z = bounds.cz + Math.sin(angle) * distance;
    craters.push([x, z, 0.65 + R() * 0.8]);
    for (let i = 0; i < 18; i++) {
      const a = R() * Math.PI * 2;
      const d = 0.7 + R() * 2.1;
      chunks.push([
        x + Math.cos(a) * d, 0.08 + R() * 0.13, z + Math.sin(a) * d,
        R() * 2, R() * 2, R() * 2,
        0.3 + R() * 0.55, 0.22 + R() * 0.35, 0.3 + R() * 0.55,
      ]);
    }
  }
  for (let i = 0; i < craters.length; i++) {
    const [x, z, scale] = craters[i];
    const scar = new THREE.Mesh(raggedDisc(scale, 18, levelId * 41 + i), char);
    scar.rotation.x = -Math.PI / 2;
    scar.position.set(x, 0.028, z);
    scene.add(scar);
  }
  instanced(scene, new THREE.DodecahedronGeometry(0.2, 0), concrete, chunks, false);

  if ([4, 5, 7, 10].includes(levelId)) {
    const steel = new THREE.MeshStandardMaterial({
      color: 0x252a2b, roughness: 0.72, metalness: 0.46,
    });
    const poles = [];
    const polePositions = [];
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? -1 : 1;
      const along = (i < 2 ? -0.32 : 0.32) * radius;
      const x = bounds.cx + side * radius * 0.7;
      const z = bounds.cz + along;
      const lean = (R() - 0.5) * 0.14;
      polePositions.push([x, z]);
      poles.push([x, 3.5, z, lean, 0, lean * 0.35, 1, 1, 1]);
    }
    instanced(scene, new THREE.CylinderGeometry(0.08, 0.12, 7, 8), steel, poles);
    for (let i = 0; i < polePositions.length; i += 2) {
      const [ax, az] = polePositions[i];
      const [bx, bz] = polePositions[i + 1];
      const points = [];
      for (let p = 0; p < 14; p++) {
        const t = p / 13;
        points.push(new THREE.Vector3(
          ax + (bx - ax) * t,
          6.55 - Math.sin(t * Math.PI) * (0.65 + (i / 2) * 0.22),
          az + (bz - az) * t,
        ));
      }
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x101213 }),
      ));
    }
  }
}

function addObservationPost(scene, x, y, z, yaw = 0) {
  const sand = new THREE.MeshStandardMaterial({ color: 0x706b58, roughness: 0.96 });
  const timber = new THREE.MeshStandardMaterial({ color: 0x5c4733, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x262d30, roughness: 0.58, metalness: 0.62 });
  const equipment = new THREE.MeshStandardMaterial({ color: 0x252b2a, roughness: 0.76 });
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const bags = [];
  for (let i = -4; i <= 4; i++) {
    bags.push([x + c * i * 0.5, y + 0.2, z - s * i * 0.5, 0, yaw, Math.PI / 2, 1, 1, 1]);
    if (Math.abs(i) < 4) {
      bags.push([x + c * i * 0.5, y + 0.48, z - s * i * 0.5, 0, yaw, Math.PI / 2, 1, 1, 1]);
    }
  }
  instanced(scene, new THREE.CapsuleGeometry(0.17, 0.38, 4, 8), sand, bags);

  const table = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.11, 0.78), timber);
  table.position.set(x, y + 0.86, z + 1.25);
  table.rotation.y = yaw;
  table.castShadow = table.receiveShadow = quality.shadows;
  scene.add(table);
  const legs = [];
  for (const lx of [-0.72, 0.72]) for (const lz of [-0.25, 0.25]) {
    const wx = x + c * lx + s * lz;
    const wz = z - s * lx + c * lz + 1.25;
    legs.push([wx, y + 0.42, wz, 0, yaw, 0, 1, 1, 1]);
  }
  instanced(scene, new THREE.BoxGeometry(0.08, 0.82, 0.08), steel, legs);
  const drone = droneModel();
  drone.position.set(x, y + 1.04, z + 1.25);
  drone.rotation.y = yaw - 0.2;
  scene.add(drone);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.4, 8), steel);
  mast.position.set(x - c * 2.1, y + 1.7, z + s * 2.1 + 0.2);
  scene.add(mast);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.74, 0.34), equipment);
  panel.position.copy(mast.position);
  panel.position.y += 1.18;
  panel.rotation.y = yaw + 0.25;
  scene.add(panel);
}

export function addFrontlineMissionArt(scene, levelId) {
  if (!quality.desktop) return;
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b302f, roughness: 0.86 });
  const sand = new THREE.MeshStandardMaterial({ color: 0x706b58, roughness: 0.96 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x30373a, roughness: 0.58, metalness: 0.58 });

  if (levelId === 3) addObservationPost(scene, -2, 9.2, -6, 0);
  if (levelId === 6) addObservationPost(scene, -4, 24.2, 60, 0);
  if (levelId === 7) addObservationPost(scene, -3, 12.25, -2, Math.PI / 2);

  if (levelId === 4) {
    // The abandoned direction-finding set at the escape gate.
    instanced(scene, new THREE.BoxGeometry(0.7, 0.48, 0.5), dark, [
      [-10, 0.26, -36.5, 0, 0.2, 0, 1.2, 0.9, 1],
      [-8.7, 0.22, -37.1, 0, -0.15, 0, 0.9, 0.75, 0.9],
      [-7.7, 0.18, -36.2, 0, 0.1, 0, 0.75, 0.65, 0.8],
    ]);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 5.2, 8), steel);
    mast.position.set(-10.5, 2.6, -36.8);
    mast.rotation.z = -0.12;
    scene.add(mast);
  }

  if (levelId === 5) {
    // Aid pallets and blast barriers make the market a contested humanitarian site.
    const pallets = [];
    for (const [x, z] of [[-26, 28], [25, 16], [-24, -20], [22, -26]]) {
      for (let i = 0; i < 6; i++) {
        pallets.push([x + (i % 3) * 0.72, 0.3 + Math.floor(i / 3) * 0.58, z,
          0, (i % 2) * 0.08, 0, 1, 1, 1]);
      }
    }
    instanced(scene, new THREE.BoxGeometry(0.64, 0.54, 0.62), dark, pallets);
  }

  if (levelId === 10) {
    // Prepared fallback line outside the compound gate.
    const bags = [];
    for (const side of [-1, 1]) for (let i = 0; i < 9; i++) {
      bags.push([side * (3.2 + i * 0.5), 0.2, 34, 0, 0, Math.PI / 2, 1, 1, 1]);
      if (i < 7) bags.push([side * (3.5 + i * 0.5), 0.48, 34, 0, 0, Math.PI / 2, 1, 1, 1]);
    }
    instanced(scene, new THREE.CapsuleGeometry(0.17, 0.38, 4, 8), sand, bags);

    // The compound's old municipal wall has been converted into a fighting position. These
    // silhouettes sit above the collision shell and turn the blank slab into a defended gate.
    const timber = new THREE.MeshStandardMaterial({ color: 0x4b5048, roughness: 0.93 });
    const roofSteel = new THREE.MeshStandardMaterial({
      color: 0x2c3335, roughness: 0.54, metalness: 0.56,
    });
    const char = new THREE.MeshStandardMaterial({
      color: 0x202324, roughness: 1, transparent: true, opacity: 0.76,
    });
    const watchGlass = new THREE.MeshStandardMaterial({
      color: 0x162630, roughness: 0.2, metalness: 0.08,
    });
    const towerParts = [];
    const towerRoofs = [];
    const towerSupports = [];
    const towerWindows = [];
    const towerFrames = [];
    const towerBraces = [];
    const towerLadders = [];
    const towerRails = [];
    const platformBags = [];
    for (const x of [-8.5, 8.5]) {
      towerParts.push(
        [x, 4.35, 30.25, 0, 0, 0, 4.2, 0.24, 2.35],
        [x, 5.25, 30.75, 0, 0, 0, 4.0, 1.7, 0.14],
        [x - 1.92, 5.15, 30.25, 0, 0, 0, 0.14, 1.9, 2.1],
        [x + 1.92, 5.15, 30.25, 0, 0, 0, 0.14, 1.9, 2.1],
      );
      towerRoofs.push([x, 6.15, 30.25, 0, 0, 0, 1, 1, 1]);
      towerWindows.push([x, 5.35, 30.84, 0, 0, 0, 3.2, 0.64, 0.04]);
      for (const dx of [-1.55, 1.55]) for (const dz of [-0.74, 0.74]) {
        towerSupports.push([x + dx, 2.15, 30.25 + dz, 0, 0, 0, 1, 4.3, 1]);
      }
      // Window surround and central mullion hold their shape against a bright sky.
      towerFrames.push(
        [x, 5.72, 30.88, 0, 0, 0, 3.42, 0.07, 0.07],
        [x, 4.98, 30.88, 0, 0, 0, 3.42, 0.07, 0.07],
        [x - 1.68, 5.35, 30.88, 0, 0, 0, 0.07, 0.82, 0.07],
        [x + 1.68, 5.35, 30.88, 0, 0, 0, 0.07, 0.82, 0.07],
        [x, 5.35, 30.89, 0, 0, 0, 0.06, 0.72, 0.06],
      );
      // X-bracing turns four poles into an engineered firing platform.
      towerBraces.push(
        [x, 2.25, 29.48, 0, 0, 0.9, 4.2, 0.07, 0.08],
        [x, 2.25, 29.46, 0, 0, -0.9, 4.2, 0.07, 0.08],
      );
      const inner = x < 0 ? x + 1.42 : x - 1.42;
      towerLadders.push(
        [inner - 0.22, 2.15, 29.38, 0, 0, 0, 0.055, 4.1, 0.055],
        [inner + 0.22, 2.15, 29.38, 0, 0, 0, 0.055, 4.1, 0.055],
      );
      for (let rung = 0; rung < 10; rung++) {
        towerLadders.push([
          inner, 0.42 + rung * 0.39, 29.36, 0, 0, 0, 0.5, 0.045, 0.055,
        ]);
      }
      for (const side of [-1, 1]) {
        towerRails.push(
          [x + side * 2.02, 4.8, 30.25, 0, 0, 0, 0.055, 0.055, 2.4],
          [x + side * 2.02, 4.62, 29.35, 0, 0, 0, 0.055, 0.72, 0.055],
          [x + side * 2.02, 4.62, 31.15, 0, 0, 0, 0.055, 0.72, 0.055],
        );
      }
      for (let bag = -3; bag <= 3; bag++) {
        platformBags.push([
          x + bag * 0.48, 4.54, 29.18, 0, 0, Math.PI / 2, 1, 1, 1,
        ]);
      }
    }
    const bodies = instanced(scene, new THREE.BoxGeometry(1, 1, 1), timber, towerParts);
    bodies.name = 'watch-post-bodies';
    const roofs = instanced(scene, WATCH_ROOF_GEO, roofSteel, towerRoofs);
    roofs.name = 'watch-post-pitched-roofs';
    const windows = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), watchGlass, towerWindows, false);
    windows.name = 'watch-post-windows';
    const supports = instanced(
      scene, new THREE.CylinderGeometry(0.075, 0.1, 1, 8), steel, towerSupports);
    supports.name = 'watch-post-supports';
    const frames = instanced(scene, new THREE.BoxGeometry(1, 1, 1), steel, towerFrames);
    frames.name = 'watch-post-window-frames';
    const braces = instanced(scene, new THREE.BoxGeometry(1, 1, 1), steel, towerBraces);
    braces.name = 'watch-post-cross-braces';
    const ladders = instanced(scene, new THREE.BoxGeometry(1, 1, 1), steel, towerLadders);
    ladders.name = 'watch-post-ladders';
    const rails = instanced(scene, new THREE.BoxGeometry(1, 1, 1), steel, towerRails);
    rails.name = 'watch-post-rails';
    const fortification = instanced(
      scene, new THREE.CapsuleGeometry(0.16, 0.34, 4, 8), sand, platformBags);
    fortification.name = 'watch-post-sandbags';

    const gateScars = [
      [-12.5, 2.1, 30.21, 0, 0, -0.2, 0.86, 0.7, 1],
      [15.8, 2.55, 30.21, 0, 0, 0.12, 0.82, 0.7, 1],
    ];
    instanced(scene, raggedDisc(1, 18, 1091), char, gateScars, false);

    const gateRubble = [];
    for (let i = 0; i < 28; i++) {
      const side = i % 2 ? -1 : 1;
      gateRubble.push([
        side * (3.3 + (i % 7) * 0.32), 0.08 + (i % 3) * 0.055,
        29.2 + ((i * 7) % 9) * 0.15,
        i * 0.31, i * 0.17, i * 0.23,
        0.42 + (i % 4) * 0.12, 0.28 + (i % 3) * 0.11, 0.38 + (i % 5) * 0.08,
      ]);
    }
    instanced(scene, new THREE.DodecahedronGeometry(0.19, 0), dark, gateRubble, false);
  }
}
