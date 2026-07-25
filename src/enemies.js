import * as THREE from 'three';
import { makeCharacter } from './levelgen.js';
import { groundHeight, resolveXZ, hasLOS } from './physics.js';
import { sfx } from './audio.js';

const EYE = 1.5;

export class Enemy {
  constructor(scene, def, diff) {
    this.mesh = makeCharacter({ hostile: true });
    this.mesh.position.set(def.pos[0], def.pos[1] ?? 0, def.pos[2]);
    scene.add(this.mesh);
    this.scene = scene;
    this.health = 100 * diff.enemyHealthMul;
    this.diff = diff;
    this.dead = false;
    this.deathAnim = 0;
    this.patrol = (def.patrol || []).map(p => ({ x: p[0], z: p[1] }));
    this.patrolIdx = 0;
    this.hold = def.hold || this.patrol.length === 0;
    this.state = 'patrol';           // patrol | alert
    this.reactTimer = 0;
    this.burstTimer = 0;
    this.burstShots = 0;
    this.repositionTimer = 2 + Math.random() * 3;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.speed = 2.0 + Math.random() * 0.6;
    this.yaw = def.yaw ? def.yaw * Math.PI / 180 : Math.random() * Math.PI * 2;
    this.lastKnown = null;
    this.aggro = def.aggro || false;   // hunt player when alerted without LOS
    this.range = def.range || 55;      // spotting range
  }

  get pos() { return this.mesh.position; }

  damage(amt, world) {
    if (this.dead) return;
    this.health -= amt;
    // getting shot alerts instantly
    if (this.state !== 'alert') { this.state = 'alert'; this.reactTimer = this.diff.enemyReaction * 0.5; }
    if (this.health <= 0) {
      this.dead = true;
      this.deathAnim = 0.001;
      sfx.kill();
      world.onEnemyKilled(this);
    } else {
      sfx.hit();
    }
  }

  update(dt, world) {
    if (this.dead) {
      if (this.deathAnim < 1) {
        this.deathAnim = Math.min(1, this.deathAnim + dt * 3);
        this.mesh.rotation.x = -Math.PI / 2 * this.deathAnim;
        this.mesh.position.y += (0.1 - this.mesh.position.y) * dt * 3 * 0; // stay on floor
      }
      return;
    }
    const p = this.pos;
    const target = world.sniperTeam && !world.sniperTeam.dead ? world.sniperTeam.pos : world.playerPos;
    const dx = target.x - p.x, dz = target.z - p.z;
    const dist = Math.hypot(dx, dy3(target.y, p.y), dz);

    // --- Spotting ---
    const seesTarget = dist < this.range &&
      hasLOS(world.solids, p.x, p.y + EYE, p.z, target.x, target.y + (world.sniperTeam ? 1.2 : 1.5), target.z);
    const facing = Math.atan2(dx, dz);
    let angDiff = Math.abs(normAng(facing - this.yaw));
    const inCone = angDiff < 1.35 || dist < 4;

    if (this.state === 'patrol') {
      if (seesTarget && inCone) {
        this.state = 'alert';
        this.reactTimer = this.diff.enemyReaction * (0.7 + Math.random() * 0.6);
      } else {
        this.doPatrol(dt, world);
      }
    }

    if (this.state === 'alert') {
      if (seesTarget) this.lastKnown = { x: target.x, z: target.z };
      // face target
      this.yaw = lerpAng(this.yaw, facing, Math.min(1, dt * 6));
      this.reactTimer -= dt;
      this.repositionTimer -= dt;

      if (seesTarget && this.reactTimer <= 0) {
        this.doShoot(dt, world, dist, target);
      }
      // movement while alert: strafe or push last known position
      if (this.repositionTimer <= 0) {
        this.strafeDir *= -1;
        this.repositionTimer = 1.5 + Math.random() * 2.5;
      }
      if (!seesTarget && this.lastKnown && this.aggro) {
        this.moveToward(this.lastKnown.x, this.lastKnown.z, dt, world, this.speed);
        if (Math.hypot(this.lastKnown.x - p.x, this.lastKnown.z - p.z) < 1.5) this.lastKnown = null;
      } else if (seesTarget && dist > 6) {
        // strafe perpendicular
        const sx = Math.cos(facing) * this.strafeDir, sz = -Math.sin(facing) * this.strafeDir;
        this.moveBy(sx * this.speed * 0.5 * dt, sz * this.speed * 0.5 * dt, world);
      }
    }

    // gravity/floor
    const g = groundHeight(world.solids, p.x, p.z, 0.3, p.y + 0.6);
    p.y += ((g === -Infinity ? 0 : g) - p.y) * Math.min(1, dt * 10);
    this.mesh.rotation.y = this.yaw;
  }

  doPatrol(dt, world) {
    if (this.hold) return;
    const wp = this.patrol[this.patrolIdx];
    const p = this.pos;
    const d = Math.hypot(wp.x - p.x, wp.z - p.z);
    if (d < 0.8) { this.patrolIdx = (this.patrolIdx + 1) % this.patrol.length; return; }
    this.moveToward(wp.x, wp.z, dt, world, this.speed * 0.55);
    // walk bob
    this.mesh.position.y += Math.abs(Math.sin(performance.now() / 150)) * 0.0;
  }

  moveToward(tx, tz, dt, world, speed) {
    const p = this.pos;
    const d = Math.hypot(tx - p.x, tz - p.z);
    if (d < 0.05) return;
    const targetYaw = Math.atan2(tx - p.x, tz - p.z);
    this.yaw = lerpAng(this.yaw, targetYaw, Math.min(1, dt * 5));
    this.moveBy((tx - p.x) / d * speed * dt, (tz - p.z) / d * speed * dt, world);
  }

  moveBy(mx, mz, world) {
    const p = this.pos;
    p.x += mx; p.z += mz;
    resolveXZ(world.solids, p, 0.35, p.y + 0.2, p.y + 1.6);
  }

  doShoot(dt, world, dist, target) {
    this.burstTimer -= dt;
    if (this.burstTimer > 0) return;
    if (this.burstShots <= 0) {
      this.burstShots = 3 + Math.floor(Math.random() * 3);
      this.burstTimer = 0.7 + Math.random() * 0.8; // pause between bursts
      return;
    }
    this.burstShots--;
    this.burstTimer = 0.11;
    sfx.enemyShot(dist);
    // muzzle flash on the enemy
    world.enemyFlash(this.pos);
    // hit chance: base accuracy falls off with range, drops if player moving fast
    let acc = this.diff.enemyAccuracy * Math.min(1, 18 / Math.max(6, dist));
    if (world.playerSpeed > 3) acc *= 0.55;
    if (world.playerAds) acc *= 1.1;
    if (Math.random() < acc) {
      if (world.sniperTeam && !world.sniperTeam.dead) world.damageTeam(this.diff.enemyDamage);
      else world.damagePlayer(this.diff.enemyDamage);
    }
  }
}

function dy3(a, b) { return a - b; }
function normAng(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function lerpAng(a, b, t) { return a + normAng(b - a) * t; }
