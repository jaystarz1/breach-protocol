// Render path and quality budget.
//
// This module is imported before the renderer is constructed and MUST NOT import save.js:
// WebGLRenderer's `antialias` is fixed at construction time, and the renderer is built at
// module scope in main.js before save.load() has run. So read localStorage directly here.

import {
  hasRequestedResolutionScale, normalizeMode, requestedMode, requestedResolutionScale,
  resolveRendererMode,
} from './renderer/capabilities.js';

const KEY = 'breach-protocol-save-v1';

function storedChoice() {
  try {
    const q = JSON.parse(localStorage.getItem(KEY) || '{}').quality;
    return normalizeMode(q);
  } catch { return 'auto'; }
}

export const choice = requestedMode(storedChoice());
export const tier = resolveRendererMode(choice);

const desktop = tier === 'desktop';

export const quality = {
  tier,
  choice,
  rendererMode: tier,
  desktop,
  antialias: desktop,
  shadows: desktop,
  pbr: desktop,
  textures: desktop,
  shadowMapSize: desktop ? 3072 : 1024,
  pixelRatioCap: desktop ? 2 : 1.25,
  resolutionScale: requestedResolutionScale(),
  adaptiveResolution: desktop && !hasRequestedResolutionScale(),
};
