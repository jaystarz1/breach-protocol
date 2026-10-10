#!/usr/bin/env python3
"""KILL ZONE serial (25-27): nets, tear drops, fibre standby ambush, counter-ambush failure,
machine-vision terminal lock through dead video, and the turtle mobility kill.
Needs `python3 -m http.server 4179` in the repo root."""
import argparse, json, time
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:4179/?renderer=desktop")
parser.add_argument("--output", default="/private/tmp/bp-kill-zone")
args = parser.parse_args()
OUT = Path(args.output)
OUT.mkdir(parents=True, exist_ok=True)
LAUNCH = """() => { const d = BP.world.drone; d.groundFireLethality = 0; d.lessonQueue = []; d.lessonActive = false;
  d.attemptStateTime = 1; d.updateAttemptState(.1, { firePressed: true }); d.armTimer = 0; }"""
ST = """() => { const d = BP.world.drone; return { phase: BP.world.objectiveIdx, att: d.attemptState, reason: d.review?.reason || null, effect: d.review?.effect || null,
  law: d.flightLaw, mode: document.querySelector('.fpv-mode')?.textContent, dist: document.querySelector('.fpv-dist')?.textContent,
  pos: [d.pos.x, d.pos.y, d.pos.z].map(v => +v.toFixed(1)), signal: +d.signal.toFixed(2), batt: +d.battery.toFixed(2),
  comp: d.timeCompression, standby: d.standby, lock: d.terminal?.target?.label || null, nets: d.netBoxes.length,
  vehicles: d.combatVehicles.map(v => ({ l: v.label, dead: v.dead, x: +v.pos.x.toFixed(0), z: +v.pos.z.toFixed(0), r: v.route.length, sp: +v.speed.toFixed(2) })) }; }"""

def boot(page, lid, phase=0):
    page.evaluate(f"() => BP.startLevelAt({lid}, {phase})")
    page.wait_for_function(f"() => BP.mode === 'playing' && BP.world?.level?.id === {lid} && !!BP.world.drone && BP.world.objectiveIdx === {phase}", timeout=90000)
    time.sleep(0.8)
    page.evaluate(LAUNCH)
    time.sleep(0.3)

def st(page): return page.evaluate(ST)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(args.url)
    page.wait_for_function("() => !!window.BP")
    res = {}

    # 25a: nets exist; truck crosses the tunnel; net catch
    boot(page, 25, 0)
    s0 = st(page); res["25a_nets"] = s0["nets"]
    page.screenshot(path=str(OUT / "kz-25a-ready.png"))
    # put the aircraft over the tunnel and drive it down into the roof
    page.evaluate("""() => { const d = BP.world.drone; d.pos.set(-150, 9, 150); d.vel.set(0, 0, 0); }""")
    page.keyboard.down("c"); time.sleep(4); page.keyboard.up("c")
    s1 = st(page); res["25a_netcatch"] = [s1["reason"], s1["effect"]]
    # watch the truck emerge from the east mouth
    xs = []
    for _ in range(4):
        time.sleep(2)
        xs.append(st(page)["vehicles"][0]["x"])
    res["25a_truck_x"] = xs

    # 25b: dive through a tear onto a UGV as it passes under
    boot(page, 25, 1)
    tear = page.evaluate("""() => { const net = BP.world.drone.definition.nets[0]; const t = (net.tears[0][0] + net.tears[0][1]) / 2;
       return [net.from[0] + (net.to[0] - net.from[0]) * t, net.from[1] + (net.to[1] - net.from[1]) * t]; }""")
    # wait for UGV ONE to be close to the tear z
    page.evaluate(f"""() => {{ const d = BP.world.drone; const v = d.combatVehicles.find(v => v.label === 'CARGO UGV ONE');
       v.pos.z = {tear[1]} + 9; v.routeIdx = 1; d.pos.set({tear[0]}, 9, {tear[1]}); d.vel.set(0, 0, 0); d.armTimer = 0; d.pitch = -1.1; }}""")
    page.keyboard.down("c"); time.sleep(5); page.keyboard.up("c")
    for _ in range(12):
        time.sleep(0.5)
        if st(page)["att"] != "flying": break
    s2 = st(page); res["25b_tear_drop"] = [s2["reason"], s2["effect"], [v for v in s2["vehicles"] if v["l"] == "CARGO UGV ONE"]]
    page.screenshot(path=str(OUT / "kz-25b.png"))

    # 26a: fibre ambush: land, standby, compression, ETA, battery
    boot(page, 26, 0)
    page.evaluate("""() => { const d = BP.world.drone; d.pos.set(-80, 3, -100); d.vel.set(0, 0, 0); }""")
    page.keyboard.down("c"); time.sleep(4); page.keyboard.up("c"); time.sleep(1.0)
    s3 = st(page); res["26a_landed"] = page.evaluate("() => BP.world.drone.landed")
    page.keyboard.press("r"); time.sleep(0.4)
    s4 = st(page); res["26a_standby"] = [s4["standby"], s4["comp"], s4["mode"], s4["dist"].split("\n")[-1]]
    b0 = s4["batt"]; t0 = page.evaluate("() => BP.world.drone.missionFlightTime")
    time.sleep(3)
    b1 = st(page)["batt"]; t1 = page.evaluate("() => BP.world.drone.missionFlightTime")
    res["26a_wait"] = {"sim_s": round(t1 - t0, 1), "batt_used": round(b0 - b1, 3)}
    page.screenshot(path=str(OUT / "kz-26a-standby.png"))
    # jump the clock to the convoy and watch the alert drop compression
    page.evaluate("() => { BP.world.drone.missionFlightTime = 300; }")
    time.sleep(6)
    s5 = st(page); res["26a_convoy"] = [s5["comp"], s5["mode"], [v for v in s5["vehicles"] if v["l"] == "BTR-82A"]]
    page.screenshot(path=str(OUT / "kz-26a-convoy.png"))
    page.keyboard.down("w"); time.sleep(0.25); page.keyboard.up("w"); time.sleep(0.2)
    res["26a_woke"] = st(page)["standby"]

    # 26b: counter-ambush failure path: our UGV reaches a live ambush drone
    boot(page, 26, 1)
    page.evaluate("""() => { const d = BP.world.drone; d.missionFlightTime = 200; const u = d.combatVehicles.find(v => v.label === 'OUR UGV RUN'); u.pos.z = 228; u.routeIdx = 1; }""")
    for _ in range(20):
        time.sleep(0.6)
        if st(page)["att"] != "flying": break
    s6 = st(page); res["26b_fail"] = [s6["reason"], s6["effect"]]

    # 27a: lock, link dies, seeker completes
    boot(page, 27, 0)
    page.evaluate("""() => { const d = BP.world.drone; const v = d.combatVehicles[0]; d.pos.set(v.pos.x, v.pos.y + 14, v.pos.z + 118);
      d.vel.set(0, 0, 0); d.yaw = 0; d.pitch = -0.118; }""")
    time.sleep(0.4)
    page.keyboard.down("Space"); time.sleep(1.2); page.keyboard.up("Space")
    s7 = st(page); res["27a_lock"] = [s7["lock"], s7["mode"]]
    page.screenshot(path=str(OUT / "kz-27a-lock.png"))
    sig = []
    for _ in range(40):
        time.sleep(0.6)
        x = st(page); sig.append(x["signal"])
        if x["att"] != "flying": break
    s8 = st(page); res["27a_result"] = [s8["reason"], s8["effect"], sig]

    # 27b: turtle: locked strike = mobility kill; then rear strike kills
    boot(page, 27, 1)
    page.evaluate("""() => { const d = BP.world.drone; const v = d.combatVehicles.find(v => v.label.includes('TURTLE'));
      v.identified = true; d.pos.set(v.pos.x, v.pos.y + 10, v.pos.z - 70); d.vel.set(0, 0, 0); d.yaw = Math.PI; d.pitch = -0.14; }""")
    time.sleep(0.3)
    page.keyboard.down("Space"); time.sleep(1.2); page.keyboard.up("Space")
    for _ in range(40):
        time.sleep(0.6)
        if st(page)["att"] != "flying": break
    s9 = st(page); res["27b_first"] = [s9["reason"], s9["effect"], [v for v in s9["vehicles"] if 'TURTLE' in v["l"]]]
    page.screenshot(path=str(OUT / "kz-27b-first.png"))
    print(json.dumps(res, indent=1))
    b.close()
    assert res["25a_nets"] > 40, res["25a_nets"]
    assert res["25a_netcatch"][1] == "NETTED", res["25a_netcatch"]
    assert res["25b_tear_drop"][1] == "DESTROYED", res["25b_tear_drop"]
    assert res["26a_landed"] is True
    assert res["26a_standby"][0] is True and res["26a_standby"][1] == 6, res["26a_standby"]
    assert res["26a_standby"][3].startswith("CONVOY DUE"), res["26a_standby"]
    assert res["26a_wait"]["sim_s"] > 8 and res["26a_wait"]["batt_used"] < 0.4, res["26a_wait"]
    assert res["26a_woke"] is False, "any input must wake the standby aircraft"
    assert res["26b_fail"][1] == "ROAD NOT CLEARED", res["26b_fail"]
    assert res["27a_lock"][0] == "SCREENED HOWITZER", res["27a_lock"]
    assert res["27a_result"][1] == "DESTROYED" and min(res["27a_result"][2]) < 0.1, res["27a_result"]
    assert res["27b_first"][1] == "MOBILITY KILL" and res["27b_first"][2][0]["sp"] == 0, res["27b_first"]
    assert not errs, errs
    print("KILL ZONE QA PASSED")
