# Window interior atlas

`frontline-interiors-atlas-v2.webp` was generated for Breach Protocol with OpenAI's built-in
image-generation tool on 2026-07-28, then resized and encoded as a 1024×1024 WebP.

Production prompt:

> Create one perfectly aligned 2-by-2 atlas containing four different photorealistic Eastern
> European apartment or small-office interiors seen by a camera immediately outside the
> building. Each tile must terminate on a solid interior back wall with absolutely no window,
> doorway, opening, exterior view, or second aperture. Include two dim warm rooms, one cool
> unlit room, and one damaged abandoned room. Use worn plaster, old wallpaper, radiators,
> shelves, and modest furniture. Keep every tile front-facing, equally sized, separated by
> black gutters, and free of people, weapons, signs, readable text, logos, and watermarks.

The game crops inside the generated gutters and assigns tiles deterministically according to
each window's authored lighting and damage state.
