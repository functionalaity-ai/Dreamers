# Build Prompt: "Kestrel Shaders", a realistic, bandwidth-lean Minecraft Java shader pack for low-end PCs and the Apple M1 Mac mini

## 0. Read this first

You are a senior real-time graphics engineer and an experienced Minecraft shader-pack author, working in this repository with file and shell tools. Your job is to design, write and self-check a complete, original shader pack in the OptiFine/Iris format in a single session. The developer should not need to answer follow-up questions.

- The facts in this prompt were researched on 2026-10-16 from primary sources: the Iris source (branch `26.3`, commit `671a5c8`), the Iris docs (github.com/IrisShaders/docs), OptiFine `shaders.txt`, Apple Metal feature tables, Khronos specs, and the source of shipping packs. Facts tagged "(Iris source)" were read directly from that branch.
- Items tagged **[verify]** were medium or low confidence. Check each one against a primary source before you rely on it. Record the result in `docs/VERIFICATION.md` as checked, unchanged, or corrected, with the URL or file path. If you have no web access, keep the guidance as written and mark the item "unverified".
- Do not ask questions unless you are truly blocked. Make reasonable decisions and record them in `docs/DECISIONS.md`.
- You cannot run Minecraft. Never claim in-game results or fps you did not measure. In-game checks belong in a test plan that the developer will run.

**Assumptions the developer may edit before sending this prompt:**

| Item | Default |
|---|---|
| Pack name | **Kestrel Shaders** (macro/identifier prefix `KS_`/`ks`). A 2026-10 web search found no shader pack with this name. Re-check Modrinth and CurseForge. If the name is taken, pick another original name and use it everywhere. |
| License for your code | MIT |
| Primary target | Minecraft Java **26.3**, Fabric + **Sodium** + **Iris**, OpenGL backend |
| Languages | `en_us` only |

---

## 1. Mission

Build the most physically convincing shader pack that still meets the performance budgets in Section 3 on:

- **Low-end PCs:** integrated GPUs (Intel UHD 620 / HD 520, Intel Iris Xe, AMD Vega 8, Radeon 610M) and old discrete GPUs (GTX 750 Ti, GTX 1050/1050 Ti, RX 550/560, GT 1030).
- **The 2020 Mac mini with the Apple M1:** 8-core GPU, 8 or 16 GB unified memory, macOS, OpenGL 4.1 on Metal.

Here, "ultra realistic" means physically consistent light, not brute force:

- linear HDR lighting in one defined unit scale (Section 6.1)
- a real atmosphere model that gives the sun, sky, fog and ambient light colors that agree with each other
- soft sun shadows without light leaks
- energy-aware specular reflection
- convincing water
- filmic tonemapping (AgX) with auto exposure
- temporal stability (TAA)

Expensive brute-force effects (path tracing, voxel GI, many-sample volumetrics) are out of scope or confined to the HIGH profile. Every millisecond must buy visible realism. Bandwidth (bytes per pixel per pass, including the work Iris does on its own) is the primary budget on every target.

**Originality.** Write all code yourself. You may study techniques used by Complementary, BSL, Photon, MakeUp Ultra Fast, Sildur's and SEUS, but you must not copy their code, constants tables or file structure verbatim. Several of those packs have restrictive licenses. Implement published techniques from their papers or talks (Hillaire 2020, GTAO, Jimenez IGN, Salvi variance clipping, Karis, AMD CAS, FXAA as described, AgX/ACES fits) and credit them in `CREDITS.md`. MIT-licensed snippets (for example three.js tonemapping) may be adapted only with attribution in `CREDITS.md`.

---

## 2. Platform facts that shape the design

| # | Fact | Consequence for the pack | Confidence |
|---|---|---|---|
| F1 | Current stable Minecraft Java is **26.3** (Sep 2026). Versions are now year-based (26.1, 26.2, 26.3; 26.4 is in snapshots). Every 26.x needs **Java 25**. | Target 26.3. Do not rely on anything version-specific, so the pack also loads on 26.1.x/26.2 with the matching Iris. | medium [verify release list] |
| F2 | Iris source branch 26.3 pins Sodium **0.9.2** and Java 25 (`build.gradle.kts`); the Iris release is about **1.11.6** (mirror sites list 1.11.7). Iris for 1.21.11 is 1.10.8. | README must tell users to install the newest Iris + Sodium for their version from Modrinth. Do not hard-pin a build number. | medium [verify on Modrinth] |
| F3 | **Iris only works on Minecraft's OpenGL backend.** When Vulkan is selected, Iris shows a screen that says "Iris cannot run when using Vulkan… switch to OpenGL?". 26.2 added a "Graphics API" video setting. 26.3 defaults to OpenGL. 26.4 snapshots default to "Prefer Vulkan". | README: set Video Settings → Graphics API = OpenGL ("Prefer OpenGL" on 26.4+). The pack must never assume Vulkan or Metal. | high |
| F4 | Mojang plans to remove OpenGL eventually. Iris's successor ("Aperture") is in private beta and does **not** load OptiFine/Iris-format packs. | Keep lighting, BRDF, atmosphere and tonemap math in self-contained, API-agnostic `lib/*.glsl` so it can be ported later. Mention this in Known Issues. | medium |
| F5 | **macOS caps OpenGL at 4.1 Core / GLSL 4.10.** On M1 it runs on top of Metal and has been deprecated since 10.14, but it still ships. Iris reports `MC_GLSL_VERSION=410` there. | Hard ceiling: GLSL 4.10. Every GL 4.2+ feature is unavailable (see Section 4). | high |
| F6 | Iris rewrites compatibility-profile shaders to core and raises any `#version` below 330 to 330. It keeps 330 and higher as written, with no macOS special case, so `#version 420+` fails on a Mac. A missing `#version` is a hard error (Iris source, `TransformPatcher`). GLSL 4.00 built-ins (`fma`, `bitfield*`, `findMSB/LSB`, `packUnorm2x16/4x8`, `textureGather`) fail to compile at `#version 330` on strict compilers, and `layout(location)` on vertex outputs or fragment inputs needs 4.10 (checked with glslangValidator). Intel HD 4000 on Windows tops out at GLSL 4.00. | Every stage file starts with `#version 330 compatibility`. Use `#version 400 compatibility` only where a 4.00 built-in is really needed, and never go above 400 (Rule 5). | high |
| F7 | On macOS, Iris evaluates `COMPUTE_SHADERS`, `SSBO` and `CUSTOM_IMAGES` as **false**. Any non-empty compute program makes Iris **throw** ("This PC does not support compute shaders…"), so the pack fails to load. Voxel and compute packs (Rethinking Voxels, Shrimple, RenderPearl and others) do not work on M1. | The pack contains **zero** `.csh` files and no compute, SSBO or image path at all. | high |
| F8 | M1 limits: 8 color attachments per pass, **16 texture image units per stage**, 128 B/pixel across MRTs, 2D textures ≤ 16384, 3D textures ≤ 2048 per side, 4x MSAA max. OptiFine on macOS exposes only 8 colortex; Iris on macOS exposes all 16. Iris itself binds `gtexture`, `lightmap`, `iris_overlay` (entity and hand programs) and, on 26.3, `glintTexture` (inline-glint programs) (Iris source). | ≤ 8 render targets per program. Design for ≤ 12 samplers per program, counting the ones Iris injects (Rule 18). | high |
| F9 | Apple GPUs have no hardware geometry-shader stage, and their tessellator cannot implement GL tessellation, so both are emulated. | No `.gsh`, `.tcs` or `.tes` files. | medium |
| F10 | M1 is a tile-based deferred renderer (TBDR). Each full-screen pass stores its targets to shared LPDDR4X (68.25 GB/s, shared with the CPU) and the next pass loads them back. Iris creates a separate framebuffer object for every gbuffers program, so whether Apple's GL-on-Metal layer merges consecutive gbuffers programs into one render pass is unknown. | Use few, fused full-screen passes, small formats, and half- or quarter-resolution effects. Keep the opaque RENDERTARGETS set identical across opaque programs for correctness (Rule 25), and do not claim a TBDR benefit from it. | medium |
| F11 | Desktop GLSL ignores `mediump`/`lowp`. M1 runs FP16 and FP32 FMA at the same rate. | No "fp16 optimization" claims. The fp16 lever is render-target format (R11F_G11F_B10F, RGBA16F). | high |
| F12 | Iris's driver docs (`docs/usage/drivers.md`) list Intel Macs as "Deprecated" and Apple Silicon Macs as "❌ Not supported, drivers have known crash issues with common shaders"; Iris "will spend no time investigating" Mac issues. In practice, conventional packs such as BSL, Complementary (with voxel features off), Bliss, Solas and MakeUp run on M1. | Avoid every known Mac trigger in Section 4. List Iris's Mac stance in Known Issues. | high |
| F13 | Apple's GL driver quirks: a sampler whose type does not match the bound texture silently returns a **zero texture** (black). There are single reports of switch-based sampler selection miscompiling, possible fast-math NaN/Inf behavior, and `glLinkProgram` segfaulting on bad shaders. | Use the defensive coding rules in Section 4F. | low to medium |
| F14 | Since Minecraft 1.13 it renders on Retina/HiDPI at full backing-store resolution. A Mac mini on a 4K monitor in "looks like 1080p" HiDPI mode renders **3840x2160**, which is 4x the pixels. Iris `viewWidth`/`viewHeight` report the real framebuffer size. Depth textures are always window-sized and cannot be resized (Iris docs, depthtex). | Auto render scale (TAAU) plus README guidance on display modes. Render scale does **not** shrink the full-size buffers (Section 3.4). | medium |
| F15 | Iris has **no built-in render scaling**: `MC_RENDER_QUALITY` and `MC_SHADOW_QUALITY` are hard-coded to 1.0. It does support `scale.<program>` and `size.buffer.<colortex>`. | Implement your own render scale (vertex-shrink TAAU) and fixed-fraction effect buffers. | high |
| F16 | Iris's own per-frame work (Iris source): it keeps **two textures (main and alt)** per colortex; it **clears both** main and alt of every colortex whose clear is on; it copies depth into `depthtex2` before the solid hand and into `depthtex1` before translucents; at the end of the frame it copies alt→main for every colortex that was flipped an odd number of times and is not cleared; it regenerates a colortex mip chain before each program that declares `colortexNMipmapEnabled`; it keeps two shadow depth maps and copies one every shadow frame. A colortex that no program references is never allocated or cleared. It fully clears **every** colortex (including clear=false ones) when the pipeline is created (pack load, option change) and on window resize. | Count all of this in the bandwidth and memory tables (Section 3.3). Never reference a buffer a profile does not need. Zero history = reset signal (Rule 42). | high |
| F17 | Most low-end drivers are frozen: Intel Gen6–10 iGPUs are on legacy drivers, AMD Polaris/Vega are on a maintenance branch, and NVIDIA 580 is the last branch for Maxwell/Pascal. Iris rates Windows Intel "partial support" and AMD "supported, some issues". | Work around driver bugs in code (Section 4F). Nobody will fix them for you. | high |
| F18 | OptiFine has no confirmed build for 26.2/26.3, and its shader behavior on M1 for 26.x is unverified. | OptiFine is **not a supported target**. Use OptiFine-compatible syntax where it costs nothing, and spend no effort testing for it. | unverified |
| F19 | Distant Horizons + Iris on Apple Silicon has an open rendering bug (Iris #2521). Voxy requires GL 4.6 compute and refuses to run on macOS. | v1 ships **no** DH (`dh_*`) or Voxy support. Document this in Known Issues. | high |
| F20 | `MC_VERSION` encodes 26.3 as `260300` and 1.21.11 as `12111` (Iris source, `StandardMacros.formatVersionString`). | Use only `>=` comparisons on `MC_VERSION`. | high |
| F21 | Iris defines its environment macros with an **empty value**: `MC_OS_*`, `MC_GL_VENDOR_*`, `MC_GL_RENDERER_*`, `IS_IRIS`, `IRIS_INLINE_GLINT`, `IRIS_FEATURE_*`. Iris's preprocessor (JCPP) evaluates `#if MC_GL_VENDOR_AMD || MC_GL_VENDOR_ATI` as "Bad token in expression" → **false**, logs it and continues. Only `MC_VERSION`, `MC_GLSL_VERSION`, `MC_GL_VERSION`, `IRIS_TAG_SUPPORT` (=2 on 26.3), `MC_RENDER_STAGE_*` and the `CAT_*`/`PPT_*` constants have values (Iris source). On M1 the vendor macro is `MC_GL_VENDOR_OTHER` and the renderer macro is `MC_GL_RENDERER_APPLE`. | Test value-less macros only with `#ifdef`/`#ifndef`/`defined()` (Rule 11). The validator must inject them exactly as Iris does. | high |
| F22 | Minecraft 26.x renders with reversed Z. Iris hides this: it rewrites every `depthtex0/1/2` read (also through user functions with `sampler2D` parameters), `gl_FragCoord.z` and `gl_FragDepth` writes, and appends a `gl_Position.z` remap after `main` (it renames `main`). Packs see conventional depth (1.0 = far). Shadow maps are not reversed (Iris source, `DepthTransformer`). | Read depth only with direct texture calls on `depthtex*` or through plain `sampler2D` function parameters (Rule 12). glslang cannot reproduce this rewrite, so the test plan checks `patched_shaders/`. | high |
| F23 | `SEPARATE_HARDWARE_SAMPLERS` is active as soon as it is listed in `iris.features.required` **or** `iris.features.optional`. When active, `shadowtex0`/`shadowtex1` return **raw depth** (no compare), and `shadowtex0HW`/`shadowtex1HW` are the depth-compare samplers; the HW samplers exist only when `shadowHardwareFiltering = true`. The GLSL macro `IRIS_FEATURE_<flag>` is defined only for flags listed in `iris.features.optional`, spelled exactly as listed; `shaders.properties` sees `IRIS_FEATURE_*` for **every** flag the running Iris supports (Iris source, `IrisSamplers`, `ShaderPack`). | Use the HW samplers for every PCF tap (Rule 22). Key code paths to the optional list in both places. | high |
| F24 | Iris for 26.3 draws enchantment glint for items, held items and armor **inline** inside gbuffers_entities, gbuffers_hand, gbuffers_hand_water and gbuffers_entities_translucent. It injects `bool mc_hasGlint()` and `vec3 mc_sampleGlint()` (stubs that return false / `vec3(0)` when the draw has no glint) and `uniform sampler2D glintTexture`, and defines `IRIS_INLINE_GLINT`. Older Iris branches do not. gbuffers_armor_glint is still used for the remaining glint pipeline (Iris source, `GlintTransformer`, `IrisPipelines`). | Glint support must call these functions (Section 6.4), or enchanted gear shows no glint on 26.3. | high |
| F25 | If a pack ships `gbuffers_line`, Iris compiles it on its core-profile line path: it keeps the `#version` profile keyword unchanged (so `compatibility` reaches Apple's core-only compiler) and does **not** widen lines, so the pack must expand lines to quads itself. If `gbuffers_line` is absent, block outlines and fishing lines fall back to `gbuffers_basic`, where Iris rewrites the profile to core and widens lines itself (Iris source, `TransformPatcher`, `VanillaTransformer`). | Do **not** ship `gbuffers_line`. | medium (source-derived; Apple's handling of the kept keyword is unverified) |

---

## 3. Hardware targets and performance budgets

### 3.1 Targets per profile

All targets assume Sodium is installed, vanilla graphics are on "Fancy", VSync is off, the frame rate is uncapped, and the standard benchmark scene in Section 10.3 is used. "Overhead" means frame time with the pack minus frame time with no pack (vanilla + Sodium) in the same scene. The average fps is the pass/fail metric. Record the 1% low too, but treat it as informational: on Mac GL and on 15 W laptops it is mostly set by CPU time, chunk meshing and garbage collection, which the pack cannot control.

| Profile | Reference hardware | Resolution / render scale | Render distance | Target (avg) | Max pack overhead |
|---|---|---|---|---|---|
| **POTATO** | Intel UHD 620 (dual-channel DDR4-2400), HD 520, Radeon 610M, GT 1030 DDR4 | 1280x720, scale 1.0 | 8 | ≥ 60 fps | ≤ 6 ms |
| POTATO | same | 1920x1080 | 8 | ≥ 30 fps | n/a |
| **LOW** | Intel Iris Xe 80–96 EU (dual-channel), AMD Vega 8 | Iris Xe: 1920x1080 at auto scale 0.75. Vega 8: 1600x900 at auto scale 0.9 | 10 | ≥ 60 fps | ≤ 9 ms |
| LOW | GTX 750 Ti, RX 550, GT 1030 GDDR5 | 1920x1080 at auto scale 0.75 | 10 | ≥ 60 fps | ≤ 9 ms |
| **MEDIUM (M1 target)** | **Apple M1 8-core GPU, Mac mini 2020**, display at 1920x1080 **1x** (not HiDPI) | 1920x1080, scale 1.0 | 12 | ≥ 60 fps | ≤ 10 ms |
| MEDIUM (M1) | same Mac, 2560x1440 monitor at 1x | auto scale 0.75 | 12 | ≥ 45 fps (hypothesis) | n/a |
| MEDIUM (M1) | same Mac, 4K monitor in "looks like 1080p" HiDPI (3840x2160) | auto scale 0.5 | 12 | ≥ 35 fps (hypothesis) | n/a |
| MEDIUM | GTX 1050 / 1050 Ti, RX 560, Radeon 680M | 1920x1080 | 12 | ≥ 60 fps | ≤ 10 ms |
| **HIGH** | Apple M1 (with Mac clamps from Section 7.3) | 1920x1080 1x | 12 | ≥ 40 fps | ≤ 18 ms |
| HIGH | GTX 1060 / RX 580 class (headroom tier) | 1920x1080 | 12–16 | ≥ 60 fps | n/a |

POTATO must still *load and render correctly* on Intel HD 4000 (GL 4.0 on Windows). It has no performance target there. HD 3000 and older are unsupported.

**Fallback mapping if measurements miss.** If the developer's measurements show the M1 missing MEDIUM's 1080p target, the README recommends LOW (auto TAAU, about 0.75 at 1080p) for the Mac mini. If Iris Xe misses LOW, the README recommends POTATO at 1080p. Write both rules into TESTING.md and README so the developer only has to fill in numbers.

**Calibration (low confidence; use for sanity only).** On an M1 **Pro** (16-core GPU), MC 1.20.2, 1080p and 12 chunks, measured average fps were: MakeUp Ultra Fast 174, BSL 94, Complementary Reimagined 61, vanilla about 500. A base M1 has about half the M1 Pro's ALU (about 2.6 vs 5.2 TFLOPS) but only about one third of its bandwidth (68.25 vs 200 GB/s), and this pack treats bandwidth as the primary budget. BSL-class packs are therefore estimated at about 30–45 fps and Complementary-class at about 20–35 fps on the target Mac mini. That means BSL's defaults cost roughly 17–30 ms of overhead there, while Kestrel MEDIUM must stay ≤ 10 ms. **MEDIUM must be meaningfully leaner than BSL's defaults while looking at least as physically coherent**, which is why it uses no colored shadows, opaque SSR only on puddles, metals and polished blocks, and 6-step volumetric light. All budgets above are engineering estimates. They are the targets the developer will measure against, not facts.

### 3.2 Per-pass frame-time budget (design targets)

Each column's pass rows must sum to at most about 85% of the column total. The rest is reserved for Iris's own clears, copies and mip generation (F16) and for driver overhead. The developer checks these through toggle deltas (Section 10.3); no tier can be profiled per pass on every platform.

| Pass / effect | POTATO (UHD 620, 720p) | LOW (Iris Xe / Vega 8) | MEDIUM (M1, 1080p) |
|---|---|---|---|
| Shadow pass (geometry + raster + Iris depth copy) | 0 (disabled) | ≤ 2.5 ms (hypothesis 2–3 ms at 64 blocks) | ≤ 2.0 ms |
| Extra opaque gbuffers lighting vs vanilla | ≤ 1.5 ms | ≤ 1.0 ms | ≤ 1.3 ms |
| Sky LUT prepare pass | ≤ 0.2 ms | ≤ 0.2 ms | ≤ 0.1 ms |
| AO (half resolution) | 0 | ≤ 0.6 ms | ≤ 0.7 ms |
| deferred2 compose (AO apply, sky, 2D clouds, fog; env specular + opaque SSR on MEDIUM) | ≤ 1.2 ms | ≤ 1.0 ms | ≤ 1.0 ms |
| Volumetric light (half-res march + full-res apply) | 0 | ≤ 0.4 ms (screen-space) | ≤ 0.7 ms (shadow-map) |
| Forward water and translucents (extra vs vanilla, incl. water SSR) | ≤ 0.3 ms | ≤ 0.6 ms | ≤ 0.9 ms |
| AA resolve + exposure | 0 | ≤ 0.6 ms | ≤ 0.6 ms |
| Bloom (half resolution) | ≤ 0.5 ms | ≤ 0.4 ms | ≤ 0.4 ms |
| Final (tonemap, grade, CAS, dither) | ≤ 0.4 ms | ≤ 0.3 ms | ≤ 0.3 ms |
| **Sum of passes** | **4.1 ms** | **7.6 ms** | **8.0 ms** |
| Reserved: Iris-internal work + driver (≥ 15%) | 1.9 ms | 1.4 ms | 2.0 ms |
| **Total overhead** | **≤ 6 ms** | **≤ 9 ms** | **≤ 10 ms** |

### 3.3 Bandwidth budget (render-target traffic per frame at 1920x1080)

1080p is 2.07 Mpx. One 4 B/px target (RGBA8, R11F_G11F_B10F, RG16, DEPTH24/32) is 8.3 MB. One RGBA16F target is 16.6 MB. A full read+write copy of a 4 B/px target is 16.6 MB.

| Profile | Budget (including Iris-internal traffic) | At 60 fps | Notes |
|---|---|---|---|
| POTATO | ≤ 150 MB/frame (≈ 66 MB at its 720p target) | ≤ 9 GB/s at 1080p | Single-channel laptops have only about 19 GB/s total, shared with the CPU. |
| LOW | ≤ 320 MB/frame | ≤ 19 GB/s | Iris Xe needs dual-channel RAM to be "Iris Xe" at all. |
| MEDIUM | ≤ 450 MB/frame | ≤ 27 GB/s (about 40% of M1's shared 68 GB/s) | At 4K HiDPI the full-size buffers cost 4x as much (Section 3.4). |

In `docs/ARCHITECTURE.md`, write a table with each pass's real reads and writes in B/px and the MB/frame at 1080p, computed from your final implementation. It must include these Iris-internal rows (F16):

- clears of main **and** alt for every cleared colortex
- the `depthtex2` copy (before the solid hand) and the `depthtex1` copy (before translucents), every frame
- the end-of-frame alt→main copy of every non-cleared colortex with an odd flip count (in this plan: colortex4, colortex5, colortex6, colortex7, colortex8)
- every `colortexNMipmapEnabled` generation
- the shadow depth copy

Show that every profile fits its budget. If a profile does not fit, cut features in that profile, not the accounting. A clear of main+alt costs two full writes, about the same as an alt→main copy (one read, one write), so neither is automatically cheaper. Whether Apple's GL layer turns a standalone clear into a full store is unverified.

### 3.4 Retina / HiDPI on the Mac mini

The Mac mini has no built-in display, so behavior depends on the monitor mode:

- a 1080p monitor at 1x renders 1920x1080
- a 1440p monitor at 1x renders 2560x1440
- a 4K monitor in "looks like 1080p" renders 3840x2160
- "looks like 1440p" renders 5120x2880 and downsamples

The MEDIUM budgets assume a 1x 1080p framebuffer. Be honest about what render scale fixes. Vertex-shrink TAAU reduces only the pre-TAA work (gbuffers shading, deferred and composite passes before composite2). The colortex buffers stay at full framebuffer size, depth textures are always window-sized (F14), and Iris's clears, depth copies and history copies, TAA output, bloom mips and final all scale with the framebuffer. At 3840x2160 with auto scale 0.5, those fixed costs alone are several hundred MB per frame. The primary fix is therefore the display mode, not render scale. The pack must:

1. Provide `RENDER_SCALE_MODE = auto`. The effective scale is `clamp(AUTO_TARGET_HEIGHT / viewHeight, 0.5, 1.0)`, so a 2160-pixel framebuffer with a 1080 target renders gbuffers and pre-TAA passes at 0.5.
2. Run half-resolution effects relative to the scaled image.
3. In the README, make the 1x display mode the first recommendation, then the retiNO / ResolutionControl+ mods or Sodium Extra's macOS reduce-resolution option **[verify each supports 26.3]**. State that auto render scale only partly offsets HiDPI.
4. Note memory: Iris main+alt buffers at 4K are about 4x the 1080p figure, which matters on 8 GB M1 machines.

### 3.5 How performance must be designed and checked

- Design every effect with a compile-time quality enum and a profile value, so turning a feature off **removes its cost**: its pass is disabled with `program.<world>/<pass>.enabled`, its code and samplers are compiled out with `#ifdef`, and no other program references its buffer (an unreferenced colortex is never allocated or cleared, F16). Never use a runtime branch on an option.
- Write `docs/TESTING.md` with the measurement method and benchmark protocol (Section 10.3) and empty results tables for the developer to fill in.

---

## 4. Hard rules (non-negotiable)

Violating any rule is a defect. Your static checker (Section 8.5) must enforce every rule marked (C).

### A. Platform and loader

1. Target Iris (OptiFine/Iris pack format) + Sodium on Fabric (recommended) or NeoForge, Minecraft Java 26.3. Do not require any Iris feature newer than Iris 1.8, so 26.1.x, 26.2 and 1.21.11 also load. Features that exist only on newer Iris (inline glint, `IRIS_INLINE_GLINT`) are used only behind their macro, with a working path when it is absent.
2. OpenGL backend only (F3). Never reference Vulkan, Metal, Aperture or Slang.
3. OptiFine is unsupported (F18). Keep OptiFine-safe syntax where it is free: `worldN` folders, standard program names, `texture.noise`. Do not add OptiFine-only features.
4. No Distant Horizons programs, no `voxy.json` (F19).

### B. GLSL version, preprocessor and language

5. (C) Every top-level stage file (`.vsh`/`.fsh`) has `#version 330 compatibility` as its first line. Use `#version 400 compatibility` only in a stub whose expanded source uses a GLSL 4.00 built-in (Rule 6), with a comment saying which one. **Never declare a version above 400** (Intel HD 4000 is GLSL 4.00), **never use `core`, and never put `#version` in an included file.**
6. (C) Language-feature limits:
   - **Banned everywhere** (GLSL 4.10+/4.20+ or GL 4.2+): `layout(binding=…)`, explicit uniform `location`, `layout(location)` on anything except fragment-shader outputs (never on vertex inputs or varyings; Iris binds attributes itself), `packHalf2x16`/`unpackHalf2x16`, `packSnorm2x16`/`unpackSnorm2x16`, `layout(early_fragment_tests)`, conservative-depth layouts, `textureQueryLevels`, `imageSize`, arrays of arrays, `dFdxFine`/`dFdyFine`/`dFdxCoarse`/`dFdyCoarse`, `textureSamples`, `gl_HelperInvocation`, `std430`, `shared`, `barrier`, `memoryBarrier*`, atomics, `image*` types, `imageLoad`/`imageStore`, any `#extension` for a GL 4.2+ feature.
   - **Allowed at `#version 330`:** `texelFetch`, `textureSize`, `textureLod`, `textureOffset`, `floatBitsToUint`/`uintBitsToFloat`/`floatBitsToInt`/`intBitsToFloat`, integer shifts and masks, `layout(location = N)` on fragment outputs.
   - **GLSL 4.00-only** (compile only when the stub declares `#version 400 compatibility`): `textureGather*`, `fma`, `bitfieldExtract`/`bitfieldInsert`/`bitfieldReverse`, `bitCount`, `findMSB`/`findLSB`, `packUnorm2x16`/`packUnorm4x8`/`packSnorm4x8` and their unpack forms. In shared `lib/` code, prefer manual equivalents (`a*b + c`, `(x >> o) & mask`, uint-based 8-bit packing) so no stub needs 400.
7. (C) No `double` or `dvec*`. M1 has no fp64.
8. Do not use `mediump`/`lowp` as an optimization, and never claim they help.
9. Fragment outputs are declared as `layout(location = N) out vec4 name;`, where N is the **index within the RENDERTARGETS list**, not the colortex number. The automatic alpha test is injected **only** for `gl_FragData`/`gl_FragColor`. Every cutout-capable program must therefore do `if (albedo.a < alphaTestRef) discard;` itself, with `uniform float alphaTestRef;`.
10. Sample with `texture()`, `textureLod()` and `texelFetch()`. Do not use `texture2D` or `shadow2D`.
11. (C) **Value-less macros are tested only with `#ifdef`, `#ifndef` or `defined()`** (F21). This covers the Iris environment macros (`MC_OS_*`, `MC_GL_VENDOR_*`, `MC_GL_RENDERER_*`, `IS_IRIS`, `IRIS_INLINE_GLINT`, `IRIS_FEATURE_*`), boolean options, and the stub macros `DIM_*`, `STAGE_*` and `PROGRAM_*`. Write `#if defined(MC_GL_VENDOR_AMD) || defined(MC_GL_VENDOR_ATI)`, never `#if MC_GL_VENDOR_AMD || MC_GL_VENDOR_ATI`. Use `#if` with a value only for `MC_VERSION`, `MC_GLSL_VERSION`, `IRIS_TAG_SUPPORT`, `MC_RENDER_STAGE_*` comparisons and numeric options.
12. **Depth reads** (F22): read `depthtex0/1/2` only with direct `texture`/`textureLod`/`texelFetch`/`textureGather` calls, or inside a function whose parameter is a plain `sampler2D`. Never route a depth sampler through a `#define` alias of another name, a struct or an array. Do not try to detect or undo reversed Z. Never write `gl_FragDepth` (Rule 33).

### C. Banned pipeline features

13. (C) No `.csh`, no `setup` program, no `.gsh`, `.tcs` or `.tes` files anywhere in the pack. Do not ship `gbuffers_line` (F25).
14. (C) No `bufferObject.*`, `image.*`, `indirect.*`, `customImage`, `colorimg*` or `allowConcurrentCompute` in `shaders.properties`.
15. (C) Feature flags:
    - `iris.features.required` must not list `COMPUTE_SHADERS`, `SSBO`, `CUSTOM_IMAGES` or `HIGHER_SHADOWCOLOR`. Omit `iris.features.required` entirely.
    - Write exactly `iris.features.optional = SEPARATE_HARDWARE_SAMPLERS BLOCK_EMISSION_ATTRIBUTE` (uppercase; Iris builds the macro name from the spelling you use). Both names are verified against the Iris flags docs and source. `ENTITY_TRANSLUCENT` is query-only and not needed for `gbuffers_entities_translucent`.
    - GLSL code that depends on a flag is guarded by `#ifdef IRIS_FEATURE_<NAME>` and has a working fallback. In `shaders.properties`, `IRIS_FEATURE_*` is defined for every flag Iris supports whether listed or not (F23), so never use it there to mirror a GLSL path.
16. No voxel GI, floodfill colored lighting, path tracing, LPV or SSGI. Colored block light comes from lightmap-driven tinting and emissive bloom.

### D. Resource limits

17. (C) At most **8** RENDERTARGETS per program. Keep total MRT bytes per pixel ≤ 128 B (the plan in Section 5 uses ≤ 16 B).
18. (C) At most **12 distinct samplers per program** (count the union of its vertex and fragment stages). Count `gtexture`, `lightmap`, `normals`, `specular`, `depthtex*`, `shadowtex*`, `shadowtex*HW`, `shadowcolor*`, `noisetex`, every `colortex*`, debug-view samplers, **and the samplers Iris injects**: `iris_overlay` in entity and hand programs, `glintTexture` in inline-glint programs on 26.3 (F8, F24). The absolute ceiling on macOS is 16 per stage.
19. Use only colortex0–8. colortex8 is used only by the HIGH-only volumetric clouds. (C) Never use the legacy names `gdepth`, `gcolor`, `gnormal`, `composite` or `gaux*`. `gdepth` silently upgrades colortex1 to RGBA32F.
20. (C) Allowed render-target formats: `RGBA8`, `RGBA16`, `RGBA16F`, `RG16`, `RG16F`, `R8`, `R16F`, `R32F`, `RGB10_A2`, `R11F_G11F_B10F`. Banned as attachments: `RGBA32F` and the three-component formats `RGB8`, `RGB16`, `RGB16F`, `RGB9_E5`. GL does not require the three-component formats to be color-renderable.
21. 2D textures ≤ 16384, 3D textures ≤ 2048 per axis, `shadowMapResolution` ≤ 4096.
22. (C) Sampler types must match the bound texture; on Apple a mismatch silently returns black (F13). Shadow samplers (F23):
    - `lib/shadows.glsl` owns every shadow sampler declaration. With `const bool shadowHardwareFiltering = true;` and `SEPARATE_HARDWARE_SAMPLERS` listed, under `#ifdef IRIS_FEATURE_SEPARATE_HARDWARE_SAMPLERS`: `uniform sampler2DShadow shadowtex0HW;` / `shadowtex1HW;` for **every** hardware-PCF tap (all filters, VL, colored shadows), sampled with `vec3` coordinates; `uniform sampler2D shadowtex0;` only where raw depth is needed (the PCSS blocker search).
    - In the `#else` branch (no flag): `uniform sampler2DShadow shadowtex0;` / `shadowtex1;` and filter 3 falls back to filter 2.
    - Never declare `shadowtex0` or `shadowtex1` as `sampler2DShadow` inside the flag branch. Never declare one texture name with two sampler types in a program.
    - No integer-format targets are used, so no `usampler`/`isampler` is needed.

### E. Pack-format correctness

23. Layout: `shaders/world0`, `shaders/world-1` and `shaders/world1` contain only thin stubs. The real code lives in `shaders/program/` and `shaders/lib/`. **Put no programs in the `shaders/` root**, because when worldN folders exist, root programs are ignored. Ship no `dimension.properties` (it is Iris-only; Iris then uses world0 as the wildcard for unmapped dimensions).
24. (C) Buffer format, clear and clear-color directives go inside `/* … */` block comments, one per line, in `lib/buffer_formats.glsl`. Include that file unconditionally in **`deferred2.fsh` of every world folder**: each world folder is its own program set, and Iris collects pack-wide directives only from the fragment sources of shadowcomp, begin, prepare, gbuffers (incl. shadow), deferred and composite programs, never from `final.fsh` or vertex shaders. Put mipmap directives (`colortexNMipmapEnabled`) in the specific consuming program's fragment shader, and only in deferred, prepare or composite programs. Iris runs its preprocessor (comments kept) before reading directives, so directives inside `#ifdef` blocks follow the active options (Iris source, `ShaderPack`, `ProgramSet`).
25. (C) Every target listed in a program's `/* RENDERTARGETS: … */` is written on **every** execution path, including discard-adjacent and early-out branches. Otherwise garbage is written. RENDERTARGETS sits on its own line in a block comment. Because Iris reads it after preprocessing, per-profile sets under `#if` are allowed; confirm in M1 by checking `patched_shaders/` **[verify in-game]**. All opaque lit programs use the identical set for a given profile.
26. Never sample colortex0–3 in gbuffers programs: in gbuffers, `colortex0` is an alias of the block atlas and colortex0–3 are fullscreen-only (Iris source, `IrisSamplers`). colortex4 and above may be sampled in gbuffers. Never write a `size.buffer`-resized colortex from gbuffers. A composite-style program may write only buffers of identical size.
27. (C) No identifiers starting with `iris_`, `irisMain` or `moj_import`, and none named `mc_hasGlint`/`mc_sampleGlint` except as calls. No identifiers named `texture`, `sample` or any other GLSL reserved word.
28. Options: every option is defined **once**, in `lib/settings.glsl`, which every program includes. Boolean options are `#define NAME // tooltip` (or `//#define NAME` for off) and must be tested with `#ifdef`/`#ifndef` somewhere. Value lists use spaces only: `// [0 1 2]`. `program.*.enabled` expressions use boolean options with `!`, `&&`, `||` and parentheses (all supported by Iris's parser). Every profile sets **every** profile-controlled option.
29. `MC_VERSION` is used only with `>=`.
30. (C) Shadow samplers are referenced only under `KS_SHADOWS_ACTIVE` (defined when `SHADOWS` is on **and** `DIM_OVERWORLD`), because Iris enables the shadow pass whenever any program references `shadowtex*`, `shadowcolor*`, `shadow` or `shadowtex*HW`. This includes debug views. Also set `program.world0/shadow.enabled = SHADOWS`.
31. One shared function produces clip-space positions in **every** gbuffers vertex shader: terrain, terrain_solid, terrain_cutout, block, block_translucent, entities, entities_translucent, lightning, hand, water, hand_water, armor_glint, spidereyes, particles, textured, textured_lit, weather, beaconbeam, clouds, skybasic, skytextured, damagedblock and basic. It applies the TAAU shrink and jitter. Do **not** call `ftransform()`. Mixed transforms cause armor-glint z-fighting and disappearing glints. Vertex displacement (waving plants, leaves, water) uses the same functions in `shadow.vsh` and in the matching gbuffers vertex shader.
32. Do not use `at_velocity` (Iris has no velocity attribute), `gbuffers_entities_glowing` or `separateEntityDraws`.
33. Never write `gl_FragDepth`. It defeats early-Z and TBDR hidden-surface removal. No `discard` in `gbuffers_terrain_solid`. POM never offsets depth.
34. Ship images as PNG only (Iris does not load JPG). Override the noise texture with `texture.noise = textures/noise.png` and set `noiseTextureResolution`. Control filtering with `textures/noise.png.mcmeta` (`{"texture":{"blur":true}}`); Iris reads `<path>.mcmeta` for `texture.noise` (Iris source). `texelFetch` ignores filtering, so blue-noise channels stay exact.

### F. Defensive coding (Intel, AMD and Apple drivers)

35. Explicitly initialize every local, output and varying. One declaration per line: `float a, b, c = 0.0;` initializes only `c`, which caused the Chocapic flashing-holes bug.
36. Never pass or return arrays from functions (Intel bug). Use `vecN`/`matN`/structs. Constant-indexed local `const` arrays inside a function are fine.
37. Every loop has a compile-time-constant upper bound and exits with `break`. Clamp data-dependent counts with `min(n, KS_MAX_…)`. Under `#if defined(MC_GL_VENDOR_AMD) || defined(MC_GL_VENDOR_ATI)`, clamp every raymarch to ≤ 30 iterations (AMD driver crash). Always check **both** AMD macros.
38. Guard against NaN/Inf: `safeNormalize`, `safeSqrt(max(x,0))`, `pow(max(x,1e-6), y)`, `log2(max(x,1e-8))`, and divisions by `max(d, eps)`. Sanitize every history, exposure and cloud value with range clamps such as `clamp(x, 0.0, 60000.0)` (below the R11F_G11F_B10F maxima of about 65000/64500), as well as `isnan`/`isinf` checks. `isnan`/`isinf` may be optimized away under Apple's Metal translation if it uses fast math **[unverified]**, so the range clamp is the primary guard.
39. Never call the built-in `refract()`. Use a `refractSafe()` that returns `vec3(0)` when `k < 0` (Intel NaNs).
40. Select between samplers with `if`/`else` or separate code paths, never `switch` (reported Apple miscompile).
41. Clamp every `texelFetch` coordinate to `[0, textureSize-1]`.
42. History validation: Iris fully clears every colortex, including clear=false history, when the pipeline is created (pack load, any option change, which includes render scale) and on resize (F16). Auto render scale depends only on `viewHeight`, so it can change only at those moments. Therefore: `colortex5` texel (0,0) alpha stores the exposure as EV100, clamped to `[KS_EV_MIN, KS_EV_MAX]` with `KS_EV_MIN > 0`; if it reads 0, the history was just cleared, and composite2 resets TAA and exposure (and deferred1 resets clouds) for that frame. Also reset after a camera jump (`length(cameraPosition - previousCameraPosition) > 8.0` blocks, computed from the Int/Fract pair on Iris) and treat all-zero colortex8 texels as invalid.
43. Never initialize a `const` local from a function parameter.
44. Avoid NVIDIA-isms: no `saturate`/`lerp`/`frac`/`float3` (write your own `clamp01`), no implicit int↔float mixing (write `1.0`), no scalar swizzles of non-vectors, nothing that compiles only on lenient drivers. Code must compile under `glslangValidator` and Mesa.
45. All code, including unused helpers, must be valid GLSL. Never rely on Iris stripping unused functions.
46. Collect vendor workarounds in `lib/platform.glsl`, switched with `defined()` (Rule 11) on `MC_OS_MAC`/`MC_GL_RENDERER_APPLE`, `MC_GL_VENDOR_INTEL`/`MC_GL_RENDERER_INTEL` and `MC_GL_VENDOR_AMD`/`MC_GL_VENDOR_ATI`.
47. Use only uniforms, attributes, macros and properties keys that appear in the Iris docs, the Iris source or OptiFine `shaders.txt`/`shaders.properties`. (C) Keep them in `tools/allowlist.txt` with a doc reference, so the checker flags anything else. Declare custom uniforms from `shaders.properties` with matching GLSL types.
48. Use `cameraPositionInt`/`cameraPositionFract` (Iris 1.7+) under `#ifdef IS_IRIS` for world-space noise and animation, with a `cameraPosition` fallback. In Iris, `cameraPosition` wraps every 30000 blocks. `frameTimeCounter` wraps at 3600 s and `frameCounter` at 720719: choose animation periods that tolerate the wrap, and compute jitter from `frameCounter % n` (Section 5.7), never from a large float product.

---

## 5. Rendering architecture

### 5.1 Principles

- **Hybrid forward shading.** Opaque gbuffers do direct lighting (sun with shadow lookup, block light, emission, direct specular) and ambient diffuse. They write lit HDR plus a compact G-buffer that later passes need for AO, environment specular, SSR and TAA. On MEDIUM+, deferred2 adds environment specular (sky LUT or SSR) for all opaque pixels; on POTATO and LOW, opaque gbuffers add sky-LUT environment specular forward. **Never both** for one pixel.
- **All translucents are forward-shaded**, including water: gbuffers_water computes waves, refraction, absorption, SSR, Fresnel and fog itself, reading the opaque copy in colortex4 and `depthtex1`. Particles, rain, translucent entities and held translucent items drawn after the water then blend correctly on top. No later pass rebuilds water pixels.
- **SSAO without double darkening.** Opaque gbuffers store an "ambient fraction" (the luminance share of ambient light in the pixel). deferred2 applies AO as `color *= 1 - ambFrac * (1 - ao)`, so AO never darkens direct sunlight.
- Use as few full-resolution full-screen passes as possible:

  | Profile | Full-resolution full-screen passes | Reduced-resolution passes |
  |---|---|---|
  | POTATO | 2 (deferred2, final) | composite3 bloom (½) |
  | LOW | 4 (deferred2, composite1, composite2, final) | deferred AO, composite VL, composite3 bloom (all ½) |
  | MEDIUM | 4 (same) | same three |
  | HIGH | 4 (same) | same three + deferred1 volumetric clouds (¼) |

- Run expensive effects at half or quarter resolution with depth-aware upsampling, and denoise low sample counts with IGN + TAA.
- Compute the sky once per frame in a 192x112 LUT and reuse it everywhere: sky, fog, ambient, reflections and sun color.
- **Effective macros per dimension.** Options are pack-wide, and `program.*.enabled` sees only option values, so `lib/platform.glsl` derives effective macros that every writer and reader of a feature test:

  | Macro | Defined when |
  |---|---|
  | `KS_SHADOWS_ACTIVE` | `SHADOWS` && `DIM_OVERWORLD` |
  | `KS_SKY_LUT` | `DIM_OVERWORLD` (colortex7 users; elsewhere every sky-LUT lookup, including environment specular and SSR fallback, uses the dimension's fog and ambient color) |
  | `KS_VL_ACTIVE` | `VOLUMETRIC_LIGHT` && `DIM_OVERWORLD` |
  | `KS_VCLOUDS_ACTIVE` | `VOLUMETRIC_CLOUDS` && `DIM_OVERWORLD` && (not Mac, or `MAC_ALLOW_HEAVY`) (colortex8 users) |
  | `KS_RESOLVE_PASS` | `TAA` \|\| `FXAA` \|\| `AUTO_EXPOSURE` |
  | `KS_SSR_OPAQUE_ACTIVE` | `SSR_OPAQUE` && `KS_RESOLVE_PASS` (opaque SSR reads last frame's colortex5) |
  | `KS_WATER_ADVANCED` | `WATER_ADVANCED` && !`DIM_NETHER` (vanilla water cannot exist in the Nether) |

  Write all of them with `defined()` (Rule 11).

### 5.2 File tree (minimum; add files only with a reason)

```
KestrelShaders/
  README.md  LICENSE  CREDITS.md  CHANGELOG.md
  docs/ARCHITECTURE.md  docs/SETTINGS_GUIDE.md  docs/TESTING.md
  docs/VERIFICATION.md  docs/DECISIONS.md  docs/KNOWN_ISSUES.md
  tools/gen_stubs.py        # generates every worldN stub from a single table
  tools/gen_noise.py        # stdlib-only; writes shaders/textures/noise.png deterministically
  tools/check_pack.py       # static rule checker (Section 8.5)
  tools/validate_glsl.py    # expands includes, injects Iris-style macros, runs glslangValidator
  tools/package.py          # builds KestrelShaders-<ver>.zip with shaders/ at zip root
  tools/allowlist.txt       # allowed uniforms/attributes/macros/properties keys + doc refs
  shaders/
    shaders.properties  block.properties  lang/en_us.lang
    textures/noise.png  textures/noise.png.mcmeta
    lib/  settings.glsl buffer_formats.glsl platform.glsl common.glsl uniforms.glsl
          space.glsl noise.glsl atmosphere.glsl shadows.glsl lighting.glsl material.glsl
          waving.glsl water.glsl ssr.glsl ao.glsl clouds.glsl volumetrics.glsl
          taa.glsl bloom.glsl tonemap.glsl post.glsl debug.glsl
    program/ gbuffers_solid.glsl gbuffers_translucent.glsl gbuffers_simple.glsl
             gbuffers_sky.glsl gbuffers_emissive.glsl gbuffers_clouds.glsl shadow.glsl
             prepare.glsl deferred_ao.glsl deferred_clouds.glsl deferred_compose.glsl
             composite_vl.glsl composite_vl_apply.glsl composite_resolve.glsl
             composite_bloom.glsl final.glsl
    world0/   *.vsh *.fsh  (stubs)
    world-1/  *.vsh *.fsh  (stubs)
    world1/   *.vsh *.fsh  (stubs)
```

Ship `item.properties` or `entity.properties` only if you actually use their IDs. Never ship empty files. Held-item light uses `heldBlockLightValue` and `heldBlockLightValue2` with `oldHandLight = false` (Section 7.4) and needs no `item.properties`.

**Stub pattern** (generated by `tools/gen_stubs.py`):

```glsl
#version 330 compatibility
#define DIM_OVERWORLD          // or DIM_NETHER / DIM_END
#define STAGE_FRAGMENT         // or STAGE_VERTEX
#define PROGRAM_TERRAIN_SOLID  // identifies the program inside the shared body
#include "/program/gbuffers_solid.glsl"
```

### 5.3 Program list

Iris 26.3 gbuffers fallbacks (`ProgramId.java`): line→basic, textured→basic, textured_lit→textured, skybasic→basic, skytextured→textured, clouds→textured, terrain→textured_lit, terrain_solid/terrain_cutout→terrain, damagedblock→terrain, block→terrain, block_translucent→block, beaconbeam→textured, entities→textured_lit, entities_translucent→entities, lightning→entities, particles→textured_lit, particles_translucent→particles, armor_glint→textured, spidereyes→textured, hand→textured_lit, weather→textured_lit, water→terrain, hand_water→hand. Ship every program below explicitly so no fallback writes the wrong targets.

Geometry notes (Iris source and docs): name-tag and other entity text (`TEXT`, `TEXT_BG`) draws in gbuffers_entities_translucent; sign text and translucent block entities draw in gbuffers_block_translucent; the solid hand draws before deferred, between the `depthtex2` and `depthtex1` copies; ender-dragon death beams write color in gbuffers_lightning and depth in gbuffers_basic; particles render after deferred by default (`particles.ordering` unset).

"Opaque set" below means the profile's opaque RENDERTARGETS (POTATO `0`; LOW `0,1,2`; MEDIUM+ `0,1,2,3`).

| Program | Body file | World folders | Role and targets |
|---|---|---|---|
| shadow | shadow.glsl | world0 | Shadow map. Shared waving and distortion. No jitter. |
| prepare | prepare.glsl | world0 | Sky-view LUT + per-frame constants → colortex7 |
| gbuffers_basic | gbuffers_simple | all | Leash, chunk border, block outline and fishing line (Iris widens lines here, F25), dragon-beam depth. Unlit, linearized → colortex0 only |
| gbuffers_textured, gbuffers_textured_lit, gbuffers_particles | gbuffers_simple | all | Particles and misc, simple lighting → colortex0 only, blended |
| gbuffers_skybasic | gbuffers_sky | all | Writes black except stars (`renderStage == MC_RENDER_STAGE_STARS`) |
| gbuffers_skytextured | gbuffers_sky | all | Moon (linearized, phase from texture; `MC_RENDER_STAGE_MOON`). Discards the vanilla sun (`MC_RENDER_STAGE_SUN`; the analytic sun is used instead). End sky texture in world1. |
| gbuffers_clouds | gbuffers_clouds | all | Present for safety. `clouds=off` because Kestrel draws its own clouds. |
| gbuffers_terrain | gbuffers_solid | all | Cutout terrain with alpha-test discard (also the OptiFine fallback). Opaque set. |
| gbuffers_terrain_solid | gbuffers_solid | all | Solid terrain, **no discard** (Iris-only, early-Z). Opaque set. |
| gbuffers_terrain_cutout | gbuffers_solid | all | Cutout terrain, manual alpha test. Opaque set. |
| gbuffers_block | gbuffers_solid | all | Block entities. Opaque set. |
| gbuffers_entities | gbuffers_solid | all | Entities (`entityColor` hurt flash), inline glint (Section 6.4). Opaque set. |
| gbuffers_hand | gbuffers_solid | all | Solid hand (writes hand material ID for TAA), inline glint. Opaque set. |
| gbuffers_damagedblock | gbuffers_simple | all | Crack overlay → colortex0 only, blended |
| gbuffers_spidereyes, gbuffers_beaconbeam, gbuffers_armor_glint | gbuffers_emissive | all | Emissive or additive → colortex0 only |
| gbuffers_lightning | gbuffers_emissive | all | Lightning bolts and dragon death beams. `POSITION_COLOR` only: no texture, so do not sample `gtexture`; color from `gl_Color`, strong emission so it blooms. Additive → colortex0 only |
| gbuffers_weather | gbuffers_simple | all | Rain and snow, subtle, lit by sky ambient → colortex0 only |
| gbuffers_water | gbuffers_translucent | all | Water (forward, Section 6.5) + translucent terrain (glass, ice, slime, honey, portal) → colortex0 only |
| gbuffers_hand_water | gbuffers_translucent | all | Translucent held items, inline glint → colortex0 only |
| gbuffers_entities_translucent | gbuffers_translucent | all | Translucent entities, entity text, inline glint → colortex0 only (no feature flag needed) |
| gbuffers_block_translucent | gbuffers_translucent | all | Translucent block entities and sign text → colortex0 only |
| deferred | deferred_ao | all | SSAO/GTAO, half resolution → colortex6 |
| deferred1 | deferred_clouds | world0 | Volumetric clouds, quarter resolution + temporal → colortex8 (HIGH only) |
| deferred2 | deferred_compose | all | AO apply, environment specular and opaque SSR (MEDIUM+), sky / sun disc / stars / clouds, aerial perspective and fog for opaque pixels, underwater fog → colortex0, plus the opaque copy → colortex4 (`KS_WATER_ADVANCED`) |
| composite | composite_vl | world0 | Volumetric light march, half resolution → colortex6 |
| composite1 | composite_vl_apply | world0 | Depth-aware VL upsample and apply → colortex0 |
| composite2 | composite_resolve | all | TAA (+TAAU) or FXAA, plus auto exposure → colortex5 |
| composite3 | composite_bloom | all | Bloom tile atlas, half resolution → colortex6 |
| final | final | all | Bloom combine, exposure, Purkinje, tonemap, grade, CAS, vignette, sRGB, dither, debug views |

`gbuffers_particles_translucent` is not shipped: it is used only with `particles.ordering = mixed`, which Kestrel does not set. Record that in DECISIONS.md. `gbuffers_line` is not shipped (F25).

### 5.4 Render targets

| Buffer | Format | Size | Contents | Written by | Clear |
|---|---|---|---|---|---|
| colortex0 | R11F_G11F_B10F | full | Linear HDR scene (Kestrel units, Section 6.1) | all gbuffers (opaque write, others blend), deferred2, composite1 | yes, `colortex0ClearColor = vec4(0.0)` (the default is the fog color) |
| colortex1 | RGBA8 | full | R blocklight, G skylight (both 0–1), B material code/255 (**0 = no G-buffer data**), A ambient fraction | opaque lit programs (LOW+) | yes, `colortex1ClearColor = vec4(0.0)` (the default is 1.0) |
| colortex2 | RG16 | full | Octahedral view-space normal | opaque lit programs (LOW+) | yes (0) |
| colortex3 | RGBA8 | full | RGB = F0 / specular color (sRGB-encoded), A = smoothness | opaque lit programs when `SSR_OPAQUE` (MEDIUM+) | yes (0) |
| colortex4 | R11F_G11F_B10F | full | Opaque scene after sky, fog and environment specular, for water refraction and water SSR | deferred2 (`KS_WATER_ADVANCED`) | false (fully rewritten each frame) |
| colortex5 | RGBA16F | full | Resolved AA HDR (RGB). Alpha of texel (0,0) = exposure as EV100 (0 = history just cleared, Rule 42); other alpha = 1.0 | composite2 | **false** |
| colortex6 | RGBA16F | 0.5 x 0.5 | Reused in order: AO (deferred → deferred2), VL in-scatter RGB + transmittance A (composite → composite1), bloom atlas (composite3 → final) | deferred, composite, composite3 | false |
| colortex7 | RGBA16F | 192 x 112 px | Rows 0–107: sky-view LUT. Rows 108–111: per-frame constants (sun radiance, moon radiance, sky irradiance up/side/down, horizon fog color, flags). | prepare (world0) | false |
| colortex8 | RGBA16F | 0.25 x 0.25 | Volumetric clouds (RGB in-scatter, A transmittance) with temporal history | deferred1 (HIGH) | **false** |

Rules for these targets:

- Declare `size.buffer.colortex6 = 0.5 0.5`, `size.buffer.colortex7 = 192 112` and `size.buffer.colortex8 = 0.25 0.25`. Integer values mean pixels, floats mean a fraction of the screen.
- Every reader of a reused buffer (colortex6) is guarded by the same effective macro as its writer.
- Programs that draw depth before deferred but write only colortex0 (gbuffers_basic, beaconbeam, textured) leave colortex1 at its cleared value, so material code 0 means "no G-buffer data". deferred2 and composite2 treat code-0 pixels as unlit: no AO, no environment specular, fog only. This is why colortex1–3 stay cleared.
- In POTATO, opaque gbuffers write only colortex0, and no program references colortex1–4, so Iris never allocates or clears them (F16).
- Keep the opaque RENDERTARGETS set identical across all opaque lit programs in a given profile (Rule 25).

**Memory check** (write the real numbers in ARCHITECTURE.md). At 1080p the MEDIUM colortex set, doubled by Iris main/alt and including colortex5 mips, is about 130–150 MB, plus three window-sized depth textures (about 25 MB) and shadow maps at 2 x res² x 4 B (1536² is about 19 MB). At 4K HiDPI the window-sized part is roughly 4x.

### 5.5 Material IDs (`block.properties` → `mc_Entity.x`)

Use small positive IDs (1–99). Use Iris tags (`%minecraft:leaves` and so on), guarded by `#if IRIS_TAG_SUPPORT >= 2` in `block.properties`, with explicit block lists as the fallback. Before relying on a block name, verify that it exists in 26.3.

At minimum, define IDs for:

- grounded small plants (wave top vertices only), tall plants (lower and upper halves), leaves, vines
- water, glass and stained glass, ice
- lava
- full emissive blocks (glowstone, sea lantern, shroomlight, froglights and similar)
- partial emissives (torches, lanterns, candles, campfires; mask by texel brightness)
- metal blocks, polished or smooth stone, nether portal, snow

Entities and the hand get IDs from the program that draws them. Map IDs to the 1–255 colortex1.B material code in `lib/material.glsl`. Code 0 is reserved for "no G-buffer data".

### 5.6 Pass schedule per profile

| Pass | Resolution | POTATO | LOW | MEDIUM (M1) | HIGH |
|---|---|---|---|---|---|
| shadow | shadow map | off | 1024 / 64 blocks | 1536 / 96 | 2048 / 128 |
| prepare | 192x112 | on (8 steps) | on (12) | on (16) | on (16) |
| gbuffers opaque | full x scale | lit, writes 0 | lit, writes 0,1,2 | writes 0,1,2,3 | writes 0,1,2,3 |
| gbuffers water and translucents | full x scale | simple forward water | advanced forward water, SSR 10+3 | SSR 16+4, caustics | SSR 24+4 |
| deferred (AO) | ½ | off | SSAO 4 samples | GTAO 2x3 | GTAO 3x4 |
| deferred1 (volumetric clouds) | ¼ | off | off | off | on (Mac-gated) |
| deferred2 (compose) | full | sky, 2D clouds, fog | + AO apply, + colortex4 copy | + environment specular, opaque SSR (puddles, metals, polished) | same |
| composite (VL march) | ½ | off | screen-space rays, 12 taps | shadow-map march, 6 steps | 12 steps |
| composite1 (VL apply) | full | off | on | on | on |
| composite2 (AA + exposure) | full | off | TAA + TAAU auto(810) | TAA, auto(1080) | TAA, scale 1.0 |
| composite3 (bloom) | ½ | 4 levels | 5 levels | 6 levels | 6 levels |
| final | window | on | on + CAS | on + CAS | on + CAS |

`final` reads colortex5 when `KS_RESOLVE_PASS` is defined and colortex0 otherwise. `program.world*/composite2.enabled` uses exactly the same boolean expression.

### 5.7 Render scale / TAAU (vertex-shrink method)

- `renderScale()` in `lib/space.glsl` returns `RENDER_SCALE` (manual mode) or `clamp(AUTO_TARGET_HEIGHT / viewHeight, 0.5, 1.0)` (auto mode). It returns 1.0 when `TAA` is off.
- Every gbuffers vertex shader does `clip.xy = clip.xy * s + clip.w * (s - 1.0)`, then adds the sub-pixel jitter (`jitter * clip.w`, with jitter in rendered-pixel units: `2.0 / (viewSize * s)` per pixel).
- Jitter: Halton(2,3) as a GLSL function, index `frameCounter % n + 1` with `n = clamp(int(ceil(8.0 / (s*s))), 8, 32)` phases (the FSR2 rule: 8 at s = 1, 15 at 0.75, 32 at 0.5). frameCounter wraps at 720720, which 32 does not divide, so a 32-phase sequence skips once about every 3.3 hours; accept that and note it in DECISIONS.md.
- Pre-TAA fullscreen passes (deferred*, composite, composite1) shrink their quad to the `[0,s]` sub-rectangle, and all UV and depth math works in that space. Half-resolution buffers hold content in their `[0,s]` sub-rectangle.
- composite2 reconstructs full resolution from the scaled current frame plus full-resolution history:
  - For each output pixel, gather the 3x3 low-resolution neighborhood around its position in the scaled frame. Weight each sample with a Gaussian (σ about 0.5–0.6 output pixels) or Blackman-Harris kernel on its jittered distance to the output pixel center.
  - Build the YCoCg mean and variance for the clip box from the same samples.
  - Apply a `1 / (1 + L)` (Karis) weight to samples before clipping and invert it after, so sun and wet-surface fireflies do not ghost.
  - Fetch history with 5-tap Catmull-Rom in every TAA profile. Bilinear history compounds blur when s < 1.
- composite3, final and CAS run at full resolution.
- Pitfall: with s < 1, exposure must sample only the valid sub-rectangle.
- History reset: Rule 42 (Iris clears all buffers on resize and on pack reload, which are the only moments the scale can change).
- A runtime frame-time-adaptive scale is **out of scope**. `frameTime` includes CPU time and VSync, and changing the scale breaks history.

### 5.8 Shadow pipeline

- `const float shadowDistanceRenderMul = 1.0;` makes the distance actually cull. `frustum.culling=true`, `shadow.culling=true`.
- Turn off shadow mipmaps and shadow clears. Mipmaps are not needed, and shadowcolor mipmaps are reported broken.
- Distortion (shared by `shadow.vsh` and every lookup): `f = length(clip.xy) + 0.1; clip.xy /= f; clip.z *= 0.5;`, or a quartic-length variant. Scale the bias with the distortion derivative, add a normal-offset bias, and keep everything in `lib/shadows.glsl`.
- `const bool shadowHardwareFiltering = true;` gives cheap PCF through the HW samplers (Rule 22). Each tap is a bilinear 2x2 comparison.
- LOW: one HW sampler, terrain casters only (`shadowTranslucent=false`, `shadowEntities=false`, `shadowBlockEntities=false`).
- MEDIUM: one HW sampler (`shadowtex0HW`), terrain + entity casters (`entityShadowDistanceMul = 0.25`, a verified const), no translucent casters. Skip the shadow lookup entirely where `NdotL <= 0` or the leak factor below is 0.
- HIGH: colored translucent shadows (`COLORED_SHADOWS`). If lit in shadowtex0HW, full light. Otherwise, if occluded in shadowtex1HW, no light. Otherwise, light = `shadowcolor0.rgb * (1 - a)`. Fetch shadowcolor0 only where the two HW results disagree. `shadow.fsh` writes shadowcolor0 only when `COLORED_SHADOWS` is on **[verify that a shadow.fsh with no color output is accepted]**.
- Always multiply sunlight by a skylight leak factor, `smoothstep(0.0, 2.0/15.0, skylight)`.
- Cross-fade to lightmap fake shadows over the last 10–15% of `shadowDistance`.
- POTATO fake shadows: `smoothstep(13.5/15.0, 14.5/15.0, skylight) * NdotL`.
- `sunPathRotation` defaults to -35 (range -45 to 0).

### 5.9 Dimensions

| Folder | Programs | Look |
|---|---|---|
| **world0** | Full set | Overworld. Guard sky and shadows with `hasSkylight` under `IS_IRIS`, because modded dimensions fall back to world0. |
| **world-1** | All gbuffers programs, deferred, deferred2, composite2, composite3, final. No shadow, prepare, deferred1, composite or composite1. | Nether. Ambient and fog from linearized `fogColor` (which varies by biome), dense height-varying fog, warm block-light bias, lava emission, no sky LUT. `KS_WATER_ADVANCED` is off here. |
| **world1** | Same reduced set as world-1 | End. Vanilla End sky texture linearized and tinted, flash via `endFlashIntensity` (Iris uniform, verified in source), no shadows, cool fog. Advanced forward water works here (colortex4 is written). |

No program in world-1 or world1 may reference colortex7, colortex8 or shadow samplers; the effective macros in Section 5.1 enforce this.

### 5.10 Sampler budget (required table)

In ARCHITECTURE.md, list every program with every sampler it references under each profile, including the Iris-injected ones, and keep each at ≤ 12. Expected values are about 7 for gbuffers_terrain in MEDIUM, about 9 for gbuffers_entities and gbuffers_hand (adds `iris_overlay` and `glintTexture`), about 9 for gbuffers_water, and about 10 for deferred2 on HIGH. The checker computes this from the preprocessed source for each profile and macro set.

---

## 6. Features ranked by realism per millisecond

Implement them in this order. Costs are engineering estimates for a UHD 620-class iGPU at 1080p unless noted. The M1 is roughly 3–5x faster on ALU-bound work and about 2x on bandwidth-bound work. Treat every cost as a hypothesis to measure.

| Rank | Feature | Est. cost | POTATO | LOW | MEDIUM (M1) | HIGH |
|---|---|---|---|---|---|---|
| 1 | Linear HDR + AgX tonemap + exposure | < 0.3 ms | eye-brightness exposure | adaptive log-average | adaptive | adaptive |
| 2 | Atmosphere LUT sky, sun and moon, aerial perspective, height fog | < 0.5 ms | 8 steps | 12 | 16 | 16 |
| 3 | Sun shadows + leak fix | shadow pass ≈ 2–3 ms (hypothesis). Filter: 1 tap ≈ free, 8 taps 0.5–1 ms, PCSS 2–4 ms | fake (lightmap) | 1024 / 64 blocks, 4 rotated taps | 1536 / 96, 8 taps, entities | 2048 / 128, PCSS-lite, colored |
| 4 | Lighting model, materials, block light, emissives | ≈ 1–1.5 ms | Lambert + sun GGX, ID materials | + labPBR if the resource pack provides it | + held-item light, deferred env specular | + POM |
| 5 | Water (all forward) | simple ≈ 0.3 ms; advanced + SSR 0.5–1.5 ms | simple, sky reflection | refraction, absorption, SSR 10+3 | SSR 16+4, caustics | SSR 24+4 |
| 6 | Bloom | 0.3–0.8 ms | 4 levels | 5 | 6 | 6 |
| 7 | Foliage waving, rain wetness and puddles | ≈ 0.2 ms | waving, wet darkening | + wet roughness | + puddles and ripples with SSR | same |
| 8 | TAA / TAAU + CAS | 0.3–0.7 ms + 0.1–0.3 ms | off | TAA, auto(810) | TAA, auto(1080) | TAA 1.0 |
| 9 | Ambient occlusion | 0.6–1.5 ms (half resolution) | vanilla only | SSAO 4 | GTAO 2x3 | GTAO 3x4 |
| 10 | Volumetric light | 0.4–1.5 ms | off | screen-space rays | shadow-map 6 steps | 12 steps |
| 11 | Clouds | 2D: 0.2–0.5 ms; volumetric: 3–6 ms | 1 layer | 2 layers | 2 layers + cloud shadows | + volumetric |
| 12 | Night: moon, stars, Purkinje | < 0.1 ms | on | on | on | on |
| 13 | Underwater | < 0.5 ms | forward + deferred2 fog | + absorption | + caustics | same |
| 14 | Weather: rain, snow, thunder | < 0.2 ms | on | on | on | on |
| 15 | Nether and End | ≤ Overworld | on | on | on | on |

Keep these **off in every profile** (with no option): DOF, motion blur, lens flare ghosts, lens dirt, chromatic aberration above 0.5 px, SSGI/GI, and SSR on all surfaces at once.

### 6.1 Scene units, linear HDR, tonemapping and exposure

**Scene units.** All linear HDR values (colortex0, colortex4, colortex5, the sky LUT) are in **Kestrel units: 1.0 = 1000 cd/m²**. This keeps every value inside the R11F_G11F_B10F normal range (about 6e-5 to 6.5e4) and keeps EV100 calibration meaningful. Tune the light sources so these reference values hold (they are targets, with night compressed for playability):

| Reference | Kestrel units |
|---|---|
| White Lambertian surface facing the noon sun | ≈ 30 |
| Clear noon sky radiance (zenith) | ≈ 4–8 |
| Overcast or rainy sky | ≈ 1–2 |
| Sun-facing white surface at sunset | ≈ 3–8 |
| Full-moon-lit white surface | ≈ 0.01–0.02 (about 1/2000 of noon; the physical ratio is about 1/400000) |
| Moonless night sky | ≈ 0.001–0.002 |
| Star pixel | ≈ 0.005–0.05 |
| Wall 1 block from a torch (block light 14) | ≈ 0.05–0.1 |
| Full emissive block surface (glowstone, sea lantern) | ≈ 0.5–1 |
| Lava surface | ≈ 2–5 |
| Nether ambient | ≈ 0.02–0.05 |
| End ambient | ≈ 0.01–0.03 |
| Cave ambient floor | ≥ 0.0003 |
| Sun disc | clamp to ≤ 20000 before writing |

Set the atmosphere's solar illuminance so the noon rows hold. Put these values in ARCHITECTURE.md with the constants that produce them.

**Linearization and storage.**

- Linearize every color input: atlas albedo, `gl_Color` tint, `fogColor`, `skyColor`, the moon texture, stars, glint and the End sky. Use a proper sRGB curve or `pow(x, 2.2)`, and be consistent.
- Store linear HDR only in R11F_G11F_B10F or RGBA16F. Values must be non-negative (R11F_G11F_B10F has no sign bit). Encode sRGB by hand in `final`, because Iris has no sRGB targets. Apply an 8-bit dither (IGN or blue noise, ±0.5/255) as the last step.

**`final` order:** exposure → white balance (precomputed von Kries or Bradford `const mat3`, or per-channel gain from `WHITE_BALANCE_K`) → Purkinje (night only) → tonemap → saturation and contrast → CAS (when TAA is on; can run before tonemap on HDR with a luma-safe variant, so document your choice) → vignette (subtle) → optional film grain (1–2%) → sRGB encode → dither.

**`TONEMAP` option values:**

- 0 = **AgX** (default, Wrensch minimal polynomial)
- 1 = ACES fit (Hill RRT+ODT)
- 2 = Khronos PBR Neutral

All three cost under 0.1 ms. See Appendix A.

**Exposure:**

- EV100 from average luminance: `EV100 = log2(L_avg_cd * 100.0 / 12.5)` with `L_avg_cd = 1000 * L_avg`. Exposure multiplier on Kestrel units: `1000.0 / (1.2 * exp2(EV100 - EXPOSURE_BIAS))`. Calibrate so mid-grey lands where AgX expects it, and expose `EXPOSURE_BIAS`.
- Clamp EV100 to `[KS_EV_MIN, KS_EV_MAX]` (start at 5.0 and 16.5; tune in M2) so nights and caves stay dark but readable. `KS_EV_MIN > 0` keeps 0 free as the history-cleared signal (Rule 42).
- **POTATO:** computed in `final.vsh` from `eyeBrightnessSmooth.y/240` and sun elevation, passed as a flat varying.
- **LOW+:** computed in the vertex shader of composite2 (flat varying). Take a 16x16 grid of `texelFetch` samples of colortex0 level 0 inside the valid `[0,s]` sub-rectangle, jittered per frame with R2 and center-weighted, and compute the log-average luminance. No mip chain is needed. Adapt toward the target with `1 - exp(-rate * frameTime)` using separate brighten and darken rates. Read the previous EV100 from colortex5 texel (0,0) alpha. Guard NaN. composite2 writes the new EV100 to texel (0,0) alpha and 1.0 to every other alpha.

### 6.2 Sky and atmosphere

- **prepare** computes a Hillaire-2020-style **sky-view LUT** of 192x108 with a non-linear latitude mapping (more texels near the horizon) and longitude relative to the sun azimuth, at the camera altitude (`eyeAltitude` mapped to meters). It uses single scattering with `ATMOSPHERE_STEPS` (8/12/16) primary steps, analytic or 4-step secondary optical depth, and a cheap multi-scattering approximation (an isotropic ambient term).
- Rows 108–111 of the same pass compute the per-frame constants by direct ray-march:
  - sun and moon radiance at the camera (transmittance-tinted)
  - sky irradiance in the up, side and down directions
  - horizon fog color
- Reading these constants (`texelFetch`, or in a vertex shader passed as flat varyings) gives sun, ambient and fog colors that always agree with the sky.
- Constants are in Appendix A. Exaggerate aerial-perspective density 10–100x relative to Earth so haze reads within 128–256 blocks.
- **deferred2**, for sky pixels (depth = 1), draws:
  - the LUT lookup
  - an analytic sun disc (angular radius about 0.27°) with limb darkening and transmittance color, clamped per Section 6.1
  - the moon from skytextured (linearized)
  - vanilla stars boosted and faded by sky brightness
  - clouds
- For opaque pixels, deferred2 applies aerial perspective plus closed-form exponential height fog. The fog color is the LUT in the view direction.
  - Rain increases density.
  - Biome tuning comes from custom uniforms smoothed over time: swamp denser and greener, desert warm haze, snowy biomes bright and cold.
  - Underground, outdoor fog scales with `eyeBrightnessSmooth.y`.
  - A border fade near `far` hides chunk edges.
- Translucent gbuffers apply the same `applyAtmosphere()` function forward.
- The prepare LUT is cheap enough for every profile. Confirm ≤ 0.2 ms on UHD 620 in the test plan.

### 6.3 Shadows

See Section 5.8 for the pipeline.

- Filters (`SHADOW_FILTER`), all taps on the HW sampler (Rule 22):
  - 0 = 1 hardware tap
  - 1 = 4 IGN-rotated hardware taps
  - 2 = 8 rotated Poisson taps
  - 3 = PCSS-lite: 4-tap blocker search on raw depth (`sampler2D shadowtex0` under `IRIS_FEATURE_SEPARATE_HARDWARE_SAMPLERS`), then variable-radius PCF on `shadowtex0HW`. Fall back to filter 2 if the flag is absent.
- Rotate taps per pixel and per frame so TAA averages them. When TAA is off, use a static rotation.
- Leaves and grass use a subsurface or "wrap" term so shadowed back-lit foliage still glows a little.

### 6.4 Lighting, materials and PBR

- Diffuse is Lambert. Specular is GGX with height-correlated Smith visibility and Schlick Fresnel, with roughness clamped to ≥ 0.03 (no sun fireflies).
- Sky ambient = constant-row irradiance (interpolate up/side/down by normal) times a skylight curve (for example `skylight^2` with a small floor for caves), times vanilla AO.
- Block light: a warm blackbody tint (`BLOCKLIGHT_TEMPERATURE`, default 2900 K) with a steeper falloff curve on `lm.x`, scaled to the Section 6.1 values. Optional held-item light (`HELD_LIGHT`) from `heldBlockLightValue`/`heldBlockLightValue2` with distance falloff; this needs `oldHandLight = false`, otherwise `heldBlockLightValue` already holds the brighter hand and an off-hand torch counts twice.
- Lightmap remap: `lm = clamp((lm - 1.0/32.0) * 16.0/15.0, 0.0, 1.0)` **[verify the input range against the Iris guide]**.
- Vanilla AO:
  - POTATO: AO baked in `gl_Color.rgb`, `ambientOcclusionLevel` 1.0.
  - LOW+ (shadow pass on): `separateAo=true`, gated in `shaders.properties` by `SHADOWS` and mirrored in GLSL by the same macro, so AO in `gl_Color.a` multiplies only ambient. The Iris docs say separateAo is broken when the shadow pass is off **[verify it works when on, with Sodium terrain; if not, keep it baked]**.
- Materials without a PBR resource pack use per-ID values: F0 = 0.04 for dielectrics; metals use albedo as F0; polished stone, ice, glass and metal blocks get lower roughness.
- **labPBR 1.3** applies only under `#ifdef MC_TEXTURE_FORMAT_LAB_PBR` (defined when the resource pack declares it) **and** `PBR_MODE == 1`. That way, players without a PBR pack never pay for the `normals`/`specular` fetches. Layout:

  | Map | Channel | Meaning |
  |---|---|---|
  | `_s` | R | perceptual smoothness; roughness = (1 - s)² |
  | `_s` | G | F0: 0–229 linear; 230–237 predefined metals; ≥ 230 treat as albedo metal |
  | `_s` | B | 0–64 porosity, 65–255 SSS |
  | `_s` | A | emission 0–254; 255 = none |
  | `_n` | RG | normal xy; z = `sqrt(1 - dot(xy, xy))` |
  | `_n` | B | material AO |
  | `_n` | A | height |

  Build the TBN with `at_tangent.w` handedness. Test the normal Y convention with a known labPBR pack **[verify]**.
- POM only in HIGH (`POM` option), with no depth write.
- Emission comes from labPBR alpha, or from the block-ID table masked by texel luminance and saturation (only the flame of a torch glows). `at_midBlock.w` (Iris 1.7+, `BLOCK_EMISSION_ATTRIBUTE`) gives the light level when the flag is present.
- Write the "ambient fraction" (ambient luminance / total luminance) to colortex1.A for the deferred AO pass.
- **Environment specular (one place per profile).**
  - POTATO, LOW: opaque gbuffers add sky-LUT environment specular (reflected direction, times skylight) forward.
  - MEDIUM+ (`SSR_OPAQUE`, colortex3 written): opaque gbuffers add **no** environment specular. deferred2 adds it for every opaque pixel with material code ≠ 0: sky LUT times skylight for all, and screen-space reflections (`KS_SSR_OPAQUE_ACTIVE`) for pixels with smoothness ≥ `KS_SSR_MIN_SMOOTHNESS` (a const, about 0.7). The SSR marches the current `depthtex0` and takes its hit color from **last frame's colortex5**, reprojected with `gbufferPreviousModelView`/`gbufferPreviousProjection`. Because deferred2 runs before translucents, glass, water and particles drawn later compose correctly over the reflection. Multiply environment specular by a specular-occlusion term derived from AO.
  - Gbuffers pre-multiply diffuse by `(1 - F_env)` with the same `F_env` function deferred2 uses, for approximate energy conservation.
  - Rain must not turn the whole screen into an SSR surface: rain-driven smoothness stays below `KS_SSR_MIN_SMOOTHNESS` everywhere except the `PUDDLES` mask, true metals and polished blocks.
- **Enchantment glint** (F24). Under `#ifdef IRIS_INLINE_GLINT`, the fragment bodies of gbuffers_entities, gbuffers_hand, gbuffers_hand_water and gbuffers_entities_translucent add, after lighting, `if (mc_hasGlint()) color.rgb += srgbToLinear(mc_sampleGlint()) * glintScale;`, where `glintScale` is `KS_GLINT_GAIN` times the pixel's current ambient plus block-light level, so glint reads similarly by day and by night. Mark the pixel as entity or hand for TAA. Keep gbuffers_armor_glint (same scaling, additive) for older Iris and for the remaining glint pipeline. Do not declare `glintTexture` yourself.

### 6.5 Water (forward in gbuffers_water)

- **Simple path (POTATO, and world-1):**
  - two scrolling samples of the noise texture's smooth channels for normals
  - Schlick Fresnel with F0 = 0.02
  - reflection = sky LUT in the reflected direction times skylight (caves do not reflect sky); in world-1/world1 use the fog color instead of the LUT
  - GGX sun glint
  - alpha-blended, no refraction
- **Advanced path (`KS_WATER_ADVANCED`, LOW+):** computed per water fragment, written to colortex0 as the final water color (alpha 1):
  - 3–5 octave sum-of-waves height (Gerstner-style, dispersion `w = sqrt(9.8 k)`, golden-angle direction rotation, `WATER_WAVE_OCTAVES`) with finite-difference normals
  - refraction: offset the screen UV by `normal.xy * strength`, sample colortex4 (the opaque scene from deferred2); reject where `depthtex1` at the offset is in front of the water surface and fall back to the unrefracted UV
  - per-channel absorption `exp(-sigma * d)` (red fastest, tinted by the biome water color), where d is the view-space distance between the water surface and `depthtex1`
  - SSR with `SSR_STEPS` linear steps on `depthtex1` (IGN-jittered start) plus binary refinement (3 on LOW, 4 on MEDIUM+), hit color from colortex4, falling back to the sky LUT times skylight, with fading at screen edges
  - Fresnel mix, sun glint, and finally `applyAtmosphere()`
  - Known limitation: refraction and water SSR see only opaque geometry (colortex4), not entities or particles behind the water. Document it.
- Glass, ice, slime, honey and portals forward-shade (direct light + sky-LUT environment specular) and alpha-blend into colortex0.
- **MEDIUM+ caustics** (`CAUSTICS`): an animated world-space noise or Voronoi pattern. Apply it in gbuffers_water to the refracted floor color (world position reconstructed from `depthtex1`, sunlit only), and in deferred2 to sunlit opaque pixels when `isEyeInWater == 1`.
- Water waves are displaced in the vertex shader only if `WAVING_WATER` is on. Displacement is small and identical in `shadow.vsh`.

### 6.6 Bloom

- composite3 builds a **tile atlas** of `BLOOM_LEVELS` (4–6) levels in half-resolution colortex6. Tile i (i = 0..L-1) is 2^-(i+1) of colortex6 per axis, that is 1/4, 1/8, … of the screen, and samples source mip i+2. Tile 0 sits at (0,0). Tiles 1..L-1 stack in a column at x = 0.5 of the buffer plus 2 texels, with 2-texel gaps in y. Clamp UVs per tile to half a texel inside its rectangle.
- The source is colortex5 (`colortex5MipmapEnabled` in composite3) when `KS_RESOLVE_PASS` is defined, else colortex0 (`colortex0MipmapEnabled` in composite3, POTATO). Each tile pixel takes a 9- or 13-tap tent filter of its mip. Use a Karis average on tile 0 to suppress fireflies.
- `final` combines the tiles with bilinear/tent upsampling and energy-conserving mixing: `mix(color, bloom, BLOOM_STRENGTH)` with a default of about 0.04 and no hard threshold.
- Bloom is what sells emissives, the sun and lava.

### 6.7 Foliage, wind and weather

- Wave grass, flowers, crops, leaves and vines by block ID. Move only the top vertices (`at_midBlock.y` on Iris, else compare `texcoord` against `mc_midTexCoord`).
- Phase comes from world position (`cameraPositionInt`/`Fract`) and `frameTimeCounter`. Amplitude increases with `rainStrength`/`thunderStrength`. Use the identical code in `shadow.vsh`.
- Wetness (`wetness`, `rainStrength`):
  - darken porous albedo (labPBR porosity, or per ID) and lower roughness, within the SSR cap in Section 6.4
  - MEDIUM+ `PUDDLES`: noise-masked only where skylight > 14/15 and normal.y > 0.9, with animated ripple normals and opaque SSR
  - snow (`biome_precipitation == PPT_SNOW` or temperature < 0.15 via custom uniforms): brighter, colder ambient and denser fog
- Rain streaks in gbuffers_weather are subtle (low alpha, lit by sky ambient).
- Lightning: add a short ambient flash using `lightningBoltPosition` (Iris uniform, verified in source); the bolt itself is gbuffers_lightning.

### 6.8 Anti-aliasing

- **TAA:**
  - Reproject using `depthtex0` plus `gbufferModelViewInverse`, `cameraPosition - previousCameraPosition`, `gbufferPreviousModelView` and `gbufferPreviousProjection`. There is no velocity buffer.
  - History fetch is 5-tap Catmull-Rom; clip to the 3x3 YCoCg variance box (gamma 1.0–1.25) built as in Section 5.7, with the Karis luminance weight.
  - Base history weight is about 0.9. Lower it on disocclusion, at large reprojection distance, for entities and the hand (material code), and at low fps.
  - Sanitize history (Rule 38). Reset per Rule 42.
  - The solid hand is where `depthtex1 < depthtex2` (Iris copies depthtex2 before the solid hand and depthtex1 after it; Iris source) or where the material code is the hand; `MC_HAND_DEPTH` is also defined.
- **TAAU:** see Section 5.7.
- **CAS** sharpening (0.3–0.5) runs in `final` when TAA is on.
- **FXAA** (an original implementation of the published FXAA 3.11 idea, using perceptual luma `L / (1 + L)` on HDR) is an alternative to TAA. It is off in all profiles by default.
- Without TAA (POTATO), every dither must look acceptable statically: use a fixed Bayer or IGN pattern and fewer stochastic effects.

### 6.9 Ambient occlusion

- SSAO: 4 samples, half resolution, small radius, IGN rotation.
- GTAO: horizon-based, 2 slices x 3 steps on MEDIUM and 3 x 4 on HIGH.
- Upsample in deferred2 with a depth-aware 4-tap bilateral filter and apply only through the ambient fraction (Section 5.1). Reduce vanilla AO strength when SSAO is on (`ambientOcclusionLevel` is a profile-controlled const) so corners are not darkened twice.
- Scale all screen-space radii by resolution and render scale.

### 6.10 Volumetric light (world0 only, `KS_VL_ACTIVE`)

- **LOW (`VL_MODE 0`):** screen-space radial blur toward the sun's screen position (GPU Gems 3, ch. 13). The occlusion mask is sky pixels. Use 12 taps at half resolution. Fade out when the sun is off-screen or below the horizon, and when underground (`eyeBrightnessSmooth.y`).
- **MEDIUM+ (`VL_MODE 1`):**
  - Ray-march from the camera to `min(depth, shadowDistance)` with `VL_STEPS` (6 on MEDIUM, 12 on HIGH) steps, IGN start offset plus per-frame offset, and HW-PCF shadow taps.
  - Phase: Henyey-Greenstein (g about 0.76) mixed with isotropic.
  - Density depends on height, rain and time of day.
  - Output RGB in-scatter plus transmittance to colortex6. composite1 upsamples depth-aware and applies it to colortex0 (after all translucents, so VL also covers water surfaces). TAA denoises.

### 6.11 Clouds

- **2D layered clouds** (all profiles; drawn on sky pixels in deferred2, also used for reflections):
  - ray-plane intersection at `cloudHeight` (Iris) or a fixed altitude
  - 2–4 octave FBM from the noise texture's smooth channels
  - coverage increases with rain
  - a 2-tap density offset toward the sun gives cheap self-shadowing
  - HG phase gives a silver lining
  - fade with distance and toward the horizon
- **Cloud shadows** (MEDIUM+): in gbuffers, take 1–2 taps of cloud density along the sun direction and multiply the sun term.
- **Volumetric clouds** (HIGH only, `VOLUMETRIC_CLOUDS`, gated off on Mac by default):
  - quarter-resolution colortex8, a ray-marched slab with 16–24 primary steps and 2–3 light steps (constant-bounded, AMD-clamped), jittered start
  - temporal accumulation by reprojecting history in the same buffer (camera-only reprojection, reject on large motion, reset per Rule 42)
  - deferred2 composites them. Off on iGPUs.

### 6.12 Night

- The moon becomes the shadow light (`shadowLightPosition` follows it). Moon radiance and sky come from the constant rows, with the clamped ratios from Section 6.1.
- Stars come from vanilla skybasic (`MC_RENDER_STAGE_STARS`) or hashed procedural stars, faded by sky brightness.
- **Purkinje shift** in `final`: convert to XYZ, estimate scotopic luminance, and blend toward a desaturated blue tint (about `vec3(0.5, 0.7, 1.0)`). The weight falls to zero in daylight (sun elevation), in block light, and underground (skylight). Use it only in the Overworld (`PURKINJE`, `PURKINJE_STRENGTH`).

### 6.13 Underwater (`isEyeInWater`)

- 1 = water: per-channel absorption and in-scatter from the camera to the surface, applied in deferred2 for opaque pixels and forward in translucent programs. The water surface seen from below (gbuffers_water) gets total internal reflection approximated with Fresnel. Caustics on MEDIUM+.
- 2 = lava, 3 = powder snow: dense, short fog with the correct tint.

### 6.14 Weather, Nether and End

Covered in Sections 5.9, 6.2 and 6.7. Nether and End must look intentional: correct fog color and density, emissive bloom, and no Overworld sky artifacts.

---

## 7. Options menu, profiles and language file

### 7.1 Options (all in `lib/settings.glsl`)

Profile-controlled options:

| Option | Type and values |
|---|---|
| `SHADOWS` | bool |
| `shadowMapResolution` | [512 768 1024 1536 2048 3072 4096] |
| `shadowDistance` | [48.0 64.0 80.0 96.0 112.0 128.0 160.0 192.0] |
| `SHADOW_FILTER` | [0 1 2 3] |
| `COLORED_SHADOWS` | bool |
| `ENTITY_SHADOWS` | bool |
| `SSAO` | bool |
| `AO_QUALITY` | [1 2 3] |
| `ambientOcclusionLevel` | [0.0 0.25 0.5 0.75 1.0] |
| `VOLUMETRIC_LIGHT` | bool |
| `VL_MODE` | [0 1] |
| `VL_STEPS` | [6 8 10 12 16] |
| `CLOUD_LAYERS` | [1 2] |
| `CLOUD_SHADOWS` | bool |
| `VOLUMETRIC_CLOUDS` | bool |
| `WATER_ADVANCED` | bool |
| `WATER_WAVE_OCTAVES` | [2 3 4 5] |
| `SSR_STEPS` | [8 10 12 16 24] |
| `SSR_OPAQUE` | bool |
| `CAUSTICS` | bool |
| `WETNESS` | bool |
| `PUDDLES` | bool |
| `PBR_MODE` | [0 1] |
| `POM` | bool |
| `TAA` | bool |
| `FXAA` | bool |
| `RENDER_SCALE_MODE` | [0 1] |
| `RENDER_SCALE` | [0.50 0.60 0.67 0.75 0.85 1.00] |
| `AUTO_TARGET_HEIGHT` | [540 720 810 900 1080 1440] |
| `BLOOM` | bool |
| `BLOOM_LEVELS` | [4 5 6] |
| `AUTO_EXPOSURE` | bool |
| `ATMOSPHERE_STEPS` | [8 12 16] |
| `HELD_LIGHT` | bool |

Look options (not set by profiles):

| Option | Type and values |
|---|---|
| `TONEMAP` | [0 1 2] |
| `EXPOSURE_BIAS` | |
| `SATURATION` | |
| `CONTRAST` | |
| `WHITE_BALANCE_K` | |
| `VIGNETTE` | |
| `FILM_GRAIN` | |
| `PURKINJE` | |
| `PURKINJE_STRENGTH` | |
| `BLOOM_STRENGTH` | |
| `sunPathRotation` | [-45.0 … 0.0] |
| `WAVING_FOLIAGE` | bool |
| `WAVING_WATER` | bool |
| `WIND_STRENGTH` | |
| `BLOCKLIGHT_TEMPERATURE` | [2400 2700 2900 3200 3500] |
| `FOG_DENSITY` | |
| `ATMOSPHERE_DENSITY` | |
| `CAS_STRENGTH` | |

Advanced options:

| Option | Type and values |
|---|---|
| `MAC_ALLOW_HEAVY` | bool, default off |
| `DEBUG_VIEW` | [0 … N] |

Fixed constants (not options, kept in `settings.glsl` with a comment): `KS_SSR_MIN_SMOOTHNESS`, `KS_EV_MIN`, `KS_EV_MAX`, `KS_GLINT_GAIN`, `KS_MAX_*` loop bounds.

### 7.2 Profiles (`profile.POTATO`, `profile.LOW`, `profile.MEDIUM`, `profile.HIGH`)

| Option | POTATO | LOW | MEDIUM (M1) | HIGH |
|---|---|---|---|---|
| SHADOWS | off | on | on | on |
| shadowMapResolution / shadowDistance | 1024 / 64 (unused) | 1024 / 64 | 1536 / 96 | 2048 / 128 |
| SHADOW_FILTER | 0 | 1 | 2 | 3 |
| COLORED_SHADOWS / ENTITY_SHADOWS | off / off | off / off | off / on | on / on |
| SSAO / AO_QUALITY / ambientOcclusionLevel | off / 1 / 1.0 | on / 1 / 0.75 | on / 2 / 0.5 | on / 3 / 0.5 |
| VOLUMETRIC_LIGHT / VL_MODE / VL_STEPS | off / 0 / 8 | on / 0 / 12 | on / 1 / 6 | on / 1 / 12 |
| CLOUD_LAYERS / CLOUD_SHADOWS / VOLUMETRIC_CLOUDS | 1 / off / off | 2 / off / off | 2 / on / off | 2 / on / on |
| WATER_ADVANCED / WATER_WAVE_OCTAVES | off / 2 | on / 3 | on / 4 | on / 5 |
| SSR_STEPS / SSR_OPAQUE / CAUSTICS | 8 / off / off | 10 / off / off | 16 / on / on | 24 / on / on |
| WETNESS / PUDDLES | on / off | on / off | on / on | on / on |
| PBR_MODE / POM | 0 / off | 1 / off | 1 / off | 1 / on |
| TAA / FXAA | off / off | on / off | on / off | on / off |
| RENDER_SCALE_MODE / AUTO_TARGET_HEIGHT / RENDER_SCALE | 0 / 1080 / 1.00 | 1 / 810 / 1.00 | 1 / 1080 / 1.00 | 0 / 1080 / 1.00 |
| BLOOM / BLOOM_LEVELS | on / 4 | on / 5 | on / 6 | on / 6 |
| AUTO_EXPOSURE / ATMOSPHERE_STEPS / HELD_LIGHT | off / 8 / off | on / 12 / on | on / 16 / on | on / 16 / on |

Defaults:

- **The code defaults equal the LOW profile**, so a first load favors performance and the menu shows "LOW".
- Lang tooltips must say: POTATO for UHD 620 / HD 520-class at 720p; LOW for Iris Xe / Vega 8 / GTX 750 Ti / RX 550; **MEDIUM is the recommended profile for the M1 Mac mini** and GTX 1050-class GPUs; HIGH for GTX 1060+ (on Mac, heavy parts stay clamped unless `MAC_ALLOW_HEAVY` is on).
- The README repeats this mapping and the fallback rule from Section 3.1.

### 7.3 Automatic Mac handling

Under `#if defined(MC_OS_MAC) || defined(MC_GL_RENDERER_APPLE)`, and unless `MAC_ALLOW_HEAVY` is on, `lib/platform.glsl` derives *effective* macros. **Never redefine an option macro conditionally**, because option defaults must be identical in every file. The clamps are:

- `VOLUMETRIC_CLOUDS` → off (via `KS_VCLOUDS_ACTIVE`)
- `SHADOW_FILTER` ≤ 2
- `SSR_STEPS` ≤ 16
- `VL_STEPS` ≤ 10
- `AO_QUALITY` ≤ 2

`shaders.properties` mirrors the pass-level clamps (environment macros are available there):

```
#ifdef MC_OS_MAC
program.world0/deferred1.enabled = VOLUMETRIC_CLOUDS && MAC_ALLOW_HEAVY
#else
program.world0/deferred1.enabled = VOLUMETRIC_CLOUDS
#endif
```

`shadowMapResolution` is a const and cannot be clamped. Document that.

The base pack is Mac-safe by construction (Section 4), so these clamps exist only for cost.

### 7.4 shaders.properties requirements

The excerpt below is illustrative. Verify each key's syntax against the Iris docs and OptiFine `shaders.properties`.

```
clouds = off
oldHandLight = false
frustum.culling = true
shadow.culling = true
size.buffer.colortex6 = 0.5 0.5
size.buffer.colortex7 = 192 112
size.buffer.colortex8 = 0.25 0.25
texture.noise = textures/noise.png
iris.features.optional = SEPARATE_HARDWARE_SAMPLERS BLOCK_EMISSION_ATTRIBUTE

#ifdef SHADOWS
separateAo = true
#endif
#ifdef ENTITY_SHADOWS
shadowEntities = true
shadowBlockEntities = true
#else
shadowEntities = false
shadowBlockEntities = false
#endif
#ifdef COLORED_SHADOWS
shadowTranslucent = true
#else
shadowTranslucent = false
#endif

# world0: full set
program.world0/shadow.enabled     = SHADOWS
program.world0/deferred.enabled   = SSAO
# deferred1: see Section 7.3
program.world0/composite.enabled  = VOLUMETRIC_LIGHT
program.world0/composite1.enabled = VOLUMETRIC_LIGHT
program.world0/composite2.enabled = TAA || FXAA || AUTO_EXPOSURE
program.world0/composite3.enabled = BLOOM
# world-1 and world1: only the programs they ship
program.world-1/deferred.enabled   = SSAO
program.world-1/composite2.enabled = TAA || FXAA || AUTO_EXPOSURE
program.world-1/composite3.enabled = BLOOM
program.world1/deferred.enabled    = SSAO
program.world1/composite2.enabled  = TAA || FXAA || AUTO_EXPOSURE
program.world1/composite3.enabled  = BLOOM

screen = <profile> <empty> [LIGHTING] [SHADOWS] [ATMOSPHERE] [WATER] [POST] [PERFORMANCE] [ADVANCED]
screen.SHADOWS = SHADOWS COLORED_SHADOWS shadowMapResolution shadowDistance SHADOW_FILTER ENTITY_SHADOWS sunPathRotation
# ...one screen.<NAME> line per sub-screen; every option appears on exactly one screen
sliders = shadowMapResolution shadowDistance sunPathRotation RENDER_SCALE AUTO_TARGET_HEIGHT BLOOM_STRENGTH EXPOSURE_BIAS SATURATION CONTRAST WHITE_BALANCE_K VL_STEPS SSR_STEPS
profile.POTATO = !SHADOWS !SSAO !VOLUMETRIC_LIGHT CLOUD_LAYERS:1 ... (every profile-controlled option)
```

Also required:

- `shaders.properties` is preprocessed with option and environment macros, but `#define` and `#include` are not allowed inside it.
- Expressions in `program.*.enabled` use boolean options with `!`, `&&`, `||` and parentheses (supported by Iris's `BooleanParser`). Verify the `program.world-1/<name>.enabled` path syntax against the docs **[verify]**.
- Screens: PERFORMANCE holds render scale, TAA/FXAA and the pass toggles. ADVANCED holds `MAC_ALLOW_HEAVY` and `DEBUG_VIEW`. Use `screen.columns = 2`.

### 7.5 Custom uniforms (CPU-side, in `shaders.properties`)

- Use them for per-frame scalars: sun elevation, rain and thunder factors, and biome factors via `smooth(if(biome_category == CAT_SWAMP, 1.0, 0.0), t, t)`, plus desert, snowy, jungle and so on. Use `in(biome, …)` where needed.
- `smooth()` fade times are half-lives in **units of 0.1 s** in Iris (`SmoothFloat`: `computeDecay(halfLife * 0.1)`); the Iris docs say ticks and OptiFine says seconds, but the source wins. Choose values for Iris (for example `smooth(x, 20, 20)` is a 2 s half-life).
- Custom uniforms cannot be matrices, and they cannot take dynamic uniforms (`fogColor`, `entityColor`, …) as inputs.
- Keep TAA jitter in GLSL, not in custom uniforms (Rule 48).

### 7.6 Language file (`lang/en_us.lang`)

- For **every** option: `option.X=` (label) and `option.X.comment=` (one or two sentences: what it does, relative cost, and a profile hint).
- `value.X.N=` for every enum value.
- `screen.NAME=` and `screen.NAME.comment=` for every screen.
- `profile.POTATO=` and the other profile names, plus `profile.comment=`.
- `prefix.`/`suffix.` where units help (blocks, px, K, %).

The checker verifies that every key exists.

### 7.7 Debug views (`DEBUG_VIEW`)

Provide these views:

| Value | View |
|---|---|
| 0 | off |
| 1 | albedo-free lighting |
| 2 | normals |
| 3 | lightmap |
| 4 | material code (code 0 highlighted) |
| 5 | AO |
| 6 | shadows (only under `KS_SHADOWS_ACTIVE`) |
| 7 | VL |
| 8 | sky LUT |
| 9 | bloom atlas |
| 10 | exposure / luminance grid |
| 11 | NaN/Inf detector (magenta) |

Each view references only samplers that are valid in the current profile and dimension.

---

## 8. Deliverables

### 8.1 Completeness

- Every file in the tree is complete and functional. No placeholders, `TODO`, `FIXME`, "implement later" or dead options.
- If a feature cannot be finished, remove it completely (option, lang keys, code and pass) and list it in KNOWN_ISSUES.md.
- `tools/gen_stubs.py` and `tools/gen_noise.py` must be run, and their outputs (all stubs and `noise.png`) committed.
- `noise.png` is 256x256 RGBA8, deterministic, and uses only the Python standard library (PNG via `zlib` + `struct`):
  - R, G = tileable smooth gradient/value noise at two frequencies
  - B = 64x64 void-and-cluster blue noise, tiled
  - A = white noise

### 8.2 README.md (user-facing, plain language)

1. What Kestrel is, plus screenshots placeholders. The screenshots section is the only allowed placeholder, and it must say "add screenshots".
2. Requirements: Minecraft Java 26.3 (26.1.x and 26.2 should also work), Java 25, Fabric (or NeoForge), Sodium + Iris (newest builds for your version from Modrinth), OpenGL graphics API.
3. Install on **Windows**, three routes:
   - (a) the official Iris installer, if it supports 26.3 **[verify]**
   - (b) the Modrinth App: new 26.3 Fabric profile, add Iris and Sodium, drop the pack into the profile's `shaderpacks`
   - (c) Prism Launcher: new 26.3 instance, install Fabric, add Iris + Sodium from Modrinth
   - Then: Video Settings → **Graphics API: OpenGL** → Shader Packs → Kestrel → choose a profile.
4. Install on **macOS (M1)**: the same three routes. Use native arm64 Java (the official launcher bundles it; in Prism, select or download an arm64 Java 25), not Rosetta. Pack folder: `~/Library/Application Support/minecraft/shaderpacks` (official launcher) or the instance folder (Prism/Modrinth). **Display first:** run the monitor at a 1x mode (for example 1920x1080 on a 1080p monitor, 2560x1440 on a 1440p monitor), or use retiNO / ResolutionControl+ / Sodium Extra's macOS resolution option **[verify for 26.3]**. HiDPI quadruples the pixels, and auto render scale only partly offsets it. Choose **MEDIUM**; if it is too slow, choose LOW.
5. Which profile for which GPU (table from Section 7.2) and expected fps. State that these are targets, not measurements, until the developer fills in the TESTING.md results.
6. Tips:
   - Sodium is required.
   - Render distance 6–8 on iGPUs.
   - Dual-channel RAM is required for Iris Xe-class performance.
   - Laptops on AC power.
   - Pick the dGPU on hybrid laptops.
   - AMD Polaris/Vega: driver 22.7.1 or newer (the OpenGL rewrite).
   - Intel 6th–10th gen: latest legacy driver.
7. Troubleshooting:
   - Pack fails to load: enable Iris debug mode with Ctrl+D on the shader-pack screen (Cmd+D on macOS **[verify]**) and restart the game, as the Iris docs say. Read `logs/latest.log` and map error line numbers through `<game dir>/patched_shaders/`.
   - Black screen on Mac.
   - "Iris cannot run when using Vulkan".
   - Keys: reload shaders with **F3+R** (plain R works only with Iris debug options on), toggle shaders with **K**, open the shader-pack screen with **I** on 26.3 (O in older Iris). Check Controls if they were rebound.
   - Log paths: Windows `%APPDATA%\.minecraft\logs\latest.log`; macOS `~/Library/Application Support/minecraft/logs/latest.log`.
8. Known issues (from KNOWN_ISSUES.md), credits, license.

### 8.3 docs/SETTINGS_GUIDE.md

Cover every option: what it does visually, cost class (free / cheap / moderate / heavy) with the pass it affects, recommended value per tier, and interactions (for example, TAAU requires TAA; opaque SSR requires the resolve pass; PCSS requires the Iris hardware-sampler flag; on Mac, heavy options are clamped unless MAC_ALLOW_HEAVY is on).

### 8.4 Other docs

- **ARCHITECTURE.md:** pass graph per world folder, buffer table, scene-unit reference values, sampler table per program and profile, bandwidth table (with Iris-internal rows), memory table, render-scale design, material IDs.
- **TESTING.md:** Section 10.3.
- **VERIFICATION.md:** every **[verify]** item and the result.
- **DECISIONS.md**
- **KNOWN_ISSUES.md**
- **CREDITS.md:** papers, talks, MIT sources.
- **CHANGELOG.md**

### 8.5 Tools

**`tools/check_pack.py`** (Python 3, stdlib) must fail on:

- missing `#version`, a version other than 330 or 400, a `core` profile, `#version 400` without a 4.00 built-in in the expanded source, or `#version` in `lib/`/`program/`
- a GLSL 4.00-only built-in (Rule 6) in a stage whose version is below 400
- `layout(location` anywhere except a fragment-shader output declaration
- any `.csh`, `.gsh`, `.tcs` or `.tes`, a `setup` program, or a `gbuffers_line` stub
- banned tokens (Rules 6, 7, 10, 14, 15, 19, 27, 32, 33, 39)
- `#if`/`#elif` that uses a value-less macro (Rule 11 list, or any boolean option) without `defined()`
- `sampler2DShadow shadowtex0`/`shadowtex1` outside the `#else` branch of `IRIS_FEATURE_SEPARATE_HARDWARE_SAMPLERS`, or one texture name declared with two sampler types
- more than 8 RENDERTARGETS
- a RENDERTARGETS entry not written on every path (heuristic: each listed `layout(location=N)` output must be assigned at top level of `main`, or in both branches)
- different opaque RENDERTARGETS sets among opaque lit programs in one profile
- more than 12 samplers per program (union of stages, Iris-injected samplers added per Rule 18), after expanding includes and applying each profile's defines, each dimension macro, and `MC_OS_MAC` on and off
- shadow samplers referenced outside `KS_SHADOWS_ACTIVE`, or colortex7/colortex8/shadow samplers referenced in world-1 or world1
- per world folder, any sampled colortex that no earlier enabled pass in that folder writes (colortex5 and colortex8 history excepted)
- disallowed render-target formats
- options defined outside `settings.glsl` or defined inconsistently
- boolean options never tested
- profile lines missing a profile-controlled option
- `program.*.enabled` lines missing for a world folder's optional passes, or naming a program that folder does not ship
- lang keys missing
- uniforms, macros or properties keys not in `allowlist.txt`
- stubs missing for a program in the Section 5.3 table
- `TODO`/`FIXME`
- non-PNG images

**`tools/validate_glsl.py`** expands includes and injects Iris-style macros **exactly as Iris emits them**: value-less `#define MC_OS_MAC`, `#define MC_GL_VENDOR_ATI`, `#define MC_GL_RENDERER_APPLE`, `#define IS_IRIS`, `#define IRIS_INLINE_GLINT`, `#define IRIS_FEATURE_SEPARATE_HARDWARE_SAMPLERS` and so on; valued `MC_VERSION=260300`, `MC_GLSL_VERSION=410`, `IRIS_TAG_SUPPORT=2`, `MC_RENDER_STAGE_*`; plus each profile's defines and each dimension. For gbuffers programs it also injects prototypes and stub bodies for `mc_hasGlint()`/`mc_sampleGlint()` under `IRIS_INLINE_GLINT`. It runs `glslangValidator` on every stage. Install it with `apt-get install glslang-tools` or the equivalent. Variants: Mac (`MC_OS_MAC` + `MC_GL_RENDERER_APPLE` + `MC_GL_VENDOR_OTHER`), Windows Intel, Windows AMD (`MC_GL_VENDOR_ATI`), NVIDIA, with and without `IRIS_INLINE_GLINT` and the hardware-sampler flag. Treat implicit-conversion and uninitialized-variable warnings as errors. glslang cannot reproduce Iris's compatibility-to-core rewrite or the reversed-Z depth rewrite (F22), so the in-game test plan includes a `patched_shaders/` review. If glslang cannot parse something in the compatibility profile, document exactly which file and why.

**`tools/package.py`** produces the release zip with `shaders/` at the zip root. Leave out `tools/` and `docs/` from the zip, but include README, LICENSE and CREDITS.

---

## 9. Build order and milestones

Finish each milestone with every program compiling (validator plus checker green) before starting the next. Commit after each milestone with a descriptive message. **Options, lang keys, profile values, screen entries and `program.*.enabled` lines are added in the same milestone as the feature that uses them**, so the checker can stay green throughout.

| # | Milestone | Done when |
|---|---|---|
| M0 | Verify facts (web: Iris docs at shaders.properties / IrisShaders/docs; Iris 26.3 source `StandardMacros`, `ProgramId`, `ShaderProperties`, `IrisSamplers`, `TransformPatcher`; OptiFine `shaders.txt`; labPBR wiki), check the pack name, scaffold the repo, write the tools, `settings.glsl`, `allowlist.txt` | VERIFICATION.md started; tools run |
| M1 | Minimal correct pipeline: all stubs; skeletons of `shaders.properties` (screens, four profiles, enabled lines), `lang/en_us.lang` and `block.properties`; gbuffers output linearized albedo times vanilla lighting; deferred2 pass-through; final sRGB + dither; confirm conditional RENDERTARGETS in `patched_shaders/` is planned in TESTING.md | Checker and validator green for all profiles and variants |
| M2 | Atmosphere and units: prepare LUT + constants, deferred2 sky / sun / stars / moon, fog and aerial perspective, AgX + exposure (POTATO mode), Section 6.1 reference values | Sky, fog and ambient colors consistent at noon, sunset and night |
| M3 | Lighting model, materials, block light, emissives, glint, fake shadows, waving foliage, wetness basics, simple forward water, bloom atlas. **POTATO complete.** | POTATO uses 2 full-resolution passes + half-resolution bloom |
| M4 | Shadows: distortion, bias, HW-sampler filters, leak fix, distance fade, entity shadows, colored shadows (HIGH) | No peter-panning or acne in the test scenes (developer) |
| M5 | composite2: TAA, TAAU (manual and auto) with the Section 5.7 reconstruction, CAS, FXAA, adaptive exposure; history validation | |
| M6 | AO: SSAO and GTAO with bilateral upsample and ambient-fraction application | |
| M7 | Advanced forward water (waves, colortex4 refraction, absorption, SSR, caustics), underwater, deferred environment specular and opaque SSR (MEDIUM+) | |
| M8 | Volumetric light, both modes, plus composite1 apply. **LOW and MEDIUM complete.** | |
| M9 | 2D layered clouds, cloud shadows, puddles and ripples, weather, lightning, Purkinje, Nether and End | |
| M10 | labPBR path, held light, Mac effective macros review, debug views | Checker green, every option reachable |
| M11 | Docs complete, self-review (Section 10), packaging, final report | |
| M12 (optional) | POM (HIGH) | only if M0–M11 are green |
| M13 (optional) | Volumetric clouds (HIGH) with Mac gating | only if M0–M12 are green |

**Truncation priority** if time or context runs short: POTATO complete → MEDIUM (the M1 target) → LOW → HIGH extras. Stop only at a milestone boundary with everything green.

---

## 10. Self-review checklist (run all of it before finishing)

### 10.1 Automated

- [ ] `check_pack.py` passes for every profile, every dimension, Mac and non-Mac.
- [ ] `validate_glsl.py` passes every stage in every variant (profiles x dimensions x {Mac, Intel, AMD, NVIDIA} x {inline glint on/off}).
- [ ] The release zip builds and contains `shaders/` at the root.

### 10.2 Manual code review (write the results in VERIFICATION.md)

- [ ] For each GLSL file, read it once looking only for GLSL 4.00+/4.20+ features, NVIDIA-isms, uninitialized variables and `#if` on value-less macros.
- [ ] Every uniform, attribute and macro is listed in the Iris docs, Iris source or OptiFine docs (allowlist with a reference).
- [ ] **Profile toggles actually remove cost:** for each optional feature, its pass is disabled by `program.*.enabled`, its code and samplers are compiled out, and no other pass still reads its buffer.
- [ ] POTATO references no shadow sampler and no colortex1–4 anywhere, so the shadow pass truly does not run and those buffers are never allocated.
- [ ] The same projection, jitter and render-scale function is used in every gbuffers vertex shader. The same waving code is used in shadow and gbuffers.
- [ ] Every RENDERTARGETS output is written on all paths. No `gl_FragDepth`. No discard in terrain_solid. Manual alpha test in cutout programs. gbuffers_lightning samples no texture.
- [ ] Shadow samplers follow Rule 22; every PCF tap uses a HW sampler under the flag.
- [ ] Environment specular is added in exactly one place per profile.
- [ ] Every loop has a constant bound, with the AMD clamp on raymarches. NaN guards and history sanitizing are in place. `refractSafe`. `texelFetch` clamped. No `switch` for sampler selection.
- [ ] Buffer formats, clears and size directives match the Section 5.4 table. colortex0 and colortex1 clear colors are 0. History buffers do not clear.
- [ ] The bandwidth (with Iris-internal rows), sampler and per-pass budget tables in ARCHITECTURE.md match the code, and each per-pass column sums to ≤ 85% of its total.
- [ ] Mac: no `.csh`/`.gsh`/`.tcs`/`.tes`, no `gbuffers_line`, no `#version` > 400, ≤ 12 samplers, ≤ 8 targets, effective-macro clamps work, nothing in `iris.features.required`.

### 10.3 In-game test plan (write in TESTING.md for the developer)

**Setup:**

- Fabric + Sodium + Iris for 26.3, Graphics API OpenGL, VSync off, max frame rate unlimited.
- Pack unzipped in `shaderpacks` for live editing.
- Iris debug mode on (Ctrl+D on the shader-pack screen, then restart).
- Reload with F3+R (or R with debug mode on) after edits. F3+T reloads resource packs when testing labPBR. Use the F3 overlay and frame-time graph (see F3+Q for the version's key combos).
- Open `patched_shaders/` once per profile: confirm the conditional RENDERTARGETS and const directives match the profile, and look for the reversed-Z rewrite around every depth read.

**Measurement method:**

- Warm up 60 s, then measure 3 runs x 30 s, laptops on AC power.
- First confirm the scene is GPU-bound: fps must drop when resolution or render scale goes up. If it does not, record the result as CPU-bound and do not use it for per-feature costs.
- Windows: capture average and 1% low with PresentMon or CapFrameX **[verify OpenGL capture works]**. Use Nsight Graphics on the NVIDIA cards for per-pass milliseconds **[verify]**.
- macOS: record average fps from repeated F3 readings (RenderDoc does not run on macOS; Xcode's GPU tools target Metal apps). `MTL_HUD_ENABLED=1` may show a frame-time HUD because Apple's GL runs on Metal **[unverified]**. Treat 1% low as informational.
- Per-feature cost = A/B frame-time delta from toggling that feature, in a GPU-bound scene. The per-pass tables in Section 3.2 are design targets checked through these deltas.

**Benchmark scenes:**

- Standard: fixed world seed and coordinates, recorded in TESTING.md. `/tp <x> <y> <z> <yaw> <pitch>`, `/time set 1000`, `/weather clear`, render distance per tier.
- Worst case: same seed, ocean shore with dense forest and some mobs, `/weather thunder`. Floors: MEDIUM on M1 ≥ 45 fps, LOW on Iris Xe ≥ 45 fps (hypotheses).
- Measure each for vanilla + Sodium, then each profile.

**Scenes to inspect:** noon, sunset, night (with and without a torch in hand), rain, thunder (lightning bolt blooms), forest (waving and shadows), ocean (water, SSR, refraction), rain over the ocean (raindrops and splash particles stay visible over water), holding stained glass in front of water, underwater, cave (light leaks), Nether, End, enchanted armor, held and dropped items (glint on 26.3), name tags and sign text, block outline and fishing line, particles.

**Checks:**

- No compile or link errors in `latest.log`.
- On Mac, no Apple GL `UNSUPPORTED (log once)` lines in the launcher console or stderr. Prism shows the game log.
- No black or garbage buffers on the first frame after loading, resizing or changing an option.
- No NaN squares (use the debug view).
- No glint z-fighting; glint visible on enchanted gear.
- No sun in caves.
- Each profile's fps compared with Section 3, and the Section 3.1 fallback rule applied.

**Per-feature cost table:** toggle each feature and record the frame-time delta on at least one Intel Gen9 iGPU, one AMD GCN iGPU or dGPU, one NVIDIA Maxwell or Pascal card, and the M1.

**Mac extra checks:** 1x 1080p; 1440p at 1x (auto 0.75); 4K "looks like 1080p" HiDPI (auto 0.5); record fps and memory use on an 8 GB machine for each.

**If the game crashes at shader load on Mac**, the Apple linker may segfault instead of logging. Bisect by disabling programs through options.

### 10.4 KNOWN_ISSUES.md (at least these)

- Iris officially treats Apple Silicon Macs as not supported and Intel Macs as deprecated, and Mac driver bugs will not be fixed upstream.
- The pack needs the OpenGL backend and will need a port when Mojang removes OpenGL. Aperture does not load this format.
- No Distant Horizons or Voxy support.
- OptiFine is untested.
- TAA ghosting on fast entities (Iris has no velocity data).
- Opaque SSR uses last frame's image: one frame of lag, possible ghosting on fast camera turns, and the held item can appear briefly in puddle reflections.
- Water refraction and water SSR see only opaque geometry, not entities or particles behind the water.
- Modded dimensions use Overworld code.
- HiDPI cost on Mac; render scale only partly offsets it.
- `separateAo` behavior depends on the shadow pass.
- `smooth()` timing units differ between Iris (0.1 s) and OptiFine (seconds).
- Block outlines and fishing lines use gbuffers_basic (no gbuffers_line).
- Every **[verify]** item that is still unverified.

---

## 11. Output format (how you respond)

1. Do all work as real files in the repository with your file tools. Do **not** paste full file contents into chat.
2. Start with a short plan (at most 15 lines) and the M0 verification results. Then build without waiting for confirmation.
3. After each milestone, give a 2–4 line status: what was built, check results, and any deviation from this spec with its reason. Record deviations in DECISIONS.md. Deviations are allowed only when they keep every hard rule and budget.
4. Finish with a **Final Report** containing:
   - (a) the file tree
   - (b) checker and validator summary (pass counts per variant)
   - (c) a milestone table with status
   - (d) the sampler and bandwidth summary per profile
   - (e) the verification table (verified, corrected, still unverified)
   - (f) known issues
   - (g) exact next steps for the developer: run TESTING.md on a Windows iGPU and on the M1 Mac mini, fill in the fps tables, and apply the Section 3.1 fallback rule
5. If you run out of time or context, stop at a milestone boundary with everything green, following the truncation priority in Section 9. Remove any unfinished feature completely, and say clearly what remains. Never ship placeholders.

---

## Appendix A: Reference formulas and constants

Implement these from the cited sources in your own code. Check each against its source.

- **Interleaved gradient noise** (Jimenez 2014): `fract(52.9829189 * fract(0.06711056*p.x + 0.00583715*p.y))`. Temporal variant: `p + 5.588238 * float(frameCounter & 63)`.
- **R2 sequence** (Roberts): `fract(0.5 + n * vec2(0.7548776662, 0.5698402910))`, used for the exposure grid jitter and other per-frame offsets.
- **TAAU jitter:** Halton(2,3), index `frameCounter % n + 1`, `n = clamp(int(ceil(8.0 / (s*s))), 8, 32)` (FidelityFX FSR2 `ffxFsr2GetJitterPhaseCount`: 8 x (display/render)²).
- **Shadow distortion** (shaderLABS tutorial): `f = length(xy) + 0.1; xy /= f; z *= 0.5`. Bias ∝ `(len + f)^2 / f`, plus a normal-offset bias that grows with distance and at grazing NdotL.
- **Leak and fake shadows:** sun multiplied by `smoothstep(0.0, 2.0/15.0, skylight)`. Fake shadow `smoothstep(13.5/15.0, 14.5/15.0, skylight)`.
- **Water:** IOR 1.333 gives F0 = ((0.333/2.333)^2) ≈ 0.02. Wave dispersion `w = sqrt(9.8 * k)` with `k = 2π/λ`. Octaves use persistence 0.5, lacunarity about 1.7, and golden-angle rotation.
- **SSR:** 16 linear steps + 4 binary refinements for smooth surfaces (MEDIUM), with an IGN-jittered start and a sky fallback.
- **Atmosphere** (Hillaire 2020 / sebh/UnrealEngineSkyAtmosphere) **[verify]**:
  - ground radius 6360 km, top 6460 km
  - Rayleigh scattering (5.802, 13.558, 33.1) x 10⁻⁶ m⁻¹, scale height 8 km
  - Mie scattering 3.996 x 10⁻⁶, absorption 4.40 x 10⁻⁶ m⁻¹, scale height 1.2 km, HG g ≈ 0.76–0.8
  - ozone absorption (0.650, 1.881, 0.085) x 10⁻⁶ m⁻¹ in a tent profile around 25 km
  - reference LUT sizes: transmittance 256x64, multi-scattering 32x32, sky-view 192x108
  - solar illuminance: chosen so the Section 6.1 noon values hold
- **ACES fit** (Stephen Hill): `a = v*(v + 0.0245786) - 0.000090537; b = v*(0.983729*v + 0.4329510) + 0.238081; rrt = a/b`.
  - Input matrix (row-major as published): `[0.59719 0.35458 0.04823; 0.07600 0.90834 0.01566; 0.02840 0.13383 0.83777]`
  - Output matrix: `[1.60475 -0.53108 -0.07367; -0.10208 1.10813 -0.00605; -0.00327 -0.07276 1.07602]`
  - GLSL `mat3` constructors are column-major: transpose these matrices or multiply as `v * M`. Verify by checking that mid-grey maps sensibly.
  - Narkowicz single-curve alternative: `x*(2.51x + 0.03) / (x*(2.43x + 0.59) + 0.14)`.
- **AgX** (Wrensch minimal / three.js):
  - log2 encoding between min EV -12.47393 and max EV 4.026069
  - contrast polynomial `15.5x⁶ - 40.14x⁵ + 31.96x⁴ - 6.868x³ + 0.4298x² + 0.1191x - 0.00232`
  - take the inset and outset matrices from the primary source and credit it
  - AgX is the realistic default. ACES-fit is the "punchy" option and hue-shifts bright saturated colors.
- **Khronos PBR Neutral:** implement from the Khronos reference (start compression 0.76, desaturation 0.15).
- **Exposure:** `EV100 = log2(L_cd * 100 / 12.5)` with `L_cd = 1000 * L_kestrel`; multiplier `1000 / (1.2 * 2^EV100)` on Kestrel units (Lagarde & de Rousiers, "Moving Frostbite to PBR"). Adaptation uses `1 - exp(-rate * frameTime)` with separate up and down rates.
- **TAA:** 3x3 YCoCg variance clipping (Salvi 2016), gamma 1.0–1.25, Catmull-Rom history fetch, Karis `1/(1+L)` weighting.
- **GTAO** (Jimenez et al., Activision): half resolution, 2 slices x 3 horizon steps as the MEDIUM default.
- **Bloom:** binomial 9-tap weights (0.2734375, 0.21875, 0.109375, 0.03125, 0.00390625), or dual-Kawase (Bjørge, SIGGRAPH 2015). Atlas layout in Section 6.6.
- **labPBR:** see Section 6.4.

## Appendix B: Primary references

- Iris docs: https://shaders.properties (source: github.com/IrisShaders/docs). Includes programs, buffers, `shaders.properties` keys, flags, ordering, macros, uniforms, compatibility vs core, macOS page, debugging.
- Iris source (github.com/IrisShaders/Iris, branch 26.3, commit 671a5c8): `StandardMacros.java`, `FeatureFlags.java`, `ShaderPack.java`, `ProgramSet.java`, `ProgramId.java`, `ShaderKey.java`, `ShaderProperties.java`, `PackDirectives.java`, `IrisSamplers.java`, `ClearPassCreator.java`, `FinalPassRenderer.java`, `RenderTargets.java`, `TransformPatcher.java`, `VanillaTransformer.java`, `DepthTransformer.java`, `GlintTransformer.java`, `SmoothFloat.java`, `BooleanParser.java`, `docs/usage/drivers.md`, `docs/ShaderpackBugs.md`.
- OptiFine docs: github.com/sp614x/optifine `OptiFineDoc/doc/shaders.txt` and `shaders.properties`.
- Apple Metal Feature Set Tables (Apple7 = M1); Apple "Tailor your apps for Apple GPUs and tile-based deferred rendering".
- shaderLABS Shadow-Tutorial; labPBR wiki (github.com/rre36/lab-pbr/wiki).
- sebh/UnrealEngineSkyAtmosphere (Hillaire 2020); Activision GTAO paper; GPU Gems 3 ch. 13; Salvi GDC 2016 temporal supersampling; FidelityFX FSR2 (jitter phase count); Lagarde & de Rousiers 2014 (exposure); Christoph Peters' blue noise (CC0) for reference only, since the pack generates its own.
