#!/usr/bin/env python3
"""Moving-gameplay profiler for Breach Protocol.

Measures distributions and hitches, not just average FPS. Requires Playwright's Python
package and a Chromium install. The game must already be served locally.
"""
import argparse
import json
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4178/?renderer=desktop")
    parser.add_argument("--level", type=int, default=2)
    parser.add_argument("--frames", type=int, default=600)
    parser.add_argument("--warmup", type=int, default=60)
    parser.add_argument("--width", type=int, default=1512)
    parser.add_argument("--height", type=int, default=982)
    parser.add_argument("--dpr", type=float, default=2)
    parser.add_argument(
        "--no-fire",
        action="store_true",
        help="Diagnostic mode: move and look without firing the weapon.",
    )
    parser.add_argument(
        "--freeze-actors",
        action="store_true",
        help="Diagnostic mode: suspend actor updates while profiling the environment.",
    )
    parser.add_argument(
        "--stationary",
        action="store_true",
        help="Diagnostic mode: rotate in place without player translation.",
    )
    parser.add_argument(
        "--no-look",
        action="store_true",
        help="Diagnostic mode: hold the camera direction fixed.",
    )
    parser.add_argument(
        "--hide-transparent",
        action="store_true",
        help="Diagnostic mode: hide transparent renderables after level load.",
    )
    parser.add_argument(
        "--trace-visibility",
        action="store_true",
        help="Diagnostic mode: report renderables entering the frame on long stalls.",
    )
    parser.add_argument(
        "--gate",
        action="store_true",
        help="Fail if the desktop gameplay frame-time and shader-warmup budget regresses.",
    )
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-angle=metal",
                "--ignore-gpu-blocklist",
                "--mute-audio",
                "--disable-frame-rate-limit",
                "--disable-gpu-vsync",
            ],
        )
        page = browser.new_page(
            viewport={"width": args.width, "height": args.height},
            device_scale_factor=args.dpr,
        )
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_function("() => !!window.BP", timeout=90000)
        page.evaluate("(level) => BP.startLevel(level)", args.level)
        page.wait_for_function("() => BP.mode === 'playing'", timeout=90000)
        if args.freeze_actors:
            page.evaluate("""() => {
              for (const actor of [
                ...BP.world.enemies, ...BP.world.allies, ...BP.world.civilians,
              ]) actor.update = () => {};
            }""")
        if args.hide_transparent:
            page.evaluate("""() => {
              BP.world.staticMesh.parent.traverse(object => {
                const materials = Array.isArray(object.material)
                  ? object.material : [object.material];
                if (materials.some(material => material?.transparent)) {
                  object.visible = false;
                }
              });
            }""")

        result = page.evaluate(
            """({ frames, warmup, noFire, stationary, noLook, traceVisibility }) =>
            new Promise(resolve => {
              // Preallocate numeric buffers. Pushing a fresh object every frame can itself
              // trigger a long V8 collection in very fast scenes, turning the profiler into
              // the hitch it claims to measure.
              const samples = {
                frame: new Uint32Array(frames),
                dt: new Float64Array(frames),
                programs: new Uint16Array(frames),
                calls: new Uint16Array(frames),
                triangles: new Uint32Array(frames),
                geometries: new Uint16Array(frames),
                textures: new Uint16Array(frames),
                playerX: new Float32Array(frames),
                playerZ: new Float32Array(frames),
                playerYaw: new Float32Array(frames),
              };
              let sampleIndex = 0;
              const visibilityHitches = [];
              const renderables = [];
              let visibleNow = null;
              let visibleBefore = null;
              if (traceVisibility) {
                BP.world.staticMesh.parent.traverse(object => {
                  if (!(object.isMesh || object.isLine || object.isPoints)) return;
                  const id = renderables.length;
                  const materials = (Array.isArray(object.material)
                    ? object.material : [object.material])
                    .map(material => material?.name || material?.type || 'none')
                    .join(',');
                  const indexCount = object.geometry?.index?.count
                    || object.geometry?.attributes?.position?.count || 0;
                  const primitiveCount = object.isMesh
                    ? Math.floor(indexCount / 3) * (object.count || 1)
                    : indexCount;
                  renderables.push(
                    `${object.name || `${object.type}:${id}`}`
                    + `|material=${materials}|primitives=${primitiveCount}`
                    + `|parent=${object.parent?.name || object.parent?.type || 'none'}`,
                  );
                  const previous = object.onAfterRender;
                  object.onAfterRender = function (...args) {
                    visibleNow[id] = 1;
                    if (previous) previous.apply(this, args);
                  };
                });
                visibleNow = new Uint8Array(renderables.length);
                visibleBefore = new Uint8Array(renderables.length);
              }
              let i = 0;
              let last = performance.now();
              const tick = () => {
                const now = performance.now();
                const dt = now - last;
                last = now;
                if (traceVisibility) {
                  if (dt > 35) {
                    const entered = [];
                    const exited = [];
                    for (let v = 0; v < renderables.length; v++) {
                      if (visibleNow[v] && !visibleBefore[v]) entered.push(renderables[v]);
                      if (!visibleNow[v] && visibleBefore[v]) exited.push(renderables[v]);
                    }
                    visibilityHitches.push({ frame: i, dt, entered, exited });
                  }
                  visibleBefore.set(visibleNow);
                  visibleNow.fill(0);
                }
                if (!noLook) BP.input.lookDelta.x += 0.004;
                BP.input.move.y = stationary ? 0 : (i % 240 < 150 ? -0.65 : 0);
                BP.input.move.x = stationary ? 0 : (i % 360 < 180 ? 0.18 : -0.18);
                const firing = !noFire && i % 120 >= 35 && i % 120 < 55;
                BP.input.fire = firing;
                if (firing && i % 120 === 35) BP.input.firePressed = true;
                const perf = BP.performance;
                if (i >= warmup) {
                  const j = sampleIndex++;
                  samples.frame[j] = i;
                  samples.dt[j] = dt;
                  samples.programs[j] = perf.resources.programs;
                  samples.calls[j] = perf.render.calls;
                  samples.triangles[j] = perf.render.triangles;
                  samples.geometries[j] = perf.resources.geometries;
                  samples.textures[j] = perf.resources.textures;
                  samples.playerX[j] = BP.player.pos.x;
                  samples.playerZ[j] = BP.player.pos.z;
                  samples.playerYaw[j] = BP.player.yaw;
                }
                if (++i >= frames + warmup) {
                  BP.input.move.x = BP.input.move.y = 0;
                  BP.input.fire = false;
                  // Object construction happens after the final timed frame, so serialization
                  // overhead cannot contaminate the measured distribution.
                  const rows = [];
                  for (let j = 0; j < sampleIndex; j++) rows.push({
                    frame: samples.frame[j],
                    dt: samples.dt[j],
                    programs: samples.programs[j],
                    calls: samples.calls[j],
                    triangles: samples.triangles[j],
                    geometries: samples.geometries[j],
                    textures: samples.textures[j],
                    playerX: samples.playerX[j],
                    playerZ: samples.playerZ[j],
                    playerYaw: samples.playerYaw[j],
                  });
                  return resolve({
                    rows,
                    snapshot: BP.performance,
                    prewarm: BP.world.prewarm || null,
                    visibilityHitches,
                  });
                }
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            })""",
            {
                "frames": args.frames,
                "warmup": args.warmup,
                "noFire": args.no_fire,
                "stationary": args.stationary,
                "noLook": args.no_look,
                "traceVisibility": args.trace_visibility,
                "hideTransparent": args.hide_transparent,
            },
        )

        rows = result["rows"]
        dts = sorted(row["dt"] for row in rows)

        def quantile(pct):
            if not dts:
                return 0
            return round(dts[min(len(dts) - 1, int(len(dts) * pct))], 2)

        p50 = quantile(0.5)
        hitch_limit = max(p50 * 2, p50 + 8)
        hitches = []
        for index, row in enumerate(rows):
            if row["dt"] <= hitch_limit:
                continue
            previous = rows[index - 1] if index else row
            hitches.append(
                {
                    "frame": row["frame"],
                    "ms": round(row["dt"], 1),
                    "programDelta": row["programs"] - previous["programs"],
                    "geometryDelta": row["geometries"] - previous["geometries"],
                    "textureDelta": row["textures"] - previous["textures"],
                    "callDelta": row["calls"] - previous["calls"],
                    "triangleDelta": row["triangles"] - previous["triangles"],
                    "player": [
                        round(row["playerX"], 2),
                        round(row["playerZ"], 2),
                        round(row["playerYaw"], 3),
                    ],
                }
            )

        output = {
            "level": args.level,
            "frames": len(rows),
            "diagnostic": {
                "noFire": args.no_fire,
                "freezeActors": args.freeze_actors,
                "stationary": args.stationary,
                "noLook": args.no_look,
                "hideTransparent": args.hide_transparent,
                "traceVisibility": args.trace_visibility,
            },
            "internal": {
                "drawingBuffer": result["snapshot"]["drawingBuffer"],
                "megapixels": result["snapshot"]["megapixels"],
                "pixelRatio": result["snapshot"]["pixelRatio"],
                "resolution": result["snapshot"]["resolution"],
            },
            "frameTimeMs": {
                "p50": p50,
                "p95": quantile(0.95),
                "p99": quantile(0.99),
                "max": quantile(1),
            },
            "fps": {
                "p50": round(1000 / p50, 1) if p50 else 0,
                "p95": round(1000 / quantile(0.95), 1) if quantile(0.95) else 0,
                "p99": round(1000 / quantile(0.99), 1) if quantile(0.99) else 0,
            },
            "hitchCount": len(hitches),
            "worstHitches": sorted(hitches, key=lambda h: h["ms"], reverse=True)[:12],
            "programs": {
                "start": rows[0]["programs"],
                "end": rows[-1]["programs"],
                "compiledDuringPlay": rows[-1]["programs"] - rows[0]["programs"],
            },
            "drawCalls": {
                "min": min(row["calls"] for row in rows),
                "max": max(row["calls"] for row in rows),
            },
            "triangles": {
                "min": min(row["triangles"] for row in rows),
                "max": max(row["triangles"] for row in rows),
            },
            "prewarm": result["prewarm"],
            "visibilityHitches": result.get("visibilityHitches", []),
            "errors": errors[:8],
        }
        print(json.dumps(output, indent=2))
        if args.gate:
            assert not errors
            assert output["prewarm"] and output["prewarm"]["ok"]
            # Three may release an unused program after prewarm, producing a negative delta.
            # That is not a live compile and cannot cause the hitch this gate is designed to
            # catch; only positive program growth is a regression.
            assert output["programs"]["compiledDuringPlay"] <= 0
            assert output["internal"]["resolution"]["enabled"]
            assert output["internal"]["resolution"]["scale"] == 1
            assert output["frameTimeMs"]["p99"] < 16.7
            assert output["frameTimeMs"]["max"] < 35
            assert output["drawCalls"]["max"] < 330
            assert output["triangles"]["max"] < 700_000
        browser.close()


if __name__ == "__main__":
    main()
