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
        page.evaluate("() => BP.startLevel(110)")
        page.wait_for_function("() => BP.mode === 'playing'")

        contract = page.evaluate("""() => {
          const objectives = BP.world.level.objectives;
          const roof = objectives[0].steps;
          const network = objectives[1].steps;
          const bunker = objectives[2].steps;
          const combatObjective = network.find(objective => objective.type === 'drone' && objective.mode === 'combat');
          const strikeObjective = network.find(objective => objective.type === 'drone' && objective.mode === 'strike');
          return {
            phaseIds: objectives.map(objective => objective.id),
            phaseSteps: objectives.map(objective => objective.steps.length),
            types: objectives.flatMap(objective => objective.steps.map(step => step.type)),
            towerRequiresRoof: roof[1].requireReach,
            combat: {
              mode: combatObjective.mode,
              rifle: combatObjective.rifleRounds,
              grenades: combatObjective.grenades,
              infantrySockets: combatObjective.combatWave.enemies.length,
              vehicle: combatObjective.combatWave.vehicle.kind,
            },
            strikeKinds: strikeObjective.targets.map(target => target.kind),
            strikePositions: strikeObjective.targets.map(target => target.pos),
            strikeFiring: strikeObjective.targets.map(target => target.firing),
            strikeYaw: strikeObjective.targets.map(target => target.yaw),
            strikeElevation: strikeObjective.targets.map(target => target.elevation),
            strikeSquirters: strikeObjective.targets.map(target => target.squirters),
            strikeRifle: strikeObjective.rifleRounds,
            strikeGrenades: strikeObjective.grenades,
            bunkerUnlockObjective: BP.world.level.doors.find(
              door => door.pos[1] === -5).unlockObjective,
            towerDoor: BP.world.level.doors.find(
              door => door.pos[1] === 0).pos,
            shieldText: bunker[0].text,
            motorPoolVehicles: [
              'military-transport-authored',
              'military-wheeled-apc-hull',
              'military-bmp-hull',
            ].reduce((count, name) => count + (
              BP.scene.children.find(child => child.name === name)?.count || 0), 0),
            motorPoolFamilies: [
              'military-transport-authored',
              'military-wheeled-apc-hull',
              'military-bmp-hull',
            ].filter(name => BP.scene.children.some(child => child.name === name)).length,
            reinforcementWave: {
              initiallyPresent: BP.world.enemies.filter(
                enemy => enemy.reinforcementOrigin).length,
              max: BP.world.reinf.max,
              group: BP.world.reinf.group,
              hidden: BP.world.reinf.hidden,
              scatter: BP.world.reinf.scatter,
              sockets: BP.world.reinf.at,
              socketsBehindRows: BP.world.reinf.at.every(socket =>
                Math.abs(socket[0]) >= 28 || socket[2] >= 28 || socket[2] <= -38),
            },
            burningWrecks: (() => {
              // Mission art now nests under a per-segment group; count recursively.
              let count = 0;
              BP.scene.traverse(child => {
                if (child.name.startsWith('compound-burning-wreck-')) count++;
              });
              return count;
            })(),
            render: {
              calls: BP.performance.render.calls,
              triangles: BP.performance.render.triangles,
            },
          };
        }""")
        bunker_lock = page.evaluate("""() => {
          const door = BP.world.doors.doors.find(row => row.def.unlockObjective === 2);
          BP.player.pos.copy(door.mesh.position);
          return {
            beforeNetworkStrike: BP.world.doors.nearBreachable(
              BP.player.pos, BP.player.yaw, 1) === null,
            afterNetworkStrike: BP.world.doors.nearBreachable(
              BP.player.pos, BP.player.yaw, 2) === door,
          };
        }""")
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, 27);
          BP.player.yaw = 0;
          BP.player.pitch = -0.08;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "military-compound.png"))
        # Three-quarter views show both the authored vehicle silhouettes and their opaque
        # lower hulls. The transport view also verifies the usable service lane behind its row.
        for filename, position, yaw in [
            ("military-transport-close.png", [-28, 0, 3], -2.2),
            ("military-apc-wheel-occlusion.png", [-17, 0, -24], 1.5708),
            ("military-bmp-track-occlusion.png", [16, 0, 17], -2.25),
        ]:
            page.evaluate("""view => {
              BP.player.pos.set(...view.position);
              BP.player.yaw = view.yaw;
              BP.player.pitch = -0.08;
            }""", {"position": position, "yaw": yaw})
            page.wait_for_timeout(160)
            page.screenshot(path=str(output / filename))
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, 1.2);
          BP.player.yaw = 0;
          BP.player.pitch = 0;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "tower-front-door.png"))
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, -5.2);
          BP.player.yaw = Math.PI;
          BP.player.pitch = 0;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "tower-inside-door.png"))
        page.evaluate("""() => {
          BP.player.pos.set(22, 0, -15.2);
          BP.player.yaw = 0;
          BP.player.pitch = -0.42;
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output / "bunker-entrance.png"))

        reinforcement_before = page.evaluate("""() => {
          BP.player.health = 100000;
          BP.player.pos.set(0, 0, 27);
          for (const enemy of BP.world.enemies) {
            enemy.update = () => {};
          }
          BP.world.reinf.timer = 0;
          return {
            count: BP.world.enemies.length,
            sent: BP.world.reinf.sent,
          };
        }""")
        page.wait_for_function("before => BP.world.reinf.sent >= before.sent + 3",
                               arg=reinforcement_before)
        reinforcement_spawn = page.evaluate("""before => {
          const wave = BP.world.enemies.slice(before.count);
          return {
            count: wave.length,
            origins: wave.map(enemy => enemy.reinforcementOrigin),
            positions: wave.map(enemy => enemy.pos.toArray()),
            allBehindRows: wave.every(enemy =>
              Math.abs(enemy.reinforcementOrigin[0]) >= 28
              || enemy.reinforcementOrigin[2] >= 28
              || enemy.reinforcementOrigin[2] <= -38),
          };
        }""", reinforcement_before)
        page.wait_for_timeout(8000)
        reinforcement_emergence = page.evaluate("""spawn => {
          const wave = BP.world.enemies.filter(enemy => enemy.reinforcementOrigin);
          return {
            moved: wave.filter((enemy, index) => Math.hypot(
              enemy.pos.x - spawn.positions[index][0],
              enemy.pos.z - spawn.positions[index][2]) > 0.5).length,
            enteredYard: wave.filter(enemy =>
              Math.abs(enemy.pos.x) < 28 && enemy.pos.z < 28 && enemy.pos.z > -38).length,
            actors: wave.map(enemy => ({
              pos: enemy.pos.toArray(), state: enemy.state,
              path: !!enemy.path, blocked: enemy.blocked,
            })),
          };
        }""", reinforcement_spawn)

        # A compliant soldier is neutralized for CLEAR even before the player restrains him.
        # He must remain alive and surrendered so executing him still uses the existing warning.
        page.evaluate("""() => {
          BP.world.reinf.sent = BP.world.reinf.max;
          const candidate = BP.world.enemies.find(enemy =>
            enemy.reinforcementOrigin && !enemy.dead);
          candidate.trySurrender(BP.world, 'qa-clear-contract', true);
          for (const enemy of BP.world.enemies) {
            if (enemy !== candidate && enemy.pos.y >= -1) {
              enemy.dead = true;
              enemy.mesh.visible = false;
            }
          }
          BP.world.qaSurrenderedClearActor = candidate;
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 0 && BP.world.objectiveStepIdx === 1"
        )
        surrendered_clear = page.evaluate("""() => {
          const enemy = BP.world.qaSurrenderedClearActor;
          return {
            objectiveIdx: BP.world.objectiveIdx,
            objectiveStepIdx: BP.world.objectiveStepIdx,
            dead: enemy.dead,
            surrendered: enemy.surrendered,
            secured: enemy.secured,
          };
        }""")

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
            "() => BP.world.objectiveIdx === 1 && BP.world.objectiveStepIdx === 0"
        )
        page.evaluate("""() => {
          const device = BP.world.objectiveDevices.find(row => row.id === 'l10-roof-control');
          BP.player.pos.set(device.pos[0], device.pos[1], device.pos[2]);
          BP.input.breachPressed = true;
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 1 && BP.world.objectiveStepIdx === 1"
            " && BP.world.drone?.mode === 'combat'"
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
          trackingOverlays2D: BP.world.drone.targetBoxes.every(box => box.isLineLoop),
          trackingSquareSizes: BP.world.drone.targetBoxes.map(box => {
            const points = box.geometry.attributes.position;
            const xs = Array.from({length: points.count}, (_, index) => points.getX(index));
            const ys = Array.from({length: points.count}, (_, index) => points.getY(index));
            return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
          }),
          droneInteriorRoutes: BP.world.drone.combatants.filter(
            actor => actor.droneInteriorFloor).length,
          droneLoopingRoutes: BP.world.drone.combatants.filter(
            actor => actor.droneRouteLoops).length,
          droneInteriorWaypoints: BP.world.drone.combatants
            .filter(actor => actor.droneInteriorFloor)
            .every(actor => actor.droneRoute.some(point =>
              Math.abs(point.x) < 8 && point.z < -3)),
        })""")
        page.evaluate("""() => {
          const drone = BP.world.drone;
          drone.pos.set(0, 12, 20);
          drone.vel.set(0, 0, 0);
          for (const actor of drone.combatants) actor.droneFireTimer = 0;
        }""")
        page.wait_for_function(
            "() => BP.world.drone.incomingPressure > 0.05", timeout=5000
        )
        assault_pressure = page.evaluate("""() => ({
          pressure: BP.world.drone.incomingPressure,
          velocity: BP.world.drone.vel.length(),
          tracers: BP.world.drone.effects.filter(effect =>
            effect.type === 'tracer' && effect.root.name === 'drone-incoming-tracer').length,
        })""")
        page.keyboard.press("n")
        page.wait_for_function("() => BP.world.drone.thermalEnabled")
        thermal_burst_on = page.evaluate("""() => ({
          enabled: BP.world.drone.thermalEnabled,
          remaining: BP.world.drone.thermalBurstRemaining,
          heatVisible: BP.world.drone.thermalSignatures.every(signature => signature.visible),
          filter: BP.world.drone.canvas.style.filter,
        })""")
        # Headless Chromium may throttle requestAnimationFrame while the page is not visible.
        # Advance the sensor clock directly so this remains a deterministic three-second test.
        page.evaluate("() => BP.world.drone.updateThermalBurst(3.1, {nvgPressed: false})")
        thermal_burst_expired = page.evaluate("""() => ({
          enabled: BP.world.drone.thermalEnabled,
          recharge: BP.world.drone.thermalRechargeRemaining,
          heatHidden: BP.world.drone.thermalSignatures.every(signature => !signature.visible),
          trackingVisible: BP.world.drone.targetBoxes.every(box => box.visible),
          filter: BP.world.drone.canvas.style.filter,
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
            "() => BP.world.objectiveIdx === 1 && BP.world.objectiveStepIdx === 2"
            " && BP.world.drone?.mode === 'strike'"
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
        page.evaluate("""() => {
          const drone = BP.world.drone;
          drone.pos.set(0, 18, -35);
          drone.vel.set(0, 0, 0);
          for (const target of drone.targets) target.defenceTimer = 0;
        }""")
        page.wait_for_function(
            "() => BP.world.drone.incomingPressure > 0.05", timeout=5000
        )
        artillery_pressure = page.evaluate("""() => ({
          pressure: BP.world.drone.incomingPressure,
          velocity: BP.world.drone.vel.length(),
          tracers: BP.world.drone.effects.filter(effect =>
            effect.type === 'tracer' && effect.root.name === 'drone-incoming-tracer').length,
        })""")

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
        page.wait_for_function(
            "() => BP.world.drone?.strikeCleanup && BP.world.drone.strikeSquirters.length === 6"
        )
        squirter_before = page.evaluate("""() => ({
          objectiveIdx: BP.world.objectiveIdx,
          objectiveStepIdx: BP.world.objectiveStepIdx,
          gunsMarked: BP.world.drone.targets.filter(target => target.marked).length,
          count: BP.world.drone.strikeSquirters.length,
          live: BP.world.drone.strikeSquirters.filter(actor => !actor.dead).length,
          rifle: BP.world.drone.rifleRounds,
          positions: BP.world.drone.strikeSquirters.map(actor => actor.pos.toArray()),
        })""")
        squirter_phase = page.evaluate("""before => {
          const drone = BP.world.drone;
          drone.updateStrikeSquirters(1.2, BP.world.solids);
          const moved = drone.strikeSquirters.filter((actor, index) => Math.hypot(
            actor.pos.x - before.positions[index][0],
            actor.pos.z - before.positions[index][2]) > 1).length;
          return {
            objectiveIdx: BP.world.objectiveIdx,
            objectiveStepIdx: BP.world.objectiveStepIdx,
            gunsMarked: drone.targets.filter(target => target.marked).length,
            count: drone.strikeSquirters.length,
            moved,
            stayedInOpenStrip: drone.strikeSquirters.every(actor =>
              actor.pos.z > -48 && actor.pos.z < -44 && Math.abs(actor.pos.x) < 30),
          };
        }""", squirter_before)
        page.evaluate("""() => {
          const drone = BP.world.drone;
          const actor = drone.strikeSquirters.find(candidate => !candidate.dead);
          for (const squirter of drone.strikeSquirters) squirter.speed = 0;
          drone.pos.set(actor.pos.x, actor.pos.y + 8, actor.pos.z + 8);
          drone.vel.set(0, 0, 0);
          drone.yaw = 0;
          drone.pitch = Math.atan2((actor.pos.y + 1.05) - drone.pos.y, 8);
          BP.input.fire = true;
          BP.world.qaSquirterRifleStart = drone.rifleRounds;
        }""")
        page.wait_for_function(
            "() => BP.world.drone.strikeSquirters.some(actor => actor.dead)", timeout=5000
        )
        page.evaluate("() => { BP.input.fire = false; }")
        page.keyboard.press("g")
        page.wait_for_function("() => BP.world.drone.grenadeRounds === 5")
        rifle_and_grenade = page.evaluate("""() => {
          const drone = BP.world.drone;
          const result = {
            rifleSpent: BP.world.qaSquirterRifleStart - drone.rifleRounds,
            killedByTrigger: drone.strikeSquirters.filter(actor => actor.dead).length,
            grenadeSpent: 6 - drone.grenadeRounds,
          };
          for (const actor of drone.strikeSquirters) {
            drone.damageStrikeSquirter(actor, 99999, true);
          }
          result.allNeutralized = drone.strikeSquirters.every(actor => actor.dead);
          return result;
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 2 && BP.world.objectiveStepIdx === 1"
        )
        shield_transition = page.evaluate("""() => ({
          objectiveIdx: BP.world.objectiveIdx,
          objectiveStepIdx: BP.world.objectiveStepIdx,
          text: BP.objective.text,
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
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 2 && BP.world.objectiveStepIdx === 2"
        )
        page.evaluate("""() => {
          const bastion = BP.world.enemies.find(enemy => enemy.hvt);
          bastion.dead = true;
          bastion.mesh.visible = false;
        }""")
        page.wait_for_function("() => BP.mode === 'debrief' && BP.world.won")

        result = {
            "contract": contract,
            "bunkerLock": bunker_lock,
            "reinforcementSpawn": reinforcement_spawn,
            "reinforcementEmergence": reinforcement_emergence,
            "surrenderedClear": surrendered_clear,
            "combatBefore": combat_before,
            "thermalBurstOn": thermal_burst_on,
            "thermalBurstExpired": thermal_burst_expired,
            "assaultPressure": assault_pressure,
            "movement": movement,
            "strikeBefore": strike_before,
            "artilleryPressure": artillery_pressure,
            "squirterBefore": squirter_before,
            "squirterPhase": squirter_phase,
            "rifleAndGrenade": rifle_and_grenade,
            "prefreed": prefreed,
            "shieldTransition": shield_transition,
            "won": page.evaluate("() => BP.world.won"),
            "screenshots": [
                "military-compound.png",
                "military-transport-close.png",
                "military-apc-wheel-occlusion.png",
                "military-bmp-track-occlusion.png",
                "tower-front-door.png",
                "tower-inside-door.png",
                "bunker-entrance.png",
                "rooftop-armed-uav.png",
                "artillery-battery.png",
            ],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert contract["phaseIds"] == ["district-roof", "district-network", "district-bunker"], result
        assert contract["phaseSteps"] == [2, 3, 3], result
        assert contract["types"] == [
            "clear", "clear", "interact", "drone", "drone", "rescue", "clear", "target"
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
        assert all(position[2] < -40 for position in contract["strikePositions"]), result
        assert contract["strikeFiring"] == [True, True, True], result
        assert len(set(position[2] for position in contract["strikePositions"])) == 1, result
        assert contract["strikeYaw"] == [1.5707963267948966] * 3, result
        assert contract["strikeElevation"] == [0.92, 0.92, 0.92], result
        assert contract["strikeSquirters"] == [2, 2, 2], result
        assert contract["strikeRifle"] == 72, result
        assert contract["strikeGrenades"] == 6, result
        assert contract["motorPoolVehicles"] == 25, result
        assert contract["motorPoolFamilies"] == 3, result
        reinforcement_wave = contract["reinforcementWave"]
        assert reinforcement_wave["initiallyPresent"] == 0, result
        assert reinforcement_wave["max"] == 9 and reinforcement_wave["group"] == 3, result
        assert reinforcement_wave["hidden"] and reinforcement_wave["scatter"] == 0, result
        assert len(reinforcement_wave["sockets"]) == 6, result
        assert reinforcement_wave["socketsBehindRows"], result
        assert result["reinforcementSpawn"]["count"] == 3, result
        assert result["reinforcementSpawn"]["allBehindRows"], result
        assert result["reinforcementEmergence"]["moved"] == 3, result
        assert result["reinforcementEmergence"]["enteredYard"] >= 1, result
        assert result["surrenderedClear"] == {
            "objectiveIdx": 0,
            "objectiveStepIdx": 1,
            "dead": False,
            "surrendered": True,
            "secured": False,
        }, result
        assert contract["burningWrecks"] == 2, result
        assert contract["render"]["calls"] < 450, result
        assert contract["render"]["triangles"] < 1_500_000, result
        assert contract["bunkerUnlockObjective"] == 2, result
        assert contract["towerDoor"] == [0, 0, -3], result
        assert "HUMAN SHIELDS" in contract["shieldText"], result
        assert all(bunker_lock.values()), result
        assert 10 <= combat_before["infantry"] <= 12, result
        assert combat_before["vehicles"] == 1, result
        assert combat_before["rifle"] == 100 and combat_before["grenades"] == 10, result
        assert combat_before["thermal"] == combat_before["infantry"] + 1, result
        assert combat_before["stackVisible"], result
        assert combat_before["trackingOverlays2D"], result
        assert all(abs(width - height) < 0.001 and width < 0.93
                   for width, height in combat_before["trackingSquareSizes"]), result
        assert result["thermalBurstOn"]["enabled"], result
        assert 0 < result["thermalBurstOn"]["remaining"] <= 3, result
        assert result["thermalBurstOn"]["heatVisible"], result
        assert "brightness(0.72)" in result["thermalBurstOn"]["filter"], result
        assert not result["thermalBurstExpired"]["enabled"], result
        assert result["thermalBurstExpired"]["recharge"] > 0, result
        assert result["thermalBurstExpired"]["heatHidden"], result
        assert result["thermalBurstExpired"]["trackingVisible"], result
        assert "brightness(0.9)" in result["thermalBurstExpired"]["filter"], result
        assert combat_before["droneInteriorRoutes"] == 6, result
        assert combat_before["droneLoopingRoutes"] == combat_before["infantry"], result
        assert combat_before["droneInteriorWaypoints"], result
        assert result["assaultPressure"]["pressure"] > 0.05, result
        assert result["assaultPressure"]["velocity"] > 0.1, result
        assert result["assaultPressure"]["tracers"] >= 1, result
        assert movement["infantryMoved"] == combat_before["infantry"], result
        assert movement["vehicleMoved"], result
        assert strike_before == {
            "targets": 3,
            "kinds": ["artillery", "artillery", "artillery"],
            "models": 3,
            "firingModels": 3,
            "crews": [3, 3, 3],
        }, result
        assert result["artilleryPressure"]["pressure"] > 0.05, result
        assert result["artilleryPressure"]["velocity"] > 0.1, result
        assert result["artilleryPressure"]["tracers"] >= 1, result
        assert squirter_before["objectiveIdx"] == 1, result
        assert squirter_before["objectiveStepIdx"] == 2, result
        assert squirter_before["gunsMarked"] == 3, result
        assert squirter_before["count"] == 6 and squirter_before["live"] == 6, result
        assert squirter_before["rifle"] == 72, result
        assert squirter_phase["objectiveIdx"] == 1, result
        assert squirter_phase["objectiveStepIdx"] == 2, result
        assert squirter_phase["gunsMarked"] == 3 and squirter_phase["count"] == 6, result
        assert squirter_phase["moved"] == 6, result
        assert squirter_phase["stayedInOpenStrip"], result
        assert rifle_and_grenade["rifleSpent"] >= 1, result
        assert rifle_and_grenade["killedByTrigger"] >= 1, result
        assert rifle_and_grenade["grenadeSpent"] == 1, result
        assert rifle_and_grenade["allNeutralized"], result
        assert prefreed == {"count": 2, "allFreed": True}, result
        assert shield_transition["objectiveIdx"] == 2, result
        assert shield_transition["objectiveStepIdx"] == 1, result
        assert "BUNKER GUARD" in shield_transition["text"], result
        assert shield_transition["droneDisposed"] and shield_transition["playerRestored"], result
        assert result["won"], result
        browser.close()


if __name__ == "__main__":
    main()
