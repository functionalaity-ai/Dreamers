# Changelog

## [1.0.0] - 2026-10-16

First release.

- Physical sky: Hillaire-style sky-view LUT built once per frame, with sun, moon, airglow,
  overcast weather, and light constants (sun, moon and sky irradiance, fog colour) shared by
  every pass.
- Lighting: GGX specular, Lambert diffuse, sky/block/held light, emissive blocks, foliage
  translucency, wetness and puddles, labPBR 1.3.
- Shadows: distorted shadow map with hardware PCF (1/4/8 taps), PCSS-lite, coloured shadows,
  cloud shadows, sky-light leak prevention.
- Water: dispersion-correct waves, refraction, depth absorption, screen-space reflections,
  total internal reflection from below, caustics.
- Atmosphere: aerial perspective, valley fog, biome tints, Nether and End fog, underwater,
  lava and powder snow media, blindness and darkness.
- Ambient occlusion (SSAO / GTAO), light shafts (screen-space / shadow-map), two cloud layers.
- TAA with upscaling (auto or fixed render scale), FXAA, CAS sharpening.
- Eye adaptation with scene-key compensation, bloom, AgX / ACES / Khronos Neutral, white
  balance, Purkinje night shift, vignette, film grain, dithering.
- Four profiles (POTATO, LOW, MEDIUM for the M1 Mac mini, HIGH) and automatic Mac clamps.
- Tools: stub and noise generators, a glslang validator across profiles, dimensions and
  vendors, a static rule checker, a packager and a Mesa render harness.
- One-click setup for the official launcher on macOS and Windows: Fabric, Sodium and Iris
  from Modrinth (checksums verified), the pack switched on with a chosen profile, and a
  separate "Kestrel Shaders" installation.

Fixed before release, after three code reviews:

- TAA: history reprojection now applies the closest sample's motion (it smeared about a
  pixel per frame on slopes), and the upscaling weights use the correct jitter sign.
- Caves no longer fill with glowing sky-coloured fog by day; deep water, flooded caves and
  aquifers are dark; caustics need sky light; the height fog is bounded below sea level.
- Water seen from below: waves, a smooth Snell's window edge, and the surface no longer turns
  into an opaque sheet. Calm water no longer shifts the image behind it.
- Players and other translucent entities flash red when hurt and no longer ghost in TAA.
- The held item no longer casts AO halos on walls and the floor, and its G-buffer is no longer
  corrupted by blending; it gets sky reflections on every profile.
- labPBR: normal maps use the standard orientation (relief was lit from below), packs without
  `_s` maps keep Kestrel's materials, metals have no diffuse, and blocks without tangents no
  longer render black.
- Light shafts (shadow-map mode) no longer darken the scene; HIGH keeps underwater shafts.
- Linear depth uses the real projection (SSR thickness and light-shaft upsampling were off by
  up to 25%); FXAA blurs along edges; AO and shafts read exact half-resolution samples; sun
  glints no longer flicker as single-pixel fireflies.
- Clouds, water and plants no longer jump when the game's hourly timer wraps.
- Lightning flashes the sky and landscape; dragon death rays stay purple; Darkness dims all
  light; Blindness no longer turns the screen white; the Brightness slider lifts cave light.
- Translucent blocks moved by pistons stay translucent; translucent particles get their own
  program; rain no longer wets surfaces faster than set; shadowcolor0 is no longer cleared
  when unused.
