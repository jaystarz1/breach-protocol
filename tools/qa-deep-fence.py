#!/usr/bin/env python3
"""Compatibility entry point for DEEP FENCE and the full tactical drone curriculum QA."""
import argparse
import json
import runpy
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    # DEEP FENCE is now Level 20 and depends on the complete ten-mission curriculum.
    # Delegate to the authoritative end-to-end drone-training QA while preserving this
    # historical command name for existing developer workflows.
    runpy.run_path(Path(__file__).with_name("qa-tactical-drone-training.py"), run_name="__main__")
    return
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.set_default_timeout(240000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.BP")
        page.evaluate("() => BP.startLevel(14)")
        page.wait_for_function(
            "() => BP.mode === 'playing' && BP.world?.level?.id === 14"
            " && !!BP.world.drone?.active")
        page.wait_for_timeout(600)

        # ---- Phase 1: the caged tank ----
        # Frontal hit first: the cage must defeat it and the next airframe must come up.
        front = page.evaluate("""() => {
          const d = BP.world.drone;
          const tank = d.combatVehicles[0];
          // The hull nose is local -X rotated by yaw; park the drone off the NOSE.
          const nose = { x: -Math.cos(tank.mesh.rotation.y), z: Math.sin(tank.mesh.rotation.y) };
          d.pos.set(tank.pos.x + nose.x * 2.0, tank.pos.y + 1.3, tank.pos.z + nose.z * 2.0);
          d.vel.set(0, 0, 0);
          return { cage: tank.cage, health: tank.health };
        }""")
        page.wait_for_function(
            "() => BP.world.drone.airframesLost === 1", timeout=30000)
        after_front = page.evaluate("""() => ({
          tankDead: BP.world.drone.combatVehicles[0].dead,
          tankHealth: BP.world.drone.combatVehicles[0].health,
          airframesLost: BP.world.drone.airframesLost,
          frozen: !!BP.world.drone.frozen,
        })""")
        # Rear-arc hit: the kill. The rear is local +X rotated by yaw.
        page.wait_for_timeout(400)
        page.evaluate("""() => {
          const d = BP.world.drone;
          const tank = d.combatVehicles[0];
          const rear = { x: Math.cos(tank.mesh.rotation.y), z: -Math.sin(tank.mesh.rotation.y) };
          d.pos.set(tank.pos.x + rear.x * 2.0, tank.pos.y + 1.3, tank.pos.z + rear.z * 2.0);
          d.vel.set(0, 0, 0);
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 1", timeout=30000)

        # ---- Phase 2: the BTR (no cage — any aspect kills) ----
        page.wait_for_function(
            "() => !!BP.world.drone?.active && BP.world.drone.mode === 'fpv'"
            " && BP.world.drone.combatVehicles.length === 1")
        page.wait_for_timeout(400)
        btr = page.evaluate("""() => {
          const d = BP.world.drone;
          const target = d.combatVehicles[0];
          d.pos.set(target.pos.x + 1.6, target.pos.y + 1.3, target.pos.z + 1.2);
          d.vel.set(0, 0, 0);
          return { label: target.label, cage: target.cage };
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 2", timeout=30000)

        # ---- Phase 3: the bomber over the siding ----
        page.wait_for_function(
            "() => !!BP.world.drone?.active && BP.world.drone.mode === 'bomber'"
            " && BP.world.drone.combatVehicles.length === 3")
        page.wait_for_timeout(400)
        started = time.monotonic()
        while time.monotonic() - started < 150:
            state = page.evaluate("""() => {
              const d = BP.world.drone;
              if (!d || !d.active) return { done: true };
              const live = d.combatVehicles.filter(v => !v.dead);
              if (!live.length) return { live: 0, bombs: d.bombs };
              const target = live[0];
              // Hover directly over the next live wagon and release through the real path.
              d.pos.set(target.pos.x, target.pos.y + 9, target.pos.z);
              d.vel.set(0, 0, 0);
              if (d.bombs > 0 && !d.munitions.length) d.dropBomb();
              return { live: live.length, bombs: d.bombs, falling: d.munitions.length };
            }""")
            if state.get("done") or state.get("live") == 0:
                break
            page.wait_for_timeout(700)

        page.wait_for_function("() => BP.mode === 'debrief'", timeout=60000)
        debrief = page.evaluate("""() => ({
          won: BP.world.won,
          score: BP.world.stats.score,
          kills: BP.world.stats.kills,
        })""")

        result = {
            "front": front,
            "afterFront": after_front,
            "btr": btr,
            "debrief": debrief,
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))
        assert front["cage"] is True, result
        assert after_front["tankDead"] is False, result
        assert after_front["tankHealth"] < 500, result
        assert after_front["airframesLost"] == 1, result
        assert after_front["frozen"] is False, result
        assert btr["cage"] is False, result
        assert debrief["won"] is True, result
        assert debrief["kills"] >= 5, result
        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    main()
