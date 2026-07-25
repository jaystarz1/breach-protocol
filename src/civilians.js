import { makeCharacter } from './levelgen.js';
import { groundHeight, resolveXZ } from './physics.js';

// No-shoot actors. Hostages kneel in place; free civilians cower or flee when shooting starts.
export class Civilian {
  constructor(scene, def) {
    this.hostage = !!def.hostage;
    this.mesh = makeCharacter({ hostile: false, hostage: this.hostage });
    this.mesh.position.set(def.pos[0], def.pos[1] ?? 0, def.pos[2]);
    this.mesh.rotation.y = (def.yaw ?? Math.random() * 360) * Math.PI / 180;
    scene.add(this.mesh);
    this.dead = false;
    this.deathAnim = 0;
    this.panic = false;
    this.panicDir = Math.random() * Math.PI * 2;
    this.panicTimer = 0;
  }

  get pos() { return this.mesh.position; }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.deathAnim = 0.001;
  }

  update(dt, world) {
    if (this.dead) {
      if (this.deathAnim < 1) {
        this.deathAnim = Math.min(1, this.deathAnim + dt * 3);
        this.mesh.rotation.x = -Math.PI / 2 * this.deathAnim;
      }
      return;
    }
    if (this.hostage) return; // kneeling, stays put
    if (world.combatHeat > 0 && !this.panic) this.panic = true;
    if (this.panic) {
      this.panicTimer -= dt;
      if (this.panicTimer <= 0) {
        this.panicTimer = 0.8 + Math.random() * 1.5;
        // run away from player
        const dx = this.pos.x - world.playerPos.x, dz = this.pos.z - world.playerPos.z;
        this.panicDir = Math.atan2(dx, dz) + (Math.random() - 0.5) * 1.2;
      }
      const s = 3.2;
      const p = this.pos;
      p.x += Math.sin(this.panicDir) * s * dt;
      p.z += Math.cos(this.panicDir) * s * dt;
      resolveXZ(world.solids, p, 0.3, p.y + 0.2, p.y + 1.6);
      this.mesh.rotation.y = this.panicDir;
      const g = groundHeight(world.solids, p.x, p.z, 0.25, p.y + 0.6);
      p.y += ((g === -Infinity ? 0 : g) - p.y) * Math.min(1, dt * 10);
    }
  }
}
