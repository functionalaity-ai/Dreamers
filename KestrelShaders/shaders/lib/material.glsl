// Kestrel Shaders - material IDs and per-material surface properties.
// Block IDs come from block.properties through mc_Entity.x (unmapped blocks read -1 on Iris).

#define ID_PLANT_SHORT 10
#define ID_PLANT_TALL_LOWER 11
#define ID_PLANT_TALL_UPPER 12
#define ID_LEAVES 13
#define ID_VINES 14
#define ID_CROPS 15
#define ID_WATER 20
#define ID_GLASS 21
#define ID_ICE 22
#define ID_SLIME_HONEY 23
#define ID_PORTAL 24
#define ID_LAVA 30
#define ID_EMISSIVE_FULL 31
#define ID_EMISSIVE_PARTIAL 32
#define ID_FIRE 33
#define ID_METAL 40
#define ID_POLISHED 41
#define ID_SNOW 42

// Material codes stored in colortex1.b (code / 255). 0 = no G-buffer data.
#define MAT_NONE 0
#define MAT_GENERIC 1
#define MAT_FOLIAGE 2
#define MAT_METAL 3
#define MAT_POLISHED 4
#define MAT_EMISSIVE 5
#define MAT_LAVA 6
#define MAT_ENTITY 7
#define MAT_HAND 8
#define MAT_SNOW 9

bool isFoliageId(int id) { return id >= ID_PLANT_SHORT && id <= ID_CROPS; }
bool isWavingId(int id) { return id >= ID_PLANT_SHORT && id <= ID_CROPS; }

int materialCodeForBlock(int id) {
	if (isFoliageId(id)) return MAT_FOLIAGE;
	if (id == ID_METAL) return MAT_METAL;
	if (id == ID_POLISHED) return MAT_POLISHED;
	if (id == ID_EMISSIVE_FULL || id == ID_EMISSIVE_PARTIAL || id == ID_FIRE) return MAT_EMISSIVE;
	if (id == ID_LAVA) return MAT_LAVA;
	if (id == ID_SNOW) return MAT_SNOW;
	return MAT_GENERIC;
}

float encodeMaterial(int code) { return float(code) / 255.0; }
int decodeMaterial(float v) { return int(v * 255.0 + 0.5); }

struct Surface {
	vec3 albedo;      // linear
	vec3 normal;      // view space, shading normal
	vec3 geoNormal;   // view space, geometric normal
	vec3 f0;          // linear specular reflectance at normal incidence
	float roughness;  // perceptual roughness (alpha = roughness^2)
	float emission;   // emitted radiance in Kestrel units (multiplies albedo)
	float sss;        // subsurface / translucency amount 0..1
	float porosity;   // how much rain darkens the surface 0..1
	float ao;         // material AO 0..1
};

// Default surface values for vanilla textures (no resource-pack PBR maps).
void defaultMaterial(int id, vec3 albedoLin, inout Surface s) {
	s.f0 = vec3(0.04);
	s.roughness = 0.85;
	s.emission = 0.0;
	s.sss = 0.0;
	s.porosity = 0.5;
	s.ao = 1.0;
	if (isFoliageId(id)) {
		s.roughness = 0.65;
		s.sss = 0.6;
		s.porosity = 0.15;
	} else if (id == ID_METAL) {
		s.f0 = albedoLin;
		s.roughness = 0.38;
		s.porosity = 0.0;
	} else if (id == ID_POLISHED) {
		s.roughness = 0.32;
		s.porosity = 0.1;
	} else if (id == ID_SNOW) {
		s.roughness = 0.6;
		s.sss = 0.35;
		s.porosity = 0.0;
	} else if (id == ID_LAVA) {
		s.emission = 3.0;
		s.roughness = 0.6;
		s.porosity = 0.0;
	} else if (id == ID_EMISSIVE_FULL) {
		s.emission = 0.8;
		s.porosity = 0.0;
	} else if (id == ID_EMISSIVE_PARTIAL || id == ID_FIRE) {
		// Only the bright, saturated texels glow (the flame, not the stick).
		float l = luminance(albedoLin);
		float mx = maxOf(albedoLin);
		float sat = (mx - minOf(albedoLin)) / max(mx, 1e-3);
		float mask = smoothstep(0.35, 0.75, l + sat * 0.35);
		s.emission = (id == ID_FIRE ? 2.0 : 1.2) * mask;
		s.porosity = 0.0;
	}
}

// Rain: wet surfaces get darker (porous) and smoother, capped below the SSR threshold except
// where puddles are allowed (handled by the caller).
void applyWetness(inout Surface s, float wet) {
	if (wet <= 0.0) return;
	float darken = mix(1.0, 0.62, s.porosity * wet);
	s.albedo *= darken;
	s.roughness = mix(s.roughness, min(s.roughness, 0.55), wet * (1.0 - s.sss));
}
