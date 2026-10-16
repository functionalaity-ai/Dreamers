Build me an original Minecraft Java shader pack called "Kestrel Shaders" (OptiFine/Iris format) that looks as realistic as possible while running well on low-end PCs (Intel UHD 620 / Iris Xe, AMD Vega 8, GTX 750 Ti / GTX 1050, RX 550) and on a 2020 M1 Mac mini (8-core GPU, macOS).

Target: Minecraft Java 26.3 (verify the current version first), Fabric + Sodium + Iris, OpenGL backend (Iris does not run on Vulkan).

HARD RULES (breaking any of these is a bug):
1. macOS caps OpenGL at 4.1 core. Every stage file starts with `#version 330 compatibility`. Use `#version 400 compatibility` only where a GLSL 4.00 built-in is truly needed. Never go above 400, never use `core`, never put `#version` in an included file.
2. No compute shaders (.csh), no SSBOs, no image load/store, no geometry or tessellation shaders, no `setup` program, no `gbuffers_line`. Leave `iris.features.required` out entirely.
3. At most 8 render targets and 12 samplers per program (count the ones Iris injects). Use only colortex0-8. No RGBA32F and no three-channel formats like RGB8/RGB16F.
4. Iris environment macros (MC_OS_MAC, MC_GL_VENDOR_*, IS_IRIS, IRIS_FEATURE_*) have no value. Test them only with #ifdef or defined().
5. Code defensively for Intel, AMD and Apple drivers: initialize every variable, give every loop a constant bound (at most 30 iterations for raymarches on AMD), guard NaN/Inf with range clamps, write a safe refract(), never use switch to pick samplers, never pass arrays to functions, no NVIDIA-isms, no double, never write gl_FragDepth.
6. Turning an option off must remove its cost: disable its pass with program.<world>/<pass>.enabled and compile its code out with #ifdef. Never branch on an option at runtime.
7. Write all code yourself. Implement published techniques (Hillaire 2020 sky, GTAO, interleaved gradient noise, AgX, Salvi TAA, AMD CAS) and credit them in CREDITS.md.

LOOK, ranked by realism per millisecond:
1. Linear HDR lighting, AgX tonemapping, auto exposure.
2. A Hillaire-style sky-view LUT (192x108, built once per frame in `prepare`) that drives sky, fog, ambient and sun colour, plus aerial perspective and height fog.
3. Sun shadows with distortion and hardware PCF (list SEPARATE_HARDWARE_SAMPLERS in iris.features.optional, sample shadowtex0HW), a skylight leak fix so caves stay dark, and lightmap fake shadows on POTATO.
4. Lambert diffuse + GGX specular, optional labPBR 1.3 with a vanilla fallback, warm block light, emissive blocks, enchantment glint via Iris's inline glint functions on 26.3.
5. Forward-shaded water: Gerstner-style waves, refraction from an opaque-scene copy, depth-based absorption, screen-space reflections with a sky fallback.
6. Half-resolution bloom, waving foliage, rain wetness and puddles.
7. TAA with temporal upscaling + CAS sharpening, half-res SSAO/GTAO, volumetric light (screen-space on LOW, 6-step shadow march on MEDIUM), 2D layered clouds (volumetric clouds only on HIGH and off on Mac by default), Purkinje night shift, underwater fog, proper Nether and End fog.
Never include: depth of field, motion blur, lens flares, SSGI, path tracing, voxel GI.

PROFILES (the code defaults equal LOW):
| Profile | Hardware | Target |
|---|---|---|
| POTATO | UHD 620 / HD 520 at 720p | 60+ fps, no shadow pass, 2 full-res passes |
| LOW | Iris Xe / Vega 8 / GTX 750 Ti / RX 550, 1080p at auto scale 0.75 | 60+ fps |
| MEDIUM | M1 Mac mini at 1080p (1x display mode), GTX 1050 | 60+ fps, at most 10 ms added by the pack |
| HIGH | GTX 1060 and up | 60+ fps |

The M1 is a tile-based GPU with about 68 GB/s of bandwidth shared with the CPU, so use few fused full-screen passes, small formats (R11F_G11F_B10F) and half- or quarter-resolution effects. A 4K monitor in Retina "looks like 1080p" mode renders 4x the pixels, so add auto render scale and tell users in the README to run a 1x display mode.

DELIVERABLES: the complete file tree (thin stubs in world0, world-1 and world1, real code in shaders/program and shaders/lib), shaders.properties with screens, sliders and all 4 profiles, lang/en_us.lang covering every option, block.properties, a README with Windows and macOS install steps (Modrinth App or Prism, native arm64 Java on Mac, Video Settings > Graphics API = OpenGL), a settings guide, a known-issues list, a Python static rule checker, and a glslangValidator script that tests every profile with Mac, Intel, AMD and NVIDIA macro sets. No placeholders or TODOs.

PROCESS: build in milestones (POTATO first, then MEDIUM, LOW, HIGH) and keep everything compiling between them. Check any version or API fact you're unsure of against the Iris docs and source. Finish with a report and an in-game test plan (F3+R to reload, logs/latest.log, the patched_shaders/ folder). Never claim fps you didn't measure.
