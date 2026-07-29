// Autoplay QA bot. Loads only with ?qa=1. Drives the REAL input/collision/weapon
// systems along authored waypoint paths and reports per-level completability.
// Usage from console/eval:  QA.run(1, 10, {difficulty: 1, god: true})
import { input } from './input.js';
import { hasLOS, raySphere } from './physics.js';
import { findPath } from './navgrid.js';
import { streetShopLayout } from './mission-variants.js';

// Waypoints per level: [x, z] or [x, z, y]. The bot walks them in order,
// fights anything it sees along the way, auto-breaches doors, then relies on
// the objective system to finish the mission.
const PATHS = {
  1: [[0, 14], [7, 11], [0, 9], [0, 3], [7, -1], [7, -3], [0, -5], [0, -9], [7, -13], [9, -15], [0, -17], [0, -18]],
  2: [[0, 30], [0, 22], [8, 20], [11, 20], [8, 20], [0, 12], [-4, 2], [8, -4.5], [11, -5], [8, -4.5], [0, -14], [-6, -25], [-11, -25], [-6, -25], [0, -34], [0, -44], [0, -51]],
  3: [[0, 10], [0, 3], [0, -1], [3, -6], [-4, -8], [-5.9, -5, 0], [-5.9, -9.3, 3], [-4, -8, 3], [1, -4, 3], [4.5, -6, 3], [5, -8, 3],
      [-5.9, -2.4, 3], [-5.9, 1.2, 6], [-4, -4, 6], [1, -4, 6], [4.5, -6, 6], [-4, -8, 6],
      [-5.9, -5, 6], [-5.9, -9.3, 9], [-2, -6, 9]],
  4: [[0, 45], [0, 30], [2, 26], [5, 22], [5, 18.5], [13.5, 17.5], [5, 18.5], [8, 10], [2.5, -2], [2.5, -7], [-6, -7.5],
      [-6, -18], [-16, -28], [4, -28], [-14, -34], [-6.5, -37], [-6.5, -41]],
  5: [[0, 26], [-22, 15], [-8, 12], [8, 18], [22, 10], [22, 4], [-8, 4], [-24, 0], [-15, -8], [8, -20], [26, -30], [-26, -30], [0, -34], [0, -39.5]],
  6: [],  // sniper: locked position, combat only
  7: [[6.9, 2.4, 12], [6.9, -1.6, 9], [-4, -8, 9], [1, -4, 9], [5, -7, 9], [-5.5, -8.5, 9],
      [6.9, -10.3, 9], [6.9, -5.6, 6], [-4, -7, 6], [4, -7, 6],
      [6.9, 2.3, 6], [6.9, -1.6, 3], [-4, -6, 3], [1, -4, 3], [5, -8, 3], [-5.5, -8.5, 3],
      [6.9, -10.3, 3], [6.9, -5.6, 0], [0, -6, 0], [5, -3, 0], [-5, -9, 0], [0, 2, 0], [0, 10], [0, 14]],
  8: [[0, 24], [0, 17], [-2, 12], [-8, 5], [-11, 2], [0, 5], [3, 0], [3, -4], [12, -0.5], [10, 4], [10, -6], [10, -10], [3, -10],
      [-10, -12], [-10, -17], [-8, -17], [1, -11], [1, -16], [0, -18]],
  9: [[0, 44, 6], [0, 37, 6], [0, 30, 0], [0, 24], [0, 20], [-10, 10], [4, 4], [10, -4], [-4, -8], [6, -18], [0, -26], [-3, -31],
      [0, -36], [-2, -38], [3, -50], [0, -56]],
  10: [[0, 38], [0, 30], [0, 24], [-8, 16], [10, 12], [-12, 6], [0, 4], [0, -2], [0, -6], [4, -12], [-4, -14], [-6.9, -12.3, 0],
       [-6.9, -16.3, 3], [-4, -14, 3], [4, -13, 3], [-5, -8, 3], [-6.9, -7.7, 3], [-6.9, -3.8, 6], [4, -12, 6], [-4, -12, 6],
       [-6.9, -3.8, 6], [-6.9, -7.7, 3], [-6.9, -16.3, 3], [-6.9, -12.3, 0], [0, -2, 0], [10, -2], [17, -14], [22, -15], [22, -19, -2], [22, -23, -5],
       [22, -28, -5], [18, -34, -5], [26, -36, -5], [22, -39, -5]],
};

function streetSweepPath(variant) {
  const path = [[0, 34]];
  const shops = [...streetShopLayout(variant)].sort((a, b) => b.z - a.z);
  for (const shop of shops) {
    const approachX = shop.face === 'w' ? 6 : -6;
    path.push(
      [0, shop.z + 4],
      [approachX, shop.z],
      [shop.x, shop.z],
      [approachX, shop.z],
    );
  }
  path.push([0, -34], [0, -44], [0, -51]);
  return path;
}

export const RESULTS = [];
window.QA_RESULTS = RESULTS;

let timer = null;

export function stop() { if (timer) clearInterval(timer); timer = null; input.move.x = 0; input.move.y = 0; input.fire = false; }

export function run(from = 1, to = 10, opts = {}) {
  stop();
  const god = opts.god !== false;
  if (opts.difficulty !== undefined) BP.setDifficulty(opts.difficulty);
  let level = from;
  let wpIdx = 0;
  let levelStart = performance.now();
  let lastPos = null, stuckSince = 0, jiggleUntil = 0, jiggleDir = 1, bestWd = null;
  let dynPath = null, dynIdx = 0, dynTimer = 0, dynStuck = 0, dynLast = null;
  let lastObjIdx = -1, objSince = 0;
  let notes = [];
  let fireTick = 0, civJam = 0;
  let hpMin = 1, hpSum = 0, hpSamples = 0;

  function beginLevel() {
    BP.startLevel(level);
    wpIdx = 0; levelStart = performance.now();
    lastPos = null; stuckSince = 0; jiggleUntil = 0; bestWd = null;
    dynPath = null; dynIdx = 0; dynTimer = 0; dynStuck = 0; dynLast = null;
    lastObjIdx = -1; objSince = performance.now();
    hpMin = 1; hpSum = 0; hpSamples = 0;
    notes = [];
  }

  function report(result) {
    const w = BP.world;
    RESULTS.push({
      level, name: w.level.name, result,
      time: Math.round((performance.now() - levelStart) / 1000),
      kills: w.stats.kills, civKills: w.stats.civKills, score: w.stats.score,
      notes: [...notes],
    });
    console.log(`[QA] L${level} ${w.level.name}: ${result}`, notes.join(' | '));
  }

  beginLevel();

  window.QA_STATE = {
    get wpIdx() { return wpIdx; }, get stuck() { return stuckSince; }, get notes() { return notes; },
    get target() { const w = BP.world; if (!w) return null; const t = w.enemies.find(e => !e.dead); return t ? [t.pos.x.toFixed(1), t.pos.z.toFixed(1)] : null; },
  };

  timer = setInterval(() => {
    const w = BP.world, p = BP.player, weap = BP.weapons;
    if (!w || !p) return;

    // debrief showing → record and advance
    if (BP.mode === 'debrief') {
      if (!w.won) notes.push(`endpos=${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)} wp=${wpIdx} obj=${w.objectiveIdx}`);
      const why = w.stats.civKills ? 'civ' : w.enemies.some(e => e.escaped) ? 'hvt-escaped' : 'kia';
        if (!god) notes.push(`hpMin=${Math.round(hpMin * 100)}% hpAvg=${Math.round((hpSum / Math.max(1, hpSamples)) * 100)}%`);
      report(w.won ? 'PASS' : 'FAIL(' + why + ')');
      if (level >= to) { stop(); console.log('[QA] DONE', RESULTS); return; }
      level++;
      beginLevel();
      return;
    }
    if (BP.mode !== 'playing') return;

    if (god) { p.health = p.maxHealth; if (w.sniperTeam) w.sniperTeam.health = w.sniperTeam.maxHealth; }
    else {
      // track the worst moment of the level for the balance report
      hpMin = Math.min(hpMin, p.health / p.maxHealth);
      hpSamples++; hpSum += p.health / p.maxHealth;
    }

    // level time cap
    const cap = w.level.sniper ? 300 : 240;
    if ((performance.now() - levelStart) / 1000 > cap) {
      notes.push(`TIMEOUT obj=${w.objectiveIdx} pos=${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)} live=${w.enemies.filter(e => !e.dead).map(e => `(${e.pos.x.toFixed(0)},${e.pos.y.toFixed(0)},${e.pos.z.toFixed(0)})`).join('')}`);
      report('FAIL(timeout)');
      if (level >= to) { stop(); console.log('[QA] DONE', RESULTS); return; }
      level++; beginLevel(); return;
    }

    // objective hang tracking
    if (w.objectiveIdx !== lastObjIdx) { lastObjIdx = w.objectiveIdx; objSince = performance.now(); }

    const obj = w.level.objectives[w.objectiveIdx];

    // --- combat: nearest live visible enemy, but an HVT always outranks a guard ---
    const eye = { x: p.pos.x, y: p.pos.y + 1.6, z: p.pos.z };
    let target = null, tDist = Infinity;
    for (const e of w.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y, e.pos.z - p.pos.z);
      if (!hasLOS(w.solids, eye.x, eye.y, eye.z, e.pos.x, e.pos.y + 1.1, e.pos.z)) continue;
      const priority = e.hvt ? d - 400 : d;
      if (priority < tDist) { target = e; tDist = priority < 0 ? d : d; }
      if (e.hvt) { target = e; tDist = d; break; }
    }
    // hold fire if any civilian sits near the exact firing line (generous 0.9m sphere,
    // covers weapon spread) at any range up to the target
    let civRisk = false;
    if (target) {
      const dx = target.pos.x - eye.x, dyy = (target.pos.y + 1.15) - eye.y, dz = target.pos.z - eye.z;
      const dl = Math.hypot(dx, dyy, dz);
      const ux = dx / dl, uy = dyy / dl, uz = dz / dl;
      // Be deliberately over-cautious: sample each no-shoot body at knee, chest and head
      // height with a wide margin. A test bot that will not take a marginal shot is the
      // point — this mirrors the discipline the mission actually demands.
      const clearR = Math.max(1.1, Math.min(2.0, dl * 0.07));
      for (const c of w.civilians) {
        if (c.dead) continue;
        for (const h of [0.35, 0.95, 1.55]) {
          const t = raySphere(eye.x, eye.y, eye.z, ux, uy, uz, c.pos.x, c.pos.y + h, c.pos.z, clearR);
          if (t < dl + 1.5) { civRisk = true; break; }
        }
        if (civRisk) break;
      }
    }

    input.move.x = 0; input.move.y = 0;
    input.fire = false; input.breath = false; input.crouch = false;

    if (target && !civRisk) {
      // aim exactly at the hitbox center
      const dx = target.pos.x - eye.x, dz = target.pos.z - eye.z;
      const dy = (target.pos.y + 1.0) - eye.y;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      input.ads = w.level.sniper ? true : tDist > 30;
      input.breath = !!w.level.sniper;
      // crouch to shoot at range like a person would; enemy accuracy drops for it
      input.crouch = !god && !w.level.sniper && tDist > 9;
      if (weap.ammo.mag <= 0) input.reloadPressed = true;
      else if (weap.spec.auto) input.fire = true;
      else { fireTick++; if (fireTick % 12 === 0) { input.fire = true; input.firePressed = true; } }
      return; // stand and fight
    }
    if (target && civRisk) {
      // sidestep to open a clean line, and keep facing the threat while doing it
      const dx2 = target.pos.x - eye.x, dz2 = target.pos.z - eye.z;
      p.yaw = Math.atan2(-dx2, -dz2);
      input.move.x = jiggleDir;
      civJam += 0.1;
      if (civJam > 3) { jiggleDir *= -1; civJam = 0; }
      return;
    }
    civJam = 0;

    if (w.level.lockPlayer) return; // sniper: nothing to walk

    // --- dynamic goals: run down an HVT, or go free a hostage ---
    let dyn = null;
    if (obj && obj.type === 'target') {
      const hvt = w.enemies.find(e => e.hvt && !e.dead);
      if (hvt) dyn = hvt.pos;
    } else if (obj && obj.type === 'rescue') {
      let best = null, bd = Infinity;
      const zone = obj.zone;
      for (const c of w.civilians) {
        if (!c.hostage || c.dead || c.rescued) continue;
        if (zone) {
          if (zone[3] !== undefined && Math.abs(c.pos.y - zone[3]) > 3) continue;
          if (Math.hypot(c.pos.x - zone[0], c.pos.z - zone[1]) > zone[2]) continue;
        }
        const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z) + Math.abs(c.pos.y - p.pos.y) * 3;
        if (d < bd) { bd = d; best = c.pos; }
      }
      dyn = best;
    }
    if (dyn) {
      if (!dynPath || dynTimer <= 0 || dynIdx >= dynPath.length) {
        dynTimer = 1.0;
        dynPath = findPath(w.nav, p.pos.x, p.pos.y, p.pos.z, dyn.x, dyn.y, dyn.z) || [{ x: dyn.x, y: dyn.y, z: dyn.z }];
        dynIdx = 0;
      }
      dynTimer -= 0.1;
      const wp2 = dynPath[Math.min(dynIdx, dynPath.length - 1)];
      const d2 = Math.hypot(wp2.x - p.pos.x, wp2.z - p.pos.z);
      if (d2 < 1.1 && Math.abs(wp2.y - p.pos.y) < 1.6) { dynIdx++; dynStuck = 0; }
      p.yaw = Math.atan2(-(wp2.x - p.pos.x), -(wp2.z - p.pos.z));
      p.pitch = 0;
      input.move.y = -1;
      // dynamic goals need their own unstick, or a jammed doorway hangs the level
      if (dynLast && Math.hypot(p.pos.x - dynLast.x, p.pos.z - dynLast.z) < 0.06) {
        dynStuck += 0.1;
        if (dynStuck > 1.5) input.move.x = jiggleDir;
        if (dynStuck > 4) { dynPath = null; dynTimer = 0; jiggleDir *= -1; dynStuck = 0; }
        if (dynStuck > 3.6) {
          notes.push(`DYNSTUCK toward ${wp2.x.toFixed(1)},${wp2.z.toFixed(1)} at ${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)}`);
        }
      } else dynStuck = Math.max(0, dynStuck - 0.05);
      dynLast = { x: p.pos.x, z: p.pos.z };
      return;
    }
    dynPath = null;

    // --- navigate waypoints ---
    const path = level === 2 ? streetSweepPath(w.missionVariant) : PATHS[level] || [];
    if (wpIdx >= path.length) return; // path done; objectives (reach zone) should have fired
    const wp = path[wpIdx];
    const wdx = wp[0] - p.pos.x, wdz = wp[1] - p.pos.z;
    const wd = Math.hypot(wdx, wdz);
    const yOk = wp[2] === undefined || Math.abs(p.pos.y - wp[2]) < 2;
    if (wd < 1.2 && yOk) { wpIdx++; stuckSince = 0; bestWd = null; return; }

    p.yaw = Math.atan2(-wdx, -wdz);
    p.pitch = 0;
    input.ads = false;
    input.move.y = -1;
    if (performance.now() < jiggleUntil) input.move.x = jiggleDir;

    // auto-breach any door in reach
    const near = w.doors.nearBreachable(p.pos, p.yaw, w.objectiveIdx);
    if (near) input.breachPressed = true;

    // stuck detection: measured by progress TOWARD the waypoint, so wall-sliding
    // sideways doesn't mask being blocked
    if (bestWd === null || wd < bestWd - 0.4) { bestWd = wd; stuckSince = 0; }
    else {
      stuckSince += 0.1;
      if (stuckSince > 4 && performance.now() > jiggleUntil) {
        jiggleDir *= -1;
        jiggleUntil = performance.now() + 1500;
      }
      if (stuckSince > 12) {
        notes.push(`STUCK wp${wpIdx}(${wp[0]},${wp[1]}${wp[2] !== undefined ? ',' + wp[2] : ''}) at ${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)}`);
        // teleport past the blockage so the rest of the level still gets tested
        p.pos.set(wp[0], (wp[2] ?? p.pos.y) + 0.1, wp[1]);
        wpIdx++; stuckSince = 0; bestWd = null;
      }
    }
    lastPos = { x: p.pos.x, z: p.pos.z };
  }, 100);
}
