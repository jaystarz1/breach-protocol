import * as THREE from 'three';
import { initInput, input, clearEdges, applyKeyLook } from './input.js';
import { Player } from './player.js';
import { Weapons, Grenade, explosionEffect } from './weapons.js';
import { Enemy, resetPathBudget } from './enemies.js';
import { Civilian } from './civilians.js';
import { DoorSystem } from './breach.js';
import { buildStaticGeometry } from './levelgen.js';
import { raycastSolids, raySphere, rayVerticalCapsule, groundHeight, hasLOS } from './physics.js';
import { LEVELS } from './levels/index.js';
import { buildNavGrid } from './navgrid.js';
import { DIFFICULTIES } from './difficulty.js';
import { hud } from './hud.js';
import * as save from './save.js';
import { sfx, unlock as audioUnlock, updateListener, startAmbient, stopAmbient } from './audio.js';
import { quality } from './quality.js';
import { environment, environmentFrom } from './textures.js';
import { skyDome, groundPlate, skyline, takeLights } from './world.js';
import { spawnSquad, spawnRouteTeam } from './squad.js';
import { addStreetSweepArt } from './street-sweep-art.js';
import {
  addFrontlineAmbientArt,
  addFrontlineMissionArt,
  addFrontlineStreetArt,
} from './frontline-art.js';
import { addVisualProps } from './visual-kit.js';
import { addInteriorMissionArt } from './interior-mission-art.js';
import { createRenderPipeline } from './renderer/render-pipeline.js';
import { CAMPAIGN, briefingText, campaignSnapshot } from './campaign.js';
import { DroneController, dronePrewarmGroup } from './drone.js';

const $ = id => document.getElementById(id);

// ---------- Renderer ----------
const canvas = $('game-canvas');
const renderPipeline = createRenderPipeline(canvas, quality);
// Kept as a local alias because environment-map generation and light setup legitimately need
// the underlying Three renderer. Frame rendering itself goes only through renderPipeline.
const renderer = renderPipeline.renderer;
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 500);
let scene = null;
// Re-centred on the camera every frame: a 460m dome that stays at the origin would clip
// through the far plane the moment you walk away from spawn on the bigger maps.
let skyMesh = null;

function resize() {
  renderPipeline.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
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
const missionRuns = new Uint16Array(11);
let levelLoadId = 0;
let flashlight = null;
let lastTime = performance.now();
// Goggles are player-controlled equipment now, not a level property, so the lights they swap
// between are built for every level and toggled rather than chosen once at load.
let nvgRig = null;
let nvgOn = false;

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
  $('brief-text').textContent = briefingText(id, L.brief);
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

// Render path. Cycles AUTO -> COMPATIBILITY -> DESKTOP. Needs a reload because WebGLRenderer's
// antialias flag can only be set at construction, so the label shows what's pending.
const QUALITY_MODES = ['auto', 'compatibility', 'desktop'];
const qBtn = $('quality-btn');
function paintQuality() {
  const pending = S.quality !== quality.choice;
  qBtn.textContent = (S.quality || 'auto').toUpperCase() + (pending ? ' *' : '');
  qBtn.title = pending ? 'Reload to apply' : `Running: ${quality.tier.toUpperCase()}`;
}
S.quality = S.quality === 'high' ? 'desktop'
  : S.quality === 'low' ? 'compatibility'
    : S.quality || 'auto';
paintQuality();
qBtn.onclick = () => {
  S.quality = QUALITY_MODES[(QUALITY_MODES.indexOf(S.quality) + 1) % QUALITY_MODES.length];
  save.save();
  paintQuality();
};

function toMenu() {
  mode = 'menu';
  stopAmbient();
  hud.show(false);
  hud.scope(false);
  hud.aimRef('none');
  hud.nvg(false);
  hud.squad('');
  hud.hostage('');
  hud.reinf('');
  hud.screen('menu');
}

// ---------- Level lifecycle ----------
// Axis-aligned footprint of a level's box list, used to size the shadow frustum.
function levelBounds(geo) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, , z, w, , d] of geo) {
    minX = Math.min(minX, x - w / 2); maxX = Math.max(maxX, x + w / 2);
    minZ = Math.min(minZ, z - d / 2); maxZ = Math.max(maxZ, z + d / 2);
  }
  if (!isFinite(minX)) return { cx: 0, cz: 0, r: 40 };
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  return { cx, cz, r: Math.max(maxX - minX, maxZ - minZ) / 2 + 4 };
}

// Goggles down / goggles up. Beyond swapping the green ambient in for the blue one, the sun
// and fill are knocked back hard: an image intensifier does not make a moonlit street look
// like a green moonlit street, it flattens contrast and blows out anything already bright.
// Cutting the key light is what keeps NVGs from reading as a colour filter on a normal scene.
function setNvg(on) {
  nvgOn = on;
  hud.nvg(on);
  if (!nvgRig) return;
  const r = nvgRig;
  r.ambBase.visible = !on;
  r.nvgAmb.visible = on;
  r.nvgHemi.visible = on;
  r.hemi.visible = !on;
  if (r.sun) r.sun.intensity = r.sunI * (on ? 0.22 : 1);
  if (r.fill) r.fill.intensity = r.fillI * (on ? 0.25 : 1);
}

// Kill the power. Every fixture out, the natural ambient crushed to almost nothing, and the
// sun cut — but the NVG ambient left alone, so the goggles are the answer and the player has
// to reach for them. Also drops the emissive pass (lit window panes, exit signs) to black,
// because a "blacked out" building with its light fittings still glowing is not blacked out.
function killPower() {
  if (!nvgRig || world.blackedOut) return;
  world.blackedOut = true;
  const r = nvgRig;
  if (r.fixtures) for (const f of r.fixtures) f.intensity = 0;
  // The environment map lights every PBR surface on its own, completely independently of the
  // light list. Zeroing every lamp in the building and leaving this set produced a "blackout"
  // you could comfortably read a wall by. It is cached in textures.js, so dropping the scene's
  // reference costs nothing and it comes back on the next level load.
  r.savedEnv = scene.environment;
  scene.environment = null;
  r.ambBase.intensity *= 0.05;
  r.hemi.intensity *= 0.05;
  if (r.sun) { r.sunI = 0; r.sun.intensity = 0; }
  if (r.fill) { r.fillI = 0; r.fill.intensity = 0; }
  if (world.litMesh) world.litMesh.visible = false;
  sfx.explosion(player.pos);
  hud.flashWhite(0.5);
  world.blind = Math.max(world.blind, 0.6);
  hud.noShoot('POWER CUT');
  hud.feed('LIGHTS ARE OUT — GOGGLES ON (N)', '#9dffc4');
  // Blind men fight worse. They also cannot see you at range any more, which is the point of
  // owning the dark: the goggles are an advantage, not just a different colour palette.
  for (const e of world.enemies) e.range = Math.min(e.range, 12);
  world.darkRange = 12;
}

function startLevel(id) {
  if (world?.drone) {
    world.drone.dispose();
    world.drone = null;
  }
  clearObjectiveMarker();
  // Strike wrecks deliberately survive the handoff back to infantry, but not the next mission.
  // Explicitly release their geometries/materials before discarding the old Scene reference.
  for (const wreck of (scene?.userData.droneWrecks || [])) {
    scene.remove(wreck);
    wreck.userData.dispose?.();
  }
  const oldDroneWarmup = scene?.userData.droneWarmup;
  if (oldDroneWarmup) {
    scene.remove(oldDroneWarmup);
    oldDroneWarmup.userData.dispose?.();
  }
  const loadId = ++levelLoadId;
  currentLevel = id;
  const L = LEVELS[id - 1];
  const diff = DIFFICULTIES[S.difficulty];
  const missionVariant = missionRuns[id]++ % 3;

  scene = new THREE.Scene();
  // built before the lights because the sun's shadow frustum is fitted to these bounds
  takeLights();   // drop anything a stray L.geo() call left behind
  // Levels register flashing lights by pushing onto this while building their geometry.
  const levelBeacons = [];
  const visualProps = [];
  window.__bpBeacons = levelBeacons;
  window.__bpVisualProps = visualProps;
  window.__bpMissionVariant = missionVariant;
  const geo = [...L.geo(), ...(L.extraGeo ? L.extraGeo() : [])];
  const roomLights = takeLights();
  scene.background = new THREE.Color(L.sky);
  scene.fog = new THREE.Fog(L.fog[0], L.fog[1], L.fog[2]);

  // ---------- world backdrop ----------
  // Derived from the level's own footprint rather than authored per level: every outdoor
  // level gets a sky, a ground plane that reaches the horizon, and a city ringing the play
  // area inside its fog. Interiors (blackout, underground) see none of it and skip the cost.
  const indoor = !!L.nvg || L.id === 9;
  const bounds = levelBounds(geo);
  skyMesh = null;
  if (!indoor) {
    skyMesh = skyDome(L.sky, L.fog[0], L.id * 7919);
    scene.add(skyMesh);
    geo.push(...groundPlate(bounds.cx, bounds.cz, L.fog[0]));
    // Skyline is decorative and non-solid, so it is appended AFTER bounds/shadow fitting:
    // a 300m ring of scenery must not blow out the shadow frustum it has no business in.
    geo.push(...skyline(bounds, L.fog[2], L.id * 104729, { body: L.skylineTint }));
  }
  window.__bpBeacons = null;
  window.__bpVisualProps = null;
  window.__bpMissionVariant = null;

  // PBR metals need something to reflect or they render black. Also supplies soft ambient
  // bounce, which is why the ambient light below can be dialled back once this is on.
  if (quality.pbr) {
    scene.environment = skyMesh
      ? environmentFrom(renderer, skyMesh.userData.skyCanvas, `sky${L.id}`)
      : environment(renderer, L.sky, L.fog[0]);
  }
  // The per-level ambient/sun values were authored against MeshLambertMaterial. Standard
  // responds differently, so scale here rather than rewriting all ten levels' art direction.
  // Key light gets the bigger boost and ambient the smaller one: strong key + darker fill is
  // what gives a scene shape instead of the uniform flat wash Lambert produced.
  // ambientScale lets a level that is mostly interior pull the global fill DOWN so its own
  // ceiling fixtures actually shape the rooms. A fixture can only read as a pool of light if
  // it is bright relative to the ambient; at full fill it just adds a flat offset and the
  // room stays shapeless no matter how many you hang.
  const AS = L.ambientScale ?? 1;
  const AMB = (quality.pbr ? 1.35 : 1) * AS;
  const KEY = quality.pbr ? 2.1 : 1;
  // Two ambients and two hemispheres, one pair natural and one pair intensified green, with
  // exactly one pair visible at a time. Building both up front is what makes the goggles a
  // free toggle instead of a level rebuild — and the green ambient is boosted because gain is
  // the entire point of the device: goggles must show you MORE than your naked eye did.
  const ambBase = new THREE.AmbientLight(0xbfd4e6, L.ambient * AMB);
  const nvgAmb = new THREE.AmbientLight(0x8dffb4, L.ambient * AMB * (L.nvg ? 1 : 1.5));
  const nvgHemi = new THREE.HemisphereLight(0xa8ffc8, 0x0e2416, 0.9);
  scene.add(ambBase, nvgAmb, nvgHemi);
  let sunLight = null, fillLight = null;
  if (L.sun > 0) {
    const sun = new THREE.DirectionalLight(0xdfe8ff, L.sun * KEY);
    sun.position.set(30, 60, 20);
    if (quality.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      // Fit the ortho shadow frustum to the level's actual footprint. Guessing a fixed
      // radius wastes most of the shadow map on empty space and gives blocky edges.
      // MUST be the playable bounds captured before the backdrop was appended — the ground
      // plate is 2400m across and would stretch every shadow texel into uselessness.
      const b = bounds;
      const r = Math.max(b.r, 12);
      const cam = sun.shadow.camera;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
      cam.near = 1; cam.far = r * 4 + 80;
      cam.updateProjectionMatrix();
      sun.target.position.set(b.cx, 0, b.cz);
      scene.add(sun.target);
      sun.position.set(b.cx + 30, 60, b.cz + 20);
      // acne on the big merged mesh: normalBias handles the flat faces, bias the rest
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.04;
    }
    scene.add(sun);
    sunLight = sun;
    // fill from the opposite side so faces away from the sun still separate
    const fill = new THREE.DirectionalLight(0xa8c0d8, L.sun * 0.35 * AMB);
    fill.position.set(-25, 30, -35);
    scene.add(fill);
    fillLight = fill;
  }
  const hemi = new THREE.HemisphereLight(0x9db4c8, 0x2a323a, (L.flashlight ? 0.15 : 0.65) * AMB);
  scene.add(hemi);
  nvgRig = { ambBase, nvgAmb, nvgHemi, hemi, sun: sunLight, fill: fillLight,
             sunI: sunLight ? sunLight.intensity : 0, fillI: fillLight ? fillLight.intensity : 0,
             fixtures: null };
  setNvg(!!L.nvg);

  // Interior fixtures. Every one of these is a per-fragment loop iteration on the big merged
  // mesh, so the count is capped hard and the drop is REPORTED — a silently truncated light
  // list looks like a lighting bug two weeks later. No shadows from these: a shadow-casting
  // point light is six render passes, which no interior here is worth.
  const LIGHT_CAP = quality.pbr ? 14 : 6;
  const used = roomLights.slice(0, LIGHT_CAP);
  const fixtures = [];
  for (const l of used) {
    const pl = new THREE.PointLight(l.color, l.intensity * (L.nvg ? 0.35 : 1), l.distance, 2);
    pl.position.set(l.pos[0], l.pos[1], l.pos[2]);
    scene.add(pl);
    fixtures.push(pl);          // kept so a level can cut the power later
  }
  nvgRig.fixtures = fixtures;
  if (roomLights.length > used.length) {
    console.warn(`[bp] level ${L.id}: ${roomLights.length - used.length} of ${roomLights.length} fixtures dropped (cap ${LIGHT_CAP})`);
  }

  const { solids, mesh: staticMesh, litMesh } = buildStaticGeometry(scene, geo);
  addVisualProps(scene, visualProps);
  addInteriorMissionArt(scene, L.id);
  if (!indoor) addFrontlineAmbientArt(scene, L.id, bounds);
  addFrontlineMissionArt(scene, L.id);
  if (L.id === 2) {
    addStreetSweepArt(scene);
    addFrontlineStreetArt(scene);
  }

  // Emergency beacons. These cannot ride in the merged static mesh — that whole design is one
  // draw call precisely because nothing in it animates — so each lens is its own tiny unlit
  // quad plus a point light, driven by a persistent effect below.
  const beaconLights = [];
  for (const b of (levelBeacons || [])) {
    const warm = b.hue === 'red' ? 0xff2d24 : 0x2d6bff;
    const lens = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.16, 0.62),
      new THREE.MeshBasicMaterial({ color: warm, transparent: true, opacity: 0.25 })
    );
    lens.position.set(b.pos[0], b.pos[1], b.pos[2]);
    scene.add(lens);
    const pl = new THREE.PointLight(warm, 0, 18, 2);
    pl.position.set(b.pos[0], b.pos[1] + 0.25, b.pos[2]);
    scene.add(pl);
    beaconLights.push({ lens, pl, red: b.hue === 'red' });
  }

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
    level: L, diff, solids, doors, nav, staticMesh, litMesh, missionVariant,
    enemies: [], civilians: [], allies: [], grenades: [], effects: [],
    playerPos: player.pos, playerYaw: player.yaw, playerSpeed: 0, playerAds: false, playerCrouched: false,
    combatHeat: 0, slowmo: 0, blind: 0,
    hostageCommand: 'follow',
    objectiveIdx: 0, won: false, over: false,
    stats: { kills: 0, shotsFired: 0, shotsHit: 0, civKills: 0, rescued: 0, startTime: performance.now(), score: 0 },
    sniperTeam: null,
    // A kill the squad made still counts toward the objective — the room has to be clearable
    // — but it earns the player no score. Otherwise the optimal play is to stand behind cover
    // and let them farm, and the grade stops meaning anything.
    onEnemyKilled(e, byAlly) {
      this.stats.kills++;
      if (byAlly) hud.feed('SQUAD — HOSTILE DOWN', '#8fd0ff');
      else { this.stats.score += 100; hud.feed('HOSTILE DOWN', '#a5d6a7'); }
      this.combatHeat = Math.max(this.combatHeat, 4);
    },
    onAllyDown(a) {
      hud.feed(`${a.name} IS DOWN`, '#ef9a9a');
      sfx.noShoot();
      if (this.allies.every(x => x.dead)) {
        // On the sniper mission the team IS the mission — you exist to keep them alive.
        if (this.ctMission) failMission('ASSAULT TEAM LOST');
        else hud.feed('SQUAD ELIMINATED — YOU ARE ALONE', '#ef5350');
      }
    },
    // Friendly muzzle flash and tracers are BLUE-white, not the hostiles' orange. In a dark
    // firefight the colour of the tracer is how you know which direction is a threat.
    allyFlash(pos) {
      flashAt(pos, 0xcfe4ff);
    },
    allyTracer(a, t) {
      const from = new THREE.Vector3(a.pos.x, a.pos.y + 1.35, a.pos.z);
      const to = new THREE.Vector3(
        t.pos.x + (Math.random() - 0.5) * 1.2,
        t.pos.y + 1.1 + (Math.random() - 0.5) * 0.9,
        t.pos.z + (Math.random() - 0.5) * 1.2);
      tracer(from, to, 0x9fd0ff, 8);
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
      flashAt(pos, 0xffa640);
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
  // Retries rotate only between authored-safe positions. No unconstrained random offset may
  // put an actor inside a wall, outside the nav graph, or on the wrong side of a breach.
  let defs = L.enemies.map(d => d.positions
    ? { ...d, pos: [...d.positions[missionVariant % d.positions.length]] }
    : d);
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
  world.enemies = defs.map((d, index) => new Enemy(scene, {
    ...d,
    _seed: L.id * 200003 + missionVariant * 2017 + index * 193,
  }, diff));

  // Reinforcements. The clock is the pressure: dawdle and more men arrive, so a fast clean
  // sweep is rewarded with a smaller fight. The cap is HARD and scales with difficulty — an
  // uncapped drip would make every "eliminate all hostiles" objective impossible to satisfy,
  // and reinforcing during the final objective would do the same, so both are ruled out below.
  if (L.reinforce) {
    world.reinf = {
      ...L.reinforce,
      timer: L.reinforce.first ?? L.reinforce.every,
      sent: 0,
      max: Math.max(1, Math.round(L.reinforce.max * diff.enemyCountMul)),
    };
  }

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
  world.civilians = cdefs.map((d, index) => new Civilian(scene, {
    ...d,
    _seed: L.id * 100003 + missionVariant * 1009 + index * 97,
  }));

  // Squad. Not on the sniper mission: the player is a single man locked to a parapet and the
  // team he is covering is already down at the fountain — a stick standing on the roof with
  // him would contradict the entire premise of the level.
  if (L.squad && !L.lockPlayer) {
    world.allies = spawnSquad(scene, L.squad, L.start, solids);
    hud.feed(`${world.allies.length} FRIENDLIES ON YOU`, '#8fd0ff');
  }

  // Sniper stage: a CT element in black that actually goes in, instead of two ornaments
  // standing at a fountain. They advance a route toward the hostages while the player covers
  // them, which is what makes the mission a shoot / no-shoot problem rather than target
  // practice — every silhouette crossing the scope has to be identified before it is engaged.
  if (L.ctTeam) {
    world.allies = spawnRouteTeam(scene, L.ctTeam.count, L.ctTeam.at, L.ctTeam.route, solids, L.ctTeam.health);
    world.ctMission = true;
    input.ads = true;
  } else {
    input.ads = false;
  }

  // Alternating red/blue with a double-blink on each side: the rhythm is what makes it read
  // as an emergency light rather than a lamp on a timer. Returns false forever, so it lives
  // for the level; world.effects is rebuilt per level so it cannot leak.
  if (beaconLights.length) {
    let bt = 0;
    world.effects.push(dt => {
      bt += dt;
      const phase = bt % 1.1;
      const redOn = phase < 0.09 || (phase > 0.16 && phase < 0.25);
      const blueOn = phase > 0.55 && (phase < 0.64 || (phase > 0.71 && phase < 0.8));
      for (const b of beaconLights) {
        const on = b.red ? redOn : blueOn;
        b.pl.intensity = on ? 16 : 0;
        b.lens.material.opacity = on ? 1 : 0.22;
      }
      return false;
    });
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
  mode = 'loading';
  hud.objective('PREPARING TACTICAL SHADERS…');
  const warmWorld = world;
  const warmScene = scene;
  const droneWarmup = dronePrewarmGroup(
    L.objectives.find(objective => objective.type === 'drone' && objective.mode === 'strike'),
  );
  if (droneWarmup) {
    warmScene.add(droneWarmup);
    // Keep these invisible material owners alive until the next mission. Disposing them here
    // would let Three release the just-compiled programs, forcing the same variants to compile
    // again on each impact.
    warmScene.userData.droneWarmup = droneWarmup;
  }
  renderPipeline.prewarm(scene, camera).then(async firstResult => {
    if (droneWarmup) droneWarmup.visible = false;
    if (loadId !== levelLoadId || world !== warmWorld) return;
    setObjective();
    let result = firstResult;
    // A first-objective drone creates its aircraft targets and changes the active camera only
    // after the ground-scene prewarm. Run the same loading pass once more in the actual drone
    // view so its full target set is resident before input and profiling begin.
    if (world.drone) {
      const droneResult = await renderPipeline.prewarm(scene, camera);
      if (loadId !== levelLoadId || world !== warmWorld) return;
      result = {
        ...droneResult,
        ms: +(firstResult.ms + droneResult.ms).toFixed(1),
        programsBefore: firstResult.programsBefore,
        compiled: firstResult.compiled + droneResult.compiled,
      };
    }
    world.prewarm = result;
    mode = 'playing';
    sfx.objective();
  });
}

function clearObjectiveMarker() {
  if (!world?.beacon) return;
  scene?.remove(world.beacon);
  world.beacon.traverse(part => part.geometry?.dispose());
  world.beacon.userData.material?.dispose();
  world.beacon = null;
}

function setObjective() {
  const obj = world.level.objectives[world.objectiveIdx];
  hud.objective(obj ? obj.text : 'MISSION COMPLETE');
  world.objStuckTime = 0;
  world.lastIntelCallout = 0;
  if (world.markers) { for (const { m } of world.markers) scene.remove(m); world.markers = null; }
  if (world.objMarkers) { for (const m of world.objMarkers) scene.remove(m); world.objMarkers = []; }
  // Reach points use a grounded, depth-tested locator plus the HUD distance. A forty-metre
  // depth-disabled column made every objective visible through buildings and obscured the
  // authored location when the player arrived.
  clearObjectiveMarker();
  if (world.drone && !world.drone.complete) {
    world.drone.dispose();
    world.drone = null;
    player.locked = !!world.level.lockPlayer;
  }
  // Hostiles are identified by sight, behavior and weapon presentation—not supernatural UI.
  // Rescue markers remain a navigation aid, but are depth-tested and LOS-gated below.
  if (obj && obj.type === 'rescue') {
    world.markLive = 'rescue';
    world.markZone = obj.zone || null;
  } else { world.markLive = null; world.markZone = null; }
  if (obj && obj.type === 'reach') {
    const [zx, zz, , zy] = obj.zone;
    const marker = new THREE.Group();
    marker.name = 'objective-ground-marker';
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0x67c9e9,
      transparent: true,
      opacity: 0.46,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.28, 1.42, 40), markerMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    marker.add(ring);
    const ticks = [];
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.065), markerMat);
      tick.position.set(Math.cos(angle) * 1.68, 0.014, Math.sin(angle) * 1.68);
      tick.rotation.y = -angle + Math.PI / 2;
      marker.add(tick);
      ticks.push(tick);
    }
    marker.position.set(zx, (zy ?? 0) + 0.055, zz);
    marker.userData.ring = ring;
    marker.userData.ticks = ticks;
    marker.userData.material = markerMat;
    scene.add(marker);
    world.beacon = marker;
  } else if (obj && obj.type === 'drone') {
    player.locked = true;
    world.drone = new DroneController(scene, camera, obj, () => {
      if (!world?.drone) return;
      world.drone.complete = true;
    });
  }
}

// Scripted lights-out. Fires once, when every hostile carrying the trigger tag is down.
// Tag-based rather than "second objective complete" because level 1 clears all three rooms
// under a single objective — the beat has to hang off the room, not the objective list.
function blackoutTrigger() {
  const cfg = world.level.blackoutOn;
  if (!cfg || world.blackedOut) return;
  const tagged = world.enemies.filter(e => e.tag === cfg.tag);
  if (!tagged.length || !tagged.every(e => e.dead)) return;
  killPower();
}

// Timed reinforcements. Spawns are refused on the LAST objective so the mission always
// converges, and refused within 22m of the player so nobody materialises in front of him.
function reinforcements(dt) {
  const r = world.reinf;
  if (!r || world.over) return;
  const last = world.objectiveIdx >= world.level.objectives.length - 1;
  if (r.sent >= r.max || last) { hud.reinf(''); return; }
  r.timer -= dt;
  if (r.timer > 0) {
    // Only warn when it is close enough to act on; a permanent countdown is just noise.
    hud.reinf(r.timer < 12 ? `REINFORCEMENTS INBOUND ${Math.ceil(r.timer)}s` : '');
    return;
  }
  const group = Math.min(r.group ?? 2, r.max - r.sent);
  const spots = r.at.filter(s => Math.hypot(s[0] - player.pos.x, s[2] - player.pos.z) > 22);
  const pool = spots.length ? spots : r.at;
  let made = 0;
  for (let i = 0; i < group; i++) {
    const s = pool[(r.sent + i) % pool.length];
    const e = new Enemy(scene, {
      pos: [s[0] + (Math.random() - 0.5) * 2, s[1], s[2] + (Math.random() - 0.5) * 2],
      aggro: true, range: Math.min(r.range ?? 70, world.darkRange ?? 1e9),
      patrol: r.patrol || null, hold: !r.patrol,
    }, world.diff);
    // They arrive already looking for you — a reinforcement that stands around defeats
    // the entire point of putting a clock on the mission.
    e.state = 'alert';
    e.lastKnown = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
    world.enemies.push(e);
    made++;
  }
  r.sent += made;
  r.timer = r.every;
  hud.feed(`${made} HOSTILE${made > 1 ? 'S' : ''} REINFORCING`, '#ffab91');
  sfx.contact(player.pos);
  world.combatHeat = Math.max(world.combatHeat, 4);
}

// Deadlock failsafe: an enemy that hasn't moved or fired for 90s while a clear
// objective is stuck gets neutralized by "command" rather than soft-locking the mission.
function objectiveWatchdog(dt) {
  const obj = world.level.objectives[world.objectiveIdx];
  if (!obj) return;
  world.objStuckTime = (world.objStuckTime || 0) + dt;
  if (obj.type !== 'clear') return;
  const live = world.enemies.filter(e => !e.dead);
  // A stalled clear gets a coarse radio callout, never an x-ray marker. The direction is
  // relative and the range is deliberately broad: command can report a sector, not a head.
  if (world.objStuckTime > 60 && live.length
      && world.objStuckTime - (world.lastIntelCallout || 0) > 20) {
    const e = live.reduce((best, x) =>
      x.pos.distanceTo(player.pos) < best.pos.distanceTo(player.pos) ? x : best);
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
    let rel = Math.atan2(-dx, -dz) - player.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const dir = Math.abs(rel) < 0.65 ? 'AHEAD'
      : Math.abs(rel) > 2.5 ? 'BEHIND'
        : rel > 0 ? 'RIGHT' : 'LEFT';
    const d = Math.hypot(dx, dz);
    const range = d < 18 ? 'NEAR' : d < 45 ? 'MID-RANGE' : 'FAR';
    hud.feed(`COMMAND: LAST MOVEMENT ${dir} — ${range}`, '#ffd180');
    world.lastIntelCallout = world.objStuckTime;
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

  // The rendered camera centre is authoritative. Scope sway has already moved the camera, so
  // deriving another ray from player yaw/pitch would make the picture and bullet disagree.
  // Compute before recoil: recoil affects the NEXT shot, never the current one.
  const dir = camera.getWorldDirection(new THREE.Vector3());
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
  let hitEnemy = null, hitCiv = null, hitAlly = null, hitDist = wallDist, headshot = false;
  for (const e of world.enemies) {
    // exposed===false is the counter-sniper between peeks: he is not in the window, so there
    // is nothing there to hit. Without this you could kill him through a wall by memory.
    if (e.dead || e.exposed === false) continue;
    const tHead = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z,
      e.pos.x, e.pos.y + 1.64, e.pos.z, 0.2);
    const tBody = rayVerticalCapsule(o.x, o.y, o.z, dir.x, dir.y, dir.z,
      e.pos.x, e.pos.y + 0.72, e.pos.y + 1.37, e.pos.z, 0.25);
    const t = Math.min(tHead, tBody);
    if (t < hitDist) { hitDist = t; hitEnemy = e; hitCiv = null; headshot = tHead <= tBody; }
  }
  for (const c of world.civilians) {
    // exposed===false is a window civilian who is down behind the apron of his bay. Same rule
    // as the shooters: if he is not in the opening there is nothing there to hit.
    if (c.dead || c.exposed === false) continue;
    // hitY drops as they go prone, so a body on the floor is still hittable where it lies
    const t = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, c.pos.x, c.pos.y + c.hitY, c.pos.z, c.hitR);
    if (t < hitDist) { hitDist = t; hitCiv = c; hitEnemy = null; hitAlly = null; }
  }
  // Allies stop bullets. They have to: an ally you can shoot THROUGH is not in the world, and
  // the first time you walk one into your own line of fire you learn to check before firing.
  for (const a of world.allies) {
    if (a.dead) continue;
    const t = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, a.pos.x, a.pos.y + 1.1, a.pos.z, 0.55);
    if (t < hitDist) { hitDist = t; hitAlly = a; hitEnemy = null; hitCiv = null; }
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
  } else if (hitAlly) {
    const wasAlive = !hitAlly.dead;
    hitAlly.damage(weapons.spec.damage, world);
    sfx.noShoot();
    if (wasAlive && hitAlly.dead && world.ctMission) {
      // A .50 through the man you were sent to protect is not a scoring event. This IS the
      // shoot / no-shoot test on this mission, so it ends it.
      hud.noShoot('YOU SHOT YOUR OWN MAN');
      failMission('FRIENDLY KILLED BY OVERWATCH');
    } else {
      // Otherwise: full damage, a score bite, no mission failure. Killing your own man is
      // mostly its own punishment — you spend the rest of the level without him.
      world.stats.score -= 150;
      hud.noShoot('FRIENDLY FIRE — CHECK YOUR LANE');
      hud.feed('-150 FRIENDLY FIRE', '#ef9a9a');
    }
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

const COMBAT_FLASH_GEO = new THREE.SphereGeometry(0.13, 8, 6);
function flashAt(p, color) {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.88,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flash = new THREE.Mesh(COMBAT_FLASH_GEO, mat);
  flash.position.set(p.x, p.y + 1.4, p.z);
  scene.add(flash);
  world.effects.push(dt => {
    mat.opacity -= dt * 12;
    flash.scale.addScalar(dt * 3.5);
    if (mat.opacity > 0) return false;
    scene.remove(flash);
    mat.dispose();
    return true;
  });
}

// bullet strike on geometry: spark flash + sound, so misses read too
function impactAt(p) {
  sfx.impact(p);
  if (Math.random() < 0.35) sfx.ricochet(p);
  flashAt({ x: p.x, y: p.y - 1.4, z: p.z }, 0xffd090);
}

function civilianKilled(civ) {
  const protectedEvacuee = civ.hostage || civ.wasHostage;
  civ.kill();
  world.stats.civKills++;
  sfx.noShoot();
  hud.noShoot(protectedEvacuee ? 'EVACUEE DOWN' : 'CIVILIAN DOWN');
  if (world.diff.noShootFail || protectedEvacuee) {
    failMission(protectedEvacuee ? 'PROTECTED EVACUEE KILLED' : 'CIVILIAN CASUALTY — ZERO TOLERANCE');
  } else {
    world.stats.score -= world.diff.noShootPenalty;
    hud.feed(`-${world.diff.noShootPenalty} DISCIPLINE`, '#ef9a9a');
  }
}

const HOSTAGE_COMMANDS = ['follow', 'stay', 'down'];
const HOSTAGE_COMMAND_LABEL = {
  follow: 'FOLLOW',
  stay: 'STAY',
  down: 'GET DOWN',
};

function issueHostageCommand() {
  const evacuees = world.civilians.filter(
    civilian => civilian.rescuer === 'you' && civilian.rescued && !civilian.dead,
  );
  if (!evacuees.length) {
    hud.feed('NO FREED HOSTAGES TO COMMAND', '#90a4ae');
    return;
  }
  const current = HOSTAGE_COMMANDS.indexOf(world.hostageCommand);
  const command = HOSTAGE_COMMANDS[(current + 1) % HOSTAGE_COMMANDS.length];
  world.hostageCommand = command;
  let acknowledged = 0;
  for (const civilian of evacuees) {
    if (civilian.setEscortCommand(command)) acknowledged++;
  }
  hud.feed(
    `HOSTAGES — ${HOSTAGE_COMMAND_LABEL[command]} (${acknowledged})`,
    command === 'down' ? '#ffd180' : '#a5d6a7',
  );
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
  } else if (obj.type === 'drone') {
    done = !!world.drone?.complete;
  }
  if (done) {
    if (obj.type === 'drone' && world.drone) {
      world.drone.dispose();
      world.drone = null;
      player.locked = !!world.level.lockPlayer;
    }
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
  if (world?.drone) {
    world.drone.dispose();
    world.drone = null;
  }
  setTimeout(() => {
    mode = 'debrief';
    stopAmbient();
    hud.flashWhite(0);
    hud.show(false);
    hud.scope(false);
    hud.aimRef('none');
    hud.nvg(false);
    hud.squad('');
    hud.hostage('');
    hud.reinf('');
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

  if (skyMesh) skyMesh.position.copy(camera.position);
  if (mode !== 'playing' || !world) { if (scene) renderPipeline.render(scene, camera); clearEdges(); return; }

  if (input.pausePressed) { mode = 'paused'; hud.screen('pause'); clearEdges(); return; }

  // Arrow-key aim feeds lookDelta before the player consumes it. Real dt, not sdt:
  // slow-mo shouldn't make you turn slower.
  applyKeyLook(dt);

  // slow-mo
  let timeScale = 1;
  if (world.slowmo > 0) { world.slowmo -= dt; timeScale = 0.3; }
  const sdt = dt * timeScale;

  world.combatHeat = Math.max(0, world.combatHeat - sdt);
  swayPhase += dt * (input.breath ? 0.25 : 1);
  resetPathBudget();

  if (world.drone?.active) {
    world.drone.update(dt, input, world.solids);
    checkObjectives();
    renderPipeline.render(scene, camera);
    clearEdges();
    return;
  }

  // flashbang blindness decays
  if (world.blind > 0) {
    world.blind = Math.max(0, world.blind - dt);
    hud.flashWhite(Math.min(1, world.blind / 1.6));
  } else hud.flashWhite(0);

  // player
  player.update(dt, world.solids, world.diff, timeScale);
  world.playerSpeed = player.moveSpeed;
  world.playerAds = input.ads;
  world.playerYaw = player.yaw;
  // The formation anchors to the direction the player is TRAVELLING, not to where his head is
  // pointed. Anchoring it to the look direction meant the squad orbited him every time he
  // turned around, so they were permanently out of shot and he felt alone — turn to check on
  // your men and they have already scurried behind you again. Real men hold their ground when
  // the lead turns his head. Lerped rather than snapped so a change of direction walks them
  // round instead of teleporting them.
  if (world.squadHeading === undefined) world.squadHeading = player.yaw;
  if (world.playerSpeed > 1.2) {
    let d = player.yaw - world.squadHeading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    world.squadHeading += d * Math.min(1, dt * 3);
  }
  world.playerCrouched = player.crouch > 0.5;
  if (input.nvgPressed) setNvg(!nvgOn);
  updateListener(camera.position, player.yaw, player.pitch);
  if (player.dead && !world.over) failMission('KIA');

  // weapons
  if (input.swapPressed) weapons.swap();
  if (input.reloadPressed) weapons.reload();

  // ADS FOV + scope. This runs BEFORE weapons.update because firing happens inside that call:
  // the ballistic ray must see the same camera rotation as the player on the firing frame.
  const scoped = weapons.spec.scoped && input.ads;
  hud.scope(!!scoped);
  hud.aimRef(scoped ? 'scope' : input.ads ? 'ads' : 'hip');
  // a scoped Barrett at hipfire sensitivity is unusable; scale with magnification
  input.sensScale = scoped ? 0.28 : input.ads ? 0.62 : 1;
  const targetFov = input.ads ? weapons.spec.adsFov : 70;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();
  // Scope sway is camera motion and therefore ballistic motion. There is no separate hidden
  // sway in onPlayerShot. Holding breath removes both picture and shot movement.
  if (world.level.sniper && scoped && !input.breath) {
    camera.rotation.y += Math.sin(swayPhase * 1.7) * weapons.spec.sway;
    camera.rotation.x += Math.cos(swayPhase * 1.3) * weapons.spec.sway;
  }
  weapons.update(dt, input.fire, input.firePressed, input.ads);

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
      // Your own frag does not politely spare your squad. Same falloff as a hostile takes.
      for (const a of world.allies) {
        if (a.dead) continue;
        const d = a.pos.distanceTo(P);
        if (d < 7) a.damage(140 * (1 - d / 7), world);
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
  // Stack cue for the squad. Deliberately a WIDER radius than the breach prompt: the men
  // should already be forming the column as you walk up on the door, not snapping into it at
  // the moment the button appears.
  world.stackDoor = world.doors.nearStack(player.pos, 5.5);
  if (input.breachPressed && near) world.doors.breach(near, world);
  world.doors.update(dt);

  // actors
  if (input.hostageCommandPressed) issueHostageCommand();
  for (const e of world.enemies) e.update(sdt, world);
  for (const a of world.allies) a.update(sdt, world);
  for (const c of world.civilians) c.update(sdt, world);
  for (let i = world.effects.length - 1; i >= 0; i--) if (world.effects[i](dt)) world.effects.splice(i, 1);

  // markers on whatever the current objective actually wants from you
  if (!world.objMarkers) world.objMarkers = [];
  const wantMark = world.markLive;
  const marked = wantMark === 'rescue'
      ? world.civilians.filter(c => c.hostage && !c.dead && !c.rescued && inZone(c.pos, world.markZone))
      : [];
  while (world.objMarkers.length > marked.length) { scene.remove(world.objMarkers.pop()); }
  while (world.objMarkers.length < marked.length) {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.26),
      new THREE.MeshBasicMaterial({ color: 0x7cffb0, depthTest: true })
    );
    m.renderOrder = 999;
    scene.add(m);
    world.objMarkers.push(m);
  }
  for (let i = 0; i < marked.length; i++) {
    const a = marked[i];
    world.objMarkers[i].visible = hasLOSTo({ x: a.pos.x, y: a.pos.y + 1.2, z: a.pos.z });
    world.objMarkers[i].position.set(a.pos.x, a.pos.y + 2.3 + Math.sin(performance.now() / 350) * 0.12, a.pos.z);
    world.objMarkers[i].rotation.y += dt * 2.5;
  }

  // free any hostage you walk up to — or that the assault team reaches, which is the whole
  // job on the sniper mission, where the player physically cannot get to them
  for (const c of world.civilians) {
    if (!c.hostage || c.dead || c.rescued) continue;
    let by = null;
    if (player.pos.distanceTo(c.pos) < 2.2 && Math.abs(player.pos.y - c.pos.y) < 2.2) by = 'you';
    else {
      const man = world.allies.find(a => !a.dead && a.pos.distanceTo(c.pos) < 3.0 && Math.abs(a.pos.y - c.pos.y) < 2.2);
      if (man) by = man.name;
    }
    if (by && c.rescue(by)) {
      if (by === 'you') c.setEscortCommand(world.hostageCommand);
      world.stats.rescued++;
      world.stats.score += 150;
      hud.feed(by === 'you' ? 'HOSTAGE FREED +150' : `${by}: HOSTAGE FREED +150`, '#a5d6a7');
      sfx.objective();
    }
  }

  // an HVT who finishes his escape route is gone, and that is a failed mission
  if (!world.over) {
    const gone = world.enemies.find(e => e.hvt && e.escaped && !e.dead);
    if (gone) failMission('HVT ESCAPED');
  }

  // objectives + HUD
  if (!world.over) { checkObjectives(); objectiveWatchdog(dt); reinforcements(dt); blackoutTrigger(); }
  // Ground marker pulse + live distance readout on reach objectives.
  if (world.beacon) {
    const pulse = Math.sin(performance.now() / 420);
    world.beacon.userData.material.opacity = 0.42 + pulse * 0.08;
    world.beacon.userData.ring.scale.setScalar(1 + pulse * 0.065);
    world.beacon.rotation.y += dt * 0.22;
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
  if (world.ctMission) scoreLine += ` · TEAM: ${world.allies.filter(a => !a.dead).length}/${world.allies.length}`;
  hud.score(scoreLine);
  if (world.allies.length) {
    hud.squad(world.allies.map(a => a.dead
      ? `${a.name} KIA`
      : `${a.name} ${Math.max(0, Math.round(a.health / a.maxHealth * 100))}%`).join('  ·  '));
  } else hud.squad('');
  const escorted = world.civilians.filter(
    civilian => civilian.rescuer === 'you' && civilian.rescued && !civilian.dead,
  );
  hud.hostage(escorted.length
    ? `EVAC ${escorted.length} · ${HOSTAGE_COMMAND_LABEL[world.hostageCommand]} · H COMMAND`
    : '');

  renderPipeline.render(scene, camera);
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
  get rendererMode() { return renderPipeline.mode; },
  get performance() { return renderPipeline.performanceSnapshot(); },
  startLevel, LEVELS, S, input,
  CAMPAIGN,
  get campaign() { return campaignSnapshot(currentLevel, S); },
  setDifficulty(d) { S.difficulty = d; },
};

// QA autoplay bot: only with ?qa=1
if (new URLSearchParams(location.search).has('qa')) {
  import('./qa.js').then(m => { window.QA = m; });
}
