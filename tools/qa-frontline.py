#!/usr/bin/env python3
"""Visual and objective-flow smoke test for the Street Sweep frontline slice."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-frontline.png")
    args = parser.parse_args()

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
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, -49);
          BP.player.yaw = Math.PI;
          BP.player.pitch = 0.02;
        }""")
        page.wait_for_timeout(350)
        page.screenshot(path=args.output)
        output_path = Path(args.output)
        utility_path = output_path.with_name(f"{output_path.stem}-utility{output_path.suffix}")
        page.evaluate("""() => {
          BP.player.pos.set(2.0, 0, -8.0);
          const target = { x: 14.7, y: 0.8, z: -18.2 };
          const dx = target.x - BP.player.pos.x;
          const dz = target.z - BP.player.pos.z;
          BP.player.yaw = Math.atan2(-dx, -dz);
          BP.player.pitch = Math.atan2(target.y - 1.6, Math.hypot(dx, dz));
        }""")
        page.wait_for_timeout(180)
        page.screenshot(path=str(utility_path))
        art = page.evaluate("""() => {
          const named = {};
          BP.world.staticMesh.parent.traverse(object => {
            if (!object.name || !object.name.startsWith('frontline-')) return;
            named[object.name] = {
              instances: object.count || object.userData.instanceCount || 1,
              vertices: object.geometry?.attributes?.position?.count || 0,
              photoMap: !!object.material?.map,
              relief: !!(object.material?.normalMap || object.material?.bumpMap),
              authoredSacks: !!object.userData.authoredSacks,
              sackComponents: object.geometry?.userData?.components || 0,
              instanceColors: object.instanceColor?.count || 0,
            };
          });
          return named;
        }""")
        field_equipment = page.evaluate("""() => {
          const root = BP.world.staticMesh.parent;
          const table = root.getObjectByName('frontline-field-table');
          const bodies = root.getObjectByName('frontline-equipment-case-bodies');
          const bands = root.getObjectByName('frontline-equipment-case-bands');
          const latches = root.getObjectByName('frontline-equipment-case-latches');
          return {
            boards: table?.userData.authoredBoards,
            tubeParts: table?.userData.foldingTubeParts,
            tableParts: table?.children.length,
            cases: bodies?.count,
            caseVertices: bodies?.geometry.attributes.position.count,
            bands: bands?.count,
            latches: latches?.count,
            caseRelief: !!bodies?.material.normalMap,
          };
        }""")

        page.evaluate("""() => {
          if (BP.world.reinf) BP.world.reinf.sent = BP.world.reinf.max;
          for (const enemy of BP.world.enemies) {
            enemy.dead = true;
            enemy.mesh.visible = false;
          }
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 1", timeout=5000)
        objective_marker = page.evaluate("""() => {
          const marker = BP.world.beacon;
          let minY = Infinity, maxY = -Infinity;
          for (const child of marker.children) {
            child.updateMatrix();
            child.geometry.computeBoundingBox();
            const box = child.geometry.boundingBox.clone().applyMatrix4(child.matrix);
            minY = Math.min(minY, box.min.y);
            maxY = Math.max(maxY, box.max.y);
          }
          return {
            name: marker.name,
            parts: marker.children.length,
            height: +(maxY - minY).toFixed(3),
            depthTested: marker.children.every(child => child.material.depthTest),
            depthWritesDisabled: marker.children.every(child => !child.material.depthWrite),
            ring: marker.children.some(child => child.geometry.type === 'RingGeometry'),
            cylinder: marker.children.some(child => child.geometry.type === 'CylinderGeometry'),
          };
        }""")
        op_path = output_path.with_name(f"{output_path.stem}-op{output_path.suffix}")
        page.evaluate("""() => {
          BP.player.pos.set(-7, 0, -38.5);
          BP.player.yaw = 0.93;
          BP.player.pitch = -0.08;
        }""")
        page.wait_for_timeout(180)
        page.screenshot(path=str(op_path))
        page.evaluate("""() => {
          const hold = setInterval(() => BP.player.pos.set(-11.2, 0.1, -41.6), 16);
          setTimeout(() => clearInterval(hold), 750);
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 2 && !!BP.world.drone", timeout=5000
        )
        drone_started = page.evaluate("""() => ({
          active: BP.world.drone.active,
          locked: BP.player.locked,
          targets: BP.world.drone.targets.length,
          overlay: !!document.querySelector('.drone-frame'),
        })""")
        drone_path = output_path.with_name(f"{output_path.stem}-drone{output_path.suffix}")
        page.screenshot(path=str(drone_path))
        page.evaluate("""() => {
          for (const target of BP.world.drone.targets) target.marked = true;
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 3", timeout=5000)
        drone_finished = page.evaluate("""() => ({
          controllerDisposed: BP.world.drone === null,
          playerRestored: !BP.player.locked,
          overlayRemoved: !document.querySelector('.drone-frame'),
          mode: BP.mode,
        })""")

        output = {
            "screenshot": str(Path(args.output)),
            "utilityScreenshot": str(utility_path),
            "opScreenshot": str(op_path),
            "droneScreenshot": str(drone_path),
            "droneStarted": drone_started,
            "droneFinished": drone_finished,
            "objectiveMarker": objective_marker,
            "fieldEquipment": field_equipment,
            "frontlineArt": art,
            "errors": errors[:8],
        }
        print(json.dumps(output, indent=2))
        assert not errors
        assert art["frontline-rubble-concrete-0"]["instances"] > 30
        assert art["frontline-rubble-brick"]["instances"] > 30
        assert art["frontline-rubble-concrete-2"]["instances"] > 30
        assert art["frontline-rubble-rebar"]["instances"] > 10
        assert art["frontline-rubble-fines"]["instances"] == 210
        assert art["frontline-crater-rims"]["instances"] == 3
        assert art["frontline-crater-rims"]["vertices"] > 90
        assert art["frontline-crater-rims"]["photoMap"]
        assert art["frontline-crater-rims"]["relief"]
        assert art["frontline-utility-poles"]["instances"] == 2
        assert art["frontline-utility-crossarms"]["instances"] == 2
        assert art["frontline-utility-insulators"]["instances"] == 6
        assert all(f"frontline-utility-cable-{i}" in art for i in range(3))
        assert art["frontline-op-sandbags"]["instances"] > 20
        assert art["frontline-barricade-panels"]["instances"] > 40
        assert art["frontline-barricade-posts"]["instances"] > 8
        assert art["frontline-barricade-sandbags"]["instances"] > 10
        for name in ["frontline-op-sandbags", "frontline-barricade-sandbags"]:
            assert art[name]["authoredSacks"]
            assert art[name]["sackComponents"] == 6
            assert art[name]["vertices"] > 450
            assert art[name]["instanceColors"] == art[name]["instances"]
        assert art["frontline-barricade-hesco-fill"]["instances"] == 5
        assert art["frontline-barricade-hesco-cages"]["instances"] == 5
        assert art["frontline-barricade-hesco-cages"]["vertices"] > 500
        assert art["frontline-anti-vehicle-hedgehogs"]["instances"] == 3
        assert art["frontline-anti-vehicle-hedgehogs"]["vertices"] > 150
        assert art["frontline-rubble-concrete-0"]["photoMap"]
        assert art["frontline-rubble-concrete-0"]["relief"]
        assert objective_marker["name"] == "objective-ground-marker"
        assert objective_marker["parts"] == 5
        assert objective_marker["height"] < 0.1
        assert objective_marker["depthTested"] and objective_marker["depthWritesDisabled"]
        assert objective_marker["ring"] and not objective_marker["cylinder"]
        assert field_equipment["boards"] == 4 and field_equipment["tubeParts"] == 6
        assert field_equipment["tableParts"] == 3
        assert field_equipment["cases"] == 3 and field_equipment["caseVertices"] > 24
        assert field_equipment["bands"] == 6 and field_equipment["latches"] == 6
        assert field_equipment["caseRelief"]
        assert drone_started["active"] and drone_started["locked"]
        assert drone_finished["controllerDisposed"] and drone_finished["playerRestored"]
        browser.close()


if __name__ == "__main__":
    main()
