import { C, floorSlab, wall, stairs, crate, car, policeCar, marketStall } from '../levelgen.js';
import { quality } from '../quality.js';
import {
  facade, lift, rng, sandbags, waterTank, acUnit, ventStack, roofHutch,
  lamp, trafficLight, dumpster, hydrant, bench, barrier, roadLine, crosswalk, awning, shopSign,
  ceilingLight, hangingBulb, exitSign, baseboard, wainscot, doorFrame, desk, chair, table,
  shelf, cabinet, mattress, rug, radiator, pipes, poster, debris,
  posterWall, noticeBoard, whiteboard, wallClock, graffiti, picture, windowBay,
} from '../world.js';

// ---- OVERWATCH window bays -------------------------------------------------------------
// Slots are on facade()'s own grid, so a bay lands exactly over a pane and swallows it: the
// pane rows sit at x = wallStart + 1.8 + 3n and the sills at y = 1.2 + 3n. Off-grid values
// leave a lit pane peeking out of the side of the recess, which looks like a bug because it is.
// [x, sillY] against a wall face at z = -80 (near pair) or z = -100 (centre).
const BAY_A = [[-53.2, 4.2], [-50.2, 7.2], [-47.2, 4.2], [-44.2, 7.2], [-41.2, 4.2], [-35.2, 7.2], [-32.2, 4.2]];
const BAY_B = [[26.8, 4.2], [29.8, 7.2], [32.8, 4.2], [38.8, 7.2], [44.8, 4.2], [47.8, 7.2], [50.8, 4.2]];
// The sniper's building, and his alone. Eight openings on two floors of the centre block:
// nothing else lives here, so every silhouette that appears in this facade is him.
const BAY_C = [[-15.2, 4.2], [-9.2, 7.2], [-3.2, 4.2], [2.8, 7.2], [8.8, 4.2], [14.8, 7.2], [-6.2, 7.2], [5.8, 4.2]];
// A man stands 0.62m proud of the wall face: behind the reveal that hides him when he ducks,
// in front of the black recess that puts him inside a room instead of flat against the brick.
const inBay = (b, wallZ) => [b[0], b[1], wallZ + 0.62];

// A multi-storey tower with a west-side stairwell. Flights alternate corners per floor
// (even floors: NW flight ascending north; odd floors: SW flight ascending south) so no
// flight ever stacks over another — every floor is walkable UP and DOWN. Each flight
// tops out on a 1.1m landing connected to the main slab.
function tower(x, z, w, d, floors, opts = {}) {
  const geo = [];
  const fh = 3;
  const x1 = x - w / 2, x2 = x + w / 2, z1 = z - d / 2, z2 = z + d / 2;
  const sx = x1 + 1.1; // stair lane center
  // Top face at 0.04, NOT 0: the street/ground slab under every tower also tops out at y=0,
  // and two coplanar upward faces in the same merged mesh z-fight into a per-frame strobe.
  // 4cm is invisible, is well under the 0.6m step allowance, and matches what shop() does.
  geo.push(...floorSlab(x, z, w, d, 0.04, 0.4, C.interiorFloor));

  const slabWithWindow = (oy, color, parityBelow) => {
    // +0.02: the walls of the floor BELOW are exactly `fh` tall, so their top faces land on
    // oy too, and the slab overlaps them by half the wall thickness along every wall run.
    // That is a coplanar 1.8m2 band around the whole room perimeter, and it strobes. Lifting
    // the walking surface 2cm above the wall caps also clears the top stair tread at oy.
    const sy = oy + 0.02;
    geo.push(...floorSlab(x + 1.1, z, w - 2.2, d, sy, 0.3, color)); // east portion, full length
    if (parityBelow === 0) {
      // NW flight below: hole over z1+1.1..z1+4.5; cover the rest + top landing at z1..z1+1.1
      geo.push(...floorSlab(sx, z1 + 4.5 + (d - 4.5) / 2, 2.2, d - 4.5, sy, 0.3, color));
      geo.push(...floorSlab(sx, z1 + 0.55, 2.2, 1.1, sy, 0.3, color));
    } else {
      // SW flight below: hole over z2-4.5..z2-1.1; cover the rest + top landing at z2-1.1..z2
      geo.push(...floorSlab(sx, z1 + (d - 4.5) / 2, 2.2, d - 4.5, sy, 0.3, color));
      geo.push(...floorSlab(sx, z2 - 0.55, 2.2, 1.1, sy, 0.3, color));
    }
  };

  for (let f = 0; f < floors; f++) {
    const y = f * fh;
    const doorGap = (f === 0 && opts.door !== false) ? [{ off: w / 2 - 0.8, w: 1.6, h: 2.4 }] : [];
    geo.push(...wall(x1, z2, x2, z2, fh, C.building, doorGap, y)); // south (entry)
    geo.push(...wall(x1, z1, x2, z1, fh, C.building, [], y));
    geo.push(...wall(x2, z1, x2, z2, fh, C.building, [], y));
    geo.push(...wall(x1, z1, x1, z2, fh, C.building, [], y));
    // flight f climbs from floor f to floor f+1 (the top one reaches the roof)
    if (f % 2 === 0) geo.push(...stairs(sx, z1 + 4.5, 'n', 3.4, fh, 2.0, C.concrete, y));
    else geo.push(...stairs(sx, z2 - 4.5, 's', 3.4, fh, 2.0, C.concrete, y));
    if (f < floors - 1) slabWithWindow(y + fh, C.interiorFloor, f % 2);

    // ---- interior dressing, per floor ----
    // Without this a floor is four flat walls and a flat slab lit by nothing but scene
    // ambient, which is exactly why the insides looked worse than the outsides.
    const R = rng(9001 + f * 131 + Math.round(x * 7 + z * 13));
    const ex1 = x1 + 2.4, ex2 = x2 - 0.3;         // usable floor east of the stair lane
    const cz1 = z1 + 0.3, cz2 = z2 - 0.3;
    const ceil = y + fh - 0.05;
    // two fixtures per floor, offset from centre so the light is uneven and has direction
    geo.push(...ceilingLight((ex1 + ex2) / 2 - 1.2, ceil, cz1 + (cz2 - cz1) * 0.3, { intensity: 4.2 }));
    geo.push(...(R() < 0.4
      ? hangingBulb((ex1 + ex2) / 2 + 1.0, ceil, cz1 + (cz2 - cz1) * 0.72, 0.6)
      : ceilingLight((ex1 + ex2) / 2 + 1.0, ceil, cz1 + (cz2 - cz1) * 0.72, { intensity: 3.6 })));
    // trim: skirting round the room and a chair rail, which give the walls scale
    geo.push(...lift(baseboard(ex1, cz1, ex2, cz1), y));
    geo.push(...lift(baseboard(ex1, cz2, ex2, cz2), y));
    geo.push(...lift(baseboard(ex2, cz1, ex2, cz2), y));
    geo.push(...lift(wainscot(ex1, cz1 + 0.02, ex2, cz1 + 0.02, 1.05), y));
    geo.push(...lift(wainscot(ex2 - 0.02, cz1, ex2 - 0.02, cz2, 1.05), y));
    geo.push(...lift(pipes(ex1, cz2 - 0.5, ex2, cz2 - 0.5, fh - 0.35, 2), y));
    // furniture against the walls so the middle of the room stays walkable for the AI
    const wallZ = R() < 0.5 ? cz1 + 0.55 : cz2 - 0.55;
    geo.push(...lift(desk(ex2 - 1.1, wallZ, false), y));
    geo.push(...lift(chair(ex2 - 1.1, wallZ + (wallZ < z ? 1.0 : -1.0)), y));
    geo.push(...lift(shelf(ex2 - 0.45, z + (R() - 0.5) * 3, true, 1.9), y));
    geo.push(...lift(cabinet(ex1 + 0.5, cz1 + 0.9, true), y));
    if (R() < 0.6) geo.push(...lift(table(x + 1.4, z + (R() - 0.5) * 4), y));
    if (R() < 0.5) geo.push(...lift(mattress(ex1 + 1.2, cz2 - 1.1, R() < 0.5), y));
    if (R() < 0.7) geo.push(...lift(rug(x + 1.6, z, 2.6, 1.8), y));
    geo.push(...lift(radiator(ex2 - 0.22, z + (R() - 0.5) * 4, true), y));
    // Wall decoration, several pieces per floor rather than one lonely rectangle. The east
    // wall gets a fly-posted run, the north and south walls get a mix, and each floor draws a
    // different combination so climbing the building does not feel like the same room twice.
    // dir: the east wall faces -X and the south wall faces -Z from inside this room, so those
    // pieces have to stack their layers the other way or the ink hangs behind the paper.
    geo.push(...lift(posterWall(ex2 - 0.16, cz1 + 1.2, ex2 - 0.16, cz2 - 1.2, true, 800 + f * 29, 4, 1.65, -1), y));
    geo.push(...lift(poster(x + 1.2, cz1 + 0.18, false, 1.8, null, 810 + f), y));
    geo.push(...lift(poster(x + 3.0, cz1 + 0.18, false, 1.55, null, 811 + f), y));
    geo.push(...lift(poster(x + 2.0, cz2 - 0.18, false, 1.7, null, 812 + f, -1), y));
    if (R() < 0.55) geo.push(...lift(noticeBoard(x + 4.2, cz1 + 0.2, false, 1.6, 1.4, 1.0, 820 + f), y));
    else geo.push(...lift(whiteboard(x + 4.2, cz1 + 0.2, false, 1.65, 1.7, 1.05), y));
    geo.push(...lift(wallClock(x - 0.4, cz2 - 0.2, false, 2.35, 0.15, -1), y));
    geo.push(...lift(picture(x + 0.4, cz2 - 0.2, false, 1.7, 0.42, 0.32, -1), y));
    geo.push(...lift(picture(x + 1.1, cz2 - 0.2, false, 1.9, 0.42, 0.32, -1), y));
    // stairwell walls get tagged instead: nobody hangs art in a fire escape
    geo.push(...lift(graffiti(x1 + 0.2, z + (R() - 0.5) * 5, true, 830 + f * 7, 1.1), y));
    geo.push(...lift(debris(x + 2 + R() * 3, z + (R() - 0.5) * 5, 1.8, 6, 41 + f), y));
    // doorway trim on the ground-floor entrance
    if (f === 0 && opts.door !== false) {
      geo.push(...doorFrame(x1 + w / 2 - 0.8 + 0.8, z2, false, 1.6, 2.4));
    }
    geo.push(...exitSign(sx + 1.2, y + 2.4, f % 2 === 0 ? z1 + 1.0 : z2 - 1.0, false));
  }
  if (opts.roof !== false) {
    const ry = floors * fh;
    slabWithWindow(ry, C.roof, (floors - 1) % 2);
    geo.push(...wall(x1, z1, x2, z1, 0.9, C.concrete, [], ry));
    geo.push(...wall(x1, z2, x2, z2, 0.9, C.concrete, [], ry));
    geo.push(...wall(x2, z1, x2, z2, 0.9, C.concrete, [], ry));
    geo.push(...wall(x1, z1, x1, z2, 0.9, C.concrete, [], ry));
  }
  // The tower is a real traversable shell, but from the street its four uninterrupted wall
  // runs still read as one giant brick cuboid. Reuse the desktop facade system outside the
  // collision envelope: dark room recesses, damaged glazing, sills, utilities and cornices
  // give every floor scale without changing navigation or allowing fake window shots.
  const facadeOpts = {
    away: [x, z],
    step: opts.windowStep ?? 3.2,
    floorH: fh,
    lit: opts.windowLit ?? 0.16,
    damage: opts.facadeDamage ?? 0.5,
  };
  geo.push(...facade(x1, z2, x2, z2, 0, floors * fh, 30101 + floors * 17, {
    ...facadeOpts,
    skip: opts.door === false ? [] : [{ from: w / 2 - 1.1, to: w / 2 + 1.1 }],
  }));
  geo.push(...facade(x2, z1, x1, z1, 0, floors * fh, 30103 + floors * 19, facadeOpts));
  geo.push(...facade(x2, z2, x2, z1, 0, floors * fh, 30107 + floors * 23, facadeOpts));
  geo.push(...facade(x1, z1, x1, z2, 0, floors * fh, 30109 + floors * 29, facadeOpts));
  return geo;
}

// A simple one-room shop: 3 walls + an open storefront on the given face ('n','s','e','w').
function shop(x, z, w, d, face = 's') {
  const geo = [];
  const x1 = x - w / 2, x2 = x + w / 2, z1 = z - d / 2, z2 = z + d / 2;
  geo.push(...floorSlab(x, z, w, d, 0.05, 0.1, C.interiorFloor));
  const gap = { off: 1, w: (face === 'e' || face === 'w' ? d : w) - 2, h: 2.6 };
  geo.push(...wall(x1, z1, x2, z1, 3, C.buildingB, face === 'n' ? [gap] : []));
  geo.push(...wall(x1, z1, x1, z2, 3, C.buildingB, face === 'w' ? [gap] : []));
  geo.push(...wall(x2, z1, x2, z2, 3, C.buildingB, face === 'e' ? [gap] : []));
  geo.push(...wall(x1, z2, x2, z2, 3, C.buildingB, face === 's' ? [gap] : []));
  geo.push(...floorSlab(x, z, w + 0.6, d + 0.6, 3.1, 0.3, C.roof));
  return geo;
}

const GROUND = (w = 200, d = 200, color = C.street) => floorSlab(0, 0, w, d, 0, 1, color);

export const LEVELS = [
  // ---------------------------------------------------------------- 1
  {
    id: 1, name: 'FORWARD COMMAND',
    brief: 'A Vektor command post has taken direct fire during a readiness drill. Clear the three connected rooms and identify the infiltrators who carried BASTION’s launch-corridor map. Armed targets only; anyone with hands up walks out. The backup circuit may fail, so keep night vision ready.',
    weapons: ['pistol'], grenades: 0, squad: 1,
    sky: 0x27313d, fog: [0x27313d, 40, 130], ambient: 0.95, sun: 1.25,
    // roofed kill-house: the sun never reaches the rooms, so let the ceiling strips light them
    ambientScale: 0.42,
    start: [0, 0, 18, 0],
    geo: () => {
      const g = [];
      g.push(...GROUND(80, 80, C.concrete));
      // long corridor north with 3 rooms off it
      g.push(...wall(-3, 22, -3, -20, 3.2, C.interiorWall));
      g.push(...wall(3, 22, 3, -20, 3.2, C.interiorWall, [
        { off: 8, w: 1.5, h: 2.4 }, { off: 20, w: 1.5, h: 2.4 }, { off: 32, w: 1.5, h: 2.4 },
      ]));
      g.push(...wall(-3, 22, 3, 22, 3.2, C.interiorWall));
      g.push(...wall(-3, -20, 3, -20, 3.2, C.interiorWall, [{ off: 2, w: 2, h: 2.6 }]));
      // rooms east of corridor at z = 14…8, 2…-4, -10…-16
      let seat = 0;
      for (const rz of [11, -1, -13]) {
        g.push(...wall(3, rz + 3.5, 11, rz + 3.5, 3.2, C.interiorWall));
        g.push(...wall(3, rz - 3.5, 11, rz - 3.5, 3.2, C.interiorWall));
        g.push(...wall(11, rz + 3.5, 11, rz - 3.5, 3.2, C.interiorWall));
        g.push(...crate(9.5, rz + 2));
        // Each room gets its own fixture, trim and furniture. A kill-house with three
        // identical empty boxes gives you nothing to read the room by on entry.
        const R = rng(1100 + rz * 17);
        g.push(...ceilingLight(7, 3.15, rz, { intensity: 11, distance: 9 }));
        g.push(...baseboard(3.2, rz + 3.4, 10.9, rz + 3.4));
        g.push(...baseboard(3.2, rz - 3.4, 10.9, rz - 3.4));
        g.push(...baseboard(10.9, rz - 3.4, 10.9, rz + 3.4));
        g.push(...wainscot(3.2, rz + 3.35, 10.9, rz + 3.35, 1.05));
        g.push(...wainscot(10.85, rz - 3.4, 10.85, rz + 3.4, 1.05));
        // +2.25: the corridor wall's gaps are at off 8/20/32 from z=22, which puts the actual
        // doorway centres at 13.25/1.25/-10.75 — i.e. rz+2.25, not rz. Framing rz would trim
        // a solid stretch of wall and leave the real opening bare.
        g.push(...doorFrame(3.15, rz + 2.25, true, 1.5, 2.4));
        g.push(...pipes(3.4, rz - 2.6, 10.8, rz - 2.6, 2.9, 2));
        g.push(...desk(9.6, rz - 1.6, true));
        g.push(...chair(8.3, rz - 1.6, true));
        g.push(...cabinet(4.4, rz + 2.9, false, 1.4));
        g.push(...shelf(10.6, rz + 1.2, true, 1.9));
        if (seat === 0) g.push(...table(6.4, rz + 1.4, 1.3, 0.9), ...chair(6.4, rz + 0.2));
        if (seat === 1) g.push(...mattress(5.2, rz - 2.4, false), ...rug(7.2, rz, 2.6, 1.8));
        if (seat === 2) g.push(...rug(6.8, rz + 0.6, 3.0, 2.0), ...radiator(10.75, rz - 0.4, true));
        // Every room's walls get worked: a fly-posted run down the east wall, a board or a
        // whiteboard on the north wall, framed pictures and a clock. A kill-house room with
        // one poster in it still reads as a grey box; the eye needs several things to land on.
        g.push(...posterWall(10.78, rz - 2.4, 10.78, rz + 2.8, true, 900 + rz * 3, 4, 1.65, -1));
        g.push(...noticeBoard(6.2, rz + 3.28, false, 1.6, 1.5, 1.0, 910 + rz, -1));
        g.push(...poster(4.6, rz - 3.28, false, 1.75, null, 920 + rz));
        g.push(...poster(8.2, rz - 3.28, false, 1.6, null, 921 + rz));
        g.push(...picture(9.4, rz + 3.28, false, 1.85, 0.42, 0.32, -1));
        g.push(...wallClock(3.4, rz - 2.0, true, 2.35));
        if (seat === 1) g.push(...whiteboard(7.4, rz - 3.26, false, 1.7, 1.8, 1.05));
        if (seat === 2) g.push(...graffiti(3.35, rz - 1.0, true, 930 + rz, 1.0));
        g.push(...debris(6.0 + R() * 2, rz + (R() - 0.5) * 3, 1.6, 6, 200 + rz));
        seat++;
      }
      // corridor: strip lights, skirting and a run of conduit overhead
      for (const cz of [18, 10, 2, -6, -14]) g.push(...ceilingLight(0, 3.15, cz, { intensity: 7, distance: 7.5, w: 0.9 }));
      g.push(...baseboard(-2.8, 21.8, -2.8, -19.8));
      g.push(...baseboard(2.8, 21.8, 2.8, -19.8));
      g.push(...pipes(-1.4, 21, -1.4, -19, 2.95, 2));
      // The corridor is the longest wall run in the level and it was completely bare. Notices
      // and range-safety posters down the west side, tags down the east, boards at both ends.
      g.push(...posterWall(-2.78, 19, -2.78, 6, true, 940, 5, 1.7));
      g.push(...posterWall(-2.78, 0, -2.78, -18, true, 941, 5, 1.6));
      g.push(...noticeBoard(-2.72, 12, true, 1.6, 1.6, 1.1, 942));
      g.push(...whiteboard(-2.72, -8, true, 1.65, 1.9, 1.1));
      // 16.5, not 15: the corridor's east wall has doorways at z 12.5..14, 0.5..2 and
      // -11.5..-10, and a tag centred at 15 spans back to 13.9 — it would hang in the opening.
      g.push(...graffiti(2.78, 16.5, true, 943, 1.0));
      g.push(...graffiti(2.78, -16, true, 944, 1.1));
      g.push(...wallClock(-2.72, 20.5, true, 2.4));
      g.push(...poster(0, 21.8, false, 1.75, null, 945, -1));
      g.push(...exitSign(0, 2.5, -19.4, false));
      // roof over the whole house
      // This is a plaster/concrete soffit, not an exterior sheet-metal roof. Feeding it into
      // the metal surface family turned every point light into a mirror-bright streak running
      // the length of the corridor.
      g.push(...floorSlab(4, 1, 16, 44, 3.3, 0.3, C.interiorWall));
      return g;
    },
    // Role players fed in from the north end of the corridor. Small and slow: this is the
    // shakedown mission and the clock is meant to be felt, not to punish.
    // Clear room two and the breakers go. The third room is fought in the dark on goggles,
    // which is what turns the shakedown mission into a tutorial for owning the night.
    blackoutOn: { tag: 'r2' },
    reinforce: { every: 40, first: 45, max: 2, group: 1, range: 40, at: [[0, 0, 20]] },
    doors: [
      { pos: [3.15, 0, 13.25], rot: 90 }, { pos: [3.15, 0, 1.25], rot: 90 }, { pos: [3.15, 0, -10.75], rot: 90 },
    ],
    enemies: [
      { pos: [8, 0, 11], hold: true, yaw: 270 },
      // room two. Putting these men down cuts the power — see blackoutOn below.
      { pos: [9, 0, -1], hold: true, yaw: 270, tag: 'r2' }, { pos: [6, 0, -3], hold: true, yaw: 270, tag: 'r2' },
      { pos: [8, 0, -13], hold: true, yaw: 270 }, { pos: [9.4, 0, -15], hold: true, yaw: 270 },
    ],
    civilians: [
      { pos: [6, 0, 13], hostage: true }, { pos: [9.6, 0, 1.5], hostage: true }, { pos: [6.2, 0, -15.4], hostage: true },
    ],
    objectives: [
      { type: 'clear', zone: null, text: 'CLEAR ALL THREE ROOMS — HOSTILES ONLY' },
      { type: 'reach', zone: [0, -19, 3.5], text: 'EXIT THE KILL-HOUSE' },
    ],
  },

  // ---------------------------------------------------------------- 2
  {
    id: 2, name: 'STREET SWEEP',
    brief: 'A shell-damaged main street is the battery and warhead corridor for Observation Post Alpha. Russian assault troops hold the storefronts, civilians remain trapped on the block, and a direction-finding team is listening for drone-control traffic. Clear the route, then reach the launch table at the southern barricade.',
    weapons: ['pistol', 'm4'], grenades: 0, squad: 2,
    sky: 0x1b2634, fog: [0x1b2634, 40, 160], ambient: 0.85, sun: 1.1,
    start: [0, 0, 40, 0],
    geo: () => {
      const g = [];
      const v = window.__bpMissionVariant || 0;
      g.push(...GROUND(60, 130, C.street));
      // sidewalks
      g.push(...floorSlab(-12, 0, 8, 120, 0.15, 0.3, C.sidewalk));
      g.push(...floorSlab(12, 0, 8, 120, 0.15, 0.3, C.sidewalk));
      // building faces (solid) lining the street, now with windows and sills so the block
      // reads as occupied instead of as two long grey fences
      g.push(...wall(-16, 55, -16, -55, 9, C.building));
      g.push(...wall(16, 55, 16, -55, 9, C.building, []));
      g.push(...facade(-16, -55, -16, 55, 0, 9, 201, { away: [-30, 0], step: 3.2 }));
      g.push(...facade(16, -55, 16, 55, 0, 9, 202, { away: [30, 0], step: 3.2 }));
      // roofline clutter along both sides
      for (const [ax, az] of [[-18.5, 34], [-18.5, 6], [-18.5, -30], [18.5, 22], [18.5, -8], [18.5, -42]]) {
        g.push(...lift(acUnit(ax, 9, az, 1.1), 0));
      }
      g.push(...lift(waterTank(-19.5, 9, -12), 0), ...lift(waterTank(19.5, 9, 40), 0));
      // shops open toward the street
      g.push(...shop(11, 20, 9, 7, 'w'));
      g.push(...shop(11, -5, 9, 7, 'w'));
      g.push(...shop(-11, -25, 9, 7, 'e'));
      g.push(...awning(6.2, 20, 0.9, 7, 3.1), ...awning(6.2, -5, 0.9, 7, 3.1, 0x3b4d6a));
      g.push(...awning(-6.2, -25, 0.9, 7, 3.1, 0x4a5a3b));
      g.push(...shopSign(6.6, 20, 3.4, 3.6, true), ...shopSign(6.6, -5, 3.4, 3.6, true));
      g.push(...shopSign(-6.6, -25, 3.4, 3.6, true));
      // street furniture: lamps down both sidewalks, signals at the barricade end
      for (const lz of [46, 32, 18, 4, -10, -24, -38]) {
        g.push(...lamp(-13.4, lz, 6.8, 1.9, 1));
        g.push(...lamp(13.4, lz - 7, 6.8, 1.9, -1));
      }
      g.push(...trafficLight(-13.0, -46, 4.6, 1), ...trafficLight(13.0, -46, 4.6, -1));
      // Desktop owns one worn marking layer in street-sweep-art. Keeping these pristine box
      // stripes underneath it made the chips reveal a second white stripe instead of asphalt.
      if (!quality.desktop) {
        g.push(...roadLine(0, -48, 52));
        g.push(...crosswalk(-42, -8, 8), ...crosswalk(28, -8, 8));
      }
      // Tagged walls and fly-posting down both building faces. A 110m run of unbroken concrete
      // is the single largest surface in the level and it had nothing on it at eye height.
      for (const gz of [44, 30, 15, -2, -18, -34, -48]) g.push(...graffiti(-15.8, gz, true, 250 + gz, 1.3));
      for (const gz of [38, 22, 6, -12, -26, -44]) g.push(...graffiti(15.8, gz, true, 270 + gz, 1.3, -1));
      g.push(...posterWall(-15.78, 40, -15.78, 24, true, 280, 4, 1.7));
      g.push(...posterWall(-15.78, -6, -15.78, -22, true, 281, 4, 1.7));
      g.push(...posterWall(15.78, 34, 15.78, 18, true, 282, 4, 1.7, -1));
      g.push(...posterWall(15.78, -20, 15.78, -36, true, 283, 4, 1.7, -1));
      g.push(...dumpster(-13.6, 38), ...dumpster(13.6, -30, true));
      g.push(...hydrant(-13.8, 12), ...hydrant(13.8, -16));
      g.push(...bench(-13.2, 26, true), ...bench(13.2, 8, true));
      // street clutter
      g.push(...car(-4 + v * 0.45, 25, false, null, { variant: 2, damage: 4 }));
      g.push(...car(3, 5 - v * 0.7, true, null, { variant: 1, damage: 3 }));
      g.push(...car(-2 - v * 0.5, -18, false, null, { variant: 1, damage: 0 }));
      g.push(...car(5, -35 + v * 0.6, true, null, { variant: 0, damage: 5 }));
      // First responders got here before you did. The light bar is the only moving light in
      // the level and it does a lot of work on a static night street.
      g.push(...policeCar(-6, 33, false, window.__bpBeacons));
      g.push(...policeCar(6, -28, true, window.__bpBeacons));
      g.push(...crate(0, 12), ...crate(1.2, 12.8), ...crate(-6, -8));
      // end barricade
      g.push(...wall(-16, -50, 16, -50, 3, C.metal, [{ off: 13, w: 6, h: 2.6 }]));
      return g;
    },
    doors: [],
    enemies: [
      { pos: [0, 0, 22], positions: [[0, 0, 22], [-5, 0, 20], [5, 0, 24]], patrol: [[-6, 22], [6, 22]] },
      { pos: [11, 0, 20], hold: true, yaw: 180 },
      { pos: [-4, 0, 2], positions: [[-4, 0, 2], [4, 0, 8], [-7, 0, 7]], patrol: [[-8, 2], [4, 8]], concealed: true },
      { pos: [11, 0, -5], hold: true, yaw: 180 },
      { pos: [2, 0, -20], patrol: [[2, -20], [-5, -30]], aggro: true },
      { pos: [-11, 0, -25], hold: true, yaw: 0 },
      { pos: [0, 0, -44], hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [-9, 0, 30], rush: true }, { pos: [8, 0, 10] }, { pos: [-8, 0, -12], rush: true },
      { pos: [9.5, 0, -3], hostage: true },
    ],
    // Fed in from both ends of the street. Dawdle and the block refills behind you.
    reinforce: { every: 24, first: 28, max: 6, group: 2, range: 70,
      at: [[0, 0, 50], [-8, 0, -46], [8, 0, -46]] },
    objectives: [
      { type: 'clear', zone: null, text: 'SWEEP THE BLOCK — ELIMINATE ALL HOSTILES' },
      { type: 'reach', zone: [-11.2, -41.6, 3], text: 'ESTABLISH OBSERVATION POST ALPHA' },
      {
        type: 'drone',
        label: 'OP ALPHA',
        text: 'RECON EASTERN APPROACHES — MARK THREE ASSAULT ROUTES',
        launch: [-11.2, 1.25, -41.6],
        yaw: Math.PI,
        targets: [[-5, 0.1, -32], [8, 0.1, -19], [-9, 0.1, -5]],
      },
      { type: 'reach', zone: [0, -52, 3], text: 'PUSH THROUGH THE BARRICADE' },
    ],
  },

  // ---------------------------------------------------------------- 3
  {
    id: 3, name: 'OP ALPHA',
    brief: 'The apartment block above OP Alpha is being cleared room by room by a 37th assault team. Recover the observers and hold all three floors so the launch corridor keeps its eastern view. Flash the rooms before entry and walk up to each bound observer to release them.',
    weapons: ['pistol', 'm4'], grenades: 0, flashes: 3, squad: 2,
    sky: 0x232e3a, fog: [0x232e3a, 35, 120], ambient: 0.9, sun: 1.15,
    start: [0, 0, 16, 0],
    geo: () => {
      const g = [];
      g.push(...GROUND(60, 60, C.concrete));
      g.push(...tower(0, -4, 14, 12, 3));
      return g;
    },
    doors: [
      { pos: [0, 0, 2.1], rot: 0, w: 1.6 },      // ground entry
      { pos: [2, 3, -4], rot: 90, w: 1.5 },      // floor 2 interior door (mid-room divider)
      { pos: [2, 6, -4], rot: 90, w: 1.5 },      // floor 3
    ],
    // interior dividers on floors 2/3 so the door means something
    extraGeo: () => {
      const g = [];
      for (const y of [3, 6]) {
        g.push(...wall(2, -10, 2, -4.75, 3, C.interiorWall, [], y));
        g.push(...wall(2, -3.25, 2, 2, 3, C.interiorWall, [], y));
      }
      return g;
    },
    enemies: [
      { pos: [3, 0, -6], hold: true, yaw: 180 }, { pos: [-4, 0, -8], patrol: [[-4, -8], [4, -8]] },
      { pos: [4.5, 3, -7], hold: true, yaw: 90 }, { pos: [5.5, 3, -5], hold: true, yaw: 90 },
      { pos: [4.5, 6, -7], hold: true, yaw: 90 }, { pos: [5.8, 6, -4], hold: true, yaw: 90 }, { pos: [-4, 6, -8], hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [5.5, 0, -8.5], hostage: true }, { pos: [5.8, 3, -8.5], hostage: true },
      { pos: [4.8, 6, -8.8], hostage: true }, { pos: [6, 6, -8.2], hostage: true },
    ],
    reinforce: { every: 30, first: 35, max: 4, group: 2, range: 45, at: [[0, 0, 6]] },
    objectives: [
      { type: 'clear', zone: null, text: 'CLEAR ALL THREE FLOORS — PROTECT THE HOSTAGES' },
      { type: 'rescue', text: 'CUT THE HOSTAGES LOOSE — WALK UP TO EACH ONE' },
      { type: 'reach', zone: [-2, -6, 3, 9], text: 'GET TO THE ROOF' },
      {
        type: 'drone',
        label: 'OP ALPHA',
        text: 'LAUNCH FROM OP ALPHA — MAP THE NEXT ASSAULT AXES',
        launch: [-2, 9.45, -6],
        yaw: Math.PI,
        targets: [[-8, 0.1, 12], [10, 0.1, 6], [0, 0.1, -18]],
      },
    ],
  },

  // ---------------------------------------------------------------- 4
  {
    id: 4, name: 'DIRECTION FINDER',
    brief: 'A 37th signals officer is running BASTION’s direction-finding log through the alleys and parking structure. Stop him before the far gate. His escort will trade ground for time while a vehicle waits beyond the cordon.',
    weapons: ['pistol', 'm4'], grenades: 3, flashes: 2, squad: 2,
    sky: 0x1e2836, fog: [0x1e2836, 38, 150], ambient: 0.85, sun: 1.1,
    start: [0, 0, 45, 0],
    geo: () => {
      const g = [];
      g.push(...GROUND(120, 120, C.street));
      // zigzag alley: walls funneling north then west then north
      g.push(...wall(-5, 50, -5, 20, 7, C.building));
      g.push(...wall(5, 50, 5, 25, 7, C.building));
      g.push(...wall(5, 25, 25, 25, 7, C.building));
      g.push(...wall(-5, 20, 18, 20, 7, C.buildingB, [{ off: 9, w: 2.2, h: 2.6 }]));
      g.push(...wall(25, 25, 25, -10, 7, C.building));
      g.push(...wall(18, 20, 18, -5, 7, C.buildingB));
      g.push(...wall(18, -5, -20, -5, 7, C.building, [{ off: 14, w: 3, h: 2.8 }]));
      g.push(...wall(25, -10, -25, -10, 7, C.buildingB, [{ off: 20, w: 3, h: 2.8 }]));
      // These collision runs used to be the finished environment: enormous brick rectangles
      // with decals pasted onto them. Register occupied, damaged exterior faces toward each
      // leg of the chase. The facade system contributes real reveals, varied room backs,
      // glazing, boards, balconies, utilities, stepped rooflines and shell breaches while the
      // simple walls remain authoritative for navigation and bullets.
      const pursuitFacade = {
        floorH: 3.05, step: 3.15, lit: 0.1, damage: 0.68,
      };
      g.push(...facade(-5, 50, -5, 20, 0, 7, 4401, {
        ...pursuitFacade, away: [-10, 35],
      }));
      g.push(...facade(5, 50, 5, 25, 0, 7, 4402, {
        ...pursuitFacade, away: [10, 37.5],
      }));
      g.push(...facade(5, 25, 25, 25, 0, 7, 4403, {
        ...pursuitFacade, away: [15, 30],
      }));
      g.push(...facade(-5, 20, 18, 20, 0, 7, 4404, {
        ...pursuitFacade, away: [6.5, 25], skip: [{ from: 7.8, to: 12.4 }],
      }));
      g.push(...facade(25, 25, 25, -10, 0, 7, 4405, {
        ...pursuitFacade, away: [30, 7.5],
      }));
      g.push(...facade(18, 20, 18, -5, 0, 7, 4406, {
        ...pursuitFacade, away: [13, 7.5],
      }));
      g.push(...facade(18, -5, -20, -5, 0, 7, 4407, {
        ...pursuitFacade, away: [-1, 0], skip: [{ from: 12.8, to: 18.2 }],
      }));
      g.push(...facade(25, -10, -25, -10, 0, 7, 4408, {
        ...pursuitFacade, away: [0, -5], skip: [{ from: 18.8, to: 24.2 }],
      }));
      // parking structure: big slab on pillars
      g.push(...floorSlab(-5, -25, 44, 28, 3.5, 0.5, C.concrete));
      // 3.4 tall, not 3.5: at 3.5 each pillar cap is coplanar with the top of the slab it
      // holds up, putting 15 strobing 0.49m2 squares on that roof. 3.4 buries the cap inside
      // the slab (which spans y 3.0..3.5) where it is never rasterized.
      for (const px of [-24, -14, -4, 6, 14]) for (const pz of [-16, -25, -34]) g.push([px, 1.7, pz, 0.7, 3.4, 0.7, C.concrete]);
      g.push(...car(-18, -20)); g.push(...car(-8, -25, true)); g.push(...car(2, -31)); g.push(...car(10, -22));
      // Keep a few route tags, but no longer use decals as a substitute for architecture.
      for (const [gx, gz, r, d] of [[-4.76, 40, true, 1], [4.76, 32, true, -1],
        [17.76, 12, true, -1], [10, -4.76, false, -1], [4, -9.76, false, -1]]) {
        g.push(...graffiti(gx, gz, r, 400 + gx * 3 + gz, 1.4, d));
      }
      g.push(...posterWall(-4.74, 46, -4.74, 39, true, 410, 2, 1.7));
      g.push(...crate(21, 10), ...crate(21.8, 11));
      // exit gate south end of garage
      g.push(...wall(-27, -39, 17, -39, 4, C.metal, [{ off: 18, w: 5, h: 3 }]));
      return g;
    },
    doors: [],
    enemies: [
      // the runner: never fights, sprints the escape route, marked in the world
      { pos: [0, 0, 27], flee: true, hvt: true, escapes: true, hold: false,
        patrol: [[0, 22], [13.5, 17.5], [21, 10], [21, -2], [10, -7.5], [-6, -9], [-6, -20], [-14, -30], [-6.5, -37], [-6.5, -44]] },
      { pos: [2, 0, 30], hold: true, yaw: 180 },
      { pos: [21, 0, 15], patrol: [[21, 15], [21, 2]], aggro: true },
      { pos: [10, 0, -7.5], hold: true, yaw: 90 },
      { pos: [-6, 0, -18], patrol: [[-6, -18], [-16, -28]], aggro: true },
      { pos: [4, 0, -28], hold: true, yaw: 0 },
      { pos: [-14, 0, -34], patrol: [[-14, -34], [0, -34]], aggro: true },
      { pos: [-4, 0, -37], hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [-2, 0, 35], rush: true }, { pos: [20, 0, 5] }, { pos: [-10, 0, -22], rush: true }, { pos: [6, 0, -33] },
    ],
    // He is running and his men are buying time. The clock here is the entire mission.
    reinforce: { every: 20, first: 22, max: 8, group: 2, range: 60,
      at: [[0, 0, 46], [22, 0, 18], [-20, 0, -8], [-6, 0, -36]] },
    objectives: [
      { type: 'target', text: 'RUN HIM DOWN — DO NOT LET HIM REACH THE GATE' },
      { type: 'clear', zone: [-5, -25, 30], text: 'CLEAR THE GARAGE' },
      { type: 'reach', zone: [-6.5, -41, 3.5], text: 'EXFIL THROUGH THE GATE' },
    ],
  },

  // ---------------------------------------------------------------- 5
  {
    id: 5, name: 'MARKET INFILTRATION',
    brief: 'Armed infiltrators are blending into the crowded aid market beside the launch route. They will present weapons only when the signal is given and the crowd will bolt at the first shot. Identify before firing; on Veteran, one civilian casualty ends the mission.',
    weapons: ['pistol', 'm4'], grenades: 0, squad: 2,
    sky: 0x2a2230, fog: [0x2a2230, 40, 140], ambient: 0.9, sun: 1.1,
    start: [0, 0, 34, 0],
    geo: () => {
      const g = [];
      g.push(...GROUND(90, 90, C.sidewalk));
      // plaza perimeter walls
      g.push(...wall(-35, 38, 35, 38, 6, C.building, [{ off: 32, w: 6, h: 3 }]));
      g.push(...wall(-35, -38, 35, -38, 6, C.building, [{ off: 32, w: 6, h: 3 }]));
      g.push(...wall(-35, 38, -35, -38, 6, C.buildingB));
      g.push(...wall(35, 38, 35, -38, 6, C.buildingB));
      // Point these inward: this is a walled market courtyard, so its occupied faces belong
      // on the side the player can actually see.
      g.push(...facade(35, 38, -35, 38, 0, 6, 501, { step: 4.2 }));
      g.push(...facade(-35, -38, 35, -38, 0, 6, 502, { step: 4.2 }));
      g.push(...facade(-35, 38, -35, -38, 0, 6, 503, { step: 4.2 }));
      g.push(...facade(35, -38, 35, 38, 0, 6, 504, { step: 4.2 }));
      // market stalls: rows of counters with awning posts
      for (const sz of [18, 6, -6, -18]) {
        for (const sx of [-22, -8, 8, 22]) {
          g.push(...marketStall(sx, sz, (sx + sz) % 3 ? 0x7a4a4a : 0x3e596d));
        }
      }
      g.push(...crate(0, 0), ...crate(-15, 12), ...crate(15, -12));
      return g;
    },
    doors: [],
    enemies: [
      { pos: [-22, 0, 15], positions: [[-22, 0, 15], [-19, 0, 9], [-25, 0, 13]], hold: true, yaw: 180, concealed: true },
      { pos: [8, 0, 18], patrol: [[8, 18], [22, 18]] },
      { pos: [-8, 0, 4], positions: [[-8, 0, 4], [-11, 0, 1], [-5, 0, 8]], hold: true, yaw: 160, concealed: true },
      { pos: [22, 0, 4], patrol: [[22, 4], [22, -8]], aggro: true },
      { pos: [-15, 0, -8], positions: [[-15, 0, -8], [-19, 0, -12], [-11, 0, -10]], hold: true, yaw: 20, concealed: true },
      { pos: [8, 0, -20], patrol: [[8, -20], [-8, -20]], aggro: true },
      { pos: [26, 0, -30], hold: true, yaw: 0, concealed: true },
      { pos: [-26, 0, -30], hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [-18, 0, 20], rush: true }, { pos: [-4, 0, 16], rush: true }, { pos: [12, 0, 12] },
      { pos: [24, 0, 10] }, { pos: [-24, 0, 2] }, { pos: [2, 0, -2], rush: true }, { pos: [18, 0, -6] },
      { pos: [-10, 0, -14], rush: true }, { pos: [6, 0, -24] }, { pos: [-20, 0, -26] },
      { pos: [26, 0, 24] }, { pos: [0, 0, 24], rush: true },
      { pos: [-29, 0, 27] }, { pos: [-13, 0, 25], rush: true },
      { pos: [19, 0, 22] }, { pos: [30, 0, 3], rush: true },
      { pos: [-28, 0, -11] }, { pos: [14, 0, -15] },
      { pos: [-3, 0, -28], rush: true }, { pos: [25, 0, -23] },
    ],
    reinforce: { every: 26, first: 30, max: 6, group: 2, range: 60,
      at: [[0, 0, 34], [-30, 0, -34], [30, 0, -34]] },
    objectives: [
      { type: 'clear', zone: null, text: 'NEUTRALIZE EMBEDDED SHOOTERS — ZERO CIVILIAN CASUALTIES' },
      { type: 'reach', zone: [0, -40, 3.5], text: 'EXIT THE MARKET SOUTH GATE' },
    ],
  },

  // ---------------------------------------------------------------- 6
  {
    id: 6, name: 'RELAY CROSSING',
    brief: 'Cover Vektor’s black-clad assault element as it crosses the plaza to seize a 37th relay and release three detained technicians. Riflemen occupy windows beside civilians, so read every opening. A sniper in the unlit centre block is hunting you; only his muzzle flash reveals the room, and he relocates after two rounds.',
    weapons: ['barrett'], grenades: 0, sniper: true, lockPlayer: true,
    sky: 0x1a2432, fog: [0x1a2432, 120, 500], ambient: 0.9, sun: 1.2,
    start: [0, 24, 61.2, 0],
    // The assault element: four CT operators in black who cross the plaza on foot and cut the
    // hostages loose at the far buildings. They are the mission. Everything the player does is
    // in service of getting them there, and a .50 round through one of them ends the op.
    ctTeam: {
      // 380, not 200: with no covering fire the element loses the 4-v-8 attrition fight in
      // about a minute, and the player needs a window long enough to actually work the
      // targets through a 7-degree scope. This is the dial that decides whether the mission
      // is tense or merely unfair.
      count: 4, health: 380, at: [0, 0, -6],
      // The last leg walks the element INTO the hostage cluster rather than stopping short
      // of it: a rescue team that halts three metres away and stares never cuts anyone loose.
      route: [[0, -18], [-4, -32], [-8, -48], [-16, -62], [-26, -72], [-35, -77.5]],
    },
    geo: () => {
      const g = [];
      g.push(...GROUND(240, 300, C.street));
      // Your rooftop perch. This used to be one bare box and a 1m parapet, so with the scope
      // up there was no visual evidence you were on a roof at all — the mission read as a
      // floating scope. Everything below is non-solid dressing except the sandbag base.
      g.push([0, 12, 68, 20, 24, 16, C.building]);
      g.push(...wall(-10, 60, 10, 60, 1.0, C.concrete, [], 24));
      const PERCH = [0, 68];   // building centre, so facade() can orient its own normals
      g.push(...facade(-10, 60, -10, 76, 0, 24, 601, { out: 0.22, away: PERCH }));
      g.push(...facade(10, 60, 10, 76, 0, 24, 602, { out: 0.22, away: PERCH }));
      g.push(...facade(-10, 76, 10, 76, 0, 24, 603, { out: 0.22, away: PERCH }));
      // firing position: sandbag rest at the parapet, with the barrel gap left clear
      g.push(...lift(sandbags(-3.4, 61.0, 5, 3, false, 61), 24));
      g.push(...lift(sandbags(3.4, 61.0, 5, 3, false, 62), 24));
      g.push(...lift(sandbags(-6.2, 62.6, 3, 2, true, 63), 24));
      // roof furniture: the actual difference between a roof and the top of a cube
      g.push(...lift(waterTank(6.6, 0, 71.5), 24));
      g.push(...lift(acUnit(-6.5, 0, 69.5, 1.2), 24));
      g.push(...lift(acUnit(-4.0, 0, 72.4, 1.0), 24));
      g.push(...lift(ventStack(2.2, 0, 73.6), 24));
      g.push(...lift(roofHutch(-1.0, 0, 66.4, 's'), 24));
      g.push(...lift(lamp(8.4, 64.0, 3.2, 1.0, -1), 24));
      g.push([0, 24.3, 63.2, 5.0, 0.12, 1.6, C.metal, false]);          // duckboard by the rest
      // team cover: fountain
      g.push([0, 0.6, -10, 6, 1.2, 6, C.concrete]);
      g.push([0, 1.5, -10, 2, 3, 2, C.metal]);
      // plaza far buildings hostiles emerge from — windowed so they read as buildings at
      // 150m rather than as three pale slabs, which is what a sniper is staring at all level
      g.push([-40, 7, -90, 30, 14, 20, C.building]);
      g.push([40, 7, -90, 30, 14, 20, C.buildingB]);
      g.push([0, 7, -110, 40, 14, 20, C.building]);
      g.push(...facade(-55, -80, -25, -80, 0, 14, 611, { away: [-40, -90] }));
      g.push(...facade(25, -80, 55, -80, 0, 14, 612, { away: [40, -90] }));
      // The centre block is the sniper's, so it gets no warm panes at all: a lit window is
      // exactly the thing that makes a dark one legible, and a facade of dark holes with a
      // silhouette in one of them is the whole picture the mission is built on.
      g.push(...facade(-20, -100, 20, -100, 0, 14, 613, { away: [0, -110], lit: 0.06 }));
      for (const b of BAY_A) g.push(...windowBay(b[0], b[1], -80, 1));
      for (const b of BAY_B) g.push(...windowBay(b[0], b[1], -80, 1));
      // The sniper's rooms are the brightest interiors on the map, which sounds backwards
      // until you look through the glass: he is flat black and unlit, so the only thing that
      // can ever show him to you is what is BEHIND him. Eight faintly lit openings, and one
      // of them has a shape standing in it.
      for (const b of BAY_C) g.push(...windowBay(b[0], b[1], -100, 1, { frame: 0x5a6066, room: 0x606c7a }));
      g.push(...lift(acUnit(-34, 14, -92, 1.3), 0), ...lift(waterTank(44, 14, -93), 0));
      g.push(...lift(ventStack(-6, 14, -112), 0));
      // plaza furniture: scale cues so the distance to the fountain is legible through glass
      for (const [lx, lz] of [[-22, -18], [22, -18], [-22, -52], [22, -52], [-34, -34], [34, -34]]) {
        g.push(...lamp(lx, lz, 7.0, 1.7, lx < 0 ? 1 : -1));
      }
      g.push(...barrier(-14, -20), ...barrier(-11.5, -20), ...barrier(14, -20), ...barrier(11.5, -20));
      g.push(...bench(-26, -30, true), ...bench(-26, -38, true), ...bench(26, -30, true));
      g.push(...hydrant(-19, -12), ...hydrant(19, -46));
      g.push(...crosswalk(-16, -12, 12));
      // scattered cover on the plaza
      for (const [cx, cz] of [[-20, -40], [15, -50], [-8, -62], [25, -70], [-30, -65], [5, -35], [35, -45], [-15, -25]]) {
        g.push(...crate(cx, cz, 0, 1.4));
      }
      g.push(...car(-12, -55)); g.push(...car(20, -32, true)); g.push(...car(-28, -45));
      return g;
    },
    doors: [],
    enemies: [
      // spawns clear of the far buildings (their footprints start at z=-80/-100);
      // patrol points offset from every crate/car so nobody orbits cover with a bouncing hitbox
      { pos: [-36, 0, -76], patrol: [[-24, -37], [-8, -28]], aggro: true, range: 200 },
      { pos: [-30, 0, -77], patrol: [[-27, -60], [-18, -32]], aggro: true, range: 200 },
      { pos: [36, 0, -76], patrol: [[20, -42], [10, -28]], aggro: true, range: 200 },
      { pos: [30, 0, -77], patrol: [[30, -55], [12, -38]], aggro: true, range: 200 },
      { pos: [0, 0, -96], patrol: [[0, -55], [-4, -30]], aggro: true, range: 200 },
      { pos: [-10, 0, -96], patrol: [[-14, -50], [-3, -32]], aggro: true, range: 200 },
      { pos: [10, 0, -96], patrol: [[18, -60], [8, -30]], aggro: true, range: 200 },
      { pos: [22, 0, -93], patrol: [[28, -64], [20, -42]], aggro: true, range: 200 },
      // Riflemen holding the upper floors of the near pair. They work the windows over the
      // assault element's heads: up, a burst down into the plaza, gone. Two bays each so the
      // floor stays alive without them teleporting across the building.
      { pos: inBay(BAY_A[0], -80), range: 220, moveEvery: 5, teamOnly: true,
        perches: [inBay(BAY_A[0], -80), inBay(BAY_A[2], -80)], firstPeek: 5 },
      { pos: inBay(BAY_A[3], -80), range: 220, moveEvery: 5, teamOnly: true,
        perches: [inBay(BAY_A[3], -80), inBay(BAY_A[5], -80)], firstPeek: 9 },
      { pos: inBay(BAY_B[0], -80), range: 220, moveEvery: 5, teamOnly: true,
        perches: [inBay(BAY_B[0], -80), inBay(BAY_B[2], -80)], firstPeek: 7 },
      { pos: inBay(BAY_B[4], -80), range: 220, moveEvery: 5, teamOnly: true,
        perches: [inBay(BAY_B[4], -80), inBay(BAY_B[6], -80)], firstPeek: 12 },
      // The sniper. One man, in the centre block, in an unlit room: no colour, no shading, no
      // glint — a black shape and then the flash. Single aimed rounds at the PLAYER rather
      // than at the team, and he gives up the room after the second one, so the window that
      // just fired at you is the one window he is guaranteed not to be in next.
      { pos: inBay(BAY_C[0], -100), range: 300, dmgMul: 2.6, accMul: 2.2, firstPeek: 13,
        silhouette: true, targetPlayer: true, single: true, moveEvery: 2,
        perches: BAY_C.map(b => inBay(b, -100)) },
    ],
    civilians: [
      // Hostages the assault team is going in for. Prone the moment shooting starts.
      { pos: [-36, 0, -77], hostage: true }, { pos: [-33.5, 0, -77], hostage: true },
      { pos: [-34.8, 0, -78.5], hostage: true },
      // Fleeing civilians, and three who bolt straight up the plaza toward the perch. Through
      // a 7-degree scope a running silhouette at 60m is a shape and nothing more — that is the
      // whole test, and it is why the .50 has no business firing at movement alone.
      { pos: [-25, 0, -35], rush: true }, { pos: [18, 0, -58] }, { pos: [-5, 0, -48], rush: true },
      { pos: [30, 0, -62] }, { pos: [-20, 0, -70] }, { pos: [12, 0, -40], rush: true },
      { pos: [-30, 0, -55] }, { pos: [8, 0, -66] },
      // Residents at the windows of the two occupied buildings, sharing a facade with the
      // riflemen. Through the scope the first thing you get is a head in an opening, and the
      // only thing separating these from a target is what they are wearing.
      { pos: [0, 0, 0], window: inBay(BAY_A[1], -80) },
      { pos: [0, 0, 0], window: inBay(BAY_A[4], -80) },
      { pos: [0, 0, 0], window: inBay(BAY_A[6], -80) },
      { pos: [0, 0, 0], window: inBay(BAY_B[1], -80) },
      { pos: [0, 0, 0], window: inBay(BAY_B[3], -80) },
      { pos: [0, 0, 0], window: inBay(BAY_B[5], -80) },
    ],
    reinforce: { every: 32, first: 45, max: 5, group: 2, range: 220,
      at: [[-44, 0, -78], [44, 0, -78], [4, 0, -98]] },
    objectives: [
      { type: 'rescue', text: 'COVER THE ASSAULT TEAM — THEY ARE GOING IN FOR THE HOSTAGES' },
      { type: 'clear', zone: null, text: 'CLEAR THE WINDOWS — AND FIND THE SNIPER IN THE DARK BLOCK' },
    ],
  },

  // ---------------------------------------------------------------- 7
  {
    id: 7, name: 'OP BRAVO',
    brief: 'A rooftop insertion puts you above the tower selected for OP Bravo. Before the ground assault, use the post’s strike drone to break three 37th support assets forming north of the tower. Then fight down four occupied floors and clear the street access. The 37th knows the aircraft is coming, so flash every stairwell before committing.',
    weapons: ['pistol', 'm4'], grenades: 3, flashes: 3, squad: 2,
    sky: 0x1d2734, fog: [0x1d2734, 40, 160], ambient: 0.85, sun: 1.1,
    start: [3, 12.3, -2, 180],
    geo: () => {
      const g = [];
      g.push(...GROUND(70, 70, C.street));
      g.push(...tower(0, -4, 16, 14, 4, { door: true }));
      g.push(...car(12, 12)); g.push(...car(-14, 8, true));
      return g;
    },
    doors: [
      { pos: [2, 9, -4], rot: 90, w: 1.5 }, { pos: [2, 3, -4], rot: 90, w: 1.5 },
    ],
    extraGeo: () => {
      const g = [];
      for (const y of [3, 9]) {
        g.push(...wall(2, -11, 2, -4.75, 3, C.interiorWall, [], y));
        g.push(...wall(2, -3.25, 2, 3, 3, C.interiorWall, [], y));
      }
      return g;
    },
    enemies: [
      { pos: [-5, 9, -8], hold: true, yaw: 0 }, { pos: [5, 9, -6], hold: true, yaw: 90 },
      { pos: [4, 6, -7], patrol: [[4, -7], [-4, -7]] }, { pos: [-5.5, 6, -3], hold: true, yaw: 300 },
      { pos: [5, 3, -8], hold: true, yaw: 90 }, { pos: [-4, 3, -6], patrol: [[-4, -6], [4, -3]] },
      { pos: [0, 0, -6], hold: true, yaw: 0 }, { pos: [5, 0, -3], hold: true, yaw: 45 }, { pos: [-5, 0, -9], hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [6, 6, -9.5], hostage: true }, { pos: [-6, 0, -2], hostage: true },
    ],
    reinforce: { every: 26, first: 30, max: 5, group: 2, range: 50, at: [[0, 0, 6], [-6, 0, 8]] },
    objectives: [
      {
        type: 'drone',
        mode: 'strike',
        persistWrecks: true,
        label: 'OP BRAVO STRIKE',
        text: 'OP BRAVO STRIKE — DESTROY THE ASSAULT SUPPORT GROUP',
        launch: [3, 12.55, -2],
        yaw: Math.PI,
        targets: [
          { pos: [22, 0.1, 20], kind: 'armor', label: 'IFV NORTH', yaw: -0.35 },
          { pos: [-23, 0.1, 19], kind: 'artillery', label: 'FIRE SUPPORT', yaw: 0.25 },
          { pos: [0, 0.1, 25], kind: 'ew', label: 'EW RELAY', yaw: -0.08 },
        ],
      },
      { type: 'clear', zone: null, text: 'CLEAR THE TOWER TOP TO BOTTOM' },
      { type: 'reach', zone: [0, 14, 4], text: 'EXTRACT AT STREET LEVEL' },
    ],
  },

  // ---------------------------------------------------------------- 8
  {
    id: 8, name: 'ELECTRONIC ATTACK',
    brief: 'BASTION’s electronic-warfare team killed the district power and brought a mobile jammer into the records office. Use night vision, clear the floor, and reach the control room before they erase the captured spectrum data.',
    weapons: ['pistol', 'm4'], grenades: 2, flashes: 3, nvg: true, squad: 2,
    sky: 0x030a05, fog: [0x061510, 14, 60], ambient: 0.6, sun: 0.0,
    start: [0, 0, 24, 0],
    geo: () => {
      const g = [];
      g.push(...GROUND(70, 70, C.interiorFloor));
      // office maze 30x40
      const x1 = -15, x2 = 15, z1 = -20, z2 = 20;
      g.push(...wall(x1, z2, x2, z2, 3, C.interiorWall, [{ off: 13.5, w: 3, h: 2.6 }]));
      g.push(...wall(x1, z1, x2, z1, 3, C.interiorWall));
      g.push(...wall(x1, z1, x1, z2, 3, C.interiorWall));
      g.push(...wall(x2, z1, x2, z2, 3, C.interiorWall));
      g.push(...floorSlab(0, 0, 32, 42, 3.1, 0.3, C.roof));
      // interior partitions
      g.push(...wall(-15, 10, 2, 10, 3, C.glassWall, [{ off: 12, w: 2, h: 2.5 }]));
      g.push(...wall(6, 10, 15, 10, 3, C.glassWall));
      g.push(...wall(-6, 10, -6, -2, 3, C.glassWall, [{ off: 6, w: 2, h: 2.5 }]));
      g.push(...wall(6, 10, 6, -6, 3, C.glassWall));
      g.push(...wall(-15, -2, -10, -2, 3, C.glassWall));
      g.push(...wall(-6, -2, 10, -2, 3, C.glassWall, [{ off: 8, w: 2, h: 2.5 }]));
      g.push(...wall(-2, -2, -2, -14, 3, C.glassWall));
      g.push(...wall(6, -6, 15, -6, 3, C.glassWall, [{ off: 3, w: 2, h: 2.5 }]));
      g.push(...wall(-15, -14, -2, -14, 3, C.glassWall, [{ off: 4, w: 2, h: 2.5 }]));
      g.push(...wall(4, -14, 15, -14, 3, C.glassWall, [{ off: 5, w: 2, h: 2.5 }]));
      // desks
      for (const [dx, dz] of [[-10, 5], [0, 6], [10, 4], [-10, -8], [10, -10], [2, -10], [-8, -17], [8, -17]]) {
        g.push([dx, 0.45, dz, 2.2, 0.9, 1.1, C.metal]);
      }
      // Records office: boards, floor plans and departmental notices. Under NVGs these are the
      // only things telling you which cubicle you have already cleared.
      g.push(...whiteboard(-8, 9.7, false, 1.65, 2.0, 1.2, -1));
      g.push(...whiteboard(8, -5.7, false, 1.65, 1.8, 1.1));
      g.push(...noticeBoard(4, 9.7, false, 1.6, 1.6, 1.1, 1200, -1));
      g.push(...noticeBoard(-12, -13.7, false, 1.6, 1.4, 1.0, 1201));
      g.push(...posterWall(-14.8, 16, -14.8, 4, true, 1210, 4, 1.7));
      g.push(...posterWall(14.8, 6, 14.8, -4, true, 1211, 4, 1.7, -1));
      g.push(...posterWall(-14.8, -6, -14.8, -18, true, 1212, 4, 1.7));
      g.push(...wallClock(-14.75, 18, true, 2.4));
      g.push(...wallClock(14.75, -18, true, 2.4, 0.15, -1));
      for (const [px, pz] of [[-6, 19.7], [6, 19.7], [-2, -19.7], [11, -19.7]]) {
        g.push(...poster(px, pz, false, 1.75, null, 1220 + px, pz > 0 ? -1 : 1));
      }
      return g;
    },
    doors: [{ pos: [1, 0, -14], rot: 0, w: 2 }],
    enemies: [
      { pos: [-10, 0, 6], patrol: [[-10, 6], [-2, 6]] },
      { pos: [10, 0, 6], hold: true, yaw: 180 },
      { pos: [-10, 0, -6], patrol: [[-10, -6], [-10, -12]], aggro: true },
      { pos: [10, 0, -10], hold: true, yaw: 300 },
      { pos: [2, 0, -8], patrol: [[2, -8], [-4, -4]], aggro: true },
      { pos: [-8, 0, -17], hold: true, yaw: 0 }, { pos: [8, 0, -17], hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [-12, 0, 2], hostage: true }, { pos: [12, 0, -16], hostage: true },
    ],
    reinforce: { every: 28, first: 32, max: 5, group: 2, range: 40, at: [[0, 0, 18], [-13, 0, 17]] },
    objectives: [
      { type: 'clear', zone: null, text: 'NVGs ON — CLEAR THE DARK FLOOR' },
      { type: 'reach', zone: [0, -18, 2.5], text: 'SECURE THE SERVER ROOM' },
    ],
  },

  // ---------------------------------------------------------------- 9
  {
    id: 9, name: 'REAR INFILTRATION',
    brief: 'A 37th detachment is using the metro and utility tunnels to pass behind the observation posts with detained engineers and drone components. Clear the platform and tunnels. Frags travel far underground; recover every hostage taped to a column.',
    weapons: ['pistol', 'm4'], grenades: 4, flashes: 2, squad: 2,
    sky: 0x0d1116, fog: [0x0d1116, 22, 90], ambient: 0.55, sun: 0.25,
    start: [0, 6, 40, 0],
    geo: () => {
      const g = [];
      // street stub + stairs down into station (top step meets the stub edge at z=36)
      // 6.02, not 6: the top stair tread also tops out at exactly 6 and the stub overlaps it
      // by the tread depth, so the head of the stairs strobed. 2cm lip onto the street.
      g.push(...floorSlab(0, 44, 20, 16, 6.02, 0.5, C.sidewalk));
      g.push(...stairs(0, 28.2, 's', 8, 6, 4, C.concrete, 0));
      // mezzanine/platform hall
      g.push(...floorSlab(0, 0, 44, 60, 0, 1, C.platform));
      g.push(...wall(-22, 28, 22, 28, 5, C.tunnel, [{ off: 18, w: 8, h: 5 }]));
      g.push(...wall(-22, 28, -22, -30, 5, C.tunnel));
      g.push(...wall(22, 28, 22, -30, 5, C.tunnel));
      // Stop the station ceiling at the entrance wall (z=28). The former 62m slab extended
      // three metres under the exterior stairwell, so the spawn camera looked across the top
      // of the roof as if it had reached the edge of the map.
      g.push(...floorSlab(0, -1, 46, 58, 5.1, 0.5, C.tunnel));
      // columns
      for (const cz of [18, 8, -2, -12, -22]) { g.push([-8, 2.5, cz, 1, 5, 1, C.concrete]); g.push([8, 2.5, cz, 1, 5, 1, C.concrete]); }
      // track trench along west side
      g.push(...floorSlab(-17, 0, 8, 60, -1.2, 0.3, C.tunnel));
      // yBase -1.22, not -1.2: at -1.2 this 58m rail caps out at exactly y=0, coplanar with
      // the platform slab it runs alongside, which strobes as a line down the whole platform.
      g.push(...wall(-13, 28, -13, -30, 1.2, C.metal, [], -1.22, 0.2));
      // tunnel south continues
      g.push(...wall(-22, -30, 22, -30, 5, C.tunnel, [{ off: 16, w: 6, h: 4 }]));
      g.push(...floorSlab(0, -45, 14, 30, 0, 1, C.tunnel));
      g.push(...wall(-7, -30, -7, -60, 4.5, C.tunnel));
      g.push(...wall(7, -30, 7, -60, 4.5, C.tunnel));
      g.push(...floorSlab(0, -45, 16, 32, 4.6, 0.5, C.tunnel));
      g.push(...wall(-7, -60, 7, -60, 4.5, C.tunnel));
      // clutter
      // Metro walls: tags and layered fly-posting, plus advertising boards on the platform.
      // A tunnel with bare walls is the most obviously wrong surface in the whole game.
      for (const gz of [24, 14, 2, -10, -20]) {
        g.push(...graffiti(-21.7, gz, true, 900 + gz, 1.5));
        g.push(...graffiti(21.7, gz - 5, true, 940 + gz, 1.5, -1));
      }
      for (const gz of [-34, -44, -54]) {
        g.push(...graffiti(-6.7, gz, true, 970 + gz, 1.3));
        g.push(...graffiti(6.7, gz + 5, true, 990 + gz, 1.3, -1));
      }
      g.push(...posterWall(-21.68, 20, -21.68, 6, true, 910, 5, 1.8));
      g.push(...posterWall(-21.68, -6, -21.68, -22, true, 911, 5, 1.8));
      g.push(...posterWall(21.68, 16, 21.68, 0, true, 912, 5, 1.8, -1));
      g.push(...noticeBoard(-21.6, 26, true, 1.7, 2.0, 1.3, 913));
      g.push(...noticeBoard(21.6, -26, true, 1.7, 2.0, 1.3, 914, -1));
      g.push(...crate(4, 14), ...crate(-4, 4), ...crate(2, -16, 0, 1.3), ...crate(0, -40), ...crate(2, -50));
      return g;
    },
    doors: [],
    enemies: [
      { pos: [0, 0, 20], patrol: [[-6, 20], [6, 20]] },
      { pos: [-10, 0, 10], hold: true, yaw: 0 },
      { pos: [10, 0, 4], patrol: [[10, 4], [10, -10]], aggro: true },
      { pos: [-4, 0, -8], hold: true, yaw: 20 },
      { pos: [6, 0, -18], patrol: [[6, -18], [-6, -24]], aggro: true },
      { pos: [0, 0, -26], hold: true, yaw: 0 },
      { pos: [-2, 0, -38], hold: true, yaw: 0 },
      { pos: [3, 0, -52], hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [-7.2, 0, 8], hostage: true }, { pos: [8.2, 0, -12], hostage: true },
      { pos: [-7.2, 0, -22], hostage: true }, { pos: [0, 0, -56], hostage: true },
    ],
    reinforce: { every: 26, first: 30, max: 6, group: 2, range: 55, at: [[0, 0, 24], [0, 0, -28]] },
    objectives: [
      { type: 'clear', zone: [0, 0, 40], text: 'CLEAR THE PLATFORM — HOSTAGES ON THE COLUMNS' },
      { type: 'clear', zone: null, text: 'PUSH THE SOUTH TUNNEL' },
      { type: 'rescue', text: 'CUT EVERY HOSTAGE LOOSE' },
    ],
  },

  // ---------------------------------------------------------------- 10
  {
    id: 10, name: 'HOLD DISTRICT',
    brief: 'The main assault has begun. Breach the forward compound, take the fire-control tower, and clear the bunker coordinating repeated waves into the launch district. BASTION is using detained civilians as a last screen. Hold the corridor and isolate his command.',
    weapons: ['pistol', 'm4'], grenades: 4, flashes: 4, squad: 3,
    sky: 0x1e2835, fog: [0x1e2835, 40, 170], ambient: 0.85, sun: 1.15,
    start: [0, 0, 42, 0],
    geo: () => {
      const g = [];
      // ground slabs composed around a hole (x 14..30, z -44..-16) for the bunker + stair trench
      g.push(...floorSlab(-18, 0, 64, 120, 0, 1, C.street));    // west of hole
      g.push(...floorSlab(40, 0, 20, 120, 0, 1, C.street));     // east of hole
      g.push(...floorSlab(22, -52, 16, 16, 0, 1, C.street));    // north strip
      g.push(...floorSlab(22, 22, 16, 76, 0, 1, C.street));     // south strip
      // cover the hole flanks either side of the stair trench (x 14..20 and 24..30, z -24..-16)
      g.push(...floorSlab(17, -20, 6, 8, 0, 1, C.street));
      g.push(...floorSlab(27, -20, 6, 8, 0, 1, C.street));
      // compound wall with gate
      g.push(...wall(-30, 30, 30, 30, 4, C.concrete, [{ off: 27, w: 6, h: 3.2 }]));
      g.push(...wall(-30, 30, -30, -40, 4, C.concrete));
      g.push(...wall(30, 30, 30, -40, 4, C.concrete));
      g.push(...wall(-30, -40, 30, -40, 4, C.concrete));
      // courtyard cover
      g.push(...car(-8, 20)); g.push(...car(10, 16, true)); g.push(...crate(0, 10), ...crate(-14, 6), ...crate(14, 2));
      // the tower (2 floors + roof) at courtyard north
      g.push(...tower(0, -10, 16, 14, 2));
      // stair trench down: from courtyard level at z=-16 descending south to bunker door at z=-24
      g.push(...stairs(22, -24, 's', 8, 5, 4, C.concrete, -5));
      // Height 4.98, not 5: a 5m wall on a -5 base caps out at exactly y=0, which is the
      // street slab's top face, and they overlap by half the wall thickness. Coplanar strobe
      // along every rim of the trench and bunker. 2cm shy tucks the caps under the street.
      g.push(...wall(20, -24, 20, -16, 4.98, C.concrete, [], -5));   // trench west side
      g.push(...wall(24, -24, 24, -16, 4.98, C.concrete, [], -5));   // trench east side
      // bunker room (x 14..30, z -44..-24), floor -5, ceiling at courtyard level
      g.push(...floorSlab(22, -34, 16, 20, -5, 1, C.tunnel));
      g.push(...wall(14, -24, 14, -44, 4.98, C.tunnel, [], -5));
      g.push(...wall(30, -24, 30, -44, 4.98, C.tunnel, [], -5));
      g.push(...wall(14, -44, 30, -44, 4.98, C.tunnel, [], -5));
      g.push(...wall(14, -24, 30, -24, 4.98, C.tunnel, [{ off: 7, w: 2.4, h: 2.6 }], -5));
      g.push(...floorSlab(22, -34, 16, 20, 0.2, 0.4, C.concrete)); // bunker ceiling / courtyard surface
      // Compound wall tags and bunker-interior boards: the bunker is the climax room and it
      // was four flat panels of tunnel grey.
      for (const gz of [22, 8, -8, -24]) g.push(...graffiti(-29.7, gz, true, 1100 + gz, 1.5));
      for (const gz of [16, 0, -16, -32]) g.push(...graffiti(29.7, gz, true, 1140 + gz, 1.5, -1));
      g.push(...posterWall(-29.68, 18, -29.68, 2, true, 1110, 4, 1.8));
      g.push(...graffiti(14.3, -30, true, 1150, 1.2), ...graffiti(14.3, -38, true, 1151, 1.2));
      g.push(...graffiti(29.7, -34, true, 1152, 1.2, -1));
      g.push(...whiteboard(22, -43.7, false, 1.6, 2.0, 1.2));
      g.push(...noticeBoard(18, -43.7, false, 1.55, 1.4, 1.0, 1160));
      g.push(...posterWall(29.68, -28, 29.68, -40, true, 1170, 3, 1.7, -1));
      g.push(...crate(20, -30, -5), ...crate(26, -36, -5));
      return g;
    },
    doors: [
      { pos: [0, 0, -3.9], rot: 0, w: 1.6 },        // tower entry
      { pos: [22.2, -5, -24], rot: 0, w: 2.4 },      // bunker door at the foot of the trench
    ],
    enemies: [
      // courtyard
      { pos: [-6, 0, 18], patrol: [[-6, 18], [6, 18]] }, { pos: [12, 0, 8], hold: true, yaw: 180 },
      { pos: [-12, 0, 4], hold: true, yaw: 160 }, { pos: [6, 0, 24], patrol: [[6, 24], [-10, 24]], aggro: true },
      // tower floors
      { pos: [4, 0, -12], hold: true, yaw: 90 }, { pos: [-4, 0, -14], hold: true, yaw: 0 },
      { pos: [4, 3, -13], hold: true, yaw: 90 }, { pos: [-5, 3, -8], patrol: [[-5, -8], [5, -8]] },
      // roof
      { pos: [4, 6, -12], hold: true, yaw: 120 },
      // bunker
      { pos: [22, -5, -30], hold: true, yaw: 0 }, { pos: [18, -5, -38], hold: true, yaw: 0 }, { pos: [27, -5, -36], hold: true, yaw: 30 },
      // BASTION, cornered: his command radio and tabs identify him without a floating marker.
      { pos: [24, -5, -41], flee: true, hvt: true, bastion: true,
        patrol: [[17, -41], [28, -41], [28, -28], [17, -30], [17, -41]] },
    ],
    civilians: [
      { pos: [-16, 0, 14], rush: true },
      { pos: [5.5, 3, -9], hostage: true },
      { pos: [20, -5, -39], hostage: true }, { pos: [24, -5, -39.2], hostage: true },
    ],
    // Endgame: the compound keeps feeding men through the gate until you take the tower.
    reinforce: { every: 22, first: 26, max: 9, group: 3, range: 70,
      at: [[0, 0, 27], [-24, 0, 24], [24, 0, 24]] },
    objectives: [
      { type: 'clear', zone: [0, 10, 34], text: 'TAKE THE COURTYARD' },
      { type: 'clear', zone: [0, -10, 14, 8], text: 'CLEAR THE TOWER' },
      { type: 'clear', zone: null, text: 'THE BUNKER — HUMAN SHIELDS. SURGICAL.' },
      { type: 'target', text: 'BASTION — END HIS COMMAND' },
      { type: 'rescue', zone: [22, -34, 16, -5], text: 'CUT THE SHIELDS LOOSE AND GET THEM OUT' },
    ],
  },
];
