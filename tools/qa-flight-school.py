#!/usr/bin/env python3
"""Flight school end-to-end: DRONARIUM (11) and GRADUATION (12).

Level 11: 4 statics, 3 movers + cage (frontal defeated, rear kills), bomber over the
practice siding (tank hulk takes two bombs). Level 12: the same shape under jamming
(bubble asserted to actually jam), ending on the rolling train. Lesson cards are skipped
through the QA hook. Both levels must reach a won debrief.
"""
import argparse
import json
import time

from playwright.sync_api import sync_playwright

KILL_JS = """() => {
  const d = BP.world.drone;
  if (!d || !d.active) return null;
  d.skipLessons?.();
  if (d.frozen) return 'frozen';
  const live = d.combatVehicles.filter(v => !v.dead);
  if (!live.length) return 'clear';
  const target = live.find(v => !v.cage) || live[0];
  if (target.cage) {
    const rear = { x: Math.cos(target.mesh.rotation.y), z: -Math.sin(target.mesh.rotation.y) };
    d.pos.set(target.pos.x + rear.x * 2.0, target.pos.y + 1.3, target.pos.z + rear.z * 2.0);
  } else {
    d.pos.set(target.pos.x + 1.4, target.pos.y + 1.3, target.pos.z + 1.1);
  }
  d.vel.set(0, 0, 0);
  return live.length;
}"""


def clear_fpv_phase(page, done_check, max_s=240):
    started = time.monotonic()
    while time.monotonic() - started < max_s:
        if page.evaluate(done_check):
            return
        page.evaluate(KILL_JS)
        page.wait_for_timeout(1600)
    raise AssertionError(f"phase timeout waiting for {done_check}")


def clear_bomber_phase(page, max_s=200):
    started = time.monotonic()
    while time.monotonic() - started < max_s:
        state = page.evaluate("""() => {
          const d = BP.world.drone;
          if (!d || !d.active) return { done: true };
          d.skipLessons?.();
          const live = d.combatVehicles.filter(v => !v.dead);
          if (!live.length) return { live: 0 };
          const target = live[0];
          d.pos.set(target.pos.x, target.pos.y + 9, target.pos.z);
          d.vel.set(0, 0, 0);
          if (d.bombs > 0 && !d.munitions.length) d.dropBomb();
          return { live: live.length, bombs: d.bombs };
        }""")
        if state.get("done") or state.get("live") == 0:
            return
        page.wait_for_timeout(700)
    raise AssertionError("bomber phase timeout")


def start_level(page, level):
    page.evaluate("(id) => BP.startLevel(id)", level)
    page.wait_for_function(
        "(id) => BP.mode === 'playing' && BP.world?.level?.id === id"
        " && !!BP.world.drone?.active", arg=level)
    page.wait_for_timeout(600)
    page.evaluate("() => BP.world.drone.skipLessons?.()")


def wait_phase(page, idx):
    page.wait_for_function(
        "(idx) => BP.world.objectiveIdx === idx && !!BP.world.drone?.active",
        arg=idx, timeout=60000)
    page.wait_for_timeout(500)
    page.evaluate("() => BP.world.drone.skipLessons?.()")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.set_default_timeout(240000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.BP")

        # ---------------- Level 11: DRONARIUM ----------------
        start_level(page, 11)
        lessons = page.evaluate("() => (BP.world.drone.lessonQueue || []).length")

        clear_fpv_phase(page, "() => BP.world.objectiveIdx >= 1")
        wait_phase(page, 1)

        # Movers phase: cage is authored LAST, so the movers die first. Before the cage
        # falls, prove the frontal hit is defeated.
        clear_fpv_phase(
            page,
            "() => BP.world.drone.combatVehicles.filter(v => !v.dead).length === 1"
            " || BP.world.objectiveIdx >= 2")
        front = page.evaluate("""() => {
          const d = BP.world.drone;
          const tank = d.combatVehicles.find(v => v.cage);
          if (!tank || tank.dead) return null;
          const lost = d.airframesLost;
          const nose = { x: -Math.cos(tank.mesh.rotation.y), z: Math.sin(tank.mesh.rotation.y) };
          d.pos.set(tank.pos.x + nose.x * 2.0, tank.pos.y + 1.3, tank.pos.z + nose.z * 2.0);
          d.vel.set(0, 0, 0);
          return { health: tank.health, lost };
        }""")
        assert front is not None, "cage died before the frontal test"
        page.wait_for_function(
            "(lost) => BP.world.drone.airframesLost > lost", arg=front["lost"], timeout=30000)
        after_front = page.evaluate("""() => {
          const tank = BP.world.drone.combatVehicles.find(v => v.cage);
          return { dead: tank.dead, health: tank.health };
        }""")
        clear_fpv_phase(page, "() => BP.world.objectiveIdx >= 2")
        wait_phase(page, 2)

        clear_bomber_phase(page)
        page.wait_for_function("() => BP.mode === 'debrief'", timeout=60000)
        debrief11 = page.evaluate(
            "() => ({ won: BP.world.won, kills: BP.world.stats.kills })")

        # Lessons must not replay: the set was completed (skipped counts), so a retry of
        # the level goes straight to the range with an empty queue — no skipLessons here.
        page.evaluate("(id) => BP.startLevel(id)", 11)
        page.wait_for_function(
            "() => BP.mode === 'playing' && BP.world?.level?.id === 11"
            " && !!BP.world.drone?.active")
        replay_cards = page.evaluate(
            "() => (BP.world.drone.lessonQueue || []).length")

        # ---------------- Level 12: GRADUATION ----------------
        start_level(page, 12)
        # The bubble must actually jam: park high inside it and read the signal.
        page.evaluate("""() => {
          const d = BP.world.drone;
          d.skipLessons?.();
          d.pos.set(0, 45, -60); d.vel.set(0, 0, 0);
        }""")
        page.wait_for_timeout(900)
        jam = page.evaluate("() => BP.world.drone.signal")

        clear_fpv_phase(page, "() => BP.world.objectiveIdx >= 1")
        wait_phase(page, 1)
        movers = page.evaluate(
            "() => BP.world.drone.combatVehicles.filter(v => v.route.length >= 2).length")
        clear_fpv_phase(page, "() => BP.world.objectiveIdx >= 2")
        wait_phase(page, 2)
        train = page.evaluate(
            "() => BP.world.drone.combatVehicles.filter(v => v.route.length >= 2).length")
        clear_bomber_phase(page)
        page.wait_for_function("() => BP.mode === 'debrief'", timeout=60000)
        debrief12 = page.evaluate(
            "() => ({ won: BP.world.won, kills: BP.world.stats.kills })")

        # ---------------- Level 13: NAP OF THE EARTH ----------------
        start_level(page, 13)
        # The gully targets must genuinely sit below the OP datum — the terrain IS the course.
        gully = page.evaluate(
            "() => BP.world.drone.combatVehicles.map(v => Math.round(v.pos.y * 10) / 10)")
        clear_fpv_phase(page, "() => BP.world.objectiveIdx >= 1")
        wait_phase(page, 1)
        clear_fpv_phase(page, "() => BP.world.objectiveIdx >= 2")
        wait_phase(page, 2)
        road_movers = page.evaluate(
            "() => BP.world.drone.combatVehicles.filter(v => v.route.length >= 4).length")
        clear_fpv_phase(page, "() => BP.mode === 'debrief'")
        page.wait_for_function("() => BP.mode === 'debrief'", timeout=60000)
        debrief13 = page.evaluate(
            "() => ({ won: BP.world.won, kills: BP.world.stats.kills })")

        result = {
            "dronarium": {"lessonCards": lessons, "replayCards": replay_cards,
                          "afterFront": after_front, "debrief": debrief11},
            "graduation": {"jamSignalHighInBubble": jam, "jammedMovers": movers,
                           "trainCars": train, "debrief": debrief12},
            "napOfTheEarth": {"gullyTargetHeights": gully, "roadMovers": road_movers,
                              "debrief": debrief13},
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))
        assert lessons == 0, result            # skipLessons must have drained the queue
        assert replay_cards == 0, result       # a seen card set never replays on retry
        assert after_front["dead"] is False, result
        assert after_front["health"] < 500, result
        assert debrief11["won"] is True, result
        assert debrief11["kills"] >= 11, result
        assert jam < 0.45, result              # high inside the bubble must be heavily jammed
        assert movers == 3, result
        assert train == 4, result
        assert debrief12["won"] is True, result
        assert debrief12["kills"] >= 9, result
        assert min(gully) < -2, result         # gully targets sit below the OP datum
        assert road_movers == 3, result
        assert debrief13["won"] is True, result
        assert debrief13["kills"] >= 8, result
        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    main()
