# Breach Protocol — Campaign and Gameplay Direction

Status: approved direction  
Campaign antagonist: Adrian Vale  
Hostile organization: The Calder Group

## Campaign premise

Breach Protocol is a citywide counterterror manhunt unfolding over one night.

Adrian Vale was a tactical-intelligence planner who helped develop the entry, containment,
and response doctrine now being used to pursue him. He defected to the Calder Group, a
transnational criminal organization operating behind a legitimate logistics and private
security company.

Calder supplies transportation, surveillance, weapons, intelligence, and deniable personnel
to criminal networks. Its city operation includes former military contractors, organized
crime crews, smugglers, corrupt officials, snipers, and disposable local recruits. Vale is not
a lone mastermind. He is the planner directing Calder's cleanup after its network is exposed.

Vale stays ahead by destroying records, moving witnesses, evacuating personnel, and forcing
the counterterror team to choose between pursuit and civilian protection. Each mission
dismantles another part of Calder's city operation and produces the lead for the next.

## Ten-mission pursuit

1. **First Door** — A training exercise is interrupted by a live Calder lead.
2. **Street Sweep** — The team searches a Calder-controlled block for a courier and relay.
3. **Stack Up** — A safe apartment contains witnesses and the next part of Vale's route.
4. **The Chase** — The first direct pursuit; Vale's guards delay the team while he escapes.
5. **Market Panic** — Calder uses a crowded market as concealment and a diversion.
6. **Overwatch** — The player covers an assault on a Calder meeting and hostage transfer.
7. **Vertical Assault** — A rooftop insertion hits Vale's safehouse moments after evacuation.
8. **Blackout** — Vale cuts power while the team recovers Calder's operational archive.
9. **Underground** — A hostage transfer through the metro reveals the final command site.
10. **The Cell** — The team breaches Calder's compound and resolves the pursuit.

Mission briefings must state what was learned, why the next location matters, what Calder is
doing there, and Vale's current status. The story should be delivered through concise
briefings, debriefs, recovered intelligence, and radio traffic rather than long cutscenes.

## Visual factions

Counterterror personnel wear consistent matte-black assault equipment:

- Black helmets, uniforms, plate carriers, and pouches.
- Blue/cyan identification panels and unit markings.
- Professional weapons, optics, and communications equipment.

Calder's professional wing wears olive, charcoal, and mismatched contractor equipment. Local
crews wear civilian clothing with visible tactical equipment once committed to a fight.

Vale wears understated civilian-cut field clothing and light armor. He must be recognizable
through appearance, voice, and behavior rather than a floating marker or boss costume.

## Threat identification

No enemy is identified through walls. Objective and watchdog systems must not draw
wall-penetrating diamonds over hostiles.

Some Calder operatives begin in civilian clothing:

1. **Blended** — no visible weapon and civilian behavior.
2. **Observing** — watches or repositions without attacking.
3. **Drawing** — presents a weapon through a clear, readable animation.
4. **Hostile** — may aim and fire only after the weapon is visible.
5. **Surrendering or fleeing** — possible when stunned, isolated, or overmatched.

A concealed operative cannot damage the player before completing the draw tell. Shooting one
before a weapon is presented is treated as shooting an apparently unarmed person.

## Controlled civilian chaos

Crowded locations must contain meaningful crowds, but civilian behavior is never arbitrary.
Gunfire drives a readable state sequence:

1. Recognition delay: flinch, orient, or hesitate.
2. Decision: freeze, get down, find cover, seek an exit, or follow a nearby group.
3. Movement: use a valid authored destination and navigation route.
4. Reassessment: change behavior only when blocked or exposed to a new threat.

Seeded profiles vary reaction timing and choice between attempts while remaining deterministic
for debugging. Civilians may cross the player's firing lane when a believable escape route
requires it. They do not zigzag randomly or deliberately sabotage a shot.

Freed hostages remain a tactical responsibility. They may follow too closely, freeze in
doorways, panic under fire, or require simple FOLLOW, STAY, and GET DOWN commands before
reaching safety.

## Trustworthy weapons

The visible reticle is authoritative:

- Every aimed shot begins on the camera's actual center ray.
- Visual scope sway and ballistic sway are the same movement.
- A held-breath scoped Barrett shot has zero random spread.
- Recoil and sustained-fire dispersion may move later shots, but the first aimed shot is
  trustworthy.
- Actor hit volumes should match visible anatomy rather than generous proximity spheres.
- Difficulty comes from identification, movement, recoil, civilians, and hostile tactics—not
  a dishonest reticle.

## Controlled variation

Replay variation uses seeded authored choices rather than unrestricted procedural generation:

- Buildings occupy validated lots and swap compatible facade or interior modules.
- Props and cover use authored placement sockets.
- Enemies and hostages select from validated spawn zones.
- Patrols and reinforcements select compatible routes and entrances.
- Vale selects among authored escape routes based on the mission seed and player pressure.
- The seed is retained for replay and bug reproduction.

Generation occurs during mission loading and must not add ongoing GPU cost.

## NPC intelligence

Combat and crowd decisions remain local, deterministic game systems. The local LLM is not part
of the initial build.

Enemy intelligence should grow through utility and behavior systems:

- Sound investigation and last-known-position search.
- Suppression, flanking, retreat, reinforcement, and escape-route defense.
- Limited information sharing rather than perfect faction awareness.
- Moving or guarding hostages.
- Different morale and surrender behavior by Calder role.

The intelligence panel is initially authored and programmatic. An optional local-language-model
adapter may be reconsidered later for between-mission interpretation, never core combat.

## Core identity

Calder creates confusion. Vale exploits response doctrine. The player succeeds through
observation, disciplined force, and a weapon that hits where it is aimed.
