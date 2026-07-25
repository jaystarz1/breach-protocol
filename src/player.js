import * as THREE from 'three';
import { input } from './input.js';
import { groundHeight, resolveXZ } from './physics.js';

const RADIUS = 0.38, HEIGHT = 1.7, EYE = 1.6, STEP = 0.35;

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, 0);   // feet position
    this.yaw = 0;
    this.pitch = 0;
    this.velY = 0;
    this.health = 100;
    this.maxHealth = 100;
    this.regenTimer = 0;
    this.speed = 4.6;
    this.moveSpeed = 0;   // actual horizontal speed (for AI accuracy)
    this.dead = false;
    this.locked = false;  // sniper stage: no movement
  }

  spawn(x, y, z, yawDeg, diff) {
    this.pos.set(x, y, z);
    this.yaw = yawDeg * Math.PI / 180;
    this.pitch = 0;
    this.velY = 0;
    this.maxHealth = diff.playerHealth;
    this.health = this.maxHealth;
    this.dead = false;
  }

  damage(amt, diff) {
    if (this.dead) return;
    this.health -= amt;
    this.regenTimer = diff.regenDelay;
    if (this.health <= 0) { this.health = 0; this.dead = true; }
  }

  update(dt, solids, diff, timeScale) {
    // look (not slowed by slow-mo)
    this.yaw -= input.lookDelta.x;
    this.pitch -= input.lookDelta.y;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

    // regen
    if (this.regenTimer > 0) this.regenTimer -= dt;
    else if (this.health < this.maxHealth && !this.dead) {
      this.health = Math.min(this.maxHealth, this.health + diff.regenRate * dt);
    }

    if (!this.locked) {
      // movement in look direction
      const mx = input.move.x, mz = input.move.y;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const wx = (mx * cos - mz * sin);
      const wz = (-mx * sin - mz * cos);
      const spd = this.speed * (input.ads ? 0.55 : 1);
      const stepX = wx * spd * dt * timeScale;
      const stepZ = wz * spd * dt * timeScale;
      this.moveSpeed = Math.hypot(wx, wz) * spd;

      this.pos.x += stepX;
      this.pos.z += stepZ;
      resolveXZ(solids, this.pos, RADIUS, this.pos.y + STEP, this.pos.y + HEIGHT);

      // gravity + ground with step-up
      const g = groundHeight(solids, this.pos.x, this.pos.z, RADIUS * 0.8, this.pos.y + STEP);
      this.velY -= 22 * dt * timeScale;
      this.pos.y += this.velY * dt * timeScale;
      if (g > -Infinity && this.pos.y <= g) {
        this.pos.y = this.pos.y + (g - this.pos.y) * Math.min(1, dt * 18);
        if (g - this.pos.y < 0.02) this.pos.y = g;
        this.velY = 0;
      }
      if (this.pos.y < -25) { this.damage(9999, diff); } // fell out of world
    } else {
      this.moveSpeed = 0;
    }

    // camera
    this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  forward() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }
}
