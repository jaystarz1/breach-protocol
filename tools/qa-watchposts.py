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
              BP.world.staticMesh.parent.traverse(object => {
                if (!object.name.startsWith('watch-post-')) return;
                parts[object.name] = {
                  count: object.count,
                  instanced: object.isInstancedMesh,
                  vertices: object.geometry?.attributes?.position?.count || 0,
                };
              });
              return { parts, calls: BP.performance.render.calls };
            }""")

        page.evaluate("() => BP.startLevel(10)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(250)
        first = signature()
        page.screenshot(path=str(output / "finale-entrance.png"))
        page.evaluate("() => BP.startLevel(10)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(250)
        second = signature()

        result = {
            "first": first,
            "repeatStable": first["parts"] == second["parts"],
            "errors": errors[:8],
            "screenshots": ["finale-entrance.png"],
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
        assert sum(
            row["count"] for name, row in first["parts"].items()
            if name.startswith("watch-post-gate-rubble-")
        ) == 28
        assert first["calls"] <= 340
        browser.close()


if __name__ == "__main__":
    main()
