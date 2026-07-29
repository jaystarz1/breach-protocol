// Authored visual layer for mission 02. Gameplay/collision stays on the cheap merged blockout;
// this high-tier layer adds real material separation, edge catches, grime and contact cues.
import * as THREE from 'three';
import { quality } from './quality.js';
import { rng } from './world.js';
import { makeBox } from './physics.js';
import { streetShopLayout } from './mission-variants.js';

const ROOT = './assets/street-sweep/';
let kit = null;

function texture(name, rx, ry, data = false) {
  const t = new THREE.TextureLoader().load(`${ROOT}${name}.jpg`);
  t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  return t;
}

function contactShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 61);
  g.addColorStop(0, 'rgba(0,0,0,.9)');
  g.addColorStop(0.52, 'rgba(0,0,0,.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function wornPaintTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const R = rng(44027);
  x.fillStyle = '#d2cfb7';
  x.fillRect(0, 0, 256, 256);
  // Alpha damage, not grey dots painted onto the stripe. The asphalt underneath must show
  // through the missing paint for a crosswalk to read as worn rather than merely dirty.
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 180; i++) {
    x.globalAlpha = 0.18 + R() * 0.65;
    x.save();
    x.translate(R() * 256, R() * 256);
    x.rotate(R() * Math.PI);
    x.fillRect(-2 - R() * 8, -0.7 - R() * 2.4, 4 + R() * 18, 1.2 + R() * 4.5);
    x.restore();
  }
  for (let i = 0; i < 28; i++) {
    x.globalAlpha = 0.3 + R() * 0.45;
    x.beginPath();
    x.arc(R() * 256, R() * 256, 2 + R() * 8, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  const out = new THREE.CanvasTexture(c);
  out.colorSpace = THREE.SRGBColorSpace;
  out.wrapS = out.wrapT = THREE.RepeatWrapping;
  out.anisotropy = 8;
  return out;
}

function roadDamageTexture() {
  const out = new THREE.TextureLoader().load(`${ROOT}road-damage-atlas.webp`);
  out.colorSpace = THREE.SRGBColorSpace;
  out.wrapS = out.wrapT = THREE.ClampToEdgeWrapping;
  out.anisotropy = 8;
  return out;
}

function materials() {
  if (kit) return kit;
  const mat = (name, rx, ry, roughness, bumpScale, color = 0xffffff) =>
    new THREE.MeshStandardMaterial({
      color,
      map: texture(name, rx, ry),
      bumpMap: texture(`${name}-height`, rx, ry, true),
      bumpScale,
      roughness,
      metalness: 0,
    });
  kit = {
    asphalt: mat('asphalt', 8, 18, 0.9, 0.045, 0x9ca3aa),
    sidewalk: mat('sidewalk', 2, 24, 0.86, 0.025, 0xb8bdc0),
    brick: mat('brick', 22, 3, 0.82, 0.055, 0xb6aaa2),
    plaster: mat('plaster', 17, 2.4, 0.88, 0.04, 0x9fa9b2),
    curb: mat('sidewalk', 1, 28, 0.9, 0.022, 0x999fa3),
    roadPaint: new THREE.MeshStandardMaterial({
      map: wornPaintTexture(), transparent: true, alphaTest: 0.16,
      roughness: 0.82, metalness: 0, depthWrite: false,
    }),
    roadDamage: new THREE.MeshStandardMaterial({
      color: 0x8a847c, map: roadDamageTexture(), transparent: true, alphaTest: 0.035,
      roughness: 0.96, metalness: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0x3d454b, roughness: 0.72, metalness: 0.05 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x70767a, roughness: 0.9 }),
    damp: new THREE.MeshStandardMaterial({
      color: 0x242a2e, transparent: true, opacity: 0.42,
      roughness: 0.98, depthWrite: false,
    }),
    wet: new THREE.MeshPhysicalMaterial({
      color: 0x101820, roughness: 0.18, metalness: 0.05,
      transparent: true, opacity: 0.48, envMapIntensity: 1.7,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }),
    shadow: new THREE.MeshBasicMaterial({
      // MultiplyBlending applies the black source colour outside the intended radial alpha
      // on some WebGL paths, exposing the entire rectangular quad. Ordinary alpha blending
      // preserves the soft canvas falloff and removes the hard black vehicle-sized cards.
      map: contactShadow(), transparent: true, opacity: 0.34,
      depthWrite: false,
    }),
  };
  // A separate tint with the same uploaded plaster maps gives the shop interiors less bounce
  // without allocating another base/height texture pair.
  kit.shopInterior = kit.plaster.clone();
  kit.shopInterior.color.setHex(0x4d5150);
  kit.shopInterior.roughness = 0.96;
  kit.storefrontMetal = new THREE.MeshStandardMaterial({
    color: 0x33383a, roughness: 0.68, metalness: 0.48,
  });
  kit.shopFloor = new THREE.MeshStandardMaterial({
    color: 0x575955, roughness: 0.97, metalness: 0,
  });
  kit.shopFurnishing = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.82, metalness: 0.12,
  });
  kit.shopStock = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.84, metalness: 0.01,
  });
  kit.shopDark = new THREE.MeshStandardMaterial({
    color: 0x0d1011, roughness: 0.99, metalness: 0,
  });
  kit.shopLight = new THREE.MeshStandardMaterial({
    color: 0xd8d1bd, emissive: 0xffe1a8, emissiveIntensity: 0.42,
    roughness: 0.66, metalness: 0.03,
  });
  kit.shopGlass = new THREE.MeshPhysicalMaterial({
    color: 0x3a515b, roughness: 0.28, metalness: 0.04,
    transparent: true, opacity: 0.34, clearcoat: 0.9,
    clearcoatRoughness: 0.18, side: THREE.DoubleSide,
  });
  return kit;
}

function groundBatch(scene, name, items, material) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const angle = item.rot || 0;
    const right = [Math.cos(angle), 0, -Math.sin(angle)];
    const forward = [-Math.sin(angle), 0, -Math.cos(angle)];
    const hw = item.w / 2, hd = item.d / 2;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    for (const [side, ahead] of corners) {
      positions.push(
        item.x + right[0] * side + forward[0] * ahead,
        item.y,
        item.z + right[2] * side + forward[2] * ahead,
      );
      normals.push(0, 1, 0);
    }
    const tile = item.tile ?? null;
    const col = tile == null ? 0 : tile % 4;
    const row = tile == null ? 0 : Math.floor(tile / 4);
    const u0 = tile == null ? 0 : col / 4;
    const u1 = tile == null ? 1 : (col + 1) / 4;
    const v0 = tile == null ? 0 : 1 - (row + 1) / 4;
    const v1 = tile == null ? 1 : 1 - row / 4;
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    const base = i * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const out = new THREE.Mesh(geometry, material);
  out.name = name;
  out.receiveShadow = quality.shadows;
  out.userData.itemCount = items.length;
  scene.add(out);
  return out;
}

function wallBatch(scene, name, items, material, sourceRepeat = [1, 1]) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const nx = item.nx, nz = item.nz;
    const right = [nz, 0, -nx];
    const hw = item.w / 2, hh = item.h / 2;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    for (const [side, up] of corners) {
      positions.push(item.x + right[0] * side, item.y + up, item.z + right[2] * side);
      normals.push(nx, 0, nz);
    }
    const targetU = item.repeatU ?? Math.max(1, item.w / 2.4);
    const targetV = item.repeatV ?? Math.max(1, item.h / 2.1);
    const u1 = targetU / sourceRepeat[0], v1 = targetV / sourceRepeat[1];
    uvs.push(0, 0, u1, 0, u1, v1, 0, v1);
    const base = i * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const out = new THREE.Mesh(geometry, material);
  out.name = name;
  out.castShadow = out.receiveShadow = quality.shadows;
  out.userData.itemCount = items.length;
  scene.add(out);
  return out;
}

function instanceBatch(scene, name, geometry, material, items, shadows = true) {
  const out = new THREE.InstancedMesh(geometry, material, items.length);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let hasColors = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    dummy.position.set(item.x, item.y, item.z);
    dummy.rotation.set(item.rx || 0, item.ry || 0, item.rz || 0);
    dummy.scale.set(item.w || 1, item.h || 1, item.d || 1);
    dummy.updateMatrix();
    out.setMatrixAt(i, dummy.matrix);
    if (item.color != null) {
      out.setColorAt(i, tint.setHex(item.color));
      hasColors = true;
    }
  }
  out.instanceMatrix.needsUpdate = true;
  if (hasColors) out.instanceColor.needsUpdate = true;
  out.name = name;
  out.userData.instanceCount = items.length;
  out.castShadow = shadows && quality.shadows;
  out.receiveShadow = quality.shadows;
  scene.add(out);
  return out;
}

function storefronts(scene, solids, missionVariant) {
  const m = materials();
  const shops = streetShopLayout(missionVariant);
  const plaster = [], brick = [], interiors = [];
  const frames = [], shutters = [], thresholds = [], bollards = [];
  const floors = [], ceilings = [], fixtures = [], counters = [], shelves = [];
  const stock = [], backDoors = [], glass = [], debris = [], tyres = [];
  let slatCount = 0;

  const worldPart = (shop, cx, cz, yaw, lx, y, lz, w, h, d, extra = {}) => {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    return {
      x: cx + cos * lx + sin * lz,
      y,
      z: cz - sin * lx + cos * lz,
      w, h, d, ry: yaw, ...extra,
    };
  };
  const solidPart = part => {
    if (!solids) return;
    // All three shops face east or west, so local width/depth swap in the world AABB.
    solids.push(makeBox(part.x, part.y, part.z, part.d, part.h, part.w));
  };

  for (const shop of shops) {
    const west = shop.face === 'w';
    const nx = west ? -1 : 1;
    const faceX = shop.x + nx * (shop.w / 2 + 0.161);
    const rearX = shop.x - nx * (shop.w / 2 + 0.161);
    const rearInsideX = shop.x - nx * (shop.w / 2 - 0.161);
    const yaw = west ? -Math.PI / 2 : Math.PI / 2;
    const finish = shop.finish === 'brick' ? brick : plaster;

    // Photographic exterior skins over the two blank side walls, the rear return, the solid
    // one-metre storefront piers and the lintel. The collision boxes remain authoritative.
    for (const side of [-1, 1]) {
      finish.push({
        x: shop.x, y: 1.5, z: shop.z + side * (shop.d / 2 + 0.161),
        w: shop.w, h: 3, nx: 0, nz: side,
      });
      finish.push({
        x: faceX, y: 1.5, z: shop.z + side * 3,
        w: 1, h: 3, nx, nz: 0, repeatU: 1, repeatV: 1.4,
      });
    }
    finish.push({ x: rearX, y: 1.5, z: shop.z, w: shop.d, h: 3, nx: -nx, nz: 0 });
    finish.push({
      x: faceX, y: 2.8, z: shop.z, w: shop.d - 2, h: 0.4,
      nx, nz: 0, repeatU: 2, repeatV: 1,
    });
    // The real rear collision wall is visible through the five-metre opening. A darker copy
    // of the same plaster maps creates convincing room depth without a black cardboard plane.
    interiors.push({
      x: rearInsideX + nx * 0.012, y: 1.5, z: shop.z,
      w: shop.d - 0.5, h: 2.9, nx, nz: 0,
    });

    const cx = faceX, cz = shop.z;
    for (const lx of [-2.43, 2.43]) {
      frames.push(worldPart(shop, cx, cz, yaw, lx, 1.34, 0.055, 0.13, 2.68, 0.16));
    }
    frames.push(worldPart(shop, cx, cz, yaw, 0, 2.66, 0.055, 4.98, 0.13, 0.16));
    thresholds.push(worldPart(shop, cx, cz, yaw, 0, 0.055, 0.11, 4.82, 0.08, 0.34));
    shutters.push(worldPart(shop, cx, cz, yaw, 0, 2.82, 0.02, 5.18, 0.28, 0.3));
    for (let i = 0; i < 7; i++) {
      const bent = shop.damage === 1 && i > 4;
      shutters.push(worldPart(
        shop, cx, cz, yaw,
        bent ? 0.1 + (i - 4) * 0.12 : 0,
        2.58 - i * 0.085,
        0.105,
        4.76 - (bent ? (i - 4) * 0.22 : 0),
        0.055,
        0.045,
        { rz: bent ? -0.025 * (i - 4) : 0 },
      ));
      slatCount++;
    }
    for (const lx of [-1.72, 1.72]) {
      const part = worldPart(shop, cx, cz, yaw, lx, 0.42, 0.72, 1, 1, 1);
      bollards.push({ ...part, w: 1, h: 1, d: 1 });
    }

    // The original shop was an empty rectangular tunnel. Build a shallow but real interior
    // volume behind the breach: a different floor and ceiling, a back-room doorway, practical
    // lighting, wall shelving, and a counter that changes position between businesses.
    floors.push(worldPart(shop, cx, cz, yaw, 0, 0.19, -4.15, 4.78, 0.07, 7.6));
    ceilings.push(worldPart(shop, cx, cz, yaw, 0, 2.9, -4.15, 4.78, 0.08, 7.6));
    const rearDoor = worldPart(shop, cx, cz, yaw,
      shop.damage === 1 ? -1.0 : 0.85, 1.22, -8.32, 1.22, 2.18, 0.1);
    backDoors.push(rearDoor);
    for (const [lx, y, w, h] of [
      [-0.68, 1.22, 0.1, 2.34], [0.68, 1.22, 0.1, 2.34], [0, 2.36, 1.46, 0.1],
    ]) {
      frames.push(worldPart(
        shop, rearDoor.x, rearDoor.z, yaw, lx, y, 0.055, w, h, 0.12));
    }
    for (const lz of [-2.15, -5.75]) {
      fixtures.push(worldPart(shop, cx, cz, yaw,
        shop.damage === 1 ? 0.18 : -0.22, 2.81, lz, 1.35, 0.055, 0.24,
        { rz: shop.damage === 1 && lz < -4 ? -0.12 : 0 }));
    }

    // Every frontage keeps a clear 1.35 m entry lane, but display panes and mullions stop the
    // five-metre opening reading like a garage made from one Boolean subtraction.
    const doorwaySide = shop.damage === 2 ? -1 : 1;
    for (const lx of [-1.62, 0, 1.62]) {
      if (Math.sign(lx || doorwaySide) === doorwaySide && Math.abs(lx) > 1) continue;
      frames.push(worldPart(shop, cx, cz, yaw, lx, 1.34, -0.035, 0.075, 2.55, 0.1,
        { rz: shop.damage === 1 && lx === 0 ? -0.08 : 0 }));
    }
    if (shop.damage !== 1) {
      const paneX = doorwaySide > 0 ? -1.16 : 1.16;
      glass.push(worldPart(shop, cx, cz, yaw, paneX, 1.34, -0.08, 2.08, 2.34, 0.025));
    }

    const counter = worldPart(
      shop, cx, cz, yaw,
      shop.damage === 0 ? -1.38 : shop.damage === 1 ? 1.34 : 0.8,
      0.62,
      shop.damage === 0 ? -5.65 : shop.damage === 1 ? -3.95 : -5.25,
      shop.damage === 2 ? 2.75 : 1.75,
      0.9,
      0.72,
      { rz: shop.damage === 1 ? -0.09 : 0 },
    );
    counters.push(counter);
    solidPart(counter);

    // Side-wall bays share a single instanced batch. Product boxes use instance colours, so
    // the shelving reads as stocked without multiplying materials or draw calls.
    for (const side of [-1, 1]) {
      if (shop.damage === 0 && side < 0) continue;
      for (const lz of [-2.65, -5.15]) {
        const upright = worldPart(shop, cx, cz, yaw, side * 2.12, 1.05, lz,
          0.24, 1.9, 2.05);
        shelves.push(upright);
        solidPart(upright);
        for (const y of [0.42, 1.0, 1.58]) {
          shelves.push(worldPart(shop, cx, cz, yaw, side * 1.96, y, lz,
            0.55, 0.08, 2.0));
          for (let row = -1; row <= 1; row++) {
            const palette = shop.damage === 2
              ? [0x92785f, 0x687d71, 0x9a9a82]
              : [0x726754, 0x5e6d73, 0x77714f];
            stock.push(worldPart(shop, cx, cz, yaw,
              side * 1.74, y + 0.14, lz + row * 0.5,
              0.22, 0.22 + ((row + shop.damage) % 2) * 0.08, 0.28,
              { color: palette[(row + 3 + shop.damage) % palette.length] }));
          }
        }
      }
    }

    // The service shop gets workshop mass instead of retail shelves: two tyre pairs and a
    // battered bench. The attacked shop gets a fallen rack and masonry chunks in the entry.
    if (shop.damage === 0) {
      const bench = worldPart(shop, cx, cz, yaw, -1.45, 0.58, -2.75, 1.35, 0.82, 0.68);
      counters.push(bench);
      solidPart(bench);
      for (const lx of [-1.85, -1.25]) {
        for (const y of [0.48, 0.9]) {
          tyres.push(worldPart(shop, cx, cz, yaw, lx, y, -6.95, 1, 1, 1,
            { rx: 0, ry: yaw }));
        }
      }
    } else if (shop.damage === 1) {
      const fallen = worldPart(shop, cx, cz, yaw, -1.0, 0.42, -2.45,
        1.8, 0.28, 0.62, { rz: 0.28 });
      shelves.push(fallen);
      solidPart(fallen);
      for (let i = 0; i < 11; i++) {
        debris.push(worldPart(shop, cx, cz, yaw,
          -1.8 + (i % 4) * 0.82,
          0.24 + (i % 3) * 0.04,
          -0.85 - Math.floor(i / 4) * 0.72,
          0.22 + (i % 3) * 0.09,
          0.17 + (i % 2) * 0.08,
          0.28 + ((i + 1) % 3) * 0.08,
          { rx: i * 0.31, ry: yaw + i * 0.19, rz: i * 0.27,
            color: i % 3 === 0 ? 0x493f37 : 0x6a6861 }));
      }
    }
  }

  wallBatch(scene, 'storefront-plaster-shells', plaster, m.plaster, [17, 2.4]);
  wallBatch(scene, 'storefront-brick-shells', brick, m.brick, [22, 3]);
  wallBatch(scene, 'storefront-interior-backs', interiors, m.shopInterior, [17, 2.4]);
  instanceBatch(scene, 'storefront-frames', new THREE.BoxGeometry(1, 1, 1),
    m.storefrontMetal, frames);
  instanceBatch(scene, 'storefront-shutters', new THREE.BoxGeometry(1, 1, 1),
    m.storefrontMetal, shutters);
  instanceBatch(scene, 'storefront-thresholds', new THREE.BoxGeometry(1, 1, 1),
    m.stone, thresholds, false);
  instanceBatch(scene, 'storefront-bollards', new THREE.CylinderGeometry(0.075, 0.095, 0.84, 10),
    m.storefrontMetal, bollards);
  instanceBatch(scene, 'storefront-interior-shells', new THREE.BoxGeometry(1, 1, 1),
    m.shopFloor, [...floors, ...ceilings], false);
  instanceBatch(scene, 'storefront-interior-fixtures', new THREE.BoxGeometry(1, 1, 1),
    m.shopLight, fixtures, false);
  instanceBatch(scene, 'storefront-furnishings', new THREE.BoxGeometry(1, 1, 1),
    m.shopFurnishing, [
      ...counters.map(part => ({ ...part, color: 0x514235 })),
      ...shelves.map(part => ({ ...part, color: 0x292e30 })),
    ]);
  instanceBatch(scene, 'storefront-stock', new THREE.BoxGeometry(1, 1, 1),
    m.shopStock, stock, false);
  instanceBatch(scene, 'storefront-back-doors', new THREE.BoxGeometry(1, 1, 1),
    m.shopDark, backDoors, false);
  instanceBatch(scene, 'storefront-display-glass', new THREE.PlaneGeometry(1, 1),
    m.shopGlass, glass, false);
  instanceBatch(scene, 'storefront-entry-debris',
    new THREE.DodecahedronGeometry(0.5, 0), m.shopStock, debris);
  instanceBatch(scene, 'storefront-workshop-tyres',
    new THREE.TorusGeometry(0.28, 0.095, 8, 16), m.shopDark, tyres);
  scene.userData.storefrontStats = {
    shops: shops.length,
    shellPanels: plaster.length + brick.length,
    interiorBacks: interiors.length,
    frames: frames.length,
    shutters: shutters.length,
    slats: slatCount,
    bollards: bollards.length,
    floors: floors.length,
    ceilings: ceilings.length,
    fixtures: fixtures.length,
    counters: counters.length,
    shelves: shelves.length,
    stock: stock.length,
    backDoors: backDoors.length,
    displayGlass: glass.length,
    debris: debris.length,
    tyres: tyres.length,
    solidFixtures: counters.length
      + shelves.filter(part => part.h > 0.25).length,
  };
  scene.userData.streetShopLayout = shops.map(
    ({ x, z, face, damage }) => ({ x, z, face, damage }),
  );
}

function plane(scene, w, h, material, x, y, z, rx = -Math.PI / 2, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.receiveShadow = quality.shadows;
  scene.add(mesh);
  return mesh;
}

function box(scene, w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = quality.shadows;
  scene.add(mesh);
  return mesh;
}

function facade(scene, x, normal, material, batches) {
  // wall() is a 30cm-thick box, so its street face is already 15cm proud of the authored
  // centreline. Clear that face by 12mm or the finish plane sits invisibly inside the wall.
  plane(scene, 110, 8.9, material, x + normal * 0.162, 4.5, 0, 0,
    normal > 0 ? Math.PI / 2 : -Math.PI / 2);
  // Raised floor bands and pilasters break the 110m wall into human-sized bays and catch
  // grazing light. Texture detail cannot repair an unbroken box silhouette by itself.
  for (const y of [3.0, 6.0, 8.75]) {
    batches.stone.push({ x: x + normal * 0.20, y, z: 0, w: 0.22, h: 0.14, d: 110 });
  }
  plane(scene, 110, 0.75, materials().damp, x + normal * 0.166, 0.5, 0, 0,
    normal > 0 ? Math.PI / 2 : -Math.PI / 2);
}

function roadMarkings(scene) {
  const markings = [];
  for (let z = -47; z < 52; z += 5) {
    markings.push({ x: 0, y: 0.026, z, w: 0.24, d: 2.35 });
  }
  for (const z of [-42, 28]) {
    for (let x = -7; x <= 7; x += 2) {
      markings.push({ x, y: 0.027, z, w: 1.05, d: 4.2 });
    }
  }
  groundBatch(scene, 'road-markings-batch', markings, materials().roadPaint);
  const covers = [[4.2, 17], [-4.4, -5], [3.1, -43]].map(([x, z]) => ({
    x, y: 0.02, z, w: 1, h: 1, d: 1,
  }));
  instanceBatch(scene, 'utility-covers', new THREE.CylinderGeometry(0.56, 0.56, 0.025, 24),
    materials().trim, covers, false);
}

function roadDamage(scene) {
  const R = rng(202607281);
  const tiles = [0, 2, 3, 6, 7, 8, 10, 11, 14, 15];
  const items = [
    { x: -3.5, y: 0.021, z: 14, w: 4.6, d: 6.8, rot: 0.08, tile: 1 },
    { x: 4.7, y: 0.021, z: -12, w: 3.5, d: 5.6, rot: -0.04, tile: 9 },
    { x: -2, y: 0.021, z: -39, w: 6.4, d: 2.8, rot: 1.46, tile: 1 },
    { x: 2.8, y: 0.021, z: 36, w: 4.7, d: 4.4, rot: 0.32, tile: 0 },
    { x: -2.7, y: 0.021, z: -2, w: 4.4, d: 4.0, rot: -0.45, tile: 8 },
    { x: 3.6, y: 0.021, z: -30, w: 4.9, d: 4.2, rot: 0.68, tile: 0 },
  ];
  for (let i = 0; i < 31; i++) {
    const tile = tiles[Math.floor(R() * tiles.length)];
    const stain = [2, 6, 7, 10, 14, 15].includes(tile);
    const tyre = tile === 3 || tile === 11;
    const base = stain ? 1.45 : tyre ? 2.4 : 2.0;
    items.push({
      x: -7.0 + R() * 14.0,
      y: 0.020 + (i % 3) * 0.0006,
      z: -54 + R() * 108,
      w: base * (0.75 + R() * 1.0),
      d: base * (0.72 + R() * 1.25),
      rot: R() * Math.PI * 2,
      tile,
    });
  }
  const mesh = groundBatch(scene, 'road-damage-atlas', items, materials().roadDamage);
  mesh.userData.signature = items.reduce(
    (sum, item, i) => (sum + Math.round(item.x * 31 + item.z * 17) + item.tile * (i + 3)) >>> 0,
    0,
  );
}

function wetAndContact(scene) {
  const wet = [];
  for (const [x, z, sx, sz, r] of [
    [-6.7, 17, 2.6, 7.5, .18], [6.4, -10, 1.8, 5.2, -.12],
    [-7.2, -35, 2.0, 6.8, .08], [7.1, 36, 1.4, 4.5, -.2],
  ]) {
    wet.push({ x, y: 0.022, z, w: sx * 2, d: sz * 2, rot: r });
  }
  groundBatch(scene, 'wet-patches-batch', wet, materials().wet);
  const contacts = [];
  for (const [x, z, sx, sz] of [
    [-4, 25, 5.2, 2.4], [3, 5, 2.4, 5.2], [-2, -18, 5.2, 2.4],
    [5, -35, 2.4, 5.2], [-6, 33, 5.2, 2.4], [6, -28, 2.4, 5.2],
  ]) {
    contacts.push({ x, y: 0.024, z, w: sx, d: sz });
  }
  groundBatch(scene, 'contact-shadows-batch', contacts, materials().shadow);
}

function streetLights(scene) {
  // Six non-shadowing point lights are six passes, versus 36 passes with cube shadows.
  for (const [x, z] of [
    [-11.5, 46], [11.5, 25], [-11.5, 18],
    [11.5, -3], [-11.5, -10], [11.5, -31],
  ]) {
    const light = new THREE.PointLight(0xffd29a, 3.2, 15, 2);
    light.position.set(x, 5.7, z);
    scene.add(light);
  }
}

export function addStreetSweepArt(scene, solids, missionVariant = 0) {
  if (!quality.pbr) return;
  const m = materials();
  const facadeBatches = { stone: [] };
  plane(scene, 60, 130, m.asphalt, 0, 0.006, 0);
  plane(scene, 8, 120, m.sidewalk, -12, 0.156, 0);
  plane(scene, 8, 120, m.sidewalk, 12, 0.156, 0);
  box(scene, 0.22, 0.15, 120, m.curb, -8.03, 0.075, 0);
  box(scene, 0.22, 0.15, 120, m.curb, 8.03, 0.075, 0);
  facade(scene, -16, 1, m.brick, facadeBatches);
  facade(scene, 16, -1, m.plaster, facadeBatches);
  instanceBatch(scene, 'facade-floor-bands', new THREE.BoxGeometry(1, 1, 1),
    m.stone, facadeBatches.stone);
  storefronts(scene, solids, missionVariant);
  roadDamage(scene);
  roadMarkings(scene);
  wetAndContact(scene);
  streetLights(scene);
}
