#!/usr/bin/env python3
"""Verify rounded civilian sleeves remain wrapped to all three live arm rigs."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-civilian-arms")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.set_default_timeout(90000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(5)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        page.wait_for_timeout(180)

        result = page.evaluate("""async () => {
          const THREE = await import('./lib/three.module.js');
          const { animateRig } = await import('./src/levelgen.js');
          const canonical = value => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
          const find = (root, name) => {
            const expected = canonical(name);
            let found = null;
            root.traverse(object => {
              const actual = canonical(object.name || '');
              if (!found && (actual === expected || actual.endsWith(expected))) found = object;
            });
            if (!found && expected.startsWith('wrist')) {
              const palm = expected.replace('wrist', 'palm');
              root.traverse(object => {
                const actual = canonical(object.name || '');
                if (!found && (actual === palm || actual.endsWith(palm))) found = object;
              });
            }
            return found;
          };
          const subjects = [];
          for (const source of [0, 1, 2]) {
            const civilian = BP.world.civilians.find(actor =>
              actor.mesh.userData.rig?.civilianSource === source);
            if (civilian) subjects.push(civilian);
          }
          const base = BP.player.pos;
          const lodSubject = subjects[0];
          const lodOrigin = lodSubject.pos.clone();
          lodSubject.pos.set(base.x, base.y, base.z - 9);
          lodSubject.update(0, BP.world);
          const farVisible = lodSubject.mesh.userData.rig.roundedSleeves.visible;
          lodSubject.pos.set(base.x, base.y, base.z - 4.5);
          lodSubject.update(0, BP.world);
          const nearVisible = lodSubject.mesh.userData.rig.roundedSleeves.visible;
          lodSubject.pos.copy(lodOrigin);
          lodSubject.baseY = lodOrigin.y;
          for (const actor of [...BP.world.enemies, ...BP.world.allies, ...BP.world.civilians]) {
            actor.mesh.visible = subjects.includes(actor);
            actor.update = () => {};
          }
          BP.player.locked = true;
          BP.player.health = 100000;
          BP.weapons.holder.visible = false;
          const distanceToSegment = (point, start, end) => {
            const segment = end.clone().sub(start);
            const t = THREE.MathUtils.clamp(
              point.clone().sub(start).dot(segment) / segment.lengthSq(), 0, 1);
            return point.distanceTo(start.clone().addScaledVector(segment, t));
          };
          return {
            lod: { farVisible, nearVisible },
            rigs: subjects.map((civilian, index) => {
            civilian.mesh.position.set(base.x + (index - 1) * 1.8, base.y, base.z - 4.8);
            civilian.mesh.rotation.set(0, 0, 0);
            civilian.walkPhase = 1.4 + index * 2.3;
            civilian.panic = true;
            animateRig(civilian.mesh, civilian.walkPhase, true, 0, true, 'flee');
            const rig = civilian.mesh.userData.rig;
            const sleeve = rig.roundedSleeves;
            civilian.mesh.updateMatrixWorld(true);
            const bones = {
              upperL: find(rig.visual, 'UpperArm.L'),
              lowerL: find(rig.visual, 'LowerArm.L'),
              wristL: find(rig.visual, 'Wrist.L'),
              upperR: find(rig.visual, 'UpperArm.R'),
              lowerR: find(rig.visual, 'LowerArm.R'),
              wristR: find(rig.visual, 'Wrist.R'),
            };
            const world = bone => bone.getWorldPosition(new THREE.Vector3());
            const segments = [
              [world(bones.upperL), world(bones.lowerL)],
              [world(bones.lowerL), world(bones.wristL)],
              [world(bones.upperR), world(bones.lowerR)],
              [world(bones.lowerR), world(bones.wristR)],
            ];
            let maxAxisDistance = 0;
            const box = new THREE.Box3();
            const vertex = new THREE.Vector3();
            for (let vertexIndex = 0;
              vertexIndex < sleeve.geometry.attributes.position.count;
              vertexIndex++) {
              sleeve.getVertexPosition(vertexIndex, vertex);
              sleeve.localToWorld(vertex);
              box.expandByPoint(vertex);
              maxAxisDistance = Math.max(
                maxAxisDistance,
                Math.min(...segments.map(([start, end]) =>
                  distanceToSegment(vertex, start, end))),
              );
            }
            const indexValues = sleeve.geometry.attributes.skinIndex.array;
            return {
              source: rig.civilianSource,
              style: rig.panicStyle,
              completeArmChain: Object.values(bones).every(Boolean),
              skinned: sleeve.isSkinnedMesh,
              segments: sleeve.userData.segmentCount,
              triangles: Math.round(
                (sleeve.geometry.index?.count
                  || sleeve.geometry.attributes.position.count) / 3),
              weightedBones: new Set(
                Array.from(indexValues).filter((_, valueIndex) => valueIndex % 4 === 0),
              ).size,
              maxAxisDistance: +maxAxisDistance.toFixed(4),
              worldSize: box.getSize(new THREE.Vector3()).toArray()
                .map(value => +value.toFixed(3)),
            };
            }),
          };
        }""")
        page.wait_for_timeout(120)
        page.screenshot(path=str(output / "rounded-hands-up-lineup.png"), timeout=90000)

        payload = {
            "lod": result["lod"],
            "rigs": result["rigs"],
            "screenshot": "rounded-hands-up-lineup.png",
            "errors": errors[:8],
        }
        rows = result["rigs"]
        print(json.dumps(payload, indent=2))
        assert not errors, payload
        assert not result["lod"]["farVisible"] and result["lod"]["nearVisible"], payload
        assert [row["source"] for row in rows] == [0, 1, 2], payload
        assert all(row["completeArmChain"] for row in rows), payload
        assert all(row["skinned"] and row["segments"] == 4 for row in rows), payload
        assert all(row["weightedBones"] == 4 for row in rows), payload
        assert all(row["triangles"] < 1000 for row in rows), payload
        assert all(row["maxAxisDistance"] < 0.09 for row in rows), payload
        assert all(row["worldSize"][0] > 0.45 for row in rows), payload
        # The three panic styles deliberately keep different elbow heights; even the compact
        # version must retain a substantial articulated vertical span.
        assert all(row["worldSize"][1] > 0.24 for row in rows), payload
        browser.close()


if __name__ == "__main__":
    main()
