// Kestrel Shaders - shadow map (world0 only, disabled with SHADOWS off).
// Same distortion and the same wind animation as the gbuffers so shadows match geometry.
// No TAA jitter and no render scale here. Program: PROGRAM_SHADOW.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"
#include "/lib/material.glsl"
#define KS_NO_SHADOW_SAMPLERS 1
#include "/lib/shadows.glsl"

// ============================================================================ vertex
#ifdef STAGE_VERTEX
#include "/lib/waving.glsl"

in vec4 mc_Entity;
in vec4 at_midBlock;

out vec2 vTexcoord;
out vec4 vColor;
flat out int vBlockId;

void main() {
	vTexcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	vColor = gl_Color;
	vBlockId = int(floor(mc_Entity.x + 0.5));
	vec4 shadowView = gl_ModelViewMatrix * gl_Vertex;
	if (isWavingId(vBlockId)) {
		// Animate in player space so the motion matches the gbuffers exactly.
		vec3 player = (shadowModelViewInverse * shadowView).xyz;
		vec3 world = worldPosWrapped(player);
		player += waveOffset(vBlockId, world, at_midBlock.y < 0.0);
		shadowView = shadowModelView * vec4(player, 1.0);
	} else if (vBlockId == ID_WATER) {
		vec3 player = (shadowModelViewInverse * shadowView).xyz;
		player.y += waterVertexWave(worldPosWrapped(player));
		shadowView = shadowModelView * vec4(player, 1.0);
	}
	vec4 clip = gl_ProjectionMatrix * shadowView;
	clip.xyz = distortShadowClip(clip.xyz);
	gl_Position = clip;
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#include "/lib/directives.glsl"

uniform sampler2D gtexture;

in vec2 vTexcoord;
in vec4 vColor;
flat in int vBlockId;

#ifdef KS_COLORED_SHADOWS
/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outShadowColor;
#else
/* DRAWBUFFERS: */
#endif

void main() {
	vec4 c = texture(gtexture, vTexcoord) * vColor;
	if (c.a < 0.1) discard;
#ifdef KS_COLORED_SHADOWS
	// Opaque casters write white (unused: shadowtex1 already blocks them); translucent
	// casters write their linear colour and opacity, read back as a tint.
	vec3 tint = srgbToLinear(c.rgb);
	if (vBlockId == ID_WATER) tint = srgbToLinear(vColor.rgb) * vec3(0.6, 0.85, 0.9);
	outShadowColor = vec4(tint, c.a);
#endif
}
#endif
