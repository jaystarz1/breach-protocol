#!/usr/bin/env python3
"""Verify wall dressing is rendered as one deterministic weathered decal atlas."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-wall-decals")
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

        def capture(level, screenshot=None):
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.wait_for_timeout(250)
            row = page.evaluate("""() => {
              const root = BP.world.staticMesh.parent;
              const mesh = root.getObjectByName('wall-decal-atlas');
              return {
                meshCount: root.children.filter(child => child.name === 'wall-decal-atlas').length,
                stats: root.userData.wallDecalStats,
                vertices: mesh?.geometry?.attributes?.position?.count || 0,
                transparent: mesh?.material?.transparent,
                texture: !!mesh?.material?.map?.isTexture,
                calls: BP.performance.render.calls,
              };
            }""")
            if screenshot:
                page.screenshot(path=str(output / screenshot))
            return row

        levels = {
            "1": capture(1, "command-post.png"),
            "4": capture(4, "alley.png"),
            "10": capture(10),
        }
        first = levels["4"]["stats"]
        repeat = capture(4)["stats"]
        result = {
            "levels": levels,
            "alleyRepeatStable": first == repeat,
            "errors": errors[:8],
            "screenshots": ["command-post.png", "alley.png"],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        assert result["alleyRepeatStable"]
        for row in levels.values():
            assert row["meshCount"] == 1
            assert row["vertices"] == row["stats"]["decalCount"] * 4
            assert row["transparent"]
            assert row["texture"]
            assert row["stats"]["decalCount"] >= 16
            assert row["calls"] <= 340
        assert levels["1"]["stats"]["decalCounts"]["poster"] >= 20
        assert levels["4"]["stats"]["decalCounts"]["graffiti"] >= 8
        assert levels["10"]["stats"]["decalCounts"]["poster"] >= 15
        browser.close()


if __name__ == "__main__":
    main()
