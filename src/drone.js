import * as THREE from 'three';
import {
  groundHeight, hasLOS, raycastSolids, raySphere, rayVerticalCapsule,
} from './physics.js';
import {
  militaryVehicleModel, militaryVehicleNameForLabel,
} from './military-vehicles.js';
import {
  animateAuthoredCharacter, createAuthoredCharacter, kneelAuthoredCharacter,
  stopAuthoredCharacter,
} from './character-assets.js';
import { activeFlightMode, controls, sticks } from './sticks.js';

const MAX_RANGE = 95;
const MAX_SPEED = 16;
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const DEG = Math.PI / 180;
// Scratch objects for the stick flight model (one aircraft flies at a time).
const STICK_EULER = new THREE.Euler(0, 0, 0, 'YXZ');
const STICK_RATES = new THREE.Vector3();
const STICK_AXIS = new THREE.Vector3();
const STICK_DELTA = new THREE.Quaternion();
const STICK_TARGET = new THREE.Quaternion();
const STICK_CAMERA = new THREE.Quaternion();
const STICK_UP = new THREE.Vector3();
const STICK_VEL = new THREE.Vector3();
const STICK_ACCEL = new THREE.Vector3();
const STICK_BODY_FWD = new THREE.Vector3();
const LOCK_AIM = new THREE.Vector3();
const LOCK_DIR = new THREE.Vector3();

function makeNetBox(cx, cy, cz, w, h, d) {
  return {
    min: { x: cx - w / 2, y: cy - h / 2, z: cz - d / 2 },
    max: { x: cx + w / 2, y: cy + h / 2, z: cz + d / 2 },
  };
}

// Knotted netting: a diamond mesh painted once and shared by every net in a mission.
let NET_TEXTURE = null;
function netTexture() {
  if (NET_TEXTURE) return NET_TEXTURE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  for (let i = -128; i <= 256; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 128, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 128); ctx.lineTo(i + 128, 0); ctx.stroke();
  }
  NET_TEXTURE = new THREE.CanvasTexture(canvas);
  NET_TEXTURE.wrapS = NET_TEXTURE.wrapT = THREE.RepeatWrapping;
  NET_TEXTURE.repeat.set(3, 3);
  return NET_TEXTURE;
}
const FPV_ATTEMPT = Object.freeze({
  READY: 'ready',
  FLYING: 'flying',
  IMPACT_HOLD: 'impact_hold',
  REPLAY: 'replay',
  DEBRIEF: 'debrief',
});
const TELEMETRY_INTERVAL = 0.1;

// Heightfield sampler for terrain levels, set by main on level start (null elsewhere).
// Everything airborne reads it: flight floor, vehicle ground-follow, munition impact,
// and jammer line-of-sight. Sampling the grid replaces raycasting a mesh.
let droneTerrain = null;
export function setDroneTerrain(sampler) { droneTerrain = sampler; }
export function droneTerrainHeight(x, z) { return droneTerrain ? droneTerrain(x, z) : 0; }
// Canopy and hedge AABBs, set by main on level start. Deliberately NOT part of `solids`:
// gunfire passes through foliage, but an airframe cannot — a recon drone bounces off a
// treeline and an armed FPV that clips one detonates in it, exactly like the real thing.
let droneFoliage = [];
export function setDroneFoliage(boxes) { droneFoliage = boxes || []; }
const THERMAL_BURST_SECONDS = 3;
const THERMAL_RECHARGE_SECONDS = 5;
const DRONE_MUNITION_GEO = new THREE.SphereGeometry(0.12, 10, 7);
const DRONE_FLASH_GEO = new THREE.SphereGeometry(1.05, 18, 12);
const DRONE_SMOKE_GEO = new THREE.SphereGeometry(1.25, 14, 10);
const DRONE_SHOCKWAVE_GEO = new THREE.RingGeometry(0.9, 1.15, 40);
const DRONE_FRAGMENT_GEO = new THREE.BoxGeometry(0.13, 0.13, 0.13);
const DRONE_HEAT_BODY_GEO = new THREE.CapsuleGeometry(0.23, 0.68, 4, 8);
const DRONE_HEAT_HEAD_GEO = new THREE.SphereGeometry(0.2, 10, 7);
const DRONE_HEAT_VEHICLE_GEO = new THREE.BoxGeometry(3.8, 1.45, 1.9);
const trackingRectangle = (width, height) => new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-width / 2, -height / 2, 0),
  new THREE.Vector3(width / 2, -height / 2, 0),
  new THREE.Vector3(width / 2, height / 2, 0),
  new THREE.Vector3(-width / 2, height / 2, 0),
]);
// Sensor/segmenter overlays live in image space. A 3D cuboid around a person projected as a
// tilted wire cage; one camera-facing rectangle reads as a tracking result instead.
const DRONE_TARGET_BOX_PERSON_GEO = trackingRectangle(0.62, 0.62);
const DRONE_TARGET_BOX_VEHICLE_GEO = trackingRectangle(0.92, 0.92);
const STRIKE_SQUIRTER_BODY_GEO = new THREE.CapsuleGeometry(0.24, 0.68, 4, 8);
const STRIKE_SQUIRTER_HEAD_GEO = new THREE.SphereGeometry(0.19, 10, 7);
const STRIKE_SQUIRTER_LEG_GEO = new THREE.CapsuleGeometry(0.09, 0.48, 3, 7);
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
  name: 'drone-rifle-tracer', color: 0xffc887,
  transparent: true, opacity: 0.54, depthWrite: false,
});

// Ground-fire lethality against a small FPV airframe, per aimed rifle shot. Anchored to
// the drone-war record: rifle fire almost never downs an FPV (which is why both sides
// issue shotguns for the last 30-50m), a quad presents ~0.05-0.1 m² of lethal
// cross-section moving 10-20 m/s with jink, and a stressed standing shooter's dispersion
// plus lead error dominates everything past pistol range. Tuned to Jay's spec from
// range experience (aircraft-mounted .50s burning dozens of boxes to hit two flares):
// the CEILING is 1-in-250 per round, point blank against a hovering aircraft, decaying
// from there. A crossing aircraft at full tilt is ~3x harder again. Any connecting
// round kills a quad outright — there is no such thing as a wounded FPV.
export function groundFireHitChance(distance, speedFraction = 0) {
  const base = 0.004 * Math.exp(-distance / 18);
  const speedFactor = 1 - 0.65 * Math.min(1, Math.max(0, speedFraction));
  return Math.min(0.004, base * speedFactor);
}
// Ground can't be shot through. `solids` carries the built world but the DEM itself is
// a heightfield, not AABBs, so every ground-fire line-of-sight check also walks the
// terrain sampler along the shot line: any ridge, gully lip or carve crest standing
// proud of the line masks the aircraft completely.
export function terrainBlocksLine(ax, ay, az, bx, by, bz) {
  if (!droneTerrain) return false;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const run = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.ceil(run / 2.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    // The first few metres are the shooter's own hole: a man in a trench shoulders
    // over his own lip, so his carve can't mask his own muzzle.
    if (run * t < 3.5) continue;
    if (droneTerrain(ax + dx * t, az + dz * t) > ay + dy * t - 0.1) return true;
  }
  return false;
}
const DRONE_HEAT_CORE_MAT = new THREE.MeshBasicMaterial({
  name: 'drone-thermal-core', color: 0xd8d4bb,
  transparent: true, opacity: 0.46, depthTest: true, depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const DRONE_HEAT_HALO_MAT = new THREE.MeshBasicMaterial({
  name: 'drone-thermal-halo', color: 0xaaa58f,
  transparent: true, opacity: 0.08, depthTest: true, depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const DRONE_TARGET_BOX_MAT = new THREE.LineBasicMaterial({
  name: 'drone-ai-target-box',
  color: 0x52ff79,
  transparent: true,
  opacity: 0.9,
  depthTest: true,
  depthWrite: false,
});
const STRIKE_SQUIRTER_UNIFORM_MAT = new THREE.MeshStandardMaterial({
  name: 'drone-strike-squirter-uniform', color: 0x394236, roughness: 0.92,
});
const STRIKE_SQUIRTER_SKIN_MAT = new THREE.MeshStandardMaterial({
  name: 'drone-strike-squirter-skin', color: 0x8d6f59, roughness: 0.9,
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
  DRONE_TARGET_BOX_PERSON_GEO,
  DRONE_TARGET_BOX_VEHICLE_GEO,
  STRIKE_SQUIRTER_BODY_GEO,
  STRIKE_SQUIRTER_HEAD_GEO,
  STRIKE_SQUIRTER_LEG_GEO,
]) {
  geometry.userData.bpPersistent = true;
}
for (const material of [
  DRONE_MUNITION_MAT, DRONE_FRAGMENT_HOT_MAT, DRONE_FRAGMENT_DARK_MAT,
  DRONE_TRACER_MAT,
  DRONE_HEAT_CORE_MAT, DRONE_HEAT_HALO_MAT,
  DRONE_TARGET_BOX_MAT,
  STRIKE_SQUIRTER_UNIFORM_MAT, STRIKE_SQUIRTER_SKIN_MAT,
]) {
  material.userData.bpPersistent = true;
}

// Articulated characters clone shared skeleton geometry and faction materials that live
// for the whole session (character-assets caches them across every level). Flag them so
// disposeObject never frees GPU resources still referenced by other soldiers.
function markCharacterShared(root) {
  root.traverse(part => {
    if (part.geometry) part.geometry.userData.bpPersistent = true;
    for (const material of [].concat(part.material || [])) {
      if (material) material.userData.bpPersistent = true;
    }
  });
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

function targetingBox(target, vehicle = false) {
  const line = new THREE.LineLoop(
    vehicle ? DRONE_TARGET_BOX_VEHICLE_GEO : DRONE_TARGET_BOX_PERSON_GEO,
    DRONE_TARGET_BOX_MAT,
  );
  line.name = vehicle ? 'drone-ai-box-vehicle' : 'drone-ai-box-combatant';
  line.userData.target = target;
  line.userData.vehicle = vehicle;
  line.renderOrder = 9;
  line.frustumCulled = false;
  return line;
}

function createStrikeSquirter(target, index) {
  const mesh = new THREE.Group();
  mesh.name = 'drone-strike-squirter';
  const body = new THREE.Mesh(STRIKE_SQUIRTER_BODY_GEO, STRIKE_SQUIRTER_UNIFORM_MAT);
  body.position.y = 0.94;
  mesh.add(body);
  const head = new THREE.Mesh(STRIKE_SQUIRTER_HEAD_GEO, STRIKE_SQUIRTER_SKIN_MAT);
  head.position.y = 1.62;
  mesh.add(head);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(STRIKE_SQUIRTER_LEG_GEO, STRIKE_SQUIRTER_UNIFORM_MAT);
    leg.position.set(side * 0.13, 0.37, 0);
    mesh.add(leg);
  }
  const lateral = target.index === 0 ? -1 : target.index === 2 ? 1 : (index % 2 ? 1 : -1);
  const pos = target.pos.clone().add(new THREE.Vector3(lateral * 1.35, 0, 1.2));
  // Break left/right first, then route around the north wall and back through its corner. The
  // gun crews are fleeing, not waiting in a firing gallery: once inside, they keep circulating
  // through the compound instead of becoming stationary targets in the service lane.
  const side = lateral;
  const edgeX = side * 31.4;
  const insideX = side * 27.8;
  const route = [
    [edgeX, -45.8], [edgeX, -41.25], [insideX, -41.25],
    [insideX, -34], [side * 18, -31], [side * 12, -25],
    [side * 18, -28], [insideX, -34],
  ].map(([x, z]) => new THREE.Vector3(x, 0.1, z));
  const direction = route[0].clone().sub(pos).setY(0).normalize();
  mesh.position.copy(pos);
  mesh.rotation.y = Math.atan2(direction.x, direction.z);
  return {
    pos,
    mesh,
    direction,
    speed: 3.15 + index * 0.28 + target.index * 0.13,
    health: 42,
    dead: false,
    surrendered: false,
    exposed: true,
    strikeSquirter: true,
    distance: 0,
    route,
    routeIndex: 0,
    routeLoopStart: 3,
    returned: false,
    fireTimer: 0.9 + index * 0.25 + target.index * 0.18,
  };
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

export function strikeTargetModel(target) {
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

  // Authored hull from the military pool when the desktop build carries one for this kind;
  // the procedural assembly remains the offline/mobile fallback. Rail and artillery targets
  // stay procedural (the crewed battery and the consist are their own set pieces). The seed
  // is position-derived so a mission replays with the same column every boot.
  // The authored technical is the UAZ-469, which ships with its own pintle recoilless.
  const authoredSlots = {
    tank: 'tank', turtle: 'tank', apc: 'apc', armor: 'apc', ew: 'gaz66', technical: 'uaz469',
    jeep: 'jeep', truck: 'truck', tanker: 'tanker',
  };
  let authored = null;
  if (authoredSlots[target.kind] && !target.procedural) {
    const seed = target.index ?? Math.abs(Math.round(
      (target.pos?.x ?? 0) * 7 + (target.pos?.z ?? 0) * 13));
    authored = militaryVehicleModel(
      militaryVehicleNameForLabel(target.label) || authoredSlots[target.kind], seed);
    if (authored) root.add(authored);
  }

  if (target.kind === 'technical' && authored) {
    // The authored UAZ-469 carries its own pintle recoilless; a Tigr variant (label-
    // forced) gets the procedural roof gun so the target still reads armed.
    if (authored.userData.variant === 'tigr') {
      const roof = (authored.userData.height || 2.2) - 0.2;
      add(new THREE.CylinderGeometry(0.1, 0.14, 0.5, 10), steel, [0.35, roof + 0.1, 0]);
      add(new THREE.BoxGeometry(0.46, 0.28, 0.3), dark, [0.35, roof + 0.42, 0]);
      add(new THREE.CylinderGeometry(0.055, 0.075, 1.75, 8), steel,
        [-0.45, roof + 0.45, 0], [0, 0, Math.PI / 2]);
    }
  } else if (target.kind === 'technical') {
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
    if (!authored) {
      add(new THREE.BoxGeometry(3.5, 0.72, 1.75), olive, [0, 0.78, 0]);
      add(new THREE.BoxGeometry(1.15, 1.08, 1.68), olive, [-1.05, 1.58, 0]);
      add(new THREE.BoxGeometry(0.86, 0.42, 1.7), glass, [-1.32, 1.75, 0]);
      for (const x of [-1.15, 1.1]) for (const z of [-0.92, 0.92]) {
        add(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 16), dark,
          [x, 0.48, z * 0.76], [Math.PI / 2, 0, 0]);
      }
      add(new THREE.BoxGeometry(1.2, 1.1, 1.45), dark, [0.85, 1.65, 0]);
    }
    // The jamming mast rides both hulls: on the authored GAZ-66 the van body is the
    // shelter, so only the antenna array marks the emitter.
    add(new THREE.CylinderGeometry(0.045, 0.065, 4.4, 8), steel, [0.75, 3.15, 0]);
    for (const y of [2.65, 3.65, 4.55]) {
      add(new THREE.BoxGeometry(1.5, 0.06, 0.06), steel, [0.75, y, 0]);
    }
  } else if (target.kind === 'artillery') {
    add(new THREE.BoxGeometry(3.8, 0.48, 1.65), olive, [0, 0.72, 0]);
    for (const x of [-1.22, 1.22]) for (const z of [-0.94, 0.94]) {
      add(new THREE.CylinderGeometry(0.44, 0.44, 0.28, 18), dark,
        [x, 0.48, z * 0.78], [Math.PI / 2, 0, 0]);
    }
    add(new THREE.CylinderGeometry(0.58, 0.7, 0.58, 14), olive, [0.15, 1.18, 0]);
    // Indirect fire, not a tank gun: elevate the tube over the compound. The local muzzle
    // points along -X; the authored battery yaw turns that axis south onto the target line.
    const elevation = target.elevation ?? 0.92;
    const barrelLength = 4.3;
    const breechX = 0.18, breechY = 1.45;
    const muzzleX = breechX - Math.cos(elevation) * barrelLength;
    const muzzleY = breechY + Math.sin(elevation) * barrelLength;
    add(new THREE.CylinderGeometry(0.12, 0.17, barrelLength, 12), steel,
      [(breechX + muzzleX) / 2, (breechY + muzzleY) / 2, 0],
      [0, 0, Math.PI / 2 - elevation]);
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
        [muzzleX, muzzleY, 0]);
      const smoke = add(
        new THREE.SphereGeometry(0.55, 10, 7), smokeMaterial,
        [muzzleX - Math.cos(elevation) * 0.2,
          muzzleY + Math.sin(elevation) * 0.2, 0]);
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
        smoke.position.set(
          muzzleX - Math.cos(elevation) * (0.2 + smokeAge * 0.65),
          muzzleY + Math.sin(elevation) * (0.2 + smokeAge * 0.65) + smokeAge * 0.35,
          0);
        smoke.scale.setScalar(0.7 + Math.max(0, smokeAge) * 1.5);
      };
    }
    root.userData.crew = crew;
  } else if (target.kind === 'tank' || target.kind === 'turtle') {
    // A main battle tank with a welded cope cage. The cage is the doctrine lesson made
    // visible from FPV distance: the roof is screened, so the drone has to come in on the
    // rear arc where the standoff frame is open and the engine deck is thin.
    if (!authored) {
      add(new THREE.BoxGeometry(4.6, 0.72, 2.55), olive, [0, 0.92, 0]);
      add(new THREE.BoxGeometry(3.4, 0.3, 2.4), olive, [-0.35, 1.35, 0], [0, 0, -0.03]);
      for (const z of [-1.22, 1.22]) {
        add(new THREE.BoxGeometry(4.4, 0.58, 0.42), dark, [0, 0.58, z]);
        for (const x of [-1.7, -0.85, 0, 0.85, 1.7]) {
          add(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 14), steel,
            [x, 0.56, z * 1.01], [Math.PI / 2, 0, 0]);
        }
      }
      add(new THREE.CylinderGeometry(0.95, 1.1, 0.55, 14), olive, [0.25, 1.72, 0]);
      add(new THREE.BoxGeometry(1.5, 0.45, 1.4), olive, [0.25, 2.0, 0]);
      add(new THREE.CylinderGeometry(0.1, 0.14, 3.9, 10), steel,
        [-2.05, 1.95, 0], [0, 0, Math.PI / 2]);
      // Rear engine deck: intake grilles, the aim point the mission teaches.
      add(new THREE.BoxGeometry(1.15, 0.16, 2.2), dark, [1.65, 1.34, 0]);
    }
    if (target.kind === 'turtle') {
      // "Turtle" tank: a welded shed of roofing steel over the whole hull and turret, skirts
      // nearly to the ground. Top and front are screened; the rear of the shed is open for the
      // engine deck and the running gear shows under the skirts: the two places to hit it.
      const sheet = new THREE.MeshStandardMaterial({
        name: 'drone-strike-turtle-sheet',
        color: 0x4a4d45, roughness: 0.86, metalness: 0.5,
      });
      root.userData.extraWreckMaterials = [sheet];
      add(new THREE.BoxGeometry(4.3, 0.08, 3.5), sheet, [-0.35, 3.05, 0], [0, 0, 0.05]);
      add(new THREE.BoxGeometry(4.3, 0.08, 1.95), sheet, [-0.35, 2.72, 1.55], [0.42, 0, 0.05]);
      add(new THREE.BoxGeometry(4.3, 0.08, 1.95), sheet, [-0.35, 2.72, -1.55], [-0.42, 0, 0.05]);
      for (const z of [-1.72, 1.72]) {
        add(new THREE.BoxGeometry(4.2, 1.45, 0.06), sheet, [-0.4, 1.75, z]);
      }
      add(new THREE.BoxGeometry(0.06, 2.1, 3.4), sheet, [-2.45, 1.95, 0]);
      for (const z of [-1.3, -0.4, 0.5, 1.3]) {
        add(new THREE.BoxGeometry(0.07, 1.7, 0.07), dark, [1.85, 2.15, z]);
      }
    } else {
    // The cope cage: four standoff posts and a slat roof over the turret, open at the rear.
    const cage = new THREE.MeshStandardMaterial({
      name: 'drone-strike-cage',
      color: 0x2b302a, roughness: 0.9, metalness: 0.55,
    });
    for (const [px, pz] of [[-0.8, -0.95], [-0.8, 0.95], [1.15, -0.95], [1.15, 0.95]]) {
      add(new THREE.BoxGeometry(0.08, 1.0, 0.08), cage, [px, 2.35, pz]);
    }
    for (const z of [-0.95, -0.55, -0.15, 0.25, 0.65]) {
      add(new THREE.BoxGeometry(2.35, 0.05, 0.14), cage, [0.18, 2.86, z + 0.15]);
    }
    add(new THREE.BoxGeometry(0.1, 0.5, 2.1), cage, [-0.85, 2.6, 0]);
    }
  } else if (target.kind === 'ugv') {
    // Logistics ground robot: a low tracked carrier with a strapped cargo load and a mast
    // radio. Both sides run hundreds of these a day through the kill zone, so they are a
    // priority target in their own right.
    add(new THREE.BoxGeometry(1.9, 0.42, 1.1), olive, [0, 0.42, 0]);
    for (const z of [-0.62, 0.62]) {
      add(new THREE.BoxGeometry(2.05, 0.38, 0.24), dark, [0, 0.27, z]);
      for (const x of [-0.75, 0, 0.75]) {
        add(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12), steel,
          [x, 0.27, z * 1.08], [Math.PI / 2, 0, 0]);
      }
    }
    add(new THREE.BoxGeometry(0.62, 0.42, 0.88), dark, [0.32, 0.85, 0]);
    add(new THREE.BoxGeometry(0.55, 0.36, 0.82), olive, [-0.42, 0.82, 0]);
    add(new THREE.CylinderGeometry(0.02, 0.025, 0.95, 6), steel, [0.82, 1.1, 0.35]);
  } else if (target.kind === 'parkedfpv') {
    // A hostile fibre FPV lying in wait by the road: a 10-inch frame on its belly, charge
    // slung underneath, camera up the verge. Tiny, cold-ish, and lethal to a passing column.
    add(new THREE.BoxGeometry(0.34, 0.09, 0.2), dark, [0, 0.12, 0]);
    add(new THREE.BoxGeometry(0.26, 0.12, 0.16), olive, [0.02, 0.05, 0]);
    for (const [x, z] of [[0.26, 0.26], [0.26, -0.26], [-0.26, 0.26], [-0.26, -0.26]]) {
      add(new THREE.BoxGeometry(0.42, 0.03, 0.05), dark, [x / 2, 0.13, z / 2], [0, Math.atan2(z, x), 0]);
      add(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 14), steel, [x, 0.16, z]);
    }
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.35, 8), olive, [0.1, 0.02, 0], [0, 0, Math.PI / 2]);
  } else if (target.kind === 'locomotive') {
    // Compact diesel road locomotive: long hood, raised cab, paired bogies and visible
    // couplers. Its proportions match the tank wagon so the two read as one consist from
    // bomber altitude instead of two unrelated boxes moving down the same line.
    add(new THREE.BoxGeometry(9.0, 0.32, 2.45), dark, [0, 1.04, 0]);
    for (const x of [-3.1, 3.1]) {
      for (const wx of [-0.62, 0.62]) for (const wz of [-0.76, 0.76]) {
        add(new THREE.CylinderGeometry(0.36, 0.36, 0.17, 12), steel,
          [x + wx, 0.56, wz], [Math.PI / 2, 0, 0]);
      }
    }
    add(new THREE.BoxGeometry(5.5, 1.45, 2.1), olive, [1.05, 1.82, 0]);
    add(new THREE.BoxGeometry(2.25, 2.25, 2.18), olive, [-2.55, 2.2, 0]);
    for (const z of [-1.1, 1.1]) {
      add(new THREE.BoxGeometry(1.2, 0.58, 0.08), glass, [-2.82, 2.55, z * 0.94]);
    }
    add(new THREE.BoxGeometry(0.72, 0.64, 0.08), glass, [-3.68, 2.55, 0]);
    add(new THREE.CylinderGeometry(0.16, 0.2, 1.2, 10), dark, [1.45, 3.05, 0]);
    add(new THREE.BoxGeometry(1.2, 0.14, 0.24), steel, [-5.0, 0.92, 0]);
    add(new THREE.BoxGeometry(1.2, 0.14, 0.24), steel, [5.0, 0.92, 0]);
  } else if (target.kind === 'fuelcar') {
    // A rail tank wagon: flat frame over bogies, a long horizontal tank, filler dome. Built
    // to read as strategic logistics from bomber altitude, and to burn convincingly.
    add(new THREE.BoxGeometry(9.2, 0.3, 2.4), dark, [0, 1.05, 0]);
    // Wheel pairs ride the two rails at the track gauge (see RAIL_GAUGE in terrain.js),
    // so the wagon overhangs its track the way rolling stock does.
    for (const x of [-3.4, 3.4]) {
      for (const wx of [-0.55, 0.55]) {
        for (const wz of [-0.75, 0.75]) {
          add(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 12), steel,
            [x + wx, 0.55, wz], [Math.PI / 2, 0, 0]);
        }
      }
    }
    add(new THREE.CylinderGeometry(1.15, 1.15, 8.4, 16), olive,
      [0, 2.35, 0], [0, 0, Math.PI / 2]);
    for (const x of [-4.2, 4.2]) {
      add(new THREE.CylinderGeometry(1.15, 1.15, 0.12, 16), steel,
        [x, 2.35, 0], [0, 0, Math.PI / 2]);
    }
    add(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 12), steel, [0, 3.6, 0]);
    add(new THREE.BoxGeometry(0.9, 0.1, 1.2), steel, [4.1, 1.28, 0]);
    add(new THREE.BoxGeometry(1.2, 0.14, 0.24), steel, [-5.0, 0.92, 0]);
    add(new THREE.BoxGeometry(1.2, 0.14, 0.24), steel, [5.0, 0.92, 0]);
  } else if (target.kind === 'infantry') {
    // A dismounted individual or fire team: 1-4 figures sharing one strike point. The
    // seed fixes poses and spacing so an authored picket replays identically.
    // `cover` parks a pre-charred hull beside them — men holding a burned-out vehicle.
    const seed = target.index ?? Math.abs(Math.round(
      (target.pos?.x ?? 0) * 7 + (target.pos?.z ?? 0) * 13));
    let roll = ((seed + 11) * 2654435761) >>> 0;
    const rand = () => ((roll = (roll * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    if (target.cover) {
      const wreck = strikeTargetModel({
        pos: new THREE.Vector3(...(target.cover.at || [2.9, 0, -0.6])),
        kind: target.cover.kind || 'apc',
        yaw: target.cover.yaw ?? 0.5,
        index: seed,
      });
      wreck.userData.markDestroyed();
      root.add(wreck);
    }
    const team = Math.max(1, Math.min(4, target.team ?? 3));
    const poses = ['stand', 'kneel', 'prone', 'stand'];
    const figures = [];
    const soldiers = [];
    // Authored figure spots override the default cluster: [dx, dz, facing] in the
    // target's local frame — how a trench garrison stands one man per fire bay.
    const authoredSpots = target.figures || null;
    const count = authoredSpots ? authoredSpots.length : team;
    const soloRunner = target.moving && !authoredSpots && count === 1;
    const rootYaw = target.yaw || 0;
    const cosYaw = Math.cos(rootYaw), sinYaw = Math.sin(rootYaw);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 1.1;
      const radius = 0.9 + rand() * 1.4;
      const scatterYaw = angle + Math.PI + (rand() - 0.5) * 0.8;
      const [px, pz, facing] = authoredSpots
        ? [authoredSpots[i][0], authoredSpots[i][1], authoredSpots[i][2] ?? scatterYaw]
        : soloRunner ? [0, 0, scatterYaw]
        : [Math.cos(angle) * radius, Math.sin(angle) * radius, scatterYaw];
      // Authored spots can sit metres from the root on carved ground; re-ground each
      // man on the terrain under his own feet instead of the team centre's height.
      let dyGround = 0;
      if (authoredSpots && droneTerrain && target.pos) {
        const wx = target.pos.x + px * cosYaw + pz * sinYaw;
        const wz = target.pos.z - px * sinYaw + pz * cosYaw;
        dyGround = droneTerrain(wx, wz) - target.pos.y;
      }
      const pose = target.moving ? 'stand' : poses[(seed + i) % poses.length];
      // The game's articulated hostile — same rig, olive field kit and carried rifle as
      // the ground levels — with the capsule figures kept as the offline/mobile fallback.
      // The rig has no prone clip, so prone slots kneel instead.
      const soldier = target.procedural ? null
        : createAuthoredCharacter({ friendly: false, variant: seed * 7 + i * 3 });
      if (soldier) {
        markCharacterShared(soldier);
        soldier.position.set(px, 0.02 + dyGround, pz);
        soldier.rotation.y = facing;
        soldier.userData.kneel = pose !== 'stand';
        animateAuthoredCharacter(soldier, false, 0,
          soldier.userData.kneel ? 'engage' : 'patrol', 0);
        if (soldier.userData.kneel) kneelAuthoredCharacter(soldier, 1);
        root.add(soldier);
        figures.push(soldier);
        soldiers.push(soldier);
        continue;
      }
      const figure = new THREE.Group();
      figure.position.set(px, 0.04 + dyGround, pz);
      figure.rotation.y = facing;
      const part = (geometry, y, z = 0, x = 0, rotation = null) => {
        const mesh = new THREE.Mesh(geometry, geometry.userData.skin ? crewSkin : crewUniform);
        mesh.position.set(x, y, z);
        if (rotation) mesh.rotation.set(...rotation);
        mesh.castShadow = true;
        figure.add(mesh);
        return mesh;
      };
      const headGeometry = new THREE.SphereGeometry(0.19, 10, 7);
      headGeometry.userData.skin = true;
      if (pose === 'prone') {
        // Lying along local +Z, head toward the facing line, rifle out past the head.
        figure.userData.prone = true;
        part(new THREE.CapsuleGeometry(0.21, 0.66, 4, 8), 0.24, 0.1, 0, [Math.PI / 2, 0, 0]);
        part(headGeometry, 0.3, 0.66);
        for (const side of [-1, 1]) {
          part(new THREE.CapsuleGeometry(0.08, 0.44, 3, 7), 0.16, -0.62, side * 0.13,
            [Math.PI / 2, 0, 0]);
        }
        part(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 6), 0.34, 0.85, 0.14,
          [Math.PI / 2, 0, 0]);
      } else {
        const kneeling = pose === 'kneel';
        const torsoY = kneeling ? 0.66 : 0.92;
        part(new THREE.CapsuleGeometry(0.23, kneeling ? 0.5 : 0.66, 4, 8), torsoY);
        part(headGeometry, kneeling ? 1.18 : 1.57);
        for (const side of [-1, 1]) {
          part(new THREE.CapsuleGeometry(0.09, kneeling ? 0.26 : 0.48, 3, 7),
            kneeling ? 0.22 : 0.37, 0, side * 0.13);
        }
        part(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 6),
          kneeling ? 0.92 : 1.18, 0.3, 0.08, [Math.PI / 2 - 0.18, 0, 0]);
      }
      root.add(figure);
      figures.push(figure);
    }
    root.userData.crew = figures;
    if (soldiers.length) {
      // Live men breathe and scan; killed men bake the ground game's death sprawl and
      // tip over through this same hook (createDroneAssaultVehicle ticks it per frame).
      let clock = rand() * 8;
      // `gait` lets a routed team WALK its line ('patrol') when nothing presses it and
      // sprint ('flee') when something does; a man moving on his own initiative (the
      // dugout dash) always sprints.
      root.userData.update = (dt, moving = false, gait = 'flee') => {
        clock += dt;
        for (const soldier of soldiers) {
          const fall = soldier.userData.fall;
          if (fall) {
            if (fall.t >= 1) continue;
            fall.t = Math.min(1, fall.t + dt / fall.duration);
            const ease = 1 - Math.pow(1 - fall.t, 3);
            soldier.rotation.x = fall.targetX * ease;
            soldier.rotation.z = fall.targetZ * ease;
            continue;
          }
          if (root.userData.destroyed) continue;
          // A man can be on the move on his own (running the trench for the dugout,
          // updateTrenchCover) while the rest of his team stands fast.
          const run = moving || soldier.userData.moving;
          animateAuthoredCharacter(soldier, run, 0,
            run ? (soldier.userData.moving ? 'flee' : gait)
              : soldier.userData.kneel ? 'engage' : 'patrol', clock);
          if (!run && soldier.userData.kneel) kneelAuthoredCharacter(soldier, 1);
        }
      };
      root.userData.setHiding = () => {
        for (const soldier of soldiers) soldier.userData.kneel = true;
      };
    }
  } else if (target.kind === 'mavic') {
    // A commercial-class recon quad. Slightly oversized against its real 0.4 m footprint
    // so it reads against sky at acquire range; the spinning discs are the tell a pilot
    // actually keys on. Nose is local -X like every other target hull. `highViz` paints
    // the shell range-target orange — a gunnery drill target has to be seen from the
    // perch, and looking DOWN at a gray quad over steppe is camouflage, not a drill.
    const gray = new THREE.MeshStandardMaterial({
      name: 'drone-strike-quad-gray',
      color: target.highViz ? 0xe06a24 : 0x9aa0a3,
      roughness: target.highViz ? 0.5 : 0.6, metalness: target.highViz ? 0.12 : 0.32,
    });
    add(new THREE.BoxGeometry(0.92, 0.3, 0.52), gray, [0, 0, 0]);
    add(new THREE.SphereGeometry(0.14, 10, 8), glass, [-0.5, -0.08, 0]);
    const rotors = [];
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      add(new THREE.BoxGeometry(0.6, 0.07, 0.09), gray,
        [x * 0.42, 0.06, z * 0.34], [0, x * z * 0.62, 0]);
      const rotor = add(new THREE.CylinderGeometry(0.42, 0.42, 0.025, 3), dark,
        [x * 0.66, 0.15, z * 0.55]);
      rotors.push(rotor);
    }
    root.userData.update = dt => {
      if (root.userData.destroyed) return;
      for (const [index, rotor] of rotors.entries()) {
        rotor.rotation.y += dt * (index % 2 ? 46 : -46);
      }
    };
    root.userData.extraWreckMaterials = [gray];
  } else if (target.kind === 'recon') {
    // An Orlan/ZALA-class fixed-wing: long straight wing, twin tail booms, tractor prop.
    // Sky gray so it hides against overcast the way the real article does.
    const skyGray = new THREE.MeshStandardMaterial({
      name: 'drone-strike-recon-gray', color: 0xaab3b8, roughness: 0.68, metalness: 0.18,
    });
    add(new THREE.BoxGeometry(2.5, 0.42, 0.44), skyGray, [0, 0, 0]);
    add(new THREE.SphereGeometry(0.2, 8, 6), skyGray, [-1.3, 0, 0]);
    add(new THREE.BoxGeometry(0.62, 0.06, 4.4), skyGray, [0.1, 0.24, 0]);
    for (const z of [-1, 1]) {
      add(new THREE.BoxGeometry(1.9, 0.07, 0.1), skyGray, [1.35, 0.22, z * 1.15]);
      add(new THREE.BoxGeometry(0.34, 0.6, 0.07), skyGray, [2.25, 0.42, z * 1.15]);
    }
    add(new THREE.BoxGeometry(0.34, 0.06, 2.44), skyGray, [2.25, 0.7, 0]);
    const prop = add(new THREE.BoxGeometry(0.04, 1.1, 0.1), dark, [-1.52, 0, 0]);
    root.userData.update = dt => {
      if (!root.userData.destroyed) prop.rotation.x += dt * 52;
    };
    root.userData.extraWreckMaterials = [skyGray];
  } else if (target.kind === 'shahed') {
    // A Shahed/Gerbera-class delta: cropped triangular wing, wingtip fins, pusher prop.
    // Charcoal — the night raider's paint.
    const charcoal = new THREE.MeshStandardMaterial({
      name: 'drone-strike-shahed-dark', color: 0x3a3f42, roughness: 0.76, metalness: 0.22,
    });
    add(new THREE.BoxGeometry(2.9, 0.34, 0.58), charcoal, [0, 0, 0]);
    add(new THREE.SphereGeometry(0.24, 8, 6), charcoal, [-1.5, 0, 0]);
    for (const z of [-1, 1]) {
      // Swept delta panel: a thin box yawed back from the nose toward the wingtip.
      add(new THREE.BoxGeometry(2.5, 0.07, 1.1), charcoal,
        [0.45, 0.05, z * 0.95], [0, z * 0.5, 0]);
      add(new THREE.BoxGeometry(0.5, 0.52, 0.07), charcoal, [1.32, 0.24, z * 1.62]);
    }
    const prop = add(new THREE.BoxGeometry(0.04, 1.0, 0.1), dark, [1.6, 0, 0]);
    root.userData.update = dt => {
      if (!root.userData.destroyed) prop.rotation.x += dt * 48;
    };
    root.userData.extraWreckMaterials = [charcoal];
  } else if (!authored) {
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
    for (const wreck of [olive, dark, steel, glass, crewUniform, crewSkin,
      ...(root.userData.extraWreckMaterials || [])]) {
      wreck.color.multiplyScalar(0.22);
      wreck.roughness = 0.98;
      wreck.metalness *= 0.5;
    }
    // Authored hulls carry per-instance material clones (military-vehicles.js), so the
    // same in-place char is safe for them too.
    authored?.traverse(object => {
      if (!object.isMesh) return;
      for (const material of [].concat(object.material)) {
        if (!material) continue;
        material.color?.multiplyScalar(0.22);
        if ('roughness' in material) material.roughness = 0.98;
        if ('metalness' in material) material.metalness *= 0.5;
      }
    });
    root.rotation.z = target.kind === 'ew' ? 0.05 : -0.035;
    for (const [index, soldier] of (root.userData.crew || []).entries()) {
      if (index < (target.squirters || 0)) {
        soldier.visible = false;
        continue;
      }
      if (soldier.userData.rig?.authored) {
        // The ground game's kill: bake the limb sprawl once, then let the per-frame
        // update ease the body over. Varied per man so a team doesn't fall in unison.
        stopAuthoredCharacter(soldier);
        const mode = index % 3;
        const side = index % 2 ? 1 : -1;
        soldier.userData.fall = {
          t: 0, duration: 0.48 + (index % 5) * 0.035,
          targetX: mode === 1 ? -0.3 : mode === 2 ? -1.24 : -1.49,
          targetZ: mode === 1 ? side * 1.45 : mode === 2 ? side * 0.42 : side * 0.12,
        };
        continue;
      }
      // A prone figure is already on the ground; sideways flop is for the standing poses.
      if (soldier.userData.prone) continue;
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
  // On a heightfield level the authored y is an offset above the sampled surface.
  pos.y += droneTerrain ? droneTerrain(pos.x, pos.z) : 0;
  const mesh = strikeTargetModel({
    pos, kind: definition.kind || 'technical', yaw: definition.yaw || 0,
    label: definition.label, team: definition.team, figures: definition.figures,
    cover: definition.cover, procedural: definition.procedural, highViz: definition.highViz,
    moving: definition.kind === 'infantry' && (definition.route?.length || 0) > 0,
  });
  mesh.name = 'drone-assault-technical';
  scene.add(mesh);
  mesh.position.copy(pos);
  const metersPerUnit = definition.metersPerUnit ?? 1;
  const authoredSpeed = definition.speed ?? 4.4;
  const worldSpeed = definition.speedPhysical === false ? authoredSpeed : authoredSpeed / metersPerUnit;
  const evasion = definition.kind === 'infantry' && definition.evasion ? {
    ...definition.evasion,
    triggerRadius: (definition.evasion.triggerRadius ?? 140) / metersPerUnit,
    activationRadius: definition.evasion.activationRadius !== undefined
      ? definition.evasion.activationRadius / metersPerUnit : null,
    decisionMin: definition.evasion.decisionMin ?? 0.45,
    decisionMax: definition.evasion.decisionMax ?? 0.9,
    // The war-footage close-range behavior, all authored in metres: inside freezeRadius
    // running is pointless and the man goes still; a hide pressed inside flushRadius is
    // blown and he breaks for the next cover; freezeRelease is the reopen hysteresis.
    freezeRadius: (definition.evasion.freezeRadius ?? 25) / metersPerUnit,
    freezeRelease: (definition.evasion.freezeRelease ?? 40) / metersPerUnit,
    flushRadius: (definition.evasion.flushRadius ?? 45) / metersPerUnit,
  } : definition.airborne && definition.evasion ? {
    // An aerial target's defence is geometry, not cover: weave off the track line and
    // trade speed for altitude when the interceptor closes. All authored in metres.
    triggerRadius: (definition.evasion.triggerRadius ?? 260) / metersPerUnit,
    jinkRadius: (definition.evasion.jinkRadius ?? 26) / metersPerUnit,
    jinkPeriod: definition.evasion.jinkPeriod ?? 2.8,
    climbRate: (definition.evasion.climbRate ?? 4.5) / metersPerUnit,
    climbMax: (definition.evasion.climbMax ?? 30) / metersPerUnit,
  } : null;
  const vehicle = {
    pos,
    mesh,
    kind: definition.kind || 'technical',
    // Men are soft: a fire team dies to any near miss a hull would shrug off.
    maxHealth: definition.health ?? (definition.kind === 'infantry' ? 90 : 190),
    health: definition.health ?? (definition.kind === 'infantry' ? 90 : 190),
    // FPV target attributes: `cage` arms the rear-aspect rule, `label` names the kill feed.
    cage: !!definition.cage,
    label: definition.label || null,
    targetId: definition.targetId || definition.label || null,
    hostile: definition.hostile !== false,
    decoy: !!definition.decoy,
    protected: !!definition.protected,
    optional: !!definition.optional,
    identified: !definition.requiresIdentification,
    requiresIdentification: !!definition.requiresIdentification,
    identifySeconds: definition.identifySeconds ?? 1.8,
    identifyProgress: 0,
    jammerId: definition.jammerId || null,
    reaction: definition.reaction || null,
    reacted: false,
    consistId: definition.consistId || null,
    stopsConsist: !!definition.stopsConsist,
    stopMessage: definition.stopMessage || null,
    shelter: definition.shelter || null,
    // Trench garrisons carry the dug slot as a local polyline into the dugout: the
    // route the crew runs when the aircraft presses the position (updateTrenchCover).
    bunker: definition.bunker || null,
    evasion,
    evasionTimer: 0.18,
    evasionDirection: 1,
    evasionDecisions: 0,
    activated: evasion?.activationRadius == null,
    hiding: false,
    // Runner (loop-route infantry) state: patrol direction when unpressed, the committed
    // cover node and travel direction when pressed, hold-in-cover, and the terminal freeze.
    threatened: false,
    freezeHold: false,
    coverCommit: null,
    coverDir: 1,
    coverHold: false,
    patrolDir: 1,
    coverNodes: null,
    // Optional instructor line delivered when this target dies (the flight-school voice).
    killMessage: definition.killMessage || null,
    // Timed traffic: a convoy due on the road, or our own run that must find it clear.
    startAt: definition.startDelay ?? 0,
    etaLabel: definition.etaLabel || null,
    // A hostile ambush drone strikes any protected (friendly) mover inside this radius.
    ambushRadius: definition.ambushRadius ? definition.ambushRadius / metersPerUnit : 0,
    // Heavy armour: a non-killing hit stops it where it is (the double-tap setup).
    immobilizeOnHit: !!definition.immobilizeOnHit,
    // An airborne target flies its route at authored AGL instead of taking the ground
    // snap; `exited` latches once it leaves the engagement box (the escape loss path).
    airborne: !!definition.airborne,
    exited: false,
    dead: false,
    route: (definition.route || []).map(point => ({
      x: point[0],
      y: point.length > 2 ? point[1] : 0,
      z: point.length > 2 ? point[2] : point[1],
    })),
    routeIdx: 0,
    loop: !!definition.loop,
    // The authored y offset is height-above-surface (a wagon's wheels on the railhead);
    // keep it while moving instead of letting the ground snap flatten it away.
    surfaceLift: definition.pos?.[1] ?? 0,
    speed: worldSpeed,
    baseSpeed: worldSpeed,
    velocity: new THREE.Vector3(),
    damage(amount) {
      if (this.dead) return false;
      this.health = Math.max(0, this.health - amount);
      if (this.health > 0) return false;
      this.dead = true;
      this.mesh.userData.markDestroyed?.();
      return true;
    },
    update(dt, solids, threatPos = null) {
      if (this.airborne) { this.updateAirborne(dt, threatPos); return; }
      if (!this.activated && threatPos && this.evasion?.activationRadius != null) {
        const threatDistance = Math.hypot(threatPos.x - this.pos.x, threatPos.z - this.pos.z);
        if (threatDistance <= this.evasion.activationRadius) this.activated = true;
      }
      // Loop-route infantry are the field runners: they get the cover-commit state
      // machine instead of the vehicle waypoint march.
      if (this.kind === 'infantry' && this.evasion && !this.evasion.oneWay
        && this.route.length > 1) {
        this.updateRunner(dt, solids, threatPos);
        return;
      }
      // The model's own animation hook follows target motion: routed infantry run instead
      // of sliding in an idle firing pose; parked teams still breathe and scan.
      const moving = !this.dead && this.activated && !this.hiding && this.route.length > 0;
      this.mesh.userData.update?.(dt, moving);
      if (this.dead || !this.activated || this.hiding || !this.route.length) {
        this.velocity.set(0, 0, 0);
        return;
      }
      const previousX = this.pos.x;
      const previousZ = this.pos.z;
      const waypoint = this.route[Math.min(this.routeIdx, this.route.length - 1)];
      const dx = waypoint.x - this.pos.x;
      const dz = waypoint.z - this.pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.7) {
        if (this.evasion) {
          if (this.evasion.settleAtEnd && this.evasionDirection > 0
            && this.routeIdx === this.route.length - 1) {
            this.hiding = true;
            this.velocity.set(0, 0, 0);
            this.mesh.userData.setHiding?.();
            this.mesh.userData.update?.(0, false);
            return;
          }
          this.routeIdx = (this.routeIdx + this.evasionDirection + this.route.length)
            % this.route.length;
          return;
        }
        if (this.routeIdx < this.route.length - 1) { this.routeIdx++; return; }
        // A patrol route loops; an ingress route parks at its last waypoint.
        if (this.loop) { this.routeIdx = 0; return; }
      }
      if (distance > 0.001) {
        const travel = Math.min(distance, this.speed * dt);
        this.pos.x += dx / distance * travel;
        this.pos.z += dz / distance * travel;
        this.mesh.rotation.y = Math.atan2(dz, -dx);
      }
      const ground = groundHeight(solids, this.pos.x, this.pos.z, 0.2, this.pos.y + 2);
      const terrainY = droneTerrain ? droneTerrain(this.pos.x, this.pos.z) : -Infinity;
      const surface = Math.max(ground, terrainY);
      if (surface !== -Infinity) this.pos.y = surface + this.surfaceLift;
      this.velocity.set(
        dt > 0 ? (this.pos.x - previousX) / dt : 0,
        0,
        dt > 0 ? (this.pos.z - previousZ) / dt : 0,
      );
      this.mesh.position.copy(this.pos);
      this.mesh.position.y += 0.02;
    },
    // ---- field runner ----------------------------------------------------------------
    // How dismounts move under drone attack in the war footage: walk the line until an
    // aircraft presses, sprint for cover AWAY from it, hold small under the canopy,
    // break for the next tree only when the hide is blown — and once the aircraft is
    // inside ~25 m (3D, so a high orbit doesn't pin the map) running is pointless: the
    // man stops and goes still. No route ping-pong, so a runner never looks boxed in.
    crewKneel(kneel) {
      for (const soldier of this.mesh?.userData.crew || []) {
        if (soldier.userData.fall) continue;
        if (kneel) {
          soldier.userData.kneel = true;
        } else if (soldier.userData.kneel) {
          soldier.userData.kneel = false;
          kneelAuthoredCharacter(soldier, 0);
        }
      }
    },
    routeCoverNodes() {
      if (this.coverNodes) return this.coverNodes;
      // A node is cover when a canopy AABB roofs it. Falls back to every node on a map
      // with no foliage data so the commit logic still has somewhere to run to.
      const margin = 0.8;
      const nodes = [];
      for (const [index, node] of this.route.entries()) {
        for (const box of droneFoliage) {
          if (node.x >= box.min.x - margin && node.x <= box.max.x + margin
            && node.z >= box.min.z - margin && node.z <= box.max.z + margin) {
            nodes.push(index);
            break;
          }
        }
      }
      this.coverNodes = nodes.length ? nodes : this.route.map((_, index) => index);
      return this.coverNodes;
    },
    commitToCover(threatPos, threatXZ) {
      // The NEAREST cover that (a) is not toward the aircraft and (b) sits far enough
      // out that the hold won't be flushed the moment he reaches it. On the first press
      // that is usually the canopy he is already under; on a flush his own tree fails
      // test (b) and the pick becomes the next tree down the line.
      const floor = Math.max(threatXZ - 1.5, this.evasion.flushRadius + 2);
      // How close the straight dash line to a node passes by the aircraft. A dash that
      // crosses the drone's shadow is a last resort, not a plan.
      const pathClearance = node => {
        const dx = node.x - this.pos.x;
        const dz = node.z - this.pos.z;
        const lengthSq = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1,
          ((threatPos.x - this.pos.x) * dx + (threatPos.z - this.pos.z) * dz) / lengthSq));
        return Math.hypot(
          threatPos.x - (this.pos.x + dx * t), threatPos.z - (this.pos.z + dz * t));
      };
      let best = null;
      let bestRun = Infinity;
      for (const clear of [true, false]) {
        for (const index of this.routeCoverNodes()) {
          const node = this.route[index];
          const nodeThreat = Math.hypot(node.x - threatPos.x, node.z - threatPos.z);
          if (nodeThreat < floor) continue;
          if (clear && pathClearance(node) < this.evasion.freezeRelease) continue;
          const run = Math.hypot(node.x - this.pos.x, node.z - this.pos.z);
          if (run < bestRun) { bestRun = run; best = index; }
        }
        if (best !== null) break;
      }
      if (best === null) {
        // Everything qualifies as "toward" (the aircraft owns the whole line): take
        // whatever cover lies farthest from it.
        let bestThreat = -Infinity;
        for (const index of this.routeCoverNodes()) {
          const node = this.route[index];
          const nodeThreat = Math.hypot(node.x - threatPos.x, node.z - threatPos.z);
          if (nodeThreat > bestThreat) { bestThreat = nodeThreat; best = index; }
        }
      }
      this.coverCommit = best ?? this.routeIdx;
      // Re-aim the very next stride: the old waypoint may sit toward the aircraft, and a
      // man who has just decided on cover does not finish a 50 m leg the wrong way first.
      let nearestIdx = this.routeIdx;
      let nearestDistance = Infinity;
      for (const [index, node] of this.route.entries()) {
        const nodeDistance = Math.hypot(node.x - this.pos.x, node.z - this.pos.z);
        if (nodeDistance < nearestDistance) {
          nearestDistance = nodeDistance;
          nearestIdx = index;
        }
      }
      this.routeIdx = nearestDistance < 0.7 && nearestIdx !== this.coverCommit
        ? nearestIdx + Math.sign(this.coverCommit - nearestIdx)
        : nearestIdx;
      this.coverDir = Math.sign(this.coverCommit - this.routeIdx) || 1;
      this.coverHold = false;
    },
    updateRunner(dt, solids, threatPos) {
      if (this.dead || !this.activated || !threatPos) {
        this.velocity.set(0, 0, 0);
        this.mesh.userData.update?.(dt, false);
        return;
      }
      const cfg = this.evasion;
      const threatXZ = Math.hypot(threatPos.x - this.pos.x, threatPos.z - this.pos.z);
      const threat3D = Math.hypot(threatXZ, (threatPos.y ?? this.pos.y) - this.pos.y);
      if (this.freezeHold) {
        if (threat3D > cfg.freezeRelease) {
          this.freezeHold = false;
          this.crewKneel(false);
        } else {
          this.velocity.set(0, 0, 0);
          this.mesh.userData.update?.(dt, false);
          return;
        }
      } else if (threat3D < cfg.freezeRadius) {
        this.freezeHold = true;
        this.crewKneel(true);
        this.velocity.set(0, 0, 0);
        this.mesh.userData.update?.(dt, false);
        return;
      }
      if (!this.threatened && threatXZ < cfg.triggerRadius) {
        this.threatened = true;
        this.commitToCover(threatPos, threatXZ);
      } else if (this.threatened && threatXZ > cfg.triggerRadius * 1.3) {
        // The press is off — but a dash already committed gets FINISHED. Safety is
        // reaching the cover, not a radius; a man does not stop mid-field because the
        // aircraft's range ticked over a number.
        this.threatened = false;
      }
      if (this.coverHold) {
        if (this.threatened && threatXZ < cfg.flushRadius) {
          // The hide is blown: break for the next cover.
          this.crewKneel(false);
          this.commitToCover(threatPos, threatXZ);
        } else if (!this.threatened) {
          // The aircraft is gone. He waits a human beat under the canopy, then stands
          // and takes his line back up.
          this.coverRelax = (this.coverRelax ?? 3 + ((this.pos.x * 7 + this.pos.z * 3) % 3 + 3) % 3) - dt;
          if (this.coverRelax <= 0) {
            this.coverHold = false;
            this.coverCommit = null;
            this.coverRelax = null;
            this.crewKneel(false);
          } else {
            this.velocity.set(0, 0, 0);
            this.mesh.userData.update?.(dt, false);
            return;
          }
        } else {
          this.velocity.set(0, 0, 0);
          this.mesh.userData.update?.(dt, false);
          return;
        }
      }
      const previousX = this.pos.x;
      const previousZ = this.pos.z;
      const dashing = this.coverCommit != null;
      const speed = dashing ? this.speed : this.speed * 0.4;
      const waypoint = this.route[Math.min(this.routeIdx, this.route.length - 1)];
      const dx = waypoint.x - this.pos.x;
      const dz = waypoint.z - this.pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.7) {
        if (dashing) {
          if (this.routeIdx === this.coverCommit) {
            this.coverHold = true;
            this.coverRelax = null;
            this.crewKneel(true);
            this.velocity.set(0, 0, 0);
            this.mesh.userData.update?.(dt, false);
            return;
          }
          this.routeIdx += this.routeIdx < this.coverCommit ? 1 : -1;
        } else {
          // Unpressed: walk the line and turn around at its ends — never the long wrap
          // sprint across open ground the loop index used to imply.
          if (this.routeIdx + this.patrolDir < 0
            || this.routeIdx + this.patrolDir >= this.route.length) this.patrolDir *= -1;
          this.routeIdx += this.patrolDir;
        }
        return;
      }
      if (distance > 0.001) {
        const travel = Math.min(distance, speed * dt);
        this.pos.x += dx / distance * travel;
        this.pos.z += dz / distance * travel;
        this.mesh.rotation.y = Math.atan2(dz, -dx);
      }
      const ground = groundHeight(solids, this.pos.x, this.pos.z, 0.2, this.pos.y + 2);
      const terrainY = droneTerrain ? droneTerrain(this.pos.x, this.pos.z) : -Infinity;
      const surface = Math.max(ground, terrainY);
      if (surface !== -Infinity) this.pos.y = surface + this.surfaceLift;
      this.velocity.set(
        dt > 0 ? (this.pos.x - previousX) / dt : 0,
        0,
        dt > 0 ? (this.pos.z - previousZ) / dt : 0,
      );
      this.mesh.position.copy(this.pos);
      this.mesh.position.y += 0.02;
      this.mesh.userData.update?.(dt, true, dashing ? 'flee' : 'patrol');
    },
    // Aerial flight: waypoint altitudes instead of the ground snap, a weave-and-climb
    // defence instead of cover, and a transit that keeps flying its last heading past
    // the final waypoint — that straight-out overrun is exactly how a track escapes.
    updateAirborne(dt, threatPos = null) {
      this.mesh.userData.update?.(dt, !this.dead);
      if (this.dead) {
        // The wreck falls with the forward way it still carried, tumbling, until the
        // ground takes it. The charred hull on the dirt is the scoreboard.
        const terrainY = droneTerrain ? droneTerrain(this.pos.x, this.pos.z) : 0;
        if (this.pos.y > terrainY + 0.28) {
          this.fallSpeed = Math.min(24, (this.fallSpeed ?? 1.5) + 20 * dt);
          this.pos.y = Math.max(terrainY + 0.28, this.pos.y - this.fallSpeed * dt);
          this.pos.x += this.velocity.x * 0.35 * dt;
          this.pos.z += this.velocity.z * 0.35 * dt;
          this.mesh.rotation.z += dt * 2.2;
          this.mesh.rotation.x += dt * 0.7;
          this.mesh.position.copy(this.pos);
        }
        return;
      }
      const previousX = this.pos.x, previousY = this.pos.y, previousZ = this.pos.z;
      const waypoint = this.route.length
        ? this.route[Math.min(this.routeIdx, this.route.length - 1)] : null;
      if (waypoint && !this.overrun) {
        const dx = waypoint.x - this.pos.x;
        const dz = waypoint.z - this.pos.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 3) {
          if (this.routeIdx < this.route.length - 1) this.routeIdx++;
          else if (this.loop) this.routeIdx = 0;
          else this.overrun = true;
        } else if (distance > 0.001) {
          this.headingX = dx / distance;
          this.headingZ = dz / distance;
        }
      }
      const hx = this.headingX ?? 1;
      const hz = this.headingZ ?? 0;
      // Threat response with hysteresis: commit to the weave when the interceptor is
      // inside the trigger, settle back to the track only once it has fallen well off.
      if (this.evasion && threatPos) {
        const threatDistance = Math.sqrt(
          (threatPos.x - this.pos.x) ** 2 + ((threatPos.y ?? this.pos.y) - this.pos.y) ** 2
          + (threatPos.z - this.pos.z) ** 2);
        if (!this.evading && threatDistance <= this.evasion.triggerRadius) this.evading = true;
        else if (this.evading && threatDistance > this.evasion.triggerRadius * 1.35) {
          this.evading = false;
        }
      }
      let lateral = 0;
      if (this.evading) {
        const omega = Math.PI * 2 / (this.evasion.jinkPeriod ?? 2.8);
        this.jinkPhase = (this.jinkPhase ?? 0) + dt * omega;
        // The weave is flown as a lateral velocity (the derivative of the sine offset),
        // so the target holds its base track while it snakes across it.
        lateral = Math.cos(this.jinkPhase) * (this.evasion.jinkRadius ?? 7) * omega;
        this.evadeClimb = Math.min(this.evasion.climbMax ?? 9,
          (this.evadeClimb ?? 0) + (this.evasion.climbRate ?? 1.3) * dt);
      } else if (this.evadeClimb) {
        this.evadeClimb = Math.max(0, this.evadeClimb - dt * 1.1);
      }
      const travel = this.speed * dt;
      this.pos.x += hx * travel - hz * lateral * dt;
      this.pos.z += hz * travel + hx * lateral * dt;
      // Cruise height is the waypoint's authored AGL over the terrain under the aircraft,
      // approached at a capped vertical rate so leg-to-leg altitude changes fly smooth.
      const terrainY = droneTerrain ? droneTerrain(this.pos.x, this.pos.z) : 0;
      const cruiseAgl = waypoint && waypoint.y > 0 ? waypoint.y : this.surfaceLift;
      const targetY = terrainY + cruiseAgl + (this.evadeClimb ?? 0);
      const verticalRate = this.evading ? (this.evasion?.climbRate ?? 1.3) + 1.2 : 2.4;
      this.pos.y += Math.max(-verticalRate * dt,
        Math.min(verticalRate * dt, targetY - this.pos.y));
      this.velocity.set(
        dt > 0 ? (this.pos.x - previousX) / dt : 0,
        dt > 0 ? (this.pos.y - previousY) / dt : 0,
        dt > 0 ? (this.pos.z - previousZ) / dt : 0,
      );
      if (this.velocity.lengthSq() > 0.001) {
        this.mesh.rotation.y = Math.atan2(this.velocity.z, -this.velocity.x);
      }
      // Roll into the weave — the visual tell a pilot reads as "he's seen me".
      const targetRoll = this.evading
        ? -Math.sin(this.jinkPhase ?? 0) * 0.3 : 0;
      this.mesh.rotation.z += (targetRoll - this.mesh.rotation.z) * Math.min(1, dt * 5);
      this.mesh.position.copy(this.pos);
    },
  };
  return vehicle;
}

function occupiedShelter(target) {
  const shelter = target?.shelter;
  if (!shelter || !target?.pos) return null;
  const dx = target.pos.x - shelter.x, dz = target.pos.z - shelter.z;
  const cu = Math.cos(shelter.yaw), su = Math.sin(shelter.yaw);
  const u = dx * cu + dz * su;
  const v = -dx * su + dz * cu;
  return Math.abs(u) < shelter.L / 2 - 0.15 && Math.abs(v) < shelter.D / 2 - 0.15
    ? shelter : null;
}

export function dronePrewarmGroup(definition) {
  if (!['strike', 'combat', 'fpv', 'bomber'].includes(definition?.mode)) return null;
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
  if (['fpv', 'bomber'].includes(definition.mode)) {
    for (const vehicle of definition.vehicles || []) {
      root.add(strikeTargetModel({
        pos: new THREE.Vector3(), kind: vehicle.kind || 'tank', yaw: 0,
        label: vehicle.label,
      }));
    }
    root.add(thermalSignature({ dead: false, pos: new THREE.Vector3() }, true));
    root.add(thermalSignature({ dead: false, pos: new THREE.Vector3() }));
    // Ambient population shares the infantry rig; warm its shaders even on missions
    // whose target list carries no infantry of its own.
    if (definition.population?.length
      && !definition.vehicles?.some(vehicle => vehicle.kind === 'infantry')) {
      root.add(strikeTargetModel({
        pos: new THREE.Vector3(), kind: 'infantry', yaw: 0, index: 0,
      }));
    }
  }
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
    root.add(targetingBox({ dead: false, pos: new THREE.Vector3() }));
    root.add(targetingBox({ dead: false, pos: new THREE.Vector3() }, true));
  }
  root.traverse(part => {
    if (part.isMesh || part.isLine) part.frustumCulled = false;
  });
  root.userData.dispose = () => disposeObject(root);
  return root;
}

export class DroneController {
  constructor(scene, camera, definition, onComplete) {
    this.definition = definition;
    this.scene = scene;
    this.camera = camera;
    this.launch = new THREE.Vector3(...definition.launch);
    this.pos = this.launch.clone();
    this.pos.y += 1.7;
    this.vel = new THREE.Vector3();
    this.yaw = definition.yaw ?? Math.PI;
    this.launchYaw = this.yaw;
    this.pitch = -0.08;
    this.roll = 0;
    this.payloadNadir = false;
    this.horizontalForward = new THREE.Vector3();
    // An air-start sortie may hand the pilot an aircraft that already "flew" its
    // approach: battery down by the notional ingress, airspeed already on the nose
    // at the launch yaw. Both apply to every replacement airframe too.
    this.startBattery = Math.max(20, Math.min(100, definition.startBattery ?? 100));
    this.startSpeed = definition.startSpeed ?? 0;
    // Perch drills hand over an aircraft already in the air; everything else sits on a pad.
    this.airStart = (definition.launch?.[1] || 0) > 3;
    this.battery = this.startBattery;
    this.signal = 1;
    // Long-range overwatch sorties can be authored per mission without changing the
    // compact rooftop drone envelope used by the street and tower rounds.
    this.maxRange = definition.maxRange ?? MAX_RANGE;
    this.active = true;
    this.complete = false;
    this.onComplete = onComplete;
    this.mode = definition.mode || 'recon';
    this.persistWrecks = !!definition.persistWrecks;
    this.persistIntel = !!definition.persistIntel;
    this.resultText = definition.result || 'ASSAULT ROUTES MAPPED';
    this.combatants = definition.combatants || [];
    this.combatVehicles = definition.combatVehicles || [];
    this.combatVehicleDefinitions = definition.combatVehicleDefinitions || [];
    this.presentationIndex = definition.presentationSeed || 0;
    this.droneInteriorThreshold = definition.droneInteriorThreshold ?? 2;
    this.rifleRounds = ['combat', 'strike'].includes(this.mode)
      ? (definition.rifleRounds ?? (this.mode === 'strike' ? 72 : 100)) : 0;
    this.grenadeRounds = ['combat', 'strike'].includes(this.mode)
      ? (definition.grenades ?? (this.mode === 'strike' ? 6 : 10)) : 0;
    this.rifleCooldown = 0;
    this.shotsFired = 0;
    this.onCombatShot = definition.onCombatShot || null;
    this.onCombatHit = definition.onCombatHit || null;
    this.onCombatVehicleHit = definition.onCombatVehicleHit || null;
    this.onCombatBlast = definition.onCombatBlast || null;
    this.onIncomingFire = definition.onIncomingFire || null;
    this.incomingPressure = 0;
    // Long-range strike modes ('fpv' kamikaze quad, 'bomber' heavy hexacopter). The numbers
    // are authored per mission; metersPerUnit converts compressed map units into the real
    // distances the OSD reports, so a 1400-unit leg reads as the ~5 km sortie it represents.
    this.isFpvFamily = this.mode === 'fpv' || this.mode === 'bomber';
    this.fiberControlled = definition.controlLink === 'fiber';
    this.metersPerUnit = definition.metersPerUnit ?? 1;
    this.airframes = definition.airframes ?? 1;
    this.airframesLost = 0;
    this.jammers = (definition.jammers || []).map((jammer, index) => ({
      active: jammer.active !== false,
      estimated: !!jammer.estimated,
      pulse: jammer.pulse || null,
      id: jammer.id || `jammer-${index + 1}`,
      ...jammer,
    }));
    this.ceiling = definition.ceiling ?? 34;
    this.batterySeconds = definition.batterySeconds || null;
    this.batteryDrain = this.batterySeconds
      ? 100 / this.batterySeconds / 1.3
      : (definition.batteryDrain ?? 0.72);
    this.thermalBatteryMultiplier = definition.thermalBatteryMultiplier ?? 1.22;
    this.maxSpeed = definition.maxSpeed ?? MAX_SPEED;
    this.accel = definition.accel ?? 19;
    // Camera-bolt buzz only. Flight dynamics and analog-link artifacts are independent.
    // Reduced to 40% of the original amplitude after video-reference review.
    this.cameraVibration = definition.cameraVibration
      ?? (this.mode === 'bomber' ? 0.00048 : 0.00152);
    this.worldMaxSpeed = this.isFpvFamily ? this.maxSpeed / this.metersPerUnit : this.maxSpeed;
    // Stick-law airframe: a 7-inch strike quad carrying a charge runs ~95-110 km/h flat out;
    // the assisted keyboard law keeps its gentler authored cap.
    this.stickTopSpeed = definition.stickTopSpeed ?? Math.max(27, this.maxSpeed * 1.5);
    this.attitude = new THREE.Quaternion();
    this.cameraAttitude = new THREE.Quaternion();
    this.bodyRates = new THREE.Vector3();
    this.heading = this.yaw;
    this.stickAttitude = false;
    this.flightLaw = 'assist';
    // CRUISE transit autopilot: cruise speed in m/s, sim-time compression while engaged, and
    // the hostile proximity (map units) at which it hands control back.
    this.cruise = null;
    this.cruiseEndReason = null;
    this.cruiseSpeed = definition.cruiseSpeed ?? (this.mode === 'bomber' ? 15 : 30);
    this.cruiseCompression = definition.cruiseCompression ?? 4;
    this.cruiseContactRange = definition.cruiseContactRange ?? 95;
    this.searchBox = null;
    // Machine-vision terminal guidance (authored per airframe): hold FIRE with a target near
    // the crosshair to lock; a locked aircraft finishes the run itself if the link dies.
    this.terminalGuidance = !!definition.terminalGuidance;
    this.lockRange = (definition.lockRange ?? 420) / this.metersPerUnit;
    this.terminal = { candidate: null, target: null, hold: 0, masked: 0, armedRelease: false };
    // Landed standby (the roadside ambush): motors safe, camera and link only.
    this.standby = false;
    this.landed = false;
    this.standbyDrain = definition.standbyDrain ?? 0.05;
    this.standbyCompression = definition.standbyCompression ?? 6;
    this.standbyWakeRange = (definition.standbyWakeRange ?? 600) / this.metersPerUnit;
    this.standbyAlerted = false;
    // Anti-drone netting strung over supply roads: drone-only colliders.
    this.netBoxes = [];
    this.netRoot = null;
    this.worldAccel = this.isFpvFamily ? this.accel / this.metersPerUnit : this.accel;
    this.bombs = this.mode === 'bomber' ? (definition.bombs ?? 6) : 0;
    this.bombsTotal = this.bombs;
    this.craftName = definition.craftName || (this.mode === 'bomber' ? 'HW-16 HERON' : 'VMS-7 KESTREL');
    // FPV-family aircraft may all carry a switchable thermal channel. Individual mission
    // definitions can explicitly disable it, while legacy combat drones retain their
    // short burst sensor unless authored otherwise.
    this.thermalPersistent = definition.thermalPersistent ?? this.isFpvFamily;
    this.onFailed = definition.onFailed || null;
    this.onVehicleKilled = definition.onVehicleKilled || null;
    this.onAttemptReviewed = definition.onAttemptReviewed || null;
    this.flightTime = 0;
    this.missionFlightTime = 0;
    this.jamFactor = 1;
    this.linkLowTimer = 0;
    this.failedOut = false;
    this.detonated = false;
    this.training = definition.training || {};
    this.fiberCourse = null;
    this.fiberCable = null;
    this.fiberPoints = [];
    this.fiberPayout = 0;
    this.fiberTension = 0;
    this.fiberWarning = '';
    this.attemptState = this.isFpvFamily ? FPV_ATTEMPT.FLYING : null;
    this.attemptStateTime = 0;
    this.attempts = [];
    this.telemetry = [];
    this.attemptEffects = [];
    this.telemetryClock = 0;
    this.attemptDistance = 0;
    this.attemptJamTime = 0;
    this.attemptCriticalTime = 0;
    this.attemptMinSignal = 1;
    this.attemptMaxAgl = 0;
    this.attemptChaseTime = 0;
    this.attemptAcquiredAt = null;
    this.attemptCommittedAt = null;
    this.attemptStartBattery = 100;
    this.attemptStart = this.pos.clone();
    this.lastTelemetryPos = this.pos.clone();
    this.review = null;
    this.replayGhost = null;
    this.replayPath = null;
    this.pendingMissionComplete = false;
    this.pendingMissionFailure = false;
    this.pendingRunReset = false;
    this.egressRequired = false;
    this.batteryCall30 = false;
    this.batteryCall20 = false;
    this.departedLaunchArea = false;
    this.lastBombImpact = null;
    this.identifyCandidate = null;
    // A fresh airframe arms after launch, like the real munition. During the arming window
    // a solid contact stops the aircraft instead of detonating it — without this, a crash
    // followed by a respawn under live stick input chain-detonates every remaining airframe
    // into the launch treeline before the pilot can reorient.
    this.armTimer = this.isFpvFamily ? 1.2 : 0;
    this.targets = (definition.targets || []).map((entry, index) => ({
      ...(Array.isArray(entry) ? {} : entry),
      pos: new THREE.Vector3(...(Array.isArray(entry) ? entry : entry.pos)),
      marked: false,
      engaged: false,
      defenceTimer: 0.95 + index * 0.42,
      defenceCrewIndex: 0,
      index,
    }));
    this.strikeSquirters = [];
    this.strikeCleanup = false;
    this.strikeCleanupStarted = false;
    this.munitions = [];
    this.effects = [];
    this.completionTimer = null;
    this.savedFov = camera.fov;
    this.childVisibility = [];
    // Hide view-model drawables, not the rig's lights. Hiding a whole group would remove the
    // hemisphere/directional pair from that scene's light counts, changing shader defines
    // and compiling a fresh program family during drone flight — keep program keys stable.
    // The rig lives in its own overlay scene now (weapons.js viewRoot), registered on the
    // camera; the camera itself still carries the world-side muzzle flash light.
    const roots = [camera, ...(camera.userData.viewmodelRoots || [])];
    for (const root of roots) {
      root.traverse(child => {
        if (child === root) return;
        this.childVisibility.push([child, child.visible]);
        if (child.isMesh || child.isLine || child.isPoints || child.isSprite) {
          child.visible = false;
        }
      });
    }
    this.hiddenHud = [
      'health-bar', 'ammo', 'weapon-name', 'squad-line', 'score-line', 'crosshair',
    ].map(id => [document.getElementById(id), document.getElementById(id)?.style.display || '']);
    for (const [element] of this.hiddenHud) if (element) element.style.display = 'none';
    // A real FPV camera is a wide fisheye — the periphery is how the pilot judges speed
    // near the ground. The bomber flies a sedate gimbal view closer to the ISR optics.
    camera.fov = definition.fov ?? (this.mode === 'fpv' ? 106 : 78);
    camera.updateProjectionMatrix();
    this.canvas = document.getElementById('game-canvas');
    this.savedCanvasFilter = this.canvas?.style.filter || '';
    if (this.canvas) {
      this.canvas.style.filter = 'saturate(.78) contrast(1.08) brightness(.9)';
    }

    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.next = new THREE.Vector3();
    this.move = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.contactBounds = new THREE.Box3();
    this.targetMeshes = [];
    this.targetModels = [];
    this.routeModels = [];
    this.thermalSignatures = [];
    this.targetBoxes = [];
    this.thermalEnabled = false;
    this.thermalBurstRemaining = 0;
    this.thermalRechargeRemaining = 0;
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
        const box = targetingBox(actor);
        scene.add(box);
        this.targetBoxes.push(box);
      }
      for (const vehicle of this.combatVehicles) {
        const signature = thermalSignature(vehicle, true);
        scene.add(signature);
        this.thermalSignatures.push(signature);
        const box = targetingBox(vehicle, true);
        scene.add(box);
        this.targetBoxes.push(box);
      }
    }
    if (this.isFpvFamily) {
      // Thermal blobs only, no targeting boxes: the FPV pilot finds the target with their
      // eyes and the map brief, exactly like the real thing. Thermal is the night aid.
      for (const vehicle of this.combatVehicles) {
        // A fire team reads as separate man-shaped blooms, not one vehicle slab; each
        // signature tracks its own figure so the picket's spread survives the palette.
        const figures = vehicle.kind === 'infantry'
          ? vehicle.mesh?.userData.crew || [] : null;
        if (figures?.length) {
          for (const figure of figures) {
            const signature = thermalSignature(vehicle);
            signature.userData.figure = figure;
            if (figure.userData.prone) signature.scale.set(1, 0.38, 1);
            else if (figure.userData.kneel) signature.scale.set(1, 0.72, 1);
            scene.add(signature);
            this.thermalSignatures.push(signature);
          }
          continue;
        }
        const signature = thermalSignature(vehicle, true);
        scene.add(signature);
        this.thermalSignatures.push(signature);
      }
      if (this.training.requireReturn) this.buildLaunchMarker();
      if (this.fiberControlled) this.buildFiberCourse();
      if (definition.nets?.length) this.buildNets(definition.nets);
    }
    // Ambient population: trench garrisons and small parties moving inside their own
    // areas. Scenery with body heat — never targets, never counted, but a blast that
    // reaches one kills him.
    this.populationActors = [];
    if (this.isFpvFamily && definition.population?.length) {
      this.buildPopulation(definition.population);
    }

    if (this.isFpvFamily) {
      this.buildFpvOverlay(definition);
      return;
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
    ? 'WASD FLIGHT · MOUSE/ARROWS LOOK · RMB/Z CLIMB · CTRL/C DESCEND · FIRE RIFLE · G GRENADE · N EO/THERMAL · F HANDOFF'
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
    this.help = this.overlay.querySelector('.drone-help');
  }

  // The FPV skin is modelled on what the feed actually is: an analog camera with Betaflight
  // OSD characters composited over it — blocky white glyphs with a hard shadow, battery
  // voltage and per-cell voltage, mAh drawn, flight timer, link quality/RSSI, home arrow.
  // The video degrades the analog way: snow and tear bars that thicken as SNR falls, never
  // a clean digital freeze. (Analog is what strike crews fly precisely because it fails soft.)
  buildFpvOverlay(definition) {
    this.overlay = document.createElement('div');
    this.overlay.innerHTML = `
      <div class="fpv-optic">
        <canvas class="fpv-noise"></canvas>
        <div class="fpv-tear"></div>
        <div class="fpv-tear fpv-tear-secondary"></div>
        <div class="fpv-scanlines"></div>
        <div class="fpv-lens"></div>
        ${this.mode === 'fpv' ? `
        <div class="fpv-airframe" aria-hidden="true">
          <div class="fpv-arm fpv-arm-left"></div>
          <div class="fpv-arm fpv-arm-right"></div>
          <svg class="fpv-whiskers" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M24 106 C23 91 25 76 24 61 C23 47 24 34 29 36 C41 48 56 69 72 92 C75 97 75 102 75 107" />
            <path d="M27 106 C26 92 28 77 27 62 C26 49 27 37 31 39 C42 51 57 71 74 93 C78 98 77 103 78 107" />
            <path d="M76 106 C77 90 75 74 76 59 C77 45 75 33 71 36 C59 49 44 69 28 92 C25 97 25 102 25 107" />
            <path d="M73 106 C74 91 72 76 73 61 C74 48 73 37 69 39 C58 52 43 71 26 94 C22 99 23 104 22 107" />
          </svg>
        </div>` : ''}
        <div class="fpv-cross">+</div>
        <div class="fpv-lockbox"><span></span></div>
        <div class="fpv-name">${this.craftName}</div>
        <div class="fpv-mode">${this.mode === 'bomber' ? 'ANGLE // PAYLOAD' : 'ACRO // ARMED'}</div>
        <div class="fpv-timer">00:00</div>
        <div class="fpv-dist"></div>
        <div class="fpv-batt"></div>
        <div class="fpv-link"></div>
        <div class="fpv-fiber"></div>
        <div class="fpv-warn"></div>
        <div class="fpv-help">${this.helpLine('keys')}</div>
      </div>
      <div class="fpv-map-panel">
        <div class="fpv-map-label">GROUND STATION NAV-AID // NOT CAMERA</div>
        <canvas class="fpv-map"></canvas>
      </div>
      <div class="fpv-lesson">
        <div class="fpv-lesson-title"></div>
        <div class="fpv-lesson-body"></div>
        <div class="fpv-lesson-key">FIRE — NEXT · R — SKIP ALL</div>
      </div>
      <div class="fpv-review fpv-replay-panel">
        <div class="fpv-review-kicker">STRIKE CONFIRMATION</div>
        <div class="fpv-review-title"></div>
        <div class="fpv-replay-facts"></div>
      </div>
      <div class="fpv-review fpv-debrief-panel">
        <div class="fpv-review-kicker">AIRFRAME DEBRIEF</div>
        <div class="fpv-review-title fpv-debrief-title"></div>
        <div class="fpv-debrief-grid">
          <div><canvas class="fpv-aar-map" width="330" height="190"></canvas><div class="fpv-chart-label">ROUTE // LINK QUALITY</div></div>
          <div><canvas class="fpv-aar-profile" width="330" height="190"></canvas><div class="fpv-chart-label">FLIGHT PROFILE // AGL</div></div>
          <div class="fpv-aar-metrics"></div>
        </div>
        <div class="fpv-coaching">
          <div><b>WORKED</b><ul class="fpv-good"></ul></div>
          <div><b>IMPROVE</b><ul class="fpv-improve"></ul></div>
        </div>
        <div class="fpv-next-instruction"></div>
        <div class="fpv-review-key"></div>
      </div>
      <div class="fpv-ready-panel">
        <div class="fpv-review-kicker">NEXT AIRFRAME</div>
        <div class="fpv-ready-title"></div>
        <div class="fpv-review-key">FIRE — LAUNCH WHEN READY</div>
      </div>
      <div class="drone-result fpv-result"></div>
    `;
    Object.assign(this.overlay.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 40,
      color: '#e9efe9',
      font: '700 15px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '1px',
      textShadow: '1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000',
    });
    const style = document.createElement('style');
    style.textContent = `
      .fpv-optic{position:absolute;inset:0;overflow:hidden;isolation:isolate}
      .fpv-noise{position:absolute;inset:0;width:100%;height:100%;opacity:0;mix-blend-mode:screen}
      .fpv-tear{position:absolute;left:0;right:0;height:0;background:rgba(235,240,235,.5);opacity:0;filter:blur(1px)}
      .fpv-tear-secondary{mix-blend-mode:difference}
      .fpv-scanlines{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.07) 0,rgba(0,0,0,.07) 1px,transparent 1px,transparent 3px);opacity:.45}
      .fpv-lens{position:absolute;inset:-1px;z-index:3;border-radius:11% / 18%;box-shadow:inset 0 0 8vmin 2.4vmin rgba(0,0,0,.84);background:radial-gradient(ellipse 78% 72% at center,transparent 50%,rgba(0,0,0,.11) 72%,rgba(0,0,0,.72) 100%)}
      .fpv-airframe{position:absolute;inset:0;z-index:2;overflow:hidden}
      .fpv-arm{position:absolute;bottom:-2.5%;width:25%;height:3.2%;border-radius:999px;background:linear-gradient(0deg,#080908,#262825 47%,#080908);box-shadow:0 2px 8px rgba(0,0,0,.8)}
      .fpv-arm-left{left:-2%;transform:rotate(-17deg);transform-origin:left center}
      .fpv-arm-right{right:-2%;transform:rotate(17deg);transform-origin:right center}
      .fpv-whiskers{position:absolute;left:32%;bottom:-3%;width:36%;height:58%;overflow:visible;filter:drop-shadow(1px 1px 1px #000)}
      .fpv-whiskers path{fill:none;stroke:rgba(191,176,143,.72);stroke-width:.68;stroke-linecap:round;vector-effect:non-scaling-stroke}
      .fpv-cross{position:absolute;left:50%;top:50%;transform:translate(-50%,-54%);font-size:18px;font-weight:400}
      .fpv-lockbox{position:absolute;display:none;transform:translate(-50%,-50%);border:2px solid #ffd54f;box-shadow:0 0 0 1px #000}
      .fpv-lockbox.locked{border-color:#fff;border-width:3px}
      .fpv-lockbox span{position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:4px;font-size:12px;white-space:nowrap;color:#ffd54f}
      .fpv-lockbox.locked span{color:#fff}
      .fpv-name{position:absolute;left:6%;top:5%}
      .fpv-mode{position:absolute;left:6%;top:calc(5% + 22px);font-size:12px;color:#cfd8cf}
      .fpv-timer{position:absolute;left:6%;top:calc(5% + 42px)}
      .fpv-dist{position:absolute;left:50%;top:max(5%, 74px);transform:translateX(-50%);text-align:center;white-space:pre}
      .fpv-batt{position:absolute;left:6%;bottom:7%;white-space:pre;font-size:17px}
      .fpv-link{position:absolute;right:6%;bottom:7%;text-align:right;white-space:pre}
      .fpv-fiber{position:absolute;left:6%;bottom:calc(7% + 49px);color:#9fe9ff;font-size:11px;white-space:pre}
      .fpv-warn{position:absolute;left:50%;top:63%;transform:translateX(-50%);color:#ffd8b0;font-size:18px;letter-spacing:3px;animation:fpvblink 0.6s steps(2) infinite}
      .fpv-map-panel{position:absolute;z-index:7;right:1.5%;top:2%;padding:5px 5px 4px;border:1px solid rgba(233,239,233,.58);background:rgba(4,6,5,.94);box-shadow:0 8px 30px rgba(0,0,0,.72);text-shadow:none}
      .fpv-map-label{padding:0 1px 4px;color:#dbe5db;font-size:8px;font-weight:700;letter-spacing:.55px;max-width:216px;line-height:1.35}
      .fpv-map{display:block;background:rgba(6,8,6,.68);image-rendering:pixelated}
      .fpv-lesson{position:absolute;left:50%;top:34%;transform:translateX(-50%);max-width:520px;padding:16px 20px;border:1px solid rgba(255,213,79,.75);background:rgba(8,10,8,.92);display:none}
      .fpv-lesson-title{color:#ffd54f;letter-spacing:2px;margin-bottom:8px}
      .fpv-lesson-body{font-weight:400;font-size:14px;line-height:1.5;color:#e9efe9;white-space:pre-line}
      .fpv-lesson-key{margin-top:10px;font-size:11px;color:#ffd54f;letter-spacing:2px;animation:fpvblink 1s steps(2) infinite}
      .fpv-help{position:absolute;left:50%;bottom:2.5%;transform:translateX(-50%);font-size:9px;font-weight:400;letter-spacing:.7px;white-space:nowrap;color:#aeb8ae}
      .fpv-result{position:absolute;left:50%;top:26%;transform:translateX(-50%);padding:9px 14px;border:1px solid rgba(233,239,233,.5);background:rgba(8,10,8,.78);letter-spacing:2px;opacity:0;transition:opacity .18s}
      .fpv-review,.fpv-ready-panel{display:none;position:absolute;z-index:8;background:rgba(7,10,8,.94);border:1px solid rgba(233,239,233,.55);box-shadow:0 18px 70px rgba(0,0,0,.65);text-shadow:none}
      .fpv-replay-panel{left:6%;top:8%;padding:15px 18px;width:310px}
      .fpv-debrief-panel{inset:5% 7%;padding:18px 22px;overflow:hidden}
      .fpv-ready-panel{left:50%;top:42%;transform:translate(-50%,-50%);padding:22px 30px;text-align:center;min-width:360px}
      .fpv-review-kicker{font-size:11px;letter-spacing:3px;color:#ffd54f;margin-bottom:7px}
      .fpv-review-title{font-size:22px;letter-spacing:2px;margin-bottom:12px;color:#fff}
      .fpv-replay-facts,.fpv-aar-metrics{font-weight:400;font-size:13px;line-height:1.65;white-space:pre-line;color:#d9e2d9}
      .fpv-debrief-grid{display:grid;grid-template-columns:minmax(250px,1fr) minmax(250px,1fr) minmax(210px,.75fr);gap:18px;align-items:start}
      .fpv-debrief-grid canvas{width:100%;height:190px;border:1px solid rgba(233,239,233,.25);background:#0b100c}
      .fpv-chart-label{font-size:9px;color:#98a498;letter-spacing:2px;margin-top:5px}
      .fpv-coaching{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:17px;font-size:13px;font-weight:400}
      .fpv-coaching b{font-size:11px;color:#ffd54f;letter-spacing:2px}
      .fpv-coaching ul{margin:7px 0 0;padding-left:19px;line-height:1.55}
      .fpv-next-instruction{margin-top:13px;padding:10px 12px;border-left:3px solid #ffd54f;background:rgba(255,213,79,.08);font-size:13px;font-weight:400}
      .fpv-review-key{margin-top:13px;color:#ffd54f;font-size:11px;letter-spacing:2px;animation:fpvblink 1s steps(2) infinite}
      @media(max-width:850px){.fpv-debrief-panel{inset:2%;overflow:auto}.fpv-debrief-grid{grid-template-columns:1fr 1fr}.fpv-aar-metrics{grid-column:1/-1}.fpv-coaching{grid-template-columns:1fr}.fpv-review-title{font-size:17px}}
      @keyframes fpvblink{50%{opacity:0.15}}
    `;
    this.overlay.appendChild(style);
    document.body.appendChild(this.overlay);
    // The page HUD (phase banner, kill feed) shares the top of the screen with the nav-aid
    // panel; ui.css keys their FPV layout off this class.
    document.body.classList.add('fpv-feed');
    this.status = null;
    this.lock = null;
    this.help = this.overlay.querySelector('.fpv-help');
    this.result = this.overlay.querySelector('.fpv-result');
    this.replayPanel = this.overlay.querySelector('.fpv-replay-panel');
    this.debriefPanel = this.overlay.querySelector('.fpv-debrief-panel');
    this.readyPanel = this.overlay.querySelector('.fpv-ready-panel');
    this.aarMap = this.overlay.querySelector('.fpv-aar-map');
    this.aarProfile = this.overlay.querySelector('.fpv-aar-profile');
    this.flightHudElements = [
      '.fpv-noise', '.fpv-tear', '.fpv-tear-secondary', '.fpv-cross', '.fpv-name',
      '.fpv-mode', '.fpv-timer', '.fpv-dist', '.fpv-batt', '.fpv-link', '.fpv-warn',
      '.fpv-fiber', '.fpv-airframe', '.fpv-map-panel', '.fpv-help',
    ].map(selector => this.overlay.querySelector(selector)).filter(Boolean);
    this.osdElements = [
      '.fpv-cross', '.fpv-name', '.fpv-mode', '.fpv-timer', '.fpv-dist', '.fpv-batt',
      '.fpv-link', '.fpv-warn', '.fpv-fiber', '.fpv-airframe', '.fpv-lockbox',
    ].map(selector => this.overlay.querySelector(selector)).filter(Boolean);
    this.lockBox = this.overlay.querySelector('.fpv-lockbox');
    this.osd = {
      timer: this.overlay.querySelector('.fpv-timer'),
      mode: this.overlay.querySelector('.fpv-mode'),
      dist: this.overlay.querySelector('.fpv-dist'),
      batt: this.overlay.querySelector('.fpv-batt'),
      link: this.overlay.querySelector('.fpv-link'),
      warn: this.overlay.querySelector('.fpv-warn'),
      fiber: this.overlay.querySelector('.fpv-fiber'),
      tears: [...this.overlay.querySelectorAll('.fpv-tear')],
    };
    // Analog snow: a tiny noise canvas stretched over the screen, redrawn at television
    // cadence. Opacity rides (1 - link) so jamming looks like jamming, not like lag.
    this.noiseCanvas = this.overlay.querySelector('.fpv-noise');
    this.noiseCanvas.width = 160;
    this.noiseCanvas.height = 96;
    this.noiseCtx = this.noiseCanvas.getContext('2d');
    this.noiseClock = 0;
    this.buildFpvMap(definition);
    // Flight-school lesson cards: the sim freezes, one card explains one indicator (the
    // named OSD element glows, everything else dims), FIRE advances. Authored per
    // objective as definition.lessons = [{title, body, highlight}].
    // A card set only teaches once: after it has been sat through (or skipped with R),
    // retries and replays go straight to the range. Persisted per set in localStorage.
    const lessons = definition.lessons || [];
    this.lessonKey = lessons.length
      ? 'bp-lessons:' + lessons.map(l => l.title).join('/') : null;
    let lessonsSeen = false;
    try {
      lessonsSeen = !!(this.lessonKey && localStorage.getItem(this.lessonKey));
    } catch { lessonsSeen = false; }
    this.lessonQueue = lessonsSeen ? [] : lessons.slice();
    this.lessonActive = false;
    this.lessonDelay = this.lessonQueue.length ? 1.4 : 0;
    this.lessonCard = this.overlay.querySelector('.fpv-lesson');
    this.lessonDim = ['.fpv-name', '.fpv-mode', '.fpv-timer', '.fpv-dist', '.fpv-batt',
      '.fpv-link', '.fpv-fiber', '.fpv-map-panel', '.fpv-help']
      .map(sel => this.overlay.querySelector(sel)).filter(Boolean);
    // The analog cameras strike crews fly are colour-thin and contrast-hot.
    if (this.canvas) {
      this.canvas.style.filter = 'saturate(.62) contrast(1.14) brightness(.94)';
    }
    if (definition.startMessage) {
      this.result.textContent = definition.startMessage;
      this.result.style.opacity = '1';
      this.resultTimer = setTimeout(() => {
        if (!this.complete) this.result.style.opacity = '0';
      }, 2600);
    }
    // The first aircraft uses the same deliberate launch gate as every replacement:
    // READY -> explicit pilot input -> FLYING. This keeps airframe ownership clear without
    // putting a ground-school screen between the player and the controls.
    this.prepareNextAirframe();
  }

  // Seeker box: amber while acquiring (FIRE held on a target), white once locked.
  updateLockBox() {
    const box = this.lockBox;
    if (!box) return;
    const t = this.terminal;
    const target = t?.target || t?.candidate;
    if (!this.terminalGuidance || !target || this.attemptState !== FPV_ATTEMPT.FLYING) {
      box.style.display = 'none';
      return;
    }
    const aim = this.lockAimPoint(target, LOCK_AIM).project(this.camera);
    if (aim.z > 1 || Math.abs(aim.x) > 1.2 || Math.abs(aim.y) > 1.2) { box.style.display = 'none'; return; }
    const range = target.pos.distanceTo(this.pos) * this.metersPerUnit;
    const size = Math.max(26, Math.min(120, 5200 / Math.max(1, range)));
    box.style.display = 'block';
    box.style.left = `${(aim.x + 1) * 50}%`;
    box.style.top = `${(1 - aim.y) * 50}%`;
    box.style.width = box.style.height = `${size}px`;
    box.classList.toggle('locked', !!t.target);
    box.firstChild.textContent = t.target
      ? `LOCK ${Math.round(range)}M`
      : `ACQ ${Math.min(99, Math.round(t.hold / 0.55 * 100))}%`;
  }

  // The control strip under the feed speaks whichever device is flying the aircraft.
  helpLine(source) {
    const bomber = this.mode === 'bomber';
    if (source === 'xr') {
      return 'TOUCH // L-STICK THROTTLE+YAW · R-STICK PITCH+ROLL · A THERMAL · X CRUISE · B ABORT'
        + (bomber ? ' · TRIGGERS DROP · L-GRIP+R-STICK GIMBAL' : ' · CONTACT TO STRIKE');
    }
    if (source === 'gamepad') {
      return 'PAD // L-STICK THROTTLE+YAW · R-STICK PITCH+ROLL · Y THERMAL · RB CRUISE · B ABORT'
        + (bomber ? ' · A/X DROP · D-PAD GIMBAL' : ' · CONTACT TO STRIKE');
    }
    if (source === 'radio') {
      return 'RADIO // MODE 2 · SWITCHES AS BOUND IN SETTINGS > CONTROLS'
        + (bomber ? ' · DROP SWITCH RELEASES' : ' · CONTACT TO STRIKE');
    }
    return `SIM CONTROL // ${bomber
      ? 'WASD FLIGHT · MOUSE GIMBAL · RMB/Z CLIMB · CTRL/C DESCEND · FIRE/G DROP · N THERMAL · T CRUISE'
      : `WASD FLIGHT · MOUSE LOOK · RMB/Z CLIMB · CTRL/C DESCEND · N EO/THERMAL · T CRUISE${this.terminalGuidance ? ' · HOLD SPACE LOCK' : ''}${this.definition.standbyHint ? ' · LANDED: R STANDBY' : ''} · CONTACT TO STRIKE`}`;
  }

  showLesson() {
    const lesson = this.lessonQueue[0];
    if (!lesson) return;
    this.lessonActive = true;
    this.lessonCard.querySelector('.fpv-lesson-title').textContent = lesson.title || '';
    this.lessonCard.querySelector('.fpv-lesson-body').textContent = lesson.body || '';
    this.lessonCard.style.display = 'block';
    const target = lesson.highlight ? this.overlay.querySelector(lesson.highlight) : null;
    for (const element of this.lessonDim) {
      element.style.opacity = target && element !== target ? '0.22' : '1';
      element.style.outline = element === target ? '2px solid #ffd54f' : '';
      element.style.outlineOffset = element === target ? '4px' : '';
    }
  }

  advanceLesson() {
    this.lessonQueue.shift();
    if (this.lessonQueue.length) {
      this.showLesson();
      return;
    }
    this.lessonActive = false;
    this.lessonCard.style.display = 'none';
    this.markLessonsSeen();
    for (const element of this.lessonDim) {
      element.style.opacity = '1';
      element.style.outline = '';
    }
  }

  markLessonsSeen() {
    if (!this.lessonKey) return;
    try { localStorage.setItem(this.lessonKey, '1'); } catch { /* storage unavailable */ }
  }

  // QA hook: burn through any pending cards so scripted runs are never frozen.
  skipLessons() {
    while (this.lessonQueue?.length) this.advanceLesson();
  }

  // Explicit simulation Nav-Aid, north-up in the corner of the goggles: it replaces the
  // paper/tablet brief the player cannot physically hold. Terrain, assigned AO, estimated
  // jammer footprints and the intel search box are planning information—not live tracking.
  buildFpvMap(definition) {
    const mapCanvas = this.overlay.querySelector('.fpv-map');
    const def = definition.minimap;
    if (!def) { mapCanvas.closest('.fpv-map-panel')?.remove(); return; }
    const [x1, zS, , zN] = def.bounds;
    const x2 = def.bounds[2];
    // The board is square regardless of the operational area's shape: the op area sits
    // centred with margin lanes either side, like a printed map sheet on the table.
    const H = 216;
    const W = 216;
    const scale = H / (zS - zN);
    const opW = (x2 - x1) * scale;
    const xOff = (W - opW) / 2;
    mapCanvas.width = W;
    mapCanvas.height = H;
    mapCanvas.style.width = `${W}px`;
    mapCanvas.style.height = `${H}px`;
    this.mapW = W;
    this.mapH = H;
    this.mapPoint = (x, z) => [xOff + (x - x1) * scale, (z - zN) * scale];
    this.mapScale = scale;
    const stat = document.createElement('canvas');
    stat.width = W;
    stat.height = H;
    const ctx = stat.getContext('2d');
    // Sheet background, then the operational area as a lighter panel with hatched lanes
    // outside it — the boundary IS the outline of where the sortie is allowed to happen.
    // Land edge to edge — the sheet shows countryside everywhere, and the operational
    // area is a marked rectangle ON the map, not the map's own border.
    ctx.fillStyle = 'rgba(16,19,13,0.97)';
    ctx.fillRect(0, 0, W, H);
    // Hypsometric underlay from the real DEM: gully bottoms dark, rises pale. This is the
    // relief the pilot plans ingress around, so it sits under every other feature.
    if (droneTerrain) {
      for (let py = 0; py < H; py += 2) {
        for (let px = 0; px < W; px += 2) {
          const wx = x1 + (px - xOff) / scale;
          const wz = zN + py / scale;
          const t = Math.max(0, Math.min(1, (droneTerrain(wx, wz) + 6) / 21));
          ctx.fillStyle = `rgb(${Math.round(40 + t * 49)},${Math.round(44 + t * 40)},${Math.round(33 + t * 27)})`;
          ctx.fillRect(px, py, 2, 2);
        }
      }
    }
    if (def.opArea) {
      const [oax, oaz] = this.mapPoint(def.opArea[0], def.opArea[1]);
      const [obx, obz] = this.mapPoint(def.opArea[2], def.opArea[3]);
      ctx.strokeStyle = 'rgba(233,239,233,0.4)';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(oax, obx), Math.min(oaz, obz),
        Math.abs(obx - oax), Math.abs(obz - oaz));
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(233,239,233,0.72)';
      ctx.font = '700 8px ui-monospace, Menlo, monospace';
      ctx.fillText('AO', Math.min(oax, obx) + 3, Math.min(oaz, obz) + 10);
    }
    const strokeRuns = (runs, style, width) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      for (const [ax, az, bx, bz] of runs || []) {
        ctx.beginPath();
        ctx.moveTo(...this.mapPoint(ax, az));
        ctx.lineTo(...this.mapPoint(bx, bz));
        ctx.stroke();
      }
    };
    strokeRuns(def.woods, '#33471f', 4);
    strokeRuns(def.roads, '#5c584c', 2);
    strokeRuns(def.rail, '#77776e', 1.5);
    ctx.fillStyle = '#4a4438';
    for (const [px, pz, pw, pd] of def.places || []) {
      const [cx, cz] = this.mapPoint(px, pz);
      ctx.fillRect(cx - pw * scale / 2, cz - pd * scale / 2, pw * scale, pd * scale);
    }
    // Jammer bubbles at full ground radius: the planning picture, not the live altitude cut.
    for (const jammer of this.jammers) {
      if (jammer.hidden) continue;
      const [jx, jz] = this.mapPoint(jammer.estimateX ?? jammer.x, jammer.estimateZ ?? jammer.z);
      ctx.beginPath();
      ctx.arc(jx, jz, (jammer.estimateR ?? jammer.r) * scale, 0, Math.PI * 2);
      ctx.fillStyle = jammer.estimated ? 'rgba(255,140,60,0.07)' : 'rgba(255,90,60,0.13)';
      ctx.fill();
      ctx.strokeStyle = jammer.estimated ? 'rgba(255,184,90,0.48)' : 'rgba(255,110,80,0.5)';
      ctx.lineWidth = 1;
      if (jammer.estimated) ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Anti-drone netting over the roads: violet runs, gaps where the roof is torn.
    for (const net of definition.nets || []) {
      const [ax, az] = net.from, [bx, bz] = net.to;
      ctx.strokeStyle = 'rgba(196,140,255,0.85)';
      ctx.lineWidth = 3;
      const tears = net.tears || [];
      let start = 0;
      const stops = [...tears.flat(), 1];
      for (let i = 0; i < stops.length; i += 2) {
        const end = stops[i];
        ctx.beginPath();
        ctx.moveTo(...this.mapPoint(ax + (bx - ax) * start, az + (bz - az) * start));
        ctx.lineTo(...this.mapPoint(ax + (bx - ax) * end, az + (bz - az) * end));
        ctx.stroke();
        start = stops[i + 1] ?? 1;
      }
      ctx.fillStyle = 'rgba(210,170,255,0.95)';
      ctx.font = '700 7px ui-monospace, Menlo, monospace';
      const [lx, lz] = this.mapPoint(ax, az);
      ctx.fillText('NET', lx + 2, lz - 4);
    }
    // Authored training route: the flagged low line down the gully, dashed amber. Only
    // levels that stake flags on the ground declare it — the map matches the terrain.
    if (def.route?.length > 1) {
      ctx.strokeStyle = 'rgba(255,179,71,0.8)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      def.route.forEach(([rx, rz], i) => {
        const [mx, mz] = this.mapPoint(rx, rz);
        if (i === 0) ctx.moveTo(mx, mz);
        else ctx.lineTo(mx, mz);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (def.alternateRoute?.length > 1) {
      ctx.strokeStyle = 'rgba(92,210,255,0.82)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      def.alternateRoute.forEach(([rx, rz], i) => {
        const [mx, mz] = this.mapPoint(rx, rz);
        if (i === 0) ctx.moveTo(mx, mz); else ctx.lineTo(mx, mz);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(92,210,255,0.9)';
      ctx.font = '700 8px ui-monospace, Menlo, monospace';
      const [ax, az] = this.mapPoint(...def.alternateRoute[1]);
      ctx.fillText('ALT', ax + 2, az - 3);
    }
    // The assigned target is NOT tracked live: intel gives a search box, the pilot does
    // the finding. Optional infantry must not expand that box until it covers half the map.
    // Box is the bounding area of the briefed patrol route (or parked position), padded.
    const assignedTargets = this.combatVehicles.filter(vehicle =>
      !vehicle.optional && !vehicle.decoy && !vehicle.protected);
    if (assignedTargets.length) {
      let bx1 = Infinity, bz1 = Infinity, bx2 = -Infinity, bz2 = -Infinity;
      for (const vehicle of assignedTargets) {
        const points = vehicle.route?.length
          ? vehicle.route.map(p => [p.x, p.z]) : [[vehicle.pos.x, vehicle.pos.z]];
        for (const [px, pz] of points) {
          bx1 = Math.min(bx1, px); bx2 = Math.max(bx2, px);
          bz1 = Math.min(bz1, pz); bz2 = Math.max(bz2, pz);
        }
      }
      const pad = 45;
      this.searchBox = { x1: bx1 - pad, x2: bx2 + pad, z1: bz1 - pad, z2: bz2 + pad };
      const [sx, sz] = this.mapPoint(bx1 - pad, bz2 + pad);
      const [ex, ez] = this.mapPoint(bx2 + pad, bz1 - pad);
      ctx.strokeStyle = 'rgba(255,92,70,0.85)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(Math.min(sx, ex), Math.min(sz, ez), Math.abs(ex - sx), Math.abs(ez - sz));
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,92,70,0.9)';
      ctx.font = '700 8px ui-monospace, Menlo, monospace';
      ctx.fillText('SEARCH', Math.min(sx, ex) + 2, Math.min(sz, ez) - 2);
    }
    // These are area-intelligence marks, not live tracks. They identify an occupied trench
    // system without revealing which firing bay an individual soldier currently occupies.
    for (const target of this.combatVehicles.filter(vehicle =>
      vehicle.optional && vehicle.kind === 'infantry')) {
      const [tx, tz] = this.mapPoint(target.pos.x, target.pos.z);
      ctx.beginPath();
      ctx.arc(tx, tz, 4.2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,190,80,0.8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,205,110,0.9)';
      ctx.font = '700 7px ui-monospace, Menlo, monospace';
      ctx.fillText('TOO', tx + 5, tz + 2);
    }
    ctx.fillStyle = '#aab3aa';
    ctx.font = '700 9px ui-monospace, Menlo, monospace';
    ctx.fillText('N', W / 2 - 3, 9);
    ctx.fillText('S', W / 2 - 3, H - 3);
    ctx.fillText('W', 2, H / 2 + 3);
    ctx.fillText('E', W - 8, H / 2 + 3);
    this.mapStatic = stat;
    this.mapCtx = mapCanvas.getContext('2d');
  }

  buildFiberCourse() {
    const route = this.training.fiberRoute || [];
    const hazards = this.training.fiberHazards || [];
    const root = new THREE.Group();
    root.name = 'fiber-training-course';
    const laneMaterial = new THREE.MeshBasicMaterial({
      color: 0x5ce1ff, transparent: true, opacity: 0.58,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const hazardMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4c36, transparent: true, opacity: 0.72,
      depthWrite: false, side: THREE.DoubleSide,
    });
    // Ground rings keep the player flying through terrain rather than reading another card.
    // Cyan is the suggested broad corridor; crossed red rings are cable snag/wrap zones.
    for (let index = 1; index < route.length; index++) {
      const [ax, az] = route[index - 1], [bx, bz] = route[index];
      const length = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(length / 28));
      for (let step = index === 1 ? 0 : 1; step <= steps; step++) {
        const t = step / steps;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const y = (droneTerrain ? droneTerrain(x, z) : 0) + 0.22;
        const ring = new THREE.Mesh(new THREE.RingGeometry(7.4, 8.2, 28), laneMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, y, z);
        root.add(ring);
      }
    }
    for (const hazard of hazards) {
      const radius = hazard.r ?? 18;
      const y = (droneTerrain ? droneTerrain(hazard.x, hazard.z) : 0) + 0.25;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(2, radius - 1), radius, 32), hazardMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(hazard.x, y, hazard.z);
      root.add(ring);
      for (const angle of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(radius * 1.55, 0.12, 0.7), hazardMaterial);
        bar.position.set(hazard.x, y + 0.03, hazard.z);
        bar.rotation.y = angle;
        root.add(bar);
      }
    }
    this.scene.add(root);
    this.fiberCourse = root;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(768 * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0);
    const cable = new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color: 0xf5d98d, transparent: true, opacity: 0.82,
      depthTest: true, depthWrite: false,
    }));
    cable.name = 'fiber-payout-line';
    cable.frustumCulled = false;
    this.scene.add(cable);
    this.fiberCable = cable;
    this.resetFiberCable();
  }

  resetFiberCable() {
    if (!this.fiberControlled) return;
    const ground = (droneTerrain ? droneTerrain(this.launch.x, this.launch.z) : 0) + 0.2;
    this.fiberPoints = [new THREE.Vector3(this.launch.x, ground, this.launch.z)];
    this.fiberPayout = 0;
    this.fiberTension = 0;
    this.fiberWarning = this.training.fiberRoute?.length
      ? 'CYAN CORRIDOR // RED RINGS SNAG OR WRAP THE LINE' : '';
    this.updateFiberGeometry();
  }

  updateFiberGeometry() {
    if (!this.fiberCable) return;
    const attribute = this.fiberCable.geometry.getAttribute('position');
    const count = Math.min(this.fiberPoints.length, attribute.count);
    for (let index = 0; index < count; index++) {
      const point = this.fiberPoints[index];
      attribute.setXYZ(index, point.x, point.y, point.z);
    }
    attribute.needsUpdate = true;
    this.fiberCable.geometry.setDrawRange(0, count);
  }

  pointToFiberSegmentDistance(x, z, a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1,
      ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
  }

  fiberRouteDistance(x, z) {
    const route = this.training.fiberRoute || [];
    let nearest = Infinity;
    for (let index = 1; index < route.length; index++) {
      const a = { x: route[index - 1][0], z: route[index - 1][1] };
      const b = { x: route[index][0], z: route[index][1] };
      nearest = Math.min(nearest, this.pointToFiberSegmentDistance(x, z, a, b));
    }
    return nearest;
  }

  updateFiberControl(dt) {
    if (!this.fiberControlled || !this.fiberCable) return false;
    const last = this.fiberPoints[this.fiberPoints.length - 1];
    const horizontal = Math.hypot(this.pos.x - last.x, this.pos.z - last.z);
    if (horizontal >= 5.5 && this.fiberPoints.length < 768) {
      const next = new THREE.Vector3(
        this.pos.x,
        (droneTerrain ? droneTerrain(this.pos.x, this.pos.z) : 0) + 0.2,
        this.pos.z,
      );
      this.fiberPayout += last.distanceTo(next);
      let snagged = false;
      for (const hazard of this.training.fiberHazards || []) {
        if (this.pointToFiberSegmentDistance(hazard.x, hazard.z, last, next)
          < (hazard.r ?? 18)) snagged = true;
      }
      if (snagged) this.fiberTension += dt * 2.8 + 0.32;
      if (this.fiberPoints.length > 2) {
        const previous = this.fiberPoints[this.fiberPoints.length - 2];
        const into = last.clone().sub(previous).setY(0).normalize();
        const out = next.clone().sub(last).setY(0).normalize();
        const turn = Math.acos(Math.max(-1, Math.min(1, into.dot(out)))) * 180 / Math.PI;
        if (turn > 105) this.fiberTension += (turn - 105) / 110;
      }
      this.fiberPoints.push(next);
      this.updateFiberGeometry();
    }
    this.fiberTension = Math.max(0, this.fiberTension - dt * 0.07);
    const maxLength = this.training.fiberMaxLength ?? 650;
    const reserve = Math.max(0, maxLength - this.fiberPayout);
    const offRoute = this.fiberRouteDistance(this.pos.x, this.pos.z);
    this.fiberWarning = this.fiberTension > 0.68
      ? 'FIBRE TENSION — WIDEN TURN / CLEAR RED'
      : reserve < maxLength * 0.18
        ? 'FIBRE RESERVE LOW — COMMIT OR ABORT'
        : this.training.fiberRoute?.length && offRoute > (this.training.fiberCorridor ?? 62)
          ? 'OFF ROUTE — CHECK TERRAIN / CABLE'
          : '';
    if (reserve <= 0 || this.fiberTension >= 1) {
      this.loseAirframe(reserve <= 0
        ? 'FIBRE SPOOL EXHAUSTED' : 'FIBRE BROKEN — LINE WRAPPED OR SNAGGED');
      return true;
    }
    return false;
  }

  buildLaunchMarker() {
    const ground = droneTerrain ? droneTerrain(this.launch.x, this.launch.z) : this.launch.y;
    const radius = Math.max(7, (this.training.returnRadius ?? 14) * 0.76);
    const root = new THREE.Group();
    root.name = 'drone-forward-launch-marker';
    root.position.set(this.launch.x, ground + 0.08, this.launch.z);
    const blue = new THREE.MeshBasicMaterial({
      name: 'drone-launch-blue', color: 0x35cfff,
      transparent: true, opacity: 0.82, side: THREE.DoubleSide,
    });
    const white = new THREE.MeshBasicMaterial({
      name: 'drone-launch-white', color: 0xe7fbff,
      transparent: true, opacity: 0.88,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 1.1, radius, 48), blue);
    ring.rotation.x = -Math.PI / 2;
    root.add(ring);
    for (const [x, z, sx, sz] of [
      [-2.3, 0, 0.55, 5.3], [2.3, 0, 0.55, 5.3], [0, 0, 4.6, 0.55],
    ]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.08, sz), white);
      bar.position.set(x, 0.04, z);
      root.add(bar);
    }
    // Four cold-light corner strobes make the recovery box readable in EO. The small
    // heated generator beside it gets a dedicated thermal signature for the return leg.
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 7), blue);
      light.position.set(Math.sin(angle) * radius, 0.38, Math.cos(angle) * radius);
      root.add(light);
    }
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.58, 1.25, 12), white);
    beacon.position.set(radius * 0.58, 0.63, radius * 0.58);
    root.add(beacon);
    this.scene.add(root);
    this.launchMarker = root;
    this.homeBeaconTarget = {
      dead: false,
      pos: new THREE.Vector3(
        this.launch.x + radius * 0.58,
        ground + 0.08,
        this.launch.z + radius * 0.58,
      ),
      mesh: root,
    };
    this.addHomeThermalSignature();
  }

  addHomeThermalSignature() {
    if (!this.homeBeaconTarget) return;
    const signature = thermalSignature(this.homeBeaconTarget, true);
    signature.name = 'drone-thermal-home-beacon';
    this.scene.add(signature);
    this.thermalSignatures.push(signature);
    this.homeThermalSignature = signature;
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

  jammerLive(jammer) {
    if (!jammer.active) return false;
    if (jammer.linkedVehicle || jammer.vehicleId) {
      const id = jammer.linkedVehicle || jammer.vehicleId;
      const source = this.combatVehicles.find(vehicle =>
        vehicle.jammerId === id || vehicle.targetId === id || vehicle.label === id);
      if (source?.dead) return false;
      // A vehicle-mounted dome (the turtle's own EW) travels with its carrier.
      if (jammer.follow && source) { jammer.x = source.pos.x; jammer.z = source.pos.z; }
    }
    if (jammer.pulse) {
      const on = Math.max(0.2, jammer.pulse.on ?? 8);
      const off = Math.max(0.2, jammer.pulse.off ?? 5);
      const phase = (this.missionFlightTime + (jammer.pulse.offset || 0)) % (on + off);
      if (phase >= on) return false;
    }
    return true;
  }

  nearestLiveVehicle(position = this.pos) {
    // Required targets outrank optional ones: an optional dismount picket posted beside
    // a primary must not capture the acquire/identify track from the vehicle that
    // actually completes the mission.
    let nearest = null;
    let distance = Infinity;
    let nearestOptional = null;
    let optionalDistance = Infinity;
    for (const vehicle of this.combatVehicles) {
      if (vehicle.dead || vehicle.decoy || vehicle.protected) continue;
      const d = vehicle.pos.distanceTo(position);
      if (vehicle.optional) {
        if (d < optionalDistance) { nearestOptional = vehicle; optionalDistance = d; }
      } else if (d < distance) { nearest = vehicle; distance = d; }
    }
    if (nearest) return { vehicle: nearest, distance };
    return { vehicle: nearestOptional, distance: optionalDistance };
  }

  recordAttemptTelemetry(dt, solids) {
    if (!this.isFpvFamily || this.attemptState !== FPV_ATTEMPT.FLYING) return;
    const moved = this.pos.distanceTo(this.lastTelemetryPos);
    if (Number.isFinite(moved) && moved < this.worldMaxSpeed * Math.max(dt, 0.05) * 3) {
      this.attemptDistance += moved;
    }
    this.lastTelemetryPos.copy(this.pos);
    const terrainY = droneTerrain ? droneTerrain(this.pos.x, this.pos.z) : 0;
    const agl = Math.max(0, this.pos.y - terrainY);
    this.attemptMaxAgl = Math.max(this.attemptMaxAgl, agl);
    this.attemptMinSignal = Math.min(this.attemptMinSignal, this.signal);
    if (this.jamFactor < 0.92) this.attemptJamTime += dt;
    if (this.signal < 0.3) this.attemptCriticalTime += dt;

    const nearest = this.nearestLiveVehicle();
    const target = nearest.vehicle;
    if (target && nearest.distance < (this.training.acquireRange ?? 95)) {
      if (this.attemptAcquiredAt === null) this.attemptAcquiredAt = this.flightTime;
      if (nearest.distance < (this.training.commitRange ?? 38)
        && this.attemptCommittedAt === null) this.attemptCommittedAt = this.flightTime;
      const targetSpeed = target.velocity?.length?.() || 0;
      if (this.mode !== 'bomber' && targetSpeed > 0.35) {
        const motion = target.velocity.clone().normalize();
        const targetToDrone = this.pos.clone().sub(target.pos).setY(0);
        if (targetToDrone.lengthSq() > 0.1
          && motion.dot(targetToDrone.normalize()) < -0.45) this.attemptChaseTime += dt;
      }
      if (target.requiresIdentification && !target.identified) {
        const toTarget = target.pos.clone().add(new THREE.Vector3(0, 1, 0)).sub(this.pos);
        const range = toTarget.length();
        const dot = range > 0 ? this.forward.dot(toTarget.multiplyScalar(1 / range)) : 0;
        const visible = range < (this.training.identifyRange ?? 45) && dot > 0.94
          && hasLOS(solids, this.pos.x, this.pos.y, this.pos.z,
            target.pos.x, target.pos.y + 1, target.pos.z);
        target.identifyProgress = visible ? target.identifyProgress + dt : Math.max(0, target.identifyProgress - dt * 0.5);
        if (target.identifyProgress >= target.identifySeconds) {
          target.identified = true;
          this.identifyCandidate = target;
          this.result.textContent = `${target.label || 'TARGET'} — POSITIVE IDENTIFICATION`;
          this.result.style.opacity = '1';
        }
      }
    }

    this.telemetryClock -= dt;
    if (this.telemetryClock > 0) return;
    this.telemetryClock = TELEMETRY_INTERVAL;
    const targetSpeed = target?.velocity?.length?.() || 0;
    this.telemetry.push({
      t: this.flightTime,
      x: this.pos.x, y: this.pos.y, z: this.pos.z, agl,
      speed: this.vel.length() * this.metersPerUnit,
      battery: this.battery, signal: this.signal, jam: this.jamFactor,
      targetX: target?.pos.x ?? null, targetY: target?.pos.y ?? null,
      targetZ: target?.pos.z ?? null,
      targetSpeed: targetSpeed * this.metersPerUnit,
      targetHeading: targetSpeed > 0.01 ? Math.atan2(target.velocity.x, -target.velocity.z) : null,
    });
    if (this.telemetry.length > 7200) this.telemetry.shift();
  }

  resetAttemptTelemetry() {
    this.flightTime = 0;
    this.telemetry.length = 0;
    this.attemptEffects.length = 0;
    this.telemetryClock = 0;
    this.attemptDistance = 0;
    this.attemptJamTime = 0;
    this.attemptCriticalTime = 0;
    this.attemptMinSignal = 1;
    this.attemptMaxAgl = 0;
    this.attemptChaseTime = 0;
    this.attemptAcquiredAt = null;
    this.attemptCommittedAt = null;
    this.attemptStartBattery = this.battery;
    this.attemptStart.copy(this.pos);
    this.lastTelemetryPos.copy(this.pos);
  }

  coachAttempt(report) {
    const good = [];
    const improve = [];
    // Rear/flank pursuit is an FPV intercept concern. A bomber attacks from above with a
    // gimballed payload view; telling that crew to manufacture a side aspect is nonsense.
    const tailChase = this.mode !== 'bomber' && report.chaseTime > 10;
    if (['DESTROYED', 'MOBILITY KILL', 'EFFECTIVE'].includes(report.effect)) {
      if (report.targetShelter) {
        good.push(`You carried the attack through the ${report.targetShelter.entry} and achieved the effect inside the ${report.targetShelter.state} ${report.targetShelter.kind}.`);
      } else {
      const aspectNote = report.targetCaged && report.aspect === 'REAR'
        ? ' through the required rear opening'
        : !report.targetCaged && ['REAR', 'FLANK'].includes(report.aspect)
          ? ` from a valid ${report.aspect.toLowerCase()} presentation; no side-offset maneuver was required`
          : '';
      good.push(`The ${report.aspect.toLowerCase()} strike produced an assessed ${report.effect.toLowerCase()}${aspectNote}.`);
      }
    }
    if (report.firstPass) good.push('You built the intercept early and reached the target on the first attack pass.');
    if (report.routeEfficiency <= 1.55) good.push(`You flew ${Math.round(report.distance)} m against a ${Math.round(report.baselineDistance)} m required-task baseline (${report.routeEfficiency.toFixed(2)}×), including every target leg${report.returnIncluded ? ' and the return home' : ''}.`);
    if (report.jamTime < 4) good.push(`Electronic-warfare exposure was ${report.jamTime.toFixed(1)} seconds.`);
    if (report.minSignal >= 0.36) good.push(`Minimum link quality remained at ${Math.round(report.minSignal * 100)}%.`);
    if (report.batteryAtEnd >= 28) good.push(`You committed with ${Math.round(report.batteryAtEnd)}% battery still available.`);

    if (tailChase) improve.push(`You spent ${Math.round(report.chaseTime)} seconds behind the target; move to a future intercept point.`);
    if (report.batteryAtEnd < 20) improve.push('Battery reserve was nearly exhausted before impact; shorten the setup or commit earlier.');
    if (report.jamTime > 8) improve.push(`The aircraft spent ${report.jamTime.toFixed(1)} seconds under electronic attack; the red route segments show exactly where exposure accumulated.`);
    if (report.routeEfficiency > 1.7) improve.push(`After accounting for all required target legs${report.returnIncluded ? ' and the return home' : ''}, you flew ${Math.round(report.routeExcess)} m beyond the ${Math.round(report.baselineDistance)} m task baseline (${report.routeEfficiency.toFixed(2)}×).`);
    if (!report.acquired) improve.push('The terminal run began without a stable acquisition; establish the target before committing.');
    if (report.effect === 'NETTED') improve.push('The netting caught the aircraft. Strike where the road leaves the net, or drop through a torn section of the roof.');
    if (report.effect === 'ROAD NOT CLEARED') improve.push('Our run reached a live ambush drone. Search the verges in departure order: nearest to our start first.');
    if (report.effect === 'PROTECTION DEFEAT') improve.push(`The ${report.aspect.toLowerCase()} impact struck protection rather than the rear opening; only this protected target requires a rear attack.`);
    else if (['NO EFFECT', 'MISS'].includes(report.effect)) improve.push(`The closest valid target was ${Math.round(report.impactDistance)} m from impact; correct the final line by that miss distance rather than changing aspect automatically.`);
    if (this.training.maxAgl && report.maxAgl > this.training.maxAgl) {
      improve.push(`You climbed above the ${Math.round(this.training.maxAgl * this.metersPerUnit)} m profile limit.`);
    }
    if (report.terminalCorrection > 95) improve.push(`You changed course by ${Math.round(report.terminalCorrection)}° during the final five seconds; establish the line earlier.`);
    const structureMiss = report.targetShelter
      && ['NO EFFECT', 'PROTECTION DEFEAT', 'MISS'].includes(report.effect);
    const instruction = structureMiss
      ? `NEXT RUN: reduce speed before the structure, center the ${report.targetShelter.entry} and cross the threshold before detonation.`
      : tailChase
      ? 'NEXT RUN: cross to the target’s flank and aim for where it will be, not where it is.'
      : report.jamTime > 8
        ? 'NEXT RUN: identify the masking terrain before launch and leave the exposed line early.'
        : report.batteryAtEnd < 20
          ? 'NEXT RUN: set a battery decision point and commit or abort when you reach it.'
          : report.routeEfficiency > 1.7
            ? `NEXT RUN: compare the flown trace with the dashed required-task legs and shorten only the excess outside that sequence.`
            : !report.acquired
              ? 'NEXT RUN: hold the target near the center of the feed until acquisition registers, then begin the terminal run.'
          : ['NO EFFECT', 'PROTECTION DEFEAT', 'MISS'].includes(report.effect)
            ? 'NEXT RUN: stabilize the final line earlier and verify the intended impact aspect.'
            : report.terminalCorrection > 95
              ? 'NEXT RUN: finish the offset maneuver before the final five seconds and hold one attack line.'
              : 'NEXT RUN: no corrective task assigned; request a new target presentation or advance.';
    return { good: good.slice(0, 2), improve: improve.slice(0, 2), instruction };
  }

  finalizeAttempt(reason, outcome = {}) {
    const samples = this.telemetry.slice();
    const target = outcome.target || this.nearestLiveVehicle(outcome.impact || this.pos).vehicle;
    const requiredEffects = this.attemptEffects.filter(effect => effect.required);
    const baselinePoints = [this.attemptStart.clone()];
    for (const effect of requiredEffects) baselinePoints.push(effect.pos.clone());
    const returnIncluded = !!(this.training.requireReturn && outcome.missionComplete);
    const endpoint = returnIncluded ? this.launch : (outcome.impact || this.pos);
    if (baselinePoints.length === 1
      || baselinePoints[baselinePoints.length - 1].distanceTo(endpoint) > 1) {
      baselinePoints.push(endpoint.clone());
    }
    let baseline = 0;
    for (let index = 1; index < baselinePoints.length; index++) {
      baseline += baselinePoints[index - 1].distanceTo(baselinePoints[index]);
    }
    baseline = Math.max(1, baseline);
    const routeEfficiency = this.attemptDistance / baseline;
    const targetSpeed = target?.velocity?.length?.() || 0;
    let aspect = 'UNKNOWN';
    if (target) {
      const rearDirection = new THREE.Vector3(1, 0, 0)
        .applyAxisAngle(UP_AXIS, target.mesh.rotation.y).normalize();
      const targetToImpact = (outcome.impact || this.pos).clone().sub(target.pos).setY(0);
      if (targetToImpact.lengthSq() > 0.01) {
        const dot = rearDirection.dot(targetToImpact.normalize());
        aspect = dot > 0.55 ? 'REAR' : dot < -0.55 ? 'FRONT' : 'FLANK';
      }
    }
    const terminalSamples = samples.filter(sample => sample.t >= this.flightTime - 5);
    let terminalCorrection = 0;
    let previousHeading = null;
    for (let index = 1; index < terminalSamples.length; index++) {
      const dx = terminalSamples[index].x - terminalSamples[index - 1].x;
      const dz = terminalSamples[index].z - terminalSamples[index - 1].z;
      if (dx * dx + dz * dz < 0.01) continue;
      const heading = Math.atan2(dx, -dz);
      if (previousHeading !== null) {
        const delta = Math.atan2(Math.sin(heading - previousHeading), Math.cos(heading - previousHeading));
        terminalCorrection += Math.abs(delta) * 180 / Math.PI;
      }
      previousHeading = heading;
    }
    const effect = outcome.effect || (outcome.killed ? 'DESTROYED' : 'NO EFFECT');
    const firstPass = this.attemptCommittedAt !== null && this.attemptChaseTime < 8;
    const score = Math.max(0, Math.min(100,
      20
      + (this.attemptAcquiredAt !== null ? 15 : 0)
      + (firstPass ? 20 : Math.max(0, 12 - this.attemptChaseTime * 0.5))
      + (this.attemptJamTime < 5 ? 15 : Math.max(0, 15 - this.attemptJamTime))
      + (this.battery >= 25 ? 15 : this.battery * 0.6)
      + (['DESTROYED', 'MOBILITY KILL', 'EFFECTIVE'].includes(effect) ? 15 : 0)));
    const report = {
      reason, effect, aspect, score: Math.round(score), samples,
      duration: this.flightTime,
      distance: this.attemptDistance * this.metersPerUnit,
      directDistance: baseline * this.metersPerUnit,
      baselineDistance: baseline * this.metersPerUnit,
      baselinePoints,
      requiredLegs: Math.max(1, baselinePoints.length - 1),
      returnIncluded,
      routeExcess: Math.max(0, this.attemptDistance - baseline) * this.metersPerUnit,
      routeEfficiency,
      batteryAtEnd: this.battery,
      batteryUsed: this.attemptStartBattery - this.battery,
      minSignal: this.attemptMinSignal,
      jamTime: this.attemptJamTime,
      criticalTime: this.attemptCriticalTime,
      maxAgl: this.attemptMaxAgl,
      chaseTime: this.attemptChaseTime,
      acquired: this.attemptAcquiredAt !== null,
      acquireTime: this.attemptAcquiredAt,
      commitTime: this.attemptCommittedAt,
      firstPass,
      targetSpeed: targetSpeed * this.metersPerUnit,
      targetCaged: !!target?.cage,
      // A mobile runner may leave and re-enter a barn. Credit an indoor attack only when
      // the target was physically inside at impact, not merely because its route uses one.
      targetShelter: occupiedShelter(target),
      impactDistance: target ? target.pos.distanceTo(outcome.impact || this.pos) * this.metersPerUnit : 0,
      terminalCorrection,
      targetLabel: target?.label || 'NO CONFIRMED TARGET',
      impact: (outcome.impact || this.pos).clone(),
      target,
      expended: outcome.expended !== false,
      aborted: !!outcome.aborted,
    };
    report.coaching = this.coachAttempt(report);
    this.attempts.push(report);
    return report;
  }

  beginAttemptReview(reason, outcome = {}) {
    if (!this.isFpvFamily || this.attemptState !== FPV_ATTEMPT.FLYING) return;
    if (outcome.expended !== false) this.airframesLost++;
    this.vel.set(0, 0, 0);
    this.cruise = null;
    // A spent FPV or lost aircraft leaves a dead feed. A reusable bomber that merely ran
    // out of payload still has a live link, so do not misrepresent that state as full EW.
    this.signal = outcome.expended === false ? Math.max(this.signal, 0.35) : 0;
    this.review = this.finalizeAttempt(reason, outcome);
    this.onAttemptReviewed?.(this.review);
    this.pendingMissionComplete = outcome.missionComplete
      ?? (this.combatVehicles.length > 0 && this.combatVehicles.every(vehicle =>
        vehicle.dead || vehicle.decoy || vehicle.protected || vehicle.optional));
    this.pendingMissionFailure = !this.pendingMissionComplete
      && (outcome.criticalFailure || this.airframesLost >= this.airframes);
    this.pendingRunReset = !!outcome.restartRun;
    this.attemptState = FPV_ATTEMPT.IMPACT_HOLD;
    this.attemptStateTime = 0;
    // The OSD is drawn by the aircraft's own flight controller. When the airframe is gone the
    // goggles receive bare snow: no characters, no warnings. A recovered aircraft keeps its OSD.
    if (outcome.expended !== false) {
      for (const element of this.osdElements) element.style.visibility = 'hidden';
    }
    this.result.textContent = `${reason}\nAWAITING STRIKE CONFIRMATION`;
    this.result.style.opacity = '1';
    this.help.style.display = 'none';
  }

  clearReplayObjects() {
    for (const object of [this.replayGhost, this.replayPath]) {
      if (!object) continue;
      this.scene.remove(object);
      disposeObject(object);
    }
    this.replayGhost = null;
    this.replayPath = null;
  }

  startAttemptReplay() {
    this.attemptState = FPV_ATTEMPT.REPLAY;
    this.attemptStateTime = 0;
    this.result.style.opacity = '0';
    for (const element of this.flightHudElements) element.style.display = 'none';
    if (this.canvas) this.canvas.style.filter = 'saturate(.78) contrast(1.06) brightness(.86)';
    const report = this.review;
    const recent = report.samples.filter(sample => sample.t >= report.duration - 8);
    report.replaySamples = recent.length > 1 ? recent : report.samples;
    const points = report.replaySamples.map(sample => new THREE.Vector3(sample.x, sample.y, sample.z));
    if (points.length > 1) {
      this.replayPath = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.5 }),
      );
      this.scene.add(this.replayPath);
    }
    this.replayGhost = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 7),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.scene.add(this.replayGhost);
    this.replayPanel.querySelector('.fpv-review-title').textContent = report.reason;
    this.replayPanel.querySelector('.fpv-replay-facts').textContent = [
      `TARGET       ${report.targetLabel}`,
      `TARGET SPEED ${Math.round(report.targetSpeed * 3.6)} KM/H`,
      `APPROACH     ${report.aspect}`,
      `BATTERY      ${Math.round(report.batteryAtEnd)}%`,
      `ASSESSED     ${report.effect}`,
    ].join('\n');
    this.replayPanel.style.display = 'block';
    this.replayBlastShown = false;
  }

  updateAttemptReplay(dt) {
    const report = this.review;
    const samples = report.replaySamples || [];
    const duration = 7.5;
    const progress = Math.min(1, this.attemptStateTime / duration);
    const index = Math.min(samples.length - 1, Math.floor(progress * Math.max(0, samples.length - 1)));
    const sample = samples[Math.max(0, index)];
    if (sample && this.replayGhost) this.replayGhost.position.set(sample.x, sample.y, sample.z);
    const focus = report.impact.clone();
    if (report.target && !report.target.dead && sample?.targetX !== null) {
      focus.set(sample.targetX, sample.targetY, sample.targetZ);
    }
    const previous = samples[Math.max(0, index - 3)] || sample;
    const approach = sample && previous
      ? new THREE.Vector3(sample.x - previous.x, 0, sample.z - previous.z).normalize()
      : new THREE.Vector3(0, 0, -1);
    if (approach.lengthSq() < 0.1) approach.set(0, 0, -1);
    const side = new THREE.Vector3(-approach.z, 0, approach.x);
    this.camera.position.copy(focus).addScaledVector(side, 10).addScaledVector(approach, -6);
    this.camera.position.y = focus.y + 6.5;
    this.camera.lookAt(focus.x, focus.y + 1.1, focus.z);
    if (progress > 0.88 && !this.replayBlastShown) {
      this.replayBlastShown = true;
      this.createImpactEffect(report.impact, this.attempts.length + 20);
    }
    if (this.attemptStateTime >= duration) this.showAttemptDebrief();
  }

  drawAttemptCharts(report) {
    const samples = report.samples;
    const map = this.aarMap.getContext('2d');
    const profile = this.aarProfile.getContext('2d');
    for (const [ctx, canvas] of [[map, this.aarMap], [profile, this.aarProfile]]) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0b100c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(210,225,210,.13)'; ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        ctx.beginPath(); ctx.moveTo(0, i * canvas.height / 5); ctx.lineTo(canvas.width, i * canvas.height / 5); ctx.stroke();
      }
    }
    if (!samples.length) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const sample of samples) {
      minX = Math.min(minX, sample.x, sample.targetX ?? sample.x);
      maxX = Math.max(maxX, sample.x, sample.targetX ?? sample.x);
      minZ = Math.min(minZ, sample.z, sample.targetZ ?? sample.z);
      maxZ = Math.max(maxZ, sample.z, sample.targetZ ?? sample.z);
    }
    for (const point of report.baselinePoints || []) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
    }
    const margin = 18;
    const sx = (this.aarMap.width - margin * 2) / Math.max(1, maxX - minX);
    const sz = (this.aarMap.height - margin * 2) / Math.max(1, maxZ - minZ);
    const scale = Math.min(sx, sz);
    const mapPoint = sample => [margin + (sample.x - minX) * scale, margin + (sample.z - minZ) * scale];
    const baselinePoints = report.baselinePoints || [];
    if (baselinePoints.length > 1) {
      map.strokeStyle = 'rgba(233,239,233,.45)';
      map.lineWidth = 1;
      map.setLineDash([5, 4]);
      map.beginPath();
      baselinePoints.forEach((point, index) => {
        const [x, z] = mapPoint(point);
        if (!index) map.moveTo(x, z); else map.lineTo(x, z);
      });
      map.stroke();
      map.setLineDash([]);
      map.fillStyle = 'rgba(233,239,233,.72)';
      map.font = '700 8px ui-monospace, Menlo, monospace';
      const labelPoint = baselinePoints[Math.floor(baselinePoints.length / 2)];
      const [labelX, labelZ] = mapPoint(labelPoint);
      map.fillText('TASK BASELINE', labelX + 3, labelZ - 3);
    }
    map.lineWidth = 2.2;
    for (let i = 1; i < samples.length; i++) {
      const [ax, az] = mapPoint(samples[i - 1]);
      const [bx, bz] = mapPoint(samples[i]);
      const signal = samples[i].signal;
      map.strokeStyle = signal < 0.3 ? '#ff695f' : signal < 0.65 ? '#ffd54f' : '#72e58a';
      map.beginPath(); map.moveTo(ax, az); map.lineTo(bx, bz); map.stroke();
    }
    const targetSamples = samples.filter(sample => sample.targetX !== null);
    if (targetSamples.length > 1) {
      map.strokeStyle = '#ff8b72'; map.lineWidth = 1.3; map.setLineDash([4, 3]); map.beginPath();
      targetSamples.forEach((sample, index) => {
        const [x, z] = mapPoint({ x: sample.targetX, z: sample.targetZ });
        if (!index) map.moveTo(x, z); else map.lineTo(x, z);
      });
      map.stroke(); map.setLineDash([]);
    }
    const maxAgl = Math.max(5, ...samples.map(sample => sample.agl));
    profile.lineWidth = 2;
    profile.strokeStyle = '#e9efe9'; profile.beginPath();
    samples.forEach((sample, index) => {
      const x = index / Math.max(1, samples.length - 1) * this.aarProfile.width;
      const y = this.aarProfile.height - 12 - sample.agl / maxAgl * (this.aarProfile.height - 24);
      if (!index) profile.moveTo(x, y); else profile.lineTo(x, y);
    });
    profile.stroke();
    profile.strokeStyle = '#ffd54f'; profile.lineWidth = 1.4; profile.beginPath();
    samples.forEach((sample, index) => {
      const x = index / Math.max(1, samples.length - 1) * this.aarProfile.width;
      const y = this.aarProfile.height - 8 - sample.battery / 100 * (this.aarProfile.height - 16);
      if (!index) profile.moveTo(x, y); else profile.lineTo(x, y);
    });
    profile.stroke();
  }

  showAttemptDebrief() {
    this.attemptState = FPV_ATTEMPT.DEBRIEF;
    this.attemptStateTime = 0;
    this.replayPanel.style.display = 'none';
    this.clearReplayObjects();
    const report = this.review;
    this.debriefPanel.querySelector('.fpv-debrief-title').textContent = `${report.targetLabel} // ${report.effect}`;
    this.debriefPanel.querySelector('.fpv-aar-metrics').textContent = [
      `SCORE             ${report.score}/100`,
      `FLIGHT TIME       ${report.duration.toFixed(1)} SEC`,
      `DISTANCE FLOWN    ${Math.round(report.distance)} M`,
      `TASK BASELINE     ${Math.round(report.baselineDistance)} M / ${report.requiredLegs} LEGS`,
      `ROUTE EFFICIENCY  ${report.routeEfficiency.toFixed(2)}×`,
      `BATTERY AT END    ${Math.round(report.batteryAtEnd)}%`,
      `MINIMUM LINK      ${Math.round(report.minSignal * 100)}%`,
      `EW EXPOSURE       ${report.jamTime.toFixed(1)} SEC`,
      `CHASE TIME        ${report.chaseTime.toFixed(1)} SEC`,
      `FIRST PASS        ${report.firstPass ? 'YES' : 'NO'}`,
    ].join('\n');
    const fill = (selector, entries) => {
      const list = this.debriefPanel.querySelector(selector);
      list.replaceChildren(...entries.map(entry => {
        const item = document.createElement('li'); item.textContent = entry; return item;
      }));
    };
    fill('.fpv-good', report.coaching.good);
    fill('.fpv-improve', report.coaching.improve);
    this.debriefPanel.querySelector('.fpv-next-instruction').textContent = report.coaching.instruction;
    this.debriefPanel.querySelector('.fpv-review-key').textContent = this.training.openRange
      ? this.pendingMissionComplete || this.pendingMissionFailure || this.pendingRunReset
        ? 'FIRE — REPEAT THIS PHASE  ·  F — ADVANCE TO NEXT PHASE'
        : 'FIRE — NEXT AIRFRAME  ·  F — FINISH THIS PHASE'
      : this.pendingMissionComplete
        ? 'FIRE — SUBMIT BDA AND COMPLETE MISSION'
        : this.pendingMissionFailure
          ? 'FIRE — SUBMIT BDA'
          : 'FIRE — ACCEPT DEBRIEF';
    this.drawAttemptCharts(report);
    this.debriefPanel.style.display = 'block';
  }

  practiceVehicleDefinition(definition, index) {
    let resolved = { ...definition };
    if (definition.variants?.length) {
      resolved = { ...resolved, ...definition.variants[index % definition.variants.length] };
    } else if (definition.positions?.length) {
      resolved.pos = definition.positions[index % definition.positions.length];
    }
    if (resolved.pos) resolved.pos = [...resolved.pos];
    if (resolved.route) resolved.route = resolved.route.map(point => [...point]);
    return resolved;
  }

  serveNewTargetSet(readyReason = '') {
    if (!this.combatVehicleDefinitions.length) {
      this.pendingMissionComplete = false;
      this.pendingMissionFailure = false;
      this.pendingRunReset = false;
      this.egressRequired = false;
      this.batteryCall30 = false;
      this.batteryCall20 = false;
      this.airframesLost = 0;
      this.prepareNextAirframe(readyReason);
      return;
    }
    for (const signature of this.thermalSignatures) {
      this.scene.remove(signature);
      disposeObject(signature);
    }
    this.thermalSignatures.length = 0;
    for (const vehicle of this.combatVehicles) {
      this.scene.remove(vehicle.mesh);
      vehicle.mesh.userData.dispose?.();
    }
    this.presentationIndex++;
    this.combatVehicles = this.combatVehicleDefinitions.map(definition =>
      createDroneAssaultVehicle(this.scene,
        this.practiceVehicleDefinition(definition, this.presentationIndex)));
    for (const vehicle of this.combatVehicles) {
      const signature = thermalSignature(vehicle, true);
      this.scene.add(signature);
      this.thermalSignatures.push(signature);
    }
    this.addHomeThermalSignature();
    this.airframesLost = 0;
    this.bombs = this.bombsTotal;
    this.lastBombImpact = null;
    this.pendingMissionComplete = false;
    this.pendingMissionFailure = false;
    this.pendingRunReset = false;
    this.egressRequired = false;
    this.batteryCall30 = false;
    this.batteryCall20 = false;
    this.buildFpvMap(this.definition);
    this.prepareNextAirframe(readyReason);
  }

  advanceTrainingStage() {
    this.complete = true;
    this.debriefPanel.style.display = 'none';
    this.onComplete?.();
  }

  radioCall(message, duration = 4600) {
    if (!this.result) return;
    this.result.textContent = message;
    this.result.style.opacity = '1';
    clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => {
      if (!this.complete) this.result.style.opacity = '0';
    }, duration);
  }

  bomberRetask(killedLabels = [], tacticalEffect = '') {
    if (this.mode !== 'bomber') return;
    const remaining = this.combatVehicles.filter(vehicle =>
      !vehicle.dead && !vehicle.decoy && !vehicle.protected && !vehicle.optional);
    if (!remaining.length) {
      if (this.training.requireReturn) {
        this.egressRequired = true;
        const home = this.training.homeLabel || 'LAUNCH';
        this.radioCall(`RANGE CONTROL — ALL REQUIRED EFFECTS CONFIRMED. RETURN TO ${home}. FOLLOW HOME ARROW TO BLUE RING; THERMAL SHOWS THE HOT BEACON. BATTERY ${Math.round(this.battery)}%.`, 7000);
      }
      return;
    }
    const effect = killedLabels.length ? `${killedLabels.join(' + ')} DESTROYED. ` : '';
    const tactical = tacticalEffect ? `${tacticalEffect} ` : '';
    this.radioCall(`RANGE CONTROL — ${effect}${tactical}RETASK ${remaining[0].label}. ${remaining.length} REQUIRED TARGET${remaining.length === 1 ? '' : 'S'} REMAIN · ${this.bombs} BOMBS · BATTERY ${Math.round(this.battery)}%. RTB AFTER FINAL EFFECT.`, 6500);
  }

  prepareNextAirframe(readyReason = '') {
    this.detonated = false;
    this.cruise = null;
    this.stickAttitude = false;
    this.bodyRates?.set(0, 0, 0);
    this.standby = false;
    if (this.terminal) { this.terminal.target = null; this.terminal.candidate = null; this.terminal.hold = 0; }
    this.pos.copy(this.launch);
    this.pos.y += 1.7;
    this.yaw = this.launchYaw;
    const startSpeed = this.isFpvFamily
      ? this.startSpeed / this.metersPerUnit : this.startSpeed;
    this.vel.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(startSpeed);
    this.pitch = -0.05;
    this.roll = 0;
    this.payloadNadir = false;
    this.battery = this.startBattery;
    this.signal = 1;
    this.setThermalEnabled(false);
    this.thermalBurstRemaining = 0;
    this.thermalRechargeRemaining = 0;
    this.jamFactor = 1;
    this.linkLowTimer = 0;
    this.departedLaunchArea = false;
    this.armTimer = 1.2;
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.resetFiberCable();
    this.resetAttemptTelemetry();
    this.debriefPanel.style.display = 'none';
    for (const element of this.flightHudElements) element.style.display = '';
    for (const element of this.osdElements) element.style.visibility = '';
    this.help.style.display = 'none';
    if (this.canvas) this.canvas.style.filter = 'saturate(.62) contrast(1.14) brightness(.94)';
    this.readyPanel.querySelector('.fpv-review-kicker').textContent = readyReason
      ? 'BATTERY CHANGE // NEUTRAL RESET' : 'NEXT AIRFRAME';
    this.readyPanel.querySelector('.fpv-ready-title').textContent = readyReason
      || `AIRFRAME ${this.airframesLost + 1}/${this.airframes} READY`;
    this.readyPanel.style.display = 'block';
    // Paint the OSD and nav-aid once so the pad shows the real picture, not a black map.
    this.updateFpvOsd(0);
    this.attemptState = FPV_ATTEMPT.READY;
    this.attemptStateTime = 0;
  }

  updateAttemptState(dt, input) {
    this.attemptStateTime += dt;
    this.updateEffects(dt);
    if (this.attemptState === FPV_ATTEMPT.IMPACT_HOLD) {
      this.updateFpvOsd(dt);
      if (this.attemptStateTime >= 2.35) this.startAttemptReplay();
      return;
    }
    if (this.attemptState === FPV_ATTEMPT.REPLAY) {
      this.updateAttemptReplay(dt);
      return;
    }
    if (this.attemptState === FPV_ATTEMPT.DEBRIEF) {
      if (this.attemptStateTime < 0.8 || !(input.firePressed || input.breachPressed)) return;
      if (this.training.openRange) {
        if (input.breachPressed) this.advanceTrainingStage();
        else if (this.pendingMissionComplete || this.pendingMissionFailure || this.pendingRunReset) this.serveNewTargetSet();
        else this.prepareNextAirframe();
        return;
      }
      if (this.pendingMissionComplete) {
        this.complete = true;
        this.debriefPanel.style.display = 'none';
        this.onComplete?.();
      } else if (this.pendingMissionFailure) {
        this.failedOut = true;
        this.debriefPanel.style.display = 'none';
        this.onFailed?.(this.review?.reason || 'ALL AIRFRAMES EXPENDED');
      } else this.prepareNextAirframe();
      return;
    }
    if (this.attemptState === FPV_ATTEMPT.READY
      && this.attemptStateTime > 0.25 && (input.firePressed || input.breachPressed)) {
      // A stick-flown quad launches from the pad itself, not from the assisted law's 6 m
      // hover point: otherwise a radio with the throttle down drops it onto its own pad.
      if (this.mode === 'fpv' && !this.airStart && activeFlightMode() !== 'assist') {
        const ground = groundHeight(this.frameSolids || [], this.pos.x, this.pos.z, 0.12, this.pos.y + 0.05);
        const terrainY = droneTerrain ? droneTerrain(this.pos.x, this.pos.z) : 0;
        this.pos.y = Math.max(ground === -Infinity ? terrainY : ground, terrainY) + 0.66;
        this.vel.set(0, 0, 0);
      }
      this.readyPanel.style.display = 'none';
      this.help.style.display = '';
      this.attemptState = FPV_ATTEMPT.FLYING;
      this.attemptStateTime = 0;
      this.result.textContent = `AIRFRAME ${this.airframesLost + 1}/${this.airframes} AIRBORNE`;
      this.result.style.opacity = '1';
      clearTimeout(this.resultTimer);
      this.resultTimer = setTimeout(() => {
        if (!this.complete) this.result.style.opacity = '0';
      }, 1500);
    }
  }

  update(dt, input, solids) {
    // Kept for effects resolved outside this call chain (a detonation callback has no
    // solids parameter, but its cover check needs the world).
    this.frameSolids = solids;
    if (!this.active) return;
    if (this.isFpvFamily && this.attemptState !== FPV_ATTEMPT.FLYING) {
      this.updateAttemptState(dt, input);
      return;
    }
    if (this.frozen) {
      // Expended or lost: the feed is dead. Keep the explosion animating under the snow.
      this.updateEffects(dt);
      if (this.isFpvFamily) this.updateFpvOsd(dt);
      return;
    }
    // Flight-school freeze: the sim holds on the pad while a lesson card walks one
    // indicator. FIRE advances; the whole world (battery, timer, vehicles) waits.
    if (this.isFpvFamily && this.lessonQueue?.length) {
      if (!this.lessonActive) {
        this.lessonDelay -= dt;
        if (this.lessonDelay <= 0) this.showLesson();
      }
      if (this.lessonActive) {
        this.updateFpvOsd(0);
        if (input.reloadPressed) this.skipLessons();
        else if (input.firePressed || input.breachPressed) this.advanceLesson();
        return;
      }
    }
    this.flightTime += dt;
    this.missionFlightTime += dt;
    this.updateThermalBurst(dt, input);
    // Jamming degrades the CONTROL link too, not just the picture: inside a bubble the
    // stick response goes mushy before it dies. Legacy modes fly with a clean link.
    this.armTimer = Math.max(0, this.armTimer - dt);
    const control = this.isFpvFamily ? 0.3 + 0.7 * Math.max(this.signal, 0.05) : 1;
    // Flight law. Keyboard flies the assisted law below; analog sticks fly the FPV on a
    // real thrust-vector model (ANGLE self-levelling or ACRO rate mode). The payload hex is
    // a stabilized platform in every law, so sticks feed its assisted controls instead.
    const law = this.isFpvFamily ? activeFlightMode() : 'assist';
    const guided = !this.standby && this.updateTerminal(dt, input, solids);
    if (this.standby) {
      if (this.pilotInput(input)) this.wakeFromStandby();
    } else if (input.reloadPressed && this.isFpvFamily && this.landed && !this.lessonQueue?.length) {
      this.enterStandby();
    }
    if (guided) {
      if (this.cruise) this.cruise = null;
    } else if (this.cruise && !this.updateCruiseGate(input)) this.endCruise(this.cruiseEndReason);
    else if (!this.cruise && input.cruisePressed && this.isFpvFamily && !this.standby) this.startCruise();
    if (this.standby) {
      this.vel.set(0, 0, 0);
    } else if (guided) {
      // updateTerminal already flew the aircraft this frame.
    } else if (this.cruise) {
      this.flyCruise(dt);
    } else if (this.mode === 'fpv' && law !== 'assist') {
      if (!this.stickAttitude) this.beginStickAttitude();
      this.flyStickLaw(dt, law, control);
    } else {
      if (this.stickAttitude) this.endStickAttitude();
      this.flyAssisted(dt, this.assistedCommand(input, dt), control);
    }
    this.flightLaw = this.standby ? 'standby' : guided ? 'terminal' : this.cruise ? 'cruise' : law;
    this.updateCruiseHint(dt);

    this.next.copy(this.pos).addScaledVector(this.vel, dt);
    this.move.copy(this.next).sub(this.pos);
    const distance = this.move.length();
    if (distance > 0.001) {
      this.move.multiplyScalar(1 / distance);
      const hit = Math.min(
        raycastSolids(
          solids, this.pos.x, this.pos.y, this.pos.z,
          this.move.x, this.move.y, this.move.z, distance + 0.16),
        raycastSolids(
          droneFoliage, this.pos.x, this.pos.y, this.pos.z,
          this.move.x, this.move.y, this.move.z, distance + 0.16));
      const netHit = this.netBoxes.length
        ? raycastSolids(this.netBoxes, this.pos.x, this.pos.y, this.pos.z,
          this.move.x, this.move.y, this.move.z, distance + 0.16)
        : Infinity;
      if (netHit < distance + 0.16 && netHit <= hit) {
        this.netCatch(this.pos.clone().addScaledVector(this.move, Math.max(0, netHit - 0.05)));
        return;
      }
      if (hit > distance) this.pos.copy(this.next);
      else if (this.mode === 'fpv' && this.armTimer <= 0) {
        // An armed FPV does not bounce off a wall. Whatever it touches, it touches once.
        this.fpvDetonate(this.pos.clone().addScaledVector(this.move, Math.max(0, hit - 0.05)));
        return;
      } else if (this.mode === 'fpv') {
        // Still arming: the contact stops the aircraft dead instead of expending it.
        this.vel.set(0, 0, 0);
      } else this.vel.multiplyScalar(-0.18);
    }
    // The probe ceiling sits a hair above the airframe: only a solid whose top is
    // genuinely below the aircraft is ground under it — anything taller is a WALL or
    // a ROOF beside/over it. The old +1 margin (and even +0.25) let the floor clamp
    // ratchet the drone up the staggered trench parapets onto a blindage roof,
    // teleporting it out of the slot on top of its own target. Walls and ceilings
    // are the movement raycast's problem — an armed FPV that touches one detonates
    // there, which is the correct outcome.
    const ground = groundHeight(solids, this.pos.x, this.pos.z, 0.12, this.pos.y + 0.05);
    const terrainY = droneTerrain ? droneTerrain(this.pos.x, this.pos.z) : 0;
    // Without terrain the old flat-world datum (0) stands in; with it, the gully floor is
    // genuinely below datum and the drone may descend into it.
    const solidTop = ground === -Infinity ? (droneTerrain ? -1e9 : 0) : ground;
    const floor = Math.max(solidTop, terrainY) + 0.65;
    if (this.mode === 'fpv' && this.armTimer <= 0 && this.pos.y <= floor && this.vel.y < -2.2) {
      this.fpvDetonate(this.pos.clone().setY(floor - 0.4));
      return;
    }
    // Ceiling rides the ground under the aircraft: service height is above terrain, so a
    // rise does not silently eat the drone's working band.
    this.pos.y = Math.max(floor, Math.min(this.ceiling + Math.max(0, terrainY), this.pos.y));
    // The stick law has real gravity: resting on the ground (below detonation speed) is a
    // landing, so stop the fall and let skids drag instead of sliding forever.
    if (this.stickAttitude && this.pos.y <= floor + 0.001 && this.vel.y < 0) {
      this.vel.y = 0;
      const skid = Math.exp(-5 * dt);
      this.vel.x *= skid;
      this.vel.z *= skid;
    }
    this.landed = this.pos.y <= floor + 0.04 && Math.hypot(this.vel.x, this.vel.z) < 0.45
      && Math.abs(this.vel.y) < 0.6;
    // At the ceiling the climb is spent; drop the vertical speed so it does not bank up.
    if (this.pos.y >= this.ceiling + Math.max(0, terrainY) - 0.001 && this.vel.y > 0) this.vel.y = 0;
    if (this.updateFiberControl(dt)) return;

    const fromLaunch = this.pos.distanceTo(this.launch);
    const base = Math.max(0, Math.min(1, 1 - fromLaunch / this.maxRange));
    // Jammer bubbles. Radius grows with altitude: high and straight is line-of-sight to the
    // jammer, low along the treeline is terrain masking — the doctrine the mission teaches.
    this.jamFactor = 1;
    const droneAgl = this.pos.y - terrainY;
    for (const jammer of this.jammers) {
      if (!this.jammerLive(jammer)) continue;
      const reach = jammer.r * (0.55 + 0.45 * Math.min(1, Math.max(0, droneAgl) / 40));
      const d = Math.hypot(this.pos.x - jammer.x, this.pos.z - jammer.z);
      if (d < reach) {
        const signalFloor = Math.max(0, Math.min(0.95, jammer.signalFloor ?? 0));
        const falloff = Math.max(0.25, jammer.falloff ?? 1.4);
        let factor = signalFloor
          + (1 - signalFloor) * Math.pow(Math.max(0, d / reach), falloff);
        // Real terrain masking: if a ridge stands between the airframe and the jammer
        // mast, most of the jamming energy never arrives. Flying the gully IS the counter.
        if (droneTerrain && d > 24) {
          const mastY = droneTerrain(jammer.x, jammer.z) + 7;
          for (let s = 1; s < 10; s++) {
            const t = s / 10;
            const ly = this.pos.y + (mastY - this.pos.y) * t;
            if (droneTerrain(this.pos.x + (jammer.x - this.pos.x) * t,
              this.pos.z + (jammer.z - this.pos.z) * t) > ly + 1.2) {
              factor = Math.max(factor, 0.72);
              break;
            }
          }
        }
        this.jamFactor = Math.min(this.jamFactor, factor);
      }
    }
    // Fibre carries video and control over the paid-out line. RF jammers therefore do not
    // soften the sticks or picture; cable route, reserve and physical integrity replace
    // radio link quality as the failure problem.
    if (this.fiberControlled) this.jamFactor = 1;
    this.signal = this.fiberControlled ? 1 : base * this.jamFactor;
    if (this.definition.videoDegrade) {
      const degrade = this.definition.videoDegrade;
      const cycle = Math.max(1, degrade.cycle ?? 24);
      const phase = ((this.flightTime + (degrade.offset || 0)) % cycle) / cycle;
      const wave = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
      this.signal *= 1 - wave * Math.max(0, Math.min(0.85, degrade.strength ?? 0.48));
    }
    this.battery = Math.max(0, this.battery - dt * this.currentBatteryDrainRate());
    if (this.mode === 'bomber' && this.training.requireReturn) {
      const homeDistance = Math.round(this.pos.distanceTo(this.launch) * this.metersPerUnit);
      if (this.battery <= 20 && !this.batteryCall20) {
        this.batteryCall20 = true;
        this.radioCall(`RANGE CONTROL — BATTERY ${Math.round(this.battery)}%. HOME ${homeDistance} M. RETURN NOW UNLESS THE FINAL EFFECT IS IMMEDIATE.`, 6000);
      } else if (this.battery <= 30 && !this.batteryCall30) {
        this.batteryCall30 = true;
        this.radioCall(`RANGE CONTROL — BATTERY ${Math.round(this.battery)}%. HOME ${homeDistance} M. PROTECT THE RETURN RESERVE.`, 5200);
      }
    }
    if (this.isFpvFamily) {
      // Analog fails soft, but it still fails: hold a dead link too long and the aircraft
      // is gone. The timer is the pilot's chance to dive out of the bubble.
      if (this.signal <= 0.1) this.linkLowTimer += dt; else this.linkLowTimer = 0;
      const linkLossGrace = this.training.linkLossGrace ?? 1.7;
      // A locked machine-vision seeker needs no link for the last stretch: the pilot watches
      // snow and waits for the result. Without a lock, a dead link is a lost aircraft.
      if (this.linkLowTimer > linkLossGrace && !this.terminal.target) {
        this.loseAirframe('LINK LOST IN THE BUBBLE');
        return;
      }
      if (this.battery <= 0) { this.loseAirframe('BATTERY FLAT'); return; }
    } else if (this.signal <= 0.02 || this.battery <= 0) this.resetAircraft();

    this.camera.position.copy(this.pos);
    this.camera.rotation.order = 'YXZ';
    // Small deterministic motor/prop vibration sells a camera bolted to a carbon frame
    // without moving collision rays or turning the simulated aircraft into a random walk.
    const vibration = this.cameraVibration;
    const vibrationLoad = 0.35 + 0.65 * Math.min(1, this.vel.length() / this.worldMaxSpeed);
    const buzzPitch = Math.sin(this.flightTime * 91) * vibration * vibrationLoad;
    const buzzYaw = Math.sin(this.flightTime * 67 + 1.7) * vibration * vibrationLoad * 0.55;
    const buzzRoll = Math.sin(this.flightTime * 113 + 0.4) * vibration * vibrationLoad * 0.8;
    if (this.stickAttitude) {
      this.camera.quaternion.copy(this.cameraAttitude);
      this.camera.rotateX(buzzPitch);
      this.camera.rotateY(buzzYaw);
      this.camera.rotateZ(buzzRoll);
    } else {
      this.camera.rotation.set(this.pitch + buzzPitch, this.yaw + buzzYaw, this.roll + buzzRoll);
    }

    this.recordAttemptTelemetry(dt, solids);
    if (this.isFpvFamily && this.training.allowAbort && input.breachPressed) {
      this.beginAttemptReview('MISSION ABORTED — AIRFRAME RECOVERED', {
        effect: 'ABORTED', impact: this.pos.clone(), expended: false, aborted: true,
        missionComplete: !!this.training.abortCompletes,
      });
      return;
    }

    this.incomingPressure = Math.max(0, this.incomingPressure - dt * 1.8);
    if (this.mode === 'strike' && !this.strikeCleanup) {
      this.updateArtilleryDefence(dt, solids);
    }
    if (this.isFpvFamily) {
      this.updateTrenchCover(dt);
      this.updateInfantryDefence(dt, solids);
    }
    if (this.mode === 'strike' && this.strikeCleanup) this.updateStrikeSquirters(dt, solids);
    this.updateThermalSignatures();
    this.updateTargetBoxes();
    this.updatePopulation(dt);
    for (const model of this.targetModels) model?.userData.update?.(dt);
    this.updateMunitions(dt, solids);
    this.updateEffects(dt);

    if (this.isFpvFamily) {
      this.updateFpvFamily(dt, input, solids);
      return;
    }

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
      const inside = this.combatants.filter(actor =>
        !actor.dead && !actor.surrendered && actor.droneInteriorFloor
        && Math.abs(actor.pos.x) < 8 && actor.pos.z > -17 && actor.pos.z < -3).length;
      const tracksInterior = this.combatants.some(actor => actor.droneInteriorFloor);
      if (input.breachPressed && liveCount > 0 && !this.complete) {
        this.complete = true;
        this.result.textContent = `HANDOFF // ${liveCount} SURVIVORS JOINING GROUND FIGHT`;
        this.result.style.opacity = '1';
        this.status.textContent += `\nHANDOFF ${liveCount} LIVE`;
        this.completionTimer = setTimeout(() => this.onComplete?.(), 300);
        return;
      }
      if (inside >= this.droneInteriorThreshold && !this.complete) {
        this.complete = true;
        this.result.textContent = 'ASSAULT ELEMENT INSIDE // SWITCHING TO SUPPORT STRIKE';
        this.result.style.opacity = '1';
        this.status.textContent += `\n${inside} TROOPS INSIDE TOWER // GROUND FIGHT REMAINS`;
        return;
      }
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
        ...(tracksInterior ? [`TOWER ENTRY ${inside}/${this.droneInteriorThreshold}`] : []),
        this.thermalStatus(),
        ...(this.incomingPressure > 0.05 ? ['INCOMING FIRE // KEEP MOVING'] : []),
        ...(liveCount <= 4 ? [track] : []),
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

    if (this.mode === 'strike' && this.strikeCleanup) {
      if (this.help) {
        this.help.textContent = 'WASD FLIGHT · MOUSE/ARROWS LOOK · RMB/Z CLIMB · CTRL/C DESCEND · FIRE RIFLE · G FRAG · N EO/THERMAL';
      }
      this.rifleCooldown = Math.max(0, this.rifleCooldown - dt);
      if (input.fire && this.rifleRounds > 0 && this.rifleCooldown <= 0) {
        this.fireRifle(solids);
        this.rifleCooldown = 0.095;
      }
      if (input.nadePressed && this.grenadeRounds > 0) this.launchGrenade();
      const live = this.strikeSquirters.filter(actor => !actor.dead);
      this.lock.textContent = live.length
        ? 'SQUIRTERS // RIFLE HOT' : 'GUN CREWS NEUTRALIZED';
      this.status.textContent = [
        `LINK ${Math.round(this.signal * 100)}%`,
        `BAT ${Math.round(this.battery)}%`,
        `GUNS ${this.targets.filter(target => target.marked).length}/${this.targets.length}`,
        `SQUIRTERS ${live.length}/${this.strikeSquirters.length}`,
        `RIFLE ${this.rifleRounds}/72`,
        `FRAG ${this.grenadeRounds}/6`,
        this.thermalStatus(),
        ...(this.incomingPressure > 0.05 ? ['INCOMING FIRE // KEEP MOVING'] : []),
      ].join('\n');
      this.overlay.style.opacity = String(0.72 + this.signal * 0.28);
      if (!live.length && this.strikeSquirters.length && !this.complete) {
        this.complete = true;
        this.status.textContent += '\nBATTERY NEUTRALIZED';
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
      const crewCleanup = this.mode === 'strike'
        && this.targets.some(target => (target.squirters || 0) > 0);
      if (crewCleanup) {
        const squirters = this.spawnStrikeSquirters();
        this.result.textContent = `GUNS SILENT // ${squirters.length} CREW FLEEING`;
        this.result.style.opacity = '1';
      } else {
        this.complete = true;
        this.status.textContent += this.mode === 'strike' ? '\nSTRIKE COMPLETE' : '\nUPLOAD COMPLETE';
      }
      if (this.mode !== 'strike') {
        this.result.textContent = this.resultText;
        this.result.style.opacity = '1';
      }
      if (this.complete) this.completionTimer = setTimeout(() => this.onComplete?.(), 650);
    }
  }

  // Keyboard/mouse (or sticks in the assisted law) reduced to one command shape.
  assistedCommand(input, dt) {
    if (this.isFpvFamily && sticks.active) {
      const throttle = sticks.sprung ? sticks.throttle : (sticks.throttle - 0.5) * 2;
      const lift = Math.abs(throttle) < 0.12 ? 0 : throttle;
      return {
        // Full yaw stick ~ 95 deg/s; gimbal stick ~ 60 deg/s of camera tilt.
        lookX: sticks.yaw * 1.66 * dt / 0.72,
        lookY: -sticks.gimbal * 1.05 * dt / 0.62,
        moveX: sticks.roll,
        moveY: -sticks.pitch,
        climb: Math.max(0, lift),
        descend: Math.max(0, -lift),
      };
    }
    return {
      lookX: input.lookDelta.x,
      lookY: input.lookDelta.y,
      moveX: input.move.x,
      moveY: input.move.y,
      climb: (input.desktopAltitude ? input.droneClimb : input.ads) ? 1 : 0,
      descend: (input.desktopAltitude ? input.droneDescend : input.crouch) ? 1 : 0,
    };
  }

  flyAssisted(dt, cmd, control) {
    this.yaw -= cmd.lookX * 0.72 * control;
    const minimumPitch = this.mode === 'bomber' ? -Math.PI / 2 : -1.15;
    this.pitch = Math.max(minimumPitch, Math.min(0.72, this.pitch - cmd.lookY * 0.62 * control));
    if (this.mode === 'bomber') {
      const lockAngle = this.payloadNadir ? -76 : -80;
      this.payloadNadir = this.pitch * 180 / Math.PI <= lockAngle;
    }
    // The FPV camera is fixed to the airframe: lateral input banks the entire horizon.
    // The payload platform is gimballed and therefore remains deliberately steadier.
    const bank = this.mode === 'bomber' ? 0.1 : 0.58;
    this.roll += ((-cmd.moveX * bank) - this.roll) * Math.min(1, dt * 6);

    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.horizontalForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const thrust = -cmd.moveY;
    // The Heron's payload camera is a gimbal, not the aircraft's nose. Looking down must
    // never turn W into a descent command; horizontal translation and camera angle remain
    // independent at every gimbal angle. FPV retains camera-coupled acro flight.
    const thrustDirection = this.mode === 'bomber' ? this.horizontalForward : this.forward;
    this.vel.addScaledVector(thrustDirection, thrust * this.worldAccel * control * dt);
    this.vel.addScaledVector(this.right, cmd.moveX * this.worldAccel * 0.58 * control * dt);
    if (cmd.climb) this.vel.y += (this.isFpvFamily ? 10 / this.metersPerUnit : 10) * control * cmd.climb * dt;
    if (cmd.descend) this.vel.y -= (this.isFpvFamily ? 9 / this.metersPerUnit : 9) * cmd.descend * dt;
    // A stabilized bomber captures altitude as soon as the vertical control is released.
    // This applies outside nadir lock too; the camera's gimbal angle cannot disable it.
    if (this.mode === 'bomber' && !cmd.climb && !cmd.descend) this.vel.y *= Math.exp(-8 * dt);
    const damping = Math.exp(-1.45 * dt);
    this.vel.multiplyScalar(damping);
    if (this.vel.length() > this.worldMaxSpeed) this.vel.setLength(this.worldMaxSpeed);
  }

  // ---- Stick flight: a thrust-vector quad, the model every FPV trainer flies ----
  // Attitude is a full quaternion (ACRO flips are legal). Thrust acts along the frame's up
  // axis against real gravity and quadratic drag, all in metres, converted to map units at
  // the end. The camera is bolted to the frame with uptilt, so forward speed means the frame
  // pitches down and the picture shows it: exactly why FPV cameras are tilted up.
  beginStickAttitude() {
    const uptilt = controls().uptilt * DEG;
    STICK_EULER.set(Math.max(-1.2, this.pitch - uptilt), this.yaw, this.roll, 'YXZ');
    this.attitude.setFromEuler(STICK_EULER);
    this.heading = this.yaw;
    this.bodyRates.set(0, 0, 0);
    this.stickAttitude = true;
  }

  endStickAttitude() {
    this.stickAttitude = false;
    this.roll = 0;
  }

  flyStickLaw(dt, law, control) {
    const cfg = controls();
    const mpu = this.metersPerUnit;
    const twr = this.definition.thrustToWeight ?? 3.2;
    if (law === 'acro') {
      const rate = (x, centre, max) => Math.sign(x)
        * (centre * Math.abs(x) + (max - centre) * Math.abs(x) ** 3) * DEG;
      STICK_RATES.set(
        -rate(sticks.pitch, cfg.centerRate, cfg.maxRate),
        -rate(sticks.yaw, cfg.yawCenterRate, cfg.yawMaxRate),
        -rate(sticks.roll, cfg.centerRate, cfg.maxRate),
      ).multiplyScalar(control);
      // A tuned quad tracks its rate setpoint in a few tens of milliseconds.
      this.bodyRates.lerp(STICK_RATES, 1 - Math.exp(-dt / 0.035));
      const angle = this.bodyRates.length() * dt;
      if (angle > 1e-6) {
        STICK_AXIS.copy(this.bodyRates).normalize();
        STICK_DELTA.setFromAxisAngle(STICK_AXIS, angle);
        this.attitude.multiply(STICK_DELTA).normalize();
      }
    } else {
      const shape = x => x * 0.72 + x ** 3 * 0.28;
      const limit = cfg.angleLimit * DEG;
      const yawRate = (cfg.yawCenterRate * Math.abs(sticks.yaw)
        + (cfg.yawMaxRate - cfg.yawCenterRate) * Math.abs(sticks.yaw) ** 3) * DEG;
      this.heading -= Math.sign(sticks.yaw) * yawRate * control * dt;
      STICK_EULER.set(-shape(sticks.pitch) * limit * control, this.heading,
        -shape(sticks.roll) * limit * control, 'YXZ');
      STICK_TARGET.setFromEuler(STICK_EULER);
      this.attitude.slerp(STICK_TARGET, 1 - Math.exp(-dt * 13));
    }
    STICK_UP.set(0, 1, 0).applyQuaternion(this.attitude);
    const g = 9.81;
    const maxThrust = twr * g;
    let thrust;
    if (sticks.sprung) {
      // Self-centring throttle (pad, Touch): centre is hover. ANGLE also compensates for
      // tilt so a level-flight push holds altitude: the altitude-hold every pad sim adds.
      const hover = law === 'angle' ? g / Math.max(0.42, STICK_UP.y) : g;
      thrust = sticks.throttle >= 0
        ? hover + (maxThrust - hover) * sticks.throttle
        : hover * (1 + sticks.throttle * 0.9);
    } else {
      thrust = sticks.throttle * maxThrust;
    }
    thrust = Math.max(0, Math.min(maxThrust, thrust)) * (0.55 + 0.45 * control);
    // Quadratic drag sized so full throttle at 45 deg of pitch runs at the airframe's top
    // speed; a small linear term keeps the hover from feeling like ice.
    const top = this.stickTopSpeed;
    const kq = maxThrust * Math.sin(45 * DEG) / (top * top);
    STICK_VEL.copy(this.vel).multiplyScalar(mpu);
    const speed = STICK_VEL.length();
    STICK_ACCEL.copy(STICK_UP).multiplyScalar(thrust);
    STICK_ACCEL.y -= g;
    STICK_ACCEL.addScaledVector(STICK_VEL, -(0.06 + kq * speed));
    this.vel.addScaledVector(STICK_ACCEL, dt / mpu);
    const cap = top * 1.25 / mpu;
    if (this.vel.length() > cap) this.vel.setLength(cap);
    this.syncStickCamera();
  }

  // Derive the legacy attitude fields (OSD heading, telemetry, aim tests) from the frame.
  syncStickCamera() {
    STICK_CAMERA.copy(this.attitude).multiply(
      STICK_DELTA.setFromAxisAngle(X_AXIS, controls().uptilt * DEG));
    this.cameraAttitude.copy(STICK_CAMERA);
    this.forward.set(0, 0, -1).applyQuaternion(STICK_CAMERA);
    STICK_BODY_FWD.set(0, 0, -1).applyQuaternion(this.attitude);
    // Straight-down or inverted frames fall back to the up vector for heading.
    if (Math.hypot(STICK_BODY_FWD.x, STICK_BODY_FWD.z) < 0.15) {
      STICK_BODY_FWD.set(0, 1, 0).applyQuaternion(this.attitude).negate();
    }
    this.yaw = Math.atan2(-STICK_BODY_FWD.x, -STICK_BODY_FWD.z);
    if (this.mode === 'fpv') this.heading = this.cruise ? this.yaw : this.heading;
    this.horizontalForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    STICK_EULER.setFromQuaternion(STICK_CAMERA, 'YXZ');
    this.pitch = STICK_EULER.x;
    this.roll = STICK_EULER.z;
  }

  // ---- CRUISE: the transit autopilot ----
  // Long-range crews do not hand-fly the empty ingress. The aircraft flies the briefed leg
  // to the search area at cruise speed while the sim runs time-compressed; the battery
  // still drains at the true rate. Anything tactical hands the sticks straight back.
  cruiseAvailability() {
    if (!this.isFpvFamily || this.attemptState !== FPV_ATTEMPT.FLYING) return 'NOT AIRBORNE';
    // The fibre course is a hand-flown cable lesson; an open fibre sortie may cruise its transit.
    if (this.fiberControlled && this.training.fiberRoute?.length) return 'FIBRE: HAND-FLY THE CABLE ROUTE';
    if (this.lessonQueue?.length) return 'LESSON IN PROGRESS';
    if (this.signal < 0.6) return 'LINK TOO WEAK FOR AUTOPILOT';
    if (this.battery < 25) return 'BATTERY TOO LOW';
    if (this.incomingPressure > 0.05) return 'UNDER FIRE';
    if (this.egressRequired) return null;
    if (!this.searchBox) return 'NO BRIEFED SEARCH AREA';
    if (this.inSearchBox(this.pos)) return 'ALREADY IN THE SEARCH AREA';
    if (this.hostileContactWithin(this.cruiseContactRange)) return 'HOSTILE CONTACT CLOSE';
    return null;
  }

  inSearchBox(p, pad = 0) {
    const b = this.searchBox;
    return !!b && p.x > b.x1 - pad && p.x < b.x2 + pad && p.z > b.z1 - pad && p.z < b.z2 + pad;
  }

  // `movingOnly`: traffic that has actually set off (the standby wake). Otherwise every
  // hostile except optional static teams: a dug-in trench garrison is scenery to the
  // autopilot, and its ground fire already ends CRUISE through incomingPressure.
  hostileContactWithin(range, movingOnly = false) {
    const r2 = range * range;
    return this.combatVehicles.some(vehicle => !vehicle.dead && !vehicle.protected
      && vehicle.hostile !== false && !vehicle.exited
      && (movingOnly
        ? vehicle.route?.length > 0 && this.missionFlightTime >= (vehicle.startAt || 0)
        : !(vehicle.optional && !vehicle.route?.length))
      && (vehicle.pos.x - this.pos.x) ** 2 + (vehicle.pos.z - this.pos.z) ** 2 < r2);
  }

  startCruise() {
    const blocked = this.cruiseAvailability();
    if (blocked) { this.radioCall(`CRUISE UNAVAILABLE: ${blocked}`, 2600); return false; }
    const home = this.egressRequired;
    const waypoints = [];
    if (home) {
      waypoints.push(new THREE.Vector3(this.launch.x, 0, this.launch.z));
    } else {
      // Follow the briefed low route while it still leads toward the box, then the box.
      const route = (this.definition.minimap?.route || []).map(([x, z]) => new THREE.Vector3(x, 0, z));
      const b = this.searchBox;
      const centre = new THREE.Vector3((b.x1 + b.x2) / 2, 0, (b.z1 + b.z2) / 2);
      const toBox = Math.hypot(centre.x - this.pos.x, centre.z - this.pos.z);
      for (const point of route) {
        const ahead = Math.hypot(centre.x - point.x, centre.z - point.z) < toBox - 10;
        const away = Math.hypot(point.x - this.pos.x, point.z - this.pos.z) > 20;
        if (ahead && away && !this.inSearchBox(point)) waypoints.push(point);
      }
      waypoints.push(centre);
    }
    this.cruise = { waypoints, index: 0, home, elapsed: 0 };
    if (this.stickAttitude) this.heading = this.yaw;
    this.radioCall(home
      ? `CRUISE: AUTOPILOT RTB TO ${this.training.homeLabel || 'LZ'}. ANY STICK TAKES CONTROL.`
      : `CRUISE: AUTOPILOT TO THE SEARCH AREA, ${waypoints.length} LEG${waypoints.length > 1 ? 'S' : ''}. ANY STICK TAKES CONTROL.`, 3200);
    return true;
  }

  // Returns false (and records why) when the autopilot must hand back control.
  updateCruiseGate(input) {
    const reason = (() => {
      if (input.cruisePressed) return 'PILOT';
      const keyed = Math.abs(input.move.x) + Math.abs(input.move.y) > 0.2
        || Math.abs(input.lookDelta.x) + Math.abs(input.lookDelta.y) > 0.002
        || input.droneClimb || input.droneDescend || input.firePressed;
      if (keyed || sticks.moved) return 'PILOT';
      if (this.signal < 0.55) return 'JAMMING';
      if (this.incomingPressure > 0.05) return 'UNDER FIRE';
      if (this.fiberWarning) return 'CABLE';
      if (this.battery < 22 && !this.cruise.home) return 'BATTERY';
      if (!this.cruise.home && this.inSearchBox(this.pos)) return 'SEARCH AREA';
      if (!this.cruise.home && this.hostileContactWithin(this.cruiseContactRange)) return 'CONTACT';
      return null;
    })();
    this.cruiseEndReason = reason;
    return !reason;
  }

  endCruise(reason = 'PILOT') {
    if (!this.cruise) return;
    this.cruise = null;
    if (this.stickAttitude) this.heading = this.yaw;
    const text = {
      PILOT: 'CRUISE OFF: PILOT HAS CONTROL',
      JAMMING: 'CRUISE OFF: JAMMING. YOU HAVE CONTROL.',
      'UNDER FIRE': 'CRUISE OFF: UNDER FIRE. YOU HAVE CONTROL.',
      CABLE: 'CRUISE OFF: CABLE WARNING.',
      BATTERY: 'CRUISE OFF: BATTERY RESERVE. YOU HAVE CONTROL.',
      'SEARCH AREA': 'CRUISE OFF: ENTERING THE SEARCH AREA. YOU HAVE CONTROL.',
      CONTACT: 'CRUISE OFF: CONTACT AHEAD. YOU HAVE CONTROL.',
      ARRIVED: 'CRUISE OFF: OVERHEAD THE LZ. BRING IT IN.',
    }[reason] || `CRUISE OFF: ${reason}`;
    this.radioCall(text, 2800);
  }

  flyCruise(dt) {
    const c = this.cruise;
    c.elapsed += dt;
    let wp = c.waypoints[c.index];
    if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < (c.home ? 10 : 18)) {
      if (c.index < c.waypoints.length - 1) wp = c.waypoints[++c.index];
      else { this.endCruise(c.home ? 'ARRIVED' : 'SEARCH AREA'); return; }
    }
    const mpu = this.metersPerUnit;
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const dirX = dx / len, dirZ = dz / len;
    // Terrain-following transit height, looking ahead so a rise is climbed early.
    const terrainAt = (x, z) => (droneTerrain ? droneTerrain(x, z) : 0);
    let ground = terrainAt(this.pos.x, this.pos.z);
    for (const ahead of [12, 24, 40]) {
      ground = Math.max(ground, terrainAt(this.pos.x + dirX * ahead, this.pos.z + dirZ * ahead));
    }
    const agl = Math.min(this.ceiling - 1.5, (c.home ? 34 : 30) / mpu);
    const targetY = ground + agl;
    const speed = this.cruiseSpeed / mpu;
    const blend = 1 - Math.exp(-dt * 1.6);
    this.vel.x += (dirX * speed - this.vel.x) * blend;
    this.vel.z += (dirZ * speed - this.vel.z) * blend;
    this.vel.y = Math.max(-4 / mpu, Math.min(5 / mpu, (targetY - this.pos.y) * 1.3));
    // Turn the aircraft onto the leg; the camera shows a cruise attitude, nose on the track.
    let turn = Math.atan2(-dirX, -dirZ) - this.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const yaw = this.yaw + turn * Math.min(1, dt * 2.2);
    const bank = Math.max(-0.5, Math.min(0.5, -turn * 0.8));
    if (this.stickAttitude) {
      STICK_EULER.set(-28 * DEG, yaw, this.mode === 'fpv' ? bank : 0, 'YXZ');
      STICK_TARGET.setFromEuler(STICK_EULER);
      this.attitude.slerp(STICK_TARGET, 1 - Math.exp(-dt * 6));
      this.syncStickCamera();
      this.heading = this.yaw;
    } else {
      this.yaw = yaw;
      const cruisePitch = this.mode === 'bomber' ? Math.min(this.pitch, -0.35) : -0.12;
      this.pitch += (cruisePitch - this.pitch) * Math.min(1, dt * 2);
      this.roll += ((this.mode === 'fpv' ? bank * 0.6 : 0) - this.roll) * Math.min(1, dt * 4);
      const cp = Math.cos(this.pitch);
      this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
      this.horizontalForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    }
  }

  // One-time coaching: a pilot hand-flying a long empty transit hears about CRUISE once.
  updateCruiseHint(dt) {
    if (this.cruiseHinted || this.cruise || !this.isFpvFamily || !this.searchBox) return;
    this.cruiseHintClock = (this.cruiseHintClock || 0) + dt;
    if (this.cruiseHintClock < 12) return;
    this.cruiseHintClock = 6;
    let seen = false;
    try { seen = !!localStorage.getItem('bp-cruise-hint'); } catch { seen = false; }
    if (seen) { this.cruiseHinted = true; return; }
    const b = this.searchBox;
    const far = Math.hypot(this.pos.x - (b.x1 + b.x2) / 2, this.pos.z - (b.z1 + b.z2) / 2) > 220;
    if (!far || this.cruiseAvailability()) return;
    this.cruiseHinted = true;
    try { localStorage.setItem('bp-cruise-hint', '1'); } catch { /* private mode */ }
    const key = sticks.active ? { gamepad: 'RB', xr: 'X', radio: 'YOUR CRUISE SWITCH' }[sticks.source] || 'T' : 'T';
    this.radioCall(`RANGE CONTROL: LONG EMPTY TRANSIT. PRESS ${key} FOR CRUISE AND THE AUTOPILOT FLIES IT AT 4x. ANY STICK TAKES IT BACK.`, 5200);
  }

  // Sim-time multiplier the main loop applies while the autopilot flies the transit.
  get timeCompression() {
    if (this.cruise) return this.cruiseCompression;
    // A landed ambush waits in compressed time until something moves inside wake range.
    if (this.standby && !this.hostileContactWithin(this.standbyWakeRange, true)) return this.standbyCompression;
    return 1;
  }

  // ---- Terminal guidance (machine vision, last mile) ----
  lockAimPoint(vehicle, out = new THREE.Vector3()) {
    // The seeker tracks the hull's visual centre; on a turtle that is the gap under the skirts.
    const lift = vehicle.kind === 'parkedfpv' ? 0.12
      : vehicle.kind === 'infantry' ? 0.9 : vehicle.kind === 'ugv' ? 0.5
        : vehicle.kind === 'turtle' ? 0.7 : 1.05;
    out.copy(vehicle.pos);
    out.y += lift;
    return out;
  }

  updateTerminal(dt, input, solids) {
    const t = this.terminal;
    if (!this.terminalGuidance || this.mode !== 'fpv') return false;
    const fireHeld = !!(input.fire || input.stickFire);
    if (t.target) {
      if (!fireHeld) t.armedRelease = true;
      if (t.target.dead) { this.releaseLock(null); return false; }
      if (t.armedRelease && input.firePressed) { this.releaseLock('LOCK RELEASED: PILOT HAS CONTROL'); return false; }
      const aim = this.lockAimPoint(t.target, LOCK_AIM);
      if (!hasLOS(solids, this.pos.x, this.pos.y, this.pos.z, aim.x, aim.y, aim.z)) {
        t.masked += dt;
        if (t.masked > 0.6) { this.releaseLock('LOCK LOST: TARGET MASKED'); return false; }
      } else t.masked = 0;
      this.flyTerminal(dt, t.target, aim);
      return true;
    }
    t.candidate = null;
    if (!fireHeld) { t.hold = 0; return false; }
    let best = null;
    let bestDot = Math.cos(8 * DEG);
    for (const vehicle of this.combatVehicles) {
      if (vehicle.dead || vehicle.protected || vehicle.hostile === false || vehicle.exited) continue;
      const aim = this.lockAimPoint(vehicle, LOCK_AIM);
      this.to.copy(aim).sub(this.pos);
      const range = this.to.length();
      if (range > this.lockRange || range < 1) continue;
      const dot = this.forward.dot(this.to.multiplyScalar(1 / range));
      if (dot <= bestDot) continue;
      if (!hasLOS(solids, this.pos.x, this.pos.y, this.pos.z, aim.x, aim.y, aim.z)) continue;
      bestDot = dot;
      best = vehicle;
    }
    t.candidate = best;
    if (!best) { t.hold = 0; return false; }
    t.hold += dt;
    if (t.hold >= 0.55) {
      t.target = best;
      t.candidate = null;
      t.hold = 0;
      t.masked = 0;
      t.armedRelease = false;
      this.radioCall(`TERMINAL LOCK: ${best.label || 'TARGET'}. SEEKER FLIES THE LAST STRETCH. TAP FIRE TO CANCEL.`, 2600);
    }
    return false;
  }

  releaseLock(message) {
    this.terminal.target = null;
    this.terminal.hold = 0;
    if (message) this.radioCall(message, 2200);
  }

  // Proportional pursuit with a lead on the target's own motion.
  flyTerminal(dt, target, aim) {
    const mpu = this.metersPerUnit;
    const speed = this.stickTopSpeed * 0.85 / mpu;
    this.to.copy(aim).sub(this.pos);
    const range = this.to.length();
    if (target.velocity) this.to.addScaledVector(target.velocity, Math.min(2.5, range / speed));
    this.to.normalize();
    this.vel.lerp(this.to.multiplyScalar(speed), 1 - Math.exp(-dt * 3.5));
    const dir = LOCK_DIR.copy(this.vel).normalize();
    const yaw = Math.atan2(-dir.x, -dir.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    if (this.stickAttitude) {
      STICK_EULER.set(pitch - controls().uptilt * DEG, yaw, 0, 'YXZ');
      STICK_TARGET.setFromEuler(STICK_EULER);
      this.attitude.slerp(STICK_TARGET, 1 - Math.exp(-dt * 9));
      this.syncStickCamera();
      this.heading = this.yaw;
    } else {
      this.yaw = yaw;
      this.pitch = pitch;
      this.roll += (0 - this.roll) * Math.min(1, dt * 6);
      const cp = Math.cos(this.pitch);
      this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
      this.horizontalForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    }
  }

  // ---- Landed standby ----
  pilotInput(input) {
    const keyed = Math.abs(input.move.x) + Math.abs(input.move.y) > 0.2
      || Math.abs(input.lookDelta.x) + Math.abs(input.lookDelta.y) > 0.002
      || input.droneClimb || input.droneDescend || input.firePressed || input.reloadPressed;
    const radioThrottle = sticks.active && !sticks.sprung && sticks.throttle > 0.18;
    return keyed || sticks.moved || radioThrottle;
  }

  enterStandby() {
    this.standby = true;
    this.standbyAlerted = false;
    this.cruise = null;
    this.vel.set(0, 0, 0);
    this.radioCall('STANDBY: MOTORS SAFE, CAMERA ON. TIME RUNS FAST UNTIL SOMETHING MOVES. ANY INPUT WAKES IT.', 3200);
  }

  wakeFromStandby() {
    this.standby = false;
    this.radioCall('MOTORS SPOOLING: AIRCRAFT LIVE', 1600);
  }

  // ---- Anti-drone netting ----
  // Each net is an axis-aligned road segment: two side walls and a roof on posts, with
  // authored tears (fractions along the run) where shelling opened the roof. The ends are
  // open: vehicles drive in and out, and so can a pilot good enough to fly the tunnel.
  buildNets(nets) {
    const root = new THREE.Group();
    root.name = 'anti-drone-nets';
    const texture = netTexture();
    const netMaterial = new THREE.MeshStandardMaterial({
      name: 'anti-drone-net', color: 0x5a6150, map: texture, alphaMap: texture,
      transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1, metalness: 0,
      depthWrite: false,
    });
    const postMaterial = new THREE.MeshStandardMaterial({ name: 'anti-drone-net-post', color: 0x3b3328, roughness: 0.95 });
    const postGeometry = new THREE.BoxGeometry(0.16, 1, 0.16);
    const ground = (x, z) => (droneTerrain ? droneTerrain(x, z) : 0);
    for (const net of nets) {
      const [ax, az] = net.from, [bx, bz] = net.to;
      const alongX = Math.abs(bx - ax) >= Math.abs(bz - az);
      const length = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
      const half = net.halfWidth ?? 5;
      const height = net.height ?? 5.5;
      const segment = 8;
      const count = Math.max(1, Math.round(length / segment));
      const tears = net.tears || [];
      const torn = t => tears.some(([t0, t1]) => t >= t0 && t <= t1);
      for (let i = 0; i < count; i++) {
        const t0 = i / count, t1 = (i + 1) / count, tm = (t0 + t1) / 2;
        const cx = ax + (bx - ax) * tm, cz = az + (bz - az) * tm;
        const gy = ground(cx, cz);
        const segLength = length / count;
        const roofTorn = torn(tm);
        // Roof panel (or the hole where one was).
        if (!roofTorn) {
          const roof = new THREE.Mesh(new THREE.PlaneGeometry(alongX ? segLength : half * 2, alongX ? half * 2 : segLength), netMaterial);
          roof.rotation.x = -Math.PI / 2;
          roof.position.set(cx, gy + height, cz);
          root.add(roof);
          this.netBoxes.push(alongX
            ? makeNetBox(cx, gy + height, cz, segLength, 0.3, half * 2)
            : makeNetBox(cx, gy + height, cz, half * 2, 0.3, segLength));
        } else {
          // Shredded edges hang into the gap so the tear reads from above and from the road.
          for (const side of [-1, 1]) {
            const rag = new THREE.Mesh(new THREE.PlaneGeometry(alongX ? segLength * 0.8 : 1.6, alongX ? 1.6 : segLength * 0.8), netMaterial);
            rag.rotation.x = -Math.PI / 2 + side * 0.7;
            rag.position.set(cx + (alongX ? 0 : side * half * 0.85), gy + height - 0.5, cz + (alongX ? side * half * 0.85 : 0));
            root.add(rag);
          }
        }
        for (const side of [-1, 1]) {
          const wx = alongX ? cx : cx + side * half;
          const wz = alongX ? cz + side * half : cz;
          const wall = new THREE.Mesh(new THREE.PlaneGeometry(segLength, height), netMaterial);
          wall.position.set(wx, gy + height / 2, wz);
          if (!alongX) wall.rotation.y = Math.PI / 2;
          root.add(wall);
          this.netBoxes.push(alongX
            ? makeNetBox(wx, gy + height / 2, wz, segLength, height, 0.3)
            : makeNetBox(wx, gy + height / 2, wz, 0.3, height, segLength));
          const post = new THREE.Mesh(postGeometry, postMaterial);
          const px = alongX ? ax + (bx - ax) * t0 : wx;
          const pz = alongX ? wz : az + (bz - az) * t0;
          post.scale.y = height + 0.4;
          post.position.set(px, ground(px, pz) + (height + 0.4) / 2, pz);
          root.add(post);
        }
      }
    }
    this.scene.add(root);
    this.netRoot = root;
  }

  netCatch(point) {
    if (this.attemptState !== FPV_ATTEMPT.FLYING) return;
    this.createImpactEffect(point, this.airframesLost + 31);
    this.loseAirframe(this.mode === 'fpv'
      ? 'CAUGHT IN THE ANTI-DRONE NET: CHARGE WASTED ON THE MESH'
      : 'AIRCRAFT FOULED IN THE ANTI-DRONE NET', { effect: 'NETTED', impact: point });
  }

  updateFpvFamily(dt, input, solids) {
    for (const vehicle of this.combatVehicles) {
      if (vehicle.startAt && this.missionFlightTime < vehicle.startAt) {
        vehicle.velocity?.set(0, 0, 0);
        continue;
      }
      vehicle.update?.(dt, solids, this.pos);
    }
    // Hostile ambush drones on our supply road: if our run reaches one alive, it strikes.
    for (const hunter of this.combatVehicles) {
      if (hunter.dead || !hunter.ambushRadius) continue;
      for (const friend of this.combatVehicles) {
        if (friend.dead || !friend.protected || !friend.route?.length) continue;
        if (Math.hypot(hunter.pos.x - friend.pos.x, hunter.pos.z - friend.pos.z) > hunter.ambushRadius) continue;
        friend.damage(friend.maxHealth);
        this.createImpactEffect(friend.pos.clone(), 77);
        this.loseAirframe(`${hunter.label || 'AMBUSH DRONE'} STRUCK ${friend.label || 'OUR RUN'}: ROAD NOT CLEARED`, {
          effect: 'ROAD NOT CLEARED', target: hunter, impact: friend.pos.clone(),
          expended: false, missionComplete: false, criticalFailure: true,
        });
        return;
      }
    }
    // Something moved into wake range while the ambush aircraft sits on the verge.
    if (this.standby && !this.standbyAlerted && this.hostileContactWithin(this.standbyWakeRange, true)) {
      this.standbyAlerted = true;
      this.radioCall('MOVEMENT ON THE ROAD: TIME BACK TO REAL. WAKE ON YOUR CALL.', 3600);
    }
    // Interdiction loss path: a required airborne track that crosses out of the
    // engagement box has beaten the crew — it is through to whatever it came for.
    const box = this.training.engagementBounds;
    if (box) {
      for (const vehicle of this.combatVehicles) {
        if (!vehicle.airborne || vehicle.dead || vehicle.exited) continue;
        const out = vehicle.pos.x < box[0] - 2 || vehicle.pos.x > box[2] + 2
          || vehicle.pos.z > box[1] + 2 || vehicle.pos.z < box[3] - 2;
        if (!out) continue;
        vehicle.exited = true;
        if (!vehicle.optional && !vehicle.decoy && !vehicle.protected && vehicle.hostile) {
          this.loseAirframe(
            `${vehicle.label || 'TRACK'} EXITED THE ENGAGEMENT AREA — TARGET THROUGH`,
            { effect: 'TARGET ESCAPED', expended: false,
              missionComplete: false, criticalFailure: true });
          return;
        }
      }
    }
    const returnRadius = this.training.returnRadius ?? 14;
    const launchDistance = this.pos.distanceTo(this.launch);
    if (launchDistance > returnRadius * 1.35) this.departedLaunchArea = true;
    const assignedStillLive = this.combatVehicles.some(vehicle =>
      !vehicle.dead && !vehicle.decoy && !vehicle.protected && !vehicle.optional);
    if (this.training.openRange && this.departedLaunchArea && launchDistance <= returnRadius
      && assignedStillLive) {
      // A safe return is neither a hit nor a failure. Swap the pack and recreate the
      // presentation so a looping vehicle cannot remain lost at the far end of its route.
      this.serveNewTargetSet('FULL BATTERY // ASSIGNED TARGET RESET');
      return;
    }
    if (this.mode === 'fpv') {
      for (const vehicle of this.combatVehicles) {
        if (vehicle.dead) continue;
        // Contact follows the visible target, not a universal 8.4 m centre sphere. The old
        // sphere detonated beside a person, in front of a small truck and at a doorway while
        // the runner was still several metres inside. A small margin represents the quad's
        // own frame around the camera point; the model bounds supply the target's real size.
        this.contactBounds.setFromObject(vehicle.mesh).expandByScalar(0.12);
        if (this.contactBounds.containsPoint(this.pos)) {
          this.fpvDetonate(this.pos.clone());
          return;
        }
      }
    }
    if (this.mode === 'bomber' && (input.firePressed || input.nadePressed) && this.bombs > 0) {
      this.dropBomb();
    }
    this.updateFpvOsd(dt);
    const live = this.combatVehicles.filter(vehicle => !vehicle.dead);
    const requiredLive = live.filter(vehicle => !vehicle.decoy && !vehicle.protected && !vehicle.optional);
    if (!requiredLive.length && this.combatVehicles.length && !this.complete) {
      if (this.mode === 'bomber' && this.attemptState === FPV_ATTEMPT.FLYING) {
        if (this.training.requireReturn) {
          if (!this.egressRequired) this.bomberRetask();
          const returnRadius = this.training.returnRadius ?? 14;
          if (this.pos.distanceTo(this.launch) <= returnRadius) {
            this.beginAttemptReview('AIRCRAFT RECOVERED — REQUIRED EFFECTS CONFIRMED', {
              ...(this.lastBombImpact || {}),
              effect: 'DESTROYED', expended: false, missionComplete: true,
            });
          }
        } else {
          this.beginAttemptReview('PAYLOAD EFFECTS CONFIRMED', {
            ...(this.lastBombImpact || {}),
            effect: 'DESTROYED', expended: false, missionComplete: true,
          });
        }
      }
      return;
    }
    if (this.mode === 'bomber' && this.bombs <= 0 && !this.munitions.length
      && requiredLive.length && !this.complete && !this.failedOut) {
      this.beginAttemptReview('PAYLOAD EXPENDED — TARGETS INTACT', {
        ...(this.lastBombImpact || {}), effect: 'NO EFFECT', expended: false, restartRun: true,
      });
    }
  }

  // Kamikaze terminal event. Aspect matters: the model's nose is local -X, so local +X
  // rotated by the hull yaw is the rear arc. A caged vehicle shrugs off top/front hits —
  // the charge goes into the slats — and only the open rear arc puts it down. That single
  // rule is the cope-cage lesson the mission exists to teach.
  fpvDetonate(position) {
    if (this.detonated || this.frozen || this.attemptState !== FPV_ATTEMPT.FLYING) return;
    this.detonated = true;
    this.createImpactEffect(position, this.airframesLost + 1);
    this.onCombatBlast?.(position.clone(), 8, 240);
    this.killPopulationNear(position, 6.5);
    let note = 'AIRFRAME EXPENDED — NO EFFECT ON TARGET';
    let effect = 'NO EFFECT';
    let hitTarget = null;
    let killedTarget = false;
    let criticalFailure = false;
    // The charge affects the nearest thing in range, not the first in authoring order —
    // a dismount picket beside a required hull must not soak a strike aimed past it.
    let struck = null;
    let struckDistance = Infinity;
    for (const candidate of this.combatVehicles) {
      if (candidate.dead) continue;
      let distance = candidate.pos.distanceTo(position);
      const effectRadius = candidate.kind === 'infantry' ? 3.2 : 7;
      // A fire team dies where the MEN are, not at the team's map centre — a charge
      // into an empty fire bay while the crew is under the dugout's log roll wastes
      // the airframe. Fragments have to reach a live figure: near him, with no roof
      // or berm on the line between them.
      const crew = candidate.kind === 'infantry'
        ? candidate.mesh?.userData.crew : null;
      if (crew?.length) {
        distance = Infinity;
        const spot = new THREE.Vector3();
        for (const man of crew) {
          if (man.userData.fall) continue;
          man.getWorldPosition(spot);
          const reach = spot.distanceTo(position);
          if (reach >= distance || reach > effectRadius) continue;
          if (this.frameSolids?.length && !hasLOS(this.frameSolids,
            position.x, position.y, position.z, spot.x, spot.y + 0.9, spot.z)) continue;
          distance = reach;
        }
      }
      if (distance <= effectRadius && distance < struckDistance) {
        struck = candidate;
        struckDistance = distance;
      }
    }
    for (const vehicle of struck ? [struck] : []) {
      hitTarget = vehicle;
      if (vehicle.protected || !vehicle.hostile) {
        note = 'PROTECTED OBJECT STRUCK — IDENTIFICATION FAILURE';
        effect = 'PROTECTED STRIKE';
        criticalFailure = true;
        break;
      }
      if (vehicle.requiresIdentification && !vehicle.identified) {
        note = 'UNCONFIRMED TARGET STRUCK — NO CREDIT';
        effect = 'UNCONFIRMED';
        break;
      }
      if (vehicle.decoy) {
        vehicle.damage(vehicle.maxHealth);
        note = 'DECOY STRUCK — TARGET STILL ACTIVE';
        effect = 'DECOY';
        break;
      }
      const rear = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP_AXIS, vehicle.mesh.rotation.y);
      const toBlast = position.clone().sub(vehicle.pos);
      toBlast.y = 0;
      if (toBlast.lengthSq() > 0.001) toBlast.normalize();
      const rearHit = rear.dot(toBlast) > 0.35;
      // A turtle's skirts stop short of the ground: a low hit finds the running gear.
      const runningGear = vehicle.kind === 'turtle' && position.y - vehicle.pos.y < 1.25;
      if (vehicle.cage && !rearHit && runningGear) {
        vehicle.damage(200);
        if (!vehicle.dead) {
          vehicle.route = [];
          vehicle.speed = 0;
          vehicle.velocity.set(0, 0, 0);
        }
        note = `${vehicle.label || 'TARGET'} RUNNING GEAR HIT: MOBILITY KILL. FINISH IT THROUGH THE REAR.`;
        effect = 'MOBILITY KILL';
      } else if (vehicle.cage && !rearHit) {
        vehicle.damage(55);
        note = 'CAGE DEFEATED THE CHARGE — TAKE THE REAR ARC';
        effect = 'PROTECTION DEFEAT';
      } else {
        const killed = vehicle.damage(460);
        killedTarget = killed;
        if (!killed && vehicle.immobilizeOnHit) {
          vehicle.route = [];
          vehicle.speed = 0;
          vehicle.velocity.set(0, 0, 0);
        }
        note = killed
          ? vehicle.optional
            ? `${vehicle.label || 'TARGET'} DESTROYED — TARGET OF OPPORTUNITY`
            : `${vehicle.label || 'TARGET'} DESTROYED`
          : vehicle.immobilizeOnHit ? `${vehicle.label || 'TARGET'} HIT: IMMOBILIZED. SECOND AIRFRAME FINISHES IT.`
            : 'TARGET HIT: STILL MOVING';
        effect = killed ? 'DESTROYED' : vehicle.immobilizeOnHit ? 'MOBILITY KILL' : 'EFFECTIVE';
        if (killed) this.onVehicleKilled?.(vehicle);
      }
      break;
    }
    if (killedTarget) {
      for (const vehicle of this.combatVehicles) {
        if (vehicle.dead || vehicle.reacted || !vehicle.reaction) continue;
        vehicle.reacted = true;
        if (vehicle.reaction.speedMultiplier) vehicle.speed *= vehicle.reaction.speedMultiplier;
        if (vehicle.reaction.route?.length) {
          vehicle.route = vehicle.reaction.route.map(point => ({
            x: point[0], y: point.length > 2 ? point[1] : 0,
            z: point.length > 2 ? point[2] : point[1],
          }));
          vehicle.routeIdx = 0;
        }
      }
    }
    this.loseAirframe(note, {
      target: hitTarget, impact: position.clone(), effect, killed: killedTarget, criticalFailure,
    });
  }

  // One airframe down, by expenditure or by loss. If the target list is finished, freeze on
  // the final crash frame under full static; if frames remain, the next quad comes up from
  // the launch point; if neither, the sortie has failed and the mission is told so.
  loseAirframe(reason, outcome = {}) {
    if (this.frozen || this.attemptState !== FPV_ATTEMPT.FLYING) return;
    this.beginAttemptReview(reason, {
      effect: outcome.effect || (reason.includes('LINK') ? 'LINK LOSS'
        : reason.includes('BATTERY') ? 'BATTERY LOSS' : 'NO EFFECT'),
      impact: outcome.impact || this.pos.clone(),
      target: outcome.target || null,
      killed: !!outcome.killed,
      expended: outcome.expended !== false,
      missionComplete: outcome.missionComplete,
      criticalFailure: !!outcome.criticalFailure,
    });
  }

  dropBomb() {
    this.bombs--;
    const mesh = new THREE.Mesh(DRONE_MUNITION_GEO, DRONE_MUNITION_MAT);
    mesh.name = 'drone-dropped-bomb';
    mesh.position.copy(this.pos);
    mesh.position.y -= 0.55;
    // A drop munition leaves with the aircraft's drift and nothing else: lead the target by
    // flying the release point, exactly like a real bomber sortie. Gravity does the rest.
    const velocity = this.vel.clone().multiplyScalar(0.85);
    this.scene.add(mesh);
    this.munitions.push({ type: 'grenade', mesh, velocity, fuse: 16 });
    return true;
  }

  updateFpvOsd(dt) {
    const osd = this.osd;
    if (!osd) return;
    const helpSource = sticks.active ? sticks.source : 'keys';
    if (helpSource !== this.helpSource) {
      this.helpSource = helpSource;
      this.help.textContent = this.helpLine(helpSource);
    }
    const signal = this.frozen ? 0 : this.signal;
    // Analog snow at television cadence. A hint of sparkle even on a clean link; a wall of
    // it when the bubble wins. Frozen (expended/lost) is a dead feed: full snow, no video.
    this.noiseClock -= dt;
    // Quadratic, not linear: a mid link is sparkle you fly through, and only the bottom
    // fifth of the scale is a wall. LQ 50 with a readable picture is the analog promise.
    const snow = this.frozen
      ? 0.96
      : Math.max(0.04, Math.min(0.94, 0.04 + Math.pow(1 - signal, 2.6) * 0.92));
    this.noiseCanvas.style.opacity = String(snow);
    if (this.noiseClock <= 0) {
      this.noiseClock = 1 / 13;
      const image = this.noiseCtx.createImageData(160, 96);
      const data = image.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
      this.noiseCtx.putImageData(image, 0, 0);
      // Horizontal sync tears arrive in short, displaced bands rather than as uniform snow.
      for (const [index, tear] of osd.tears.entries()) {
        const chance = (1 - signal) * (index ? 0.38 : 0.6);
        if (signal < 0.84 && Math.random() < chance) {
          const displacement = (Math.random() - 0.5) * (8 + (1 - signal) * 56);
          tear.style.top = `${(Math.random() * 92) | 0}%`;
          tear.style.height = `${1 + Math.random() * (index ? 8 : 15)}px`;
          tear.style.opacity = String(0.18 + (1 - signal) * 0.54);
          tear.style.transform = `translateX(${displacement}px)`;
        } else {
          tear.style.opacity = '0';
        }
      }
    }
    const minutes = String(Math.floor(this.flightTime / 60)).padStart(2, '0');
    const seconds = String(Math.floor(this.flightTime % 60)).padStart(2, '0');
    osd.timer.textContent = `${minutes}:${seconds}`;
    if (osd.mode) {
      if (this.standby) {
        osd.mode.textContent = `STANDBY // MOTORS SAFE${this.timeCompression > 1 ? ` // WAIT x${this.timeCompression}` : ''}`;
      } else if (this.terminal?.target) {
        osd.mode.textContent = 'TERMINAL // SEEKER LOCKED';
      } else if (this.cruise) {
        const legs = this.cruise.waypoints.length;
        osd.mode.textContent = `CRUISE x${this.cruiseCompression} // ${this.cruise.home ? 'RTB'
          : `LEG ${this.cruise.index + 1}/${legs}`}`;
      } else if (this.mode === 'bomber') {
        osd.mode.textContent = this.payloadNadir ? 'NADIR LOCK // ALT HOLD' : 'GIMBAL // ALT HOLD';
      } else {
        const law = this.flightLaw === 'cruise' ? 'assist' : this.flightLaw;
        osd.mode.textContent = `${law === 'assist' ? 'ACRO' : law === 'angle' ? 'ANGLE' : 'ACRO'}`
          + ` // ${this.armTimer > 0 ? 'ARMING' : 'ARMED'}`
          + (law === 'assist' ? '' : ` // ${sticks.source === 'xr' ? 'TOUCH' : sticks.source.toUpperCase()}`);
      }
    }
    // 6S pack: 4.2 V/cell full, 3.3 V/cell flat — the numbers a pilot actually flies by.
    const cell = 3.3 + (this.battery / 100) * 0.9;
    const mah = Math.round((100 - this.battery) * (this.mode === 'bomber' ? 44 : 13));
    osd.batt.textContent = `${(cell * 6).toFixed(1)}V  ${cell.toFixed(2)}V/C\n${mah}MAH`;
    const lq = Math.round(signal * 100);
    const rssi = Math.round(-40 - (1 - signal) * 58);
    const requiredTargets = this.combatVehicles.filter(vehicle =>
      !vehicle.decoy && !vehicle.protected && !vehicle.optional);
    const requiredLive = requiredTargets.filter(vehicle => !vehicle.dead).length;
    const thermalLoad = Math.round((this.thermalBatteryMultiplier - 1) * 100);
    const sensor = this.thermalEnabled ? `THERMAL // LOAD +${thermalLoad}%` : 'EO';
    osd.link.textContent = (this.fiberControlled
      ? 'VIDEO OPTICAL\nCTRL OPTICAL'
      : `LQ ${lq}\nRSSI ${rssi}DBM`)
      + (this.mode === 'bomber'
        ? `\nBOMBS ${this.bombs}/${this.bombsTotal}  TGT ${requiredLive}/${requiredTargets.length}`
        : '')
      + `\nSENSOR ${sensor}`;
    if (osd.fiber) {
      if (this.fiberControlled) {
        const max = this.training.fiberMaxLength ?? 650;
        const payout = Math.round(this.fiberPayout * this.metersPerUnit);
        const reserve = Math.round(Math.max(0, max - this.fiberPayout) * this.metersPerUnit);
        osd.fiber.textContent = `CTRL FIBRE  OUT ${payout}M  RES ${reserve}M\nTENSION ${Math.round(this.fiberTension * 100)}%`;
        osd.fiber.style.display = '';
      } else osd.fiber.style.display = 'none';
    }
    const meters = this.pos.distanceTo(this.launch) * this.metersPerUnit;
    const yawHome = Math.atan2(-(this.launch.x - this.pos.x), -(this.launch.z - this.pos.z));
    let rel = yawHome - this.yaw;
    rel = ((rel % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    const arrow = '↑↗→↘↓↙←↖'[((Math.round(-rel / (Math.PI / 4)) % 8) + 8) % 8];
    // Heading: -Z is grid north. The briefs are written in cardinal language ("the west
    // road"), so the OSD has to speak it too.
    const hdg = Math.round((((-this.yaw * 180 / Math.PI) % 360) + 360) % 360) % 360;
    const cardinal = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(hdg / 45) % 8];
    const distText = meters >= 1000
      ? `DIST ${(meters / 1000).toFixed(1)}KM   HOME ${arrow}`
      : `DIST ${Math.round(meters)}M   HOME ${arrow}`;
    const speedKmh = Math.round(this.vel.length() * this.metersPerUnit * 3.6);
    // Radar cueing: the ground station's track plot read onto the pilot's OSD — bearing,
    // relative arrow, slant range and target altitude. This is the real interceptor-crew
    // loop: the radar finds it, the pilot flies the geometry.
    let radarLine = '';
    let radarTarget = null;
    if (this.training.radarBearing) {
      radarTarget = this.nearestLiveVehicle().vehicle;
      if (radarTarget && !radarTarget.exited) {
        const toTrack = radarTarget.pos.clone().sub(this.pos);
        const trackRange = toTrack.length() * this.metersPerUnit;
        const trackBearing = Math.atan2(-toTrack.x, -toTrack.z);
        let relTrack = trackBearing - this.yaw;
        relTrack = ((relTrack % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        const trackArrow = '↑↗→↘↓↙←↖'[((Math.round(-relTrack / (Math.PI / 4)) % 8) + 8) % 8];
        const trackHdg = Math.round((((-trackBearing * 180 / Math.PI) % 360) + 360) % 360) % 360;
        const terrainAtTrack = droneTerrain
          ? droneTerrain(radarTarget.pos.x, radarTarget.pos.z) : 0;
        const trackAlt = Math.round((radarTarget.pos.y - terrainAtTrack) * this.metersPerUnit);
        const rangeText = trackRange >= 1000
          ? `${(trackRange / 1000).toFixed(1)}KM` : `${Math.round(trackRange)}M`;
        radarLine = `\nTRK ${String(trackHdg).padStart(3, '0')} ${trackArrow} ${rangeText}  ALT ${trackAlt}M`;
      } else {
        radarLine = '\nTRK — NO CONTACT';
      }
    }
    // Timed traffic: the convoy intelligence says is due, or our own run that must find the
    // road clear. One line, nearest departure first.
    let etaLine = '';
    const timed = this.combatVehicles.filter(vehicle => vehicle.etaLabel && !vehicle.dead);
    if (timed.length) {
      const pending = timed.filter(vehicle => vehicle.startAt > this.missionFlightTime)
        .sort((a, b) => a.startAt - b.startAt)[0];
      if (pending) {
        const left = Math.max(0, pending.startAt - this.missionFlightTime);
        etaLine = `\n${pending.etaLabel} ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
      } else {
        etaLine = `\n${timed[0].etaLabel.replace(/ (IN|DUE|DEPARTS)$/, '')} MOVING`;
      }
    }
    osd.dist.textContent = `HDG ${String(hdg).padStart(3, '0')} ${cardinal}   SPD ${speedKmh}KM/H\n${distText}${radarLine}${etaLine}`;
    this.updateLockBox();
    if (this.mapCtx) {
      const ctx = this.mapCtx;
      ctx.clearRect(0, 0, this.mapW, this.mapH);
      ctx.drawImage(this.mapStatic, 0, 0);
      const [lx, lz] = this.mapPoint(this.launch.x, this.launch.z);
      ctx.fillStyle = '#7ce4ff';
      ctx.fillRect(lx - 2, lz - 2, 4, 4);
      ctx.font = '700 8px ui-monospace, Menlo, monospace';
      ctx.fillText(this.training.homeLabel || 'LZ', lx + 4, lz - 3);
      if (radarTarget && !radarTarget.dead && !radarTarget.exited) {
        // The hostile track on the pilot's map: a red blip with its motion vector, the
        // same plot the radar operator is reading out.
        const [tx, tz] = this.mapPoint(radarTarget.pos.x, radarTarget.pos.z);
        ctx.fillStyle = '#ff5a4e';
        ctx.beginPath();
        ctx.arc(tx, tz, 2.2, 0, Math.PI * 2);
        ctx.fill();
        const trackVel = radarTarget.velocity;
        if (trackVel && trackVel.lengthSq() > 0.02) {
          const speed = Math.hypot(trackVel.x, trackVel.z) || 1;
          ctx.strokeStyle = '#ff5a4e';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(tx, tz);
          ctx.lineTo(tx + trackVel.x / speed * 7, tz + trackVel.z / speed * 7);
          ctx.stroke();
        }
      }
      const [dx, dz] = this.mapPoint(this.pos.x, this.pos.z);
      ctx.strokeStyle = '#e9efe9';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(dx, dz);
      ctx.lineTo(dx - Math.sin(this.yaw) * 9, dz - Math.cos(this.yaw) * 9);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(dx, dz, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    osd.warn.textContent = this.frozen ? ''
      : this.terminal?.target && signal < 0.3 ? 'LINK LOST: SEEKER FLYING'
      : this.fiberWarning ? this.fiberWarning
      : this.egressRequired ? `RTB — ${this.training.homeLabel || 'LZ'} // BLUE RING / HOT BEACON`
      : this.linkLowTimer > 0.3 ? 'SIGNAL CRITICAL — TURN OUT'
        : signal < 0.3 ? 'JAMMING — BREAK LINE OF SIGHT'
          : this.battery < 9 ? 'LAND NOW'
            : this.battery < 22 ? 'LOW BATTERY' : '';
  }

  // Frame-state handoff for the renderer's camera/signal emulation. Keeping this separate
  // from mission rules means compatibility rendering can simply ignore it.
  feedVisualState() {
    if (!this.isFpvFamily) return null;
    return {
      active: true,
      signal: this.frozen ? 0 : this.signal,
      time: this.flightTime,
      thermal: this.thermalEnabled,
      stabilized: this.mode === 'bomber',
    };
  }

  buildPopulation(groups) {
    for (const [groupIndex, group] of groups.entries()) {
      let roll = ((groupIndex + 5) * 2654435761) >>> 0;
      const rand = () => ((roll = (roll * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      for (let i = 0; i < (group.count ?? 2); i++) {
        const soldier = createAuthoredCharacter({
          friendly: group.faction === 'friendly',
          variant: 137 + groupIndex * 13 + i * 5,
        });
        if (!soldier) return;   // no authored rig on this build — the map stays empty
        markCharacterShared(soldier);
        const actor = {
          root: soldier,
          pos: soldier.position,
          home: new THREE.Vector3(group.at?.[0] ?? group.posts[0][0], 0,
            group.at?.[1] ?? group.posts[0][1]),
          radius: group.r ?? 10,
          posts: group.posts || null,
          postIndex: group.posts
            ? Math.floor(rand() * group.posts.length) : 0,
          // [x, z] of the dugout: unarmed trench walkers run for it when a drone
          // presses inside 50m, and stay under the log roof until it leaves.
          shelter: group.shelter || null,
          hiding: false,
          hidden: false,
          dead: false,
          fall: null,
          walking: false,
          timer: 1 + rand() * 5,
          waypoint: new THREE.Vector3(),
          speed: (group.posts ? 0.8 : 1.05) + rand() * 0.35,
          clock: rand() * 9,
          rand,
        };
        this.pickPopulationWaypoint(actor);
        actor.pos.set(actor.waypoint.x, 0, actor.waypoint.z);
        actor.pos.y = droneTerrainHeight(actor.pos.x, actor.pos.z);
        soldier.rotation.y = rand() * Math.PI * 2;
        animateAuthoredCharacter(soldier, false, 0, 'patrol', actor.clock);
        this.scene.add(soldier);
        const signature = thermalSignature(actor);
        this.scene.add(signature);
        this.thermalSignatures.push(signature);
        this.populationActors.push(actor);
      }
    }
  }

  // Trench garrisons drift along the dug line one post at a time — the posts array is
  // an ordered polyline down the slot, so nobody cuts a corner through a parapet. Free
  // groups pick points inside their own radius. Nobody leaves their area.
  pickPopulationWaypoint(actor) {
    if (actor.hiding && actor.shelter) {
      // Run the ordered slot back to post 0 (the sap), then dive into the dugout —
      // never a straight cut across a parapet.
      if (actor.posts && actor.postIndex > 0) {
        actor.postIndex -= 1;
        const post = actor.posts[actor.postIndex];
        actor.waypoint.set(post[0], 0, post[1]);
      } else {
        actor.waypoint.set(actor.shelter[0], 0, actor.shelter[1]);
      }
      return;
    }
    if (actor.posts) {
      actor.postIndex = Math.min(actor.posts.length - 1, Math.max(0,
        actor.postIndex + (actor.rand() < 0.5 ? -1 : 1)));
      const post = actor.posts[actor.postIndex];
      actor.waypoint.set(
        post[0] + (actor.rand() - 0.5) * 0.5, 0,
        post[1] + (actor.rand() - 0.5) * 0.5);
      return;
    }
    const angle = actor.rand() * Math.PI * 2;
    const reach = Math.sqrt(actor.rand()) * actor.radius;
    actor.waypoint.set(
      actor.home.x + Math.cos(angle) * reach, 0,
      actor.home.z + Math.sin(angle) * reach);
  }

  updatePopulation(dt) {
    for (const actor of this.populationActors) {
      if (actor.dead) {
        const fall = actor.fall;
        if (fall && fall.t < 1) {
          fall.t = Math.min(1, fall.t + dt / fall.duration);
          const ease = 1 - Math.pow(1 - fall.t, 3);
          actor.root.rotation.x = fall.targetX * ease;
          actor.root.rotation.z = fall.targetZ * ease;
        }
        continue;
      }
      actor.clock += dt;
      if (actor.shelter && this.isFpvFamily && !this.frozen) {
        const threat = this.pos.distanceTo(actor.pos);
        if (!actor.hiding && threat < 50) {
          actor.hiding = true;
          this.pickPopulationWaypoint(actor);
          actor.walking = true;
        } else if (actor.hiding && threat > 65) {
          actor.hiding = false;
          if (actor.hidden) {
            actor.hidden = false;
            kneelAuthoredCharacter(actor.root, 0);
          }
          actor.timer = 1 + actor.rand() * 2;
        }
      }
      if (actor.walking) {
        const dx = actor.waypoint.x - actor.pos.x;
        const dz = actor.waypoint.z - actor.pos.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.4) {
          if (actor.hiding) {
            const atShelter = actor.shelter && Math.hypot(
              actor.pos.x - actor.shelter[0], actor.pos.z - actor.shelter[1]) < 0.7;
            if (atShelter) {
              actor.walking = false;
              actor.hidden = true;
            } else {
              this.pickPopulationWaypoint(actor);
            }
          } else {
            actor.walking = false;
            actor.timer = 2.5 + actor.rand() * 7;
          }
        } else {
          const step = Math.min(distance, (actor.hiding ? 2.6 : actor.speed) * dt);
          actor.pos.x += dx / distance * step;
          actor.pos.z += dz / distance * step;
          actor.root.rotation.y = Math.atan2(dx, dz);
        }
      } else if (!actor.hidden && (actor.timer -= dt) <= 0) {
        this.pickPopulationWaypoint(actor);
        actor.walking = true;
      }
      actor.pos.y = droneTerrainHeight(actor.pos.x, actor.pos.z);
      animateAuthoredCharacter(actor.root, actor.walking, 0,
        actor.hiding && actor.walking ? 'flee' : 'patrol', actor.clock);
      if (actor.hidden) kneelAuthoredCharacter(actor.root, 1);
    }
  }

  // Blast effect on the ambient population. Overhead cover works: no line from the
  // detonation to the man — a dugout's log roll, a berm — means no fragments reach him.
  killPopulationNear(position, radius) {
    for (const actor of this.populationActors) {
      if (actor.dead) continue;
      if (actor.pos.distanceTo(position) > radius) continue;
      if (this.frameSolids?.length && !hasLOS(this.frameSolids,
        position.x, position.y, position.z,
        actor.pos.x, actor.pos.y + 1.1, actor.pos.z)) continue;
      actor.dead = true;
      stopAuthoredCharacter(actor.root);
      const side = actor.rand() < 0.5 ? -1 : 1;
      actor.fall = {
        t: 0, duration: 0.45 + actor.rand() * 0.25,
        targetX: -(0.9 + actor.rand() * 0.55),
        targetZ: side * (0.15 + actor.rand() * 1.1),
      };
    }
  }

  updateThermalSignatures() {
    for (const signature of this.thermalSignatures) {
      const target = signature.userData.target;
      signature.visible = this.thermalEnabled
        && !!target && !target.dead && !target.surrendered;
      if (!signature.visible) continue;
      if (signature.userData.figure) {
        signature.userData.figure.getWorldPosition(signature.position);
        continue;
      }
      signature.position.copy(target.pos);
      if (signature.userData.vehicle) signature.rotation.y = target.mesh?.rotation.y || 0;
    }
  }

  updateArtilleryDefence(dt, solids) {
    for (let index = 0; index < this.targets.length; index++) {
      const target = this.targets[index];
      if (target.marked || target.kind !== 'artillery') continue;
      const crew = this.targetModels[index]?.userData.crew || [];
      if (!crew.length) continue;
      target.defenceTimer -= dt;
      if (target.defenceTimer > 0) continue;
      target.defenceTimer = 1.7 + (index % 3) * 0.52;
      const gunner = crew[target.defenceCrewIndex++ % crew.length];
      const origin = new THREE.Vector3();
      gunner.getWorldPosition(origin);
      origin.y += 1.12;
      const aim = this.pos.clone();
      const distance = origin.distanceTo(aim);
      if (distance > 50 || !hasLOS(
        solids, origin.x, origin.y, origin.z, aim.x, aim.y, aim.z,
      ) || terrainBlocksLine(origin.x, origin.y, origin.z, aim.x, aim.y, aim.z)) continue;
      gunner.rotation.y = Math.atan2(aim.x - origin.x, aim.z - origin.z)
        - (this.targetModels[index]?.rotation.y || 0);
      this.receiveEnemyFire(origin, solids, 1.45);
    }
  }

  // Dismounted pickets and trench garrisons defend themselves the way the artillery
  // crews always have: aimed rifle fire cycling through the living figures whenever the
  // aircraft presses inside 50m with line of sight — beyond that a small quad simply
  // isn't noticed or engaged. Static teams only — a runner
  // being intercepted keeps running; a man standing a fire bay shoots back. Lethality
  // per shot is groundFireHitChance; a trench's own parapets block low approaches, so
  // hugging the dirt on the way in denies them the shot.
  // A garrison under terminal attack doesn't stand its bay and trade — when the
  // aircraft presses inside ~22m the men break down the slot for the dugout, firing
  // stops as each man goes under the nakat, and the team files back to its bays once
  // the aircraft opens back past ~35m. The run follows the bunker path (the dug slot
  // itself), so nobody cuts across a parapet.
  updateTrenchCover(dt) {
    if (this.frozen) return;
    for (const vehicle of this.combatVehicles) {
      if (!vehicle.bunker?.path?.length || vehicle.kind !== 'infantry'
        || vehicle.dead || vehicle.surrendered) continue;
      const crew = vehicle.mesh?.userData.crew || [];
      if (!crew.length) continue;
      const distance = vehicle.pos.distanceTo(this.pos);
      if (distance < 22) vehicle.takingCover = true;
      else if (distance > 35) vehicle.takingCover = false;
      const path = vehicle.bunker.path;
      const base = vehicle.mesh.position;
      for (const soldier of crew) {
        const ud = soldier.userData;
        if (ud.fall) continue;
        if (!ud.post) {
          ud.post = { x: soldier.position.x, z: soldier.position.z,
            yaw: soldier.rotation.y, kneel: !!ud.kneel };
          let best = 0, bestD = Infinity;
          for (const [index, [px, pz]] of path.entries()) {
            const d = Math.hypot(px - ud.post.x, pz - ud.post.z);
            if (d < bestD) { bestD = d; best = index; }
          }
          ud.homeIdx = best;
        }
        let target = null, terminal = null;
        if (vehicle.takingCover) {
          if (ud.sheltered) continue;
          if (ud.coverIdx == null) ud.coverIdx = ud.homeIdx;
          target = path[ud.coverIdx];
          terminal = () => {
            if (ud.coverIdx < path.length - 1) { ud.coverIdx += 1; return; }
            ud.sheltered = true;
            ud.moving = false;
            ud.kneel = true;
          };
        } else {
          if (ud.coverIdx == null) continue;
          ud.sheltered = false;
          if (ud.coverIdx > ud.homeIdx) {
            target = path[ud.coverIdx - 1];
            terminal = () => { ud.coverIdx -= 1; };
          } else {
            target = [ud.post.x, ud.post.z];
            terminal = () => {
              ud.coverIdx = null;
              ud.moving = false;
              ud.kneel = ud.post.kneel;
              soldier.rotation.y = ud.post.yaw;
            };
          }
        }
        const dx = target[0] - soldier.position.x;
        const dz = target[1] - soldier.position.z;
        const gap = Math.hypot(dx, dz);
        if (gap < 0.3) { terminal(); continue; }
        ud.moving = true;
        if (ud.kneel) { ud.kneel = false; kneelAuthoredCharacter(soldier, 0); }
        const step = Math.min(gap, 2.7 * dt);
        soldier.position.x += dx / gap * step;
        soldier.position.z += dz / gap * step;
        soldier.rotation.y = Math.atan2(dx, dz);
        if (droneTerrain) {
          soldier.position.y = droneTerrain(
            base.x + soldier.position.x, base.z + soldier.position.z,
          ) - base.y + 0.02;
        }
      }
    }
  }

  updateInfantryDefence(dt, solids) {
    if (this.frozen) return;
    for (const vehicle of this.combatVehicles) {
      if (vehicle.kind !== 'infantry' || vehicle.dead || vehicle.surrendered
        || vehicle.protected || vehicle.hostile === false
        || (vehicle.route?.length ?? 0) > 1) continue;
      const crew = vehicle.mesh?.userData.crew || [];
      if (!crew.length) continue;
      vehicle.defenceTimer = (vehicle.defenceTimer ?? (0.5 + Math.random() * 1.6)) - dt;
      if (vehicle.defenceTimer > 0) continue;
      // A three-man team keeps up roughly one aimed shot per second between them.
      // The shot comes from the FIRST man in the cycle who can actually see the
      // aircraft — a fire bay's parapets, revetments and the belt's trunks mask each
      // man differently, and a team doesn't stay silent because the wrong man is up.
      vehicle.defenceTimer = (1.5 + Math.random() * 0.9) / Math.max(1, crew.length * 0.55);
      const aim = this.pos.clone();
      const origin = new THREE.Vector3();
      for (let attempt = 0; attempt < crew.length; attempt++) {
        vehicle.defenceCrewIndex = ((vehicle.defenceCrewIndex ?? -1) + 1) % crew.length;
        const gunner = crew[vehicle.defenceCrewIndex];
        // Fallen men, men running for the dugout and men already under it don't shoot.
        if (gunner.userData.fall || gunner.userData.moving
          || gunner.userData.sheltered) continue;
        gunner.getWorldPosition(origin);
        origin.y += 1.12;
        if (origin.distanceTo(aim) > 50 || !hasLOS(
          solids, origin.x, origin.y, origin.z, aim.x, aim.y, aim.z,
        ) || terrainBlocksLine(
          origin.x, origin.y, origin.z, aim.x, aim.y, aim.z,
        )) continue;
        gunner.rotation.y = Math.atan2(aim.x - origin.x, aim.z - origin.z)
          - (vehicle.mesh?.rotation.y || 0);
        this.receiveEnemyFire(origin, solids, 1.35);
        break;
      }
    }
  }

  receiveEnemyFire(origin, solids, impulse = 1.4) {
    if (!this.active || this.complete) return false;
    const direction = this.pos.clone().sub(origin);
    const distance = direction.length();
    if (distance < 0.01) return false;
    direction.multiplyScalar(1 / distance);
    const blocked = raycastSolids(
      solids, origin.x, origin.y, origin.z,
      direction.x, direction.y, direction.z, distance,
    );
    if (blocked < distance - 0.12) return false;
    if (terrainBlocksLine(
      origin.x, origin.y, origin.z, this.pos.x, this.pos.y, this.pos.z,
    )) return false;
    // One aimed shot. Almost all of them miss — see groundFireHitChance — but every
    // unblocked round still reads as a live threat: a tracer streak, camera flinch
    // and the KEEP MOVING call. The streak of a miss cracks PAST the airframe with a
    // small lateral offset; the rare connecting round ends the tracer on the hull and
    // kills the airframe outright.
    // groundFireLethality is a straight multiplier on the odds (default 1): QA
    // harnesses zero it for deterministic flights; a mission could raise it for an
    // authored AA picket.
    const hit = Math.random() < groundFireHitChance(distance,
      this.vel.length() / (this.worldMaxSpeed || 1)) * (this.groundFireLethality ?? 1);
    const end = this.pos.clone();
    if (!hit) {
      const lateral = new THREE.Vector3(direction.z, 0, -direction.x)
        .multiplyScalar((Math.random() - 0.5) * 3.2);
      lateral.y = (Math.random() - 0.5) * 2.4;
      end.addScaledVector(direction, 5 + Math.random() * 9).add(lateral);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const tracer = new THREE.Line(geometry, DRONE_TRACER_MAT);
    tracer.name = 'drone-incoming-tracer';
    this.scene.add(tracer);
    this.effects.push({ type: 'tracer', root: tracer, life: 0.16, age: 0 });
    // Incoming fire is not a flight-control input. The former velocity impulse pushed the
    // aircraft away from every shooter—including rounds that visibly missed—forcing the
    // pilot to fight an invisible hand near trench lines.
    this.roll += (origin.x < this.pos.x ? 1 : -1) * 0.045;
    this.incomingPressure = Math.min(1, this.incomingPressure + 0.48);
    this.onIncomingFire?.(origin);
    if (hit) {
      this.loseAirframe('AIRFRAME HIT BY GROUND FIRE', {
        effect: 'SHOT DOWN', impact: this.pos.clone(),
      });
    }
    return true;
  }

  setThermalEnabled(enabled) {
    this.thermalEnabled = enabled;
    if (this.canvas) {
      this.canvas.style.filter = enabled
        ? 'grayscale(1) saturate(0) contrast(1.08) brightness(.72)'
        : 'saturate(.78) contrast(1.08) brightness(.9)';
    }
  }

  currentBatteryDrainRate() {
    if (this.standby) return this.batteryDrain * this.standbyDrain;
    const propulsion = this.batteryDrain
      + this.vel.length() / this.worldMaxSpeed * this.batteryDrain * 0.6;
    return propulsion * (this.thermalEnabled ? this.thermalBatteryMultiplier : 1);
  }

  updateThermalBurst(dt, input) {
    // FPV-family aircraft carry a real switchable thermal channel: N is a plain toggle,
    // so the operator can flash thermal on to find a heat source and return to EO to fly.
    if (this.thermalPersistent) {
      if (input.nvgPressed) this.setThermalEnabled(!this.thermalEnabled);
      return;
    }
    const available = this.mode === 'combat' || this.strikeCleanup;
    if (!available) return;
    this.thermalRechargeRemaining = Math.max(0, this.thermalRechargeRemaining - dt);
    if (this.thermalEnabled) {
      this.thermalBurstRemaining = Math.max(0, this.thermalBurstRemaining - dt);
      if (this.thermalBurstRemaining <= 0) {
        this.setThermalEnabled(false);
        this.thermalRechargeRemaining = THERMAL_RECHARGE_SECONDS;
        this.showSensorResult('THERMAL DEPLETED // EO TRACKING ACTIVE', 1050);
      }
    }
    if (!input.nvgPressed) return;
    if (this.thermalEnabled) {
      this.setThermalEnabled(false);
      this.thermalBurstRemaining = 0;
      this.thermalRechargeRemaining = THERMAL_RECHARGE_SECONDS;
      this.showSensorResult('THERMAL STOWED // RECHARGING', 900);
    } else if (this.thermalRechargeRemaining <= 0) {
      this.setThermalEnabled(true);
      this.thermalBurstRemaining = THERMAL_BURST_SECONDS;
      this.showSensorResult('THERMAL BURST // 3 SECONDS', 900);
    } else {
      this.showSensorResult(
        `THERMAL CHARGING // ${this.thermalRechargeRemaining.toFixed(1)} SEC`, 700,
      );
    }
  }

  showSensorResult(text, duration) {
    this.result.textContent = text;
    this.result.style.opacity = '1';
    clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => {
      if (!this.complete) this.result.style.opacity = '0';
    }, duration);
  }

  thermalStatus() {
    if (this.thermalEnabled) {
      return this.thermalPersistent
        ? 'SENSOR THERMAL // AI TRACK'
        : `SENSOR THERMAL ${this.thermalBurstRemaining.toFixed(1)}s // AI TRACK`;
    }
    if (this.thermalRechargeRemaining > 0) {
      return `SENSOR EO // THERM CHG ${this.thermalRechargeRemaining.toFixed(1)}s // AI TRACK`;
    }
    return 'SENSOR EO // THERM READY // AI TRACK';
  }

  updateTargetBoxes() {
    for (const box of this.targetBoxes) {
      const target = box.userData.target;
      box.visible = !!target && !target.dead && !target.surrendered;
      if (!box.visible) continue;
      box.position.copy(target.pos);
      box.position.y += box.userData.vehicle ? 1.05 : 1.03;
      box.quaternion.copy(this.camera.quaternion);
    }
  }

  spawnStrikeSquirters() {
    if (this.strikeCleanupStarted) return this.strikeSquirters;
    this.strikeCleanupStarted = true;
    for (const target of this.targets) {
      for (let index = 0; index < (target.squirters || 0); index++) {
        const actor = createStrikeSquirter(target, index);
        this.scene.add(actor.mesh);
        const signature = thermalSignature(actor);
        this.scene.add(signature);
        this.thermalSignatures.push(signature);
        const box = targetingBox(actor);
        this.scene.add(box);
        this.targetBoxes.push(box);
        this.strikeSquirters.push(actor);
      }
    }
    this.strikeCleanup = this.strikeSquirters.length > 0;
    return this.strikeSquirters;
  }

  updateStrikeSquirters(dt, solids = []) {
    for (const actor of this.strikeSquirters) {
      if (actor.dead) continue;
      const waypoint = actor.route[actor.routeIndex];
      const toWaypoint = waypoint.clone().sub(actor.pos).setY(0);
      if (toWaypoint.length() < 0.55) {
        actor.routeIndex = actor.routeIndex + 1 >= actor.route.length
          ? actor.routeLoopStart : actor.routeIndex + 1;
      }
      const next = actor.route[actor.routeIndex];
      const delta = next.clone().sub(actor.pos).setY(0);
      const distance = delta.length();
      if (distance > 0.01) {
        actor.direction.copy(delta).multiplyScalar(1 / distance);
        const step = Math.min(distance, actor.speed * dt);
        actor.pos.addScaledVector(actor.direction, step);
        actor.distance += step;
      }
      actor.returned = actor.returned || (
        Math.abs(actor.pos.x) < 29.2 && actor.pos.z > -39.2);
      actor.mesh.position.copy(actor.pos);
      actor.mesh.rotation.y = Math.atan2(actor.direction.x, actor.direction.z);
      actor.mesh.rotation.z = Math.sin(actor.distance * 7.5) * 0.035;
      actor.fireTimer -= dt;
      if (actor.fireTimer > 0) continue;
      const origin = actor.pos.clone();
      origin.y += 1.2;
      const distanceToDrone = origin.distanceTo(this.pos);
      if (distanceToDrone < 50 && hasLOS(
        solids, origin.x, origin.y, origin.z,
        this.pos.x, this.pos.y, this.pos.z,
      ) && !terrainBlocksLine(
        origin.x, origin.y, origin.z, this.pos.x, this.pos.y, this.pos.z,
      )) {
        this.receiveEnemyFire(origin, solids, 1.12);
        actor.fireTimer = 1.55 + (actor.routeIndex % 3) * 0.3;
      } else {
        actor.fireTimer = 0.24;
      }
    }
  }

  damageStrikeSquirter(actor, damage, headshot = false) {
    if (!actor?.strikeSquirter || actor.dead) return false;
    actor.health -= headshot ? Math.max(damage, 100) : damage;
    if (actor.health > 0) return false;
    actor.dead = true;
    actor.mesh.rotation.z = actor.direction.x < 0 ? -1.28 : 1.28;
    actor.mesh.position.y = 0.13;
    return true;
  }

  fireRifle(solids) {
    const rifleHot = this.mode === 'combat'
      || (this.mode === 'strike' && this.strikeCleanup);
    if (!rifleHot || this.rifleRounds <= 0) return false;
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
    for (const actor of [...this.combatants, ...this.strikeSquirters]) {
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
    const endDistance = Math.min(maxRange, hitDistance);
    const end = origin.clone().addScaledVector(direction, endDistance);
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const tracer = new THREE.Line(geometry, DRONE_TRACER_MAT);
    tracer.name = 'drone-rifle-tracer';
    this.scene.add(tracer);
    this.effects.push({
      type: 'tracer', root: tracer, life: 0.2, age: 0,
    });
    this.onCombatShot?.(origin, end, hit);
    if (hit?.strikeSquirter) this.damageStrikeSquirter(hit, headshot ? 99999 : 42, headshot);
    else if (hit && vehicleHit) this.onCombatVehicleHit?.(hit, 8);
    else if (hit) this.onCombatHit?.(hit, headshot ? 99999 : 42, headshot);
    return true;
  }

  launchGrenade() {
    const grenadeHot = this.mode === 'combat'
      || (this.mode === 'strike' && this.strikeCleanup);
    if (!grenadeHot || this.grenadeRounds <= 0) return false;
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
        const solidGround = groundHeight(
          solids, munition.mesh.position.x, munition.mesh.position.z,
          0.08, munition.mesh.position.y + 0.35);
        const ground = droneTerrain
          ? Math.max(solidGround, droneTerrain(munition.mesh.position.x, munition.mesh.position.z))
          : solidGround;
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
    if (this.mode === 'strike' && this.strikeCleanup) {
      for (const actor of this.strikeSquirters) {
        if (actor.dead) continue;
        const distance = actor.pos.distanceTo(position);
        if (distance < 7) this.damageStrikeSquirter(actor, 185 * (1 - distance / 7), false);
      }
    }
    if (this.isFpvFamily) {
      this.killPopulationNear(position, 8);
      // A dropped bomb is a top attack: cages and aspect do not apply, blast falloff does.
      let nearest = null;
      let nearestDistance = Infinity;
      let anyKilled = false;
      const killedLabels = [];
      const tacticalEffects = [];
      for (const vehicle of this.combatVehicles) {
        if (vehicle.dead) continue;
        const distance = vehicle.pos.distanceTo(position);
        if (distance < nearestDistance) { nearest = vehicle; nearestDistance = distance; }
        if (distance > 9) continue;
        if (vehicle.protected || !vehicle.hostile || vehicle.decoy) continue;
        const killed = vehicle.damage(360 * (1 - distance / 9));
        if (killed) {
          anyKilled = true;
          killedLabels.push(vehicle.label || 'TARGET');
          this.attemptEffects.push({
            label: vehicle.label || 'TARGET',
            pos: vehicle.pos.clone(),
            impact: position.clone(),
            t: this.flightTime,
            required: !vehicle.optional && !vehicle.decoy && !vehicle.protected,
          });
          this.onVehicleKilled?.(vehicle);
          if (vehicle.stopsConsist && vehicle.consistId) {
            for (const member of this.combatVehicles) {
              if (member.dead || member.consistId !== vehicle.consistId) continue;
              member.speed = 0;
              member.velocity.set(0, 0, 0);
            }
            tacticalEffects.push(vehicle.stopMessage || 'CONSIST STOPPED.');
          }
        }
      }
      this.lastBombImpact = {
        target: nearest,
        impact: position.clone(),
        effect: anyKilled ? 'DESTROYED' : nearestDistance <= 9 ? 'EFFECTIVE' : 'MISS',
        killed: anyKilled,
      };
      if (anyKilled && this.mode === 'bomber') {
        this.bomberRetask(killedLabels, tacticalEffects.join(' '));
      }
    }
    this.onCombatBlast?.(position.clone(), this.isFpvFamily ? 9 : 7, 185);
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
      // A killed vehicle stays on the field between sorties: the wreck IS the scoreboard
      // when the next airframe flies past it. Same parking lot the strike targets use.
      if (this.persistWrecks && vehicle.dead) {
        const wrecks = this.scene.userData.droneWrecks || [];
        if (!wrecks.includes(vehicle.mesh)) wrecks.push(vehicle.mesh);
        this.scene.userData.droneWrecks = wrecks;
        continue;
      }
      this.scene.remove(vehicle.mesh);
      vehicle.mesh.userData.dispose?.();
    }
    for (const actor of this.strikeSquirters) {
      this.scene.remove(actor.mesh);
      disposeObject(actor.mesh);
    }
    for (const actor of this.populationActors || []) {
      this.scene.remove(actor.root);
      disposeObject(actor.root);   // shared rig assets are flagged persistent; no-op there
    }
    for (const signature of this.thermalSignatures) {
      this.scene.remove(signature);
      disposeObject(signature);
    }
    for (const box of this.targetBoxes) {
      this.scene.remove(box);
      disposeObject(box);
    }
    if (this.launchMarker) {
      this.scene.remove(this.launchMarker);
      disposeObject(this.launchMarker);
      this.launchMarker = null;
    }
    if (this.fiberCourse) {
      this.scene.remove(this.fiberCourse);
      disposeObject(this.fiberCourse);
      this.fiberCourse = null;
    }
    if (this.fiberCable) {
      this.scene.remove(this.fiberCable);
      disposeObject(this.fiberCable);
      this.fiberCable = null;
    }
    if (this.netRoot) {
      this.scene.remove(this.netRoot);
      disposeObject(this.netRoot);
      this.netRoot = null;
    }
    this.munitions.length = 0;
    this.effects.length = 0;
    this.overlay.remove();
    document.body.classList.remove('fpv-feed');
  }
}
