#!/usr/bin/env python3
"""Static rule checker for Kestrel Shaders (standard library + glslangValidator for -E).

Checks the pack-format and portability rules a compiler cannot see: #version lines, banned
GLSL features above the macOS 4.1 ceiling, value-less Iris macros used in #if, render target
counts, sampler budgets per program (including samplers Iris injects), shadow samplers only
where the shadow pass may run, options defined once and covered by every profile, menu and
language-file completeness, program.enabled coverage, and the uniform allowlist.

    python3 tools/check_pack.py
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kestrel_pack import (ROOT, SHADERS, SETTINGS, apply_overrides, expand, iris_macros,  # noqa: E402
                          parse_options, parse_profiles, read_properties_lines)
from programs import (GLINT_PROGRAMS, OPTIONAL_PASSES, OVERLAY_PROGRAMS, WORLDS,  # noqa: E402
                      programs_for)

ERRORS = []


def err(msg):
    ERRORS.append(msg)


def strip_comments(text):
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


BANNED = [
    r"layout\s*\(\s*binding", r"\bpackHalf2x16\b", r"\bunpackHalf2x16\b", r"\bpackSnorm2x16\b",
    r"\bunpackSnorm2x16\b", r"early_fragment_tests", r"depth_(greater|less|any|unchanged)",
    r"\btextureQueryLevels\b", r"\bimageSize\b", r"\bimageLoad\b", r"\bimageStore\b", r"\bimage[123]D\b",
    r"\bdFdxFine\b", r"\bdFdyFine\b", r"\bdFdxCoarse\b", r"\bdFdyCoarse\b", r"\btextureSamples\b",
    r"\bgl_HelperInvocation\b", r"\bstd430\b", r"\bbarrier\s*\(", r"\bmemoryBarrier", r"\batomic",
    r"\bdouble\b", r"\bdvec[234]\b", r"\btexture2D\s*\(", r"\bshadow2D\s*\(", r"\bgl_FragData\b",
    r"\bgl_FragColor\b", r"\bftransform\s*\(", r"\bat_velocity\b", r"\bgdepth\b", r"\bgcolor\b",
    r"\bgnormal\b", r"\bgaux[1-4]\b", r"\bgl_FragDepth\b", r"\brefract\s*\(", r"\bsaturate\s*\(",
    r"\blerp\s*\(", r"\bfrac\s*\(", r"\bfloat[234]\b", r"\bfma\s*\(", r"\bbitfield(Extract|Insert|Reverse)\b",
    r"\bbitCount\b", r"\bfindMSB\b", r"\bfindLSB\b", r"\btextureGather", r"\bpackUnorm", r"\bunpackUnorm",
    r"\bpackSnorm4x8\b", r"\bunpackSnorm4x8\b", r"\biris_", r"\birisMain\b", r"\bmoj_import\b",
    r"\bswitch\s*\(", r"#\s*extension", r"\bentities_glowing\b", r"\bseparateEntityDraws\b",
]
VALUELESS_PREFIXES = ("MC_OS_", "MC_GL_VENDOR_", "MC_GL_RENDERER_", "IRIS_FEATURE_")
VALUELESS_NAMES = ("IS_IRIS", "IRIS_INLINE_GLINT", "MC_TEXTURE_FORMAT_LAB_PBR")


def check_files():
    for ext in ("*.csh", "*.gsh", "*.tcs", "*.tes"):
        for p in SHADERS.rglob(ext):
            err("forbidden shader stage file: %s" % p.relative_to(ROOT))
    for world in WORLDS:
        for name in ("gbuffers_line", "setup"):
            for ext in (".vsh", ".fsh"):
                if (SHADERS / world / (name + ext)).exists():
                    err("%s/%s%s must not ship" % (world, name, ext))
        for program in programs_for(world):
            for ext in (".vsh", ".fsh"):
                p = SHADERS / world / (program + ext)
                if not p.exists():
                    err("missing stub %s" % p.relative_to(ROOT))
                    continue
                first = p.read_text().splitlines()[0].strip()
                if first not in ("#version 330 compatibility", "#version 400 compatibility"):
                    err("%s: first line must be '#version 330 compatibility', got %r" % (p.relative_to(ROOT), first))
    for p in list((SHADERS / "lib").glob("*.glsl")) + list((SHADERS / "program").glob("*.glsl")):
        text = p.read_text()
        raw = strip_comments(text)
        rel = p.relative_to(ROOT)
        if re.search(r"^\s*#\s*version", raw, re.M):
            err("%s: #version inside an included file" % rel)
        for pat in BANNED:
            for m in re.finditer(pat, raw):
                line = raw[:m.start()].count("\n") + 1
                err("%s:%d: banned construct %r" % (rel, line, m.group(0)))
        for i, line in enumerate(raw.splitlines(), 1):
            if re.search(r"layout\s*\(\s*location", line) and not re.search(r"\bout\s+vec4\b", line):
                err("%s:%d: layout(location) only allowed on fragment outputs" % (rel, i))
            m = re.match(r"\s*#\s*(if|elif)\b(.*)$", line)
            if m and not line.strip().startswith(("#ifdef", "#ifndef")):
                expr = m.group(2)
                for tok in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", expr):
                    valueless = tok.startswith(VALUELESS_PREFIXES) or tok in VALUELESS_NAMES
                    if valueless and not re.search(r"defined\s*\(\s*%s\s*\)" % tok, expr):
                        err("%s:%d: value-less macro %s used in #if without defined()" % (rel, i, tok))
        for m in re.finditer(r"(RENDERTARGETS|DRAWBUFFERS)\s*:", text):
            line_start = text.rfind("\n", 0, m.start()) + 1
            line_end = text.find("\n", m.start())
            line = text[line_start:line_end]
            if not re.match(r"\s*/\*\s*(RENDERTARGETS|DRAWBUFFERS):[^*]*\*/\s*$", line):
                err("%s: '%s:' text outside a directive comment (Iris reads the last occurrence)" % (rel, m.group(1)))
            mm = re.search(r"RENDERTARGETS:\s*([0-9, ]*)\*/", line)
            if mm and len([x for x in mm.group(1).split(",") if x.strip()]) > 8:
                err("%s: more than 8 render targets" % rel)
        if re.search(r"\b(TODO|FIXME)\b", text):
            err("%s: contains TODO/FIXME" % rel)
    for p in (SHADERS / "textures").rglob("*"):
        if p.is_file() and p.suffix.lower() not in (".png", ".mcmeta"):
            err("non-PNG image: %s" % p.relative_to(ROOT))


def check_options():
    opts = parse_options()
    settings_text = SETTINGS.read_text()
    for name, o in opts.items():
        if o.kind == "bool" and not re.search(r"#\s*if(n)?def\s+%s\b" % name, settings_text):
            err("boolean option %s is never tested with #ifdef/#ifndef" % name)
        if o.kind != "bool" and o.default not in o.values:
            err("option %s default %s not in its value list" % (name, o.default))
    # Options defined only in settings.glsl.
    for p in list((SHADERS / "lib").glob("*.glsl")) + list((SHADERS / "program").glob("*.glsl")):
        if p == SETTINGS:
            continue
        for i, line in enumerate(p.read_text().splitlines(), 1):
            m = re.match(r"\s*(//)?\s*#define\s+([A-Za-z_][A-Za-z0-9_]*)\b", line)
            if m and m.group(2) in opts:
                err("%s:%d: option %s redefined outside settings.glsl" % (p.relative_to(ROOT), i, m.group(2)))
            if re.match(r"\s*#define\s+[A-Za-z_][A-Za-z0-9_]*\s*(//.*)?$", line):
                err("%s:%d: internal macro without a value (Iris would list it as an option)" % (p.relative_to(ROOT), i))
    # Profiles: every profile sets the same option set; values are allowed values.
    profiles = parse_profiles()
    keys = None
    for pname, values in profiles.items():
        for k, v in values.items():
            if k not in opts:
                err("profile %s sets unknown option %s" % (pname, k))
                continue
            o = opts[k]
            if o.kind == "bool" and v not in ("true", "false"):
                err("profile %s: %s needs a boolean" % (pname, k))
            if o.kind != "bool" and v not in o.values:
                err("profile %s: %s=%s not an allowed value %s" % (pname, k, v, o.values))
        if keys is None:
            keys = set(values)
        elif set(values) != keys:
            err("profile %s does not set the same options as the others: %s" % (pname, sorted(set(values) ^ keys)))
    # Code defaults must equal the LOW profile.
    for k, v in profiles.get("LOW", {}).items():
        if k in opts and opts[k].default != v:
            err("code default %s=%s differs from profile LOW (%s)" % (k, opts[k].default, v))
    return opts, profiles


def check_properties(opts, profiles):
    lines = read_properties_lines()
    screens = {}
    main_screen = None
    enabled = {}
    for line in lines:
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = re.match(r"screen\.([A-Za-z0-9_]+)\s*=\s*(.*)$", s)
        if m and m.group(1) != "columns":
            screens[m.group(1)] = m.group(2).split()
            continue
        m = re.match(r"screen\s*=\s*(.*)$", s)
        if m:
            main_screen = m.group(1).split()
        m = re.match(r"program\.([^/]+)/([A-Za-z0-9_]+)\.enabled\s*=\s*(.*)$", s)
        if m:
            enabled.setdefault(m.group(1), set()).add(m.group(2))
            for tok in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", m.group(3)):
                if tok not in opts or opts[tok].kind != "bool":
                    err("program.%s/%s.enabled uses %s, not a boolean option" % (m.group(1), m.group(2), tok))
        for bad in ("bufferObject.", "image.", "indirect.", "customImage", "iris.features.required", "allowConcurrentCompute"):
            if s.startswith(bad):
                err("shaders.properties: %s is not allowed" % bad)
    if main_screen is None:
        err("shaders.properties: no main screen")
        main_screen = []
    placed = {}
    for item in main_screen:
        m = re.match(r"\[([A-Za-z0-9_]+)\]", item)
        if m and m.group(1) not in screens:
            err("main screen links missing sub-screen %s" % m.group(1))
    for sname, items in screens.items():
        for it in items:
            if it.startswith("[") or it.startswith("<"):
                continue
            if it not in opts:
                err("screen %s lists unknown option %s" % (sname, it))
            placed.setdefault(it, []).append(sname)
    for name in opts:
        where = placed.get(name, [])
        if len(where) != 1:
            err("option %s appears on %d screens (need exactly 1)" % (name, len(where)))
    for world, passes in OPTIONAL_PASSES.items():
        have = enabled.get(world, set())
        for p in passes:
            if p not in have:
                err("no program.%s/%s.enabled line" % (world, p))
        for p in have:
            if p not in programs_for(world):
                err("program.%s/%s.enabled names a program the folder does not ship" % (world, p))
    return screens


def check_lang(opts, profiles, screens):
    lang = {}
    for line in (SHADERS / "lang" / "en_us.lang").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            lang[k.strip()] = v
    enum_like = {"SHADOW_FILTER", "AO_QUALITY", "VL_MODE", "CLOUD_LAYERS", "PBR_MODE", "RENDER_SCALE_MODE", "TONEMAP", "DEBUG_VIEW"}
    for name, o in opts.items():
        for key in ("option.%s" % name, "option.%s.comment" % name):
            if key not in lang:
                err("lang: missing %s" % key)
        if name in enum_like:
            for v in o.values:
                if "value.%s.%s" % (name, v) not in lang:
                    err("lang: missing value.%s.%s" % (name, v))
    for s in screens:
        for key in ("screen.%s" % s, "screen.%s.comment" % s):
            if key not in lang:
                err("lang: missing %s" % key)
    for p in profiles:
        if "profile.%s" % p not in lang:
            err("lang: missing profile.%s" % p)


def preprocess(stub, settings_text, vendor):
    lines = [l for l, _, _ in expand(stub, settings_text)]
    src = "\n".join([lines[0]] + iris_macros(vendor) + lines[1:]) + "\n"
    with tempfile.NamedTemporaryFile("w", suffix=".frag" if stub.suffix == ".fsh" else ".vert", delete=False) as f:
        f.write(src)
        name = f.name
    r = subprocess.run(["glslangValidator", "-E", name], capture_output=True, text=True)
    Path(name).unlink()
    if r.returncode != 0:
        err("preprocess failed for %s" % stub.relative_to(ROOT))
        return ""
    return r.stdout


def enabled_programs(values):
    """{(world, program): bool} from the program.<world>/<name>.enabled lines."""
    result = {}
    for line in read_properties_lines():
        m = re.match(r"\s*program\.([^/]+)/([A-Za-z0-9_]+)\.enabled\s*=\s*(.*)$", line)
        if not m:
            continue
        expr = m.group(3).replace("&&", " and ").replace("||", " or ").replace("!", " not ")
        expr = re.sub(r"[A-Za-z_][A-Za-z0-9_]*", lambda t: t.group(0) if t.group(0) in ("and", "or", "not")
                      else str(values.get(t.group(0), "false") == "true"), expr)
        result[(m.group(1), m.group(2))] = bool(eval(expr, {"__builtins__": {}}, {}))
    return result


def check_samplers_and_uniforms(profiles):
    allow = set()
    for line in (ROOT / "tools" / "allowlist.txt").read_text().splitlines():
        if line.strip() and not line.startswith("#"):
            allow.add(line.split()[0])
    for pname, values in profiles.items():
        settings_text = apply_overrides(values)
        shadows_on = values.get("SHADOWS") == "true"
        for vendor in ("mac", "amd"):
            on = enabled_programs(values)
            for world in WORLDS:
                for program in programs_for(world):
                    if not on.get((world, program), True):
                        continue
                    samplers = set()
                    for ext in (".vsh", ".fsh"):
                        text = preprocess(SHADERS / world / (program + ext), settings_text, vendor)
                        decls = re.findall(r"\buniform\s+(\w+)\s+(\w+)\s*;", text)
                        decls += [("in", n) for n in re.findall(r"^\s*in\s+\w+\s+(mc_Entity|at_midBlock|at_tangent|mc_midTexCoord)\s*;", text, re.M)]
                        for typ, name in decls:
                            if typ.startswith("sampler"):
                                samplers.add(name)
                            if name not in allow:
                                err("%s/%s [%s]: uniform %s not in tools/allowlist.txt" % (world, program, pname, name))
                    injected = set()
                    if program in OVERLAY_PROGRAMS:
                        injected.add("iris_overlay")
                    if program in GLINT_PROGRAMS:
                        injected.add("glintTexture")
                    total = len(samplers | injected)
                    tag = "%s/%s [%s, %s]" % (world, program, pname, vendor)
                    if total > 12:
                        err("%s: %d samplers (limit 12): %s" % (tag, total, sorted(samplers | injected)))
                    shadow = {s for s in samplers if s.startswith("shadow")}
                    if shadow and (world != "world0" or not shadows_on):
                        err("%s: shadow samplers %s referenced while the shadow pass must stay off" % (tag, sorted(shadow)))
                    if world != "world0" and "colortex7" in samplers:
                        err("%s: colortex7 (sky LUT) referenced outside the Overworld" % tag)
                    if pname == "POTATO" and samplers & {"colortex1", "colortex2", "colortex3", "colortex4"}:
                        err("%s: POTATO references %s" % (tag, sorted(samplers & {"colortex1", "colortex2", "colortex3", "colortex4"})))
                    if program.startswith("gbuffers_") and samplers & {"colortex0", "colortex1", "colortex2", "colortex3"}:
                        err("%s: gbuffers program samples colortex0-3 (fullscreen-only in Iris)" % tag)
                    if program.startswith("gbuffers_") and "depthtex0" in samplers:
                        err("%s: gbuffers program samples depthtex0 (it is the bound depth attachment)" % tag)


def main():
    check_files()
    opts, profiles = check_options()
    screens = check_properties(opts, profiles)
    check_lang(opts, profiles, screens)
    check_samplers_and_uniforms(profiles)
    if ERRORS:
        for e in ERRORS:
            print("ERROR", e)
        print("%d problem(s)" % len(ERRORS))
        sys.exit(1)
    print("check_pack: all rules pass")


if __name__ == "__main__":
    main()
