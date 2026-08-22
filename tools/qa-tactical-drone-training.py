#!/usr/bin/env python3
"""End-to-end QA for the Levels 11–20 tactical drone curriculum."""
import argparse
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


EXPECTED = [
    "DRONARIUM", "MOVING RANGE", "HEAVY HANDS", "BAD PICTURE", "THE BUBBLE",
    "NAP OF THE EARTH", "THE HUNT", "BROKEN PLAN", "GRADUATION", "DEEP FENCE",
]


def accelerate_review(page, advance_completed=True):
    """Advance review states while preserving the runtime transition code paths."""
    for _ in range(120):
        state = page.evaluate("""() => {
          const d = BP.world?.drone;
          return { mode: BP.mode, state: d?.attemptState || null,
            objective: BP.world?.objectiveIdx ?? -1,
            completed: !!d?.pendingMissionComplete };
        }""")
        if state["mode"] == "debrief" or state["state"] in (None, "flying"):
            return state
        if state["state"] == "impact_hold":
            page.evaluate("""() => {
              BP.world.drone.attemptStateTime = 3;
              BP.world.drone.updateAttemptState(.1, {});
            }""")
        elif state["state"] == "replay":
            page.evaluate("""() => {
              BP.world.drone.attemptStateTime = 8;
              BP.world.drone.updateAttemptState(.1, {});
            }""")
        elif state["state"] == "debrief":
            use_advance = state["completed"] and advance_completed
            page.evaluate("""advance => {
              BP.world.drone.attemptStateTime = 1;
              BP.world.drone.updateAttemptState(.1, advance
                ? { breachPressed: true } : { firePressed: true });
            }""", use_advance)
        elif state["state"] == "ready":
            page.evaluate("""() => {
              BP.world.drone.attemptStateTime = 1;
              BP.world.drone.updateAttemptState(.1, { firePressed: true });
            }""")
        page.wait_for_timeout(80)
    raise AssertionError("attempt review did not settle")


def strike_required_target(page):
    return page.evaluate("""() => {
      const d = BP.world.drone;
      d.skipLessons?.();
      const target = d.combatVehicles.find(v =>
        !v.dead && !v.decoy && !v.protected && !v.optional);
      if (!target) return { target: null, mode: d.mode };
      target.identified = true;
      if (d.mode === 'bomber') {
        const impact = target.pos.clone();
        impact.y += .2;
        d.combatImpact(impact);
        return { target: target.label, mode: d.mode, directBomb: true };
      }
      const rear = { x: Math.cos(target.mesh.rotation.y), z: -Math.sin(target.mesh.rotation.y) };
      const impact = target.pos.clone();
      impact.x += rear.x * (target.cage ? 1.8 : .4);
      impact.z += rear.z * (target.cage ? 1.8 : .4);
      impact.y += 1.2;
      d.fpvDetonate(impact);
      return { target: target.label, mode: d.mode };
    }""")


def finish_level(page, level_id):
    page.evaluate("id => BP.startLevel(id)", level_id)
    page.wait_for_function(
        "id => BP.mode === 'playing' && BP.world?.level?.id === id && !!BP.world.drone",
        arg=level_id,
    )
    attempts = 0
    started = time.monotonic()
    while time.monotonic() - started < 180:
        state = page.evaluate("""() => ({
          mode: BP.mode,
          state: BP.world?.drone?.attemptState || null,
          droneMode: BP.world?.drone?.mode || null,
          objective: BP.world?.objectiveIdx ?? -1,
          required: BP.world?.drone?.combatVehicles.filter(v =>
            !v.dead && !v.decoy && !v.protected && !v.optional).length ?? 0,
        })""")
        if state["mode"] == "debrief":
            return attempts
        if state["state"] == "flying":
            if state["required"]:
                strike_required_target(page)
                attempts += 1
                if state["droneMode"] == "bomber" and state["required"] > 1:
                    page.wait_for_timeout(80)
                    continue
            else:
                page.wait_for_timeout(100)
        else:
            accelerate_review(page)
        page.wait_for_timeout(80)
    raise AssertionError(f"level {level_id} did not complete")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4179/?renderer=desktop")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.output:
        args.output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.set_default_timeout(120000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.BP")

        catalogue = page.evaluate("""() => BP.LEVELS.filter(level => level.id >= 11 && level.id <= 20).map(level => ({
          id: level.id, name: level.name, curriculum: level.curriculum,
          timeOfDay: level.timeOfDay,
          targetDuration: level.targetDuration,
          concepts: level.curriculum.length,
          objectives: level.objectives.length,
          droneSteps: level.objectives.flatMap(p => p.steps || [p]).filter(s => s.type === 'drone').length,
          oldDrain: level.objectives.flatMap(p => p.steps || [p]).some(s => 'batteryDrain' in s),
          timedBattery: level.objectives.flatMap(p => p.steps || [p]).every(s =>
            s.type !== 'drone' || s.batterySeconds >= 600),
          coached: level.objectives.flatMap(p => p.steps || [p]).some(s =>
            s.type === 'drone' && (s.lessons?.length || 0) > 0),
          unassisted: level.objectives.flatMap(p => p.steps || [p]).some(s =>
            s.type === 'drone' && (s.lessons?.length || 0) === 0),
          controlLinks: level.objectives.flatMap(p => p.steps || [p])
            .filter(s => s.type === 'drone').map(s => s.controlLink || 'radio'),
          guided: level.objectives.flatMap(p => p.steps || [p]).some(s =>
            s.type === 'drone' && ((s.lessons?.length || 0) > 0
              || (s.training?.fiberRoute?.length || 0) > 1)),
        }))""")
        assert [entry["name"] for entry in catalogue] == EXPECTED, catalogue
        assert [entry["id"] for entry in catalogue] == list(range(11, 21)), catalogue
        assert catalogue[0]["timeOfDay"] == "day", catalogue
        assert all(entry["timeOfDay"] == "night" for entry in catalogue[1:]), catalogue
        assert all(entry["concepts"] <= 2 for entry in catalogue), catalogue
        assert all(entry["targetDuration"] == [600, 720] for entry in catalogue), catalogue
        assert all(not entry["oldDrain"] and entry["timedBattery"] for entry in catalogue), catalogue
        assert all((entry["coached"] or entry["guided"])
                   and entry["unassisted"] for entry in catalogue), catalogue
        assert catalogue[1]["droneSteps"] == 10, catalogue
        assert catalogue[5]["controlLinks"] == ["fiber", "radio"], catalogue[5]

        moving_profiles = page.evaluate("""() => {
          const level = BP.LEVELS.find(entry => entry.id === 12);
          return level.objectives.map((objective, index) => {
            const step = (objective.steps || [objective]).find(entry => entry.type === 'drone');
            const assigned = step.vehicles.find(vehicle =>
              !vehicle.optional && !vehicle.decoy && !vehicle.protected);
            return {
              run: index + 1, title: objective.text, kind: assigned.kind,
              label: assigned.label, team: assigned.team || 0,
              speed: assigned.speed || 0,
              routePoints: assigned.route?.length || 0,
              loop: assigned.loop, variants: assigned.variants?.length || 0,
              lessons: step.lessons?.length || 0,
              evasion: assigned.evasion?.style || null,
              shelter: assigned.shelter?.kind || null,
              supportVehicles: step.vehicles.filter(vehicle =>
                vehicle.optional && vehicle.kind !== 'infantry').length,
            };
          });
        }""")
        runners = [profile for profile in moving_profiles if profile["kind"] == "infantry"]
        assert [profile["run"] for profile in runners] == [6, 7, 9], moving_profiles
        assert all(profile["team"] == 1 and profile["routePoints"] >= 5
                   and profile["variants"] == 3
                   for profile in runners), runners
        assert runners[0]["loop"] and not runners[1]["loop"] and runners[2]["loop"], runners
        assert all(profile["speed"] >= 8 and profile["evasion"] for profile in runners), runners
        assert runners[1]["shelter"] == "barn" and runners[1]["supportVehicles"] == 1, runners
        assert runners[2]["shelter"] == "barn", runners
        assert all("RUNNER" in profile["label"] for profile in runners), runners
        assert runners[0]["lessons"] == 1, runners

        # The player-facing briefing exposes the same direct phase start that retries and
        # QA use. Selecting the sixth card must boot the sixth run, not merely relabel DEPLOY.
        page.locator("#menu-levels").click()
        page.locator("#level-list .menu-btn", has_text="MOVING RANGE").click()
        run_picker = page.evaluate("""() => ({
          visible: !document.querySelector('#brief-run-picker').hidden,
          count: document.querySelectorAll('#brief-run-grid .run-pill').length,
          labels: [...document.querySelectorAll('#brief-run-grid .run-meta')]
            .map(node => node.textContent),
        })""")
        assert run_picker["visible"] and run_picker["count"] == 10, run_picker
        assert "PERSON · WOODED COVER" in run_picker["labels"], run_picker
        page.locator("#brief-run-grid .run-pill").nth(5).dispatch_event("touchend")
        assert "RUN 06" in page.locator("#brief-go").inner_text()
        page.locator("#brief-go").click()
        page.wait_for_function("""() => BP.world?.level?.id === 12
          && BP.world?.objectiveIdx === 5 && !!BP.world.drone""")
        accelerate_review(page)
        # Cover-commit contract: pressed inside the trigger the runner sprints for a
        # canopy node away from the aircraft and holds under it; pressed inside the flush
        # radius he breaks for the next tree; inside 25 m (3D) he freezes where he stands
        # and resumes only once the aircraft opens past the release radius. Direction
        # reversals along the run stay rare — no ping-pong, no boxed-in oscillation.
        runner_runtime = page.evaluate("""() => {
          const d = BP.world.drone;
          d.skipLessons?.();
          const runner = d.combatVehicles.find(vehicle =>
            !vehicle.optional && vehicle.kind === 'infantry');
          // Unpressed (aircraft far beyond the trigger): he WALKS his line.
          const remote = runner.pos.clone(); remote.x += 200; remote.y += 60;
          let patrolSpeed = 0;
          for (let index = 0; index < 40; index++) {
            runner.update(.1, BP.world.solids, remote);
            patrolSpeed = Math.max(patrolSpeed, runner.velocity.length());
          }
          const coverNodes = runner.routeCoverNodes().length;
          // Press from ~130m out: he commits to the nearest safe canopy and holds.
          const threat = runner.pos.clone(); threat.x += 37; threat.y += 12;
          let held = false;
          for (let index = 0; index < 400 && !held; index++) {
            runner.update(.1, BP.world.solids, threat);
            held = runner.coverHold;
          }
          const committed = runner.coverCommit;
          const holdUnderCanopy = held && runner.routeCoverNodes().includes(runner.routeIdx);
          // Blow the hide: press inside the flush radius but outside the freeze bubble,
          // approaching from the open side so the line to the next canopy stays clear.
          // He must break cover and SPRINT the line to the next canopy, no ping-pong.
          const flushThreat = runner.pos.clone();
          flushThreat.x -= runner.evasion.flushRadius - 1; flushThreat.y += 3;
          runner.update(.1, BP.world.solids, flushThreat);
          const flushed = !runner.coverHold && runner.coverCommit !== committed;
          const dashStart = runner.pos.clone();
          const headings = [];
          let sprintSpeed = 0;
          let reHeld = false;
          for (let index = 0; index < 600 && !reHeld; index++) {
            runner.update(.1, BP.world.solids, flushThreat);
            sprintSpeed = Math.max(sprintSpeed, runner.velocity.length());
            if (runner.velocity.lengthSq() > .01) headings.push(
              Math.atan2(runner.velocity.x, runner.velocity.z));
            reHeld = runner.coverHold;
          }
          let reversals = 0;
          for (let index = 1; index < headings.length; index++) {
            const delta = Math.atan2(Math.sin(headings[index] - headings[index - 1]),
              Math.cos(headings[index] - headings[index - 1]));
            if (Math.abs(delta) > Math.PI * 0.75) reversals++;
          }
          const dashMoved = runner.pos.distanceTo(dashStart);
          const reHeldUnderCanopy = reHeld
            && runner.routeCoverNodes().includes(runner.routeIdx);
          // Terminal press: inside 25 m running is pointless — he stops and goes small.
          const closeThreat = runner.pos.clone();
          closeThreat.x += runner.evasion.freezeRadius - 1;
          const frozeAt = runner.pos.clone();
          for (let index = 0; index < 30; index++) {
            runner.update(.1, BP.world.solids, closeThreat);
          }
          const frozen = runner.freezeHold;
          const heldStill = runner.pos.distanceTo(frozeAt) < .05;
          const kneltFrozen = (runner.mesh.userData.crew || []).every(
            soldier => soldier.userData.kneel);
          // The aircraft leaves: he unfreezes and moves again.
          const farThreat = runner.pos.clone(); farThreat.x += 120; farThreat.y += 40;
          let resumed = false;
          for (let index = 0; index < 200 && !resumed; index++) {
            runner.update(.1, BP.world.solids, farThreat);
            resumed = !runner.freezeHold && runner.velocity.lengthSq() > .01;
          }
          const figure = runner.mesh.userData.crew?.[0];
          return {
            crew: runner.mesh.userData.crew?.length || 0,
            moved: dashMoved,
            physicalSpeed: runner.speed * 3.5,
            patrolSpeed, sprintSpeed, coverNodes,
            reversals, holdUnderCanopy, flushed, reHeldUnderCanopy,
            frozen, heldStill, kneltFrozen, resumed,
            routePoints: runner.route.length,
            thermalFigures: d.thermalSignatures.filter(signature =>
              !!signature.userData.figure).length,
            action: figure?.userData.rig?.currentAction?.getClip?.().name || '',
          };
        }""")
        assert runner_runtime["crew"] == 1 and runner_runtime["routePoints"] >= 5, runner_runtime
        assert runner_runtime["moved"] > 10 and runner_runtime["thermalFigures"] >= 1, runner_runtime
        assert runner_runtime["physicalSpeed"] >= 8, runner_runtime
        assert runner_runtime["coverNodes"] >= 3, runner_runtime
        assert 0 < runner_runtime["patrolSpeed"] < runner_runtime["sprintSpeed"], runner_runtime
        assert runner_runtime["reversals"] <= 2, runner_runtime
        assert runner_runtime["holdUnderCanopy"], runner_runtime
        assert runner_runtime["flushed"] and runner_runtime["reHeldUnderCanopy"], runner_runtime
        assert runner_runtime["frozen"] and runner_runtime["heldStill"], runner_runtime
        assert runner_runtime["kneltFrozen"] and runner_runtime["resumed"], runner_runtime
        assert any(word in runner_runtime["action"].lower()
                   for word in ("run", "walk")), runner_runtime

        page.evaluate("() => BP.startLevelAt(12, 6)")
        page.wait_for_function("""() => BP.world?.level?.id === 12
          && BP.world?.objectiveIdx === 6 && !!BP.world.drone""")
        building_runner = page.evaluate("""async () => {
          const THREE = await import('three');
          const d = BP.world.drone;
          d.skipLessons?.();
          d.attemptStateTime = 1;
          d.updateAttemptState(.1, { firePressed: true });
          const runner = d.combatVehicles.find(vehicle =>
            !vehicle.optional && vehicle.kind === 'infantry');
          const truck = d.combatVehicles.find(vehicle => vehicle.label === 'PARKED FARM TRUCK');
          const s = runner.shelter;
          const local = point => {
            const dx = point.x - s.x, dz = point.z - s.z;
            return { u: dx * Math.cos(s.yaw) + dz * Math.sin(s.yaw),
              v: -dx * Math.sin(s.yaw) + dz * Math.cos(s.yaw) };
          };
          const inside = point => {
            const p = local(point);
            return Math.abs(p.u) < s.L / 2 - .15 && Math.abs(p.v) < s.D / 2 - .15;
          };
          const startedInside = inside(runner.pos);
          const insideNodes = runner.route.filter(inside).length;
          const outsideNodes = runner.route.length - insideNodes;
          const waitingAt = runner.pos.clone();
          const farThreat = runner.pos.clone();
          farThreat.x += runner.evasion.activationRadius + 1;
          for (let index = 0; index < 120; index++) {
            runner.update(.16, BP.world.solids, farThreat);
          }
          const waitedInPlace = runner.pos.distanceTo(waitingAt);
          const inactiveWhileFar = !runner.activated;
          const nearThreat = runner.pos.clone();
          nearThreat.x += runner.evasion.activationRadius - .05;
          let entered = false;
          for (let index = 0; index < 500; index++) {
            runner.update(.16, BP.world.solids, nearThreat);
            if (inside(runner.pos)) entered = true;
            if (runner.hiding) break;
          }
          const hiddenAt = runner.pos.clone();
          for (let index = 0; index < 80; index++) runner.update(.16, BP.world.solids);
          const nearbyLowCover = BP.world.solids.filter(box => {
            const cx = (box.min.x + box.max.x) / 2;
            const cz = (box.min.z + box.max.z) / 2;
            const height = box.max.y - box.min.y;
            return Math.hypot(cx - runner.pos.x, cz - runner.pos.z) < 3.2
              && height > .3 && height < 1.7;
          }).length;
          const truckOrbitDistance = Math.min(...runner.route.map(point =>
            Math.hypot(point.x - truck.pos.x, point.z - truck.pos.z)));
          const figure = runner.mesh.userData.crew?.[0];
          const outsidePoint = box => {
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const point = center.clone();
            if (size.x < size.z) point.x = box.max.x + .2;
            else point.z = box.max.z + .2;
            return point;
          };
          const truckBox = new THREE.Box3().setFromObject(truck.mesh).expandByScalar(.12);
          const runnerBox = new THREE.Box3().setFromObject(runner.mesh).expandByScalar(.12);
          const truckNear = outsidePoint(truckBox);
          const runnerNear = outsidePoint(runnerBox);
          const oldSphereWouldHitTruck = truckNear.distanceTo(truck.pos) < 2.4;
          const oldSphereWouldHitRunner = runnerNear.distanceTo(runner.pos) < 2.4;
          d.pos.copy(truckNear); d.vel.set(0, 0, 0);
          d.updateFpvFamily(0, { firePressed: false, nadePressed: false }, BP.world.solids);
          const clearedTruck = !d.detonated;
          d.pos.copy(runnerNear); d.vel.set(0, 0, 0);
          d.updateFpvFamily(0, { firePressed: false, nadePressed: false }, BP.world.solids);
          const clearedRunner = !d.detonated;

          d.pos.set(0, 40, 0); d.vel.set(0, 0, 0);
          const origin = new THREE.Vector3(-10, 40, 0);
          const random = Math.random; Math.random = () => .99;
          const fireRead = d.receiveEnemyFire(origin, BP.world.solids, 1.35);
          Math.random = random;
          return {
            startedInside, insideNodes, outsideNodes, entered,
            activationMeters: runner.evasion.activationRadius * 3.5,
            waitedInPlace, inactiveWhileFar, activated: runner.activated,
            hiding: runner.hiding, hiddenInside: inside(runner.pos),
            stayedPut: runner.pos.distanceTo(hiddenAt), nearbyLowCover,
            crouched: !!figure?.userData.kneel,
            routePoints: runner.route.length, truckOrbitDistance,
            truckStatic: !truck.route.length && truck.hostile === false,
            oldSphereWouldHitTruck, oldSphereWouldHitRunner,
            clearedTruck, clearedRunner,
            missedShotVelocity: d.vel.length(), fireRead,
            incomingPressure: d.incomingPressure,
            shelterState: s.state,
          };
        }""")
        assert not building_runner["startedInside"] and building_runner["entered"], building_runner
        assert abs(building_runner["activationMeters"] - 25) < .01, building_runner
        assert building_runner["waitedInPlace"] < .01 and building_runner["inactiveWhileFar"], building_runner
        assert building_runner["activated"], building_runner
        assert building_runner["insideNodes"] >= 3 and building_runner["outsideNodes"] >= 2, building_runner
        assert building_runner["hiding"] and building_runner["hiddenInside"], building_runner
        assert building_runner["stayedPut"] < .01 and building_runner["crouched"], building_runner
        assert building_runner["nearbyLowCover"] >= 2, building_runner
        assert building_runner["routePoints"] >= 7 and building_runner["truckStatic"], building_runner
        assert building_runner["truckOrbitDistance"] < 3.5, building_runner
        assert building_runner["oldSphereWouldHitTruck"] and building_runner["oldSphereWouldHitRunner"], building_runner
        assert building_runner["clearedTruck"] and building_runner["clearedRunner"], building_runner
        assert building_runner["fireRead"] and building_runner["incomingPressure"] > 0, building_runner
        assert building_runner["missedShotVelocity"] < .001, building_runner

        # The operator view fills the display as a curved optic. The map is deliberately a
        # sibling rather than a child of that optic: an external simulation aid, not video.
        page.evaluate("() => BP.startLevel(11)")
        page.wait_for_function("() => BP.mode === 'playing' && BP.world?.drone")
        operator_view = page.evaluate("""() => {
          const d = BP.world.drone;
          d.skipLessons?.();
          d.attemptStateTime = 1;
          d.updateAttemptState(.1, { firePressed: true });
          d.updateFpvOsd(0);
          const thermalBefore = d.thermalEnabled;
          const eoDrain = d.currentBatteryDrainRate();
          d.updateThermalBurst(0, { nvgPressed: true });
          d.updateThermalSignatures();
          d.updateFpvOsd(0);
          const thermalOn = {
            enabled: d.thermalEnabled,
            visible: d.thermalSignatures.filter(signature => signature.visible).length,
            filter: d.canvas.style.filter,
            osd: d.osd.link.textContent,
            drain: d.currentBatteryDrainRate(),
            multiplier: d.thermalBatteryMultiplier,
          };
          d.updateThermalBurst(0, { nvgPressed: true });
          d.updateThermalSignatures();
          const optic = document.querySelector('.fpv-optic').getBoundingClientRect();
          const mapPanel = document.querySelector('.fpv-map-panel');
          const navLabel = document.querySelector('.fpv-map-label')?.textContent || '';
          return {
            optic: [optic.width, optic.height],
            viewport: [innerWidth, innerHeight],
            externalMap: mapPanel?.parentElement === d.overlay,
            mapTop: getComputedStyle(mapPanel).top,
            frontProps: document.querySelectorAll('.fpv-prop').length,
            whiskers: document.querySelectorAll('.fpv-whiskers path').length,
            navLabel,
            searchMarked: !!d.mapStatic,
            thermalPersistent: d.thermalPersistent,
            thermalBefore,
            eoDrain,
            thermalOn,
            thermalOff: !d.thermalEnabled
              && d.thermalSignatures.every(signature => !signature.visible),
            thermalHelp: d.help.textContent,
            cameraVibration: d.cameraVibration,
            feed: d.feedVisualState(),
          };
        }""")
        assert operator_view["optic"] == operator_view["viewport"], operator_view
        assert operator_view["externalMap"] and operator_view["mapTop"] != "auto", operator_view
        assert operator_view["frontProps"] == 0, operator_view
        assert operator_view["whiskers"] == 4, operator_view
        assert "NAV-AID" in operator_view["navLabel"] and "NOT CAMERA" in operator_view["navLabel"], operator_view
        assert operator_view["searchMarked"] and operator_view["feed"]["active"], operator_view
        assert operator_view["thermalPersistent"] and not operator_view["thermalBefore"], operator_view
        assert operator_view["thermalOn"]["enabled"] and operator_view["thermalOn"]["visible"] > 0, operator_view
        assert "grayscale" in operator_view["thermalOn"]["filter"], operator_view
        assert "SENSOR THERMAL" in operator_view["thermalOn"]["osd"], operator_view
        assert "LOAD +22%" in operator_view["thermalOn"]["osd"], operator_view
        assert 1.21 < operator_view["thermalOn"]["multiplier"] < 1.23, operator_view
        assert abs(operator_view["thermalOn"]["drain"] / operator_view["eoDrain"] - 1.22) < 0.001, operator_view
        assert operator_view["thermalOff"] and "N EO/THERMAL" in operator_view["thermalHelp"], operator_view
        assert abs(operator_view["cameraVibration"] - 0.00152) < 0.000001, operator_view
        if args.output:
            page.screenshot(path=args.output / "operator-day.png")

        # Fibre coaching happens in flight: the video/control link remains clean under RF
        # jamming, while the paid-out cable, reserve and marked snag zones carry the lesson.
        page.evaluate("() => BP.startLevel(16)")
        page.wait_for_function("() => BP.world?.level?.id === 16 && !!BP.world.drone")
        fiber = page.evaluate("""() => {
          const d = BP.world.drone;
          d.skipLessons?.();
          d.attemptStateTime = 1;
          d.updateAttemptState(.1, { firePressed: true });
          for (const [x, z] of d.training.fiberRoute.slice(1, 4)) {
            d.pos.set(x, 10, z);
            d.updateFiberControl(.05);
          }
          d.updateFpvOsd(0);
          return {
            controlled: d.fiberControlled,
            lessons: d.definition.lessons?.length || 0,
            routePoints: d.training.fiberRoute.length,
            hazards: d.training.fiberHazards.length,
            payout: d.fiberPayout,
            cablePoints: d.fiberPoints.length,
            cableVisible: d.fiberCable.visible,
            courseVisible: d.fiberCourse.visible,
            courseMarkers: d.fiberCourse.children.length,
            osd: d.osd.fiber.textContent,
          };
        }""")
        assert fiber["controlled"] and fiber["lessons"] == 0, fiber
        assert fiber["routePoints"] >= 5 and fiber["hazards"] >= 3, fiber
        assert fiber["payout"] > 0 and fiber["cablePoints"] >= 4, fiber
        assert fiber["cableVisible"] and fiber["courseVisible"], fiber
        assert fiber["courseMarkers"] >= 18, fiber
        assert "CTRL FIBRE" in fiber["osd"] and "RES" in fiber["osd"], fiber
        if args.output:
            page.screenshot(path=args.output / "fiber-guided-flight.png")
        immunity = page.evaluate("""() => {
          const d = BP.world.drone;
          d.pos.set(0, 10, 60);
          d.vel.set(0, 0, 0);
          d.update(.01, {
            lookDelta: { x: 0, y: 0 }, move: { x: 0, y: 0 },
            ads: false, crouch: false, firePressed: false, nadePressed: false,
            breachPressed: false, reloadPressed: false,
          }, BP.world.solids);
          return { signal: d.signal, jamFactor: d.jamFactor };
        }""")
        assert immunity["signal"] == 1 and immunity["jamFactor"] == 1, immunity
        fiber_break = page.evaluate("""() => {
          const d = BP.world.drone;
          d.fiberPayout = d.training.fiberMaxLength;
          d.updateFiberControl(.1);
          return { state: d.attemptState, reason: d.review?.reason || '' };
        }""")
        assert fiber_break["state"] == "impact_hold", fiber_break
        assert "SPOOL EXHAUSTED" in fiber_break["reason"], fiber_break

        # A long drone phase can always be bypassed from pause, and a failure in the next
        # phase retries that phase rather than sending the operator back through phase one.
        page.evaluate("() => BP.startLevel(13)")
        page.wait_for_function("() => BP.mode === 'playing' && BP.world?.drone")
        page.evaluate("() => { BP.input.pausePressed = true; }")
        page.wait_for_function("() => BP.mode === 'paused'")
        phase_skip_label = page.locator("#pause-skip").inner_text()
        assert "PHASE 2" in phase_skip_label, phase_skip_label
        page.locator("#pause-skip").click()
        page.wait_for_function("""() => BP.mode === 'playing'
          && BP.world?.objectiveIdx === 1
          && BP.phase?.id === 'payload-check'
          && BP.world?.drone?.mode === 'bomber'""")
        heavy_hands_feasibility = page.evaluate("""() => {
          const d = BP.world.drone;
          const vehicles = d.combatVehicles;
          const locomotive = vehicles.find(v => v.label === 'DIESEL LOCOMOTIVE');
          const tanker = vehicles.find(v => v.label === 'FUEL TANKER');
          const escort = vehicles.find(v => v.label === 'SERVICE-ROAD ESCORT');
          const cruise = Math.min(d.worldMaxSpeed, d.worldAccel / 1.45);
          const at = (vehicle, seconds) => {
            const start = vehicle.route[0], end = vehicle.route[1];
            const length = Math.hypot(end.x - start.x, end.z - start.z);
            const periodDistance = (vehicle.speed * seconds) % (2 * length);
            const along = periodDistance <= length ? periodDistance : 2 * length - periodDistance;
            return {
              x: start.x + (end.x - start.x) * along / length,
              z: start.z + (end.z - start.z) * along / length,
            };
          };
          const intercept = (position, startTime, vehicle) => {
            for (let time = startTime; time < startTime + 1200; time += .05) {
              const target = at(vehicle, time);
              if (Math.hypot(target.x - position.x, target.z - position.z)
                  <= cruise * (time - startTime)) return { time, position: target };
            }
            throw new Error('no feasible intercept');
          };
          const permutations = [
            [locomotive, tanker, escort], [locomotive, escort, tanker],
            [tanker, locomotive, escort], [tanker, escort, locomotive],
            [escort, locomotive, tanker], [escort, tanker, locomotive],
          ];
          let best = null;
          for (const order of permutations) {
            let position = { x: d.launch.x, z: d.launch.z }, time = 0;
            for (const vehicle of order) {
              const result = intercept(position, time, vehicle);
              time = result.time; position = result.position;
            }
            time += Math.hypot(position.x - d.launch.x, position.z - d.launch.z) / cruise;
            const batteryUsed = time * d.batteryDrain
              * (1 + .6 * cruise / d.worldMaxSpeed);
            if (!best || batteryUsed < best.batteryUsed) {
              best = { time, batteryUsed, order: order.map(v => v.label) };
            }
          }
          const spacingBefore = locomotive.pos.distanceTo(tanker.pos);
          locomotive.update(5, BP.world.solids);
          tanker.update(5, BP.world.solids);
          const spacingAfter = locomotive.pos.distanceTo(tanker.pos);
          d.setThermalEnabled(true);
          d.updateThermalSignatures();
          const launchMarker = BP.scene.getObjectByName('drone-forward-launch-marker');
          const homeThermal = BP.scene.getObjectByName('drone-thermal-home-beacon');
          const bomberCoach = d.coachAttempt({
            effect: 'DESTROYED', aspect: 'REAR', targetCaged: false,
            firstPass: true, routeEfficiency: 1, distance: 100, baselineDistance: 100,
            returnIncluded: true, jamTime: 0, minSignal: 1, batteryAtEnd: 80,
            chaseTime: 120, maxAgl: 0, terminalCorrection: 0, acquired: true,
          });
          return {
            launch: d.definition.launch,
            kinds: [locomotive.kind, locomotive.label, tanker.label, escort.label],
            trainKmh: locomotive.speed * d.metersPerUnit * 3.6,
            spacingBefore, spacingAfter, best,
            home: {
              label: d.training.homeLabel,
              marker: !!launchMarker,
              markerChildren: launchMarker?.children.length || 0,
              aligned: !!launchMarker
                && Math.hypot(launchMarker.position.x - d.launch.x,
                  launchMarker.position.z - d.launch.z) < .01,
              thermal: !!homeThermal && homeThermal.visible,
            },
            bomberFeedback: [...bomberCoach.improve, bomberCoach.instruction].join(' '),
          };
        }""")
        assert heavy_hands_feasibility["launch"] == [120, 0, 300], heavy_hands_feasibility
        assert heavy_hands_feasibility["kinds"] == [
            "locomotive", "DIESEL LOCOMOTIVE", "FUEL TANKER", "SERVICE-ROAD ESCORT"
        ], heavy_hands_feasibility
        assert abs(heavy_hands_feasibility["trainKmh"] - 12) < 0.01, heavy_hands_feasibility
        assert abs(heavy_hands_feasibility["spacingBefore"] - 11) < 0.1, heavy_hands_feasibility
        assert abs(heavy_hands_feasibility["spacingAfter"] - 11) < 0.1, heavy_hands_feasibility
        assert 40 < heavy_hands_feasibility["best"]["batteryUsed"] < 70, heavy_hands_feasibility
        assert heavy_hands_feasibility["home"] == {
            "label": "FORWARD LZ", "marker": True, "markerChildren": 9,
            "aligned": True, "thermal": True,
        }, heavy_hands_feasibility
        assert "behind" not in heavy_hands_feasibility["bomberFeedback"].lower(), heavy_hands_feasibility
        assert "flank" not in heavy_hands_feasibility["bomberFeedback"].lower(), heavy_hands_feasibility
        train_stopped = page.evaluate("""() => {
          const d = BP.world.drone;
          const locomotive = d.combatVehicles.find(v => v.label === 'DIESEL LOCOMOTIVE');
          const tanker = d.combatVehicles.find(v => v.label === 'FUEL TANKER');
          d.combatImpact(locomotive.pos.clone());
          const before = tanker.pos.clone();
          tanker.update(5, BP.world.solids);
          return { locomotiveDead: locomotive.dead, tankerSpeed: tanker.speed,
            tankerMovement: tanker.pos.distanceTo(before), radio: d.result.textContent };
        }""")
        assert train_stopped["locomotiveDead"] and train_stopped["tankerSpeed"] == 0, train_stopped
        assert train_stopped["tankerMovement"] == 0 and "CONSIST STOPPED" in train_stopped["radio"], train_stopped
        page.evaluate("() => BP.world.drone.onFailed('QA PHASE RETRY')")
        page.wait_for_function("() => BP.mode === 'debrief'")
        page.locator("#debrief-retry").click()
        page.wait_for_function("""() => BP.mode === 'playing'
          && BP.world?.objectiveIdx === 1
          && BP.phase?.id === 'payload-check'
          && BP.world?.drone?.mode === 'bomber'""")

        # Inspect the complete state sequence and telemetry-derived coaching on one real hit.
        page.evaluate("() => BP.startLevel(11)")
        page.wait_for_function("() => BP.world?.level?.id === 11 && !!BP.world.drone")
        assert page.evaluate("() => BP.world.drone.attemptState") == "ready"
        page.evaluate("""() => {
          BP.world.drone.attemptStateTime = 1;
          BP.world.drone.updateAttemptState(.1, { firePressed: true });
        }""")
        page.wait_for_function("() => BP.world.drone.attemptState === 'flying'")
        page.evaluate("() => BP.world.drone.skipLessons?.()")
        page.wait_for_timeout(250)
        strike_required_target(page)
        lifecycle = [page.evaluate("() => BP.world.drone.attemptState")]
        page.evaluate("""() => {
          BP.world.drone.attemptStateTime = 3;
          BP.world.drone.updateAttemptState(.1, {});
        }""")
        page.wait_for_function("() => BP.world.drone.attemptState === 'replay'")
        lifecycle.append("replay")
        if args.output:
            page.screenshot(path=args.output / "strike-replay.png")
        page.evaluate("""() => {
          BP.world.drone.attemptStateTime = 8;
          BP.world.drone.updateAttemptState(.1, {});
        }""")
        page.wait_for_function("() => BP.world.drone.attemptState === 'debrief'")
        lifecycle.append("debrief")
        if args.output:
            page.screenshot(path=args.output / "attempt-debrief.png")
        report = page.evaluate("""() => ({
          samples: BP.world.drone.review.samples.length,
          good: BP.world.drone.review.coaching.good.length,
          improve: BP.world.drone.review.coaching.improve.length,
          instruction: BP.world.drone.review.coaching.instruction,
          aspect: BP.world.drone.review.aspect,
          map: !!document.querySelector('.fpv-aar-map'),
          profile: !!document.querySelector('.fpv-aar-profile'),
        })""")
        page.evaluate("""() => {
          BP.world.drone.attemptStateTime = 1;
          BP.world.drone.updateAttemptState(.1, { firePressed: true });
        }""")
        page.wait_for_function("() => BP.world.drone.attemptState === 'ready'")
        lifecycle.append("ready")
        page.evaluate("""() => {
          BP.world.drone.attemptStateTime = 1;
          BP.world.drone.updateAttemptState(.1, { firePressed: true });
        }""")
        page.wait_for_function("() => BP.world.drone.attemptState === 'flying'")
        lifecycle.append("flying")
        assert lifecycle == ["impact_hold", "replay", "debrief", "ready", "flying"], lifecycle
        assert report["samples"] > 0, report
        assert 0 < report["good"] <= 2 and report["improve"] <= 2, report
        assert report["aspect"] == "REAR", report
        assert report["instruction"] and report["map"] and report["profile"], report

        # A completed lane remains under player control: FIRE serves a fresh target with a
        # new authored offset, while F is reserved for advancing to the next stage.
        page.evaluate("() => BP.startLevel(12)")
        page.wait_for_function("() => BP.world?.level?.id === 12 && !!BP.world.drone")
        accelerate_review(page)
        repeat_before = page.evaluate("""() => {
          const d = BP.world.drone;
          window.__practiceTarget = d.combatVehicles[0];
          return { objective: BP.world.objectiveIdx, x: d.combatVehicles[0].pos.x,
            z: d.combatVehicles[0].pos.z };
        }""")
        strike_required_target(page)
        accelerate_review(page, advance_completed=False)
        repeat_after = page.evaluate("""() => ({
          objective: BP.world.objectiveIdx,
          fresh: BP.world.drone.combatVehicles[0] !== window.__practiceTarget,
          alive: !BP.world.drone.combatVehicles[0].dead,
          x: BP.world.drone.combatVehicles[0].pos.x,
          z: BP.world.drone.combatVehicles[0].pos.z,
          state: BP.world.drone.attemptState,
        })""")
        assert repeat_after["objective"] == repeat_before["objective"] == 0, (repeat_before, repeat_after)
        assert repeat_after["fresh"] and repeat_after["alive"], repeat_after
        assert (repeat_after["x"], repeat_after["z"]) != (repeat_before["x"], repeat_before["z"]), (repeat_before, repeat_after)

        # Trench teams are targets of opportunity: they score a kill and expend the FPV,
        # but the assigned moving vehicle remains alive and the phase cannot advance.
        page.evaluate("() => BP.startLevel(12)")
        page.wait_for_function("() => BP.world?.level?.id === 12 && !!BP.world.drone")
        accelerate_review(page)
        opportunity = page.evaluate("""() => {
          const d = BP.world.drone;
          const target = d.combatVehicles.find(v => v.optional && v.kind === 'infantry');
          const required = d.combatVehicles.find(v => !v.optional && !v.decoy && !v.protected);
          const kills = BP.world.stats.kills;
          const impact = target.pos.clone();
          target.mesh.userData.crew?.[0]?.getWorldPosition(impact);
          d.fpvDetonate(impact);
          return {
            optionalCount: d.combatVehicles.filter(v => v.optional && v.kind === 'infantry').length,
            targetDead: target.dead, requiredAlive: !required.dead,
            killAdded: BP.world.stats.kills - kills,
            pendingComplete: d.pendingMissionComplete,
            objective: BP.world.objectiveIdx,
            result: d.review.reason,
          };
        }""")
        assert opportunity["optionalCount"] >= 2 and opportunity["targetDead"], opportunity
        assert opportunity["killAdded"] == 1 and opportunity["requiredAlive"], opportunity
        assert not opportunity["pendingComplete"] and opportunity["objective"] == 0, opportunity
        assert "TARGET OF OPPORTUNITY" in opportunity["result"], opportunity

        # Once an aircraft has left the launch ring, returning with the task still live is
        # an immediate neutral battery swap: no attempt, pass or failure is recorded, and
        # the moving target is recreated at the beginning of a fresh presentation.
        page.evaluate("() => BP.startLevel(12)")
        page.wait_for_function("() => BP.world?.level?.id === 12 && !!BP.world.drone")
        accelerate_review(page)
        battery_change = page.evaluate("""() => {
          const d = BP.world.drone;
          const required = d.combatVehicles.find(v => !v.optional && !v.decoy && !v.protected);
          const kills = BP.world.stats.kills;
          const objective = BP.world.objectiveIdx;
          const attempts = d.attempts.length;
          d.pos.copy(d.launch); d.pos.x += (d.training.returnRadius ?? 14) * 2;
          d.updateFpvFamily(.1, { firePressed: false, nadePressed: false }, BP.world.solids);
          d.battery = 7;
          d.pos.copy(d.launch);
          d.updateFpvFamily(.1, { firePressed: false, nadePressed: false }, BP.world.solids);
          const freshRequired = d.combatVehicles.find(v => !v.optional && !v.decoy && !v.protected);
          return {
            state: d.attemptState, battery: d.battery,
            freshTarget: freshRequired !== required, targetAlive: !freshRequired.dead,
            attemptsAdded: d.attempts.length - attempts,
            killsAdded: BP.world.stats.kills - kills,
            objectiveStayed: BP.world.objectiveIdx === objective,
            complete: d.complete, failed: d.failedOut,
            title: d.readyPanel.querySelector('.fpv-ready-title').textContent,
          };
        }""")
        assert battery_change["state"] == "ready" and battery_change["battery"] == 100, battery_change
        assert battery_change["freshTarget"] and battery_change["targetAlive"], battery_change
        assert battery_change["attemptsAdded"] == 0 and battery_change["killsAdded"] == 0, battery_change
        assert battery_change["objectiveStayed"] and not battery_change["complete"] and not battery_change["failed"], battery_change
        assert "FULL BATTERY" in battery_change["title"], battery_change

        # Heavy Hands regression: exhausting the reusable Heron's payload with targets still
        # alive must offer a fresh run, restore bombs and avoid an immediate debrief loop.
        page.evaluate("() => BP.startLevel(13)")
        page.wait_for_function("() => BP.world?.level?.id === 13 && !!BP.world.drone")
        accelerate_review(page)
        heron_nadir = page.evaluate("""() => {
          const d = BP.world.drone;
          d.skipLessons?.();
          d.pos.set(0, 24, 300); d.vel.set(0, 0, 0); d.yaw = 0;
          d.pitch = -85 * Math.PI / 180;
          const input = {
            lookDelta: { x: 0, y: 0 }, move: { x: 0, y: -1 },
            ads: false, crouch: false, firePressed: false, nadePressed: false,
            breachPressed: false, reloadPressed: false,
          };
          d.update(.2, input, BP.world.solids);
          d.updateFpvOsd(0);
          const locked = { nadir: d.payloadNadir, vy: d.vel.y, vz: d.vel.z,
            pitch: d.pitch * 180 / Math.PI, mode: d.osd.mode.textContent };
          d.pitch = -75 * Math.PI / 180;
          input.move.y = 0;
          d.update(.02, input, BP.world.solids);
          return { ...locked, released: !d.payloadNadir };
        }""")
        assert heron_nadir["nadir"] and heron_nadir["released"], heron_nadir
        assert abs(heron_nadir["vy"]) < 0.01 and heron_nadir["vz"] < 0, heron_nadir
        assert "NADIR LOCK" in heron_nadir["mode"] and "ALT HOLD" in heron_nadir["mode"], heron_nadir
        assert heron_nadir["pitch"] < -80, heron_nadir

        # Desktop C is held altitude input even though infantry crouch remains a toggle.
        # Once released, a latched crouch flag cannot pull the Heron into the ground, and
        # looking down while flying forward cannot introduce a hidden descent component.
        page.evaluate("() => { BP.input.crouch = false; }")
        page.keyboard.down("c")
        assert page.evaluate("() => BP.input.droneDescend")
        page.keyboard.up("c")
        released_descent = page.evaluate("() => ({ held: BP.input.droneDescend, crouch: BP.input.crouch })")
        assert not released_descent["held"] and released_descent["crouch"], released_descent
        heron_altitude_hold = page.evaluate("""() => {
          const d = BP.world.drone;
          d.pos.set(0, 24, 300); d.vel.set(0, 0, 0); d.yaw = 0;
          d.pitch = -45 * Math.PI / 180;
          const neutral = {
            lookDelta: { x: 0, y: 0 }, move: { x: 0, y: -1 },
            desktopAltitude: true, droneClimb: false, droneDescend: false,
            ads: false, crouch: true, firePressed: false, nadePressed: false,
            breachPressed: false, reloadPressed: false,
          };
          const startY = d.pos.y;
          for (let i = 0; i < 60; i++) d.update(.016, neutral, BP.world.solids);
          const forwardHold = { deltaY: d.pos.y - startY, vy: d.vel.y };
          neutral.move.y = 0;
          neutral.droneDescend = true;
          d.update(.1, neutral, BP.world.solids);
          const commandedVy = d.vel.y;
          neutral.droneDescend = false;
          for (let i = 0; i < 60; i++) d.update(.016, neutral, BP.world.solids);
          d.updateFpvOsd(0);
          return { ...forwardHold, commandedVy, releasedVy: d.vel.y,
            mode: d.osd.mode.textContent };
        }""")
        assert abs(heron_altitude_hold["deltaY"]) < 0.02, heron_altitude_hold
        assert abs(heron_altitude_hold["vy"]) < 0.01, heron_altitude_hold
        assert heron_altitude_hold["commandedVy"] < 0, heron_altitude_hold
        assert abs(heron_altitude_hold["releasedVy"]) < 0.01, heron_altitude_hold
        assert "GIMBAL" in heron_altitude_hold["mode"] and "ALT HOLD" in heron_altitude_hold["mode"], heron_altitude_hold
        heron_exhausted = page.evaluate("""() => {
          const d = BP.world.drone;
          d.skipLessons?.();
          d.bombs = 0;
          d.updateFpvFamily(.1, {
            firePressed: false, nadePressed: false, breachPressed: false,
          }, BP.world.solids);
          return { state: d.attemptState, signal: d.signal,
            runReset: d.pendingRunReset, bombs: d.bombs };
        }""")
        assert heron_exhausted["state"] == "impact_hold" and heron_exhausted["runReset"], heron_exhausted
        assert heron_exhausted["signal"] >= 0.35, heron_exhausted
        page.evaluate("""() => {
          const d = BP.world.drone;
          d.attemptStateTime = 3; d.updateAttemptState(.1, {});
          d.attemptStateTime = 8; d.updateAttemptState(.1, {});
        }""")
        page.wait_for_function("() => BP.world.drone.attemptState === 'debrief'")
        heron_prompt = page.locator(".fpv-debrief-panel .fpv-review-key").inner_text()
        assert "REPEAT THIS PHASE" in heron_prompt and "ADVANCE TO NEXT PHASE" in heron_prompt, heron_prompt
        page.evaluate("""() => {
          const d = BP.world.drone;
          d.attemptStateTime = 1;
          d.updateAttemptState(.1, { firePressed: true });
        }""")
        heron_reset = page.evaluate("""() => ({
          state: BP.world.drone.attemptState,
          bombs: BP.world.drone.bombs,
          bombsTotal: BP.world.drone.bombsTotal,
          targetsAlive: BP.world.drone.combatVehicles.every(v => !v.dead),
          runReset: BP.world.drone.pendingRunReset,
        })""")
        assert heron_reset["state"] == "ready" and heron_reset["targetsAlive"], heron_reset
        assert heron_reset["bombs"] == heron_reset["bombsTotal"] and not heron_reset["runReset"], heron_reset
        page.evaluate("""() => {
          const d = BP.world.drone;
          d.attemptStateTime = 1;
          d.updateAttemptState(.1, { firePressed: true });
          d.updateFpvFamily(.1, { firePressed: false, nadePressed: false }, BP.world.solids);
        }""")
        assert page.evaluate("() => BP.world.drone.attemptState") == "flying"

        # Range Control identifies what remains, then orders an actual return after the
        # final effect; the stage cannot complete while the reusable bomber is still away.
        page.evaluate("() => BP.startLevel(13)")
        page.wait_for_function("() => BP.world?.level?.id === 13 && !!BP.world.drone")
        accelerate_review(page)
        heron_retask = page.evaluate("""() => {
          const d = BP.world.drone;
          d.skipLessons?.();
          d.pos.set(120, 18, 100);
          const first = d.combatVehicles[0];
          d.combatImpact(first.pos.clone().add({ x: 0, y: .2, z: 0 }));
          d.updateFpvOsd(0);
          return {
            message: d.result.textContent,
            egress: d.egressRequired,
            alive: d.combatVehicles.filter(v => !v.dead && !v.optional && !v.decoy && !v.protected).length,
            osd: d.osd.link.textContent,
          };
        }""")
        assert not heron_retask["egress"] and heron_retask["alive"] == 1, heron_retask
        assert "RETASK DRIFT WAGON" in heron_retask["message"] and "TGT 1/2" in heron_retask["osd"], heron_retask
        heron_rtb = page.evaluate("""() => {
          const d = BP.world.drone;
          const last = d.combatVehicles.find(v => !v.dead && !v.optional && !v.decoy && !v.protected);
          d.combatImpact(last.pos.clone().add({ x: 0, y: .2, z: 0 }));
          const [firstTarget, secondTarget] = d.combatVehicles;
          const requiredBaseline = d.attemptStart.distanceTo(firstTarget.pos)
            + firstTarget.pos.distanceTo(secondTarget.pos)
            + secondTarget.pos.distanceTo(d.launch);
          d.attemptDistance = requiredBaseline * 1.12;
          d.updateFpvFamily(.1, { firePressed: false, nadePressed: false }, BP.world.solids);
          return { message: d.result.textContent, egress: d.egressRequired,
            state: d.attemptState, complete: d.pendingMissionComplete };
        }""")
        assert heron_rtb["egress"] and heron_rtb["state"] == "flying" and not heron_rtb["complete"], heron_rtb
        assert "RETURN TO LAUNCH" in heron_rtb["message"], heron_rtb
        page.evaluate("""() => {
          const d = BP.world.drone;
          d.pos.copy(d.launch);
          d.updateFpvFamily(.1, { firePressed: false, nadePressed: false }, BP.world.solids);
        }""")
        assert page.evaluate("() => BP.world.drone.attemptState") == "impact_hold"
        heron_route = page.evaluate("""() => ({
          efficiency: BP.world.drone.review.routeEfficiency,
          legs: BP.world.drone.review.requiredLegs,
          returnIncluded: BP.world.drone.review.returnIncluded,
          improve: BP.world.drone.review.coaching.improve,
          baseline: BP.world.drone.review.baselineDistance,
        })""")
        assert heron_route["legs"] == 3 and heron_route["returnIncluded"], heron_route
        assert 1.1 < heron_route["efficiency"] < 1.15 and heron_route["baseline"] > 0, heron_route
        assert not any("route" in item.lower() or "turn" in item.lower() for item in heron_route["improve"]), heron_route

        completed = {}
        for level_id in range(11, 21):
            print(f"QA level {level_id}", flush=True)
            completed[level_id] = finish_level(page, level_id)

        # Focused authored-system checks that do not depend on mission completion shortcuts.
        page.evaluate("() => BP.startLevel(15)")
        page.wait_for_function("() => BP.world?.level?.id === 15 && !!BP.world.drone")
        linked = page.evaluate("""() => {
          const d = BP.world.drone;
          const source = d.combatVehicles.find(v => v.jammerId);
          const jammer = d.jammers[0];
          const before = d.jammerLive(jammer);
          const training = {
            aligned: Math.hypot(source.pos.x - jammer.x, source.pos.z - jammer.z) < 1,
            signalFloor: jammer.signalFloor,
            falloff: jammer.falloff,
            linkLossGrace: d.training.linkLossGrace,
          };
          d.skipLessons?.();
          d.attemptState = 'flying';
          d.pos.set(jammer.x, 18, jammer.z);
          const neutral = {
            lookDelta: { x: 0, y: 0 }, move: { x: 0, y: 0 }, ads: false, crouch: false,
            firePressed: false, breachPressed: false, reloadPressed: false,
          };
          for (let i = 0; i < 80; i++) d.update(.1, neutral, BP.world.solids);
          const centerSignal = d.signal;
          const survivable = d.attemptState === 'flying' && d.signal > .1;
          d.pos.set(jammer.x + jammer.r + 30, 8, jammer.z);
          d.update(.1, neutral, BP.world.solids);
          const recovered = d.signal > .65;
          source.damage(source.maxHealth);
          return { before, after: d.jammerLive(jammer), linked: source.jammerId,
            training, survivable, recovered, centerSignal };
        }""")
        assert linked["before"] and not linked["after"] and linked["linked"], linked
        assert linked["survivable"] and linked["recovered"], linked
        assert linked["training"] == {
            "aligned": True, "signalFloor": 0.18, "falloff": 0.8, "linkLossGrace": 6,
        }, linked

        page.evaluate("() => BP.startLevel(17)")
        page.wait_for_function("() => BP.world?.level?.id === 17 && !!BP.world.drone")
        hunt = page.evaluate("""async () => {
          const { hasLOS } = await import('./src/physics.js');
          const d = BP.world.drone;
          const target = d.combatVehicles.find(v => v.requiresIdentification && !v.decoy);
          const s = target.shelter;
          const worldPoint = (u, v) => ({
            x: s.x + u * Math.cos(s.yaw) - v * Math.sin(s.yaw),
            z: s.z + u * Math.sin(s.yaw) + v * Math.cos(s.yaw),
          });
          const doorOutside = worldPoint(s.doorU, -s.D / 2 - 3);
          const sideOutside = worldPoint(s.L / 2 + 3, 0);
          const y = target.pos.y + 1.2;
          const base = {
            effect: 'DESTROYED', aspect: 'FLANK', targetCaged: false,
            targetShelter: s, firstPass: true, routeEfficiency: 1,
            distance: 100, baselineDistance: 100, returnIncluded: false,
            jamTime: 0, minSignal: 1, batteryAtEnd: 80, chaseTime: 0,
            maxAgl: 0, terminalCorrection: 0, acquired: true,
          };
          const successCoach = d.coachAttempt(base);
          const missCoach = d.coachAttempt({ ...base, effect: 'MISS' });
          return {
            requiresId: d.combatVehicles.some(v => v.requiresIdentification),
            decoys: d.combatVehicles.filter(v => v.decoy).length,
            abort: d.training.allowAbort,
            shelter: { kind: s.kind, state: s.state, entry: s.entry },
            inside: Math.hypot(target.pos.x - s.x, target.pos.z - s.z) < 0.1,
            doorOpen: hasLOS(BP.world.solids,
              doorOutside.x, y, doorOutside.z, target.pos.x, y, target.pos.z),
            sideSolid: !hasLOS(BP.world.solids,
              sideOutside.x, y, sideOutside.z, target.pos.x, y, target.pos.z),
            successFeedback: successCoach.good.join(' '),
            missFeedback: missCoach.instruction,
          };
        }""")
        assert hunt["requiresId"] and hunt["decoys"] == 2 and hunt["abort"], hunt
        assert hunt["shelter"] == {
            "kind": "barn", "state": "damaged", "entry": "doorway",
        }, hunt
        assert hunt["inside"] and hunt["doorOpen"] and hunt["sideSolid"], hunt
        assert "inside" in hunt["successFeedback"] and "doorway" in hunt["successFeedback"], hunt
        assert "threshold" in hunt["missFeedback"] and "doorway" in hunt["missFeedback"], hunt

        page.evaluate("() => BP.startLevelAt(17, 1)")
        page.wait_for_function("""() => BP.world?.level?.id === 17
          && BP.world?.objectiveIdx === 1 && BP.phase?.id === 'hunt-check'
          && !!BP.world.drone""")
        roof_entry = page.evaluate("""async () => {
          const { hasLOS } = await import('./src/physics.js');
          const target = BP.world.drone.combatVehicles.find(v =>
            v.requiresIdentification && !v.decoy);
          const s = target.shelter;
          return {
            shelter: { kind: s.kind, state: s.state, entry: s.entry },
            inside: Math.hypot(target.pos.x - s.x, target.pos.z - s.z) < .1,
            roofOpen: hasLOS(BP.world.solids,
              target.pos.x, target.pos.y + 10, target.pos.z,
              target.pos.x, target.pos.y + 1, target.pos.z),
          };
        }""")
        assert roof_entry == {
            "shelter": {"kind": "barn", "state": "gutted", "entry": "roof opening"},
            "inside": True, "roofOpen": True,
        }, roof_entry

        page.evaluate("() => BP.startLevel(18)")
        page.wait_for_function("() => BP.world?.level?.id === 18 && !!BP.world.drone")
        broken = page.evaluate("""() => ({
          pulse: BP.world.drone.jammers.some(j => !!j.pulse),
          alt: !!BP.objective.minimap?.alternateRoute,
          abort: BP.world.drone.training.allowAbort,
        })""")
        assert all(broken.values()), broken

        result = {
            "catalogue": catalogue,
            "lifecycle": lifecycle,
            "report": report,
            "completedAttempts": completed,
            "linkedJammer": linked,
            "hunt": hunt,
            "roofEntry": roof_entry,
            "brokenPlan": broken,
            "errors": errors[:10],
        }
        print(json.dumps(result, indent=2))
        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    main()
