#!/usr/bin/env python3
"""Verify shared tower elevations use deterministic damaged facade batches."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-tower-facades")
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

        def signature(level):
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.wait_for_timeout(220)
            return page.evaluate("""() => {
              const counts = {};
              BP.world.staticMesh.parent.traverse(object => {
                if (!object.userData.instanceCount) return;
                counts[object.name] = (counts[object.name] || 0)
                  + object.userData.instanceCount;
              });
              const photoRooms = Object.entries(counts)
                .filter(([name]) => name.startsWith('window-room-photo-'))
                .reduce((sum, [, count]) => sum + count, 0);
              return {
                windows: (counts['recess-dark'] || 0)
                  + (counts['recess-warm'] || 0)
                  + (counts['recess-cool'] || 0)
                  + photoRooms,
                sills: counts['window-sills'] || 0,
                broken: counts['window-bent-frames'] || 0,
                boarded: (counts['window-boards'] || 0) / 3,
                downpipes: counts['facade-downpipes'] || 0,
                authoredDoors: BP.world.doors.doors.filter(
                  door => door.mesh.userData.authoredDoor).length,
                counts,
              };
            }""")

        levels = {str(level): signature(level) for level in [3, 7, 10]}
        page.evaluate("() => BP.startLevel(3)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(220)
        repeat = page.evaluate("""() => {
          const counts = {};
          BP.world.staticMesh.parent.traverse(object => {
            if (object.userData.instanceCount) {
              counts[object.name] = (counts[object.name] || 0)
                + object.userData.instanceCount;
            }
          });
          return counts;
        }""")
        page.screenshot(path=str(output / "tower-entry.png"))

        result = {
            "levels": levels,
            "level3RepeatStable": levels["3"]["counts"] == repeat,
            "errors": errors[:8],
            "screenshots": ["tower-entry.png"],
        }
        print(json.dumps(result, indent=2))

        assert not errors
        assert result["level3RepeatStable"]
        minimum_windows = {"3": 35, "7": 55, "10": 28}
        assert all(
            levels[level]["windows"] >= minimum
            for level, minimum in minimum_windows.items()
        )
        assert all(row["sills"] == row["windows"] for row in levels.values())
        assert all(row["broken"] > 0 and row["boarded"] > 0 for row in levels.values())
        assert all(row["downpipes"] >= 8 for row in levels.values())
        assert levels["3"]["counts"].get("facade-balcony-slabs", 0) == 0
        assert levels["7"]["counts"].get("facade-balcony-slabs", 0) > 0
        assert levels["3"]["authoredDoors"] == 6
        assert levels["7"]["authoredDoors"] == 2
        assert levels["10"]["authoredDoors"] == 2
        browser.close()


if __name__ == "__main__":
    main()
