export const CAMPAIGN = {
  operation: 'BREACH PROTOCOL',
  target: {
    name: 'ADRIAN VALE',
    codename: 'ARCHITECT',
    role: 'Former tactical-intelligence planner; Calder operational director',
  },
  organization: {
    name: 'THE CALDER GROUP',
    cover: 'International logistics, private security and risk management',
    actual: 'Weapons, intelligence, transport and deniable personnel for criminal networks',
  },
};

// Canonical campaign facts. Tactical instructions remain in each level definition; this is
// the connective tissue that explains why Bravo moves from one operation to the next.
export const CAMPAIGN_MISSIONS = [
  {
    node: 'LIVE LEAD',
    sitrep: 'A kill-house evaluation is interrupted by a live Calder arrest. The prisoner carried a route card signed with Vale’s old operational cipher.',
    purpose: 'Finish the evaluation and report ready. Command is assembling a citywide pursuit team.',
    vale: 'Identity confirmed. Location unknown.',
  },
  {
    node: 'RELAY BLOCK',
    sitrep: 'The route card points to a Calder-controlled block used by couriers, vehicles and a short-range communications relay.',
    purpose: 'Break the street detail and recover the relay before Calder wipes it.',
    vale: 'Seen leaving the block shortly before Bravo arrived.',
  },
  {
    node: 'SAFE APARTMENTS',
    sitrep: 'The relay identified apartments holding Calder witnesses and the dispatch records for Vale’s cleanup teams.',
    purpose: 'Clear the building, recover the witnesses and seize the dispatch records.',
    vale: 'Moving through the eastern district under contractor escort.',
  },
  {
    node: 'DIRECT PURSUIT',
    sitrep: 'A surviving witness identified Vale’s vehicle. Patrol has forced it into the alley and parking network ahead of Bravo.',
    purpose: 'Maintain contact. His guards will trade themselves for every second of distance.',
    vale: 'Visual contact expected. Multiple escape routes available.',
  },
  {
    node: 'MARKET CUTOUT',
    sitrep: 'Vale abandoned his vehicle and activated a Calder cutout inside a crowded night market. Armed operatives are blending into the public.',
    purpose: 'Identify presented weapons, stop the shooters and preserve the crowd.',
    vale: 'Using the panic to reach a scheduled Calder meeting.',
  },
  {
    node: 'CALDER MEETING',
    sitrep: 'The market phones exposed a hostage transfer and senior Calder meeting in the plaza. An assault element is moving across open ground.',
    purpose: 'Protect the team, read every window and prevent Calder from killing the hostages.',
    vale: 'Meeting disrupted before his arrival. Counter-sniper remains active.',
  },
  {
    node: 'VALE SAFEHOUSE',
    sitrep: 'Recovered plaza traffic identified Vale’s primary safehouse tower. The roof is the only approach Calder has not fortified for a street entry.',
    purpose: 'Insert above the defenders and fight down through Vale’s command floors.',
    vale: 'Evacuation began as the helicopter crossed the river.',
  },
  {
    node: 'OPERATIONS ARCHIVE',
    sitrep: 'The safehouse was stripped, but a live terminal points to Calder’s records office. Vale has cut power and started remote deletion.',
    purpose: 'Own the darkness, clear the office and reach the server room before the archive is gone.',
    vale: 'Directing the deletion while moving underground.',
  },
  {
    node: 'METRO TRANSFER',
    sitrep: 'The archive exposed Calder’s emergency metro route and a final transfer of witnesses who can identify its command site.',
    purpose: 'Recover every hostage and stop the transfer before the train tunnels are cleared.',
    vale: 'Retreating to Calder’s hardened city compound.',
  },
  {
    node: 'CALDER COMMAND',
    sitrep: 'The rescued witnesses have identified the compound, tower and bunker used to command Calder’s city network.',
    purpose: 'Breach every layer, dismantle the remaining cell and resolve the pursuit.',
    vale: 'Confirmed inside. No remaining evacuation route.',
  },
];

export function campaignMission(id) {
  return CAMPAIGN_MISSIONS[id - 1] || CAMPAIGN_MISSIONS[0];
}

export function briefingText(id, tacticalBrief) {
  const m = campaignMission(id);
  return [
    m.sitrep,
    `CALDER NODE: ${m.node}`,
    `MISSION PURPOSE: ${m.purpose}`,
    tacticalBrief,
    `VALE STATUS: ${m.vale}`,
  ].join('\n\n');
}

export function campaignSnapshot(currentMission, saveState) {
  return {
    operation: CAMPAIGN.operation,
    target: CAMPAIGN.target,
    organization: CAMPAIGN.organization,
    currentMission,
    current: campaignMission(currentMission),
    completed: Object.keys(saveState.best || {}).map(Number).sort((a, b) => a - b),
  };
}
