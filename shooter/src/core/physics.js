// Collision world: axis-aligned boxes in a 2D grid (XZ), plus an implicit ground at y = 0.
// Provides ray casts (nearest hit and full pierce lists for bullet penetration),
// overlap queries and a capsule-ish character controller with step-up for stairs.
import * as THREE from 'three';

const EPS = 1e-4;

export class Physics {
  constructor(minX, minZ, maxX, maxZ, cell = 4) {
    this.minX = minX; this.minZ = minZ; this.maxX = maxX; this.maxZ = maxZ;
    this.cell = cell;
    this.nx = Math.ceil((maxX - minX) / cell);
    this.nz = Math.ceil((maxZ - minZ) / cell);
    this.cells = Array.from({ length: this.nx * this.nz }, () => []);
    this.boxes = [];
    this.stamp = new Uint32Array(0);
    this.stampId = 1;
    this.gravity = 22;
  }

  // mat: key into MATERIALS. flags: { nav: false } excludes a box from cover/nav probing etc.
  add(x0, y0, z0, x1, y1, z1, mat = 'concrete', flags = {}) {
    const b = {
      id: this.boxes.length,
      min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
      max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
      mat, flags,
    };
    this.boxes.push(b);
    const cx0 = this.cx(b.min[0]), cx1 = this.cx(b.max[0]);
    const cz0 = this.cz(b.min[2]), cz1 = this.cz(b.max[2]);
    for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) this.cells[z * this.nx + x].push(b);
    return b;
  }

  cx(x) { return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cell))); }
  cz(z) { return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.minZ) / this.cell))); }

  nextStamp() {
    if (this.stamp.length < this.boxes.length) this.stamp = new Uint32Array(this.boxes.length + 256);
    this.stampId++;
    if (this.stampId > 0xfffffff0) { this.stamp.fill(0); this.stampId = 1; }
    return this.stampId;
  }

  // Boxes overlapping an AABB.
  overlap(x0, y0, z0, x1, y1, z1, out = []) {
    out.length = 0;
    const s = this.nextStamp();
    const cx0 = this.cx(x0), cx1 = this.cx(x1), cz0 = this.cz(z0), cz1 = this.cz(z1);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells[cz * this.nx + cx];
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (this.stamp[b.id] === s) continue;
          this.stamp[b.id] = s;
          if (b.max[0] > x0 && b.min[0] < x1 && b.max[1] > y0 && b.min[1] < y1 && b.max[2] > z0 && b.min[2] < z1) out.push(b);
        }
      }
    }
    return out;
  }

  // Highest walkable surface under (x, z) within a square of half-size r, not above maxY.
  groundHeight(x, z, r, maxY) {
    let best = 0;
    const list = this.overlap(x - r, -1, z - r, x + r, maxY + EPS, z + r, this._tmp || (this._tmp = []));
    for (const b of list) if (b.max[1] <= maxY + 1e-3 && b.max[1] > best) best = b.max[1];
    return best;
  }

  // Walks the grid cells along a ray (2D DDA) and calls fn(box) once per box.
  // fn returns false to stop early. tLimit is updated by the caller through `state.t`.
  traverse(o, d, maxT, fn) {
    const s = this.nextStamp();
    const cell = this.cell;
    let cx = Math.floor((o.x - this.minX) / cell), cz = Math.floor((o.z - this.minZ) / cell);
    const stepX = d.x > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
    const tDX = Math.abs(d.x) > 1e-9 ? cell / Math.abs(d.x) : Infinity;
    const tDZ = Math.abs(d.z) > 1e-9 ? cell / Math.abs(d.z) : Infinity;
    let tMX = Math.abs(d.x) > 1e-9 ? ((cx + (stepX > 0 ? 1 : 0)) * cell + this.minX - o.x) / d.x : Infinity;
    let tMZ = Math.abs(d.z) > 1e-9 ? ((cz + (stepZ > 0 ? 1 : 0)) * cell + this.minZ - o.z) / d.z : Infinity;
    let t = 0;
    for (let guard = 0; guard < 512; guard++) {
      const exitT = Math.min(tMX, tMZ, maxT);
      if (cx >= 0 && cz >= 0 && cx < this.nx && cz < this.nz) {
        const list = this.cells[cz * this.nx + cx];
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (this.stamp[b.id] === s) continue;
          this.stamp[b.id] = s;
          if (fn(b, exitT) === false) return;
        }
      } else if ((cx < 0 && stepX < 0) || (cz < 0 && stepZ < 0) || (cx >= this.nx && stepX > 0) || (cz >= this.nz && stepZ > 0)) {
        return;
      }
      if (exitT >= maxT) return;
      if (tMX < tMZ) { t = tMX; tMX += tDX; cx += stepX; } else { t = tMZ; tMZ += tDZ; cz += stepZ; }
      if (t > maxT) return;
    }
  }

  // Nearest hit along a ray. Returns { t, point, normal, box, mat } or null.
  raycast(o, d, maxT, filter) {
    let best = null;
    let bestT = maxT;
    let bestAxis = 0, bestSign = 1;
    this.traverse(o, d, maxT, (b, exitT) => {
      if (filter && !filter(b)) return true;
      const r = slab(o, d, b);
      if (r && r.tIn >= 0 && r.tIn < bestT) { bestT = r.tIn; best = b; bestAxis = r.axis; bestSign = r.sign; }
      if (best && bestT <= exitT) return false;
      return true;
    });
    // Ground plane
    if (d.y < -1e-6) {
      const tg = -o.y / d.y;
      if (tg >= 0 && tg < bestT) {
        return { t: tg, point: new THREE.Vector3(o.x + d.x * tg, 0, o.z + d.z * tg), normal: new THREE.Vector3(0, 1, 0), box: null, mat: 'ground' };
      }
    }
    if (!best) return null;
    const normal = new THREE.Vector3();
    normal.setComponent(bestAxis, bestSign);
    return { t: bestT, point: new THREE.Vector3(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT), normal, box: best, mat: best.mat };
  }

  // True if nothing blocks the segment a -> b.
  clear(a, b, filter) {
    const d = _v1.subVectors(b, a);
    const len = d.length();
    if (len < 1e-6) return true;
    d.multiplyScalar(1 / len);
    return !this.raycast(a, d, len - 0.02, filter);
  }

  // Every box the ray passes through, sorted by entry: [{ tIn, tOut, normal, box }].
  pierce(o, d, maxT) {
    const hits = [];
    this.traverse(o, d, maxT, (b) => {
      const r = slab(o, d, b);
      if (r && r.tOut > 0 && r.tIn < maxT) {
        const n = new THREE.Vector3();
        n.setComponent(r.axis, r.sign);
        hits.push({ tIn: Math.max(0, r.tIn), tOut: Math.min(maxT, r.tOut), normal: n, box: b, mat: b.mat });
      }
      return true;
    });
    if (d.y < -1e-6) {
      const tg = -o.y / d.y;
      if (tg >= 0 && tg < maxT) hits.push({ tIn: tg, tOut: tg + 99, normal: new THREE.Vector3(0, 1, 0), box: null, mat: 'ground' });
    }
    hits.sort((a, b) => a.tIn - b.tIn);
    return hits;
  }

  boxFree(x0, y0, z0, x1, y1, z1) {
    return this.overlap(x0, y0, z0, x1, y1, z1, this._tmp2 || (this._tmp2 = [])).length === 0;
  }

  // Character controller. body: { p (feet), v, r, h, step, grounded, onLand(fallSpeed) }
  move(body, dt) {
    const p = body.p, v = body.v;
    const speed = Math.hypot(v.x, v.z);
    const n = Math.max(1, Math.min(6, Math.ceil((speed * dt) / (body.r * 0.7))));
    const sdt = dt / n;
    for (let i = 0; i < n; i++) {
      p.x += v.x * sdt;
      this.resolve(body, 0);
      p.z += v.z * sdt;
      this.resolve(body, 2);
    }
    // Vertical
    if (!body.noGravity) v.y -= this.gravity * dt;
    const wasGrounded = body.grounded;
    p.y += v.y * dt;
    if (v.y > 0) {
      const hits = this.overlap(p.x - body.r, p.y + body.h - 0.15, p.z - body.r, p.x + body.r, p.y + body.h, p.z + body.r, this._tmp3 || (this._tmp3 = []));
      for (const b of hits) {
        if (b.min[1] > p.y + 0.3) { p.y = b.min[1] - body.h; v.y = 0; break; }
      }
    }
    const probe = wasGrounded ? body.step : 0.02;
    const g = this.groundHeight(p.x, p.z, body.r * 0.85, p.y + probe + Math.max(0, -v.y * dt));
    if (v.y <= 0 && (p.y <= g || (wasGrounded && p.y - g < 0.45))) {
      if (!wasGrounded && body.onLand) body.onLand(-v.y);
      p.y = g;
      v.y = 0;
      body.grounded = true;
    } else {
      body.grounded = false;
    }
  }

  resolve(body, axis) {
    const p = body.p;
    const r = body.r;
    const hits = this.overlap(p.x - r, p.y + 0.03, p.z - r, p.x + r, p.y + body.h, p.z + r, this._tmp4 || (this._tmp4 = []));
    for (const b of hits) {
      // Recheck: an earlier push may already have resolved this one.
      if (!(b.max[0] > p.x - r && b.min[0] < p.x + r && b.max[1] > p.y + 0.03 && b.min[1] < p.y + body.h && b.max[2] > p.z - r && b.min[2] < p.z + r)) continue;
      const rise = b.max[1] - p.y;
      if (rise <= body.step && body.grounded !== false &&
          this.boxFree(p.x - r * 0.9, b.max[1] + 0.02, p.z - r * 0.9, p.x + r * 0.9, b.max[1] + body.h, p.z + r * 0.9)) {
        p.y = b.max[1];
        continue;
      }
      const c = axis === 0 ? p.x : p.z;
      const mid = (b.min[axis] + b.max[axis]) / 2;
      const other = axis === 0 ? 2 : 0;
      const po = axis === 0 ? p.z : p.x;
      // If we're mostly overlapping on the other axis, push along that instead (corner case).
      const penA = c < mid ? c + r - b.min[axis] : b.max[axis] - (c - r);
      const penO = po < (b.min[other] + b.max[other]) / 2 ? po + r - b.min[other] : b.max[other] - (po - r);
      if (penO < penA * 0.5) {
        const val = po < (b.min[other] + b.max[other]) / 2 ? b.min[other] - r - EPS : b.max[other] + r + EPS;
        if (other === 0) p.x = val; else p.z = val;
        continue;
      }
      const val = c < mid ? b.min[axis] - r - EPS : b.max[axis] + r + EPS;
      if (axis === 0) p.x = val; else p.z = val;
    }
  }
}

const _v1 = new THREE.Vector3();

// Ray / AABB slab test. Returns { tIn, tOut, axis, sign } or null.
export function slab(o, d, b) {
  let tIn = -Infinity, tOut = Infinity, axis = 0, sign = 1;
  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
    const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
    if (Math.abs(da) < 1e-12) {
      if (oa < b.min[a] || oa > b.max[a]) return null;
      continue;
    }
    let t1 = (b.min[a] - oa) / da, t2 = (b.max[a] - oa) / da;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tIn) { tIn = t1; axis = a; sign = s; }
    if (t2 < tOut) tOut = t2;
    if (tIn > tOut) return null;
  }
  if (tOut < 0) return null;
  return { tIn, tOut, axis, sign };
}
