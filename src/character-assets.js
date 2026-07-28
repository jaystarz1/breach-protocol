import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { clone as cloneSkeleton } from '../lib/SkeletonUtils.js';
import { quality } from './quality.js';

let soldierSource = null;
let soldierClips = [];
let soldierFloor = 0;
let soldierScale = 1;
let civilianSource = null;
let civilianClips = [];
let civilianFloor = 0;
let civilianScale = 1;

if (quality.desktop) {
  try {
    const loader = new GLTFLoader();
    const [soldier, civilian] = await Promise.all([
      loader.loadAsync('./assets/characters/Soldier.glb'),
      loader.loadAsync('./assets/characters/Xbot.glb'),
    ]);
    soldierSource = soldier.scene;
    soldierClips = soldier.animations;
    soldierSource.updateMatrixWorld(true);
    const soldierBox = new THREE.Box3().setFromObject(soldierSource);
    soldierScale = 1.78 / Math.max(0.1, soldierBox.max.y - soldierBox.min.y);
    soldierFloor = soldierBox.min.y;

    civilianSource = civilian.scene;
    civilianClips = civilian.animations;
    civilianSource.updateMatrixWorld(true);
    const civilianBox = new THREE.Box3().setFromObject(civilianSource);
    civilianScale = 1.7 / Math.max(0.1, civilianBox.max.y - civilianBox.min.y);
    civilianFloor = civilianBox.min.y;
  } catch (error) {
    console.warn('[bp] authored character asset unavailable; using procedural fallback', error);
  }
}

const factionMaterials = new Map();
const CIVILIAN_TINTS = [0x58616a, 0x505d59, 0x625b51, 0x4c5661, 0x625a60, 0x5a5449];
const CIVILIAN_COATS = [0x34434d, 0x48524a, 0x51463c, 0x393f4a, 0x50434a, 0x484137];
const CIVILIAN_SKIN = [0xb78b70, 0x8d624b, 0xd0a183, 0x704b3d, 0xc29270, 0x9d6d52];
const COAT_UPPER = new THREE.CapsuleGeometry(0.29, 0.45, 6, 12);
const COAT_LOWER = new THREE.CylinderGeometry(0.31, 0.39, 0.5, 12);
const CIVILIAN_CAP = new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.58);
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
      tint = /joint/i.test(objectName) ? 0x343b42 : CIVILIAN_TINTS[variant % CIVILIAN_TINTS.length];
    }
    out.color.multiply(new THREE.Color(tint));
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
export function createCivilianCharacter() {
  if (!civilianSource) return null;
  const root = new THREE.Group();
  const visual = cloneSkeleton(civilianSource);
  const variant = civilianSequence++ % CIVILIAN_TINTS.length;
  const faction = `civilian-${variant}`;
  visual.scale.setScalar(civilianScale);
  visual.position.y = -civilianFloor * civilianScale;
  visual.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = object.receiveShadow = quality.shadows;
    if (Array.isArray(object.material)) {
      object.material = object.material.map(mat =>
        factionMaterial(mat, faction, false, object.name));
    } else {
      object.material = factionMaterial(object.material, faction, false, object.name);
    }
  });
  root.add(visual);

  // Xbot provides a lightweight skinned silhouette and reliable locomotion, but reads as a
  // training mannequin on its own. Layered winter clothing gives the crowd a grounded
  // frontline identity without loading a unique high-poly outfit for every civilian.
  const coat = new THREE.MeshStandardMaterial({
    color: CIVILIAN_COATS[variant], roughness: 0.92, metalness: 0,
  });
  const upper = new THREE.Mesh(COAT_UPPER, coat);
  upper.position.set(0, 1.18, 0);
  upper.scale.set(1.05, 1, 0.72);
  const lower = new THREE.Mesh(COAT_LOWER, coat);
  lower.position.set(0, 0.92, 0);
  lower.scale.z = 0.72;
  const cap = new THREE.Mesh(CIVILIAN_CAP, new THREE.MeshStandardMaterial({
    color: variant % 2 ? CIVILIAN_SKIN[variant] : CIVILIAN_COATS[(variant + 2) % CIVILIAN_COATS.length],
    roughness: 0.94,
  }));
  cap.position.set(0, 1.63, -0.01);
  cap.rotation.x = -0.08;
  for (const layer of [upper, lower, cap]) {
    layer.castShadow = layer.receiveShadow = quality.shadows;
    root.add(layer);
  }

  const mixer = new THREE.AnimationMixer(visual);
  const actions = {};
  for (const clip of civilianClips) actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
  const idle = actions.idle;
  if (idle) idle.play();
  root.userData.rig = {
    authored: true,
    visual,
    mixer,
    actions,
    currentAction: idle || null,
    lastAnimationTime: performance.now(),
    rifle: null,
    hostile: false,
    friendly: false,
    civilian: true,
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
  rig.rifle.rotation.z += 0.7;
  return true;
}
