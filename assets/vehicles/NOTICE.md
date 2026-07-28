# Vehicle asset notices

The desktop vehicle fleet includes the following models by Quaternius, distributed through
Poly Pizza under CC0 1.0:

- `CarSedan.glb` — “Car”: https://poly.pizza/m/unqqkULtRU
- `CarSUV.glb` — “SUV”: https://poly.pizza/m/xsMtZhBkxL
- `BrokenCar.glb` — “Broken Car”: https://poly.pizza/m/Y67erogmR9

At load time, each source model's material parts are collapsed into a vertex-coloured,
single-draw instanced geometry. The intact body colour is deterministically replaced by the
mission's authored vehicle palette; windows, lights, tyres, rims and trim retain the source
colour separation.

The desktop wreck/abandoned-vehicle slot preferentially uses Poly Haven’s “Covered Car” by
Jenelle van Heerden, distributed under CC0:

- https://polyhaven.com/a/covered_car

The checked-in 1K glTF variant retains its photographed albedo, OpenGL normal and packed
metallic/roughness maps. It is merged into one instanced draw at load time; `BrokenCar.glb`
remains the offline fallback if the photographic asset cannot be loaded.

The damaged sedan slot uses “Abandoned Generic Sedan 1 - Game Ready” by Rashad Ibrahimli,
licensed under CC BY 4.0:

- Source: https://sketchfab.com/3d-models/abandoned-generic-sedan-1-game-ready-6a2169dafc254f399387a679305bb1bf
- Author: https://sketchfab.com/rashad-ibrahimli
- License: https://creativecommons.org/licenses/by/4.0/

Its downloaded 2K PNG material set is checked in as mechanically resized 1K WebP maps for
browser delivery. Geometry, UVs and authored deterioration are unchanged. The full attribution
text is retained beside the model in `abandoned_sedan/license.txt`.
