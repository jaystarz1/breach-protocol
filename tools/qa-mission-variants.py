#!/usr/bin/env python3
"""Verify seeded mission variants stay deterministic, distinct, and nav-reachable."""
import argparse
import json

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument(
        "--levels",
        default="1,2,3,4,5,7,8,9,10",
        help="Comma-separated mission ids (default: every authored-variant mission)",
    )
    args = parser.parse_args()
    selected_levels = [int(value) for value in args.levels.split(",") if value]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)

        def capture(level):
            page.evaluate("(level) => BP.startLevel(level)", level)
            page.wait_for_function(
                f"() => BP.mode === 'playing' && BP.world.level.id === {level}",
                timeout=90000,
            )
            page.wait_for_timeout(120)
            return page.evaluate("""async () => {
              const { resolveActorVariant } = await import('./src/mission-variants.js');
              const nav = BP.world.nav;
              const nearest = (x, y, z) => {
                let best = -1;
                let bestDistance = Infinity;
                for (let node = 0; node < nav.nodeX.length; node++) {
                  const dy = Math.abs(nav.nodeY[node] - y);
                  if (dy > 2.2) continue;
                  const distance = Math.hypot(
                    nav.nodeX[node] - x,
                    (nav.nodeY[node] - y) * 2,
                    nav.nodeZ[node] - z,
                  );
                  if (distance < bestDistance) {
                    best = node;
                    bestDistance = distance;
                  }
                }
                return { node: best, distance: bestDistance };
              };
              const start = nearest(BP.player.pos.x, BP.player.pos.y, BP.player.pos.z);
              const visited = new Uint8Array(nav.nodeX.length);
              const queue = start.node >= 0 ? [start.node] : [];
              if (start.node >= 0) visited[start.node] = 1;
              for (let cursor = 0; cursor < queue.length; cursor++) {
                for (const next of nav.neighbors[queue[cursor]]) {
                  if (visited[next]) continue;
                  visited[next] = 1;
                  queue.push(next);
                }
              }
              // Closed breach doors deliberately split some missions into more than one nav
              // island. Record every actor's island so variants can be required to remain in
              // the same authored room without pretending a closed door is a path.
              const components = new Int32Array(nav.nodeX.length);
              components.fill(-1);
              let componentCount = 0;
              for (let seed = 0; seed < nav.nodeX.length; seed++) {
                if (components[seed] >= 0) continue;
                const componentQueue = [seed];
                components[seed] = componentCount;
                for (let cursor = 0; cursor < componentQueue.length; cursor++) {
                  for (const next of nav.neighbors[componentQueue[cursor]]) {
                    if (components[next] >= 0) continue;
                    components[next] = componentCount;
                    componentQueue.push(next);
                  }
                }
                componentCount++;
              }
              const actors = [...BP.world.enemies, ...BP.world.civilians]
                .filter(actor => !actor.perches && !actor.perch)
                .map(actor => {
                const target = nearest(actor.pos.x, actor.pos.y, actor.pos.z);
                return {
                  pos: [
                    +actor.pos.x.toFixed(2),
                    +actor.pos.y.toFixed(2),
                    +actor.pos.z.toFixed(2),
                  ],
                  node: target.node,
                  distance: +target.distance.toFixed(2),
                  reachable: target.node >= 0 && !!visited[target.node],
                  component: target.node >= 0 ? components[target.node] : -1,
                };
              });
              const reinforcements = (BP.world.reinf?.at || []).map(socket => {
                const target = nearest(socket[0], socket[1], socket[2]);
                return {
                  pos: socket,
                  node: target.node,
                  distance: +target.distance.toFixed(2),
                  reachable: target.node >= 0 && !!visited[target.node],
                };
              });
              const reachObjectives = BP.world.level.objectives
                .filter(objective => objective.type === 'reach')
                .map(objective => {
                  const [x, z, radius, y = 0] = objective.zone;
                  const target = nearest(x, y, z);
                  return {
                    zone: objective.zone,
                    node: target.node,
                    distance: +target.distance.toFixed(2),
                    reachable: target.node >= 0 && !!visited[target.node],
                    withinZone: target.distance <= radius + nav.cell,
                  };
                });
              const reconResponses = BP.world.level.objectives
                .flatMap(objective => objective.groundResponses || [])
                .map(response => ({
                  lane: response.lane,
                  enemies: response.enemies.map(enemy => {
                    const target = nearest(...enemy.pos);
                    return {
                      pos: enemy.pos,
                      node: target.node,
                      distance: +target.distance.toFixed(2),
                      reachable: target.node >= 0 && !!visited[target.node],
                    };
                  }),
                }));
              const defenseWaves = BP.world.level.objectives
                .filter(objective => objective.type === 'defend')
                .flatMap(objective => objective.waves || [])
                .flatMap(wave => wave.enemies || [])
                .map(definition => resolveActorVariant(
                  definition, BP.world.missionVariant));
              const waveEnemies = defenseWaves.map(enemy => {
                const target = nearest(...enemy.pos);
                return {
                  pos: enemy.pos,
                  patrol: enemy.patrol || [],
                  node: target.node,
                  distance: +target.distance.toFixed(2),
                  reachable: target.node >= 0 && !!visited[target.node],
                };
              });
              return {
                variant: BP.world.missionVariant,
                enemySignature: BP.world.enemies.map(enemy => [
                  +enemy.spawnPos.x.toFixed(1),
                  +enemy.spawnPos.y.toFixed(1),
                  +enemy.spawnPos.z.toFixed(1),
                ]),
                civilianSignature: BP.world.civilians.map(civilian => [
                  +civilian.spawnPos.x.toFixed(1),
                  +civilian.spawnPos.y.toFixed(1),
                  +civilian.spawnPos.z.toFixed(1),
                ]),
                reinforcementSockets: BP.world.reinf?.at || [],
                defenseWaveSignature: defenseWaves.map(enemy => ({
                  pos: enemy.pos,
                  patrol: enemy.patrol || [],
                })),
                streetLayout: BP.world.staticMesh.parent.userData.streetShopLayout || null,
                nav: {
                  nodes: nav.nodeX.length,
                  components: componentCount,
                  connectedFromStart: queue.length,
                  startDistance: +start.distance.toFixed(2),
                  actors,
                  reinforcements,
                  reachObjectives,
                  reconResponses,
                  waveEnemies,
                },
              };
            }""")

        results = {}
        for level in selected_levels:
            results[str(level)] = [capture(level) for _ in range(4)]

        output = {"levels": results, "errors": errors[:8]}
        assert not errors

        for level, rows in results.items():
            assert [row["variant"] for row in rows] == [0, 1, 2, 0], (level, rows)
            assert rows[0]["enemySignature"] == rows[3]["enemySignature"], level
            assert rows[0]["civilianSignature"] == rows[3]["civilianSignature"], level
            assert rows[0]["reinforcementSockets"] == rows[3]["reinforcementSockets"], level
            assert rows[0]["defenseWaveSignature"] == rows[3]["defenseWaveSignature"], level
            assert rows[0]["streetLayout"] == rows[3]["streetLayout"], level
            assert len({
                json.dumps(row["enemySignature"], sort_keys=True)
                for row in rows[:3]
            }) == 3, level
            baseline_components = [
                actor["component"] for actor in rows[0]["nav"]["actors"]
            ]
            for row in rows:
                assert row["nav"]["nodes"] > 0, (level, row)
                assert row["nav"]["connectedFromStart"] > 0, (level, row)
                assert row["nav"]["startDistance"] < 2.5, (level, row)
                assert all(
                    actor["node"] >= 0
                    and actor["distance"] < 2.8
                    for actor in row["nav"]["actors"]
                ), (level, row)
                # Breach rooms and dedicated firing bays are intentionally separate islands.
                # Their variants must stay in the identical authored island. Open missions
                # instead require every initial actor to be directly path-reachable.
                if level in {"1", "3", "6", "7", "8", "10"}:
                    actor_components = [
                        actor["component"] for actor in row["nav"]["actors"]
                    ]
                    assert actor_components == baseline_components, (
                        level,
                        {
                            "variant": row["variant"],
                            "baselineComponents": baseline_components,
                            "actorComponents": actor_components,
                            "actors": row["nav"]["actors"],
                        },
                    )
                else:
                    assert all(
                        actor["reachable"] for actor in row["nav"]["actors"]
                    ), (level, row)
                assert all(
                    socket["node"] >= 0
                    and socket["distance"] < 2.8
                    and (socket["reachable"] or level == "6")
                    for socket in row["nav"]["reinforcements"]
                ), (level, row)
                assert all(
                    objective["node"] >= 0
                    and objective["withinZone"]
                    and (objective["reachable"] or level == "3")
                    for objective in row["nav"]["reachObjectives"]
                ), (level, row)
                if level == "2":
                    responses = row["nav"]["reconResponses"]
                    assert [response["lane"] for response in responses] == [
                        "EAST", "CENTRAL", "WEST"
                    ], row
                    assert all(
                        enemy["node"] >= 0
                        and enemy["distance"] < 2.8
                        and enemy["reachable"]
                        for response in responses
                        for enemy in response["enemies"]
                    ), row
                assert all(
                    enemy["node"] >= 0
                    and enemy["distance"] < 2.8
                    and enemy["reachable"]
                    for enemy in row["nav"]["waveEnemies"]
                ), (level, row)

        if "2" in results:
            street = results["2"]
            assert len({
                json.dumps(row["streetLayout"], sort_keys=True)
                for row in street[:3]
            }) == 3
        for level in [
            key for key in ["2", "3", "4", "5", "7", "8", "9", "10"]
            if key in results
        ]:
            rows = results[level]
            assert len({
                json.dumps(row["reinforcementSockets"], sort_keys=True)
                for row in rows[:3]
            }) == 3, level
        if "10" in results:
            assert len({
                json.dumps(row["defenseWaveSignature"], sort_keys=True)
                for row in results["10"][:3]
            }) == 3
        print(json.dumps({
            "levels": {
                level: {
                    "variants": [row["variant"] for row in rows],
                    "enemyLayouts": len({
                        json.dumps(row["enemySignature"], sort_keys=True)
                        for row in rows[:3]
                    }),
                    "reinforcementLayouts": len({
                        json.dumps(row["reinforcementSockets"], sort_keys=True)
                        for row in rows[:3]
                    }),
                    "defenseWaveLayouts": len({
                        json.dumps(row["defenseWaveSignature"], sort_keys=True)
                        for row in rows[:3]
                    }),
                    "streetLayouts": len({
                        json.dumps(row["streetLayout"], sort_keys=True)
                        for row in rows[:3]
                    }),
                    "navNodes": [row["nav"]["nodes"] for row in rows[:3]],
                }
                for level, rows in results.items()
            },
            "errors": errors,
        }, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
