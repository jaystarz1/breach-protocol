const $ = id => document.getElementById(id);

export const hud = {
  show(on) { $('hud').style.display = on ? 'block' : 'none'; $('controls').style.display = on ? 'block' : 'none'; },
  health(cur, max) {
    const pct = Math.max(0, cur / max * 100);
    $('health-fill').style.width = pct + '%';
    $('health-fill').style.background = pct > 55 ? '#66bb6a' : pct > 25 ? '#ffa726' : '#ef5350';
    $('damage-vignette').style.boxShadow = `inset 0 0 120px rgba(255,0,0,${pct < 45 ? (0.55 - pct / 100) : 0})`;
  },
  ammo(mag, reserve, nades) {
    $('ammo').innerHTML = `${mag} <small>/ ${reserve === Infinity ? '∞' : reserve}</small>` + (nades > 0 ? ` <small style="color:#ffb74d">⬤${nades}</small>` : '');
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
  breachBtn(on) { $('btn-breach').style.display = on ? 'flex' : 'none'; },
  breathBtn(on) { $('btn-breath').style.display = on ? 'flex' : 'none'; },
  nadeBtn(on) { $('btn-nade').style.display = on ? 'flex' : 'none'; },
  swapBtn(on) { $('btn-swap').style.display = on ? 'flex' : 'none'; },
  scope(on) { $('scope').style.display = on ? 'block' : 'none'; $('crosshair').style.display = on ? 'none' : 'block'; },
  screen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    if (name) $('screen-' + name).classList.add('active');
  },
};
