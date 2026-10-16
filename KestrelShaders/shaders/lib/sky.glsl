// Kestrel Shaders - sky lookups and light constants for every program after prepare.
// Overworld: reads the sky-view LUT and constants rows from colortex7 (built by prepare).
// Nether and End: no LUT; ambient and fog come from the dimension's own colours.
// Requires: common, uniforms, space, atmosphere (for the LUT mapping).

// Constants row 108 of colortex7.
#define SKYC_SUN 0
#define SKYC_MOON 1
#define SKYC_E_UP 2
#define SKYC_E_SIDE 3
#define SKYC_E_DOWN 4
#define SKYC_HORIZON 5
#define SKYC_FLAGS 6

#ifdef KS_SKY_LUT
uniform sampler2D colortex7;

vec4 skyConst(int index) {
	return texelFetch(colortex7, ivec2(index, SKY_CONST_ROW), 0);
}

vec3 skyRadiance(vec3 dirPlayer) {
	vec3 sd = toSunFrame(dirPlayer, sunDirPlayer());
	vec2 uv = skyLutCoord(sd);
	vec2 tc = vec2((uv.x * (SKY_LUT_W - 1.0) + 0.5) / SKY_LUT_W,
	               (uv.y * (SKY_LUT_H - 1.0) + 0.5) / SKY_TEX_H);
	return max(texture(colortex7, tc).rgb, vec3(0.0));
}

vec3 sunIrradiance() { return skyConst(SKYC_SUN).rgb; }
vec3 moonIrradiance() { return skyConst(SKYC_MOON).rgb; }
vec3 horizonRadiance() { return skyConst(SKYC_HORIZON).rgb; }

// Irradiance from the shadow-casting light (sun by day, moon by night).
vec3 lightIrradiance() {
	return dot(shadowLightPosition, sunPosition) > 0.0 ? sunIrradiance() : moonIrradiance();
}

// Sky irradiance onto a surface with player-space normal n (unoccluded).
vec3 skyIrradiance(vec3 nPlayer) {
	vec3 down = skyConst(SKYC_E_DOWN).rgb;
	// Up-facing surfaces also receive some light bounced from the sunlit surroundings.
	vec3 up = skyConst(SKYC_E_UP).rgb + 0.25 * down;
	vec3 side = skyConst(SKYC_E_SIDE).rgb;
	float y = nPlayer.y;
	return y >= 0.0 ? mix(side, up, y) : mix(side, down, -y);
}

// Fog/haze colour seen in a direction: the sky just above the horizon in that azimuth.
vec3 fogRadiance(vec3 dirPlayer) {
	vec3 d = dirPlayer;
	d.y = max(d.y, 0.04);
	return skyRadiance(normalize(d));
}

float daylightFactor() { return skyConst(SKYC_FLAGS).x; }

#else

// Ambient radiance of the dimension's air: the Nether takes the biome's fog colour (crimson,
// warped, soul sand valley, basalt deltas), the End is a dim violet.
vec3 dimensionFogColor() {
#ifdef DIM_NETHER
	vec3 f = srgbToLinear(fogColor);
	return f / max(maxOf(f), 0.05) * 0.022 + vec3(0.0025, 0.0010, 0.0007);
#else
	return vec3(0.0075, 0.0060, 0.0115);
#endif
}

vec3 skyRadiance(vec3 dirPlayer) { return dimensionFogColor(); }
vec3 sunIrradiance() { return vec3(0.0); }
vec3 moonIrradiance() { return vec3(0.0); }
vec3 horizonRadiance() { return dimensionFogColor(); }
vec3 lightIrradiance() { return vec3(0.0); }
vec3 skyIrradiance(vec3 nPlayer) {
	// Nether and End have no sky: ambient irradiance from the surrounding air, slightly
	// stronger from above.
	return dimensionFogColor() * PI * (0.85 + 0.15 * nPlayer.y);
}
// In-scattered fog radiance: the air's albedo (~0.6) times its ambient radiance.
vec3 fogRadiance(vec3 dirPlayer) { return dimensionFogColor() * 0.6; }
float daylightFactor() { return 0.0; }

#endif
