# Architecture

## Frame order (Iris 26.3)

Iris runs the programs in this order every frame (from `IrisRenderingPipeline`):

1. clear (colortex0–3 every frame; colortex4–7 keep their contents)
2. `shadow`: shadow map (world0, when SHADOWS)
3. `prepare`: sky-view LUT and light constants into colortex7 (world0)
4. opaque gbuffers: terrain, block entities, entities, sky; then `depthtex2` is copied and
   the solid hand is drawn
5. `depthtex1` copy, then `deferred` (AO, half res) and `deferred2` (compose)
6. translucent gbuffers: water, glass, translucent entities and text, particles (after
   deferred), weather, translucent held items
7. `composite` (light shafts, half res), `composite1` (apply), `composite2` (AA + exposure),
   `composite3` (bloom atlas, half res)
8. `final`

Each world folder is its own program set. Root programs are never used: `world0` is also
the wildcard for modded dimensions.

| Folder | Programs |
|---|---|
| world0 (Overworld + modded) | every gbuffers program, shadow, prepare, deferred, deferred2, composite, composite1, composite2, composite3, final |
| world-1 (Nether), world1 (End) | every gbuffers program, deferred, deferred2, composite2, composite3, final |

`deferred1` is intentionally unused (reserved for volumetric clouds, see DECISIONS.md).

## Shading model

**Hybrid forward.** Opaque gbuffers compute direct light (sun/moon with shadow map, block
light, held light, emission, GGX specular) and ambient (sky irradiance from the LUT
constants), and write lit linear HDR plus a compact G-buffer. `deferred2` adds what needs
screen data:

- AO, applied only to the ambient share of each pixel (`colortex1.a`), so AO never darkens
  sunlight
- environment reflections (MEDIUM+), with SSR on smooth surfaces
- the sky
- fog

All translucents, water included, are forward-shaded and blended, so particles, rain and
held items drawn later blend correctly on top.

### Units

All linear HDR values are in **Kestrel units: 1.0 = 1000 cd/m²**.

| Reference | Kestrel units |
|---|---|
| Sun irradiance at noon (top of atmosphere 118, at ground ~100) | ~100 |
| White Lambertian surface facing the noon sun | ~30 |
| Clear noon sky irradiance (up-facing, incl. 25% bounce) | ~10 |
| Full-moon irradiance | sun / 2000 × phase |
| Wall one block from a torch | ~0.05–0.15 |
| Full emissive block (glowstone) | ~0.5–0.8 |
| Lava | ~2–3 |
| Nether ambient radiance | ~0.02 |
| Minimum ambient irradiance (caves) | 0.002 |
| Sun disc | ≤ 20000 (clamped) |

**Exposure:** `EV100 = log2(L_avg[cd/m²] · 100 / 12.5)`, multiplier
`1000 / (1.2 · 2^(EV100 − bias − 0.8))`. The 16×16 log-average is measured in the composite2
vertex shader. A **scene key** of up to +2.4 EV keeps dim scenes dim (night, caves, the
Nether). Brightening adapts at rate 2.4/s, darkening at 0.9/s, and EV100 is clamped to
[5, 16.5]. POTATO uses a fixed estimate from eye brightness and sun height.

## Buffers

| Buffer | Format | Size | Contents | Written by | Clear |
|---|---|---|---|---|---|
| colortex0 | R11F_G11F_B10F | full | linear HDR scene | gbuffers, deferred2, composite1 | yes (0) |
| colortex1 | RGBA8 | full | block light, sky light, material code (0 = no data), ambient fraction | opaque lit gbuffers (LOW+) | yes (0) |
| colortex2 | RG16 | full | octahedral view normal | opaque lit gbuffers (LOW+) | yes (0) |
| colortex3 | RGBA8 | full | F0 (sRGB), smoothness | opaque lit gbuffers (Opaque Reflections) | yes (0) |
| colortex4 | R11F_G11F_B10F | full | opaque scene before fog (water refraction/SSR) | deferred2 (Advanced Water) | no |
| colortex5 | RGBA16F | full | resolved image / TAA history; texel (0,0).a = EV100 | composite2 | no |
| colortex6 | RGBA16F | ½ × ½ | AO → light shafts → bloom atlas | deferred, composite, composite3 | no |
| colortex7 | RGBA16F | 192 × 112 | rows 0–107 sky-view LUT, row 108 light constants | prepare | no |

Light constants (row 108): 0 sun irradiance, 1 moon irradiance, 2 sky irradiance up, 3 side,
4 down (ground bounce), 5 horizon radiance, 6 flags (day, night, rain).

Opaque render targets per profile: POTATO `0`, LOW `0,1,2`, MEDIUM/HIGH `0,1,2,3`. A buffer
no program references is never allocated or cleared by Iris, so POTATO doesn't pay for
colortex1–4.

Pre-resolve buffers hold the scaled image in their bottom-left `[0, s]` rectangle (TAAU,
below).

## Render scale (TAAU)

Every gbuffers vertex shader maps clip space into `[0, s]` at native pixel density
(`clip.xy = clip.xy·s + clip.w·(s−1)`) and adds a Halton(2,3) jitter. The jitter uses
`8/s²` phases, clamped to 8–32 (the FSR2 rule). Pre-resolve fullscreen passes shrink their
quad to the same rectangle.

composite2 then rebuilds each output pixel:

- a Gaussian-weighted 3×3 reconstruction of the rendered samples around it
- a closest-depth reprojection
- a 5-tap Catmull-Rom history fetch
- YCoCg variance clipping in a Karis-weighted (tonemapped) domain

Auto mode uses `s = clamp(TargetHeight / viewHeight, 0.5, 1)`.

## Material IDs (block.properties → mc_Entity.x)

| ID | Blocks | Behaviour |
|---|---|---|
| 10 | short plants, flowers, saplings | top vertices wave, upward shading normal, SSS |
| 11 / 12 | two-block plants lower / upper | seamless waving |
| 13 | leaves | wave, SSS, translucency |
| 14 | vines, hanging plants | wave |
| 15 | crops | top vertices wave |
| 20 | water | forward water |
| 21 / 22 / 23 / 24 | glass / ice / slime and honey / nether portal | glossy translucents, portal emissive |
| 30 | lava | emissive |
| 31 / 32 / 33 | full emissive / bright-texel emissive / fire | emission |
| 40 / 41 / 42 | metals / polished / snow | F0 = albedo / glossy / SSS |

colortex1.b material codes: 0 none, 1 generic, 2 foliage, 3 metal, 4 polished, 5 emissive,
6 lava, 7 entity, 8 hand, 9 snow.

## Sampler budget

Distinct samplers per program, counted from the preprocessed source plus the samplers Iris
injects (`iris_overlay`, inline `glintTexture`). Mac vendor set, world0; the macOS limit is 16
and the pack's rule is 12. A labPBR resource pack adds 2 to the terrain, entity and hand
programs.

| Program | POTATO | LOW | MEDIUM | HIGH |
|---|---|---|---|---|
| composite | – | 4 | 4 | 6 |
| composite1 | – | 3 | 3 | 3 |
| composite2 | – | 6 | 6 | 6 |
| composite3 | 1 | 1 | 1 | 1 |
| deferred | – | 4 | 4 | 4 |
| deferred2 | 4 | 7 | 9 | 9 |
| final | 4 | 4 | 4 | 4 |
| gbuffers_terrain / _solid / _cutout / block | 3 | 4 | 4 | 6 |
| gbuffers_entities / hand / entities_translucent / hand_water | 5 | 6 | 6 | 8 |
| gbuffers_water | 3 | 6 | 6 | 8 |
| other gbuffers | ≤ 2 | ≤ 2 | ≤ 2 | ≤ 2 |
| shadow | – | 1 | 1 | 1 |

`tools/check_pack.py` recomputes this for every profile, world and vendor set and fails above
12.

## Bandwidth estimate (MEDIUM, 1920×1080)

Engineering estimates of render-target traffic (MB per frame). One 4 B/px full-screen target
is 8.3 MB, and an RGBA16F target is 16.6 MB. Measure with toggle deltas (TESTING.md).

| Item | MB/frame |
|---|---|
| Iris clears (colortex0–3, main + alt) | ~66 |
| Iris depth copies (depthtex2, depthtex1) | ~33 |
| Iris end-of-frame alt→main copies (colortex4, 5, 6) | ~58 |
| colortex5 mip generation (bloom) | ~22 |
| Shadow map 1536² + opaque copy | ~28 |
| Opaque gbuffers (4 targets + depth, before overdraw) | ~41 |
| deferred (AO, ½) + deferred2 | ~68 |
| Water and translucents (partial screen) | ~10 |
| composite + composite1 (light shafts) | ~30 |
| composite2 (TAA) | ~50 |
| composite3 + final | ~40 |
| **Total** | **~446** (≈ 27 GB/s at 60 fps, ~40% of the M1's shared 68 GB/s) |

LOW drops colortex3 and opaque SSR, uses a 1024² shadow map and auto render scale 0.75: about
300 MB. POTATO writes colortex0 only, with no shadow map, AO, light shafts or resolve: about
120 MB at 1080p, or about 55 MB at 720p.

**At 4K Retina** the full-size items (clears, copies, colortex5, bloom, final) scale by 4×
while auto render scale shrinks only the pre-TAA work. That is why the README asks for a 1x
display mode first.

## Memory (MEDIUM, 1080p)

- colortex0–5 with main + alt: (4+4+4+4+4+8 B/px) × 2 × 2.07 Mpx ≈ 116 MB
- colortex6 (½) ≈ 8 MB; colortex7 < 1 MB
- colortex5 mips ≈ 6 MB
- depth textures (3 × 4 B/px) ≈ 25 MB
- shadow maps (2 × 1536² × 4 B) ≈ 19 MB

Total ≈ 175 MB of render targets.
