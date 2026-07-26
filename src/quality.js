// Render quality tier.
//
// This module is imported before the renderer is constructed and MUST NOT import save.js:
// WebGLRenderer's `antialias` is fixed at construction time, and the renderer is built at
// module scope in main.js before save.load() has run. So read localStorage directly here.

const KEY = 'breach-protocol-save-v1';

function storedChoice() {
  try {
    const q = JSON.parse(localStorage.getItem(KEY) || '{}').quality;
    return q === 'low' || q === 'high' ? q : 'auto';
  } catch { return 'auto'; }
}

// Phones and weak laptops get the cheap path. hardwareConcurrency is a rough proxy but the
// only one available before we've drawn a frame; a coarse pointer is the stronger signal.
function detect() {
  const coarse = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const weak = (navigator.hardwareConcurrency || 4) <= 4;
  return (coarse || weak) ? 'low' : 'high';
}

export const choice = storedChoice();
export const tier = choice === 'auto' ? detect() : choice;

const high = tier === 'high';

export const quality = {
  tier,
  choice,
  antialias: high,
  shadows: high,
  pbr: high,
  textures: high,
  shadowMapSize: 2048,
  pixelRatioCap: high ? 2 : 1.5,
};
