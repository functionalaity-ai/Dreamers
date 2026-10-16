#!/usr/bin/env python3
"""Build the release zip: shaders/ at the zip root plus README, LICENSE and CREDITS.
Leaves out tools/ and docs/. Deterministic (fixed timestamps, sorted entries).

    python3 tools/package.py            -> dist/KestrelShaders-<version>.zip
"""
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "CHANGELOG.md"


def version():
    m = re.search(r"^##\s*\[?v?(\d+\.\d+\.\d+)", VERSION_FILE.read_text(), re.M) if VERSION_FILE.exists() else None
    return m.group(1) if m else "0.0.0"


def main():
    ver = version()
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    out = dist / ("KestrelShaders-%s.zip" % ver)
    files = sorted(p for p in (ROOT / "shaders").rglob("*") if p.is_file())
    extra = [ROOT / n for n in ("README.md", "LICENSE", "CREDITS.md") if (ROOT / n).exists()]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files + extra:
            arc = p.relative_to(ROOT).as_posix()
            info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, p.read_bytes())
    print("wrote %s (%d files, %.1f KB)" % (out.relative_to(ROOT), len(files) + len(extra), out.stat().st_size / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
