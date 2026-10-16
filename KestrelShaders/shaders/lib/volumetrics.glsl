// Kestrel Shaders - light shafts (Overworld only, KS_VL_ACTIVE).
//   VL_MODE 0: screen-space radial blur toward the sun (GPU Gems 3, ch. 13).
//   VL_MODE 1: shadow-map ray march through height-varying haze with HG phase.
// Requires: common, uniforms, space, sky, shadows (mode 1).

#if defined(KS_VL_ACTIVE) && VL_MODE == 1 && defined(KS_SHADOWS_ACTIVE)
	#define KS_VL_SHADOWMAP 1
#endif

// Haze scattering coefficient per block at world height y (matches fog.glsl's air model).
float shaftDensity(float y) {
	float rain = rainStrength;
	float biome = 1.0 + 1.5 * ksBiomeSwamp + 0.5 * ksBiomeDesert;
	float haze = 0.0011 * (1.0 + 3.0 * rain) * biome;
	float height = 0.0035 * (1.0 + 4.0 * rain) * biome * exp(-0.08 * max(y - 62.0, -30.0));
	return (haze + min(height, 0.05)) * FOG_DENSITY;
}

float shaftPhase(float cosTheta) {
	return mix(phaseHG(cosTheta, 0.76), 1.0 / (4.0 * PI), 0.3);
}

// Visibility of the light for shafts: fades out underground, at the horizon and in rain.
float shaftLightVisibility() {
	vec3 L = lightDirPlayer();
	float horizon = smoothstep(0.02, 0.12, L.y);
	float outdoor = clamp01(float(eyeBrightnessSmooth.y) / 240.0);
	return horizon * mix(0.15, 1.0, outdoor) * (1.0 - 0.7 * rainStrength);
}

#ifdef KS_VL_SHADOWMAP
// Returns in-scattered radiance (rgb) and transmittance (a) from the camera to playerEnd.
vec4 marchLightShafts(vec3 playerEnd, float noise) {
	float dist = min(length(playerEnd), shadowDistance * 0.95);
	vec3 dir = playerEnd / max(length(playerEnd), 1e-4);
	int steps = KS_VL_STEPS;
	float dt = dist / float(steps);
	vec3 L = lightDirPlayer();
	float phase = shaftPhase(dot(dir, L));
	bool water = isEyeInWater == 1;

	float scatter = 0.0;
	float T = 1.0;
	for (int i = 0; i < 16; i++) {
		if (i >= steps) break;
		vec3 p = dir * ((float(i) + noise) * dt);
		float sigma = water ? 0.035 : shaftDensity(p.y + eyeAltitude);
		vec3 sc = playerToShadowClip(p);
		vec3 coord = distortShadowClip(sc) * 0.5 + 0.5;
		float vis = 1.0;
		if (all(greaterThan(coord, vec3(0.0))) && all(lessThan(coord, vec3(1.0))))
			vis = texture(KS_SHADOW_CMP0, coord);
		float stepT = exp(-sigma * dt);
		scatter += T * vis * (1.0 - stepT);
		T *= stepT;
	}
	vec3 lightE = lightIrradiance() * shaftLightVisibility();
	vec3 tint = water ? vec3(0.35, 0.85, 1.0) : vec3(1.0);
	return vec4(lightE * tint * (scatter * phase), T);
}
#endif

// Screen-space shafts: march from the pixel toward the light's screen position, counting
// sky pixels. Returns in-scattered radiance.
vec3 screenSpaceShafts(sampler2D depthTex, vec2 sceneUV, float noise) {
	vec3 Lv = lightDirView();
	if (Lv.z >= -0.05) return vec3(0.0);
	vec3 ls = viewToScreen(Lv * 1000.0);
	vec2 lightUV = ls.xy;
	float vis = shaftLightVisibility();
	// Fade when the light leaves the screen.
	vec2 off = max(abs(lightUV - 0.5) - 0.5, 0.0);
	vis *= clamp01(1.0 - length(off) * 3.0);
	if (vis <= 0.0) return vec3(0.0);

	int taps = KS_VL_STEPS;
	vec2 delta = (lightUV - sceneUV) * (0.85 / float(taps));
	vec2 uv = sceneUV + delta * noise;
	float s = renderScale();
	vec2 jit = taaJitterUV();
	float acc = 0.0;
	float w = 1.0;
	float wsum = 0.0;
	for (int i = 0; i < 16; i++) {
		if (i >= taps) break;
		uv += delta;
		if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
		float d = texture(depthTex, uv * s + jit).r;
		acc += (d >= 1.0 ? 1.0 : 0.0) * w;
		wsum += w;
		w *= 0.93;
	}
	acc /= max(wsum, 1e-3);
	float cosTheta = dot(normalize(viewToPlayerDir(screenToView(sceneUV, 1.0))), lightDirPlayer());
	float phase = shaftPhase(cosTheta);
	return lightIrradiance() * (acc * vis * phase * 0.06 * FOG_DENSITY * (1.0 + 2.0 * rainStrength));
}
