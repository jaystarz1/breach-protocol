#!/usr/bin/env python3
"""Verify Elite count scaling never stacks actors on one authored start socket."""

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
        page.evaluate("() => BP.setDifficulty(4)")

        levels = []
        for level in range(1, 11):
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function(
                f"() => BP.mode === 'playing' && BP.world.level.id === {level}"
            )
            levels.append(page.evaluate("""async () => {
              const { authoredActorSockets } = await import('./src/mission-variants.js');
              const key = actor => (actor.perch || actor.spawnPos.toArray())
                .map(value => +value.toFixed(3)).join(',');
              const allowedEnemy = new Set(authoredActorSockets(
                BP.world.level.enemies, BP.world.level.enemySpawns,
              ).map(position => position.map(value => +value.toFixed(3)).join(',')));
              const droneDefinitions = BP.world.level.objectives
                .flatMap(phase => phase.steps || [phase])
                .flatMap(objective => objective.combatWave?.enemies || []);
              const allowedDrone = new Set(authoredActorSockets(
                droneDefinitions, [],
              ).map(position => position.map(value => +value.toFixed(3)).join(',')));
              const allowedCivilian = new Set(authoredActorSockets(
                BP.world.level.civilians, BP.world.level.crowdSpawns,
              ).map(position => position.map(value => +value.toFixed(3)).join(',')));
              for (const definition of BP.world.level.civilians) {
                if (definition.window) {
                  allowedCivilian.add(definition.window
                    .map(value => +value.toFixed(3)).join(','));
                }
              }
              const navDistance = actor => {
                let best = Infinity;
                for (let index = 0; index < BP.world.nav.nodeX.length; index++) {
                  if (Math.abs(BP.world.nav.nodeY[index] - actor.pos.y) > 2.2) continue;
                  best = Math.min(best, Math.hypot(
                    BP.world.nav.nodeX[index] - actor.pos.x,
                    BP.world.nav.nodeZ[index] - actor.pos.z,
                  ));
                }
                return best;
              };
              const duplicates = actors => {
                const counts = {};
                for (const actor of actors) {
                  const position = key(actor);
                  counts[position] = (counts[position] || 0) + 1;
                }
                return Object.entries(counts)
                  .filter(([, count]) => count > 1)
                  .map(([position, count]) => ({ position, count }));
              };
              const occupied = {};
              for (const actor of [...BP.world.enemies, ...BP.world.civilians]) {
                const position = key(actor);
                occupied[position] ||= [];
                occupied[position].push(
                  BP.world.enemies.includes(actor) ? 'enemy' : 'civilian');
              }
              const setPieces = {
                bastion: BP.world.enemies.filter(actor => actor.bastion).length,
                hvt: BP.world.enemies.filter(actor => actor.hvt).length,
                perchedEnemies: BP.world.enemies.filter(actor => actor.perches).length,
                taggedEnemies: BP.world.enemies.filter(actor => actor.tag).length,
                hostages: BP.world.civilians.filter(actor => actor.wasHostage).length,
                windowCivilians: BP.world.civilians.filter(actor => actor.perch).length,
              };
              const expectedSetPieces = {
                bastion: BP.world.level.enemies.filter(definition => definition.bastion).length,
                hvt: BP.world.level.enemies.filter(definition => definition.hvt).length,
                perchedEnemies: BP.world.level.enemies
                  .filter(definition => definition.perches).length,
                taggedEnemies: BP.world.level.enemies.filter(definition => definition.tag).length,
                hostages: BP.world.level.civilians
                  .filter(definition => definition.hostage).length,
                windowCivilians: BP.world.level.civilians
                  .filter(definition => definition.window).length,
              };
              return {
                level: BP.world.level.id,
                enemies: BP.world.enemies.length,
                civilians: BP.world.civilians.length,
                setPieces,
                expectedSetPieces,
                enemyDuplicates: duplicates(BP.world.enemies),
                civilianDuplicates: duplicates(BP.world.civilians),
                mixedDuplicates: Object.entries(occupied)
                  .filter(([, roles]) => new Set(roles).size > 1)
                  .map(([position, roles]) => ({ position, roles })),
                unsafeEnemies: BP.world.enemies
                  .filter(actor => actor.droneTarget
                    ? !allowedDrone.has(key(actor))
                    : !allowedEnemy.has(key(actor)))
                  .map(key),
                unsafeCivilians: BP.world.civilians
                  .filter(actor => !allowedCivilian.has(key(actor)))
                  .map(key),
                offNavEnemies: BP.world.enemies
                  .filter(actor => !actor.perches && navDistance(actor) > 2.8)
                  .map(actor => ({ position: key(actor), distance: navDistance(actor) })),
                offNavCivilians: BP.world.civilians
                  .filter(actor => !actor.perch && navDistance(actor) > 2.8)
                  .map(actor => ({ position: key(actor), distance: navDistance(actor) })),
              };
            }"""))

        result = {"levels": levels, "errors": errors[:10]}
        print(json.dumps(result, indent=2))
        assert not errors, result
        assert all(not row["enemyDuplicates"] for row in levels), result
        assert all(not row["civilianDuplicates"] for row in levels), result
        assert all(not row["mixedDuplicates"] for row in levels), result
        assert all(not row["unsafeEnemies"] for row in levels), result
        assert all(not row["unsafeCivilians"] for row in levels), result
        assert all(not row["offNavEnemies"] for row in levels), result
        assert all(not row["offNavCivilians"] for row in levels), result
        assert all(
            row["setPieces"] == row["expectedSetPieces"] for row in levels
        ), result
        browser.close()


if __name__ == "__main__":
    main()
