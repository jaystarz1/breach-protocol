#!/usr/bin/env python3
"""Verify the sniper mission's ground-team destination and escort handoff."""
import argparse
import json
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--live", action="store_true", help="let the authored CT route run instead of teleporting the team")
    parser.add_argument("--wait", type=int, default=50000, help="milliseconds to observe the live route")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.set_default_timeout(90000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(6)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.evaluate("({live, wait}) => { window.__bpLiveEscort = live; window.__bpLiveEscortWait = wait; }", {"live": args.live, "wait": args.wait})
        result = page.evaluate("""async () => {
          const world = BP.world;
          BP.player.health = 100000;
          for (const actor of [...world.enemies, ...world.civilians]) actor.update = () => {};
          const destination = world.level.objectives[0].steps[0].destination;
          const marker = BP.scene.getObjectByName('escort-destination-marker');
          const initial = {
            objectiveIdx: world.objectiveIdx,
            marker: !!marker,
            destination,
            objective: document.querySelector('#objective')?.textContent || '',
          };
          if (!window.__bpLiveEscort) {
            for (const [index, ally] of world.allies.entries()) {
              ally.routeIdx = ally.route.length - 1;
              const off = ally.routeOff || [0, 0];
              ally.pos.set(
                index < 1 ? destination[0] + off[0] : destination[0] + 14,
                0,
                index < 1 ? destination[1] + off[1] : destination[1] + 14,
              );
              ally.update = () => {};
            }
          }
          await new Promise(resolve => setTimeout(resolve, window.__bpLiveEscort ? window.__bpLiveEscortWait : 900));
          const drone = world.drone;
          const droneDevice = world.objectiveDevices.find(device => device.id === 'l6-drone');
          return {
            initial,
            afterArrival: {
              objectiveIdx: world.objectiveIdx,
              objectiveStepIdx: world.objectiveStepIdx,
              objective: document.querySelector('#objective')?.textContent || '',
              alive: world.allies.filter(ally => !ally.dead).length,
              droneActive: !!drone?.active,
              droneMode: drone?.mode || null,
              attackers: world.droneAssault?.actors?.length || 0,
              droneDeviceUsed: !!droneDevice?.used,
              team: world.allies.map(ally => ({
                x: Number(ally.pos.x.toFixed(2)), z: Number(ally.pos.z.toFixed(2)),
                routeIdx: ally.routeIdx,
                blocked: Number(ally.blocked.toFixed(2)), forcePath: Number(ally.forcePath.toFixed(2)),
                path: ally.path?.length || 0, target: !!ally.target,
              })),
            },
          };
        }""")
        result["errors"] = errors[:10]
        page.keyboard.press("f")
        page.wait_for_function("() => !BP.world.drone", timeout=10000)
        result["handoff"] = page.evaluate("""() => ({
          objectiveIdx: BP.world.objectiveIdx,
          objectiveStepIdx: BP.world.objectiveStepIdx,
          droneActive: !!BP.world.drone,
          playerLocked: BP.player.locked,
          objective: document.querySelector('#objective')?.textContent || '',
          survivors: BP.world.enemies.filter(enemy => enemy.droneTarget && !enemy.dead).length,
        })""")
        page.evaluate("""() => {
          for (const enemy of BP.world.enemies) {
            enemy.dead = true;
            enemy.mesh.visible = false;
          }
          for (const civilian of BP.world.civilians) {
            if (civilian.wasHostage) { civilian.hostage = false; civilian.rescued = true; }
          }
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 2 && BP.world.objectiveStepIdx === 1", timeout=10000)
        page.evaluate("() => BP.player.pos.set(-35, 0, -77.5)")
        page.wait_for_function("() => BP.world.won === true", timeout=10000)
        result["completion"] = page.evaluate("""() => ({
          won: BP.world.won,
          objectiveIdx: BP.world.objectiveIdx,
          objectiveStepIdx: BP.world.objectiveStepIdx,
          relayUsed: !!BP.world.objectiveDevices.find(device => device.id === 'l6-relay')?.used,
        })""")
        failure_page = browser.new_page(viewport={"width": 1600, "height": 1000})
        failure_page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        failure_page.wait_for_function("() => !!window.BP", timeout=90000)
        failure_page.evaluate("() => BP.startLevel(6)")
        failure_page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        failure_page.evaluate("() => { for (const ally of BP.world.allies) ally.damage(999999, BP.world); }")
        failure_page.wait_for_function("() => BP.world.over === true && BP.world.won === false", timeout=10000)
        result["allDown"] = failure_page.evaluate("() => ({ won: BP.world.won, over: BP.world.over })")
        failure_page.close()
        print(json.dumps(result, indent=2))
        assert not errors, result
        assert result["initial"]["marker"], result
        assert result["initial"]["destination"] == [-35, -77.5, 5.5], result
        assert result["afterArrival"]["objectiveIdx"] == 1, result
        assert result["afterArrival"]["objectiveStepIdx"] == 1, result
        assert result["afterArrival"]["droneActive"], result
        assert result["afterArrival"]["droneMode"] == "combat", result
        assert result["afterArrival"]["attackers"] == 10, result
        assert result["afterArrival"]["droneDeviceUsed"], result
        assert result["handoff"]["objectiveIdx"] == 1, result
        assert result["handoff"]["objectiveStepIdx"] == 2, result
        assert not result["handoff"]["droneActive"], result
        assert not result["handoff"]["playerLocked"], result
        assert result["completion"]["won"], result
        assert result["completion"]["relayUsed"], result
        assert result["allDown"] == {"won": False, "over": True}, result
        browser.close()


if __name__ == "__main__":
    main()
