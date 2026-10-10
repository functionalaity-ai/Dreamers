// Operator body: one skinned geometry built in the rest pose (standing, arms down, facing -Z).
// Torso, arms and legs are lofted tubes whose vertices blend between the bones on either side of
// a joint, so elbows, knees, hips and the waist bend instead of hinging. Kit is laid over them:
// a wrap-around plate carrier with MOLLE rows, shoulder straps and pouches, a battle belt, a
// high-cut helmet with rails, shroud and headset, gloves shaped round the grip and handguard,
// knee pads, cargo pockets, a drop-leg holster and boots.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedBox } from '../core/geometry.js';

// Texture atlas quadrants (characterAtlas): camouflage, plain fabric, skin, rubber/leather.
const REGION = { camo: [0, 0.5], fabric: [0.5, 0.5], skin: [0, 0], rubber: [0.5, 0] };

// Gear tints per faction (sRGB).
const KIT = {
  msg: { gear: [0.6, 0.53, 0.4], helmet: 'camo', dark: [0.2, 0.18, 0.15], boots: [0.4, 0.31, 0.22], patch: [0.3, 0.36, 0.5], belt: [0.42, 0.37, 0.28] },
  volk: { gear: [0.2, 0.22, 0.21], helmet: 'fabric', dark: [0.11, 0.11, 0.11], boots: [0.1, 0.1, 0.1], patch: [0.5, 0.16, 0.13], belt: [0.15, 0.15, 0.15] },
};
const SKIN = [[0.86, 0.68, 0.56], [0.72, 0.53, 0.4], [0.55, 0.38, 0.27], [0.92, 0.76, 0.64], [0.42, 0.29, 0.21]];

// The right eye in the head bone's frame (the hold puts it on the sight line).
export const EYE = [0.034, 0.088, -0.09];

const smooth = (y, y0, y1) => { const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0))); return t * t * (3 - 2 * t); };
const shade = (c, k) => c.map((v) => v * k);

class PartBuilder {
  constructor() { this.geos = []; }
  // weights(x, y, z) → [[bone, w], ...] in the rest pose; without it the part is rigid on `bone`.
  add(geo, bone, region, color, at, weights) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (at) g.translate(at[0], at[1], at[2]);
    const pos = g.attributes.position;
    const n = pos.count;
    const uv = g.attributes.uv;
    const off = REGION[region] || REGION.fabric;
    for (let i = 0; i < n; i++) uv.setXY(i, (uv.getX(i) % 1) * 0.49 + off[0] + 0.005, (uv.getY(i) % 1) * 0.49 + off[1] + 0.005);
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const lin = color.map((c) => Math.pow(c, 2.2)); // colours are authored in sRGB
    for (let i = 0; i < n; i++) {
      col[i * 3] = lin[0]; col[i * 3 + 1] = lin[1]; col[i * 3 + 2] = lin[2];
      if (!weights) { si[i * 4] = bone; sw[i * 4] = 1; continue; }
      const ws = weights(pos.getX(i), pos.getY(i), pos.getZ(i)).filter((e) => e[1] > 1e-4).slice(0, 4);
      const tot = ws.reduce((s, e) => s + e[1], 0) || 1;
      ws.forEach((e, k) => { si[i * 4 + k] = e[0]; sw[i * 4 + k] = e[1] / tot; });
      if (!ws.length) { si[i * 4] = bone; sw[i * 4] = 1; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.geos.push(g);
  }
  build() { return mergeGeometries(this.geos, false); }
}

const se = (c, n) => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);

// A closed tube along Y through super-elliptic rings [y, rx, rz, cx, cz]; n = 2 is an ellipse,
// larger n squares the section off. UVs stay inside [0, 1) so they map into one atlas quadrant.
function loft(rings, seg, n = 2, capTop = false, capBottom = false) {
  rings = rings.slice().sort((a, b) => a[0] - b[0]);
  const pos = [], uv = [], idx = [];
  const cols = seg + 1;
  const vs = [0];
  for (let i = 1; i < rings.length; i++) vs.push(vs[i - 1] + Math.hypot(rings[i][0] - rings[i - 1][0], rings[i][1] - rings[i - 1][1]));
  const len = vs[vs.length - 1] || 1;
  rings.forEach((rg, i) => {
    const [y, rx, rz, cx = 0, cz = 0] = rg;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(cx + rx * se(Math.cos(a), n), y, cz + rz * se(Math.sin(a), n));
      uv.push((j / seg) * 0.98, (vs[i] / len) * 0.98);
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the seam's shading
  const nr = g.attributes.normal;
  for (let i = 0; i < rings.length; i++) {
    const a = i * cols, b = a + seg;
    const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nr.setXYZ(a, x / l, y / l, z / l); nr.setXYZ(b, x / l, y / l, z / l);
  }
  const parts = [g];
  const cap = (rg, up) => {
    const [y, rx, rz, cx = 0, cz = 0] = rg;
    const c = new THREE.CircleGeometry(1, seg);
    c.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    const p = c.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), pz = p.getZ(i), r = Math.hypot(px, pz);
      const a = Math.atan2(pz, px);
      p.setXYZ(i, cx + rx * r * se(Math.cos(a), n), y, cz + rz * r * se(Math.sin(a), n));
    }
    const u = c.attributes.uv;
    for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 0.98, u.getY(i) * 0.98);
    parts.push(c);
  };
  if (capTop) cap(rings[rings.length - 1], true);
  if (capBottom) cap(rings[0], false);
  return parts.length > 1 ? mergeGeometries(parts.map((p) => p.index ? p.toNonIndexed() : p), false) : g;
}

// A sheet over (u, v) ∈ [0, 1]²; fn(u, v) → [x, y, z]. `flip` reverses the facing.
function sheet(fn, nu, nv, flip = false) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nv; i++) {
    for (let j = 0; j <= nu; j++) {
      pos.push(...fn(j / nu, i / nv));
      uv.push((j / nu) * 0.98, (i / nv) * 0.98);
    }
  }
  const cols = nu + 1;
  for (let i = 0; i < nv; i++) {
    for (let j = 0; j < nu; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A flat strap of width w (along `side`) and thickness t swept through points.
function strap(points, side, w, t) {
  const segs = [];
  const sd = side.clone().normalize();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = a.distanceTo(b);
    const box = new THREE.BoxGeometry(w, t, len + t * 0.6);
    const dir = b.clone().sub(a).normalize();
    const up = new THREE.Vector3().crossVectors(dir, sd).normalize();
    const m = new THREE.Matrix4().makeBasis(sd, up, dir).setPosition(a.clone().add(b).multiplyScalar(0.5));
    box.applyMatrix4(m);
    segs.push(box);
  }
  return mergeGeometries(segs, false);
}

// A finger: a tube along a curve with a rounded tip.
function finger(pts, r) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const tube = new THREE.TubeGeometry(curve, 6, r, 5, false);
  const tip = new THREE.SphereGeometry(r, 5, 3);
  tip.translate(...pts[pts.length - 1]);
  const root = new THREE.SphereGeometry(r * 1.05, 5, 3);
  root.translate(...pts[0]);
  return mergeGeometries([tube.toNonIndexed(), tip.toNonIndexed(), root.toNonIndexed()], false);
}

function rb(w, h, d, r = 0.01, seg = 1) { return roundedBox(w, h, d, r, seg); }
function cyl(r0, r1, h, seg = 12) { return new THREE.CylinderGeometry(r1, r0, h, seg); }

// Torso sections [y, rx, rz, cx, cz] (+z is the back).
const TORSO = [
  [0.84, 0.15, 0.105, 0, 0.004],
  [0.9, 0.172, 0.118, 0, 0.012],
  [0.97, 0.168, 0.112, 0, 0.007],
  [1.04, 0.158, 0.104, 0, 0.0],
  [1.11, 0.152, 0.101, 0, -0.003],
  [1.19, 0.161, 0.109, 0, -0.007],
  [1.28, 0.175, 0.12, 0, -0.009],
  [1.37, 0.181, 0.121, 0, -0.007],
  [1.43, 0.174, 0.112, 0, -0.001],
  [1.48, 0.145, 0.095, 0, 0.005],
  [1.515, 0.095, 0.075, 0, 0.008],
  [1.54, 0.058, 0.055, 0, 0.01],
];
const TORSO_N = 2.5;
function torsoAt(y) {
  const R = TORSO;
  if (y <= R[0][0]) return R[0];
  for (let i = 1; i < R.length; i++) {
    if (y <= R[i][0]) {
      const t = (y - R[i - 1][0]) / (R[i][0] - R[i - 1][0]);
      return R[i].map((v, k) => R[i - 1][k] + (v - R[i - 1][k]) * t);
    }
  }
  return R[R.length - 1];
}
// A point on a shell `off` metres outside the torso at height y and angle a (super-ellipse n).
function aroundTorso(y, a, off, n = TORSO_N) {
  const [, rx, rz, cx, cz] = torsoAt(y);
  return [cx + (rx + off) * se(Math.cos(a), n), y, cz + (rz + off) * se(Math.sin(a), n)];
}
// z of that shell's front (or back, sgn = 1) at x.
function shellZ(x, y, off, sgn, n) {
  const [, rx, rz, , cz] = torsoAt(y);
  const a = rx + off;
  const k = Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(x) / a), n));
  return cz + sgn * (rz + off) * Math.pow(k, 1 / n);
}

export function buildBody(faction, seed, B, R, rnd) {
  const kit = KIT[faction];
  const skin = SKIN[Math.floor(rnd() * SKIN.length)];
  const W = [1, 1, 1];
  const P = new PartBuilder();
  const at = (bone, dx = 0, dy = 0, dz = 0) => [R[bone].x + dx, R[bone].y + dy, R[bone].z + dz];
  const torsoW = (x, y) => {
    if (y < 1.12) { const t = smooth(y, 0.98, 1.07); return [[B.hips, 1 - t], [B.spine, t]]; }
    if (y < 1.47) { const t = smooth(y, 1.17, 1.27); return [[B.spine, 1 - t], [B.chest, t]]; }
    const t = smooth(y, 1.5, 1.56); return [[B.chest, 1 - t], [B.neck, t]];
  };
  const gearW = (x, y) => torsoW(x, Math.min(y, 1.46));

  // --- Torso: combat shirt over trousers, one smooth loft from the seat to the collar ---
  P.add(loft(TORSO, 24, TORSO_N, false, true), B.hips, 'camo', W, null, torsoW);
  P.add(loft([[1.5, 0.064, 0.064, 0, 0.012], [1.545, 0.062, 0.062, 0, 0.01], [1.565, 0.055, 0.056, 0, 0.008]], 16), B.chest, 'camo', shade(W, 0.9), null, torsoW);
  // Neck and head
  P.add(loft([[1.5, 0.054, 0.056, 0, 0.012], [1.57, 0.051, 0.053, 0, 0.006], [1.64, 0.05, 0.052, 0, -0.002]], 12), B.neck, 'skin', skin, null,
    (x, y) => { const t = smooth(y, 1.6, 1.64); const c = 1 - smooth(y, 1.5, 1.55); return [[B.chest, c], [B.neck, (1 - c) * (1 - t)], [B.head, t]]; });
  const head = new THREE.SphereGeometry(0.1, 18, 14);
  head.scale(0.88, 1.08, 1.0);
  P.add(head, B.head, 'skin', skin, at(B.head, 0, 0.085, 0.0));
  const jaw = new THREE.SphereGeometry(0.072, 14, 10);
  jaw.scale(0.95, 0.78, 1.0);
  P.add(jaw, B.head, 'skin', skin, at(B.head, 0, 0.03, -0.026));
  P.add(rb(0.15, 0.02, 0.03, 0.008), B.head, 'skin', shade(skin, 0.9), at(B.head, 0, 0.108, -0.086));
  for (const sx of [-0.034, 0.034]) P.add(new THREE.SphereGeometry(0.011, 8, 6), B.head, 'rubber', [0.08, 0.07, 0.06], at(B.head, sx, 0.088, -0.09));
  const covered = faction === 'volk' ? rnd() < 0.7 : rnd() < 0.25;
  if (!covered) P.add(rb(0.024, 0.042, 0.028, 0.008), B.head, 'skin', skin, at(B.head, 0, 0.066, -0.1));
  if (covered) {
    const bal = new THREE.SphereGeometry(0.104, 18, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55);
    bal.scale(0.92, 1.12, 1.02);
    P.add(bal, B.head, 'fabric', kit.dark, at(B.head, 0, 0.07, -0.006));
  } else if (rnd() < 0.6) {
    // a short beard along the jaw
    const beard = new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, Math.PI * 0.64, Math.PI * 0.36);
    beard.scale(0.86, 0.92, 0.98);
    const hair = [[0.3, 0.22, 0.15], [0.22, 0.17, 0.12], [0.36, 0.3, 0.24]][Math.floor(rnd() * 3)];
    P.add(beard, B.head, 'fabric', hair, at(B.head, 0, 0.07, -0.014));
  }
  // Wrap-around eye protection
  const glasses = new THREE.CylinderGeometry(0.101, 0.101, 0.03, 14, 1, true, Math.PI - 0.95, 1.9);
  glasses.scale(0.95, 1, 1.06);
  P.add(glasses, B.head, 'rubber', [0.05, 0.055, 0.06], at(B.head, 0, 0.09, -0.002));
  // High-cut helmet: shell, cut-away skirt, side rails, NVG shroud, counterweight, Velcro
  const hreg = kit.helmet === 'camo' ? 'camo' : 'fabric';
  const hcol = kit.helmet === 'camo' ? W : [0.24, 0.25, 0.24];
  const shell = new THREE.SphereGeometry(0.12, 22, 9, 0, Math.PI * 2, 0, Math.PI * 0.47);
  shell.scale(0.98, 0.92, 1.08);
  P.add(shell, B.head, hreg, hcol, at(B.head, 0, 0.1, 0.006));
  P.add(new THREE.CylinderGeometry(0.118, 0.121, 0.018, 22, 1, true).scale(0.98, 1, 1.08), B.head, hreg, shade(hcol, 0.85), at(B.head, 0, 0.104, 0.006));
  for (const sx of [-1, 1]) {
    P.add(rb(0.011, 0.03, 0.12, 0.004), B.head, 'rubber', kit.dark, at(B.head, sx * 0.121, 0.118, 0.004));
    for (const z of [-0.035, 0.0, 0.035]) P.add(new THREE.BoxGeometry(0.004, 0.022, 0.012), B.head, 'rubber', shade(kit.dark, 0.8), at(B.head, sx * 0.1275, 0.118, z));
    // headset ear cup, ring and band
    P.add(cyl(0.037, 0.037, 0.03, 16).rotateZ(Math.PI / 2), B.head, 'rubber', [0.13, 0.13, 0.12], at(B.head, sx * 0.104, 0.066, 0.006));
    P.add(cyl(0.03, 0.03, 0.012, 14).rotateZ(Math.PI / 2), B.head, 'rubber', [0.07, 0.07, 0.07], at(B.head, sx * 0.124, 0.066, 0.006));
  }
  P.add(rb(0.052, 0.034, 0.024, 0.006), B.head, 'rubber', [0.1, 0.1, 0.1], at(B.head, 0, 0.168, -0.118));
  P.add(rb(0.03, 0.018, 0.012, 0.004), B.head, 'rubber', [0.16, 0.16, 0.16], at(B.head, 0, 0.15, -0.13));
  P.add(rb(0.075, 0.05, 0.035, 0.012), B.head, 'fabric', kit.gear, at(B.head, 0, 0.12, 0.128));
  P.add(rb(0.07, 0.008, 0.11, 0.003), B.head, 'fabric', shade(kit.gear, 0.8), at(B.head, 0, 0.212, 0.0));
  {
    // boom mic from the left cup to the mouth
    const a = new THREE.Vector3(-0.112, 0.062, -0.015), b = new THREE.Vector3(-0.045, 0.04, -0.105);
    const m = cyl(0.003, 0.003, a.distanceTo(b), 6);
    m.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())));
    m.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    P.add(m, B.head, 'rubber', [0.06, 0.06, 0.06], at(B.head));
    P.add(new THREE.SphereGeometry(0.009, 8, 6), B.head, 'rubber', [0.05, 0.05, 0.05], at(B.head, b.x, b.y, b.z));
    // chin strap
    const cs = new THREE.TorusGeometry(0.086, 0.004, 4, 16, Math.PI);
    cs.rotateZ(Math.PI);
    cs.rotateX(0.45);
    P.add(cs, B.head, 'rubber', kit.dark, at(B.head, 0, 0.05, -0.02));
  }

  // --- Plate carrier: plates front and back, cummerbund round the sides ---
  const T = 0.03, VN = 3.2;
  const side = (a) => Math.pow(Math.cos(a), 2);
  const vTop = (a) => 1.44 - 0.085 * side(a), vBot = (a) => 1.13 + 0.035 * side(a);
  const vest = sheet((u, v) => { const a = u * Math.PI * 2; return aroundTorso(vBot(a) + (vTop(a) - vBot(a)) * v, a, T, VN); }, 40, 5);
  P.add(vest, B.chest, 'fabric', kit.gear, null, gearW);
  // edge binding: rims from the shell back to the shirt, top and bottom
  for (const top of [true, false]) {
    const rim = sheet((u, v) => {
      const a = u * Math.PI * 2, y = top ? vTop(a) : vBot(a);
      const o = aroundTorso(y, a, T, VN), i = aroundTorso(y, a, 0.003);
      return [o[0] + (i[0] - o[0]) * v, y, o[2] + (i[2] - o[2]) * v];
    }, 40, 1, !top);
    P.add(rim, B.chest, 'fabric', shade(kit.gear, 0.78), null, gearW);
  }
  // MOLLE webbing rows round the cummerbund and back
  for (let k = 0; k < 4; k++) {
    const y0 = 1.17 + k * 0.04;
    const band = sheet((u, v) => { const a = -0.75 + u * (Math.PI + 1.5); return aroundTorso(y0 + v * 0.02, a, T + 0.004, VN); }, 20, 1);
    P.add(band, B.chest, 'fabric', shade(kit.gear, 0.86), null, gearW);
  }
  // shoulder straps over the trapezius
  for (const sx of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI;
      pts.push(new THREE.Vector3(sx * 0.098, 1.425 + Math.cos(a) * 0.112, Math.sin(a) * 0.142));
    }
    P.add(strap(pts, new THREE.Vector3(1, 0, 0), 0.066, 0.012), B.chest, 'fabric', shade(kit.gear, 0.9), null, gearW);
  }
  // front: three rifle magazine pouches with mags showing, an admin pouch and a name tape
  const front = (x, y, d) => shellZ(x, y, T, -1, VN) - d / 2;
  for (let i = 0; i < 3; i++) {
    const x = -0.084 + i * 0.084, y = 1.215;
    P.add(rb(0.078, 0.12, 0.044, 0.012), B.chest, 'fabric', shade(kit.gear, 0.95), [x, y, front(x, y, 0.044)], gearW);
    P.add(rb(0.066, 0.034, 0.024, 0.006), B.chest, 'rubber', [0.12, 0.12, 0.11], [x, y + 0.072, front(x, y + 0.07, 0.024) + 0.006], gearW);
    P.add(rb(0.07, 0.012, 0.05, 0.004), B.chest, 'rubber', kit.dark, [x, y + 0.045, front(x, y, 0.05) - 0.002], gearW);
  }
  P.add(rb(0.17, 0.064, 0.028, 0.01), B.chest, 'fabric', shade(kit.gear, 0.92), [0, 1.345, front(0, 1.345, 0.028)], gearW);
  P.add(rb(0.09, 0.022, 0.006, 0.002), B.chest, 'fabric', kit.patch, [0, 1.35, front(0, 1.35, 0.006) - 0.028], gearW);
  // left side: radio with antenna; right side: grenade pouch
  {
    const [, rx, , cx] = torsoAt(1.25);
    P.add(rb(0.046, 0.125, 0.072, 0.012), B.chest, 'fabric', shade(kit.gear, 0.9), [cx - rx - T - 0.022, 1.25, 0.035], gearW);
    P.add(rb(0.03, 0.03, 0.05, 0.006), B.chest, 'rubber', [0.1, 0.1, 0.1], [cx - rx - T - 0.022, 1.325, 0.035], gearW);
    const ant = cyl(0.0035, 0.0025, 0.24, 6);
    ant.translate(cx - rx - T - 0.026, 1.46, 0.05);
    P.add(ant, B.chest, 'rubber', [0.06, 0.06, 0.06], null, gearW);
    P.add(cyl(0.03, 0.03, 0.085, 12), B.chest, 'fabric', shade(kit.gear, 0.9), [cx + rx + T + 0.026, 1.2, -0.04], gearW);
    P.add(new THREE.SphereGeometry(0.024, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), B.chest, 'rubber', [0.22, 0.25, 0.18], [cx + rx + T + 0.026, 1.242, -0.04], gearW);
    // tourniquet on the left strap
    P.add(rb(0.024, 0.075, 0.03, 0.006), B.chest, 'rubber', [0.08, 0.08, 0.08], [-0.1, 1.43, front(-0.1, 1.43, 0.03) - 0.006], gearW);
  }
  // back: hydration carrier or a med pouch
  if (rnd() < 0.7) P.add(rb(0.25, 0.3, 0.062, 0.028, 2), B.chest, 'fabric', shade(kit.gear, 0.88), [0, 1.285, shellZ(0, 1.285, T, 1, VN) + 0.03], gearW);
  else P.add(rb(0.16, 0.1, 0.05, 0.016), B.chest, 'fabric', shade(kit.gear, 0.9), [0, 1.2, shellZ(0, 1.2, T, 1, VN) + 0.024], gearW);

  // --- Battle belt with buckle and a dump pouch ---
  const belt = sheet((u, v) => aroundTorso(0.985 + v * 0.058, u * Math.PI * 2, 0.013), 32, 1);
  P.add(belt, B.hips, 'fabric', kit.belt, null, torsoW);
  for (const top of [true, false]) {
    const y = top ? 1.043 : 0.985;
    P.add(sheet((u, v) => { const o = aroundTorso(y, u * Math.PI * 2, 0.013), i = aroundTorso(y, u * Math.PI * 2, 0.002); return [o[0] + (i[0] - o[0]) * v, y, o[2] + (i[2] - o[2]) * v]; }, 32, 1, !top),
      B.hips, 'fabric', shade(kit.belt, 0.8), null, torsoW);
  }
  P.add(rb(0.064, 0.046, 0.014, 0.005), B.hips, 'rubber', [0.1, 0.1, 0.1], [0, 1.014, shellZ(0, 1.014, 0.013, -1, TORSO_N) - 0.006], torsoW);
  P.add(rb(0.1, 0.1, 0.06, 0.02), B.hips, 'fabric', shade(kit.gear, 0.85), [-0.11, 0.975, shellZ(-0.11, 0.99, 0.013, 1, TORSO_N) + 0.026], torsoW);

  // --- Arms: sleeves bending at the elbow, shoulder patches, glove cuffs, gloved fists ---
  for (const [sd, sx] of [['L', -1], ['R', 1]]) {
    const arm = B['arm' + sd], fore = B['fore' + sd], hand = B['hand' + sd];
    const S = R[arm], X = S.x;
    const E = R[fore].y - S.y, H = R[hand].y - S.y; // elbow and palm, below the shoulder
    const rings = [
      [0.065, 0.02, 0.02, 0.005], [0.052, 0.045, 0.047, 0.007], [0.022, 0.06, 0.063, 0.007], [-0.032, 0.06, 0.06, 0.004],
      [-0.118, 0.053, 0.055, 0], [-0.214, 0.049, 0.051, 0], [E + 0.021, 0.046, 0.048, 0], [E - 0.022, 0.046, 0.049, 0],
      [E - 0.1, 0.047, 0.048, 0], [H + 0.1, 0.041, 0.039, 0], [H + 0.033, 0.036, 0.034, 0],
    ].map(([y, rx, rz, cx]) => [S.y + y, rx, rz, X + sx * cx, 0]);
    P.add(loft(rings, 12, 2, true), arm, 'camo', W, null, (x, y) => {
      const t = smooth(y, S.y + E - 0.055, S.y + E + 0.052);
      const c = smooth(y, S.y, S.y + 0.07) * 0.3;
      return [[B.chest, c], [arm, t * (1 - c)], [fore, (1 - t) * (1 - c)]];
    });
    P.add(rb(0.006, 0.05, 0.07, 0.002), arm, 'fabric', kit.patch, [X + sx * 0.057, S.y - 0.096, 0]);
    P.add(loft([[S.y + H + 0.05, 0.041, 0.039], [S.y + H + 0.002, 0.041, 0.039], [S.y + H - 0.012, 0.034, 0.033]].map((r) => [r[0], r[1], r[2], X, 0]), 12), fore, 'rubber', kit.dark);
    hand_(P, hand, at(hand), sx, kit);
  }

  // --- Legs: trousers bending at hip and knee, pads, cargo pockets, boots ---
  for (const [sd, sx] of [['L', -1], ['R', 1]]) {
    const th = B['thigh' + sd], sh = B['shin' + sd], ft = B['foot' + sd];
    const H = R[th], X = H.x;
    const rings = [
      [0.075, 0.085, 0.09, 0.004, 0], [0.02, 0.102, 0.11, 0.006, 0.008], [-0.06, 0.098, 0.104, 0.006, 0.004], [-0.16, 0.088, 0.092, 0.004, 0],
      [-0.28, 0.077, 0.08, 0.002, -0.004], [-0.38, 0.066, 0.068, 0, -0.006], [-0.43, 0.062, 0.064, 0, -0.004], [-0.5, 0.062, 0.066, 0, 0.004],
      [-0.6, 0.06, 0.066, 0, 0.012], [-0.7, 0.052, 0.055, 0, 0.006], [-0.78, 0.047, 0.05, 0, 0.002],
    ].map(([y, rx, rz, cx, cz]) => [H.y + y, rx, rz, X + sx * cx, cz]);
    P.add(loft(rings, 14, 2.2), th, 'camo', W, null, (x, y) => {
      const t = smooth(y, H.y - 0.48, H.y - 0.38);
      const hp = smooth(y, H.y - 0.06, H.y + 0.06) * 0.55;
      return [[B.hips, hp], [th, t * (1 - hp)], [sh, (1 - t) * (1 - hp)]];
    });
    // knee pad and its strap
    P.add(rb(0.1, 0.125, 0.042, 0.018), sh, 'rubber', kit.dark, [X, H.y - 0.445, -0.066]);
    P.add(rb(0.064, 0.05, 0.012, 0.005), sh, 'rubber', shade(kit.dark, 1.5), [X, H.y - 0.43, -0.089]);
    P.add(loft([[H.y - 0.515, 0.066, 0.07], [H.y - 0.535, 0.066, 0.07]].map((r) => [r[0], r[1], r[2], X, 0.004]), 14), sh, 'rubber', kit.dark);
    // cargo pocket with its flap
    P.add(rb(0.03, 0.15, 0.12, 0.012), th, 'camo', shade(W, 0.94), [X + sx * 0.094, H.y - 0.245, 0.004]);
    P.add(rb(0.034, 0.032, 0.126, 0.008), th, 'camo', shade(W, 0.86), [X + sx * 0.097, H.y - 0.165, 0.004]);
    // boot shaft (shin) and foot
    P.add(loft([[0.255, 0.059, 0.063, X, 0.004], [0.16, 0.057, 0.064, X, 0.004], [0.09, 0.057, 0.066, X, 0.006]], 14, 2, true), sh, 'rubber', kit.boots);
    const F = R[ft];
    P.add(rb(0.104, 0.1, 0.25, 0.035), ft, 'rubber', kit.boots, [X, F.y - 0.012, F.z - 0.045]);
    const toe = new THREE.SphereGeometry(0.054, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    toe.scale(0.95, 0.9, 1.1);
    P.add(toe, ft, 'rubber', kit.boots, [X, F.y - 0.046, F.z - 0.15]);
    P.add(rb(0.112, 0.026, 0.29, 0.008), ft, 'rubber', [0.07, 0.065, 0.06], [X, F.y - 0.058, F.z - 0.05]);
    for (let i = 0; i < 4; i++) P.add(new THREE.BoxGeometry(0.056, 0.005, 0.007), ft, 'fabric', shade(kit.boots, 0.6), [X, F.y + 0.04 - i * 0.008, F.z - 0.045 - i * 0.027]);
  }
  // drop-leg holster on the right thigh
  {
    const H = R[B.thighR];
    P.add(rb(0.046, 0.165, 0.088, 0.014), B.thighR, 'fabric', kit.dark, [H.x + 0.112, H.y - 0.19, 0.008]);
    P.add(rb(0.03, 0.07, 0.036, 0.008), B.thighR, 'rubber', [0.09, 0.09, 0.09], [H.x + 0.112, H.y - 0.075, 0.03]);
    for (const dy of [-0.13, -0.27]) P.add(loft([[H.y + dy, 0.088, 0.094], [H.y + dy - 0.022, 0.087, 0.092]].map((r) => [r[0], r[1], r[2], H.x + 0.004, 0.0]), 14), B.thighR, 'rubber', kit.dark);
  }
  return P.build();
}

// Gloved fists in the hand bone's frame: x is the gun's right, -y runs forward along the gun and
// +z is the gun's down. The right hand wraps the pistol grip with the index finger along the
// trigger guard; the left cups the handguard from below with the fingers curled up its side.
function hand_(P, bone, base, sx, kit) {
  const glove = kit.dark, pad = shade(kit.dark, 0.7);
  const add = (g, color = glove) => P.add(g, bone, 'rubber', color, base);
  if (sx > 0) {
    const rake = new THREE.Matrix4().makeRotationX(-0.347);
    const palm = rb(0.034, 0.032, 0.088, 0.012); palm.applyMatrix4(rake); palm.translate(0.012, 0.036, 0.026); add(palm);
    const back = rb(0.022, 0.062, 0.086, 0.01); back.applyMatrix4(rake); back.translate(0.027, 0.018, 0.026); add(back);
    const knuck = rb(0.01, 0.034, 0.07, 0.004); knuck.applyMatrix4(rake); knuck.translate(0.039, 0.002, 0.03); add(knuck, pad);
    [0.012, 0.034, 0.056].forEach((z, i) => {
      const cy = 0.36 * z, r = i === 2 ? 0.0078 : 0.0088;
      add(finger([[0.03, cy + 0.006, z], [0.027, cy - 0.024, z], [0.0, cy - 0.04, z], [-0.024, cy - 0.022, z], [-0.026, cy - 0.002, z]], r));
    });
    add(finger([[0.024, -0.006, -0.012], [0.02, -0.036, -0.009], [0.014, -0.056, -0.002]], 0.0086));
    add(finger([[-0.006, 0.034, -0.018], [-0.022, 0.006, -0.017], [-0.025, -0.03, -0.013]], 0.0095));
  } else {
    const palm = rb(0.046, 0.086, 0.022, 0.009); palm.translate(-0.006, 0, 0.006); add(palm);
    const back = rb(0.05, 0.076, 0.02, 0.009); back.translate(0.0, 0.008, 0.02); add(back);
    add(rb(0.04, 0.05, 0.008, 0.003).translate(0.004, 0.008, 0.032), pad);
    [-0.033, -0.012, 0.009, 0.029].forEach((y, i) => {
      const R = 0.031, r = i === 3 ? 0.0076 : 0.0086;
      const pts = [];
      for (const deg of [-100, -60, -20, 15, 38 - i * 4]) {
        const a = (deg * Math.PI) / 180;
        pts.push([R * Math.cos(a), y, -0.028 - R * Math.sin(a)]);
      }
      add(finger(pts, r));
    });
    add(finger([[-0.016, 0.03, 0.004], [-0.031, 0.002, -0.016], [-0.03, -0.038, -0.026]], 0.0095));
  }
}
