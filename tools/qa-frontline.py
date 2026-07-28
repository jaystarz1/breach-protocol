#!/usr/bin/env python3
"""Visual and objective-flow smoke test for the Street Sweep frontline slice."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-frontline.png")
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(2)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.evaluate("""() => {
          BP.player.pos.set(0, 0, -49);
          BP.player.yaw = Math.PI;
          BP.player.pitch = 0.02;
        }""")
        page.wait_for_timeout(350)
        page.screenshot(path=args.output)

        page.evaluate("""() => {
          if (BP.world.reinf) BP.world.reinf.sent = BP.world.reinf.max;
          for (const enemy of BP.world.enemies) {
            enemy.dead = true;
            enemy.mesh.visible = false;
          }
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 1", timeout=5000)
        page.evaluate("""() => {
          const hold = setInterval(() => BP.player.pos.set(-11.2, 0.1, -41.6), 16);
          setTimeout(() => clearInterval(hold), 750);
        }""")
        page.wait_for_function(
            "() => BP.world.objectiveIdx === 2 && !!BP.world.drone", timeout=5000
        )
        drone_started = page.evaluate("""() => ({
          active: BP.world.drone.active,
          locked: BP.player.locked,
          targets: BP.world.drone.targets.length,
          overlay: !!document.querySelector('.drone-frame'),
        })""")
        output_path = Path(args.output)
        drone_path = output_path.with_name(f"{output_path.stem}-drone{output_path.suffix}")
        page.screenshot(path=str(drone_path))
        page.evaluate("""() => {
          for (const target of BP.world.drone.targets) target.marked = true;
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 3", timeout=5000)
        drone_finished = page.evaluate("""() => ({
          controllerDisposed: BP.world.drone === null,
          playerRestored: !BP.player.locked,
          overlayRemoved: !document.querySelector('.drone-frame'),
          mode: BP.mode,
        })""")

        output = {
            "screenshot": str(Path(args.output)),
            "droneScreenshot": str(drone_path),
            "droneStarted": drone_started,
            "droneFinished": drone_finished,
            "errors": errors[:8],
        }
        print(json.dumps(output, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
