// Navigation graph sampled from the collision world, with cover detection and A*.
import * as THREE from 'three';

const DIRS = [];
for (let i = 0; i < 8; i++) DIRS.push(new THREE.Vector3(Math.cos(i * Math.PI / 4), 0, Math.sin(i * Math.PI / 4)));

export class NavGraph {
  constructor(physics, bounds) {
    this.ph = physics;
    this.b = bounds;
    this.nodes = [];
    this.cell = 2;
    this.hash = new Map();
  }

  key(x, z) { return Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell); }

  standable(x, y, z) {
    const ph = this.ph;
    const g = ph.groundHeight(x, z, 0.06, y + 0.05);
    if (Math.abs(g - y) > 0.06) return false;
    return ph.boxFree(x - 0.3, y + 0.46, z - 0.3, x + 0.3, y + 1.72, z + 0.3);
  }

  addNode(x, y, z) {
    const n = { id: this.nodes.length, p: new THREE.Vector3(x, y, z), edges: [], cover: [] };
    this.nodes.push(n);
    const k = this.key(x, z);
    if (!this.hash.has(k)) this.hash.set(k, []);
    this.hash.get(k).push(n);
    return n;
  }

  near(p, radius, fn) {
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(p.x / this.cell), cz = Math.floor(p.z / this.cell);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const list = this.hash.get((cx + dx) + ',' + (cz + dz));
        if (list) for (const n of list) fn(n);
      }
    }
  }

  // opts (the big map; Team Deathmatch passes none): sp grid spacing, link edge length, maxY highest
  // floor sampled, maxIter A* budget, fast: open-ground edges pass on one swept-box test
  build(hints, area, opts = {}) {
    const ph = this.ph;
    const sp = opts.sp || 1.25, link = opts.link || 1.9, maxY = opts.maxY || 7.6;
    this.maxIter = opts.maxIter || 6000;
    this.fast = !!opts.fast;
    const tmp = [];
    for (let x = area.minX; x <= area.maxX; x += sp) {
      for (let z = area.minZ; z <= area.maxZ; z += sp) {
        const heights = new Set([0]);
        for (const b of ph.overlap(x - 0.02, -1, z - 0.02, x + 0.02, maxY + 1.4, z + 0.02, tmp)) if (b.max[1] < maxY) heights.add(Math.round(b.max[1] * 1000) / 1000);
        for (const h of heights) if (this.standable(x, h, z)) this.addNode(x, h, z);
      }
    }
    for (const h of hints) {
      const y = ph.groundHeight(h.x, h.z, 0.05, h.y + 0.5);
      if (this.standable(h.x, y, h.z)) this.addNode(h.x, y, h.z);
    }
    // Edges
    for (const n of this.nodes) {
      this.near(n.p, Math.max(2, link), (m) => {
        if (m.id <= n.id) return;
        const d = n.p.distanceTo(m.p);
        if (d > link || Math.abs(n.p.y - m.p.y) > 1.1) return;
        if (this.walkable(n.p, m.p)) { n.edges.push({ to: m.id, c: d }); m.edges.push({ to: n.id, c: d }); }
      });
    }
    // Drop isolated islands (rooftops of facades, etc.) by keeping the largest component.
    const comp = new Int32Array(this.nodes.length).fill(-1);
    let best = -1, bestSize = 0, cid = 0;
    for (const n of this.nodes) {
      if (comp[n.id] >= 0) continue;
      const stack = [n.id];
      comp[n.id] = cid;
      let size = 0;
      while (stack.length) {
        const i = stack.pop();
        size++;
        for (const e of this.nodes[i].edges) if (comp[e.to] < 0) { comp[e.to] = cid; stack.push(e.to); }
      }
      if (size > bestSize) { bestSize = size; best = cid; }
      cid++;
    }
    for (const n of this.nodes) n.ok = comp[n.id] === best;
    this.computeCover();
    return this;
  }

  // Walk the segment in small steps; climbing must stay within step height.
  walkable(a, b) {
    const ph = this.ph;
    if (this.fast && a.y < 0.01 && b.y < 0.01 && ph.boxFree(Math.min(a.x, b.x) - 0.27, 0.46, Math.min(a.z, b.z) - 0.27, Math.max(a.x, b.x) + 0.27, 1.7, Math.max(a.z, b.z) + 0.27)) return true;
    const d = new THREE.Vector3().subVectors(b, a);
    const len = Math.hypot(d.x, d.z);
    const steps = Math.max(1, Math.ceil(len / 0.3));
    let h = a.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + d.x * t, z = a.z + d.z * t;
      const g = ph.groundHeight(x, z, 0.08, h + 0.45);
      if (g < h - 0.55) return false;
      if (!ph.boxFree(x - 0.27, g + 0.46, z - 0.27, x + 0.27, g + 1.7, z + 0.27)) return false;
      h = g;
    }
    return Math.abs(h - b.y) < 0.3;
  }

  computeCover() {
    const ph = this.ph;
    const o = new THREE.Vector3();
    for (const n of this.nodes) {
      if (!n.ok) continue;
      for (const d of DIRS) {
        o.set(n.p.x, n.p.y + 0.8, n.p.z);
        const low = ph.raycast(o, d, 1.1);
        if (!low) continue;
        o.y = n.p.y + 1.5;
        const high = ph.raycast(o, d, 1.2);
        n.cover.push({ dir: d, high: !!high });
      }
    }
    this.coverNodes = this.nodes.filter((n) => n.ok && n.cover.length);
  }

  nearest(p, maxDist = 4) {
    let best = null, bd = Infinity;
    this.near(p, maxDist, (n) => {
      if (!n.ok) return;
      const dy = Math.abs(n.p.y - p.y);
      if (dy > 1.4) return;
      const d = n.p.distanceToSquared(p) + dy * dy * 4;
      if (d < bd) { bd = d; best = n; }
    });
    return best;
  }

  // A* from position to position. cost(node) adds a penalty (e.g. exposure to the enemy).
  path(from, to, cost) {
    const s = this.nearest(from), g = this.nearest(to, 6);
    if (!s || !g) return null;
    const N = this.nodes.length;
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new Heap();
    gScore[s.id] = 0;
    heap.push(s.id, s.p.distanceTo(g.p));
    let found = false;
    let iter = 0;
    while (heap.size && iter++ < (this.maxIter || 6000)) {
      const cur = heap.pop();
      if (cur === g.id) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cn = this.nodes[cur];
      for (const e of cn.edges) {
        const m = this.nodes[e.to];
        if (!m.ok || closed[e.to]) continue;
        const ng = gScore[cur] + e.c + (cost ? cost(m) : 0);
        if (ng < gScore[e.to]) {
          gScore[e.to] = ng;
          came[e.to] = cur;
          heap.push(e.to, ng + m.p.distanceTo(g.p));
        }
      }
    }
    if (!found) return null;
    const out = [];
    for (let c = g.id; c !== -1; c = came[c]) out.push(this.nodes[c].p.clone());
    out.reverse();
    out.push(to.clone());
    return this.smooth(out);
  }

  // Skip waypoints that can be walked to directly.
  smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 6);
      while (j > i + 1 && !(Math.abs(pts[j].y - pts[i].y) < 0.1 && this.walkable(pts[i], pts[j]))) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
