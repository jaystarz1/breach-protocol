#!/usr/bin/env python3
"""Verify marketplace shoot/no-shoot contacts and the delayed surrender transition."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-marketplace")
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
        page.evaluate("() => BP.startLevel(5)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(250)

        result = page.evaluate("""async () => {
          const world = BP.world;
          const first = world.level.objectives[0]?.steps?.[0];
          const infiltrators = world.enemies.filter(enemy => enemy.identifyTarget);
          const civilians = world.civilians.filter(civilian => civilian.identifyTarget);
          if (infiltrators.length !== 4) throw new Error('Expected four authored market shooters');
          const objectives = world.level.objectives;
          const manifest = world.objectiveDevices.find(device => device.id === 'l5-manifest');
          const gate = world.objectiveDevices.find(device => device.id === 'l5-gate');
          const gateVisual = BP.scene.getObjectByName('market-south-gate-visual');
          const exfilPad = BP.scene.getObjectByName('market-exfil-pad');
          if (objectives.length !== 3) throw new Error('Marketplace should have three authored objectives');
          if (first?.type !== 'clear') throw new Error('Marketplace first objective should clear armed contact');
          if (!manifest || !gate || !gate.blockerSolid) throw new Error('Marketplace gate/manifest wiring missing');
          if (!gateVisual || !exfilPad) throw new Error('Marketplace gate/exfil art missing');

          // Freeze the rest of the encounter while a single disguised contact demonstrates its
          // audible/visible reveal. It is still updated, so the test exercises Enemy behavior.
          const contact = infiltrators[0];
          const liveEnemyUpdate = contact.update;
          for (const actor of [...world.enemies, ...world.allies, ...world.civilians]) {
            if (actor !== contact) actor.update = () => {};
          }
          BP.player.locked = true;
          BP.player.health = 100000;
          BP.weapons.holder.visible = false;
          contact.mesh.position.set(BP.player.pos.x, BP.player.pos.y, BP.player.pos.z - 8);
          contact.yaw = 0;
          const concealedBefore = contact.concealed;
          contact.hearGunshot({
            x: BP.player.pos.x, y: BP.player.pos.y + 1.6, z: BP.player.pos.z,
          }, world, 55);
          const revealedByContact = !contact.concealed && !!contact.mesh.userData.rig?.rifle;
          const shotsBeforeReturn = contact.shotsHere;
          contact.standoff = 99;
          for (let tick = 0; tick < 30; tick++) contact.update(0.1, world);
          const returnedFire = contact.shotsHere > shotsBeforeReturn;

          // With the clear-contact phase active, firing at the revealed shooter is a normal hit;
          // there is no identify-objective interception in onPlayerShot.
          BP.weapons.select('m4');
          BP.weapons.state.m4.mag = 30;
          BP.weapons.camera.lookAt(contact.pos.x, contact.pos.y + 1.05, contact.pos.z);
          const healthBeforeShot = contact.health;
          window.QA_SHOT = {};
          BP.weapons.onFire(0);
          const acceptedShot = contact.health < healthBeforeShot || contact.dead;

          const ordinary = world.enemies.find(enemy =>
            !enemy.identifyTarget && !enemy.concealed && !enemy.hvt && !enemy.bastion
            && !enemy.flee && !enemy.perches && enemy !== contact);
          if (!ordinary) throw new Error('Need ordinary hostile for surrender transition');
          for (const enemy of world.enemies) {
            if (enemy !== ordinary && enemy !== contact) enemy.mesh.position.x += 100;
          }
          ordinary.mesh.position.set(BP.player.pos.x + 100, BP.player.pos.y, BP.player.pos.z);
          ordinary.surrenderEligible = true;
          ordinary.health = ordinary.maxHealth * 0.2;
          ordinary.suppression = 1;
          const pendingStarted = ordinary.trySurrender(world, 'suppressed');
          const pendingState = {
            pending: ordinary.surrenderPending,
            surrendered: ordinary.surrendered,
            weaponStillCarried: !!ordinary.mesh.userData.rig?.rifle,
          };
          const detaineeKillsBefore = world.stats.detaineeKills;
          ordinary.damage(99999, world, true, false);
          const preCommitShot = {
            dead: ordinary.dead,
            surrendered: ordinary.surrendered,
            executed: ordinary.executed,
            detaineeKillsUnchanged: world.stats.detaineeKills === detaineeKillsBefore,
          };

          const final = world.enemies.find(enemy =>
            enemy !== ordinary && enemy !== contact && !enemy.dead && !enemy.identifyTarget
            && !enemy.concealed && !enemy.hvt && !enemy.bastion && !enemy.flee && !enemy.perches);
          if (!final) throw new Error('Need second ordinary hostile for surrender commit');
          final.mesh.position.set(BP.player.pos.x + 100, BP.player.pos.y, BP.player.pos.z + 2);
          final.surrenderEligible = true;
          final.health = final.maxHealth * 0.2;
          final.suppression = 1;
          const commitStarted = final.trySurrender(world, 'suppressed');
          final.update = liveEnemyUpdate;
          final.update(1.05, world);
          const committed = {
            pending: final.surrenderPending,
            surrendered: final.surrendered,
            weaponDropped: final.mesh.userData.rig?.droppedWeapon?.name || '',
            timer: final.surrenderTimer,
            state: final.state,
            dead: final.dead,
            mounted: final.mounted,
            hasPerches: !!final.perches,
          };
          // The completed face-down state is still a detainee: an aimed shot now uses its
          // ground-level hit volume and carries the existing execution penalty.
          contact.mesh.position.x += 100;
          final.mesh.position.set(BP.player.pos.x, BP.player.pos.y, BP.player.pos.z - 8);
          BP.weapons.camera.lookAt(final.pos.x, final.pos.y + 0.38, final.pos.z);
          const detaineeKillsBeforeShot = world.stats.detaineeKills;
          BP.weapons.onFire(0);
          const proneExecution = {
            dead: final.dead,
            executed: final.executed,
            detaineeKillCounted: world.stats.detaineeKills === detaineeKillsBeforeShot + 1,
          };
          return {
            objective: {
              count: objectives.length, type: first?.type, text: first?.text || '',
              secondType: objectives[1]?.steps?.[0]?.type,
              thirdTypes: objectives[2]?.steps?.map(step => step.type) || [],
            },
            infiltrators: infiltrators.length,
            unarmedCivilians: civilians.length === 0,
            concealedBefore,
            revealedByContact,
            returnedFire,
            acceptedShot,
            pendingStarted,
            pendingState,
            preCommitShot,
            commitStarted,
            committed,
            proneExecution,
          };
        }""")
        page.screenshot(path=str(output / "marketplace-contact.png"), timeout=90000)
        result["errors"] = errors[:10]
        result["screenshot"] = str(output / "marketplace-contact.png")
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert result["objective"]["count"] == 3, result
        assert result["objective"]["type"] == "clear", result
        assert result["objective"]["secondType"] == "interact", result
        assert result["objective"]["thirdTypes"] == ["interact", "reach"], result
        assert "IDENTIFY" not in result["objective"]["text"].upper(), result
        assert result["infiltrators"] == 4, result
        assert result["unarmedCivilians"], result
        assert result["revealedByContact"], result
        assert result["returnedFire"], result
        assert result["acceptedShot"], result
        assert result["pendingStarted"] and result["pendingState"] == {
            "pending": True, "surrendered": False, "weaponStillCarried": True,
        }, result
        assert result["preCommitShot"] == {
            "dead": True, "surrendered": False, "executed": False,
            "detaineeKillsUnchanged": True,
        }, result
        assert result["commitStarted"] and result["committed"]["surrendered"], result
        assert not result["committed"]["pending"], result
        assert result["committed"]["weaponDropped"] == "dropped-hostile-rifle", result
        assert result["proneExecution"] == {
            "dead": True, "executed": True, "detaineeKillCounted": True,
        }, result
        browser.close()


if __name__ == "__main__":
    main()
