// Kestrel Shaders setup - JSON helper for the macOS installer.
// Runs under macOS's built-in JavaScript for Automation (osascript -l JavaScript), so the
// installer needs nothing that isn't on every Mac. It also runs under Node.js, which is how
// tools/test_setup.py tests it.
//
//   fabric-loader <loaders.json>        newest stable Fabric loader version
//   json-get <file.json> <key>          a top-level string value
//   modrinth-pick <versions.json>       newest release in a /project/<id>/version list
//   modrinth-version <version.json>     the same fields for one /version/<id> object
//   add-profile <launcher_profiles.json> <key> <name> <versionId> <gameDir> <isoTime>
//
// modrinth-* print one tab-separated line: version id, project id, filename, url, sha512,
// required dependencies (comma-separated "p:<project id>" or "v:<version id>", or "-").

var isJXA = typeof ObjC !== "undefined";
if (isJXA) ObjC.import("Foundation");

function readText(path) {
	if (isJXA) {
		var s = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, null);
		var text = ObjC.unwrap(s);
		if (text === undefined || text === null) throw new Error("cannot read " + path);
		return text;
	}
	return require("fs").readFileSync(path, "utf8");
}

function writeText(path, text) {
	if (isJXA) {
		var ok = $(text).writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, null);
		if (!ok) throw new Error("cannot write " + path);
		return;
	}
	require("fs").writeFileSync(path, text, "utf8");
}

function readJson(path) {
	var text = readText(path).replace(/^\uFEFF/, "");
	return JSON.parse(text);
}

// Accepts /v2/versions/loader (flat entries) and /v2/versions/loader/<game> ({loader: ...}).
function pickFabricLoader(list) {
	if (!Array.isArray(list) || list.length === 0) throw new Error("no Fabric loader versions listed");
	var entries = list.map(function (e) { return e.loader ? e.loader : e; });
	for (var i = 0; i < entries.length; i++) {
		if (entries[i].stable && entries[i].version) return entries[i].version;
	}
	return entries[0].version;
}

function describeVersion(v) {
	var files = v.files || [];
	var file = null;
	for (var i = 0; i < files.length; i++) if (files[i].primary) { file = files[i]; break; }
	if (!file) file = files[0];
	if (!file) throw new Error("version " + v.id + " has no files");
	var deps = [];
	var list = v.dependencies || [];
	for (var j = 0; j < list.length; j++) {
		var d = list[j];
		if (d.dependency_type !== "required") continue;
		if (d.version_id) deps.push("v:" + d.version_id);
		else if (d.project_id) deps.push("p:" + d.project_id);
	}
	return [v.id, v.project_id, file.filename, file.url, file.hashes.sha512, deps.length ? deps.join(",") : "-"].join("\t");
}

function pickModrinth(list) {
	if (!Array.isArray(list) || list.length === 0) throw new Error("no build for this Minecraft version on Modrinth");
	// ISO 8601 UTC timestamps sort as strings (Date.parse varies between engines).
	var sorted = list.slice().sort(function (a, b) {
		var x = String(a.date_published), y = String(b.date_published);
		return x < y ? 1 : (x > y ? -1 : 0);
	});
	for (var i = 0; i < sorted.length; i++) {
		if (sorted[i].version_type === "release") return describeVersion(sorted[i]);
	}
	return describeVersion(sorted[0]);
}

function addProfile(path, key, name, versionId, gameDir, time) {
	var data = readJson(path);
	if (typeof data !== "object" || data === null) throw new Error(path + " is not a JSON object");
	if (typeof data.profiles !== "object" || data.profiles === null) data.profiles = {};
	var old = data.profiles[key] || {};
	data.profiles[key] = {
		name: name,
		type: "custom",
		created: old.created || time,
		lastUsed: time,
		icon: old.icon || "Furnace",
		lastVersionId: versionId,
		gameDir: gameDir
	};
	if (old.javaArgs) data.profiles[key].javaArgs = old.javaArgs;
	writeText(path, JSON.stringify(data, null, 2) + "\n");
	return "ok";
}

function run(argv) {
	var cmd = argv[0];
	if (cmd === "fabric-loader") return pickFabricLoader(readJson(argv[1]));
	if (cmd === "json-get") {
		var v = readJson(argv[1])[argv[2]];
		if (typeof v !== "string") throw new Error(argv[2] + " missing in " + argv[1]);
		return v;
	}
	if (cmd === "modrinth-pick") return pickModrinth(readJson(argv[1]));
	if (cmd === "modrinth-version") return describeVersion(readJson(argv[1]));
	if (cmd === "add-profile") return addProfile(argv[1], argv[2], argv[3], argv[4], argv[5], argv[6]);
	throw new Error("unknown command " + cmd);
}

if (!isJXA && typeof process !== "undefined" && require.main === module) {
	try {
		process.stdout.write(run(process.argv.slice(2)) + "\n");
	} catch (e) {
		process.stderr.write("error: " + e.message + "\n");
		process.exit(1);
	}
}
