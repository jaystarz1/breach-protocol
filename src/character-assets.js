import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { clone as cloneSkeleton } from '../lib/SkeletonUtils.js';
import { quality } from './quality.js';

let soldierSource = null;
let soldierClips = [];
let soldierFloor = 0;
let soldierScale = 1;
let civilianSources = [];

if (quality.desktop) {
  try {
    const loader = new GLTFLoader();
    const [soldier, ...civilians] = await Promise.all([
      loader.loadAsync('./assets/characters/Soldier.glb'),
      loader.loadAsync('./assets/characters/CivilianCasual.glb'),
      loader.loadAsync('./assets/characters/CivilianLongSleeve.glb'),
      loader.loadAsync('./assets/characters/CivilianWoman.glb'),
    ]);
    soldierSource = soldier.scene;
    soldierClips = soldier.animations;
    soldierSource.updateMatrixWorld(true);
    const soldierBox = new THREE.Box3().setFromObject(soldierSource);
    soldierScale = 1.78 / Math.max(0.1, soldierBox.max.y - soldierBox.min.y);
    soldierFloor = soldierBox.min.y;

    civilianSources = civilians.map(civilian => {
      civilian.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(civilian.scene);
      return {
        scene: civilian.scene,
        clips: civilian.animations,
        scale: 1.7 / Math.max(0.1, box.max.y - box.min.y),
        floor: box.min.y,
      };
    });
  } catch (error) {
    console.warn('[bp] authored character asset unavailable; using procedural fallback', error);
  }
}

const factionMaterials = new Map();
const CIVILIAN_PANTS = [0x29333d, 0x31382f, 0x40382f, 0x283345, 0x373a33, 0x37352d];
const CIVILIAN_TOPS = [0x43505a, 0x4a584c, 0x5e5042, 0x38475a, 0x545044, 0x4f463b];
const CIVILIAN_SHOES = [0x24282b, 0x302924, 0x232a30, 0x362b27, 0x27282a, 0x312f2b];
function factionMaterial(original, faction, silhouette, objectName = '') {
  if (silhouette) {
    const key = `silhouette:${original.uuid}`;
    if (!factionMaterials.has(key)) {
      factionMaterials.set(key, new THREE.MeshBasicMaterial({
        color: 0x020305,
      }));
    }
    return factionMaterials.get(key);
  }
  const key = `${faction}:${original.uuid}`;
  if (factionMaterials.has(key)) return factionMaterials.get(key);
  const out = original.clone();
  if (out.color) {
    let tint = faction === 'black' ? 0x25292d : faction === 'friendly' ? 0x3b4650 : 0x73765e;
    if (faction.startsWith('civilian-')) {
      const variant = Number(faction.slice(9)) || 0;
      const label = `${objectName} ${original.name || ''}`.toLowerCase();
      // Preserve anatomical materials. Only clothes are recolored, by garment rather than
      // globally, so a variant retains skin, hair, eyes and brows instead of becoming a
      // monochrome faction pawn.
      if (!/(skin|eye|eyebrow|hair)/.test(label)) {
        if (/(feet|shoe|sock)/.test(label)) tint = CIVILIAN_SHOES[variant % CIVILIAN_SHOES.length];
        else if (/(legs|pants|trouser)/.test(label)) tint = CIVILIAN_PANTS[variant % CIVILIAN_PANTS.length];
        else tint = CIVILIAN_TOPS[variant % CIVILIAN_TOPS.length];
        out.color.set(tint);
      }
    } else {
      out.color.multiply(new THREE.Color(tint));
    }
  }
  out.roughness = Math.max(0.72, out.roughness ?? 0.8);
  out.metalness = Math.min(0.08, out.metalness ?? 0);
  factionMaterials.set(key, out);
  return out;
}

function mergedBoxGeometry(parts) {
  const positions = [], normals = [], uvs = [];
  for (const [x, y, z, sx, sy, sz] of parts) {
    const geometry = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
    geometry.translate(x, y, z);
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    geometry.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.computeBoundingSphere();
  return out;
}

const RIFLE_GEO = mergedBoxGeometry([
  [0, 0, -0.12, 0.075, 0.11, 0.3],
  [0, 0, -0.39, 0.06, 0.075, 0.27],
  [0, 0, -0.68, 0.025, 0.025, 0.34],
  [0, 0, 0.14, 0.065, 0.085, 0.22],
  [0, -0.045, 0.27, 0.06, 0.14, 0.12],
  [0, -0.11, -0.14, 0.065, 0.18, 0.1],
  [0, 0.09, -0.22, 0.055, 0.07, 0.13],
]);
const RIFLE_MAT = new THREE.MeshStandardMaterial({
  color: 0x0b0e11, roughness: 0.44, metalness: 0.58,
});

function patch(color, position, scale) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color }));
  mesh.position.fromArray(position);
  mesh.scale.fromArray(scale);
  return mesh;
}

export function createAuthoredCharacter({ friendly, black, silhouette }) {
  if (!soldierSource) return null;
  const root = new THREE.Group();
  const visual = cloneSkeleton(soldierSource);
  const faction = friendly ? (black ? 'black' : 'friendly') : 'hostile';
  visual.scale.setScalar(soldierScale);
  visual.position.y = -soldierFloor * soldierScale;
  visual.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = object.receiveShadow = quality.shadows;
    if (Array.isArray(object.material)) {
      object.material = object.material.map(mat =>
        factionMaterial(mat, faction, silhouette, object.name));
    } else {
      object.material = factionMaterial(object.material, faction, silhouette, object.name);
    }
  });
  root.add(visual);

  const rifle = new THREE.Mesh(RIFLE_GEO, silhouette
    ? new THREE.MeshBasicMaterial({ color: 0x020305 })
    : RIFLE_MAT);
  // Carried diagonally across the chest. A rifle pointed exactly down the actor's forward
  // axis collapses to a tiny rectangle and makes an armed man look unarmed head-on.
  rifle.position.set(0.04, 1.23, 0.27);
  rifle.rotation.set(0, Math.PI / 2, -0.36);
  rifle.castShadow = quality.shadows;
  root.add(rifle);

  if (!silhouette && friendly) {
    root.add(
      patch(0x38e8ff, [0, 1.42, 0.245], [0.18, 0.045, 0.018]),
      patch(0x38e8ff, [0, 1.42, -0.245], [0.18, 0.045, 0.018]),
    );
  } else if (!silhouette) {
    // Small shoulder tape, not a floating faction bar. Identification must come from the
    // uniform, weapon and behavior at useful range rather than a red UI-like slab.
    root.add(patch(0x922a25, [-0.31, 1.36, 0], [0.035, 0.09, 0.12]));
  }

  const mixer = new THREE.AnimationMixer(visual);
  const actions = {};
  for (const clip of soldierClips) actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
  const idle = actions.idle || actions.character_idle;
  if (idle) idle.play();
  root.userData.rig = {
    authored: true,
    visual,
    mixer,
    actions,
    currentAction: idle || null,
    lastAnimationTime: performance.now(),
    rifle,
    hostile: true,
    friendly: !!friendly,
    baseVisualY: visual.position.y,
  };
  root.userData.bob = 0;
  return root;
}

let civilianSequence = 0;
export function createCivilianCharacter({ concealed = false, variant: requestedVariant } = {}) {
  if (!civilianSources.length) return null;
  const root = new THREE.Group();
  const sequence = requestedVariant ?? civilianSequence++;
  const variant = Math.abs(sequence) % CIVILIAN_TOPS.length;
  const source = civilianSources[Math.abs(sequence) % civilianSources.length];
  const visual = cloneSkeleton(source.scene);
  const faction = `civilian-${variant}`;
  visual.scale.setScalar(source.scale);
  visual.position.y = -source.floor * source.scale;
  visual.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = object.receiveShadow = quality.shadows;
    if (Array.isArray(object.material)) {
      object.material = object.material.map(mat =>
        factionMaterial(mat, faction, false, `${object.name}:${mat.name}`));
    } else {
      object.material = factionMaterial(
        object.material, faction, false, `${object.name}:${object.material?.name || ''}`);
    }
  });
  root.add(visual);

  // Concealed shooters use this exact civilian presentation—same source model, palette and
  // clothing. The hidden rifle exists only as the reveal contract consumed by levelgen; it
  // never renders before the enemy presents a weapon.
  let rifle = null;
  if (concealed) {
    rifle = new THREE.Mesh(RIFLE_GEO, RIFLE_MAT);
    rifle.visible = false;
    root.add(rifle);
  }

  const mixer = new THREE.AnimationMixer(visual);
  const actions = {};
  for (const clip of source.clips) {
    const action = mixer.clipAction(clip);
    const full = clip.name.toLowerCase();
    const short = full.split('|').pop();
    actions[full] = action;
    actions[short] = action;
    if (short.endsWith('_idle')) actions.idle = action;
    if (short.endsWith('_run')) actions.run = action;
    if (short.endsWith('_walk')) actions.walk = action;
  }
  const idle = actions.idle || actions.idle_neutral;
  if (idle) idle.play();
  root.userData.rig = {
    authored: true,
    visual,
    mixer,
    actions,
    currentAction: idle || null,
    lastAnimationTime: performance.now(),
    rifle,
    hostile: false,
    friendly: false,
    civilian: true,
    civilianSource: civilianSources.indexOf(source),
    concealed,
    baseVisualY: visual.position.y,
  };
  root.userData.bob = 0;
  return root;
}

export function animateAuthoredCharacter(root, moving, flinch = 0) {
  const rig = root.userData.rig;
  if (!rig?.authored) return;
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0, (now - rig.lastAnimationTime) / 1000));
  rig.lastAnimationTime = now;
  const desired = moving
    ? (rig.actions.run || rig.actions.walk || rig.actions.character_walk)
    : (rig.actions.idle || rig.actions.character_idle);
  if (desired && desired !== rig.currentAction) {
    desired.reset().fadeIn(0.14).play();
    rig.currentAction?.fadeOut(0.14);
    rig.currentAction = desired;
  }
  rig.mixer.update(dt);
  const hit = flinch * 3.2;
  rig.visual.rotation.x = -hit * 0.12;
  rig.visual.rotation.z = hit * 0.07;
  root.userData.bob = 0;
}

export function kneelAuthoredCharacter(root, amount) {
  const rig = root.userData.rig;
  if (!rig?.authored) return;
  rig.visual.position.y = rig.baseVisualY - 0.32 * amount;
  rig.visual.rotation.x = -0.16 * amount;
}

export function stopAuthoredCharacter(root) {
  const rig = root.userData.rig;
  if (!rig?.authored) return false;
  rig.mixer.stopAllAction();
  if (rig.rifle) rig.rifle.rotation.z += 0.7;
  return true;
}
