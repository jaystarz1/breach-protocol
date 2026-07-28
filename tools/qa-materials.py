#!/usr/bin/env python3
"""Capture representative material-family scenes and verify fixed world batching."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-materials")
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

        results = {}
        for level in (1, 4, 9, 10):
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.wait_for_timeout(150)
            screenshot = output / f"level-{level}.png"
            page.screenshot(path=str(screenshot))
            results[str(level)] = page.evaluate("""() => ({
              families: BP.world.staticMesh.children.map(mesh => mesh.userData.surfaceFamily),
              familyDraws: BP.world.staticMesh.children.length,
              calls: BP.performance.render.calls,
              programs: BP.performance.resources.programs,
            })""")

        print(json.dumps({"levels": results, "errors": errors[:8]}, indent=2))
        assert not errors
        assert all(result["familyDraws"] <= 8 for result in results.values())
        assert all(result["familyDraws"] >= 3 for result in results.values())
        browser.close()


if __name__ == "__main__":
    main()
