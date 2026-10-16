"""Single source of truth for which programs exist, which body file each uses and which
world folders ship it. Used by gen_stubs.py, validate_glsl.py and check_pack.py."""

# program name -> body file in shaders/program (without .glsl)
GBUFFERS = {
    "gbuffers_basic": "gbuffers_simple",
    "gbuffers_textured": "gbuffers_simple",
    "gbuffers_textured_lit": "gbuffers_simple",
    "gbuffers_particles": "gbuffers_simple",
    "gbuffers_damagedblock": "gbuffers_simple",
    "gbuffers_weather": "gbuffers_simple",
    "gbuffers_skybasic": "gbuffers_sky",
    "gbuffers_skytextured": "gbuffers_sky",
    "gbuffers_clouds": "gbuffers_clouds",
    "gbuffers_terrain": "gbuffers_solid",
    "gbuffers_terrain_solid": "gbuffers_solid",
    "gbuffers_terrain_cutout": "gbuffers_solid",
    "gbuffers_block": "gbuffers_solid",
    "gbuffers_entities": "gbuffers_solid",
    "gbuffers_hand": "gbuffers_solid",
    "gbuffers_block_translucent": "gbuffers_translucent",
    "gbuffers_entities_translucent": "gbuffers_translucent",
    "gbuffers_water": "gbuffers_translucent",
    "gbuffers_hand_water": "gbuffers_translucent",
    "gbuffers_spidereyes": "gbuffers_emissive",
    "gbuffers_beaconbeam": "gbuffers_emissive",
    "gbuffers_armor_glint": "gbuffers_emissive",
    "gbuffers_lightning": "gbuffers_emissive",
}

OVERWORLD_ONLY = {
    "shadow": "shadow",
    "prepare": "prepare",
    "composite": "composite_vl",
    "composite1": "composite_vl_apply",
}

COMMON_FULLSCREEN = {
    "deferred": "deferred_ao",
    "deferred2": "deferred_compose",
    "composite2": "composite_resolve",
    "composite3": "composite_bloom",
    "final": "final",
}

WORLDS = {
    "world0": "DIM_OVERWORLD",
    "world-1": "DIM_NETHER",
    "world1": "DIM_END",
}

# Programs Iris may switch off with program.<world>/<name>.enabled, per world folder.
OPTIONAL_PASSES = {
    "world0": ["shadow", "deferred", "composite", "composite1", "composite2", "composite3"],
    "world-1": ["deferred", "composite2", "composite3"],
    "world1": ["deferred", "composite2", "composite3"],
}

# Programs where Iris injects extra samplers (overlay texture, inline glint texture).
OVERLAY_PROGRAMS = {"gbuffers_entities", "gbuffers_hand", "gbuffers_entities_translucent", "gbuffers_hand_water"}
GLINT_PROGRAMS = {"gbuffers_entities", "gbuffers_hand", "gbuffers_entities_translucent", "gbuffers_hand_water"}


def programs_for(world):
    progs = dict(GBUFFERS)
    progs.update(COMMON_FULLSCREEN)
    if world == "world0":
        progs.update(OVERWORLD_ONLY)
    return progs


def program_macro(name):
    base = name[len("gbuffers_"):] if name.startswith("gbuffers_") else name
    return "PROGRAM_" + base.upper()
