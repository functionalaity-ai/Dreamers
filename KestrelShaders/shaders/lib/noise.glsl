// Kestrel Shaders - noise. Owns the noisetex sampler (shaders/textures/noise.png, 256x256):
//   R     tileable smooth value noise, 8-texel features (noiseSmooth, p in texels)
//   G     tileable smooth value noise, 16-texel features (noiseSmooth2)
//   B     64x64 void-and-cluster blue noise, tiled 4x4
//   A     white noise
// Iris binds noisetex with linear filtering and repeat wrap; exact blue-noise values use
// texelFetch, which ignores filtering.

uniform sampler2D noisetex;

// Interleaved gradient noise (Jimenez 2014).
float ign(vec2 pixel) {
	return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}
float ignTemporal(vec2 pixel) {
#ifdef KS_TAA_ACTIVE
	pixel += 5.588238 * float(frameCounter - (frameCounter / 64) * 64);
#endif
	return ign(pixel);
}

// R2 low-discrepancy sequence (Roberts).
vec2 r2Sequence(int n) {
	return fract(0.5 + float(n) * vec2(0.7548776662, 0.5698402910));
}

// Blue noise from the B channel, animated per frame when TAA is on.
float blueNoise(vec2 pixel) {
	ivec2 p = ivec2(mod(pixel, 64.0));
	float n = texelFetch(noisetex, p, 0).b;
#ifdef KS_TAA_ACTIVE
	n = fract(n + 0.61803398875 * float(frameCounter - (frameCounter / 256) * 256));
#endif
	return n;
}

// Integer hash (PCG-style) for procedural values.
uint hashU(uint x) {
	x ^= x >> 16u;
	x *= 0x7feb352du;
	x ^= x >> 15u;
	x *= 0x846ca68bu;
	x ^= x >> 16u;
	return x;
}
float hash12(vec2 p) {
	uvec2 q = uvec2(ivec2(floor(p)) + ivec2(32768));
	return float(hashU(q.x + hashU(q.y))) * (1.0 / 4294967295.0);
}
float hash13(vec3 p) {
	uvec3 q = uvec3(ivec3(floor(p)) + ivec3(32768));
	return float(hashU(q.x + hashU(q.y + hashU(q.z)))) * (1.0 / 4294967295.0);
}

// Smooth tileable value noise from the texture (period 256 texels).
float noiseSmooth(vec2 p) {
	return texture(noisetex, p * (1.0 / 256.0)).r;
}
float noiseSmooth2(vec2 p) {
	return texture(noisetex, p * (1.0 / 256.0)).g;
}

// 3D value noise built from two texture lookups (z slices offset in xy).
float noise3D(vec3 p) {
	float zi = floor(p.z);
	float zf = p.z - zi;
	zf = zf * zf * (3.0 - 2.0 * zf);
	vec2 offs = vec2(37.0, 17.0);
	float a = texture(noisetex, (p.xy + offs * zi + 0.5) * (1.0 / 256.0)).r;
	float b = texture(noisetex, (p.xy + offs * (zi + 1.0) + 0.5) * (1.0 / 256.0)).r;
	return mix(a, b, zf);
}

// Rotate a 2D vector (used for per-pixel kernel rotation).
vec2 rotate2(vec2 v, float angle) {
	float c = cos(angle);
	float s = sin(angle);
	return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
