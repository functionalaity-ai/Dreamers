#!/usr/bin/env python3
"""Compile and link every program of every world folder with glslangValidator, for every
profile and vendor variant, plus a sweep that flips each option individually.

Iris-style environment macros are injected exactly as Iris emits them (value-less flags such
as MC_OS_MAC), the inline-glint functions are stubbed the way Iris injects them, and the
#version line stays first. glslang cannot reproduce Iris's compatibility-to-core rewrite or
its reversed-Z depth rewrite; those are covered by the in-game test plan (docs/TESTING.md).

    python3 tools/validate_glsl.py            # profiles x worlds x vendors + option sweep
    python3 tools/validate_glsl.py --quick    # profiles x worlds x vendors only
Install glslang with: apt-get install glslang-tools
"""
import argparse
import concurrent.futures
import hashlib
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kestrel_pack import (SHADERS, VENDORS, apply_overrides, expand, iris_macros,  # noqa: E402
                          parse_options, parse_profiles)
from programs import WORLDS, programs_for  # noqa: E402

GLINT_PROTOS = "bool mc_hasGlint();\nvec3 mc_sampleGlint();"
GLINT_STUBS = "bool mc_hasGlint() { return false; }\nvec3 mc_sampleGlint() { return vec3(0.0); }"


def build_source(stub, settings_text, vendor):
    lines = expand(stub, settings_text)
    version = lines[0][0]
    if not version.startswith("#version"):
        raise RuntimeError("%s: first line is not #version" % stub)
    head = [version] + iris_macros(vendor)
    if VENDORS[vendor]["glint"]:
        head.append(GLINT_PROTOS)
    body = [l for l, _, _ in lines[1:]]
    tail = [GLINT_STUBS] if VENDORS[vendor]["glint"] else []
    return "\n".join(head + body + tail) + "\n"


RE_LOC = re.compile(r"^(ERROR|WARNING): (.+?\.(?:vert|frag)):(\d+): (.*)$")


def compile_pair(job):
    world, program, config_name, settings_text, vendor = job
    folder = SHADERS / world
    with tempfile.TemporaryDirectory() as tmp:
        files = []
        sources = {}
        for ext, gl_ext in ((".vsh", ".vert"), (".fsh", ".frag")):
            src = build_source(folder / (program + ext), settings_text, vendor)
            out = Path(tmp) / (program + gl_ext)
            out.write_text(src)
            files.append(str(out))
            sources[str(out)] = src.split("\n")
        r = subprocess.run(["glslangValidator", "-l"] + files, capture_output=True, text=True)
        problems = []
        for line in (r.stdout + r.stderr).splitlines():
            line = line.strip()
            m = RE_LOC.match(line)
            if m:
                kind, path, ln, msg = m.group(1), m.group(2), int(m.group(3)), m.group(4)
                src = sources.get(path, [])
                text = src[ln - 1].strip()[:110] if 0 < ln <= len(src) else ""
                problems.append("%s %s:%d: %s   | %s" % (kind, Path(path).suffix, ln, msg, text))
            elif line.startswith("ERROR") or line.startswith("WARNING"):
                if "compilation errors" in line or "compilation terminated" in line:
                    continue
                problems.append(line)
        ok = r.returncode == 0 and not any(p.startswith("WARNING") or p.startswith("ERROR") for p in problems)
        return [(world, program, config_name, vendor, ok, problems)]


def configs(quick):
    opts = parse_options()
    profiles = parse_profiles()
    out = []
    for pname, values in profiles.items():
        out.append(("profile:" + pname, values, list(VENDORS)))
    if quick:
        return out, opts
    base = dict(profiles["MEDIUM"])
    for name, o in opts.items():
        if o.kind == "bool":
            v = dict(base)
            v[name] = "false" if base.get(name, o.default) == "true" else "true"
            out.append(("flip:%s=%s" % (name, v[name]), v, ["mac", "amd"]))
        elif o.kind in ("value", "const") and len(o.values) <= 12 and re.fullmatch(r"-?\d+", o.values[0] or ""):
            for val in o.values:
                if val == base.get(name, o.default):
                    continue
                v = dict(base)
                v[name] = val
                out.append(("set:%s=%s" % (name, val), v, ["mac"]))
    # POTATO-based sweep so cheap combinations (no resolve pass, no shadows) are covered too.
    pot = dict(profiles["POTATO"])
    for name in ("FXAA", "AUTO_EXPOSURE", "SSAO", "SSR_OPAQUE", "WATER_ADVANCED", "VOLUMETRIC_LIGHT", "PUDDLES", "CLOUD_SHADOWS"):
        v = dict(pot)
        v[name] = "true"
        out.append(("potato+%s" % name, v, ["intel"]))
    return out, opts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    args = ap.parse_args()

    cfgs, _ = configs(args.quick)
    jobs = []
    seen = set()
    for cname, values, vendors in cfgs:
        settings_text = apply_overrides(values)
        for vendor in vendors:
            for world in WORLDS:
                for program in programs_for(world):
                    key = hashlib.sha1((settings_text + vendor + world + program).encode()).hexdigest()
                    if key in seen:
                        continue
                    seen.add(key)
                    jobs.append((world, program, cname, settings_text, vendor))

    print("compiling %d program pairs (%d configs)..." % (len(jobs), len(cfgs)), flush=True)
    failures = []
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for res in ex.map(compile_pair, jobs):
            for world, program, cname, vendor, ok, problems in res:
                done += 1
                if not ok:
                    failures.append((world, program, cname, vendor, problems))
    by_key = {}
    for world, program, cname, vendor, problems in failures:
        sig = (program, tuple(problems[:3]))
        by_key.setdefault(sig, []).append("%s/%s [%s, %s]" % (world, program, cname, vendor))
    for (program, probs), where in sorted(by_key.items()):
        print("FAIL %s  (%d variants, e.g. %s)" % (program, len(where), where[0]))
        for p in probs:
            print("    " + p)
    print("%d/%d program pairs passed" % (done - len(failures), done))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
