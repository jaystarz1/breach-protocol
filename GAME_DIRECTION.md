# Breach Protocol — Frontline Campaign Direction

Status: approved direction
Player unit: Vektor Group
Enemy formation: fictional 37th Assault Group
Campaign antagonist: Anton Morozov, callsign BASTION

## Premise

Breach Protocol is a ground-combat campaign in a degraded town on the edge of a fictional
Eastern European frontline. Vektor has better reconnaissance, communications, optics, and
FPV capability. The 37th has more infantry, more replacement equipment, and enough electronic
warfare to keep forcing the fight back into the streets.

The player's job is not to conquer the map. It is to keep a narrow launch corridor alive:
clear infiltration routes, establish observation posts, protect drone crews, locate jammers,
and prevent assault waves from reaching the district. Successful ground action enables the
next drone operation.

BASTION is a former liaison who understands Vektor's drone doctrine and defected to the 37th.
He directs its assault and electronic-warfare cells, abandons each position before Vektor
arrives, and leaves enough evidence to drive the next mission. He is the thread connecting the
ten levels, not a supernatural boss or a one-man army.

## Ten connected missions

1. **Forward Command** — A live contact identifies BASTION's first launch-corridor attack.
2. **Launch Corridor** — Clear the main street, establish OP Alpha, and fly a route-marking sortie.
3. **OP Alpha** — Recover observers and protect the building that controls the corridor.
4. **Direction Finder** — Chase a 37th signals team carrying BASTION's relocation order.
5. **Market Infiltration** — Find armed infiltrators concealed among civilians near the aid market.
6. **Relay Crossing** — Cover an assault that seizes a relay and maps incoming formations.
7. **OP Bravo** — Reopen a rooftop observation post above the eastern approach.
8. **Electronic Attack** — Fight through a blackout and destroy the jammer masking BASTION's route.
9. **Rear Infiltration** — Intercept a hostage and equipment transfer through the service tunnels.
10. **Hold District** — Defend the launch corridor against the main assault and isolate BASTION.

Every briefing states what was learned, why the location matters, what the 37th is doing, and
BASTION's current status. Story delivery stays terse: briefings, recovered intelligence, radio,
and the intelligence panel instead of cutscenes.

## Performance and visual contract

The game remains a fast desktop web build. The Claude-of-Duty repository is a reference for
profiling and shader preparation, not a codebase to merge or a second product to maintain.

- Prewarm shaders during the mission loading state; compile nothing new in live combat.
- Track p50, p95, p99, worst frame, draw calls, triangles, and shader-program deltas.
- Instance repeated windows, vehicle parts, rubble, sandbags, and market props.
- Spend polygons on silhouettes, close weapons, vehicles, and readable cover.
- Use layered roughness, grime, cracks, scorch, broken edges, debris, and decals to remove the
  clean blockout look without covering every surface in expensive unique textures.
- Prefer authored level modules and fixed material families over unbounded procedural geometry.
- Add LODs or impostors before increasing distant detail.

The desired visual read is grounded and war-worn, not photorealism at any cost. Stable frame
pacing is part of the art direction.

## Factions and identification

Vektor personnel wear matte-black assault equipment with restrained blue/cyan identification.
The 37th mixes olive and charcoal field kit with locally sourced civilian clothing.

No hostile receives a wall-penetrating marker. Some infiltrators begin apparently civilian:

1. blend into the crowd;
2. observe or reposition;
3. present a weapon with a readable animation;
4. become valid combatants and may fire;
5. flee or surrender when isolated or stunned.

They cannot damage the player before the draw tell completes. Difficulty comes from
identification and pressure, not hidden rules.

## Controlled chaos

Crowded spaces should actually feel crowded. Gunfire produces deterministic, debuggable
reactions: recognition, decision, movement to authored cover or exits, and reassessment.
Civilians can cross firing lanes when their escape route plausibly requires it, but do not
zigzag randomly.

Freed hostages remain a complication. They can follow too closely, freeze in doorways, get
down under fire, or need simple FOLLOW, STAY, and GET DOWN commands.

Replay variation is seeded at mission load. Buildings swap only among validated modules;
props use authored sockets; enemies, civilians, patrols, and reinforcement routes use safe
spawn sets. Generation adds no recurring GPU workload.

## Trustworthy combat and AI

The reticle is authoritative. Aimed shots begin on the camera center ray, visible sway and
ballistic sway agree, held-breath sniper shots have no random spread, and hit volumes follow
visible anatomy.

NPC decisions remain local programmatic systems for the initial build: hearing, last-known
position, suppression, flanking, retreat, reinforcement, limited information sharing, and
hostage control. The local LLM remains out of the runtime. A later optional intelligence-panel
adapter may summarize between-mission evidence, never control combat.

## Core identity

Vektor has information and precision. The 37th has mass and repeated pressure. Each ground
mission earns the air picture needed to survive the next attack.

## Claude of Duty reference policy

`mshumer/Claude-of-Duty` is a useful MIT-licensed engineering reference, not the base game and
not a dependency. Its full HDR/post stack and all-procedural art direction solve a different
problem and carry a demonstrated Retina frame-rate cost. Breach Protocol keeps its lean
renderer, photographed close surfaces, fixed material-family batching, and authored campaign.

Borrow narrowly where the evidence is good: reproducible screenshot harnesses, shader prewarm,
grip-anchored first-person hands, measured ADS alignment, and frame-time distributions. Do not
copy the whole renderer, world, or procedural texture forge. Every adopted technique must pass
our moving 5.94-megapixel profiler and ten-mission compatibility sweep.
