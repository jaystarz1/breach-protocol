#!/usr/bin/env python3
"""Verify intent-driven combatant animation, desynchronization, and articulated deaths."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-character-motion")
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

        def start():
            page.evaluate("() => BP.startLevel(2)")
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.wait_for_timeout(200)

        start()
        intents = page.evaluate("""async () => {
          const { animateRig } = await import('./src/levelgen.js');
          const actors = BP.world.enemies.filter(actor => !actor.concealed).slice(0, 4);
          const labels = ['patrol', 'engage', 'firing', 'flee'];
          for (const actor of [...BP.world.enemies, ...BP.world.allies, ...BP.world.civilians]) {
            actor.mesh.visible = actors.includes(actor);
            actor.update = () => {};
          }
          BP.player.locked = true;
          BP.player.health = 100000;
          BP.weapons.holder.visible = false;
          const base = BP.player.pos;
          return actors.map((actor, index) => {
            actor.mesh.position.set(base.x + (index - 1.5) * 2.1, base.y, base.z - 5.2);
            actor.mesh.rotation.set(0, 0, 0);
            const rig = actor.mesh.userData.rig;
            animateRig(actor.mesh, index * 3.7, index === 3, 0, false, labels[index]);
            rig.mixer.update(0.24);
            rig.applyWeaponPose?.();
            let arcadeRedMeshes = 0;
            const arcadeRedDetails = [];
            actor.mesh.traverse(object => {
              if (!object.isMesh) return;
              const materials = Array.isArray(object.material)
                ? object.material : [object.material];
              const colors = materials.map(material => material?.color?.getHex());
              if (colors.some(color => color === 0x922a25 || color === 0x8f2622)) {
                arcadeRedMeshes++;
                arcadeRedDetails.push({
                  name: object.name,
                  colors: colors.map(color => color?.toString(16)),
                  position: object.position.toArray().map(value => +value.toFixed(3)),
                });
              }
            });
            return {
              intent: rig.intent,
              action: rig.currentAction?.getClip().name || '',
              actionTime: +rig.currentAction?.time.toFixed(4),
              timeScale: +rig.mixer.timeScale.toFixed(3),
              variant: rig.variant,
              scale: actor.mesh.scale.toArray().map(value => +value.toFixed(4)),
              arcadeRedMeshes,
              arcadeRedDetails,
            };
          });
        }""")
        page.wait_for_timeout(100)
        page.screenshot(path=str(output / "intent-lineup.png"), timeout=90000)

        start()
        deaths = page.evaluate("""async () => {
          const { animateDeathRig, deathPose } = await import('./src/levelgen.js');
          const actors = BP.world.enemies.filter(actor => !actor.concealed).slice(0, 3);
          for (const actor of [...BP.world.enemies, ...BP.world.allies, ...BP.world.civilians]) {
            actor.mesh.visible = actors.includes(actor);
            actor.update = () => {};
          }
          BP.player.locked = true;
          BP.player.health = 100000;
          BP.weapons.holder.visible = false;
          const base = BP.player.pos;
          return actors.map((actor, index) => {
            actor.mesh.position.set(base.x + (index - 1) * 3.0, base.y, base.z - 5.7);
            actor.mesh.rotation.set(0, 0, 0);
            // Force all three collapse families while preserving the production pose code.
            actor.mesh.userData.rig.variant = index;
            deathPose(actor.mesh);
            for (let frame = 0; frame < 20; frame++) animateDeathRig(actor.mesh, 0.04);
            const rig = actor.mesh.userData.rig;
            const bone = name => {
              let result = rig.visual.getObjectByName(name);
              if (!result) {
                const expected = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
                rig.visual.traverse(object => {
                  const actual = (object.name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                  if (!result && (actual === expected || actual.endsWith(expected))) result = object;
                });
              }
              return result;
            };
            return {
              variant: index,
              rotation: [
                actor.mesh.rotation.x,
                actor.mesh.rotation.z,
              ].map(value => +value.toFixed(3)),
              complete: +actor.mesh.userData.deathMotion.t.toFixed(3),
              leftArm: bone('UpperArm.L')?.rotation.toArray()
                .slice(0, 3).map(value => +value.toFixed(3)),
              rightLeg: bone('LowerLeg.R')?.rotation.toArray()
                .slice(0, 3).map(value => +value.toFixed(3)),
              rifle: {
                position: rig.rifle.position.toArray().map(value => +value.toFixed(3)),
                rotation: rig.rifle.rotation.toArray()
                  .slice(0, 3).map(value => +value.toFixed(3)),
              },
            };
          });
        }""")
        page.wait_for_timeout(100)
        page.screenshot(path=str(output / "death-lineup.png"), timeout=90000)

        result = {
            "intents": intents,
            "deaths": deaths,
            "screenshots": ["intent-lineup.png", "death-lineup.png"],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert [row["intent"] for row in intents] == [
            "patrol", "engage", "firing", "flee"
        ], result
        assert "pointing" in intents[1]["action"].lower(), result
        assert "shoot" in intents[2]["action"].lower(), result
        assert "run" in intents[3]["action"].lower(), result
        assert len({row["actionTime"] for row in intents}) == len(intents), result
        assert len({tuple(row["scale"]) for row in intents}) >= 3, result
        assert all(row["arcadeRedMeshes"] == 0 for row in intents), result
        assert all(row["complete"] == 1 for row in deaths), result
        assert len({tuple(row["rotation"]) for row in deaths}) == 3, result
        assert all(max(abs(value) for value in row["rotation"]) > 1.2 for row in deaths), result
        assert all(row["leftArm"] and row["rightLeg"] for row in deaths), result
        browser.close()


if __name__ == "__main__":
    main()
