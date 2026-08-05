#!/usr/bin/env python3
"""Capture Mission 6's rooftop OP, plaza and scoped target picture."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-relay-crossing")
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
        page.evaluate("() => BP.startLevel(106)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(350)
        page.evaluate("""() => {
          for (const actor of [
            ...BP.world.enemies, ...BP.world.civilians, ...(BP.world.allies || []),
          ]) actor.update = () => {};
          BP.player.health = 100000;
        }""")

        def frame(name, eye, target, scoped=False, weapon=True):
            page.evaluate(
                """({ eye, target, scoped, weapon }) => {
                  BP.input.ads = scoped;
                  BP.weapons.holder.visible = weapon;
                  BP.player.pos.set(...eye);
                  const dx = target[0] - eye[0];
                  const dz = target[2] - eye[2];
                  BP.player.yaw = Math.atan2(-dx, -dz);
                  BP.player.pitch = Math.atan2(
                    target[1] - (eye[1] + 1.6), Math.hypot(dx, dz));
                }""",
                {
                    "eye": eye,
                    "target": target,
                    "scoped": scoped,
                    "weapon": weapon,
                },
            )
            page.wait_for_timeout(420 if scoped else 220)
            page.screenshot(path=str(output / name))

        frame(
            "rooftop-overwatch.png",
            [0, 24.2, 64.0],
            [0, 1.2, -46],
            scoped=False,
            weapon=True,
        )
        frame(
            "observation-post.png",
            [-8.2, 24.2, 69.5],
            [-4, 25.0, 60.5],
            scoped=False,
            weapon=False,
        )
        frame(
            "sniper-scope.png",
            [0, 24.2, 62.0],
            [0, 6.2, -99.4],
            scoped=True,
            weapon=True,
        )
        frame(
            "hutch-access.png",
            [3.2, 24.2, 72.5],
            [-1, 25.2, 67.6],
            scoped=False,
            weapon=False,
        )
        frame(
            "spotter-optic.png",
            [6.2, 24.2, 66.2],
            [3.45, 25.1, 61.9],
            scoped=False,
            weapon=False,
        )
        frame(
            "roof-utilities.png",
            [-1.2, 24.2, 75.2],
            [4.6, 25.4, 71.5],
            scoped=False,
            weapon=False,
        )

        result = page.evaluate("""() => {
          const counts = {};
          BP.world.staticMesh.parent.traverse(object => {
            if (!object.name) return;
            if (object.name.startsWith('relay-')) {
              counts[object.name] = (counts[object.name] || 0)
                + (object.count || object.userData.instanceCount || 1);
            } else if (object.count || object.userData.instanceCount) {
              counts[object.name] = (counts[object.name] || 0)
                + (object.count || object.userData.instanceCount || 1);
            }
          });
          return {
            counts,
            calls: BP.performance.render.calls,
            triangles: BP.performance.render.triangles,
            programs: BP.performance.resources.programs,
            allies: BP.world.allies.length,
            enemies: BP.world.enemies.length,
            civilians: BP.world.civilians.length,
          };
        }""")
        result.update({
            "errors": errors[:8],
            "screenshots": [
                "rooftop-overwatch.png",
                "observation-post.png",
                "sniper-scope.png",
                "hutch-access.png",
                "spotter-optic.png",
                "roof-utilities.png",
            ],
        })
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert result["allies"] == 4, result
        assert result["enemies"] == 13, result
        assert result["civilians"] == 17, result
        counts = result["counts"]
        assert counts["relay-roof-bitumen-membrane"] == 1, result
        assert counts["relay-roof-authored-sandbags"] == 33, result
        assert counts["relay-roof-ballast-gravel"] == 88, result
        assert counts["relay-roof-timber-duckboards"] == 12, result
        assert counts["relay-roof-firing-mat"] == 1, result
        assert counts["relay-roof-firing-mat-seams"] == 5, result
        assert counts["relay-hutch-cladding"] == 6, result
        assert counts["relay-hutch-roof-flashing"] == 8, result
        assert counts["relay-hutch-service-vent"] == 12, result
        assert counts["relay-hutch-panel-seams"] == 4, result
        assert counts["relay-roof-ac-housings"] == 2, result
        assert counts["relay-roof-ac-lids"] == 2, result
        assert counts["relay-roof-ac-feet"] == 8, result
        assert counts["relay-roof-ac-fan-rings"] == 2, result
        assert counts["relay-roof-ac-fan-hubs"] == 2, result
        assert counts["relay-roof-ac-fan-blades"] == 10, result
        assert counts["relay-roof-ac-louvers"] == 14, result
        assert counts["relay-roof-water-tank"] == 1, result
        assert counts["relay-roof-water-tank-cap"] == 1, result
        assert counts["relay-roof-water-tank-bands"] == 4, result
        assert counts["relay-roof-water-tank-supports"] == 5, result
        assert counts["relay-roof-water-tank-ladder"] == 9, result
        assert counts["relay-roof-vent-flashing"] == 1, result
        assert counts["relay-roof-vent-stack"] == 1, result
        assert counts["relay-roof-vent-rain-cap"] == 1, result
        assert counts["relay-spotter-tripod"] == 3, result
        assert counts["relay-spotter-optic"] == 3, result
        assert result["calls"] < 300, result
        assert result["triangles"] < 850_000, result
        browser.close()


if __name__ == "__main__":
    main()
