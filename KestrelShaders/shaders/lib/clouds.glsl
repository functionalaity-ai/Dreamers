// Kestrel Shaders - 2D layered clouds lit by the atmosphere's sun, moon and sky light.
// Layer 1: cumulus-like deck at the vanilla cloud height. Layer 2: thin high cirrus.
// Requires: common, uniforms, space, noise, sky.

#ifdef KS_SKY_LUT

float cloudDeckHeight() {
#ifdef IS_IRIS
	return cloudHeight > 1.0 ? cloudHeight + 0.5 : 192.5;
#else
	return 192.5;
#endif
}

// Cloud patterns repeat every 65536 blocks, and the wind moves each layer exactly one
// pattern period per hour, so neither the camera-position wrap nor frameTimeCounter's
// 3600 s wrap makes the clouds jump.
vec2 cloudWorldXZ(vec3 playerPos) {
#ifdef IS_IRIS
	ivec2 ci = cameraPositionInt.xz;
	ivec2 cw = ci - (ci / 65536) * 65536;
	return playerPos.xz + vec2(cw) + cameraPositionFract.xz;
#else
	return playerPos.xz + mod(cameraPosition.xz, 65536.0);
#endif
}

// Cumulus: 17 noise periods per 65536 blocks; wind 65536/17 blocks per hour (~1.07 b/s).
#define KS_CUMULUS_SCALE 0.06640625
vec2 cumulusWind() {
	return vec2(frameTimeCounter * (65536.0 / 17.0 / 3600.0), 0.0);
}
// Cirrus: 3 x 9 noise periods per 65536 blocks, stretched along x; wind ~6.07 b/s.
#define KS_CIRRUS_SCALE vec2(0.01171875, 0.03515625)
vec2 cirrusWind() {
	return vec2(frameTimeCounter * (65536.0 / 3.0 / 3600.0), 0.0);
}

float cloudCoverage() {
	return mix(0.42, 0.78, rainStrength);
}

// Cumulus density at a world xz position (0..1). noiseSmooth has 8-texel features, so a
// scale of ~0.066 gives ~120-block clouds for the base octave. Octaves double exactly, so
// they repeat with the base pattern.
float cumulusDensity(vec2 xz, int octaves) {
	vec2 p = (xz + cumulusWind()) * KS_CUMULUS_SCALE;
	float n = 0.0;
	float amp = 0.55;
	float sum = 0.0;
	for (int i = 0; i < 4; i++) {
		if (i >= octaves) break;
		n += amp * noiseSmooth(p);
		sum += amp;
		p = p * 2.0 + vec2(17.0, 43.0);
		amp *= 0.5;
	}
	n /= sum;
	float cov = cloudCoverage();
	return clamp01((n - (1.0 - cov)) / max(cov * 0.55, 1e-3));
}

// Streaky high cirrus from the coarse (16-texel) channel, stretched along x.
float cirrusDensity(vec2 xz) {
	vec2 p = (xz + cirrusWind()) * KS_CIRRUS_SCALE;
	float n = noiseSmooth2(p) * 0.65 + noiseSmooth2(p * 3.0 + 11.0) * 0.35;
	return clamp01((n - 0.55) * 2.6) * (1.0 - rainStrength * 0.7);
}

// Light reaching a cloud point from the sun/moon, sky and ground bounce.
vec3 cloudLighting(float density, float lightDensity, float cosTheta, float ambientScale) {
	vec3 lightE = lightIrradiance();
	float phase = mix(phaseHG(cosTheta, 0.6), phaseHG(cosTheta, -0.25), 0.3);
	float beer = exp(-lightDensity * 3.2);
	float powder = 1.0 - exp(-density * 4.0);
	// Clouds scatter light many times inside: approximate with a brightened, partly
	// isotropic direct term plus sky and ground ambient.
	vec3 direct = lightE * (phase + 0.08) * beer * mix(1.0, powder, 0.5) * 3.0;
	vec3 ambient = (skyIrradiance(vec3(0.0, 1.0, 0.0)) * 1.1 + skyIrradiance(vec3(0.0, -1.0, 0.0)) * 0.6) * RCP_PI * ambientScale;
	return direct + ambient;
}

// Returns rgb in-scattered radiance and a transmittance in alpha for a player-space view
// direction. 'quality' 0 is the cheap reflection variant.
vec4 sampleClouds(vec3 dir, int quality) {
	vec3 result = vec3(0.0);
	float T = 1.0;
	vec3 Lp = lightDirPlayer();
	float camY = eyeAltitude;

	// Layer 1: cumulus deck.
	{
		float h = cloudDeckHeight();
		float dy = h - camY;
		if (dir.y * dy > 0.0) {
			float t = dy / dir.y;
			if (t < 12000.0) {
				vec2 xz = cloudWorldXZ(dir * t);
				int oct = quality > 0 ? 4 : 2;
				float d = cumulusDensity(xz, oct);
				if (d > 0.002) {
					float dl = cumulusDensity(xz + Lp.xz / max(abs(Lp.y), 0.15) * 22.0, oct);
					float dl2 = quality > 0 ? cumulusDensity(xz + Lp.xz / max(abs(Lp.y), 0.15) * 55.0, 2) : dl;
					float lightD = dl * 0.7 + dl2 * 0.5;
					vec3 L = cloudLighting(d, lightD, dot(dir, Lp), 1.0);
					float fade = smoothstep(0.0, 0.06, abs(dir.y)) * exp(-t / 9000.0);
					float alpha = (1.0 - exp(-d * 2.6)) * fade;
					result += L * alpha * T;
					T *= 1.0 - alpha;
				}
			}
		}
	}
#if CLOUD_LAYERS >= 2
	// Layer 2: cirrus.
	{
		float h = 1100.0;
		float dy = h - camY;
		if (dir.y > 0.0 && dy > 0.0) {
			float t = dy / dir.y;
			vec2 xz = cloudWorldXZ(dir * t);
			float d = cirrusDensity(xz);
			if (d > 0.002) {
				vec3 L = cloudLighting(d * 0.3, d * 0.15, dot(dir, Lp), 1.2);
				float fade = smoothstep(0.0, 0.12, dir.y);
				float alpha = d * 0.55 * fade;
				result += L * alpha * T;
				T *= 1.0 - alpha;
			}
		}
	}
#endif
	return vec4(result, T);
}

// Sunlight transmittance through the cumulus deck above a world position (cloud shadows).
float cloudShadow(vec3 playerPos) {
	vec3 Lp = lightDirPlayer();
	float h = cloudDeckHeight();
	float y = playerPos.y + eyeAltitude;
	if (y > h || Lp.y <= 0.05) return 1.0;
	float t = (h - y) / Lp.y;
	vec2 xz = cloudWorldXZ(playerPos + Lp * t);
	float d = cumulusDensity(xz, 2);
	return 1.0 - 0.8 * smoothstep(0.0, 0.6, d);
}

#endif // KS_SKY_LUT
