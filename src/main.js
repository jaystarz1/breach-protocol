import * as THREE from 'three';
import { initInput, input, clearEdges } from './input.js';
import { Player } from './player.js';
import { Weapons, Grenade, explosionEffect } from './weapons.js';
import { Enemy, resetPathBudget } from './enemies.js';
import { Civilian } from './civilians.js';
import { DoorSystem } from './breach.js';
import { buildStaticGeometry, makeCharacter } from './levelgen.js';
import { raycastSolids, raySphere, groundHeight, hasLOS } from './physics.js';
import { LEVELS } from './levels/index.js';
import { buildNavGrid } from './navgrid.js';
import { DIFFICULTIES } from './difficulty.js';
import { hud } from './hud.js';
import * as save from './save.js';
import { sfx, unlock as audioUnlock, updateListener, startAmbient, stopAmbient } from './audio.js';

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
    btn.className = 'menu-btn';
    const best = S.best[L.id];
    btn.innerHTML = `${String(L.id).padStart(2, '0')} — ${L.name}` +
      `<span class="sub">${best ? `BEST: ${best.grade} · ${best.score}${best.difficulty ? ' · ' + best.difficulty : ''}` : 'NOT COMPLETED'}${L.sniper ? ' · SNIPER' : ''}</span>`;
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

$('menu-continue').onclick = () => { audioUnlock(); showBrief(Math.min(Math.max(1, currentLevel), 10)); };
$('menu-levels').onclick = () => { audioUnlock(); buildDiffRow(); buildLevelList(); hud.screen('levels'); };
$('menu-settings').onclick = () => hud.screen('settings');
$('levels-back').onclick = () => hud.screen('menu');
$('settings-back').onclick = () => hud.screen('menu');
$('brief-back').onclick = () => { buildDiffRow(); buildLevelList(); hud.screen('levels'); };
$('brief-go').onclick = () => { audioUnlock(); startLevel(currentLevel); };
$('pause-resume').onclick = () => { mode = 'playing'; hud.screen(null); };
$('pause-restart').onclick = () => startLevel(currentLevel);
$('pause-skip').onclick = () => startLevel(currentLevel < 10 ? currentLevel + 1 : 1);
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
  stopAmbient();
  hud.show(false);
  hud.scope(false);
  $('nvg').style.display = 'none';
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
  scene.add(new THREE.AmbientLight(L.nvg ? 0x8dffb4 : 0xbfd4e6, L.ambient));
  if (L.nvg) scene.add(new THREE.HemisphereLight(0xa8ffc8, 0x0e2416, 0.9));
  $('nvg').style.display = L.nvg ? 'block' : 'none';
  if (L.sun > 0) {
    const sun = new THREE.DirectionalLight(0xdfe8ff, L.sun);
    sun.position.set(30, 60, 20);
    scene.add(sun);
    // fill from the opposite side so faces away from the sun still separate
    const fill = new THREE.DirectionalLight(0xa8c0d8, L.sun * 0.35);
    fill.position.set(-25, 30, -35);
    scene.add(fill);
  }
  const hemi = new THREE.HemisphereLight(0x9db4c8, 0x2a323a, L.flashlight ? 0.15 : 0.65);
  scene.add(hemi);

  const geo = [...L.geo(), ...(L.extraGeo ? L.extraGeo() : [])];
  const { solids } = buildStaticGeometry(scene, geo);

  // navigation mesh: without this the AI can only walk in straight lines.
  // Built BEFORE doors are added as solids, so a doorway stays routable once breached —
  // a closed door still physically blocks movement, it just isn't baked into the graph.
  const nav = buildNavGrid(solids);

  const doors = new DoorSystem(scene, L.doors || []);
  doors.addSolids(solids);
  startAmbient(L.ambientKind || (L.nvg || L.id === 9 ? 'tunnel' : 'urban'));

  camera.clear(); // drop previous level's view-model, flash light, etc.
  player = new Player(camera);
  player.spawn(...L.start, diff);
  player.locked = !!L.lockPlayer;
  scene.add(camera);
  camera.fov = 70; camera.updateProjectionMatrix();

  weapons = new Weapons(camera);
  weapons.setLoadout(L.weapons, L.grenades ?? 0, L.flashes ?? 0);

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
    level: L, diff, solids, doors, nav,
    enemies: [], civilians: [], grenades: [], effects: [],
    playerPos: player.pos, playerSpeed: 0, playerAds: false, playerCrouched: false,
    combatHeat: 0, slowmo: 0, blind: 0,
    objectiveIdx: 0, won: false, over: false,
    stats: { kills: 0, shotsFired: 0, shotsHit: 0, civKills: 0, rescued: 0, startTime: performance.now(), score: 0 },
    sniperTeam: null,
    onEnemyKilled(e) {
      this.stats.kills++;
      this.stats.score += 100;
      hud.feed('HOSTILE DOWN', '#a5d6a7');
      this.combatHeat = Math.max(this.combatHeat, 4);
    },
    damagePlayer(amt, from) {
      player.damage(amt, diff);
      sfx.hurt();
      hud.health(player.health, player.maxHealth);
      if (from) {
        // arc points at the shooter relative to where the player is facing
        const world2 = Math.atan2(from.x - player.pos.x, from.z - player.pos.z);
        hud.damageFrom(-(world2 - player.yaw) + Math.PI);
      }
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
    // incoming rounds you can SEE, so a firefight reads as directional
    enemyTracer(e, target) {
      const a = new THREE.Vector3(e.pos.x, e.pos.y + 1.35, e.pos.z);
      const b = new THREE.Vector3(
        target.x + (Math.random() - 0.5) * 1.6,
        target.y + 1.0 + (Math.random() - 0.5) * 1.2,
        target.z + (Math.random() - 0.5) * 1.6);
      tracer(a, b, 0xffb060, 7);
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
      // spawn at the source's exact position — collision separates them; an offset can clip into walls
      defs.push({ ...src, pos: [...src.pos] });
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
  // control hints: show on the first mission of each session, fade on first touch
  const hinted = sessionStorage.getItem('bp-hinted');
  $('move-hint').classList.toggle('off', !!hinted);
  $('aim-hint').classList.toggle('off', !!hinted);
  sessionStorage.setItem('bp-hinted', '1');
  hud.nadeBtn((L.grenades ?? 0) > 0);
  hud.flashBtn((L.flashes ?? 0) > 0);
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
  world.objStuckTime = 0;
  if (world.markers) { for (const { m } of world.markers) scene.remove(m); world.markers = null; }
  if (world.objMarkers) { for (const m of world.objMarkers) scene.remove(m); world.objMarkers = []; }
  // beacon at reach zones: glowing column visible through walls
  if (world.beacon) { scene.remove(world.beacon); world.beacon = null; }
  if (obj && (obj.type === 'rescue' || obj.type === 'target')) {
    world.markLive = obj.type;
    world.markZone = obj.zone || null;
  } else { world.markLive = null; world.markZone = null; }
  if (obj && obj.type === 'reach') {
    const [zx, zz, , zy] = obj.zone;
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.7, 40, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc107, transparent: true, opacity: 0.3, depthTest: false, side: THREE.DoubleSide })
    );
    col.position.set(zx, (zy ?? 0) + 20, zz);
    col.renderOrder = 999;
    scene.add(col);
    world.beacon = col;
  }
}

// Deadlock failsafe: an enemy that hasn't moved or fired for 90s while a clear
// objective is stuck gets neutralized by "command" rather than soft-locking the mission.
function objectiveWatchdog(dt) {
  const obj = world.level.objectives[world.objectiveIdx];
  if (!obj) return;
  world.objStuckTime = (world.objStuckTime || 0) + dt;
  if (obj.type !== 'clear') return;
  const live = world.enemies.filter(e => !e.dead);
  // after 60s stuck: mark remaining hostiles with red diamonds
  if (world.objStuckTime > 60 && !world.markers) {
    world.markers = live.map(e => {
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22),
        new THREE.MeshBasicMaterial({ color: 0xff3d3d, depthTest: false })
      );
      m.renderOrder = 999;
      scene.add(m);
      return { m, e };
    });
  }
  if (world.markers) {
    for (const { m, e } of world.markers) {
      m.visible = !e.dead;
      m.position.set(e.pos.x, e.pos.y + 2.2, e.pos.z);
      m.rotation.y += dt * 3;
    }
  }
  if (world.objStuckTime > 90) {
    for (const e of live) {
      if ((e.inactiveTime || 0) > 90) {
        e.damage(99999, world);
        hud.feed('TARGET NEUTRALIZED BY OVERWATCH', '#ffd54f');
      }
    }
  }
}

// ---------- Shooting ----------
let swayPhase = 0;
function onPlayerShot(spread) {
  world.stats.shotsFired++;
  world.combatHeat = Math.max(world.combatHeat, 5);

  const dir = player.forward(); // compute the ray BEFORE the recoil kick — kick affects the NEXT shot, not this one
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

  // nearest actor hit — head sphere is a one-shot kill on any weapon
  let hitEnemy = null, hitCiv = null, hitDist = wallDist, headshot = false;
  for (const e of world.enemies) {
    if (e.dead) continue;
    const tHead = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, e.pos.x, e.pos.y + 1.66, e.pos.z, 0.34);
    const tBody = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, e.pos.x, e.pos.y + 1.0, e.pos.z, 0.55);
    const t = Math.min(tHead, tBody);
    if (t < hitDist) { hitDist = t; hitEnemy = e; hitCiv = null; headshot = tHead <= tBody; }
  }
  for (const c of world.civilians) {
    if (c.dead) continue;
    const r = c.hostage ? 0.45 : 0.5;
    const y = c.hostage ? 0.6 : 1.0;
    const t = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, c.pos.x, c.pos.y + y, c.pos.z, r);
    if (t < hitDist) { hitDist = t; hitCiv = c; hitEnemy = null; }
  }

  if (window.QA_SHOT !== undefined) {
    window.QA_SHOT = {
      dir: [dir.x.toFixed(3), dir.y.toFixed(3), dir.z.toFixed(3)],
      o: [o.x.toFixed(1), o.y.toFixed(1), o.z.toFixed(1)],
      wallDist: wallDist.toFixed(1), hitDist: hitDist.toFixed(1),
      hitEnemy: hitEnemy ? [hitEnemy.pos.x.toFixed(0), hitEnemy.pos.z.toFixed(0)] : null,
    };
  }
  player.pitch += weapons.spec.recoil * (0.4 + Math.random() * 0.3); // camera kick

  // every shot leaves a visible trace and an audible terminus
  const end = new THREE.Vector3(o.x + dir.x * hitDist, o.y + dir.y * hitDist, o.z + dir.z * hitDist);
  const muzzle = new THREE.Vector3(o.x + dir.x * 0.6, o.y + dir.y * 0.6 - 0.12, o.z + dir.z * 0.6);
  tracer(muzzle, end, 0xfff0c0, world.level.sniper ? 4 : 11, world.level.sniper ? 0.85 : 0.5);

  if (hitEnemy) {
    world.stats.shotsHit++;
    hud.hitmarker();
    if (headshot) {
      world.stats.score += 50;
      hud.feed('HEADSHOT +50', '#ffd54f');
      sfx.headshot();
      hitEnemy.damage(99999, world, true);
    } else {
      hitEnemy.damage(weapons.spec.damage, world);
    }
  } else if (hitCiv) {
    civilianKilled(hitCiv);
  } else if (hitDist < weapons.spec.range - 0.5) {
    impactAt(end);
  }
}

function tracer(a, b, color = 0xffe0a0, fade = 4, opacity = 0.85) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  scene.add(line);
  world.effects.push(dt => { line.material.opacity -= dt * fade; if (line.material.opacity <= 0) { scene.remove(line); g.dispose(); return true; } return false; });
}

// bullet strike on geometry: spark flash + sound, so misses read too
function impactAt(p) {
  sfx.impact(p);
  if (Math.random() < 0.35) sfx.ricochet(p);
  const spark = new THREE.PointLight(0xffd090, 1.6, 3.5);
  spark.position.copy(p);
  scene.add(spark);
  world.effects.push(dt => { spark.intensity -= dt * 14; if (spark.intensity <= 0) { scene.remove(spark); return true; } return false; });
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
// Flashbang: blinds the player if he is looking at it, and stuns any enemy with
// line of sight to it — the reason to breach with one instead of walking in.
function detonateFlash(pos) {
  sfx.flashbang(pos);
  const light = new THREE.PointLight(0xffffff, 40, 40);
  light.position.copy(pos);
  scene.add(light);
  world.effects.push(dt => { light.intensity -= dt * 90; if (light.intensity <= 0) { scene.remove(light); return true; } return false; });

  const eye = camera.position;
  const dist = eye.distanceTo(pos);
  if (dist < 22 && hasLOSTo(pos)) {
    const facing = player.forward().dot(new THREE.Vector3(pos.x - eye.x, pos.y - eye.y, pos.z - eye.z).normalize());
    const power = Math.max(0, 1 - dist / 22) * (facing > 0.2 ? 1 : 0.35);
    if (power > 0.08) { world.blind = Math.max(world.blind, power * 3.2); sfx.tinnitus(); }
  }
  for (const e of world.enemies) {
    if (e.dead) continue;
    const d = e.pos.distanceTo(pos);
    if (d > 16) continue;
    if (!hasLOS(world.solids, pos.x, pos.y, pos.z, e.pos.x, e.pos.y + 1.5, e.pos.z)) continue;
    // stunned: cannot shoot, cannot track, for a few seconds
    e.reactTimer = Math.max(e.reactTimer, 3.5 * (1 - d / 16) + 1.0);
    e.burstShots = 0;
    e.burstTimer = 1.2;
    e.state = 'alert';
  }
  hud.feed('FLASHBANG', '#e0f7fa');
}

function hasLOSTo(p) {
  const o = camera.position;
  return hasLOS(world.solids, o.x, o.y, o.z, p.x, p.y, p.z);
}

function inZone(pos, zone) {
  if (!zone) return true;
  const [zx, zz, zr, zy] = zone;
  if (zy !== undefined && Math.abs(pos.y - zy) > 3) return false;
  return Math.hypot(pos.x - zx, pos.z - zz) <= zr;
}

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
  } else if (obj.type === 'rescue') {
    done = !world.civilians.some(c => c.hostage && !c.dead && !c.rescued && inZone(c.pos, obj.zone));
  } else if (obj.type === 'target') {
    done = world.enemies.every(e => !e.hvt || e.dead);
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
  save.recordResult(currentLevel, Math.max(0, world.stats.score), g, DIFFICULTIES[S.difficulty].name);
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
    stopAmbient();
    hud.flashWhite(0);
    hud.show(false);
    hud.scope(false);
    $('nvg').style.display = 'none';
    $('debrief-status').textContent = won ? 'MISSION COMPLETE' : 'MISSION FAILED' + (reason ? ' — ' + reason : '');
    $('debrief-grade').textContent = g;
    $('debrief-grade').style.color = won ? '#ffc107' : '#ef5350';
    const rows = [
      ['Hostiles eliminated', world.stats.kills],
      ['Accuracy', Math.round(acc * 100) + '%'],
      ['Civilian casualties', world.stats.civKills],
      ['Hostages freed', world.stats.rescued],
      ['Time', Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0')],
      ['Time bonus', '+' + timeBonus],
      ['FINAL SCORE', Math.max(0, world.stats.score)],
    ];
    $('debrief-grid').innerHTML = rows.map(r => `<div>${r[0]}</div><div class="val">${r[1]}</div>`).join('');
    $('debrief-next').style.display = won && currentLevel < 10 ? 'block' : 'none';
    hud.screen('debrief');
  }, won ? 800 : 1200);
}

// ---------- Audio unlock: first touch anywhere + resume on return from background ----------
const unlockOnce = () => audioUnlock();
document.addEventListener('touchstart', unlockOnce, { once: true, passive: true });
document.addEventListener('mousedown', unlockOnce, { once: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) audioUnlock(); });

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
  resetPathBudget();

  // flashbang blindness decays
  if (world.blind > 0) {
    world.blind = Math.max(0, world.blind - dt);
    hud.flashWhite(Math.min(1, world.blind / 1.6));
  } else hud.flashWhite(0);

  // player
  player.update(dt, world.solids, world.diff, timeScale);
  world.playerSpeed = player.moveSpeed;
  world.playerAds = input.ads;
  world.playerCrouched = player.crouch > 0.5;
  updateListener(camera.position, player.yaw, player.pitch);
  if (player.dead && !world.over) failMission('KIA');

  // weapons
  if (input.swapPressed) weapons.swap();
  if (input.reloadPressed) weapons.reload();
  weapons.update(dt, input.fire, input.firePressed, input.ads);

  // ADS FOV + scope
  const scoped = weapons.spec.scoped && input.ads;
  hud.scope(!!scoped);
  // a scoped Barrett at hipfire sensitivity is unusable; scale with magnification
  input.sensScale = scoped ? 0.28 : input.ads ? 0.62 : 1;
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
    world.grenades.push(new Grenade(scene, org, player.forward(), 'frag'));
  }
  if (input.flashPressed && weapons.flashes > 0) {
    weapons.flashes--;
    sfx.grenadeThrow();
    const org = camera.position.clone().addScaledVector(player.forward(), 0.5);
    world.grenades.push(new Grenade(scene, org, player.forward(), 'flash'));
  }
  for (let i = world.grenades.length - 1; i >= 0; i--) {
    const g = world.grenades[i];
    const boom = g.update(sdt, world.solids, (x, z, r, y) => groundHeight(world.solids, x, z, r, y));
    if (boom) {
      scene.remove(g.mesh);
      world.grenades.splice(i, 1);
      if (g.kind === 'flash') { detonateFlash(g.mesh.position); continue; }
      sfx.explosion(g.mesh.position);
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
      if (pd < 6) world.damagePlayer(60 * (1 - pd / 6), P);
      world.combatHeat = 6;
    }
  }

  // grenade landing preview: simulate the same ballistics the throw will use
  if ((weapons.grenades > 0 || weapons.flashes > 0) && !world.level.lockPlayer) {
    if (!world.nadeRing) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.42, 18),
        new THREE.MeshBasicMaterial({ color: 0xffb74d, transparent: true, opacity: 0.5, depthTest: false, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 998;
      scene.add(ring);
      world.nadeRing = ring;
    }
    // the trajectory sim touches every solid per step, so run it a few times a second,
    // not every frame — the arc barely moves between frames anyway
    world.nadeTick = (world.nadeTick || 0) + dt;
    if (world.nadeTick < 0.08) { /* keep last result */ } else { world.nadeTick = 0;
    const fwd = player.forward();
    const pp = camera.position.clone().addScaledVector(fwd, 0.5);
    const vv = fwd.clone().multiplyScalar(14); vv.y += 3.5;
    let landed = null;
    for (let st = 0; st < 60; st++) {
      vv.y -= 18 * 0.03;
      pp.addScaledVector(vv, 0.03);
      const gy = groundHeight(world.solids, pp.x, pp.z, 0.09, pp.y + 0.2);
      if (gy > -Infinity && pp.y < gy + 0.12) { landed = { x: pp.x, y: gy, z: pp.z }; break; }
      if (pp.y < -30) break;
    }
    world.nadeRing.visible = !!landed;
    if (landed) world.nadeRing.position.set(landed.x, landed.y + 0.05, landed.z);
    }
  } else if (world.nadeRing) world.nadeRing.visible = false;

  // doors / breach
  const near = world.doors.nearBreachable(player.pos, player.yaw);
  hud.breachBtn(!!near && !world.level.sniper);
  if (input.breachPressed && near) world.doors.breach(near, world);
  world.doors.update(dt);

  // actors
  for (const e of world.enemies) e.update(sdt, world);
  for (const c of world.civilians) c.update(sdt, world);
  for (let i = world.effects.length - 1; i >= 0; i--) if (world.effects[i](dt)) world.effects.splice(i, 1);

  // markers on whatever the current objective actually wants from you
  if (!world.objMarkers) world.objMarkers = [];
  const wantMark = world.markLive;
  const marked = wantMark === 'target'
    ? world.enemies.filter(e => e.hvt && !e.dead)
    : wantMark === 'rescue'
      ? world.civilians.filter(c => c.hostage && !c.dead && !c.rescued && inZone(c.pos, world.markZone))
      : [];
  while (world.objMarkers.length > marked.length) { scene.remove(world.objMarkers.pop()); }
  while (world.objMarkers.length < marked.length) {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.26),
      new THREE.MeshBasicMaterial({ color: wantMark === 'target' ? 0xff5252 : 0x7cffb0, depthTest: false })
    );
    m.renderOrder = 999;
    scene.add(m);
    world.objMarkers.push(m);
  }
  for (let i = 0; i < marked.length; i++) {
    const a = marked[i];
    world.objMarkers[i].position.set(a.pos.x, a.pos.y + 2.3 + Math.sin(performance.now() / 350) * 0.12, a.pos.z);
    world.objMarkers[i].rotation.y += dt * 2.5;
  }

  // free any hostage you walk up to
  for (const c of world.civilians) {
    if (!c.hostage || c.dead || c.rescued) continue;
    if (player.pos.distanceTo(c.pos) < 2.2 && Math.abs(player.pos.y - c.pos.y) < 2.2) {
      if (c.rescue()) {
        world.stats.rescued++;
        world.stats.score += 150;
        hud.feed('HOSTAGE FREED +150', '#a5d6a7');
        sfx.objective();
      }
    }
  }

  // an HVT who finishes his escape route is gone, and that is a failed mission
  if (!world.over) {
    const gone = world.enemies.find(e => e.hvt && e.escaped && !e.dead);
    if (gone) failMission('HVT ESCAPED');
  }

  // objectives + HUD
  if (!world.over) { checkObjectives(); objectiveWatchdog(dt); }
  // beacon pulse + live distance readout on reach objectives
  if (world.beacon) {
    world.beacon.material.opacity = 0.22 + Math.sin(performance.now() / 300) * 0.12;
    const obj = world.level.objectives[world.objectiveIdx];
    if (obj && obj.type === 'reach') {
      const d = Math.round(Math.hypot(player.pos.x - obj.zone[0], player.pos.z - obj.zone[1]));
      hud.objective(`${obj.text} — ${d}m`);
    }
  }
  hud.health(player.health, player.maxHealth);
  hud.ammo(weapons.ammo.mag, weapons.ammo.reserve, weapons.grenades, weapons.flashes);
  hud.weapon(weapons.spec.name + (weapons.reloading > 0 ? ' — RELOADING' : ''));
  const remaining = world.enemies.filter(e => !e.dead).length;
  let scoreLine = `HOSTILES: ${remaining} · SCORE: ${Math.max(0, world.stats.score)}`;
  if (world.sniperTeam) scoreLine += ` · TEAM: ${Math.max(0, Math.round(world.sniperTeam.health / world.sniperTeam.maxHealth * 100))}%`;
  hud.score(scoreLine);

  renderer.render(scene, camera);
  clearEdges();
}
frame();

// Touch hardening: menu buttons fire on touchend directly (no 300ms ambiguity, no lost taps)
for (const b of document.querySelectorAll('.menu-btn, #menu-refresh')) {
  b.addEventListener('touchend', e => { e.preventDefault(); b.click(); }, { passive: false });
}

// expose for debugging + QA
window.BP = {
  get world() { return world; },
  get player() { return player; },
  get weapons() { return weapons; },
  get mode() { return mode; },
  startLevel, LEVELS, S, input,
  setDifficulty(d) { S.difficulty = d; },
};

// QA autoplay bot: only with ?qa=1
if (new URLSearchParams(location.search).has('qa')) {
  import('./qa.js').then(m => { window.QA = m; });
}
