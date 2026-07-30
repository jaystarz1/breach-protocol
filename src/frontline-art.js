// Lean, instanced frontline dressing for Street Sweep.
// Gameplay collision remains in the authored level geometry; this layer adds the evidence of
// a town held under repeated assault without turning every rubble fragment into a draw call.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { quality } from './quality.js';
import { rng } from './world.js';
import { photoSurfaces, surfaces } from './textures.js';

let materialKit = null;

function frontlineMaterials() {
  if (materialKit) return materialKit;
  const photos = photoSurfaces();
  const procedural = surfaces();
  materialKit = {
    concrete: new THREE.MeshStandardMaterial({
      color: 0x888a84,
      map: photos?.concrete?.map || procedural.concrete.map,
      normalMap: photos?.concrete?.normalMap || procedural.concrete.normalMap,
      roughnessMap: photos?.concrete?.roughnessMap || procedural.concrete.roughnessMap,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughness: 0.97,
      metalness: 0,
    }),
    asphalt: new THREE.MeshStandardMaterial({
      color: 0x4b4d4c,
      map: photos?.asphalt?.map || procedural.concrete.map,
      bumpMap: photos?.asphalt?.height || null,
      bumpScale: photos?.asphalt?.height ? 0.028 : 0,
      roughness: 0.99,
      metalness: 0,
    }),
    brick: new THREE.MeshStandardMaterial({
      color: 0x966653,
      map: photos?.brick?.map || procedural.concrete.map,
      bumpMap: photos?.brick?.height || null,
      bumpScale: photos?.brick?.height ? 0.035 : 0,
      roughness: 0.98,
      metalness: 0,
    }),
    sandbag: new THREE.MeshStandardMaterial({
      color: 0x88704d,
      map: procedural.fabric.map,
      normalMap: procedural.fabric.normalMap,
      roughnessMap: procedural.fabric.roughnessMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 0.97,
      metalness: 0,
    }),
    rebar: new THREE.MeshStandardMaterial({
      color: 0x4b3028, roughness: 0.82, metalness: 0.58,
    }),
    barrierSteel: new THREE.MeshStandardMaterial({
      color: 0x5b6262,
      map: procedural.metal.map,
      normalMap: procedural.metal.normalMap,
      roughnessMap: procedural.metal.roughnessMap,
      normalScale: new THREE.Vector2(0.38, 0.38),
      roughness: 0.72,
      metalness: 0.52,
      side: THREE.DoubleSide,
    }),
    timber: new THREE.MeshStandardMaterial({
      color: 0x6a4d32,
      map: procedural.timber.map,
      normalMap: procedural.timber.normalMap,
      normalScale: new THREE.Vector2(0.34, 0.34),
      roughness: 0.91,
      metalness: 0,
    }),
    equipment: new THREE.MeshStandardMaterial({
      color: 0x252a27,
      map: procedural.fabric.map,
      normalMap: procedural.fabric.normalMap,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughness: 0.78,
      metalness: 0.08,
    }),
    earthFill: new THREE.MeshStandardMaterial({
      color: 0x756548,
      map: procedural.fabric.map,
      normalMap: procedural.concrete.normalMap,
      roughnessMap: procedural.concrete.roughnessMap,
      normalScale: new THREE.Vector2(0.28, 0.28),
      roughness: 0.99,
      metalness: 0,
    }),
  };
  materialKit.concreteDark = materialKit.concrete.clone();
  materialKit.concreteDark.color.setHex(0x656762);
  return materialKit;
}

function distressedBoxGeometry(width, height, depth, seed) {
  // Displace shared logical corners consistently, retaining the box UV islands for the photo
  // surface. These pieces read as broken masonry slabs instead of smooth fantasy rocks.
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const positions = geometry.attributes.position;
  const R = rng(seed);
  const offsets = new Map();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const key = `${x.toFixed(3)}:${y.toFixed(3)}:${z.toFixed(3)}`;
    let offset = offsets.get(key);
    if (!offset) {
      offset = [
        (R() - 0.5) * width * 0.28,
        (R() - 0.5) * height * 0.34,
        (R() - 0.5) * depth * 0.28,
      ];
      offsets.set(key, offset);
    }
    positions.setXYZ(i, x + offset[0], y + offset[1], z + offset[2]);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const RUBBLE_GEOMETRIES = [
  distressedBoxGeometry(0.52, 0.14, 0.44, 7101),
  distressedBoxGeometry(0.34, 0.15, 0.17, 7102),
  distressedBoxGeometry(0.66, 0.11, 0.34, 7103),
];
const FINE_RUBBLE_GEO = (() => {
  const geometry = new THREE.DodecahedronGeometry(0.09, 0);
  geometry.scale(1, 0.48, 0.74);
  return geometry;
})();
const REBAR_GEO = new THREE.CylinderGeometry(0.014, 0.018, 0.7, 7);
const UTILITY_POLE_GEO = new THREE.CylinderGeometry(0.105, 0.165, 7, 10, 4);
const UTILITY_CROSSARM_GEO = distressedBoxGeometry(1.85, 0.13, 0.14, 7719);
const UTILITY_INSULATOR_GEO = (() => {
  const parts = [
    transformedGeometry(new THREE.CylinderGeometry(0.045, 0.055, 0.21, 10)),
    transformedGeometry(new THREE.TorusGeometry(0.063, 0.018, 6, 12), [0, -0.035, 0],
      [Math.PI / 2, 0, 0]),
    transformedGeometry(new THREE.TorusGeometry(0.056, 0.016, 6, 12), [0, 0.035, 0],
      [Math.PI / 2, 0, 0]),
  ];
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  geometry.computeBoundingSphere();
  return geometry;
})();
const CORRUGATED_PANEL_GEO = (() => {
  // Sixteen subdivisions sample the peaks and troughs of four waves. Eight sampled only
  // the zero crossings, silently collapsing the "corrugated" panel back into a flat card.
  const geometry = new THREE.PlaneGeometry(0.52, 2.66, 16, 1);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    positions.setZ(i, Math.sin((x / 0.52 + 0.5) * Math.PI * 8) * 0.032);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
})();

function transformedGeometry(geometry, position = [0, 0, 0], rotation = [0, 0, 0],
  scale = [1, 1, 1]) {
  const out = geometry.clone();
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  out.applyMatrix4(matrix);
  return out;
}

function superellipsoidSackGeometry() {
  // A filled sack has broad compressed faces and rounded shoulders, not the continuously
  // curved section of a sphere/capsule. Exponents below one square up a superellipsoid while
  // retaining smooth normals. The long axis remains local Y for the existing authored rows.
  const around = 18, along = 12;
  const positions = [], uvs = [], indices = [];
  const signedPow = (value, exponent) =>
    Math.sign(value) * Math.pow(Math.abs(value), exponent);
  for (let row = 0; row <= along; row++) {
    const v = -Math.PI / 2 + row / along * Math.PI;
    const cv = signedPow(Math.cos(v), 0.58);
    const sv = signedPow(Math.sin(v), 0.54);
    const endPinch = 0.84 + 0.16 * Math.cos(v) ** 2;
    for (let col = 0; col <= around; col++) {
      const u = col / around * Math.PI * 2;
      positions.push(
        0.3 * cv * signedPow(Math.cos(u), 0.58) * endPinch,
        0.26 * sv,
        0.225 * cv * signedPow(Math.sin(u), 0.58) * endPinch,
      );
      uvs.push(col / around, row / along);
    }
  }
  for (let row = 0; row < along; row++) {
    for (let col = 0; col < around; col++) {
      const a = row * (around + 1) + col;
      const b = a + around + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const SANDBAG_GEO = (() => {
  // The raised centre seam, gathered neck and tied ears are merged into the sack, preserving
  // the original one-draw-call-per-position-set budget while breaking the anonymous blob read.
  const parts = [
    superellipsoidSackGeometry(),
    transformedGeometry(new THREE.CylinderGeometry(0.013, 0.016, 0.39, 7),
      [0, -0.015, 0.218]),
    transformedGeometry(new THREE.TorusGeometry(0.115, 0.011, 5, 12),
      [0, 0.205, 0], [Math.PI / 2, 0, 0]),
    transformedGeometry(new THREE.SphereGeometry(0.045, 8, 6), [0, 0.275, 0]),
    transformedGeometry(new THREE.CylinderGeometry(0.01, 0.015, 0.09, 6),
      [-0.025, 0.315, 0], [0, 0, 0.55]),
    transformedGeometry(new THREE.CylinderGeometry(0.01, 0.015, 0.09, 6),
      [0.025, 0.315, 0], [0, 0, -0.55]),
  ];
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.authoredSack = true;
  geometry.userData.components = 6;
  return geometry;
})();

const HESCO_CAGE_GEO = (() => {
  const parts = [];
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const bar = (position, scale) => parts.push(transformedGeometry(
    unit, position, [0, 0, 0], scale));
  for (const x of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
    bar([x, 0, z], [0.025, 1.04, 0.025]);
  }
  for (const y of [-0.5, 0.5]) {
    for (const z of [-0.5, 0.5]) bar([0, y, z], [1.04, 0.025, 0.025]);
    for (const x of [-0.5, 0.5]) bar([x, y, 0], [0.025, 0.025, 1.04]);
  }
  // The face grid is deliberately sparse enough to survive fog and MSAA at gameplay range.
  for (const z of [-0.505, 0.505]) {
    for (const x of [-0.25, 0, 0.25]) bar([x, 0, z], [0.014, 1, 0.014]);
    for (const y of [-0.25, 0, 0.25]) bar([0, y, z], [1, 0.014, 0.014]);
  }
  const geometry = mergeGeometries(parts, false);
  unit.dispose();
  for (const part of parts) part.dispose();
  geometry.computeBoundingSphere();
  return geometry;
})();

const HESCO_FILL_GEO = (() => {
  // HESCO fabric bulges between welded wires but remains a contained rectangular cell.
  // Reusing rubble's corner displacement made the fill look like a broken boulder in a cage.
  const geometry = new THREE.BoxGeometry(0.94, 0.94, 0.94, 4, 4, 4);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    let x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const nx = x / 0.47, ny = y / 0.47, nz = z / 0.47;
    const verticalBulge = Math.max(0, 1 - ny * ny);
    if (Math.abs(nx) > 0.98) {
      x += Math.sign(x) * 0.035 * verticalBulge * Math.max(0.2, 1 - nz * nz * 0.45);
    }
    if (Math.abs(nz) > 0.98) {
      z += Math.sign(z) * 0.035 * verticalBulge * Math.max(0.2, 1 - nx * nx * 0.45);
    }
    if (ny > 0.98) {
      // A shallow compacted-earth crown, kept safely below the cage's top rails.
      y -= 0.018 + 0.018 * Math.cos(nx * Math.PI) * Math.cos(nz * Math.PI);
    }
    positions.setXYZ(i, x, y, z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
})();

const HEDGEHOG_GEO = (() => {
  const beamParts = [];
  const beam = new THREE.BoxGeometry(1, 1, 1);
  const addIBeam = (rotation) => {
    beamParts.push(
      transformedGeometry(beam, [0, 0, 0], rotation, [0.09, 2.25, 0.16]),
      transformedGeometry(beam, [0.13, 0, 0], rotation, [0.17, 2.25, 0.045]),
      transformedGeometry(beam, [-0.13, 0, 0], rotation, [0.17, 2.25, 0.045]),
    );
  };
  addIBeam([0, 0, Math.PI / 4]);
  addIBeam([Math.PI / 4, 0, -Math.PI / 4]);
  addIBeam([Math.PI / 2, Math.PI / 4, 0]);
  beam.dispose();
  const geometry = mergeGeometries(beamParts, false);
  for (const part of beamParts) part.dispose();
  geometry.computeBoundingSphere();
  return geometry;
})();

function instanced(scene, geometry, material, transforms, shadows = true) {
  const out = new THREE.InstancedMesh(geometry, material, transforms.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < transforms.length; i++) {
    const t = transforms[i];
    dummy.position.set(t[0], t[1], t[2]);
    dummy.rotation.set(t[3] || 0, t[4] || 0, t[5] || 0);
    dummy.scale.set(t[6] || 1, t[7] || 1, t[8] || 1);
    dummy.updateMatrix();
    out.setMatrixAt(i, dummy.matrix);
  }
  out.instanceMatrix.needsUpdate = true;
  out.castShadow = shadows && quality.shadows;
  out.receiveShadow = quality.shadows;
  scene.add(out);
  return out;
}

function sandbagInstances(scene, name, transforms) {
  const out = instanced(scene, SANDBAG_GEO, frontlineMaterials().sandbag, transforms);
  const shade = new THREE.Color();
  const dummy = new THREE.Object3D();
  for (let i = 0; i < transforms.length; i++) {
    // Instance colour multiplies the shared fabric material. The small deterministic value
    // shifts are enough to expose each sack boundary without turning a military emplacement
    // into a checkerboard or allocating another material.
    const hash = ((i + 1) * 1103515245
      + Math.round((transforms[i][0] + 64) * 97)
      + Math.round((transforms[i][2] + 64) * 193)) >>> 0;
    const value = 0.82 + (hash % 1000) / 1000 * 0.26;
    shade.setRGB(value, value * 0.985, value * 0.94);
    out.setColorAt(i, shade);
    const t = transforms[i];
    const roll = ((hash >>> 10) % 1000 / 1000 - 0.5) * 0.42;
    const widthShift = 0.94 + ((hash >>> 20) % 100) / 100 * 0.11;
    const lengthShift = 0.92 + ((hash >>> 15) % 100) / 100 * 0.15;
    dummy.position.set(t[0], t[1] + ((hash >>> 7) % 5) * 0.004, t[2]);
    dummy.rotation.set(t[3] || 0, t[4] || 0, t[5] || 0);
    dummy.rotateY(roll);
    dummy.scale.set(
      (t[6] || 1) * widthShift,
      (t[7] || 1) * lengthShift,
      (t[8] || 1) * (2 - widthShift),
    );
    dummy.updateMatrix();
    out.setMatrixAt(i, dummy.matrix);
  }
  out.instanceMatrix.needsUpdate = true;
  if (out.instanceColor) out.instanceColor.needsUpdate = true;
  out.name = name;
  out.userData.authoredSacks = true;
  return out;
}

function addHescoPositions(scene, name, transforms) {
  const frontline = frontlineMaterials();
  const fill = instanced(scene, HESCO_FILL_GEO, frontline.earthFill, transforms);
  fill.name = `${name}-fill`;
  const cages = instanced(scene, HESCO_CAGE_GEO, frontline.barrierSteel, transforms);
  cages.name = `${name}-cages`;
  return { fill, cages };
}

function addHedgehogs(scene, name, transforms) {
  const out = instanced(scene, HEDGEHOG_GEO, frontlineMaterials().barrierSteel, transforms);
  out.name = name;
  return out;
}

function chamferedCaseGeometry() {
  const shape = new THREE.Shape();
  const w = 0.72, h = 0.48, r = 0.055;
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.44,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.025,
    bevelThickness: 0.025,
    curveSegments: 2,
  });
  geometry.translate(0, 0, -0.22);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const EQUIPMENT_CASE_GEO = chamferedCaseGeometry();
const AID_CARTON_GEO = (() => {
  const shape = new THREE.Shape();
  const w = 0.64, h = 0.54, bevel = 0.028;
  shape.moveTo(-w / 2 + bevel, -h / 2);
  shape.lineTo(w / 2 - bevel, -h / 2);
  shape.lineTo(w / 2, -h / 2 + bevel);
  shape.lineTo(w / 2, h / 2 - bevel);
  shape.lineTo(w / 2 - bevel, h / 2);
  shape.lineTo(-w / 2 + bevel, h / 2);
  shape.lineTo(-w / 2, h / 2 - bevel);
  shape.lineTo(-w / 2, -h / 2 + bevel);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.62,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.012,
    bevelThickness: 0.012,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -0.31);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
})();
const AID_LABEL_GEO = new THREE.PlaneGeometry(0.34, 0.2);
const FIELD_BOARD_GEO = distressedBoxGeometry(1, 1, 1, 9200);
const FIELD_LEG_GEO = new THREE.CylinderGeometry(0.025, 0.025, 0.98, 8);
const FIELD_BRACE_GEO = new THREE.CylinderGeometry(0.014, 0.014, 0.82, 7);

function addFieldTable(scene, x, y, z, yaw, width = 2.2, depth = 0.92) {
  const frontline = frontlineMaterials();
  const group = new THREE.Group();
  group.name = 'frontline-field-table';
  group.userData.authoredBoards = 4;
  group.userData.foldingTubeParts = 6;
  group.position.set(x, y, z);
  group.rotation.y = yaw;

  // Separate uneven boards and folding tube legs make this read as an improvised launch
  // bench, not one scaled cube. The mission's existing invisible geometry remains collision.
  const dummy = new THREE.Object3D();
  const boards = new THREE.InstancedMesh(FIELD_BOARD_GEO, frontline.timber, 4);
  for (let i = 0; i < 4; i++) {
    dummy.position.set(-width * 0.375 + i * width * 0.25, (i % 2) * 0.006, 0);
    dummy.rotation.set(0, i % 2 ? 0.006 : -0.004, 0);
    dummy.scale.set(width / 4 - 0.018, 0.075, depth);
    dummy.updateMatrix();
    boards.setMatrixAt(i, dummy.matrix);
  }
  boards.name = 'frontline-field-table-boards';
  boards.castShadow = boards.receiveShadow = quality.shadows;
  group.add(boards);
  const tube = frontline.barrierSteel;
  const legs = new THREE.InstancedMesh(FIELD_LEG_GEO, tube, 4);
  let legIndex = 0;
  for (const side of [-1, 1]) {
    for (const zSide of [-1, 1]) {
      dummy.position.set(side * width * 0.36, -0.5, zSide * depth * 0.31);
      dummy.rotation.set(0, 0, side * 0.09);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      legs.setMatrixAt(legIndex++, dummy.matrix);
    }
  }
  legs.name = 'frontline-field-table-legs';
  group.add(legs);
  const braces = new THREE.InstancedMesh(FIELD_BRACE_GEO, tube, 2);
  for (let i = 0; i < 2; i++) {
    dummy.position.set((i ? 1 : -1) * width * 0.36, -0.52, 0);
    dummy.rotation.set(Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    braces.setMatrixAt(i, dummy.matrix);
  }
  braces.name = 'frontline-field-table-braces';
  group.add(braces);
  scene.add(group);
  return group;
}

function addEquipmentCases(scene, cases) {
  const frontline = frontlineMaterials();
  const bodies = instanced(scene, EQUIPMENT_CASE_GEO, frontline.equipment, cases, false);
  bodies.name = 'frontline-equipment-case-bodies';
  const bands = [];
  const latches = [];
  for (const [x, y, z, rx, ry, rz, sx, sy, sz] of cases) {
    for (const side of [-1, 1]) {
      bands.push([x + Math.cos(ry) * side * 0.21 * sx, y, z - Math.sin(ry) * side * 0.21 * sx,
        rx, ry, rz, 0.055 * sx, 0.58 * sy, 0.52 * sz]);
      latches.push([x + Math.cos(ry) * side * 0.18 * sx, y + 0.25 * sy,
        z - Math.sin(ry) * side * 0.18 * sx, rx, ry, rz, 0.07, 0.045, 0.045]);
    }
  }
  const bandBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), frontline.barrierSteel, bands, false);
  bandBatch.name = 'frontline-equipment-case-bands';
  const latchBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), frontline.rebar, latches, false);
  latchBatch.name = 'frontline-equipment-case-latches';
}

function raggedDisc(radius = 1, points = 18, seed = 1) {
  const R = rng(seed);
  const shape = new THREE.Shape();
  for (let i = 0; i < points; i++) {
    const a = i / points * Math.PI * 2;
    const r = radius * (0.72 + R() * 0.34);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function craterRimGeometry(seed = 1, segments = 32) {
  // Three irregular concentric rings form a shallow torn-asphalt berm. The old crater was a
  // black floor card surrounded by upright rubble chunks; this provides a continuous road
  // surface with a raised broken lip, so the depression reads before any loose debris does.
  const R = rng(seed);
  const radii = [0.52, 0.79, 1.16];
  const heights = [0.018, 0.19, 0.012];
  const jitter = Array.from({ length: segments }, () => 0.88 + R() * 0.24);
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let ring = 0; ring < radii.length; ring++) {
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2;
      const stagger = ring === 1 ? 0.93 + R() * 0.13 : 1;
      const radius = radii[ring] * jitter[i] * stagger;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      positions.push(x, heights[ring] * (ring === 1 ? 0.72 + R() * 0.5 : 1), z);
      uvs.push(x * 0.45 + 0.5, z * 0.45 + 0.5);
    }
  }
  for (let ring = 0; ring < radii.length - 1; ring++) {
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const a = ring * segments + i;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + i;
      const d = (ring + 1) * segments + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const CRATER_RIM_GEO = craterRimGeometry(47017);

const WATCH_ROOF_GEO = (() => {
  // Triangular section extruded along the cabin width: a real pitched roof silhouette instead
  // of another thin box stacked on top of the tower.
  const shape = new THREE.Shape();
  shape.moveTo(-1.52, 0);
  shape.lineTo(1.52, 0);
  shape.lineTo(0, 0.68);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 4.8, bevelEnabled: true, bevelSegments: 2,
    bevelSize: 0.035, bevelThickness: 0.035, curveSegments: 1,
  });
  geometry.translate(0, 0, -2.4);
  geometry.rotateY(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
})();

let gateSectorTexture = null;
function fortifiedGateSectorTexture() {
  if (gateSectorTexture) return gateSectorTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#182321';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#8f7852';
  ctx.lineWidth = 12;
  ctx.strokeRect(10, 10, 492, 236);
  ctx.fillStyle = '#b9aa83';
  ctx.font = '700 34px monospace';
  ctx.fillText('37TH DIRECTORATE', 36, 66);
  ctx.fillStyle = '#e4ded0';
  ctx.font = '800 52px monospace';
  ctx.fillText('FIRE CONTROL', 36, 132);
  ctx.fillStyle = '#b9aa83';
  ctx.font = '700 28px monospace';
  ctx.fillText('SECTOR 04  //  RESTRICTED', 36, 190);
  ctx.fillStyle = '#82564a';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(35 + i * 94, 215, 56, 12);
  }
  gateSectorTexture = new THREE.CanvasTexture(canvas);
  gateSectorTexture.colorSpace = THREE.SRGBColorSpace;
  gateSectorTexture.anisotropy = 8;
  return gateSectorTexture;
}

let relayHutchSign = null;
function relayHutchSignTexture() {
  if (relayHutchSign) return relayHutchSign;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d1c7a1';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#1c2523';
  ctx.fillRect(10, 10, 236, 236);
  ctx.fillStyle = '#d8b65d';
  ctx.font = '800 31px monospace';
  ctx.fillText('OP RELAY', 36, 62);
  ctx.fillStyle = '#d7d3c5';
  ctx.font = '700 20px monospace';
  ctx.fillText('ROOF ACCESS', 48, 104);
  ctx.fillText('AUTHORIZED', 60, 135);
  ctx.fillStyle = '#b65748';
  for (let i = 0; i < 5; i++) ctx.fillRect(25 + i * 44, 174, 26, 18);
  ctx.fillStyle = '#9d9b8c';
  ctx.font = '700 16px monospace';
  ctx.fillText('VECTOR // 06', 66, 224);
  relayHutchSign = new THREE.CanvasTexture(canvas);
  relayHutchSign.colorSpace = THREE.SRGBColorSpace;
  relayHutchSign.anisotropy = 8;
  return relayHutchSign;
}

function droneModel() {
  const root = new THREE.Group();
  const carbon = new THREE.MeshStandardMaterial({ color: 0x171a1c, roughness: 0.5, metalness: 0.45 });
  const battery = new THREE.MeshStandardMaterial({ color: 0x3f4749, roughness: 0.72 });
  const lens = new THREE.MeshPhysicalMaterial({
    color: 0x162b3b, roughness: 0.08, metalness: 0.18, clearcoat: 1,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.28), battery);
  body.castShadow = quality.shadows;
  root.add(body);
  for (const [x, z] of [[-0.36, -0.32], [0.36, -0.32], [-0.36, 0.32], [0.36, 0.32]]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.52, 8), carbon);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = Math.atan2(z, x);
    arm.position.set(x * 0.52, 0, z * 0.52);
    root.add(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 12), carbon);
    motor.position.set(x, 0.04, z);
    root.add(motor);
    const prop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.29, 0.29, 0.008, 20),
      new THREE.MeshBasicMaterial({ color: 0x252a2d, transparent: true, opacity: 0.38 }));
    prop.position.set(x, 0.09, z);
    root.add(prop);
  }
  const camera = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), lens);
  camera.scale.set(1, 0.72, 0.85);
  camera.position.set(0, -0.08, -0.18);
  root.add(camera);
  root.traverse(o => {
    if (o.isMesh) {
      o.castShadow = quality.shadows;
      o.receiveShadow = quality.shadows;
    }
  });
  return root;
}

export function addFrontlineStreetArt(scene) {
  if (!quality.desktop) return;
  const R = rng(20260728);
  const frontline = frontlineMaterials();
  const darkConcrete = new THREE.MeshStandardMaterial({ color: 0x292c2d, roughness: 0.98 });
  const char = new THREE.MeshStandardMaterial({ color: 0x141515, roughness: 1 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x30373a, roughness: 0.62, metalness: 0.62 });

  // Shell craters: one dark floor scar plus a low irregular broken rim.
  const craterSites = [[-3.6, 14, 1.6], [5.4, -8, 1.15], [-4.8, -39, 1.4]];
  for (const [x, z, radius] of craterSites) {
    const scar = new THREE.Mesh(raggedDisc(radius, 22, Math.round((x + 10) * 97)), char);
    scar.rotation.x = -Math.PI / 2;
    scar.position.set(x, 0.031, z);
    scar.receiveShadow = true;
    scene.add(scar);
  }
  const craterRims = instanced(scene, CRATER_RIM_GEO, frontline.asphalt,
    craterSites.map(([x, z, radius], i) =>
      [x, 0.032, z, 0, i * 1.73, 0, radius * 1.28, 1, radius * 1.28]), false);
  craterRims.name = 'frontline-crater-rims';

  const rubble = [[], [], []];
  const fineRubble = [];
  const exposedRebar = [];
  for (let i = 0; i < 115; i++) {
    const cluster = i % 3;
    const bases = [[-3.6, 14], [5.4, -8], [-4.8, -39]];
    const [bx, bz] = bases[cluster];
    const a = R() * Math.PI * 2;
    const d = 1 + R() * 2.6;
    rubble[i % rubble.length].push([
      bx + Math.cos(a) * d, 0.08 + R() * 0.14, bz + Math.sin(a) * d,
      (R() - 0.5) * 0.46, R() * Math.PI * 2, (R() - 0.5) * 0.46,
      0.38 + R() * 0.56, 0.55 + R() * 0.42, 0.38 + R() * 0.56,
    ]);
    if (i % 8 === 0) {
      exposedRebar.push([
        bx + Math.cos(a) * (d + 0.08), 0.18 + R() * 0.12,
        bz + Math.sin(a) * (d + 0.08),
        R() * 1.4 - 0.7, R() * Math.PI, R() * 1.4 - 0.7,
        0.8 + R() * 0.45, 0.65 + R() * 0.75, 0.8 + R() * 0.45,
      ]);
    }
  }
  for (let i = 0; i < 210; i++) {
    const [bx, bz] = [[-3.6, 14], [5.4, -8], [-4.8, -39]][i % 3];
    const a = R() * Math.PI * 2;
    const d = 0.72 + R() * 3.05;
    const scale = 0.5 + R() * 1.15;
    fineRubble.push([
      bx + Math.cos(a) * d, 0.055 + R() * 0.045, bz + Math.sin(a) * d,
      R() * Math.PI, R() * Math.PI, R() * Math.PI,
      scale * (0.72 + R() * 0.56), scale * (0.55 + R() * 0.48), scale,
    ]);
  }
  for (let i = 0; i < rubble.length; i++) {
    const chunks = instanced(scene, RUBBLE_GEOMETRIES[i],
      i === 1 ? frontline.brick : i === 2 ? frontline.concreteDark : frontline.concrete,
      rubble[i], false);
    chunks.name = `frontline-rubble-${i === 1 ? 'brick' : `concrete-${i}`}`;
  }
  const rebar = instanced(scene, REBAR_GEO, frontline.rebar, exposedRebar, false);
  rebar.name = 'frontline-rubble-rebar';
  const gravel = instanced(scene, FINE_RUBBLE_GEO, frontline.concreteDark, fineRubble, false);
  gravel.name = 'frontline-rubble-fines';

  // Municipal distribution line damaged along the storefronts. One pole is still carrying
  // tension; the opposite pole has snapped down the sidewalk with its service wires trailing
  // from the building. Keeping both assemblies tight to the wall preserves the combat lane.
  const utilityTimber = frontline.timber.clone();
  utilityTimber.color.setHex(0x493d30);
  const utilityPoles = instanced(scene, UTILITY_POLE_GEO, utilityTimber, [
    [-14.72, 3.5, 8.0, 0.025, 0, -0.055, 1, 1, 1],
    [14.72, 0.55, -17.9, Math.PI / 2 - 0.08, 0.04, 0, 1, 0.86, 1],
  ]);
  utilityPoles.name = 'frontline-utility-poles';
  const utilityArms = instanced(scene, UTILITY_CROSSARM_GEO, utilityTimber, [
    [-14.72, 6.35, 8.0, 0.02, 0, -0.055, 1, 1, 1],
    [14.72, 0.56, -20.7, 0.08, 0.04, 0.03, 1, 1, 1],
  ]);
  utilityArms.name = 'frontline-utility-crossarms';
  const porcelain = new THREE.MeshStandardMaterial({
    color: 0x9aa19b, roughness: 0.42, metalness: 0.03,
  });
  const insulators = [];
  for (const xOff of [-0.68, 0, 0.68]) {
    insulators.push([-14.72 + xOff, 6.53, 8.0, 0, 0, 0, 1, 1, 1]);
    insulators.push([14.72 + xOff, 0.74, -20.7, 0.08, 0.04, 0.03, 1, 1, 1]);
  }
  const utilityInsulators = instanced(
    scene, UTILITY_INSULATOR_GEO, porcelain, insulators, false);
  utilityInsulators.name = 'frontline-utility-insulators';
  const cableMaterial = new THREE.LineBasicMaterial({ color: 0x101213 });
  for (let wire = 0; wire < 3; wire++) {
    const points = [];
    const start = new THREE.Vector3(15.48, 5.2 + wire * 0.18, -7.0 + wire * 0.1);
    const end = new THREE.Vector3(14.04 + wire * 0.68, 0.86, -20.7);
    for (let p = 0; p < 20; p++) {
      const t = p / 19;
      points.push(new THREE.Vector3(
        start.x + (end.x - start.x) * t,
        start.y + (end.y - start.y) * t - Math.sin(t * Math.PI) * (1.15 + wire * 0.12),
        start.z + (end.z - start.z) * t,
      ));
    }
    const cable = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points), cableMaterial);
    cable.name = `frontline-utility-cable-${wire}`;
    scene.add(cable);
  }

  // Blast/scorch marks on both occupied façades. These are intentionally large and irregular:
  // damage at this scale must alter the read of the street, not look like decorative dirt.
  const scars = [
    [-15.82, 3.2, 20, 0, Math.PI / 2, 0, 1.7, 1.3, 1],
    [-15.82, 6.5, -12, 0, Math.PI / 2, 0, 1.2, 1.0, 1],
    [-15.82, 4.6, -43, 0, Math.PI / 2, 0, 2.1, 1.5, 1],
    [15.82, 4.0, 31, 0, -Math.PI / 2, 0, 1.5, 1.2, 1],
    [15.82, 6.2, 2, 0, -Math.PI / 2, 0, 1.1, 0.9, 1],
    [15.82, 3.4, -32, 0, -Math.PI / 2, 0, 1.9, 1.4, 1],
  ];
  instanced(scene, raggedDisc(1, 20, 92), char, scars, false);

  // Observation post at the south end: sandbag firing bay, launch table, antenna and cases.
  const bags = [];
  for (let i = 0; i < 10; i++) {
    bags.push([-13.8 + i * 0.58, 0.33, -43.6, 0, 0, Math.PI / 2, 1, 1, 1]);
    if (i < 6) bags.push([-13.8, 0.33, -43.6 + i * 0.55, Math.PI / 2, 0, 0, 1, 1, 1]);
  }
  for (let i = 0; i < 8; i++) {
    bags.push([-13.5 + i * 0.62, 0.64, -43.6, 0, 0, Math.PI / 2, 1, 1, 1]);
  }
  sandbagInstances(scene, 'frontline-op-sandbags', bags);

  addFieldTable(scene, -11.15, 1.05, -41.6, 0);

  const drone = droneModel();
  drone.position.set(-11.15, 1.28, -41.6);
  drone.rotation.y = -0.25;
  scene.add(drone);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 5.4, 10), steel);
  mast.position.set(-14.2, 2.7, -40.5);
  mast.castShadow = true;
  scene.add(mast);
  const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.42), darkConcrete);
  antenna.position.set(-14.2, 4.95, -40.5);
  antenna.rotation.y = 0.35;
  scene.add(antenna);

  const cases = [
    [-9.75, 0.28, -42.35, 0, 0.25, 0, 1.2, 0.6, 0.8],
    [-10.1, 0.22, -40.8, 0, -0.2, 0, 0.9, 0.5, 0.65],
    [-12.7, 0.25, -40.75, 0, 0.1, 0, 1.0, 0.55, 0.7],
  ];
  addEquipmentCases(scene, cases);

  // Skin the authoritative 32m metal collision wall with a field-built barricade. Individual
  // corrugations, bent panels and exposed posts break the huge blank rectangle while the
  // original wall keeps handling cover, bullets and the six-metre access gap.
  const panels = [];
  const posts = [];
  const barrierBags = [];
  let panelIndex = 0;
  for (let x = -15.72; x <= 15.72; x += 0.52) {
    if (x > -6.15 && x < 0.15) continue;
    const damaged = panelIndex % 17 === 6 || panelIndex % 23 === 9;
    if (!damaged) {
      panels.push([
        x, 1.48 + (panelIndex % 13 === 4 ? -0.11 : 0), -49.79,
        0, (panelIndex % 19 === 7 ? 0.16 : 0), (panelIndex % 13 === 4 ? -0.055 : 0),
        1, panelIndex % 11 === 5 ? 0.92 : 1, 1,
      ]);
    }
    if (panelIndex % 4 === 0) {
      posts.push([x - 0.24, 1.48, -49.7, 0, 0, 0, 1, 1, 1]);
    }
    if (panelIndex % 3 === 0) {
      barrierBags.push([
        x, 0.23, -49.34, 0, 0, Math.PI / 2 + (panelIndex % 2 ? 0.05 : -0.04),
        0.92, 0.92, 0.92,
      ]);
    }
    panelIndex++;
  }
  const barrierPanels = instanced(
    scene, CORRUGATED_PANEL_GEO, frontline.barrierSteel, panels);
  barrierPanels.name = 'frontline-barricade-panels';
  const barrierPosts = instanced(
    scene, new THREE.BoxGeometry(0.09, 2.92, 0.13), steel, posts);
  barrierPosts.name = 'frontline-barricade-posts';
  sandbagInstances(scene, 'frontline-barricade-sandbags', barrierBags);

  // Earth-filled wire cells carry the visual weight of a prepared position without asking
  // dozens of tiny rubble pieces to pretend they form cover. They sit directly against the
  // existing solid barricade, so the cheap authored wall remains the gameplay authority.
  addHescoPositions(scene, 'frontline-barricade-hesco', [
    [-13.2, 0.55, -49.18, 0, 0, 0, 1.5, 1.08, 0.94],
    [-10.9, 0.55, -49.18, 0, 0.04, 0, 1.5, 1.08, 0.94],
    [3.2, 0.55, -49.18, 0, -0.03, 0, 1.5, 1.08, 0.94],
    [5.5, 0.55, -49.18, 0, 0.02, 0, 1.5, 1.08, 0.94],
    [12.7, 0.55, -49.18, 0, -0.04, 0, 1.5, 1.08, 0.94],
  ]);
  // Three obstacles beyond the access gap stop the road from terminating in a clean sheet of
  // corrugated metal. Their I-beam silhouette reads instantly even through the street fog.
  addHedgehogs(scene, 'frontline-anti-vehicle-hedgehogs', [
    [-4.9, 1.0, -51.3, 0, 0.18, 0, 1, 1, 1],
    [-2.5, 1.0, -52.0, 0, -0.24, 0, 1, 1, 1],
    [-0.2, 1.0, -51.25, 0, 0.32, 0, 1, 1, 1],
  ]);

  // Sagging field cable from the relay into the launch table.
  const cablePoints = [];
  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    cablePoints.push(new THREE.Vector3(
      -14.2 + t * 3.0,
      4.65 * (1 - t) + 1.15 * t - Math.sin(t * Math.PI) * 0.65,
      -40.5 - t * 1.1,
    ));
  }
  const cable = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(cablePoints),
    new THREE.LineBasicMaterial({ color: 0x111315 }));
  scene.add(cable);
}

// Low-cost common language shared by the other outdoor missions. The layout remains authored;
// this pass only makes the perimeter and approach read as a district under sustained fire.
export function addFrontlineAmbientArt(scene, levelId, bounds) {
  if (!quality.desktop || !bounds || levelId === 2) return;
  const R = rng(81001 + levelId * 997);
  const frontline = frontlineMaterials();
  const char = new THREE.MeshStandardMaterial({ color: 0x17191a, roughness: 1 });
  const chunks = [[], [], []];
  const fineRubble = [];
  const craters = [];
  const radius = Math.max(10, Math.min(bounds.r * 0.78, 42));

  for (let cluster = 0; cluster < 4; cluster++) {
    const angle = R() * Math.PI * 2;
    const distance = radius * (0.48 + R() * 0.42);
    const x = bounds.cx + Math.cos(angle) * distance;
    const z = bounds.cz + Math.sin(angle) * distance;
    craters.push([x, z, 0.65 + R() * 0.8]);
    for (let i = 0; i < 18; i++) {
      const a = R() * Math.PI * 2;
      const d = 0.7 + R() * 2.1;
      chunks[(cluster + i) % chunks.length].push([
        x + Math.cos(a) * d, 0.08 + R() * 0.13, z + Math.sin(a) * d,
        (R() - 0.5) * 0.46, R() * Math.PI * 2, (R() - 0.5) * 0.46,
        0.3 + R() * 0.5, 0.52 + R() * 0.4, 0.3 + R() * 0.5,
      ]);
    }
    for (let i = 0; i < 36; i++) {
      const a = R() * Math.PI * 2;
      const d = 0.6 + R() * 2.35;
      const scale = 0.46 + R() * 0.94;
      fineRubble.push([
        x + Math.cos(a) * d, 0.05 + R() * 0.04, z + Math.sin(a) * d,
        R() * Math.PI, R() * Math.PI, R() * Math.PI,
        scale * (0.76 + R() * 0.48), scale * (0.58 + R() * 0.42), scale,
      ]);
    }
  }
  for (let i = 0; i < craters.length; i++) {
    const [x, z, scale] = craters[i];
    const scar = new THREE.Mesh(raggedDisc(scale, 18, levelId * 41 + i), char);
    scar.rotation.x = -Math.PI / 2;
    scar.position.set(x, 0.028, z);
    scene.add(scar);
  }
  const rimMaterial = [3, 5].includes(levelId) ? frontline.concreteDark : frontline.asphalt;
  const craterRims = instanced(scene, CRATER_RIM_GEO, rimMaterial,
    craters.map(([x, z, scale], i) =>
      [x, 0.03, z, 0, i * 1.39 + levelId, 0, scale * 1.2, 1, scale * 1.2]), false);
  craterRims.name = 'frontline-ambient-crater-rims';
  for (let i = 0; i < chunks.length; i++) {
    const rubble = instanced(scene, RUBBLE_GEOMETRIES[i],
      i === 1 ? frontline.brick : i === 2 ? frontline.concreteDark : frontline.concrete,
      chunks[i], false);
    rubble.name = `frontline-ambient-rubble-${i}`;
  }
  const gravel = instanced(scene, FINE_RUBBLE_GEO, frontline.concreteDark, fineRubble, false);
  gravel.name = 'frontline-ambient-rubble-fines';

  if ([4, 5, 7, 10].includes(levelId)) {
    const steel = new THREE.MeshStandardMaterial({
      color: 0x252a2b, roughness: 0.72, metalness: 0.46,
    });
    const poles = [];
    const polePositions = [];
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? -1 : 1;
      const along = (i < 2 ? -0.32 : 0.32) * radius;
      const x = bounds.cx + side * radius * 0.7;
      const z = bounds.cz + along;
      const lean = (R() - 0.5) * 0.14;
      polePositions.push([x, z]);
      poles.push([x, 3.5, z, lean, 0, lean * 0.35, 1, 1, 1]);
    }
    instanced(scene, new THREE.CylinderGeometry(0.08, 0.12, 7, 8), steel, poles);
    for (let i = 0; i < polePositions.length; i += 2) {
      const [ax, az] = polePositions[i];
      const [bx, bz] = polePositions[i + 1];
      const points = [];
      for (let p = 0; p < 14; p++) {
        const t = p / 13;
        points.push(new THREE.Vector3(
          ax + (bx - ax) * t,
          6.55 - Math.sin(t * Math.PI) * (0.65 + (i / 2) * 0.22),
          az + (bz - az) * t,
        ));
      }
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x101213 }),
      ));
    }
  }
}

function addObservationPost(scene, x, y, z, yaw = 0, opts = {}) {
  const frontline = frontlineMaterials();
  const steel = new THREE.MeshStandardMaterial({ color: 0x262d30, roughness: 0.58, metalness: 0.62 });
  const equipment = new THREE.MeshStandardMaterial({ color: 0x252b2a, roughness: 0.76 });
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const bags = [];
  for (let i = -4; i <= 4; i++) {
    bags.push([x + c * i * 0.5, y + 0.2, z - s * i * 0.5, 0, yaw, Math.PI / 2, 1, 1, 1]);
    if (Math.abs(i) < 4) {
      bags.push([x + c * i * 0.5, y + 0.48, z - s * i * 0.5, 0, yaw, Math.PI / 2, 1, 1, 1]);
    }
  }
  if (opts.bags !== false) {
    sandbagInstances(scene, 'frontline-mission-op-sandbags', bags);
  }

  addFieldTable(scene, x, y + 0.86, z + 1.25, yaw, 1.9, 0.78);
  const drone = droneModel();
  drone.position.set(x, y + 1.04, z + 1.25);
  drone.rotation.y = yaw - 0.2;
  scene.add(drone);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.4, 8), steel);
  mast.position.set(x - c * 2.1, y + 1.7, z + s * 2.1 + 0.2);
  scene.add(mast);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.74, 0.34), equipment);
  panel.position.copy(mast.position);
  panel.position.y += 1.18;
  panel.rotation.y = yaw + 0.25;
  scene.add(panel);
}

let opBravoSignMap = null;
function opBravoSignTexture() {
  if (opBravoSignMap) return opBravoSignMap;
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#192225';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#3a4b4c';
  ctx.fillRect(18, 18, canvas.width - 36, canvas.height - 36);
  ctx.fillStyle = '#111819';
  ctx.fillRect(28, 28, canvas.width - 56, canvas.height - 56);
  ctx.fillStyle = '#49d9e8';
  ctx.fillRect(42, 44, 18, canvas.height - 88);
  ctx.fillStyle = '#e8eeea';
  ctx.font = '700 72px sans-serif';
  ctx.fillText('OP BRAVO', 92, 112);
  ctx.fillStyle = '#9faaa5';
  ctx.font = '600 28px sans-serif';
  ctx.fillText('EASTERN APPROACH  /  VEKTOR', 94, 166);
  ctx.fillStyle = '#d4a650';
  ctx.fillRect(94, 190, 382, 8);
  opBravoSignMap = new THREE.CanvasTexture(canvas);
  opBravoSignMap.colorSpace = THREE.SRGBColorSpace;
  opBravoSignMap.anisotropy = quality.anisotropy || 1;
  return opBravoSignMap;
}

let marketAidSignMap = null;
function marketAidSignTexture() {
  if (marketAidSignMap) return marketAidSignMap;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d5d0bd';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#272d2c';
  ctx.fillRect(18, 18, canvas.width - 36, canvas.height - 36);
  ctx.fillStyle = '#d5d0bd';
  ctx.fillRect(38, 38, canvas.width - 76, canvas.height - 76);
  ctx.fillStyle = '#aa3330';
  ctx.fillRect(70, 68, 44, 178);
  ctx.fillRect(3, 135, 178, 44);
  ctx.fillStyle = '#202727';
  ctx.font = '700 70px sans-serif';
  ctx.fillText('AID DISTRIBUTION', 220, 128);
  ctx.font = '600 40px sans-serif';
  ctx.fillText('TRIAGE  →   KEEP MOVING', 220, 205);
  ctx.fillStyle = '#56625d';
  ctx.font = '600 25px sans-serif';
  ctx.fillText('VEKTOR CIVIL SUPPORT  /  SECTOR 4', 220, 270);
  marketAidSignMap = new THREE.CanvasTexture(canvas);
  marketAidSignMap.colorSpace = THREE.SRGBColorSpace;
  marketAidSignMap.anisotropy = quality.anisotropy || 1;
  return marketAidSignMap;
}

function addOpBravoTower(scene) {
  const frontline = frontlineMaterials();
  const R = rng(77031);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const steel = frontline.barrierSteel.clone();
  steel.color.setHex(0x394346);
  steel.roughness = 0.7;
  const darkSteel = frontline.barrierSteel.clone();
  darkSteel.color.setHex(0x202729);
  darkSteel.roughness = 0.76;
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x171c1c,
    map: surfaces().fabric.map,
    normalMap: surfaces().fabric.normalMap,
    normalScale: new THREE.Vector2(0.18, 0.18),
    roughness: 0.96,
    metalness: 0,
  });
  const screen = new THREE.MeshStandardMaterial({
    color: 0x182f32,
    emissive: 0x246f75,
    emissiveIntensity: 0.26,
    roughness: 0.42,
    metalness: 0.08,
  });
  const warning = new THREE.MeshStandardMaterial({
    color: 0xb68c3e,
    roughness: 0.84,
    metalness: 0.08,
  });

  // The retained roof slab supplies collision. This photographed membrane, its repairs and
  // ballast make it read as a working observation roof instead of a glossy white rectangle.
  const roofMap = frontline.asphalt.map?.clone() || null;
  const roofBump = frontline.asphalt.bumpMap?.clone() || null;
  for (const texture of [roofMap, roofBump]) {
    if (!texture) continue;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 4);
    texture.needsUpdate = true;
  }
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: 0x4c514f,
    map: roofMap,
    bumpMap: roofBump,
    bumpScale: roofBump ? 0.024 : 0,
    roughness: 0.99,
    metalness: 0,
  });
  const membrane = new THREE.Mesh(new THREE.PlaneGeometry(15.45, 13.45), roofMaterial);
  membrane.name = 'op-bravo-roof-membrane';
  membrane.rotation.x = -Math.PI / 2;
  membrane.position.set(0, 12.044, -4);
  membrane.receiveShadow = quality.shadows;
  scene.add(membrane);

  const roofPatchMaterial = new THREE.MeshStandardMaterial({
    color: 0x242a29, roughness: 0.99, metalness: 0,
  });
  const roofPatches = instanced(scene, raggedDisc(1, 22, 77033), roofPatchMaterial, [
    [-4.9, 12.055, -7.4, -Math.PI / 2, 0, 0.15, 1.6, 0.85, 1],
    [4.7, 12.055, -1.0, -Math.PI / 2, 0, -0.24, 1.3, 0.72, 1],
    [5.7, 12.055, -8.2, -Math.PI / 2, 0, 0.32, 0.9, 0.55, 1],
  ], false);
  roofPatches.name = 'op-bravo-roof-repairs';
  const roofGravel = [];
  for (let i = 0; i < 72; i++) {
    let x;
    let z;
    do {
      x = -7.1 + R() * 14.2;
      z = -10.2 + R() * 12.4;
    } while (Math.hypot(x - 3, z + 2) < 2.2 || Math.hypot(x + 3, z + 2) < 2.5);
    roofGravel.push([
      x, 12.07 + R() * 0.025, z,
      R() * 0.3, R() * Math.PI, R() * 0.3,
      0.26 + R() * 0.44, 0.2 + R() * 0.3, 0.25 + R() * 0.42,
    ]);
  }
  const gravel = instanced(
    scene, FINE_RUBBLE_GEO, frontline.concreteDark, roofGravel, false);
  gravel.name = 'op-bravo-roof-ballast';

  // Replace the generic nine-sack line with a defended sector: an L-shaped parapet position,
  // timber standing boards, command table, drone station and packed signal cases.
  addObservationPost(scene, -3, 12.25, -2, Math.PI / 2, { bags: false });
  const roofBags = [];
  for (let i = 0; i < 10; i++) {
    roofBags.push([-6.85 + i * 0.53, 12.23, -9.95, 0, 0, Math.PI / 2, 0.92, 0.95, 0.9]);
    if (i > 0 && i < 9) {
      roofBags.push([-6.58 + i * 0.53, 12.5, -9.94, 0, 0, Math.PI / 2, 0.92, 0.95, 0.9]);
    }
  }
  for (let i = 0; i < 6; i++) {
    roofBags.push([
      -7.25, 12.23 + (i > 3 ? 0.27 : 0), -9.5 + (i % 4) * 0.53,
      Math.PI / 2, 0, 0, 0.92, 0.95, 0.9,
    ]);
  }
  sandbagInstances(scene, 'op-bravo-roof-sandbags', roofBags);
  const duckboards = [];
  for (let i = 0; i < 9; i++) {
    duckboards.push([-5.6 + i * 0.48, 12.075, -8.72, 0, 0, 0, 0.42, 0.055, 1.35]);
  }
  const boards = instanced(scene, FIELD_BOARD_GEO, frontline.timber, duckboards);
  boards.name = 'op-bravo-roof-duckboards';
  const launchMat = instanced(scene, unitBox, rubber, [
    [3, 12.076, -2, 0, 0, 0, 2.25, 0.035, 2.25],
    [-2.8, 12.076, -0.72, 0, 0, 0, 2.65, 0.035, 1.05],
  ], false);
  launchMat.name = 'op-bravo-drone-and-command-mats';
  addEquipmentCases(scene, [
    [-5.9, 12.34, -6.8, 0, 0.12, 0, 1.05, 0.84, 0.92],
    [-4.85, 12.27, -6.85, 0, -0.08, 0, 0.88, 0.72, 0.82],
    [-6.15, 12.28, -5.9, 0, -0.16, 0, 0.82, 0.72, 0.82],
  ]);
  const windbreak = instanced(scene, unitBox, rubber, [
    [-6.55, 13.18, -3.85, 0, 0, 0, 0.07, 1.75, 1.28],
    [-6.55, 13.18, -2.48, 0, 0, 0, 0.07, 1.75, 1.28],
    [-6.55, 13.18, -1.11, 0, 0, 0, 0.07, 1.75, 1.28],
  ], false);
  windbreak.name = 'op-bravo-command-windbreak';
  const windbreakPoles = instanced(
    scene, new THREE.CylinderGeometry(0.035, 0.045, 1, 8),
    darkSteel, [-4.52, -3.17, -1.8, -0.44].map(z =>
      [-6.52, 13.12, z, 0, 0, 0, 1, 2.05, 1]));
  windbreakPoles.name = 'op-bravo-command-windbreak-poles';
  const commandTerminal = instanced(scene, unitBox, darkSteel, [
    [-2.92, 13.32, -0.73, 0, 0, -0.08, 0.14, 0.58, 0.72],
    [-3.06, 13.05, -0.73, 0, 0, 0, 0.36, 0.08, 0.5],
  ]);
  commandTerminal.name = 'op-bravo-command-terminal';
  const commandScreen = instanced(scene, unitBox, screen, [
    [-2.84, 13.33, -0.73, 0, 0, -0.08, 0.022, 0.4, 0.52],
  ], false);
  commandScreen.name = 'op-bravo-command-screen';

  // Rooftop services occupy the otherwise dead east edge and form hard cover silhouettes
  // without entering the stair or drone-launch routes.
  const serviceBodies = instanced(scene, unitBox, steel, [
    [5.75, 12.62, -7.65, 0, 0.08, 0, 2.25, 1.12, 1.5],
    [5.45, 12.48, 0.05, 0, -0.04, 0, 1.7, 0.84, 1.2],
  ]);
  serviceBodies.name = 'op-bravo-roof-service-units';
  const serviceVents = [];
  for (const [x, y, z, yaw, width] of [
    [5.75, 12.62, -6.88, 0.08, 1.62],
    [5.45, 12.48, 0.67, -0.04, 1.18],
  ]) {
    for (let i = -3; i <= 3; i++) {
      serviceVents.push([x + i * width / 7, y, z, 0, yaw, 0, width / 8, 0.055, 0.035]);
    }
  }
  const vents = instanced(scene, unitBox, darkSteel, serviceVents, false);
  vents.name = 'op-bravo-roof-service-vents';
  const duct = instanced(scene, unitBox, steel, [
    [4.25, 12.43, -7.65, 0, 0.08, 0, 0.72, 0.68, 0.76],
    [3.7, 12.28, -7.65, 0, 0.08, 0, 0.48, 0.38, 0.48],
  ]);
  duct.name = 'op-bravo-roof-service-duct';

  // Each storey keeps the same collision floor but receives a tiled field-office surface,
  // rubber circulation strip, protected lower wall and an overhead cable route. Repetition
  // gives the tower construction logic; floor-specific equipment below gives navigation cues.
  const floorTilesA = [];
  const floorTilesB = [];
  const runners = [];
  const wallPanels = [];
  const panelRails = [];
  const cableRails = [];
  const cableRungs = [];
  const conduits = [];
  for (let floor = 0; floor < 4; floor++) {
    const y = floor * 3;
    for (let zi = 0; zi < 3; zi++) {
      for (let xi = 0; xi < 4; xi++) {
        const entry = [
          -3.45 + xi * 3.45, y + 0.065, -8.7 + zi * 3.35,
          0, ((xi + zi + floor) % 2 ? 0.006 : -0.006), 0,
          3.32, 0.035, 3.2,
        ];
        ((xi + zi + floor) % 2 ? floorTilesA : floorTilesB).push(entry);
      }
    }
    runners.push([0.15, y + 0.09, -4, 0, 0, 0, 1.45, 0.025, 10.4]);
    for (const z of [-9.1, -6.2, -3.3, -0.4]) {
      wallPanels.push([7.83, y + 0.62, z, 0, 0, 0, 0.07, 1.18, 2.55]);
      panelRails.push([7.77, y + 1.24, z, 0, 0, 0, 0.08, 0.055, 2.62]);
    }
    cableRails.push(
      [4.9, y + 2.7, -4, 0, 0, 0, 0.055, 0.055, 11.2],
      [5.55, y + 2.7, -4, 0, 0, 0, 0.055, 0.055, 11.2],
    );
    for (let i = 0; i < 19; i++) {
      cableRungs.push([5.225, y + 2.7, -9.1 + i * 0.57, 0, 0, 0, 0.7, 0.035, 0.04]);
    }
    conduits.push(
      [7.7, y + 2.05, -4.4, Math.PI / 2, 0, 0, 0.035, 9.3, 0.035],
      [7.7, y + 1.62, -4.4, Math.PI / 2, 0, 0, 0.025, 9.3, 0.025],
    );
  }
  const tilesA = instanced(scene, unitBox, frontline.concrete, floorTilesA, false);
  tilesA.name = 'op-bravo-floor-tiles-a';
  const tilesB = instanced(scene, unitBox, frontline.concreteDark, floorTilesB, false);
  tilesB.name = 'op-bravo-floor-tiles-b';
  const runnerBatch = instanced(scene, unitBox, rubber, runners, false);
  runnerBatch.name = 'op-bravo-floor-runners';
  const wallPanelBatch = instanced(scene, unitBox, steel, wallPanels);
  wallPanelBatch.name = 'op-bravo-lower-wall-panels';
  const railBatch = instanced(scene, unitBox, darkSteel, panelRails);
  railBatch.name = 'op-bravo-lower-wall-rails';
  const cableRailBatch = instanced(scene, unitBox, darkSteel, cableRails, false);
  cableRailBatch.name = 'op-bravo-cable-tray-rails';
  const cableRungBatch = instanced(scene, unitBox, darkSteel, cableRungs, false);
  cableRungBatch.name = 'op-bravo-cable-tray-rungs';
  const conduitBatch = instanced(
    scene, new THREE.CylinderGeometry(0.5, 0.5, 1, 7),
    frontline.rebar, conduits, false);
  conduitBatch.name = 'op-bravo-wall-conduits';

  // A continuous handrail finally explains the open west-side stairwell and makes the
  // top-to-bottom route readable from every landing.
  const stairRails = [];
  const stairPosts = [];
  const slope = Math.atan2(3.4, 3);
  for (let floor = 0; floor < 4; floor++) {
    const even = floor % 2 === 0;
    const y = floor * 3;
    const zMid = even ? -8.2 : 0.2;
    stairRails.push([
      -5.72, y + 1.65, zMid,
      even ? -slope : slope, 0, 0, 1, 4.54, 1,
    ]);
    for (const [py, pz] of even
      ? [[y + 0.72, -6.5], [y + 3.72, -9.9]]
      : [[y + 0.72, -1.5], [y + 3.72, 1.9]]) {
      stairPosts.push([-5.72, py, pz, 0, 0, 0, 1, 1.35, 1]);
    }
  }
  const stairRailBatch = instanced(
    scene, new THREE.CylinderGeometry(0.035, 0.035, 1, 8),
    darkSteel, stairRails);
  stairRailBatch.name = 'op-bravo-stair-handrails';
  const stairPostBatch = instanced(
    scene, new THREE.CylinderGeometry(0.03, 0.03, 1, 8),
    darkSteel, stairPosts);
  stairPostBatch.name = 'op-bravo-stair-posts';

  // Top floor: signals cell and observation briefing station.
  const signalRacks = instanced(scene, EQUIPMENT_CASE_GEO, frontline.equipment, [
    [6.7, 9.78, -8.6, 0, 0, 0, 1.15, 1.65, 0.88],
    [6.7, 9.78, -7.15, 0, 0, 0, 1.15, 1.65, 0.88],
  ]);
  signalRacks.name = 'op-bravo-signals-racks';
  const rackFaces = instanced(scene, unitBox, darkSteel, [
    [6.12, 9.8, -8.6, 0, 0, 0, 0.04, 1.35, 0.68],
    [6.12, 9.8, -7.15, 0, 0, 0, 0.04, 1.35, 0.68],
  ], false);
  rackFaces.name = 'op-bravo-signals-rack-faces';
  const rackLeds = [];
  for (const z of [-8.6, -7.15]) {
    for (let i = 0; i < 6; i++) {
      rackLeds.push([6.085, 9.4 + i * 0.18, z - 0.22 + (i % 2) * 0.34,
        0, 0, 0, 0.025, 0.035, 0.055]);
    }
  }
  const leds = instanced(scene, unitBox, screen, rackLeds, false);
  leds.name = 'op-bravo-signals-leds';
  addFieldTable(scene, 2.6, 9.86, -7.2, Math.PI / 2, 2.2, 0.84);
  addEquipmentCases(scene, [
    [4.25, 9.3, -8.8, 0, 0.15, 0, 1.0, 0.8, 0.86],
    [5.15, 9.25, -9.0, 0, -0.08, 0, 0.82, 0.7, 0.8],
  ]);

  // Third floor: hostage holding area, with field cots and rolled blankets against the east
  // wall. Their cloth shapes break up the repeated office furniture without narrowing lanes.
  const cots = instanced(scene, unitBox, rubber, [
    [6.15, 6.34, -8.2, 0, 0, 0, 2.7, 0.18, 0.82],
    [6.15, 6.34, -4.7, 0, 0, 0, 2.7, 0.18, 0.82],
    [6.15, 6.34, -1.2, 0, 0, 0, 2.7, 0.18, 0.82],
  ], false);
  cots.name = 'op-bravo-field-cots';
  const cotFrames = instanced(scene, unitBox, steel, [
    [6.15, 6.18, -8.2, 0, 0, 0, 2.82, 0.07, 0.92],
    [6.15, 6.18, -4.7, 0, 0, 0, 2.82, 0.07, 0.92],
    [6.15, 6.18, -1.2, 0, 0, 0, 2.82, 0.07, 0.92],
  ]);
  cotFrames.name = 'op-bravo-field-cot-frames';
  const blankets = instanced(
    scene, new THREE.CylinderGeometry(0.13, 0.13, 0.68, 12),
    frontline.sandbag, [
      [5.2, 6.55, -8.2, Math.PI / 2, 0, 0, 1, 1, 1],
      [5.2, 6.55, -4.7, Math.PI / 2, 0, 0, 1, 1, 1],
      [5.2, 6.55, -1.2, Math.PI / 2, 0, 0, 1, 1, 1],
    ], false);
  blankets.name = 'op-bravo-rolled-blankets';

  // Second floor: assault staging and ammunition redistribution.
  addEquipmentCases(scene, [
    [6.5, 3.34, -8.7, 0, 0.04, 0, 1.1, 0.9, 0.95],
    [5.35, 3.28, -8.65, 0, -0.1, 0, 0.9, 0.76, 0.84],
    [6.4, 3.3, -7.55, 0, 0.12, 0, 0.92, 0.78, 0.84],
    [5.4, 3.26, -7.6, 0, -0.06, 0, 0.78, 0.68, 0.78],
  ]);
  const ammoShelf = instanced(scene, unitBox, steel, [
    [6.85, 4.05, -2.5, 0, 0, 0, 1.45, 0.08, 2.4],
    [6.85, 3.45, -2.5, 0, 0, 0, 1.45, 0.08, 2.4],
    [6.85, 4.65, -2.5, 0, 0, 0, 1.45, 0.08, 2.4],
  ]);
  ammoShelf.name = 'op-bravo-ammunition-shelves';
  const ammoBoxes = [];
  for (const y of [3.62, 4.22]) {
    for (const z of [-3.2, -2.5, -1.8]) {
      ammoBoxes.push([6.65, y, z, 0, 0, 0, 0.92, 0.45, 0.52]);
    }
  }
  const ammo = instanced(scene, EQUIPMENT_CASE_GEO, frontline.equipment, ammoBoxes);
  ammo.name = 'op-bravo-ammunition-cases';

  // Ground floor: a hardened checkpoint and a street-facing entrance canopy. The retained
  // 1.6m doorway stays fully open; every defensive prop sits to its side.
  const lobbyBags = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      lobbyBags.push([
        side * (1.45 + i * 0.48), 0.23, 1.9,
        0, 0, Math.PI / 2, 0.9, 0.94, 0.9,
      ]);
    }
  }
  sandbagInstances(scene, 'op-bravo-lobby-sandbags', lobbyBags);
  const canopy = instanced(scene, unitBox, darkSteel, [
    [0, 2.72, 3.48, 0, 0, -0.025, 4.8, 0.14, 1.28],
    [-2.2, 1.37, 3.65, 0, 0, 0.02, 0.1, 2.68, 0.1],
    [2.2, 1.37, 3.65, 0, 0, -0.02, 0.1, 2.68, 0.1],
    [0, 3.55, 3.22, 0, 0, 0, 3.55, 1.3, 0.12],
  ]);
  canopy.name = 'op-bravo-entry-canopy';
  const canopyLens = new THREE.MeshStandardMaterial({
    color: 0xd3d6cd,
    emissive: 0xd8e9df,
    emissiveIntensity: 0.38,
    roughness: 0.7,
    metalness: 0.04,
  });
  const entryLight = instanced(scene, unitBox, canopyLens, [
    [0, 2.63, 3.62, 0, 0, 0, 1.2, 0.04, 0.24],
  ], false);
  entryLight.name = 'op-bravo-entry-light';
  const signMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: opBravoSignTexture(),
    roughness: 0.74,
    metalness: 0.1,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.1), signMaterial);
  sign.name = 'op-bravo-entry-sign';
  sign.position.set(0, 3.55, 3.29);
  scene.add(sign);
  const drainpipes = instanced(
    scene, new THREE.CylinderGeometry(0.07, 0.07, 1, 8),
    darkSteel, [
      [-7.45, 6, 3.09, 0, 0, 0, 1, 11.8, 1],
      [7.45, 6, 3.09, 0, 0, 0, 1, 11.8, 1],
    ]);
  drainpipes.name = 'op-bravo-facade-drainpipes';
  addHescoPositions(scene, 'op-bravo-street-hesco', [
    [-5.9, 0.55, 5.2, 0, 0.05, 0, 1.35, 1.05, 0.9],
    [5.9, 0.55, 5.2, 0, -0.05, 0, 1.35, 1.05, 0.9],
  ]);

  const damageRubble = [[], [], []];
  for (let i = 0; i < 42; i++) {
    const side = i % 2 ? -1 : 1;
    damageRubble[i % 3].push([
      side * (6.7 + R() * 2.5), 0.08 + R() * 0.16, 3.8 + R() * 2.8,
      R() * Math.PI, R() * Math.PI, R() * Math.PI,
      0.5 + R() * 0.8, 0.5 + R() * 0.7, 0.5 + R() * 0.75,
    ]);
  }
  for (let i = 0; i < damageRubble.length; i++) {
    const rubble = instanced(
      scene, RUBBLE_GEOMETRIES[i],
      i === 1 ? frontline.brick : frontline.concrete,
      damageRubble[i], false);
    rubble.name = `op-bravo-entry-rubble-${i}`;
  }
}

function addRelayRooftop(scene) {
  const frontline = frontlineMaterials();
  const R = rng(66017);

  // Cover the brick family inherited from the building collision box with a dedicated roof
  // membrane. Cloned maps can repeat at rooftop scale without mutating the shared street map.
  const sourceMap = frontline.asphalt.map?.clone() || null;
  const sourceBump = frontline.asphalt.bumpMap?.clone() || null;
  for (const texture of [sourceMap, sourceBump]) {
    if (!texture) continue;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 4);
    texture.needsUpdate = true;
  }
  const membraneMaterial = new THREE.MeshStandardMaterial({
    color: 0x4d514f,
    map: sourceMap,
    bumpMap: sourceBump,
    bumpScale: sourceBump ? 0.022 : 0,
    roughness: 0.98,
    metalness: 0,
  });
  const membrane = new THREE.Mesh(
    new THREE.PlaneGeometry(19.6, 15.6), membraneMaterial);
  membrane.name = 'relay-roof-bitumen-membrane';
  membrane.rotation.x = -Math.PI / 2;
  membrane.position.set(0, 24.018, 68);
  membrane.receiveShadow = quality.shadows;
  scene.add(membrane);

  const roofPatchMaterial = new THREE.MeshStandardMaterial({
    color: 0x252a29, roughness: 0.99, metalness: 0,
  });
  const patches = [
    [-5.8, 24.034, 65.6, -Math.PI / 2, 0, 0.12, 2.1, 1.2, 1],
    [4.9, 24.034, 71.2, -Math.PI / 2, 0, -0.18, 1.6, 0.95, 1],
    [6.9, 24.034, 65.0, -Math.PI / 2, 0, 0.32, 1.05, 0.7, 1],
  ];
  const patchBatch = instanced(
    scene, raggedDisc(1, 22, 66019), roofPatchMaterial, patches, false);
  patchBatch.name = 'relay-roof-membrane-patches';

  const puddleMaterial = new THREE.MeshStandardMaterial({
    color: 0x090d0d,
    roughness: 0.72,
    metalness: 0,
  });
  const puddles = [
    [-7.2, 24.039, 72.4, -Math.PI / 2, 0, 0.18, 0.92, 0.44, 1],
    [5.9, 24.039, 68.2, -Math.PI / 2, 0, -0.24, 0.72, 0.38, 1],
  ];
  const puddleBatch = instanced(
    scene, raggedDisc(1, 20, 66023), puddleMaterial, puddles, false);
  puddleBatch.name = 'relay-roof-standing-water';

  const gravel = [];
  for (let i = 0; i < 88; i++) {
    let x;
    let z;
    do {
      x = -9 + R() * 18;
      z = 61 + R() * 14;
    } while (Math.abs(x) < 4.8 && z < 65.5);
    gravel.push([
      x, 24.05 + R() * 0.035, z,
      R() * 0.3, R() * Math.PI, R() * 0.3,
      0.3 + R() * 0.5, 0.22 + R() * 0.38, 0.3 + R() * 0.5,
    ]);
  }
  const gravelBatch = instanced(
    scene, FINE_RUBBLE_GEO, frontline.concreteDark, gravel, false);
  gravelBatch.name = 'relay-roof-ballast-gravel';

  // Replace all three coarse collision banks with the same stitched authored sack used by
  // the frontline defenses. Their positions mirror the level geometry exactly.
  const roofBags = [];
  const addBagBank = (cx, cz, cols, rows, rotated, seed) => {
    const B = rng(seed);
    for (let row = 0; row < rows; row++) {
      const count = cols - (row % 2 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * 0.52
          + (row % 2 ? 0.26 : 0) + (B() - 0.5) * 0.05;
        roofBags.push(rotated
          ? [cx + (B() - 0.5) * 0.06, 24.14 + row * 0.26, cz + off,
            Math.PI / 2, 0, 0, 0.88, 0.94, 0.88]
          : [cx + off, 24.14 + row * 0.26, cz + (B() - 0.5) * 0.06,
            0, 0, Math.PI / 2, 0.88, 0.94, 0.88]);
      }
    }
  };
  addBagBank(-3.4, 61.0, 5, 3, false, 61);
  addBagBank(3.4, 61.0, 5, 3, false, 62);
  addBagBank(-6.2, 62.6, 3, 2, true, 63);
  sandbagInstances(scene, 'relay-roof-authored-sandbags', roofBags);

  const duckboards = [];
  for (let i = 0; i < 10; i++) {
    duckboards.push([-2.18 + i * 0.485, 24.065, 63.2, 0, 0, 0, 0.42, 0.055, 1.52]);
  }
  duckboards.push(
    [0, 24.035, 62.68, 0, 0, 0, 4.9, 0.06, 0.09],
    [0, 24.035, 63.72, 0, 0, 0, 4.9, 0.06, 0.09],
  );
  const duckboardBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), frontline.timber, duckboards);
  duckboardBatch.name = 'relay-roof-timber-duckboards';

  const matMaterial = new THREE.MeshStandardMaterial({
    color: 0x171d1a,
    map: surfaces().fabric.map,
    normalMap: surfaces().fabric.normalMap,
    normalScale: new THREE.Vector2(0.18, 0.18),
    roughness: 0.96,
    metalness: 0,
  });
  const firingMat = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), matMaterial,
    [[0, 24.07, 62.1, 0, 0, 0, 1.06, 0.035, 2.16]]);
  firingMat.name = 'relay-roof-firing-mat';
  const matSeams = [
    [-0.49, 24.092, 62.1, 0, 0, 0, 0.022, 0.014, 2.08],
    [0.49, 24.092, 62.1, 0, 0, 0, 0.022, 0.014, 2.08],
    [0, 24.092, 61.08, 0, 0, 0, 1.0, 0.014, 0.022],
    [0, 24.092, 63.12, 0, 0, 0, 1.0, 0.014, 0.022],
    [0, 24.092, 62.1, 0, 0, 0, 0.018, 0.014, 2.02],
  ];
  const matSeamBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), frontline.equipment, matSeams, false);
  matSeamBatch.name = 'relay-roof-firing-mat-seams';
  const matRoll = instanced(
    scene, new THREE.CylinderGeometry(0.055, 0.055, 1, 12),
    matMaterial,
    [[0, 24.13, 63.18, 0, 0, Math.PI / 2, 1, 1.03, 1]], false);
  matRoll.name = 'relay-roof-firing-mat-roll';

  // Rebuild the access hutch as a panelled service enclosure around the retained solid shell.
  const cladding = frontline.barrierSteel.clone();
  cladding.color.setHex(0x69736f);
  cladding.roughness = 0.82;
  const darkSteel = frontline.barrierSteel.clone();
  darkSteel.color.setHex(0x252c2d);
  const hutchPanels = [
    [-2.02, 25.2, 67.63, 0, 0, 0, 0.56, 2.3, 0.08],
    [0.02, 25.2, 67.63, 0, 0, 0, 0.56, 2.3, 0.08],
    [-1, 26.28, 67.63, 0, 0, 0, 2.6, 0.22, 0.08],
    [-1, 25.2, 65.18, 0, 0, 0, 2.6, 2.3, 0.08],
    [-2.3, 25.2, 66.4, 0, 0, 0, 0.08, 2.3, 2.38],
    [0.3, 25.2, 66.4, 0, 0, 0, 0.08, 2.3, 2.38],
  ];
  const hutchPanelBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), cladding, hutchPanels);
  hutchPanelBatch.name = 'relay-hutch-cladding';
  const roofParts = [
    [-1, 26.48, 66.4, 0, 0, 0, 3.0, 0.16, 2.78],
    [-1, 26.58, 65.04, 0, 0, 0, 3.0, 0.08, 0.09],
    [-1, 26.58, 67.76, 0, 0, 0, 3.0, 0.08, 0.09],
  ];
  for (const x of [-2.25, -1.62, -0.99, -0.36, 0.27]) {
    roofParts.push([x, 26.59, 66.4, 0, 0, 0, 0.045, 0.045, 2.72]);
  }
  const hutchRoof = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), darkSteel, roofParts);
  hutchRoof.name = 'relay-hutch-roof-flashing';

  const door = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), darkSteel,
    [[-1, 25.12, 67.69, 0, 0, 0, 1.08, 2.02, 0.08]]);
  door.name = 'relay-hutch-access-door';
  const doorHardware = [
    [-1.56, 25.12, 67.75, 0, 0, 0, 0.06, 2.2, 0.06],
    [-0.44, 25.12, 67.75, 0, 0, 0, 0.06, 2.2, 0.06],
    [-1, 26.21, 67.75, 0, 0, 0, 1.18, 0.06, 0.06],
    [-1, 24.03, 67.75, 0, 0, 0, 1.18, 0.06, 0.06],
    [-0.62, 25.05, 67.79, 0, 0, 0, 0.24, 0.055, 0.055],
  ];
  const hardware = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), frontline.rebar, doorHardware);
  hardware.name = 'relay-hutch-door-hardware';
  const hinges = [
    [-1.48, 24.48, 67.8, 0, 0, 0, 0.09, 0.18, 0.08],
    [-1.48, 25.12, 67.8, 0, 0, 0, 0.09, 0.18, 0.08],
    [-1.48, 25.76, 67.8, 0, 0, 0, 0.09, 0.18, 0.08],
  ];
  const hingeBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), frontline.rebar, hinges);
  hingeBatch.name = 'relay-hutch-door-hinges';

  const ventSlats = [];
  for (let i = 0; i < 6; i++) {
    ventSlats.push(
      [0.35, 25.52 - i * 0.13, 66.2, 0, 0, 0, 0.03, 0.045, 0.72],
      [-2.35, 25.52 - i * 0.13, 66.45, 0, 0, 0, 0.018, 0.035, 0.38],
    );
  }
  const vent = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), darkSteel, ventSlats, false);
  vent.name = 'relay-hutch-service-vent';
  const sideSeams = [];
  for (const z of [65.52, 66.08, 66.64, 67.2]) {
    sideSeams.push([-2.35, 25.2, z, 0, 0, 0, 0.014, 2.24, 0.022]);
  }
  const seamBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), darkSteel, sideSeams, false);
  seamBatch.name = 'relay-hutch-panel-seams';

  const signMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: relayHutchSignTexture(),
    roughness: 0.78,
    metalness: 0.08,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.58), signMaterial);
  sign.name = 'relay-hutch-access-sign';
  sign.position.set(-1, 25.47, 67.745);
  scene.add(sign);

  const conduits = [
    [0.38, 24.86, 66.88, 0, 0, 0, 0.045, 1.55, 0.045],
    [0.38, 24.1, 64.75, Math.PI / 2, 0, 0, 0.045, 4.25, 0.045],
    [4.5, 24.1, 62.65, 0, 0, Math.PI / 2, 0.045, 8.2, 0.045],
  ];
  const conduitBatch = instanced(
    scene, new THREE.CylinderGeometry(0.5, 0.5, 1, 7),
    frontline.rebar, conduits, false);
  conduitBatch.name = 'relay-roof-conduit';

  // The original rooftop utilities remain as invisible collision in the level definition.
  // These assemblies replace their square silhouettes with recognisable service equipment
  // while sharing each small family of parts in one draw call.
  const utilitySteel = frontline.barrierSteel.clone();
  utilitySteel.color.setHex(0x66706f);
  utilitySteel.roughness = 0.76;
  const utilityDark = frontline.barrierSteel.clone();
  utilityDark.color.setHex(0x242a2b);
  utilityDark.roughness = 0.68;
  const utilityRust = frontline.rebar.clone();
  utilityRust.color.setHex(0x664438);

  const acBodies = [];
  const acLids = [];
  const acFeet = [];
  const acFanRings = [];
  const acFanHubs = [];
  const acFanBlades = [];
  const acLouvers = [];
  const addAc = (x, z, scale) => {
    const bodyTop = 24 + 0.7 * scale;
    acBodies.push([x, 24 + 0.35 * scale, z, 0, 0, 0,
      1.5 * scale, 0.7 * scale, 1.2 * scale]);
    acLids.push([x, bodyTop + 0.035, z, 0, 0, 0,
      1.58 * scale, 0.07, 1.28 * scale]);
    for (const dx of [-0.56, 0.56]) {
      for (const dz of [-0.42, 0.42]) {
        acFeet.push([x + dx * scale, 24.08, z + dz * scale, 0, 0, 0,
          0.13 * scale, 0.16, 0.13 * scale]);
      }
    }
    acFanRings.push([x, bodyTop + 0.084, z, Math.PI / 2, 0, 0,
      scale, scale, scale]);
    acFanHubs.push([x, bodyTop + 0.083, z, 0, 0, 0,
      scale, 0.055, scale]);
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      acFanBlades.push([
        x + Math.cos(angle) * 0.18 * scale,
        bodyTop + 0.084,
        z + Math.sin(angle) * 0.18 * scale,
        0, -angle + 0.24, 0,
        0.34 * scale, 0.025, 0.105 * scale,
      ]);
    }
    for (let i = 0; i < 7; i++) {
      acLouvers.push([
        x - 0.55 * scale + i * 0.183 * scale,
        24 + 0.38 * scale,
        z - 0.605 * scale,
        0.18, 0, 0,
        0.105 * scale, 0.035, 0.025,
      ]);
    }
  };
  addAc(-6.5, 69.5, 1.2);
  addAc(-4.0, 72.4, 1.0);
  const acBodyBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), utilitySteel, acBodies);
  acBodyBatch.name = 'relay-roof-ac-housings';
  const acLidBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), utilityDark, acLids);
  acLidBatch.name = 'relay-roof-ac-lids';
  const acFootBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), utilityRust, acFeet);
  acFootBatch.name = 'relay-roof-ac-feet';
  const acRingBatch = instanced(
    scene, new THREE.TorusGeometry(0.34, 0.027, 6, 18), utilityDark,
    acFanRings, false);
  acRingBatch.name = 'relay-roof-ac-fan-rings';
  const acHubBatch = instanced(
    scene, new THREE.CylinderGeometry(0.075, 0.075, 1, 10), utilityDark,
    acFanHubs, false);
  acHubBatch.name = 'relay-roof-ac-fan-hubs';
  const acBladeBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), utilityDark, acFanBlades, false);
  acBladeBatch.name = 'relay-roof-ac-fan-blades';
  const acLouverBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), utilityDark, acLouvers, false);
  acLouverBatch.name = 'relay-roof-ac-louvers';

  const tankBody = instanced(
    scene, new THREE.CylinderGeometry(1, 1, 2.8, 20, 1, false),
    utilitySteel, [[6.6, 26.0, 71.5, 0, 0, 0, 1, 1, 1]]);
  tankBody.name = 'relay-roof-water-tank';
  const tankCap = instanced(
    scene, new THREE.CylinderGeometry(0.93, 1.04, 0.22, 20),
    utilityDark, [[6.6, 27.48, 71.5, 0, 0, 0, 1, 1, 1]]);
  tankCap.name = 'relay-roof-water-tank-cap';
  const tankBands = [];
  for (const y of [24.82, 25.58, 26.34, 27.1]) {
    tankBands.push([6.6, y, 71.5, Math.PI / 2, 0, 0, 1, 1, 1]);
  }
  const tankBandBatch = instanced(
    scene, new THREE.TorusGeometry(1.015, 0.035, 6, 20),
    utilityRust, tankBands, false);
  tankBandBatch.name = 'relay-roof-water-tank-bands';
  const tankSupports = [
    [5.56, 24.08, 70.46, 0, 0, 0, 0.15, 0.16, 0.15],
    [7.64, 24.08, 70.46, 0, 0, 0, 0.15, 0.16, 0.15],
    [5.56, 24.08, 72.54, 0, 0, 0, 0.15, 0.16, 0.15],
    [7.64, 24.08, 72.54, 0, 0, 0, 0.15, 0.16, 0.15],
    [6.6, 24.18, 71.5, 0, 0, 0, 2.34, 0.12, 2.34],
  ];
  const tankSupportBatch = instanced(
    scene, new THREE.BoxGeometry(1, 1, 1), utilityDark, tankSupports);
  tankSupportBatch.name = 'relay-roof-water-tank-supports';
  const tankLadder = [
    [6.18, 26.0, 70.43, 0, 0, 0, 0.045, 2.86, 0.045],
    [7.02, 26.0, 70.43, 0, 0, 0, 0.045, 2.86, 0.045],
  ];
  for (let i = 0; i < 7; i++) {
    tankLadder.push([6.6, 24.78 + i * 0.39, 70.43, 0, 0, Math.PI / 2,
      0.045, 0.84, 0.045]);
  }
  const tankLadderBatch = instanced(
    scene, new THREE.CylinderGeometry(0.5, 0.5, 1, 7),
    utilityRust, tankLadder, false);
  tankLadderBatch.name = 'relay-roof-water-tank-ladder';

  const ventBase = instanced(
    scene, new THREE.CylinderGeometry(0.39, 0.46, 0.12, 14),
    utilityDark, [[2.2, 24.08, 73.6, 0, 0, 0, 1, 1, 1]]);
  ventBase.name = 'relay-roof-vent-flashing';
  const ventStack = instanced(
    scene, new THREE.CylinderGeometry(0.23, 0.25, 1.18, 14),
    utilitySteel, [[2.2, 24.64, 73.6, 0, 0, 0, 1, 1, 1]]);
  ventStack.name = 'relay-roof-vent-stack';
  const ventCap = instanced(
    scene, new THREE.CylinderGeometry(0.31, 0.42, 0.24, 14),
    utilityDark, [[2.2, 25.35, 73.6, 0, 0, 0, 1, 1, 1]]);
  ventCap.name = 'relay-roof-vent-rain-cap';

  // A dedicated spotting optic gives the observation post an actual second job beside the
  // drone table. Its tripod and angled tube stay behind the parapet and outside player motion.
  const tripodLegs = [
    [3.25, 24.53, 62.08, 0.42, 0, 0.22, 1, 1.05, 1],
    [3.64, 24.53, 62.08, 0.42, 0, -0.22, 1, 1.05, 1],
    [3.45, 24.53, 62.45, -0.42, 0, 0, 1, 1.05, 1],
  ];
  const tripod = instanced(
    scene, new THREE.CylinderGeometry(0.025, 0.035, 1, 8),
    frontline.barrierSteel, tripodLegs);
  tripod.name = 'relay-spotter-tripod';
  const opticParts = [
    [3.45, 25.18, 61.95, Math.PI / 2, 0, 0, 1, 0.82, 1],
    [3.45, 25.18, 61.51, Math.PI / 2, 0, 0, 1.25, 0.18, 1.25],
    [3.45, 25.18, 62.39, Math.PI / 2, 0, 0, 1.08, 0.16, 1.08],
  ];
  const optic = instanced(
    scene, new THREE.CylinderGeometry(0.09, 0.11, 1, 12),
    frontline.equipment, opticParts);
  optic.name = 'relay-spotter-optic';
  const opticLensMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x4c7180, roughness: 0.16, metalness: 0.04,
    clearcoat: 0.7, clearcoatRoughness: 0.08,
  });
  const opticLens = instanced(
    scene, new THREE.CylinderGeometry(0.085, 0.085, 0.018, 14),
    opticLensMaterial,
    [[3.45, 25.18, 61.42, Math.PI / 2, 0, 0, 1, 1, 1]], false);
  opticLens.name = 'relay-spotter-objective-lens';
}

function addBurningWreck(scene, x, z, seed = 0) {
  const root = new THREE.Group();
  root.name = `compound-burning-wreck-${seed}`;
  root.position.set(x, 0, z);
  const flameMaterial = new THREE.MeshBasicMaterial({
    name: 'compound-wreck-flame',
    color: 0xff7a2f,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const hotMaterial = new THREE.MeshBasicMaterial({
    name: 'compound-wreck-flame-core',
    color: 0xffd37a,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const smokeMaterial = new THREE.MeshStandardMaterial({
    name: 'compound-wreck-drifting-smoke',
    color: 0x252a2a,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const flames = [];
  for (let i = 0; i < 4; i++) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22 + i * 0.035, 0.9 + i * 0.12, 9),
      i === 0 ? hotMaterial : flameMaterial,
    );
    flame.position.set(-0.55 + i * 0.36, 1.36 + (i % 2) * 0.13, (i % 2 ? 0.18 : -0.2));
    flame.rotation.z = (i - 1.5) * 0.08;
    flame.frustumCulled = false;
    root.add(flame);
    flames.push(flame);
  }
  const smoke = [];
  for (let i = 0; i < 5; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 10, 7), smokeMaterial);
    puff.frustumCulled = false;
    root.add(puff);
    smoke.push(puff);
  }
  scene.add(root);
  let clock = seed * 0.71;
  (scene.userData.frontlineEffects ||= []).push(dt => {
    clock += dt;
    for (let i = 0; i < flames.length; i++) {
      const pulse = 0.82 + Math.sin(clock * (8.2 + i * 0.7) + i * 1.9) * 0.18;
      flames[i].scale.set(0.8 + pulse * 0.28, pulse, 0.8 + pulse * 0.2);
      flames[i].rotation.y = clock * (0.9 + i * 0.11);
    }
    for (let i = 0; i < smoke.length; i++) {
      const phase = (clock * 0.12 + i / smoke.length) % 1;
      puffPosition(smoke[i], phase, i);
    }
    return false;
  });

  function puffPosition(puff, phase, index) {
    puff.visible = phase > 0.03;
    puff.position.set(
      -0.45 + phase * 1.65 + Math.sin(clock * 0.7 + index) * 0.13,
      1.65 + phase * 5.2,
      (index % 2 ? 0.24 : -0.2) + phase * 0.72,
    );
    const size = 0.5 + phase * 1.55;
    puff.scale.set(size * 1.18, size, size);
  }
}

export function addFrontlineMissionArt(scene, levelId) {
  if (!quality.desktop) return;
  const frontline = frontlineMaterials();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b302f, roughness: 0.86 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x30373a, roughness: 0.58, metalness: 0.58 });

  if (levelId === 3) {
    addObservationPost(scene, -2, 9.2, -6, 0);

    // OP Alpha is a residential courtyard, not a tower dropped onto an empty slab. A broken
    // paving run leads from the insertion point to the entrance while leaving the actual
    // ground plane and navigation authoritative.
    const paving = [];
    for (let i = 0; i < 7; i++) {
      for (const side of [-1, 1]) {
        paving.push([
          side * (0.61 + (i % 3 - 1) * 0.025), 0.032, 15.1 - i * 2.02,
          0, (i % 2 ? 0.012 : -0.018) + side * 0.004, 0,
          1.15 - (i % 3) * 0.025, 0.055, 1.82 - (i % 2) * 0.08,
        ]);
      }
    }
    // The original centre path now forks toward the two real breach portals instead of
    // terminating against the closed party seam between them.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        paving.push([
          side * (1.5 + i * 1.45), 0.034, 3.15,
          0, side * 0.008, 0,
          1.32, 0.055, 1.05,
        ]);
      }
    }
    const pavingBatch = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), frontline.concrete, paving, false);
    pavingBatch.name = 'op-alpha-courtyard-pavers';

    // An entrance canopy and its damaged support structure give the front elevation depth.
    // Everything is above or beside the combat lane, so this visual layer cannot snag actors.
    const canopyParts = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), frontline.barrierSteel,
      [-7, 7].flatMap((entryX, index) => [
        [entryX, 2.78, 2.55, 0, 0, index ? 0.028 : -0.035, 4.65, 0.12, 1.72],
        [entryX - 2.08, 1.45, 2.62, 0, 0, 0.035, 0.1, 2.72, 0.1],
        [entryX + 2.08, 1.45, 2.62, 0, 0, -0.028, 0.1, 2.72, 0.1],
        [entryX, 2.67, 3.38, 0, 0, 0, 4.5, 0.16, 0.12],
      ]));
    canopyParts.name = 'op-alpha-entry-canopy';
    const canopySoffitMaterial = new THREE.MeshStandardMaterial({
      color: 0xd0c49d, emissive: 0xffd18a, emissiveIntensity: 0.32,
      roughness: 0.86, metalness: 0.02,
    });
    const canopyLight = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), canopySoffitMaterial,
      [
        [-7, 2.69, 2.72, 0, 0, 0, 1.1, 0.035, 0.24],
        [7, 2.69, 2.72, 0, 0, 0, 1.1, 0.035, 0.24],
      ], false);
    canopyLight.name = 'op-alpha-entry-light';

    // A Soviet-era exterior fire escape breaks the east wall's cuboid silhouette and gives
    // the player an immediate read on three occupied storeys.
    const firePlatforms = [];
    const fireRails = [];
    const fireSideRails = [];
    const fireBalusters = [];
    for (const y of [3.35, 6.35]) {
      for (let i = 0; i < 12; i++) {
        firePlatforms.push([
          14.32, y, -5.37 + i * 0.25,
          0, 0, 0, 1.55, 0.055, 0.14,
        ]);
      }
      fireRails.push([15.02, y + 1.12, -4, 0, 0, 0, 0.07, 0.055, 3.0]);
      fireSideRails.push(
        [14.32, y + 1.12, -5.43, 0, 0, 0, 1.45, 0.055, 0.055],
        [14.32, y + 1.12, -2.57, 0, 0, 0, 1.45, 0.055, 0.055],
      );
      for (const z of [-5.25, -4.4, -3.55, -2.75]) {
        fireBalusters.push([15.02, y + 0.61, z, 0, 0, 0, 0.045, 1.08, 0.045]);
      }
    }
    const platformBatch = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), frontline.barrierSteel, firePlatforms);
    platformBatch.name = 'op-alpha-fire-escape-platforms';
    const railBatch = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), steel, fireRails);
    railBatch.name = 'op-alpha-fire-escape-rails';
    const sideRailBatch = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), steel, fireSideRails);
    sideRailBatch.name = 'op-alpha-fire-escape-side-rails';
    const balusterBatch = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), steel, fireBalusters);
    balusterBatch.name = 'op-alpha-fire-escape-balusters';
    const ladder = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), steel,
      [
        [15.04, 4.84, -5.08, 0, 0, 0, 0.055, 3.05, 0.055],
        [15.04, 4.84, -4.35, 0, 0, 0, 0.055, 3.05, 0.055],
        ...Array.from({ length: 8 }, (_, i) =>
          [15.04, 3.55 + i * 0.37, -4.715, Math.PI / 2, 0, 0, 0.045, 0.73, 0.045]),
      ]);
    ladder.name = 'op-alpha-fire-escape-ladder';
    const fireBraces = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), steel,
      [
        [14.58, 2.94, -5.1, 0, 0, -0.72, 0.055, 1.18, 0.055],
        [14.58, 2.94, -2.9, 0, 0, -0.72, 0.055, 1.18, 0.055],
        [14.58, 5.94, -5.1, 0, 0, -0.72, 0.055, 1.18, 0.055],
        [14.58, 5.94, -2.9, 0, 0, -0.72, 0.055, 1.18, 0.055],
      ]);
    fireBraces.name = 'op-alpha-fire-escape-braces';

    // The courtyard's surviving clothes-line frames, blast-bent fence and burned-out play
    // equipment provide human scale at the flanks without filling the assault route.
    const courtyardPosts = instanced(
      scene, new THREE.CylinderGeometry(0.045, 0.06, 2.5, 8), steel,
      [
        [-10.5, 1.25, 10.5, 0.02, 0, -0.035, 1, 1, 1],
        [-10.5, 1.25, 3.8, -0.04, 0, 0.025, 1, 1, 1],
        [11.5, 1.25, 11.5, 0.03, 0, 0.05, 1, 1, 1],
        [11.5, 1.25, 5.2, -0.02, 0, -0.04, 1, 1, 1],
      ]);
    courtyardPosts.name = 'op-alpha-courtyard-posts';
    const courtyardCrossbars = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), steel,
      [
        [-10.5, 2.42, 10.5, 0, 0, 0.03, 1.5, 0.07, 0.07],
        [-10.5, 2.42, 3.8, 0, 0, -0.04, 1.5, 0.07, 0.07],
        [11.5, 2.42, 11.5, 0, 0, -0.04, 1.5, 0.07, 0.07],
        [11.5, 2.42, 5.2, 0, 0, 0.05, 1.5, 0.07, 0.07],
      ]);
    courtyardCrossbars.name = 'op-alpha-courtyard-crossbars';

    const cableMaterial = new THREE.LineBasicMaterial({ color: 0x171918 });
    for (const x of [-10.5, 11.5]) {
      const z0 = x < 0 ? 10.5 : 11.5;
      const z1 = x < 0 ? 3.8 : 5.2;
      for (const offset of [-0.42, 0, 0.42]) {
        const points = [];
        for (let i = 0; i < 12; i++) {
          const t = i / 11;
          points.push(new THREE.Vector3(
            x + offset,
            2.42 - Math.sin(t * Math.PI) * 0.24,
            z0 + (z1 - z0) * t,
          ));
        }
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points), cableMaterial);
        line.name = 'op-alpha-clothes-lines';
        scene.add(line);
      }
    }

    const playFrame = instanced(
      scene, new THREE.CylinderGeometry(0.055, 0.065, 2.8, 8), steel,
      [
        [18.7, 1.28, -3.2, 0, 0, 0.42, 1, 1, 1],
        [21.0, 1.28, -3.2, 0, 0, -0.42, 1, 1, 1],
        [18.7, 1.28, -6.3, 0, 0, 0.42, 1, 1, 1],
        [21.0, 1.28, -6.3, 0, 0, -0.42, 1, 1, 1],
        [19.85, 2.55, -4.75, Math.PI / 2, 0, 0, 1, 1.22, 1],
      ]);
    playFrame.name = 'op-alpha-play-frame';
    const playSeats = instanced(
      scene, new THREE.BoxGeometry(0.72, 0.08, 0.32), frontline.timber,
      [
        [19.2, 0.48, -4.7, 0.05, 0, -0.08, 1, 1, 1],
        [20.55, 0.2, -5.1, 0.18, 0.12, 0.5, 1, 1, 1],
      ], false);
    playSeats.name = 'op-alpha-play-seats';

    // Empty, battered planting beds retain domestic courtyard scale without introducing a
    // stylized low-poly tree into an otherwise photographic material pass.
    const treeBeds = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), frontline.concreteDark,
      [
        [-13.5, 0.22, -9.05, 0, 0, 0, 2.5, 0.42, 0.28],
        [-13.5, 0.22, -6.55, 0, 0, 0, 2.5, 0.42, 0.28],
        [-14.75, 0.22, -7.8, 0, 0, 0, 0.28, 0.42, 2.5],
        [-12.25, 0.22, -7.8, 0, 0, 0, 0.28, 0.42, 2.5],
        [14.2, 0.22, 6.55, 0, 0, 0, 2.5, 0.42, 0.28],
        [14.2, 0.22, 9.05, 0, 0, 0, 2.5, 0.42, 0.28],
        [12.95, 0.22, 7.8, 0, 0, 0, 0.28, 0.42, 2.5],
        [15.45, 0.22, 7.8, 0, 0, 0, 0.28, 0.42, 2.5],
      ]);
    treeBeds.name = 'op-alpha-courtyard-planter-kerbs';
    const planterEarth = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), frontline.earthFill,
      [
        [-13.5, 0.07, -7.8, 0, 0, 0, 2.18, 0.11, 2.18],
        [14.2, 0.07, 7.8, 0, 0, 0, 2.18, 0.11, 2.18],
      ], false);
    planterEarth.name = 'op-alpha-courtyard-planter-earth';

    // Localized masonry collapse collects against the east side instead of sprinkling the
    // courtyard uniformly. Three instanced shapes keep the pile cheap.
    const collapse = [[], [], []];
    for (let i = 0; i < 36; i++) {
      const row = Math.floor(i / 9);
      collapse[i % 3].push([
        15.0 + (i % 9) * 0.38, 0.08 + (i % 4) * 0.045, -8.8 - row * 0.42,
        i * 0.17, i * 0.31, i * 0.23,
        0.48 + (i % 4) * 0.1, 0.48 + (i % 3) * 0.12, 0.45 + (i % 5) * 0.08,
      ]);
    }
    for (let i = 0; i < collapse.length; i++) {
      const rubble = instanced(
        scene, RUBBLE_GEOMETRIES[i],
        i === 1 ? frontline.brick : frontline.concrete,
        collapse[i], false);
      rubble.name = `op-alpha-collapse-rubble-${i}`;
    }

    // A battered defensive corner implies why the observers selected this roof and connects
    // the apartment mission to the frontline positions used by later levels.
    addHescoPositions(scene, 'op-alpha-courtyard-hesco', [
      [16.8, 0.53, 10.8, 0, 0.08, 0, 1.35, 1.02, 0.9],
      [18.15, 0.53, 10.65, 0, -0.12, 0, 1.35, 1.02, 0.9],
      [18.9, 0.53, 9.55, 0, Math.PI / 2 + 0.08, 0, 1.35, 1.02, 0.9],
    ]);
    addHedgehogs(scene, 'op-alpha-courtyard-hedgehog', [
      [18.6, 0.92, 14.0, 0, 0.22, 0, 0.82, 0.82, 0.82],
    ]);
  }
  if (levelId === 6) {
    addObservationPost(scene, -4, 24.2, 60, 0, { bags: false });
    addRelayRooftop(scene);
  }
  if (levelId === 7) addOpBravoTower(scene);

  if (levelId === 4) {
    // Parking structure at the end of the pursuit. The gameplay slab and pillars remain
    // cheap collision, but the visible arena needs construction logic: beams supporting the
    // deck, painted pillar jackets, conduit, practical lights, parking bays and oil staining.
    const garagePaint = frontline.concrete.clone();
    garagePaint.color.setHex(0x59646b);
    garagePaint.roughness = 0.95;
    const garageBeam = frontline.concreteDark.clone();
    garageBeam.color.setHex(0x4d5355);
    const lampHousing = frontline.barrierSteel.clone();
    lampHousing.color.setHex(0x22282b);
    const lampLens = new THREE.MeshStandardMaterial({
      color: 0xd8d0b8, emissive: 0xffd89c, emissiveIntensity: 0.52,
      roughness: 0.72, metalness: 0.04,
    });
    const fadedPaint = new THREE.MeshBasicMaterial({
      color: 0xb79b58, transparent: true, opacity: 0.48, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    const oil = new THREE.MeshBasicMaterial({
      color: 0x111616, transparent: true, opacity: 0.48, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3,
    });

    const beams = [];
    for (const z of [-13, -19, -25, -31, -37]) {
      beams.push([-5, 2.82, z, 0, 0, 0, 43.4, 0.25, 0.38]);
    }
    beams.push(
      [-26.72, 2.82, -25, 0, 0, 0, 0.36, 0.25, 27.4],
      [16.72, 2.82, -25, 0, 0, 0, 0.36, 0.25, 27.4],
    );
    const beamBatch = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), garageBeam, beams);
    beamBatch.name = 'pursuit-garage-deck-beams';

    const pillarJackets = [];
    for (const x of [-24, -14, -4, 6, 14]) {
      for (const z of [-16, -25, -34]) {
        pillarJackets.push([x, 0.64, z, 0, 0, 0, 0.82, 1.08, 0.82]);
      }
    }
    const jacketBatch = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), garagePaint, pillarJackets);
    jacketBatch.name = 'pursuit-garage-pillar-jackets';

    const housings = [];
    const lenses = [];
    for (const x of [-20, -10, 0, 10]) {
      for (const z of [-17.5, -26, -34.5]) {
        housings.push([x, 2.9, z, 0, 0, 0, 1.72, 0.09, 0.24]);
        lenses.push([x, 2.845, z, 0, 0, 0, 1.48, 0.035, 0.15]);
      }
    }
    const housingBatch = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), lampHousing, housings, false);
    housingBatch.name = 'pursuit-garage-light-housings';
    const lensBatch = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), lampLens, lenses, false);
    lensBatch.name = 'pursuit-garage-light-lenses';

    const conduit = instanced(
      scene, new THREE.CylinderGeometry(0.025, 0.025, 1, 8),
      frontline.barrierSteel,
      [
        [-5, 2.86, -14.2, 0, 0, Math.PI / 2, 1, 42, 1],
        [-5, 2.86, -35.8, 0, 0, Math.PI / 2, 1, 42, 1],
      ], false);
    conduit.name = 'pursuit-garage-conduit';

    const bayLines = [];
    for (const x of [-19, -9, 1, 11]) {
      bayLines.push(
        [x - 3.7, 0.018, -18.2, 0, 0, 0, 0.11, 0.025, 4.8],
        [x - 3.7, 0.018, -31.5, 0, 0, 0, 0.11, 0.025, 4.8],
      );
    }
    const lineBatch = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), fadedPaint, bayLines, false);
    lineBatch.name = 'pursuit-garage-bay-lines';

    const stains = [
      [-18, 0.022, -20, -Math.PI / 2, 0, 0.1, 2.2, 1.4, 1],
      [-8, 0.022, -25, -Math.PI / 2, 0, -0.2, 1.55, 1.0, 1],
      [2, 0.022, -31, -Math.PI / 2, 0, 0.32, 1.8, 1.1, 1],
      [10, 0.022, -22, -Math.PI / 2, 0, -0.18, 1.35, 0.82, 1],
    ];
    const stainBatch = instanced(scene, raggedDisc(1, 18, 4417), oil, stains, false);
    stainBatch.name = 'pursuit-garage-oil-stains';

    // Localized blast damage near the street-side corner, out of the mandatory chase lane.
    const garageRubble = [];
    for (let i = 0; i < 24; i++) {
      garageRubble.push([
        14.5 - (i % 6) * 0.42,
        0.1 + (i % 3) * 0.045,
        -13.0 - Math.floor(i / 6) * 0.4,
        i * 0.22, i * 0.31, i * 0.17,
        0.45 + (i % 4) * 0.12, 0.36 + (i % 3) * 0.11, 0.42 + (i % 5) * 0.09,
      ]);
    }
    for (let i = 0; i < RUBBLE_GEOMETRIES.length; i++) {
      const rubble = instanced(
        scene, RUBBLE_GEOMETRIES[i],
        i === 1 ? frontline.brick : frontline.concrete,
        garageRubble.filter((_, index) => index % RUBBLE_GEOMETRIES.length === i),
        false,
      );
      rubble.name = `pursuit-garage-rubble-${i}`;
    }

    // The abandoned direction-finding position at the escape gate now reads as a technical
    // team that left in a hurry rather than three anonymous cubes beside a pole.
    addFieldTable(scene, -11.1, 0.92, -35.8, 0.08, 2.0, 0.82);
    addEquipmentCases(scene, [
      [-9.6, 0.29, -36.7, 0, 0.2, 0, 1.1, 0.9, 1],
      [-8.4, 0.25, -37.1, 0, -0.15, 0, 0.92, 0.78, 0.92],
      [-7.5, 0.21, -36.1, 0, 0.1, 0, 0.78, 0.68, 0.82],
    ]);
    const consoleBody = instanced(scene, new THREE.BoxGeometry(1, 1, 1), dark, [
      [-11.1, 1.12, -35.8, -0.08, 0.08, 0, 0.72, 0.18, 0.5],
    ], false);
    consoleBody.name = 'pursuit-direction-finder-console';
    const consoleScreen = instanced(scene, new THREE.PlaneGeometry(1, 1), lampLens, [
      [-11.1, 1.23, -35.54, -0.72, 0, 0, 0.5, 0.22, 1],
    ], false);
    consoleScreen.name = 'pursuit-direction-finder-screen';
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 5.2, 8), steel);
    mast.name = 'pursuit-direction-finder-mast';
    mast.position.set(-10.5, 2.6, -36.8);
    mast.rotation.z = -0.12;
    scene.add(mast);

    const gateLeaves = instanced(
      scene, CORRUGATED_PANEL_GEO, frontline.barrierSteel,
      [
        [-10.25, 1.46, -38.78, 0, 0, 0, 3.7, 1.08, 1],
        [-2.75, 1.46, -38.78, 0, 0, 0, 3.7, 1.08, 1],
      ]);
    gateLeaves.name = 'pursuit-escape-gate-leaves';
    const gateBags = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        gateBags.push([
          -6.5 + side * (3.6 + i * 0.48), 0.2, -38.2,
          0, Math.PI / 2, Math.PI / 2, 1, 1, 1,
        ]);
      }
    }
    sandbagInstances(scene, 'pursuit-escape-gate-sandbags', gateBags);
  }

  if (levelId === 5) {
    // Aid pallets and blast barriers make the market a contested humanitarian site. Cartons,
    // webbing, relief labels, pallet boards and loose supply sacks replace the old dark cubes.
    const aidSites = [[-26, 28], [25, 16], [-24, -20], [22, -26]];
    const cartons = [];
    const straps = [];
    const labels = [];
    const palletSlats = [];
    const palletRunners = [];
    const aidSacks = [];
    for (let site = 0; site < aidSites.length; site++) {
      const [x, z] = aidSites[site];
      for (let i = 0; i < 6; i++) {
        const cx = x + (i % 3) * 0.69;
        const cy = 0.33 + Math.floor(i / 3) * 0.56;
        const yaw = (i % 2 ? 1 : -1) * 0.018;
        cartons.push([cx, cy, z, 0, yaw, 0, 1, 1, 1]);
        straps.push([cx, cy, z, 0, yaw, 0, 0.055, 0.57, 0.66]);
        labels.push(
          [cx, cy + 0.015, z + 0.322, 0, yaw, 0, 1, 1, 1],
          [cx, cy + 0.015, z - 0.322, 0, yaw + Math.PI, 0, 1, 1, 1],
        );
      }
      for (let slat = 0; slat < 5; slat++) {
        palletSlats.push([
          x + 0.69, 0.075, z - 0.36 + slat * 0.18,
          0, 0, 0, 2.3, 0.075, 0.13,
        ]);
      }
      for (const runnerZ of [-0.28, 0, 0.28]) {
        palletRunners.push([x + 0.69, 0.035, z + runnerZ, 0, 0, 0, 2.18, 0.07, 0.09]);
      }
      aidSacks.push(
        [x - 0.65, 0.28, z + 0.42, 0, 0.18 + site * 0.07, Math.PI / 2, 0.92, 0.92, 0.92],
        [x + 2.02, 0.28, z - 0.36, 0, -0.22 - site * 0.04, Math.PI / 2, 0.92, 0.92, 0.92],
      );
    }
    const cardboard = frontline.timber.clone();
    cardboard.color.setHex(0x8f7959);
    cardboard.roughness = 0.98;
    const webbing = frontline.equipment.clone();
    webbing.color.setHex(0x45513f);
    const label = new THREE.MeshStandardMaterial({
      color: 0xd7d4c4, roughness: 0.92, metalness: 0,
      side: THREE.DoubleSide,
    });
    const aidCartons = instanced(scene, AID_CARTON_GEO, cardboard, cartons);
    aidCartons.name = 'frontline-aid-cartons';
    const aidStraps = instanced(scene, new THREE.BoxGeometry(1, 1, 1), webbing, straps);
    aidStraps.name = 'frontline-aid-carton-straps';
    const aidLabels = instanced(scene, AID_LABEL_GEO, label, labels, false);
    aidLabels.name = 'frontline-aid-carton-labels';
    const aidPalletSlats = instanced(
      scene, FIELD_BOARD_GEO, frontline.timber, palletSlats);
    aidPalletSlats.name = 'frontline-aid-pallet-slats';
    const aidPalletRunners = instanced(
      scene, FIELD_BOARD_GEO, frontline.timber, palletRunners);
    aidPalletRunners.name = 'frontline-aid-pallet-runners';
    sandbagInstances(scene, 'frontline-aid-supply-sacks', aidSacks);
    addHescoPositions(scene, 'frontline-market-hesco', [
      [-27.8, 0.55, 27.8, 0, 0.04, 0, 1.45, 1.08, 0.92],
      [-25.55, 0.55, 27.8, 0, -0.03, 0, 1.45, 1.08, 0.92],
      [26.8, 0.55, 15.7, 0, Math.PI / 2, 0, 1.45, 1.08, 0.92],
      [-25.8, 0.55, -21.4, 0, -0.05, 0, 1.45, 1.08, 0.92],
      [23.8, 0.55, -27.6, 0, 0.05, 0, 1.45, 1.08, 0.92],
    ]);

    // The original market occupied one pristine 90-metre concrete plate. Retain that plate
    // for collision, but give the visible plaza construction logic: individually repaired
    // pavers, drainage lanes, patched standing water and local impact damage.
    const marketRng = rng(55041);
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const paverA = frontline.concrete.clone();
    paverA.color.setHex(0x918f88);
    const paverB = frontline.concrete.clone();
    paverB.color.setHex(0x7b7e79);
    const paversA = [];
    const paversB = [];
    for (let iz = 0; iz < 17; iz++) {
      for (let ix = 0; ix < 17; ix++) {
        const x = -32 + ix * 4;
        const z = -32 + iz * 4;
        const transform = [
          x, 0.026, z,
          0, (marketRng() - 0.5) * 0.008, 0,
          3.88 - marketRng() * 0.08, 0.028, 3.88 - marketRng() * 0.08,
        ];
        ((ix + iz + (ix * iz) % 3) % 2 ? paversA : paversB).push(transform);
      }
    }
    const marketPaversA = instanced(scene, unitBox, paverA, paversA, false);
    marketPaversA.name = 'market-plaza-pavers-a';
    const marketPaversB = instanced(scene, unitBox, paverB, paversB, false);
    marketPaversB.name = 'market-plaza-pavers-b';

    const drainMaterial = frontline.barrierSteel.clone();
    drainMaterial.color.setHex(0x303638);
    drainMaterial.roughness = 0.82;
    const drainRuns = [];
    for (const x of [-3.15, 3.15]) {
      for (let i = 0; i < 9; i++) {
        drainRuns.push([x, 0.047, -31.2 + i * 7.8, 0, 0, 0, 0.22, 0.035, 7.45]);
      }
    }
    const drains = instanced(scene, unitBox, drainMaterial, drainRuns, false);
    drains.name = 'market-plaza-drainage';
    const drainSlots = [];
    for (const x of [-3.15, 3.15]) {
      for (let i = 0; i < 54; i++) {
        drainSlots.push([x, 0.069, -34.2 + i * 1.3, 0, 0, 0, 0.34, 0.018, 0.06]);
      }
    }
    const slots = instanced(scene, unitBox, dark, drainSlots, false);
    slots.name = 'market-plaza-drain-slots';

    const wetMaterial = new THREE.MeshStandardMaterial({
      color: 0x151b1c,
      roughness: 0.62,
      metalness: 0,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const plazaPuddles = instanced(
      scene, raggedDisc(1, 24, 55043), wetMaterial, [
        [-29, 0.066, 11.5, -Math.PI / 2, 0, 0.12, 2.7, 1.35, 1],
        [17.5, 0.066, 27.6, -Math.PI / 2, 0, -0.18, 2.1, 0.95, 1],
        [28.2, 0.066, -9.5, -Math.PI / 2, 0, 0.25, 2.4, 1.2, 1],
        [-10.2, 0.066, -31.0, -Math.PI / 2, 0, -0.1, 1.8, 0.85, 1],
        [5.6, 0.066, -14.0, -Math.PI / 2, 0, 0.08, 1.15, 0.6, 1],
        [-5.5, 0.066, 13.8, -Math.PI / 2, 0, -0.22, 1.25, 0.56, 1],
      ], false);
    plazaPuddles.name = 'market-plaza-standing-water';
    const scarMaterial = new THREE.MeshStandardMaterial({
      color: 0x373b39, roughness: 0.99, metalness: 0,
    });
    const plazaScars = instanced(
      scene, raggedDisc(1, 22, 55049), scarMaterial, [
        [-18.5, 0.062, 29.5, -Math.PI / 2, 0, 0.12, 1.6, 0.72, 1],
        [28.4, 0.062, 3.8, -Math.PI / 2, 0, -0.3, 1.4, 0.65, 1],
        [-27.8, 0.062, -10.2, -Math.PI / 2, 0, 0.2, 1.25, 0.58, 1],
        [13.2, 0.062, -29.4, -Math.PI / 2, 0, -0.08, 1.7, 0.8, 1],
        [1.1, 0.062, 20.2, -Math.PI / 2, 0, 0.15, 0.9, 0.4, 1],
      ], false);
    plazaScars.name = 'market-plaza-impact-scars';

    // Four relief-processing shelters break the stall grid with larger, sagging fabric spans.
    // Their poles sit tight to the perimeter aid pallets and do not enter crowd escape lanes.
    const tarpGeometry = new THREE.PlaneGeometry(1, 1, 5, 4);
    const tarpPositions = tarpGeometry.attributes.position;
    for (let i = 0; i < tarpPositions.count; i++) {
      const x = tarpPositions.getX(i) * 2;
      const y = tarpPositions.getY(i) * 2;
      const edge = Math.min(1, Math.hypot(x, y));
      tarpPositions.setZ(i, -0.1 * (1 - edge));
    }
    tarpPositions.needsUpdate = true;
    tarpGeometry.computeVertexNormals();
    const tarpMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b8b75,
      map: surfaces().fabric.map,
      normalMap: surfaces().fabric.normalMap,
      roughnessMap: surfaces().fabric.roughnessMap,
      normalScale: new THREE.Vector2(0.28, 0.28),
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const tarpSites = [
      [-26, 2.75, 26, -Math.PI / 2, 0, 0.04, 8, 5.8, 1],
      [25.5, 2.75, 25, -Math.PI / 2, 0, -0.05, 7.5, 5.4, 1],
      [-25.5, 2.75, -27, -Math.PI / 2, 0, -0.04, 7.6, 5.5, 1],
      [24, 2.75, -28, -Math.PI / 2, 0, 0.06, 8, 5.8, 1],
    ];
    const tarps = instanced(scene, tarpGeometry, tarpMaterial, tarpSites);
    tarps.name = 'market-aid-shelter-tarps';
    for (let i = 0; i < tarpSites.length; i++) {
      tarps.setColorAt(i, new THREE.Color(
        [0x7d8b82, 0x9a8a68, 0x6e8185, 0x8c785e][i]));
    }
    if (tarps.instanceColor) tarps.instanceColor.needsUpdate = true;
    const shelterPoles = [];
    for (const [x, , z, , , yaw, width, depth] of tarpSites) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lx = sx * (width / 2 - 0.25);
          const lz = sz * (depth / 2 - 0.25);
          shelterPoles.push([
            x + c * lx + s * lz, 1.35, z - s * lx + c * lz,
            0, 0, 0, 1, 2.65, 1,
          ]);
        }
      }
    }
    const poles = instanced(
      scene, new THREE.CylinderGeometry(0.035, 0.045, 1, 8),
      frontline.rebar, shelterPoles);
    poles.name = 'market-aid-shelter-poles';

    // Queue rails, potable-water tanks and directional boards establish an aid operation
    // rather than a decorative bazaar. They remain visual-only and sit beside authored cover.
    const queuePosts = [];
    const queueRails = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        queuePosts.push([side * 18, 0.62, 31 - i * 2.1, 0, 0, 0, 1, 1.2, 1]);
        if (i < 5) {
          queueRails.push([
            side * 18, 0.82, 29.95 - i * 2.1,
            Math.PI / 2, 0, 0, 1, 2.05, 1,
          ]);
        }
      }
    }
    const queuePostBatch = instanced(
      scene, new THREE.CylinderGeometry(0.045, 0.055, 1, 8),
      frontline.barrierSteel, queuePosts);
    queuePostBatch.name = 'market-aid-queue-posts';
    const queueRailBatch = instanced(
      scene, new THREE.CylinderGeometry(0.025, 0.025, 1, 8),
      frontline.barrierSteel, queueRails);
    queueRailBatch.name = 'market-aid-queue-rails';
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x334d56, roughness: 0.62, metalness: 0.1,
    });
    const waterTanks = instanced(
      scene, new THREE.CylinderGeometry(0.72, 0.72, 1.5, 18),
      waterMaterial, [
        [-30.8, 0.78, 24.5, 0, 0, 0, 1, 1, 1],
        [30.4, 0.78, -25.7, 0, 0, 0, 1, 1, 1],
      ]);
    waterTanks.name = 'market-aid-water-tanks';
    const tankBands = instanced(
      scene, new THREE.TorusGeometry(0.74, 0.025, 6, 18),
      frontline.barrierSteel, [
        [-30.8, 0.35, 24.5, Math.PI / 2, 0, 0, 1, 1, 1],
        [-30.8, 1.2, 24.5, Math.PI / 2, 0, 0, 1, 1, 1],
        [30.4, 0.35, -25.7, Math.PI / 2, 0, 0, 1, 1, 1],
        [30.4, 1.2, -25.7, Math.PI / 2, 0, 0, 1, 1, 1],
      ]);
    tankBands.name = 'market-aid-water-tank-bands';
    const aidSignMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: marketAidSignTexture(),
      roughness: 0.8,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    const aidSigns = instanced(
      scene, new THREE.PlaneGeometry(4.6, 1.7),
      aidSignMaterial, [
        [0, 3.9, 37.68, 0, Math.PI, 0, 1, 1, 1],
        [0, 3.9, -37.68, 0, 0, 0, 1, 1, 1],
        [34.68, 3.9, 0, 0, -Math.PI / 2, 0, 1, 1, 1],
        [-34.68, 3.9, 0, 0, Math.PI / 2, 0, 1, 1, 1],
      ], false);
    aidSigns.name = 'market-aid-direction-signs';

    // Paper, torn packaging and localized masonry collect at stall legs and walls instead of
    // being evenly sprinkled. This introduces the aftermath of use and shelling cheaply.
    const paper = [];
    const hardLitter = [];
    for (let i = 0; i < 78; i++) {
      const row = Math.floor(i / 20);
      const side = i % 2 ? -1 : 1;
      const x = side * (8 + (i % 10) * 2.4) + (marketRng() - 0.5) * 1.3;
      const z = 18 - row * 12 + (marketRng() - 0.5) * 2.2;
      paper.push([
        Math.max(-33, Math.min(33, x)), 0.075, z,
        -Math.PI / 2, 0, marketRng() * Math.PI,
        0.65 + marketRng() * 0.75, 0.6 + marketRng() * 0.65, 1,
      ]);
      if (i < 42) {
        hardLitter.push([
          -32 + marketRng() * 64, 0.09 + marketRng() * 0.06, -32 + marketRng() * 64,
          marketRng() * Math.PI, marketRng() * Math.PI, marketRng() * Math.PI,
          0.55 + marketRng(), 0.45 + marketRng() * 0.6, 0.5 + marketRng() * 0.8,
        ]);
      }
    }
    const paperMaterial = new THREE.MeshStandardMaterial({
      color: 0xc9c3af, roughness: 0.98, metalness: 0, side: THREE.DoubleSide,
    });
    const paperBatch = instanced(scene, AID_LABEL_GEO, paperMaterial, paper, false);
    paperBatch.name = 'market-plaza-paper-litter';
    const litterBatch = instanced(
      scene, FINE_RUBBLE_GEO, frontline.concreteDark, hardLitter, false);
    litterBatch.name = 'market-plaza-hard-litter';

    const perimeterRubble = [[], [], []];
    for (let i = 0; i < 54; i++) {
      const wallSide = i % 4;
      const along = -31 + marketRng() * 62;
      const x = wallSide < 2 ? (wallSide ? 33.4 : -33.4) : along;
      const z = wallSide < 2 ? along : (wallSide === 2 ? 33.4 : -33.4);
      perimeterRubble[i % 3].push([
        x, 0.09 + marketRng() * 0.12, z,
        marketRng() * Math.PI, marketRng() * Math.PI, marketRng() * Math.PI,
        0.58 + marketRng() * 0.75, 0.52 + marketRng() * 0.65,
        0.55 + marketRng() * 0.72,
      ]);
    }
    for (let i = 0; i < perimeterRubble.length; i++) {
      const rubble = instanced(
        scene, RUBBLE_GEOMETRIES[i],
        i === 1 ? frontline.brick : frontline.concrete,
        perimeterRubble[i], false);
      rubble.name = `market-perimeter-rubble-${i}`;
    }
  }

  if (levelId === 10) {
    // Two damaged vehicles are still burning, enough motion to establish an active frontline
    // without filling the compound with expensive particle emitters or opaque smoke walls.
    addBurningWreck(scene, -17, -1, 1);
    addBurningWreck(scene, 17, 3, 2);

    // Prepared fallback line outside the compound gate.
    const bags = [];
    for (const side of [-1, 1]) for (let i = 0; i < 9; i++) {
      bags.push([side * (3.2 + i * 0.5), 0.2, 34, 0, 0, Math.PI / 2, 1, 1, 1]);
      if (i < 7) bags.push([side * (3.5 + i * 0.5), 0.48, 34, 0, 0, Math.PI / 2, 1, 1, 1]);
    }
    sandbagInstances(scene, 'frontline-fallback-sandbags', bags);
    addHescoPositions(scene, 'frontline-fallback-hesco', [
      [-14.2, 0.58, 33.5, 0, 0.06, 0, 1.55, 1.14, 0.96],
      [-11.8, 0.58, 33.5, 0, -0.03, 0, 1.55, 1.14, 0.96],
      [11.8, 0.58, 33.5, 0, 0.03, 0, 1.55, 1.14, 0.96],
      [14.2, 0.58, 33.5, 0, -0.06, 0, 1.55, 1.14, 0.96],
    ]);
    addHedgehogs(scene, 'frontline-fallback-hedgehogs', [
      [-16.4, 1.0, 35.1, 0, 0.22, 0, 1, 1, 1],
      [16.4, 1.0, 35.1, 0, -0.22, 0, 1, 1, 1],
    ]);

    // The tower roof is the district fire-control node, not an empty boss arena. Keep the
    // equipment against the east and north parapets so the player retains a clean fighting
    // lane while the launch bench, aircraft, cases and antenna explain what is being held.
    const commandParts = [];
    const commandPart = (source, matrix, color) => {
      const geometry = source.index ? source.toNonIndexed() : source.clone();
      geometry.applyMatrix4(matrix);
      const values = new Float32Array(geometry.attributes.position.count * 3);
      const tint = new THREE.Color(color);
      for (let i = 0; i < geometry.attributes.position.count; i++) {
        values[i * 3] = tint.r;
        values[i * 3 + 1] = tint.g;
        values[i * 3 + 2] = tint.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
      commandParts.push(geometry);
    };
    const commandMatrix = (
      x, y, z, rx, ry, rz, sx, sy, sz,
    ) => new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz),
    );
    const commandBox = new THREE.BoxGeometry(1, 1, 1);
    for (const row of [
      [3.7, 6.78, -13.5, 0, 0, 0, 2.5, 0.12, 1.15],
      [2.65, 6.38, -13.5, 0, 0, 0, 0.11, 0.78, 1.0],
      [4.75, 6.38, -13.5, 0, 0, 0, 0.11, 0.78, 1.0],
    ]) commandPart(commandBox, commandMatrix(...row), 0x6a4d32);
    for (const row of [
      [5.65, 6.34, -12.7, 0, 0.18, 0, 0.9, 0.82, 0.86],
      [5.72, 6.34, -14.0, 0, -0.12, 0, 0.9, 0.82, 0.86],
      [2.15, 6.28, -15.5, 0, 0.08, 0, 0.78, 0.72, 0.76],
    ]) commandPart(EQUIPMENT_CASE_GEO, commandMatrix(...row), 0x252a27);
    const commandDrone = droneModel();
    commandDrone.position.set(3.65, 6.92, -13.45);
    commandDrone.rotation.y = -0.34;
    commandDrone.updateMatrixWorld(true);
    let droneSourceMeshes = 0;
    commandDrone.traverse(object => {
      if (!object.isMesh) return;
      commandPart(
        object.geometry,
        object.matrixWorld,
        object.material?.color || 0x252a27,
      );
      droneSourceMeshes++;
    });
    const mastGeometry = new THREE.CylinderGeometry(0.045, 0.065, 4.4, 8);
    commandPart(
      mastGeometry,
      commandMatrix(6.25, 8.2, -6.1, 0, 0, 0, 1, 1, 1),
      0x4f5758,
    );
    commandPart(
      commandBox,
      commandMatrix(6.25, 9.7, -6.1, 0, 0.42, 0, 0.13, 1.45, 0.52),
      0x252a27,
    );
    const commandGeometry = mergeGeometries(commandParts, false);
    for (const geometry of commandParts) geometry.dispose();
    commandBox.dispose();
    mastGeometry.dispose();
    commandDrone.traverse(object => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material?.dispose();
    });
    commandGeometry.computeBoundingBox();
    commandGeometry.computeBoundingSphere();
    commandGeometry.userData.components = 3 + 3 + droneSourceMeshes + 2;
    commandGeometry.userData.droneSourceMeshes = droneSourceMeshes;
    const commandEquipment = new THREE.Mesh(
      commandGeometry,
      new THREE.MeshStandardMaterial({
        name: 'final-fire-control-layered-equipment',
        vertexColors: true,
        roughness: 0.76,
        metalness: 0.16,
      }));
    commandEquipment.name = 'final-fire-control-equipment-merged';
    commandEquipment.castShadow = commandEquipment.receiveShadow = quality.shadows;
    scene.add(commandEquipment);
    const commandCablePoints = [];
    for (let i = 0; i < 18; i++) {
      const t = i / 17;
      commandCablePoints.push(new THREE.Vector3(
        6.25 - t * 0.75,
        7.45 * (1 - t) + 6.08 * t - Math.sin(t * Math.PI) * 0.28,
        -6.1 - t * 6.4,
      ));
    }
    const commandCable = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(commandCablePoints),
      new THREE.LineBasicMaterial({ color: 0x111315 }));
    commandCable.name = 'final-fire-control-signal-cable';
    scene.add(commandCable);

    // The compound's old municipal wall has been converted into a fighting position. These
    // silhouettes sit above the collision shell and turn the blank slab into a defended gate.
    const timber = frontline.timber.clone();
    timber.color.setHex(0x4f544b);
    timber.roughness = 0.94;
    const roofSteel = frontline.barrierSteel.clone();
    roofSteel.color.setHex(0x30383a);
    roofSteel.roughness = 0.68;
    const char = new THREE.MeshStandardMaterial({
      color: 0x202324, roughness: 1, transparent: true, opacity: 0.76,
    });
    const watchGlass = new THREE.MeshPhysicalMaterial({
      color: 0x69818a,
      roughness: 0.26,
      metalness: 0.04,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      clearcoat: 0.35,
      clearcoatRoughness: 0.24,
    });
    watchGlass.name = 'watch-post-laminated-glass';
    const plywood = frontline.timber.clone();
    plywood.color.setHex(0x806d50);
    plywood.roughness = 0.97;
    const cabinInterior = new THREE.MeshStandardMaterial({
      color: 0x171d1e, roughness: 0.94, metalness: 0.02,
    });
    const lampLens = new THREE.MeshStandardMaterial({
      color: 0xffddb0,
      emissive: 0xff9f48,
      emissiveIntensity: 2.2,
      roughness: 0.3,
      metalness: 0,
    });
    const towerParts = [];
    const towerRoofs = [];
    const towerSupports = [];
    const towerWindows = [];
    const towerFrames = [];
    const towerBraces = [];
    const towerLadders = [];
    const towerRails = [];
    const towerCladding = [];
    const towerSideCladding = [];
    const towerRoofRibs = [];
    const towerPlywoodPatches = [];
    const towerInteriorBacks = [];
    const towerInteriorCounters = [];
    const towerInteriorEquipment = [];
    const towerFloodHousings = [];
    const towerFloodLenses = [];
    const towerCableDrops = [];
    const platformBags = [];
    for (const x of [-8.5, 8.5]) {
      towerParts.push(
        [x, 4.35, 30.25, 0, 0, 0, 4.2, 0.24, 2.35],
        [x, 5.25, 30.75, 0, 0, 0, 4.0, 1.7, 0.14],
        [x - 1.92, 5.15, 30.25, 0, 0, 0, 0.14, 1.9, 2.1],
        [x + 1.92, 5.15, 30.25, 0, 0, 0, 0.14, 1.9, 2.1],
      );
      towerRoofs.push([x, 6.15, 30.25, 0, 0, 0, 1, 1, 1]);
      towerWindows.push([x, 5.35, 30.84, 0, 0, 0, 3.2, 0.64, 0.04]);
      // Narrow front sheets and side panels break the cabin out of the "one scaled cube"
      // silhouette. The textured sheets sit just proud of the collision-independent shell.
      for (const dx of [-1.5, -0.75, 0, 0.75, 1.5]) {
        towerCladding.push(
          [x + dx, 4.68, 30.86, 0, 0, 0, 0.68, 0.42, 0.035],
          [x + dx, 5.92, 30.86, 0, 0, 0, 0.68, 0.28, 0.035],
        );
      }
      for (const side of [-1, 1]) for (const dz of [-0.68, 0, 0.68]) {
        towerSideCladding.push([
          x + side * 1.995, 5.3, 30.22 + dz,
          0, 0, 0, 0.035, 1.45, 0.58,
        ]);
      }
      // A dark back wall, duty shelf and radio shapes give the now-transparent window real
      // parallax. The old opaque blue rectangle had no cabin behind it at all.
      towerInteriorBacks.push([x, 5.3, 29.46, 0, 0, 0, 3.45, 1.42, 0.06]);
      towerInteriorCounters.push([x, 4.9, 30.03, 0, 0, 0, 3.1, 0.12, 0.58]);
      towerInteriorEquipment.push(
        [x - 0.95, 5.13, 29.91, 0, 0.12, 0, 0.42, 0.34, 0.25],
        [x + 0.78, 5.08, 29.93, 0, -0.08, 0, 0.58, 0.24, 0.28],
      );
      for (const z of [28.9, 29.58, 30.26, 30.94, 31.62]) {
        towerRoofRibs.push([x, 6.2, z, 0, 0, 0, 4.82, 0.045, 0.055]);
      }
      // Field repairs differ between posts, preventing mirrored prefabs.
      towerPlywoodPatches.push(
        x < 0
          ? [x - 1.99, 5.3, 30.58, 0, 0, 0.035, 0.045, 0.78, 0.66]
          : [x + 1.99, 5.42, 29.9, 0, 0, -0.045, 0.045, 0.72, 0.58],
      );
      const lightX = x < 0 ? x + 1.28 : x - 1.28;
      towerFloodHousings.push([lightX, 5.94, 31.05, -0.18, 0, 0, 0.48, 0.22, 0.28]);
      towerFloodLenses.push([lightX, 5.9, 31.205, -0.18, 0, 0, 0.36, 0.12, 0.025]);
      towerCableDrops.push([
        x < 0 ? x - 1.78 : x + 1.78, 5.3, 30.88,
        0, 0, 0, 0.025, 1.42, 0.025,
      ]);
      for (const dx of [-1.55, 1.55]) for (const dz of [-0.74, 0.74]) {
        towerSupports.push([x + dx, 2.15, 30.25 + dz, 0, 0, 0, 1, 4.3, 1]);
      }
      // Window surround and central mullion hold their shape against a bright sky.
      towerFrames.push(
        [x, 5.72, 30.88, 0, 0, 0, 3.42, 0.07, 0.07],
        [x, 4.98, 30.88, 0, 0, 0, 3.42, 0.07, 0.07],
        [x - 1.68, 5.35, 30.88, 0, 0, 0, 0.07, 0.82, 0.07],
        [x + 1.68, 5.35, 30.88, 0, 0, 0, 0.07, 0.82, 0.07],
        [x, 5.35, 30.89, 0, 0, 0, 0.06, 0.72, 0.06],
      );
      // X-bracing turns four poles into an engineered firing platform.
      towerBraces.push(
        [x, 2.25, 29.48, 0, 0, 0.9, 4.2, 0.07, 0.08],
        [x, 2.25, 29.46, 0, 0, -0.9, 4.2, 0.07, 0.08],
      );
      const inner = x < 0 ? x + 1.42 : x - 1.42;
      towerLadders.push(
        [inner - 0.22, 2.15, 29.38, 0, 0, 0, 0.055, 4.1, 0.055],
        [inner + 0.22, 2.15, 29.38, 0, 0, 0, 0.055, 4.1, 0.055],
      );
      for (let rung = 0; rung < 10; rung++) {
        towerLadders.push([
          inner, 0.42 + rung * 0.39, 29.36, 0, 0, 0, 0.5, 0.045, 0.055,
        ]);
      }
      for (const side of [-1, 1]) {
        towerRails.push(
          [x + side * 2.02, 4.8, 30.25, 0, 0, 0, 0.055, 0.055, 2.4],
          [x + side * 2.02, 4.62, 29.35, 0, 0, 0, 0.055, 0.72, 0.055],
          [x + side * 2.02, 4.62, 31.15, 0, 0, 0, 0.055, 0.72, 0.055],
        );
      }
      for (let bag = -3; bag <= 3; bag++) {
        platformBags.push([
          x + bag * 0.48, 4.54, 29.18, 0, 0, Math.PI / 2, 1, 1, 1,
        ]);
      }
    }
    const bodies = instanced(scene, new THREE.BoxGeometry(1, 1, 1), timber, towerParts);
    bodies.name = 'watch-post-bodies';
    const roofs = instanced(scene, WATCH_ROOF_GEO, roofSteel, towerRoofs);
    roofs.name = 'watch-post-pitched-roofs';
    const windows = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), watchGlass, towerWindows, false);
    windows.name = 'watch-post-windows';
    const supports = instanced(
      scene, new THREE.CylinderGeometry(0.075, 0.1, 1, 8), steel, towerSupports);
    supports.name = 'watch-post-supports';
    const frames = instanced(scene, new THREE.BoxGeometry(1, 1, 1), steel, towerFrames);
    frames.name = 'watch-post-window-frames';
    const braces = instanced(scene, new THREE.BoxGeometry(1, 1, 1), steel, towerBraces);
    braces.name = 'watch-post-cross-braces';
    const ladders = instanced(scene, new THREE.BoxGeometry(1, 1, 1), steel, towerLadders);
    ladders.name = 'watch-post-ladders';
    const rails = instanced(scene, new THREE.BoxGeometry(1, 1, 1), steel, towerRails);
    rails.name = 'watch-post-rails';
    const cladding = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), timber, towerCladding);
    cladding.name = 'watch-post-front-cladding';
    const sideCladding = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), timber, towerSideCladding);
    sideCladding.name = 'watch-post-side-cladding';
    const roofRibs = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), roofSteel, towerRoofRibs);
    roofRibs.name = 'watch-post-roof-ribs';
    const patchPanels = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), plywood, towerPlywoodPatches);
    patchPanels.name = 'watch-post-plywood-repairs';
    const interiorBacks = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), cabinInterior, towerInteriorBacks, false);
    interiorBacks.name = 'watch-post-interior-backs';
    const interiorCounters = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), timber, towerInteriorCounters);
    interiorCounters.name = 'watch-post-interior-counters';
    const interiorEquipment = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), frontline.equipment,
      towerInteriorEquipment);
    interiorEquipment.name = 'watch-post-interior-equipment';
    const floodHousings = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), steel, towerFloodHousings);
    floodHousings.name = 'watch-post-floodlight-housings';
    const floodLenses = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), lampLens, towerFloodLenses, false);
    floodLenses.name = 'watch-post-floodlight-lenses';
    const cableDrops = instanced(
      scene, new THREE.CylinderGeometry(0.5, 0.5, 1, 7),
      cabinInterior, towerCableDrops, false);
    cableDrops.name = 'watch-post-cable-drops';
    sandbagInstances(scene, 'watch-post-sandbags', platformBags);

    // Segment the municipal wall into repaired blast bays. Its original collision mesh stays
    // authoritative, but a cap, piers, damaged gate returns and concertina wire stop the
    // sixty-metre surface reading as one pristine primitive.
    const gatePiers = [];
    const gateCaps = [];
    const gateWire = [];
    const gatePanelsA = [];
    const gatePanelsB = [];
    const panelSpans = [
      [-28, 3.8], [-23, 5.8], [-17, 5.8], [-11, 5.8], [-5.5, 4.7],
      [5.5, 4.7], [11, 5.8], [17, 5.8], [23, 5.8], [28, 3.8],
    ];
    panelSpans.forEach(([x, width], index) => {
      (index % 2 ? gatePanelsA : gatePanelsB).push([
        x, 2.0, 30.215, 0, 0, 0, width, 3.74, 0.055,
      ]);
    });
    for (const x of [-26, -20, -14, -8, 8, 14, 20, 26]) {
      gatePiers.push([x, 2.0, 30.28, 0, 0, 0, 0.34, 3.86, 0.48]);
    }
    for (const [start, end] of [[-29.6, -3.4], [3.4, 29.6]]) {
      for (let x = start + 1.1; x < end; x += 2.2) {
        gateCaps.push([x, 4.08, 30.08, 0, 0, (x % 4.4) * 0.003, 2.08, 0.18, 0.72]);
      }
      for (let x = start + 0.5; x < end; x += 0.62) {
        gateWire.push([x, 4.55, 30.06, 0, 0, 0, 0.54, 0.54, 0.54]);
      }
    }
    const gatePierMesh = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), frontline.concreteDark, gatePiers);
    gatePierMesh.name = 'fortified-gate-repair-piers';
    const panelMaterialA = frontline.concrete.clone();
    panelMaterialA.color.setHex(0x85867f);
    const panelMaterialB = frontline.concrete.clone();
    panelMaterialB.color.setHex(0x747872);
    const gatePanelMeshA = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), panelMaterialA, gatePanelsA);
    gatePanelMeshA.name = 'fortified-gate-wall-panels-a';
    const gatePanelMeshB = instanced(
      scene, new THREE.BoxGeometry(1, 1, 1), panelMaterialB, gatePanelsB);
    gatePanelMeshB.name = 'fortified-gate-wall-panels-b';
    const gateCapMesh = instanced(
      scene, distressedBoxGeometry(1, 1, 1, 1088), frontline.concrete,
      gateCaps);
    gateCapMesh.name = 'fortified-gate-broken-caps';
    const gateWireMesh = instanced(
      scene, new THREE.TorusGeometry(1, 0.025, 5, 16), steel, gateWire, false);
    gateWireMesh.name = 'fortified-gate-concertina';

    const gateReturns = [];
    const gateRebar = [];
    const edgeHeights = [0.48, 1.42, 2.52];
    for (const side of [-1, 1]) {
      for (let i = 0; i < edgeHeights.length; i++) {
        gateReturns.push([
          side * (3.11 + ((i * 7) % 2) * 0.07),
          edgeHeights[i],
          30.24 + ((i * 3) % 4) * 0.035,
          i * 0.17,
          side * (0.04 + (i % 2) * 0.06),
          side * (-0.09 + i * 0.035),
          0.36 + (i % 3) * 0.08,
          0.32 + (i % 2) * 0.1,
          0.24 + (i % 3) * 0.055,
        ]);
      }
      for (let i = 0; i < 4; i++) {
        gateRebar.push([
          side * (2.72 + (i % 2) * 0.08),
          0.74 + i * 0.63,
          30.31 + (i % 2) * 0.06,
          0,
          0,
          Math.PI / 2 + side * (i - 1.5) * 0.035,
          1,
          0.74 + (i % 3) * 0.18,
          1,
        ]);
      }
    }
    const gateReturnMesh = instanced(
      scene, distressedBoxGeometry(1, 1, 1, 1093), frontline.concreteDark,
      gateReturns);
    gateReturnMesh.name = 'fortified-gate-broken-returns';
    const gateRebarMesh = instanced(
      scene, new THREE.CylinderGeometry(0.035, 0.045, 1, 7),
      frontline.rebar, gateRebar);
    gateRebarMesh.name = 'fortified-gate-exposed-rebar';

    const sectorSignMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: fortifiedGateSectorTexture(),
      roughness: 0.72,
      metalness: 0.12,
      side: THREE.DoubleSide,
    });
    const sectorSign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 2.2), sectorSignMaterial);
    sectorSign.name = 'fortified-gate-sector-sign';
    sectorSign.position.set(-17, 2.2, 30.52);
    sectorSign.castShadow = quality.shadows;
    scene.add(sectorSign);

    const gateImpacts = [];
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? -1 : 1;
      gateImpacts.push([
        side * (7.2 + (i % 6) * 3.15),
        0.8 + ((i * 7) % 11) * 0.23,
        30.535,
        0,
        0,
        (i - 5) * 0.08,
        0.16 + (i % 3) * 0.06,
        0.14 + (i % 4) * 0.04,
        1,
      ]);
    }
    const impactMesh = instanced(
      scene, raggedDisc(1, 14, 1097), char, gateImpacts, false);
    impactMesh.name = 'fortified-gate-impact-scars';

    const gateScars = [
      [-12.5, 2.1, 30.21, 0, 0, -0.2, 0.86, 0.7, 1],
      [15.8, 2.55, 30.21, 0, 0, 0.12, 0.82, 0.7, 1],
    ];
    instanced(scene, raggedDisc(1, 18, 1091), char, gateScars, false);

    const gateRubble = [];
    for (let i = 0; i < 28; i++) {
      const side = i % 2 ? -1 : 1;
      gateRubble.push([
        side * (3.3 + (i % 7) * 0.32), 0.08 + (i % 3) * 0.055,
        29.2 + ((i * 7) % 9) * 0.15,
        i * 0.31, i * 0.17, i * 0.23,
        0.42 + (i % 4) * 0.12, 0.28 + (i % 3) * 0.11, 0.38 + (i % 5) * 0.08,
      ]);
    }
    for (let i = 0; i < RUBBLE_GEOMETRIES.length; i++) {
      const subset = gateRubble.filter((_, index) => index % RUBBLE_GEOMETRIES.length === i);
      const rubble = instanced(scene, RUBBLE_GEOMETRIES[i],
        i === 1 ? frontline.brick : i === 2 ? frontline.concreteDark : frontline.concrete,
        subset, false);
      rubble.name = `watch-post-gate-rubble-${i}`;
    }
  }
}
