// Ram-air parachute: a nine-cell, rectangular-elliptical canopy (top and bottom skins pillowing
// between the ribs, open cell mouths along a curved leading edge, an anhedral arc, stabiliser
// panels at the tips), suspension lines cascading to four risers, brake lines to the toggles, a
// slider riding down the lines, and a pilot chute with its bridle and deployment bag.
//
// Local frame (the group): origin at the harness (between the shoulders), +Y up the risers to the
// canopy, -Z forward (the direction the canopy flies), +X to the jumper's right. The Drop places
// the group and steers the opening; this module only shapes what it is told:
//   update(dt, { bag, pc, k, slider, brakeL, brakeR, collapse, shoulderL, shoulderR, handL, handR })
//     bag      0..1 deployment bag lifted from the container to line stretch
//     pc       0..1 pilot chute inflated
//     k        0..1 canopy inflation (0 = a bundle at line stretch, 1 = flying)
//     slider   0..1 slider down the lines (0 = against the canopy, 1 = down at the links)
//     brakeL/R 0..1 toggles pulled (trailing edge deflected on that side)
//     collapse 0..1 deflating after touchdown (falls forward onto the ground)
//     shoulder*/hand* world positions of the harness and the hands (risers and steering lines)
import * as THREE from 'three';

const CELLS = 9;
const SPAN = 7.4;          // span along the arc, m
const CHORD = 2.9;         // centre chord, m
const LINE_R = 5.2;        // arc radius: connector links to the chord line
const LINK_Y = 0.55;       // riser length
const THICK = 0.16;        // airfoil thickness / chord
const TRIM = -0.1;         // nose-down trim, rad
const PHI = SPAN / 2 / LINE_R;
const NT = 22, NB = 14, SUB = 6;
const LIP = 0.1;           // the bottom skin starts this far back: the cell mouths
const ROWS = [0.12, 0.34, 0.58, 0.84];   // A, B, C, D line attachment, fraction of chord
const BRAKES = [0.3, 0.55, 0.78, 0.97];

// Canopy colour schemes (sRGB), cell by cell from the left tip; mirrored when shorter.
export const SCHEMES = [
  [0x3d4632, 0x3d4632, 0xb9a77c, 0x3d4632, 0x262a22],          // olive and sand, black centre
  [0x1d1f22, 0x8a8f94, 0x1d1f22, 0xb4271e, 0x1d1f22],          // black, grey, red centre
  [0x23436e, 0xe9e6dc, 0x23436e, 0xe8b628, 0x23436e],          // navy, white, yellow
  [0xb52a1f, 0xe9e6dc, 0xb52a1f, 0xe9e6dc, 0xb52a1f],          // red and white
  [0xd2611f, 0x22313f, 0xd2611f, 0x22313f, 0xe9e6dc],          // orange and navy
  [0x56602e, 0x56602e, 0x2c3220, 0x8f7a4f, 0x56602e],          // woodland
  [0x6c2f7a, 0xe9e6dc, 0x6c2f7a, 0x1d1f22, 0xe9e6dc],          // purple
  [0x1e6b5a, 0xe1d9c2, 0x1e6b5a, 0x1e6b5a, 0xe1d9c2],          // teal
];

const yt = (c) => 5 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c * c * c - 0.1036 * c * c * c * c);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

// Leading and trailing edge (z) at span position s (-1..1): the tips are swept and shortened.
function edges(s) {
  const a = Math.abs(s), a3 = a * a * a;
  return [CHORD * (-0.3 + 0.17 * a3 * a), CHORD * (0.7 - 0.06 * a3)];
}

// A point on the canopy in its inflated shape. surf: 1 top skin, -1 bottom skin (ribs use
// either at the rib's own s, where the pillowing vanishes). bl, br: brakes.
function canopyPoint(s, c, surf, bl, br, out) {
  const [zLE, zTE] = edges(s);
  const L = zTE - zLE;
  let z = zLE + c * L;
  const t = yt(Math.max(0, c)) * 2 * THICK * L;
  let y = surf > 0 ? t * 0.78 : -t * 0.22;
  // cells pillow between the ribs, the top more than the bottom, and the mouths bow forward
  const u = ((s + 1) / 2) * CELLS, fr = u - Math.floor(u);
  const bulge = Math.sin(Math.PI * fr) * (1 - c * c * c * c);
  if (surf > 0) {
    y += bulge * (0.035 + 0.045 * Math.sin(Math.PI * Math.min(1, c * 1.4)));
    if (c < 0.14) { z -= bulge * 0.08 * (1 - c / 0.14); y -= bulge * 0.03 * (1 - c / 0.14); }
  } else {
    y -= bulge * 0.03;
    if (c < LIP + 0.06) z += bulge * 0.05 * (1 - (c - LIP) / 0.06);
  }
  // toggles pull the trailing edge down on their side
  const side = s < 0 ? bl * smooth((-s - 0.05) / 0.6) : br * smooth((s - 0.05) / 0.6);
  if (c > 0.55) y -= side * 0.6 * Math.pow((c - 0.55) / 0.45, 2) * (L / CHORD);
  // nose-down trim, then wrap the span round the arc
  const ca = Math.cos(TRIM), sa = Math.sin(TRIM);
  const yr = y * ca - z * sa, zr = y * sa + z * ca;
  const rho = LINE_R + yr, phi = s * PHI;
  return out.set(rho * Math.sin(phi), LINK_Y + rho * Math.cos(phi), zr);
}

// The same point at line stretch: a crumpled bundle hanging at the top of the lines.
function bundlePoint(s, c, surf, out) {
  const [zLE, zTE] = edges(s);
  const L = zTE - zLE;
  const z = (zLE + c * L - CHORD * 0.2) * 0.32 + CHORD * 0.2 * 0.32;
  const t = yt(Math.max(0, c)) * 2 * THICK * L * 0.3;
  const wr = Math.sin(s * 23 + c * 9) * 0.05 + Math.sin(s * 41 - c * 17) * 0.03;
  const rho = LINE_R + 0.55 + (surf > 0 ? t : -t * 0.3) + wr + c * 0.35;
  const phi = s * PHI * 0.09;
  return out.set(rho * Math.sin(phi) + wr * 0.6, LINK_Y + rho * Math.cos(phi), z + wr * 0.5);
}

// --- shared resources --------------------------------------------------------------------
let SHARED_RES = null;
function resources() {
  if (SHARED_RES) return SHARED_RES;
  let tex = null;
  if (typeof document !== 'undefined') {
    // one cell wide (v) by a metre of chord (u): rib seams along the edges, a spanwise panel
    // seam, ripstop grid and stitching
    const W = 256, H = 256;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 1;
    for (let i = 0; i <= W; i += 8) { g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, H); g.stroke(); g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(W, i + 0.5); g.stroke(); }
    // rib seams (top and bottom of the tile): tape with two rows of stitching
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, W, 5); g.fillRect(0, H - 5, W, 5);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 5, W, 2); g.fillRect(0, H - 7, W, 2);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    for (let x = 0; x < W; x += 6) { g.fillRect(x, 1, 3, 1); g.fillRect(x, 3, 3, 1); g.fillRect(x, H - 2, 3, 1); g.fillRect(x, H - 4, 3, 1); }
    // spanwise panel seam
    g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, 0, 4, H);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < H; y += 6) g.fillRect(1, y, 1, 3);
    tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  }
  const fabric = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, bumpMap: tex, bumpScale: 0.6, roughness: 0.66, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.55, name: 'canopyFabric' });
  const plain = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.8, side: THREE.DoubleSide, name: 'canopyDark' });
  const webbing = new THREE.MeshStandardMaterial({ color: 0x2b2d24, roughness: 0.85, name: 'riserWebbing' });
  const mesh = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, name: 'pcMesh' });
  const line = new THREE.LineBasicMaterial({ color: 0x3c3a36, transparent: true, opacity: 0.85 });
  const pcFabric = new THREE.MeshStandardMaterial({ color: 0xc9c2b0, roughness: 0.7, side: THREE.DoubleSide, name: 'pcFabric' });
  const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // pilot chute: a shallow dome with a mesh skirt; deployment bag: a soft box
  const dome = new THREE.LatheGeometry([[0.001, 0.36], [0.16, 0.34], [0.3, 0.27], [0.4, 0.15], [0.45, 0.02]].map((p) => new THREE.Vector2(p[0], p[1])), 16);
  const skirt = new THREE.CylinderGeometry(0.45, 0.22, 0.32, 16, 1, true).translate(0, -0.14, 0);
  const bag = new THREE.BoxGeometry(0.34, 0.22, 0.26, 2, 2, 2);
  {
    const p = bag.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 - 0.18 * (Math.abs(x * y) + Math.abs(y * z)) * 6; p.setXYZ(i, x * k, y * k, z * k); }
    bag.computeVertexNormals();
  }
  SHARED_RES = { tex, fabric, plain, webbing, mesh, line, pcFabric, unit, dome, skirt, bag };
  return SHARED_RES;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

// Builds the canopy geometry: per cell a top and a bottom skin (vertices doubled on the ribs so
// the seams crease and the colours stay sharp), the ribs, and the tip stabilisers. Returns the
// geometry and, per vertex, what canopyPoint needs to re-shape it (for the morph targets).
function buildCanopy(colors) {
  const pos = [], uv = [], col = [], idx = [], par = [];
  const C = new THREE.Color();
  const vert = (s, c, surf, color) => {
    const [zLE, zTE] = edges(s);
    par.push(s, c, surf);
    uv.push(c * (zTE - zLE), ((s + 1) / 2) * CELLS);
    col.push(color.r, color.g, color.b);
    pos.push(0, 0, 0);
    return pos.length / 3 - 1;
  };
  const grid = (n, m, at, flip) => {
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
      const a = at + i * m + j, b = a + m, c = a + 1, d = b + 1;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  };
  const cellColor = (ci) => {
    const half = colors.length;
    const k = ci < half ? ci : CELLS - 1 - ci;
    return C.setHex(colors[Math.min(half - 1, Math.max(0, k))]).clone();   // sRGB hex, stored linear
  };
  for (let ci = 0; ci < CELLS; ci++) {
    const color = cellColor(ci);
    const s0 = -1 + (2 * ci) / CELLS, s1 = -1 + (2 * (ci + 1)) / CELLS;
    for (const surf of [1, -1]) {
      const at = pos.length / 3, m = surf > 0 ? NT : NB;
      for (let i = 0; i <= SUB; i++) {
        const s = s0 + (s1 - s0) * (i / SUB);
        for (let j = 0; j < m; j++) {
          const f = j / (m - 1);
          const c = surf > 0 ? Math.pow(f, 1.6) : LIP + (1 - LIP) * Math.pow(f, 1.25);
          vert(s, c, surf, surf > 0 ? color : color.clone().multiplyScalar(0.82));
        }
      }
      grid(SUB + 1, m, at, surf < 0);
    }
  }
  // ribs: top curve to the bottom skin (the nose part runs down to the lip: the mouth's edge)
  for (let r = 0; r <= CELLS; r++) {
    const s = -1 + (2 * r) / CELLS;
    const color = cellColor(Math.min(CELLS - 1, r)).multiplyScalar(0.7);
    const at = pos.length / 3;
    for (let j = 0; j < NT; j++) {
      const c = Math.pow(j / (NT - 1), 1.6);
      vert(s, c, 1, color);
      vert(s, Math.max(LIP, c), -1, color);
    }
    for (let j = 0; j < NT - 1; j++) {
      const a = at + j * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  // stabilisers: a fabric panel hanging under each tip
  for (const s of [-1, 1]) {
    const color = cellColor(s < 0 ? 0 : CELLS - 1);
    const a = vert(s, 0.18, -1, color), b = vert(s, 0.8, -1, color), c = vert(s, 0.5, -2, color);
    idx.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  // base shape (flying), then the morphs as offsets from it: bundled, left brake, right brake
  const n = par.length / 3;
  const base = g.attributes.position.array;
  const morphs = [new Float32Array(n * 3), new Float32Array(n * 3), new Float32Array(n * 3)];
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  const at = (s, c, surf, bl, br, out) => {
    if (surf === -2) { canopyPoint(s, c, -1, bl, br, out); out.x -= Math.sign(s) * 0.12; out.y -= 0.62; return out; }
    return canopyPoint(s, c, surf, bl, br, out);
  };
  for (let i = 0; i < n; i++) {
    const s = par[i * 3], c = par[i * 3 + 1], surf = par[i * 3 + 2];
    at(s, c, surf, 0, 0, p);
    base[i * 3] = p.x; base[i * 3 + 1] = p.y; base[i * 3 + 2] = p.z;
    bundlePoint(s, c, surf === -2 ? -1 : surf, q).sub(p).toArray(morphs[0], i * 3);
    at(s, c, surf, 1, 0, q).sub(p).toArray(morphs[1], i * 3);
    at(s, c, surf, 0, 1, q).sub(p).toArray(morphs[2], i * 3);
  }
  g.computeVertexNormals();
  g.morphAttributes.position = morphs.map((a) => new THREE.BufferAttribute(a, 3));
  g.morphTargetsRelative = true;
  g.computeBoundingSphere();
  g.boundingSphere.radius += 3;
  return g;
}

// Line layout: [canopy s, chord, link index] per attachment, and the cascades that join them.
// Links: 0 front left, 1 front right, 2 rear left, 3 rear right.
const LINKS = [new THREE.Vector3(-0.2, LINK_Y, -0.07), new THREE.Vector3(0.2, LINK_Y, -0.07), new THREE.Vector3(-0.2, LINK_Y, 0.09), new THREE.Vector3(0.2, LINK_Y, 0.09)];
const GUIDE = [new THREE.Vector3(-0.22, LINK_Y - 0.14, 0.12), new THREE.Vector3(0.22, LINK_Y - 0.14, 0.12)];
const RIBS_L = [[0, 1], [2, 3], [4]], RIBS_R = [[9, 8], [7, 6], [5]];
const LINE_SEGS = (() => {
  let n = 0;
  for (let row = 0; row < 4; row++) for (const side of [RIBS_L, RIBS_R]) for (const grp of side) n += grp.length + 1;
  n += 2 * (BRAKES.length + 2);   // brake lines, steering line to the guide ring and the hand
  n += 1 + 6;                     // bridle and the pilot chute's own lines
  return n;
})();

export class Parachute {
  constructor(opts = {}) {
    const R = resources();
    const scheme = opts.colors || SCHEMES[(opts.scheme || 0) % SCHEMES.length];
    this.group = new THREE.Group();
    this.group.name = 'parachute';
    this.rig = new THREE.Group();          // tips forward and sinks as the canopy collapses
    this.group.add(this.rig);
    this.canopy = new THREE.Mesh(buildCanopy(scheme), R.fabric);
    this.canopy.morphTargetInfluences = [1, 0, 0];
    this.canopy.castShadow = true;
    this.canopy.receiveShadow = true;
    this.rig.add(this.canopy);
    // suspension, brake and bridle lines: one dynamic line list
    this.linePos = new Float32Array(LINE_SEGS * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(lg, R.line);
    this.lines.frustumCulled = false;
    this.rig.add(this.lines);
    // risers (webbing) and the slider
    this.risers = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(R.unit, R.webbing); m.castShadow = true; this.rig.add(m); return m; });
    this.toggles = [0, 1].map(() => { const m = new THREE.Mesh(R.unit, R.plain); m.scale.set(0.035, 0.09, 0.02); this.rig.add(m); return m; });
    const sg = new THREE.PlaneGeometry(0.76, 0.66, 4, 4).rotateX(-Math.PI / 2);
    { const p = sg.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, 0.06 * Math.cos(p.getX(i) * 4) * Math.cos(p.getZ(i) * 4.5)); sg.computeVertexNormals(); }
    this.slider = new THREE.Mesh(sg, R.plain);
    this.slider.castShadow = true;
    this.rig.add(this.slider);
    this.pc = new THREE.Group();
    const dome = new THREE.Mesh(R.dome, R.pcFabric), skirt = new THREE.Mesh(R.skirt, R.mesh);
    this.pc.add(dome, skirt);
    this.rig.add(this.pc);
    this.bag = new THREE.Mesh(R.bag, R.plain);
    this.rig.add(this.bag);
    // attachment points (s, c) and their current positions in the rig's frame
    this.att = [];
    for (let row = 0; row < 4; row++) for (let r = 0; r <= CELLS; r++) this.att.push({ s: -1 + (2 * r) / CELLS, c: ROWS[row], p: new THREE.Vector3() });
    this.brk = [];
    for (const sx of [-1, 1]) for (const s of BRAKES) this.brk.push({ s: s * sx, c: 1, p: new THREE.Vector3() });
    this.state = { bag: 0, pc: 0, k: 0, slider: 0, brakeL: 0, brakeR: 0, collapse: 0 };
    this.time = 0;
  }

  // Current shape of a canopy point (inflation and brakes), in the rig's frame.
  shapePoint(s, c, surf, out) {
    const st = this.state;
    canopyPoint(s, c, surf, st.brakeL, st.brakeR, out);
    const k = 1 - this.canopy.morphTargetInfluences[0];
    if (k < 1) out.lerp(bundlePoint(s, c, surf, _d), 1 - k);
    return out;
  }

  update(dt, st) {
    Object.assign(this.state, st);
    const S = this.state;
    this.time += dt;
    const k = clamp01(S.k), col = clamp01(S.collapse);
    const bundled = Math.max(1 - k, col);
    const inf = this.canopy.morphTargetInfluences;
    inf[0] = Math.max(1 - k, col * 0.55);
    inf[1] = clamp01(S.brakeL) * (1 - bundled);
    inf[2] = clamp01(S.brakeR) * (1 - bundled);
    // collapse: the canopy falls forward (downwind) and settles onto the ground
    // (the lines go slack as the canopy settles: the rig shortens and tips over)
    const ce = smooth(col);
    this.rig.rotation.x = -ce * 1.5;
    this.rig.scale.set(1 + ce * 0.15, 1 - ce * 0.62, 1 - ce * 0.4);
    this.rig.position.set(0, -ce * 1.3, 0);
    const lineStretch = S.bag >= 1;
    this.canopy.visible = lineStretch;
    // where the bag is before line stretch: from the container up to the top of the lines
    const bagTop = _a.set(0, LINK_Y + LINE_R + 0.6, 0);
    const bagPos = new THREE.Vector3(0, 0.05, 0.22).lerp(bagTop, smooth(S.bag));
    for (const a of this.att) { if (lineStretch) this.shapePoint(a.s, a.c, -1, a.p); else a.p.copy(bagPos); }
    for (const a of this.brk) { if (lineStretch) this.shapePoint(a.s, a.c, -1, a.p); else a.p.copy(bagPos); }
    // pilot chute: trails the canopy's top (or the bag) on its bridle, inflating as it goes
    const top = lineStretch ? this.shapePoint(0, 0.4, 1, new THREE.Vector3()) : bagPos.clone();
    const pcK = smooth(S.pc);
    const trail = lineStretch ? _b.set(0, 0.55 + 0.45 * (1 - k) + 0.45 * ce, 1 - (1 - k) * 0.9 - 1.4 * ce).normalize() : _b.set(0, 1, 0);
    const bridle = lineStretch ? 2.4 : 0.3 + 2.1 * smooth(S.pc * 1.2);
    const pcPos = top.clone().addScaledVector(trail, bridle);
    if (!lineStretch && S.bag <= 0) pcPos.set(0, 0.25 + 2.2 * smooth(S.pc), 0.25 + 0.3 * smooth(S.pc));
    this.pc.visible = S.pc > 0;
    this.pc.position.copy(pcPos);
    this.pc.quaternion.setFromUnitVectors(UP, _c.copy(pcPos).sub(top).normalize());
    const wob = Math.sin(this.time * 7.3) * 0.08;
    this.pc.scale.set(0.3 + 0.7 * pcK + wob, 0.25 + 0.75 * pcK, 0.3 + 0.7 * pcK - wob);
    this.bag.visible = S.bag > 0 || S.pc > 0.2;
    if (lineStretch) this.bag.position.copy(top).lerp(pcPos, 0.55);
    else this.bag.position.copy(bagPos);
    this.bag.rotation.set(this.time * 0.7, 0, 0.3);
    // slider: from against the canopy down to just above the links
    const sl = smooth(S.slider);
    const sTop = LINK_Y + LINE_R - 0.25;
    const sY = sTop + (LINK_Y + 0.12 - sTop) * sl;
    const grommet = (i) => {
      const L = LINKS[i];
      const topC = _c.set(L.x < 0 ? -0.38 : 0.38, sTop, L.z < 0 ? -0.33 : 0.33);
      return topC.lerp(_d.set(L.x * 1.15, LINK_Y + 0.12, L.z * 2.2), sl).clone();
    };
    const G = [0, 1, 2, 3].map(grommet);
    this.slider.visible = lineStretch;
    this.slider.position.set(0, lineStretch ? sY : bagPos.y, 0);
    this.slider.scale.setScalar(lineStretch ? 1 : 0.4);
    if (!lineStretch) this.slider.position.copy(bagPos);
    // risers: from the harness (shoulders) up to the links; the toggles in the hands
    this.rig.updateWorldMatrix(true, false);
    _m.copy(this.rig.matrixWorld).invert();
    const shL = S.shoulderL ? _a.copy(S.shoulderL).applyMatrix4(_m).clone() : new THREE.Vector3(-0.17, 0, 0.02);
    const shR = S.shoulderR ? _a.copy(S.shoulderR).applyMatrix4(_m).clone() : new THREE.Vector3(0.17, 0, 0.02);
    const hand = [S.handL ? _a.copy(S.handL).applyMatrix4(_m).clone() : GUIDE[0].clone(), S.handR ? _a.copy(S.handR).applyMatrix4(_m).clone() : GUIDE[1].clone()];
    const link = (i) => LINKS[i];
    for (let i = 0; i < 4; i++) placeStrap(this.risers[i], i % 2 ? shR : shL, link(i), 0.045, 0.005);
    for (let i = 0; i < 2; i++) {
      this.toggles[i].position.copy(hand[i]);
      this.toggles[i].quaternion.copy(this.risers[2 + i].quaternion);
    }
    // lines
    const P = this.linePos;
    let n = 0;
    const seg = (a, b) => { P[n++] = a.x; P[n++] = a.y; P[n++] = a.z; P[n++] = b.x; P[n++] = b.y; P[n++] = b.z; };
    const viaSlider = sl < 0.97 && lineStretch;
    for (let row = 0; row < 4; row++) {
      for (const [side, grps] of [[0, RIBS_L], [1, RIBS_R]]) {
        const li = (row < 2 ? 0 : 2) + side;
        const L = link(li);
        for (const grp of grps) {
          const pts = grp.map((r) => this.att[row * (CELLS + 1) + r].p);
          if (viaSlider) {
            for (const p of pts) seg(p, G[li]);
            seg(G[li], L);
          } else {
            const mid = _c.set(0, 0, 0);
            for (const p of pts) mid.add(p);
            mid.multiplyScalar(1 / pts.length);
            const J = mid.lerp(L, 0.32).clone();
            for (const p of pts) seg(p, J);
            seg(J, L);
          }
        }
      }
    }
    // brake lines: cascade from the trailing edge to the steering line, through the guide ring
    // on the rear riser to the toggle in the hand
    for (let side = 0; side < 2; side++) {
      const pts = this.brk.slice(side * BRAKES.length, (side + 1) * BRAKES.length).map((b) => b.p);
      const ring = lineStretch ? GUIDE[side] : bagPos;
      const mid = _c.set(0, 0, 0);
      for (const p of pts) mid.add(p);
      mid.multiplyScalar(1 / pts.length);
      const J = viaSlider ? G[2 + side].clone() : mid.lerp(ring, 0.45).clone();
      for (const p of pts) seg(p, J);
      seg(J, ring);
      seg(ring, hand[side]);
    }
    // bridle and the pilot chute's lines
    seg(top, pcPos);
    this.pc.updateMatrix();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      seg(_c.set(Math.cos(a) * 0.45, 0.02, Math.sin(a) * 0.45).applyMatrix4(this.pc.matrix), pcPos.clone().addScaledVector(_d.copy(pcPos).sub(top).normalize(), -0.35));
    }
    while (n < P.length) P[n++] = 0;
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.visible = S.bag > 0;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.canopy.geometry.dispose();
    this.lines.geometry.dispose();
    this.slider.geometry.dispose();
  }
}

// Orient a unit box (base at y = 0) from a to b, w wide and t thick.
function placeStrap(m, a, b, w, t) {
  const d = _b.subVectors(b, a);
  const len = d.length();
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(UP, len > 1e-6 ? d.multiplyScalar(1 / len) : UP);
  m.scale.set(w, Math.max(0.001, len), t);
}

export const CANOPY = { CELLS, SPAN, CHORD, LINE_R, LINK_Y, height: LINK_Y + LINE_R };
