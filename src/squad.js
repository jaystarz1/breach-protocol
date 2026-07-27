// Friendly squad.
//
// The brief from the player: "I do the work, but they also move and shoot." That is the whole
// design constraint and it cuts both ways — an ally that clears the level for you removes the
// game, and an ally that stands in a doorway doing nothing is set dressing. So:
//
//   - They advance with you and take real positions, pathing on the same navgrid as the AI.
//   - They engage what they can see, in bursts, at meaningful but not lethal accuracy.
//   - They are worse shots than you and they hesitate, so the kills are still yours.
//   - They draw fire, which is the actual gameplay contribution: enemies split their attention.
//   - They can die. They do not respawn and losing them never fails the mission — that would
//     turn a squad from an asset into a babysitting objective.
import * as THREE from 'three';
import { makeCharacter, animateRig, deathPose } from './levelgen.js';
import { groundHeight, resolveXZ, hasLOS } from './physics.js';
import { claimPath, findPathFor } from './enemies.js';
import { sfx } from './audio.js';

const EYE = 1.5;

// Formation slots in player-local metres: x is right, z is BEHIND. Staggered so two allies
// never occupy the same doorway and neither one walks through the player's firing line.
const SLOTS = [[-2.0, 2.6], [2.0, 2.6], [-3.4, 4.4], [3.4, 4.4]];

export const CALLSIGNS = ['BRAVO-2', 'BRAVO-3', 'BRAVO-4', 'BRAVO-5'];

export const CT_CALLSIGNS = ['ALPHA-1', 'ALPHA-2', 'ALPHA-3', 'ALPHA-4'];

export class Ally {
  constructor(scene, pos, idx, opts = {}) {
    this.mesh = makeCharacter({ friendly: true, black: !!opts.black });
    this.mesh.position.set(pos[0], pos[1], pos[2]);
    scene.add(this.mesh);
    this.idx = idx;
    this.ct = !!opts.black;
    this.name = (opts.black ? CT_CALLSIGNS : CALLSIGNS)[idx % CALLSIGNS.length];
    this.slot = SLOTS[idx % SLOTS.length];
    // A route makes this man an independent element working to his own plan rather than a
    // shadow of the player. Needed for the sniper mission, where the player is locked to a
    // parapet 90m away and "follow him" would mean standing still on a roof forever.
    this.route = opts.route || null;
    this.routeIdx = 0;
    this.routeOff = opts.routeOff || [0, 0];
    this.health = opts.health ?? 140;
    this.maxHealth = this.health;
    this.dead = false;
    this.deathAnim = 0;
    this.yaw = 0;
    this.speed = 4.2;              // slightly faster than the player so they can catch up
    this.walkPhase = Math.random() * 6;
    this.moving = false;
    this.flinch = 0;
    this.stepAccum = 0;
    this.path = null;
    this.pathIdx = 0;
    this.repathTimer = 0;
    this.target = null;
    this.acquireTimer = Math.random() * 0.3;
    this.burstShots = 0;
    this.burstTimer = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 1 + Math.random() * 2;
    this.calloutTimer = 0;
    this.blocked = 0;        // seconds spent trying to move and getting nowhere
    this.forcePath = 0;      // seconds during which A* is mandatory, not optional
    this.progress = 0;       // metres actually covered this frame, after collision
  }

  get pos() { return this.mesh.position; }

  damage(amt, world) {
    if (this.dead) return;
    this.health -= amt;
    this.flinch = 0.22;
    if (this.health <= 0) {
      this.dead = true;
      this.deathAnim = 0.001;
      deathPose(this.mesh);
      sfx.flesh(this.pos);
      if (world && world.onAllyDown) world.onAllyDown(this);
    } else {
      sfx.flesh(this.pos);
    }
  }

  // Nearest live hostile this man can actually see. Re-run on a timer, not every frame: with
  // three allies and thirteen hostiles a per-frame sweep is ~40 LOS raycasts through the whole
  // solid list, which on level 10 is the single most expensive thing in the loop.
  acquire(world) {
    const p = this.pos;
    let best = null, bestD = Infinity;
    for (const e of world.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - p.x, e.pos.y - p.y, e.pos.z - p.z);
      if (d > 48 || d >= bestD) continue;
      if (!hasLOS(world.solids, p.x, p.y + EYE, p.z, e.pos.x, e.pos.y + 1.2, e.pos.z)) continue;
      bestD = d; best = e;
    }
    return best;
  }

  // Refuse the shot if a no-shoot is anywhere near the line. An ally that kills a hostage
  // fails the player's mission for reasons he had no way to prevent, which is unforgivable.
  lineIsClear(world, t) {
    const p = this.pos;
    const dx = t.pos.x - p.x, dz = t.pos.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const ux = dx / len, uz = dz / len;
    for (const c of world.civilians) {
      if (c.dead) continue;
      const vx = c.pos.x - p.x, vz = c.pos.z - p.z;
      const along = vx * ux + vz * uz;
      if (along < 0.5 || along > len + 1.5) continue;
      if (Math.abs(vx * uz - vz * ux) < 1.4) return false;   // perpendicular distance
    }
    return true;
  }

  // Closest hostage still tied up, within reach of the objective area.
  nearestBound(world) {
    let best = null, bestD = 14;
    for (const c of world.civilians) {
      if (!c.hostage || c.dead || c.rescued) continue;
      const d = Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  setPath(world, tx, ty, tz) {
    if (!world.nav || !claimPath()) return false;
    const path = findPathFor(world.nav, this.pos, tx, ty, tz);
    if (path && path.length) { this.path = path; this.pathIdx = 0; return true; }
    this.path = null;
    return false;
  }

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

  // Go somewhere, by whatever means works. This exists because the naive version — walk
  // straight at the target, fall back to A* only when far away — deadlocks the first time an
  // ally clips the corner of a crate: collision cancels the movement, nothing notices, and the
  // man grinds against a 1m box for the rest of the mission while the player walks off without
  // him. That is exactly what happened on level 2, at the crates by z=12.
  //
  // So: straight line while it is actually producing movement, A* the moment it stops, and a
  // sidestep if even A* cannot help (a body in a doorway, a prop the navgrid did not carve).
  goTo(dt, world, tx, ty, tz, speed) {
    const p = this.pos;
    const d = Math.hypot(tx - p.x, tz - p.z);
    const dy = Math.abs((ty ?? p.y) - p.y);
    this.forcePath = Math.max(0, this.forcePath - dt);
    // Different floor: the straight line is through a slab, so A* is the only option. Without
    // this an ally left on a roof stands directly above the player believing it is in position.
    const mustPath = dy > 1.6 || this.forcePath > 0;
    const direct = !mustPath && d < 14 &&
      hasLOS(world.solids, p.x, p.y + EYE, p.z, tx, p.y + EYE, tz);

    if (direct) {
      this.path = null;
      this.moveToward(tx, tz, dt, world, Math.min(speed, 1.2 + d * 0.8));
    } else {
      const goalMoved = !this.pathGoal || Math.hypot(this.pathGoal.x - tx, this.pathGoal.z - tz) > 3;
      if ((!this.path || goalMoved) && this.repathTimer <= 0) {
        this.repathTimer = 0.8;
        this.pathGoal = { x: tx, z: tz };
        this.setPath(world, tx, ty ?? p.y, tz);
      }
      if (!this.followPath(dt, world, speed)) this.moveToward(tx, tz, dt, world, speed * 0.85);
    }

    // Stuck accounting. `progress` is what survived collision resolution, so this catches
    // being wedged on geometry, which a "did I ask to move" check never would.
    if (this.progress < speed * dt * 0.3) {
      this.blocked += dt;
      if (this.blocked > 0.4) {
        this.blocked = 0;
        this.repathTimer = 0;        // let A* try again immediately
        this.forcePath = 2.5;        // and stop trusting the straight line for a while
        this.path = null;
        // Slide along the obstacle instead of into it, so a failed path still makes ground.
        const f = Math.atan2(tx - p.x, tz - p.z);
        this.moveBy(Math.cos(f) * this.strafeDir * speed * dt * 2,
                    -Math.sin(f) * this.strafeDir * speed * dt * 2, world);
        if (this.progress < speed * dt * 0.3) this.strafeDir *= -1;
      }
    } else this.blocked = 0;
  }

  update(dt, world) {
    if (this.dead) {
      if (this.deathAnim < 1) {
        this.deathAnim = Math.min(1, this.deathAnim + dt * 3);
        this.mesh.rotation.x = -Math.PI / 2 * this.deathAnim;
      }
      return;
    }
    const p = this.pos;
    this.moving = false;
    this.progress = 0;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.repathTimer -= dt;
    this.acquireTimer -= dt;
    this.strafeTimer -= dt;
    this.calloutTimer -= dt;

    // target upkeep: cheap per-frame LOS check on the CURRENT target only, full sweep on timer
    if (this.target && (this.target.dead ||
        !hasLOS(world.solids, p.x, p.y + EYE, p.z, this.target.pos.x, this.target.pos.y + 1.2, this.target.pos.z))) {
      this.target = null;
    }
    if (!this.target && this.acquireTimer <= 0) {
      this.acquireTimer = 0.35;
      this.target = this.acquire(world);
      if (this.target && this.calloutTimer <= 0) {
        this.calloutTimer = 6 + Math.random() * 6;
        sfx.contact(this.pos);
      }
    }

    const pp = world.playerPos;
    const leash = Math.hypot(p.x - pp.x, p.z - pp.z);

    if (this.target) {
      const t = this.target;
      const dist = Math.hypot(t.pos.x - p.x, t.pos.y - p.y, t.pos.z - p.z);
      this.yaw = lerpAng(this.yaw, Math.atan2(t.pos.x - p.x, t.pos.z - p.z), Math.min(1, dt * 8));
      const leashY = Math.abs(pp.y - p.y);
      // Regroup beats engage. An ally that keeps trading shots while the player walks two
      // rooms away is not a squad, and "too far" has to include a floor difference or a man
      // left upstairs will happily shoot down the stairwell forever.
      //
      // A route element is exempt: it answers to its own plan, and on the sniper mission the
      // player is locked on a rooftop 90m away, so "regroup on him" would freeze the assault.
      if (this.route) {
        const wp = this.route[Math.min(this.routeIdx, this.route.length - 1)];
        const tx = wp[0] + this.routeOff[0], tz = wp[1] + this.routeOff[1];
        // keep pushing unless the contact is close enough to be worth stopping for
        if (dist > 26 && Math.hypot(tx - p.x, tz - p.z) > 2.4) this.goTo(dt, world, tx, p.y, tz, this.speed * 0.55);
        else if (this.strafeTimer <= 0) { this.strafeTimer = 1.4 + Math.random() * 1.8; this.strafeDir *= -1; }
      }
      else if (leash > 16 || leashY > 1.6) this.goTo(dt, world, pp.x, pp.y, pp.z, this.speed);
      else if (dist > 22) this.goTo(dt, world, t.pos.x, t.pos.y, t.pos.z, this.speed * 0.7);
      else if (this.strafeTimer <= 0) { this.strafeTimer = 1.4 + Math.random() * 1.8; this.strafeDir *= -1; }
      else if (dist > 8) {
        const f = Math.atan2(t.pos.x - p.x, t.pos.z - p.z);
        this.moveBy(Math.cos(f) * this.strafeDir * this.speed * 0.3 * dt,
                    -Math.sin(f) * this.strafeDir * this.speed * 0.3 * dt, world);
      }
      // Face the contact regardless of what the feet are doing.
      this.yaw = lerpAng(this.yaw, Math.atan2(t.pos.x - p.x, t.pos.z - p.z), Math.min(1, dt * 8));
      this.shoot(dt, world, t, dist);
    } else if (this.route) {
      // Working his own route. Each man carries a small lateral offset so a four-man element
      // moves as a spread line rather than a single-file conga.
      const last = this.routeIdx >= this.route.length - 1;
      const wp = this.route[Math.min(this.routeIdx, this.route.length - 1)];
      const tx = wp[0] + this.routeOff[0], tz = wp[1] + this.routeOff[1];
      // Mid-route a loose arrival is fine and keeps the element moving. On the FINAL leg it
      // is not: stopping 2.4m short of the objective puts the hostages out of arm's reach and
      // the mission simply never completes.
      const arrive = last ? 1.0 : 2.4;
      if (Math.hypot(tx - p.x, tz - p.z) < arrive) {
        if (!last) { this.routeIdx++; this.path = null; }
        else {
          // At the objective: go and physically get whoever is still tied up. Depending on
          // hostages happening to fall inside a fixed radius of a fixed stopping point is how
          // you ship a rescue mission that cannot be completed.
          const h = this.nearestBound(world);
          if (h) this.goTo(dt, world, h.pos.x, p.y, h.pos.z, this.speed * 0.7);
        }
      } else {
        this.goTo(dt, world, tx, p.y, tz, this.speed * 0.8);
      }
    } else {
      // no contact: hold the formation slot, rotated into the player's frame
      const c = Math.cos(world.playerYaw || 0), s = Math.sin(world.playerYaw || 0);
      const ox = this.slot[0], oz = this.slot[1];
      const sx = pp.x - (ox * c + oz * s);
      const sz = pp.z - (oz * c - ox * s);
      const d = Math.hypot(sx - p.x, sz - p.z);
      if (d > 2.2 || Math.abs(pp.y - p.y) > 1.6) {
        this.goTo(dt, world, sx, pp.y, sz, this.speed);
      } else {
        this.yaw = lerpAng(this.yaw, world.playerYaw || 0, Math.min(1, dt * 4));
      }
    }

    this.yieldToPlayer(dt, world);
    this.settle(dt, world);
  }

  // Get out of the way. Two separate problems, both of which ruin a firefight:
  //   1. An ally pressed against you fills the screen — in a doorway it IS the screen.
  //   2. An ally standing in your lane eats your rounds, and friendly fire is on.
  // So: shove clear if too close, and slide laterally out of the forward cone if in it. The
  // push is applied after the AI has decided where it wants to be, so it overrides the
  // formation logic rather than fighting it.
  yieldToPlayer(dt, world) {
    if (this.route) return;                      // independent element, not in his pocket
    const p = this.pos, pp = world.playerPos;
    if (Math.abs(pp.y - p.y) > 1.6) return;      // different floor, not in the way
    const dx = p.x - pp.x, dz = p.z - pp.z;
    const d = Math.hypot(dx, dz);
    if (d > 3.2) return;
    if (d < 0.001) { this.moveBy(0.4 * dt, 0, world); return; }

    // straight back off if he is right on top of us
    if (d < 1.5) this.moveBy(dx / d * 3.0 * dt, dz / d * 3.0 * dt, world);

    // In the firing cone? Project onto the player's forward axis. The signs are NEGATED
    // because Player.forward() is (-sin yaw, _, -cos yaw), not (+sin, +cos) — get this
    // backwards and the code diligently clears allies out of the lane BEHIND the player while
    // leaving them standing in front of the muzzle, which is precisely wrong.
    const yaw = world.playerYaw || 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const along = dx * fx + dz * fz;
    if (along <= 0) return;                       // behind him, which is where he wants us
    const lateral = dx * fz - dz * fx;            // signed perpendicular offset
    if (Math.abs(lateral) > 1.1) return;          // already clear of the lane
    const side = lateral >= 0 ? 1 : -1;
    this.moveBy(fz * side * 3.4 * dt, -fx * side * 3.4 * dt, world);
  }

  shoot(dt, world, t, dist) {
    this.burstTimer -= dt;
    if (this.burstTimer > 0) return;
    if (this.burstShots <= 0) {
      // The pause between bursts is the balance dial: longer than a hostile's, so a firefight
      // stays yours to win. Doubling it is how you make the squad feel supportive not decisive.
      this.burstShots = 2 + Math.floor(Math.random() * 3);
      this.burstTimer = 1.1 + Math.random() * 1.1;
      return;
    }
    if (!this.lineIsClear(world, t)) { this.burstShots = 0; this.burstTimer = 0.5; return; }
    this.burstShots--;
    this.burstTimer = 0.12;
    sfx.enemyShot(this.pos);
    world.allyFlash(this.pos);
    world.allyTracer(this, t);
    // Falls off hard with range and is capped well under the player's, so allies chip at
    // hostiles and finish stragglers rather than clearing rooms before you enter them.
    const acc = 0.3 * Math.min(1, 16 / Math.max(6, dist));
    if (Math.random() < acc) t.damage(22, world, false, true);
  }

  settle(dt, world) {
    const p = this.pos;
    const g = groundHeight(world.solids, p.x, p.z, 0.3, p.y + 0.75);
    p.y += ((g === -Infinity ? 0 : g) - p.y) * Math.min(1, dt * 10);
    this.mesh.rotation.y = this.yaw;
    animateRig(this.mesh, this.walkPhase, this.moving, this.flinch);
    if (this.moving) {
      this.stepAccum += dt;
      if (this.stepAccum > 0.4) {
        this.stepAccum = 0;
        if (p.distanceTo(world.playerPos) < 20) sfx.enemyStep(p);
      }
    } else this.stepAccum = 0.3;
  }

  moveToward(tx, tz, dt, world, speed) {
    const p = this.pos;
    const d = Math.hypot(tx - p.x, tz - p.z);
    if (d < 0.05) return;
    this.yaw = lerpAng(this.yaw, Math.atan2(tx - p.x, tz - p.z), Math.min(1, dt * 6));
    this.moveBy((tx - p.x) / d * speed * dt, (tz - p.z) / d * speed * dt, world);
  }

  moveBy(mx, mz, world) {
    this.moving = true;
    this.walkPhase += Math.hypot(mx, mz) * 5.5;
    const p = this.pos;
    const prev = { x: p.x, z: p.z };
    p.x += mx; p.z += mz;
    resolveXZ(world.solids, p, 0.35, p.y + 0.6, p.y + 1.6, prev);
    // Post-collision, so it measures ground actually covered rather than ground intended.
    this.progress = Math.hypot(p.x - prev.x, p.z - prev.z);
  }
}

function normAng(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function lerpAng(a, b, t) { return a + normAng(b - a) * t; }

// Spawn a stick behind the player's start position, on the ground, spread across the slots.
export function spawnSquad(scene, count, start, solids) {
  const out = [];
  const yaw = (start[3] || 0) * Math.PI / 180;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = 0; i < count; i++) {
    const [ox, oz] = SLOTS[i % SLOTS.length];
    const x = start[0] - (ox * c + oz * s);
    const z = start[2] - (oz * c - ox * s);
    const g = groundHeight(solids, x, z, 0.35, start[1] + 1.2);
    out.push(new Ally(scene, [x, g === -Infinity ? start[1] : g, z], i));
  }
  return out;
}

// A CT element in black that works a route instead of following the player. Spread in a
// shallow wedge so the player can tell four men apart through a scope at a hundred metres.
const WEDGE = [[-1.6, 1.2], [1.6, 1.2], [-3.2, 3.0], [3.2, 3.0]];
export function spawnRouteTeam(scene, count, at, route, solids, health = 180) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const off = WEDGE[i % WEDGE.length];
    const x = at[0] + off[0], z = at[2] + off[1];
    const g = groundHeight(solids, x, z, 0.35, at[1] + 1.2);
    out.push(new Ally(scene, [x, g === -Infinity ? at[1] : g, z], i,
      { black: true, route, routeOff: off, health }));
  }
  return out;
}
