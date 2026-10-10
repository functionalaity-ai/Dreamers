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

export function makeRound(M, kind) {
  const g = new THREE.Group();
  const c = cartridgeGeo(kind);
  g.add(new THREE.Mesh(c.brass, M.brass));
  g.add(new THREE.Mesh(c.tip, kind === 'shell' ? M.shell : M.copper));
  return g;
}
