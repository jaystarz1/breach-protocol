import * as THREE from 'three';
import {
  groundHeight, hasLOS, raycastSolids, raySphere, rayVerticalCapsule,
} from './physics.js';

const MAX_RANGE = 95;
const MAX_SPEED = 16;
const DRONE_MUNITION_GEO = new THREE.SphereGeometry(0.12, 10, 7);
const DRONE_FLASH_GEO = new THREE.SphereGeometry(1.05, 18, 12);
const DRONE_SMOKE_GEO = new THREE.SphereGeometry(1.25, 14, 10);
const DRONE_SHOCKWAVE_GEO = new THREE.RingGeometry(0.9, 1.15, 40);
const DRONE_FRAGMENT_GEO = new THREE.BoxGeometry(0.13, 0.13, 0.13);
const DRONE_HEAT_BODY_GEO = new THREE.CapsuleGeometry(0.23, 0.68, 4, 8);
const DRONE_HEAT_HEAD_GEO = new THREE.SphereGeometry(0.2, 10, 7);
const DRONE_HEAT_VEHICLE_GEO = new THREE.BoxGeometry(3.8, 1.45, 1.9);
const DRONE_MUNITION_MAT = new THREE.MeshBasicMaterial({
  name: 'drone-strike-munition', color: 0xffd4a3,
});
const DRONE_FRAGMENT_HOT_MAT = new THREE.MeshBasicMaterial({
  name: 'drone-strike-fragment-hot', color: 0xff7b3d,
});
const DRONE_FRAGMENT_DARK_MAT = new THREE.MeshBasicMaterial({
  name: 'drone-strike-fragment-dark', color: 0x252a27,
});
const DRONE_TRACER_MAT = new THREE.LineBasicMaterial({
  name: 'drone-rifle-tracer', color: 0xffe0a1,
  transparent: true, opacity: 0.92, depthWrite: false,
});
const DRONE_HEAT_CORE_MAT = new THREE.MeshBasicMaterial({
  name: 'drone-thermal-core', color: 0xfffbd0,
  transparent: true, opacity: 0.88, depthTest: true, depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const DRONE_HEAT_HALO_MAT = new THREE.MeshBasicMaterial({
  name: 'drone-thermal-halo', color: 0xffb870,
  transparent: true, opacity: 0.22, depthTest: true, depthWrite: false,
  blending: THREE.AdditiveBlending,
});
for (const geometry of [
  DRONE_MUNITION_GEO,
  DRONE_FLASH_GEO,
  DRONE_SMOKE_GEO,
  DRONE_SHOCKWAVE_GEO,
  DRONE_FRAGMENT_GEO,
  DRONE_HEAT_BODY_GEO,
  DRONE_HEAT_HEAD_GEO,
  DRONE_HEAT_VEHICLE_GEO,
]) {
  geometry.userData.bpPersistent = true;
}
for (const material of [
  DRONE_MUNITION_MAT, DRONE_FRAGMENT_HOT_MAT, DRONE_FRAGMENT_DARK_MAT,
  DRONE_TRACER_MAT,
  DRONE_HEAT_CORE_MAT, DRONE_HEAT_HALO_MAT,
]) {
  material.userData.bpPersistent = true;
}

function disposeObject(root) {
  root.traverse(part => {
    if (part.geometry && !part.geometry.userData.bpPersistent) part.geometry.dispose();
    if (Array.isArray(part.material)) {
      part.material.forEach(material => {
        if (!material.userData.bpPersistent) material.dispose();
      });
    } else if (part.material && !part.material.userData.bpPersistent) {
      part.material.dispose();
    }
  });
}

function thermalSignature(target, vehicle = false) {
  const root = new THREE.Group();
  root.name = vehicle ? 'drone-thermal-vehicle' : 'drone-thermal-combatant';
  if (vehicle) {
    const halo = new THREE.Mesh(DRONE_HEAT_VEHICLE_GEO, DRONE_HEAT_HALO_MAT);
    halo.scale.set(1.12, 1.18, 1.12);
    halo.position.y = 0.82;
    root.add(halo);
    const core = new THREE.Mesh(DRONE_HEAT_VEHICLE_GEO, DRONE_HEAT_CORE_MAT);
    core.scale.set(0.92, 0.72, 0.88);
    core.position.y = 0.82;
    root.add(core);
  } else {
    const halo = new THREE.Mesh(DRONE_HEAT_BODY_GEO, DRONE_HEAT_HALO_MAT);
    halo.scale.set(1.35, 1.16, 1.35);
    halo.position.y = 0.93;
    root.add(halo);
    const body = new THREE.Mesh(DRONE_HEAT_BODY_GEO, DRONE_HEAT_CORE_MAT);
    body.position.y = 0.93;
    root.add(body);
    const head = new THREE.Mesh(DRONE_HEAT_HEAD_GEO, DRONE_HEAT_CORE_MAT);
    head.position.y = 1.61;
    root.add(head);
  }
  root.userData.target = target;
  root.userData.vehicle = vehicle;
  root.traverse(part => {
    if (part.isMesh) {
      part.renderOrder = 8;
      part.frustumCulled = false;
    }
  });
  return root;
}

function reconRouteModel(target) {
  const points = (target.route?.length ? target.route : [
    [target.pos.x, target.pos.y + 0.04, target.pos.z],
    [target.pos.x, target.pos.y + 0.04, target.pos.z + 8],
  ]).map(point => Array.isArray(point)
    ? new THREE.Vector3(...point) : point.clone());
  const root = new THREE.Group();
  root.name = `recon-confirmed-route-${target.index + 1}`;
  const material = new THREE.LineBasicMaterial({
    name: 'recon-confirmed-route-line',
    color: 0x63e6ff, transparent: true, opacity: 0.88,
    depthTest: true, depthWrite: false,
  });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
  line.name = 'recon-route-line';
  root.add(line);
  const markerMat = new THREE.MeshBasicMaterial({
    name: 'recon-route-chevron', color: 0xa7f3ff,
    transparent: true, opacity: 0.9, depthWrite: false,
  });
  for (let i = 0; i < points.length; i++) {
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.62, 3), markerMat);
    marker.name = 'recon-route-chevron';
    marker.position.copy(points[i]);
    marker.position.y += 0.09;
    marker.rotation.x = Math.PI / 2;
    if (i < points.length - 1) {
      const dx = points[i + 1].x - points[i].x;
      const dz = points[i + 1].z - points[i].z;
      marker.rotation.z = -Math.atan2(dx, dz);
    }
    root.add(marker);
  }
  return root;
}

function strikeTargetModel(target) {
  const root = new THREE.Group();
  root.name = `drone-strike-target-${target.kind || 'asset'}`;
  const olive = new THREE.MeshStandardMaterial({
    name: 'drone-strike-olive',
    color: 0x3d4935, roughness: 0.84, metalness: 0.24,
  });
  const dark = new THREE.MeshStandardMaterial({
    name: 'drone-strike-dark',
    color: 0x171c19, roughness: 0.72, metalness: 0.42,
  });
  const steel = new THREE.MeshStandardMaterial({
    name: 'drone-strike-steel',
    color: 0x59605a, roughness: 0.62, metalness: 0.58,
  });
  const glass = new THREE.MeshStandardMaterial({
    name: 'drone-strike-glass',
    color: 0x17252b, roughness: 0.2, metalness: 0.28,
  });
  const crewUniform = new THREE.MeshStandardMaterial({
    name: 'drone-strike-artillery-crew',
    color: 0x394236, roughness: 0.92, metalness: 0.02,
  });
  const crewSkin = new THREE.MeshStandardMaterial({
    name: 'drone-strike-artillery-crew-skin',
    color: 0x8d6f59, roughness: 0.9, metalness: 0,
  });
  const add = (geometry, material, position, rotation = null) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  if (target.kind === 'technical') {
    // A light assault pickup: readable from altitude, open enough that jury-rigged grenades
    // remain a believable counter, and much cheaper than loading another authored vehicle.
    add(new THREE.BoxGeometry(3.9, 0.38, 1.85), olive, [0, 0.68, 0]);
    add(new THREE.BoxGeometry(1.35, 0.82, 1.72), olive, [-1.0, 1.25, 0]);
    add(new THREE.BoxGeometry(0.72, 0.42, 1.6), glass, [-1.28, 1.43, 0]);
    add(new THREE.BoxGeometry(1.45, 0.22, 1.76), olive, [1.05, 0.95, 0]);
    for (const x of [-1.25, 1.28]) for (const z of [-0.92, 0.92]) {
      add(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 14), dark,
        [x, 0.45, z * 0.82], [Math.PI / 2, 0, 0]);
    }
    add(new THREE.CylinderGeometry(0.1, 0.14, 0.8, 10), steel, [0.72, 1.48, 0]);
    add(new THREE.BoxGeometry(0.46, 0.28, 0.3), dark, [0.72, 1.91, 0]);
    add(new THREE.CylinderGeometry(0.055, 0.075, 1.75, 8), steel,
      [-0.12, 1.94, 0], [0, 0, Math.PI / 2]);
  } else if (target.kind === 'ew') {
    add(new THREE.BoxGeometry(3.5, 0.72, 1.75), olive, [0, 0.78, 0]);
    add(new THREE.BoxGeometry(1.15, 1.08, 1.68), olive, [-1.05, 1.58, 0]);
    add(new THREE.BoxGeometry(0.86, 0.42, 1.7), glass, [-1.32, 1.75, 0]);
    for (const x of [-1.15, 1.1]) for (const z of [-0.92, 0.92]) {
      add(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 16), dark,
        [x, 0.48, z * 0.76], [Math.PI / 2, 0, 0]);
    }
    add(new THREE.CylinderGeometry(0.045, 0.065, 4.4, 8), steel, [0.75, 3.15, 0]);
    for (const y of [2.65, 3.65, 4.55]) {
      add(new THREE.BoxGeometry(1.5, 0.06, 0.06), steel, [0.75, y, 0]);
    }
    add(new THREE.BoxGeometry(1.2, 1.1, 1.45), dark, [0.85, 1.65, 0]);
  } else if (target.kind === 'artillery') {
    add(new THREE.BoxGeometry(3.8, 0.48, 1.65), olive, [0, 0.72, 0]);
    for (const x of [-1.22, 1.22]) for (const z of [-0.94, 0.94]) {
      add(new THREE.CylinderGeometry(0.44, 0.44, 0.28, 18), dark,
        [x, 0.48, z * 0.78], [Math.PI / 2, 0, 0]);
    }
    add(new THREE.CylinderGeometry(0.58, 0.7, 0.58, 14), olive, [0.15, 1.18, 0]);
    add(new THREE.CylinderGeometry(0.12, 0.17, 4.3, 12), steel,
      [-1.72, 1.6, 0], [0, 0, Math.PI / 2 - 0.18]);
    add(new THREE.BoxGeometry(1.1, 0.62, 1.48), olive, [0.55, 1.42, 0]);
    // A gun position needs people and working space around it. These restrained silhouettes
    // remain cheap at UAV distance, but make the target read as a crewed battery rather than
    // a roadblock prop.
    const crew = [];
    for (const [x, z, yaw] of [
      [1.65, 1.48, -0.55], [0.55, -1.72, 0.3], [-0.72, 1.78, -0.1],
    ]) {
      const soldier = new THREE.Group();
      soldier.position.set(x, 0.04, z);
      soldier.rotation.y = yaw;
      const torso = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.23, 0.66, 4, 8), crewUniform);
      torso.position.y = 0.92;
      soldier.add(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 7), crewSkin);
      head.position.y = 1.57;
      soldier.add(head);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.09, 0.48, 3, 7), crewUniform);
        leg.position.set(side * 0.13, 0.37, 0);
        soldier.add(leg);
      }
      root.add(soldier);
      crew.push(soldier);
    }

    if (target.firing) {
      const flashMaterial = new THREE.MeshBasicMaterial({
        name: 'drone-artillery-muzzle-flash',
        color: 0xffc06b, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const smokeMaterial = new THREE.MeshStandardMaterial({
        name: 'drone-artillery-muzzle-smoke',
        color: 0x676c67, roughness: 1, metalness: 0,
        transparent: true, opacity: 0, depthWrite: false,
      });
      const flash = add(
        new THREE.SphereGeometry(0.42, 10, 7), flashMaterial,
        [-3.82, 1.95, 0]);
      const smoke = add(
        new THREE.SphereGeometry(0.55, 10, 7), smokeMaterial,
        [-4.05, 2.02, 0]);
      let firingClock = (target.index || 0) * 1.17;
      root.userData.update = dt => {
        if (root.userData.destroyed) {
          flash.visible = smoke.visible = false;
          return;
        }
        firingClock = (firingClock + dt) % 4.2;
        const firing = firingClock < 0.13;
        flash.visible = firing;
        flash.material.opacity = firing ? 0.94 * (1 - firingClock / 0.13) : 0;
        flash.scale.setScalar(1 + firingClock * 8);
        const smokeAge = firingClock - 0.08;
        smoke.visible = smokeAge >= 0 && smokeAge < 1.35;
        smoke.material.opacity = smoke.visible ? 0.34 * (1 - smokeAge / 1.35) : 0;
        smoke.position.set(-4.05 - smokeAge * 0.55, 2.02 + smokeAge * 0.85, 0);
        smoke.scale.setScalar(0.7 + Math.max(0, smokeAge) * 1.5);
      };
    }
    root.userData.crew = crew;
  } else {
    // An IFV-like silhouette: sloped hull, continuous tracks, turret and cannon. At drone
    // altitude the outline and moving shadow matter more than tiny vehicle trim.
    add(new THREE.BoxGeometry(3.8, 0.58, 2.15), olive, [0, 0.82, 0],
      [0, 0, -0.04]);
    for (const z of [-1.05, 1.05]) {
      add(new THREE.BoxGeometry(3.55, 0.48, 0.34), dark, [0, 0.55, z]);
      for (const x of [-1.35, -0.68, 0, 0.68, 1.35]) {
        add(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 14), steel,
          [x, 0.55, z * 1.01], [Math.PI / 2, 0, 0]);
      }
    }
    add(new THREE.CylinderGeometry(0.72, 0.82, 0.5, 12), olive, [0.15, 1.42, 0]);
    add(new THREE.BoxGeometry(1.22, 0.42, 1.16), olive, [0.22, 1.7, 0]);
    add(new THREE.CylinderGeometry(0.09, 0.13, 2.8, 10), steel,
      [-1.45, 1.72, 0], [0, 0, Math.PI / 2]);
  }

  root.position.copy(target.pos);
  root.position.y += 0.02;
  root.rotation.y = target.yaw || 0;
  root.userData.markDestroyed = () => {
    // Every target owns these four materials, so mutate them in place. Cloning a fresh wreck
    // material at impact made Three release/compile programs in live play and produced a hitch
    // on every strike even though the shader flags were otherwise identical.
    for (const wreck of [olive, dark, steel, glass, crewUniform, crewSkin]) {
      wreck.color.multiplyScalar(0.22);
      wreck.roughness = 0.98;
      wreck.metalness *= 0.5;
    }
    root.rotation.z = target.kind === 'ew' ? 0.05 : -0.035;
    for (const [index, soldier] of (root.userData.crew || []).entries()) {
      soldier.rotation.z = (index % 2 ? -1 : 1) * (1.12 + index * 0.08);
      soldier.position.y = 0.16;
    }
    root.userData.destroyed = true;
  };
  root.userData.dispose = () => disposeObject(root);
  return root;
}

export function createDroneAssaultVehicle(scene, definition = {}) {
  const pos = new THREE.Vector3(...(definition.pos || [0, 0, 0]));
  const mesh = strikeTargetModel({
    pos, kind: definition.kind || 'technical', yaw: definition.yaw || 0,
  });
  mesh.name = 'drone-assault-technical';
  scene.add(mesh);
  const vehicle = {
    pos,
    mesh,
    maxHealth: definition.health ?? 190,
    health: definition.health ?? 190,
    dead: false,
    route: (definition.route || []).map(point => ({
      x: point[0],
      y: point.length > 2 ? point[1] : 0,
      z: point.length > 2 ? point[2] : point[1],
    })),
    routeIdx: 0,
    speed: definition.speed ?? 4.4,
    damage(amount) {
      if (this.dead) return false;
      this.health = Math.max(0, this.health - amount);
      if (this.health > 0) return false;
      this.dead = true;
      this.mesh.userData.markDestroyed?.();
      return true;
    },
    update(dt, solids) {
      if (this.dead || !this.route.length) return;
      const waypoint = this.route[Math.min(this.routeIdx, this.route.length - 1)];
      const dx = waypoint.x - this.pos.x;
      const dz = waypoint.z - this.pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.7 && this.routeIdx < this.route.length - 1) {
        this.routeIdx++;
        return;
      }
      if (distance > 0.001) {
        const travel = Math.min(distance, this.speed * dt);
        this.pos.x += dx / distance * travel;
        this.pos.z += dz / distance * travel;
        this.mesh.rotation.y = Math.atan2(dz, -dx);
      }
      const ground = groundHeight(solids, this.pos.x, this.pos.z, 0.2, this.pos.y + 2);
      if (ground !== -Infinity) this.pos.y = ground;
      this.mesh.position.copy(this.pos);
      this.mesh.position.y += 0.02;
    },
  };
  return vehicle;
}

export function dronePrewarmGroup(definition) {
  if (!['strike', 'combat'].includes(definition?.mode)) return null;
  const root = new THREE.Group();
  root.name = 'drone-strike-material-prewarm';
  // Keep one representative of every shader state and shared dynamic geometry a strike can
  // introduce. These sit outside the world but bypass frustum culling during the loading
  // render, forcing GPU buffer upload before a live weapon release.
  root.position.y = -10000;
  if (definition.mode === 'strike') {
    const representative = definition.targets?.[0] || {};
    root.add(strikeTargetModel({
      pos: new THREE.Vector3(),
      kind: representative.kind || 'armor',
      firing: !!representative.firing,
      index: 0,
      yaw: 0,
    }));
  }
  root.add(new THREE.Mesh(
    DRONE_MUNITION_GEO,
    DRONE_MUNITION_MAT,
  ));
  root.add(new THREE.Mesh(
    DRONE_FLASH_GEO,
    new THREE.MeshBasicMaterial({
      color: 0xffd08a, transparent: true, opacity: 1,
      name: 'drone-strike-flash',
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  ));
  root.add(new THREE.Mesh(
    DRONE_SMOKE_GEO,
    new THREE.MeshStandardMaterial({
      color: 0x171a18, roughness: 1, metalness: 0,
      name: 'drone-strike-smoke',
      transparent: true, opacity: 0.62, depthWrite: false,
    }),
  ));
  root.add(new THREE.Mesh(
    DRONE_SHOCKWAVE_GEO,
    new THREE.MeshBasicMaterial({
      name: 'drone-strike-shockwave',
      color: 0xff9d52, transparent: true, opacity: 0.82,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }),
  ));
  root.add(new THREE.Mesh(
    DRONE_FRAGMENT_GEO,
    DRONE_FRAGMENT_HOT_MAT,
  ));
  if (definition.mode === 'combat') {
    if (definition.combatWave?.vehicle) {
      root.add(strikeTargetModel({
        pos: new THREE.Vector3(), kind: definition.combatWave.vehicle.kind || 'technical',
        yaw: 0,
      }));
    }
    root.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(), new THREE.Vector3(0, 0, -2),
      ]),
      DRONE_TRACER_MAT,
    ));
    root.add(thermalSignature({ dead: false, pos: new THREE.Vector3() }));
    root.add(thermalSignature({ dead: false, pos: new THREE.Vector3() }, true));
  }
  root.traverse(part => {
    if (part.isMesh || part.isLine) part.frustumCulled = false;
  });
  root.userData.dispose = () => disposeObject(root);
  return root;
}

export class DroneController {
  constructor(scene, camera, definition, onComplete) {
    this.scene = scene;
    this.camera = camera;
    this.launch = new THREE.Vector3(...definition.launch);
    this.pos = this.launch.clone();
    this.pos.y += 1.7;
    this.vel = new THREE.Vector3();
    this.yaw = definition.yaw ?? Math.PI;
    this.pitch = -0.08;
    this.roll = 0;
    this.battery = 100;
    this.signal = 1;
    this.active = true;
    this.complete = false;
    this.onComplete = onComplete;
    this.mode = definition.mode || 'recon';
    this.persistWrecks = !!definition.persistWrecks;
    this.persistIntel = !!definition.persistIntel;
    this.resultText = definition.result || 'ASSAULT ROUTES MAPPED';
    this.combatants = definition.combatants || [];
    this.combatVehicles = definition.combatVehicles || [];
    this.rifleRounds = this.mode === 'combat' ? (definition.rifleRounds ?? 100) : 0;
    this.grenadeRounds = this.mode === 'combat' ? (definition.grenades ?? 10) : 0;
    this.rifleCooldown = 0;
    this.shotsFired = 0;
    this.onCombatShot = definition.onCombatShot || null;
    this.onCombatHit = definition.onCombatHit || null;
    this.onCombatVehicleHit = definition.onCombatVehicleHit || null;
    this.onCombatBlast = definition.onCombatBlast || null;
    this.targets = (definition.targets || []).map((entry, index) => ({
      ...(Array.isArray(entry) ? {} : entry),
      pos: new THREE.Vector3(...(Array.isArray(entry) ? entry : entry.pos)),
      marked: false,
      engaged: false,
      index,
    }));
    this.munitions = [];
    this.effects = [];
    this.completionTimer = null;
    this.savedFov = camera.fov;
    this.childVisibility = [];
    // Hide view-model drawables, not their layer-1-only lighting rig. Hiding the holder group
    // removed one hemisphere, directional and point light from Three's global light counts;
    // that changed shader defines and compiled a fresh program family during drone flight.
    // The retained lights cannot affect layer-0 world geometry, but keep program keys stable.
    camera.traverse(child => {
      if (child === camera) return;
      this.childVisibility.push([child, child.visible]);
      if (child.isMesh || child.isLine || child.isPoints || child.isSprite) {
        child.visible = false;
      }
    });
    this.hiddenHud = [
      'health-bar', 'ammo', 'weapon-name', 'squad-line', 'score-line', 'crosshair',
    ].map(id => [document.getElementById(id), document.getElementById(id)?.style.display || '']);
    for (const [element] of this.hiddenHud) if (element) element.style.display = 'none';
    camera.fov = 78;
    camera.updateProjectionMatrix();
    this.canvas = document.getElementById('game-canvas');
    this.savedCanvasFilter = this.canvas?.style.filter || '';
    if (this.canvas) {
      this.canvas.style.filter = 'grayscale(1) saturate(0) contrast(1.17) brightness(.84)';
    }

    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.next = new THREE.Vector3();
    this.move = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.targetMeshes = [];
    this.targetModels = [];
    this.routeModels = [];
    this.thermalSignatures = [];
    for (const target of this.targets) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(
          this.mode === 'strike' ? 1.3 : 0.7,
          this.mode === 'strike' ? 1.55 : 0.9,
          32),
        new THREE.MeshBasicMaterial({
          color: this.mode === 'strike' ? 0xff8a65 : 0x63e6ff,
          transparent: true,
          opacity: 0.58,
          depthTest: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(target.pos);
      ring.position.y += 0.06;
      scene.add(ring);
      this.targetMeshes.push(ring);
      if (this.mode === 'strike') {
        const model = strikeTargetModel(target);
        scene.add(model);
        this.targetModels.push(model);
      } else {
        this.targetModels.push(null);
      }
    }
    if (this.mode === 'combat') {
      for (const actor of this.combatants) {
        const signature = thermalSignature(actor);
        scene.add(signature);
        this.thermalSignatures.push(signature);
      }
      for (const vehicle of this.combatVehicles) {
        const signature = thermalSignature(vehicle, true);
        scene.add(signature);
        this.thermalSignatures.push(signature);
      }
    }

    this.overlay = document.createElement('div');
    this.overlay.innerHTML = `
      <div class="drone-video-filter"></div>
      <div class="drone-optic-mask"></div>
      <div class="drone-frame"></div>
      <div class="drone-reticle"><i></i><b></b></div>
      <div class="drone-lock"></div>
      <div class="drone-result"></div>
      <div class="drone-label">VEKTOR ISR // ${definition.label || 'TACTICAL UAS'}</div>
      <div class="drone-status"></div>
      <div class="drone-help">${this.mode === 'combat'
    ? 'WASD FLIGHT · MOUSE/ARROWS LOOK · RMB/Z CLIMB · CTRL/C DESCEND · FIRE RIFLE · G GRENADE'
    : this.mode === 'strike'
      ? 'WASD FLIGHT · MOUSE/ARROWS LOOK · RMB/Z CLIMB · CTRL/C DESCEND · FIRE RELEASE'
      : 'WASD FLIGHT · MOUSE/ARROWS LOOK · RMB/Z CLIMB · CTRL/C DESCEND · FIRE MARK'}</div>
    `;
    Object.assign(this.overlay.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 40,
      color: '#a7f3ff', font: '11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace',
      textShadow: '0 1px 4px #000',
      background: 'repeating-linear-gradient(0deg,rgba(210,235,225,.022) 0,rgba(210,235,225,.022) 1px,transparent 1px,transparent 4px)',
    });
    const style = document.createElement('style');
    style.textContent = `
      .drone-video-filter{position:absolute;inset:0;background:rgba(20,30,27,.1);mix-blend-mode:multiply}
      .drone-optic-mask{position:absolute;inset:0;background:radial-gradient(ellipse 67% 80% at 50% 49%,transparent 0 54%,rgba(2,5,5,.24) 68%,rgba(1,3,3,.88) 87%,#010202 100%);box-shadow:inset 0 0 90px rgba(0,0,0,.82)}
      .drone-frame{position:absolute;inset:6.5% 8%;border:1px solid rgba(177,224,215,.28);border-radius:13%/18%}
      .drone-reticle{position:absolute;left:50%;top:50%;width:56px;height:56px;transform:translate(-50%,-50%);border:1px solid rgba(160,245,255,.7);border-radius:50%}
      .drone-reticle i,.drone-reticle b{position:absolute;display:block;background:#baf8ff}
      .drone-reticle i{width:76px;height:1px;left:-10px;top:27px}
      .drone-reticle b{height:76px;width:1px;top:-10px;left:27px}
      .drone-lock{position:absolute;left:50%;top:calc(50% + 48px);transform:translateX(-50%);height:16px;letter-spacing:2px;color:#ffb28e}
      .drone-result{position:absolute;left:50%;top:26%;transform:translateX(-50%);padding:9px 14px;border:1px solid rgba(120,235,255,.5);background:rgba(5,14,20,.78);letter-spacing:2px;opacity:0;transition:opacity .18s}
      .drone-label{position:absolute;left:10%;top:8%;letter-spacing:2px}
      .drone-status{position:absolute;right:10%;top:8%;text-align:right;white-space:pre}
      .drone-help{position:absolute;left:50%;bottom:8%;transform:translateX(-50%);letter-spacing:1px;white-space:nowrap}
    `;
    this.overlay.appendChild(style);
    document.body.appendChild(this.overlay);
    this.status = this.overlay.querySelector('.drone-status');
    this.lock = this.overlay.querySelector('.drone-lock');
    this.result = this.overlay.querySelector('.drone-result');
  }

  markReconTarget(target) {
    if (!target || target.marked || this.mode === 'strike') return false;
    target.marked = true;
    this.targetMeshes[target.index].visible = false;
    const route = reconRouteModel(target);
    this.scene.add(route);
    this.routeModels.push(route);
    this.result.textContent = `ROUTE ${target.index + 1} CONFIRMED // ${target.label || 'ASSAULT AXIS'}`;
    this.result.style.opacity = '1';
    clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => {
      if (!this.complete) this.result.style.opacity = '0';
    }, 900);
    return true;
  }

  update(dt, input, solids) {
    if (!this.active) return;
    this.yaw -= input.lookDelta.x * 0.72;
    this.pitch = Math.max(-1.15, Math.min(0.72, this.pitch - input.lookDelta.y * 0.62));
    this.roll += ((-input.move.x * 0.42) - this.roll) * Math.min(1, dt * 6);

    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const thrust = -input.move.y;
    this.vel.addScaledVector(this.forward, thrust * 19 * dt);
    this.vel.addScaledVector(this.right, input.move.x * 11 * dt);
    if (input.ads) this.vel.y += 10 * dt;
    if (input.crouch) this.vel.y -= 9 * dt;
    const damping = Math.exp(-1.45 * dt);
    this.vel.multiplyScalar(damping);
    if (this.vel.length() > MAX_SPEED) this.vel.setLength(MAX_SPEED);

    this.next.copy(this.pos).addScaledVector(this.vel, dt);
    this.move.copy(this.next).sub(this.pos);
    const distance = this.move.length();
    if (distance > 0.001) {
      this.move.multiplyScalar(1 / distance);
      const hit = raycastSolids(
        solids, this.pos.x, this.pos.y, this.pos.z,
        this.move.x, this.move.y, this.move.z, distance + 0.16);
      if (hit > distance) this.pos.copy(this.next);
      else this.vel.multiplyScalar(-0.18);
    }
    const ground = groundHeight(solids, this.pos.x, this.pos.z, 0.12, this.pos.y + 1);
    this.pos.y = Math.max((ground === -Infinity ? 0 : ground) + 0.65, Math.min(34, this.pos.y));

    const fromLaunch = this.pos.distanceTo(this.launch);
    this.signal = Math.max(0, Math.min(1, 1 - fromLaunch / MAX_RANGE));
    this.battery = Math.max(0, this.battery - dt * (0.72 + this.vel.length() / MAX_SPEED * 0.42));
    if (this.signal <= 0.02 || this.battery <= 0) this.resetAircraft();

    this.camera.position.copy(this.pos);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, this.roll);

    this.updateThermalSignatures();
    for (const model of this.targetModels) model?.userData.update?.(dt);
    this.updateMunitions(dt, solids);
    this.updateEffects(dt);

    if (this.mode === 'combat') {
      this.rifleCooldown = Math.max(0, this.rifleCooldown - dt);
      if (input.fire && this.rifleRounds > 0 && this.rifleCooldown <= 0) {
        this.fireRifle(solids);
        this.rifleCooldown = 0.095;
      }
      if (input.nadePressed && this.grenadeRounds > 0) this.launchGrenade();
      const live = this.combatants.filter(actor => !actor.dead && !actor.surrendered);
      const liveVehicles = this.combatVehicles.filter(vehicle => !vehicle.dead);
      const liveCount = live.length + liveVehicles.length;
      const nearest = [...live, ...liveVehicles].sort((a, b) =>
        a.pos.distanceToSquared(this.pos) - b.pos.distanceToSquared(this.pos))[0];
      const track = nearest ? (() => {
        const bearing = (Math.atan2(
          nearest.pos.x - this.pos.x,
          nearest.pos.z - this.pos.z,
        ) * 180 / Math.PI + 360) % 360;
        return `THERM ${Math.round(bearing).toString().padStart(3, '0')}°`
          + ` ${Math.round(nearest.pos.distanceTo(this.pos))}m`;
      })() : 'THERM CLEAR';
      this.lock.textContent = liveCount
        ? 'RIFLE HOT // G LAUNCHES FRAG' : 'ASSAULT ELEMENT DESTROYED';
      this.status.textContent = [
        `LINK ${Math.round(this.signal * 100)}%`,
        `BAT ${Math.round(this.battery)}%`,
        `RIFLE ${this.rifleRounds}/100`,
        `FRAG ${this.grenadeRounds}/10`,
        `HOSTILES ${liveCount}/${this.combatants.length + this.combatVehicles.length}`,
        ...(liveCount <= 3 ? [track] : []),
      ].join('\n');
      this.overlay.style.opacity = String(0.72 + this.signal * 0.28);
      if (!liveCount && (this.combatants.length || this.combatVehicles.length) && !this.complete) {
        this.complete = true;
        this.status.textContent += '\nSTREET SECURE';
        this.result.textContent = this.resultText;
        this.result.style.opacity = '1';
        this.completionTimer = setTimeout(() => this.onComplete?.(), 850);
      }
      return;
    }

    let candidate = null;
    let bestDot = this.mode === 'strike' ? 0.984 : 0.965;
    for (const target of this.targets) {
      const ring = this.targetMeshes[target.index];
      ring.visible = !target.marked;
      ring.rotation.z += dt * 0.45;
      if (target.marked || target.engaged) continue;
      this.to.copy(target.pos);
      if (this.mode === 'strike') this.to.y += 0.8;
      this.to.sub(this.pos);
      const range = this.to.length();
      if (range > (this.mode === 'strike' ? 78 : 58)) continue;
      this.to.multiplyScalar(1 / range);
      const dot = this.forward.dot(this.to);
      if (dot <= bestDot) continue;
      if (!hasLOS(solids, this.pos.x, this.pos.y, this.pos.z,
        target.pos.x, target.pos.y + 0.5, target.pos.z)) continue;
      bestDot = dot;
      candidate = target;
    }
    if (candidate && input.firePressed) {
      if (this.mode === 'strike') this.releaseMunition(candidate);
      else this.markReconTarget(candidate);
    }
    this.lock.textContent = candidate
      ? this.mode === 'strike'
        ? `LOCK // ${candidate.label || `TARGET ${candidate.index + 1}`}`
        : `MARK // ${candidate.label || `ROUTE ${candidate.index + 1}`}`
      : '';
    let marked = 0;
    for (const target of this.targets) if (target.marked) marked++;
    this.status.textContent = [
      `LINK ${Math.round(this.signal * 100)}%`,
      `BAT ${Math.round(this.battery)}%`,
      `${this.mode === 'strike' ? 'TARGETS' : 'GRID'} ${marked}/${this.targets.length}`,
    ].join('\n');
    this.overlay.style.opacity = String(0.72 + this.signal * 0.28);
    if (marked === this.targets.length && !this.complete) {
      this.complete = true;
      this.status.textContent += this.mode === 'strike' ? '\nSTRIKE COMPLETE' : '\nUPLOAD COMPLETE';
      if (this.mode !== 'strike') {
        this.result.textContent = this.resultText;
        this.result.style.opacity = '1';
      }
      this.completionTimer = setTimeout(() => this.onComplete?.(), 650);
    }
  }

  updateThermalSignatures() {
    for (const signature of this.thermalSignatures) {
      const target = signature.userData.target;
      signature.visible = !!target && !target.dead && !target.surrendered;
      if (!signature.visible) continue;
      signature.position.copy(target.pos);
      if (signature.userData.vehicle) signature.rotation.y = target.mesh?.rotation.y || 0;
    }
  }

  fireRifle(solids) {
    if (this.mode !== 'combat' || this.rifleRounds <= 0) return false;
    this.rifleRounds--;
    this.shotsFired++;
    const direction = this.forward.clone();
    // A deterministic vibration pattern makes the jury-rigged mount feel mechanical without
    // disconnecting the centre reticle from the projectile. At normal engagement ranges the
    // displacement is only a few centimetres.
    const wobble = this.shotsFired * 2.399963;
    direction.addScaledVector(this.right, Math.sin(wobble) * 0.0013);
    direction.y += Math.cos(wobble * 0.73) * 0.0011;
    direction.normalize();
    const origin = this.pos.clone().addScaledVector(direction, 0.62);
    const maxRange = 110;
    const wallDistance = raycastSolids(
      solids, origin.x, origin.y, origin.z,
      direction.x, direction.y, direction.z, maxRange);
    let hit = null;
    let hitDistance = wallDistance;
    let headshot = false;
    let vehicleHit = false;
    for (const actor of this.combatants) {
      if (actor.dead || actor.surrendered || actor.exposed === false) continue;
      const headDistance = raySphere(
        origin.x, origin.y, origin.z,
        direction.x, direction.y, direction.z,
        actor.pos.x, actor.pos.y + 1.64, actor.pos.z, 0.22);
      const bodyDistance = rayVerticalCapsule(
        origin.x, origin.y, origin.z,
        direction.x, direction.y, direction.z,
        actor.pos.x, actor.pos.y + 0.68, actor.pos.y + 1.4, actor.pos.z, 0.28);
      const distance = Math.min(headDistance, bodyDistance);
      if (distance >= hitDistance) continue;
      hit = actor;
      hitDistance = distance;
      headshot = headDistance <= bodyDistance;
    }
    for (const vehicle of this.combatVehicles) {
      if (vehicle.dead) continue;
      const distance = raySphere(
        origin.x, origin.y, origin.z,
        direction.x, direction.y, direction.z,
        vehicle.pos.x, vehicle.pos.y + 1.05, vehicle.pos.z, 1.45);
      if (distance >= hitDistance) continue;
      hit = vehicle;
      hitDistance = distance;
      headshot = false;
      vehicleHit = true;
    }
    for (const signature of this.thermalSignatures) {
      this.scene.remove(signature);
      disposeObject(signature);
    }
    const endDistance = Math.min(maxRange, hitDistance);
    const end = origin.clone().addScaledVector(direction, endDistance);
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const tracer = new THREE.Line(geometry, DRONE_TRACER_MAT);
    tracer.name = 'drone-rifle-tracer';
    this.scene.add(tracer);
    this.effects.push({
      type: 'tracer', root: tracer, life: 0.075, age: 0,
    });
    this.onCombatShot?.(origin, end, hit);
    if (hit && vehicleHit) this.onCombatVehicleHit?.(hit, 8);
    else if (hit) this.onCombatHit?.(hit, headshot ? 99999 : 42, headshot);
    return true;
  }

  launchGrenade() {
    if (this.mode !== 'combat' || this.grenadeRounds <= 0) return false;
    this.grenadeRounds--;
    const mesh = new THREE.Mesh(DRONE_MUNITION_GEO, DRONE_MUNITION_MAT);
    mesh.name = 'drone-launched-grenade';
    mesh.position.copy(this.pos).addScaledVector(this.forward, 0.72);
    const velocity = this.forward.clone().multiplyScalar(20);
    velocity.y += 2.8;
    this.scene.add(mesh);
    this.munitions.push({
      type: 'grenade', mesh, velocity, fuse: 3.1,
    });
    return true;
  }

  releaseMunition(target) {
    if (!target || target.marked || target.engaged || this.mode !== 'strike') return false;
    target.engaged = true;
    const mesh = new THREE.Mesh(
      DRONE_MUNITION_GEO,
      DRONE_MUNITION_MAT,
    );
    mesh.name = 'drone-guided-munition';
    mesh.position.copy(this.pos).addScaledVector(this.forward, 0.65);
    const destination = target.pos.clone().add(new THREE.Vector3(0, 0.65, 0));
    const direction = destination.sub(mesh.position);
    const distance = direction.length();
    const speed = 42;
    direction.multiplyScalar(speed / Math.max(0.001, distance));
    this.scene.add(mesh);
    this.munitions.push({
      type: 'guided', mesh, velocity: direction, remaining: distance, target,
    });
    return true;
  }

  updateMunitions(dt, solids) {
    for (let i = this.munitions.length - 1; i >= 0; i--) {
      const munition = this.munitions[i];
      if (munition.type === 'grenade') {
        munition.fuse -= dt;
        munition.velocity.y -= 9.8 * dt;
        const speed = munition.velocity.length();
        const travel = speed * dt;
        const direction = munition.velocity.clone().multiplyScalar(1 / Math.max(0.001, speed));
        const hitDistance = raycastSolids(
          solids,
          munition.mesh.position.x, munition.mesh.position.y, munition.mesh.position.z,
          direction.x, direction.y, direction.z, travel + 0.08);
        munition.mesh.position.addScaledVector(munition.velocity, dt);
        munition.mesh.rotation.x += dt * 10;
        munition.mesh.rotation.z += dt * 7;
        const ground = groundHeight(
          solids, munition.mesh.position.x, munition.mesh.position.z,
          0.08, munition.mesh.position.y + 0.35);
        const impact = hitDistance <= travel + 0.04
          || (ground !== -Infinity && munition.mesh.position.y <= ground + 0.11)
          || munition.fuse <= 0;
        if (!impact) continue;
        const position = munition.mesh.position.clone();
        if (ground !== -Infinity) position.y = Math.max(position.y, ground + 0.08);
        this.scene.remove(munition.mesh);
        disposeObject(munition.mesh);
        this.munitions.splice(i, 1);
        this.combatImpact(position);
        continue;
      }
      const travel = munition.velocity.length() * dt;
      munition.mesh.position.addScaledVector(munition.velocity, dt);
      munition.remaining -= travel;
      if (munition.remaining > 0) continue;
      this.scene.remove(munition.mesh);
      disposeObject(munition.mesh);
      this.munitions.splice(i, 1);
      this.strikeImpact(munition.target);
    }
  }

  strikeImpact(target) {
    target.engaged = false;
    target.marked = true;
    this.targetMeshes[target.index].visible = false;
    this.targetModels[target.index]?.userData.markDestroyed?.();
    this.createImpactEffect(
      target.pos.clone().add(new THREE.Vector3(0, 0.65, 0)),
      target.index,
    );
  }

  combatImpact(position) {
    this.onCombatBlast?.(position.clone(), 7, 185);
    this.createImpactEffect(position, this.shotsFired + this.grenadeRounds);
  }

  createImpactEffect(position, seed = 0) {
    const root = new THREE.Group();
    root.name = 'drone-strike-impact';
    root.position.copy(position);
    const flash = new THREE.Mesh(
      DRONE_FLASH_GEO,
      new THREE.MeshBasicMaterial({
        color: 0xffd08a, transparent: true, opacity: 1,
        name: 'drone-strike-flash',
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    root.add(flash);
    const smoke = new THREE.Mesh(
      DRONE_SMOKE_GEO,
      new THREE.MeshStandardMaterial({
        color: 0x171a18, roughness: 1, metalness: 0,
        name: 'drone-strike-smoke',
        transparent: true, opacity: 0.62, depthWrite: false,
      }),
    );
    smoke.scale.set(0.55, 0.38, 0.55);
    root.add(smoke);
    const shockwave = new THREE.Mesh(
      DRONE_SHOCKWAVE_GEO,
      new THREE.MeshBasicMaterial({
        color: 0xff9d52, transparent: true, opacity: 0.82,
        name: 'drone-strike-shockwave',
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      }),
    );
    shockwave.rotation.x = -Math.PI / 2;
    shockwave.position.y = -0.5;
    root.add(shockwave);
    const fragments = [];
    for (let i = 0; i < 9; i++) {
      const fragment = new THREE.Mesh(
        DRONE_FRAGMENT_GEO,
        i % 3 ? DRONE_FRAGMENT_HOT_MAT : DRONE_FRAGMENT_DARK_MAT,
      );
      root.add(fragment);
      const angle = i * 2.399963 + seed * 0.71;
      fragments.push({
        mesh: fragment,
        velocity: new THREE.Vector3(
          Math.cos(angle) * (2.4 + i * 0.16),
          2.1 + (i % 4) * 0.72,
          Math.sin(angle) * (2.4 + i * 0.16)),
      });
    }
    this.scene.add(root);
    this.effects.push({
      root, flash, smoke, shockwave, fragments, life: 1.35, age: 0,
    });
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.age += dt;
      if (effect.type === 'tracer') {
        if (effect.age < effect.life) continue;
        this.scene.remove(effect.root);
        disposeObject(effect.root);
        this.effects.splice(i, 1);
        continue;
      }
      const t = Math.min(1, effect.age / effect.life);
      effect.flash.scale.setScalar(1 + t * 6.8);
      effect.flash.material.opacity = Math.max(0, 1 - t * 1.6);
      effect.smoke.scale.set(0.55 + t * 2.8, 0.38 + t * 3.5, 0.55 + t * 2.8);
      effect.smoke.position.y = t * 1.7;
      effect.smoke.material.opacity = 0.62 * Math.max(0, 1 - t);
      effect.shockwave.scale.setScalar(1 + t * 8.5);
      effect.shockwave.material.opacity = 0.82 * (1 - t) ** 2;
      for (const fragment of effect.fragments) {
        fragment.velocity.y -= 7.5 * dt;
        fragment.mesh.position.addScaledVector(fragment.velocity, dt);
        fragment.mesh.rotation.x += dt * 7;
        fragment.mesh.rotation.z += dt * 5;
      }
      if (effect.age < effect.life) continue;
      this.scene.remove(effect.root);
      disposeObject(effect.root);
      this.effects.splice(i, 1);
    }
  }

  resetAircraft() {
    this.pos.copy(this.launch);
    this.pos.y += 1.7;
    this.vel.set(0, 0, 0);
    this.battery = Math.max(42, this.battery);
    this.signal = 1;
  }

  dispose() {
    this.active = false;
    if (this.completionTimer) clearTimeout(this.completionTimer);
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.camera.fov = this.savedFov;
    this.camera.updateProjectionMatrix();
    if (this.canvas) this.canvas.style.filter = this.savedCanvasFilter;
    for (const [child, visible] of this.childVisibility) child.visible = visible;
    for (const [element, display] of this.hiddenHud) if (element) element.style.display = display;
    for (const mesh of this.targetMeshes) {
      this.scene.remove(mesh);
      disposeObject(mesh);
    }
    for (const route of this.routeModels) {
      if (this.persistIntel && this.complete) {
        const intel = this.scene.userData.reconIntel || [];
        if (!intel.includes(route)) intel.push(route);
        this.scene.userData.reconIntel = intel;
        continue;
      }
      this.scene.remove(route);
      disposeObject(route);
    }
    for (let index = 0; index < this.targetModels.length; index++) {
      const model = this.targetModels[index];
      if (!model) continue;
      if (this.persistWrecks && this.targets[index].marked) {
        const wrecks = this.scene.userData.droneWrecks || [];
        if (!wrecks.includes(model)) wrecks.push(model);
        this.scene.userData.droneWrecks = wrecks;
        continue;
      }
      this.scene.remove(model);
      disposeObject(model);
    }
    for (const munition of this.munitions) {
      this.scene.remove(munition.mesh);
      disposeObject(munition.mesh);
    }
    for (const effect of this.effects) {
      this.scene.remove(effect.root);
      disposeObject(effect.root);
    }
    for (const vehicle of this.combatVehicles) {
      this.scene.remove(vehicle.mesh);
      vehicle.mesh.userData.dispose?.();
    }
    this.munitions.length = 0;
    this.effects.length = 0;
    this.overlay.remove();
  }
}
