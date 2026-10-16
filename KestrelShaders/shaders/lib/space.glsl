// Kestrel Shaders - coordinate spaces, render scale and TAA jitter.
//
// Render scale (TAAU, vertex-shrink method): every gbuffers vertex shader maps the scene into
// the bottom-left [0,s] rectangle of the framebuffer, at native pixel density, and adds a
// sub-pixel jitter. Pre-resolve fullscreen passes shrink their quad to the same rectangle.
//   bufUV   = gl_FragCoord.xy / viewSize   texture coordinate into any colortex (any size)
//   sceneUV = (bufUV - jitter) / s          0..1 over the rendered image, unjittered,
//                                           used to unproject depth
// composite2 reconstructs the full-resolution image from that rectangle.

vec2 viewSize() { return vec2(viewWidth, viewHeight); }
vec2 viewTexel() { return 1.0 / vec2(viewWidth, viewHeight); }

float renderScale() {
#ifdef KS_TAA_ACTIVE
	#if RENDER_SCALE_MODE == 1
	return clamp(float(AUTO_TARGET_HEIGHT) / max(viewHeight, 1.0), 0.5, 1.0);
	#else
	return float(RENDER_SCALE);
	#endif
#else
	return 1.0;
#endif
}

// Radical inverse in base b (b = 2 or 3), loop bounded by a constant.
float halton(int index, int base) {
	float f = 1.0;
	float r = 0.0;
	int i = index;
	for (int k = 0; k < 10; k++) {
		if (i <= 0) break;
		f /= float(base);
		r += f * float(i - (i / base) * base);
		i /= base;
	}
	return r;
}

// FSR2 rule: 8 * (display / render)^2 phases, clamped to 8..32.
int jitterPhaseCount(float s) {
	return clamp(int(ceil(8.0 / (s * s))), 8, 32);
}

// Jitter in framebuffer pixels (-0.5..0.5). One rendered pixel = one framebuffer pixel.
vec2 taaJitterPx() {
#ifdef KS_TAA_ACTIVE
	int n = jitterPhaseCount(renderScale());
	int idx = frameCounter - (frameCounter / n) * n + 1;
	return vec2(halton(idx, 2), halton(idx, 3)) - 0.5;
#else
	return vec2(0.0);
#endif
}
vec2 taaJitterUV() { return taaJitterPx() * viewTexel(); }

// Apply the render-scale shrink and the jitter to a clip-space position (all gbuffers).
vec4 applyScaleAndJitter(vec4 clip) {
#ifdef KS_TAA_ACTIVE
	float s = renderScale();
	clip.xy = clip.xy * s + clip.w * (s - 1.0);
	clip.xy += taaJitterPx() * (2.0 / viewSize()) * clip.w;
#endif
	return clip;
}

vec2 bufToSceneUV(vec2 bufUV) { return (bufUV - taaJitterUV()) / renderScale(); }
vec2 sceneToBufUV(vec2 sceneUV) { return sceneUV * renderScale() + taaJitterUV(); }

// Clamp a coordinate into the valid rendered rectangle of a buffer with the given size.
vec2 clampToRendered(vec2 bufUV, vec2 bufferSize) {
	float s = renderScale();
	vec2 hi = vec2(s) - 0.5 / bufferSize;
	return clamp(bufUV, 0.5 / bufferSize, hi);
}

// ---------------------------------------------------------------- Projection
vec3 screenToView(vec2 sceneUV, float depth) {
	vec4 ndc = vec4(vec3(sceneUV, depth) * 2.0 - 1.0, 1.0);
	vec4 v = gbufferProjectionInverse * ndc;
	return v.xyz / v.w;
}
vec3 viewToScreen(vec3 viewPos) {
	vec4 clip = gbufferProjection * vec4(viewPos, 1.0);
	return (clip.xyz / clip.w) * 0.5 + 0.5;
}
// View distance along -z for a depth-buffer value. Uses the projection itself: Minecraft's
// far plane is several times the render distance ('far'), so near/far would be wrong.
float linearizeDepth(float depth) {
	float z = depth * 2.0 - 1.0;
	return gbufferProjection[3][2] / min(z + gbufferProjection[2][2], -1e-6);
}

vec3 viewToPlayer(vec3 viewPos) {
	return mat3(gbufferModelViewInverse) * viewPos + gbufferModelViewInverse[3].xyz;
}
vec3 playerToView(vec3 playerPos) {
	return mat3(gbufferModelView) * playerPos + gbufferModelView[3].xyz;
}
vec3 viewToPlayerDir(vec3 viewDir) { return mat3(gbufferModelViewInverse) * viewDir; }
vec3 playerToViewDir(vec3 playerDir) { return mat3(gbufferModelView) * playerDir; }

// Camera movement since last frame, precise far from the origin on Iris.
vec3 cameraDelta() {
#ifdef IS_IRIS
	return vec3(cameraPositionInt - previousCameraPositionInt) + (cameraPositionFract - previousCameraPositionFract);
#else
	return cameraPosition - previousCameraPosition;
#endif
}

// World position with small magnitude for noise/animation (wraps every 4096 blocks).
vec3 worldPosWrapped(vec3 playerPos) {
#ifdef IS_IRIS
	vec3 camInt = vec3(cameraPositionInt - (cameraPositionInt / 4096) * 4096);
	return playerPos + camInt + cameraPositionFract;
#else
	return playerPos + mod(cameraPosition, 4096.0);
#endif
}

// Previous-frame screen UV (unscaled, history space) of a player-space position.
vec3 reprojectPlayer(vec3 playerPos) {
	vec3 prevPlayer = playerPos + cameraDelta();
	vec4 prevView = gbufferPreviousModelView * vec4(prevPlayer, 1.0);
	vec4 prevClip = gbufferPreviousProjection * prevView;
	return (prevClip.xyz / max(prevClip.w, 1e-5)) * 0.5 + 0.5;
}

// ---------------------------------------------------------------- Light directions
vec3 sunDirView() { return normalize(sunPosition); }
vec3 lightDirView() { return normalize(shadowLightPosition); }
vec3 sunDirPlayer() { return normalize(mat3(gbufferModelViewInverse) * sunPosition); }
vec3 lightDirPlayer() { return normalize(mat3(gbufferModelViewInverse) * shadowLightPosition); }
vec3 upDirView() { return normalize(upPosition); }

// Fullscreen helpers. Iris draws a 0..1 quad; uv is the buffer coordinate of the corner.
vec4 fullscreenPosition(vec2 corner, float scale) {
	return vec4(corner * scale * 2.0 - 1.0, 0.0, 1.0);
}
