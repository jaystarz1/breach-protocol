import {
  C, floorSlab, wall, stairs, crate, car, militaryTruck, policeCar, marketStall,
} from '../levelgen.js';
import { quality } from '../quality.js';
import { streetShopLayout } from '../mission-variants.js';
import { terrainSampler } from '../terrain.js';
import { DEEP_FENCE_TERRAIN } from './terrain-deep-fence.js';
import {
  facade, lift, rng, sandbags, waterTank, acUnit, ventStack, roofHutch,
  lamp, trafficLight, dumpster, hydrant, bench, barrier, roadLine, crosswalk, awning, shopSign,
  ceilingLight, hangingBulb, exitSign, baseboard, wainscot, doorFrame, desk, chair, table,
  shelf, cabinet, mattress, rug, radiator, pipes, poster, debris, poleWire,
  posterWall, noticeBoard, whiteboard, wallClock, graffiti, picture, windowBay,
  lightCursor, mirrorLightsXSince,
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

// Three authored top-level mission phases. Each phase may contain physical, testable steps;
// the runtime presents the phase as the campaign beat and advances through its steps in order.
const phase = (id, text, steps) => ({ id, text, steps });

// A multi-storey tower with a west-side stairwell. Flights alternate corners per floor
// (even floors: NW flight ascending north; odd floors: SW flight ascending south) so no
// flight ever stacks over another — every floor is walkable UP and DOWN. Each flight
// tops out on a 1.1m landing connected to the main slab.
function tower(x, z, w, d, floors, opts = {}) {
  const geo = [];
  const visualStart = window.__bpVisualProps?.length ?? 0;
  const lightsStart = lightCursor();
  const fh = 3;
  const x1 = x - w / 2, x2 = x + w / 2, z1 = z - d / 2, z2 = z + d / 2;
  // The default lane is deliberately tight against the west wall. OP Bravo uses a slightly
  // wider, inset well so the roof parapet and each landing read as an opening from the player
  // camera instead of a concrete cap over the first tread.
  const stairwellExtra = Math.max(0, opts.stairwellClearance ?? 0);
  const stairOpeningWidth = 2.2 + stairwellExtra;
  const sx = x1 + stairOpeningWidth / 2; // stair lane center
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
    const eastStart = x1 + stairOpeningWidth;
    const eastWidth = Math.max(0.1, x2 - eastStart);
    geo.push(...floorSlab(eastStart + eastWidth / 2, z, eastWidth, d, sy, 0.3, color));
    const extraRun = stairwellExtra > 0 ? 0.65 : 0;
    if (parityBelow === 0) {
      // NW flight below: leave a little daylight around z1+1.1..z1+4.5 so the landing and
      // first tread cannot disappear behind the edge of a full-depth concrete slab.
      const holeLow = z1 + 1.1 - extraRun;
      const holeHigh = z1 + 4.5 + extraRun;
      if (holeLow > z1) geo.push(...floorSlab(sx, z1 + (holeLow - z1) / 2, stairOpeningWidth, holeLow - z1, sy, 0.3, color));
      if (holeHigh < z2) geo.push(...floorSlab(sx, holeHigh + (z2 - holeHigh) / 2, stairOpeningWidth, z2 - holeHigh, sy, 0.3, color));
    } else {
      // SW flight below: same clearance at the opposite end of the alternating run.
      const holeLow = z2 - 4.5 - extraRun;
      const holeHigh = z2 - 1.1 + extraRun;
      if (holeLow > z1) geo.push(...floorSlab(sx, z1 + (holeLow - z1) / 2, stairOpeningWidth, holeLow - z1, sy, 0.3, color));
      if (holeHigh < z2) geo.push(...floorSlab(sx, holeHigh + (z2 - holeHigh) / 2, stairOpeningWidth, z2 - holeHigh, sy, 0.3, color));
    }
  };

  for (let f = 0; f < floors; f++) {
    const y = f * fh;
    // wall() measures `off` to the opening's leading edge. Subtract half the door width so
    // the masonry opening, exterior portal and authored DoorSystem leaf all centre on x.
    const doorGap = (f === 0 && opts.door !== false)
      ? [{ off: w / 2 - 0.8, w: 1.6, h: 2.4 }] : [];
    geo.push(...wall(x1, z2, x2, z2, fh, C.building, doorGap, y)); // south (entry)
    geo.push(...wall(x1, z1, x2, z1, fh, C.building, [], y));
    if (!opts.openEast) geo.push(...wall(x2, z1, x2, z2, fh, C.building, [], y));
    if (!opts.openWest) geo.push(...wall(x1, z1, x1, z2, fh, C.building, [], y));
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
      geo.push(...doorFrame(x, z2, false, 1.6, 2.4));
      // The tower shell is reused in three missions. A thin frame and a grey steel leaf
      // disappeared into its battered facade—especially with a crate in the approach—so the
      // breach existed logically but read as a solid wall. This deep exterior portal remains
      // unmistakable from the courtyard without changing collision or the breach socket.
      const portalZ = z2 + 0.27;
      geo.push(
        [x - 0.98, 1.28, portalZ, 0.22, 2.56, 0.48, C.metal, false],
        [x + 0.98, 1.28, portalZ, 0.22, 2.56, 0.48, C.metal, false],
        [x, 2.52, portalZ, 2.18, 0.22, 0.48, C.metal, false],
        [x, 0.055, z2 + 0.48, 1.92, 0.11, 0.72, C.concrete, false],
        [x, 2.78, z2 + 0.7, 2.7, 0.16, 1.2, C.metal, false],
        [x, 2.69, z2 + 0.93, 0.78, 0.055, 0.2, 0xffd39a, false, true],
      );
    }
    geo.push(...exitSign(sx + 1.2, y + 2.4, f % 2 === 0 ? z1 + 1.0 : z2 - 1.0, false));
  }
  if (opts.roof !== false) {
    const ry = floors * fh;
    slabWithWindow(ry, C.roof, (floors - 1) % 2);
    geo.push(...wall(x1, z1, x2, z1, 0.9, C.concrete, [], ry));
    geo.push(...wall(x1, z2, x2, z2, 0.9, C.concrete, [], ry));
    if (!opts.openEast) geo.push(...wall(x2, z1, x2, z2, 0.9, C.concrete, [], ry));
    if (!opts.openWest) geo.push(...wall(x1, z1, x1, z2, 0.9, C.concrete, [], ry));
  }
  // The tower is a real traversable shell, but from the street its four uninterrupted wall
  // runs still read as one giant brick cuboid. Reuse the desktop facade system outside the
  // collision envelope: dark room recesses, damaged glazing, sills, utilities and cornices
  // give every floor scale without changing navigation or allowing fake window shots.
  if (opts.facades !== false) {
    const facadeOpts = {
      away: [x, z],
      step: opts.windowStep ?? 3.2,
      floorH: fh,
      lit: opts.windowLit ?? 0.16,
      damage: opts.facadeDamage ?? 0.5,
      balconies: opts.balconies,
      roofCaps: opts.roofCaps,
    };
    const facadeSeed = opts.seedOffset ?? 0;
    geo.push(...facade(x1, z2, x2, z2, 0, floors * fh, 30101 + floors * 17 + facadeSeed, {
      ...facadeOpts,
      skip: opts.door === false ? [] : [{ from: w / 2 - 1.1, to: w / 2 + 1.1 }],
    }));
    geo.push(...facade(x2, z1, x1, z1, 0, floors * fh, 30103 + floors * 19 + facadeSeed, facadeOpts));
    if (!opts.openEast) {
      geo.push(...facade(x2, z2, x2, z1, 0, floors * fh, 30107 + floors * 23 + facadeSeed, facadeOpts));
    }
    if (!opts.openWest) {
      geo.push(...facade(x1, z1, x1, z2, 0, floors * fh, 30109 + floors * 29 + facadeSeed, facadeOpts));
    }
  }
  if (opts.mirror) {
    // Reflect the complete authored module around its centre. Geometry, collision, facade
    // definitions and wall dressing all move together, so this creates different circulation
    // rather than a cosmetic "same building, different paint" repeat.
    for (const part of geo) part[0] = 2 * x - part[0];
    const newProps = window.__bpVisualProps?.slice(visualStart) ?? [];
    for (const prop of newProps) {
      if (Number.isFinite(prop.x)) prop.x = 2 * x - prop.x;
      if (Number.isFinite(prop.x1)) prop.x1 = 2 * x - prop.x1;
      if (Number.isFinite(prop.x2)) prop.x2 = 2 * x - prop.x2;
      if (prop.away) prop.away[0] = 2 * x - prop.away[0];
      if (prop.kind === 'wall-decal' && prop.rot) prop.dir = -(prop.dir ?? 1);
    }
    mirrorLightsXSince(lightsStart, x);
  }
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
      { pos: [8, 0, 11], positions: [[8, 0, 11], [6.2, 0, 9.4], [9.1, 0, 12.4]],
        hold: true, yaw: 270 },
      // room two. Putting these men down cuts the power — see blackoutOn below.
      { pos: [9, 0, -1], positions: [[9, 0, -1], [7.3, 0, 0.2], [9.5, 0, -2.3]],
        hold: true, yaw: 270, tag: 'r2' },
      { pos: [6, 0, -3], positions: [[6, 0, -3], [9.2, 0, -3.1], [6.2, 0, -0.7]],
        hold: true, yaw: 270, tag: 'r2' },
      { pos: [8, 0, -13], positions: [[8, 0, -13], [6.2, 0, -14.5], [9.1, 0, -12.2]],
        hold: true, yaw: 270 },
      { pos: [9.4, 0, -15], positions: [[9.4, 0, -15], [8.7, 0, -11.7], [6.1, 0, -15.3]],
        hold: true, yaw: 270 },
    ],
    civilians: [
      { pos: [6, 0, 13], positions: [[6, 0, 13], [8.8, 0, 12.5], [6.5, 0, 9.2]],
        hostage: true },
      { pos: [9.6, 0, -0.5], positions: [[9.6, 0, -0.5], [6.2, 0, 2.0], [8.7, 0, -2.7]],
        hostage: true },
      { pos: [6.2, 0, -15.4], positions: [[6.2, 0, -15.4], [9.4, 0, -14.6], [6.4, 0, -12.3]],
        hostage: true },
    ],
    objectives: [
      phase('annex-clear', 'CLEAR AND SECURE THE ANNEX', [
        { type: 'clear', zone: null, text: 'CLEAR ALL THREE ROOMS — HOSTILES ONLY' },
      ]),
      phase('backup-map', 'RESTORE THE BACKUP CIRCUIT', [
        { type: 'interact', device: 'l1-breaker', text: 'RESET THE BACKUP BREAKER — RECOVER THE LAUNCH-CORRIDOR MAP' },
      ]),
      phase('annex-evac', 'EVACUATE THE KILL-HOUSE', [
        { type: 'reach', zone: [0, -19, 3.5], text: 'EXIT THE KILL-HOUSE' },
      ]),
    ],
    objectiveDevices: [
      { id: 'l1-breaker', kind: 'breaker', label: 'BACKUP BREAKER', actionLabel: 'RESET', pos: [9.9, 0, 1.8] },
    ],
  },

  // ---------------------------------------------------------------- 2
  {
    id: 2, name: 'STREET SWEEP',
    brief: 'A shell-damaged main street is the battery and warhead corridor for Observation Post Alpha. Russian assault troops hold the storefronts, civilians remain trapped on the block, and a direction-finding team is listening for drone-control traffic. Clear the route, then reach the launch table at the southern barricade.',
    weapons: ['pistol', 'm4'], grenades: 0, squad: 2,
    sky: 0x1b2634, fog: [0x1b2634, 40, 160], ambient: 0.72, sun: 1.25,
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
      g.push(...facade(-16, -55, -16, 55, 0, 9, 201, {
        away: [-30, 0], step: 3.2, finish: 'brick',
      }));
      g.push(...facade(16, -55, 16, 55, 0, 9, 202, {
        away: [30, 0], step: 3.2, finish: 'plaster',
      }));
      // The street facade is now backed by real roof/depth mass. These sit just behind the
      // collision walls, closing the dollhouse view exposed by the elevated recon drone.
      for (const [x, z, d, h, color] of [
        [-23.2, 31, 46, 10.4, C.building], [-23.2, -29, 48, 9.6, C.buildingB],
        [23.2, 30, 48, 9.8, C.buildingB], [23.2, -30, 46, 10.8, C.building],
      ]) {
        g.push([x, h / 2, z, 14, h, d, color]);
      }
      // roofline clutter along both sides
      for (const [ax, az] of [[-18.5, 34], [-18.5, 6], [-18.5, -30], [18.5, 22], [18.5, -8], [18.5, -42]]) {
        g.push(...lift(acUnit(ax, 9, az, 1.1), 0));
      }
      g.push(...lift(waterTank(-19.5, 9, -12), 0), ...lift(waterTank(19.5, 9, 40), 0));
      // Three validated storefront modules rotate between authored sockets on each retry.
      // Collision, desktop interiors, enemy starts and the QA route all consume this same
      // layout table, so variation cannot leave art or actors behind in the old building.
      for (const shopDef of streetShopLayout(v)) {
        g.push(...shop(
          shopDef.x, shopDef.z, shopDef.w, shopDef.d, shopDef.face,
        ));
        const right = shopDef.face === 'w';
        const awningColor = shopDef.damage === 1 ? 0x3b4d6a
          : shopDef.damage === 2 ? 0x4a5a3b : 0x7a4a4a;
        g.push(...awning(
          right ? 6.2 : -6.2, shopDef.z, 0.9, 7, 3.1, awningColor,
        ));
        g.push(...shopSign(
          right ? 6.6 : -6.6, shopDef.z, 3.4, 3.6, true,
        ));
      }
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
      { pos: [11, 0, 20], hold: true, yaw: 180, variants: [
        { pos: [11, 0, 20], yaw: 180 },
        { pos: [-11, 0, 22], yaw: 0 },
        { pos: [11, 0, 28], yaw: 180 },
      ] },
      { pos: [-4, 0, 2], positions: [[-4, 0, 2], [4, 0, 8], [-7, 0, 7]], patrol: [[-8, 2], [4, 8]], concealed: true },
      { pos: [11, 0, -5], hold: true, yaw: 180, variants: [
        { pos: [11, 0, -5], yaw: 180 },
        { pos: [11, 0, 2], yaw: 180 },
        { pos: [-11, 0, 5], yaw: 0 },
      ] },
      { pos: [2, 0, -20], patrol: [[2, -20], [-5, -30]], aggro: true },
      { pos: [-7.2, 0, -25], hold: true, yaw: 0, variants: [
        { pos: [-7.2, 0, -25], yaw: 0 },
        { pos: [7.2, 0, -26], yaw: 180 },
        { pos: [-7.2, 0, -20], yaw: 0 },
      ] },
      { pos: [0, 0, -44], hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [-9, 0, 30], rush: true }, { pos: [8, 0, 10] }, { pos: [-8, 0, -12], rush: true },
      { pos: [9.5, 0, -3], hostage: true },
    ],
    crowdSpawns: [[-11, 0, 16], [11, 0, -16]],
    reinforce: [
      // Fed in from both ends of the street. Dawdle and the block refills behind you.
      { every: 24, first: 28, max: 6, group: 2, range: 70,
        at: [[0, 0, 50], [-8, 0, -46], [8, 0, -46]],
        atVariants: [
          [[0, 0, 50], [-8, 0, -46], [8, 0, -46]],
          [[0, 0, 50], [-12, 0, 34], [8, 0, -46]],
          [[0, 0, 50], [12, 0, 32], [-8, 0, -46]],
        ] },
      // The deep shell-damaged storefront is rigged: step inside and a close-quarters team
      // pours out of the street to shut the door behind you. Zones and staging sockets track
      // the storefront module through its three layout variants (mission-variants.js); the
      // hidden flag keeps the wave from materialising in the player's face, and converge
      // (reinforcements()) means they come hunting rather than posting up outside.
      { every: 4, first: 1.5, max: 4, group: 2, range: 55, minDistance: 8,
        scatter: 1.5, hidden: true,
        message: 'AMBUSH — THE STOREFRONT WAS RIGGED',
        triggerVariants: [
          { zone: [-15.5, -28.5, -6.5, -21.5] },
          { zone: [6.5, -29.5, 15.5, -22.5] },
          { zone: [-15.5, -23.5, -6.5, -16.5] },
        ],
        // Sockets hug the same building face as the rigged shop, one up-street and one
        // down-street of it: from inside the module its own side walls occlude both, so the
        // hidden staging holds while the player is in the kill zone — where it matters.
        at: [[-14, 0, -14], [-14, 0, -36]],
        atVariants: [
          [[-14, 0, -14], [-14, 0, -36]],
          [[14, 0, -15], [14, 0, -37]],
          [[-14, 0, -9], [-14, 0, -31]],
        ] },
    ],
    objectives: [
      phase('street-clear', 'CLEAR THE STREET', [
        { type: 'clear', zone: null, text: 'SWEEP THE BLOCK — ELIMINATE ALL HOSTILES' },
      ]),
      phase('alpha-sortie', 'ARM OP ALPHA AND BREAK THE REINFORCEMENTS', [
        { type: 'interact', device: 'l2-launch', text: 'ARM THE OP ALPHA LAUNCH TABLE' },
        {
        type: 'drone',
        mode: 'combat',
        label: 'OP ALPHA // ARMED UAS',
        text: 'LAUNCH ARMED DRONE — INTERDICT THE NORTH-END REINFORCEMENT WAVE',
        launch: [-11.2, 1.25, -41.6],
        yaw: Math.PI,
        keepStackVisible: true,
        rifleRounds: 100,
        grenades: 10,
        result: 'NORTH-END ASSAULT ELEMENT DESTROYED — STACK MOVING',
        combatWave: {
          label: 'NORTH-END REINFORCEMENTS',
          baseCount: 11,
          minCount: 10,
          maxCount: 12,
          vehicle: {
            kind: 'technical',
            health: 190,
            speed: 4.2,
            pos: [8, 0, 64],
            positions: [[8, 0, 64], [7.5, 0, 60], [8.5, 0, 62]],
            patrols: [
              [[8, 57], [8, 39], [7, 19]],
              [[7.5, 54], [7, 37], [7, 17]],
              [[8.5, 56], [8, 40], [7.5, 20]],
            ],
          },
          enemies: [
            { pos: [-6, 0, 52], positions: [[-6, 0, 52], [-5, 0, 48], [-7, 0, 50]],
              patrols: [[[-6, 46], [-5, 28], [-4, 8]], [[-5, 43], [-4, 25], [-3, 7]], [[-7, 45], [-6, 27], [-5, 9]]] },
            { pos: [-3.5, 0, 55], positions: [[-3.5, 0, 55], [-2.5, 0, 51], [-4, 0, 53]],
              patrols: [[[-3.5, 48], [-3, 30], [-2, 10]], [[-2.5, 46], [-2, 27], [-1, 8]], [[-4, 47], [-3, 29], [-2, 9]]] },
            { pos: [-1, 0, 50], positions: [[-1, 0, 50], [0, 0, 54], [-0.5, 0, 48]],
              patrols: [[[-1, 44], [-1, 26], [0, 7]], [[0, 47], [0, 29], [1, 9]], [[-0.5, 43], [0, 25], [0, 6]]] },
            { pos: [2, 0, 54], positions: [[2, 0, 54], [3, 0, 49], [1.5, 0, 51]],
              patrols: [[[2, 47], [2, 29], [1, 8]], [[3, 44], [3, 26], [2, 7]], [[1.5, 45], [2, 28], [1, 9]]] },
            { pos: [4.5, 0, 50], positions: [[4.5, 0, 50], [5.5, 0, 54], [4, 0, 48]],
              patrols: [[[4.5, 44], [4, 26], [3, 7]], [[5.5, 47], [5, 29], [4, 9]], [[4, 43], [4, 25], [3, 6]]] },
            { pos: [6.5, 0, 56], positions: [[6.5, 0, 56], [7, 0, 51], [6, 0, 53]],
              patrols: [[[6.5, 49], [6, 31], [5, 10]], [[7, 46], [6, 28], [5, 8]], [[6, 47], [5, 29], [4, 9]]] },
            { pos: [-8.5, 0, 58], positions: [[-8.5, 0, 58], [-8, 0, 53], [-9, 0, 55]],
              patrols: [[[-8, 50], [-7, 32], [-6, 12]], [[-8, 47], [-7, 30], [-6, 10]], [[-9, 49], [-8, 31], [-7, 11]]] },
            { pos: [-5, 0, 61], positions: [[-5, 0, 61], [-6, 0, 57], [-4.5, 0, 59]],
              patrols: [[[-5, 53], [-5, 35], [-4, 14]], [[-6, 50], [-5, 33], [-4, 12]], [[-4.5, 52], [-4, 34], [-3, 13]]] },
            { pos: [-2, 0, 59], positions: [[-2, 0, 59], [-1.5, 0, 63], [-2.5, 0, 56]],
              patrols: [[[-2, 51], [-2, 33], [-1, 12]], [[-1.5, 55], [-1, 36], [0, 14]], [[-2.5, 49], [-2, 31], [-1, 11]]] },
            { pos: [1, 0, 62], positions: [[1, 0, 62], [1.5, 0, 58], [0.5, 0, 60]],
              patrols: [[[1, 54], [1, 36], [1, 14]], [[1.5, 51], [2, 33], [2, 12]], [[0.5, 52], [1, 34], [1, 13]]] },
            { pos: [4, 0, 60], positions: [[4, 0, 60], [4.5, 0, 64], [3.5, 0, 57]],
              patrols: [[[4, 52], [4, 34], [3, 12]], [[4.5, 55], [4, 36], [3, 14]], [[3.5, 50], [3, 32], [2, 11]]] },
            { pos: [8, 0, 59], positions: [[8, 0, 59], [8.5, 0, 55], [7.5, 0, 62]],
              patrols: [[[8, 51], [7, 33], [6, 13]], [[8.5, 48], [8, 31], [7, 11]], [[7.5, 54], [7, 35], [6, 14]]] },
          ],
        },
        },
      ]),
      phase('corridor-open', 'REOPEN THE LAUNCH CORRIDOR', [
        { type: 'interact', device: 'l2-gate', text: 'OPEN THE SOUTHERN BARRICADE — MOVE THE STACK THROUGH' },
        { type: 'reach', zone: [0, -52, 3], text: 'REGROUP WITH THE STACK — PUSH THROUGH THE BARRICADE' },
      ]),
    ],
    objectiveDevices: [
      { id: 'l2-launch', kind: 'launch', label: 'OP ALPHA LAUNCH TABLE', actionLabel: 'ARM', pos: [-11.2, 0, -41.6] },
      { id: 'l2-gate', kind: 'gate', label: 'SOUTHERN BARRICADE', actionLabel: 'OPEN', pos: [0, 0, -48.4], width: 0.85 },
    ],
  },

  // ---------------------------------------------------------------- 3
  {
    id: 3, name: 'OP ALPHA',
    brief: 'The apartment block above OP Alpha is being cleared room by room by a 37th assault team. Recover the observers, hold all three floors, then arm the rooftop drone against a reinforcement wave trying to enter the building. Flash the rooms before entry and walk up to each bound observer to release them.',
    weapons: ['pistol', 'm4'], grenades: 0, flashes: 3, squad: 2,
    sky: 0x232e3a, fog: [0x232e3a, 35, 120], ambient: 0.9, sun: 1.15,
    start: [0, 0, 16, 0],
    geo: () => {
      const g = [];
      g.push(...GROUND(60, 60, C.concrete));
      // Two residential shells share one open party line. Their stairs remain on the outside
      // edges, so each floor is a wide, connected search space rather than two copies divided
      // by an invisible collision wall. The mirrored east wing also changes circulation.
      g.push(...tower(-7, -4, 14, 12, 3, {
        facadeDamage: 0.74,
        windowLit: 0.12,
        balconies: false,
        openEast: true,
        facades: false,
      }));
      g.push(...tower(7, -4, 14, 12, 3, {
        facadeDamage: 0.67,
        windowLit: 0.09,
        balconies: false,
        // Options describe the unreflected source shell. Its east wall becomes the shared
        // west wall after mirroring, so east is the side that must be omitted here.
        openEast: true,
        mirror: true,
        seedOffset: 733,
        facades: false,
      }));
      // Treat the joined pair as one facade asset: four continuous elevations, batched once,
      // with two real entrance gaps. Building each module's facade independently duplicated
      // the same material families and exceeded the desktop draw-call ceiling.
      const joinedFacade = {
        away: [0, -4], step: 3.2, floorH: 3,
        lit: 0.11, damage: 0.72, balconies: false,
      };
      g.push(...facade(-14, 2, 14, 2, 0, 9, 33201, {
        ...joinedFacade,
        skip: [{ from: 5.9, to: 8.1 }, { from: 19.9, to: 22.1 }],
      }));
      g.push(...facade(14, -10, -14, -10, 0, 9, 33203, joinedFacade));
      g.push(...facade(-14, -10, -14, 2, 0, 9, 33207, joinedFacade));
      g.push(...facade(14, 2, 14, -10, 0, 9, 33209, joinedFacade));
      // A residential block does not stand alone in a poured-concrete void. This abandoned
      // car is authoritative cover at the edge of the approach; the desktop renderer replaces
      // its inexpensive collision body with the authored damaged vehicle.
      g.push(...car(-15.5, 8.5, true, null, { variant: 0, damage: 0 }));
      return g;
    },
    doors: [
      { pos: [-7, 0, 2.1], rot: 0, w: 1.6 }, { pos: [7, 0, 2.1], rot: 0, w: 1.6 },
      { pos: [-7, 3, -4], rot: 0, w: 1.5 }, { pos: [7, 3, -4], rot: 0, w: 1.5 },
      { pos: [-7, 6, -4], rot: 0, w: 1.5 }, { pos: [7, 6, -4], rot: 0, w: 1.5 },
    ],
    // Each upper floor has two transverse room dividers, while the original party line at
    // x=0 remains completely open. Players can cross wings at either side of the dividers.
    extraGeo: () => {
      const g = [];
      for (const y of [3, 6]) {
        g.push(...wall(-14, -4, 0, -4, 3, C.interiorWall, [{ off: 6.25, w: 1.5, h: 2.4 }], y));
        g.push(...wall(0, -4, 14, -4, 3, C.interiorWall, [{ off: 6.25, w: 1.5, h: 2.4 }], y));
      }
      return g;
    },
    enemies: [
      { pos: [8, 0, -7], positions: [[8, 0, -7], [10, 0, -8.5], [5, 0, -3]],
        hold: true, yaw: 180 },
      { pos: [-8, 0, -7], positions: [[-8, 0, -7], [-10, 0, -8.5], [-5, 0, -3]],
        patrols: [[[-8, -7], [-3, -7]], [[-10, -8.5], [-4, -8.5]], [[-5, -3], [-11, -3]]] },
      // The whole second-floor team carries the blackout tag: the building generator lives
      // on their floor, and dropping the last of them kills the power for the rest of the
      // mission — floor three and the rooftop drone launch happen on goggles.
      { pos: [10, 3, -7], positions: [[10, 3, -7], [11, 3, -8.2], [7, 3, -8.8]],
        hold: true, yaw: 90, tag: 'floor2' },
      { pos: [-9, 3, -5], positions: [[-9, 3, -5], [-11, 3, -7.8], [-7, 3, -7.2]],
        hold: true, yaw: 270, tag: 'floor2' },
      { pos: [2, 3, -8], positions: [[2, 3, -8], [-2, 3, -7], [3, 3, -7.5]],
        patrols: [[[2, -8], [-9, -8], [9, -8]], [[-2, -7], [9, -7], [-9, -7]], [[3, -7.5], [-8, -7.5], [8, -7.5]]],
        tag: 'floor2' },
      { pos: [10, 6, -7], positions: [[10, 6, -7], [11, 6, -8], [7, 6, -8.7]],
        hold: true, yaw: 90 },
      { pos: [8, 6, -3], positions: [[8, 6, -3], [6, 6, -2.2], [11, 6, -1.4]],
        hold: true, yaw: 90 },
      { pos: [-10, 6, -8], positions: [[-10, 6, -8], [-11, 6, -8], [-7, 6, -6]],
        hold: true, yaw: 0 },
      { pos: [-8, 6, -3], positions: [[-8, 6, -3], [-6, 6, -2], [-11, 6, -1.5]],
        patrols: [[[-8, -3], [-3, -3]], [[-6, -2], [-11, -2]], [[-11, -1.5], [-5, -1.5]]] },
    ],
    civilians: [
      { pos: [10, 0, -8.5], positions: [[10, 0, -8.5], [6, 0, -6.2], [11, 0, -2.2]],
        hostage: true },
      { pos: [-10, 0, -5.5], positions: [[-10, 0, -5.5], [-6, 0, -8.5], [-11, 0, -2.2]],
        hostage: true },
      { pos: [10, 3, -8.5], positions: [[10, 3, -8.5], [7, 3, -8.4], [11, 3, -6.2]],
        hostage: true },
      { pos: [-9, 3, -2], positions: [[-9, 3, -2], [-11, 3, -2.4], [-6, 3, -2.4]],
        hostage: true },
      { pos: [10, 6, -8.8], positions: [[10, 6, -8.8], [7, 6, -5], [11, 6, -7.8]],
        hostage: true },
      { pos: [-9, 6, -2.4], positions: [[-9, 6, -2.4], [-11, 6, -2.8], [-6, 6, -2]],
        hostage: true },
    ],
    // Clearing the second floor drops the building power (see the tagged team above). It is
    // a dusk map, so the courtyard survives as silhouettes; inside, the goggles take over.
    blackoutOn: { tag: 'floor2' },
    reinforce: { every: 30, first: 35, max: 4, group: 2, range: 45,
      at: [[-7, 0, 6], [7, 0, 6]],
      atVariants: [
        [[-7, 0, 6], [7, 0, 6]],
        [[-11, 0, 8], [5, 0, 7]],
        [[11, 0, 8], [-5, 0, 7]],
      ] },
    objectives: [
      phase('alpha-clear', 'CLEAR THE APARTMENT BLOCK', [
        { type: 'clear', zone: null, text: 'CLEAR BOTH WINGS — ALL THREE FLOORS' },
      ]),
      phase('alpha-observers', 'RECOVER THE OBSERVERS', [
        { type: 'rescue', text: 'CUT THE HOSTAGES LOOSE — WALK UP TO EACH ONE' },
      ]),
      phase('alpha-drone', 'ARM THE ROOFTOP DRONE', [
        { type: 'reach', zone: [-2, -6, 3, 9], text: 'GET TO THE ROOF' },
        { type: 'interact', device: 'l3-drone', text: 'ARM OP ALPHA — CONNECT THE ROOFTOP CONTROL' },
        {
        type: 'drone',
        mode: 'combat',
        label: 'OP ALPHA',
        text: 'ARM OP ALPHA — BREAK THE REINFORCEMENTS BEFORE THEY ENTER THE BLOCK',
        launch: [-2, 9.45, -6],
        yaw: Math.PI,
        keepStackVisible: true,
        rifleRounds: 100,
        grenades: 8,
        result: 'OP ALPHA ASSAULT WAVE BROKEN — BUILDING APPROACH SECURE',
        combatWave: {
          label: 'OP ALPHA BUILDING REINFORCEMENTS',
          baseCount: 10,
          minCount: 10,
          maxCount: 10,
          // The wave arrives through the two real ground-floor doors, then keeps moving inside
          // the joined apartment block instead of stopping at the threshold.
          droneIngress: [
            [[-7, 5.6], [-7, 2.8], [-7, 0.4], [-10, -2.4], [-10, -7], [-5, -7]],
            [[7, 5.6], [7, 2.8], [7, 0.4], [10, -2.4], [10, -7], [5, -7]],
            [[-5, 5.6], [-7, 2.8], [-7, 0.4], [-4, -2.4], [-4, -7], [-10, -5]],
            [[5, 5.6], [7, 2.8], [7, 0.4], [4, -2.4], [4, -7], [10, -5]],
            [[-2, 5.6], [-7, 2.8], [-7, 0.4], [-2, -2.4], [-2, -7], [-8, -7]],
            [[2, 5.6], [7, 2.8], [7, 0.4], [2, -2.4], [2, -7], [8, -7]],
          ],
          enemies: [
            { pos: [-13, 0, 16], patrol: [[-13, 16], [-10, 10], [-7, 6]] },
            { pos: [13, 0, 16], patrol: [[13, 16], [10, 10], [7, 6]] },
            { pos: [-7, 0, 18], patrol: [[-7, 18], [-5, 11], [-7, 6]] },
            { pos: [7, 0, 18], patrol: [[7, 18], [5, 11], [7, 6]] },
            { pos: [-2, 0, 15], patrol: [[-2, 15], [-7, 9], [-7, 6]] },
            { pos: [2, 0, 15], patrol: [[2, 15], [7, 9], [7, 6]] },
            { pos: [-11, 0, 12], patrol: [[-11, 12], [-8, 8], [-7, 6]] },
            { pos: [11, 0, 12], patrol: [[11, 12], [8, 8], [7, 6]] },
            { pos: [-4, 0, 20], patrol: [[-4, 20], [-6, 12], [-7, 6]] },
            { pos: [4, 0, 20], patrol: [[4, 20], [6, 12], [7, 6]] },
          ],
        },
        },
      ]),
    ],
    objectiveDevices: [
      { id: 'l3-drone', kind: 'launch', label: 'OP ALPHA ROOFTOP CONTROL', actionLabel: 'ARM', pos: [-2, 9.45, -6] },
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
      { pos: [0, 0, 27], positions: [[0, 0, 27], [2.5, 0, 28.5], [-2.5, 0, 25.5]],
        flee: true, hvt: true, escapes: true, hold: false,
        patrol: [[0, 22], [13.5, 17.5], [21, 10], [21, -2], [10, -7.5], [-6, -9], [-6, -20], [-14, -30], [-6.5, -37], [-6.5, -44]] },
      { pos: [2, 0, 30], positions: [[2, 0, 30], [-2.5, 0, 32], [3.5, 0, 24]],
        hold: true, yaw: 180 },
      { pos: [21, 0, 15], positions: [[21, 0, 15], [21.5, 0, 8], [20, 0, 18]],
        patrols: [[[21, 15], [21, 2]], [[21.5, 8], [20, -1]], [[20, 18], [21, 5]]],
        aggro: true },
      { pos: [10, 0, -7.5], positions: [[10, 0, -7.5], [15, 0, -8], [5, 0, -8.2]],
        hold: true, yaw: 90 },
      { pos: [-6, 0, -18], positions: [[-6, 0, -18], [-13, 0, -22], [1, 0, -17]],
        patrols: [[[-6, -18], [-16, -28]], [[-13, -22], [-4, -31]], [[1, -17], [-12, -27]]],
        aggro: true },
      { pos: [4, 0, -28], positions: [[4, 0, -28], [10, 0, -31], [-1, 0, -23]],
        hold: true, yaw: 0 },
      { pos: [-14, 0, -34], positions: [[-14, 0, -34], [2, 0, -33], [-20, 0, -29]],
        patrols: [[[-14, -34], [0, -34]], [[2, -33], [-12, -31]], [[-20, -29], [-5, -35]]],
        aggro: true },
      { pos: [-4, 0, -37], positions: [[-4, 0, -37], [8, 0, -35], [-12, 0, -36]],
        hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [-2, 0, 35], rush: true }, { pos: [20, 0, 5] }, { pos: [-10, 0, -22], rush: true }, { pos: [6, 0, -33] },
    ],
    crowdSpawns: [[0, 0, 38], [0, 0, 22], [14, 0, 12]],
    // He is running and his men are buying time. The clock here is the entire mission.
    reinforce: { every: 20, first: 22, max: 8, group: 2, range: 60,
      at: [[0, 0, 46], [22, 0, 18], [-20, 0, -8], [-6, 0, -36]],
      atVariants: [
        [[0, 0, 46], [22, 0, 18], [-20, 0, -8], [-6, 0, -36]],
        [[-2, 0, 44], [20, 0, 8], [12, 0, -8], [-18, 0, -34]],
        [[2, 0, 42], [21, 0, 19], [-18, 0, -7], [8, 0, -35]],
      ] },
    objectives: [
      phase('finder-stop', 'STOP THE DIRECTION FINDER', [
        { type: 'target', text: 'RUN HIM DOWN — DO NOT LET HIM REACH THE GATE' },
      ]),
      phase('finder-log', 'CLEAR AND RECOVER THE GARAGE LOG', [
        { type: 'clear', zone: [-5, -25, 30], text: 'CLEAR THE GARAGE' },
        {
          type: 'interact', device: 'l4-log', autoUse: true, radius: 2.8,
          text: 'RECOVER THE DIRECTION-FINDING LOG',
        },
      ]),
      phase('finder-exfil', 'OPEN THE EXFIL GATE', [
        { type: 'reach', zone: [-6.5, -41, 3.5], text: 'EXFIL THROUGH THE GATE' },
      ]),
    ],
    objectiveDevices: [
      // The log is on the authored direction-finder table beside the escape gate, not in the
      // middle of the parking deck. Keeping the pickup socket on that paper makes the marker,
      // the physical prop and the interaction radius agree.
      { id: 'l4-log', kind: 'console', label: 'DIRECTION-FINDING LOG', actionLabel: 'RECOVER', pos: [-11.1, 0, -35.8] },
    ],
  },

  // ---------------------------------------------------------------- 5
  {
    id: 5, name: 'MARKET INFILTRATION',
    brief: 'Armed infiltrators are blending into the crowded aid market beside the launch route. They will draw and fire when the contact breaks, while the unarmed crowd bolts at the first shot. Make the shoot/no-shoot call from the weapon in their hands; on Veteran, one civilian casualty ends the mission.',
    weapons: ['pistol', 'm4'], grenades: 0, squad: 2,
    sky: 0x2a2230, fog: [0x2a2230, 40, 140], ambient: 0.9, sun: 1.1,
    start: [0, 0, 34, 0],
    geo: () => {
      const g = [];
      g.push(...GROUND(90, 90, C.sidewalk));
      // plaza perimeter walls
      g.push(...wall(-35, 38, 35, 38, 6, C.building, [{ off: 32, w: 6, h: 3 }]));
      // The south boundary is a vehicle compound, not a solid pedestrian wall. Leave a
      // twelve-metre-wide, 4.6m-high passage for the aid trucks and keep the opening aligned
      // with the authored exfil lane outside the market.
      g.push(...wall(-35, -38, 35, -38, 6, C.building, [{ off: 29, w: 12, h: 4.6 }]));
      g.push(...wall(-35, 38, -35, -38, 6, C.buildingB));
      g.push(...wall(35, 38, 35, -38, 6, C.buildingB));
      // Point these inward: this is a walled market courtyard, so its occupied faces belong
      // on the side the player can actually see.
      g.push(...facade(35, 38, -35, 38, 0, 6, 501, { step: 4.2 }));
      g.push(...facade(-35, -38, 35, -38, 0, 6, 502, {
        step: 4.2,
        // Do not place a window/sign panel over the vehicle passage. The wall shell owns the
        // lintel; the mission art adds the steel leaves and portal frame below.
        skip: [{ from: 27.5, to: 42.5 }],
      }));
      g.push(...facade(-35, 38, -35, -38, 0, 6, 503, { step: 4.2 }));
      g.push(...facade(35, -38, 35, 38, 0, 6, 504, { step: 4.2 }));
      // Market stalls: four rows, each with its own x offsets so the plaza reads as a bazaar
      // that grew stall by stall rather than a parade-ground 4x4 grid. The offsets are
      // constrained, not free: row 18 anchors the authored infiltrator holds and patrols,
      // and every other row was shifted only where no enemy/civilian position, difficulty
      // spawn socket, or crowd socket lands inside a 5x2 counter footprint.
      const stallRows = [
        [18, [-22, -8, 8, 22]],
        [6, [-18, -4, 12, 26]],
        [-6, [-16, -2, 14, 28]],
        [-18, [-27, -13, 3, 17]],
      ];
      const stallColors = [0x7a4a4a, 0x3e596d, 0x5d6b3f, 0x8a6a3a];
      for (const [sz, xs] of stallRows) {
        for (const sx of xs) {
          g.push(...marketStall(sx, sz, stallColors[Math.abs(sx * 7 + sz * 3) % stallColors.length]));
        }
      }
      // Plaza centre: the aid point the market exists around — a canopied distribution table
      // ringed with pallet crates and a low sandbag face, strung to the stall rows overhead.
      // Kept inside |x|<4, |z|<4 so the aisle spawn sockets and crowd lanes stay clear.
      g.push(...awning(0, 0, 4.6, 5.4, 3.3, 0x8a6a3a));
      // awning() is a wall-mount canopy with no legs of its own; a free-standing one needs
      // its corners held up. Non-solid so a 12cm post can never wedge a fleeing civilian.
      for (const [px, pz] of [[-2.1, -2.5], [2.1, -2.5], [-2.1, 2.5], [2.1, 2.5]]) {
        g.push([px, 1.65, pz, 0.12, 3.3, 0.12, 0x6b563d, false]);
      }
      g.push(...table(0, 1.1, 2.4, 1.0, 0x6b563d), ...table(-1.6, -1.2, 1.4, 0.9, 0x5d4a33));
      g.push(...crate(2.6, -1.8), ...crate(3.2, -0.6, 0, 0.8), ...crate(-2.8, 1.9, 0, 0.9));
      g.push(...sandbags(0, -3.2, 4, 2, false, 51));
      // Wire runs strung down both centre aisles. Axis-aligned only: poleWire's catenary
      // boxes are thin in exactly one axis, so a diagonal run would render as hanging slabs.
      // It also only plants a pole at its start point — the far ends get bare poles.
      g.push(...poleWire(-22, 12, 22, 12, 6.2, 8));
      g.push(...poleWire(22, -12, -22, -12, 6.2, 8));
      g.push([22, 3.1, 12, 0.2, 6.2, 0.2, 0x6a5340], [-22, 3.1, -12, 0.2, 6.2, 0.2, 0x6a5340]);
      g.push(...crate(-15, 12), ...crate(15, -12));
      return g;
    },
    doors: [],
    enemies: [
      { pos: [-22, 0, 15], positions: [[-22, 0, 15], [-19, 0, 9], [-25, 0, 13]], hold: true, yaw: 180, concealed: true, identifyTarget: true, targetPlayer: true, tag: 'market-infiltrator' },
      { pos: [8, 0, 18], patrol: [[8, 18], [22, 18]] },
      { pos: [-8, 0, 4], positions: [[-8, 0, 4], [-11, 0, 1], [-5, 0, 8]], hold: true, yaw: 160, concealed: true, identifyTarget: true, targetPlayer: true, tag: 'market-infiltrator' },
      { pos: [22, 0, 4], patrol: [[22, 4], [22, -8]], aggro: true },
      { pos: [-15, 0, -8], positions: [[-15, 0, -8], [-19, 0, -12], [-11, 0, -10]], hold: true, yaw: 20, concealed: true, identifyTarget: true, targetPlayer: true, tag: 'market-infiltrator' },
      { pos: [8, 0, -20], patrol: [[8, -20], [-8, -20]], aggro: true },
      { pos: [26, 0, -30], hold: true, yaw: 0, concealed: true, identifyTarget: true, targetPlayer: true, tag: 'market-infiltrator' },
      { pos: [-26, 0, -30], hold: true, yaw: 0 },
    ],
    // Free sockets for difficulty scaling. Without these the market had only four scalable
    // guards, every one already standing on its own socket, so Veteran's extra bodies fell
    // back to stacking two and three men inside each other at the authored spawns. Aisle
    // centres between the stall rows, clear of the crates, crowd and infiltrator positions.
    enemySpawns: [
      [15, 0, 12], [-15, 0, 0], [15, 0, 0],
      [0, 0, -12], [-15, 0, -24], [15, 0, 24],
    ],
    civilians: [
      { pos: [-18, 0, 20], rush: true }, { pos: [-4, 0, 16] }, { pos: [12, 0, 12] },
      { pos: [24, 0, 10] }, { pos: [-24, 0, 2] }, { pos: [2, 0, -2], rush: true }, { pos: [18, 0, -6] },
      { pos: [-10, 0, -14] }, { pos: [6, 0, -24] }, { pos: [-20, 0, -26] },
      { pos: [26, 0, 24] }, { pos: [0, 0, 24], rush: true },
      { pos: [-29, 0, 27] }, { pos: [-13, 0, 25] },
      { pos: [19, 0, 22] }, { pos: [30, 0, 3], rush: true },
      { pos: [-28, 0, -11] }, { pos: [14, 0, -15] },
      { pos: [-3, 0, -28] }, { pos: [25, 0, -23] },
      { pos: [-9, 0, 28], rush: true }, { pos: [9, 0, 28] },
      { pos: [-30, 0, 18] }, { pos: [30, 0, 18] },
    ],
    // Difficulty-scaled crowd additions use these authored aisle sockets instead of jittering
    // an existing civilian into a stall, facade, or another person. All stay between the four
    // market rows and inside the perimeter gates.
    crowdSpawns: [
      [-25, 0, 30], [-17, 0, 30], [-1, 0, 30], [4, 0, 29],
      [16, 0, 30], [24, 0, 29],
      [-31, 0, 12], [-16, 0, 12], [-1, 0, 12], [5, 0, 10],
      [16, 0, 8], [31, 0, 9],
      [-30, 0, -2], [-18, 0, -1], [-4, 0, 2], [9, 0, -1],
      [24, 0, -2], [31, 0, -7],
      [-30, 0, -20], [-17, 0, -22], [-1, 0, -18], [10, 0, -27],
      [18, 0, -29], [30, 0, -28],
    ],
    reinforce: { every: 26, first: 30, max: 6, group: 2, range: 60,
      at: [[0, 0, 34], [-30, 0, -34], [30, 0, -34]],
      atVariants: [
        [[0, 0, 34], [-30, 0, -34], [30, 0, -34]],
        [[-30, 0, 32], [30, 0, -30], [0, 0, -34]],
        [[30, 0, 32], [-30, 0, -30], [0, 0, -34]],
      ] },
    objectives: [
      phase('market-contact', 'BREAK THE MARKET CONTACT', [
        { type: 'clear', zone: null,
          text: 'CLEAR THE AID MARKET — ENGAGE ARMED CONTACTS, PROTECT UNARMED CIVILIANS' },
      ]),
      phase('market-manifest', 'RECOVER THE MARKET MANIFEST', [
        { type: 'interact', device: 'l5-manifest', autoUse: true,
          text: 'RECOVER THE AID MARKET MANIFEST' },
      ]),
      phase('market-exit', 'OPEN AND SECURE THE MARKET EXIT', [
        // The gold control ring is the action: stepping into it opens the gate, just like the
        // manifest pickup, so the exit cannot strand the player behind an unexplained button.
        { type: 'interact', device: 'l5-gate', autoUse: true, text: 'OPEN THE SOUTH MARKET GATE' },
        { type: 'reach', zone: [0, -42.5, 4.5], text: 'REACH THE SOUTH VEHICLE EXFIL' },
      ]),
    ],
    objectiveDevices: [
      {
        id: 'l5-manifest', kind: 'console', label: 'AID MARKET MANIFEST', actionLabel: 'RECOVER',
        pos: [0, 0.92, -29.5], width: 0.82, height: 0.42, depth: 0.46, radius: 2.5,
      },
      {
        id: 'l5-gate', kind: 'gate', label: 'SOUTH MARKET GATE', actionLabel: 'OPEN',
        // Put the control post beside the truck lane. The blocker itself spans the opening.
        pos: [-7.4, 0, -36.7], width: 0.85, radius: 3.0,
        visualId: 'market-south-gate-visual',
        blocker: { x: 0, y: 2.3, z: -38.02, width: 12, height: 4.6, depth: 0.62 },
      },
    ],
  },

  // ---------------------------------------------------------------- 6
  {
    id: 6, name: 'RELAY CROSSING',
    brief: 'Cover Vektor’s black-clad assault element as it crosses the plaza to seize a 37th relay and release three detained technicians. Riflemen occupy windows beside civilians, so read every opening. A sniper in the unlit centre block is hunting you; only his muzzle flash reveals the room, and he relocates after two rounds. When the team reaches the relay, arm the rooftop drone and repel the extraction attack while they withdraw.',
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
      // Keep the original coarse bags as bullet/player collision, then let the desktop
      // rooftop pass replace their visible boxes with stitched, irregular fabric sacks.
      const hiddenRoofGeometry = geo => lift(geo, 24).map(entry => {
        const hidden = [...entry];
        hidden[9] = false;
        return hidden;
      });
      g.push(...hiddenRoofGeometry(sandbags(-3.4, 61.0, 5, 3, false, 61)));
      g.push(...hiddenRoofGeometry(sandbags(3.4, 61.0, 5, 3, false, 62)));
      g.push(...hiddenRoofGeometry(sandbags(-6.2, 62.6, 3, 2, true, 63)));
      // roof furniture: the actual difference between a roof and the top of a cube
      // Their blockouts remain collision; the desktop layer supplies cylindrical tanks,
      // fan grilles, louvers, support feet and rain-capped vents.
      g.push(...hiddenRoofGeometry(waterTank(6.6, 0, 71.5)));
      g.push(...hiddenRoofGeometry(acUnit(-6.5, 0, 69.5, 1.2)));
      g.push(...hiddenRoofGeometry(acUnit(-4.0, 0, 72.4, 1.0)));
      g.push(...hiddenRoofGeometry(ventStack(2.2, 0, 73.6)));
      // Collision remains the original hutch shell. The desktop pass draws its cladding,
      // access door, roof flashing, vent and utility hardware.
      g.push(...hiddenRoofGeometry(roofHutch(-1.0, 0, 66.4, 's')));
      g.push(...lift(lamp(8.4, 64.0, 3.2, 1.0, -1), 24));
      // Authored timber slats replace the old single silver rectangle.
      g.push([0, 24.3, 63.2, 5.0, 0.12, 1.6, C.metal, false, false, false]);
      // team cover: fountain
      g.push([0, 0.6, -10, 6, 1.2, 6, C.concrete]);
      g.push([0, 1.5, -10, 2, 3, 2, C.metal]);
      // plaza far buildings hostiles emerge from — windowed so they read as buildings at
      // 150m rather than as three pale slabs, which is what a sniper is staring at all level
      g.push([-40, 7, -90, 30, 14, 20, C.building]);
      g.push([40, 7, -90, 30, 14, 20, C.buildingB]);
      g.push([0, 7, -110, 40, 14, 20, C.building]);
      const skipA = BAY_A.map(([x]) => ({ from: x + 55 - 0.9, to: x + 55 + 0.9 }));
      const skipB = BAY_B.map(([x]) => ({ from: x - 25 - 0.9, to: x - 25 + 0.9 }));
      const skipC = BAY_C.map(([x]) => ({ from: x + 20 - 0.9, to: x + 20 + 0.9 }));
      g.push(...facade(-55, -80, -25, -80, 0, 14, 611, {
        away: [-40, -90], skip: skipA, staticWindows: true,
      }));
      g.push(...facade(25, -80, 55, -80, 0, 14, 612, {
        away: [40, -90], skip: skipB, staticWindows: true,
      }));
      // The centre block is the sniper's, so it gets no warm panes at all: a lit window is
      // exactly the thing that makes a dark one legible, and a facade of dark holes with a
      // silhouette in one of them is the whole picture the mission is built on.
      g.push(...facade(-20, -100, 20, -100, 0, 14, 613, {
        away: [0, -110], lit: 0.06, skip: skipC, staticWindows: true,
      }));
      for (const b of BAY_A) g.push(...windowBay(b[0], b[1], -80, 1));
      for (const b of BAY_B) g.push(...windowBay(b[0], b[1], -80, 1));
      // The sniper's rooms are the brightest interiors on the map, which sounds backwards
      // until you look through the glass: he is flat black and unlit, so the only thing that
      // can ever show him to you is what is BEHIND him. Eight faintly lit openings, and one
      // of them has a shape standing in it.
      for (const b of BAY_C) g.push(...windowBay(b[0], b[1], -100, 1, { frame: 0x5a6066, room: 0x606c7a }));
      g.push(...lift(acUnit(-34, 14, -92, 1.3), 0), ...lift(waterTank(44, 14, -93), 0));
      g.push(...lift(ventStack(-6, 14, -112), 0));
      // Squaring off the plaza. It used to be four buildings in a field with the skyline off
      // in the fog: open the way a parking lot is open, not the way a town square is. These
      // blocks close the east, west and near sides so the fight happens in a room made of
      // buildings. The engagement frontage at z=-80/-100 is untouched, and the flanks stay
      // out of the scope's sight cone: the ray from the perch to the outermost bay (x=53.2,
      // z=-80) passes |x|=40 at z=-44, so inner faces hold at |x|=43 and the deep blocks end
      // at z=-44 — which also keeps the corner streets the reinforcements arrive through.
      const flank = (cx, cz, w, h, d, col, seed) => {
        g.push([cx, h / 2, cz, w, h, d, col]);
        const ix = cx > 0 ? cx - w / 2 : cx + w / 2; // the face on the square
        g.push(...facade(ix, cz - d / 2, ix, cz + d / 2, 0, h, seed, { away: [cx, cz], staticWindows: true }));
      };
      flank(-53, -26, 20, 14, 36, C.building, 621);
      flank(-51, 20, 16, 12, 30, C.buildingB, 622);
      flank(53, -26, 20, 14, 36, C.buildingB, 623);
      flank(51, 20, 16, 12, 30, C.building, 624);
      // Near corners flanking the perch, faces set 5m proud of it, so the player's own
      // building reads as part of a terrace on the square instead of a lone tower in a lot.
      g.push([-30, 6.5, 64, 24, 13, 18, C.buildingB]);
      g.push(...facade(-42, 55, -18, 55, 0, 13, 625, { away: [-30, 64], staticWindows: true }));
      g.push([30, 6.5, 64, 24, 13, 18, C.building]);
      g.push(...facade(18, 55, 42, 55, 0, 13, 626, { away: [30, 64], staticWindows: true }));
      // Rooftop clutter so the new blocks hold a silhouette against the sky like the far pair.
      g.push(...lift(acUnit(-53, 14, -34, 1.2), 0), ...lift(waterTank(53, 14, -18), 0));
      g.push(...lift(acUnit(-51, 12, 16, 1.1), 0), ...lift(ventStack(51, 12, 24), 0));
      g.push(...lift(ventStack(-30, 13, 68), 0), ...lift(acUnit(30, 13, 66, 1.0), 0));
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
      { pos: [-36, 0, -76], positions: [[-36, 0, -76], [-24, 0, -37], [-8, 0, -28]],
        patrol: [[-24, -37], [-8, -28]], aggro: true, range: 200 },
      { pos: [-30, 0, -77], positions: [[-30, 0, -77], [-27, 0, -60], [-18, 0, -32]],
        patrol: [[-27, -60], [-18, -32]], aggro: true, range: 200 },
      { pos: [36, 0, -76], positions: [[36, 0, -76], [20, 0, -42], [10, 0, -28]],
        patrol: [[20, -42], [10, -28]], aggro: true, range: 200 },
      { pos: [30, 0, -77], positions: [[30, 0, -77], [30, 0, -55], [12, 0, -38]],
        patrol: [[30, -55], [12, -38]], aggro: true, range: 200 },
      { pos: [0, 0, -96], positions: [[0, 0, -96], [0, 0, -55], [-4, 0, -30]],
        patrol: [[0, -55], [-4, -30]], aggro: true, range: 200 },
      { pos: [-10, 0, -96], positions: [[-10, 0, -96], [-14, 0, -50], [-3, 0, -32]],
        patrol: [[-14, -50], [-3, -32]], aggro: true, range: 200 },
      { pos: [10, 0, -96], positions: [[10, 0, -96], [18, 0, -60], [8, 0, -30]],
        patrol: [[18, -60], [8, -30]], aggro: true, range: 200 },
      { pos: [22, 0, -93], positions: [[22, 0, -93], [28, 0, -64], [20, 0, -42]],
        patrol: [[28, -64], [20, -42]], aggro: true, range: 200 },
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
    // Elite adds pressure to the open plaza, never to an already occupied firing window.
    enemySpawns: [
      [-24, 0, -37], [-8, 0, -28], [-27, 0, -60],
      [20, 0, -42], [30, 0, -55], [12, 0, -38],
    ],
    crowdSpawns: [
      [-32, 0, -28], [28, 0, -25], [-12, 0, -45],
      [5, 0, -52], [24, 0, -65], [-34, 0, -70],
    ],
    reinforce: { every: 32, first: 45, max: 5, group: 2, range: 220,
      at: [[-44, 0, -78], [44, 0, -78], [4, 0, -98]] },
    objectives: [
      phase('relay-cover', 'COVER THE ASSAULT TEAM', [
        {
          // The sniper is covering an extraction: the first operator through the relay is the
          // handoff. The rest can be wounded or still moving, but if the last man falls the
          // existing assault-team failure path ends the mission immediately.
          type: 'escort', minAlive: 1,
          destination: [-35, -77.5, 5.5], destinationLabel: 'THE RELAY CONTROL',
          text: 'COVER VEKTOR — FIRST OPERATOR IN THE RELAY CONTROL AREA TRIGGERS DRONE OVERWATCH',
        },
      ]),
      phase('relay-extraction', 'COVER THE EXTRACTION', [
        {
          type: 'interact', device: 'l6-drone', autoUse: true, radius: 5.5,
          text: 'ARM THE RELAY OVERWATCH DRONE — COVER VEKTOR’S EXTRACTION',
        },
        {
          type: 'drone',
          mode: 'combat',
          unlockPlayer: true,
          label: 'RELAY OVERWATCH // EXTRACTION COVER',
          text: 'BREAK THE EXTRACTION ATTACK — COVER VEKTOR’S WITHDRAWAL',
          launch: [-4, 25.24, 61.25],
          maxRange: 175,
          yaw: Math.PI,
          keepStackVisible: true,
          rifleRounds: 100,
          grenades: 8,
          result: 'EXTRACTION CORRIDOR SECURE — VEKTOR MOVING',
          combatWave: {
            label: 'RELAY EXTRACTION ATTACK',
            baseCount: 10,
            minCount: 10,
            maxCount: 10,
            enemies: [
              { pos: [-48, 0, -78], patrol: [[-48, -78], [-42, -75], [-35, -77.5]] },
              { pos: [-42, 0, -93], patrol: [[-42, -93], [-40, -84], [-35, -77.5]] },
              { pos: [-22, 0, -108], patrol: [[-22, -108], [-18, -94], [-28, -82]] },
              { pos: [0, 0, -120], patrol: [[0, -120], [0, -104], [-4, -90]] },
              { pos: [22, 0, -108], patrol: [[22, -108], [18, -94], [28, -82]] },
              { pos: [42, 0, -93], patrol: [[42, -93], [40, -84], [35, -77.5]] },
              { pos: [48, 0, -78], patrol: [[48, -78], [42, -75], [35, -77.5]] },
              { pos: [-60, 0, -68], patrol: [[-60, -68], [-48, -64], [-35, -72]] },
              { pos: [60, 0, -68], patrol: [[60, -68], [48, -64], [35, -72]] },
              { pos: [0, 0, -78], patrol: [[0, -78], [-8, -74], [-4, -68]] },
            ],
            droneIngress: [
              [[-35, -72], [-35, -77.5], [-30, -82]],
              [[-35, -72], [-32, -77.5], [-24, -84]],
              [[-35, -72], [-35, -77.5], [-40, -82]],
              [[-35, -72], [-32, -77.5], [-28, -90]],
              [[-35, -72], [-35, -77.5], [-48, -82]],
              [[-35, -72], [-38, -77.5], [-44, -88]],
            ],
          },
        },
        { type: 'clear', zone: null, text: 'CLEAR THE CROSSING — MOVE OFF THE ROOF AND SECURE THE EXTRACTION CORRIDOR' },
      ]),
      phase('relay-activate', 'ACTIVATE THE RELAY', [
        { type: 'rescue', text: 'CUT EVERY HOSTAGE LOOSE — FREE THE RELAY TECHNICIANS' },
        { type: 'interact', device: 'l6-relay', autoUse: true, radius: 2.8, text: 'ACTIVATE THE RELAY CONTROL' },
      ]),
    ],
    objectiveDevices: [
      { id: 'l6-drone', kind: 'launch', label: 'RELAY OVERWATCH DRONE', actionLabel: 'ARM', pos: [-4, 24.2, 61.25], width: 0.7, height: 0.72, depth: 0.5 },
      { id: 'l6-relay', kind: 'relay', label: 'RELAY CONTROL', actionLabel: 'ACTIVATE', pos: [-35, 0, -77.5] },
    ],
  },

  // ---------------------------------------------------------------- 7
  {
    id: 7, name: 'OP BRAVO',
    brief: 'A rooftop insertion puts you above the tower selected for OP Bravo. A 37th assault platoon is forming north of the tower. Use the post’s jury-rigged drone—one modified rifle magazine and ten launched grenades—to break the infantry attack before fighting down four occupied floors. The 37th knows the aircraft is coming, so flash every stairwell before committing.',
    weapons: ['pistol', 'm4'], grenades: 3, flashes: 3, squad: 2,
    sky: 0x1d2734, fog: [0x1d2734, 40, 160], ambient: 0.85, sun: 1.1,
    start: [3, 12.3, -2, 180],
    geo: () => {
      const g = [];
      g.push(...GROUND(70, 70, C.street));
      g.push(...tower(0, -4, 16, 14, 4, {
        door: true, mirror: true, stairwellClearance: 0.6, roofCaps: false,
      }));
      g.push(...car(12, 12)); g.push(...car(-14, 8, true));
      return g;
    },
    doors: [
      { pos: [-2, 9, -4], rot: 90, w: 1.5 }, { pos: [-2, 3, -4], rot: 90, w: 1.5 },
    ],
    extraGeo: () => {
      const g = [];
      for (const y of [3, 9]) {
        g.push(...wall(-2, -11, -2, -4.75, 3, C.interiorWall, [], y));
        g.push(...wall(-2, -3.25, -2, 3, 3, C.interiorWall, [], y));
      }
      return g;
    },
    enemies: [
      { pos: [-5, 9, -8], positions: [[-5, 9, -8], [-4, 9, -5], [-5.3, 9, -2.5]],
        hold: true, yaw: 0 },
      { pos: [5, 9, -6], positions: [[5, 9, -6], [5.2, 9, -8.5], [3.7, 9, -3.0]],
        hold: true, yaw: 90 },
      { pos: [4, 6, -7], positions: [[4, 6, -7], [2.5, 6, -8.5], [5.2, 6, -5.2]],
        patrol: [[4, -7], [-4, -7]] },
      { pos: [-5.5, 6, -3], positions: [[-5.5, 6, -3], [-4.2, 6, -8.8], [-5.2, 6, -5.5]],
        hold: true, yaw: 300 },
      { pos: [5, 3, -8], positions: [[5, 3, -8], [3.2, 3, -5.8], [5.4, 3, -2.8]],
        hold: true, yaw: 90 },
      { pos: [-4, 3, -6], positions: [[-4, 3, -6], [-5.2, 3, -8.7], [-3.8, 3, -2.8]],
        patrol: [[-4, -6], [4, -3]] },
      { pos: [0, 0, -6], positions: [[0, 0, -6], [3.5, 0, -8], [-2.8, 0, -4.2]],
        hold: true, yaw: 0 },
      { pos: [5, 0, -3], positions: [[5, 0, -3], [4.2, 0, -8.5], [1.8, 0, -1.5]],
        hold: true, yaw: 45 },
      { pos: [-5, 0, -9], positions: [[-5, 0, -9], [-4.5, 0, -5.5], [-5.2, 0, -2.2]],
        hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [6, 6, -9.5], hostage: true }, { pos: [-6, 0, -2], hostage: true },
    ],
    reinforce: { every: 26, first: 30, max: 5, group: 2, range: 50,
      at: [[0, 0, 6], [-6, 0, 8]],
      atVariants: [
        [[0, 0, 6], [-6, 0, 8]],
        [[6, 0, 8], [-4, 0, 10]],
        [[-6, 0, 8], [4, 0, 11]],
      ] },
    objectives: [
      phase('bravo-drone', 'BREAK THE ASSAULT WITH THE ROOFTOP DRONE', [
        {
        type: 'drone',
        mode: 'combat',
        label: 'OP BRAVO // JURY-RIGGED GUNSHIP',
        text: 'OP BRAVO DRONE — BREAK THE INFANTRY ASSAULT',
        launch: [3, 12.55, -2],
        yaw: Math.PI,
        keepStackVisible: true,
        rifleRounds: 100,
        grenades: 10,
        result: 'ASSAULT PLATOON BROKEN — BEGIN THE TOWER CLEARANCE',
        combatWave: {
          label: 'OP BRAVO ASSAULT PLATOON',
          baseCount: 11,
          minCount: 10,
          maxCount: 12,
          vehicle: {
            kind: 'technical',
            health: 190,
            speed: 3.8,
            pos: [0, 0, 35],
            positions: [[0, 0, 35], [-3, 0, 34], [3, 0, 35]],
            patrols: [
              [[0, 31], [0, 23], [0, 13]],
              [[-3, 30], [-2, 22], [-1, 12]],
              [[3, 31], [2, 23], [1, 13]],
            ],
          },
          enemies: [
            { pos: [-17, 0, 28], positions: [[-17, 0, 28], [-20, 0, 23], [-14, 0, 31]],
              patrols: [[[-13, 23], [-9, 14]], [[-16, 19], [-10, 12]], [[-11, 26], [-7, 15]]] },
            { pos: [-12, 0, 34], positions: [[-12, 0, 34], [-9, 0, 27], [-16, 0, 30]],
              patrols: [[[-10, 27], [-6, 15]], [[-8, 22], [-5, 12]], [[-13, 25], [-8, 14]]] },
            { pos: [-7, 0, 25], positions: [[-7, 0, 25], [-5, 0, 32], [-10, 0, 29]],
              patrols: [[[-6, 20], [-4, 11]], [[-5, 26], [-3, 13]], [[-8, 23], [-5, 12]]] },
            { pos: [-2, 0, 31], positions: [[-2, 0, 31], [1, 0, 25], [-3, 0, 35]],
              patrols: [[[-2, 24], [-1, 12]], [[1, 20], [1, 10]], [[-3, 28], [-2, 14]]] },
            { pos: [3, 0, 27], positions: [[3, 0, 27], [5, 0, 33], [2, 0, 23]],
              patrols: [[[3, 21], [2, 11]], [[5, 27], [3, 13]], [[2, 18], [1, 9]]] },
            { pos: [8, 0, 34], positions: [[8, 0, 34], [11, 0, 28], [7, 0, 30]],
              patrols: [[[7, 27], [5, 14]], [[9, 23], [6, 12]], [[6, 25], [4, 13]]] },
            { pos: [13, 0, 26], positions: [[13, 0, 26], [16, 0, 32], [11, 0, 29]],
              patrols: [[[11, 21], [7, 12]], [[13, 26], [8, 14]], [[9, 24], [6, 13]]] },
            { pos: [18, 0, 32], positions: [[18, 0, 32], [15, 0, 25], [20, 0, 28]],
              patrols: [[[15, 26], [9, 14]], [[12, 21], [8, 12]], [[16, 23], [10, 13]]] },
            { pos: [-15, 0, 34], positions: [[-15, 0, 34], [-14, 0, 36], [-16, 0, 32]],
              patrols: [[[-13, 29], [-9, 17]], [[-12, 31], [-8, 16]], [[-14, 27], [-10, 15]]] },
            { pos: [15, 0, 35], positions: [[15, 0, 35], [14, 0, 37], [16, 0, 33]],
              patrols: [[[13, 30], [9, 17]], [[12, 32], [8, 16]], [[14, 28], [10, 15]]] },
            { pos: [-5, 0, 34], positions: [[-5, 0, 34], [-7, 0, 33], [-4, 0, 32]],
              patrols: [[[-5, 29], [-3, 18]], [[-7, 28], [-4, 16]], [[-4, 27], [-2, 17]]] },
            { pos: [6, 0, 35], positions: [[6, 0, 35], [8, 0, 33], [5, 0, 34]],
              patrols: [[[6, 30], [4, 18]], [[8, 28], [5, 16]], [[5, 29], [3, 17]]] },
          ],
          // The old wave exhausted its short patrol list and held at the last truck socket.
          // Keep six men moving through the south door and around the ground floor; the
          // remaining five circulate outside so the drone view never turns into a static row.
          droneInteriorCount: 6,
          droneInteriorThreshold: 2,
          droneIngress: [
            [[0, 4], [0, 1.9], [3.8, -3], [3.8, -8], [0, -9], [-3.8, -8]],
            [[0, 4], [0, 1.9], [-3.8, -3], [-3.8, -8], [0, -9], [3.8, -8]],
            [[2, 4], [1.2, 1.9], [5, -3], [5, -8], [2, -9], [-2, -8]],
            [[-2, 4], [-1.2, 1.9], [-5, -3], [-5, -8], [-2, -9], [2, -8]],
            [[0, 4], [0, 1.9], [0, -3], [4, -8], [0, -9], [-4, -8]],
            [[0, 4], [0, 1.9], [0, -3], [-4, -8], [0, -9], [4, -8]],
            [[18, 8], [18, 0], [22, 7], [18, 14], [12, 10]],
            [[-18, 8], [-18, 0], [-22, 7], [-18, 14], [-12, 10]],
            [[10, 18], [10, 10], [16, 7], [18, 14], [12, 20]],
            [[-10, 18], [-10, 10], [-16, 7], [-18, 14], [-12, 20]],
            [[0, 18], [0, 10], [6, 8], [-6, 8], [0, 18]],
          ],
        },
        },
      ]),
      phase('bravo-clear', 'CLEAR THE TOWER FLOOR BY FLOOR', [
        { type: 'clear', zone: null, text: 'CLEAR THE TOWER TOP TO BOTTOM' },
      ]),
      phase('bravo-antenna', 'RESTORE OP BRAVO CONTROL', [
        { type: 'interact', device: 'l7-antenna', text: 'RESTORE THE OP BRAVO ANTENNA CONTROL' },
        { type: 'reach', zone: [0, 14, 4], text: 'EXTRACT AT STREET LEVEL' },
      ]),
    ],
    objectiveDevices: [
      { id: 'l7-antenna', kind: 'antenna', label: 'OP BRAVO ANTENNA CONTROL', actionLabel: 'RESTORE', pos: [0, 0, 2.4] },
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
      // Enclose the insertion point in a short records-office vestibule. Previously the player
      // spawned on an exterior strip and could turn around to see the finite ground slab end
      // against black void; the grazing full-screen floor view also caused a reproducible GPU
      // residency stall. These walls are real collision and make the threshold a finished room.
      g.push(...wall(-4, 20, -4, 29, 3, C.interiorWall));
      g.push(...wall(4, 20, 4, 29, 3, C.interiorWall));
      g.push(...wall(-4, 29, 4, 29, 3, C.interiorWall));
      g.push(...floorSlab(0, 24.5, 8.2, 9.2, 3.1, 0.3, C.roof));
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
        // Preserve the original cover box for navigation and bullets, but let the desktop
        // interior kit draw a real desk with a thin top, legs and drawer pedestal.
        g.push([dx, 0.45, dz, 2.2, 0.9, 1.1, C.metal, true, false, false]);
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
      { pos: [-10, 0, 6], positions: [[-10, 0, 6], [-12, 0, 4], [-8.5, 0, 7.5]],
        patrol: [[-10, 6], [-2, 6]] },
      { pos: [10, 0, 6], positions: [[10, 0, 6], [12, 0, 3.5], [8.5, 0, 7.2]],
        hold: true, yaw: 180 },
      { pos: [-10, 0, -6], positions: [[-10, 0, -6], [-12, 0, -10], [-8.5, 0, -4]],
        patrol: [[-10, -6], [-10, -12]], aggro: true },
      { pos: [10, 0, -10], positions: [[10, 0, -10], [12, 0, -8], [8.5, 0, -12]],
        hold: true, yaw: 300 },
      { pos: [2, 0, -8], positions: [[2, 0, -8], [4, 0, -4], [-4, 0, -8]],
        patrol: [[2, -8], [-4, -4]], aggro: true },
      { pos: [-8, 0, -17], positions: [[-8, 0, -17], [-11, 0, -16], [-5, 0, -18]],
        hold: true, yaw: 0 },
      { pos: [8, 0, -17], positions: [[8, 0, -17], [11, 0, -16], [5, 0, -18]],
        hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [-12, 0, 2], hostage: true }, { pos: [12, 0, -16], hostage: true },
    ],
    reinforce: { every: 28, first: 32, max: 5, group: 2, range: 40,
      at: [[0, 0, 18], [-13, 0, 17]],
      atVariants: [
        [[0, 0, 18], [-13, 0, 17]],
        [[0, 0, 18], [13, 0, 16]],
        [[-3, 0, 18], [13, 0, 8]],
      ] },
    objectives: [
      phase('ew-power', 'RESTORE EMERGENCY POWER', [
        { type: 'interact', device: 'l8-breaker', text: 'RESET THE EMERGENCY POWER BREAKER' },
      ]),
      phase('ew-clear', 'CLEAR THE EW TEAM', [
        { type: 'clear', zone: null, text: 'CLEAR THE DARK FLOOR — STOP THE EW TEAM' },
        { type: 'rescue', text: 'FREE THE RECORDS STAFF' },
      ]),
      phase('ew-jammer', 'SHUT THE JAMMER AND SECURE THE SERVER', [
        { type: 'interact', device: 'l8-server', text: 'SHUT DOWN THE JAMMER — SECURE THE SERVER' },
        { type: 'reach', zone: [0, -18, 2.5], text: 'SECURE THE SERVER ROOM' },
      ]),
    ],
    // The red circuit the breaker brings back (emergencyPower() in main.js): one pool per
    // waypoint of the route to the server — vestibule, main door, both partition gaps, the
    // server-room door, the server itself. The floor between the pools stays black, so the
    // goggles remain the tool for the cubicles while the amber marks the spine.
    emergencyLights: [
      [0, 2.7, 22], [0, 2.7, 18.5], [-3, 2.7, 10],
      [2, 2.7, -1], [1, 2.7, -13.5], [0, 2.6, -17.5],
    ],
    objectiveDevices: [
      { id: 'l8-breaker', kind: 'breaker', label: 'EMERGENCY POWER BREAKER', actionLabel: 'RESET', pos: [0, 0, 24], effect: 'emergencyPower' },
      { id: 'l8-server', kind: 'server', label: 'JAMMER SERVER', actionLabel: 'SHUT DOWN', pos: [0, 0, -18] },
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
      // The disabled evacuation car is rendered by the desktop interior layer. A hidden
      // collision hull prevents the track-side set piece from becoming something actors and
      // bullets can pass through while preserving the platform combat route.
      g.push([-17.15, 1.55, -4, 4.35, 3.1, 24, C.metal, true, false, false]);
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
      { pos: [0, 0, 20], positions: [[0, 0, 20], [-9, 0, 18], [9, 0, 17]],
        patrol: [[-6, 20], [6, 20]] },
      { pos: [-10, 0, 10], positions: [[-10, 0, 10], [9, 0, 12], [-9, 0, 6]],
        hold: true, yaw: 0 },
      { pos: [10, 0, 4], positions: [[10, 0, 4], [9, 0, -4], [-10, 0, 2]],
        patrol: [[10, 4], [10, -10]], aggro: true },
      { pos: [-4, 0, -8], positions: [[-4, 0, -8], [5, 0, -10], [-9, 0, -12]],
        hold: true, yaw: 20 },
      { pos: [6, 0, -18], positions: [[6, 0, -18], [-5, 0, -20], [9, 0, -16]],
        patrol: [[6, -18], [-6, -24]], aggro: true },
      { pos: [0, 0, -26], positions: [[0, 0, -26], [9, 0, -24], [-9, 0, -25]],
        hold: true, yaw: 0 },
      { pos: [-2, 0, -38], positions: [[-2, 0, -38], [3, 0, -40], [-3.5, 0, -43]],
        hold: true, yaw: 0 },
      { pos: [3, 0, -52], positions: [[3, 0, -52], [-3, 0, -50], [1, 0, -56]],
        hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [-7.2, 0, 8], hostage: true }, { pos: [8.2, 0, -12], hostage: true },
      { pos: [-7.2, 0, -22], hostage: true }, { pos: [0, 0, -56], hostage: true },
    ],
    reinforce: [
      { every: 26, first: 30, max: 6, group: 2, range: 55,
        at: [[0, 0, 24], [0, 0, -28]],
        atVariants: [
          [[0, 0, 24], [0, 0, -28]],
          [[-10, 0, 24], [4, 0, -29]],
          [[10, 0, 24], [-4, 0, -29]],
        ] },
      // The push south is not a mop-up: once the engineers are free (phase 2), the platform
      // detachment doubles back and chases the squad down the tunnel. startPhase exempts it
      // from the generic last-objective spawn refusal — its hard cap and converging hostiles
      // guarantee the clear step still terminates, and sealing the bulkhead ends the level.
      // Sockets sit at the tunnel mouth behind the player; hidden staging plus the distance
      // floor mean they only enter once the squad is deep enough not to see it happen.
      { startPhase: 2, every: 18, first: 5, max: 4, group: 2, range: 60,
        minDistance: 16, scatter: 1.5, hidden: true,
        message: 'REAR PURSUIT — THE PLATFORM DETACHMENT IS ON YOUR TAIL',
        // Platform-side sockets tucked BEHIND the z=-30 wall segments, wide of the tunnel
        // doorway (its opening spans x -6..0): a straight tunnel offers no occlusion of its
        // own centreline, so staging on the tunnel axis would never pass the hidden check.
        at: [[-14, 0, -26], [14, 0, -26], [-18, 0, -20]] },
    ],
    objectives: [
      phase('rear-platform', 'SECURE THE PLATFORM', [
        { type: 'clear', zone: [0, 0, 40], text: 'CLEAR THE PLATFORM — HOSTAGES ON THE COLUMNS' },
      ]),
      phase('rear-engineers', 'FREE THE ENGINEERS', [
        { type: 'rescue', text: 'CUT EVERY HOSTAGE LOOSE — FREE THE ENGINEERS' },
      ]),
      phase('rear-seal', 'SEAL THE SOUTH TUNNEL', [
        { type: 'clear', zone: null, text: 'PUSH THE SOUTH TUNNEL' },
        { type: 'interact', device: 'l9-seal', text: 'SEAL THE SOUTH TUNNEL' },
      ]),
    ],
    objectiveDevices: [
      { id: 'l9-seal', kind: 'seal', label: 'SOUTH TUNNEL BULKHEAD', actionLabel: 'SEAL', pos: [0, 0, -56] },
    ],
  },

  // ---------------------------------------------------------------- 10
  {
    id: 10, name: 'HOLD DISTRICT',
    brief: 'The main assault has begun. Breach the forward compound and seize the armed drone on its fire-control roof. Use its rifle and jury-rigged grenades to break the infantry wave, then use the rebuilt observation network against the armour, guns and jammer supporting the attack. Clear BASTION’s bunker; he is using detained civilians as a last screen.',
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
      // Battalion motor pool: cargo trucks are backed toward the perimeter, side by side.
      // Six-metre spacing leaves roughly 3.5m between bodies, and their centres sit far enough
      // inboard to form a narrow wall-side work lane. Reinforcement sockets live in those lanes,
      // fully occluded by the trucks, so arriving troops emerge through visible vehicle gaps.
      const motorPool = [
        // west wall: rear ends toward x=-30, cabs facing into the yard
        [-24, 24, false, true], [-24, 18, false, true],
        [-24, 12, false, true], [-24, 6, false, true],
        [-24, 0, false, true], [-24, -6, false, true],
        [-24, -12, false, true], [-24, -18, false, true],
        [-24, -24, false, true],
        // east wall stops above the bunker excavation and stair trench
        [24, 24, false, false], [24, 18, false, false], [24, 12, false, false],
        [24, 6, false, false], [24, 0, false, false], [24, -6, false, false],
        [24, -12, false, false],
        // gate wall, split around the entrance; rears toward z=30
        [-18, 24, true, true], [-12, 24, true, true], [-7, 24, true, true],
        [7, 24, true, true], [12, 24, true, true], [18, 24, true, true],
        // rear-wall overflow west of the bunker; rears toward z=-40
        [-24, -34, true, false], [-18, -34, true, false], [-12, -34, true, false],
      ];
      motorPool.forEach(([x, z, turned, reverse], variant) => {
        g.push(...militaryTruck(x, z, turned, {
          variant,
          damage: 1 + variant % 4,
          canvas: variant % 10 === 0,
          reverse,
        }));
      });
      // Only untarped civilian wrecks burn. They use the recognizable sedan/SUV shell with
      // shattered glass, missing hardware, dropped bumpers and explicit scorch treatment.
      g.push(...car(-17, -1, true, 0x343a33, {
        variant: 0, damage: 0, burned: true,
      }));
      g.push(...car(17, 3, false, 0x3a332f, {
        variant: 2, damage: 0, burned: true,
      }));
      g.push(...crate(-5, 18), ...crate(5, 18), ...crate(0, 3));
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
      // Opening centre is x=22.2, exactly matching the authored blast door below. The old
      // x=21 opening left 1.2m of brick in front of the door and made it appear wall-less
      // from one side while remaining bypassable from the other.
      g.push(...wall(14, -24, 30, -24, 4.98, C.tunnel, [{ off: 8.2, w: 2.4, h: 2.6 }], -5));
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
      // The tower opening, portico and door leaf share the centred x=0 axis on the z=-3 wall.
      { pos: [0, 0, -3], rot: 0, w: 1.6 },          // tower entry
      { pos: [22.2, -5, -24], rot: 0, w: 2.4, unlockObjective: 2 },
      // The bunker is physically present from mission load but remains sealed until the
      // observation network destroys its supporting armour, guns and jammer.
    ],
    enemies: [
      // courtyard
      { pos: [-6, 0, 18], positions: [[-6, 0, 18], [5, 0, 20], [-14, 0, 13]],
        patrols: [[[-6, 18], [6, 18]], [[5, 20], [-9, 20]], [[-14, 13], [-3, 9]]] },
      { pos: [12, 0, 8], positions: [[12, 0, 8], [16, 0, 14], [10, 0, 22]],
        hold: true, yaw: 180 },
      { pos: [-12, 0, 4], positions: [[-12, 0, 4], [-17, 0, 11], [-10, 0, 21]],
        hold: true, yaw: 160 },
      { pos: [6, 0, 24], positions: [[6, 0, 24], [-8, 0, 25], [14, 0, 18]],
        patrols: [[[6, 24], [-10, 24]], [[-8, 25], [9, 23]], [[14, 18], [3, 12]]],
        aggro: true },
      // tower floors
      { pos: [4, 0, -12], positions: [[4, 0, -12], [5, 0, -7], [2.5, 0, -15]],
        hold: true, yaw: 90 },
      { pos: [-4, 0, -14], positions: [[-4, 0, -14], [-5, 0, -8], [-2.5, 0, -5]],
        hold: true, yaw: 0 },
      { pos: [4, 3, -13], positions: [[4, 3, -13], [5, 3, -7], [2.5, 3, -15]],
        hold: true, yaw: 90 },
      { pos: [-5, 3, -8], positions: [[-5, 3, -8], [-3, 3, -14], [4.5, 3, -8]],
        patrols: [[[-5, -8], [5, -8]], [[-3, -14], [4, -14]], [[4.5, -8], [-4.5, -8]]] },
      // roof
      { pos: [4, 6, -12], positions: [[4, 6, -12], [-4, 6, -8], [3, 6, -6]],
        hold: true, yaw: 120 },
      // bunker
      { pos: [22, -5, -30], positions: [[22, -5, -30], [17, -5, -28], [27, -5, -31]],
        hold: true, yaw: 0 },
      { pos: [18, -5, -38], positions: [[18, -5, -38], [21, -5, -41], [17, -5, -33]],
        hold: true, yaw: 0 },
      { pos: [27, -5, -36], positions: [[27, -5, -36], [26, -5, -40], [23, -5, -35]],
        hold: true, yaw: 30 },
      // BASTION, cornered: his command radio and tabs identify him without a floating marker.
      { pos: [24, -5, -41], positions: [[24, -5, -41], [27, -5, -38], [18, -5, -40]],
        flee: true, hvt: true, bastion: true,
        patrol: [[17, -41], [28, -41], [28, -28], [17, -30], [17, -41]] },
    ],
    civilians: [
      { pos: [-16, 0, 14], rush: true },
      { pos: [5.5, 3, -9], hostage: true },
      { pos: [20, -5, -39], hostage: true }, { pos: [24, -5, -39.2], hostage: true },
    ],
    crowdSpawns: [[16, 0, 18]],
    // Workers and ready troops respond in three waves from behind the parked trucks. These
    // exact wall-side sockets are hidden-spawn-only: if the player is looking into one lane,
    // that wave selects another occluded row or waits rather than beaming a soldier into view.
    reinforce: { every: 22, first: 26, max: 9, group: 3, range: 70,
      hidden: true, scatter: 0, minDistance: 10,
      at: [
        [-28.6, 0, 15], [-28.6, 0, -9],
        [28.6, 0, 15], [28.6, 0, -9],
        [-9, 0, 28.6], [-15, 0, -38.6],
      ],
      atVariants: [
        [
          [-28.6, 0, 15], [28.6, 0, -9], [-9, 0, 28.6],
          [28.6, 0, 15], [-28.6, 0, -9], [-15, 0, -38.6],
        ],
        [
          [28.6, 0, 15], [-28.6, 0, -9], [-15, 0, -38.6],
          [-28.6, 0, 15], [28.6, 0, -9], [-9, 0, 28.6],
        ],
        [
          [-9, 0, 28.6], [-15, 0, -38.6], [-28.6, 0, 15],
          [28.6, 0, 15], [-28.6, 0, -9], [28.6, 0, -9],
        ],
      ] },
    objectives: [
      phase('district-roof', 'TAKE THE COMPOUND AND FIRE-CONTROL ROOF', [
        { type: 'clear', zone: [0, 10, 34], text: 'TAKE THE COURTYARD' },
        {
          type: 'clear',
          zone: [0, -10, 14, 8],
          requireReach: [0, -10, 8, 6],
          text: 'CLEAR THE TOWER — REACH THE FIRE-CONTROL ROOF',
        },
      ]),
      phase('district-network', 'BREAK THE ASSAULT AND SUPPORT NETWORK', [
        { type: 'interact', device: 'l10-roof-control', text: 'ARM THE FIRE-CONTROL ROOF LAUNCH TABLE' },
        {
        type: 'drone',
        mode: 'combat',
        label: 'FIRE-CONTROL ROOF // ARMED UAS',
        text: 'TAKE CONTROL OF THE ROOFTOP DRONE — BREAK THE ASSAULT WAVE',
        launch: [0, 6.45, -10],
        yaw: Math.PI,
        keepStackVisible: true,
        rifleRounds: 100,
        grenades: 10,
        result: 'GROUND ASSAULT BROKEN — SUPPORT GROUP EXPOSED',
        combatWave: {
          label: 'FINAL ASSAULT WAVE',
          baseCount: 11,
          minCount: 10,
          maxCount: 12,
          vehicle: {
            kind: 'technical',
            health: 190,
            speed: 4,
            pos: [0, 0, 35],
            positions: [[0, 0, 35], [-6, 0, 33], [6, 0, 34]],
            patrols: [
              [[0, 29], [0, 18], [0, 7]],
              [[-6, 28], [-4, 17], [-2, 6]],
              [[6, 29], [4, 18], [2, 7]],
            ],
          },
          enemies: [
              { pos: [-24, 0, 26], positions: [[-24, 0, 26], [-10, 0, 28], [-26, 0, 15]],
                patrols: [[[-24, 26], [-8, 14]], [[-10, 28], [-3, 12]], [[-26, 15], [-10, 8]]] },
              { pos: [24, 0, 26], positions: [[24, 0, 26], [25, 0, 15], [11, 0, 28]],
                patrols: [[[24, 26], [8, 14]], [[25, 15], [10, 8]], [[11, 28], [3, 12]]] },
              { pos: [0, 0, 28], positions: [[0, 0, 28], [-20, 0, 25], [20, 0, 25]],
                patrols: [[[0, 28], [0, 12]], [[-20, 25], [-5, 9]], [[20, 25], [5, 9]]] },
              { pos: [-18, 0, 28], positions: [[-18, 0, 28], [18, 0, 28], [0, 0, 27]],
                patrols: [[[-18, 28], [-4, 10]], [[18, 28], [4, 10]], [[0, 27], [0, 8]]] },
              { pos: [-29, 0, 16], positions: [[-29, 0, 16], [-25, 0, 9], [-12, 0, 28]],
                patrols: [[[-29, 16], [-12, 2]], [[-25, 9], [-9, 1]], [[-12, 28], [-5, 7]]] },
              { pos: [29, 0, 14], positions: [[29, 0, 14], [13, 0, 28], [25, 0, 8]],
                patrols: [[[29, 14], [12, 0]], [[13, 28], [5, 7]], [[25, 8], [9, 1]]] },
              { pos: [0, 0, 29], positions: [[0, 0, 29], [-20, 0, 26], [20, 0, 26]],
                patrols: [[[0, 29], [6, 8]], [[-20, 26], [-6, 5]], [[20, 26], [6, 5]]] },
              { pos: [22, 0, 27], positions: [[22, 0, 27], [0, 0, 27], [-22, 0, 27]],
                patrols: [[[22, 27], [4, 4]], [[0, 27], [0, 5]], [[-22, 27], [-4, 4]]] },
              { pos: [-26, 0, 25], positions: [[-26, 0, 25], [-15, 0, 28], [-27, 0, 10]],
                patrols: [[[-26, 25], [-6, -2]], [[-15, 28], [-5, 1]], [[-27, 10], [-9, -2]]] },
              { pos: [26, 0, 24], positions: [[26, 0, 24], [27, 0, 10], [15, 0, 28]],
                patrols: [[[26, 24], [8, -2]], [[27, 10], [9, -2]], [[15, 28], [5, 1]]] },
              { pos: [-4, 0, 29], positions: [[-4, 0, 29], [20, 0, 26], [-20, 0, 26]],
                patrols: [[[-4, 29], [0, -4]], [[20, 26], [5, -3]], [[-20, 26], [-5, -3]]] },
              { pos: [16, 0, 29], positions: [[16, 0, 29], [-16, 0, 29], [0, 0, 28]],
                patrols: [[[16, 29], [5, -5]], [[-16, 29], [-5, -5]], [[0, 28], [0, -4]]] },
          ],
          // The wave does not stop when it reaches the last truck waypoint. The first half
          // pushes through the tower door and keeps circulating on its ground floor; the rest
          // keep a moving screen through the courtyard while the drone is overhead.
          droneInteriorCount: 6,
          droneInteriorThreshold: 2,
          droneIngress: [
            [[0, 4], [0, -1.9], [3.8, -5], [3.8, -12], [0, -15], [-3.8, -12]],
            [[0, 4], [0, -1.9], [-3.8, -5], [-3.8, -12], [0, -15], [3.8, -12]],
            [[2, 4], [1.2, -1.9], [5, -6], [5, -13], [2, -15], [-2, -13]],
            [[-2, 4], [-1.2, -1.9], [-5, -6], [-5, -13], [-2, -15], [2, -13]],
            [[0, 4], [0, -1.9], [0, -6], [4, -10], [0, -15], [-4, -10]],
            [[0, 4], [0, -1.9], [0, -6], [-4, -10], [0, -15], [4, -10]],
            [[18, 8], [18, 0], [22, 7], [18, 14], [12, 10]],
            [[-18, 8], [-18, 0], [-22, 7], [-18, 14], [-12, 10]],
          ],
        },
      },
      {
        type: 'drone',
        mode: 'strike',
        persistWrecks: true,
        label: 'VEKTOR OBSERVATION NETWORK',
        text: 'NETWORK ONLINE — BREAK THE SUPPORT GROUP',
        launch: [0, 6.45, -10],
        yaw: Math.PI,
        rifleRounds: 72,
        grenades: 6,
        result: 'BATTERY DESTROYED — FLEEING GUN CREWS STOPPED',
        // A straight three-gun battery north of the compound. All tubes face south at high
        // elevation, firing over the walls; two men per position survive the strikes and run.
        targets: [
          { pos: [-14, 0.1, -47], kind: 'artillery', label: 'GUN ONE',
            yaw: Math.PI / 2, elevation: 0.92, firing: true, squirters: 2 },
          { pos: [0, 0.1, -47], kind: 'artillery', label: 'GUN TWO',
            yaw: Math.PI / 2, elevation: 0.92, firing: true, squirters: 2 },
          { pos: [14, 0.1, -47], kind: 'artillery', label: 'GUN THREE',
            yaw: Math.PI / 2, elevation: 0.92, firing: true, squirters: 2 },
        ],
        },
      ]),
      phase('district-bunker', 'BREACH THE BUNKER AND END BASTION', [
        { type: 'rescue', zone: [22, -34, 16, -5], text: 'BREACH THE BUNKER — CUT THE HUMAN SHIELDS LOOSE' },
        { type: 'clear', zone: [22, -34, 16, -5], excludeHvt: true, text: 'SHIELDS CLEAR — ELIMINATE THE BUNKER GUARD' },
        { type: 'target', text: 'BASTION — END HIS COMMAND' },
      ]),
    ],
    objectiveDevices: [
      { id: 'l10-roof-control', kind: 'launch', label: 'FIRE-CONTROL ROOF LAUNCH TABLE', actionLabel: 'ARM', pos: [0, 6.45, -10] },
    ],
  },

  // ---------------------------------------------------------------- 11
  // The drone-warfare testbed. No ground fight: the operator never leaves the treeline OP.
  // Three sorties over kilometres of open farmland — two kamikaze FPV hunts and one heavy
  // bomber run — teaching the doctrine directly: terrain masking beats altitude, jammer
  // bubbles are terrain, cope cages make aspect matter, battery is the fuel plan, and a
  // drop munition is led like a bomb, not aimed like a gun. Distances are compressed
  // (metersPerUnit 3.5): the 1,700-unit rail leg reads as the ~6 km sortie it stands for.
  {
    id: 11, name: 'DEEP FENCE',
    brief: 'BASTION is gone but the 37th’s echelon is intact beyond the fields. Fly the fence: kill the road patrol tank, the BTR at the kolkhoz, and burn the fuel siding feeding their next assault. You never leave the treeline.',
    weapons: ['pistol'], grenades: 0, flashes: 0, squad: 0,
    lockPlayer: true,
    cameraFar: 2600,
    sky: 0x2b2733, fog: [0x35303c, 500, 2250], ambient: 0.8, sun: 0.85,
    backdrop: 'rural',
    terrainDef: DEEP_FENCE_TERRAIN,
    // The operator's map board: drawn on the FPV OSD, north-up. Coordinates are world
    // units; the drawer scales into the corner canvas. The briefs say "west road" and
    // "kolkhoz" — this is what makes those words mean something in the goggles.
    minimap: {
      bounds: [-962, 505, 962, -1420],
      opArea: [-360, 500, 360, -1416],
      roads: [
        [-6, 500, -6, -1460],
        [-180, -700, 140, -700],
        [150, -700, 150, -1360],
      ],
      rail: [[330, -235, 330, -1420]],
      woods: [
        [-210, 428, -16, 430], [14, 430, 210, 428],
        [-330, -160, -40, -166], [30, -166, 330, -160],
        [-330, -382, -70, -378], [60, -378, 330, -384],
        [-330, -940, -60, -936], [110, -936, 330, -940],
        [-84, -430, -80, -880], [62, -560, 58, -1000],
        [-330, -1150, -30, -1146],
      ],
      places: [
        [-14, -527, 100, 70],
        [134, -1030, 84, 90],
        [330, -1237, 16, 44],
      ],
    },
    start: [0, 0, 462, 0],
    geo: () => {
      const g = [];
      const r = rng(1101);
      const th = terrainSampler(DEEP_FENCE_TERRAIN);
      // The ground itself is the real-DEM heightfield mesh (built by startLevel from
      // L.terrainDef); crop strips live in its vertex colours. What remains here is a
      // small solid pad under the OP so the operator has a floor to stand on.
      g.push(...floorSlab(0, 462, 40, 32, th(0, 462), 1, 0x4a4636));
      // Roads follow the graded corridors stamped into the DEM: short draped segments,
      // each sitting on the sampled surface, instead of one impossible kilometre slab.
      const road = (x1, z1, x2, z2, width) => {
        const length = Math.hypot(x2 - x1, z2 - z1);
        const steps = Math.max(2, Math.round(length / 34));
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps, t1 = (i + 1) / steps;
          const ax = x1 + (x2 - x1) * t0, az = z1 + (z2 - z1) * t0;
          const bx = x1 + (x2 - x1) * t1, bz = z1 + (z2 - z1) * t1;
          const cx = (ax + bx) / 2, cz = (az + bz) / 2;
          const y = Math.max(th(ax, az), th(cx, cz), th(bx, bz)) + 0.07;
          g.push([cx, y, cz,
            Math.abs(bx - ax) + (Math.abs(bx - ax) < 1 ? width : 1.2),
            0.12,
            Math.abs(bz - az) + (Math.abs(bz - az) < 1 ? width : 1.2),
            0x3b3833, false]);
        }
      };
      road(-6, 500, -6, -1460, 8);
      road(-180, -700, 140, -700, 9);
      road(150, -700, 150, -1360, 9);
      // A tree: SOLID trunk and a tapered three-tier canopy, lighter toward the sunlit
      // crown, with the upper tiers jittered off-axis so a row never reads as a picket of
      // identical shapes. Still SOLID throughout: clipping a windbreak at 60 km/h is how
      // real airframes die, and the mission wants that lesson available.
      const canopyTones = [
        [0x293c20, 0x334a28, 0x415c31],
        [0x263a1e, 0x2f4426, 0x3c522c],
        [0x2c4023, 0x374e2b, 0x466036],
      ];
      const tree = (x, z, s = 1) => {
        const tones = canopyTones[Math.floor(r() * canopyTones.length)];
        const ty = th(x, z);
        g.push([x, ty + 0.9 * s, z, 0.38 * s, 1.8 * s, 0.38 * s, 0x453727]);
        // Four heavily-overlapped tiers approximate a rounded crown; distinct steps with
        // clean gaps read as a stack of slabs, which is the hammer problem all over again.
        const tiers = [
          [3.0, 2.4, 1.5, 0],
          [2.5, 3.3, 1.4, 1],
          [1.9, 4.2, 1.3, 1],
          [1.1, 5.0, 1.2, 2],
        ];
        for (const [w, y, h, tone] of tiers) {
          g.push([x + (r() - 0.5) * 0.55 * s, ty + y * s, z + (r() - 0.5) * 0.55 * s,
            w * s, h * s, w * s, tones[tone]]);
        }
      };
      const treeRow = (x1, z1, x2, z2, step) => {
        const length = Math.hypot(x2 - x1, z2 - z1);
        const n = Math.max(2, Math.round(length / step));
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          tree(
            x1 + (x2 - x1) * t + (r() - 0.5) * 5,
            z1 + (z2 - z1) * t + (r() - 0.5) * 5,
            0.85 + r() * 0.5,
          );
        }
      };
      // Friendly treeline the OP hides in.
      treeRow(-210, 428, -16, 430, 15);
      treeRow(14, 430, 210, 428, 15);
      // Windbreaks marching north — the low covered routes past the jammer bubbles.
      treeRow(-330, -160, -40, -166, 17);
      treeRow(30, -166, 330, -160, 17);
      treeRow(-330, -382, -70, -378, 17);
      treeRow(60, -378, 330, -384, 17);
      treeRow(-330, -940, -60, -936, 17);
      treeRow(110, -936, 330, -940, 17);
      treeRow(-84, -430, -80, -880, 17);
      treeRow(62, -560, 58, -1000, 17);
      treeRow(-330, -1150, -30, -1146, 17);
      // Village at the crossroads: the first jammer lives here. Settlement footprints are
      // stamped flat in the DEM, so each building sits on its local sampled height.
      const house = (x, z, w, d, h, col) => {
        const ty = th(x, z);
        g.push([x, ty + h / 2, z, w, h, d, col]);
        g.push([x, ty + h + 0.35, z, w + 0.8, 0.7, d + 0.8, 0x33302c]);
      };
      house(-52, -498, 10, 8, 3.4, 0x5d5548);
      house(-34, -540, 12, 9, 3.8, 0x555c4e);
      house(-58, -556, 9, 8, 3.2, 0x5d5548);
      house(14, -502, 11, 8, 3.6, 0x605646);
      house(30, -544, 10, 9, 3.4, 0x555c4e);
      house(4, -556, 9, 7, 3.1, 0x5d5548);
      const jy = th(-11, -524);
      g.push([-11, jy + 2.6, -524, 1.1, 5.2, 1.1, 0x3a3f3a]);   // the jammer mast
      g.push([-11, jy + 5.5, -524, 2.4, 0.5, 0.6, 0x2c3130]);
      // The kolkhoz: barn, house and a walled yard the BTR crawls around.
      house(128, -1042, 16, 11, 5.2, 0x59503f);
      house(158, -1008, 10, 8, 3.5, 0x5d5548);
      g.push(...lift(wall(96, -1072, 172, -1072, 2.2, 0x4c463a), th(134, -1072)));
      g.push(...lift(wall(96, -988, 96, -1072, 2.2, 0x4c463a), th(96, -1030)));
      // Rail line east on its graded corridor: draped ballast/rail segments, box wagons.
      for (let rz = -235; rz > -1420; rz -= 55) {
        const mz = rz - 27.5;
        const ry = th(330, mz);
        g.push([330, ry + 0.25, mz, 8, 0.5, 56, 0x3f3b34]);
        g.push([327.4, ry + 0.61, mz, 0.5, 0.22, 56, 0x50524f, false]);
        g.push([332.6, ry + 0.61, mz, 0.5, 0.22, 56, 0x50524f, false]);
      }
      g.push([330, th(330, -1130) + 1.8, -1130, 3.2, 2.6, 11, 0x4a423a]);
      g.push([330, th(330, -1108) + 1.8, -1108, 3.2, 2.6, 11, 0x45483e]);
      // The operator's OP: trench cut, sandbag lip, work table, antenna mast, camo net.
      // The OP footprint is stamped flat at the datum, so these sit on their old heights.
      const oy = th(0, 462);
      g.push(...lift(floorSlab(0, 462, 26, 14, 0.02, 0.5, 0x413d31), oy));
      g.push(...lift([...sandbags(-6, 452, 6, 2, false, 71), ...sandbags(7, 452, 5, 2, false, 72)], oy));
      g.push(...lift([...table(-3, 461, 2.6, 1.1, 0x554a38), ...table(3.4, 461, 1.8, 1.0, 0x4c4234)], oy));
      g.push(...lift([...crate(8, 464), ...crate(-8.5, 464, 0, 0.85), ...crate(-7.6, 465.1, 0.85, 0.7)], oy));
      g.push([12, oy + 4.2, 458, 0.5, 8.4, 0.5, 0x3a3f3a]);
      g.push([12, oy + 8.6, 458, 3.4, 0.4, 0.5, 0x2c3130]);
      g.push([0, oy + 4.4, 460, 30, 0.18, 16, 0x36402e, false]);   // camo net canopy
      for (const [px, pz] of [[-14, 454], [14, 466], [-14, 466], [14, 454]]) {
        g.push([px, oy + 2.2, pz, 0.22, 4.4, 0.22, 0x453727, false]);
      }
      // Power line following the supply road — the landmark home when the OSD arrow is
      // all that survives the static. Each run rides the road corridor's graded height.
      for (let pz = 420; pz > -1400; pz -= 210) {
        g.push(...lift(poleWire(-16, pz, -16, pz - 210, 7.2, 6), th(-16, pz - 105)));
      }
      return g;
    },
    doors: [],
    enemies: [],
    civilians: [],
    objectives: [
      phase('fence-armor', 'KILL THE PATROL TANK', [
        {
          type: 'drone',
          mode: 'fpv',
          noHandoff: true,
          label: 'FPV STRIKE ONE',
          text: 'FPV ONE — KILL THE PATROL TANK. IT IS CAGED: TAKE THE REAR ARC.',
          launch: [6, 0, 455],
          yaw: 0,
          metersPerUnit: 3.5,
          maxRange: 2400,
          airframes: 3,
          ceiling: 55,
          maxSpeed: 18,
          accel: 24,
          batteryDrain: 0.28,
          jammers: [{ x: -11, z: -524, r: 190 }],
          vehicles: [{
            kind: 'tank', label: 'T-72B3', cage: true, health: 500,
            pos: [-120, 0, -700], yaw: 0, speed: 3.1, loop: true,
            route: [[-120, -700], [80, -700], [-120, -700]],
          }],
          startMessage: 'CAGED ARMOR ON THE WEST ROAD — TOP HITS FEED THE SLATS. HUNT THE REAR.',
          result: 'ARMOR DOWN — THE WEST ROAD IS BLIND',
          handoffMessage: 'AIRFRAME PREPPED — THE BTR AT THE KOLKHOZ IS NEXT',
        },
      ]),
      phase('fence-btr', 'KILL THE BTR AT THE KOLKHOZ', [
        {
          type: 'drone',
          mode: 'fpv',
          noHandoff: true,
          label: 'FPV STRIKE TWO',
          text: 'FPV TWO — KILL THE BTR AT THE KOLKHOZ. TWO BUBBLES ON THE DIRECT LINE.',
          launch: [6, 0, 455],
          yaw: 0,
          metersPerUnit: 3.5,
          maxRange: 2700,
          airframes: 2,
          ceiling: 55,
          maxSpeed: 18,
          accel: 24,
          batteryDrain: 0.3,
          jammers: [{ x: -11, z: -524, r: 190 }, { x: 62, z: -880, r: 175 }],
          vehicles: [{
            kind: 'apc', label: 'BTR-82A', health: 320,
            pos: [134, 0, -1030], yaw: 0, speed: 3.6, loop: true,
            route: [[134, -1030], [104, -1030], [104, -1000], [150, -1000], [150, -1052], [110, -1058]],
          }],
          startMessage: 'TWO BUBBLES BETWEEN YOU AND THE FARM — FLY THE TREELINES LOW.',
          result: 'BTR BURNING IN THE YARD — THE KOLKHOZ IS QUIET',
          handoffMessage: 'HERON SPOOLING UP — THE FUEL SIDING IS THE LAST CALL',
        },
      ]),
      phase('fence-rail', 'BURN THE FUEL SIDING', [
        {
          type: 'drone',
          mode: 'bomber',
          noHandoff: true,
          label: 'HERON HEAVY BOMBER',
          text: 'HERON — BURN THE THREE FUEL WAGONS ON THE SIDING. DROP FROM ALTITUDE.',
          launch: [-3, 0, 455],
          yaw: 0,
          metersPerUnit: 3.5,
          maxRange: 3100,
          airframes: 1,
          ceiling: 95,
          maxSpeed: 10,
          accel: 12,
          batteryDrain: 0.12,
          bombs: 6,
          thermalPersistent: true,
          fov: 84,
          jammers: [{ x: -11, z: -524, r: 190 }, { x: 62, z: -880, r: 175 }],
          vehicles: [
            { kind: 'fuelcar', label: 'FUEL WAGON ONE', health: 220, pos: [330, 0.5, -1225], yaw: Math.PI / 2 },
            { kind: 'fuelcar', label: 'FUEL WAGON TWO', health: 220, pos: [330, 0.5, -1237], yaw: Math.PI / 2 },
            { kind: 'fuelcar', label: 'FUEL WAGON THREE', health: 220, pos: [330, 0.5, -1249], yaw: Math.PI / 2 },
          ],
          startMessage: 'HEAVY BOMBER UP — THERMAL ON N. LEAD THE DRIFT, THE BOMB FALLS WITH YOU.',
          result: 'SIDING BURNING — THE 37TH FIGHTS ITS NEXT ASSAULT ON EMPTY TANKS',
        },
      ]),
    ],
  },
];
