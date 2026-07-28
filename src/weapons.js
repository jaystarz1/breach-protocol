import * as THREE from 'three';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { quality } from './quality.js';
import { surfaces } from './textures.js';
import { sfx } from './audio.js';

export const WEAPON_SPECS = {
  pistol: {
    name: 'M9 SIDEARM', auto: false, damage: 34, rpm: 320, mag: 12, reserve: Infinity,
    spread: 0.012, adsSpread: 0.004, recoil: 0.022, range: 60, reloadTime: 1.3,
    adsFov: 55, sound: 'pistol',
  },
  m4: {
    name: 'M4 CARBINE', auto: true, damage: 26, rpm: 700, mag: 30, reserve: 120,
    spread: 0.02, adsSpread: 0.006, recoil: 0.014, range: 120, reloadTime: 2.0,
    adsFov: 45, sound: 'rifle',
  },
  barrett: {
    name: 'BARRETT M82 .50', auto: false, damage: 500, rpm: 35, mag: 10, reserve: 30,
    spread: 0.09, adsSpread: 0.0, recoil: 0.09, range: 600, reloadTime: 3.2,
    adsFov: 7, sound: 'sniper', scoped: true, sway: 0.006,
  },
};

// ---------- view model ----------
// -Z is downrange, +Y up, +X right. The view model is on screen 100% of the time, so it is
// the one place in this project where part count is worth spending on: three or four boxes
// read as a toy no matter how good the material is, because a real weapon's silhouette is
// made of the small stuff — trigger guard, sights, magazine well, muzzle device, optic.
//
// Each mesh publishes two local anchors:
//   userData.sight  — the point that must land on screen centre when aiming
//   userData.muzzle — where the flash and light belong
// Without the sight anchor, ADS pulls the gun to a hardcoded offset and the irons sit an inch
// below the crosshair, which reads as "the bullets do not come out of the gun".
let gmats = null;
function gunMaterials() {
  if (gmats) return gmats;
  const s = quality.textures ? surfaces() : null;
  const std = (color, roughness, metalness, textured) => quality.pbr
    ? new THREE.MeshStandardMaterial({
      color, roughness, metalness,
      map: textured ? s?.metal.map || null : null,
      roughnessMap: textured ? s?.metal.roughnessMap || null : null,
    })
    : new THREE.MeshLambertMaterial({ color });
  gmats = {
    steel: std(0x474e55, 0.38, 0.9, true),      // slide, barrel, receiver
    black: std(0x1d2226, 0.55, 0.55, true),     // parkerised furniture
    poly: std(0x30363a, 0.88, 0.03, false),     // polymer grip / handguard / stock
    tan: std(0x6d5f45, 0.82, 0.04, false),      // sniper furniture
    glove: quality.pbr
      ? new THREE.MeshStandardMaterial({
        color: 0x363d41, roughness: 0.9, metalness: 0.01,
        map: s?.fabric.map || null,
        normalMap: s?.fabric.normalMap || null,
        normalScale: new THREE.Vector2(0.16, 0.16),
      })
      : new THREE.MeshLambertMaterial({ color: 0x363d41 }),
    sleeve: quality.pbr
      ? new THREE.MeshStandardMaterial({
        color: 0x22272a, roughness: 0.96, metalness: 0,
        map: s?.fabric.map || null,
        roughnessMap: s?.fabric.roughnessMap || null,
        normalMap: s?.fabric.normalMap || null,
        normalScale: new THREE.Vector2(0.24, 0.24),
      })
      : new THREE.MeshLambertMaterial({ color: 0x22272a }),
    // Optic glass has to be SEE-THROUGH. An opaque lens disc is geometrically honest and
    // completely unusable: aiming down the sight put a solid green coin exactly where the
    // target was. Transparent, additive, and depthWrite off so it tints the view instead of
    // replacing it and never occludes anything behind it.
    glass: new THREE.MeshBasicMaterial({
      color: 0x1d4a3c, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
    // Illuminated elements. depthTest off so the reticle is never swallowed by the tube it
    // sits inside, additive so it glows rather than paints.
    dot: new THREE.MeshBasicMaterial({
      color: 0xff5540, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    }),
    tritium: new THREE.MeshBasicMaterial({
      color: 0x7effb4, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    }),
  };
  return gmats;
}

// Hollow tube along Z: walls only, open at both ends. This is what makes an optic something
// you look THROUGH rather than a solid cylinder with a lid on each end.
const shell = (mat, r, len, x, y, z, seg = 14) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg, 1, true), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
};
// Flat ring, for lens rims and objective bells that must not block the sight picture.
const ring = (mat, ri, ro, x, y, z, seg = 16) => {
  const m = new THREE.Mesh(new THREE.RingGeometry(ri, ro, seg), mat);
  m.position.set(x, y, z);
  return m;
};

const bx = (mat, w, h, d, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};
const rb = (mat, w, h, d, x = 0, y = 0, z = 0, radius = 0.006) => {
  const r = Math.min(radius, w * 0.22, h * 0.22);
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const bevel = Math.min(r * 0.45, d * 0.12);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, d - bevel * 2),
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 2,
  });
  geometry.translate(0, 0, -d / 2 + bevel);
  geometry.computeVertexNormals();
  const out = new THREE.Mesh(geometry, mat);
  out.position.set(x, y, z);
  return out;
};
// Cylinder along Z (barrels, tubes, scope bodies). Default geometry runs along Y.
const tube = (mat, r, len, x, y, z, seg = 10) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
};
// Trigger guard: a real one is a loop, and the hole is most of what the eye reads.
const guard = (mat, y, z, w = 0.05) => [
  bx(mat, w, 0.016, 0.1, 0, y - 0.05, z),
  bx(mat, w, 0.05, 0.016, 0, y - 0.026, z - 0.042),
  bx(mat, w, 0.05, 0.016, 0, y - 0.026, z + 0.042),
];

function geometryBetween(from, to, r0, r1, radialSegments = 10) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const delta = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(r1, r0, delta.length(), radialSegments, 1);
  const matrix = new THREE.Matrix4().compose(
    a.add(b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()),
    new THREE.Vector3(1, 1, 1),
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

function transformedGeometry(geometry, position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

function mergeParts(parts) {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  merged.computeBoundingSphere();
  return merged;
}

const gloveGeometries = new Map();
function gloveGeometry(side, support) {
  const key = `${side}:${support ? 1 : 0}`;
  if (gloveGeometries.has(key)) return gloveGeometries.get(key);
  const parts = [];

  // One continuous palm mass, flattened across the back of the hand and long enough to meet
  // the cuff. The old sphere was the source of the oven-mitt silhouette.
  parts.push(transformedGeometry(
    new THREE.CapsuleGeometry(0.036, 0.052, 6, 12),
    [0, 0, 0.006], [Math.PI / 2, 0, 0], [1.05, 0.66, 1],
  ));

  // Four two-bone fingers. The middle joint moves below the palm and the tip turns back
  // toward it, so the silhouette actually closes around a grip instead of ending in four
  // parallel sausages.
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.0175;
    const lengthBias = 1 - Math.abs(i - 1.5) * 0.055;
    const base = [x, -0.004, -0.036];
    const middle = [
      x + side * (i - 1.5) * 0.0008,
      support ? -0.031 : -0.022,
      (support ? -0.044 : -0.058) * lengthBias,
    ];
    const tip = [
      x + side * 0.002,
      support ? -0.061 : -0.041,
      (support ? -0.032 : -0.078) * lengthBias,
    ];
    parts.push(geometryBetween(base, middle, 0.0094, 0.0084, 8));
    parts.push(geometryBetween(middle, tip, 0.0084, 0.0067, 8));
    parts.push(transformedGeometry(
      new THREE.SphereGeometry(1, 8, 6),
      middle, [0, 0, 0], [0.009, 0.008, 0.009],
    ));
    // Low-profile knuckle protection breaks up the back of the glove in the most visible area.
    parts.push(transformedGeometry(
      new THREE.SphereGeometry(1, 8, 5),
      [x, 0.022, -0.029], [0, 0, 0], [0.011, 0.0045, 0.014],
    ));
  }

  // Articulated thumb across the side of the grip, with a real change of direction at the
  // joint. Mirroring by `side` keeps the same authored shape for both hands.
  const thumbBase = [side * 0.035, 0.002, -0.003];
  const thumbJoint = [side * 0.053, -0.012, -0.025];
  const thumbTip = [side * 0.048, -0.032, -0.048];
  parts.push(geometryBetween(thumbBase, thumbJoint, 0.0115, 0.0102, 9));
  parts.push(geometryBetween(thumbJoint, thumbTip, 0.0102, 0.0074, 9));
  parts.push(transformedGeometry(
    new THREE.SphereGeometry(1, 8, 6),
    thumbJoint, [0, 0, 0], [0.011, 0.01, 0.011],
  ));

  // Cuff and closure tab. Both are part of the same merged glove draw.
  parts.push(transformedGeometry(
    new THREE.CylinderGeometry(0.049, 0.045, 0.04, 12),
    [0, 0, 0.067], [Math.PI / 2, 0, 0], [1, 0.78, 1],
  ));
  parts.push(transformedGeometry(
    new THREE.BoxGeometry(0.065, 0.012, 0.035),
    [side * 0.015, 0.025, 0.067], [0.08, 0, side * 0.08],
  ));

  const merged = mergeParts(parts);
  merged.userData = { authoredGlove: true, segments: parts.length };
  gloveGeometries.set(key, merged);
  return merged;
}

function sleeveGeometry(wrist, elbow, side) {
  const a = new THREE.Vector3(...wrist);
  const b = new THREE.Vector3(...elbow);
  const middle = a.clone().lerp(b, 0.54);
  middle.x += side * 0.014;
  middle.y -= 0.016;
  return mergeParts([
    geometryBetween(wrist, middle.toArray(), 0.048, 0.058, 12),
    geometryBetween(middle.toArray(), elbow, 0.058, 0.068, 12),
    transformedGeometry(
      new THREE.CylinderGeometry(0.052, 0.055, 0.026, 12),
      wrist, [Math.PI / 2, 0, 0], [1, 0.82, 1],
    ),
  ]);
}

// A weapon floating by itself always reads like a debug prop. These compact rigs keep the
// hands welded to authored grip points and let the forearms follow the weapon through ADS,
// recoil and reload without adding a separate skinned-viewmodel asset.
function addGlovedArm(parent, M, {
  side, palm, palmRot, elbow, spread = 1, support = false,
}) {
  const hand = new THREE.Group();
  hand.position.fromArray(palm);
  hand.rotation.set(...palmRot);
  hand.scale.set(1, 1, spread);
  const glove = new THREE.Mesh(gloveGeometry(side, support), M.glove);
  glove.name = support ? 'authored-support-glove' : 'authored-trigger-glove';
  glove.userData.authoredViewmodelGlove = true;
  glove.userData.side = side;
  glove.userData.support = support;
  hand.add(glove);
  parent.add(hand);

  const wrist = [palm[0], palm[1], palm[2] + 0.075];
  const sleeve = new THREE.Mesh(sleeveGeometry(wrist, elbow, side), M.sleeve);
  sleeve.name = support ? 'authored-support-sleeve' : 'authored-trigger-sleeve';
  sleeve.userData.authoredViewmodelSleeve = true;
  parent.add(sleeve);
}

function gunMesh(kind) {
  const g = new THREE.Group();
  const M = gunMaterials();

  if (kind === 'pistol') {
    g.scale.setScalar(0.78);
    // slide with an ejection port cut and a squared-off muzzle end
    g.add(rb(M.steel, 0.048, 0.052, 0.25, 0, 0.026, -0.02, 0.005));
    g.add(bx(M.black, 0.03, 0.03, 0.05, 0.012, 0.03, 0.02));      // port
    g.add(rb(M.steel, 0.044, 0.03, 0.22, 0, -0.012, -0.01, 0.004)); // frame / dust cover
    g.add(tube(M.black, 0.011, 0.06, 0, 0.026, -0.155, 8));       // barrel crown
    // grip: raked back, with a checkered polymer panel and a visible mag baseplate
    const grip = rb(M.poly, 0.042, 0.15, 0.062, 0, -0.095, 0.075, 0.007);
    grip.rotation.x = 0.28; g.add(grip);
    const base = bx(M.black, 0.048, 0.014, 0.07, 0, -0.172, 0.1);
    base.rotation.x = 0.28; g.add(base);
    g.add(...guard(M.black, -0.016, 0.032, 0.044));
    g.add(bx(M.black, 0.012, 0.036, 0.012, 0, -0.028, 0.028));    // trigger
    g.add(bx(M.black, 0.03, 0.022, 0.02, 0, 0.062, 0.085));        // hammer / beavertail
    // sights: front post plus a rear notch made of two blades, with tritium dots
    g.add(bx(M.black, 0.008, 0.016, 0.01, 0, 0.06, -0.13));
    g.add(bx(M.tritium, 0.004, 0.005, 0.006, 0, 0.062, -0.135));
    g.add(bx(M.black, 0.01, 0.014, 0.012, -0.015, 0.059, 0.075));
    g.add(bx(M.black, 0.01, 0.014, 0.012, 0.015, 0.059, 0.075));
    g.add(bx(M.tritium, 0.004, 0.005, 0.006, -0.015, 0.061, 0.07));
    g.add(bx(M.tritium, 0.004, 0.005, 0.006, 0.015, 0.061, 0.07));
    addGlovedArm(g, M, {
      side: 1, palm: [0.052, -0.092, 0.066], palmRot: [0.32, 0.05, -0.08],
      elbow: [0.18, -0.4, 0.3],
    });
    addGlovedArm(g, M, {
      side: -1, palm: [-0.052, -0.07, 0.008], palmRot: [0.18, -0.08, 0.22],
      elbow: [-0.17, -0.38, 0.26], support: true,
    });
    g.userData.sight = [0, 0.06, 0];
    g.userData.muzzle = [0, 0.026, -0.2];

  } else if (kind === 'm4') {
    g.scale.setScalar(0.7);
    // upper + lower receiver, with the magazine well as its own block so the profile steps
    g.add(rb(M.steel, 0.05, 0.062, 0.3, 0, 0.02, 0.13, 0.006));
    g.add(rb(M.black, 0.048, 0.056, 0.17, 0, -0.038, 0.185, 0.006));
    g.add(bx(M.black, 0.052, 0.014, 0.32, 0, 0.056, 0.12));        // top rail
    for (let i = 0; i < 7; i++) g.add(bx(M.steel, 0.054, 0.008, 0.014, 0, 0.064, 0.0 + i * 0.045));
    // handguard: quad rail, slotted, then gas block and barrel out the front
    g.add(rb(M.poly, 0.052, 0.052, 0.26, 0, 0.018, -0.15, 0.007));
    for (let i = 0; i < 6; i++) g.add(bx(M.black, 0.056, 0.01, 0.018, 0, 0.018, -0.05 - i * 0.04));
    g.add(bx(M.steel, 0.03, 0.04, 0.05, 0, 0.036, -0.29));         // gas block
    g.add(tube(M.steel, 0.012, 0.19, 0, 0.026, -0.38, 8));         // barrel
    g.add(tube(M.black, 0.019, 0.06, 0, 0.026, -0.49, 8));         // flash hider
    for (const a of [0, 1.05, 2.09]) {                              // muzzle ports
      const p = bx(M.poly, 0.006, 0.03, 0.03, 0, 0.026, -0.49);
      p.rotation.z = a; g.add(p);
    }
    // pistol grip, trigger, magazine (two segments so it curves), collapsible stock
    const grip = rb(M.poly, 0.044, 0.13, 0.058, 0, -0.09, 0.245, 0.007);
    grip.rotation.x = 0.34; g.add(grip);
    g.add(...guard(M.black, -0.018, 0.2, 0.046));
    g.add(bx(M.black, 0.012, 0.034, 0.012, 0, -0.03, 0.196));
    const mag1 = rb(M.poly, 0.042, 0.11, 0.062, 0, -0.105, 0.155, 0.006);
    mag1.rotation.x = -0.1; g.add(mag1);
    const mag2 = rb(M.poly, 0.04, 0.09, 0.058, 0, -0.195, 0.127, 0.006);
    mag2.rotation.x = -0.36; g.add(mag2);
    g.add(tube(M.black, 0.018, 0.16, 0, 0.014, 0.35, 8));          // buffer tube
    g.add(rb(M.poly, 0.05, 0.075, 0.13, 0, 0.0, 0.4, 0.008));      // stock body
    g.add(bx(M.poly, 0.048, 0.026, 0.03, 0, -0.05, 0.44));         // toe
    g.add(bx(M.black, 0.052, 0.02, 0.036, 0, 0.032, 0.465));       // buttpad
    g.add(bx(M.black, 0.06, 0.012, 0.03, 0, 0.062, 0.28));         // charging handle
    // Optic: an open tube you sight through. Walls only, rings for the lens rims, faint
    // additive glass, and an illuminated dot suspended on the bore axis.
    g.add(bx(M.black, 0.036, 0.02, 0.09, 0, 0.07, 0.06));          // mount
    g.add(shell(M.black, 0.026, 0.15, 0, 0.098, 0.04));            // body
    g.add(ring(M.black, 0.026, 0.032, 0, 0.098, -0.036));          // objective rim
    g.add(ring(M.black, 0.026, 0.032, 0, 0.098, 0.116));           // ocular rim
    // Group.add() returns the group, not the child, so the lens is positioned before adding.
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 16), M.glass);
    lens.position.set(0, 0.098, -0.03);
    g.add(lens);
    g.add(bx(M.black, 0.014, 0.026, 0.026, 0.032, 0.098, 0.055));  // windage turret
    // The dot itself, plus a faint surrounding ring: a circle-dot reticle. Both are additive
    // and depth-test-free, which is what makes them read as emitted light in a black room.
    const rdot = bx(M.dot, 0.006, 0.006, 0.002, 0, 0.098, -0.03);
    const rring = ring(M.dot, 0.019, 0.021, 0, 0.098, -0.03);
    g.add(rdot, rring);
    g.userData.reticle = [rdot, rring];
    addGlovedArm(g, M, {
      side: 1, palm: [0.058, -0.105, 0.245], palmRot: [0.32, 0.02, -0.08],
      elbow: [0.2, -0.42, 0.49],
    });
    addGlovedArm(g, M, {
      side: -1, palm: [-0.066, -0.004, -0.15], palmRot: [-0.2, 0.04, 0.2],
      elbow: [-0.23, -0.37, 0.2], support: true,
    });
    g.userData.sight = [0, 0.098, 0];
    g.userData.muzzle = [0, 0.026, -0.53];

  } else {
    g.scale.setScalar(0.6);
    // Barrett: the read is LENGTH plus the muzzle brake plus the bipod. Everything else is
    // supporting cast, but the brake is the silhouette people recognise.
    g.add(rb(M.steel, 0.062, 0.09, 0.62, 0, 0.01, 0.16, 0.008));    // receiver
    g.add(bx(M.black, 0.07, 0.026, 0.66, 0, 0.062, 0.14));          // top rail
    g.add(rb(M.tan, 0.058, 0.07, 0.2, 0, -0.02, 0.5, 0.008));       // cheek riser / buttstock
    g.add(bx(M.black, 0.062, 0.09, 0.04, 0, -0.01, 0.61));          // buttpad
    g.add(rb(M.steel, 0.05, 0.05, 0.52, 0, 0.02, -0.36, 0.006));    // barrel shroud
    g.add(tube(M.steel, 0.017, 0.28, 0, 0.02, -0.72, 10));          // exposed barrel
    // arrowhead muzzle brake: baffle plates with the gaps between them doing the work
    g.add(tube(M.black, 0.03, 0.14, 0, 0.02, -0.93, 10));
    for (let i = 0; i < 3; i++) g.add(bx(M.black, 0.1, 0.052, 0.022, 0, 0.02, -0.88 - i * 0.045));
    // grip, guard, and the big detachable magazine
    const grip = rb(M.poly, 0.05, 0.15, 0.07, 0, -0.11, 0.36, 0.008);
    grip.rotation.x = 0.3; g.add(grip);
    g.add(...guard(M.black, -0.036, 0.3, 0.052));
    g.add(bx(M.black, 0.014, 0.04, 0.014, 0, -0.05, 0.296));
    g.add(rb(M.black, 0.05, 0.19, 0.09, 0, -0.13, 0.16, 0.008));    // mag body
    g.add(bx(M.steel, 0.056, 0.016, 0.096, 0, -0.232, 0.16));       // mag floorplate
    g.add(bx(M.black, 0.05, 0.04, 0.14, 0, 0.086, 0.42));           // carry handle
    // bipod: two splayed legs, not one stick
    for (const sx of [-1, 1]) {
      const leg = bx(M.black, 0.014, 0.2, 0.014, sx * 0.05, -0.11, -0.5);
      leg.rotation.z = sx * 0.3; g.add(leg);
      g.add(bx(M.black, 0.03, 0.012, 0.03, sx * 0.082, -0.208, -0.5));
    }
    g.add(bx(M.steel, 0.03, 0.03, 0.06, 0, -0.05, -0.5));           // bipod mount
    // scope: objective bell, main tube, ocular, elevation + windage turrets
    g.add(tube(M.black, 0.05, 0.13, 0, 0.13, -0.16, 14));
    g.add(tube(M.glass, 0.045, 0.005, 0, 0.13, -0.226, 14));
    g.add(tube(M.black, 0.03, 0.38, 0, 0.13, 0.1, 14));
    g.add(tube(M.black, 0.042, 0.07, 0, 0.13, 0.32, 14));
    g.add(bx(M.black, 0.03, 0.038, 0.03, 0, 0.166, 0.03));
    g.add(bx(M.black, 0.038, 0.03, 0.03, 0.032, 0.13, 0.03));
    for (const rz of [-0.05, 0.16]) g.add(bx(M.black, 0.05, 0.05, 0.028, 0, 0.098, rz)); // rings
    addGlovedArm(g, M, {
      side: 1, palm: [0.065, -0.12, 0.36], palmRot: [0.32, 0.02, -0.1],
      elbow: [0.21, -0.44, 0.56],
    });
    addGlovedArm(g, M, {
      side: -1, palm: [-0.075, -0.035, -0.43], palmRot: [-0.12, 0.02, 0.18],
      elbow: [-0.25, -0.39, 0.08], support: true,
    });
    g.userData.sight = [0, 0.13, 0];
    g.userData.muzzle = [0, 0.02, -1.0];
  }
  if (quality.shadows) g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return g;
}

export class Weapons {
  constructor(camera) {
    this.camera = camera;
    this.holder = new THREE.Group();
    camera.add(this.holder);
    this.holder.position.set(0.22, -0.22, -0.45);
    this.meshes = {};
    for (const k of Object.keys(WEAPON_SPECS)) {
      this.meshes[k] = gunMesh(k);
      this.meshes[k].visible = false;
      this.holder.add(this.meshes[k]);
    }
    // ---------- muzzle flash ----------
    // A short orange pop, not a white starburst.
    //
    // The old one read as white for a reason worth writing down: additive blending ADDS to
    // whatever is behind it, so a pale warm colour at full opacity clips every channel and
    // lands on white no matter what hex you asked for. Staying orange means a saturated
    // colour AND a peak opacity under 1, so the blue channel never saturates.
    //
    // It was also enormous. These planes live on the holder, which is NOT scaled by the
    // gun's 0.6-0.78, so 0.34m of plane at half a metre from the eye covered a third of the
    // screen. Petals are 0.095m now and the whole thing is scaled per weapon.
    this.flash = new THREE.PointLight(0xff9838, 0, 12);
    this.flash.position.set(0, 0, -0.55);
    this.holder.add(this.flash);
    this.petalMat = new THREE.MeshBasicMaterial({
      color: 0xff7418, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.coreMat = new THREE.MeshBasicMaterial({
      color: 0xffb452, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.flashMesh = new THREE.Group();
    for (const rot of [0, Math.PI / 3, -Math.PI / 3]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.095, 0.023), this.petalMat);
      plane.rotation.z = rot;
      this.flashMesh.add(plane);
    }
    // Hot core, small and short-lived. It is what gives the pop a centre instead of leaving
    // three crossed streaks floating in front of the barrel.
    this.flashMesh.add(new THREE.Mesh(new THREE.CircleGeometry(0.022, 10), this.coreMat));
    this.flashMesh.position.set(0, 0.02, -0.55);
    this.flashMesh.visible = false;
    this.flashLife = 0;
    this.flashSize = 1;
    this.holder.add(this.flashMesh);
    this.loadout = ['pistol'];
    this.current = 'pistol';
    this.state = {};
    this.cooldown = 0;
    this.reloading = 0;
    this.recoilKick = 0;
    this.grenades = 0;
    this.flashes = 0;
    this.onFire = null; // (spread) => void, set by main
  }

  setLoadout(list, grenades, flashes = 0) {
    this.loadout = list;
    this.grenades = grenades;
    this.flashes = flashes;
    this.state = {};
    for (const k of list) {
      const s = WEAPON_SPECS[k];
      this.state[k] = { mag: s.mag, reserve: s.reserve };
    }
    this.select(list[list.length - 1]);
  }

  select(kind) {
    this.current = kind;
    this.reloading = 0;
    for (const k of Object.keys(this.meshes)) this.meshes[k].visible = (k === kind);
    // Flash belongs at THIS weapon's muzzle. A shared offset put the M4's flash a hand's
    // width behind the flash hider and the Barrett's flash halfway down the barrel.
    const m = this.meshes[kind];
    const s = m.scale.x;
    const mz = m.userData.muzzle || [0, 0, -0.55];
    this.flash.position.set(mz[0] * s, mz[1] * s, mz[2] * s);
    this.flashMesh.position.set(mz[0] * s, mz[1] * s + 0.02, mz[2] * s);
    // A 9mm pop and a .50 muzzle brake blast are not the same event.
    this.flashSize = kind === 'pistol' ? 0.72 : kind === 'barrett' ? 1.75 : 1;
    const sg = m.userData.sight || [0, 0, 0];
    // Where the holder must sit for the sights to land on the crosshair.
    this.adsX = -sg[0] * s;
    this.adsY = -sg[1] * s;
  }

  swap() {
    if (this.loadout.length < 2) return;
    const i = this.loadout.indexOf(this.current);
    this.select(this.loadout[(i + 1) % this.loadout.length]);
  }

  get spec() { return WEAPON_SPECS[this.current]; }
  get ammo() { return this.state[this.current]; }

  reload() {
    const st = this.ammo, sp = this.spec;
    if (this.reloading > 0 || st.mag >= sp.mag || st.reserve <= 0) return;
    this.reloading = sp.reloadTime;
    sfx.reload();
  }

  // fireHeld: button state; adsActive; returns true if a shot happened this frame
  update(dt, fireHeld, firePressed, ads) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.recoilKick = Math.max(0, this.recoilKick - dt * 3);
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 110);
    // One life value drives the whole pop, so the pieces cannot drift out of step. ~45ms.
    if (this.flashLife > 0) {
      this.flashLife = Math.max(0, this.flashLife - dt * 22);
      const f = this.flashLife;
      // Peak 0.78, not 1: above that the additive blend clips to white and the colour is lost.
      this.petalMat.opacity = f * 0.78;
      // f*f: the core snaps out faster than the petals, which is what makes it read as a
      // flash with a hot centre rather than a uniform glowing shape fading out.
      this.coreMat.opacity = f * f * 0.9;
      // Expands slightly as it dies — the "poof" rather than a hard blink.
      this.flashMesh.scale.setScalar(this.flashSize * (1.22 - f * 0.34));
      this.flashMesh.visible = f > 0.02;
    }

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const st = this.ammo, sp = this.spec;
        const need = sp.mag - st.mag;
        const take = Math.min(need, st.reserve);
        st.mag += take;
        if (st.reserve !== Infinity) st.reserve -= take;
      }
    }

    const sp = this.spec, st = this.ammo;
    const wantFire = sp.auto ? fireHeld : firePressed;
    let fired = false;
    if (wantFire && this.cooldown <= 0 && this.reloading <= 0) {
      if (st.mag <= 0) { if (firePressed) { sfx.empty(); this.reload(); } }
      else {
        st.mag--;
        this.cooldown = 60 / sp.rpm;
        this.recoilKick = Math.min(1, this.recoilKick + 0.5);
        this.flash.intensity = 7 * this.flashSize;
        this.flashLife = 1;
        this.flashMesh.visible = true;
        // Fresh orientation every shot so consecutive rounds do not stamp the same shape.
        this.flashMesh.rotation.z = Math.random() * Math.PI;
        sfx[sp.sound]();
        const spread = ads ? sp.adsSpread : sp.spread;
        if (this.onFire) this.onFire(spread);
        fired = true;
      }
    }

    // view-model animation: recoil pushback + idle bob
    const t = performance.now() / 1000;
    const kick = this.recoilKick * 0.06;
    // A scoped rifle at 7 degrees FOV magnifies the view model until the receiver fills the
    // screen behind the scope mask. Hide it: you are looking THROUGH the optic, not at it.
    const mesh = this.meshes[this.current];
    const throughScope = !!sp.scoped && ads;
    mesh.visible = !throughScope;
    // The in-world reticle and the HUD reticle would land on the same pixels while aiming,
    // so only one is ever shown: geometry off the hip, the crisp HUD element down the sight.
    const ret = mesh.userData.reticle;
    if (ret) for (const r of ret) r.visible = !ads;
    // Reload: cant the weapon inboard and drop it out of the sight line, which is the whole
    // reason a reload feels like a commitment rather than a number changing.
    const rl = this.reloading > 0 ? Math.min(1, Math.sin((1 - this.reloading / sp.reloadTime) * Math.PI) * 1.6) : 0;
    // Further from the eye while aiming. The sight anchor keeps it centred at any z (a point
    // at camera-space x=y=0 projects to screen centre regardless of depth), so this is free
    // shrink: it cuts how much of the lower screen the receiver eats without moving the aim.
    this.holder.position.z = (ads ? -0.7 : -0.45) + kick;
    this.holder.position.x = (ads ? (this.adsX ?? 0) : 0.22) + rl * 0.05;
    this.holder.position.y = (ads ? (this.adsY ?? -0.155) : -0.22) + Math.sin(t * 1.8) * 0.004 - rl * 0.12;
    this.holder.rotation.x = this.recoilKick * 0.06 + rl * 0.28;
    this.holder.rotation.z = -rl * 0.5;
    return fired;
  }
}

// ---------- Throwables ----------
export class Grenade {
  constructor(scene, pos, dir, kind = 'frag') {
    this.kind = kind;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      quality.pbr
        ? new THREE.MeshStandardMaterial({ color: kind === 'flash' ? 0xb0bec5 : 0x33421f, roughness: 0.5, metalness: 0.6 })
        : new THREE.MeshLambertMaterial({ color: kind === 'flash' ? 0xb0bec5 : 0x33421f })
    );
    this.mesh.position.copy(pos);
    scene.add(this.mesh);
    this.vel = dir.clone().multiplyScalar(14);
    this.vel.y += 3.5;
    this.fuse = kind === 'flash' ? 1.5 : 2.2;
    this.dead = false;
  }
  // solids for bounce; returns true when exploded
  update(dt, solids, groundFn) {
    this.fuse -= dt;
    this.vel.y -= 18 * dt;
    const p = this.mesh.position;
    p.addScaledVector(this.vel, dt);
    const g = groundFn(p.x, p.z, 0.09, p.y + 0.2);
    if (p.y < g + 0.09) { p.y = g + 0.09; this.vel.y *= -0.35; this.vel.x *= 0.7; this.vel.z *= 0.7; }
    return this.fuse <= 0;
  }
}

export function explosionEffect(scene, pos) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffbb55, transparent: true, opacity: 0.9 }));
  ball.position.copy(pos);
  ball.position.y += 0.5;
  scene.add(ball);
  let age = 0;
  return function update(dt) {
    age += dt;
    ball.scale.setScalar(1 + age * 14);
    ball.material.opacity = Math.max(0, 0.9 - age * 2.2);
    if (age > 0.5) { scene.remove(ball); ball.geometry.dispose(); ball.material.dispose(); return true; }
    return false;
  };
}
