# Verification log

Each fact the design depends on, where it was checked, and the result. "Iris source" means
the IrisShaders/Iris repository, branch `26.3`, commit `671a5c8` (build file:
`MINECRAFT_VERSION = 26.3`, `MOD_VERSION = 1.11.6`).

| # | Claim | Result | Evidence |
|---|---|---|---|
| 1 | Current target is Minecraft 26.3 with Iris 1.11.6 | **Verified** (as of 2026-10-16) | Iris `build.gradle.kts` |
| 2 | Iris needs Minecraft's OpenGL backend | Verified | Iris has a separate Vulkan-only stub (`IrisVKOnly.java`) that registers only the screen key |
| 3 | `#version 330 compatibility` goes down Iris's compatibility→core path; `#version 330` with no profile would be treated as core | **Verified** | `TransformPatcher.java` (profile == CORE or version ≥ 150 with no profile → core path) |
| 4 | A missing `#version` is a hard error | Verified | `TransformPatcher.parseTranslationUnit` |
| 5 | Environment macros (`MC_OS_*`, `MC_GL_VENDOR_*`, `MC_GL_RENDERER_*`, `IS_IRIS`, `IRIS_INLINE_GLINT`, `IRIS_FEATURE_*`) have an empty value | **Verified** | `StandardMacros.java`, `ShaderPack.java` |
| 6 | Apple GPUs report `MC_GL_VENDOR_OTHER` (no Apple vendor case) and `MC_GL_RENDERER_APPLE` | Verified (source) | `StandardMacros.getVendor/getRenderer` |
| 7 | Reversed-Z on 26.x is hidden: depth reads become `1 - x`, including through `sampler2D` function parameters; `gbufferProjection` is un-reversed | **Verified** | `DepthTransformer.java`, `MixinLevelRenderer` (`undoRevZ`) |
| 8 | colortex0–3 can't be sampled from gbuffers; colortex4+ can | **Verified** | `IrisSamplers.addRenderTargetSamplers` (`startIndex = isFullscreenPass ? 0 : 4`) |
| 9 | With `SEPARATE_HARDWARE_SAMPLERS` listed, `shadowtex0/1` are raw depth and `shadowtex0HW/1HW` the compare samplers (when hardware filtering is on) | **Verified** | `IrisSamplers.addShadowSamplers`, `ShaderPack` active features |
| 10 | `IRIS_FEATURE_<flag>` reaches GLSL only for flags listed in `iris.features.optional`; shaders.properties sees all usable flags | Verified | `ShaderPack.java` |
| 11 | Inline glint: Iris injects `mc_hasGlint()`/`mc_sampleGlint()` prototypes into every shader, with stubs where there's no glint | **Verified** | `GlintTransformer.java` |
| 12 | The automatic alpha test is injected only for `gl_FragData[0]` | **Verified** | `CommonTransformer.transform` (so cutout programs test `alphaTestRef` themselves) |
| 13 | Comment directives: the **last** `RENDERTARGETS:`/`DRAWBUFFERS:` occurrence wins and must follow `/*` | **Verified** | `CommentDirectiveParser.findDirective` (lastIndexOf) |
| 14 | Directives are read from the preprocessed source with comments kept, so conditional `RENDERTARGETS` work | **Verified** | `ShaderPack` source provider (`JcppProcessor`, `Feature.KEEPCOMMENTS`) |
| 15 | Pack-wide const directives are read from the fragment sources of the programs that are present (final included) | **Verified** | `ProgramSet.locateDirectives` |
| 16 | An empty `/* DRAWBUFFERS: */` gives a depth-only shadow framebuffer; an empty `RENDERTARGETS:` would throw | **Verified** | `ProgramDirectives.parseDigits/parseDigitList`, `ShadowRenderTargets.createShadowFramebuffer` |
| 17 | Without a draw-buffer directive, shadow programs allocate shadowcolor0 and 1 | Verified | `ShaderCreator` (`hasUnknownDrawBuffers ? {0,1}`) |
| 18 | `program.world0/<name>.enabled` matches the world-folder program path; expressions support `! && \|\| ()`; they see option values only | **Verified** | `ShaderPack` source provider (`programString`), `BooleanParser` |
| 19 | world0 is the wildcard for unmapped dimensions when `dimension.properties` is absent | Verified | `ShaderPack` (`dimensionMap` `*:*`) |
| 20 | Boolean options must be named by `#ifdef`/`#ifndef` (not `#if defined`) in the same logical file; internal value-less `#define`s would become options | **Verified** | `OptionAnnotatedSource` |
| 21 | Profiles accept `name:value`, `name=value`, `!bool`, `bool` | Verified | `ProfileSet.parse` |
| 22 | Composite quad is 0..1 with `gl_ProjectionMatrix` mapping it to −1..1; pass viewport = target size; all targets of a pass must be the same size | **Verified** | `FullScreenQuadRenderer`, `CompositeTransformer`, `CompositeRenderer` ("Pass widths must match") |
| 23 | `size.buffer` sizes are `(int)(window × fraction)` | Verified | `TextureScaleOverride` |
| 24 | Frame order: clear → begin → shadow → prepare → opaque → depthtex2 copy → hand → depthtex1 copy → deferred → translucents → composite → final | **Verified** | `IrisRenderingPipeline` |
| 25 | Translucent gbuffers see buffers as left by deferred (flip state after translucent) | Verified | `IrisRenderingPipeline` (`flippedAfterTranslucent`) |
| 26 | Default clear colours: colortex0 = fog colour, colortex1 = white, others = 0; unreferenced targets aren't cleared | Verified | `ClearPassCreator` (Kestrel sets explicit clear colours) |
| 27 | `particles.ordering` (and `separateEntityDraws`) are parsed and stored but never applied in Iris 1.11.6; vanilla's render order decides where particles draw | **Corrected** | `ShaderProperties` parses it, nothing calls `getParticleRenderingSettings()`; `MixinParticleEngine` only sets the phase. Kestrel tags opaque particles `MAT_FORWARD` so either order works |
| 28 | Lightmap texture matrix: scale 1/256, offset 1/32, so `(lm − 1/32)·16/15` maps to 0..1 | **Verified** | `BuiltinReplacementUniforms` |
| 29 | `mc_Entity.x` is the block.properties ID, −1 for unmapped blocks | Verified | `SodiumTransformer` (`int(mc_Entity >> 1u) - 1`) |
| 30 | `at_midBlock.xyz` = offset to block centre in 1/64 block (so `y < 0` marks top vertices); `.w` = emission (Iris 1.7+) | Verified | Iris docs `at_midBlock`, `CommonTransformer` |
| 31 | Shadow ortho near/far are −100.05 / 156 (256 blocks of depth) | **Verified** | `ShadowMatrices.NEAR/FAR`, `createOrthoMatrix` |
| 32 | `noisetex` is bound with a linear + repeat sampler (so no `.mcmeta` is needed) | Verified | `IrisSamplers.addNoiseSampler` |
| 33 | Biome category and precipitation constants (`CAT_*`, `PPT_*`) are preprocessor defines usable in custom uniforms | Verified | `IrisDefines` |
| 34 | Keys: F3+R reloads; plain R only with Iris debug options; K toggles; I opens the shader screen; Ctrl+D on the shader screen toggles debug | **Verified** | `Iris.java`, `ShaderPackScreen` (Minecraft maps "control" to Cmd on macOS) |
| 35 | Iris documents macOS as deprecated and M1 as particularly problematic | Verified | Iris `docs/usage/drivers.md` |
| 36 | labPBR 1.3 channel layout (smoothness, F0 0–229 / metals 230–255, porosity 0–64 / SSS 65–255, emission 0–254) | **Verified** | labPBR wiki (`Specular-Texture-Details`, `Normal-Texture-Details`) |
| 37 | labPBR normal map orientation: `B = cross(T, N) · at_tangent.w` follows the texture's v axis (the convention labPBR packs are authored against) | **Verified** (source) | `NormalHelper.computeTangent`: w = sign(dot(bitangent, T × N)) |
| 38 | Mie absorption in the Hillaire reference | **Corrected**: the reference gives Mie *extinction* 4.40e-6/m (absorption = 0.444e-6), not absorption 4.40e-6 | sebh/UnrealEngineSkyAtmosphere constants |
| 39 | GLSL 4.00 built-ins (`fma`, `textureGather`, `bitfield*`, `findMSB`, `packUnorm*`) fail at `#version 330` | Verified | glslangValidator 15.1 |
| 40 | `separateAo` works only with the shadow pass on | Not relied on (see DECISIONS.md) | Iris docs |
| 41 | Iris installer, retiNO / ResolutionControl+ / Sodium Extra support for 26.3 | **Unverified** | README phrases these as "if it supports your version" |
| 42 | PresentMon / CapFrameX capture OpenGL presents; `MTL_HUD_ENABLED` for OpenGL apps on Apple Silicon | **Unverified** | TESTING.md marks them as such |
| 43 | `smooth()` half-life units (docs: ticks, source: ×0.1 s) | Unresolved, harmless | Iris `SmoothFloat`; biome fades take a few seconds either way |
| 44 | Sodium terrain normals are computed from each quad's vertex order, so the reversed copy of a water top (drawn for viewing from below) has a downward normal | **Verified** | `XHFPTerrainVertex.write` → `NormalHelper.computeFaceNormalManual` |
| 45 | `depthtex2` (depth before the hand) is copied every frame, before the solid hand and before `deferred` | **Verified** | `MixinLevelRenderer` (`beginHand` runs unconditionally before `renderSolid`) |
| 46 | colortex samplers filter linearly; depth samplers are NEAREST | **Verified** | `RenderTarget`, `IrisSamplers.addWorldDepthSamplers` |
| 47 | Vanilla blends every draw buffer with one mode; `blend.<program>` overrides the whole program, `blend.<program>.colortexN` one buffer. Per-buffer overrides need OpenGL 4.0 or `ARB_draw_buffers_blend`, else Iris throws while parsing `shaders.properties` | **Verified** | `MixinGlRenderPipeline`, `IrisRenderSystem.supportsBufferBlending`, `ShaderProperties` (`blend.` handler), `ShaderCreator` (ignores buffers a program doesn't draw) |
| 48 | `shaders.properties` is preprocessed with the standard macros, so `#if MC_GL_VERSION >= 400` works there | **Verified** | `ShaderPack` (environment defines passed to `ShaderProperties`), `StandardMacros` |
| 49 | Players use `entityTranslucent`, which goes to `gbuffers_entities_translucent`; during the solid hand, translucent entity and item draws go to `gbuffers_hand` | **Verified** | `IrisPipelines`, `ShaderKey` |
| 50 | `TRANSLUCENT_PARTICLE` always uses `gbuffers_particles_translucent` (falling back to `gbuffers_particles`) | **Verified** | `IrisPipelines`, `ProgramId.ParticlesTrans` |
| 51 | Iris fills a missing labPBR `_s` texture with 0 in every channel (and `_n` with flat 0x7F7FFF, AO 1) | **Verified** | `PBRType` default values |
| 52 | The `drynessHalflife` directive overwrites the wetness half-life; the drying half-life is fixed at 200 s | **Verified** (Iris bug) | `PackDirectives` |
| 53 | Shadowcolor0 is always allocated and cleared each frame unless `shadowcolor0Clear = false` | **Verified** | `ShadowRenderTargets`, `PackShadowDirectives`, `ClearPassCreator` |
| 54 | `lightningBoltPosition`: xyz relative to the camera, w = 1 while a bolt entity exists; `darknessLightFactor` and `screenBrightness` (the Brightness option) are provided | **Verified** | `IrisExclusiveUniforms`, `CommonUniforms` |
| 55 | Minecraft's projection far plane is about 4× the render distance, so linear depth must come from the projection matrix, not `near`/`far` | Verified (math review) | the harness now uses a 4× far plane |

## Compile and runtime checks

- glslangValidator 15.1: 11,466 program pairs (vertex + fragment, linked) across 4 profiles
  × 3 worlds × 5 vendor macro sets (macOS, Intel, AMD, NVIDIA, and an OpenGL 3.3-only driver
  without per-buffer blending), plus a one-option-at-a-time sweep. All pass.
- Mesa 25.2 llvmpipe (OpenGL 4.5 core, through the harness's compatibility→core rewrite):
  every world0, world-1 and world1 program used by the harness compiles and links. Rendered
  frames are finite (no NaN/Inf) for all profiles, day, sunset, night, rain, underwater
  (MEDIUM and HIGH), an underground fog setup, Nether and End, with render scale 0.5 / 0.75 /
  1.0 and a moving camera.
- `tools/check_pack.py`: all rules pass. The maximum per-program sampler count is 9 on the
  macOS set (10 with a labPBR pack) and 11 on HIGH with hardware samplers and labPBR.
- Three independent code reviews (rendering math, Iris 26.3 semantics and macOS, gameplay
  edge cases) were run against the source; their findings are fixed (see DECISIONS.md and
  CHANGELOG.md) or listed in KNOWN_ISSUES.md.
