// Kestrel Shaders - non-sampler uniforms (names and types from the Iris 26.3 source).
// Samplers are declared by each program body, only where used, because Iris allocates
// buffers and enables the shadow pass based on which samplers a program references.

uniform mat4 gbufferModelView;
uniform mat4 gbufferModelViewInverse;
uniform mat4 gbufferProjection;
uniform mat4 gbufferProjectionInverse;
uniform mat4 gbufferPreviousModelView;
uniform mat4 gbufferPreviousProjection;
uniform mat4 shadowModelView;
uniform mat4 shadowModelViewInverse;
uniform mat4 shadowProjection;
uniform mat4 shadowProjectionInverse;

uniform vec3 cameraPosition;
uniform vec3 previousCameraPosition;
#ifdef IS_IRIS
uniform ivec3 cameraPositionInt;
uniform vec3 cameraPositionFract;
uniform ivec3 previousCameraPositionInt;
uniform vec3 previousCameraPositionFract;
#endif

uniform vec3 sunPosition;
uniform vec3 moonPosition;
uniform vec3 shadowLightPosition;
uniform vec3 upPosition;
uniform float sunAngle;

uniform float viewWidth;
uniform float viewHeight;
uniform float aspectRatio;
uniform float near;
uniform float far;

uniform int frameCounter;
uniform float frameTime;
uniform float frameTimeCounter;
uniform int worldTime;
uniform int worldDay;
uniform int moonPhase;

uniform float rainStrength;
uniform float wetness;
uniform float thunderStrength;
uniform int isEyeInWater;
uniform ivec2 eyeBrightnessSmooth;
uniform float eyeAltitude;
uniform float nightVision;
uniform float blindness;
uniform float darknessFactor;
uniform float darknessLightFactor;
uniform float screenBrightness;

uniform vec3 fogColor;
uniform vec3 skyColor;

uniform int heldBlockLightValue;
uniform int heldBlockLightValue2;

uniform int renderStage;
uniform float alphaTestRef;

#ifdef IS_IRIS
uniform bool hasSkylight;
uniform float cloudHeight;
uniform float cloudTime;
uniform float endFlashIntensity;
uniform vec4 lightningBoltPosition;
#endif

// Custom uniforms computed on the CPU in shaders.properties (0.0 when unsupported).
uniform float ksBiomeSwamp;
uniform float ksBiomeDesert;
uniform float ksBiomeSnowy;
uniform float ksBiomeJungle;
