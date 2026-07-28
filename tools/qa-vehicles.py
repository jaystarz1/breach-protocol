#!/usr/bin/env python3
"""Desktop vehicle-fidelity visual and batching regression."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-vehicles")
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
        page.evaluate("() => BP.startLevel(2)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(200)

        page.evaluate("""() => {
          BP.player.pos.set(0, 0, 31);
          BP.player.yaw = 0;
          BP.player.pitch = -0.03;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "street-vehicles-close.png"))

        # Isolate the regular SUV from the marked unit behind it. This angle exposes the
        # bonnet, roof and side width simultaneously, so a constant-width extrusion cannot
        # pass merely because its side profile resembles a car.
        page.evaluate("""() => {
          BP.player.pos.set(-8, 0, 22);
          BP.player.yaw = -2.214;
          BP.player.pitch = -0.05;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "regular-suv-three-quarter.png"))

        page.evaluate("""() => {
          BP.player.pos.set(0, 0, 8);
          BP.player.yaw = -0.785;
          BP.player.pitch = -0.04;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "regular-hatch-three-quarter.png"))

        page.evaluate("""() => {
          BP.player.pos.set(7, 0, -20);
          BP.player.yaw = 0;
          BP.player.pitch = -0.02;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "police-vehicle-close.png"))

        coverage = page.evaluate("""() => {
          const meshes = {};
          const localBounds = {};
          const widthStations = {};
          for (const object of BP.world.staticMesh.parent.children) {
            if (!object.isInstancedMesh || !object.name.startsWith('vehicle-')) continue;
            meshes[object.name] = object.userData.instanceCount;
            if (/-(lower|cabin|side-glass)$/.test(object.name)) {
              object.geometry.computeBoundingBox();
              const box = object.geometry.boundingBox;
              localBounds[object.name] = {
                x: +(box.max.x - box.min.x).toFixed(3),
                y: +(box.max.y - box.min.y).toFixed(3),
                z: +(box.max.z - box.min.z).toFixed(3),
              };
              if (object.name.endsWith('-lower')) {
                const positions = object.geometry.attributes.position;
                const widths = new Map();
                for (let i = 0; i < positions.count; i++) {
                  const x = positions.getX(i).toFixed(3);
                  widths.set(x, Math.max(widths.get(x) || 0, Math.abs(positions.getZ(i))));
                }
                widthStations[object.name] = new Set(
                  [...widths.values()].map(width => width.toFixed(3))).size;
              }
            }
          }
          return {
            meshes, localBounds, widthStations,
            bodyTypes: ['sedan', 'hatch', 'suv'].filter(type =>
              Object.keys(meshes).some(name => name === `vehicle-${type}-lower`)),
            calls: BP.performance.render.calls,
            triangles: BP.performance.render.triangles,
          };
        }""")
        collisions = page.evaluate("""() => {
          const checks = [
            { key: 'suv', x: -4, z: 25, w: 4.76, d: 2.06, h: 1.84 },
            { key: 'hatch-crosswise', x: 3, z: 5, w: 1.93, d: 4.26, h: 1.68 },
            { key: 'wreck', x: -2, z: -18, w: 4.26, d: 1.93, h: 1.68 },
          ];
          return checks.map(check => {
            const solid = BP.world.solids.find(box =>
              Math.abs((box.min.x + box.max.x) / 2 - check.x) < 0.01 &&
              Math.abs((box.min.z + box.max.z) / 2 - check.z) < 0.01 &&
              box.max.y > 1);
            return {
              ...check,
              found: !!solid,
              actual: solid && {
                w: +(solid.max.x - solid.min.x).toFixed(2),
                d: +(solid.max.z - solid.min.z).toFixed(2),
                h: +(solid.max.y - solid.min.y).toFixed(2),
              },
            };
          });
        }""")

        result = {
            "coverage": coverage,
            "collisions": collisions,
            "screenshots": [
                "street-vehicles-close.png",
                "regular-suv-three-quarter.png",
                "regular-hatch-three-quarter.png",
                "police-vehicle-close.png",
            ],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))
        assert not errors
        assert len(coverage["bodyTypes"]) >= 2
        assert coverage["meshes"].get("vehicle-tyres", 0) >= 20
        assert coverage["meshes"].get("vehicle-wheel-wells", 0) >= 20
        assert coverage["meshes"].get("vehicle-rim-spokes", 0) >= 100
        assert coverage["meshes"].get("vehicle-windscreen", 0) == 0  # variant-keyed only
        assert any(name.endswith("-windscreen") for name in coverage["meshes"])
        assert all(count >= 4 for count in coverage["widthStations"].values())
        assert all(
            item["found"]
            and item["actual"]["w"] == item["w"]
            and item["actual"]["d"] == item["d"]
            and item["actual"]["h"] == item["h"]
            for item in collisions
        )
        browser.close()


if __name__ == "__main__":
    main()
