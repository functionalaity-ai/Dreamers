#!/usr/bin/env python3
"""Developer harness: render a small procedural Minecraft-like scene through the real pack
programs on a headless OpenGL context (Mesa llvmpipe), to catch runtime problems (link
errors, NaNs, black buffers) and to look at the result. Not part of the release.

It mimics Iris's frame: clear -> prepare -> shadow -> opaque gbuffers -> depth copies ->
deferred -> translucent gbuffers -> composite passes (with buffer flipping) -> final.
Shaders are converted from the compatibility profile to core the way Iris does (built-in
matrices and attributes become uniforms and inputs), which is also what happens on macOS.

Requires: pip install moderngl numpy pillow   (and Mesa with EGL)
    python3 tools/render_test.py --profile MEDIUM --time noon --out /tmp/kestrel.png
"""
import argparse
import math
import re
import sys
from pathlib import Path

import moderngl
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kestrel_pack import SHADERS, apply_overrides, expand, iris_macros, parse_profiles  # noqa: E402

# ----------------------------------------------------------------------------- math
def perspective(fovy_deg, aspect, near, far):
    f = 1.0 / math.tan(math.radians(fovy_deg) / 2)
    m = np.zeros((4, 4), dtype=np.float64)
    m[0, 0] = f / aspect
    m[1, 1] = f
    m[2, 2] = (far + near) / (near - far)
    m[2, 3] = 2 * far * near / (near - far)
    m[3, 2] = -1.0
    return m


def ortho(half, near, far):
    m = np.identity(4)
    m[0, 0] = 1.0 / half
    m[1, 1] = 1.0 / half
    m[2, 2] = -2.0 / (far - near)
    m[2, 3] = -(far + near) / (far - near)
    return m


def rot_x(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    m = np.identity(4)
    m[1, 1], m[1, 2], m[2, 1], m[2, 2] = c, -s, s, c
    return m


def rot_y(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    m = np.identity(4)
    m[0, 0], m[0, 2], m[2, 0], m[2, 2] = c, s, -s, c
    return m


def rot_z(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    m = np.identity(4)
    m[0, 0], m[0, 1], m[1, 0], m[1, 1] = c, -s, s, c
    return m


def gl_mat(m):
    """numpy row-major 4x4 -> column-major float tuple for GLSL."""
    return tuple(np.asarray(m, dtype=np.float32).T.flatten())


# ----------------------------------------------------------------------------- scene
BLOCK_IDS = {"grass": 0, "dirt": 0, "stone": 0, "sand": 0, "log": 0, "leaves": 13, "water": 20,
             "plant": 10, "polished": 41, "glowstone": 31, "gold": 40}
# atlas tile index per (block, face) -> (r, g, b) base colours (sRGB) with noise
TILES = ["grass_top", "grass_side", "dirt", "stone", "sand", "log_side", "log_top", "leaves", "water",
         "plant", "polished", "glowstone", "gold"]
TILE_COLORS = {
    "grass_top": (0.62, 0.62, 0.62), "grass_side": (0.52, 0.42, 0.30), "dirt": (0.53, 0.38, 0.26),
    "stone": (0.49, 0.49, 0.49), "sand": (0.86, 0.81, 0.64), "log_side": (0.40, 0.30, 0.19),
    "log_top": (0.62, 0.50, 0.32), "leaves": (0.55, 0.55, 0.55), "water": (0.70, 0.70, 0.75),
    "plant": (0.60, 0.60, 0.60), "polished": (0.62, 0.62, 0.64), "glowstone": (0.95, 0.80, 0.45),
    "gold": (0.98, 0.84, 0.30),
}
GRASS_TINT = (0.47, 0.74, 0.32)
LEAF_TINT = (0.38, 0.62, 0.22)
WATER_TINT = (0.25, 0.45, 0.85)


def make_atlas(rng):
    tile = 16
    cols = 4
    rows = (len(TILES) + cols - 1) // cols
    img = np.zeros((rows * tile, cols * tile, 4), dtype=np.uint8)
    for i, name in enumerate(TILES):
        r0, c0 = (i // cols) * tile, (i % cols) * tile
        base = np.array(TILE_COLORS[name])
        for y in range(tile):
            for x in range(tile):
                n = 0.85 + 0.3 * rng.random()
                c = np.clip(base * n, 0, 1)
                a = 1.0
                if name == "leaves" and rng.random() < 0.28:
                    a = 0.0
                if name == "plant":
                    # grass blades: stripes with transparent gaps
                    a = 1.0 if (x % 4 in (1, 2) and y > (x * 7) % 9) else 0.0
                if name == "grass_side" and y < 4:
                    c = np.clip(np.array(GRASS_TINT) * n, 0, 1)
                if name == "glowstone" and rng.random() < 0.3:
                    c = np.array((1.0, 0.95, 0.75))
                if name == "water":
                    a = 0.75
                img[r0 + y, c0 + x] = (np.concatenate([c, [a]]) * 255).astype(np.uint8)
    return img, cols, rows


def tile_uv(name, cols, rows):
    i = TILES.index(name)
    u0, v0 = (i % cols) / cols, (i // cols) / rows
    return u0, v0, u0 + 1.0 / cols, v0 + 1.0 / rows


class Mesh:
    def __init__(self):
        self.data = {k: [] for k in ("pos", "nrm", "col", "uv0", "uv2", "ent", "mid", "tan")}

    def quad(self, corners, normal, uv, color, light, ent, center, tangent):
        u0, v0, u1, v1 = uv
        uvs = [(u0, v1), (u1, v1), (u1, v0), (u0, v0)]
        for idx in (0, 1, 2, 0, 2, 3):
            p = corners[idx]
            self.data["pos"].append(p)
            self.data["nrm"].append(normal)
            self.data["col"].append(color + (1.0,))
            self.data["uv0"].append(uvs[idx])
            self.data["uv2"].append(light)
            self.data["ent"].append((ent, 0.0, 0.0, 1.0))
            mid = tuple((np.array(center) - np.array(p)) * 64.0)
            self.data["mid"].append(mid + (0.0,))
            self.data["tan"].append(tangent + (1.0,))

    def arrays(self):
        return {k: np.array(v, dtype=np.float32) for k, v in self.data.items()}


FACES = {
    "up": ((0, 1, 0), [(0, 1, 1), (1, 1, 1), (1, 1, 0), (0, 1, 0)], (1, 0, 0)),
    "down": ((0, -1, 0), [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)], (1, 0, 0)),
    "north": ((0, 0, -1), [(1, 0, 0), (0, 0, 0), (0, 1, 0), (1, 1, 0)], (-1, 0, 0)),
    "south": ((0, 0, 1), [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)], (1, 0, 0)),
    "west": ((-1, 0, 0), [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)], (0, 0, 1)),
    "east": ((1, 0, 0), [(1, 0, 1), (1, 0, 0), (1, 1, 0), (1, 1, 1)], (0, 0, -1)),
}
DIRS = {"up": (0, 1, 0), "down": (0, -1, 0), "north": (0, 0, -1), "south": (0, 0, 1), "west": (-1, 0, 0), "east": (1, 0, 0)}


def build_world():
    """Returns {(x,y,z): block} for a small landscape around the origin."""
    world = {}
    rng = np.random.default_rng(7)
    for x in range(-28, 29):
        for z in range(-10, 52):
            h = 63 + int(round(2.2 * math.sin(x * 0.18) * math.cos(z * 0.13) + 1.5 * math.sin(z * 0.07)))
            if z > 34:
                h += int((z - 34) * 0.9)
            pond = (x - 6) ** 2 / 30.0 + (z - 14) ** 2 / 20.0 < 1.0
            for y in range(58, h + 1):
                if pond and y >= 61:
                    continue
                if y == h:
                    world[(x, y, z)] = "sand" if pond or ((x - 6) ** 2 / 42.0 + (z - 14) ** 2 / 30.0 < 1.0) else "grass"
                elif y > h - 3:
                    world[(x, y, z)] = "dirt"
                else:
                    world[(x, y, z)] = "stone"
            if pond:
                for y in range(61, 64):
                    world[(x, y, z)] = "water"
            elif rng.random() < 0.18 and world.get((x, h, z)) == "grass":
                world[(x, h + 1, z)] = "plant"
    # A tree.
    tx, tz = -6, 18
    base = max(y for (x, y, z) in world if x == tx and z == tz and world[(x, y, z)] == "grass")
    for y in range(base + 1, base + 6):
        world[(tx, y, tz)] = "log"
    for dx in range(-2, 3):
        for dz in range(-2, 3):
            for dy in range(3, 7):
                if abs(dx) + abs(dz) + max(dy - 5, 0) * 2 <= 3 and (dx, dz) != (0, 0) or dy >= 6:
                    if abs(dx) <= 2 and abs(dz) <= 2:
                        world.setdefault((tx + dx, base + dy, tz + dz), "leaves")
    # Stone pillars, a polished block wall, gold and glowstone.
    for y in range(64, 69):
        world[(12, y, 22)] = "stone"
        world[(14, y, 26)] = "polished"
    world[(9, 66, 20)] = "gold"
    world[(3, 66, 24)] = "glowstone"
    return world


def build_meshes(world, cols, rows, cam, dimension="world0"):
    solid, cutout, water = Mesh(), Mesh(), Mesh()
    for (x, y, z), b in world.items():
        rel = np.array((x, y, z), dtype=np.float64) - cam
        center = tuple(rel + 0.5)
        if b == "plant":
            uv = tile_uv("plant", cols, rows)
            col = GRASS_TINT
            for a in (45, 135):
                ca, sa = math.cos(math.radians(a)) * 0.45, math.sin(math.radians(a)) * 0.45
                c = [tuple(rel + (0.5 - ca, 0, 0.5 - sa)), tuple(rel + (0.5 + ca, 0, 0.5 + sa)),
                     tuple(rel + (0.5 + ca, 1, 0.5 + sa)), tuple(rel + (0.5 - ca, 1, 0.5 - sa))]
                n = (-sa / 0.45, 0.0, ca / 0.45)
                cutout.quad(c, n, uv, col, (0.0, 240.0), BLOCK_IDS["plant"], center, (ca / 0.45, 0.0, sa / 0.45))
            continue
        for face, (normal, corners, tangent) in FACES.items():
            d = DIRS[face]
            nb = world.get((x + d[0], y + d[1], z + d[2]))
            if b == "water":
                if face != "up" or nb == "water":
                    continue
            elif nb is not None and nb not in ("water", "plant", "leaves") and not (b == "leaves" and nb == "leaves"):
                continue
            if b == "grass":
                tname = "grass_top" if face == "up" else ("dirt" if face == "down" else "grass_side")
            elif b == "log":
                tname = "log_top" if face in ("up", "down") else "log_side"
            else:
                tname = b
            col = (1.0, 1.0, 1.0)
            if tname == "grass_top":
                col = GRASS_TINT
            elif b == "leaves":
                col = LEAF_TINT
            elif b == "water":
                col = WATER_TINT
            # Sky light: 15 when nothing solid is directly above, less under the tree.
            above = [world.get((x, yy, z)) for yy in range(y + 1, y + 12)]
            covered = sum(1 for a in above if a not in (None, "water", "plant"))
            sky = 15.0 if covered == 0 else max(15.0 - 3.0 * covered, 6.0)
            if face == "down":
                sky = min(sky, 13.0)
            block = 15.0 if b == "glowstone" else 0.0
            if (x - 3) ** 2 + (y - 66) ** 2 + (z - 24) ** 2 < 100 and b != "glowstone":
                block = max(0.0, 15.0 - math.sqrt((x - 3) ** 2 + (y - 66) ** 2 + (z - 24) ** 2) * 1.6)
            if dimension != "world0":
                sky = 0.0
                block = max(block, 7.0 if dimension == "world-1" else 0.0)
            light = (block * 16.0, sky * 16.0)
            c = [tuple(rel + np.array(p, dtype=np.float64)) for p in corners]
            if b == "water":
                c = [(p[0], p[1] - 0.1, p[2]) for p in c]
            mesh = water if b == "water" else (cutout if b == "leaves" else solid)
            mesh.quad(c, normal, tile_uv(tname, cols, rows), col, light, BLOCK_IDS.get(b, 0), center, tangent)
    return solid, cutout, water


# ----------------------------------------------------------------------------- shaders
BUILTINS_VERTEX = [
    (r"\bgl_Vertex\b", "vec4(vaPosition, 1.0)"),
    (r"\bgl_Normal\b", "vaNormal"),
    (r"\bgl_Color\b", "vaColor"),
    (r"\bgl_MultiTexCoord0\b", "vec4(vaUV0, 0.0, 1.0)"),
    (r"\bgl_MultiTexCoord1\b", "vec4(vaUV2, 0.0, 1.0)"),
    (r"\bgl_ModelViewMatrix\b", "ksModelViewMat"),
    (r"\bgl_ProjectionMatrix\b", "ksProjMat"),
    (r"\bgl_NormalMatrix\b", "ksNormalMat"),
    (r"gl_TextureMatrix\[0\]", "mat4(1.0)"),
    (r"gl_TextureMatrix\[1\]", "ksLightmapMat"),
]
VERTEX_DECLS = """in vec3 vaPosition;
in vec3 vaNormal;
in vec4 vaColor;
in vec2 vaUV0;
in vec2 vaUV2;
uniform mat4 ksModelViewMat;
uniform mat4 ksProjMat;
uniform mat3 ksNormalMat;
uniform mat4 ksLightmapMat;
"""


def core_source(stub, settings_text, vendor, stage):
    lines = [l for l, _, _ in expand(stub, settings_text)]
    version = lines[0].replace("compatibility", "core")
    body = "\n".join(lines[1:])
    if stage == "vertex":
        for pat, rep in BUILTINS_VERTEX:
            body = re.sub(pat, rep, body)
    head = [version] + iris_macros(vendor) + ["bool mc_hasGlint();", "vec3 mc_sampleGlint();"]
    if stage == "vertex":
        head.append(VERTEX_DECLS)
    tail = "\nbool mc_hasGlint() { return false; }\nvec3 mc_sampleGlint() { return vec3(0.0); }\n"
    return "\n".join(head) + "\n" + body + tail


class Renderer:
    def __init__(self, args):
        self.args = args
        self.ctx = moderngl.create_standalone_context(backend="egl", require=330)
        self.W, self.H = args.width, args.height
        profiles = parse_profiles()
        values = dict(profiles[args.profile])
        for kv in args.set or []:
            k, v = kv.split("=", 1)
            values[k] = v
        self.values = values
        self.settings = apply_overrides(values)
        self.vendor = args.vendor
        self.programs = {}
        self.frame = 0
        self.prev_view = None
        self.prev_cam = None
        rng = np.random.default_rng(3)
        self.atlas_img, self.cols, self.rows = make_atlas(rng)
        self.build_resources()

    # -------------------------------------------------- resources
    def tex(self, size, comps, dtype):
        t = self.ctx.texture(size, comps, dtype=dtype)
        t.filter = (moderngl.LINEAR, moderngl.LINEAR)
        t.repeat_x = t.repeat_y = False
        return t

    def build_resources(self):
        W, H = self.W, self.H
        half = (max(W // 2, 1), max(H // 2, 1))
        spec = {0: ((W, H), 4, "f2"), 1: ((W, H), 4, "f1"), 2: ((W, H), 2, "u2"), 3: ((W, H), 4, "f1"),
                4: ((W, H), 4, "f2"), 5: ((W, H), 4, "f2"), 6: (half, 4, "f2"), 7: ((192, 112), 4, "f2")}
        self.ct = {}
        for i, (size, comps, dtype) in spec.items():
            dt = "nu2" if dtype == "u2" else dtype
            pair = [self.tex(size, comps, dt), self.tex(size, comps, dt)]
            self.ct[i] = {"tex": pair, "cur": 0, "size": size}
        self.depth = self.ctx.depth_texture((W, H))
        self.depth1 = self.ctx.depth_texture((W, H))
        self.depth2 = self.ctx.depth_texture((W, H))
        for d in (self.depth, self.depth1, self.depth2):
            d.compare_func = ""
        res = int(self.opt("shadowMapResolution", "1024"))
        self.shadow_res = res
        self.shadow_depth = self.ctx.depth_texture((res, res))
        self.shadow_depth1 = self.ctx.depth_texture((res, res))
        for d in (self.shadow_depth, self.shadow_depth1):
            d.compare_func = ""
        self.shadow_color = self.tex((res, res), 4, "f1")
        self.hw_sampler = self.ctx.sampler(filter=(moderngl.LINEAR, moderngl.LINEAR), compare_func="<=",
                                           repeat_x=False, repeat_y=False)
        self.raw_sampler = self.ctx.sampler(filter=(moderngl.NEAREST, moderngl.NEAREST), compare_func="",
                                            repeat_x=False, repeat_y=False)
        noise = np.array(Image.open(SHADERS / "textures" / "noise.png").convert("RGBA"))
        self.noisetex = self.ctx.texture((noise.shape[1], noise.shape[0]), 4, noise.tobytes())
        self.noisetex.filter = (moderngl.LINEAR, moderngl.LINEAR)
        self.noisetex.repeat_x = self.noisetex.repeat_y = True
        atlas = self.atlas_img.copy()
        self.atlas = self.ctx.texture((atlas.shape[1], atlas.shape[0]), 4, atlas.tobytes())
        self.atlas.filter = (moderngl.NEAREST, moderngl.NEAREST)
        self.white = self.ctx.texture((1, 1), 4, bytes([255, 255, 255, 255]))
        self.out = self.ctx.texture((W, H), 4, dtype="f1")
        quad = np.array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], dtype=np.float32)
        self.quad_vbo = self.ctx.buffer(quad.tobytes())

    def opt(self, name, default):
        return self.values.get(name, default)

    def cur(self, i):
        c = self.ct[i]
        return c["tex"][c["cur"]]

    def other(self, i):
        c = self.ct[i]
        return c["tex"][1 - c["cur"]]

    # -------------------------------------------------- programs
    def program(self, name):
        if name in self.programs:
            return self.programs[name]
        folder = SHADERS / self.args.world
        vs = core_source(folder / (name + ".vsh"), self.settings, self.vendor, "vertex")
        fs = core_source(folder / (name + ".fsh"), self.settings, self.vendor, "fragment")
        try:
            prog = self.ctx.program(vertex_shader=vs, fragment_shader=fs)
        except Exception as e:
            Path("/tmp/kestrel_failed_vs.glsl").write_text(vs)
            Path("/tmp/kestrel_failed_fs.glsl").write_text(fs)
            raise RuntimeError("%s failed to compile/link on Mesa:\n%s" % (name, e))
        self.programs[name] = prog
        return prog

    def enabled(self, name):
        if self.args.world != "world0" and name in ("prepare", "shadow", "composite", "composite1"):
            return False
        cond = {
            "shadow": "SHADOWS", "deferred": "SSAO", "composite": "VOLUMETRIC_LIGHT",
            "composite1": "VOLUMETRIC_LIGHT", "composite3": "BLOOM",
        }
        if name == "composite2":
            return any(self.opt(k, "false") == "true" for k in ("TAA", "FXAA", "AUTO_EXPOSURE"))
        if name in cond:
            return self.opt(cond[name], "false") == "true"
        return True

    # -------------------------------------------------- uniforms
    def set_uniforms(self, prog, u):
        for name in prog:
            member = prog[name]
            if not isinstance(member, moderngl.Uniform):
                continue
            if name in u:
                val = u[name]
                try:
                    member.value = val
                except Exception as e:
                    raise RuntimeError("uniform %s: %s (%r)" % (name, e, val))

    def bind_samplers(self, prog, extra):
        unit = 0
        for name in prog:
            member = prog[name]
            if not isinstance(member, moderngl.Uniform) or not member.gl_type in (0x8B5E, 0x8B62, 0x8DCA, 0x8B5F):
                continue
            texobj, sampler = self.sampler_for(name, extra)
            if texobj is None:
                raise RuntimeError("no texture bound for sampler %s" % name)
            texobj.use(location=unit)
            if sampler is not None:
                sampler.use(location=unit)
            else:
                self.ctx.clear_samplers(unit, unit + 1)
            member.value = unit
            unit += 1

    def sampler_for(self, name, extra):
        if name in extra:
            return extra[name], None
        m = re.match(r"colortex(\d+)$", name)
        if m:
            return self.cur(int(m.group(1))), None
        table = {
            "depthtex0": (self.depth, None), "depthtex1": (self.depth1, None), "depthtex2": (self.depth2, None),
            "noisetex": (self.noisetex, None), "gtexture": (self.atlas, None),
            "shadowtex0HW": (self.shadow_depth, self.hw_sampler), "shadowtex1HW": (self.shadow_depth1, self.hw_sampler),
            "shadowtex0": (self.shadow_depth, self.raw_sampler if self.vendor_hw() else self.hw_sampler),
            "shadowtex1": (self.shadow_depth1, self.raw_sampler if self.vendor_hw() else self.hw_sampler),
            "shadowcolor0": (self.shadow_color, None),
        }
        return table.get(name, (None, None))

    def vendor_hw(self):
        from kestrel_pack import VENDORS
        return VENDORS[self.vendor]["hw"]

    # -------------------------------------------------- camera and time
    def frame_uniforms(self):
        a = self.args
        W, H = self.W, self.H
        cam = np.array(a.camera, dtype=np.float64) + np.array(a.move) * self.frame
        view = rot_x(-a.pitch) @ rot_y(-(a.yaw + a.pan * self.frame))
        proj = perspective(70.0, W / H, 0.05, a.far)
        # Shadow model-view exactly like Iris: Rx(90) Rz(-skyAngle*360) Rx(sunPathRotation).
        sky_angle = a.sky_angle
        spr = float(self.opt("sunPathRotation", "-35.0"))
        rot = rot_x(90.0) @ rot_z(-sky_angle * 360.0) @ rot_x(spr)
        sun_player = np.linalg.inv(rot[:3, :3]) @ np.array([0.0, 0.0, 1.0])
        if sun_player[1] < 0:
            light_player = -sun_player
        else:
            light_player = sun_player
        light_rot = rot if sun_player[1] >= 0 else rot_x(90.0) @ rot_z(-(sky_angle + 0.5) * 360.0) @ rot_x(spr)
        shadow_mv = light_rot
        sdist = float(self.opt("shadowDistance", "64.0"))
        shadow_proj = ortho(sdist, -100.05, 156.0)
        to_view = lambda v: (view[:3, :3] @ v) * 100.0
        prev_cam = self.prev_cam if self.prev_cam is not None else cam
        jit_frame = self.frame
        u = {
            "gbufferModelView": gl_mat(view), "gbufferModelViewInverse": gl_mat(np.linalg.inv(view)),
            "gbufferProjection": gl_mat(proj), "gbufferProjectionInverse": gl_mat(np.linalg.inv(proj)),
            "gbufferPreviousModelView": gl_mat(self.prev_view if self.prev_view is not None else view),
            "gbufferPreviousProjection": gl_mat(proj),
            "shadowModelView": gl_mat(shadow_mv), "shadowModelViewInverse": gl_mat(np.linalg.inv(shadow_mv)),
            "shadowProjection": gl_mat(shadow_proj), "shadowProjectionInverse": gl_mat(np.linalg.inv(shadow_proj)),
            "cameraPosition": tuple(cam.astype(np.float32)), "previousCameraPosition": tuple(prev_cam.astype(np.float32)),
            "cameraPositionInt": tuple(int(math.floor(c)) for c in cam),
            "cameraPositionFract": tuple(float(c - math.floor(c)) for c in cam),
            "previousCameraPositionInt": tuple(int(math.floor(c)) for c in prev_cam),
            "previousCameraPositionFract": tuple(float(c - math.floor(c)) for c in prev_cam),
            "sunPosition": tuple(to_view(sun_player)), "moonPosition": tuple(to_view(-sun_player)),
            "shadowLightPosition": tuple(to_view(light_player)), "upPosition": tuple(to_view(np.array([0.0, 1.0, 0.0]))),
            "sunAngle": float((0.25 - sky_angle) % 1.0),
            "viewWidth": float(W), "viewHeight": float(H), "aspectRatio": float(W / H),
            "near": 0.05, "far": float(a.far),
            "frameCounter": jit_frame, "frameTime": 1.0 / 30.0, "frameTimeCounter": 10.0 + jit_frame / 30.0,
            "worldTime": 6000, "worldDay": 1, "moonPhase": 0,
            "rainStrength": a.rain, "wetness": a.rain, "thunderStrength": 0.0, "isEyeInWater": 0,
            "eyeBrightnessSmooth": (0, 240 if a.world == "world0" else 0), "eyeAltitude": float(cam[1]),
            "nightVision": 0.0, "blindness": 0.0, "darknessFactor": 0.0, "screenBrightness": 0.5,
            "fogColor": {"world0": (0.7, 0.8, 1.0), "world-1": (0.33, 0.08, 0.05), "world1": (0.06, 0.04, 0.08)}[a.world],
            "skyColor": (0.47, 0.65, 1.0),
            "heldBlockLightValue": 0, "heldBlockLightValue2": 0, "renderStage": 0, "alphaTestRef": 0.1,
            "hasSkylight": a.world == "world0", "cloudHeight": 192.0, "cloudTime": 0.0, "endFlashIntensity": 0.0,
            "lightningBoltPosition": (0.0, 0.0, 0.0, 0.0),
            "ksBiomeSwamp": 0.0, "ksBiomeDesert": 0.0, "ksBiomeSnowy": 0.0, "ksBiomeJungle": 0.0,
            "ksLightmapMat": gl_mat(np.array([[1 / 256, 0, 0, 1 / 32], [0, 1 / 256, 0, 1 / 32], [0, 0, 1 / 256, 1 / 32], [0, 0, 0, 1]])),
            "entityColor": (0.0, 0.0, 0.0, 0.0),
        }
        self.view, self.proj, self.shadow_mv, self.shadow_proj = view, proj, shadow_mv, shadow_proj
        self.prev_view, self.prev_cam = view, cam
        return u

    # -------------------------------------------------- passes
    def fullscreen(self, name, targets, u, mip=None):
        if not self.enabled(name):
            return
        prog = self.program(name)
        dbs = targets
        size = self.ct[dbs[0]]["size"]
        fbo = self.ctx.framebuffer(color_attachments=[self.other(i) for i in dbs])
        fbo.use()
        self.ctx.viewport = (0, 0, size[0], size[1])
        self.ctx.disable(moderngl.DEPTH_TEST | moderngl.BLEND)
        if mip is not None:
            self.cur(mip).build_mipmaps()
            self.cur(mip).filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR)
        self.set_uniforms(prog, u)
        self.bind_samplers(prog, {})
        vao = self.ctx.vertex_array(prog, [(self.quad_vbo, "3f", "vaPosition")])
        vao.render(moderngl.TRIANGLES)
        vao.release()
        fbo.release()
        if mip is not None:
            self.cur(mip).filter = (moderngl.LINEAR, moderngl.LINEAR)
        for i in dbs:
            self.ct[i]["cur"] = 1 - self.ct[i]["cur"]

    def draw_mesh(self, name, mesh_arrays, u, fbo, extra_u=None, blend=False, cull=True):
        prog = self.program(name)
        u = dict(u)
        u.update(extra_u or {})
        self.set_uniforms(prog, u)
        self.bind_samplers(prog, {})
        attrs = []
        names = {"pos": ("vaPosition", "3f"), "nrm": ("vaNormal", "3f"), "col": ("vaColor", "4f"),
                 "uv0": ("vaUV0", "2f"), "uv2": ("vaUV2", "2f"), "ent": ("mc_Entity", "4f"),
                 "mid": ("at_midBlock", "4f"), "tan": ("at_tangent", "4f")}
        buffers = []
        for key, (aname, fmt) in names.items():
            if aname in prog:
                b = self.ctx.buffer(mesh_arrays[key].tobytes())
                buffers.append(b)
                attrs.append((b, fmt, aname))
        if not attrs:
            return
        vao = self.ctx.vertex_array(prog, attrs)
        fbo.use()
        self.ctx.enable(moderngl.DEPTH_TEST)
        if blend:
            self.ctx.enable(moderngl.BLEND)
            self.ctx.blend_func = moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA
        else:
            self.ctx.disable(moderngl.BLEND)
        self.ctx.disable(moderngl.CULL_FACE)
        vao.render(moderngl.TRIANGLES)
        vao.release()
        for b in buffers:
            b.release()

    def copy_depth(self, dst):
        src_fbo = self.ctx.framebuffer(depth_attachment=self.depth)
        dst_fbo = self.ctx.framebuffer(depth_attachment=dst)
        self.ctx.copy_framebuffer(dst_fbo, src_fbo)
        src_fbo.release()
        dst_fbo.release()

    def render_frame(self, meshes):
        u = self.frame_uniforms()
        W, H = self.W, self.H
        solid, cutout, water = meshes
        # Clear (colortex0-3 clear every frame; 4-7 keep their contents).
        for i in (0, 1, 2, 3):
            for t in self.ct[i]["tex"]:
                f = self.ctx.framebuffer(color_attachments=[t])
                f.clear(0.0, 0.0, 0.0, 0.0)
                f.release()
        # prepare -> colortex7
        self.fullscreen("prepare", [7], u)
        # shadow pass
        if self.enabled("shadow"):
            prog_u = dict(u)
            prog_u["ksModelViewMat"] = gl_mat(self.shadow_mv)
            prog_u["ksProjMat"] = gl_mat(self.shadow_proj)
            prog_u["ksNormalMat"] = tuple(np.asarray(self.shadow_mv[:3, :3], dtype=np.float32).T.flatten())
            colored = self.opt("COLORED_SHADOWS", "false") == "true"
            sfbo = self.ctx.framebuffer(color_attachments=[self.shadow_color] if colored else [], depth_attachment=self.shadow_depth)
            sfbo.use()
            self.ctx.viewport = (0, 0, self.shadow_res, self.shadow_res)
            sfbo.clear(1.0, 1.0, 1.0, 0.0, depth=1.0)
            self.draw_mesh("shadow", solid, prog_u, sfbo)
            self.draw_mesh("shadow", cutout, prog_u, sfbo)
            # opaque-only copy
            f0 = self.ctx.framebuffer(depth_attachment=self.shadow_depth)
            f1 = self.ctx.framebuffer(depth_attachment=self.shadow_depth1)
            self.ctx.copy_framebuffer(f1, f0)
            f0.release()
            f1.release()
            if colored:
                self.draw_mesh("shadow", water, prog_u, sfbo)
            sfbo.release()
        # opaque gbuffers
        gu = dict(u)
        gu["ksModelViewMat"] = gl_mat(self.view)
        gu["ksProjMat"] = gl_mat(self.proj)
        gu["ksNormalMat"] = tuple(np.asarray(self.view[:3, :3], dtype=np.float32).T.flatten())
        if self.opt("SSR_OPAQUE", "false") == "true":
            targets = (0, 1, 2, 3)
        elif any(self.opt(k, "false") == "true" for k in ("SSAO", "TAA")) or self.opt("DEBUG_VIEW", "0") != "0":
            targets = (0, 1, 2)
        else:
            targets = (0,)
        gfbo = self.ctx.framebuffer(color_attachments=[self.cur(i) for i in targets], depth_attachment=self.depth)
        gfbo.use()
        self.ctx.viewport = (0, 0, W, H)
        self.ctx.clear(depth=1.0)
        self.draw_mesh("gbuffers_terrain_solid", solid, gu, gfbo)
        self.draw_mesh("gbuffers_terrain_cutout", cutout, gu, gfbo)
        gfbo.release()
        self.copy_depth(self.depth2)
        self.copy_depth(self.depth1)
        # deferred
        self.fullscreen("deferred", [6], u)
        self.fullscreen("deferred2", [0, 4] if self.opt("WATER_ADVANCED", "false") == "true" else [0], u)
        # translucent gbuffers
        tfbo = self.ctx.framebuffer(color_attachments=[self.cur(0)], depth_attachment=self.depth)
        tfbo.use()
        self.ctx.viewport = (0, 0, W, H)
        self.draw_mesh("gbuffers_water", water, gu, tfbo, blend=True)
        tfbo.release()
        # composite chain
        self.fullscreen("composite", [6], u)
        self.fullscreen("composite1", [0], u)
        self.fullscreen("composite2", [5], u)
        resolve = self.enabled("composite2")
        self.fullscreen("composite3", [6], u, mip=5 if resolve else 0)
        # final -> out
        prog = self.program("final")
        ofbo = self.ctx.framebuffer(color_attachments=[self.out])
        ofbo.use()
        self.ctx.viewport = (0, 0, W, H)
        self.ctx.disable(moderngl.DEPTH_TEST | moderngl.BLEND)
        self.set_uniforms(prog, u)
        self.bind_samplers(prog, {})
        vao = self.ctx.vertex_array(prog, [(self.quad_vbo, "3f", "vaPosition")])
        vao.render(moderngl.TRIANGLES)
        vao.release()
        ofbo.release()
        self.frame += 1

    def read_float(self, i, cur=True):
        t = self.cur(i) if cur else self.other(i)
        data = np.frombuffer(t.read(), dtype=np.float16 if t.dtype == "f2" else np.uint8)
        return data.reshape(t.size[1], t.size[0], t.components)

    def image(self):
        data = np.frombuffer(self.out.read(), dtype=np.uint8).reshape(self.H, self.W, 4)
        return Image.fromarray(data[::-1, :, :3].copy())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default="MEDIUM")
    ap.add_argument("--world", default="world0", choices=["world0", "world-1", "world1"])
    ap.add_argument("--vendor", default="mac")
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=360)
    ap.add_argument("--frames", type=int, default=6)
    ap.add_argument("--sky-angle", type=float, default=0.10, help="0 = noon, 0.25 = sunset")
    ap.add_argument("--rain", type=float, default=0.0)
    ap.add_argument("--camera", type=float, nargs=3, default=[0.3, 68.62, -6.4])
    ap.add_argument("--yaw", type=float, default=180.0, help="degrees, 180 looks toward +z")
    ap.add_argument("--pitch", type=float, default=-8.0)
    ap.add_argument("--pan", type=float, default=0.0, help="yaw change per frame (degrees)")
    ap.add_argument("--move", type=float, nargs=3, default=[0.0, 0.0, 0.0], help="camera move per frame")
    ap.add_argument("--far", type=float, default=192.0)
    ap.add_argument("--set", action="append", help="override an option, e.g. --set TAA=false")
    ap.add_argument("--out", default="/tmp/kestrel.png")
    ap.add_argument("--dump", action="store_true", help="also dump intermediate buffers")
    args = ap.parse_args()

    r = Renderer(args)
    world = build_world()
    cam = np.array(args.camera, dtype=np.float64)
    meshes = [m.arrays() for m in build_meshes(world, r.cols, r.rows, cam, args.world)]
    moving = any(abs(m) > 0 for m in args.move)
    for f in range(args.frames):
        if moving:
            cam_f = cam + np.array(args.move) * f
            meshes = [m.arrays() for m in build_meshes(world, r.cols, r.rows, cam_f, args.world)]
        r.render_frame(meshes)
    img = r.image()
    img.save(args.out)
    # Health checks on the resolved HDR buffer.
    src = 5 if r.enabled("composite2") else 0
    hdr = r.read_float(src).astype(np.float32)[..., :3]
    finite = np.isfinite(hdr).all()
    print("out=%s  finite=%s  hdr min/mean/max=%.4g/%.4g/%.4g" % (args.out, finite, hdr.min(), hdr.mean(), hdr.max()))
    ldr = np.asarray(img).astype(np.float32) / 255.0
    print("ldr mean=%.3f  black%%=%.1f  white%%=%.1f" % (ldr.mean(), (ldr.max(axis=2) < 0.02).mean() * 100, (ldr.min(axis=2) > 0.98).mean() * 100))
    if r.enabled("composite2"):
        ev = float(r.read_float(5)[0, 0, 3])
        print("EV100=%.2f" % ev)
    if args.dump:
        base = Path(args.out).with_suffix("")
        lut = r.read_float(7).astype(np.float32)
        print("sky LUT const row:", [tuple(np.round(lut[108, i, :3], 3)) for i in range(7)])


if __name__ == "__main__":
    main()
