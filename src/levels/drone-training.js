import { floorSlab } from '../levelgen.js';
import { terrainSampler, carveRailGrade, RAIL_TOP } from '../terrain.js';
import { lift, sandbags, table, poleWire } from '../world.js';
import { hedgeStands, rightOfWay, treeTrunkColliders } from '../trees.js';
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

function treePlanFor(roadPaint, railLines, deep, hamletPlan) {
  // Plants also clear the settlement yards — a birch through a roof is not a look.
  const yardAvoid = [
    ...(hamletPlan?.settlements || []).map(s => ({ at: s.at, r: (s.r ?? 38) + 12 })),
    ...(hamletPlan?.farms || []).map(f => ({ at: f.at, r: 26 })),
  ];
  return {
    stands: [
      ...(deep ? [...BASE_BELTS, ...DEEP_BELTS] : BASE_BELTS),
      ...hedgeStands(roadPaint, railLines),
    ],
    avoid: [...rightOfWay(roadPaint, railLines), OP_PAD_AVOID, ...yardAvoid],
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

function droneLevel(id, name, brief, objectives, options = {}) {
  const deep = !!options.geo?.deep;
  const roadPaint = clipTracks(options.roadPaint || (deep ? DEEP_ROADPAINT : BASE_ROADPAINT));
  const railLines = deep ? [...TRAINING_RAIL, ...DEEP_RAIL] : TRAINING_RAIL;
  const hamletPlan = hamletPlanFor(roadPaint, railLines, deep);
  const treePlan = treePlanFor(roadPaint, railLines, deep, hamletPlan);
  const buildings = hamletLayout(hamletPlan, id);
  const resolvedObjectives = objectives.map(phaseDef => ({
    ...phaseDef,
    steps: (phaseDef.steps || [phaseDef]).map(step => ({
      ...step,
      vehicles: (step.vehicles || []).map(vehicle => {
        if (!vehicle.shelter) return vehicle;
        const requested = vehicle.shelter;
        const matches = buildings.filter(building =>
          building.kind === (requested.kind || 'barn')
          && (!requested.state || building.state === requested.state));
        const building = matches[requested.index || 0];
        if (!building) {
          throw new Error(`Drone level ${id}: no ${requested.state || ''} ${requested.kind || 'barn'} for ${vehicle.label}`);
        }
        const u = requested.u || 0, v = requested.v || 0;
        const cu = Math.cos(building.yaw), su = Math.sin(building.yaw);
        const { positions: _positions, shelter: _shelter, ...rest } = vehicle;
        return {
          ...rest,
          pos: [building.x + u * cu - v * su, 0, building.z + u * su + v * cu],
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
  { id: 'fast-cross', title: 'FAST PERPENDICULAR CROSSING', speed: 7.4, pos: [-220, 0, 150], route: [[-220, 150], [220, 150]] },
  { id: 'oblique', title: 'OBLIQUE CROSSING', speed: 5.8, pos: [-210, 0, 30], route: [[-210, 30], [180, 230]] },
  { id: 'junction', title: 'TURN AT THE JUNCTION', speed: 5.1, pos: [-210, 0, 330], route: [[-210, 330], [-6, 330], [-6, 40]] },
  { id: 'concealed', title: 'WINDBREAK REAPPEARANCE', speed: 4.5, pos: [-250, 0, 285], route: [[-250, 285], [-70, 285], [80, 150], [230, 150]] },
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

const movingRangeObjectives = interceptRuns.map((run, index) => phase(
  `intercept-${index + 1}-${run.id}`,
  `${index + 1}/10 — ${run.title}`,
  [fpv({
    text: `${run.title} — BUILD THE INTERCEPT, THEN COMMIT.`,
    airframes: 2,
    lessons: run.lesson ? [run.lesson] : [],
    vehicles: [{
      kind: index === 9 ? 'default' : 'technical',
      label: `RUN ${index + 1} TARGET`, health: index === 9 ? 220 : 150,
      pos: run.pos, route: run.route, speed: run.speed, loop: true,
      variants: run.variants || offsetPresentations(run),
    }],
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
          lesson('READ THE FLIGHT DISPLAY', 'The on-screen display (OSD) shows heading, speed, distance, home direction, battery and link quality. Check it during the route, not after the picture is already lost.', '.fpv-batt'),
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
    'Ten live intercept repetitions: opposite crossings, approaching and receding traffic, flank cuts, speed, turns, concealment and one randomized final check.',
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
