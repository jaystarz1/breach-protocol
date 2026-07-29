import * as THREE from 'three';
import {
  makeCharacter, animateDeathRig, animateRig, deathPose, dropWeaponRig,
  revealWeaponRig, settleDeathRig, surrenderPoseRig,
} from './levelgen.js';
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

// How far a window occupant sinks to get behind the apron of his bay. Tied to windowBay()'s
// reveal: shorter than this and the top of his head still shows over the ledge.
const DUCK_DROP = 1.72;

export class Enemy {
  constructor(scene, def, diff) {
    this.concealed = !!def.concealed;
    this.bastion = !!def.bastion;
    this.mesh = makeCharacter({
      hostile: true, silhouette: !!def.silhouette, concealed: this.concealed,
      variant: def._seed, bastion: this.bastion,
    });
    this.mesh.position.set(def.pos[0], def.pos[1] ?? 0, def.pos[2]);
    // Immutable authored socket. `pos` becomes live simulation state immediately, so patrol
    // timing must never be mistaken for a different seeded encounter layout.
    this.spawnPos = this.mesh.position.clone();
    scene.add(this.mesh);
    this.scene = scene;
    this.health = 100 * diff.enemyHealthMul;
    this.maxHealth = this.health;
    this.diff = diff;
    this.dead = false;
    this.surrendered = false;
    this.executed = false;
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
    this.shotPoseTimer = 0;
    this.stepAccum = 0;
    this.path = null;
    this.pathIdx = 0;
    this.repathTimer = 0;
    this.pathGoal = null;
    this.coverTimer = 0;
    this.calledOut = false;
    this.tgtAlly = null;      // which friendly this man has picked, null = the player
    this.tgtTimer = Math.random() * 1.5;
    this.blocked = 0;         // seconds spent pushing into geometry and getting nowhere
    this.progress = 0;        // metres actually covered this frame, post-collision
    this.standoff = 7 + Math.random() * 5;   // how close this man is willing to close
    // Tactical variation is mission-seeded, not rolled every engagement. One man in four is
    // allowed to work laterally while the rest hold pressure or break contact. This creates
    // readable manoeuvre without turning every contact into random pathfinding churn.
    const tacticalSeed = Math.abs(def._seed ?? 0);
    this.tacticalRole = tacticalSeed % 4 === 1 ? 'flanker' : 'rifleman';
    this.tacticalSide = tacticalSeed % 2 ? 1 : -1;
    this.suppression = 0;
    this.suppressionSource = null;
    this.maneuverCooldown = 1.5 + (tacticalSeed % 7) * 0.37;
    this.tacticalGoal = null;
    // Surrender decisions are authored by the encounter seed rather than rolled at the
    // instant of contact. The same layout therefore produces the same personalities.
    this.surrenderEligible = tacticalSeed % 5 < 2;
    this.flee = !!def.flee;          // HVT: runs its route instead of fighting
    this.hvt = !!def.hvt;
    this.escapes = !!def.escapes;   // only a runner with somewhere to go can get away
    this.tag = def.tag || null;     // scripted-event grouping, e.g. which room this man holds
    // Window occupants. Instead of walking a patrol this man stands in a windowBay() opening,
    // rises into it to work, and sinks below the sill. `perches` are [x, sillY, z] triples and
    // the reveal built proud of them does the hiding, so ducking is real occlusion.
    //   moveEvery  — rounds fired before he gives up the window and turns up in another one.
    //                0 keeps him in whichever perch he took, which is what a rifleman holding
    //                a floor does; the sniper is the one who must never be pre-aimed.
    //   targetPlayer — everything else on the overwatch map shoots at the assault element.
    this.perches = def.perches || null;
    this.exposed = !this.perches;   // ordinary hostiles are always a valid target
    this.perchIdx = -1;
    this.up = false;                // state: working the window (vs. down behind the apron)
    this.duck = 1;                  // 0 = fully in the opening, 1 = fully below the sill
    this.shotsHere = 0;
    this.moveEvery = def.moveEvery ?? 0;
    this.targetPlayer = !!def.targetPlayer;
    this.teamOnly = !!def.teamOnly;
    this.single = !!def.single;     // aimed single rounds instead of bursts
    this.peekTimer = def.firstPeek ?? (2 + Math.random() * 3);
    this.dmgMul = def.dmgMul ?? 1;
    this.accMul = def.accMul ?? 1;
    if (this.perches) {
      this.mesh.visible = false;
      this.perchY = this.pos.y;
      // The muzzle flash IS the tell. A silhouette in an unlit room has no glint, no outline
      // and no shading to catch — the only thing that gives him away is the round going off,
      // which is the trade: you get one frame of light per shot and that is where he is.
      // Two quads, not one. A single additive plane at 160m is a warm smudge you can talk
      // yourself out of having seen; a wide halo with a small near-white core is the shape a
      // muzzle flash actually makes, and it survives the filmic curve crushing the highlight.
      const f = new THREE.Group();
      const quad = (w, h, col, z) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }));
        m.position.z = z;
        f.add(m);
        return m.material;
      };
      this.mhalo = quad(2.0, 1.35, 0xff7a10, 0);
      this.mcore = quad(0.85, 0.58, 0xfff0c8, 0.02);
      f.position.set(0.18, 1.3, 0.55);
      this.mesh.add(f);
      this.mflash = f;
      this.mflashLife = 0;
    }
  }

  get pos() { return this.mesh.position; }

  revealWeapon() {
    if (!this.concealed) return;
    this.concealed = false;
    revealWeaponRig(this.mesh);
  }

  hasSupport(world, radius = 10) {
    return world.enemies.some(other =>
      other !== this && !other.dead && !other.surrendered && !other.escaped
      && Math.abs(other.pos.y - this.pos.y) < 2.2
      && Math.hypot(other.pos.x - this.pos.x, other.pos.z - this.pos.z) < radius);
  }

  trySurrender(world, reason = 'suppressed', force = false) {
    if (this.dead || this.surrendered || this.hvt || this.bastion || this.flee
        || this.perches || this.concealed) return false;
    if (!force && (!this.surrenderEligible || this.hasSupport(world))) return false;
    const hurtEnough = this.health <= this.maxHealth * 0.38 && this.suppression >= 0.68;
    const stunnedEnough = reason === 'flash' && this.suppression >= 0.78;
    if (!force && !hurtEnough && !stunnedEnough) return false;
    this.surrendered = true;
    this.state = 'surrender';
    this.path = null;
    this.pathGoal = null;
    this.lastKnown = null;
    this.tacticalGoal = null;
    this.burstShots = 0;
    this.burstTimer = 999;
    this.moving = false;
    this.shotPoseTimer = 0;
    const floor = groundHeight(
      world.solids, this.pos.x, this.pos.z, 0.3, this.pos.y + 0.75);
    dropWeaponRig(this.mesh, this.scene, floor === -Infinity ? this.pos.y : floor);
    surrenderPoseRig(this.mesh);
    world.onEnemySurrendered?.(this, reason);
    return true;
  }

  applyFlashStun(power, world) {
    if (this.dead || this.surrendered) return false;
    this.reactTimer = Math.max(this.reactTimer, 1 + power * 3.5);
    this.burstShots = 0;
    this.burstTimer = 1.2;
    this.state = 'alert';
    this.suppression = Math.min(1, this.suppression + power * 0.92);
    return this.trySurrender(world, 'flash');
  }

  // Whoever shoots a man is who that man turns to face. Without this the squad could gun down
  // hostiles from the flank all mission and never once be shot back at.
  damage(amt, world, fromHead, byAlly) {
    if (this.dead) return;
    const wasDetainee = this.surrendered;
    this.health -= amt;
    this.suppression = Math.min(1, this.suppression + (fromHead ? 0.7 : 0.42));
    if (byAlly && this.state === 'patrol') this.tgtTimer = 0;   // force a retarget onto the shooter
    this.flinch = fromHead ? 0.32 : 0.22;
    if (this.state === 'patrol') {
      this.revealWeapon();
      this.state = 'alert';
      this.reactTimer = this.diff.enemyReaction * 0.5;
      this.alertNearby(world);
    }
    if (this.health <= 0) {
      this.executed = wasDetainee;
      this.surrendered = false;
      this.dead = true;
      this.deathAnim = 0.001;
      deathPose(this.mesh);
      sfx.kill();
      sfx.flesh(this.pos);
      world.onEnemyKilled(this, byAlly);
    } else {
      sfx.hit();
      sfx.flesh(this.pos);
      this.trySurrender(world, 'suppressed');
    }
  }

  // shout brings the room in: alerted men tell the men near them
  alertNearby(world) {
    if (!this.calledOut) {
      this.calledOut = true;
      sfx.contact(this.pos);
    }
    for (const e of world.enemies) {
      if (e === this || e.dead || e.surrendered || e.state !== 'patrol') continue;
      if (e.pos.distanceTo(this.pos) < 16) {
        e.revealWeapon();
        e.state = 'alert';
        e.reactTimer = e.diff.enemyReaction * 1.3;
        e.lastKnown = this.lastKnown || { x: world.playerPos.x, z: world.playerPos.z, y: world.playerPos.y };
      }
    }
  }

  // Gunfire is heard through walls, but it reports a source—not the player's continuing
  // position. A patrol investigates that last-known point and still needs sight before it can
  // present a weapon or shoot. Window specialists and the fleeing HVT retain authored logic.
  hearGunshot(origin, world, radius = 55) {
    if (this.dead || this.surrendered || this.perches || this.flee) return false;
    const distance = Math.hypot(
      origin.x - this.pos.x, origin.y - this.pos.y, origin.z - this.pos.z);
    if (distance > radius) return false;
    const source = { x: origin.x, y: origin.y - 1.25, z: origin.z };
    const investigates = distance <= Math.min(radius, 34);
    if (investigates) this.lastKnown = source;
    else this.heardBearing = Math.atan2(origin.x - this.pos.x, origin.z - this.pos.z);
    if (this.state === 'patrol') {
      // A nearby report gets an investigation. A distant report only puts the position on
      // alert; otherwise one rifle shot at the north end of a long level makes the entire
      // map abandon authored positions and conga-line toward the player.
      this.state = investigates ? 'hunt' : 'alert';
      this.reactTimer = Math.max(
        this.reactTimer, this.diff.enemyReaction * (1.05 + distance / radius * 0.45));
      this.repathTimer = 0;
      this.path = null;
    }
    return true;
  }

  applySuppression(amount, source, world) {
    if (this.dead || this.surrendered || this.perches || this.flee) return false;
    this.suppression = Math.min(1, this.suppression + amount);
    this.suppressionSource = source
      ? { x: source.x, y: source.y - 1.25, z: source.z } : null;
    if (source) this.lastKnown = { ...this.suppressionSource };
    if (this.state === 'patrol') {
      this.state = 'hunt';
      this.reactTimer = Math.max(this.reactTimer, this.diff.enemyReaction * 0.8);
    }
    if (this.maneuverCooldown <= 0) this.planTacticalMove(world);
    this.trySurrender(world, 'suppressed');
    return true;
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

  findTacticalPosition(world, mode) {
    const nav = world.nav;
    if (!nav || nearestNode(nav, this.pos.x, this.pos.y, this.pos.z) < 0) return null;
    const target = this.suppressionSource || this.lastKnown || world.playerPos;
    const currentThreatDistance = Math.hypot(
      this.pos.x - target.x, this.pos.z - target.z);
    const currentAngle = Math.atan2(this.pos.z - target.z, this.pos.x - target.x);
    let best = null, bestScore = Infinity;
    for (let node = 0; node < nav.nodeX.length; node++) {
      const x = nav.nodeX[node], y = nav.nodeY[node], z = nav.nodeZ[node];
      if (Math.abs(y - this.pos.y) > 1.45) continue;
      const travel = Math.hypot(x - this.pos.x, z - this.pos.z);
      if (travel < 4.5 || travel > 14) continue;
      const threatDistance = Math.hypot(x - target.x, z - target.z);
      const visible = hasLOS(
        world.solids, x, y + EYE, z, target.x, target.y + 1.45, target.z);
      let score;
      if (mode === 'retreat') {
        if (threatDistance < currentThreatDistance + 2 || visible) continue;
        score = travel - (threatDistance - currentThreatDistance) * 0.8;
      } else {
        if (!visible || threatDistance < 7 || threatDistance > 24) continue;
        const candidateAngle = Math.atan2(z - target.z, x - target.x);
        const sweep = normAng(candidateAngle - currentAngle);
        if (Math.sign(sweep || this.tacticalSide) !== this.tacticalSide) continue;
        const lateral = Math.abs(sweep);
        if (lateral < 0.58 || lateral > 1.85) continue;
        score = travel + Math.abs(lateral - 1.05) * 3 + Math.abs(threatDistance - 13) * 0.2;
      }
      if (score < bestScore) {
        bestScore = score;
        best = { x, y, z };
      }
    }
    return best;
  }

  planTacticalMove(world, forcedMode = null) {
    if (this.dead || this.surrendered || this.perches || this.flee || this.maneuverCooldown > 0) return false;
    let mode = forcedMode;
    if (!mode) {
      const badlyHurt = this.health < this.maxHealth * 0.48;
      mode = badlyHurt || this.suppression > 0.72
        ? 'retreat' : this.tacticalRole === 'flanker' ? 'flank' : 'cover';
    }
    const goal = mode === 'cover'
      ? this.findCover(world) : this.findTacticalPosition(world, mode);
    this.maneuverCooldown = 3.8 + (Math.abs(this.mesh.userData.rig?.variant || 0) % 5) * 0.42;
    if (!goal || !this.setPath(world, goal.x, goal.y, goal.z)) return false;
    this.state = mode;
    this.tacticalGoal = goal;
    this.coverTimer = mode === 'cover' ? 2.2 : 0;
    this.repositionTimer = 1.2;
    return true;
  }

  // Who this man is fighting. Held for a second and a half at a time: retargeting every frame
  // makes a hostile pivot between the player and a squadmate mid-burst and hit neither.
  //
  // The player is weighted as CLOSER than he is (0.72) so hostiles preferentially come for
  // him. A squad splits incoming fire, which is the whole point of having one, but a squad
  // that soaks all of it turns the mission into a spectator sport.
  pickTarget(world) {
    // The sniper is the one thing on the overwatch map that is not shooting at the assault
    // element. He is shooting at YOU, which is what makes finding him urgent rather than tidy.
    if (this.targetPlayer) { this.tgtAlly = null; return world.playerPos; }
    if (world.sniperTeam && !world.sniperTeam.dead) { this.tgtAlly = null; return world.sniperTeam.pos; }
    const allies = world.allies;
    // Window riflemen are shooting DOWN at the element in the plaza. Left to the normal
    // weighting they would occasionally swing onto a player who is 160m away behind a
    // parapet, which wastes the one thing they exist to create: pressure on the team.
    if (this.teamOnly && allies && allies.length) {
      if (this.tgtAlly && this.tgtAlly.dead) this.tgtAlly = null;
      if (this.tgtAlly && this.tgtTimer > 0) return this.tgtAlly.pos;
      this.tgtTimer = 1.5 + Math.random();
      let near = null, nd = Infinity;
      for (const a of allies) {
        if (a.dead) continue;
        const d = Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z);
        if (d < nd) { nd = d; near = a; }
      }
      this.tgtAlly = near;
      if (near) return near.pos;
    }
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

  // Peek / shoot / vanish. No pathing, no gravity, no ground snap: he is standing in a window
  // opening several metres up a solid facade, and settle() would drop him straight to street
  // level the first frame.
  // Take a fresh opening. Never the one he just left: a shooter who can come back to the same
  // hole is a shooter you can pre-aim, and pre-aiming is the entire thing this defeats.
  takePerch() {
    let i = this.perchIdx;
    for (let n = 0; n < 10 && i === this.perchIdx; n++) i = Math.floor(Math.random() * this.perches.length);
    this.perchIdx = i;
    const p = this.perches[i];
    this.perchY = p[1];
    this.pos.set(p[0], p[1] - DUCK_DROP, p[2]);
    this.up = true;
    this.mesh.visible = true;
    this.shotsHere = 0;
    // Time in the opening. A man who leaves on a shot count needs long enough to actually
    // FIRE that many rounds, or the timer wins every time and "moves after two shots" quietly
    // becomes "moves after one" — the timer is only his backstop for a target he never gets.
    this.peekTimer = (this.moveEvery ? 10 : 4.0) + Math.random() * 3;
    this.reactTimer = 1.1;    // the beat the player has to spot him and react in
    this.burstShots = 0;
    this.burstTimer = 0.5;
  }

  // Rise / work / sink. No pathing, no gravity, no ground snap: he is standing on a floor
  // several metres up inside a solid shell, and settle() would drop him to street level on
  // the first frame.
  updateSniper(dt, world) {
    if (this.mflashLife > 0) {
      const f = this.mflashLife = Math.max(0, this.mflashLife - dt * 14);
      this.mhalo.opacity = f * 0.72;
      this.mcore.opacity = f * f;
      this.mflash.scale.setScalar(1.2 - f * 0.3);
      this.mflash.visible = f > 0.02;
    }
    if (this.dead) {
      if (this.mflash) this.mflash.visible = false;
      this.deathAnim = animateDeathRig(this.mesh, dt);
      return;
    }
    this.shotPoseTimer = Math.max(0, this.shotPoseTimer - dt);
    this.peekTimer -= dt;
    this.flinch = Math.max(0, this.flinch - dt * 3);

    this.duck = Math.max(0, Math.min(1, this.duck + (this.up ? -1 : 1) * dt * 3.2));
    this.pos.y = this.perchY - DUCK_DROP * this.duck;
    // Hit gating. This is deliberately a shade tighter than "not fully down": a torso that
    // is two thirds behind the apron should not be a free kill, and the same threshold gates
    // the overwatch marker so it cannot betray a window he is not actually in.
    this.exposed = this.duck < 0.55;

    if (!this.up) {
      if (this.duck >= 1) this.mesh.visible = false;
      if (this.peekTimer > 0) return;
      this.takePerch();
      return;
    }

    // In the opening: track whoever he is working and shoot them.
    const t = this.pickTarget(world);
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
    this.yaw = lerpAng(this.yaw, Math.atan2(dx, dz), Math.min(1, dt * 4));
    this.mesh.rotation.y = this.yaw;
    animateRig(
      this.mesh, this.walkPhase, false, this.flinch, false,
      this.shotPoseTimer > 0 ? 'firing' : 'engage',
    );
    this.reactTimer -= dt;
    const dist = Math.hypot(dx, t.y - this.pos.y, dz);
    if (this.reactTimer <= 0 && this.duck < 0.25) this.doShoot(dt, world, dist, t);

    // Down again: either his time is up, or he has fired his allotted rounds from this hole.
    const worked = this.moveEvery > 0 && this.shotsHere >= this.moveEvery;
    if (this.peekTimer <= 0 || worked) {
      this.up = false;
      this.peekTimer = (worked ? 2.2 : 3.2) + Math.random() * 3;
    }
  }

  update(dt, world) {
    if (this.perches) { this.updateSniper(dt, world); return; }
    if (this.dead) {
      this.deathAnim = animateDeathRig(this.mesh, dt);
      settleDeathRig(this.mesh, world.solids, dt);
      return;
    }
    if (this.surrendered) {
      this.moving = false;
      this.burstShots = 0;
      this.shotPoseTimer = 0;
      const g = groundHeight(world.solids, this.pos.x, this.pos.z, 0.3, this.pos.y + 0.75);
      this.pos.y += ((g === -Infinity ? 0 : g) - this.pos.y) * Math.min(1, dt * 10);
      return;
    }
    this.shotPoseTimer = Math.max(0, this.shotPoseTimer - dt);
    const p = this.pos;
    this.moving = false;
    this.progress = 0;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.repathTimer -= dt;
    this.maneuverCooldown -= dt;
    this.suppression = Math.max(0, this.suppression - dt * 0.16);

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

    if (this.suppression > 0.38 && this.maneuverCooldown <= 0
        && !['cover', 'flank', 'retreat'].includes(this.state)) {
      this.planTacticalMove(world);
    }

    if (this.state === 'patrol') {
      if (seesTarget && inCone) {
        this.revealWeapon();
        this.state = 'alert';
        this.reactTimer = this.diff.enemyReaction * (0.7 + Math.random() * 0.6);
        this.lastKnown = { x: target.x, y: target.y, z: target.z };
        this.alertNearby(world);
      } else {
        this.doPatrol(dt, world);
      }
    } else {
      // Alert family: investigate, engage, suppress, flank, retreat or take cover.
      if (seesTarget) {
        this.lastKnown = { x: target.x, y: target.y, z: target.z };
        if (this.concealed) {
          this.revealWeapon();
          // Hearing can bring a disguised infiltrator toward the shot, but the visible draw
          // tell still buys the player a reaction window before that man can fire.
          this.reactTimer = Math.max(this.reactTimer, this.diff.enemyReaction * 0.8 + 0.2);
        }
        if (!['cover', 'flank', 'retreat'].includes(this.state)) this.state = 'alert';
      }
      this.reactTimer -= dt;
      this.repositionTimer -= dt;
      this.coverTimer -= dt;

      if (seesTarget) this.yaw = lerpAng(this.yaw, facing, Math.min(1, dt * 6));

      if (this.state === 'flank' || this.state === 'retreat') {
        const maneuver = this.state;
        const travelling = this.followPath(
          dt, world, this.speed * (maneuver === 'retreat' ? 1.18 : 0.92));
        if (!travelling) {
          this.state = 'alert';
          this.tacticalGoal = null;
          this.path = null;
          this.repositionTimer = maneuver === 'flank' ? 0.35 : 1.1;
        }
      } else if (this.state === 'cover') {
        // break contact, hold briefly, then push back out
        const arrived = !this.followPath(dt, world, this.speed);
        if (arrived && this.coverTimer <= 0) { this.state = 'alert'; this.path = null; this.repositionTimer = 0.5; }
        if (seesTarget && this.reactTimer <= 0) this.doShoot(dt, world, dist, target);
      } else if (seesTarget) {
        if (this.reactTimer <= 0) this.doShoot(dt, world, dist, target);
        // Close to a firing position, then STOP. Walking all the way onto the man you are
        // shooting at is both wrong and the thing that jammed everyone into the fountain.
        if (dist > this.standoff && this.repathTimer <= 0 && this.blocked < 0.8) {
          this.moveToward(target.x, target.z, dt, world, this.speed * 0.75);
        }
        // hurt men break contact instead of standing in the open
        const hurt = this.health < this.maxHealth * 0.45;
        if (hurt && this.coverTimer <= 0 && this.repathTimer <= 0) {
          this.maneuverCooldown = Math.min(0, this.maneuverCooldown);
          this.planTacticalMove(world, 'retreat');
          this.repathTimer = 1.6;
        } else if (this.suppression > 0.38 && this.maneuverCooldown <= 0) {
          this.planTacticalMove(world);
        } else if (this.repositionTimer <= 0) {
          if (this.tacticalRole === 'flanker' && this.maneuverCooldown <= 0) {
            this.planTacticalMove(world, 'flank');
          }
          if (this.state === 'alert') {
            // A short local sidestep remains the fallback when no validated flank socket can
            // be reached inside the shared path budget.
            this.repositionTimer = 1.6 + Math.random() * 2.2;
            this.strafeDir *= -1;
          }
        } else if (dist > 7) {
          const sx = Math.cos(facing) * this.strafeDir, sz = -Math.sin(facing) * this.strafeDir;
          this.moveBy(sx * this.speed * 0.45 * dt, sz * this.speed * 0.45 * dt, world);
        }
      } else if (this.lastKnown) {
        // lost him: PATH to where he was, around walls, instead of pressing into one
        this.state = 'hunt';
        const lk = this.lastKnown;
        // 2.0m was not reachable when the last known position is INSIDE a solid — which is
        // exactly the case on the sniper map, where the target is the assault team sitting on
        // the fountain. A* refuses to route into a solid, the straight-line fallback walks
        // into the wall, collision cancels it, and "reached" never becomes true. Every hostile
        // on the level then grinds against the same face at the same point, stacked inside one
        // another, which is why some of them could not be shot at all. Giving up on arrival
        // once we are wedged is what actually breaks the loop.
        const reached = Math.hypot(lk.x - p.x, lk.z - p.z) < 2.0 || this.blocked > 1.2;
        if (reached) {
          this.lastKnown = null; this.path = null;
          this.state = 'alert';
          this.repositionTimer = 1.5;
          this.blocked = 0;
        } else {
          if (this.repathTimer <= 0) {
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
    // Wedge accounting. `progress` is post-collision, so this measures ground actually covered
    // rather than ground requested — the only version that catches being pinned on geometry.
    if (this.moving) {
      if (this.progress < this.speed * dt * 0.25) this.blocked += dt; else this.blocked = 0;
    } else this.blocked = Math.max(0, this.blocked - dt * 0.5);
    this.separate(world);
    const g = groundHeight(world.solids, p.x, p.z, 0.3, p.y + 0.75);
    p.y += ((g === -Infinity ? 0 : g) - p.y) * Math.min(1, dt * 10);
    this.mesh.rotation.y = this.yaw;
    const intent = this.flee ? 'flee'
      : this.shotPoseTimer > 0 ? 'firing'
        : this.state === 'patrol' ? 'patrol' : 'engage';
    animateRig(this.mesh, this.walkPhase, this.moving, this.flinch, false, intent);
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

  // Bodies do not occupy the same cubic metre. Without this, several men converging on one
  // objective end up at the identical coordinate — visually one silhouette, and a bullet that
  // kills the front one leaves the rest hidden inside him and effectively unshootable. Cheap
  // O(n^2) over live hostiles, which is at most a couple of hundred checks a frame here.
  separate(world) {
    if (this.dead) return;
    const p = this.pos;
    const MIN = 1.05;
    for (const o of world.enemies) {
      if (o === this || o.dead) continue;
      if (Math.abs(o.pos.y - p.y) > 1.2) continue;      // different floor, not crowding
      const dx = p.x - o.pos.x, dz = p.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= MIN) continue;
      // Perfectly coincident is the case that matters most and has no direction to push along,
      // so derive a stable one from identity rather than random jitter.
      if (d < 0.001) {
        const a = (this.walkPhase * 7.13) % (Math.PI * 2);
        p.x += Math.cos(a) * 0.06; p.z += Math.sin(a) * 0.06;
        continue;
      }
      const push = (MIN - d) * 0.5;
      p.x += dx / d * push; p.z += dz / d * push;
    }
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
    this.progress = Math.hypot(p.x - prev.x, p.z - prev.z);
  }

  doShoot(dt, world, dist, target) {
    if (this.concealed || this.surrendered) return;
    this.burstTimer -= dt;
    if (this.burstTimer > 0) return;
    if (this.burstShots <= 0) {
      const normalBurst = 3 + Math.floor(Math.random() * 3);
      this.burstShots = this.single
        ? 1 : Math.max(1, Math.round(normalBurst * (1 - this.suppression * 0.62)));
      this.burstTimer = this.single
        ? 0.9 + Math.random() * 0.5
        : 0.7 + Math.random() * 0.8 + this.suppression * 0.7;
      return;
    }
    this.burstShots--;
    this.burstTimer = this.single ? 1.7 + Math.random() : 0.11;
    this.shotsHere++;
    this.shotPoseTimer = 0.2;
    sfx.enemyShot(this.pos);
    world.enemyFlash(this.pos);
    world.enemyTracer(this, target);
    if (this.mflash) { this.mflashLife = 1; this.mflash.visible = true; }
    // Range falloff models a man hosing bursts, and applying it to an aimed round through
    // glass turns the sniper into a 4%-per-shot novelty at 160m — which is to say, not a
    // sniper. A single deliberate shot pays a flat penalty instead and does not care how
    // far away you are. That is the entire reason he is frightening.
    let acc = this.diff.enemyAccuracy * this.accMul
      * (this.single ? 0.5 : Math.min(1, 18 / Math.max(6, dist)));
    acc *= 1 - this.suppression * 0.58;
    // The player's movement/stance modifiers must NOT apply when the round is aimed at a
    // squadmate: crouching would make an ally forty metres away harder to hit.
    if (!this.tgtAlly) {
      if (world.playerSpeed > 3) acc *= 0.55;
      if (world.playerCrouched) acc *= 0.65;   // crouching is real cover now
      if (world.playerAds) acc *= 1.1;
    }
    if (Math.random() < acc) {
      if (this.targetPlayer) world.damagePlayer(this.diff.enemyDamage * this.dmgMul, this.pos);
      else if (world.sniperTeam && !world.sniperTeam.dead) world.damageTeam(this.diff.enemyDamage);
      else if (this.tgtAlly && !this.tgtAlly.dead) this.tgtAlly.damage(this.diff.enemyDamage * this.dmgMul, world);
      else world.damagePlayer(this.diff.enemyDamage * this.dmgMul, this.pos);
    }
  }
}

function normAng(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function lerpAng(a, b, t) { return a + normAng(b - a) * t; }
