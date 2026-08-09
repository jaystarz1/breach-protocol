#!/usr/bin/env python3
"""Test-flight the field fortifications and ambient population.

Builds the real level geo (trench works included) over the real carved DEM, stands the
authored population at its resolved posts, and renders each trench from a drone's
aerial 3/4, a top-down pass, and a low oblique. Also probes the DEM carve: reports the
depression depth at each trench centre against undisturbed ground 30m off the line.

Usage: python3 tools/qa-trench-population.py [--url http://127.0.0.1:4178/] [--out DIR]
"""
import argparse
import base64
import json
import pathlib

from playwright.sync_api import sync_playwright

PAGE_SCRIPT = """async () => {
  const THREE = await import('./lib/three.module.js');
  const { LEVELS } = await import('./src/levels/index.js');
  const { terrainSampler, buildTerrainMesh } = await import('./src/terrain.js');
  const { DEEP_FENCE_TERRAIN } = await import('./src/levels/terrain-deep-fence.js');
  const { strikeTargetModel, setDroneTerrain } = await import('./src/drone.js');

  const level = LEVELS.find(entry => entry.name === 'DEEP FENCE');
  const geo = level.geo();
  const sample = terrainSampler(DEEP_FENCE_TERRAIN);
  setDroneTerrain(sample);
  // The trench garrisons: every distinct optional infantry target with authored
  // figure spots, deduped across steps (they are appended to every sortie).
  const seen = new Set();
  const trenchGroups = level.objectives
    .flatMap(phase => phase.steps || [phase])
    .flatMap(step => step.vehicles || [])
    .filter(vehicle => vehicle.kind === 'infantry' && vehicle.figures
      && !seen.has(vehicle.label) && seen.add(vehicle.label));

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(1280, 720);
  renderer.shadowMap.enabled = true;
  document.body.style.margin = '0';
  document.body.appendChild(renderer.domElement);

  const report = [];
  const shots = [];

  for (const [index, group] of trenchGroups.entries()) {
    const [cx, , cz] = group.pos;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8a9377);
    const sun = new THREE.DirectionalLight(0xfff2df, 2.0);
    sun.position.set(cx + 40, 70, cz + 30);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    const shadowCam = sun.shadow.camera;
    shadowCam.left = shadowCam.bottom = -60;
    shadowCam.right = shadowCam.top = 60;
    scene.add(sun, sun.target, new THREE.AmbientLight(0xdfe7ff, 0.8));
    scene.add(buildTerrainMesh(DEEP_FENCE_TERRAIN, sample(cx, cz) - 30));

    // The level's boxes near this trench, works and colliders alike.
    for (const entry of geo) {
      const [x, y, z, sx, sy, sz, color] = entry;
      if (Math.abs(x - cx) > 45 || Math.abs(z - cz) > 45) continue;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    }

    // The garrison, built by the exact code path a mission uses.
    const ground = sample(cx, cz);
    const model = strikeTargetModel({
      ...group, pos: new THREE.Vector3(cx, ground, cz), index,
    });
    for (let tick = 0; tick < 6; tick++) model.userData.update?.(0.1);
    scene.add(model);

    const away = sample(cx + 30, cz + 30);
    report.push({
      trench: index, label: group.label, at: [cx, cz],
      figures: group.figures.length, carveDepth: Number((away - ground).toFixed(2)),
    });

    const camera = new THREE.PerspectiveCamera(46, 1280 / 720, 0.1, 600);
    const frame = (px, py, pz, ty) => {
      camera.position.set(px, py, pz);
      camera.lookAt(cx, ground + ty, cz);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    };
    shots.push({ name: `trench${index}-aerial`, data: frame(cx - 20, ground + 26, cz + 34, 0.5) });
    shots.push({ name: `trench${index}-top`, data: frame(cx, ground + 55, cz + 0.01, 0) });
    shots.push({ name: `trench${index}-oblique`, data: frame(cx - 26, ground + 6, cz + 15, 0.8) });
  }
  return { report, shots };
}"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/")
    parser.add_argument("--out", default="/tmp/qa-trench-population")
    args = parser.parse_args()
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=90_000)
        result = page.evaluate(PAGE_SCRIPT)
        browser.close()

    for shot in result["shots"]:
        payload = shot["data"].split(",", 1)[1]
        (out / f"{shot['name']}.png").write_bytes(base64.b64decode(payload))
    print(json.dumps(result["report"], indent=2))
    print(f"screenshots -> {out}")


if __name__ == "__main__":
    main()
