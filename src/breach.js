import * as THREE from 'three';
import { makeDoor } from './levelgen.js';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { makeBox } from './physics.js';
import { sfx } from './audio.js';
import { hud } from './hud.js';

const PORTAL_GEO = new THREE.BoxGeometry(1, 1, 1);
const PORTAL_MAT = new THREE.MeshStandardMaterial({
  name: 'breach-portal-frame', color: 0x30383c, roughness: 0.78, metalness: 0.34,
});
const PORTAL_STRIPE_MAT = new THREE.MeshStandardMaterial({
  name: 'breach-portal-warning-stripe',
  color: 0xc08b3e, emissive: 0x4b2608, emissiveIntensity: 0.24,
  roughness: 0.72, metalness: 0.18,
});
for (const resource of [PORTAL_GEO, PORTAL_MAT, PORTAL_STRIPE_MAT]) {
  resource.userData.bpPersistent = true;
}

const portalGeometryCache = new Map();

function portalGeometry(width, height) {
  const key = `${width}:${height}`;
  if (portalGeometryCache.has(key)) return portalGeometryCache.get(key);
  const box = (x, y, z, sx, sy, sz) => {
    const geometry = PORTAL_GEO.clone();
    geometry.scale(sx, sy, sz);
    geometry.translate(x, y, z);
    return geometry;
  };
  const structureParts = [
    box(-width / 2 - 0.11, height / 2, 0, 0.22, height + 0.34, 0.42),
    box(width / 2 + 0.11, height / 2, 0, 0.22, height + 0.34, 0.42),
    box(0, height + 0.11, 0, width + 0.44, 0.22, 0.42),
  ];
  const stripeParts = [
    box(0, height + 0.18, 0.225, width * 0.62, 0.09, 0.035),
    box(0, height + 0.18, -0.225, width * 0.62, 0.09, 0.035),
  ];
  const result = {
    structure: mergeGeometries(structureParts, false),
    stripes: mergeGeometries(stripeParts, false),
  };
  for (const geometry of [...structureParts, ...stripeParts]) geometry.dispose();
  result.structure.userData.bpPersistent = true;
  result.stripes.userData.bpPersistent = true;
  portalGeometryCache.set(key, result);
  return result;
}

function makePortalFrame(width, height) {
  const root = new THREE.Group();
  root.name = 'breach-portal-reveal';
  const geometry = portalGeometry(width, height);
  const add = (name, source, material) => {
    const mesh = new THREE.Mesh(source, material);
    mesh.name = name;
    // The surrounding wall owns the shadow silhouette. These trim pieces receive the wall's
    // shadow but do not each trigger another directional-shadow draw.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  // A deep reveal is visible from either side and remains after the leaf has been breached.
  add('portal-structure', geometry.structure, PORTAL_MAT);
  add('portal-warning-headers', geometry.stripes, PORTAL_STRIPE_MAT);
  return root;
}

// Breachable doors: block movement until breached; breach = blast + 1.5s slow-mo target window.
export class DoorSystem {
  constructor(scene, defs) {
    this.scene = scene;
    this.doors = defs.map(d => {
      const mesh = makeDoor(d.w ?? 1.4, d.h ?? 2.4);
      mesh.position.set(d.pos[0], d.pos[1] ?? 0, d.pos[2]);
      mesh.rotation.y = (d.rot ?? 0) * Math.PI / 180;
      scene.add(mesh);
      const frame = makePortalFrame(d.w ?? 1.4, d.h ?? 2.4);
      frame.position.copy(mesh.position);
      frame.rotation.y = mesh.rotation.y;
      scene.add(frame);
      const along = ((d.rot ?? 0) % 180 === 0);
      const w = d.w ?? 1.4;
      const solid = along
        ? makeBox(d.pos[0], (d.pos[1] ?? 0) + 1.2, d.pos[2], w, 2.4, 0.15)
        : makeBox(d.pos[0], (d.pos[1] ?? 0) + 1.2, d.pos[2], 0.15, 2.4, w);
      return { mesh, frame, solid, breached: false, flyVel: null, def: d };
    });
  }

  addSolids(solids) {
    for (const d of this.doors) if (!d.breached) solids.push(d.solid);
  }

  isUnlocked(door, objectiveIdx = Infinity) {
    return (door?.def?.unlockObjective ?? -Infinity) <= objectiveIdx;
  }

  // nearest un-breached door within reach & rough facing
  nearBreachable(playerPos, yaw, objectiveIdx = Infinity) {
    for (const d of this.doors) {
      if (d.breached || !this.isUnlocked(d, objectiveIdx)) continue;
      const dx = d.mesh.position.x - playerPos.x, dz = d.mesh.position.z - playerPos.z;
      const dy = Math.abs((d.mesh.position.y + 1.2) - playerPos.y);
      const dist = Math.hypot(dx, dz);
      if (dist < 2.6 && dy < 2.2) {
        const ang = Math.atan2(-dx, -dz); // player forward is -Z at yaw 0... handled loosely
        return d;
      }
    }
    return null;
  }

  // Nearest un-breached door within `radius`, used to tell the squad to stack up. Separate
  // from nearBreachable because that one is tuned for the "press to breach" prompt and only
  // reaches 2.6m, by which point the player is already standing on the door.
  nearStack(pos, radius = 5.5, objectiveIdx = Infinity) {
    let best = null, bestD = radius;
    for (const d of this.doors) {
      if (d.breached || !this.isUnlocked(d, objectiveIdx)) continue;
      const dy = Math.abs((d.mesh.position.y + 1.2) - pos.y);
      if (dy > 2.4) continue;
      const dist = Math.hypot(d.mesh.position.x - pos.x, d.mesh.position.z - pos.z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  nearLocked(pos, objectiveIdx, radius = 3.2) {
    let best = null, bestD = radius;
    for (const d of this.doors) {
      if (d.breached || this.isUnlocked(d, objectiveIdx)) continue;
      const dy = Math.abs((d.mesh.position.y + 1.2) - pos.y);
      if (dy > 2.4) continue;
      const dist = Math.hypot(d.mesh.position.x - pos.x, d.mesh.position.z - pos.z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  breach(door, world) {
    if (!this.isUnlocked(door, world?.objectiveIdx)) return false;
    door.breached = true;
    // remove its solid from world list
    const i = world.solids.indexOf(door.solid);
    if (i >= 0) world.solids.splice(i, 1);
    sfx.breach();
    world.slowmo = 1.5;                 // seconds of slow-mo
    world.combatHeat = Math.max(world.combatHeat, 3);
    // door panel flies inward
    door.flyVel = new THREE.Vector3(Math.sin(door.mesh.rotation.y + Math.PI), 2.5, Math.cos(door.mesh.rotation.y + Math.PI)).multiplyScalar(4);
    // alert enemies in the room beyond
    for (const e of world.enemies) {
      const d = e.pos.distanceTo(door.mesh.position);
      if (d < 14 && !e.dead) { e.state = 'alert'; e.reactTimer = Math.max(e.reactTimer, world.diff.enemyReaction * 1.4); }
    }
    hud.feed('DOOR BREACHED', '#ffd54f');
    return true;
  }

  update(dt) {
    for (const d of this.doors) {
      if (!d.flyVel) continue;
      d.flyVel.y -= 12 * dt;
      d.mesh.position.addScaledVector(d.flyVel, dt);
      d.mesh.rotation.x -= dt * 5;
      if (d.mesh.position.y < -3) { this.scene.remove(d.mesh); d.flyVel = null; }
    }
  }
}
