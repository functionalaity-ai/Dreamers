"""Shared helpers for the Kestrel tools: option parsing from settings.glsl, profile parsing
from shaders.properties, include expansion with line mapping, and Iris macro sets."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHADERS = ROOT / "shaders"
SETTINGS = SHADERS / "lib" / "settings.glsl"
PROPERTIES = SHADERS / "shaders.properties"

RE_BOOL = re.compile(r"^(\s*)(//)?\s*#define\s+([A-Za-z_][A-Za-z0-9_]*)\s*(//.*)?$")
RE_VALUE = re.compile(r"^(\s*)#define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(\S+)\s*//\s*\[([^\]]*)\](.*)$")
RE_CONST = re.compile(r"^(\s*)const\s+(int|float|bool)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);\s*//\s*\[([^\]]*)\](.*)$")
RE_INCLUDE = re.compile(r'^\s*#include\s+"([^"]+)"\s*$')


class Option:
    def __init__(self, name, kind, default, values=None, line=0):
        self.name = name
        self.kind = kind          # "bool", "value", "const"
        self.default = default    # "true"/"false" for bools, string otherwise
        self.values = values or []
        self.line = line

    def __repr__(self):
        return "Option(%s, %s, %s)" % (self.name, self.kind, self.default)


def parse_options(text=None):
    """Return {name: Option} for every user option in settings.glsl."""
    text = SETTINGS.read_text() if text is None else text
    opts = {}
    for i, line in enumerate(text.splitlines(), 1):
        m = RE_CONST.match(line)
        if m:
            opts[m.group(3)] = Option(m.group(3), "const", m.group(4).strip(), m.group(5).split(), i)
            continue
        m = RE_VALUE.match(line)
        if m:
            opts[m.group(2)] = Option(m.group(2), "value", m.group(3), m.group(4).split(), i)
            continue
        m = RE_BOOL.match(line)
        if m and (m.group(4) is None or not re.match(r"//\s*\[", m.group(4) or "")):
            name = m.group(3)
            # Internal macros always carry a value, so a bare define here is an option.
            opts[name] = Option(name, "bool", "false" if m.group(2) else "true", [], i)
    return opts


def apply_overrides(overrides, text=None):
    """Rewrite settings.glsl text with option values from overrides {name: value}."""
    text = SETTINGS.read_text() if text is None else text
    out = []
    for line in text.splitlines():
        m = RE_CONST.match(line)
        if m and m.group(3) in overrides:
            line = "%sconst %s %s = %s; // [%s]%s" % (m.group(1), m.group(2), m.group(3), overrides[m.group(3)], m.group(5), m.group(6))
            out.append(line)
            continue
        m = RE_VALUE.match(line)
        if m and m.group(2) in overrides:
            line = "%s#define %s %s // [%s]%s" % (m.group(1), m.group(2), overrides[m.group(2)], m.group(4), m.group(5))
            out.append(line)
            continue
        m = RE_BOOL.match(line)
        if m and m.group(3) in overrides:
            on = str(overrides[m.group(3)]).lower() == "true"
            comment = (" " + m.group(4)) if m.group(4) else ""
            line = "%s%s#define %s%s" % (m.group(1), "" if on else "//", m.group(3), comment)
        out.append(line)
    return "\n".join(out) + "\n"


def read_properties_lines():
    """Logical lines of shaders.properties (no preprocessing, continuation joined)."""
    lines = []
    buf = ""
    for raw in PROPERTIES.read_text().splitlines():
        if raw.endswith("\\"):
            buf += raw[:-1] + " "
            continue
        buf += raw
        lines.append(buf)
        buf = ""
    return lines


def parse_profiles():
    """Return {profile: {option: value}} from shaders.properties."""
    profiles = {}
    for line in read_properties_lines():
        m = re.match(r"^\s*profile\.([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if not m:
            continue
        values = {}
        for tok in m.group(2).split():
            if tok.startswith("profile.") or tok.startswith("!program."):
                continue
            if tok.startswith("!"):
                values[tok[1:]] = "false"
            elif ":" in tok:
                k, v = tok.split(":", 1)
                values[k] = v
            elif "=" in tok:
                k, v = tok.split("=", 1)
                values[k] = v
            else:
                values[tok] = "true"
        profiles[m.group(1)] = values
    return profiles


def expand(path, settings_text=None, _stack=None):
    """Expand #include directives. Returns list of (text, file, line) tuples."""
    _stack = _stack or []
    if path in _stack:
        raise RuntimeError("include cycle: %s" % " -> ".join(str(p) for p in _stack + [path]))
    if path.resolve() == SETTINGS.resolve() and settings_text is not None:
        text = settings_text
    else:
        text = path.read_text()
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        m = RE_INCLUDE.match(line)
        if m:
            inc = m.group(1)
            target = (SHADERS / inc.lstrip("/")) if inc.startswith("/") else (path.parent / inc)
            out.extend(expand(target, settings_text, _stack + [path]))
        else:
            out.append((line, path, i))
    return out


# Render stage ordinals (WorldRenderingPhase in Iris 26.3).
RENDER_STAGES = ["NONE", "SKY", "SUNSET", "CUSTOM_SKY", "SUN", "MOON", "STARS", "VOID", "TERRAIN_SOLID",
                 "TERRAIN_CUTOUT_MIPPED", "TERRAIN_CUTOUT", "ENTITIES", "BLOCK_ENTITIES", "DESTROY", "OUTLINE",
                 "DEBUG", "HAND_SOLID", "TERRAIN_TRANSLUCENT", "TRIPWIRE", "PARTICLES", "CLOUDS", "RAIN_SNOW",
                 "WORLD_BORDER", "HAND_TRANSLUCENT"]

# Vendor variants, emitted exactly as Iris does: environment macros without a value.
VENDORS = {
    "mac": {"flags": ["MC_OS_MAC", "MC_GL_VENDOR_OTHER", "MC_GL_RENDERER_APPLE"], "glsl": 410,
            "glint": True, "hw": True, "labpbr": False},
    "intel": {"flags": ["MC_OS_WINDOWS", "MC_GL_VENDOR_INTEL", "MC_GL_RENDERER_INTEL"], "glsl": 460,
              "glint": True, "hw": True, "labpbr": True},
    "amd": {"flags": ["MC_OS_WINDOWS", "MC_GL_VENDOR_ATI", "MC_GL_RENDERER_RADEON"], "glsl": 460,
            "glint": False, "hw": False, "labpbr": False},
    "nvidia": {"flags": ["MC_OS_LINUX", "MC_GL_VENDOR_NVIDIA", "MC_GL_RENDERER_GEFORCE"], "glsl": 460,
               "glint": True, "hw": False, "labpbr": True},
    # An OpenGL 3.3-only driver: no per-buffer blending (KS_BUFFER_BLEND off).
    "gl33": {"flags": ["MC_OS_WINDOWS", "MC_GL_VENDOR_INTEL", "MC_GL_RENDERER_INTEL"], "glsl": 330,
             "glint": True, "hw": False, "labpbr": False},
}


def iris_macros(vendor):
    v = VENDORS[vendor]
    lines = [
        "#define MC_VERSION 260300",
        "#define MC_GL_VERSION %d" % (v["glsl"] if v["glsl"] in (330, 410) else 460),
        "#define MC_GLSL_VERSION %d" % v["glsl"],
        "#define MC_MIPMAP_LEVEL 4",
        "#define IRIS_VERSION 11106",
        "#define IS_IRIS",
        "#define IRIS_TAG_SUPPORT 2",
        "#define MAX_COLOR_BUFFERS 16",
        "#define MC_NORMAL_MAP",
        "#define MC_SPECULAR_MAP",
        "#define MC_RENDER_QUALITY 1.0",
        "#define MC_SHADOW_QUALITY 1.0",
        "#define MC_HAND_DEPTH 0.125",
        "#define IRIS_FEATURE_BLOCK_EMISSION_ATTRIBUTE",
    ]
    lines += ["#define %s" % f for f in v["flags"]]
    lines += ["#define MC_RENDER_STAGE_%s %d" % (s, i) for i, s in enumerate(RENDER_STAGES)]
    if v["glint"]:
        lines.append("#define IRIS_INLINE_GLINT")
    if v["hw"]:
        lines.append("#define IRIS_FEATURE_SEPARATE_HARDWARE_SAMPLERS")
    if v["labpbr"]:
        lines.append("#define MC_TEXTURE_FORMAT_LAB_PBR")
        lines.append("#define MC_TEXTURE_FORMAT_LAB_PBR_1_3")
    return lines
