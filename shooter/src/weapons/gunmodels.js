// Procedural, real-scale firearm models. Local axes: barrel along -Z, +Y up, +X right.
// Every gun exposes its moving parts (bolt, dust cover, slide, pump, magazine, trigger,
// selector) and anchor points (hands, sight line, muzzle, ejection port).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Q, cartridgeGeo, makeRound } from './gunkit.js';
import { buildKestrel, buildRifleMag } from './kestrel.js';
import { buildWarden } from './pistol.js';
import { buildBastion } from './shotgun.js';
import { EDGES } from '../core/shapes.js';
import { WEAPONS } from '../config.js';

const BUILDERS = { kestrel: buildKestrel, warden: buildWarden, bastion: buildBastion };

// A finish swaps the receiver metal and the polymer furniture for coloured versions.
const FINISHES = {
  black: {},
  fde: { anodized: 'fdeMetal', anodizedDS: 'fdeMetalDS', polymer: 'fdePoly' },
  odg: { anodized: 'odgMetal', anodizedDS: 'odgMetalDS', polymer: 'odgPoly' },
};

export function finishOf(id, att) { return (att && att.finish) || WEAPONS[id].finish || 'black'; }

// The material set for a gun in its finish (falls back to M for anything not swapped).
export function gunMaterials(id, att, M) {
  const f = FINISHES[finishOf(id, att)];
  if (!f) return M;
  const out = Object.create(M);
  for (const k in f) if (M[f[k]]) out[k] = M[f[k]];
  return out;
}

// opts: { fp: first-person detail (markings, rounds, rolled edges, moulded polymer), shadows }
export function buildGun(id, att, M, opts = {}) {
  Q.low = !opts.fp;
  EDGES.round = !!opts.fp;
  let g;
  try { g = BUILDERS[id](gunMaterials(id, att, M), att || {}, Object.assign({ finish: finishOf(id, att) }, opts)); } finally { Q.low = false; EDGES.round = false; }
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

export { buildRifleMag, cartridgeGeo, makeRound };
