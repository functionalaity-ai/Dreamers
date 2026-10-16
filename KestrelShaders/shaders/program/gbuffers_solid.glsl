// Kestrel Shaders - opaque lit gbuffers: terrain (solid/cutout), block entities, entities and
// the solid hand. Forward direct + ambient lighting; writes lit linear HDR to colortex0 and
// the compact G-buffer (colortex1-3) that AO, deferred reflections and TAA need.
// Programs: PROGRAM_TERRAIN, PROGRAM_TERRAIN_SOLID, PROGRAM_TERRAIN_CUTOUT, PROGRAM_BLOCK,
//           PROGRAM_ENTITIES, PROGRAM_HAND.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"
#include "/lib/material.glsl"

#if defined(PROGRAM_TERRAIN) || defined(PROGRAM_TERRAIN_SOLID) || defined(PROGRAM_TERRAIN_CUTOUT)
	#define KS_IS_TERRAIN 1
#endif
#ifdef PROGRAM_HAND
	#define KS_IS_HAND 1
#endif
#ifdef PROGRAM_ENTITIES
	#define KS_IS_ENTITY 1
#endif
#ifdef PROGRAM_BLOCK
	#define KS_IS_BLOCK 1
#endif
#if defined(MC_TEXTURE_FORMAT_LAB_PBR) && PBR_MODE == 1
	#define KS_LABPBR 1
#endif

// ============================================================================ vertex
#ifdef STAGE_VERTEX
#include "/lib/waving.glsl"

#ifdef KS_IS_TERRAIN
in vec4 mc_Entity;
in vec4 at_midBlock;
#endif
#ifdef KS_LABPBR
in vec4 at_tangent;
#endif

out vec2 vTexcoord;
out vec2 vLmcoord;
out vec4 vColor;
out vec3 vViewPos;
out vec3 vNormal;
#ifdef KS_LABPBR
out vec4 vTangent;
#endif
flat out int vBlockId;

void main() {
	vTexcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	vLmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
	vColor = gl_Color;
	vec3 n = gl_NormalMatrix * gl_Normal;
	vNormal = dot(n, n) > 1e-6 ? normalize(n) : vec3(0.0, 0.0, 1.0);
#ifdef KS_LABPBR
	// End portals and gateways have no tangent; the fragment shader rebuilds one.
	vTangent = vec4(gl_NormalMatrix * at_tangent.xyz, at_tangent.w < 0.0 ? -1.0 : 1.0);
#endif
	vec4 viewPos = gl_ModelViewMatrix * gl_Vertex;
	vBlockId = 0;
#ifdef KS_IS_TERRAIN
	vBlockId = int(floor(mc_Entity.x + 0.5));
	if (isWavingId(vBlockId)) {
		vec3 player = viewToPlayer(viewPos.xyz);
		vec3 world = worldPosWrapped(player);
		player += waveOffset(vBlockId, world, at_midBlock.y < 0.0);
		viewPos.xyz = playerToView(player);
	}
#endif
	vViewPos = viewPos.xyz;
	gl_Position = applyScaleAndJitter(gl_ProjectionMatrix * viewPos);
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#include "/lib/directives.glsl"
#include "/lib/noise.glsl"
#include "/lib/atmosphere.glsl"
#include "/lib/sky.glsl"
#include "/lib/shadows.glsl"
#include "/lib/lighting.glsl"
#ifdef KS_CLOUD_SHADOWS
#include "/lib/clouds.glsl"
#endif

uniform sampler2D gtexture;
#ifdef KS_LABPBR
uniform sampler2D normals;
uniform sampler2D specular;
#endif
#ifdef KS_IS_ENTITY
uniform vec4 entityColor;
#endif

in vec2 vTexcoord;
in vec2 vLmcoord;
in vec4 vColor;
in vec3 vViewPos;
in vec3 vNormal;
#ifdef KS_LABPBR
in vec4 vTangent;
#endif
flat in int vBlockId;

#if defined(KS_DEFERRED_SPEC)
/* RENDERTARGETS: 0,1,2,3 */
#elif defined(KS_GBUFFER_DATA)
/* RENDERTARGETS: 0,1,2 */
#else
/* RENDERTARGETS: 0 */
#endif
layout(location = 0) out vec4 outColor;
#ifdef KS_GBUFFER_DATA
layout(location = 1) out vec4 outData;
layout(location = 2) out vec4 outNormal;
#endif
#ifdef KS_DEFERRED_SPEC
layout(location = 3) out vec4 outSpec;
#endif

void main() {
	vec4 baseColor = texture(gtexture, vTexcoord) * vColor;
#ifndef PROGRAM_TERRAIN_SOLID
	if (baseColor.a < alphaTestRef) discard;
#endif
#ifdef KS_IS_ENTITY
	baseColor.rgb = mix(baseColor.rgb, entityColor.rgb, entityColor.a);
#endif

	int id = vBlockId;
	Surface s;
	s.albedo = srgbToLinear(baseColor.rgb);
#if DEBUG_VIEW == 1
	s.albedo = vec3(0.5);
#endif
	s.geoNormal = normalize(gl_FrontFacing ? vNormal : -vNormal);
	s.normal = s.geoNormal;
	defaultMaterial(id, s.albedo, s);

	// Cross-model plants shade as if they faced up, like a field of real grass.
	if (id == ID_PLANT_SHORT || id == ID_PLANT_TALL_LOWER || id == ID_PLANT_TALL_UPPER || id == ID_CROPS) {
		s.normal = upDirView();
	}

#ifdef KS_LABPBR
	{
		vec4 sp = texture(specular, vTexcoord);
		vec4 nm = texture(normals, vTexcoord);
		// Iris fills a missing _s map with 0 in every channel: keep the default material then.
		if (any(greaterThan(sp, vec4(0.0)))) {
			float smoothness = sp.r;
			s.roughness = 1.0 - smoothness;
			float g = sp.g * 255.0;
			if (g <= 229.5) {
				s.f0 = vec3(sp.g);
				s.metalness = 0.0;
			} else {
				s.f0 = s.albedo;
				s.metalness = 1.0;
			}
			float b = sp.b * 255.0;
			if (g <= 229.5) {
				s.porosity = b <= 64.5 ? b / 64.0 : 0.0;
				s.sss = b > 64.5 ? (b - 65.0) / 190.0 : s.sss;
			}
			float e = sp.a * 255.0;
			if (e < 254.5) s.emission = max(s.emission, sp.a * 1.6);
		}
		vec2 nxy = nm.rg * 2.0 - 1.0;
		if (dot(nm.rgb, nm.rgb) > 0.01) {
			vec3 tn = vec3(nxy, sqrt(clamp01(1.0 - dot(nxy, nxy))));
			vec3 N = s.geoNormal;
			vec3 T = vTangent.xyz - N * dot(N, vTangent.xyz);
			if (dot(T, T) < 1e-8) T = abs(N.y) < 0.99 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0));
			T = normalize(T);
			// Iris sets at_tangent.w so that cross(T, N) * w follows the texture's v axis
			// (the convention labPBR packs are authored against).
			vec3 B = cross(T, N) * vTangent.w;
			s.normal = normalize(mat3(T, B, N) * tn);
			s.ao = nm.b;
		}
	}
#endif

	vec2 lm = clamp01((vLmcoord - 1.0 / 32.0) * (16.0 / 15.0));
	float sky = lm.y;
	vec3 playerPos = viewToPlayer(vViewPos);
	vec3 nPlayer = normalize(viewToPlayerDir(s.normal));
	vec3 geoNPlayer = normalize(viewToPlayerDir(s.geoNormal));

	// ---- Rain wetness and puddles (Overworld, open sky).
#if defined(WETNESS) && defined(DIM_OVERWORLD)
	float exposedToRain = smoothstep(13.0 / 15.0, 14.5 / 15.0, sky);
	float wet = wetness * exposedToRain * mix(0.35, 1.0, clamp01(geoNPlayer.y));
	#ifdef KS_PUDDLES
	if (wet > 0.0 && geoNPlayer.y > 0.9) {
		vec2 wxz = worldPosWrapped(playerPos).xz;
		float mask = smoothstep(0.52, 0.62, noiseSmooth2(wxz * 1.6) * 0.7 + noiseSmooth(wxz * 3.0) * 0.3);
		float puddle = mask * wet * (1.0 - s.sss);
		if (puddle > 0.01) {
			// Rain ripples: expanding rings from hashed drop positions.
			vec2 cell = floor(wxz * 1.5);
			vec2 f = fract(wxz * 1.5) - 0.5;
			float tt = fract(frameTimeCounter * 0.9 + hash12(cell) * 7.0);
			float ring = sin((length(f) - tt * 0.6) * 40.0) * exp(-tt * 3.0) * smoothstep(0.5, 0.0, length(f));
			vec2 rip = normalize(f + 1e-4) * ring * 0.06 * rainStrength;
			vec3 pn = normalize(vec3(rip.x, 1.0, rip.y));
			s.normal = normalize(mix(s.normal, playerToViewDir(pn), puddle));
			nPlayer = normalize(viewToPlayerDir(s.normal));
			s.roughness = mix(s.roughness, 0.04, puddle);
			s.f0 = mix(s.f0, vec3(0.02), puddle);
			s.albedo *= mix(1.0, 0.55, puddle);
		}
	}
	#endif
	// applyWetness never polishes past roughness 0.55, below the SSR smoothness threshold, so
	// rain alone does not turn every block into a mirror; only puddles, metals and polished
	// blocks reach it.
	applyWetness(s, wet);
#endif

	// ---- Direct light (sun or moon).
	vec3 V = -normalize(vViewPos);
	vec3 Lv = lightDirView();
	float NdotLgeo = dot(s.geoNormal, Lv);
	float NdotL = dot(s.normal, Lv);
	vec3 lightE = lightIrradiance();

	vec3 shadow = vec3(0.0);
	float lightable = (NdotLgeo > 0.0 || s.sss > 0.0) ? 1.0 : 0.0;
	if (lightable > 0.0 && maxOf(lightE) > 0.0) {
#ifdef KS_SHADOWS_ACTIVE
		float fade;
		// Back faces of thin foliage look up the shadow on their lit side.
		vec3 biasN = NdotLgeo >= 0.0 ? geoNPlayer : -geoNPlayer;
		vec3 sh = sampleShadow(playerPos, biasN, abs(NdotLgeo), gl_FragCoord.xy, false, fade);
		shadow = mix(sh, vec3(fakeShadow(sky)), fade);
#else
		shadow = vec3(fakeShadow(sky));
#endif
#ifdef KS_SKY_LUT
		shadow *= skyLeakFactor(sky);
#endif
#ifdef KS_CLOUD_SHADOWS
		shadow *= cloudShadow(playerPos);
#endif
	}
	vec3 Edirect = lightE * shadow;

	float wrap = s.sss * 0.4;
	float NdotLd = clamp01((NdotL + wrap) / (1.0 + wrap));
	vec3 diffuseDirect = s.albedo * RCP_PI * Edirect * NdotLd;

	// Light through thin foliage: on the side facing away from the light, test whether the
	// light reaches the lit side of the block (one block toward the light), so the outer layer
	// of a canopy glows green when back-lit instead of shadowing itself.
	if (s.sss > 0.0 && NdotLgeo < 0.0 && maxOf(lightE) > 0.0) {
		vec3 Lp = lightDirPlayer();
		vec3 through;
	#ifdef KS_SHADOWS_ACTIVE
		float fadeT;
		// 1.1 blocks clears the block's own lit face.
		through = sampleShadow(playerPos + Lp * 1.1, Lp, 1.0, gl_FragCoord.xy, false, fadeT);
		through = mix(through, vec3(fakeShadow(sky)), fadeT);
	#else
		through = vec3(fakeShadow(sky));
	#endif
		// Light scattered through several leaf layers keeps an outer canopy faintly lit.
		through = max(through, vec3(0.3 * smoothstep(0.7, 1.0, sky)));
	#ifdef KS_SKY_LUT
		through *= skyLeakFactor(sky);
	#endif
		float forward = 0.35 + 0.65 * pow(clamp01(dot(-V, Lv)), 4.0);
		diffuseDirect += s.albedo * RCP_PI * lightE * through * (s.sss * clamp01(-NdotL) * forward * 0.6);
	}
	vec3 specDirect = specularGGX(s.normal, V, Lv, s.roughness, s.f0) * Edirect;

	// ---- Ambient (sky, block light, held light, floor).
	// Foliage receives sky light from many directions through and around itself.
	vec3 nAmb = s.sss > 0.0 ? normalize(mix(nPlayer, vec3(0.0, 1.0, 0.0), 0.5 * s.sss)) : nPlayer;
#ifdef KS_SKY_LUT
	vec3 Esky = skyIrradiance(nAmb) * skyLightCurve(sky);
#else
	vec3 Esky = skyIrradiance(nAmb);
#endif
	vec3 Eblock = blockIrradiance(lm.x) + heldLightIrradiance(vViewPos, s.normal);
	vec3 Efloor = vec3(minAmbientE());
	vec3 diffuseAmb = s.albedo * RCP_PI * (Esky + Eblock + Efloor) * s.ao;

	float NdotV = max(dot(s.normal, V), 1e-3);
	vec3 Fenv = envBRDFApprox(s.f0, s.roughness, NdotV);
	vec3 kd = (1.0 - Fenv) * (1.0 - s.metalness);

	vec3 color = (diffuseDirect + diffuseAmb) * kd + specDirect;

	// ---- Environment specular, forward (when deferred reflections are off, and always for
	// the hand, which deferred2 cannot reconstruct).
#if !defined(KS_DEFERRED_SPEC) || defined(KS_IS_HAND)
	{
		vec3 R = reflect(-V, s.normal);
		vec3 Rp = viewToPlayerDir(R);
	#ifdef KS_SKY_LUT
		vec3 envSky = skyRadiance(safeNormalize(vec3(Rp.x, max(Rp.y, -0.2), Rp.z)));
		vec3 envRough = skyIrradiance(nPlayer) * RCP_PI;
		vec3 env = mix(envSky, envRough, clamp01(s.roughness * s.roughness * 1.5));
		env *= smoothstep(0.55, 1.0, sky);
	#else
		vec3 env = skyRadiance(Rp);
	#endif
		// Surroundings lit by block light reflect too (this is what keeps metals visible
		// indoors, where they have no diffuse).
		env += (Eblock + Efloor) * RCP_PI;
		color += Fenv * env * s.ao;
	}
#endif
	color *= darknessLightScale();

	// ---- Emission.
	color += s.albedo * s.emission;

	// ---- Enchantment glint, drawn inline on Iris for 26.x.
#if defined(IRIS_INLINE_GLINT) && (defined(KS_IS_ENTITY) || defined(KS_IS_HAND))
	if (mc_hasGlint()) {
		float glintScale = KS_GLINT_GAIN * (luminance(Esky + Eblock + lightE * 0.15) + 0.02);
		color += srgbToLinear(clamp01(mc_sampleGlint())) * glintScale;
	}
#endif

#if DEBUG_VIEW == 6
	color = shadow;
#endif

	color = sanitizeHDR(color);
#if defined(KS_IS_BLOCK) && (defined(KS_BUFFER_BLEND) || !defined(KS_GBUFFER_DATA))
	// Translucent blocks moved by pistons draw through gbuffers_block with blending; the
	// G-buffer targets have blending switched off in shaders.properties.
	outColor = vec4(color, baseColor.a);
#else
	outColor = vec4(color, 1.0);
#endif

#ifdef KS_GBUFFER_DATA
	int code = materialCodeForBlock(id);
	#ifdef KS_IS_ENTITY
	code = MAT_ENTITY;
	#endif
	#ifdef KS_IS_HAND
	code = MAT_HAND;
	#endif
	float ambFrac = clamp01(luminance(diffuseAmb * kd) / max(luminance(color), 1e-6));
	outData = vec4(lm.x, lm.y, encodeMaterial(code), ambFrac);
	outNormal = vec4(encodeNormal(s.normal), 0.0, 1.0);
#endif
#ifdef KS_DEFERRED_SPEC
	outSpec = vec4(linearToSrgb(clamp01(s.f0)), clamp01(1.0 - s.roughness));
#endif
}
#endif
