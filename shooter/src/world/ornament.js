// Stonework for the old town: profiled cornices with modillions and dentils, string courses,
// carved window surrounds with ears, keystones and corbelled sills, pediments, rusticated
// bases, quoins, stone door frames with steps, and clay-tile roofs with eaves and gutters.
//
// Pieces are built in face space (x along the face, y up, z out of the wall) with real bevels,
// so every arris catches the low sun, then placed with a face matrix (see faceMatrix()).
import * as THREE from 'three';
import { worldUV } from '../core/geometry.js';
import { outline, sector, side, along, plate } from '../core/shapes.js';

// --- profile helpers ([depth, height] points) ---------------------------------------------------
function arc(cx, cy, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * (i / n); out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); }
  return out;
}
// Cyma recta (ogee) from p0 up and out to p1: concave below, convex above.
function ogee(p0, p1, n = 6) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    out.push([p0[0] + (p1[0] - p0[0]) * s, p0[1] + (p1[1] - p0[1]) * t]);
  }
  return out;
}
const cleaned = (pts) => pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-5);

// The main cornice: fillet, cove, soffit with a drip, corona, ogee, top fillet.
export const CORNICE = cleaned([
  [-0.03, 0], [0.045, 0], [0.045, 0.03],
  ...arc(0.14, 0.03, 0.085, Math.PI, Math.PI / 2, 6),
  [0.165, 0.115], [0.165, 0.13], [0.43, 0.148], [0.43, 0.165], [0.442, 0.165], [0.442, 0.33], [0.428, 0.338],
  ...ogee([0.428, 0.338], [0.49, 0.448]),
  [0.496, 0.452], [0.496, 0.5], [-0.03, 0.5],
]);
// String course: fillet, half-round bead, cap.
export const STRING = cleaned([[-0.03, 0], [0.055, 0], [0.055, 0.02], ...arc(0.055, 0.058, 0.038, -Math.PI / 2, Math.PI / 2, 6), [0.072, 0.11], [0.072, 0.15], [-0.03, 0.15]]);
// Small cap cornice above windows and doors.
export const CAP = cleaned([[-0.03, 0], [0.04, 0], [0.04, 0.02], ...arc(0.1, 0.02, 0.06, Math.PI, Math.PI / 2, 4), [0.115, 0.08], [0.115, 0.12], [0.1, 0.13], [-0.03, 0.13]]);
// Plinth cap above the rusticated base.
export const PLINTH = cleaned([[-0.03, 0], [0.085, 0], [0.085, 0.035], [0.065, 0.055], ...arc(0.085, 0.11, 0.055, -Math.PI / 2 - 0.4, -Math.PI, 4), [0.03, 0.11], [-0.03, 0.11]]);

// --- placing ---------------------------------------------------------------------------------------
function place(B, mat, g, m, shadow = true) {
  g.applyMatrix4(m);
  worldUV(g);
  B.geo(mat, g, shadow);
}

// A profile run along local x over [x0, x1] at height y (profile [depth, height]).
function run(profile, x0, x1, y, bevel = 0.003) {
  const g = side(outline(profile), Math.abs(x1 - x0), bevel, { curve: 4 });
  g.translate((x0 + x1) / 2, y, 0);
  return g;
}

// A bevelled block in face space: x0..x1 along the face, y0..y1, z0..z1 out of the wall.
function block(x0, x1, y0, y1, z0, z1, bevel = 0.012) {
  const b = Math.min(bevel, (x1 - x0) / 3, (y1 - y0) / 3, (z1 - z0) / 3);
  const g = along(outline([[x0 + b, y0 + b], [x1 - b, y0 + b], [x1 - b, y1 - b], [x0 + b, y1 - b]]), z0, z1, b, { bevelSegments: 1, flat: true });
  return g;
}

// --- facade pieces ----------------------------------------------------------------------------------
// Main cornice with modillions and a dentil band, along a face of length L centred on the matrix.
export function cornice(B, mat, m, L, y) {
  const parts = [run(CORNICE, -L / 2, L / 2, y)];
  // returns at the ends so the cornice doesn't stop as a bare cut
  const n = Math.floor((L - 0.4) / 0.56);
  const sp = (L - 0.4) / Math.max(1, n);
  for (let i = 0; i <= n; i++) {
    const x = -L / 2 + 0.2 + i * sp;
    const g = side(outline([[0.16, 0.13], [0.42, 0.147], [0.418, 0.118, 0.02], [0.33, 0.1, 0.03], [0.22, 0.072, 0.03], [0.16, 0.066]]), 0.085, 0.006, { curve: 2, bevelSegments: 1 });
    g.translate(x, y, 0);
    parts.push(g);
  }
  for (let x = -L / 2 + 0.06; x < L / 2 - 0.06; x += 0.1) parts.push(new THREE.BoxGeometry(0.055, 0.045, 0.06).translate(x + 0.0275, y + 0.054, 0.055));
  for (const g of parts) place(B, mat, g, m);
}

export function stringCourse(B, mat, m, L, y) { place(B, mat, run(STRING, -L / 2, L / 2, y), m); }
export function plinthCap(B, mat, m, L, y) { place(B, mat, run(PLINTH, -L / 2, L / 2, y), m); }

// Rusticated base: stone blocks with deep chamfered joints, two courses up to height h.
export function rusticate(B, mat, m, L, h, rnd, gaps = []) {
  const rows = h > 0.6 ? 2 : 1, rh = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = -L / 2 + (r % 2 ? 0.35 : 0);
    while (x < L / 2) {
      const w = 0.62 + rnd() * 0.32;
      const x1 = Math.min(L / 2, x + w);
      const x0 = Math.max(-L / 2, x);
      const blocked = gaps.some(([a, b]) => x1 > a && x0 < b);
      if (!blocked && x1 - x0 > 0.12) place(B, mat, block(x0 + 0.008, x1 - 0.008, r * rh + 0.008, (r + 1) * rh - 0.008, -0.03, 0.045 + rnd() * 0.01, 0.018), m);
      x = x1;
    }
  }
}

// Quoins up one corner: alternating long and short blocks. `dir` is +1 when the face runs from
// the corner towards +x in face space (the blocks extend that way).
export function quoins(B, mat, m, y0, y1, dir) {
  const ch = 0.36;
  for (let y = y0, i = 0; y + 0.2 < y1; y += ch, i++) {
    const w = i % 2 ? 0.34 : 0.58;
    const a = dir > 0 ? 0 : -w, b = dir > 0 ? w : 0;
    place(B, mat, block(a + 0.006, b - 0.006, y + 0.006, Math.min(y1, y + ch) - 0.006, -0.03, 0.04, 0.014), m);
  }
}

// Window surround (instanced through the window kit): moulded architrave with ears, a keystone,
// a corbelled sill and, on the piano nobile, a pediment. Built once per opening size.
const SURROUNDS = {};
export function surroundGeo(w, h, style) {
  const k = [w, h, style].join(':');
  if (SURROUNDS[k]) return SURROUNDS[k];
  const bw = 0.135;
  const prof = [[0, -0.03], [0, 0.02], [0.012, 0.032], [0.022, 0.032], [0.03, 0.042], [0.105, 0.046], [0.12, 0.034], [0.135, 0.03], [0.135, -0.03]];
  const parts = [];
  // jambs (cross-section seen from above: [x, z]), head ([z, y] run along x)
  for (const sx of [-1, 1]) {
    const g = plate(outline(prof.map(([u, d]) => [sx * (w / 2 + u), d])), h + bw + 0.06, 0.003, { curve: 2, bevelSegments: 1 });
    g.translate(0, (h + bw - 0.06) / 2, 0);
    parts.push(g);
  }
  const head = side(outline(prof.map(([u, d]) => [d, h + u])), w + bw * 2, 0.003, { curve: 2, bevelSegments: 1 });
  parts.push(head);
  // ears where the head overruns the jambs
  for (const sx of [-1, 1]) parts.push(block(sx > 0 ? w / 2 + bw - 0.01 : -w / 2 - bw - 0.055, sx > 0 ? w / 2 + bw + 0.055 : -w / 2 - bw + 0.01, h + bw - 0.15, h + bw, -0.03, 0.046, 0.008));
  // keystone
  parts.push(along(outline([[-0.07, h - 0.03], [0.07, h - 0.03], [0.095, h + bw + 0.07, 0.006], [-0.095, h + bw + 0.07, 0.006]]), -0.03, 0.075, 0.01, { bevelSegments: 1, flat: true }));
  // sill on two corbels
  parts.push(side(outline([[-0.03, -0.085], [0.088, -0.085], [0.104, -0.068], [0.104, -0.018], [0.092, 0], [-0.03, 0]]), w + 0.36, 0.006, { curve: 2, bevelSegments: 1 }));
  for (const sx of [-1, 1]) {
    const c = side(outline([[-0.03, -0.085], [0.08, -0.085], [0.074, -0.12, 0.02], [0.035, -0.19, 0.035], [-0.03, -0.205]]), 0.085, 0.006, { curve: 2, bevelSegments: 1 });
    c.translate(sx * (w / 2 + 0.1), 0, 0);
    parts.push(c);
  }
  if (style === 'pediment') {
    const y = h + bw;
    const cap = side(outline(CAP), w + bw * 2 + 0.18, 0.003, { curve: 2, bevelSegments: 1 }); cap.translate(0, y, 0); parts.push(cap);
    const hw = w / 2 + bw + 0.09, peak = 0.38, th = Math.atan2(peak, hw), len = Math.hypot(hw, peak);
    for (const sx of [-1, 1]) {
      const r = side(outline(CAP.map(([d, yy]) => [d, yy * 0.85])), len + 0.06, 0.003, { curve: 2, bevelSegments: 1 });
      r.rotateZ(sx * -th);
      r.translate(sx * hw / 2, y + 0.11 + peak / 2 - 0.02, 0);
      parts.push(r);
    }
    parts.push(along(outline([[-hw + 0.08, y + 0.12], [hw - 0.08, y + 0.12], [0, y + 0.12 + peak - 0.05]]), -0.03, 0.018, 0, { flat: true }));
  } else if (style === 'cap') {
    const cap = side(outline(CAP), w + bw * 2 + 0.12, 0.003, { curve: 2, bevelSegments: 1 }); cap.translate(0, h + bw, 0); parts.push(cap);
  }
  const g = mergeAll(parts);
  worldUV(g);
  SURROUNDS[k] = g;
  return g;
}

// Stone door frame: banded jambs, a keystone over a flat arch, a cap cornice and two steps.
export function doorFrame(B, mat, m, w, h) {
  const parts = [];
  for (const sx of [-1, 1]) {
    for (let y = 0, i = 0; y < h; y += 0.42, i++) {
      const ww = i % 2 ? 0.2 : 0.3;
      const a = sx > 0 ? w / 2 : -w / 2 - ww, b = sx > 0 ? w / 2 + ww : -w / 2;
      parts.push(block(a + 0.005, b - 0.005, y + 0.005, Math.min(h, y + 0.42) - 0.005, -0.03, 0.06, 0.014));
    }
  }
  // flat arch of voussoirs fanning from the keystone
  const n = 7;
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 - 0.08 + (w + 0.16) * (i / n), x1 = -w / 2 - 0.08 + (w + 0.16) * ((i + 1) / n);
    const key = i === (n - 1) / 2;
    parts.push(along(outline([[x0 + 0.006, h], [x1 - 0.006, h], [x1 + (x1 * 0.08), h + (key ? 0.42 : 0.34)], [x0 + (x0 * 0.08), h + (key ? 0.42 : 0.34)]]), -0.03, key ? 0.09 : 0.06, 0.008, { bevelSegments: 1, flat: true }));
  }
  const cap = side(outline(CAP), w + 0.9, 0.003, { curve: 2, bevelSegments: 1 }); cap.translate(0, h + 0.42, 0); parts.push(cap);
  for (let s = 0; s < 2; s++) parts.push(block(-w / 2 - 0.28 + s * 0.1, w / 2 + 0.28 - s * 0.1, s * 0.12, (s + 1) * 0.12, -0.05, 0.36 - s * 0.16, 0.012));
  for (const g of parts) place(B, mat, g, m);
}

// --- clay-tile roof ---------------------------------------------------------------------------------
// A gable roof over the rectangle x0..x1, z0..z1 at height `top`; the ridge runs along the longer
// side. The eave courses are real barrel-tile waves (what you see from the street); the field
// above is a tiled slope. Ridge tiles, rafter tails, fascia, half-round gutters, gable walls.
export function tileRoof(B, s, top, wallMat, opts = {}) {
  const alongZ = s.z1 - s.z0 > s.x1 - s.x0;
  const lenA = alongZ ? s.z1 - s.z0 : s.x1 - s.x0, span = alongZ ? s.x1 - s.x0 : s.z1 - s.z0;
  const pitch = opts.pitch || 0.42, over = 0.42;
  const half = span / 2, rise = Math.tan(pitch) * half, ridgeY = top + rise;
  const L = lenA + 0.24, slopeLen = (half + over) / Math.cos(pitch);
  // everything is built about the roof's centre with the ridge along x, then turned into place
  const T = new THREE.Matrix4().makeTranslation((s.x0 + s.x1) / 2, 0, (s.z0 + s.z1) / 2);
  if (alongZ) T.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  const tile = 'roofTiles';
  // world UVs run u along x; on a roof whose ridge runs along z the tile texture turns with it
  const put = (mat, g) => {
    g.applyMatrix4(T);
    worldUV(g);
    if (alongZ && mat === tile) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i); uv.setX(i, uv.getY(i)); uv.setY(i, u); } }
    B.geo(mat, g);
  };
  // the modelled eave tiles keep step with the texture's tiles (same 0.21 m pitch and phase)
  const P = 0.21, A = 0.05, phase = alongZ ? -(s.z0 + s.z1) / 2 : (s.x0 + s.x1) / 2;
  const wave = [[-L / 2, -0.03]];
  for (let x = -L / 2; x <= L / 2 + 1e-6; x += P / 8) wave.push([x, A * Math.abs(Math.sin(Math.PI * ((x + phase) / P))) ** 0.75]);
  wave.push([L / 2, -0.03]);
  const waveShape = outline(wave);
  for (const sd of [-1, 1]) {
    // slope space: x along the ridge, y off the slope, z down the slope from the ridge (right-handed)
    const c = Math.cos(pitch), sn = Math.sin(pitch);
    const M = new THREE.Matrix4().makeBasis(new THREE.Vector3(sd, 0, 0), new THREE.Vector3(0, c, sd * sn), new THREE.Vector3(0, -sn, sd * c)).setPosition(0, ridgeY - 0.04, 0);
    put(tile, new THREE.BoxGeometry(L, 0.03, slopeLen - 0.45).translate(0, -0.035, (slopeLen - 0.45) / 2).applyMatrix4(M));
    for (const [z0, z1, lift] of [[slopeLen - 1.0, slopeLen - 0.46, 0.012], [slopeLen - 0.5, slopeLen, 0]]) {
      const g = along(waveShape, z0, z1, 0, { flat: true, curve: 1 });
      g.translate(0, lift, 0).applyMatrix4(M);
      g.computeVertexNormals();
      put(tile, g);
    }
    const eaveZ = sd * (half + over), eaveY = top - Math.tan(pitch) * over - 0.04;
    for (let x = -lenA / 2 + 0.25; x < lenA / 2 - 0.1; x += 0.62) put('woodDark', new THREE.BoxGeometry(0.075, 0.11, over).translate(x, top - 0.1, sd * (half + over / 2)));
    put('woodDark', new THREE.BoxGeometry(L, 0.13, 0.03).translate(0, eaveY - 0.02, eaveZ));
    put('galvanized', side(sector(0.068, 0.076, Math.PI, Math.PI * 2, 8), L, 0, { flat: true }).translate(0, eaveY - 0.03, eaveZ + sd * 0.07));
  }
  put(tile, side(outline(arc(0, 0, 0.11, 0, Math.PI, 10)), L + 0.06, 0, { flat: true, curve: 2 }).translate(0, ridgeY - 0.06, 0));
  // gable walls (the triangle is drawn in [z, y] and stands across x)
  for (const x of [-lenA / 2 + 0.14, lenA / 2 - 0.14]) put(wallMat, side(outline([[-half - 0.02, top - 0.02], [half + 0.02, top - 0.02], [0, ridgeY - 0.07]]), 0.28, 0, { flat: true }).translate(x, 0, 0));
  // a chimney or two through the slope
  const rnd = opts.rnd || Math.random;
  for (let i = 0; i < (lenA > 9 ? 2 : 1); i++) {
    const x = (rnd() - 0.5) * (lenA - 3), z = (rnd() < 0.5 ? -1 : 1) * half * 0.35;
    const y0 = top + rise * (1 - Math.abs(z) / half) - 0.3;
    put('brick', new THREE.BoxGeometry(0.62, 1.5, 0.82).translate(x, y0 + 0.75, z));
    put('concrete', new THREE.BoxGeometry(0.76, 0.1, 0.96).translate(x, y0 + 1.55, z));
    put('concrete', new THREE.BoxGeometry(0.5, 0.18, 0.12).translate(x, y0 + 1.69, z));
  }
  return ridgeY;
}

function mergeAll(parts) {
  const geos = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    return n;
  });
  // local import keeps this module free of the utils dependency for callers
  return mergeGeometriesLocal(geos);
}

function mergeGeometriesLocal(geos) {
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}
