# Vehicle asset notices

The retained offline vehicle fallbacks include the following models by Quaternius, distributed
through Poly Pizza under CC0 1.0:

- `CarSedan.glb` — “Car”: https://poly.pizza/m/unqqkULtRU
- `CarSUV.glb` — “SUV”: https://poly.pizza/m/xsMtZhBkxL
- `BrokenCar.glb` — “Broken Car”: https://poly.pizza/m/Y67erogmR9

The intact desktop sedan uses “Kiri '10 - Low poly model” by Daniel Zhabotinsky under
CC BY 4.0:

- Source: https://sketchfab.com/3d-models/7fd6e15785fa4aa9bfd6e31eb7c97ba6
- Author: https://sketchfab.com/DanielZhabotinsky
- License: https://creativecommons.org/licenses/by/4.0/

The intact desktop SUV uses “Lowpoly Generic SUV” by mk2design under CC BY 4.0:

- Source: https://sketchfab.com/3d-models/lowpoly-generic-suv-edc994ad28ed438cb365c0e0389ac177
- Author: https://sketchfab.com/mk2design
- License: https://creativecommons.org/licenses/by/4.0/

Both browser-ready glTF archives are distributed by the public
Objaverse 1.0 mirror (https://objaverse.allenai.org/docs/objaverse-1.0/). Their authored glass,
lamps, tyres, trim, interiors and PBR detail materials remain intact. Geometry sharing and
instancing keep each material role to one draw across all cars of that type, while the paint
role receives the mission's deterministic vehicle colour per instance.

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
