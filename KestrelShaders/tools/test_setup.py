#!/usr/bin/env python3
"""End-to-end test of the macOS installer against a local fake of the Fabric meta and
Modrinth APIs. Needs bash, curl, shasum and Node.js (standing in for osascript's
JavaScript for Automation, which runs the same helper file).

    python3 tools/test_setup.py
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_setup  # noqa: E402

MC = build_setup.MC_VERSION
QUERY = "loaders=%5B%22fabric%22%5D&game_versions=%5B%22" + MC + "%22%5D"
LOADER = "0.17.3"
VERSION_ID = "fabric-loader-%s-%s" % (LOADER, MC)
FAILURES = []


def check(cond, what):
    print(("  ok    " if cond else "  FAIL  ") + what)
    if not cond:
        FAILURES.append(what)


class Fake:
    """Canned API state; tests change it between runs."""

    def __init__(self):
        self.files = {}
        self.routes = {}
        self.bad_hash = set()
        self.requests = []

    def jar(self, name, content):
        data = content.encode()
        self.files["/files/" + name] = data
        return {"filename": name, "primary": True, "url": None, "size": len(data),
                "hashes": {"sha512": hashlib.sha512(data).hexdigest(), "sha1": hashlib.sha1(data).hexdigest()}}

    def version(self, vid, project, name, content, date, vtype="release", deps=()):
        f = self.jar(name, content)
        return {"id": vid, "project_id": project, "version_type": vtype, "date_published": date,
                "files": [{"filename": "extra-sources.jar", "primary": False, "url": "/nope",
                           "hashes": {"sha512": "0" * 128}}, f],
                "dependencies": list(deps)}


def serve(fake):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            fake.requests.append((self.path, self.headers.get("User-Agent", "")))
            if self.path in fake.files:
                body = fake.files[self.path]
                if self.path in fake.bad_hash:
                    body = body + b"tampered"
                ctype = "application/java-archive"
            elif self.path in fake.routes:
                body = json.dumps(fake.routes[self.path]).encode()
                ctype = "application/json"
            else:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def setup_routes(fake, base, iris_release):
    fake.routes["/v2/versions/loader"] = [
        {"separator": "+", "build": 1, "maven": "net.fabricmc:fabric-loader:0.18.0-beta.1", "version": "0.18.0-beta.1", "stable": False},
        {"separator": ".", "build": 3, "maven": "net.fabricmc:fabric-loader:" + LOADER, "version": LOADER, "stable": True},
        {"separator": ".", "build": 2, "maven": "net.fabricmc:fabric-loader:0.17.2", "version": "0.17.2", "stable": True},
    ]
    fake.routes["/v2/versions/loader/%s/%s/profile/json" % (MC, LOADER)] = {
        "id": VERSION_ID, "inheritsFrom": MC, "type": "release", "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
        "libraries": [{"name": "net.fabricmc:fabric-loader:" + LOADER, "url": "https://maven.fabricmc.net/"}]}
    iris = [
        fake.version("irisBeta", "YL57xq9U", "iris-fabric-9.9.9-beta.jar", "iris beta", "2026-10-15T10:00:00.000000Z", "beta",
                     [{"project_id": "AANobbMI", "dependency_type": "required"}]),
        fake.version("irisRel", "YL57xq9U", iris_release, "iris release " + iris_release, "2026-10-01T10:00:00.123456Z", "release",
                     [{"project_id": "AANobbMI", "version_id": "sodPinned", "dependency_type": "required"},
                      {"project_id": "optionalMod", "dependency_type": "optional"}]),
        fake.version("irisOld", "YL57xq9U", "iris-fabric-1.0.0.jar", "iris old", "2025-01-01T10:00:00Z", "release"),
    ]
    sodium = [fake.version("sodNewer", "AANobbMI", "sodium-fabric-0.8.1.jar", "sodium newer", "2026-10-10T10:00:00Z", "release")]
    pinned = fake.version("sodPinned", "AANobbMI", "sodium-fabric-0.8.0.jar", "sodium", "2026-09-30T10:00:00Z", "release",
                          [{"version_id": "libVer", "dependency_type": "required"},
                           {"project_id": "YL57xq9U", "dependency_type": "required"}])
    lib = fake.version("libVer", "libProj", "fake-lib-1.0.jar", "lib", "2026-09-01T00:00:00Z")
    for v in iris + sodium + [pinned, lib]:
        for f in v["files"]:
            if f["url"] is None:
                f["url"] = base + "/files/" + f["filename"]
    fake.routes["/v2/project/iris/version?" + QUERY] = iris
    fake.routes["/v2/project/sodium/version?" + QUERY] = sodium
    fake.routes["/v2/project/AANobbMI/version?" + QUERY] = sodium
    fake.routes["/v2/version/sodPinned"] = pinned
    fake.routes["/v2/version/libVer"] = lib


def run_installer(work, mc_dir, base, args, stdin=""):
    env = dict(os.environ)
    env.update({"KESTREL_MC_DIR": str(mc_dir), "KESTREL_FABRIC_META": base, "KESTREL_MODRINTH_API": base,
                "PATH": str(work / "bin") + os.pathsep + env["PATH"], "TMPDIR": str(work / "tmp")})
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        env.pop(k, None)
    p = subprocess.run(["bash", str(work / "setup" / "Install on Mac.command")] + args, input=stdin,
                       capture_output=True, text=True, env=env, timeout=120)
    return p


def main():
    out = build_setup.build()
    work = Path(tempfile.mkdtemp(prefix="kestrel-setup-test-"))
    try:
        (work / "tmp").mkdir()
        (work / "bin").mkdir()
        shim = work / "bin" / "osascript"
        shim.write_text('#!/bin/sh\n# osascript -l JavaScript <file> args... -> node <file> args...\n'
                        'shift 2\nexec node "$@"\n')
        shim.chmod(0o755)
        # The installer asks you to quit the launcher if pgrep finds it; the test machine's
        # own processes must not trigger that.
        pgrep = work / "bin" / "pgrep"
        pgrep.write_text('#!/bin/sh\n[ -n "$KESTREL_TEST_LAUNCHER_RUNNING" ]\n')
        pgrep.chmod(0o755)
        with zipfile.ZipFile(out) as z:
            for info in z.infolist():
                name = info.filename.split("/", 1)[1]
                target = work / "setup" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(info))
                target.chmod((info.external_attr >> 16) & 0o777)
        check(os.access(work / "setup" / "Install on Mac.command", os.X_OK), "the Mac installer is executable in the zip")
        bat = (work / "setup" / "Install on Windows.bat").read_bytes()
        check(b"\r\n" in bat and b"\n\n" not in bat.replace(b"\r\n", b""), "the .bat file has CRLF line endings")
        pack = next(p.name for p in (work / "setup").iterdir() if p.name.startswith("KestrelShaders-") and p.suffix == ".zip")

        fake = Fake()
        httpd = serve(fake)
        base = "http://127.0.0.1:%d" % httpd.server_port
        setup_routes(fake, base, "iris-fabric-1.11.6.jar")

        mc = work / "Application Support" / "minecraft"
        mc.mkdir(parents=True)

        print("Run 0: launcher never started")
        p = run_installer(work, mc, base, ["MEDIUM"])
        check(p.returncode != 0 and "launcher_profiles.json" in p.stderr, "stops with a clear message")

        original = {"profiles": {"abc": {"name": "Latest release", "type": "latest-release", "lastVersionId": "latest-release"}},
                    "settings": {"crashAssistance": True, "enableAdvanced": False}, "version": 3}
        (mc / "launcher_profiles.json").write_text(json.dumps(original, indent=2))

        print("Run 1: fresh install, MEDIUM, through the prompt's default (Apple Silicon is not detectable here)")
        p = run_installer(work, mc, base, [], stdin="3\n")
        print(p.stdout[-1200:])
        if p.returncode != 0:
            print(p.stderr)
        check(p.returncode == 0, "installer succeeds")
        inst = mc / "kestrel-shaders"
        vdir = mc / "versions" / VERSION_ID
        check((vdir / (VERSION_ID + ".json")).exists(), "Fabric profile JSON written for the stable loader")
        check((vdir / (VERSION_ID + ".jar")).exists() and (vdir / (VERSION_ID + ".jar")).stat().st_size == 0, "empty version jar created")
        mods = sorted(x.name for x in (inst / "mods").iterdir())
        check(mods == [".kestrel-installed", "fake-lib-1.0.jar", "iris-fabric-1.11.6.jar", "sodium-fabric-0.8.0.jar"],
              "mods: newest Iris release (not the beta), the Sodium build Iris pins (once), its dependency: %s" % mods)
        check((inst / "mods" / "iris-fabric-1.11.6.jar").read_text() == "iris release iris-fabric-1.11.6.jar", "Iris jar content intact")
        check((inst / "shaderpacks" / pack).read_bytes() == (work / "setup" / pack).read_bytes(), "shader pack copied")
        opts = (inst / "shaderpacks" / (pack + ".txt")).read_text()
        check("SHADOW_FILTER=2" in opts and "SSR_OPAQUE=true" in opts and "shadowMapResolution=1536" in opts, "MEDIUM option values written")
        iris_cfg = (inst / "config" / "iris.properties").read_text()
        check("shaderPack=%s\n" % pack in iris_cfg and "enableShaders=true" in iris_cfg, "Iris set to load the pack")
        prof = json.loads((mc / "launcher_profiles.json").read_text())
        entry = prof["profiles"].get("kestrel-shaders", {})
        check(entry.get("lastVersionId") == VERSION_ID and entry.get("gameDir") == str(inst) and entry.get("type") == "custom",
              "launcher installation added")
        check(prof["profiles"]["abc"] == original["profiles"]["abc"] and prof["settings"] == original["settings"] and prof["version"] == 3,
              "existing launcher data preserved")
        check((mc / "launcher_profiles.json.kestrel-backup").exists(), "launcher profile backup made")
        uas = {ua for _, ua in fake.requests}
        check(all(ua.startswith("functionalaity-ai/KestrelShaders-Setup/") for ua in uas), "every request identifies itself (User-Agent)")
        check(not any("/nope" in path for path, _ in fake.requests), "only primary files downloaded")
        created = entry.get("created")

        print("Run 2: update (new Iris release), LOW from the command line, existing Iris config kept")
        (inst / "config" / "iris.properties").write_text("maxShadowRenderDistance=24\nshaderPack=Other.zip\nenableShaders=false\n")
        (inst / "mods" / "my-own-mod.jar").write_text("user mod")
        fake.routes.clear()
        setup_routes(fake, base, "iris-fabric-1.11.7.jar")
        p = run_installer(work, mc, base, ["low"])
        if p.returncode != 0:
            print(p.stdout, p.stderr)
        check(p.returncode == 0, "installer succeeds again")
        mods = sorted(x.name for x in (inst / "mods").iterdir())
        check("iris-fabric-1.11.6.jar" not in mods and "iris-fabric-1.11.7.jar" in mods and "my-own-mod.jar" in mods,
              "old Iris removed, new Iris installed, the player's own mod kept: %s" % mods)
        iris_cfg = (inst / "config" / "iris.properties").read_text()
        check("maxShadowRenderDistance=24" in iris_cfg and "shaderPack=%s" % pack in iris_cfg and "enableShaders=false" not in iris_cfg,
              "Iris config updated, other settings kept")
        opts = (inst / "shaderpacks" / (pack + ".txt")).read_text()
        check("SHADOW_FILTER=1" in opts and "SSR_OPAQUE=false" in opts, "LOW option values written")
        prof = json.loads((mc / "launcher_profiles.json").read_text())
        check(prof["profiles"]["kestrel-shaders"].get("created") == created, "installation keeps its creation time")

        print("Run 3: corrupted download")
        fake.bad_hash.add("/files/sodium-fabric-0.8.0.jar")
        p = run_installer(work, mc, base, ["MEDIUM"])
        check(p.returncode != 0 and "checksum" in p.stderr, "checksum mismatch stops the installer")
        mods = sorted(x.name for x in (inst / "mods").iterdir())
        check("iris-fabric-1.11.7.jar" in mods and "sodium-fabric-0.8.0.jar" in mods and "fake-lib-1.0.jar" in mods,
              "a failed update leaves the installed mods alone: %s" % mods)
        fake.bad_hash.clear()

        print("Run 4: launcher still open")
        os.environ["KESTREL_TEST_LAUNCHER_RUNNING"] = "1"
        p = run_installer(work, mc, base, ["MEDIUM"], stdin="\n")
        del os.environ["KESTREL_TEST_LAUNCHER_RUNNING"]
        check(p.returncode == 0 and "quit the Minecraft Launcher" in p.stdout, "asks to quit the launcher, then carries on")

        print("Run 5: unknown profile name")
        p = run_installer(work, mc, base, ["ULTRA"])
        check(p.returncode != 0 and "unknown profile" in p.stderr, "rejects an unknown profile")

        httpd.shutdown()
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print()
    if FAILURES:
        print("%d check(s) failed" % len(FAILURES))
        return 1
    print("all setup checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
