import {
  makeCharacter, animateDeathRig, animateRig, coverPoseRig, deathPose, releaseHostageRig,
  settleDeathRig,
} from './levelgen.js';
import { groundHeight, hasLOS, resolveXZ } from './physics.js';
import { findPath, nearestNode } from './navgrid.js';
import { seededRandom } from './mission-variants.js';
import { sfx } from './audio.js';

// Matches DUCK_DROP in enemies.js and the apron height in windowBay(): the distance a window
// occupant sinks to be genuinely hidden by geometry rather than switched off.
const WIN_DROP = 1.72;

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
    this.spawnPos = this.mesh.position.clone();
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
    this.prone = 0;                       // 0..1 blend into a living kneel/cower
    this.coverSearchAt = 1.1 + this.random() * 2.2;
    this.coverTarget = null;
    this.coverPath = null;
    this.coverPathIdx = 0;
    this.coverSearchDone = false;
    this.inHardCover = false;
    // Some bound people drop into a cower; others freeze upright. Keeping a
    // hostage-sized obstruction in the target picture is intentional pressure, while the
    // split prevents every hostage encounter from behaving identically.
    this.duckOnFire = this.random() < 0.45;
    // A civilian who runs AT you is the actual shoot/no-shoot test. Fleeing bodies are easy:
    // they leave the frame. Someone sprinting at your muzzle with their hands up, in a level
    // where everything else running at you is trying to kill you, is the decision.
    this.rush = def.rush !== undefined ? !!def.rush : (!this.hostage && this.random() < 0.18);
    this.crossLane = !this.hostage && !this.rush && this.random() < 0.32;
    this.rushDone = false;
    this.escort = false;
    this.rescuer = null;
    this.escortSlot = 0;
    this.escortCommand = 'follow';
    this.escortAnchor = null;
    this.escortSide = this.random() < 0.5 ? -1 : 1;
    this.escortHeat = 0;
    this.escortBlocked = 0;
    this.escortFreeze = 0;
    this.freezeInDoorway = this.random() < 0.58;
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

  // Hit sphere follows the compact cover pose instead of floating at standing chest height.
  get hitY() { return this.hostage ? 0.6 - this.prone * 0.35 : 1.0 - this.prone * 0.6; }
  get hitR() { return this.hostage ? 0.45 : 0.5; }

  // Compact, hands-over-head cover response. Keep the actor root upright so this cannot be
  // confused with the separate death animation.
  takeCover(dt) {
    this.prone = Math.min(1, this.prone + dt * 2.6);
    this.mesh.rotation.x = 0;
    this.mesh.position.y = this.baseY;
    animateRig(this.mesh, this.walkPhase, false);
    coverPoseRig(this.mesh, this.prone);
  }

  standUp() {
    this.prone = 0;
    this.mesh.rotation.x = 0;
    this.mesh.position.y = this.baseY;
    const rig = this.mesh.userData.rig;
    if (rig?.authored) {
      rig.visual.position.y = rig.baseVisualY;
      rig.visual.rotation.x = 0;
    }
  }

  // cut loose: the bound man stands up and stops being scenery
  rescue(by = 'you', escortSlot = 0) {
    if (this.rescued || this.dead) return false;
    this.rescued = true;
    releaseHostageRig(this.mesh);
    this.standUp();            // a man you just cut loose does not stay face-down
    this.hostage = false;      // no longer bound; still protected as an evacuee
    this.panic = by !== 'you';
    this.escort = by === 'you';
    this.rescuer = by;
    this.escortSlot = Math.max(0, escortSlot | 0);
    if (this.escort) this.escortSide = this.escortSlot % 2 === 0 ? -1 : 1;
    this.escortCommand = 'follow';
    this.rush = false;         // never convert a freed hostage into a muzzle-rushing civilian
    return true;
  }

  setEscortCommand(command) {
    if (!this.wasHostage || !this.rescued || this.dead || this.rescuer !== 'you') return false;
    this.escort = true;
    this.escortCommand = command;
    this.escortHeat = 0;
    this.escortBlocked = 0;
    this.escortFreeze = 0;
    if (command === 'stay') {
      this.escortAnchor = { x: this.pos.x, z: this.pos.z };
    } else if (command === 'follow') {
      this.escortAnchor = null;
      this.standUp();
    }
    return true;
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.deathAnim = 0.001;
    deathPose(this.mesh);
    sfx.civScream(this.pos);
  }

  // Find nearby navigable ground that breaks the crouched sightline to the gunfire. Selection
  // is deterministic and biased away from the player, so a retry produces the same crowd
  // flow instead of new random obstruction. The nav path prevents "take cover" from meaning
  // sprint face-first into the nearest wall.
  findHardCover(world) {
    const nav = world.nav;
    if (!nav || nearestNode(nav, this.pos.x, this.pos.y, this.pos.z) < 0) return false;
    const threat = world.playerPos;
    const currentThreatDistance = Math.hypot(
      this.pos.x - threat.x, this.pos.z - threat.z);
    const candidates = [];
    const radius = 12;
    for (let node = 0; node < nav.nodeX.length; node++) {
      const x = nav.nodeX[node], y = nav.nodeY[node], z = nav.nodeZ[node];
      const dx = x - this.pos.x, dz = z - this.pos.z;
      if (Math.abs(dx) > radius || Math.abs(dz) > radius) continue;
      if (Math.abs(y - this.pos.y) > 1.45) continue;
      const distance = Math.hypot(dx, dz);
      if (distance < 2 || distance > radius) continue;
      const threatDistance = Math.hypot(x - threat.x, z - threat.z);
      if (threatDistance < currentThreatDistance - 0.8) continue;
      // Test at cower head height. Waist-high vehicles and barricades should count as cover;
      // a standing-eye test incorrectly rejected exactly the places civilians would kneel.
      if (hasLOS(world.solids, x, y + 0.72, z, threat.x, threat.y + 1.5, threat.z)) continue;
      let crowdPenalty = 0;
      for (const other of world.civilians || []) {
        if (other === this || !other.coverTarget) continue;
        const separation = Math.hypot(
          other.coverTarget.x - x, other.coverTarget.z - z);
        if (separation < 1.15) crowdPenalty += (1.15 - separation) * 8;
      }
      candidates.push({
        x, y, z,
        score: distance + crowdPenalty + this.random() * 0.08,
      });
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const candidate of candidates.slice(0, 8)) {
      const path = findPath(
        nav, this.pos.x, this.pos.y, this.pos.z,
        candidate.x, candidate.y, candidate.z, 520);
      if (!path?.length) continue;
      this.coverTarget = candidate;
      this.coverPath = path;
      this.coverPathIdx = 0;
      this.coverSearchDone = true;
      return true;
    }
    this.coverSearchDone = true;
    return false;
  }

  followCoverPath(dt, world) {
    if (!this.coverPath || this.coverPathIdx >= this.coverPath.length) {
      this.inHardCover = !!this.coverTarget;
      this.takeCover(dt);
      return true;
    }
    const waypoint = this.coverPath[this.coverPathIdx];
    const distance = Math.hypot(
      waypoint.x - this.pos.x, waypoint.z - this.pos.z);
    if (distance < 0.72 && Math.abs(waypoint.y - this.pos.y) < 1.5) {
      this.coverPathIdx++;
      if (this.coverPathIdx >= this.coverPath.length) {
        this.coverPath = null;
        this.inHardCover = true;
        this.takeCover(dt);
        return true;
      }
      return this.followCoverPath(dt, world);
    }
    this.panicDir = Math.atan2(
      waypoint.x - this.pos.x, waypoint.z - this.pos.z);
    this.step(dt, world, 3.45);
    return true;
  }

  update(dt, world) {
    const roundedSleeves = this.mesh.userData.rig?.roundedSleeves;
    if (roundedSleeves) {
      // Rounded limb cross-sections matter in the first-person identification envelope, not
      // across the plaza. Hysteresis prevents a civilian hovering near the cutoff from
      // toggling a draw every frame; the authored body remains visible at every distance.
      const dx = this.pos.x - world.playerPos.x;
      const dy = this.pos.y - world.playerPos.y;
      const dz = this.pos.z - world.playerPos.z;
      const limit = roundedSleeves.visible ? 6.5 : 5.5;
      roundedSleeves.visible = dx * dx + dy * dy + dz * dz < limit * limit;
      roundedSleeves.userData.lodDistance = limit;
    }
    if (this.dead) {
      this.deathAnim = animateDeathRig(this.mesh, dt);
      settleDeathRig(this.mesh, world.solids, dt);
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
        if (this.duckOnFire) this.takeCover(dt);
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
    if (this.rushDone) { this.takeCover(dt); return; }

    if (!this.rush && this.exhausted >= this.coverSearchAt) {
      if (!this.coverSearchDone) this.findHardCover(world);
      if (this.coverPath || this.inHardCover) {
        this.followCoverPath(dt, world);
        return;
      }
    }

    if (this.exhausted > 14) { this.takeCover(dt); return; }

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
    if (this.escortCommand === 'down') {
      this.takeCover(dt);
      return;
    }

    if (this.escortCommand === 'stay') {
      if (world.combatHeat > 0) {
        this.escortHeat += dt;
        if (this.escortHeat >= this.reactionDelay) this.takeCover(dt);
      } else {
        this.escortHeat = 0;
        if (this.prone > 0) this.standUp();
      }
      // Resolve back toward the exact command point if an explosion or moving crowd nudged
      // the actor. STAY is a position, not merely "stop choosing a new target".
      const anchor = this.escortAnchor;
      if (anchor) {
        const d = Math.hypot(anchor.x - this.pos.x, anchor.z - this.pos.z);
        if (d > 0.28 && this.prone < 0.25) {
          this.panicDir = Math.atan2(anchor.x - this.pos.x, anchor.z - this.pos.z);
          this.step(dt, world, 1.8);
          return;
        }
      }
      animateRig(this.mesh, this.walkPhase, false);
      return;
    }

    if (this.escortFreeze > 0) {
      this.escortFreeze -= dt;
      if (world.combatHeat > 0 && this.escortFreeze < this.reactionDelay) {
        this.takeCover(dt);
      } else {
        animateRig(this.mesh, this.walkPhase, false);
      }
      return;
    }

    const sin = Math.sin(world.playerYaw);
    const cos = Math.cos(world.playerYaw);
    // Close enough to enter the sight picture when the player turns or backs through a door.
    // That is deliberate escort pressure; the offset still keeps the hostage off the exact
    // camera centre in a straight corridor. Multiple evacuees form two staggered columns
    // instead of clipping into one actor: every extra pair occupies another metre of doorway
    // and retreat space, which is exactly the escort complication the player must manage.
    const rank = Math.floor(this.escortSlot / 2);
    const trail = 1.22 + rank * 0.92;
    const lateral = 0.58 + rank * 0.12;
    const tx = world.playerPos.x + sin * trail + cos * this.escortSide * lateral;
    const tz = world.playerPos.z + cos * trail - sin * this.escortSide * lateral;
    const distance = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (world.combatHeat > 0) {
      this.escortHeat += dt;
      if (this.escortHeat < this.reactionDelay || distance > 5) {
        if (distance > 1.25) {
          this.panicDir = Math.atan2(tx - this.pos.x, tz - this.pos.z);
          this.escortStep(dt, world, 2.8, distance);
        }
      } else {
        this.takeCover(dt);
      }
      return;
    }

    this.escortHeat = 0;
    if (this.prone > 0) this.standUp();
    if (distance > 1.15) {
      this.panicDir = Math.atan2(tx - this.pos.x, tz - this.pos.z);
      this.escortStep(dt, world, 2.55, distance);
    } else {
      animateRig(this.mesh, this.walkPhase, false);
    }
  }

  escortStep(dt, world, speed, targetDistance) {
    const moved = this.step(dt, world, speed);
    if (moved < speed * dt * 0.35 && targetDistance < 5.5) {
      this.escortBlocked += dt;
      if (this.freezeInDoorway && this.escortBlocked > 0.28) {
        this.escortFreeze = 0.65 + this.random() * 0.9;
        this.escortBlocked = 0;
      }
    } else {
      this.escortBlocked = Math.max(0, this.escortBlocked - dt * 2);
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
    const moved = Math.hypot(p.x - prev.x, p.z - prev.z);
    if (moved < s * dt * 0.35) this.panicTimer = 0;
    this.mesh.rotation.y = this.panicDir;
    this.walkPhase += s * dt * 5.5;
    animateRig(this.mesh, this.walkPhase, true, 0, true);
    const g = groundHeight(world.solids, p.x, p.z, 0.25, p.y + 0.75);
    p.y += ((g === -Infinity ? 0 : g) - p.y) * Math.min(1, dt * 10);
    this.baseY = p.y;
    return moved;
  }
}
