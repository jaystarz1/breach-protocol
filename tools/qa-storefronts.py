#!/usr/bin/env python3
"""Verify Street Sweep's authored open storefront kit and atlased signs."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-storefronts")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)

        def capture():
            page.evaluate("() => BP.startLevel(2)")
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.wait_for_timeout(250)
            return page.evaluate("""() => {
              const root = BP.world.staticMesh.parent;
              const parts = {};
              root.traverse(object => {
                if (!object.name.startsWith('storefront-')) return;
                parts[object.name] = {
                  count: object.count || object.userData.itemCount || 0,
                  instanced: !!object.isInstancedMesh,
                  vertices: object.geometry?.attributes?.position?.count || 0,
                };
              });
              return {
                stats: root.userData.storefrontStats,
                wallDecals: root.userData.wallDecalStats,
                parts,
                calls: BP.performance.render.calls,
                triangles: BP.performance.render.triangles,
              };
            }""")

        first = capture()
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, 20);
          BP.player.yaw = -Math.PI / 2;
          BP.player.pitch = 0.02;
        }""")
        page.wait_for_timeout(220)
        page.screenshot(path=str(output / "west-storefront.png"))
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, -25);
          BP.player.yaw = Math.PI / 2;
          BP.player.pitch = 0.02;
        }""")
        page.wait_for_timeout(220)
        page.screenshot(path=str(output / "east-storefront.png"))
        repeat = capture()

        result = {
            "first": first,
            "repeatStable": first["stats"] == repeat["stats"]
            and first["parts"] == repeat["parts"]
            and first["wallDecals"] == repeat["wallDecals"],
            "errors": errors[:8],
            "screenshots": ["west-storefront.png", "east-storefront.png"],
        }
        print(json.dumps(result, indent=2))

        expected_stats = {
            "shops": 3,
            "shellPanels": 18,
            "interiorBacks": 3,
            "frames": 9,
            "shutters": 24,
            "slats": 21,
            "bollards": 6,
        }
        expected_parts = {
            "storefront-plaster-shells": 12,
            "storefront-brick-shells": 6,
            "storefront-interior-backs": 3,
            "storefront-frames": 9,
            "storefront-shutters": 24,
            "storefront-thresholds": 3,
            "storefront-bollards": 6,
        }
        assert not errors
        assert result["repeatStable"]
        assert first["stats"] == expected_stats
        assert set(first["parts"]) == set(expected_parts)
        assert all(
            first["parts"][name]["count"] == count
            for name, count in expected_parts.items()
        )
        assert all(
            first["parts"][name]["instanced"]
            for name in [
                "storefront-frames", "storefront-shutters",
                "storefront-thresholds", "storefront-bollards",
            ]
        )
        assert first["wallDecals"]["decalCounts"]["shop-sign"] == 3
        assert first["calls"] <= 350
        assert first["triangles"] <= 650_000
        browser.close()


if __name__ == "__main__":
    main()
