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

// One degraded frontline district. The ground war is four connected operations — the
// kill-house shakedown plus three long merged acts — followed by the ten-mission drone
// school. Mission ids are stable but not contiguous (acts kept 2-4, the school kept 11-20),
// so every entry carries its id and all lookups go by id.
export const CAMPAIGN_MISSIONS = [
  {
    id: 1,
    node: 'FORWARD COMMAND',
    sitrep: 'Vektor Group has entered a frontline town being abandoned faster than it can be evacuated. Russian assault elements are probing the eastern blocks.',
    purpose: 'Clear the damaged municipal annex and establish a protected command post and drone workshop.',
    target: 'Morozov is coordinating the probing attacks from outside the district.',
    intel: 'A live contact reports that BASTION supplied the 37th with Vektor launch-corridor maps.',
    result: 'The annex is secure. A transmitted map identifies the main-street battery route as the next attack.',
    nextLead: 'THE STREET — clear the launch corridor before OP Alpha loses resupply.',
  },
  {
    id: 2,
    node: 'THE STREET',
    sitrep: 'The main street is the only covered battery and warhead corridor, the apartment block above OP Alpha overlooks it, and a direction-finding team is withdrawing through the alleys beyond. Russian assault infantry hold the whole run.',
    purpose: 'Clear the corridor and open the southern barricade, retake the OP Alpha block and arm its rooftop drone, then run down the signals officer before BASTION\u2019s routing log crosses the assault line.',
    target: 'Direction-finding traffic associated with Morozov has been detected beyond the street.',
    intel: 'Captured frequency notes show a direction-finding cell listening for Vektor drone-control traffic.',
    result: 'The corridor, OP Alpha and the direction-finding log are all in Vektor\u2019s hands. BASTION abandons his vehicle before the cordon closes.',
    nextLead: 'THE DISTRICT \u2014 the recovered call signs are active inside the aid crowd.',
  },
  {
    id: 3,
    node: 'THE DISTRICT',
    sitrep: 'Scouts disguised as civilians are marking launch sites in the aid market, a counter-sniper operation is set against the relay crossing beyond its south gate, and an assault platoon is forming against the OP Bravo tower.',
    purpose: 'Break the infiltrator cell without touching the crowd, climb the overwatch post and cover Vektor\u2019s relay crossing, then move on OP Bravo: break the assault with the street-level drone and retake the tower.',
    target: 'Morozov has assigned a dedicated sniper to collapse the relay operation.',
    intel: 'Recovered radios pair the sniper with assault observers inside the district high-rise.',
    result: 'The market cell is broken, the relay is online and OP Bravo is reopened. Its spectrum recorder captures a coordinated jamming burst.',
    nextLead: 'UNDERGROUND \u2014 seize the records office before the spectrum archive is erased.',
  },
  {
    id: 4,
    node: 'UNDERGROUND',
    sitrep: 'A coordinated jamming attack has killed the district grid. BASTION\u2019s EW team holds the blacked-out records office, infantry are moving through the metro behind the observation posts, and the main assault is massing on the forward compound above.',
    purpose: 'Own the darkness through the records office and the metro, seal the rear route, then surface inside the forward compound as the grid comes back: break the assault, destroy the battery and end BASTION\u2019s command in the bunker.',
    target: 'Morozov is confirmed in the hardened forward-command site with no prepared evacuation route.',
    intel: 'OP Alpha, OP Bravo and the captured relay agree: Anton Morozov is physically present in the forward bunker.',
    result: 'BASTION is neutralized, the forward command collapses and the assault loses its coordinated air picture.',
    nextLead: 'DRONARIUM \u2014 certify on the strike drones before the deep-fence sorties begin.',
  },
  {
    id: 11,
    node: 'DRONARIUM',
    sitrep: 'The district holds, and Vektor is standing up a long-range strike cell. Training begins on a clean range with live flight from the first minute.',
    purpose: 'Learn basic handling, the essential OSD and battery discipline, then repeat the profile without instructor prompts.',
    target: 'No enemy contact. The only thing that can kill you out here is your own flying.',
    intel: 'Instructor KAVUN runs the range. Each airframe is reviewed before the next one launches.',
    result: 'Handling and OSD certification complete. The operator is cleared for moving targets.',
    nextLead: 'MOVING RANGE — ten intercept problems, one meeting point at a time.',
  },
  {
    id: 12,
    node: 'MOVING RANGE',
    sitrep: 'The straight range is running ten target profiles at different speeds, directions and approach geometries.',
    purpose: 'Practice crossing, approaching, receding, turning and concealed targets until first-pass interception replaces tail chasing.',
    target: 'No enemy contact. Every vehicle route is a geometry problem with an airframe attached.',
    intel: 'KAVUN: “Fly where it will be. The debrief will tell you whether the hit was planned or lucky.”',
    result: 'Ten intercept profiles complete. First-pass setup is now part of the operator’s card.',
    nextLead: 'HEAVY HANDS — gravity, drift and a bomber that must come home.',
  },
  {
    id: 13,
    node: 'HEAVY HANDS',
    sitrep: 'The HERON heavy bomber is on the pad with a finite rack and moving rolling stock on the range line.',
    purpose: 'Learn hover and moving releases, account for inherited drift and achieve the required effects without emptying the aircraft.',
    target: 'No enemy contact. Gravity and payload economy are the evaluation.',
    intel: 'KAVUN: “The bomb keeps your movement. The bomber keeps flying after the bomb.”',
    result: 'Heavy-payload certification complete with a recoverable flight profile.',
    nextLead: 'BAD PICTURE — keep flying when the camera stops being kind.',
  },
  {
    id: 14,
    node: 'BAD PICTURE',
    sitrep: 'Camera quality on the outer range is cycling between readable analog video and heavy breakup while the control channel remains partly usable.',
    purpose: 'Maintain orientation, preserve control and complete terminal attacks through degraded video.',
    target: 'No enemy contact. The picture is unreliable; the aircraft is not automatically lost.',
    intel: 'KAVUN: “Fly the heading and the landmarks when the detail disappears.”',
    result: 'Poor-visibility certification complete. The operator can distinguish a bad picture from a dead link.',
    nextLead: 'THE BUBBLE — one jammer, one landscape and no perfectly accurate circle.',
  },
  {
    id: 15,
    node: 'THE BUBBLE',
    sitrep: 'A captured jammer is operating from the range and its observed coverage differs from the planning estimate.',
    purpose: 'Use terrain masking, suppress a physical EW source and penetrate an estimated jammer area.',
    target: 'No enemy contact. The electronic attack equipment is live.',
    intel: 'The jammer’s reach changes with line of sight and disappears when its source is destroyed.',
    result: 'EW penetration certification complete.',
    nextLead: 'NAP OF THE EARTH — make the terrain carry the link.',
  },
  {
    id: 16,
    node: 'NAP OF THE EARTH',
    sitrep: 'Gullies, windbreak lanes and a sunken road form the only reliable corridors through the next range sector.',
    purpose: 'Fly below the masking line while managing speed, timber, wires and blind bends.',
    target: 'No enemy contact. The ground and obstacles are the opposition.',
    intel: 'The low profile is graded continuously in the airframe debrief.',
    result: 'Nap-of-the-earth certification complete.',
    nextLead: 'THE HUNT — the reported coordinate is no longer the target.',
  },
  {
    id: 17,
    node: 'THE HUNT',
    sitrep: 'Stale reports place a hostile vehicle among decoys, abandoned equipment and protected traffic.',
    purpose: 'Search likely routes and hides, positively identify the correct vehicle and refuse invalid strikes.',
    target: 'One hostile vehicle is displaced inside the search area.',
    intel: 'A correct abort is preferable to an unconfirmed impact.',
    result: 'Search and positive-identification certification complete.',
    nextLead: 'BROKEN PLAN — the route closes after launch.',
  },
  {
    id: 18,
    node: 'BROKEN PLAN',
    sitrep: 'Intermittent EW can close the primary corridor after the aircraft is committed.',
    purpose: 'Use an alternate route, retask or submit a valid no-go decision before battery makes the choice.',
    target: 'A secondary vehicle may be reachable during the EW cycle.',
    intel: 'The primary and alternate routes are hypotheses, not rails.',
    result: 'Contingency planning and abort judgment certified.',
    nextLead: 'GRADUATION — a convoy that reacts after the first impact.',
  },
  {
    id: 19,
    node: 'GRADUATION',
    sitrep: 'A command-and-EW convoy is running the final range route with a heavy-payload follow-up prepared.',
    purpose: 'Prioritize critical targets, adapt to dispersal and achieve the commander’s effect within the airframe and payload allocation.',
    target: 'Command and EW vehicles matter more than low-value cargo.',
    intel: 'Surviving vehicles accelerate and change route after the first strike.',
    result: 'Tactical drone graduation complete.',
    nextLead: 'DEEP FENCE — run the full mission beyond the training range.',
  },
  {
    id: 20,
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
  return CAMPAIGN_MISSIONS.find(m => m.id === id) || CAMPAIGN_MISSIONS[0];
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
  for (const mission of CAMPAIGN_MISSIONS) {
    if (!completed[mission.id]) return mission.id;
  }
  return CAMPAIGN_MISSIONS[CAMPAIGN_MISSIONS.length - 1].id;
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
