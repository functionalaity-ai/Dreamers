// Kestrel Shaders - final: bloom combine, exposure, white balance, Purkinje shift, AgX
// tonemap, grade, sharpening, vignette, grain, sRGB encode and dither; plus debug views.
// Program: PROGRAM_FINAL.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"
#include "/lib/noise.glsl"
#include "/lib/atmosphere.glsl"
#include "/lib/sky.glsl"
#include "/lib/post.glsl"

#ifdef KS_RESOLVE_PASS
uniform sampler2D colortex5;
	#define KS_FINAL_SOURCE colortex5
#else
uniform sampler2D colortex0;
	#define KS_FINAL_SOURCE colortex0
#endif

// ============================================================================ vertex
#ifdef STAGE_VERTEX
flat out float vEV;

void main() {
	gl_Position = vec4(gl_Vertex.xy * 2.0 - 1.0, 0.0, 1.0);
#if defined(KS_RESOLVE_PASS) && defined(AUTO_EXPOSURE)
	float ev = texelFetch(colortex5, ivec2(0), 0).a;
	vEV = (ev > 0.0 && !isnan(ev)) ? ev : fallbackEV();
#else
	vEV = fallbackEV();
#endif
	vEV = clamp(vEV, KS_EV_MIN, KS_EV_MAX);
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#include "/lib/bloom.glsl"
#include "/lib/tonemap.glsl"
#include "/lib/material.glsl"

#ifdef BLOOM
uniform sampler2D colortex6;
#endif
#if DEBUG_VIEW >= 2 && DEBUG_VIEW <= 4
uniform sampler2D colortex1;
uniform sampler2D colortex2;
#endif

flat in float vEV;

layout(location = 0) out vec4 outColor;

vec3 debugPalette(int code) {
	if (code == 0) return vec3(1.0, 0.0, 1.0);
	float h = float(code) * 0.61803398875;
	return 0.5 + 0.5 * cos(TAU * (fract(h) + vec3(0.0, 0.33, 0.67)));
}

void main() {
	vec2 uv = gl_FragCoord.xy * viewTexel();
	vec2 texel = viewTexel();

#ifdef KS_TAA_ACTIVE
	vec3 hdr = casSharpen(KS_FINAL_SOURCE, uv, texel, float(CAS_STRENGTH));
#else
	vec3 hdr = texture(KS_FINAL_SOURCE, uv).rgb;
#endif
	hdr = sanitizeHDR(hdr);

#ifdef BLOOM
	vec3 bloom = vec3(0.0);
	for (int i = 0; i < 6; i++) {
		if (i >= BLOOM_LEVELS) break;
		bloom += bloomTileSample(colortex6, i, uv);
	}
	bloom /= float(BLOOM_LEVELS);
	hdr = mix(hdr, bloom, float(BLOOM_STRENGTH));
#endif

	float exposure = exposureFromEV(vEV);
	vec3 c = hdr * exposure;
	c = whiteBalance(c);
	c = purkinjeShift(c, vEV);
	c = tonemap(c);
	c = saturationContrast(c);
	c *= vignetteFactor(uv);
	c = filmGrain(c, gl_FragCoord.xy);

	// ---- Debug views (raw data, no grading).
#if DEBUG_VIEW == 2
	c = decodeNormal(texture(colortex2, uv * renderScale()).rg) * 0.5 + 0.5;
#elif DEBUG_VIEW == 3
	c = vec3(texture(colortex1, uv * renderScale()).rg, 0.0);
#elif DEBUG_VIEW == 4
	c = debugPalette(decodeMaterial(texture(colortex1, uv * renderScale()).b));
#elif DEBUG_VIEW >= 5 && DEBUG_VIEW <= 7
	c = clamp01(texture(KS_FINAL_SOURCE, uv).rgb);
#elif DEBUG_VIEW == 8 && defined(KS_SKY_LUT)
	c = tonemap(texture(colortex7, uv).rgb * exposure);
#elif DEBUG_VIEW == 9 && defined(BLOOM)
	c = tonemap(texture(colortex6, uv).rgb * exposure);
#elif DEBUG_VIEW == 10
	{
		// False-colour log luminance: blue = 4 EV under the exposure, red = 4 EV over.
		float l = log2(max(luminance(hdr * exposure), 1e-6) / 0.18);
		float t = clamp01(l / 8.0 + 0.5);
		c = clamp01(vec3(t * 2.0 - 1.0, 1.0 - abs(t * 2.0 - 1.0), 1.0 - t * 2.0));
	}
#elif DEBUG_VIEW == 11
	{
		vec3 raw = texture(KS_FINAL_SOURCE, uv).rgb;
		bool bad = any(isnan(raw)) || any(isinf(raw)) || maxOf(raw) >= KS_HDR_MAX;
		c = bad ? vec3(1.0, 0.0, 1.0) : vec3(luminance(c));
	}
#endif

	c = linearToSrgb(c);
	// 8-bit dither (triangular-ish from blue noise) against banding in skies and fog.
	c += (blueNoise(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);
	outColor = vec4(clamp01(c), 1.0);
}
#endif
