// Kestrel Shaders - bloom tile atlas in half-resolution colortex6.
// Tile i (0..BLOOM_LEVELS-1) is 2^-(i+1) of colortex6 per axis (1/4, 1/8, ... of the screen)
// and is filtered from source mip i+2. Tile 0 sits at the origin; tiles 1.. stack in a
// column at x = 0.5 (+2 texels), with 2-texel gaps.

vec4 bloomTileRect(int i, vec2 bufSize) {
	vec2 gap = 2.0 / bufSize;
	if (i == 0) return vec4(0.0, 0.0, 0.5, 0.5);
	float y = 0.0;
	for (int k = 1; k < 8; k++) {
		if (k >= i) break;
		y += exp2(-float(k + 1)) + gap.y;
	}
	float size = exp2(-float(i + 1));
	return vec4(0.5 + gap.x, y, size, size);
}

vec2 bloomBufferSize() { return max(floor(viewSize() * 0.5), vec2(1.0)); }

// 3x3 tent filter of a mip level, optionally Karis-weighted (tile 0) against fireflies.
vec3 bloomTent(sampler2D src, vec2 uv, float lod, bool karis) {
	vec2 texel = exp2(lod) * viewTexel();
	vec3 acc = vec3(0.0);
	float wsum = 0.0;
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			float w = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
			vec3 c = textureLod(src, uv + vec2(float(x), float(y)) * texel, lod).rgb;
			if (karis) w *= 1.0 / (1.0 + luminance(c));
			acc += c * w;
			wsum += w;
		}
	}
	return acc / wsum;
}

// Bilinear read of tile i at screen uv (used by final).
vec3 bloomTileSample(sampler2D atlas, int i, vec2 uv) {
	vec2 bufSize = bloomBufferSize();
	vec4 r = bloomTileRect(i, bufSize);
	vec2 halfTexel = 0.5 / bufSize;
	vec2 p = clamp(r.xy + uv * r.zw, r.xy + halfTexel, r.xy + r.zw - halfTexel);
	return texture(atlas, p).rgb;
}
