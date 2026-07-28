import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { clone as cloneSkeleton } from '../lib/SkeletonUtils.js';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
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
      loader.loadAsync('./assets/characters/SWAT.glb'),
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
      // The desktop combatant is already a grounded SWAT mesh with distinct body, boot,
      // exposed-skin and visor materials. Multiplying its source albedo preserved the old
      // mustard cast and made opposing forces look like science-fiction toys. Assign a
      // restrained field palette by authored material role instead.
      const label = `${objectName} ${original.name || ''}`.toLowerCase();
      const friendlyBlack = faction === 'black';
      const friendlyBlue = faction === 'friendly';
      if (/(skin)/.test(label)) {
        tint = friendlyBlack ? 0xa8795c : friendlyBlue ? 0x9d7158 : 0x8d654c;
      } else if (/(visor)/.test(label)) {
        tint = 0x090d10;
        out.roughness = 0.38;
        out.metalness = 0.22;
      } else if (/(black|feet|boot)/.test(label)) {
        tint = friendlyBlack ? 0x0d1114 : friendlyBlue ? 0x121a21 : 0x171a16;
      } else {
        tint = friendlyBlack ? 0x181d20 : friendlyBlue ? 0x26343e : 0x3d4232;
      }
      out.color.set(tint);
    }
  }
  if (!/(visor)/i.test(`${objectName} ${original.name || ''}`)) {
    out.roughness = Math.max(0.78, out.roughness ?? 0.84);
    out.metalness = Math.min(0.06, out.metalness ?? 0);
  }
  factionMaterials.set(key, out);
  return out;
}

const mergedCivilianGeometries = new Map();
const MERGED_CIVILIAN_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.86,
  metalness: 0.01,
});
const MERGED_SILHOUETTE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x020305 });

function bakeVertexColor(geometry, material) {
  const materials = Array.isArray(material) ? material : [material];
  const count = geometry.attributes.position.count;
  const values = new Float32Array(count * 3);
  const fill = (start, length, source) => {
    const color = source?.color || new THREE.Color(0xffffff);
    const end = Math.min(count, start + length);
    for (let i = start; i < end; i++) {
      values[i * 3] = color.r;
      values[i * 3 + 1] = color.g;
      values[i * 3 + 2] = color.b;
    }
  };
  fill(0, count, materials[0]);
  // A multi-material skinned mesh stores its garment regions as geometry groups. Preserve
  // those regions when collapsing the actor to one draw instead of painting the entire body
  // with material zero.
  for (const group of geometry.groups || []) {
    fill(group.start, group.count, materials[group.materialIndex] || materials[0]);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
}

// Quaternius' civilians are authored as 7–10 skinned garment/anatomy pieces that all use
// the same skeleton and transform. They animate correctly but each piece is a draw call:
// twenty people in the market cost 163 draws before props, enemies or the squad. Bake each
// piece's flat material colour into vertices and merge the compatible skin streams. The
// silhouette, bones and clips remain untouched; a crowd member becomes one skinned draw.
function mergeCivilianVisual(visual, cacheKey, {
  name = 'civilian-merged-skinned', civilian = true,
} = {}) {
  visual.updateMatrixWorld(true);
  const pieces = [];
  visual.traverse(object => {
    if (object.isSkinnedMesh && object.geometry?.attributes?.skinIndex
      && object.geometry?.attributes?.skinWeight) pieces.push(object);
  });
  if (pieces.length < 2) return null;

  const first = pieces[0];
  const boneNames = first.skeleton.bones.map(bone => bone.name).join('|');
  if (!pieces.every(piece =>
    piece.skeleton.bones.map(bone => bone.name).join('|') === boneNames)) return null;

  let cached = mergedCivilianGeometries.get(cacheKey);
  if (!cached) {
    const geometries = [];
    try {
      for (const piece of pieces) {
        const geometry = piece.geometry.index
          ? piece.geometry.toNonIndexed()
          : piece.geometry.clone();
        // Keep one stable attribute contract across the three source models. Extra exporter
        // UV channels are irrelevant because these CC0 characters use flat material colours.
        for (const name of Object.keys(geometry.attributes)) {
          if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(name)) {
            geometry.deleteAttribute(name);
          }
        }
        bakeVertexColor(geometry, piece.material);
        geometries.push(geometry);
      }
      const geometry = mergeGeometries(geometries, false);
      for (const source of geometries) source.dispose();
      if (!geometry) return null;
      // Every source colour is vertex data now and this skin uses one material. Exporter
      // groups no longer carry meaning and can make the merged actor look multi-draw.
      geometry.clearGroups();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      cached = { geometry, sourceMeshes: pieces.length };
      mergedCivilianGeometries.set(cacheKey, cached);
    } catch (error) {
      for (const geometry of geometries) geometry.dispose();
      console.warn('[bp] civilian skin merge unavailable; keeping source meshes', error);
      return null;
    }
  }

  // Although the exported pieces live below different named groups, their final transform
  // relative to `visual` is identical. Recreate that transform once on the merged skin.
  const relative = visual.matrixWorld.clone().invert().multiply(first.matrixWorld);
  const merged = new THREE.SkinnedMesh(cached.geometry, MERGED_CIVILIAN_MATERIAL);
  relative.decompose(merged.position, merged.quaternion, merged.scale);
  merged.bindMode = first.bindMode;
  merged.bind(first.skeleton, first.bindMatrix);
  merged.name = name;
  merged.castShadow = merged.receiveShadow = quality.shadows;
  merged.frustumCulled = false;
  merged.userData.mergedCivilian = civilian;
  merged.userData.mergedCombatant = !civilian;
  merged.userData.sourceMeshes = cached.sourceMeshes;
  for (const piece of pieces) piece.parent?.remove(piece);
  visual.add(merged);
  return merged;
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
const RESTRAINT_MAT = new THREE.MeshStandardMaterial({
  color: 0x5b574f, roughness: 0.84, metalness: 0.08,
});
const RESTRAINT_RING = new THREE.TorusGeometry(0.035, 0.008, 6, 12);
const HOSTAGE_CHAIR_MAT = new THREE.MeshStandardMaterial({
  color: 0x24292c, roughness: 0.72, metalness: 0.38,
});
const HOSTAGE_CHAIR_PAD = new THREE.MeshStandardMaterial({
  color: 0x34393b, roughness: 0.9, metalness: 0.04,
});
const HOSTAGE_CHAIR_FRAME_GEO = mergedBoxGeometry([
  [-0.18, 0.33, -0.16, 0.035, 0.66, 0.035],
  [-0.18, 0.33, 0.16, 0.035, 0.66, 0.035],
  [0.18, 0.33, -0.16, 0.035, 0.66, 0.035],
  [0.18, 0.33, 0.16, 0.035, 0.66, 0.035],
  [-0.19, 0.98, -0.205, 0.035, 0.72, 0.035],
  [0.19, 0.98, -0.205, 0.035, 0.72, 0.035],
]);
const HOSTAGE_CHAIR_PAD_GEO = mergedBoxGeometry([
  [0, 0.66, -0.01, 0.43, 0.055, 0.4],
  [0, 1.0, -0.205, 0.4, 0.46, 0.045],
]);
const RESTRAINT_TIE_GEO = new THREE.BoxGeometry(1, 1, 1);

function hostageChair() {
  const chair = new THREE.Group();
  chair.name = 'hostage-chair';
  chair.add(
    new THREE.Mesh(HOSTAGE_CHAIR_FRAME_GEO, HOSTAGE_CHAIR_MAT),
    new THREE.Mesh(HOSTAGE_CHAIR_PAD_GEO, HOSTAGE_CHAIR_PAD));
  chair.traverse(object => {
    if (object.isMesh) object.castShadow = object.receiveShadow = quality.shadows;
  });
  return chair;
}

function aimBone(root, bone, child, target) {
  if (!bone || !child) return;
  root.updateMatrixWorld(true);
  const from = child.getWorldPosition(new THREE.Vector3())
    .sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
  const targetWorld = root.localToWorld(target.clone());
  const to = targetWorld.sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const desired = new THREE.Quaternion().setFromUnitVectors(from, to).multiply(world);
  const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parentWorld.multiply(desired));
  root.updateMatrixWorld(true);
}

function findRigObject(visual, name) {
  const direct = visual.getObjectByName(name);
  if (direct) return direct;
  let match = null;
  visual.traverse(object => {
    if (!match && (object.name === name || object.name.endsWith(name))) match = object;
  });
  return match;
}

function poseAuthoredRifle(root, rig) {
  if (!rig.weaponBones) {
    const node = name => findRigObject(rig.visual, name);
    rig.weaponBones = {
      upperL: node('UpperArm.L'), lowerL: node('LowerArm.L'), wristL: node('Wrist.L'),
      upperR: node('UpperArm.R'), lowerR: node('LowerArm.R'), wristR: node('Wrist.R'),
    };
  }
  const b = rig.weaponBones;
  if (rig.weaponPose) {
    b.upperL?.quaternion.copy(rig.weaponPose.upperL);
    b.lowerL?.quaternion.copy(rig.weaponPose.lowerL);
    b.upperR?.quaternion.copy(rig.weaponPose.upperR);
    b.lowerR?.quaternion.copy(rig.weaponPose.lowerR);
    return;
  }
  // Low-ready rather than a rigid T-pose: trigger elbow tucked, support elbow lower and out,
  // wrists converging on two separate points along the handguard.
  aimBone(root, b.upperR, b.lowerR, new THREE.Vector3(-0.27, 1.18, 0.10));
  aimBone(root, b.lowerR, b.wristR, new THREE.Vector3(-0.075, 1.25, 0.32));
  aimBone(root, b.upperL, b.lowerL, new THREE.Vector3(0.34, 1.14, 0.27));
  aimBone(root, b.lowerL, b.wristL, new THREE.Vector3(0.095, 1.24, 0.55));
  // The solve above establishes local rotations once. Locomotion changes those four bones
  // every mixer tick, so restore four cached quaternions afterward instead of repeating four
  // world-matrix traversals for every combatant on every frame.
  rig.weaponPose = {
    upperL: b.upperL?.quaternion.clone(),
    lowerL: b.lowerL?.quaternion.clone(),
    upperR: b.upperR?.quaternion.clone(),
    lowerR: b.lowerR?.quaternion.clone(),
  };
}

function poseAuthoredHostage(root, rig) {
  const action = rig.actions.sitting;
  if (action) {
    // Man_Sitting is a seated loop with a long static hold. Freeze within that hold rather
    // than looping its entry/exit and periodically making a bound person stand up.
    action.paused = false;
    action.time = action.getClip().duration * 0.5;
    rig.mixer.update(0);
    action.paused = true;
  }

  const find = name => {
    const direct = rig.visual.getObjectByName(name);
    if (direct) return direct;
    let match = null;
    rig.visual.traverse(object => {
      if (!match && (object.name === name || object.name.endsWith(name))) match = object;
    });
    return match;
  };
  aimBone(root, find('UpperArm.L'), find('LowerArm.L'),
    new THREE.Vector3(-0.32, 1.12, 0.14));
  aimBone(root, find('LowerArm.L'), find('Palm.L'),
    new THREE.Vector3(-0.065, 1.04, 0.29));
  aimBone(root, find('UpperArm.R'), find('LowerArm.R'),
    new THREE.Vector3(0.32, 1.12, 0.14));
  aimBone(root, find('LowerArm.R'), find('Palm.R'),
    new THREE.Vector3(0.065, 1.04, 0.29));

  const restraint = new THREE.Group();
  root.updateMatrixWorld(true);
  const wristNodes = [
    find('Palm.L') || find('Wrist.L') || find('LowerArm.L'),
    find('Palm.R') || find('Wrist.R') || find('LowerArm.R'),
  ];
  const wristTargets = [
    new THREE.Vector3(-0.065, 1.04, 0.29),
    new THREE.Vector3(0.065, 1.04, 0.29),
  ];
  const wrists = wristNodes.map((palm, index) => palm
    ? root.worldToLocal(palm.getWorldPosition(new THREE.Vector3()))
    : wristTargets[index]);
  for (const wrist of wrists) {
    const cuff = new THREE.Mesh(RESTRAINT_RING, RESTRAINT_MAT);
    cuff.position.copy(wrist);
    cuff.rotation.y = Math.PI / 2;
    restraint.add(cuff);
  }
  const midpoint = wrists[0].clone().add(wrists[1]).multiplyScalar(0.5);
  const tie = new THREE.Mesh(RESTRAINT_TIE_GEO, RESTRAINT_MAT);
  tie.scale.set(Math.max(0.04, wrists[0].distanceTo(wrists[1])), 0.012, 0.012);
  tie.position.copy(midpoint);
  tie.rotation.z = Math.atan2(
    wrists[1].y - wrists[0].y, wrists[1].x - wrists[0].x);
  restraint.add(tie);
  restraint.traverse(object => {
    if (object.isMesh) object.castShadow = quality.shadows;
  });
  root.add(restraint);
  rig.restraint = restraint;
  const seat = hostageChair();
  root.add(seat);
  rig.seat = seat;
}

function patch(color, position, scale) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color }));
  mesh.position.fromArray(position);
  mesh.scale.fromArray(scale);
  return mesh;
}

function mapActions(clips, mixer) {
  const actions = {};
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    const full = clip.name.toLowerCase();
    const short = full.split('|').pop();
    actions[full] = action;
    actions[short] = action;
    if (short.endsWith('_idle')) actions.idle = action;
    if (short.endsWith('_run')) actions.run = action;
    if (short.endsWith('_walk')) actions.walk = action;
    if (short.endsWith('_sitting')) actions.sitting = action;
    if (short.endsWith('_death') || short === 'death') actions.death = action;
  }
  return actions;
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
  const mergedSkin = mergeCivilianVisual(
    visual, `combatant:${faction}:${silhouette ? 'silhouette' : 'lit'}`, {
    name: 'combatant-merged-skinned',
    civilian: false,
  });
  if (mergedSkin && silhouette) mergedSkin.material = MERGED_SILHOUETTE_MATERIAL;
  root.add(visual);

  const rifle = new THREE.Mesh(RIFLE_GEO, silhouette
    ? new THREE.MeshBasicMaterial({ color: 0x020305 })
    : RIFLE_MAT);
  // Low-ready on the actor's forward axis. The previous ninety-degree rotation made the gun
  // a broad rectangular bar floating across the chest whenever an enemy faced the player.
  // A real rifle aimed at you foreshortens; posture and faction kit carry identification.
  rifle.position.set(0.03, 1.22, 0.26);
  rifle.rotation.set(0.03, Math.PI - 0.16, -0.04);
  rifle.castShadow = quality.shadows;
  root.add(rifle);

  if (!silhouette && friendly) {
    root.add(
      patch(0x4f96a8, [0, 1.42, 0.245], [0.075, 0.025, 0.014]),
      patch(0x4f96a8, [0, 1.42, -0.245], [0.075, 0.025, 0.014]),
    );
  } else if (!silhouette) {
    // Small shoulder tape, not a floating faction bar. Identification must come from the
    // uniform, weapon and behavior at useful range rather than a red UI-like slab.
    root.add(patch(0x922a25, [-0.31, 1.36, 0], [0.035, 0.09, 0.12]));
  }

  const mixer = new THREE.AnimationMixer(visual);
  const actions = mapActions(soldierClips, mixer);
  // This asset includes weapon-specific upper-body work. Prefer it over the neutral clips so
  // hands remain on the rifle instead of swinging like an unarmed mannequin.
  actions.combatIdle = actions.idle_gun || actions.idle_gun_shoot || actions.idle;
  actions.combatRun = actions.run_shoot || actions.run || actions.walk;
  const idle = actions.combatIdle;
  if (idle) idle.play();
  root.userData.rig = {
    authored: true,
    visual,
    mixer,
    actions,
    currentAction: idle || null,
    lastAnimationTime: performance.now(),
    rifle,
    mergedSkin,
    hostile: true,
    friendly: !!friendly,
    combatant: true,
    baseVisualY: visual.position.y,
  };
  root.userData.rig.applyWeaponPose = () => poseAuthoredRifle(root, root.userData.rig);
  root.userData.rig.applyWeaponPose();
  root.userData.bob = 0;
  return root;
}

let civilianSequence = 0;
export function createCivilianCharacter({
  concealed = false, hostage = false, variant: requestedVariant,
} = {}) {
  if (!civilianSources.length) return null;
  const root = new THREE.Group();
  const sequence = requestedVariant ?? civilianSequence++;
  const variant = Math.abs(sequence) % CIVILIAN_TOPS.length;
  // LongSleeve carries a real seated clip. Bound people all use that skeleton so their
  // restraint pose is authored rather than approximated by rotating an upright mannequin's
  // box limbs. Palette variation still prevents a hostage group becoming identical clones.
  const source = hostage
    ? civilianSources[1]
    : civilianSources[Math.abs(sequence) % civilianSources.length];
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
  const sourceIndex = civilianSources.indexOf(source);
  const mergedSkin = mergeCivilianVisual(visual, `${sourceIndex}:${variant}`);
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
  const actions = mapActions(source.clips, mixer);
  const idle = actions.idle || actions.idle_neutral;
  const initial = hostage ? (actions.sitting || idle) : idle;
  if (initial) initial.play();
  root.userData.rig = {
    authored: true,
    visual,
    mixer,
    actions,
    currentAction: initial || null,
    lastAnimationTime: performance.now(),
    rifle,
    hostile: false,
    friendly: false,
    civilian: true,
    civilianSource: sourceIndex,
    mergedSkin,
    concealed,
    hostage,
    baseVisualY: visual.position.y,
  };
  if (hostage) poseAuthoredHostage(root, root.userData.rig);
  root.userData.bob = 0;
  return root;
}

export function animateAuthoredCharacter(root, moving, flinch = 0) {
  const rig = root.userData.rig;
  if (!rig?.authored) return;
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0, (now - rig.lastAnimationTime) / 1000));
  rig.lastAnimationTime = now;
  if (rig.hostage) {
    rig.mixer.update(dt);
    root.userData.bob = 0;
    return;
  }
  const desired = moving
    ? (rig.actions.combatRun || rig.actions.run || rig.actions.walk || rig.actions.character_walk)
    : (rig.actions.combatIdle || rig.actions.idle || rig.actions.character_idle);
  if (desired && desired !== rig.currentAction) {
    desired.reset().fadeIn(0.14).play();
    rig.currentAction?.fadeOut(0.14);
    rig.currentAction = desired;
  }
  rig.mixer.update(dt);
  if (rig.combatant) poseAuthoredRifle(root, rig);
  const hit = flinch * 3.2;
  rig.visual.rotation.x = -hit * 0.12;
  rig.visual.rotation.z = hit * 0.07;
  root.userData.bob = 0;
}

export function releaseAuthoredHostage(root) {
  const rig = root.userData.rig;
  if (!rig?.authored || !rig.hostage) return false;
  rig.hostage = false;
  if (rig.restraint) rig.restraint.visible = false;
  // The hostage walks away; the chair does not. Reparent while preserving its world
  // transform so the room retains physical evidence of where the captive was held.
  if (rig.seat && root.parent) {
    root.parent.attach(rig.seat);
    rig.seat = null;
  }
  const idle = rig.actions.idle || rig.actions.character_idle;
  if (idle && idle !== rig.currentAction) {
    idle.reset().fadeIn(0.2).play();
    rig.currentAction?.fadeOut(0.2);
    rig.currentAction = idle;
  }
  rig.lastAnimationTime = performance.now();
  return true;
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
