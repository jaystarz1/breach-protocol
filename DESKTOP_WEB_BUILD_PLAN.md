# Breach Protocol — Desktop-First Web Build Plan

Status: approved direction, implementation blueprint  
Baseline: Three.js r160, static ES modules, GitHub Pages, offline service worker  
First migration target: Mission 02, Street Sweep

## 1. Decision

Breach Protocol will become a desktop-first web game. The existing mobile/low path may remain
as a compatibility renderer, but it will no longer set art, lighting, geometry, or asset
budgets.

The first desktop renderer will remain on Three.js/WebGL2. This preserves the working combat,
AI, physics, level definitions, save data, and GitHub Pages deployment while allowing the
visual pipeline to be replaced incrementally.

WebGPU is not the first milestone. It would change renderer compatibility before the project
has a real asset pipeline, authored geometry, or measured post-processing bottleneck. The
renderer boundary introduced below must make a later WebGPU experiment possible without
touching gameplay code.

An engine port is out of scope. Electron or Tauri is also out of scope because packaging the
same renderer does not improve image quality.

## 2. Current constraints being removed

The current implementation is optimized around a mobile PWA:

- One merged static mesh with a universal procedural concrete material.
- Geometry entries carry color, collision, and emissive flags but no material identity.
- `quality.js` chooses the cheap path for coarse pointers or four-core devices.
- High quality still uses only a 2048px directional shadow map.
- Interior point lights are capped at 14 and do not cast shadows.
- There is no glTF, compressed texture, LOD, or asset-manifest pipeline.
- There is no render graph or post-processing stage.
- Cars, characters, facades, windows, and most props are assembled from primitives.
- The service worker lists every asset manually.

The desktop build must replace these constraints rather than merely raise their numeric caps.

## 3. Supported target

### Required

- Current Chrome, Edge, Firefox, or Safari with WebGL2.
- Keyboard and mouse.
- 1920×1080 internal output at 60 fps on an Apple M1 / Intel Iris Xe class machine.
- 2560×1440 at 60 fps on a mid-range discrete GPU.
- A stable 30 fps fallback when the selected resolution exceeds the hardware budget.

### Compatibility mode

- Existing primitive geometry and low material path.
- Touch controls can remain operational but receive no new visual-content guarantee.
- Compatibility mode is explicitly selected or used when WebGL2/capabilities fail.

### Frame and memory budgets

| Budget | Street Sweep target | Hard ceiling |
|---|---:|---:|
| GPU frame, 1080p | 13 ms average | 16.7 ms p95 |
| CPU frame | 6 ms average | 10 ms p95 |
| Draw calls | 180 | 350 |
| Visible triangles | 650k | 1.5m |
| GPU texture memory | 300 MB | 512 MB |
| Mission download, compressed | 35 MB | 60 MB |
| Initial shell download | 8 MB | 15 MB |
| Shadow-casting local lights | 2 | 4 |

Dynamic resolution may range from 0.7× to 1.0×. It must not silently reduce material quality
or geometry LOD until resolution scaling is exhausted.

## 4. Target architecture

```text
Gameplay / AI / Physics / Level objectives
                    |
             Mission definition
                    |
          Environment scene builder
           /                    \
 legacy primitive builder     desktop asset builder
           \                    /
               Three.js Scene
                    |
            Desktop render graph
                    |
  shadows → opaque PBR → transparent → SSAO → bloom → grade → UI
```

Gameplay modules must not know whether a visible car is boxes or a glTF model. Collision keeps
using existing simple boxes unless an asset explicitly supplies a replacement collider.

## 5. Repository structure

The implementation should converge on:

```text
assets/
  manifests/
    street-sweep.json
  materials/
    urban/
  models/
    vehicles/
    characters/
    street/
  environments/
    street-sweep/
lib/
  three/
  three-addons/
  basis/
  draco/
src/
  renderer/
    capabilities.js
    desktop-renderer.js
    compatibility-renderer.js
    render-settings.js
    telemetry.js
  assets/
    asset-manager.js
    material-library.js
    model-library.js
  environment/
    geometry-schema.js
    facade-kit.js
    window-kit.js
    street-sweep.js
```

Third-party Three.js addons must be pinned to r160 until the core library is deliberately
upgraded. Do not mix current addons with the bundled r160 core.

## 6. Renderer foundation

### Capability selection

Replace the binary `low/high` assumption with:

- `desktop`: full asset and post-processing pipeline.
- `compatibility`: current merged primitives and cheap materials.
- `auto`: selects desktop when WebGL2, depth textures, float render targets, and sufficient
  texture limits are present.

Desktop should be the default on fine-pointer devices. Hardware concurrency is not a GPU
benchmark and must no longer reject desktop mode by itself.

Support diagnostic query parameters:

- `?renderer=desktop`
- `?renderer=compatibility`
- `?resolution=0.75`
- `?stats=1`

### Render boundary

`main.js` currently owns `WebGLRenderer` and calls `renderer.render()` directly in two places.
Replace that with a small interface:

```js
renderPipeline.resize(width, height, pixelRatio);
renderPipeline.render(scene, camera, frameState);
renderPipeline.dispose();
```

This is the boundary that permits WebGL2 now and WebGPU later.

### Desktop render graph

Use version-matched Three.js addons:

1. Main PBR render.
2. Depth/normal input for SSAO.
3. SSAO at half resolution, bilateral blur, restrained intensity.
4. Selective bloom for emissive windows, lamps, optics, muzzle flashes, and police beacons.
5. Color grading, vignette, and output transform.
6. Optional SMAA/FXAA only when MSAA is insufficient.

Avoid full-screen cinematic effects that reduce target recognition. Bloom must never turn
window rectangles into white cards.

### Instrumentation

Record:

- CPU frame time.
- GPU frame time when timer queries are available.
- Draw calls, triangles, textures, and programs from `renderer.info`.
- Current resolution scale.
- Mission asset download and decode time.

The `?stats=1` overlay is required before visual scope expands.

## 7. Asset pipeline

### Models

Runtime format: glTF 2.0 / GLB.

- Meshopt for geometry compression.
- Draco only when an asset cannot meet size targets with Meshopt.
- Tangents exported for normal-mapped hero assets.
- Separate visual meshes from simple collision proxies.
- Origin, scale, and forward-axis rules documented in the asset manifest.
- No runtime traversal by guessed node names outside the asset manager.

### Textures

Runtime format: KTX2/Basis Universal.

- Base color and emissive use sRGB.
- Normal, roughness, metallic, AO, and masks use linear data space.
- ORM packing is the default: occlusion/red, roughness/green, metallic/blue.
- 2K for reusable environment materials.
- 4K only for a hero atlas that occupies substantial screen area.
- 1K or lower for small props.
- Mipmaps and anisotropy enabled.

JPEG textures in the existing Street Sweep proof are transitional assets, not the final
runtime format.

### Asset manager

One asset manager owns:

- URL resolution.
- Preload and progress.
- Texture and model caching.
- Clone strategy for shared models.
- Material variants.
- Loading failure fallback.
- Disposal between missions.

A mission manifest declares assets and approximate memory cost. Levels must not call
`TextureLoader` or `GLTFLoader` directly.

## 8. Material and geometry schema

Extend geometry entries from positional tuples to named records at the desktop-builder
boundary:

```js
{
  shape: 'box',
  position: [x, y, z],
  size: [w, h, d],
  material: 'urban.brick.dark',
  collision: true,
  shadow: 'cast-receive',
  tags: ['facade', 'level-02']
}
```

Legacy tuple helpers remain supported through an adapter. New desktop content must not encode
surface identity solely as a hex color.

Static meshes are batched by material and shadow behavior, not merged into one universal
material. Repeated props use `InstancedMesh`. Hero assets remain individual objects when
animation, damage, or per-object material state requires it.

## 9. Street Sweep vertical slice

Street Sweep becomes the acceptance scene for the desktop pipeline.

### Facades and windows

Delete the current concept of windows as luminous boxes stamped onto a solid wall.

Build modular facade bays:

- Wall panels constructed around actual window openings.
- 20–35 cm recessed glass.
- Frame, sill, lintel, mullions, and optional air-conditioning opening.
- Rough transparent glass with environment reflection.
- Interior card or shallow room shell behind every visible window.
- Curtains, blinds, boards, grime, and broken-glass variants.
- Warm, cool, dark, and occupied lighting variants.
- Emissive value separated from local light intensity.
- No more than 20% of windows brightly illuminated in one view.

Window modules should be instanced by variant. The player must be able to read depth at street
level rather than seeing black or white rectangles.

### Vehicles

Replace box cars with three optimized vehicle families:

- Civilian sedan.
- Civilian SUV/van.
- Police sedan.

Each requires:

- Rounded silhouette, wheel arches, cylindrical wheels, mirrors, lights, glass, and interior
  darkness.
- Separate paint, glass, rubber, trim, and emissive materials.
- LOD0, LOD1, and distant silhouette.
- One simple box collider unless gameplay requires more.
- Paint/livery variants from material parameters, not duplicated geometry.
- Police light bar with selective bloom and existing beacon timing.

The existing box cars remain as compatibility-mode fallback.

### Characters

Characters are a later Street Sweep milestone, but the desktop asset contract must support
them from the start:

- One shared humanoid skeleton.
- Hostile, civilian, hostage, police, and squad material/gear variants.
- Idle, locomotion, aim, fire, reload, hit, kneel, and death animation states.
- LODs and simplified shadow meshes.
- Existing AI state drives animation; it does not move into the model layer.

### Street surface

Keep the authored asphalt/sidewalk direction, then convert it to the real material pipeline:

- KTX2 base color, normal, and ORM.
- Macro variation mask independent of the tiling texture.
- Decal layer for patches, utility cuts, stains, oil, gum, tire wear, and lane paint.
- One authoritative crosswalk/road-marking system, not legacy and desktop layers together.
- Curbs, drains, gutters, and sidewalk joints as geometry where they affect silhouette.

### Lighting

- Moon/key light with a tighter, measured shadow frustum.
- Warm pools from selected street lamps.
- Police lights affect nearby surfaces without lighting the entire block.
- Reflection probes/environment maps appropriate to the street.
- SSAO supplies contact; fake shadow cards are removed when the post-process result is stable.
- Fog retains depth but does not wash all materials into the same blue value.

## 10. Deployment

Keep GitHub Pages during the migration.

- Production remains the compatibility-safe build until the desktop Street Sweep gate passes.
- Desktop features ship behind `renderer=desktop`, then become AUTO, then become default.
- Service-worker asset lists should be generated from manifests rather than maintained by hand.
- Use content-hashed asset URLs so model/texture updates cannot be hidden behind an old cache.
- Do not precache every mission’s desktop assets. Cache the shell and current mission; fetch
  other missions on selection.
- Existing save data remains under the current key unless a schema migration is actually
  required.

## 11. Implementation sequence

### Slice A — foundation

- Add renderer interface and desktop/compatibility capability selection.
- Add stats overlay and frame budgets.
- Add version-matched post-processing with conservative defaults.
- Preserve identical gameplay rendering through the compatibility implementation.

Exit gate: all ten missions still start, resize, pause, restart, and complete under the QA bot;
desktop mode holds 60 fps at 1080p on the target machine.

### Slice B — asset ingestion

- Add pinned GLTFLoader, KTX2Loader, Meshopt decoder, and transcoder assets.
- Add mission manifest and asset manager.
- Load one test prop with LOD and fallback.
- Generate cache entries from the manifest.

Exit gate: one compressed model and material load once, clone correctly, dispose correctly,
survive offline reload, and show download/decode telemetry.

### Slice C — Street Sweep facades

- Introduce facade bay and window kits.
- Replace both 110m solid walls with modular wall sections.
- Add recessed windows and interior variants.
- Preserve collision and all enemy/civilian sight lines.

Exit gate: no black/white window cards, no z-fighting, no shot-blocking invisible panes, and
no more than the draw-call budget.

### Slice D — Street Sweep vehicles

- Import sedan, SUV/van, and police variants.
- Connect police beacons and emissive materials.
- Preserve current collision footprints and street navigation.

Exit gate: vehicles read as vehicles in silhouette at 10m and 80m, maintain 60 fps, and do not
change mission completion.

### Slice E — characters

- Add skeleton, animation controller, and role variants.
- Map current procedural rig actions to animation states.
- Retain primitive fallback.

Exit gate: friend/foe/civilian recognition remains immediate under normal light, shadow, and
NVG.

### Slice F — default and migration

- Make desktop mode the default.
- Convert remaining Street Sweep props.
- Migrate other missions one environment family at a time.
- Remove transitional JPEGs and fake contact-shadow cards once replacements pass.

## 12. Visual acceptance

Street Sweep is not accepted because it has more texture. It is accepted when:

- Asphalt, sidewalk, brick, plaster, metal, rubber, glass, paint, and fabric remain visually
  distinct under the same light.
- Cars and people no longer derive their silhouette from rectangular boxes.
- Windows visibly contain depth and do not read as emissive rectangles.
- Large walls show macro variation without obvious texture repetition.
- Props meet the ground through geometry, shadows, and AO.
- Street lights create localized hierarchy rather than uniform visibility.
- A screenshot without the HUD cannot reasonably be mistaken for the compatibility renderer.

## 13. First implementation change set

The first code change after this plan should contain only:

1. Renderer interface and compatibility adapter.
2. Desktop capability selection and explicit URL override.
3. Stats overlay.
4. Version-pinned post-processing shell.
5. No new cars, characters, windows, or environmental art.

That isolates rendering regressions before asset and level changes begin. Street Sweep content
work starts only after this foundation is measurable and reversible.
