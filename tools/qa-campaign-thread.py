#!/usr/bin/env python3
"""Verify campaign continuity and BASTION's non-arcade in-world identity."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--output", default="/private/tmp/bp-campaign-thread")
    args = parser.parse_args()
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)

        # Three secured nodes must resume at mission four, both at initial boot and when the
        # menu button is used later in the same page. Preserve the product's open mission
        # select; this is campaign continuity, not a test-only unlock mechanism.
        page.evaluate("""() => {
          localStorage.setItem('breach-protocol-save-v1', JSON.stringify({
            unlocked: 10,
            difficulty: 1,
            quality: 'desktop',
            best: {
              1: { score: 800, grade: 'A', difficulty: 'REGULAR' },
              2: { score: 760, grade: 'A', difficulty: 'REGULAR' },
              3: { score: 720, grade: 'B', difficulty: 'REGULAR' },
            },
          }));
        }""")
        page.reload(wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.click("#menu-continue")
        page.wait_for_function(
            "() => document.querySelector('#screen-brief').classList.contains('active')",
        )
        briefing = page.evaluate("""() => ({
          number: document.querySelector('#brief-num').textContent,
          title: document.querySelector('#brief-title').textContent,
          progress: document.querySelector('#brief-progress').textContent,
          target: document.querySelector('#brief-target-status').textContent,
          evidence: document.querySelector('#brief-evidence').textContent,
          dossier: document.querySelector('.intel-target').textContent,
        })""")
        page.screenshot(path=str(output_dir / "mission-04-dossier.png"))

        debrief_chain = page.evaluate("""async () => {
          const { campaignDebrief } = await import('./src/campaign.js');
          return [1, 4, 7, 10].map(id => ({ id, ...campaignDebrief(id, true) }));
        }""")

        page.evaluate("() => BP.startLevel(10)")
        page.wait_for_function(
            "() => BP.mode === 'playing' && BP.campaign.currentMission === 10",
            timeout=90000,
        )
        page.wait_for_timeout(350)
        page.evaluate("""() => {
          BP.world.enemies.forEach(enemy => {
            enemy.hold = true;
            enemy.speed = 0;
            enemy.reactTimer = 999;
          });
          BP.player.pos.set(22, -5, -26.5);
          BP.player.yaw = 0;
          BP.player.pitch = -0.03;
        }""")
        page.wait_for_timeout(220)
        page.screenshot(path=str(output_dir / "command-bunker-approach.png"))
        bastion = page.evaluate("""() => {
          const targets = BP.world.enemies.filter(enemy => enemy.bastion);
          const enemy = targets[0];
          const scene = BP.world.staticMesh.parent;
          const names = [];
          enemy?.mesh.traverse(object => {
            if (object.name) names.push(object.name);
          });
          return {
            count: targets.length,
            hvt: enemy?.hvt,
            flee: enemy?.flee,
            rootName: enemy?.mesh.name,
            rigBastion: enemy?.mesh.userData.rig?.bastion,
            namedParts: names.filter(name => name.startsWith('bastion-')),
            objective: BP.world.level.objectives
              .flatMap(objective => objective.steps || [objective])
              .find(step => step.type === 'target')?.text,
            objectiveMarkers: BP.world.objMarkers?.length || 0,
            liveMarker: !!BP.world.markLive,
            bunkerDrawCalls: BP.performance.render.calls,
            bunkerTriangles: BP.performance.render.triangles,
            bunkerArt: scene.userData.interiorMissionStats,
            bunkerBatches: [
              'bunker-dark-steel-boxes',
              'bunker-ventilation-trunk',
              'bunker-command-furniture',
              'bunker-tactical-map-screen',
              'bunker-wall-grime',
              'bunker-floor-grime',
            ].filter(name => !!scene.getObjectByName(name)),
          };
        }""")

        # Place only the QA camera and actor for a stable identity capture. No product state or
        # mission logic is altered: this merely removes bunker occlusion from the screenshot.
        page.evaluate("""() => {
          const enemy = BP.world.enemies.find(item => item.bastion);
          enemy.hold = true;
          enemy.flee = false;
          enemy.speed = 0;
          enemy.mesh.position.set(18, -5, -37.5);
          enemy.mesh.rotation.y = Math.PI;
          BP.player.pos.set(18, -5, -33.2);
          BP.player.yaw = 0;
          BP.player.pitch = -0.04;
          BP.player.camera.rotation.order = 'YXZ';
          BP.player.camera.rotation.set(BP.player.pitch, BP.player.yaw, 0);
        }""")
        page.wait_for_timeout(250)
        page.screenshot(path=str(output_dir / "bastion-in-world.png"))

        # Complete the first mission through its real objective loop and inspect the actual
        # debrief DOM. This catches wiring regressions that a direct campaign-module call does
        # not, including the delayed screen transition and the recovered-intelligence fields.
        page.evaluate("() => BP.startLevel(1)")
        page.wait_for_function(
            "() => BP.mode === 'playing' && BP.campaign.currentMission === 1",
            timeout=90000,
        )
        page.evaluate("""() => {
          BP.world.enemies.forEach(enemy => {
            enemy.dead = true;
            enemy.mesh.visible = false;
          });
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 1", timeout=10000)
        # Phase 2 is the backup-breaker reset. The F-interaction path is gated behind pointer
        # lock (absent headless), so mark the device used the same way enemy deaths are
        # simulated above; the objective checker advances it through the real code path.
        page.evaluate("""() => {
          const breaker = BP.world.objectiveDevices.find(device => device.id === 'l1-breaker');
          breaker.used = true;
          breaker.root.userData.used = true;
        }""")
        page.wait_for_function("() => BP.world.objectiveIdx === 2", timeout=10000)
        page.evaluate("""() => {
          BP.player.locked = true;
          BP.player.pos.set(0, 0, -19);
        }""")
        page.wait_for_function("() => BP.mode === 'debrief'", timeout=10000)
        debrief_dom = page.evaluate("""() => ({
          heading: document.querySelector('#debrief-intel-head').textContent,
          result: document.querySelector('#debrief-intel-result').textContent,
          lead: document.querySelector('#debrief-intel-lead').textContent,
          nextVisible: getComputedStyle(document.querySelector('#debrief-next')).display !== 'none',
        })""")
        page.screenshot(path=str(output_dir / "mission-01-intel-debrief.png"))

        result = {
            "briefing": briefing,
            "debriefChain": debrief_chain,
            "debriefDOM": debrief_dom,
            "bastion": bastion,
            "errors": errors[:10],
        }
        print(json.dumps(result, indent=2))

        assert "MISSION 04" in briefing["number"], briefing
        assert briefing["progress"].startswith("3/20"), briefing
        assert "ANTON MOROZOV" in briefing["dossier"], briefing
        assert "vehicle" in briefing["target"].lower(), briefing
        assert "relocation order" in briefing["evidence"].lower(), briefing
        assert all(item["result"] and item["nextLead"] for item in debrief_chain)
        assert len({item["result"] for item in debrief_chain}) == len(debrief_chain)
        assert debrief_dom["heading"] == "INTELLIGENCE RECOVERED", debrief_dom
        assert "annex is secure" in debrief_dom["result"].lower(), debrief_dom
        assert "LAUNCH CORRIDOR" in debrief_dom["lead"], debrief_dom
        assert debrief_dom["nextVisible"], debrief_dom
        assert bastion["count"] == 1, bastion
        assert bastion["hvt"] and bastion["flee"], bastion
        assert bastion["rootName"] == "campaign-antagonist-bastion", bastion
        assert bastion["rigBastion"], bastion
        assert {
            "bastion-radio-pack",
            "bastion-radio-aerial",
            "bastion-command-tab-left",
            "bastion-command-tab-right",
        }.issubset(set(bastion["namedParts"])), bastion
        assert "BASTION" in bastion["objective"], bastion
        assert bastion["objectiveMarkers"] == 0 and not bastion["liveMarker"], bastion
        assert bastion["bunkerArt"]["levelId"] == 10, bastion
        assert bastion["bunkerArt"]["instances"] >= 140, bastion
        assert len(bastion["bunkerBatches"]) == 6, bastion
        assert bastion["bunkerDrawCalls"] < 380, bastion
        assert bastion["bunkerTriangles"] < 750_000, bastion
        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    main()
