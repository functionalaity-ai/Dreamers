// Kestrel Shaders - translucent gbuffers, all forward-shaded and alpha-blended into colortex0.
// Water computes waves, refraction (from the opaque copy in colortex4), depth absorption,
// screen-space reflections, Fresnel and fog itself, so rain, particles and held items drawn
// later blend correctly on top. Glass, ice, slime, honey, portals, translucent entities, text
// and translucent held items are lit forward.
// Programs: PROGRAM_WATER, PROGRAM_HAND_WATER, PROGRAM_ENTITIES_TRANSLUCENT,
//           PROGRAM_BLOCK_TRANSLUCENT.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"
#include "/lib/material.glsl"

#ifdef PROGRAM_WATER
	#define KS_IS_TERRAIN 1
#endif

// ============================================================================ vertex
#ifdef STAGE_VERTEX
#include "/lib/waving.glsl"

#ifdef KS_IS_TERRAIN
in vec4 mc_Entity;
#endif

out vec2 vTexcoord;
out vec2 vLmcoord;
out vec4 vColor;
out vec3 vViewPos;
out vec3 vNormal;
flat out int vBlockId;

void main() {
	vTexcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	vLmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
	vColor = gl_Color;
	vec3 n = gl_NormalMatrix * gl_Normal;
	vNormal = dot(n, n) > 1e-6 ? normalize(n) : vec3(0.0, 0.0, 1.0);
	vec4 viewPos = gl_ModelViewMatrix * gl_Vertex;
	vBlockId = 0;
#ifdef KS_IS_TERRAIN
	vBlockId = int(floor(mc_Entity.x + 0.5));
	if (vBlockId == ID_WATER) {
		vec3 player = viewToPlayer(viewPos.xyz);
		vec3 nPlayer = viewToPlayerDir(vNormal);
		if (nPlayer.y > 0.5) {
			player.y += waterVertexWave(worldPosWrapped(player));
			viewPos.xyz = playerToView(player);
		}
	}
#endif
	vViewPos = viewPos.xyz;
	gl_Position = applyScaleAndJitter(gl_ProjectionMatrix * viewPos);
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#include "/lib/noise.glsl"
#include "/lib/atmosphere.glsl"
#include "/lib/sky.glsl"
#include "/lib/shadows.glsl"
#include "/lib/lighting.glsl"
#include "/lib/fog.glsl"
#include "/lib/water.glsl"
#include "/lib/clouds.glsl"

uniform sampler2D gtexture;
#if defined(PROGRAM_WATER) && defined(KS_WATER_ADVANCED)
	#define KS_WATER_FULL 1
uniform sampler2D colortex4;
uniform sampler2D depthtex1;
#include "/lib/ssr.glsl"
#endif

in vec2 vTexcoord;
in vec2 vLmcoord;
in vec4 vColor;
in vec3 vViewPos;
in vec3 vNormal;
flat in int vBlockId;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor;

#if KS_SSR_STEPS >= 16
	#define KS_SSR_REFINE 4
#else
	#define KS_SSR_REFINE 3
#endif

// Direct light for a translucent surface: shadow (opaque casters only) and leak fix.
vec3 directLight(vec3 playerPos, vec3 geoNPlayer, float NdotL, float sky) {
	vec3 lightE = lightIrradiance();
	if (maxOf(lightE) <= 0.0) return vec3(0.0);
	vec3 shadow;
#ifdef KS_SHADOWS_ACTIVE
	float fade;
	vec3 sh = sampleShadow(playerPos, geoNPlayer, abs(NdotL), gl_FragCoord.xy, true, fade);
	shadow = mix(sh, vec3(fakeShadow(sky)), fade);
#else
	shadow = vec3(fakeShadow(sky));
#endif
#ifdef KS_SKY_LUT
	shadow *= skyLeakFactor(sky);
#endif
	return lightE * shadow;
}

// Sky reflection with clouds, faded where the sky is not visible.
vec3 skyReflection(vec3 Rp, float sky) {
#ifdef KS_SKY_LUT
	vec3 dir = normalize(vec3(Rp.x, max(Rp.y, 0.0), Rp.z));
	vec3 c = skyRadiance(dir);
	vec4 cl = sampleClouds(dir, 0);
	c = c * cl.a + cl.rgb;
	return c * smoothstep(0.55, 1.0, sky);
#else
	return skyRadiance(Rp);
#endif
}

void main() {
	vec4 tex = texture(gtexture, vTexcoord);
	vec4 baseColor = tex * vColor;
	int id = vBlockId;
	vec2 lm = clamp01((vLmcoord - 1.0 / 32.0) * (16.0 / 15.0));
	float sky = lm.y;
	vec3 playerPos = viewToPlayer(vViewPos);
	vec3 V = -normalize(vViewPos);
	vec3 Lv = lightDirView();
	vec3 geoN = normalize(gl_FrontFacing ? vNormal : -vNormal);
	vec3 geoNPlayer = normalize(viewToPlayerDir(geoN));
	float dist = length(vViewPos);

#ifdef PROGRAM_WATER
	if (id == ID_WATER) {
		vec3 worldPos = worldPosWrapped(playerPos);
		bool top = geoNPlayer.y > 0.5;
		bool fromBelow = isEyeInWater == 1;
		vec3 nPlayer;
	#ifdef KS_WATER_FULL
		nPlayer = top ? waterWaveNormal(worldPos.xz, WATER_WAVE_OCTAVES, dist) : geoNPlayer;
	#else
		nPlayer = top ? waterSimpleNormal(worldPos.xz) : geoNPlayer;
	#endif
		if (fromBelow) nPlayer = -nPlayer;
		vec3 n = normalize(playerToViewDir(nPlayer));
		float NdotV = clamp01(dot(n, V));
		vec3 tint = srgbToLinear(vColor.rgb);
		vec3 sigma = waterAbsorption(tint);

		// Fresnel, with total internal reflection when looking up from below.
		float F = fresnelSchlick(NdotV, WATER_F0);
		if (fromBelow) {
			vec3 t = refractSafe(-V, n, 1.333);
			F = dot(t, t) < 1e-6 ? 1.0 : F;
		}

		// Light reaching the water volume, used for its in-scattered colour.
		vec3 Edir = directLight(playerPos, geoNPlayer, dot(geoN, Lv), sky);
		vec3 Eamb = skyIrradiance(vec3(0.0, 1.0, 0.0)) * skyLightCurve(sky) + blockIrradiance(lm.x) + vec3(KS_MIN_AMBIENT_E);
		vec3 inscatter = (Edir * clamp01(dot(Lv, upDirView())) * 0.06 + Eamb * 0.05) * vec3(0.10, 0.42, 0.50) * mix(vec3(1.0), tint * 2.0, 0.35);

		vec3 refracted;
	#ifdef KS_WATER_FULL
		vec2 bufUV = gl_FragCoord.xy * viewTexel();
		vec2 sceneUV = bufToSceneUV(bufUV);
		float d1 = texture(depthtex1, bufUV).r;
		vec3 floorView = screenToView(sceneUV, d1);
		float depthBehind = max(length(floorView) - dist, 0.0);
		vec2 offset = n.xy * 0.035 * clamp01(depthBehind * 0.3) / (1.0 + dist * 0.03);
		vec2 rUV = clampToRendered(bufUV + offset * renderScale(), viewSize());
		float d1r = texture(depthtex1, rUV).r;
		vec3 floorR = screenToView(bufToSceneUV(rUV), d1r);
		if (length(floorR) < dist) {
			rUV = bufUV;
			floorR = floorView;
		}
		vec3 behind = texture(colortex4, rUV).rgb;
		if (!fromBelow) {
			float through = max(length(floorR) - dist, 0.0);
			if (d1r >= 1.0) through = 64.0;
			vec3 T = exp(-sigma * through);
		#ifdef KS_CAUSTICS
			if (d1r < 1.0) {
				vec3 floorWorld = worldPosWrapped(viewToPlayer(floorR));
				float c = waterCaustics(floorWorld);
				float k = smoothstep(0.0, 1.5, through) * exp(-through * 0.12) * daylightFactor() * smoothstep(0.6, 1.0, sky);
				behind *= mix(1.0, c, 0.6 * k);
			}
		#endif
			refracted = behind * T + inscatter * (1.0 - T);
		} else {
			refracted = behind;
		}
	#else
		refracted = inscatter;
	#endif

		// Reflection: SSR on the opaque depth with sky fallback.
		vec3 R = reflect(-V, n);
		vec3 Rp = viewToPlayerDir(R);
		vec3 reflection;
		if (fromBelow) {
			reflection = inscatter;
		} else {
			reflection = skyReflection(Rp, sky);
	#ifdef KS_WATER_FULL
			if (F > 0.025 || dist < 24.0) {
				float jitter = ignTemporal(gl_FragCoord.xy);
				SSRHit hit = traceScreenRay(depthtex1, vViewPos, R, KS_SSR_STEPS, KS_SSR_REFINE, jitter);
				if (hit.valid > 0.0) {
					vec3 hitColor = texture(colortex4, clampToRendered(sceneToBufUV(hit.sceneUV), viewSize())).rgb;
					reflection = mix(reflection, hitColor, hit.valid);
				}
			}
	#endif
		}

		vec3 color = mix(refracted, reflection, F);
		if (!fromBelow) color += specularGGX(n, V, Lv, WATER_ROUGHNESS, vec3(WATER_F0)) * Edir;
		color = applyAtmosphere(color, playerPos, false);
	#ifdef KS_WATER_FULL
		float alpha = 1.0;
	#else
		float alpha = mix(0.55, 1.0, F);
	#endif
		outColor = vec4(sanitizeHDR(color), alpha);
		return;
	}
#endif

	// ---- Everything else: glass, ice, slime, honey, portals, entities, text, held items.
#ifndef PROGRAM_WATER
	if (baseColor.a < alphaTestRef) discard;
#endif
	if (baseColor.a < 0.004) discard;
	Surface s;
	s.albedo = srgbToLinear(baseColor.rgb);
	s.geoNormal = geoN;
	s.normal = geoN;
	defaultMaterial(id, s.albedo, s);
	if (id == ID_GLASS || id == ID_ICE) {
		s.roughness = id == ID_GLASS ? 0.06 : 0.12;
		s.f0 = vec3(0.04);
	} else if (id == ID_SLIME_HONEY) {
		s.roughness = 0.25;
	} else if (id == ID_PORTAL) {
		s.emission = 1.4;
	}
	vec3 nPlayer = normalize(viewToPlayerDir(s.normal));
	float NdotL = dot(s.normal, Lv);
	vec3 Edir = directLight(playerPos, geoNPlayer, NdotL, sky);
#ifdef KS_SKY_LUT
	vec3 Esky = skyIrradiance(nPlayer) * skyLightCurve(sky);
#else
	vec3 Esky = skyIrradiance(nPlayer);
#endif
	vec3 Eamb = Esky + blockIrradiance(lm.x) + heldLightIrradiance(vViewPos, s.normal) + vec3(KS_MIN_AMBIENT_E + nightVision * KS_NIGHT_VISION_E);
	float NdotV = max(dot(s.normal, V), 1e-3);
	vec3 Fenv = envBRDFApprox(s.f0, s.roughness, NdotV);
	vec3 diffuse = s.albedo * RCP_PI * (Edir * clamp01(NdotL) + Eamb) * (1.0 - Fenv);
	vec3 spec = specularGGX(s.normal, V, Lv, s.roughness, s.f0) * Edir;
	vec3 Rp = viewToPlayerDir(reflect(-V, s.normal));
	spec += Fenv * skyReflection(Rp, sky);

	vec3 color = diffuse + s.albedo * s.emission;
	// Reflections are not attenuated by the surface's own transparency.
	float alpha = baseColor.a;
	color += spec / max(alpha, 0.25);

#if defined(IRIS_INLINE_GLINT) && (defined(PROGRAM_HAND_WATER) || defined(PROGRAM_ENTITIES_TRANSLUCENT))
	if (mc_hasGlint()) {
		float glintScale = KS_GLINT_GAIN * (luminance(Eamb + lightIrradiance() * 0.15) + 0.02);
		color += srgbToLinear(clamp01(mc_sampleGlint())) * glintScale;
	}
#endif

#ifndef PROGRAM_HAND_WATER
	color = applyAtmosphere(color, playerPos, false);
#endif
	outColor = vec4(sanitizeHDR(color), alpha);
}
#endif
