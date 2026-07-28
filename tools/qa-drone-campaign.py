#!/usr/bin/env python3
"""Smoke-test every campaign drone sortie and its transition back to ground combat."""
import argparse
import json

from playwright.sync_api import sync_playwright


def finish_drone(page, expected_index):
    page.wait_for_function(
        f"() => BP.world.objectiveIdx === {expected_index} && !!BP.world.drone",
        timeout=10000,
    )
    before = page.evaluate("""() => ({
      label: document.querySelector('.drone-label')?.textContent,
      targets: BP.world.drone.targets.length,
      locked: BP.player.locked,
    })""")
    page.evaluate("() => BP.world.drone.targets.forEach(target => target.marked = true)")
    page.wait_for_timeout(1200)
    after = page.evaluate("""() => ({
      restored: !BP.player.locked,
      overlayRemoved: !document.querySelector('.drone-frame'),
      mode: BP.mode,
      objectiveIdx: BP.world.objectiveIdx,
      complete: BP.world.drone?.complete ?? null,
      active: BP.world.drone?.active ?? null,
    })""")
    return {"before": before, "after": after}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    args = parser.parse_args()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        results = {}

        page.evaluate("() => BP.startLevel(2)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.evaluate("""() => {
          if (BP.world.reinf) BP.world.reinf.sent = BP.world.reinf.max;
          BP.world.enemies.forEach(enemy => { enemy.dead = true; enemy.mesh.visible = false; });
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 1")
        page.evaluate("""() => {
          const hold = setInterval(() => BP.player.pos.set(-11.2, .1, -41.6), 16);
          setTimeout(() => clearInterval(hold), 700);
        }""")
        results["level2"] = finish_drone(page, 2)

        page.evaluate("() => BP.startLevel(3)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.evaluate("""() => {
          if (BP.world.reinf) BP.world.reinf.sent = BP.world.reinf.max;
          BP.world.enemies.forEach(enemy => { enemy.dead = true; enemy.mesh.visible = false; });
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 1")
        page.evaluate("() => BP.world.civilians.forEach(civilian => civilian.rescued = true)")
        page.wait_for_function("() => BP.world.objectiveIdx === 2")
        page.evaluate("""() => {
          const hold = setInterval(() => BP.player.pos.set(-2, 9.1, -6), 16);
          setTimeout(() => clearInterval(hold), 700);
        }""")
        results["level3"] = finish_drone(page, 3)

        page.evaluate("() => BP.startLevel(7)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        results["level7"] = finish_drone(page, 0)

        output = {"missions": results, "errors": errors[:8]}
        print(json.dumps(output, indent=2))
        expected = {
            "level2": (3, "playing"),
            "level3": (4, "debrief"),
            "level7": (1, "playing"),
        }
        for name, (objective_index, mode) in expected.items():
            after = results[name]["after"]
            assert after["objectiveIdx"] == objective_index
            assert after["mode"] == mode
            assert after["restored"] and after["overlayRemoved"]
        assert not errors
        browser.close()


if __name__ == "__main__":
    main()
