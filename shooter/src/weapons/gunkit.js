// Shared pieces for the procedural gun models: the Gun container (static parts merged per
// material, moving parts as their own meshes), small primitive helpers and cartridges.
// Local axes: barrel along -Z, +Y up, +X right. Units are metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedBox, lathe, tubeZ } from '../core/geometry.js';

// Q.low is set while building a third-person model: fewer segments, no fine detail.
export const Q = { low: false };
export const seg = (n) => (Q.low ? Math.max(6, Math.round(n / 2)) : n);
export const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function rb(w, h, d, x, y, z, r = 0.002) { const g = Q.low ? new THREE.BoxGeometry(w, h, d) : roundedBox(w, h, d, r, 2); g.translate(x, y, z); return g; }
export function bx(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
export function cz(r0, r1, z0, z1, x = 0, y = 0, n = 20, open = false) { const g = tubeZ(r0, r1, z0, z1, seg(n), open); g.translate(x, y, 0); return g; }
export function cx(r, len, x, y, z, n = 12) { const g = new THREE.CylinderGeometry(r, r, len, seg(n)); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return g; }
export function cy(r, len, x, y, z, n = 12) { const g = new THREE.CylinderGeometry(r, r, len, seg(n)); g.translate(x, y, z); return g; }

export class Gun {
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
  }
  // Static geometry, merged per material. Accepts one geometry or an array.
  s(mat, geo) {
    if (!this.pending.has(mat)) this.pending.set(mat, []);
    const list = this.pending.get(mat);
    if (Array.isArray(geo)) list.push(...geo); else list.push(geo);
  }
  // A separate mesh (moving part or attachment child).
  m(mat, geo, parent = this.body, name) {
    const mesh = new THREE.Mesh(Array.isArray(geo) ? merge(geo) : geo, mat);
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
    for (const [mat, geos] of this.pending) this.body.add(new THREE.Mesh(merge(geos), mat));
    this.pending.clear();
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = !!shadows; o.receiveShadow = false; } });
    return this;
  }
}

// Merge geometries that may differ in indexing and extra attributes.
export function merge(geos) {
  const flat = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  });
  return flat.length === 1 ? flat[0] : mergeGeometries(flat, false);
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

// --- markings ---------------------------------------------------------------------------------
// Roll marks, selector markings and logos: canvas text with alpha on a thin plane laid right on a
// surface, winning the depth test by polygon offset. An engraving reads as a dark cut with a faint
// light lip along each letter's lower edge, where the cut's wall catches light from above; a print
// is flat ink. Textures and materials are shared by every build of a gun.
export const MARK_FONT = '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';
const markCache = new Map();

// lines: [{ text, size (of the line height), weight, align, spacing (px) }] or draw(g, w, h)
function markTexture(lines, w, h, style) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const paint = (fill, dy) => {
    g.fillStyle = fill;
    g.save();
    g.translate(0, dy);
    if (typeof lines === 'function') lines(g, w, h);
    else {
      const lh = h / lines.length;
      g.textBaseline = 'middle';
      lines.forEach((l, i) => {
        const font = (px) => (l.weight || 600) + ' ' + px + 'px ' + MARK_FONT;
        let px = Math.round((l.size || 0.72) * lh);
        g.font = font(px);
        if ('letterSpacing' in g) g.letterSpacing = (l.spacing ?? 2) + 'px';
        // shrink a line that would run off the plate
        const tw = g.measureText(l.text).width, room = w - 14;
        if (tw > room) { px = Math.floor(px * room / tw); g.font = font(px); }
        g.textAlign = l.align || 'center';
        g.fillText(l.text, l.align === 'left' ? 6 : l.align === 'right' ? w - 6 : w / 2, lh * (i + 0.5));
      });
    }
    g.restore();
  };
  if (style === 'print') paint('rgba(222, 218, 206, 0.88)', 0);
  else if (style === 'laser') paint('rgba(178, 180, 184, 0.86)', 0); // laser marking bleaches anodising
  else {
    paint('rgba(232, 228, 216, 0.5)', Math.max(1, h * 0.018)); // lit lower lip of the cut
    paint('rgba(5, 5, 5, ' + (style === 'mould' ? 0.62 : 0.88) + ')', 0);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A marking w × h metres centred on (x, y, z), on a surface facing +X (side 1) or -X (side -1).
// style: 'engrave' (default), 'laser' (light, on black anodising), 'mould' or 'print'. `dome`
// (with the cap's flat x) lays it on a pillowed cap. key names the shared texture.
export function marking(key, lines, px, w, h, x, y, z, side, opts = {}) {
  const style = opts.style || 'engrave';
  let mat = markCache.get(key + '|' + style);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      map: markTexture(lines, px[0], px[1], style), transparent: true, depthWrite: false, roughness: style === 'print' ? 0.7 : 0.9, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: 0.5,
    });
    mat.name = 'gun_marking';
    markCache.set(key + '|' + style, mat);
  }
  const seg = opts.dome ? 8 : 1;
  const geo = new THREE.PlaneGeometry(w, h, seg, Math.max(1, Math.round(seg * h / w)));
  geo.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  geo.translate(x, y, z);
  if (opts.dome) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, side * (Math.abs(x) + opts.dome.at(p.getZ(i), p.getY(i)).h));
  }
  if (opts.rot) { geo.translate(-x, -y, -z); geo.rotateX(opts.rot); geo.translate(x, y, z); }
  const m = new THREE.Mesh(geo, mat);
  m.name = 'marking';
  m.renderOrder = 1;
  return m;
}

export function makeRound(M, kind) {
  const g = new THREE.Group();
  const c = cartridgeGeo(kind);
  g.add(new THREE.Mesh(c.brass, M.brass));
  g.add(new THREE.Mesh(c.tip, kind === 'shell' ? M.shell : M.copper));
  return g;
}
