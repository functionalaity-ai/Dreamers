// Kestrel Shaders - composite1 (world0): depth-aware upsample of the half-resolution light
// shafts and application to the scene (after all translucents, so shafts also cover water).
// Enabled by VOLUMETRIC_LIGHT. Program: PROGRAM_COMPOSITE1.

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
uniform sampler2D colortex0;
uniform sampler2D colortex6;
uniform sampler2D depthtex0;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor;

void main() {
	vec2 bufUV = gl_FragCoord.xy * viewTexel();
	vec3 color = texture(colortex0, bufUV).rgb;
#ifdef KS_VL_ACTIVE
	float depth = texture(depthtex0, bufUV).r;
	float linZ = depth >= 1.0 ? far * 4.0 : linearizeDepth(depth);
	vec2 halfSize = max(floor(viewSize() * 0.5), vec2(1.0));
	// Half-resolution texel q holds full-resolution pixel 2q+1 (see composite_vl).
	vec2 p = (bufUV * viewSize() - 1.5) * 0.5;
	vec2 base = floor(p);
	vec2 f = p - base;
	ivec2 maxQ = max(ivec2(halfSize * renderScale()) - 1, ivec2(0));
	vec4 acc = vec4(0.0);
	float wsum = 0.0;
	for (int j = 0; j < 2; j++) {
		for (int i = 0; i < 2; i++) {
			ivec2 q = clamp(ivec2(base) + ivec2(i, j), ivec2(0), maxQ);
			vec4 v = texelFetch(colortex6, q, 0);
			float qd = texelFetch(depthtex0, q * 2 + 1, 0).r;
			float qz = qd >= 1.0 ? far * 4.0 : linearizeDepth(qd);
			float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
			float wd = exp(-abs(qz - linZ) / max(0.08 * linZ, 0.05));
			float w = wb * wd + 1e-5;
			acc += v * w;
			wsum += w;
		}
	}
	vec4 vl = acc / wsum;
	#if DEBUG_VIEW != 5 && DEBUG_VIEW != 6
	color = color * vl.a + vl.rgb;
	#endif
	#if DEBUG_VIEW == 7
	color = vl.rgb / (vl.rgb + 0.02);
	#endif
#endif
	outColor = vec4(sanitizeHDR(color), 1.0);
}
#endif
