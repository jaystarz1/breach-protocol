import * as THREE from 'three';
import { sfx } from './audio.js';

export const WEAPON_SPECS = {
  pistol: {
    name: 'M9 SIDEARM', auto: false, damage: 34, rpm: 320, mag: 12, reserve: Infinity,
    spread: 0.012, adsSpread: 0.004, recoil: 0.022, range: 60, reloadTime: 1.3,
    adsFov: 55, sound: 'pistol',
  },
  m4: {
    name: 'M4 CARBINE', auto: true, damage: 26, rpm: 700, mag: 30, reserve: 120,
    spread: 0.02, adsSpread: 0.006, recoil: 0.014, range: 120, reloadTime: 2.0,
    adsFov: 45, sound: 'rifle',
  },
  barrett: {
    name: 'BARRETT M82 .50', auto: false, damage: 500, rpm: 35, mag: 10, reserve: 30,
    spread: 0.09, adsSpread: 0.0, recoil: 0.09, range: 600, reloadTime: 3.2,
    adsFov: 7, sound: 'sniper', scoped: true, sway: 0.006,
  },
};

function gunMesh(kind) {
  const g = new THREE.Group();
  g.scale.setScalar(0.62);
  const mat = new THREE.MeshLambertMaterial({ color: 0x3a4148 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x23282d });
  if (kind === 'pistol') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.26), mat));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.07), dark);
    grip.position.set(0, -0.1, 0.08); grip.rotation.x = 0.25; g.add(grip);
  } else if (kind === 'm4') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.09, 0.62), mat));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), dark);
    grip.position.set(0, -0.1, 0.12); grip.rotation.x = 0.2; g.add(grip);
    const magM = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), dark);
    magM.position.set(0, -0.11, -0.05); magM.rotation.x = -0.15; g.add(magM);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.2), dark);
    stock.position.set(0, -0.02, 0.35); g.add(stock);
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 1.25), mat));
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28), dark);
    scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.09, 0.1); g.add(scope);
    const bipod = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.02), dark);
    bipod.position.set(0.05, -0.12, -0.45); g.add(bipod);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.12), dark);
    muzzle.position.set(0, 0, -0.66); g.add(muzzle);
  }
  return g;
}

export class Weapons {
  constructor(camera) {
    this.camera = camera;
    this.holder = new THREE.Group();
    camera.add(this.holder);
    this.holder.position.set(0.22, -0.22, -0.45);
    this.meshes = {};
    for (const k of Object.keys(WEAPON_SPECS)) {
      this.meshes[k] = gunMesh(k);
      this.meshes[k].visible = false;
      this.holder.add(this.meshes[k]);
    }
    // muzzle flash: point light + visible star billboard
    this.flash = new THREE.PointLight(0xffcc66, 0, 14);
    this.flash.position.set(0, 0, -0.55);
    this.holder.add(this.flash);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffe0a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.flashMesh = new THREE.Group();
    for (const rot of [0, Math.PI / 3, -Math.PI / 3]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.1), flashMat);
      plane.rotation.z = rot;
      this.flashMesh.add(plane);
    }
    this.flashMesh.position.set(0, 0.02, -0.55);
    this.flashMat = flashMat;
    this.holder.add(this.flashMesh);
    this.loadout = ['pistol'];
    this.current = 'pistol';
    this.state = {};
    this.cooldown = 0;
    this.reloading = 0;
    this.recoilKick = 0;
    this.grenades = 0;
    this.flashes = 0;
    this.onFire = null; // (spread) => void, set by main
  }

  setLoadout(list, grenades, flashes = 0) {
    this.loadout = list;
    this.grenades = grenades;
    this.flashes = flashes;
    this.state = {};
    for (const k of list) {
      const s = WEAPON_SPECS[k];
      this.state[k] = { mag: s.mag, reserve: s.reserve };
    }
    this.select(list[list.length - 1]);
  }

  select(kind) {
    this.current = kind;
    this.reloading = 0;
    for (const k of Object.keys(this.meshes)) this.meshes[k].visible = (k === kind);
  }

  swap() {
    if (this.loadout.length < 2) return;
    const i = this.loadout.indexOf(this.current);
    this.select(this.loadout[(i + 1) % this.loadout.length]);
  }

  get spec() { return WEAPON_SPECS[this.current]; }
  get ammo() { return this.state[this.current]; }

  reload() {
    const st = this.ammo, sp = this.spec;
    if (this.reloading > 0 || st.mag >= sp.mag || st.reserve <= 0) return;
    this.reloading = sp.reloadTime;
    sfx.reload();
  }

  // fireHeld: button state; adsActive; returns true if a shot happened this frame
  update(dt, fireHeld, firePressed, ads) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.recoilKick = Math.max(0, this.recoilKick - dt * 3);
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 90);
    this.flashMat.opacity = Math.max(0, this.flashMat.opacity - dt * 14);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const st = this.ammo, sp = this.spec;
        const need = sp.mag - st.mag;
        const take = Math.min(need, st.reserve);
        st.mag += take;
        if (st.reserve !== Infinity) st.reserve -= take;
      }
    }

    const sp = this.spec, st = this.ammo;
    const wantFire = sp.auto ? fireHeld : firePressed;
    let fired = false;
    if (wantFire && this.cooldown <= 0 && this.reloading <= 0) {
      if (st.mag <= 0) { if (firePressed) { sfx.empty(); this.reload(); } }
      else {
        st.mag--;
        this.cooldown = 60 / sp.rpm;
        this.recoilKick = Math.min(1, this.recoilKick + 0.5);
        this.flash.intensity = 9;
        this.flashMat.opacity = 1;
        this.flashMesh.rotation.z = Math.random() * Math.PI;
        this.flashMesh.scale.setScalar(0.8 + Math.random() * 0.6);
        sfx[sp.sound]();
        const spread = ads ? sp.adsSpread : sp.spread;
        if (this.onFire) this.onFire(spread);
        fired = true;
      }
    }

    // view-model animation: recoil pushback + idle bob
    const t = performance.now() / 1000;
    const kick = this.recoilKick * 0.06;
    this.holder.position.z = -0.45 + kick;
    this.holder.position.x = ads ? 0.0 : 0.22;
    this.holder.position.y = (ads ? -0.155 : -0.22) + Math.sin(t * 1.8) * 0.004;
    this.holder.rotation.x = this.recoilKick * 0.06;
    return fired;
  }
}

// ---------- Throwables ----------
export class Grenade {
  constructor(scene, pos, dir, kind = 'frag') {
    this.kind = kind;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshLambertMaterial({ color: kind === 'flash' ? 0xb0bec5 : 0x33421f })
    );
    this.mesh.position.copy(pos);
    scene.add(this.mesh);
    this.vel = dir.clone().multiplyScalar(14);
    this.vel.y += 3.5;
    this.fuse = kind === 'flash' ? 1.5 : 2.2;
    this.dead = false;
  }
  // solids for bounce; returns true when exploded
  update(dt, solids, groundFn) {
    this.fuse -= dt;
    this.vel.y -= 18 * dt;
    const p = this.mesh.position;
    p.addScaledVector(this.vel, dt);
    const g = groundFn(p.x, p.z, 0.09, p.y + 0.2);
    if (p.y < g + 0.09) { p.y = g + 0.09; this.vel.y *= -0.35; this.vel.x *= 0.7; this.vel.z *= 0.7; }
    return this.fuse <= 0;
  }
}

export function explosionEffect(scene, pos) {
  const light = new THREE.PointLight(0xffaa44, 8, 25);
  light.position.copy(pos); light.position.y += 0.5;
  scene.add(light);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffbb55, transparent: true, opacity: 0.9 }));
  ball.position.copy(light.position);
  scene.add(ball);
  let age = 0;
  return function update(dt) {
    age += dt;
    ball.scale.setScalar(1 + age * 14);
    ball.material.opacity = Math.max(0, 0.9 - age * 2.2);
    light.intensity = Math.max(0, 8 - age * 20);
    if (age > 0.5) { scene.remove(ball, light); ball.geometry.dispose(); return true; }
    return false;
  };
}
