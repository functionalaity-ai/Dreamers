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
| 15 | Pack-wide const directives come only from the fragment sources of shadowcomp, begin, prepare, gbuffers, deferred and composite programs that are present | **Verified** | `ProgramSet.locateDirectives` |
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
| 27 | Particles render after deferred by default when a deferred program exists | Verified | `IrisRenderingPipeline` (Kestrel also sets `particles.ordering = after`) |
| 28 | Lightmap texture matrix: scale 1/256, offset 1/32, so `(lm − 1/32)·16/15` maps to 0..1 | **Verified** | `BuiltinReplacementUniforms` |
| 29 | `mc_Entity.x` is the block.properties ID, −1 for unmapped blocks | Verified | `SodiumTransformer` (`int(mc_Entity >> 1u) - 1`) |
| 30 | `at_midBlock.xyz` = offset to block centre in 1/64 block (so `y < 0` marks top vertices); `.w` = emission (Iris 1.7+) | Verified | Iris docs `at_midBlock`, `CommonTransformer` |
| 31 | Shadow ortho near/far are −100.05 / 156 (256 blocks of depth) | **Verified** | `ShadowMatrices.NEAR/FAR`, `createOrthoMatrix` |
| 32 | `noisetex` is bound with a linear + repeat sampler (so no `.mcmeta` is needed) | Verified | `IrisSamplers.addNoiseSampler` |
| 33 | Biome category and precipitation constants (`CAT_*`, `PPT_*`) are preprocessor defines usable in custom uniforms | Verified | `IrisDefines` |
| 34 | Keys: F3+R reloads; plain R only with Iris debug options; K toggles; I opens the shader screen; Ctrl+D on the shader screen toggles debug | **Verified** | `Iris.java`, `ShaderPackScreen` (Minecraft maps "control" to Cmd on macOS) |
| 35 | Iris documents macOS as deprecated and M1 as particularly problematic | Verified | Iris `docs/usage/drivers.md` |
| 36 | labPBR 1.3 channel layout (smoothness, F0 0–229 / metals 230–255, porosity 0–64 / SSS 65–255, emission 0–254) | **Verified** | labPBR wiki (`Specular-Texture-Details`, `Normal-Texture-Details`) |
| 37 | labPBR normal map Y orientation | **Unverified**: the wiki doesn't specify it; implemented as `B = cross(N, T)·w`. Test with a known labPBR pack. | |
| 38 | Mie absorption in the Hillaire reference | **Corrected**: the reference gives Mie *extinction* 4.40e-6/m (absorption = 0.444e-6), not absorption 4.40e-6 | sebh/UnrealEngineSkyAtmosphere constants |
| 39 | GLSL 4.00 built-ins (`fma`, `textureGather`, `bitfield*`, `findMSB`, `packUnorm*`) fail at `#version 330` | Verified | glslangValidator 15.1 |
| 40 | `separateAo` works only with the shadow pass on | Not relied on (see DECISIONS.md) | Iris docs |
| 41 | Iris installer, retiNO / ResolutionControl+ / Sodium Extra support for 26.3 | **Unverified** | README phrases these as "if it supports your version" |
| 42 | PresentMon / CapFrameX capture OpenGL presents; `MTL_HUD_ENABLED` for OpenGL apps on Apple Silicon | **Unverified** | TESTING.md marks them as such |
| 43 | `smooth()` half-life units (docs: ticks, source: ×0.1 s) | Unresolved, harmless | Iris `SmoothFloat`; biome fades take a few seconds either way |

## Compile and runtime checks

- glslangValidator 15.1: 10,736 program pairs (vertex + fragment, linked) across 4 profiles
  × 3 worlds × 4 vendor macro sets, plus a one-option-at-a-time sweep. All pass.
- Mesa 25.2 llvmpipe (OpenGL 4.5 core, through the harness's compatibility→core rewrite):
  every world0, world-1 and world1 program used by the harness compiles and links. Rendered
  frames are finite (no NaN/Inf) for all profiles, day, sunset, night, rain, Nether and End,
  with render scale 0.5 / 0.75 / 1.0 and a moving camera.
- `tools/check_pack.py`: all rules pass. The maximum per-program sampler count is 9 (10 with
  a labPBR pack).
