// Kestrel Shaders - shared constants and math helpers.
// Everything here is valid GLSL 3.30 and uses no 4.00 built-ins (no fma, bitfield*, findMSB,
// packUnorm*, textureGather), so every stage can stay at #version 330.

#define PI 3.14159265359
#define TAU 6.28318530718
#define HALF_PI 1.57079632679
#define RCP_PI 0.31830988618
#define GOLDEN_ANGLE 2.39996322973
#define EPS 1e-6
// Largest value written to R11F_G11F_B10F/RGBA16F targets (format maxima are about 65000).
#define KS_HDR_MAX 60000.0

// frameTimeCounter wraps to 0 every 3600 s. Speeds passed through these macros complete a
// whole number of cycles per hour, so the wrap is seamless (they fold to constants).
//   KS_LOOP_W(w): angular frequency in rad/s, rounded to a multiple of 2*pi/3600.
//   KS_LOOP_V(v): noise-texture scroll speed in texels/s, rounded to a multiple of 256/3600
//                 (the noise texture repeats every 256 texels).
#define KS_LOOP_W(w) (floor((w) * 572.957795 + 0.5) * 0.00174532925)
#define KS_LOOP_V(v) (floor((v) * 14.0625 + 0.5) * 0.0711111111)

float clamp01(float x) { return clamp(x, 0.0, 1.0); }
vec2 clamp01(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 clamp01(vec3 x) { return clamp(x, 0.0, 1.0); }
vec4 clamp01(vec4 x) { return clamp(x, 0.0, 1.0); }

float sq(float x) { return x * x; }
vec2 sq(vec2 x) { return x * x; }
vec3 sq(vec3 x) { return x * x; }

float pow4(float x) { float x2 = x * x; return x2 * x2; }
float pow5(float x) { float x2 = x * x; return x2 * x2 * x; }

float maxOf(vec2 v) { return max(v.x, v.y); }
float maxOf(vec3 v) { return max(v.x, max(v.y, v.z)); }
float minOf(vec2 v) { return min(v.x, v.y); }
float minOf(vec3 v) { return min(v.x, min(v.y, v.z)); }

float safeSqrt(float x) { return sqrt(max(x, 0.0)); }
float safePow(float x, float y) { return pow(max(x, 1e-6), y); }
vec3 safePow(vec3 x, float y) { return pow(max(x, vec3(1e-6)), vec3(y)); }
float safeLog2(float x) { return log2(max(x, 1e-8)); }
float safeDiv(float a, float b) { return a / (abs(b) < EPS ? (b < 0.0 ? -EPS : EPS) : b); }

vec3 safeNormalize(vec3 v) {
	float l2 = dot(v, v);
	return l2 > 1e-12 ? v * inversesqrt(l2) : vec3(0.0, 0.0, 1.0);
}

float remap01(float x, float lo, float hi) { return clamp01((x - lo) / max(hi - lo, EPS)); }

float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Range clamp is the primary guard (fast-math translation may drop isnan/isinf).
vec3 sanitizeHDR(vec3 c) {
	c = clamp(c, vec3(0.0), vec3(KS_HDR_MAX));
	if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
	return c;
}
float sanitizeF(float x, float lo, float hi) {
	x = clamp(x, lo, hi);
	if (isnan(x) || isinf(x)) x = lo;
	return x;
}

// sRGB transfer functions.
vec3 srgbToLinear(vec3 c) {
	c = clamp01(c);
	vec3 lo = c / 12.92;
	vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
	return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.04045))));
}
vec3 linearToSrgb(vec3 c) {
	c = clamp01(c);
	vec3 lo = c * 12.92;
	vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
	return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.0031308))));
}

// Blackbody colour (linear sRGB, normalised to luminance 1) for 1000..12000 K.
// Fit after Tanner Helland's published approximation, converted to linear.
vec3 blackbody(float kelvin) {
	float t = clamp(kelvin, 1000.0, 12000.0) / 100.0;
	vec3 c;
	c.r = t <= 66.0 ? 1.0 : clamp01(1.29293618606 * pow(t - 60.0, -0.1332047592));
	c.g = t <= 66.0 ? clamp01(0.39008157876 * log(t) - 0.63184144378)
	                : clamp01(1.12989086089 * pow(t - 60.0, -0.0755148492));
	c.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp01(0.54320678911 * log(t - 10.0) - 1.19625408914));
	c = srgbToLinear(c);
	return c / max(luminance(c), 1e-4);
}

// Henyey-Greenstein phase function.
float phaseHG(float cosTheta, float g) {
	float g2 = g * g;
	float denom = 1.0 + g2 - 2.0 * g * cosTheta;
	return (1.0 - g2) / (4.0 * PI * denom * sqrt(max(denom, 1e-4)));
}
float phaseRayleigh(float cosTheta) {
	return 3.0 / (16.0 * PI) * (1.0 + cosTheta * cosTheta);
}

// Octahedral normal encoding for RG16 targets.
vec2 octWrap(vec2 v) {
	return (1.0 - abs(v.yx)) * vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0);
}
vec2 encodeNormal(vec3 n) {
	n /= (abs(n.x) + abs(n.y) + abs(n.z) + 1e-6);
	vec2 e = n.z >= 0.0 ? n.xy : octWrap(n.xy);
	return e * 0.5 + 0.5;
}
vec3 decodeNormal(vec2 e) {
	e = e * 2.0 - 1.0;
	vec3 n = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
	float t = clamp01(-n.z);
	n.x += n.x >= 0.0 ? -t : t;
	n.y += n.y >= 0.0 ? -t : t;
	return safeNormalize(n);
}

// Spherical helpers.
vec3 sphericalDir(float azimuth, float elevation) {
	float ce = cos(elevation);
	return vec3(ce * cos(azimuth), sin(elevation), ce * sin(azimuth));
}

// Reflect-safe refraction: returns zero vector on total internal reflection (no NaN on Intel).
vec3 refractSafe(vec3 I, vec3 N, float eta) {
	float cosi = dot(N, I);
	float k = 1.0 - eta * eta * (1.0 - cosi * cosi);
	if (k < 0.0) return vec3(0.0);
	return eta * I - (eta * cosi + sqrt(k)) * N;
}

// Schlick Fresnel.
float fresnelSchlick(float cosTheta, float f0) {
	return f0 + (1.0 - f0) * pow5(1.0 - clamp01(cosTheta));
}
vec3 fresnelSchlick(float cosTheta, vec3 f0) {
	return f0 + (1.0 - f0) * pow5(1.0 - clamp01(cosTheta));
}
