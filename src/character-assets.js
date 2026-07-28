import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { clone as cloneSkeleton } from '../lib/SkeletonUtils.js';
import { quality } from './quality.js';

let source = null;
let clips = [];
let sourceFloor = 0;
let sourceScale = 1;

if (quality.desktop) {
  try {
    const gltf = await new GLTFLoader().loadAsync('./assets/characters/Soldier.glb');
    source = gltf.scene;
    clips = gltf.animations;
    source.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(source);
    sourceScale = 1.78 / Math.max(0.1, box.max.y - box.min.y);
    sourceFloor = box.min.y;
  } catch (error) {
    console.warn('[bp] authored character asset unavailable; using procedural fallback', error);
  }
}

const factionMaterials = new Map();
function factionMaterial(original, faction, silhouette) {
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
    const tint = faction === 'black' ? 0x25292d : faction === 'friendly' ? 0x3b4650 : 0x73765e;
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
  if (!source) return null;
  const root = new THREE.Group();
  const visual = cloneSkeleton(source);
  const faction = friendly ? (black ? 'black' : 'friendly') : 'hostile';
  visual.scale.setScalar(sourceScale);
  visual.position.y = -sourceFloor * sourceScale;
  visual.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = object.receiveShadow = quality.shadows;
    if (Array.isArray(object.material)) {
      object.material = object.material.map(mat => factionMaterial(mat, faction, silhouette));
    } else {
      object.material = factionMaterial(object.material, faction, silhouette);
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
  for (const clip of clips) actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
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
