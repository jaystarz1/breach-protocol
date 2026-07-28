#!/usr/bin/env python3
"""Verify deterministic, visibly degraded desktop facade batches."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-facades")
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
              const counts = {};
              BP.world.staticMesh.parent.traverse(object => {
                if (!object.userData.instanceCount) return;
                counts[object.name] = (counts[object.name] || 0)
                  + object.userData.instanceCount;
              });
              const windows = (counts['recess-dark'] || 0)
                + (counts['recess-warm'] || 0)
                + (counts['recess-cool'] || 0);
              return {
                counts,
                windows,
                framesPerWindow: +((counts['window-frames'] || 0) / windows).toFixed(2),
                visiblySecuredOrDestroyed: +(
                  ((counts['window-boards'] || 0) / 3
                    + (counts['window-bent-frames'] || 0)) / windows
                ).toFixed(2),
                calls: BP.performance.render.calls,
              };
            }""")

        page.evaluate("() => BP.startLevel(2)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(250)
        first = signature()
        page.screenshot(path=str(output / "street-facades.png"))
        page.evaluate("""() => {
          BP.player.pos.set(-3.5, 0, 5);
          BP.player.yaw = Math.PI / 2;
          BP.player.pitch = 0.13;
        }""")
        page.wait_for_timeout(180)
        page.screenshot(path=str(output / "facade-shell-oblique.png"))

        page.evaluate("() => BP.startLevel(2)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(250)
        second = signature()

        page.evaluate("() => BP.startLevel(3)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(250)
        tower = signature()
        page.screenshot(path=str(output / "tower-shells.png"))

        result = {
            "first": first,
            "tower": tower,
            "repeatStable": first["counts"] == second["counts"],
            "errors": errors[:8],
            "screenshots": [
                "street-facades.png", "facade-shell-oblique.png", "tower-shells.png"
            ],
        }
        print(json.dumps(result, indent=2))

        counts = first["counts"]
        assert not errors
        assert result["repeatStable"]
        assert first["windows"] > 100
        assert counts.get("window-boards", 0) > 0
        assert counts.get("window-shards", 0) > 0
        assert counts.get("window-bent-frames", 0) > 0
        assert counts.get("facade-soot", 0) > 0
        assert counts.get("facade-parapets", 0) > 0
        assert counts.get("facade-parapets-damaged", 0) > 0
        assert counts.get("facade-party-piers", 0) > 0
        assert counts.get("facade-shell-scars", 0) > 0
        assert counts.get("facade-exposed-masonry", 0) > 0
        assert counts.get("facade-balcony-slabs", 0) > 0
        assert tower["counts"].get("facade-floor-ledges", 0) > 0
        assert tower["counts"].get("facade-parapets", 0) > 0
        assert 4 <= first["framesPerWindow"] < 5.7
        assert first["visiblySecuredOrDestroyed"] >= 0.2
        browser.close()


if __name__ == "__main__":
    main()
