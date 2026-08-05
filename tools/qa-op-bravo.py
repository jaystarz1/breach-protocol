#!/usr/bin/env python3
"""Verify OP Bravo's armed-drone transition, tower art, and vertical combat route."""
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
        page.evaluate("() => BP.startLevel(107)")
        page.wait_for_function(
            "() => BP.mode === 'playing' && BP.world.drone?.active",
            timeout=90000,
        )
        page.evaluate("() => { BP.world.drone.droneInteriorThreshold = 99; }")
        route_before = page.evaluate("""() => BP.world.drone.combatants.map(actor => ({
          pos: [actor.pos.x, actor.pos.y, actor.pos.z],
          routeLength: actor.droneRoute?.length || 0,
          loops: !!actor.droneRouteLoops,
          interior: !!actor.droneInteriorFloor,
          interiorWaypoints: (actor.droneRoute || []).filter(point =>
            Math.abs(point.x) < 8 && point.z > -17 && point.z < -3).length,
        }))""")
        page.wait_for_timeout(2600)
        route_after = page.evaluate("""() => BP.world.drone.combatants.map(actor => ({
          pos: [actor.pos.x, actor.pos.y, actor.pos.z],
          routeIndex: actor.droneRouteIdx,
        }))""")
        route_motion = {
            "routes": route_before,
            "after": route_after,
            "moved": sum(
                1 for before, after in zip(route_before, route_after)
                if ((before["pos"][0] - after["pos"][0]) ** 2
                    + (before["pos"][2] - after["pos"][2]) ** 2) ** 0.5 > 0.25
            ),
            "looping": sum(1 for actor in route_before if actor["loops"]),
            "interiorRoutes": sum(1 for actor in route_before if actor["interior"]),
            "exteriorRoutes": sum(
                1 for actor in route_before
                if not actor["interior"] and actor["interiorWaypoints"] == 0
            ),
            "interiorWaypoints": all(
                actor["interiorWaypoints"] > 0
                for actor in route_before if actor["interior"]
            ),
            "droneState": page.evaluate("() => ({ active: !!BP.world.drone?.active, complete: !!BP.world.drone?.complete, mode: BP.world.drone?.mode, assault: BP.world.droneAssault?.actors?.length || 0 })"),
        }
        strike = page.evaluate("""() => {
          const drone = BP.world.drone;
          const targets = drone.targets.length;
          const combatants = drone.combatants.length;
          const vehicles = drone.combatVehicles.length;
          for (const actor of drone.combatants) {
            drone.onCombatHit(actor, 99999, false);
          }
          drone.complete = true;
          drone.dispose();
          BP.player.locked = false;
          BP.world.objectiveIdx = 1;
          return {
            targets,
            combatants,
            vehicles,
            rifle: drone.rifleRounds,
            grenades: drone.grenadeRounds,
            mode: drone.mode,
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

        frame("op-bravo-rooftop.png", [6, 12.3, 2], [-4.2, 13.1, -2.5])
        frame("op-bravo-top-floor.png", [3.3, 9.1, 1.4], [6.2, 10.1, -7.6])
        frame("op-bravo-mid-floor.png", [0, 6.1, 1.6], [0, 7.2, -8.5])
        frame("op-bravo-ground-floor.png", [-1, 0.1, 1.6], [5.2, 1.2, -6])
        frame("op-bravo-street.png", [0, 0.1, 22], [0, 7.2, -4])

        scene_state = page.evaluate("""async () => {
          const THREE = await import('./lib/three.module.js');
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
            interiorDoorXs: BP.world.doors.doors.map(door => door.def.pos[0]),
            stairClearance: [0, 1, 2, 3].map(floor => {
              const even = floor % 2 === 0;
              const z = even ? -8.2 : 0.2;
              const y = floor * 3 + 1.5;
              return {
                floor,
                blocked: BP.world.solids.some(s =>
                  s.min.x < 6.6 && s.max.x > 6.6
                  && s.min.z < z && s.max.z > z
                  && s.min.y < y + 1.3 && s.max.y > y + 1.3),
              };
            }),
            visualStairHits: [0, 1, 2, 3].map(floor => {
              const even = floor % 2 === 0;
              const z = even ? -8.2 : 0.2;
              const ray = new THREE.Raycaster(
                new THREE.Vector3(6.6, floor * 3 + 2.94, z),
                new THREE.Vector3(0, 1, 0), 0, 0.2);
              return {
                floor,
                hits: ray.intersectObjects(BP.scene.children, true).slice(0, 4).map(hit => {
                  const entry = { distance: hit.distance, name: hit.object.name || hit.object.parent?.name || '' };
                  if (hit.instanceId !== undefined) {
                    const matrix = new THREE.Matrix4();
                    const position = new THREE.Vector3();
                    hit.object.getMatrixAt(hit.instanceId, matrix);
                    position.setFromMatrixPosition(matrix);
                    entry.instanceId = hit.instanceId;
                    entry.position = position.toArray();
                  }
                  return entry;
                }),
              };
            }),
          };
        }""")
        page.evaluate("""() => {
          // Move through the authored clearance phase instead of only mutating its index:
          // this verifies that the antenna control is reachable when the tower is actually
          // cleared, and that the objective prompt is attached to the physical console.
          BP.world.objectiveIdx = 1;
          BP.world.objectiveStepIdx = 0;
          for (const enemy of BP.world.enemies) enemy.dead = true;
          BP.player.pos.set(0, 0, 2.4);
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 2 && BP.objective?.device === 'l7-antenna'",
            timeout=90000,
        )
        antenna = page.evaluate("""() => {
          const device = BP.world.objectiveDevices.find(item => item.id === 'l7-antenna');
          const distance = Math.hypot(
            device.pos[0] - BP.player.pos.x, device.pos[2] - BP.player.pos.z);
          const visible = !!device.root.visible;
          BP.input.breachPressed = true;
          return {
            objective: BP.objective.text,
            actionLabel: device.actionLabel,
            distance,
            visible,
            marker: BP.world.beacon?.name,
            markerDeviceId: BP.world.beacon?.userData?.deviceId,
            usedBefore: device.used,
          };
        }""")
        page.wait_for_timeout(180)
        antenna["usedAfter"] = page.evaluate(
            "() => BP.world.objectiveDevices.find(item => item.id === 'l7-antenna').used"
        )
        result = {
            "strike": strike,
            "routeMotion": route_motion,
            "scene": scene_state,
            "antenna": antenna,
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
        assert strike == {
            "targets": 0,
            "combatants": 11,
            "vehicles": 1,
            "rifle": 100,
            "grenades": 10,
            "mode": "combat",
        }
        assert route_motion["moved"] >= 10
        assert route_motion["looping"] == 11
        assert route_motion["interiorRoutes"] == 6
        assert route_motion["exteriorRoutes"] == 5
        assert route_motion["interiorWaypoints"] is True
        assert antenna["usedAfter"] is True
        assert antenna["distance"] < 2.2
        assert antenna["visible"] is True
        assert antenna["marker"] == "objective-device-marker"
        assert antenna["markerDeviceId"] == "l7-antenna"
        batches = scene_state["batches"]
        assert sum(batches.get(name, 0) for name in (
            "op-bravo-roof-membrane-west",
            "op-bravo-roof-membrane-north",
            "op-bravo-roof-membrane-south",
        )) == 3
        assert batches["op-bravo-roof-sandbags"] >= 24
        assert batches["op-bravo-command-windbreak"] == 3
        assert batches["op-bravo-command-screen"] == 1
        assert (
            batches["op-bravo-floor-tiles-a"]
            + batches["op-bravo-floor-tiles-b"]
        ) == 43
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
        assert scene_state["interiorDoorXs"] == [-2, -2]
        assert scene_state["calls"] <= 340
        assert scene_state["triangles"] < 1_500_000
        browser.close()


if __name__ == "__main__":
    main()
