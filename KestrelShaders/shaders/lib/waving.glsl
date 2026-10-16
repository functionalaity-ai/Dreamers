// Kestrel Shaders - wind animation for plants and water. Used identically by the shadow pass
// and the gbuffers vertex shaders so shadows move with the geometry.
// Requires: common, uniforms, space, material.

float windTime() {
	// frameTimeCounter wraps at 3600 s; every frequency below goes through KS_LOOP_W, so the
	// wrap does not make plants or water jump.
	return frameTimeCounter;
}

// Offset in player space for a vertex of block 'id' at world position 'worldPos'.
// isTop is true for vertices on the upper edge of the face (they move, the base does not).
vec3 waveOffset(int id, vec3 worldPos, bool isTop) {
#ifdef WAVING_FOLIAGE
	float strength = WIND_STRENGTH * (1.0 + 1.5 * rainStrength + 1.5 * thunderStrength);
	if (strength <= 0.0) return vec3(0.0);
	float t = windTime();
	vec3 p = worldPos;
	float gust = 0.6 + 0.4 * sin(t * KS_LOOP_W(0.35) + p.x * 0.05 + p.z * 0.04);
	if (id == ID_LEAVES) {
		float w = sin(t * KS_LOOP_W(1.7) + p.x * 0.9 + p.y * 0.7) + 0.6 * sin(t * KS_LOOP_W(2.9) + p.z * 1.3);
		float w2 = sin(t * KS_LOOP_W(1.3) + p.z * 0.8 + p.y * 0.5);
		return vec3(w, w2 * 0.5, w2) * (0.018 * strength * gust);
	}
	if (id == ID_VINES) {
		float w = sin(t * KS_LOOP_W(1.5) + p.x * 0.6 + p.y * 1.1 + p.z * 0.6);
		return vec3(w, 0.0, w * 0.7) * (0.025 * strength * gust);
	}
	// Two-block plants: the seam between halves moves by the same amount on both halves.
	float amp;
	if (id == ID_PLANT_TALL_UPPER) amp = isTop ? 0.09 : 0.045;
	else if (id == ID_PLANT_TALL_LOWER) amp = isTop ? 0.045 : 0.0;
	else amp = isTop ? 0.07 : 0.0;
	if (amp <= 0.0) return vec3(0.0);
	float w = sin(t * KS_LOOP_W(2.1) + p.x * 0.7 + p.z * 0.5) + 0.5 * sin(t * KS_LOOP_W(3.3) + p.x * 1.4 - p.z * 0.9);
	float w2 = sin(t * KS_LOOP_W(1.8) + p.z * 0.75 - p.x * 0.3);
	return vec3(w, 0.0, w2) * (amp * strength * gust);
#else
	return vec3(0.0);
#endif
}

// Small vertical displacement for water surfaces (shared with the fragment wave normals).
float waterVertexWave(vec3 worldPos) {
#ifdef WAVING_WATER
	float t = windTime();
	return (sin(t * KS_LOOP_W(1.4) + worldPos.x * 0.8 + worldPos.z * 0.6) +
	        sin(t * KS_LOOP_W(1.1) - worldPos.x * 0.5 + worldPos.z * 0.9)) * 0.012;
#else
	return 0.0;
#endif
}
