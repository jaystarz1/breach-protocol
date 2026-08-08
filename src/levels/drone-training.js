import { floorSlab } from '../levelgen.js';
import { terrainSampler, carveRailGrade, carveTrenchLine, RAIL_TOP } from '../terrain.js';
import { lift, sandbags, table, poleWire } from '../world.js';
import { hedgeStands, rightOfWay, treePlacements, treeTrunkColliders } from '../trees.js';
import { hamletColliders, hamletLayout } from '../hamlet.js';
import { DEEP_FENCE_TERRAIN } from './terrain-deep-fence.js';

const phase = (id, text, steps) => ({ id, text, steps });

// The rail lines are engineered into the land itself, once, before anything samples
// it: carveRailGrade cuts and fills the DEM so the line holds a railway gradient, and
// buildRailLine (via each level's railLines) drapes ballast, ties and narrow-gauge steel
// on the result. Every training level shares this DEM, so the earthworks are permanent.
// The main line runs margin to margin — nothing on this map is a random piece of track
// in the middle of a field — and the deep siding diverges from it at a real junction
// before running north to the far margin, so rolling stock can be staged anywhere on it.
const TRAINING_RAIL = [{ points: [[245, 870], [245, -1870]] }];
const DEEP_RAIL = [{ points: [[245, -60], [272, -118], [300, -180], [330, -250], [330, -1870]] }];
carveRailGrade(DEEP_FENCE_TERRAIN, [...TRAINING_RAIL, ...DEEP_RAIL]);

// ----------------------------------------------------------------- field fortifications
// Traversed fire trenches dug into the shelterbelt wood lines, on the pattern the drone
// war actually photographs: straight fire bays of a few metres broken by perpendicular
// traverse doglegs (never a long straight run an attacker could enfilade or one blast
// could sweep), a ~1.4m-wide revetted slot between spoil parapets, and a 3x3m dugout
// cut behind the line — entrance shielded by the traverse — under a roll of tree-trunk
// logs, half a metre of soil and cut branches. The DEM carve supplies the excavation
// depression; the works on top complete the 1.5m+ floor-to-crest profile.
function trenchLayout(at, axis = 'x', side = 1, label = 'TRENCH') {
  // u runs along the frontage, v across it; `side` flips which way the middle bay jogs
  // and puts the dugout on the opposite (sheltered) side.
  const bays = [
    { u0: -9, u1: -2.6, v: 0 },
    { u0: -2.6, u1: 3.6, v: 2.3 * side },
    { u0: 3.6, u1: 9, v: 0 },
  ];
  const traverses = [
    { u: -2.6, v0: 0, v1: 2.3 * side },
    { u: 3.6, v0: 0, v1: 2.3 * side },
  ];
  const dugout = { u: -6.2, v: -3.4 * side, sap: { u: -6.2, v0: 0, v1: -3.4 * side } };
  const toWorld = (u, v) => (axis === 'x'
    ? [at[0] + u, at[1] + v] : [at[0] + v, at[1] + u]);
  return { at, axis, side, label, bays, traverses, dugout, toWorld };
}

// Every trench sits ON a shelterbelt line (BASE_BELTS/DEEP_BELTS below), dug along the
// wood so the surviving tree row screens it. Siting stays clear of every road and rail
// right-of-way, authored vehicle route (including the ±22 offset presentation variants)
// and settlement yard.
const BASE_TRENCHES = [
  trenchLayout([150, 90], 'x', 1, 'EAST TRENCH'),
  trenchLayout([-165, 265], 'x', -1, 'WEST TRENCH'),
  trenchLayout([-255, 305], 'x', -1, 'NORTH BELT TRENCH'),
  trenchLayout([-200, -35], 'x', 1, 'SOUTH BELT TRENCH'),
];
const DEEP_TRENCHES = [
  trenchLayout([200, -381], 'x', -1, 'RAIL TRENCH'),
  trenchLayout([-82, -640], 'z', 1, 'GULLY TRENCH'),
  trenchLayout([-200, -938], 'x', 1, 'WOODLINE TRENCH'),
  trenchLayout([-250, -381], 'x', 1, 'WEST STEPPE TRENCH'),
  trenchLayout([60, -780], 'z', -1, 'EAST HEDGE TRENCH'),
  trenchLayout([170, -937], 'x', 1, 'KOLKHOZ BELT TRENCH'),
  trenchLayout([-260, -1149], 'x', 1, 'FAR BELT TRENCH'),
];

function trenchTrace(layout) {
  const { bays, dugout, toWorld } = layout;
  const points = [
    toWorld(bays[0].u0, bays[0].v), toWorld(bays[0].u1, bays[0].v),
    toWorld(bays[1].u0, bays[1].v), toWorld(bays[1].u1, bays[1].v),
    toWorld(bays[2].u0, bays[2].v), toWorld(bays[2].u1, bays[2].v),
  ];
  return [
    { points, depth: 0.85 },
    { points: [toWorld(dugout.sap.u, dugout.sap.v0), toWorld(dugout.u, dugout.v)],
      depth: 1.05, half: 2.2, blend: 7 },
  ];
}

// One channel piece of trench works: dark excavated floor, plank revetments on both
// walls, pale fresh-spoil parapets outside them (solid — an airframe that clips a berm
// detonates in the dirt). Runs along `dir` ('u' = the frontage axis, 'v' = a traverse).
function trenchChannel(g, terrain, layout, uc, vc, length, dir) {
  const along = (layout.axis === 'x') === (dir === 'u');
  // Short sub-pieces, each grounded on its own terrain sample: a single 7m box on the
  // carved slope leaves one end floating and buries the other.
  const pieces = Math.max(1, Math.ceil(length / 3));
  const step = length / pieces;
  for (let p = 0; p < pieces; p++) {
    const c = uc - length / 2 + step * (p + 0.5);
    const [wx, wz] = dir === 'u' ? layout.toWorld(c, vc) : layout.toWorld(uc, vc - length / 2 + step * (p + 0.5));
    const y0 = terrain(wx, wz);
    const B = (dy, sy, off, thickness, color, solid = false) => {
      g.push(along
        ? [wx, y0 + dy, wz + off, step + 0.25, sy, thickness, color, solid]
        : [wx + off, y0 + dy, wz, thickness, sy, step + 0.25, color, solid]);
    };
    B(0.03, 0.07, 0, 1.4, 0x282b20);                      // excavated floor
    for (const s of [-1, 1]) {
      B(0.4, 0.72, s * 0.74, 0.09, 0x4a3d2a);             // plank revetment
      B(0.32, 0.62, s * 1.32, 1.0, 0x5a523d, true);       // spoil parapet
    }
  }
}

function trenchWorks(terrain, layout) {
  const g = [];
  for (const bay of layout.bays) {
    trenchChannel(g, terrain, layout,
      (bay.u0 + bay.u1) / 2, bay.v, Math.abs(bay.u1 - bay.u0) + 0.4, 'u');
  }
  for (const traverse of layout.traverses) {
    trenchChannel(g, terrain, layout,
      traverse.u, (traverse.v0 + traverse.v1) / 2,
      Math.abs(traverse.v1 - traverse.v0) + 1.4, 'v');
  }
  const { dugout } = layout;
  trenchChannel(g, terrain, layout,
    dugout.sap.u, (dugout.sap.v0 + dugout.sap.v1) / 2,
    Math.abs(dugout.sap.v1 - dugout.sap.v0), 'v');
  // The dugout: a 3x3 chamber under a roll of tree-trunk logs, soil, and cut branches.
  // The roof is solid — a drone cannot reach whoever is under the nakat, only whoever
  // is standing in an open bay. Same lesson as the barn, dug into the ground.
  const [dx, dz] = layout.toWorld(dugout.u, dugout.v);
  const dy = terrain(dx, dz);
  const logAlong = layout.axis === 'x';
  for (let log = 0; log < 6; log++) {
    const off = (log - 2.5) * 0.56;
    const tone = log % 2 ? 0x4a3b28 : 0x423424;
    g.push(logAlong
      ? [dx + off, dy + 0.62, dz, 0.52, 0.3, 3.5, tone, true]
      : [dx, dy + 0.62, dz + off, 3.5, 0.3, 0.52, tone, true]);
  }
  g.push([dx, dy + 0.92, dz, 3.2, 0.32, 3.2, 0x50483a, true]);   // soil cover
  g.push([dx + 0.4, dy + 1.12, dz - 0.3, 2.6, 0.14, 2.2, 0x36402a, false]); // branches
  g.push([dx - 0.7, dy + 1.1, dz + 0.8, 1.8, 0.12, 1.6, 0x3d4630, false]);
  // Sandbagged fire steps at the outer bay ends.
  const ends = [layout.toWorld(layout.bays[0].u0 + 1, layout.bays[0].v - 2.1 * layout.side),
    layout.toWorld(layout.bays[2].u1 - 1, layout.bays[2].v - 2.1 * layout.side)];
  for (const [sx, sz] of ends) {
    g.push(...lift(sandbags(sx, sz, 4, 2, layout.axis === 'z', 5), terrain(sx, sz)));
  }
  return g;
}

// Garrison walk path for the ambient population: an ORDERED polyline down the slot —
// dugout mouth, bay, traverse corners, bay — so a man moving between posts follows the
// dug line instead of clipping through a parapet corner.
function trenchPosts(layout) {
  const [b0, b1, b2] = layout.bays;
  return [
    layout.toWorld(layout.dugout.sap.u, layout.dugout.sap.v1 * 0.55),
    layout.toWorld(layout.dugout.sap.u, 0),
    layout.toWorld((b0.u0 + b0.u1) / 2, b0.v),
    layout.toWorld(b0.u1, b0.v),
    layout.toWorld(b1.u0, b1.v),
    layout.toWorld((b1.u0 + b1.u1) / 2, b1.v),
    layout.toWorld(b1.u1, b1.v),
    layout.toWorld(b2.u0, b2.v),
    layout.toWorld((b2.u0 + b2.u1) / 2, b2.v),
  ];
}

// People behind the launch line remain scenery. Hostile trench occupants never satisfy
// the assigned vehicle task: garrison fire teams are optional strike targets, ambient
// walkers are scenery that happens to be standing in a hole.
const FARM_SCENERY = [
  { at: [-190, 395], r: 13, count: 2, faction: 'friendly' },
];

const trenchOpportunity = (layout, label, team = 3, yaw = 0) => ({
  kind: 'infantry', label, optional: true, team, yaw: 0,
  pos: [layout.at[0], 0, layout.at[1]],
  // Explicit figure offsets: one man per fire bay, standing in the dug slot instead of
  // scattered across his own parapet. `yaw` seeds the facing variety only.
  figures: layout.bays.slice(0, team).map((bay, index) => [
    (bay.u0 + bay.u1) / 2 + (index - 1) * 0.6, bay.v, yaw + index * 2.3,
  ]).map(([u, v, facing]) => {
    const [wx, wz] = layout.toWorld(u, v);
    return [wx - layout.at[0], wz - layout.at[1], facing];
  }),
  killMessage: `${label} WAS A TARGET OF OPPORTUNITY — ASSIGNED TASK STILL ACTIVE.`,
});

// Which trenches are manned is rolled fresh for every level build. The dug line is
// permanent — the DEM carve and the works never move — but the men in it change:
// roughly a third of the lines stand empty, a quarter carry one or two soldiers
// drifting between posts (ambient scenery, killable but unscored beyond the blast),
// and the rest mount a fire team the player can spend an airframe on. A guaranteed
// minimum of two garrisons per map keeps every sortie offering optional trench
// targets (and keeps the QA harness honest).
function trenchRoster(deep) {
  const layouts = deep ? [...BASE_TRENCHES, ...DEEP_TRENCHES] : BASE_TRENCHES;
  const states = layouts.map(() => {
    const roll = Math.random();
    return roll < 0.35 ? 'empty' : roll < 0.6 ? 'ambient' : 'garrison';
  });
  const ensureGarrisons = (from, to, want) => {
    let have = states.slice(from, to).filter(state => state === 'garrison').length;
    while (have < want) {
      const pick = from + Math.floor(Math.random() * (to - from));
      if (states[pick] !== 'garrison') { states[pick] = 'garrison'; have++; }
    }
  };
  ensureGarrisons(0, BASE_TRENCHES.length, 2);
  if (deep) ensureGarrisons(BASE_TRENCHES.length, layouts.length, 2);
  return {
    population: layouts.flatMap((layout, index) => (states[index] === 'ambient'
      ? [{ posts: trenchPosts(layout), count: 1 + (Math.random() < 0.5 ? 1 : 0) }]
      : [])),
    opportunities: layouts.flatMap((layout, index) => (states[index] === 'garrison'
      ? [trenchOpportunity(layout, `${layout.label} FIRE TEAM`,
        2 + (Math.random() < 0.65 ? 1 : 0), Math.random() * Math.PI * 2)]
      : [])),
  };
}

carveTrenchLine(DEEP_FENCE_TERRAIN,
  [...BASE_TRENCHES, ...DEEP_TRENCHES].flatMap(trenchTrace));

// A fuelcar's wheels (radius 0.34, axle at 0.55) bottom out 0.21 above its origin; this
// authored y offset puts them on the railhead instead of sinking the bogies in ballast.
const WAGON_LIFT = Math.round((RAIL_TOP - 0.21) * 100) / 100;
const MPU = 3.5;
const TRAINING_BOUNDS = [-720, 505, 720, -935];
const TRAINING_AREA = [-330, 500, 330, -650];
const TRAINING_ROADS = [
  [-6, 505, -6, -935], [-720, 330, 720, 330], [-720, 150, 720, 150],
  [-720, -120, 720, -120],
];
const TRAINING_WOODS = [
  [-220, 428, -18, 430], [18, 430, 220, 428],
  [-280, 305, -70, 305], [-280, 265, -70, 265],
  [65, 90, 285, 90], [-285, -35, -60, -35],
];

// Every paved run reaches the DEM margin or a junction — roads go somewhere, which is
// also what lets this rectangle tile into a larger battle space later. The narrow dirt
// runs are field tracks along the shelterbelts, the section-road grid of the steppe.
const DIRT = [84, 76, 58];
const track = (points) => ({ points, width: 3, surface: DIRT });
const BASE_ROADPAINT = [
  { points: [[-6, 870], [-6, -935]], width: 8 },
  { points: [[-810, 330], [810, 330]], width: 8 },
  { points: [[-810, 150], [810, 150]], width: 8 },
  { points: [[-810, -120], [810, -120]], width: 7 },
  track([[-810, 437], [810, 437]]),
  track([[-810, 285], [-6, 285]]),
  track([[-6, 98], [810, 98]]),
  track([[-810, -27], [-6, -27]]),
];
const DEEP_ROADPAINT = [
  { points: [[-6, 870], [-6, -1870]], width: 8 },
  { points: [[-810, 330], [810, 330]], width: 8 },
  { points: [[-810, 150], [810, 150]], width: 8 },
  { points: [[-810, -120], [810, -120]], width: 7 },
  { points: [[-810, -700], [810, -700]], width: 9 },
  { points: [[150, -700], [150, -1870]], width: 9 },
  track([[-810, 437], [810, 437]]),
  track([[-810, 285], [-6, 285]]),
  track([[-6, 98], [810, 98]]),
  track([[-810, -27], [-6, -27]]),
  track([[-810, -370], [810, -370]]),
  track([[-810, -928], [810, -928]]),
  track([[-92, -370], [-92, -928]]),
  track([[50, -370], [50, -928]]),
  track([[-810, -1138], [150, -1138]]),
];

// Dirt tracks end at the asphalt edge instead of painting over it. Every field-track
// run is clipped out of each paved corridor it crosses, so a crossing reads as a track
// meeting a road, never gravel smeared across the pavement.
function nearRun(x, z, pts, r) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1,
      ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < r) return true;
  }
  return false;
}

function clipTracks(runs) {
  const paved = runs.filter(r => (r.width ?? 7) >= 5);
  const out = [];
  for (const run of runs) {
    if ((run.width ?? 7) >= 5) { out.push(run); continue; }
    for (let i = 0; i < run.points.length - 1; i++) {
      const [ax, az] = run.points[i], [bx, bz] = run.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 2));
      const at = (t) => [ax + (bx - ax) * t, az + (bz - az) * t];
      let start = null;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const [x, z] = at(t);
        const blocked = paved.some(p => nearRun(x, z, p.points, (p.width ?? 7) / 2 + 1));
        if (!blocked && start === null) start = t;
        if ((blocked || k === n) && start !== null) {
          const end = blocked ? (k - 1) / n : t;
          if ((end - start) * len > 6) out.push({ ...run, points: [at(start), at(end)] });
          start = null;
        }
      }
    }
  }
  return out;
}

// Shelterbelts: the old single-file box rows become 10m-wide two-row belts with a scrub
// base (see trees.js). Same lines the minimap woods entries draw.
const BASE_BELTS = [
  { kind: 'belt', from: [-220, 428], to: [-18, 430] },
  { kind: 'belt', from: [18, 430], to: [220, 428] },
  { kind: 'belt', from: [-280, 305], to: [-70, 305] },
  { kind: 'belt', from: [-280, 265], to: [-70, 265] },
  { kind: 'belt', from: [65, 90], to: [285, 90] },
  { kind: 'belt', from: [-285, -35], to: [-60, -35] },
];
const DEEP_BELTS = [
  { kind: 'belt', from: [-330, -382], to: [-70, -378] },
  { kind: 'belt', from: [60, -378], to: [330, -384] },
  { kind: 'belt', from: [-330, -940], to: [-60, -936] },
  { kind: 'belt', from: [110, -936], to: [330, -940] },
  { kind: 'belt', from: [-84, -430], to: [-80, -880] },
  { kind: 'belt', from: [62, -560], to: [58, -1000] },
  { kind: 'belt', from: [-330, -1150], to: [-30, -1146] },
];

// Nothing may grow on the OP pad or block the launch line.
const OP_PAD_AVOID = { points: [[0, 444], [0, 482]], half: 28 };

// The built half of the map: lone farms on the training range, and on the deep map the
// shelled village the EW mast sits in, the kolkhoz the BTR patrols, and a crossroads
// hamlet at the -700 junction. Positions match the deep missions' authored minimap
// `places` footprints — the buildings the briefs always implied are now standing.
const BASE_FARMS = [{ at: [-190, 395] }, { at: [200, 55] }];
const DEEP_SETTLEMENTS = [
  { at: [-14, -527], r: 44, count: 8, ruin: 0.75 },   // village around the EW mast
  { at: [134, -1030], r: 42, count: 4, ruin: 0.5 },   // the kolkhoz
  { at: [150, -700], r: 34, count: 4, ruin: 0.8 },    // shelled crossroads hamlet
];
// Authored off-road vehicle paths and parked hulls: no building may stand on them.
const DEEP_CLEARWAYS = [
  { points: [[80, -700], [-6, -520], [-180, -520]], half: 8 },            // tank reaction
  { points: [[134, -1030], [104, -1000], [150, -1000], [150, -1060], [134, -1030]], half: 8 },
  { points: [[150, -1060], [20, -1145], [-160, -1145]], half: 8 },        // BTR reaction
  { at: [115, -680], r: 10 },                                             // decoy tank
  { at: [105, -1010], r: 8 },                                             // farm truck
  { at: [-11, -524], r: 7 },                                              // village EW mast
  { at: [176, -714], r: 9 },                                              // crossroads dismount post
  { at: [110, -1052], r: 9 },                                             // kolkhoz security detail
];

function hamletPlanFor(roadPaint, railLines, deep) {
  const avoid = [...rightOfWay(roadPaint, railLines), OP_PAD_AVOID,
    ...(deep ? DEEP_CLEARWAYS : [])];
  return {
    settlements: deep ? DEEP_SETTLEMENTS : [],
    farms: BASE_FARMS,
    roads: roadPaint,
    avoid,
  };
}

// Every corridor a mission vehicle can actually drive — authored routes, reaction
// routes, the moving range's offset presentation variants — plus every parked hull.
// Trees and roadside scrub must clear them: a truck ploughing through a hedge is a
// planting bug, not a tactic.
function vehicleClearways(objectives) {
  const clearways = [];
  const flat = point => [point[0], point.length > 2 ? point[2] : point[1]];
  for (const phaseDef of objectives) {
    for (const step of phaseDef.steps || [phaseDef]) {
      for (const vehicle of step.vehicles || []) {
        const routes = [vehicle.route, vehicle.reaction?.route,
          ...(vehicle.variants || []).map(variant => variant.route)];
        for (const route of routes) {
        if (route?.length > 1) clearways.push({
          points: route.map(flat), half: vehicle.kind === 'infantry' ? 1.5 : 6,
        });
        }
        for (const pos of [vehicle.pos, ...(vehicle.positions || []),
          ...(vehicle.variants || []).map(variant => variant.pos)]) {
          if (pos) clearways.push({ at: flat(pos), r: vehicle.kind === 'infantry' ? 2 : 6 });
        }
      }
    }
  }
  return clearways;
}

function treePlanFor(roadPaint, railLines, deep, hamletPlan, routeAvoid = []) {
  // Plants also clear the settlement yards — a birch through a roof is not a look.
  const yardAvoid = [
    ...(hamletPlan?.settlements || []).map(s => ({ at: s.at, r: (s.r ?? 38) + 12 })),
    ...(hamletPlan?.farms || []).map(f => ({ at: f.at, r: 26 })),
  ];
  // The digging kept the trunks out of the works themselves and nothing more: the
  // avoid footprint hugs the dug slot, parapets and dugout, so the belt's surviving
  // row stands right at the lip and its canopy closes over the trench. Finding the
  // line means looking through trees, and striking it means flying down through them.
  const trenchAvoid = (deep ? [...BASE_TRENCHES, ...DEEP_TRENCHES] : BASE_TRENCHES)
    .flatMap(layout => [
      { points: [layout.toWorld(-10.5, layout.side * 1.15),
        layout.toWorld(10.5, layout.side * 1.15)], half: 4.6 },
      { at: layout.toWorld(layout.dugout.u, layout.dugout.v), r: 3.6 },
    ]);
  return {
    stands: [
      ...(deep ? [...BASE_BELTS, ...DEEP_BELTS] : BASE_BELTS),
      ...hedgeStands(roadPaint, railLines),
    ],
    avoid: [...rightOfWay(roadPaint, railLines), OP_PAD_AVOID, ...yardAvoid,
      ...trenchAvoid, ...routeAvoid],
  };
}

const lesson = (title, body, highlight) => ({ title, body, ...(highlight ? { highlight } : {}) });

function fpv(definition = {}) {
  return {
    type: 'drone', mode: 'fpv', noHandoff: true,
    label: 'VMS-7 KESTREL', launch: [6, 0, 455], yaw: 0,
    metersPerUnit: MPU, maxRange: 1700, airframes: 3,
    ceiling: 55, maxSpeed: 18, accel: 24, batterySeconds: 660,
    ...definition,
    training: { openRange: true, acquireRange: 95, commitRange: 38, ...(definition.training || {}) },
  };
}

function bomber(definition = {}) {
  return {
    type: 'drone', mode: 'bomber', noHandoff: true,
    label: 'HW-16 HERON', launch: [-3, 0, 455], yaw: 0,
    metersPerUnit: MPU, maxRange: 1900, airframes: 1,
    ceiling: 95, maxSpeed: 10, accel: 12, batterySeconds: 720,
    thermalPersistent: true, fov: 84,
    ...definition,
    training: { openRange: true, acquireRange: 120, commitRange: 55, ...(definition.training || {}) },
  };
}

function trainingMap(overrides = {}) {
  return {
    bounds: TRAINING_BOUNDS,
    opArea: TRAINING_AREA,
    roads: TRAINING_ROADS,
    woods: TRAINING_WOODS,
    rail: [[245, 505, 245, -935]],
    places: [],
    ...overrides,
  };
}

function droneFieldGeo(seed, options = {}, treePlan = null, treeSeed = 0, hamletPlan = null) {
  const g = [];
  const terrain = terrainSampler(DEEP_FENCE_TERRAIN);

  g.push(...floorSlab(0, 462, 40, 32, terrain(0, 462), 1, 0x4a4636));
  // The visible forest and villages are merged meshes built by main.js from the level's
  // treePlan/hamletPlan. What the box world needs from them is the mass: one slim
  // invisible solid per trunk (leaves stay soft), one per building footprint.
  if (treePlan) {
    g.push(...treeTrunkColliders(DEEP_FENCE_TERRAIN, treePlan, treeSeed));
  }
  // The fortification works draped into their carved depressions along the wood lines.
  for (const layout of (options.deep ? [...BASE_TRENCHES, ...DEEP_TRENCHES] : BASE_TRENCHES)) {
    g.push(...trenchWorks(terrain, layout));
  }
  if (hamletPlan) {
    g.push(...hamletColliders(DEEP_FENCE_TERRAIN, hamletPlan, treeSeed));
  }
  for (const [jx, jz] of options.jammers || []) {
    const y = terrain(jx, jz);
    g.push([jx, y + 2.6, jz, 1.1, 5.2, 1.1, 0x3a3f3a]);
    g.push([jx, y + 5.5, jz, 2.4, 0.5, 0.6, 0x2c3130]);
  }
  // The track itself is no longer boxed here: railLines on the level def drapes the
  // ballast, ties and rails onto the carved formation (see buildRailLine in terrain.js).
  const opY = terrain(0, 462);
  g.push(...lift(floorSlab(0, 462, 26, 14, 0.02, 0.5, 0x413d31), opY));
  g.push(...lift([...sandbags(-6, 452, 6, 2, false, seed), ...sandbags(7, 452, 5, 2, false, seed + 1)], opY));
  g.push(...lift([...table(-3, 461, 2.6, 1.1, 0x554a38), ...table(3.4, 461, 1.8, 1, 0x4c4234)], opY));
  g.push([0, opY + 4.4, 460, 30, 0.18, 16, 0x36402e, false]);
  for (const [x, z] of [[-14, 454], [14, 466], [-14, 466], [14, 454]]) {
    g.push([x, opY + 2.2, z, 0.22, 4.4, 0.22, 0x453727, false]);
  }
  if (options.deep) {
    for (let z = 420; z > -1400; z -= 210) {
      g.push(...lift(poleWire(-16, z, -16, z - 210, 7.2, 6), terrain(-16, z - 105)));
    }
  }
  return g;
}

function pointSegmentDistance(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1,
    ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

function treeCoverRoute(route, placements, wanted = 4) {
  const usable = placements.filter(tree => tree.species !== 'shrub')
    .map(tree => ({
      tree,
      distance: Math.min(...route.slice(1).map((point, index) =>
        pointSegmentDistance(tree.x, tree.z, route[index], point))),
    }))
    .filter(candidate => candidate.distance < 10)
    .sort((a, b) => a.tree.x - b.tree.x);
  if (!usable.length) return route;
  const selected = [];
  for (let index = 0; index < wanted; index++) {
    const candidate = usable[Math.round(index * (usable.length - 1) / Math.max(1, wanted - 1))];
    if (candidate && !selected.includes(candidate)) selected.push(candidate);
  }
  return selected.flatMap(({ tree }, index) => {
    const radius = 1.25 + (index % 2) * 0.25;
    const direction = index % 2 ? -1 : 1;
    return [0, 1, 2, 3].map(step => {
      const angle = direction * step * Math.PI / 2 + index * 0.63;
      return [tree.x + Math.cos(angle) * radius, tree.z + Math.sin(angle) * radius];
    });
  });
}

function buildingRunnerRoute(building, requested, placements) {
  const cu = Math.cos(building.yaw), su = Math.sin(building.yaw);
  const at = (u, v) => [building.x + u * cu - v * su, building.z + u * su + v * cu];
  const front = -building.D / 2;
  const outside = front - 2.1;
  const cornerU = building.L / 2 + 1.8;
  const cornerV = building.D / 2 + 1.8;
  const door = building.doorU;
  const interiorSide = Math.max(1.2, building.L * 0.28);
  const route = [
    at(-interiorSide, 0.45), at(interiorSide, 0.45),
    at(door, front + 1.0), at(door, outside),
    at(-cornerU, outside), at(-cornerU, cornerV),
  ];

  if (requested.woodline) {
    const [cx, cz] = requested.woodline;
    const covers = placements.filter(tree => tree.species !== 'shrub')
      .sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))
      .slice(0, 3);
    for (const [index, tree] of covers.entries()) {
      const r = 1.3 + index * 0.12;
      route.push(
        [tree.x + r, tree.z], [tree.x, tree.z + r],
        [tree.x - r, tree.z], [tree.x, tree.z - r],
      );
    }
    // Return on the same clear exterior approach. Connecting the last tree straight to
    // the door could cut diagonally through the barn depending on its seeded rotation.
    route.push(at(-cornerU, cornerV), at(-cornerU, outside));
  } else {
    route.push(at(cornerU, cornerV), at(cornerU, outside));
  }

  if (requested.vehicleOrbit) {
    const center = at(door + 1.5, front - 6.5);
    route.push(
      [center[0] + 3.0 * cu, center[1] + 3.0 * su],
      [center[0] - 3.0 * su, center[1] + 3.0 * cu],
      [center[0] - 3.0 * cu, center[1] - 3.0 * su],
      [center[0] + 3.0 * su, center[1] - 3.0 * cu],
    );
  }
  route.push(at(door, outside), at(door, front + 1.0), at(interiorSide, 0.45));
  return route;
}

function routePresentations(route, speed, starts = [0, 1, 2]) {
  return starts.map(start => {
    const rotated = [...route.slice(start), ...route.slice(0, start)];
    return { pos: [rotated[0][0], 0, rotated[0][1]], route: rotated, speed };
  });
}

function droneLevel(id, name, brief, objectives, options = {}) {
  const deep = !!options.geo?.deep;
  const roadPaint = clipTracks(options.roadPaint || (deep ? DEEP_ROADPAINT : BASE_ROADPAINT));
  const railLines = deep ? [...TRAINING_RAIL, ...DEEP_RAIL] : TRAINING_RAIL;
  const hamletPlan = hamletPlanFor(roadPaint, railLines, deep);
  const treePlan = treePlanFor(roadPaint, railLines, deep, hamletPlan,
    vehicleClearways(objectives));
  const buildings = hamletLayout(hamletPlan, id);
  const treeCovers = treePlacements(treePlan, id);
  // One occupancy roll per level build: within a mission the same trenches stay manned
  // across sorties, but the next session's build rolls again.
  const roster = trenchRoster(deep);
  const resolvedObjectives = objectives.map(phaseDef => ({
    ...phaseDef,
    steps: (phaseDef.steps || [phaseDef]).map(step => ({
      ...step,
      // Rear-area friendlies and this build's ambient trench walkers remain scenery.
      // Rolled trench garrisons are appended to every sortie as optional targets:
      // killing one scores, but never advances the assigned task.
      ...(step.type === 'drone' && ['fpv', 'bomber'].includes(step.mode) && !step.population
        ? { population: [...FARM_SCENERY, ...roster.population] } : {}),
      vehicles: [
        ...(step.vehicles || []),
        ...(step.type === 'drone' && ['fpv', 'bomber'].includes(step.mode)
          ? roster.opportunities : []),
      ].map(vehicle => {
        if (!vehicle.shelter) {
          if (vehicle.kind !== 'infantry' || vehicle.evasion?.style !== 'wooded') return vehicle;
          const route = treeCoverRoute(vehicle.route, treeCovers);
          return {
            ...vehicle, route,
            pos: [route[0][0], 0, route[0][1]],
            variants: routePresentations(route, vehicle.speed, [0, 4, 8]),
          };
        }
        const requested = vehicle.shelter;
        let matches = buildings.filter(building =>
          building.kind === (requested.kind || 'barn')
          && (!requested.state || building.state === requested.state)
          && (!requested.standing || building.state !== 'gutted'));
        if (!matches.length && requested.standing) {
          matches = buildings.filter(building => building.kind === (requested.kind || 'barn'));
        }
        if (requested.near) matches.sort((a, b) =>
          Math.hypot(a.x - requested.near[0], a.z - requested.near[1])
          - Math.hypot(b.x - requested.near[0], b.z - requested.near[1]));
        const building = matches[requested.index || 0];
        if (!building) {
          throw new Error(`Drone level ${id}: no ${requested.state || ''} ${requested.kind || 'barn'} for ${vehicle.label}`);
        }
        const u = requested.doorOffset !== undefined
          ? building.doorU + requested.doorOffset : (requested.u || 0);
        const v = requested.outsideFront !== undefined
          ? -building.D / 2 - requested.outsideFront : (requested.v || 0);
        const cu = Math.cos(building.yaw), su = Math.sin(building.yaw);
        const { positions: _positions, shelter: _shelter, ...rest } = vehicle;
        const runnerRoute = vehicle.kind === 'infantry' && requested.evasionRoute
          ? buildingRunnerRoute(building, requested, treeCovers) : null;
        return {
          ...rest,
          pos: runnerRoute
            ? [runnerRoute[0][0], 0, runnerRoute[0][1]]
            : [building.x + u * cu - v * su, 0, building.z + u * su + v * cu],
          ...(runnerRoute ? {
            route: runnerRoute,
            variants: routePresentations(runnerRoute, vehicle.speed),
            loop: true,
          } : {}),
          yaw: building.yaw + (requested.yawOffset || 0),
          shelter: {
            kind: building.kind, state: building.state,
            entry: requested.entry || (building.state === 'gutted' ? 'roof opening' : 'doorway'),
            x: building.x, z: building.z, yaw: building.yaw,
            L: building.L, D: building.D, H: building.H,
            doorU: building.doorU, doorW: building.doorW, doorH: building.doorH,
          },
        };
      }),
    })),
  }));
  return {
    id, name, brief,
    curriculum: options.curriculum || [],
    targetDuration: options.targetDuration || [600, 720],
    roadPaint,
    weapons: ['pistol'], grenades: 0, flashes: 0, squad: 0,
    lockPlayer: true, cameraFar: 3000,
    timeOfDay: options.timeOfDay || 'night',
    sky: options.sky ?? 0x2b2733,
    fog: options.fog || [options.sky ?? 0x35303c, 500, 2600],
    ambient: options.ambient ?? 0.8, sun: options.sun ?? 0.85,
    backdrop: 'rural', terrainDef: DEEP_FENCE_TERRAIN,
    railLines,
    treePlan,
    hamletPlan,
    minimap: options.minimap || trainingMap(),
    start: [0, 0, 462, 0],
    geo: () => droneFieldGeo(2000 + id * 31, options.geo || {}, treePlan, id, hamletPlan),
    doors: [], enemies: [], civilians: [], objectives: resolvedObjectives,
  };
}

const interceptRuns = [
  {
    id: 'cross-left', title: 'CROSSING LEFT TO RIGHT', speed: 3.4,
    pos: [-175, 0, 330], route: [[-175, 330], [175, 330]],
    lesson: lesson('LEAD THE CROSSING', 'Do not point at the truck. Put the aircraft where the truck and the warhead will arrive together.'),
  },
  { id: 'cross-right', title: 'CROSSING RIGHT TO LEFT', speed: 3.8, pos: [175, 0, 290], route: [[175, 290], [-175, 290]] },
  { id: 'approach', title: 'APPROACHING TARGET', speed: 4.6, pos: [0, 0, 20], route: [[0, 20], [0, 350]] },
  {
    id: 'receding', title: 'RECEDING TARGET', speed: 4.8,
    pos: [0, 0, 350], route: [[0, 350], [0, -80]],
    lesson: lesson('DO NOT TAIL-CHASE', 'A vehicle going away invites a battery-burning chase. Cross to a flank, fly the shorter line and meet it farther down the road.'),
  },
  { id: 'flank', title: 'OPEN FLANK INTERCEPT', speed: 5.2, pos: [-70, 0, 320], route: [[-70, 320], [-70, -120]] },
  {
    id: 'woodline-runner', title: 'WOODLINE RUNNER', kind: 'infantry', team: 1,
    label: 'WOODLINE RUNNER', health: 60, speed: 8.6, pos: [75, 0, 83],
    route: [[75, 83], [120, 96], [170, 84], [220, 98], [270, 83]], loop: true,
    evasion: { style: 'wooded', triggerRadius: 150, decisionMin: 0.42, decisionMax: 0.9 },
    lesson: lesson('FLASH, FLY, REACQUIRE', 'Use a brief thermal flash to pick the runner out of the trees, return to EO for branches and terrain, then anticipate the next gap instead of following the last heat image.'),
  },
  {
    id: 'farm-corners', title: 'FARMYARD CORNER PURSUIT', kind: 'infantry', team: 1,
    label: 'FARMYARD RUNNER', health: 60, speed: 8.2, pos: [200, 0, 55],
    route: [[200, 55], [205, 62]], loop: true,
    shelter: {
      kind: 'barn', standing: true, near: [200, 55], evasionRoute: true,
      vehicleOrbit: true,
    },
    evasion: { style: 'building', triggerRadius: 150, decisionMin: 0.38, decisionMax: 0.82 },
    supportVehicles: [
      { kind: 'technical', label: 'PARKED FARM TRUCK', health: 180,
        optional: true, hostile: false,
        shelter: { kind: 'barn', standing: true, near: [200, 55],
          doorOffset: 1.5, outsideFront: 6.5, yawOffset: 1.4 } },
    ],
  },
  { id: 'junction', title: 'TURN AT THE JUNCTION', speed: 5.1, pos: [-210, 0, 330], route: [[-210, 330], [-6, 330], [-6, 40]] },
  {
    id: 'farm-to-woods', title: 'BUILDING-TO-WOODS REACQUISITION',
    kind: 'infantry', team: 1, label: 'FARMSTEAD RUNNER', health: 60, speed: 8.8,
    pos: [-190, 0, 395], route: [[-190, 395], [-205, 425]], loop: true,
    shelter: {
      kind: 'barn', standing: true, near: [-190, 395], evasionRoute: true,
      woodline: [-205, 428],
    },
    evasion: { style: 'building-woods', triggerRadius: 165, decisionMin: 0.35, decisionMax: 0.76 },
  },
  {
    id: 'evaluation', title: 'RANDOMIZED INTERCEPT', speed: 6,
    pos: [-210, 0, -120], route: [[-210, -120], [190, -120]],
    variants: [
      { pos: [-210, 0, -120], route: [[-210, -120], [190, -120]], speed: 6.2 },
      { pos: [190, 0, -120], route: [[190, -120], [-210, -120]], speed: 7.1 },
      { pos: [-6, 0, 270], route: [[-6, 270], [-6, -150], [150, -150]], speed: 5.5 },
    ],
  },
];

function offsetPresentations(run) {
  const first = run.route[0];
  const last = run.route[run.route.length - 1];
  const dx = last[0] - first[0];
  const dz = last[1] - first[1];
  const length = Math.max(1, Math.hypot(dx, dz));
  const nx = -dz / length;
  const nz = dx / length;
  return [0, 22, -22].map(offset => ({
    pos: [run.pos[0] + nx * offset, run.pos[1], run.pos[2] + nz * offset],
    route: run.route.map(([x, z]) => [x + nx * offset, z + nz * offset]),
    speed: run.speed,
  }));
}

function runnerPresentations(run) {
  const offsets = [0, Math.floor(run.route.length / 3), Math.floor(run.route.length * 2 / 3)];
  return offsets.map(start => {
    const route = [...run.route.slice(start), ...run.route.slice(0, start)];
    return { pos: [route[0][0], 0, route[0][1]], route, speed: run.speed };
  });
}

const movingRangeObjectives = interceptRuns.map((run, index) => phase(
  `intercept-${index + 1}-${run.id}`,
  `${index + 1}/10 — ${run.title}`,
  [fpv({
    text: `${run.title} — BUILD THE INTERCEPT, THEN COMMIT.`,
    airframes: 2,
    lessons: run.lesson ? [run.lesson] : [],
    vehicles: [{
      kind: run.kind || (index === 9 ? 'default' : 'technical'),
      label: run.label || `RUN ${index + 1} TARGET`,
      health: run.health ?? (index === 9 ? 220 : 150), team: run.team,
      pos: run.pos, route: run.route, speed: run.speed, loop: run.loop ?? true,
      variants: run.variants || (run.kind === 'infantry' && !run.shelter
        ? runnerPresentations(run) : offsetPresentations(run)),
      shelter: run.shelter, evasion: run.evasion,
    }, ...(run.supportVehicles || [])],
    startMessage: `KAVUN — RUN ${index + 1}. ${run.title}. FLY THE MEETING POINT.`,
    result: `INTERCEPT RUN ${index + 1} COMPLETE`,
  })],
));

export const DRONE_TRAINING_LEVELS = [
  droneLevel(11, 'DRONARIUM',
    'Day range. Take control immediately, learn the essential on-screen flight display and place four live training strikes on static hulls. Handling first; everything else waits.',
    [
      phase('first-feed', 'COACHED HANDLING AND FLIGHT DISPLAY', [fpv({
        text: 'FLY THE FEED — TWO STATIC HULLS, CONTROLS AND FLIGHT DISPLAY.',
        airframes: 4,
        lessons: [
          lesson('CONTROL THE AIRFRAME', 'WASD sets the flight line. Mouse looks and turns. RMB or Z climbs; CTRL or C descends. Keep moving while you learn.', '.fpv-help'),
          lesson('READ THE FLIGHT DISPLAY', 'The on-screen display (OSD) shows heading, speed, distance, home direction, battery and link quality. Press N to flash the thermal channel on when searching for people or hot machinery, then return to EO for terrain detail. Thermal adds 22% battery load, so scan with it instead of leaving it on. Check the display during the route, not after the picture is already lost.', '.fpv-batt'),
        ],
        vehicles: [
          { kind: 'default', label: 'HANDLING HULL ONE', health: 180, pos: [-45, 0, 335], yaw: 0.4 },
          { kind: 'technical', label: 'HANDLING HULL TWO', health: 150, pos: [65, 0, 245], yaw: 2.3 },
        ],
        startMessage: 'KAVUN — AIRFRAME LIVE. FLY FIRST. THE FLIGHT DISPLAY WILL MAKE SENSE ON THE WAY.',
        result: 'COACHED HANDLING COMPLETE',
      })]),
      phase('handling-check', 'UNASSISTED HANDLING CHECK', [fpv({
        text: 'NO PROMPTS — FIND AND STRIKE TWO STATIC HULLS.', airframes: 3,
        vehicles: [
          { kind: 'artillery', label: 'CHECK HULL THREE', health: 180, pos: [-120, 0, 145], yaw: 1.1 },
          { kind: 'ew', label: 'CHECK HULL FOUR', health: 180, pos: [135, 0, 65], yaw: 4.2 },
        ],
        startMessage: 'KAVUN — SAME AIRFRAME, NO NEW LESSON. SHOW ME CONTROL AND BATTERY DISCIPLINE.',
        result: 'DRONARIUM HANDLING CERTIFIED',
      })]),
    ], {
      curriculum: ['basic handling', 'OSD and battery'],
      timeOfDay: 'day',
      sky: 0x78a9d2, fog: [0xb8c5bd, 650, 2800], ambient: 0.72, sun: 1.35,
    }),

  droneLevel(12, 'MOVING RANGE',
    'Ten live intercept repetitions: vehicle crossings and turns, then individual runners using farm buildings, wooded cover and broken lines of sight before one randomized final check.',
    movingRangeObjectives,
    { curriculum: ['moving-target interception', 'terminal attack aspect'] }),

  droneLevel(13, 'HEAVY HANDS',
    'The HERON carries a finite rack and comes home. Learn hover drops and inherited drift, then stop moving rolling stock without emptying the aircraft.',
    [
      phase('payload-coached', 'COACHED PAYLOAD RELEASE', [bomber({
        text: 'REQUIRED: HOVER-DROP TRUCK + DRIFT WAGON. FOUR BOMBS. STRIKE BOTH, THEN RETURN TO LAUNCH.', bombs: 4,
        training: { requireReturn: true, returnRadius: 14 },
        lessons: [
          lesson('PAYLOAD AND DRIFT', 'A bomb leaves with the aircraft’s movement. At 80° camera-down, NADIR LOCK appears and WASD becomes horizontal translation, so you can keep watching the target while correcting the release point.'),
          lesson('RANGE CONTROL', 'Both named vehicles are required targets. After each effect, Range Control will name what remains. After the final effect, follow the HOME arrow back inside the blue launch area.', '.fpv-batt'),
        ],
        vehicles: [
          { kind: 'technical', label: 'HOVER-DROP TRUCK', health: 150, pos: [-35, 0, 230], yaw: 0.5 },
          { kind: 'fuelcar', label: 'DRIFT WAGON', health: 220, pos: [245, WAGON_LIFT,80], yaw: Math.PI / 2 },
        ],
        startMessage: 'RANGE CONTROL — DESTROY HOVER-DROP TRUCK AND DRIFT WAGON. FOUR BOMBS. RETURN AFTER BOTH EFFECTS.',
        result: 'PAYLOAD BASICS COMPLETE',
      })]),
      phase('payload-check', 'UNASSISTED MOVING PAYLOAD CHECK', [bomber({
        text: 'REQUIRED: SERVICE-ROAD ESCORT + DIESEL LOCOMOTIVE + COUPLED FUEL TANKER. FIVE BOMBS. STRIKE ALL THREE, THEN RETURN TO THE FORWARD LZ—NOT THE OPERATIONS BUILDING.', bombs: 5,
        launch: [120, 0, 300],
        training: { requireReturn: true, returnRadius: 14, homeLabel: 'FORWARD LZ' },
        vehicles: [
          { kind: 'locomotive', label: 'DIESEL LOCOMOTIVE', health: 220, pos: [245, WAGON_LIFT,80], route: [[245, 80], [245, -420]], speed: 12 / 3.6, loop: true, consistId: 'range-train', stopsConsist: true, stopMessage: 'LOCOMOTIVE DISABLED; CONSIST STOPPED.' },
          { kind: 'fuelcar', label: 'FUEL TANKER', health: 220, pos: [245, WAGON_LIFT,91], route: [[245, 91], [245, -409]], speed: 12 / 3.6, loop: true, consistId: 'range-train' },
          { kind: 'technical', label: 'SERVICE-ROAD ESCORT', health: 150, pos: [190, 0, 130], route: [[190, 130], [190, -370]], speed: 4, loop: true },
        ],
        startMessage: 'RANGE CONTROL — YOU LAUNCH AND RECOVER AT THE FORWARD LZ: BLUE H-RING, HOT THERMAL BEACON. DO NOT RETURN TO THE OPERATIONS BUILDING. THREE REQUIRED VEHICLES; TRAIN SPEED 12 KM/H. KILLING THE LOCOMOTIVE STOPS THE CONSIST.',
        result: 'HEAVY PAYLOAD CERTIFIED',
      })]),
    ], {
      curriculum: ['bomber handling', 'payload drift and economy'], geo: { rail: true },
      roadPaint: [
        ...BASE_ROADPAINT,
        { points: [[190, 150], [190, -935]], width: 6 },
      ],
      minimap: trainingMap({ roads: [...TRAINING_ROADS, [190, 150, 190, -935]] }),
    }),

  droneLevel(14, 'BAD PICTURE',
    'The feed degrades before the control link does. Maintain orientation, use landmarks and finish the attack without treating every patch of static as a lost aircraft.',
    [
      phase('bad-picture-coached', 'COACHED DEGRADED FEED', [fpv({
        text: 'FOLLOW THE ROAD THROUGH CYCLING VIDEO NOISE.', videoDegrade: { cycle: 22, strength: 0.48 },
        lessons: [
          lesson('PICTURE IS NOT CONTROL', 'Snow and tearing can arrive while the sticks still answer. Use heading, home and large terrain shapes; do not surrender the aircraft to a bad image.', '.fpv-link'),
          lesson('RECOVER THE FEED', 'When quality collapses, reduce corrections, descend behind cover or turn out before the link becomes unrecoverable.'),
        ],
        vehicles: [
          { kind: 'technical', label: 'LOW-CONTRAST TRUCK', health: 150, pos: [-150, 0, 150], route: [[-150, 150], [150, 150]], speed: 4.2, loop: true },
        ],
        startMessage: 'KAVUN — THE CAMERA IS UGLY, NOT DEAD. KEEP FLYING THE INSTRUMENTS.',
        result: 'DEGRADED FEED FLOWN',
      })]),
      phase('bad-picture-check', 'UNASSISTED POOR-VISIBILITY CHECK', [fpv({
        text: 'TWO TARGETS IN POOR VIDEO — MAINTAIN THE LINK.', airframes: 3,
        videoDegrade: { cycle: 17, strength: 0.62, offset: 5 },
        vehicles: [
          { kind: 'default', label: 'DULL APC', health: 220, pos: [-160, 0, -120], route: [[-160, -120], [160, -120]], speed: 4.5, loop: true },
          { kind: 'technical', label: 'DULL TRUCK', health: 160, pos: [100, 0, 25], route: [[100, 25], [-160, 25]], speed: 5.2, loop: true },
        ],
        startMessage: 'KAVUN — NO CLEAN WINDOW PROMISED. ORIENT, ACQUIRE, COMMIT.',
        result: 'BAD-PICTURE CHECK COMPLETE',
      })]),
    ], { curriculum: ['degraded video', 'link management'] }),

  droneLevel(15, 'THE BUBBLE',
    'A captured jammer makes altitude and line of sight visible. Learn one masked approach, then choose whether to suppress the source or bypass it to reach the target.',
    [
      phase('bubble-demo', 'COACHED TERRAIN MASKING', [fpv({
        text: 'RUN THE GULLY TO THE JAMMER GENERATOR.',
        training: { linkLossGrace: 6 },
        lessons: [
          lesson('THE BUBBLE', 'The map circle is an estimate. When LINK QUALITY falls, turn away or put a ridge between the drone and the mast. This first field degrades control but will not cut the link completely.', '.fpv-map'),
          lesson('SOURCE AND EFFECT', 'This visible generator is the center of the interference. Destroying it removes the electronic effect; escaping its circle restores control.'),
        ],
        jammers: [{ id: 'range-ew', x: 20, z: 160, r: 175, linkedVehicle: 'range-ew', estimated: true, estimateX: 5, estimateZ: 175, estimateR: 210, signalFloor: 0.18, falloff: 0.8 }],
        vehicles: [{ kind: 'ew', label: 'RANGE JAMMER', targetId: 'range-ew', jammerId: 'range-ew', health: 180, pos: [20, 0, 160], yaw: 0.4 }],
        startMessage: 'KAVUN — CLIMB AND THE MAST SEES YOU. USE THE DARK GROUND ON THE MAP.',
        result: 'JAMMER SOURCE SUPPRESSED',
      })]),
      phase('bubble-check', 'UNASSISTED EW PENETRATION', [fpv({
        text: 'ONE EW SOURCE, ONE APC — SUPPRESS OR ROUTE AROUND.', airframes: 4,
        training: { linkLossGrace: 3.5 },
        jammers: [{ id: 'field-ew', x: -85, z: -110, r: 180, linkedVehicle: 'field-ew', estimated: true, estimateX: -60, estimateZ: -125, estimateR: 215, signalFloor: 0.04, falloff: 0.95 }],
        vehicles: [
          { kind: 'ew', label: 'FIELD JAMMER', targetId: 'field-ew', jammerId: 'field-ew', health: 180, pos: [-85, 0, -110], yaw: 1.3 },
          { kind: 'default', label: 'SCREENED APC', health: 220, pos: [145, 0, -210], route: [[145, -210], [-145, -210]], speed: 4.1, loop: true },
        ],
        startMessage: 'KAVUN — THE CIRCLE IS AN ESTIMATE. FLY THE LINK AND MAKE A CHOICE.',
        result: 'EW PENETRATION CERTIFIED',
      })]),
    ], { curriculum: ['jamming', 'terrain masking'], geo: { jammers: [[0, 60], [-85, -110]] } }),

  droneLevel(16, 'NAP OF THE EARTH',
    'Fly the same low terrain first on fibre, then on radio. Manage the paid-out line through broad terrain corridors before solving the familiar EW problem without guidance.',
    [
      phase('noe-coached', 'FIBRE-GUIDED TERRAIN RUN', [fpv({
        text: 'KEEP THE PAID-OUT LINE IN THE CYAN CORRIDOR. GIVE RED SNAG ZONES WIDE, OPEN TURNS.',
        airframes: 4, controlLink: 'fiber',
        training: {
          maxAgl: 18, fiberMaxLength: 520, fiberCorridor: 62,
          fiberRoute: [[6, 448], [48, 390], [58, 330], [34, 265], [18, 185]],
          fiberHazards: [
            { x: 104, z: 375, r: 25 },
            { x: -18, z: 304, r: 24 },
            { x: 78, z: 220, r: 24 },
          ],
        },
        minimap: trainingMap({
          route: [[6, 448], [48, 390], [58, 330], [34, 265], [18, 185]],
        }),
        jammers: [{ x: 0, z: 60, r: 240, estimated: true }],
        vehicles: [
          { kind: 'technical', label: 'GULLY TRUCK', health: 150, pos: [60, 0, 365], yaw: 1.2 },
          { kind: 'default', label: 'GULLY APC', health: 220, pos: [40, 0, 260], yaw: 2.6 },
        ],
        startMessage: 'KAVUN — CONNECTOR CHECK COMPLETE. FIBRE IS IMMUNE TO THE MAST; THE TERRAIN CAN STILL TAKE THE LINE. CYAN ROUTE, RED NO-GO.',
        result: 'FIBRE TERRAIN PROFILE FLOWN',
      })]),
      phase('noe-check', 'UNASSISTED ROAD AND WINDBREAK RUN', [fpv({
        text: 'MOVERS IN THE LANES — NO TRAINING FLAGS.', airframes: 4,
        training: { maxAgl: 20 },
        jammers: [{ x: -170, z: -80, r: 170, estimated: true }, { x: 120, z: -270, r: 165, estimated: true }],
        vehicles: [
          { kind: 'technical', label: 'LANE TRUCK', health: 150, pos: [-230, 0, 285], route: [[-230, 285], [-80, 285], [-6, 150], [190, 150]], speed: 4.7, loop: true },
          { kind: 'default', label: 'ROAD APC', health: 220, pos: [-6, 0, 40], route: [[-6, 40], [-6, -120], [180, -120]], speed: 4.2, loop: true },
        ],
        startMessage: 'KAVUN — RADIO CONTROL. NO CABLE AND NO TRAINING CORRIDOR; NOW THE MAST CAN TAKE THE LINK.',
        result: 'NAP-OF-THE-EARTH CERTIFIED',
      })]),
    ], { curriculum: ['fibre route management', 'radio terrain masking'], geo: { jammers: [[0, 60], [-170, -80], [120, -270]] } }),

  droneLevel(17, 'THE HUNT',
    'The report is stale and targets are using farm structures for concealment. Search likely hides, hold the picture long enough to identify, enter through a real opening and refuse the wrong strike.',
    [
      phase('hunt-coached', 'COACHED SEARCH AND IDENTIFICATION', [fpv({
        text: 'FIND THE REAL TRUCK INSIDE THE DAMAGED FARM BARN. IDENTIFY IT, CENTER THE DOORWAY AND CARRY THE ATTACK INSIDE.', airframes: 3,
        training: { identifyRange: 55, allowAbort: true },
        lessons: [
          lesson('INTELLIGENCE AGES', 'The red box is where the target was expected, not a live track. Search routes and likely hides.'),
          lesson('POSITIVE IDENTIFICATION', 'Hold the target in view long enough to confirm it. A visually similar vehicle is not permission to strike.'),
          lesson('ENTRY IS A FLIGHT GATE', 'The barn walls and roof are solid. Reduce speed before the threshold, center the open doorway and finish identification through the opening. Hitting the wall is a failed attack, not an indoor strike.'),
        ],
        vehicles: [
          { kind: 'technical', label: 'BARN-HIDDEN SUPPLY TRUCK', targetId: 'hunt-primary', health: 160, requiresIdentification: true, shelter: { kind: 'barn', state: 'damaged', entry: 'doorway' } },
          // The hide has a picket: a fire team on the barn's blind side. Optional credit —
          // the lesson stays the truck, but the farm no longer reads as abandoned.
          { kind: 'infantry', label: 'BARN SECURITY DETAIL', optional: true, team: 3, shelter: { kind: 'barn', state: 'damaged', u: 3.0, v: 5.4 } },
          { kind: 'technical', label: 'DECOY TRUCK', health: 80, decoy: true, pos: [80, 0, 150], yaw: 2.2 },
          { kind: 'default', label: 'ABANDONED APC', health: 100, decoy: true, pos: [-130, 0, 20], yaw: 4.1 },
        ],
        startMessage: 'KAVUN — THE VALID TRUCK IS USING A DAMAGED BARN. CONFIRM THROUGH THE OPEN DOOR, THEN FLY THE AIRFRAME INSIDE.',
        result: 'TARGET IDENTIFIED AND ENGAGED',
      })]),
      phase('hunt-check', 'UNASSISTED DISPLACED-TARGET CHECK', [fpv({
        text: 'STALE REPORT — LOCATE THE EW VEHICLE INSIDE A ROOFLESS BARN, IDENTIFY IT AND ATTACK THROUGH THE OPEN SHELL.', airframes: 3,
        training: { identifyRange: 52, allowAbort: true },
        vehicles: [
          { kind: 'ew', label: 'ROOFLESS-BARN EW VEHICLE', health: 180, requiresIdentification: true, shelter: { kind: 'barn', state: 'gutted', entry: 'roof opening' } },
          { kind: 'ew', label: 'COLD EW DECOY', health: 90, decoy: true, pos: [-60, 0, -115], yaw: 0.2 },
          { kind: 'technical', label: 'PROTECTED FARM TRUCK', hostile: false, protected: true, pos: [125, 0, 65], yaw: 3.3 },
        ],
        startMessage: 'KAVUN — THE REPORT SAYS A ROOFLESS FARM STRUCTURE. FIND THE OPEN SHELL, CONFIRM WHAT IS INSIDE, THEN CHOOSE YOUR ENTRY.',
        result: 'SEARCH AND IDENTIFICATION CERTIFIED',
      })]),
    ], { curriculum: ['search under stale intelligence', 'positive identification and abort'] }),

  droneLevel(18, 'BROKEN PLAN',
    'The primary corridor closes after launch. Read the changing EW picture, take the alternate route, retask or submit a valid abort instead of throwing away the aircraft.',
    [
      phase('broken-plan-coached', 'DYNAMIC EW AND CONTINGENCY ROUTE', [fpv({
        text: 'PRIMARY ROAD CLOSES — USE THE EASTERN ALTERNATE.', airframes: 3,
        training: { allowAbort: true },
        lessons: [
          lesson('THE PLAN WILL BREAK', 'A route is a hypothesis. Keep an alternate and a battery decision point before takeoff.'),
          lesson('DYNAMIC EW', 'This jammer cycles. A red area may open or close while you are committed; timing is part of the route.'),
        ],
        minimap: trainingMap({
          route: [[6, 448], [-6, 280], [-6, 40], [-120, -120]],
          alternateRoute: [[6, 448], [150, 300], [205, 90], [120, -120]],
        }),
        jammers: [{ x: -6, z: 30, r: 250, estimated: true, pulse: { on: 14, off: 8, offset: 8 } }],
        vehicles: [{ kind: 'default', label: 'RETASKED APC', health: 220, pos: [145, 0, -190], route: [[145, -190], [-140, -190]], speed: 4.5, loop: true }],
        startMessage: 'KAVUN — PRIMARY CORRIDOR IS CLOSING. EASTERN ALTERNATE OR ABORT.',
        result: 'CONTINGENCY ROUTE EXECUTED',
      })]),
      phase('broken-plan-check', 'UNASSISTED NO-GO DECISION', [fpv({
        text: 'EW SURGE — STRIKE IF THE WINDOW EXISTS, OTHERWISE ABORT.', airframes: 2,
        training: { allowAbort: true, abortCompletes: true },
        minimap: trainingMap({
          route: [[6, 448], [-120, 250], [-170, 30], [-120, -260]],
          alternateRoute: [[6, 448], [170, 260], [220, 10], [120, -260]],
        }),
        jammers: [
          { x: -80, z: 35, r: 230, estimated: true, pulse: { on: 18, off: 5 } },
          { x: 150, z: -145, r: 210, hidden: true, pulse: { on: 11, off: 7, offset: 4 } },
        ],
        vehicles: [{ kind: 'technical', label: 'SECONDARY SUPPLY TRUCK', health: 160, requiresIdentification: true, pos: [40, 0, -310], route: [[40, -310], [-190, -310]], speed: 5, loop: true }],
        startMessage: 'KAVUN — THIS ONE MAY BE A NO-GO. A CORRECT ABORT IS A TACTICAL RESULT.',
        result: 'BROKEN-PLAN DECISION ACCEPTED',
      })]),
    ], { curriculum: ['dynamic EW', 'alternate routes and valid aborts'], geo: { jammers: [[-6, 30], [-80, 35], [150, -145]] } }),

  droneLevel(19, 'GRADUATION',
    'A convoy reacts after the first impact. Stop the critical vehicles with a constrained strike allocation, then use the heavy bomber against the survivors.',
    [
      phase('graduation-fpv', 'STOP THE REACTIVE CONVOY', [fpv({
        text: 'FOUR AIRFRAMES — STOP THE COMMAND AND EW VEHICLES.', airframes: 4,
        lessons: [
          lesson('EFFECT, NOT BODY COUNT', 'The commander needs the convoy stopped. Prioritize the vehicles that preserve movement and electronic protection.'),
          lesson('THE ENEMY REACTS', 'After the first strike, survivors accelerate and change route. Your next plan begins with the first explosion.'),
        ],
        jammers: [{ id: 'grad-ew', x: -75, z: -165, r: 195, linkedVehicle: 'grad-ew', estimated: true }],
        vehicles: [
          { kind: 'ew', label: 'CONVOY EW', targetId: 'grad-ew', jammerId: 'grad-ew', health: 180, pos: [-210, 0, -120], route: [[-210, -120], [210, -120]], speed: 4.6, loop: true, reaction: { speedMultiplier: 1.35, route: [[210, -120], [210, 150], [-180, 150]] } },
          { kind: 'default', label: 'COMMAND APC', health: 220, requiresIdentification: true, pos: [-170, 0, -145], route: [[-170, -145], [210, -145]], speed: 4.4, loop: true, reaction: { speedMultiplier: 1.4, route: [[210, -145], [80, 330], [-190, 330]] } },
          { kind: 'technical', label: 'LOW-VALUE CARGO', health: 150, optional: true, pos: [-130, 0, -170], route: [[-130, -170], [210, -170]], speed: 4.2, loop: true, reaction: { speedMultiplier: 1.5 } },
        ],
        startMessage: 'KAVUN — FOUR FRAMES. EW AND COMMAND MATTER MORE THAN THE CARGO.',
        result: 'CONVOY STOPPED UNDER REACTION',
      })]),
      phase('graduation-bomber', 'PAYLOAD ECONOMY UNDER EW', [bomber({
        text: 'FIVE BOMBS — FINISH THE ROLLING STOCK UNDER CYCLING EW.', bombs: 5,
        jammers: [{ x: -75, z: -165, r: 195, estimated: true, pulse: { on: 10, off: 8 } }],
        vehicles: [
          { kind: 'fuelcar', label: 'SUPPLY WAGON ONE', health: 220, pos: [245, WAGON_LIFT,-210], route: [[245, -210], [245, -520]], speed: 3, loop: true },
          { kind: 'fuelcar', label: 'SUPPLY WAGON TWO', health: 220, pos: [245, WAGON_LIFT,-250], route: [[245, -250], [245, -560]], speed: 3, loop: true },
          { kind: 'technical', label: 'ESCORT TRUCK', health: 150, pos: [190, 0, -120], route: [[190, -120], [-170, -120]], speed: 4.7, loop: true },
        ],
        startMessage: 'KAVUN — FIVE BOMBS, THREE REQUIRED EFFECTS. GRADUATE WITH A RESERVE.',
        result: 'TACTICAL DRONE GRADUATION COMPLETE',
      })]),
    ], { curriculum: ['reactive targets', 'airframe and payload economy'], geo: { rail: true, jammers: [[-75, -165]] } }),

  droneLevel(20, 'DEEP FENCE',
    'First operational evaluation: plan from imperfect intelligence, identify the real targets, manage live EW, strike a reacting echelon and submit BDA after every sortie.',
    [
      phase('deep-armor', 'LOCATE AND STOP THE PATROL TANK', [fpv({
        text: 'REPORTED CAGED TANK — CONFIRM THE REAL VEHICLE AND SELECT AN ASPECT.',
        maxRange: 2700, airframes: 3, training: { identifyRange: 58, allowAbort: true },
        lessons: [
          lesson('PLAN BEFORE COMMITMENT', 'Treat the report and EW circle as estimates. Read the ground, choose a primary route and keep one alternate before crossing the departure line.'),
          lesson('REPORT THE EFFECT', 'A hit is not the end of the sortie. Preserve enough observation to distinguish mobility kill, protection defeat, decoy or miss, then submit the BDA you can actually support.'),
        ],
        jammers: [{ id: 'village-ew', x: -11, z: -524, r: 205, linkedVehicle: 'village-ew', estimated: true, estimateX: 20, estimateZ: -500, estimateR: 245 }],
        vehicles: [
          { kind: 'tank', label: 'T-72B3 PATROL', cage: true, health: 500, requiresIdentification: true, pos: [-120, 0, -700], route: [[-120, -700], [80, -700]], speed: 3.2, loop: true, reaction: { speedMultiplier: 1.35, route: [[80, -700], [-6, -520], [-180, -520]] } },
          { kind: 'tank', label: 'TANK DECOY', cage: true, health: 120, decoy: true, pos: [115, 0, -680], yaw: 0.3 },
          { kind: 'ew', label: 'VILLAGE EW', targetId: 'village-ew', jammerId: 'village-ew', health: 180, optional: true, pos: [-11, 0, -524], yaw: 1.2 },
          // Dismounts on the ground the briefs imply: a team dug in around a burned-out
          // APC at the shelled crossroads, and an OP in a gutted cottage shell.
          { kind: 'infantry', label: 'CROSSROADS DISMOUNT POST', optional: true, team: 4, pos: [176, 0, -714], yaw: 2.1, cover: { kind: 'apc', yaw: 0.4 } },
          { kind: 'infantry', label: 'RUIN OBSERVATION TEAM', optional: true, team: 2, shelter: { kind: 'khata', state: 'gutted', u: 0, v: -3.8 } },
        ],
        startMessage: 'OPERATIONS — REPORT IS SIX MINUTES OLD. CONFIRM THE PATROL; THE EW CIRCLE IS ESTIMATED.',
        result: 'PATROL ARMOR STOPPED — BDA SUBMITTED',
      })]),
      phase('deep-btr', 'INTERDICT THE KOLKHOZ BTR', [fpv({
        text: 'BTR DISPLACING AFTER THE FIRST STRIKE — TWO EW SOURCES.',
        maxRange: 3000, airframes: 3, training: { identifyRange: 58, allowAbort: true },
        jammers: [
          { x: -11, z: -524, r: 205, estimated: true },
          { x: 62, z: -880, r: 190, estimated: true, pulse: { on: 13, off: 6 } },
        ],
        vehicles: [
          { kind: 'apc', label: 'BTR-82A', health: 320, requiresIdentification: true, pos: [134, 0, -1030], route: [[134, -1030], [104, -1000], [150, -1000], [150, -1060]], speed: 3.8, loop: true, reaction: { speedMultiplier: 1.45, route: [[150, -1060], [20, -1145], [-160, -1145]] } },
          { kind: 'technical', label: 'FARM SERVICE TRUCK', hostile: false, protected: true, pos: [105, 0, -1010], yaw: 2.4 },
          { kind: 'infantry', label: 'KOLKHOZ SECURITY DETAIL', optional: true, team: 3, pos: [110, 0, -1052], yaw: 5.0, cover: { kind: 'technical', yaw: 2.6 } },
        ],
        startMessage: 'OPERATIONS — THE FARM IS MOVING AFTER THE TANK STRIKE. IDENTIFY BEFORE TERMINAL COMMITMENT.',
        result: 'KOLKHOZ SCREEN INTERDICTED — BDA SUBMITTED',
      })]),
      phase('deep-rail', 'BURN THE FUEL SIDING', [bomber({
        text: 'NIGHT HERON — SIX BOMBS, THREE FUEL WAGONS, THEN EGRESS.',
        maxRange: 3500, bombs: 6,
        jammers: [
          { x: -11, z: -524, r: 205, estimated: true },
          { x: 62, z: -880, r: 190, hidden: true, pulse: { on: 12, off: 8 } },
        ],
        vehicles: [
          { kind: 'fuelcar', label: 'FUEL WAGON ONE', health: 220, pos: [330, WAGON_LIFT,-1225], yaw: Math.PI / 2 },
          { kind: 'fuelcar', label: 'FUEL WAGON TWO', health: 220, pos: [330, WAGON_LIFT,-1237], yaw: Math.PI / 2 },
          { kind: 'fuelcar', label: 'FUEL WAGON THREE', health: 220, pos: [330, WAGON_LIFT,-1249], yaw: Math.PI / 2 },
          { kind: 'fuelcar', label: 'EMPTY DECOY WAGON', health: 100, decoy: true, pos: [330, WAGON_LIFT,-1270], yaw: Math.PI / 2 },
          { kind: 'infantry', label: 'SIDING LOADING PARTY', optional: true, team: 3, pos: [322, 0, -1243], yaw: 1.2 },
        ],
        startMessage: 'OPERATIONS — NIGHT PAYLOAD RUN. CONFIRM THE WARM WAGONS, MANAGE DRIFT, RETAIN AN EGRESS RESERVE.',
        result: 'DEEP FENCE COMPLETE — ECHELON EFFECTS CONFIRMED',
      })]),
    ], {
      curriculum: ['full mission cycle', 'BDA and tactical judgment'],
      sky: 0x10151c, fog: [0x151b22, 420, 2850], ambient: 0.48, sun: 0.22,
      geo: { deep: true, rail: true, jammers: [[-11, -524], [62, -880]] },
      minimap: {
        bounds: [-962, 505, 962, -1420], opArea: [-360, 500, 360, -1416],
        roads: [[-6, 505, -6, -1420], [-810, -700, 810, -700], [150, -700, 150, -1420],
          [-720, 330, 720, 330], [-720, 150, 720, 150], [-720, -120, 720, -120]],
        rail: [[245, 505, 245, -1420], [330, -250, 330, -1420]],
        woods: [
          [-220, 428, -18, 430], [18, 430, 220, 428],
          [-330, -382, -70, -378], [60, -378, 330, -384],
          [-330, -940, -60, -936], [110, -936, 330, -940],
          [-84, -430, -80, -880], [62, -560, 58, -1000],
        ],
        places: [[-14, -527, 100, 70], [134, -1030, 84, 90], [330, -1237, 16, 60]],
      },
    }),
];
