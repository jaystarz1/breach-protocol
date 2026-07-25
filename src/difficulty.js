// Five difficulty presets. Every tunable the game scales lives here.
export const DIFFICULTIES = [
  {
    id: 0, name: 'RECRUIT',
    enemyAccuracy: 0.10,      // chance per shot to hit player at reference range
    enemyReaction: 1.4,       // seconds from spotting to first shot
    enemyDamage: 6,
    enemyCountMul: 0.7,
    enemyHealthMul: 0.8,
    playerHealth: 150,
    regenDelay: 2.0, regenRate: 40,
    civilianMul: 0.6,
    aimAssist: 0.14,          // radians of magnetism cone
    noShootFail: false, noShootPenalty: 300,
  },
  {
    id: 1, name: 'REGULAR',
    enemyAccuracy: 0.16, enemyReaction: 1.0, enemyDamage: 9,
    enemyCountMul: 1.0, enemyHealthMul: 1.0,
    playerHealth: 120, regenDelay: 2.5, regenRate: 32,
    civilianMul: 1.0, aimAssist: 0.10,
    noShootFail: false, noShootPenalty: 500,
  },
  {
    id: 2, name: 'HARDENED',
    enemyAccuracy: 0.24, enemyReaction: 0.75, enemyDamage: 13,
    enemyCountMul: 1.15, enemyHealthMul: 1.1,
    playerHealth: 100, regenDelay: 3.0, regenRate: 25,
    civilianMul: 1.25, aimAssist: 0.07,
    noShootFail: false, noShootPenalty: 900,
  },
  {
    id: 3, name: 'VETERAN',
    enemyAccuracy: 0.33, enemyReaction: 0.55, enemyDamage: 18,
    enemyCountMul: 1.3, enemyHealthMul: 1.2,
    playerHealth: 100, regenDelay: 3.8, regenRate: 18,
    civilianMul: 1.5, aimAssist: 0.04,
    noShootFail: true, noShootPenalty: 0,
  },
  {
    id: 4, name: 'ELITE',
    enemyAccuracy: 0.45, enemyReaction: 0.4, enemyDamage: 26,
    enemyCountMul: 1.45, enemyHealthMul: 1.35,
    playerHealth: 80, regenDelay: 5.0, regenRate: 12,
    civilianMul: 1.8, aimAssist: 0,
    noShootFail: true, noShootPenalty: 0,
  },
];
