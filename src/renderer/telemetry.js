import { statsRequested } from './capabilities.js';

const WINDOW = 600;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function createTelemetry(mode) {
  const show = statsRequested();
  const el = show ? document.createElement('pre') : null;
  if (el) {
    Object.assign(el.style, {
      position: 'fixed', left: '8px', top: '8px', zIndex: 1000, margin: 0,
      padding: '7px 9px', color: '#bfffd0', background: 'rgba(0,0,0,.76)',
      border: '1px solid rgba(150,255,190,.28)', borderRadius: '4px',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
      pointerEvents: 'none', whiteSpace: 'pre',
    });
    document.body.appendChild(el);
  }

  const samples = new Float32Array(WINDOW);
  let cursor = 0;
  let count = 0;
  let last = performance.now();
  let uiFrames = 0;
  let uiElapsed = 0;
  let uiWorst = 0;
  let lastRender = { calls: 0, triangles: 0, lines: 0, points: 0 };
  let lastResolution = { enabled: false, scale: 1, minScale: 1, maxScale: 1, p95: 0 };
  let programFloor = null;

  function snapshot(renderer) {
    const values = Array.from(samples.slice(0, count)).sort((a, b) => a - b);
    const p50 = percentile(values, 0.5);
    const p95 = percentile(values, 0.95);
    const p99 = percentile(values, 0.99);
    const programs = renderer.info.programs?.length || 0;
    return {
      mode,
      frames: count,
      frameTimeMs: {
        p50: +p50.toFixed(2),
        p95: +p95.toFixed(2),
        p99: +p99.toFixed(2),
        max: +(values.at(-1) || 0).toFixed(2),
      },
      fps: {
        p50: p50 ? +(1000 / p50).toFixed(1) : 0,
        p95: p95 ? +(1000 / p95).toFixed(1) : 0,
        p99: p99 ? +(1000 / p99).toFixed(1) : 0,
      },
      render: { ...lastRender },
      resources: {
        programs,
        compiledDuringWindow: programFloor == null ? 0 : programs - programFloor,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      },
      resolution: { ...lastResolution },
    };
  }

  return {
    frame(renderer, renderStats, resolution) {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (dt > 0 && dt < 1000) {
        samples[cursor] = dt;
        cursor = (cursor + 1) % WINDOW;
        count = Math.min(WINDOW, count + 1);
      }
      if (programFloor == null) programFloor = renderer.info.programs?.length || 0;
      lastRender = { ...renderStats };
      if (resolution) lastResolution = { ...resolution };

      if (!el) return;
      uiFrames++;
      uiElapsed += dt;
      uiWorst = Math.max(uiWorst, dt);
      if (uiElapsed < 500) return;
      const s = snapshot(renderer);
      const fps = uiFrames * 1000 / uiElapsed;
      el.textContent = [
        `${mode.toUpperCase()}  ${fps.toFixed(0)} FPS  p99 ${s.frameTimeMs.p99.toFixed(1)}ms  worst ${uiWorst.toFixed(1)}ms`,
        `${s.render.calls} calls  ${(s.render.triangles / 1000).toFixed(0)}k tris  scale ${(s.resolution.scale * 100).toFixed(0)}%`,
        `${s.resources.geometries} geo  ${s.resources.textures} tex  ${s.resources.programs} programs`,
      ].join('\n');
      uiFrames = 0;
      uiElapsed = 0;
      uiWorst = 0;
    },
    snapshot,
    resetPrograms(renderer) {
      programFloor = renderer.info.programs?.length || 0;
    },
    dispose() { el?.remove(); },
  };
}
