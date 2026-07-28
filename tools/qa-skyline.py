#!/usr/bin/env python3
"""Verify deterministic varied skyline massing without expanding draw families."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-skyline")
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

        def capture(level):
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.wait_for_timeout(220)
            return page.evaluate("""() => ({
              stats: BP.world.staticMesh.parent.userData.skylineStats,
              familyDraws: BP.world.staticMesh.children.length,
              calls: BP.performance.render.calls,
            })""")

        levels = {str(level): capture(level) for level in [2, 5, 10]}
        first_market = levels["5"]["stats"]
        repeat_market = capture(5)["stats"]
        page.screenshot(path=str(output / "market-skyline.png"))

        result = {
            "levels": levels,
            "marketRepeatStable": first_market == repeat_market,
            "errors": errors[:8],
            "screenshots": ["market-skyline.png"],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        assert result["marketRepeatStable"]
        for row in levels.values():
            stats = row["stats"]
            assert stats["buildings"] >= 36
            assert stats["masses"] >= stats["buildings"] * 1.35
            assert stats["panes"] > 0
            assert all(count > 0 for count in stats["profiles"].values())
            assert row["familyDraws"] <= 8
        browser.close()


if __name__ == "__main__":
    main()
