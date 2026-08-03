#!/usr/bin/env python3
"""Flight school end-to-end: DRONARIUM (11) and GRADUATION (12).

Level 11: first kill, hunt behind the windbreak, cage rule (frontal defeated, rear kills).
Level 12: kill inside the jamming bubble (and assert the bubble actually jams), lead the
mover, bomber drops on the practice siding. Both must reach a won debrief.
"""
import argparse
import json
import time

from playwright.sync_api import sync_playwright


def kill_by_proximity(page, offset=(1.6, 1.3, 1.2)):
    page.evaluate("""([ox, oy, oz]) => {
      const d = BP.world.drone;
      const target = d.combatVehicles.find(v => !v.dead);
      d.pos.set(target.pos.x + ox, target.pos.y + oy, target.pos.z + oz);
      d.vel.set(0, 0, 0);
    }""", list(offset))


def main():
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

        # ---------------- Level 11: DRONARIUM ----------------
        page.evaluate("() => BP.startLevel(11)")
        page.wait_for_function(
            "() => BP.mode === 'playing' && BP.world?.level?.id === 11"
            " && !!BP.world.drone?.active")
        page.wait_for_timeout(600)

        # Lesson 1: first kill.
        kill_by_proximity(page)
        page.wait_for_function("() => BP.world.objectiveIdx === 1", timeout=30000)

        # Lesson 2: the hidden truck.
        page.wait_for_function(
            "() => !!BP.world.drone?.active && BP.world.drone.combatVehicles.length === 1")
        page.wait_for_timeout(400)
        kill_by_proximity(page)
        page.wait_for_function("() => BP.world.objectiveIdx === 2", timeout=30000)

        # Lesson 3: cage — frontal hit must be defeated, rear hit must kill.
        page.wait_for_function(
            "() => !!BP.world.drone?.active && BP.world.drone.combatVehicles.length === 1")
        page.wait_for_timeout(400)
        front = page.evaluate("""() => {
          const d = BP.world.drone;
          const tank = d.combatVehicles[0];
          const nose = { x: -Math.cos(tank.mesh.rotation.y), z: Math.sin(tank.mesh.rotation.y) };
          d.pos.set(tank.pos.x + nose.x * 2.0, tank.pos.y + 1.3, tank.pos.z + nose.z * 2.0);
          d.vel.set(0, 0, 0);
          return { cage: tank.cage, health: tank.health };
        }""")
        page.wait_for_function("() => BP.world.drone.airframesLost === 1", timeout=30000)
        after_front = page.evaluate("""() => ({
          dead: BP.world.drone.combatVehicles[0].dead,
          health: BP.world.drone.combatVehicles[0].health,
        })""")
        page.wait_for_timeout(400)
        page.evaluate("""() => {
          const d = BP.world.drone;
          const tank = d.combatVehicles[0];
          const rear = { x: Math.cos(tank.mesh.rotation.y), z: -Math.sin(tank.mesh.rotation.y) };
          d.pos.set(tank.pos.x + rear.x * 2.0, tank.pos.y + 1.3, tank.pos.z + rear.z * 2.0);
          d.vel.set(0, 0, 0);
        }""")
        page.wait_for_function("() => BP.mode === 'debrief'", timeout=60000)
        debrief11 = page.evaluate(
            "() => ({ won: BP.world.won, kills: BP.world.stats.kills })")

        # ---------------- Level 12: GRADUATION ----------------
        page.evaluate("() => BP.startLevel(12)")
        page.wait_for_function(
            "() => BP.mode === 'playing' && BP.world?.level?.id === 12"
            " && !!BP.world.drone?.active")
        page.wait_for_timeout(600)

        # The bubble must actually jam: park high inside it and read the signal.
        jam = page.evaluate("""() => {
          const d = BP.world.drone;
          d.pos.set(0, 45, -80); d.vel.set(0, 0, 0);
          return true;
        }""")
        page.wait_for_timeout(900)
        jam = page.evaluate("() => BP.world.drone.signal")
        kill_by_proximity(page)
        page.wait_for_function("() => BP.world.objectiveIdx === 1", timeout=30000)

        # The mover.
        page.wait_for_function(
            "() => !!BP.world.drone?.active && BP.world.drone.combatVehicles.length === 1")
        page.wait_for_timeout(400)
        mover = page.evaluate(
            "() => BP.world.drone.combatVehicles[0].route.length")
        kill_by_proximity(page)
        page.wait_for_function("() => BP.world.objectiveIdx === 2", timeout=30000)

        # The bomber: hover over each live wagon and release through the real path.
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
              if (!live.length) return { live: 0 };
              const target = live[0];
              d.pos.set(target.pos.x, target.pos.y + 9, target.pos.z);
              d.vel.set(0, 0, 0);
              if (d.bombs > 0 && !d.munitions.length) d.dropBomb();
              return { live: live.length, bombs: d.bombs };
            }""")
            if state.get("done") or state.get("live") == 0:
                break
            page.wait_for_timeout(700)
        page.wait_for_function("() => BP.mode === 'debrief'", timeout=60000)
        debrief12 = page.evaluate(
            "() => ({ won: BP.world.won, kills: BP.world.stats.kills })")

        result = {
            "dronarium": {"front": front, "afterFront": after_front, "debrief": debrief11},
            "graduation": {"jamSignalHighInBubble": jam, "moverRoutePoints": mover,
                           "debrief": debrief12},
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))
        assert front["cage"] is True, result
        assert after_front["dead"] is False, result
        assert after_front["health"] < 500, result
        assert debrief11["won"] is True, result
        assert debrief11["kills"] >= 3, result
        assert jam < 0.45, result          # high inside the bubble must be heavily jammed
        assert mover >= 2, result
        assert debrief12["won"] is True, result
        assert debrief12["kills"] >= 5, result
        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    main()
