// Kestrel Shaders - screen-space ambient occlusion at half resolution.
//   AO_QUALITY 1: normal-oriented SSAO, 4 samples.
//   AO_QUALITY 2/3: ground-truth AO (Jimenez et al. 2016), 2 slices x 3 steps / 3 x 4.
// Samplers are passed in. Requires: common, uniforms, space.

float aoFalloff(float distSq, float radiusSq) {
	return clamp01(1.0 - distSq / radiusSq);
}

float computeSSAO(sampler2D depthTex, vec3 viewPos, vec3 viewNormal, float noise, float noise2) {
	const int N = 4;
	float radius = 0.6;
	float occl = 0.0;
	float s = renderScale();
	vec2 jit = taaJitterUV();
	for (int i = 0; i < N; i++) {
		// Cosine-weighted hemisphere sample around the normal (Fibonacci + per-pixel rotation).
		float fi = (float(i) + noise) / float(N);
		float phi = (float(i) * GOLDEN_ANGLE) + noise2 * TAU;
		float r = sqrt(fi);
		vec3 t = normalize(abs(viewNormal.y) < 0.99 ? cross(viewNormal, vec3(0.0, 1.0, 0.0)) : cross(viewNormal, vec3(1.0, 0.0, 0.0)));
		vec3 b = cross(viewNormal, t);
		vec3 h = t * (r * cos(phi)) + b * (r * sin(phi)) + viewNormal * sqrt(max(1.0 - fi, 0.0));
		vec3 samplePos = viewPos + h * radius * mix(0.35, 1.0, fi);
		vec3 ss = viewToScreen(samplePos);
		if (ss.x < 0.0 || ss.y < 0.0 || ss.x > 1.0 || ss.y > 1.0) continue;
		float d = texture(depthTex, ss.xy * s + jit).r;
		vec3 scenePos = screenToView(ss.xy, d);
		float behind = scenePos.z - samplePos.z;
		if (behind > 0.02) {
			vec3 diff = scenePos - viewPos;
			occl += aoFalloff(dot(diff, diff), radius * radius * 4.0);
		}
	}
	return clamp01(1.0 - occl / float(N));
}

float computeGTAO(sampler2D depthTex, vec3 viewPos, vec3 viewNormal, vec2 sceneUV, float noise, float noise2) {
#if KS_AO_QUALITY >= 3
	const int SLICES = 3;
	const int STEPS = 4;
#else
	const int SLICES = 2;
	const int STEPS = 3;
#endif
	float radiusWorld = 1.2;
	float s = renderScale();
	vec2 jit = taaJitterUV();
	vec3 V = normalize(-viewPos);
	// Screen-space radius of the world radius at this depth.
	float projScale = gbufferProjection[1][1] * 0.5 / max(-viewPos.z, 0.05);
	float screenRadius = min(radiusWorld * projScale, 0.12);
	if (screenRadius * viewHeight < 1.5) return 1.0;

	float vis = 0.0;
	for (int sl = 0; sl < SLICES; sl++) {
		float phi = (float(sl) + noise) * (PI / float(SLICES));
		// Screen direction in UV units: one UV-y unit spans aspectRatio UV-x units in pixels.
		vec2 omega = vec2(cos(phi) / aspectRatio, sin(phi));
		vec3 dir = vec3(cos(phi), sin(phi), 0.0);
		vec3 orthoDir = dir - dot(dir, V) * V;
		vec3 axis = normalize(cross(dir, V));
		vec3 projN = viewNormal - axis * dot(viewNormal, axis);
		float projLen = length(projN);
		if (projLen < 1e-4) continue;
		float signN = sign(dot(orthoDir, projN));
		float cosN = clamp(dot(projN, V) / projLen, -1.0, 1.0);
		float n = signN * acos(cosN);

		for (int side = 0; side < 2; side++) {
			float sideSign = side == 0 ? 1.0 : -1.0;
			float horizonCos = -1.0;
			for (int st = 0; st < STEPS; st++) {
				float f = (float(st) + noise2) / float(STEPS);
				vec2 uv = sceneUV + omega * (sideSign * f * f * screenRadius + sideSign * 1.5 / viewHeight);
				if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
				float d = texture(depthTex, uv * s + jit).r;
				vec3 sp = screenToView(uv, d);
				vec3 delta = sp - viewPos;
				float len2 = dot(delta, delta);
				float c = dot(delta, V) * inversesqrt(max(len2, 1e-6));
				// Fade samples that are far away so distant geometry does not occlude.
				c = mix(-1.0, c, aoFalloff(len2, radiusWorld * radiusWorld * 4.0));
				horizonCos = max(horizonCos, c);
			}
			// side 0 searches toward +omega (positive horizon angle), side 1 toward -omega.
			float hAngle = sideSign * acos(clamp(horizonCos, -1.0, 1.0));
			float h = n + clamp(hAngle - n, -HALF_PI, HALF_PI);
			vis += projLen * (cosN + 2.0 * h * sin(n) - cos(2.0 * h - n)) * 0.25;
		}
	}
	return clamp01(vis / float(SLICES));
}
