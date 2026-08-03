#!/usr/bin/env python3
"""Generate src/levels/terrain-deep-fence.js from real Ukraine elevation data.

Downloads AWS Terrain Tiles (Mapzen terrarium encoding, public domain hosting of
SRTM/Copernicus DEM) for a patch of right-bank Kherson oblast steppe cut by balkas
(the steep dry gullies the drone doctrine cares about), then:

1. Mosaics and samples the DEM onto the level-11 grid (world units, 3.5 m/unit).
2. Searches the fetched area for the highest-relief window that fits the op area.
3. Normalizes heights to the OP launch point (datum 0).
4. Stamps gameplay flats: the OP, the village, the kolkhoz, and graded corridors
   for the roads and the rail line, blended smoothly into the surrounding relief.
5. Applies an edge falloff so the grid meets the flat backdrop plate at 0.
6. Writes the grid as a compact JS module.

Rerunning regenerates deterministically for the same anchor coordinates.
"""
import io
import json
import math
import os
import urllib.request

import numpy as np
from PIL import Image

# ---------------- config ----------------
METERS_PER_UNIT = 3.5
CELL = 10                       # world units per grid cell (35 m, ~SRTM native)
# Grid covers the plain plus margin so the horizon scenery meets height 0.
X0, X1 = -820, 820
Z0, Z1 = 880, -1880             # south, north (north is -z)
EDGE_FALLOFF = 260              # units over which relief fades to 0 at grid edge
RELIEF_SCALE = 1.0              # 1.0 = true vertical scale
RELIEF_CLAMP = 26               # units (~90 m) soft ceiling on relief

# Anchor: right-bank Kherson steppe SE of Beryslav, balka country.
ANCHOR_LAT, ANCHOR_LON = 46.78, 33.34
ZOOM = 13
SEARCH_SPAN_M = 12000           # search window half-span around the anchor

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "levels", "terrain-deep-fence.js")
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
CACHE = os.path.join(os.path.dirname(__file__), ".terrain-tiles")

# Level-11 features to stamp (world units).
OP = (0, 462)
FLAT_RECTS = [
    # x1, z1, x2, z2, blend margin
    (-24, 440, 24, 480, 40),        # the OP and launch field
    (-70, -486, 42, -566, 46),      # village at the crossroads
    (86, -980, 180, -1080, 46),     # kolkhoz yard
]
ROADS = [
    # polyline, corridor half-width, blend margin
    ([(-6, 500), (-6, -1460)], 9, 30),
    ([(-180, -700), (140, -700)], 9, 30),
    ([(150, -700), (150, -1360)], 9, 30),
]
RAIL = ([(330, -235), (330, -1420)], 8, 36)


def tile_for(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    lr = math.radians(lat)
    y = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n
    return x, y


def fetch_tile(z, tx, ty):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{z}-{tx}-{ty}.png")
    if not os.path.exists(path):
        with urllib.request.urlopen(TILE_URL.format(z=z, x=tx, y=ty), timeout=30) as r:
            data = r.read()
        with open(path, "wb") as f:
            f.write(data)
    img = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    # terrarium: elevation = (R*256 + G + B/256) - 32768
    return img[:, :, 0] * 256 + img[:, :, 1] + img[:, :, 2] / 256 - 32768


class Dem:
    """Mosaic of terrarium tiles addressed in fractional tile coordinates."""

    def __init__(self, z):
        self.z = z
        self.tiles = {}

    def elevation(self, lat, lon):
        fx, fy = tile_for(lat, lon, self.z)
        tx, ty = int(fx), int(fy)
        px, py = (fx - tx) * 256, (fy - ty) * 256
        ix, iy = int(px), int(py)
        # bilinear across tile edges
        total, weight = 0.0, 0.0
        for (ox, oy, w) in [
            (0, 0, (1 - (px - ix)) * (1 - (py - iy))),
            (1, 0, (px - ix) * (1 - (py - iy))),
            (0, 1, (1 - (px - ix)) * (py - iy)),
            (1, 1, (px - ix) * (py - iy)),
        ]:
            sx, sy, stx, sty = ix + ox, iy + oy, tx, ty
            if sx > 255:
                sx -= 256
                stx += 1
            if sy > 255:
                sy -= 256
                sty += 1
            key = (stx, sty)
            if key not in self.tiles:
                self.tiles[key] = fetch_tile(self.z, stx, sty)
            total += self.tiles[key][sy, sx] * w
            weight += w
        return total / weight


def smoothstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def main():
    dem = Dem(ZOOM)
    m_lat = 111320.0
    m_lon = 111320.0 * math.cos(math.radians(ANCHOR_LAT))

    # ---- find the best-relief window ----
    # Coarse scan: sample candidate op-area windows on a grid around the anchor and pick
    # the one with the strongest relief (std of elevation), i.e. the balka-cut patch.
    best = None
    step = 2000
    half_w = (X1 - X0) / 2 * METERS_PER_UNIT
    half_h = (Z0 - Z1) / 2 * METERS_PER_UNIT
    for dn in range(-SEARCH_SPAN_M, SEARCH_SPAN_M + 1, step):
        for de in range(-SEARCH_SPAN_M, SEARCH_SPAN_M + 1, step):
            clat = ANCHOR_LAT + dn / m_lat
            clon = ANCHOR_LON + de / m_lon
            samples = []
            for sy in np.linspace(-half_h, half_h, 12):
                for sx in np.linspace(-half_w, half_w, 8):
                    samples.append(dem.elevation(clat + sy / m_lat, clon + sx / m_lon))
            relief = float(np.std(samples))
            if best is None or relief > best[0]:
                best = (relief, clat, clon)
    relief, clat, clon = best
    print(f"window: {clat:.4f}N {clon:.4f}E  relief std {relief:.1f} m")

    # ---- sample the full grid ----
    nx = int(round((X1 - X0) / CELL)) + 1
    nz = int(round((Z0 - Z1) / CELL)) + 1
    grid = np.zeros((nz, nx))
    # world (x east, z south-positive): north = -z. Grid row 0 = z = Z0 (south edge).
    # Window centre maps to world centre of the plain, (0, -500).
    wcx, wcz = 0.0, -500.0
    for iz in range(nz):
        wz = Z0 - iz * CELL
        for ix in range(nx):
            wx = X0 + ix * CELL
            east = (wx - wcx) * METERS_PER_UNIT
            north = -(wz - wcz) * METERS_PER_UNIT
            grid[iz, ix] = dem.elevation(clat + north / m_lat, clon + east / m_lon)
    print(f"grid {nx}x{nz}  raw range {grid.min():.0f}..{grid.max():.0f} m")

    # ---- to world units, datum at the OP ----
    def sample_units(g, wx, wz):
        fx = (wx - X0) / CELL
        fz = (Z0 - wz) / CELL
        ix, iz = int(np.clip(fx, 0, nx - 2)), int(np.clip(fz, 0, nz - 2))
        tx, tz = fx - ix, fz - iz
        return (g[iz, ix] * (1 - tx) * (1 - tz) + g[iz, ix + 1] * tx * (1 - tz)
                + g[iz + 1, ix] * (1 - tx) * tz + g[iz + 1, ix + 1] * tx * tz)

    grid = (grid - sample_units(grid, *OP)) / METERS_PER_UNIT * RELIEF_SCALE
    # soft clamp
    grid = RELIEF_CLAMP * np.tanh(grid / RELIEF_CLAMP)

    # ---- gentle smoothing to kill single-cell DEM noise ----
    k = np.array([1.0, 2.0, 1.0])
    k = np.outer(k, k)
    k /= k.sum()
    padded = np.pad(grid, 1, mode="edge")
    sm = np.zeros_like(grid)
    for oz in range(3):
        for ox in range(3):
            sm += k[oz, ox] * padded[oz:oz + nz, ox:ox + nx]
    grid = sm

    # ---- stamp flats and corridors ----
    xs = X0 + np.arange(nx) * CELL
    zs = Z0 - np.arange(nz) * CELL
    WX, WZ = np.meshgrid(xs, zs)

    def blend_to(target, weight):
        nonlocal grid
        grid = grid * (1 - weight) + target * weight

    for (rx1, rz1, rx2, rz2, margin) in FLAT_RECTS:
        xa, xb = min(rx1, rx2), max(rx1, rx2)
        za, zb = min(rz1, rz2), max(rz1, rz2)
        dx = np.maximum(np.maximum(xa - WX, WX - xb), 0)
        dz = np.maximum(np.maximum(za - WZ, WZ - zb), 0)
        d = np.hypot(dx, dz)
        w = 1 - smoothstep(d / margin)
        inside = w > 0.999
        target = grid[inside].mean() if inside.any() else 0.0
        blend_to(target, w)

    def corridor(polyline, half, margin, grade_along=True):
        # distance of every cell to the polyline + parameter along it
        d_min = np.full_like(grid, 1e9)
        t_at = np.zeros_like(grid)
        t_acc = 0.0
        seg_heights = []
        for (ax, az), (bx, bz) in zip(polyline, polyline[1:]):
            vx, vz = bx - ax, bz - az
            L = math.hypot(vx, vz)
            t = np.clip(((WX - ax) * vx + (WZ - az) * vz) / (L * L), 0, 1)
            px, pz = ax + t * vx, az + t * vz
            d = np.hypot(WX - px, WZ - pz)
            closer = d < d_min
            d_min = np.where(closer, d, d_min)
            t_at = np.where(closer, t_acc + t * L, t_at)
            # sample terrain along the segment for the graded profile
            for st in np.linspace(0, 1, max(2, int(L / 60))):
                seg_heights.append((t_acc + st * L,
                                    sample_units(grid, ax + st * vx, az + st * vz)))
            t_acc += L
        # graded profile: heavily smoothed height-along-line (a road follows the land
        # but does not ripple; a railway barely grades at all)
        seg_heights.sort()
        ts = np.array([s[0] for s in seg_heights])
        hs = np.array([s[1] for s in seg_heights])
        win = 7 if grade_along else 21
        kernel = np.ones(win) / win
        hs_smooth = np.convolve(np.pad(hs, win // 2, mode="edge"), kernel, mode="valid")
        target = np.interp(t_at, ts, hs_smooth)
        w = 1 - smoothstep((d_min - half) / margin)
        blend_to(target, np.clip(w, 0, 1))

    for (line, half, margin) in ROADS:
        corridor(line, half, margin, grade_along=True)
    corridor(RAIL[0], RAIL[1], RAIL[2], grade_along=False)

    # ---- edge falloff to the backdrop plate ----
    de = np.minimum.reduce([WX - X0, X1 - WX, Z0 - WZ, WZ - Z1])
    grid *= smoothstep(de / EDGE_FALLOFF)

    print(f"final range {grid.min():.1f}..{grid.max():.1f} units "
          f"({grid.min()*METERS_PER_UNIT:.0f}..{grid.max()*METERS_PER_UNIT:.0f} m)")

    # ---- write the module ----
    q = np.round(grid * 10).astype(int)   # decimeter-of-unit precision
    rows = [",".join(str(v) for v in row) for row in q]
    body = ";".join(rows)
    js = f"""// GENERATED by tools/fetch-terrain.py — do not hand-edit.
// Real DEM: right-bank Kherson oblast steppe near {clat:.4f}N {clon:.4f}E (AWS Terrain
// Tiles / SRTM-Copernicus), 1:{1/RELIEF_SCALE:.0f} vertical, datum at the level-11 OP.
// Grid is row-major from the SOUTH edge (z={Z0}) northward, {CELL} world units per cell.
// Values are heights in tenths of a world unit ({METERS_PER_UNIT} m each).
export const DEEP_FENCE_TERRAIN = {{
  x0: {X0}, z0: {Z0}, cell: {CELL}, nx: {nx}, nz: {nz},
  data: '{body}',
}};
"""
    with open(OUT, "w") as f:
        f.write(js)
    print(f"wrote {os.path.abspath(OUT)}  ({len(js) // 1024} KB)")


if __name__ == "__main__":
    main()
