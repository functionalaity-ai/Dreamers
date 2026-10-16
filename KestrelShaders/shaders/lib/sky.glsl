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
	vec3 up = skyConst(SKYC_E_UP).rgb;
	vec3 side = skyConst(SKYC_E_SIDE).rgb;
	vec3 down = skyConst(SKYC_E_DOWN).rgb;
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

vec3 dimensionFogColor() {
#ifdef DIM_NETHER
	vec3 f = srgbToLinear(fogColor);
	return f / max(maxOf(f), 0.05) * 0.04 + vec3(0.004, 0.0015, 0.001);
#else
	return vec3(0.010, 0.008, 0.016);
#endif
}

vec3 skyRadiance(vec3 dirPlayer) { return dimensionFogColor(); }
vec3 sunIrradiance() { return vec3(0.0); }
vec3 moonIrradiance() { return vec3(0.0); }
vec3 horizonRadiance() { return dimensionFogColor(); }
vec3 lightIrradiance() { return vec3(0.0); }
vec3 skyIrradiance(vec3 nPlayer) {
	// Nether and End have no sky; this is the dimension's ambient light.
	return dimensionFogColor() * (2.6 + 0.6 * nPlayer.y);
}
vec3 fogRadiance(vec3 dirPlayer) { return dimensionFogColor(); }
float daylightFactor() { return 0.0; }

#endif
