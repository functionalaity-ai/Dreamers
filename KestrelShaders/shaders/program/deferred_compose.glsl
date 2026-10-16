// Kestrel Shaders - deferred2: composes the opaque frame before translucents.
//   Sky pixels: physical sky (LUT), sun disc, stars and moon from skytextured, 2D clouds.
//   Opaque pixels: AO through the ambient fraction, deferred environment reflections with
//   screen-space reflections (MEDIUM+), underwater caustics, then fog.
// Writes the fogged scene to colortex0 and, for water refraction/SSR, the unfogged opaque
// scene to colortex4. Always enabled; also carries the pack-wide buffer directives.
// Program: PROGRAM_DEFERRED2.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"

// ============================================================================ vertex
#ifdef STAGE_VERTEX
void main() {
	gl_Position = fullscreenPosition(gl_Vertex.xy, renderScale());
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#include "/lib/directives.glsl"
#include "/lib/noise.glsl"
#include "/lib/material.glsl"
#include "/lib/atmosphere.glsl"
#include "/lib/sky.glsl"
#include "/lib/lighting.glsl"
#include "/lib/fog.glsl"
#include "/lib/clouds.glsl"
#include "/lib/water.glsl"

uniform sampler2D colortex0;
uniform sampler2D depthtex0;
#ifdef KS_GBUFFER_DATA
uniform sampler2D colortex1;
uniform sampler2D colortex2;
#endif
#ifdef SSAO
uniform sampler2D colortex6;
#endif
#ifdef KS_DEFERRED_SPEC
uniform sampler2D colortex3;
#endif
#ifdef KS_SSR_OPAQUE_ACTIVE
uniform sampler2D colortex5;
#include "/lib/ssr.glsl"
#endif

#ifdef KS_WATER_ADVANCED
/* RENDERTARGETS: 0,4 */
#else
/* RENDERTARGETS: 0 */
#endif
layout(location = 0) out vec4 outColor;
#ifdef KS_WATER_ADVANCED
layout(location = 1) out vec4 outOpaque;
#endif

#ifdef SSAO
// Depth-aware bilinear upsample of the half-resolution AO.
float upsampleAO(vec2 bufUV, float linZ) {
	vec2 halfSize = max(floor(viewSize() * 0.5), vec2(1.0));
	vec2 p = bufUV * halfSize - 0.5;
	vec2 base = floor(p);
	vec2 f = p - base;
	ivec2 maxQ = ivec2(halfSize * renderScale()) - 1;
	float wsum = 0.0;
	float acc = 0.0;
	for (int j = 0; j < 2; j++) {
		for (int i = 0; i < 2; i++) {
			ivec2 q = clamp(ivec2(base) + ivec2(i, j), ivec2(0), max(maxQ, ivec2(0)));
			vec2 t = texelFetch(colortex6, q, 0).rg;
			float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
			float wd = exp(-abs(t.g - linZ) / max(0.04 * linZ, 0.02));
			float w = wb * wd + 1e-5;
			acc += t.r * w;
			wsum += w;
		}
	}
	return clamp01(acc / wsum);
}
#endif

#ifdef KS_SKY_LUT
// Analytic sun disc (0.5 degree radius) with limb darkening, coloured by the atmosphere.
vec3 sunDisc(vec3 dir) {
	const float radius = 0.0087;
	float cosA = dot(dir, sunDirPlayer());
	if (cosA < cos(radius)) return vec3(0.0);
	float x = clamp01(acos(clamp(cosA, -1.0, 1.0)) / radius);
	float mu = sqrt(max(1.0 - x * x, 0.0));
	float limb = 1.0 - 0.6 * (1.0 - mu);
	vec3 L = sunIrradiance() / (PI * radius * radius) * limb;
	return min(L, vec3(20000.0));
}
#endif

void main() {
	vec2 bufUV = gl_FragCoord.xy * viewTexel();
	vec2 sceneUV = bufToSceneUV(bufUV);
	float depth = texture(depthtex0, bufUV).r;
	vec3 color = texture(colortex0, bufUV).rgb;
	vec3 viewPos = screenToView(sceneUV, depth);
	vec3 playerPos = viewToPlayer(viewPos);
	vec3 dir = normalize(playerPos);
	vec3 opaque;

	if (depth >= 1.0) {
		// ---- Sky.
#ifdef KS_SKY_LUT
		vec3 skyC = skyRadiance(dir) + sunDisc(dir) * (1.0 - rainStrength);
		// Stars and moon from the vanilla sky programs sit behind the haze near the horizon.
		skyC += color * smoothstep(-0.02, 0.15, dir.y);
		vec4 cl = sampleClouds(dir, 1);
		skyC = skyC * cl.a + cl.rgb;
#else
		vec3 skyC = color + dimensionFogColor() * 0.6;
#endif
		opaque = skyC;
		color = applyAtmosphere(skyC, dir * far, true);
	} else {
		// ---- Opaque surfaces.
#if DEBUG_VIEW == 6
		// Raw shadow visibility from the gbuffers: no AO, reflections or fog on top.
		outColor = vec4(color, 1.0);
	#ifdef KS_WATER_ADVANCED
		outOpaque = vec4(color, 1.0);
	#endif
		return;
#endif
#ifdef KS_GBUFFER_DATA
		vec4 data = texture(colortex1, bufUV);
		int code = decodeMaterial(data.b);
		float ao = 1.0;
		if (code != MAT_NONE) {
	#ifdef SSAO
			ao = upsampleAO(bufUV, -viewPos.z);
			color *= 1.0 - data.a * (1.0 - ao);
	#endif
	#ifdef KS_DEFERRED_SPEC
			if (code != MAT_HAND) {
				vec4 spec = texture(colortex3, bufUV);
				vec3 f0 = srgbToLinear(spec.rgb);
				float smoothness = spec.a;
				float roughness = 1.0 - smoothness;
				vec3 n = decodeNormal(texture(colortex2, bufUV).rg);
				vec3 V = -normalize(viewPos);
				float NdotV = max(dot(n, V), 1e-3);
				vec3 Fenv = envBRDFApprox(f0, roughness, NdotV);
				vec3 R = reflect(-V, n);
				vec3 Rp = viewToPlayerDir(R);
				float sky = data.g;
		#ifdef KS_SKY_LUT
				vec3 rdir = normalize(vec3(Rp.x, max(Rp.y, 0.0), Rp.z));
				vec3 envSky = skyRadiance(rdir);
				if (smoothness > 0.5) {
					vec4 cl = sampleClouds(rdir, 0);
					envSky = envSky * cl.a + cl.rgb;
				}
				vec3 nPlayer = normalize(viewToPlayerDir(n));
				vec3 envRough = skyIrradiance(nPlayer) * RCP_PI;
				vec3 env = mix(envSky, envRough, clamp01(roughness * roughness * 1.5)) * smoothstep(0.55, 1.0, sky);
		#else
				vec3 env = skyRadiance(Rp);
		#endif
		#ifdef KS_SSR_OPAQUE_ACTIVE
				if (smoothness >= KS_SSR_MIN_SMOOTHNESS) {
					float jitter = ignTemporal(gl_FragCoord.xy);
					SSRHit hit = traceScreenRay(depthtex0, viewPos, R, KS_SSR_STEPS, 4, jitter);
					if (hit.valid > 0.0) {
						// Hit colour from last frame's resolved image, reprojected.
						float hd = texture(depthtex0, clampToRendered(sceneToBufUV(hit.sceneUV), viewSize())).r;
						vec3 hp = viewToPlayer(screenToView(hit.sceneUV, hd));
						vec3 prev = reprojectPlayer(hp);
						if (all(greaterThan(prev.xy, vec2(0.0))) && all(lessThan(prev.xy, vec2(1.0)))) {
							vec3 hitColor = texture(colortex5, prev.xy).rgb;
							float k = hit.valid * smoothstep(KS_SSR_MIN_SMOOTHNESS, 1.0, smoothness);
							env = mix(env, hitColor, k);
						}
					}
				}
		#endif
				// Specular occlusion from AO (Lagarde's approximation).
				float specOcc = clamp01(pow(NdotV + ao, exp2(-16.0 * roughness - 1.0)) - 1.0 + ao);
				color += Fenv * env * specOcc;
			}
	#endif
		}
#endif

#ifdef KS_CAUSTICS
		// Light patterns on sunlit surfaces while the camera is under water.
		if (isEyeInWater == 1) {
			float c = waterCaustics(worldPosWrapped(playerPos));
			float k = daylightFactor() * smoothstep(0.0, 4.0, length(playerPos)) * 0.5;
			color *= mix(1.0, c, k);
		}
#endif
		opaque = color;
		color = applyAtmosphere(color, playerPos, false);
#if DEBUG_VIEW == 5 && defined(KS_GBUFFER_DATA)
		color = vec3(ao);
#endif
	}

	outColor = vec4(sanitizeHDR(color), 1.0);
#ifdef KS_WATER_ADVANCED
	outOpaque = vec4(sanitizeHDR(opaque), 1.0);
#endif
}
#endif
