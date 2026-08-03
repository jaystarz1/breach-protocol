import * as THREE from 'three';
import {
  groundHeight, hasLOS, raycastSolids, raySphere, rayVerticalCapsule,
} from './physics.js';

const MAX_RANGE = 95;
const MAX_SPEED = 16;
const UP_AXIS = new THREE.Vector3(0, 1, 0);

// Heightfield sampler for terrain levels, set by main on level start (null elsewhere).
// Everything airborne reads it: flight floor, vehicle ground-follow, munition impact,
// and jammer line-of-sight. Sampling the grid replaces raycasting a mesh.
let droneTerrain = null;
export function setDroneTerrain(sampler) { droneTerrain = sampler; }
export function droneTerrainHeight(x, z) { return droneTerrain ? droneTerrain(x, z) : 0; }
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
  } else if (target.kind === 'tank') {
    // A main battle tank with a welded cope cage. The cage is the doctrine lesson made
    // visible from FPV distance: the roof is screened, so the drone has to come in on the
    // rear arc where the standoff frame is open and the engine deck is thin.
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
  } else if (target.kind === 'fuelcar') {
    // A rail tank wagon: flat frame over bogies, a long horizontal tank, filler dome. Built
    // to read as strategic logistics from bomber altitude, and to burn convincingly.
    add(new THREE.BoxGeometry(9.2, 0.3, 2.4), dark, [0, 1.05, 0]);
    for (const x of [-3.4, 3.4]) {
      for (const wx of [-0.55, 0.55]) {
        add(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 12), steel,
          [x + wx, 0.55, 0], [Math.PI / 2, 0, 0]);
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
      if (index < (target.squirters || 0)) {
        soldier.visible = false;
        continue;
      }
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
  });
  mesh.name = 'drone-assault-technical';
  scene.add(mesh);
  mesh.position.copy(pos);
  const vehicle = {
    pos,
    mesh,
    maxHealth: definition.health ?? 190,
    health: definition.health ?? 190,
    // FPV target attributes: `cage` arms the rear-aspect rule, `label` names the kill feed.
    cage: !!definition.cage,
    label: definition.label || null,
    // Optional instructor line delivered when this target dies (the flight-school voice).
    killMessage: definition.killMessage || null,
    dead: false,
    route: (definition.route || []).map(point => ({
      x: point[0],
      y: point.length > 2 ? point[1] : 0,
      z: point.length > 2 ? point[2] : point[1],
    })),
    routeIdx: 0,
    loop: !!definition.loop,
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
      if (distance < 0.7) {
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
      if (surface !== -Infinity) this.pos.y = surface;
      this.mesh.position.copy(this.pos);
      this.mesh.position.y += 0.02;
    },
  };
  return vehicle;
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
      }));
    }
    root.add(thermalSignature({ dead: false, pos: new THREE.Vector3() }, true));
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
    this.battery = 100;
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
    this.metersPerUnit = definition.metersPerUnit ?? 1;
    this.airframes = definition.airframes ?? 1;
    this.airframesLost = 0;
    this.jammers = definition.jammers || [];
    this.ceiling = definition.ceiling ?? 34;
    this.batteryDrain = definition.batteryDrain ?? 0.72;
    this.maxSpeed = definition.maxSpeed ?? MAX_SPEED;
    this.accel = definition.accel ?? 19;
    this.bombs = this.mode === 'bomber' ? (definition.bombs ?? 6) : 0;
    this.bombsTotal = this.bombs;
    this.craftName = definition.craftName || (this.mode === 'bomber' ? 'HW-16 HERON' : 'VMS-7 KESTREL');
    this.thermalPersistent = !!definition.thermalPersistent;
    this.onFailed = definition.onFailed || null;
    this.onVehicleKilled = definition.onVehicleKilled || null;
    this.flightTime = 0;
    this.jamFactor = 1;
    this.linkLowTimer = 0;
    this.failedOut = false;
    this.detonated = false;
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
        const signature = thermalSignature(vehicle, true);
        scene.add(signature);
        this.thermalSignatures.push(signature);
      }
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
      <canvas class="fpv-noise"></canvas>
      <div class="fpv-tear"></div>
      <div class="fpv-cross">+</div>
      <div class="fpv-name">${this.craftName}</div>
      <div class="fpv-mode">${this.mode === 'bomber' ? 'ANGLE // PAYLOAD' : 'ACRO // ARMED'}</div>
      <div class="fpv-timer">00:00</div>
      <div class="fpv-dist"></div>
      <div class="fpv-batt"></div>
      <div class="fpv-link"></div>
      <div class="fpv-warn"></div>
      <canvas class="fpv-map"></canvas>
      <div class="drone-result fpv-result"></div>
      <div class="fpv-help">${this.mode === 'bomber'
    ? 'WASD FLIGHT · MOUSE LOOK · RMB/Z CLIMB · CTRL/C DESCEND · FIRE/G DROP BOMB · N THERMAL'
    : 'WASD FLIGHT · MOUSE LOOK · RMB/Z CLIMB · CTRL/C DESCEND · FLY INTO THE TARGET'}</div>
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
      .fpv-noise{position:absolute;inset:0;width:100%;height:100%;opacity:0;mix-blend-mode:screen}
      .fpv-tear{position:absolute;left:0;right:0;height:0;background:rgba(235,240,235,.5);opacity:0;filter:blur(1px)}
      .fpv-cross{position:absolute;left:50%;top:50%;transform:translate(-50%,-54%);font-size:22px;font-weight:400}
      .fpv-name{position:absolute;left:6%;top:5%}
      .fpv-mode{position:absolute;left:6%;top:calc(5% + 22px);font-size:12px;color:#cfd8cf}
      .fpv-timer{position:absolute;right:6%;top:5%}
      .fpv-dist{position:absolute;left:50%;top:5%;transform:translateX(-50%);text-align:center;white-space:pre}
      .fpv-batt{position:absolute;left:6%;bottom:7%;white-space:pre;font-size:17px}
      .fpv-link{position:absolute;right:6%;bottom:7%;text-align:right;white-space:pre}
      .fpv-warn{position:absolute;left:50%;top:63%;transform:translateX(-50%);color:#ffd8b0;font-size:18px;letter-spacing:3px;animation:fpvblink 0.6s steps(2) infinite}
      .fpv-map{position:absolute;right:6%;bottom:calc(7% + 92px);border:1px solid rgba(233,239,233,.4);background:rgba(6,8,6,.68);image-rendering:pixelated}
      .fpv-help{position:absolute;left:50%;bottom:2.5%;transform:translateX(-50%);font-size:11px;font-weight:400;letter-spacing:1px;white-space:nowrap;color:#c9d2c9}
      .fpv-result{position:absolute;left:50%;top:26%;transform:translateX(-50%);padding:9px 14px;border:1px solid rgba(233,239,233,.5);background:rgba(8,10,8,.78);letter-spacing:2px;opacity:0;transition:opacity .18s}
      @keyframes fpvblink{50%{opacity:0.15}}
    `;
    this.overlay.appendChild(style);
    document.body.appendChild(this.overlay);
    this.status = null;
    this.lock = null;
    this.help = this.overlay.querySelector('.fpv-help');
    this.result = this.overlay.querySelector('.fpv-result');
    this.osd = {
      timer: this.overlay.querySelector('.fpv-timer'),
      dist: this.overlay.querySelector('.fpv-dist'),
      batt: this.overlay.querySelector('.fpv-batt'),
      link: this.overlay.querySelector('.fpv-link'),
      warn: this.overlay.querySelector('.fpv-warn'),
      tear: this.overlay.querySelector('.fpv-tear'),
    };
    // Analog snow: a tiny noise canvas stretched over the screen, redrawn at television
    // cadence. Opacity rides (1 - link) so jamming looks like jamming, not like lag.
    this.noiseCanvas = this.overlay.querySelector('.fpv-noise');
    this.noiseCanvas.width = 160;
    this.noiseCanvas.height = 96;
    this.noiseCtx = this.noiseCanvas.getContext('2d');
    this.noiseClock = 0;
    this.buildFpvMap(definition);
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
  }

  // The operator's map board, north-up in the corner of the goggles: terrain the brief
  // talks about (roads, woods, rail, settlements), the jammer bubbles, launch, and live
  // target tracks. Static features bake once; the per-frame pass only blits and stamps.
  buildFpvMap(definition) {
    const mapCanvas = this.overlay.querySelector('.fpv-map');
    const def = definition.minimap;
    if (!def) { mapCanvas.remove(); return; }
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
      const [jx, jz] = this.mapPoint(jammer.x, jammer.z);
      ctx.beginPath();
      ctx.arc(jx, jz, jammer.r * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,90,60,0.13)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,110,80,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // The target is NOT tracked live: intel gives a search box, the pilot does the finding.
    // Box is the bounding area of the briefed patrol route (or parked position), padded.
    if (this.combatVehicles.length) {
      let bx1 = Infinity, bz1 = Infinity, bx2 = -Infinity, bz2 = -Infinity;
      for (const vehicle of this.combatVehicles) {
        const points = vehicle.route?.length
          ? vehicle.route.map(p => [p.x, p.z]) : [[vehicle.pos.x, vehicle.pos.z]];
        for (const [px, pz] of points) {
          bx1 = Math.min(bx1, px); bx2 = Math.max(bx2, px);
          bz1 = Math.min(bz1, pz); bz2 = Math.max(bz2, pz);
        }
      }
      const pad = 45;
      const [sx, sz] = this.mapPoint(bx1 - pad, bz2 + pad);
      const [ex, ez] = this.mapPoint(bx2 + pad, bz1 - pad);
      ctx.strokeStyle = 'rgba(255,92,70,0.85)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(Math.min(sx, ex), Math.min(sz, ez), Math.abs(ex - sx), Math.abs(ez - sz));
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,92,70,0.9)';
      ctx.font = '700 8px ui-monospace, Menlo, monospace';
      ctx.fillText('TGT', Math.min(sx, ex) + 2, Math.min(sz, ez) - 2);
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
    if (this.frozen) {
      // Expended or lost: the feed is dead. Keep the explosion animating under the snow.
      this.updateEffects(dt);
      if (this.isFpvFamily) this.updateFpvOsd(dt);
      return;
    }
    this.flightTime += dt;
    this.updateThermalBurst(dt, input);
    // Jamming degrades the CONTROL link too, not just the picture: inside a bubble the
    // stick response goes mushy before it dies. Legacy modes fly with a clean link.
    this.armTimer = Math.max(0, this.armTimer - dt);
    const control = this.isFpvFamily ? 0.3 + 0.7 * Math.max(this.signal, 0.05) : 1;
    this.yaw -= input.lookDelta.x * 0.72 * control;
    this.pitch = Math.max(-1.15, Math.min(0.72, this.pitch - input.lookDelta.y * 0.62 * control));
    this.roll += ((-input.move.x * 0.42) - this.roll) * Math.min(1, dt * 6);

    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const thrust = -input.move.y;
    this.vel.addScaledVector(this.forward, thrust * this.accel * control * dt);
    this.vel.addScaledVector(this.right, input.move.x * this.accel * 0.58 * control * dt);
    if (input.ads) this.vel.y += 10 * control * dt;
    if (input.crouch) this.vel.y -= 9 * dt;
    const damping = Math.exp(-1.45 * dt);
    this.vel.multiplyScalar(damping);
    if (this.vel.length() > this.maxSpeed) this.vel.setLength(this.maxSpeed);

    this.next.copy(this.pos).addScaledVector(this.vel, dt);
    this.move.copy(this.next).sub(this.pos);
    const distance = this.move.length();
    if (distance > 0.001) {
      this.move.multiplyScalar(1 / distance);
      const hit = raycastSolids(
        solids, this.pos.x, this.pos.y, this.pos.z,
        this.move.x, this.move.y, this.move.z, distance + 0.16);
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
    const ground = groundHeight(solids, this.pos.x, this.pos.z, 0.12, this.pos.y + 1);
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

    const fromLaunch = this.pos.distanceTo(this.launch);
    const base = Math.max(0, Math.min(1, 1 - fromLaunch / this.maxRange));
    // Jammer bubbles. Radius grows with altitude: high and straight is line-of-sight to the
    // jammer, low along the treeline is terrain masking — the doctrine the mission teaches.
    this.jamFactor = 1;
    const droneAgl = this.pos.y - terrainY;
    for (const jammer of this.jammers) {
      const reach = jammer.r * (0.55 + 0.45 * Math.min(1, Math.max(0, droneAgl) / 40));
      const d = Math.hypot(this.pos.x - jammer.x, this.pos.z - jammer.z);
      if (d < reach) {
        let factor = Math.pow(Math.max(0, d / reach), 1.4);
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
    this.signal = base * this.jamFactor;
    this.battery = Math.max(0, this.battery
      - dt * (this.batteryDrain + this.vel.length() / this.maxSpeed * this.batteryDrain * 0.6));
    if (this.isFpvFamily) {
      // Analog fails soft, but it still fails: hold a dead link too long and the aircraft
      // is gone. The timer is the pilot's chance to dive out of the bubble.
      if (this.signal <= 0.1) this.linkLowTimer += dt; else this.linkLowTimer = 0;
      if (this.linkLowTimer > 1.7) { this.loseAirframe('LINK LOST IN THE BUBBLE'); return; }
      if (this.battery <= 0) { this.loseAirframe('BATTERY FLAT'); return; }
    } else if (this.signal <= 0.02 || this.battery <= 0) this.resetAircraft();

    this.camera.position.copy(this.pos);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, this.roll);

    this.incomingPressure = Math.max(0, this.incomingPressure - dt * 1.8);
    if (this.mode === 'strike' && !this.strikeCleanup) {
      this.updateArtilleryDefence(dt, solids);
    }
    if (this.mode === 'strike' && this.strikeCleanup) this.updateStrikeSquirters(dt, solids);
    this.updateThermalSignatures();
    this.updateTargetBoxes();
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

  updateFpvFamily(dt, input, solids) {
    for (const vehicle of this.combatVehicles) vehicle.update?.(dt, solids);
    if (this.mode === 'fpv') {
      for (const vehicle of this.combatVehicles) {
        if (vehicle.dead) continue;
        const dx = vehicle.pos.x - this.pos.x;
        const dy = (vehicle.pos.y + 1.3) - this.pos.y;
        const dz = vehicle.pos.z - this.pos.z;
        if (dx * dx + dy * dy + dz * dz < 2.4 * 2.4) {
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
    if (!live.length && this.combatVehicles.length && !this.complete) {
      this.complete = true;
      this.result.textContent = this.resultText;
      this.result.style.opacity = '1';
      this.completionTimer = setTimeout(() => this.onComplete?.(), 1400);
    }
    if (this.mode === 'bomber' && this.bombs <= 0 && !this.munitions.length
      && live.length && !this.complete && !this.failedOut) {
      this.failedOut = true;
      this.result.textContent = 'PAYLOAD EXPENDED — TARGETS INTACT';
      this.result.style.opacity = '1';
      setTimeout(() => this.onFailed?.('PAYLOAD EXPENDED'), 1400);
    }
  }

  // Kamikaze terminal event. Aspect matters: the model's nose is local -X, so local +X
  // rotated by the hull yaw is the rear arc. A caged vehicle shrugs off top/front hits —
  // the charge goes into the slats — and only the open rear arc puts it down. That single
  // rule is the cope-cage lesson the mission exists to teach.
  fpvDetonate(position) {
    if (this.detonated || this.frozen) return;
    this.detonated = true;
    this.createImpactEffect(position, this.airframesLost + 1);
    this.onCombatBlast?.(position.clone(), 8, 240);
    let note = 'AIRFRAME EXPENDED — NO EFFECT ON TARGET';
    for (const vehicle of this.combatVehicles) {
      if (vehicle.dead) continue;
      const distance = vehicle.pos.distanceTo(position);
      if (distance > 7) continue;
      const rear = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP_AXIS, vehicle.mesh.rotation.y);
      const toBlast = position.clone().sub(vehicle.pos);
      toBlast.y = 0;
      if (toBlast.lengthSq() > 0.001) toBlast.normalize();
      const rearHit = rear.dot(toBlast) > 0.35;
      if (vehicle.cage && !rearHit) {
        vehicle.damage(55);
        note = 'CAGE DEFEATED THE CHARGE — TAKE THE REAR ARC';
      } else {
        const killed = vehicle.damage(460);
        note = killed
          ? `${vehicle.label || 'TARGET'} DESTROYED`
          : 'TARGET HIT — STILL MOVING';
        if (killed) this.onVehicleKilled?.(vehicle);
      }
    }
    this.loseAirframe(note);
  }

  // One airframe down, by expenditure or by loss. If the target list is finished, freeze on
  // the final crash frame under full static; if frames remain, the next quad comes up from
  // the launch point; if neither, the sortie has failed and the mission is told so.
  loseAirframe(reason) {
    if (this.frozen) return;
    this.airframesLost++;
    this.vel.set(0, 0, 0);
    const liveTargets = this.combatVehicles.some(vehicle => !vehicle.dead);
    if (!liveTargets && this.combatVehicles.length) {
      this.frozen = true;
      this.signal = 0;
      if (!this.complete) {
        this.complete = true;
        this.result.textContent = this.resultText;
        this.result.style.opacity = '1';
        this.completionTimer = setTimeout(() => this.onComplete?.(), 1700);
      }
      return;
    }
    if (this.airframesLost >= this.airframes) {
      this.frozen = true;
      this.signal = 0;
      if (!this.failedOut) {
        this.failedOut = true;
        this.result.textContent = `${reason} — ALL AIRFRAMES EXPENDED`;
        this.result.style.opacity = '1';
        setTimeout(() => this.onFailed?.(reason), 1500);
      }
      return;
    }
    this.detonated = false;
    this.pos.copy(this.launch);
    this.pos.y += 1.7;
    this.yaw = this.launchYaw;
    this.pitch = -0.05;
    this.battery = 100;
    this.linkLowTimer = 0;
    this.armTimer = 1.2;
    this.result.textContent = `${reason} — AIRFRAME ${this.airframesLost + 1}/${this.airframes} UP`;
    this.result.style.opacity = '1';
    clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => {
      if (!this.complete) this.result.style.opacity = '0';
    }, 2600);
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
      // Horizontal tear bars: the classic analog break-up as SNR falls.
      if (signal < 0.8 && Math.random() < (1 - signal) * 0.55) {
        osd.tear.style.top = `${(Math.random() * 90) | 0}%`;
        osd.tear.style.height = `${2 + Math.random() * 14}px`;
        osd.tear.style.opacity = String(0.25 + (1 - signal) * 0.5);
      } else {
        osd.tear.style.opacity = '0';
      }
    }
    const minutes = String(Math.floor(this.flightTime / 60)).padStart(2, '0');
    const seconds = String(Math.floor(this.flightTime % 60)).padStart(2, '0');
    osd.timer.textContent = `${minutes}:${seconds}`;
    // 6S pack: 4.2 V/cell full, 3.3 V/cell flat — the numbers a pilot actually flies by.
    const cell = 3.3 + (this.battery / 100) * 0.9;
    const mah = Math.round((100 - this.battery) * (this.mode === 'bomber' ? 44 : 13));
    osd.batt.textContent = `${(cell * 6).toFixed(1)}V  ${cell.toFixed(2)}V/C\n${mah}MAH`;
    const lq = Math.round(signal * 100);
    const rssi = Math.round(-40 - (1 - signal) * 58);
    osd.link.textContent = `LQ ${lq}\nRSSI ${rssi}DBM`
      + (this.mode === 'bomber'
        ? `\nBOMBS ${this.bombs}/${this.bombsTotal}\n${this.thermalEnabled ? 'THERM' : 'EO'}`
        : '');
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
    osd.dist.textContent = `HDG ${String(hdg).padStart(3, '0')} ${cardinal}\n${distText}`;
    if (this.mapCtx) {
      const ctx = this.mapCtx;
      ctx.clearRect(0, 0, this.mapW, this.mapH);
      ctx.drawImage(this.mapStatic, 0, 0);
      const [lx, lz] = this.mapPoint(this.launch.x, this.launch.z);
      ctx.fillStyle = '#7ce4ff';
      ctx.fillRect(lx - 2, lz - 2, 4, 4);
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
      : this.linkLowTimer > 0.3 ? 'SIGNAL CRITICAL'
        : signal < 0.3 ? 'JAMMING'
          : this.battery < 9 ? 'LAND NOW'
            : this.battery < 22 ? 'LOW BATTERY' : '';
  }

  updateThermalSignatures() {
    for (const signature of this.thermalSignatures) {
      const target = signature.userData.target;
      signature.visible = this.thermalEnabled
        && !!target && !target.dead && !target.surrendered;
      if (!signature.visible) continue;
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
      if (distance > 86 || !hasLOS(
        solids, origin.x, origin.y, origin.z, aim.x, aim.y, aim.z,
      )) continue;
      gunner.rotation.y = Math.atan2(aim.x - origin.x, aim.z - origin.z)
        - (this.targetModels[index]?.rotation.y || 0);
      this.receiveEnemyFire(origin, solids, 1.45);
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
    // Draw every confirmed hit so the incoming fire still reads as a live threat. The line is
    // deliberately dimmer and shorter-lived than the aircraft's own rifle tracer; the impulse
    // and pressure updates below remain per-hit, preserving the original bounce cadence.
    const end = this.pos.clone();
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const tracer = new THREE.Line(geometry, DRONE_TRACER_MAT);
    tracer.name = 'drone-incoming-tracer';
    this.scene.add(tracer);
    this.effects.push({ type: 'tracer', root: tracer, life: 0.16, age: 0 });
    this.vel.addScaledVector(direction, impulse);
    this.roll += (origin.x < this.pos.x ? 1 : -1) * 0.045;
    this.incomingPressure = Math.min(1, this.incomingPressure + 0.48);
    this.onIncomingFire?.(origin);
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

  updateThermalBurst(dt, input) {
    // The heavy bomber carries a real gimbal thermal, not a burst gadget: N is a plain
    // toggle, on for as long as the pilot wants it. That is how Baba Yaga crews fly nights.
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
      return `SENSOR THERMAL ${this.thermalBurstRemaining.toFixed(1)}s // AI TRACK`;
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
      if (distanceToDrone < 82 && hasLOS(
        solids, origin.x, origin.y, origin.z,
        this.pos.x, this.pos.y, this.pos.z,
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
      // A dropped bomb is a top attack: cages and aspect do not apply, blast falloff does.
      for (const vehicle of this.combatVehicles) {
        if (vehicle.dead) continue;
        const distance = vehicle.pos.distanceTo(position);
        if (distance > 9) continue;
        const killed = vehicle.damage(360 * (1 - distance / 9));
        if (killed) this.onVehicleKilled?.(vehicle);
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
    for (const signature of this.thermalSignatures) {
      this.scene.remove(signature);
      disposeObject(signature);
    }
    for (const box of this.targetBoxes) {
      this.scene.remove(box);
      disposeObject(box);
    }
    this.munitions.length = 0;
    this.effects.length = 0;
    this.overlay.remove();
  }
}
