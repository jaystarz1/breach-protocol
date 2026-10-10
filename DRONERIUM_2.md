# Dronerium 2.0

Status: built 2026-10-10 on `desktop-rebuild`. Dronerium is `index.html` (chapters 01-17, mission
ids 11-27). Everything below ships on the same web page; there is no separate VR build.

## Flight laws

| Law | Who flies it | Model |
|---|---|---|
| ASSIST | keyboard + mouse (default) | the original camera-coupled law: point, push W |
| ANGLE | any stick source (AUTO default) | thrust-vector quad, self-levelling, stick sets tilt |
| ACRO | stick pilots who choose it | Betaflight-style rates, nothing self-levels |

Stick laws fly a real quad in metres: thrust along the frame's up axis, gravity, quadratic drag
sized to the airframe's top speed (`stickTopSpeed`, ~97 km/h for the strike quad), camera uptilt
(default 20°). A self-centring throttle (pad, Touch) means centre = hover; ANGLE also compensates
for tilt so a level push holds altitude. A radio throttle is absolute. The payload hex stays a
stabilized platform under every law. Code: `flyStickLaw`, `flyAssisted` in `src/drone.js`.

## Input sources (`src/sticks.js`)

- **Gamepad** (standard mapping), Mode 2. A launch/next, B abort, X drop, Y thermal, LB skip lesson
  / standby, RB cruise, D-pad gimbal.
- **RC transmitter** over USB joystick (HID). Settings > Controls > CALIBRATE: rest, throttle travel,
  yaw, pitch, roll, then switches for FIRE/DROP/THERMAL/CRUISE/ABORT and an optional gimbal knob.
  Uncalibrated radios use the EdgeTX AETR default.
- **Quest Touch** inside WebXR: left stick throttle+yaw, right stick pitch+roll, right trigger
  fire, left trigger drop, A thermal, B abort, X cruise, Y skip/standby, left grip + right stick gimbal,
  left stick click pause.
- Keyboard stays authoritative: any flight key hands control back from sticks.

## CRUISE (T / RB / X)

Transit autopilot for the empty ingress. Flies the briefed route (or straight) to the search box at
108 km/h, ~30 m AGL terrain-following, with the sim at 4x. Battery drains at the true rate. Hands
back on: any stick/key, entering the search area, hostile within ~330 m, jamming (LQ < 55), ground
fire, cable warning, battery < 22 %. Bomber egress cruises home. Not available on the fibre cable course (chapter 06), where hand-flying the line is the lesson.

## WebXR goggle mode (`src/xr/`)

ENTER VR appears on menu screens when the browser supports `immersive-vr`. The headset shows one
head-locked goggle screen (default 56° wide, adjustable) in a dark void:

- the feed is rendered mono into a 1280 px target and run through the same analog/thermal shader
  as the monitor (`createFeedPostMaterial`), at half rate on Quest (analog 36 fps), full elsewhere;
- `dom-mirror.js` paints the page's HTML (OSD, lesson cards, debriefs, menus) onto a canvas at
  24 Hz, so the DOM stays the single source of truth;
- the right controller is a laser pointer whenever a menu screen is up; trigger = click.

Quest Browser defaults the renderer to COMPATIBILITY (Settings > Graphics can force DESKTOP).

### Testing on the Quest 2

1. Push the branch / deploy, open the site in Quest Browser.
2. Settings > Controls: check the Touch sticks move the two gimbal dots.
3. Tap ENTER VR. Laser + trigger through Chapter Select into Chapter 01.
4. Watch frame pacing in the first chapter, then a busy one (Deep Fence). If it judders, set
   VR FEED REFRESH to HALF and Graphics to COMPATIBILITY; if it's smooth, try DESKTOP.

## KILL ZONE serial (chapters 15-17, ids 25-27)

| Id | Chapter | Teaches |
|---|---|---|
| 25 | NET ROAD | anti-drone netting over roads (net = airframe lost); strike at the tunnel mouth; drop through torn roof onto UGVs |
| 26 | LIE IN WAIT | fibre FPV lands on the verge, R = STANDBY (motors safe, x6 time until movement), kill the BTR; then clear three hostile ambush drones before our UGV run departs |
| 27 | LAST MILE | machine-vision terminal lock (hold FIRE) finishes the run through dead video; turtle tank double tap (running gear, then open rear) with a vehicle-mounted EW dome |

Engine features, all authored per sortie: `nets`, `terminalGuidance` + `lockRange`, `standbyHint`,
vehicle `startDelay` + `etaLabel`, `ambushRadius`, `immobilizeOnHit`, jammer `follow`, target kinds
`ugv`, `turtle`, `parkedfpv`.

## QA

- `tools/qa-kill-zone.py`: nets, tear drop, standby, counter-ambush failure, seeker kill, turtle.
- `tools/qa-sticks-xr.py`: CRUISE, gamepad ANGLE, radio calibration, WebXR mock (`tools/xr-mock.js`).
- Existing: `qa-flight-school.py`, `qa-drone-interdiction.py`, `qa-drone-campaign.py`, `qa-all-levels.py`.
