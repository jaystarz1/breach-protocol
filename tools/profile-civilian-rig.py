#!/usr/bin/env python3
"""Inspect civilian arm-bone dimensions in the live desktop character pipeline."""

import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(5)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        result = page.evaluate(
            """async () => {
              const THREE = await import('./lib/three.module.js');
              const canonical = value => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
              const find = (root, name) => {
                let found = null;
                root.traverse(object => {
                  const actual = canonical(object.name || '');
                  const expected = canonical(name);
                  if (!found && (actual === expected || actual.endsWith(expected))) {
                    found = object;
                  }
                });
                return found;
              };
              const rows = {};
              for (const civilian of BP.world.civilians) {
                const rig = civilian.mesh.userData.rig;
                const key = String(rig.civilianSource);
                if (rows[key]) continue;
                const visual = rig.visual;
                civilian.mesh.updateMatrixWorld(true);
                const bones = {};
                for (const side of ['L', 'R']) {
                  for (const name of ['UpperArm', 'LowerArm', 'Wrist']) {
                    const bone = find(visual, `${name}.${side}`);
                    bones[`${name}.${side}`] = bone ? {
                      position: bone.position.toArray().map(value => +value.toFixed(5)),
                      rootPosition: civilian.mesh.worldToLocal(
                        bone.getWorldPosition(new THREE.Vector3()),
                      ).toArray().map(value => +value.toFixed(5)),
                      scale: bone.scale.toArray().map(value => +value.toFixed(5)),
                      child: bone.children.find(child => child.isBone)?.name || null,
                    } : null;
                  }
                }
                rows[key] = {
                  source: rig.civilianSource,
                  bodyScale: rig.bodyScale,
                  visualScale: visual.scale.toArray().map(value => +value.toFixed(5)),
                  bones,
                };
              }
              return rows;
            }"""
        )
        browser.close()
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
