import { C, floorSlab, wall, stairs, crate, car } from '../levelgen.js';

// A 4-storey tower with zigzag stairs on the west side. Returns geo. Interior w×d, floors of height 3.
function tower(x, z, w, d, floors, opts = {}) {
  const geo = [];
  const fh = 3;
  const x1 = x - w / 2, x2 = x + w / 2, z1 = z - d / 2, z2 = z + d / 2;
  geo.push(...floorSlab(x, z, w, d, 0, 0.4, C.interiorFloor));
  for (let f = 0; f < floors; f++) {
    const y = f * fh;
    const doorGap = (f === 0 && opts.door !== false) ? [{ off: w / 2 - 0.8, w: 1.6, h: 2.4 }] : [];
    // south wall (entry), north, east, west
    geo.push(...wall(x1, z2, x2, z2, fh, C.building, doorGap, y));
    geo.push(...wall(x1, z1, x2, z1, fh, C.building, [], y));
    geo.push(...wall(x2, z1, x2, z2, fh, C.building, [], y));
    geo.push(...wall(x1, z1, x1, z2, fh, C.building, [], y));
    if (f < floors - 1) {
      // upper floor slab with a 2.2 x 4.5 stair opening at the north-west corner
      const oy = y + fh;
      geo.push(...floorSlab(x + 1.1, z, w - 2.2, d, oy, 0.3));                       // east portion
      geo.push(...floorSlab(x1 + 1.1, z + 4.5 / 2, 2.2, d - 4.5, oy, 0.3));         // west portion south of opening
      // stairs up along west wall heading north into the opening
      geo.push(...stairs(x1 + 1.1, z1 + 4.5, 'n', 4.4, fh, 2.0, C.concrete, y));
    }
  }
  if (opts.roof !== false) {
    // roof slab with stair opening access
    const ry = floors * fh;
    geo.push(...floorSlab(x + 1.1, z, w - 2.2, d, ry, 0.3, C.roof));
    geo.push(...floorSlab(x1 + 1.1, z + 4.5 / 2, 2.2, d - 4.5, ry, 0.3, C.roof));
    geo.push(...stairs(x1 + 1.1, z1 + 4.4, 'n', 4.4, fh, 2.0, C.concrete, (floors - 1) * fh));
    // parapet
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
      for (const rz of [11, -1, -13]) {
        g.push(...wall(3, rz + 3.5, 11, rz + 3.5, 3.2, C.interiorWall));
        g.push(...wall(3, rz - 3.5, 11, rz - 3.5, 3.2, C.interiorWall));
        g.push(...wall(11, rz + 3.5, 11, rz - 3.5, 3.2, C.interiorWall));
        g.push(...crate(9.5, rz + 2));
      }
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
      // building faces (solid) lining the street
      g.push(...wall(-16, 55, -16, -55, 9, C.building));
      g.push(...wall(16, 55, 16, -55, 9, C.building, []));
      // shops open toward the street
      g.push(...shop(11, 20, 9, 7, 'w'));
      g.push(...shop(11, -5, 9, 7, 'w'));
      g.push(...shop(-11, -25, 9, 7, 'e'));
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
    brief: 'Apartment block, three floors, hostiles holding hostages on each. Breach every door like it is your last. A dead hostage ends the op.',
    weapons: ['pistol', 'm4'], grenades: 0,
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
      { type: 'reach', zone: [-5.9, -6, 2.2, 9], text: 'GET TO THE ROOF' },
    ],
  },

  // ---------------------------------------------------------------- 4
  {
    id: 4, name: 'THE CHASE',
    brief: 'The cell leader is running. Pursue through the alleys and the parking structure. His guards will try to slow you down. Frags authorized — watch for runners who are not armed.',
    weapons: ['pistol', 'm4'], grenades: 3,
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
      for (const px of [-24, -14, -4, 6, 14]) for (const pz of [-16, -25, -34]) g.push([px, 1.75, pz, 0.7, 3.5, 0.7, C.concrete]);
      g.push(...car(-18, -20)); g.push(...car(-8, -25, true)); g.push(...car(2, -31)); g.push(...car(10, -22));
      g.push(...crate(21, 10), ...crate(21.8, 11));
      // exit gate south end of garage
      g.push(...wall(-27, -39, 17, -39, 4, C.metal, [{ off: 18, w: 5, h: 3 }]));
      return g;
    },
    doors: [],
    enemies: [
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
      { type: 'reach', zone: [13.5, 17.5, 3], text: 'PURSUE — THROUGH THE ALLEY DOOR' },
      { type: 'reach', zone: [-6, -7.5, 3.5], text: 'HE CUT THROUGH THE WALL — KEEP ON HIM' },
      { type: 'clear', zone: [-5, -25, 30], text: 'GUARDS IN THE GARAGE — DROP THEM' },
      { type: 'reach', zone: [-6.5, -41, 3.5], text: 'EXIT GATE — CUT HIM OFF' },
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
      // your rooftop perch
      g.push([0, 12, 68, 20, 24, 16, C.building]);
      g.push(...wall(-10, 60, 10, 60, 1.0, C.concrete, [], 24));
      // team cover: fountain
      g.push([0, 0.6, -10, 6, 1.2, 6, C.concrete]);
      g.push([0, 1.5, -10, 2, 3, 2, C.metal]);
      // plaza far buildings hostiles emerge from
      g.push([-40, 7, -90, 30, 14, 20, C.building]);
      g.push([40, 7, -90, 30, 14, 20, C.buildingB]);
      g.push([0, 7, -110, 40, 14, 20, C.building]);
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
    brief: 'Helicopter drops you on the roof of their safehouse tower. Fight DOWN four floors to the street. They know you are coming — expect stacked resistance in every stairwell.',
    weapons: ['pistol', 'm4'], grenades: 3,
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
    brief: 'They cut the power to the records office. Your weapon light is the only light. Clear the floor and reach the server room. Muzzle flashes will give them away — and you.',
    weapons: ['pistol', 'm4'], grenades: 2, flashlight: true,
    sky: 0x04060b, fog: [0x04060b, 7, 50], ambient: 0.1, sun: 0.0,
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
      { type: 'clear', zone: null, text: 'CLEAR THE DARK FLOOR — WATCH YOUR LIGHT' },
      { type: 'reach', zone: [0, -18, 2.5], text: 'SECURE THE SERVER ROOM' },
    ],
  },

  // ---------------------------------------------------------------- 9
  {
    id: 9, name: 'UNDERGROUND',
    brief: 'They pulled the hostages into the metro. Platform level, then the tunnels. Frags will bounce far down here — mind the overpressure and mind the hostages taped to the columns.',
    weapons: ['pistol', 'm4'], grenades: 4,
    sky: 0x0d1116, fog: [0x0d1116, 22, 90], ambient: 0.55, sun: 0.25,
    start: [0, 6, 40, 0],
    geo: () => {
      const g = [];
      // street stub + stairs down into station (top step meets the stub edge at z=36)
      g.push(...floorSlab(0, 44, 20, 16, 6, 0.5, C.sidewalk));
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
      g.push(...wall(-13, 28, -13, -30, 1.2, C.metal, [], -1.2, 0.2));
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
      { type: 'reach', zone: [0, -56, 3], text: 'REACH THE LAST HOSTAGE' },
    ],
  },

  // ---------------------------------------------------------------- 10
  {
    id: 10, name: 'THE CELL',
    brief: 'Endgame. Breach the compound gate, take the tower, cross the roof, and go down into the bunker where the cell leader is holed up with human shields. Everything you have learned. Every layer of the city.',
    weapons: ['pistol', 'm4'], grenades: 4,
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
      g.push(...wall(20, -24, 20, -16, 5, C.concrete, [], -5));   // trench west side
      g.push(...wall(24, -24, 24, -16, 5, C.concrete, [], -5));   // trench east side
      // bunker room (x 14..30, z -44..-24), floor -5, ceiling at courtyard level
      g.push(...floorSlab(22, -34, 16, 20, -5, 1, C.tunnel));
      g.push(...wall(14, -24, 14, -44, 5, C.tunnel, [], -5));
      g.push(...wall(30, -24, 30, -44, 5, C.tunnel, [], -5));
      g.push(...wall(14, -44, 30, -44, 5, C.tunnel, [], -5));
      g.push(...wall(14, -24, 30, -24, 5, C.tunnel, [{ off: 7, w: 2.4, h: 2.6 }], -5));
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
    ],
    civilians: [
      { pos: [-16, 0, 14] },
      { pos: [5.5, 3, -9], hostage: true },
      { pos: [20, -5, -39], hostage: true }, { pos: [24, -5, -39.2], hostage: true },
    ],
    objectives: [
      { type: 'clear', zone: [0, 10, 34], text: 'TAKE THE COURTYARD' },
      { type: 'clear', zone: [0, -10, 14, 8], text: 'CLEAR THE TOWER' },
      { type: 'clear', zone: null, text: 'THE BUNKER — HVT HAS HUMAN SHIELDS. SURGICAL.' },
      { type: 'reach', zone: [22, -39, 3, -5], text: 'SECURE THE HOSTAGES' },
    ],
  },
];
