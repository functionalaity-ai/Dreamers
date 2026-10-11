// Streets for the big map: asphalt carriageways with raised sidewalks and stone kerbs (both cut
// back where another street crosses), dashed centre lines and lamp posts. Every street is also a
// rectangle on the map screen.
import * as P from '../props.js';

const WALK_H = 0.13, KERB = 0.24;

export class Streets {
  constructor(B) { this.B = B; this.list = []; }

  // An axis-aligned carriageway; walk: sidewalk width each side (0 for none).
  add(x0, z0, x1, z1, opts = {}) {
    this.list.push({ x0, z0, x1, z1, walk: opts.walk ?? 2, paint: opts.paint !== false, mat: opts.mat || 'asphalt', lamps: opts.lamps !== false && (opts.walk ?? 2) > 0, name: opts.name });
  }

  // skip: rectangles to keep sidewalks and paint out of (Old Town's own streets).
  build(skip = []) {
    const B = this.B;
    const cutters = this.list.map((r) => ({ x0: r.x0 - r.walk, x1: r.x1 + r.walk, z0: r.z0 - r.walk, z1: r.z1 + r.walk })).concat(skip);
    const free = (a0, a1, c0, c1, alongX, self) => {
      let iv = [[a0, a1]];
      cutters.forEach((c, i) => {
        if (i === self) return;
        const cc0 = alongX ? c.z0 : c.x0, cc1 = alongX ? c.z1 : c.x1;
        if (cc1 <= c0 || cc0 >= c1) return;
        const b0 = alongX ? c.x0 : c.z0, b1 = alongX ? c.x1 : c.z1;
        const out = [];
        for (const [p, q] of iv) {
          if (b1 <= p || b0 >= q) { out.push([p, q]); continue; }
          if (b0 > p) out.push([p, b0]);
          if (b1 < q) out.push([b1, q]);
        }
        iv = out;
      });
      return iv.filter(([p, q]) => q - p > 0.3);
    };
    this.list.forEach((r, i) => {
      B.solid(r.x0, -0.05, r.z0, r.x1, 0.0, r.z1, r.mat, null, { shadow: false });
      const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
      const a0 = alongX ? r.x0 : r.z0, a1 = alongX ? r.x1 : r.z1;
      const c0 = alongX ? r.z0 : r.x0, c1 = alongX ? r.z1 : r.x1;
      if (r.walk > 0) {
        for (const side of [-1, 1]) {
          const e = side < 0 ? c0 : c1;                 // the road edge
          const w0 = side < 0 ? e - r.walk : e, w1 = side < 0 ? e : e + r.walk;
          for (const [p, q] of free(a0, a1, w0, w1, alongX, i)) {
            const k0 = side < 0 ? e - KERB : e, k1 = side < 0 ? e : e + KERB;
            const s0 = side < 0 ? w0 : k1, s1 = side < 0 ? k0 : w1;
            if (alongX) {
              B.solid(p, 0, s0, q, WALK_H, s1, 'sidewalk', null, { shadow: false });
              B.solid(p, -0.04, k0, q, WALK_H + 0.01, k1, 'limestone', null);
              B.collider(p, 0, w0, q, WALK_H, w1, 'concrete');
            } else {
              B.solid(s0, 0, p, s1, WALK_H, q, 'sidewalk', null, { shadow: false });
              B.solid(k0, -0.04, p, k1, WALK_H + 0.01, q, 'limestone', null);
              B.collider(w0, 0, p, w1, WALK_H, q, 'concrete');
            }
            if (r.lamps && side > 0) {
              for (let a = p + 6; a < q - 3; a += 26) {
                if (alongX) P.lampPost(B, a, w1 - 0.4); else P.lampPost(B, w1 - 0.4, a);
              }
            }
          }
        }
      }
      if (r.paint && c1 - c0 > 5.5) {
        const mid = (c0 + c1) / 2;
        for (const [p, q] of free(a0, a1, mid - 0.1, mid + 0.1, alongX, i)) {
          for (let a = p + 1; a < q - 2.4; a += 4.5) {
            if (alongX) B.solid(a, 0.0, mid - 0.075, a + 2.4, 0.012, mid + 0.075, 'roadPaint', null, { shadow: false });
            else B.solid(mid - 0.075, 0.0, a, mid + 0.075, 0.012, a + 2.4, 'roadPaint', null, { shadow: false });
          }
        }
      }
    });
  }

  rects() { return this.list.map((r) => ({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 })); }
}
