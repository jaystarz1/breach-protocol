#!/usr/bin/env python3
"""End-to-end QA for the Levels 21-24 FPV interdiction serial (air-to-air).

The serial is a gunnery progression: 21 FIRST CONTACT (air-start contact drills,
no evasion), 22 EVASIVE CONTACT (air-start drills against manoeuvring targets),
23 THE HUNT (full sorties from the pad, uncued then radar-cued), 24 NIGHT WAR
(thermal identification stalk, then the raid with the escape loss path).
"""
import argparse
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


EXPECTED = ["FIRST CONTACT", "EVASIVE CONTACT", "HUNTER-KILLER", "NIGHT WAR"]


def accelerate_review(page, advance_completed=True):
    """Advance review states while preserving the runtime transition code paths."""
    for _ in range(120):
        state = page.evaluate("""() => {
          const d = BP.world?.drone;
          return { mode: BP.mode, state: d?.attemptState || null,
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
      if (!target) return { target: null };
      target.identified = true;
      const impact = target.pos.clone();
      impact.y += .6;
      d.fpvDetonate(impact);
      return { target: target.label };
    }""")


def finish_level(page, level_id):
    page.evaluate("id => BP.startLevel(id)", level_id)
    page.wait_for_function(
        "id => BP.mode === 'playing' && BP.world?.level?.id === id && !!BP.world.drone",
        arg=level_id,
    )
    attempts = 0
    started = time.monotonic()
    while time.monotonic() - started < 240:
        state = page.evaluate("""() => ({
          mode: BP.mode,
          state: BP.world?.drone?.attemptState || null,
          required: BP.world?.drone?.combatVehicles.filter(v =>
            !v.dead && !v.decoy && !v.protected && !v.optional).length ?? 0,
        })""")
        if state["mode"] == "debrief":
            return attempts
        if state["state"] == "flying":
            if state["required"]:
                strike_required_target(page)
                attempts += 1
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

        catalogue = page.evaluate("""() => BP.LEVELS.filter(level =>
          level.id >= 21 && level.id <= 24).map(level => {
          const steps = level.objectives.flatMap(p => p.steps || [p])
            .filter(s => s.type === 'drone');
          return {
            id: level.id, name: level.name, timeOfDay: level.timeOfDay,
            phases: level.objectives.length,
            airborneTargets: steps.flatMap(s => s.vehicles || [])
              .filter(v => v.airborne).length,
            groundRequired: steps.flatMap(s => s.vehicles || [])
              .filter(v => !v.airborne && !v.optional).length,
            radarBearing: steps.some(s => s.training?.radarBearing),
            engagementBounds: steps.some(s => !!s.training?.engagementBounds),
            ceilings: steps.map(s => s.ceiling),
            launchAlts: steps.map(s => (s.launch || [0, 0, 0])[1]),
            startBatteries: steps.map(s => s.startBattery ?? 100),
            startSpeeds: steps.map(s => s.startSpeed ?? 0),
            evasive: steps.flatMap(s => s.vehicles || [])
              .filter(v => v.airborne && v.evasion).length,
            lessons: steps.reduce((n, s) => n + (s.lessons?.length || 0), 0),
          };
        })""")
        assert [entry["name"] for entry in catalogue] == EXPECTED, catalogue
        assert [entry["id"] for entry in catalogue] == [21, 22, 23, 24], catalogue
        assert [entry["timeOfDay"] for entry in catalogue] == [
            "day", "day", "day", "night"], catalogue
        assert [entry["phases"] for entry in catalogue] == [3, 3, 2, 2], catalogue
        assert [entry["airborneTargets"] for entry in catalogue] == [3, 3, 2, 4], catalogue
        assert all(entry["groundRequired"] == 0 for entry in catalogue), catalogue
        assert [entry["radarBearing"] for entry in catalogue] == [
            False, True, True, True], catalogue
        assert [entry["engagementBounds"] for entry in catalogue] == [
            False, False, False, True], catalogue
        assert all(min(entry["ceilings"]) >= 90 for entry in catalogue), catalogue
        # The drill missions start every airframe on an airborne perch; the hunt and the
        # night war launch from the pad. FIRST CONTACT's targets never manoeuvre.
        assert all(alt > 30 for entry in catalogue[:2] for alt in entry["launchAlts"]), catalogue
        assert all(alt == 0 for entry in catalogue[2:] for alt in entry["launchAlts"]), catalogue
        # The drill perch stands in for an approach that was never flown: battery
        # degrades down the ladder, and the later drills hand over the aircraft
        # already at speed. The pad missions start with a full pack from a standstill.
        assert catalogue[0]["startBatteries"] == [92, 90, 88], catalogue
        assert catalogue[1]["startBatteries"] == [86, 83, 78], catalogue
        assert catalogue[0]["startSpeeds"] == [0, 8, 10], catalogue
        assert catalogue[1]["startSpeeds"] == [10, 12, 14], catalogue
        assert all(entry["startBatteries"] == [100] * len(entry["startBatteries"])
                   for entry in catalogue[2:]), catalogue
        assert all(entry["startSpeeds"] == [0] * len(entry["startSpeeds"])
                   for entry in catalogue[2:]), catalogue
        assert catalogue[0]["evasive"] == 0, catalogue
        assert all(entry["evasive"] == entry["airborneTargets"]
                   for entry in catalogue[1:]), catalogue
        assert [entry["lessons"] for entry in catalogue] == [4, 4, 2, 4], catalogue

        # The air start itself: mission 21 opens at altitude, target already inside
        # acquisition range, nose on the target, first target a true hover.
        page.evaluate("() => BP.startLevel(21)")
        page.wait_for_function("() => BP.world?.level?.id === 21 && !!BP.world.drone")
        accelerate_review(page)
        air_start = page.evaluate("""async () => {
          const { droneTerrainHeight } = await import('./src/drone.js');
          const d = BP.world.drone;
          d.skipLessons?.();
          const target = d.combatVehicles.find(v => v.airborne);
          const bearing = Math.atan2(-(target.pos.x - d.pos.x), -(target.pos.z - d.pos.z));
          const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
          return {
            agl: d.pos.y - droneTerrainHeight(d.pos.x, d.pos.z),
            distance: d.pos.distanceTo(target.pos),
            acquireRange: d.training.acquireRange,
            offBore: Math.abs(wrap(d.yaw - bearing)),
            hover: target.speed === 0 && target.route.length === 0,
            evasion: !!target.evasion,
            battery: d.battery,
            groundSpeedMs: d.vel.length() * d.metersPerUnit,
          };
        }""")
        assert air_start["agl"] > 30, air_start
        assert air_start["distance"] < air_start["acquireRange"], air_start
        assert air_start["offBore"] < 0.2, air_start
        assert air_start["hover"] and not air_start["evasion"], air_start
        # Degraded pack from the notional approach; the first drill starts from a hover.
        assert 85 < air_start["battery"] <= 92, air_start
        assert air_start["groundSpeedMs"] < 1, air_start

        # The critical regression: an airborne target holds authored AGL across terrain
        # instead of taking the ground snap, weaves and climbs under threat, settles when
        # the threat opens, and falls to the dirt when killed. Level 22's first drill
        # target carries the evasion config the drill teaches.
        page.evaluate("() => BP.startLevel(22)")
        page.wait_for_function("() => BP.world?.level?.id === 22 && !!BP.world.drone")
        accelerate_review(page)
        # Hot handover: the first evasion drill starts with a degraded pack and the
        # aircraft already moving on the launch yaw. The live sim damps the entry
        # speed and drains the pack from the moment the gate opens, so bound loosely.
        handover = page.evaluate("""() => {
          const d = BP.world.drone;
          d.skipLessons?.();
          return {
            startBattery: d.startBattery, battery: d.battery,
            startSpeed: d.startSpeed,
            groundSpeedMs: d.vel.length() * d.metersPerUnit,
          };
        }""")
        assert handover["startBattery"] == 86, handover
        assert 80 < handover["battery"] <= 86, handover
        assert handover["startSpeed"] == 10, handover
        assert handover["groundSpeedMs"] > 2, handover
        flight = page.evaluate("""async () => {
          const { droneTerrainHeight } = await import('./src/drone.js');
          const d = BP.world.drone;
          d.skipLessons?.();
          const quad = d.combatVehicles.find(v => v.airborne);
          const agl = () => quad.pos.y - droneTerrainHeight(quad.pos.x, quad.pos.z);
          const aglSamples = [];
          for (let i = 0; i < 200; i++) {
            quad.update(.1, BP.world.solids, null);
            aglSamples.push(agl());
          }
          const cruiseMin = Math.min(...aglSamples.slice(20));
          const cruiseMax = Math.max(...aglSamples.slice(20));
          const threat = quad.pos.clone(); threat.x += 8;
          let lateralTravel = 0;
          for (let i = 0; i < 90; i++) {
            const prev = quad.pos.clone();
            threat.copy(quad.pos); threat.x += 8; threat.y -= 2;
            quad.update(.1, BP.world.solids, threat);
            lateralTravel += quad.pos.distanceTo(prev);
          }
          const evadedClimb = quad.evadeClimb || 0;
          const evadingUnderThreat = quad.evading;
          const far = quad.pos.clone(); far.x += 900;
          for (let i = 0; i < 120; i++) quad.update(.1, BP.world.solids, far);
          const settled = !quad.evading;
          const rotorSpin = (() => {
            const spinners = [];
            quad.mesh.traverse(o => {
              if (o.geometry?.type === 'CylinderGeometry'
                && o.geometry.parameters.radialSegments === 3) spinners.push(o);
            });
            const start = spinners.map(o => o.rotation.y);
            quad.update(.1, BP.world.solids, null);
            return spinners.some((o, i) => o.rotation.y !== start[i]);
          })();
          quad.damage(quad.maxHealth);
          for (let i = 0; i < 400; i++) quad.update(.1, BP.world.solids, null);
          const wreckAgl = agl();
          return {
            cruiseMin, cruiseMax, evadingUnderThreat, evadedClimb,
            lateralTravel, settled, rotorSpin, wreckAgl,
            destroyedFlag: !!quad.mesh.userData.destroyed,
          };
        }""")
        assert 45 < flight["cruiseMin"] and flight["cruiseMax"] < 75, flight
        assert flight["evadingUnderThreat"] and flight["evadedClimb"] > 0.5, flight
        assert flight["settled"] and flight["rotorSpin"], flight
        assert flight["wreckAgl"] < 1.5 and flight["destroyedFlag"], flight

        # Radar cueing: the OSD carries the TRK plot on cued missions; the contact
        # drills stay uncued. Night War's stalk phase is cued from the first frame.
        page.evaluate("() => BP.startLevel(24)")
        page.wait_for_function("() => BP.world?.level?.id === 24 && !!BP.world.drone")
        accelerate_review(page)
        radar = page.evaluate("""() => {
          const d = BP.world.drone;
          d.skipLessons?.();
          d.updateFpvOsd(0);
          const track = d.combatVehicles.find(v => v.airborne);
          return {
            osd: d.osd.dist.textContent,
            radarBearing: !!d.training.radarBearing,
            acquireRange: d.training.acquireRange,
            targetSpeedKmh: track.speed * d.metersPerUnit * 3.6,
            ceiling: d.ceiling,
            requiresId: track.requiresIdentification,
            identified: track.identified,
          };
        }""")
        assert "TRK" in radar["osd"] and "ALT" in radar["osd"], radar
        assert radar["radarBearing"] and radar["acquireRange"] >= 400, radar
        assert 90 <= radar["targetSpeedKmh"] <= 120, radar
        assert radar["ceiling"] >= 130, radar

        # Night identification: the ZALA requires a confirmed track before credit.
        assert radar["requiresId"] and not radar["identified"], radar
        night = page.evaluate("""() => {
          const d = BP.world.drone;
          const zala = d.combatVehicles.find(v => v.airborne);
          d.fpvDetonate(zala.pos.clone());
          return { effect: d.review?.effect, dead: zala.dead };
        }""")
        assert night["effect"] == "UNCONFIRMED", night
        assert not night["dead"], night

        page.evaluate("() => BP.startLevel(21)")
        page.wait_for_function("() => BP.world?.level?.id === 21 && !!BP.world.drone")
        accelerate_review(page)
        uncued = page.evaluate("""() => {
          const d = BP.world.drone;
          d.skipLessons?.();
          d.updateFpvOsd(0);
          return { osd: d.osd.dist.textContent };
        }""")
        assert "TRK" not in uncued["osd"], uncued

        # The escape loss path lives in Night War's raid phase: complete the stalk,
        # then a required track over the southern boundary fails the mission as a
        # critical failure while the optional orbiter exiting must not.
        page.evaluate("() => BP.startLevel(24)")
        page.wait_for_function("() => BP.world?.level?.id === 24 && !!BP.world.drone")
        accelerate_review(page)
        strike_required_target(page)
        accelerate_review(page)
        started = time.monotonic()
        while time.monotonic() - started < 60:
            ready = page.evaluate("""() => {
              const d = BP.world?.drone;
              return !!d?.training?.engagementBounds
                && ['ready', 'flying'].includes(d.attemptState);
            }""")
            if ready:
                break
            accelerate_review(page)
            page.wait_for_timeout(100)
        else:
            raise AssertionError("raid phase never armed")
        accelerate_review(page)
        escape = page.evaluate("""() => {
          const d = BP.world.drone;
          d.skipLessons?.();
          const optional = d.combatVehicles.find(v => v.airborne && v.optional);
          optional.pos.z = 540;
          d.updateFpvFamily(.1, { firePressed: false, nadePressed: false }, BP.world.solids);
          const optionalTolerated = d.attemptState === 'flying' && optional.exited;
          const alpha = d.combatVehicles.find(v =>
            v.airborne && !v.optional && !v.dead);
          alpha.pos.z = 540;
          d.updateFpvFamily(.1, { firePressed: false, nadePressed: false }, BP.world.solids);
          return {
            optionalTolerated,
            state: d.attemptState,
            reason: d.review?.reason || '',
            failure: d.pendingMissionFailure,
          };
        }""")
        assert escape["optionalTolerated"], escape
        assert escape["state"] == "impact_hold", escape
        assert "EXITED" in escape["reason"], escape
        assert escape["failure"], escape

        # Full fly-through: every mission completes on the standard strike loop,
        # phase to phase, drill to drill.
        completed = {}
        for level_id in range(21, 25):
            print(f"QA level {level_id}", flush=True)
            completed[level_id] = finish_level(page, level_id)

        result = {
            "catalogue": catalogue,
            "airStart": air_start,
            "handover": handover,
            "flight": flight,
            "radar": radar,
            "escape": escape,
            "night": night,
            "completedAttempts": completed,
            "errors": errors[:10],
        }
        print(json.dumps(result, indent=2))
        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    main()
