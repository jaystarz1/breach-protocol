#!/usr/bin/env python3
"""Verify surrender eligibility, readable posture, weapon drop, targeting, and penalties."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-surrender")
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
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(102)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(250)

        result = page.evaluate("""async () => {
          const THREE = await import('./lib/three.module.js');
          const world = BP.world;
          const actors = world.enemies.filter(enemy =>
            !enemy.hvt && !enemy.bastion && !enemy.flee && !enemy.perches
            && !enemy.concealed);
          if (actors.length < 3) throw new Error('Surrender QA needs three ordinary hostiles');
          for (const actor of [...world.enemies, ...world.allies, ...world.civilians]) {
            actor.update = () => {};
          }
          BP.player.locked = true;
          BP.player.health = 100000;
          BP.weapons.holder.visible = false;

          const candidate = actors[0];
          candidate.surrenderEligible = true;
          candidate.mesh.position.set(
            BP.player.pos.x, BP.player.pos.y, BP.player.pos.z - 5.5);
          candidate.mesh.rotation.set(0, 0, 0);
          candidate.yaw = 0;
          for (let index = 0; index < world.enemies.length; index++) {
            if (world.enemies[index] === candidate) continue;
            world.enemies[index].mesh.position.x += 80 + index * 2;
          }
          const surrendered = candidate.applyFlashStun(1, world);
          const rig = candidate.mesh.userData.rig;
          const find = name => {
            let result = rig.visual?.getObjectByName(name);
            const expected = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
            rig.visual?.traverse(object => {
              const actual = (object.name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
              if (!result && (actual === expected || actual.endsWith(expected))) result = object;
            });
            return result;
          };
          candidate.mesh.updateMatrixWorld(true);
          const local = object => candidate.mesh.worldToLocal(
            object.getWorldPosition(new THREE.Vector3())).toArray()
              .map(value => +value.toFixed(3));
          const wristL = find('Wrist.L');
          const wristR = find('Wrist.R');
          const elbowL = find('LowerArm.L');
          const elbowR = find('LowerArm.R');
          const squadTarget = world.allies[0]?.acquire(world) || null;
          const scoreAfterSurrender = world.stats.score;
          window.__QA_SURRENDERED = candidate;
          window.__QA_SURRENDER_SCORE = scoreAfterSurrender;

          // A supported rifleman remains in the fight even under the same pressure.
          const supported = actors[1];
          const wingman = actors[2];
          supported.surrenderEligible = true;
          supported.suppression = 1;
          supported.health = supported.maxHealth * 0.2;
          supported.mesh.position.set(20, BP.player.pos.y, 20);
          wingman.mesh.position.set(21, BP.player.pos.y, 20);
          const refusedWithSupport = !supported.trySurrender(world, 'suppressed');

          return {
            surrendered,
            stateBeforeExecution: 'surrender',
            droppedWeapon: {
              name: rig.droppedWeapon?.name || '',
              parentType: rig.droppedWeapon?.parent?.type || '',
              floorY: +(rig.droppedWeapon?.position.y ?? -99).toFixed(3),
              carriedReferenceCleared: rig.rifle === null,
            },
            posture: {
              wristL: wristL ? local(wristL) : null,
              wristR: wristR ? local(wristR) : null,
              elbowL: elbowL ? local(elbowL) : null,
              elbowR: elbowR ? local(elbowR) : null,
            },
            ignoredBySquad: squadTarget !== candidate,
            refusedWithSupport,
            statsBeforeExecution: {
              surrenders: world.stats.surrenders,
              detaineeKills: world.stats.detaineeKills,
              kills: world.stats.kills,
            },
          };
        }""")
        page.wait_for_timeout(100)
        page.screenshot(path=str(output / "surrender-state.png"), timeout=90000)
        page.evaluate("""() => {
          const candidate = window.__QA_SURRENDERED;
          BP.player.pos.set(candidate.pos.x, candidate.pos.y, candidate.pos.z + 0.7);
        }""")
        page.wait_for_function("() => window.__QA_SURRENDERED.secured")
        security = page.evaluate("""async () => {
          const THREE = await import('./lib/three.module.js');
          const candidate = window.__QA_SURRENDERED;
          const rig = candidate.mesh.userData.rig;
          const find = name => {
            let result = null;
            const expected = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
            rig.visual.traverse(object => {
              const actual = (object.name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
              if (!result && (actual === expected || actual.endsWith(expected))) result = object;
            });
            return result;
          };
          const local = object => candidate.mesh.worldToLocal(
            object.getWorldPosition(new THREE.Vector3())).toArray()
              .map(value => +value.toFixed(3));
          candidate.mesh.updateMatrixWorld(true);
          window.__QA_SECURE_SCORE = BP.world.stats.score;
          return {
            secured: candidate.secured,
            state: candidate.state,
            visualDrop: +(rig.baseVisualY - rig.visual.position.y).toFixed(3),
            wristL: local(find('Wrist.L')),
            wristR: local(find('Wrist.R')),
            stats: {
              surrenders: BP.world.stats.surrenders,
              detaineesSecured: BP.world.stats.detaineesSecured,
            },
          };
        }""")
        page.screenshot(path=str(output / "secured-kneel.png"), timeout=90000)
        execution = page.evaluate("""() => {
          const candidate = window.__QA_SURRENDERED;
          candidate.damage(99999, BP.world, true, false);
          return {
            stats: {
              surrenders: BP.world.stats.surrenders,
              detaineeKills: BP.world.stats.detaineeKills,
              kills: BP.world.stats.kills,
              scoreDelta: BP.world.stats.score - window.__QA_SECURE_SCORE,
            },
            actor: {
              dead: candidate.dead,
              surrendered: candidate.surrendered,
              executed: candidate.executed,
            },
          };
        }""")
        result["security"] = security
        result["execution"] = execution
        result["errors"] = errors[:10]
        result["screenshot"] = str(output / "surrender-state.png")
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert result["surrendered"], result
        assert result["droppedWeapon"]["name"] == "dropped-hostile-rifle", result
        assert result["droppedWeapon"]["parentType"] == "Scene", result
        assert result["droppedWeapon"]["carriedReferenceCleared"], result
        assert result["posture"]["wristL"] and result["posture"]["wristR"], result
        assert result["posture"]["wristL"][1] > 1.45, result
        assert result["posture"]["wristR"][1] > 1.45, result
        assert result["posture"]["wristL"][0] > 0, result
        assert result["posture"]["wristR"][0] < 0, result
        assert result["posture"]["elbowL"][1] < result["posture"]["wristL"][1], result
        assert result["posture"]["elbowR"][1] < result["posture"]["wristR"][1], result
        assert result["ignoredBySquad"], result
        assert result["refusedWithSupport"], result
        assert result["statsBeforeExecution"] == {
            "surrenders": 1, "detaineeKills": 0, "kills": 0,
        }, result
        assert result["security"]["secured"], result
        assert result["security"]["state"] == "secured", result
        assert result["security"]["visualDrop"] > 0.35, result
        assert result["security"]["wristL"][1] > 1.15, result
        assert result["security"]["wristR"][1] > 1.15, result
        assert result["security"]["wristL"][0] > 0, result
        assert result["security"]["wristR"][0] < 0, result
        assert result["security"]["stats"] == {
            "surrenders": 1, "detaineesSecured": 1,
        }, result
        assert result["execution"]["stats"]["surrenders"] == 1, result
        assert result["execution"]["stats"]["detaineeKills"] == 1, result
        assert result["execution"]["stats"]["scoreDelta"] == -300, result
        assert result["execution"]["actor"] == {
            "dead": True, "surrendered": False, "executed": True,
        }, result
        browser.close()


if __name__ == "__main__":
    main()
