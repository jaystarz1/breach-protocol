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
              trainCollision: BP.world.solids.some(solid =>
                Math.abs(solid.min.x + 19.325) < 0.01
                && Math.abs(solid.max.x + 14.975) < 0.01
                && Math.abs(solid.min.z + 16) < 0.01
                && Math.abs(solid.max.z - 8) < 0.01),
              lights: BP.world.staticMesh.parent.children.filter(
                object => object.isPointLight).length,
            })""")

        start(108)
        page.screenshot(path=str(output / "records-entry.png"))
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, 8);
          BP.player.yaw = 0;
          BP.player.pitch = -0.03;
        }""")
        page.wait_for_timeout(180)
        page.screenshot(path=str(output / "records-floor.png"))
        records = stats()

        start(109)
        page.screenshot(path=str(output / "metro-entry.png"))
        page.evaluate("""() => {
          BP.player.pos.set(12, 0, 18);
          BP.player.yaw = 0;
          BP.player.pitch = -0.04;
        }""")
        page.wait_for_timeout(180)
        page.screenshot(path=str(output / "metro-platform.png"))
        page.evaluate("""() => {
          for (const actor of [
            ...BP.world.enemies, ...BP.world.civilians, ...(BP.world.allies || []),
          ]) actor.update = () => {};
          BP.player.health = 100000;
          BP.weapons.holder.visible = false;
          const eye = [-9.5, 0, 8.0];
          const target = [-17.1, 1.65, -4.0];
          BP.player.pos.set(...eye);
          const dx = target[0] - eye[0];
          const dz = target[2] - eye[2];
          BP.player.yaw = Math.atan2(-dx, -dz);
          BP.player.pitch = Math.atan2(
            target[1] - (eye[1] + 1.6), Math.hypot(dx, dz));
        }""")
        page.wait_for_timeout(180)
        page.screenshot(path=str(output / "metro-evacuation-train.png"))
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
                "metro-evacuation-train.png",
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
        assert metro["art"]["batches"]["metro-train-shell"] == 1
        assert metro["art"]["batches"]["metro-train-windows"] == 6
        assert metro["art"]["batches"]["metro-train-window-frames"] == 18
        assert metro["art"]["batches"]["metro-train-door-panels"] == 4
        assert metro["art"]["batches"]["metro-train-body-seams"] == 9
        assert metro["art"]["batches"]["metro-train-lower-vents"] >= 12
        assert metro["art"]["batches"]["metro-train-window-boards"] == 2
        assert metro["art"]["batches"]["metro-train-grime-decals"] == 2
        assert metro["art"]["batches"]["metro-floor-grime-decals"] == 6
        assert metro["art"]["batches"]["metro-wall-grime-decals"] == 5
        assert metro["art"]["batches"]["metro-missing-tile-patches"] == 6
        assert metro["art"]["batches"]["metro-train-wheels"] == 4
        assert metro["art"]["batches"]["metro-tunnel-wall-pilasters"] == 14
        assert metro["art"]["batches"]["metro-tunnel-drain-grates"] >= 30
        assert metro["art"]["batches"]["metro-stairwell-upper-bulkhead"] == 1
        assert metro["trainCollision"]
        assert records["calls"] <= 350
        assert metro["calls"] <= 350
        assert records["triangles"] <= 1_500_000
        assert metro["triangles"] <= 1_500_000
        browser.close()


if __name__ == "__main__":
    main()
