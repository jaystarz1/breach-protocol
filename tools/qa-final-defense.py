#!/usr/bin/env python3
"""Verify Level 10's rooftop gunship, support strike, and pre-freed shield completion."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-final-defense")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--mute-audio"])
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.set_default_timeout(90000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.BP")
        page.evaluate("() => BP.startLevel(10)")
        page.wait_for_function("() => BP.mode === 'playing'")

        contract = page.evaluate("""() => {
          const objectives = BP.world.level.objectives;
          return {
            types: objectives.map(objective => objective.type),
            towerRequiresRoof: objectives[1].requireReach,
            combat: {
              mode: objectives[2].mode,
              rifle: objectives[2].rifleRounds,
              grenades: objectives[2].grenades,
              infantrySockets: objectives[2].combatWave.enemies.length,
              vehicle: objectives[2].combatWave.vehicle.kind,
            },
            strikeKinds: objectives[3].targets.map(target => target.kind),
            strikePositions: objectives[3].targets.map(target => target.pos),
            strikeFiring: objectives[3].targets.map(target => target.firing),
            bunkerUnlockObjective: BP.world.level.doors.find(
              door => door.pos[1] === -5).unlockObjective,
            towerDoor: BP.world.level.doors.find(
              door => door.pos[1] === 0).pos,
            shieldText: objectives[4].text,
            motorPoolVehicles: [
              'military-truck-authored-cab',
              'military-wheeled-apc-hull',
              'military-bmp-hull',
            ].reduce((count, name) => count + (
              BP.scene.children.find(child => child.name === name)?.count || 0), 0),
            motorPoolFamilies: [
              'military-truck-canvas-roof',
              'military-troop-benches',
              'military-fuel-tanker',
              'military-command-body',
              'military-flatbed-load',
              'military-steel-tubes',
              'military-launcher-tubes',
              'military-wheeled-apc-hull',
              'military-bmp-hull',
            ].filter(name => BP.scene.children.some(child => child.name === name)).length,
            mountedTroops: BP.world.enemies.filter(enemy => enemy.mounted).length,
            burningWrecks: BP.scene.children.filter(
              child => child.name.startsWith('compound-burning-wreck-')).length,
            render: {
              calls: BP.performance.render.calls,
              triangles: BP.performance.render.triangles,
            },
          };
        }""")
        bunker_lock = page.evaluate("""() => {
          const door = BP.world.doors.doors.find(row => row.def.unlockObjective === 4);
          BP.player.pos.copy(door.mesh.position);
          return {
            beforeNetworkStrike: BP.world.doors.nearBreachable(
              BP.player.pos, BP.player.yaw, 3) === null,
            afterNetworkStrike: BP.world.doors.nearBreachable(
              BP.player.pos, BP.player.yaw, 4) === door,
          };
        }""")
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, 27);
          BP.player.yaw = 0;
          BP.player.pitch = -0.08;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "military-compound.png"))
        # Close side views catch far-side wheel bleed that is invisible in the wide compound
        # establishing shot. These place the camera square to the tanker, BTR and BMP lower
        # hulls so their opaque wheel-well backing can be reviewed directly.
        for filename, position, yaw in [
            ("military-tanker-wheel-occlusion.png", [-19, 0, 8], 1.5708),
            ("military-apc-wheel-occlusion.png", [0, 0, 6], 3.14159),
            ("military-bmp-track-occlusion.png", [19, 0, 16], -1.5708),
        ]:
            page.evaluate("""view => {
              BP.player.pos.set(...view.position);
              BP.player.yaw = view.yaw;
              BP.player.pitch = -0.08;
            }""", {"position": position, "yaw": yaw})
            page.wait_for_timeout(160)
            page.screenshot(path=str(output / filename))
        page.evaluate("""() => {
          BP.player.pos.set(-0.8, 0, 1.2);
          BP.player.yaw = 0;
          BP.player.pitch = 0;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "tower-front-door.png"))
        page.evaluate("""() => {
          BP.player.pos.set(22, 0, -15.2);
          BP.player.yaw = 0;
          BP.player.pitch = -0.42;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "bunker-entrance.png"))

        # Clear the authored courtyard/tower force, then stand on the roof. The objective must
        # not hand control over until both conditions are true.
        page.evaluate("""() => {
          BP.player.health = 100000;
          if (BP.world.reinf) BP.world.reinf.sent = BP.world.reinf.max;
          for (const ally of BP.world.allies) ally.update = () => {};
          for (const enemy of BP.world.enemies) {
            if (enemy.pos.y >= -1) {
              enemy.dead = true;
              enemy.mesh.visible = false;
            } else {
              enemy.update = () => {};
            }
          }
          BP.player.pos.set(0, 6.1, -10);
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 2 && BP.world.drone?.mode === 'combat'"
        )
        combat_before = page.evaluate("""() => ({
          infantry: BP.world.drone.combatants.length,
          vehicles: BP.world.drone.combatVehicles.length,
          rifle: BP.world.drone.rifleRounds,
          grenades: BP.world.drone.grenadeRounds,
          thermal: BP.world.drone.thermalSignatures.length,
          positions: BP.world.drone.combatants.map(actor => actor.pos.toArray()),
          vehiclePosition: BP.world.drone.combatVehicles[0].pos.toArray(),
          stackVisible: BP.world.allies.every(actor => actor.mesh.visible),
        })""")
        # Path requests share a small per-frame budget with the rest of the cast. Give every
        # assault actor time to claim a route, then prove that none of them is stuck on its
        # spawn-side truck or wall.
        page.wait_for_function(
            """before => BP.world.drone.combatants.every((actor, index) =>
              Math.hypot(
                actor.pos.x - before[index][0],
                actor.pos.z - before[index][2],
              ) > 0.08)""",
            arg=combat_before["positions"],
            timeout=5000,
        )
        movement = page.evaluate("""before => ({
          infantryMoved: BP.world.drone.combatants.filter((actor, index) =>
            Math.hypot(
              actor.pos.x - before.positions[index][0],
              actor.pos.z - before.positions[index][2],
            ) > 0.08).length,
          vehicleMoved: Math.hypot(
            BP.world.drone.combatVehicles[0].pos.x - before.vehiclePosition[0],
            BP.world.drone.combatVehicles[0].pos.z - before.vehiclePosition[2],
          ) > 0.08,
        })""", combat_before)
        page.screenshot(path=str(output / "rooftop-armed-uav.png"))

        page.evaluate("""() => {
          const drone = BP.world.drone;
          for (const actor of drone.combatants) {
            drone.onCombatHit(actor, 99999, false);
          }
          for (const vehicle of drone.combatVehicles) {
            drone.onCombatVehicleHit(vehicle, 99999);
          }
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 3 && BP.world.drone?.mode === 'strike'"
        )
        strike_before = page.evaluate("""() => ({
          targets: BP.world.drone.targets.length,
          kinds: BP.world.drone.targets.map(target => target.kind),
          models: BP.world.drone.targetModels.filter(Boolean).length,
          firingModels: BP.world.drone.targetModels.filter(
            model => !!model?.userData.update).length,
          crews: BP.world.drone.targetModels.map(
            model => model?.userData.crew?.length || 0),
        })""")
        page.evaluate("""() => {
          BP.world.drone.pos.set(0, 14, -35);
          BP.world.drone.yaw = 0;
          BP.world.drone.pitch = -0.22;
        }""")
        page.wait_for_timeout(300)
        page.screenshot(path=str(output / "artillery-battery.png"))

        # Reproduce the reported order exactly: the bunker shields have already been cut loose
        # while the support strike is still active. Entering objective 4 must recognize that
        # persistent state and advance without asking for an actor who no longer exists.
        prefreed = page.evaluate("""() => {
          const shields = BP.world.civilians.filter(civilian =>
            civilian.wasHostage && civilian.spawnPos.y < -2);
          for (const shield of shields) shield.rescue('you');
          return {
            count: shields.length,
            allFreed: shields.every(shield =>
              shield.rescued && !shield.hostage),
          };
        }""")
        page.evaluate("""() => {
          for (const target of BP.world.drone.targets) {
            BP.world.drone.releaseMunition(target);
          }
          BP.world.drone.updateMunitions(2, BP.world.solids);
          BP.world.drone.updateEffects(0.12);
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 5")
        shield_transition = page.evaluate("""() => ({
          objectiveIdx: BP.world.objectiveIdx,
          text: BP.world.level.objectives[BP.world.objectiveIdx].text,
          droneDisposed: BP.world.drone === null,
          playerRestored: !BP.player.locked,
        })""")

        page.evaluate("""() => {
          for (const enemy of BP.world.enemies) {
            if (!enemy.hvt && enemy.pos.y < -2) {
              enemy.dead = true;
              enemy.mesh.visible = false;
            }
          }
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 6")
        page.evaluate("""() => {
          const bastion = BP.world.enemies.find(enemy => enemy.hvt);
          bastion.dead = true;
          bastion.mesh.visible = false;
        }""")
        page.wait_for_function("() => BP.mode === 'debrief' && BP.world.won")

        result = {
            "contract": contract,
            "bunkerLock": bunker_lock,
            "combatBefore": combat_before,
            "movement": movement,
            "strikeBefore": strike_before,
            "prefreed": prefreed,
            "shieldTransition": shield_transition,
            "won": page.evaluate("() => BP.world.won"),
            "screenshots": [
                "military-compound.png",
                "military-tanker-wheel-occlusion.png",
                "military-apc-wheel-occlusion.png",
                "military-bmp-track-occlusion.png",
                "tower-front-door.png",
                "bunker-entrance.png",
                "rooftop-armed-uav.png",
                "artillery-battery.png",
            ],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert contract["types"] == [
            "clear", "clear", "drone", "drone", "rescue", "clear", "target"
        ], result
        assert contract["towerRequiresRoof"] == [0, -10, 8, 6], result
        assert contract["combat"] == {
            "mode": "combat",
            "rifle": 100,
            "grenades": 10,
            "infantrySockets": 12,
            "vehicle": "technical",
        }, result
        assert contract["strikeKinds"] == ["artillery", "artillery", "artillery"], result
        assert all(position[2] < -50 for position in contract["strikePositions"]), result
        assert contract["strikeFiring"] == [True, True, True], result
        assert contract["motorPoolVehicles"] == 20, result
        assert contract["motorPoolFamilies"] == 9, result
        assert contract["mountedTroops"] == 6, result
        assert contract["burningWrecks"] == 2, result
        assert contract["render"]["calls"] < 450, result
        assert contract["render"]["triangles"] < 1_500_000, result
        assert contract["bunkerUnlockObjective"] == 4, result
        assert contract["towerDoor"] == [-0.8, 0, -3], result
        assert "HUMAN SHIELDS" in contract["shieldText"], result
        assert all(bunker_lock.values()), result
        assert 10 <= combat_before["infantry"] <= 12, result
        assert combat_before["vehicles"] == 1, result
        assert combat_before["rifle"] == 100 and combat_before["grenades"] == 10, result
        assert combat_before["thermal"] == combat_before["infantry"] + 1, result
        assert combat_before["stackVisible"], result
        assert movement["infantryMoved"] == combat_before["infantry"], result
        assert movement["vehicleMoved"], result
        assert strike_before == {
            "targets": 3,
            "kinds": ["artillery", "artillery", "artillery"],
            "models": 3,
            "firingModels": 3,
            "crews": [3, 3, 3],
        }, result
        assert prefreed == {"count": 2, "allFreed": True}, result
        assert shield_transition["objectiveIdx"] == 5, result
        assert "BUNKER GUARD" in shield_transition["text"], result
        assert shield_transition["droneDisposed"] and shield_transition["playerRestored"], result
        assert result["won"], result
        browser.close()


if __name__ == "__main__":
    main()
