#!/usr/bin/env python3
"""Build the one-click setup bundle for the official Minecraft Launcher.

    python3 tools/build_setup.py   -> dist/KestrelShaders-Setup-<version>.zip

The bundle holds the release zip, "Install on Mac.command", "Install on Windows.bat" (plus
install-windows.ps1) and HOW-TO-INSTALL.txt. The installers are rendered from
tools/setup/*.in: the quality profiles come from shaders.properties, so they always match
the pack. tools/test_setup.py runs the macOS installer against a local fake of the Fabric
and Modrinth APIs.
"""
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import package  # noqa: E402
from kestrel_pack import ROOT, parse_profiles  # noqa: E402

# The Minecraft version the pack targets (README, docs/VERIFICATION.md item 1).
MC_VERSION = "26.3"
SETUP = ROOT / "tools" / "setup"
PROFILE_ORDER = ["POTATO", "LOW", "MEDIUM", "HIGH"]
SAFE_VALUE = re.compile(r"^[A-Za-z0-9_.\-]+$")


def profile_lines(values):
    lines = []
    for key in sorted(values):
        value = values[key]
        if not (SAFE_VALUE.match(key) and SAFE_VALUE.match(value)):
            raise ValueError("unexpected profile entry %r=%r" % (key, value))
        lines.append("%s=%s" % (key, value))
    return lines


def render(template, subs):
    text = (SETUP / template).read_text()
    for key, value in subs.items():
        text = text.replace("@%s@" % key, value)
    left = re.findall(r"@[A-Z_]+@", text)
    if left:
        raise ValueError("%s: unreplaced %s" % (template, sorted(set(left))))
    return text


def build(version=None):
    version = version or package.version()
    pack_zip = ROOT / "dist" / ("KestrelShaders-%s.zip" % version)
    if not pack_zip.exists():
        package.main()
    profiles = parse_profiles()
    missing = [p for p in PROFILE_ORDER if p not in profiles]
    if missing:
        raise ValueError("profiles missing from shaders.properties: %s" % missing)

    cases = []
    table = []
    for name in PROFILE_ORDER:
        lines = profile_lines(profiles[name])
        cases.append("\t%s) cat <<'KESTREL_OPTIONS'\n%s\nKESTREL_OPTIONS\n\t\t;;" % (name, "\n".join(lines)))
        table.append('\t"%s" = "%s`n"' % (name, "`n".join(lines)))

    subs = {
        "VERSION": version,
        "MC_VERSION": MC_VERSION,
        "PACK": pack_zip.name,
        "JS": (SETUP / "kestrel-json.js").read_text().rstrip("\n"),
        "PROFILE_CASES": "\n".join(cases),
        "PROFILE_TABLE": "\n".join(table),
    }
    folder = "KestrelShaders-Setup-%s" % version
    files = [
        ("Install on Mac.command", render("install-mac.command.in", subs), 0o755, "\n"),
        ("install-windows.ps1", render("install-windows.ps1.in", subs), 0o644, "\r\n"),
        ("Install on Windows.bat", (SETUP / "install-windows.bat").read_text(), 0o644, "\r\n"),
        ("HOW-TO-INSTALL.txt", render("HOW-TO-INSTALL.txt.in", subs), 0o644, "\r\n"),
    ]
    out = ROOT / "dist" / ("KestrelShaders-Setup-%s.zip" % version)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, text, mode, eol in files:
            if any(ord(c) > 127 for c in text):
                raise ValueError("%s contains non-ASCII text" % name)
            data = text.replace("\r\n", "\n").replace("\n", eol).encode("ascii")
            info = zipfile.ZipInfo("%s/%s" % (folder, name), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100000 | mode) << 16
            info.create_system = 3  # Unix, so the executable bit survives unzipping on macOS
            z.writestr(info, data)
        info = zipfile.ZipInfo("%s/%s" % (folder, pack_zip.name), date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_STORED
        info.external_attr = (0o100000 | 0o644) << 16
        info.create_system = 3
        z.writestr(info, pack_zip.read_bytes())
    print("wrote %s (%.1f KB)" % (out.relative_to(ROOT), out.stat().st_size / 1024))
    return out


if __name__ == "__main__":
    build()
