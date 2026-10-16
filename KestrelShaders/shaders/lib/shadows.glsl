// Kestrel Shaders - shadow map distortion and filtering. Owns every shadow sampler.
// Iris enables the shadow pass for any program that references a shadow sampler, so they
// are declared only under KS_SHADOWS_ACTIVE (SHADOWS on and the Overworld).
//
// With SEPARATE_HARDWARE_SAMPLERS (listed in iris.features.optional) shadowtex0/1 are raw
// depth and shadowtex0HW/1HW are the depth-compare samplers; without it shadowtex0/1 are the
// compare samplers themselves (shadowHardwareFiltering = true in directives.glsl).

// Distortion shared by shadow.vsh and every lookup.
#define SHADOW_DISTORT 0.9
float shadowDistortFactor(vec2 p) {
	return (1.0 - SHADOW_DISTORT) + length(p) * SHADOW_DISTORT;
}
vec3 distortShadowClip(vec3 p) {
	return vec3(p.xy / shadowDistortFactor(p.xy), p.z * 0.5);
}

// The shadow program includes this file for the distortion only (KS_NO_SHADOW_SAMPLERS).
#if defined(KS_SHADOWS_ACTIVE) && !defined(KS_NO_SHADOW_SAMPLERS)

#ifdef KS_HW_SAMPLERS
uniform sampler2DShadow shadowtex0HW;
	#ifdef KS_COLORED_SHADOWS
uniform sampler2DShadow shadowtex1HW;
	#endif
	#if KS_SHADOW_FILTER == 3
uniform sampler2D shadowtex0;
	#endif
	#define KS_SHADOW_CMP0 shadowtex0HW
	#define KS_SHADOW_CMP1 shadowtex1HW
#else
uniform sampler2DShadow shadowtex0;
	#ifdef KS_COLORED_SHADOWS
uniform sampler2DShadow shadowtex1;
	#endif
	#define KS_SHADOW_CMP0 shadowtex0
	#define KS_SHADOW_CMP1 shadowtex1
#endif
#ifdef KS_COLORED_SHADOWS
uniform sampler2D shadowcolor0;
#endif

vec3 playerToShadowClip(vec3 playerPos) {
	vec4 sv = shadowModelView * vec4(playerPos, 1.0);
	return (shadowProjection * sv).xyz;
}

// World-space size of one shadow texel at shadow-clip radius r (radial, worst case).
float shadowTexelWorldSize(float r) {
	float f = (1.0 - SHADOW_DISTORT) + r * SHADOW_DISTORT;
	return 2.0 * shadowDistance / float(shadowMapResolution) * f * f / (1.0 - SHADOW_DISTORT);
}

// 0 inside the shadow map, 1 where it must fade out to the lightmap fallback.
float shadowEdgeFade(vec3 shadowClip) {
	float r = length(shadowClip.xy);
	return smoothstep(0.82, 0.97, r);
}

const vec2 kPoisson8[8] = vec2[8](
	vec2(-0.7071, 0.7071), vec2(-0.0000, -0.8750), vec2(0.5303, 0.5303), vec2(-0.6250, -0.0000),
	vec2(0.3536, -0.3536), vec2(-0.0000, 0.3750), vec2(-0.1768, -0.1768), vec2(0.1250, 0.0000));

// opaqueOnly: ignore translucent casters (water surfaces must not shadow themselves).
vec3 shadowTap(vec3 coord, bool opaqueOnly) {
#ifdef KS_COLORED_SHADOWS
	if (opaqueOnly) return vec3(texture(KS_SHADOW_CMP1, coord));
	float s0 = texture(KS_SHADOW_CMP0, coord);
	if (s0 > 0.999) return vec3(1.0);
	float s1 = texture(KS_SHADOW_CMP1, coord);
	if (s1 < 0.001) return vec3(0.0);
	vec4 c = texture(shadowcolor0, coord.xy);
	vec3 tint = mix(vec3(1.0), c.rgb, clamp01(c.a));
	return vec3(s0) + vec3(s1 - s0) * tint;
#else
	return vec3(texture(KS_SHADOW_CMP0, coord));
#endif
}

// Shadow visibility (rgb for coloured shadows). playerPos is the receiver, geoNormalPlayer
// its geometric normal, pixel the fragment coordinate for per-pixel kernel rotation.
vec3 sampleShadow(vec3 playerPos, vec3 geoNormalPlayer, float NdotL, vec2 pixel, bool opaqueOnly, out float edgeFade) {
	vec3 sc0 = playerToShadowClip(playerPos);
	edgeFade = shadowEdgeFade(sc0);
	if (edgeFade >= 1.0) return vec3(1.0);

	// Normal-offset bias, grows with texel size and at grazing angles.
	float texelWorld = shadowTexelWorldSize(length(sc0.xy));
	float offset = texelWorld * (0.7 + 1.6 * (1.0 - clamp01(NdotL)));
	offset = min(offset, 0.6);
	vec3 sc = playerToShadowClip(playerPos + geoNormalPlayer * offset);
	vec3 coord = distortShadowClip(sc) * 0.5 + 0.5;
	coord.z -= 0.00008;
	if (any(lessThan(coord, vec3(0.0))) || any(greaterThan(coord, vec3(1.0)))) return vec3(1.0);

	float texel = 1.0 / float(shadowMapResolution);

#if KS_SHADOW_FILTER == 0
	return shadowTap(coord, opaqueOnly);
#else
	float angle = ignTemporal(pixel) * TAU;
	#if KS_SHADOW_FILTER == 1
	vec3 acc = vec3(0.0);
	for (int i = 0; i < 4; i++) {
		float a = angle + float(i) * HALF_PI;
		vec2 o = vec2(cos(a), sin(a)) * (1.25 * texel);
		acc += shadowTap(vec3(coord.xy + o, coord.z), opaqueOnly);
	}
	return acc * 0.25;
	#else
	float radius = 2.0 * texel;
		#if KS_SHADOW_FILTER == 3
	// PCSS-lite: average blocker depth from 4 raw-depth taps sets the penumbra radius.
	float blockers = 0.0;
	float blockerDepth = 0.0;
	for (int i = 0; i < 4; i++) {
		vec2 o = rotate2(kPoisson8[i * 2], angle) * (8.0 * texel);
		float d = texture(shadowtex0, coord.xy + o).r;
		if (d < coord.z) {
			blockers += 1.0;
			blockerDepth += d;
		}
	}
	if (blockers > 0.0) {
		blockerDepth /= blockers;
		// coord.z = clipZ * 0.25 + 0.5, and clipZ = P[2][2] * viewZ for the ortho projection.
		float dz = (coord.z - blockerDepth) * 4.0 / max(abs(shadowProjection[2][2]), 1e-5);
		radius = clamp(dz * 0.012 / max(texelWorld, 1e-4), 1.0, 9.0) * texel;
	}
		#endif
	vec3 acc = vec3(0.0);
	for (int i = 0; i < 8; i++) {
		vec2 o = rotate2(kPoisson8[i], angle) * radius;
		acc += shadowTap(vec3(coord.xy + o, coord.z), opaqueOnly);
	}
	return acc * 0.125;
	#endif
#endif
}

#endif // KS_SHADOWS_ACTIVE && !KS_NO_SHADOW_SAMPLERS

