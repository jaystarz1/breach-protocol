# Character asset notice

The glTF loader and skeleton-cloning utilities under `lib/` are vendored from Three.js r160,
distributed under the MIT License. Copyright © 2010-2023 Three.js authors.

`SWAT.glb` is the animated SWAT model by Quaternius, downloaded from Poly Pizza:

https://poly.pizza/m/Btfn3G5Xv4

The model is dedicated to the public domain under CC0 1.0. It supplies the desktop combatant
mesh and weapon-specific locomotion clips.

`CivilianCasual.glb`, `CivilianLongSleeve.glb`, and `CivilianWoman.glb` are models by
Quaternius, distributed as public-domain CC0 assets through Poly Pizza:

- https://poly.pizza/m/kZ3DmIoGip
- https://poly.pizza/m/DLptRuewTn
- https://poly.pizza/m/qJ2gsTUBHL

The models include their own human rigs, faces, separated garments, and locomotion clips.

`materials/fabric074-normal.webp` and `materials/fabric074-roughness.webp` are resized,
game-encoded derivatives of ambientCG's “Fabric 074” photometric-stereo material:

https://ambientcg.com/view?id=Fabric074

The source material is dedicated to the public domain under CC0 1.0. Only the OpenGL normal
and roughness maps are shipped; combatant faction colour remains authored vertex data.

`materials/hostile-field-fabric.webp` is a project-authored, AI-assisted raster albedo created
for Breach Protocol. It provides a subdued, unbranded field-uniform layer for hostile cloth;
the shader masks it away from skin, armor, boots and visor surfaces.
