// Kestrel Shaders - temporal anti-aliasing and upscaling helpers (composite2).
// Variance clipping in YCoCg (Salvi 2016), 5-tap Catmull-Rom history, Karis 1/(1+L)
// weighting, and a Gaussian reconstruction of the scaled current frame (TAAU).

vec3 rgbToYCoCg(vec3 c) {
	return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25)));
}
vec3 yCoCgToRgb(vec3 c) {
	return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

float karisWeight(vec3 c) { return 1.0 / (1.0 + luminance(c)); }

// Catmull-Rom history fetch with 5 bilinear taps (corner taps dropped).
vec3 sampleHistoryCatmullRom(sampler2D tex, vec2 uv, vec2 texSize) {
	vec2 samplePos = uv * texSize;
	vec2 tc1 = floor(samplePos - 0.5) + 0.5;
	vec2 f = samplePos - tc1;
	vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
	vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
	vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
	vec2 w3 = f * f * (-0.5 + 0.5 * f);
	vec2 w12 = w1 + w2;
	vec2 tc0 = (tc1 - 1.0) / texSize;
	vec2 tc3 = (tc1 + 2.0) / texSize;
	vec2 tc12 = (tc1 + w2 / max(w12, vec2(1e-5))) / texSize;

	vec3 r = vec3(0.0);
	float wsum = 0.0;
	float w;
	w = w12.x * w0.y;  r += texture(tex, vec2(tc12.x, tc0.y)).rgb * w;  wsum += w;
	w = w0.x * w12.y;  r += texture(tex, vec2(tc0.x, tc12.y)).rgb * w;  wsum += w;
	w = w12.x * w12.y; r += texture(tex, vec2(tc12.x, tc12.y)).rgb * w; wsum += w;
	w = w3.x * w12.y;  r += texture(tex, vec2(tc3.x, tc12.y)).rgb * w;  wsum += w;
	w = w12.x * w3.y;  r += texture(tex, vec2(tc12.x, tc3.y)).rgb * w;  wsum += w;
	return max(r / max(wsum, 1e-5), vec3(0.0));
}

// Clip a colour toward the centre of an AABB (in YCoCg) instead of clamping per channel.
vec3 clipToAABB(vec3 history, vec3 center, vec3 extents) {
	vec3 d = history - center;
	vec3 ad = abs(d) / max(extents, vec3(1e-5));
	float m = maxOf(ad);
	return m > 1.0 ? center + d / m : history;
}

// FXAA in the spirit of Lottes' published FXAA 3.11 console variant, on perceptual luma.
float fxaaLuma(vec3 c) { float l = luminance(c); return l / (1.0 + l); }

vec3 fxaaResolve(sampler2D tex, vec2 uv, vec2 texel) {
	vec3 cM = texture(tex, uv).rgb;
	vec3 cNW = texture(tex, uv + vec2(-0.5, 0.5) * texel).rgb;
	vec3 cNE = texture(tex, uv + vec2(0.5, 0.5) * texel).rgb;
	vec3 cSW = texture(tex, uv + vec2(-0.5, -0.5) * texel).rgb;
	vec3 cSE = texture(tex, uv + vec2(0.5, -0.5) * texel).rgb;
	float lM = fxaaLuma(cM);
	float lNW = fxaaLuma(cNW);
	float lNE = fxaaLuma(cNE);
	float lSW = fxaaLuma(cSW);
	float lSE = fxaaLuma(cSE);
	float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
	float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
	if (lMax - lMin < max(0.05, lMax * 0.125)) return cM;

	vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
	float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
	float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
	dir = clamp(dir * rcpMin, vec2(-8.0), vec2(8.0)) * texel;

	vec3 a = 0.5 * (texture(tex, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(tex, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
	vec3 b = a * 0.5 + 0.25 * (texture(tex, uv - dir * 0.5).rgb + texture(tex, uv + dir * 0.5).rgb);
	float lB = fxaaLuma(b);
	return (lB < lMin || lB > lMax) ? a : b;
}
