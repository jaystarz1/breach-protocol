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
        for level in [1, 2, 3, 4] + [100 + n for n in range(2, 11)]:
            page.evaluate("(id) => BP.startLevel(id)", level)
            page.wait_for_function(
                f"() => BP.mode === 'playing' && BP.world.level.id === {level if level < 100 else level - 100}"
            )
            levels.append(page.evaluate("""async () => {
              const { authoredActorSockets } = await import('./src/mission-variants.js');
              // Merged acts defer later segments' rosters (pendingActors) and keep their
              // difficulty sockets in per-phase groups; validate the FULL roster against the
              // union of both socket stores.
              const level = BP.world.level;
              const enemySockets = [
                ...(level.enemySpawns || []),
                ...Object.values(level.enemySpawnGroups || {}).flat(),
              ];
              const crowdSockets = [
                ...(level.crowdSpawns || []),
                ...Object.values(level.crowdSpawnGroups || {}).flat(),
              ];
              const roundKey = position => position
                .map(value => +(+value).toFixed(3)).join(',');
              const allowedEnemy = new Set(authoredActorSockets(
                level.enemies, enemySockets,
              ).map(roundKey));
              const droneDefinitions = level.objectives
                .flatMap(phase => phase.steps || [phase])
                .flatMap(objective => objective.combatWave?.enemies || []);
              const allowedDrone = new Set(authoredActorSockets(
                droneDefinitions, [],
              ).map(roundKey));
              const allowedCivilian = new Set(authoredActorSockets(
                level.civilians, crowdSockets,
              ).map(roundKey));
              for (const definition of level.civilians) {
                if (definition.window) allowedCivilian.add(roundKey(definition.window));
              }
              const rosterEnemies = [
                ...BP.world.enemies.map(actor => ({
                  p: actor.perch || actor.spawnPos.toArray(),
                  bastion: actor.bastion, hvt: actor.hvt, perches: actor.perches,
                  tag: actor.tag, droneTarget: actor.droneTarget,
                })),
                ...BP.world.pendingActors.enemies.map(definition => ({
                  p: definition.pos,
                  bastion: definition.bastion, hvt: definition.hvt,
                  perches: definition.perches, tag: definition.tag,
                })),
              ];
              const rosterCivilians = [
                ...BP.world.civilians.map(actor => ({
                  p: actor.perch || actor.spawnPos.toArray(),
                  hostage: actor.wasHostage, window: !!actor.perch,
                })),
                ...BP.world.pendingActors.civilians.map(definition => ({
                  p: definition.window || definition.pos,
                  hostage: !!definition.hostage, window: !!definition.window,
                })),
              ];
              const key = entry => roundKey(entry.p);
              const navDistance = entry => {
                let best = Infinity;
                for (let index = 0; index < BP.world.nav.nodeX.length; index++) {
                  if (Math.abs(BP.world.nav.nodeY[index] - entry.p[1]) > 2.2) continue;
                  best = Math.min(best, Math.hypot(
                    BP.world.nav.nodeX[index] - entry.p[0],
                    BP.world.nav.nodeZ[index] - entry.p[2],
                  ));
                }
                return best;
              };
              const duplicates = roster => {
                const counts = {};
                for (const entry of roster) {
                  const position = key(entry);
                  counts[position] = (counts[position] || 0) + 1;
                }
                return Object.entries(counts)
                  .filter(([, count]) => count > 1)
                  .map(([position, count]) => ({ position, count }));
              };
              const occupied = {};
              for (const entry of rosterEnemies) {
                (occupied[key(entry)] ||= []).push('enemy');
              }
              for (const entry of rosterCivilians) {
                (occupied[key(entry)] ||= []).push('civilian');
              }
              const setPieces = {
                bastion: rosterEnemies.filter(entry => entry.bastion).length,
                hvt: rosterEnemies.filter(entry => entry.hvt).length,
                perchedEnemies: rosterEnemies.filter(entry => entry.perches).length,
                taggedEnemies: rosterEnemies.filter(entry => entry.tag).length,
                hostages: rosterCivilians.filter(entry => entry.hostage).length,
                windowCivilians: rosterCivilians.filter(entry => entry.window).length,
              };
              const expectedSetPieces = {
                bastion: level.enemies.filter(definition => definition.bastion).length,
                hvt: level.enemies.filter(definition => definition.hvt).length,
                perchedEnemies: level.enemies
                  .filter(definition => definition.perches).length,
                taggedEnemies: level.enemies.filter(definition => definition.tag).length,
                hostages: level.civilians
                  .filter(definition => definition.hostage).length,
                windowCivilians: level.civilians
                  .filter(definition => definition.window).length,
              };
              return {
                level: level.id,
                enemies: rosterEnemies.length,
                civilians: rosterCivilians.length,
                setPieces,
                expectedSetPieces,
                enemyDuplicates: duplicates(rosterEnemies),
                civilianDuplicates: duplicates(rosterCivilians),
                mixedDuplicates: Object.entries(occupied)
                  .filter(([, roles]) => new Set(roles).size > 1)
                  .map(([position, roles]) => ({ position, roles })),
                unsafeEnemies: rosterEnemies
                  .filter(entry => entry.droneTarget
                    ? !allowedDrone.has(key(entry))
                    : !allowedEnemy.has(key(entry)))
                  .map(key),
                unsafeCivilians: rosterCivilians
                  .filter(entry => !allowedCivilian.has(key(entry)))
                  .map(key),
                offNavEnemies: rosterEnemies
                  .filter(entry => !entry.perches && navDistance(entry) > 2.8)
                  .map(entry => ({ position: key(entry), distance: navDistance(entry) })),
                offNavCivilians: rosterCivilians
                  .filter(entry => !entry.window && navDistance(entry) > 2.8)
                  .map(entry => ({ position: key(entry), distance: navDistance(entry) })),
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
