// Merged act missions. The nine legacy shooter levels 2-10 are stitched into three long
// operations by translating each source level's ENTIRE definition — geometry, actors,
// devices, doors, zones, drone waves, reinforcement sockets, visual props and lights — by a
// constant per-segment offset, then concatenating the objective lists with authored
// transition phases at every seam. The source definitions in index.js stay untouched and
// remain the single authority for each segment's content.
//
// Engine contracts a merged act relies on (implemented in main.js):
//   - enemy/civilian defs may carry `spawnPhase`: the actor exists only once that act
//     phase begins (later segments stay empty until the player is at their doorstep)
//   - reinforcement configs honour `startPhase`/`stopPhase` so each segment's clocks run
//     only during its own phases
//   - `checkpoints: [{phase, start}]` — death restarts at the current segment, not the act
//   - objective devices may carry `phase` (auto-used when resuming past their segment) and
//     `effect: 'restorePower'` (the counterpart to killPower, used at dark-to-light seams)
//   - phases may carry `sniper`/`lockPlayer` so those flags scope to a segment instead of
//     the whole mission
import { C, floorSlab, wall, stairs } from '../levelgen.js';
import { lightCursor, offsetLightsSince } from '../world.js';

const phase = (id, text, steps, flags = {}) => ({ id, text, steps, ...flags });

// ---- positional transforms over a source-level definition -------------------------------
const xyz = (p, o) => (p ? [p[0] + o.dx, (p[1] ?? 0) + o.dy, p[2] + o.dz] : p);
const xz = (p, o) => (p ? [p[0] + o.dx, p[1] + o.dz] : p);
// Circle zones are [x, z, r, y?]. A segment lowered by dy imposes its own floor height on
// zones that never declared one, so an actor on a different storey of the merged map can
// never satisfy or block a zone through the ceiling.
const circle = (z, o) => {
  if (!z) return z;
  const out = [z[0] + o.dx, z[1] + o.dz, z[2]];
  if (z[3] !== undefined) out[3] = z[3] + o.dy;
  else if (o.dy) out[3] = o.dy;
  return out;
};
const rect = (z, o) => (z ? [z[0] + o.dx, z[1] + o.dz, z[2] + o.dx, z[3] + o.dz] : z);

function tActor(d, o, spawnPhase) {
  const out = { ...d };
  if (out.pos) out.pos = xyz(out.pos, o);
  if (out.positions) out.positions = out.positions.map(p => xyz(p, o));
  if (out.patrol) out.patrol = out.patrol.map(p => xz(p, o));
  if (out.patrols) out.patrols = out.patrols.map(route => route.map(p => xz(p, o)));
  if (out.variants) {
    out.variants = out.variants.map(v => ({
      ...v, pos: v.pos ? xyz(v.pos, o) : v.pos,
    }));
  }
  if (out.window) out.window = xyz(out.window, o);
  if (out.perches) out.perches = out.perches.map(p => xyz(p, o));
  if (spawnPhase !== undefined) out.spawnPhase = spawnPhase;
  return out;
}

function tVehicle(v, o) {
  const out = { ...v };
  if (out.pos) out.pos = xyz(out.pos, o);
  if (out.positions) out.positions = out.positions.map(p => xyz(p, o));
  if (out.patrol) out.patrol = out.patrol.map(p => xz(p, o));
  if (out.patrols) out.patrols = out.patrols.map(route => route.map(p => xz(p, o)));
  if (out.route) out.route = out.route.map(p => xz(p, o));
  return out;
}

function tWave(w, o) {
  const out = { ...w };
  if (out.vehicle) out.vehicle = tVehicle(out.vehicle, o);
  if (out.enemies) out.enemies = out.enemies.map(e => tActor(e, o));
  if (out.droneIngress) {
    out.droneIngress = out.droneIngress.map(path => path.map(p => xz(p, o)));
  }
  return out;
}

function tStep(s, o) {
  const out = { ...s };
  if (out.zone) out.zone = circle(out.zone, o);
  if (out.requireReach) out.requireReach = circle(out.requireReach, o);
  if (out.clearZone) out.clearZone = circle(out.clearZone, o);
  if (out.destination) {
    out.destination = [out.destination[0] + o.dx, out.destination[1] + o.dz, out.destination[2]];
  }
  if (out.launch) out.launch = xyz(out.launch, o);
  if (out.combatWave) out.combatWave = tWave(out.combatWave, o);
  if (out.targets) out.targets = out.targets.map(t => ({ ...t, pos: xyz(t.pos, o) }));
  return out;
}

// Visual props register heterogeneous positional fields; move every one that is a world
// coordinate and nothing that is a dimension (w/h/d/height stay put).
function offsetProp(p, o) {
  if (Number.isFinite(p.x)) p.x += o.dx;
  if (Number.isFinite(p.z)) p.z += o.dz;
  if (Number.isFinite(p.y)) p.y += o.dy;
  if (Number.isFinite(p.yBase)) p.yBase += o.dy;
  if (Number.isFinite(p.x1)) p.x1 += o.dx;
  if (Number.isFinite(p.x2)) p.x2 += o.dx;
  if (Number.isFinite(p.z1)) p.z1 += o.dz;
  if (Number.isFinite(p.z2)) p.z2 += o.dz;
  if (p.away) { p.away[0] += o.dx; p.away[1] += o.dz; }
  if (p.pos) { p.pos[0] += o.dx; p.pos[1] += o.dy; p.pos[2] += o.dz; }
}

// ---- the merge ---------------------------------------------------------------------------
// segs: ordered [{ def, dx, dy, dz, transition, start, flagsById, dropBoxes, indoor }]
//   transition — a fully-authored act-space phase inserted BEFORE the segment's own phases;
//   start — act-space [x,y,z,yaw] checkpoint spawn for that transition;
//   flagsById — per-source-phase overrides ({sniper, lockPlayer}) applied after translation;
//   dropBoxes — predicate over UNtranslated geo boxes removed to open a seam.
// seam: { geo, devices } — act-space connective geometry and transition devices.
function merge(base, segs, seam = {}) {
  const objectives = [];
  const enemies = [];
  const civilians = [];
  const doors = [];
  const devices = [];
  const reinfs = [];
  const checkpoints = [];
  const emergencyLights = [];
  const enemySpawnGroups = {};
  const crowdSpawnGroups = {};
  const segments = [];
  let ctTeam = null;
  let ctTeamPhase;
  let blackoutOn = null;

  const segMeta = [];
  for (const seg of segs) {
    const o = { dx: seg.dx || 0, dy: seg.dy || 0, dz: seg.dz || 0 };
    const first = segments.length === 0;
    let spawnPhase;
    if (!first) {
      checkpoints.push({ phase: objectives.length, start: seg.start });
      spawnPhase = objectives.length;
      objectives.push(seg.transition);
    }
    const phaseBase = objectives.length;
    segMeta.push({ seg, o, phaseBase, spawnPhase });
    for (const ph of seg.def.objectives) {
      objectives.push({
        ...ph,
        steps: (ph.steps?.length ? ph.steps : [ph]).map(s => tStep(s, o)),
        ...(seg.flagsById?.[ph.id] || {}),
      });
    }
    for (const d of seg.def.enemies) enemies.push(tActor(d, o, spawnPhase));
    for (const d of seg.def.civilians || []) civilians.push(tActor(d, o, spawnPhase));
    for (const door of seg.def.doors || []) {
      doors.push({
        ...door,
        pos: xyz(door.pos, o),
        ...(door.unlockObjective !== undefined
          ? { unlockObjective: door.unlockObjective + phaseBase } : {}),
      });
    }
    for (const dev of seg.def.objectiveDevices || []) {
      const out = { ...dev, pos: xyz(dev.pos, o) };
      if (out.blocker) {
        out.blocker = {
          ...out.blocker,
          x: out.blocker.x + o.dx, y: out.blocker.y + o.dy, z: out.blocker.z + o.dz,
        };
      }
      devices.push(out);
    }
    for (const socket of seg.def.emergencyLights || []) emergencyLights.push(xyz(socket, o));
    const key = spawnPhase ?? 0;
    if (seg.def.enemySpawns?.length) {
      enemySpawnGroups[key] = [
        ...(enemySpawnGroups[key] || []), ...seg.def.enemySpawns.map(p => xyz(p, o)),
      ];
    }
    if (seg.def.crowdSpawns?.length) {
      crowdSpawnGroups[key] = [
        ...(crowdSpawnGroups[key] || []), ...seg.def.crowdSpawns.map(p => xyz(p, o)),
      ];
    }
    if (seg.def.ctTeam) {
      ctTeam = {
        ...seg.def.ctTeam,
        at: xyz(seg.def.ctTeam.at, o),
        route: seg.def.ctTeam.route.map(p => xz(p, o)),
      };
      // The team stages while the player transits the seam, so it is already at the
      // fountain when its escort phase begins.
      ctTeamPhase = spawnPhase ?? 0;
    }
    if (seg.def.blackoutOn) blackoutOn = seg.def.blackoutOn;
    segments.push({
      id: seg.def.id, dx: o.dx, dy: o.dy, dz: o.dz,
      indoor: !!seg.indoor, bounds: null,
    });
  }

  // Reinforcement clocks scope to their segment's phases. A wave that already declared a
  // startPhase keeps its authored trigger, rebased into act phase space.
  segMeta.forEach(({ seg, o, phaseBase, spawnPhase }, index) => {
    const source = seg.def.reinforce;
    if (!source) return;
    const nextStart = segMeta[index + 1]
      ? checkpoints[index]?.phase ?? undefined : undefined;
    const stopPhase = index < segMeta.length - 1
      ? segMeta[index + 1].spawnPhase
      : objectives.length - 1;
    for (const r of Array.isArray(source) ? source : [source]) {
      reinfs.push({
        ...r,
        ...(r.at ? { at: r.at.map(p => xyz(p, o)) } : {}),
        ...(r.atVariants
          ? { atVariants: r.atVariants.map(set => set.map(p => xyz(p, o))) } : {}),
        ...(r.trigger?.zone ? { trigger: { zone: rect(r.trigger.zone, o) } } : {}),
        ...(r.triggerVariants
          ? { triggerVariants: r.triggerVariants.map(t => ({ zone: rect(t.zone, o) })) }
          : {}),
        startPhase: r.startPhase !== undefined
          ? r.startPhase + phaseBase
          : spawnPhase,
        stopPhase,
      });
    }
  });

  for (const dev of seam.devices || []) devices.push(dev);
  // Annotate every device with the act phase whose steps reference it, so resuming at a
  // later checkpoint can replay the ones the skipped segments already used.
  for (const dev of devices) {
    if (dev.phase !== undefined) continue;
    objectives.forEach((ph, index) => {
      if (dev.phase !== undefined) return;
      for (const step of ph.steps || []) {
        const wanted = step.device || step.devices;
        const ids = Array.isArray(wanted) ? wanted : wanted ? [wanted] : [];
        if (ids.includes(dev.id)) { dev.phase = index; return; }
      }
    });
  }

  return {
    ...base,
    segments,
    doors,
    enemies,
    civilians,
    objectives,
    objectiveDevices: devices,
    reinforce: reinfs,
    checkpoints,
    ...(emergencyLights.length ? { emergencyLights } : {}),
    enemySpawnGroups,
    crowdSpawnGroups,
    ...(ctTeam ? { ctTeam, ctTeamPhase } : {}),
    ...(blackoutOn ? { blackoutOn } : {}),
    geo: () => {
      const g = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const o = segMeta[i].o;
        const propsStart = window.__bpVisualProps?.length ?? 0;
        const beaconStart = window.__bpBeacons?.length ?? 0;
        const lightStart = lightCursor();
        let part = [...seg.def.geo(), ...(seg.def.extraGeo ? seg.def.extraGeo() : [])];
        if (seg.dropBoxes) part = part.filter(b => !seg.dropBoxes(b));
        // The segment's own footprint, captured before translation, keys its ambient art.
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const b of part) {
          minX = Math.min(minX, b[0] - b[3] / 2); maxX = Math.max(maxX, b[0] + b[3] / 2);
          minZ = Math.min(minZ, b[2] - b[5] / 2); maxZ = Math.max(maxZ, b[2] + b[5] / 2);
        }
        segments[i].bounds = {
          cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
          r: Math.max(maxX - minX, maxZ - minZ) / 2 + 4,
        };
        for (const b of part) { b[0] += o.dx; b[1] += o.dy; b[2] += o.dz; }
        g.push(...part);
        const props = window.__bpVisualProps;
        if (props) for (let p = propsStart; p < props.length; p++) offsetProp(props[p], o);
        const beacons = window.__bpBeacons;
        if (beacons) {
          for (let b = beaconStart; b < beacons.length; b++) {
            const item = beacons[b];
            item.pos = [item.pos[0] + o.dx, item.pos[1] + o.dy, item.pos[2] + o.dz];
          }
        }
        offsetLightsSince(lightStart, o);
      }
      if (seam.geo) g.push(...seam.geo());
      return g;
    },
  };
}

// ---- the three acts ----------------------------------------------------------------------
export function buildActs(LEGACY) {
  const src = id => LEGACY.find(l => l.id === id);

  // ================================================================== ACT 1 — THE STREET
  // Levels 2 + 3 + 4 on one southbound run. The southern barricade gate at the end of the
  // street opens straight into the OP Alpha courtyard; past the towers, a walled seam feeds
  // the DIRECTION FINDER alley chase, which ends at the act's exfil gate.
  const act1 = merge(
    {
      id: 2, name: 'THE STREET',
      brief: 'One continuous push down the launch corridor. Sweep the storefront block and '
        + 'reopen the southern barricade; the gate opens onto the OP Alpha courtyard. Retake '
        + 'the apartment block, recover the observers and arm the rooftop drone, then drop '
        + 'back to street level: a 37th signals officer is running BASTION’s '
        + 'direction-finding log through the alleys beyond. Stop him before the far gate.',
      weapons: ['pistol', 'm4'], grenades: 3, flashes: 3, squad: 2,
      sky: 0x1b2634, fog: [0x1b2634, 40, 170], ambient: 0.82, sun: 1.2,
      start: [0, 0, 40, 0],
      qaTimeCap: 2400,
    },
    [
      { def: src(2), dx: 0, dy: 0, dz: 0 },
      {
        def: src(3), dx: 0, dy: 0, dz: -95,
        transition: phase('act1-courtyard', 'PUSH TO OP ALPHA', [
          {
            type: 'reach', zone: [0, -79, 4],
            text: 'ADVANCE THROUGH THE BARRICADE — ENTER THE OP ALPHA COURTYARD',
          },
        ]),
        start: [0, 0, -58, 0],
      },
      {
        def: src(4), dx: 0, dy: 0, dz: -190,
        transition: phase('act1-alleys', 'PUSH SOUTH INTO THE ALLEYS', [
          {
            type: 'interact', device: 'a1-power', autoUse: true, radius: 4.5,
            text: 'PUSH SOUTH — PICK UP THE ALLEY APPROACH AT THE SUBSTATION FEED',
          },
        ]),
        start: [0, 0, -126, 0],
      },
    ],
    {
      geo: () => {
        const g = [];
        // Courtyard-to-alley seam: a short walled connector bridging the 5m gap between the
        // OP Alpha slab (ends z=-125) and the alley district slab (starts z=-130), then
        // funnel returns onto the alley mouth walls at x=±5.
        g.push(...floorSlab(0, -127.5, 24, 7, 0.02, 0.5, C.street));
        g.push(...wall(-10, -125, -10, -140, 4, C.building));
        g.push(...wall(10, -125, 10, -140, 4, C.building));
        g.push(...wall(-10, -140, -5, -140, 4, C.buildingB));
        g.push(...wall(5, -140, 10, -140, 4, C.buildingB));
        return g;
      },
      devices: [
        // Clearing OP Alpha's second floor cut the district feed (level 3's blackout).
        // The substation panel at the alley seam brings the grid back for the chase.
        {
          id: 'a1-power', kind: 'breaker', label: 'DISTRICT SUBSTATION FEED',
          actionLabel: 'RESET', pos: [0, 0, -133], effect: 'restorePower', radius: 4.5,
        },
      ],
    },
  );

  // ================================================================== ACT 2 — THE DISTRICT
  // Levels 5 + 6 + 7. The market's south vehicle gate opens toward the relay plaza; an
  // authored switchback stairwell climbs the overwatch perch for the covered crossing; the
  // OP Bravo assault is flipped to a ground-level drone launch since the operator now
  // arrives on foot, then the tower is cleared bottom-to-top.
  const l7 = src(7);
  const l7Flipped = {
    ...l7,
    objectives: [
      phase('bravo-drone', 'BREAK THE ASSAULT WITH THE STREET-LEVEL DRONE', [
        {
          type: 'interact', device: 'a2-bravo-launch',
          text: 'ARM THE OP BRAVO LAUNCH TABLE AT THE TOWER BASE',
        },
        {
          ...l7.objectives[0].steps[0],
          launch: [6, 0.85, 10],
          text: 'OP BRAVO DRONE — BREAK THE INFANTRY ASSAULT BEFORE IT REACHES THE TOWER',
        },
      ]),
      phase('bravo-clear', 'CLEAR THE TOWER FLOOR BY FLOOR', [
        { type: 'clear', zone: null, text: 'CLEAR THE TOWER BOTTOM TO TOP' },
      ]),
      l7.objectives[2],
    ],
    objectiveDevices: [
      ...l7.objectiveDevices,
      {
        id: 'a2-bravo-launch', kind: 'launch', label: 'OP BRAVO LAUNCH TABLE',
        actionLabel: 'ARM', pos: [6, 0, 10],
      },
    ],
  };
  const act2 = merge(
    {
      id: 3, name: 'THE DISTRICT',
      brief: 'The aid market, the relay crossing and OP Bravo are one connected district. '
        + 'Make the shoot/no-shoot calls in the crowd, then climb the overwatch post beyond '
        + 'the south gate and cover Vektor’s crossing with the .50 — one sniper in the '
        + 'unlit centre block is hunting you. When the relay is live, move on the OP Bravo '
        + 'tower: break the forming assault with the street-level drone, then clear the '
        + 'floors and restore the antenna.',
      weapons: ['pistol', 'm4', 'barrett'], grenades: 3, flashes: 3, squad: 2,
      sky: 0x1a2432, fog: [0x1a2432, 60, 420], ambient: 0.9, sun: 1.15,
      start: [0, 0, 234, 0],
      qaTimeCap: 2400,
    },
    [
      { def: src(5), dx: 0, dy: 0, dz: 200 },
      {
        def: src(6), dx: 0, dy: 0, dz: 0,
        transition: phase('act2-overwatch', 'TAKE THE OVERWATCH POST', [
          {
            type: 'reach', zone: [0, 68, 5, 24],
            text: 'CLIMB THE OVERWATCH POST — SOUTH STAIRWELL TO THE ROOF',
          },
        ]),
        start: [0, 0, 152, 0],
        flagsById: {
          'relay-cover': { sniper: true, lockPlayer: true },
          'relay-extraction': { sniper: true, lockPlayer: true },
          'relay-activate': { sniper: true },
        },
      },
      {
        def: l7Flipped, dx: 0, dy: 0, dz: -200,
        transition: phase('act2-bravo-approach', 'MOVE ON OP BRAVO', [
          {
            type: 'reach', zone: [0, -170, 5],
            text: 'MOVE SOUTH — REACH THE OP BRAVO TOWER APPROACH',
          },
        ]),
        start: [0, 0, -155, 0],
      },
    ],
    {
      geo: () => {
        const g = [];
        // Market gate to plaza: bridge the 5m slab gap and hem the walkway.
        g.push(...floorSlab(0, 152.5, 28, 8, 0.02, 0.5, C.street));
        g.push(...wall(-12, 157, -12, 148, 4, C.building));
        g.push(...wall(12, 157, 12, 148, 4, C.building));
        // Overwatch perch access: an enclosed switchback stairwell on the perch's south
        // face (the building itself is a solid 24m mass at x -10..10, z 60..76). Eight 3m
        // flights alternate west/east between landings; the top landing lips onto the roof.
        for (let f = 0; f < 8; f++) {
          const y0 = f * 3;
          if (f % 2 === 0) {
            g.push(...stairs(9.5, 78, 'w', 8, 3, 3.2, C.concrete, y0));
            g.push(...floorSlab(0, 78, 3.2, 3.6, y0 + 3.02, 0.3, C.concrete));
          } else {
            g.push(...stairs(-0.5, 78, 'e', 8, 3, 3.2, C.concrete, y0));
            g.push(...floorSlab(8.9, 78, 2.6, 3.6, y0 + 3.02, 0.3, C.concrete));
          }
        }
        // Shaft walls: south back wall and both ends, so the climb reads as a stair tower.
        g.push(...wall(-10, 80, 10, 80, 24.5, C.buildingB));
        g.push(...wall(-10, 76, -10, 80, 24.5, C.buildingB));
        g.push(...wall(10, 76, 10, 80, 24.5, C.buildingB, [{ off: 0.6, w: 2.4, h: 2.6 }]));
        // Plaza to OP Bravo: bridge the slab gap south of the plaza and funnel the approach.
        g.push(...floorSlab(0, -157.5, 24, 17, 0.02, 0.5, C.street));
        g.push(...wall(-12, -149, -12, -166, 4, C.building));
        g.push(...wall(12, -149, 12, -166, 4, C.building));
        return g;
      },
      devices: [],
    },
  );

  // ================================================================== ACT 3 — UNDERGROUND
  // Levels 8 + 9 + 10. The district is blacked out from the first frame (darkStart): clear
  // the records office on goggles, drop into the metro through the surface stub beside the
  // office, fight down the platform and seal the bulkhead, then climb the surfacing stair
  // beyond the tunnel into the forward compound as the grid comes back for the finale.
  const act3 = merge(
    {
      id: 4, name: 'UNDERGROUND',
      brief: 'BASTION’s jamming attack has killed the district grid. Own the darkness: '
        + 'restore emergency power in the records office and stop the EW team, take the '
        + 'metro access down and clear the platform and tunnels behind the observation '
        + 'posts, then surface inside the forward compound as the grid comes back. Break '
        + 'the assault with the fire-control roof, destroy the battery and breach the '
        + 'bunker — BASTION ends here.',
      weapons: ['pistol', 'm4'], grenades: 4, flashes: 4, squad: 2,
      nvg: true, darkStart: true, indoor: false, ambientKind: 'tunnel',
      sky: 0x1e2835, fog: [0x1e2835, 40, 170], ambient: 0.85, sun: 1.15,
      start: [0, 0, 24, 0],
      qaTimeCap: 2400,
    },
    [
      {
        def: src(8), dx: 0, dy: 0, dz: 0, indoor: true,
        // Open the vestibule's sealed north end: the way OUT of the office is the way
        // DOWN into the metro. Replaced by a doorway in the seam geometry below.
        dropBoxes: b => Math.abs(b[2] - 29) < 0.25 && Math.abs(b[0]) < 4.2
          && (b[4] ?? 0) >= 2.5 && (b[1] ?? 0) < 3.2,
      },
      {
        def: src(9), dx: -14, dy: -6, dz: -2, indoor: true,
        transition: phase('act3-descend', 'TAKE THE METRO DOWN', [
          {
            type: 'reach', zone: [-14, 42, 4, 0],
            text: 'FIND THE METRO ACCESS — TAKE THE STAIRS DOWN TO THE PLATFORM',
          },
        ]),
        start: [0, 0, 26, 0],
        // The tunnel's dead-end south wall becomes the surfacing seam.
        dropBoxes: b => Math.abs(b[2] + 60) < 0.3 && Math.abs(b[0]) < 7.2
          && (b[4] ?? 0) >= 4,
      },
      {
        def: src(10), dx: -14, dy: 0, dz: -140,
        transition: phase('act3-surface', 'SURFACE AT THE COMPOUND', [
          {
            type: 'interact', device: 'a3-surface', autoUse: true, radius: 4.5,
            text: 'CLIMB OUT — SURFACE AT THE FORWARD COMPOUND',
          },
        ]),
        start: [-14, -6, -50, 0],
      },
    ],
    {
      geo: () => {
        const g = [];
        // Office vestibule doorway (replaces the dropped sealed wall at z=29).
        g.push(
          [-3.1, 1.5, 29, 1.8, 3, 0.3, C.interiorWall],
          [3.1, 1.5, 29, 1.8, 3, 0.3, C.interiorWall],
          [0, 2.8, 29, 4.6, 0.4, 0.3, C.interiorWall],
        );
        // Surfacing seam: the tunnel's removed end wall (act coords x -21..-7, z -62,
        // floor y -6) becomes a doorway onto an ascending stair trench that tops out on a
        // bridge slab feeding the compound approach.
        g.push(...wall(-21, -62, -17.2, -62, 4.5, C.tunnel, [], -6));
        g.push(...wall(-10.8, -62, -7, -62, 4.5, C.tunnel, [], -6));
        g.push([-14, -1.55, -62, 6.4, 0.9, 0.4, C.tunnel]);
        // The tunnel floor slab ends exactly at the removed wall; without this landing the
        // doorway opens onto a strip of void before the first tread.
        g.push(...floorSlab(-14, -63, 7, 3.4, -5.98, 0.6, C.tunnel));
        g.push(...stairs(-14, -63.4, 'n', 8.5, 6, 6, C.concrete, -6));
        g.push(...wall(-17.6, -62, -17.6, -73, 5.98, C.tunnel, [], -6));
        g.push(...wall(-10.4, -62, -10.4, -73, 5.98, C.tunnel, [], -6));
        // Bridge from the stair head south onto the compound district slab (starts z=-80).
        g.push(...floorSlab(-14, -76.5, 9.5, 10, 0.02, 0.5, C.street));
        g.push(...wall(-18.5, -71.5, -18.5, -81, 0.9, C.concrete));
        g.push(...wall(-9.5, -71.5, -9.5, -81, 0.9, C.concrete));
        return g;
      },
      devices: [
        // Surfacing is the act's dark-to-light hinge: the grid comes back as the player
        // climbs out (restorePower is killPower's counterpart in main.js).
        {
          id: 'a3-surface', kind: 'breaker', label: 'SURFACE ACCESS — GRID RELAY',
          actionLabel: 'RESET', pos: [-14, 0, -76], effect: 'restorePower', radius: 4.5,
        },
      ],
    },
  );

  return [act1, act2, act3];
}
