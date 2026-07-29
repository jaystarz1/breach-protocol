#!/usr/bin/env python3
"""Visual and batching regression for the authored mission 08/09 interior kit."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-interior-missions")
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

        def start(level):
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.wait_for_timeout(250)

        def stats():
            return page.evaluate("""() => ({
              art: BP.world.staticMesh.parent.userData.interiorMissionStats,
              calls: BP.performance.render.calls,
              triangles: BP.performance.render.triangles,
              lights: BP.world.staticMesh.parent.children.filter(
                object => object.isPointLight).length,
            })""")

        start(8)
        page.screenshot(path=str(output / "records-entry.png"))
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, 8);
          BP.player.yaw = 0;
          BP.player.pitch = -0.03;
        }""")
        page.wait_for_timeout(180)
        page.screenshot(path=str(output / "records-floor.png"))
        records = stats()

        start(9)
        page.screenshot(path=str(output / "metro-entry.png"))
        page.evaluate("""() => {
          BP.player.pos.set(12, 0, 18);
          BP.player.yaw = 0;
          BP.player.pitch = -0.04;
        }""")
        page.wait_for_timeout(180)
        page.screenshot(path=str(output / "metro-platform.png"))
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, -31);
          BP.player.yaw = 0;
          BP.player.pitch = -0.02;
        }""")
        page.wait_for_timeout(180)
        page.screenshot(path=str(output / "metro-service-tunnel.png"))
        metro = stats()

        result = {
            "records": records,
            "metro": metro,
            "errors": errors[:8],
            "screenshots": [
                "records-entry.png",
                "records-floor.png",
                "metro-entry.png",
                "metro-platform.png",
                "metro-service-tunnel.png",
            ],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        assert records["art"]["levelId"] == 8
        assert records["art"]["instances"] >= 250
        assert records["art"]["batches"]["records-chair-casters"] == 40
        assert records["art"]["batches"]["records-server-racks"] == 4
        assert records["art"]["batches"]["records-partition-rails"] == 48
        assert records["art"]["batches"]["records-desk-tops"] == 8
        assert records["art"]["batches"]["records-archive-boxes"] == 48
        assert records["art"]["batches"]["records-jammer-body"] == 1
        assert metro["art"]["levelId"] == 9
        assert metro["art"]["instances"] >= 250
        assert metro["art"]["batches"]["metro-sleepers"] >= 40
        assert metro["art"]["batches"]["metro-platform-studs"] >= 70
        assert records["calls"] <= 350
        assert metro["calls"] <= 350
        assert records["triangles"] <= 1_500_000
        assert metro["triangles"] <= 1_500_000
        browser.close()


if __name__ == "__main__":
    main()
