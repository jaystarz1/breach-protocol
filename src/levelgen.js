import * as THREE from 'three';
import { makeBox } from './physics.js';
import { quality } from './quality.js';
import { surfaces } from './textures.js';

// Texels per world metre. Every face is projected at this scale regardless of box size,
// so a 20m wall and a 0.5m crate share the same grain and nothing stretches.
const TEXELS_PER_M = 0.5;

// geo entries: [x, y, z, w, h, d, color, solid=true, emissive=false]
// Merges all static boxes into one mesh with vertex colors for a single draw call.
//
// Emissive entries go into a SECOND merged mesh drawn with MeshBasicMaterial. Lighting a
// window pane the same way as the wall around it makes it a pale grey rectangle; drawing it
// unlit is what makes it read as a lamp or a lit room. Two draw calls total, not two hundred.
export function buildStaticGeometry(scene, geo) {
  const solids = [];
  const lit = [];
  const positions = [], normals = [], colors = [], uvs = [], indices = [];
  let vtx = 0;
  const c = new THREE.Color();
  for (const entry of geo) {
    const [x, y, z, w, h, d, color, solid, emissive] = entry;
    if (solid !== false) solids.push(makeBox(x, y, z, w, h, d));
    if (emissive) { lit.push(entry); continue; }
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const pos = g.attributes.position, norm = g.attributes.normal, idx = g.index;
    c.setHex(color);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);
      positions.push(px, py, pz);
      normals.push(nx, ny, nz);
      colors.push(c.r, c.g, c.b);
      // Planar-project onto whichever axis this face points along. Boxes are all
      // axis-aligned, so the dominant normal component picks the projection plane and
      // world coordinates become UVs directly — uniform texel density, no seams to fix.
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      let u, v;
      if (ay >= ax && ay >= az) { u = px; v = pz; }        // floors and ceilings
      else if (ax >= az) { u = pz; v = py; }               // walls facing X
      else { u = px; v = py; }                             // walls facing Z
      uvs.push(u * TEXELS_PER_M, v * TEXELS_PER_M);
    }
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vtx);
    vtx += pos.count;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);

  let mat;
  if (quality.pbr) {
    const s = surfaces();
    mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, metalness: 0.04,
      map: quality.textures ? s.concrete.map : null,
      roughnessMap: quality.textures ? s.concrete.roughnessMap : null,
      // Colour and roughness alone leave every surface geometrically dead flat no matter how
      // it is lit. The normal map is what puts relief in the grain.
      normalMap: quality.textures ? s.concrete.normalMap : null,
      // 0.35, not 0.7: at 0.7 the speckle and crack relief turns close-range walls into
      // popcorn stucco. Surface relief should be felt at a glance, not itemised.
      normalScale: quality.textures ? new THREE.Vector2(0.35, 0.35) : undefined,
    });
  } else {
    mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  }
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = mesh.receiveShadow = quality.shadows;
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
export function bodyMaterial(color) {
  return quality.pbr
    ? new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.0 })
    : new THREE.MeshLambertMaterial({ color });
}

// ---------- Low-poly humanoid ----------
function limb(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMaterial(color));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = quality.shadows;
  return m;
}

// Articulated low-poly human. Enemy: tactical gear, helmet, red chest rig, rifle raised.
// Civilian: bright clothes, visible face, hands up, NO weapon. Hostage: kneeling, hands behind head.
const SKINS = [0xd9b08c, 0xc68863, 0xa9714b, 0x8d5a3b, 0xe8c39e];

function jointed(w, h, d, color) {
  // box whose origin is at its TOP so rotating the group bends at the joint
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMaterial(color));
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
export function makeCharacter({ hostile, hostage, friendly, black }) {
  const g = new THREE.Group();
  const armed = !!hostile || !!friendly;
  const skin = SKINS[Math.floor(Math.random() * SKINS.length)];
  const shirt = friendly ? (black ? 0x16191c : 0x2d3a4a)
    : hostile ? OD_SHIRT[Math.floor(Math.random() * OD_SHIRT.length)]
      : [0xef9a9a, 0x90caf9, 0xfff59d, 0xa5d6a7, 0xce93d8, 0xffcc80][Math.floor(Math.random() * 6)];
  const pants = friendly ? (black ? 0x121417 : 0x232b36)
    : hostile ? OD_PANTS[Math.floor(Math.random() * OD_PANTS.length)]
      : [0x546e7a, 0x6d4c41, 0x37474f][Math.floor(Math.random() * 3)];
  const boots = armed ? 0x15181b : 0x3e2723;

  // hips + torso (slight taper: chest wider than waist)
  g.add(limb(0.32, 0.14, 0.2, pants, 0, 0.92, 0));
  g.add(limb(0.34, 0.3, 0.2, shirt, 0, 1.13, 0));
  g.add(limb(0.4, 0.3, 0.22, shirt, 0, 1.4, 0));       // chest
  if (armed) {
    const rig = friendly ? (black ? 0x0d0f11 : 0x1b3560) : 0x3f4529;   // olive webbing
    g.add(limb(0.42, 0.26, 0.26, rig, 0, 1.38, 0));                    // chest rig
    g.add(limb(0.14, 0.1, 0.28, armed && !friendly ? 0x2f3520 : 0x1c1f22, -0.1, 1.24, 0.02)); // mag pouches
    g.add(limb(0.14, 0.1, 0.28, armed && !friendly ? 0x2f3520 : 0x1c1f22, 0.1, 1.24, 0.02));
  }
  if (hostile) {
    // Olive drab is correct for what these men are, but it cost the silhouette its single
    // strongest hostile tell (the old red chest rig) at exactly the moment identification
    // matters most. A red armband and helmet rag put that cue back — and irregular forces
    // really do mark themselves this way, so it costs nothing in plausibility.
    g.add(limb(0.13, 0.11, 0.135, 0x8f2622, -0.265, 1.33, 0));
    g.add(limb(0.135, 0.11, 0.13, 0x8f2622, 0.265, 1.33, 0));
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
  const headColor = armed ? 0x1c2024 : skin;              // balaclava vs skin
  headG.add(limb(0.22, 0.24, 0.24, headColor, 0, 0.06, 0));
  // eyes (a strip for the kitted-up; two dots for civilians)
  if (armed) {
    const lid = friendly ? (black ? 0x141719 : 0x22303f) : 0x424a2c;   // olive helmet
    headG.add(limb(0.18, 0.05, 0.02, skin, 0, 0.09, 0.125));
    headG.add(limb(0.26, 0.1, 0.27, lid, 0, 0.2, 0)); // helmet
    headG.add(limb(0.26, 0.05, 0.1, lid, 0, 0.14, -0.1));
    if (hostile) headG.add(limb(0.27, 0.045, 0.28, 0x8f2622, 0, 0.155, 0)); // red helmet rag
    // Cat-eye strip on the back of the helmet: the real-world marking that exists for exactly
    // this problem, and it means a squadmate is identifiable from directly behind too.
    if (friendly) headG.add(accent(0.14, 0.03, 0.02, 0x38e8ff, 0, 0.22, -0.13));
  } else {
    headG.add(limb(0.035, 0.035, 0.02, 0x2a2a2a, -0.05, 0.08, 0.125));
    headG.add(limb(0.035, 0.035, 0.02, 0x2a2a2a, 0.05, 0.08, 0.125));
    headG.add(limb(0.24, 0.09, 0.25, [0x2e2620, 0x4e342e, 0x9e9e9e, 0x212121][Math.floor(Math.random() * 4)], 0, 0.16, -0.01)); // hair
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
    const foot = limb(0.13, 0.09, 0.24, boots, 0, -0.42, 0.04);
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
    const hand = limb(0.09, 0.08, 0.09, skin, 0, -0.3, 0);
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
    rifle.position.set(0.1, 1.32, 0.22);
    rifle.rotation.y = 0.35;
    g.add(rifle);
    // arms hold the rifle
    lArm.rotation.x = -0.9; lArm.userData.fore.rotation.x = -0.5;
    rArm.rotation.x = -1.05; rArm.userData.fore.rotation.x = -0.35;
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
  g.userData.rig = { headG, lLeg, rLeg, lArm, rArm, rifle, hostile: armed, hostage, friendly, torsoTilt: 0 };
  return g;
}

// Walk cycle plus hit reaction. phase advances with distance moved; flinch is 0..~0.32s
// remaining, which jerks the upper body back so bullets visibly land.
export function animateRig(g, phase, moving, flinch = 0) {
  const r = g.userData.rig;
  if (!r) return;
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

// Death sprawl: called once at kill time to splay the figure before it tips over.
export function deathPose(g) {
  const r = g.userData.rig;
  if (!r) return;
  const s = () => (Math.random() - 0.5);
  r.lArm.rotation.set(-0.4 + s() * 0.5, 0, 0.9 + s() * 0.4);
  r.rArm.rotation.set(-0.3 + s() * 0.5, 0, -0.9 + s() * 0.4);
  r.lLeg.rotation.x = s() * 0.5; r.rLeg.rotation.x = s() * 0.5;
  if (r.rifle) { r.rifle.rotation.z = 0.9; r.rifle.position.y = 0.9; }
  g.rotation.z = s() * 0.35;
}

// Breachable door mesh
export function makeDoor(w = 1.4, h = 2.4) {
  const g = new THREE.Group();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.12),
    bodyMaterial(0x6d4c41)
  );
  panel.position.y = h / 2;
  g.add(panel);
  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.2), bodyMaterial(0xffc107));
  knob.position.set(w / 2 - 0.18, h / 2, 0);
  g.add(knob);
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
  return [[x, y + s / 2, z, s, s, s, C.crate]];
}

export function car(x, z, rotZAxis = false) {
  // simple parked car: body + cabin
  const body = rotZAxis ? [x, 0.45, z, 1.8, 0.9, 4.2] : [x, 0.45, z, 4.2, 0.9, 1.8];
  const cab = rotZAxis ? [x, 1.15, z, 1.6, 0.55, 2.0] : [x, 1.15, z, 2.0, 0.55, 1.6];
  const col = [0x7a2e2e, 0x2e4a7a, 0x666666, 0x3f5c3f][Math.floor(Math.random() * 4)];
  return [[...body, col], [...cab, col]];
}
