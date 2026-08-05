#!/usr/bin/env python3
"""Verify Street Sweep's photographic road atlas and static batching contract."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-road-surface")
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

        def capture():
            page.evaluate("() => BP.startLevel(102)")
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.evaluate("""() => {
              BP.player.pos.set(-1.2, 0, 40);
              BP.player.yaw = Math.PI;
              BP.player.pitch = -0.30;
            }""")
            page.wait_for_timeout(350)
            return page.evaluate("""() => {
              const root = BP.world.staticMesh.parent;
              const names = [
                'road-damage-atlas', 'road-markings-batch', 'wet-patches-batch',
                'contact-shadows-batch', 'facade-floor-bands', 'facade-pilasters',
                'utility-covers',
              ];
              const batches = {};
              for (const name of names) {
                const object = root.getObjectByName(name);
                batches[name] = {
                  count: object?.userData?.itemCount || object?.userData?.instanceCount || 0,
                  instanced: !!object?.isInstancedMesh,
                  texture: !!object?.material?.map?.isTexture,
                  width: object?.material?.map?.image?.width || 0,
                  height: object?.material?.map?.image?.height || 0,
                  signature: object?.userData?.signature || 0,
                };
              }
              return {
                batches,
                calls: BP.performance.render.calls,
                triangles: BP.performance.render.triangles,
                textures: BP.performance.resources.textures,
              };
            }""")

        first = capture()
        page.screenshot(path=str(output / "street-entry.png"))
        page.evaluate("""() => {
          BP.player.pos.set(-1.2, 0, -18);
          BP.player.yaw = Math.PI;
          BP.player.pitch = -0.36;
        }""")
        page.wait_for_timeout(220)
        page.screenshot(path=str(output / "street-mid.png"))
        repeat = capture()

        result = {
            "first": first,
            "repeatStable": first["batches"] == repeat["batches"],
            "errors": errors[:8],
            "screenshots": ["street-entry.png", "street-mid.png"],
        }
        print(json.dumps(result, indent=2))

        batches = first["batches"]
        assert not errors
        assert result["repeatStable"]
        assert batches["road-damage-atlas"]["count"] == 37
        assert batches["road-damage-atlas"]["signature"] != 0
        assert batches["road-damage-atlas"]["texture"]
        assert batches["road-damage-atlas"]["width"] == 1254
        assert batches["road-damage-atlas"]["height"] == 1254
        assert batches["road-markings-batch"]["count"] == 36
        assert batches["wet-patches-batch"]["count"] == 4
        assert batches["contact-shadows-batch"]["count"] == 6
        assert batches["facade-floor-bands"]["count"] == 6
        assert batches["facade-pilasters"]["count"] == 17
        assert batches["utility-covers"]["count"] == 3
        assert batches["facade-floor-bands"]["instanced"]
        assert batches["facade-pilasters"]["instanced"]
        assert batches["utility-covers"]["instanced"]
        assert first["calls"] <= 300
        assert first["triangles"] <= 650_000
        browser.close()


if __name__ == "__main__":
    main()
