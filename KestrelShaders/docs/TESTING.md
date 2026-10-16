# Testing

Two kinds of testing: automated checks you can run anywhere, and an in-game test plan that
needs real hardware. Nobody has run the in-game plan yet; the results tables are empty on
purpose.

## Automated checks (developer machine)

```sh
python3 tools/gen_stubs.py        # regenerate world0 / world-1 / world1 stubs
python3 tools/gen_noise.py        # regenerate shaders/textures/noise.png (deterministic)
python3 tools/check_pack.py       # static rules (needs glslangValidator for -E)
python3 tools/validate_glsl.py    # compile + link every program for every profile, world,
                                  # vendor macro set, plus a one-option-at-a-time sweep
python3 tools/package.py          # dist/KestrelShaders-<version>.zip
```

Install glslang with `apt-get install glslang-tools` (or your platform's package).

At release, `check_pack.py` passed, and `validate_glsl.py` compiled and linked 11,466
program pairs across 90 configurations and 5 vendor macro sets with no errors or warnings.

### Render harness (optional)

`tools/render_test.py` renders a procedural test scene through the real programs on a
headless OpenGL context (Mesa llvmpipe). It follows Iris's frame order and buffer flipping,
and converts the shaders from compatibility to core profile the way Iris does on macOS. It
catches link errors, NaNs and black buffers, and gives a first look at the result.

```sh
pip install moderngl numpy pillow        # plus Mesa with EGL
python3 tools/render_test.py --profile MEDIUM --out day.png
python3 tools/render_test.py --profile LOW --sky-angle 0.235 --out sunset.png
python3 tools/render_test.py --world world-1 --out nether.png
python3 tools/render_test.py --set DEBUG_VIEW=6 --out shadows.png
python3 tools/render_test.py --pan 1.0 --frames 12 --out taa_motion.png
python3 tools/render_test.py --eye-in 1 --camera 0.3 61.5 -6.4 --eye-sky 200 --out underwater.png
python3 tools/render_test.py --eye-sky 0 --eye-altitude 12 --out cave_fog.png
```

It doesn't cover Iris's reversed-Z rewrite, the hand projection, entities, glint, text or
real block models. Those are in the in-game plan.

## In-game test plan

### Setup

- Fabric + Sodium + Iris for 26.3; Video Settings → Graphics API **OpenGL**; VSync off;
  max frame rate unlimited.
- Unzip the pack into `shaderpacks/` for live editing.
- Iris debug mode on: Ctrl+D on the shader-pack screen (Cmd+D on macOS), then restart. With
  debug on, R reloads shaders; otherwise use F3+R.
- Once per profile, open `<game dir>/patched_shaders/` and confirm:
  - the conditional `RENDERTARGETS` in gbuffers_terrain_solid and deferred2 match the
    profile (POTATO `0`; LOW `0,1,2`; MEDIUM/HIGH `0,1,2,3`; deferred2 `0,4` with Advanced
    Water)
  - every `depthtex` read has Iris's `1.0 - ...` reversed-Z wrapper
  - `#version 330 core` on macOS.

### Measurement method

- Warm up 60 s, then 3 runs × 30 s. Laptops on AC power.
- Confirm the scene is **GPU-bound**: fps must drop when you raise the resolution or render
  scale. If it doesn't, mark the result CPU-bound and don't use it for per-feature costs.
- Windows: average and 1% low with PresentMon or CapFrameX (check they capture OpenGL
  presents). Per-pass timings: Nsight Graphics on NVIDIA.
- macOS: average fps from repeated F3 readings. RenderDoc doesn't run on macOS, and
  `MTL_HUD_ENABLED=1` may or may not show a HUD for OpenGL apps (unverified). Treat 1% lows
  as informational.
- Per-feature cost = frame-time delta from toggling that feature in a GPU-bound scene.

### Benchmark scenes

- **Standard:** fixed world seed and coordinates (record them here), `/time set 1000`,
  `/weather clear`, render distance per tier (POTATO 8, LOW 10, MEDIUM/HIGH 12).
- **Worst case:** same seed, an ocean shore with dense forest and some mobs,
  `/weather thunder`. Floors: MEDIUM on M1 ≥ 45 fps, LOW on Iris Xe ≥ 45 fps (hypotheses).
- Measure each profile, and vanilla + Sodium, in both.

### What to inspect

Noon, sunset, night (with and without a torch in hand), rain, thunder (lightning bloom),
forest (waving and shadows), ocean (water, SSR, refraction), rain over the ocean (drops and
splashes visible over water), stained glass held in front of water, underwater (fog, surface
from below, caustics, light shafts), caves (no sun leaking, eye adaptation in and out),
Nether biomes, End (sky, flashes), enchanted armour and items (glint on 26.3), name tags and
sign text, block outline and fishing line, particles, breaking cracks.

### Checks

- No compile or link errors in `latest.log`. On Mac, no Apple GL `UNSUPPORTED (log once)`
  lines in the launcher console.
- No black or garbage buffers on the first frame after loading, resizing or changing an
  option.
- No NaN squares (Debug View 11).
- No glint z-fighting; glint visible on enchanted gear.
- No sun in caves; shadows stop at the shadow distance without a hard edge.
- Caves by day: no bright haze; deep water and flooded caves are dark; caustics only where
  sky light reaches.
- Under water, looking up: waves on the surface, the sky and shore inside Snell's window,
  mirror-like reflection outside it.
- F5 and multiplayer: other players flash red when hit and don't trail when they move.
- Mining a wall up close and looking at the floor: no dark halo around the held item.
- Debug View 4 on the empty hand outdoors: the arm reads as one material (blending is off).
- A labPBR pack (for example one made for BSL or Complementary): relief lit from the sun's
  side; a pack with only `_n` maps keeps metal and polished blocks shiny.
- Pistons pushing stained glass or slime stay translucent while moving.
- Block-break particles in dense fog or under water look as fogged as the blocks around
  them (draw order, KNOWN_ISSUES.md).
- Thunderstorm: lightning flashes the sky and the ground; dragon death rays are purple.
- Darkness (near a Warden) pulses the light; Blindness doesn't turn the screen white.
- Brightness slider: Moody darkens caves, Bright lifts them.
- Each profile's fps against the README table, with the fallback rule applied.

### Mac extra checks

1x 1080p; 1440p at 1x (auto scale 0.75); 4K "looks like 1080p" (auto scale 0.5). Record fps
and memory on an 8 GB machine. If the game crashes while loading shaders, Apple's linker may
have crashed instead of logging an error: bisect by turning off passes (AO, light shafts,
bloom, TAA) in the menu.

## Results (fill in)

### Average fps / 1% low

| Hardware | Resolution | Vanilla+Sodium | POTATO | LOW | MEDIUM | HIGH |
|---|---|---|---|---|---|---|
| Intel UHD 620 | 1280×720 | | | | | |
| Intel Iris Xe | 1920×1080 | | | | | |
| AMD Vega 8 | 1600×900 | | | | | |
| GTX 1050 | 1920×1080 | | | | | |
| M1 Mac mini (1x 1080p) | 1920×1080 | | | | | |
| M1 Mac mini (4K HiDPI) | 3840×2160 | | | | | |

### Per-feature cost (ms, toggle delta)

| Feature | UHD 620 | Iris Xe | GTX 1050 | M1 |
|---|---|---|---|---|
| Shadows (LOW settings) | | | | |
| Ambient occlusion | | | | |
| Light shafts | | | | |
| Advanced water | | | | |
| Opaque reflections | | | | |
| TAA | | | | |
| Bloom | | | | |
| Clouds (2 layers vs 1) | | | | |
