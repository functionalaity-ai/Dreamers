// Kestrel Shaders - physically based atmosphere (single scattering with a cheap
// multiple-scattering term), after Hillaire 2020 "A Scalable and Production Ready Sky and
// Atmosphere Rendering Technique" and the sebh/UnrealEngineSkyAtmosphere reference constants.
// Used by the prepare pass to build the sky-view LUT and the per-frame light constants.
//
// Units: lengths in metres, radiance and irradiance in Kestrel units (1.0 = 1000 cd/m^2).
// The LUT is indexed in a frame where +x points at the sun's azimuth, so the sky only depends
// on |azimuth| (the sky is symmetric about the sun's vertical plane).

#define ATM_GROUND_RADIUS 6360e3
#define ATM_TOP_RADIUS 6460e3
#define ATM_RAYLEIGH_SCATTER vec3(5.802e-6, 13.558e-6, 33.1e-6)
#define ATM_RAYLEIGH_HEIGHT 8000.0
#define ATM_MIE_SCATTER 3.996e-6
#define ATM_MIE_ABSORB 4.40e-6
#define ATM_MIE_HEIGHT 1200.0
#define ATM_MIE_G 0.78
#define ATM_OZONE_ABSORB vec3(0.650e-6, 1.881e-6, 0.085e-6)
#define ATM_OZONE_CENTER 25000.0
#define ATM_OZONE_HALF_WIDTH 15000.0
#define ATM_GROUND_ALBEDO 0.18

// Solar illuminance above the atmosphere, chosen so a white Lambertian surface facing the
// noon sun reads about 30 Kestrel units (Section 6.1 of the build spec).
#define KS_SUN_ILLUMINANCE 118.0
// Full-moon illuminance relative to the sun, compressed for playability (physical ~1/400000).
#define KS_MOON_RATIO (1.0 / 2000.0)

// LUT layout inside colortex7 (192 x 112).
#define SKY_LUT_W 192.0
#define SKY_LUT_H 108.0
#define SKY_TEX_H 112.0
#define SKY_CONST_ROW 108

// ---------------------------------------------------------------- Geometry
// Distance to the sphere of radius R from point p (relative to planet centre) along d,
// or -1 if missed. Returns the far intersection when inside.
float raySphereFar(vec3 p, vec3 d, float R) {
	float b = dot(p, d);
	float c = dot(p, p) - R * R;
	float h = b * b - c;
	if (h < 0.0) return -1.0;
	return -b + sqrt(h);
}
float raySphereNear(vec3 p, vec3 d, float R) {
	float b = dot(p, d);
	float c = dot(p, p) - R * R;
	float h = b * b - c;
	if (h < 0.0) return -1.0;
	float t = -b - sqrt(h);
	return t;
}

// ---------------------------------------------------------------- Media
struct AtmosphereSample {
	vec3 rayleighScatter;
	float mieScatter;
	vec3 extinction;
};

AtmosphereSample sampleAtmosphere(float height, float hazeMul) {
	AtmosphereSample s;
	float h = max(height, 0.0);
	float dR = exp(-h / ATM_RAYLEIGH_HEIGHT);
	float dM = exp(-h / ATM_MIE_HEIGHT) * hazeMul;
	float dO = max(0.0, 1.0 - abs(h - ATM_OZONE_CENTER) / ATM_OZONE_HALF_WIDTH);
	s.rayleighScatter = ATM_RAYLEIGH_SCATTER * dR;
	s.mieScatter = ATM_MIE_SCATTER * dM;
	s.extinction = s.rayleighScatter + vec3((ATM_MIE_SCATTER + ATM_MIE_ABSORB) * dM) + ATM_OZONE_ABSORB * dO;
	return s;
}

// Transmittance from point p (planet-centred) toward direction d to the top of the
// atmosphere, 4-step numeric optical depth. Zero if the ray hits the ground.
vec3 transmittanceToTop(vec3 p, vec3 d, float hazeMul) {
	float tGround = raySphereNear(p, d, ATM_GROUND_RADIUS);
	if (tGround > 0.0) return vec3(0.0);
	float tTop = raySphereFar(p, d, ATM_TOP_RADIUS);
	if (tTop <= 0.0) return vec3(1.0);
	vec3 od = vec3(0.0);
	float dt = tTop / 4.0;
	for (int i = 0; i < 4; i++) {
		float t = (float(i) + 0.5) * dt;
		vec3 q = p + d * t;
		AtmosphereSample a = sampleAtmosphere(length(q) - ATM_GROUND_RADIUS, hazeMul);
		od += a.extinction * dt;
	}
	return exp(-od);
}

// Soft fade for the sun disc crossing the horizon (avoids a hard terminator from the
// planet-sphere test at Minecraft's tiny camera heights).
float horizonSoftness(vec3 p, vec3 d) {
	float mu = dot(normalize(p), d);
	float muHorizon = -sqrt(max(1.0 - sq(ATM_GROUND_RADIUS / length(p)), 0.0));
	return smoothstep(muHorizon - 0.01, muHorizon + 0.02, mu);
}

// Integrate in-scattered radiance along a view ray. lightDir/lightE pairs for sun and moon.
// Returns radiance; transmittance along the view ray in viewT.
vec3 integrateScattering(vec3 origin, vec3 dir, vec3 sunDir, float sunE, vec3 moonDir, float moonE,
                         float hazeMul, int steps, out vec3 viewT) {
	float tTop = raySphereFar(origin, dir, ATM_TOP_RADIUS);
	float tGround = raySphereNear(origin, dir, ATM_GROUND_RADIUS);
	bool hitsGround = tGround > 0.0;
	float tMax = hitsGround ? tGround : tTop;
	tMax = max(tMax, 0.0);

	float cosSun = dot(dir, sunDir);
	float cosMoon = dot(dir, moonDir);
	float phRs = phaseRayleigh(cosSun);
	float phMs = phaseHG(cosSun, ATM_MIE_G);
	float phRm = phaseRayleigh(cosMoon);
	float phMm = phaseHG(cosMoon, ATM_MIE_G);

	// The sun and moon are opposite each other; skip whichever is well below the horizon
	// (uniform branch, coherent across the pass).
	bool sunUp = sunE > 0.0 && sunDir.y > -0.25;
	bool moonUp = moonE > 0.0 && moonDir.y > -0.25;

	vec3 L = vec3(0.0);
	vec3 T = vec3(1.0);
	float tPrev = 0.0;
	for (int i = 0; i < 16; i++) {
		if (i >= steps) break;
		// Quadratic step distribution: denser near the camera where haze matters.
		float f1 = (float(i) + 1.0) / float(steps);
		float t = tMax * f1 * f1;
		float dt = t - tPrev;
		float tMid = tPrev + 0.5 * dt;
		tPrev = t;

		vec3 q = origin + dir * tMid;
		float h = length(q) - ATM_GROUND_RADIUS;
		AtmosphereSample a = sampleAtmosphere(h, hazeMul);
		vec3 up = q / max(length(q), 1.0);

		vec3 Ts = vec3(0.0);
		vec3 Tm = vec3(0.0);
		if (sunUp) Ts = transmittanceToTop(q, sunDir, hazeMul) * horizonSoftness(q, sunDir);
		if (moonUp) Tm = transmittanceToTop(q, moonDir, hazeMul) * horizonSoftness(q, moonDir);

		vec3 scatterS = a.rayleighScatter * phRs + vec3(a.mieScatter * phMs);
		vec3 scatterM = a.rayleighScatter * phRm + vec3(a.mieScatter * phMm);
		// Multiple scattering, isotropic approximation: light that has already scattered
		// once, proportional to the local total scattering and to the light's elevation
		// (non-zero slightly below the horizon, which gives the twilight glow).
		vec3 scatterTotal = a.rayleighScatter + vec3(a.mieScatter);
		float msS = 0.24 * clamp01(dot(up, sunDir) + 0.18);
		float msM = 0.24 * clamp01(dot(up, moonDir) + 0.18);
		vec3 ms = scatterTotal * (msS * sunE + msM * moonE) * (1.0 / (4.0 * PI));

		vec3 S = (scatterS * Ts * sunE + scatterM * Tm * moonE) + ms;

		// Energy-conserving integration (Hillaire 2015, Frostbite).
		vec3 sampleT = exp(-a.extinction * dt);
		vec3 Sint = (S - S * sampleT) / max(a.extinction, vec3(1e-12));
		L += T * Sint;
		T *= sampleT;
	}

	// Ground reflection below the horizon (lit Lambertian ground seen through the haze).
	if (hitsGround) {
		vec3 gp = origin + dir * tMax;
		vec3 gUp = normalize(gp);
		vec3 Ts = transmittanceToTop(gp, sunDir, hazeMul);
		vec3 Tm = transmittanceToTop(gp, moonDir, hazeMul);
		vec3 Eg = Ts * sunE * clamp01(dot(gUp, sunDir)) + Tm * moonE * clamp01(dot(gUp, moonDir));
		L += T * Eg * (ATM_GROUND_ALBEDO * RCP_PI);
	}
	viewT = T;
	return L;
}

// Camera position in the planet frame. Minecraft heights barely change the sky, so the
// camera sits a few hundred metres up and climbs gently with the world height.
vec3 atmosphereOrigin(float altitudeBlocks) {
	float h = 250.0 + max(altitudeBlocks - 63.0, 0.0) * 2.0;
	return vec3(0.0, ATM_GROUND_RADIUS + h, 0.0);
}

// ---------------------------------------------------------------- LUT parameterisation
// u in 0..1 maps |azimuth from the sun| 0..pi; v in 0..1 maps elevation -pi/2..pi/2 with
// extra resolution near the horizon.
vec3 skyLutDirection(vec2 uv) {
	float az = uv.x * PI;
	float vc = uv.y * 2.0 - 1.0;
	float el = sign(vc) * vc * vc * HALF_PI;
	return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
}
vec2 skyLutCoord(vec3 dirSunFrame) {
	float el = asin(clamp(dirSunFrame.y, -1.0, 1.0));
	float az = atan(abs(dirSunFrame.z), dirSunFrame.x);
	float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / HALF_PI);
	return vec2(az / PI, v);
}

// Rotate a player-space direction into the sun frame (+x toward the sun's azimuth).
vec3 toSunFrame(vec3 dirPlayer, vec3 sunDirPlayer) {
	vec2 s = sunDirPlayer.xz;
	float l = length(s);
	vec2 a = l > 1e-4 ? s / l : vec2(1.0, 0.0);
	// Rotation taking 'a' to +x in the xz-plane.
	return vec3(dirPlayer.x * a.x + dirPlayer.z * a.y, dirPlayer.y, -dirPlayer.x * a.y + dirPlayer.z * a.x);
}
