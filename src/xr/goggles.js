// WebXR goggle mode. The headset becomes a pair of FPV goggles: the drone feed (with the same
// analog/thermal emulation the monitor shows) and the page's OSD/menus are composited onto one
// head-locked screen in a dark void, the way DJI/Walksnail/analog goggles present the picture.
// Nothing else about the game changes: same page, same simulation, same DOM.
//
// Inside the session the right controller is a laser pointer whenever a menu screen is up; in
// flight the Touch controllers are Mode 2 sticks (see sticks.js).

import * as THREE from 'three';
import { createFeedPostMaterial } from '../renderer/render-pipeline.js';
import { createDomMirror } from './dom-mirror.js';
import { controls } from '../sticks.js';

const SCREEN_DISTANCE = 2;     // metres in front of the eyes
const HUD_HZ = 24;             // DOM layer repaint rate (analog OSD cadence is plenty)
const isQuest = typeof navigator !== 'undefined' && /OculusBrowser|Quest/i.test(navigator.userAgent);

function parseCanvasFilter(filter) {
  const read = (name, fallback) => {
    const m = (filter || '').match(new RegExp(`${name}\\(([\\d.]+)(%?)\\)`));
    if (!m) return fallback;
    return m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  };
  return {
    saturate: read('saturate', 1), contrast: read('contrast', 1),
    brightness: read('brightness', 1), grayscale: read('grayscale', 0),
  };
}

export function createGoggles(renderer) {
  const state = {
    supported: false,
    session: null,
    frame: 0,
    hudClock: 0,
    lastTime: 0,
    cursor: null,
    menuActive: false,
  };

  const xrCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 50);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(xrCamera);

  // Feed render (linear HDR) -> analog emulation pass -> screen texture (display-encoded).
  const feedTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  const screenTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  });
  const post = createFeedPostMaterial(feedTarget.texture);
  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));

  // The goggle screen spans ~1000 eye pixels on a Quest 2; 1600 keeps OSD glyphs crisp while
  // halving the 24 Hz texture upload a 2048 canvas would cost on a mobile GPU.
  const mirror = createDomMirror({ maxWidth: isQuest ? 1600 : 2048 });
  const hudTexture = new THREE.CanvasTexture(mirror.canvas);
  hudTexture.minFilter = THREE.LinearFilter;
  hudTexture.generateMipmaps = false;

  const screenMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tVideo: { value: screenTarget.texture },
      tHud: { value: hudTexture },
      hasVideo: { value: 0 },
      aspect: { value: 16 / 9 },
      saturate: { value: 1 }, contrast: { value: 1 }, brightness: { value: 1 }, grayscale: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      uniform sampler2D tVideo;
      uniform sampler2D tHud;
      uniform float hasVideo, aspect, saturate, contrast, brightness, grayscale;
      varying vec2 vUv;
      void main() {
        vec3 v = hasVideo > 0.5 ? texture2D(tVideo, vUv).rgb : vec3(0.035, 0.045, 0.05);
        // The page applies the camera's colour response as a CSS filter on the canvas.
        // The headset composites no CSS, so the same filter is reproduced here.
        float g = dot(v, vec3(0.2126, 0.7152, 0.0722));
        v = mix(vec3(g), v, saturate);
        v = (v - 0.5) * contrast + 0.5;
        v *= brightness;
        v = mix(v, vec3(dot(v, vec3(0.2126, 0.7152, 0.0722))), grayscale);
        vec4 h = texture2D(tHud, vUv);
        vec3 c = mix(v, h.rgb, h.a);
        // Goggle optic: rounded display edge with a short soft falloff.
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
        vec2 halfSize = vec2(aspect, 1.0) * 0.5 - 0.035;
        vec2 q = abs(p) - halfSize + 0.06;
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.06;
        float edge = 1.0 - smoothstep(-0.012, 0.004, d);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0) * edge, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), screenMaterial);
  screen.position.set(0, 0, -SCREEN_DISTANCE);
  screen.renderOrder = 0;
  xrCamera.add(screen);

  // ---- controllers: laser pointer for menus ----
  const raycaster = new THREE.Raycaster();
  const pointerMatrix = new THREE.Matrix4();
  const rayGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1),
  ]);
  const controllers = [0, 1].map(index => {
    const controller = renderer.xr.getController(index);
    const ray = new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({
      color: 0xffd54f, transparent: true, opacity: 0.85, depthTest: false,
    }));
    ray.scale.z = SCREEN_DISTANCE;
    ray.renderOrder = 2;
    ray.visible = false;
    controller.add(ray);
    controller.userData.ray = ray;
    controller.addEventListener('connected', event => {
      controller.userData.handedness = event.data.handedness;
      controller.userData.gamepad = event.data.gamepad;
    });
    controller.addEventListener('disconnected', () => { controller.userData.handedness = null; });
    controller.addEventListener('select', () => onSelect(controller));
    scene.add(controller);
    return controller;
  });

  function pointerController() {
    return controllers.find(c => c.userData.handedness === 'right')
      || controllers.find(c => c.userData.handedness) || null;
  }

  function activeScreen() {
    return document.querySelector('.screen.active');
  }

  function cssPointFromController(controller) {
    pointerMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(pointerMatrix);
    const hit = raycaster.intersectObject(screen, false)[0];
    if (!hit?.uv) return null;
    controller.userData.ray.scale.z = hit.distance;
    return { x: hit.uv.x * window.innerWidth, y: (1 - hit.uv.y) * window.innerHeight };
  }

  // A trigger click on the goggle screen is a real click on the page element under it.
  function onSelect(controller) {
    if (!state.menuActive || controller !== pointerController() || !state.cursor) return;
    const { x, y } = state.cursor;
    const target = document.elementFromPoint(x, y);
    if (!target) return;
    if (target.tagName === 'INPUT' && target.type === 'range') {
      const r = target.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (x - r.left) / r.width));
      const min = parseFloat(target.min || 0), max = parseFloat(target.max || 100);
      const step = parseFloat(target.step || 1);
      target.value = String(Math.round((min + t * (max - min)) / step) * step);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    target.dispatchEvent(new MouseEvent('mousedown', init));
    target.dispatchEvent(new MouseEvent('mouseup', init));
    target.dispatchEvent(new MouseEvent('click', init));
  }

  // ---- page chrome: ENTER VR button, EXIT VR in the pause menu ----
  const button = document.createElement('button');
  button.id = 'vr-enter';
  button.type = 'button';
  button.textContent = 'ENTER VR: GOGGLES';
  button.onclick = () => (state.session ? state.session.end() : start());
  document.body.appendChild(button);
  const pause = document.getElementById('screen-pause');
  if (pause) {
    const exit = document.createElement('button');
    exit.className = 'menu-btn';
    exit.id = 'pause-exit-vr';
    exit.textContent = 'EXIT VR';
    exit.onclick = () => state.session?.end();
    pause.appendChild(exit);
  }

  if (navigator.xr?.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then(ok => {
      state.supported = ok;
      document.body.classList.toggle('xr-capable', ok);
    }).catch(() => {});
  }

  async function start() {
    if (state.session || !navigator.xr) return;
    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor'],
      });
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local');
      // Quest 2: the composited scene is one textured quad, so the eye buffers can stay native;
      // foveation trims the dark periphery for free.
      renderer.xr.setFoveation(1);
      await renderer.xr.setSession(session);
      state.session = session;
      document.body.classList.add('xr-presenting');
      button.textContent = 'EXIT VR';
      document.exitPointerLock?.();
      session.addEventListener('end', () => {
        state.session = null;
        renderer.xr.enabled = false;
        document.body.classList.remove('xr-presenting');
        button.textContent = 'ENTER VR: GOGGLES';
        window.dispatchEvent(new Event('resize'));
      });
    } catch (error) {
      console.warn('WebXR session failed', error);
    }
  }

  function sizeTargets() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    // Quest 2 renders the feed once (mono) at a broadcast-ish resolution; desktops headsets
    // get a sharper picture. Both stay well below a full-desktop frame.
    const longSide = isQuest ? 1280 : 1600;
    const w = aspect >= 1 ? longSide : Math.round(longSide * aspect);
    const h = aspect >= 1 ? Math.round(longSide / aspect) : longSide;
    if (feedTarget.width !== w || feedTarget.height !== h) {
      feedTarget.setSize(w, h);
      screenTarget.setSize(w, h);
      post.uniforms.resolution.value.set(w, h);
    }
    const width = 2 * SCREEN_DISTANCE * Math.tan((controls().vrScreen * Math.PI / 180) / 2);
    screen.scale.set(width, width / aspect, 1);
    screenMaterial.uniforms.aspect.value = aspect;
  }

  function scrollMenu(dt) {
    const right = state.session?.inputSources
      ? [...state.session.inputSources].find(s => s.handedness === 'right')?.gamepad : null;
    const y = right?.axes?.[3] || 0;
    const target = activeScreen();
    if (target && Math.abs(y) > 0.2) target.scrollTop += y * 900 * dt;
  }

  return {
    get presenting() { return !!state.session && renderer.xr.isPresenting; },
    get session() { return state.session; },
    start,
    // Render one XR frame. `scene` may be null (menus before any level has loaded).
    render(sceneToFeed, camera, frameState, renderWithViewmodel) {
      const now = performance.now();
      const dt = state.lastTime ? Math.min(0.1, (now - state.lastTime) / 1000) : 0;
      state.lastTime = now;
      state.frame++;
      sizeTargets();
      const cfg = controls();
      const half = cfg.vrFeedRate === 'half' || (cfg.vrFeedRate === 'auto' && isQuest);
      const renderFeed = sceneToFeed && (!half || state.frame % 2 === 0);
      // three binds the headset's framebuffer as a render target at the top of every XR
      // frame; the offscreen feed pass must hand that exact target back, not null.
      const xrTarget = renderer.getRenderTarget();
      if (renderFeed) {
        renderer.xr.enabled = false;
        renderer.setRenderTarget(feedTarget);
        renderWithViewmodel(sceneToFeed, camera, frameState.viewmodel);
        const fpv = frameState.fpv;
        post.uniforms.fpvActive.value = fpv?.active ? 1 : 0;
        post.uniforms.fpvSignal.value = fpv?.signal ?? 1;
        post.uniforms.fpvTime.value = fpv?.time ?? 0;
        post.uniforms.fpvThermal.value = fpv?.thermal ? 1 : 0;
        post.uniforms.fpvStabilized.value = fpv?.stabilized ? 1 : 0;
        renderer.setRenderTarget(screenTarget);
        renderer.render(postScene, postCamera);
        renderer.xr.enabled = true;
        renderer.setRenderTarget(xrTarget);
      }
      const showVideo = !!sceneToFeed && !activeScreen();
      screenMaterial.uniforms.hasVideo.value = showVideo ? 1 : 0;
      const filter = parseCanvasFilter(document.getElementById('game-canvas')?.style.filter);
      screenMaterial.uniforms.saturate.value = filter.saturate;
      screenMaterial.uniforms.contrast.value = filter.contrast;
      screenMaterial.uniforms.brightness.value = filter.brightness;
      screenMaterial.uniforms.grayscale.value = filter.grayscale;

      // Head pose first, so the pointer ray and the head-locked screen agree this frame.
      renderer.xr.updateCamera(xrCamera);
      state.menuActive = !!activeScreen();
      const pointer = pointerController();
      for (const controller of controllers) {
        controller.userData.ray.visible = state.menuActive && controller === pointer;
      }
      state.cursor = state.menuActive && pointer ? cssPointFromController(pointer) : null;
      if (state.menuActive) scrollMenu(dt);

      state.hudClock -= dt;
      if (state.hudClock <= 0) {
        state.hudClock = 1 / HUD_HZ;
        mirror.paint(state.cursor);
        hudTexture.needsUpdate = true;
      }
      renderer.render(scene, xrCamera);
    },
  };
}
