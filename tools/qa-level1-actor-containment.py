#!/usr/bin/env python3
"""Verify Level 1 hostages stay anatomically stable and room-two actors stay contained."""
import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
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

        rows = []
        for _ in range(3):
            page.evaluate("() => BP.startLevel(1)")
            page.wait_for_function(
                "() => BP.mode === 'playing' && BP.world.level.id === 1",
                timeout=90000,
            )
            before = page.evaluate("""() => ({
              variant: BP.world.missionVariant,
              hostages: BP.world.civilians.map(actor => {
                const stable = actor.mesh.userData.rig.hostageStability;
                return {
                  source: actor.mesh.userData.rig.civilianSource,
                  headHold: stable?.headHold?.toArray() || null,
                  neckHold: stable?.neckHold?.toArray() || null,
                };
              }),
            })""")
            page.evaluate("""() => {
              BP.player.locked = true;
              BP.player.health = 100000;
              BP.player.pos.set(0, 0, 1.25);
              BP.world.combatHeat = 8;
              const roomTwo = BP.world.enemies.filter(actor => actor.tag === 'r2');
              for (const enemy of BP.world.enemies) {
                if (!roomTwo.includes(enemy)) {
                  enemy.update = () => {};
                  continue;
                }
                enemy.hold = false;
                enemy.state = 'hunt';
                enemy.reactTimer = 0;
                enemy.lastKnown = { x: 0, y: 0, z: 1.25 };
                enemy.path = null;
                enemy.repathTimer = 0;
              }
            }""")
            page.wait_for_timeout(3200)
            after = page.evaluate("""async () => {
              const THREE = await import('three');
              const roomTwo = BP.world.enemies.filter(actor => actor.tag === 'r2');
              const door = BP.world.doors.doors[1];
              const horizontalDistance = (position, solid) => {
                const x = Math.max(solid.min.x, Math.min(position.x, solid.max.x));
                const z = Math.max(solid.min.z, Math.min(position.z, solid.max.z));
                return Math.hypot(position.x - x, position.z - z);
              };
              const roomRows = roomTwo.map(actor => {
                const touching = BP.world.solids.filter(solid => {
                  if (solid.max.y <= actor.pos.y + 0.55
                      || solid.min.y >= actor.pos.y + 1.65) return false;
                  return horizontalDistance(actor.pos, solid) < 0.43;
                });
                const rifleBox = new THREE.Box3().setFromObject(
                  actor.mesh.userData.rig.rifle);
                const doorBox = new THREE.Box3().setFromObject(door.mesh);
                return {
                  position: actor.pos.toArray().map(value => +value.toFixed(3)),
                  wallViolations: touching.length,
                  doorClearance: +horizontalDistance(actor.pos, door.solid).toFixed(3),
                  rifleIntersectsDoor: rifleBox.intersectsBox(doorBox),
                };
              });
              const hostages = BP.world.civilians.map(actor => {
                const stable = actor.mesh.userData.rig.hostageStability;
                return {
                  headError: stable?.head
                    ? stable.head.quaternion.angleTo(stable.headHold) : Infinity,
                  neckError: stable?.neck
                    ? stable.neck.quaternion.angleTo(stable.neckHold) : Infinity,
                  finite: [
                    ...(stable?.head?.quaternion.toArray() || []),
                    ...(stable?.neck?.quaternion.toArray() || []),
                  ].every(Number.isFinite),
                };
              });
              return { roomRows, hostages };
            }""")
            rows.append({"before": before, "after": after})

        result = {"variants": rows, "errors": errors[:8]}
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert [row["before"]["variant"] for row in rows] == [0, 1, 2]
        for row in rows:
            assert len(row["before"]["hostages"]) == 3
            assert all(hostage["headHold"] and hostage["neckHold"]
                       for hostage in row["before"]["hostages"])
            assert all(hostage["finite"] for hostage in row["after"]["hostages"])
            # A cowering hostage may deliberately tuck the chin by ~0.16 rad. The corrupt
            # source behavior was an unbounded full rotation through the torso.
            assert max(hostage["headError"]
                       for hostage in row["after"]["hostages"]) < 0.25
            assert max(hostage["neckError"]
                       for hostage in row["after"]["hostages"]) < 0.25
            assert all(actor["wallViolations"] == 0
                       for actor in row["after"]["roomRows"])
            assert all(actor["doorClearance"] >= 0.74
                       for actor in row["after"]["roomRows"])
            assert all(not actor["rifleIntersectsDoor"]
                       for actor in row["after"]["roomRows"])
        browser.close()


if __name__ == "__main__":
    main()
