#!/usr/bin/env python3
"""Verify rescued-hostage commands: SHELTER default break-off, the H cycle, follow
personal space (no camera-charging on a turn-around), and doorway freezing."""
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

        def state():
            return page.evaluate("""() => {
              const civilian = BP.world.civilians.find(actor => actor.rescuer === 'you');
              return {
                command: civilian.escortCommand,
                worldCommand: BP.world.hostageCommand,
                prone: civilian.prone,
                settled: !!civilian.shelterSettled,
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

        # SHELTER default: the freed man breaks away from the player and settles instead
        # of trailing him for the rest of the level.
        initial = state()
        page.wait_for_function(
            """() => {
              const c = BP.world.civilians.find(actor => actor.rescuer === 'you');
              return Math.hypot(
                c.pos.x - BP.player.pos.x, c.pos.z - BP.player.pos.z) > 4.5;
            }""",
            timeout=8000,
        )
        page.wait_for_function(
            """() => {
              const c = BP.world.civilians.find(actor => actor.rescuer === 'you');
              return c.shelterSettled && c.prone > 0.5;
            }""",
            timeout=20000,
        )
        sheltered = state()

        # H cycle: shelter -> follow -> stay -> down -> shelter.
        page.evaluate("() => { BP.input.hostageCommandPressed = true; }")
        page.wait_for_function(
            """() => {
              const c = BP.world.civilians.find(actor => actor.rescuer === 'you');
              return BP.world.hostageCommand === 'follow'
                && c.escortCommand === 'follow'
                && c.prone === 0
                && Math.hypot(c.pos.x - BP.player.pos.x, c.pos.z - BP.player.pos.z) < 3.4;
            }""",
            timeout=15000,
        )
        follow = state()

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
          BP.world.combatHeat = 0;
          BP.input.hostageCommandPressed = true;
        }""")
        page.wait_for_function(
            "() => BP.world.hostageCommand === 'shelter'", timeout=5000
        )
        wrapped = state()

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

        # Explicit FOLLOW formation: evacuees starting IN FRONT of the player must round
        # his personal-space bubble to the trail anchors, never walk through the camera.
        formation = page.evaluate("""() => {
          const hostages = BP.world.civilians.filter(actor => actor.wasHostage);
          hostages.forEach((civilian, index) => {
            if (!civilian.rescued) civilian.rescue('you', index);
            civilian.escortSlot = index;
            civilian.escortSide = index % 2 === 0 ? -1 : 1;
            civilian.setEscortCommand('follow');
            civilian.pos.set((index - 1) * 0.6, 0, 29.6 + index * 0.3);
            civilian.baseY = 0;
          });
          BP.player.pos.set(0, 0, 32);
          BP.world.playerYaw = 0;
          BP.world.combatHeat = 0;
          let minGap = Infinity;
          for (let frame = 0; frame < 420; frame++) {
            for (const civilian of hostages) {
              civilian.updateEscort(1 / 60, BP.world);
              minGap = Math.min(minGap, Math.hypot(
                civilian.pos.x - BP.player.pos.x,
                civilian.pos.z - BP.player.pos.z));
            }
          }
          const positions = hostages.map(civilian => ({
            slot: civilian.escortSlot,
            side: civilian.escortSide,
            x: +civilian.pos.x.toFixed(2),
            z: +civilian.pos.z.toFixed(2),
            distance: +Math.hypot(
              civilian.pos.x - BP.player.pos.x,
              civilian.pos.z - BP.player.pos.z).toFixed(2),
          }));
          let minimumSeparation = Infinity;
          for (let a = 0; a < hostages.length; a++) {
            for (let b = a + 1; b < hostages.length; b++) {
              minimumSeparation = Math.min(minimumSeparation,
                Math.hypot(
                  hostages[a].pos.x - hostages[b].pos.x,
                  hostages[a].pos.z - hostages[b].pos.z));
            }
          }
          return {
            positions,
            minGap: +minGap.toFixed(2),
            minimumSeparation: +minimumSeparation.toFixed(2),
          };
        }""")

        # The complaint scenario: the player spins 180. The column must re-form behind the
        # NEW facing by flowing around the player, and no evacuee may press into the camera.
        turnaround = page.evaluate("""() => {
          const hostages = BP.world.civilians.filter(actor => actor.wasHostage);
          BP.world.playerYaw = Math.PI;
          let minGap = Infinity;
          for (let frame = 0; frame < 600; frame++) {
            for (const civilian of hostages) {
              civilian.updateEscort(1 / 60, BP.world);
              minGap = Math.min(minGap, Math.hypot(
                civilian.pos.x - BP.player.pos.x,
                civilian.pos.z - BP.player.pos.z));
            }
          }
          return {
            minGap: +minGap.toFixed(2),
            behindNewFacing: hostages.every(
              civilian => civilian.pos.z < BP.player.pos.z - 0.9),
            distances: hostages.map(civilian => +Math.hypot(
              civilian.pos.x - BP.player.pos.x,
              civilian.pos.z - BP.player.pos.z).toFixed(2)),
          };
        }""")

        stay_delta = (
            (stayed["position"][0] - stay["position"][0]) ** 2
            + (stayed["position"][1] - stay["position"][1]) ** 2
        ) ** 0.5
        result = {
            "initial": initial,
            "sheltered": sheltered,
            "follow": follow,
            "stay": stay,
            "stayDelta": round(stay_delta, 4),
            "down": down,
            "wrapped": wrapped,
            "blockedDoorway": blocked,
            "formation": formation,
            "turnaround": turnaround,
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        assert initial["rescuedCount"] == 1
        assert initial["command"] == "shelter"
        assert "SHELTER" in initial["hud"]
        assert sheltered["settled"] and sheltered["distance"] > 4.5
        assert follow["command"] == "follow"
        assert follow["prone"] == 0
        assert follow["distance"] < 3.4
        assert stay["command"] == "stay"
        assert stay["anchor"] is not None
        assert stay_delta < 0.35
        assert down["command"] == "down"
        assert down["prone"] > 0.9
        assert "GET DOWN" in down["hud"]
        assert wrapped["command"] == "shelter"
        assert blocked["freeze"] > 0.5
        assert [actor["slot"] for actor in formation["positions"]] == [0, 1, 2]
        assert [actor["side"] for actor in formation["positions"]] == [-1, 1, -1]
        assert formation["minimumSeparation"] > 0.75
        assert formation["minGap"] > 0.85
        assert all(actor["distance"] < 4.6 for actor in formation["positions"])
        assert all(actor["z"] > 32.8 for actor in formation["positions"])
        assert turnaround["minGap"] > 0.85
        assert turnaround["behindNewFacing"]
        assert all(distance < 4.6 for distance in turnaround["distances"])
        browser.close()


if __name__ == "__main__":
    main()
