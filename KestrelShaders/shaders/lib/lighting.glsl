// Kestrel Shaders - BRDF and light assembly for forward-lit surfaces.
// Diffuse: Lambert. Specular: GGX with height-correlated Smith visibility and Schlick
// Fresnel, roughness clamped to avoid sun fireflies. All light in Kestrel units.

float ggxD(float NdotH, float a2) {
	float d = (NdotH * a2 - NdotH) * NdotH + 1.0;
	return a2 / max(PI * d * d, 1e-7);
}
float smithGGXCorrelated(float NdotV, float NdotL, float a2) {
	float gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
	float gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
	return 0.5 / max(gv + gl, 1e-6);
}

// Direct specular term (already multiplied by NdotL).
vec3 specularGGX(vec3 n, vec3 v, vec3 l, float roughness, vec3 f0) {
	float r = max(roughness, 0.03);
	float a = r * r;
	float a2 = a * a;
	vec3 h = normalize(v + l);
	float NdotL = clamp01(dot(n, l));
	float NdotV = max(dot(n, v), 1e-3);
	float NdotH = clamp01(dot(n, h));
	float VdotH = clamp01(dot(v, h));
	vec3 F = fresnelSchlick(VdotH, f0);
	return F * (ggxD(NdotH, a2) * smithGGXCorrelated(NdotV, NdotL, a2) * NdotL);
}

// Split-sum style environment Fresnel approximation (Karis / Lazarov fit).
vec3 envBRDFApprox(vec3 f0, float roughness, float NdotV) {
	const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
	const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
	vec4 r = roughness * c0 + c1;
	float a004 = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;
	vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
	return f0 * AB.x + AB.y;
}

// Block light: warm blackbody tint, inverse-square-like falloff with some reach.
vec3 blockLightColor() {
	return blackbody(float(BLOCKLIGHT_TEMPERATURE));
}
float blockLightFalloff(float lm) {
	float d = max(15.0 * (1.0 - lm), 0.0) + 1.0;
	return lm <= 0.0 ? 0.0 : mix(lm * lm * lm, 1.0 / (d * d), 0.5);
}
#define KS_BLOCKLIGHT_E 0.6
vec3 blockIrradiance(float lm) {
	return blockLightColor() * (KS_BLOCKLIGHT_E * blockLightFalloff(lm));
}

// Light from a held torch or glowing item, attenuated with distance from the camera.
vec3 heldLightIrradiance(vec3 viewPos, vec3 viewNormal) {
#ifdef HELD_LIGHT
	float level = float(max(heldBlockLightValue, heldBlockLightValue2));
	if (level <= 0.0) return vec3(0.0);
	float dist = length(viewPos);
	float lm = clamp01((level - dist) / 15.0);
	vec3 toCam = -viewPos / max(dist, 1e-3);
	float wrap = 0.35 + 0.65 * clamp01(dot(viewNormal, toCam));
	return blockIrradiance(lm) * wrap;
#else
	return vec3(0.0);
#endif
}

// Skylight curve: ambient from the sky falls off quickly once the sky is blocked.
float skyLightCurve(float sky) {
	return sky * sky;
}

// Minimum ambient so caves are dark but readable after eye adaptation.
#define KS_MIN_AMBIENT_E 0.002
#define KS_NIGHT_VISION_E 0.25

// Lightmap fallback: open sky is lit, anything under a roof is shadowed.
float fakeShadow(float skylight) {
	return smoothstep(13.5 / 15.0, 14.5 / 15.0, skylight);
}
// Stops sunlight leaking into enclosed spaces where the shadow map cannot see.
float skyLeakFactor(float skylight) {
	return smoothstep(0.0, 2.0 / 15.0, skylight);
}
