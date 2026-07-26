import { makeCharacter, animateRig, deathPose } from './levelgen.js';
import { groundHeight, resolveXZ } from './physics.js';
import { sfx } from './audio.js';

// No-shoot actors. Hostages kneel in place; free civilians flee AWAY from the player
// and never across his firing line, so a fair shot is never spoiled by a panicking body.
export class Civilian {
  constructor(scene, def) {
    this.hostage = !!def.hostage;
    this.mesh = makeCharacter({ hostile: false, hostage: this.hostage });
    this.mesh.position.set(def.pos[0], def.pos[1] ?? 0, def.pos[2]);
    this.mesh.rotation.y = (def.yaw ?? Math.random() * 360) * Math.PI / 180;
    scene.add(this.mesh);
    this.dead = false;
    this.rescued = false;
    this.deathAnim = 0;
    this.walkPhase = Math.random() * 6;
    this.panic = false;
    this.panicDir = Math.random() * Math.PI * 2;
    this.panicTimer = 0;
    this.screamed = false;
    this.exhausted = 0;
  }

  get pos() { return this.mesh.position; }

  // cut loose: the bound man stands up and stops being scenery
  rescue() {
    if (this.rescued || this.dead) return false;
    this.rescued = true;
    const r = this.mesh.userData.rig;
    if (r) {
      for (const c of this.mesh.children) c.position.y += 0.42;
      r.lLeg.rotation.x = 0; r.rLeg.rotation.x = 0;
      r.lLeg.userData.shin.rotation.x = 0; r.rLeg.userData.shin.rotation.x = 0;
      r.lArm.rotation.set(0.1, 0, 0.15); r.rArm.rotation.set(0.1, 0, -0.15);
      r.lArm.userData.fore.rotation.x = 0; r.rArm.userData.fore.rotation.x = 0;
    }
    this.hostage = false;      // now a free civilian: flees like the rest
    this.panic = true;
    return true;
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.deathAnim = 0.001;
    deathPose(this.mesh);
    sfx.civScream(this.pos);
  }

  update(dt, world) {
    if (this.dead) {
      if (this.deathAnim < 1) {
        this.deathAnim = Math.min(1, this.deathAnim + dt * 3);
        this.mesh.rotation.x = -Math.PI / 2 * this.deathAnim;
      }
      return;
    }
    if (this.hostage) return;                    // bound, stays put

    if (world.combatHeat > 0 && !this.panic) {
      this.panic = true;
      if (!this.screamed && this.pos.distanceTo(world.playerPos) < 28) {
        this.screamed = true;
        sfx.civScream(this.pos);
      }
    }
    if (!this.panic) return;

    this.exhausted += dt;
    if (this.exhausted > 14) { animateRig(this.mesh, this.walkPhase, false); return; } // spent, cowers

    this.panicTimer -= dt;
    if (this.panicTimer <= 0) {
      this.panicTimer = 1.0 + Math.random() * 1.4;
      const away = Math.atan2(this.pos.x - world.playerPos.x, this.pos.z - world.playerPos.z);
      let dir = away + (Math.random() - 0.5) * 0.7;
      // never bolt across the player's aim: if this heading takes them through his
      // forward axis, mirror it to the far side instead
      const toward = Math.atan2(world.playerPos.x - this.pos.x, world.playerPos.z - this.pos.z);
      let rel = dir - toward;
      while (rel > Math.PI) rel -= 2 * Math.PI;
      while (rel < -Math.PI) rel += 2 * Math.PI;
      if (Math.abs(rel) < 0.6) dir = toward + (rel >= 0 ? 1.1 : -1.1);
      this.panicDir = dir;
    }

    const s = 3.2;
    const p = this.pos;
    const prev = { x: p.x, z: p.z };
    p.x += Math.sin(this.panicDir) * s * dt;
    p.z += Math.cos(this.panicDir) * s * dt;
    resolveXZ(world.solids, p, 0.3, p.y + 0.6, p.y + 1.6, prev);
    // ran into something: pick a fresh heading next tick rather than grinding the wall
    if (Math.hypot(p.x - prev.x, p.z - prev.z) < s * dt * 0.35) this.panicTimer = 0;
    this.mesh.rotation.y = this.panicDir;
    this.walkPhase += s * dt * 5.5;
    animateRig(this.mesh, this.walkPhase, true);
    const g = groundHeight(world.solids, p.x, p.z, 0.25, p.y + 0.75);
    p.y += ((g === -Infinity ? 0 : g) - p.y) * Math.min(1, dt * 10);
  }
}
