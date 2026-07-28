#!/usr/bin/env python3
"""Report browser-decoded glTF structure, materials, and world-space bounds."""
import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="+")
    parser.add_argument("--url", default="http://127.0.0.1:4178/")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=90_000)
        result = page.evaluate(
            """async models => {
              const THREE = await import('./lib/three.module.js');
              const { GLTFLoader } = await import('./lib/GLTFLoader.js');
              const loader = new GLTFLoader();
              const reports = [];
              for (const model of models) {
                const gltf = await loader.loadAsync(model);
                gltf.scene.updateMatrixWorld(true);
                const bounds = new THREE.Box3().setFromObject(gltf.scene);
                const materials = new Map();
                const meshes = [];
                let triangles = 0;
                let vertices = 0;
                gltf.scene.traverse(object => {
                  if (!object.isMesh || !object.geometry) return;
                  const geometry = object.geometry;
                  const count = geometry.index
                    ? geometry.index.count
                    : geometry.attributes.position.count;
                  triangles += count / 3;
                  vertices += geometry.attributes.position.count;
                  const sourceMaterials = Array.isArray(object.material)
                    ? object.material
                    : [object.material];
                  for (const material of sourceMaterials) {
                    if (!material) continue;
                    materials.set(material.uuid, {
                      name: material.name,
                      color: material.color?.getHexString() || null,
                      map: !!material.map,
                      normalMap: !!material.normalMap,
                      roughnessMap: !!material.roughnessMap,
                      metalnessMap: !!material.metalnessMap,
                      transparent: material.transparent,
                    });
                  }
                  meshes.push({
                    name: object.name,
                    vertices: geometry.attributes.position.count,
                    triangles: count / 3,
                    materials: sourceMaterials.map(material => material?.name || ''),
                  });
                });
                reports.push({
                  model,
                  bounds: {
                    min: bounds.min.toArray(),
                    max: bounds.max.toArray(),
                    size: bounds.getSize(new THREE.Vector3()).toArray(),
                  },
                  vertices,
                  triangles,
                  meshes,
                  materials: [...materials.values()],
                });
              }
              return reports;
            }""",
            args.models,
        )
        print(json.dumps(result, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
