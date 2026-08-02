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
    intel: 'A live contact reports that BASTION supplied the 37th with Vektor launch-corridor maps.',
    result: 'The annex is secure. A transmitted map identifies the main-street battery route as the next attack.',
    nextLead: 'LAUNCH CORRIDOR — clear the street before OP Alpha loses resupply.',
  },
  {
    node: 'LAUNCH CORRIDOR',
    sitrep: 'The main street is the only covered route for batteries, warheads and recovered aircraft. Russian scouts and assault infantry have occupied the storefronts.',
    purpose: 'Clear the corridor, preserve the civilians still trapped there and establish Observation Post Alpha at the southern barricade.',
    target: 'Direction-finding traffic associated with Morozov has been detected beyond the street.',
    intel: 'Captured frequency notes show a direction-finding cell listening for Vektor drone-control traffic.',
    result: 'The corridor and OP Alpha are active. The sortie locates an assault team inside the overlooking apartment block.',
    nextLead: 'OP ALPHA — recover the observers before the eastern picture goes dark.',
  },
  {
    node: 'OP ALPHA',
    sitrep: 'An apartment block overlooks the eastern approaches, but assault troops hold its floors and residents are being used to prevent supporting fire.',
    purpose: 'Retake the building, recover the residents and arm the rooftop drone against the next reinforcement wave.',
    target: 'Morozov has begun moving electronic-warfare assets toward the district.',
    intel: 'The trapped observers recorded a 37th signals convoy moving under BASTION’s personal routing code.',
    result: 'OP Alpha is transmitting. Its armed rooftop drone breaks the next reinforcement wave before it can enter the block.',
    nextLead: 'DIRECTION FINDER — intercept the routing log before it crosses the assault line.',
  },
  {
    node: 'DIRECTION FINDER',
    sitrep: 'A Russian reconnaissance and electronic-warfare team has located part of Vektor’s control network and is withdrawing through alleys and a parking structure.',
    purpose: 'Maintain contact and stop the direction-finding team before it reaches the assault line.',
    target: 'Morozov’s vehicle was observed with the withdrawing team but separated during contact.',
    intel: 'The signals officer carries BASTION’s relocation order and the call signs assigned to his infiltrators.',
    result: 'The direction-finding log is recovered, but BASTION abandons his vehicle before Vektor closes the cordon.',
    nextLead: 'MARKET INFILTRATION — the recovered call signs are active inside the aid crowd.',
  },
  {
    node: 'MARKET INFILTRATION',
    sitrep: 'Scouts disguised among civilians are marking launch sites before the next assault wave. The market remains crowded with people who could not evacuate.',
    purpose: 'Identify weapons only when presented, neutralize the infiltrators and keep the crowd alive.',
    target: 'Recovered radios carry Morozov’s next assault timetable.',
    intel: 'Three civilian cover identities match the call signs recovered from the direction-finding team.',
    result: 'The infiltrator cell is broken. Its radios expose a counter-sniper operation against Vektor’s relay crossing.',
    nextLead: 'RELAY CROSSING — keep the engineers alive and find the hidden sniper.',
  },
  {
    node: 'RELAY CROSSING',
    sitrep: 'A black-clad assault and engineering element must cross an exposed plaza to install a relay serving every drone team in the district.',
    purpose: 'Protect the engineers, read every occupied window and defeat the counter-sniper covering the crossing.',
    target: 'Morozov has assigned a dedicated sniper to collapse the relay operation.',
    intel: 'BASTION’s timetable pairs the sniper with assault observers inside the district high-rise.',
    result: 'The relay is online and the technicians are recovered. Directional telemetry fixes the observer network at OP Bravo.',
    nextLead: 'OP BRAVO — strike the support group, then retake the tower.',
  },
  {
    node: 'OP BRAVO',
    sitrep: 'Russian troops have seized the district high-rise and can observe the command post, launch corridor and relay simultaneously.',
    purpose: 'Insert on the roof, fight down through the occupied floors and reclaim the long-range antenna position.',
    target: 'Morozov’s forward staff evacuated as the insertion aircraft crossed the district.',
    intel: 'OP Bravo has line of sight to an IFV, artillery unit and EW relay forming north of the tower.',
    result: 'The support group is destroyed and OP Bravo is reopened. Its spectrum recorder captures a coordinated jamming burst.',
    nextLead: 'ELECTRONIC ATTACK — seize the records office before the spectrum archive is erased.',
  },
  {
    node: 'ELECTRONIC ATTACK',
    sitrep: 'Power and telemetry have failed during a coordinated jamming attack. Without the records-office servers, Vektor cannot distribute drone video or target grids.',
    purpose: 'Own the darkness, clear the building and restore the server room before the assault begins.',
    target: 'Morozov is directing the jamming attack while relocating underground.',
    intel: 'The captured burst uses BASTION’s liaison-era authentication sequence and terminates below the records office.',
    result: 'The jammer and archive are secured. Tunnel telemetry reveals a rear infiltration route beneath both observation posts.',
    nextLead: 'REAR INFILTRATION — close the underground route and recover the detained engineers.',
  },
  {
    node: 'REAR INFILTRATION',
    sitrep: 'Russian infantry are using metro and utility tunnels to bypass the observation posts. Civilians sheltering underground are trapped between the teams.',
    purpose: 'Recover the civilians and close the route threatening the drone crews from the rear.',
    target: 'Intercepted tunnel traffic places Morozov in a hardened forward-command site.',
    intel: 'A detained engineer identifies BASTION’s bunker ventilation signature and the compound used by his forward staff.',
    result: 'The rear route is closed. Recovered control equipment confirms BASTION is directing the main assault from the bunker.',
    nextLead: 'HOLD THE DISTRICT — break the assault, breach the bunker and end BASTION’s command.',
  },
  {
    node: 'HOLD THE DISTRICT',
    sitrep: 'The main assault has begun: infantry, armour, artillery observation and electronic warfare are converging on the observation network.',
    purpose: 'Use every surviving position and drone capability, breach the forward-command bunker and break the assault before Vektor is overrun.',
    target: 'Morozov is confirmed inside the bunker with no prepared evacuation route.',
    intel: 'OP Alpha, OP Bravo and the captured relay agree: Anton Morozov is physically present in the forward bunker.',
    result: 'BASTION is neutralized, the forward command collapses and the assault loses its coordinated air picture.',
    nextLead: 'CORRIDOR HELD — Vektor drone operations remain active across the district.',
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

export function campaignDebrief(id, won = true) {
  const mission = campaignMission(id);
  return won
    ? { heading: 'INTELLIGENCE RECOVERED', result: mission.result, nextLead: mission.nextLead }
    : {
      heading: 'INTELLIGENCE DENIED',
      result: 'The mission failed before the intelligence chain could be secured.',
      nextLead: `RETRY ${mission.node} — the next operation remains unsupported.`,
    };
}

export function nextCampaignMission(saveState) {
  const completed = saveState?.best || {};
  for (let id = 1; id <= CAMPAIGN_MISSIONS.length; id++) {
    if (!completed[id]) return id;
  }
  return CAMPAIGN_MISSIONS.length;
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
