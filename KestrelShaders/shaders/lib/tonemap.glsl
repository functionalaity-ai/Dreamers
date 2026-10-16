// Kestrel Shaders - tonemapping. Input is exposed linear HDR (Rec.709/sRGB primaries),
// output is display-linear sRGB in 0..1.
//   TONEMAP 0  AgX (default): Troy Sobotka's AgX, minimal polynomial fit by Benjamin
//              Wrensch, constants as published in three.js (MIT) and Filament (Apache-2.0).
//   TONEMAP 1  ACES fit (Stephen Hill's RRT+ODT approximation), punchier, hue-shifts.
//   TONEMAP 2  Khronos PBR Neutral (Khronos reference, Apache-2.0).

vec3 agxContrastApprox(vec3 x) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 tonemapAgX(vec3 color) {
	const mat3 srgbToRec2020 = mat3(
		vec3(0.6274, 0.0691, 0.0164),
		vec3(0.3293, 0.9195, 0.0880),
		vec3(0.0433, 0.0113, 0.8956));
	const mat3 rec2020ToSrgb = mat3(
		vec3(1.6605, -0.1246, -0.0182),
		vec3(-0.5876, 1.1329, -0.1006),
		vec3(-0.0728, -0.0083, 1.1187));
	const mat3 agxInset = mat3(
		vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
		vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
		vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
	const mat3 agxOutset = mat3(
		vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
		vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
		vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
	const float minEv = -12.47393;
	const float maxEv = 4.026069;

	color = srgbToRec2020 * color;
	color = agxInset * color;
	color = max(color, vec3(1e-10));
	color = clamp01((log2(color) - minEv) / (maxEv - minEv));
	color = agxContrastApprox(color);
	color = agxOutset * color;
	color = pow(max(color, vec3(0.0)), vec3(2.2));
	color = rec2020ToSrgb * color;
	return clamp01(color);
}

vec3 tonemapACES(vec3 color) {
	// Column-major constructors of Hill's row-major input and output matrices.
	const mat3 acesIn = mat3(
		0.59719, 0.07600, 0.02840,
		0.35458, 0.90834, 0.13383,
		0.04823, 0.01566, 0.83777);
	const mat3 acesOut = mat3(
		1.60475, -0.10208, -0.00327,
		-0.53108, 1.10813, -0.07276,
		-0.07367, -0.00605, 1.07602);
	color = acesIn * color;
	vec3 a = color * (color + 0.0245786) - 0.000090537;
	vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
	color = a / b;
	color = acesOut * color;
	return clamp01(color);
}

vec3 tonemapPBRNeutral(vec3 color) {
	const float startCompression = 0.8 - 0.04;
	const float desaturation = 0.15;
	float x = minOf(color);
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = maxOf(color);
	if (peak < startCompression) return clamp01(color);
	const float d = 1.0 - startCompression;
	float newPeak = 1.0 - d * d / (peak + d - startCompression);
	color *= newPeak / peak;
	float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
	return clamp01(mix(color, vec3(newPeak), g));
}

vec3 tonemap(vec3 color) {
#if TONEMAP == 1
	return tonemapACES(color * 0.9);
#elif TONEMAP == 2
	return tonemapPBRNeutral(color);
#else
	return tonemapAgX(color);
#endif
}
