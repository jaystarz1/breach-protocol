#!/usr/bin/env python3
"""Verify authored fixtures, consolidated breach doors, and live breach transitions."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-interiors")
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
        page.evaluate("() => BP.startLevel(1)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.evaluate("""() => {
          for (const enemy of BP.world.enemies) {
            enemy.range = 0;
            enemy.fireCooldown = 999;
          }
          BP.player.pos.set(1.25, 0, 13.25);
          BP.player.yaw = -Math.PI / 2;
          BP.player.pitch = 0;
        }""")
        page.wait_for_timeout(300)
        page.screenshot(path=str(output / "authored-door-and-fixtures.png"))

        presentation = page.evaluate("""() => {
          const scene = BP.world.staticMesh.parent;
          const fixtureCounts = {};
          scene.traverse(object => {
            if (!object.name.startsWith('ceiling-fixture')) return;
            fixtureCounts[object.name] = object.userData.instanceCount || 1;
          });
          const doors = BP.world.doors.doors;
          const firstHardware = doors[0].mesh.getObjectByName('door-hardware');
          return {
            doors: doors.length,
            authored: doors.every(door => door.mesh.userData.authoredDoor),
            maxChildren: Math.max(...doors.map(door => door.mesh.children.length)),
            allLeavesTextured: doors.every(door =>
              !!door.mesh.getObjectByName('door-leaf')?.material?.map),
            consolidatedHardware: doors.every(door =>
              door.mesh.getObjectByName('door-hardware')?.isMesh),
            sharedHardwareGeometry: doors.every(door =>
              door.mesh.getObjectByName('door-hardware')?.geometry
                === firstHardware.geometry),
            fixtureCounts,
            calls: BP.performance.render.calls,
          };
        }""")

        transition = page.evaluate("""() => {
          const door = BP.world.doors.doors[0];
          const before = door.mesh.position.clone();
          const solidPresentBefore = BP.world.solids.includes(door.solid);
          BP.world.doors.breach(door, BP.world);
          return {
            before: before.toArray(),
            solidPresentBefore,
          };
        }""")
        page.wait_for_timeout(500)
        transition.update(page.evaluate("""() => {
          const door = BP.world.doors.doors[0];
          return {
            breached: door.breached,
            solidRemoved: !BP.world.solids.includes(door.solid),
            moved: +door.mesh.position.distanceTo(
              { x: %s, y: %s, z: %s }).toFixed(2),
            rotation: +Math.abs(door.mesh.rotation.x).toFixed(2),
          };
        }""" % tuple(transition["before"])))

        result = {
            "presentation": presentation,
            "breachTransition": transition,
            "errors": errors[:8],
            "screenshots": ["authored-door-and-fixtures.png"],
        }
        print(json.dumps(result, indent=2))

        fixtures = presentation["fixtureCounts"]
        assert not errors
        assert presentation["doors"] == 3
        assert presentation["authored"]
        assert presentation["maxChildren"] <= 4
        assert presentation["allLeavesTextured"]
        assert presentation["consolidatedHardware"]
        assert presentation["sharedHardwareGeometry"]
        assert fixtures.get("ceiling-fixture-housings") == 8
        assert sum(
            count for name, count in fixtures.items()
            if name.startswith("ceiling-fixture-lenses-")
        ) == 8
        assert presentation["calls"] <= 175
        assert transition["solidPresentBefore"]
        assert transition["breached"] and transition["solidRemoved"]
        assert transition["moved"] > 0.5 and transition["rotation"] > 0.1
        browser.close()


if __name__ == "__main__":
    main()
