#!/usr/bin/env python3
"""Capture gameplay-lit character close-ups and verify authored desktop rigs."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-characters")
    parser.add_argument("--action-study", action="store_true")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)

        def start(level):
            page.evaluate("(level) => BP.startLevel(level)", level)
            page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
            page.wait_for_timeout(180)

        def stage(kind):
            return page.evaluate(
                """kind => {
                  const actors = [
                    ...BP.world.enemies.map(actor => ({ actor, type: 'enemy' })),
                    ...BP.world.allies.map(actor => ({ actor, type: 'friendly' })),
                    ...BP.world.civilians.map(actor => ({ actor, type: 'civilian' })),
                  ];
                  let row = null;
                  if (kind === 'concealed') {
                    row = actors.find(item => item.type === 'enemy' && item.actor.concealed);
                  } else {
                    row = actors.find(item => item.type === kind
                      && !item.actor.concealed && !item.actor.hostage);
                  }
                  if (!row) return null;
                  for (const item of actors) item.actor.mesh.visible = item === row;
                  BP.player.locked = true;
                  BP.player.health = 100000;
                  BP.input.ads = false;
                  BP.weapons.holder.visible = false;
                  const base = BP.player.pos;
                  row.actor.mesh.position.set(base.x, base.y, base.z - 4.2);
                  row.actor.mesh.rotation.set(0, 0, 0);
                  if ('hold' in row.actor) {
                    row.actor.hold = true;
                    row.actor.state = 'patrol';
                    row.actor.reactTimer = 999;
                    row.actor.yaw = 0;
                  }
                  const rig = row.actor.mesh.userData.rig;
                  // Advance into the held portion of the active clip, then freeze the selected
                  // actor at the inspection mark. Normal AI resumes on a fresh level load.
                  rig?.mixer?.update(0.55);
                  rig?.applyWeaponPose?.();
                  row.actor.update = () => {};
                  const materials = [];
                  let meshes = 0;
                  let draws = 0;
                  let triangles = 0;
                  row.actor.mesh.traverse(object => {
                    if (!object.isMesh || !object.visible) return;
                    meshes++;
                    const mats = Array.isArray(object.material)
                      ? object.material : [object.material];
                    draws += Array.isArray(object.material)
                      ? Math.max(1, object.geometry?.groups?.length || mats.length)
                      : 1;
                    const count = object.geometry?.index?.count
                      || object.geometry?.attributes?.position?.count || 0;
                    triangles += Math.round(count / 3);
                    for (const material of mats) materials.push({
                      object: object.name,
                      material: material?.name || '',
                      color: material?.color?.getHexString?.() || null,
                      roughness: material?.roughness ?? null,
                      metalness: material?.metalness ?? null,
                    });
                  });
                  return {
                    kind,
                    authored: !!rig?.authored,
                    civilian: !!rig?.civilian,
                    concealed: !!row.actor.concealed,
                    mergedCombatant: !!rig?.mergedSkin?.userData?.mergedCombatant,
                    meshes,
                    draws,
                    triangles,
                    materials,
                  };
                }""",
                kind,
            )

        start(2)
        captures = {}
        for kind in ("enemy", "friendly"):
            captures[kind] = stage(kind)
            page.wait_for_timeout(80)
            page.screenshot(path=str(output / f"{kind}.png"))
            if kind == "enemy" and args.action_study:
                for action_name in (
                    "idle_gun", "idle_gun_pointing", "idle_gun_shoot",
                    "gun_shoot", "run_shoot",
                ):
                    available = page.evaluate(
                        """name => {
                          const enemy = BP.world.enemies.find(actor => actor.mesh.visible);
                          const rig = enemy?.mesh.userData.rig;
                          const action = rig?.actions?.[name];
                          if (!action) return false;
                          rig.mixer.stopAllAction();
                          action.reset().play();
                          action.time = Math.min(0.55, action.getClip().duration * 0.55);
                          rig.mixer.update(0);
                          return true;
                        }""",
                        action_name,
                    )
                    if available:
                        page.screenshot(path=str(output / f"action-{action_name}.png"))

        start(5)
        for kind in ("civilian", "concealed"):
            captures[kind] = stage(kind)
            page.wait_for_timeout(80)
            page.screenshot(path=str(output / f"{kind}.png"))

        result = {
            "captures": captures,
            "screenshots": [f"{kind}.png" for kind in captures],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))
        assert not errors, result
        assert all(row and row["authored"] for row in captures.values()), result
        assert captures["civilian"]["draws"] == 1, result
        assert captures["concealed"]["draws"] == 1, result
        assert captures["enemy"]["mergedCombatant"], result
        assert captures["friendly"]["mergedCombatant"], result
        assert captures["enemy"]["draws"] <= 3, result
        assert captures["friendly"]["draws"] <= 4, result
        browser.close()


if __name__ == "__main__":
    main()
