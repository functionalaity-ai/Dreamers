// Kestrel Shaders - deferred: screen-space ambient occlusion at half resolution into
// colortex6 (r = AO, g = linear depth for the bilateral upsample in deferred2).
// Enabled by SSAO. Program: PROGRAM_DEFERRED.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"

// ============================================================================ vertex
#ifdef STAGE_VERTEX
void main() {
	gl_Position = fullscreenPosition(gl_Vertex.xy, renderScale());
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#include "/lib/noise.glsl"
#include "/lib/material.glsl"
#include "/lib/ao.glsl"

uniform sampler2D depthtex0;
// Occluders come from the depth before the hand was drawn, so the held item casts no AO.
uniform sampler2D depthtex2;
uniform sampler2D colortex1;
uniform sampler2D colortex2;

/* RENDERTARGETS: 6 */
layout(location = 0) out vec4 outAO;

void main() {
	// Each half-resolution texel stands for one full-resolution pixel. texelFetch keeps the
	// material code and normal exact (colortex samplers filter linearly).
	ivec2 fp = ivec2(gl_FragCoord.xy) * 2 + 1;
	vec2 bufUV = (vec2(fp) + 0.5) * viewTexel();
	vec2 sceneUV = bufToSceneUV(bufUV);
	float depth = texelFetch(depthtex0, fp, 0).r;
	if (depth >= 1.0) {
		outAO = vec4(1.0, 1e4, 0.0, 1.0);
		return;
	}
	int code = decodeMaterial(texelFetch(colortex1, fp, 0).b);
	vec3 viewPos = screenToView(sceneUV, depth);
	float linZ = -viewPos.z;
	if (code == MAT_NONE || code == MAT_HAND || code == MAT_FORWARD) {
		outAO = vec4(1.0, linZ, 0.0, 1.0);
		return;
	}
	vec3 n = decodeNormal(texelFetch(colortex2, fp, 0).rg);
	float noise = ignTemporal(gl_FragCoord.xy);
	float noise2 = blueNoise(gl_FragCoord.xy);
#if KS_AO_QUALITY >= 2
	float ao = computeGTAO(depthtex2, viewPos, n, sceneUV, noise, noise2);
#else
	float ao = computeSSAO(depthtex2, viewPos, n, noise, noise2);
#endif
	// Foliage is thin and lets light through: soften its occlusion.
	if (code == MAT_FOLIAGE) ao = mix(ao, 1.0, 0.4);
	outAO = vec4(ao, linZ, 0.0, 1.0);
}
#endif
