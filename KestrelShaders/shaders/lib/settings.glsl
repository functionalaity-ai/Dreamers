// Kestrel Shaders - every user option lives in this file, defined exactly once.
// Iris/OptiFine read these lines to build the in-game menu:
//   #define NAME            boolean option, default on
//   //#define NAME          boolean option, default off
//   #define NAME v // [..]  value option, the list holds the allowed values
// Internal macros elsewhere in the pack always carry a value and no comment so the
// option scanner never mistakes them for options.
// The code defaults below are identical to the LOW profile.

// ---------------------------------------------------------------- Shadows
#define SHADOWS // Sun and moon shadows from a shadow map
const int shadowMapResolution = 1024; // [512 768 1024 1536 2048 3072 4096]
const float shadowDistance = 64.0; // [48.0 64.0 80.0 96.0 112.0 128.0 160.0 192.0]
#define SHADOW_FILTER 1 // [0 1 2 3]
//#define COLORED_SHADOWS // Stained glass tints the sunlight that passes through it
//#define ENTITY_SHADOWS // Mobs, players and block entities cast shadows

// ---------------------------------------------------------------- Ambient occlusion
#define SSAO // Screen-space ambient occlusion at half resolution
#define AO_QUALITY 1 // [1 2 3]
const float ambientOcclusionLevel = 0.75; // [0.0 0.25 0.5 0.75 1.0]

// ---------------------------------------------------------------- Volumetric light
#define VOLUMETRIC_LIGHT // Light shafts through the air
#define VL_MODE 0 // [0 1]
#define VL_STEPS 12 // [6 8 10 12 16]

// ---------------------------------------------------------------- Clouds
#define CLOUD_LAYERS 2 // [1 2]
//#define CLOUD_SHADOWS // Clouds dim the sunlight on the ground

// ---------------------------------------------------------------- Water
#define WATER_ADVANCED // Refraction, depth absorption and screen-space reflections on water
#define WATER_WAVE_OCTAVES 3 // [2 3 4 5]
#define SSR_STEPS 10 // [8 10 12 16 24]
//#define SSR_OPAQUE // Screen-space reflections on puddles, metals and polished blocks
//#define CAUSTICS // Animated light patterns under water

// ---------------------------------------------------------------- Weather
#define WETNESS // Rain darkens and polishes surfaces
//#define PUDDLES // Rain forms reflective puddles on flat open ground

// ---------------------------------------------------------------- Materials
#define PBR_MODE 1 // [0 1]
#define HELD_LIGHT // A held torch or glowing item lights the area around you
#define WAVING_FOLIAGE // Grass, leaves and crops move in the wind
#define WAVING_WATER // Water surface moves with the waves
#define WIND_STRENGTH 1.0 // [0.0 0.25 0.5 0.75 1.0 1.25 1.5 2.0]
#define BLOCKLIGHT_TEMPERATURE 2900 // [2400 2700 2900 3200 3500]

// ---------------------------------------------------------------- Anti-aliasing and render scale
#define TAA // Temporal anti-aliasing (also enables render scale)
//#define FXAA // Fast approximate anti-aliasing, used only when TAA is off
#define RENDER_SCALE_MODE 1 // [0 1]
#define RENDER_SCALE 1.00 // [0.50 0.60 0.67 0.75 0.85 1.00]
#define AUTO_TARGET_HEIGHT 810 // [540 720 810 900 1080 1440]
#define CAS_STRENGTH 0.4 // [0.0 0.2 0.3 0.4 0.5 0.6 0.8]

// ---------------------------------------------------------------- Camera and colour
#define AUTO_EXPOSURE // Eye adaptation from the average scene brightness
#define EXPOSURE_BIAS 0.0 // [-2.0 -1.5 -1.0 -0.5 0.0 0.5 1.0 1.5 2.0]
#define TONEMAP 0 // [0 1 2]
#define SATURATION 1.00 // [0.60 0.70 0.80 0.90 1.00 1.10 1.20 1.30 1.40]
#define CONTRAST 1.00 // [0.80 0.90 1.00 1.10 1.20]
#define WHITE_BALANCE_K 6500 // [5000 5500 6000 6500 7000 7500 8000]
#define VIGNETTE 0.20 // [0.00 0.10 0.20 0.30 0.40 0.50]
#define FILM_GRAIN 0.00 // [0.00 0.01 0.02 0.03]
#define BLOOM // Glow around bright light sources
#define BLOOM_LEVELS 5 // [4 5 6]
#define BLOOM_STRENGTH 0.04 // [0.01 0.02 0.03 0.04 0.06 0.08 0.10]
#define PURKINJE // Night vision shift towards blue in dim moonlight
#define PURKINJE_STRENGTH 0.6 // [0.0 0.2 0.4 0.6 0.8 1.0]

// ---------------------------------------------------------------- Atmosphere
#define ATMOSPHERE_STEPS 12 // [8 12 16]
#define ATMOSPHERE_DENSITY 1.0 // [0.5 0.75 1.0 1.25 1.5 2.0]
#define FOG_DENSITY 1.0 // [0.0 0.25 0.5 0.75 1.0 1.25 1.5 2.0 3.0]
const float sunPathRotation = -35.0; // [-45.0 -40.0 -35.0 -30.0 -25.0 -20.0 -15.0 -10.0 -5.0 0.0]

// ---------------------------------------------------------------- Advanced
//#define MAC_ALLOW_HEAVY // On Macs, allow the heaviest shadow, reflection and light-shaft settings
#define DEBUG_VIEW 0 // [0 1 2 3 4 5 6 7 8 9 10 11]

// Iris and OptiFine only list a boolean option when an #ifdef or #ifndef names it in
// the same program, so every boolean option is referenced once here.
#ifdef SHADOWS
#endif
#ifdef COLORED_SHADOWS
#endif
#ifdef ENTITY_SHADOWS
#endif
#ifdef SSAO
#endif
#ifdef VOLUMETRIC_LIGHT
#endif
#ifdef CLOUD_SHADOWS
#endif
#ifdef WATER_ADVANCED
#endif
#ifdef SSR_OPAQUE
#endif
#ifdef CAUSTICS
#endif
#ifdef WETNESS
#endif
#ifdef PUDDLES
#endif
#ifdef HELD_LIGHT
#endif
#ifdef WAVING_FOLIAGE
#endif
#ifdef WAVING_WATER
#endif
#ifdef TAA
#endif
#ifdef FXAA
#endif
#ifdef AUTO_EXPOSURE
#endif
#ifdef BLOOM
#endif
#ifdef PURKINJE
#endif
#ifdef MAC_ALLOW_HEAVY
#endif

// Fixed engineering constants (not options).
#define KS_SSR_MIN_SMOOTHNESS 0.70
#define KS_EV_MIN 5.0
#define KS_EV_MAX 16.5
#define KS_GLINT_GAIN 0.6
#define KS_MAX_RAY_STEPS 32
#define KS_MAX_AMD_STEPS 30
