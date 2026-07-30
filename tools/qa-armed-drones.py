#!/usr/bin/env python3
"""Verify the two infantry-interdiction drone encounters and their weapon budgets."""
import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--mute-audio"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda message: errors.append(message.text)
            if message.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)

        page.evaluate("() => BP.startLevel(2)")
        page.wait_for_function(
            "() => BP.mode === 'playing' && BP.world.level.id === 2",
            timeout=90000,
        )
        page.evaluate("""() => {
          for (const enemy of BP.world.enemies) enemy.damage(99999, BP.world);
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 1", timeout=90000)
        page.evaluate("""() => {
          const zone = BP.world.level.objectives[1].zone;
          BP.player.pos.set(zone[0], zone[3] || 0, zone[1]);
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 2 && BP.world.drone?.mode === 'combat'",
            timeout=90000,
        )
        level2_before = page.evaluate("""() => ({
          mode: BP.world.drone.mode,
          rifle: BP.world.drone.rifleRounds,
          grenades: BP.world.drone.grenadeRounds,
          combatants: BP.world.drone.combatants.length,
          vehicles: BP.world.drone.combatVehicles.length,
          live: BP.world.drone.combatants.filter(actor => !actor.dead).length,
          staticTargets: BP.world.drone.targets.length,
          stackVisible: BP.world.allies.every(actor => actor.mesh.visible),
          positions: BP.world.drone.combatants.map(actor => [
            actor.pos.x, actor.pos.y, actor.pos.z,
          ]),
          vehiclePosition: BP.world.drone.combatVehicles[0]?.pos.toArray(),
          optics: {
            fov: BP.world.drone.camera.fov,
            canvasFilter: document.getElementById('game-canvas').style.filter,
            mask: !!document.querySelector('.drone-optic-mask'),
          },
          thermal: (() => {
            const actor = BP.world.drone.combatants[0];
            const meshVisible = actor.mesh.visible;
            actor.mesh.visible = false;
            BP.world.drone.updateThermalSignatures();
            const survivesHiddenMesh = BP.world.drone.thermalSignatures[0].visible;
            actor.mesh.visible = meshVisible;
            return {
              count: BP.world.drone.thermalSignatures.length,
              visible: BP.world.drone.thermalSignatures
                .filter(signature => signature.visible).length,
              survivesHiddenMesh,
              depthTested: BP.world.drone.thermalSignatures.every(signature =>
                signature.children.every(mesh => mesh.material.depthTest)),
              boxes: BP.world.drone.targetBoxes.length,
              boxesDepthTested: BP.world.drone.targetBoxes.every(box =>
                box.material.depthTest),
            };
          })(),
        })""")
        sensor_toggle = page.evaluate("""() => {
          const drone = BP.world.drone;
          BP.input.nvgPressed = true;
          drone.update(0.016, BP.input, BP.world.solids);
          BP.input.nvgPressed = false;
          const off = {
            thermal: drone.thermalEnabled,
            visibleSignatures: drone.thermalSignatures.filter(
              signature => signature.visible).length,
            boxes: drone.targetBoxes.filter(box => box.visible).length,
            filter: document.getElementById('game-canvas').style.filter,
          };
          BP.input.nvgPressed = true;
          drone.update(0.016, BP.input, BP.world.solids);
          BP.input.nvgPressed = false;
          return off;
        }""")
        page.wait_for_timeout(900)
        level2_movement = page.evaluate("""before => {
          const positions = BP.world.drone.combatants.map(actor => [
            actor.pos.x, actor.pos.y, actor.pos.z,
          ]);
          return {
            positions,
            moved: positions.filter((position, index) =>
              Math.hypot(
                position[0] - before.positions[index][0],
                position[2] - before.positions[index][2],
              ) > 0.08).length,
            vehicleMoved: Math.hypot(
              BP.world.drone.combatVehicles[0].pos.x - before.vehiclePosition[0],
              BP.world.drone.combatVehicles[0].pos.z - before.vehiclePosition[2],
            ) > 0.08,
          };
        }""", {
            "positions": level2_before["positions"],
            "vehiclePosition": level2_before["vehiclePosition"],
        })

        rifle = page.evaluate("""() => {
          const drone = BP.world.drone;
          const actor = drone.combatants.find(target => !target.dead);
          drone.pos.set(actor.pos.x, actor.pos.y + 4.8, actor.pos.z - 4.5);
          drone.forward.set(
            actor.pos.x - drone.pos.x,
            actor.pos.y + 1.05 - drone.pos.y,
            actor.pos.z - drone.pos.z,
          ).normalize();
          const healthBefore = actor.health;
          const roundsBefore = drone.rifleRounds;
          for (let shot = 0; shot < 3 && !actor.dead; shot++) {
            drone.fireRifle(BP.world.solids);
          }
          return {
            healthBefore,
            healthAfter: actor.health,
            dead: actor.dead,
            spent: roundsBefore - drone.rifleRounds,
            tracer: !!BP.world.staticMesh.parent.getObjectByName('drone-rifle-tracer'),
            tracerLife: drone.effects.find(effect => effect.type === 'tracer')?.life || 0,
            thermalStillAttached: drone.thermalSignatures.every(
              signature => signature.parent === BP.scene),
          };
        }""")
        grenade = page.evaluate("""() => {
          const drone = BP.world.drone;
          const actor = drone.combatants.find(target => !target.dead);
          drone.pos.set(actor.pos.x, actor.pos.y + 7, actor.pos.z - 2.5);
          drone.forward.set(
            actor.pos.x - drone.pos.x,
            actor.pos.y + 0.15 - drone.pos.y,
            actor.pos.z - drone.pos.z,
          ).normalize();
          return {
            before: drone.grenadeRounds,
            launched: drone.launchGrenade(),
            targetHealth: actor.health,
          };
        }""")
        page.wait_for_function(
            "() => BP.world.drone.munitions"
            ".every(munition => munition.type !== 'grenade')",
            timeout=90000,
        )
        grenade_after = page.evaluate("""() => ({
          grenades: BP.world.drone.grenadeRounds,
          projectiles: BP.world.drone.munitions
            .filter(munition => munition.type === 'grenade').length,
          casualties: BP.world.drone.combatants.filter(actor => actor.dead).length,
        })""")
        vehicle = page.evaluate("""() => {
          const drone = BP.world.drone;
          const vehicle = drone.combatVehicles[0];
          const before = vehicle.health;
          drone.onCombatBlast(vehicle.pos.clone(), 7, 185);
          const afterGrenade = vehicle.health;
          drone.onCombatVehicleHit(vehicle, 8);
          return {
            before,
            afterGrenade,
            dead: vehicle.dead,
          };
        }""")
        page.evaluate("""() => {
          const drone = BP.world.drone;
          for (const actor of drone.combatants) {
            if (!actor.dead) drone.onCombatHit(actor, 99999, false);
          }
          for (const vehicle of drone.combatVehicles) {
            if (!vehicle.dead) drone.onCombatVehicleHit(vehicle, 99999);
          }
        }""")
        page.wait_for_function(
            "() => !BP.world.drone && BP.world.objectiveIdx === 3",
            timeout=90000,
        )
        level2_after = page.evaluate("""() => ({
          objective: BP.world.level.objectives[BP.world.objectiveIdx].text,
          stackRestored: BP.world.allies.every(actor => actor.mesh.visible),
          assaultDead: BP.world.droneAssault.actors.every(actor => actor.dead),
        })""")

        page.evaluate("() => BP.startLevel(7)")
        page.wait_for_function(
            "() => BP.mode === 'playing' && BP.world.level.id === 7"
            " && BP.world.drone?.mode === 'combat'",
            timeout=90000,
        )
        level7_before = page.evaluate("""() => ({
          mode: BP.world.drone.mode,
          rifle: BP.world.drone.rifleRounds,
          grenades: BP.world.drone.grenadeRounds,
          combatants: BP.world.drone.combatants.length,
          vehicles: BP.world.drone.combatVehicles.length,
          staticTargets: BP.world.drone.targets.length,
          targetModels: BP.world.drone.targetModels.length,
          stackVisible: BP.world.allies.every(actor => actor.mesh.visible),
        })""")
        page.evaluate("""() => {
          const drone = BP.world.drone;
          for (const actor of drone.combatants.slice(0, -1)) {
            drone.onCombatHit(actor, 99999, false);
          }
          for (const vehicle of drone.combatVehicles) {
            drone.onCombatVehicleHit(vehicle, 99999);
          }
          BP.input.breachPressed = true;
          drone.update(0.016, BP.input, BP.world.solids);
          BP.input.breachPressed = false;
        }""")
        page.wait_for_function(
            "() => !BP.world.drone && BP.world.objectiveIdx === 1",
            timeout=90000,
        )
        level7_after = page.evaluate("""() => ({
          objective: BP.world.level.objectives[BP.world.objectiveIdx].text,
          assaultDead: BP.world.droneAssault.actors.every(actor => actor.dead),
          survivors: BP.world.droneAssault.actors.filter(actor => !actor.dead).map(actor => ({
            droneTarget: actor.droneTarget,
            hold: actor.hold,
            state: actor.state,
            hasLastKnown: !!actor.lastKnown,
          })),
        })""")

        result = {
            "level2": {
                "before": level2_before,
                "movement": level2_movement,
                "sensorToggle": sensor_toggle,
                "rifle": rifle,
                "grenade": {**grenade, **grenade_after},
                "vehicle": vehicle,
                "after": level2_after,
            },
            "level7": {
                "before": level7_before,
                "after": level7_after,
            },
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert level2_before["mode"] == "combat"
        assert level2_before["rifle"] == 100
        assert level2_before["grenades"] == 10
        assert 10 <= level2_before["combatants"] <= 12
        assert level2_before["vehicles"] == 1
        assert level2_before["optics"]["fov"] == 78
        assert "grayscale(1)" in level2_before["optics"]["canvasFilter"]
        assert level2_before["optics"]["mask"]
        assert level2_before["thermal"]["count"] == level2_before["combatants"] + 1
        assert level2_before["thermal"]["visible"] == level2_before["thermal"]["count"]
        assert level2_before["thermal"]["survivesHiddenMesh"]
        assert level2_before["thermal"]["depthTested"]
        assert level2_before["thermal"]["boxes"] == level2_before["thermal"]["count"]
        assert level2_before["thermal"]["boxesDepthTested"]
        assert sensor_toggle["thermal"] is False
        assert sensor_toggle["visibleSignatures"] == 0
        assert sensor_toggle["boxes"] == level2_before["thermal"]["count"]
        assert "grayscale" not in sensor_toggle["filter"]
        assert level2_before["staticTargets"] == 0
        assert level2_before["stackVisible"]
        assert level2_movement["moved"] == level2_before["combatants"]
        assert level2_movement["vehicleMoved"]
        assert rifle["spent"] in (2, 3)
        assert rifle["dead"]
        assert rifle["tracer"]
        assert rifle["tracerLife"] >= 0.18
        assert rifle["thermalStillAttached"]
        assert grenade["launched"]
        assert grenade_after["grenades"] == 9
        assert grenade_after["projectiles"] == 0
        assert vehicle["afterGrenade"] < vehicle["before"]
        assert vehicle["dead"]
        assert level2_after["stackRestored"]
        assert level2_after["assaultDead"]
        assert "REGROUP" in level2_after["objective"]
        assert level7_before["mode"] == "combat"
        assert level7_before["rifle"] == 100
        assert level7_before["grenades"] == 10
        assert 10 <= level7_before["combatants"] <= 12
        assert level7_before["vehicles"] == 1
        assert level7_before["staticTargets"] == 0
        assert level7_before["targetModels"] == 0
        assert level7_before["stackVisible"]
        assert not level7_after["assaultDead"]
        assert len(level7_after["survivors"]) == 1
        assert level7_after["survivors"][0]["droneTarget"] is False
        assert level7_after["survivors"][0]["hold"] is False
        assert level7_after["survivors"][0]["state"] in ("alert", "hunt", "flank", "cover")
        assert level7_after["survivors"][0]["hasLastKnown"]
        assert "CLEAR THE TOWER" in level7_after["objective"]
        browser.close()


if __name__ == "__main__":
    main()
