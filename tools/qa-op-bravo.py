#!/usr/bin/env python3
"""Verify OP Bravo's strike transition, authored tower art, and vertical combat route."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-op-bravo")
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
        page.evaluate("() => BP.startLevel(7)")
        page.wait_for_function(
            "() => BP.mode === 'playing' && BP.world.drone?.active",
            timeout=90000,
        )
        strike = page.evaluate("""() => {
          const drone = BP.world.drone;
          const targets = drone.targets.length;
          for (const target of drone.targets) {
            target.marked = true;
            target.engaged = true;
          }
          drone.complete = true;
          drone.dispose();
          BP.player.locked = false;
          BP.world.objectiveIdx = 1;
          return { targets, mode: drone.mode };
        }""")
        page.evaluate("""() => {
          for (const actor of [
            ...BP.world.enemies, ...BP.world.civilians, ...(BP.world.allies || []),
          ]) actor.update = () => {};
          BP.player.health = 100000;
          BP.weapons.holder.visible = false;
        }""")

        def frame(name, eye, target):
            page.evaluate(
                """({ eye, target }) => {
                  BP.player.pos.set(...eye);
                  const dx = target[0] - eye[0];
                  const dz = target[2] - eye[2];
                  BP.player.yaw = Math.atan2(-dx, -dz);
                  BP.player.pitch = Math.atan2(
                    target[1] - (eye[1] + 1.6), Math.hypot(dx, dz));
                }""",
                {"eye": eye, "target": target},
            )
            page.wait_for_timeout(180)
            page.screenshot(path=str(output / name))

        frame("op-bravo-rooftop.png", [6, 12.3, 2], [-4.2, 13.1, -2.5])
        frame("op-bravo-top-floor.png", [3.3, 9.1, 1.4], [6.2, 10.1, -7.6])
        frame("op-bravo-mid-floor.png", [0, 6.1, 1.6], [0, 7.2, -8.5])
        frame("op-bravo-ground-floor.png", [-1, 0.1, 1.6], [5.2, 1.2, -6])
        frame("op-bravo-street.png", [0, 0.1, 22], [0, 7.2, -4])

        scene_state = page.evaluate("""() => {
          const batches = {};
          BP.world.staticMesh.parent.traverse(object => {
            if (!object.name) return;
            if (
              object.name.startsWith('op-bravo-')
              || object.name.startsWith('frontline-mission-op-')
            ) {
              batches[object.name] = object.count || object.userData.instanceCount || 1;
            }
          });
          return {
            batches,
            calls: BP.performance.render.calls,
            triangles: BP.performance.render.triangles,
            programs: BP.performance.programs?.length ?? null,
            solids: BP.world.solids.length,
            doors: BP.world.doors.doors.length,
          };
        }""")
        result = {
            "strike": strike,
            "scene": scene_state,
            "errors": errors[:8],
            "screenshots": [
                "op-bravo-rooftop.png",
                "op-bravo-top-floor.png",
                "op-bravo-mid-floor.png",
                "op-bravo-ground-floor.png",
                "op-bravo-street.png",
            ],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        assert strike == {"targets": 3, "mode": "strike"}
        batches = scene_state["batches"]
        assert batches["op-bravo-roof-membrane"] == 1
        assert batches["op-bravo-roof-sandbags"] >= 24
        assert batches["op-bravo-command-windbreak"] == 3
        assert batches["op-bravo-command-screen"] == 1
        assert (
            batches["op-bravo-floor-tiles-a"]
            + batches["op-bravo-floor-tiles-b"]
        ) == 48
        assert batches["op-bravo-floor-runners"] == 4
        assert batches["op-bravo-cable-tray-rungs"] >= 72
        assert batches["op-bravo-stair-handrails"] == 4
        assert batches["op-bravo-signals-racks"] == 2
        assert batches["op-bravo-field-cots"] == 3
        assert batches["op-bravo-ammunition-cases"] == 6
        assert batches["op-bravo-entry-sign"] == 1
        assert sum(
            count for name, count in batches.items()
            if name.startswith("op-bravo-entry-rubble-")
        ) == 42
        assert scene_state["doors"] == 2
        assert scene_state["calls"] <= 340
        assert scene_state["triangles"] < 1_500_000
        browser.close()


if __name__ == "__main__":
    main()
