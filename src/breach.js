import * as THREE from 'three';
import { makeDoor } from './levelgen.js';
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

function makePortalFrame(width, height) {
  const root = new THREE.Group();
  root.name = 'breach-portal-reveal';
  const add = (name, material, x, y, z, sx, sy, sz) => {
    const mesh = new THREE.Mesh(PORTAL_GEO, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  };
  // A deep reveal is visible from either side and remains after the leaf has been breached.
  add('portal-left-jamb', PORTAL_MAT, -width / 2 - 0.11, height / 2, 0, 0.22, height + 0.34, 0.42);
  add('portal-right-jamb', PORTAL_MAT, width / 2 + 0.11, height / 2, 0, 0.22, height + 0.34, 0.42);
  add('portal-lintel', PORTAL_MAT, 0, height + 0.11, 0, width + 0.44, 0.22, 0.42);
  add('portal-warning-header', PORTAL_STRIPE_MAT, 0, height + 0.18, 0.225, width * 0.62, 0.09, 0.035);
  add('portal-warning-header-rear', PORTAL_STRIPE_MAT, 0, height + 0.18, -0.225, width * 0.62, 0.09, 0.035);
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

  // nearest un-breached door within reach & rough facing
  nearBreachable(playerPos, yaw) {
    for (const d of this.doors) {
      if (d.breached) continue;
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
  nearStack(pos, radius = 5.5) {
    let best = null, bestD = radius;
    for (const d of this.doors) {
      if (d.breached) continue;
      const dy = Math.abs((d.mesh.position.y + 1.2) - pos.y);
      if (dy > 2.4) continue;
      const dist = Math.hypot(d.mesh.position.x - pos.x, d.mesh.position.z - pos.z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  breach(door, world) {
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
