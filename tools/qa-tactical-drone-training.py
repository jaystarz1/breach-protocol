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

        catalogue = page.evaluate("""() => BP.LEVELS.slice(10).map(level => ({
          id: level.id, name: level.name, curriculum: level.curriculum,
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
        }))""")
        assert [entry["name"] for entry in catalogue] == EXPECTED, catalogue
        assert [entry["id"] for entry in catalogue] == list(range(11, 21)), catalogue
        assert all(entry["concepts"] <= 2 for entry in catalogue), catalogue
        assert all(entry["targetDuration"] == [600, 720] for entry in catalogue), catalogue
        assert all(not entry["oldDrain"] and entry["timedBattery"] for entry in catalogue), catalogue
        assert all(entry["coached"] and entry["unassisted"] for entry in catalogue), catalogue
        assert catalogue[1]["droneSteps"] == 10, catalogue

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

        # Heavy Hands regression: exhausting the reusable Heron's payload with targets still
        # alive must offer a fresh run, restore bombs and avoid an immediate debrief loop.
        page.evaluate("() => BP.startLevel(13)")
        page.wait_for_function("() => BP.world?.level?.id === 13 && !!BP.world.drone")
        accelerate_review(page)
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
        assert "NEW TARGET SET" in heron_prompt and "NEXT STAGE" in heron_prompt, heron_prompt
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
        hunt = page.evaluate("""() => ({
          requiresId: BP.world.drone.combatVehicles.some(v => v.requiresIdentification),
          decoys: BP.world.drone.combatVehicles.filter(v => v.decoy).length,
          abort: BP.world.drone.training.allowAbort,
        })""")
        assert hunt == {"requiresId": True, "decoys": 2, "abort": True}, hunt

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
            "brokenPlan": broken,
            "errors": errors[:10],
        }
        print(json.dumps(result, indent=2))
        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    main()
