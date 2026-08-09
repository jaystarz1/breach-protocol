#!/usr/bin/env python3
"""Test-flight the authored military vehicle pool through the real strike-target pipeline.

Every row parks the procedural strike target (the game's scale reference, forced with
`procedural: true`) at slot zero, then the authored variants the pool can roll for that
kind — built by the same strikeTargetModel() the missions call, so normalization, facing,
cage overlays and pintle guns are all the shipping code path. Renders an aerial 3/4 pass
and a top-down drone pass per row and reports per-variant footprints.

Usage: python3 tools/qa-military-vehicles.py [--url http://127.0.0.1:4178/] [--out DIR]
"""
import argparse
import base64
import json
import pathlib

from playwright.sync_api import sync_playwright

# Seeds walk the weighted variant tables in military-vehicles.js deterministically;
# the chosen seeds cover every variant of each pool exactly once.
ROWS = [
    {"name": "tank", "kind": "tank", "seeds": [0, 3, 5]},
    {"name": "ifv", "kind": "apc", "seeds": [0, 3, 5]},
    {"name": "technical", "kind": "technical", "seeds": [0]},
    {"name": "jeep", "kind": "jeep", "seeds": [0, 1]},
    {"name": "ew", "kind": "ew", "seeds": [0]},
    {"name": "truck", "kind": "truck", "seeds": [0, 2, 4, 5]},
    {"name": "tanker", "kind": "tanker", "seeds": [0, 3]},
    # Dismounted fire teams: seed spread, team sizes, and the burned-out-hull cover prop.
    {"name": "infantry", "kind": "infantry", "seeds": [
        {"seed": 0, "team": 2},
        {"seed": 7, "team": 3},
        {"seed": 13, "team": 4, "cover": {"kind": "apc", "yaw": 0.4}},
        {"seed": 21, "team": 3, "cover": {"kind": "technical", "yaw": 2.6}},
        {"seed": 4, "team": 3, "destroyed": True},
    ]},
]

PAGE_SCRIPT = """async rows => {
  const THREE = await import('./lib/three.module.js');
  const { strikeTargetModel } = await import('./src/drone.js');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(1500, 500);
  renderer.shadowMap.enabled = true;
  document.body.style.margin = '0';
  document.body.appendChild(renderer.domElement);

  const report = [];
  const shots = [];

  for (const row of rows) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x76825f);
    const sun = new THREE.DirectionalLight(0xfff2df, 2.2);
    sun.position.set(30, 55, 25);
    sun.castShadow = true;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -60;
    sun.shadow.camera.right = sun.shadow.camera.top = 60;
    scene.add(sun, new THREE.AmbientLight(0xdfe7ff, 0.75));
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 60),
      new THREE.MeshStandardMaterial({ color: 0x6d7657, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const rowReport = { row: row.name, kind: row.kind, targets: [] };
    const targets = [{ procedural: true },
      ...row.seeds.map(entry => (typeof entry === 'object' ? entry : { seed: entry }))];
    let slotX = 0;
    for (const spec of targets) {
      const model = strikeTargetModel({
        pos: new THREE.Vector3(slotX, 0, 0),
        kind: row.kind,
        yaw: 0,
        index: spec.seed ?? 0,
        procedural: !!spec.procedural,
        team: spec.team,
        cover: spec.cover,
      });
      scene.add(model);
      // Sample the animation hook so articulated infantry render posed, and play a
      // destroyed slot's death fall through to its settled frame.
      if (spec.destroyed) model.userData.markDestroyed?.();
      for (let tick = 0; tick < 10; tick++) model.userData.update?.(0.12);
      // Skinned meshes report bind-space bounds (huge, meaningless pre-skinning), so the
      // dimension report measures static geometry only and falls back for empty models.
      const bounds = new THREE.Box3();
      model.updateMatrixWorld(true);
      model.traverse(part => {
        if (part.isMesh && !part.isSkinnedMesh) bounds.expandByObject(part, true);
      });
      if (bounds.isEmpty()) bounds.setFromObject(model, true);
      const size = bounds.getSize(new THREE.Vector3());
      const authored = model.children.find(c => c.userData.variant);
      rowReport.targets.push({
        slot: spec.procedural ? 'procedural' : `seed ${spec.seed}`,
        variant: authored ? authored.userData.variant : 'procedural',
        length: Number(size.x.toFixed(2)),
        width: Number(size.z.toFixed(2)),
        height: Number(size.y.toFixed(2)),
      });
      slotX += 9;
    }

    const midX = (slotX - 9) / 2;
    const camera = new THREE.PerspectiveCamera(38, 3, 0.1, 400);
    camera.position.set(midX - 12, 12, 24);
    camera.lookAt(midX, 1.2, 0);
    renderer.render(scene, camera);
    shots.push({ name: `${row.name}-aerial`, data: renderer.domElement.toDataURL('image/png') });
    camera.position.set(midX, 55, 0.01);
    camera.lookAt(midX, 0, 0);
    renderer.render(scene, camera);
    shots.push({ name: `${row.name}-top`, data: renderer.domElement.toDataURL('image/png') });
    report.push(rowReport);
  }
  return { report, shots };
}"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/")
    parser.add_argument("--out", default="/tmp/qa-military-vehicles")
    args = parser.parse_args()
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=90_000)
        result = page.evaluate(PAGE_SCRIPT, ROWS)
        browser.close()

    for shot in result["shots"]:
        payload = shot["data"].split(",", 1)[1]
        (out / f"{shot['name']}.png").write_bytes(base64.b64decode(payload))
    print(json.dumps(result["report"], indent=2))
    print(f"screenshots -> {out}")


if __name__ == "__main__":
    main()
