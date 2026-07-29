import * as THREE from 'three';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { makeBox } from './physics.js';
import { quality } from './quality.js';
import { photoSurfaces, surfaces } from './textures.js';
import {
  animateAuthoredCharacter,
  createAuthoredCharacter,
  createCivilianCharacter,
  kneelAuthoredCharacter,
  poseAuthoredCivilianPanic,
  releaseAuthoredHostage,
  stopAuthoredCharacter,
} from './character-assets.js';

// Texels per world metre. Every face is projected at this scale regardless of box size,
// so a 20m wall and a 0.5m crate share the same grain and nothing stretches.
const TEXELS_PER_M = {
  asphalt: 0.16,
  sidewalk: 0.24,
  brick: 0.42,
  plaster: 0.2,
  concrete: 0.28,
  metal: 0.45,
  timber: 0.5,
  plain: 0.5,
  compatibility: 0.5,
};

const staticMaterials = new Map();

function staticSurfaceFamily(color) {
  if (color === C.street) return 'asphalt';
  if (color === C.sidewalk || color === C.platform || color === C.interiorFloor) return 'sidewalk';
  if (color === C.building) return 'brick';
  if (color === C.buildingB || color === C.interiorWall) return 'plaster';
  if (color === C.concrete || color === C.tunnel) return 'concrete';
  if (color === C.metal || color === C.roof) return 'metal';
  if (color === C.crate || color === C.accent) return 'timber';
  return 'plain';
}

function staticTint(color, family) {
  const fixed = {
    asphalt: 0x92979a,
    sidewalk: 0xb4b5b2,
    brick: 0xa99386,
    plaster: 0xa7adb0,
    // Concrete012 is a photographed, naturally grey surface rather than a neutral detail
    // overlay. Keep its family tint pale so the photograph supplies the value structure.
    concrete: 0xd5d2c9,
    metal: 0x727b80,
    timber: 0x927558,
  };
  return fixed[family] ?? color;
}

function staticMaterial(family) {
  if (!quality.pbr) {
    if (!staticMaterials.has('compatibility')) {
      staticMaterials.set('compatibility', new THREE.MeshLambertMaterial({ vertexColors: true }));
    }
    return staticMaterials.get('compatibility');
  }
  if (staticMaterials.has(family)) return staticMaterials.get(family);
  const procedural = surfaces();
  const photos = photoSurfaces();
  let options = { vertexColors: true, roughness: 0.9, metalness: 0.02 };
  if (photos?.[family]) {
    const photo = photos[family];
    options = {
      ...options,
      map: photo.map,
      roughnessMap: photo.roughnessMap || null,
      normalMap: photo.normalMap || null,
      normalScale: photo.normalMap
        ? new THREE.Vector2(family === 'concrete' ? 0.52 : 0.32, family === 'concrete' ? 0.52 : 0.32)
        : undefined,
      bumpMap: photo.height || null,
      bumpScale: photo.height
        ? (family === 'brick' ? 0.055 : family === 'asphalt' ? 0.035 : 0.028)
        : 0,
    };
  } else if (family === 'metal') {
    options = {
      ...options, roughness: 0.58, metalness: 0.52,
      map: procedural.metal.map,
      roughnessMap: procedural.metal.roughnessMap,
      normalMap: procedural.metal.normalMap,
      normalScale: new THREE.Vector2(0.22, 0.22),
    };
  } else if (family === 'timber') {
    options = {
      ...options, roughness: 0.84,
      map: procedural.timber.map,
      normalMap: procedural.timber.normalMap,
      normalScale: new THREE.Vector2(0.2, 0.2),
    };
  } else {
    options = {
      ...options,
      map: procedural.concrete.map,
      roughnessMap: procedural.concrete.roughnessMap,
      normalMap: procedural.concrete.normalMap,
      normalScale: new THREE.Vector2(0.28, 0.28),
    };
  }
  const material = new THREE.MeshStandardMaterial(options);
  staticMaterials.set(family, material);
  return material;
}

// geo entries: [x, y, z, w, h, d, color, solid=true, emissive=false]
// Merges static boxes into a bounded set of material-family meshes. This preserves batching while
// allowing asphalt, masonry, metal and timber to have genuinely different surface responses.
//
// Emissive entries go into a SECOND merged mesh drawn with MeshBasicMaterial. Lighting a
// window pane the same way as the wall around it makes it a pale grey rectangle; drawing it
// unlit is what makes it read as a lamp or a lit room. Two draw calls total, not two hundred.
export function buildStaticGeometry(scene, geo) {
  const solids = [];
  const lit = [];
  const buckets = new Map();
  const c = new THREE.Color();
  for (const entry of geo) {
    const [x, y, z, w, h, d, color, solid, emissive, visible] = entry;
    if (solid !== false) solids.push(makeBox(x, y, z, w, h, d));
    if (visible === false) continue;
    if (emissive) { lit.push(entry); continue; }
    const family = quality.pbr ? staticSurfaceFamily(color) : 'compatibility';
    let bucket = buckets.get(family);
    if (!bucket) {
      bucket = { positions: [], normals: [], colors: [], uvs: [], indices: [], vtx: 0 };
      buckets.set(family, bucket);
    }
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const pos = g.attributes.position, norm = g.attributes.normal, idx = g.index;
    c.setHex(staticTint(color, family));
    const density = TEXELS_PER_M[family] ?? 0.5;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);
      bucket.positions.push(px, py, pz);
      bucket.normals.push(nx, ny, nz);
      bucket.colors.push(c.r, c.g, c.b);
      // Planar-project onto whichever axis this face points along. Boxes are all
      // axis-aligned, so the dominant normal component picks the projection plane and
      // world coordinates become UVs directly — uniform texel density, no seams to fix.
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      let u, v;
      if (ay >= ax && ay >= az) { u = px; v = pz; }        // floors and ceilings
      else if (ax >= az) { u = pz; v = py; }               // walls facing X
      else { u = px; v = py; }                             // walls facing Z
      bucket.uvs.push(u * density, v * density);
    }
    for (let i = 0; i < idx.count; i++) bucket.indices.push(idx.getX(i) + bucket.vtx);
    bucket.vtx += pos.count;
    g.dispose();
  }
  const mesh = new THREE.Group();
  for (const [family, bucket] of buckets) {
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
    merged.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
    merged.setIndex(bucket.indices);
    merged.computeBoundingSphere();
    const part = new THREE.Mesh(merged, staticMaterial(family));
    part.castShadow = quality.shadows && !['asphalt', 'sidewalk'].includes(family);
    part.receiveShadow = quality.shadows;
    part.userData.surfaceFamily = family;
    mesh.add(part);
  }
  scene.add(mesh);

  let litMesh = null;
  if (lit.length) litMesh = buildEmissive(scene, lit);
  return { solids, mesh, litMesh };
}

// Unlit pass for window panes, lamp heads and signal lenses.
function buildEmissive(scene, geo) {
  const positions = [], colors = [], indices = [];
  let vtx = 0;
  const c = new THREE.Color();
  for (const [x, y, z, w, h, d, color] of geo) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const pos = g.attributes.position, idx = g.index;
    c.setHex(color);
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      colors.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vtx);
    vtx += pos.count;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.setIndex(indices);
  // fog stays ON: a lit window 300m out must haze over like everything else at that range.
  const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  scene.add(mesh);
  return mesh;
}

// Character/prop surfaces. Cloth and skin want no texture but do want PBR falloff;
// flat Lambert is what made everything read as moulded plastic.
const bodyMaterials = new Map();
export function bodyMaterial(color) {
  const key = `${quality.pbr ? 'pbr' : 'lit'}:${color}`;
  if (bodyMaterials.has(key)) return bodyMaterials.get(key);
  let mat;
  if (quality.pbr) {
    const fabric = surfaces().fabric;
    mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.9, metalness: 0,
      map: quality.textures ? fabric.map : null,
      roughnessMap: quality.textures ? fabric.roughnessMap : null,
      normalMap: quality.textures ? fabric.normalMap : null,
      normalScale: quality.textures ? new THREE.Vector2(0.16, 0.16) : undefined,
    });
  } else {
    mat = new THREE.MeshLambertMaterial({ color });
  }
  bodyMaterials.set(key, mat);
  return mat;
}

// ---------- Low-poly humanoid ----------
const BODY_CAPSULE = new THREE.CapsuleGeometry(0.5, 1, 5, 10);
const HEAD_SPHERE = new THREE.SphereGeometry(0.5, 16, 12);
const UNIT_CHARACTER_BOX = new THREE.BoxGeometry(1, 1, 1);

function mergeCharacterParts(parts) {
  const positions = [], normals = [], uvs = [];
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (const part of parts) {
    position.set(...part.pos);
    scale.set(...part.scale);
    rotation.setFromEuler(new THREE.Euler(...(part.rot || [0, 0, 0])));
    matrix.compose(position, rotation, scale);
    const geometry = part.geometry.toNonIndexed();
    geometry.applyMatrix4(matrix);
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
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

const TORSO_GEO = mergeCharacterParts([
  { geometry: BODY_CAPSULE, pos: [0, 1.13, 0], scale: [0.34, 0.15, 0.2] },
  { geometry: BODY_CAPSULE, pos: [0, 1.4, 0], scale: [0.4, 0.15, 0.22] },
]);
const TACTICAL_GEAR_GEO = mergeCharacterParts([
  { geometry: BODY_CAPSULE, pos: [0, 1.38, 0], scale: [0.42, 0.13, 0.26] },
  { geometry: UNIT_CHARACTER_BOX, pos: [-0.105, 1.22, 0.145], scale: [0.16, 0.14, 0.11] },
  { geometry: UNIT_CHARACTER_BOX, pos: [0.105, 1.22, 0.145], scale: [0.16, 0.14, 0.11] },
  { geometry: UNIT_CHARACTER_BOX, pos: [0, 1.04, 0], scale: [0.39, 0.08, 0.23] },
  { geometry: BODY_CAPSULE, pos: [0, 1.36, -0.19], scale: [0.34, 0.21, 0.14] },
  { geometry: BODY_CAPSULE, pos: [-0.29, 1.47, 0], scale: [0.14, 0.09, 0.16] },
  { geometry: BODY_CAPSULE, pos: [0.29, 1.47, 0], scale: [0.14, 0.09, 0.16] },
  { geometry: UNIT_CHARACTER_BOX, pos: [-0.31, 1.28, -0.02], scale: [0.09, 0.22, 0.12] },
]);
const HOSTILE_MARK_GEO = mergeCharacterParts([
  { geometry: UNIT_CHARACTER_BOX, pos: [-0.265, 1.33, 0], scale: [0.13, 0.07, 0.14] },
  { geometry: UNIT_CHARACTER_BOX, pos: [0.265, 1.33, 0], scale: [0.13, 0.07, 0.14] },
]);
const HELMET_ACCESSORY_GEO = mergeCharacterParts([
  { geometry: UNIT_CHARACTER_BOX, pos: [0, 0.17, 0.145], scale: [0.29, 0.045, 0.12] },
  { geometry: UNIT_CHARACTER_BOX, pos: [-0.235, 0.17, 0], scale: [0.045, 0.09, 0.22] },
  { geometry: UNIT_CHARACTER_BOX, pos: [0.235, 0.17, 0], scale: [0.045, 0.09, 0.22] },
  { geometry: HEAD_SPHERE, pos: [-0.235, 0.055, 0], scale: [0.075, 0.1, 0.055] },
  { geometry: HEAD_SPHERE, pos: [0.235, 0.055, 0], scale: [0.075, 0.1, 0.055] },
  { geometry: UNIT_CHARACTER_BOX, pos: [0, 0.255, 0.245], scale: [0.1, 0.075, 0.035] },
]);

function characterMesh(geometry, color) {
  const out = new THREE.Mesh(geometry, bodyMaterial(color));
  out.castShadow = out.receiveShadow = quality.shadows;
  return out;
}

function limb(w, h, d, color, x, y, z) {
  // Clothing and anatomy use a rounded silhouette. Thin plates, optics and weapons retain
  // hard manufactured edges. This single distinction removes the cuboid "Roblox person"
  // read without changing any animation pivots or gameplay hit volumes.
  const soft = h >= 0.14 && d <= h * 2.2;
  const geometry = soft ? BODY_CAPSULE : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geometry, bodyMaterial(color));
  if (soft) m.scale.set(w, h / 2, d);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = quality.shadows;
  return m;
}

// Articulated low-poly human. Enemy: tactical gear, helmet, red chest rig, rifle raised.
// Civilian: bright clothes, visible face, hands up, NO weapon. Hostage: kneeling, hands behind head.
const SKINS = [0xd9b08c, 0xc68863, 0xa9714b, 0x8d5a3b, 0xe8c39e];

function jointed(w, h, d, color) {
  // box whose origin is at its TOP so rotating the group bends at the joint
  const m = new THREE.Mesh(BODY_CAPSULE, bodyMaterial(color));
  m.scale.set(w, h / 2, d);
  m.position.y = -h / 2;
  m.castShadow = m.receiveShadow = quality.shadows;
  return m;
}

// Unlit accent, for identification marks that must stay readable in shadow at 40m. A lit
// material here would sink into the same value as the kit around it, which for an IFF panel
// defeats the entire point of having one.
function accent(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

// `friendly` is armed and kitted exactly like a hostile — same helmet, same rifle, same
// stance — because a squadmate that reads as a civilian is worse than useless. The ONLY
// difference is colour, and it is deliberately extreme: navy kit plus unlit cyan IFF panels
// front and back. You must be able to tell friend from foe in a doorway at a glance, under
// NVGs, while being shot at.
// Olive drab, in a few shades so a squad of hostiles is not eight identical dolls.
// Pulled down and desaturated from a true field olive: under ACES tone mapping against a
// desaturated blue night, a saturated green reads as a costume rather than as kit.
const OD_SHIRT = [0x424833, 0x4a5139, 0x3b422c, 0x4e5440];
const OD_PANTS = [0x343a25, 0x3b4129, 0x2e3320];

// `black` is the CT variant: near-black assault kit. Only used with `friendly`.
// One shared flat black. A silhouette is not a dark-coloured man: it is a man with no shading
// at all, which is why this is Basic and not Standard — any lighting response at 160m turns
// him back into a grey figure and the whole "he is inside an unlit room" read collapses.
const SILHOUETTE_MAT = new THREE.MeshBasicMaterial({ color: 0x020305 });

export function makeCharacter({
  hostile, hostage, friendly, black, silhouette, concealed, variant, bastion = false,
}) {
  const armed = !!hostile || !!friendly;
  if (!armed || concealed) {
    const civilian = createCivilianCharacter({
      concealed: !!concealed, hostage: !!hostage, variant,
    });
    if (civilian) return civilian;
  }
  if (armed && !concealed && !hostage) {
    const authored = createAuthoredCharacter({ friendly, black, silhouette, bastion });
    if (authored) return authored;
  }
  const g = new THREE.Group();
  const skin = SKINS[Math.floor(Math.random() * SKINS.length)];
  const shirt = friendly ? (black ? 0x16191c : 0x2d3a4a)
    : hostile && !concealed ? OD_SHIRT[Math.floor(Math.random() * OD_SHIRT.length)]
      : [0xef9a9a, 0x90caf9, 0xfff59d, 0xa5d6a7, 0xce93d8, 0xffcc80][Math.floor(Math.random() * 6)];
  const pants = friendly ? (black ? 0x121417 : 0x232b36)
    : hostile && !concealed ? OD_PANTS[Math.floor(Math.random() * OD_PANTS.length)]
      : [0x546e7a, 0x6d4c41, 0x37474f][Math.floor(Math.random() * 3)];
  const boots = armed ? 0x15181b : 0x3e2723;

  // hips + torso (slight taper: chest wider than waist)
  g.add(limb(0.32, 0.14, 0.2, pants, 0, 0.92, 0));
  g.add(characterMesh(TORSO_GEO, shirt));
  if (armed && !concealed) {
    const rig = friendly ? (black ? 0x0d0f11 : 0x1b3560) : 0x3f4529;   // olive webbing
    g.add(characterMesh(TACTICAL_GEAR_GEO, rig));
  }
  if (hostile && !concealed) {
    // Olive drab is correct for what these men are, but it cost the silhouette its single
    // strongest hostile tell (the old red chest rig) at exactly the moment identification
    // matters most. A red armband and helmet rag put that cue back — and irregular forces
    // really do mark themselves this way, so it costs nothing in plausibility.
    g.add(characterMesh(HOSTILE_MARK_GEO, 0x8f2622));
  }
  if (bastion && !concealed) {
    const commandTab = 0x9a8155;
    g.add(
      accent(0.06, 0.14, 0.18, commandTab, -0.27, 1.4, 0),
      accent(0.06, 0.14, 0.18, commandTab, 0.27, 1.4, 0),
      accent(0.32, 0.45, 0.14, 0x161b1d, 0, 1.17, -0.2),
    );
    const aerial = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.012, 0.55, 7),
      bodyMaterial(0x111416),
    );
    aerial.position.set(0.13, 1.57, -0.24);
    aerial.rotation.z = -0.08;
    aerial.name = 'bastion-radio-aerial';
    const gaiter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.205, 0.14, 12),
      bodyMaterial(0x826d49),
    );
    gaiter.position.set(0, 1.52, 0);
    gaiter.name = 'bastion-command-gaiter';
    g.add(aerial, gaiter);
    g.name = 'campaign-antagonist-bastion';
  }
  if (friendly) {
    g.add(accent(0.2, 0.05, 0.02, 0x38e8ff, 0, 1.48, 0.135));   // chest IFF panel
    g.add(accent(0.2, 0.05, 0.02, 0x38e8ff, 0, 1.48, -0.135));  // back panel
    g.add(accent(0.05, 0.09, 0.02, 0x38e8ff, -0.2, 1.44, 0.1));  // shoulder tabs
    g.add(accent(0.05, 0.09, 0.02, 0x38e8ff, 0.2, 1.44, 0.1));
  }

  // head group with face
  const headG = new THREE.Group();
  headG.position.set(0, 1.62, 0);
  const headColor = armed && !concealed ? 0x1c2024 : skin; // balaclava vs visible face
  const head = new THREE.Mesh(HEAD_SPHERE, bodyMaterial(headColor));
  head.scale.set(0.22, 0.26, 0.23);
  head.position.y = 0.07;
  head.castShadow = head.receiveShadow = quality.shadows;
  headG.add(head);
  // eyes (a strip for the kitted-up; two dots for civilians)
  if (armed && !concealed) {
    const lid = friendly ? (black ? 0x141719 : 0x22303f) : 0x424a2c;   // olive helmet
    headG.add(limb(0.18, 0.05, 0.02, skin, 0, 0.09, 0.125));
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      bodyMaterial(lid));
    helmet.scale.set(0.29, 0.21, 0.29);
    helmet.position.y = 0.24;
    helmet.castShadow = quality.shadows;
    headG.add(helmet);
    headG.add(characterMesh(HELMET_ACCESSORY_GEO, lid));
    headG.add(accent(0.19, 0.055, 0.025, friendly ? 0x1f3038 : 0x20251d, 0, 0.1, 0.145));
    if (hostile) headG.add(limb(0.27, 0.045, 0.28, 0x8f2622, 0, 0.155, 0)); // red helmet rag
    // Cat-eye strip on the back of the helmet: the real-world marking that exists for exactly
    // this problem, and it means a squadmate is identifiable from directly behind too.
    if (friendly) headG.add(accent(0.14, 0.03, 0.02, 0x38e8ff, 0, 0.22, -0.13));
  } else {
    headG.add(limb(0.035, 0.035, 0.02, 0x2a2a2a, -0.05, 0.08, 0.125));
    headG.add(limb(0.035, 0.035, 0.02, 0x2a2a2a, 0.05, 0.08, 0.125));
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.48),
      bodyMaterial([0x2e2620, 0x4e342e, 0x9e9e9e, 0x212121][Math.floor(Math.random() * 4)]));
    hair.scale.set(0.24, 0.15, 0.25);
    hair.position.y = 0.2;
    hair.castShadow = quality.shadows;
    headG.add(hair);
  }
  g.add(headG);

  // legs: pivot at hip, knee implied by two segments
  const mkLeg = (x) => {
    const lg = new THREE.Group();
    lg.position.set(x, 0.86, 0);
    lg.add(jointed(0.15, 0.42, 0.17, pants));
    const shin = new THREE.Group();
    shin.position.y = -0.42;
    shin.add(jointed(0.13, 0.4, 0.15, pants));
    if (armed) {
      const pad = characterMesh(UNIT_CHARACTER_BOX, black && friendly ? 0x090b0d : 0x222722);
      pad.scale.set(0.16, 0.11, 0.055);
      pad.position.set(0, -0.06, 0.145);
      shin.add(pad);
    }
    const foot = characterMesh(BODY_CAPSULE, boots);
    foot.scale.set(0.13, 0.12, 0.12);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(0, -0.4, 0.085);
    shin.add(foot);
    lg.add(shin);
    lg.userData.shin = shin;
    g.add(lg);
    return lg;
  };
  const mkArm = (x, color) => {
    const ag = new THREE.Group();
    ag.position.set(x, 1.5, 0);
    ag.add(jointed(0.11, 0.3, 0.13, color));
    const fore = new THREE.Group();
    fore.position.y = -0.3;
    fore.add(jointed(0.1, 0.28, 0.11, armed ? color : skin)); // civilians: rolled sleeves
    const hand = characterMesh(HEAD_SPHERE, skin);
    hand.scale.set(0.09, 0.085, 0.075);
    hand.position.set(0, -0.3, 0);
    fore.add(hand);
    ag.add(fore);
    ag.userData.fore = fore;
    g.add(ag);
    return ag;
  };
  const lLeg = mkLeg(-0.11), rLeg = mkLeg(0.11);
  const lArm = mkArm(-0.26, shirt), rArm = mkArm(0.26, shirt);

  let rifle = null;
  if (armed) {
    // rifle raised across the chest — THE visual tell
    rifle = new THREE.Group();
    const body = limb(0.06, 0.09, 0.72, 0x0a0a0a, 0, 0, -0.18);
    const mag = limb(0.05, 0.14, 0.07, 0x14171a, 0, -0.1, -0.12);
    mag.rotation.x = -0.2;
    rifle.add(body, mag);
    rifle.add(limb(0.05, 0.05, 0.1, 0x1b1f22, 0, 0.02, 0.16));       // stock
    rifle.add(limb(0.04, 0.06, 0.1, 0x2a3038, 0, 0.09, -0.1));       // optic
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.42, 10),
      bodyMaterial(0x090b0d));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, -0.73);
    rifle.add(barrel);
    rifle.position.set(0.1, 1.32, 0.22);
    rifle.rotation.y = 0.35;
    rifle.visible = !concealed;
    g.add(rifle);
    if (!concealed) {
      // arms hold the rifle
      lArm.rotation.x = -0.9; lArm.userData.fore.rotation.x = -0.5;
      rArm.rotation.x = -1.05; rArm.userData.fore.rotation.x = -0.35;
    } else {
      // Hands naturally down until the weapon is produced. A "civilian" permanently holding
      // an invisible rifle is not concealed; it is a broken animation tell.
      lArm.rotation.z = 0.08;
      rArm.rotation.z = -0.08;
    }
  } else if (hostage) {
    // kneeling: thighs forward, shins folded back, hands behind head
    lLeg.rotation.x = -1.5; rLeg.rotation.x = -1.5;
    lLeg.userData.shin.rotation.x = 1.6; rLeg.userData.shin.rotation.x = 1.6;
    for (const c of g.children) c.position.y -= 0.42; // drop the whole body to kneel height
    lArm.rotation.x = Math.PI - 0.4; lArm.rotation.z = 0.5; lArm.userData.fore.rotation.x = -1.1;
    rArm.rotation.x = Math.PI - 0.4; rArm.rotation.z = -0.5; rArm.userData.fore.rotation.x = -1.1;
  } else {
    // hands straight up
    lArm.rotation.x = Math.PI - 0.15; lArm.rotation.z = 0.18;
    rArm.rotation.x = Math.PI - 0.15; rArm.rotation.z = -0.18;
  }

  // rig.hostile is read by animateRig only as "is this figure holding a weapon", so a friendly
  // must set it too or a squadmate swings its arms while carrying a rifle.
  g.userData.rig = {
    headG, lLeg, rLeg, lArm, rArm, rifle,
    hostile: armed, hostage, friendly, bastion: !!bastion,
    concealed: !!concealed, torsoTilt: 0,
  };
  if (silhouette) g.traverse(o => { if (o.isMesh) o.material = SILHOUETTE_MAT; });
  return g;
}

// Cut a bound civilian loose. Authored hostages transition from their seated animation into
// locomotion; the compatibility rig keeps its original explicit limb reset.
export function releaseHostageRig(g) {
  const r = g.userData.rig;
  if (!r) return false;
  if (r.authored) return releaseAuthoredHostage(g);
  for (const c of g.children) c.position.y += 0.42;
  r.lLeg.rotation.x = 0; r.rLeg.rotation.x = 0;
  r.lLeg.userData.shin.rotation.x = 0; r.rLeg.userData.shin.rotation.x = 0;
  r.lArm.rotation.set(0.1, 0, 0.15); r.rArm.rotation.set(0.1, 0, -0.15);
  r.lArm.userData.fore.rotation.x = 0; r.rArm.userData.fore.rotation.x = 0;
  r.hostage = false;
  return true;
}

export function revealWeaponRig(g) {
  const r = g.userData.rig;
  if (!r?.rifle || !r.concealed) return;
  const authored = createAuthoredCharacter({ friendly: false, black: false, silhouette: false });
  if (authored) {
    for (const child of g.children) child.visible = false;
    g.add(authored);
    g.userData.rig = authored.userData.rig;
    return;
  }
  r.concealed = false;
  r.rifle.visible = true;
  r.lArm.rotation.set(-0.9, 0, 0);
  r.lArm.userData.fore.rotation.x = -0.5;
  r.rArm.rotation.set(-1.05, 0, 0);
  r.rArm.userData.fore.rotation.x = -0.35;
}

// Walk cycle plus hit reaction. phase advances with distance moved; flinch is 0..~0.32s
// remaining, which jerks the upper body back so bullets visibly land.
export function animateRig(g, phase, moving, flinch = 0, panic = false) {
  const r = g.userData.rig;
  if (!r) return;
  if (r.authored) {
    animateAuthoredCharacter(g, moving, flinch);
    if (panic) poseAuthoredCivilianPanic(g, phase);
    return;
  }
  const swing = moving ? Math.sin(phase) * 0.55 : 0;
  r.lLeg.rotation.x = swing;
  r.rLeg.rotation.x = -swing;
  r.lLeg.userData.shin.rotation.x = moving ? Math.max(0, -Math.sin(phase)) * 0.7 : 0;
  r.rLeg.userData.shin.rotation.x = moving ? Math.max(0, Math.sin(phase)) * 0.7 : 0;
  if (!r.hostile && !r.hostage) {
    r.lArm.rotation.z = 0.18 + (moving ? Math.sin(phase * 2) * 0.08 : 0);
    r.rArm.rotation.z = -0.18 - (moving ? Math.sin(phase * 2) * 0.08 : 0);
  }
  if (r.headG) {
    const f = flinch * 3.2;                       // 0..~1
    r.headG.rotation.x = -f * 0.5 + (moving ? Math.sin(phase * 2) * 0.02 : 0);
    r.headG.position.x = f * (Math.random() - 0.5) * 0.06;
    if (r.torsoTilt !== undefined) g.rotation.x = -f * 0.16;
  }
  g.userData.bob = moving ? Math.abs(Math.sin(phase)) * 0.05 : 0;
}

// Drop to one knee in a firing position, blended 0..1. Call AFTER animateRig so it overrides
// the walk cycle rather than fighting it.
//
// The whole figure has to sink as the legs fold, or the feet punch through the floor. The
// group origin is the man's feet and is owned by the ground snap, so the sink is applied to
// the children instead — their construction-time heights are cached on first use, because
// re-reading them later would capture an already-sunk pose and the figure would creep into
// the ground a little more every frame.
export function kneelRig(g, k) {
  const r = g.userData.rig;
  if (!r) return;
  if (r.authored) {
    kneelAuthoredCharacter(g, k);
    return;
  }
  if (!r.baseY) r.baseY = g.children.map(c => c.position.y);
  const drop = 0.36 * k;
  for (let i = 0; i < g.children.length; i++) g.children[i].position.y = r.baseY[i] - drop;
  // rear leg tucked under the body, front leg planted forward: the classic supported kneel
  r.rLeg.rotation.x = 0.62 * k;
  r.rLeg.userData.shin.rotation.x = 1.62 * k;
  r.lLeg.rotation.x = -0.52 * k;
  r.lLeg.userData.shin.rotation.x = 0.78 * k;
  // The rifle is itself a child of the group, so the loop above has already lowered it with
  // the rest of the body. Nothing to do here, and adding a second offset would double it.
}

// Death sprawl: called once at kill time to splay the figure before it tips over.
export function deathPose(g) {
  const r = g.userData.rig;
  if (!r) return;
  if (stopAuthoredCharacter(g)) return;
  const s = () => (Math.random() - 0.5);
  r.lArm.rotation.set(-0.4 + s() * 0.5, 0, 0.9 + s() * 0.4);
  r.rArm.rotation.set(-0.3 + s() * 0.5, 0, -0.9 + s() * 0.4);
  r.lLeg.rotation.x = s() * 0.5; r.rLeg.rotation.x = s() * 0.5;
  if (r.rifle) { r.rifle.rotation.z = 0.9; r.rifle.position.y = 0.9; }
  g.rotation.z = s() * 0.35;
}

const doorGeometryCache = new Map();
const doorDetailCache = new Map();
const DOOR_DETAIL_BOX = new THREE.BoxGeometry(1, 1, 1);
const DOOR_ESCUTCHEON = new THREE.CylinderGeometry(0.075, 0.075, 0.026, 16);
const DOOR_LEVER = new THREE.CapsuleGeometry(0.026, 0.15, 3, 8);
const DOOR_HINGE = new THREE.CylinderGeometry(0.024, 0.024, 0.15, 10);
let doorMaterials = null;

function breachDoorMaterials() {
  if (doorMaterials) return doorMaterials;
  const metal = surfaces().metal;
  doorMaterials = {
    leaf: new THREE.MeshStandardMaterial({
      color: 0x586264, roughness: 0.72, metalness: 0.28,
      map: quality.textures ? metal.map : null,
      roughnessMap: quality.textures ? metal.roughnessMap : null,
      normalMap: quality.textures ? metal.normalMap : null,
      normalScale: new THREE.Vector2(0.13, 0.13),
    }),
    inset: new THREE.MeshStandardMaterial({
      color: 0x303739, roughness: 0.83, metalness: 0.18,
    }),
    hardware: new THREE.MeshStandardMaterial({
      color: 0x8b9293, roughness: 0.38, metalness: 0.78,
    }),
    grime: new THREE.MeshStandardMaterial({
      color: 0x242829, roughness: 0.98, metalness: 0,
    }),
  };
  return doorMaterials;
}

function breachDoorGeometry(w, h) {
  const key = `${w}:${h}`;
  if (doorGeometryCache.has(key)) return doorGeometryCache.get(key);
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + 0.025, 0.015);
  shape.lineTo(w / 2 - 0.025, 0.015);
  shape.lineTo(w / 2 - 0.025, h - 0.015);
  shape.lineTo(-w / 2 + 0.025, h - 0.015);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1, bevelEnabled: true, bevelSegments: 2,
    bevelSize: 0.025, bevelThickness: 0.018, curveSegments: 1,
  });
  geometry.translate(0, 0, -0.05);
  geometry.computeVertexNormals();
  doorGeometryCache.set(key, geometry);
  return geometry;
}

function breachDoorDetails(w, h) {
  const key = `${w}:${h}`;
  if (doorDetailCache.has(key)) return doorDetailCache.get(key);
  const inset = [], hardware = [], grime = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const add = (bucket, geometry, x, y, z, sx = 1, sy = 1, sz = 1,
    rx = 0, ry = 0, rz = 0) => {
    position.set(x, y, z);
    euler.set(rx, ry, rz);
    quaternion.setFromEuler(euler);
    scale.set(sx, sy, sz);
    matrix.compose(position, quaternion, scale);
    bucket.push(geometry.clone().applyMatrix4(matrix));
  };

  const doubleLeaf = w >= 1.9;
  const leafCenters = doubleLeaf ? [-w * 0.25, w * 0.25] : [0];
  const insetWidth = doubleLeaf ? Math.min(0.28, w * 0.18) : Math.min(0.34, w * 0.28);
  const insetHeight = Math.min(0.58, h * 0.24);
  const insetY = h * 0.69;
  for (const x of leafCenters) {
    for (const side of [-1, 1]) {
      add(inset, DOOR_DETAIL_BOX, x, insetY, side * 0.064,
        insetWidth, insetHeight, 0.025);
      for (const y of [insetY - insetHeight / 2, insetY + insetHeight / 2]) {
        add(hardware, DOOR_DETAIL_BOX, x, y, side * 0.082,
          insetWidth + 0.08, 0.035, 0.035);
      }
      for (const fx of [x - insetWidth / 2, x + insetWidth / 2]) {
        add(hardware, DOOR_DETAIL_BOX, fx, insetY, side * 0.082,
          0.035, insetHeight + 0.08, 0.035);
      }
    }
  }
  for (const side of [-1, 1]) {
    add(hardware, DOOR_DETAIL_BOX, 0, 0.22, side * 0.066,
      w - 0.15, 0.34, 0.025);
  }
  // Surface-mounted closer: a strong real-world silhouette at eye level that survives the
  // dim corridor lighting better than subtle normal-map detail alone.
  add(hardware, DOOR_DETAIL_BOX, w * 0.18, h - 0.14, 0.07,
    Math.min(0.42, w * 0.3), 0.09, 0.055);
  add(hardware, DOOR_DETAIL_BOX, -w * 0.03, h - 0.18, 0.085,
    Math.min(0.48, w * 0.34), 0.026, 0.035, 0, 0, -0.08);

  const hardwareX = doubleLeaf ? 0.16 : w / 2 - 0.2;
  for (const side of [-1, 1]) {
    add(hardware, DOOR_ESCUTCHEON, hardwareX, h * 0.48, side * 0.067,
      1, 1, 1, Math.PI / 2);
    add(hardware, DOOR_LEVER, hardwareX - 0.1, h * 0.48, side * 0.105,
      1, 1, 1, 0, 0, Math.PI / 2);
  }
  for (const y of [0.38, h * 0.5, h - 0.38]) {
    add(hardware, DOOR_HINGE, -w / 2 - 0.006, y, 0.02);
  }
  for (const [x, y, rz, length] of [
    [-w * 0.18, h * 0.31, 0.16, w * 0.28],
    [w * 0.12, h * 0.78, -0.11, w * 0.22],
    [-w * 0.08, h * 0.17, -0.07, w * 0.34],
  ]) {
    add(grime, DOOR_DETAIL_BOX, x, y, 0.075, length, 0.018, 0.012, 0, 0, rz);
  }
  const result = {
    inset: mergeGeometries(inset),
    hardware: mergeGeometries(hardware),
    grime: mergeGeometries(grime),
  };
  doorDetailCache.set(key, result);
  return result;
}

// Breachable door mesh. The whole group remains one physics object and still flies inward on
// breach, but the desktop presentation now reads as battered institutional steel rather than
// a brown cuboid with a yellow cube attached.
export function makeDoor(w = 1.4, h = 2.4) {
  const g = new THREE.Group();
  g.name = 'breach-door';
  g.userData.authoredDoor = true;
  const m = breachDoorMaterials();
  const panel = new THREE.Mesh(breachDoorGeometry(w, h), m.leaf);
  panel.name = 'door-leaf';
  panel.castShadow = panel.receiveShadow = quality.shadows;
  g.add(panel);

  const details = breachDoorDetails(w, h);
  for (const [name, geometry, mat] of [
    ['door-inset-panels', details.inset, m.inset],
    ['door-hardware', details.hardware, m.hardware],
    ['door-scrapes', details.grime, m.grime],
  ]) {
    const part = new THREE.Mesh(geometry, mat);
    part.name = name;
    part.castShadow = part.receiveShadow = quality.shadows;
    g.add(part);
  }
  return g;
}

// ---------- Level authoring helpers (produce geo arrays) ----------
// Darkened from the original set. These albedos were picked against flat Lambert with no
// environment light; under PBR plus a sky IBL the pale greys blow out and read as moulded
// plastic, which is most of what "looks like Roblox" actually means. Real concrete at night
// is dark. Interior surfaces are pulled down less, because levels 1/3/7 are lit only by
// ambient and crushing them would make rooms unplayable.
export const C = {
  street: 0x24282c, sidewalk: 0x474f55, building: 0x59636d, buildingB: 0x6b7784,
  interiorFloor: 0x4b545b, interiorWall: 0x76818a, roof: 0x373f45, crate: 0x8a7150,
  concrete: 0x7c858d, metal: 0x424e57, tunnel: 0x353c41, platform: 0x5c656d,
  accent: 0x9c7a5c, glassWall: 0x5e7484,
};

export function floorSlab(x, z, w, d, y = 0, t = 0.4, color = C.interiorFloor) {
  return [[x, y - t / 2, z, w, t, d, color]];
}

// Wall along X or Z with optional gaps (doorways). gaps: [{off, w, h}] offset from wall start.
export function wall(x1, z1, x2, z2, h, color = C.interiorWall, gaps = [], yBase = 0, thick = 0.3) {
  const out = [];
  const len = Math.hypot(x2 - x1, z2 - z1);
  const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
  let cursor = 0;
  const segs = [];
  const sorted = [...gaps].sort((a, b) => a.off - b.off);
  for (const gap of sorted) {
    if (gap.off > cursor) segs.push({ off: cursor, len: gap.off - cursor, h, y: yBase });
    // lintel above the gap
    const gh = gap.h ?? 2.4;
    if (gh < h) segs.push({ off: gap.off, len: gap.w, h: h - gh, y: yBase + gh });
    cursor = gap.off + gap.w;
  }
  if (cursor < len) segs.push({ off: cursor, len: len - cursor, h, y: yBase });
  for (const s of segs) {
    const cx = x1 + ux * (s.off + s.len / 2), cz = z1 + uz * (s.off + s.len / 2);
    const w = Math.abs(ux) > 0.5 ? s.len : thick;
    const d = Math.abs(uz) > 0.5 ? s.len : thick;
    out.push([cx, s.y + s.h / 2, cz, w, s.h, d, color]);
  }
  return out;
}

// Staircase from (x,z) heading dir ('n','s','e','w'), climbing `height` over `run` length.
export function stairs(x, z, dir, run, height, width = 1.6, color = C.concrete, yBase = 0) {
  const steps = Math.max(4, Math.round(height / 0.25));
  const stepH = height / steps, stepL = run / steps;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * stepL;
    let sx = x, sz = z, w = width, d = stepL + 0.02;
    if (dir === 'n') sz = z - t;
    if (dir === 's') sz = z + t;
    if (dir === 'e') { sx = x + t; w = stepL + 0.02; d = width; }
    if (dir === 'w') { sx = x - t; w = stepL + 0.02; d = width; }
    const h = stepH * (i + 1);
    out.push([sx, yBase + h / 2, sz, w, h, d, color]);
  }
  return out;
}

export function crate(x, z, y = 0, s = 1.0) {
  if (window.__bpVisualProps) {
    window.__bpVisualProps.push({ kind: 'supply-crate', x, z, y, s });
    return [[x, y + s / 2, z, s, s, s, C.crate, true, false, false]];
  }
  return [[x, y + s / 2, z, s, s, s, C.crate]];
}

export function marketStall(x, z, color = 0x7a4a4a) {
  if (window.__bpVisualProps) {
    window.__bpVisualProps.push({ kind: 'market-stall', x, z, color });
    return [[x, 0.55, z, 5, 1.1, 2, C.accent, true, false, false]];
  }
  return [
    [x, 0.55, z, 5, 1.1, 2, C.accent],
    [x - 2.2, 1.5, z, 0.15, 3, 0.15, C.metal],
    [x + 2.2, 1.5, z, 0.15, 3, 0.15, C.metal],
    [x, 3.0, z, 5.4, 0.15, 2.6, color],
  ];
}

// A parked car. Two boxes read as a shoebox with a smaller shoebox on it; what actually makes
// the shape say "car" is the stuff around the edges — wheels under the arches, a glasshouse
// inset from the body sides, bumpers proud of the panels, and lights at both ends.
//
// `l` is a length-wise offset helper and `w` a width-wise one, so the whole thing is authored
// once in car-local terms and mapped onto whichever world axis the car is parked along.
const CAR_COLORS = [0x6e2a2a, 0x27406b, 0x5a5f63, 0x37503a, 0x6b5a2a, 0x2f2f33];

export function car(x, z, rotZAxis = false, color = null, opts = {}) {
  // Vehicle appearance must be repeatable across restarts: it is part of the authored street,
  // not gameplay entropy. Position supplies enough variation without consuming Math.random()
  // and changing every parked car whenever some unrelated level code gains a random call.
  const appearance = Math.abs(Math.round(x * 37 + z * 61));
  const col = color ?? CAR_COLORS[appearance % CAR_COLORS.length];
  const variant = opts.variant ?? appearance % 3;
  if (window.__bpVisualProps) {
    window.__bpVisualProps.push({
      kind: 'vehicle', x, z, rotZAxis, color: col, police: !!opts.police,
      variant,
      damage: opts.damage ?? appearance % 7,
    });
    const length = [4.6, 4.26, 4.76][opts.police ? 0 : variant];
    const width = [1.94, 1.93, 2.06][opts.police ? 0 : variant];
    const height = [1.62, 1.68, 1.84][opts.police ? 0 : variant];
    return [[x, height / 2, z, rotZAxis ? width : length, height,
      rotZAxis ? length : width,
      col, true, false, false]];
  }
  const glass = opts.glass ?? 0x141b22;
  const trim = 0x1b1f23;
  const out = [];
  // (along, across, y, lenAlong, h, lenAcross) in car-local space -> world box
  const B = (a, c, y, la, h, lc, colour, solid = false) => out.push(rotZAxis
    ? [x + c, y, z + a, lc, h, la, colour, solid]
    : [x + a, y, z + c, la, h, lc, colour, solid]);

  B(0, 0, 0.62, 4.3, 0.62, 1.82, col, true);            // main body, the only solid part
  B(0.15, 0, 1.16, 2.25, 0.5, 1.66, col);               // greenhouse, inset from the sides
  B(0.15, 0, 1.19, 2.05, 0.44, 1.72, glass);            // side glass band, proud of the pillars
  B(-0.98, 0, 1.16, 0.1, 0.44, 1.6, glass);             // windscreen
  B(1.3, 0, 1.16, 0.1, 0.4, 1.56, glass);               // rear screen
  B(0.15, 0, 1.42, 2.1, 0.06, 1.6, col);                // roof panel
  B(-1.45, 0, 0.5, 0.55, 0.34, 1.78, col);              // bonnet step
  B(1.55, 0, 0.55, 0.5, 0.4, 1.78, col);                // boot step
  // wheels: four dark blocks tucked under the arches, the single biggest "this is a car" cue
  for (const a of [-1.35, 1.35]) for (const c of [-0.86, 0.86]) {
    B(a, c, 0.34, 0.78, 0.66, 0.22, 0x15181b);
    B(a, c, 0.34, 0.34, 0.3, 0.24, 0x4a5158);           // hub
  }
  B(-2.13, 0, 0.58, 0.16, 0.32, 1.7, trim);             // front bumper
  B(2.13, 0, 0.58, 0.16, 0.32, 1.7, trim);              // rear bumper
  for (const c of [-0.62, 0.62]) {
    B(-2.1, c, 0.78, 0.12, 0.2, 0.42, 0xdfe4dc, false); // headlights
    B(2.12, c, 0.8, 0.1, 0.18, 0.4, 0x7a2320, false);   // tail lights
  }
  B(0.15, -0.92, 0.95, 1.9, 0.06, 0.06, trim);          // side rubbing strips
  B(0.15, 0.92, 0.95, 1.9, 0.06, 0.06, trim);
  return out;
}

// Marked unit. Same shell, black-and-white livery, push bar, and a light bar whose lenses are
// registered as animated beacons — the flashing itself cannot live in the merged static mesh,
// so world.js collects the positions and main.js drives real lights over them.
export function policeCar(x, z, rotZAxis = false, beacons = null) {
  const out = car(x, z, rotZAxis, 0x1b1e22, { glass: 0x10161c, police: true });
  if (window.__bpVisualProps) {
    if (beacons) {
      beacons.push({ pos: rotZAxis ? [x - 0.52, 1.68, z + 0.1] : [x + 0.1, 1.68, z - 0.52], hue: 'red' });
      beacons.push({ pos: rotZAxis ? [x + 0.52, 1.68, z + 0.1] : [x + 0.1, 1.68, z + 0.52], hue: 'blue' });
    }
    return out;
  }
  const B = (a, c, y, la, h, lc, colour) => out.push(rotZAxis
    ? [x + c, y, z + a, lc, h, la, colour, false]
    : [x + a, y, z + c, la, h, lc, colour, false]);
  // white doors and roof over the dark shell
  B(0.15, -0.93, 0.66, 2.5, 0.5, 0.04, 0xe8ecef);
  B(0.15, 0.93, 0.66, 2.5, 0.5, 0.04, 0xe8ecef);
  B(0.15, 0, 1.46, 2.0, 0.04, 1.5, 0xe8ecef);
  B(-2.28, 0, 0.72, 0.14, 0.62, 1.5, 0x3a4147);          // push bar
  B(-2.28, -0.5, 0.95, 0.2, 0.9, 0.1, 0x3a4147);
  B(-2.28, 0.5, 0.95, 0.2, 0.9, 0.1, 0x3a4147);
  // Light bar: a low plinth with the lenses sitting ON TOP of it. The first version made the
  // housing a 0.16m-tall box and put the lenses at its centre height, which buried them inside
  // it — the lights were driving correctly the whole time and nothing was visible.
  B(0.1, 0, 1.5, 0.3, 0.08, 1.45, 0x24282c);             // plinth
  B(0.1, 0, 1.62, 0.26, 0.15, 0.34, 0x2a2f34);           // centre divider between the halves
  if (beacons) {
    // lens centres, in world space, tagged with which half of the bar they are
    beacons.push({ pos: rotZAxis ? [x - 0.52, 1.62, z + 0.1] : [x + 0.1, 1.62, z - 0.52], hue: 'red' });
    beacons.push({ pos: rotZAxis ? [x + 0.52, 1.62, z + 0.1] : [x + 0.1, 1.62, z + 0.52], hue: 'blue' });
  }
  return out;
}
