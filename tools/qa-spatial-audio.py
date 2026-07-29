#!/usr/bin/env python3
"""Verify desktop HRTF/reverb and the cheaper compatibility audio path."""
import argparse
import json

from playwright.sync_api import sync_playwright


def capture(page, url, mode):
    page.goto(
        f"{url}?renderer={mode}",
        wait_until="domcontentloaded",
        timeout=90000,
    )
    page.wait_for_function("() => !!window.BP", timeout=90000)
    return page.evaluate("""async () => {
      const audio = await import('./src/audio.js');
      audio.unlock();
      audio.sfx.enemyShot({ x: 8, y: 1.5, z: -12 });
      audio.startAmbient('tunnel');
      await new Promise(resolve => setTimeout(resolve, 450));
      const snapshot = audio.audioSnapshot();
      audio.stopAmbient();
      return snapshot;
    }""")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1200, "height": 800})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)

        desktop = capture(page, args.url, "desktop")
        compatibility = capture(page, args.url, "compatibility")
        result = {
            "desktop": desktop,
            "compatibility": compatibility,
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert desktop["initialized"], result
        assert desktop["rendererMode"] == "desktop", result
        assert desktop["panningModel"] == "HRTF", result
        assert desktop["reverb"] and desktop["reverbWet"] == 0.18, result
        assert compatibility["initialized"], result
        assert compatibility["rendererMode"] == "compatibility", result
        assert compatibility["panningModel"] == "equalpower", result
        assert not compatibility["reverb"] and compatibility["reverbWet"] == 0, result
        assert desktop["maxVoices"] == compatibility["maxVoices"] == 24, result
        browser.close()


if __name__ == "__main__":
    main()
