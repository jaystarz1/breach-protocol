#!/usr/bin/env python3
"""Sticks, CRUISE and WebXR goggles.

1. CRUISE (T) on Deep Fence: autopilot engages, compresses time 4x, hands back on the search box.
2. Standard gamepad (injected navigator.getGamepads): ANGLE law holds a hover, levels on centre.
3. RC transmitter calibration wizard (non-standard pad, TAER order, inverted pitch/throttle).
4. WebXR goggles via tools/xr-mock.js: ENTER VR, laser click on a menu, Touch-stick flight.

Needs `python3 -m http.server 4179` in the repo root.
"""
import argparse, json, math, time
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:4179/")
args = parser.parse_args()
BASE = args.url.rstrip("/") + "/"
XR_MOCK = Path(__file__).with_name("xr-mock.js").read_text()
GPU = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
PAD = """
window.__pad = { id: 'QA Pad (STANDARD GAMEPAD)', mapping: 'standard', connected: true, index: 0,
  axes: [0,0,0,0], buttons: Array.from({length: 17}, () => ({pressed:false, value:0})), timestamp: 0 };
window.__padOn = false;
navigator.getGamepads = () => window.__padOn ? [window.__pad] : [];
"""
RADIO = """
window.__pad = { id: 'QA Radio Joystick (Vendor: 1209 Product: 4f54)', mapping: '', connected: true, index: 0,
  axes: [1,0,0,0,-1,-1], buttons: Array.from({length: 8}, () => ({pressed:false, value:0})), timestamp: 0 };
navigator.getGamepads = () => [window.__pad];
"""
STATE = """() => { const d = BP.world.drone; return { law: d.flightLaw, cruise: !!d.cruise, comp: d.timeCompression,
  y: +d.pos.y.toFixed(2), z: +d.pos.z.toFixed(1), kmh: Math.round(d.vel.length() * d.metersPerUnit * 3.6),
  pitch: +d.pitch.toFixed(2), att: d.attemptState, mode: document.querySelector('.fpv-mode')?.textContent }; }"""


def boot(page, lid):
    page.evaluate(f"() => BP.startLevel({lid})")
    page.wait_for_function(f"() => BP.mode === 'playing' && BP.world?.level?.id === {lid} && !!BP.world.drone", timeout=90000)
    time.sleep(1)
    page.evaluate("""() => { const d = BP.world.drone; d.groundFireLethality = 0; d.lessonQueue = [];
      d.attemptStateTime = 1; d.updateAttemptState(.1, { firePressed: true }); }""")
    time.sleep(0.3)


def main():
    results = {}
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=GPU)

        # 1-2: cruise and gamepad ANGLE
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.add_init_script(PAD)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE + "?renderer=desktop")
        page.wait_for_function("() => !!window.BP")
        boot(page, 20)
        page.keyboard.down("w"); time.sleep(1.2); page.keyboard.up("w")
        page.keyboard.press("t"); time.sleep(0.6)
        start = page.evaluate(STATE)
        time.sleep(4)
        moved = page.evaluate(STATE)
        results["cruise"] = {"start": start, "after": moved}
        assert start["cruise"] and start["comp"] == 4 and start["law"] == "cruise", start
        assert moved["z"] < start["z"] - 60 and moved["kmh"] > 95, moved
        page.keyboard.down("d"); time.sleep(0.25); page.keyboard.up("d"); time.sleep(0.2)
        assert not page.evaluate(STATE)["cruise"], "a flight key must hand control back"

        boot(page, 11)
        page.evaluate("() => { window.__padOn = true; window.__pad.axes = [0,-0.6,0,0]; }")
        time.sleep(1.5)
        climb = page.evaluate(STATE)
        page.evaluate("() => { window.__pad.axes = [0,0,0,0]; }")
        time.sleep(2.5)
        hover = page.evaluate(STATE)
        results["angle"] = {"climb": climb, "hover": hover}
        assert climb["law"] == "angle" and "GAMEPAD" in climb["mode"], climb
        assert climb["y"] > 1.5, climb
        assert abs(hover["pitch"] - 0.35) < 0.05 and hover["kmh"] < 25, hover
        page.close()

        # 3: transmitter calibration
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.add_init_script(RADIO)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE)
        page.wait_for_function("() => !!window.BP")
        ax = lambda v: (page.evaluate(f"() => {{ window.__pad.axes = {json.dumps(v)}; }}"), time.sleep(0.15))
        page.click("#menu-settings"); page.click("#settings-controls"); time.sleep(0.3)
        page.click("#ctl-calibrate"); time.sleep(0.2)
        ax([1, 0, 0, 0, -1, -1]); page.click("#ctl-wiz-next")
        for v in [1, -1, 1, -1, 1]:
            ax([v, 0, 0, 0, -1, -1])
        page.click("#ctl-wiz-next")
        ax([1, 0.98, 0, 0, -1, -1]); page.click("#ctl-wiz-next")
        ax([1, 0, -0.97, 0, -1, -1]); page.click("#ctl-wiz-next")
        ax([1, 0, 0, 0.99, -1, -1]); page.click("#ctl-wiz-next")
        time.sleep(1.0); ax([1, 0, 0, 0, 1, -1]); time.sleep(0.3)
        ax([1, 0, 0, 0, -1, -1]); time.sleep(0.2)
        for _ in range(5):
            page.click("#ctl-wiz-skip"); time.sleep(0.15)
        time.sleep(1.0); ax([1, 0, 0, 0, -1, 0.5]); time.sleep(0.3)
        profile = page.evaluate("() => JSON.parse(localStorage.getItem('breach-protocol-drone-save-v1')).controls.radio")
        results["radio"] = profile
        assert profile["throttle"]["i"] == 0 and profile["throttle"]["inv"], profile
        assert profile["yaw"]["i"] == 1 and profile["pitch"]["i"] == 2 and profile["pitch"]["inv"], profile
        assert profile["roll"]["i"] == 3 and profile["actions"]["fire"]["i"] == 4, profile
        assert "drop" not in profile["actions"], "a switch returning home must not bind the next action"
        assert profile["gimbal"]["i"] == 5, profile
        page.close()

        # 4: WebXR goggles
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.add_init_script(XR_MOCK)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE)
        page.wait_for_function("() => !!window.BP")
        time.sleep(0.8)
        assert page.is_visible("#vr-enter")
        page.click("#vr-enter"); time.sleep(1.5)
        assert page.evaluate("() => document.body.classList.contains('xr-presenting')")
        r = page.evaluate("() => { const b = document.getElementById('menu-levels').getBoundingClientRect(); return [b.left + b.width/2, b.top + b.height/2, innerWidth, innerHeight]; }")
        width = 2 * 2 * math.tan(math.radians(28))
        height = width * r[3] / r[2]
        tx, ty, tz = (r[0] / r[2] - 0.5) * width, 1.6 + (0.5 - r[1] / r[3]) * height, -2
        dx, dy, dz = tx - 0.12, ty - 1.45, tz + 0.2
        page.evaluate(f"() => {{ window.__xrAim = {{ yaw: {math.atan2(-dx, -dz)}, pitch: {math.atan2(dy, math.hypot(dx, dz))} }}; }}")
        time.sleep(0.6)
        page.evaluate("() => window.__xrSelect()")
        time.sleep(0.6)
        results["xr_menu"] = page.evaluate("() => document.querySelector('.screen.active')?.id")
        assert results["xr_menu"] == "screen-levels", results["xr_menu"]
        boot(page, 11)
        page.evaluate("() => { window.__xrSources.left.gamepad.axes[3] = -0.6; }")
        time.sleep(1.2)
        page.evaluate("() => { window.__xrSources.left.gamepad.axes[3] = 0; }")
        flight = page.evaluate(STATE)
        results["xr_flight"] = flight
        assert flight["law"] == "angle" and "TOUCH" in flight["mode"] and flight["y"] > 1.5, flight
        page.close()
        browser.close()
    print(json.dumps(results, indent=1))
    assert not errors, errors
    print("STICKS / CRUISE / XR QA PASSED")


if __name__ == "__main__":
    main()
