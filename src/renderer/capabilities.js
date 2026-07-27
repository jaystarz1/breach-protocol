// Resolve the render path before WebGLRenderer is constructed. Desktop is the product path;
// compatibility is a retained fallback, not the art-direction baseline.

const MODES = new Set(['auto', 'desktop', 'compatibility']);

function queryMode() {
  const q = new URLSearchParams(location.search).get('renderer');
  return MODES.has(q) ? q : null;
}

export function normalizeMode(value) {
  // Migrate the old graphics names without invalidating existing saves.
  if (value === 'high') return 'desktop';
  if (value === 'low') return 'compatibility';
  return MODES.has(value) ? value : 'auto';
}

export function desktopSupported() {
  if (typeof WebGL2RenderingContext === 'undefined') return false;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    antialias: false, depth: false, stencil: false, powerPreference: 'high-performance',
  });
  if (!gl) return false;
  const capable = gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 8192
    && gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) >= 16;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return capable;
}

export function resolveRendererMode(stored) {
  const choice = normalizeMode(queryMode() || stored);
  if (choice === 'desktop') return desktopSupported() ? 'desktop' : 'compatibility';
  if (choice === 'compatibility') return 'compatibility';
  // A touch screen no longer disqualifies a capable desktop. Coarse-only input does: that is
  // the retained phone/tablet path, and it no longer limits desktop content.
  const coarseOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  return !coarseOnly && desktopSupported() ? 'desktop' : 'compatibility';
}

export function requestedMode(stored) {
  return normalizeMode(queryMode() || stored);
}

export function requestedResolutionScale() {
  const raw = Number(new URLSearchParams(location.search).get('resolution'));
  return Number.isFinite(raw) && raw > 0 ? Math.max(0.7, Math.min(1, raw)) : 1;
}

export function statsRequested() {
  return new URLSearchParams(location.search).get('stats') === '1';
}
