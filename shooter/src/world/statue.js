// The plaza monument: a bronze officer on a walking horse, one foreleg raised and a sabre held
// up, on a moulded stone pedestal in a round basin with four water jets. The bronze is lofted
// (tubes swept through elliptical sections) so it reads as cast metal, not boxes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedBox } from '../core/geometry.js';

// Sweep elliptical sections through a smooth path. pts: [x, y, z, half-width, half-height];
// `up` orients the sections' height axis (it is kept perpendicular to the path).
function sweep(pts, up = [0, 1, 0], radial = 14, steps = 0, caps = true) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  const n = steps || Math.max(8, (pts.length - 1) * 5);
  const lens = curve.getLengths(n);
  const total = lens[n];
  // radii follow the control points, interpolated by arc length
  const ctrl = [0];
  for (let i = 1; i < pts.length; i++) ctrl.push(ctrl[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const radius = (t) => {
    const d = t * ctrl[ctrl.length - 1];
    let i = 1;
    while (i < ctrl.length - 1 && ctrl[i] < d) i++;
    const k = Math.min(1, Math.max(0, (d - ctrl[i - 1]) / ((ctrl[i] - ctrl[i - 1]) || 1)));
    const s = k * k * (3 - 2 * k);
    return [pts[i - 1][3] + (pts[i][3] - pts[i - 1][3]) * s, pts[i - 1][4] + (pts[i][4] - pts[i - 1][4]) * s];
  };
  const U = new THREE.Vector3(...up).normalize();
  const pos = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), Bn = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const t = lens[i] / total;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    N.copy(U).addScaledVector(T, -U.dot(T));
    if (N.lengthSq() < 1e-6) N.set(1, 0, 0).addScaledVector(T, -T.x);
    N.normalize();
    Bn.crossVectors(T, N).normalize();
    const [rw, rh] = radius(t);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(P.x + Bn.x * Math.cos(a) * rw + N.x * Math.sin(a) * rh, P.y + Bn.y * Math.cos(a) * rw + N.y * Math.sin(a) * rh, P.z + Bn.z * Math.cos(a) * rw + N.z * Math.sin(a) * rh);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (caps) {
    for (const [ring, end] of [[0, 0], [n, 1]]) {
      const ci = pos.length / 3;
      curve.getPointAt(end, P);
      curve.getTangentAt(end, T);
      const [rw, rh] = radius(end);
      const bulge = Math.min(rw, rh) * 0.6 * (end ? 1 : -1);
      pos.push(P.x + T.x * bulge, P.y + T.y * bulge, P.z + T.z * bulge);
      for (let j = 0; j < radial; j++) {
        const a = ring * radial + j, b = ring * radial + ((j + 1) % radial);
        if (end) idx.push(b, a, ci); else idx.push(a, b, ci);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

const blob = (r, sx, sy, sz, x, y, z, seg = 12) => { const g = new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)); g.scale(sx, sy, sz); g.translate(x, y, z); return g; };

// Horse and rider in life-size metres: +X forward, +Y up, hooves at y = 0.
function horseAndRider() {
  const P = [];
  // barrel, from rump to breast, the back dipping behind the withers
  P.push(sweep([[-1.02, 1.3, 0, 0.13, 0.15], [-0.88, 1.28, 0, 0.28, 0.32], [-0.55, 1.23, 0, 0.31, 0.355], [-0.2, 1.18, 0, 0.32, 0.375],
    [0.2, 1.19, 0, 0.31, 0.375], [0.52, 1.22, 0, 0.28, 0.36], [0.76, 1.27, 0, 0.2, 0.29], [0.88, 1.32, 0, 0.11, 0.15]], [0, 1, 0], 18));
  // haunches and shoulders
  for (const s of [-1, 1]) {
    P.push(blob(0.3, 0.95, 1.05, 0.82, -0.72, 1.24, s * 0.06));
    P.push(blob(0.24, 1.0, 1.25, 0.8, 0.52, 1.17, s * 0.07));
  }
  // neck arched up to the poll, with the mane along its crest
  P.push(sweep([[0.55, 1.4, 0, 0.17, 0.3], [0.76, 1.66, 0, 0.14, 0.23], [0.93, 1.86, 0, 0.1, 0.16], [1.02, 1.98, 0, 0.08, 0.1]], [-0.6, 0.8, 0], 16));
  P.push(sweep([[0.48, 1.62, 0, 0.035, 0.06], [0.7, 1.86, 0, 0.035, 0.07], [0.88, 2.02, 0, 0.03, 0.05], [0.98, 2.08, 0, 0.02, 0.03]], [-0.7, 0.7, 0], 8));
  // head, ears, jaw and nostrils
  P.push(sweep([[0.98, 2.0, 0, 0.085, 0.1], [1.12, 1.88, 0, 0.08, 0.1], [1.28, 1.72, 0, 0.062, 0.078], [1.37, 1.62, 0, 0.056, 0.062], [1.41, 1.57, 0, 0.042, 0.042]], [0.75, 0.66, 0], 14));
  P.push(blob(0.07, 0.9, 1.1, 1.0, 1.06, 1.86, 0));
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.03, 0.12, 6);
    ear.rotateZ(-0.25);
    ear.translate(0.99, 2.1, s * 0.05);
    P.push(ear);
    P.push(blob(0.016, 1, 0.8, 1, 1.41, 1.6, s * 0.03, 6));
  }
  // legs: near fore raised and bent, the rest planted; hooves and fetlocks
  const leg = (pts) => P.push(sweep(pts.map((q) => [q[0], q[1], q[2], q[3] * 1.22, q[4] * 1.22]), [1, 0, 0], 10));
  leg([[0.54, 1.05, 0.14, 0.09, 0.12], [0.57, 0.78, 0.14, 0.065, 0.075], [0.58, 0.55, 0.14, 0.055, 0.06], [0.58, 0.32, 0.14, 0.038, 0.042], [0.6, 0.16, 0.14, 0.045, 0.05], [0.63, 0.05, 0.14, 0.055, 0.055], [0.645, 0.0, 0.14, 0.058, 0.05]]);
  leg([[0.54, 1.05, -0.14, 0.09, 0.12], [0.68, 0.82, -0.15, 0.065, 0.075], [0.82, 0.64, -0.15, 0.055, 0.06], [0.75, 0.44, -0.15, 0.038, 0.042], [0.68, 0.33, -0.15, 0.045, 0.05], [0.7, 0.24, -0.15, 0.055, 0.052]]);
  for (const s of [-1, 1]) {
    const back = s > 0 ? 0 : 0.08;
    leg([[-0.74, 1.12, s * 0.15, 0.13, 0.17], [-0.7, 0.82, s * 0.15, 0.09, 0.1], [-0.84 - back, 0.58, s * 0.15, 0.06, 0.065], [-0.81 - back, 0.32, s * 0.15, 0.04, 0.044], [-0.79 - back, 0.16, s * 0.15, 0.046, 0.05], [-0.76 - back, 0.05, s * 0.15, 0.056, 0.055], [-0.75 - back, 0.0, s * 0.15, 0.058, 0.05]]);
  }
  // tail
  P.push(sweep([[-1.0, 1.34, 0, 0.06, 0.07], [-1.1, 1.24, 0, 0.065, 0.06], [-1.16, 1.0, 0, 0.06, 0.05], [-1.13, 0.72, 0.02, 0.05, 0.04], [-1.06, 0.52, 0.03, 0.03, 0.025]], [1, 0, 0], 10));
  // saddle cloth and saddle
  P.push(sweep([[-0.32, 1.47, 0, 0.33, 0.04], [0.1, 1.5, 0, 0.34, 0.04]], [0, 1, 0], 14, 6));
  const seat = roundedBox(0.5, 0.09, 0.4, 0.04, 2); seat.translate(-0.1, 1.56, 0); P.push(seat);
  P.push(blob(0.08, 0.6, 1.2, 1.9, -0.32, 1.6, 0, 10));
  // rider: coat, sash, head under a bicorne, sabre arm raised, reins hand low
  P.push(sweep([[-0.08, 1.58, 0, 0.17, 0.14], [-0.05, 1.8, 0, 0.15, 0.115], [-0.02, 2.0, 0, 0.19, 0.13], [-0.01, 2.13, 0, 0.18, 0.11]], [1, 0, 0], 16));
  P.push(sweep([[-0.06, 1.62, 0, 0.18, 0.15], [-0.26, 1.52, 0, 0.16, 0.05], [-0.42, 1.4, 0, 0.13, 0.02]], [0, 1, 0], 10));
  P.push(sweep([[-0.04, 2.15, 0, 0.055, 0.05], [-0.01, 2.24, 0, 0.05, 0.048]], [1, 0, 0], 10));
  P.push(blob(0.1, 0.95, 1.1, 0.9, 0.0, 2.33, 0));
  const hat = new THREE.CylinderGeometry(0.24, 0.24, 0.07, 16);
  hat.scale(0.42, 1, 1);
  hat.rotateZ(0.12);
  hat.translate(-0.01, 2.43, 0);
  P.push(hat, blob(0.12, 0.85, 0.75, 1.0, 0.0, 2.43, 0));
  const arm = (pts) => P.push(sweep(pts, [0, 1, 0], 10));
  arm([[-0.01, 2.08, 0.19, 0.06, 0.06], [0.16, 2.24, 0.28, 0.05, 0.05], [0.34, 2.42, 0.3, 0.042, 0.042], [0.4, 2.47, 0.3, 0.045, 0.045]]);
  arm([[-0.01, 2.08, -0.19, 0.06, 0.06], [0.1, 1.86, -0.25, 0.05, 0.05], [0.3, 1.78, -0.14, 0.042, 0.042], [0.36, 1.77, -0.1, 0.045, 0.045]]);
  // sabre: guard, then a curved blade up and forward
  P.push(blob(0.05, 1, 0.4, 1, 0.42, 2.49, 0.3, 8));
  P.push(sweep([[0.43, 2.5, 0.3, 0.014, 0.004], [0.66, 2.78, 0.31, 0.016, 0.004], [0.85, 3.06, 0.31, 0.013, 0.004], [0.96, 3.28, 0.3, 0.004, 0.002]], [0, 0, 1], 6, 0, false));
  // reins from the hand to the bit
  P.push(sweep([[0.36, 1.77, -0.1, 0.008, 0.008], [0.7, 1.72, -0.08, 0.008, 0.008], [1.02, 1.74, -0.07, 0.008, 0.008], [1.3, 1.66, -0.06, 0.008, 0.008]], [0, 1, 0], 5, 0, false));
  // legs down the flanks into the stirrups, boots forward
  for (const s of [-1, 1]) {
    P.push(sweep([[-0.06, 1.62, s * 0.15, 0.085, 0.09], [0.22, 1.5, s * 0.29, 0.07, 0.075], [0.18, 1.24, s * 0.33, 0.055, 0.058], [0.14, 1.04, s * 0.33, 0.05, 0.05]], [0, 1, 0], 10));
    const boot = roundedBox(0.2, 0.08, 0.08, 0.03, 2);
    boot.translate(0.2, 1.0, s * 0.33);
    P.push(boot);
    P.push(sweep([[0.08, 1.48, s * 0.25, 0.006, 0.006], [0.1, 1.2, s * 0.32, 0.006, 0.006], [0.15, 1.0, s * 0.34, 0.006, 0.006]], [1, 0, 0], 4, 0, false));
  }
  const parts = P.map((g) => {
    const h = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(h.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') h.deleteAttribute(k);
    if (!h.attributes.uv) h.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
    return h;
  });
  return mergeGeometries(parts, false);
}

// Cast bronze, weathered: dark metal with verdigris bloomed on everything facing the sky and run
// down the flanks in streaks (vertex colours, so one material covers the whole casting).
function patina(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const dark = new THREE.Color(0x3d3025).convertSRGBToLinear(), verd = new THREE.Color(0x6c9c84).convertSRGBToLinear();
  const c = new THREE.Color();
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = Math.sin(x * 9.1 + z * 4.7) * Math.sin(y * 7.3 - x * 3.1) * 0.5 + Math.sin(z * 13.7 + y * 11.3) * 0.25;
    const run = Math.pow(Math.max(0, Math.sin(x * 23.0 + z * 17.0)), 6) * (1 - Math.abs(n.getY(i)));
    const v = Math.min(1, ss(0.1, 0.75, n.getY(i) * 0.75 + k * 0.45 + 0.12) + run * 0.55);
    c.copy(dark).lerp(verd, v);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const lathe = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

// B: world builder; (x, z) the basin centre; yaw turns the monument about Y.
export function monument(B, x, z, yaw) {
  const at = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
  const put = (mat, g, shadow = true) => { g.applyMatrix4(at); B.geo(mat, g, shadow); };
  const stone = 'limestone' in B.M ? 'limestone' : 'concrete';
  // basin: plinth, battered wall, rolled lip; then a step ring round it
  // (profiles run counter-clockwise in r-y so the faces point out of the stone)
  put(stone, lathe([[3.58, 0.0], [3.56, 0.1], [3.47, 0.14], [3.5, 0.55], [3.54, 0.6], [3.62, 0.66], [3.6, 0.74], [3.5, 0.79], [3.34, 0.77], [3.3, 0.7], [3.32, 0.45]]));
  put(stone, lathe([[4.14, 0.0], [4.1, 0.03], [3.6, 0.02], [3.58, 0.0]]));
  // pedestal: base, die with panels, cornice and cap, all softened
  const block = (w, h, d, y, r) => { const g = roundedBox(w, h, d, r, 2); g.translate(0, y + h / 2, 0); return g; };
  put(stone, block(2.9, 0.34, 2.0, 0.38, 0.04));
  put(stone, block(2.7, 0.12, 1.8, 0.72, 0.03));
  put(stone, block(2.36, 1.42, 1.46, 0.84, 0.02));
  for (const [w, d, ox, oz] of [[1.9, 0.04, 0, 0.74], [1.9, 0.04, 0, -0.74], [0.04, 1.0, 1.19, 0], [0.04, 1.0, -1.19, 0]]) {
    const g = roundedBox(w, 0.9, d, 0.01, 1);
    g.translate(ox, 1.55, oz);
    put(stone, g);
  }
  put(stone, block(2.62, 0.1, 1.72, 2.26, 0.03));
  put(stone, block(2.78, 0.16, 1.88, 2.36, 0.04));
  put(stone, block(2.5, 0.1, 1.62, 2.52, 0.03));
  // bronze dedication plaques on the long faces
  for (const s of [-1, 1]) {
    const g = roundedBox(0.9, 0.42, 0.03, 0.01, 1);
    g.translate(0, 1.6, s * 0.76);
    put('bronze', g);
  }
  // the horse and rider, a touch under life size
  const statue = horseAndRider();
  statue.scale(0.92, 0.92, 0.92);
  statue.translate(0.05, 2.62, 0);
  statue.applyMatrix4(at);
  B.geo('statueBronze', patina(statue));
  // spouts on the short faces and jets arcing into the basin
  for (const s of [-1, 1]) {
    for (const oz of [-0.35, 0.35]) {
      const sp = new THREE.CylinderGeometry(0.03, 0.045, 0.18, 10);
      sp.rotateZ(Math.PI / 2);
      sp.translate(s * 1.27, 1.2, oz);
      put('bronze', sp);
      const pts = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector3(s * (1.36 + t * 1.15), 1.2 + t * 0.32 - t * t * 1.07, oz * (1 + t * 0.4))); }
      put('waterJet', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.016, 6, false), false);
      const splash = new THREE.CircleGeometry(0.16, 14);
      splash.rotateX(-Math.PI / 2);
      splash.translate(s * 2.51, 0.47, oz * 1.4);
      put('foam', splash, false);
    }
  }
  // colliders: the pedestal (axis-aligned, so a little generous) and the rider above it
  B.collider(x - 1.25, 0, z - 1.25, x + 1.25, 2.68, z + 1.25, 'stone');
  B.collider(x - 0.85, 2.68, z - 0.85, x + 0.85, 5.5, z + 0.85, 'metal');
}
