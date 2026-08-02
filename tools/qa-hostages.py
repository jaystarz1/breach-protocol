#!/usr/bin/env python3
"""Authored hostage pose, rescue, escort, and casualty regression."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-hostages")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(2)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.evaluate("""() => {
          for (const r of BP.world.reinfs || []) r.sent = r.max;
          for (const enemy of BP.world.enemies) {
            enemy.mesh.visible = false;
            enemy.range = 0;
            enemy.fireCooldown = 999;
          }
          const hostage = BP.world.civilians.find(c => c.hostage);
          hostage.pos.set(0, 0, 34);
          hostage.baseY = 0;
          BP.player.pos.set(0, 0, 39);
          BP.player.yaw = 0;
          BP.player.pitch = -0.12;
        }""")
        page.wait_for_timeout(350)
        page.screenshot(path=str(output / "hostage-bound.png"))

        bound = page.evaluate("""async () => {
          const { Box3 } = await import('./lib/three.module.js');
          const hostages = BP.world.civilians.filter(c => c.hostage);
          return {
            count: hostages.length,
            rigs: hostages.map(c => {
              const rig = c.mesh.userData.rig;
              const box = new Box3().setFromObject(c.mesh);
              return {
                authored: !!rig?.authored,
                hostage: !!rig?.hostage,
                source: rig?.civilianSource,
                action: rig?.currentAction?._clip?.name || '',
                restraint: !!rig?.restraint?.visible,
                seat: rig?.seat?.name === 'hostage-chair',
                height: +(box.max.y - box.min.y).toFixed(2),
              };
            }),
          };
        }""")

        rescued = page.evaluate("""() => {
          const hostage = BP.world.civilians.find(c => c.hostage);
          const before = { x: hostage.pos.x, z: hostage.pos.z };
          const ok = hostage.rescue('you');
          BP.player.pos.set(0, 0, 48);
          return { ok, before };
        }""")
        # Allow enough deterministic simulation time to prove that the released actor has
        # separated from the detached chair; the staggered escort slot adds lateral travel,
        # so this assertion deliberately measures meaningful separation rather than one old
        # single-file coordinate.
        page.wait_for_timeout(2500)
        page.screenshot(path=str(output / "hostage-escorting.png"))
        escort = page.evaluate("""() => {
          const hostage = BP.world.civilians.find(c => c.rescued);
          const rig = hostage.mesh.userData.rig;
          const scene = BP.world.staticMesh.parent;
          const chair = scene.getObjectByName('hostage-chair');
          return {
            rescued: hostage.rescued,
            bound: hostage.hostage,
            escort: hostage.escort,
            rigHostage: !!rig?.hostage,
            action: rig?.currentAction?._clip?.name || '',
            chairLeftBehind: !!chair,
            chairDetached: chair?.parent === scene,
            chairDistance: chair ? +chair.position.distanceTo(hostage.pos).toFixed(2) : 0,
            moved: +Math.hypot(
              hostage.pos.x - %s, hostage.pos.z - %s).toFixed(2),
          };
        }""" % (rescued["before"]["x"], rescued["before"]["z"]))

        casualty = page.evaluate("""() => {
          const hostage = BP.world.civilians.find(c => c.wasHostage && !c.dead);
          hostage.kill();
          hostage.update(0.1, BP.world);
          return {
            dead: hostage.dead,
            deathAnim: hostage.deathAnim,
            authored: !!hostage.mesh.userData.rig?.authored,
          };
        }""")

        result = {
            "bound": bound,
            "escort": escort,
            "casualty": casualty,
            "screenshots": ["hostage-bound.png", "hostage-escorting.png"],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))
        assert not errors
        assert bound["count"] == 1
        assert all(
            rig["authored"] and rig["hostage"] and rig["restraint"] and rig["seat"]
            and rig["source"] == 1
            and "sitting" in rig["action"].lower()
            for rig in bound["rigs"]
        )
        assert escort["rescued"] and not escort["bound"] and escort["escort"]
        assert not escort["rigHostage"] and "sitting" not in escort["action"].lower()
        assert escort["chairLeftBehind"] and escort["chairDetached"] and escort["chairDistance"] > 1.2
        assert escort["moved"] > 0.5
        assert casualty["dead"] and casualty["authored"] and casualty["deathAnim"] > 0
        browser.close()


if __name__ == "__main__":
    main()
