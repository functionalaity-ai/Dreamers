// Road detail for Old Town: granite kerbs over sett gutters and a granite edging round the square,
// then one baked ground atlas laid across the streets (cast-iron covers, drain grates and kerb
// inlets, tar repairs, sealed cracks, tyre wear, oil, soot, fallen leaves and litter) and a handful
// of real cans, bottles and paper balls. Every placement comes from a fixed seed.
import * as THREE from 'three';
import { NOISE } from '../core/gpu.js';
import { enhance } from '../core/shaderlib.js';
import { worldUV } from '../core/geometry.js';

// Cross-street sizes (metres): the sett gutter in front of each kerb, the granite edging between
// the asphalt and the square, the kerbstone's depth and the sidewalk height.
export const ROAD = { gutter: 0.4, edge: 0.22, kerb: 0.28, walk: 0.13 };

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A raised sidewalk slab with its collider; the edge nearer the middle of the map faces the road
// and is left for the kerb (built later from every slab's road edge).
export function sidewalk(B, x0, x1, z0, z1) {
  const north = Math.abs(z1) < Math.abs(z0);
  B.solid(x0, 0, north ? z0 : z0 + ROAD.kerb, x1, ROAD.walk, north ? z1 - ROAD.kerb : z1, 'sidewalk', null);
  B.collider(x0, 0, z0, x1, ROAD.walk, z1, 'concrete');
  (B.walks || (B.walks = [])).push({ x0, x1, z0, z1, edge: north ? z1 : z0, dir: north ? 1 : -1 });
}

// --- granite ------------------------------------------------------------------------------------
// Grey granite with feldspar, quartz and mica grains, its top dressed smooth by wear.
function graniteSet(B, size) {
  return B.bake({
    name: 'granite', size, tile: 0.8, seed: 41, normalStrength: 0.7, cavity: 0.8,
    fields: /* glsl */`
      vec4 fields(vec2 uv) {
        vec4 a = voronoi(uv, vec2(240.0), 1.0);
        vec4 b = voronoi(uv + 0.31, vec2(96.0), 1.0);
        float mica = step(0.8, a.z) * smoothstep(0.5, 0.15, a.x);
        float feld = step(0.62, b.z) * smoothstep(0.0, 0.06, b.y);
        float pit = smoothstep(0.88, 0.97, hash12(sd(floor(uv * 520.0))));
        float h = fbm(uv, 80.0, 3) * 0.3 + feld * 0.1 + smoothstep(0.0, 0.1, a.y) * 0.06 - pit * 0.3;
        return vec4(h, mica, feld, fbm(uv, 5.0, 4));
      }`,
    shade: /* glsl */`
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        vec4 a = voronoi(uv, vec2(240.0), 1.0);
        vec3 c = mix(lin(vec3(0.6, 0.6, 0.61)), lin(vec3(0.72, 0.7, 0.67)), step(0.45, a.w));
        c = mix(c, lin(vec3(0.7, 0.61, 0.57)), F.z * 0.5);
        c = mix(c, lin(vec3(0.15, 0.15, 0.16)), F.y);
        c *= (0.86 + 0.24 * (fbm(uv, 28.0, 3) + 0.5)) * (0.92 + 0.12 * F.w);
        c *= 1.0 - cav * 0.3;
        alb = c;
        rough = 0.6 + 0.2 * (fbm(uv, 45.0, 2) + 0.5) - F.y * 0.25;
        metal = 0.0;
      }`,
  });
}

function graniteMaterial(materials) {
  const P = materials.preset;
  const set = graniteSet(materials.baker, Math.max(256, P.textureSize / 2));
  for (const t of [set.map, set.normalMap, set.ormMap]) { t.repeat.set(1 / 0.8, 1 / 0.8); t.anisotropy = P.anisotropy; }
  const m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.ormMap, aoMap: set.ormMap, metalnessMap: set.ormMap, roughness: 1, metalness: 1, vertexColors: true, name: 'granite' });
  enhance(m, { weather: { grime: 0.3, moss: 0.08, streaks: 0, tone: 0.5 }, box: true });
  m.envMapIntensity = 0.42;
  return m;
}

// Kerbstone cross-section in (z, y): back to front, the road face at z = 0 and the slab behind it.
// The top drains a little towards the road and the front arris is worn round.
const PROFILE = [[-ROAD.kerb, -0.03], [-ROAD.kerb, 0.134], [-0.04, 0.132], [-0.016, 0.127], [-0.004, 0.112], [0, 0], [0, -0.03]];
const SHOWN = [1, 2, 3, 4];   // edges that can be seen: top, two arris facets, face

// One stone from x = -len/2 to len/2, flat-shaded (the back, base and buried face are left off).
function kerbStone(len, tint) {
  const pos = [];
  const pt = (x, i) => [x, PROFILE[i][1], PROFILE[i][0]];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (const e of SHOWN) {
    const a0 = pt(-len / 2, e), a1 = pt(len / 2, e), b0 = pt(-len / 2, e + 1), b1 = pt(len / 2, e + 1);
    tri(a0, b0, b1); tri(a0, b1, a1);
  }
  // end caps, seen only through the joints (the profile runs clockwise in z-y)
  for (const x of [-len / 2, len / 2]) for (let i = 1; i < PROFILE.length - 1; i++) {
    if (x < 0) tri(pt(x, 0), pt(x, i + 1), pt(x, i)); else tri(pt(x, 0), pt(x, i), pt(x, i + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return colorize(g, tint);
}

// A box from its corners (all six faces), for the flush edging stones and joint fillers.
function slab(x0, y0, z0, x1, y1, z1, tint) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toNonIndexed();
  return colorize(g, tint);
}

function colorize(g, tint) {
  const c = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < c.length; i += 3) { c[i] = tint[0]; c[i + 1] = tint[1]; c[i + 2] = tint[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// Joins the sidewalks' road edges into continuous kerb runs.
function kerbRuns(walks) {
  const runs = [];
  for (const w of walks.slice().sort((a, b) => a.edge - b.edge || a.x0 - b.x0)) {
    const r = runs[runs.length - 1];
    if (r && Math.abs(r.z - w.edge) < 1e-3 && w.x0 <= r.x1 + 0.01) r.x1 = Math.max(r.x1, w.x1);
    else runs.push({ x0: w.x0, x1: w.x1, z: w.edge, dir: w.dir });
  }
  return runs;
}

function granite(B, mat, rnd) {
  const stoneTint = () => { const v = 0.8 + rnd() * 0.22, w = (rnd() - 0.5) * 0.05; return [v * (1 + w), v, v * (1 - w)]; };
  const joint = [0.1, 0.095, 0.09];
  for (const run of kerbRuns(B.walks || [])) {
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), run.dir > 0 ? 0 : Math.PI);
    let x = run.x0;
    while (x < run.x1 - 0.02) {
      const len = Math.min(run.x1 - x, 0.85 + rnd() * 0.42);
      const g = kerbStone(len - 0.007, stoneTint());
      // each stone settled a little differently
      const q = rot.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.008, (rnd() - 0.5) * 0.004, 0)));
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x + len / 2, (rnd() - 0.5) * 0.004, run.z + (rnd() - 0.5) * 0.003 * run.dir), q, new THREE.Vector3(1, 1, 1)));
      worldUV(g);
      B.geo(mat, g);
      x += len;
    }
    // dark bedding behind the joints
    const zb = run.z - run.dir * (ROAD.kerb - 0.006), zf = run.z - run.dir * 0.008;
    const fill = slab(run.x0, -0.03, Math.min(zb, zf), run.x1, 0.121, Math.max(zb, zf), joint);
    worldUV(fill);
    B.geo(mat, fill);
  }
  // flush edging where the asphalt meets the square (in the same batch: one mesh for all granite)
  for (const s of [-1, 1]) {
    const z0 = s < 0 ? -13 - ROAD.edge : 13, z1 = s < 0 ? -13 : 13 + ROAD.edge;
    let x = -52;
    while (x < 51.98) {
      const len = Math.min(52 - x, 0.9 + rnd() * 0.6);
      const g = slab(x + 0.003, -0.05, z0 + 0.003, x + len - 0.003, 0, z1 - 0.003, stoneTint());
      worldUV(g);
      B.geo(mat, g);
      x += len;
    }
    const fill = slab(-52, -0.05, z0, 52, -0.007, z1, joint);
    worldUV(fill);
    B.geo(mat, fill);
  }
}

// --- ground atlas -------------------------------------------------------------------------------
// Regions at the 2048 x 1024 layout: [name, family, kind, x, y (from the bottom), w, h in px,
// metres across]. A family is one shader; `kind` picks its design.
const REGIONS = [
  ['manAcqua', 'covers', 0, 0, 768, 256, 256, 0.86], ['manGas', 'covers', 1, 256, 768, 256, 256, 0.74],
  ['manTele', 'covers', 2, 512, 768, 256, 256, 0.7], ['tarA', 'stains', 0, 768, 768, 256, 256, 2.4],
  ['tarB', 'stains', 1, 1024, 768, 256, 256, 2.0], ['oilA', 'stains', 2, 1280, 768, 256, 256, 1.2],
  ['oilB', 'stains', 3, 1536, 768, 256, 256, 1.2], ['soot', 'stains', 4, 1792, 768, 256, 256, 3.4],
  ['leavesDense', 'leaves', 0, 0, 512, 256, 256, 1.1], ['leavesSparse', 'leaves', 1, 256, 512, 256, 256, 1.1],
  ['leafSet', 'leaves', 2, 512, 512, 256, 256, 0.64], ['litter', 'litter', 0, 768, 512, 256, 256, 0.8],
  ['swatch', 'litter', 1, 1024, 512, 256, 256, 0.8], ['grateA', 'grates', 0, 1280, 640, 256, 128, 0.8],
  ['grateB', 'grates', 1, 1280, 512, 256, 128, 0.8], ['valveGas', 'covers', 3, 1536, 640, 128, 128, 0.32],
  ['valveRound', 'covers', 4, 1664, 640, 128, 128, 0.32], ['hydrant', 'covers', 5, 1536, 512, 128, 128, 0.32],
  ['bolt', 'covers', 6, 1664, 512, 128, 128, 0.32], ['glass', 'stains', 8, 1792, 512, 256, 256, 1.0],
  ['crack0', 'lines', 0, 0, 256, 512, 64, 3.2], ['crack1', 'lines', 1, 0, 320, 512, 64, 3.2],
  ['crack2', 'lines', 2, 0, 384, 512, 64, 3.2], ['crack3', 'lines', 3, 0, 448, 512, 64, 3.2],
  ['tyre0', 'lines', 4, 512, 256, 512, 64, 5.0], ['tyre1', 'lines', 5, 512, 320, 512, 64, 5.0],
  ['tyre2', 'lines', 6, 512, 384, 512, 64, 5.0], ['skid', 'lines', 7, 512, 448, 512, 64, 5.0],
  ['trench0', 'stains', 5, 1024, 384, 512, 128, 6.0], ['trench1', 'stains', 6, 1024, 256, 512, 128, 6.0],
  ['grime0', 'lines', 8, 1536, 256, 512, 64, 4.0], ['grime1', 'lines', 9, 1536, 320, 512, 64, 4.0],
  ['grime2', 'lines', 10, 1536, 384, 512, 64, 4.0], ['inlet', 'grates', 2, 1536, 448, 512, 64, 1.0],
  ['gum', 'stains', 7, 0, 0, 256, 256, 1.0], ['patch', 'stains', 9, 256, 0, 512, 256, 4.0],
];
// 4 x 4 sheets inside a region, addressed as name0..name15
const SHEETS = { leafSet: 'leaf', litter: 'litter', swatch: 'swatch' };

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// Shared by every family: the region in metres (P, centred), coverage, compositing and two
// materials most designs use, cast iron and tar sealant.
const COMMON = /* glsl */`
uniform float uMode, uKind, uVar, uMmPx;
uniform vec2 uSize, uAtlas;
uniform sampler2D tF, tText;
varying vec2 vUv;
struct Surf { float h; float a; vec3 c; float r; float m; };
float sat(float x) { return clamp(x, 0.0, 1.0); }
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// antialiased coverage of d < 0 (d in metres, smoothed over about a texel)
float inside(float d) { return 1.0 - smoothstep(-0.7, 0.7, d * 1000.0 / uMmPx); }
float band(float d, float w) { return inside(abs(d) - w); }
// raised letters from the word sheet: row, P from the word's centre, cap height (metres)
float word(vec2 P, float row, float cap) {
  vec2 q = P / cap * 44.0;
  if (abs(q.y) > 31.0 || abs(q.x) > 500.0) return 0.0;
  return texture2D(tText, vec2(0.5 + q.x / 1024.0, 1.0 - (row * 64.0 + 32.0 - q.y) / 512.0)).r;
}
void over(inout Surf s, float a, float h, vec3 c, float r, float m) {
  s.c = mix(s.c, c, a); s.h = mix(s.h, h, a); s.r = mix(s.r, r, a); s.m = mix(s.m, m, a);
  s.a = a + s.a * (1.0 - a);
}
// cast iron: dark scale, rust in the hollows, raised work polished bright by tyres
void iron(inout Surf s, vec2 P, float raised, float hollow) {
  vec2 q = P + uVar * 1.3;
  float n = fbm(q, 6.0, 4) + 0.5, g = fbm(q + 3.1, 70.0, 2) + 0.5;
  float polish = raised * smoothstep(0.32, 0.72, n * 0.75 + g * 0.35);
  float rust = sat(hollow * 0.4 + smoothstep(0.6, 0.88, n) * 0.45) * (1.0 - polish) * smoothstep(0.2, 0.55, fbm(q + 7.7, 4.0, 3) + 0.5);
  vec3 c = lin(vec3(0.17, 0.168, 0.165)) * (0.72 + 0.5 * g);
  c = mix(c, mix(lin(vec3(0.36, 0.17, 0.075)), lin(vec3(0.24, 0.12, 0.06)), g), rust * 0.8);
  c = mix(c, lin(vec3(0.08, 0.075, 0.07)), hollow * 0.55);
  c = mix(c, lin(vec3(0.58, 0.57, 0.55)) * (0.85 + 0.3 * g), polish);
  s.c = c;
  s.r = mix(mix(0.74, 0.93, rust), 0.28 + 0.12 * g, polish);
  s.m = mix(mix(0.5, 0.06, rust), 0.95, polish);
}
// tar overband round a frame (d: metres outside it), ragged at its outer edge and sanded
void seal(inout Surf s, vec2 P, float d, float w) {
  float e = w * (0.7 + 0.6 * (fbm(P + 5.3 + uVar, 16.0, 3) + 0.5));
  float a = inside(d - e) * step(0.0, d) * 0.94;
  if (a <= 0.0) return;
  float sand = step(0.82, hash12(floor(P * 900.0) + uVar)) * 0.6;
  vec3 c = mix(lin(vec3(0.07, 0.068, 0.065)), lin(vec3(0.38, 0.36, 0.33)), sand);
  over(s, a, 0.8 * (1.0 - d / max(e, 1e-3)), c, mix(0.3, 0.75, sand), 0.0);
}
`;

const MAIN = /* glsl */`
void main() {
  Surf s; s.h = 0.0; s.a = 0.0; s.c = vec3(0.03); s.r = 0.85; s.m = 0.0;
  surf((vUv - 0.5) * uSize, s);
  if (uMode < 0.5) { gl_FragColor = vec4(s.h / uMmPx, s.a, 0.0, 1.0); return; }
  // occlusion: how far the neighbourhood rises above this texel (heights are in texels)
  vec2 auv = gl_FragCoord.xy / uAtlas;
  float h0 = texture2D(tF, auv).x, occ = 0.0;
  for (int k = 0; k < 8; k++) {
    float an = float(k) * 0.785398 + 0.39;
    vec2 d = vec2(cos(an), sin(an)) / uAtlas;
    occ += max(0.0, texture2D(tF, auv + d * 2.0).x - h0) * 0.5 + max(0.0, texture2D(tF, auv + d * 6.0).x - h0) / 6.0;
  }
  float ao = clamp(1.0 - occ * 0.09, 0.2, 1.0);
  if (uMode < 1.5) gl_FragColor = vec4(s.c * mix(1.0, ao, 0.75), s.a);
  else gl_FragColor = vec4(ao, clamp(s.r, 0.04, 1.0), clamp(s.m, 0.0, 1.0), 1.0);
}`;

const NORMAL = /* glsl */`
uniform sampler2D tF;
uniform vec2 uAtlas;
varying vec2 vUv;
void main() {
  vec2 t = 1.0 / uAtlas;
  float hx = texture2D(tF, vUv + vec2(t.x, 0.0)).x - texture2D(tF, vUv - vec2(t.x, 0.0)).x;
  float hy = texture2D(tF, vUv + vec2(0.0, t.y)).x - texture2D(tF, vUv - vec2(0.0, t.y)).x;
  gl_FragColor = vec4(normalize(vec3(-hx * 0.5, -hy * 0.5, 1.0)) * 0.5 + 0.5, 1.0);
}`;

const FAMILIES = {
  // Cast-iron covers: ACQUA (radial ribs and rings), GAS (diamond grid), TELEFONI (square grid),
  // small valve covers, a hydrant plate and a brass survey bolt.
  covers: /* glsl */`
void surf(vec2 P, inout Surf s) {
  int k = int(uKind + 0.5);
  float r = length(P);
  float h = 0.0, raised = 0.0, hollow = 0.0, edge = 1.0;
  if (k == 0 || k == 1 || k == 4) {
    float lid = k == 0 ? 0.345 : k == 1 ? 0.298 : 0.084;
    float frame = k == 0 ? 0.39 : k == 1 ? 0.338 : 0.1;
    float gap = k == 4 ? 0.0035 : 0.0055;
    edge = r - frame;
    if (r > lid + gap) { h = 2.0; raised = 0.35 + 0.65 * smoothstep(frame - 0.014, frame - 0.002, r); }
    else if (r > lid) { h = -9.0; hollow = 1.0; }
    else {
      float ang = atan(P.y, P.x);
      if (k == 0) {
        float pat = smoothstep(lid - 0.026, lid - 0.024, r);
        pat = max(pat, band(r - 0.212, 0.0055));
        pat = max(pat, band(r - 0.112, 0.0055));
        float a24 = fract(ang / 6.2831853 * 24.0) - 0.5;
        pat = max(pat, band(a24 * 6.2831853 / 24.0 * r, 0.0045) * step(0.112, r) * step(r, lid - 0.025));
        vec2 kq = abs(fract(rot2(P, 0.785398) / 0.016) - 0.5);
        pat = max(pat, (1.0 - step(0.3, max(kq.x, kq.y))) * step(r, 0.104) * 0.75);
        float plate = inside(sdBox(P, vec2(0.16, 0.034)));
        float txt = word(P, 0.0, 0.046);
        h = mix(pat * 4.0, 1.4 + txt * 3.6, plate);
        raised = mix(pat, txt, plate);
        hollow = (1.0 - raised) * (1.0 - plate * 0.7);
        float pick = max(inside(sdBox(P - vec2(0.0, 0.27), vec2(0.013, 0.0045))), inside(sdBox(P + vec2(0.0, 0.27), vec2(0.013, 0.0045))));
        h = mix(h, -14.0, pick); hollow = max(hollow, pick);
      } else if (k == 1) {
        vec2 dq = abs(fract(rot2(P, 0.785398) / 0.03) - 0.5) * 0.03;
        float pat = inside(max(dq.x, dq.y) - 0.0095) * step(r, lid - 0.016);
        pat = max(pat, smoothstep(lid - 0.017, lid - 0.015, r));
        float pd = sdBox(P, vec2(0.092, 0.036)) - 0.01;
        float plate = inside(pd);
        float groove = band(pd, 0.0028);
        float txt = word(P, 1.0, 0.05);
        h = mix(pat * 3.5, 2.0 + txt * 4.0, plate) - groove * 2.5;
        raised = mix(pat, txt, plate);
        hollow = max((1.0 - raised) * (1.0 - plate * 0.7), groove);
        float pick = max(inside(length(P - vec2(0.2, 0.17)) - 0.007), inside(length(P + vec2(0.2, 0.17)) - 0.007));
        h = mix(h, -14.0, pick); hollow = max(hollow, pick);
      } else {
        float pat = max(band(r - 0.072, 0.004), band(r - 0.045, 0.0035));
        float a8 = fract(ang / 6.2831853 * 8.0) - 0.5;
        pat = max(pat, band(a8 * 6.2831853 / 8.0 * r, 0.003) * step(0.045, r));
        float nut = inside(sdBox(rot2(P, 0.4 + uVar), vec2(0.012)));
        h = pat * 3.0 + nut * 6.0; raised = max(pat, nut); hollow = 1.0 - raised;
      }
    }
  } else if (k == 2 || k == 3) {
    float lidH = k == 2 ? 0.27 : 0.1, frameH = k == 2 ? 0.31 : 0.118;
    float dl = sdBox(P, vec2(lidH - 0.012)) - 0.012;
    float df = sdBox(P, vec2(frameH - 0.01)) - 0.01;
    edge = df;
    if (dl > 0.006) { h = 2.0; raised = 0.35 + 0.65 * smoothstep(-0.014, -0.002, df); }
    else if (dl > 0.0) { h = -9.0; hollow = 1.0; }
    else if (k == 2) {
      vec2 g = abs(fract(P / 0.036) - 0.5) * 0.036;
      float pat = inside(max(g.x, g.y) - 0.0115);
      pat = max(pat, smoothstep(-0.018, -0.016, dl));
      float plate = inside(sdBox(P, vec2(0.2, 0.029)));
      float txt = word(P, 2.0, 0.032);
      h = mix(pat * 3.5, 1.6 + txt * 3.8, plate);
      raised = mix(pat, txt, plate);
      hollow = (1.0 - raised) * (1.0 - plate * 0.7);
      float key = max(inside(sdBox(P - vec2(-0.205, 0.205), vec2(0.014, 0.005))), inside(sdBox(P - vec2(0.205, -0.205), vec2(0.014, 0.005))));
      h = mix(h, -14.0, key); hollow = max(hollow, key);
    } else {
      float hatch = max(band((fract((P.x + P.y) / 0.022) - 0.5) * 0.022, 0.0024), band((fract((P.x - P.y) / 0.022) - 0.5) * 0.022, 0.0024));
      float plate = inside(sdBox(P, vec2(0.05, 0.02)));
      float txt = word(P, 1.0, 0.026);
      h = mix(hatch * 2.5, 1.5 + txt * 3.0, plate);
      raised = mix(hatch, txt, plate);
      hollow = (1.0 - raised) * (1.0 - plate * 0.7);
    }
  } else if (k == 5) {
    float d = sdBox(P, vec2(0.125, 0.07)) - 0.008;
    edge = d;
    float rim = band(d + 0.008, 0.004);
    float txt = word(P, 3.0, 0.03);
    h = 1.5 + txt * 2.5 + rim * 1.5;
    raised = max(txt, rim);
    hollow = 1.0 - raised;
  } else {
    edge = r - 0.03;
    h = 2.5 * sqrt(sat(1.0 - (r / 0.03) * (r / 0.03))) - band(r - 0.018, 0.0015) * 1.2 - band(r, 0.002);
    raised = 0.6;
  }
  float a = inside(edge);
  if (a > 0.0) {
    iron(s, P, raised, hollow);
    float n = fbm(P + 9.0 + uVar, 18.0, 3);
    vec3 yel = lin(vec3(0.78, 0.6, 0.08));
    if (k == 1) { float fleck = smoothstep(0.12, 0.3, n) * hollow; s.c = mix(s.c, yel * 0.7, fleck * 0.8); s.m *= 1.0 - fleck; }
    if (k == 5) {
      float chip = smoothstep(0.05, 0.3, n) * raised;
      s.c = mix(yel * (0.8 + 0.3 * (n + 0.5)), s.c, chip * 0.8);
      s.r = mix(0.6, s.r, chip); s.m = mix(0.0, s.m, chip);
    }
    if (k == 6) { s.c = lin(vec3(0.62, 0.5, 0.26)) * (0.8 + 0.3 * (n + 0.5)); s.m = 0.9; s.r = 0.35; }
    s.h = h; s.a = a;
  }
  seal(s, P, edge, k >= 3 ? 0.012 : 0.024);
}`,

  // Drain grates in a tar collar, and the iron-lipped inlet in a kerb's face.
  grates: /* glsl */`
void surf(vec2 P, inout Surf s) {
  int k = int(uKind + 0.5);
  if (k == 2) {
    vec2 c = P - vec2(0.0, -0.012);
    float open = sdBox(c, vec2(0.3, 0.034));
    float lip = sdBox(c, vec2(0.314, 0.047));
    float bars = 0.0;
    for (int i = -1; i <= 1; i++) bars = max(bars, inside(abs(c.x - float(i) * 0.15) - 0.007));
    float halo = (1.0 - smoothstep(0.0, 0.035, lip)) * step(0.0, lip) * (0.35 + 0.4 * (fbm(vUv + uVar, vec2(20.0, 3.0), 3) + 0.5));
    over(s, halo * 0.6, 0.0, lin(vec3(0.12, 0.1, 0.08)), 0.9, 0.0);
    if (lip < 0.0) {
      float hole = inside(open) * (1.0 - bars);
      Surf t = s;
      iron(t, P, 1.0 - hole, 0.3);
      t.c = mix(t.c, lin(vec3(0.012)), hole); t.r = mix(t.r, 0.95, hole); t.m = mix(t.m, 0.0, hole);
      over(s, inside(lip), mix(2.0, -25.0, hole), t.c, t.r, t.m);
    }
    return;
  }
  vec2 hs = vec2(0.375, 0.178);
  float outer = sdBox(P, hs);
  float inner = sdBox(P, hs - 0.03);
  float solid = 1.0;
  if (inner < 0.0) {
    if (k == 0) {
      float bx = (fract(P.x / 0.05 + 0.5) - 0.5) * 0.05;
      solid = max(band(bx, 0.0105), band(P.y, 0.009));
    } else {
      vec2 c = (fract(P / vec2(0.062, 0.057) + 0.5) - 0.5) * vec2(0.062, 0.057);
      solid = 1.0 - inside(sdBox(c, vec2(0.021, 0.018)));
    }
  }
  float a = inside(outer);
  if (a > 0.0) {
    float slot = 1.0 - solid;
    iron(s, P, solid, slot * 0.5);
    // silt and leaf scraps caught down in the slots
    vec4 v = voronoi(vUv, vec2(40.0, 20.0), 1.0);
    float junk = step(0.55, v.z) * smoothstep(0.5, 0.2, v.x);
    vec3 deep = mix(lin(vec3(0.01)), (v.w > 0.5 ? lin(vec3(0.3, 0.17, 0.06)) : lin(vec3(0.12, 0.1, 0.07))) * 0.5, junk);
    s.c = mix(s.c, deep, slot); s.r = mix(s.r, 0.9, slot); s.m = mix(s.m, 0.0, slot);
    s.h = mix(1.5, -42.0 + junk * 6.0, slot);
    s.a = a;
  }
  seal(s, P, outer, 0.022);
}`,

  // Cut-and-filled repairs, a cold-mix pothole fill, oil, soot, gum and broken glass.
  stains: /* glsl */`
void newAsphalt(inout Surf s, vec2 q, float a, float settle) {
  vec4 v = voronoi(q, floor(uSize * 150.0), 1.0);
  float stone = smoothstep(0.5, 0.18, v.x) * step(0.45, v.z);
  float n = fbm(q, uSize * 1.5, 4) + 0.5;
  vec3 c = mix(lin(vec3(0.16, 0.155, 0.15)), lin(vec3(0.33, 0.32, 0.3)), stone * (0.4 + 0.6 * v.w));
  c *= 0.85 + 0.3 * n;
  over(s, a, settle + stone * 0.35 + (n - 0.5) * 0.4, c, 0.78 + 0.12 * n - stone * 0.15, 0.0);
}
void sealBand(inout Surf s, vec2 q, float d, float w) {
  float a = band(d, w);
  if (a <= 0.0) return;
  float age = fbm(q + 2.7 + uVar, uSize * 0.8, 3) + 0.5;
  float sand = step(0.84, hash12(floor(q * uSize * 700.0)));
  vec3 c = mix(lin(vec3(0.07, 0.068, 0.066)), lin(vec3(0.15, 0.145, 0.14)), age * 0.7);
  c = mix(c, lin(vec3(0.4, 0.38, 0.35)), sand * 0.7);
  float prof = sqrt(sat(1.0 - (d / w) * (d / w)));
  over(s, a, 0.9 * prof, c, mix(0.26, 0.6, age) + sand * 0.25, 0.0);
}
// nearest jittered site: xy = offset from it (cells), z = distance to the cell border, w = id
vec4 site(vec2 p, vec2 N, out vec2 rr) {
  vec2 ip = floor(p * N), fp = fract(p * N);
  float md = 8.0;
  vec2 mr = vec2(0.0), mg = vec2(0.0), mid = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 id = mod(ip + g, N);
    vec2 r = g + hash22(sd(id)) - fp;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; mid = id; }
  }
  float ed = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 r = g + hash22(sd(mod(ip + g, N))) - fp;
    if (dot(mr - r, mr - r) > 1e-5) ed = min(ed, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  rr = hash22(sd(mid) + 0.71);
  return vec4(-mr, ed, hash12(sd(mid) + 0.37));
}
void surf(vec2 P, inout Surf s) {
  int k = int(uKind + 0.5);
  vec2 q = vUv;
  if (k == 0 || k == 5 || k == 6 || k == 9) {
    float d;
    if (k == 0) d = sdBox(rot2(P, 0.025), vec2(0.92, 0.6));
    else if (k == 9) d = sdBox(P, vec2(1.86, 0.86));
    else if (k == 5) d = sdBox(P, vec2(2.78, 0.32));
    else d = min(sdBox(P - vec2(-0.25, -0.22), vec2(2.5, 0.3)), sdBox(P - vec2(1.55, 0.2), vec2(0.3, 0.5)));
    d += 0.012 * fbm(q + uVar, uSize * 5.0, 3) + 0.006 * fbm(q + 1.3, uSize * 20.0, 2);
    float w = 0.017 + 0.011 * (fbm(q + 4.1 + uVar, uSize * 2.0, 3) + 0.5);
    newAsphalt(s, q, inside(d), -1.6);
    sealBand(s, q, d, w);
  } else if (k == 1) {
    float d = length(P / vec2(1.0, 0.78)) - 0.6 + 0.13 * fbm(q + uVar, 3.0, 4) + 0.03 * fbm(q, 14.0, 2);
    vec4 v = voronoi(q, floor(uSize * 45.0), 1.0);
    float lump = smoothstep(0.55, 0.15, v.x);
    float n = fbm(q, 9.0, 3) + 0.5;
    vec3 c = mix(lin(vec3(0.13, 0.125, 0.12)), lin(vec3(0.3, 0.29, 0.27)), lump * step(0.5, v.z) * 0.8) * (0.85 + 0.3 * n);
    float a = inside(d);
    over(s, a, lump * 1.8 + n * 0.6 - 1.0, c, 0.86 - lump * 0.1, 0.0);
    float crumb = step(0.7, v.w) * smoothstep(0.35, 0.2, v.x) * (1.0 - a) * smoothstep(0.12, 0.0, d);
    over(s, crumb, 1.5, lin(vec3(0.2, 0.19, 0.18)), 0.85, 0.0);
  } else if (k == 2 || k == 3) {
    float d = 1e3;
    if (k == 2) {
      d = length(P * vec2(1.0, 1.28)) - 0.29 + 0.08 * fbm(q + uVar, 4.0, 4) + 0.025 * fbm(q, 13.0, 2);
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        vec2 c = (hash22(vec2(fi, 3.0 + uVar)) - 0.5) * 0.85;
        d = min(d, length(P - c) - (0.012 + 0.035 * hash12(vec2(fi, 9.0 + uVar))));
      }
    } else {
      for (int i = 0; i < 10; i++) {
        float t = float(i) / 9.0;
        vec2 c = vec2(-0.46 + t * 0.86, 0.1 * sin(t * 4.0 + uVar));
        float rr = (0.01 + 0.026 * hash12(vec2(float(i), uVar + 1.0))) * (0.6 + 0.7 * t);
        d = min(d, length((P - c) * vec2(1.0, 1.25)) - rr);
      }
      d = min(d, length(P - vec2(0.43, 0.08)) - 0.075 + 0.025 * fbm(q, 8.0, 3));
      d += 0.004 * fbm(q, 30.0, 2);
    }
    float a = inside(d);
    float rim = exp(-abs(d + 0.012) / 0.012);
    float inner = smoothstep(0.0, -0.18, d);
    float n = fbm(q + 7.0, 9.0, 3) + 0.5;
    vec3 c = mix(lin(vec3(0.17, 0.13, 0.09)), lin(vec3(0.035, 0.03, 0.025)), sat(inner + rim * 0.6));
    over(s, a * sat(0.5 + 0.28 * rim + 0.22 * inner + 0.12 * (n - 0.5)), 0.0, c, mix(0.42, 0.14, sat(inner + rim * 0.4)), 0.0);
  } else if (k == 4) {
    float n = fbm(q + uVar, 4.0, 5) + 0.5;
    float r = length(P / vec2(1.0, 0.78));
    float body = smoothstep(1.45, 0.3, r + (n - 0.5) * 0.9);
    float a = body * (0.6 + 0.35 * (fbm(q + 3.0, 10.0, 3) + 0.5));
    float ash = smoothstep(0.08, 0.3, fbm(q + 7.7, 7.0, 4)) * body;
    vec4 v = voronoi(q, vec2(14.0), 1.0);
    float melt = step(v.z, 0.16) * smoothstep(0.32, 0.18, v.x) * body;
    vec3 c = mix(lin(vec3(0.05, 0.045, 0.04)), lin(vec3(0.38, 0.36, 0.33)), ash * 0.55);
    c = mix(c, lin(vec3(0.02)), melt);
    over(s, sat(a), melt * 0.8, c, mix(0.95, 0.18, melt), 0.0);
  } else if (k == 7) {
    vec4 v = voronoi(q, vec2(15.0), 1.0);
    float rr = (0.006 + 0.009 * v.w) * 15.0;
    float spot = step(v.z, 0.45) * inside((v.x - rr) / 15.0 + 0.0015 * fbm(q, 60.0, 2)) * smoothstep(0.5, 0.3, length(q - 0.5));
    vec3 c = mix(lin(vec3(0.17, 0.165, 0.16)), lin(vec3(0.34, 0.33, 0.31)), v.w * 0.6);
    over(s, spot * 0.95, 0.5, c, 0.62, 0.0);
  } else {
    // broken glass: every shard lies at its own tilt, so the low sun picks out a few at a time
    float fall = smoothstep(0.5, 0.12, length(q - 0.5) + 0.14 * fbm(q + uVar, 4.0, 3));
    vec2 ra, rb;
    vec4 v = site(q, vec2(26.0), ra);
    vec4 w = site(q + 0.37, vec2(72.0), rb);
    float shard = step(v.w, 0.85 * fall) * inside(0.0016 - v.z / 26.0);
    float chip = step(w.w, 0.4 * fall) * inside(0.0012 - w.z / 72.0) * inside(length(w.xy) / 72.0 - 0.004);
    bool big = shard > 0.5;
    vec2 off = big ? v.xy / 26.0 : w.xy / 72.0;
    vec2 tilt = (big ? ra : rb) - 0.5;
    float tint = big ? v.w : w.w;
    vec3 c = tint < 0.06 ? lin(vec3(0.3, 0.18, 0.06)) : tint < 0.14 ? lin(vec3(0.16, 0.3, 0.14)) : lin(vec3(0.44, 0.47, 0.46));
    over(s, max(shard, chip) * 0.88, 0.8 + dot(off, tilt) * 600.0, c * 0.55, 0.04, 0.0);
  }
}`,

  // Sealed cracks, tyre wear, a skid and the grime that banks up against the kerbs.
  lines: /* glsl */`
void surf(vec2 P, inout Surf s) {
  int k = int(uKind + 0.5);
  vec2 q = vUv;
  if (k <= 3) {
    float fx = q.x;
    float yc = 0.075 * fbm(vec2(fx + uVar * 0.21, 0.37 + uVar * 0.1), vec2(5.0, 1.0), 4);
    if (k == 2) yc = 0.05 * (abs(fract(fx * 3.0 + uVar) - 0.5) * 4.0 - 1.0) + 0.04 * fbm(vec2(fx, 0.8 + uVar), vec2(9.0, 1.0), 3);
    float taper = smoothstep(0.0, 0.07, fx) * smoothstep(1.0, 0.93, fx);
    float w = (0.013 + 0.01 * (fbm(vec2(fx, 0.71 + uVar), vec2(11.0, 1.0), 3) + 0.5)) * taper;
    float core = abs(P.y - yc);
    float d = core - w;
    if (k == 1) {
      float t = sat((fx - 0.35) / 0.65);
      float yb = yc + t * 0.14 + 0.02 * fbm(vec2(fx, 1.9 + uVar), vec2(8.0, 1.0), 3);
      float wb = 0.01 * smoothstep(0.35, 0.42, fx) * smoothstep(1.0, 0.75, fx);
      float cb = abs(P.y - yb);
      d = min(d, cb - wb); core = min(core, cb + (1.0 - step(0.36, fx)));
    }
    if (k == 3) { float c2 = abs(P.y - yc - 0.068); d = min(d, c2 - w * 0.8); core = min(core, c2); }
    float a = inside(d);
    if (a > 0.0) {
      float age = fbm(vec2(fx * 2.0, 3.3 + uVar), vec2(4.0, 1.0), 3) + 0.5;
      float sand = step(0.84, hash12(floor(P * 650.0) + uVar));
      vec3 c = mix(lin(vec3(0.07, 0.068, 0.066)), lin(vec3(0.16, 0.155, 0.15)), age * 0.75);
      c = mix(c, lin(vec3(0.42, 0.4, 0.37)), sand * 0.65);
      c = mix(c, lin(vec3(0.025)), (1.0 - smoothstep(0.001, 0.0035, core)) * 0.7);
      float u = core / max(w, 1e-4);
      over(s, a * (0.82 + 0.18 * age), 0.9 * sqrt(sat(1.0 - u * u)), c, mix(0.25, 0.62, age) + sand * 0.25, 0.0);
    }
  } else if (k <= 6) {
    float fx = q.x;
    float y = P.y - 0.035 * fbm(vec2(fx, 0.5 + uVar), vec2(3.0, 1.0), 3);
    float prof = smoothstep(0.3, 0.09, abs(y));
    float streak = fbm(q + vec2(uVar * 0.13, 0.0), vec2(16.0, 28.0), 4) + 0.5;
    float patchy = fbm(q + 1.7 + uVar, vec2(5.0, 1.0), 4) + 0.5;
    float ends = smoothstep(0.0, 0.18, fx) * smoothstep(1.0, 0.82, fx);
    float a = prof * ends * sat(0.24 + 0.42 * streak + 0.3 * patchy);
    vec3 c = mix(lin(vec3(0.11, 0.105, 0.1)), lin(vec3(0.06, 0.058, 0.056)), streak);
    vec4 v = voronoi(q, vec2(60.0, 6.0), 1.0);
    float drip = step(0.93, v.z) * inside(v.x * 0.083 - 0.02) * prof;
    c = mix(c, lin(vec3(0.03, 0.026, 0.022)), drip);
    over(s, sat(a + drip * 0.6), streak * 0.2, c, 0.6 + 0.12 * (1.0 - prof) - 0.08 * streak - drip * 0.3, 0.0);
  } else if (k == 7) {
    float y = P.y - 0.02 * fbm(vec2(q.x, 0.3), vec2(4.0, 1.0), 3);
    float tyre = inside(abs(y) - 0.085 + 0.006 * fbm(q, vec2(40.0, 4.0), 2));
    float tread = 1.0 - 0.35 * step(0.55, fract(y / 0.014 + 0.5));
    float along = smoothstep(0.0, 0.55, q.x) * smoothstep(1.0, 0.95, q.x);
    over(s, tyre * along * tread * (0.5 + 0.35 * (fbm(q, vec2(24.0, 5.0), 3) + 0.5)), 0.1, lin(vec3(0.06, 0.058, 0.056)), 0.5, 0.0);
  } else {
    float side = smoothstep(-0.25, 0.2, P.y);
    float n = fbm(q + uVar * 0.31, vec2(24.0, 3.0), 5);
    float n2 = fbm(q + 2.3 + uVar, vec2(10.0, 1.5), 4);
    float ends = smoothstep(0.0, 0.12, q.x) * smoothstep(1.0, 0.88, q.x);
    float a = side * smoothstep(-0.2, 0.25, n + side * 0.25) * ends;
    vec4 g = voronoi(q, vec2(512.0, 64.0), 1.0);
    float grit = step(0.8, g.z) * smoothstep(0.35, 0.15, g.x) * side * ends;
    float wet = smoothstep(0.05, 0.25, n2) * side;
    vec3 c = mix(lin(vec3(0.33, 0.3, 0.25)), lin(vec3(0.13, 0.12, 0.1)), wet);
    c = mix(c, mix(lin(vec3(0.5, 0.47, 0.42)), lin(vec3(0.08)), step(0.5, g.w)), grit);
    over(s, sat(a * 0.8 + grit), grit * 1.2 + n * 0.3, c, mix(0.9, 0.36, wet), 0.0);
  }
}`,

  // Fallen leaves: plane-tree, ovate and oak shapes in autumn colours, with veins, curled edges and
  // a soft contact shadow; drifts are layered cells, the set is sixteen singles.
  leaves: /* glsl */`
vec3 leafTone(float k) {
  if (k < 0.16) return lin(vec3(0.68, 0.53, 0.2));
  if (k < 0.3) return lin(vec3(0.62, 0.37, 0.14));
  if (k < 0.44) return lin(vec3(0.46, 0.23, 0.1));
  if (k < 0.7) return lin(vec3(0.4, 0.27, 0.15));
  if (k < 0.88) return lin(vec3(0.57, 0.46, 0.31));
  return lin(vec3(0.4, 0.41, 0.2));
}
float leafShape(vec2 p, float type, out float vein, out float curl) {
  vein = 0.0; curl = 0.0;
  if (type < 0.5) {
    vec2 c = p - vec2(0.0, -0.12);
    float r = length(c), th = atan(c.x, c.y);
    float lobe = 1.0 - pow(abs(sin(2.5 * th)), 0.55);
    float R = (0.26 + 0.22 * lobe) * (0.8 + 0.2 * cos(th));
    R *= 1.0 - 0.75 * smoothstep(2.6, 3.1, abs(th));
    float dv = abs(fract(th / 1.2566 + 0.5) - 0.5) * 1.2566 * r;
    vein = (1.0 - smoothstep(0.008, 0.016, dv)) * step(r, R) * smoothstep(0.0, 0.05, r);
    curl = r / max(R, 0.05); curl *= curl;
    return (r - R) * 0.8;
  } else if (type < 1.5) {
    float t = clamp(p.y + 0.5, 0.0, 1.0);
    float hw = 0.3 * pow(sin(3.14159 * t), 0.8) * (1.2 - 0.5 * t) + 0.006 * sin(t * 70.0);
    float d = max(abs(p.x) - hw, abs(p.y) - 0.5);
    float sec = abs(fract((t - abs(p.x) * 1.4) * 6.0) - 0.5) / 6.0;
    vein = max(1.0 - smoothstep(0.007, 0.014, abs(p.x)), (1.0 - smoothstep(0.004, 0.01, sec)) * 0.6) * step(d, 0.0);
    curl = abs(p.x) / max(hw, 0.02); curl *= curl;
    return d;
  }
  float t = clamp(p.y + 0.5, 0.0, 1.0);
  float hw = 0.25 * pow(sin(3.14159 * t), 0.55) * (1.05 - 0.25 * t);
  hw *= 0.68 + 0.32 * abs(cos(t * 3.14159 * 4.5));
  float d = max(abs(p.x) - hw, abs(p.y) - 0.5);
  vein = (1.0 - smoothstep(0.007, 0.014, abs(p.x))) * step(d, 0.0);
  curl = abs(p.x) / max(hw, 0.02); curl *= curl;
  return d;
}
void leaf(inout Surf s, vec2 P, vec2 c, float L, float ang, float id, float lift, inout float near) {
  vec2 lp = rot2(P - c, -ang) / L;
  if (abs(lp.x) > 0.9 || abs(lp.y) > 1.0) return;
  float type = floor(hash12(vec2(id, 1.3)) * 3.0);
  float vein, curl;
  float d = leafShape(lp, type, vein, curl) * L;
  vec2 sb = type < 0.5 ? vec2(0.0, -0.16) : vec2(0.0, -0.48);
  d = min(d, sdSeg(lp, sb, sb + vec2(0.05, -0.25)) * L - 0.0016);
  near = min(near, d);
  float cov = inside(d);
  if (cov <= 0.0) return;
  float k = hash12(vec2(id, 7.7));
  vec3 tone = mix(leafTone(k), leafTone(fract(k + 0.37)), 0.35 * hash12(vec2(id, 2.2)));
  float blot = smoothstep(0.1, 0.35, fbm(lp * 0.5 + id * 0.17, 3.0, 3));
  vec3 col = tone * (0.85 + 0.3 * (fbm(lp * 0.25 + id * 0.1, 8.0, 3) + 0.5));
  col = mix(col, lin(vec3(0.3, 0.18, 0.08)), blot * 0.6);
  col = mix(col, col * 1.25 + 0.01, vein * 0.5);
  col = mix(col, lin(vec3(0.33, 0.21, 0.1)), smoothstep(-0.01, 0.0, d) * 0.6);
  float h = lift + 0.35 + curl * 1.2 + vein * 0.12 + fbm(lp * 0.3 + id * 0.11, 6.0, 2) * 0.4;
  s.c = mix(s.c, col, cov); s.h = mix(s.h, h, cov); s.r = mix(s.r, 0.6 + 0.15 * blot, cov); s.m = mix(s.m, 0.0, cov);
  s.a = max(s.a, cov);
}
void surf(vec2 P, inout Surf s) {
  int k = int(uKind + 0.5);
  float near = 1.0;
  if (k == 2) {
    vec2 cell = floor(vUv * 4.0);
    float id = cell.x + cell.y * 4.0 + 1.0;
    vec2 cc = ((cell + 0.5) / 4.0 - 0.5) * uSize;
    leaf(s, P, cc, 0.125, hash12(vec2(id, 9.0)) * 6.283, id, 0.0, near);
  } else {
    float dens = k == 0 ? 0.85 : 0.32;
    for (int layer = 0; layer < 3; layer++) {
      float N = 6.0 + float(layer) * 1.5;
      vec2 gi = floor(vUv * N);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 cid = gi + vec2(float(i), float(j));
        float id = cid.x * 7.0 + cid.y * 131.0 + float(layer) * 977.0 + uVar * 31.0;
        vec2 cpos = (cid + 0.2 + 0.6 * hash22(vec2(id, 1.5))) / N;
        float clump = smoothstep(0.5, 0.18, length(cpos - 0.5) + 0.16 * fbm(cpos + uVar, 3.0, 3));
        if (hash12(vec2(id, 0.5)) > dens * clump) continue;
        leaf(s, P, (cpos - 0.5) * uSize, 0.1 + 0.07 * hash12(vec2(id, 2.5)), hash12(vec2(id, 3.5)) * 6.283, id, float(layer) * 0.35, near);
      }
    }
  }
  // soft contact shadow round each leaf
  float ha = (1.0 - smoothstep(0.0, 0.01, near)) * 0.3;
  if (s.a < ha) { s.c = mix(vec3(0.005), s.c, s.a / ha); s.a = ha; }
}`,

  // Litter (kind 0): sixteen items on a 4 x 4 sheet. Swatches (kind 1): label, glass, paper and
  // metal finishes the 3D cans and bottles are mapped onto.
  litter: /* glsl */`
float polyD(vec2 p, float id, float R) {
  float d = -1e3;
  vec2 prev = vec2(0.0);
  for (int i = 0; i <= 6; i++) {
    float fi = i == 6 ? 0.0 : float(i);
    float a = fi * 1.0472 + (hash12(vec2(id, fi + 0.5)) - 0.5) * 0.7;
    vec2 v = vec2(cos(a), sin(a)) * R * (0.72 + 0.4 * hash12(vec2(id, fi + 10.5)));
    if (i > 0) { vec2 e = v - prev; d = max(d, dot(p - prev, normalize(vec2(e.y, -e.x)))); }
    prev = v;
  }
  return d;
}
vec2 turn(vec2 p, float id) { return rot2(p, hash12(vec2(id, 4.0)) * 6.283); }
void paper(inout Surf s, vec2 p, float id, float R, vec3 tone, float print) {
  vec2 lp = turn(p, id);
  float d = polyD(lp, id, R) + 0.003 * fbm(lp + id * 0.13, 70.0, 2);
  float a = inside(d);
  if (a <= 0.0) return;
  float cr = ridge(lp + id * 0.1, 22.0, 3);
  vec3 c = tone * (0.86 + 0.18 * cr);
  if (print > 0.5 && print < 1.5) {
    float rows = step(0.45, fract(lp.y / 0.0034));
    float cols = step(0.08, fract(lp.x / 0.042 + 0.5));
    float words = step(0.32, fbm(lp * 2.0 + id, 60.0, 2) + 0.5);
    c = mix(c, lin(vec3(0.16)), rows * cols * words * 0.7);
    c = mix(c, lin(vec3(0.2)), inside(sdBox(lp - vec2(0.02, 0.025), vec2(0.03, 0.022))) * 0.8);
  } else if (print > 1.5 && print < 2.5) {
    c = mix(c, lin(vec3(0.35, 0.45, 0.75)), band((fract(lp.y / 0.007) - 0.5) * 0.007, 0.0004) * 0.8);
    c = mix(c, lin(vec3(0.8, 0.3, 0.3)), band(lp.x + 0.03, 0.0005) * 0.8);
  } else if (print > 2.5) {
    c = mix(c, lin(vec3(0.62, 0.1, 0.07)), inside(sdBox(lp - vec2(0.0, 0.03), vec2(0.07, 0.02))));
    c = mix(c, lin(vec3(0.1)), step(0.5, fract(lp.y / 0.006)) * inside(sdBox(lp + vec2(0.0, 0.02), vec2(0.05, 0.025))) * 0.6);
  }
  c *= 1.0 - 0.3 * smoothstep(0.15, 0.4, fbm(lp + id, 9.0, 3));
  over(s, a, 0.4 + cr * 1.4, c, 0.86, 0.0);
}
void can(inout Surf s, vec2 p, float id, vec3 la, vec3 lb) {
  vec2 lp = turn(p, id);
  float d = sdBox(lp, vec2(0.058, 0.028 + 0.004 * abs(lp.x) / 0.058)) - 0.006 + 0.003 * fbm(lp + id, 60.0, 2);
  float a = inside(d);
  if (a <= 0.0) return;
  float rim = smoothstep(0.047, 0.051, abs(lp.x));
  float fold = ridge(vec2(lp.x * 1.1, lp.y * 0.4) + id * 0.1, 26.0, 2);
  vec3 c = mix(la, lb, band(lp.y - 0.008 * sin(lp.x * 95.0 + id), 0.0045));
  c = mix(c, lin(vec3(0.62, 0.62, 0.6)), rim);
  c *= 0.8 + 0.3 * fold;
  float scuff = smoothstep(0.2, 0.4, fbm(lp + id * 0.3, 30.0, 3));
  c = mix(c, lin(vec3(0.55)), scuff * 0.5);
  over(s, a, 2.5 + fold * 2.0 * (1.0 - rim), c, 0.34 + 0.2 * fold, mix(0.55, 1.0, max(rim, scuff * 0.6)));
}
float butt(inout Surf s, vec2 p, float ang) {
  vec2 lp = rot2(p, ang);
  float d = sdSeg(lp, vec2(-0.0125, 0.0), vec2(0.0125, 0.0)) - 0.0042;
  float a = inside(d);
  if (a <= 0.0) return 0.0;
  vec3 c = mix(lin(vec3(0.88, 0.86, 0.82)), lin(vec3(0.8, 0.56, 0.27)) * (0.85 + 0.25 * hash12(floor(lp * 2500.0))), step(-0.001, lp.x));
  c = mix(c, lin(vec3(0.14, 0.12, 0.11)), smoothstep(-0.0105, -0.0135, lp.x));
  float u = lp.y / 0.0042;
  over(s, a, 0.6 + 3.2 * sqrt(sat(1.0 - u * u)), c, 0.8, 0.0);
  return a;
}
void crown(inout Surf s, vec2 p, float id) {
  float r = length(p), an = atan(p.y, p.x);
  float a = inside(r - 0.0135 - 0.0011 * cos(an * 21.0));
  if (a <= 0.0) return;
  bool gold = hash12(vec2(id, 2.0)) > 0.5;
  vec3 c = gold ? lin(vec3(0.7, 0.55, 0.2)) : lin(vec3(0.62, 0.1, 0.08));
  c = mix(c, lin(vec3(0.85, 0.82, 0.75)), inside(r - 0.006) * (gold ? 0.0 : 0.8));
  over(s, a, 1.5 + smoothstep(0.012, 0.0, r), c, 0.35, gold ? 0.9 : 0.5);
}
void item(inout Surf s, vec2 p, float idx) {
  float id = idx * 3.17 + 1.0;
  if (idx < 0.5) paper(s, p, id, 0.07, lin(vec3(0.8, 0.79, 0.74)), 0.0);
  else if (idx < 1.5) paper(s, p, id, 0.086, lin(vec3(0.72, 0.7, 0.64)), 1.0);
  else if (idx < 2.5) paper(s, p, id, 0.075, lin(vec3(0.55, 0.42, 0.28)), 0.0);
  else if (idx < 3.5) paper(s, p, id, 0.07, lin(vec3(0.84, 0.84, 0.8)), 2.0);
  else if (idx < 4.5) paper(s, p, id, 0.085, lin(vec3(0.82, 0.78, 0.66)), 3.0);
  else if (idx < 5.5) {
    vec2 lp = turn(p, id);
    float a = inside(sdBox(lp, vec2(0.031, 0.014))) * (1.0 - inside(length(lp - vec2(0.02, 0.004)) - 0.002));
    vec3 c = mix(lin(vec3(0.86, 0.74, 0.7)), lin(vec3(0.3, 0.2, 0.25)), step(0.5, fract(lp.y / 0.004)) * inside(sdBox(lp + vec2(0.006, 0.0), vec2(0.018, 0.009))) * 0.6);
    over(s, a, 0.3 + abs(lp.x) * 20.0, c, 0.8, 0.0);
  }
  else if (idx < 6.5) can(s, p, id, lin(vec3(0.62, 0.05, 0.04)), lin(vec3(0.9, 0.88, 0.84)));
  else if (idx < 7.5) can(s, p, id, lin(vec3(0.06, 0.16, 0.5)), lin(vec3(0.7, 0.72, 0.74)));
  else if (idx < 8.5) can(s, p, id, lin(vec3(0.1, 0.32, 0.12)), lin(vec3(0.78, 0.62, 0.22)));
  else if (idx < 9.5) butt(s, p, 0.6);
  else if (idx < 11.5) {
    float n = idx < 10.5 ? 3.0 : 5.0;
    if (idx > 10.5) over(s, inside(length(p) - 0.05 - 0.02 * fbm(p + 3.0, 20.0, 3)) * 0.35, 0.0, lin(vec3(0.3, 0.29, 0.28)), 0.95, 0.0);
    for (int i = 0; i < 5; i++) {
      if (float(i) >= n) break;
      vec2 o = (hash22(vec2(float(i), id)) - 0.5) * 0.11;
      butt(s, p - o, hash12(vec2(float(i), id + 2.0)) * 6.283);
    }
  }
  else if (idx < 12.5) { crown(s, p - vec2(0.03, 0.02), id); crown(s, p + vec2(0.035, 0.025), id + 1.0); }
  else if (idx < 13.5) {
    vec2 lp = turn(p, id);
    float ax = abs(lp.x);
    float hw = ax < 0.022 ? 0.011 : 0.004 + (ax - 0.022) * 0.45;
    float a = inside(max(abs(lp.y) - hw, ax - 0.042));
    float cr = ridge(lp * 1.5 + id, 40.0, 2);
    vec3 c = mix(lin(vec3(0.7, 0.08, 0.06)), lin(vec3(0.7, 0.7, 0.68)), step(0.022, ax));
    over(s, a, 0.5 + cr * 1.2, c * (0.75 + 0.4 * cr), 0.22, 0.85);
  }
  else if (idx < 14.5) {
    vec2 lp = turn(p, id);
    float a = inside(sdBox(lp, vec2(0.044, 0.026)) + 0.003 * fbm(lp + id, 50.0, 2));
    float cr = ridge(lp + id * 0.2, 20.0, 2);
    vec3 c = lp.x > 0.012 ? lin(vec3(0.66, 0.08, 0.06)) : lin(vec3(0.86, 0.84, 0.78));
    c = mix(c, lin(vec3(0.75, 0.6, 0.25)), inside(length(lp - vec2(-0.012, 0.0)) - 0.009) * 0.8);
    over(s, a, 3.0 + cr * 2.0, c * (0.8 + 0.3 * cr), 0.6, 0.0);
  }
  else {
    vec2 lp = turn(p, id);
    float a = inside(polyD(lp, id, 0.088) + 0.005 * fbm(lp + id, 40.0, 2));
    float cr = ridge(lp * 1.3 + id, 30.0, 3);
    over(s, a * 0.62, 0.3 + cr * 1.6, lin(vec3(0.85, 0.85, 0.83)) * (0.8 + 0.25 * cr), 0.32, 0.0);
  }
}
void swatch(inout Surf s, vec2 f, float idx) {
  vec3 c = lin(vec3(0.5)); float r = 0.6, m = 0.0, h = 0.0;
  if (idx < 2.5) {
    vec3 la = idx < 0.5 ? lin(vec3(0.62, 0.05, 0.04)) : idx < 1.5 ? lin(vec3(0.06, 0.16, 0.5)) : lin(vec3(0.1, 0.32, 0.12));
    vec3 lb = idx < 0.5 ? lin(vec3(0.9, 0.88, 0.84)) : idx < 1.5 ? lin(vec3(0.7, 0.72, 0.74)) : lin(vec3(0.78, 0.62, 0.22));
    float rim = 1.0 - step(0.1, f.y) * step(f.y, 0.9);
    c = mix(la, lb, band((f.y - 0.5 - 0.08 * sin(f.x * 12.566)) * 0.2, 0.009));
    c = mix(c, lin(vec3(0.66, 0.66, 0.64)), rim);
    r = 0.3; m = mix(0.6, 1.0, rim);
  } else if (idx < 3.5) { c = lin(vec3(0.66, 0.66, 0.64)) * (0.9 + 0.15 * (fbm(f, vec2(2.0, 60.0), 2) + 0.5)); r = 0.26; m = 1.0; }
  else if (idx < 6.5) {
    c = idx < 4.5 ? lin(vec3(0.05, 0.16, 0.06)) : idx < 5.5 ? lin(vec3(0.16, 0.07, 0.02)) : lin(vec3(0.3, 0.34, 0.32));
    c *= 0.9 + 0.2 * (fbm(f, 3.0, 3) + 0.5); r = 0.06; m = 0.0;
  } else if (idx < 7.5) {
    c = mix(lin(vec3(0.85, 0.8, 0.66)), lin(vec3(0.62, 0.1, 0.07)), step(0.55, f.y) * step(f.y, 0.8));
    c = mix(c, lin(vec3(0.15)), step(0.5, fract(f.y * 30.0)) * step(f.y, 0.45) * step(0.15, f.y) * step(0.2, f.x) * step(f.x, 0.8) * 0.6);
    r = 0.8;
  } else if (idx < 9.5) {
    float cr = ridge(f, 12.0, 3);
    c = (idx < 8.5 ? lin(vec3(0.72, 0.7, 0.64)) : lin(vec3(0.82, 0.81, 0.77))) * (0.85 + 0.2 * cr);
    if (idx < 8.5) c = mix(c, lin(vec3(0.2)), step(0.45, fract(f.y * 40.0)) * step(0.1, fract(f.x * 4.0)) * 0.6);
    r = 0.85; h = cr * 1.5;
  } else if (idx < 10.5) { c = f.y > 0.65 ? lin(vec3(0.66, 0.08, 0.06)) : lin(vec3(0.86, 0.84, 0.78)); r = 0.6; }
  else if (idx < 11.5) { c = lin(vec3(0.7, 0.55, 0.2)); r = 0.32; m = 0.9; }
  over(s, 1.0, h, c, r, m);
}
void surf(vec2 P, inout Surf s) {
  vec2 cell = floor(vUv * 4.0);
  float idx = cell.x + cell.y * 4.0;
  if (uKind < 0.5) item(s, P - ((cell + 0.5) / 4.0 - 0.5) * uSize, idx);
  else swatch(s, fract(vUv * 4.0), idx);
}`,
};

// The words cast into the covers, one row each, white on black and softened a touch so the
// raised letters get bevelled normals.
const WORDS = ['ACQUA', 'GAS', 'TELEFONI', 'IDRANTE'];
function letterSheet() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 512);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = '700 61px "Arial Black", "DejaVu Sans", Arial, sans-serif';
  WORDS.forEach((w, i) => g.fillText(w, 512, i * 64 + 54));
  g.filter = 'blur(1.2px)';
  g.drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

// The ground atlas: baked once, then every decal is a quad into it, merged into one mesh drawn
// over the streets (one draw call). Layers keep the painter's order inside that mesh.
export const LAYER = { wear: 0, repair: 1, crack: 2, stain: 3, iron: 4, leaves: 5, litter: 6 };

export class GroundAtlas {
  constructor(materials) {
    const P = materials.preset;
    this.W = P.textureSize >= 1024 ? 2048 : 1024;
    this.layers = Object.keys(LAYER).map(() => []);
    this.regions = {};
    for (const [name, fam, kind, x, y, w, h, mw] of REGIONS) {
      const r = { name, fam, kind, px: x, py: y, pw: w, ph: h, mw, mh: mw * h / w, u0: x / 2048, v0: y / 1024, du: w / 2048, dv: h / 1024 };
      this.regions[name] = r;
      if (SHEETS[name]) {
        for (let i = 0; i < 16; i++) {
          const cx = i % 4, cy = Math.floor(i / 4);
          this.regions[SHEETS[name] + i] = { u0: r.u0 + cx * r.du / 4, v0: r.v0 + cy * r.dv / 4, du: r.du / 4, dv: r.dv / 4, mw: mw / 4, mh: r.mh / 4 };
        }
      }
    }
    this.bake(materials.baker, P.anisotropy);
  }

  bake(baker, aniso) {
    const W = this.W, H = W / 2, sc = W / 2048;
    const target = (opts) => new THREE.WebGLRenderTarget(W, H, Object.assign({ depthBuffer: false, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true }, opts));
    const fields = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    const map = target({ colorSpace: THREE.SRGBColorSpace }), nrm = target({}), orm = target({});
    const text = letterSheet();
    const shaders = {};
    for (const fam in FAMILIES) {
      shaders[fam] = new THREE.ShaderMaterial({
        uniforms: {
          uSeed: { value: 3 }, uMode: { value: 0 }, uKind: { value: 0 }, uVar: { value: 0 }, uMmPx: { value: 1 },
          uSize: { value: new THREE.Vector2() }, uAtlas: { value: new THREE.Vector2(W, H) }, tF: { value: fields.texture }, tText: { value: text },
        },
        vertexShader: VERT, fragmentShader: NOISE + COMMON + FAMILIES[fam] + MAIN,
      });
    }
    // Region by region into the matching rectangle; mipmaps are built once, after the last one.
    const draw = (rt, mode) => {
      const list = REGIONS.map((r) => this.regions[r[0]]);
      list.forEach((r, i) => {
        rt.texture.generateMipmaps = rt !== fields && i === list.length - 1;
        const u = shaders[r.fam].uniforms;
        // never sample the target being drawn: the height pass gets a stand-in for tF
        u.tF.value = rt === fields ? text : fields.texture;
        u.uMode.value = mode; u.uKind.value = r.kind; u.uVar.value = i * 0.37 + 0.11;
        u.uSize.value.set(r.mw, r.mh); u.uMmPx.value = r.mw * 1000 / (r.pw * sc);
        rt.viewport.set(r.px * sc, r.py * sc, r.pw * sc, r.ph * sc);
        rt.scissor.copy(rt.viewport);
        rt.scissorTest = true;
        baker.run(shaders[r.fam], rt);
      });
      rt.scissorTest = false;
      rt.viewport.set(0, 0, W, H); rt.scissor.set(0, 0, W, H);
    };
    draw(fields, 0);
    const nm = new THREE.ShaderMaterial({ uniforms: { tF: { value: fields.texture }, uAtlas: { value: new THREE.Vector2(W, H) } }, vertexShader: VERT, fragmentShader: NORMAL });
    baker.run(nm, nrm);
    draw(map, 1);
    draw(orm, 2);
    nm.dispose();
    for (const k in shaders) shaders[k].dispose();
    fields.dispose();
    text.dispose();
    this.targets = [map, nrm, orm];
    for (const rt of this.targets) { rt.texture.anisotropy = Math.min(baker.maxAniso, aniso || 4); rt.texture.userData.rt = rt; }
    this.map = map.texture; this.normalMap = nrm.texture; this.ormMap = orm.texture;
    this.map.name = 'groundAtlas.map';
  }

  // A decal lying flat at (x, y, z), turned by yaw (texture up = -z at yaw 0); size defaults to the
  // region's. tint: [r, g, b, a] multiplier. flip mirrors it across.
  flat(name, x, y, z, yaw, w, h, layer, tint, flip) {
    const r = this.regions[name];
    if (!r) return;
    w = w || r.mw; h = h || r.mh;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ux = [c * w / 2, -s * w / 2], vz = [-s * h / 2, -c * h / 2];
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ux[0] * a + vz[0] * b, y, z + ux[1] * a + vz[1] * b]);
    this.quad(r, pts, [0, 1, 0], layer, tint, flip);
  }

  // A decal on a vertical face: m places the plane (x along it, y up, +z out of it).
  face(name, m, w, h, layer, tint) {
    const r = this.regions[name];
    if (!r) return;
    const v = new THREE.Vector3();
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => v.set(a * w / 2, b * h / 2, 0.002).applyMatrix4(m).toArray());
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m).toArray();
    this.quad(r, pts, n, layer, tint, false);
  }

  quad(r, pts, n, layer, tint, flip) {
    const t = tint || [1, 1, 1, 1];
    const u0 = flip ? r.u0 + r.du : r.u0, u1 = flip ? r.u0 : r.u0 + r.du;
    const uv = [[u0, r.v0], [u1, r.v0], [u1, r.v0 + r.dv], [u0, r.v0 + r.dv]];
    this.layers[layer].push({ pts, n, uv, t });
  }

  get count() { return this.layers.reduce((a, l) => a + l.length, 0); }

  build(scene) {
    const n = this.count;
    if (!n) return null;
    const pos = new Float32Array(n * 12), nrm = new Float32Array(n * 12), uv = new Float32Array(n * 8), col = new Float32Array(n * 16);
    const idx = new Uint32Array(n * 6);
    let q = 0;
    for (const layer of this.layers) {
      for (const d of layer) {
        for (let k = 0; k < 4; k++) {
          const o = q * 4 + k;
          pos.set(d.pts[k], o * 3); nrm.set(d.n, o * 3); uv.set(d.uv[k], o * 2); col.set(d.t, o * 4);
        }
        idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
        q++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      map: this.map, normalMap: this.normalMap, roughnessMap: this.ormMap, metalnessMap: this.ormMap, aoMap: this.ormMap,
      roughness: 1, metalness: 1, vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, name: 'groundDecals',
    });
    // the same weathering as the asphalt, so puddles and tone drift run straight across the decals
    enhance(mat, { weather: { grime: 0, moss: 0, streaks: 0, puddles: 1, tone: 0.8 }, box: true });
    mat.envMapIntensity = 0.42;
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = -1;     // before glass and the other transparent passes
    mesh.name = 'groundDecals';
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    this.mesh = mesh;
    return mesh;
  }
}

// --- placement ----------------------------------------------------------------------------------
// The streets: north (s = -1) and south (s = 1). d is the distance from the kerb face into the
// road; road paint mirrors the markings in oldtown.js.
const KERB_Z = 20, EDGE_Z = 13 + ROAD.edge;
const zAt = (s, d) => s * (KERB_Z - d);
const TRACKS = [1.15, 2.65, 4.4, 5.9];
const LEAF = 0.22;   // a single fallen leaf's decal (the leaf itself is about 17 cm)

function onPaint(x, z, r) {
  for (const zc of [-16.525, 16.525]) {
    if (Math.abs(z - zc) < 2.4 + r && x > -3.2 - r && x < 3.0 + r) return true;
    if (Math.abs(z - zc) < 0.075 + r) {
      const k = Math.floor((x + 48) / 4.5);
      for (const kk of [k - 1, k, k + 1]) {
        const x0 = -48 + kk * 4.5;
        if (kk >= 0 && x0 < 48 && x + r > x0 && x - r < x0 + 2.4) return true;
      }
    }
  }
  return false;
}

function layout(B, A, rnd, opts) {
  const ph = B.ph;
  const R = (a, b) => a + (b - a) * rnd();
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const TAU = Math.PI * 2;
  // anything standing proud of the ground (buildings, cars, props) rules a spot out
  const blocked = (x, z, r, top = 0.2) => {
    for (const b of ph.overlap(x - r, 0.02, z - r, x + r, 3, z + r)) if (b.max[1] > top) return true;
    return false;
  };
  const groundY = (x, z) => ph.groundHeight(x, z, 0.02, 0.3);
  const fountain = (x, z, r) => Math.hypot(x, z) < 4.5 + r;
  // the same kind of object, found from its collider: [mat, width, depth, top]
  const find = (mat, w, d, top, tol = 0.1) => ph.boxes.filter((b) => {
    const bw = b.max[0] - b.min[0], bd = b.max[2] - b.min[2];
    return b.mat === mat && Math.abs(b.max[1] - top) < tol && ((Math.abs(bw - w) < tol && Math.abs(bd - d) < tol) || (Math.abs(bw - d) < tol && Math.abs(bd - w) < tol));
  }).map((b) => ({ x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2, along: (b.max[0] - b.min[0]) > (b.max[2] - b.min[2]) ? 'x' : 'z', b }));
  const cars = find('metal', 4.2, 1.62, 0.92).concat(find('metal', 5.0, 1.96, 2.2));
  const buses = find('metal', 11.2, 2.5, 3.0);
  const dumpsters = find('metal', 1.9, 1.2, 1.28);
  const benches = find('wood', 1.8, 0.44, 0.5);
  const stalls = find('wood', 2.8, 1.2, 0.95);
  const trees = ph.boxes.filter((b) => b.mat === 'wood' && b.max[1] > 2.5 && Math.abs(b.max[0] - b.min[0] - 0.4) < 0.05 && Math.abs(b.max[2] - b.min[2] - 0.4) < 0.05)
    .map((b) => ({ x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2 }));
  const burnt = (opts.burnt || []).map(([x, z]) => ({ x, z }));
  const isBurnt = (c) => burnt.some((b) => Math.hypot(b.x - c.x, b.z - c.z) < 1);
  const covers = [];
  const clearOfCovers = (x, z, r) => covers.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + r);
  const leafTint = (autumn) => autumn ? [1, R(0.9, 1), R(0.8, 0.95), 1] : [R(0.85, 0.95), 1, R(0.7, 0.85), 1];
  const L = LAYER;

  for (const s of [-1, 1]) {
    const kerbYaw = s < 0 ? 0 : Math.PI;   // texture up points at the kerb
    // tyre wear down both lanes, in overlapping lengths that fade into each other
    for (const d of TRACKS) {
      for (let x = -51 + R(0, 2); x < 51; x += R(3.9, 4.4)) {
        const z = zAt(s, d + R(-0.06, 0.06));
        A.flat(pick(['tyre0', 'tyre1', 'tyre2']), x + 2.5, 0.003, z, R(-0.012, 0.012), 5.0, 0.62, L.wear, [1, 1, 1, R(0.65, 1)], rnd() < 0.5);
      }
    }
    // a braking skid or two
    for (let i = 0; i < 2; i++) {
      const x = R(-44, 44), d = pick(TRACKS);
      if (!onPaint(x, zAt(s, d), 2.6)) A.flat('skid', x, 0.003, zAt(s, d), R(-0.04, 0.04), R(3.5, 5), 0.62, L.wear, [1, 1, 1, R(0.6, 0.9)]);
    }
    // grime banked along the gutter, and along the foot of the walls on the sidewalk
    for (let x = -51.6; x < 51.6; x += R(3.3, 3.7)) A.flat(pick(['grime0', 'grime1', 'grime2']), x + 2, 0.003, zAt(s, 0.24), kerbYaw + R(-0.01, 0.01), 4.0, 0.5, L.wear, [1, 1, 1, R(0.7, 1)], rnd() < 0.5);
    for (const w of (B.walks || []).filter((w) => w.dir === -s)) {
      const zw = s < 0 ? w.z0 + 0.24 : w.z1 - 0.24;
      for (let x = w.x0; x < w.x1 - 1; x += R(3.3, 3.7)) A.flat(pick(['grime0', 'grime1', 'grime2']), Math.min(x + 2, w.x1 - 2), ROAD.walk + 0.003, zw, kerbYaw + R(-0.01, 0.01), 4.0, 0.5, L.wear, [1, 1, 1, R(0.45, 0.75)], rnd() < 0.5);
    }

    // cast-iron covers in the lanes, now and then with the trench dug to reach them
    let trenches = 0;
    for (let x = -46 + R(0, 4); x < 47; x += R(12, 17)) {
      const d = pick([1.9, 2.65, 4.4, 5.16]), z = zAt(s, d) + R(-0.2, 0.2);
      const k = rnd();
      const name = k < 0.4 ? 'manAcqua' : k < 0.75 ? 'manGas' : 'manTele';
      const r = A.regions[name].mw / 2;
      if (onPaint(x, z, r) || blocked(x, z, r) || !clearOfCovers(x, z, r)) continue;
      A.flat(name, x, 0.003, z, name === 'manTele' ? R(-0.05, 0.05) + (rnd() < 0.5 ? 0 : Math.PI) : R(0, TAU), 0, 0, L.iron);
      covers.push({ x, z, r });
      if (trenches < 2 && d > 4 && rnd() < 0.7) {
        const len = d - 0.25;
        A.flat('trench0', x + R(-0.05, 0.05), 0.003, zAt(s, (d + 0.25) / 2), Math.PI / 2 + R(-0.02, 0.02), 6.0 * len / 5.56, 1.5, L.repair, [1, 1, 1, 1], rnd() < 0.5);
        trenches++;
      }
    }
    // one water-main repair right across the street
    for (let tries = 0; tries < 8; tries++) {
      const x = R(-45, 45);
      if (Math.abs(x) < 6 || !clearOfCovers(x, zAt(s, 3.6), 1)) continue;
      A.flat('trench1', x, 0.003, zAt(s, 3.55), Math.PI / 2 + R(-0.03, 0.03) + (rnd() < 0.5 ? 0 : Math.PI), 6.9, 1.5, L.repair);
      break;
    }
    // patched holes and resurfaced squares
    for (let i = 0; i < 7; i++) {
      const name = i < 3 ? 'tarA' : i < 6 ? 'tarB' : 'patch';
      const sc = name === 'patch' ? R(0.65, 0.9) : R(0.55, 1.05);
      const reg = A.regions[name];
      const r = Math.max(reg.mw, reg.mh) * sc * 0.42;
      const x = R(-48, 48), z = zAt(s, R(0.7 + r * 0.6, 6.4 - r * 0.6));
      if (onPaint(x, z, r) || !clearOfCovers(x, z, r)) continue;
      const yaw = name === 'tarB' ? R(0, TAU) : R(-0.05, 0.05) + (rnd() < 0.3 ? Math.PI / 2 : 0);
      A.flat(name, x, 0.003, z, yaw, reg.mw * sc, reg.mh * sc, L.repair, [1, 1, 1, 1], rnd() < 0.5);
    }
    // sealed cracks: along the lanes, beside the centre line and across
    for (let i = 0; i < 13; i++) {
      const kind = i % 3;
      const len = R(1.8, 3.2), x = R(-49, 49);
      let d, yaw;
      if (kind === 0) { d = pick([R(0.8, 3.0), 3.25, 3.75, R(4.0, 6.3)]); yaw = R(-0.06, 0.06); } else if (kind === 1) { d = R(1.6, 5.2); yaw = Math.PI / 2 + R(-0.15, 0.15); } else { d = R(1.2, 5.6); yaw = R(0, Math.PI); }
      const z = zAt(s, d);
      const reach = kind === 0 ? 0.2 : len / 2;
      if ((kind === 0 ? onPaint(x, z, 0.12) : onPaint(x, z, reach) && Math.abs(x) < 6) || !clearOfCovers(x, z, 0.3)) continue;
      A.flat(pick(['crack0', 'crack1', 'crack2', 'crack3']), x, 0.003, z, yaw, len, 0.4, L.crack, [1, 1, 1, 1], rnd() < 0.5);
    }
    // oil dripped in the lanes
    for (let i = 0; i < 6; i++) {
      const x = R(-49, 49), z = zAt(s, pick([R(0.9, 1.6), 1.9, 5.16, R(2.2, 5.6)]));
      if (onPaint(x, z, 0.5)) continue;
      if (rnd() < 0.5) A.flat('oilB', x, 0.003, z, (rnd() < 0.5 ? 0 : Math.PI) + R(-0.2, 0.2), 0, 0, L.stain, [1, 1, 1, R(0.6, 0.9)]);
      else A.flat('oilA', x, 0.003, z, R(0, TAU), 1.2 * R(0.4, 0.75), 1.2 * R(0.4, 0.75), L.stain, [1, 1, 1, R(0.55, 0.85)]);
    }
    // drain grates in the gutter, each with its inlet in the kerb behind
    for (let x = -45 + (s > 0 ? 6 : 0) + R(-1, 1); x < 47; x += R(12, 15)) {
      const z = zAt(s, 0.2);
      A.flat(rnd() < 0.7 ? 'grateA' : 'grateB', x, 0.003, z, kerbYaw, 0, 0, L.iron);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0.066, s * KERB_Z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s < 0 ? 0 : Math.PI), new THREE.Vector3(1, 1, 1));
      A.face('inlet', m, 1.0, 0.125, L.iron);
      // leaves washed up against the grate
      if (rnd() < 0.6) A.flat('leavesSparse', x + R(-0.7, 0.7), 0.005, zAt(s, R(0.25, 0.45)), R(0, TAU), 0.9, 0.9, L.leaves, leafTint(s > 0));
    }
    // leaves and litter in the gutter
    for (let x = -51; x < 51; x += R(2.5, 6)) {
      const z = zAt(s, R(0.1, 0.38));
      if (rnd() < 0.45) A.flat(rnd() < 0.4 ? 'leavesDense' : 'leavesSparse', x, 0.005, zAt(s, R(0.2, 0.5)), R(0, TAU), R(0.7, 1.1), 0, L.leaves, leafTint(s > 0));
      const n = 1 + Math.floor(rnd() * 2.5);
      for (let i = 0; i < n; i++) A.flat('litter' + Math.floor(rnd() * 16), x + R(-1, 1), onPaint(x, z, 0.2) ? 0.014 : 0.006, z + R(-0.08, 0.08), R(0, TAU), R(0.85, 1.15) * 0.2, 0, L.litter);
      if (rnd() < 0.3) A.flat('leaf' + Math.floor(rnd() * 16), x + R(-1.5, 1.5), 0.006, zAt(s, R(0.3, 1.2)), R(0, TAU), R(0.8, 1.2) * LEAF, 0, L.leaves, leafTint(s > 0));
    }
    // leaves blown against the edging of the square
    for (let x = -50; x < 50; x += R(3, 7)) {
      const near = trees.some((t) => Math.abs(t.x - x) < 9 && Math.abs(t.z - s * 10) < 1);
      if (rnd() > (near ? 0.85 : 0.3)) continue;
      const z = s * (EDGE_Z + R(0.05, 0.5));
      if (onPaint(x, z, 0.5) || blocked(x, z, 0.4, 0.5)) continue;
      A.flat(near && rnd() < 0.6 ? 'leavesDense' : 'leavesSparse', x, onPaint(x, z, 0.6) ? 0.014 : 0.004, z, R(0, TAU), R(0.8, 1.2), 0, L.leaves, leafTint(s > 0));
    }
    // sidewalks: litter, gum, small covers; cigarette ends where people wait by doors
    for (const w of (B.walks || []).filter((w) => w.dir === -s)) {
      const za = s < 0 ? w.z0 + 0.35 : w.z0 + ROAD.kerb + 0.1, zb = s < 0 ? w.z1 - ROAD.kerb - 0.1 : w.z1 - 0.35;
      const y = ROAD.walk + 0.004;
      for (let x = w.x0 + 0.5; x < w.x1 - 0.5; x += R(1.2, 3.5)) {
        const z = R(za, zb);
        if (blocked(x, z, 0.12, 0.2)) continue;
        A.flat('litter' + pick([0, 1, 2, 3, 4, 5, 6, 7, 9, 9, 10, 11, 12, 13, 14, 15]), x, y, z, R(0, TAU), R(0.85, 1.15) * 0.2, 0, L.litter);
      }
      for (let x = w.x0 + 1; x < w.x1 - 1; x += R(5, 11)) {
        const z = R(za + 0.3, zb - 0.3);
        if (!blocked(x, z, 0.5, 0.2)) A.flat('gum', x, y, z, R(0, TAU), R(0.7, 1), 0, L.stain, [1, 1, 1, R(0.6, 1)]);
      }
      for (let x = w.x0 + 2; x < w.x1 - 2; x += R(9, 16)) {
        const name = pick(['valveGas', 'valveRound', 'valveRound', 'hydrant', 'bolt']);
        const z = R(za + 0.2, zb - 0.2);
        if (!blocked(x, z, 0.2, 0.2)) A.flat(name, x, y, z, name === 'valveRound' || name === 'bolt' ? R(0, TAU) : kerbYaw + R(-0.05, 0.05), 0, 0, L.iron);
      }
    }
  }

  // oil under the parked cars, soot and glass round the burnt-out ones
  for (const c of cars) {
    const ax = c.along === 'x';
    if (isBurnt(c)) {
      A.flat('soot', c.x + R(-0.2, 0.2), groundY(c.x, c.z) + 0.003, c.z + R(-0.2, 0.2), (ax ? 0 : Math.PI / 2) + R(-0.1, 0.1), 3.4 * R(1, 1.15), 0, L.stain);
      for (let i = 0; i < 3; i++) {
        const a = R(0, TAU), r = R(1.4, 2.6);
        const x = c.x + Math.cos(a) * r * (ax ? 1.4 : 0.8), z = c.z + Math.sin(a) * r * (ax ? 0.8 : 1.4);
        if (!blocked(x, z, 0.2, 0.3)) A.flat('glass', x, groundY(x, z) + 0.006, z, R(0, TAU), R(0.6, 1), 0, L.litter);
      }
      continue;
    }
    const end = rnd() < 0.5 ? -1 : 1;
    const x = c.x + (ax ? end * R(0.8, 1.3) : 0), z = c.z + (ax ? 0 : end * R(0.8, 1.3));
    A.flat('oilA', x, groundY(x, z) + 0.003, z, R(0, TAU), 1.2 * R(0.6, 1), 1.2 * R(0.6, 1), L.stain, [1, 1, 1, R(0.7, 1)]);
    if (rnd() < 0.5) A.flat('oilB', c.x, groundY(c.x, c.z) + 0.003, c.z, (ax ? 0 : Math.PI / 2) + R(-0.3, 0.3), 0, 0, L.stain, [1, 1, 1, 0.7]);
  }
  // glass round the wrecked buses
  for (const b of buses) {
    for (let i = 0; i < 6; i++) {
      const x = b.x + R(-6.5, 6.5), z = b.z + (rnd() < 0.5 ? -1 : 1) * R(1.4, 2.4);
      if (!blocked(x, z, 0.3, 0.3) && !fountain(x, z, 0.5)) A.flat('glass', x, groundY(x, z) + 0.006, z, R(0, TAU), R(0.6, 1.1), 0, L.litter);
    }
  }
  // fallen leaves under every tree, drifting downwind (towards +x)
  for (const t of trees) {
    const y0 = groundY(t.x + 1.2, t.z);
    const autumn = t.z > 0;
    // somewhere round the tree whose whole footprint (half-size h) lies on the same level
    const spot = (rMin, rMax, h) => {
      for (let k = 0; k < 6; k++) {
        const a = R(0, TAU), r = R(rMin, rMax);
        const x = t.x + Math.cos(a) * r + r * 0.35, z = t.z + Math.sin(a) * r;
        if (Math.abs(x - t.x) < 0.95 && Math.abs(z - t.z) < 0.95) continue;
        if (blocked(x, z, 0.3, 0.5) || fountain(x, z, 0.4)) continue;
        if ([[0, 0], [-h, -h], [h, -h], [h, h], [-h, h]].some(([dx, dz]) => Math.abs(groundY(x + dx, z + dz) - y0) > 0.01)) continue;
        return [x, z];
      }
      return null;
    };
    for (let i = 0; i < 4; i++) { const p = spot(1.0, 2.6, 0.7); if (p) A.flat('leavesDense', p[0], y0 + 0.004, p[1], R(0, TAU), R(0.9, 1.3), 0, L.leaves, leafTint(autumn)); }
    for (let i = 0; i < 7; i++) { const p = spot(1.2, 4.5, 0.75); if (p) A.flat('leavesSparse', p[0], y0 + 0.004, p[1], R(0, TAU), R(0.9, 1.4), 0, L.leaves, leafTint(autumn)); }
    for (let i = 0; i < 30; i++) { const p = spot(1.0, 6.5, 0.15); if (p) A.flat('leaf' + Math.floor(rnd() * 16), p[0], y0 + 0.005, p[1], R(0, TAU), R(0.8, 1.25) * LEAF, 0, L.leaves, leafTint(autumn)); }
  }
  // the square: wind-blown leaves, and litter round the benches, stalls and fountain
  for (let i = 0; i < 70; i++) {
    const x = R(-50, 50), z = R(-12.6, 12.6);
    if (blocked(x, z, 0.1, 0.3) || fountain(x, z, 0.1)) continue;
    A.flat('leaf' + Math.floor(rnd() * 16), x, 0.004, z, R(0, TAU), R(0.8, 1.2) * LEAF, 0, L.leaves, leafTint(rnd() < 0.5));
  }
  const around = (list, n, reach) => {
    for (const o of list) {
      for (let i = 0; i < n; i++) {
        const a = R(0, TAU), r = R(reach * 0.6, reach);
        const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
        if (blocked(x, z, 0.1, 0.3) || fountain(x, z, 0.05)) continue;
        A.flat('litter' + Math.floor(rnd() * 16), x, groundY(x, z) + 0.005, z, R(0, TAU), R(0.85, 1.15) * 0.2, 0, L.litter);
      }
    }
  };
  around(benches, 5, 1.3);
  around(stalls, 6, 2.0);
  around(dumpsters, 8, 1.6);
  for (let i = 0; i < 14; i++) {
    const a = R(0, TAU), r = R(4.4, 5.4);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!blocked(x, z, 0.1, 0.3)) A.flat(rnd() < 0.5 ? 'litter' + Math.floor(rnd() * 16) : 'leaf' + Math.floor(rnd() * 16), x, 0.005, z, R(0, TAU), R(0.85, 1.15) * 0.18, 0, L.litter, leafTint(true));
  }
  for (const d of dumpsters) {
    const x = d.x + R(-0.8, 0.8), z = d.z + (rnd() < 0.5 ? -1 : 1) * R(0.8, 1.1);
    A.flat(rnd() < 0.5 ? 'oilA' : 'oilB', x, groundY(x, z) + 0.003, z, R(0, TAU), 0.8, 0.8, L.stain, [0.9, 0.85, 0.7, 0.6]);
  }
  // the back yards and side streets: a light scatter of both
  for (let i = 0; i < 60; i++) {
    const x = R(-51, 51), z = (rnd() < 0.5 ? -1 : 1) * R(22.5, 41.5);
    if (blocked(x, z, 0.15, 0.3)) continue;
    const y = groundY(x, z) + 0.005;
    if (rnd() < 0.5) A.flat('leaf' + Math.floor(rnd() * 16), x, y, z, R(0, TAU), R(0.8, 1.2) * LEAF, 0, L.leaves, leafTint(rnd() < 0.5));
    else A.flat('litter' + Math.floor(rnd() * 16), x, y, z, R(0, TAU), R(0.85, 1.15) * 0.2, 0, L.litter);
  }
  return { cars, benches, stalls, dumpsters, trees, blocked, groundY, fountain };
}

// --- 3D litter ----------------------------------------------------------------------------------
// Cans, bottles, paper balls and a crushed packet, mapped onto the atlas swatches so they share
// one material and one draw call.
function onSwatch(A, g, pickCell) {
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const r = A.regions['swatch' + pickCell(n.getX(i), n.getY(i), n.getZ(i))];
    uv.setXY(i, r.u0 + (0.08 + 0.84 * uv.getX(i)) * r.du, r.v0 + (0.08 + 0.84 * uv.getY(i)) * r.dv);
  }
  return g;
}

// position-seeded wobble, so seam vertices on the same spot move together
const wob = (x, y, z, k) => Math.sin(x * 431.1 + y * 217.3 + z * 391.7 + k) * 0.5 + Math.sin(x * 97.3 - y * 311.9 + z * 173.1 + k * 2.1) * 0.5;

function canGeo(A, label, crushed) {
  const g = new THREE.CylinderGeometry(0.033, 0.033, 0.122, 12, crushed ? 3 : 1);
  if (crushed) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 - Math.abs(y) / 0.061;
      p.setXYZ(i, x * (1.25 + 0.25 * k), y * 0.62 + wob(x, y, z, 1) * 0.004, z * (0.45 - 0.15 * k) + wob(x, y, z, 2) * 0.004);
    }
    g.computeVertexNormals();
  }
  return onSwatch(A, g, (nx, ny) => (Math.abs(ny) > 0.7 ? 3 : label));
}

function bottleGeo(A, glass) {
  const prof = [[0.0, 0.0], [0.03, 0.0], [0.033, 0.006], [0.033, 0.16], [0.03, 0.19], [0.016, 0.225], [0.013, 0.27], [0.015, 0.276], [0.012, 0.282], [0.0, 0.282]];
  const body = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 10);
  onSwatch(A, body, () => glass);
  const label = new THREE.CylinderGeometry(0.0335, 0.0335, 0.07, 10, 1, true).translate(0, 0.095, 0);
  onSwatch(A, label, () => 7);
  return [body, label];
}

function paperBall(A, newsprint) {
  const g = new THREE.IcosahedronGeometry(0.03, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    v.multiplyScalar(1 + wob(v.x, v.y, v.z, 3) * 0.28);
    p.setXYZ(i, v.x, v.y * 0.85, v.z);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + p.getX(i) * 8, 0.5 + p.getY(i) * 8);
  return onSwatch(A, g, () => (newsprint ? 8 : 9));
}

function packGeo(A) {
  const g = new THREE.BoxGeometry(0.088, 0.02, 0.054, 3, 1, 2).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x, y * 0.55 + wob(x, y, z, 4) * 0.004, z + wob(x, y, z, 5) * 0.003);
  }
  g.computeVertexNormals();
  return onSwatch(A, g, () => 10);
}

function litter3D(B, A, rnd, spots) {
  const mat = new THREE.MeshStandardMaterial({ map: A.map, normalMap: A.normalMap, roughnessMap: A.ormMap, metalnessMap: A.ormMap, roughness: 1, metalness: 1, name: 'litter' });
  enhance(mat, { box: true });
  mat.envMapIntensity = 0.9;
  const R = (a, b) => a + (b - a) * rnd();
  const TAU = Math.PI * 2;
  const put = (geos, x, y, z, q) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    for (const g of geos) { g.applyMatrix4(m); B.geo(mat, g); }
  };
  const lying = (roll) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, R(0, TAU), Math.PI / 2 + roll, 'YXZ'));
  const place = (x, z) => {
    const y = spots.groundY(x, z);
    const k = rnd();
    if (k < 0.45) {
      const crushed = rnd() < 0.55;
      const g = canGeo(A, Math.floor(rnd() * 3), crushed);
      if (crushed) put([g], x, y + 0.012, z, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, R(0, TAU), R(-0.15, 0.15), 'YXZ')));
      else if (rnd() < 0.2) put([g], x, y + 0.061, z, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R(0, TAU)));
      else put([g], x, y + 0.033, z, lying(R(-0.05, 0.05)));
    } else if (k < 0.7) {
      const parts = bottleGeo(A, 4 + Math.floor(rnd() * 3));
      for (const g of parts) g.translate(0, -0.14, 0);
      put(parts, x, y + 0.033, z, lying(R(-0.03, 0.03)));
    } else if (k < 0.92) {
      put([paperBall(A, rnd() < 0.6)], x, y + 0.022, z, new THREE.Quaternion().setFromEuler(new THREE.Euler(R(0, TAU), R(0, TAU), R(0, TAU))));
    } else {
      put([packGeo(A)], x, y + 0.006, z, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R(0, TAU)));
    }
  };
  const tryPlace = (x, z) => { if (!spots.blocked(x, z, 0.2, 0.15) && !spots.fountain(x, z, 0.2)) place(x, z); };
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) tryPlace(R(-50, 50), zAt(s, R(0.08, 0.32)));
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) tryPlace(R(-50, 50), s * R(20.5, 21.6));
  for (const o of spots.benches.concat(spots.stalls)) if (rnd() < 0.6) { const a = R(0, TAU); tryPlace(o.x + Math.cos(a) * R(1, 1.8), o.z + Math.sin(a) * R(0.8, 1.5)); }
  for (const o of spots.dumpsters) for (let i = 0; i < 2; i++) { const a = R(0, TAU); tryPlace(o.x + Math.cos(a) * R(1.2, 1.8), o.z + Math.sin(a) * R(0.9, 1.4)); }
  for (let i = 0; i < 5; i++) tryPlace(R(-45, 45), R(-12, 12));
}

// Everything above, for the map builder: call once the props and vehicles are in, then build(scene)
// once the world has been merged. opts.burnt: [x, z] of the burnt-out cars.
export function roadDetail(B, materials, opts = {}) {
  const rnd = mulberry(opts.seed || 1913);
  granite(B, graniteMaterial(materials), rnd);
  const A = new GroundAtlas(materials);
  const spots = layout(B, A, rnd, opts);
  litter3D(B, A, rnd, spots);
  return { atlas: A, build: (scene) => A.build(scene) };
}
