#!/usr/bin/env python3
"""Capture and verify Mission 3's rebuilt OP Alpha residential courtyard."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-op-alpha")
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
        page.evaluate("() => BP.startLevel(3)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(300)

        result = page.evaluate("""() => {
          const counts = {};
          BP.world.staticMesh.parent.traverse(object => {
            if (!object.name) return;
            if (!object.name.startsWith('op-alpha-')
              && !object.name.startsWith('vehicle-authored-')
              && !object.name.startsWith('frontline-mission-op-')) return;
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
            ("courtyard-approach.png", 0, 18, 0, 0.02),
            ("entry-canopy.png", 0, 7, 0, 0.05),
            ("east-fire-escape.png", 13, 1, 1.2, -0.08),
            ("courtyard-human-scale.png", -12, 15, -0.56, 0.02),
            ("rooftop-op.png", 0, -3, 0, -0.04),
        ]
        for name, x, z, yaw, pitch in shots:
            y = 9.1 if name == "rooftop-op.png" else 0
            page.evaluate(
                """([x, y, z, yaw, pitch]) => {
                  BP.player.pos.set(x, y, z);
                  BP.player.yaw = yaw;
                  BP.player.pitch = pitch;
                }""",
                [x, y, z, yaw, pitch],
            )
            page.wait_for_timeout(160)
            page.screenshot(path=str(output / name))

        result.update({
            "screenshots": [shot[0] for shot in shots],
            "errors": errors[:8],
        })
        print(json.dumps(result, indent=2))

        counts = result["counts"]
        authored_vehicle_parts = sum(
            count for name, count in counts.items()
            if name.startswith("vehicle-authored-")
        )
        assert not errors, result
        assert counts.get("op-alpha-courtyard-pavers", 0) == 14, result
        assert counts.get("op-alpha-entry-canopy", 0) == 4, result
        assert counts.get("op-alpha-entry-light", 0) == 1, result
        assert counts.get("op-alpha-fire-escape-platforms", 0) == 24, result
        assert counts.get("op-alpha-fire-escape-rails", 0) == 2, result
        assert counts.get("op-alpha-fire-escape-side-rails", 0) == 4, result
        assert counts.get("op-alpha-fire-escape-balusters", 0) == 8, result
        assert counts.get("op-alpha-fire-escape-ladder", 0) == 10, result
        assert counts.get("op-alpha-fire-escape-braces", 0) == 4, result
        assert counts.get("op-alpha-courtyard-posts", 0) == 4, result
        assert counts.get("op-alpha-courtyard-crossbars", 0) == 4, result
        assert counts.get("op-alpha-clothes-lines", 0) == 6, result
        assert counts.get("op-alpha-play-frame", 0) == 5, result
        assert counts.get("op-alpha-play-seats", 0) == 2, result
        assert counts.get("op-alpha-courtyard-planter-kerbs", 0) == 8, result
        assert counts.get("op-alpha-courtyard-planter-earth", 0) == 2, result
        assert sum(
            counts.get(f"op-alpha-collapse-rubble-{index}", 0)
            for index in range(3)
        ) == 36, result
        assert counts.get("op-alpha-courtyard-hesco-fill", 0) == 3, result
        assert counts.get("op-alpha-courtyard-hesco-cages", 0) == 3, result
        assert counts.get("op-alpha-courtyard-hedgehog", 0) == 1, result
        assert authored_vehicle_parts >= 1, result
        assert counts.get("frontline-mission-op-sandbags", 0) == 16, result
        assert result["calls"] < 330, result
        assert result["triangles"] < 550_000, result
        browser.close()


if __name__ == "__main__":
    main()
