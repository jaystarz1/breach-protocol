// Minimal WebXR mock: renders both eyes side by side into the page canvas (framebuffer null),
// two Touch controllers with xr-standard gamepads, a right-hand ray aimed by window.__xrAim.
(() => {
  const ident = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  function persp(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
  }
  // Column-major rotation (yaw about Y, pitch about X) + translation.
  function pose(x, y, z, yaw = 0, pitch = 0) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Ry * Rx
    const m = new Float32Array([
      cy, 0, -sy, 0,
      sy * sp, cp, cy * sp, 0,
      sy * cp, -sp, cy * cp, 0,
      x, y, z, 1]);
    return m;
  }
  const pad = () => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ pressed: false, touched: false, value: 0 })), mapping: 'xr-standard', connected: true });
  window.__xrAim = { yaw: 0, pitch: 0 };
  const right = { handedness: 'right', targetRayMode: 'tracked-pointer', targetRaySpace: { id: 'rray' }, gripSpace: { id: 'rgrip' }, gamepad: pad(), profiles: ['oculus-touch'] };
  const left = { handedness: 'left', targetRayMode: 'tracked-pointer', targetRaySpace: { id: 'lray' }, gripSpace: { id: 'lgrip' }, gamepad: pad(), profiles: ['oculus-touch'] };
  window.__xrSources = { right, left };

  class XRWebGLLayer {
    constructor(session, gl) {
      this.framebuffer = null;
      this.framebufferWidth = gl.canvas.width;
      this.framebufferHeight = gl.canvas.height;
      this.antialias = false;
      this.ignoreDepthValues = false;
    }
    getViewport(view) {
      const w = this.framebufferWidth / 2;
      return { x: view.eye === 'left' ? 0 : w, y: 0, width: w, height: this.framebufferHeight };
    }
  }
  window.XRWebGLLayer = XRWebGLLayer;
  WebGL2RenderingContext.prototype.makeXRCompatible = async function () {};

  class Session extends EventTarget {
    constructor() {
      super();
      this.renderState = { baseLayer: null, depthNear: 0.1, depthFar: 1000 };
      this.inputSources = [right, left];
      this.visibilityState = 'visible';
      this.environmentBlendMode = 'opaque';
      this.ended = false;
    }
    updateRenderState(s) { Object.assign(this.renderState, s); }
    async requestReferenceSpace() { return { getOffsetReferenceSpace() { return this; } }; }
    requestAnimationFrame(cb) {
      return window.requestAnimationFrame(t => {
        if (this.ended) return;
        const layer = this.renderState.baseLayer;
        const aspect = layer ? (layer.framebufferWidth / 2) / layer.framebufferHeight : 1;
        const proj = persp(95 * Math.PI / 180, aspect, 0.05, 100);
        const views = ['left', 'right'].map((eye, i) => ({
          eye, projectionMatrix: proj,
          transform: { matrix: pose(i ? 0.032 : -0.032, 1.6, 0), position: { x: i ? 0.032 : -0.032, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
        }));
        const frame = {
          session: this,
          getViewerPose: () => ({ views, transform: { matrix: pose(0, 1.6, 0) } }),
          getPose: (space) => {
            if (space.id === 'rray') return { transform: { matrix: pose(0.12, 1.45, -0.2, window.__xrAim.yaw, window.__xrAim.pitch) }, emulatedPosition: false };
            if (space.id === 'lray') return { transform: { matrix: pose(-0.12, 1.45, -0.2) }, emulatedPosition: false };
            return { transform: { matrix: ident() }, emulatedPosition: false };
          },
          getJointPose: () => null,
        };
        window.__xrLastFrame = frame;
        cb(t, frame);
      });
    }
    cancelAnimationFrame(id) { window.cancelAnimationFrame(id); }
    async end() { this.ended = true; this.dispatchEvent(new Event('end')); }
    updateTargetFrameRate() { return Promise.resolve(); }
  }
  Object.defineProperty(navigator, 'xr', { configurable: true, value: {
    isSessionSupported: async () => true,
    requestSession: async () => {
      const s = new Session();
      window.__xrSession = s;
      setTimeout(() => {
        const e = new Event('inputsourceschange');
        e.added = [right, left]; e.removed = [];
        s.dispatchEvent(e);
      }, 300);
      return s;
    },
  } });
  window.__xrSelect = () => {
    const e = new Event('select'); e.inputSource = right; e.frame = window.__xrLastFrame; window.__xrSession.dispatchEvent(e);
    const e2 = new Event('selectend'); e2.inputSource = right; e2.frame = window.__xrLastFrame; window.__xrSession.dispatchEvent(e2);
  };
})();
