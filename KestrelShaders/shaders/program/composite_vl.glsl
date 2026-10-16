// Kestrel Shaders - composite (world0): light shafts at half resolution into colortex6
// (rgb = in-scattered radiance, a = transmittance). Enabled by VOLUMETRIC_LIGHT.
// Program: PROGRAM_COMPOSITE.

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
#include "/lib/atmosphere.glsl"
#include "/lib/sky.glsl"
#include "/lib/shadows.glsl"
#include "/lib/volumetrics.glsl"

uniform sampler2D depthtex0;

/* RENDERTARGETS: 6 */
layout(location = 0) out vec4 outVL;

void main() {
	vec4 result = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef KS_VL_ACTIVE
	vec2 halfSize = max(floor(viewSize() * 0.5), vec2(1.0));
	vec2 bufUV = gl_FragCoord.xy / halfSize;
	vec2 sceneUV = bufToSceneUV(bufUV);
	float depth = texture(depthtex0, bufUV).r;
	float noise = ignTemporal(gl_FragCoord.xy);
	#ifdef KS_VL_SHADOWMAP
	vec3 viewPos = screenToView(sceneUV, min(depth, 0.99999));
	vec3 playerEnd = viewToPlayer(viewPos);
	if (depth >= 1.0) playerEnd = normalize(playerEnd) * shadowDistance;
	result = marchLightShafts(playerEnd, noise);
	#else
	result = vec4(screenSpaceShafts(depthtex0, sceneUV, noise), 1.0);
	#endif
#endif
	outVL = vec4(sanitizeHDR(result.rgb), clamp01(result.a));
}
#endif
