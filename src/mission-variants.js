// Bounded replay variation selected once at mission load. Every option is an authored socket:
// no runtime procedural generation, no unconstrained offsets, and no objective geometry moves.

export function seededRandom(seed) {
  let state = (seed || 1) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export const STREET_SHOP_LAYOUTS = Object.freeze([
  Object.freeze([
    Object.freeze({ x: 11, z: 20, w: 9, d: 7, face: 'w', finish: 'plaster', damage: 0 }),
    Object.freeze({ x: 11, z: -5, w: 9, d: 7, face: 'w', finish: 'plaster', damage: 1 }),
    Object.freeze({ x: -11, z: -25, w: 9, d: 7, face: 'e', finish: 'brick', damage: 2 }),
  ]),
  Object.freeze([
    Object.freeze({ x: -11, z: 22, w: 9, d: 7, face: 'e', finish: 'plaster', damage: 0 }),
    Object.freeze({ x: 11, z: 2, w: 9, d: 7, face: 'w', finish: 'plaster', damage: 1 }),
    Object.freeze({ x: 11, z: -26, w: 9, d: 7, face: 'w', finish: 'brick', damage: 2 }),
  ]),
  Object.freeze([
    Object.freeze({ x: 11, z: 28, w: 9, d: 7, face: 'w', finish: 'plaster', damage: 0 }),
    Object.freeze({ x: -11, z: 5, w: 9, d: 7, face: 'e', finish: 'plaster', damage: 1 }),
    Object.freeze({ x: -11, z: -20, w: 9, d: 7, face: 'e', finish: 'brick', damage: 2 }),
  ]),
]);

export function variantIndex(value = window.__bpMissionVariant || 0, count = 3) {
  return ((Number(value) || 0) % count + count) % count;
}

export function streetShopLayout(value = window.__bpMissionVariant || 0) {
  return STREET_SHOP_LAYOUTS[variantIndex(value, STREET_SHOP_LAYOUTS.length)];
}

export function resolveActorVariant(definition, value) {
  const index = variantIndex(value);
  const override = definition.variants?.[
    variantIndex(index, definition.variants.length)
  ] || null;
  const out = override ? { ...definition, ...override } : { ...definition };
  if (!override && definition.positions?.length) {
    out.pos = definition.positions[
      variantIndex(index, definition.positions.length)
    ];
  }
  if (!override && definition.patrols?.length) {
    out.patrol = definition.patrols[
      variantIndex(index, definition.patrols.length)
    ];
  }
  if (out.pos) out.pos = [...out.pos];
  if (out.patrol) out.patrol = out.patrol.map(point => [...point]);
  return out;
}

export function resolveReinforcementVariant(definition, value) {
  if (!definition) return null;
  const out = { ...definition };
  const sockets = definition.atVariants?.[
    variantIndex(value, definition.atVariants.length)
  ] || definition.at;
  out.at = sockets.map(point => [...point]);
  // A zone-armed wave (a rigged room) must follow the room when the room itself is a
  // variant socket — the street-sweep storefronts rotate between three layouts.
  const trigger = definition.triggerVariants?.[
    variantIndex(value, definition.triggerVariants.length)
  ] || definition.trigger;
  if (trigger) out.trigger = { ...trigger, zone: trigger.zone ? [...trigger.zone] : undefined };
  return out;
}

// Count scaling may reuse an actor's behavior, but it must not reuse the actor's occupied
// coordinate. Build a deduplicated pool exclusively from authored positions already validated
// for that mission: base definitions, their bounded position sets, variant overrides and any
// level-level extra sockets.
export function authoredActorSockets(definitions, extraSockets = []) {
  const sockets = [];
  const seen = new Set();
  const add = position => {
    if (!Array.isArray(position) || position.length < 3) return;
    const copy = [Number(position[0]), Number(position[1] ?? 0), Number(position[2])];
    const key = copy.map(value => value.toFixed(3)).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    sockets.push(copy);
  };
  for (const definition of definitions || []) {
    add(definition.pos);
    for (const position of definition.positions || []) add(position);
    for (const variant of definition.variants || []) add(variant.pos);
  }
  for (const position of extraSockets || []) add(position);
  return sockets;
}
