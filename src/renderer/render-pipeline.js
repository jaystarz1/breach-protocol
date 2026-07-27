import * as THREE from 'three';
import { createTelemetry } from './telemetry.js';

// This is deliberately a direct-render implementation for the first desktop slice. All game
// code now talks to this boundary, so version-matched SSAO/bloom passes can be added without
// moving renderer ownership through main.js a second time.
export function createRenderPipeline(canvas, settings) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: settings.antialias,
    powerPreference: 'high-performance',
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = settings.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const telemetry = createTelemetry(settings.rendererMode);

  return {
    renderer,
    get mode() { return settings.rendererMode; },
    resize(width, height, devicePixelRatio) {
      const ratio = Math.min(devicePixelRatio, settings.pixelRatioCap) * settings.resolutionScale;
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
    },
    render(scene, camera) {
      renderer.render(scene, camera);
      telemetry.frame(renderer);
    },
    dispose() {
      telemetry.dispose();
      renderer.dispose();
    },
  };
}
