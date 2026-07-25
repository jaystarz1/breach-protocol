import * as THREE from 'three';
import { initInput, input, clearEdges } from './input.js';
import { Player } from './player.js';
import { Weapons, Grenade, explosionEffect } from './weapons.js';
import { Enemy } from './enemies.js';
import { Civilian } from './civilians.js';
import { DoorSystem } from './breach.js';
import { buildStaticGeometry, makeCharacter } from './levelgen.js';
import { raycastSolids, raySphere, groundHeight } from './physics.js';
import { LEVELS } from './levels/index.js';
import { DIFFICULTIES } from './difficulty.js';
import { hud } from './hud.js';
import * as save from './save.js';
import { sfx, unlock as audioUnlock } from './audio.js';

const $ = id => document.getElementById(id);

// ---------- Renderer ----------
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 500);
let scene = null;

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- Game state ----------
const S = save.load();
input.sensitivity = S.sensitivity;
input.invertY = S.invertY;

let mode = 'menu';           // menu | playing | paused | debrief
let world = null;
let player = null;
let weapons = null;
let currentLevel = 1;
let flashlight = null;
let lastTime = performance.now();

// ---------- Menus ----------
function buildDiffRow() {
  const row = $('diff-row');
  row.innerHTML = '';
  DIFFICULTIES.forEach(d => {
    const pill = document.createElement('div');
    pill.className = 'diff-pill' + (d.id === S.difficulty ? ' sel' : '');
    pill.textContent = d.name;
    pill.onclick = () => { S.difficulty = d.id; save.save(); buildDiffRow(); };
    row.appendChild(pill);
  });
}

function buildLevelList() {
  const list = $('level-list');
  list.innerHTML = '';
  LEVELS.forEach(L => {
    const btn = document.createElement('button');
    const locked = L.id > S.unlocked;
    btn.className = 'menu-btn';
    btn.disabled = locked;
    const best = S.best[L.id];
    btn.innerHTML = `${String(L.id).padStart(2, '0')} — ${L.name}` +
      `<span class="sub">${locked ? 'LOCKED' : best ? `BEST: ${best.grade} · ${best.score}` : 'NOT COMPLETED'}${L.sniper ? ' · SNIPER' : ''}</span>`;
    btn.onclick = () => showBrief(L.id);
    list.appendChild(btn);
  });
}

function showBrief(id) {
  currentLevel = id;
  const L = LEVELS[id - 1];
  $('brief-num').textContent = `MISSION ${String(id).padStart(2, '0')} · ${DIFFICULTIES[S.difficulty].name}`;
  $('brief-title').textContent = L.name;
  $('brief-text').textContent = L.brief;
  hud.screen('brief');
}

$('menu-continue').onclick = () => { audioUnlock(); showBrief(Math.min(S.unlocked, 10)); };
$('menu-levels').onclick = () => { audioUnlock(); buildDiffRow(); buildLevelList(); hud.screen('levels'); };
$('menu-settings').onclick = () => hud.screen('settings');
$('levels-back').onclick = () => hud.screen('menu');
$('settings-back').onclick = () => hud.screen('menu');
$('brief-back').onclick = () => { buildDiffRow(); buildLevelList(); hud.screen('levels'); };
$('brief-go').onclick = () => { audioUnlock(); startLevel(currentLevel); };
$('pause-resume').onclick = () => { mode = 'playing'; hud.screen(null); };
$('pause-restart').onclick = () => startLevel(currentLevel);
$('pause-quit').onclick = () => toMenu();
$('debrief-retry').onclick = () => startLevel(currentLevel);
$('debrief-menu').onclick = () => toMenu();
$('debrief-next').onclick = () => {
  if (world && world.won && currentLevel < 10) startLevel(currentLevel + 1);
  else toMenu();
};

const sens = $('sens-slider');
sens.value = S.sensitivity;
sens.oninput = () => { S.sensitivity = parseFloat(sens.value); input.sensitivity = S.sensitivity; save.save(); };
$('invert-btn').textContent = S.invertY ? 'ON' : 'OFF';
$('invert-btn').onclick = () => { S.invertY = !S.invertY; input.invertY = S.invertY; $('invert-btn').textContent = S.invertY ? 'ON' : 'OFF'; save.save(); };

function toMenu() {
  mode = 'menu';
  hud.show(false);
  hud.scope(false);
  hud.screen('menu');
}

// ---------- Level lifecycle ----------
function startLevel(id) {
  currentLevel = id;
  const L = LEVELS[id - 1];
  const diff = DIFFICULTIES[S.difficulty];

  scene = new THREE.Scene();
  scene.background = new THREE.Color(L.sky);
  scene.fog = new THREE.Fog(L.fog[0], L.fog[1], L.fog[2]);
  scene.add(new THREE.AmbientLight(0xbfd4e6, L.ambient));
  if (L.sun > 0) {
    const sun = new THREE.DirectionalLight(0xdfe8ff, L.sun);
    sun.position.set(30, 60, 20);
    scene.add(sun);
  }
  const hemi = new THREE.HemisphereLight(0x8aa0b8, 0x1a2028, 0.35);
  scene.add(hemi);

  const geo = [...L.geo(), ...(L.extraGeo ? L.extraGeo() : [])];
  const { solids } = buildStaticGeometry(scene, geo);

  const doors = new DoorSystem(scene, L.doors || []);
  doors.addSolids(solids);

  camera.clear(); // drop previous level's view-model, flash light, etc.
  player = new Player(camera);
  player.spawn(...L.start, diff);
  player.locked = !!L.lockPlayer;
  scene.add(camera);
  camera.fov = 70; camera.updateProjectionMatrix();

  weapons = new Weapons(camera);
  weapons.setLoadout(L.weapons, L.grenades ?? 0);

  // flashlight (blackout level)
  flashlight = null;
  if (L.flashlight) {
    flashlight = new THREE.SpotLight(0xfff2cc, 6, 40, 0.4, 0.45, 1.2);
    camera.add(flashlight);
    flashlight.position.set(0.1, -0.1, 0);
    flashlight.target.position.set(0, 0, -10);
    camera.add(flashlight.target);
  }

  world = {
    level: L, diff, solids, doors,
    enemies: [], civilians: [], grenades: [], effects: [],
    playerPos: player.pos, playerSpeed: 0, playerAds: false,
    combatHeat: 0, slowmo: 0,
    objectiveIdx: 0, won: false, over: false,
    stats: { kills: 0, shotsFired: 0, shotsHit: 0, civKills: 0, startTime: performance.now(), score: 0 },
    sniperTeam: null,
    onEnemyKilled(e) {
      this.stats.kills++;
      this.stats.score += 100;
      hud.feed('HOSTILE DOWN', '#a5d6a7');
      this.combatHeat = Math.max(this.combatHeat, 4);
    },
    damagePlayer(amt) {
      player.damage(amt, diff);
      sfx.hurt();
      hud.health(player.health, player.maxHealth);
    },
    damageTeam(amt) {
      if (!this.sniperTeam) return;
      this.sniperTeam.health -= amt;
      if (this.sniperTeam.health <= 0 && !this.sniperTeam.dead) {
        this.sniperTeam.dead = true;
        failMission('ASSAULT TEAM LOST');
      }
    },
    enemyFlash(pos) {
      const l = new THREE.PointLight(0xffcc66, 2.5, 10);
      l.position.set(pos.x, pos.y + 1.4, pos.z);
      scene.add(l);
      this.effects.push((dt) => { l.intensity -= dt * 25; if (l.intensity <= 0) { scene.remove(l); return true; } return false; });
    },
  };

  // enemy count scaling
  let defs = [...L.enemies];
  const mul = diff.enemyCountMul;
  if (mul < 1) {
    const keep = Math.max(1, Math.round(defs.length * mul));
    while (defs.length > keep) defs.splice(Math.floor(Math.random() * defs.length), 1);
  } else if (mul > 1) {
    const extra = Math.round(defs.length * (mul - 1));
    for (let i = 0; i < extra; i++) {
      const src = defs[Math.floor(Math.random() * defs.length)];
      defs.push({ ...src, pos: [src.pos[0] + (Math.random() * 2 - 1), src.pos[1], src.pos[2] + (Math.random() * 2 - 1)] });
    }
  }
  world.enemies = defs.map(d => new Enemy(scene, d, diff));

  // civilian scaling (never scale hostages — they're placed deliberately)
  let cdefs = [...L.civilians];
  const cmul = diff.civilianMul;
  const free = cdefs.filter(c => !c.hostage);
  if (cmul > 1 && free.length) {
    const extra = Math.round(free.length * (cmul - 1));
    for (let i = 0; i < extra; i++) {
      const src = free[Math.floor(Math.random() * free.length)];
      cdefs.push({ ...src, pos: [src.pos[0] + (Math.random() * 4 - 2), src.pos[1], src.pos[2] + (Math.random() * 4 - 2)] });
    }
  } else if (cmul < 1) {
    let drop = Math.round(free.length * (1 - cmul));
    cdefs = cdefs.filter(c => c.hostage || (drop-- <= 0));
  }
  world.civilians = cdefs.map(d => new Civilian(scene, d));

  // sniper stage: friendly team at the fountain
  if (L.team) {
    world.sniperTeam = { pos: new THREE.Vector3(...L.team.pos), health: L.team.health, maxHealth: L.team.health, dead: false };
    for (const off of [[-1.2, 0.5], [1.2, -0.5]]) {
      const m = makeCharacter({ hostile: true });
      // recolor to friendly blue
      m.traverse(o => { if (o.isMesh && o.material.color.getHex() === 0x2b2f33) o.material = o.material.clone(), o.material.color.setHex(0x1a3a5c); });
      m.position.set(L.team.pos[0] + off[0], L.team.pos[1], L.team.pos[2] + off[1]);
      scene.add(m);
    }
    input.ads = true;
  } else {
    input.ads = false;
  }

  weapons.onFire = onPlayerShot;

  hud.screen(null);
  hud.show(true);
  hud.nadeBtn((L.grenades ?? 0) > 0);
  hud.swapBtn(L.weapons.length > 1);
  hud.breathBtn(!!L.sniper);
  hud.health(player.health, player.maxHealth);
  setObjective();
  mode = 'playing';
  sfx.objective();
}

function setObjective() {
  const obj = world.level.objectives[world.objectiveIdx];
  hud.objective(obj ? obj.text : 'MISSION COMPLETE');
}

// ---------- Shooting ----------
let swayPhase = 0;
function onPlayerShot(spread) {
  world.stats.shotsFired++;
  world.combatHeat = Math.max(world.combatHeat, 5);

  const dir = player.forward();
  // sniper sway
  if (world.level.sniper && !input.breath) {
    dir.x += Math.sin(swayPhase * 1.7) * weapons.spec.sway;
    dir.y += Math.cos(swayPhase * 1.3) * weapons.spec.sway;
  }
  // spread
  dir.x += (Math.random() - 0.5) * spread * 2;
  dir.y += (Math.random() - 0.5) * spread * 2;
  dir.z += (Math.random() - 0.5) * spread * 2;
  dir.normalize();

  // aim assist: bend toward nearest live enemy within cone
  const assist = world.diff.aimAssist;
  if (assist > 0 && !world.level.sniper) {
    let bestAng = assist, bestDir = null;
    for (const e of world.enemies) {
      if (e.dead) continue;
      const to = new THREE.Vector3(e.pos.x - camera.position.x, e.pos.y + 1.1 - camera.position.y, e.pos.z - camera.position.z);
      const d = to.length();
      if (d > weapons.spec.range) continue;
      to.normalize();
      const ang = dir.angleTo(to);
      if (ang < bestAng) { bestAng = ang; bestDir = to; }
    }
    if (bestDir) dir.lerp(bestDir, 0.55).normalize();
  }

  const o = camera.position;
  const wallDist = raycastSolids(world.solids, o.x, o.y, o.z, dir.x, dir.y, dir.z, weapons.spec.range);

  // nearest actor hit
  let hitEnemy = null, hitCiv = null, hitDist = wallDist;
  for (const e of world.enemies) {
    if (e.dead) continue;
    const t = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, e.pos.x, e.pos.y + 1.0, e.pos.z, 0.55);
    if (t < hitDist) { hitDist = t; hitEnemy = e; hitCiv = null; }
  }
  for (const c of world.civilians) {
    if (c.dead) continue;
    const r = c.hostage ? 0.45 : 0.5;
    const y = c.hostage ? 0.6 : 1.0;
    const t = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, c.pos.x, c.pos.y + y, c.pos.z, r);
    if (t < hitDist) { hitDist = t; hitCiv = c; hitEnemy = null; }
  }

  if (hitEnemy) {
    world.stats.shotsHit++;
    hud.hitmarker();
    hitEnemy.damage(weapons.spec.damage, world);
  } else if (hitCiv) {
    civilianKilled(hitCiv);
  }
  // tracer for sniper feel
  if (world.level.sniper) {
    const end = new THREE.Vector3(o.x + dir.x * hitDist, o.y + dir.y * hitDist, o.z + dir.z * hitDist);
    tracer(o.clone(), end);
  }
}

function tracer(a, b) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.8 }));
  scene.add(line);
  world.effects.push(dt => { line.material.opacity -= dt * 4; if (line.material.opacity <= 0) { scene.remove(line); g.dispose(); return true; } return false; });
}

function civilianKilled(civ) {
  civ.kill();
  world.stats.civKills++;
  sfx.noShoot();
  hud.noShoot(civ.hostage ? 'HOSTAGE DOWN' : 'CIVILIAN DOWN');
  if (world.diff.noShootFail || civ.hostage) {
    failMission(civ.hostage ? 'HOSTAGE KILLED' : 'CIVILIAN CASUALTY — ZERO TOLERANCE');
  } else {
    world.stats.score -= world.diff.noShootPenalty;
    hud.feed(`-${world.diff.noShootPenalty} DISCIPLINE`, '#ef9a9a');
  }
}

// ---------- Objectives ----------
function checkObjectives() {
  const obj = world.level.objectives[world.objectiveIdx];
  if (!obj) return;
  let done = false;
  if (obj.type === 'clear') {
    const [zx, zz, zr, zy] = obj.zone || [];
    done = world.enemies.every(e => {
      if (e.dead) return true;
      if (!obj.zone) return false;
      const dy = zy !== undefined ? Math.abs(e.pos.y - zy) : 0;
      return Math.hypot(e.pos.x - zx, e.pos.z - zz) > zr || dy > 4 ? true : false;
    });
    if (obj.zone) {
      // zone-clear: no live enemy inside the zone
      done = !world.enemies.some(e => {
        if (e.dead) return false;
        const dy = zy !== undefined ? Math.abs(e.pos.y - zy) : Math.abs(e.pos.y - player.pos.y) * 0;
        return Math.hypot(e.pos.x - zx, e.pos.z - zz) <= zr && dy < 4;
      });
    }
  } else if (obj.type === 'reach') {
    const [zx, zz, zr, zy] = obj.zone;
    const dy = zy !== undefined ? Math.abs(player.pos.y - zy) : 0;
    done = Math.hypot(player.pos.x - zx, player.pos.z - zz) < zr && dy < 2.5;
  }
  if (done) {
    world.objectiveIdx++;
    sfx.objective();
    if (world.objectiveIdx >= world.level.objectives.length) winMission();
    else setObjective();
  }
}

// ---------- Win / fail ----------
function grade(score, civKills, accuracy) {
  if (civKills === 0 && accuracy > 0.55 && score > 0) return 'S';
  if (civKills === 0 && score > 0) return 'A';
  if (score > 400) return 'B';
  if (score > 0) return 'C';
  return 'D';
}

function winMission() {
  if (world.over) return;
  world.over = true; world.won = true;
  const t = (performance.now() - world.stats.startTime) / 1000;
  const acc = world.stats.shotsFired ? world.stats.shotsHit / world.stats.shotsFired : 0;
  const timeBonus = Math.max(0, Math.round(600 - t * 2));
  world.stats.score += timeBonus + Math.round(acc * 300);
  const g = grade(world.stats.score, world.stats.civKills, acc);
  save.recordResult(currentLevel, Math.max(0, world.stats.score), g);
  showDebrief(true, g, t, acc, timeBonus);
}

function failMission(reason) {
  if (world.over) return;
  world.over = true; world.won = false;
  sfx.fail();
  const t = (performance.now() - world.stats.startTime) / 1000;
  const acc = world.stats.shotsFired ? world.stats.shotsHit / world.stats.shotsFired : 0;
  showDebrief(false, 'F', t, acc, 0, reason);
}

function showDebrief(won, g, t, acc, timeBonus, reason) {
  setTimeout(() => {
    mode = 'debrief';
    hud.show(false);
    hud.scope(false);
    $('debrief-status').textContent = won ? 'MISSION COMPLETE' : 'MISSION FAILED' + (reason ? ' — ' + reason : '');
    $('debrief-grade').textContent = g;
    $('debrief-grade').style.color = won ? '#ffc107' : '#ef5350';
    const rows = [
      ['Hostiles eliminated', world.stats.kills],
      ['Accuracy', Math.round(acc * 100) + '%'],
      ['Civilian casualties', world.stats.civKills],
      ['Time', Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0')],
      ['Time bonus', '+' + timeBonus],
      ['FINAL SCORE', Math.max(0, world.stats.score)],
    ];
    $('debrief-grid').innerHTML = rows.map(r => `<div>${r[0]}</div><div class="val">${r[1]}</div>`).join('');
    $('debrief-next').style.display = won && currentLevel < 10 ? 'block' : 'none';
    hud.screen('debrief');
  }, won ? 800 : 1200);
}

// ---------- Main loop ----------
initInput();

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (mode !== 'playing' || !world) { if (scene) renderer.render(scene, camera); clearEdges(); return; }

  if (input.pausePressed) { mode = 'paused'; hud.screen('pause'); clearEdges(); return; }

  // slow-mo
  let timeScale = 1;
  if (world.slowmo > 0) { world.slowmo -= dt; timeScale = 0.3; }
  const sdt = dt * timeScale;

  world.combatHeat = Math.max(0, world.combatHeat - sdt);
  swayPhase += dt * (input.breath ? 0.25 : 1);

  // player
  player.update(dt, world.solids, world.diff, timeScale);
  world.playerSpeed = player.moveSpeed;
  world.playerAds = input.ads;
  if (player.dead && !world.over) failMission('KIA');

  // weapons
  if (input.swapPressed) weapons.swap();
  if (input.reloadPressed) weapons.reload();
  weapons.update(dt, input.fire, input.firePressed, input.ads);

  // ADS FOV + scope
  const scoped = weapons.spec.scoped && input.ads;
  hud.scope(!!scoped);
  const targetFov = input.ads ? weapons.spec.adsFov : 70;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();
  // scope sway applied to camera for feel
  if (world.level.sniper && scoped && !input.breath) {
    camera.rotation.y += Math.sin(swayPhase * 1.7) * 0.0006;
    camera.rotation.x += Math.cos(swayPhase * 1.3) * 0.0006;
  }

  // grenades
  if (input.nadePressed && weapons.grenades > 0) {
    weapons.grenades--;
    sfx.grenadeThrow();
    const org = camera.position.clone().addScaledVector(player.forward(), 0.5);
    world.grenades.push(new Grenade(scene, org, player.forward()));
  }
  for (let i = world.grenades.length - 1; i >= 0; i--) {
    const g = world.grenades[i];
    const boom = g.update(sdt, world.solids, (x, z, r, y) => groundHeight(world.solids, x, z, r, y));
    if (boom) {
      scene.remove(g.mesh);
      world.grenades.splice(i, 1);
      sfx.explosion();
      world.effects.push(explosionEffect(scene, g.mesh.position));
      // radius damage
      const P = g.mesh.position;
      for (const e of world.enemies) {
        if (e.dead) continue;
        const d = e.pos.distanceTo(P);
        if (d < 7) e.damage(160 * (1 - d / 7), world);
      }
      for (const c of world.civilians) {
        if (c.dead) continue;
        if (c.pos.distanceTo(P) < 6) civilianKilled(c);
      }
      const pd = player.pos.distanceTo(P);
      if (pd < 6) world.damagePlayer(60 * (1 - pd / 6));
      world.combatHeat = 6;
    }
  }

  // doors / breach
  const near = world.doors.nearBreachable(player.pos, player.yaw);
  hud.breachBtn(!!near && !world.level.sniper);
  if (input.breachPressed && near) world.doors.breach(near, world);
  world.doors.update(dt);

  // actors
  for (const e of world.enemies) e.update(sdt, world);
  for (const c of world.civilians) c.update(sdt, world);
  for (let i = world.effects.length - 1; i >= 0; i--) if (world.effects[i](dt)) world.effects.splice(i, 1);

  // objectives + HUD
  if (!world.over) checkObjectives();
  hud.health(player.health, player.maxHealth);
  hud.ammo(weapons.ammo.mag, weapons.ammo.reserve, weapons.grenades);
  hud.weapon(weapons.spec.name + (weapons.reloading > 0 ? ' — RELOADING' : ''));
  const remaining = world.enemies.filter(e => !e.dead).length;
  let scoreLine = `HOSTILES: ${remaining} · SCORE: ${Math.max(0, world.stats.score)}`;
  if (world.sniperTeam) scoreLine += ` · TEAM: ${Math.max(0, Math.round(world.sniperTeam.health / world.sniperTeam.maxHealth * 100))}%`;
  hud.score(scoreLine);

  renderer.render(scene, camera);
  clearEdges();
}
frame();

// expose for debugging
window.BP = { get world() { return world; }, startLevel, LEVELS };
