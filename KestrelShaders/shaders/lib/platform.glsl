// Kestrel Shaders - platform detection, vendor workarounds and effective feature macros.
// Iris defines its environment macros (MC_OS_*, MC_GL_VENDOR_*, MC_GL_RENDERER_*, IS_IRIS,
// IRIS_INLINE_GLINT, IRIS_FEATURE_*) with an empty value, so they are only ever tested with
// #ifdef or defined(). Every internal macro here carries a value so the option scanner
// ignores it.

#if defined(MC_OS_MAC) || defined(MC_GL_RENDERER_APPLE)
	#define KS_MAC 1
#endif
#if defined(MC_GL_VENDOR_AMD) || defined(MC_GL_VENDOR_ATI)
	#define KS_AMD 1
#endif
#if defined(MC_GL_VENDOR_INTEL) || defined(MC_GL_RENDERER_INTEL)
	#define KS_INTEL 1
#endif

// Raymarch bound: AMD's OpenGL driver has crashed on long loops in shader packs.
#ifdef KS_AMD
	#define KS_LOOP_CAP KS_MAX_AMD_STEPS
#else
	#define KS_LOOP_CAP KS_MAX_RAY_STEPS
#endif

// Dimension fallback: a stub always defines one of these; default to the Overworld.
#if !defined(DIM_OVERWORLD) && !defined(DIM_NETHER) && !defined(DIM_END)
	#define DIM_OVERWORLD 1
#endif

// ---------------------------------------------------------------- Effective feature macros
// Options are pack-wide; these macros combine them with the dimension so every writer and
// reader of a buffer agrees on whether it exists.
#if defined(SHADOWS) && defined(DIM_OVERWORLD)
	#define KS_SHADOWS_ACTIVE 1
#endif
#ifdef DIM_OVERWORLD
	#define KS_SKY_LUT 1
#endif
#if defined(VOLUMETRIC_LIGHT) && defined(DIM_OVERWORLD)
	#define KS_VL_ACTIVE 1
#endif
#if defined(TAA) || defined(FXAA) || defined(AUTO_EXPOSURE)
	#define KS_RESOLVE_PASS 1
#endif
#if defined(TAA)
	#define KS_TAA_ACTIVE 1
#elif defined(FXAA)
	#define KS_FXAA_ACTIVE 1
#endif
#if defined(WATER_ADVANCED) && !defined(DIM_NETHER)
	#define KS_WATER_ADVANCED 1
#endif
// Deferred environment specular: opaque programs write colortex3 and skip forward reflections.
#ifdef SSR_OPAQUE
	#define KS_DEFERRED_SPEC 1
#endif
#if defined(KS_DEFERRED_SPEC) && defined(KS_RESOLVE_PASS)
	#define KS_SSR_OPAQUE_ACTIVE 1
#endif
// Opaque G-buffer data (colortex1 and colortex2) for AO, TAA, deferred specular and debug views.
#if defined(SSAO) || defined(TAA) || defined(KS_DEFERRED_SPEC) || DEBUG_VIEW > 0
	#define KS_GBUFFER_DATA 1
#endif
#if defined(CLOUD_SHADOWS) && defined(DIM_OVERWORLD)
	#define KS_CLOUD_SHADOWS 1
#endif
#if defined(PUDDLES) && defined(WETNESS) && defined(KS_DEFERRED_SPEC) && defined(DIM_OVERWORLD)
	#define KS_PUDDLES 1
#endif
#if defined(CAUSTICS) && !defined(DIM_NETHER)
	#define KS_CAUSTICS 1
#endif
#if defined(IRIS_FEATURE_SEPARATE_HARDWARE_SAMPLERS)
	#define KS_HW_SAMPLERS 1
#endif

// ---------------------------------------------------------------- Mac cost clamps
// Options are never redefined; these effective values clamp the heaviest settings on Apple GPUs
// unless the player opts in with MAC_ALLOW_HEAVY.
#if defined(KS_MAC) && !defined(MAC_ALLOW_HEAVY)
	#define KS_MAC_CLAMP 1
#endif

#if defined(KS_MAC_CLAMP) && SHADOW_FILTER > 2
	#define KS_SHADOW_FILTER 2
#else
	#define KS_SHADOW_FILTER SHADOW_FILTER
#endif
// PCSS needs raw depth from the separate-sampler feature; without it, use the 8-tap filter.
#if KS_SHADOW_FILTER == 3 && !defined(KS_HW_SAMPLERS)
	#undef KS_SHADOW_FILTER
	#define KS_SHADOW_FILTER 2
#endif

#if defined(KS_MAC_CLAMP) && SSR_STEPS > 16
	#define KS_SSR_STEPS 16
#else
	#define KS_SSR_STEPS SSR_STEPS
#endif

#if defined(KS_MAC_CLAMP) && VL_STEPS > 10
	#define KS_VL_STEPS 10
#else
	#define KS_VL_STEPS VL_STEPS
#endif

#if defined(KS_MAC_CLAMP) && AO_QUALITY > 2
	#define KS_AO_QUALITY 2
#else
	#define KS_AO_QUALITY AO_QUALITY
#endif

#if defined(COLORED_SHADOWS) && defined(KS_SHADOWS_ACTIVE)
	#define KS_COLORED_SHADOWS 1
#endif
