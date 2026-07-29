#!/usr/bin/env python3
"""Report the rendered triangle budget by object for a loaded mission."""

import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--level", type=int, default=5)
    parser.add_argument("--limit", type=int, default=30)
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=[
                "--use-angle=metal",
                "--ignore-gpu-blocklist",
                "--mute-audio",
            ],
        )
        page = browser.new_page(viewport={"width": 1512, "height": 982})
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("(level) => BP.startLevel(level)", args.level)
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        report = page.evaluate(
            """() => new Promise(resolve => {
              const rendered = new Map();
              BP.world.staticMesh.parent.traverse(object => {
                if (!object.isMesh) return;
                const previous = object.onAfterRender;
                object.onAfterRender = function (
                  renderer, scene, camera, geometry, material, group,
                ) {
                  if (previous) previous.apply(this, arguments);
                  const count = group?.count
                    ?? geometry.index?.count
                    ?? geometry.attributes.position?.count
                    ?? 0;
                  const triangles = Math.floor(count / 3) * (object.count || 1);
                  const name = object.name
                    || object.parent?.name
                    || `${object.type}:${material?.name || material?.type || 'material'}`;
                  rendered.set(name, (rendered.get(name) || 0) + triangles);
                };
              });
              requestAnimationFrame(() => requestAnimationFrame(() => {
                const rows = [...rendered.entries()]
                  .map(([name, triangles]) => ({ name, triangles }))
                  .sort((a, b) => b.triangles - a.triangles);
                resolve({
                  rendererTriangles: BP.performance.render.triangles,
                  summedTriangles: rows.reduce((sum, row) => sum + row.triangles, 0),
                  rows,
                });
              }));
            })"""
        )
        browser.close()

    print(json.dumps(
        {
            "level": args.level,
            "rendererTriangles": report["rendererTriangles"],
            "summedTriangles": report["summedTriangles"],
            "top": report["rows"][:args.limit],
        },
        indent=2,
    ))


if __name__ == "__main__":
    main()
