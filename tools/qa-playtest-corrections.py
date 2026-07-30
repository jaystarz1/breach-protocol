#!/usr/bin/env python3
"""Regression coverage for the July desktop playtest correction pass."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-playtest-corrections")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)

        page.evaluate("() => BP.startLevel(2)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        correction = page.evaluate("""async () => {
          const heldA = new KeyboardEvent('keydown', {
            code: 'KeyA', key: 'a', repeat: true, bubbles: true, cancelable: true,
          });
          const heldADefaultPrevented = !window.dispatchEvent(heldA);
          window.dispatchEvent(new KeyboardEvent('keyup', {
            code: 'KeyA', key: 'a', bubbles: true, cancelable: true,
          }));
          const controls = await import('./src/input.js');
          BP.input.sensScale = 0.28;
          window.dispatchEvent(new KeyboardEvent('keydown', {
            code: 'ArrowRight', key: 'ArrowRight', bubbles: true, cancelable: true,
          }));
          controls.applyKeyLook(1 / 60);
          const scopedArrowNudge = BP.input.lookDelta.x;
          window.dispatchEvent(new KeyboardEvent('keyup', {
            code: 'ArrowRight', key: 'ArrowRight', bubbles: true, cancelable: true,
          }));
          BP.input.lookDelta.x = 0;

          const civilian = BP.world.civilians.find(actor => !actor.hostage);
          civilian.mesh.position.set(BP.player.pos.x, BP.player.pos.y, BP.player.pos.z - 4);
          civilian.mesh.rotation.set(0, 0, 0);
          for (let frame = 0; frame < 25; frame++) civilian.takeCover(0.04);
          const rig = civilian.mesh.userData.rig;
          const cover = {
            amount: civilian.prone,
            rootPitch: civilian.mesh.rotation.x,
            visualDrop: rig.authored ? rig.baseVisualY - rig.visual.position.y : 0,
            visualPitch: rig.authored ? rig.visual.rotation.x : 0,
            hasCoverBones: !!rig.coverBones,
          };

          return {
            heldADefaultPrevented,
            scopedArrowNudge,
            cover,
            backingMasses: BP.world.solids.filter(solid => {
              const x = (solid.min.x + solid.max.x) / 2;
              const width = solid.max.x - solid.min.x;
              return Math.abs(Math.abs(x) - 23.2) < 0.4 && width > 13;
            }).length,
          };
        }""")
        page.wait_for_timeout(100)
        page.screenshot(path=str(output / "civilian-cover.png"))

        page.evaluate("""() => {
          if (BP.world.reinf) BP.world.reinf.sent = BP.world.reinf.max;
          for (const enemy of BP.world.enemies) {
            enemy.dead = true;
            enemy.mesh.visible = false;
          }
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 1", timeout=5000)
        transient_before = page.evaluate("""() => {
          BP.weapons.onFire(0);
          return BP.world.effects.filter(effect => effect.combatTransient).length;
        }""")
        page.evaluate("""() => {
          const timer = setInterval(() => BP.player.pos.set(-11.2, 0.1, -41.6), 16);
          setTimeout(() => clearInterval(timer), 750);
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 2 && !!BP.world.drone", timeout=5000
        )
        recon = page.evaluate("""() => {
          const drone = BP.world.drone;
          drone.pos.set(0, 24, -8);
          drone.yaw = Math.PI;
          drone.pitch = -0.58;
          drone.vel.set(0, 0, 0);
          return {
            mode: drone.mode,
            combatants: drone.combatants.length,
            vehicles: drone.combatVehicles.length,
            rifle: drone.rifleRounds,
            grenades: drone.grenadeRounds,
            transientAfter: BP.world.effects.filter(effect => effect.combatTransient).length,
            visibleTargets: drone.combatants.filter(actor => actor.mesh.visible).length,
            visibleStack: BP.world.allies.filter(actor => actor.mesh.visible).length,
            hiddenOtherActors: [
              ...BP.world.enemies.filter(actor => !actor.droneTarget),
              ...BP.world.civilians,
            ].every(actor => !actor.mesh.visible),
          };
        }""")
        recon["transientBefore"] = transient_before
        page.wait_for_timeout(100)
        page.screenshot(path=str(output / "armed-drone-consequence.png"))

        page.evaluate("() => BP.startLevel(3)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        doors = page.evaluate("""() => ({
          count: BP.world.doors.doors.length,
          framed: BP.world.doors.doors.every(door =>
            door.frame?.name === 'breach-portal-reveal'
            && door.frame.getObjectByName('portal-structure')
            && door.frame.getObjectByName('portal-warning-headers')),
          persistentAfterLeaf: BP.world.doors.doors.every(door =>
            door.frame.parent === door.mesh.parent && door.frame !== door.mesh),
        })""")
        page.evaluate("""() => {
          BP.player.pos.set(-7, 0, 7.2);
          BP.player.yaw = 0;
          BP.player.pitch = 0;
        }""")
        page.wait_for_timeout(100)
        page.screenshot(path=str(output / "exterior-door.png"))

        page.evaluate("() => BP.startLevel(6)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        head = page.evaluate("""async () => {
          const { animateRig, coverPoseRig } = await import('./src/levelgen.js');
          const civilian = BP.world.civilians.find(actor => !actor.hostage);
          for (const actor of [...BP.world.enemies, ...BP.world.allies, ...BP.world.civilians]) {
            actor.update = () => {};
          }
          const rig = civilian.mesh.userData.rig;
          let panicMax = 0;
          for (let frame = 0; frame < 1800; frame++) {
            animateRig(civilian.mesh, frame * 0.19, true, 0, true, 'flee');
            const pose = rig.civilianFramePose;
            panicMax = Math.max(panicMax, pose.head.quaternion.angleTo(pose.headBase));
          }
          let coverMax = 0;
          for (let frame = 0; frame < 900; frame++) {
            animateRig(civilian.mesh, frame * 0.11, false, 0, false, 'idle');
            coverPoseRig(civilian.mesh, 1);
            const pose = rig.civilianFramePose;
            coverMax = Math.max(coverMax, pose.head.quaternion.angleTo(pose.headBase));
          }
          return {
            panicMax: +panicMax.toFixed(4),
            coverMax: +coverMax.toFixed(4),
            finite: rig.civilianFramePose.head.quaternion.toArray().every(Number.isFinite),
          };
        }""")
        sniper = page.evaluate("""() => {
          const previous = window.__bpVisualProps;
          window.__bpVisualProps = [];
          BP.LEVELS[5].geo();
          const facades = window.__bpVisualProps.filter(prop =>
            prop.kind === 'facade' && [611, 612, 613].includes(prop.seed));
          const result = {
            facades: facades.length,
            allStatic: facades.every(prop => prop.staticWindows),
            skipCounts: facades.map(prop => prop.skip?.length || 0),
          };
          window.__bpVisualProps = previous;
          return result;
        }""")
        page.evaluate("""() => {
          for (const actor of [
            ...BP.world.enemies, ...BP.world.civilians, ...(BP.world.allies || []),
          ]) {
            actor.update = () => {};
            actor.mesh.visible = false;
          }
          BP.player.health = 100000;
          BP.player.locked = true;
          BP.input.ads = true;
          BP.input.breath = true;
          BP.player.pos.set(0, 24.2, 62);
          const target = [0, 6.2, -99.4];
          const dx = target[0] - BP.player.pos.x;
          const dz = target[2] - BP.player.pos.z;
          BP.player.yaw = Math.atan2(-dx, -dz);
          BP.player.pitch = Math.atan2(
            target[1] - (BP.player.pos.y + 1.6), Math.hypot(dx, dz));
          BP.world.staticMesh.parent.traverse(object => {
            const label = (object.name || '').toLowerCase();
            if (object.isPoints || object.isSprite
              || label.includes('snow') || label.includes('particle')) {
              object.visible = false;
            }
          });
        }""")
        page.wait_for_timeout(500)
        sniper["farArchitecturalPanes"] = page.evaluate("""async () => {
          const THREE = await import('three');
          const matrix = new THREE.Matrix4();
          const worldMatrix = new THREE.Matrix4();
          const position = new THREE.Vector3();
          let count = 0;
          BP.world.staticMesh.parent.updateMatrixWorld(true);
          BP.world.staticMesh.parent.traverse(object => {
            if (object.name !== 'pane-architectural' || !object.isInstancedMesh) return;
            for (let index = 0; index < object.count; index++) {
              object.getMatrixAt(index, matrix);
              worldMatrix.multiplyMatrices(object.matrixWorld, matrix);
              position.setFromMatrixPosition(worldMatrix);
              const onFarBlock = position.z < -79 && position.z > -102
                && ((position.x > -56 && position.x < -24)
                  || (position.x > 24 && position.x < 56)
                  || (position.x > -21 && position.x < 21));
              if (onFarBlock) count++;
            }
          });
          return count;
        }""")
        sniper["postProcess"] = page.evaluate("() => BP.performance.postProcess")

        page.evaluate("() => BP.startLevel(10)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        corpse = page.evaluate("""async () => {
          const THREE = await import('./lib/three.module.js');
          const { deathPose, animateDeathRig, settleDeathRig } =
            await import('./src/levelgen.js');
          const { groundHeight } = await import('./src/physics.js');
          const enemy = BP.world.enemies[0];
          for (const actor of [...BP.world.enemies, ...BP.world.allies, ...BP.world.civilians]) {
            actor.update = () => {};
            actor.mesh.visible = actor === enemy;
          }
          const x = 22, z = -20;
          const ground = groundHeight(BP.world.solids, x, z, 0.16, 1);
          enemy.mesh.position.set(x, ground, z);
          enemy.mesh.rotation.set(0, 0, 0);
          enemy.mesh.userData.rig.variant = 0;
          deathPose(enemy.mesh);
          for (let frame = 0; frame < 60; frame++) {
            animateDeathRig(enemy.mesh, 1 / 60);
            settleDeathRig(enemy.mesh, BP.world.solids, 1 / 60);
          }
          const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(enemy.mesh.quaternion);
          const sx = enemy.pos.x + axis.x * 0.88;
          const sz = enemy.pos.z + axis.z * 0.88;
          const support = groundHeight(
            BP.world.solids, sx, sz, 0.16, enemy.pos.y + 1.15);
          const torsoY = enemy.pos.y + axis.y * 0.88;
          return {
            rootY: +enemy.pos.y.toFixed(3),
            support: +support.toFixed(3),
            torsoClearance: +(torsoY - support).toFixed(3),
            complete: enemy.mesh.userData.deathMotion.t,
          };
        }""")

        result = {
            "correction": correction,
            "recon": recon,
            "doors": doors,
            "head": head,
            "corpse": corpse,
            "sniper": sniper,
            "errors": errors[:8],
            "screenshots": [
                "civilian-cover.png", "armed-drone-consequence.png", "exterior-door.png"
            ],
        }
        print(json.dumps(result, indent=2))
        assert not errors, result
        assert correction["heldADefaultPrevented"], result
        assert 0.001 < correction["scopedArrowNudge"] < 0.005, result
        assert correction["cover"]["amount"] == 1, result
        assert abs(correction["cover"]["rootPitch"]) < 0.01, result
        assert correction["cover"]["visualDrop"] > 0.45, result
        assert correction["cover"]["hasCoverBones"], result
        assert correction["backingMasses"] == 4, result
        assert recon["mode"] == "combat", result
        assert 10 <= recon["combatants"] <= 12, result
        assert recon["vehicles"] == 1, result
        assert recon["rifle"] == 100 and recon["grenades"] == 10, result
        assert recon["transientBefore"] > 0 and recon["transientAfter"] == 0, result
        assert recon["visibleTargets"] == recon["combatants"], result
        assert recon["visibleStack"] == 2 and recon["hiddenOtherActors"], result
        assert doors == {"count": 6, "framed": True, "persistentAfterLeaf": True}, result
        assert head["finite"] and head["panicMax"] < 0.16 and head["coverMax"] < 0.24, result
        assert corpse["complete"] == 1 and 0 <= corpse["torsoClearance"] < 0.24, result
        assert sniper["facades"] == 3 and sniper["allStatic"], result
        assert all(count > 0 for count in sniper["skipCounts"]), result
        assert sniper["farArchitecturalPanes"] == 0, result
        assert sniper["postProcess"] == {"enabled": True, "temporalNoise": False}, result
        browser.close()


if __name__ == "__main__":
    main()
