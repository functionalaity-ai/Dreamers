// Regions and level of detail for the big map.
//
// The map is cut into 70 m cells; the four round Old Town make one central region. Everything the
// builders make is filed under a region (a building under the region of its centre, a long road or
// ground slab is cut at the region edges), and each region gets its detailed meshes and a cheap
// proxy (shells, roofs, window quads, ground) of the same materials. Near the camera a region shows
// its detail (and its windows and loot containers), farther away its proxy.
import * as THREE from 'three';
import { Builder } from '../builder.js';
import { WindowKit } from '../facades.js';
import { worldBox, Batcher } from '../../core/geometry.js';

export class Regions {
  constructor(bounds, cell = 70) {
    this.b = bounds;
    this.cell = cell;
    this.nx = Math.round((bounds.maxX - bounds.minX) / cell);
    this.nz = Math.round((bounds.maxZ - bounds.minZ) / cell);
    // the 2 x 2 cells round the middle are one region (Old Town)
    const cx = this.nx / 2 - 1, cz = this.nz / 2 - 1;
    this.ids = new Int32Array(this.nx * this.nz);
    this.list = [{ id: 0, x0: bounds.minX + cx * cell, z0: bounds.minZ + cz * cell, x1: bounds.minX + (cx + 2) * cell, z1: bounds.minZ + (cz + 2) * cell, name: 'core' }];
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        if ((ix === cx || ix === cx + 1) && (iz === cz || iz === cz + 1)) { this.ids[iz * this.nx + ix] = 0; continue; }
        const id = this.list.length;
        this.ids[iz * this.nx + ix] = id;
        this.list.push({ id, x0: bounds.minX + ix * cell, z0: bounds.minZ + iz * cell, x1: bounds.minX + (ix + 1) * cell, z1: bounds.minZ + (iz + 1) * cell, name: ix + ',' + iz });
      }
    }
    // the grid lines a box is cut along
    this.xs = []; this.zs = [];
    for (let i = 1; i < this.nx; i++) this.xs.push(bounds.minX + i * cell);
    for (let i = 1; i < this.nz; i++) this.zs.push(bounds.minZ + i * cell);
  }

  at(x, z) {
    const ix = Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.b.minX) / this.cell)));
    const iz = Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.b.minZ) / this.cell)));
    return this.ids[iz * this.nx + ix];
  }

  // [x0, x1] split at the grid lines
  cuts(a0, a1, lines) {
    const out = [a0];
    for (const l of lines) if (l > a0 + 1e-3 && l < a1 - 1e-3) out.push(l);
    out.push(a1);
    return out;
  }
}

const _box = new THREE.Box3(), _c = new THREE.Vector3();

// A Batcher stand-in that files each geometry under a region (the builder's current owner, or the
// region of the geometry's centre).
// Small pieces (under FINE metres every way: handles, litter, window boxes, lamp heads...) go to a
// separate 'fine' batch per region, drawn only from closer by.
const FINE = 0.8;
class RegionBatcher {
  constructor(B, fine) { this.B = B; this.parts = new Map(); this.fine = fine ? new Map() : null; }
  into(r, small) {
    const m = small && this.fine ? this.fine : this.parts;
    if (!m.has(r)) m.set(r, new Batcher());
    return m.get(r);
  }
  add(mat, geo, matrix) {
    if (matrix) geo.applyMatrix4(matrix);
    const r = this.B.regionOf(geo), bb = geo.boundingBox;
    this.into(r, bb.max.x - bb.min.x < FINE && bb.max.y - bb.min.y < FINE && bb.max.z - bb.min.z < FINE).add(mat, geo);
  }
}

// Builder whose meshes come out per region, with a proxy batch beside the detail.
export class RegionBuilder extends Builder {
  constructor(physics, materials, regions) {
    super(physics, materials);
    this.regions = regions;
    this.owner = null;
    this.batch = new RegionBatcher(this, true);
    this.noShadow = new RegionBatcher(this, true);
    this.proxyBatch = new RegionBatcher(this, false);
  }

  // Everything made until own(null) belongs to the region of (x, z).
  own(x, z) { this.owner = x === null ? null : this.regions.at(x, z); }

  regionOf(geo) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (this.owner !== null) return this.owner;
    _box.copy(geo.boundingBox).getCenter(_c);
    return this.regions.at(_c.x, _c.z);
  }

  // Boxes are cut at the region edges (unless they have an owner), so a long road or ground slab
  // shows its detail exactly where its region does.
  solid(x0, y0, z0, x1, y1, z1, mat, phys = 'concrete', opts = {}) {
    if (Math.abs(x1 - x0) < 1e-4 || Math.abs(y1 - y0) < 1e-4 || Math.abs(z1 - z0) < 1e-4) return;
    if (phys) this.ph.add(x0, y0, z0, x1, y1, z1, phys, opts.flags || {});
    this.splitBox(opts.shadow === false ? this.noShadow : this.batch, this.mat(mat), Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1));
  }

  splitBox(target, m, x0, y0, z0, x1, y1, z1) {
    const small = x1 - x0 < FINE && y1 - y0 < FINE && z1 - z0 < FINE;
    if (this.owner !== null || small) { target.into(this.owner !== null ? this.owner : this.regions.at((x0 + x1) / 2, (z0 + z1) / 2), small).add(m, worldBox(x0, y0, z0, x1, y1, z1)); return; }
    const R = this.regions, xs = R.cuts(x0, x1, R.xs), zs = R.cuts(z0, z1, R.zs);
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < zs.length - 1; j++) {
        target.into(R.at((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2)).add(m, worldBox(xs[i], y0, zs[j], xs[i + 1], y1, zs[j + 1]));
      }
    }
  }

  // Proxy pieces: a box, or any positioned geometry.
  proxyBox(x0, y0, z0, x1, y1, z1, mat) {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return;
    this.splitBox(this.proxyBatch, this.mat(mat), x0, y0, z0, x1, y1, z1);
  }
  proxyGeo(mat, g) { this.proxyBatch.add(this.mat(mat), g); }

  // One group per region: { detail, proxy } (meshes merged per material, chunked for culling).
  build(scene) {
    const root = new THREE.Group();
    root.name = 'brWorld';
    this.parts = this.regions.list.map((r) => {
      const detail = new THREE.Group(), proxy = new THREE.Group(), fine = new THREE.Group();
      detail.name = 'detail:' + r.name; proxy.name = 'proxy:' + r.name; fine.name = 'fine:' + r.name;
      detail.add(fine);
      root.add(detail, proxy);
      return { detail, proxy, fine };
    });
    for (const [r, b] of this.batch.parts) b.build(this.parts[r].detail, { cast: true, receive: true });
    for (const [r, b] of this.noShadow.parts) b.build(this.parts[r].detail, { cast: false, receive: true });
    for (const [r, b] of this.batch.fine) b.build(this.parts[r].fine, { cast: true, receive: true });
    for (const [r, b] of this.noShadow.fine) b.build(this.parts[r].fine, { cast: false, receive: true });
    // proxies are only seen from afar, outside the sun's shadow box: they neither cast nor need to
    for (const [r, b] of this.proxyBatch.parts) b.build(this.parts[r].proxy, { cast: false, receive: true });
    for (const p of this.parts) p.proxy.visible = false;
    scene.add(root);
    this.group = root;
    return root;
  }
}

// Window kit whose instanced meshes come out per region (so far windows are not drawn at all).
export class RegionKit extends WindowKit {
  constructor(M, B, opts) {
    super(M, opts);
    this.B = B;
  }
  push(geo, mat, matrix, color, cast = true) {
    if (!geo) return;
    const B = this.B, r = B.owner !== null ? B.owner : B.regions.at(matrix.elements[12], matrix.elements[14]);
    const key = r + '|' + geo.uuid + '|' + mat.uuid;
    if (!this.lists.has(key)) this.lists.set(key, { geo, mat, matrices: [], colors: [], cast, region: r });
    const l = this.lists.get(key);
    l.matrices.push(matrix.clone());
    l.colors.push(color || null);
  }
  build(scene) {
    const group = new THREE.Group();
    group.name = 'windows';
    this.byRegion = new Map();
    for (const l of this.lists.values()) {
      const mesh = new THREE.InstancedMesh(l.geo, l.mat, l.matrices.length);
      l.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      if (l.colors.some(Boolean)) l.colors.forEach((c, i) => mesh.setColorAt(i, c || new THREE.Color(1, 1, 1)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = this.shadows && l.cast;
      mesh.userData.cast = l.cast;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      if (!this.byRegion.has(l.region)) {
        const g = new THREE.Group();
        g.name = 'windows:' + l.region;
        group.add(g);
        this.byRegion.set(l.region, g);
      }
      this.byRegion.get(l.region).add(mesh);
    }
    scene.add(group);
    this.group = group;
    return group;
  }
}

// Switches each region between detail and proxy by its distance from the camera (with a little
// hysteresis). detail/proxy: per region, lists of objects to show in either state.
export class LODSwitch {
  constructor(regions, opts = {}) {
    this.regions = regions;
    this.near = opts.near || 155;
    this.margin = opts.margin || 15;
    this.top = opts.top || 30;
    this.state = regions.list.map(() => null);
    this.detail = regions.list.map(() => []);
    this.proxy = regions.list.map(() => []);
    // closer tiers inside a detailed region: { objs, near, on } (small pieces, windows)
    this.tiers = regions.list.map(() => []);
    this.version = 0;
    this.onChange = null;
  }
  add(region, detailObj, proxyObj) {
    if (detailObj) this.detail[region].push(detailObj);
    if (proxyObj) this.proxy[region].push(proxyObj);
  }
  addTier(region, obj, near) { this.tiers[region].push({ obj, near, on: null }); }
  distance(r, p) {
    const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1), dz = Math.max(r.z0 - p.z, 0, p.z - r.z1), dy = Math.max(0, p.y - this.top);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  // Returns true when anything switched (the sun's cached shadow is then stale).
  update(camera) {
    const p = camera.position;
    let changed = false;
    for (const r of this.regions.list) {
      const d = this.distance(r, p), cur = this.state[r.id];
      const near = cur === true ? d < this.near + this.margin : d < this.near;
      for (const t of this.tiers[r.id]) {
        const on = t.on === true ? d < t.near + this.margin : d < t.near;
        if (on !== t.on) { t.on = on; t.obj.visible = on; changed = true; }
      }
      if (near === cur) continue;
      this.state[r.id] = near;
      for (const o of this.detail[r.id]) o.visible = near;
      for (const o of this.proxy[r.id]) o.visible = !near;
      changed = true;
    }
    if (changed) { this.version++; if (this.onChange) this.onChange(); }
    return changed;
  }
  // Force a state everywhere (tests: everything detailed, or everything proxy).
  force(near) {
    for (const r of this.regions.list) {
      this.state[r.id] = near;
      for (const t of this.tiers[r.id]) { t.on = near; t.obj.visible = near; }
      for (const o of this.detail[r.id]) o.visible = near;
      for (const o of this.proxy[r.id]) o.visible = !near;
    }
    this.version++;
    if (this.onChange) this.onChange();
  }
}
