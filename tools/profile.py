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

        result = page.evaluate(
            """({ frames, warmup }) => new Promise(resolve => {
              const rows = [];
              let i = 0;
              let last = performance.now();
              const tick = () => {
                const now = performance.now();
                const dt = now - last;
                last = now;
                BP.input.lookDelta.x += 0.004;
                BP.input.move.y = i % 240 < 150 ? -0.65 : 0;
                BP.input.move.x = i % 360 < 180 ? 0.18 : -0.18;
                const firing = i % 120 >= 35 && i % 120 < 55;
                BP.input.fire = firing;
                if (firing && i % 120 === 35) BP.input.firePressed = true;
                const perf = BP.performance;
                if (i >= warmup) rows.push({
                  frame: i,
                  dt,
                  programs: perf.resources.programs,
                  calls: perf.render.calls,
                  triangles: perf.render.triangles,
                  geometries: perf.resources.geometries,
                  textures: perf.resources.textures,
                });
                if (++i >= frames + warmup) {
                  BP.input.move.x = BP.input.move.y = 0;
                  BP.input.fire = false;
                  return resolve({
                    rows,
                    snapshot: BP.performance,
                    prewarm: BP.world.prewarm || null,
                  });
                }
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            })""",
            {"frames": args.frames, "warmup": args.warmup},
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
                }
            )

        output = {
            "level": args.level,
            "frames": len(rows),
            "internal": {
                "drawingBuffer": result["snapshot"]["drawingBuffer"],
                "megapixels": result["snapshot"]["megapixels"],
                "pixelRatio": result["snapshot"]["pixelRatio"],
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
            "errors": errors[:8],
        }
        print(json.dumps(output, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
