#!/usr/bin/env python3
"""Desktop authored-vehicle fidelity, collision, and batching regression."""
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
        page.evaluate("() => BP.startLevel(102)")
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
        page.screenshot(path=str(output / "abandoned-sedan-three-quarter.png"))

        page.evaluate("""() => {
          BP.player.pos.set(7, 0, -20);
          BP.player.yaw = 0;
          BP.player.pitch = -0.02;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "police-vehicle-close.png"))

        page.evaluate("""() => {
          BP.player.pos.set(-8, 0, -12);
          BP.player.yaw = -0.785;
          BP.player.pitch = -0.04;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "shell-struck-wreck.png"))

        coverage = page.evaluate("""() => {
          const meshes = {};
          const police = {};
          const vertexCounts = {};
          const authored = [];
          for (const object of BP.world.staticMesh.parent.children) {
            if (!object.isInstancedMesh) continue;
            if (object.name.startsWith('police-')) {
              police[object.name] = object.userData.instanceCount;
              continue;
            }
            if (!object.name.startsWith('vehicle-')) continue;
            meshes[object.name] = object.userData.instanceCount;
            vertexCounts[object.name] = object.geometry.attributes.position.count;
            if (object.geometry.userData.authoredVehicle) {
              object.geometry.computeBoundingBox();
              const box = object.geometry.boundingBox;
              const authoredBounds = object.geometry.userData.authoredBounds;
                authored.push({
                name: object.name,
                kind: object.geometry.userData.kind,
                instances: object.userData.instanceCount,
                sourceParts: object.geometry.userData.sourceParts,
                vertices: object.geometry.userData.assemblyVertices
                  || object.geometry.attributes.position.count,
                geometryVertices: object.geometry.attributes.position.count,
                nativePartCount: object.geometry.userData.nativePartCount || 0,
                vertexColors: object.geometry.attributes.color?.count || 0,
                surfaceMasks: [
                  'vehiclePaint', 'vehicleGlass', 'vehicleRubber',
                  'vehicleMetal', 'vehicleLight',
                ].filter(name => !!object.geometry.attributes[name]).length,
                mapped: !!object.material?.map,
                normalMapped: !!object.material?.normalMap,
                roughnessMapped: !!object.material?.roughnessMap,
                mapResolution: object.material?.map?.image
                  ? [
                    object.material.map.image.width,
                    object.material.map.image.height,
                  ]
                  : null,
                material: object.material?.name,
                bounds: (authoredBounds || [
                  box.max.x - box.min.x,
                  box.max.y - box.min.y,
                  box.max.z - box.min.z,
                ]).map(value => +value.toFixed(3)),
              });
            }
          }
          return {
            meshes, police, vertexCounts, authored,
            authoredInstances: authored.reduce((sum, item) => sum + item.instances, 0),
            bodyTypes: [...new Set(authored.map(item => item.kind))].sort(),
            nativeParts: Object.keys(meshes)
              .filter(name => /vehicle-authored-(sedan|suv)-native-/.test(name))
              .sort(),
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
                "abandoned-sedan-three-quarter.png",
                "police-vehicle-close.png",
                "shell-struck-wreck.png",
            ],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))
        assert not errors
        assert set(("sedan", "hatch", "suv", "wreck")).issubset(coverage["bodyTypes"])
        assert coverage["authoredInstances"] >= 6
        # Native body colours are now per-instance, so colour variation no longer forces
        # duplicate authored geometries.
        assert len(coverage["authored"]) >= 4
        assert all(item["sourceParts"] >= 4 for item in coverage["authored"])
        assert all(item["vertices"] > 9_000 for item in coverage["authored"])
        assert all(
            (
                item["kind"] in ("sedan", "suv")
                and item["nativePartCount"] >= 4
                and item["material"]
                == f"authored-vehicle-{item['kind']}-native-paint"
            )
            or (
                item["vertexColors"] == item["vertices"]
                and item["surfaceMasks"] == 5
                and item["material"] == "authored-vehicle-layered-finish"
            )
            or (
                item["kind"] in ("hatch", "wreck")
                and item["mapped"]
                and item["normalMapped"]
                and item["roughnessMapped"]
                and item["mapResolution"] == [1024, 1024]
                and item["material"]
                == {
                    "hatch": "authored-vehicle-abandoned-sedan-photo",
                    "wreck": "authored-vehicle-covered-photo",
                }[item["kind"]]
            )
            for item in coverage["authored"]
        )
        assert len(coverage["nativeParts"]) >= 10
        assert all(item["bounds"][0] > 4 and item["bounds"][2] > 1.8
                   for item in coverage["authored"])
        expected_visual_bounds = {
            "sedan": (4.60, 1.62, 1.94),
            "suv": (4.76, 1.84, 2.06),
        }
        for item in coverage["authored"]:
            if item["kind"] not in expected_visual_bounds:
                continue
            assert all(
                abs(actual - expected) <= 0.01
                for actual, expected in zip(
                    item["bounds"], expected_visual_bounds[item["kind"]]
                )
            )
        # This close sweep deliberately keeps the whole mixed fleet visible. The separate
        # frame-time profile remains the authoritative GPU gate.
        assert coverage["calls"] < 270
        # Vehicle fidelity is gated alongside the fully authored Street Sweep environment.
        # The old 470k ceiling predated storefront interiors, degraded facades and the
        # frontline dressing pass; the gameplay profiler remains the authoritative frame-time
        # gate, while this guard still catches an accidental high-poly fleet replacement.
        assert coverage["triangles"] < 600_000
        assert coverage["police"].get("police-doors", 0) == 4
        assert coverage["police"].get("police-side-stripes", 0) == 4
        assert coverage["police"].get("police-roundels", 0) == 4
        assert coverage["meshes"].get("vehicle-soft-contact-shadows", 0) == 24
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
