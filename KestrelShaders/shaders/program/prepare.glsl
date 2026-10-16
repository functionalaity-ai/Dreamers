// Kestrel Shaders - prepare (world0): builds the 192x108 sky-view LUT and the per-frame light
// constants in colortex7 rows 108-111. Everything that needs sun, sky, ambient or fog colour
// reads these, so the whole frame agrees on the light. Program: PROGRAM_PREPARE.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"
#include "/lib/atmosphere.glsl"

// ============================================================================ vertex
#ifdef STAGE_VERTEX
void main() {
	gl_Position = vec4(gl_Vertex.xy * 2.0 - 1.0, 0.0, 1.0);
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#include "/lib/directives.glsl"

/* RENDERTARGETS: 7 */
layout(location = 0) out vec4 outLut;

struct SkyContext {
	vec3 origin;
	vec3 sunF;
	vec3 moonF;
	float sunE;
	float moonE;
	float haze;
	float rain;
};

SkyContext makeContext() {
	SkyContext c;
	vec3 sunP = sunDirPlayer();
	c.sunF = normalize(toSunFrame(sunP, sunP));
	c.moonF = -c.sunF;
	c.rain = rainStrength;
	c.haze = float(ATMOSPHERE_DENSITY) * (1.0 + 4.0 * c.rain);
	c.sunE = KS_SUN_ILLUMINANCE;
	float phase = float(moonPhase);
	float lit = 0.12 + 0.88 * (cos(phase * (PI / 4.0)) * 0.5 + 0.5);
	c.moonE = KS_SUN_ILLUMINANCE * KS_MOON_RATIO * lit;
	c.origin = atmosphereOrigin(eyeAltitude);
	return c;
}

// Overcast sky radiance under rain: grey, brightest overhead, scaled by the light's height.
vec3 overcastRadiance(SkyContext c, vec3 dir) {
	float day = clamp01(c.sunF.y + 0.08) * c.sunE * 0.016 + clamp01(c.moonF.y + 0.08) * c.moonE * 0.016;
	float grad = 0.65 + 0.35 * clamp01(dir.y);
	return vec3(0.82, 0.86, 0.92) * day * grad * mix(1.0, 0.55, thunderStrength);
}

// Lightning: the storm clouds light up while a bolt exists, flickering, brightest for a
// close strike. Every sky colour and ambient term reads this LUT, so the whole frame flashes.
float lightningFlash() {
#ifdef IS_IRIS
	if (lightningBoltPosition.w <= 0.0) return 0.0;
	float d = length(lightningBoltPosition.xz);
	float flicker = step(0.3, fract(sin(floor(frameTimeCounter * 18.0) * 12.9898) * 43758.5453));
	return flicker / (1.0 + d * d * (1.0 / (128.0 * 128.0)));
#else
	return 0.0;
#endif
}

vec3 skyModel(SkyContext c, vec3 dir, int steps) {
	vec3 T;
	vec3 L = integrateScattering(c.origin, dir, c.sunF, c.sunE, c.moonF, c.moonE, c.haze, steps, T);
	L = mix(L, overcastRadiance(c, dir), c.rain * 0.85);
	// Airglow and starlight floor so a moonless night is dark blue rather than black.
	L += vec3(0.0005, 0.0007, 0.0012) * clamp01(dir.y + 0.2);
	L += vec3(0.80, 0.86, 1.0) * (0.35 * lightningFlash()) * (0.4 + 0.6 * clamp01(dir.y + 0.3));
	return max(L, vec3(0.0));
}

// Sky irradiance on an up-facing surface: cosine-weighted Fibonacci hemisphere, 16 samples.
vec3 skyIrradianceUp(SkyContext c) {
	vec3 sum = vec3(0.0);
	for (int i = 0; i < 16; i++) {
		float fi = (float(i) + 0.5) / 16.0;
		float r = sqrt(fi);
		float phi = float(i) * GOLDEN_ANGLE;
		vec3 d = vec3(r * cos(phi), sqrt(max(1.0 - fi, 0.0)), r * sin(phi));
		sum += skyModel(c, d, 8);
	}
	// Cosine-weighted estimator: E = pi * mean(L).
	return sum * (PI / 16.0);
}

vec3 directIrradiance(SkyContext c, vec3 lightDir, float E) {
	if (lightDir.y < -0.05) return vec3(0.0);
	vec3 T = transmittanceToTop(c.origin, lightDir, c.haze) * horizonSoftness(c.origin, lightDir);
	// Rain clouds block most of the direct light.
	return E * T * (1.0 - 0.9 * c.rain);
}

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	SkyContext c = makeContext();

	if (px.y < int(SKY_LUT_H)) {
		vec2 uv = vec2(px) / vec2(SKY_LUT_W - 1.0, SKY_LUT_H - 1.0);
		vec3 dir = skyLutDirection(uv);
		outLut = vec4(sanitizeHDR(skyModel(c, dir, ATMOSPHERE_STEPS)), 1.0);
		return;
	}

	vec4 value = vec4(0.0);
	if (px.y == SKY_CONST_ROW) {
		if (px.x == 0) {
			value.rgb = directIrradiance(c, c.sunF, c.sunE);
		} else if (px.x == 1) {
			value.rgb = directIrradiance(c, c.moonF, c.moonE);
		} else if (px.x >= 2 && px.x <= 4) {
			vec3 up = skyIrradianceUp(c);
			vec3 sunD = directIrradiance(c, c.sunF, c.sunE) * clamp01(c.sunF.y);
			vec3 moonD = directIrradiance(c, c.moonF, c.moonE) * clamp01(c.moonF.y);
			vec3 ground = (up + sunD + moonD) * ATM_GROUND_ALBEDO;
			if (px.x == 2) value.rgb = up;
			else if (px.x == 3) value.rgb = 0.5 * up + 0.5 * ground;
			else value.rgb = ground;
		} else if (px.x == 5) {
			vec3 h = vec3(0.0);
			for (int i = 0; i < 4; i++) {
				float az = (float(i) + 0.5) * (PI / 4.0);
				h += skyModel(c, normalize(vec3(cos(az), 0.04, sin(az))), 8);
			}
			value.rgb = h * 0.25;
		} else if (px.x == 6) {
			value.x = smoothstep(-0.1, 0.15, c.sunF.y);
			value.y = smoothstep(-0.1, 0.15, c.moonF.y);
			value.z = c.rain;
		}
	}
	outLut = vec4(sanitizeHDR(value.rgb), value.a);
}
#endif
