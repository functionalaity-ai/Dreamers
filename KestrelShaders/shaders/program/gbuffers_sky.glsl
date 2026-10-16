// Kestrel Shaders - vanilla sky geometry. deferred2 draws the physical sky behind everything,
// so the vanilla sky dome, sunset fan and sun are suppressed here; only the stars, the moon
// (with its phases) and the End sky texture are kept, converted to linear radiance.
// Programs: PROGRAM_SKYBASIC, PROGRAM_SKYTEXTURED.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"

// ============================================================================ vertex
#ifdef STAGE_VERTEX
out vec2 vTexcoord;
out vec4 vColor;
out vec3 vViewPos;

void main() {
	vTexcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
	vColor = gl_Color;
	vec4 viewPos = gl_ModelViewMatrix * gl_Vertex;
	vViewPos = viewPos.xyz;
	gl_Position = applyScaleAndJitter(gl_ProjectionMatrix * viewPos);
}
#endif

// ============================================================================ fragment
#ifdef STAGE_FRAGMENT
#include "/lib/atmosphere.glsl"
#include "/lib/sky.glsl"

#ifdef PROGRAM_SKYTEXTURED
uniform sampler2D gtexture;
#endif

in vec2 vTexcoord;
in vec4 vColor;
in vec3 vViewPos;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor;

void main() {
	vec3 color = vec3(0.0);
	float alpha = 1.0;
	vec3 dirPlayer = normalize(viewToPlayerDir(vViewPos));

#ifdef PROGRAM_SKYBASIC
	bool isStar = false;
	#ifdef MC_RENDER_STAGE_STARS
	isStar = renderStage == MC_RENDER_STAGE_STARS;
	#else
	isStar = vColor.r == vColor.g && vColor.g == vColor.b && vColor.a > 0.0 && vColor.r > 0.0;
	#endif
	if (!isStar) discard;
	#ifdef KS_SKY_LUT
	// Stars fade out as the sky brightens and behind rain clouds.
	float skyLum = luminance(skyRadiance(dirPlayer));
	float vis = (1.0 - smoothstep(0.004, 0.05, skyLum)) * (1.0 - rainStrength);
	#else
	float vis = 1.0;
	#endif
	color = srgbToLinear(vColor.rgb) * 0.03 * vis;
	alpha = vColor.a;
#endif

#ifdef PROGRAM_SKYTEXTURED
	vec4 tex = texture(gtexture, vTexcoord) * vColor;
	#ifdef MC_RENDER_STAGE_SUN
	// The analytic sun disc in deferred2 replaces the vanilla sun.
	if (renderStage == MC_RENDER_STAGE_SUN) discard;
	#endif
	#ifdef DIM_END
	// End sky box: dark and tinted, brightened by the End flashes.
	float flash = 0.0;
		#ifdef IS_IRIS
	flash = endFlashIntensity;
		#endif
	color = srgbToLinear(tex.rgb) * (0.035 + 0.25 * flash);
	alpha = tex.a;
	#else
	// Moon (and any other textured sky object such as resource-pack skies).
	if (tex.a < 0.01) discard;
	color = srgbToLinear(tex.rgb) * 0.9;
		#ifdef KS_SKY_LUT
	color *= mix(1.0, 0.25, rainStrength);
		#endif
	alpha = tex.a;
	#endif
#endif

	outColor = vec4(color, alpha);
}
#endif
