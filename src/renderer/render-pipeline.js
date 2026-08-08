import * as THREE from 'three';
import { createAdaptiveResolutionController } from './adaptive-resolution.js';
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
  renderer.info.autoReset = false;

  const telemetry = createTelemetry(settings.rendererMode);
  let target = null;
  let postScene = null;
  let postCamera = null;
  let postMaterial = null;
  let lastRender = { calls: 0, triangles: 0, lines: 0, points: 0 };
  let viewport = { width: 1, height: 1, devicePixelRatio: 1 };
  let lastFrameAt = performance.now();
  const resolution = createAdaptiveResolutionController({
    enabled: !!settings.adaptiveResolution,
    initialScale: settings.resolutionScale,
  });

  // The first-person rig and its fill/key lights live in their own scene (weapons.js) and
  // are drawn as a depth-cleared overlay after the world. Light layers cannot scope a light
  // to the gun (they gate against the CAMERA's mask, not per-object illumination), and two
  // passes over ONE scene with different light subsets fights three's per-scene render-state
  // caching — measured on r160: the world pass silently lost every point light. A separate
  // scene gives each pass its own render state, so the viewmodel lights touch nothing else.
  function renderWithViewmodel(scene, camera, viewmodel) {
    renderer.render(scene, camera);
    if (!viewmodel?.scene) return;
    if (viewmodel.rig) {
      camera.updateMatrixWorld();
      viewmodel.rig.matrix.copy(camera.matrixWorld);
      viewmodel.rig.matrixWorldNeedsUpdate = true;
    }
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(viewmodel.scene, camera);
    renderer.autoClear = true;
  }

  function applySize() {
    const ratio = Math.min(viewport.devicePixelRatio, settings.pixelRatioCap) * resolution.scale;
    renderer.setPixelRatio(ratio);
    renderer.setSize(viewport.width, viewport.height, false);
    if (target) {
      const rw = Math.max(1, Math.round(viewport.width * ratio));
      const rh = Math.max(1, Math.round(viewport.height * ratio));
      target.setSize(rw, rh);
      postMaterial.uniforms.resolution.value.set(rw, rh);
    }
  }

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
        fpvActive: { value: 0 },
        fpvSignal: { value: 1 },
        fpvTime: { value: 0 },
        fpvThermal: { value: 0 },
        fpvStabilized: { value: 0 },
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
        uniform float fpvActive;
        uniform float fpvSignal;
        uniform float fpvTime;
        uniform float fpvThermal;
        uniform float fpvStabilized;
        varying vec2 vUv;

        float hash(vec2 p) {
          // Interleaved gradient noise: stable in screen space and substantially cheaper than
          // evaluating sin() for every output pixel, especially in browser software renderers.
          return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
        }

        void main() {
          vec2 px = 1.0 / resolution;
          vec2 sampleUv = vUv;
          float opticEdge = 1.0;
          float breakup = 0.0;
          if (fpvActive > 0.5) {
            // Fill the display like a goggle optic. Curved lens distortion and peripheral
            // falloff replace rectangular 4:3 pillarboxing, which reads as edited footage.
            vec2 lens = (vUv - 0.5) * 2.0;
            float radius2 = dot(lens * vec2(0.78, 1.0), lens * vec2(0.78, 1.0));
            float barrel = mix(0.16, 0.05, fpvStabilized);
            lens *= 1.0 - barrel * radius2;
            sampleUv = 0.5 + lens * 0.5;
            opticEdge = 1.0 - smoothstep(0.42, 1.18, radius2);
            breakup = pow(1.0 - clamp(fpvSignal, 0.0, 1.0), 1.7);
            float band = floor(lens.y * 42.0 + fpvTime * 1.7);
            float tear = step(0.76, hash(vec2(band, floor(fpvTime * 12.0))));
            sampleUv.x += (hash(vec2(band, floor(fpvTime * 19.0))) - 0.5)
              * 0.055 * breakup * tear;
          }
          vec3 c = texture2D(tDiffuse, sampleUv).rgb;
          vec3 n = texture2D(tDiffuse, sampleUv + vec2(0.0, px.y)).rgb;
          vec3 s = texture2D(tDiffuse, sampleUv - vec2(0.0, px.y)).rgb;
          vec3 e = texture2D(tDiffuse, sampleUv + vec2(px.x, 0.0)).rgb;
          vec3 w = texture2D(tDiffuse, sampleUv - vec2(px.x, 0.0)).rgb;
          // Restrained local contrast: surface grain and frame edges survive the filmic curve
          // without turning every high-frequency texture into a halo.
          c += (c * 4.0 - n - s - e - w) * 0.045;
          float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c *= mix(vec3(0.975, 0.995, 1.018), vec3(1.018, 1.0, 0.978),
                   smoothstep(0.12, 0.82, luma));
          c = (c - 0.5) * 1.025 + 0.5;
          float vignette = 1.0 - smoothstep(0.28, 0.72, length(vUv - 0.5));
          c *= mix(0.9, 1.0, vignette);
          if (fpvActive > 0.5) {
            // Weak analog links lose colour and horizontal lock before the image disappears.
            float channelSlip = (0.0007 + breakup * 0.006) * (1.0 - fpvThermal);
            c.r = texture2D(tDiffuse, sampleUv + vec2(channelSlip, 0.0)).r;
            c.b = texture2D(tDiffuse, sampleUv - vec2(channelSlip, 0.0)).b;
            float gray = dot(c, vec3(0.299, 0.587, 0.114));
            float dropoutBand = step(0.7, hash(vec2(floor(gl_FragCoord.y / 7.0),
              floor(fpvTime * 9.0)))) * breakup;
            c = mix(c, vec3(gray), clamp(breakup * 0.72 + dropoutBand * 0.52, 0.0, 1.0));
            if (fpvThermal > 0.5) {
              gray = floor(pow(clamp(gray, 0.0, 1.0), 0.78) * 11.0) / 11.0;
              c = vec3(gray);
            }
            float scan = 0.965 + 0.035 * step(0.5, fract(gl_FragCoord.y * 0.5));
            c *= scan * mix(0.46, 1.0, opticEdge);
          }
          // Stable screen-space dither keeps gradients and photographic surfaces from
          // banding without making broad walls and dark window bays crawl every frame.
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
      viewport = { width, height, devicePixelRatio };
      applySize();
    },
    render(scene, camera, frameState = {}) {
      const now = performance.now();
      const adaptive = frameState.adaptive !== false && !document.hidden;
      const adjustment = resolution.sample(now - lastFrameAt, adaptive);
      lastFrameAt = now;
      if (adjustment) applySize();
      renderer.info.reset();
      if (target) {
        renderer.setRenderTarget(target);
        renderWithViewmodel(scene, camera, frameState.viewmodel);
        renderer.setRenderTarget(null);
        const fpv = frameState.fpv;
        postMaterial.uniforms.fpvActive.value = fpv?.active ? 1 : 0;
        postMaterial.uniforms.fpvSignal.value = fpv?.signal ?? 1;
        postMaterial.uniforms.fpvTime.value = fpv?.time ?? 0;
        postMaterial.uniforms.fpvThermal.value = fpv?.thermal ? 1 : 0;
        postMaterial.uniforms.fpvStabilized.value = fpv?.stabilized ? 1 : 0;
        renderer.render(postScene, postCamera);
      } else {
        renderWithViewmodel(scene, camera, frameState.viewmodel);
      }
      lastRender = {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        lines: renderer.info.render.lines,
        points: renderer.info.render.points,
      };
      telemetry.frame(renderer, lastRender, resolution.snapshot());
    },
    async prewarm(scene, camera) {
      const started = performance.now();
      const before = renderer.info.programs?.length || 0;
      const previousTarget = renderer.getRenderTarget();
      const frustumStates = [];
      try {
        // A compile pass prepares shader programs but does not upload textures belonging to
        // offscreen objects. The first camera turn could therefore block on a large glTF or
        // facade texture even with zero shader deltas. Initialize every scene-referenced map
        // while the loading screen still owns the frame.
        const textures = new Set();
        const collectMaterialTextures = material => {
          if (!material) return;
          for (const value of Object.values(material)) {
            if (value?.isTexture) textures.add(value);
          }
        };
        scene.traverse(object => {
          if (Array.isArray(object.material)) {
            object.material.forEach(collectMaterialTextures);
          } else {
            collectMaterialTextures(object.material);
          }
        });
        if (scene.environment?.isTexture) textures.add(scene.environment);
        if (scene.background?.isTexture) textures.add(scene.background);
        for (const texture of textures) renderer.initTexture(texture);

        if (target) renderer.setRenderTarget(target);
        if (typeof renderer.compileAsync === 'function') await renderer.compileAsync(scene, camera);
        else renderer.compile(scene, camera);
        // compileAsync does not force shadow-map and render-target variants on every browser.
        // One off-screen real render closes that gap before control is handed to the player.
        // Disable frustum culling for this render so geometry initially behind the camera is
        // uploaded now instead of stalling the first turn toward it.
        scene.traverse(object => {
          if (!(object.isMesh || object.isLine || object.isPoints)) return;
          frustumStates.push([object, object.frustumCulled]);
          object.frustumCulled = false;
        });
        renderer.render(scene, camera);
      } catch {
        try { renderer.compile(scene, camera); } catch { /* gameplay may still continue */ }
      } finally {
        for (const [object, frustumCulled] of frustumStates) {
          object.frustumCulled = frustumCulled;
        }
        renderer.setRenderTarget(previousTarget);
      }
      const after = renderer.info.programs?.length || 0;
      telemetry.resetPrograms(renderer);
      return {
        ok: true,
        ms: +(performance.now() - started).toFixed(1),
        programsBefore: before,
        programsAfter: after,
        compiled: after - before,
        parallel: !!renderer.getContext().getExtension('KHR_parallel_shader_compile'),
      };
    },
    performanceSnapshot() {
      const gl = renderer.getContext();
      return {
        ...telemetry.snapshot(renderer),
        postProcess: {
          enabled: !!target,
          temporalNoise: false,
        },
        resolution: resolution.snapshot(),
        render: { ...lastRender },
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        megapixels: +((gl.drawingBufferWidth * gl.drawingBufferHeight) / 1e6).toFixed(2),
        pixelRatio: renderer.getPixelRatio(),
      };
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
