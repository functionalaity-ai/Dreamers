// Attachments shared by the guns: optics, muzzle devices, the laser. Built like the guns:
// turned bodies with real wall thickness, bevelled mounts, knurled knobs and cut ports.
import * as THREE from 'three';
import { Q, V, rb, cz, cy } from './gunkit.js';
import { outline, circle, rrect, ring, sector, side, along, turned, turnedX } from '../core/shapes.js';

const mesh = (grp, geo, mat) => { const m = new THREE.Mesh(geo, mat); grp.add(m); return m; };

// A knob turned round the vertical axis at (x, z) from height y0 to y1, knurled on its rim.
function knob(r, y0, y1, x, z, knurl) {
  const pts = [[0, y0], [r * 0.82, y0], [r, y0 + 0.0008]];
  const n = Q.low ? 0 : knurl;
  for (let i = 0; i < n; i++) { const t = y0 + 0.0012 + (i / n) * (y1 - y0 - 0.0024); pts.push([r, t], [r * 0.94, t + (y1 - y0) / n / 2]); }
  pts.push([r, y1 - 0.0008], [r * 0.85, y1], [0, y1]);
  const g = new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), Q.low ? 10 : 22);
  g.translate(x, 0, z);
  return g;
}

// Picatinny clamp: a base with jaws, sitting on the rail top at local y = 0.
function clamp(grp, M, z0, z1, w = 0.0236) {
  mesh(grp, along(outline([[-w / 2, -0.0016], [w / 2, -0.0016], [w / 2, 0.0062, 0.0015], [-w / 2, 0.0062, 0.0015]]), z0, z1, Q.low ? 0 : 0.0006, { flat: Q.low }), M.anodized);
  if (Q.low) return;
  for (const sx of [-1, 1]) mesh(grp, along(outline([[0, -0.0035], [0.0022, -0.0035], [0.0022, 0.003], [0, 0.003]]), z0 + 0.001, z1 - 0.001, 0.0004, { x: sx > 0 ? w / 2 - 0.0006 : -w / 2 - 0.0016 }), M.anodized);
  // cross-bolt nut on the right
  mesh(grp, turnedX([[0, w / 2 - 0.0004], [0.0042, w / 2 - 0.0004], [0.0042, w / 2 + 0.0032], [0.0036, w / 2 + 0.0038], [0, w / 2 + 0.0038]], 6, 0.002, (z0 + z1) / 2), M.steel);
}

export function redDot(g, M, y, z, small) {
  const grp = new THREE.Group();
  grp.position.set(0, y, z);
  g.body.add(grp);
  const A = M.anodBlack || M.anodized, lo = Q.low;
  if (small) {
    // Pistol reflex sight: a housing with a hood framing the lens window
    mesh(grp, along(rrect(0, 0.0055, 0.024, 0.011, 0.002), -0.021, 0.021, lo ? 0 : 0.0008, { flat: lo }), A);
    const hood = outline([[-0.0128, 0.006], [0.0128, 0.006], [0.0128, 0.022, 0.006], [0.006, 0.0285, 0.004], [-0.006, 0.0285, 0.004], [-0.0128, 0.022, 0.006]]);
    if (!lo) hood.holes.push(outline([[-0.0098, 0.0085], [0.0098, 0.0085], [0.0098, 0.021, 0.004], [0.005, 0.0258, 0.003], [-0.005, 0.0258, 0.003], [-0.0098, 0.021, 0.004]], new THREE.Path()));
    mesh(grp, along(hood, -0.019, -0.013, lo ? 0 : 0.0007, { flat: lo }), A);
    if (!lo) mesh(grp, knob(0.0028, 0.011, 0.0135, 0.008, 0.004, 5), M.steel);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.019, 0.016), M.lensTint); lens.position.set(0, 0.017, -0.016); grp.add(lens);
    return { axisY: y + 0.025, eyeZ: z + 0.03, reticleZ: z - 0.012, group: grp };
  }
  const H = 0.034; // optical axis above the rail
  clamp(grp, M, -0.026, 0.026);
  // Riser up to the body, with lightening cuts
  const riser = outline([[-0.022, 0.006], [0.022, 0.006], [0.0165, 0.0186, 0.004], [-0.0165, 0.0186, 0.004]]);
  if (!lo) for (const zc of [-0.009, 0.009]) riser.holes.push(circle(zc, 0.0122, 0.0029, new THREE.Path(), 14));
  mesh(grp, side(riser, 0.0158, lo ? 0 : 0.0008, { flat: lo }), A);
  // Body: a real tube with bevelled rings front and rear, and a flat foot onto the riser
  const C = lo ? 12 : 30;
  mesh(grp, along(ring(0.0138, 0.0163, C), -0.031, 0.027, lo ? 0 : 0.0007, { y: H, flat: lo }), A);
  mesh(grp, along(ring(0.0138, 0.0178, C), -0.037, -0.028, lo ? 0 : 0.0008, { y: H, flat: lo }), A);
  mesh(grp, along(ring(0.0138, 0.0172, C), 0.025, 0.033, lo ? 0 : 0.0007, { y: H, flat: lo }), A);
  mesh(grp, rb(0.0172, 0.009, 0.036, 0, 0.0205, 0, 0.0015), A);
  // Turrets: elevation on top, windage on the right; brightness dial on the left
  mesh(grp, knob(0.0068, H + 0.0148, H + 0.0236, 0, 0.002, 7), A);
  mesh(grp, knob(0.0074, H + 0.0236, H + 0.0262, 0, 0.002, 0), M.steel);
  const wind = knob(0.0068, 0.0148, 0.0236, 0, 0, 7); wind.rotateZ(-Math.PI / 2); wind.translate(0, H, 0.002); mesh(grp, wind, A);
  const dial = knob(0.0078, 0.0148, 0.025, 0, 0, 9); dial.rotateZ(Math.PI / 2); dial.translate(0, H, -0.006); mesh(grp, dial, M.rubber);
  const lensF = new THREE.Mesh(new THREE.CircleGeometry(0.0139, 28), M.lensTint); lensF.position.set(0, H, -0.033); grp.add(lensF);
  const lensR = new THREE.Mesh(new THREE.CircleGeometry(0.0139, 28), M.lensTint); lensR.position.set(0, H, 0.03); lensR.rotation.y = Math.PI; grp.add(lensR);
  return { axisY: y + H, eyeZ: z + 0.034, reticleZ: z - 0.034, group: grp };
}

export function scope4x(g, M, y, z) {
  const grp = new THREE.Group();
  grp.position.set(0, y, z);
  g.body.add(grp);
  const A = M.anodBlack || M.anodized, lo = Q.low, C = lo ? 12 : 32;
  const H = 0.04;
  // Rings on a one-piece base: clamp, upright, ring with its top cap and screws
  clamp(grp, M, -0.05, 0.06);
  mesh(grp, side(outline([[-0.048, 0.006], [0.058, 0.006], [0.052, 0.012, 0.003], [-0.042, 0.012, 0.003]]), 0.02, lo ? 0 : 0.0008, { flat: lo }), A);
  for (const rz of [-0.035, 0.045]) {
    mesh(grp, side(outline([[rz - 0.009, 0.011], [rz + 0.009, 0.011], [rz + 0.008, H - 0.012, 0.002], [rz - 0.008, H - 0.012, 0.002]]), 0.0135, lo ? 0 : 0.0008, { flat: lo }), A);
    mesh(grp, along(ring(0.0152, 0.0186, C), rz - 0.008, rz + 0.008, lo ? 0 : 0.0007, { y: H, flat: lo }), A);
    if (!lo) for (const sx of [-1, 1]) mesh(grp, cy(0.0018, 0.004, sx * 0.0172, H + 0.0012, rz, 8), M.steel);
  }
  // Main tube, objective bell and ocular with its rubber eyepiece
  mesh(grp, turned([[0.015, -0.068], [0.015, 0.1], [0, 0.1]], C, 0, H), A);
  mesh(grp, turned([[0.0194, -0.125], [0.0222, -0.123], [0.0226, -0.098], [0.0215, -0.094], [0.016, -0.074], [0.015, -0.068]], C, 0, H), A);
  mesh(grp, along(ring(0.0198, 0.0226, C), -0.128, -0.12, lo ? 0 : 0.0006, { y: H, flat: lo }), A);
  mesh(grp, turned([[0.015, 0.098], [0.0175, 0.108], [0.0196, 0.112], [0.0196, 0.13], [0.0192, 0.132]], C, 0, H), A);
  mesh(grp, along(ring(0.0172, 0.0208, C), 0.13, 0.146, lo ? 0 : 0.001, { y: H, flat: lo }), M.rubber);
  // Turret saddle, knurled turret caps, parallax knob, power ring grip
  mesh(grp, rb(0.034, 0.03, 0.03, 0, H, 0.012, 0.006), A);
  mesh(grp, knob(0.0092, H + 0.014, H + 0.031, 0, 0.012, 9), A);
  const tw = knob(0.0092, 0.014, 0.031, 0, 0, 9); tw.rotateZ(-Math.PI / 2); tw.translate(0, H, 0.012); mesh(grp, tw, A);
  const px = knob(0.0078, 0.014, 0.026, 0, 0, 7); px.rotateZ(Math.PI / 2); px.translate(0, H, 0.012); mesh(grp, px, A);
  if (!lo) for (let i = 0; i < 10; i++) mesh(grp, rb(0.0026, 0.003, 0.012, 0.0198, 0, 0, 0.0008).rotateZ((i / 10) * Math.PI * 2).translate(0, H, 0.104), A);
  // Objective lens (reflective) and the ocular lens that shows the picture-in-picture view.
  const obj = new THREE.Mesh(new THREE.CircleGeometry(0.0205, 32), M.lens); obj.position.set(0, H, -0.1215); obj.rotation.y = Math.PI; grp.add(obj);
  const ocular = new THREE.Mesh(new THREE.CircleGeometry(0.0175, 40), M.lens);
  ocular.position.set(0, H, 0.1435);
  ocular.name = 'ocular';
  grp.add(ocular);
  return { axisY: y + H, eyeZ: z + 0.16, ocular, group: grp, relief: 0.07 };
}

// Fluted cross-section: a circle of radius r with n rounded flutes of depth d.
function fluted(r, n, d, path = new THREE.Shape()) {
  const steps = n * 12;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const f = Math.cos(a * n);
    const rr = r - d * Math.max(0, f) ** 3;
    if (i === 0) path.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else path.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  path.closePath();
  return path;
}

export function suppressor(g, M, mz, y, r = 0.019, len = 0.17) {
  const grp = new THREE.Group();
  grp.position.set(0, y, mz);
  g.body.add(grp);
  const K = M.cerakote, lo = Q.low, C = lo ? 12 : 32;
  // Mount with wrench flats, a knurled locking collar, the fluted tube and a bevelled end cap
  mesh(grp, turned([[0, -0.022], [r * 0.82, -0.022], [r * 0.82, -0.004], [r * 0.7, 0], [0, 0]], C, 0, 0), K);
  if (!lo) for (let i = 0; i < 16; i++) mesh(grp, rb(0.0018, 0.0022, 0.014, r * 0.83, 0, -0.013, 0.0005).rotateZ((i / 16) * Math.PI * 2), M.steel);
  const body = lo ? new THREE.Shape().absarc(0, 0, r, 0, Math.PI * 2) : fluted(r, 8, 0.0016);
  if (!lo) body.holes.push(circle(0, 0, r - 0.0035, new THREE.Path(), 24));
  mesh(grp, along(body, -len + 0.016, -0.022, lo ? 0 : 0.0008, { flat: lo, curve: 24 }), K);
  mesh(grp, turned([[0.0045, -len], [r * 0.86, -len], [r, -len + 0.006], [r, -len + 0.016], [0.0045, -len + 0.016]], C, 0, 0), K);
  mesh(grp, cz(0.0045, 0.0045, -len - 0.0004, -len + 0.004, 0, 0, 14), M.rubber);
  return len;
}

// Brace compensator: three rows of side ports and a top port band, cut through the wall.
export function compensator(g, M, mz, y) {
  const grp = new THREE.Group();
  grp.position.set(0, y, mz);
  g.body.add(grp);
  const S = M.steel, lo = Q.low, L = 0.055;
  if (lo) { mesh(grp, cz(0.0115, 0.0115, 0, -L, 0, 0, 12), S); return L; }
  const ro = 0.0115, ri = 0.0048;
  mesh(grp, along(ring(ri, ro, 28), -0.012, 0.0005, 0.0005), S);
  let z = -0.012;
  for (let i = 0; i < 3; i++) {
    // port band: material everywhere except the side ports (and a top port)
    const gaps = [[-0.42, 0.42], [Math.PI - 0.42, Math.PI + 0.42], [Math.PI / 2 - 0.2, Math.PI / 2 + 0.2]];
    const edges = gaps.flatMap(([a, b]) => [a, b]).map((v) => ((v % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((p, q) => p - q);
    for (let k = 0; k < edges.length; k += 2) {
      const a0 = edges[(k + 1) % edges.length], a1 = edges[(k + 2) % edges.length] + (k + 2 >= edges.length ? Math.PI * 2 : 0);
      mesh(grp, along(sector(ri, ro, a0, a1, 6), z - 0.0085, z, 0.0003), S);
    }
    mesh(grp, along(ring(ri, ro, 28), z - 0.0125, z - 0.0085, 0.0003), S);
    z -= 0.0125;
  }
  mesh(grp, along(ring(ri, ro, 28), -L, z, 0.0005), S);
  return L;
}

export function laserModule(g, M, x, y, z) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  g.body.add(grp);
  const lo = Q.low;
  mesh(grp, along(rrect(0, 0, 0.022, 0.026, 0.005), -0.025, 0.025, lo ? 0 : 0.0012, { flat: lo }), M.polymer);
  mesh(grp, turned([[0.0055, -0.0285], [0.0066, -0.0275], [0.0066, -0.024], [0, -0.024]], 18, 0, 0.005), M.steel);
  mesh(grp, cz(0.0045, 0.0045, -0.0284, -0.0286, 0, 0.005, 12), M.reticle);
  mesh(grp, turned([[0.0045, -0.0275], [0.0058, -0.027], [0.0058, -0.024], [0, -0.024]], 18, 0, -0.0062), M.steel);
  mesh(grp, cz(0.0045, 0.0045, -0.0274, -0.0276, 0, -0.0062, 12), M.lens);
  if (!lo) mesh(grp, rb(0.008, 0.003, 0.012, 0, 0.0142, 0.012, 0.0012), M.rubber);
  return V(x, y + 0.005, z - 0.0286);
}

