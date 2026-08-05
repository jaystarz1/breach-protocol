#!/usr/bin/env python3
"""Focused Level 5 objective route probe (manifest -> gate -> exfil)."""
import argparse
import json
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.set_default_timeout(90000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("() => BP.startLevel(105)")
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        result = page.evaluate("""async () => {
          const world = BP.world;
          BP.player.locked = true;
          for (const enemy of world.enemies) enemy.dead = true;
          await new Promise(resolve => setTimeout(resolve, 260));
          const manifest = world.objectiveDevices.find(d => d.id === 'l5-manifest');
          const gate = world.objectiveDevices.find(d => d.id === 'l5-gate');
          const gateVisual = BP.scene.getObjectByName('market-south-gate-visual');
          const exfilPad = BP.scene.getObjectByName('market-exfil-pad');
          if (!gate.blockerSolid || !gateVisual || !exfilPad) throw new Error('Level 5 gate/exfil art wiring missing');
          const snap = (label) => ({
            label, idx: world.objectiveIdx, step: world.objectiveStepIdx,
            active: BP.objective?.type || '', device: BP.objective?.device || '',
            auto: !!BP.objective?.autoUse, nearest: BP.nearestObjectiveDevice?.id || '',
            manifestUsed: !!manifest.used, gateUsed: !!gate.used,
            gateBlocker: world.solids.includes(gate.blockerSolid),
            x: BP.player.pos.x, y: BP.player.pos.y, z: BP.player.pos.z,
          });
          const out = [snap('after-clear')];
          BP.player.pos.set(manifest.pos[0], 0, manifest.pos[2]);
          await new Promise(resolve => setTimeout(resolve, 260));
          out.push(snap('on-manifest')); 
          BP.player.pos.set(gate.pos[0], 0, gate.pos[2]);
          await new Promise(resolve => setTimeout(resolve, 320));
          out.push({ ...snap('after-gate-entry'), blockerPresent: world.solids.includes(gate.blockerSolid), gateOpen: !!gate.opened });
          BP.player.pos.set(0, 0, -42.5);
          await new Promise(resolve => setTimeout(resolve, 320));
          out.push({ ...snap('at-exfil'), won: !!world.won, mode: BP.mode });
          return out;
        }""")
        result.append({"errors": errors[:10]})
        assert not errors, result
        assert result[0]["idx"] == 1 and result[0]["active"] == "interact", result
        assert result[0]["gateBlocker"], result
        assert result[1]["manifestUsed"] and result[1]["idx"] == 2 and result[1]["auto"], result
        assert result[2]["gateUsed"] and result[2]["auto"] is False and not result[2]["blockerPresent"] and result[2]["gateOpen"], result
        assert result[3]["won"] and result[3]["z"] == -42.5, result
        print(json.dumps(result, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
