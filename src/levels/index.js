import { C, floorSlab, wall, stairs, crate, car } from '../levelgen.js';
import {
  facade, lift, rng, sandbags, waterTank, acUnit, ventStack, roofHutch,
  lamp, trafficLight, dumpster, hydrant, bench, barrier, roadLine, crosswalk, awning, shopSign,
  ceilingLight, hangingBulb, exitSign, baseboard, wainscot, doorFrame, desk, chair, table,
  shelf, cabinet, mattress, rug, radiator, pipes, poster, debris,
} from '../world.js';

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
    geo.push(...lift(poster(ex2 - 0.16, z + (R() - 0.5) * 5, true, 1.75), y));
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
    id: 1, name: 'FIRST DOOR',
    brief: 'Kill-house shakedown. Clear three rooms. Armed targets only — anyone with their hands up walks out alive. Pistol discipline: controlled pairs.',
    weapons: ['pistol'], grenades: 0,
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
        g.push(...poster(10.78, rz + 2.4, true, 1.8, R() < 0.5 ? 0x6b5a3c : 0x4a5a6b));
        g.push(...debris(6.0 + R() * 2, rz + (R() - 0.5) * 3, 1.6, 6, 200 + rz));
        seat++;
      }
      // corridor: strip lights, skirting and a run of conduit overhead
      for (const cz of [18, 10, 2, -6, -14]) g.push(...ceilingLight(0, 3.15, cz, { intensity: 7, distance: 7.5, w: 0.9 }));
      g.push(...baseboard(-2.8, 21.8, -2.8, -19.8));
      g.push(...baseboard(2.8, 21.8, 2.8, -19.8));
      g.push(...pipes(-1.4, 21, -1.4, -19, 2.95, 2));
      g.push(...exitSign(0, 2.5, -19.4, false));
      // roof over the whole house
      g.push(...floorSlab(4, 1, 16, 44, 3.3, 0.3, C.roof));
      return g;
    },
    doors: [
      { pos: [3.15, 0, 13.25], rot: 90 }, { pos: [3.15, 0, 1.25], rot: 90 }, { pos: [3.15, 0, -10.75], rot: 90 },
    ],
    enemies: [
      { pos: [8, 0, 11], hold: true, yaw: 270 },
      { pos: [9, 0, -1], hold: true, yaw: 270 }, { pos: [6, 0, -3], hold: true, yaw: 270 },
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
    brief: 'Night sweep through an occupied block. Hostiles hold the storefronts and the street. M4 authorized. Civilians are still on the block — check your targets.',
    weapons: ['pistol', 'm4'], grenades: 0,
    sky: 0x1b2634, fog: [0x1b2634, 40, 160], ambient: 0.85, sun: 1.1,
    start: [0, 0, 40, 0],
    geo: () => {
      const g = [];
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
      g.push(...roadLine(0, -48, 52));
      g.push(...crosswalk(-42, -8, 8), ...crosswalk(28, -8, 8));
      g.push(...dumpster(-13.6, 38), ...dumpster(13.6, -30, true));
      g.push(...hydrant(-13.8, 12), ...hydrant(13.8, -16));
      g.push(...bench(-13.2, 26, true), ...bench(13.2, 8, true));
      // street clutter
      g.push(...car(-4, 25)); g.push(...car(3, 5, true)); g.push(...car(-2, -18)); g.push(...car(5, -35, true));
      g.push(...crate(0, 12), ...crate(1.2, 12.8), ...crate(-6, -8));
      // end barricade
      g.push(...wall(-16, -50, 16, -50, 3, C.metal, [{ off: 13, w: 6, h: 2.6 }]));
      return g;
    },
    doors: [],
    enemies: [
      { pos: [0, 0, 22], patrol: [[-6, 22], [6, 22]] },
      { pos: [11, 0, 20], hold: true, yaw: 180 },
      { pos: [-4, 0, 2], patrol: [[-8, 2], [4, 8]] },
      { pos: [11, 0, -5], hold: true, yaw: 180 },
      { pos: [2, 0, -20], patrol: [[2, -20], [-5, -30]], aggro: true },
      { pos: [-11, 0, -25], hold: true, yaw: 0 },
      { pos: [0, 0, -44], hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [-9, 0, 30] }, { pos: [8, 0, 10] }, { pos: [-8, 0, -12] }, { pos: [9.5, 0, -3], hostage: true },
    ],
    objectives: [
      { type: 'clear', zone: null, text: 'SWEEP THE BLOCK — ELIMINATE ALL HOSTILES' },
      { type: 'reach', zone: [0, -52, 3], text: 'PUSH THROUGH THE BARRICADE' },
    ],
  },

  // ---------------------------------------------------------------- 3
  {
    id: 3, name: 'STACK UP',
    brief: 'Apartment block, three floors, hostiles holding hostages on each. Flashbangs are the tool here: bang the room, then enter. Walk up to a bound hostage to cut them loose. A dead hostage ends the op.',
    weapons: ['pistol', 'm4'], grenades: 0, flashes: 3,
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
    objectives: [
      { type: 'clear', zone: null, text: 'CLEAR ALL THREE FLOORS — PROTECT THE HOSTAGES' },
      { type: 'rescue', text: 'CUT THE HOSTAGES LOOSE — WALK UP TO EACH ONE' },
      { type: 'reach', zone: [-2, -6, 3, 9], text: 'GET TO THE ROOF' },
    ],
  },

  // ---------------------------------------------------------------- 4
  {
    id: 4, name: 'THE CHASE',
    brief: 'The cell leader is running and he does not stop. Chase him through the alleys and the parking structure and put him down before he reaches the far gate. His guards will try to buy him time.',
    weapons: ['pistol', 'm4'], grenades: 3, flashes: 2,
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
      // parking structure: big slab on pillars
      g.push(...floorSlab(-5, -25, 44, 28, 3.5, 0.5, C.concrete));
      // 3.4 tall, not 3.5: at 3.5 each pillar cap is coplanar with the top of the slab it
      // holds up, putting 15 strobing 0.49m2 squares on that roof. 3.4 buries the cap inside
      // the slab (which spans y 3.0..3.5) where it is never rasterized.
      for (const px of [-24, -14, -4, 6, 14]) for (const pz of [-16, -25, -34]) g.push([px, 1.7, pz, 0.7, 3.4, 0.7, C.concrete]);
      g.push(...car(-18, -20)); g.push(...car(-8, -25, true)); g.push(...car(2, -31)); g.push(...car(10, -22));
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
      { pos: [-2, 0, 35] }, { pos: [20, 0, 5] }, { pos: [-10, 0, -22] }, { pos: [6, 0, -33] },
    ],
    objectives: [
      { type: 'target', text: 'RUN HIM DOWN — DO NOT LET HIM REACH THE GATE' },
      { type: 'clear', zone: [-5, -25, 30], text: 'CLEAR THE GARAGE' },
      { type: 'reach', zone: [-6.5, -41, 3.5], text: 'EXFIL THROUGH THE GATE' },
    ],
  },

  // ---------------------------------------------------------------- 5
  {
    id: 5, name: 'MARKET PANIC',
    brief: 'Shooters embedded in a crowded night market. The crowd will bolt when the first shot lands. Weapons tight: a single civilian casualty at this range is a career, at Veteran it is the mission.',
    weapons: ['pistol', 'm4'], grenades: 0,
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
      // market stalls: rows of counters with awning posts
      for (const sz of [18, 6, -6, -18]) {
        for (const sx of [-22, -8, 8, 22]) {
          g.push([sx, 0.55, sz, 5, 1.1, 2, C.accent]);
          g.push([sx - 2.2, 1.5, sz, 0.15, 3, 0.15, C.metal]);
          g.push([sx + 2.2, 1.5, sz, 0.15, 3, 0.15, C.metal]);
          g.push([sx, 3.0, sz, 5.4, 0.15, 2.6, 0x7a4a4a]);
        }
      }
      g.push(...crate(0, 0), ...crate(-15, 12), ...crate(15, -12));
      return g;
    },
    doors: [],
    enemies: [
      { pos: [-22, 0, 15], hold: true, yaw: 180 },
      { pos: [8, 0, 18], patrol: [[8, 18], [22, 18]] },
      { pos: [-8, 0, 4], hold: true, yaw: 160 },
      { pos: [22, 0, 4], patrol: [[22, 4], [22, -8]], aggro: true },
      { pos: [-15, 0, -8], hold: true, yaw: 20 },
      { pos: [8, 0, -20], patrol: [[8, -20], [-8, -20]], aggro: true },
      { pos: [26, 0, -30], hold: true, yaw: 0 },
      { pos: [-26, 0, -30], hold: true, yaw: 0 },
    ],
    civilians: [
      { pos: [-18, 0, 20] }, { pos: [-4, 0, 16] }, { pos: [12, 0, 12] }, { pos: [24, 0, 10] },
      { pos: [-24, 0, 2] }, { pos: [2, 0, -2] }, { pos: [18, 0, -6] }, { pos: [-10, 0, -14] },
      { pos: [6, 0, -24] }, { pos: [-20, 0, -26] }, { pos: [26, 0, 24] }, { pos: [0, 0, 24] },
    ],
    objectives: [
      { type: 'clear', zone: null, text: 'NEUTRALIZE EMBEDDED SHOOTERS — ZERO CIVILIAN CASUALTIES' },
      { type: 'reach', zone: [0, -40, 3.5], text: 'EXIT THE MARKET SOUTH GATE' },
    ],
  },

  // ---------------------------------------------------------------- 6
  {
    id: 6, name: 'OVERWATCH',
    brief: 'Barrett M82 on the rooftop. Your assault team is pinned at the fountain while hostiles advance across the plaza. Hold breath to steady. Civilians are still fleeing the square — a .50 does not give second chances.',
    weapons: ['barrett'], grenades: 0, sniper: true, lockPlayer: true,
    sky: 0x1a2432, fog: [0x1a2432, 120, 500], ambient: 0.9, sun: 1.2,
    start: [0, 24, 61.2, 0],
    team: { pos: [0, 0, -10], health: 300 },
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
      g.push(...facade(-20, -100, 20, -100, 0, 14, 613, { away: [0, -110] }));
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
    ],
    civilians: [
      { pos: [-25, 0, -35] }, { pos: [18, 0, -58] }, { pos: [-5, 0, -48] }, { pos: [30, 0, -62] }, { pos: [-35, 0, -70] },
    ],
    objectives: [
      { type: 'clear', zone: null, text: 'PROTECT THE TEAM — ELIMINATE ALL ADVANCING HOSTILES' },
    ],
  },

  // ---------------------------------------------------------------- 7
  {
    id: 7, name: 'VERTICAL ASSAULT',
    brief: 'Helicopter drops you on the roof of their safehouse tower. Fight DOWN four floors to the street. They know you are coming, so bang the stairwells before you take them.',
    weapons: ['pistol', 'm4'], grenades: 3, flashes: 3,
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
    objectives: [
      { type: 'clear', zone: null, text: 'CLEAR THE TOWER TOP TO BOTTOM' },
      { type: 'reach', zone: [0, 14, 4], text: 'EXTRACT AT STREET LEVEL' },
    ],
  },

  // ---------------------------------------------------------------- 8
  {
    id: 8, name: 'BLACKOUT',
    brief: 'They cut the power to the records office. Night vision goggles on. Clear the floor and reach the server room. They are blind in the dark — you are not.',
    weapons: ['pistol', 'm4'], grenades: 2, flashes: 3, nvg: true,
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
    objectives: [
      { type: 'clear', zone: null, text: 'NVGs ON — CLEAR THE DARK FLOOR' },
      { type: 'reach', zone: [0, -18, 2.5], text: 'SECURE THE SERVER ROOM' },
    ],
  },

  // ---------------------------------------------------------------- 9
  {
    id: 9, name: 'UNDERGROUND',
    brief: 'They pulled the hostages into the metro. Platform level, then the tunnels. Frags bounce far down here, so mind the overpressure. Every hostage taped to a column comes home: walk up to each one and cut them free.',
    weapons: ['pistol', 'm4'], grenades: 4, flashes: 2,
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
      g.push(...floorSlab(0, 0, 46, 62, 5.1, 0.5, C.tunnel));
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
    objectives: [
      { type: 'clear', zone: [0, 0, 40], text: 'CLEAR THE PLATFORM — HOSTAGES ON THE COLUMNS' },
      { type: 'clear', zone: null, text: 'PUSH THE SOUTH TUNNEL' },
      { type: 'rescue', text: 'CUT EVERY HOSTAGE LOOSE' },
    ],
  },

  // ---------------------------------------------------------------- 10
  {
    id: 10, name: 'THE CELL',
    brief: 'Endgame. Breach the compound, take the tower, then go down into the bunker where the cell leader is holed up behind human shields. Bang the room, drop him, cut them loose. Everything you have learned, every layer of the city.',
    weapons: ['pistol', 'm4'], grenades: 4, flashes: 4,
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
      // the cell leader, cornered: bolts around the bunker rather than standing and fighting
      { pos: [24, -5, -41], flee: true, hvt: true,
        patrol: [[17, -41], [28, -41], [28, -28], [17, -30], [17, -41]] },
    ],
    civilians: [
      { pos: [-16, 0, 14] },
      { pos: [5.5, 3, -9], hostage: true },
      { pos: [20, -5, -39], hostage: true }, { pos: [24, -5, -39.2], hostage: true },
    ],
    objectives: [
      { type: 'clear', zone: [0, 10, 34], text: 'TAKE THE COURTYARD' },
      { type: 'clear', zone: [0, -10, 14, 8], text: 'CLEAR THE TOWER' },
      { type: 'clear', zone: null, text: 'THE BUNKER — HUMAN SHIELDS. SURGICAL.' },
      { type: 'target', text: 'THE CELL LEADER — TAKE HIM' },
      { type: 'rescue', zone: [22, -34, 16, -5], text: 'CUT THE SHIELDS LOOSE AND GET THEM OUT' },
    ],
  },
];
