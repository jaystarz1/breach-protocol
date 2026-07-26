// Touch controls: left virtual stick, right look drag, action buttons.
// Desktop fallback: WASD + pointer lock mouse for testing.
export const input = {
  move: { x: 0, y: 0 },          // -1..1
  lookDelta: { x: 0, y: 0 },     // accumulated per-frame, consumed by player
  fire: false,                   // held
  firePressed: false,            // edge
  ads: false,
  reloadPressed: false,
  nadePressed: false,
  flashPressed: false,
  swapPressed: false,
  breachPressed: false,
  breath: false,
  pausePressed: false,
  crouch: false,
  leanLeft: false,
  leanRight: false,
  sensitivity: 1.0,
  sensScale: 1.0,        // set by main: lower while ADS, much lower while scoped
  invertY: false,
};

const el = id => document.getElementById(id);

// Touch-capable hybrids keep the thumb UI; only mouse-and-keyboard machines lose it.
export const isDesktop = !matchMedia('(pointer: coarse)').matches && !('ontouchstart' in window);

export function initInput() {
  if (isDesktop) document.body.classList.add('desktop');
  const stickZone = el('stick-zone');
  const lookZone = el('look-zone');
  const stickBase = el('stick-base');
  const stickNub = el('stick-nub');

  let stickTouch = null, stickOrigin = { x: 0, y: 0 };
  let lookTouch = null, lookLast = { x: 0, y: 0 };
  const STICK_R = 55;

  stickZone.addEventListener('touchstart', e => {
    e.preventDefault();
    el('move-hint').classList.add('off');
    const t = e.changedTouches[0];
    stickTouch = t.identifier;
    stickOrigin = { x: t.clientX, y: t.clientY };
    stickBase.style.display = 'block';
    stickNub.style.display = 'block';
    stickBase.style.left = (t.clientX - STICK_R) + 'px';
    stickBase.style.top = (t.clientY - STICK_R) + 'px';
    stickNub.style.left = (t.clientX - 24) + 'px';
    stickNub.style.top = (t.clientY - 24) + 'px';
  }, { passive: false });

  stickZone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== stickTouch) continue;
      let dx = t.clientX - stickOrigin.x, dy = t.clientY - stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > STICK_R) { dx = dx / len * STICK_R; dy = dy / len * STICK_R; }
      input.move.x = dx / STICK_R;
      input.move.y = dy / STICK_R;
      stickNub.style.left = (stickOrigin.x + dx - 24) + 'px';
      stickNub.style.top = (stickOrigin.y + dy - 24) + 'px';
    }
  }, { passive: false });

  const stickEnd = e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== stickTouch) continue;
      stickTouch = null;
      input.move.x = 0; input.move.y = 0;
      stickBase.style.display = 'none';
      stickNub.style.display = 'none';
    }
  };
  stickZone.addEventListener('touchend', stickEnd);
  stickZone.addEventListener('touchcancel', stickEnd);

  lookZone.addEventListener('touchstart', e => {
    e.preventDefault();
    el('aim-hint').classList.add('off');
    if (lookTouch !== null) return;
    const t = e.changedTouches[0];
    lookTouch = t.identifier;
    lookLast = { x: t.clientX, y: t.clientY };
  }, { passive: false });

  lookZone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== lookTouch) continue;
      input.lookDelta.x += (t.clientX - lookLast.x) * 0.0045 * input.sensitivity * input.sensScale;
      input.lookDelta.y += (t.clientY - lookLast.y) * 0.0045 * input.sensitivity * input.sensScale * (input.invertY ? -1 : 1);
      lookLast = { x: t.clientX, y: t.clientY };
    }
  }, { passive: false });

  const lookEnd = e => {
    for (const t of e.changedTouches) if (t.identifier === lookTouch) lookTouch = null;
  };
  lookZone.addEventListener('touchend', lookEnd);
  lookZone.addEventListener('touchcancel', lookEnd);

  // --- Buttons ---
  const hold = (id, on, off) => {
    const b = el(id);
    b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); b.classList.add('pressed'); on(); }, { passive: false });
    const end = e => { e.preventDefault(); b.classList.remove('pressed'); off && off(); };
    b.addEventListener('touchend', end);
    b.addEventListener('touchcancel', end);
    // mouse fallback
    b.addEventListener('mousedown', e => { e.stopPropagation(); on(); });
    b.addEventListener('mouseup', () => off && off());
  };

  hold('btn-fire', () => { input.fire = true; input.firePressed = true; }, () => { input.fire = false; });
  hold('btn-ads', () => { input.ads = !input.ads; });
  hold('btn-reload', () => { input.reloadPressed = true; });
  hold('btn-nade', () => { input.nadePressed = true; });
  hold('btn-flash', () => { input.flashPressed = true; });
  hold('btn-swap', () => { input.swapPressed = true; });
  hold('btn-breach', () => { input.breachPressed = true; });
  hold('btn-breath', () => { input.breath = true; }, () => { input.breath = false; });
  hold('btn-pause', () => { input.pausePressed = true; });
  hold('btn-crouch', () => { input.crouch = !input.crouch; el('btn-crouch').classList.toggle('latched', input.crouch); });
  hold('btn-lean-l', () => { input.leanLeft = true; }, () => { input.leanLeft = false; });
  hold('btn-lean-r', () => { input.leanRight = true; }, () => { input.leanRight = false; });
  el('btn-refresh').addEventListener('touchstart', e => { e.preventDefault(); location.reload(); }, { passive: false });
  el('btn-refresh').addEventListener('click', () => location.reload());
  const mr = el('menu-refresh');
  if (mr) mr.addEventListener('click', () => location.reload());

  // --- Desktop fallback ---
  const keys = {};
  window.addEventListener('keydown', e => {
    if (keys[e.code]) return;
    keys[e.code] = true;
    if (e.code === 'KeyR') input.reloadPressed = true;
    if (e.code === 'KeyG') input.nadePressed = true;
    if (e.code === 'KeyX') input.swapPressed = true;
    if (e.code === 'KeyF') input.breachPressed = true;
    if (e.code === 'KeyB') input.flashPressed = true;
    if (e.code === 'Escape' || e.code === 'KeyP') input.pausePressed = true;
    if (e.code === 'ShiftLeft') input.breath = true;
    if (e.code === 'ControlLeft' || e.code === 'KeyC') input.crouch = !input.crouch;
    if (e.code === 'KeyQ') input.leanLeft = true;
    if (e.code === 'KeyE') input.leanRight = true;
    updateKeyMove();
  });
  window.addEventListener('keyup', e => {
    keys[e.code] = false;
    if (e.code === 'ShiftLeft') input.breath = false;
    if (e.code === 'KeyQ') input.leanLeft = false;
    if (e.code === 'KeyE') input.leanRight = false;
    updateKeyMove();
  });
  function updateKeyMove() {
    let x = 0, y = 0;
    if (keys['KeyW'] || keys['ArrowUp']) y -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) y += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) x -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) x += 1;
    // don't clobber an active touch stick
    if (stickTouch === null) { input.move.x = x; input.move.y = y; }
  }

  const canvas = el('game-canvas');
  canvas.addEventListener('mousedown', e => {
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
    if (e.button === 0) { input.fire = true; input.firePressed = true; }
    if (e.button === 2) input.ads = !input.ads;
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) input.fire = false; });
  window.addEventListener('mousemove', e => {
    if (document.pointerLockElement !== canvas) return;
    // sensScale must apply here too, or ADS/scoped aim is full-speed on mouse.
    input.lookDelta.x += e.movementX * 0.0022 * input.sensitivity * input.sensScale;
    input.lookDelta.y += e.movementY * 0.0022 * input.sensitivity * input.sensScale * (input.invertY ? -1 : 1);
  });

  // Focus loss strands held keys/buttons: you tab away mid-sprint and come back walking.
  const releaseAll = () => {
    for (const k in keys) keys[k] = false;
    input.move.x = 0; input.move.y = 0;
    input.fire = false;
    input.breath = false;
    input.leanLeft = false; input.leanRight = false;
  };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas) releaseAll();
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

// Call at end of each frame to clear edge-triggered flags.
export function clearEdges() {
  input.firePressed = false;
  input.reloadPressed = false;
  input.nadePressed = false;
  input.flashPressed = false;
  input.swapPressed = false;
  input.breachPressed = false;
  input.pausePressed = false;
  input.lookDelta.x = 0;
  input.lookDelta.y = 0;
}
