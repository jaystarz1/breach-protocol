#!/usr/bin/env python3
"""Verify shared authored field defenses across street, market, and finale missions."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-fortifications")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    views = {
        2: {"eye": [0, 1, -44], "target": [0, 0.7, -50], "file": "street-line.png"},
        5: {"eye": [-20, 2.5, 21], "target": [-26, 0.6, 28], "file": "market-line.png"},
        10: {"eye": [6, 1, 39], "target": [13, 0.6, 34], "file": "finale-line.png"},
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)

        results = {}
        for level, view in views.items():
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.evaluate(
                """({ eye, target }) => {
                  BP.player.locked = true;
                  for (const actor of [
                    ...BP.world.enemies,
                    ...BP.world.civilians,
                    ...(BP.world.allies || []),
                  ]) {
                    if (actor.mesh) actor.mesh.visible = false;
                  }
                  BP.player.pos.set(...eye);
                  const dx = target[0] - eye[0], dz = target[2] - eye[2];
                  const horizontal = Math.hypot(dx, dz);
                  BP.player.yaw = Math.atan2(-dx, -dz);
                  BP.player.pitch = Math.atan2(target[1] - (eye[1] + 1.6), horizontal);
                }""",
                view,
            )
            page.wait_for_timeout(260)
            page.screenshot(path=str(output / view["file"]))
            results[str(level)] = page.evaluate(
                """() => {
                  const parts = {};
                  BP.world.staticMesh.parent.traverse(object => {
                    if (!object.name?.startsWith('frontline-')) return;
                    if (!object.name.includes('hesco')
                        && !object.name.includes('hedgehog')
                        && !object.name.includes('sandbag')
                        && !object.name.includes('ambient-crater')
                        && !object.name.includes('ambient-rubble-fines')) return;
                    parts[object.name] = {
                      count: object.count || 0,
                      instanced: !!object.isInstancedMesh,
                      vertices: object.geometry?.attributes?.position?.count || 0,
                      instanceColors: object.instanceColor?.count || 0,
                      authoredSacks: !!object.userData.authoredSacks,
                    };
                  });
                  return {
                    parts,
                    calls: BP.performance.render.calls,
                    triangles: BP.performance.render.triangles,
                  };
                }"""
            )

        result = {
            "levels": results,
            "errors": errors[:8],
            "screenshots": [view["file"] for view in views.values()],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        expected = {
            "2": {
                "frontline-barricade-hesco-fill": 5,
                "frontline-barricade-hesco-cages": 5,
                "frontline-anti-vehicle-hedgehogs": 3,
            },
            "5": {
                "frontline-market-hesco-fill": 5,
                "frontline-market-hesco-cages": 5,
                "frontline-ambient-crater-rims": 4,
                "frontline-ambient-rubble-fines": 144,
            },
            "10": {
                "frontline-fallback-hesco-fill": 4,
                "frontline-fallback-hesco-cages": 4,
                "frontline-fallback-hedgehogs": 2,
                "frontline-fallback-sandbags": 32,
                "frontline-ambient-crater-rims": 4,
                "frontline-ambient-rubble-fines": 144,
            },
        }
        for level, names in expected.items():
            parts = results[level]["parts"]
            assert set(names).issubset(parts)
            assert all(parts[name]["count"] == count for name, count in names.items())
            assert all(parts[name]["instanced"] for name in names)
            assert results[level]["calls"] < 450
            assert results[level]["triangles"] < 1_500_000
        fallback = results["10"]["parts"]["frontline-fallback-sandbags"]
        assert fallback["authoredSacks"]
        assert fallback["vertices"] > 450
        assert fallback["instanceColors"] == fallback["count"]
        browser.close()


if __name__ == "__main__":
    main()
