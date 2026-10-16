# Settings guide

Every option in the shader menu: what it changes, what it costs, and what to pick. Cost
classes: **free** (no measurable cost), **cheap** (well under 0.5 ms on an iGPU), **moderate**
(about 0.5–1.5 ms), **heavy** (more). The pass each option affects is listed so you can match
it to the frame-time budget in [ARCHITECTURE.md](ARCHITECTURE.md).

When an option is off, its pass is disabled and its code compiled out, so it costs nothing.

## Profiles

| Profile | Use it for |
|---|---|
| POTATO | Intel UHD 620 / HD 520 class at 720p. No shadow map, no AO, no TAA. |
| LOW | Iris Xe, Vega 8, GTX 750 Ti, RX 550. Auto render scale (810 lines). |
| MEDIUM | The M1 Mac mini and GTX 1050-class GPUs. |
| HIGH | GTX 1060 / RX 580 and up. |

Changing any option afterwards turns the profile label into "Custom"; pick a profile again to
reset.

## Performance

| Option | What it does | Cost / pass | Pick |
|---|---|---|---|
| Temporal Anti-Aliasing | Smooth, stable edges from previous frames. Required for render scale and for the soft dithered effects (shadows, AO, light shafts) to look clean. | cheap, composite2 | On, except POTATO |
| FXAA | Edge smoothing used only when TAA is off. | very cheap, composite2 | POTATO users who want AA |
| Render Scale Mode | *Auto* renders about *Target Height* lines and upscales; *Fixed* uses *Render Scale*. | saves time in every pre-TAA pass | Auto |
| Render Scale | Fixed fraction of the screen resolution (needs TAA). | 0.75 ≈ 44% fewer pixels shaded | 0.75 on iGPUs |
| Target Height | Lines rendered in Auto mode. 1080 on a 4K/Retina screen halves the work in each direction. | | 810 (LOW), 1080 (MEDIUM) |
| Sharpening | Contrast-adaptive sharpening after TAA. | very cheap, final | 0.3–0.5 |

Render scale shrinks the gbuffers and the deferred/composite passes before the resolve. The
full-size buffers, Iris's own clears and copies, bloom and final still run at full
resolution, so render scale only partly offsets a Retina screen (see the README).

## Shadows

| Option | What it does | Cost / pass | Pick |
|---|---|---|---|
| Shadows | Shadow map for sun and moon. Off uses a lightmap estimate (open sky lit, roofs shadowed). | moderate–heavy, shadow pass | On from LOW up |
| Shadow Resolution | Shadow sharpness. | grows with resolution², shadow pass | 1024 LOW, 1536 MEDIUM, 2048 HIGH |
| Shadow Distance | Shadow range in blocks; shorter is sharper and faster. | shadow pass geometry | 64 / 96 / 128 |
| Shadow Softness | 1, 4 or 8 hardware PCF taps, or contact-hardening (PCSS-lite). | 8 taps ≈ 0.5–1 ms on iGPU, PCSS more | 1 (LOW), 2 (MEDIUM), 3 (HIGH) |
| Coloured Shadows | Stained glass and water tint the light passing through. Adds translucent casters and a colour buffer. | moderate | HIGH only |
| Entity Shadows | Mobs, players and block entities cast shadows. | cheap–moderate | MEDIUM+ |
| Cloud Shadows | Clouds dim the ground sunlight. | cheap, gbuffers | MEDIUM+ |
| Sun Path Angle | Tilts the sun's path (default −35°). | free | taste |

On a Mac, *Shadow Softness* 3 is clamped to 2 unless *Allow Heavy Effects on Mac* is on.
Contact-hardening also needs Iris's separate hardware samplers feature (Iris 1.6+); without
it, it falls back to the 8-tap filter.

## Lighting & materials

| Option | What it does | Cost / pass | Pick |
|---|---|---|---|
| Resource Pack PBR | Reads labPBR 1.3 normal/specular maps when the resource pack has them. Free without such a pack. | 2 texture reads per pixel with a PBR pack | labPBR |
| Torch Light Colour | Colour temperature of block light. | free | 2900 K |
| Held Light | Your held torch / glowing item lights the surroundings. | free | On |
| Rain Wetness | Rain darkens porous blocks and adds gloss. | free | On |
| Puddles | Reflective puddles with ripples on flat open ground; needs *Opaque Reflections*. | cheap | MEDIUM+ |
| Ambient Occlusion | Half-resolution contact shadows. | moderate, deferred | LOW+ |
| AO Quality | SSAO (4 samples), GTAO 2×3 or GTAO 3×4. | | 1 / 2 / 3 |
| Vanilla AO Strength | Minecraft's own corner darkening; lower it when AO is on so corners aren't darkened twice. | free | 0.75 LOW, 0.5 MEDIUM+ |
| Waving Plants / Wind Strength | Plants move in the wind; storms are windier. | free | On |

## Sky & atmosphere

| Option | What it does | Cost / pass | Pick |
|---|---|---|---|
| Sky Quality | Ray-march steps for the sky LUT (computed once per frame at 192×112). | very cheap, prepare | 8 / 12 / 16 |
| Air Haze | Amount of fine haze; higher gives paler skies and redder sunsets. | free | 1.0 |
| Fog Density | Distance haze and valley fog; 0 turns it off. | free | 1.0 |
| Cloud Layers | Cumulus, or cumulus plus cirrus. | cheap, deferred2 | 2 |
| Light Shafts | Rays of sun or moonlight through the air, at half resolution. | cheap–moderate, composite | LOW+ |
| Light Shaft Type | *Screen-space* (cheap, sun must be on screen) or *Shadow-map* (shaped by real shadows; needs Shadows). | | 0 LOW, 1 MEDIUM+ |
| Light Shaft Steps | Samples per ray. | linear in steps | 12 (screen) / 6 (shadow-map, MEDIUM) |

## Water & reflections

| Option | What it does | Cost / pass | Pick |
|---|---|---|---|
| Advanced Water | Refraction, depth colour and screen-space reflections. Off: simple transparent water with sky reflection. | cheap–moderate, water pass | LOW+ |
| Wave Detail | Number of wave layers. | cheap | 3 / 4 / 5 |
| Moving Water Surface | Water geometry rises and falls. | free | On |
| Caustics | Light patterns under water. | cheap | MEDIUM+ |
| Reflection Quality | SSR ray steps (water, and opaque reflections). | linear in steps | 10 / 16 / 24 |
| Opaque Reflections | Screen-space reflections on puddles, metals and polished blocks, sky reflections on everything; adds one G-buffer target. | moderate, deferred2 | MEDIUM+ |

## Camera & colour

| Option | What it does | Pick |
|---|---|---|
| Tonemapper | AgX (natural, default), ACES (punchy, hue-shifts bright colours), Khronos Neutral (closest to texture colours). | AgX |
| Eye Adaptation | Exposure follows the scene, with dim scenes (night, caves, the Nether) kept dim. Off uses a fixed day/night/cave estimate. | On |
| Exposure | Global brightness offset in EV. | 0 |
| White Balance | Higher is warmer, lower is cooler; 6500 is neutral. | 6500 |
| Saturation / Contrast | Grade after tonemapping. | 1.10 / 1.10 |
| Bloom / Bloom Size / Bloom Strength | Glow around bright sources (half resolution atlas). | On / 5–6 / 0.04 |
| Vignette | Darkened corners. | 0.2 |
| Film Grain | Subtle animated grain. | 0 |
| Night Vision Shift | Colours fade and turn blue in dim moonlight (Purkinje effect). | On, 0.6 |

## Advanced

| Option | What it does |
|---|---|
| Allow Heavy Effects on Mac | Removes the automatic Mac clamps (PCSS → 8 taps, SSR ≤ 16 steps, light shafts ≤ 10 steps, AO ≤ quality 2). |
| Debug View | 1 lighting only, 2 normals, 3 lightmap, 4 material IDs, 5 AO, 6 shadows, 7 light shafts, 8 sky LUT, 9 bloom atlas, 10 exposure heatmap, 11 NaN/Inf detector. |

## Interactions

- Render scale needs TAA. With TAA off the scale is 1.0.
- Opaque reflections read last frame's resolved image, so they need the resolve pass (TAA,
  FXAA or Eye Adaptation on). Without it, opaque surfaces get sky reflections only.
- Puddles need Rain Wetness and Opaque Reflections.
- Shadow-map light shafts need Shadows; otherwise they fall back to screen-space shafts.
- Coloured shadows add translucent shadow casters (shadowTranslucent) and a colour buffer.
- On Macs the heavy options are clamped unless *Allow Heavy Effects on Mac* is on.
