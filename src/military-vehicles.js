// Authored military vehicle pool for the drone missions. The procedural strike targets in
// drone.js defined the game's vehicle scale; every model here is normalized at load to the
// procedural hull width of the slot it fills, so swapping skins never moves a hitbox or a
// heat signature. Sources and licenses: assets/vehicles/NOTICE.md.
import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { quality } from './quality.js';

// Facing: the game's vehicles drive along local -X. Sketchfab exports arrive nose-to-+X
// once their long axis is rotated onto X, so models default to a PI yaw fix; exceptions
// are recorded per model after test-flight review (tools/qa-military-vehicles.py).
const SLOT_WIDTHS = { tank: 2.55, apc: 2.15, jeep: 1.85, truck: 1.75, tanker: 1.75 };

const MODEL_SPECS = {
  t72: { file: 't72-forthood.glb', slot: 'tank' },
  t64: { file: 't64.glb', slot: 'tank' },
  t90: { file: 't90.glb', slot: 'tank' },
  // The BMP scan's raw bounds run wide (open hatches), so it normalizes by hull length.
  bmp2: { file: 'bmp2-scan.glb', slot: 'apc', scaleLength: 4.7 },
  mtlb: { file: 'mtlb.glb', slot: 'apc' },
  // The BTR-70 model ships with no material colors (renders clay white); tint it olive.
  btr70: { file: 'btr70.glb', slot: 'apc', tint: 0x49523f },
  uaz469: { file: 'uaz469.glb', slot: 'jeep' },
  tigr: { file: 'gaz-tigr.glb', slot: 'jeep' },
  uralMilitary: { file: 'ural4320-military.glb', slot: 'truck' },
  uralCargo: { file: 'ural4320-cargo.glb', slot: 'truck' },
  gaz66: { file: 'gaz66.glb', slot: 'truck' },
  kamaz: { file: 'kamaz5330.glb', slot: 'truck' },
  uralFuel: { file: 'ural-atz-fuel.glb', slot: 'tanker' },
  tankerGreen: { file: 'tanker-rigged.glb', slot: 'tanker' },
};

// kind → ordered variant list. Order is the deterministic roll table: seed % weight-sum
// walks it, so authored missions replay identically. Tanks lean T-72 with the T-90 rare.
const KIND_POOLS = {
  tank: [['t72', 3], ['t64', 2], ['t90', 1]],
  apc: [['bmp2', 3], ['mtlb', 2], ['btr70', 2]],
  jeep: [['uaz469', 1], ['tigr', 1]],
  truck: [['uralMilitary', 2], ['uralCargo', 2], ['gaz66', 1], ['kamaz', 1]],
  tanker: [['uralFuel', 3], ['tankerGreen', 2]],
};

let militarySources = null;
if (quality.desktop) {
  try {
    const loader = new GLTFLoader();
    const entries = Object.entries(MODEL_SPECS);
    const loaded = await Promise.all(entries.map(([, spec]) =>
      loader.loadAsync(`./assets/vehicles/military/${spec.file}`)
        .catch(error => {
          console.warn(`[bp] military vehicle ${spec.file} unavailable`, error);
          return null;
        })));
    militarySources = {};
    for (const [index, [name, spec]] of entries.entries()) {
      const gltf = loaded[index];
      if (!gltf) continue;
      militarySources[name] = normalizeSource(gltf.scene, spec);
    }
  } catch (error) {
    console.warn('[bp] military vehicle pool unavailable; procedural targets remain', error);
    militarySources = null;
  }
}

function normalizeSource(scene, spec) {
  const template = new THREE.Group();
  template.add(scene);
  scene.updateMatrixWorld(true);
  // Precise bounds, always: rotated mesh nodes (the UAZ-469's whole body hangs under a
  // tilted node) inflate the default rotated-AABB measurement, which grounded that car a
  // full metre in the air and skewed its width normalization.
  let bounds = new THREE.Box3().setFromObject(scene, true);
  let size = bounds.getSize(new THREE.Vector3());
  // Hull length belongs on X, the game's vehicle axis.
  if (size.z > size.x) {
    scene.rotation.y = Math.PI / 2;
    scene.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(scene, true);
    size = bounds.getSize(new THREE.Vector3());
  }
  const scale = spec.scaleLength
    ? spec.scaleLength / size.x
    : SLOT_WIDTHS[spec.slot] / size.z;
  scene.scale.setScalar(scale);
  scene.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(scene, true);
  const center = bounds.getCenter(new THREE.Vector3());
  scene.position.x -= center.x;
  scene.position.z -= center.z;
  scene.position.y -= bounds.min.y;
  // Nose-to-+X convention; the wrap group carries the flip so callers see -X forward.
  template.rotation.y = spec.yaw ?? Math.PI;
  template.userData.length = Math.max(size.x, size.z);
  template.userData.height = size.y;
  template.traverse(object => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      if (spec.tint) {
        for (const material of [].concat(object.material)) {
          material?.color?.set(spec.tint);
        }
      }
    }
  });
  return template;
}

// The legacy strike kinds map onto pool slots; new-style level defs can also name the
// pool kinds (jeep/truck/tanker) directly.
const KIND_ALIASES = { armor: 'apc', technical: 'jeep', ew: 'truck' };

// Mission labels name real vehicles ("T-72B3 PATROL", "BTR-82A"); when a label names a
// model the pool holds, the skin honors it instead of rolling the variant table.
const LABEL_MATCHERS = [
  [/T-?72/i, 't72'], [/T-?64/i, 't64'], [/T-?90/i, 't90'],
  [/BMP/i, 'bmp2'], [/MT-?LB/i, 'mtlb'], [/BTR/i, 'btr70'],
  [/UAZ/i, 'uaz469'], [/TIGR/i, 'tigr'],
  [/URAL/i, 'uralMilitary'], [/GAZ-?66/i, 'gaz66'], [/KAMAZ/i, 'kamaz'],
];

export function militaryVehicleNameForLabel(label) {
  if (!label) return null;
  for (const [pattern, name] of LABEL_MATCHERS) {
    if (pattern.test(label)) return name;
  }
  return null;
}

export function militaryVehicleVariant(kind, seed = 0) {
  if (!militarySources) return null;
  const pool = KIND_POOLS[KIND_ALIASES[kind] || kind];
  if (!pool) return null;
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = ((Math.floor(seed) % total) + total) % total;
  for (const [name, weight] of pool) {
    roll -= weight;
    if (roll < 0) return militarySources[name] ? name : null;
  }
  return null;
}

// Fresh instance with per-instance materials, so a strike can char one vehicle without
// repainting every sibling sharing the source model. Geometry stays shared.
export function militaryVehicleModel(nameOrKind, seed = 0) {
  if (!militarySources) return null;
  const name = militarySources[nameOrKind]
    ? nameOrKind
    : militaryVehicleVariant(nameOrKind, seed);
  if (!name || !militarySources[name]) return null;
  const instance = militarySources[name].clone(true);
  const cloned = new Map();
  instance.traverse(object => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const replaced = materials.map(material => {
      if (!material) return material;
      if (!cloned.has(material)) cloned.set(material, material.clone());
      return cloned.get(material);
    });
    object.material = Array.isArray(object.material) ? replaced : replaced[0];
  });
  instance.userData.variant = name;
  instance.userData.length = militarySources[name].userData.length;
  instance.userData.height = militarySources[name].userData.height;
  return instance;
}
