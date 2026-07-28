#!/usr/bin/env python3
"""Capture all desktop weapon states and verify the sniper centre ray."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-weapons")
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

        captures = []
        rigs = {}
        for level, name in ((1, "pistol"), (4, "m4"), (6, "barrett")):
            page.evaluate("() => { BP.input.ads = false; BP.input.breath = false; }")
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.evaluate("() => { BP.input.ads = false; BP.input.breath = false; }")
            page.wait_for_timeout(180)
            rigs[name] = page.evaluate("""() => {
              const mesh = BP.weapons.meshes[BP.weapons.current];
              const gloves = [];
              const sleeves = [];
              mesh.traverse(node => {
                if (node.userData.authoredViewmodelGlove) gloves.push({
                  name: node.name,
                  vertices: node.geometry.attributes.position.count,
                  support: node.userData.support,
                });
                if (node.userData.authoredViewmodelSleeve) sleeves.push(node.name);
              });
              return { gloves, sleeves };
            }""")
            page.screenshot(path=str(output / f"{name}-hip.png"))
            captures.append(f"{name}-hip.png")
            page.evaluate("() => { BP.input.ads = true; BP.input.breath = true; }")
            page.wait_for_timeout(260)
            page.screenshot(path=str(output / f"{name}-ads.png"))
            captures.append(f"{name}-ads.png")
            page.evaluate("() => { BP.input.ads = false; BP.input.breath = false; }")

        page.evaluate("""() => {
          BP.startLevel(4);
          BP.weapons.select('m4');
          BP.weapons.state.m4.mag = 12;
          BP.weapons.reload();
        }""")
        page.wait_for_function(
            """() => BP.mode === 'playing'
              && BP.weapons.reloading > 0
              && Math.abs(BP.weapons.holder.rotation.z) > 0.1
              && BP.weapons.holder.position.y < -0.25""",
            timeout=6000,
        )
        reload_state = page.evaluate("""() => ({
          active: BP.weapons.reloading > 0,
          holderCant: BP.weapons.holder.rotation.z,
          holderDrop: BP.weapons.holder.position.y,
        })""")
        page.screenshot(path=str(output / "m4-reload.png"))
        captures.append("m4-reload.png")

        def sniper_shot(offset):
            page.evaluate("() => BP.startLevel(6)")
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            return page.evaluate(
                """(offset) => {
                  const target = BP.world.enemies.find(enemy => !enemy.dead && enemy.exposed !== false);
                  const before = target.health;
                  BP.weapons.camera.lookAt(
                    target.pos.x + offset,
                    target.pos.y + 1.64,
                    target.pos.z
                  );
                  window.QA_SHOT = {};
                  BP.weapons.onFire(0);
                  return {
                    offset,
                    before,
                    after: target.health,
                    dead: target.dead,
                    trace: window.QA_SHOT,
                  };
                }""",
                offset,
            )

        centre = sniper_shot(0)
        near_miss = sniper_shot(0.42)
        result = {
            "captures": captures,
            "rigs": rigs,
            "reload": reload_state,
            "centre": centre,
            "nearMiss": near_miss,
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))
        assert not errors
        for rig in rigs.values():
            assert len(rig["gloves"]) == 2
            assert len(rig["sleeves"]) == 2
            assert all(glove["vertices"] > 600 for glove in rig["gloves"])
            assert {glove["support"] for glove in rig["gloves"]} == {True, False}
        assert reload_state["active"]
        assert abs(reload_state["holderCant"]) > 0.1
        assert reload_state["holderDrop"] < -0.25
        assert centre["dead"] and centre["trace"]["hitEnemy"]
        assert not near_miss["dead"] and near_miss["trace"]["hitEnemy"] is None
        browser.close()


if __name__ == "__main__":
    main()
