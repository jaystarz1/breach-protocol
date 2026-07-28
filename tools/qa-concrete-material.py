#!/usr/bin/env python3
"""Verify the photographed concrete PBR family across concrete-heavy missions."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-concrete-material")
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

        levels = {}
        concrete_levels = [1, 3, 4, 6, 7, 9, 10]
        for level in concrete_levels:
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.wait_for_timeout(180)
            levels[str(level)] = page.evaluate("""() => {
              const part = BP.world.staticMesh.children.find(
                mesh => mesh.userData.surfaceFamily === 'concrete'
              );
              const source = texture => texture?.source?.data?.currentSrc
                || texture?.source?.data?.src
                || '';
              return {
                familyParts: BP.world.staticMesh.children.filter(
                  mesh => mesh.userData.surfaceFamily === 'concrete'
                ).length,
                color: source(part?.material?.map),
                normal: source(part?.material?.normalMap),
                roughness: source(part?.material?.roughnessMap),
                calls: BP.performance.render.calls,
              };
            }""")
            page.screenshot(path=str(output / f"level-{level}.png"))

        result = {
            "levels": levels,
            "screenshots": [f"level-{level}.png" for level in concrete_levels],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        for row in levels.values():
            assert row["familyParts"] == 1
            assert row["color"].endswith("/assets/materials/concrete/concrete-color.webp")
            assert row["normal"].endswith("/assets/materials/concrete/concrete-normal.webp")
            assert row["roughness"].endswith("/assets/materials/concrete/concrete-roughness.webp")
        browser.close()


if __name__ == "__main__":
    main()
