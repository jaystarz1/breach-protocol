const KEY = 'breach-protocol-save-v1';

const defaults = {
  unlocked: 10,          // all missions playable from the start — no earning your way up
  difficulty: 1,
  sensitivity: 1.0,
  invertY: false,
  quality: 'auto',       // auto | compatibility | desktop — read by quality.js before boot
  best: {},              // levelId -> { score, grade }
  bestByTime: {},        // levelId -> { day: result, night: result }
  timeOfDayByLevel: {},  // levelId -> last briefing selection
};

let state = null;

export function load() {
  if (state) return state;
  try {
    state = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch { state = { ...defaults }; }
  state.best ||= {};
  state.bestByTime ||= {};
  state.timeOfDayByLevel ||= {};
  return state;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

function isBetter(prev, score, difficulty) {
  // a Recruit clear should never overwrite an Elite clear, so rank by difficulty first.
  const rank = d => ['RECRUIT', 'REGULAR', 'HARDENED', 'VETERAN', 'ELITE'].indexOf(d);
  return !prev || rank(difficulty) > rank(prev.difficulty || '')
    || (rank(difficulty) === rank(prev.difficulty || '') && score > prev.score);
}

export function recordResult(levelId, score, grade, difficulty = '', timeOfDay = 'night') {
  const s = load();
  const prev = s.best[levelId];
  const result = { score, grade, difficulty };
  if (isBetter(prev, score, difficulty)) s.best[levelId] = result;

  const time = timeOfDay === 'day' ? 'day' : 'night';
  const variants = s.bestByTime[levelId] ||= {};
  if (isBetter(variants[time], score, difficulty)) variants[time] = result;
  if (levelId >= s.unlocked && levelId < 10) s.unlocked = levelId + 1;
  save();
}
