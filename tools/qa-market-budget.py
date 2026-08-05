#!/usr/bin/env python3
"""Attribute Mission 5 renderables and enforce its desktop draw-call budget."""
import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--ceiling", type=int, default=350)
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(105)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(220)

        result = page.evaluate("""() => {
          const scene = BP.world.staticMesh.parent;
          const effectiveVisible = object => {
            for (let node = object; node; node = node.parent) {
              if (!node.visible) return false;
            }
            return true;
          };
          const calls = root => {
            let meshes = 0;
            let draws = 0;
            let triangles = 0;
            root?.traverse(object => {
              if (!object.isMesh || !effectiveVisible(object)) return;
              meshes++;
              const materials = Array.isArray(object.material) ? object.material.length : 1;
              draws += Math.max(1, object.geometry?.groups?.length || materials);
              const indexCount = object.geometry?.index?.count || 0;
              const vertexCount = object.geometry?.attributes?.position?.count || 0;
              const instances = object.isInstancedMesh ? object.count : 1;
              triangles += Math.round((indexCount || vertexCount) / 3) * instances;
            });
            return { meshes, draws, triangles };
          };
          const actors = list => {
            const rows = list.map(actor => calls(actor.mesh));
            return {
              actors: rows.length,
              meshes: rows.reduce((sum, row) => sum + row.meshes, 0),
              draws: rows.reduce((sum, row) => sum + row.draws, 0),
              maxDraws: Math.max(0, ...rows.map(row => row.draws)),
            };
          };
          const named = {};
          scene.traverse(object => {
            if (!object.isMesh || !effectiveVisible(object)) return;
            const name = object.name || object.type;
            named[name] = (named[name] || 0) + 1;
          });
          const mergedSkin = actor => {
            const skin = actor?.mesh?.userData?.rig?.mergedSkin;
            return skin ? {
              merged: !!skin.userData.mergedCivilian,
              sourceMeshes: skin.userData.sourceMeshes,
              vertices: skin.geometry.attributes.position.count,
              bones: skin.skeleton.bones.length,
              vertexColors: !!skin.geometry.attributes.color,
            } : null;
          };
          return {
            renderer: BP.performance.render,
            scene: calls(scene),
            civilians: actors(BP.world.civilians),
            enemies: actors(BP.world.enemies),
            allies: actors(BP.world.allies),
            samples: {
              civilian: mergedSkin(BP.world.civilians[0]),
              concealedEnemy: mergedSkin(
                BP.world.enemies.find(enemy => enemy.mesh.userData.rig?.concealed)),
            },
            instancedBatches: Object.entries(named)
              .filter(([name]) => name.startsWith('stall-'))
              .sort(([a], [b]) => a.localeCompare(b)),
          };
        }""")
        result["errors"] = errors[:8]
        print(json.dumps(result, indent=2))
        assert not errors
        assert result["renderer"]["calls"] <= args.ceiling, result
        assert result["civilians"]["actors"] == 24, result
        assert result["civilians"]["draws"] == 24, result
        assert result["samples"]["civilian"]["merged"], result
        assert result["samples"]["concealedEnemy"]["merged"], result
        browser.close()


if __name__ == "__main__":
    main()
