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
          return {
            doors: doors.length,
            authored: doors.every(door => door.mesh.userData.authoredDoor),
            maxChildren: Math.max(...doors.map(door => door.mesh.children.length)),
            allLeavesTextured: doors.every(door =>
              !!door.mesh.getObjectByName('door-leaf')?.material?.map),
            consolidatedHardware: doors.every(door =>
              door.mesh.getObjectByName('door-leaf')?.userData.mergedDoorDetails),
            sharedHardwareGeometry: doors.every(door =>
              door.mesh.getObjectByName('door-leaf')?.geometry
                === doors[0].mesh.getObjectByName('door-leaf')?.geometry),
            fixtureCounts,
            interiorArt: scene.userData.interiorMissionStats,
            calls: BP.performance.render.calls,
          };
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

        frame("command-corridor.png", [0, 0, 18], [0, 1.35, -17])
        frame("command-ops-room.png", [4.15, 0, 13.0], [10.2, 1.45, 11.0])
        frame("command-signals-room.png", [4.15, 0, 1.0], [10.2, 1.4, -1.0])
        frame("command-armoury-room.png", [4.15, 0, -11.0], [10.15, 1.4, -13.0])

        page.evaluate("""() => {
          for (const enemy of BP.world.enemies.filter(actor => actor.tag === 'r2')) {
            enemy.damage(enemy.health + 1, BP.world, false, false);
          }
        }""")
        power_trigger = page.evaluate("""() => ({
          tags: BP.world.enemies.map(enemy => ({
            tag: enemy.tag, dead: enemy.dead, health: enemy.health,
          })),
          config: BP.world.level.blackoutOn,
          over: BP.world.over,
          objectiveIdx: BP.world.objectiveIdx,
          mode: BP.mode,
          blackedOut: BP.world.blackedOut ?? false,
        })""")
        page.wait_for_function("() => BP.world.blackedOut === true", timeout=10000)
        page.evaluate("() => { BP.input.nvgPressed = true; }")
        page.wait_for_function(
            "() => document.getElementById('nvg').style.display === 'block'",
            timeout=5000,
        )
        frame("command-blackout-nvg.png", [4.15, 0, -11.0], [10.15, 1.4, -13.0])
        blackout = page.evaluate("""() => ({
          active: BP.world.blackedOut,
          nvgVisible: document.getElementById('nvg').style.display === 'block',
          fixturesOut: BP.world.staticMesh.parent.children
            .filter(object => object.isPointLight)
            .every(light => light.intensity === 0 || light.visible === false),
          commandScreensOut: BP.world.staticMesh.parent.userData.blackoutMaterials
            .every(material => material.emissiveIntensity === 0),
        })""")

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
            "powerTrigger": power_trigger,
            "blackout": blackout,
            "breachTransition": transition,
            "errors": errors[:8],
            "screenshots": [
                "authored-door-and-fixtures.png",
                "command-corridor.png",
                "command-ops-room.png",
                "command-signals-room.png",
                "command-armoury-room.png",
                "command-blackout-nvg.png",
            ],
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
        interior = presentation["interiorArt"]
        assert interior["levelId"] == 1
        assert interior["instances"] >= 300
        assert (
            interior["batches"]["command-floor-tiles-a"]
            + interior["batches"]["command-floor-tiles-b"]
        ) >= 65
        assert interior["batches"]["command-corridor-runner"] == 6
        assert interior["batches"]["command-ceiling-ribs"] == 10
        assert interior["batches"]["command-cable-tray-rungs"] >= 30
        assert interior["batches"]["command-monitor-cases"] == 3
        assert interior["batches"]["command-radio-racks"] == 3
        assert interior["batches"]["command-gear-lockers"] == 3
        assert interior["batches"]["command-black-kit-helmets"] == 3
        assert interior["batches"]["command-black-kit-helmet-brims"] == 3
        assert interior["batches"]["command-ventilation-grilles"] == 10
        assert interior["batches"]["command-floor-grime"] == 7
        assert presentation["calls"] <= 230
        power_targets = [
            actor for actor in power_trigger["tags"] if actor["tag"] == "r2"
        ]
        assert power_trigger["config"]["tag"] == "r2"
        assert len(power_targets) == 2
        assert all(actor["dead"] for actor in power_targets)
        assert blackout["active"] and blackout["nvgVisible"]
        assert blackout["fixturesOut"] and blackout["commandScreensOut"]
        assert transition["solidPresentBefore"]
        assert transition["breached"] and transition["solidRemoved"]
        assert transition["moved"] > 0.5 and transition["rotation"] > 0.1
        browser.close()


if __name__ == "__main__":
    main()
