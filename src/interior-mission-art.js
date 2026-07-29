// Desktop-only authored dressing for the two enclosed campaign environments.
//
// Missions 08 and 09 deliberately keep their original box collision and navigation. This
// layer supplies the ceiling services, furniture, track hardware, platform language and
// readable lighting that make those boxes feel like places rather than grey test chambers.
import * as THREE from 'three';
import { quality } from './quality.js';
import { photoSurfaces, surfaces } from './textures.js';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const PIPE = new THREE.CylinderGeometry(0.065, 0.065, 1, 12);
const SMALL_PIPE = new THREE.CylinderGeometry(0.032, 0.032, 1, 10);
const CHAIR_PAD = new THREE.CapsuleGeometry(0.22, 0.38, 4, 10);
const CHAIR_LEG = new THREE.CylinderGeometry(0.025, 0.025, 1, 8);
const CASTER = new THREE.SphereGeometry(0.04, 8, 5);
const MONITOR_BASE = new THREE.CylinderGeometry(0.19, 0.23, 0.035, 16);
const LED = new THREE.SphereGeometry(0.018, 8, 5);
const PLATFORM_STUD = new THREE.CylinderGeometry(0.055, 0.055, 0.018, 10);
const CABLE = new THREE.CylinderGeometry(0.018, 0.018, 1, 7);
const TRAIN_SIDE_DECAL = new THREE.PlaneGeometry(1, 1);
const METRO_WHEEL = new THREE.CylinderGeometry(0.38, 0.38, 0.18, 18);
const METRO_CAR_SHELL = (() => {
  // One softly bevelled extrusion replaces the usual stack of cuboids. The asymmetric
  // shoulders and rolled roof are enough to read as a rail car even before the doors,
  // glazing, bogies and route furniture are applied.
  const profile = new THREE.Shape();
  profile.moveTo(-2.08, -1.18);
  profile.lineTo(2.08, -1.18);
  profile.lineTo(2.12, 0.96);
  profile.quadraticCurveTo(2.08, 1.4, 1.62, 1.66);
  profile.quadraticCurveTo(0, 1.95, -1.62, 1.66);
  profile.quadraticCurveTo(-2.08, 1.4, -2.12, 0.96);
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: 24,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.07,
    bevelThickness: 0.07,
    curveSegments: 6,
  });
  geometry.translate(0, 0, -12);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
})();
const PAPER = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.48, -0.35);
  shape.lineTo(0.44, -0.39);
  shape.lineTo(0.5, 0.31);
  shape.lineTo(0.1, 0.38);
  shape.lineTo(-0.46, 0.27);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
})();

const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempEuler = new THREE.Euler();
const tempMatrix = new THREE.Matrix4();

function matrix(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  tempPosition.set(x, y, z);
  tempEuler.set(rx, ry, rz);
  tempQuaternion.setFromEuler(tempEuler);
  tempScale.set(sx, sy, sz);
  return tempMatrix.compose(tempPosition, tempQuaternion, tempScale).clone();
}

class Batches {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
  }

  add(name, geometry, material, transform, shadows = false) {
    let batch = this.items.get(name);
    if (!batch) {
      batch = { geometry, material, transforms: [], shadows };
      this.items.set(name, batch);
    }
    batch.transforms.push(transform);
  }

  flush() {
    const stats = {};
    for (const [name, batch] of this.items) {
      const out = new THREE.InstancedMesh(
        batch.geometry, batch.material, batch.transforms.length);
      out.name = name;
      out.userData.instanceCount = batch.transforms.length;
      for (let i = 0; i < batch.transforms.length; i++) {
        out.setMatrixAt(i, batch.transforms[i]);
      }
      out.instanceMatrix.needsUpdate = true;
      out.castShadow = batch.shadows && quality.shadows;
      out.receiveShadow = quality.shadows;
      out.frustumCulled = true;
      this.scene.add(out);
      stats[name] = batch.transforms.length;
    }
    return stats;
  }
}

function standard(color, roughness = 0.75, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function concreteMaterial(color = 0x8a8d88) {
  const photo = photoSurfaces()?.concrete;
  return new THREE.MeshStandardMaterial({
    color,
    map: photo?.map || null,
    normalMap: photo?.normalMap || null,
    roughnessMap: photo?.roughnessMap || null,
    normalScale: new THREE.Vector2(0.38, 0.38),
    roughness: 0.92,
    metalness: 0.01,
  });
}

function signTexture(title, subtitle, accent = '#d8b545') {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#172027';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 22, canvas.height);
  ctx.fillRect(0, canvas.height - 16, canvas.width, 16);
  ctx.fillStyle = '#d8dde0';
  ctx.font = '700 70px Arial, sans-serif';
  ctx.fillText(title, 58, 112);
  ctx.fillStyle = '#8f9ba2';
  ctx.font = '36px Arial, sans-serif';
  ctx.fillText(subtitle, 60, 181);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function grimeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const rng = (() => {
    let state = 0x51a7d00d;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
  })();
  ctx.clearRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    const x = rng() * 512;
    const y = rng() * 512;
    const radius = 8 + rng() * 64;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const warm = rng() > 0.56;
    gradient.addColorStop(0, warm ? 'rgba(64,43,27,.2)' : 'rgba(17,24,24,.2)');
    gradient.addColorStop(0.55, warm ? 'rgba(50,35,25,.08)' : 'rgba(12,18,18,.08)');
    gradient.addColorStop(1, 'rgba(10,14,14,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let i = 0; i < 24; i++) {
    ctx.strokeStyle = `rgba(18,22,21,${0.03 + rng() * 0.06})`;
    ctx.lineWidth = 1 + rng() * 4;
    const x = rng() * 512;
    ctx.beginPath();
    ctx.moveTo(x, rng() * 120);
    ctx.bezierCurveTo(
      x + (rng() - 0.5) * 34, 180,
      x + (rng() - 0.5) * 54, 330,
      x + (rng() - 0.5) * 70, 512,
    );
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function tacticalMapTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#15201f';
  ctx.fillRect(0, 0, 768, 512);
  ctx.strokeStyle = 'rgba(114,151,136,.16)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 768; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
  }
  for (let y = 0; y <= 512; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(768, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(131,157,124,.4)';
  ctx.lineWidth = 3;
  for (let row = 0; row < 7; row++) {
    ctx.beginPath();
    for (let x = 0; x <= 768; x += 16) {
      const y = 64 + row * 61
        + Math.sin(x * 0.018 + row * 1.7) * (13 + row * 1.5)
        + Math.sin(x * 0.043 - row) * 7;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#b44b3f';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(42, 410);
  ctx.bezierCurveTo(190, 360, 300, 420, 430, 300);
  ctx.bezierCurveTo(520, 220, 610, 246, 724, 108);
  ctx.stroke();
  ctx.strokeStyle = '#caa84d';
  ctx.lineWidth = 4;
  ctx.setLineDash([15, 10]);
  ctx.beginPath();
  ctx.moveTo(84, 74);
  ctx.bezierCurveTo(244, 160, 360, 110, 494, 210);
  ctx.bezierCurveTo(590, 278, 640, 340, 714, 440);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#d7ddd7';
  ctx.font = '700 24px Arial, sans-serif';
  ctx.fillText('SECTOR EAST // FIRE CONTROL', 28, 38);
  ctx.fillStyle = '#849990';
  ctx.font = '18px monospace';
  ctx.fillText('DRONE CORRIDORS / BATTERY ROUTES', 29, 485);
  for (const [x, y, color] of [
    [170, 325, '#d9ad45'], [390, 286, '#d9ad45'], [555, 195, '#b94c43'],
    [640, 320, '#b94c43'],
  ]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function spectrumTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#071613';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = 'rgba(83,190,136,.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 512; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
  }
  for (let y = 0; y <= 256; y += 32) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }
  ctx.strokeStyle = '#63e2a0';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let x = 0; x <= 512; x += 4) {
    const carrier = (
      Math.exp(-Math.pow((x - 138) / 21, 2)) * 62
      + Math.exp(-Math.pow((x - 326) / 13, 2)) * 92
      + Math.exp(-Math.pow((x - 411) / 28, 2)) * 48
    );
    const noise = Math.sin(x * 0.19) * 5 + Math.sin(x * 0.47) * 2;
    const y = 205 - carrier - noise;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#9bf0c1';
  ctx.font = '700 24px monospace';
  ctx.fillText('RF DENIAL // CH 04', 18, 30);
  ctx.fillStyle = '#5ba984';
  ctx.font = '18px monospace';
  ctx.fillText('433.8       915.2       2.4G', 18, 242);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function addSign(scene, name, title, subtitle, position, rotationY = 0, width = 3.6,
  accent = '#d8b545') {
  const material = new THREE.MeshBasicMaterial({
    map: signTexture(title, subtitle, accent),
    side: THREE.FrontSide,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 3), material);
  sign.name = name;
  sign.position.fromArray(position);
  sign.rotation.y = rotationY;
  scene.add(sign);
}

function addOfficeChair(b, x, z, yaw, mats) {
  b.add('records-chair-seats', CHAIR_PAD, mats.fabric,
    matrix(x, 0.53, z, 1.25, 0.34, 1.05, Math.PI / 2, yaw, 0));
  b.add('records-chair-backs', CHAIR_PAD, mats.fabric,
    matrix(x + Math.sin(yaw) * 0.38, 0.92, z + Math.cos(yaw) * 0.38,
      1.2, 0.32, 1.45, 0, yaw, Math.PI / 2));
  b.add('records-chair-legs', CHAIR_LEG, mats.darkMetal,
    matrix(x, 0.28, z, 1, 0.42, 1));
  for (let i = 0; i < 5; i++) {
    const a = yaw + i * Math.PI * 2 / 5;
    const lx = x + Math.sin(a) * 0.28;
    const lz = z + Math.cos(a) * 0.28;
    b.add('records-chair-legs', CHAIR_LEG, mats.darkMetal,
      matrix((x + lx) / 2, 0.14, (z + lz) / 2, 1, 0.3, 1,
        Math.PI / 2, 0, -a));
    b.add('records-chair-casters', CASTER, mats.rubber, matrix(lx, 0.08, lz));
  }
}

function addMonitor(b, x, z, yaw, mats, broken = false) {
  b.add('records-monitor-stands', SMALL_PIPE, mats.darkMetal,
    matrix(x, 0.96, z, 1, 0.34, 1));
  b.add('records-monitor-bases', MONITOR_BASE, mats.darkMetal,
    matrix(x, 0.795, z, 1, 1, 1));
  const dx = Math.sin(yaw) * 0.03;
  const dz = Math.cos(yaw) * 0.03;
  b.add('records-monitor-cases', UNIT_BOX, mats.darkMetal,
    matrix(x, 1.18, z, 0.78, 0.5, 0.08, 0, yaw, broken ? -0.08 : 0));
  b.add('records-monitor-screens', UNIT_BOX, broken ? mats.deadScreen : mats.screen,
    matrix(x - dx, 1.18, z - dz, 0.69, 0.41, 0.012, 0, yaw, broken ? -0.08 : 0));
}

function addOfficeDesk(b, x, z, yaw, mats, index) {
  // The old visible desk was its collision volume: a 2.2 × 0.9 × 1.1 solid block. Keep that
  // invisible body authoritative, then reconstruct the furniture around the same footprint.
  b.add('records-desk-tops', UNIT_BOX, mats.deskTop,
    matrix(x, 0.84, z, 2.2, 0.11, 1.1, 0, yaw));
  b.add('records-desk-edge-bands', UNIT_BOX, mats.deskEdge,
    matrix(x, 0.79, z - Math.cos(yaw) * 0.54, 2.18, 0.12, 0.055, 0, yaw));

  const drawerSide = index % 2 ? -1 : 1;
  const sideX = x + Math.cos(yaw) * drawerSide * 0.72;
  const sideZ = z - Math.sin(yaw) * drawerSide * 0.72;
  b.add('records-desk-pedestals', UNIT_BOX, mats.cabinet,
    matrix(sideX, 0.41, sideZ, 0.48, 0.72, 0.68, 0, yaw));
  for (const y of [0.24, 0.43, 0.62]) {
    b.add('records-desk-drawer-handles', UNIT_BOX, mats.darkMetal,
      matrix(
        sideX - Math.sin(yaw) * 0.35, y,
        sideZ - Math.cos(yaw) * 0.35,
        0.2, 0.025, 0.025, 0, yaw,
      ));
  }

  // The open side gets two square tube legs and a modesty rail, leaving real negative space.
  const openX = x - Math.cos(yaw) * drawerSide * 0.78;
  const openZ = z + Math.sin(yaw) * drawerSide * 0.78;
  for (const depth of [-0.42, 0.42]) {
    b.add('records-desk-legs', UNIT_BOX, mats.darkMetal,
      matrix(
        openX + Math.sin(yaw) * depth, 0.4,
        openZ + Math.cos(yaw) * depth,
        0.055, 0.75, 0.055, 0, yaw,
      ));
  }
  b.add('records-desk-modesty-rails', UNIT_BOX, mats.darkMetal,
    matrix(
      x + Math.sin(yaw) * 0.39, 0.48,
      z + Math.cos(yaw) * 0.39,
      1.45, 0.055, 0.055, 0, yaw,
    ));
}

function addPartitionSegment(b, x1, z1, x2, z2, mats) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 0.25) return;
  const yaw = Math.atan2(-dz, dx);
  const x = (x1 + x2) / 2;
  const z = (z1 + z2) / 2;
  for (const y of [0.09, 1.08, 2.83]) {
    b.add('records-partition-rails', UNIT_BOX, mats.partitionFrame,
      matrix(x, y, z, len, y === 1.08 ? 0.055 : 0.09, 0.16, 0, yaw));
  }
  const mullions = Math.max(1, Math.floor(len / 2.25));
  for (let i = 0; i <= mullions; i++) {
    const t = i / mullions;
    b.add('records-partition-mullions', UNIT_BOX, mats.partitionFrame,
      matrix(x1 + dx * t, 1.46, z1 + dz * t, 0.07, 2.75, 0.18, 0, yaw));
  }
}

function addRecordsOffice(scene) {
  const b = new Batches(scene);
  const mats = {
    ceiling: standard(0x777d7b, 0.94, 0.01),
    ceilingGap: standard(0x111719, 1, 0),
    frame: standard(0x40494c, 0.58, 0.46),
    galvanized: standard(0x6c7778, 0.47, 0.62),
    darkMetal: standard(0x20282b, 0.62, 0.5),
    rubber: standard(0x111516, 0.96, 0),
    fabric: standard(0x303b3c, 0.94, 0),
    screen: standard(0x142a28, 0.28, 0.08),
    deadScreen: standard(0x111516, 0.92, 0),
    cabinet: standard(0x596466, 0.72, 0.38),
    paper: standard(0xc2beb0, 0.96, 0),
    cable: standard(0x171b1c, 0.88, 0.05),
    rack: standard(0x242c2f, 0.48, 0.62),
    rackFace: standard(0x0e1416, 0.7, 0.4),
    greenLed: new THREE.MeshBasicMaterial({ color: 0x4cd68a }),
    amberLed: new THREE.MeshBasicMaterial({ color: 0xe0a148 }),
    deskTop: standard(0x777066, 0.82, 0.04),
    deskEdge: standard(0x383e3f, 0.68, 0.34),
    partitionFrame: standard(0x273235, 0.52, 0.62),
    archiveBox: standard(0x8b8069, 0.94, 0),
    archiveLabel: new THREE.MeshBasicMaterial({ color: 0xb4afa0 }),
    jammer: standard(0x242d2c, 0.58, 0.42),
    jammerScreen: new THREE.MeshBasicMaterial({
      color: 0xffffff, map: spectrumTexture(),
    }),
    floorGrime: new THREE.MeshBasicMaterial({
      map: grimeTexture(), transparent: true, opacity: 0.42,
      depthWrite: false, color: 0x35433b,
    }),
  };

  // A suspended grid gives the low office ceiling scale. Missing tiles and sagged panels
  // make the blackout space read as damaged rather than merely unlit.
  for (let x = -14; x <= 14; x += 4) {
    b.add('records-ceiling-grid', UNIT_BOX, mats.frame, matrix(x, 2.91, 0, 0.035, 0.045, 39));
  }
  for (let z = -18; z <= 18; z += 4) {
    b.add('records-ceiling-grid', UNIT_BOX, mats.frame, matrix(0, 2.91, z, 29, 0.045, 0.035));
  }
  for (const [x, z, rz] of [
    [-11.8, 16, 0.03], [-3.8, 12, -0.08], [8.2, 16, 0],
    [-11.8, 0, 0.06], [4.2, 0, -0.04], [12.2, -4, 0],
    [-7.8, -12, 0.09], [0.2, -16, -0.06], [8.2, -16, 0],
  ]) {
    b.add('records-ceiling-tiles', UNIT_BOX, mats.ceiling,
      matrix(x, 2.885, z, 3.84, 0.055, 3.84, 0, 0, rz));
  }
  for (const [x, z] of [[-7.8, 16], [4.2, 12], [-3.8, -8], [12.2, -12]]) {
    b.add('records-missing-ceiling-tiles', UNIT_BOX, mats.ceilingGap,
      matrix(x, 2.875, z, 3.76, 0.025, 3.76));
  }

  // Main cable tray and smaller branch conduits run continuously through the maze. Their
  // repeated brackets are cheap instances but make the ceiling legible from every doorway.
  b.add('records-cable-trays', UNIT_BOX, mats.galvanized,
    matrix(0, 2.67, 0, 0.72, 0.08, 37));
  for (let z = -17; z <= 17; z += 2) {
    b.add('records-cable-tray-rungs', UNIT_BOX, mats.galvanized,
      matrix(0, 2.61, z, 0.84, 0.035, 0.045));
  }
  for (const x of [-10, 10]) {
    b.add('records-conduits', SMALL_PIPE, mats.galvanized,
      matrix(x, 2.7, 0, 1, 37, 1, Math.PI / 2));
  }
  for (const [x, z, len] of [[-6, 12, 6], [6, 8, 8], [-8, -4, 10], [8, -8, 9]]) {
    b.add('records-hanging-cables', CABLE, mats.cable,
      matrix(x, 2.48, z, 1, len, 1, Math.PI / 2, 0, Math.PI / 2));
  }

  // Replace the opaque-looking partition blocks with transparent architectural glass and
  // explicit metal framing. Each segment mirrors the original wall helper's solid pieces, so
  // doorway gaps remain visually and physically aligned.
  for (const segment of [
    [-15, 10, -3, 10], [-1, 10, 2, 10], [6, 10, 15, 10],
    [-6, 10, -6, 4], [-6, 2, -6, -2], [6, 10, 6, -6],
    [-15, -2, -10, -2], [-6, -2, 2, -2], [4, -2, 10, -2],
    [-2, -2, -2, -14], [6, -6, 9, -6], [11, -6, 15, -6],
    [-15, -14, -11, -14], [-9, -14, -2, -14],
    [4, -14, 9, -14], [11, -14, 15, -14],
  ]) {
    addPartitionSegment(b, ...segment, mats);
  }

  const desks = [
    [-10, 5, Math.PI], [0, 6, Math.PI], [10, 4, Math.PI],
    [-10, -8, 0], [10, -10, 0], [2, -10, 0], [-8, -17, 0], [8, -17, 0],
  ];
  desks.forEach(([x, z, yaw], i) => {
    addOfficeDesk(b, x, z, yaw, mats, i);
    addOfficeChair(b, x + Math.sin(yaw) * 1.05, z + Math.cos(yaw) * 1.05,
      yaw + Math.PI, mats);
    addMonitor(b, x, z, yaw, mats, i === 3 || i === 6);
  });

  // Filing banks and server cabinets hug walls so they preserve the original combat lanes.
  for (const [x, z, yaw] of [
    [-13.9, 14, Math.PI / 2], [-13.9, 6, Math.PI / 2],
    [13.9, 2, -Math.PI / 2], [13.9, -10, -Math.PI / 2],
  ]) {
    b.add('records-file-cabinets', UNIT_BOX, mats.cabinet,
      matrix(x, 0.72, z, 0.56, 1.44, 1.3, 0, yaw));
    for (const y of [0.35, 0.72, 1.09]) {
      b.add('records-cabinet-handles', UNIT_BOX, mats.darkMetal,
        matrix(x - Math.sin(yaw) * 0.3, y, z - Math.cos(yaw) * 0.3,
          0.18, 0.025, 0.025, 0, yaw));
    }
  }
  for (const x of [-10.5, -7.5, 7.5, 10.5]) {
    b.add('records-server-racks', UNIT_BOX, mats.rack,
      matrix(x, 1.05, -19.15, 1.15, 2.1, 0.62));
    b.add('records-server-faces', UNIT_BOX, mats.rackFace,
      matrix(x, 1.05, -18.825, 1.02, 1.94, 0.025));
    for (let y = 0.25; y < 1.9; y += 0.22) {
      b.add('records-server-slots', UNIT_BOX, mats.galvanized,
        matrix(x, y, -18.805, 0.86, 0.035, 0.016));
    }
    for (let y = 0.34; y < 1.9; y += 0.44) {
      b.add('records-server-led-green', LED, mats.greenLed,
        matrix(x + 0.39, y, -18.77));
      b.add('records-server-led-amber', LED, mats.amberLed,
        matrix(x + 0.31, y, -18.77));
    }
  }

  // Dense archive shelving provides an unmistakable records-office zone along the west wall.
  // The shelves are shallow and outside the central sweep lane.
  for (const z of [-5.0, -8.2, -11.4]) {
    for (const x of [-14.35, -12.95]) {
      b.add('records-archive-uprights', UNIT_BOX, mats.darkMetal,
        matrix(x, 1.12, z - 1.15, 0.07, 2.24, 0.07));
      b.add('records-archive-uprights', UNIT_BOX, mats.darkMetal,
        matrix(x, 1.12, z + 1.15, 0.07, 2.24, 0.07));
    }
    for (const y of [0.14, 0.65, 1.16, 1.67, 2.18]) {
      b.add('records-archive-shelves', UNIT_BOX, mats.galvanized,
        matrix(-13.65, y, z, 1.48, 0.055, 2.38));
    }
    for (let row = 0; row < 4; row++) {
      const y = 0.37 + row * 0.51;
      for (let slot = 0; slot < 4; slot++) {
        const boxZ = z - 0.83 + slot * 0.56;
        b.add('records-archive-boxes', UNIT_BOX, mats.archiveBox,
          matrix(-13.63, y, boxZ, 1.17, 0.38, 0.48, 0, 0, (slot - 1.5) * 0.015));
        b.add('records-archive-labels', UNIT_BOX, mats.archiveLabel,
          matrix(-13.025, y, boxZ, 0.012, 0.14, 0.2));
      }
    }
  }

  // The mission objective now has a physical identity: a mobile jammer/control rack between
  // the surviving server banks, with antenna whips and an active spectrum display.
  b.add('records-jammer-body', UNIT_BOX, mats.jammer,
    matrix(0, 0.92, -19.12, 2.15, 1.82, 0.78));
  b.add('records-jammer-face', UNIT_BOX, mats.rackFace,
    matrix(0, 0.94, -18.71, 1.94, 1.58, 0.035));
  b.add('records-jammer-screen', UNIT_BOX, mats.jammerScreen,
    matrix(-0.36, 1.22, -18.68, 0.86, 0.45, 0.018));
  for (let i = 0; i < 6; i++) {
    b.add('records-jammer-controls', LED,
      i % 3 ? mats.greenLed : mats.amberLed,
      matrix(0.44 + (i % 2) * 0.22, 0.74 + Math.floor(i / 2) * 0.2, -18.66,
        1.35, 1.35, 1.35));
  }
  for (let i = 0; i < 6; i++) {
    b.add('records-jammer-vents', UNIT_BOX, mats.galvanized,
      matrix(0.56, 1.37 - i * 0.13, -18.675, 0.58, 0.028, 0.014));
  }
  for (const x of [-0.93, 0.93]) {
    b.add('records-jammer-handles', UNIT_BOX, mats.darkMetal,
      matrix(x, 1.38, -18.63, 0.08, 0.42, 0.08));
  }
  for (const x of [-0.72, 0.72]) {
    b.add('records-jammer-antennas', SMALL_PIPE, mats.darkMetal,
      matrix(x, 2.05, -19.1, 1.15, 1.65, 1.15, 0, 0, x * 0.08));
  }
  b.add('records-jammer-crossbar', UNIT_BOX, mats.darkMetal,
    matrix(0, 2.48, -19.1, 1.8, 0.055, 0.055));
  for (const [x, length] of [[-2.2, 3.2], [2.2, 3.2]]) {
    b.add('records-jammer-floor-cables', CABLE, mats.cable,
      matrix(x / 2, 0.045, -18.92, 1.35, length, 1.35, 0, 0, Math.PI / 2));
  }

  // Damage and traffic staining bind the furniture to the floor instead of leaving every
  // object on pristine concrete.
  const grimePlane = new THREE.PlaneGeometry(1, 1);
  for (const [x, z, sx, sz, rz] of [
    [0, 14, 5.2, 7.0, 0.08], [-8.5, 2, 5.8, 7.5, -0.12],
    [7.5, -5, 6.6, 7.2, 0.16], [0, -15.8, 8.5, 5.4, -0.05],
  ]) {
    b.add('records-floor-grime', grimePlane, mats.floorGrime,
      matrix(x, 0.027, z, sx, sz, 1, -Math.PI / 2, 0, rz));
  }
  for (const [x, z, rx, rz] of [
    [-8.2, 15.6, 0.18, -0.12], [4.4, 11.8, -0.24, 0.09],
    [-3.6, -7.8, 0.32, -0.08], [12.0, -11.8, -0.18, 0.15],
  ]) {
    b.add('records-dangling-ceiling-panels', UNIT_BOX, mats.ceiling,
      matrix(x, 2.54, z, 3.55, 0.055, 3.55, rx, 0, rz));
  }

  // Entry frame and floor debris establish the threshold before the first contact.
  b.add('records-entry-frame', UNIT_BOX, mats.darkMetal, matrix(-1.58, 1.35, 19.82, 0.12, 2.7, 0.22));
  b.add('records-entry-frame', UNIT_BOX, mats.darkMetal, matrix(1.58, 1.35, 19.82, 0.12, 2.7, 0.22));
  b.add('records-entry-frame', UNIT_BOX, mats.darkMetal, matrix(0, 2.72, 19.82, 3.28, 0.12, 0.22));
  for (const x of [-1.2, 0, 1.2]) {
    b.add('records-vestibule-bench-slats', UNIT_BOX, mats.deskTop,
      matrix(x, 0.52, 27.75, 1.12, 0.09, 0.48));
    b.add('records-vestibule-bench-slats', UNIT_BOX, mats.deskTop,
      matrix(x, 0.93, 28.0, 1.12, 0.48, 0.09));
  }
  for (const x of [-1.55, 1.55]) {
    b.add('records-vestibule-bench-legs', UNIT_BOX, mats.darkMetal,
      matrix(x, 0.27, 27.75, 0.06, 0.47, 0.36));
  }
  b.add('records-vestibule-locker', UNIT_BOX, mats.cabinet,
    matrix(3.72, 1.08, 26.3, 0.42, 1.72, 0.95));
  b.add('records-vestibule-locker-door', UNIT_BOX, mats.darkMetal,
    matrix(3.49, 1.08, 26.3, 0.025, 1.56, 0.82));
  for (let i = 0; i < 4; i++) {
    b.add('records-vestibule-hooks', SMALL_PIPE, mats.darkMetal,
      matrix(-3.84, 1.62, 22.2 + i * 1.42, 1, 0.22, 1, 0, 0, Math.PI / 2));
  }
  for (const [x, z, r, s] of [
    [-2.8, 17.3, 0.2, 0.5], [3.6, 14.8, -0.5, 0.38], [-8.2, 2.4, 0.4, 0.44],
    [6.8, -1.1, -0.2, 0.52], [-3.1, -11.8, 0.8, 0.35], [11.2, -15.1, -0.7, 0.42],
  ]) {
    b.add('records-floor-paper', PAPER, mats.paper,
      matrix(x, 0.025, z, s, s, s, -Math.PI / 2, 0, r));
  }

  addSign(scene, 'records-direction-sign', 'ARCHIVE / SERVER', 'CONTROL ROOM  ↓',
    [-5.1, 1.9, 19.68], 0, 2.4, '#cf8b35');
  addSign(scene, 'records-vestibule-sign', 'PERSONNEL ENTRY', 'RECORDS / EW CONTROL',
    [0, 2.18, 28.88], Math.PI, 2.7, '#637f86');
  addSign(scene, 'records-jammer-status', 'EW CONTROL', 'SPECTRUM DENIAL / ACTIVE',
    [0, 2.35, -19.78], 0, 2.6, '#4dc486');
  return b.flush();
}

function addMetroBench(b, x, z, yaw, mats) {
  for (const offset of [-0.72, 0, 0.72]) {
    const ox = x + Math.cos(yaw) * offset;
    const oz = z - Math.sin(yaw) * offset;
    b.add('metro-bench-slats', UNIT_BOX, mats.bench,
      matrix(ox, 0.55, oz, 0.65, 0.08, 0.48, 0, yaw));
    b.add('metro-bench-slats', UNIT_BOX, mats.bench,
      matrix(ox - Math.sin(yaw) * 0.24, 0.91, oz - Math.cos(yaw) * 0.24,
        0.65, 0.48, 0.08, 0, yaw));
  }
  for (const offset of [-0.78, 0.78]) {
    b.add('metro-bench-legs', PIPE, mats.darkMetal,
      matrix(x + Math.cos(yaw) * offset, 0.28, z - Math.sin(yaw) * offset,
        1.2, 0.48, 1.2));
  }
}

function addMetro(scene) {
  const b = new Batches(scene);
  const procedural = surfaces();
  const trainGrime = grimeTexture();
  const mats = {
    concrete: concreteMaterial(0x6d706d),
    tile: standard(0x8c918d, 0.86, 0.03),
    darkTile: standard(0x303a3c, 0.9, 0.02),
    creamTile: standard(0xa4a18f, 0.9, 0.01),
    warning: standard(0xb99a32, 0.82, 0.05),
    rail: standard(0x7f8585, 0.28, 0.88),
    sleeper: standard(0x40362e, 0.96, 0.02),
    darkMetal: standard(0x242c2f, 0.58, 0.62),
    pipe: standard(0x6a7271, 0.5, 0.7),
    cable: standard(0x171b1c, 0.92, 0.02),
    bench: standard(0x3f5556, 0.62, 0.3),
    trainBody: new THREE.MeshStandardMaterial({
      color: 0x6f7776,
      map: procedural.metal.map,
      normalMap: procedural.metal.normalMap,
      roughnessMap: procedural.metal.roughnessMap,
      normalScale: new THREE.Vector2(0.28, 0.28),
      roughness: 0.64,
      metalness: 0.48,
    }),
    trainLower: standard(0x343b3c, 0.72, 0.42),
    trainAccent: standard(0x8f3e35, 0.72, 0.22),
    trainGlass: new THREE.MeshPhysicalMaterial({
      color: 0x17282c,
      roughness: 0.24,
      metalness: 0.12,
      clearcoat: 0.42,
      clearcoatRoughness: 0.18,
    }),
    trainInterior: new THREE.MeshStandardMaterial({
      color: 0x9a947d,
      emissive: 0x7a7258,
      emissiveIntensity: 0.16,
      roughness: 0.82,
    }),
    rust: standard(0x614139, 0.9, 0.28),
    trainGrime: new THREE.MeshBasicMaterial({
      color: 0x6d655a,
      map: trainGrime,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    stationGrime: new THREE.MeshBasicMaterial({
      color: 0x4f514a,
      map: trainGrime,
      transparent: true,
      opacity: 0.31,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    hazard: standard(0x9e7c24, 0.82, 0.08),
    paper: standard(0xa9a48f, 0.98, 0),
    lampOff: standard(0xabb2aa, 0.42, 0.08),
    lampOn: new THREE.MeshStandardMaterial({
      color: 0xc6c8b8, emissive: 0xd5d0a8, emissiveIntensity: 0.42,
      roughness: 0.38,
    }),
  };

  // Enclose the nominal "street stub" around the stair entrance. With the indoor renderer
  // there is intentionally no skyline, so this battered access pavilion replaces the black
  // void around spawn and gives the descent an architectural threshold.
  b.add('metro-entry-sidewalls', UNIT_BOX, mats.concrete,
    matrix(-9.7, 7.65, 44, 0.5, 3.3, 15.5), true);
  b.add('metro-entry-sidewalls', UNIT_BOX, mats.concrete,
    matrix(9.7, 7.65, 44, 0.5, 3.3, 15.5), true);
  b.add('metro-entry-backwall', UNIT_BOX, mats.concrete,
    matrix(0, 7.65, 51.7, 19.8, 3.3, 0.5), true);
  b.add('metro-entry-canopy', UNIT_BOX, mats.concrete,
    matrix(0, 9.25, 44, 20, 0.35, 16), true);
  // Front facade masks the exposed top of the underground ceiling slab. The original spawn
  // looked over that slab into the black indoor background, which read as the edge of the
  // world. Two wall wings and a lintel leave the authored four-metre stair opening clear.
  b.add('metro-entry-front-wings', UNIT_BOX, mats.concrete,
    matrix(-6, 7.45, 35.72, 7.8, 3.0, 0.42), true);
  b.add('metro-entry-front-wings', UNIT_BOX, mats.concrete,
    matrix(6, 7.45, 35.72, 7.8, 3.0, 0.42), true);
  b.add('metro-entry-front-lintel', UNIT_BOX, mats.concrete,
    matrix(0, 8.62, 35.72, 4.2, 0.66, 0.42), true);
  b.add('metro-entry-front-tile', UNIT_BOX, mats.darkTile,
    matrix(-6, 6.52, 35.47, 7.8, 0.24, 0.06));
  b.add('metro-entry-front-tile', UNIT_BOX, mats.darkTile,
    matrix(6, 6.52, 35.47, 7.8, 0.24, 0.06));
  for (const x of [-2.18, 2.18]) {
    b.add('metro-stairwell-cheek-walls', UNIT_BOX, mats.concrete,
      matrix(x, 3.05, 31.8, 0.24, 5.8, 7.4), true);
    b.add('metro-stairwell-tile-bands', UNIT_BOX, mats.darkTile,
      matrix(x + Math.sign(x) * -0.135, 1.45, 31.8, 0.05, 2.2, 7.2));
    b.add('metro-stairwell-handles', PIPE, mats.darkMetal,
      matrix(x + Math.sign(x) * -0.22, 3.15, 31.8, 1, 6.7, 1,
        Math.PI / 2, 0, 0));
  }
  b.add('metro-stairwell-lintel', UNIT_BOX, mats.concrete,
    matrix(0, 4.75, 28.18, 4.6, 0.7, 0.34), true);
  // Close the four-metre void above the underground opening. The collision wall ends at the
  // station ceiling, but the entrance pavilion is almost four metres taller; without this
  // bulkhead the spawn view looked through the stair portal into the renderer background.
  b.add('metro-stairwell-upper-bulkhead', UNIT_BOX, mats.concrete,
    matrix(0, 7.08, 28.18, 20.0, 3.95, 0.42), true);
  b.add('metro-stairwell-upper-band', UNIT_BOX, mats.darkTile,
    matrix(0, 5.22, 28.41, 19.8, 0.18, 0.055));
  for (const x of [-7.8, -5.2, -2.6, 0, 2.6, 5.2, 7.8]) {
    b.add('metro-stairwell-bulkhead-mullions', UNIT_BOX, mats.darkTile,
      matrix(x, 7.08, 28.42, 0.1, 3.55, 0.055));
  }
  addSign(scene, 'metro-stairwell-sign', 'PLATFORM 2', 'TRAINS / SERVICE TUNNEL',
    [0, 4.72, 28.37], 0, 2.4, '#bd3d35');
  addSign(scene, 'metro-stairwell-bulkhead-sign', 'KORSAK EAST', 'DESCENT / PLATFORM 2',
    [0, 6.82, 28.43], 0, 3.7, '#bd3d35');
  for (const x of [-4.2, 4.2]) {
    b.add('metro-entry-railings', PIPE, mats.darkMetal, matrix(x, 6.72, 35.9, 1, 1.35, 1));
    b.add('metro-entry-railings', PIPE, mats.darkMetal,
      matrix(x, 7.33, 39.4, 1, 7, 1, Math.PI / 2));
  }
  addSign(scene, 'metro-entry-sign', 'KORSAK METRO', 'SERVICE ACCESS / ПЛАТФОРМА',
    [-6, 7.65, 35.47], 0, 3.0, '#bd3d35');
  for (const z of [37, 40.5, 44, 47.5, 51]) {
    b.add('metro-entry-ceiling-ribs', UNIT_BOX, mats.darkMetal,
      matrix(0, 9.02, z, 19.1, 0.16, 0.22));
  }
  for (const x of [-4.2, 4.2]) {
    b.add('metro-entry-lamp-housings', UNIT_BOX, mats.darkMetal,
      matrix(x, 9.02, 41, 2.3, 0.12, 0.34));
    b.add('metro-entry-lamps', UNIT_BOX, mats.lampOn,
      matrix(x, 8.94, 41, 2.05, 0.045, 0.22));
    const entryLight = new THREE.PointLight(0xd8d6b8, 1.15, 11, 2);
    entryLight.position.set(x, 8.55, 41);
    entryLight.castShadow = false;
    scene.add(entryLight);
  }

  // Structural ceiling ribs, columns and tiled lower walls keep the long hall from reading
  // as one extruded box. Everything repeats through instancing.
  for (let z = 25; z >= -28; z -= 5) {
    b.add('metro-ceiling-ribs', UNIT_BOX, mats.darkMetal,
      matrix(0, 4.72, z, 43.2, 0.22, 0.28), true);
    b.add('metro-wall-ribs', UNIT_BOX, mats.darkMetal,
      matrix(-21.55, 2.45, z, 0.3, 4.7, 0.28));
    b.add('metro-wall-ribs', UNIT_BOX, mats.darkMetal,
      matrix(21.55, 2.45, z, 0.3, 4.7, 0.28));
  }
  for (const side of [-1, 1]) {
    b.add('metro-lower-tile-bands', UNIT_BOX, mats.tile,
      matrix(side * 21.78, 1.12, -1, 0.06, 2.05, 56));
    b.add('metro-tile-stripes', UNIT_BOX, mats.darkTile,
      matrix(side * 21.74, 1.48, -1, 0.065, 0.18, 56));
  }
  for (const z of [18, 8, -2, -12, -22]) {
    for (const x of [-8, 8]) {
      b.add('metro-column-cladding', UNIT_BOX, mats.creamTile,
        matrix(x, 1.22, z, 1.14, 2.4, 1.14));
      b.add('metro-column-collars', UNIT_BOX, mats.darkTile,
        matrix(x, 2.35, z, 1.2, 0.18, 1.2));
      b.add('metro-column-collars', UNIT_BOX, mats.darkTile,
        matrix(x, 0.18, z, 1.2, 0.22, 1.2));
    }
  }

  // Track hardware: real twin rails, sleepers and a tactile platform edge. These are close
  // to the player for most of the mission, so silhouettes matter more than extra textures.
  b.add('metro-track-bed-surface', UNIT_BOX, mats.trainLower,
    matrix(-17.15, 0.025, -1, 8.15, 0.045, 57));
  for (const x of [-19.2, -15.1]) {
    b.add('metro-running-rails', UNIT_BOX, mats.rail,
      matrix(x, 0.14, -1, 0.12, 0.16, 58), true);
  }
  for (let z = 26; z >= -29; z -= 1.35) {
    b.add('metro-sleepers', UNIT_BOX, mats.sleeper,
      matrix(-17.15, 0.075, z, 6.1, 0.08, 0.24));
  }
  b.add('metro-warning-strip', UNIT_BOX, mats.warning,
    matrix(-12.68, 0.04, -1, 0.42, 0.055, 57));
  for (let z = 26; z >= -29; z -= 0.72) {
    b.add('metro-platform-studs', PLATFORM_STUD, mats.warning,
      matrix(-12.66, 0.085, z, 1, 1, 1));
  }

  // A disabled evacuation train gives the track trench a subject and supplies the scale that
  // bare rails cannot. The shell is one bevelled extrusion; all repeated side details are
  // instanced, so the 24-metre car costs fewer calls than a pile of decorative crates.
  b.add('metro-train-shell', METRO_CAR_SHELL, mats.trainBody,
    matrix(-17.15, 1.2, -4, 1, 1, 1), true);
  b.add('metro-train-lower-skirt', UNIT_BOX, mats.trainLower,
    matrix(-14.98, 0.5, -4, 0.11, 0.58, 23.3), true);
  b.add('metro-train-accent-stripe', UNIT_BOX, mats.trainAccent,
    matrix(-14.93, 1.54, -4, 0.055, 0.18, 23.1));

  const trainWindows = [6.3, 0.9, -2.0, -4.9, -11.0, -13.8];
  for (const [index, z] of trainWindows.entries()) {
    // Two dark openings expose a little warm carriage interior while the others remain dead.
    if (index === 1 || index === 4) {
      b.add('metro-train-window-interiors', UNIT_BOX, mats.trainInterior,
        matrix(-15.005, 2.21, z, 0.035, 0.62, 1.48));
    }
    b.add('metro-train-windows', UNIT_BOX, mats.trainGlass,
      matrix(-14.955, 2.21, z, 0.035, 0.68, 1.55));
    b.add('metro-train-window-sills', UNIT_BOX, mats.trainLower,
      matrix(-14.91, 1.83, z, 0.055, 0.055, 1.68));
    b.add('metro-train-window-frames', UNIT_BOX, mats.trainLower,
      matrix(-14.905, 2.21, z - 0.81, 0.055, 0.82, 0.045));
    b.add('metro-train-window-frames', UNIT_BOX, mats.trainLower,
      matrix(-14.905, 2.21, z + 0.81, 0.055, 0.82, 0.045));
    b.add('metro-train-window-frames', UNIT_BOX, mats.trainLower,
      matrix(-14.905, 2.59, z, 0.055, 0.045, 1.66));
  }
  for (const z of [3.72, -8.05]) {
    for (const offset of [-0.46, 0.46]) {
      b.add('metro-train-door-panels', UNIT_BOX, mats.trainAccent,
        matrix(-14.94, 1.74, z + offset, 0.065, 2.3, 0.86));
      b.add('metro-train-door-windows', UNIT_BOX, mats.trainGlass,
        matrix(-14.895, 2.23, z + offset, 0.035, 0.72, 0.62));
    }
    b.add('metro-train-door-seams', UNIT_BOX, mats.trainLower,
      matrix(-14.89, 1.74, z, 0.025, 2.25, 0.035));
    b.add('metro-train-door-frames', UNIT_BOX, mats.trainLower,
      matrix(-14.885, 2.9, z, 0.04, 0.055, 2.02));
    for (const offset of [-1.02, 1.02]) {
      b.add('metro-train-door-frames', UNIT_BOX, mats.trainLower,
        matrix(-14.885, 1.74, z + offset, 0.04, 2.35, 0.055));
    }
    b.add('metro-train-door-handles', SMALL_PIPE, mats.darkMetal,
      matrix(-14.84, 1.76, z - 0.13, 1, 0.24, 1));
  }
  for (const z of [7.25, 5.35, 2.3, -0.55, -3.45, -6.4, -9.6, -12.5, -15.1]) {
    b.add('metro-train-body-seams', UNIT_BOX, mats.trainLower,
      matrix(-14.90, 1.58, z, 0.04, 2.82, 0.025));
  }
  for (let z = -14.2; z <= 6.2; z += 1.7) {
    b.add('metro-train-lower-vents', UNIT_BOX, mats.rust,
      matrix(-14.90, 0.52, z, 0.04, 0.055, 1.05));
  }
  b.add('metro-train-window-boards', UNIT_BOX, mats.rust,
    matrix(-14.86, 2.21, -13.8, 0.035, 0.09, 1.62, 0.42, 0, 0));
  b.add('metro-train-window-boards', UNIT_BOX, mats.rust,
    matrix(-14.855, 2.21, -13.8, 0.035, 0.09, 1.62, -0.42, 0, 0));
  b.add('metro-train-grime-decals', TRAIN_SIDE_DECAL, mats.trainGrime,
    matrix(-14.82, 1.62, -9.2, 10.6, 2.75, 1, 0, Math.PI / 2, 0));
  b.add('metro-train-grime-decals', TRAIN_SIDE_DECAL, mats.trainGrime,
    matrix(-14.815, 1.62, 3.4, 8.8, 2.75, 1, 0, Math.PI / 2, 0));
  for (const z of [-11.2, 3.1]) {
    for (const x of [-19.12, -15.18]) {
      b.add('metro-train-wheels', METRO_WHEEL, mats.darkMetal,
        matrix(x, 0.36, z, 1, 1, 1, 0, 0, Math.PI / 2), true);
    }
    b.add('metro-train-bogies', UNIT_BOX, mats.trainLower,
      matrix(-17.15, 0.4, z, 3.5, 0.42, 2.3), true);
  }
  for (const z of [-10.5, -3.8, 2.9]) {
    b.add('metro-train-roof-vents', UNIT_BOX, mats.trainLower,
      matrix(-17.15, 3.17, z, 1.25, 0.18, 1.5));
    for (const offset of [-0.42, 0, 0.42]) {
      b.add('metro-train-roof-vent-slats', UNIT_BOX, mats.rust,
        matrix(-17.15 + offset, 3.27, z, 0.18, 0.035, 1.22));
    }
  }
  addSign(scene, 'metro-train-route-board', 'EVACUATION 04', 'KORSAK / EAST SECTOR',
    [-14.885, 2.64, -4.0], Math.PI / 2, 2.1, '#bd3d35');

  // Two pipe/cable runs lead the eye toward the south service tunnel.
  for (const [x, y, material] of [
    [-20.9, 3.72, mats.pipe], [-20.9, 3.48, mats.pipe],
    [20.9, 4.0, mats.cable], [20.9, 3.78, mats.cable],
  ]) {
    b.add(material === mats.pipe ? 'metro-service-pipes' : 'metro-cable-runs',
      material === mats.pipe ? PIPE : CABLE, material,
      matrix(x, y, -1, 1, 57, 1, Math.PI / 2));
  }
  for (let z = 25; z >= -28; z -= 4) {
    b.add('metro-pipe-brackets', UNIT_BOX, mats.darkMetal,
      matrix(-20.9, 3.6, z, 0.28, 0.72, 0.05));
    b.add('metro-pipe-brackets', UNIT_BOX, mats.darkMetal,
      matrix(20.9, 3.88, z, 0.22, 0.62, 0.05));
  }

  addMetroBench(b, 15.4, 15, Math.PI / 2, mats);
  addMetroBench(b, 15.4, -8, Math.PI / 2, mats);
  addMetroBench(b, -5.2, -24, 0, mats);

  // Platform identity and evacuation residue. These sit against the east wall or beneath
  // benches, leaving the combat/navigation lane through the columns unchanged.
  addSign(scene, 'metro-station-name-north', 'KORSAK EAST', 'PLATFORM 2 / ПЛАТФОРМА',
    [21.66, 2.82, 11], -Math.PI / 2, 3.4, '#bd3d35');
  addSign(scene, 'metro-station-name-south', 'KORSAK EAST', 'SOUTH SERVICE / SHELTER',
    [21.66, 2.82, -13], -Math.PI / 2, 3.4, '#bd3d35');
  addSign(scene, 'metro-hanging-direction', 'SOUTH TUNNEL', 'HOSTAGES / SERVICE ACCESS  ↓',
    [10, 3.72, -2], 0, 2.8, '#b98f32');
  for (const z of [5.5, -19.5]) {
    b.add('metro-emergency-cabinets', UNIT_BOX, mats.trainAccent,
      matrix(21.57, 1.28, z, 0.2, 1.55, 0.9));
    b.add('metro-emergency-cabinet-doors', UNIT_BOX, mats.darkMetal,
      matrix(21.44, 1.28, z, 0.045, 1.35, 0.72));
    b.add('metro-emergency-cabinet-handles', SMALL_PIPE, mats.rail,
      matrix(21.39, 1.2, z - 0.22, 1, 0.24, 1));
  }
  for (const [x, z, sx, sy, sz, color] of [
    [17.6, 17.8, 0.72, 0.52, 0.42, mats.trainLower],
    [18.4, 17.5, 0.46, 0.74, 0.34, mats.trainAccent],
    [16.8, -8.9, 0.62, 0.44, 0.38, mats.trainLower],
    [17.5, -9.2, 0.48, 0.66, 0.32, mats.trainAccent],
    [19.8, -23.8, 0.72, 0.5, 0.4, mats.trainLower],
  ]) {
    b.add('metro-abandoned-luggage', UNIT_BOX, color,
      matrix(x, sy / 2 + 0.03, z, sx, sy, sz));
    b.add('metro-luggage-handles', SMALL_PIPE, mats.darkMetal,
      matrix(x, sy + 0.12, z, 1, 0.22, 1));
  }
  for (const [x, z, rz, scale] of [
    [11.2, 12.8, 0.2, 0.36], [18.5, 8.2, -0.5, 0.42],
    [3.5, 3.8, 0.8, 0.32], [14.0, -1.6, -0.2, 0.44],
    [6.2, -7.2, 0.4, 0.38], [18.2, -13.1, -0.8, 0.46],
    [-1.2, -19.2, 0.6, 0.34], [11.4, -25.0, -0.3, 0.4],
  ]) {
    b.add('metro-floor-paper', PAPER, mats.paper,
      matrix(x, 0.024, z, scale, scale, scale, -Math.PI / 2, 0, rz));
  }
  for (const [x, z, rx, rz] of [
    [-3.5, 15, 0.07, -0.045], [12.2, 8, -0.08, 0.035],
    [-4.8, -6, 0.11, -0.035], [12.8, -18, -0.09, 0.045],
  ]) {
    b.add('metro-damaged-ceiling-panels', UNIT_BOX, mats.concrete,
      matrix(x, 4.51, z, 2.6, 0.07, 1.7, rx, 0, rz));
  }
  for (const [x, z, sx, sz, rz] of [
    [8.5, 19, 4.6, 5.2, 0.12], [2, 7, 5.4, 6.2, -0.08],
    [13.5, -4, 4.2, 5.6, 0.18], [4.5, -18, 5.8, 6.4, -0.12],
    [1.8, -37, 4.4, 4.8, 0.1], [-2.4, -48, 4.6, 5.8, -0.16],
  ]) {
    b.add('metro-floor-grime-decals', TRAIN_SIDE_DECAL, mats.stationGrime,
      matrix(x, 0.028, z, sx, sz, 1, -Math.PI / 2, 0, rz));
  }
  for (const [x, y, z, sy, sz, side] of [
    [21.67, 1.7, 18, 2.6, 4.2, -1], [21.67, 1.55, -20, 2.3, 4.8, -1],
    [-6.64, 1.55, -39, 2.4, 3.2, 1], [6.64, 1.6, -46, 2.6, 3.8, -1],
    [-6.64, 1.5, -54, 2.2, 3.4, 1],
  ]) {
    b.add('metro-wall-grime-decals', TRAIN_SIDE_DECAL, mats.stationGrime,
      matrix(x, y, z, sz, sy, 1, 0, side * Math.PI / 2, 0));
  }
  for (const [x, y, z, sy, sz] of [
    [21.69, 1.18, 1, 0.72, 1.6], [21.69, 0.58, -6, 0.68, 2.2],
    [21.69, 1.05, -24, 0.8, 1.5], [6.66, 0.75, -35, 0.7, 1.4],
    [-6.66, 1.25, -45, 0.9, 1.8], [6.66, 1.0, -56, 0.75, 1.5],
  ]) {
    b.add('metro-missing-tile-patches', UNIT_BOX, mats.darkMetal,
      matrix(x, y, z, 0.055, sy, sz));
  }

  // Alternating live/dead fluorescent housings create a readable route without flattening
  // the whole underground level into uniform daylight.
  const liveLights = [];
  for (let z = 23, i = 0; z >= -27; z -= 6, i++) {
    const live = i % 3 !== 1;
    b.add('metro-fluorescent-housings', UNIT_BOX, mats.darkMetal,
      matrix(2, 4.56, z, 0.32, 0.13, 3.3));
    b.add(live ? 'metro-fluorescent-live' : 'metro-fluorescent-dead', UNIT_BOX,
      live ? mats.lampOn : mats.lampOff,
      matrix(2, 4.48, z, 0.22, 0.055, 2.85));
    if (live && liveLights.length < 4) liveLights.push([2, 4.25, z]);
  }
  for (const [x, y, z] of liveLights) {
    const light = new THREE.PointLight(0xd8d6b8, 1.35, 14, 2);
    light.position.set(x, y, z);
    light.castShadow = false;
    scene.add(light);
  }

  // The narrow south tunnel needs its own repeated services or it collapses into another
  // black rectangle after the platform.
  for (const x of [-6.65, 6.65]) {
    b.add('metro-tunnel-tile-bands', UNIT_BOX, mats.darkTile,
      matrix(x, 1.05, -45, 0.06, 1.9, 29));
  }
  for (const x of [-5.7, -5.35]) {
    b.add('metro-tunnel-pipes', PIPE, mats.pipe,
      matrix(x, 3.55, -45, 1, 29, 1, Math.PI / 2));
  }
  b.add('metro-tunnel-cable-tray', UNIT_BOX, mats.darkMetal,
    matrix(0, 4.12, -45, 0.62, 0.08, 28));
  for (let z = -58; z <= -32; z += 2) {
    b.add('metro-tunnel-cable-rungs', UNIT_BOX, mats.pipe,
      matrix(0, 4.06, z, 0.72, 0.035, 0.045));
  }
  for (let z = -57; z <= -33; z += 4) {
    b.add('metro-tunnel-ceiling-ribs', UNIT_BOX, mats.darkMetal,
      matrix(0, 4.25, z, 13.4, 0.16, 0.22));
    b.add('metro-tunnel-wall-pilasters', UNIT_BOX, mats.darkMetal,
      matrix(-6.48, 2.2, z, 0.32, 4.3, 0.34));
    b.add('metro-tunnel-wall-pilasters', UNIT_BOX, mats.darkMetal,
      matrix(6.48, 2.2, z, 0.32, 4.3, 0.34));
    if (z === -37 || z === -49) {
      b.add('metro-tunnel-hazard-bands', UNIT_BOX, mats.hazard,
        matrix(-6.29, 1.12, z, 0.06, 1.65, 0.16));
      b.add('metro-tunnel-hazard-bands', UNIT_BOX, mats.hazard,
        matrix(6.29, 1.12, z, 0.06, 1.65, 0.16));
    }
  }
  b.add('metro-tunnel-drain-channel', UNIT_BOX, mats.darkMetal,
    matrix(0, 0.025, -45, 0.55, 0.045, 28));
  for (let z = -58; z <= -32; z += 0.82) {
    b.add('metro-tunnel-drain-grates', UNIT_BOX, mats.rail,
      matrix(0, 0.065, z, 0.48, 0.025, 0.055));
  }
  for (const z of [-39, -51]) {
    b.add('metro-tunnel-service-doors', UNIT_BOX, mats.darkMetal,
      matrix(6.58, 1.18, z, 0.12, 2.28, 1.5));
    b.add('metro-tunnel-service-door-frames', UNIT_BOX, mats.rust,
      matrix(6.48, 2.35, z, 0.16, 0.08, 1.7));
    for (const dz of [-0.82, 0.82]) {
      b.add('metro-tunnel-service-door-frames', UNIT_BOX, mats.rust,
        matrix(6.48, 1.18, z + dz, 0.16, 2.35, 0.08));
    }
    b.add('metro-tunnel-service-door-handles', SMALL_PIPE, mats.rail,
      matrix(6.39, 1.08, z - 0.45, 1, 0.22, 1));
  }
  for (const [side, z] of [[-1, -37], [1, -43], [-1, -49], [1, -55]]) {
    const x = side * 6.55;
    b.add('metro-tunnel-junction-boxes', UNIT_BOX, mats.darkMetal,
      matrix(x, 2.2, z, 0.18, 0.78, 0.62));
    b.add('metro-tunnel-junction-doors', UNIT_BOX, mats.pipe,
      matrix(x - side * 0.105, 2.2, z, 0.025, 0.65, 0.5));
  }
  for (const z of [-36, -46, -56]) {
    b.add('metro-tunnel-lamp-housings', UNIT_BOX, mats.darkMetal,
      matrix(2.3, 4.12, z, 0.3, 0.12, 2.5));
    b.add('metro-tunnel-lamps', UNIT_BOX, z === -46 ? mats.lampOff : mats.lampOn,
      matrix(2.3, 4.04, z, 0.21, 0.045, 2.1));
    if (z !== -46) {
      const tunnelLight = new THREE.PointLight(0xd8d6b8, 0.95, 12, 2);
      tunnelLight.position.set(2.3, 3.82, z);
      tunnelLight.castShadow = false;
      scene.add(tunnelLight);
    }
  }
  for (const [x, z] of [[4.8, -35], [-4.5, -42], [4.7, -51], [-4.8, -57]]) {
    b.add('metro-floor-drains', UNIT_BOX, mats.rail,
      matrix(x, 0.025, z, 0.42, 0.035, 0.68));
  }
  addSign(scene, 'metro-platform-sign', 'PLATFORM 2', 'SOUTH SERVICE / ВЫХОД',
    [7.42, 3.28, -26], -Math.PI / 2, 3.2, '#bd3d35');

  return b.flush();
}

function addCommandBunker(scene) {
  const b = new Batches(scene);
  const grime = grimeTexture();
  const mats = {
    steel: standard(0x465054, 0.5, 0.62),
    darkSteel: standard(0x20282b, 0.62, 0.54),
    duct: standard(0x667174, 0.42, 0.7),
    cable: standard(0x151a1c, 0.9, 0.04),
    rubber: standard(0x111516, 0.96, 0),
    console: standard(0x2d373a, 0.68, 0.34),
    screen: new THREE.MeshStandardMaterial({
      color: 0x102727, emissive: 0x1b6e63, emissiveIntensity: 0.48,
      roughness: 0.34, metalness: 0.05,
    }),
    deadScreen: standard(0x101416, 0.82, 0.04),
    amber: new THREE.MeshBasicMaterial({ color: 0xd89d45 }),
    green: new THREE.MeshBasicMaterial({ color: 0x51c27c }),
    red: new THREE.MeshBasicMaterial({ color: 0xa83830 }),
    paper: standard(0xb9b5a5, 0.98, 0),
    lampOn: new THREE.MeshStandardMaterial({
      color: 0xd4dfd8,
      emissive: 0xc1ddd2,
      emissiveIntensity: 1.15,
      roughness: 0.38,
      metalness: 0.02,
    }),
    floorGrime: new THREE.MeshBasicMaterial({
      color: 0x8a8c83,
      map: grime,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    wallGrime: new THREE.MeshBasicMaterial({
      color: 0x858981,
      map: grime,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    tacticalMap: new THREE.MeshBasicMaterial({ map: tacticalMapTexture() }),
  };

  // Five ceiling ribs, a real ventilation trunk and a runged cable tray break the concrete
  // lid into human scale. They sit above head height and do not alter the bunker collision.
  for (const z of [-26, -30, -34, -38, -42]) {
    b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
      matrix(22, -0.18, z, 15.4, 0.18, 0.22));
  }
  b.add('bunker-ventilation-trunk', UNIT_BOX, mats.duct,
    matrix(16.05, -0.45, -34, 0.86, 0.56, 18.4));
  for (const z of [-27, -31, -35, -39, -42]) {
    b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
      matrix(16.05, -0.45, z, 0.96, 0.63, 0.08));
  }
  b.add('bunker-galvanized-boxes', UNIT_BOX, mats.steel,
    matrix(27.25, -0.36, -34, 0.72, 0.08, 18));
  for (let z = -42; z <= -26; z += 1.25) {
    b.add('bunker-galvanized-boxes', UNIT_BOX, mats.steel,
      matrix(27.25, -0.42, z, 0.84, 0.035, 0.045));
  }
  for (const x of [26.98, 27.22, 27.46]) {
    b.add('bunker-cables', CABLE, mats.cable,
      matrix(x, -0.48, -34, 1, 17, 1, Math.PI / 2));
  }

  // Service pipes and electrical boxes make both sidewalls readable while remaining less
  // than 35cm proud of the wall. Repetition is instanced; combat paths remain untouched.
  for (const y of [-1.05, -1.32]) {
    b.add('bunker-service-pipes-west', PIPE, mats.steel,
      matrix(14.24, y, -34, 1, 18, 1, Math.PI / 2));
  }
  for (let z = -41.5; z <= -26.5; z += 3) {
    b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
      matrix(14.22, -1.18, z, 0.16, 0.52, 0.08));
  }
  for (const [x, z, yaw] of [
    [14.28, -28, Math.PI / 2], [14.28, -35, Math.PI / 2],
    [29.72, -27.5, -Math.PI / 2], [29.72, -39.5, -Math.PI / 2],
  ]) {
    b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
      matrix(x, -2.1, z, 0.18, 0.82, 0.62, 0, yaw));
    b.add('bunker-galvanized-boxes', UNIT_BOX, mats.steel,
      matrix(x + (x < 22 ? 0.105 : -0.105), -2.1, z,
        0.025, 0.68, 0.5, 0, yaw));
  }

  // The east wall is the fire-control station. Consoles are shallow wall furniture, with
  // alternating live/dead screens and separate physical controls rather than a flat decal.
  b.add('bunker-command-furniture', UNIT_BOX, mats.console,
    matrix(29.18, -3.54, -33.2, 0.92, 0.18, 6.8));
  for (const z of [-30.8, -33.2, -35.6]) {
    b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
      matrix(29.25, -4.02, z, 0.12, 0.82, 0.12));
  }
  for (const [z, live] of [[-30.9, true], [-33.2, true], [-35.5, false]]) {
    b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
      matrix(29.05, -2.92, z, 0.13, 0.72, 1.2));
    b.add(live ? 'bunker-monitor-live' : 'bunker-monitor-dead', UNIT_BOX,
      live ? mats.screen : mats.deadScreen,
      matrix(28.975, -2.92, z, 0.018, 0.58, 1.02));
    for (let i = -2; i <= 2; i++) {
      b.add('bunker-console-switches', UNIT_BOX, i === 2 ? mats.red : mats.amber,
        matrix(28.68, -3.405, z + i * 0.16, 0.025, 0.028, 0.055));
    }
  }

  // The rear wall is the heart of the command post. A continuous bench and framed tactical
  // display fill the player's approach view without stealing floor space from BASTION's loop.
  b.add('bunker-command-furniture', UNIT_BOX, mats.console,
    matrix(22, -3.54, -43.12, 13.6, 0.18, 0.82));
  for (const x of [16.2, 19.1, 22, 24.9, 27.8]) {
    b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
      matrix(x, -4.02, -43.16, 0.12, 0.82, 0.12));
  }
  for (const [x, live] of [[17.0, false], [22.0, true], [27.0, true]]) {
    b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
      matrix(x, -2.95, -42.78, 1.55, 0.72, 0.14));
    b.add(live ? 'bunker-monitor-live' : 'bunker-monitor-dead', UNIT_BOX,
      live ? mats.screen : mats.deadScreen,
      matrix(x, -2.95, -42.695, 1.36, 0.58, 0.018));
  }
  b.add('bunker-tactical-map-screen', UNIT_BOX, mats.tacticalMap,
    matrix(20.2, -1.66, -43.68, 5.4, 1.72, 0.035));
  b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
    matrix(20.2, -0.77, -43.65, 5.72, 0.09, 0.1));
  b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
    matrix(20.2, -2.55, -43.65, 5.72, 0.09, 0.1));
  for (const x of [17.37, 23.03]) {
    b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
      matrix(x, -1.66, -43.65, 0.09, 1.86, 0.1));
  }

  // Radio racks occupy the dead strip along the west wall. Slot faces, handles and LEDs
  // provide close-range material separation without adding unique draw calls per cabinet.
  for (const z of [-30.2, -33.1, -36.0]) {
    b.add('bunker-command-furniture', UNIT_BOX, mats.console,
      matrix(14.62, -3.42, z, 0.72, 2.05, 1.18));
    b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
      matrix(15.0, -3.42, z, 0.025, 1.88, 1.03));
    for (let y = -4.15; y <= -2.72; y += 0.24) {
      b.add('bunker-galvanized-boxes', UNIT_BOX, mats.steel,
        matrix(15.02, y, z, 0.018, 0.035, 0.78));
    }
    for (const y of [-4.02, -3.54, -3.06]) {
      b.add('bunker-radio-led-green', LED, mats.green,
        matrix(15.06, y, z + 0.38));
      b.add('bunker-radio-led-amber', LED, mats.amber,
        matrix(15.06, y, z + 0.29));
    }
  }

  // Papers and cable tails keep the workstation from reading as a pristine showroom.
  for (const [x, z, r, s] of [
    [28.72, -31.6, 0.2, 0.34], [28.7, -34.1, -0.35, 0.4],
    [22.4, -28.2, 0.55, 0.48], [18.2, -40.9, -0.3, 0.38],
  ]) {
    b.add('bunker-map-sheets', PAPER, mats.paper,
      matrix(x, x > 28 ? -3.41 : -4.46, z, s, s, s, -Math.PI / 2, 0, r));
  }
  for (const [x, z, length, rz] of [
    [28.35, -31.6, 1.3, 0.35], [28.4, -34.3, 1.6, -0.42],
    [15.3, -37.8, 1.2, 0.28],
  ]) {
    b.add('bunker-cables', CABLE, mats.cable,
      matrix(x, -4.39, z, 1, length, 1, Math.PI / 2, 0, rz));
  }

  // Wall seepage and smoke are decal planes rather than more geometry. Their soft alpha
  // removes the clean-room concrete read and their shared texture costs one upload.
  const wallGrime = new THREE.PlaneGeometry(1, 1);
  b.add('bunker-wall-grime', wallGrime, mats.wallGrime,
    matrix(22, -2.22, -43.705, 14.8, 4.15, 1));
  b.add('bunker-wall-grime', wallGrime, mats.wallGrime,
    matrix(14.265, -2.28, -34, 17.8, 4.0, 1, 0, Math.PI / 2));
  b.add('bunker-wall-grime', wallGrime, mats.wallGrime,
    matrix(29.735, -2.18, -34, 17.8, 3.9, 1, 0, -Math.PI / 2));

  // Layered grime sits millimetres above the floor. One material and four planes replace
  // broad uniform concrete with damp traffic paths; transparent edges prevent hard decals.
  const floorGrime = new THREE.PlaneGeometry(1, 1);
  for (const [x, z, sx, sz, rz] of [
    [19.2, -29.0, 4.5, 6.2, -0.12],
    [24.8, -34.2, 6.6, 5.2, 0.08],
    [18.6, -40.1, 3.8, 4.8, 0.2],
    [27.1, -40.2, 3.4, 4.2, -0.18],
  ]) {
    b.add('bunker-floor-grime', floorGrime, mats.floorGrime,
      matrix(x, -4.475, z, sx, sz, 1, -Math.PI / 2, 0, rz));
  }

  // Practical fluorescent strips establish alternating pools rather than flattening the
  // whole room. Two non-shadowing lights are a stable shader key and are prewarmed at load.
  for (const [x, z, live] of [[19.2, -29, true], [24.8, -34, true], [19.2, -39, false]]) {
    b.add('bunker-dark-steel-boxes', UNIT_BOX, mats.darkSteel,
      matrix(x, -0.22, z, 2.8, 0.13, 0.34));
    b.add(live ? 'bunker-light-live' : 'bunker-light-dead', UNIT_BOX,
      live ? mats.lampOn : mats.deadScreen,
      matrix(x, -0.3, z, 2.45, 0.045, 0.22));
    if (live) {
      const light = new THREE.PointLight(0xb8d4c9, 1.2, 11, 2);
      light.position.set(x, -0.62, z);
      light.castShadow = false;
      scene.add(light);
    }
  }

  addSign(scene, 'bunker-command-status', '37TH ASSAULT', 'FIRE CONTROL / SECTOR EAST',
    [26.25, -1.9, -43.73], 0, 3.2, '#a6463d');
  addSign(scene, 'bunker-ew-status', 'EW NET', 'JAMMING / DRONE INTERCEPT',
    [29.68, -1.82, -39], -Math.PI / 2, 2.5, '#bd8c3c');

  return b.flush();
}

export function addInteriorMissionArt(scene, levelId) {
  if (!quality.desktop) return;
  let batches = null;
  if (levelId === 8) batches = addRecordsOffice(scene);
  if (levelId === 9) batches = addMetro(scene);
  if (levelId === 10) batches = addCommandBunker(scene);
  if (batches) {
    scene.userData.interiorMissionStats = {
      levelId,
      batches,
      instances: Object.values(batches).reduce((sum, value) => sum + value, 0),
    };
  }
}
