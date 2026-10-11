// Transport aircraft for the battle royale drop: a twin-turboprop, high-wing military transport
// in the C-160 / An-26 mould. A lofted fuselage with an upswept tail and the rear ramp lowered
// (hold lined with quilted insulation, cargo floor, red and green jump lights by the hinge),
// a stepped cockpit glazing and radome, portholes, gear sponsons, a tapered high wing, two
// nacelles with spinning four-blade propellers (blades plus a blur disc), fin and tailplane,
// navigation lights and a flashing beacon. Panel seams and rivet rows come from a painted
// texture; the camouflage is in the vertex colours. Engine drone is synthesised.
//
// Local space: +x forward (nose), +y up, +z to the right; the hold floor is at y = -1.32.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { textDecal } from '../core/textures.js';

const FLOOR = -1.32;
const RAMP = { hinge: -5.0, end: -12.2, half: 1.05, length: 4.4 };   // opening x range, half-angle of the cut
const se = (c, n) => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);

// Fuselage stations: [x, centre y, half width, half height, squareness]
const STATIONS = [
  [16.1, 0.15, 0.02, 0.02, 2], [15.8, 0.17, 0.42, 0.45, 2], [15.2, 0.2, 0.85, 0.9, 2], [14.4, 0.26, 1.3, 1.38, 2.05],
  [13.4, 0.34, 1.7, 1.78, 2.15], [12.0, 0.33, 1.98, 1.98, 2.3], [10.5, 0.3, 2.05, 2.05, 2.35], [-4.0, 0.3, 2.05, 2.05, 2.35],
  [-6.0, 0.62, 1.95, 1.75, 2.3], [-8.5, 1.15, 1.7, 1.25, 2.25], [-11.0, 1.62, 1.28, 0.86, 2.2], [-13.5, 2.0, 0.8, 0.55, 2.1],
  [-15.6, 2.22, 0.3, 0.26, 2], [-16.3, 2.3, 0.05, 0.05, 2],
];
function station(x) {
  const S = STATIONS;
  if (x >= S[0][0]) return S[0];
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    if (x <= a[0] && x >= b[0]) {
      const t = (a[0] - x) / (a[0] - b[0]);
      const p = S[Math.max(0, i - 1)], q = S[Math.min(S.length - 1, i + 2)];
      const out = [x];
      for (let k = 1; k < 5; k++) {
        // Catmull-Rom through the neighbours, for a smooth silhouette
        const m1 = (b[k] - p[k]) / 2, m2 = (q[k] - a[k]) / 2;
        const t2 = t * t, t3 = t2 * t;
        out.push((2 * t3 - 3 * t2 + 1) * a[k] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * b[k] + (t3 - t2) * m2);
      }
      out[2] = Math.max(0.02, out[2]); out[3] = Math.max(0.02, out[3]);
      return out;
    }
  }
  return S[S.length - 1];
}
// Point on the fuselage skin at (x, θ); θ = 0 at the right side, π/2 on top, -π/2 underneath.
function skinPoint(x, th, inset, out) {
  const [, yc, hw, hh, n] = station(x);
  return out.set(x, yc + (hh - inset) * se(Math.sin(th), n), (hw - inset) * se(Math.cos(th), n));
}

// Cockpit glazing panes: [x0, x1, θ0, θ1] (θ measured from the right side, over the top).
const PANES = [
  [13.75, 14.55, 0.66, 1.5], [13.75, 14.55, Math.PI - 1.5, Math.PI - 0.66],
  [12.55, 13.62, 0.3, 0.86], [12.55, 13.62, Math.PI - 0.86, Math.PI - 0.3],
  [12.75, 13.55, 1.02, 1.42], [12.75, 13.55, Math.PI - 1.42, Math.PI - 1.02],
];
const inPane = (x, th) => PANES.some((p) => x > p[0] && x < p[1] && th > p[2] && th < p[3]);
const inRamp = (x, th) => x < RAMP.hinge && x > RAMP.end && Math.abs(th + Math.PI / 2) < RAMP.half;

function camo(x, y, z) {
  const v = Math.sin(x * 0.31 + Math.sin(z * 0.37 + 1.3) * 1.7) + Math.sin(z * 0.43 + y * 0.6 + x * 0.12) * 0.8 + Math.sin(x * 0.9 - z * 0.7) * 0.25;
  return v > 0.35 ? 0 : v > -0.6 ? 1 : 2;
}
// (THREE.Color takes hex as sRGB and stores it linear, as vertex colours want)
const CAMO = [new THREE.Color(0x56603f), new THREE.Color(0x787d68), new THREE.Color(0x646d52)];
const BELLY = new THREE.Color(0x9a9e98);
function paint(x, y, z, belly) {
  const c = CAMO[camo(x, y, z)].clone();
  return belly > 0 ? c.lerp(BELLY, Math.min(1, belly)) : c;
}

// Sorted, de-duplicated samples: a uniform spread plus exact boundaries.
function samples(a, b, n, extra) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(a + (b - a) * (i / n));
  for (const e of extra) if ((e - a) * (e - b) < 0) out.push(e);
  out.sort((p, q) => p - q);
  return out.filter((v, i) => i === 0 || Math.abs(v - out[i - 1]) > 1e-4);
}

class Geo {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; }
  v(p, u, w, c) { this.pos.push(p.x, p.y, p.z); this.uv.push(u, w); this.col.push(c.r, c.g, c.b); return this.pos.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    if (this.inward !== undefined) orient(g, this.inward);
    g.computeVertexNormals();
    return g;
  }
}

// Wind every triangle of a (mostly) closed mesh so it faces out (or in, for a lining): the
// signed volume about the centre says which way the winding runs.
function orient(g, inward) {
  const p = g.attributes.position, ix = g.index.array;
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  let vol = 0;
  for (let i = 0; i < ix.length; i += 3) {
    a.fromBufferAttribute(p, ix[i]).sub(c); b.fromBufferAttribute(p, ix[i + 1]).sub(c); d.fromBufferAttribute(p, ix[i + 2]).sub(c);
    vol += a.dot(b.cross(d));
  }
  if ((vol < 0) !== inward) for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
}

// The fuselage: outer skin (paint, glass and radome faces), inner lining of the hold and the rim
// round the ramp opening.
function buildFuselage() {
  const xs = samples(-16.3, 16.1, 96, [RAMP.hinge, RAMP.end, 15.0, ...PANES.flatMap((p) => [p[0], p[1]])]);
  const ths = samples(-Math.PI / 2, Math.PI * 1.5, 72, [-Math.PI / 2 - RAMP.half, -Math.PI / 2 + RAMP.half, ...PANES.flatMap((p) => [p[2], p[3]])]);
  const skin = new Geo(), glass = new Geo(), dome = new Geo(), lining = new Geo();
  const p = new THREE.Vector3();
  const white = new THREE.Color(1, 1, 1), lin = new THREE.Color(0x4a5043);
  const grid = (geo, inset, keep, color, flip) => {
    const at = geo.pos.length / 3, m = ths.length;
    for (const x of xs) {
      let arc = 0;
      for (let j = 0; j < m; j++) {
        skinPoint(x, ths[j], inset, p);
        if (j > 0) arc += p.distanceTo(skinPoint(x, ths[j - 1], inset, new THREE.Vector3()));
        const [, yc, , hh] = station(x);
        geo.v(p, x, arc, color || paint(p.x, p.y, p.z, (yc - hh * 0.35 - p.y) / (hh * 0.4)));
      }
    }
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < m - 1; j++) {
      const xm = (xs[i] + xs[i + 1]) / 2, tm = (ths[j] + ths[j + 1]) / 2;
      if (!keep(xm, tm)) continue;
      const a = at + i * m + j, b = a + m, c = b + 1, d = a + 1;
      if (flip) geo.quad(a, d, c, b); else geo.quad(a, b, c, d);
    }
  };
  grid(skin, 0, (x, t) => !inRamp(x, t) && !inPane(x, t) && x < 15.0);
  grid(glass, 0, (x, t) => inPane(x, t), white);
  grid(dome, 0, (x) => x >= 15.0, white);
  grid(lining, 0.09, (x, t) => x < 9.5 && x > -13.6 && !inRamp(x, t), lin, true);
  // rim of the ramp opening: outer skin to lining along its edges
  const rim = (x0, t0, x1, t1) => {
    const a = skin.v(skinPoint(x0, t0, 0, p), 0, 0, lin), b = skin.v(skinPoint(x1, t1, 0, p), 0, 1, lin);
    const c = skin.v(skinPoint(x1, t1, 0.09, p), 0.1, 1, lin), d = skin.v(skinPoint(x0, t0, 0.09, p), 0.1, 0, lin);
    skin.quad(a, b, c, d); skin.quad(a, d, c, b);
  };
  const tA = -Math.PI / 2 - RAMP.half, tB = -Math.PI / 2 + RAMP.half;
  const xr = xs.filter((x) => x <= RAMP.hinge && x >= RAMP.end), tr = ths.filter((t) => t >= tA && t <= tB);
  for (let i = 0; i < xr.length - 1; i++) { rim(xr[i], tA, xr[i + 1], tA); rim(xr[i], tB, xr[i + 1], tB); }
  for (let j = 0; j < tr.length - 1; j++) { rim(RAMP.hinge, tr[j], RAMP.hinge, tr[j + 1]); rim(RAMP.end, tr[j], RAMP.end, tr[j + 1]); }
  return { skin: skin.build(), glass: glass.build(), dome: dome.build(), lining: lining.build() };
}

// NACA-style section: [chordwise, thickness] points round the profile, trailing edge first.
function airfoil(n, camber = 0.02) {
  const pts = [];
  const yt = (c) => 5 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
  for (let i = 0; i <= n; i++) { const c = 1 - (1 - Math.cos((i / n) * Math.PI)) / 2; pts.push([c, yt(c) * 2 + camber * Math.sin(Math.PI * c)]); }
  for (let i = 1; i < n; i++) { const c = (1 - Math.cos((i / n) * Math.PI)) / 2; pts.push([c, -yt(c) * 2 + camber * Math.sin(Math.PI * c)]); }
  return pts;
}
// A lifting surface lofted through sections { le: [x, y, z], chord, t } along `span` ('z' or
// 'y'); thickness is across y for wings and tailplanes, across z for the fin. Tips are capped.
function surface(sections, span, camber = 0.02, color) {
  const geo = new Geo();
  const foil = airfoil(14, camber);
  const p = new THREE.Vector3();
  const m = foil.length;
  for (const s of sections) {
    for (const [c, t] of foil) {
      const x = s.le[0] - c * s.chord, d = t * s.t * s.chord * 0.5;
      if (span === 'z') p.set(x, s.le[1] + d, s.le[2]); else p.set(x, s.le[1], s.le[2] + d);
      geo.v(p, x, span === 'z' ? s.le[2] : s.le[1], color ? color(p) : paint(p.x, p.y, p.z, span === 'z' && t < 0 ? 0.6 : 0));
    }
  }
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + ((j + 1) % m);
    geo.quad(a, b, b + m, a + m);
  }
  // cap the far end (a fan from the section's centre)
  const last = sections.length - 1, s = sections[last];
  const cx = s.le[0] - s.chord * 0.4;
  const ctr = geo.v(span === 'z' ? p.set(cx, s.le[1], s.le[2]) : p.set(cx, s.le[1], s.le[2]), 0, 0, paint(cx, s.le[1], s.le[2], 0));
  for (let j = 0; j < m; j++) geo.tri(last * m + j, last * m + ((j + 1) % m), ctr);
  geo.inward = false;
  return geo.build();
}

// A body of revolution-ish loft along x: rings [x, yc, zc, ry, rz].
function pod(rings, seg = 20, color) {
  const geo = new Geo();
  const p = new THREE.Vector3();
  for (const r of rings) for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    p.set(r[0], r[1] + Math.sin(a) * r[3], r[2] + Math.cos(a) * r[4]);
    geo.v(p, r[0], (j / seg) * 2 * Math.PI * Math.max(r[3], r[4]), color ? color(p, a) : paint(p.x, p.y, p.z, -Math.sin(a) - 0.3));
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    geo.quad(a, a + 1, b + 1, b);
  }
  geo.inward = false;
  return geo.build();
}

// One propeller blade along +y: twisted, tapered, yellow-tipped.
function blade() {
  const geo = new Geo();
  const foil = airfoil(6, 0.03);
  const p = new THREE.Vector3();
  const N = 10, R0 = 0.42, R1 = 2.75;
  const black = new THREE.Color(0x111214), tip = new THREE.Color(0xd8b020);
  for (let i = 0; i <= N; i++) {
    const f = i / N, r = R0 + (R1 - R0) * f;
    const chord = 0.3 + 0.2 * Math.sin(Math.PI * Math.min(1, f * 1.3)) - 0.12 * f * f;
    const tw = 0.95 - 0.7 * f, th = 0.14 - 0.08 * f;
    for (const [c, t] of foil) {
      const u = (0.35 - c) * chord, v = t * th * chord * 0.5;
      p.set(u * Math.sin(tw) + v * Math.cos(tw), r, u * Math.cos(tw) - v * Math.sin(tw));
      geo.v(p, c, r, f > 0.9 ? tip : black);
    }
  }
  const m = foil.length;
  for (let i = 0; i < N; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + ((j + 1) % m);
    geo.quad(a, a + m, b + m, b);
  }
  geo.inward = false;
  return geo.build();
}

// --- materials (made once per Materials set) --------------------------------------------------
function panelTexture() {
  if (typeof document === 'undefined') return null;
  // 4 m square: frame seams every metre, stringer laps every 1.33 m, rivet rows, access panels
  const S = 512, k = S / 4;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '40,40,40'},${0.03 + rnd() * 0.05})`; g.fillRect(rnd() * S, rnd() * S, 6 + rnd() * 50, 2 + rnd() * 30); }
  for (let i = 0; i < 40; i++) { const x = rnd() * S; g.fillStyle = 'rgba(30,30,30,0.05)'; g.fillRect(x, 0, 2 + rnd() * 6, S); }
  g.strokeStyle = 'rgba(20,20,20,0.55)'; g.lineWidth = 1.5;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * k, 0); g.lineTo(i * k, S); g.stroke(); }
  for (let i = 0; i <= 3; i++) { const y = i * S / 3; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  g.fillStyle = 'rgba(25,25,25,0.5)';
  for (let i = 0; i <= 8; i++) for (let y = 3; y < S; y += 7) g.fillRect(i * k / 2 + (i % 2 ? 0 : 3), y, 1.5, 1.5);
  for (let i = 0; i <= 3; i++) for (let x = 3; x < S; x += 7) g.fillRect(x, i * S / 3 + 3, 1.5, 1.5);
  g.strokeStyle = 'rgba(20,20,20,0.5)'; g.lineWidth = 1;
  for (const [x, y, w, h] of [[0.2, 0.25, 0.5, 0.35], [2.3, 1.7, 0.35, 0.3], [3.2, 0.5, 0.4, 0.6], [1.2, 3.0, 0.6, 0.4]]) {
    g.strokeRect(x * k, y * k, w * k, h * k);
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) g.fillRect(px * k - 3, py * k - 3, 2, 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 4, 1 / 4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function quiltTexture() {
  if (typeof document === 'undefined') return null;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S * 0.7);
  gr.addColorStop(0, '#d0d0d0'); gr.addColorStop(1, '#8a8a8a');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3; g.strokeRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 0.6, 1 / 0.6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function discTexture() {
  if (typeof document === 'undefined') return null;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(20,20,20,0)'); gr.addColorStop(0.2, 'rgba(20,20,20,0.6)'); gr.addColorStop(0.85, 'rgba(25,25,25,0.35)');
  gr.addColorStop(0.9, 'rgba(160,140,60,0.2)'); gr.addColorStop(0.98, 'rgba(160,140,60,0.1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function glowTexture() {
  if (typeof document === 'undefined') return null;
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

export function aircraftMaterials(mats) {
  if (mats && mats.aircraft) return mats.aircraft;
  const panel = panelTexture();
  const A = {
    skin: new THREE.MeshStandardMaterial({ vertexColors: true, map: panel, bumpMap: panel, bumpScale: 0.9, roughness: 0.68, metalness: 0.2, envMapIntensity: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b1116, metalness: 0.9, roughness: 0.07, envMapIntensity: 1.3 }),
    radome: new THREE.MeshStandardMaterial({ color: 0x2c302b, roughness: 0.55, metalness: 0.05 }),
    lining: new THREE.MeshStandardMaterial({ vertexColors: true, map: quiltTexture(), roughness: 0.95, metalness: 0, emissive: 0x2a0503, emissiveIntensity: 1 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x2e302c, roughness: 0.7, metalness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x55585a, roughness: 0.45, metalness: 0.9 }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: 0.7, metalness: 0.7 }),
    blade: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }),
    spinner: new THREE.MeshStandardMaterial({ color: 0x3a3d38, roughness: 0.4, metalness: 0.5 }),
    intake: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 }),
    disc: new THREE.MeshBasicMaterial({ map: discTexture(), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    red: new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.25, 0.15) }),
    green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 6, 0.6) }),
    white: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 5.5) }),
    off: new THREE.MeshStandardMaterial({ color: 0x2a1010, roughness: 0.3 }),
    offG: new THREE.MeshStandardMaterial({ color: 0x0e2412, roughness: 0.3 }),
    glow: glowTexture(),
  };
  for (const k in A) if (A[k] && A[k].isMaterial) A[k].name = 'aircraft_' + k;
  if (mats) mats.aircraft = A;
  return A;
}

export class Aircraft {
  constructor(mats) {
    const M = aircraftMaterials(mats);
    this.M = M;
    this.group = new THREE.Group();
    this.group.name = 'aircraft';
    this.model = new THREE.Group();          // turbulence rocks the model inside the group
    this.group.add(this.model);
    const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; this.model.add(m); return m; };
    const F = buildFuselage();
    add(F.skin, M.skin); add(F.glass, M.glass); add(F.dome, M.radome); add(F.lining, M.lining, false);
    // cargo floor and the lowered ramp, with its hydraulic struts
    add(new THREE.BoxGeometry(14.6, 0.14, 2.9).translate(2.3, FLOOR - 0.07, 0), M.floor, false);
    const rampLen = RAMP.length;
    const ramp = new THREE.BoxGeometry(rampLen, 0.16, 2.84).translate(-rampLen / 2, -0.08, 0);
    const rampM = add(ramp, M.floor);
    rampM.position.set(RAMP.hinge, FLOOR, 0);
    rampM.rotation.z = 0.05;
    const rampSkin = new THREE.BoxGeometry(rampLen, 0.04, 2.9).translate(-rampLen / 2, -0.19, 0);
    rampM.add(new THREE.Mesh(rampSkin, M.radome));
    for (const z of [-1.35, 1.35]) {
      const a = new THREE.Vector3(RAMP.hinge - 1.2, FLOOR + 0.9, z), b = new THREE.Vector3(RAMP.hinge - 3.4, FLOOR - 0.05, z);
      const len = a.distanceTo(b);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 8), M.metal);
      strut.position.copy(a).add(b).multiplyScalar(0.5);
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      this.model.add(strut);
    }
    // portholes: framed, dark glass
    const port = [];
    for (const side of [-1, 1]) for (let x = 8.6; x > -3.5; x -= 1.55) {
      const p = skinPoint(x, side > 0 ? 0.3 : Math.PI - 0.3, -0.005, new THREE.Vector3());
      const g = new THREE.CylinderGeometry(0.17, 0.17, 0.05, 16).rotateX(Math.PI / 2);
      const ring = new THREE.TorusGeometry(0.19, 0.03, 6, 16);
      const m = new THREE.Matrix4().makeRotationX(side > 0 ? -0.12 : 0.12).setPosition(p);
      port.push({ g: g.applyMatrix4(m), r: ring.applyMatrix4(m) });
    }
    add(mergeGeometries(port.map((o) => o.g)), M.glass, false);
    add(mergeGeometries(port.map((o) => o.r)), M.metal, false);
    // main gear sponsons and their fairings into the belly
    for (const z of [-1, 1]) {
      add(pod([[5.2, -1.35, 1.85 * z, 0.05, 0.05], [4.6, -1.3, 1.92 * z, 0.5, 0.42], [3.4, -1.25, 2.0 * z, 0.78, 0.6], [-2.4, -1.25, 2.0 * z, 0.78, 0.6], [-3.8, -1.2, 1.9 * z, 0.5, 0.42], [-4.6, -1.1, 1.8 * z, 0.05, 0.05]], 20), M.skin);
    }
    // wing: tapered, thick root, slight dihedral outboard; fairing on top of the fuselage
    for (const z of [-1, 1]) {
      const secs = [];
      for (const zz of [0, 2.0, 6.3, 12, 20]) {
        const a = zz;
        secs.push({ le: [3.3 - 0.06 * a, 2.42 + Math.max(0, a - 6.3) * 0.035, a * z], chord: 4.7 - 0.12 * a, t: 0.16 - 0.0025 * a });
      }
      add(surface(secs, 'z', 0.025), M.skin);
      // navigation light on the tip: red to port (left), green to starboard (right)
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), z > 0 ? M.green : M.red);
      tip.position.set(3.3 - 0.06 * 20 - 0.6, 2.42 + 13.7 * 0.035, 20.05 * z);
      this.model.add(tip);
      this.model.add(this.glow(tip.position, z > 0 ? 0x40ff70 : 0xff3020, 0.55));
    }
    add(pod([[3.6, 2.35, 0, 0.05, 0.3], [3.0, 2.55, 0, 0.28, 0.9], [-0.8, 2.62, 0, 0.32, 1.0], [-2.6, 2.5, 0, 0.12, 0.6], [-3.4, 2.4, 0, 0.04, 0.2]], 18), M.skin);
    // nacelles, intakes, exhausts, spinners and propellers
    this.props = [];
    const bladeGeo = blade();
    for (const z of [-6.3, 6.3]) {
      const yc = 1.72;
      add(pod([[5.15, yc, z, 0.5, 0.5], [4.7, yc - 0.02, z, 0.74, 0.7], [3.0, yc + 0.05, z, 0.86, 0.8], [0.6, yc + 0.1, z, 0.86, 0.78], [-1.6, yc + 0.25, z, 0.66, 0.6], [-3.6, yc + 0.45, z, 0.22, 0.25]], 22), M.skin);
      add(new THREE.CircleGeometry(0.46, 20).rotateY(Math.PI / 2).translate(5.16, yc, z), M.intake, false);
      // chin intake under the spinner
      add(pod([[4.85, yc - 0.7, z, 0.04, 0.1], [4.6, yc - 0.66, z, 0.18, 0.3], [3.2, yc - 0.6, z, 0.12, 0.26], [2.6, yc - 0.55, z, 0.03, 0.1]], 12), M.skin);
      add(new THREE.CircleGeometry(0.13, 12).scale(1, 0.6, 1).rotateY(Math.PI / 2).translate(4.62, yc - 0.66, z), M.intake, false);
      const ex = new THREE.CylinderGeometry(0.24, 0.27, 1.0, 14, 1, true).rotateZ(Math.PI / 2).rotateY(0.25 * Math.sign(z)).translate(-0.4, yc + 0.35, z + 0.72 * Math.sign(z));
      add(ex, M.exhaust);
      const prop = new THREE.Group();
      prop.position.set(5.45, yc, z);
      const spinner = new THREE.Mesh(new THREE.LatheGeometry([[0.47, 0], [0.45, 0.25], [0.36, 0.6], [0.2, 0.92], [0.02, 1.08]].map((q) => new THREE.Vector2(q[0], q[1])), 18).rotateZ(-Math.PI / 2), M.spinner);
      spinner.castShadow = true;
      prop.add(spinner);
      const hub = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(bladeGeo, M.blade);
        b.rotation.x = (i / 4) * Math.PI * 2;
        b.position.x = 0.25;
        b.castShadow = true;
        hub.add(b);
      }
      prop.add(hub);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(2.8, 40).rotateY(Math.PI / 2), M.disc);
      disc.position.x = 0.26;
      disc.renderOrder = 2;
      prop.add(disc);
      this.model.add(prop);
      this.props.push({ hub, disc, phase: z > 0 ? 0.4 : 0 });
    }
    // fin and rudder, tailplane, a dorsal fillet
    add(surface([{ le: [-9.6, 2.3, 0], chord: 6.2, t: 0.12 }, { le: [-11.6, 5.2, 0], chord: 4.3, t: 0.11 }, { le: [-14.1, 9.4, 0], chord: 2.4, t: 0.1 }], 'y', 0), M.skin);
    add(pod([[-6.2, 2.35, 0, 0.02, 0.05], [-8.0, 2.6, 0, 0.3, 0.22], [-9.8, 2.95, 0, 0.55, 0.26], [-10.8, 2.9, 0, 0.3, 0.2]], 12), M.skin);
    for (const z of [-1, 1]) {
      add(surface([{ le: [-12.4, 2.72, 0.3 * z], chord: 3.7, t: 0.11 }, { le: [-13.3, 2.85, 3.6 * z], chord: 2.9, t: 0.1 }, { le: [-14.5, 3.0, 7.8 * z], chord: 1.9, t: 0.09 }], 'z', 0), M.skin);
    }
    // tail light, beacons (top and belly), aerials
    const tailLight = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), M.white);
    tailLight.position.set(-16.3, 2.3, 0);
    this.model.add(tailLight);
    this.beacons = [];
    for (const [x, y] of [[1.5, 2.92], [1.0, -1.82]]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, y > 0 ? 1 : -1, 1), M.red);
      b.position.set(x, y, 0);
      const gl = this.glow(b.position, 0xff2a10, 1.6);
      this.model.add(b, gl);
      this.beacons.push({ b, gl });
    }
    for (const [x, h] of [[7.5, 0.55], [-2.0, 0.4]]) add(new THREE.BoxGeometry(0.5, h, 0.03).translate(x, 2.35 + h / 2, 0).applyMatrix4(new THREE.Matrix4().makeShear(0, 0, -0.5, 0, 0, 0)), M.radome);
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6).rotateZ(Math.PI / 2).translate(14.9, -0.35, 1.0), M.metal, false);
    // jump lights inside by the ramp hinge: red (stand by) and green (go), and the red glow in the hold
    this.jumpRed = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.18), M.red);
    this.jumpGreen = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.18), M.offG);
    for (const [m, z] of [[this.jumpRed, 1.42], [this.jumpGreen, 1.18]]) { m.position.set(RAMP.hinge - 0.25, FLOOR + 1.9, z); this.model.add(m); }
    const lamp = this.jumpRed.clone();
    lamp.position.z = -1.3;
    this.model.add(lamp);
    this.jumpLamp2 = lamp;
    this.holdGlow = this.glow(new THREE.Vector3(RAMP.hinge - 0.3, FLOOR + 1.9, 0), 0xff1808, 2.2, 0.3);
    this.model.add(this.holdGlow);
    // a serial on the fin
    try {
      const tex = textDecal([{ text: 'IM-417', size: 0.7, font: '700 sans-serif' }], 512, 128, 'rgba(18,18,16,0.85)');
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, name: 'aircraft_serial' });
      for (const z of [-1, 1]) {
        const d = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), mat);
        d.position.set(-11.6, 4.4, z * 0.27);
        d.rotation.y = z > 0 ? 0 : Math.PI;
        this.model.add(d);
      }
    } catch (e) { /* no canvas (node) */ }
    // flight state
    this.path = null;
    this.s = 0;
    this.speed = 70;
    this.vel = new THREE.Vector3();
    this.t = 0;
    this.green = false;
    this.setJumpLight(false);
  }

  // Additive glow sprite for a light.
  glow(pos, color, size, opacity = 0.9) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.M.glow, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(pos);
    s.scale.setScalar(size);
    return s;
  }

  // Fly from a to b (world, at altitude), starting `lead` metres before a.
  setPath(a, b, speed = 70, lead = 150) {
    this.a = a.clone(); this.b = b.clone();
    this.len = a.distanceTo(b);
    this.dir = b.clone().sub(a).normalize();
    this.speed = speed;
    this.s = -lead;
    this.vel.copy(this.dir).multiplyScalar(speed);
    this.group.rotation.set(0, Math.atan2(-this.dir.z, this.dir.x), 0);
    this.place();
  }

  place() {
    this.group.position.copy(this.a).addScaledVector(this.dir, this.s);
    this.group.updateMatrixWorld(true);
  }

  // Inside the jump window (over the map between a and b).
  get overMap() { return this.len !== undefined && this.s >= 0 && this.s <= this.len; }

  setJumpLight(green) {
    this.green = green;
    this.jumpGreen.material = green ? this.M.green : this.M.offG;
    this.jumpRed.material = this.jumpLamp2.material = green ? this.M.off : this.M.red;
    this.holdGlow.material.color.setHex(green ? 0x20ff40 : 0xff1808);
    this.holdGlow.material.opacity = green ? 0.22 : 0.3;
  }

  update(dt) {
    this.t += dt;
    this.s += this.speed * dt;
    this.place();
    // light turbulence
    this.model.rotation.set(Math.sin(this.t * 0.7) * 0.012 + Math.sin(this.t * 1.9) * 0.004, 0, Math.sin(this.t * 0.45) * 0.008 + 0.012);
    this.model.position.y = Math.sin(this.t * 0.6) * 0.25;
    for (const p of this.props) {
      p.hub.rotation.x -= dt * 21;
      p.disc.rotation.x += dt * 3;
    }
    const on = (this.t % 1.2) < 0.12;
    for (const b of this.beacons) { b.b.material = on ? this.M.red : this.M.off; b.gl.visible = on; }
    this.setJumpLight(this.overMap);
  }

  // World position of a point on the ramp (f = 0 hinge .. 1 edge), and of the hold (seats).
  rampPoint(f, out = new THREE.Vector3(), side = 0) {
    return this.model.localToWorld(out.set(RAMP.hinge - RAMP.length * f, FLOOR + 0.05 - f * 0.2, side));
  }
  holdPoint(i, out = new THREE.Vector3()) {
    const row = i % 2 ? 1 : -1, x = 8 - Math.floor(i / 2) * 0.6;
    return this.model.localToWorld(out.set(Math.max(-4.5, x), FLOOR + 0.05, row * 1.1));
  }

  // --- engine drone ------------------------------------------------------------------------------
  // Two turboprops: blade-pass hum (slightly detuned, so they beat), turbine whine and a
  // broadband roar, through one panner on the aircraft. `inside`: the listener is in the hold.
  sound(audio, camera, dt) {
    if (!audio || !audio.ctx) return;
    const c = audio.ctx;
    if (!this.snd) {
      const pan = c.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = 25;
      pan.rolloffFactor = 1.1;
      pan.maxDistance = 6000;
      const out = c.createGain();
      out.gain.value = 0;
      out.connect(pan).connect(audio.master);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 5000;
      lp.connect(out);
      const osc = [];
      for (const [f, type, g] of [[67, 'sawtooth', 0.16], [68.3, 'sawtooth', 0.16], [134, 'triangle', 0.08], [201, 'sine', 0.05], [2350, 'sine', 0.012], [2390, 'sine', 0.01]]) {
        const o = c.createOscillator();
        o.type = type; o.frequency.value = f;
        const og = c.createGain(); og.gain.value = g;
        o.connect(og).connect(lp);
        o.start();
        osc.push(o);
      }
      const n = c.createBufferSource();
      n.buffer = audio.noise; n.loop = true;
      const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 520; nf.Q.value = 0.4;
      const ng = c.createGain(); ng.gain.value = 0.55;
      n.connect(nf).connect(ng).connect(lp);
      const w = c.createBufferSource();
      w.buffer = audio.noise; w.loop = true;
      const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 3100; wf.Q.value = 3;
      const wg = c.createGain(); wg.gain.value = 0.05;
      w.connect(wf).connect(wg).connect(lp);
      n.start(); w.start();
      this.snd = { pan, out, lp, osc, src: [n, w] };
    }
    const S = this.snd, t = c.currentTime;
    const p = this.group.position;
    if (S.pan.positionX) { S.pan.positionX.setTargetAtTime(p.x, t, 0.05); S.pan.positionY.setTargetAtTime(p.y, t, 0.05); S.pan.positionZ.setTargetAtTime(p.z, t, 0.05); }
    else S.pan.setPosition(p.x, p.y, p.z);
    const d = camera.position.distanceTo(p);
    // far away the highs go first; close in (or in the hold) the full roar
    S.lp.frequency.setTargetAtTime(Math.max(500, 6000 * Math.exp(-d / 500)), t, 0.2);
    S.out.gain.setTargetAtTime(this.muted ? 0 : 0.9, t, 0.3);
    void dt;
  }

  stopSound() {
    if (!this.snd) return;
    for (const o of this.snd.osc) o.stop();
    for (const s of this.snd.src) s.stop();
    this.snd.out.disconnect();
    this.snd = null;
  }

  dispose() {
    this.stopSound();
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

