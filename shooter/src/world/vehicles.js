// Vehicles, built panel by panel: an 80s Eastern-bloc saloon (sculpted body shell with panel
// gaps, chrome bumpers and window surrounds, fluted headlamps, segmented tail-lights, tyres with
// tread and sidewall lettering, alloy wheels with discs and calipers, a full interior seen through
// dusty glass), a burnt-out variant, a minibus and a gutted city bus.
//
// Local space: x forward, y up, z to the right; the ground is y = 0. Geometry is merged per
// material into the world batches, so a street full of cars costs a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedBox } from '../core/geometry.js';
import { plateTexture } from '../core/textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

class Parts {
  constructor() { this.map = new Map(); }
  add(mat, g) {
    if (!mat || !g) return;
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(g.index ? g.toNonIndexed() : g);
  }
  finish() {
    const out = new Map();
    for (const [m, list] of this.map) {
      for (const g of list) {
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!g.attributes.normal) g.computeVertexNormals();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      }
      out.set(m, mergeGeometries(list, false));
    }
    return out;
  }
}

// Quad from four points, wound to face `towards`, with 0..1 UVs.
function quad(a, b, c, d, towards) {
  const g = new THREE.BufferGeometry();
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
  let P = [a, b, c, a, c, d], U = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
  if (towards && n.dot(towards) < 0) { P = [a, c, b, a, d, c]; U = [[0, 0], [1, 1], [1, 0], [0, 0], [0, 1], [1, 1]]; }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.flatMap((p) => [p.x, p.y, p.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U.flat(), 2));
  g.computeVertexNormals();
  return g;
}

// Box running from P to Q, `w` wide across `side`, `t` thick along `n`.
function strip(P, Q, n, w, t, shift = 0) {
  const tv = new THREE.Vector3().subVectors(Q, P);
  const len = tv.length();
  tv.normalize();
  const nn = n.clone().sub(tv.clone().multiplyScalar(n.dot(tv))).normalize();
  const b = new THREE.Vector3().crossVectors(nn, tv).normalize();
  const g = new THREE.BoxGeometry(len, w, t);
  const m = new THREE.Matrix4().makeBasis(tv, b, nn);
  m.setPosition(P.clone().add(Q).multiplyScalar(0.5).add(nn.clone().multiplyScalar(t / 2)).add(b.clone().multiplyScalar(shift)));
  g.applyMatrix4(m);
  return g;
}

// A polyline of thin strips (panel gaps, mouldings) lying on a surface with normal n.
function line(points, n, w = 0.004, t = 0.002) {
  const parts = [];
  for (let i = 0; i < points.length - 1; i++) parts.push(strip(points[i], points[i + 1], n, w, t));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
}

function box(x0, y0, z0, x1, y1, z1, r) {
  [x0, x1] = [Math.min(x0, x1), Math.max(x0, x1)]; [y0, y1] = [Math.min(y0, y1), Math.max(y0, y1)]; [z0, z1] = [Math.min(z0, z1), Math.max(z0, z1)];
  const g = r ? roundedBox(x1 - x0, y1 - y0, z1 - z0, r, 2) : new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function cyl(r0, r1, len, seg, axis = 'z', open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  else if (axis === 'x') g.rotateZ(-Math.PI / 2);
  return g;
}

// --- wheels -----------------------------------------------------------------------------------
// Builds one wheel centred at the origin, axis along z, outer face towards +z.
function wheelParts(C, R, width, opts = {}) {
  const parts = new Parts();
  const hw = width / 2;
  if (!opts.noTyre) {
    // tread band with rounded shoulders
    const prof = [[R - 0.03, -hw], [R - 0.012, -hw + 0.006], [R - 0.002, -hw + 0.02], [R, -hw + 0.035], [R, hw - 0.035], [R - 0.002, hw - 0.02], [R - 0.012, hw - 0.006], [R - 0.03, hw]];
    const tread = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), 48);
    tread.rotateX(Math.PI / 2);
    // LatheGeometry's UVs: u around, v along the profile — what the tread texture expects.
    parts.add(C.tread, tread);
    // sidewalls (slightly bulged) with moulded lettering
    for (const side of [-1, 1]) {
      const ring = new THREE.RingGeometry(R * 0.6, R - 0.03, 48, 3);
      const p = ring.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getX(i), p.getY(i));
        const t = (r - R * 0.6) / (R * 0.4 - 0.03);
        p.setZ(i, Math.sin(t * Math.PI) * 0.012);
      }
      ring.computeVertexNormals();
      if (side < 0) ring.rotateY(Math.PI);
      ring.translate(0, 0, side * hw);
      parts.add(C.sidewall, ring);
    }
  }
  // rim barrel and an alloy face with five spoke openings
  const rr = R * 0.58;
  const barrel = cyl(rr, rr, width - 0.02, 40, 'z', true);
  parts.add(opts.rust ? C.rust : C.satin, barrel);
  const face = new THREE.Shape();
  face.absarc(0, 0, rr, 0, Math.PI * 2, false);
  for (let k = 0; k < 5; k++) {
    const a = k * Math.PI * 2 / 5 + 0.3;
    const hole = new THREE.Path();
    const r0 = rr * 0.42, r1 = rr * 0.86, da = 0.42;
    hole.moveTo(Math.cos(a - da * 0.7) * r0, Math.sin(a - da * 0.7) * r0);
    hole.absarc(0, 0, r1, a - da, a + da, false);
    hole.lineTo(Math.cos(a + da * 0.7) * r0, Math.sin(a + da * 0.7) * r0);
    hole.absarc(0, 0, r0, a + da * 0.7, a - da * 0.7, true);
    face.holes.push(hole);
  }
  const fg = new THREE.ExtrudeGeometry(face, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.007, bevelSegments: 1, curveSegments: 7 });
  fg.translate(0, 0, hw - 0.055);
  parts.add(opts.rust ? C.rust : C.steelWheel, fg);
  // hub cap and lug nuts
  const cap = new THREE.SphereGeometry(rr * 0.3, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.rotateX(Math.PI / 2);
  cap.scale(1, 1, 0.45);
  cap.translate(0, 0, hw - 0.03);
  parts.add(opts.rust ? C.rust : C.chrome, cap);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    const nut = cyl(0.011, 0.011, 0.02, 6);
    nut.translate(Math.cos(a) * rr * 0.36, Math.sin(a) * rr * 0.36, hw - 0.03);
    parts.add(opts.rust ? C.rust : C.chrome, nut);
  }
  // brake disc and caliper behind the spokes
  const disc = cyl(rr * 0.82, rr * 0.82, 0.014, 32);
  disc.translate(0, 0, hw - 0.1);
  parts.add(C.disc, disc);
  if (!opts.rust) {
    const cal = box(-0.035, rr * 0.55, -0.03, 0.035, rr * 0.86, 0.03, 0.008);
    cal.rotateZ(-0.6);
    cal.translate(0, 0, hw - 0.1);
    parts.add(C.blackTrim, cal);
  }
  return parts.finish();
}

// --- the saloon -----------------------------------------------------------------------------
const S = { L: 2.0, W: 1.62, WB: 1.21, R: 0.29, ARCH: 0.355, BEV: 0.05, BT: 0.055 };

function saloonBody(C, paint, burnt) {
  const P = new Parts();
  const { L, W, WB, R, ARCH, BEV, BT } = S;
  const HW = W / 2, e = BEV;
  const body = burnt ? C.rust : paint;
  // Lower body: the side silhouette, extruded across the car with rounded edges.
  const sh = new THREE.Shape();
  sh.moveTo(-L + e + 0.02, 0.24 + e);
  sh.lineTo(-WB - ARCH - e, 0.24 + e);
  sh.absarc(-WB, R, ARCH + e, Math.PI, 0, true);
  sh.lineTo(WB - ARCH - e, 0.24 + e);
  sh.absarc(WB, R, ARCH + e, Math.PI, 0, true);
  sh.lineTo(L - e - 0.02, 0.24 + e);
  sh.lineTo(L - e, 0.7 - e);
  sh.lineTo(L - e - 0.03, 0.78 - e);
  sh.lineTo(1.4, 0.82 - e);
  sh.lineTo(0.82, 0.86 - e);
  sh.lineTo(-1.3, 0.9 - e);
  sh.lineTo(-1.95 + e, 0.88 - e);
  sh.lineTo(-L + e, 0.84 - e);
  sh.lineTo(-L + e, 0.27 + e);
  const depth = W - BT * 2;
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: BT, bevelSize: BEV, bevelSegments: 4, curveSegments: 14 });
  g.translate(0, 0, -depth / 2);
  // Open the cabin: drop the flat top between the windscreen and the rear window.
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const keep = [];
  const tri = new THREE.Triangle(), n = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    tri.set(V(pos.getX(i), pos.getY(i), pos.getZ(i)), V(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)), V(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)));
    tri.getNormal(n); tri.getMidpoint(c);
    if (n.y > 0.97 && c.x > -1.27 && c.x < 0.79 && Math.abs(c.z) < HW - 0.03) continue;
    keep.push(i, i + 1, i + 2);
  }
  const open = new THREE.BufferGeometry();
  const take = (attr, size) => new THREE.Float32BufferAttribute(keep.flatMap((i) => Array.from({ length: size }, (_, k) => attr.array[i * size + k])), size);
  open.setAttribute('position', take(pos, 3));
  open.setAttribute('normal', take(nrm, 3));
  // Paint UVs in metres (for the metallic flake map).
  const P3 = open.attributes.position, N3 = open.attributes.normal, uvs = new Float32Array(P3.count * 2);
  for (let i = 0; i < P3.count; i++) {
    const ax = Math.abs(N3.getX(i)), ay = Math.abs(N3.getY(i)), az = Math.abs(N3.getZ(i));
    const x = P3.getX(i), y = P3.getY(i), z = P3.getZ(i);
    if (az >= ax && az >= ay) { uvs[i * 2] = x; uvs[i * 2 + 1] = y; } else if (ay >= ax) { uvs[i * 2] = x; uvs[i * 2 + 1] = z; } else { uvs[i * 2] = z; uvs[i * 2 + 1] = y; }
  }
  open.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  P.add(body, open);

  // Greenhouse: windscreen, roof, rear window and side glass on a frustum, with pillars on top.
  const yb = 0.86, yr = 1.41, zb = HW - 0.07, zr = HW - 0.2;
  const A = 0.8, Bx = 0.04, Cx = -0.98, D = -1.27;
  const pts = {
    Al: V(A, yb, -zb), Ar: V(A, yb, zb), Bl: V(Bx, yr, -zr), Br: V(Bx, yr, zr),
    Cl: V(Cx, yr, -zr), Cr: V(Cx, yr, zr), Dl: V(D, yb + 0.03, -zb), Dr: V(D, yb + 0.03, zb),
  };
  const wsN = new THREE.Vector3().subVectors(pts.Br, pts.Ar).cross(new THREE.Vector3().subVectors(pts.Al, pts.Ar)).normalize();
  if (wsN.x < 0) wsN.negate();
  const rwN = new THREE.Vector3(-(yr - yb), -(Cx - D), 0).normalize(); if (rwN.x > 0) rwN.negate(); rwN.y = Math.abs(rwN.y);
  const sideN = (s) => new THREE.Vector3(0, zb - zr, yr - yb).normalize().multiply(V(1, 1, s)).setY(Math.abs((zb - zr) / Math.hypot(zb - zr, yr - yb)));
  const glass = burnt ? null : C.glass;
  if (glass) {
    P.add(C.windscreen, quad(pts.Al, pts.Ar, pts.Br, pts.Bl, wsN));
    P.add(glass, quad(pts.Dr, pts.Dl, pts.Cl, pts.Cr, rwN));
    P.add(glass, quad(pts.Dl, pts.Al, pts.Bl, pts.Cl, sideN(-1)));
    P.add(glass, quad(pts.Ar, pts.Dr, pts.Cr, pts.Br, sideN(1)));
  }
  // Roof panel: crowned, a touch proud of the glass, with drip rails.
  // a solid skin (top crowned, bottom flat) so it reads from any angle
  const roof = new THREE.BoxGeometry(Bx - Cx + 0.06, 0.05, zr * 2 + 0.06, 10, 1, 8);
  const rp = roof.attributes.position;
  for (let i = 0; i < rp.count; i++) { const z = rp.getZ(i), yv = rp.getY(i); rp.setY(i, yv + (yv > 0 ? 0.035 * (1 - (z / (zr + 0.02)) ** 2) : 0)); }
  roof.computeVertexNormals();
  roof.translate((Bx + Cx) / 2, yr - 0.002, 0);
  P.add(body, roof);
  const head = box(Cx + 0.02, yr - 0.03, -zr + 0.01, Bx - 0.02, yr - 0.005, zr - 0.01);
  P.add(burnt ? C.char : C.headliner, head);
  for (const s of [-1, 1]) {
    P.add(C.chrome, strip(V(Bx + 0.02, yr + 0.004, s * (zr + 0.012)), V(Cx - 0.02, yr + 0.004, s * (zr + 0.012)), V(0, 1, 0), 0.012, 0.014));
    // A-, B- and C-pillars in body colour
    P.add(body, strip(s < 0 ? pts.Al : pts.Ar, s < 0 ? pts.Bl : pts.Br, wsN.clone().add(sideN(s)).normalize(), 0.055, 0.016));
    // door-frame tops under the roof rail, so the roof line reads from the side
    P.add(body, strip(V(Cx - 0.02, yr - 0.03, s * (zr + 0.008)), V(Bx + 0.01, yr - 0.03, s * (zr + 0.008)), sideN(s), 0.065, 0.016));
    const bb = V(-0.41, yb, s * zb), bt = V(-0.45, yr, s * zr);
    P.add(body, strip(bb, bt, sideN(s), 0.085, 0.02));
    P.add(body, strip(s < 0 ? pts.Dl : pts.Dr, s < 0 ? pts.Cl : pts.Cr, sideN(s), 0.24, 0.022, -0.1 * s));
    P.add(body, strip(s < 0 ? pts.Dl : pts.Dr, s < 0 ? pts.Cl : pts.Cr, rwN.clone().add(sideN(s)).normalize(), 0.06, 0.02));
    // chrome window surround along the belt and the roof rail, rubber seal below it
    P.add(C.chrome, strip(V(D + 0.04, yb + 0.018, s * (zb + 0.004)), V(A - 0.02, yb + 0.004, s * (zb + 0.004)), sideN(s), 0.018, 0.01));
    P.add(C.chrome, strip(V(Cx + 0.03, yr - 0.02, s * (zr + 0.003)), V(Bx - 0.03, yr - 0.02, s * (zr + 0.003)), sideN(s), 0.014, 0.008));
  }
  // windscreen and rear-window rubber with a chrome insert
  for (const [p, q, nn] of [[pts.Al, pts.Ar, wsN], [pts.Bl, pts.Br, wsN], [pts.Dl, pts.Dr, rwN], [pts.Cl, pts.Cr, rwN]]) {
    P.add(C.rubber, strip(p, q, nn, 0.03, 0.008));
    P.add(C.chrome, strip(p, q, nn, 0.008, 0.012));
  }

  // Panel gaps on the flanks, bonnet and boot.
  const gap = C.gap;
  for (const s of [-1, 1]) {
    const z = s * (HW + 0.0008), n = V(0, 0, s);
    const arc = [];
    for (let k = 0; k <= 8; k++) { const a = k / 8 * 1.75; arc.push(V(-WB + Math.cos(a) * (ARCH + 0.03), R + Math.sin(a) * (ARCH + 0.03), z)); }
    P.add(gap, line([V(0.8, 0.84, z), V(0.8, 0.31, z), V(-WB + ARCH + 0.03, 0.31, z)], n));
    P.add(gap, line([V(-0.41, 0.84, z), V(-0.41, 0.31, z)], n));
    P.add(gap, line([V(-1.27, 0.86, z), V(-1.27, arc[8].y, z), ...arc.reverse()], n));
    // rubbing strip and door handles
    P.add(C.rubber, box(-1.92, 0.665, s * HW - 0.012, 1.93, 0.705, s * HW + 0.012, 0.008));
    P.add(C.chrome, box(-1.92, 0.68, s * HW + 0.008, 1.93, 0.69, s * HW + 0.014));
    for (const hx of [-0.32, -1.16]) {
      P.add(C.chrome, box(hx - 0.07, 0.785, s * HW - 0.005, hx + 0.07, 0.81, s * HW + 0.018, 0.006));
      P.add(C.blackTrim, box(hx - 0.06, 0.776, s * HW - 0.002, hx + 0.06, 0.785, s * HW + 0.01));
    }
    // side repeater on the front wing
    P.add(C.amber, box(1.3, 0.69, s * HW - 0.01, 1.36, 0.715, s * HW + 0.012, 0.005));
    // wheel-arch liners
    for (const ax of [-WB, WB]) {
      const liner = new THREE.CylinderGeometry(ARCH + 0.004, ARCH + 0.004, 0.34, 20, 1, true, Math.PI / 2, Math.PI);
      liner.rotateX(Math.PI / 2);
      liner.translate(ax, R, s * (HW - 0.18));
      P.add(C.underDS, liner);
    }
  }
  // bonnet and boot shut lines (sampled along the top surface)
  const hoodY = (x) => (x > 1.4 ? 0.78 + (0.82 - 0.78) * (2.0 - x) / 0.6 : 0.82 + (0.86 - 0.82) * (1.4 - x) / 0.58);
  for (const s of [-1, 1]) {
    const pl = [];
    for (let x = 0.84; x <= 1.94; x += 0.1) pl.push(V(x, hoodY(x) + 0.0008, s * (HW - 0.09)));
    P.add(gap, line(pl, V(0, 1, 0)));
    P.add(gap, line([V(-1.31, 0.9008, s * (HW - 0.09)), V(-1.94, 0.8808, s * (HW - 0.09))], V(0, 1, 0)));
  }
  P.add(gap, line([V(0.84, 0.8608, -HW + 0.09), V(0.84, 0.8608, HW - 0.09)], V(0, 1, 0)));
  P.add(gap, line([V(-1.31, 0.9008, -HW + 0.09), V(-1.31, 0.9008, HW - 0.09)], V(0, 1, 0)));
  // scuttle vent and wipers
  P.add(C.blackTrim, box(0.78, 0.855, -HW + 0.1, 0.84, 0.87, HW - 0.1));
  for (const wz of [-0.35, 0.15]) {
    P.add(C.blackTrim, strip(V(0.78, yb + 0.02, wz), V(0.52, yb + 0.33, wz + 0.42), wsN, 0.012, 0.012));
    P.add(C.rubber, strip(V(0.77, yb + 0.03, wz + 0.04), V(0.5, yb + 0.35, wz + 0.46), wsN, 0.02, 0.006));
  }
  // door mirror (driver's side) and aerial
  P.add(C.blackTrim, strip(V(0.72, yb + 0.02, -zb - 0.01), V(0.74, yb + 0.07, -HW - 0.08), V(0, 1, 0), 0.03, 0.02));
  P.add(C.blackTrim, box(0.66, yb + 0.05, -HW - 0.2, 0.78, yb + 0.15, -HW - 0.05, 0.02));
  P.add(C.mirror, box(0.655, yb + 0.06, -HW - 0.19, 0.66, yb + 0.14, -HW - 0.06));
  P.add(C.chrome, cyl(0.003, 0.002, 0.9, 5, 'y').translate(1.55, 0.8 + 0.45, HW - 0.12));

  // Front: grille, square headlamps, bumper, indicators, plate bracket.
  const fx = L + 0.002;
  P.add(C.blackTrim, box(fx - 0.04, 0.5, -0.42, fx, 0.74, 0.42));
  P.add(C.chrome, box(fx - 0.02, 0.73, -0.43, fx + 0.012, 0.75, 0.43, 0.004));
  P.add(C.chrome, box(fx - 0.02, 0.49, -0.43, fx + 0.012, 0.51, 0.43, 0.004));
  for (let k = 0; k < 6; k++) P.add(k % 2 ? C.blackTrim : C.chrome, box(fx - 0.03, 0.53 + k * 0.034, -0.4, fx + 0.006, 0.545 + k * 0.034, 0.4));
  P.add(C.chrome, box(fx, 0.6, -0.06, fx + 0.016, 0.66, 0.06, 0.008));
  for (const s of [-1, 1]) {
    // square headlamp: dark backing, a shallow chrome reflector, bulb, fluted lens, chrome bezel
    const zc = s * 0.6, y0 = 0.505, y1 = 0.745, za = zc - 0.175, zb2 = zc + 0.175;
    P.add(C.blackTrim, box(fx - 0.004, y0, za, fx + 0.004, y1, zb2));
    const bowl = new THREE.SphereGeometry(0.14, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    bowl.rotateZ(Math.PI / 2); bowl.scale(0.22, 0.82, 1.2); bowl.translate(fx + 0.036, 0.625, zc);
    P.add(C.reflector, flipFaces(bowl));
    P.add(C.chrome, new THREE.SphereGeometry(0.016, 10, 8).translate(fx + 0.02, 0.625, zc));
    const lens = new THREE.PlaneGeometry(0.34, 0.23, 6, 4);
    const lp = lens.attributes.position; for (let i = 0; i < lp.count; i++) lp.setZ(i, 0.008 * (1 - (lp.getX(i) / 0.17) ** 2) * (1 - (lp.getY(i) / 0.115) ** 2));
    lens.computeVertexNormals();
    lens.rotateY(Math.PI / 2); lens.translate(fx + 0.038, 0.625, zc);
    P.add(burnt ? null : C.lens, lens);
    for (const [a0, a1, b0, b1] of [[y0, y0 + 0.014, za, zb2], [y1 - 0.014, y1, za, zb2], [y0, y1, za, za + 0.014], [y0, y1, zb2 - 0.014, zb2]]) P.add(C.chrome, box(fx, a0, b0, fx + 0.048, a1, b1, 0.004));
    P.add(C.amber, box(fx - 0.02, 0.41, s * 0.66 - 0.07, fx + 0.03, 0.45, s * 0.66 + 0.07, 0.008));
  }
  bumper(P, C, fx, 1);
  P.add(C.blackTrim, box(fx + 0.02, 0.24, -0.27, fx + 0.04, 0.37, 0.27));

  // Rear: segmented tail-lights, boot badge, bumper, exhaust.
  const rx = -L - 0.002;
  for (const s of [-1, 1]) {
    P.add(C.blackTrim, box(rx - 0.008, 0.55, s * 0.23, rx + 0.03, 0.77, s * 0.79));
    const segs = [[C.reverse, 0.23, 0.33], [C.tail, 0.33, 0.55], [C.amber, 0.55, 0.67], [C.tail, 0.67, 0.78]];
    for (const [m, a, b] of segs) P.add(burnt ? C.char : m, box(rx - 0.02, 0.565, s > 0 ? a + 0.005 : -b + 0.005, rx + 0.005, 0.755, s > 0 ? b - 0.005 : -a - 0.005, 0.006));
    P.add(C.chrome, box(rx - 0.024, 0.554, s > 0 ? 0.225 : -0.795, rx - 0.012, 0.566, s > 0 ? 0.795 : -0.225));
  }
  P.add(C.blackTrim, box(rx - 0.006, 0.6, -0.22, rx + 0.01, 0.74, 0.22));
  P.add(C.chrome, box(rx - 0.016, 0.76, -0.08, rx, 0.785, 0.08, 0.006));
  bumper(P, C, rx, -1);
  P.add(C.rust, cyl(0.026, 0.026, 0.2, 10, 'x').translate(rx + 0.05, 0.26, 0.45));
  P.add(C.char, cyl(0.02, 0.02, 0.01, 10, 'x').translate(rx - 0.05, 0.26, 0.45));
  // Underbody so you can't see through from low angles.
  P.add(C.under, box(-L + 0.1, 0.2, -HW + 0.08, L - 0.1, 0.25, HW - 0.08));

  // Interior: floor, door cards, dashboard and instruments, steering wheel, seats, parcel shelf.
  const seat = burnt ? C.char : C.seat, dash = burnt ? C.char : C.dash;
  P.add(burnt ? C.char : C.carpet, box(-1.3, 0.28, -HW + 0.07, 0.8, 0.3, HW - 0.07));
  for (const s of [-1, 1]) {
    const card = new THREE.PlaneGeometry(2.05, 0.56);
    card.rotateY(s > 0 ? Math.PI : 0);
    card.translate(-0.24, 0.58, s * (HW - 0.065));
    P.add(dash, card);
    P.add(seat, box(-1.2, 0.62, s * (HW - 0.12), 0.7, 0.66, s * (HW - 0.065), 0.01));
  }
  P.add(dash, box(0.5, 0.7, -HW + 0.07, 0.8, 0.86, HW - 0.07, 0.03));
  P.add(dash, box(0.42, 0.82, -0.6, 0.62, 0.95, -0.15, 0.04));
  for (const gz of [-0.46, -0.3]) P.add(C.chrome, cyl(0.045, 0.045, 0.006, 20, 'x').translate(0.44, 0.88, gz));
  P.add(dash, box(0.2, 0.3, -0.12, 0.6, 0.55, 0.12, 0.03));
  P.add(C.chrome, cyl(0.008, 0.008, 0.22, 6, 'y').translate(0.16, 0.42, 0));
  P.add(dash, new THREE.SphereGeometry(0.025, 10, 8).translate(0.16, 0.54, 0));
  const wheel = new THREE.TorusGeometry(0.19, 0.016, 8, 32);
  wheel.rotateY(Math.PI / 2); wheel.rotateZ(-0.95); wheel.translate(0.3, 0.86, -0.36);
  P.add(dash, wheel);
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI * 2 / 3 - Math.PI / 2;
    const sp = strip(V(0.3, 0.86, -0.36), V(0.3 - Math.sin(a) * 0.19 * Math.sin(0.95), 0.86 + Math.sin(a) * 0.19 * Math.cos(0.95), -0.36 + Math.cos(a) * 0.19), V(1, 0.6, 0), 0.03, 0.012);
    P.add(dash, sp);
  }
  P.add(dash, strip(V(0.3, 0.86, -0.36), V(0.55, 0.72, -0.36), V(0, 1, 0), 0.05, 0.05));
  for (const s of [-1, 1]) {
    const z = s * 0.36;
    P.add(seat, box(-0.25, 0.36, z - 0.25, 0.25, 0.5, z + 0.25, 0.05));
    const back = box(-0.07, 0, -0.25, 0.07, 0.62, 0.25, 0.05);
    back.rotateZ(0.22); back.translate(-0.28, 0.48, z);
    P.add(seat, back);
    const rest = box(-0.05, 0, -0.13, 0.05, 0.19, 0.13, 0.04);
    rest.rotateZ(0.22); rest.translate(-0.43, 1.12, z);
    P.add(seat, rest);
  }
  P.add(seat, box(-1.15, 0.34, -HW + 0.1, -0.68, 0.5, HW - 0.1, 0.06));
  const rb = box(-0.07, 0, -HW + 0.1, 0.07, 0.56, HW - 0.1, 0.05);
  rb.rotateZ(0.25); rb.translate(-1.12, 0.5, 0);
  P.add(seat, rb);
  P.add(dash, box(-1.3, 0.88, -HW + 0.08, -1.18, 0.9, HW - 0.08));
  P.add(dash, box(0.0, yr - 0.07, -0.04, 0.03, yr - 0.03, 0.04));
  P.add(C.mirror, box(-0.005, yr - 0.1, -0.1, 0.0, yr - 0.05, 0.1));
  for (const s of [-1, 1]) P.add(dash, box(-0.05, yr - 0.05, s * 0.36 - 0.18, 0.2, yr - 0.035, s * 0.36 + 0.18));
  const out = P.finish();
  if (!burnt) return out;
  // Burnt out: brightwork rusted, lamps and rubber charred.
  const remap = new Map([[C.chrome, C.rust], [C.satin, C.rust], [C.mirror, C.char], [C.reflector, C.rust], [C.amber, C.char], [C.tail, C.char], [C.reverse, C.char], [C.rubber, C.char], [C.blackTrim, C.char], [C.gap, C.char]]);
  const merged = new Map();
  for (const [m, g] of out) {
    const k = remap.get(m) || m;
    merged.set(k, merged.has(k) ? mergeGeometries([merged.get(k), g], false) : g);
  }
  return merged;
}

function bumper(P, C, x, dir) {
  const HW = S.W / 2;
  const g = roundedBox(0.09, 0.12, S.W + 0.04, 0.03, 3);
  g.translate(x + dir * 0.045, 0.4, 0);
  P.add(C.chrome, g);
  P.add(C.rubber, box(x + dir * 0.07 - 0.012, 0.385, -HW + 0.06, x + dir * 0.07 + 0.012, 0.415, HW - 0.06, 0.005));
  for (const s of [-1, 1]) {
    const w = roundedBox(0.2, 0.12, 0.08, 0.03, 3);
    w.translate(x - dir * 0.06, 0.4, s * (HW + 0.01));
    P.add(C.chrome, w);
    P.add(C.rubber, box(x + dir * 0.06 - 0.03, 0.34, s * 0.32 - 0.04, x + dir * 0.06 + 0.035, 0.47, s * 0.32 + 0.04, 0.012));
  }
}

function flipFaces(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  const p = ng.attributes.position.array, n = ng.attributes.normal ? ng.attributes.normal.array : null, uv = ng.attributes.uv ? ng.attributes.uv.array : null;
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
    if (n) for (let k = 0; k < 3; k++) { const t = n[i + 3 + k]; n[i + 3 + k] = n[i + 6 + k]; n[i + 6 + k] = t; }
    if (uv) { const j = i / 9 * 6; for (let k = 0; k < 2; k++) { const t = uv[j + 2 + k]; uv[j + 2 + k] = uv[j + 4 + k]; uv[j + 4 + k] = t; } }
  }
  if (n) for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return ng;
}

// --- placing models ---------------------------------------------------------------------------
const cache = new Map();

function put(B, parts, m) {
  for (const [mat, g] of parts) {
    const c = g.clone();
    c.applyMatrix4(m);
    B.geo(mat, c);
  }
}

function placement(x, z, rot, yaw = 0, y = 0) {
  return new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -rot * Math.PI / 2 + yaw), V(1, 1, 1));
}

// Axis-aligned collider for a footprint rotated by quarter turns.
function collide(B, x, z, rot, hx, hz, y0, y1, phys = 'metal') {
  const a = (rot & 1) ? hz : hx, b = (rot & 1) ? hx : hz;
  B.collider(x - a, y0, z - b, x + a, y1, z + b, phys);
}

let plateN = 0;
const PLATES = [['А 4217 КЛ', '77'], ['Б 0381 МР', '50'], ['К 9053 ОА', '16'], ['Т 1166 ГР', '61'], ['Е 7702 ВН', '23'], ['М 3348 СТ', '78'], ['Р 2519 ХУ', '47'], ['Н 6604 ДЛ', '52']];
function plateMaterial(M) {
  const [t, r] = PLATES[plateN++ % PLATES.length];
  return new THREE.MeshStandardMaterial({ map: plateTexture(t, r), roughness: 0.55, metalness: 0.3, envMap: M.chrome.envMap });
}

export function saloon(B, mats, x, z, rot, paintKey = 'cherry', opts = {}) {
  const C = mats.car;
  ensureExtras(C);
  const burnt = !!opts.burnt;
  const key = 'saloon:' + (burnt ? 'burnt' : paintKey);
  if (!cache.has(key)) cache.set(key, saloonBody(C, C.paint[paintKey] || C.paint.cherry, burnt));
  const yaw = opts.yaw || 0;
  const drop = burnt ? S.R - 0.17 : 0;
  const m = placement(x, z, rot, yaw, -drop);
  put(B, cache.get(key), m);
  // wheels: steered fronts on some cars
  const wkey = burnt ? 'wheel:burnt' : 'wheel';
  if (!cache.has(wkey)) cache.set(wkey, wheelParts(C, S.R, 0.165, burnt ? { noTyre: true, rust: true } : {}));
  const steer = opts.steer || 0;
  for (const [wx, s] of [[S.WB, 1], [S.WB, -1], [-S.WB, 1], [-S.WB, -1]]) {
    const wm = new THREE.Matrix4().compose(V(wx, burnt ? 0.17 + drop : S.R, s * (S.W / 2 - 0.115)), new THREE.Quaternion().setFromEuler(new THREE.Euler(burnt ? 0.08 * s : 0, (wx > 0 ? steer : 0) + (s < 0 ? Math.PI : 0), 0, 'YXZ')), V(1, 1, 1));
    put(B, cache.get(wkey), m.clone().multiply(wm));
  }
  if (!burnt) {
    // licence plates (front under the bumper, rear between the lamps)
    const pm = plateMaterial(B.M);
    for (const [px, py, ry] of [[S.L + 0.045, 0.305, Math.PI / 2], [-S.L - 0.012, 0.67, -Math.PI / 2]]) {
      const g = new THREE.PlaneGeometry(0.52, 0.112);
      g.rotateY(ry); g.translate(px, py, 0);
      g.applyMatrix4(m);
      B.geo(pm, g);
    }
  }
  collide(B, x, z, rot, S.L + 0.1, S.W / 2, 0.05, 0.92);
  collide(B, x, z, rot, 0.5, S.W / 2 - 0.1, 0.92, 1.44);
}

function ensureExtras(C) {
  if (C.gap) return;
  C.gap = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.9, name: 'car_gap' });
  C.underDS = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.95, side: THREE.DoubleSide, name: 'car_underDS' });
  C.headliner = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.95, name: 'car_headliner' });
  C.cabinDark = new THREE.MeshStandardMaterial({ color: 0x0e0d0c, roughness: 0.9, name: 'car_cabinDark' });
  C.rust = C.burntShell;
}

// --- minibus (RAF-style) ---------------------------------------------------------------------
export function minibus(B, mats, x, z, rot, paintKey = 'ivory', opts = {}) {
  const C = mats.car;
  ensureExtras(C);
  const key = 'minibus:' + paintKey;
  if (!cache.has(key)) cache.set(key, minibusBody(C, C.paint[paintKey] || C.paint.ivory, C.paint.cherry));
  const m = placement(x, z, rot, opts.yaw || 0);
  put(B, cache.get(key), m);
  const R = 0.33;
  if (!cache.has('wheel:bus')) cache.set('wheel:bus', wheelParts(C, R, 0.19, {}));
  for (const [wx, s] of [[1.45, 1], [1.45, -1], [-1.25, 1], [-1.25, -1]]) {
    const wm = new THREE.Matrix4().compose(V(wx, R, s * 0.8), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s < 0 ? Math.PI : 0, 0)), V(1, 1, 1));
    put(B, cache.get('wheel:bus'), m.clone().multiply(wm));
  }
  const pm = plateMaterial(B.M);
  for (const [px, py, ry] of [[2.47, 0.36, Math.PI / 2], [-2.47, 0.5, -Math.PI / 2]]) {
    const g = new THREE.PlaneGeometry(0.52, 0.112);
    g.rotateY(ry); g.translate(px, py, 0); g.applyMatrix4(m);
    B.geo(pm, g);
  }
  collide(B, x, z, rot, 2.5, 0.98, 0.05, 2.2);
}

function minibusBody(C, paint, stripe) {
  const P = new Parts();
  const L = 2.45, W = 1.96, HW = W / 2, BEV = 0.08, BT = 0.09, R = 0.33, AR = 0.4, e = BEV;
  const sh = new THREE.Shape();
  sh.moveTo(-L + e, 0.3 + e);
  sh.lineTo(-1.25 - AR - e, 0.3 + e);
  sh.absarc(-1.25, R, AR + e, Math.PI, 0, true);
  sh.lineTo(1.45 - AR - e, 0.3 + e);
  sh.absarc(1.45, R, AR + e, Math.PI, 0, true);
  sh.lineTo(L - e, 0.3 + e);
  sh.lineTo(L - e, 0.95);
  sh.lineTo(L - 0.12, 1.15);
  sh.lineTo(L - 0.62, 1.92);
  sh.lineTo(L - 0.9, 2.12 - e);
  sh.lineTo(-L + 0.1, 2.14 - e);
  sh.lineTo(-L + e, 2.0);
  const depth = W - BT * 2;
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: BT, bevelSize: BEV, bevelSegments: 4, curveSegments: 14 });
  g.translate(0, 0, -depth / 2);
  P.add(paint, g);
  // two-tone stripe and side windows (glass set just proud, with rubber surrounds)
  for (const s of [-1, 1]) {
    const z = s * (HW + 0.002);
    P.add(stripe, box(-L + 0.1, 0.9, z - 0.004, L - 0.1, 1.0, z + 0.004));
    const wins = [[-2.25, -1.45], [-1.35, -0.55], [-0.45, 0.35], [0.45, 1.2]];
    for (const [a, b] of wins) {
      const gl = new THREE.PlaneGeometry(b - a, 0.62);
      if (s < 0) gl.rotateY(Math.PI);
      gl.translate((a + b) / 2, 1.5, z + s * 0.004);
      P.add(C.glass, gl);
      const back = new THREE.PlaneGeometry(b - a, 0.62);
      if (s < 0) back.rotateY(Math.PI);
      back.translate((a + b) / 2, 1.5, z + s * 0.002);
      P.add(C.cabinDark, back);
      P.add(C.rubber, line([V(a, 1.19, z), V(b, 1.19, z), V(b, 1.81, z), V(a, 1.81, z), V(a, 1.19, z)], V(0, 0, s), 0.025, 0.006));
    }
    // sliding door and its rail, cab door
    P.add(C.gap, line([V(0.37, 1.9, z), V(0.37, 0.32, z)], V(0, 0, s)));
    P.add(C.gap, line([V(-0.5, 1.9, z), V(-0.5, 0.32, z)], V(0, 0, s)));
    P.add(C.gap, line([V(1.25, 1.95, z), V(1.25, 0.82, z)], V(0, 0, s)));
    P.add(C.blackTrim, box(-0.55, 1.92, z - 0.02, 0.4, 1.95, z + 0.02));
    P.add(C.chrome, box(0.25, 1.05, z - 0.01, 0.33, 1.08, z + s * 0.02));
    for (const ax of [-1.25, 1.45]) {
      const liner = new THREE.CylinderGeometry(AR + 0.004, AR + 0.004, 0.36, 20, 1, true, Math.PI / 2, Math.PI);
      liner.rotateX(Math.PI / 2);
      liner.translate(ax, R, s * (HW - 0.2));
      P.add(C.underDS, liner);
    }
  }
  // raked windscreen split by a pillar, round headlamps in chrome rings, grille slots
  const wsN = V(1.92 - 1.15, (L - 0.12) - (L - 0.62), 0).normalize();
  const wsq = quad(V(L - 0.1, 1.17, -HW + 0.08), V(L - 0.1, 1.17, HW - 0.08), V(L - 0.6, 1.92, HW - 0.12), V(L - 0.6, 1.92, -HW + 0.12), wsN);
  const wsb = wsq.clone();
  wsq.translate(wsN.x * (BEV + 0.006), wsN.y * (BEV + 0.006), 0);
  wsb.translate(wsN.x * (BEV + 0.003), wsN.y * (BEV + 0.003), 0);
  P.add(C.windscreen, wsq);
  P.add(C.cabinDark, wsb);
  const wo = wsN.clone().multiplyScalar(BEV);
  P.add(paint, strip(V(L - 0.1, 1.17, 0).add(wo), V(L - 0.6, 1.92, 0).add(wo), wsN, 0.07, 0.015));
  for (const zz of [-1, 1]) P.add(C.rubber, strip(V(L - 0.1, 1.17, zz * (HW - 0.08)).add(wo), V(L - 0.6, 1.92, zz * (HW - 0.12)).add(wo), wsN, 0.03, 0.01));
  P.add(C.rubber, strip(V(L - 0.1, 1.17, -HW + 0.08).add(wo), V(L - 0.1, 1.17, HW - 0.08).add(wo), wsN, 0.03, 0.01));
  P.add(C.rubber, strip(V(L - 0.6, 1.92, -HW + 0.12).add(wo), V(L - 0.6, 1.92, HW - 0.12).add(wo), wsN, 0.03, 0.01));
  for (const wz of [-0.5, 0.2]) P.add(C.blackTrim, strip(V(L - 0.08, 1.2, wz).add(wo), V(L - 0.36, 1.62, wz + 0.25).add(wo), wsN, 0.012, 0.014));
  for (const s of [-1, 1]) {
    const hz = s * 0.68;
    P.add(C.chrome, new THREE.TorusGeometry(0.1, 0.014, 8, 24).rotateY(Math.PI / 2).translate(L + 0.003, 0.75, hz));
    const bowl = new THREE.SphereGeometry(0.095, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    bowl.rotateZ(Math.PI / 2); bowl.translate(L + 0.0, 0.75, hz);
    P.add(C.reflector, flipFaces(bowl));
    const lens = new THREE.CircleGeometry(0.094, 24);
    lens.rotateY(Math.PI / 2); lens.translate(L + 0.012, 0.75, hz);
    P.add(C.lens, lens);
    P.add(C.amber, box(L - 0.01, 0.56, hz - 0.06, L + 0.015, 0.6, hz + 0.06, 0.006));
    P.add(C.tail, box(-L - 0.012, 0.8, hz - 0.08, -L + 0.004, 0.95, hz + 0.08, 0.006));
    P.add(C.amber, box(-L - 0.012, 0.96, hz - 0.08, -L + 0.004, 1.02, hz + 0.08, 0.006));
  }
  for (let k = 0; k < 5; k++) P.add(C.blackTrim, box(L - 0.01, 0.6 + k * 0.05, -0.42, L + 0.006, 0.625 + k * 0.05, 0.42));
  // rear door window
  const rw = new THREE.PlaneGeometry(W - 0.5, 0.55);
  rw.rotateY(-Math.PI / 2);
  const rwb = rw.clone();
  rw.translate(-L - 0.004, 1.55, 0); rwb.translate(-L - 0.002, 1.55, 0);
  P.add(C.glass, rw); P.add(C.cabinDark, rwb);
  P.add(C.gap, line([V(-L - 0.002, 0.35, 0), V(-L - 0.002, 1.95, 0)], V(-1, 0, 0)));
  for (const xx of [L, -L]) {
    const bp = roundedBox(0.08, 0.13, W + 0.02, 0.03, 3);
    bp.translate(xx + Math.sign(xx) * 0.04, 0.42, 0);
    P.add(C.chrome, bp);
  }
  P.add(C.under, box(-L + 0.1, 0.26, -HW + 0.1, L - 0.1, 0.32, HW - 0.1));
  // interior glimpsed through the glass: bench seats and a dark cabin
  P.add(C.carpet, box(-L + 0.15, 0.4, -HW + 0.12, L - 0.7, 0.42, HW - 0.12));
  for (let k = 0; k < 3; k++) {
    const sx = -1.9 + k * 0.85;
    P.add(C.seat, box(sx, 0.75, -HW + 0.15, sx + 0.45, 0.85, HW - 0.15, 0.04));
    P.add(C.seat, box(sx - 0.05, 0.85, -HW + 0.15, sx + 0.05, 1.35, HW - 0.15, 0.04));
  }
  P.add(C.headliner, flipFaces(box(-L + 0.1, 2.0, -HW + 0.1, L - 0.8, 2.01, HW - 0.1)));
  for (const s of [-1, 1]) {
    const card = new THREE.PlaneGeometry(4.6, 1.6);
    card.rotateY(s > 0 ? Math.PI : 0);
    card.translate(-0.1, 1.2, s * (HW - 0.09));
    P.add(C.dash, card);
  }
  return P.finish();
}

// --- burnt-out city bus ----------------------------------------------------------------------
export function wreckedBus(B, mats, x, z, rot, opts = {}) {
  const C = mats.car;
  ensureExtras(C);
  if (!cache.has('bus')) cache.set('bus', busBody(C));
  const m = placement(x, z, rot, opts.yaw || 0, -0.12);
  put(B, cache.get('bus'), m);
  if (!cache.has('wheel:busrim')) cache.set('wheel:busrim', wheelParts(C, 0.5, 0.28, { noTyre: true, rust: true }));
  for (const [wx, s] of [[3.9, 1], [3.9, -1], [-3.4, 1], [-3.4, -1]]) {
    const wm = new THREE.Matrix4().compose(V(wx, 0.4, s * 1.05), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s < 0 ? Math.PI : 0, s * 0.05)), V(1, 1, 1));
    put(B, cache.get('wheel:busrim'), m.clone().multiply(wm));
  }
  collide(B, x, z, rot, 5.6, 1.25, 0.1, 3.0);
}

function busBody(C) {
  const P = new Parts();
  const L = 5.6, W = 2.5, HW = W / 2, t = 0.05;
  const shell = C.rust, ch = C.char;
  // floor, roof (partly collapsed), skirts
  P.add(ch, box(-L, 0.55, -HW, L, 0.62, HW));
  const roof = box(-L, 2.85, -HW, L, 2.95, HW, 0.04);
  const rp = roof.attributes.position;
  for (let i = 0; i < rp.count; i++) { const xx = rp.getX(i); if (xx > -1 && xx < 2.5) rp.setY(i, rp.getY(i) - 0.35 * Math.sin((xx + 1) / 3.5 * Math.PI)); }
  roof.computeVertexNormals();
  P.add(shell, roof);
  for (const s of [-1, 1]) {
    const z0 = s > 0 ? HW - t : -HW, z1 = s > 0 ? HW : -HW + t;
    P.add(shell, box(-L, 0.35, z0, L, 1.35, z1));
    P.add(shell, box(-L, 2.55, z0, L, 2.88, z1));
    // window posts and empty frames
    for (let px = -L; px <= L + 0.01; px += 1.24) P.add(shell, box(px, 1.35, z0 - 0.01, px + 0.1, 2.55, z1 + 0.01));
    P.add(ch, box(-L, 1.3, z0 - 0.015, L, 1.36, z1 + 0.015));
    for (const ax of [-3.4, 3.9]) {
      const liner = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 20, 1, true, Math.PI / 2, Math.PI);
      liner.rotateX(Math.PI / 2);
      liner.translate(ax, 0.4, s * (HW - 0.27));
      P.add(C.underDS, liner);
    }
  }
  // ends: windscreen frame and rear engine bay
  for (const [xx, d] of [[L, 1], [-L, -1]]) {
    P.add(shell, box(xx - d * t, 0.35, -HW, xx, 1.1, HW));
    for (const zz of [-HW + 0.06, 0, HW - 0.06]) P.add(shell, box(xx - 0.08, 1.1, zz - 0.05, xx, 2.88, zz + 0.05));
    P.add(shell, box(xx - 0.08, 2.5, -HW, xx, 2.88, HW));
  }
  // charred seat frames
  for (let k = 0; k < 8; k++) {
    const sx = -4.6 + k * 1.2;
    for (const s of [-1, 1]) {
      P.add(ch, box(sx, 0.62, s * 0.75 - 0.42, sx + 0.06, 1.05, s * 0.75 + 0.42));
      P.add(ch, box(sx - 0.38, 0.95, s * 0.75 - 0.42, sx, 1.0, s * 0.75 + 0.42));
      P.add(C.rust, box(sx - 0.3, 1.0, s * 0.75 - 0.4, sx - 0.28, 1.6, s * 0.75 + 0.4));
    }
  }
  // grab rails
  for (const s of [-1, 1]) P.add(C.rust, cyl(0.018, 0.018, L * 2 - 0.4, 6, 'x').translate(0, 2.4, s * 0.35));
  return P.finish();
}
