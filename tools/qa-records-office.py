#!/usr/bin/env python3
"""Capture and verify Mission 8's rebuilt records office and EW objective."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-records-office")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(108)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(300)

        result = page.evaluate("""() => {
          const scene = BP.world.staticMesh.parent;
          const stats = scene.userData.interiorMissionStats;
          const glass = [];
          scene.traverse(object => {
            const materials = Array.isArray(object.material)
              ? object.material : [object.material];
            for (const material of materials) {
              if (material?.name === 'records-architectural-glass') {
                glass.push({
                  transparent: material.transparent,
                  opacity: material.opacity,
                  depthWrite: material.depthWrite,
                });
              }
            }
          });
          for (const actor of [
            ...BP.world.enemies, ...BP.world.allies, ...BP.world.civilians,
          ]) actor.update = () => {};
          BP.player.health = 100000;
          BP.weapons.holder.visible = false;
          return {
            art: stats,
            glass,
            calls: BP.performance.render.calls,
            triangles: BP.performance.render.triangles,
            programs: BP.performance.resources.programs,
          };
        }""")

        shots = [
            ("entry-depth.png", 0, 18, 0, -0.02),
            ("insertion-vestibule.png", 0, 23, 3.1416, -0.02),
            ("operations-floor.png", -8, 14, -0.72, -0.02),
            ("authored-desk.png", 0, 9, 0, 0.08),
            ("archive-aisles.png", -8.5, -8.2, 1.55, 0.02),
            ("jammer-objective.png", 0, -16.4, 0, 0.04),
        ]
        for name, x, z, yaw, pitch in shots:
            page.evaluate(
                """([x, z, yaw, pitch]) => {
                  BP.player.pos.set(x, 0, z);
                  BP.player.yaw = yaw;
                  BP.player.pitch = pitch;
                }""",
                [x, z, yaw, pitch],
            )
            page.wait_for_timeout(180)
            page.screenshot(path=str(output / name))

        result.update({
            "screenshots": [shot[0] for shot in shots],
            "errors": errors[:8],
        })
        print(json.dumps(result, indent=2))

        batches = result["art"]["batches"]
        assert not errors, result
        assert result["art"]["levelId"] == 8, result
        assert result["art"]["instances"] >= 600, result
        assert result["glass"], result
        assert all(
            row["transparent"] and row["opacity"] < 0.4 and not row["depthWrite"]
            for row in result["glass"]
        ), result
        assert batches.get("records-partition-rails", 0) == 48, result
        assert batches.get("records-partition-mullions", 0) == 57, result
        assert batches.get("records-desk-tops", 0) == 8, result
        assert batches.get("records-desk-pedestals", 0) == 8, result
        assert batches.get("records-desk-legs", 0) == 16, result
        assert batches.get("records-archive-shelves", 0) == 15, result
        assert batches.get("records-archive-boxes", 0) == 48, result
        assert batches.get("records-jammer-body", 0) == 1, result
        assert batches.get("records-jammer-screen", 0) == 1, result
        assert batches.get("records-jammer-antennas", 0) == 2, result
        assert batches.get("records-jammer-vents", 0) == 6, result
        assert batches.get("records-jammer-handles", 0) == 2, result
        assert batches.get("records-jammer-floor-cables", 0) == 2, result
        assert batches.get("records-floor-grime", 0) == 4, result
        assert batches.get("records-dangling-ceiling-panels", 0) == 4, result
        assert batches.get("records-vestibule-bench-slats", 0) == 6, result
        assert batches.get("records-vestibule-bench-legs", 0) == 2, result
        assert batches.get("records-vestibule-locker", 0) == 1, result
        assert batches.get("records-vestibule-hooks", 0) == 4, result
        assert result["calls"] < 140, result
        assert result["triangles"] < 200_000, result
        browser.close()


if __name__ == "__main__":
    main()
