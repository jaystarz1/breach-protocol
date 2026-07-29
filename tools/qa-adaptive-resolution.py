#!/usr/bin/env python3
"""Verify deterministic desktop resolution scaling and explicit fixed-scale overrides."""
import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(
            viewport={"width": 1200, "height": 800},
            device_scale_factor=2,
        )
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)

        page.goto(f"{args.url}?renderer=desktop", wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        controller = page.evaluate("""async () => {
          const { createAdaptiveResolutionController } =
            await import('./src/renderer/adaptive-resolution.js');
          const governor = createAdaptiveResolutionController({
            sampleFrames: 4,
            downCooldownFrames: 0,
            upCooldownFrames: 0,
            recoveryWindows: 2,
          });
          const events = [];
          for (let i = 0; i < 4; i++) {
            const event = governor.sample(30);
            if (event) events.push(event);
          }
          for (let i = 0; i < 4; i++) {
            const event = governor.sample(31);
            if (event) events.push(event);
          }
          for (let window = 0; window < 2; window++) {
            for (let i = 0; i < 4; i++) {
              const event = governor.sample(16.7);
              if (event) events.push(event);
            }
          }

          const interrupted = createAdaptiveResolutionController({
            sampleFrames: 4,
            downCooldownFrames: 0,
          });
          interrupted.sample(30);
          interrupted.sample(30);
          interrupted.sample(30, false);
          interrupted.sample(30);
          interrupted.sample(30);

          return {
            events,
            final: governor.snapshot(),
            interrupted: interrupted.snapshot(),
            runtime: BP.performance.resolution,
          };
        }""")

        page.goto(
            f"{args.url}?renderer=desktop&resolution=0.8",
            wait_until="domcontentloaded",
            timeout=90000,
        )
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.wait_for_timeout(100)
        fixed = page.evaluate("""() => ({
          resolution: BP.performance.resolution,
          pixelRatio: BP.performance.pixelRatio,
          drawingBuffer: BP.performance.drawingBuffer,
        })""")

        result = {"controller": controller, "fixed": fixed, "errors": errors[:8]}
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert [event["direction"] for event in controller["events"]] == [
            "down", "down", "up"
        ], result
        assert [event["scale"] for event in controller["events"]] == [0.9, 0.8, 0.85], result
        assert controller["final"]["scale"] == 0.85, result
        assert controller["interrupted"]["scale"] == 1, result
        assert controller["runtime"]["enabled"], result
        assert controller["runtime"]["scale"] == 1, result
        assert fixed["resolution"] == {
            "enabled": False,
            "scale": 0.8,
            "minScale": 0.7,
            "maxScale": 0.8,
            "p95": 0,
        }, result
        assert fixed["pixelRatio"] == 1.6, result
        assert fixed["drawingBuffer"] == [1920, 1280], result
        browser.close()


if __name__ == "__main__":
    main()
