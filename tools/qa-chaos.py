#!/usr/bin/env python3
"""Verify deterministic crowd chaos, concealed reveals, and protected escorts."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-chaos")
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

        def market_signature():
            return page.evaluate(
                """() => ({
                  variant: BP.world.missionVariant,
                  civilians: BP.world.civilians.map(c => ({
                    rush: c.rush,
                    crossLane: c.crossLane,
                    reactionDelay: Number(c.reactionDelay.toFixed(5)),
                    escortSide: c.escortSide,
                  })),
                  concealed: BP.world.enemies.filter(e => e.concealed).length,
                })"""
            )

        page.evaluate("() => BP.startLevel(5)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        signatures = [market_signature()]
        for _ in range(3):
            page.evaluate("() => BP.startLevel(5)")
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.wait_for_timeout(80)
            signatures.append(market_signature())

        page.screenshot(path=str(output / "market-covert.png"))
        reaction = page.evaluate(
            """() => {
              const before = BP.world.civilians.map(c => ({ x: c.pos.x, z: c.pos.z }));
              BP.world.combatHeat = 5;
              // Advance a fixed simulation second. Headless WebKit/Chromium may throttle
              // background requestAnimationFrame, which would make a wall-clock wait flaky.
              for (let frame = 0; frame < 22; frame++) {
                for (const civilian of BP.world.civilians) civilian.update(0.05, BP.world);
              }
              return {
                total: BP.world.civilians.length,
                rushers: BP.world.civilians.filter(c => c.rush).length,
                crossers: BP.world.civilians.filter(c => c.crossLane).length,
                panicked: BP.world.civilians.filter(c => c.panic).length,
                moved: BP.world.civilians.filter((c, i) =>
                    Math.hypot(
                      c.pos.x - before[i].x,
                      c.pos.z - before[i].z
                    ) > 0.3
                  ).length,
              };
            }"""
        )
        rig_coverage = page.evaluate(
            """() => BP.world.civilians.reduce((coverage, civilian) => {
              const rig = civilian.mesh.userData.rig;
              const key = String(rig?.civilianSource);
              coverage[key] ||= {
                authored: !!rig?.authored,
                hasIdle: !!rig?.actions?.idle,
                hasWalk: !!rig?.actions?.walk,
                hasRun: !!rig?.actions?.run,
              };
              return coverage;
            }, {})"""
        )

        reveal = page.evaluate(
            """() => {
              const enemy = BP.world.enemies.find(e => e.concealed && !e.dead);
              if (!enemy) return null;
              const beforeRig = enemy.mesh.userData.rig;
              const beforeHealth = enemy.health;
              enemy.damage(1, BP.world, false, false);
              const rig = enemy.mesh.userData.rig;
              return {
                beforeCivilian: !!beforeRig?.civilian,
                beforeRifleVisible: !!beforeRig?.rifle?.visible,
                concealed: enemy.concealed,
                state: enemy.state,
                beforeHealth,
                afterHealth: enemy.health,
                authored: !!rig?.authored,
                rifleVisible: !!rig?.rifle?.visible,
              };
            }"""
        )
        page.wait_for_timeout(180)
        page.screenshot(path=str(output / "market-contact.png"))
        civilian_death = page.evaluate(
            """() => {
              const civilian = BP.world.civilians.find(c => !c.dead);
              civilian.kill();
              civilian.update(0.1, BP.world);
              return { dead: civilian.dead, deathAnim: civilian.deathAnim };
            }"""
        )

        page.evaluate("() => BP.startLevel(1)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        escort = page.evaluate(
            """() => {
              const civilian = BP.world.civilians.find(c => c.hostage);
              const rescued = civilian.rescue('you');
              BP.world.combatHeat = 0;
              civilian.pos.set(BP.player.pos.x, BP.player.pos.y, BP.player.pos.z + 10);
              civilian.baseY = BP.player.pos.y;
              const targetDistance = () => {
                const sin = Math.sin(BP.world.playerYaw);
                const cos = Math.cos(BP.world.playerYaw);
                const tx = BP.world.playerPos.x + sin * 2 + cos * civilian.escortSide * 0.72;
                const tz = BP.world.playerPos.z + cos * 2 - sin * civilian.escortSide * 0.72;
                return Math.hypot(tx - civilian.pos.x, tz - civilian.pos.z);
              };
              const beforeFollow = targetDistance();
              for (let i = 0; i < 40; i++) civilian.update(0.05, BP.world);
              const afterFollow = targetDistance();
              BP.world.combatHeat = 5;
              for (let i = 0; i < 40; i++) civilian.update(0.05, BP.world);
              return {
                rescued,
                escort: civilian.escort,
                protected: civilian.wasHostage,
                stillBound: civilian.hostage,
                beforeFollow: Number(beforeFollow.toFixed(2)),
                afterFollow: Number(afterFollow.toFixed(2)),
                prone: Number(civilian.prone.toFixed(2)),
              };
            }"""
        )

        result = {
            "variantOrder": [signature["variant"] for signature in signatures],
            "variantRepeatStable": signatures[0]["civilians"] == signatures[3]["civilians"],
            "concealedPerVariant": [signature["concealed"] for signature in signatures],
            "crowdReaction": reaction,
            "rigCoverage": rig_coverage,
            "concealedReveal": reveal,
            "civilianDeath": civilian_death,
            "escort": escort,
            "screenshots": ["market-covert.png", "market-contact.png"],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        assert result["variantOrder"] == [0, 1, 2, 0]
        assert result["variantRepeatStable"]
        assert reaction["crossers"] > 0
        assert reaction["panicked"] >= reaction["total"] - 2
        assert reaction["moved"] >= reaction["total"] - 2
        assert sorted(rig_coverage.keys()) == ["0", "1", "2"]
        assert all(
            rig["authored"] and rig["hasIdle"] and rig["hasWalk"] and rig["hasRun"]
            for rig in rig_coverage.values()
        )
        assert reveal and not reveal["concealed"] and reveal["state"] == "alert"
        assert reveal["beforeCivilian"] and not reveal["beforeRifleVisible"]
        assert reveal["authored"] or reveal["rifleVisible"]
        assert civilian_death["dead"] and civilian_death["deathAnim"] > 0
        assert escort["rescued"] and escort["escort"] and escort["protected"]
        assert not escort["stillBound"]
        assert escort["afterFollow"] < escort["beforeFollow"] - 3
        assert escort["prone"] > 0.8
        browser.close()


if __name__ == "__main__":
    main()
