const $ = id => document.getElementById(id);

export const hud = {
  show(on) { $('hud').style.display = on ? 'block' : 'none'; $('controls').style.display = on ? 'block' : 'none'; },
  health(cur, max) {
    const pct = Math.max(0, cur / max * 100);
    $('health-fill').style.width = pct + '%';
    $('health-fill').style.background = pct > 55 ? '#66bb6a' : pct > 25 ? '#ffa726' : '#ef5350';
    $('damage-vignette').style.boxShadow = `inset 0 0 120px rgba(255,0,0,${pct < 45 ? (0.55 - pct / 100) : 0})`;
  },
  ammo(mag, reserve, nades, flashes) {
    $('ammo').innerHTML = `${mag} <small>/ ${reserve === Infinity ? '∞' : reserve}</small>`
      + (nades > 0 ? ` <small style="color:#ffb74d">⬤${nades}</small>` : '')
      + (flashes > 0 ? ` <small style="color:#e0f7fa">✦${flashes}</small>` : '');
  },
  weapon(name) { $('weapon-name').textContent = name; },
  objective(text) { $('objective').textContent = text; },
  score(text) { $('score-line').textContent = text; },
  hitmarker() { const h = $('hitmarker'); h.classList.remove('show'); void h.offsetWidth; h.classList.add('show'); },
  noShoot(text = 'CIVILIAN DOWN') {
    const w = $('noshoot-warn'); w.textContent = text;
    w.classList.remove('show'); void w.offsetWidth; w.classList.add('show');
  },
  feed(text, color = '#b0bec5') {
    const f = $('kill-feed');
    const d = document.createElement('div');
    d.textContent = text; d.style.color = color;
    f.prepend(d);
    while (f.children.length > 4) f.removeChild(f.lastChild);
    setTimeout(() => d.remove(), 4000);
  },
  // Directional damage: an arc on the edge of a ring pointing at the shooter.
  damageFrom(angle) {
    const ring = $('dmg-ring');
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `rotate(${angle}rad)`;
    ring.appendChild(arc);
    requestAnimationFrame(() => { arc.style.opacity = '1'; });
    setTimeout(() => { arc.style.opacity = '0'; }, 550);
    setTimeout(() => arc.remove(), 1100);
  },
  flashWhite(amount) { $('flash-white').style.opacity = String(Math.max(0, Math.min(1, amount))); },
  breachBtn(on) { $('btn-breach').style.display = on ? 'flex' : 'none'; },
  flashBtn(on) { $('btn-flash').style.display = on ? 'flex' : 'none'; },
  breathBtn(on) { $('btn-breath').style.display = on ? 'flex' : 'none'; },
  nadeBtn(on) { $('btn-nade').style.display = on ? 'flex' : 'none'; },
  swapBtn(on) { $('btn-swap').style.display = on ? 'flex' : 'none'; },
  scope(on) { $('scope').style.display = on ? 'block' : 'none'; $('crosshair').style.display = on ? 'none' : 'block'; },
  screen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    if (name) $('screen-' + name).classList.add('active');
  },
};
