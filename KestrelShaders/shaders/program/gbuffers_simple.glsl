// Kestrel Shaders - simple forward-lit gbuffers: lines and leads (basic), particles and misc
// textured geometry, the block-crack overlay and rain/snow. They light and fog themselves.
// Opaque particles also tag colortex1 with MAT_FORWARD: vanilla may draw them before the
// deferred passes, which then leave them alone instead of fogging them a second time.
// Programs: PROGRAM_BASIC, PROGRAM_TEXTURED, PROGRAM_TEXTURED_LIT, PROGRAM_PARTICLES,
//           PROGRAM_PARTICLES_TRANSLUCENT, PROGRAM_DAMAGEDBLOCK, PROGRAM_WEATHER.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"

#if defined(PROGRAM_PARTICLES) && defined(KS_BUFFER_BLEND)
	#define KS_WRITE_MATERIAL 1
#endif
#if defined(PROGRAM_PARTICLES) || defined(PROGRAM_PARTICLES_TRANSLUCENT)
	#define KS_IS_PARTICLE 1
#endif

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
#ifdef KS_WRITE_MATERIAL
#include "/lib/material.glsl"
#endif

#ifndef PROGRAM_BASIC
uniform sampler2D gtexture;
#endif

in vec2 vTexcoord;
in vec2 vLmcoord;
in vec4 vColor;
in vec3 vViewPos;

#ifdef KS_WRITE_MATERIAL
/* RENDERTARGETS: 0,1 */
#else
/* RENDERTARGETS: 0 */
#endif
layout(location = 0) out vec4 outColor;
#ifdef KS_WRITE_MATERIAL
layout(location = 1) out vec4 outData;
#endif

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
	vec3 E = lightE * sunVis * 0.6 + Esky + blockIrradiance(lm.x) + heldLightIrradiance(vViewPos, vec3(0.0, 0.0, 1.0)) + vec3(minAmbientE());
	vec3 color = albedo * RCP_PI * E * darknessLightScale();

#ifdef PROGRAM_WEATHER
	// Rain streaks are faint and catch the sky light; snow is brighter and opaque-ish.
	color = albedo * RCP_PI * (Esky * 0.9 + lightE * sunVis * 0.25 + blockIrradiance(lm.x));
	baseColor.a *= 0.55;
#endif

#if defined(KS_IS_PARTICLE) || defined(PROGRAM_TEXTURED_LIT) || defined(PROGRAM_TEXTURED)
	// Flames, lava drips and similar full-bright particles glow.
	float glow = smoothstep(0.93, 1.0, lm.x) * smoothstep(0.35, 0.8, maxOf(albedo));
	color += albedo * glow * 1.2;
#endif

	color = applyAtmosphere(color, playerPos, false);
	outColor = vec4(sanitizeHDR(color), baseColor.a);
#ifdef KS_WRITE_MATERIAL
	outData = vec4(lm, encodeMaterial(MAT_FORWARD), 0.0);
#endif
}
#endif
