// Kestrel Shaders - aerial perspective, height fog and in-medium fog.
// The fog colour is the sky just above the horizon in the view direction, so fog always
// agrees with the sky, sun colour and time of day. Requires: sky.glsl.

// Exponential height fog optical depth from the camera to playerPos (closed form).
float heightFogDepth(vec3 playerPos, float density, float falloff, float baseY) {
	float L = length(playerPos);
	float dy = playerPos.y;
	float base = density * exp(-falloff * (eyeAltitude - baseY));
	base = min(base, density * 40.0);
	float kd = falloff * dy;
	if (abs(kd) < 1e-3) return base * L;
	return base * L * (1.0 - exp(-kd)) / kd;
}

float outdoorFactor() {
	return clamp01(float(eyeBrightnessSmooth.y) / 240.0);
}

// Fog for a surface at playerPos. Returns the fogged colour.
vec3 applyAtmosphere(vec3 color, vec3 playerPos, bool isSky) {
	float dist = length(playerPos);
	vec3 dir = playerPos / max(dist, 1e-4);

	// ---- In-medium fog (eye inside water, lava or powder snow) and status effects.
	if (isEyeInWater == 1) {
		vec3 sigma = vec3(0.32, 0.065, 0.04) * mix(1.0, 1.6, ksBiomeSwamp);
		vec3 T = exp(-sigma * min(dist, far));
#ifdef KS_SKY_LUT
		vec3 amb = (skyIrradiance(vec3(0.0, 1.0, 0.0)) + lightIrradiance() * 0.25) * 0.035;
#else
		vec3 amb = skyIrradiance(vec3(0.0, 1.0, 0.0)) * 0.05;
#endif
		vec3 inscatter = amb * vec3(0.10, 0.42, 0.50) + vec3(0.0004, 0.0012, 0.0016);
		color = color * T + inscatter * (1.0 - T);
	} else if (isEyeInWater == 2) {
		vec3 T = exp(-vec3(1.6) * dist);
		color = color * T + vec3(2.2, 0.55, 0.08) * (1.0 - T);
	} else if (isEyeInWater == 3) {
		vec3 T = exp(-vec3(1.1) * dist);
		color = color * T + skyIrradiance(vec3(0.0, 1.0, 0.0)) * 0.06 * (1.0 - T);
	} else if (!isSky || dist < far * 2.0) {
		// ---- Air.
#ifdef DIM_OVERWORLD
		float outdoor = outdoorFactor();
		float rain = rainStrength;
		float biome = 1.0 + 1.5 * ksBiomeSwamp + 0.5 * ksBiomeDesert + 0.6 * ksBiomeSnowy + 0.4 * ksBiomeJungle;
		float haze = 0.0011 * (1.0 + 3.0 * rain) * biome;
		float od = haze * dist + heightFogDepth(playerPos, 0.010 * (1.0 + 2.0 * rain) * biome, 0.07, 62.0);
		od *= FOG_DENSITY * mix(0.3, 1.0, outdoor);
		vec3 fogCol = fogRadiance(dir) * mix(0.08, 1.0, outdoor * outdoor);
		fogCol = mix(fogCol, fogCol * vec3(0.75, 1.0, 0.7), ksBiomeSwamp * 0.6);
		vec3 T = vec3(exp(-od));
		if (!isSky) color = color * T + fogCol * (1.0 - T);
		// Chunk-edge fade into the horizon colour.
		float border = isSky ? 0.0 : smoothstep(far * 0.72, far * 0.98, length(playerPos.xz));
		color = mix(color, fogRadiance(dir), border);
#elif defined(DIM_NETHER)
		float od = (0.016 + 0.012 * clamp01(1.0 - abs(playerPos.y + eyeAltitude - 64.0) / 64.0)) * dist * FOG_DENSITY;
		vec3 T = vec3(exp(-od));
		vec3 fogCol = dimensionFogColor() * 1.4;
		if (!isSky) color = color * T + fogCol * (1.0 - T);
		float border = isSky ? 0.0 : smoothstep(far * 0.6, far * 0.95, dist);
		color = mix(color, fogCol, border);
#else
		float od = 0.004 * dist * FOG_DENSITY;
		vec3 T = vec3(exp(-od));
		vec3 fogCol = dimensionFogColor() * 1.2;
		if (!isSky) color = color * T + fogCol * (1.0 - T);
		float border = isSky ? 0.0 : smoothstep(far * 0.7, far * 0.98, dist);
		color = mix(color, fogCol, border);
#endif
	}

	// Blindness and the Warden's darkness: dense black fog.
	float dark = max(blindness, darknessFactor * 0.8);
	if (dark > 0.0) {
		float T = exp(-dark * 0.45 * dist);
		color *= mix(1.0, T, dark);
	}
	return color;
}
