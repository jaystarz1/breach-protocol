#!/usr/bin/env python3
"""Verify Hold District's authored assault waves and network-enabled strike transition."""
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
        browser = playwright.chromium.launch(headless=True)
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

        objective_contract = page.evaluate("""() => ({
          types: BP.world.level.objectives.map(objective => objective.type),
          brief: BP.world.level.brief,
          duration: BP.world.level.objectives.find(
            objective => objective.type === 'defend')?.duration,
          waves: BP.world.level.objectives.find(
            objective => objective.type === 'defend')?.waves.length,
          strikeTargets: BP.world.level.objectives.find(
            objective => objective.type === 'drone')?.targets.map(target => target.kind),
          bunkerUnlockObjective: BP.world.level.doors.find(
            door => door.pos[1] === -5)?.unlockObjective,
          postStrikeText: BP.world.level.objectives[4]?.text,
        })""")
        bunker_lock = page.evaluate("""() => {
          const door = BP.world.doors.doors.find(row => row.def.unlockObjective === 4);
          BP.player.pos.copy(door.mesh.position);
          return {
            beforeStrike: BP.world.doors.nearBreachable(
              BP.player.pos, BP.player.yaw, 3) === null,
            afterStrike: BP.world.doors.nearBreachable(
              BP.player.pos, BP.player.yaw, 4) === door,
            directBreachRejected: BP.world.doors.breach(
              door, {...BP.world, objectiveIdx: 3}) === false,
            stillClosed: !door.breached,
          };
        }""")
        # Remove only the authored opening force. The defense code must create and own every
        # attacker counted below; bunker personnel remain alive but below the surface.
        page.evaluate("""() => {
          BP.player.health = 100000;
          BP.player.pos.set(0, 6.1, -10);
          BP.player.yaw = Math.PI;
          BP.player.pitch = -0.08;
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
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 2"
            " && BP.world.objectiveState?.type === 'defend'"
        )
        programs_before = page.evaluate("() => BP.performance.resources.programs")
        roof_art = page.evaluate("""() => {
          const root = BP.world.staticMesh.parent;
          const row = name => {
            const object = root.getObjectByName(name);
            return object ? {
              exists: true,
              instances: object.count || object.userData.instanceCount || 1,
              children: object.children.length,
              vertices: object.geometry?.attributes?.position?.count || 0,
            } : { exists: false, instances: 0, children: 0, vertices: 0 };
          };
          return {
            equipment: {
              ...row('final-fire-control-equipment-merged'),
              components: root.getObjectByName(
                'final-fire-control-equipment-merged'
              )?.geometry?.userData?.components || 0,
              droneSourceMeshes: root.getObjectByName(
                'final-fire-control-equipment-merged'
              )?.geometry?.userData?.droneSourceMeshes || 0,
              vertexColors: root.getObjectByName(
                'final-fire-control-equipment-merged'
              )?.geometry?.attributes?.color?.count || 0,
            },
            cable: row('final-fire-control-signal-cable'),
          };
        }""")
        paused = page.evaluate("""async () => {
          BP.player.pos.set(0, 0, 38);
          await new Promise(resolve => setTimeout(resolve, 240));
          const before = BP.world.objectiveState.elapsed;
          await new Promise(resolve => setTimeout(resolve, 240));
          const after = BP.world.objectiveState.elapsed;
          const row = {
            before,
            after,
            delta: +(after - before).toFixed(4),
            atPost: BP.world.objectiveState.atPost,
            objective: document.querySelector('#objective')?.textContent,
            reinforcement: document.querySelector('#reinf-warn')?.textContent,
          };
          BP.player.pos.set(0, 6.1, -10);
          return row;
        }""")

        waves = []
        for threshold, expected in ((0.2, 1), (11.1, 2), (22.1, 3)):
            page.evaluate(
                """threshold => {
                  BP.world.objectiveState.elapsed = threshold;
                  BP.player.health = 100000;
                }""",
                threshold,
            )
            page.wait_for_function(
                f"() => BP.world.objectiveState.wavesSent === {expected}"
            )
            movement = None
            if expected == 1:
                page.evaluate("""() => {
                  window.__qaWaveStarts = BP.world.enemies
                    .filter(enemy => !enemy.dead
                      && enemy.defenseObjective === BP.world.objectiveIdx)
                    .map(enemy => enemy.pos.clone());
                }""")
                page.wait_for_timeout(900)
                movement = page.evaluate("""() => {
                  const actors = BP.world.enemies.filter(enemy => !enemy.dead
                    && enemy.defenseObjective === BP.world.objectiveIdx);
                  const distances = actors.map((enemy, index) =>
                    enemy.pos.distanceTo(window.__qaWaveStarts[index]));
                  return {
                    moved: distances.filter(distance => distance > 0.08).length,
                    maxDistance: +Math.max(...distances).toFixed(3),
                  };
                }""")
            row = page.evaluate("""() => ({
              wavesSent: BP.world.objectiveState.wavesSent,
              spawned: BP.world.objectiveState.spawned,
              live: BP.world.enemies.filter(enemy =>
                !enemy.dead && enemy.defenseObjective === BP.world.objectiveIdx).length,
              alert: BP.world.enemies.filter(enemy =>
                !enemy.dead && enemy.defenseObjective === BP.world.objectiveIdx)
                .every(enemy => enemy.state === 'alert' || enemy.state === 'hunt'
                  || enemy.state === 'cover'),
              objective: document.querySelector('#objective')?.textContent,
              reinforcement: document.querySelector('#reinf-warn')?.textContent,
            })""")
            row["movement"] = movement
            waves.append(row)
            # Freeze only this wave after its state has been observed. This keeps the QA camera
            # alive while retaining all attackers for the cumulative ownership assertion.
            page.evaluate("""() => {
              for (const enemy of BP.world.enemies) {
                if (!enemy.dead && enemy.defenseObjective === BP.world.objectiveIdx) {
                  enemy.update = () => {};
                }
              }
            }""")

        page.screenshot(path=str(output / "tower-defense.png"), timeout=90000)
        page.evaluate("""() => {
          for (const enemy of BP.world.enemies) {
            if (enemy.defenseObjective === BP.world.objectiveIdx) {
              enemy.dead = true;
              enemy.mesh.visible = false;
            }
          }
          BP.world.objectiveState.elapsed = 32.1;
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 3 && !!BP.world.drone"
        )
        strike_before = page.evaluate("""() => ({
          mode: BP.world.drone.mode,
          label: document.querySelector('.drone-label')?.textContent,
          targets: BP.world.drone.targets.length,
          kinds: BP.world.drone.targets.map(target => target.kind),
          models: BP.world.drone.targetModels.filter(Boolean).length,
          locked: BP.player.locked,
          programs: BP.performance.resources.programs,
        })""")
        page.screenshot(path=str(output / "network-strike.png"), timeout=90000)

        page.evaluate("""() => {
          window.__qaFinalWrecks = BP.world.drone.targetModels;
          for (const target of BP.world.drone.targets) {
            BP.world.drone.releaseMunition(target);
          }
          BP.world.drone.updateMunitions(2);
          BP.world.drone.updateEffects(0.12);
        }""")
        page.wait_for_timeout(1200)
        page.wait_for_function("() => BP.world.objectiveIdx === 4")
        strike_after = page.evaluate("""() => ({
          objectiveIdx: BP.world.objectiveIdx,
          restored: !BP.player.locked,
          overlayRemoved: !document.querySelector('.drone-frame'),
          wrecksPersist: window.__qaFinalWrecks.every(
            model => model.userData.destroyed && !!model.parent),
          programs: BP.performance.resources.programs,
          compiledDuringWindow: BP.performance.resources.compiledDuringWindow,
        })""")
        completion = page.evaluate("""() => {
          for (const civilian of BP.world.civilians) {
            if (civilian.hostage && civilian.pos.y < -2) civilian.rescue('you');
          }
          return { rescued: BP.world.civilians.filter(
            civilian => civilian.wasHostage && civilian.pos.y < -2
              && civilian.rescued).length };
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 5")
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
        completion.update(page.evaluate("""() => ({
          finalObjectiveIdx: BP.world.objectiveIdx,
          won: BP.world.won,
        })"""))

        result = {
            "contract": objective_contract,
            "bunkerLock": bunker_lock,
            "waves": waves,
            "pausedAwayFromPost": paused,
            "roofArt": roof_art,
            "programsBefore": programs_before,
            "strikeBefore": strike_before,
            "strikeAfter": strike_after,
            "completion": completion,
            "screenshots": ["tower-defense.png", "network-strike.png"],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))

        assert objective_contract["types"] == [
            "clear", "clear", "defend", "drone", "rescue", "clear", "target"
        ], result
        assert objective_contract["bunkerUnlockObjective"] == 4, result
        assert "HUMAN SHIELDS" in objective_contract["postStrikeText"], result
        assert all(bunker_lock.values()), result
        assert objective_contract["duration"] == 32, result
        assert objective_contract["waves"] == 3, result
        assert objective_contract["strikeTargets"] == [
            "armor", "artillery", "ew"
        ], result
        assert "three assault waves" in objective_contract["brief"], result
        assert [row["wavesSent"] for row in waves] == [1, 2, 3], result
        assert [row["spawned"] for row in waves] == [3, 6, 9], result
        assert [row["live"] for row in waves] == [3, 6, 9], result
        assert all(row["alert"] for row in waves), result
        assert waves[0]["movement"]["moved"] >= 2, result
        assert waves[0]["movement"]["maxDistance"] > 0.1, result
        assert not paused["atPost"] and paused["delta"] < 0.04, result
        assert "RETURN TO FIRE-CONTROL TOWER" in paused["objective"], result
        assert "LINK PAUSED" in paused["reinforcement"], result
        assert roof_art["equipment"]["instances"] == 1, result
        assert roof_art["equipment"]["droneSourceMeshes"] >= 14, result
        assert roof_art["equipment"]["components"] >= 22, result
        assert roof_art["equipment"]["vertexColors"] == \
            roof_art["equipment"]["vertices"], result
        assert roof_art["cable"]["vertices"] == 18, result
        assert strike_before["mode"] == "strike", result
        assert strike_before["targets"] == 3 and strike_before["models"] == 3, result
        assert strike_before["locked"], result
        assert strike_after["objectiveIdx"] == 4, result
        assert strike_after["restored"] and strike_after["overlayRemoved"], result
        assert strike_after["wrecksPersist"], result
        assert strike_before["programs"] == programs_before, result
        assert strike_after["programs"] == programs_before, result
        assert strike_after["compiledDuringWindow"] == 0, result
        assert completion["rescued"] == 2, result
        assert completion["won"] and completion["finalObjectiveIdx"] == 7, result
        assert not errors, result
        browser.close()


if __name__ == "__main__":
    main()
