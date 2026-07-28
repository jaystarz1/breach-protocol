export const CAMPAIGN = {
  operation: 'BREACH PROTOCOL',
  unit: {
    name: 'VEKTOR GROUP',
    role: 'Ukrainian assault, reconnaissance and FPV support detachment',
  },
  target: {
    name: 'ANTON MOROZOV',
    codename: 'BASTION',
    role: 'Fictional Russian assault-group commander and electronic-warfare coordinator',
  },
  organization: {
    name: '37TH ASSAULT GROUP',
    cover: 'Forward security and territorial-control formation',
    actual: 'Massed infantry, armour, reconnaissance and electronic-warfare elements',
  },
};

// One degraded frontline district, ten connected operations. Ground actions exist to establish
// and preserve the observation/relay network that lets a smaller Ukrainian force use drones
// and precision against a numerically larger assault formation.
export const CAMPAIGN_MISSIONS = [
  {
    node: 'FORWARD COMMAND',
    sitrep: 'Vektor Group has entered a frontline town being abandoned faster than it can be evacuated. Russian assault elements are probing the eastern blocks.',
    purpose: 'Clear the damaged municipal annex and establish a protected command post and drone workshop.',
    target: 'Morozov is coordinating the probing attacks from outside the district.',
  },
  {
    node: 'LAUNCH CORRIDOR',
    sitrep: 'The main street is the only covered route for batteries, warheads and recovered aircraft. Russian scouts and assault infantry have occupied the storefronts.',
    purpose: 'Clear the corridor, preserve the civilians still trapped there and establish Observation Post Alpha at the southern barricade.',
    target: 'Direction-finding traffic associated with Morozov has been detected beyond the street.',
  },
  {
    node: 'OP ALPHA',
    sitrep: 'An apartment block overlooks the eastern approaches, but assault troops hold its floors and residents are being used to prevent supporting fire.',
    purpose: 'Retake the building, recover the residents and activate the rooftop reconnaissance position.',
    target: 'Morozov has begun moving electronic-warfare assets toward the district.',
  },
  {
    node: 'DIRECTION FINDER',
    sitrep: 'A Russian reconnaissance and electronic-warfare team has located part of Vektor’s control network and is withdrawing through alleys and a parking structure.',
    purpose: 'Maintain contact and stop the direction-finding team before it reaches the assault line.',
    target: 'Morozov’s vehicle was observed with the withdrawing team but separated during contact.',
  },
  {
    node: 'MARKET INFILTRATION',
    sitrep: 'Scouts disguised among civilians are marking launch sites before the next assault wave. The market remains crowded with people who could not evacuate.',
    purpose: 'Identify weapons only when presented, neutralize the infiltrators and keep the crowd alive.',
    target: 'Recovered radios carry Morozov’s next assault timetable.',
  },
  {
    node: 'RELAY CROSSING',
    sitrep: 'A black-clad assault and engineering element must cross an exposed plaza to install a relay serving every drone team in the district.',
    purpose: 'Protect the engineers, read every occupied window and defeat the counter-sniper covering the crossing.',
    target: 'Morozov has assigned a dedicated sniper to collapse the relay operation.',
  },
  {
    node: 'OP BRAVO',
    sitrep: 'Russian troops have seized the district high-rise and can observe the command post, launch corridor and relay simultaneously.',
    purpose: 'Insert on the roof, fight down through the occupied floors and reclaim the long-range antenna position.',
    target: 'Morozov’s forward staff evacuated as the insertion aircraft crossed the district.',
  },
  {
    node: 'ELECTRONIC ATTACK',
    sitrep: 'Power and telemetry have failed during a coordinated jamming attack. Without the records-office servers, Vektor cannot distribute drone video or target grids.',
    purpose: 'Own the darkness, clear the building and restore the server room before the assault begins.',
    target: 'Morozov is directing the jamming attack while relocating underground.',
  },
  {
    node: 'REAR INFILTRATION',
    sitrep: 'Russian infantry are using metro and utility tunnels to bypass the observation posts. Civilians sheltering underground are trapped between the teams.',
    purpose: 'Recover the civilians and close the route threatening the drone crews from the rear.',
    target: 'Intercepted tunnel traffic places Morozov in a hardened forward-command site.',
  },
  {
    node: 'HOLD THE DISTRICT',
    sitrep: 'The main assault has begun: infantry, armour, artillery observation and electronic warfare are converging on the observation network.',
    purpose: 'Use every surviving position and drone capability, breach the forward-command bunker and break the assault before Vektor is overrun.',
    target: 'Morozov is confirmed inside the bunker with no prepared evacuation route.',
  },
];

export function campaignMission(id) {
  return CAMPAIGN_MISSIONS[id - 1] || CAMPAIGN_MISSIONS[0];
}

export function briefingText(id, tacticalBrief) {
  const m = campaignMission(id);
  return [
    m.sitrep,
    `FRONTLINE NODE: ${m.node}`,
    `MISSION PURPOSE: ${m.purpose}`,
    tacticalBrief,
    `BASTION STATUS: ${m.target}`,
  ].join('\n\n');
}

export function campaignSnapshot(currentMission, saveState) {
  return {
    operation: CAMPAIGN.operation,
    unit: CAMPAIGN.unit,
    target: CAMPAIGN.target,
    organization: CAMPAIGN.organization,
    currentMission,
    current: campaignMission(currentMission),
    completed: Object.keys(saveState.best || {}).map(Number).sort((a, b) => a - b),
  };
}
