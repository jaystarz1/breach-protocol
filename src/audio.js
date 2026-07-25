// Procedural WebAudio SFX. No asset files.
let ctx = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlock() { ac(); }

function noiseBuffer(dur) {
  const a = ac();
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function playNoise({ dur = 0.15, vol = 0.5, freq = 1200, q = 0.8, decay = 30 }) {
  const a = ac();
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const filt = a.createBiquadFilter();
  filt.type = 'lowpass'; filt.frequency.value = freq; filt.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur * (30 / decay));
  src.connect(filt).connect(g).connect(a.destination);
  src.start();
}

function tone({ f0 = 200, f1 = 60, dur = 0.2, vol = 0.4, type = 'sine' }) {
  const a = ac();
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), a.currentTime + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start(); o.stop(a.currentTime + dur);
}

export const sfx = {
  pistol()  { playNoise({ dur: 0.12, vol: 0.55, freq: 2500 }); tone({ f0: 150, f1: 50, dur: 0.1, vol: 0.3, type: 'square' }); },
  rifle()   { playNoise({ dur: 0.1, vol: 0.5, freq: 3000 }); tone({ f0: 120, f1: 45, dur: 0.09, vol: 0.35, type: 'sawtooth' }); },
  sniper()  { playNoise({ dur: 0.5, vol: 0.9, freq: 1500, decay: 12 }); tone({ f0: 90, f1: 30, dur: 0.5, vol: 0.6, type: 'sawtooth' }); },
  enemyShot(dist) { const v = Math.max(0.05, 0.4 - dist * 0.006); playNoise({ dur: 0.1, vol: v, freq: 1800 }); },
  reload()  { tone({ f0: 900, f1: 500, dur: 0.06, vol: 0.2, type: 'square' }); setTimeout(() => tone({ f0: 600, f1: 900, dur: 0.06, vol: 0.2, type: 'square' }), 140); },
  empty()   { tone({ f0: 1200, f1: 900, dur: 0.05, vol: 0.15, type: 'square' }); },
  grenadeThrow() { playNoise({ dur: 0.08, vol: 0.15, freq: 800 }); },
  explosion() { playNoise({ dur: 0.9, vol: 1.0, freq: 400, decay: 8 }); tone({ f0: 70, f1: 25, dur: 0.8, vol: 0.7, type: 'sine' }); },
  breach()  { playNoise({ dur: 0.6, vol: 0.9, freq: 600, decay: 10 }); tone({ f0: 100, f1: 30, dur: 0.5, vol: 0.6, type: 'sine' }); },
  hit()     { tone({ f0: 1400, f1: 1000, dur: 0.05, vol: 0.22, type: 'sine' }); },
  kill()    { tone({ f0: 800, f1: 1300, dur: 0.09, vol: 0.25, type: 'sine' }); },
  hurt()    { tone({ f0: 200, f1: 80, dur: 0.25, vol: 0.4, type: 'sawtooth' }); },
  noShoot() { tone({ f0: 300, f1: 100, dur: 0.6, vol: 0.5, type: 'square' }); },
  objective() { tone({ f0: 600, f1: 900, dur: 0.12, vol: 0.25, type: 'sine' }); setTimeout(() => tone({ f0: 900, f1: 1200, dur: 0.15, vol: 0.25, type: 'sine' }), 130); },
  fail()    { tone({ f0: 300, f1: 60, dur: 1.0, vol: 0.5, type: 'sawtooth' }); },
  footstep() { playNoise({ dur: 0.05, vol: 0.06, freq: 500 }); },
  breathIn() { playNoise({ dur: 0.4, vol: 0.08, freq: 700, decay: 40 }); },
};
