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
uniform sampler2D colortex1;
uniform sampler2D colortex2;

/* RENDERTARGETS: 6 */
layout(location = 0) out vec4 outAO;

void main() {
	vec2 halfSize = max(floor(viewSize() * 0.5), vec2(1.0));
	vec2 bufUV = gl_FragCoord.xy / halfSize;
	vec2 sceneUV = bufToSceneUV(bufUV);
	float depth = texture(depthtex0, bufUV).r;
	if (depth >= 1.0) {
		outAO = vec4(1.0, 1e4, 0.0, 1.0);
		return;
	}
	int code = decodeMaterial(texture(colortex1, bufUV).b);
	vec3 viewPos = screenToView(sceneUV, depth);
	float linZ = -viewPos.z;
	if (code == MAT_NONE || code == MAT_HAND) {
		outAO = vec4(1.0, linZ, 0.0, 1.0);
		return;
	}
	vec3 n = decodeNormal(texture(colortex2, bufUV).rg);
	float noise = ignTemporal(gl_FragCoord.xy);
	float noise2 = blueNoise(gl_FragCoord.xy);
#if KS_AO_QUALITY >= 2
	float ao = computeGTAO(depthtex0, viewPos, n, sceneUV, noise, noise2);
#else
	float ao = computeSSAO(depthtex0, viewPos, n, noise, noise2);
#endif
	// Foliage is thin and lets light through: soften its occlusion.
	if (code == MAT_FOLIAGE) ao = mix(ao, 1.0, 0.4);
	outAO = vec4(ao, linZ, 0.0, 1.0);
}
#endif
