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
