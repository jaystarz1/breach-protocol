#!/usr/bin/env python3
"""Drive a merged act end-to-end with the autoplay bot.

The bot walks the composed act route, fights, breaches and rescues through every segment
and seam. Drone phases are the one thing the ground bot cannot fly, so when a sortie goes
active this harness resolves it the way a perfect operator would — every wave actor and
vehicle destroyed, objective complete — and hands the mission back to the bot.

Usage: qa-act-route.py --act 2|3|4
"""
import argparse
import json
import time

from playwright.sync_api import sync_playwright

FORCE_DRONE = """() => {
  const w = BP.world;
  const d = w?.drone;
  if (!d?.active || d.complete) return false;
  for (const enemy of w.droneAssault?.actors || []) {
    if (!enemy.dead) enemy.damage(99999, w);
  }
  for (const vehicle of w.droneAssault?.vehicles || []) {
    if (!vehicle.dead) vehicle.damage?.(99999);
  }
  d.complete = true;
  return true;
}"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--act", type=int, required=True, choices=[2, 3, 4])
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop&qa=1")
    parser.add_argument("--budget", type=int, default=2400)
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--mute-audio"])
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.set_default_timeout(300000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.BP && !!window.QA")
        started = time.monotonic()
        page.evaluate(
            "(act) => QA.run(act, act, { difficulty: 0, god: true })", args.act)
        page.wait_for_function(
            "(act) => BP.world?.level?.id === act && BP.player", arg=args.act)
        page.evaluate("() => { BP.player.speed = 12; }")

        last_report = 0
        drone_kills = 0
        nudges = 0
        last_phase = (-1, -1)
        phase_since = time.monotonic()
        while time.monotonic() - started < args.budget:
            if page.evaluate(FORCE_DRONE):
                drone_kills += 1
            state = page.evaluate("""() => ({
              finished: QA_RESULTS.length > 0,
              won: !!BP.world?.won,
              objective: BP.world?.objectiveIdx,
              step: BP.world?.objectiveStepIdx,
              type: BP.objective?.type,
              waypoint: QA_STATE?.wpIdx,
              locked: !!BP.player?.locked,
              position: BP.player
                ? [BP.player.pos.x, BP.player.pos.y, BP.player.pos.z].map(v => +v.toFixed(1))
                : null,
              live: BP.world?.enemies.filter(e => !e.dead && !e.surrendered).length,
              pending: BP.world?.pendingActors?.enemies.length ?? 0,
              notes: QA_STATE?.notes.length,
            })""")
            if state["finished"]:
                break
            phase_key = (state["objective"], state["step"])
            if phase_key != last_phase:
                last_phase = phase_key
                phase_since = time.monotonic()
            elif time.monotonic() - phase_since > 120:
                # The act harness verifies seams, phase chaining and checkpoints; slow room
                # duels and tricky climbs are covered elsewhere. After two stalled minutes,
                # move the bot to what the CURRENT objective needs: the reach zone, the
                # device socket, or the fight it is grinding toward.
                page.evaluate("""() => {
                  const p = BP.player;
                  const obj = BP.objective;
                  if (obj?.type === 'reach' && obj.zone) {
                    p.pos.set(obj.zone[0], (obj.zone[3] ?? p.pos.y) + 0.2, obj.zone[1]);
                    return;
                  }
                  if (obj?.type === 'interact' || obj?.type === 'secure') {
                    const wanted = obj.device || obj.devices;
                    const ids = Array.isArray(wanted) ? wanted : wanted ? [wanted] : [];
                    const device = BP.world.objectiveDevices
                      .find(d => ids.includes(d.id) && !d.used);
                    if (device) {
                      p.pos.set(device.pos[0] + 1.2, (device.pos[1] ?? 0) + 0.1, device.pos[2]);
                      return;
                    }
                  }
                  if (p.locked) return;
                  const live = BP.world.enemies
                    .filter(e => !e.dead && !e.surrendered)
                    .sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
                  const target = live[0];
                  if (target) p.pos.set(target.pos.x + 2.2, target.pos.y + 0.1, target.pos.z);
                }""")
                nudges += 1
                phase_since = time.monotonic()
            elapsed = time.monotonic() - started
            if elapsed - last_report >= 20:
                print(json.dumps({"progress": round(elapsed), **state}), flush=True)
                last_report = elapsed
            page.wait_for_timeout(1000)

        result = page.evaluate("""() => ({
          won: !!BP.world?.won,
          objectiveIdx: BP.world?.objectiveIdx,
          objectiveStepIdx: BP.world?.objectiveStepIdx,
          objectives: BP.world?.level.objectives.length,
          rescued: BP.world?.stats.rescued,
          kills: BP.world?.stats.kills,
          civKills: BP.world?.stats.civKills,
          notes: [...(QA_STATE?.notes || [])],
          qaResults: [...QA_RESULTS],
        })""")
        result["elapsedSeconds"] = round(time.monotonic() - started, 2)
        result["droneSortiesResolved"] = drone_kills
        result["stallNudges"] = nudges
        result["errors"] = errors[:8]
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert result["won"], result
        assert result["qaResults"] and result["qaResults"][0]["result"] == "PASS", result
        # Bot trigger discipline in the market crowd is covered by qa-marketplace; the act
        # harness verifies structure, so allow the odd stray round.
        assert result["civKills"] <= 2, result
        browser.close()


if __name__ == "__main__":
    main()
