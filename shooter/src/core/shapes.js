// Shape toolkit: rounded outlines with real holes, extruded with bevelled edges so every part has
// a crisp chamfer that catches the light. Used for the guns and the buildings' stonework.
// Gun axes: barrel along -Z, +Y up, +X right. Side profiles are drawn as [z, y], cross-sections
// as [x, y], and plates (seen from above) as [x, z].
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// A closed outline through [a, b] or [a, b, r] points; r rounds that corner with a fillet.
export function outline(pts, path = new THREE.Shape()) {
  const n = pts.length;
  const P = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  for (let i = 0; i < n; i++) {
    const p = P[i], r = pts[i][2] || 0;
    if (!r) { if (i === 0) path.moveTo(p.x, p.y); else path.lineTo(p.x, p.y); continue; }
    const a = P[(i - 1 + n) % n].clone().sub(p), b = P[(i + 1) % n].clone().sub(p);
    const la = a.length(), lb = b.length();
    const t = Math.min(r, la * 0.5, lb * 0.5);
    const p1 = p.clone().addScaledVector(a, t / la), p2 = p.clone().addScaledVector(b, t / lb);
    if (i === 0) path.moveTo(p1.x, p1.y); else path.lineTo(p1.x, p1.y);
    path.quadraticCurveTo(p.x, p.y, p2.x, p2.y);
  }
  path.closePath();
  return path;
}

export const hole = (pts) => outline(pts, new THREE.Path());

// Stadium-shaped slot (an M-LOK slot, a sling slot) centred on (cx, cy), long axis along `a`.
export function slot(cx, cy, len, w, a = 0, path = new THREE.Path()) {
  const r = w / 2, h = Math.max(0, len / 2 - r);
  const ca = Math.cos(a), sa = Math.sin(a);
  const P = (u, v) => [cx + u * ca - v * sa, cy + u * sa + v * ca];
  const steps = 8;
  let first = true;
  const pt = (u, v) => { const [x, y] = P(u, v); if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y); };
  for (let i = 0; i <= steps; i++) { const t = -Math.PI / 2 + (i / steps) * Math.PI; pt(h + Math.cos(t) * r, Math.sin(t) * r); }
  for (let i = 0; i <= steps; i++) { const t = Math.PI / 2 + (i / steps) * Math.PI; pt(-h + Math.cos(t) * r, Math.sin(t) * r); }
  path.closePath();
  return path;
}

export function circle(cx, cy, r, path = new THREE.Path(), seg = 16) {
  path.moveTo(cx + r, cy);
  for (let i = 1; i <= seg; i++) { const t = (i / seg) * Math.PI * 2; path.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r); }
  path.closePath();
  return path;
}

export function rrect(cx, cy, w, h, r, path = new THREE.Shape()) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return outline([[x0, y0, r], [x1, y0, r], [x1, y1, r], [x0, y1, r]], path);
}

// Annulus sector between angles a0..a1 (radians, 0 = +X, counter-clockwise), radii ri..ro.
export function sector(ri, ro, a0, a1, seg = 8) {
  const s = new THREE.Shape();
  for (let i = 0; i <= seg; i++) { const t = a0 + (a1 - a0) * (i / seg); const x = Math.cos(t) * ro, y = Math.sin(t) * ro; if (i === 0) s.moveTo(x, y); else s.lineTo(x, y); }
  for (let i = seg; i >= 0; i--) { const t = a0 + (a1 - a0) * (i / seg); s.lineTo(Math.cos(t) * ri, Math.sin(t) * ri); }
  s.closePath();
  return s;
}

export function ring(ri, ro, seg = 24) {
  const s = new THREE.Shape();
  circle(0, 0, ro, s, seg);
  s.holes.push(circle(0, 0, ri, new THREE.Path(), seg));
  return s;
}

// Smooth across gentle curves, keep machined edges sharp.
export function crease(g, deg = 34) { return toCreasedNormals(g, deg * Math.PI / 180); }

// --- rounded edges and pillowed caps -------------------------------------------------------------
// By default the extrusions are ExtrudeGeometry with creased normals. The guns' full-detail builds
// switch EDGES.round on: the same vertices and UVs with analytic normals. Caps stay flat, each
// bevel rolls smoothly from the cap onto the wall, and walls are smooth across gentle outline
// corners and sharp at the rest. Rolled edges give the wear shader curvature to find and its
// specular anti-aliasing a changing normal to filter. `pillow` (a dome() field) domes the caps.
export const EDGES = { round: false };

const isCW = (pts) => THREE.ShapeUtils.isClockWise(pts);

// Drop a closing point that repeats the first, as ExtrudeGeometry does.
function openLoop(pts) {
  if (pts.length > 2 && pts[pts.length - 1].equals(pts[0])) pts.pop();
  return pts;
}

// Split edges longer than `step`, so a pillowed cap has vertices along its straight sides. The new
// points sit a hair off the line: earcut drops exactly collinear points, which would leave cracks
// between a raised panel's cap and its bevel.
function resample(loop, step) {
  const out = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    out.push(a);
    const len = a.distanceTo(b), n = Math.floor(len / step);
    const ox = -(b.y - a.y) / len * 2e-7, oy = (b.x - a.x) / len * 2e-7;
    for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / (n + 1)).add(new THREE.Vector2(ox, oy).multiplyScalar(k % 2 ? 1 : -1)));
  }
  return out;
}

// ExtrudeGeometry's bevel offset: the point shifted one unit outwards along both neighbouring
// edges (longer at sharp corners, so the offset edges stay parallel).
function bevelVec(p, prev, next) {
  const px = p.x - prev.x, py = p.y - prev.y, nx = next.x - p.x, ny = next.y - p.y;
  const plsq = px * px + py * py;
  let tx, ty, shrink;
  if (Math.abs(px * ny - py * nx) > Number.EPSILON) {
    const pl = Math.sqrt(plsq), nl = Math.sqrt(nx * nx + ny * ny);
    const psx = prev.x - py / pl, psy = prev.y + px / pl, nsx = next.x - ny / nl, nsy = next.y + nx / nl;
    const sf = ((nsx - psx) * ny - (nsy - psy) * nx) / (px * ny - py * nx);
    tx = psx + px * sf - p.x; ty = psy + py * sf - p.y;
    const lsq = tx * tx + ty * ty;
    if (lsq <= 2) return new THREE.Vector2(tx, ty);
    shrink = Math.sqrt(lsq / 2);
  } else {
    const same = px > Number.EPSILON ? nx > Number.EPSILON : px < -Number.EPSILON ? nx < -Number.EPSILON : Math.sign(py) === Math.sign(ny);
    if (same) { tx = -py; ty = px; shrink = Math.sqrt(plsq); } else { tx = px; ty = py; shrink = Math.sqrt(plsq / 2); }
  }
  return new THREE.Vector2(tx / shrink, ty / shrink);
}

// Height field over closed loops: depth × smoothstep(0, falloff, distance in from the outline),
// zero on the outline, outside it and in its holes.
function field(loops, depth, falloff, spacing) {
  const S = [];
  for (const l of loops) for (let i = 0; i < l.length; i++) { const a = l[i], b = l[(i + 1) % l.length]; S.push(a.x, a.y, b.x, b.y); }
  const seg = new Float64Array(S);
  const res = { h: 0, gx: 0, gy: 0, d: 0 };
  return {
    depth, falloff, spacing,
    // height, gradient and inside distance at (x, y); the result object is reused
    at(x, y) {
      let best = Infinity, qx = 0, qy = 0, inside = false;
      for (let i = 0; i < seg.length; i += 4) {
        const ax = seg[i], ay = seg[i + 1], bx = seg[i + 2], by = seg[i + 3];
        if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) inside = !inside;
        const ex = bx - ax, ey = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
        const cx = ax + ex * t, cy = ay + ey * t, dd = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (dd < best) { best = dd; qx = cx; qy = cy; }
      }
      const d = Math.sqrt(best);
      res.d = inside ? d : 0;
      if (!inside || d < 1e-9 || !depth) { res.h = res.gx = res.gy = 0; return res; }
      const t = Math.min(1, d / falloff);
      res.h = depth * t * t * (3 - 2 * t);
      const k = depth * 6 * t * (1 - t) / falloff / d;
      res.gx = (x - qx) * k; res.gy = (y - qy) * k;
      return res;
    },
  };
}

// A gentle moulded dome over a shape (its own outline and holes stay put). Pass it as `pillow`
// to side()/plate() for the part itself; a raised panel on that part passes the same dome and
// rides on its surface.
export function dome(shape, depth = 0.001, falloff = 0.008, opts = {}) {
  const ex = shape.extractPoints(opts.curve ?? 8);
  return field([ex.shape, ...ex.holes].map(openLoop), depth, falloff, opts.spacing ?? Math.min(0.004, falloff * 0.5));
}

// Interior points for a pillowed cap: a staggered grid, dense where the dome curves and sparse on
// its plateau, kept clear of the cap's own outline.
function steinerPoints(loops, dm) {
  const step = dm.spacing, own = field(loops, 0, 1, step);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of loops[0]) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const out = [];
  for (let r = 0, y = y0; y <= y1; r++, y = y0 + r * step * 0.866) {
    for (let c = 0, x = x0 + (r % 2) * step * 0.5; x <= x1; c++, x += step) {
      const j = Math.sin(r * 12.9898 + c * 78.233) * 43758.5453;
      const px = x + (j - Math.floor(j) - 0.5) * step * 0.1, py = y + ((j * 1.37) - Math.floor(j * 1.37) - 0.5) * step * 0.1;
      if (own.at(px, py).d < step * 0.45) continue;
      if ((r % 2 || c % 2) && dm.at(px, py).d > dm.falloff * 1.3) continue;
      out.push(new THREE.Vector2(px, py));
    }
  }
  return out;
}

// Lawson edge flips towards a Delaunay triangulation, keeping the outline edges (`fixed`).
// T holds counter-clockwise [a, b, c] index triples into P.
function delaunay(P, T, fixed) {
  const N = P.length, key = (a, b) => (a < b ? a * N + b : b * N + a);
  const E = new Map();
  const add = (k, t) => { const e = E.get(k); if (!e) E.set(k, [t, -1]); else if (e[0] < 0) e[0] = t; else e[1] = t; };
  const drop = (k, t) => { const e = E.get(k); if (e) { if (e[0] === t) e[0] = -1; else if (e[1] === t) e[1] = -1; } };
  const link = (t, f) => { const q = T[t]; for (let i = 0; i < 3; i++) f(key(q[i], q[(i + 1) % 3]), t); };
  for (let t = 0; t < T.length; t++) link(t, add);
  const area = (a, b, c) => (P[b].x - P[a].x) * (P[c].y - P[a].y) - (P[c].x - P[a].x) * (P[b].y - P[a].y);
  const inCircle = (a, b, c, d) => {
    const ax = P[a].x - P[d].x, ay = P[a].y - P[d].y, bx = P[b].x - P[d].x, by = P[b].y - P[d].y, cx = P[c].x - P[d].x, cy = P[c].y - P[d].y;
    return (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
  };
  const stack = [...E.keys()];
  for (let guard = stack.length * 16; stack.length && guard > 0; guard--) {
    const k = stack.pop(), e = E.get(k);
    if (fixed.has(k) || !e || e[0] < 0 || e[1] < 0) continue;
    const t1 = e[0], t2 = e[1], A = T[t1], Bq = T[t2];
    let i = 0;
    while (i < 3 && key(A[i], A[(i + 1) % 3]) !== k) i++;
    const u = A[i], v = A[(i + 1) % 3], w1 = A[(i + 2) % 3];
    const w2 = Bq.find((q) => q !== u && q !== v);
    if (inCircle(u, v, w1, w2) <= 1e-22 || area(u, w2, w1) <= 0 || area(w2, v, w1) <= 0) continue;
    link(t1, drop); link(t2, drop);
    E.delete(k);
    T[t1] = [u, w2, w1]; T[t2] = [w2, v, w1];
    link(t1, add); link(t2, add);
    stack.push(key(u, w2), key(w2, v), key(v, w1), key(w1, u));
  }
  return T;
}

// The bevelled extrusion with analytic normals (and optionally pillowed caps). Same layers, quads
// and UVs as ExtrudeGeometry (steps = 1).
function roundExtrude(shape, depth, bevel, opts) {
  const B = bevel > 0 ? (opts.bevelSegments ?? 2) : 0;
  const T = B ? bevel : 0, S = B ? bevel * (opts.bevelSize ?? 1) : 0;
  const dm = opts.pillow || null;
  const ex = shape.extractPoints(opts.curve ?? 8);
  // wind the outline clockwise and the holes the other way, then drop repeated end points (in
  // that order, so the loops start where ExtrudeGeometry's do)
  let outer = openLoop(isCW(ex.shape) ? ex.shape : ex.shape.reverse());
  let holes = ex.holes.map((h) => openLoop(isCW(h) ? h.reverse() : h));
  // A raised panel's outline rides up the dome, so its long edges need points along them to
  // follow it; a part's own outline stays at the dome's foot and is left as it is.
  if (dm && [outer, ...holes].some((l) => l.some((p) => dm.at(p.x, p.y).h > 1e-6))) {
    outer = resample(outer, dm.spacing);
    holes = holes.map((h) => resample(h, dm.spacing));
  }
  const loops = [outer, ...holes];
  const cosC = Math.cos((opts.flat ? 1 : (opts.crease ?? 34)) * Math.PI / 180);
  // layers [offset, z, bevel angle, side]: back bevel rings, the two wall planes, front rings
  const L = [];
  for (let b = 0; b < B; b++) { const a = b / B * Math.PI / 2; L.push([S * Math.sin(a), -T * Math.cos(a), a, -1]); }
  L.push([S, 0, Math.PI / 2, -1], [S, depth, Math.PI / 2, 1]);
  for (let b = B - 1; b >= 0; b--) { const a = b / B * Math.PI / 2; L.push([S * Math.sin(a), depth + T * Math.cos(a), a, 1]); }
  const pos = [], nrm = [], uv = [];
  // final vertex [x, y, z, nx, ny, nz]: lifted onto the dome, its normal tilted to match
  const fin = (x, y, z, ax, nx, ny, nz, f) => {
    if (dm) { if (!f) f = dm.at(x, y); const k = nz * ax; z += ax * f.h; nx -= k * f.gx; ny -= k * f.gy; }
    const l = Math.hypot(nx, ny, nz) || 1;
    return [x, y, z, nx / l, ny / l, nz / l];
  };
  const emit = (v, u, w) => { pos.push(v[0], v[1], v[2]); nrm.push(v[3], v[4], v[5]); uv.push(u, w); };
  // caps: the outline triangulated (with interior points when pillowed); back faces, then front
  const extra = dm ? steinerPoints(loops, dm) : [];
  const P = loops.flat().concat(extra);
  const area = (f) => (P[f[1]].x - P[f[0]].x) * (P[f[2]].y - P[f[0]].y) - (P[f[2]].x - P[f[0]].x) * (P[f[1]].y - P[f[0]].y);
  let faces = THREE.ShapeUtils.triangulateShape(outer.slice(), holes.map((h) => h.slice()).concat(extra.map((p) => [p])));
  faces = faces.map((f) => (area(f) < 0 ? [f[0], f[2], f[1]] : f));
  if (extra.length) {
    const fixed = new Set();
    let base = 0;
    for (const l of loops) { for (let i = 0; i < l.length; i++) { const a = base + i, b = base + (i + 1) % l.length; fixed.add(a < b ? a * P.length + b : b * P.length + a); } base += l.length; }
    delaunay(P, faces, fixed);
  }
  const zb = B ? -T : 0, zf = B ? depth + T : depth;
  const capV = P.map((p) => { const f = dm ? Object.assign({}, dm.at(p.x, p.y)) : null; return [fin(p.x, p.y, zb, -1, 0, 0, -1, f), fin(p.x, p.y, zf, 1, 0, 0, 1, f)]; });
  for (const [side, order] of [[0, [2, 1, 0]], [1, [0, 1, 2]]]) {
    for (const f of faces) for (const o of order) { const p = P[f[o]]; emit(capV[f[o]][side], p.x, p.y); }
  }
  // walls and bevels, loop by loop and quad by quad as ExtrudeGeometry orders them
  for (const Q of loops) {
    const n = Q.length, NL = L.length;
    const mv = Q.map((p, i) => (B ? bevelVec(p, Q[(i - 1 + n) % n], Q[(i + 1) % n]) : new THREE.Vector2()));
    const en = Q.map((p, i) => { const q = Q[(i + 1) % n]; return new THREE.Vector2(p.y - q.y, q.x - p.x).normalize(); });
    // outward normal at each point: averaged across a gentle corner, null at a sharp one
    const vn = Q.map((p, i) => { const a = en[(i - 1 + n) % n]; return a.dot(en[i]) >= cosC ? a.clone().add(en[i]).normalize() : null; });
    // ring vertex at point i on layer s, as the end (e = 0) or the start (e = 1) of an edge
    const cache = new Array(n * NL * 2);
    const at = (i, s, e) => {
      const key = (i * NL + s) * 2 + e;
      if (cache[key]) return cache[key];
      const o = vn[i] || en[e ? i : (i - 1 + n) % n];
      const [bs, z, phi, ax] = L[s], p = Q[i], m = mv[i];
      let v;
      if (B && phi < Math.PI / 2 - 1e-6) { const c = Math.cos(phi) / T, sn = Math.sin(phi) / S; v = fin(p.x + m.x * bs, p.y + m.y * bs, z, ax, o.x * sn, o.y * sn, ax * c); }
      else v = fin(p.x + m.x * bs, p.y + m.y * bs, z, ax, o.x, o.y, 0);
      return (cache[key] = v);
    };
    for (let i = n - 1; i >= 0; i--) {
      const j = i, k = (i - 1 + n) % n; // the quad from point j back to point k lies on edge k
      for (let s = 0; s < NL - 1; s++) {
        const a = at(j, s, 0), b = at(k, s, 1), c = at(k, s + 1, 1), d = at(j, s + 1, 0);
        const u = Math.abs(a[1] - b[1]) < Math.abs(a[0] - b[0]) ? 0 : 1;
        emit(a, a[u], 1 - a[2]); emit(b, b[u], 1 - b[2]); emit(d, d[u], 1 - d[2]);
        emit(b, b[u], 1 - b[2]); emit(c, c[u], 1 - c[2]); emit(d, d[u], 1 - d[2]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.userData.round = true;
  return g;
}

function extrude(shape, depth, bevel, opts) {
  if (opts.pillow || (opts.round ?? EDGES.round)) return roundExtrude(shape, Math.max(0.0001, depth), bevel, opts);
  return new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0001, depth), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * (opts.bevelSize ?? 1),
    bevelSegments: opts.bevelSegments ?? 2, curveSegments: opts.curve ?? 8,
  });
}

// A side profile ([z, y] outline) given a thickness along X, centred on x0.
// opts.pillow: a dome() over the same [z, y] outline space, to dome both faces.
export function side(shape, thickness, bevel = 0.0008, opts = {}) {
  const depth = thickness - bevel * 2;
  const g = extrude(shape, depth, bevel, opts);
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  if (opts.x) g.translate(opts.x, 0, 0);
  return opts.flat || g.userData.round ? g : crease(g, opts.crease);
}

// A cross-section ([x, y] outline) extruded along Z between z0 and z1.
export function along(shape, z0, z1, bevel = 0.0004, opts = {}) {
  const lo = Math.min(z0, z1), depth = Math.abs(z1 - z0) - bevel * 2;
  const g = extrude(shape, depth, bevel, opts);
  g.translate(0, 0, lo + bevel);
  if (opts.x || opts.y) g.translate(opts.x || 0, opts.y || 0, 0);
  return opts.flat || g.userData.round ? g : crease(g, opts.crease);
}

// A plate in the XZ plane ([x, z] outline seen from above), thickness along Y, centred on y0.
export function plate(shape, thickness, bevel = 0.0004, opts = {}) {
  const depth = thickness - bevel * 2;
  const g = extrude(shape, depth, bevel, opts);
  g.translate(0, 0, -depth / 2);
  g.rotateX(Math.PI / 2);
  if (opts.y) g.translate(0, opts.y, 0);
  return opts.flat || g.userData.round ? g : crease(g, opts.crease);
}

// Lathe around the Z axis from [radius, z] pairs (z increasing). Centre offset (x, y).
export function turned(pts, seg = 24, x = 0, y = 0) {
  const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(Math.max(0, r), z)), seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, 0);
  return crease(g, 40);
}

// Lathe around the X axis from [radius, x] pairs (x increasing): pins, buttons, QD cups.
export function turnedX(pts, seg = 16, y = 0, z = 0) {
  const g = turned(pts, seg);
  g.rotateY(Math.PI / 2);
  g.translate(0, y, z);
  return g;
}

// Place a geometry: rotate (Euler xyz) then move.
export function put(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

// MIL-STD-1913 rail between z0 and z1 sitting on y: a base strip plus bevelled teeth on a
// 10 mm pitch, so the recoil slots are real gaps.
export function railParts(z0, z1, y, low = false, sx = 1) {
  const zA = Math.min(z0, z1), zB = Math.max(z0, z1);
  const base = outline([[-0.0081 * sx, 0], [0.0081 * sx, 0], [0.0081 * sx, 0.0028], [-0.0081 * sx, 0.0028]]);
  const tooth = outline([[-0.0079, 0.0012], [0.0079, 0.0012], [0.0104, 0.0035], [0.0104, 0.0045], [0.0084, 0.0064, 0.0004], [-0.0084, 0.0064, 0.0004], [-0.0104, 0.0045], [-0.0104, 0.0035]].map(([x, yy, r]) => [x * sx, yy, r]));
  const out = [along(base, zA, zB, 0.0003, { y, flat: true })];
  if (low) { out.push(along(tooth, zA, zB, 0.0003, { y, flat: true })); return out; }
  for (let z = zA + 0.0012; z + 0.0049 <= zB; z += 0.01) out.push(along(tooth, z, z + 0.0049, 0.00035, { y, flat: true, bevelSegments: 1 }));
  return out;
}
