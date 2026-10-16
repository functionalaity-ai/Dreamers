// Kestrel Shaders - composite2: anti-aliasing resolve and eye adaptation into colortex5.
//   TAA on:  temporal AA with upscaling (TAAU) from the scaled frame.
//   FXAA on: FXAA (TAA off, render scale 1).
//   Neither: copy (the pass then only runs for auto exposure).
// The exposure (EV100) is stored in colortex5 texel (0,0) alpha; 0 there means the history
// was just cleared by Iris (load, option change, resize), which resets TAA and exposure.
// Enabled by TAA || FXAA || AUTO_EXPOSURE. Program: PROGRAM_COMPOSITE2.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"
#include "/lib/noise.glsl"
#include "/lib/atmosphere.glsl"
#include "/lib/sky.glsl"
#include "/lib/post.glsl"

uniform sampler2D colortex0;
uniform sampler2D colortex5;

// ============================================================================ vertex
#ifdef STAGE_VERTEX
flat out float vEV;
flat out float vHistoryValid;

void main() {
	gl_Position = vec4(gl_Vertex.xy * 2.0 - 1.0, 0.0, 1.0);
	float prevEV = texelFetch(colortex5, ivec2(0), 0).a;
	bool valid = prevEV > 0.0 && !isnan(prevEV) && length(cameraDelta()) < 8.0;
	vHistoryValid = valid ? 1.0 : 0.0;
#ifdef AUTO_EXPOSURE
	// Log-average luminance from a jittered 16x16 grid inside the rendered rectangle.
	float s = renderScale();
	vec2 size = vec2(textureSize(colortex0, 0));
	vec2 jit = r2Sequence(frameCounter - (frameCounter / 64) * 64) - 0.5;
	float logSum = 0.0;
	float wSum = 0.0;
	for (int y = 0; y < 16; y++) {
		for (int x = 0; x < 16; x++) {
			vec2 g = (vec2(float(x), float(y)) + 0.5 + jit) / 16.0;
			ivec2 p = clamp(ivec2(g * s * size), ivec2(0), ivec2(size * s) - 1);
			float lum = luminance(sanitizeHDR(texelFetch(colortex0, p, 0).rgb));
			float w = exp(-dot(g - 0.5, g - 0.5) * 3.0);
			logSum += log2(clamp(lum, 1e-6, 400.0)) * w;
			wSum += w;
		}
	}
	float avgLum = exp2(logSum / wSum);
	// Scene key: dim scenes (night, caves, the Nether) are exposed darker than mid-grey, as an
	// eye or camera would, instead of being lifted to daylight brightness.
	float measuredEV = ev100FromLuminance(avgLum);
	float key = 2.4 * (1.0 - smoothstep(5.0, 11.5, measuredEV));
	float targetEV = clamp(measuredEV + key, KS_EV_MIN, KS_EV_MAX);
	// Blindness and Darkness black out the view on purpose: do not adapt to the black.
	float blind = clamp01(max(blindness, darknessFactor) * 4.0);
	if (prevEV > 0.0) targetEV = mix(targetEV, max(targetEV, prevEV), blind);
	if (prevEV <= 0.0 || isnan(prevEV) || isinf(prevEV)) {
		vEV = targetEV;
	} else {
		// Brightening (more EV) adapts fast, darkening into caves slowly.
		float rate = targetEV > prevEV ? 2.4 : 0.9;
		vEV = prevEV + (targetEV - prevEV) * (1.0 - exp(-rate * clamp(frameTime, 0.0, 0.25)));
	}
	vEV = clamp(vEV, KS_EV_MIN, KS_EV_MAX);
#else
	vEV = clamp(fallbackEV(), KS_EV_MIN, KS_EV_MAX);
#endif
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#include "/lib/material.glsl"
#include "/lib/taa.glsl"

uniform sampler2D depthtex0;
#if defined(KS_TAA_ACTIVE) && defined(KS_GBUFFER_DATA)
uniform sampler2D colortex1;
#endif

flat in float vEV;
flat in float vHistoryValid;

/* RENDERTARGETS: 5 */
layout(location = 0) out vec4 outResolved;

// Karis-weighted (tonemapped) domain for blending and clipping, invertible.
vec3 toT(vec3 c) { return c / (1.0 + luminance(c)); }
vec3 fromT(vec3 t) { return t / max(1.0 - luminance(t), 1e-4); }

void main() {
	vec2 outUV = gl_FragCoord.xy * viewTexel();
	vec3 result;

#if defined(KS_TAA_ACTIVE)
	float s = renderScale();
	vec2 jitter = taaJitterPx();
	vec2 rp = gl_FragCoord.xy * s;
	// The sample in buffer pixel p shows the scene point at scaled position p + 0.5 - jitter.
	ivec2 center = ivec2(floor(rp + jitter));
	ivec2 maxP = max(ivec2(viewSize() * s) - 1, ivec2(0));

	vec3 sum = vec3(0.0);
	float wsum = 0.0;
	float maxW = 0.0;
	vec3 m1 = vec3(0.0);
	vec3 m2 = vec3(0.0);
	float closestDepth = 2.0;
	ivec2 closestP = clamp(center, ivec2(0), maxP);
	for (int dy = -1; dy <= 1; dy++) {
		for (int dx = -1; dx <= 1; dx++) {
			ivec2 p = clamp(center + ivec2(dx, dy), ivec2(0), maxP);
			vec3 t = toT(sanitizeHDR(texelFetch(colortex0, p, 0).rgb));
			vec2 d = (vec2(p) + 0.5 - jitter - rp) / s;
			float w = exp(-2.29 * dot(d, d));
			sum += t * w;
			wsum += w;
			maxW = max(maxW, w);
			vec3 y = rgbToYCoCg(t);
			m1 += y;
			m2 += y * y;
			float dd = texelFetch(depthtex0, p, 0).r;
			if (dd < closestDepth) {
				closestDepth = dd;
				closestP = p;
			}
		}
	}
	vec3 current = sum / max(wsum, 1e-5);
	vec3 mean = m1 / 9.0;
	vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3(0.0)));

	// Depth dilation: this pixel moves with the closest sample of the 3x3 neighbourhood,
	// which keeps foreground edges from ghosting.
	vec2 closestSceneUV = (vec2(closestP) + 0.5 - jitter) / (viewSize() * s);
	int code = MAT_GENERIC;
	#ifdef KS_GBUFFER_DATA
	code = decodeMaterial(texelFetch(colortex1, closestP, 0).b);
	#endif
	vec2 prevUV;
	if (code == MAT_HAND) {
		prevUV = outUV;
	} else if (closestDepth >= 1.0) {
		vec3 dirP = viewToPlayerDir(screenToView(closestSceneUV, 1.0));
		prevUV = outUV + reprojectPlayer(safeNormalize(dirP) * 4096.0).xy - closestSceneUV;
	} else {
		vec3 pp = viewToPlayer(screenToView(closestSceneUV, closestDepth));
		prevUV = outUV + reprojectPlayer(pp).xy - closestSceneUV;
	}

	bool valid = vHistoryValid > 0.5 && all(greaterThanEqual(prevUV, vec2(0.0))) && all(lessThanEqual(prevUV, vec2(1.0)));
	float alpha = mix(0.04, 0.14, maxW);
	if (valid) {
		vec3 hist = toT(sanitizeHDR(sampleHistoryCatmullRom(colortex5, prevUV, viewSize())));
		float gamma = mix(1.25, 1.0, clamp01(length((prevUV - outUV) * viewSize()) * 0.1));
		vec3 hy = clipToAABB(rgbToYCoCg(hist), mean, sigma * gamma + 1e-4);
		hist = yCoCgToRgb(hy);
		float velocity = length((prevUV - outUV) * viewSize());
		alpha = max(alpha, clamp01(velocity * 0.012));
		if (code == MAT_ENTITY || code == MAT_FORWARD) alpha = max(alpha, 0.2);
		if (code == MAT_HAND) alpha = max(alpha, 0.25);
		result = fromT(mix(hist, current, alpha));
	} else {
		result = fromT(current);
	}
#elif defined(KS_FXAA_ACTIVE)
	result = fxaaResolve(colortex0, outUV, viewTexel());
#else
	result = texture(colortex0, outUV).rgb;
#endif

	result = sanitizeHDR(result);
	float a = (int(gl_FragCoord.x) == 0 && int(gl_FragCoord.y) == 0) ? vEV : 1.0;
	outResolved = vec4(result, a);
}
#endif
