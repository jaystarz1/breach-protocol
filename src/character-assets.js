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
let authoredRifleGeometry = null;
let authoredRifleSourceParts = 0;
let combatantFabricNormal = null;
let combatantFabricRoughness = null;

if (quality.desktop) {
  try {
    const loader = new GLTFLoader();
    const [soldier, ...civiliansAndRifle] = await Promise.all([
      loader.loadAsync('./assets/characters/SWAT.glb'),
      loader.loadAsync('./assets/characters/CivilianCasual.glb'),
      loader.loadAsync('./assets/characters/CivilianLongSleeve.glb'),
      loader.loadAsync('./assets/characters/CivilianWoman.glb'),
      loader.loadAsync('./assets/weapons/AssaultRifleWest.glb').catch(error => {
        console.warn('[bp] authored carried rifle unavailable; using procedural fallback', error);
        return null;
      }),
    ]);
    const rifleAsset = civiliansAndRifle.pop();
    const civilians = civiliansAndRifle;
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
    if (rifleAsset) {
      const prepared = prepareCarriedRifleGeometry(rifleAsset.scene);
      authoredRifleGeometry = prepared?.geometry || null;
      authoredRifleSourceParts = prepared?.sourceParts || 0;
    }
  } catch (error) {
    console.warn('[bp] authored character asset unavailable; using procedural fallback', error);
  }
}

if (quality.desktop) {
  try {
    const loader = new THREE.TextureLoader();
    [combatantFabricNormal, combatantFabricRoughness] = await Promise.all([
      loader.loadAsync('./assets/characters/materials/fabric074-normal.webp'),
      loader.loadAsync('./assets/characters/materials/fabric074-roughness.webp'),
    ]);
    for (const texture of [combatantFabricNormal, combatantFabricRoughness]) {
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(8, 8);
      texture.anisotropy = Math.min(quality.maxAnisotropy || 4, 8);
    }
  } catch (error) {
    console.warn('[bp] scanned combatant fabric unavailable; using flat gear material', error);
  }
}

const factionMaterials = new Map();
const CIVILIAN_PANTS = [0x29333d, 0x31382f, 0x40382f, 0x283345, 0x373a33, 0x37352d];
const CIVILIAN_TOPS = [0x43505a, 0x4a584c, 0x5e5042, 0x38475a, 0x545044, 0x4f463b];
const CIVILIAN_SHOES = [0x24282b, 0x302924, 0x232a30, 0x362b27, 0x27282a, 0x312f2b];
const CIVILIAN_SKIN = [0xc18c70, 0x9f6f55, 0xd0a083, 0x7f5945, 0xb47d61, 0xd6ad92];
const CIVILIAN_HAIR = [0x2a201a, 0x4a3527, 0x756044, 0x191919, 0x5d4030, 0x9a835f];
const CIVILIAN_HEIGHT = [0.97, 1.025, 0.99, 1.045, 0.955, 1.01];
const CIVILIAN_WIDTH = [0.94, 1.035, 0.98, 1.07, 0.965, 1.01];
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
      if (label.includes('skin')) {
        out.color.set(CIVILIAN_SKIN[variant % CIVILIAN_SKIN.length]);
        out.roughness = 0.62;
      } else if (/(hair|eyebrow|brow)/.test(label)) {
        out.color.set(CIVILIAN_HAIR[variant % CIVILIAN_HAIR.length]);
        out.roughness = 0.5;
      } else if (!label.includes('eye')) {
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
      const bastion = faction === 'bastion';
      if (/(skin)/.test(label)) {
        tint = friendlyBlack ? 0xa8795c
          : friendlyBlue ? 0x9d7158
            : bastion ? 0x9a6c52 : 0x8d654c;
      } else if (/(visor)/.test(label)) {
        tint = 0x090d10;
        out.roughness = 0.38;
        out.metalness = 0.22;
      } else if (/(black|feet|boot)/.test(label)) {
        tint = friendlyBlack ? 0x0d1114
          : friendlyBlue ? 0x121a21
            : bastion ? 0x101315 : 0x171a16;
      } else {
        tint = friendlyBlack ? 0x181d20
          : friendlyBlue ? 0x26343e
            : bastion ? 0x282c2d : 0x3d4232;
      }
      out.color.set(tint);
    }
  }
  const finalLabel = `${objectName} ${original.name || ''}`.toLowerCase();
  const civilianAnatomy = faction.startsWith('civilian-')
    && /(skin|hair|eyebrow|brow)/.test(finalLabel);
  if (!finalLabel.includes('visor') && !civilianAnatomy) {
    out.roughness = Math.max(0.78, out.roughness ?? 0.84);
    out.metalness = Math.min(0.06, out.metalness ?? 0);
  }
  factionMaterials.set(key, out);
  return out;
}

const mergedCivilianGeometries = new Map();
const MERGED_CIVILIAN_MATERIAL = new THREE.MeshStandardMaterial({
  name: 'civilian-layered-surface',
  vertexColors: true,
  roughness: 0.86,
  metalness: 0.01,
  normalMap: combatantFabricNormal,
  normalScale: new THREE.Vector2(0.24, 0.24),
  roughnessMap: combatantFabricRoughness,
});
MERGED_CIVILIAN_MATERIAL.onBeforeCompile = shader => {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute float fabricMask;
attribute float skinMask;
attribute float hairMask;
attribute float eyeMask;
varying float vFabricMask;
varying float vSkinMask;
varying float vHairMask;
varying float vEyeMask;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vFabricMask = fabricMask;
vSkinMask = skinMask;
vHairMask = hairMask;
vEyeMask = eyeMask;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying float vFabricMask;
varying float vSkinMask;
varying float vHairMask;
varying float vEyeMask;`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
roughnessFactor = mix(0.72, roughnessFactor, vFabricMask);
roughnessFactor = mix(roughnessFactor, 0.62, vSkinMask);
roughnessFactor = mix(roughnessFactor, 0.5, vHairMask);`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `vec3 bpBaseNormal = normal;
#include <normal_fragment_maps>
normal = normalize(mix(bpBaseNormal, normal, vFabricMask));`,
    )
    .replace(
      '#include <opaque_fragment>',
      `// Skin gets a restrained warm bounce while the authored eye geometry receives a
// tiny cool catchlight. Both are material-role masks baked before the one-draw merge.
outgoingLight += diffuseColor.rgb * vSkinMask * 0.055;
outgoingLight += vec3(0.026, 0.031, 0.034) * vEyeMask;
#include <opaque_fragment>`,
    );
};
MERGED_CIVILIAN_MATERIAL.customProgramCacheKey = () => 'bp-civilian-surface-v2';
const MERGED_COMBATANT_MATERIAL = new THREE.MeshStandardMaterial({
  name: 'combatant-scanned-fabric',
  vertexColors: true,
  roughness: 0.88,
  metalness: 0.025,
  normalMap: combatantFabricNormal,
  normalScale: new THREE.Vector2(0.3, 0.3),
  roughnessMap: combatantFabricRoughness,
});
MERGED_COMBATANT_MATERIAL.onBeforeCompile = shader => {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute float fabricMask;
attribute float visorMask;
varying float vFabricMask;
varying float vVisorMask;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vFabricMask = fabricMask;
vVisorMask = visorMask;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying float vFabricMask;
varying float vVisorMask;`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
roughnessFactor = mix(roughness, roughnessFactor, vFabricMask);
roughnessFactor = mix(roughnessFactor, 0.32, vVisorMask);`,
    )
    .replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.2, vVisorMask);`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `vec3 bpBaseNormal = normal;
#include <normal_fragment_maps>
normal = normalize(mix(bpBaseNormal, normal, vFabricMask));`,
    )
    .replace(
      '#include <opaque_fragment>',
      `float bpVisorFresnel = pow(
  1.0 - saturate(dot(geometryNormal, geometryViewDir)), 2.0);
outgoingLight += vVisorMask * (0.014 + bpVisorFresnel * 0.055)
  * vec3(0.35, 0.62, 0.74);
#include <opaque_fragment>`,
    );
};
MERGED_COMBATANT_MATERIAL.customProgramCacheKey = () => 'bp-combatant-surface-v2';
const MERGED_SILHOUETTE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x020305 });

function bakeVertexColor(geometry, material, surfaceRoles = false, objectName = '') {
  const materials = Array.isArray(material) ? material : [material];
  const count = geometry.attributes.position.count;
  const values = new Float32Array(count * 3);
  const fabricValues = surfaceRoles ? new Float32Array(count) : null;
  const visorValues = surfaceRoles === 'combatant' ? new Float32Array(count) : null;
  const skinValues = surfaceRoles === 'civilian' ? new Float32Array(count) : null;
  const hairValues = surfaceRoles === 'civilian' ? new Float32Array(count) : null;
  const eyeValues = surfaceRoles === 'civilian' ? new Float32Array(count) : null;
  const fill = (start, length, source) => {
    const color = source?.color || new THREE.Color(0xffffff);
    const materialLabel = source?.name?.toLowerCase() || '';
    const label = `${objectName} ${materialLabel}`.toLowerCase();
    const skin = surfaceRoles === 'civilian' && label.includes('skin') ? 1 : 0;
    const hair = surfaceRoles === 'civilian'
      && /(hair|eyebrow|brow)/.test(label) ? 1 : 0;
    // CivilianWoman exports its 48-vertex eye primitive as the generic material "Brown".
    // Its mesh position in the authored head stack is stable and matches the explicitly
    // named eye primitive in the other civilian sources.
    const eye = surfaceRoles === 'civilian'
      && (/([^a-z]|^)eyes?([^a-z]|$)/.test(materialLabel)
        || /head_4([^0-9]|$)/.test(objectName.toLowerCase())) ? 1 : 0;
    const fabric = surfaceRoles === 'civilian'
      ? (eye || /(skin|eye|hair|eyebrow|brow)/.test(label) ? 0 : 1)
      : (label.includes('skin') || label.includes('visor')
        ? 0
        : label.includes('black') ? 0.38 : 1);
    const visor = surfaceRoles === 'combatant' && label.includes('visor') ? 1 : 0;
    const end = Math.min(count, start + length);
    for (let i = start; i < end; i++) {
      values[i * 3] = color.r;
      values[i * 3 + 1] = color.g;
      values[i * 3 + 2] = color.b;
      if (surfaceRoles) {
        fabricValues[i] = fabric;
        if (visorValues) visorValues[i] = visor;
        if (skinValues) skinValues[i] = skin;
        if (hairValues) hairValues[i] = hair;
        if (eyeValues) eyeValues[i] = eye;
      }
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
  if (surfaceRoles) {
    geometry.setAttribute('fabricMask', new THREE.BufferAttribute(fabricValues, 1));
    if (visorValues) {
      geometry.setAttribute('visorMask', new THREE.BufferAttribute(visorValues, 1));
    }
    if (skinValues) {
      geometry.setAttribute('skinMask', new THREE.BufferAttribute(skinValues, 1));
      geometry.setAttribute('hairMask', new THREE.BufferAttribute(hairValues, 1));
      geometry.setAttribute('eyeMask', new THREE.BufferAttribute(eyeValues, 1));
    }
  }
}

function prepareCarriedRifleGeometry(source) {
  // The CC0 source is one logical rifle split into seven material primitives. Keeping that
  // hierarchy would turn every combatant into seven extra draws. Bake those colours into
  // vertices, apply the source node transform, and collapse the weapon to one static mesh.
  source.updateMatrixWorld(true);
  const geometries = [];
  let sourceParts = 0;
  source.traverse(object => {
    if (!object.isMesh || !object.geometry) return;
    let geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    }
    bakeVertexColor(geometry, object.material);
    geometry.applyMatrix4(object.matrixWorld);
    geometries.push(geometry);
    sourceParts += Array.isArray(object.material)
      ? Math.max(1, object.geometry.groups?.length || object.material.length)
      : 1;
  });
  if (!geometries.length) return null;
  const geometry = mergeGeometries(geometries, false);
  for (const part of geometries) part.dispose();
  if (!geometry) return null;
  // The source is authored at roughly 70 cm overall. A modest uniform scale brings it to the
  // 82 cm service-rifle silhouette expected by the existing hand pose without moving the
  // receiver away from the source origin.
  geometry.scale(1.17, 1.17, 1.17);
  geometry.clearGroups();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.authoredCarriedRifle = true;
  geometry.userData.sourceParts = sourceParts;
  return { geometry, sourceParts };
}

// The same one-draw authored rifle serves both world actors and the first-person M4. Sharing
// the immutable BufferGeometry avoids loading or decoding the GLB twice; each consumer owns
// its own Mesh, material and transform.
export function authoredRifleViewGeometry() {
  return authoredRifleGeometry;
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
        bakeVertexColor(
          geometry,
          piece.material,
          civilian ? 'civilian' : 'combatant',
          piece.name || '',
        );
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
  const merged = new THREE.SkinnedMesh(
    cached.geometry,
    civilian ? MERGED_CIVILIAN_MATERIAL : MERGED_COMBATANT_MATERIAL,
  );
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

const PROCEDURAL_RIFLE_GEO = mergedBoxGeometry([
  [0, 0, -0.12, 0.075, 0.11, 0.3],
  [0, 0, -0.39, 0.06, 0.075, 0.27],
  [0, 0, -0.68, 0.025, 0.025, 0.34],
  [0, 0, 0.14, 0.065, 0.085, 0.22],
  [0, -0.045, 0.27, 0.06, 0.14, 0.12],
  [0, -0.11, -0.14, 0.065, 0.18, 0.1],
  [0, 0.09, -0.22, 0.055, 0.07, 0.13],
]);
const RIFLE_GEO = authoredRifleGeometry || PROCEDURAL_RIFLE_GEO;
const RIFLE_MAT = new THREE.MeshStandardMaterial({
  color: authoredRifleGeometry ? 0xffffff : 0x0b0e11,
  vertexColors: !!authoredRifleGeometry,
  roughness: 0.5,
  metalness: 0.5,
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
  const targetWorld = root.localToWorld(target.clone());
  const childWorld = child.getWorldPosition(new THREE.Vector3());
  const from = bone.parent.worldToLocal(childWorld).sub(bone.position).normalize();
  const to = bone.parent.worldToLocal(targetWorld).sub(bone.position).normalize();
  bone.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(from, to));
  root.updateMatrixWorld(true);
}

function solveArmToGrip(root, upper, lower, wrist, elbowGuide, grip) {
  if (!upper || !lower || !wrist) return;
  root.updateMatrixWorld(true);
  const rootPoint = object => root.worldToLocal(
    object.getWorldPosition(new THREE.Vector3()));
  const shoulder = rootPoint(upper);
  const elbow = rootPoint(lower);
  const hand = rootPoint(wrist);
  const upperLength = shoulder.distanceTo(elbow);
  const lowerLength = elbow.distanceTo(hand);
  const reach = grip.clone().sub(shoulder);
  const rawDistance = Math.max(0.0001, reach.length());
  const distance = THREE.MathUtils.clamp(
    rawDistance, Math.abs(upperLength - lowerLength) + 0.0001,
    upperLength + lowerLength - 0.0001);
  const direction = reach.normalize();
  const along = (
    upperLength * upperLength - lowerLength * lowerLength + distance * distance
  ) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const centre = shoulder.clone().addScaledVector(direction, along);
  const bend = elbowGuide.clone().sub(centre)
    .addScaledVector(direction, -elbowGuide.clone().sub(centre).dot(direction));
  if (bend.lengthSq() < 0.000001) {
    bend.set(0, 1, 0).cross(direction);
    if (bend.lengthSq() < 0.000001) bend.set(1, 0, 0);
  }
  bend.normalize();
  const solvedElbow = centre.addScaledVector(bend, height);
  const solvedGrip = shoulder.clone().addScaledVector(direction, distance);
  // Solve against the clamped point only when a target is fractionally beyond the arm's
  // physical reach; normal authored grip points land exactly.
  aimBone(root, upper, lower, solvedElbow);
  aimBone(root, lower, wrist, solvedGrip);
}

function findRigObject(visual, name) {
  const direct = visual.getObjectByName(name);
  if (direct) return direct;
  const canonical = value => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const expected = canonical(name);
  let match = null;
  visual.traverse(object => {
    const actual = canonical(object.name || '');
    if (!match && (actual === expected || actual.endsWith(expected))) match = object;
  });
  return match;
}

function cacheWeaponFingerPose(rig) {
  if (rig.weaponFingerPose) return;
  const sample = rig.actions.idle_gun || rig.actions.idle_gun_shoot
    || rig.actions.combatIdle;
  const names = [];
  for (const side of ['L', 'R']) {
    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
      for (const joint of [1, 2, 3, 4]) names.push(`${finger}${joint}.${side}`);
    }
    for (const joint of [1, 2, 3]) names.push(`Thumb${joint}.${side}`);
  }
  const previousTime = sample?.time || 0;
  if (sample) {
    sample.time = Math.min(0.55, sample.getClip().duration * 0.55);
    rig.mixer.update(0);
  }
  rig.weaponFingerPose = names.map(name => {
    const bone = findRigObject(rig.visual, name);
    if (!bone) return null;
    const quaternion = bone.quaternion.clone();
    const match = name.match(/^(Index|Middle|Ring|Pinky)([1-4])/);
    if (match) {
      const curl = [0, -0.12, -1.42, -1.18, -0.45][Number(match[2])];
      quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), curl));
    }
    return [bone, quaternion];
  }).filter(Boolean);
  if (sample) {
    sample.time = previousTime;
    rig.mixer.update(0);
  }
}

function applyWeaponFingerPose(rig) {
  cacheWeaponFingerPose(rig);
  for (const [bone, quaternion] of rig.weaponFingerPose) {
    bone.quaternion.copy(quaternion);
  }
}

function poseAuthoredRifle(root, rig) {
  applyWeaponFingerPose(rig);
  if (!rig.weaponBones) {
    const node = name => findRigObject(rig.visual, name);
    rig.weaponBones = {
      upperL: node('UpperArm.L'), lowerL: node('LowerArm.L'), wristL: node('Wrist.L'),
      upperR: node('UpperArm.R'), lowerR: node('LowerArm.R'), wristR: node('Wrist.R'),
    };
  }
  const b = rig.weaponBones;
  // Low-ready rather than a rigid T-pose: trigger elbow tucked, support elbow lower and out,
  // wrists landing on opposite sides of the receiver and handguard. These are root-local
  // contact points derived from the rifle's authored transform, not free-floating arm poses.
  const triggerGrip = rig.weaponGripTargets?.trigger
    || new THREE.Vector3(-0.222, 1.239, 0.272);
  const supportGrip = rig.weaponGripTargets?.support
    || new THREE.Vector3(-0.052, 1.229, 0.415);
  solveArmToGrip(
    root, b.upperR, b.lowerR, b.wristR,
    new THREE.Vector3(-0.27, 1.18, 0.10), triggerGrip);
  solveArmToGrip(
    root, b.upperL, b.lowerL, b.wristL,
    new THREE.Vector3(0.34, 1.14, 0.27), supportGrip);
  if (!rig.weaponGripTargets) {
    rig.baseWeaponGripTargets = {
      trigger: triggerGrip.clone(),
      support: supportGrip.clone(),
    };
    rig.weaponGripTargets = { trigger: triggerGrip, support: supportGrip };
  }
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

  const find = name => findRigObject(rig.visual, name);
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

const patchMaterials = new Map();
const PATCH_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
PATCH_GEOMETRY.name = 'shared-combatant-fabric-patch';
function patch(color, position, scale) {
  if (!patchMaterials.has(color)) {
    const material = new THREE.MeshStandardMaterial({
      color, roughness: 0.9, metalness: 0,
      normalMap: combatantFabricNormal,
      normalScale: new THREE.Vector2(0.16, 0.16),
      roughnessMap: combatantFabricRoughness,
    });
    material.name = 'combatant-subdued-fabric-patch';
    patchMaterials.set(color, material);
  }
  const mesh = new THREE.Mesh(
    PATCH_GEOMETRY,
    patchMaterials.get(color));
  mesh.name = 'combatant-fabric-patch';
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

let combatantSequence = 0;
export function createAuthoredCharacter({
  friendly, black, silhouette, bastion = false, variant: requestedVariant,
}) {
  if (!soldierSource) return null;
  const root = new THREE.Group();
  const variant = Math.abs(requestedVariant ?? combatantSequence++);
  const visual = cloneSkeleton(soldierSource);
  const faction = friendly ? (black ? 'black' : 'friendly') : bastion ? 'bastion' : 'hostile';
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
  // The authored receiver sits between the two solved wrists. Its former placement was
  // roughly 15 cm to the actor's right, leaving a visible rifle floating above both hands.
  rifle.position.set(-0.117, 1.279, 0.232);
  rifle.rotation.set(0.11, Math.PI - 0.28, -0.04);
  rifle.castShadow = quality.shadows;
  rifle.name = 'combatant-carried-rifle';
  rifle.userData.authoredCarriedRifle = !!authoredRifleGeometry;
  rifle.userData.sourceParts = authoredRifleSourceParts;
  root.add(rifle);

  // Friendly CT operators stay in uninterrupted black assault gear. Their formation, posture
  // and blue-grey base fabric distinguish them without adding a tiny faction box that can
  // become an arcade cue—or a lazy-upload boundary—when first entering the camera.
  if (!silhouette && bastion) {
    // BASTION must be recognizable because of what he is wearing, not because the renderer
    // draws a game icon over him. A command radio changes the silhouette from every angle;
    // the muted sand tabs are readable in the bunker without becoming a glowing faction cue.
    const radioMat = new THREE.MeshStandardMaterial({
      color: 0x161b1d, roughness: 0.76, metalness: 0.16,
    });
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.43, 0.14), radioMat);
    pack.name = 'bastion-radio-pack';
    pack.position.set(0, 1.15, -0.205);
    pack.castShadow = pack.receiveShadow = quality.shadows;
    const aerial = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.012, 0.55, 7),
      new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.58, metalness: 0.48 }),
    );
    aerial.name = 'bastion-radio-aerial';
    aerial.position.set(0.13, 1.56, -0.23);
    aerial.rotation.z = -0.08;
    aerial.castShadow = quality.shadows;
    const leftTab = patch(0x9a8155, [-0.29, 1.39, 0], [0.04, 0.085, 0.12]);
    const rightTab = patch(0x9a8155, [0.29, 1.39, 0], [0.04, 0.085, 0.12]);
    leftTab.name = 'bastion-command-tab-left';
    rightTab.name = 'bastion-command-tab-right';
    const commandMat = new THREE.MeshStandardMaterial({
      color: 0x826d49, roughness: 0.92, metalness: 0,
    });
    const neckGaiter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.205, 0.14, 12),
      commandMat,
    );
    neckGaiter.name = 'bastion-command-gaiter';
    neckGaiter.position.set(0, 1.515, 0.015);
    neckGaiter.castShadow = neckGaiter.receiveShadow = quality.shadows;
    const commandPouch = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.15, 0.035),
      commandMat,
    );
    commandPouch.name = 'bastion-command-map-pouch';
    commandPouch.position.set(0.055, 1.245, 0.255);
    commandPouch.rotation.x = -0.06;
    commandPouch.castShadow = commandPouch.receiveShadow = quality.shadows;
    const radioHandset = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.17, 0.045),
      radioMat,
    );
    radioHandset.name = 'bastion-radio-handset';
    radioHandset.position.set(-0.16, 1.35, 0.265);
    radioHandset.rotation.z = -0.12;
    radioHandset.castShadow = quality.shadows;
    root.add(
      pack, aerial, leftTab, rightTab, neckGaiter, commandPouch, radioHandset,
    );
  }
  // Hostiles deliberately get no red geometry or floating faction cue. Their olive kit,
  // carried weapon, posture, and behavior identify them; a rigid shoulder box separates from
  // the animated arm and reads like an arcade marker at the ranges where recognition matters.

  const mixer = new THREE.AnimationMixer(visual);
  const actions = mapActions(soldierClips, mixer);
  // This asset includes weapon-specific upper-body work. Prefer it over the neutral clips so
  // hands remain on the rifle instead of swinging like an unarmed mannequin.
  actions.combatIdle = actions.idle_gun || actions.idle_gun_shoot || actions.idle;
  actions.combatRun = actions.run_shoot || actions.run || actions.walk;
  mixer.timeScale = 0.94 + (variant % 7) * 0.02;
  const idle = actions.combatIdle;
  const phaseOffset = (variant * 0.173) % 1;
  if (idle) {
    idle.play();
    idle.time = idle.getClip().duration * phaseOffset;
  }
  const bodyScale = bastion ? 1.025 : 0.97 + (variant % 6) * 0.012;
  root.scale.set(
    bodyScale * (0.985 + ((variant >> 1) % 3) * 0.012),
    bodyScale,
    bodyScale * (0.99 + ((variant >> 2) % 3) * 0.008),
  );
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
    bastion: !!bastion,
    variant,
    phaseOffset,
    intent: 'patrol',
    combatant: true,
    baseVisualY: visual.position.y,
    baseRiflePosition: rifle.position.clone(),
    baseRifleQuaternion: rifle.quaternion.clone(),
  };
  root.userData.rig.applyWeaponPose = () => poseAuthoredRifle(root, root.userData.rig);
  root.userData.rig.applyWeaponPose();
  root.userData.bob = 0;
  root.name = bastion ? 'campaign-antagonist-bastion' : 'authored-combatant';
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
  const heightScale = CIVILIAN_HEIGHT[variant];
  const widthScale = CIVILIAN_WIDTH[variant];
  visual.scale.set(
    source.scale * widthScale,
    source.scale * heightScale,
    source.scale * (0.98 + (widthScale - 1) * 0.45),
  );
  visual.position.y = -source.floor * source.scale * heightScale;
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
    rifle.name = 'concealed-carried-rifle';
    rifle.userData.authoredCarriedRifle = !!authoredRifleGeometry;
    rifle.userData.sourceParts = authoredRifleSourceParts;
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
    variant,
    civilianSource: sourceIndex,
    panicStyle: Math.abs(sequence) % 3,
    bodyScale: { height: heightScale, width: widthScale },
    mergedSkin,
    concealed,
    hostage,
    baseVisualY: visual.position.y,
  };
  if (hostage) poseAuthoredHostage(root, root.userData.rig);
  root.userData.bob = 0;
  return root;
}

export function animateAuthoredCharacter(
  root, moving, flinch = 0, intent = 'idle', motionPhase = 0,
) {
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
  let desired;
  if (moving) {
    desired = intent === 'flee'
      ? (rig.actions.run || rig.actions.walk || rig.actions.combatRun)
      : intent === 'patrol'
        ? (rig.actions.walk || rig.actions.combatRun || rig.actions.run)
        : (rig.actions.combatRun || rig.actions.run || rig.actions.walk);
  } else if (intent === 'firing') {
    desired = rig.actions.gun_shoot || rig.actions.idle_gun_shoot
      || rig.actions.idle_gun_pointing || rig.actions.combatIdle;
  } else if (intent === 'engage') {
    desired = rig.actions.idle_gun_pointing || rig.actions.idle_gun_shoot
      || rig.actions.combatIdle;
  } else {
    desired = rig.actions.combatIdle || rig.actions.idle || rig.actions.character_idle;
  }
  if (desired && desired !== rig.currentAction) {
    desired.reset().fadeIn(0.14).play();
    desired.time = desired.getClip().duration * rig.phaseOffset;
    rig.currentAction?.fadeOut(0.14);
    rig.currentAction = desired;
  }
  rig.intent = intent;
  rig.mixer.update(dt);
  if (rig.combatant) poseAuthoredRifle(root, rig);
  if (!rig.lifeBones && rig.combatant) {
    rig.lifeBones = {
      head: findRigObject(rig.visual, 'Head'),
      neck: findRigObject(rig.visual, 'Neck'),
    };
  }
  // The clip drives the whole body; this small post-layer only breaks the surveillance-camera
  // mannequin stare. It touches head/neck, never the arms, so the solved weapon contacts stay
  // exact. Patrols scan, engaged men keep their eyes much closer to the weapon line.
  const life = motionPhase * 0.11 + rig.variant * 0.73;
  const scan = moving ? 0.012 : intent === 'patrol' ? 0.075 : 0.018;
  if (rig.lifeBones?.head) {
    rig.lifeBones.head.rotation.y += Math.sin(life) * scan;
    rig.lifeBones.head.rotation.z += Math.sin(life * 0.47) * scan * 0.18;
  }
  if (rig.lifeBones?.neck) {
    rig.lifeBones.neck.rotation.y += Math.sin(life * 0.71 + 1.2) * scan * 0.28;
  }
  const hit = flinch * 3.2;
  rig.visual.rotation.x = -hit * 0.12;
  rig.visual.rotation.z = hit * 0.07;
  root.userData.bob = 0;
}

export function poseAuthoredCivilianPanic(root, phase = 0) {
  const rig = root.userData.rig;
  if (!rig?.authored || !rig.civilian || rig.hostage) return false;
  if (!rig.panicBones) {
    const node = name => findRigObject(rig.visual, name);
    rig.panicBones = {
      upperL: node('UpperArm.L'), lowerL: node('LowerArm.L'), wristL: node('Wrist.L'),
      upperR: node('UpperArm.R'), lowerR: node('LowerArm.R'), wristR: node('Wrist.R'),
      head: node('Head'),
    };
  }
  const b = rig.panicBones;
  const pulse = Math.sin(phase * 0.62);
  const style = rig.panicStyle || 0;
  const arms = style === 0
    ? {
      left: [[-0.38, 1.43, 0.12], [-0.2, 1.62 + pulse * 0.025, 0.18]],
      right: [[0.38, 1.43, 0.12], [0.2, 1.62 - pulse * 0.025, 0.18]],
    }
    : style === 1
      ? {
        left: [[-0.42, 1.34, 0.17], [-0.34, 1.52 + pulse * 0.035, 0.27]],
        right: [[0.42, 1.34, 0.17], [0.34, 1.52 - pulse * 0.035, 0.27]],
      }
      : {
        left: [[-0.38, 1.42, 0.12], [-0.17, 1.6 + pulse * 0.03, 0.19]],
        right: [[0.44, 1.22, 0.12], [0.5, 1.38 - pulse * 0.04, 0.31]],
      };
  aimBone(root, b.upperL, b.lowerL, new THREE.Vector3(...arms.left[0]));
  aimBone(root, b.lowerL, b.wristL, new THREE.Vector3(...arms.left[1]));
  aimBone(root, b.upperR, b.lowerR, new THREE.Vector3(...arms.right[0]));
  aimBone(root, b.lowerR, b.wristR, new THREE.Vector3(...arms.right[1]));
  if (b.head) {
    b.head.rotation.y += pulse * 0.08;
    b.head.rotation.z += (style - 1) * 0.035;
  }
  return true;
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
  const lean = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0), -0.16 * amount);
  if (rig.rifle && rig.baseRiflePosition && rig.baseRifleQuaternion) {
    const baseOrigin = new THREE.Vector3(0, rig.baseVisualY, 0);
    const movedOrigin = new THREE.Vector3(0, rig.baseVisualY - 0.32 * amount, 0);
    rig.rifle.position.copy(rig.baseRiflePosition).sub(baseOrigin)
      .applyQuaternion(lean).add(movedOrigin);
    rig.rifle.quaternion.copy(lean).multiply(rig.baseRifleQuaternion);
    if (rig.baseWeaponGripTargets && rig.weaponGripTargets) {
      rig.weaponGripTargets.trigger.copy(rig.baseWeaponGripTargets.trigger)
        .sub(baseOrigin).applyQuaternion(lean).add(movedOrigin);
      rig.weaponGripTargets.support.copy(rig.baseWeaponGripTargets.support)
        .sub(baseOrigin).applyQuaternion(lean).add(movedOrigin);
    }
  }
  rig.visual.rotation.x = -0.16 * amount;
}

export function stopAuthoredCharacter(root) {
  const rig = root.userData.rig;
  if (!rig?.authored) return false;
  rig.mixer.stopAllAction();
  const variant = rig.variant || 0;
  const side = variant % 2 ? 1 : -1;
  const bone = name => findRigObject(rig.visual, name);
  const rotate = (name, x, y, z) => {
    const node = bone(name);
    if (!node) return;
    node.rotation.x += x;
    node.rotation.y += y;
    node.rotation.z += z;
  };
  rotate('Spine1', -0.2, side * 0.08, side * 0.1);
  rotate('Head', -0.22, side * 0.18, side * 0.12);
  rotate('UpperArm.L', -0.45, 0, 0.55 + side * 0.22);
  rotate('LowerArm.L', -0.32, 0, 0.24);
  rotate('UpperArm.R', -0.35, 0, -0.58 + side * 0.2);
  rotate('LowerArm.R', -0.28, 0, -0.18);
  rotate('UpperLeg.L', 0.18 + (variant % 3) * 0.11, 0, 0.08);
  rotate('LowerLeg.L', 0.42 + (variant % 2) * 0.28, 0, 0);
  rotate('UpperLeg.R', -0.12 + (variant % 2) * 0.25, 0, -0.08);
  rotate('LowerLeg.R', 0.24 + ((variant + 1) % 2) * 0.35, 0, 0);
  if (rig.rifle) {
    rig.rifle.rotation.z += side * 0.7;
    rig.rifle.rotation.x += 0.28;
    rig.rifle.position.x += side * 0.12;
    rig.rifle.position.y -= 0.16;
  }
  return true;
}
