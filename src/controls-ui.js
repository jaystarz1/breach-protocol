// Settings > CONTROLS: the stick setup page every FPV trainer has. Live stick view, flight
// law, rates, camera uptilt, the RC transmitter calibration wizard and the VR goggle screen.
// Built here rather than in the HTML so both game pages keep byte-identical markup; only the
// drone game mounts it.

import { controls, saveControls, sticks, rawGamepads, isRadio } from './sticks.js';
import { hud } from './hud.js';

const LAWS = [
  ['auto', 'AUTO', 'ANGLE on sticks, assisted on keyboard.'],
  ['assist', 'ASSIST', 'The keyboard law: point the camera, push to fly. Sticks steer it like a game.'],
  ['angle', 'ANGLE', 'Self-levelling. Stick deflection sets the tilt; centre the stick and it levels out.'],
  ['acro', 'ACRO', 'Rate mode, how strike pilots fly. The stick sets the rotation rate and nothing self-levels.'],
];

const SLIDERS = [
  ['centerRate', 'Centre rate', 80, 400, 10, '°/s'],
  ['maxRate', 'Max rate', 250, 1000, 10, '°/s'],
  ['angleLimit', 'Angle limit', 25, 75, 1, '°'],
  ['uptilt', 'Camera uptilt', 0, 45, 1, '°'],
  ['deadband', 'Stick deadband', 0, 0.15, 0.01, ''],
  ['vrScreen', 'VR screen width', 40, 80, 1, '°'],
];

const ACTION_BINDS = [
  ['fire', 'FIRE / LAUNCH / NEXT'],
  ['drop', 'DROP (bomber)'],
  ['thermal', 'THERMAL'],
  ['cruise', 'CRUISE'],
  ['interact', 'ABORT / INTERACT'],
  ['skip', 'SKIP LESSON / STANDBY (landed)'],
  ['gimbal', 'GIMBAL TILT (bomber camera): move a slider or knob'],
];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

export function mountControlsScreen() {
  const settings = document.getElementById('screen-settings');
  const back = document.getElementById('settings-back');
  if (!settings || !back || document.getElementById('screen-controls')) return;
  const open = el('button', {
    class: 'menu-btn', id: 'settings-controls', text: 'CONTROLS: STICKS, RADIO, VR',
    onclick: () => { hud.screen('controls'); paint(); },
  });
  open.style.marginTop = '14px';
  settings.insertBefore(open, back);

  const screen = el('div', { class: 'screen', id: 'screen-controls' });
  screen.innerHTML = `
    <h1 class="logo" style="font-size:22px">CONTROLS</h1>
    <div class="ctl-device" id="ctl-device"></div>
    <canvas id="ctl-sticks" width="360" height="150"></canvas>
    <div class="ctl-label">FLIGHT LAW</div>
    <div class="diff-row" id="ctl-laws"></div>
    <div class="ctl-note" id="ctl-law-note"></div>
    <div class="ctl-sliders" id="ctl-sliders"></div>
    <div class="ctl-label">VR FEED REFRESH</div>
    <div class="diff-row" id="ctl-feed"></div>
    <button class="menu-btn" id="ctl-calibrate">CALIBRATE RC TRANSMITTER</button>
    <div class="ctl-wizard" id="ctl-wizard" hidden>
      <div class="ctl-wiz-step" id="ctl-wiz-step"></div>
      <div class="ctl-wiz-text" id="ctl-wiz-text"></div>
      <div class="ctl-wiz-live" id="ctl-wiz-live"></div>
      <div class="ctl-wiz-buttons">
        <button class="menu-btn primary" id="ctl-wiz-next">NEXT</button>
        <button class="menu-btn" id="ctl-wiz-skip">SKIP</button>
        <button class="menu-btn" id="ctl-wiz-cancel">CANCEL</button>
      </div>
    </div>
    <div class="ctl-note ctl-map">
      KEYBOARD: WASD fly · mouse look · Z/RMB climb · C/CTRL descend · N thermal · T cruise · G drop<br>
      GAMEPAD (Mode 2): left stick throttle+yaw · right stick pitch+roll · A launch/next · Y thermal · RB cruise · B abort · X drop · LB skip lesson<br>
      QUEST TOUCH: left stick throttle+yaw · right stick pitch+roll · right trigger launch/next · A thermal · B abort · X cruise · Y skip · left trigger drop · left grip + right stick gimbal · left stick click pause<br>
      RC TRANSMITTER: set the radio to USB joystick (HID) mode, then calibrate once.
    </div>
    <button class="menu-btn" id="ctl-back" style="margin-top:14px">BACK</button>
  `;
  document.body.appendChild(screen);
  screen.querySelector('#ctl-back').onclick = () => { stopWizard(); hud.screen('settings'); };
  screen.querySelector('#ctl-calibrate').onclick = startWizard;

  const sliderBox = screen.querySelector('#ctl-sliders');
  for (const [key, label, min, max, step, unit] of SLIDERS) {
    const value = el('span', { class: 'ctl-value' });
    const range = el('input', { type: 'range', min, max, step });
    range.oninput = () => {
      saveControls({ [key]: parseFloat(range.value) });
      value.textContent = `${range.value}${unit}`;
    };
    sliderBox.appendChild(el('div', { class: 'sens-row ctl-row', 'data-key': key },
      el('span', { class: 'ctl-name', text: label }), range, value));
  }

  function paint() {
    const cfg = controls();
    const laws = screen.querySelector('#ctl-laws');
    laws.innerHTML = '';
    for (const [id, name] of LAWS) {
      laws.appendChild(el('div', {
        class: 'diff-pill' + (cfg.flightMode === id ? ' sel' : ''), text: name,
        onclick: () => { saveControls({ flightMode: id }); paint(); },
      }));
    }
    screen.querySelector('#ctl-law-note').textContent = LAWS.find(l => l[0] === cfg.flightMode)?.[2] || '';
    const feed = screen.querySelector('#ctl-feed');
    feed.innerHTML = '';
    for (const [id, name] of [['auto', 'AUTO'], ['full', 'FULL RATE'], ['half', 'HALF RATE (ANALOG 36 FPS)']]) {
      feed.appendChild(el('div', {
        class: 'diff-pill' + (cfg.vrFeedRate === id ? ' sel' : ''), text: name,
        onclick: () => { saveControls({ vrFeedRate: id }); paint(); },
      }));
    }
    for (const row of sliderBox.children) {
      const key = row.dataset.key;
      const def = SLIDERS.find(s => s[0] === key);
      row.querySelector('input').value = cfg[key];
      row.querySelector('.ctl-value').textContent = `${cfg[key]}${def[5]}`;
    }
  }

  // ---- live view ----
  const canvas = screen.querySelector('#ctl-sticks');
  const ctx = canvas.getContext('2d');
  function drawGimbal(cx, x, y, label) {
    const r = 56, cy = 72;
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath(); ctx.arc(cx + x * r, cy - y * r, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#90a4ae';
    ctx.font = '700 10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy + r + 15);
  }
  function tick() {
    if (!screen.classList.contains('active')) { requestAnimationFrame(tick); return; }
    const device = screen.querySelector('#ctl-device');
    if (sticks.source === 'none') {
      device.textContent = 'NO STICKS DETECTED: connect a gamepad or an RC transmitter in USB joystick mode, then move a stick.';
    } else {
      const radioNote = sticks.source === 'radio' && !sticks.calibrated ? ': NOT CALIBRATED (using EdgeTX default AETR)' : '';
      device.textContent = `${sticks.source === 'xr' ? 'QUEST TOUCH' : sticks.source.toUpperCase()}: ${sticks.label}${radioNote}`;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const throttle = sticks.sprung ? sticks.throttle : sticks.throttle * 2 - 1;
    drawGimbal(90, sticks.yaw, throttle, 'THROTTLE / YAW');
    drawGimbal(270, sticks.roll, sticks.pitch, 'PITCH / ROLL');
    if (wizard) updateWizard();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- RC transmitter calibration ----
  let wizard = null;
  const STEPS = [
    { id: 'rest', title: 'STEP 1 / 6: REST', text: 'Centre pitch, roll and yaw. Put the THROTTLE fully DOWN. Press NEXT.' },
    { id: 'throttle', title: 'STEP 2 / 6: THROTTLE', text: 'Move the THROTTLE fully up and fully down twice. Leave it DOWN. Press NEXT.' },
    { id: 'yaw', title: 'STEP 3 / 6: YAW', text: 'Hold YAW (rudder) fully RIGHT. Press NEXT while holding.' },
    { id: 'pitch', title: 'STEP 4 / 6: PITCH', text: 'Hold PITCH (elevator) fully FORWARD / UP. Press NEXT while holding.' },
    { id: 'roll', title: 'STEP 5 / 6: ROLL', text: 'Hold ROLL (aileron) fully RIGHT. Press NEXT while holding.' },
    { id: 'switches', title: 'STEP 6 / 6: SWITCHES AND KNOB', text: '' },
  ];
  const $w = id => screen.querySelector(id);

  function startWizard() {
    const pad = rawGamepads().find(isRadio);
    if (!pad) {
      $w('#ctl-device').textContent = 'NO TRANSMITTER FOUND: set the radio to USB joystick mode, plug it in, move a stick, then try again.';
      return;
    }
    wizard = { padIndex: pad.index, id: pad.id, step: 0, rest: null, min: [], max: [], profile: { id: pad.id, actions: {} }, used: new Set(), bind: 0 };
    $w('#ctl-wizard').hidden = false;
    $w('#ctl-calibrate').hidden = true;
    $w('#ctl-wiz-next').onclick = nextStep;
    $w('#ctl-wiz-skip').onclick = skipBind;
    $w('#ctl-wiz-cancel').onclick = stopWizard;
    showStep();
  }

  function stopWizard() {
    wizard = null;
    if ($w('#ctl-wizard')) $w('#ctl-wizard').hidden = true;
    if ($w('#ctl-calibrate')) $w('#ctl-calibrate').hidden = false;
  }

  function pad() {
    return rawGamepads().find(p => p.index === wizard.padIndex && p.id === wizard.id) || null;
  }

  function showStep() {
    const step = STEPS[wizard.step];
    $w('#ctl-wiz-step').textContent = step.title;
    if (step.id === 'switches') {
      const [action, label] = ACTION_BINDS[wizard.bind];
      $w('#ctl-wiz-text').textContent = `Flip the switch or press the button for ${label}. It binds when it moves. SKIP leaves it unbound.`;
      $w('#ctl-wiz-next').hidden = true;
      $w('#ctl-wiz-skip').hidden = false;
      wizard.bindRest = pad() ? [...pad().axes] : [];
      wizard.bindButtons = pad() ? pad().buttons.map(b => b.pressed) : [];
      wizard.bindAction = action;
      // Let the previous switch travel back home before listening again, or flipping it
      // back would bind the next action to the same switch.
      wizard.settleUntil = performance.now() + 900;
    } else {
      $w('#ctl-wiz-text').textContent = step.text;
      $w('#ctl-wiz-next').hidden = false;
      $w('#ctl-wiz-skip').hidden = true;
    }
  }

  // Largest deflection from rest among axes not already assigned.
  function strongestAxis(axes) {
    let best = -1, delta = 0;
    axes.forEach((v, i) => {
      if (wizard.used.has(i)) return;
      const d = v - wizard.rest[i];
      if (Math.abs(d) > Math.abs(delta)) { delta = d; best = i; }
    });
    return { i: best, delta };
  }

  function nextStep() {
    const p = pad();
    if (!p) { $w('#ctl-wiz-text').textContent = 'TRANSMITTER DISCONNECTED.'; return; }
    const step = STEPS[wizard.step].id;
    const axes = [...p.axes];
    const prof = wizard.profile;
    if (step === 'rest') {
      wizard.rest = axes;
      wizard.min = axes.slice();
      wizard.max = axes.slice();
    } else if (step === 'throttle') {
      let best = -1, range = 0;
      axes.forEach((_, i) => {
        const r = wizard.max[i] - wizard.min[i];
        if (r > range) { range = r; best = i; }
      });
      if (best < 0 || range < 0.5) { $w('#ctl-wiz-text').textContent = 'No throttle travel seen. Move it fully up and down, then NEXT.'; return; }
      const min = wizard.min[best], max = wizard.max[best];
      prof.throttle = { i: best, min, max, inv: wizard.rest[best] > (min + max) / 2 };
      wizard.used.add(best);
    } else {
      const { i, delta } = strongestAxis(axes);
      if (i < 0 || Math.abs(delta) < 0.4) { $w('#ctl-wiz-text').textContent = 'Not enough travel. Hold the stick fully over and press NEXT.'; return; }
      prof[step] = { i, center: wizard.rest[i], span: Math.abs(delta), inv: delta < 0 };
      wizard.used.add(i);
    }
    wizard.step++;
    showStep();
  }

  function skipBind() {
    wizard.bind++;
    if (wizard.bind >= ACTION_BINDS.length) finish();
    else showStep();
  }

  function finish() {
    saveControls({ radio: wizard.profile });
    $w('#ctl-device').textContent = 'TRANSMITTER CALIBRATED AND SAVED.';
    stopWizard();
  }

  function updateWizard() {
    const p = pad();
    const live = $w('#ctl-wiz-live');
    if (!p) { live.textContent = 'WAITING FOR TRANSMITTER…'; return; }
    live.textContent = p.axes.map((v, i) => `A${i} ${v >= 0 ? '+' : ''}${v.toFixed(2)}`).join('   ');
    const step = STEPS[wizard.step]?.id;
    if (step === 'throttle') {
      p.axes.forEach((v, i) => {
        wizard.min[i] = Math.min(wizard.min[i], v);
        wizard.max[i] = Math.max(wizard.max[i], v);
      });
    }
    if (step === 'switches' && performance.now() < wizard.settleUntil) {
      wizard.bindRest = [...p.axes];
      wizard.bindButtons = p.buttons.map(b => b.pressed);
      return;
    }
    if (step === 'switches') {
      // A button press, or a non-stick axis jumping by half its travel, binds the action.
      const pressed = p.buttons.findIndex((b, i) => b.pressed && !wizard.bindButtons[i]);
      let bind = null;
      if (wizard.bindAction === 'gimbal') {
        p.axes.forEach((v, i) => {
          if (bind || wizard.used.has(i)) return;
          const rest = wizard.bindRest[i] ?? 0;
          if (Math.abs(v - rest) > 0.3) bind = { axis: { i, center: rest, span: 1, inv: v < rest } };
        });
        if (bind) { wizard.profile.gimbal = bind.axis; skipBind(); }
        return;
      }
      if (pressed >= 0) bind = { kind: 'button', i: pressed };
      else {
        p.axes.forEach((v, i) => {
          if (bind || wizard.used.has(i)) return;
          const rest = wizard.bindRest[i] ?? 0;
          if (Math.abs(v - rest) > 0.5) bind = { kind: 'axis', i, thr: (v + rest) / 2, above: v > rest };
        });
      }
      if (bind) {
        wizard.profile.actions[wizard.bindAction] = bind;
        skipBind();
      }
    }
  }
}
