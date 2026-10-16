// Kestrel Shaders - composite3: bloom tile atlas at half resolution into colortex6.
// Source: the resolved image (colortex5) with mipmaps, or colortex0 when no resolve pass
// runs (POTATO). Enabled by BLOOM. Program: PROGRAM_COMPOSITE3.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"
#include "/lib/bloom.glsl"

// ============================================================================ vertex
#ifdef STAGE_VERTEX
void main() {
	gl_Position = vec4(gl_Vertex.xy * 2.0 - 1.0, 0.0, 1.0);
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#ifdef KS_RESOLVE_PASS
uniform sampler2D colortex5;
const bool colortex5MipmapEnabled = true;
	#define KS_BLOOM_SOURCE colortex5
#else
uniform sampler2D colortex0;
const bool colortex0MipmapEnabled = true;
	#define KS_BLOOM_SOURCE colortex0
#endif

/* RENDERTARGETS: 6 */
layout(location = 0) out vec4 outBloom;

void main() {
	vec2 bufSize = bloomBufferSize();
	vec2 c = gl_FragCoord.xy / bufSize;
	vec3 result = vec3(0.0);
	for (int i = 0; i < 6; i++) {
		if (i >= BLOOM_LEVELS) break;
		vec4 r = bloomTileRect(i, bufSize);
		if (all(greaterThanEqual(c, r.xy)) && all(lessThan(c, r.xy + r.zw))) {
			vec2 local = (c - r.xy) / r.zw;
			result = bloomTent(KS_BLOOM_SOURCE, local, float(i + 2), i == 0);
			break;
		}
	}
	outBloom = vec4(sanitizeHDR(result), 1.0);
}
#endif
