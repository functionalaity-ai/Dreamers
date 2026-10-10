// Facades: deep window reveals cut into the wall skin, multi-pane timber or aluminium windows
// (instanced), louvred green shutters, stucco surrounds, string courses and cornices, shopfronts,
// and a five-storey Soviet prefabricated panel block.
//
// Face coordinates: a face lies on an axis-aligned plane. `axis: 'x'` means the face runs along x
// at z = p; `axis: 'z'` runs along z at x = p. `out` (±1) is the outward normal along the plane's
// axis. Offsets `d` are measured outwards from the plane (the building's footprint boundary).
import * as THREE from 'three';
import { worldUV } from '../core/geometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PANEL } from '../core/surfaces.js';
import { cornice, stringCourse, plinthCap, rusticate, quoins, surroundGeo, doorFrame, tileRoof } from './ornament.js';
import { awningParts, lantern, windowBox, drainpipe } from './dressing.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Box in local window space with planar UVs in metres; `vert` turns the grain vertical.
function lbox(x0, y0, z0, x1, y1, z1, vert) {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  worldUV(g);
  if (vert) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { const u = uv.getX(i); uv.setX(i, uv.getY(i)); uv.setY(i, u); }
  }
  return g;
}

function merge(list) {
  const out = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  list.forEach((g) => g.dispose());
  return out;
}

function pane(x0, y0, x1, y1) {
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
  return g;
}

// A shutter leaf hinged at x = 0, extending towards `dir` (±1): stiles, rails and louvres.
function shutterLeaf(w, h, dir) {
  const parts = [];
  const sw = 0.055, t = 0.032, x0 = 0, x1 = dir * w;
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
  parts.push(lbox(lo, 0, -t / 2, lo + sw, h, t / 2, true));
  parts.push(lbox(hi - sw, 0, -t / 2, hi, h, t / 2, true));
  parts.push(lbox(lo + sw, h - 0.075, -t / 2, hi - sw, h, t / 2));
  parts.push(lbox(lo + sw, 0, -t / 2, hi - sw, 0.11, t / 2));
  const mid = h * 0.42;
  parts.push(lbox(lo + sw, mid - 0.035, -t / 2, hi - sw, mid + 0.035, t / 2));
  // louvres, tilted to shed rain outwards
  const pitch = 0.052;
  for (const [a, b] of [[0.11, mid - 0.035], [mid + 0.035, h - 0.075]]) {
    for (let y = a + pitch * 0.55; y < b - pitch * 0.3; y += pitch) {
      // a slat as its top and bottom faces (the 7 mm edges never read from the street)
      for (const side of [1, -1]) {
        const g = new THREE.PlaneGeometry(hi - lo - sw * 2, 0.05);
        g.rotateX(-side * Math.PI / 2);
        g.translate(0, side * 0.0035, 0);
        g.rotateX(0.62);
        g.translate((lo + hi) / 2, y, 0);
        worldUV(g);
        parts.push(g);
      }
    }
  }
  // hinge straps
  for (const y of [0.18, h - 0.2]) parts.push(lbox(dir > 0 ? lo - 0.004 : hi - 0.12, y - 0.015, t / 2, dir > 0 ? lo + 0.12 : hi + 0.004, y + 0.015, t / 2 + 0.004));
  return merge(parts);
}

// Window designs. Local space: origin at the bottom centre of the opening on the outer facade
// plane, +z outwards. Frames sit `reveal` deep; glass is built around z = 0 and offset by `zGlass`.
function windowDesign(type, reveal) {
  const parts = { frame: [], frameV: [], glass: [], sill: [] };
  let w, h, zg;
  if (type === 'classic') {
    w = 1.25; h = 1.7;
    const fw = 0.07, fd = 0.1, zb = -reveal, zf = zb + fd;
    zg = zf - 0.05;
    const yt = h * 0.74;
    parts.frameV.push(lbox(-w / 2, 0, zb, -w / 2 + fw, h, zf, true), lbox(w / 2 - fw, 0, zb, w / 2, h, zf, true));
    parts.frame.push(lbox(-w / 2, h - fw, zb, w / 2, h, zf), lbox(-w / 2, 0, zb - 0.02, w / 2, 0.085, zf + 0.025));
    parts.frame.push(lbox(-w / 2 + fw, yt - 0.035, zb, w / 2 - fw, yt + 0.035, zf));
    parts.frameV.push(lbox(-0.04, 0.085, zb, 0.04, h - fw, zf + 0.008, true));
    // sash frames and glazing bars (three panes per casement)
    const sx = [[-w / 2 + fw, -0.04], [0.04, w / 2 - fw]];
    for (const [a, b] of sx) {
      parts.frameV.push(lbox(a, 0.085, zf - 0.07, a + 0.035, yt - 0.035, zf - 0.015, true), lbox(b - 0.035, 0.085, zf - 0.07, b, yt - 0.035, zf - 0.015, true));
      const y0 = 0.085 + 0.035, y1 = yt - 0.035;
      for (let k = 1; k < 3; k++) {
        const y = y0 + (y1 - y0) * k / 3;
        parts.frame.push(lbox(a + 0.035, y - 0.013, zf - 0.06, b - 0.035, y + 0.013, zf - 0.025));
      }
      for (let k = 0; k < 3; k++) {
        const ya = y0 + (y1 - y0) * k / 3 + (k ? 0.013 : 0), yb = y0 + (y1 - y0) * (k + 1) / 3 - (k < 2 ? 0.013 : 0);
        parts.glass.push(pane(a + 0.035, ya, b - 0.035, yb));
      }
      parts.glass.push(pane(a, yt + 0.035, b, h - fw));
    }
  } else if (type === 'soviet') {
    w = 1.45; h = 1.5;
    const fw = 0.065, fd = 0.11, zb = -reveal, zf = zb + fd;
    zg = zf - 0.05;
    parts.frameV.push(lbox(-w / 2, 0, zb, -w / 2 + fw, h, zf, true), lbox(w / 2 - fw, 0, zb, w / 2, h, zf, true));
    parts.frame.push(lbox(-w / 2, h - fw, zb, w / 2, h, zf), lbox(-w / 2, 0, zb, w / 2, fw, zf));
    const mx = -0.08; // mullion a little left of centre
    parts.frameV.push(lbox(mx - 0.045, fw, zb, mx + 0.045, h - fw, zf + 0.006, true));
    // right casement sash
    const r0 = mx + 0.045, r1 = w / 2 - fw;
    parts.frameV.push(lbox(r0, fw, zf - 0.08, r0 + 0.045, h - fw, zf - 0.02, true), lbox(r1 - 0.045, fw, zf - 0.08, r1, h - fw, zf - 0.02, true));
    parts.frame.push(lbox(r0, fw, zf - 0.08, r1, fw + 0.05, zf - 0.02), lbox(r0, h - fw - 0.05, zf - 0.08, r1, h - fw, zf - 0.02));
    parts.glass.push(pane(r0 + 0.045, fw + 0.05, r1 - 0.045, h - fw - 0.05));
    // left casement with the fortochka (vent sash) at the top
    const l0 = -w / 2 + fw, l1 = mx - 0.045, yv = h * 0.66;
    parts.frame.push(lbox(l0, yv - 0.03, zf - 0.08, l1, yv + 0.03, zf - 0.02));
    parts.frameV.push(lbox(l0, fw, zf - 0.08, l0 + 0.04, h - fw, zf - 0.02, true), lbox(l1 - 0.04, fw, zf - 0.08, l1, h - fw, zf - 0.02, true));
    parts.glass.push(pane(l0 + 0.04, fw, l1 - 0.04, yv - 0.03), pane(l0 + 0.04, yv + 0.03, l1 - 0.04, h - fw));
    // galvanised drip sill with a turned-down lip
    const s = new THREE.BoxGeometry(w + 0.08, 0.012, 0.065 - zf);
    s.rotateX(0.12);
    s.translate(0, -0.006, (zf + 0.065) / 2);
    worldUV(s);
    parts.sill.push(s, lbox(-w / 2 - 0.04, -0.06, 0.055, w / 2 + 0.04, -0.012, 0.065));
  } else if (type === 'shop') {
    w = 3.2; h = 2.3;
    const fw = 0.06, fd = 0.08, zb = -reveal, zf = zb + fd;
    zg = zf - 0.04;
    const yt = 1.92;
    parts.frameV.push(lbox(-w / 2, 0, zb, -w / 2 + fw, h, zf, true), lbox(w / 2 - fw, 0, zb, w / 2, h, zf, true));
    parts.frame.push(lbox(-w / 2, h - fw, zb, w / 2, h, zf), lbox(-w / 2, 0, zb, w / 2, fw, zf), lbox(-w / 2, yt - 0.03, zb, w / 2, yt + 0.03, zf));
    const cols = [-w / 2 + fw, -0.52, 0.52, w / 2 - fw];
    for (const c of [-0.52, 0.52]) parts.frameV.push(lbox(c - 0.03, fw, zb, c + 0.03, h - fw, zf, true));
    for (let i = 0; i < 3; i++) {
      const a = cols[i] + (i ? 0.03 : 0), b = cols[i + 1] - (i < 2 ? 0.03 : 0);
      parts.glass.push(pane(a, fw, b, yt - 0.03), pane(a, yt + 0.03, b, h - fw));
    }
  } else {
    // 'open': an empty opening in an enterable building: outer frame and sill only.
    w = 1.25; h = 1.5;
    const fw = 0.06, zf = -0.02, zb = -0.1;
    zg = 0;
    parts.frameV.push(lbox(-w / 2, 0, zb, -w / 2 + fw, h, zf, true), lbox(w / 2 - fw, 0, zb, w / 2, h, zf, true));
    parts.frame.push(lbox(-w / 2, h - fw, zb, w / 2, h, zf), lbox(-w / 2, 0, zb, w / 2, 0.04, zf));
  }
  const out = { w, h, zGlass: zg };
  for (const k in parts) out[k] = parts[k].length ? merge(parts[k]) : null;
  return out;
}

export class WindowKit {
  constructor(M, opts = {}) {
    this.M = M;
    this.designs = {};
    this.lists = new Map(); // geometry → { mat, matrices, colors }
    this.shadows = opts.shadows !== false;
    this.rand = rng(opts.seed || 1234);
    this.leaves = {};
  }

  design(type, reveal) {
    const k = type + ':' + reveal.toFixed(3);
    if (!this.designs[k]) this.designs[k] = windowDesign(type, reveal);
    return this.designs[k];
  }

  push(geo, mat, matrix, color, cast = true) {
    if (!geo) return;
    const key = geo.uuid + '|' + mat.uuid;
    if (!this.lists.has(key)) this.lists.set(key, { geo, mat, matrices: [], colors: [], cast });
    const l = this.lists.get(key);
    l.matrices.push(matrix.clone());
    l.colors.push(color || null);
  }

  leaf(w, h, dir) {
    const k = w.toFixed(3) + ':' + h.toFixed(3) + ':' + dir;
    if (!this.leaves[k]) this.leaves[k] = shutterLeaf(w, h, dir);
    return this.leaves[k];
  }

  // Adds one window. m: the opening's frame (see windowDesign). opts: { frame: 'wood'|'alu'|'bronze',
  // shutters: 'auto'|'none'|'open'|'closed'|'half', glass: material, grille: bool }
  add(type, m, reveal, opts = {}) {
    const d = this.design(type, reveal);
    const M = this.M, r = this.rand;
    const fm = opts.frame || 'wood';
    const fH = fm === 'alu' ? M.frameAlu : fm === 'bronze' ? M.frameBronze : M.frameWood;
    const fV = fm === 'alu' ? M.frameAluV : fm === 'bronze' ? M.frameBronze : M.frameWood;
    this.push(d.frame, fH, m);
    this.push(d.frameV, fV, m);
    this.push(d.sill, M.galvanized, m);
    if (d.glass) {
      const g = tmpM.makeTranslation(0, 0, d.zGlass);
      this.push(d.glass, opts.glass || (type === 'shop' ? M.shopRoom : M.windowRoom), m.clone().multiply(g), null, false);
    }
    // Shutters: hinged on the outer edge of the reveal, lying back against the wall when open.
    let st = opts.shutters || 'auto';
    if (st === 'none') return;
    const lw = d.w / 2 + 0.03, lh = d.h + 0.04;
    const tint = opts.tint || new THREE.Color().setHSL(0.3 + (r() - 0.5) * 0.04, 0.9 + r() * 0.1, 0.9 + r() * 0.2);
    const pick = () => { const v = r(); return v < 0.62 ? 'open' : v < 0.78 ? 'half' : v < 0.92 ? 'closed' : 'ajar'; };
    for (const side of [-1, 1]) {
      const s = st === 'auto' ? pick() : st;
      let ang = s === 'open' ? Math.PI - 0.025 - r() * 0.05 : s === 'half' ? Math.PI / 2 + (r() - 0.5) * 0.5 : s === 'ajar' ? 0.35 + r() * 0.5 : 0.0;
      // left leaf (side -1) swings to -x: rotate by -ang; right leaf by +ang
      const rot = side < 0 ? -ang : ang;
      const hinge = new THREE.Matrix4().compose(tmpP.set(side * d.w / 2, -0.02, 0.062), tmpQ.setFromAxisAngle(Y, rot), tmpS);
      const leafGeo = this.leaf(lw, lh, -side);
      this.push(leafGeo, M.shutter, m.clone().multiply(hinge), tint);
    }
  }

  // Window bars for ground-floor flats.
  grille(m, w, h, reveal) {
    if (!this.grilleGeo) {
      const parts = [];
      const W = 1.45, H = 1.5;
      for (let x = -W / 2 + 0.12; x < W / 2 - 0.05; x += 0.13) parts.push(new THREE.CylinderGeometry(0.008, 0.008, H, 5).translate(x, H / 2, 0));
      for (const y of [0.05, H * 0.5, H - 0.05]) parts.push(lbox(-W / 2, y - 0.012, -0.006, W / 2, y + 0.012, 0.006));
      this.grilleGeo = merge(parts.map((g) => { if (!g.attributes.uv) worldUV(g); return g; }));
    }
    this.push(this.grilleGeo, this.M.balconyRail, m.clone().multiply(tmpM.makeTranslation(0, 0, -reveal * 0.4)));
  }

  build(scene) {
    const group = new THREE.Group();
    group.name = 'windows';
    for (const l of this.lists.values()) {
      const mesh = new THREE.InstancedMesh(l.geo, l.mat, l.matrices.length);
      l.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      if (l.colors.some(Boolean)) l.colors.forEach((c, i) => mesh.setColorAt(i, c || new THREE.Color(1, 1, 1)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = this.shadows && l.cast;
      mesh.userData.cast = l.cast;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox && mesh.computeBoundingBox();
      group.add(mesh);
    }
    scene.add(group);
    this.group = group;
    return group;
  }
}

// --- face helpers ---------------------------------------------------------------------------------
export function faceBox(B, f, a0, a1, y0, y1, d0, d1, mat, phys = null) {
  if (a1 - a0 < 1e-3 || y1 - y0 < 1e-3) return;
  const za = f.p + f.out * d0, zb = f.p + f.out * d1;
  if (f.axis === 'x') B.solid(a0, y0, Math.min(za, zb), a1, y1, Math.max(za, zb), mat, phys);
  else B.solid(Math.min(za, zb), y0, a0, Math.max(za, zb), y1, a1, mat, phys);
}

// Transform for an opening centred at `a`, bottom at `y`, on the outer plane.
export function faceMatrix(f, a, y, d = 0) {
  const rotY = f.axis === 'x' ? (f.out > 0 ? 0 : Math.PI) : (f.out > 0 ? Math.PI / 2 : -Math.PI / 2);
  const pos = f.axis === 'x' ? new THREE.Vector3(a, y, f.p + f.out * d) : new THREE.Vector3(f.p + f.out * d, y, a);
  return new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(Y, rotY), new THREE.Vector3(1, 1, 1));
}

// +1 when face-space x (see faceMatrix) runs the same way as the face's `a` coordinate.
export function faceDir(f) { return f.axis === 'x' ? (f.out > 0 ? 1 : -1) : (f.out > 0 ? -1 : 1); }

// Builds the wall skin of one face from levels and openings, and returns the openings.
// levels: [{ y0, y1, holes: [{ a, w, y0, y1 }] }]
function skin(B, f, a0, a1, levels, reveal, mat) {
  for (const L of levels) {
    const mm = L.mat || mat;
    const holes = (L.holes || []).slice().sort((p, q) => p.a - q.a);
    let cur = a0;
    for (const h of holes) {
      const h0 = h.a - h.w / 2, h1 = h.a + h.w / 2;
      faceBox(B, f, cur, h0, L.y0, L.y1, -reveal, 0, mm);
      faceBox(B, f, h0, h1, L.y0, h.y0, -reveal, 0, mm);
      faceBox(B, f, h0, h1, h.y1, L.y1, -reveal, 0, mm);
      cur = h1;
    }
    faceBox(B, f, cur, a1, L.y0, L.y1, -reveal, 0, mm);
  }
}

function bays(a0, a1, bay, margin) {
  const n = Math.max(1, Math.floor((a1 - a0 - margin * 2) / bay));
  const span = (a1 - a0 - margin * 2) / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(a0 + margin + span * (i + 0.5));
  return out;
}

// --- pre-war stucco block ---------------------------------------------------------------------------
// spec: { x0, z0, x1, z1, floors, H, groundH, mat, trim, faces: ['s', 'w', ...], shops: bool, seed, roof }
export function stuccoBlock(B, kit, s) {
  const rnd = rng(s.seed || 7);
  const reveal = 0.26;
  const gH = s.groundH || 4.0, H = s.H || 3.3;
  const top = gH + (s.floors - 1) * H;
  const faces = s.faces || [];
  const trim = s.trim || 'trim';
  const faceOf = (side) => side === 'n' ? { axis: 'x', p: s.z0, out: -1, a0: s.x0, a1: s.x1 }
    : side === 's' ? { axis: 'x', p: s.z1, out: 1, a0: s.x0, a1: s.x1 }
      : side === 'w' ? { axis: 'z', p: s.x0, out: -1, a0: s.z0, a1: s.z1 } : { axis: 'z', p: s.x1, out: 1, a0: s.z0, a1: s.z1 };
  // Core (inset behind the skins) and the full-footprint collider.
  const ins = (side) => faces.indexOf(side) >= 0 ? reveal : 0;
  B.solid(s.x0 + ins('w'), 0, s.z0 + ins('n'), s.x1 - ins('e'), top, s.z1 - ins('s'), s.mat, null);
  B.collider(s.x0, 0, s.z0, s.x1, top, s.z1, 'brick');
  const shutterTint = new THREE.Color().setHSL(0.28 + rnd() * 0.08, 0.9, 1.0 + (rnd() - 0.5) * 0.25);
  for (const side of faces) {
    const f = faceOf(side);
    const a0 = f.a0, a1 = f.a1;
    const bayW = s.bay || 3.0;
    const cs = bays(a0, a1, bayW, 0.9);
    const levels = [];
    // ground floor: shopfronts or a rusticated base with windows
    const gHoles = [];
    if (s.shops) {
      for (let i = 0; i < cs.length; i++) {
        if ((i % 2 === 1 && cs.length > 2) || cs.length === 1) {
          if (i === 1 && s.door !== false) { gHoles.push({ a: cs[i], w: 1.3, y0: 0, y1: 2.6, door: true }); continue; }
        }
        gHoles.push({ a: cs[i], w: Math.min(3.2, bayW - 0.5), y0: 0.5, y1: 2.8, shop: true });
      }
    } else {
      cs.forEach((c, i) => gHoles.push(i === Math.floor(cs.length / 2) ? { a: c, w: 1.3, y0: 0, y1: 2.6, door: true } : { a: c, w: 1.25, y0: 1.1, y1: 2.8, win: true }));
    }
    levels.push({ y0: 0, y1: gH, holes: gHoles, mat: s.groundMat || s.mat });
    for (let fl = 1; fl < s.floors; fl++) {
      const y0 = gH + (fl - 1) * H;
      levels.push({ y0, y1: y0 + H, holes: cs.map((c) => ({ a: c, w: 1.25, y0: y0 + 0.9, y1: y0 + 0.9 + 1.7, win: true, fl })) });
    }
    skin(B, f, a0, a1, levels, reveal, s.mat);
    // Openings: windows, shops, doors, with their trim.
    for (const L of levels) {
      for (const h of L.holes) {
        const m = faceMatrix(f, h.a, h.y0);
        if (h.win) {
          kit.add('classic', m, reveal, { frame: rnd() < 0.15 ? 'alu' : 'wood', shutters: 'auto', tint: shutterTint.clone().offsetHSL((rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * 0.08) });
          // carved architrave with ears and a keystone, a sill on corbels; pediments on the piano nobile
          kit.push(surroundGeo(h.w, h.y1 - h.y0, h.fl === 1 ? 'pediment' : 'cap'), B.mat(trim), m);
          if (h.fl >= 1 && rnd() < 0.32) windowBox(B, m, h.w, rnd);
        } else if (h.shop) {
          kit.add('shop', m.clone().scale(new THREE.Vector3(h.w / 3.2, 1, 1)), 0.18, { frame: 'bronze', shutters: 'none' });
          faceBox(B, f, h.a - h.w / 2 - 0.05, h.a + h.w / 2 + 0.05, h.y1, h.y1 + 0.55, 0, 0.06, 'darkMetal');
          faceBox(B, f, h.a - h.w / 2, h.a + h.w / 2, 0.0, h.y0, -0.1, 0.04, 'concrete');
          if (rnd() < 0.6) {
            const kind = ['canvasRed', 'canvasGreen', 'canvasStripe'][Math.floor(rnd() * 3)];
            const am = faceMatrix(f, h.a, h.y1 + 0.62);
            for (const [mat, g] of awningParts(kind, h.w + 0.2, 1.25, 0.42)) { g.applyMatrix4(am); B.geo(mat, g); }
          }
          if (s.signs && s.signs.length) {
            const text = s.signs[Math.floor(rnd() * s.signs.length)];
            const p = f.axis === 'x' ? { x: h.a, z: f.p + f.out * 0.075 } : { x: f.p + f.out * 0.075, z: h.a };
            const rot = f.axis === 'x' ? (f.out > 0 ? 0 : Math.PI) : (f.out > 0 ? Math.PI / 2 : -Math.PI / 2);
            B.signs.push({ text, x: p.x, y: h.y1 + 0.27, z: p.z, w: Math.min(h.w, 3.0), h: 0.42, rot, color: '#f1e6c8', bg: ['#3a2a20', '#1f3a2c', '#2a2f3a', '#5a2a1f'][Math.floor(rnd() * 4)] });
          }
        } else if (h.door) {
          // panelled double door, recessed, with a fanlight
          const dm = faceMatrix(f, h.a, 0);
          const leafs = [];
          for (const sx of [-1, 1]) {
            const g = new THREE.BoxGeometry(h.w / 2 - 0.02, 2.15, 0.06);
            g.translate(sx * (h.w / 4), 1.075, -reveal + 0.04);
            leafs.push(g);
            for (const py of [0.55, 1.55]) {
              const p = new THREE.BoxGeometry(h.w / 2 - 0.2, 0.75, 0.02);
              p.translate(sx * (h.w / 4), py, -reveal + 0.08);
              leafs.push(p);
            }
          }
          const lg = mergeGeometries(leafs.map((g) => g.toNonIndexed()), false);
          lg.applyMatrix4(dm); worldUV(lg);
          B.geo('woodDark', lg);
          const fan = new THREE.PlaneGeometry(h.w - 0.1, 0.38);
          fan.translate(0, 2.38, -reveal + 0.03);
          fan.applyMatrix4(dm); worldUV(fan);
          B.geo('glass', fan);
          doorFrame(B, 'limestone', faceMatrix(f, h.a, 0), h.w, h.y1);
          for (const sd of rnd() < 0.5 ? [-1, 1] : [rnd() < 0.5 ? -1 : 1]) lantern(B, faceMatrix(f, h.a + sd * (h.w / 2 + 0.62), 2.72));
          if (B.decals) B.decals.add('num' + Math.floor(rnd() * 6), faceMatrix(f, h.a + (h.w / 2 + 0.62) * (rnd() < 0.5 ? -1 : 1), 2.05), 0.2, 0.2);
        }
      }
    }
    // Rusticated stone base with its cap, string courses at the floor lines, quoins up the
    // corners and a profiled cornice with modillions and dentils at the top.
    const ac = (a0 + a1) / 2, L = a1 - a0, fm = faceMatrix(f, ac, 0), fx = faceDir(f);
    const doorGaps = gHoles.filter((h) => h.y0 < 0.45).map((h) => { const u = fx * (h.a - ac); return [u - h.w / 2 - (h.door ? 0.32 : 0.02), u + h.w / 2 + (h.door ? 0.32 : 0.02)]; });
    rusticate(B, 'limestone', fm, L, 0.45, rnd, doorGaps);
    plinthCap(B, 'limestone', fm, L, 0.45);
    for (let fl = 1; fl < s.floors; fl++) stringCourse(B, trim, fm, L + 0.04, gH + (fl - 1) * H - 0.06);
    for (const [a, dir] of [[a0, fx], [a1, -fx]]) quoins(B, 'limestone', faceMatrix(f, a, 0), 0.56, top - 0.5, dir);
    cornice(B, trim, fm, L + 0.3, top - 0.5);
    // posters and tags low on the wall where there's room, a street sign by each corner
    if (B.decals) {
      const holes = gHoles.map((h) => [h.a - h.w / 2 - 0.3, h.a + h.w / 2 + 0.3]).sort((p, q) => p[0] - q[0]);
      let cur = a0 + 0.9;
      for (const [h0, h1] of holes.concat([[a1 - 0.9, a1]])) {
        if (h0 - cur > 1.0) {
          const a = cur + (h0 - cur) * (0.3 + rnd() * 0.4), k = rnd();
          if (k < 0.55) B.decals.add('poster' + Math.floor(rnd() * 8), faceMatrix(f, a, 1.25 + rnd() * 0.3), 0.62, 0.86);
          else if (k < 0.8) B.decals.add(['tagVolk', 'tagArrow', 'tagMsg', 'tagCircle'][Math.floor(rnd() * 4)], faceMatrix(f, a, 0.95 + rnd() * 0.3), 1.1, 0.42);
          else B.decals.add('note' + Math.floor(rnd() * 6), faceMatrix(f, a, 1.45), 0.3, 0.18);
        }
        cur = Math.max(cur, h1);
      }
      B.decals.add('street' + Math.floor(rnd() * 3), faceMatrix(f, a0 + 1.25, 3.25), 0.86, 0.2);
    }
  }
  // Roof: clay tiles on a gable (or the old flat parapet where asked for)
  if (s.roof === 'flat') {
    B.solid(s.x0 - 0.05, top, s.z0 - 0.05, s.x1 + 0.05, top + 0.3, s.z1 + 0.05, 'concrete', 'brick');
  } else {
    B.collider(s.x0, top, s.z0, s.x1, top + 0.3, s.z1, 'brick');
    tileRoof(B, s, top, s.mat, { rnd });
  }
  // Drainpipes at the ends of street faces, clear of the quoins.
  for (const side of faces) {
    const f = faceOf(side);
    for (const a of [f.a0 + 0.78, f.a1 - 0.78]) drainpipe(B, faceMatrix(f, a, 0, 0.02), top - 0.15);
  }
  return top;
}

// --- Soviet five-storey panel block (khrushchyovka) ------------------------------------------------
// spec: { x0, z0, x1, z1, floors, face: 's', entrances: [bay indices], balconies: [bay indices], seed }
export function sovietBlock(B, kit, s) {
  const rnd = rng(s.seed || 99);
  const plinth = 0.8, FH = PANEL.h, BW = PANEL.w, reveal = 0.2;
  const floors = s.floors || 5;
  const top = plinth + floors * FH;
  const face = { axis: 'x', p: s.face === 'n' ? s.z0 : s.z1, out: s.face === 'n' ? -1 : 1, a0: s.x0, a1: s.x1 };
  // Align the panel texture's joints with this block's bays and floors.
  const pm = B.M.panel;
  for (const t of [pm.map, pm.normalMap, pm.roughnessMap]) { t.offset.set(-s.x0 / BW, -plinth / FH); }
  const inset = reveal;
  const zc0 = s.face === 'n' ? s.z0 + inset : s.z0, zc1 = s.face === 'n' ? s.z1 : s.z1 - inset;
  B.solid(s.x0, 0, zc0, s.x1, plinth, zc1, 'panelPlinth', null);
  B.solid(s.x0, plinth, zc0, s.x1, top, zc1, 'panel', null);
  B.collider(s.x0, 0, s.z0, s.x1, top, s.z1, 'concrete');
  const nb = Math.round((s.x1 - s.x0) / BW);
  const centre = (i) => s.x0 + BW * (i + 0.5);
  const ent = s.entrances || [];
  const bal = s.balconies || [];
  const levels = [{ y0: 0, y1: plinth, holes: [], mat: 'panelPlinth' }];
  for (let fl = 0; fl < floors; fl++) {
    const y0 = plinth + fl * FH;
    const holes = [];
    for (let i = 0; i < nb; i++) {
      if (ent.indexOf(i) >= 0) {
        if (fl > 0) holes.push({ a: centre(i), w: 1.2, y0: y0 + 0.3, y1: y0 + 1.15, fl, bay: i, stair: true });
        continue;
      }
      holes.push({ a: centre(i), w: 1.45, y0: y0 + 0.82, y1: y0 + 0.82 + 1.5, fl, bay: i });
    }
    levels.push({ y0, y1: y0 + FH, holes, mat: 'panel' });
  }
  // entrance openings go through the plinth too
  for (const i of ent) {
    levels[0].holes.push({ a: centre(i), w: 1.2, y0: 0, y1: plinth, door: true });
    levels[1].holes.push({ a: centre(i), w: 1.2, y0: plinth, y1: plinth + 1.45, door: true, upper: true });
  }
  skin(B, face, s.x0, s.x1, levels, reveal, 'panel');
  const tint = new THREE.Color().setHSL(0.31, 0.75, 0.82);
  for (const L of levels) {
    for (const h of L.holes) {
      if (h.door) continue;
      const m = faceMatrix(face, h.a, h.y0);
      if (h.stair) { kit.add('soviet', m.clone().scale(new THREE.Vector3(1.2 / 1.45, 0.85 / 1.5, 1)), reveal, { frame: 'wood', shutters: 'none' }); continue; }
      const isBal = bal.indexOf(h.bay) >= 0 && h.fl >= 1;
      const r = rnd();
      kit.add('soviet', m, reveal, {
        frame: r < 0.2 ? 'alu' : r < 0.3 ? 'bronze' : 'wood',
        shutters: isBal ? 'none' : 'auto',
        tint: tint.clone().offsetHSL((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.12),
      });
      if (h.fl === 0) kit.grille(m, 1.45, 1.5, reveal);
    }
  }
  // Entrances: steel door, concrete canopy on brackets, steps, a lamp and the stair window above.
  for (const i of ent) {
    const a = centre(i);
    const dm = faceMatrix(face, a, 0);
    const door = new THREE.BoxGeometry(1.1, 2.1, 0.06);
    door.translate(0, 0.0 + 1.05, -reveal - 0.02);
    door.applyMatrix4(dm); worldUV(door);
    B.geo('carGreen', door);
    faceBox(B, face, a - 1.0, a + 1.0, plinth + 1.45, plinth + 1.6, 0, 1.3, 'concrete');
    for (const sx of [-0.85, 0.85]) faceBox(B, face, a + sx - 0.06, a + sx + 0.06, plinth + 1.2, plinth + 1.45, 0, 0.9, 'concrete');
    faceBox(B, face, a - 0.95, a + 0.95, 0, 0.12, 0, 1.25, 'concrete', 'concrete');
    // a bare bulb in a cage over the door
    const lamp = new THREE.SphereGeometry(0.07, 10, 8);
    lamp.applyMatrix4(faceMatrix(face, a, plinth + 1.3, 0.12));
    B.geo('lampGlow', lamp);
  }
  // Balconies: cantilevered slabs with steel railings and corrugated infill; some glazed.
  for (const i of bal) {
    const a = centre(i);
    for (let fl = 1; fl < floors; fl++) {
      const y = plinth + fl * FH;
      faceBox(B, face, a - 1.35, a + 1.35, y - 0.16, y, 0, 1.05, 'concrete', 'concrete');
      // railing: posts, top rail and a corrugated sheet
      for (const px of [-1.3, 0, 1.3]) faceBox(B, face, a + px - 0.02, a + px + 0.02, y, y + 1.0, 0.98, 1.02, 'balconyRail');
      faceBox(B, face, a - 1.33, a + 1.33, y + 0.97, y + 1.02, 0.96, 1.04, 'balconyRail');
      for (const sx of [-1, 1]) faceBox(B, face, a + sx * 1.31 - 0.02, a + sx * 1.31 + 0.02, y + 0.97, y + 1.02, 0, 1.0, 'balconyRail');
      const sheet = corrugated(2.6, 0.82);
      sheet.applyMatrix4(faceMatrix(face, a, y + 0.1, 1.0));
      B.geo('corrugated', sheet);
      for (const sx of [-1, 1]) {
        const side = corrugated(0.95, 0.82);
        side.rotateY(Math.PI / 2);
        side.translate(sx * 1.31, 0, 0.5);
        side.applyMatrix4(faceMatrix(face, a, y + 0.1, 0));
        B.geo('corrugated', side);
      }
      const fate = rnd();
      if (fate < 0.25 && fl >= 2) {
        // glazed in by the tenants: timber frames and glass
        for (let k = 0; k < 4; k++) {
          const x = -1.3 + k * 0.866;
          faceBox(B, face, a + x - 0.03, a + x + 0.03, y + 1.02, y + 2.6, 0.97, 1.03, 'frameWood');
        }
        faceBox(B, face, a - 1.33, a + 1.33, y + 2.6, y + 2.66, 0.95, 1.05, 'frameWood');
        const gl = new THREE.PlaneGeometry(2.6, 1.56);
        gl.translate(0, 0.78, 0);
        gl.applyMatrix4(faceMatrix(face, a, y + 1.03, 1.0));
        worldUV(gl);
        B.geo('glass', gl, false);
        faceBox(B, face, a - 1.35, a + 1.35, y + 2.66, y + 2.72, 0, 1.12, 'corrugated');
      } else if (fate < 0.5) {
        laundry(B, face, a, y, rnd);
      } else if (fate < 0.62) {
        dish(B, face, a + (rnd() - 0.5) * 1.6, y + 1.25, 0.9);
      }
    }
  }
  // Roof: parapet, stairwell huts, vent stacks, TV aerials.
  const d0 = s.z0, d1 = s.z1;
  B.solid(s.x0, top, d0, s.x1, top + 0.55, d0 + 0.25, 'panel', 'concrete');
  B.solid(s.x0, top, d1 - 0.25, s.x1, top + 0.55, d1, 'panel', 'concrete');
  B.solid(s.x0, top, d0, s.x0 + 0.25, top + 0.55, d1, 'panel', 'concrete');
  B.solid(s.x1 - 0.25, top, d0, s.x1, top + 0.55, d1, 'panel', 'concrete');
  faceBox(B, face, s.x0, s.x1, top + 0.55, top + 0.62, -0.1, 0.06, 'galvanized');
  for (const i of ent) {
    const cz = (d0 + d1) / 2;
    B.solid(centre(i) - 1.2, top, cz - 1.4, centre(i) + 1.2, top + 2.3, cz + 1.4, 'panelPlinth', null);
  }
  for (let k = 0; k < nb; k += 2) {
    const cz = d0 + 2 + rnd() * (d1 - d0 - 4);
    B.solid(centre(k) - 0.3, top, cz - 0.3, centre(k) + 0.3, top + 0.9, cz + 0.3, 'panelPlinth', null);
    if (rnd() < 0.7) aerial(B, centre(k) + 0.8, top, cz + 0.5, rnd);
  }
  // External drainpipes.
  for (const a of [s.x0 + 0.3, s.x1 - 0.3]) {
    const g = new THREE.CylinderGeometry(0.06, 0.06, top, 10);
    g.translate(0, top / 2, 0);
    g.applyMatrix4(faceMatrix(face, a, 0, 0.12));
    B.geo('galvanized', g);
  }
  return top;
}

// A corrugated sheet in the XY plane (width w, height h), ridges vertical.
function corrugated(w, h) {
  const segs = Math.round(w / 0.019);
  const g = new THREE.PlaneGeometry(w, h, segs, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) / 0.076 * Math.PI * 2) * 0.012);
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  worldUV(g);
  const back = g.clone();
  back.rotateY(Math.PI);
  back.translate(0, 0, 0);
  return mergeGeometries([g.toNonIndexed(), back.toNonIndexed()], false);
}

function laundry(B, face, a, y, rnd) {
  const yl = y + 1.75;
  faceBox(B, face, a - 1.3, a + 1.3, yl - 0.004, yl + 0.004, 0.85, 0.858, 'darkMetal');
  const cols = ['fabric', 'canvasStripe', 'paper', 'canvasRed', 'canvasGreen'];
  let x = -1.2;
  while (x < 1.1) {
    const w = 0.25 + rnd() * 0.35, h = 0.3 + rnd() * 0.45;
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(x + w / 2, -h / 2, 0);
    g.rotateY((rnd() - 0.5) * 0.3);
    g.applyMatrix4(faceMatrix(face, a, yl, 0.854));
    worldUV(g);
    B.geo(cols[Math.floor(rnd() * cols.length)], g);
    x += w + 0.08 + rnd() * 0.15;
  }
}

function dish(B, face, a, y, d) {
  const g = new THREE.SphereGeometry(0.42, 18, 6, 0, Math.PI * 2, 0, 0.55);
  g.scale(1, 1, 0.4);
  g.rotateX(-Math.PI / 2 + 0.5);
  const m = faceMatrix(face, a, y, d);
  g.applyMatrix4(m); worldUV(g);
  B.geo('paper', g);
  const arm = new THREE.CylinderGeometry(0.012, 0.012, 0.45, 5);
  arm.rotateX(Math.PI / 2 - 0.5);
  arm.translate(0, -0.1, 0.2);
  arm.applyMatrix4(m);
  B.geo('darkMetal', arm);
}

function aerial(B, x, y, z, rnd) {
  const h = 2 + rnd() * 1.5;
  B.geo('darkMetal', new THREE.CylinderGeometry(0.022, 0.03, h, 6).translate(x, y + h / 2, z));
  for (let k = 0; k < 4; k++) {
    const len = 1.2 - k * 0.2;
    const g = new THREE.CylinderGeometry(0.008, 0.008, len, 4);
    g.rotateZ(Math.PI / 2);
    g.rotateY(rnd() * 0.3);
    g.translate(x, y + h - 0.15 - k * 0.22, z);
    B.geo('darkMetal', g);
  }
}
