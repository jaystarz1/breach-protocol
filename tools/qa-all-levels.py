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

        # Every mission briefing exposes both variants and persists the selection used by
        # deploy. Exercise the real menu path before the direct boot sweep.
        page.locator("#menu-levels").click()
        page.locator("#level-list .menu-btn").first.click()
        page.locator("#brief-day").click()
        assert "sel" in (page.locator("#brief-day").get_attribute("class") or "")
        assert "DAY" in page.locator("#brief-num").inner_text()
        assert page.evaluate("() => BP.S.timeOfDayByLevel[1]") == "day"
        page.locator("#brief-go").click()
        page.wait_for_function("() => BP.mode === 'playing' && BP.world?.level?.id === 1")
        assert page.evaluate("() => BP.world.level.timeOfDay") == "day"

        # Results at the same difficulty remain independent across lighting variants while
        # the legacy overall best continues to represent campaign completion.
        score_records = page.evaluate("""async () => {
          const saves = await import('./src/save.js');
          saves.recordResult(999, 700, 'A', 'REGULAR', 'day');
          saves.recordResult(999, 900, 'S', 'REGULAR', 'night');
          return {
            day: BP.S.bestByTime[999].day.score,
            night: BP.S.bestByTime[999].night.score,
            overall: BP.S.best[999].score,
          };
        }""")
        assert score_records == {"day": 700, "night": 900, "overall": 900}, score_records

        level_ids = page.evaluate("() => BP.LEVELS.map(l => l.id)")
        levels = []
        for time_of_day in ("day", "night"):
            for level in level_ids:
                print(f"Booting mission id {level} ({time_of_day})", flush=True)
                page.evaluate("([id, time]) => BP.startLevel(id, time)", [level, time_of_day])
                page.wait_for_function(
                    "([id, time]) => BP.mode === 'playing' && BP.campaign.currentMission === id && BP.timeOfDay === time",
                    arg=[level, time_of_day],
                    timeout=90000,
                )
                page.wait_for_timeout(160)
                levels.append(page.evaluate("""([id, requested]) => ({
                  level: id,
                  requested,
                  timeOfDay: BP.world.level.timeOfDay,
                  sceneTime: BP.scene.userData.timeOfDay,
                  background: BP.scene.background?.getHex(),
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
                })""", [level, time_of_day]))

        result = {"levels": levels, "scoreRecords": score_records, "errors": errors[:12]}
        print(json.dumps(result, indent=2))
        assert not errors
        expected_ids = [1, 2, 3, 4] + list(range(11, 21)) + list(range(21, 25))
        assert level_ids == expected_ids, level_ids
        assert len(levels) == len(expected_ids) * 2
        assert [item["level"] for item in levels[:len(expected_ids)]] == expected_ids
        assert [item["level"] for item in levels[len(expected_ids):]] == expected_ids
        assert all(item["requested"] == item["timeOfDay"] == item["sceneTime"] for item in levels)
        for level in level_ids:
            day = next(item for item in levels if item["level"] == level and item["requested"] == "day")
            night = next(item for item in levels if item["level"] == level and item["requested"] == "night")
            assert day["background"] != night["background"], (day, night)
        assert all(item["mode"] == "playing" for item in levels)
        assert all(item["objectives"] > 0 for item in levels)
        assert all(len(item["phaseSteps"]) == item["objectives"] for item in levels)
        # The merged acts carry three source levels of art in one scene; everything else
        # keeps the original single-level draw budget.
        assert all(item["calls"] < (700 if item["level"] in (2, 3, 4) else 450)
                   for item in levels)
        assert all(item["triangles"] < 1_500_000 for item in levels)
        # Levels 11-20 are drone-only: no ground order of battle.
        assert all(item["enemies"] > 0 or item["level"] >= 11 for item in levels)
        assert all(item["objectives"] > 0 for item in levels)
        browser.close()


if __name__ == "__main__":
    main()
