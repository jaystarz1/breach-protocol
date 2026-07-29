#!/usr/bin/env python3
"""Verify that panicked civilians path to real occluding geometry before cowering."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-civilian-hard-cover")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(2)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)

        result = page.evaluate("""async () => {
          const { hasLOS } = await import('./src/physics.js');
          BP.player.locked = true;
          BP.player.health = 100000;
          const actor = BP.world.civilians.find(civilian => !civilian.hostage);
          actor.rush = false;
          actor.panic = true;
          actor.coverSearchAt = 0;
          actor.exhausted = 0;
          const start = actor.pos.clone();
          let frames = 0;
          while (!actor.inHardCover && frames++ < 320) {
            actor.update(0.04, BP.world);
          }
          for (let frame = 0; frame < 25; frame++) actor.update(0.04, BP.world);
          const target = actor.coverTarget && {
            x: actor.coverTarget.x,
            y: actor.coverTarget.y,
            z: actor.coverTarget.z,
          };
          const hidden = !hasLOS(
            BP.world.solids,
            actor.pos.x, actor.pos.y + 0.72, actor.pos.z,
            BP.player.pos.x, BP.player.pos.y + 1.5, BP.player.pos.z);
          const rig = actor.mesh.userData.rig;
          return {
            selected: actor.coverSearchDone,
            target,
            frames,
            arrived: actor.inHardCover,
            hidden,
            moved: +actor.pos.distanceTo(start).toFixed(2),
            remaining: target
              ? +Math.hypot(actor.pos.x - target.x, actor.pos.z - target.z).toFixed(2)
              : null,
            coverAmount: actor.prone,
            rootPitch: actor.mesh.rotation.x,
            visualDrop: rig.authored ? +(rig.baseVisualY - rig.visual.position.y).toFixed(2) : 0,
          };
        }""")
        page.evaluate("""() => {
          const actor = BP.world.civilians.find(civilian => civilian.inHardCover);
          BP.player.pos.set(actor.pos.x, actor.pos.y, actor.pos.z + 5);
          BP.player.yaw = 0;
          BP.player.pitch = -0.08;
          BP.weapons.holder.visible = false;
        }""")
        page.wait_for_timeout(120)
        page.screenshot(path=str(output / "civilian-behind-cover.png"))

        page.evaluate("() => BP.startLevel(5)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        crowd = page.evaluate("""() => {
          const actors = BP.world.civilians.filter(actor => !actor.hostage);
          const durations = [];
          const started = performance.now();
          for (const actor of actors) {
            actor.rush = false;
            const before = performance.now();
            actor.findHardCover(BP.world);
            durations.push(performance.now() - before);
          }
          const targets = actors
            .filter(actor => actor.coverTarget)
            .map(actor => `${actor.coverTarget.x.toFixed(1)}:${actor.coverTarget.z.toFixed(1)}`);
          return {
            actors: actors.length,
            selected: targets.length,
            uniqueTargets: new Set(targets).size,
            totalMs: +(performance.now() - started).toFixed(2),
            maxMs: +Math.max(...durations).toFixed(2),
          };
        }""")

        report = {
            "cover": result,
            "crowdSelection": crowd,
            "errors": errors[:8],
            "screenshot": "civilian-behind-cover.png",
        }
        print(json.dumps(report, indent=2))
        assert not errors, report
        assert result["selected"] and result["target"], report
        assert result["arrived"] and result["frames"] < 320, report
        assert result["hidden"], report
        assert result["moved"] > 1.5 and result["remaining"] < 1.0, report
        assert result["coverAmount"] == 1 and abs(result["rootPitch"]) < 0.01, report
        assert result["visualDrop"] > 0.45, report
        assert crowd["selected"] >= crowd["actors"] * 0.4, report
        assert crowd["uniqueTargets"] >= crowd["selected"] * 0.75, report
        assert crowd["totalMs"] < 45 and crowd["maxMs"] < 12, report
        browser.close()


if __name__ == "__main__":
    main()
