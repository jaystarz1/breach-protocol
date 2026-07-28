import * as THREE from 'three';
import { groundHeight, hasLOS, raycastSolids } from './physics.js';

const MAX_RANGE = 95;
const MAX_SPEED = 16;

export class DroneController {
  constructor(scene, camera, definition, onComplete) {
    this.scene = scene;
    this.camera = camera;
    this.launch = new THREE.Vector3(...definition.launch);
    this.pos = this.launch.clone();
    this.pos.y += 1.7;
    this.vel = new THREE.Vector3();
    this.yaw = definition.yaw ?? Math.PI;
    this.pitch = -0.08;
    this.roll = 0;
    this.battery = 100;
    this.signal = 1;
    this.active = true;
    this.complete = false;
    this.onComplete = onComplete;
    this.targets = (definition.targets || []).map((p, index) => ({
      pos: new THREE.Vector3(...p),
      marked: false,
      index,
    }));
    this.savedFov = camera.fov;
    this.childVisibility = camera.children.map(child => [child, child.visible]);
    for (const [child] of this.childVisibility) child.visible = false;
    this.hiddenHud = [
      'health-bar', 'ammo', 'weapon-name', 'squad-line', 'score-line', 'crosshair',
    ].map(id => [document.getElementById(id), document.getElementById(id)?.style.display || '']);
    for (const [element] of this.hiddenHud) if (element) element.style.display = 'none';
    camera.fov = 92;
    camera.updateProjectionMatrix();

    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.next = new THREE.Vector3();
    this.move = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.targetMeshes = [];
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x63e6ff, transparent: true, opacity: 0.5,
      depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    });
    for (const target of this.targets) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 24), ringMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(target.pos);
      ring.position.y += 0.06;
      scene.add(ring);
      this.targetMeshes.push(ring);
    }

    this.overlay = document.createElement('div');
    this.overlay.innerHTML = `
      <div class="drone-frame"></div>
      <div class="drone-reticle"><i></i><b></b></div>
      <div class="drone-label">VEKTOR ISR // ${definition.label || 'TACTICAL UAS'}</div>
      <div class="drone-status"></div>
      <div class="drone-help">WASD FLIGHT · MOUSE/ARROWS LOOK · RMB/Z CLIMB · CTRL/C DESCEND · FIRE MARK</div>
    `;
    Object.assign(this.overlay.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 40,
      color: '#a7f3ff', font: '11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace',
      textShadow: '0 1px 4px #000',
      background: 'repeating-linear-gradient(0deg,rgba(90,220,255,.025) 0,rgba(90,220,255,.025) 1px,transparent 1px,transparent 4px)',
      boxShadow: 'inset 0 0 120px rgba(0,0,0,.52)',
    });
    const style = document.createElement('style');
    style.textContent = `
      .drone-frame{position:absolute;inset:18px;border:1px solid rgba(130,238,255,.34)}
      .drone-reticle{position:absolute;left:50%;top:50%;width:56px;height:56px;transform:translate(-50%,-50%);border:1px solid rgba(160,245,255,.7);border-radius:50%}
      .drone-reticle i,.drone-reticle b{position:absolute;display:block;background:#baf8ff}
      .drone-reticle i{width:76px;height:1px;left:-10px;top:27px}
      .drone-reticle b{height:76px;width:1px;top:-10px;left:27px}
      .drone-label{position:absolute;left:34px;top:30px;letter-spacing:2px}
      .drone-status{position:absolute;right:34px;top:30px;text-align:right;white-space:pre}
      .drone-help{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);letter-spacing:1px}
    `;
    this.overlay.appendChild(style);
    document.body.appendChild(this.overlay);
    this.status = this.overlay.querySelector('.drone-status');
  }

  update(dt, input, solids) {
    if (!this.active) return;
    this.yaw -= input.lookDelta.x * 0.72;
    this.pitch = Math.max(-1.15, Math.min(0.72, this.pitch - input.lookDelta.y * 0.62));
    this.roll += ((-input.move.x * 0.42) - this.roll) * Math.min(1, dt * 6);

    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const thrust = -input.move.y;
    this.vel.addScaledVector(this.forward, thrust * 19 * dt);
    this.vel.addScaledVector(this.right, input.move.x * 11 * dt);
    if (input.ads) this.vel.y += 10 * dt;
    if (input.crouch) this.vel.y -= 9 * dt;
    const damping = Math.exp(-1.45 * dt);
    this.vel.multiplyScalar(damping);
    if (this.vel.length() > MAX_SPEED) this.vel.setLength(MAX_SPEED);

    this.next.copy(this.pos).addScaledVector(this.vel, dt);
    this.move.copy(this.next).sub(this.pos);
    const distance = this.move.length();
    if (distance > 0.001) {
      this.move.multiplyScalar(1 / distance);
      const hit = raycastSolids(
        solids, this.pos.x, this.pos.y, this.pos.z,
        this.move.x, this.move.y, this.move.z, distance + 0.16);
      if (hit > distance) this.pos.copy(this.next);
      else this.vel.multiplyScalar(-0.18);
    }
    const ground = groundHeight(solids, this.pos.x, this.pos.z, 0.12, this.pos.y + 1);
    this.pos.y = Math.max((ground === -Infinity ? 0 : ground) + 0.65, Math.min(34, this.pos.y));

    const fromLaunch = this.pos.distanceTo(this.launch);
    this.signal = Math.max(0, Math.min(1, 1 - fromLaunch / MAX_RANGE));
    this.battery = Math.max(0, this.battery - dt * (0.72 + this.vel.length() / MAX_SPEED * 0.42));
    if (this.signal <= 0.02 || this.battery <= 0) this.resetAircraft();

    this.camera.position.copy(this.pos);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, this.roll);

    let candidate = null;
    let bestDot = 0.965;
    for (const target of this.targets) {
      const ring = this.targetMeshes[target.index];
      ring.visible = !target.marked;
      ring.rotation.z += dt * 0.45;
      if (target.marked) continue;
      this.to.copy(target.pos).sub(this.pos);
      const range = this.to.length();
      if (range > 58) continue;
      this.to.multiplyScalar(1 / range);
      const dot = this.forward.dot(this.to);
      if (dot <= bestDot) continue;
      if (!hasLOS(solids, this.pos.x, this.pos.y, this.pos.z,
        target.pos.x, target.pos.y + 0.5, target.pos.z)) continue;
      bestDot = dot;
      candidate = target;
    }
    if (candidate && input.firePressed) {
      candidate.marked = true;
      this.targetMeshes[candidate.index].visible = false;
    }
    let marked = 0;
    for (const target of this.targets) if (target.marked) marked++;
    this.status.textContent = [
      `LINK ${Math.round(this.signal * 100)}%`,
      `BAT ${Math.round(this.battery)}%`,
      `GRID ${marked}/${this.targets.length}`,
    ].join('\n');
    this.overlay.style.opacity = String(0.72 + this.signal * 0.28);
    if (marked === this.targets.length && !this.complete) {
      this.complete = true;
      this.status.textContent += '\nUPLOAD COMPLETE';
      setTimeout(() => this.onComplete?.(), 650);
    }
  }

  resetAircraft() {
    this.pos.copy(this.launch);
    this.pos.y += 1.7;
    this.vel.set(0, 0, 0);
    this.battery = Math.max(42, this.battery);
    this.signal = 1;
  }

  dispose() {
    this.active = false;
    this.camera.fov = this.savedFov;
    this.camera.updateProjectionMatrix();
    for (const [child, visible] of this.childVisibility) child.visible = visible;
    for (const [element, display] of this.hiddenHud) if (element) element.style.display = display;
    for (const mesh of this.targetMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.overlay.remove();
  }
}
