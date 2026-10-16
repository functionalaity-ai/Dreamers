// Kestrel Shaders - vanilla clouds. Kestrel draws its own clouds in deferred2 and sets
// clouds = off in shaders.properties; this program exists so no fallback ever draws vanilla
// clouds with the wrong outputs. Program: PROGRAM_CLOUDS.

#include "/lib/settings.glsl"
#include "/lib/platform.glsl"
#include "/lib/common.glsl"
#include "/lib/uniforms.glsl"
#include "/lib/space.glsl"

#ifdef STAGE_VERTEX
void main() {
	gl_Position = applyScaleAndJitter(gl_ProjectionMatrix * (gl_ModelViewMatrix * gl_Vertex));
}
#endif

#ifdef STAGE_FRAGMENT
/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor;

void main() {
	outColor = vec4(0.0);
	discard;
}
#endif
