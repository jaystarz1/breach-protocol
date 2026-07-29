#!/usr/bin/env python3
"""Verify bounded hearing, suppression, flanking, and retreat behavior."""
import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    args = parser.parse_args()

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
        page.evaluate("() => BP.startLevel(2)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)

        result = page.evaluate("""async () => {
          const THREE = await import('./lib/three.module.js');
          const { resetPathBudget } = await import('./src/enemies.js');
          const actors = BP.world.enemies;
          for (const actor of [...actors, ...BP.world.allies, ...BP.world.civilians]) {
            actor.update = () => {};
          }

          const concealed = actors.find(actor => actor.concealed);
          concealed.state = 'patrol';
          concealed.path = null;
          const nearShot = {
            x: concealed.pos.x, y: concealed.pos.y + 1.25, z: concealed.pos.z + 10,
          };
          const heard = concealed.hearGunshot(nearShot, BP.world, 120);
          const hearing = {
            heard,
            state: concealed.state,
            stillConcealed: concealed.concealed,
            lastKnown: concealed.lastKnown
              ? [concealed.lastKnown.x, concealed.lastKnown.z] : null,
          };
          const distant = actors.reduce((best, actor) =>
            actor.pos.distanceTo(BP.player.pos) > best.pos.distanceTo(BP.player.pos)
              ? actor : best);
          distant.state = 'patrol';
          distant.lastKnown = null;
          const distantHeard = distant.hearGunshot(
            { x: BP.player.pos.x, y: BP.player.pos.y + 1.25, z: BP.player.pos.z },
            BP.world, 140);
          hearing.distant = {
            heard: distantHeard,
            state: distant.state,
            holdsPosition: !distant.lastKnown,
          };

          const suppressed = actors.find(actor => !actor.concealed && !actor.perches);
          suppressed.state = 'patrol';
          suppressed.suppression = 0;
          suppressed.maneuverCooldown = 10;
          const from = new THREE.Vector3(
            suppressed.pos.x + 1.0, suppressed.pos.y + 1.15, suppressed.pos.z + 10);
          const to = new THREE.Vector3(
            suppressed.pos.x + 1.0, suppressed.pos.y + 1.15, suppressed.pos.z - 10);
          BP.world.registerFriendlyFire(from, to, null, 80);
          const suppression = {
            amount: +suppressed.suppression.toFixed(3),
            state: suppressed.state,
            lastKnown: !!suppressed.lastKnown,
          };

          const candidate = actors.find(actor =>
            !actor.concealed && !actor.perches && actor !== suppressed);
          candidate.suppressionSource = {
            x: BP.player.pos.x, y: BP.player.pos.y, z: BP.player.pos.z,
          };
          candidate.lastKnown = { ...candidate.suppressionSource };
          candidate.state = 'alert';
          candidate.path = null;
          candidate.maneuverCooldown = 0;
          candidate.tacticalRole = 'flanker';
          resetPathBudget();
          const flankGoal = candidate.findTacticalPosition(BP.world, 'flank');
          const flankPlanned = candidate.planTacticalMove(BP.world, 'flank');
          const flank = {
            goal: flankGoal
              ? [flankGoal.x, flankGoal.y, flankGoal.z].map(value => +value.toFixed(2))
              : null,
            planned: flankPlanned,
            state: candidate.state,
            pathNodes: candidate.path?.length || 0,
          };

          const retreat = actors.find(actor =>
            !actor.concealed && !actor.perches && actor !== suppressed && actor !== candidate);
          retreat.suppressionSource = {
            x: BP.player.pos.x, y: BP.player.pos.y, z: BP.player.pos.z,
          };
          retreat.lastKnown = { ...retreat.suppressionSource };
          retreat.health = retreat.maxHealth * 0.3;
          retreat.state = 'alert';
          retreat.path = null;
          retreat.maneuverCooldown = 0;
          resetPathBudget();
          const retreatGoal = retreat.findTacticalPosition(BP.world, 'retreat');
          const retreatPlanned = retreat.planTacticalMove(BP.world, 'retreat');
          const currentThreatDistance = Math.hypot(
            retreat.pos.x - BP.player.pos.x, retreat.pos.z - BP.player.pos.z);
          const retreatDistance = retreatGoal
            ? Math.hypot(
              retreatGoal.x - BP.player.pos.x, retreatGoal.z - BP.player.pos.z)
            : 0;
          return {
            hearing,
            suppression,
            flank,
            retreat: {
              goal: retreatGoal
                ? [retreatGoal.x, retreatGoal.y, retreatGoal.z]
                  .map(value => +value.toFixed(2))
                : null,
              planned: retreatPlanned,
              state: retreat.state,
              pathNodes: retreat.path?.length || 0,
              gainedDistance: +(retreatDistance - currentThreatDistance).toFixed(2),
            },
            tacticalRoles: actors.reduce((roles, actor) => {
              roles[actor.tacticalRole] = (roles[actor.tacticalRole] || 0) + 1;
              return roles;
            }, {}),
          };
        }""")

        output = {"tacticalAI": result, "errors": errors[:10]}
        print(json.dumps(output, indent=2))
        assert not errors, output
        assert result["hearing"]["heard"] and result["hearing"]["state"] == "hunt", output
        assert result["hearing"]["stillConcealed"], output
        assert result["hearing"]["distant"] == {
            "heard": True, "state": "alert", "holdsPosition": True,
        }, output
        assert result["suppression"]["amount"] > 0.3, output
        assert result["suppression"]["state"] == "hunt" and result["suppression"]["lastKnown"], output
        assert result["flank"]["goal"] and result["flank"]["planned"], output
        assert result["flank"]["state"] == "flank" and result["flank"]["pathNodes"] > 0, output
        assert result["retreat"]["goal"] and result["retreat"]["planned"], output
        assert result["retreat"]["state"] == "retreat", output
        assert result["retreat"]["pathNodes"] > 0 and result["retreat"]["gainedDistance"] >= 2, output
        assert result["tacticalRoles"].get("flanker", 0) > 0, output
        assert result["tacticalRoles"].get("rifleman", 0) > 0, output
        browser.close()


if __name__ == "__main__":
    main()
