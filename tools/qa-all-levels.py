#!/usr/bin/env python3
"""Boot every campaign mission and report broad desktop render regressions."""
import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--mute-audio"])
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)

        levels = []
        for level in range(1, 15):
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function(
                "(id) => BP.mode === 'playing' && BP.campaign.currentMission === id",
                arg=level,
                timeout=90000,
            )
            page.wait_for_timeout(160)
            levels.append(page.evaluate("""(id) => ({
              level: id,
              mode: BP.mode,
              calls: BP.performance.render.calls,
              triangles: BP.performance.render.triangles,
              programs: BP.performance.resources.programs,
              enemies: BP.world.enemies.length,
              civilians: BP.world.civilians.length,
              objectives: BP.world.level.objectives.length,
              phaseSteps: BP.world.level.objectives.map(phase => phase.steps?.length || 1),
              objectiveDevices: (BP.world.level.objectiveDevices || []).map(device => device.id),
              visualBatches: BP.world.staticMesh.parent.children.filter(
                object => object.isInstancedMesh).length,
            })""", level))

        result = {"levels": levels, "errors": errors[:12]}
        print(json.dumps(result, indent=2))
        assert not errors
        assert len(levels) == 14
        assert all(item["mode"] == "playing" for item in levels)
        assert all(item["objectives"] == 3 for item in levels)
        assert all(len(item["phaseSteps"]) == 3 for item in levels)
        assert all(item["calls"] < 450 for item in levels)
        assert all(item["triangles"] < 1_500_000 for item in levels)
        # Levels 11-14 are drone-only (flight school + the fence): no ground order of battle.
        assert all(item["enemies"] > 0 or item["level"] >= 11 for item in levels)
        assert all(item["objectives"] > 0 for item in levels)
        browser.close()


if __name__ == "__main__":
    main()
