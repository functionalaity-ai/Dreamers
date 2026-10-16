// Kestrel Shaders - camera and display stage helpers for final.
// Requires: common, uniforms, space, noise.

// Exposure: EV100 from average luminance (Lagarde & de Rousiers 2014, K = 12.5) with the
// multiplier applied to Kestrel units (1 unit = 1000 cd/m^2). The +0.8 EV calibration puts
// the scene average near 0.18 before tonemapping.
float ev100FromLuminance(float lumKestrel) {
	return log2(max(lumKestrel, 1e-7) * 1000.0 * 100.0 / 12.5);
}
float exposureFromEV(float ev100) {
	return 1000.0 / (1.2 * exp2(ev100 - EXPOSURE_BIAS - 0.8));
}

// Manual exposure for POTATO (no resolve pass): eye brightness and sun height.
float fallbackEV() {
	float sky = clamp01(float(eyeBrightnessSmooth.y) / 240.0);
#ifdef DIM_OVERWORLD
	float day = smoothstep(-0.08, 0.25, sunDirPlayer().y);
	float outdoorEV = mix(6.8, 14.6, day) - 1.4 * rainStrength;
#else
	float outdoorEV = 7.5;
#endif
	return mix(7.8, outdoorEV, sky * sky);
}

// White balance: von Kries gains from the chosen white point to D65.
vec3 whiteBalance(vec3 c) {
#if WHITE_BALANCE_K != 6500
	vec3 gain = blackbody(6500.0) / max(blackbody(float(WHITE_BALANCE_K)), vec3(1e-3));
	c *= gain / max(luminance(gain), 1e-3);
#endif
	return c;
}

// Purkinje shift: in dim moonlight vision moves to the rods (blue-green, desaturated).
vec3 purkinjeShift(vec3 exposed, float ev100) {
#if defined(PURKINJE) && defined(DIM_OVERWORLD)
	float night = smoothstep(9.0, 6.2, ev100) * (1.0 - daylightFactor());
	float outdoor = clamp01(float(eyeBrightnessSmooth.y) / 240.0);
	float dim = 1.0 - smoothstep(0.04, 0.55, luminance(exposed));
	float k = night * outdoor * dim * PURKINJE_STRENGTH;
	if (k <= 0.0) return exposed;
	float rod = dot(exposed, vec3(0.04, 0.58, 0.38));
	vec3 nightColor = rod * vec3(0.55, 0.78, 1.0);
	return mix(exposed, nightColor, k);
#else
	return exposed;
#endif
}

vec3 saturationContrast(vec3 c) {
	float l = luminance(c);
	c = max(mix(vec3(l), c, float(SATURATION)), vec3(0.0));
	// Contrast around mid-grey in a perceptual (gamma 2.2) space. Float options cannot be
	// tested by the preprocessor, so this is a constant-folded branch.
	if (float(CONTRAST) != 1.0) {
		vec3 g = pow(c, vec3(1.0 / 2.2));
		g = (g - 0.5) * float(CONTRAST) + 0.5;
		c = pow(max(g, vec3(0.0)), vec3(2.2));
	}
	return c;
}

// Contrast-adaptive sharpening (after AMD FidelityFX CAS) on HDR values mapped to x/(1+x),
// which is invertible and keeps highlights from ringing.
vec3 casPerceptual(vec3 x) { return x / (1.0 + x); }
vec3 casLinear(vec3 y) { return y / max(1.0 - y, vec3(1e-4)); }

vec3 casSharpen(sampler2D tex, vec2 uv, vec2 texel, float sharpness) {
	vec3 e = casPerceptual(texture(tex, uv).rgb);
	if (sharpness <= 0.0) return casLinear(e);
	vec3 a = casPerceptual(texture(tex, uv + vec2(0.0, texel.y)).rgb);
	vec3 b = casPerceptual(texture(tex, uv - vec2(texel.x, 0.0)).rgb);
	vec3 c = casPerceptual(texture(tex, uv + vec2(texel.x, 0.0)).rgb);
	vec3 d = casPerceptual(texture(tex, uv - vec2(0.0, texel.y)).rgb);
	vec3 mn = min(e, min(min(a, b), min(c, d)));
	vec3 mx = max(e, max(max(a, b), max(c, d)));
	vec3 amp = sqrt(clamp01(min(mn, 1.0 - mx) / max(mx, vec3(1e-4))));
	float peak = -1.0 / mix(8.0, 5.0, clamp01(sharpness));
	vec3 w = amp * peak;
	vec3 r = (a * w + b * w + c * w + d * w + e) / (1.0 + 4.0 * w);
	return casLinear(clamp(r, vec3(0.0), vec3(0.999)));
}

float vignetteFactor(vec2 uv) {
	vec2 d = (uv - 0.5) * vec2(aspectRatio, 1.0) / sqrt(aspectRatio * aspectRatio + 1.0) * 2.0;
	float r2 = dot(d, d);
	return 1.0 - VIGNETTE * smoothstep(0.15, 1.1, r2);
}

vec3 filmGrain(vec3 c, vec2 pixel) {
	if (float(FILM_GRAIN) <= 0.0) return c;
	float n = hash12(pixel + float(frameCounter - (frameCounter / 997) * 997) * 13.0) - 0.5;
	return c * (1.0 + n * float(FILM_GRAIN) * 2.0 * (1.0 - luminance(c) * 0.5));
}
