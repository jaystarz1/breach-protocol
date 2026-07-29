const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rounded = value => Math.round(value * 100) / 100;

// A refresh-rate-aware resolution governor. Frame intervals near 16.7ms are healthy at 60Hz;
// sustained intervals above 22ms indicate that the browser is missing that cadence. Scale
// changes are deliberately infrequent so one explosion, tab switch or shader warmup cannot
// make the image breathe.
export function createAdaptiveResolutionController({
  enabled = true,
  initialScale = 1,
  minScale = 0.7,
  sampleFrames = 120,
  downThresholdMs = 22,
  upThresholdMs = 18,
  downStep = 0.1,
  upStep = 0.05,
  downCooldownFrames = sampleFrames,
  upCooldownFrames = sampleFrames * 3,
  recoveryWindows = 2,
} = {}) {
  const ceiling = clamp(initialScale, minScale, 1);
  const floor = Math.min(minScale, ceiling);
  let scale = ceiling;
  let samples = [];
  let cooldown = 0;
  let healthyWindows = 0;
  let lastP95 = 0;

  function resetWindow() {
    samples = [];
    healthyWindows = 0;
  }

  return {
    get enabled() { return enabled; },
    get scale() { return scale; },
    get p95() { return lastP95; },
    sample(frameMs, active = true) {
      if (!enabled || !active) {
        resetWindow();
        return null;
      }
      // Ignore debugger stops, background-tab throttling and invalid deltas. A real sustained
      // 30fps load is ~33ms and remains fully represented.
      if (!Number.isFinite(frameMs) || frameMs < 3 || frameMs > 100) return null;
      if (cooldown > 0) cooldown--;
      samples.push(frameMs);
      if (samples.length < sampleFrames) return null;

      samples.sort((a, b) => a - b);
      lastP95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
      samples = [];
      if (cooldown > 0) return null;

      if (lastP95 > downThresholdMs && scale > floor) {
        const previous = scale;
        scale = rounded(Math.max(floor, scale - downStep));
        healthyWindows = 0;
        cooldown = downCooldownFrames;
        return { direction: 'down', previous, scale, p95: lastP95 };
      }

      if (lastP95 < upThresholdMs && scale < ceiling) {
        healthyWindows++;
        if (healthyWindows < recoveryWindows) return null;
        const previous = scale;
        scale = rounded(Math.min(ceiling, scale + upStep));
        healthyWindows = 0;
        cooldown = upCooldownFrames;
        return { direction: 'up', previous, scale, p95: lastP95 };
      }

      healthyWindows = 0;
      return null;
    },
    snapshot() {
      return {
        enabled,
        scale,
        minScale: floor,
        maxScale: ceiling,
        p95: +lastP95.toFixed(2),
      };
    },
  };
}
