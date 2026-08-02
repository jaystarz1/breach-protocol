// Desktop visual replacements for authored collision/blockout props.
import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { mergeGeometries, toCreasedNormals } from '../lib/BufferGeometryUtils.js';
import { quality } from './quality.js';
import { rng } from './world.js';
import { photoSurfaces, surfaces } from './textures.js';

let authoredVehicleSources = null;
if (quality.desktop) {
  try {
    const loader = new GLTFLoader();
    const [
      fallbackSedan, fallbackSuv, wreck, covered, abandonedSedan, intactSedan, intactSuv,
      militaryTransport,
    ] = await Promise.all([
      loader.loadAsync('./assets/vehicles/CarSedan.glb'),
      loader.loadAsync('./assets/vehicles/CarSUV.glb'),
      loader.loadAsync('./assets/vehicles/BrokenCar.glb'),
      loader.loadAsync('./assets/vehicles/covered_car/covered_car_1k.gltf')
        .catch(error => {
          console.warn('[bp] photographic covered vehicle unavailable; using damaged shell', error);
          return null;
        }),
      loader.loadAsync('./assets/vehicles/abandoned_sedan/scene.gltf')
        .catch(error => {
          console.warn('[bp] photographic abandoned sedan unavailable; using intact hatch', error);
          return null;
        }),
      loader.loadAsync('./assets/vehicles/kiri_sedan/kiri10.glb')
        .catch(error => {
          console.warn('[bp] detailed intact sedan unavailable; using blockout sedan', error);
          return null;
        }),
      loader.loadAsync('./assets/vehicles/generic_suv/generic_suv.glb')
        .catch(error => {
          console.warn('[bp] detailed intact SUV unavailable; using blockout SUV', error);
          return null;
        }),
      loader.loadAsync('./assets/vehicles/military_transport/military-transport.glb')
        .catch(error => {
          console.warn('[bp] authored military transport unavailable; using procedural truck', error);
          return null;
        }),
    ]);
    let coveredMaterial = null;
    covered?.scene.traverse(object => {
      if (!coveredMaterial && object.isMesh) coveredMaterial = object.material;
    });
    let abandonedSedanMaterial = null;
    abandonedSedan?.scene.traverse(object => {
      if (!abandonedSedanMaterial && object.isMesh) {
        abandonedSedanMaterial = object.material;
      }
    });
    authoredVehicleSources = {
      sedan: {
        scene: intactSedan?.scene || fallbackSedan.scene,
        bodyMaterials: intactSedan
          ? new Set(['solar_body'])
          : new Set(['LightBlue']),
        scale: intactSedan
          ? new THREE.Vector3(0.02682, 0.028568, 0.028867)
          : new THREE.Vector3(1.39, 1.42, 1.18),
        rotationY: intactSedan ? 0 : -Math.PI / 2,
        nativeParts: !!intactSedan,
      },
      hatch: {
        // A photographed, genuinely damaged sedan occupies the hatch-sized collision slot.
        // It brings a modeled cabin, engine bay, open panels and baked deterioration into the
        // ordinary street fleet without increasing draw calls or inventing another collider.
        scene: abandonedSedan?.scene || fallbackSedan.scene,
        bodyMaterials: abandonedSedan ? new Set() : new Set(['LightBlue']),
        scale: abandonedSedan
          ? new THREE.Vector3(0.2, 0.217, 0.152)
          : new THREE.Vector3(1.3, 1.39, 1.16),
        photographic: !!abandonedSedan,
        sourceMaterial: abandonedSedanMaterial,
        materialKey: 'abandoned-sedan',
        materialTint: 0xffffff,
      },
      suv: {
        scene: intactSuv?.scene || fallbackSuv.scene,
        bodyMaterials: intactSuv ? new Set(['Body']) : new Set(['White']),
        scale: intactSuv
          ? new THREE.Vector3(1.00283, 1.11223, 0.98476)
          : new THREE.Vector3(1.13, 1.2, 0.976),
        rotationY: -Math.PI / 2,
        nativeParts: !!intactSuv,
      },
      wreck: {
        scene: covered?.scene || wreck.scene,
        bodyMaterials: new Set(),
        scale: covered
          ? new THREE.Vector3(0.972, 1.19, 1.078)
          : new THREE.Vector3(0.775, 0.955, 0.731),
        photographic: !!covered,
        sourceMaterial: coveredMaterial,
        materialKey: 'covered',
        materialTint: 0xd5d0c5,
      },
      militaryTransport: militaryTransport ? {
        // Source bounds are 2.64m wide, 2.4m high and 5.85m long. Rotate into the game's
        // local -X-forward convention and fit the authoritative 6.6 x 2.45m truck collider.
        scene: militaryTransport.scene,
        bodyMaterials: new Set([
          'Truck', 'TruckDark', 'TruckDark.001', 'TruckTop', 'GrayLight',
        ]),
        scale: new THREE.Vector3(1.12, 1.1, 0.93),
        rotationY: -Math.PI / 2,
      } : null,
    };
    if (!authoredVehicleSources.militaryTransport) {
      delete authoredVehicleSources.militaryTransport;
    }
    for (const source of Object.values(authoredVehicleSources)) {
      source.scene.updateMatrixWorld(true);
      source.cache = new Map();
    }
  } catch (error) {
    console.warn('[bp] authored vehicle assets unavailable; using procedural fleet', error);
  }
}

let frontlineInteriorAtlas = null;
if (quality.desktop) {
  try {
    frontlineInteriorAtlas = await new THREE.TextureLoader().loadAsync(
      './assets/windows/frontline-interiors-atlas-v2.webp');
    frontlineInteriorAtlas.colorSpace = THREE.SRGBColorSpace;
    frontlineInteriorAtlas.anisotropy = Math.min(quality.maxAnisotropy || 4, 8);
    frontlineInteriorAtlas.generateMipmaps = true;
    frontlineInteriorAtlas.wrapS = frontlineInteriorAtlas.wrapT = THREE.ClampToEdgeWrapping;
  } catch (error) {
    console.warn('[bp] photographic window interiors unavailable; using material fallback', error);
  }
}

const mats = {};
const material = (key, make) => mats[key] || (mats[key] = make());
const standard = (key, color, roughness = 0.7, metalness = 0) =>
  material(key, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));

class InstanceBatcher {
  constructor(scene) {
    this.scene = scene;
    this.batches = new Map();
  }

  add(key, geometry, mat, matrix, shadows = false, color = null) {
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { geometry, mat, matrices: [], colors: [], shadows };
      this.batches.set(key, batch);
    }
    batch.matrices.push(matrix.clone());
    batch.colors.push(color == null ? null : new THREE.Color(color));
  }

  flush() {
    for (const [key, batch] of this.batches) {
      const out = new THREE.InstancedMesh(
        batch.geometry, batch.mat, batch.matrices.length);
      out.name = key;
      out.userData.instanceCount = batch.matrices.length;
      for (let i = 0; i < batch.matrices.length; i++) {
        out.setMatrixAt(i, batch.matrices[i]);
        if (batch.colors[i]) out.setColorAt(i, batch.colors[i]);
      }
      out.instanceMatrix.needsUpdate = true;
      if (out.instanceColor) out.instanceColor.needsUpdate = true;
      out.castShadow = batch.shadows && quality.shadows;
      out.receiveShadow = quality.shadows;
      out.frustumCulled = true;
      this.scene.add(out);
    }
  }
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const FACADE_PANEL_GEO = (() => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const uv = geometry.attributes.uv;
  // Four photographic plaster repeats across each property cap. Instanced scale changes the
  // lot width but not the UVs, so this fixed repeat avoids smearing one photograph over 12m.
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 4);
  uv.needsUpdate = true;
  return geometry;
})();
const FACADE_SKIN_GEO = (() => {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const uv = geometry.attributes.uv;
  // Each property gets several repeats of the photographed surface rather than one image
  // stretched across an entire 8–13 metre elevation.
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 3);
  }
  uv.needsUpdate = true;
  return geometry;
})();
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
const FACADE_BREACH_GEO = (() => {
  // An asymmetric blown-out wall section. A larger masonry copy sits behind the dark copy,
  // creating a real jagged reveal instead of a circular black "damage decal".
  const shape = new THREE.Shape();
  shape.moveTo(-0.48, -0.5);
  shape.lineTo(0.5, -0.46);
  shape.lineTo(0.46, 0.08);
  shape.lineTo(0.34, 0.43);
  shape.lineTo(0.08, 0.5);
  shape.lineTo(-0.14, 0.42);
  shape.lineTo(-0.4, 0.5);
  shape.lineTo(-0.49, 0.16);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
})();
const FACADE_COLLAPSE_RUBBLE_GEO = (() => {
  const geometry = new THREE.DodecahedronGeometry(0.5, 0);
  geometry.scale(1, 0.64, 0.72);
  return geometry;
})();
const WINDOW_INTERIOR_GEOS = Array.from({ length: 4 }, (_, tile) => {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const uv = geometry.attributes.uv;
  const column = tile % 2;
  const rowFromTop = Math.floor(tile / 2);
  // Image generation left a clean 13px-equivalent black guard around each 512px tile.
  // Crop inside it so minification cannot bleed a neighbouring room through the frame.
  const pad = 0.013;
  const u0 = column * 0.5 + pad;
  const u1 = (column + 1) * 0.5 - pad;
  const v0 = rowFromTop === 0 ? 0.5 + pad : pad;
  const v1 = rowFromTop === 0 ? 1 - pad : 0.5 - pad;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      THREE.MathUtils.lerp(u0, u1, uv.getX(i)),
      THREE.MathUtils.lerp(v0, v1, uv.getY(i)),
    );
  }
  uv.needsUpdate = true;
  return geometry;
});
const STALL_POST = new THREE.CylinderGeometry(0.045, 0.045, 3.05, 10);
const STALL_CABBAGE = (() => {
  // Produce is repeated hundreds of times and never fills enough pixels to justify a
  // subdivided polyhedron. This low-segment sphere keeps a rounded silhouette while
  // spending less geometry than the former 144-triangle dodecahedron.
  const geometry = new THREE.SphereGeometry(0.13, 8, 5);
  geometry.scale(1.05, 0.82, 1);
  return geometry;
})();
const STALL_SQUASH = (() => {
  const geometry = new THREE.SphereGeometry(0.13, 10, 7);
  geometry.scale(0.78, 1.16, 0.78);
  return geometry;
})();
const STALL_LOAF = (() => {
  const geometry = new THREE.CapsuleGeometry(0.085, 0.2, 2, 6);
  geometry.rotateZ(Math.PI / 2);
  return geometry;
})();
const STALL_BULB = new THREE.SphereGeometry(0.075, 10, 6);
const STALL_CANOPY = (() => {
  const geometry = new THREE.PlaneGeometry(5.35, 2.65, 10, 5);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) / 2.68;
    positions.setZ(i, -0.12 * (1 - x * x));
  }
  geometry.computeVertexNormals();
  return geometry;
})();
const mergedStallBoxes = (parts) => {
  const geometries = parts.map(([x, y, z, sx, sy, sz]) => {
    const geometry = UNIT_BOX.clone();
    geometry.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion(),
      new THREE.Vector3(sx, sy, sz),
    ));
    return geometry;
  });
  const geometry = mergeGeometries(geometries, false);
  for (const part of geometries) part.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};
const STALL_TRAY_GEO = mergedStallBoxes([
  [0, 0, 0, 1, 0.045, 0.66],
  [0, 0.09, -0.31, 1, 0.16, 0.055],
  [0, 0.09, 0.31, 1, 0.16, 0.055],
  [-0.47, 0.09, 0, 0.055, 0.16, 0.62],
  [0.47, 0.09, 0, 0.055, 0.16, 0.62],
]);
const STALL_CRATE_GEO = mergedStallBoxes([
  [0, -0.25, 0, 0.96, 0.055, 0.64],
  [-0.45, 0, -0.29, 0.055, 0.55, 0.055],
  [0.45, 0, -0.29, 0.055, 0.55, 0.055],
  [-0.45, 0, 0.29, 0.055, 0.55, 0.055],
  [0.45, 0, 0.29, 0.055, 0.55, 0.055],
  [0, -0.13, -0.3, 0.9, 0.075, 0.045],
  [0, 0.06, -0.3, 0.9, 0.075, 0.045],
  [0, 0.25, -0.3, 0.9, 0.075, 0.045],
  [0, -0.13, 0.3, 0.9, 0.075, 0.045],
  [0, 0.06, 0.3, 0.9, 0.075, 0.045],
  [0, 0.25, 0.3, 0.9, 0.075, 0.045],
]);
const SUPPLY_CRATE_GEO = mergedStallBoxes([
  [0, -0.46, 0, 0.94, 0.08, 0.94],
  [0, 0.46, 0, 0.94, 0.08, 0.94],
  [-0.44, 0, -0.44, 0.1, 0.9, 0.1],
  [0.44, 0, -0.44, 0.1, 0.9, 0.1],
  [-0.44, 0, 0.44, 0.1, 0.9, 0.1],
  [0.44, 0, 0.44, 0.1, 0.9, 0.1],
  [0, -0.3, -0.455, 0.8, 0.17, 0.055],
  [0, 0, -0.455, 0.8, 0.17, 0.055],
  [0, 0.3, -0.455, 0.8, 0.17, 0.055],
  [0, -0.3, 0.455, 0.8, 0.17, 0.055],
  [0, 0, 0.455, 0.8, 0.17, 0.055],
  [0, 0.3, 0.455, 0.8, 0.17, 0.055],
  [-0.455, -0.3, 0, 0.055, 0.17, 0.8],
  [-0.455, 0, 0, 0.055, 0.17, 0.8],
  [-0.455, 0.3, 0, 0.055, 0.17, 0.8],
  [0.455, -0.3, 0, 0.055, 0.17, 0.8],
  [0.455, 0, 0, 0.055, 0.17, 0.8],
  [0.455, 0.3, 0, 0.055, 0.17, 0.8],
]);
const STALL_VALANCE_GEO = (() => {
  const segments = 12;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const x = -2.65 + i / segments * 5.3;
    const bottom = -0.29 + (i % 3 === 1 ? 0.11 : i % 3 === 2 ? 0.04 : 0);
    positions.push(x, 0, 0, x, bottom, 0);
    uvs.push(i / segments, 1, i / segments, 0);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
})();
const localMatrix = new THREE.Matrix4();
const localPosition = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localScale = new THREE.Vector3();
const localEuler = new THREE.Euler();

function instanceMatrix(parent, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  localPosition.set(x, y, z);
  localEuler.set(rx, ry, rz);
  localQuaternion.setFromEuler(localEuler);
  localScale.set(sx, sy, sz);
  localMatrix.compose(localPosition, localQuaternion, localScale);
  return parent.clone().multiply(localMatrix);
}

function mesh(geometry, mat, shadows = true) {
  const out = new THREE.Mesh(geometry, mat);
  out.castShadow = shadows && quality.shadows;
  out.receiveShadow = quality.shadows;
  return out;
}

function bakeVehicleSurfaceData(
  geometry, sourceMaterial, bodyMaterials, tint, objectName = '',
) {
  const position = geometry.attributes.position;
  const values = new Float32Array(position.count * 3);
  const paintValues = new Float32Array(position.count);
  const glassValues = new Float32Array(position.count);
  const rubberValues = new Float32Array(position.count);
  const metalValues = new Float32Array(position.count);
  const lightValues = new Float32Array(position.count);
  const materials = Array.isArray(sourceMaterial) ? sourceMaterial : [sourceMaterial];
  const tintColor = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.08);
  const fill = (start, count, source) => {
    const materialName = source?.name || '';
    const label = `${objectName} ${materialName}`.toLowerCase();
    const paint = bodyMaterials.has(materialName);
    const glass = /(window|windscreen|windshield|glass)/.test(label);
    const light = /(headlight|taillight|tail.?light|lamp|material\.007)/.test(label);
    const wheelPart = /(wheel|tyre|tire)/.test(objectName.toLowerCase());
    const rubber = wheelPart && /(black|rubber|tyre|tire)/.test(label);
    const metal = !paint && !glass && !rubber && !light
      && /(grey|gray|chrome|metal|rim|hub)/.test(label);
    const colour = paint
      ? tintColor
      : source?.color || new THREE.Color(0xffffff);
    const end = Math.min(position.count, start + count);
    for (let i = start; i < end; i++) {
      values[i * 3] = colour.r;
      values[i * 3 + 1] = colour.g;
      values[i * 3 + 2] = colour.b;
      paintValues[i] = paint ? 1 : 0;
      glassValues[i] = glass ? 1 : 0;
      rubberValues[i] = rubber ? 1 : 0;
      metalValues[i] = metal ? 1 : 0;
      lightValues[i] = light ? 1 : 0;
    }
  };
  if (geometry.groups?.length) {
    for (const group of geometry.groups) {
      fill(group.start, group.count, materials[group.materialIndex] || materials[0]);
    }
  } else {
    fill(0, position.count, materials[0]);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  geometry.setAttribute('vehiclePaint', new THREE.BufferAttribute(paintValues, 1));
  geometry.setAttribute('vehicleGlass', new THREE.BufferAttribute(glassValues, 1));
  geometry.setAttribute('vehicleRubber', new THREE.BufferAttribute(rubberValues, 1));
  geometry.setAttribute('vehicleMetal', new THREE.BufferAttribute(metalValues, 1));
  geometry.setAttribute('vehicleLight', new THREE.BufferAttribute(lightValues, 1));
}

function authoredVehicleGeometry(kind, tint) {
  const source = authoredVehicleSources?.[kind];
  if (!source) return null;
  const key = source.bodyMaterials.size ? new THREE.Color(tint).getHexString() : 'fixed';
  if (source.cache.has(key)) return source.cache.get(key);

  const geometries = [];
  let sourceParts = 0;
  source.scene.traverse(object => {
    if (!object.isMesh || !object.geometry) return;
    const geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    }
    if (!source.photographic) {
      bakeVehicleSurfaceData(
        geometry, object.material, source.bodyMaterials, tint, object.name);
    }
    geometry.applyMatrix4(object.matrixWorld);
    geometries.push(geometry);
    sourceParts += Array.isArray(object.material)
      ? Math.max(1, object.geometry.groups?.length || object.material.length)
      : 1;
  });
  if (!geometries.length) return null;
  let geometry = mergeGeometries(geometries, false);
  for (const part of geometries) part.dispose();
  if (!geometry) return null;

  // Source vehicles face -Z; the game's local vehicle convention faces -X. Non-uniform scale
  // fits the existing authoritative collision dimensions without making the wheels or cabin
  // unnaturally wide simply to reach the correct bumper-to-bumper length.
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(
    source.rotationY ?? -Math.PI / 2));
  geometry.scale(source.scale.x, source.scale.y, source.scale.z);
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox.min.y, 0);
  // Preserve door and glass boundaries, but smooth the broad low-poly bonnet and quarter-panel
  // triangulation. The previous 45-degree crease exposed every source facet under street lamps.
  if (kind !== 'wreck' && !source.photographic) {
    geometry = toCreasedNormals(geometry, Math.PI * 0.38);
  }
  geometry.clearGroups();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.authoredVehicle = true;
  geometry.userData.sourceParts = sourceParts;
  geometry.userData.kind = kind;
  source.cache.set(key, geometry);
  return geometry;
}

function nativeVehiclePaintMaterial(source, kind) {
  return material(`authored-vehicle-${kind}-native-paint`, () => {
    let sourceMaterial = null;
    source.scene.traverse(object => {
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      sourceMaterial ||= materials.find(candidate =>
        source.bodyMaterials.has(candidate?.name));
    });
    const out = new THREE.MeshPhysicalMaterial({
      name: `authored-vehicle-${kind}-native-paint`,
      color: 0xffffff,
      normalMap: sourceMaterial?.normalMap || null,
      normalScale: sourceMaterial?.normalScale?.clone() || new THREE.Vector2(1, 1),
      roughness: 0.38,
      roughnessMap: sourceMaterial?.roughnessMap || null,
      metalness: 0.12,
      metalnessMap: sourceMaterial?.metalnessMap || null,
      clearcoat: 0.62,
      clearcoatRoughness: 0.24,
      envMapIntensity: 1.05,
    });
    for (const texture of [
      out.normalMap, out.roughnessMap, out.metalnessMap,
    ]) {
      if (texture) texture.anisotropy = Math.min(quality.maxAnisotropy || 4, 8);
    }
    return out;
  });
}

function nativeVehiclePartMaterial(sourceMaterial, kind, role) {
  if (role === 'body') return nativeVehiclePaintMaterial(
    authoredVehicleSources[kind], kind);
  const key = `authored-vehicle-${kind}-native-${role}`;
  return material(key, () => {
    const out = sourceMaterial.clone();
    out.name = key;
    out.side = THREE.DoubleSide;
    out.depthWrite = !out.transparent;
    for (const texture of [
      out.map, out.normalMap, out.roughnessMap, out.metalnessMap, out.aoMap,
    ]) {
      if (texture) texture.anisotropy = Math.min(quality.maxAnisotropy || 4, 8);
    }
    return out;
  });
}

function authoredNativeVehicleParts(kind) {
  const source = authoredVehicleSources?.[kind];
  if (!source?.nativeParts) return null;
  if (source.nativePartsCache) return source.nativePartsCache;

  const groups = new Map();
  let sourceParts = 0;
  source.scene.traverse(object => {
    if (!object.isMesh || !object.geometry) return;
    const sourceMaterial = Array.isArray(object.material)
      ? object.material[0]
      : object.material;
    if (!sourceMaterial || /shadow/i.test(sourceMaterial.name)) return;
    const role = source.bodyMaterials.has(sourceMaterial.name)
      ? 'body'
      : (sourceMaterial.name || object.name || 'detail')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const key = `${role}:${sourceMaterial.uuid}`;
    if (!groups.has(key)) {
      groups.set(key, { role, sourceMaterial, geometries: [] });
    }
    const geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    }
    geometry.applyMatrix4(object.matrixWorld);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(
      source.rotationY ?? -Math.PI / 2));
    geometry.scale(source.scale.x, source.scale.y, source.scale.z);
    groups.get(key).geometries.push(geometry);
    sourceParts++;
  });

  const aggregateBounds = new THREE.Box3();
  let assemblyVertices = 0;
  for (const group of groups.values()) {
    for (const geometry of group.geometries) {
      geometry.computeBoundingBox();
      aggregateBounds.union(geometry.boundingBox);
      assemblyVertices += geometry.attributes.position.count;
    }
  }
  const lift = -aggregateBounds.min.y;
  const assemblySize = aggregateBounds.getSize(new THREE.Vector3());
  const parts = [];
  for (const group of groups.values()) {
    let geometry = mergeGeometries(group.geometries, false);
    for (const sourceGeometry of group.geometries) sourceGeometry.dispose();
    if (!geometry) continue;
    geometry.translate(0, lift, 0);
    geometry.clearGroups();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.kind = kind;
    geometry.userData.assemblyPart = group.role;
    if (group.role === 'body') {
      geometry.userData.authoredVehicle = true;
      geometry.userData.sourceParts = sourceParts;
      geometry.userData.nativePartCount = groups.size;
      geometry.userData.assemblyVertices = assemblyVertices;
      geometry.userData.authoredBounds = assemblySize.toArray();
    }
    parts.push({
      role: group.role,
      geometry,
      material: nativeVehiclePartMaterial(
        group.sourceMaterial, kind, group.role),
    });
  }
  source.nativePartsCache = parts;
  return parts;
}

function loftedVehicleShell(stations, topWidth = 0.78) {
  // The old vehicles were side silhouettes extruded to a constant width. They looked
  // acceptable exactly side-on, but the constant-width bonnet, cabin and boot exposed the
  // blockout immediately from a first-person three-quarter view. This indexed loft uses a
  // rounded sixteen-point transverse section at every longitudinal station, allowing the nose,
  // shoulders, roof and tail to taper independently while remaining one instanced geometry.
  const smoothStations = [];
  const catmull = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t
      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
      + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  // Three interpolated rings per authored interval remove the long planar bonnet, roof and
  // quarter-panel facets that made the prior "loft" look like a paper model up close.
  for (let i = 0; i < stations.length - 1; i++) {
    const p0 = stations[Math.max(0, i - 1)];
    const p1 = stations[i];
    const p2 = stations[i + 1];
    const p3 = stations[Math.min(stations.length - 1, i + 2)];
    for (let step = 0; step < 3; step++) {
      const t = step / 3;
      smoothStations.push(p1.map((value, axis) => catmull(
        p0[axis], value, p2[axis], p3[axis], t)));
    }
  }
  smoothStations.push(stations[stations.length - 1]);
  const section = [
    [-0.72, 0], [-0.89, 0.045], [-0.98, 0.16], [-1, 0.36],
    [-0.975, 0.55], [-0.91, 0.72], [-topWidth, 0.92], [-topWidth * 0.82, 1],
    [topWidth * 0.82, 1], [topWidth, 0.92], [0.91, 0.72], [0.975, 0.55],
    [1, 0.36], [0.98, 0.16], [0.89, 0.045], [0.72, 0],
  ];
  const positions = [];
  const uvs = [];
  const indices = [];
  const ring = section.length;

  for (let s = 0; s < smoothStations.length; s++) {
    const [x, bottom, top, halfWidth] = smoothStations[s];
    const height = top - bottom;
    for (const [zFactor, yFactor] of section) {
      positions.push(x, bottom + height * yFactor, zFactor * halfWidth);
      uvs.push(s / (smoothStations.length - 1), yFactor);
    }
  }
  for (let s = 0; s < smoothStations.length - 1; s++) {
    const next = (s + 1) * ring;
    const here = s * ring;
    for (let i = 0; i < ring; i++) {
      const j = (i + 1) % ring;
      indices.push(here + i, next + i, next + j, here + i, next + j, here + j);
    }
  }
  // Close both ends. The cap is rarely exposed, but a closed volume gives correct lighting
  // at damaged bumpers and prevents a bright road sliver from showing through the nose.
  for (const [station, reverse] of [[0, true], [smoothStations.length - 1, false]]) {
    const center = positions.length / 3;
    const [x, bottom, top] = smoothStations[station];
    positions.push(x, (bottom + top) / 2, 0);
    uvs.push(station / (smoothStations.length - 1), 0.5);
    const base = station * ring;
    for (let i = 0; i < ring; i++) {
      const j = (i + 1) % ring;
      // Minimum-X faces point outward toward -X; maximum-X faces point toward +X.
      if (reverse) indices.push(center, base + j, base + i);
      else indices.push(center, base + i, base + j);
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

function doubleSidedWindowPanels(polygons, sideOffset) {
  // Separate panes leave real painted B/C pillars between windows. The previous single black
  // extrusion covered the whole side of the cabin and read as a toy-car sticker.
  const positions = [];
  const uvs = [];
  const indices = [];
  for (const side of [-1, 1]) {
    for (const polygon of polygons) {
      const base = positions.length / 3;
      for (let i = 0; i < polygon.length; i++) {
        const [x, y] = polygon[i];
        positions.push(x, y, side * sideOffset);
        uvs.push(i === 0 || i === polygon.length - 1 ? 0 : 1, y);
      }
      for (let i = 1; i < polygon.length - 1; i++) {
        if (side > 0) indices.push(base, base + i, base + i + 1);
        else indices.push(base, base + i + 1, base + i);
      }
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

function transverseWindowPane(bottom, top) {
  const [bottomX, bottomY, bottomHalf] = bottom;
  const [topX, topY, topHalf] = top;
  const across = 8;
  const positions = [];
  const uvs = [];
  const indices = [];
  const outward = Math.sign(bottomX - topX) || 1;
  for (let i = 0; i <= across; i++) {
    const t = i / across;
    const side = t * 2 - 1;
    const bow = outward * 0.045 * (1 - side * side);
    positions.push(
      bottomX + bow, bottomY, side * bottomHalf,
      topX + bow, topY, side * topHalf,
    );
    uvs.push(t, 0, t, 1);
  }
  for (let i = 0; i < across; i++) {
    const base = i * 2;
    indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
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

const SEDAN_LOWER = loftedVehicleShell([
  [-2.25, 0.31, 0.49, 0.68], [-2.12, 0.27, 0.76, 0.9],
  [-1.73, 0.25, 0.91, 0.98], [-0.9, 0.24, 0.96, 0.99],
  [0.75, 0.24, 0.96, 1], [1.69, 0.25, 0.9, 0.97],
  [2.12, 0.28, 0.71, 0.88], [2.25, 0.33, 0.48, 0.65],
], 0.8);
const SEDAN_CABIN = loftedVehicleShell([
  [-1.17, 0.88, 0.95, 0.72], [-0.73, 0.89, 1.46, 0.83],
  [-0.39, 0.9, 1.57, 0.86], [0.7, 0.91, 1.55, 0.86],
  [1.15, 0.92, 1.28, 0.82], [1.36, 0.93, 0.99, 0.7],
], 0.72);
const SEDAN_WINDOW = doubleSidedWindowPanels([
  [[-0.98, 0.98], [-0.53, 1.4], [-0.29, 1.47], [0.05, 1.46], [0.05, 0.98]],
  [[0.24, 0.98], [0.24, 1.46], [0.66, 1.44], [1.13, 0.99]],
], 0.86);
const SEDAN_WINDSCREEN = transverseWindowPane(
  [-1.08, 0.97, 0.78], [-0.51, 1.48, 0.72]);
const SEDAN_REAR_GLASS = transverseWindowPane(
  [1.25, 0.98, 0.77], [0.68, 1.47, 0.72]);
const HATCH_LOWER = loftedVehicleShell([
  [-2.06, 0.31, 0.48, 0.66], [-1.94, 0.27, 0.74, 0.88],
  [-1.55, 0.24, 0.91, 0.96], [-0.75, 0.23, 0.96, 0.99],
  [1.15, 0.24, 0.96, 0.99], [1.7, 0.26, 0.88, 0.94],
  [1.98, 0.3, 0.67, 0.82], [2.07, 0.34, 0.47, 0.64],
], 0.8);
const HATCH_CABIN = loftedVehicleShell([
  [-1.2, 0.87, 0.94, 0.71], [-0.69, 0.88, 1.47, 0.82],
  [-0.35, 0.9, 1.6, 0.86], [1.13, 0.92, 1.58, 0.86],
  [1.53, 0.92, 1.27, 0.8], [1.69, 0.92, 0.99, 0.7],
], 0.72);
const HATCH_WINDOW = doubleSidedWindowPanels([
  [[-1.02, 0.97], [-0.55, 1.42], [-0.27, 1.51], [0.08, 1.51], [0.08, 0.97]],
  [[0.27, 0.97], [0.27, 1.51], [1.06, 1.5], [1.45, 1.15], [1.49, 0.98]],
], 0.86);
const HATCH_WINDSCREEN = transverseWindowPane(
  [-1.11, 0.97, 0.78], [-0.53, 1.5, 0.72]);
const HATCH_REAR_GLASS = transverseWindowPane(
  [1.62, 1, 0.76], [1.12, 1.51, 0.72]);
const SUV_LOWER = loftedVehicleShell([
  [-2.31, 0.38, 0.57, 0.72], [-2.18, 0.31, 0.84, 0.96],
  [-1.75, 0.29, 1.01, 1.04], [-0.86, 0.28, 1.06, 1.06],
  [1.42, 0.29, 1.07, 1.06], [1.83, 0.31, 0.99, 1.02],
  [2.2, 0.36, 0.81, 0.94], [2.32, 0.41, 0.57, 0.72],
], 0.82);
const SUV_CABIN = loftedVehicleShell([
  [-1.27, 0.98, 1.06, 0.78], [-0.82, 1, 1.61, 0.89],
  [-0.48, 1.01, 1.74, 0.92], [1.39, 1.02, 1.73, 0.92],
  [1.71, 1.02, 1.42, 0.86], [1.82, 1.02, 1.1, 0.75],
], 0.74);
const SUV_WINDOW = doubleSidedWindowPanels([
  [[-1.08, 1.08], [-0.68, 1.56], [-0.39, 1.66], [0.11, 1.66], [0.11, 1.08]],
  [[0.3, 1.08], [0.3, 1.66], [1.28, 1.65], [1.6, 1.34], [1.63, 1.09]],
], 0.92);
const SUV_WINDSCREEN = transverseWindowPane(
  [-1.17, 1.08, 0.84], [-0.52, 1.67, 0.77]);
const SUV_REAR_GLASS = transverseWindowPane(
  [1.75, 1.09, 0.82], [1.34, 1.66, 0.77]);
const VEHICLE_TYPES = [
  {
    key: 'sedan', lower: SEDAN_LOWER, cabin: SEDAN_CABIN, window: SEDAN_WINDOW,
    windscreen: SEDAN_WINDSCREEN, rearGlass: SEDAN_REAR_GLASS,
    wheels: [-1.42, 1.42],
    bodyHalf: 0.97, cabinHalf: 0.845, front: -2.3, rear: 2.34,
  },
  {
    key: 'hatch', lower: HATCH_LOWER, cabin: HATCH_CABIN, window: HATCH_WINDOW,
    windscreen: HATCH_WINDSCREEN, rearGlass: HATCH_REAR_GLASS,
    wheels: [-1.29, 1.34],
    bodyHalf: 0.965, cabinHalf: 0.845, front: -2.13, rear: 2.13,
  },
  {
    key: 'suv', lower: SUV_LOWER, cabin: SUV_CABIN, window: SUV_WINDOW,
    windscreen: SUV_WINDSCREEN, rearGlass: SUV_REAR_GLASS,
    wheels: [-1.47, 1.47],
    bodyHalf: 1.03, cabinHalf: 0.9, front: -2.37, rear: 2.4,
  },
];
const TYRE_GEO = new THREE.TorusGeometry(0.36, 0.105, 14, 32);
const HUB_GEO = new THREE.CylinderGeometry(0.23, 0.23, 0.045, 24);
const CAP_GEO = new THREE.CylinderGeometry(0.075, 0.075, 0.052, 16);
const RIM_SPOKE_GEO = new THREE.CapsuleGeometry(0.017, 0.13, 3, 7);
const MIRROR_GEO = new THREE.SphereGeometry(0.11, 12, 8);
const HANDLE_GEO = new THREE.CapsuleGeometry(0.018, 0.11, 3, 8);
const HEADREST_GEO = new THREE.CapsuleGeometry(0.12, 0.13, 4, 8);
const VEHICLE_LAMP_GEO = new THREE.SphereGeometry(0.5, 14, 9);
const VEHICLE_BUMPER_GEO = new THREE.CapsuleGeometry(0.08, 1.3, 4, 10);
const POLICE_PUSH_BAR_GEO = new THREE.CapsuleGeometry(0.045, 0.68, 4, 9);
const POLICE_LIGHTBAR_GEO = new THREE.CapsuleGeometry(0.055, 0.42, 4, 10);
const VEHICLE_CONTACT_GEO = new THREE.PlaneGeometry(1, 1);
const POLICE_DOOR_PANEL_GEO = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.42);
  shape.lineTo(0.46, -0.42);
  shape.lineTo(0.5, 0.34);
  shape.lineTo(-0.38, 0.5);
  shape.lineTo(-0.5, 0.2);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
})();
const POLICE_ROUNDEL_GEO = new THREE.CircleGeometry(0.5, 20);
const VEHICLE_BURN_SCAR_GEO = (() => {
  const shape = new THREE.Shape();
  const points = [
    [-0.48, -0.08], [-0.34, -0.37], [-0.04, -0.46], [0.25, -0.34],
    [0.48, -0.05], [0.35, 0.29], [0.02, 0.43], [-0.31, 0.3],
  ];
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
})();
const VEHICLE_GRILLE_GEO = (() => {
  const shape = new THREE.Shape();
  const w = 0.88, h = 0.24, r = 0.065;
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return new THREE.ShapeGeometry(shape);
})();
const SHARD_GEO = (() => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.35, 0, -0.18, 0.5, 0,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
})();
const FACADE_SCAR_GEO = (() => {
  const points = [
    [-0.68, -0.18], [-0.5, -0.54], [-0.08, -0.72], [0.3, -0.56],
    [0.71, -0.2], [0.58, 0.18], [0.31, 0.62], [-0.1, 0.74],
    [-0.51, 0.48], [-0.76, 0.11],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
})();
const DAMAGED_PARAPET_GEO = (() => {
  // A shallow extruded wall cap with an irregular shell-struck upper edge. Scaling this
  // geometry produces different lot widths/heights while keeping a real return along the
  // roof, so the silhouette does not collapse into a cardboard plane from oblique angles.
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0.5, 0.28);
  shape.lineTo(0.36, 0.34);
  shape.lineTo(0.23, 0.18);
  shape.lineTo(0.04, 0.43);
  shape.lineTo(-0.13, 0.22);
  shape.lineTo(-0.29, 0.38);
  shape.lineTo(-0.5, 0.29);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.5,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.012,
    bevelThickness: 0.012,
  });
  geometry.translate(0, 0, -0.25);
  geometry.computeVertexNormals();
  return geometry;
})();
function extrudedSkylineProfile(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    steps: 1,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -0.5);
  geometry.computeVertexNormals();
  return geometry;
}
const SKYLINE_GABLE_GEO = extrudedSkylineProfile([
  [-0.5, 0], [0.5, 0], [0.5, 0.08], [0, 0.5], [-0.5, 0.08],
]);
const SKYLINE_SAWTOOTH_GEO = extrudedSkylineProfile([
  [-0.5, 0], [0.5, 0], [0.5, 0.1],
  [0.32, 0.45], [0.32, 0.1],
  [0.13, 0.42], [0.13, 0.1],
  [-0.06, 0.47], [-0.06, 0.1],
  [-0.25, 0.4], [-0.25, 0.1],
  [-0.43, 0.43], [-0.5, 0.14],
]);
const SKYLINE_COLLAPSED_GEO = extrudedSkylineProfile([
  [-0.5, 0], [0.5, 0], [0.5, 0.23], [0.38, 0.19],
  [0.27, 0.4], [0.1, 0.16], [-0.05, 0.34], [-0.18, 0.11],
  [-0.34, 0.28], [-0.5, 0.17],
]);
const SKYLINE_WINDOW_FRAME_GEO = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0.5, 0.5);
  shape.lineTo(-0.5, 0.5);
  shape.closePath();
  const opening = new THREE.Path();
  opening.moveTo(-0.38, -0.36);
  opening.lineTo(-0.38, 0.36);
  opening.lineTo(0.38, 0.36);
  opening.lineTo(0.38, -0.36);
  opening.closePath();
  shape.holes.push(opening);
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.computeVertexNormals();
  return geometry;
})();
const SKYLINE_ROOF_TANK_GEO = new THREE.CylinderGeometry(0.62, 0.7, 1.45, 14, 1);
const SKYLINE_ROOF_TANK_CAP_GEO = new THREE.SphereGeometry(
  0.63, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const SKYLINE_ROOF_MAST_GEO = new THREE.CylinderGeometry(0.045, 0.065, 1, 7);
const DRAIN_GEO = new THREE.CylinderGeometry(0.055, 0.065, 1, 8);
const AC_FAN_GEO = new THREE.CylinderGeometry(0.22, 0.22, 0.035, 12);
const ROOF_CAP_GEO = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0.5, 0.26);
  shape.lineTo(0, 0.62);
  shape.lineTo(-0.5, 0.26);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1, bevelEnabled: false, curveSegments: 1,
  });
  geometry.translate(0, 0, -0.5);
  geometry.computeVertexNormals();
  return geometry;
})();

function addPoliceVehicleDetails(batcher, parent, type) {
  const trim = standard('vehicle-trim', 0x11161a, 0.54, 0.16);
  const white = standard('police-white', 0xd8dde0, 0.46, 0.12);
  const blue = standard('police-blue', 0x1d5687, 0.38, 0.18);
  const yellow = standard('police-yellow', 0xd4ae3d, 0.42, 0.12);
  for (const side of [-1, 1]) {
    batcher.add('police-doors', POLICE_DOOR_PANEL_GEO, white,
      instanceMatrix(parent, 0.15, 0.68, side * 0.998, 1.42, 0.56, 1,
        0, side < 0 ? Math.PI : 0));
    batcher.add('police-side-stripes', UNIT_PLANE, blue,
      instanceMatrix(parent, 0.12, 0.69, side * 1.001, 1.15, 0.08, 1,
        0, side < 0 ? Math.PI : 0));
    batcher.add('police-roundels', POLICE_ROUNDEL_GEO, yellow,
      instanceMatrix(parent, 0.2, 0.79, side * 1.004, 0.17, 0.17, 1,
        0, side < 0 ? Math.PI : 0));
  }
  batcher.add('police-lightbar-base', VEHICLE_BUMPER_GEO, trim,
    instanceMatrix(parent, 0.18, 1.59, 0, 0.52, 0.9, 0.9, Math.PI / 2, 0, 0));
  for (const y of [0.54, 0.88]) {
    batcher.add('police-push-bars', POLICE_PUSH_BAR_GEO, trim,
      instanceMatrix(parent, type.front - 0.16, y, 0, 1.1, 1.9, 1.9,
        Math.PI / 2, 0, 0));
  }
  for (const z of [-0.52, 0.52]) {
    batcher.add('police-push-bars', POLICE_PUSH_BAR_GEO, trim,
      instanceMatrix(parent, type.front - 0.14, 0.76, z, 1.1, 0.8, 1.1));
  }
  for (const [z, col] of [[-0.38, 0xd51f28], [0.38, 0x245dff]]) {
    batcher.add(`police-lens-${col}`, POLICE_LIGHTBAR_GEO,
      material(`police-lens-${col}`, () => new THREE.MeshPhysicalMaterial({
        color: col, emissive: col, emissiveIntensity: 0.22,
        roughness: 0.16, metalness: 0.02, transparent: true, opacity: 0.82,
        clearcoat: 1,
      })),
      instanceMatrix(parent, 0.18, 1.68, z, 1.25, 0.78, 0.78,
        Math.PI / 2, 0, 0));
  }
}

function authoredVehicleMaterial(wrecked) {
  const key = wrecked ? 'authored-vehicle-wreck' : 'authored-vehicle-layered-finish';
  return material(key, () => {
    const out = new THREE.MeshPhysicalMaterial({
      name: key,
      color: 0xffffff,
      vertexColors: true,
      roughness: wrecked ? 0.78 : 0.42,
      metalness: wrecked ? 0.16 : 0.12,
      clearcoat: wrecked ? 0.04 : 0.55,
      clearcoatRoughness: 0.3,
      envMapIntensity: wrecked ? 0.62 : 1.05,
    });
    if (wrecked) return out;
    out.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float vehiclePaint;
attribute float vehicleGlass;
attribute float vehicleRubber;
attribute float vehicleMetal;
attribute float vehicleLight;
varying float vVehiclePaint;
varying float vVehicleGlass;
varying float vVehicleRubber;
varying float vVehicleMetal;
varying float vVehicleLight;
varying vec3 vVehicleLocalPosition;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vVehiclePaint = vehiclePaint;
vVehicleGlass = vehicleGlass;
vVehicleRubber = vehicleRubber;
vVehicleMetal = vehicleMetal;
vVehicleLight = vehicleLight;
vVehicleLocalPosition = position;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vVehiclePaint;
varying float vVehicleGlass;
varying float vVehicleRubber;
varying float vVehicleMetal;
varying float vVehicleLight;
varying vec3 vVehicleLocalPosition;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float bpVehicleNoise = fract(sin(dot(
  vVehicleLocalPosition.xz, vec2(19.417, 47.853))) * 43758.5453);
float bpRoadFilm = vVehiclePaint
  * (1.0 - smoothstep(0.14, 0.72, vVehicleLocalPosition.y))
  * smoothstep(0.18, 0.92, bpVehicleNoise);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.105, 0.085), bpRoadFilm * 0.34);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.007, 0.014, 0.021), vVehicleGlass * 0.94);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.34, vVehiclePaint);
roughnessFactor = mix(roughnessFactor, 0.1, vVehicleGlass);
roughnessFactor = mix(roughnessFactor, 0.94, vVehicleRubber);
roughnessFactor = mix(roughnessFactor, 0.25, vVehicleMetal);
roughnessFactor = mix(roughnessFactor, 0.2, vVehicleLight);
roughnessFactor = mix(roughnessFactor, 0.68, bpRoadFilm);`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.14, vVehiclePaint);
metalnessFactor = mix(metalnessFactor, 0.03, vVehicleGlass);
metalnessFactor = mix(metalnessFactor, 0.0, vVehicleRubber);
metalnessFactor = mix(metalnessFactor, 0.78, vVehicleMetal);
metalnessFactor = mix(metalnessFactor, 0.04, vVehicleLight);`,
        )
        .replace(
          '#include <lights_physical_fragment>',
          `#include <lights_physical_fragment>
material.clearcoat = mix(0.04, 0.68, vVehiclePaint);
material.clearcoat = mix(material.clearcoat, 0.9, vVehicleGlass);
material.clearcoatRoughness = mix(0.34, 0.14, max(vVehiclePaint, vVehicleGlass));`,
        )
        .replace(
          '#include <opaque_fragment>',
          `float bpGlassFresnel = pow(
  1.0 - saturate(dot(geometryNormal, geometryViewDir)), 3.0);
outgoingLight += vVehicleGlass
  * (0.025 + bpGlassFresnel * 0.22) * vec3(0.24, 0.43, 0.58);
outgoingLight += vVehicleLight * diffuseColor.rgb * 0.055;
#include <opaque_fragment>`,
        );
    };
    out.customProgramCacheKey = () => 'bp-authored-vehicle-layered-v1';
    return out;
  });
}

function photographicVehicleMaterial(source, kind) {
  const sourceMaterial = source.sourceMaterial;
  const key = `authored-vehicle-${source.materialKey || kind}-photo`;
  return material(key, () => {
    const out = new THREE.MeshStandardMaterial({
      name: key,
      color: source.materialTint ?? 0xffffff,
      map: sourceMaterial?.map || null,
      normalMap: sourceMaterial?.normalMap || null,
      normalScale: sourceMaterial?.normalScale?.clone() || new THREE.Vector2(1, 1),
      roughness: sourceMaterial?.roughness ?? 0.82,
      roughnessMap: sourceMaterial?.roughnessMap || null,
      metalness: sourceMaterial?.metalness ?? 1,
      metalnessMap: sourceMaterial?.metalnessMap || null,
      aoMap: sourceMaterial?.aoMap || null,
      aoMapIntensity: 0.74,
    });
    for (const texture of [
      out.map, out.normalMap, out.roughnessMap, out.metalnessMap, out.aoMap,
    ]) {
      if (texture) texture.anisotropy = Math.min(quality.maxAnisotropy || 4, 8);
    }
    return out;
  });
}

function vehicleContactMaterial() {
  return material('vehicle-soft-contact', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 32, 2, 64, 32, 60);
    gradient.addColorStop(0, 'rgba(0,0,0,.86)');
    gradient.addColorStop(0.48, 'rgba(0,0,0,.54)');
    gradient.addColorStop(0.76, 'rgba(0,0,0,.12)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 64);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.generateMipmaps = true;
    return new THREE.MeshBasicMaterial({
      name: 'vehicle-soft-contact',
      map,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      fog: true,
    });
  });
}

function addAuthoredVehicle(batcher, def, type, bodyColor, parent, wrecked) {
  if (!authoredVehicleSources) return false;
  const kind = wrecked ? 'wreck' : type.key;
  const source = authoredVehicleSources[kind];
  if (source?.nativeParts) {
    const parts = authoredNativeVehicleParts(kind);
    if (!parts?.length) return false;
    for (const part of parts) {
      batcher.add(
        `vehicle-authored-${kind}-native-${part.role}`,
        part.geometry,
        part.material,
        parent,
        false,
        part.role === 'body' ? bodyColor : null,
      );
    }
    for (const wheelX of type.wheels) {
      for (const side of [-1, 1]) {
        batcher.add('vehicle-soft-contact-shadows', VEHICLE_CONTACT_GEO,
          vehicleContactMaterial(),
          instanceMatrix(parent, wheelX, 0.018, side * type.bodyHalf * 0.78,
            0.84, 0.42, 1, -Math.PI / 2, 0, 0));
      }
    }
    if (def.police) addPoliceVehicleDetails(batcher, parent, type);
    return true;
  }
  const geometry = authoredVehicleGeometry(kind, bodyColor);
  if (!geometry) return false;
  const fixedColour = wrecked ? 'fixed' : new THREE.Color(bodyColor).getHexString();
  const vehicleMat = source.photographic
    ? photographicVehicleMaterial(source, kind)
    : authoredVehicleMaterial(wrecked);
  batcher.add(`vehicle-authored-${kind}-${fixedColour}`, geometry, vehicleMat, parent);
  for (const wheelX of type.wheels) {
    for (const side of [-1, 1]) {
      batcher.add('vehicle-soft-contact-shadows', VEHICLE_CONTACT_GEO,
        vehicleContactMaterial(),
        instanceMatrix(parent, wheelX, 0.018, side * type.bodyHalf * 0.78,
          0.84, 0.42, 1, -Math.PI / 2, 0, 0));
    }
  }

  // A close car is now one coherent authored object, so generic boxes no longer stand in for
  // doors, wheel openings or glass. Police equipment remains a shared operational hardware kit.
  if (def.police) addPoliceVehicleDetails(batcher, parent, type);
  return true;
}

function addVehicle(batcher, def) {
  const damage = def.damage ?? Math.abs(Math.round(def.x * 17 + def.z * 31)) % 7;
  const type = VEHICLE_TYPES[def.police ? 0 : Math.abs(def.variant ?? 0) % VEHICLE_TYPES.length];
  const burned = !def.police && !!def.burned;
  const wrecked = !def.police && damage === 0 && !burned;
  const damaged = wrecked || burned;
  const bodyColor = damaged ? 0x242321 : def.color;
  const parent = new THREE.Matrix4().compose(
    new THREE.Vector3(def.x, 0.01, def.z),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), def.rotZAxis ? Math.PI / 2 : 0),
    new THREE.Vector3(1, 1, 1),
  );
  // Burning cars retain a recognizable sedan/SUV shell but use the procedural layered kit so
  // we can remove a hub, drop a bumper, shatter glass and paint real scorch overlays. The
  // imported "wreck" asset reads as a covered vehicle from gameplay distance.
  if (!burned && addAuthoredVehicle(batcher, def, type, bodyColor, parent, wrecked)) return;
  const paint = material('vehicle-paint-instanced', () => new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.32, metalness: 0.04,
    clearcoat: 0.68, clearcoatRoughness: 0.24, envMapIntensity: 1.15,
    side: THREE.DoubleSide,
  }));
  const trim = standard('vehicle-trim', 0x11161a, 0.54, 0.16);
  const rubber = standard('vehicle-rubber', 0x090b0d, 0.96, 0);
  const rim = standard('vehicle-rim', 0x7e8991, 0.24, 0.82);
  const interior = standard('vehicle-interior', 0x171a1c, 0.82, 0.02);
  const plate = standard('vehicle-plate', 0xc7c8bd, 0.42, 0.16);
  const glass = material('vehicle-glass', () => new THREE.MeshPhysicalMaterial({
    // At night automotive glass reads near-black with a restrained sky reflection. The
    // previous bright blue-grey environment response turned every pane into an opaque slab.
    color: 0x071017, roughness: 0.24, metalness: 0.04,
    transmission: 0, transparent: false,
    clearcoat: 0.72, clearcoatRoughness: 0.16, envMapIntensity: 0.58,
    side: THREE.DoubleSide,
  }));
  const grime = standard('vehicle-road-grime', 0x282824, 0.98, 0.01);
  const burnScar = material('vehicle-burn-scar', () => new THREE.MeshBasicMaterial({
    color: 0x171817, transparent: true, opacity: 0.52, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide,
  }));
  const shattered = standard('vehicle-shattered-glass', 0x10171b, 0.88, 0.03);

  // Vehicle shells deliberately do not enter the coarse city shadow map. At street scale
  // its low-angle projection becomes a hard black wedge several metres long, which is more
  // conspicuous than omitting the shadow; contact and depth still come from the wheels,
  // authored soft contact patches and the cars receiving surrounding building shadows.
  batcher.add(`vehicle-${type.key}-lower`, type.lower, paint, parent, false, bodyColor);
  batcher.add(`vehicle-${type.key}-cabin`, type.cabin, paint, parent, false, bodyColor);
  const glassSide = type.cabinHalf + 0.014;
  const trimSide = type.bodyHalf + 0.028;
  const wheelSide = type.bodyHalf + 0.06;
  batcher.add(`vehicle-${type.key}-side-glass`, type.window, damaged ? shattered : glass,
    parent);
  for (const side of [-1, 1]) {
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, 0.18, 1.2, side * (glassSide + 0.025), 0.085, 0.55, 0.055));
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, -0.58, 1.2, side * (glassSide + 0.026), 0.055, 0.5, 0.052));
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, 0.08, 0.95, side * (glassSide + 0.025), 2.15, 0.055, 0.06));
    batcher.add('vehicle-mirror', MIRROR_GEO, trim,
      instanceMatrix(parent, -0.92, 1.12, side * (type.bodyHalf + 0.1), 1.35, 0.65, 0.75));
    for (const x of [-0.72, 0.86]) {
      batcher.add('vehicle-trim-box', UNIT_BOX, trim,
        instanceMatrix(parent, x, 0.65, side * trimSide, 0.018, 0.62, 0.014));
      batcher.add('vehicle-handles', HANDLE_GEO, trim,
        instanceMatrix(parent, x + 0.23, 0.83, side * (trimSide + 0.014),
          1, 1, 1, 0, 0, Math.PI / 2));
    }
    batcher.add('vehicle-trim-box', UNIT_BOX, trim,
      instanceMatrix(parent, -0.02, 0.91, side * trimSide, 3.26, 0.025, 0.016));
  }

  // The glasshouse is a volume, not a dark decal pasted on each side. Angled front/rear
  // panes, a visible interior and pillars prevent the profile from reading as two stacked
  // boxes when the player approaches from either end.
  batcher.add(`vehicle-${type.key}-windscreen`, type.windscreen,
    damaged ? shattered : glass, parent);
  batcher.add(`vehicle-${type.key}-rear-glass`, type.rearGlass,
    damaged ? shattered : glass, parent);
  for (const side of [-0.45, 0.45]) {
    batcher.add('vehicle-seats', UNIT_BOX, interior,
      instanceMatrix(parent, 0.12, 0.96, side, 0.42, 0.58, 0.44, 0, 0, -0.08));
    batcher.add('vehicle-headrests', HEADREST_GEO, interior,
      instanceMatrix(parent, 0.18, 1.34, side, 0.9, 0.9, 0.9));
  }

  for (const x of type.wheels) for (const side of [-1, 1]) {
    batcher.add('vehicle-tyres', TYRE_GEO, rubber,
      instanceMatrix(parent, x, 0.4, side * wheelSide, 1, 1, 1), false);
    batcher.add('vehicle-hubs', HUB_GEO, rim,
      instanceMatrix(parent, x, 0.4, side * (wheelSide + 0.025), 1, 1, 1, Math.PI / 2));
    batcher.add('vehicle-caps', CAP_GEO, trim,
      instanceMatrix(parent, x, 0.4, side * (wheelSide + 0.055), 1, 1, 1, Math.PI / 2));
    for (let spoke = 0; spoke < 5; spoke++) {
      const angle = spoke * Math.PI * 2 / 5;
      batcher.add('vehicle-rim-spokes', RIM_SPOKE_GEO, rim,
        instanceMatrix(parent,
          x - Math.sin(angle) * 0.1,
          0.4 + Math.cos(angle) * 0.1,
          side * (wheelSide + 0.061),
          1, 1, 1, 0, 0, angle));
    }
  }

  for (const side of [-0.56, 0.56]) {
    batcher.add('vehicle-headlights', VEHICLE_LAMP_GEO,
      material('headlamp', () => new THREE.MeshPhysicalMaterial({
        color: 0x9da9a4, emissive: 0x727d76, emissiveIntensity: 0.025,
        roughness: 0.18, metalness: 0.05, clearcoat: 1,
      })),
      instanceMatrix(parent, type.front - 0.018, 0.67, side, 0.055, 0.17, 0.39));
    batcher.add('vehicle-taillights', VEHICLE_LAMP_GEO,
      standard('taillamp', 0x8f1514, 0.18, 0),
      instanceMatrix(parent, type.rear + 0.018, 0.67, side, 0.055, 0.18, 0.37));
  }
  for (const x of [type.front - 0.025, type.rear + 0.025]) {
    batcher.add('vehicle-bumpers', VEHICLE_BUMPER_GEO, trim,
      instanceMatrix(parent, x, 0.34, 0, 0.72, 1, 1, Math.PI / 2, 0, 0));
  }
  batcher.add('vehicle-grilles', VEHICLE_GRILLE_GEO, trim,
    instanceMatrix(parent, type.front - 0.036, 0.52, 0, 1, 1, 1, 0, -Math.PI / 2));
  for (const x of [type.front - 0.05, type.rear + 0.05]) {
    batcher.add('vehicle-plates', UNIT_BOX, plate,
      instanceMatrix(parent, x, 0.39, 0, 0.018, 0.13, 0.42));
  }
  // Panel gaps and rocker trim give scale at first-person distance without unique textures.
  for (const side of [-1, 1]) {
    batcher.add('vehicle-panel-lines', UNIT_BOX, trim,
      instanceMatrix(parent, -0.21, 0.68, side * trimSide, 0.018, 0.62, 0.012));
    batcher.add('vehicle-rockers', UNIT_BOX, trim,
      instanceMatrix(parent, 0, 0.28, side * trimSide, 3.38, 0.08, 0.035));
  }
  // Bonnet and boot shut-lines catch a highlight at close range and communicate real panel
  // scale without spending unique textures or meshes per vehicle.
  batcher.add('vehicle-panel-lines', UNIT_BOX, trim,
    instanceMatrix(parent, -1.55, 0.94, 0, 0.022, 0.014, 1.45, 0, 0, -0.08));
  batcher.add('vehicle-panel-lines', UNIT_BOX, trim,
    instanceMatrix(parent, 1.53, 0.93, 0, 0.022, 0.014, 1.42, 0, 0, 0.06));

  // Deterministic wear makes parked cars part of the battered district instead of pristine
  // showroom props. It stays instanced, so an entire street still costs only a few draws.
  if (!def.police) {
    for (const side of [-1, 1]) {
      batcher.add('vehicle-grime', UNIT_BOX, grime,
        instanceMatrix(parent, 0.05, 0.46, side * (trimSide + 0.01), 3.75, 0.23, 0.018));
    }
    if (damage <= 2) {
      const side = damage % 2 ? -1 : 1;
      batcher.add(`vehicle-${type.key}-shattered`, type.window, shattered,
        instanceMatrix(parent, 0, 0.008, side * 0.004, 0.98, 0.96, 1));
      batcher.add('vehicle-dent', UNIT_BOX, grime,
        instanceMatrix(parent, 1.22, 0.71, -side * (trimSide + 0.01), 0.58, 0.32, 0.022,
          0, 0, damage === 2 ? 0.11 : -0.08));
    }
    if (damaged) {
      batcher.add('vehicle-missing-hub', CAP_GEO, rubber,
        instanceMatrix(parent, type.wheels[1], 0.4, wheelSide + 0.065,
          1.35, 1.35, 1.1, Math.PI / 2));
      // Ash on the bonnet and a dropped bumper sell an abandoned strike-damaged shell.
      batcher.add('vehicle-burn-scars', VEHICLE_BURN_SCAR_GEO, burnScar,
        instanceMatrix(parent, -1.38, 0.972, 0, 0.82, 1.16, 1,
          -Math.PI / 2, 0, -0.08));
      batcher.add('vehicle-dropped-bumpers', UNIT_BOX, trim,
        instanceMatrix(parent, type.rear + 0.03, 0.2, 0.17,
          0.12, 0.11, 1.5, 0.16, 0.04, 0.12));
    }
  }

  if (def.police) addPoliceVehicleDetails(batcher, parent, type);
}

const MILITARY_TRUCK_CAB_GEO = loftedVehicleShell([
  [-3.34, 0.5, 0.72, 0.72], [-3.18, 0.43, 1.25, 1.0],
  [-2.9, 0.42, 2.12, 1.05], [-2.52, 0.43, 2.42, 1.08],
  [-1.38, 0.44, 2.38, 1.08], [-1.08, 0.48, 1.92, 1.02],
  [-1.02, 0.52, 0.72, 0.82],
], 0.86);
const MILITARY_APC_HULL_GEO = loftedVehicleShell([
  [-3.52, 0.35, 0.66, 0.8], [-3.24, 0.3, 1.4, 1.28],
  [-2.45, 0.28, 1.75, 1.38], [1.9, 0.28, 1.86, 1.4],
  [3.15, 0.3, 1.48, 1.35], [3.52, 0.38, 0.72, 0.9],
], 0.84);
const MILITARY_BMP_HULL_GEO = loftedVehicleShell([
  [-3.3, 0.34, 0.72, 0.8], [-3.02, 0.28, 1.18, 1.47],
  [-2.2, 0.26, 1.58, 1.5], [2.45, 0.26, 1.62, 1.51],
  [3.12, 0.31, 1.18, 1.42], [3.34, 0.36, 0.7, 0.86],
], 0.82);
const MILITARY_TANKER_GEO = new THREE.CylinderGeometry(0.92, 0.92, 3.75, 22, 1);
const MILITARY_TRACK_GEO = new THREE.CapsuleGeometry(0.42, 3.9, 5, 12);
const MILITARY_TUBE_GEO = new THREE.CylinderGeometry(0.07, 0.085, 2.8, 9);

function addMilitaryTruck(batcher, def) {
  const variant = Math.abs(def.variant ?? 0) % 20;
  const family = variant % 10;
  const paintIndex = Math.floor(variant / 5);
  const paintColours = [0x414b39, 0x4b4c38, 0x35453b, 0x4a4435];
  const surfaceKit = surfaces();
  const paint = material(`military-vehicle-paint-${paintIndex}`, () =>
    new THREE.MeshPhysicalMaterial({
      color: def.damage === 0 ? 0x252925 : paintColours[paintIndex],
      map: surfaceKit.metal.map,
      normalMap: surfaceKit.metal.normalMap,
      roughnessMap: surfaceKit.metal.roughnessMap,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughness: 0.78,
      metalness: 0.16,
      clearcoat: 0.12,
      clearcoatRoughness: 0.72,
      // The procedural loft shares rings between both flanks. Render both windings so the
      // camera always receives the near hull surface as an occluder; with front faces only,
      // an oblique side view could expose the opposite axle through the culled flank.
      side: THREE.DoubleSide,
    }));
  const chassis = standard('military-truck-chassis', 0x293028, 0.8, 0.38);
  const rubber = standard('military-truck-rubber', 0x090b0a, 0.98, 0);
  const steel = standard('military-truck-steel', 0x59605a, 0.62, 0.58);
  const glass = standard('military-truck-glass', 0x101b1d, 0.24, 0.22);
  const canvas = material('military-truck-canvas', () =>
    new THREE.MeshStandardMaterial({
      color: 0x555a42,
      map: surfaceKit.fabric.map,
      normalMap: surfaceKit.fabric.normalMap,
      roughnessMap: surfaceKit.fabric.roughnessMap,
      normalScale: new THREE.Vector2(0.34, 0.34),
      roughness: 0.98,
      metalness: 0,
    }));
  const lamp = standard('military-truck-lamp', 0xd8cf9b, 0.34, 0.16);
  const pale = standard('military-medical-panel', 0xb9b9a7, 0.82, 0.03);
  const red = standard('military-medical-mark', 0x8c2924, 0.72, 0.05);
  const parent = new THREE.Matrix4().compose(
    new THREE.Vector3(def.x, 0.02, def.z),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      (def.rotZAxis ? Math.PI / 2 : 0) + (def.reverse ? Math.PI : 0)),
    new THREE.Vector3(1, 1, 1),
  );

  const wheels = (positions, sideOffset, scale = 1.25) => {
    for (const x of positions) for (const side of [-1, 1]) {
      batcher.add('military-truck-tyres', TYRE_GEO, rubber,
        instanceMatrix(parent, x, 0.55, side * sideOffset, scale, scale, scale * 0.96));
      batcher.add('military-wheel-hubs', HUB_GEO, steel,
        instanceMatrix(parent, x, 0.55, side * (sideOffset + 0.05),
          scale * 0.92, scale * 0.92, scale * 0.92, Math.PI / 2));
    }
  };

  if (family < 8) {
    const transportGeometry = authoredVehicleGeometry('militaryTransport', 0x2f392b);
    if (transportGeometry) {
      // One merged 38-part source model retains the authored cab, suspension, tyres, lamps,
      // engine hardware and cargo body while instancing the entire logistics row in one draw.
      // This replaces the generated cab/box assembly rather than layering detail onto it.
      batcher.add(
        'military-transport-authored',
        transportGeometry,
        authoredVehicleMaterial(false),
        parent,
      );
      for (const x of [-2.28, 0.15, 2.15]) {
        for (const side of [-1, 1]) {
          batcher.add('vehicle-soft-contact-shadows', VEHICLE_CONTACT_GEO,
            vehicleContactMaterial(),
            instanceMatrix(parent, x, 0.018, side * 0.88,
              0.9, 0.46, 1, -Math.PI / 2, 0, 0));
        }
      }
      return;
    }
    // Unlike the first blockout, the cab is a single curved loft with tapered nose, shoulders
    // and roof. It uses the same authored-surface method as the sedan/SUV kit.
    batcher.add('military-truck-authored-cab', MILITARY_TRUCK_CAB_GEO, paint, parent);
    // A continuous opaque belly sits just inboard of the tyres. The earlier wafer-thin rail
    // left open air beneath the cab and load body, allowing the far-side wheels to project
    // through the shell at close first-person angles. Its side faces now act as the real
    // chassis/wheel-well backing while the near tyres remain proud of it.
    batcher.add('military-chassis-boxes', UNIT_BOX, chassis,
      instanceMatrix(parent, 0.12, 0.68, 0, 6.35, 0.62, 2.02));
    for (const side of [-1, 1]) {
      batcher.add('military-glass-boxes', UNIT_BOX, glass,
        instanceMatrix(parent, -2.15, 1.78, side * 1.086, 1.12, 0.64, 0.026));
    }
    batcher.add('military-glass-boxes', UNIT_BOX, glass,
      instanceMatrix(parent, -3.1, 1.72, 0, 0.035, 0.62, 1.76, 0, 0, -0.1));
    batcher.add('military-truck-grille', VEHICLE_GRILLE_GEO, steel,
      instanceMatrix(parent, -3.34, 1.0, 0, 1.35, 1.35, 1, 0, -Math.PI / 2, 0));
    for (const side of [-0.73, 0.73]) {
      batcher.add('military-vehicle-lamps', VEHICLE_LAMP_GEO, lamp,
        instanceMatrix(parent, -3.34, 1.17, side, 0.2, 0.2, 0.16));
    }
    wheels([-2.35, 0.35, 2.35], 1.11);
    batcher.add('military-truck-bumper', VEHICLE_BUMPER_GEO, chassis,
      instanceMatrix(parent, -3.4, 0.63, 0, 1.35, 1, 1, 0, 0, Math.PI / 2));

    if ([0, 1, 5, 6, 7].includes(family)) {
      batcher.add('military-truck-bed', UNIT_BOX, paint,
        instanceMatrix(parent, 1.15, 1.0, 0, 3.8, 0.78, 2.18));
      for (const side of [-1, 1]) {
        batcher.add('military-steel-boxes', UNIT_BOX, steel,
          instanceMatrix(parent, 1.15, 1.57, side * 1.09, 3.72, 0.07, 0.07));
        for (const x of [-0.55, 0.55, 1.65, 2.7]) {
          batcher.add('military-steel-boxes', UNIT_BOX, steel,
            instanceMatrix(parent, x, 1.53, side * 1.09, 0.06, 1.0, 0.06));
        }
      }
    }
    if (family === 0 || def.canvas === true) {
      batcher.add('military-truck-canvas-roof', MILITARY_APC_HULL_GEO, canvas,
        instanceMatrix(parent, 1.15, 0.67, 0, 0.55, 0.68, 0.72));
    } else if (family === 1) {
      // Open troop transport: benches and an unobstructed rear explain the mounted soldiers.
      for (const side of [-1, 1]) {
        batcher.add('military-troop-benches', UNIT_BOX, canvas,
          instanceMatrix(parent, 1.25, 1.34, side * 0.72, 3.25, 0.12, 0.42));
      }
    } else if (family === 2) {
      batcher.add('military-fuel-tanker', MILITARY_TANKER_GEO, paint,
        instanceMatrix(parent, 1.15, 1.58, 0, 1, 1, 1, 0, 0, Math.PI / 2));
      for (const x of [-0.65, 2.95]) {
        batcher.add('military-tanker-bands', new THREE.TorusGeometry(0.95, 0.035, 8, 18),
          steel, instanceMatrix(parent, x, 1.58, 0, 1, 1, 1, 0, Math.PI / 2, 0));
      }
    } else if (family === 3 || family === 4) {
      const body = family === 4 ? pale : paint;
      batcher.add('military-command-body', UNIT_BOX, body,
        instanceMatrix(parent, 1.15, 1.68, 0, 3.8, 2.12, 2.12));
      batcher.add('military-command-roof', MILITARY_TANKER_GEO, body,
        instanceMatrix(parent, 1.15, 2.7, 0, 1.02, 1, 0.34, 0, 0, Math.PI / 2));
      if (family === 3) {
        batcher.add('military-steel-boxes', UNIT_BOX, steel,
          instanceMatrix(parent, 2.2, 3.35, 0, 0.06, 1.55, 0.06));
      } else {
        for (const side of [-1, 1]) {
          batcher.add('military-ambulance-cross', UNIT_BOX, red,
            instanceMatrix(parent, 1.25, 1.72, side * 1.075, 0.72, 0.2, 0.035));
          batcher.add('military-ambulance-cross', UNIT_BOX, red,
            instanceMatrix(parent, 1.25, 1.72, side * 1.078, 0.2, 0.72, 0.035));
        }
      }
    } else if (family === 5) {
      // Flatbed supply load; separate rounded crates prevent the old single-cube silhouette.
      for (let i = 0; i < 5; i++) {
        batcher.add('military-flatbed-load', SUPPLY_CRATE_GEO, canvas,
          instanceMatrix(parent, -0.1 + i * 0.68, 1.48 + (i % 2) * 0.36,
            (i % 2 ? -0.42 : 0.42), 0.62, 0.62, 0.62, 0, i * 0.12, 0));
      }
    } else if (family === 6) {
      batcher.add('military-steel-tubes', MILITARY_TUBE_GEO, steel,
        instanceMatrix(parent, 1.1, 2.15, 0, 1.8, 1.8, 1.8, 0, 0, -0.76));
      batcher.add('military-steel-tubes', MILITARY_TUBE_GEO, steel,
        instanceMatrix(parent, 2.25, 2.72, 0, 0.42, 0.42, 0.42, 0, Math.PI / 2, 0));
    } else if (family === 7) {
      for (let row = -1; row <= 1; row++) for (let tube = 0; tube < 4; tube++) {
        batcher.add('military-launcher-tubes', MILITARY_TUBE_GEO, chassis,
          instanceMatrix(parent, 1.0 + tube * 0.34, 1.75 + row * 0.22, row * 0.38,
            1.2, 1.2, 1.2, 0, 0, Math.PI / 2 - 0.16));
      }
    }
    return;
  }

  if (family === 8) {
    batcher.add('military-wheeled-apc-hull', MILITARY_APC_HULL_GEO, paint, parent);
    // Opaque lower hull: prevents the wheels on the opposite side from being visible through
    // the shallow lower section of the loft while retaining the exposed BTR wheel silhouette.
    batcher.add('military-chassis-boxes', UNIT_BOX, chassis,
      instanceMatrix(parent, 0, 0.64, 0, 6.3, 0.64, 2.32));
    wheels([-2.55, -0.85, 0.85, 2.55], 1.42, 1.18);
    for (const side of [-0.48, 0.48]) {
      batcher.add('military-glass-boxes', UNIT_BOX, glass,
        instanceMatrix(parent, -3.08, 1.36, side, 0.035, 0.32, 0.68, 0, 0, -0.22));
      batcher.add('military-vehicle-lamps', VEHICLE_LAMP_GEO, lamp,
        instanceMatrix(parent, -3.35, 0.88, side * 1.55, 0.18, 0.18, 0.15));
    }
    for (const side of [-1, 1]) for (const x of [-1.65, 0.15, 1.9]) {
      batcher.add('military-glass-boxes', UNIT_BOX, glass,
        instanceMatrix(parent, x, 1.48, side * 1.395, 0.52, 0.2, 0.025));
      batcher.add('military-chassis-boxes', UNIT_BOX, chassis,
        instanceMatrix(parent, x + 0.48, 1.02, side * 1.402, 0.025, 0.62, 0.022));
    }
  } else {
    batcher.add('military-bmp-hull', MILITARY_BMP_HULL_GEO, paint, parent);
    batcher.add('military-chassis-boxes', UNIT_BOX, chassis,
      instanceMatrix(parent, 0, 0.64, 0, 6.0, 0.64, 2.36));
    for (const side of [-1, 1]) {
      batcher.add('military-bmp-tracks', MILITARY_TRACK_GEO, rubber,
        instanceMatrix(parent, 0, 0.58, side * 1.39, 1.02, 1.42, 0.72, 0, 0, Math.PI / 2));
      for (const x of [-2.15, -1.3, -0.45, 0.4, 1.25, 2.1]) {
        batcher.add('military-wheel-hubs', HUB_GEO, steel,
          instanceMatrix(parent, x, 0.55, side * 1.48, 1.15, 1.15, 1.15, Math.PI / 2));
      }
      for (const x of [-1.75, -0.45, 0.85, 2.1]) {
        batcher.add('military-glass-boxes', UNIT_BOX, glass,
          instanceMatrix(parent, x, 1.35, side * 1.505, 0.38, 0.16, 0.024));
      }
    }
    batcher.add('military-glass-boxes', UNIT_BOX, glass,
      instanceMatrix(parent, -2.55, 1.48, -0.42, 0.48, 0.16, 0.34, 0, 0, -0.16));
  }
  batcher.add('military-apc-turret', new THREE.CylinderGeometry(0.68, 0.82, 0.48, 14),
    paint, instanceMatrix(parent, 0.45, 2.0, 0, 1, 1, 1));
  batcher.add('military-steel-tubes', MILITARY_TUBE_GEO, steel,
    instanceMatrix(parent, -0.95, 2.12, 0, 1, 1, 1, 0, 0, Math.PI / 2));
  for (const side of [-0.55, 0.55]) {
    batcher.add('military-chassis-boxes', UNIT_BOX, chassis,
      instanceMatrix(parent, 1.75, 1.88, side, 0.68, 0.08, 0.52, 0, side * 0.12, 0));
  }
}

function addFacade(batcher, def) {
  const R = rng(def.seed);
  const dx = def.x2 - def.x1, dz = def.z2 - def.z1;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  let nx = -uz, nz = ux;
  if (def.away) {
    const mx = (def.x1 + def.x2) / 2 - def.away[0];
    const mz = (def.z1 + def.z2) / 2 - def.away[1];
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
  }
  const yaw = Math.atan2(nx, nz);
  const frameMat = standard('window-frame', 0x2d3438, 0.68, 0.26);
  const recessMat = standard('window-recess', 0x05080b, 0.96, 0);
  const glassDark = material('architectural-glass', () => {
    const out = new THREE.MeshPhysicalMaterial({
      name: 'architectural-layered-glass',
      color: 0x21323a, roughness: 0.28, metalness: 0.06,
      transparent: true, opacity: 0.24, clearcoat: 0.82,
      clearcoatRoughness: 0.2, envMapIntensity: 0.78,
    });
    out.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vWindowLocal;
varying float vWindowSeed;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vWindowLocal = position.xy;
mat4 bpWindowMatrix = modelMatrix;
#ifdef USE_INSTANCING
bpWindowMatrix = modelMatrix * instanceMatrix;
#endif
vWindowSeed = dot(bpWindowMatrix[3].xyz, vec3(0.173, 0.317, 0.419));`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vWindowLocal;
varying float vWindowSeed;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float bpWindowEdge = max(
  smoothstep(0.34, 0.5, abs(vWindowLocal.x)),
  smoothstep(0.34, 0.5, abs(vWindowLocal.y)));
float bpWindowVariation = fract(sin(vWindowSeed * 91.713) * 43758.5453);
float bpWindowDust = smoothstep(0.12, -0.5, vWindowLocal.y)
  * (0.08 + bpWindowVariation * 0.12);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.155, 0.16),
  bpWindowDust * 0.055 + bpWindowEdge * 0.04);
diffuseColor.a *= 0.78 + bpWindowDust * 0.06;`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = mix(0.13, 0.25, bpWindowDust * 0.72 + bpWindowEdge * 0.28);`,
        )
        .replace(
          '#include <opaque_fragment>',
          `float bpWindowFresnel = pow(
  1.0 - saturate(dot(geometryNormal, geometryViewDir)), 3.0);
outgoingLight += (0.008 + bpWindowFresnel * 0.055)
  * vec3(0.28, 0.46, 0.58);
#include <opaque_fragment>`,
        );
    };
    out.customProgramCacheKey = () => 'bp-architectural-layered-glass-v2';
    return out;
  });
  const floorH = def.floorH ?? 3;
  const step = def.step ?? 3;
  // A contact-line district does not have a third of every room blazing. Besides looking
  // implausible, emissive-pane density flattened the facade into a grid of white cards.
  const litChance = Math.min(0.2, def.lit ?? 0.18);
  // This district has been on the contact line for weeks. A mostly pristine repeated grid
  // reads as an office-park generator even when the masonry beneath it is excellent.
  const damageChance = def.damage ?? 0.42;
  const warmRoom = material('window-room-warm', () => new THREE.MeshStandardMaterial({
    color: 0x8f6748, emissive: 0xffa75b, emissiveIntensity: 0.12, roughness: 0.96,
  }));
  const coolRoom = material('window-room-cool', () => new THREE.MeshStandardMaterial({
    color: 0x526c82, emissive: 0x78add7, emissiveIntensity: 0.1, roughness: 0.96,
  }));
  const photoRooms = frontlineInteriorAtlas
    ? [0, 1, 2, 3].map(tile => material(
      `window-room-photo-${tile}`,
      () => new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: frontlineInteriorAtlas,
        emissive: 0xffffff,
        emissiveMap: frontlineInteriorAtlas,
        emissiveIntensity: [0.18, 0.15, 0.035, 0.025][tile],
        roughness: 0.96,
        metalness: 0,
      }),
    ))
    : null;
  const sillMat = standard('window-sill', 0x626a6d, 0.88, 0.02);
  const blindMat = standard('blind', 0xb9ae9d, 0.9, 0);
  const revealMat = standard('window-reveal', 0x555b5d, 0.95, 0.01);
  const curtainMat = standard('window-curtain', 0x554941, 0.98, 0);
  const interiorMat = standard('window-interior-silhouette', 0x141719, 0.92, 0.02);
  const boardMat = standard('window-boards', 0x5a4533, 0.94, 0);
  const sootMat = material('facade-soot', () => new THREE.MeshBasicMaterial({
    color: 0x181716, transparent: true, opacity: 0.32,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  const shardMat = material('window-shards', () => new THREE.MeshPhysicalMaterial({
    color: 0x79909a, roughness: 0.28, metalness: 0.04,
    transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide,
  }));
  const utilityMat = standard('facade-utility', 0x394043, 0.7, 0.48);
  const acMat = standard('facade-ac', 0x596166, 0.82, 0.28);
  const shellFinish = def.finish === 'brick' ? 'brick' : 'plaster';
  const shellMat = material(`facade-shell-photo-${shellFinish}`, () => {
    const photo = photoSurfaces()?.[shellFinish];
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: photo?.map || null,
      bumpMap: photo?.height || null,
      bumpScale: photo?.height ? (shellFinish === 'brick' ? 0.045 : 0.026) : 0,
      roughness: shellFinish === 'brick' ? 0.96 : 0.92,
      metalness: 0.01,
    });
  });
  const copingMat = standard('facade-coping', 0x63686a, 0.9, 0.025);
  const balconyMat = standard('facade-balcony', 0x686e70, 0.9, 0.03);
  const balconyRailMat = standard('facade-balcony-rail', 0x343b3e, 0.68, 0.48);
  const masonryMat = material('facade-exposed-masonry-photo', () => {
    const photo = photoSurfaces()?.brick;
    return new THREE.MeshStandardMaterial({
      color: 0x8b7668,
      map: photo?.map || null,
      bumpMap: photo?.height || null,
      bumpScale: photo?.height ? 0.045 : 0,
      roughness: 0.96,
      metalness: 0,
    });
  });
  const breachMat = standard('facade-breach-dark', 0x222526, 1, 0);
  const rebarMat = standard('facade-breach-rebar', 0x242728, 0.7, 0.56);
  const breachInteriorMat = material('facade-breach-interior-photo', () => {
    const photo = photoSurfaces()?.plaster;
    return new THREE.MeshStandardMaterial({
      color: 0x4b4640,
      map: photo?.map || null,
      bumpMap: photo?.height || null,
      bumpScale: photo?.height ? 0.024 : 0,
      roughness: 0.98,
      metalness: 0,
    });
  });
  const slabMat = material('facade-breach-concrete-photo', () => {
    const photo = photoSurfaces()?.concrete;
    return new THREE.MeshStandardMaterial({
      color: 0x66645f,
      map: photo?.map || null,
      normalMap: photo?.normalMap || null,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughnessMap: photo?.roughnessMap || null,
      roughness: 0.95,
      metalness: 0.01,
    });
  });

  const facadeParent = new THREE.Matrix4().compose(
    new THREE.Vector3(
      (def.x1 + def.x2) / 2 + nx * (def.out ?? 0.2),
      def.yBase,
      (def.z1 + def.z2) / 2 + nz * (def.out ?? 0.2),
    ),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(1, 1, 1),
  );
  // Split even a hundred-metre collision wall into individual property widths. The base wall
  // remains the authoritative collision and photographic skin; these shallow shell pieces
  // create stepped roof massing, party-wall rhythm and damage without changing navigation.
  const lots = [];
  const breachRoll = rng(def.seed * 7919 + 43);
  let lotStart = -len / 2;
  while (lotStart < len / 2 - 0.25) {
    const remaining = len / 2 - lotStart;
    const preferred = 7.5 + R() * 5.5;
    const width = remaining < preferred + 4 ? remaining : preferred;
    const rise = 0.52 + R() * 1.08;
    const damaged = R() < damageChance * 0.62;
    const windowStyle = Math.floor(R() * 4);
    lots.push({
      start: lotStart,
      width,
      rise,
      damaged,
      breached: damaged && def.height >= 5.8 && width > 7 && breachRoll() < 0.58,
      windowWidth: [1.58, 1.82, 2.12, 1.72][windowStyle],
      windowHeight: [1.38, 1.58, 1.48, 1.72][windowStyle],
      windowLift: [-0.1, 0.02, 0.12, -0.02][windowStyle],
      frameStyle: windowStyle,
      tone: shellFinish === 'brick'
        ? (R() < 0.42 ? 0x8f8178 : R() < 0.72 ? 0xa18d7f : 0x7f7771)
        : (R() < 0.42 ? 0x8a9292 : R() < 0.72 ? 0x9d9b92 : 0x817c75),
    });
    lotStart += width;
  }
  const breaches = [];
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    const centre = lot.start + lot.width / 2;
    const capWidth = Math.max(0.8, lot.width - 0.14);
    // A continuous collision wall can still read as individual properties. Shallow,
    // photographed skins give each lot its own construction tone and reset the texture
    // repeat at the party wall. Split the skin around authored doorway skips: windows already
    // respected them, but the uninterrupted photographic plane could still cover the actual
    // opening from outside while remaining invisible from the room behind it.
    let skinSegments = [{
      start: lot.start + 0.07,
      end: lot.start + lot.width - 0.07,
    }];
    for (const gap of def.skip || []) {
      const gapStart = -len / 2 + gap.from;
      const gapEnd = -len / 2 + gap.to;
      skinSegments = skinSegments.flatMap(segment => {
        if (gapEnd <= segment.start || gapStart >= segment.end) return [segment];
        const pieces = [];
        if (gapStart > segment.start) pieces.push({ start: segment.start, end: gapStart });
        if (gapEnd < segment.end) pieces.push({ start: gapEnd, end: segment.end });
        return pieces;
      });
    }
    for (const segment of skinSegments) {
      const skinWidth = segment.end - segment.start;
      if (skinWidth < 0.05) continue;
      batcher.add('facade-lot-skins', FACADE_SKIN_GEO, shellMat,
        instanceMatrix(facadeParent, (segment.start + segment.end) / 2,
          def.height / 2, -0.012, skinWidth, def.height - 0.05, 1),
        false,
        lot.tone);
    }
    if (def.roofCaps !== false) {
      const capGeometry = lot.damaged ? DAMAGED_PARAPET_GEO : FACADE_PANEL_GEO;
      batcher.add(
        lot.damaged ? 'facade-parapets-damaged' : 'facade-parapets',
        capGeometry,
        shellMat,
        instanceMatrix(
          facadeParent,
          centre,
          def.height + lot.rise / 2 - (lot.damaged ? lot.rise * 0.03 : 0),
          -0.28,
          capWidth,
          lot.rise,
          1.05,
        ),
        true,
        lot.tone,
      );
      // Intact caps receive a projecting stone/metal coping. Damaged caps leave their jagged
      // edge exposed rather than drawing an implausibly perfect trim line through the breach.
      if (!lot.damaged) {
        batcher.add('facade-parapet-coping', UNIT_BOX, copingMat,
          instanceMatrix(facadeParent, centre, def.height + lot.rise + 0.045, 0.02,
            capWidth + 0.12, 0.09, 0.46));
      } else {
        // A soot field over photographed wall material and a smaller exposed-brick patch gives
        // shell damage two material depths instead of a black decal standing in for a hole.
        const scarX = centre + (R() - 0.5) * Math.max(0.4, lot.width * 0.36);
        const scarY = def.height - 0.65 - R() * Math.min(1.8, def.height * 0.18);
        batcher.add('facade-shell-scars', FACADE_SCAR_GEO, sootMat,
          instanceMatrix(facadeParent, scarX, scarY, 0.018,
            1.8 + R() * 1.2, 1.35 + R() * 0.75, 1, 0, 0, (R() - 0.5) * 0.28));
        batcher.add('facade-exposed-masonry', FACADE_SCAR_GEO, masonryMat,
          instanceMatrix(facadeParent, scarX + (R() - 0.5) * 0.18, scarY - 0.05, 0.025,
            1.13 + R() * 0.52, 0.78 + R() * 0.38, 1, 0, 0, (R() - 0.5) * 0.18));
      }
    }

    if (lot.breached) {
      const breachWidth = Math.min(5.2, Math.max(3.2, lot.width * 0.58));
      const breachBottom = Math.max(2.55, def.height - floorH * 2.05);
      const breachTop = def.height + lot.rise * 0.28;
      const breachHeight = breachTop - breachBottom;
      const breachX = centre + (R() - 0.5) * Math.max(0.3, lot.width - breachWidth - 0.5);
      breaches.push({
        x: breachX,
        width: breachWidth,
        bottom: breachBottom,
        top: breachTop,
      });

      // The outer photographed masonry shape masks the intact collision wall; the smaller
      // dark shape above it leaves a broken 18–30 cm reveal around the room void.
      batcher.add('facade-breach-soot-fields', FACADE_BREACH_GEO, sootMat,
        instanceMatrix(facadeParent, breachX, (breachBottom + breachTop) / 2, 0.095,
          breachWidth * 1.27, breachHeight * 1.17, 1,
          0, 0, (R() - 0.5) * 0.025));
      batcher.add('facade-breach-masonry-rims', FACADE_BREACH_GEO, masonryMat,
        instanceMatrix(facadeParent, breachX, (breachBottom + breachTop) / 2, 0.105,
          breachWidth * 1.13, breachHeight * 1.08, 1, 0, 0, (R() - 0.5) * 0.035));
      batcher.add('facade-breach-recesses', FACADE_BREACH_GEO, breachMat,
        instanceMatrix(facadeParent, breachX, (breachBottom + breachTop) / 2, 0.125,
          breachWidth, breachHeight, 1, 0, 0, (R() - 0.5) * 0.025));
      for (let roomY = breachBottom + floorH * 0.5;
        roomY < breachTop - 0.25; roomY += floorH) {
        // Dim photographed back walls stop a large breach becoming a featureless black card.
        // The offset leaves part of the true dark recess visible around each surviving room.
        batcher.add('facade-breach-interior-backs', FACADE_BREACH_GEO, breachInteriorMat,
          instanceMatrix(facadeParent,
            breachX + (R() < 0.5 ? -1 : 1) * breachWidth * (0.14 + R() * 0.05),
            roomY + (R() - 0.5) * 0.16, 0.135,
            breachWidth * (0.38 + R() * 0.12), floorH * (0.54 + R() * 0.12), 1,
            0, 0, (R() - 0.5) * 0.045));
      }

      // Floor plates and partition stubs project out of the opening, giving the collapse
      // parallax at street angles. They remain visual-only; the original wall is collision.
      for (let y = Math.ceil(breachBottom / floorH) * floorH;
        y < breachTop - 0.35; y += floorH) {
        batcher.add('facade-breach-floor-slabs', DAMAGED_PARAPET_GEO, slabMat,
          instanceMatrix(facadeParent, breachX + (R() - 0.5) * 0.18, y, 0.58,
            breachWidth * (0.76 + R() * 0.16), 1.12, 0.34,
            Math.PI / 2, 0, (R() - 0.5) * 0.045), true);
      }
      for (const side of [-1, 1]) {
        batcher.add('facade-breach-party-walls', UNIT_BOX, slabMat,
          instanceMatrix(facadeParent,
            breachX + side * breachWidth * (0.43 + R() * 0.025),
            breachBottom + breachHeight * (0.46 + R() * 0.03), 0.46,
            0.14, breachHeight * (0.52 + R() * 0.1), 0.58,
            0, 0, side * (0.025 + R() * 0.025)), true);
      }
      for (let bar = 0; bar < 4; bar++) {
        const x = breachX - breachWidth * 0.32 + bar * breachWidth * 0.21;
        const length = 0.38 + R() * 0.48;
        batcher.add('facade-breach-rebar', DRAIN_GEO, rebarMat,
          instanceMatrix(facadeParent, x, breachBottom - length * 0.28, 0.34,
            0.42, length, 0.42, 0, 0, (R() - 0.5) * 0.18));
      }
      for (let chunk = 0; chunk < 9; chunk++) {
        const scale = 0.28 + R() * 0.42;
        batcher.add('facade-breach-collapse-piles', FACADE_COLLAPSE_RUBBLE_GEO,
          chunk % 3 === 0 ? masonryMat : slabMat,
          instanceMatrix(facadeParent,
            breachX + (R() - 0.5) * breachWidth * 0.82,
            breachBottom - 0.12 + R() * 0.22,
            0.2 + R() * 0.72,
            scale * (0.75 + R() * 0.7), scale, scale,
            R() * Math.PI, R() * Math.PI, R() * Math.PI), true);
      }
    }

    // Real projecting balconies are sparse and deliberately asymmetric. A repeated window
    // grid remains useful for target reading; one damaged balcony every few lots breaks its
    // office-block cadence and gives the facade genuine first-person depth.
    if (def.balconies !== false && def.height >= 5.8 && lot.width > 6.4 && R() < 0.34) {
      const balconyX = centre + (R() - 0.5) * Math.min(2, lot.width * 0.25);
      const balconyY = Math.min(def.height - 1.35, floorH + 0.08 + (R() < 0.24 ? floorH : 0));
      const balconyWidth = Math.min(3.25, Math.max(2.25, lot.width * 0.32));
      const brokenSide = R() < damageChance ? (R() < 0.5 ? -1 : 1) : 0;
      batcher.add('facade-balcony-slabs', UNIT_BOX, balconyMat,
        instanceMatrix(facadeParent, balconyX, balconyY, 0.56,
          balconyWidth, 0.16, 1.18, 0, 0, brokenSide * 0.025), true);
      batcher.add('facade-balcony-front-rails', UNIT_BOX, balconyRailMat,
        instanceMatrix(facadeParent, balconyX - brokenSide * 0.18, balconyY + 0.55, 1.08,
          balconyWidth - (brokenSide ? 0.44 : 0.1), 0.07, 0.055,
          0, 0, brokenSide * 0.065));
      for (const side of [-1, 1]) {
        if (side === brokenSide) continue;
        batcher.add('facade-balcony-side-rails', UNIT_BOX, balconyRailMat,
          instanceMatrix(facadeParent, balconyX + side * (balconyWidth / 2 - 0.05),
            balconyY + 0.55, 0.56, 0.055, 0.07, 1.02));
      }
      for (let bar = -balconyWidth / 2 + 0.28; bar < balconyWidth / 2; bar += 0.48) {
        if (brokenSide && Math.sign(bar) === brokenSide
          && Math.abs(bar) > balconyWidth * 0.24) continue;
        batcher.add('facade-balcony-balusters', UNIT_BOX, balconyRailMat,
          instanceMatrix(facadeParent, balconyX + bar, balconyY + 0.31, 1.08,
            0.045, 0.52, 0.045, 0, 0, brokenSide * 0.035));
      }
    }
  }
  // `skip` describes a ground-floor doorway in the tower facades. The vertical skin split
  // above keeps that opening clear, then these header pieces restore the photographed wall
  // above the lintel instead of exposing a raw full-height stripe through every upper floor.
  for (const gap of def.skip || []) {
    const headerBottom = 2.52;
    const headerHeight = def.height - headerBottom;
    if (headerHeight <= 0.05) continue;
    const start = -len / 2 + gap.from;
    const end = -len / 2 + gap.to;
    const centre = (start + end) / 2;
    const lot = lots.find(candidate =>
      centre >= candidate.start && centre < candidate.start + candidate.width) || lots[0];
    batcher.add('facade-doorway-skin-headers', FACADE_SKIN_GEO, shellMat,
      instanceMatrix(facadeParent, centre, headerBottom + headerHeight / 2, -0.011,
        end - start, headerHeight, 1),
      false,
      lot?.tone ?? 0x8a9292);
  }
  // Party-wall piers project through the window plane and continue above the old flat roof.
  // They make each lot read as a separate building even where the gameplay wall is continuous.
  for (let i = 1; i < lots.length; i++) {
    const x = lots[i].start;
    const along = x + len / 2;
    // A facade overlay may span a real collision doorway. Window generation already observes
    // `skip`, but an independently generated party pier could still occupy that same gap and
    // create a visible wall the player walked through. Keep structural overlays clear too.
    if ((def.skip || []).some(gap =>
      along > gap.from - 0.24 && along < gap.to + 0.24)) continue;
    const top = def.height + Math.min(lots[i - 1].rise, lots[i].rise);
    const base = len > 50 ? Math.max(0, def.height - 1.35) : 0;
    const pierHeight = top - base;
    batcher.add('facade-party-piers', UNIT_BOX, shellMat,
      instanceMatrix(facadeParent, x, base + pierHeight / 2, 0.02,
        len > 50 ? 0.12 : 0.16, pierHeight, 0.44),
      true,
      0x4b5153);
  }
  // Long street walls already carry mission-specific floor bands. On ordinary buildings,
  // interrupted lot-width ledges communicate separate construction dates without drawing a
  // mathematically perfect stripe across the whole block.
  if (len <= 50) {
    for (let y = floorH; y < def.height - 0.35; y += floorH) {
      for (const lot of lots) {
        if (R() < 0.18) continue;
        batcher.add('facade-floor-ledges', UNIT_BOX, copingMat,
          instanceMatrix(facadeParent, lot.start + lot.width / 2, y, 0.075,
            Math.max(0.5, lot.width - 0.22), 0.075, 0.3));
      }
    }
  }
  // Cornices, downpipes and wall-mounted plant break the single-box outline at negligible
  // cost because every repeated element is still one instanced batch.
  const gap = 0.55 + R() * Math.min(2.2, len * 0.12);
  for (const side of [-1, 1]) {
    const segment = Math.max(0.5, len / 2 - gap);
    batcher.add('facade-cornice', UNIT_BOX, frameMat,
      instanceMatrix(facadeParent, side * (len + gap) / 4, def.height - 0.08, 0.08,
        segment, 0.26, 0.42));
  }
  for (const x of [-len / 2 + 0.55, len / 2 - 0.55]) {
    batcher.add('facade-downpipes', DRAIN_GEO, utilityMat,
      instanceMatrix(facadeParent, x, def.height * 0.48, 0.16, 1, def.height * 0.92, 1));
  }
  if (def.height > 5 && len > 8) {
    const acCount = Math.min(3, Math.max(1, Math.floor(len / 15)));
    for (let i = 0; i < acCount; i++) {
      const x = -len * 0.3 + i * (len * 0.6 / Math.max(1, acCount - 1));
      const y = Math.min(def.height - 1.4, 2.5 + (i % 2) * 2.8);
      batcher.add('facade-ac-boxes', UNIT_BOX, acMat,
        instanceMatrix(facadeParent, x, y, 0.27, 0.72, 0.52, 0.38));
      batcher.add('facade-ac-fans', AC_FAN_GEO, utilityMat,
        instanceMatrix(facadeParent, x, y, 0.49, 1, 1, 1, Math.PI / 2));
    }
  }

  for (let fy = def.yBase + 1.2; fy < def.yBase + def.height - 1.3; fy += floorH) {
    for (let s = 1.8; s < len - 1.8; s += step) {
      if ((def.skip || []).some(g => s > g.from - 1.2 && s < g.to + 1.2)) continue;
      const localX = s - len / 2;
      const lot = lots.find(candidate =>
        localX >= candidate.start && localX < candidate.start + candidate.width);
      const windowW = Math.min(step - 0.38, lot?.windowWidth ?? 1.82);
      const windowH = lot?.windowHeight ?? 1.56;
      const windowY = fy + 0.74 + (lot?.windowLift ?? 0);
      const localY = windowY - def.yBase;
      if (breaches.some(breach =>
        Math.abs(localX - breach.x) < breach.width * 0.43
        && localY > breach.bottom - 0.35
        && localY < breach.top + 0.2)) continue;
      const parent = new THREE.Matrix4().compose(
        new THREE.Vector3(
        def.x1 + ux * s + nx * (def.out ?? 0.2),
        windowY,
        def.z1 + uz * s + nz * (def.out ?? 0.2),
        ),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        new THREE.Vector3(1, 1, 1),
      );
      const damageRoll = R();
      const destroyed = !def.staticWindows && damageRoll < damageChance * 0.38;
      const boarded = !def.staticWindows && !destroyed && damageRoll < damageChance * 0.68;
      const cracked = !def.staticWindows && !destroyed && !boarded && damageRoll < damageChance;
      const lit = !destroyed && !boarded && R() < litChance;
      const warm = R() < 0.72;
      let roomTile = null;
      if (photoRooms && !boarded) {
        if (destroyed) roomTile = 3;
        else if (lit) roomTile = warm ? 0 : 1;
        else roomTile = 2;
      }
      const roomMat = roomTile == null
        ? (lit ? (warm ? warmRoom : coolRoom) : recessMat)
        : photoRooms[roomTile];
      const roomGeometry = roomTile == null ? UNIT_PLANE : WINDOW_INTERIOR_GEOS[roomTile];
      const innerW = windowW - 0.2;
      const innerH = windowH - 0.18;
      const halfW = windowW / 2;
      const halfH = windowH / 2;
      batcher.add(
        roomTile == null
          ? (lit ? (warm ? 'recess-warm' : 'recess-cool') : 'recess-dark')
          : `window-room-photo-${roomTile}`,
        roomGeometry, roomMat, instanceMatrix(parent, 0, 0, 0.02, innerW, innerH, 1));
      // Four shallow plaster returns make the 30cm bay legible at an oblique street angle.
      // They sit inside the non-solid facade overlay, so bullets and navigation still use the
      // original wall/collision definitions.
      for (const [w, h, x, y] of [
        [0.095, windowH, -halfW + 0.05, 0],
        [0.095, windowH, halfW - 0.05, 0],
        [innerW, 0.085, 0, -halfH + 0.05],
        [innerW, 0.085, 0, halfH - 0.05],
      ]) {
        batcher.add('window-reveals', UNIT_BOX, revealMat,
          instanceMatrix(parent, x, y, 0.1, w, h, 0.28));
      }
      if (!def.staticWindows && !boarded && !destroyed) {
        batcher.add('pane-architectural', UNIT_PLANE, glassDark,
          instanceMatrix(parent, 0, 0, 0.235, innerW - 0.06, innerH - 0.06, 1));
      }
      const frameThickness = 0.058;
      const frameParts = [
        [windowW, frameThickness, 0, -halfH],
        [windowW, frameThickness, 0, halfH],
        [frameThickness, windowH, -halfW, 0],
        [frameThickness, windowH, halfW, 0],
      ];
      if (!destroyed && !boarded) {
        // Frame language belongs to the property, not to a dice roll on every opening.
        // Alternating one detail by floor avoids a cloned grid while preserving a coherent
        // renovation history for each lot.
        const floorIndex = Math.round((fy - def.yBase - 1.2) / floorH);
        const frameStyle = ((lot?.frameStyle ?? 0) + floorIndex) % 4;
        if (frameStyle !== 1) {
          const mullionX = frameStyle === 3 ? -innerW * 0.18 : 0;
          frameParts.push([0.046, innerH, mullionX, 0]);
        }
        if (frameStyle !== 2) {
          frameParts.push([innerW, 0.043, 0, frameStyle === 0 ? innerH * 0.12 : 0]);
        }
      }
      for (const [w, h, x, y] of frameParts) {
        batcher.add('window-frames', UNIT_BOX, frameMat,
          instanceMatrix(parent, x, y, 0.3, w, h, 0.065));
      }
      batcher.add('window-sills', UNIT_BOX, sillMat,
        instanceMatrix(parent, 0, -halfH - 0.055, 0.29,
          windowW + 0.14, 0.075, 0.26));
      if (boarded) {
        for (const [offset, angle] of [
          [-windowH * 0.27, 0.1], [0, -0.06], [windowH * 0.27, 0.14],
        ]) {
          batcher.add('window-boards', UNIT_BOX, boardMat,
            instanceMatrix(parent, 0, offset, 0.35, windowW - 0.1, 0.12, 0.075,
              0, 0, angle));
        }
      } else if (destroyed || cracked) {
        for (const [px, py, rz, sx] of [
          [-0.29, -0.3, 0.18, 0.55], [0.28, -0.34, -0.12, 0.62],
          [0.31, 0.29, 0.2, 0.42],
        ]) {
          if (cracked && px > 0) continue;
          batcher.add('window-shards', SHARD_GEO, shardMat,
            instanceMatrix(parent, px * windowW, py * windowH, 0.33,
              sx * windowW * 0.36, windowH * 0.17, 1, 0, 0, rz));
        }
        if (destroyed) {
          // One bent mullion and a soot bloom stop a blown opening from reading as the same
          // pristine kit with its glass material merely switched to black.
          batcher.add('window-bent-frames', UNIT_BOX, frameMat,
            instanceMatrix(parent, -windowW * 0.1, windowH * 0.08, 0.33,
              0.05, windowH * 0.76, 0.065,
              0, 0, -0.24));
          if (R() < 0.74) {
            batcher.add('facade-soot', FACADE_SCAR_GEO, sootMat,
              instanceMatrix(parent, R() * 0.34 - 0.17, halfH + 0.24, 0.012,
                windowW * (0.62 + R() * 0.2), windowH * (0.5 + R() * 0.22),
                1, 0, 0, R() * 0.4 - 0.2));
          }
        }
      } else if (!def.staticWindows) {
        const dressing = R();
        if (dressing < 0.28) {
          // Curtains live behind the glass and leave an irregular centre gap rather than
          // replacing the pane with another featureless rectangle.
          const gap = 0.2 + R() * 0.22;
          for (const side of [-1, 1]) {
            const width = innerW * (0.34 - gap * 0.08);
            batcher.add('window-curtains', UNIT_PLANE, curtainMat,
              instanceMatrix(parent, side * innerW * (0.29 + gap * 0.04), 0.02, 0.12,
                width, innerH * 0.88, 1, 0, 0, side * 0.025));
          }
        } else if (dressing < 0.48) {
          const partial = R() < 0.5;
          batcher.add('window-blinds', UNIT_PLANE, blindMat,
            instanceMatrix(parent, partial ? -innerW * 0.27 : 0, innerH * 0.24, 0.13,
              partial ? innerW * 0.42 : innerW * 0.9, innerH * 0.43, 1));
        }
        if (lit && R() < 0.62) {
          // A cabinet/radiator silhouette creates parallax against the back wall without
          // pretending every window contains a fully modelled room.
          const side = R() < 0.5 ? -1 : 1;
          batcher.add('window-interior-furniture', UNIT_BOX, interiorMat,
            instanceMatrix(parent, side * innerW * 0.28, -innerH * 0.32, 0.035,
              innerW * (0.26 + R() * 0.1), innerH * (0.28 + R() * 0.12), 0.08));
        }
      }
    }
  }
}

function addRoofCap(batcher, def) {
  const parent = new THREE.Matrix4().makeTranslation(def.x, def.y, def.z);
  const roof = standard('roof-cap', 0xffffff, 0.88, 0.03);
  batcher.add('roof-caps', ROOF_CAP_GEO, roof,
    instanceMatrix(parent, 0, 0, 0, def.w * 0.96, Math.min(3.4, def.w * 0.22), def.d * 0.96),
    false, def.color);
}

function addSkylineRoofProfile(batcher, def) {
  const geometries = {
    gabled: SKYLINE_GABLE_GEO,
    industrial: SKYLINE_SAWTOOTH_GEO,
    collapsed: SKYLINE_COLLAPSED_GEO,
  };
  const geometry = geometries[def.style];
  if (!geometry) return;
  const mat = standard('skyline-profile', 0xffffff, 0.96, 0.01);
  const parent = new THREE.Matrix4().compose(
    // The profile geometry is authored from y=0 upward; its origin sits directly on the
    // highest body mass so there is no floating half-height gap under a distant roof.
    new THREE.Vector3(def.x, def.y, def.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), def.yaw || 0),
    new THREE.Vector3(1, 1, 1),
  );
  batcher.add(`skyline-profile-${def.style}`, geometry, mat,
    instanceMatrix(parent, 0, 0, 0, def.w, def.h * 2, def.d),
    false,
    def.color);
}

function addSkylineFacade(batcher, def) {
  const R = rng(def.seed);
  const yaw = Math.atan2(def.nx, def.nz);
  const parent = new THREE.Matrix4().compose(
    new THREE.Vector3(def.x, def.yBase, def.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(1, 1, 1),
  );
  // These faces sit behind the playable architecture and dissolve into fog. Strong white
  // frames would turn them into a procedural grid, so the palette stays close to the wall
  // value and relies on recess, rhythm and silhouette instead of brightness.
  const recessMat = standard('skyline-window-recess', 0x070d12, 0.9, 0.02);
  const bandMat = standard('skyline-floor-band', 0xffffff, 0.96, 0);
  const railMat = standard('skyline-balcony-rail', 0x222a2f, 0.66, 0.48);
  const boardMat = standard('skyline-window-board', 0x4c4032, 0.96, 0.01);
  const scarMat = material('skyline-shell-scar', () => new THREE.MeshBasicMaterial({
    color: 0x090b0c,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  }));

  const facadeColor = new THREE.Color(def.color);
  const bandColor = facadeColor.clone().multiplyScalar(def.ring ? 0.72 : 0.82).getHex();
  const frameColor = facadeColor.clone().multiplyScalar(def.ring ? 0.9 : 1.06).getHex();
  const span = Math.max(3, def.span);
  const floorStep = Math.max(3.05, def.h / 11);
  const rows = Math.max(1, Math.min(11, Math.floor((def.h - 2.2) / floorStep)));
  const columns = Math.max(2, Math.min(7, Math.floor(span / 2.55)));
  const colStep = span / columns;
  const paneW = Math.min(1.35, Math.max(0.7, colStep * 0.48));
  const paneH = Math.min(1.45, Math.max(0.9, floorStep * 0.38));
  const balconyFamily = ['monolith', 'stepped', 'penthouse'].includes(def.profile);
  const exposedFamily = def.profile === 'collapsed';

  for (let row = 0; row < rows; row++) {
    const y = 1.65 + row * floorStep;
    if (y > def.h - 0.9) break;
    // One recessed row may be missing after shelling, and a few individual openings are
    // blanked or destroyed. The variation is deterministic so retries never redraw a city.
    const missingRow = def.profile === 'collapsed' && row === rows - 1;
    for (let col = 0; col < columns; col++) {
      if (missingRow && (col + def.seed) % 3 !== 0) continue;
      if (R() < (def.ring ? 0.14 : 0.09)) continue;
      const x = -span / 2 + colStep * (col + 0.5);
      batcher.add('skyline-window-recesses', UNIT_BOX, recessMat,
        instanceMatrix(parent, x, y, 0, paneW, paneH, 0.13));
      batcher.add('skyline-window-frames', SKYLINE_WINDOW_FRAME_GEO, bandMat,
        instanceMatrix(parent, x, y, 0.072, paneW * 1.16, paneH * 1.14, 1),
        false,
        frameColor);
      if (def.ring === 0 && R() < 0.065) {
        for (const slat of [-1, 1]) {
          batcher.add('skyline-window-boards', UNIT_BOX, boardMat,
            instanceMatrix(parent, x, y + slat * paneH * 0.13, 0.13,
              paneW * 0.92, 0.13, 0.075,
              0, 0, slat * (0.06 + R() * 0.05)));
        }
      }
    }
    // Shallow slab/cornice lines divide the enormous wall plane into believable storeys.
    // Every segment shares one InstancedMesh, even across the full skyline.
    if (row > 0 && (row % 2 === 0 || def.profile === 'industrial')) {
      batcher.add('skyline-floor-bands', UNIT_BOX, bandMat,
        instanceMatrix(parent, 0, y - floorStep * 0.48, 0.025,
          span * (0.9 + R() * 0.06), 0.11, 0.2),
        false,
        bandColor);
    }
    if (balconyFamily && row > 0 && row % 3 === (def.seed % 3)) {
      const balconyColumns = Math.min(2, Math.max(1, Math.floor(columns / 3)));
      for (let balcony = 0; balcony < balconyColumns; balcony++) {
        const col = Math.min(
          columns - 1,
          Math.floor((balcony + 1) * columns / (balconyColumns + 1)));
        const x = -span / 2 + colStep * (col + 0.5);
        const balconyW = Math.min(3.2, Math.max(1.8, colStep * 1.22));
        batcher.add('skyline-balcony-slabs', UNIT_BOX, bandMat,
          instanceMatrix(parent, x, y - paneH * 0.58, 0.34,
            balconyW, 0.13, 0.78),
          false,
          bandColor);
        batcher.add('skyline-balcony-rails', UNIT_BOX, railMat,
          instanceMatrix(parent, x, y - paneH * 0.3, 0.72,
            balconyW * 0.94, 0.52, 0.055));
        for (const side of [-1, 1]) {
          batcher.add('skyline-balcony-rails', UNIT_BOX, railMat,
            instanceMatrix(parent, x + side * balconyW * 0.46,
              y - paneH * 0.3, 0.4, 0.055, 0.52, 0.62));
        }
      }
    }
  }

  // Continuous piers make the wall read as a constructed elevation at oblique angles. They
  // also stop a tower with dark unlit windows from collapsing into one featureless slab.
  const pierStride = def.profile === 'industrial' ? 1 : 2;
  for (let col = 0; col <= columns; col += pierStride) {
    const x = -span / 2 + colStep * col;
    batcher.add('skyline-pilasters', UNIT_BOX, bandMat,
      instanceMatrix(parent, x, def.h * 0.5, 0.11,
        def.profile === 'industrial' ? 0.22 : 0.13,
        Math.max(1, def.h - 0.55), 0.26),
      false,
      bandColor);
  }

  // A projecting cap catches a narrow highlight and makes the roof edge legible from below.
  batcher.add('skyline-cornices', UNIT_BOX, bandMat,
    instanceMatrix(parent, 0, def.h - 0.16, 0.055, span * 0.96, 0.28, 0.34),
    false,
    bandColor);

  const scarChance = def.profile === 'collapsed' ? 0.96 : def.ring ? 0.16 : 0.28;
  if (R() < scarChance && def.h > 10) {
    const scarY = def.h * (0.38 + R() * 0.38);
    batcher.add('skyline-shell-scars', FACADE_SCAR_GEO, scarMat,
      instanceMatrix(parent, (R() - 0.5) * span * 0.52, scarY, 0.085,
        Math.min(span * 0.24, 3.8 + R() * 2.8),
        3.4 + R() * Math.min(5.5, def.h * 0.16), 1,
        0, 0, R() * 0.42 - 0.21));
    if (exposedFamily) {
      for (let floor = 0; floor < Math.min(3, rows); floor++) {
        const y = def.h - 0.8 - floor * floorStep;
        batcher.add('skyline-exposed-floor-slabs', UNIT_BOX, bandMat,
          instanceMatrix(parent, (R() - 0.5) * span * 0.18, y, 0.38,
            span * (0.48 + R() * 0.22), 0.16, 0.86),
          false,
          bandColor);
      }
    }
  }
}

function addSkylineRooftopEquipment(batcher, def) {
  const parent = new THREE.Matrix4().compose(
    new THREE.Vector3(def.x, def.y, def.z),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), def.yaw || 0),
    new THREE.Vector3(def.scale || 1, def.scale || 1, def.scale || 1),
  );
  const steel = standard('skyline-roof-steel', 0x313a40, 0.62, 0.58);
  const dark = standard('skyline-roof-dark', 0x171e22, 0.82, 0.18);
  const body = standard('skyline-roof-body', 0xffffff, 0.87, 0.08);
  if (def.style === 'plant') {
    batcher.add('skyline-roof-plant-housings', UNIT_BOX, body,
      instanceMatrix(parent, 0, 0.8, 0, 2.5, 1.6, 1.65),
      false,
      def.color);
    for (const side of [-1, 1]) {
      for (let louver = -1; louver <= 1; louver++) {
        batcher.add('skyline-roof-plant-louvers', UNIT_BOX, dark,
          instanceMatrix(parent, louver * 0.56, 0.85, side * 0.836,
            0.42, 0.64, 0.035));
      }
    }
    batcher.add('skyline-roof-vents', SKYLINE_ROOF_MAST_GEO, steel,
      instanceMatrix(parent, 0.72, 2.08, 0.22, 2.4, 1.7, 2.4));
  } else if (def.style === 'tank') {
    for (const x of [-0.5, 0.5]) for (const z of [-0.42, 0.42]) {
      batcher.add('skyline-roof-tank-supports', UNIT_BOX, steel,
        instanceMatrix(parent, x, 0.7, z, 0.12, 1.4, 0.12));
    }
    batcher.add('skyline-roof-tanks', SKYLINE_ROOF_TANK_GEO, body,
      instanceMatrix(parent, 0, 1.95, 0, 1, 1, 1),
      false,
      def.color);
    batcher.add('skyline-roof-tank-caps', SKYLINE_ROOF_TANK_CAP_GEO, body,
      instanceMatrix(parent, 0, 2.67, 0, 1, 0.42, 1),
      false,
      def.color);
  } else if (def.style === 'aerial') {
    batcher.add('skyline-roof-masts', SKYLINE_ROOF_MAST_GEO, steel,
      instanceMatrix(parent, 0, 3.3, 0, 1, 6.6, 1));
    for (const y of [2.25, 3.45, 4.65]) {
      batcher.add('skyline-roof-crossarms', UNIT_BOX, steel,
        instanceMatrix(parent, 0, y, 0, 2.25 - y * 0.14, 0.075, 0.075,
          0, 0, (y % 2 ? 1 : -1) * 0.035));
    }
    for (const x of [-0.62, 0.62]) {
      batcher.add('skyline-roof-aerial-cables', UNIT_BOX, dark,
        instanceMatrix(parent, x * 0.5, 2.3, 0, 0.025, 4.5, 0.025,
          0, 0, x * 0.11));
    }
  }
}

function addCeilingFixture(batcher, def) {
  const parent = new THREE.Matrix4().makeTranslation(def.x, def.y, def.z);
  const housing = standard('fixture-housing', 0x2b3033, 0.62, 0.42);
  const trim = standard('fixture-trim', 0x596064, 0.5, 0.5);
  const lensKey = `fixture-lens-${def.color}`;
  const lens = material(lensKey, () => new THREE.MeshStandardMaterial({
    color: 0xd8c9ad,
    emissive: new THREE.Color(def.color).multiplyScalar(0.48),
    emissiveIntensity: 0.72,
    roughness: 0.72,
    metalness: 0,
  }));
  batcher.add('ceiling-fixture-housings', UNIT_BOX, housing,
    instanceMatrix(parent, 0, -0.075, 0, def.w + 0.12, 0.13, def.d + 0.1));
  batcher.add(`ceiling-fixture-lenses-${def.color}`, UNIT_BOX, lens,
    instanceMatrix(parent, 0, -0.155, 0, def.w - 0.14, 0.045, def.d - 0.08));
  for (const x of [-def.w / 2 + 0.11, def.w / 2 - 0.11]) {
    batcher.add('ceiling-fixture-endcaps', UNIT_BOX, trim,
      instanceMatrix(parent, x, -0.17, 0, 0.09, 0.075, def.d + 0.04));
  }
  // Protective ribs turn a glowing rectangle into an industrial fitting and give the eye
  // a stable dark edge even when bloom is active.
  for (const x of [-0.24, 0.24]) {
    if (Math.abs(x) > def.w / 2 - 0.12) continue;
    batcher.add('ceiling-fixture-guards', UNIT_BOX, trim,
      instanceMatrix(parent, x, -0.185, 0, 0.025, 0.035, def.d - 0.03));
  }
}

function addMarketStall(batcher, scene, def, index) {
  const parent = new THREE.Matrix4().makeTranslation(def.x, 0, def.z);
  const steel = standard('stall-steel', 0x343a3f, 0.42, 0.72);
  const surfaceKit = surfaces();
  const timber = material('stall-timber-authored', () => new THREE.MeshStandardMaterial({
    color: 0x806249,
    map: surfaceKit.timber.map,
    normalMap: surfaceKit.timber.normalMap,
    normalScale: new THREE.Vector2(0.34, 0.34),
    roughness: 0.9,
    metalness: 0,
  }));
  const cloth = material('stall-cloth-instanced', () => new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: surfaceKit.fabric.map,
    normalMap: surfaceKit.fabric.normalMap,
    roughnessMap: surfaceKit.fabric.roughnessMap,
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 0.97,
    side: THREE.DoubleSide,
  }));
  const produce = [
    {
      key: 'cabbage',
      geometry: STALL_CABBAGE,
      material: standard('produce-cabbage', 0x526b37, 0.93, 0),
    },
    {
      key: 'squash',
      geometry: STALL_SQUASH,
      material: standard('produce-squash', 0xb86b28, 0.9, 0),
    },
    {
      key: 'loaf',
      geometry: STALL_LOAF,
      material: standard('produce-loaf', 0x9c7044, 0.94, 0),
    },
    {
      key: 'apple',
      geometry: STALL_CABBAGE,
      material: standard('produce-apple', 0x84352e, 0.9, 0),
    },
  ];

  // The old stall was a five-metre cabinet. The collision box remains invisible and
  // authoritative, while the visible replacement is an open frame with slatted storage.
  batcher.add('stall-counter-tops', UNIT_BOX, timber,
    instanceMatrix(parent, 0, 1.02, 0, 4.82, 0.13, 1.66), true);
  for (const z of [-0.72, 0.72]) {
    batcher.add('stall-counter-aprons', UNIT_BOX, timber,
      instanceMatrix(parent, 0, 0.86, z, 4.54, 0.22, 0.085), true);
  }
  for (const x of [-2.16, 2.16]) for (const z of [-0.68, 0.68]) {
    batcher.add('stall-counter-legs', UNIT_BOX, timber,
      instanceMatrix(parent, x, 0.51, z, 0.13, 0.95, 0.13), true);
  }
  batcher.add('stall-lower-shelves', UNIT_BOX, timber,
    instanceMatrix(parent, 0, 0.24, 0, 4.18, 0.075, 1.28), true);
  for (let crate = 0; crate < 3; crate++) {
    const x = -1.35 + crate * 1.34 + (index % 2 ? 0.08 : -0.06);
    batcher.add('stall-storage-crates', STALL_CRATE_GEO, timber,
      instanceMatrix(parent, x, 0.55, (crate % 2 ? 0.2 : -0.16),
        1, 0.86 + (crate % 2) * 0.08, 1, 0, (crate - 1) * 0.035, 0), true);
  }
  for (const x of [-2.28, 2.28]) for (const z of [-0.92, 0.92]) {
    batcher.add('stall-posts', STALL_POST, steel,
      instanceMatrix(parent, x, 1.52, z, 1, 1, 1), true);
  }
  batcher.add('stall-canopies', STALL_CANOPY, cloth,
    instanceMatrix(parent, 0, 3.02, 0, 1, 1, 1, -Math.PI / 2), false, def.color);
  for (const z of [-1.31, 1.31]) {
    batcher.add('stall-canopy-valances', STALL_VALANCE_GEO, cloth,
      instanceMatrix(parent, 0, 3.0, z, 1, 1, 1, 0, z < 0 ? Math.PI : 0, 0),
      false, def.color);
  }
  if (index % 3 !== 1) {
    const patchColor = index % 2 ? 0x5e665d : 0x706653;
    batcher.add('stall-canopy-patches', UNIT_PLANE, cloth,
      instanceMatrix(parent, index % 2 ? -1.15 : 1.2, 3.036, index % 3 ? 0.28 : -0.34,
        0.82, 0.52, 1, -Math.PI / 2, 0, (index % 2 ? -1 : 1) * 0.08),
      false, patchColor);
  }

  for (let tray = 0; tray < 4; tray++) {
    batcher.add('stall-produce-trays', STALL_TRAY_GEO, timber,
      instanceMatrix(parent, -1.68 + tray * 1.12, 1.11, 0, 1, 1, 1,
        0, (tray - 1.5) * 0.015, 0), true);
  }
  const R = rng(5101 + index * 173);
  for (let i = 0; i < 20; i++) {
    const tray = Math.floor(i / 5);
    const item = produce[(tray + index) % produce.length];
    const size = 0.82 + R() * 0.28;
    batcher.add(`stall-produce-${item.key}`, item.geometry, item.material,
      instanceMatrix(parent,
        -2.02 + tray * 1.12 + (i % 5) * 0.17 + (R() - 0.5) * 0.08,
        1.28 + R() * 0.045,
        -0.22 + (i % 2) * 0.42 + (R() - 0.5) * 0.09,
        size, size, size, (R() - 0.5) * 0.18, R() * Math.PI, (R() - 0.5) * 0.14));
  }

  batcher.add('stall-hanging-boards', UNIT_BOX, timber,
    instanceMatrix(parent, index % 2 ? -1.5 : 1.5, 2.42, 1.0,
      0.78, 0.36, 0.045, 0, 0, (index % 3 - 1) * 0.04));
  batcher.add('stall-bulbs', STALL_BULB,
    material('stall-bulb', () => new THREE.MeshBasicMaterial({ color: 0xffd39b })),
    instanceMatrix(parent, 0, 2.72, 0, 1, 1, 1));
  if (index % 4 === 0) {
    const pool = new THREE.PointLight(0xffb86d, 2.2, 12, 2);
    pool.position.set(def.x, 2.65, def.z);
    scene.add(pool);
  }
}

function addSupplyCrate(batcher, def) {
  const surfaceKit = surfaces();
  const timber = material('supply-crate-timber', () => new THREE.MeshStandardMaterial({
    color: 0x765a40,
    map: surfaceKit.timber.map,
    normalMap: surfaceKit.timber.normalMap,
    normalScale: new THREE.Vector2(0.36, 0.36),
    roughness: 0.92,
    metalness: 0,
  }));
  const label = material('supply-crate-label', () => new THREE.MeshStandardMaterial({
    color: 0xc7c0aa,
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
  }));
  const size = def.s || 1;
  const yaw = ((Math.round(def.x * 17 + def.z * 29) % 5) - 2) * 0.018;
  const parent = new THREE.Matrix4().compose(
    new THREE.Vector3(def.x, def.y || 0, def.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  batcher.add('supply-crates-authored', SUPPLY_CRATE_GEO, timber,
    instanceMatrix(parent, 0, size / 2, 0, size, size, size), true);
  batcher.add('supply-crate-labels', UNIT_PLANE, label,
    instanceMatrix(parent, 0.12 * size, size * 0.58, size * 0.506,
      size * 0.4, size * 0.22, 1, 0, 0, -0.025), false);
}

const cssHex = value => `#${new THREE.Color(value).getHexString()}`;

function paintPaper(ctx, R, x, y, w, h, fill, ragged = 4) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + R() * ragged, y + R() * ragged);
  ctx.lineTo(x + w - R() * ragged, y + R() * ragged);
  ctx.lineTo(x + w - R() * ragged, y + h - R() * ragged);
  ctx.lineTo(x + R() * ragged, y + h - R() * ragged);
  ctx.closePath();
  ctx.fill();
}

function dirtyTile(ctx, R, size, amount = 48) {
  for (let i = 0; i < amount; i++) {
    const alpha = 0.025 + R() * 0.09;
    ctx.fillStyle = `rgba(${R() < 0.55 ? '39,31,24' : '236,226,202'},${alpha})`;
    const r = 0.4 + R() * 2.2;
    ctx.fillRect(R() * size, R() * size, r, r * (0.45 + R()));
  }
}

function paintPoster(ctx, def, R, size) {
  const pad = 9;
  paintPaper(ctx, R, pad, 5, size - pad * 2, size - 10, cssHex(def.stock), 7);
  const ink = cssHex(def.ink);
  const layout = Math.floor(R() * 4);
  const wash = ctx.createLinearGradient(15, 18, size - 18, size * 0.68);
  wash.addColorStop(0, ink);
  wash.addColorStop(0.55, '#2a3235');
  wash.addColorStop(1, '#8c8474');
  ctx.fillStyle = wash;
  ctx.fillRect(17, 18, size - 34, size * 0.49);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#ece4d0';
  if (layout === 0) {
    ctx.beginPath();
    ctx.moveTo(17, size * 0.56);
    ctx.lineTo(size * 0.48, size * 0.23);
    ctx.lineTo(size - 17, size * 0.48);
    ctx.lineTo(size - 17, size * 0.66);
    ctx.lineTo(17, size * 0.66);
    ctx.fill();
  } else if (layout === 1) {
    ctx.save();
    ctx.translate(size / 2, size * 0.42);
    ctx.rotate(-0.48);
    ctx.fillRect(-size * 0.46, -11, size * 0.92, 22);
    ctx.restore();
    ctx.globalAlpha = 0.5;
    ctx.fillRect(size * 0.18, 22, 4, size * 0.42);
    ctx.fillRect(size * 0.73, 22, 2, size * 0.42);
  } else if (layout === 2) {
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.41, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.41, size * 0.12, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(22, 23, size * 0.31, size * 0.18);
    ctx.fillRect(size * 0.56, 23, size * 0.27, size * 0.18);
    ctx.fillRect(22, size * 0.45, size * 0.61, size * 0.17);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#171c1e';
    ctx.fillRect(size * 0.45, 18, 3, size * 0.49);
  }
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = ink;
  for (let i = 0; i < 4; i++) {
    const width = size * (0.67 - i * 0.09 - R() * 0.08);
    ctx.fillRect(17, size * 0.75 + i * 7, width, i === 0 ? 4 : 2);
  }
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = '#261f19';
  ctx.fillRect(7, 8, 8, 18);
  ctx.fillRect(size - 15, size - 25, 8, 18);
  ctx.globalAlpha = 1;
  dirtyTile(ctx, R, size, 64);
}

function paintNotice(ctx, R, size) {
  ctx.fillStyle = '#372d24';
  ctx.fillRect(3, 3, size - 6, size - 6);
  const cork = ctx.createLinearGradient(8, 8, size - 8, size);
  cork.addColorStop(0, '#826345');
  cork.addColorStop(1, '#594536');
  ctx.fillStyle = cork;
  ctx.fillRect(9, 9, size - 18, size - 18);
  const papers = ['#d7d0b9', '#bdc8ca', '#cabd9c', '#c7c5be'];
  for (let i = 0; i < 8; i++) {
    const w = 24 + R() * 25, h = 21 + R() * 31;
    const x = 13 + R() * (size - w - 26), y = 13 + R() * (size - h - 26);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((R() - 0.5) * 0.18);
    ctx.shadowColor = 'rgba(0,0,0,.3)';
    ctx.shadowBlur = 2;
    paintPaper(ctx, R, -w / 2, -h / 2, w, h, papers[i % papers.length], 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(35,43,47,.55)';
    for (let line = 0; line < 3; line++) {
      ctx.fillRect(-w * 0.34, -h * 0.2 + line * 5, w * (0.45 + R() * 0.22), 1.4);
    }
    ctx.fillStyle = i % 2 ? '#7d2f28' : '#344b5a';
    ctx.beginPath();
    ctx.arc(0, -h * 0.38, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  dirtyTile(ctx, R, size, 36);
}

function paintWhiteboard(ctx, R, size) {
  ctx.fillStyle = '#62686b';
  ctx.fillRect(2, 5, size - 4, size - 10);
  ctx.fillStyle = '#d7d7cf';
  ctx.fillRect(8, 10, size - 16, size - 24);
  ctx.strokeStyle = 'rgba(42,65,74,.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(16 + i * 19, 15);
    ctx.lineTo(12 + i * 21, size - 23);
    ctx.stroke();
  }
  ctx.strokeStyle = '#354f5a';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(15 + R() * 14, 25 + i * 19);
    ctx.bezierCurveTo(42 + R() * 12, 15 + i * 22, 61 + R() * 18, 42 + i * 14,
      size - 14, 24 + i * 20);
    ctx.stroke();
  }
  ctx.strokeStyle = '#8d352e';
  ctx.beginPath();
  ctx.moveTo(size * 0.56, size * 0.29);
  ctx.lineTo(size * 0.76, size * 0.43);
  ctx.lineTo(size * 0.66, size * 0.47);
  ctx.stroke();
  dirtyTile(ctx, R, size, 24);
}

function paintGraffiti(ctx, def, R, size) {
  const primary = cssHex(def.ink);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = primary;
  ctx.shadowColor = primary;
  ctx.shadowBlur = 2.5;
  ctx.lineWidth = 5 + R() * 4;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(11 + R() * 20, 25 + R() * 77);
    ctx.bezierCurveTo(32 + R() * 28, 8 + R() * 102, 71 + R() * 30,
      12 + R() * 105, size - 10, 24 + R() * 76);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = primary;
  for (let i = 0; i < 34; i++) {
    ctx.globalAlpha = 0.18 + R() * 0.46;
    const r = 0.4 + R() * 1.5;
    ctx.beginPath();
    ctx.arc(7 + R() * (size - 14), 10 + R() * (size - 20), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintPicture(ctx, R, size) {
  ctx.fillStyle = '#2f2923';
  ctx.fillRect(4, 7, size - 8, size - 14);
  const sky = ctx.createLinearGradient(10, 12, 10, size - 13);
  sky.addColorStop(0, '#6f7b7c');
  sky.addColorStop(0.55, '#a38f72');
  sky.addColorStop(1, '#343e38');
  ctx.fillStyle = sky;
  ctx.fillRect(11, 14, size - 22, size - 28);
  ctx.fillStyle = 'rgba(31,38,34,.82)';
  ctx.beginPath();
  ctx.moveTo(11, size - 14);
  for (let x = 11; x <= size - 11; x += 12) ctx.lineTo(x, 58 + R() * 35);
  ctx.lineTo(size - 11, size - 14);
  ctx.fill();
  dirtyTile(ctx, R, size, 20);
}

function paintShopSign(ctx, def, R, size) {
  const palettes = [
    ['#263f43', '#c8d2c4', '#8f3d32'],
    ['#473d2c', '#ded3ae', '#677d72'],
    ['#3c3339', '#d4c9bc', '#8b6940'],
  ];
  const labels = ['МАГАЗИН', 'СЕРВІС', 'АПТЕКА'];
  const palette = palettes[def.seed % palettes.length];
  const label = labels[def.seed % labels.length];
  ctx.fillStyle = '#202628';
  ctx.fillRect(2, 6, size - 4, size - 12);
  const wash = ctx.createLinearGradient(7, 8, size - 8, size - 9);
  wash.addColorStop(0, palette[0]);
  wash.addColorStop(0.58, palette[2]);
  wash.addColorStop(1, palette[0]);
  ctx.fillStyle = wash;
  ctx.fillRect(7, 11, size - 14, size - 22);
  ctx.strokeStyle = 'rgba(225,218,191,.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 14, size - 20, size - 28);

  // The square atlas tile maps onto a very wide sign. Horizontally compress the glyphs in
  // texture space so the world transform restores normal letter proportions.
  const aspect = Math.max(2.8, def.w / def.h);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(1 / aspect, 1);
  ctx.fillStyle = palette[1];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 78px Arial, sans-serif';
  ctx.fillText(label, 0, 1);
  ctx.restore();

  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 22; i++) {
    ctx.globalAlpha = 0.12 + R() * 0.38;
    ctx.fillRect(8 + R() * (size - 16), 12 + R() * (size - 24), 1 + R() * 5, 1 + R() * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  dirtyTile(ctx, R, size, 38);
}

function addWallDecals(scene, defs) {
  if (!defs.length) return;
  const tile = 128, cols = 8;
  const usedRows = Math.ceil(defs.length / cols);
  const atlasW = tile * cols;
  const atlasH = Math.pow(2, Math.ceil(Math.log2(Math.max(tile, usedRows * tile))));
  const canvas = document.createElement('canvas');
  canvas.width = atlasW;
  canvas.height = atlasH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, atlasW, atlasH);

  const positions = [], normals = [], uvs = [], indices = [];
  const counts = {};
  let signature = 2166136261;
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const R = rng(def.seed);
    const tx = (i % cols) * tile, ty = Math.floor(i / cols) * tile;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.beginPath();
    ctx.rect(0, 0, tile, tile);
    ctx.clip();
    if (def.style === 'poster') paintPoster(ctx, def, R, tile);
    else if (def.style === 'notice') paintNotice(ctx, R, tile);
    else if (def.style === 'whiteboard') paintWhiteboard(ctx, R, tile);
    else if (def.style === 'graffiti') paintGraffiti(ctx, def, R, tile);
    else if (def.style === 'picture') paintPicture(ctx, R, tile);
    else if (def.style === 'shop-sign') paintShopSign(ctx, def, R, tile);
    ctx.restore();

    counts[def.style] = (counts[def.style] || 0) + 1;
    signature ^= (def.seed + i * 131 + Math.round(def.x * 17) + Math.round(def.z * 29)) >>> 0;
    signature = Math.imul(signature, 16777619) >>> 0;

    const normal = def.rot ? [def.dir, 0, 0] : [0, 0, def.dir];
    const right = def.rot ? [0, 0, -def.dir] : [def.dir, 0, 0];
    const cx = def.x + normal[0] * 0.038, cy = def.y, cz = def.z + normal[2] * 0.038;
    const hw = def.w / 2, hh = def.h / 2;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    for (const [side, up] of corners) {
      positions.push(cx + right[0] * side, cy + up, cz + right[2] * side);
      normals.push(...normal);
    }
    const u0 = tx / atlasW, u1 = (tx + tile) / atlasW;
    const v0 = 1 - (ty + tile) / atlasH, v1 = 1 - ty / atlasH;
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
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(quality.maxAnisotropy || 4, 8);
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.08,
    roughness: 0.94,
    metalness: 0,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const out = new THREE.Mesh(geometry, mat);
  out.name = 'wall-decal-atlas';
  out.castShadow = false;
  out.receiveShadow = quality.shadows;
  out.userData.decalCount = defs.length;
  out.userData.decalCounts = counts;
  out.userData.atlasSize = [atlasW, atlasH];
  out.userData.signature = signature;
  scene.userData.wallDecalStats = out.userData;
  scene.add(out);
}

export function addVisualProps(scene, props = []) {
  const batcher = new InstanceBatcher(scene);
  const wallDecals = [];
  let marketIndex = 0;
  for (const def of props) {
    if (def.kind === 'vehicle') addVehicle(batcher, def);
    else if (def.kind === 'military-truck') addMilitaryTruck(batcher, def);
    else if (def.kind === 'facade') addFacade(batcher, def);
    else if (def.kind === 'market-stall') addMarketStall(batcher, scene, def, marketIndex++);
    else if (def.kind === 'supply-crate') addSupplyCrate(batcher, def);
    else if (def.kind === 'roof-cap') addRoofCap(batcher, def);
    else if (def.kind === 'skyline-roof-profile') addSkylineRoofProfile(batcher, def);
    else if (def.kind === 'skyline-facade') addSkylineFacade(batcher, def);
    else if (def.kind === 'skyline-rooftop-equipment') {
      addSkylineRooftopEquipment(batcher, def);
    }
    else if (def.kind === 'ceiling-fixture') addCeilingFixture(batcher, def);
    else if (def.kind === 'wall-decal') wallDecals.push(def);
    else if (def.kind === 'skyline-stats') scene.userData.skylineStats = def.stats;
  }
  batcher.flush();
  addWallDecals(scene, wallDecals);
}
