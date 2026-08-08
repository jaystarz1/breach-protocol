// Runtime lighting variants. Mission geometry and gameplay stay authored once; this module
// derives the environment used for a particular launch without mutating the shared level.

export const TIME_OF_DAY = ['day', 'night'];

export function normalizeTimeOfDay(value, fallback = 'night') {
  return TIME_OF_DAY.includes(value) ? value : fallback;
}

export function levelTimeOfDay(level, requested) {
  return normalizeTimeOfDay(requested, normalizeTimeOfDay(level?.timeOfDay));
}

export function missionLightingVariant(level, requested) {
  const timeOfDay = levelTimeOfDay(level, requested);
  const nativeTime = levelTimeOfDay(level);
  if (timeOfDay === nativeTime) return { ...level, timeOfDay };

  // Fully enclosed source missions still expose the selected variant in UI, saves and QA,
  // but retain their authored fixture balance. There is no sky for daylight to illuminate.
  if (level.indoor === true) return { ...level, timeOfDay };

  const rural = level.backdrop === 'rural';
  const fogNear = level.fog?.[1] ?? 40;
  const fogFar = level.fog?.[2] ?? 160;

  if (timeOfDay === 'day') {
    return {
      ...level,
      timeOfDay,
      sky: rural ? 0x78a9d2 : 0x7099ba,
      fog: [rural ? 0xb8c5bd : 0xaebbc0, fogNear, fogFar],
      ambient: Math.max(level.ambient ?? 0.8, rural ? 0.72 : 0.78),
      sun: Math.max(level.sun ?? 0.85, rural ? 1.35 : 1.25),
    };
  }

  return {
    ...level,
    timeOfDay,
    sky: rural ? 0x1b2029 : 0x1b2634,
    fog: [rural ? 0x252a2e : 0x1b2634, fogNear, fogFar],
    ambient: Math.min(level.ambient ?? 0.8, 0.8),
    sun: Math.min(level.sun ?? 0.85, 0.9),
  };
}
