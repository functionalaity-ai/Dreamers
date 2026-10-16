// Kestrel Shaders - aerial perspective, height fog and in-medium fog.
// Outdoors the fog colour is the sky just above the horizon in the view direction, so fog
// always agrees with the sky, sun colour and time of day. Underground the air only scatters
// the light of nearby blocks, so cave fog is dark. Requires: sky.glsl, lighting.glsl.

// Height-integrated fog density for a height u above baseY: the density is
// density * exp(-falloff * u) above baseY and stays at 'density' below it.
float heightFogIntegral(float u, float density, float falloff) {
	return u > 0.0 ? density * (1.0 - exp(-falloff * u)) / falloff : density * u;
}

// Optical depth of the height fog from the camera to playerPos (closed form).
float heightFogDepth(vec3 playerPos, float density, float falloff, float baseY) {
	float L = length(playerPos);
	float a = eyeAltitude - baseY;
	float b = a + playerPos.y;
	if (abs(b - a) < 0.05) {
		float u = 0.5 * (a + b);
		return L * density * exp(-falloff * max(u, 0.0));
	}
	return L * (heightFogIntegral(b, density, falloff) - heightFogIntegral(a, density, falloff)) / (b - a);
}

float outdoorFactor() {
	return clamp01(float(eyeBrightnessSmooth.y) / 240.0);
}

// Light scattered toward the camera by the air or water around it from nearby block light
// (torches, lava), plus a tiny floor. Used where there is no sky light.
vec3 eyeBlockScatter() {
	float b = clamp01(float(eyeBrightnessSmooth.x) / 240.0);
	return blockLightColor() * (0.003 * b * b) + vec3(0.00004, 0.00005, 0.00006);
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
		// Sky light reaching the camera falls with depth (water dims sky light one level per
		// block) and is zero in flooded caves and aquifers.
		float outdoor = outdoorFactor();
		float skyReach = outdoor * sqrt(outdoor);
		vec3 amb = (skyIrradiance(vec3(0.0, 1.0, 0.0)) + lightIrradiance() * 0.25) * (0.035 * skyReach);
#else
		// The End has no sky light: its ambient comes from the dimension's air.
		vec3 amb = skyIrradiance(vec3(0.0, 1.0, 0.0)) * 0.05;
#endif
		vec3 inscatter = amb * vec3(0.10, 0.42, 0.50) + eyeBlockScatter() * vec3(0.5, 1.0, 1.0);
		color = color * T + inscatter * (1.0 - T);
	} else if (isEyeInWater == 2) {
		vec3 T = exp(-vec3(1.6) * dist);
		color = color * T + vec3(2.2, 0.55, 0.08) * (1.0 - T);
	} else if (isEyeInWater == 3) {
		vec3 T = exp(-vec3(1.1) * dist);
#ifdef KS_SKY_LUT
		float outdoor = outdoorFactor();
		vec3 snowCol = skyIrradiance(vec3(0.0, 1.0, 0.0)) * (0.06 * outdoor * outdoor) + eyeBlockScatter() * 4.0;
#else
		vec3 snowCol = skyIrradiance(vec3(0.0, 1.0, 0.0)) * 0.06;
#endif
		color = color * T + snowCol * (1.0 - T);
	} else if (!isSky || dist < far * 2.0) {
		// ---- Air.
#ifdef DIM_OVERWORLD
		float outdoor = outdoorFactor();
		float outdoor2 = outdoor * outdoor;
		float rain = rainStrength;
		float biome = 1.0 + 1.5 * ksBiomeSwamp + 0.5 * ksBiomeDesert + 0.6 * ksBiomeSnowy + 0.4 * ksBiomeJungle;
		// Clear-day transmittance ~0.8 at 128 blocks; valley fog thickens toward sea level and
		// stays at its sea-level density below it. Underground only a light haze remains.
		float haze = 0.0011 * (1.0 + 3.0 * rain) * biome;
		float od = haze * dist + heightFogDepth(playerPos, 0.0035 * (1.0 + 4.0 * rain) * biome, 0.08, 62.0) * outdoor;
		od *= FOG_DENSITY * mix(0.3, 1.0, outdoor);
		// Sky-lit haze outdoors, dark block-lit air underground.
		vec3 edgeCol = mix(eyeBlockScatter(), fogRadiance(dir), outdoor2);
		vec3 fogCol = mix(edgeCol, edgeCol * vec3(0.75, 1.0, 0.7), ksBiomeSwamp * 0.6);
		vec3 T = vec3(exp(-od));
		if (!isSky) color = color * T + fogCol * (1.0 - T);
		// Chunk-edge fade into the horizon colour (into darkness underground).
		float border = isSky ? 0.0 : smoothstep(far * 0.72, far * 0.98, length(playerPos.xz));
		color = mix(color, edgeCol, border);
#elif defined(DIM_NETHER)
		// Visibility ~40-60 blocks, thickest around the lava sea level.
		float od = (0.006 + 0.010 * clamp01(1.0 - abs(playerPos.y + eyeAltitude - 40.0) / 60.0)) * dist * FOG_DENSITY;
		vec3 T = vec3(exp(-od));
		vec3 fogCol = fogRadiance(dir);
		if (!isSky) color = color * T + fogCol * (1.0 - T);
		float border = isSky ? 0.0 : smoothstep(far * 0.6, far * 0.95, dist);
		color = mix(color, fogCol, border);
#else
		float od = 0.003 * dist * FOG_DENSITY;
		vec3 T = vec3(exp(-od));
		vec3 fogCol = fogRadiance(dir);
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
