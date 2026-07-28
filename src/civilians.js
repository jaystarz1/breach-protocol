import { makeCharacter, animateRig, deathPose } from './levelgen.js';
import { groundHeight, resolveXZ } from './physics.js';
import { sfx } from './audio.js';

// Matches DUCK_DROP in enemies.js and the apron height in windowBay(): the distance a window
// occupant sinks to be genuinely hidden by geometry rather than switched off.
const WIN_DROP = 1.72;

function seededRandom(seed) {
  let state = (seed || 1) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

// No-shoot actors. Their reactions are varied but mission-seeded: repeating a mission variant
// produces the same rushers, lane-crossers, delays and hostage behavior rather than dice-roll
// madness that the player cannot learn.
export class Civilian {
  constructor(scene, def) {
    this.random = seededRandom(def._seed);
    this.hostage = !!def.hostage;
    this.wasHostage = this.hostage;
    this.mesh = makeCharacter({
      hostile: false, hostage: this.hostage, variant: def._seed,
    });
    this.mesh.position.set(def.pos[0], def.pos[1] ?? 0, def.pos[2]);
    this.mesh.rotation.y = (def.yaw ?? this.random() * 360) * Math.PI / 180;
    scene.add(this.mesh);
    this.dead = false;
    this.rescued = false;
    this.deathAnim = 0;
    this.walkPhase = this.random() * 6;
    this.panic = false;
    this.panicDir = this.random() * Math.PI * 2;
    this.panicTimer = 0;
    this.reactionDelay = 0.18 + this.random() * 0.58;
    this.screamed = false;
    this.exhausted = 0;
    this.prone = 0;                       // 0..1 blend into flat-on-the-floor
    // Some bound people flatten themselves; others freeze upright in a cower. Keeping a
    // hostage-sized obstruction in the target picture is intentional pressure, while the
    // split prevents every hostage encounter from behaving identically.
    this.duckOnFire = this.random() < 0.45;
    // A civilian who runs AT you is the actual shoot/no-shoot test. Fleeing bodies are easy:
    // they leave the frame. Someone sprinting at your muzzle with their hands up, in a level
    // where everything else running at you is trying to kill you, is the decision.
    this.rush = def.rush !== undefined ? !!def.rush : (!this.hostage && this.random() < 0.35);
    this.crossLane = !this.hostage && !this.rush && this.random() < 0.32;
    this.rushDone = false;
    this.escort = false;
    this.escortSide = this.random() < 0.5 ? -1 : 1;
    this.escortHeat = 0;
    this.baseY = this.mesh.position.y;
    // Window civilians. Same bay geometry the shooters use, and that is the point: at 160m
    // through a 7-degree scope, a head appearing in an opening is a head appearing in an
    // opening. Whether it belongs to a rifleman or to somebody who came to see what the
    // noise was is the shot you are being asked to make.
    this.perch = def.window || null;
    if (this.perch) {
      this.mesh.position.set(this.perch[0], this.perch[1] - WIN_DROP, this.perch[2]);
      this.mesh.rotation.y = def.yaw !== undefined ? def.yaw * Math.PI / 180 : 0;
      this.perchY = this.perch[1];
      this.duck = 1;
      this.up = false;
      this.winTimer = 0.5 + this.random() * 4;
      this.exposed = false;
    }
  }

  get pos() { return this.mesh.position; }

  // Hit sphere. Goes low and forward once they are face-down, because a sphere floating at
  // chest height over a prone body means you can "miss" a hostage you visibly shot.
  get hitY() { return this.hostage ? 0.6 - this.prone * 0.35 : 1.0 - this.prone * 0.6; }
  get hitR() { return this.hostage ? 0.45 : 0.5; }

  // Face-down, hands over the head. Called the moment rounds start flying.
  goProne(dt) {
    this.prone = Math.min(1, this.prone + dt * 2.6);
    this.mesh.rotation.x = -1.32 * this.prone;
    this.mesh.position.y = this.baseY + 0.34 * this.prone;
  }

  standUp() {
    this.prone = 0;
    this.mesh.rotation.x = 0;
    this.mesh.position.y = this.baseY;
  }

  // cut loose: the bound man stands up and stops being scenery
  rescue(by = 'you') {
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
    this.standUp();            // a man you just cut loose does not stay face-down
    this.hostage = false;      // no longer bound; still protected as an evacuee
    this.panic = by !== 'you';
    this.escort = by === 'you';
    this.rush = false;         // never convert a freed hostage into a muzzle-rushing civilian
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
    if (this.perch) { this.updateWindow(dt, world); return; }
    // Bound hostages cannot run, so the only thing they can do once rounds start flying is
    // get flat. It also opens the shot: a kneeling hostage next to a standing gunman is a
    // cluttered target picture, and a prone one is not.
    if (this.hostage) {
      if (world.combatHeat > 0) {
        this.reactionDelay -= dt;
        if (this.reactionDelay > 0) return;
        if (this.duckOnFire) this.goProne(dt);
        else animateRig(this.mesh, this.walkPhase, false);
        if (!this.screamed && this.pos.distanceTo(world.playerPos) < 28) {
          this.screamed = true;
          sfx.civScream(this.pos);
        }
      }
      return;
    }

    if (this.escort) {
      this.updateEscort(dt, world);
      return;
    }

    if (world.combatHeat > 0 && !this.panic) {
      this.reactionDelay -= dt;
      if (this.reactionDelay > 0) return;
      this.panic = true;
      if (!this.screamed && this.pos.distanceTo(world.playerPos) < 28) {
        this.screamed = true;
        sfx.civScream(this.pos);
      }
    }
    if (!this.panic) return;

    this.exhausted += dt;

    // Rushers: sprint at the player, then throw themselves flat a few metres short rather
    // than running through him. The flare of movement straight down your sights is the point.
    if (this.rush && !this.rushDone) {
      const d = this.pos.distanceTo(world.playerPos);
      if (d < 3.2 || this.exhausted > 9) { this.rushDone = true; }
      else {
        const toward = Math.atan2(world.playerPos.x - this.pos.x, world.playerPos.z - this.pos.z);
        this.panicDir = toward;
        this.step(dt, world, 3.9);
        return;
      }
    }
    if (this.rushDone) { this.goProne(dt); animateRig(this.mesh, this.walkPhase, false); return; }

    if (this.exhausted > 14) { this.goProne(dt); animateRig(this.mesh, this.walkPhase, false); return; } // spent, hits the deck

    this.panicTimer -= dt;
    if (this.panicTimer <= 0) {
      this.panicTimer = 1.0 + this.random() * 1.4;
      const away = Math.atan2(this.pos.x - world.playerPos.x, this.pos.z - world.playerPos.z);
      let dir = this.crossLane && this.exhausted < 5
        ? away + this.escortSide * Math.PI / 2
        : away + (this.random() - 0.5) * 0.7;
      // Most people clear the firing line. A seeded minority deliberately cross it for the
      // crowded-market shoot/no-shoot problem, then transition to the normal away vector.
      const toward = Math.atan2(world.playerPos.x - this.pos.x, world.playerPos.z - this.pos.z);
      let rel = dir - toward;
      while (rel > Math.PI) rel -= 2 * Math.PI;
      while (rel < -Math.PI) rel += 2 * Math.PI;
      if (!this.crossLane && Math.abs(rel) < 0.6) dir = toward + (rel >= 0 ? 1.1 : -1.1);
      this.panicDir = dir;
    }

    this.step(dt, world, 3.2);
  }

  // Player-freed hostages trail close enough to matter. In a quiet room they follow through
  // the same doorway; once fire starts they take a human-sized beat, then get down. If left
  // far behind they move to rejoin before dropping, so rescuing someone creates an escort
  // responsibility instead of instantly deleting that person from the encounter.
  updateEscort(dt, world) {
    const sin = Math.sin(world.playerYaw);
    const cos = Math.cos(world.playerYaw);
    const tx = world.playerPos.x + sin * 2.0 + cos * this.escortSide * 0.72;
    const tz = world.playerPos.z + cos * 2.0 - sin * this.escortSide * 0.72;
    const distance = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (world.combatHeat > 0) {
      this.escortHeat += dt;
      if (this.escortHeat < this.reactionDelay || distance > 5) {
        if (distance > 1.8) {
          this.panicDir = Math.atan2(tx - this.pos.x, tz - this.pos.z);
          this.step(dt, world, 2.8);
        }
      } else {
        this.goProne(dt);
        animateRig(this.mesh, this.walkPhase, false);
      }
      return;
    }

    this.escortHeat = 0;
    if (this.prone > 0) this.standUp();
    if (distance > 2.45) {
      this.panicDir = Math.atan2(tx - this.pos.x, tz - this.pos.z);
      this.step(dt, world, 2.55);
    } else {
      animateRig(this.mesh, this.walkPhase, false);
    }
  }

  // Somebody upstairs in a building a firefight has started underneath. They come to the
  // window, they look, they get frightened and drop back down — and once rounds are actually
  // in the air they show themselves far less often and for much less time.
  updateWindow(dt, world) {
    this.winTimer -= dt;
    const hot = world.combatHeat > 0;
    if (this.winTimer <= 0) {
      this.up = !this.up;
      this.winTimer = this.up
        ? (hot ? 1.0 + this.random() * 1.6 : 3.0 + this.random() * 4)
        : (hot ? 4.5 + this.random() * 6 : 2.0 + this.random() * 4);
      if (this.up && hot && !this.screamed && this.random() < 0.4) {
        this.screamed = true;
        sfx.civScream(this.pos);
      }
    }
    this.duck = Math.max(0, Math.min(1, this.duck + (this.up ? -1 : 1) * dt * 2.6));
    this.pos.y = this.perchY - WIN_DROP * this.duck;
    this.baseY = this.pos.y;
    this.exposed = this.duck < 0.55;
    this.mesh.visible = this.duck < 1;
    animateRig(this.mesh, this.walkPhase, false);
  }

  step(dt, world, s) {
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
    this.baseY = p.y;
  }
}
