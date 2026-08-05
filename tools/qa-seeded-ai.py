#!/usr/bin/env python3
"""Verify hostile/crowd decisions repeat by mission seed and use only safe spawn sockets."""
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
        page.set_default_timeout(90000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)

        # Elite exercises deterministic count scaling and duplicated crowd placement instead
        # of only the one-to-one Regular path.
        page.evaluate("() => BP.setDifficulty(4)")

        rows = []
        for _ in range(4):
            page.evaluate("() => BP.startLevel(105)")
            page.wait_for_function(
                "() => BP.mode === 'playing' && BP.world.level.id === 5",
                timeout=90000,
            )
            page.wait_for_timeout(120)
            rows.append(page.evaluate("""async () => {
              const { LEGACY_LEVELS } = await import('./src/levels/index.js');
              const level = LEGACY_LEVELS.find(candidate => candidate.id === 5);
              const allowed = new Set();
              const add = position => {
                if (!position) return;
                allowed.add(position.map(value => +value.toFixed(3)).join(','));
              };
              for (const definition of level.civilians) {
                add(definition.pos);
                for (const position of definition.positions || []) add(position);
                for (const variant of definition.variants || []) add(variant.pos);
              }
              for (const position of level.crowdSpawns || []) add(position);
              const positionKey = actor => actor.spawnPos.toArray()
                .map(value => +value.toFixed(3)).join(',');
              const navDistance = actor => {
                let best = Infinity;
                for (let index = 0; index < BP.world.nav.nodeX.length; index++) {
                  if (Math.abs(BP.world.nav.nodeY[index] - actor.spawnPos.y) > 2.2) continue;
                  best = Math.min(best, Math.hypot(
                    BP.world.nav.nodeX[index] - actor.spawnPos.x,
                    BP.world.nav.nodeZ[index] - actor.spawnPos.z,
                  ));
                }
                return best;
              };
              return {
                variant: BP.world.missionVariant,
                enemyCount: BP.world.enemies.length,
                civilianCount: BP.world.civilians.length,
                enemySpawns: BP.world.enemies.map(enemy =>
                  enemy.spawnPos.toArray().map(value => +value.toFixed(3))),
                civilianSpawns: BP.world.civilians.map(civilian =>
                  civilian.spawnPos.toArray().map(value => +value.toFixed(3))),
                unsafeCivilians: BP.world.civilians
                  .map(positionKey).filter(key => !allowed.has(key)),
                offNavCivilians: BP.world.civilians
                  .map(civilian => +navDistance(civilian).toFixed(3))
                  .filter(distance => distance > 2.8),
                overlappingCivilians: (() => {
                  const counts = {};
                  for (const civilian of BP.world.civilians) {
                    const key = positionKey(civilian);
                    counts[key] = (counts[key] || 0) + 1;
                  }
                  return Object.entries(counts)
                    .filter(([, count]) => count > 1)
                    .map(([position, count]) => ({ position, count }));
                })(),
                enemyDecisions: BP.world.enemies.map(enemy => ({
                  speed: +enemy.speed.toFixed(6),
                  standoff: +enemy.standoff.toFixed(6),
                  strafeDir: enemy.strafeDir,
                  tacticalRole: enemy.tacticalRole,
                  tacticalSide: enemy.tacticalSide,
                  surrenderEligible: enemy.surrenderEligible,
                })),
                allyDecisions: BP.world.allies.map(ally => ({
                  strafeDir: ally.strafeDir,
                  speed: ally.speed,
                  ct: ally.ct,
                })),
              };
            }"""))

        actor_streams = page.evaluate("""async () => {
          const { Enemy } = await import('./src/enemies.js');
          const scene = BP.world.staticMesh.parent;
          const definition = seed => ({
            pos: [0, 0, 0],
            _seed: seed,
            perches: [[-2, 4, -8], [0, 7, -8], [2, 4, -8]],
          });
          const snapshot = enemy => ({
            initial: {
              speed: +enemy.speed.toFixed(8),
              yaw: +enemy.yaw.toFixed(8),
              walkPhase: +enemy.walkPhase.toFixed(8),
              strafeDir: enemy.strafeDir,
              standoff: +enemy.standoff.toFixed(8),
              peekTimer: +enemy.peekTimer.toFixed(8),
              role: enemy.tacticalRole,
              side: enemy.tacticalSide,
              surrender: enemy.surrenderEligible,
            },
            draws: Array.from({ length: 12 }, () => +enemy.random().toFixed(9)),
            perches: Array.from({ length: 8 }, () => {
              enemy.takePerch();
              return enemy.perchIdx;
            }),
          });
          const first = new Enemy(scene, definition(728391), BP.world.diff);
          const repeat = new Enemy(scene, definition(728391), BP.world.diff);
          const different = new Enemy(scene, definition(728392), BP.world.diff);
          const result = {
            first: snapshot(first),
            repeat: snapshot(repeat),
            different: snapshot(different),
          };
          scene.remove(first.mesh, repeat.mesh, different.mesh);
          return result;
        }""")

        source_randomness = page.evaluate("""async () => {
          const files = [
            './src/enemies.js', './src/civilians.js', './src/squad.js',
          ];
          const rows = {};
          for (const file of files) {
            const source = await fetch(file, { cache: 'no-store' }).then(response =>
              response.text());
            rows[file] = (source.match(/Math\\.random/g) || []).length;
          }
          return rows;
        }""")

        result = {
            "eliteMarket": rows,
            "actorStreams": actor_streams,
            "sourceMathRandom": source_randomness,
            "errors": errors[:10],
        }
        print(json.dumps(result, indent=2))

        assert not errors, result
        assert [row["variant"] for row in rows] == [0, 1, 2, 0], result
        assert rows[0]["enemyCount"] == rows[3]["enemyCount"], result
        assert rows[0]["civilianCount"] == rows[3]["civilianCount"], result
        assert rows[0]["enemySpawns"] == rows[3]["enemySpawns"], result
        assert rows[0]["civilianSpawns"] == rows[3]["civilianSpawns"], result
        assert rows[0]["enemyDecisions"] == rows[3]["enemyDecisions"], result
        assert rows[0]["allyDecisions"] == rows[3]["allyDecisions"], result
        assert all(not row["unsafeCivilians"] for row in rows), result
        assert all(not row["offNavCivilians"] for row in rows), result
        assert all(not row["overlappingCivilians"] for row in rows), result
        assert len({
            json.dumps(row["enemyDecisions"], sort_keys=True)
            for row in rows[:3]
        }) == 3, result
        assert actor_streams["first"] == actor_streams["repeat"], result
        assert actor_streams["first"] != actor_streams["different"], result
        assert all(count == 0 for count in source_randomness.values()), result
        browser.close()


if __name__ == "__main__":
    main()
