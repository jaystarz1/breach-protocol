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
    parser.add_argument("--rig-audit", action="store_true")
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
                  let carriedRifle = null;
                  let combatantSurface = null;
                  let civilianSurface = null;
                  let handRig = null;
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
                    if (object.userData.authoredCarriedRifle) {
                      object.geometry.computeBoundingBox();
                      const box = object.geometry.boundingBox;
                      const size = [
                        box.max.x - box.min.x,
                        box.max.y - box.min.y,
                        box.max.z - box.min.z,
                      ];
                      carriedRifle = {
                        name: object.name,
                        sourceParts: object.userData.sourceParts,
                        vertices: object.geometry.attributes.position.count,
                        triangles: Math.round(count / 3),
                        vertexColors: object.geometry.attributes.color?.count || 0,
                        size: size.map(value => +value.toFixed(3)),
                      };
                    }
                    if (object.userData.mergedCombatant) {
                      const fabric = object.geometry.attributes.fabricMask;
                      const visor = object.geometry.attributes.visorMask;
                      const values = attribute => {
                        if (!attribute) return [];
                        const out = [];
                        for (let i = 0; i < attribute.count; i++) out.push(attribute.getX(i));
                        return out;
                      };
                      const fabricValues = values(fabric);
                      const visorValues = values(visor);
                      const source = texture => texture?.image?.currentSrc
                        || texture?.image?.src || '';
                      combatantSurface = {
                        material: object.material.name,
                        fieldMap: source(object.material.userData.fieldMap),
                        normalMap: source(object.material.normalMap),
                        roughnessMap: source(object.material.roughnessMap),
                        normalRepeat: object.material.normalMap
                          ? object.material.normalMap.repeat.toArray() : null,
                        normalScale: object.material.normalScale?.toArray() || null,
                        fabricRange: fabricValues.length
                          ? [Math.min(...fabricValues), Math.max(...fabricValues)] : null,
                        fabricVertices: fabricValues.filter(value => value > 0).length,
                        visorRange: visorValues.length
                          ? [Math.min(...visorValues), Math.max(...visorValues)] : null,
                        visorVertices: visorValues.filter(value => value > 0).length,
                      };
                    }
                    if (object.userData.mergedCivilian) {
                      const values = attribute => {
                        if (!attribute) return [];
                        const out = [];
                        for (let i = 0; i < attribute.count; i++) out.push(attribute.getX(i));
                        return out;
                      };
                      const countMasked = attribute =>
                        values(object.geometry.attributes[attribute])
                          .filter(value => value > 0).length;
                      const source = texture => texture?.image?.currentSrc
                        || texture?.image?.src || '';
                      civilianSurface = {
                        material: object.material.name,
                        normalMap: source(object.material.normalMap),
                        skinVertices: countMasked('skinMask'),
                        hairVertices: countMasked('hairMask'),
                        eyeVertices: countMasked('eyeMask'),
                        fabricVertices: countMasked('fabricMask'),
                      };
                    }
                    for (const material of mats) materials.push({
                      object: object.name,
                      material: material?.name || '',
                      color: material?.color?.getHexString?.() || null,
                      roughness: material?.roughness ?? null,
                      metalness: material?.metalness ?? null,
                    });
                  });
                  if (rig?.combatant && rig.rifle) {
                    row.actor.mesh.updateMatrixWorld(true);
                    rig.rifle.geometry.computeBoundingBox();
                    const rootPoint = object => object
                      ? row.actor.mesh.worldToLocal(
                          object.getWorldPosition(rig.rifle.position.clone())).toArray()
                            .map(value => +value.toFixed(4))
                      : null;
                    const boneRow = name => {
                      let bone = rig.visual.getObjectByName(name);
                      const canonical = value => value.replace(/[^a-z0-9]/gi, '')
                        .toLowerCase();
                      const expected = canonical(name);
                      if (!bone) rig.visual.traverse(object => {
                        const actual = canonical(object.name || '');
                        if (!bone && (actual === expected || actual.endsWith(expected))) {
                          bone = object;
                        }
                      });
                      return bone ? {
                        name,
                        position: bone.position.toArray().map(value => +value.toFixed(4)),
                        quaternion: bone.quaternion.toArray().map(value => +value.toFixed(4)),
                        root: rootPoint(bone),
                      } : null;
                    };
                    const contact = (name, target) => {
                      const bone = boneRow(name);
                      if (!bone || !target) return null;
                      const dx = bone.root[0] - target.x;
                      const dy = bone.root[1] - target.y;
                      const dz = bone.root[2] - target.z;
                      return {
                        wrist: bone.root,
                        target: target.toArray().map(value => +value.toFixed(4)),
                        error: +Math.hypot(dx, dy, dz).toFixed(4),
                      };
                    };
                    handRig = {
                      rifleBounds: {
                        min: rig.rifle.geometry.boundingBox.min.toArray()
                          .map(value => +value.toFixed(4)),
                        max: rig.rifle.geometry.boundingBox.max.toArray()
                          .map(value => +value.toFixed(4)),
                      },
                      riflePosition: rig.rifle.position.toArray()
                        .map(value => +value.toFixed(4)),
                      rifleQuaternion: rig.rifle.quaternion.toArray()
                        .map(value => +value.toFixed(4)),
                      bones: [
                        'Wrist.L', 'Thumb2.L', 'Middle2.L', 'Middle3.L',
                        'Wrist.R', 'Thumb2.R', 'Middle2.R', 'Middle3.R',
                      ].map(boneRow).filter(Boolean),
                      contact: {
                        support: contact('Wrist.L', rig.weaponGripTargets?.support),
                        trigger: contact('Wrist.R', rig.weaponGripTargets?.trigger),
                      },
                    };
                  }
                  return {
                    kind,
                    authored: !!rig?.authored,
                    civilian: !!rig?.civilian,
                    concealed: !!row.actor.concealed,
                    mergedCombatant: !!rig?.mergedSkin?.userData?.mergedCombatant,
                    meshes,
                    draws,
                    triangles,
                    carriedRifle,
                    combatantSurface,
                    civilianSurface,
                    handRig,
                    materials,
                  };
                }""",
                kind,
            )

        start(2)
        captures = {}
        action_contacts = {}
        for kind in ("enemy", "friendly"):
            captures[kind] = stage(kind)
            page.wait_for_timeout(80)
            page.screenshot(path=str(output / f"{kind}.png"))
            if args.rig_audit:
                print(json.dumps(captures[kind], indent=2))
                browser.close()
                return
            if kind == "enemy" and args.action_study:
                page.evaluate("""() => {
                  const enemy = BP.world.enemies.find(actor => actor.mesh.visible);
                  if (!enemy) return;
                  const base = BP.player.pos;
                  enemy.mesh.position.set(base.x, base.y, base.z - 2.55);
                  enemy.mesh.rotation.y = -0.38;
                }""")
                page.wait_for_timeout(80)
                page.screenshot(path=str(output / "enemy-material-close.png"))
                for action_name in (
                    "idle_gun", "idle_gun_pointing", "idle_gun_shoot",
                    "gun_shoot", "run_shoot",
                ):
                    contact_row = page.evaluate(
                        """name => {
                          const enemy = BP.world.enemies.find(actor => actor.mesh.visible);
                          const rig = enemy?.mesh.userData.rig;
                          const action = rig?.actions?.[name];
                          if (!action) return null;
                          rig.mixer.stopAllAction();
                          action.reset().play();
                          action.time = Math.min(0.55, action.getClip().duration * 0.55);
                          rig.mixer.update(0);
                          rig.applyWeaponPose?.();
                          enemy.mesh.updateMatrixWorld(true);
                          const canonical = value => value.replace(/[^a-z0-9]/gi, '')
                            .toLowerCase();
                          const bone = name => {
                            const expected = canonical(name);
                            let found = null;
                            rig.visual.traverse(object => {
                              const actual = canonical(object.name || '');
                              if (!found && (actual === expected || actual.endsWith(expected))) {
                                found = object;
                              }
                            });
                            return found;
                          };
                          const local = object => enemy.mesh.worldToLocal(
                            object.getWorldPosition(rig.rifle.position.clone()));
                          const error = (object, target) => local(object).distanceTo(target);
                          let fingerError = 0;
                          for (const [finger, expected] of rig.weaponFingerPose || []) {
                            const dot = Math.min(1, Math.abs(finger.quaternion.dot(expected)));
                            fingerError = Math.max(fingerError, 2 * Math.acos(dot));
                          }
                          return {
                            name,
                            duration: +action.getClip().duration.toFixed(3),
                            supportError: +error(
                              bone('Wrist.L'), rig.weaponGripTargets.support).toFixed(4),
                            triggerError: +error(
                              bone('Wrist.R'), rig.weaponGripTargets.trigger).toFixed(4),
                            fingerError: +fingerError.toFixed(5),
                          };
                        }""",
                        action_name,
                    )
                    if contact_row:
                        action_contacts[action_name] = contact_row
                        page.screenshot(path=str(output / f"action-{action_name}.png"))

        start(5)
        for kind in ("civilian", "concealed"):
            captures[kind] = stage(kind)
            page.wait_for_timeout(80)
            page.screenshot(path=str(output / f"{kind}.png"))

        revealed = page.evaluate("""() => {
          const enemy = BP.world.enemies.find(actor => actor.mesh.visible && actor.concealed);
          if (!enemy) return null;
          enemy.revealWeapon();
          const rig = enemy.mesh.userData.rig;
          const rifle = rig?.rifle;
          if (!rifle) return null;
          return {
            concealed: enemy.concealed,
            authored: !!rig.authored,
            visible: rifle.visible,
            authoredRifle: !!rifle.userData.authoredCarriedRifle,
            sourceParts: rifle.userData.sourceParts,
            vertices: rifle.geometry.attributes.position.count,
          };
        }""")
        page.wait_for_timeout(80)
        page.screenshot(path=str(output / "concealed-revealed.png"))

        result = {
            "captures": captures,
            "concealedReveal": revealed,
            "actionContacts": action_contacts,
            "screenshots": [f"{kind}.png" for kind in captures]
            + (["enemy-material-close.png"] if args.action_study else [])
            + ([f"action-{name}.png" for name in action_contacts] if args.action_study else [])
            + ["concealed-revealed.png"],
            "errors": errors[:8],
        }
        print(json.dumps(result, indent=2))
        assert not errors, result
        assert all(row and row["authored"] for row in captures.values()), result
        assert captures["civilian"]["draws"] == 1, result
        assert captures["concealed"]["draws"] == 1, result
        for kind in ("civilian", "concealed"):
            surface = captures[kind]["civilianSurface"]
            assert surface and surface["material"] == "civilian-layered-surface", result
            assert surface["normalMap"].endswith(
                "assets/characters/materials/fabric074-normal.webp"
            ), result
            assert surface["skinVertices"] > 0, result
            assert surface["hairVertices"] > 0, result
            assert surface["eyeVertices"] > 0, result
            assert surface["fabricVertices"] > 0, result
        assert captures["enemy"]["mergedCombatant"], result
        assert captures["friendly"]["mergedCombatant"], result
        assert captures["enemy"]["draws"] <= 3, result
        assert captures["friendly"]["draws"] <= 4, result
        for kind in ("enemy", "friendly"):
            rifle = captures[kind]["carriedRifle"]
            assert rifle and rifle["sourceParts"] >= 7, result
            assert rifle["vertices"] > 10_000, result
            assert rifle["vertexColors"] == rifle["vertices"], result
            assert max(rifle["size"]) > 0.75, result
            surface = captures[kind]["combatantSurface"]
            expected_surface = (
                "combatant-field-fabric"
                if kind == "enemy"
                else "combatant-scanned-fabric"
            )
            assert surface and surface["material"] == expected_surface, result
            if kind == "enemy":
                assert surface["fieldMap"].endswith(
                    "assets/characters/materials/hostile-field-fabric.webp"
                ), result
            else:
                assert not surface["fieldMap"], result
            assert surface["normalMap"].endswith(
                "assets/characters/materials/fabric074-normal.webp"
            ), result
            assert surface["roughnessMap"].endswith(
                "assets/characters/materials/fabric074-roughness.webp"
            ), result
            assert surface["normalRepeat"] == [8, 8], result
            assert surface["normalScale"] == [0.3, 0.3], result
            assert surface["fabricRange"] == [0, 1], result
            assert surface["fabricVertices"] > 1_000, result
            assert surface["visorRange"] == [0, 1], result
            assert surface["visorVertices"] > 0, result
        assert revealed and not revealed["concealed"] and revealed["visible"], result
        assert revealed["authored"] and revealed["authoredRifle"], result
        assert revealed["sourceParts"] >= 7 and revealed["vertices"] > 10_000, result
        if args.action_study:
            assert len(action_contacts) == 5, result
            for row in action_contacts.values():
                # Firing recoil can put the forward wrist at the physical end of this
                # skeleton's reach. Keep the residual below 12 mm: inside the gloved palm,
                # with no visible daylight between hand and weapon.
                assert row["supportError"] <= 0.012, result
                assert row["triggerError"] <= 0.003, result
                assert row["fingerError"] <= 0.001, result
        browser.close()


if __name__ == "__main__":
    main()
