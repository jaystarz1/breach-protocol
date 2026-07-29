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
        page.evaluate(
            """() => {
              BP.player.pos.set(0, 0, 27);
              const subject = BP.world.civilians.reduce((best, civilian) =>
                Math.hypot(civilian.pos.x, civilian.pos.z - 24)
                  < Math.hypot(best.pos.x, best.pos.z - 24) ? civilian : best);
              subject.mesh.rotation.y = Math.PI / 2;
              const target = { x: 0, y: 1.15, z: 24 };
              BP.player.yaw = Math.atan2(
                -(target.x - BP.player.pos.x), -(target.z - BP.player.pos.z));
              BP.player.pitch = Math.atan2(
                target.y - 1.6,
                Math.hypot(target.x - BP.player.pos.x, target.z - BP.player.pos.z));
            }"""
        )
        page.wait_for_timeout(180)
        page.screenshot(path=str(output / "market-civilian-close.png"))
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, 34);
          BP.player.yaw = 0;
          BP.player.pitch = 0;
        }""")
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
                panicPosed: BP.world.civilians.filter(c =>
                  !!c.mesh.userData.rig?.panicBones).length,
                panicStyles: [...new Set(BP.world.civilians.map(c =>
                  c.mesh.userData.rig?.panicStyle).filter(Number.isFinite))].sort(),
                bodyScales: [...new Set(BP.world.civilians.map(c => {
                  const scale = c.mesh.userData.rig?.bodyScale;
                  return scale ? `${scale.height}:${scale.width}` : null;
                }).filter(Boolean))].sort(),
              };
            }"""
        )
        rig_coverage = page.evaluate(
            """() => BP.world.civilians.reduce((coverage, civilian) => {
              const rig = civilian.mesh.userData.rig;
              const skin = rig?.mergedSkin;
              const countMask = name => {
                const values = skin?.geometry?.attributes?.[name]?.array;
                return values ? Array.from(values).filter(value => value > 0.5).length : 0;
              };
              const key = String(rig?.civilianSource);
              coverage[key] ||= {
                authored: !!rig?.authored,
                hasIdle: !!rig?.actions?.idle,
                hasWalk: !!rig?.actions?.walk,
                hasRun: !!rig?.actions?.run,
                material: skin?.material?.name,
                fabricVertices: countMask('fabricMask'),
                skinVertices: countMask('skinMask'),
                hairVertices: countMask('hairMask'),
                fabricNormal: !!skin?.material?.normalMap,
                fabricRoughness: !!skin?.material?.roughnessMap,
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
        market_art = page.evaluate(
            """() => {
              const parts = {};
              BP.world.staticMesh.parent.traverse(object => {
                if (!object.name?.startsWith('stall-')
                    && !object.name?.startsWith('frontline-aid-')
                    && !object.name?.startsWith('market-')
                    && !object.name?.startsWith('supply-crate')) return;
                parts[object.name] = {
                  instances: object.count || object.userData.instanceCount || 1,
                  vertices: object.geometry?.attributes?.position?.count || 0,
                  mapped: !!object.material?.map,
                  relief: !!(object.material?.normalMap || object.material?.bumpMap),
                };
              });
              return parts;
            }"""
        )
        market_collision = page.evaluate(
            """() => {
              const hasBox = (x, z, w, h, d) => BP.world.solids.some(box =>
                Math.abs(box.min.x - (x - w / 2)) < 0.001
                && Math.abs(box.max.x - (x + w / 2)) < 0.001
                && Math.abs(box.min.y) < 0.001
                && Math.abs(box.max.y - h) < 0.001
                && Math.abs(box.min.z - (z - d / 2)) < 0.001
                && Math.abs(box.max.z - (z + d / 2)) < 0.001);
              const stalls = [];
              for (const z of [18, 6, -6, -18]) {
                for (const x of [-22, -8, 8, 22]) stalls.push([x, z]);
              }
              return {
                stalls: stalls.filter(([x, z]) => hasBox(x, z, 5, 1.1, 2)).length,
                crates: [[0, 0], [-15, 12], [15, -12]]
                  .filter(([x, z]) => hasBox(x, z, 1, 1, 1)).length,
              };
            }"""
        )
        page.evaluate(
            """() => {
              BP.player.pos.set(-13, 0, 25);
              const target = { x: -22, y: 1.25, z: 18 };
              const dx = target.x - BP.player.pos.x;
              const dz = target.z - BP.player.pos.z;
              BP.player.yaw = Math.atan2(-dx, -dz);
              BP.player.pitch = Math.atan2(target.y - 1.6, Math.hypot(dx, dz));
            }"""
        )
        page.wait_for_timeout(180)
        page.screenshot(path=str(output / "market-stall-close.png"))
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
            "marketArt": market_art,
            "marketCollision": market_collision,
            "rigCoverage": rig_coverage,
            "concealedReveal": reveal,
            "civilianDeath": civilian_death,
            "escort": escort,
            "screenshots": [
                "market-covert.png", "market-civilian-close.png",
                "market-contact.png", "market-stall-close.png"
            ],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        assert result["variantOrder"] == [0, 1, 2, 0]
        assert result["variantRepeatStable"]
        assert reaction["crossers"] > 0
        assert reaction["panicked"] >= reaction["total"] - 2
        assert reaction["moved"] >= reaction["total"] - 2
        assert reaction["panicPosed"] == reaction["total"]
        assert reaction["panicStyles"] == [0, 1, 2]
        assert len(reaction["bodyScales"]) == 6
        expected_market_art = {
            "stall-counter-tops": 16,
            "stall-counter-aprons": 32,
            "stall-counter-legs": 64,
            "stall-lower-shelves": 16,
            "stall-storage-crates": 48,
            "stall-posts": 64,
            "stall-canopies": 16,
            "stall-canopy-valances": 32,
            "stall-canopy-patches": 11,
            "stall-produce-trays": 64,
            "stall-produce-cabbage": 80,
            "stall-produce-squash": 80,
            "stall-produce-loaf": 80,
            "stall-produce-apple": 80,
            "stall-hanging-boards": 16,
            "stall-bulbs": 16,
            "frontline-aid-cartons": 24,
            "frontline-aid-carton-straps": 24,
            "frontline-aid-carton-labels": 48,
            "frontline-aid-pallet-slats": 20,
            "frontline-aid-pallet-runners": 12,
            "frontline-aid-supply-sacks": 8,
            "supply-crates-authored": 3,
            "supply-crate-labels": 3,
        }
        assert all(
            market_art[name]["instances"] == count
            for name, count in expected_market_art.items()
        )
        assert market_art["stall-storage-crates"]["vertices"] > 200
        assert market_art["stall-produce-trays"]["vertices"] > 100
        assert market_art["stall-counter-tops"]["mapped"]
        assert market_art["stall-counter-tops"]["relief"]
        assert market_art["stall-canopies"]["mapped"]
        assert market_art["stall-canopies"]["relief"]
        assert market_art["frontline-aid-cartons"]["vertices"] > 150
        assert market_art["frontline-aid-cartons"]["mapped"]
        assert market_art["frontline-aid-cartons"]["relief"]
        assert market_art["frontline-aid-supply-sacks"]["vertices"] > 450
        assert market_art["supply-crates-authored"]["vertices"] > 400
        assert market_art["supply-crates-authored"]["mapped"]
        assert market_art["supply-crates-authored"]["relief"]
        assert (
            market_art["market-plaza-pavers-a"]["instances"]
            + market_art["market-plaza-pavers-b"]["instances"]
        ) == 289
        assert market_art["market-plaza-drainage"]["instances"] == 18
        assert market_art["market-plaza-drain-slots"]["instances"] == 108
        assert market_art["market-plaza-standing-water"]["instances"] == 6
        assert market_art["market-plaza-impact-scars"]["instances"] == 5
        assert market_art["market-aid-shelter-tarps"]["instances"] == 4
        assert market_art["market-aid-shelter-poles"]["instances"] == 16
        assert market_art["market-aid-queue-posts"]["instances"] == 12
        assert market_art["market-aid-queue-rails"]["instances"] == 10
        assert market_art["market-aid-water-tanks"]["instances"] == 2
        assert market_art["market-aid-water-tank-bands"]["instances"] == 4
        assert market_art["market-aid-direction-signs"]["instances"] == 4
        assert market_art["market-plaza-paper-litter"]["instances"] == 78
        assert market_art["market-plaza-hard-litter"]["instances"] == 42
        assert sum(
            row["instances"] for name, row in market_art.items()
            if name.startswith("market-perimeter-rubble-")
        ) == 54
        assert market_collision == {"stalls": 16, "crates": 3}
        assert sorted(rig_coverage.keys()) == ["0", "1", "2"]
        assert all(
            rig["authored"] and rig["hasIdle"] and rig["hasWalk"] and rig["hasRun"]
            for rig in rig_coverage.values()
        )
        assert all(
            rig["material"] == "civilian-layered-surface"
            and rig["fabricVertices"] > 0
            and rig["skinVertices"] > 0
            and rig["hairVertices"] > 0
            and rig["fabricNormal"]
            and rig["fabricRoughness"]
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
