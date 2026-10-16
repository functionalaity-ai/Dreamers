# Decisions

Choices made while building the pack, especially where it departs from the build spec
(`prompts/kestrel-shaders-build-prompt.md`), and why.

## Scope

- **Volumetric clouds (HIGH) and parallax occlusion mapping are left out of 1.0.** Both were
  optional milestones (M12/M13). Neither helps the target hardware: volumetric clouds were
  HIGH-only and off on Macs by default, and POM was HIGH-only. They would add risk to code
  nobody can test in-game yet. Two-layer 2D clouds with self-shadowing, cloud shadows and
  atmosphere-consistent lighting cover the look on every profile. `deferred1` and
  `colortex8` stay free for a future volumetric-cloud pass. Every option, lang key and pass
  for them is removed, as the spec requires.
- **Compose pass stays at `deferred2`** to match the spec's numbering; `deferred1` is unused
  (Iris skips missing passes).

## Rendering

- **`separateAo` isn't used.** Iris documents it as broken when the shadow pass is off, and
  the Nether/End and POTATO run without one. Using it would leave the vertex colour holding AO
  in alpha unpredictably, which also changes translucent-terrain alpha. Vanilla AO stays baked
  into the vertex colour, its strength is lowered through `ambientOcclusionLevel` when SSAO is
  on, and SSAO is applied only to the ambient share of each pixel.
- **Water is forward-shaded in all profiles** (spec 5.1). It refracts and reflects an
  *unfogged* copy of the opaque scene (colortex4 is written before fog), so fog isn't applied
  twice through water.
- **Opaque reflections take hit colours from last frame's resolved image** (colortex5,
  reprojected). That is the only colour available before translucents without an extra
  buffer.
- **Sky light gets a 25% ground-bounce term for up-facing surfaces**, and side/down surfaces
  get ground bounce from the constants row. The harness showed shadows were far too dark
  with sky irradiance alone (~5% of the sun instead of the real 15–20%).
- **Mie haze is about 3× Hillaire's clean-air value**, and its absorption uses the
  reference's *extinction minus scattering* (the spec's "absorption 4.40e-6" was the
  extinction). This gives a realistic, slightly hazy clear-day sky.
- **Exposure has a scene key** (up to +2.4 EV for dim scenes). Pure auto exposure lifted
  night, caves and the Nether to daylight brightness in the harness renders.
- **Default grade: Saturation 1.10, Contrast 1.10.** AgX's base look is soft; a side-by-side
  in the harness picked this as the most natural-vivid. ACES and Khronos Neutral remain
  options.
- **Foliage**: cross-model plants shade with an upward normal (like a grass field); back-lit
  leaves test whether light reaches the far side of the block, with a small floor for light
  scattered through several layers.
- **The sun disc has a 0.5° radius** (about the real sun's size; the spec suggested 0.27°)
  and is clamped to 20000 units, so it reads clearly with bloom.
- **Lightning is very bright** (2000× its vertex colour) so it reads as a blinding flash at
  any exposure.
- **Block light** uses a mix of `lm³` and inverse-square falloff, to get realistic pools of
  light that still reach a few blocks.

## Pack format

- **The shadow fragment shader uses an empty `/* DRAWBUFFERS: */`** when coloured shadows are
  off. That gives Iris a depth-only shadow framebuffer. Without any directive, Iris would
  allocate shadowcolor0 and 1, and an empty `RENDERTARGETS` would throw.
- **`sun = false`, `clouds = off`, `vignette = false`, `underwaterOverlay = false`,
  `oldLighting = false`, `oldHandLight = false`, `particles.ordering = after`** are set
  explicitly so vanilla effects never double up with Kestrel's.
- **No `textures/noise.png.mcmeta`**: Iris binds `noisetex` with its own linear + repeat
  sampler, so the file would do nothing.
- **Internal macros always carry a value** (`#define KS_X 1`). Iris's option scanner would
  turn any value-less `#define` it sees referenced by `#ifdef` into a user option.
- **Stub macros** (`DIM_*`, `STAGE_*`, `PROGRAM_*`) carry a value for the same reason.
- **`gbuffers_particles_translucent` and `gbuffers_line` aren't shipped** (spec F25: Iris
  widens lines itself only through `gbuffers_basic`).
- **TAA jitter uses the FSR2 phase rule** (8/s², clamped 8–32). `frameCounter` wraps at
  720720, which 32 doesn't divide, so the 32-phase sequence skips once every few hours.
  That's harmless.

## Tooling

- **`tools/render_test.py`** (not in the release zip) renders the real programs on Mesa
  through a compatibility→core rewrite like Iris's. Most of the tuning above came from it.
- **The static checker** counts samplers from preprocessed sources (`glslangValidator -E`)
  and skips passes a profile disables with `program.*.enabled`.
