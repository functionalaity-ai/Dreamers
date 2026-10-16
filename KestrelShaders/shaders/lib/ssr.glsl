// Kestrel Shaders - screen-space reflections.
// Linear steps in screen space (NDC depth is affine along a projected line), IGN-jittered
// start, then binary refinement. The depth sampler is passed in so callers choose
// depthtex0 or depthtex1. Requires: common, uniforms, space.

struct SSRHit {
	vec2 sceneUV;   // hit position (unscaled scene UV)
	float valid;    // 0..1 confidence including edge fade
};

SSRHit traceScreenRay(sampler2D depthTex, vec3 viewPos, vec3 rayDir, int steps, int refine, float jitter) {
	SSRHit hit;
	hit.sceneUV = vec2(0.0);
	hit.valid = 0.0;

	// Keep the ray in front of the near plane.
	float rayLen = far * 1.2;
	if (rayDir.z > 0.0) rayLen = min(rayLen, (-near * 1.05 - viewPos.z) / rayDir.z);
	if (rayLen <= 0.0) return hit;

	vec3 ss0 = viewToScreen(viewPos);
	vec3 ss1 = viewToScreen(viewPos + rayDir * rayLen);
	vec3 delta = ss1 - ss0;

	// Clip the segment to the screen so the steps are spent on visible pixels.
	vec2 room = vec2(
		delta.x > 0.0 ? (1.0 - ss0.x) / delta.x : (delta.x < 0.0 ? -ss0.x / delta.x : 1e6),
		delta.y > 0.0 ? (1.0 - ss0.y) / delta.y : (delta.y < 0.0 ? -ss0.y / delta.y : 1e6));
	float clipT = clamp(min(room.x, room.y), 0.0, 1.0);
	delta *= clipT;

	vec3 stepV = delta / float(steps);
	vec3 p = ss0 + stepV * jitter;
	float s = renderScale();
	vec2 jit = taaJitterUV();

	bool found = false;
	for (int i = 0; i < KS_MAX_RAY_STEPS; i++) {
		if (i >= steps) break;
		p += stepV;
		if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) break;
		float d = texture(depthTex, p.xy * s + jit).r;
		if (d < p.z && d < 1.0) {
			// Thickness test in linear depth, relative to the step length.
			float zRay = linearizeDepth(p.z);
			float zScene = linearizeDepth(d);
			float thickness = max(abs(linearizeDepth(p.z + stepV.z) - zRay) * 2.0, 0.25 + zScene * 0.02);
			if (zRay - zScene < thickness) {
				found = true;
				break;
			}
		}
	}
	if (!found) return hit;

	// Binary refinement between the last two positions.
	vec3 lo = p - stepV;
	vec3 hi = p;
	for (int i = 0; i < 6; i++) {
		if (i >= refine) break;
		vec3 mid = 0.5 * (lo + hi);
		float d = texture(depthTex, mid.xy * s + jit).r;
		if (d < mid.z) hi = mid; else lo = mid;
	}
	hit.sceneUV = hi.xy;

	// Fade near screen edges and for rays pointing back at the camera.
	vec2 edge = smoothstep(vec2(0.0), vec2(0.07), hi.xy) * (1.0 - smoothstep(vec2(0.93), vec2(1.0), hi.xy));
	hit.valid = edge.x * edge.y * clamp01(1.0 - rayDir.z * 1.5);
	return hit;
}
