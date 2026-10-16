// Kestrel Shaders - water surface waves and caustics.
// Advanced path: a sum of dispersion-correct sharp-crested waves (w = sqrt(g k)), rotated by
// the golden angle per octave; normals by finite differences.
// Simple path: two scrolling lookups of the smooth noise channels.
// Requires: common, uniforms, noise.

#define WATER_F0 0.02
#define WATER_ROUGHNESS 0.04

float waterHeight(vec2 p, int octaves) {
	float t = frameTimeCounter;
	float h = 0.0;
	float amp = 0.055;
	float wavelength = 7.0;
	vec2 dir = normalize(vec2(1.0, 0.35));
	float storm = 1.0 + 0.8 * rainStrength + 0.8 * thunderStrength;
	for (int i = 0; i < 5; i++) {
		if (i >= octaves) break;
		float k = TAU / wavelength;
		float w = sqrt(9.8 * k);
		float phase = dot(dir, p) * k - w * t;
		// exp(sin) - 1 gives sharper crests and wider troughs than a pure sine.
		h += amp * (exp(sin(phase)) - 1.0);
		dir = rotate2(dir, GOLDEN_ANGLE);
		wavelength *= 0.58;
		amp *= 0.5;
	}
	return h * storm;
}

// Player/world-space normal of the wave field at world xz.
vec3 waterWaveNormal(vec2 worldXZ, int octaves, float viewDist) {
	float e = 0.05;
	float h0 = waterHeight(worldXZ, octaves);
	float hx = waterHeight(worldXZ + vec2(e, 0.0), octaves);
	float hz = waterHeight(worldXZ + vec2(0.0, e), octaves);
	vec2 grad = vec2(hx - h0, hz - h0) / e;
	// Flatten with distance to stop sparkle aliasing near the horizon.
	grad *= 1.0 / (1.0 + viewDist * 0.02);
	return normalize(vec3(-grad.x, 1.0, -grad.y));
}

vec3 waterSimpleNormal(vec2 worldXZ) {
	float t = frameTimeCounter;
	vec2 a = worldXZ * 6.0 + vec2(t * 3.0, t * 1.7);
	vec2 b = worldXZ * 9.0 - vec2(t * 2.1, -t * 2.6);
	float h0 = noiseSmooth(a) + noiseSmooth2(b);
	float hx = noiseSmooth(a + vec2(1.0, 0.0)) + noiseSmooth2(b + vec2(1.0, 0.0));
	float hz = noiseSmooth(a + vec2(0.0, 1.0)) + noiseSmooth2(b + vec2(0.0, 1.0));
	vec2 grad = vec2(hx - h0, hz - h0) * 0.35;
	return normalize(vec3(-grad.x, 1.0, -grad.y));
}

// Animated caustic pattern (0..~2) at a world position, for sunlit surfaces under water.
float waterCaustics(vec3 worldPos) {
	float t = frameTimeCounter * 0.9;
	vec2 p = worldPos.xz + worldPos.y * 0.25;
	float a = noiseSmooth(p * 9.0 + vec2(t * 4.0, t * 2.3));
	float b = noiseSmooth2(p * 7.0 - vec2(t * 3.1, -t * 3.7));
	float c = 1.0 - abs(a - b) * 3.2;
	return 0.35 + 1.6 * pow(clamp01(c), 6.0);
}

// Per-channel absorption of water per block, tinted toward the biome water colour.
vec3 waterAbsorption(vec3 biomeTintLinear) {
	vec3 base = vec3(0.32, 0.065, 0.04);
	vec3 tintAbs = -log(clamp(biomeTintLinear, vec3(0.05), vec3(1.0))) * 0.15;
	return base + tintAbs;
}
