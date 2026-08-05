#!/usr/bin/env python3
"""Capture and verify Mission 4's degraded pursuit route and parking arena."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-pursuit-route")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(104)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(250)

        result = page.evaluate("""() => {
          const counts = {};
          BP.world.staticMesh.parent.traverse(object => {
            if (!object.name) return;
            if (!object.name.startsWith('facade-')
              && !object.name.startsWith('window-')
              && !object.name.startsWith('pursuit-')) return;
            const count = object.userData.instanceCount || object.count
              || object.userData.itemCount || 1;
            counts[object.name] = (counts[object.name] || 0) + count;
          });
          for (const actor of [
            ...BP.world.enemies, ...BP.world.allies, ...BP.world.civilians,
          ]) actor.update = () => {};
          BP.player.health = 100000;
          BP.weapons.holder.visible = false;
          return {
            counts,
            calls: BP.performance.render.calls,
            triangles: BP.performance.render.triangles,
            programs: BP.performance.resources.programs,
          };
        }""")

        shots = [
            ("route-start.png", 0, 45, 0),
            ("route-turn.png", 21, 14, 0),
            ("garage-entry.png", 3.5, -8, 0),
            ("escape-gate.png", -6, -31, 0),
            ("direction-finder.png", -5, -32.5, 1.0),
        ]
        for name, x, z, yaw in shots:
            page.evaluate(
                """([x, z, yaw]) => {
                  BP.player.pos.set(x, 0, z);
                  BP.player.yaw = yaw;
                  BP.player.pitch = 0.03;
                }""",
                [x, z, yaw],
            )
            page.wait_for_timeout(160)
            page.screenshot(path=str(output / name))

        # The garage log is a physical pickup on the authored direction-finder table. Walk onto
        # its socket after clearing the garage and verify that proximity capture advances to the
        # exfil gate without depending on a desktop-only breach button.
        page.evaluate("""() => {
          for (const enemy of BP.world.enemies) enemy.dead = true;
          BP.world.objectiveIdx = 1;
          BP.world.objectiveStepIdx = 0;
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 1 && BP.world.objectiveStepIdx === 1",
            timeout=10000,
        )
        log_pickup = page.evaluate("""() => {
          const device = BP.world.objectiveDevices.find(item => item.id === 'l4-log');
          BP.player.pos.set(device.pos[0], device.pos[1], device.pos[2]);
          return {
            pos: device.pos,
            marker: BP.world.beacon?.name,
            markerDeviceId: BP.world.beacon?.userData?.deviceId,
            usedBefore: device.used,
            objectiveBefore: BP.objective.text,
          };
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 2 && BP.world.objectiveStepIdx === 0",
            timeout=10000,
        )
        log_pickup["usedAfter"] = page.evaluate(
            "() => BP.world.objectiveDevices.find(item => item.id === 'l4-log').used"
        )
        log_pickup["objectiveAfter"] = page.evaluate("() => BP.objective.text")

        result.update({
            "screenshots": [shot[0] for shot in shots],
            "logPickup": log_pickup,
            "errors": errors[:8],
        })
        print(json.dumps(result, indent=2))

        counts = result["counts"]
        windows = sum(
            count for name, count in counts.items()
            if name.startswith(("window-room-", "recess-"))
        )
        assert not errors, result
        assert windows > 80, result
        assert counts.get("window-reveals", 0) >= windows * 4, result
        assert counts.get("facade-parapets-damaged", 0) > 0, result
        assert counts.get("facade-breach-recesses", 0) >= 2, result
        assert counts.get("facade-party-piers", 0) > 8, result
        assert counts.get("pursuit-garage-deck-beams", 0) == 7, result
        assert counts.get("pursuit-garage-pillar-jackets", 0) == 15, result
        assert counts.get("pursuit-garage-light-housings", 0) == 12, result
        assert counts.get("pursuit-garage-light-lenses", 0) == 12, result
        assert counts.get("pursuit-garage-conduit", 0) == 2, result
        assert counts.get("pursuit-garage-bay-lines", 0) == 8, result
        assert counts.get("pursuit-garage-oil-stains", 0) == 4, result
        assert sum(
            counts.get(f"pursuit-garage-rubble-{index}", 0)
            for index in range(3)
        ) == 24, result
        assert counts.get("pursuit-direction-finder-console", 0) == 1, result
        assert counts.get("pursuit-direction-finder-screen", 0) == 1, result
        assert counts.get("pursuit-direction-finder-mast", 0) == 1, result
        assert counts.get("pursuit-escape-gate-leaves", 0) == 2, result
        assert counts.get("pursuit-escape-gate-sandbags", 0) == 10, result
        assert result["logPickup"]["pos"] == [-11.1, 0, -35.8], result
        assert result["logPickup"]["marker"] == "objective-device-marker", result
        assert result["logPickup"]["markerDeviceId"] == "l4-log", result
        assert result["logPickup"]["usedBefore"] is False, result
        assert result["logPickup"]["usedAfter"] is True, result
        assert "EXFIL" in result["logPickup"]["objectiveAfter"], result
        assert result["calls"] < 350, result
        assert result["triangles"] < 700_000, result
        browser.close()


if __name__ == "__main__":
    main()
