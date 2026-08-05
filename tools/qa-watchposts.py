#!/usr/bin/env python3
"""Verify the finale entrance uses authored, instanced defensive watch posts."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-watchposts")
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

        def signature():
            return page.evaluate("""() => {
              const parts = {};
              const fortifications = {};
              let transparentGlass = null;
              BP.world.staticMesh.parent.traverse(object => {
                if (object.name.startsWith('watch-post-')) {
                  parts[object.name] = {
                    count: object.count,
                    instanced: object.isInstancedMesh,
                    vertices: object.geometry?.attributes?.position?.count || 0,
                  };
                }
                if (object.name.startsWith('fortified-gate-')) {
                  fortifications[object.name] = {
                    count: object.count || 1,
                    instanced: !!object.isInstancedMesh,
                    vertices: object.geometry?.attributes?.position?.count || 0,
                  };
                }
                const materials = Array.isArray(object.material)
                  ? object.material : [object.material];
                if (materials.some(
                  material => material?.name === 'watch-post-laminated-glass')) {
                  const material = materials.find(
                    item => item?.name === 'watch-post-laminated-glass');
                  transparentGlass = {
                    transparent: material.transparent,
                    opacity: material.opacity,
                    depthWrite: material.depthWrite,
                  };
                }
              });
              return {
                parts, fortifications, transparentGlass,
                calls: BP.performance.render.calls,
                triangles: BP.performance.render.triangles,
              };
            }""")

        page.evaluate("() => BP.startLevel(110)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(250)
        first = signature()
        page.screenshot(path=str(output / "finale-entrance.png"))
        page.evaluate("""() => {
          for (const actor of [
            ...BP.world.enemies, ...BP.world.civilians, ...(BP.world.allies || []),
          ]) actor.update = () => {};
          BP.player.health = 100000;
          BP.weapons.holder.visible = false;
        }""")
        detail_views = [
            {
                "file": "gate-breach-detail.png",
                "eye": [0, 0.2, 37],
                "target": [0, 1.7, 30],
            },
            {
                "file": "watch-post-detail.png",
                "eye": [-2, 0.8, 38],
                "target": [-8.5, 5.2, 30.3],
            },
            {
                "file": "sector-sign-detail.png",
                "eye": [-11, 0.6, 38],
                "target": [-17, 2.2, 30.3],
            },
        ]
        for view in detail_views:
            page.evaluate(
                """({ eye, target }) => {
                  BP.player.pos.set(...eye);
                  const dx = target[0] - eye[0];
                  const dz = target[2] - eye[2];
                  BP.player.yaw = Math.atan2(-dx, -dz);
                  BP.player.pitch = Math.atan2(
                    target[1] - (eye[1] + 1.6), Math.hypot(dx, dz));
                }""",
                view,
            )
            page.wait_for_timeout(180)
            page.screenshot(path=str(output / view["file"]))
        page.evaluate("() => BP.startLevel(110)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(250)
        second = signature()

        result = {
            "first": first,
            "repeatStable": (
                first["parts"] == second["parts"]
                and first["fortifications"] == second["fortifications"]
                and first["transparentGlass"] == second["transparentGlass"]
            ),
            "errors": errors[:8],
            "screenshots": [
                "finale-entrance.png",
                *(view["file"] for view in detail_views),
            ],
        }
        print(json.dumps(result, indent=2))

        expected = {
            "watch-post-bodies": 8,
            "watch-post-pitched-roofs": 2,
            "watch-post-windows": 2,
            "watch-post-supports": 8,
            "watch-post-window-frames": 10,
            "watch-post-cross-braces": 4,
            "watch-post-ladders": 24,
            "watch-post-rails": 12,
            "watch-post-sandbags": 14,
        }
        assert not errors
        assert result["repeatStable"]
        assert set(expected).issubset(first["parts"])
        assert all(
            first["parts"][name]["count"] == count
            for name, count in expected.items()
        )
        assert all(row["instanced"] for row in first["parts"].values())
        assert first["parts"]["watch-post-pitched-roofs"]["vertices"] > 24
        assert first["parts"]["watch-post-sandbags"]["vertices"] > 450
        assert first["parts"]["watch-post-front-cladding"]["count"] == 20
        assert first["parts"]["watch-post-side-cladding"]["count"] == 12
        assert first["parts"]["watch-post-interior-backs"]["count"] == 2
        assert first["parts"]["watch-post-interior-equipment"]["count"] == 4
        assert first["parts"]["watch-post-floodlight-lenses"]["count"] == 2
        assert first["transparentGlass"] == {
            "transparent": True,
            "opacity": 0.34,
            "depthWrite": False,
        }
        assert sum(
            row["count"] for name, row in first["parts"].items()
            if name.startswith("watch-post-gate-rubble-")
        ) == 28
        fortifications = first["fortifications"]
        assert fortifications["fortified-gate-repair-piers"]["count"] == 8
        assert (
            fortifications["fortified-gate-wall-panels-a"]["count"]
            + fortifications["fortified-gate-wall-panels-b"]["count"]
        ) == 10
        assert fortifications["fortified-gate-concertina"]["count"] >= 80
        assert fortifications["fortified-gate-broken-returns"]["count"] == 6
        assert fortifications["fortified-gate-exposed-rebar"]["count"] == 8
        assert fortifications["fortified-gate-impact-scars"]["count"] == 12
        assert fortifications["fortified-gate-sector-sign"]["count"] == 1
        # The rebuilt motor pool raised the finale's draw budget; keep parity with the
        # 450-call cap the other level-10 harnesses assert.
        assert first["calls"] <= 450
        assert first["triangles"] < 800_000
        browser.close()


if __name__ == "__main__":
    main()
