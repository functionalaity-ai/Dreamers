// Procedural, real-scale firearm models. Local axes: barrel along -Z, +Y up, +X right.
// Every gun exposes its moving parts (bolt, dust cover, slide, pump, magazine, trigger,
// selector) and anchor points (hands, sight line, muzzle, ejection port).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedBox, lathe, profile, tubeZ } from '../core/geometry.js';
import { textDecal } from '../core/textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function rb(w, h, d, x, y, z, r = 0.002) { const g = roundedBox(w, h, d, r, 2); g.translate(x, y, z); return g; }
function bx(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
function cz(r0, r1, z0, z1, x = 0, y = 0, seg = 20, open = false) { const g = tubeZ(r0, r1, z0, z1, seg, open); g.translate(x, y, 0); return g; }
function cx(r, len, x, y, z, seg = 12) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return g; }
function cy(r, len, x, y, z, seg = 12) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.translate(x, y, z); return g; }

class Gun {
  constructor(id, M) {
    this.id = id;
    this.M = M;
    this.root = new THREE.Group();
    this.root.name = 'gun_' + id;
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.parts = {};
    this.anchors = {};
    this.pending = new Map(); // material -> geometries, merged at finish()
    this.rounds = [];
    this.magRounds = [];
  }
  // Static geometry, merged per material.
  s(mat, geo) {
    if (!this.pending.has(mat)) this.pending.set(mat, []);
    this.pending.get(mat).push(geo);
  }
  // A separate mesh (moving part or attachment child).
  m(mat, geo, parent = this.body, name) {
    const mesh = new THREE.Mesh(geo, mat);
    if (name) mesh.name = name;
    parent.add(mesh);
    return mesh;
  }
  pivot(parent, x, y, z, name) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    if (name) g.name = name;
    (parent || this.body).add(g);
    return g;
  }
  finish(shadows) {
    for (const [mat, geos] of this.pending) {
      const flat = geos.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k); return n; });
      const merged = mergeGeometries(flat, false);
      const mesh = new THREE.Mesh(merged, mat);
      this.body.add(mesh);
    }
    this.pending.clear();
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = !!shadows; o.receiveShadow = false; } });
    return this;
  }
}

// --- shared bits -------------------------------------------------------------
function picatinny(g, mat, z0, z1, y, w = 0.021) {
  g.s(mat, rb(w, 0.006, Math.abs(z1 - z0), 0, y, (z0 + z1) / 2, 0.0012));
  for (let z = Math.min(z0, z1) + 0.004; z < Math.max(z0, z1) - 0.003; z += 0.01) g.s(mat, bx(w + 0.002, 0.004, 0.005, 0, y + 0.004, z));
}

// A rifle or pistol cartridge lying along -Z, base at z = 0.
export function cartridgeGeo(kind) {
  let pts;
  if (kind === '556') pts = [[0, 0], [0.0048, 0], [0.0048, 0.0012], [0.0041, 0.0016], [0.0047, 0.0025], [0.0047, 0.036], [0.0032, 0.0395], [0.0029, 0.0447]];
  else if (kind === '9mm') pts = [[0, 0], [0.0049, 0], [0.0049, 0.0011], [0.0042, 0.0015], [0.0049, 0.0025], [0.0049, 0.019]];
  else pts = [[0, 0], [0.0108, 0], [0.0108, 0.0014], [0.0103, 0.002], [0.0103, 0.0125]];
  const brass = lathe(pts, 14);
  brass.rotateX(-Math.PI / 2);
  let tip;
  if (kind === '556') tip = lathe([[0, 0.0447], [0.0029, 0.0447], [0.0028, 0.05], [0.0019, 0.054], [0.0004, 0.057], [0, 0.0572]], 12);
  else if (kind === '9mm') tip = lathe([[0, 0.019], [0.0045, 0.019], [0.0044, 0.023], [0.003, 0.0275], [0, 0.0295]], 12);
  else tip = lathe([[0, 0.0125], [0.0102, 0.0125], [0.0102, 0.068], [0.0085, 0.07], [0, 0.07]], 14);
  tip.rotateX(-Math.PI / 2);
  return { brass, tip };
}

function makeRound(M, kind) {
  const g = new THREE.Group();
  const c = cartridgeGeo(kind);
  g.add(new THREE.Mesh(c.brass, M.brass));
  g.add(new THREE.Mesh(c.tip, kind === 'shell' ? M.shell : M.copper));
  return g;
}

// --- Attachments ------------------------------------------------------------------
function redDot(g, M, y, z, small) {
  const grp = new THREE.Group();
  grp.position.set(0, y, z);
  g.body.add(grp);
  if (small) {
    // Pistol-sized reflex sight
    const body = new THREE.Mesh(rb(0.024, 0.016, 0.042, 0, 0.008, 0, 0.004), M.anodized); grp.add(body);
    const hood = new THREE.Mesh(rb(0.026, 0.022, 0.006, 0, 0.022, -0.016, 0.003), M.anodized); grp.add(hood);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.016), M.lensTint); lens.position.set(0, 0.026, -0.012); grp.add(lens);
    const axisY = y + 0.025;
    return { axisY, eyeZ: z + 0.03, reticleZ: z - 0.012, group: grp };
  }
  const H = 0.034; // optical axis above the rail
  grp.add(new THREE.Mesh(rb(0.022, 0.012, 0.05, 0, 0.006, 0, 0.002), M.anodized));
  // Riser stops just under the tube so nothing intrudes into the sight picture.
  grp.add(new THREE.Mesh(rb(0.014, H - 0.0165 - 0.012, 0.03, 0, 0.012 + (H - 0.0165 - 0.012) / 2, 0, 0.0015), M.anodized));
  const tubeMat = M.anodized.clone(); tubeMat.side = THREE.DoubleSide;
  const ringMat = M.rubber.clone(); ringMat.side = THREE.DoubleSide;
  grp.add(new THREE.Mesh(cz(0.0165, 0.0165, -0.033, 0.033, 0, H, 28, true), tubeMat));
  grp.add(new THREE.Mesh(cz(0.0185, 0.0185, -0.036, -0.026, 0, H, 28, true), ringMat));
  grp.add(new THREE.Mesh(cz(0.0185, 0.0185, 0.026, 0.036, 0, H, 28, true), ringMat));
  // Lens rings close the gap between tube and rubber
  for (const z of [-0.036, 0.036]) { const ring = new THREE.RingGeometry(0.0145, 0.0185, 28); ring.translate(0, H, z); grp.add(new THREE.Mesh(ring, ringMat)); }
  grp.add(new THREE.Mesh(cy(0.0075, 0.012, 0, H + 0.02, 0.0, 16), M.anodized));
  grp.add(new THREE.Mesh(cx(0.0075, 0.012, 0.021, H, 0.0, 16), M.anodized));
  grp.add(new THREE.Mesh(cx(0.006, 0.01, -0.02, H, 0.008, 16), M.steel));
  const lensF = new THREE.Mesh(new THREE.CircleGeometry(0.0145, 28), M.lensTint); lensF.position.set(0, H, -0.034); grp.add(lensF);
  const lensR = new THREE.Mesh(new THREE.CircleGeometry(0.0145, 28), M.lensTint); lensR.position.set(0, H, 0.034); lensR.rotation.y = Math.PI; grp.add(lensR);
  return { axisY: y + H, eyeZ: z + 0.034, reticleZ: z - 0.034, group: grp };
}

function scope4x(g, M, y, z) {
  const grp = new THREE.Group();
  grp.position.set(0, y, z);
  g.body.add(grp);
  const H = 0.04;
  for (const rz of [-0.035, 0.045]) {
    grp.add(new THREE.Mesh(rb(0.024, 0.012, 0.022, 0, 0.006, rz, 0.002), M.anodized));
    grp.add(new THREE.Mesh(rb(0.012, H - 0.012, 0.016, 0, 0.012 + (H - 0.012) / 2 - 0.004, rz, 0.002), M.anodized));
    const ring = new THREE.TorusGeometry(0.0172, 0.003, 8, 24);
    ring.translate(0, H, rz);
    grp.add(new THREE.Mesh(ring, M.anodized));
  }
  grp.add(new THREE.Mesh(cz(0.015, 0.015, -0.07, 0.1, 0, H, 28), M.anodized));
  grp.add(new THREE.Mesh(lathe([[0.015, 0], [0.022, 0.022], [0.0225, 0.05], [0.021, 0.052]], 32).rotateX(-Math.PI / 2).translate(0, H, -0.07), M.anodized));
  grp.add(new THREE.Mesh(lathe([[0.015, 0], [0.0195, 0.018], [0.0198, 0.045], [0.019, 0.047]], 32).rotateX(Math.PI / 2).translate(0, H, 0.1), M.anodized));
  grp.add(new THREE.Mesh(cz(0.0205, 0.0205, 0.118, 0.142, 0, H, 28), M.rubber));
  // Turrets with knurled caps
  grp.add(new THREE.Mesh(cy(0.009, 0.018, 0, H + 0.022, 0.012, 20), M.anodized));
  grp.add(new THREE.Mesh(cy(0.0095, 0.006, 0, H + 0.033, 0.012, 24), M.steel));
  grp.add(new THREE.Mesh(cx(0.009, 0.018, 0.022, H, 0.012, 20), M.anodized));
  grp.add(new THREE.Mesh(cx(0.0095, 0.006, 0.033, H, 0.012, 24), M.steel));
  grp.add(new THREE.Mesh(cx(0.008, 0.014, -0.02, H, 0.012, 20), M.anodized));
  // Objective lens (reflective) and the ocular lens that shows the picture-in-picture view.
  const obj = new THREE.Mesh(new THREE.CircleGeometry(0.0205, 32), M.lens); obj.position.set(0, H, -0.1215); obj.rotation.y = Math.PI; grp.add(obj);
  const ocular = new THREE.Mesh(new THREE.CircleGeometry(0.0175, 40), M.lens);
  ocular.position.set(0, H, 0.1435);
  ocular.name = 'ocular';
  grp.add(ocular);
  return { axisY: y + H, eyeZ: z + 0.16, ocular, group: grp, relief: 0.07 };
}

function suppressor(g, M, mz, y, r = 0.019, len = 0.17) {
  const grp = new THREE.Group();
  grp.position.set(0, y, mz);
  g.body.add(grp);
  grp.add(new THREE.Mesh(cz(r * 0.7, r, 0, -0.02, 0, 0, 24), M.cerakote));
  grp.add(new THREE.Mesh(cz(r, r, -0.02, -len + 0.012, 0, 0, 28), M.cerakote));
  grp.add(new THREE.Mesh(cz(r, r * 0.82, -len + 0.012, -len, 0, 0, 28), M.cerakote));
  grp.add(new THREE.Mesh(cz(0.0045, 0.0045, -len - 0.0005, -len + 0.002, 0, 0, 14), M.rubber));
  for (let i = 0; i < 3; i++) grp.add(new THREE.Mesh(cz(r + 0.0006, r + 0.0006, -0.04 - i * 0.04, -0.043 - i * 0.04, 0, 0, 28), M.steel));
  return len;
}

function compensator(g, M, mz, y) {
  const grp = new THREE.Group();
  grp.position.set(0, y, mz);
  g.body.add(grp);
  grp.add(new THREE.Mesh(cz(0.0115, 0.0115, 0, -0.055, 0, 0, 20), M.steel));
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) grp.add(new THREE.Mesh(bx(0.002, 0.008, 0.007, sx * 0.0112, 0.002, -0.012 - i * 0.014), M.rubber));
  grp.add(new THREE.Mesh(bx(0.012, 0.002, 0.03, 0, 0.0112, -0.03), M.rubber));
  return 0.055;
}

function flashHider(g, M, mz, y) {
  g.s(M.steel, cz(0.0105, 0.0105, mz, mz - 0.048, 0, y, 20));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    if (Math.sin(a) < -0.6) continue; // closed bottom
    g.s(M.rubber, bx(0.002, 0.004, 0.026, Math.cos(a) * 0.0103, y + Math.sin(a) * 0.0103, mz - 0.03));
  }
  return 0.048;
}

function laserModule(g, M, x, y, z) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  g.body.add(grp);
  grp.add(new THREE.Mesh(rb(0.022, 0.026, 0.05, 0, 0, 0, 0.004), M.polymer));
  grp.add(new THREE.Mesh(cz(0.0045, 0.0045, -0.025, -0.027, 0, 0.005, 12), M.reticle));
  grp.add(new THREE.Mesh(cz(0.006, 0.006, -0.025, -0.027, 0, -0.006, 12), M.lens));
  grp.add(new THREE.Mesh(bx(0.006, 0.004, 0.01, 0.0, 0.014, 0.012), M.steel));
  return V(x, y + 0.005, z - 0.027);
}

// --- Kestrel AR ------------------------------------------------------------------------
function buildKestrel(M, att, opts) {
  const g = new Gun('kestrel', M);
  const A = M.anodized, P = M.polymer, S = M.steel;
  // Upper receiver
  g.s(A, rb(0.024, 0.04, 0.26, 0, 0.02, -0.045, 0.003));
  picatinny(g, A, 0.083, -0.172, 0.043);
  g.s(A, cx(0.006, 0.018, 0.015, 0.028, 0.055, 14));             // forward assist
  g.s(S, cx(0.0045, 0.006, 0.026, 0.028, 0.055, 14));
  g.s(A, rb(0.008, 0.012, 0.016, 0.0145, 0.03, 0.012, 0.002));     // brass deflector
  g.s(A, rb(0.044, 0.006, 0.012, 0, 0.036, 0.098, 0.002));          // charging handle
  g.s(A, rb(0.012, 0.004, 0.03, 0, 0.034, 0.075, 0.0015));
  // Ejection port recess
  g.s(M.rubber, bx(0.0012, 0.019, 0.066, 0.0118, 0.022, -0.038));
  const bolt = g.m(M.nickel, rb(0.003, 0.014, 0.05, 0.0112, 0.022, -0.035, 0.0012), g.body, 'bolt');
  g.parts.bolt = bolt;
  g.parts.boltRest = bolt.position.clone();
  const dcPivot = g.pivot(g.body, 0.0128, 0.0118, -0.038, 'dustCover');
  g.m(A, rb(0.0016, 0.021, 0.068, 0, 0.0108, 0, 0.0006), dcPivot);
  g.parts.dustCover = dcPivot;
  // Lower receiver
  g.s(A, rb(0.022, 0.028, 0.21, 0, -0.012, -0.02, 0.003));
  g.s(A, rb(0.026, 0.05, 0.072, 0, -0.04, -0.091, 0.003));         // magwell
  g.s(A, rb(0.03, 0.006, 0.076, 0, -0.064, -0.091, 0.002));         // flared lip
  g.s(A, rb(0.012, 0.004, 0.08, 0, -0.058, -0.014, 0.0015));        // trigger guard
  g.s(A, rb(0.012, 0.03, 0.006, 0, -0.044, -0.052, 0.0015));
  g.s(S, cx(0.0028, 0.026, 0, -0.008, 0.07, 10));                  // takedown pins
  g.s(S, cx(0.0028, 0.026, 0, -0.01, -0.11, 10));
  g.s(S, cx(0.004, 0.003, 0.0125, -0.025, -0.05, 12));              // mag release
  g.s(A, rb(0.003, 0.012, 0.016, -0.0125, -0.006, -0.04, 0.001));   // bolt catch paddle
  // Pistol grip
  g.s(P, profile([[0.024, -0.024], [0.058, -0.022], [0.082, -0.128], [0.078, -0.138], [0.045, -0.142], [0.034, -0.13], [0.036, -0.1], [0.028, -0.07], [0.03, -0.05]], 0.028, 0.004));
  // Trigger (pivots)
  const trig = g.pivot(g.body, 0, -0.022, -0.012, 'trigger');
  g.m(S, profile([[0, 0], [0.004, 0], [0.002, -0.012], [-0.002, -0.024], [-0.006, -0.026], [-0.004, -0.02], [-0.002, -0.01]], 0.005, 0.0008), trig);
  g.parts.trigger = trig;
  // Fire selector (left side)
  const sel = g.pivot(g.body, -0.0125, -0.012, 0.035, 'selector');
  g.m(S, rb(0.003, 0.005, 0.02, -0.001, 0, -0.008, 0.001), sel);
  g.m(S, cx(0.0045, 0.003, -0.0005, 0, 0, 12), sel);
  g.parts.selector = sel;
  // Buffer tube and stock
  g.s(A, cz(0.0155, 0.0155, 0.083, 0.27, 0, 0.012, 24));
  g.s(A, cz(0.019, 0.019, 0.083, 0.092, 0, 0.012, 24));              // castle nut
  g.s(P, profile([[0.165, 0.032], [0.282, 0.034], [0.298, 0.036], [0.304, -0.09], [0.288, -0.095], [0.25, -0.055], [0.2, -0.026], [0.165, -0.012]], 0.04, 0.005));
  g.s(M.rubber, rb(0.04, 0.13, 0.014, 0, -0.028, 0.305, 0.004));
  g.s(P, rb(0.03, 0.01, 0.06, 0, 0.042, 0.225, 0.003));             // cheek riser
  // Handguard: octagonal, free-floated, with M-LOK slots
  const hg = new THREE.CylinderGeometry(0.0265, 0.0265, 0.38, 8, 1);
  hg.rotateX(Math.PI / 2); hg.rotateZ(Math.PI / 8); hg.translate(0, 0.016, -0.365);
  g.s(A, hg);
  picatinny(g, A, -0.176, -0.548, 0.043);
  for (let i = 0; i < 6; i++) {
    const z = -0.22 - i * 0.052;
    for (const a of [Math.PI / 4, -Math.PI / 4, Math.PI / 2 + Math.PI / 4 + Math.PI / 2, Math.PI, 0, -Math.PI / 2]) {
      if (a === -Math.PI / 2 && i % 2) continue;
      const r = 0.0262;
      const slot = rb(0.0025, 0.0075, 0.03, 0, 0, 0, 0.0012);
      slot.rotateZ(a);
      slot.translate(Math.cos(a) * r, 0.016 + Math.sin(a) * r, z);
      g.s(M.rubber, slot);
    }
  }
  g.s(S, cx(0.006, 0.006, 0.027, 0.016, -0.2, 14));                // QD sling cup
  // Barrel, gas block, muzzle
  g.s(S, cz(0.0095, 0.0095, -0.55, -0.66, 0, 0.016, 20));
  let muzzleZ = -0.66;
  if (att.muzzle === 'suppressor') muzzleZ -= suppressor(g, M, muzzleZ, 0.016);
  else if (att.muzzle === 'compensator') muzzleZ -= compensator(g, M, muzzleZ, 0.016);
  else muzzleZ -= flashHider(g, M, muzzleZ, 0.016);
  g.anchors.muzzle = V(0, 0.016, muzzleZ - 0.01);
  // Iron sights (fold down under an optic)
  const optic = att.optic;
  const front = g.pivot(g.body, 0, 0.049, -0.525, 'frontSight');
  g.m(A, rb(0.02, 0.008, 0.02, 0, 0.004, 0, 0.002), front);
  g.m(A, rb(0.016, 0.022, 0.006, 0, 0.018, 0, 0.002), front);
  g.m(S, rb(0.0022, 0.012, 0.0022, 0, 0.032, 0, 0.0005), front);
  const rear = g.pivot(g.body, 0, 0.049, 0.06, 'rearSight');
  g.m(A, rb(0.02, 0.008, 0.024, 0, 0.004, 0, 0.002), rear);
  g.m(A, rb(0.018, 0.022, 0.005, 0, 0.018, 0, 0.002), rear);
  const ap = new THREE.TorusGeometry(0.0035, 0.0018, 8, 16);
  ap.translate(0, 0.0245, 0);
  g.m(S, ap, rear);
  if (optic) { front.rotation.x = -Math.PI / 2 * 0.98; rear.rotation.x = Math.PI / 2 * 0.98; front.position.y -= 0.002; }
  // Optic
  let sight;
  if (optic === 'reddot') { const o = redDot(g, M, 0.047, 0.01); sight = { y: o.axisY, z: o.eyeZ + 0.11, reticleZ: o.reticleZ, kind: 'dot' }; }
  else if (optic === 'scope4x') { const o = scope4x(g, M, 0.047, 0.0); sight = { y: o.axisY, z: o.eyeZ + o.relief, kind: 'scope', ocular: o.ocular }; }
  else sight = { y: 0.0735, z: 0.06 + 0.19, kind: 'iron' };
  g.sight = sight;
  // Underbarrel
  if (att.underbarrel === 'vgrip') {
    g.s(A, rb(0.02, 0.01, 0.03, 0, -0.016, -0.36, 0.002));
    g.s(P, cy(0.0125, 0.085, 0, -0.062, -0.36, 18));
    for (let i = 0; i < 3; i++) g.s(P, cy(0.0132, 0.004, 0, -0.04 - i * 0.022, -0.36, 18));
    g.anchors.fore = V(0, -0.075, -0.36);
    g.foreGrip = 'vertical';
  } else if (att.underbarrel === 'agrip') {
    g.s(P, profile([[-0.3, -0.012], [-0.37, -0.012], [-0.375, -0.02], [-0.3, -0.05], [-0.29, -0.045]], 0.022, 0.003));
    g.anchors.fore = V(0, -0.03, -0.32);
    g.foreGrip = 'angled';
  } else {
    g.anchors.fore = V(0, -0.012, -0.34);
    g.foreGrip = 'handguard';
  }
  if (att.laser) g.anchors.laser = laserModule(g, M, 0.04, 0.016, -0.46);
  // Markings
  if (opts.fp) {
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.022), new THREE.MeshBasicMaterial({ map: textDecal([{ text: 'KESTREL ARMS · KR-5', size: 0.55 }, { text: 'CAL 5.56 NATO  SN KR-041779', size: 0.5 }]), transparent: true, depthWrite: false }));
    dec.position.set(-0.01105, -0.012, -0.03); dec.rotation.y = -Math.PI / 2;
    g.body.add(dec);
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.018), new THREE.MeshBasicMaterial({ map: textDecal([{ text: 'SAFE', size: 0.8 }, { text: 'SEMI', size: 0.8 }, { text: 'AUTO', size: 0.8 }], 128, 128), transparent: true, depthWrite: false }));
    sm.position.set(-0.01106, -0.012, 0.052); sm.rotation.y = -Math.PI / 2;
    g.body.add(sm);
  }
  // Magazine with a witness window that shows the remaining rounds.
  g.mag = buildRifleMag(M, att.magazine === 'extmag', opts.fp);
  g.mag.group.position.set(0, 0, 0);
  g.body.add(g.mag.group);
  g.anchors.grip = V(0, -0.06, 0.05);
  g.anchors.eject = V(0.016, 0.022, -0.03);
  g.anchors.magWell = V(0, -0.07, -0.095);
  g.caliber = '556';
  return g;
}

export function buildRifleMag(M, ext, fp) {
  const grp = new THREE.Group();
  grp.name = 'mag';
  const bottom = ext ? -0.3 : -0.232;
  const pts = [[-0.124, -0.012], [-0.066, -0.012], [-0.068, -0.08], [-0.074, -0.15], [-0.083, bottom + 0.022], [-0.088, bottom], [-0.152, bottom], [-0.151, bottom + 0.022], [-0.142, -0.15], [-0.13, -0.08]];
  grp.add(new THREE.Mesh(profile(pts, 0.0225, 0.002), M.polymer));
  const base = rb(0.026, 0.008, 0.07, 0, bottom - 0.002, -0.12, 0.003);
  grp.add(new THREE.Mesh(base, M.polymer));
  // Ribs on the lower body
  for (let i = 0; i < 4; i++) {
    const y = -0.13 - i * 0.018;
    const t = (y + 0.08) / (bottom + 0.08);
    const zc = -0.106 - Math.max(0, t) * 0.012;
    grp.add(new THREE.Mesh(rb(0.0235, 0.004, 0.05, 0, y, zc, 0.0012), M.polymer));
  }
  // Top rounds (visible at the feed lips when the mag is out)
  const rounds = [];
  if (fp) {
    for (let i = 0; i < 2; i++) {
      const r = makeRound(M, '556');
      r.position.set(i ? 0.0035 : -0.0035, -0.008 - i * 0.004, -0.07);
      grp.add(r);
      rounds.push(r);
    }
  }
  // Witness window on the right side
  const window = [];
  if (fp) {
    const winTop = -0.06, n = 15;
    grp.add(new THREE.Mesh(rb(0.0006, 0.135, 0.009, 0.0114, winTop - 0.0675, -0.0745, 0.0003), M.rubber));
    for (let i = 0; i < n; i++) {
      const y = winTop - 0.004 - i * 0.0088;
      const t = Math.max(0, (y + 0.08) / (bottom + 0.08));
      const m = new THREE.Mesh(bx(0.0006, 0.0062, 0.0075, 0.0116, y, -0.0745 - t * 0.008), M.brass);
      grp.add(m);
      window.push(m);
    }
  }
  return {
    group: grp, rounds, window, capacity: ext ? 40 : 30,
    setAmmo(n) {
      for (let i = 0; i < rounds.length; i++) rounds[i].visible = n > i;
      const per = window.length ? this.capacity / window.length : 1;
      for (let i = 0; i < window.length; i++) window[i].visible = i < Math.ceil(n / per);
    },
  };
}

// --- Warden pistol ------------------------------------------------------------------------
function buildWarden(M, att, opts) {
  const g = new Gun('warden', M);
  const P = M.polymer, S = M.steel;
  const slide = g.pivot(g.body, 0, 0, 0, 'slide');
  g.parts.slide = slide;
  const slideLen = 0.186, sy = 0.051;
  g.m(S, profile([[0.03, sy - 0.015], [0.03, sy + 0.012], [0.025, sy + 0.015], [-0.148, sy + 0.015], [-0.156, sy + 0.009], [-0.156, sy - 0.015]], 0.0255, 0.0015), slide);
  // Rear serrations
  for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) g.m(M.rubber, bx(0.0008, 0.022, 0.0016, sx * 0.0128, sy - 0.002, 0.026 - i * 0.0032), slide);
  // Ejection port and the barrel hood visible inside it
  g.m(M.rubber, bx(0.013, 0.0012, 0.03, 0.0035, sy + 0.0152, -0.038), slide);
  const hood = g.m(M.nickel, rb(0.011, 0.004, 0.028, 0.0035, sy + 0.012, -0.038, 0.001));
  void hood;
  // Sights with tritium dots
  g.m(S, rb(0.02, 0.006, 0.008, 0, sy + 0.018, 0.022, 0.001), slide);
  g.m(M.rubber, bx(0.0035, 0.0045, 0.0085, 0, sy + 0.0195, 0.022), slide);
  for (const sx of [-0.0055, 0.0055]) g.m(M.tritium, cz(0.0012, 0.0012, 0.0182, 0.0178, sx, sy + 0.019, 8), slide);
  g.m(S, rb(0.0035, 0.007, 0.006, 0, sy + 0.019, -0.146, 0.0008), slide);
  g.m(M.tritium, cz(0.0013, 0.0013, -0.1428, -0.1432, 0, sy + 0.0205, 8), slide);
  // Muzzle bore
  g.m(M.rubber, cz(0.0045, 0.0045, -0.1562, -0.1566, 0, sy - 0.003, 14), slide);
  const marks = opts.fp ? new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.012), new THREE.MeshBasicMaterial({ map: textDecal([{ text: 'WARDEN  P9  9×19', size: 0.8 }], 512, 64), transparent: true, depthWrite: false })) : null;
  if (marks) { marks.position.set(-0.01285, sy - 0.002, -0.07); marks.rotation.y = -Math.PI / 2; slide.add(marks); }
  // Frame
  g.s(P, profile([[0.026, 0.035], [-0.15, 0.035], [-0.152, 0.028], [-0.152, 0.02], [-0.06, 0.016], [-0.058, 0.0], [-0.052, -0.004], [-0.022, -0.004], [-0.016, 0.012], [0.0, 0.016], [0.028, 0.022]], 0.024, 0.002));
  g.s(P, profile([[-0.002, 0.016], [0.036, 0.024], [0.042, 0.018], [0.052, -0.08], [0.05, -0.092], [0.014, -0.094], [0.008, -0.086], [0.004, -0.06], [0.006, -0.04], [0.0, -0.02], [0.004, 0.0]], 0.029, 0.004));
  picatinny(g, P, -0.08, -0.14, 0.012, 0.018);
  // Trigger
  const trig = g.pivot(g.body, 0, 0.012, -0.03, 'trigger');
  g.m(P, profile([[0, 0], [0.004, 0], [0.003, -0.012], [-0.002, -0.02], [-0.005, -0.018], [-0.002, -0.01]], 0.006, 0.0008), trig);
  g.parts.trigger = trig;
  g.s(S, cx(0.0022, 0.026, 0, 0.01, -0.02, 10));
  let muzzleZ = -0.156;
  if (att.muzzle === 'suppressor') {
    g.s(S, cz(0.0055, 0.0055, -0.156, -0.168, 0, sy - 0.003, 14));
    muzzleZ = -0.168 - suppressor(g, M, -0.168, sy - 0.003, 0.016, 0.14);
  }
  g.anchors.muzzle = V(0, sy - 0.003, muzzleZ - 0.008);
  // Optic (slide-mounted, moves with the slide)
  if (att.optic === 'reddot') {
    const o = redDot({ body: slide }, M, sy + 0.015, -0.005, true);
    g.sight = { y: o.axisY, z: 0.22, reticleZ: o.reticleZ, kind: 'dot', onSlide: true };
  } else {
    g.sight = { y: sy + 0.0205, z: 0.25, kind: 'iron' };
  }
  if (att.laser) g.anchors.laser = laserModule(g, M, 0, 0.002, -0.11);
  g.mag = buildPistolMag(M, att.magazine === 'extmag', opts.fp);
  g.body.add(g.mag.group);
  g.anchors.grip = V(0, -0.04, 0.028);
  g.anchors.fore = V(-0.004, -0.05, 0.012);
  g.foreGrip = 'cup';
  g.anchors.eject = V(0.012, sy + 0.012, -0.035);
  g.anchors.magWell = V(0, -0.1, 0.03);
  g.caliber = '9mm';
  return g;
}

function buildPistolMag(M, ext, fp) {
  const grp = new THREE.Group();
  grp.name = 'mag';
  const bottom = ext ? -0.112 : -0.094;
  grp.add(new THREE.Mesh(profile([[0.008, 0.014], [0.036, 0.02], [0.048, bottom + 0.004], [0.016, bottom + 0.002], [0.006, -0.03]], 0.02, 0.0015), M.steel));
  grp.add(new THREE.Mesh(rb(0.031, ext ? 0.016 : 0.008, 0.044, 0, bottom - (ext ? 0.006 : 0.002), 0.032, 0.003), M.polymer));
  const rounds = [];
  if (fp) {
    const r = makeRound(M, '9mm');
    r.position.set(0, 0.022, 0.03);
    grp.add(r);
    rounds.push(r);
  }
  return { group: grp, rounds, window: [], capacity: ext ? 21 : 17, setAmmo(n) { for (const r of rounds) r.visible = n > 0; } };
}

// --- Bastion pump shotgun ---------------------------------------------------------------
function buildBastion(M, att, opts) {
  const g = new Gun('bastion', M);
  const S = M.steel, P = M.polymer;
  // Receiver
  g.s(S, rb(0.031, 0.058, 0.2, 0, 0.022, -0.03, 0.004));
  g.s(S, rb(0.028, 0.006, 0.19, 0, 0.053, -0.03, 0.002));
  g.s(M.rubber, bx(0.0012, 0.026, 0.07, 0.0158, 0.028, -0.04));       // ejection port
  g.s(M.rubber, bx(0.022, 0.0012, 0.08, 0, -0.0072, -0.04));           // loading port
  g.s(M.anodized, rb(0.014, 0.004, 0.09, 0, -0.012, 0.025, 0.0015));   // trigger guard
  g.s(M.anodized, rb(0.014, 0.024, 0.006, 0, -0.022, -0.016, 0.0015));
  g.s(S, cx(0.003, 0.034, 0, -0.004, 0.058, 10));                      // cross-bolt safety
  const trig = g.pivot(g.body, 0, -0.005, 0.03, 'trigger');
  g.m(S, profile([[0, 0], [0.004, 0], [0.002, -0.014], [-0.004, -0.024], [-0.005, -0.016], [-0.002, -0.008]], 0.005, 0.0008), trig);
  g.parts.trigger = trig;
  // Barrel with vent rib and bead
  g.s(S, cz(0.0118, 0.0118, -0.13, -0.6, 0, 0.034, 22));
  g.s(S, bx(0.008, 0.003, 0.46, 0, 0.0475, -0.365));
  for (let z = -0.15; z > -0.59; z -= 0.035) g.s(S, bx(0.004, 0.004, 0.006, 0, 0.0435, z));
  // Front sight: a short post on the rib topped with a brass bead, plus a mid-rib bead.
  g.s(S, rb(0.004, 0.012, 0.006, 0, 0.055, -0.592, 0.001));
  g.s(M.brass, new THREE.SphereGeometry(0.0024, 10, 8).translate(0, 0.0625, -0.592));
  g.s(M.nickel, new THREE.SphereGeometry(0.0014, 8, 6).translate(0, 0.0505, -0.36));
  let muzzleZ = -0.6;
  if (att.muzzle === 'choke') {
    g.s(S, cz(0.0128, 0.0128, -0.6, -0.635, 0, 0.034, 22));
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) g.s(M.rubber, bx(0.002, 0.006, 0.005, sx * 0.0126, 0.038, -0.608 - i * 0.009));
    muzzleZ = -0.635;
  }
  g.anchors.muzzle = V(0, 0.034, muzzleZ - 0.01);
  // Magazine tube and cap
  g.s(S, cz(0.0112, 0.0112, -0.13, -0.52, 0, -0.0005, 20));
  g.s(S, lathe([[0.0118, 0], [0.0122, 0.004], [0.0122, 0.016], [0.009, 0.02], [0, 0.021]], 20).rotateX(-Math.PI / 2).translate(0, -0.0005, -0.52));
  g.s(S, rb(0.008, 0.012, 0.012, 0, 0.017, -0.5, 0.002));               // barrel clamp
  // Pump forend (moves)
  const pump = g.pivot(g.body, 0, 0, 0, 'pump');
  g.m(P, cz(0.021, 0.021, -0.2, -0.36, 0, -0.002, 22), pump);
  for (let i = 0; i < 9; i++) g.m(P, cz(0.0222, 0.0222, -0.215 - i * 0.016, -0.222 - i * 0.016, 0, -0.002, 22), pump);
  g.parts.pump = pump;
  // Stock with pistol-grip wrist
  g.s(P, profile([[0.068, 0.05], [0.068, -0.006], [0.12, -0.03], [0.15, -0.075], [0.172, -0.072], [0.17, -0.04], [0.42, -0.085], [0.432, -0.09], [0.432, 0.022], [0.41, 0.028], [0.17, 0.034], [0.09, 0.05]], 0.04, 0.005));
  g.s(M.rubber, rb(0.042, 0.122, 0.024, 0, -0.034, 0.444, 0.005));
  // Side saddle (left) with shells that reflect your reserve
  g.s(P, rb(0.008, 0.032, 0.09, -0.02, 0.026, -0.03, 0.002));
  const saddle = [];
  for (let i = 0; i < 4; i++) {
    const r = makeRound(M, 'shell');
    r.rotation.x = -Math.PI / 2; // hanging brass-up, below the sight line
    r.position.set(-0.033, 0.044, -0.062 + i * 0.022);
    g.body.add(r);
    saddle.push(r);
  }
  g.saddle = saddle;
  if (opts.fp) {
    const marks = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.02), new THREE.MeshBasicMaterial({ map: textDecal([{ text: 'BASTION M12', size: 0.65 }, { text: '12 GA · 2¾" & 3"', size: 0.55 }], 512, 96), transparent: true, depthWrite: false }));
    marks.position.set(0.0157, 0.012, 0.03); marks.rotation.y = Math.PI / 2;
    g.body.add(marks);
  }
  if (att.optic === 'reddot') { const o = redDot(g, M, 0.056, -0.03); g.sight = { y: o.axisY, z: o.eyeZ + 0.13, reticleZ: o.reticleZ, kind: 'dot' }; }
  else g.sight = { y: 0.065, z: 0.4, kind: 'iron' };
  if (att.laser) g.anchors.laser = laserModule(g, M, 0.03, 0.0, -0.48);
  // A shell that appears in the port as it cycles
  const ejectShell = makeRound(M, 'shell');
  ejectShell.rotation.y = Math.PI / 2;
  ejectShell.position.set(0.006, 0.028, -0.04);
  ejectShell.visible = false;
  g.body.add(ejectShell);
  g.parts.portShell = ejectShell;
  g.mag = { group: new THREE.Group(), rounds: [], window: [], capacity: att.magazine === 'extmag' ? 8 : 6, setAmmo() {} };
  if (att.magazine === 'extmag') g.s(S, cz(0.0112, 0.0112, -0.52, -0.58, 0, -0.0005, 20));
  g.anchors.grip = V(0, -0.045, 0.15);
  g.anchors.fore = V(0, -0.012, -0.29);
  g.foreGrip = 'pump';
  g.anchors.eject = V(0.018, 0.03, -0.04);
  g.anchors.magWell = V(0, -0.01, -0.05);
  g.caliber = 'shell';
  return g;
}

const BUILDERS = { kestrel: buildKestrel, warden: buildWarden, bastion: buildBastion };

// opts: { fp: first-person detail (markings, rounds), shadows }
export function buildGun(id, att, M, opts = {}) {
  const g = BUILDERS[id](M, att || {}, opts);
  g.finish(opts.shadows);
  g.att = Object.assign({}, att);
  return g;
}

// Flatten a gun into a few merged meshes (for third-person characters).
export function bakeGun(gun) {
  const groups = new Map();
  gun.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(gun.root.matrixWorld).invert();
  gun.root.traverse((o) => {
    if (!o.isMesh || !o.visible || o.material.transparent && o.material.depthWrite === false) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!groups.has(o.material)) groups.set(o.material, []);
    groups.get(o.material).push(geo);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of groups) {
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.castShadow = true;
    out.add(mesh);
  }
  out.userData.anchors = gun.anchors;
  return out;
}

export { makeRound };
