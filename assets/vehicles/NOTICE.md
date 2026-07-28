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
