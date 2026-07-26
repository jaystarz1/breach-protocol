const KEY = 'breach-protocol-save-v1';

const defaults = {
  unlocked: 10,          // all missions playable from the start — no earning your way up
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

export function recordResult(levelId, score, grade, difficulty = '') {
  const s = load();
  const prev = s.best[levelId];
  // a Recruit clear should never overwrite an Elite clear, so rank by difficulty first
  const rank = d => ['RECRUIT', 'REGULAR', 'HARDENED', 'VETERAN', 'ELITE'].indexOf(d);
  const better = !prev || rank(difficulty) > rank(prev.difficulty || '')
    || (rank(difficulty) === rank(prev.difficulty || '') && score > prev.score);
  if (better) s.best[levelId] = { score, grade, difficulty };
  if (levelId >= s.unlocked && levelId < 10) s.unlocked = levelId + 1;
  save();
}
