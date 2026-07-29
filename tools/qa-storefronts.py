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
                layout: root.userData.streetShopLayout,
                variant: BP.world.missionVariant,
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
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, -5);
          BP.player.yaw = -Math.PI / 2;
          BP.player.pitch = 0.02;
        }""")
        page.wait_for_timeout(220)
        page.screenshot(path=str(output / "damaged-storefront.png"))
        second = capture()
        third = capture()
        cycle = capture()

        result = {
            "first": first,
            "variants": [
                {"variant": row["variant"], "layout": row["layout"]}
                for row in [first, second, third, cycle]
            ],
            "repeatStable": first["stats"] == cycle["stats"]
            and first["parts"] == cycle["parts"]
            and first["wallDecals"] == cycle["wallDecals"]
            and first["layout"] == cycle["layout"],
            "errors": errors[:8],
            "screenshots": [
                "west-storefront.png", "east-storefront.png",
                "damaged-storefront.png",
            ],
        }
        print(json.dumps(result, indent=2))

        expected_stats = {
            "shops": 3,
            "shellPanels": 18,
            "interiorBacks": 3,
            "frames": 24,
            "shutters": 24,
            "slats": 21,
            "bollards": 6,
            "floors": 3,
            "ceilings": 3,
            "fixtures": 6,
            "counters": 4,
            "shelves": 41,
            "stock": 90,
            "backDoors": 3,
            "displayGlass": 2,
            "debris": 11,
            "tyres": 4,
            "solidFixtures": 15,
        }
        expected_parts = {
            "storefront-plaster-shells": 12,
            "storefront-brick-shells": 6,
            "storefront-interior-backs": 3,
            "storefront-frames": 24,
            "storefront-shutters": 24,
            "storefront-thresholds": 3,
            "storefront-bollards": 6,
            "storefront-interior-shells": 6,
            "storefront-interior-fixtures": 6,
            "storefront-furnishings": 45,
            "storefront-stock": 90,
            "storefront-back-doors": 3,
            "storefront-display-glass": 2,
            "storefront-entry-debris": 11,
            "storefront-workshop-tyres": 4,
        }
        assert not errors
        assert result["repeatStable"]
        assert [row["variant"] for row in result["variants"]] == [0, 1, 2, 0]
        assert len({
            json.dumps(row["layout"], sort_keys=True)
            for row in result["variants"][:3]
        }) == 3
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
                "storefront-interior-shells", "storefront-interior-fixtures",
                "storefront-furnishings", "storefront-stock",
                "storefront-back-doors", "storefront-display-glass",
                "storefront-entry-debris", "storefront-workshop-tyres",
            ]
        )
        assert first["stats"]["solidFixtures"] > 12
        assert first["wallDecals"]["decalCounts"]["shop-sign"] == 3
        assert first["calls"] <= 350
        assert first["triangles"] <= 650_000
        browser.close()


if __name__ == "__main__":
    main()
