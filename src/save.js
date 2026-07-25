const KEY = 'breach-protocol-save-v1';

const defaults = {
  unlocked: 1,           // highest mission index unlocked (1-based)
  difficulty: 1,
  sensitivity: 1.0,
  invertY: false,
  best: {},              // levelId -> { score, grade }
};

let state = null;

export function load() {
  if (state) return state;
  try {
    state = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch { state = { ...defaults }; }
  return state;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

export function recordResult(levelId, score, grade) {
  const s = load();
  const prev = s.best[levelId];
  if (!prev || score > prev.score) s.best[levelId] = { score, grade };
  if (levelId >= s.unlocked && levelId < 10) s.unlocked = levelId + 1;
  save();
}
