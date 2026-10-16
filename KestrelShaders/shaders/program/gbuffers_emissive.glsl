// Kestrel Shaders - self-lit gbuffers writing colortex0 only: glowing eyes (spidereyes),
// beacon beams, armour glint and lightning bolts / dragon death beams.
// Programs: PROGRAM_SPIDEREYES, PROGRAM_BEACONBEAM, PROGRAM_ARMOR_GLINT, PROGRAM_LIGHTNING.

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

void main() {
	vTexcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	vLmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
	vColor = gl_Color;
	gl_Position = applyScaleAndJitter(gl_ProjectionMatrix * (gl_ModelViewMatrix * gl_Vertex));
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#include "/lib/atmosphere.glsl"
#include "/lib/sky.glsl"
#include "/lib/lighting.glsl"

#ifndef PROGRAM_LIGHTNING
uniform sampler2D gtexture;
#endif

in vec2 vTexcoord;
in vec2 vLmcoord;
in vec4 vColor;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor;

void main() {
#ifdef PROGRAM_LIGHTNING
	// POSITION_COLOR geometry: no texture. A lightning channel is far brighter than the sky,
	// so it reads as a blinding flash and blooms even at daytime exposure.
	vec4 baseColor = vColor;
	vec3 color = srgbToLinear(baseColor.rgb) * 2000.0;
	outColor = vec4(sanitizeHDR(color), baseColor.a);
#else
	vec4 baseColor = texture(gtexture, vTexcoord) * vColor;
	if (baseColor.a < 0.004) discard;
	vec3 albedo = srgbToLinear(baseColor.rgb);
	vec3 color;
	#ifdef PROGRAM_ARMOR_GLINT
	// Additive glint, scaled to the local light so it reads the same by day and night.
	vec2 lm = clamp01((vLmcoord - 1.0 / 32.0) * (16.0 / 15.0));
		#ifdef KS_SKY_LUT
	vec3 E = skyIrradiance(vec3(0.0, 1.0, 0.0)) * skyLightCurve(lm.y) + lightIrradiance() * 0.15 * lm.y;
		#else
	vec3 E = skyIrradiance(vec3(0.0, 1.0, 0.0));
		#endif
	E += blockIrradiance(lm.x);
	color = albedo * KS_GLINT_GAIN * (luminance(E) + 0.02);
	#elif defined(PROGRAM_BEACONBEAM)
	color = albedo * 2.5;
	#else
	color = albedo * 1.2;
	#endif
	outColor = vec4(sanitizeHDR(color), baseColor.a);
#endif
}
#endif
