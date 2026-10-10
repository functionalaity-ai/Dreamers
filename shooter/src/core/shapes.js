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

function extrude(shape, depth, bevel, opts) {
  return new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0001, depth), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * (opts.bevelSize ?? 1),
    bevelSegments: opts.bevelSegments ?? 2, curveSegments: opts.curve ?? 8,
  });
}

// A side profile ([z, y] outline) given a thickness along X, centred on x0.
export function side(shape, thickness, bevel = 0.0008, opts = {}) {
  const depth = thickness - bevel * 2;
  const g = extrude(shape, depth, bevel, opts);
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  if (opts.x) g.translate(opts.x, 0, 0);
  return opts.flat ? g : crease(g, opts.crease);
}

// A cross-section ([x, y] outline) extruded along Z between z0 and z1.
export function along(shape, z0, z1, bevel = 0.0004, opts = {}) {
  const lo = Math.min(z0, z1), depth = Math.abs(z1 - z0) - bevel * 2;
  const g = extrude(shape, depth, bevel, opts);
  g.translate(0, 0, lo + bevel);
  if (opts.x || opts.y) g.translate(opts.x || 0, opts.y || 0, 0);
  return opts.flat ? g : crease(g, opts.crease);
}

// A plate in the XZ plane ([x, z] outline seen from above), thickness along Y, centred on y0.
export function plate(shape, thickness, bevel = 0.0004, opts = {}) {
  const depth = thickness - bevel * 2;
  const g = extrude(shape, depth, bevel, opts);
  g.translate(0, 0, -depth / 2);
  g.rotateX(Math.PI / 2);
  if (opts.y) g.translate(0, opts.y, 0);
  return opts.flat ? g : crease(g, opts.crease);
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
