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
    nextLead: 'DRONARIUM — certify on the strike drones before the deep-fence sorties begin.',
  },
  {
    node: 'DRONARIUM',
    sitrep: 'The district holds, and Vektor is standing up a long-range strike cell. Training begins on a clean range with live flight from the first minute.',
    purpose: 'Learn basic handling, the essential OSD and battery discipline, then repeat the profile without instructor prompts.',
    target: 'No enemy contact. The only thing that can kill you out here is your own flying.',
    intel: 'Instructor KAVUN runs the range. Each airframe is reviewed before the next one launches.',
    result: 'Handling and OSD certification complete. The operator is cleared for moving targets.',
    nextLead: 'MOVING RANGE — ten intercept problems, one meeting point at a time.',
  },
  {
    node: 'MOVING RANGE',
    sitrep: 'The straight range is running ten target profiles at different speeds, directions and approach geometries.',
    purpose: 'Practice crossing, approaching, receding, turning and concealed targets until first-pass interception replaces tail chasing.',
    target: 'No enemy contact. Every vehicle route is a geometry problem with an airframe attached.',
    intel: 'KAVUN: “Fly where it will be. The debrief will tell you whether the hit was planned or lucky.”',
    result: 'Ten intercept profiles complete. First-pass setup is now part of the operator’s card.',
    nextLead: 'HEAVY HANDS — gravity, drift and a bomber that must come home.',
  },
  {
    node: 'HEAVY HANDS',
    sitrep: 'The HERON heavy bomber is on the pad with a finite rack and moving rolling stock on the range line.',
    purpose: 'Learn hover and moving releases, account for inherited drift and achieve the required effects without emptying the aircraft.',
    target: 'No enemy contact. Gravity and payload economy are the evaluation.',
    intel: 'KAVUN: “The bomb keeps your movement. The bomber keeps flying after the bomb.”',
    result: 'Heavy-payload certification complete with a recoverable flight profile.',
    nextLead: 'BAD PICTURE — keep flying when the camera stops being kind.',
  },
  {
    node: 'BAD PICTURE',
    sitrep: 'Camera quality on the outer range is cycling between readable analog video and heavy breakup while the control channel remains partly usable.',
    purpose: 'Maintain orientation, preserve control and complete terminal attacks through degraded video.',
    target: 'No enemy contact. The picture is unreliable; the aircraft is not automatically lost.',
    intel: 'KAVUN: “Fly the heading and the landmarks when the detail disappears.”',
    result: 'Poor-visibility certification complete. The operator can distinguish a bad picture from a dead link.',
    nextLead: 'THE BUBBLE — one jammer, one landscape and no perfectly accurate circle.',
  },
  {
    node: 'THE BUBBLE',
    sitrep: 'A captured jammer is operating from the range and its observed coverage differs from the planning estimate.',
    purpose: 'Use terrain masking, suppress a physical EW source and penetrate an estimated jammer area.',
    target: 'No enemy contact. The electronic attack equipment is live.',
    intel: 'The jammer’s reach changes with line of sight and disappears when its source is destroyed.',
    result: 'EW penetration certification complete.',
    nextLead: 'NAP OF THE EARTH — make the terrain carry the link.',
  },
  {
    node: 'NAP OF THE EARTH',
    sitrep: 'Gullies, windbreak lanes and a sunken road form the only reliable corridors through the next range sector.',
    purpose: 'Fly below the masking line while managing speed, timber, wires and blind bends.',
    target: 'No enemy contact. The ground and obstacles are the opposition.',
    intel: 'The low profile is graded continuously in the airframe debrief.',
    result: 'Nap-of-the-earth certification complete.',
    nextLead: 'THE HUNT — the reported coordinate is no longer the target.',
  },
  {
    node: 'THE HUNT',
    sitrep: 'Stale reports place a hostile vehicle among decoys, abandoned equipment and protected traffic.',
    purpose: 'Search likely routes and hides, positively identify the correct vehicle and refuse invalid strikes.',
    target: 'One hostile vehicle is displaced inside the search area.',
    intel: 'A correct abort is preferable to an unconfirmed impact.',
    result: 'Search and positive-identification certification complete.',
    nextLead: 'BROKEN PLAN — the route closes after launch.',
  },
  {
    node: 'BROKEN PLAN',
    sitrep: 'Intermittent EW can close the primary corridor after the aircraft is committed.',
    purpose: 'Use an alternate route, retask or submit a valid no-go decision before battery makes the choice.',
    target: 'A secondary vehicle may be reachable during the EW cycle.',
    intel: 'The primary and alternate routes are hypotheses, not rails.',
    result: 'Contingency planning and abort judgment certified.',
    nextLead: 'GRADUATION — a convoy that reacts after the first impact.',
  },
  {
    node: 'GRADUATION',
    sitrep: 'A command-and-EW convoy is running the final range route with a heavy-payload follow-up prepared.',
    purpose: 'Prioritize critical targets, adapt to dispersal and achieve the commander’s effect within the airframe and payload allocation.',
    target: 'Command and EW vehicles matter more than low-value cargo.',
    intel: 'Surviving vehicles accelerate and change route after the first strike.',
    result: 'Tactical drone graduation complete.',
    nextLead: 'DEEP FENCE — run the full mission beyond the training range.',
  },
  {
    node: 'DEEP FENCE',
    sitrep: 'The 37th’s patrol armour, kolkhoz screen and fuel siding remain intact beyond the fields under an uncertain EW picture.',
    purpose: 'Plan, search, identify, strike, assess and report across three operational sorties.',
    target: 'The echelon includes real vehicles, decoys, protected traffic and reacting survivors.',
    intel: 'Recovered reports are incomplete and several jammer locations remain estimates.',
    result: 'The patrol, screen and fuel siding are neutralized with BDA submitted for every sortie.',
    nextLead: 'FENCE HELD — the strike cell is operational.',
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
