import * as THREE from 'three';
import { makeCharacter, animateRig, deathPose } from './levelgen.js';
import { groundHeight, resolveXZ, hasLOS } from './physics.js';
import { findPath, nearestNode } from './navgrid.js';
import { sfx } from './audio.js';

const EYE = 1.5;

// A* is cheap but not free: cap how many actors may repath in a single frame. The budget is
// shared with the friendly squad on purpose — the cost is per path, not per faction, and a
// squad that could path for free would let a busy frame blow past the frame budget.
let pathBudget = 5;
export function resetPathBudget() { pathBudget = 5; }
export function claimPath() {
  if (pathBudget <= 0) return false;
  pathBudget--;
  return true;
}
export function findPathFor(nav, from, tx, ty, tz) {
  return findPath(nav, from.x, from.y, from.z, tx, ty, tz);
}

export class Enemy {
  constructor(scene, def, diff) {
    this.mesh = makeCharacter({ hostile: true });
    this.mesh.position.set(def.pos[0], def.pos[1] ?? 0, def.pos[2]);
    scene.add(this.mesh);
    this.scene = scene;
    this.health = 100 * diff.enemyHealthMul;
    this.maxHealth = this.health;
    this.diff = diff;
    this.dead = false;
    this.deathAnim = 0;
    this.patrol = (def.patrol || []).map(p => ({ x: p[0], z: p[1] }));
    this.patrolIdx = 0;
    this.hold = def.hold || this.patrol.length === 0;
    this.state = 'patrol';           // patrol | alert | hunt | cover
    this.reactTimer = 0;
    this.burstTimer = 0;
    this.burstShots = 0;
    this.repositionTimer = 2 + Math.random() * 3;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.speed = 2.0 + Math.random() * 0.6;
    this.yaw = def.yaw ? def.yaw * Math.PI / 180 : Math.random() * Math.PI * 2;
    this.lastKnown = null;
    this.aggro = def.aggro || false;
    this.range = def.range || 55;
    this.walkPhase = Math.random() * 6;
    this.moving = false;
    this.inactiveTime = 0;
    this.flinch = 0;
    this.stepAccum = 0;
    this.path = null;
    this.pathIdx = 0;
    this.repathTimer = 0;
    this.pathGoal = null;
    this.coverTimer = 0;
    this.calledOut = false;
    this.tgtAlly = null;      // which friendly this man has picked, null = the player
    this.tgtTimer = Math.random() * 1.5;
    this.flee = !!def.flee;          // HVT: runs its route instead of fighting
    this.hvt = !!def.hvt;
    this.escapes = !!def.escapes;   // only a runner with somewhere to go can get away
  }

  get pos() { return this.mesh.position; }

  // Whoever shoots a man is who that man turns to face. Without this the squad could gun down
  // hostiles from the flank all mission and never once be shot back at.
  damage(amt, world, fromHead, byAlly) {
    if (this.dead) return;
    this.health -= amt;
    if (byAlly && this.state === 'patrol') this.tgtTimer = 0;   // force a retarget onto the shooter
    this.flinch = fromHead ? 0.32 : 0.22;
    if (this.state === 'patrol') {
      this.state = 'alert';
      this.reactTimer = this.diff.enemyReaction * 0.5;
      this.alertNearby(world);
    }
    if (this.health <= 0) {
      this.dead = true;
      this.deathAnim = 0.001;
      deathPose(this.mesh);
      sfx.kill();
      sfx.flesh(this.pos);
      world.onEnemyKilled(this, byAlly);
    } else {
      sfx.hit();
      sfx.flesh(this.pos);
    }
  }

  // shout brings the room in: alerted men tell the men near them
  alertNearby(world) {
    if (!this.calledOut) {
      this.calledOut = true;
      sfx.contact(this.pos);
    }
    for (const e of world.enemies) {
      if (e === this || e.dead || e.state !== 'patrol') continue;
      if (e.pos.distanceTo(this.pos) < 16) {
        e.state = 'alert';
        e.reactTimer = e.diff.enemyReaction * 1.3;
        e.lastKnown = this.lastKnown || { x: world.playerPos.x, z: world.playerPos.z, y: world.playerPos.y };
      }
    }
  }

  setPath(world, tx, ty, tz) {
    if (pathBudget <= 0 || !world.nav) return false;
    pathBudget--;
    const p = findPath(world.nav, this.pos.x, this.pos.y, this.pos.z, tx, ty, tz);
    if (p && p.length) {
      this.path = p; this.pathIdx = 0;
      this.pathGoal = { x: tx, y: ty, z: tz };
      return true;
    }
    this.path = null;
    return false;
  }

  // walk the current path; returns true while still travelling
  followPath(dt, world, speed) {
    if (!this.path || this.pathIdx >= this.path.length) return false;
    const wp = this.path[this.pathIdx];
    const d = Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z);
    if (d < 0.85 && Math.abs(wp.y - this.pos.y) < 1.6) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) { this.path = null; return false; }
      return true;
    }
    this.moveToward(wp.x, wp.z, dt, world, speed);
    return true;
  }

  // a nav node near us that the player cannot see: cover
  findCover(world) {
    const nav = world.nav;
    if (!nav) return null;
    const t = world.playerPos;
    const start = nearestNode(nav, this.pos.x, this.pos.y, this.pos.z);
    if (start < 0) return null;
    let best = null, bestScore = Infinity;
    const R = 11;
    for (let n = 0; n < nav.nodeX.length; n++) {
      const dx = nav.nodeX[n] - this.pos.x, dz = nav.nodeZ[n] - this.pos.z;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      if (Math.abs(nav.nodeY[n] - this.pos.y) > 1.5) continue;
      const d = Math.hypot(dx, dz);
      if (d < 1.5 || d > R) continue;
      if (hasLOS(world.solids, nav.nodeX[n], nav.nodeY[n] + EYE, nav.nodeZ[n], t.x, t.y + 1.5, t.z)) continue;
      const score = d; // nearest concealment wins
      if (score < bestScore) { bestScore = score; best = { x: nav.nodeX[n], y: nav.nodeY[n], z: nav.nodeZ[n] }; }
    }
    return best;
  }

  // Who this man is fighting. Held for a second and a half at a time: retargeting every frame
  // makes a hostile pivot between the player and a squadmate mid-burst and hit neither.
  //
  // The player is weighted as CLOSER than he is (0.72) so hostiles preferentially come for
  // him. A squad splits incoming fire, which is the whole point of having one, but a squad
  // that soaks all of it turns the mission into a spectator sport.
  pickTarget(world) {
    if (world.sniperTeam && !world.sniperTeam.dead) { this.tgtAlly = null; return world.sniperTeam.pos; }
    const allies = world.allies;
    if (!allies || !allies.length) { this.tgtAlly = null; return world.playerPos; }
    if (this.tgtAlly && this.tgtAlly.dead) { this.tgtAlly = null; this.tgtTimer = 0; }
    if (this.tgtTimer > 0) return this.tgtAlly ? this.tgtAlly.pos : world.playerPos;
    this.tgtTimer = 1.5 + Math.random();
    const p = this.pos;
    let best = null;
    let bestD = Math.hypot(world.playerPos.x - p.x, world.playerPos.z - p.z) * 0.72;
    for (const a of allies) {
      if (a.dead) continue;
      const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      if (d < bestD) { bestD = d; best = a; }
    }
    this.tgtAlly = best;
    return best ? best.pos : world.playerPos;
  }

  update(dt, world) {
    if (this.dead) {
      if (this.deathAnim < 1) {
        this.deathAnim = Math.min(1, this.deathAnim + dt * 3);
        this.mesh.rotation.x = -Math.PI / 2 * this.deathAnim;
      }
      return;
    }
    const p = this.pos;
    this.moving = false;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.repathTimer -= dt;

    this.tgtTimer -= dt;
    const target = this.pickTarget(world);
    const dx = target.x - p.x, dz = target.z - p.z;
    const dist = Math.hypot(dx, target.y - p.y, dz);

    const seesTarget = dist < this.range &&
      hasLOS(world.solids, p.x, p.y + EYE, p.z, target.x, target.y + (world.sniperTeam ? 1.2 : 1.5), target.z);
    const facing = Math.atan2(dx, dz);
    const inCone = Math.abs(normAng(facing - this.yaw)) < 1.35 || dist < 4;

    // --- HVT: never fights, just runs its escape route ---
    if (this.flee) {
      this.state = 'hunt';
      const route = this.patrol;
      if (route.length) {
        const wp = route[Math.min(this.patrolIdx, route.length - 1)];
        if (Math.hypot(wp.x - p.x, wp.z - p.z) < 2.0) {
          if (this.patrolIdx < route.length - 1) { this.patrolIdx++; this.path = null; }
          else if (this.escapes) this.escaped = true;   // ran the whole route: he is gone
          else { this.patrolIdx = 0; this.path = null; } // cornered: keeps circling the room
        }
        if (!this.path && this.repathTimer <= 0) {
          this.repathTimer = 1.2;
          this.setPath(world, wp.x, p.y, wp.z);
        }
        if (!this.followPath(dt, world, this.speed * 1.35)) this.moveToward(wp.x, wp.z, dt, world, this.speed * 1.35);
      }
      this.settle(dt, world);
      return;
    }

    if (this.state === 'patrol') {
      if (seesTarget && inCone) {
        this.state = 'alert';
        this.reactTimer = this.diff.enemyReaction * (0.7 + Math.random() * 0.6);
        this.lastKnown = { x: target.x, y: target.y, z: target.z };
        this.alertNearby(world);
      } else {
        this.doPatrol(dt, world);
      }
    } else {
      // alert family: engage / hunt / take cover
      if (seesTarget) {
        this.lastKnown = { x: target.x, y: target.y, z: target.z };
        this.state = this.state === 'cover' ? 'cover' : 'alert';
      }
      this.reactTimer -= dt;
      this.repositionTimer -= dt;
      this.coverTimer -= dt;

      if (seesTarget) this.yaw = lerpAng(this.yaw, facing, Math.min(1, dt * 6));

      if (this.state === 'cover') {
        // break contact, hold briefly, then push back out
        const arrived = !this.followPath(dt, world, this.speed);
        if (arrived && this.coverTimer <= 0) { this.state = 'alert'; this.path = null; this.repositionTimer = 0.5; }
        if (seesTarget && this.reactTimer <= 0) this.doShoot(dt, world, dist, target);
      } else if (seesTarget) {
        if (this.reactTimer <= 0) this.doShoot(dt, world, dist, target);
        // hurt men break contact instead of standing in the open
        const hurt = this.health < this.maxHealth * 0.45;
        if (hurt && this.coverTimer <= 0 && this.repathTimer <= 0) {
          const c = this.findCover(world);
          this.repathTimer = 2;
          if (c && this.setPath(world, c.x, c.y, c.z)) {
            this.state = 'cover';
            this.coverTimer = 2.5 + Math.random() * 2;
          }
        } else if (this.repositionTimer <= 0) {
          // sidestep so a firefight isn't two statues trading dice
          this.repositionTimer = 1.6 + Math.random() * 2.2;
          this.strafeDir *= -1;
        } else if (dist > 7) {
          const sx = Math.cos(facing) * this.strafeDir, sz = -Math.sin(facing) * this.strafeDir;
          this.moveBy(sx * this.speed * 0.45 * dt, sz * this.speed * 0.45 * dt, world);
        }
      } else if (this.lastKnown) {
        // lost him: PATH to where he was, around walls, instead of pressing into one
        this.state = 'hunt';
        const lk = this.lastKnown;
        const reached = Math.hypot(lk.x - p.x, lk.z - p.z) < 2.0;
        if (reached) {
          this.lastKnown = null; this.path = null;
          this.state = 'alert';
          this.repositionTimer = 1.5;
        } else if (this.aggro || true) {
          if ((!this.path || this.repathTimer <= 0) && this.repathTimer <= 0) {
            this.repathTimer = 1.5 + Math.random();
            this.setPath(world, lk.x, lk.y ?? p.y, lk.z);
          }
          if (!this.followPath(dt, world, this.speed)) this.moveToward(lk.x, lk.z, dt, world, this.speed * 0.8);
        }
      }
    }

    this.settle(dt, world);
  }

  settle(dt, world) {
    const p = this.pos;
    const g = groundHeight(world.solids, p.x, p.z, 0.3, p.y + 0.75);
    p.y += ((g === -Infinity ? 0 : g) - p.y) * Math.min(1, dt * 10);
    this.mesh.rotation.y = this.yaw;
    animateRig(this.mesh, this.walkPhase, this.moving, this.flinch);
    this.inactiveTime = (this.moving || this.state !== 'patrol') ? 0 : this.inactiveTime + dt;

    // footsteps: the single biggest piece of tactical information in a room-clearing game
    if (this.moving) {
      this.stepAccum += dt;
      const interval = 0.42;
      if (this.stepAccum > interval) {
        this.stepAccum = 0;
        if (p.distanceTo(world.playerPos) < 30) sfx.enemyStep(p);
      }
    } else this.stepAccum = 0.3;
  }

  doPatrol(dt, world) {
    if (this.hold) return;
    const wp = this.patrol[this.patrolIdx];
    const p = this.pos;
    if (Math.hypot(wp.x - p.x, wp.z - p.z) < 1.1) {
      this.patrolIdx = (this.patrolIdx + 1) % this.patrol.length;
      this.path = null;
      return;
    }
    if ((!this.path || !this.pathGoal || Math.hypot(this.pathGoal.x - wp.x, this.pathGoal.z - wp.z) > 1) && this.repathTimer <= 0) {
      this.repathTimer = 2 + Math.random();
      this.setPath(world, wp.x, p.y, wp.z);
    }
    if (!this.followPath(dt, world, this.speed * 0.55)) this.moveToward(wp.x, wp.z, dt, world, this.speed * 0.55);
  }

  moveToward(tx, tz, dt, world, speed) {
    const p = this.pos;
    const d = Math.hypot(tx - p.x, tz - p.z);
    if (d < 0.05) return;
    this.yaw = lerpAng(this.yaw, Math.atan2(tx - p.x, tz - p.z), Math.min(1, dt * 5));
    this.moveBy((tx - p.x) / d * speed * dt, (tz - p.z) / d * speed * dt, world);
  }

  moveBy(mx, mz, world) {
    this.moving = true;
    this.walkPhase += Math.hypot(mx, mz) * 5.5;
    const p = this.pos;
    const prev = { x: p.x, z: p.z };
    p.x += mx; p.z += mz;
    resolveXZ(world.solids, p, 0.35, p.y + 0.6, p.y + 1.6, prev);
  }

  doShoot(dt, world, dist, target) {
    this.burstTimer -= dt;
    if (this.burstTimer > 0) return;
    if (this.burstShots <= 0) {
      this.burstShots = 3 + Math.floor(Math.random() * 3);
      this.burstTimer = 0.7 + Math.random() * 0.8;
      return;
    }
    this.burstShots--;
    this.burstTimer = 0.11;
    sfx.enemyShot(this.pos);
    world.enemyFlash(this.pos);
    world.enemyTracer(this, target);
    let acc = this.diff.enemyAccuracy * Math.min(1, 18 / Math.max(6, dist));
    // The player's movement/stance modifiers must NOT apply when the round is aimed at a
    // squadmate: crouching would make an ally forty metres away harder to hit.
    if (!this.tgtAlly) {
      if (world.playerSpeed > 3) acc *= 0.55;
      if (world.playerCrouched) acc *= 0.65;   // crouching is real cover now
      if (world.playerAds) acc *= 1.1;
    }
    if (Math.random() < acc) {
      if (world.sniperTeam && !world.sniperTeam.dead) world.damageTeam(this.diff.enemyDamage);
      else if (this.tgtAlly && !this.tgtAlly.dead) this.tgtAlly.damage(this.diff.enemyDamage, world);
      else world.damagePlayer(this.diff.enemyDamage, this.pos);
    }
  }
}

function normAng(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function lerpAng(a, b, t) { return a + normAng(b - a) * t; }
