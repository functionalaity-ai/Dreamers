// Geometry helpers: world-UV boxes, lathes, extrusions and merging by material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Box spanning two corners, with UVs in metres so adjacent pieces tile seamlessly.
export function worldBox(x0, y0, z0, x1, y1, z1) {
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  worldUV(g);
  return g;
}

// Planar-project UVs from world position by dominant normal axis.
export function worldUV(g, scale = 1) {
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export function roundedBox(w, h, d, r = 0.004, seg = 2) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
}

// Lathe around Y from [radius, y] pairs.
export function lathe(points, segments = 24) {
  return new THREE.LatheGeometry(points.map((p) => new THREE.Vector2(p[0], p[1])), segments);
}

// Extrude a 2D profile (points in the ZY plane given as [z, y]) to a thickness along X, centred.
export function profile(points, thickness, bevel = 0.0015) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.0005, thickness - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6,
  });
  // Shape is in XY, extruded along +Z. Rotate so the profile sits in ZY with thickness along X.
  g.translate(0, 0, -(thickness - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

// Cylinder along Z from z0 to z1.
export function tubeZ(r0, r1, z0, z1, seg = 20, open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, Math.abs(z1 - z0), seg, 1, open);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, (z0 + z1) / 2);
  // After rotating, the cylinder's top (r1) faces +Z, so r0 sits at z0 and r1 at z1 (for z0 < z1).
  return g;
}

// Collects geometries per material and merges them, per material, into meshes the camera can cull:
// a material with a lot of triangles is split into spatial chunks (each of at most CHUNK_TRIS), so
// what's behind you or round the corner isn't drawn, and nearer chunks draw first. Shared vertices
// stay shared (indexed), so each one is shaded once instead of once per triangle.
const CHUNK_TRIS = 60000;
export class Batcher {
  constructor() { this.groups = new Map(); }
  add(mat, geo, matrix) {
    if (matrix) geo.applyMatrix4(matrix);
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push(prep(geo, mat.vertexColors));
  }
  build(parent, opts = {}) {
    const meshes = [];
    for (const [mat, geos] of this.groups) {
      if (!geos.length) continue;
      // transparent surfaces stay in one mesh, so they blend in the same order as before
      for (const part of mat.transparent ? [geos] : chunk(geos)) {
        const merged = mergeGeometries(part, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const m = new THREE.Mesh(merged, mat);
        if (mat.userData && mat.userData.depth) m.customDepthMaterial = mat.userData.depth;
        m.castShadow = opts.cast !== false;
        m.receiveShadow = opts.receive !== false;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        parent.add(m);
        meshes.push(m);
      }
      for (const g of geos) g.dispose();
    }
    this.groups.clear();
    return meshes;
  }
}

// Split geometries into spatial groups of at most CHUNK_TRIS triangles: halve along the longer
// horizontal spread of their centres, at the triangle-weighted median.
function chunk(geos) {
  const items = geos.map((g) => {
    if (!g.boundingBox) g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    return { g, x: c.x, z: c.z, tris: g.index.count / 3 };
  });
  const out = [];
  const split = (list) => {
    let tris = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const it of list) { tris += it.tris; x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x); z0 = Math.min(z0, it.z); z1 = Math.max(z1, it.z); }
    if (tris <= CHUNK_TRIS || list.length < 2) { out.push(list.map((it) => it.g)); return; }
    const k = x1 - x0 >= z1 - z0 ? 'x' : 'z';
    list.sort((a, b) => a[k] - b[k]);
    let acc = 0, i = 0;
    while (i < list.length - 1 && acc + list[i].tris <= tris / 2) acc += list[i++].tris;
    i = Math.max(1, i);
    split(list.slice(0, i));
    split(list.slice(i));
  };
  split(items);
  return out;
}

// mergeGeometries needs matching attribute sets: position/normal/uv (plus colour, for materials that
// read it), all indexed. Geometry without normals is split into flat faces first, as before.
function prep(g, keepColor = false) {
  let out = g;
  if (!out.attributes.normal) {
    if (out.index) { out = g.toNonIndexed(); g.dispose(); }
    out.computeVertexNormals();
  }
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && !(keepColor && k === 'color')) out.deleteAttribute(k);
  out.morphAttributes = {};
  out.clearGroups();
  if (!out.index) {
    const n = out.attributes.position.count, ix = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) ix[i] = i;
    out.setIndex(new THREE.BufferAttribute(ix, 1));
  }
  return out;
}
