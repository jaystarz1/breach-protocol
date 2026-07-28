import * as THREE from 'three';
import { createTelemetry } from './telemetry.js';

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
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const telemetry = createTelemetry(settings.rendererMode);
  let target = null;
  let postScene = null;
  let postCamera = null;
  let postMaterial = null;

  if (settings.desktop) {
    target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 2,
    });
    postMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: target.texture },
        resolution: { value: new THREE.Vector2(1, 1) },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float time;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 0.01) * 43758.5453);
        }

        void main() {
          vec2 px = 1.0 / resolution;
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb;
          vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
          vec3 e = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb;
          vec3 w = texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb;
          // Restrained local contrast: surface grain and frame edges survive the filmic curve
          // without turning every high-frequency texture into a halo.
          c += (c * 4.0 - n - s - e - w) * 0.045;
          float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c *= mix(vec3(0.975, 0.995, 1.018), vec3(1.018, 1.0, 0.978),
                   smoothstep(0.12, 0.82, luma));
          c = (c - 0.5) * 1.025 + 0.5;
          float vignette = 1.0 - smoothstep(0.28, 0.72, length(vUv - 0.5));
          c *= mix(0.9, 1.0, vignette);
          c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
          // Raw ShaderMaterial does not append Three's output colour-space chunk when
          // toneMapped is disabled, so encode the linear render target explicitly.
          c = pow(max(c, 0.0), vec3(1.0 / 2.2));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    postScene = new THREE.Scene();
    postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial));
  }

  return {
    renderer,
    get mode() { return settings.rendererMode; },
    resize(width, height, devicePixelRatio) {
      const ratio = Math.min(devicePixelRatio, settings.pixelRatioCap) * settings.resolutionScale;
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      if (target) {
        const rw = Math.max(1, Math.round(width * ratio));
        const rh = Math.max(1, Math.round(height * ratio));
        target.setSize(rw, rh);
        postMaterial.uniforms.resolution.value.set(rw, rh);
      }
    },
    render(scene, camera) {
      if (target) {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        postMaterial.uniforms.time.value = performance.now();
        renderer.render(postScene, postCamera);
      } else {
        renderer.render(scene, camera);
      }
      telemetry.frame(renderer);
    },
    dispose() {
      telemetry.dispose();
      if (target) target.dispose();
      if (postMaterial) postMaterial.dispose();
      if (postScene) {
        const quad = postScene.children[0];
        if (quad?.geometry) quad.geometry.dispose();
      }
      renderer.dispose();
    },
  };
}
