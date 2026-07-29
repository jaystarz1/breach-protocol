#!/usr/bin/env python3
"""Drive Mission 3's real combat/navigation route through the joined apartment block."""
import argparse
import json
import time

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:4178/?renderer=desktop&qa=1",
    )
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.set_default_timeout(300000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.BP && !!window.QA")
        started = time.monotonic()
        page.evaluate("() => QA.run(3, 3, { difficulty: 0, god: true })")
        page.wait_for_function("() => BP.world?.level?.id === 3 && BP.player")
        # Exercise the real input/collision route faster than a human playthrough. Combat,
        # breach, stairs, hostage proximity and objective code remain unchanged.
        page.evaluate("() => { BP.player.speed = 12; }")
        last_report = 0
        while time.monotonic() - started < 310:
            state = page.evaluate("""() => ({
              done: BP.world?.level?.id === 3
                && BP.world.objectiveIdx === 3 && !!BP.world.drone?.active,
              finished: QA_RESULTS.length > 0,
              objective: BP.world?.objectiveIdx,
              waypoint: QA_STATE?.wpIdx,
              position: BP.player
                ? [BP.player.pos.x, BP.player.pos.y, BP.player.pos.z] : null,
              live: BP.world?.enemies.filter(enemy => !enemy.dead).length,
              rescued: BP.world?.civilians.filter(
                civilian => civilian.wasHostage && civilian.rescued).length,
            })""")
            if state["done"] or state["finished"]:
                break
            elapsed = time.monotonic() - started
            if elapsed - last_report >= 15:
                print(json.dumps({"progress": round(elapsed), **state}), flush=True)
                last_report = elapsed
            page.wait_for_timeout(1000)
        result = page.evaluate("""() => ({
          objectiveIdx: BP.world.objectiveIdx,
          objectiveType: BP.world.level.objectives[BP.world.objectiveIdx]?.type,
          droneActive: !!BP.world.drone?.active,
          liveEnemies: BP.world.enemies.filter(enemy => !enemy.dead).length,
          rescuedHostages: BP.world.civilians.filter(
            civilian => civilian.wasHostage && civilian.rescued).length,
          breachedDoors: BP.world.doors.doors.filter(door => door.breached).length,
          totalDoors: BP.world.doors.doors.length,
          player: [
            +BP.player.pos.x.toFixed(2),
            +BP.player.pos.y.toFixed(2),
            +BP.player.pos.z.toFixed(2),
          ],
          waypoint: QA_STATE.wpIdx,
          notes: [...QA_STATE.notes],
          qaResults: [...QA_RESULTS],
        })""")
        result["elapsedSeconds"] = round(time.monotonic() - started, 2)
        result["errors"] = errors[:8]
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert result["objectiveIdx"] == 3, result
        assert result["objectiveType"] == "drone" and result["droneActive"], result
        assert result["liveEnemies"] == 0, result
        assert result["rescuedHostages"] == 6, result
        assert result["breachedDoors"] >= 5, result
        assert not result["notes"], result
        browser.close()


if __name__ == "__main__":
    main()
