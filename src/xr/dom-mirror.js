// Paints the page's HTML layer (FPV OSD, lesson cards, debriefs, menus, briefings) onto a 2D
// canvas so it can ride on the goggle screen inside a WebXR session, where the browser
// composites no DOM at all. It is deliberately a small renderer for THIS game's UI: boxes,
// borders, text, canvases, range sliders, rotated bars and the whisker SVG. The DOM stays the
// single source of truth — the game keeps writing textContent exactly as it does on a monitor.

const SKIP_IDS = new Set(['game-canvas', 'controls', 'vr-enter', 'rotate-hint']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE']);
const lineCache = new WeakMap();

function parseColor(value) {
  if (!value || value === 'transparent') return null;
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return value;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length > 3 && parts[3] <= 0.003) return null;
  return value;
}

function firstGradientColor(image) {
  const colors = image.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})/gi);
  if (!colors?.length) return null;
  return colors[Math.min(1, colors.length - 1)];
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (radius <= 0.5) { ctx.rect(x, y, w, h); return; }
  ctx.roundRect(x, y, w, h, radius);
}

function radiusOf(cs, w, h) {
  const raw = cs.borderTopLeftRadius;
  if (!raw || raw === '0px') return 0;
  if (raw.includes('%')) return (parseFloat(raw) / 100) * Math.min(w, h);
  return parseFloat(raw) || 0;
}

function textTransform(text, cs) {
  if (cs.textTransform === 'uppercase') return text.toUpperCase();
  if (cs.textTransform === 'lowercase') return text.toLowerCase();
  return text;
}

// Line boxes for one text node: [{ text, left, top, height }].
function textLines(node, cs) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = [...range.getClientRects()].filter(r => r.width > 0 || r.height > 0);
  if (!rects.length) return [];
  const pre = cs.whiteSpace.startsWith('pre') || cs.whiteSpace === 'break-spaces';
  const raw = node.data;
  if (rects.length === 1) {
    const text = pre ? raw.replace(/\n+$/, '') : raw.replace(/\s+/g, ' ').trim();
    return [{ text, left: rects[0].left, top: rects[0].top, height: rects[0].height }];
  }
  if (pre) {
    const lines = raw.replace(/\n+$/, '').split('\n');
    if (lines.length === rects.length) {
      return lines.map((text, i) => ({ text, left: rects[i].left, top: rects[i].top, height: rects[i].height }));
    }
  }
  // Wrapped text: find where each line starts. Cached until the text or its box moves.
  const box = node.parentElement.getBoundingClientRect();
  const key = `${raw}|${box.left | 0}|${box.top | 0}|${box.width | 0}`;
  const cached = lineCache.get(node);
  if (cached?.key === key) return cached.lines;
  const lines = [];
  let current = null;
  for (let i = 0; i < raw.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getClientRects()[0];
    if (!r) continue;
    if (!current || Math.abs(r.top - current.top) > r.height * 0.5) {
      current = { chars: '', left: r.left, top: r.top, height: r.height };
      lines.push(current);
    }
    current.chars += raw[i];
  }
  const result = lines.map(l => ({
    text: pre ? l.chars.replace(/\n/g, '') : l.chars.replace(/\s+/g, ' ').trim(),
    left: l.left, top: l.top, height: l.height,
  })).filter(l => l.text);
  lineCache.set(node, { key, lines: result });
  return result;
}

export function createDomMirror() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0;

  function resize() {
    const scale = Math.min(2, 2048 / Math.max(1, window.innerWidth));
    const w = Math.round(window.innerWidth * scale);
    const h = Math.round(window.innerHeight * scale);
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
    }
    width = window.innerWidth;
    height = window.innerHeight;
    return scale;
  }

  function paintText(el, cs) {
    let font = null;
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.data.trim()) continue;
      if (!font) {
        font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        ctx.font = font;
        ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.lineJoin = 'round';
      }
      const color = parseColor(cs.color) || '#fff';
      const shadow = cs.textShadow && cs.textShadow !== 'none';
      for (const line of textLines(node, cs)) {
        if (line.top > height || line.top + line.height < 0) continue;
        const text = textTransform(line.text, cs);
        const y = line.top + line.height / 2;
        if (shadow) {
          ctx.strokeStyle = 'rgba(0,0,0,.9)';
          ctx.lineWidth = Math.max(2, parseFloat(cs.fontSize) / 6);
          ctx.strokeText(text, line.left, y);
        }
        ctx.fillStyle = color;
        ctx.fillText(text, line.left, y);
      }
    }
  }

  function paintBox(el, cs, r) {
    let fill = parseColor(cs.backgroundColor);
    const image = cs.backgroundImage;
    if (!fill && image && image !== 'none' && !image.includes('repeating') && !image.includes('radial')) {
      fill = firstGradientColor(image);
    }
    const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat);
    const bc = parseColor(cs.borderTopColor) || parseColor(cs.borderLeftColor);
    if (!fill && !(bc && bw.some(w => w > 0))) return;
    const transform = cs.transform;
    let angle = 0;
    if (transform && transform !== 'none') {
      const m = transform.match(/matrix\(([^)]+)\)/);
      if (m) {
        const [a, b] = m[1].split(',').map(Number);
        angle = Math.atan2(b, a);
      }
    }
    const radius = radiusOf(cs, r.width, r.height);
    ctx.save();
    let x = r.left, y = r.top, w = r.width, h = r.height;
    if (Math.abs(angle) > 0.01) {
      w = el.offsetWidth; h = el.offsetHeight;
      ctx.translate(r.left + r.width / 2, r.top + r.height / 2);
      ctx.rotate(angle);
      x = -w / 2; y = -h / 2;
    }
    if (fill) {
      ctx.fillStyle = fill;
      roundRect(ctx, x, y, w, h, radius);
      ctx.fill();
    }
    if (bc && bw.some(v => v > 0)) {
      const uniform = bw.every(v => Math.abs(v - bw[0]) < 0.01);
      if (uniform) {
        ctx.strokeStyle = bc;
        ctx.lineWidth = bw[0];
        roundRect(ctx, x + bw[0] / 2, y + bw[0] / 2, w - bw[0], h - bw[0], radius);
        ctx.stroke();
      } else {
        const sideColor = side => parseColor(cs[`border${side}Color`]) || bc;
        if (bw[0]) { ctx.fillStyle = sideColor('Top'); ctx.fillRect(x, y, w, bw[0]); }
        if (bw[1]) { ctx.fillStyle = sideColor('Right'); ctx.fillRect(x + w - bw[1], y, bw[1], h); }
        if (bw[2]) { ctx.fillStyle = sideColor('Bottom'); ctx.fillRect(x, y + h - bw[2], w, bw[2]); }
        if (bw[3]) { ctx.fillStyle = sideColor('Left'); ctx.fillRect(x, y, bw[3], h); }
      }
    }
    ctx.restore();
  }

  function paintRange(el, r) {
    const min = parseFloat(el.min || 0), max = parseFloat(el.max || 100);
    const t = (parseFloat(el.value) - min) / Math.max(1e-6, max - min);
    const cy = r.top + r.height / 2;
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.fillRect(r.left, cy - 2, r.width, 4);
    ctx.fillStyle = '#4f9cff';
    ctx.fillRect(r.left, cy - 2, r.width * t, 4);
    ctx.beginPath();
    ctx.arc(r.left + r.width * t, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#eceff1';
    ctx.fill();
  }

  function paintSvg(el, cs, r) {
    const view = el.viewBox?.baseVal;
    if (!view || !view.width) return;
    ctx.save();
    ctx.translate(r.left, r.top);
    ctx.scale(r.width / view.width, r.height / view.height);
    for (const path of el.querySelectorAll('path')) {
      const ps = getComputedStyle(path);
      ctx.strokeStyle = parseColor(ps.stroke) || 'rgba(191,176,143,.72)';
      // The whiskers use non-scaling strokes: keep ~1 screen px whatever the viewBox scale.
      ctx.lineWidth = 1.1 / Math.max(r.width / view.width, 1e-3);
      ctx.lineCap = 'round';
      ctx.stroke(new Path2D(path.getAttribute('d')));
    }
    ctx.restore();
  }

  function walk(el, opacity) {
    if (SKIP_TAGS.has(el.tagName) || SKIP_IDS.has(el.id)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const alpha = opacity * parseFloat(cs.opacity || '1');
    if (alpha < 0.01) return;
    const visible = cs.visibility !== 'hidden';
    const r = el.getBoundingClientRect();
    const onScreen = r.right > 0 && r.bottom > 0 && r.left < width && r.top < height;
    if (visible && onScreen && (r.width > 0 || r.height > 0)) {
      ctx.globalAlpha = Math.min(1, alpha);
      paintBox(el, cs, r);
      if (el.tagName === 'CANVAS') {
        const blend = cs.mixBlendMode;
        ctx.globalCompositeOperation = blend === 'screen' ? 'screen'
          : blend === 'multiply' ? 'multiply' : 'source-over';
        ctx.imageSmoothingEnabled = cs.imageRendering !== 'pixelated';
        try { ctx.drawImage(el, r.left, r.top, r.width, r.height); } catch { /* 0-size canvas */ }
        ctx.globalCompositeOperation = 'source-over';
        ctx.imageSmoothingEnabled = true;
      } else if (el.tagName.toLowerCase() === 'svg') {
        paintSvg(el, cs, r);
        return;
      } else if (el.tagName === 'INPUT' && el.type === 'range') {
        paintRange(el, r);
      } else {
        paintText(el, cs);
      }
    }
    // Overflow-clipped containers (scrolling menus) clip their children.
    const clip = cs.overflowY !== 'visible' || cs.overflowX !== 'visible';
    if (clip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.left, r.top, r.width, r.height);
      ctx.clip();
    }
    for (const child of el.children) walk(child, alpha);
    if (clip) ctx.restore();
  }

  return {
    canvas,
    // Repaint the whole layer. `cursor` = { x, y } in CSS px, or null.
    paint(cursor = null) {
      const scale = resize();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const child of document.body.children) walk(child, 1);
      if (cursor) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#000';
        ctx.beginPath(); ctx.arc(cursor.x, cursor.y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#ffd54f';
        ctx.beginPath(); ctx.arc(cursor.x, cursor.y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath(); ctx.arc(cursor.x, cursor.y, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
}
