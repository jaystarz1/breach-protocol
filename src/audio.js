import { quality } from './quality.js';

// Procedural WebAudio SFX with 3D positioning. No asset files.
let ctx = null;
let master = null;
let reverb = null;
let reverbWet = null;
let lastPanningModel = null;
let active = 0;                    // concurrent voice budget (mobile chokes past ~24)
const MAX_VOICES = 24;

function reverbImpulse(a) {
  const length = Math.floor(a.sampleRate * 1.25);
  const impulse = a.createBuffer(2, length, a.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Dense early reflections with a short controlled tail. This is deliberately not a
      // cathedral wash: it gives exterior rifle reports and tunnel impacts spatial size
      // without turning target direction into mud.
      data[i] = (Math.random() * 2 - 1) * (1 - t) ** 2.8;
    }
  }
  return impulse;
}

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    // iOS 16.4+: play through even when the ringer switch is on silent
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    if (quality.desktop) {
      reverb = ctx.createConvolver();
      reverb.buffer = reverbImpulse(ctx);
      reverbWet = ctx.createGain();
      reverbWet.gain.value = 0.07;
      reverb.connect(reverbWet).connect(ctx.destination);
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlock() {
  const a = ac();
  try {
    const b = a.createBuffer(1, 1, 22050);
    const s = a.createBufferSource();
    s.buffer = b; s.connect(a.destination); s.start(0);
  } catch {}
}

// ---------- Listener: follows the camera every frame ----------
export function updateListener(pos, yaw, pitch = 0) {
  if (!ctx) return;
  const l = ctx.listener;
  const cp = Math.cos(pitch);
  const fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
  if (l.positionX) {
    l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
    l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else {
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(fx, fy, fz, 0, 1, 0);
  }
}

// `at` = {x,y,z} world position, or null/undefined for a non-positional (first-person) sound
function sink(at) {
  const a = ac();
  if (!at) return master;
  const p = a.createPanner();
  // Desktop is now the product path: precise front/back and elevation cues are worth the
  // modest CPU cost. The retained compatibility renderer keeps equal-power panning.
  p.panningModel = quality.desktop ? 'HRTF' : 'equalpower';
  lastPanningModel = p.panningModel;
  p.distanceModel = 'inverse';
  p.refDistance = 5;
  p.maxDistance = 160;
  p.rolloffFactor = 1.3;
  if (p.positionX) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; }
  else p.setPosition(at.x, at.y, at.z);
  p.connect(master);
  if (reverb) p.connect(reverb);
  return p;
}

function budget() {
  if (active >= MAX_VOICES) return false;
  active++;
  return true;
}
function release(node, dur) {
  setTimeout(() => { active = Math.max(0, active - 1); try { node.disconnect(); } catch {} }, dur * 1000 + 60);
}

let noiseCache = null;
function noiseBuffer() {
  if (noiseCache) return noiseCache;
  const a = ac();
  const buf = a.createBuffer(1, a.sampleRate, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseCache = buf;
  return buf;
}

function playNoise({ dur = 0.15, vol = 0.5, freq = 1200, q = 0.8, decay = 30, at = null, type = 'lowpass' }) {
  if (!budget()) return;
  const a = ac();
  const src = a.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  const filt = a.createBiquadFilter();
  filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur * (30 / decay));
  const out = sink(at);
  src.connect(filt).connect(g).connect(out);
  src.start(0, Math.random() * 0.5);
  src.stop(a.currentTime + dur * (30 / decay) + 0.02);
  release(out === master ? g : out, dur);
}

function tone({ f0 = 200, f1 = 60, dur = 0.2, vol = 0.4, type = 'sine', at = null }) {
  if (!budget()) return;
  const a = ac();
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), a.currentTime + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  const out = sink(at);
  o.connect(g).connect(out);
  o.start(); o.stop(a.currentTime + dur);
  release(out === master ? g : out, dur);
}

// Stylized shout: band-passed noise with a formant sweep. Reads as a human bark, not a word.
function shout({ at, pitch = 1, vol = 0.5 }) {
  if (!budget()) return;
  const a = ac();
  const src = a.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  const f1 = a.createBiquadFilter();
  f1.type = 'bandpass'; f1.Q.value = 7;
  f1.frequency.setValueAtTime(600 * pitch, a.currentTime);
  f1.frequency.linearRampToValueAtTime(950 * pitch, a.currentTime + 0.12);
  f1.frequency.linearRampToValueAtTime(500 * pitch, a.currentTime + 0.3);
  const f2 = a.createBiquadFilter();
  f2.type = 'bandpass'; f2.Q.value = 9; f2.frequency.value = 1700 * pitch;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime(vol, a.currentTime + 0.04);
  g.gain.setValueAtTime(vol, a.currentTime + 0.2);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.34);
  const out = sink(at);
  src.connect(f1).connect(f2).connect(g).connect(out);
  src.start(0, Math.random() * 0.5);
  src.stop(a.currentTime + 0.36);
  release(out === master ? g : out, 0.36);
}

export const sfx = {
  // --- player weapons (first-person, non-positional) ---
  pistol()  { playNoise({ dur: 0.12, vol: 0.5, freq: 2500 }); tone({ f0: 150, f1: 50, dur: 0.1, vol: 0.28, type: 'square' }); },
  rifle()   { playNoise({ dur: 0.1, vol: 0.45, freq: 3000 }); tone({ f0: 120, f1: 45, dur: 0.09, vol: 0.32, type: 'sawtooth' }); },
  sniper()  { playNoise({ dur: 0.5, vol: 0.85, freq: 1500, decay: 12 }); tone({ f0: 90, f1: 30, dur: 0.5, vol: 0.55, type: 'sawtooth' }); },
  reload()  { tone({ f0: 900, f1: 500, dur: 0.06, vol: 0.2, type: 'square' }); setTimeout(() => tone({ f0: 600, f1: 900, dur: 0.06, vol: 0.2, type: 'square' }), 140); },
  empty()   { tone({ f0: 1200, f1: 900, dur: 0.05, vol: 0.15, type: 'square' }); },
  grenadeThrow() { playNoise({ dur: 0.08, vol: 0.15, freq: 800 }); },
  hurt()    { tone({ f0: 200, f1: 80, dur: 0.25, vol: 0.35, type: 'sawtooth' }); },
  hit()     { tone({ f0: 1400, f1: 1000, dur: 0.05, vol: 0.2, type: 'sine' }); },
  headshot() { tone({ f0: 1900, f1: 1300, dur: 0.09, vol: 0.3, type: 'sine' }); },
  kill()    { tone({ f0: 800, f1: 1300, dur: 0.09, vol: 0.22, type: 'sine' }); },
  noShoot() { tone({ f0: 300, f1: 100, dur: 0.6, vol: 0.45, type: 'square' }); },
  objective() { tone({ f0: 600, f1: 900, dur: 0.12, vol: 0.22, type: 'sine' }); setTimeout(() => tone({ f0: 900, f1: 1200, dur: 0.15, vol: 0.22, type: 'sine' }), 130); },
  fail()    { tone({ f0: 300, f1: 60, dur: 1.0, vol: 0.45, type: 'sawtooth' }); },
  breathIn() { playNoise({ dur: 0.4, vol: 0.08, freq: 700, decay: 40 }); },
  step()    { playNoise({ dur: 0.05, vol: 0.05, freq: 450 }); },

  // --- world sounds (positional) ---
  enemyShot(at) { playNoise({ dur: 0.11, vol: 1.5, freq: 2000, at }); tone({ f0: 130, f1: 50, dur: 0.09, vol: 0.8, type: 'square', at }); },
  enemyStep(at) { playNoise({ dur: 0.07, vol: 0.55, freq: 380, at }); },
  impact(at)  { playNoise({ dur: 0.07, vol: 0.7, freq: 3200, at, type: 'highpass' }); },
  flesh(at)   { playNoise({ dur: 0.09, vol: 0.9, freq: 500, at }); },
  ricochet(at) { tone({ f0: 2400 + Math.random() * 900, f1: 700, dur: 0.16, vol: 0.35, type: 'sawtooth', at }); },
  explosion(at) { playNoise({ dur: 0.9, vol: 2.2, freq: 400, decay: 8, at }); tone({ f0: 70, f1: 25, dur: 0.8, vol: 1.6, type: 'sine', at }); },
  breach(at)  { playNoise({ dur: 0.6, vol: 2.0, freq: 600, decay: 10, at }); tone({ f0: 100, f1: 30, dur: 0.5, vol: 1.3, type: 'sine', at }); },
  flashbang(at) { playNoise({ dur: 1.2, vol: 2.6, freq: 2600, decay: 7, at, type: 'highpass' }); tone({ f0: 200, f1: 40, dur: 0.6, vol: 1.2, type: 'square', at }); },
  tinnitus() { tone({ f0: 4200, f1: 3600, dur: 3.5, vol: 0.16, type: 'sine' }); },

  // --- voice ---
  contact(at) { shout({ at, pitch: 0.9 + Math.random() * 0.3, vol: 1.2 }); },
  civScream(at) { shout({ at, pitch: 1.7 + Math.random() * 0.4, vol: 0.9 }); },
  teamCall()  { shout({ at: null, pitch: 1.0, vol: 0.35 }); },
};

export function audioSnapshot() {
  return {
    initialized: !!ctx,
    rendererMode: quality.rendererMode,
    panningModel: lastPanningModel,
    reverb: !!reverb,
    reverbWet: reverbWet ? +reverbWet.gain.value.toFixed(3) : 0,
    activeVoices: active,
    maxVoices: MAX_VOICES,
  };
}

// ---------- Ambient bed: filtered noise + slow low drone, so silence isn't dead ----------
let ambient = null;
export function startAmbient(kind = 'urban') {
  stopAmbient();
  const a = ac();
  if (reverbWet) {
    const wet = kind === 'tunnel' ? 0.18 : 0.07;
    reverbWet.gain.cancelScheduledValues(a.currentTime);
    reverbWet.gain.linearRampToValueAtTime(wet, a.currentTime + 0.35);
  }
  const src = a.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  const filt = a.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = kind === 'tunnel' ? 220 : 380;
  filt.Q.value = 0.4;
  const g = a.createGain();
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(kind === 'tunnel' ? 0.035 : 0.02, a.currentTime + 3);
  const lfo = a.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoG = a.createGain();
  lfoG.gain.value = 0.012;
  lfo.connect(lfoG).connect(g.gain);
  src.connect(filt).connect(g).connect(master);
  src.start();
  lfo.start();
  const drone = a.createOscillator();
  drone.type = 'sine';
  drone.frequency.value = kind === 'tunnel' ? 44 : 58;
  const dg = a.createGain();
  dg.gain.value = 0;
  dg.gain.linearRampToValueAtTime(0.03, a.currentTime + 4);
  drone.connect(dg).connect(master);
  drone.start();
  ambient = { src, lfo, drone, g, dg };
}
export function stopAmbient() {
  if (!ambient) return;
  try { ambient.src.stop(); ambient.lfo.stop(); ambient.drone.stop(); } catch {}
  ambient = null;
}
