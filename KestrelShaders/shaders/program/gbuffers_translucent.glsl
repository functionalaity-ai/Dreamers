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
// Translucent entities (players included) and the translucent hand tag colortex1 so TAA and
// the deferred passes know what they are (shaders.properties turns blending off for it).
#if defined(KS_BUFFER_BLEND) && (defined(PROGRAM_ENTITIES_TRANSLUCENT) || defined(PROGRAM_HAND_WATER))
	#define KS_WRITE_MATERIAL 1
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
		// Iris computes terrain normals from the vertex order, so the reversed copy of the
		// water top drawn for viewing from below faces down: displace both copies alike.
		if (abs(nPlayer.y) > 0.5) {
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
#ifdef PROGRAM_ENTITIES_TRANSLUCENT
uniform vec4 entityColor;
#endif
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

#ifdef KS_WRITE_MATERIAL
/* RENDERTARGETS: 0,1 */
#else
/* RENDERTARGETS: 0 */
#endif
layout(location = 0) out vec4 outColor;
#ifdef KS_WRITE_MATERIAL
layout(location = 1) out vec4 outData;
#endif

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
	vec3 dir = safeNormalize(vec3(Rp.x, max(Rp.y, 0.0), Rp.z));
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
		// Horizontal faces carry the waves. geoNPlayer faces the viewer, so its sign turns the
		// upward wave normal toward a viewer below the surface.
		bool top = abs(geoNPlayer.y) > 0.5;
		bool fromBelow = isEyeInWater == 1;
		vec3 nPlayer = geoNPlayer;
		if (top) {
	#ifdef KS_WATER_FULL
			nPlayer = waterWaveNormal(worldPos.xz, WATER_WAVE_OCTAVES, dist);
	#else
			nPlayer = waterSimpleNormal(worldPos.xz);
	#endif
			nPlayer *= sign(geoNPlayer.y);
		}
		vec3 n = normalize(playerToViewDir(nPlayer));
		float NdotV = clamp01(dot(n, V));
		vec3 tint = srgbToLinear(vColor.rgb);
		vec3 sigma = waterAbsorption(tint);

		// Fresnel. From below, Schlick uses the cosine on the air side, which rises smoothly to
		// total internal reflection at the edge of Snell's window.
		float F = fresnelSchlick(NdotV, WATER_F0);
		if (fromBelow) {
			vec3 t = refractSafe(-V, n, 1.333);
			F = dot(t, t) < 1e-6 ? 1.0 : fresnelSchlick(abs(dot(t, n)), WATER_F0);
		}

		// Light reaching the water volume, used for its in-scattered colour.
		vec3 Edir = directLight(playerPos, geoNPlayer, dot(geoN, Lv), sky);
		vec3 Eamb = skyIrradiance(vec3(0.0, 1.0, 0.0)) * skyLightCurve(sky) + blockIrradiance(lm.x) + vec3(minAmbientE());
		// Water-leaving radiance from scattering inside the volume: a few percent of the light.
		vec3 inscatter = (Edir * clamp01(dot(Lv, upDirView())) * 0.016 + Eamb * 0.022) * vec3(0.10, 0.42, 0.50) * mix(vec3(1.0), tint * 2.0, 0.35);

		vec3 refracted;
	#ifdef KS_WATER_FULL
		vec2 bufUV = gl_FragCoord.xy * viewTexel();
		vec2 sceneUV = bufToSceneUV(bufUV);
		float d1 = texture(depthtex1, bufUV).r;
		vec3 floorView = screenToView(sceneUV, d1);
		float depthBehind = max(length(floorView) - dist, 0.0);
		// Offset by the waves' tilt only, so calm water does not shift the image behind it.
		vec2 offset = (n.xy - geoN.xy) * 0.035 * clamp01(depthBehind * 0.3) / (1.0 + dist * 0.03);
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
#ifdef PROGRAM_ENTITIES_TRANSLUCENT
	// Hurt and freeze flash (players render through this program).
	baseColor.rgb = mix(baseColor.rgb, entityColor.rgb, entityColor.a);
#endif
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
	vec3 Elocal = blockIrradiance(lm.x) + heldLightIrradiance(vViewPos, s.normal) + vec3(minAmbientE());
	vec3 Eamb = Esky + Elocal;
	float NdotV = max(dot(s.normal, V), 1e-3);
	vec3 Fenv = envBRDFApprox(s.f0, s.roughness, NdotV);
	vec3 diffuse = s.albedo * RCP_PI * (Edir * clamp01(NdotL) + Eamb) * (1.0 - Fenv) * (1.0 - s.metalness);
	vec3 spec = specularGGX(s.normal, V, Lv, s.roughness, s.f0) * Edir;
	vec3 Rp = viewToPlayerDir(reflect(-V, s.normal));
	spec += Fenv * (skyReflection(Rp, sky) + Elocal * RCP_PI);

	// Reflections are not attenuated by the surface's own transparency.
	float alpha = baseColor.a;
	vec3 color = (diffuse + spec / max(alpha, 0.25)) * darknessLightScale() + s.albedo * s.emission;

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
#ifdef KS_WRITE_MATERIAL
	#ifdef PROGRAM_HAND_WATER
	outData = vec4(lm, encodeMaterial(MAT_HAND), 0.0);
	#else
	outData = vec4(lm, encodeMaterial(MAT_FORWARD), 0.0);
	#endif
#endif
}
#endif
