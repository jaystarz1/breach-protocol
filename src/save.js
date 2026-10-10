import { GAME } from './game.js';

// Each game keeps its own save. A game with seedFrom inherits that key's contents on first
// boot (the pre-split save held both games' progress), keeping only its own mission results.
const KEY = GAME.saveKey;

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
    let raw = localStorage.getItem(KEY);
    if (raw === null && GAME.seedFrom) raw = seedFrom(GAME.seedFrom);
    state = { ...defaults, ...JSON.parse(raw || '{}') };
  } catch { state = { ...defaults }; }
  state.best ||= {};
  state.bestByTime ||= {};
  state.timeOfDayByLevel ||= {};
  return state;
}

function seedFrom(key) {
  const seed = JSON.parse(localStorage.getItem(key) || 'null');
  if (!seed) return null;
  const own = map => Object.fromEntries(Object.entries(map || {})
    .filter(([id]) => GAME.missions.includes(Number(id))));
  seed.best = own(seed.best);
  seed.bestByTime = own(seed.bestByTime);
  seed.timeOfDayByLevel = own(seed.timeOfDayByLevel);
  const raw = JSON.stringify(seed);
  try { localStorage.setItem(KEY, raw); } catch {}
  return raw;
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
