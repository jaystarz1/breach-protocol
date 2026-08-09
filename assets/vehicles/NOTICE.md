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

The Level 10 logistics rows use “Military Truck – 2D/3D Collab” by Alex Safayan under
CC BY. The source model contributes its authored multi-part cab, cargo body, suspension,
engine hardware, lights and wheels; instances are merged into the game’s shared desktop
vehicle material pipeline without altering the source geometry.

- Source: https://www.get3dmodels.com/vehicles/military-truck-2d3d-collab/
- Author: Alex Safayan
- License identified by the distributor: CC BY

## Military vehicle pool (`military/`)

The drone-mission armor, EW and logistics targets use the following Sketchfab models, all
CC Attribution (CC BY 4.0), fetched as browser-ready GLBs through the public Objaverse 1.0
mirror (https://objaverse.allenai.org/docs/objaverse-1.0/). Each was mechanically optimized
for browser delivery with glTF Transform (mesh simplification, 1K WebP texture compression);
geometry authorship, UVs and materials are otherwise unchanged.

- `t72-forthood.glb` — “T-72 Raw Scan from Fort Hood Museum” by pervonharke
  (https://sketchfab.com/pervonharke):
  https://sketchfab.com/3d-models/t-72-raw-scan-from-fort-hood-museum-81ae81f0dbf24a89804eebd007074ac0
- `t90.glb` — “T-90” by alexxx_xarchenko (https://sketchfab.com/alexxx_xarchenko):
  https://sketchfab.com/3d-models/t-90-9bb8af8876a6478aa92089eff058d4db
- `t64.glb` — “T64 (LOW POLY)” by LM3D (https://sketchfab.com/lm9241221):
  https://sketchfab.com/3d-models/t64-low-poly-28296493f1a34b89a2dc3abe45bde841
- `bmp2-scan.glb` — “BMP-2 photogrammetry 3D scan” by pervonharke
  (https://sketchfab.com/pervonharke):
  https://sketchfab.com/3d-models/bmp-2-photogrammetry-3d-scan-fe516c430c3849fd995c9c8b89d587d1
- `mtlb.glb` — “MTLB” by Tim Samedov (https://sketchfab.com/citizensnip):
  https://sketchfab.com/3d-models/mtlb-369d8a7eb1ed4daeaa52843ba7563beb
- `btr70.glb` — “BTR-70” by Sean Boland (https://sketchfab.com/smuboland):
  https://sketchfab.com/3d-models/btr-70-1e63355f527748309cafcc85db85c3bf
- `fuel-truck.glb` — “Fuel Truck” by k0fe (https://sketchfab.com/k0fe):
  https://sketchfab.com/3d-models/fuel-truck-2b68ae0db6954266b634f3608b4d3a49
- `tanker-rigged.glb` — “Tanker Truck Low Poly - Rigged” by AFCM
  (https://sketchfab.com/afcm.contact):
  https://sketchfab.com/3d-models/tanker-truck-low-poly-rigged-f5cb2f157a1f40beb4e9a8c2cb20b62b
- `uaz469.glb` — “UAZ-469 Low Poly” by ToporEnterprise
  (https://sketchfab.com/lebedeventerprise):
  https://sketchfab.com/3d-models/uaz-469-low-poly-77bdfa6804334b2794e65654e9dd8f3a
- `gaz-tigr.glb` — “GAZ TIGR (LOW POLY)” by LM3D (https://sketchfab.com/lm9241221):
  https://sketchfab.com/3d-models/gaz-tigr-low-poly-b5820299afc6429385d1662137db4f43
- `ural4320-cargo.glb` — “Ural 4320 Cargo truck” by kuwalol93
  (https://sketchfab.com/kuwalol93):
  https://sketchfab.com/3d-models/ural-4320-cargo-truck-7b8e849ea0c945e09a2d34faef643a61
- `ural4320-military.glb` — “Ural-4320-31 Military truck” by kuwalol93
  (https://sketchfab.com/kuwalol93):
  https://sketchfab.com/3d-models/ural-4320-31-military-truck-870869cec0a94d7788d4db3861184b1d
- `gaz66.glb` — “GAZ-66 Offroad Truck” by Yo.Ri (https://sketchfab.com/grox777):
  https://sketchfab.com/3d-models/gaz-66-offroad-truck-1cc3374ed6874124991c8058ec79c3d3
- `kamaz5330.glb` — “Kamaz 5330” by Brout (https://sketchfab.com/davidbroutian):
  https://sketchfab.com/3d-models/kamaz-5330-e86a62f4b8c84e03b2c6e32c51474bc7
- `ural-atz-fuel.glb` — “Ural ATZ-5-4320 Fuel truck” by Basic Hsu
  (https://sketchfab.com/Hsu.Pei.Ge):
  https://sketchfab.com/3d-models/ural-atz-5-4320-fuel-truck-7bc58316824740ab94e9784f17f9f777
