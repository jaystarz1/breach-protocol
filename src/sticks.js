// Analog flight sticks: a USB RC transmitter (EdgeTX/OpenTX joystick mode), a standard game
// pad, or the Quest Touch controllers inside a WebXR session. All three resolve to the same
// four Mode 2 channels the drone reads — throttle, yaw, pitch, roll — plus the action buttons,
// which are written straight into the shared `input` edge flags so every existing gate (FIRE
// to launch, R to skip a lesson, F to abort) works unchanged.
//
// Keyboard and mouse stay the default. A stick source becomes the active one the moment it is
// deliberately moved, and hands back to the keyboard as soon as a flight key is pressed.

import { load, save } from './save.js';
import { input } from './input.js';

export const CONTROL_DEFAULTS = {
  // auto: ANGLE when a stick source is active, ASSIST on keyboard. assist | angle | acro force it.
  flightMode: 'auto',
  // Betaflight-style "actual" rates in degrees/second: sensitivity at centre, rate at full stick.
  centerRate: 200,
  maxRate: 600,
  yawCenterRate: 150,
  yawMaxRate: 360,
  angleLimit: 55,      // ANGLE mode self-levels to at most this bank/pitch, degrees
  uptilt: 20,          // FPV camera tilt above the frame's thrust plane, degrees
  deadband: 0.04,
  vrScreen: 56,        // goggle screen width in the headset, degrees of view
  vrFeedRate: 'auto',  // auto | full | half — scene refresh inside the headset
  radio: null,         // calibration profile for a non-standard (RC transmitter) device
};

export function controls() {
  const S = load();
  S.controls = { ...CONTROL_DEFAULTS, ...(S.controls || {}) };
  return S.controls;
}

export function saveControls(patch = {}) {
  Object.assign(controls(), patch);
  save();
}

export const sticks = {
  active: false,
  source: 'none',      // none | gamepad | radio | xr
  label: '',
  calibrated: true,
  throttle: 0,         // radio: 0..1 absolute. gamepad/xr (sprung): -1..1 around hover
  sprung: true,
  yaw: 0,              // +1 = yaw right
  pitch: 0,            // +1 = stick forward (nose down)
  roll: 0,             // +1 = roll right
  gimbal: 0,           // payload camera tilt rate, +1 = tilt up
  moved: false,        // deliberate deflection this frame (cruise disengage)
  xrPointerHand: 'right',
};

const ACTIONS = ['fire', 'drop', 'thermal', 'interact', 'skip', 'cruise', 'pause'];
const previous = new Map();
let stickLast = -Infinity;
let keyboardLast = 0;
let lastAxes = null;

// A flight key or mouse look hands control back to the keyboard path immediately.
const KEYBOARD_FLIGHT = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyZ', 'KeyC',
]);
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', e => {
    if (KEYBOARD_FLIGHT.has(e.code)) keyboardLast = performance.now();
  });
  window.addEventListener('mousemove', e => {
    if (document.pointerLockElement && Math.abs(e.movementX) + Math.abs(e.movementY) > 2) {
      keyboardLast = performance.now();
    }
  });
}

const dead = (v, band) => (Math.abs(v) <= band ? 0 : Math.sign(v) * (Math.abs(v) - band) / (1 - band));
const clamp1 = v => Math.max(-1, Math.min(1, v));

function edge(key, pressed) {
  const was = previous.get(key) || false;
  previous.set(key, pressed);
  return pressed && !was;
}

function applyAction(action, held, key) {
  const pressed = edge(key, held);
  switch (action) {
    case 'fire':
      if (pressed) input.firePressed = true;
      input.stickFire = held;
      break;
    case 'drop': if (pressed) input.nadePressed = true; break;
    case 'thermal': if (pressed) input.nvgPressed = true; break;
    case 'interact': if (pressed) input.breachPressed = true; break;
    case 'skip': if (pressed) input.reloadPressed = true; break;
    case 'cruise': if (pressed) input.cruisePressed = true; break;
    case 'pause': if (pressed) input.pausePressed = true; break;
    default: break;
  }
}

const buttonHeld = b => !!(b && (b.pressed || b.value > 0.5));

// Raw devices for the calibration screen. Standard-mapped pads are game controllers;
// anything else that exposes four or more axes is treated as a transmitter.
export function rawGamepads() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
  return [...navigator.getGamepads()].filter(Boolean);
}

export function isRadio(pad) {
  return pad.mapping !== 'standard' && pad.axes.length >= 4;
}

// EdgeTX's default joystick layout is AETR: axes 0-3 = aileron, elevator, throttle, rudder.
const RADIO_GUESS = {
  roll: { i: 0, inv: false }, pitch: { i: 1, inv: false },
  throttle: { i: 2, inv: false, min: -1, max: 1 }, yaw: { i: 3, inv: false },
  actions: { fire: { kind: 'button', i: 0 } },
};

function readRadio(pad, profile) {
  const p = profile || RADIO_GUESS;
  const axis = ch => {
    const a = p[ch];
    if (!a || a.i >= pad.axes.length) return 0;
    let v = pad.axes[a.i];
    if (ch === 'throttle') {
      const min = a.min ?? -1, max = a.max ?? 1;
      v = (v - min) / Math.max(0.05, max - min);
      v = Math.max(0, Math.min(1, v));
      return a.inv ? 1 - v : v;
    }
    const centre = a.center ?? 0;
    const span = Math.max(0.2, a.span ?? 1);
    v = clamp1((v - centre) / span);
    return a.inv ? -v : v;
  };
  return {
    throttle: axis('throttle'), yaw: axis('yaw'), pitch: axis('pitch'), roll: axis('roll'),
    gimbal: p.gimbal ? axis('gimbal') : 0,
    actions: Object.fromEntries(Object.entries(p.actions || {}).map(([action, bind]) => {
      if (!bind) return [action, false];
      if (bind.kind === 'axis') {
        const v = pad.axes[bind.i] ?? 0;
        return [action, bind.above ? v > bind.thr : v < bind.thr];
      }
      return [action, buttonHeld(pad.buttons[bind.i])];
    })),
  };
}

function readStandard(pad) {
  const b = i => buttonHeld(pad.buttons[i]);
  return {
    throttle: -(pad.axes[1] || 0), yaw: pad.axes[0] || 0,
    roll: pad.axes[2] || 0, pitch: -(pad.axes[3] || 0),
    gimbal: (b(12) ? 1 : 0) - (b(13) ? 1 : 0),
    actions: {
      fire: b(0) || b(7), interact: b(1), drop: b(2) || b(6), thermal: b(3),
      skip: b(4), cruise: b(5), pause: b(9),
    },
  };
}

// Quest Touch, xr-standard mapping: axes[2/3] thumbstick, buttons 0 trigger, 1 grip,
// 3 stick click, 4 A/X, 5 B/Y. Left holds throttle/yaw, right holds pitch/roll (Mode 2).
function readXR(session) {
  let left = null, right = null;
  for (const source of session.inputSources || []) {
    if (!source.gamepad) continue;
    if (source.handedness === 'left') left = source.gamepad;
    else if (source.handedness === 'right') right = source.gamepad;
  }
  if (!left && !right) return null;
  const ax = (pad, i) => pad?.axes?.[i] || 0;
  const b = (pad, i) => buttonHeld(pad?.buttons?.[i]);
  const gimbalHeld = b(left, 1);
  return {
    throttle: -ax(left, 3), yaw: ax(left, 2),
    roll: ax(right, 2), pitch: gimbalHeld ? 0 : -ax(right, 3),
    gimbal: gimbalHeld ? -ax(right, 3) : 0,
    actions: {
      fire: b(right, 0), drop: b(left, 0), thermal: b(right, 4), interact: b(right, 5),
      cruise: b(left, 4), skip: b(left, 5), pause: b(left, 3),
    },
  };
}

// Called once per frame, before the drone update. `xrSession` is the live immersive session
// or null. Menu screens are driven by the XR laser pointer, so stick actions are suppressed
// there (`gameplay` false) to keep a trigger click from also launching an airframe.
export function pollSticks(xrSession = null, gameplay = true) {
  const cfg = controls();
  let reading = null;
  let source = 'none';
  let label = '';
  let calibrated = true;
  if (xrSession) {
    reading = readXR(xrSession);
    if (reading) { source = 'xr'; label = 'QUEST TOUCH'; }
  }
  if (!reading) {
    const pads = rawGamepads();
    const radio = pads.find(isRadio);
    const pad = pads.find(p => p.mapping === 'standard');
    if (radio) {
      const profile = cfg.radio?.id === radio.id ? cfg.radio : null;
      reading = readRadio(radio, profile);
      source = 'radio';
      label = radio.id.replace(/\s*\(.*\)\s*/g, ' ').trim().slice(0, 32) || 'RC TRANSMITTER';
      calibrated = !!profile;
    } else if (pad) {
      reading = readStandard(pad);
      source = 'gamepad';
      label = pad.id.replace(/\s*\(.*\)\s*/g, ' ').trim().slice(0, 32) || 'GAMEPAD';
    }
  }

  sticks.source = source;
  sticks.label = label;
  sticks.calibrated = calibrated;
  sticks.moved = false;
  if (!reading) {
    sticks.active = false;
    sticks.throttle = sticks.yaw = sticks.pitch = sticks.roll = sticks.gimbal = 0;
    lastAxes = null;
    input.stickFire = false;
    return sticks;
  }

  const band = cfg.deadband;
  const sprung = source !== 'radio';
  const axes = {
    throttle: sprung ? dead(clamp1(reading.throttle), band) : reading.throttle,
    yaw: dead(clamp1(reading.yaw), band),
    pitch: dead(clamp1(reading.pitch), band),
    roll: dead(clamp1(reading.roll), band),
    gimbal: dead(clamp1(reading.gimbal), band),
  };
  // Activity = a real change, not a resting transmitter's ADC noise or a parked throttle.
  const now = performance.now();
  const anyButton = Object.values(reading.actions).some(Boolean);
  if (lastAxes) {
    const delta = Math.max(...['throttle', 'yaw', 'pitch', 'roll'].map(k => Math.abs(axes[k] - lastAxes[k])));
    if (delta > 0.06 || anyButton) stickLast = now;
  }
  const deflected = Math.max(Math.abs(axes.yaw), Math.abs(axes.pitch), Math.abs(axes.roll),
    sprung ? Math.abs(axes.throttle) : 0) > 0.25;
  if (sprung && deflected) stickLast = now;
  lastAxes = axes;

  sticks.active = stickLast > keyboardLast;
  sticks.sprung = sprung;
  Object.assign(sticks, axes);
  if (sticks.active) {
    sticks.moved = Math.max(Math.abs(axes.yaw), Math.abs(axes.pitch), Math.abs(axes.roll)) > 0.3
      || (sprung && Math.abs(axes.throttle) > 0.35);
  }
  for (const action of ACTIONS) {
    const held = gameplay && !!reading.actions[action];
    if (held) { stickLast = now; sticks.active = stickLast > keyboardLast; }
    applyAction(action, held, `${source}:${action}`);
  }
  if (!gameplay) input.stickFire = false;
  return sticks;
}

// Which flight law the FPV uses this frame.
export function activeFlightMode() {
  const mode = controls().flightMode;
  if (mode === 'assist' || mode === 'angle' || mode === 'acro') {
    // A stick law needs sticks: on keyboard, ANGLE/ACRO fall back to the assisted law.
    return sticks.active ? mode : 'assist';
  }
  return sticks.active ? 'angle' : 'assist';
}
