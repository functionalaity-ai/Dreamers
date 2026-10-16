// Kestrel Shaders - simple lit gbuffers that write colortex0 only: lines and leads (basic),
// particles and misc textured geometry, the block-crack overlay and rain/snow.
// Programs: PROGRAM_BASIC, PROGRAM_TEXTURED, PROGRAM_TEXTURED_LIT, PROGRAM_PARTICLES,
//           PROGRAM_DAMAGEDBLOCK, PROGRAM_WEATHER.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"

// ============================================================================ vertex
#ifdef STAGE_VERTEX
out vec2 vTexcoord;
out vec2 vLmcoord;
out vec4 vColor;
out vec3 vViewPos;

void main() {
	vTexcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	vLmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
	vColor = gl_Color;
	vec4 viewPos = gl_ModelViewMatrix * gl_Vertex;
	vViewPos = viewPos.xyz;
	gl_Position = applyScaleAndJitter(gl_ProjectionMatrix * viewPos);
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#include "/lib/atmosphere.glsl"
#include "/lib/sky.glsl"
#include "/lib/lighting.glsl"
#include "/lib/fog.glsl"

#ifndef PROGRAM_BASIC
uniform sampler2D gtexture;
#endif

in vec2 vTexcoord;
in vec2 vLmcoord;
in vec4 vColor;
in vec3 vViewPos;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor;

void main() {
#ifdef PROGRAM_BASIC
	vec4 baseColor = vColor;
#else
	vec4 baseColor = texture(gtexture, vTexcoord) * vColor;
#endif

#ifdef PROGRAM_DAMAGEDBLOCK
	// Vanilla blends the crack overlay multiplicatively (dst*src*2): 0.5 is neutral, so the
	// display-space texture value passes through unchanged.
	if (baseColor.a < 0.1) discard;
	outColor = vec4(baseColor.rgb, baseColor.a);
	return;
#endif

#ifndef PROGRAM_BASIC
	if (baseColor.a < alphaTestRef) discard;
#endif
	if (baseColor.a < 0.004) discard;

	vec2 lm = clamp01((vLmcoord - 1.0 / 32.0) * (16.0 / 15.0));
	float sky = lm.y;
	vec3 albedo = srgbToLinear(baseColor.rgb);
	vec3 playerPos = viewToPlayer(vViewPos);

	// Camera-facing sprites: light them as if they faced up, with a lightmap-only shadow.
	vec3 lightE = lightIrradiance();
	float sunVis = fakeShadow(sky);
#ifdef KS_SKY_LUT
	sunVis *= skyLeakFactor(sky);
	vec3 Esky = skyIrradiance(vec3(0.0, 1.0, 0.0)) * skyLightCurve(sky);
#else
	vec3 Esky = skyIrradiance(vec3(0.0, 1.0, 0.0));
#endif
	vec3 E = lightE * sunVis * 0.6 + Esky + blockIrradiance(lm.x) + heldLightIrradiance(vViewPos, vec3(0.0, 0.0, 1.0)) + vec3(KS_MIN_AMBIENT_E + nightVision * KS_NIGHT_VISION_E);
	vec3 color = albedo * RCP_PI * E;

#ifdef PROGRAM_WEATHER
	// Rain streaks are faint and catch the sky light; snow is brighter and opaque-ish.
	color = albedo * RCP_PI * (Esky * 0.9 + lightE * sunVis * 0.25 + blockIrradiance(lm.x));
	baseColor.a *= 0.55;
#endif

#if defined(PROGRAM_PARTICLES) || defined(PROGRAM_TEXTURED_LIT) || defined(PROGRAM_TEXTURED)
	// Flames, lava drips and similar full-bright particles glow.
	float glow = smoothstep(0.93, 1.0, lm.x) * smoothstep(0.35, 0.8, maxOf(albedo));
	color += albedo * glow * 1.2;
#endif

	color = applyAtmosphere(color, playerPos, false);
	outColor = vec4(sanitizeHDR(color), baseColor.a);
}
#endif
