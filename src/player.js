import * as THREE from 'three';
import { input } from './input.js';
import { groundHeight, resolveXZ, raycastSolids } from './physics.js';
import { sfx } from './audio.js';

const RADIUS = 0.38, HEIGHT = 1.7, EYE = 1.6, CROUCH_EYE = 0.98;
const STEP = 0.6; // capsule spans two stair steps at once, so the climb allowance must clear both
const LEAN_DIST = 0.62, LEAN_ROLL = 0.2;

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, 0);   // feet position
    this.yaw = 0;
    this.pitch = 0;
    this.velY = 0;
    this.health = 100;
    this.maxHealth = 100;
    this.grounded = true;
    this.regenTimer = 0;
    this.speed = 4.6;
    this.moveSpeed = 0;
    this.dead = false;
    this.locked = false;      // sniper stage: no movement
    this.crouch = 0;          // 0..1 blend
    this.lean = 0;            // -1..1 blend
    this.stepAccum = 0;
    this.eyeHeight = EYE;
  }

  spawn(x, y, z, yawDeg, diff) {
    this.pos.set(x, y, z);
    this.yaw = yawDeg * Math.PI / 180;
    this.pitch = 0;
    this.velY = 0;
    this.maxHealth = diff.playerHealth;
    this.health = this.maxHealth;
    this.dead = false;
    this.crouch = 0;
    this.lean = 0;
  }

  damage(amt, diff) {
    if (this.dead) return;
    if (window.QA_DMG) window.QA_DMG.push([Math.round(performance.now()), amt, Math.round(this.health)]);
    this.health -= amt;
    this.regenTimer = diff.regenDelay;
    if (this.health <= 0) { this.health = 0; this.dead = true; }
  }

  update(dt, solids, diff, timeScale) {
    this.yaw -= input.lookDelta.x;
    this.pitch -= input.lookDelta.y;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

    if (this.regenTimer > 0) this.regenTimer -= dt;
    else if (this.health < this.maxHealth && !this.dead) {
      this.health = Math.min(this.maxHealth, this.health + diff.regenRate * dt);
    }

    // crouch / lean blends
    const wantCrouch = input.crouch ? 1 : 0;
    this.crouch += (wantCrouch - this.crouch) * Math.min(1, dt * 9);
    const wantLean = input.leanLeft ? -1 : input.leanRight ? 1 : 0;
    this.lean += (wantLean - this.lean) * Math.min(1, dt * 8);

    if (!this.locked) {
      const mx = input.move.x, mz = input.move.y;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // right = (cos, -sin), forward = (-sin, -cos); stick up (mz=-1) walks forward
      const wx = (mx * cos + mz * sin);
      const wz = (-mx * sin + mz * cos);
      const spd = this.speed * (input.ads ? 0.55 : 1) * (1 - this.crouch * 0.55);
      this.moveSpeed = Math.hypot(wx, wz) * spd;

      const prev = { x: this.pos.x, z: this.pos.z };
      this.pos.x += wx * spd * dt * timeScale;
      this.pos.z += wz * spd * dt * timeScale;
      // step-up assist only while grounded — airborne, ledges are walls and holes are holes,
      // otherwise crossing a stair opening glues you to the far edge instead of dropping in
      const climb = this.grounded ? STEP : 0.12;
      resolveXZ(solids, this.pos, RADIUS, this.pos.y + climb, this.pos.y + HEIGHT, prev);

      const g = groundHeight(solids, this.pos.x, this.pos.z, RADIUS * 0.8, this.pos.y + climb);
      this.velY -= 22 * dt * timeScale;
      this.pos.y += this.velY * dt * timeScale;
      if (g > -Infinity && this.pos.y <= g) {
        this.pos.y = g;
        this.velY = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
      if (this.pos.y < -25) this.damage(9999, diff);

      // own footsteps
      if (this.moveSpeed > 0.5 && this.grounded) {
        this.stepAccum += dt * this.moveSpeed;
        if (this.stepAccum > 2.6) { this.stepAccum = 0; sfx.step(); }
      }
    } else {
      this.moveSpeed = 0;
    }

    // ---- camera ----
    this.eyeHeight = EYE - (EYE - CROUCH_EYE) * this.crouch;
    let ex = this.pos.x, ez = this.pos.z;
    const eyeY = this.pos.y + this.eyeHeight;
    if (Math.abs(this.lean) > 0.01) {
      // don't lean the camera through a wall: cast toward the offset and clamp
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const want = LEAN_DIST * this.lean;
      const sgn = Math.sign(want) || 1;
      const hit = raycastSolids(solids, ex, eyeY, ez, rx * sgn, 0, rz * sgn, Math.abs(want) + 0.25);
      const allowed = Math.min(Math.abs(want), Math.max(0, hit - 0.25)) * sgn;
      ex += rx * allowed; ez += rz * allowed;
    }
    this.camera.position.set(ex, eyeY, ez);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = -this.lean * LEAN_ROLL;
  }

  forward() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }
}
