#!/usr/bin/env python3
"""Smoke-test every campaign drone sortie and its transition back to ground combat."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def finish_drone(page, expected_index, expected_step=0, mode="recon", capture=None):
    page.wait_for_function(
        f"() => BP.world.objectiveIdx === {expected_index}"
        f" && BP.world.objectiveStepIdx === {expected_step} && !!BP.world.drone",
        timeout=10000,
    )
    before = page.evaluate("""() => ({
      label: document.querySelector('.drone-label')?.textContent,
      targets: BP.world.drone.targets.length,
      mode: BP.world.drone.mode,
      models: BP.world.drone.targetModels.filter(Boolean).length,
      combatants: BP.world.drone.combatants.length,
      vehicles: BP.world.drone.combatVehicles.length,
      rifle: BP.world.drone.rifleRounds,
      grenades: BP.world.drone.grenadeRounds,
      locked: BP.player.locked,
    })""")
    if mode == "combat":
        page.evaluate("""() => {
          const drone = BP.world.drone;
          for (const actor of drone.combatants) {
            drone.onCombatHit(actor, 99999, false);
          }
          for (const vehicle of drone.combatVehicles) {
            drone.onCombatVehicleHit(vehicle, 99999);
          }
        }""")
        if capture:
            page.screenshot(path=str(capture))
    elif mode == "strike":
        strike_state = page.evaluate("""() => {
          window.__qaStrikeModels = BP.world.drone.targetModels;
          window.__qaStrikeTargets = BP.world.drone.targets;
          for (const target of BP.world.drone.targets) BP.world.drone.releaseMunition(target);
          // Headless Chromium throttles background requestAnimationFrame and the game clamps
          // each delayed frame to 50 ms. Advance the projectile-only subsystem by its real
          // maximum 1.2-second flight time so this remains a mechanics test rather than a
          // timer test (the high inspection camera is 45m from the two flank targets).
          BP.world.drone.updateMunitions(1.2, BP.world.solids);
          BP.world.drone.updateEffects(0.16);
          // Freeze just the controller update for the impact capture. Setting `active=false`
          // would return the main loop to infantry camera control, while letting the normal
          // update run would age the blast and complete the objective before the screenshot.
          window.__qaDroneUpdate = BP.world.drone.update;
          BP.world.drone.update = () => {};
          BP.world.drone.status.textContent = 'LINK 100%\\nBAT 100%\\nTARGETS 3/3\\nSTRIKE COMPLETE';
          BP.world.drone.lock.textContent = '';
          return {
            targets: BP.world.drone.targets.map(target => ({
              marked: target.marked,
              engaged: target.engaged,
            })),
            munitions: BP.world.drone.munitions.length,
            effects: BP.world.drone.effects.length,
          };
        }""")
        assert all(target["marked"] for target in strike_state["targets"]), strike_state
        assert strike_state["munitions"] == 0, strike_state
        assert strike_state["effects"] == 3, strike_state
        if capture:
            page.screenshot(path=str(capture))
        page.evaluate("""() => {
          if (BP.world.drone && window.__qaDroneUpdate) {
            BP.world.drone.update = window.__qaDroneUpdate;
          }
        }""")
    else:
        page.evaluate("() => BP.world.drone.targets.forEach(target => target.marked = true)")
    if mode == "combat":
        page.wait_for_function("() => !BP.world.drone", timeout=90000)
        if capture:
            page.screenshot(path=str(capture).replace(".png", "-ground.png"))
            for suffix, position, yaw, pitch in [
                ("-roof-stair", [6.9, 12.35, -1.5], 3.141592653589793, -0.95),
                ("-floor3-stair", [6.9, 9.35, -6.5], 3.141592653589793, -0.95),
            ]:
                page.evaluate("""view => {
                  BP.player.pos.set(...view.position);
                  BP.player.yaw = view.yaw;
                  BP.player.pitch = view.pitch;
                }""", {"position": position, "yaw": yaw, "pitch": pitch})
                page.wait_for_timeout(120)
                page.screenshot(path=str(capture).replace(".png", suffix + ".png"))
    else:
        page.wait_for_timeout(1200)
    after = page.evaluate("""() => ({
      restored: !BP.player.locked,
      overlayRemoved: !document.querySelector('.drone-frame'),
      canvasFilter: document.getElementById('game-canvas').style.filter,
      mode: BP.mode,
      objectiveIdx: BP.world.objectiveIdx,
      complete: BP.world.drone?.complete ?? null,
      active: BP.world.drone?.active ?? null,
      wrecksPersist: window.__qaStrikeModels
        ? window.__qaStrikeModels.every(model => model.userData.destroyed && !!model.parent)
        : null,
    })""")
    return {"before": before, "after": after}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-drone-campaign")
    parser.add_argument("--strike-only", action="store_true")
    args = parser.parse_args()
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        results = {}

        if not args.strike_only:
            page.evaluate("() => BP.startLevel(2)")
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.evaluate("""() => {
              for (const r of BP.world.reinfs || []) r.sent = r.max;
              BP.world.enemies.forEach(enemy => { enemy.dead = true; enemy.mesh.visible = false; });
            }""")
            page.wait_for_function(
                "() => BP.world.objectiveIdx === 1 && BP.world.objectiveStepIdx === 0",
            )
            page.evaluate("""() => {
              const hold = setInterval(() => {
                BP.player.pos.set(-11.2, .1, -41.6);
                BP.input.breachPressed = true;
              }, 16);
              setTimeout(() => clearInterval(hold), 700);
            }""")
            results["level2"] = finish_drone(page, 1, expected_step=1, mode="combat")

            page.evaluate("() => BP.startLevel(3)")
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.evaluate("""() => {
              for (const r of BP.world.reinfs || []) r.sent = r.max;
              BP.world.enemies.forEach(enemy => { enemy.dead = true; enemy.mesh.visible = false; });
            }""")
            page.wait_for_function(
                "() => BP.world.objectiveIdx === 1 && BP.world.objectiveStepIdx === 0",
            )
            page.evaluate("() => BP.world.civilians.forEach(civilian => civilian.rescued = true)")
            page.wait_for_function("() => BP.world.objectiveIdx === 2")
            page.evaluate("""() => {
              const hold = setInterval(() => BP.player.pos.set(-2, 9.1, -6), 16);
              setTimeout(() => clearInterval(hold), 700);
            }""")
            page.wait_for_function(
                "() => BP.world.objectiveIdx === 2 && BP.world.objectiveStepIdx === 1",
            )
            page.evaluate("""() => {
              const hold = setInterval(() => {
                BP.player.pos.set(-2, 9.45, -6);
                BP.input.breachPressed = true;
              }, 16);
              setTimeout(() => clearInterval(hold), 700);
            }""")
            results["level3"] = finish_drone(page, 2, expected_step=2, mode="combat")

        page.evaluate("() => BP.startLevel(7)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(500)
        page.evaluate("""() => {
          const drone = BP.world.drone;
          drone.pos.set(0, 30, -5);
          drone.vel.set(0, 0, 0);
          drone.yaw = Math.PI;
          drone.pitch = -0.78;
          drone.camera.position.copy(drone.pos);
          drone.camera.rotation.order = 'YXZ';
          drone.camera.rotation.set(drone.pitch, drone.yaw, 0);
        }""")
        page.wait_for_timeout(150)
        page.screenshot(path=str(output_dir / "op-bravo-targets.png"))
        results["level7"] = finish_drone(
            page,
            0,
            expected_step=0,
            mode="combat",
            capture=output_dir / "op-bravo-impact.png",
        )

        output = {"missions": results, "errors": errors[:8]}
        print(json.dumps(output, indent=2))
        expected = {"level7": (1, "playing")}
        if not args.strike_only:
            expected.update({
                "level2": (2, "playing"),
                "level3": (3, "debrief"),
            })
        for name, (objective_index, mode) in expected.items():
            after = results[name]["after"]
            assert after["objectiveIdx"] == objective_index
            assert after["mode"] == mode
            assert after["restored"] and after["overlayRemoved"]
            assert after["canvasFilter"] == ""
        if not args.strike_only:
            assert results["level2"]["before"]["mode"] == "combat"
            assert 10 <= results["level2"]["before"]["combatants"] <= 12
            assert results["level2"]["before"]["vehicles"] == 1
            assert results["level2"]["before"]["rifle"] == 100
            assert results["level2"]["before"]["grenades"] == 10
            assert results["level3"]["before"]["mode"] == "combat"
            assert results["level3"]["before"]["combatants"] == 10
            assert results["level3"]["before"]["vehicles"] == 0
            assert results["level3"]["before"]["rifle"] == 100
            assert results["level3"]["before"]["grenades"] == 8
        assert results["level7"]["before"]["mode"] == "combat"
        assert 10 <= results["level7"]["before"]["combatants"] <= 12
        assert results["level7"]["before"]["vehicles"] == 1
        assert results["level7"]["before"]["targets"] == 0
        assert results["level7"]["before"]["models"] == 0
        assert results["level7"]["before"]["rifle"] == 100
        assert results["level7"]["before"]["grenades"] == 10
        assert not errors
        browser.close()


if __name__ == "__main__":
    main()
