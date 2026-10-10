// Two games ship from one engine. Each HTML entry point names its game on <html data-game>;
// this profile decides which missions the menus, progression and save belong to. The engine
// itself still resolves every mission id (levelById), so QA can boot any mission from either
// page — only the player-facing roster is scoped.
//
// This module MUST stay dependency-free: quality.js imports it before the renderer exists.

const GAMES = {
  drone: {
    id: 'drone',
    title: 'Dronerium',
    logo: 'DRONE<span>RIUM</span>',
    // Player-facing word for one entry of the roster; numbering is per game, from 01.
    unit: 'CHAPTER',
    tagline: 'FPV STRIKE · BOMBER · INTERCEPTOR',
    // Drone school (11-20) then the interceptor serial (21-24), in campaign order.
    missions: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
    saveKey: 'breach-protocol-drone-save-v1',
    // First boot inherits the shared pre-split save so drone progress and settings carry over.
    seedFrom: 'breach-protocol-save-v1',
    progressLabel: 'CERTIFICATIONS',
    statusLabel: 'RANGE STATUS',
    briefDossier: 'VEKTOR GROUP // LONG-RANGE STRIKE CELL',
    debriefTrack: 'CELL RECORD',
    rotateHint: 'DRONERIUM plays sideways.',
    other: { label: 'GROUND WAR — BREACH PROTOCOL', href: 'shooter.html' },
    keyHelp: [
      ['Fly (pitch / roll)', 'W A S D'],
      ['Look / gimbal', 'Mouse or Arrow Keys'],
      ['Climb (hold)', 'Z or Right Mouse'],
      ['Descend (hold)', 'C or Left Ctrl'],
      ['Fire / mark / release', 'Space or Left Mouse'],
      ['Drop / grenade', 'G'],
      ['EO / thermal', 'N'],
      ['Hand off / interact', 'F'],
      ['Skip lesson card', 'R'],
      ['Pause', 'Esc or P'],
    ],
  },
  shooter: {
    id: 'shooter',
    title: 'Breach Protocol',
    logo: 'BREACH <span>PROTOCOL</span>',
    unit: 'MISSION',
    tagline: 'FRONTLINE ASSAULT · RECONNAISSANCE · CLOSE QUARTERS',
    missions: [1, 2, 3, 4],
    // The shooter keeps the original key, so its progress is untouched by the split.
    saveKey: 'breach-protocol-save-v1',
    seedFrom: null,
    progressLabel: 'NODES SECURED',
    statusLabel: 'BASTION STATUS',
    briefDossier: 'ANTON MOROZOV // CALLSIGN BASTION',
    debriefTrack: 'BASTION TRACK',
    rotateHint: 'BREACH PROTOCOL plays sideways.',
    other: { label: 'DRONE WAR — DRONERIUM', href: './' },
    keyHelp: [
      ['Move', 'W A S D'],
      ['Look / aim', 'Arrow Keys'],
      ['Look (alt)', 'Mouse — click view to lock'],
      ['Fire', 'Space'],
      ['Fire (alt)', 'Left Mouse'],
      ['Aim / scope (hold)', 'Z'],
      ['Aim / scope (alt, hold)', 'Right Mouse'],
      ['Reload', 'R'],
      ['Breach door', 'F'],
      ['Hostages: shelter / follow / stay / down', 'H'],
      ['Grenade / Flashbang', 'G / B'],
      ['Swap weapon', 'X'],
      ['Night vision (toggle)', 'N'],
      ['Crouch (toggle)', 'C or Left Ctrl'],
      ['Lean left / right', 'Q / E'],
      ['Hold breath (steady scope)', 'Left Shift'],
      ['Pause', 'Esc or P'],
    ],
  },
};

const requested = typeof document !== 'undefined' ? document.documentElement.dataset.game : null;
export const GAME = GAMES[requested] || GAMES.drone;
