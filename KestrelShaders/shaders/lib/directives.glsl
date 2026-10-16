// Kestrel Shaders - pack-wide buffer and shadow directives.
// Iris reads these lines from the fragment source of shadowcomp, begin, prepare, gbuffers,
// deferred and composite programs (never final or vertex shaders), after preprocessing with
// comments kept. Every world folder is its own program set, so this file is included by an
// always-enabled program in each folder (deferred2 and every opaque gbuffers program).
//
// Buffer plan (see docs/ARCHITECTURE.md):
//   colortex0  R11F_G11F_B10F  full     linear HDR scene
//   colortex1  RGBA8           full     blocklight, skylight, material code, ambient fraction
//   colortex2  RG16            full     octahedral view-space normal
//   colortex3  RGBA8           full     F0 (sRGB-encoded) + smoothness
//   colortex4  R11F_G11F_B10F  full     opaque scene copy for water refraction and SSR
//   colortex5  RGBA16F         full     resolved image (history); texel (0,0).a = EV100
//   colortex6  RGBA16F         half     reused: AO, then light shafts, then bloom atlas
//   colortex7  RGBA16F         192x112  sky-view LUT + per-frame light constants

/*
const int colortex0Format = R11F_G11F_B10F;
const int colortex1Format = RGBA8;
const int colortex2Format = RG16;
const int colortex3Format = RGBA8;
const int colortex4Format = R11F_G11F_B10F;
const int colortex5Format = RGBA16F;
const int colortex6Format = RGBA16F;
const int colortex7Format = RGBA16F;

const bool colortex0Clear = true;
const vec4 colortex0ClearColor = vec4(0.0, 0.0, 0.0, 0.0);
const bool colortex1Clear = true;
const vec4 colortex1ClearColor = vec4(0.0, 0.0, 0.0, 0.0);
const bool colortex2Clear = true;
const vec4 colortex2ClearColor = vec4(0.0, 0.0, 0.0, 0.0);
const bool colortex3Clear = true;
const vec4 colortex3ClearColor = vec4(0.0, 0.0, 0.0, 0.0);
const bool colortex4Clear = false;
const bool colortex5Clear = false;
const bool colortex6Clear = false;
const bool colortex7Clear = false;
*/

// Shadow and timing directives (real GLSL constants, also read by Iris).
const bool shadowHardwareFiltering = true;
const float shadowDistanceRenderMul = 1.0;
const float entityShadowDistanceMul = 0.25;
const bool shadowtex0Mipmap = false;
const bool shadowtex1Mipmap = false;
const bool shadowcolor0Mipmap = false;
const bool shadowcolor0Clear = true;
const vec4 shadowcolor0ClearColor = vec4(1.0, 1.0, 1.0, 0.0);
const int noiseTextureResolution = 256;
const float eyeBrightnessHalflife = 4.0;
const float wetnessHalflife = 300.0;
const float drynessHalflife = 200.0;
