#!/usr/bin/env python3
"""Verify deterministic rescued-hostage commands and controlled doorway freezing."""
import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(1)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)

        page.evaluate("""() => {
          const civilian = BP.world.civilians.find(actor => actor.hostage);
          for (const enemy of BP.world.enemies) enemy.health = 0;
          civilian.pos.set(0, 0, 30.15);
          civilian.baseY = 0;
          BP.player.pos.set(0, 0, 32);
          BP.player.yaw = 0;
          BP.world.combatHeat = 0;
        }""")
        page.wait_for_function(
            "() => BP.world.civilians.some(actor => actor.rescuer === 'you')",
            timeout=5000,
        )
        page.evaluate("""() => {
          const civilian = BP.world.civilians.find(actor => actor.rescuer === 'you');
          civilian.pos.set(0, 0, 30);
          civilian.baseY = 0;
          BP.player.pos.set(0, 0, 32);
        }""")
        page.wait_for_timeout(120)

        def state():
            return page.evaluate("""() => {
              const civilian = BP.world.civilians.find(actor => actor.rescuer === 'you');
              return {
                command: civilian.escortCommand,
                worldCommand: BP.world.hostageCommand,
                prone: civilian.prone,
                position: [civilian.pos.x, civilian.pos.z],
                anchor: civilian.escortAnchor,
                freeze: civilian.escortFreeze,
                rescuedCount: BP.world.stats.rescued,
                distance: Math.hypot(
                  civilian.pos.x - BP.player.pos.x,
                  civilian.pos.z - BP.player.pos.z
                ),
                hud: document.getElementById('hostage-line').textContent,
              };
            }""")

        initial = state()
        page.evaluate("() => { BP.input.hostageCommandPressed = true; }")
        page.wait_for_function(
            "() => BP.world.hostageCommand === 'stay'", timeout=5000
        )
        stay = state()
        page.evaluate("() => { BP.player.pos.set(5, 0, 36); }")
        page.wait_for_timeout(500)
        stayed = state()

        page.evaluate("() => { BP.input.hostageCommandPressed = true; }")
        page.wait_for_function(
            """() => {
              const c = BP.world.civilians.find(actor => actor.rescuer === 'you');
              return c.escortCommand === 'down' && c.prone > 0.9;
            }""",
            timeout=6000,
        )
        down = state()

        page.evaluate("""() => {
          BP.player.pos.set(0, 0, 35);
          BP.world.combatHeat = 0;
          BP.input.hostageCommandPressed = true;
        }""")
        page.wait_for_function(
            """() => {
              const c = BP.world.civilians.find(actor => actor.rescuer === 'you');
              return c.escortCommand === 'follow'
                && c.prone === 0
                && Math.hypot(c.pos.x - BP.player.pos.x, c.pos.z - BP.player.pos.z) < 3.4;
            }""",
            timeout=10000,
        )
        follow = state()

        # Force the same rescued actor into a solid wall four deterministic movement ticks.
        # A seeded doorway-freezer must pause rather than grind indefinitely against collision.
        blocked = page.evaluate("""() => {
          const c = BP.world.civilians.find(actor => actor.rescuer === 'you');
          c.setEscortCommand('follow');
          c.freezeInDoorway = true;
          c.pos.set(-2.64, 0, 0);
          c.baseY = 0;
          c.panicDir = -Math.PI / 2;
          for (let i = 0; i < 5; i++) c.escortStep(0.16, BP.world, 2.55, 2);
          return {
            freeze: c.escortFreeze,
            blocked: c.escortBlocked,
            position: [c.pos.x, c.pos.z],
          };
        }""")

        stay_delta = (
            (stayed["position"][0] - stay["position"][0]) ** 2
            + (stayed["position"][1] - stay["position"][1]) ** 2
        ) ** 0.5
        result = {
            "initial": initial,
            "stay": stay,
            "stayDelta": round(stay_delta, 4),
            "down": down,
            "follow": follow,
            "blockedDoorway": blocked,
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        assert initial["rescuedCount"] == 1
        assert initial["command"] == "follow"
        assert "FOLLOW" in initial["hud"]
        assert stay["command"] == "stay"
        assert stay["anchor"] is not None
        assert stay_delta < 0.35
        assert down["command"] == "down"
        assert down["prone"] > 0.9
        assert "GET DOWN" in down["hud"]
        assert follow["command"] == "follow"
        assert follow["prone"] == 0
        assert follow["distance"] < 3.4
        assert blocked["freeze"] > 0.5
        browser.close()


if __name__ == "__main__":
    main()
