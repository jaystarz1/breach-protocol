import { statsRequested } from './capabilities.js';

export function createTelemetry(mode) {
  if (!statsRequested()) return { frame() {}, dispose() {} };

  const el = document.createElement('pre');
  Object.assign(el.style, {
    position: 'fixed', left: '8px', top: '8px', zIndex: 1000, margin: 0,
    padding: '7px 9px', color: '#bfffd0', background: 'rgba(0,0,0,.76)',
    border: '1px solid rgba(150,255,190,.28)', borderRadius: '4px',
    font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
    pointerEvents: 'none', whiteSpace: 'pre',
  });
  document.body.appendChild(el);

  let frames = 0;
  let elapsed = 0;
  let worst = 0;
  let last = performance.now();

  return {
    frame(renderer) {
      const now = performance.now();
      const dt = now - last;
      last = now;
      frames++;
      elapsed += dt;
      worst = Math.max(worst, dt);
      if (elapsed < 500) return;
      const info = renderer.info;
      const fps = frames * 1000 / elapsed;
      el.textContent = [
        `${mode.toUpperCase()}  ${fps.toFixed(0)} FPS  worst ${worst.toFixed(1)}ms`,
        `${info.render.calls} calls  ${(info.render.triangles / 1000).toFixed(0)}k tris`,
        `${info.memory.textures} textures  ${info.programs?.length || 0} programs`,
      ].join('\n');
      frames = 0;
      elapsed = 0;
      worst = 0;
    },
    dispose() { el.remove(); },
  };
}
