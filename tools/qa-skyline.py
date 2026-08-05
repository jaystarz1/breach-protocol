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

        def capture(level, screenshot=None):
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.wait_for_timeout(220)
            result = page.evaluate("""() => {
              const profileBatches = {};
              const facadeBatches = {};
              const roofBatches = {};
              BP.world.staticMesh.parent.traverse(object => {
                if (object.name?.startsWith('skyline-profile-')) {
                  profileBatches[object.name] = object.userData.instanceCount || 0;
                }
                if (object.name?.startsWith('skyline-window-')
                    || object.name?.startsWith('skyline-floor-')
                    || object.name?.startsWith('skyline-pilaster')
                    || object.name?.startsWith('skyline-balcony-')
                    || object.name?.startsWith('skyline-exposed-')
                    || object.name === 'skyline-cornices'
                    || object.name === 'skyline-shell-scars') {
                  facadeBatches[object.name] = object.userData.instanceCount || 0;
                }
                if (object.name?.startsWith('skyline-roof-')
                    && !object.name?.startsWith('skyline-profile-')) {
                  roofBatches[object.name] = object.userData.instanceCount || 0;
                }
              });
              return {
                stats: BP.world.staticMesh.parent.userData.skylineStats,
                profileBatches,
                facadeBatches,
                roofBatches,
                familyDraws: BP.world.staticMesh.children.length,
                calls: BP.performance.render.calls,
              };
            }""")
            if screenshot:
                page.screenshot(path=str(output / screenshot))
            return result

        levels = {
            "2": capture(102, "street-skyline.png"),
            "5": capture(105, "market-skyline.png"),
            "10": capture(110, "finale-skyline.png"),
        }
        first_market = levels["5"]["stats"]
        repeat_market = capture(105)["stats"]

        result = {
            "levels": levels,
            "marketRepeatStable": first_market == repeat_market,
            "errors": errors[:8],
            "screenshots": [
                "street-skyline.png", "market-skyline.png", "finale-skyline.png"
            ],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        assert result["marketRepeatStable"]
        for row in levels.values():
            stats = row["stats"]
            assert stats["buildings"] >= 36
            assert stats["masses"] >= stats["buildings"] * 1.25
            assert stats["panes"] > 0
            assert stats["facades"] >= stats["masses"] * 1.8
            assert all(count > 0 for count in stats["profiles"].values())
            assert all(count > 0 for count in stats["roofProfiles"].values())
            assert all(count > 0 for count in stats["roofEquipment"].values())
            assert len(row["profileBatches"]) == 3
            assert row["facadeBatches"]["skyline-window-recesses"] >= stats["facades"] * 5
            assert (
                row["facadeBatches"]["skyline-window-frames"]
                == row["facadeBatches"]["skyline-window-recesses"]
            )
            assert row["facadeBatches"]["skyline-window-boards"] > 0
            assert row["facadeBatches"]["skyline-floor-bands"] > 0
            assert row["facadeBatches"]["skyline-pilasters"] >= stats["facades"] * 2
            assert row["facadeBatches"]["skyline-balcony-slabs"] > 0
            assert row["facadeBatches"]["skyline-balcony-rails"] > 0
            assert row["facadeBatches"]["skyline-exposed-floor-slabs"] > 0
            assert row["facadeBatches"]["skyline-cornices"] == stats["facades"]
            assert row["facadeBatches"]["skyline-shell-scars"] > 0
            assert len(row["facadeBatches"]) == 10
            assert row["roofBatches"]["skyline-roof-plant-housings"] > 0
            assert row["roofBatches"]["skyline-roof-tanks"] > 0
            assert row["roofBatches"]["skyline-roof-masts"] > 0
            assert row["familyDraws"] <= 12
        browser.close()


if __name__ == "__main__":
    main()
