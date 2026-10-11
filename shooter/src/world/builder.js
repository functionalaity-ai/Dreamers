// World builder: every solid() call adds a textured, merged box and a collider.
import * as THREE from 'three';
import { worldBox, Batcher } from '../core/geometry.js';
import { faceMatrix } from './facades.js';

export class Builder {
  constructor(physics, materials) {
    this.ph = physics;
    this.M = materials.world;
    this.batch = new Batcher();
    this.noShadow = new Batcher();
    this.hints = [];          // extra nav nodes: doorways, stairs
    this.indoor = [];         // AABBs counted as "inside a building" (darker, enclosed audio)
    this.lights = [];         // interior point-light positions
    this.signs = [];
    this.spawns = { msg: [], volk: [] };
    this.points = [];         // strategic points for bots
  }

  mat(key) {
    const m = typeof key === 'string' ? this.M[key] : key;
    if (!m) throw new Error('Unknown material ' + key);
    return m;
  }

  // Visible box + collider. phys: material name for bullets, or null for no collider.
  solid(x0, y0, z0, x1, y1, z1, mat, phys = 'concrete', opts = {}) {
    if (Math.abs(x1 - x0) < 1e-4 || Math.abs(y1 - y0) < 1e-4 || Math.abs(z1 - z0) < 1e-4) return;
    (opts.shadow === false ? this.noShadow : this.batch).add(this.mat(mat), worldBox(x0, y0, z0, x1, y1, z1));
    if (phys) this.ph.add(x0, y0, z0, x1, y1, z1, phys, opts.flags || {});
  }

  // Visible-only geometry (already positioned).
  geo(mat, g, shadow = true) { (shadow ? this.batch : this.noShadow).add(this.mat(mat), g); }

  collider(x0, y0, z0, x1, y1, z1, phys = 'concrete', flags = {}) { this.ph.add(x0, y0, z0, x1, y1, z1, phys, flags); }

  hint(x, y, z) { this.hints.push(new THREE.Vector3(x, y, z)); }

  // Wall along X (constant z band z0..z1) or Z (constant x band), with rectangular openings.
  // openings: [{ c: centre along the wall, w, y0, y1 }]
  wall(axis, a0, a1, t0, t1, y0, y1, openings, mat, phys) {
    const ops = openings.slice().sort((p, q) => p.c - q.c);
    let cur = a0;
    const put = (b0, b1, yy0, yy1) => {
      if (b1 - b0 < 0.01 || yy1 - yy0 < 0.01) return;
      if (axis === 'x') this.solid(b0, yy0, t0, b1, yy1, t1, mat, phys);
      else this.solid(t0, yy0, b0, t1, yy1, b1, mat, phys);
    };
    for (const o of ops) {
      const s = Math.max(a0, o.c - o.w / 2), e = Math.min(a1, o.c + o.w / 2);
      put(cur, s, y0, y1);
      put(s, e, y0, Math.max(y0, o.y0));
      put(s, e, Math.min(y1, o.y1), y1);
      cur = e;
    }
    put(cur, a1, y0, y1);
  }

  build(scene) {
    const group = new THREE.Group();
    group.name = 'world';
    this.batch.build(group, { cast: true, receive: true });
    this.noShadow.build(group, { cast: false, receive: true });
    scene.add(group);
    return group;
  }
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------
// spec: {
//   x0, z0, x1, z1, floors, H, wallT, mats: [groundMat, upperMat], base, trim,
//   doors: [{ side: 'n'|'s'|'e'|'w', c, w, h }],      (ground floor)
//   windowSpacing, skipWindows: { side: [centres...] },
//   stair: { x, z, toRoof },                           (stairwell's min corner)
//   inner: [{ axis: 'x'|'z', at, from, to, floors: [..], doors: [centres] }],
//   roof: 'flat' | 'parapet', furnish(B, floor, y)
//   breach(side, floor) → [{ c, w, y0, y1 }]           (optional: blown-out wall sections, no trim)
//   holes(floor) → [{ x0, z0, x1, z1 }]                (optional: collapsed parts of the slab above)
//   openTop: true                                      (optional: the top slab is an exposed floor
//                                                       reached by the stairs; no parapet, no bulkhead)
// }
export function building(B, s) {
  const H = s.H || 3.4, t = s.wallT || 0.3, slab = 0.22;
  const floors = s.floors;
  const top = floors * H;
  const mats = s.mats || ['plasterCream', 'plasterCream'];
  B.indoor.push({ min: [s.x0, 0, s.z0], max: [s.x1, top, s.z1] });

  // Stairwell footprint (two 1.2 m flights side by side, landing at the far end).
  const STEP_RISE = H / 20, STEP_RUN = 0.28;
  const st = s.stair;
  const sw = { x0: st.x, x1: st.x + 2.5, z0: st.z, z1: st.z + 9 * STEP_RUN + 1.2 };

  for (let f = 0; f < floors; f++) {
    const y0 = f * H, y1 = (f + 1) * H;
    const mat = f === 0 ? mats[0] : mats[1];
    const winY0 = y0 + 0.95, winY1 = y0 + 2.45;
    const ops = { n: [], s: [], e: [], w: [] };
    if (f === 0) for (const d of s.doors || []) ops[d.side].push({ c: d.c, w: d.w || 1.3, y0: y0 - 1, y1: y0 + (d.h || 2.3), door: true });
    if (s.breach) for (const side of ['n', 's', 'e', 'w']) for (const b of s.breach(side, f) || []) ops[side].push({ c: b.c, w: b.w, y0: y0 + (b.y0 || 0) - (f === 0 && !b.y0 ? 1 : 0), y1: y0 + (b.y1 || H), breach: true });
    const spacing = s.windowSpacing || 2.8;
    const addWindows = (side, a0, a1) => {
      const n = Math.max(1, Math.floor((a1 - a0 - 1) / spacing));
      const span = (a1 - a0) / n;
      for (let i = 0; i < n; i++) {
        const c = a0 + span * (i + 0.5);
        const skip = (s.skipWindows && s.skipWindows[side] || []).some((v) => Math.abs(v - c) < span / 2);
        if (skip && f === 0) continue;
        if (ops[side].some((o) => Math.abs(o.c - c) < (o.w + 1.3) / 2 + 0.3)) continue;
        ops[side].push({ c, w: 1.25, y0: winY0, y1: winY1, window: true });
      }
    };
    addWindows('n', s.x0, s.x1); addWindows('s', s.x0, s.x1);
    addWindows('w', s.z0, s.z1); addWindows('e', s.z0, s.z1);
    // Exterior walls (corners owned by the n/s walls).
    B.wall('x', s.x0, s.x1, s.z0, s.z0 + t, y0, y1, ops.n, mat, 'brick');
    B.wall('x', s.x0, s.x1, s.z1 - t, s.z1, y0, y1, ops.s, mat, 'brick');
    B.wall('z', s.z0 + t, s.z1 - t, s.x0, s.x0 + t, y0, y1, ops.w, mat, 'brick');
    B.wall('z', s.z0 + t, s.z1 - t, s.x1 - t, s.x1, y0, y1, ops.e, mat, 'brick');
    // Window and door trim on the outside faces, plus nav hints at doors.
    for (const side of ['n', 's', 'e', 'w']) {
      for (const o of ops[side]) {
        if (o.breach) continue;
        trimOpening(B, s, side, o, t, s.trim || 'trim');
        if (o.window && B.kit) {
          const f = side === 'n' ? { axis: 'x', p: s.z0, out: -1 } : side === 's' ? { axis: 'x', p: s.z1, out: 1 } : side === 'w' ? { axis: 'z', p: s.x0, out: -1 } : { axis: 'z', p: s.x1, out: 1 };
          B.kit.add('open', faceMatrix(f, o.c, o.y0), 0, { shutters: 'auto' });
        }
        if (o.door) {
          const p = sidePoint(s, side, o.c, 0.9), q = sidePoint(s, side, o.c, -0.9);
          B.hint(p.x, y0, p.z); B.hint(q.x, y0, q.z);
        }
      }
    }
    // Floor slab above this storey (with the stairwell hole), or the roof.
    const roofLevel = f === floors - 1, up = st.toRoof || s.openTop;
    const hole = (!roofLevel || up) ? sw : null;
    const extra = s.holes ? s.holes(f) || [] : [];
    const slabMat = roofLevel && !s.openTop ? 'concrete' : (s.floorMat || 'woodFloor');
    if (extra.length) slabWithHoles(B, s.x0, s.z0, s.x1, s.z1, y1 - slab, y1, hole, extra, slabMat);
    else slabWithHole(B, s.x0, s.z0, s.x1, s.z1, y1 - slab, y1, hole, slabMat, 'concrete');
    // Interior floor finish on the ground storey
    if (f === 0) B.solid(s.x0 + t, 0, s.z0 + t, s.x1 - t, 0.02, s.z1 - t, s.groundFloorMat || 'woodFloor', null, { shadow: false });
    // Stairs up from this storey
    if (!roofLevel || up) stairs(B, sw, y0, H, STEP_RISE, STEP_RUN);
    // Interior walls (drywall: bullets go through)
    for (const w of s.inner || []) {
      if (w.floors && w.floors.indexOf(f) === -1) continue;
      const dops = (w.doors || []).map((c) => ({ c, w: 1.0, y0: y0 - 1, y1: y0 + 2.15 }));
      if (w.axis === 'x') B.wall('x', w.from, w.to, w.at - 0.06, w.at + 0.06, y0, y1 - slab, dops, s.innerMat || 'plasterWhite', 'plaster');
      else B.wall('z', w.from, w.to, w.at - 0.06, w.at + 0.06, y0, y1 - slab, dops, s.innerMat || 'plasterWhite', 'plaster');
      for (const c of w.doors || []) {
        if (w.axis === 'x') { B.hint(c, y0, w.at - 0.7); B.hint(c, y0, w.at + 0.7); } else { B.hint(w.at - 0.7, y0, c); B.hint(w.at + 0.7, y0, c); }
      }
    }
    if (s.furnish) s.furnish(B, f, y0);
    B.lights.push(new THREE.Vector3((s.x0 + s.x1) / 2, y0 + H - 0.5, (s.z0 + s.z1) / 2));
  }
  // Stone plinth and cornice
  const base = s.base || 'concrete';
  B.solid(s.x0 - 0.06, 0, s.z0 - 0.06, s.x1 + 0.06, 0.55, s.z0 + 0.02, base, null);
  B.solid(s.x0 - 0.06, 0, s.z1 - 0.02, s.x1 + 0.06, 0.55, s.z1 + 0.06, base, null);
  B.solid(s.x0 - 0.06, 0, s.z0, s.x0 + 0.02, 0.55, s.z1, base, null);
  B.solid(s.x1 - 0.02, 0, s.z0, s.x1 + 0.06, 0.55, s.z1, base, null);
  for (let f = 1; f <= floors; f++) {
    const y = f * H;
    const thick = f === floors ? 0.35 : 0.14;
    B.solid(s.x0 - 0.18, y - thick, s.z0 - 0.18, s.x1 + 0.18, y, s.z0 + 0.02, s.trim || 'trim', null);
    B.solid(s.x0 - 0.18, y - thick, s.z1 - 0.02, s.x1 + 0.18, y, s.z1 + 0.18, s.trim || 'trim', null);
    B.solid(s.x0 - 0.18, y - thick, s.z0, s.x0 + 0.02, y, s.z1, s.trim || 'trim', null);
    B.solid(s.x1 - 0.02, y - thick, s.z0, s.x1 + 0.18, y, s.z1, s.trim || 'trim', null);
  }
  // Roof parapet (waist-high cover) when the roof is reachable
  if (st.toRoof && !s.openTop) {
    const p = 1.05, pt = 0.25;
    B.solid(s.x0, top, s.z0, s.x1, top + p, s.z0 + pt, mats[1], 'brick');
    B.solid(s.x0, top, s.z1 - pt, s.x1, top + p, s.z1, mats[1], 'brick');
    B.solid(s.x0, top, s.z0 + pt, s.x0 + pt, top + p, s.z1 - pt, mats[1], 'brick');
    B.solid(s.x1 - pt, top, s.z0 + pt, s.x1, top + p, s.z1 - pt, mats[1], 'brick');
    // Stair bulkhead: three walls and a roof around the stairwell, open towards -z.
    const bh = 2.6;
    B.solid(sw.x0 - 0.15, top, sw.z1, sw.x1 + 0.15, top + bh, sw.z1 + 0.15, 'concrete', 'concrete');
    B.solid(sw.x0 - 0.15, top, sw.z0 - 0.15, sw.x0, top + bh, sw.z1, 'concrete', 'concrete');
    B.solid(sw.x1, top, sw.z0 + 1.4, sw.x1 + 0.15, top + bh, sw.z1, 'concrete', 'concrete');
    B.solid(sw.x0 - 0.15, top + bh, sw.z0 - 0.15, sw.x1 + 0.15, top + bh + 0.15, sw.z1 + 0.15, 'concrete', 'concrete');
    B.hint(sw.x1 - 0.6, top, sw.z0 - 0.7);
  }
  return sw;
}

function sidePoint(s, side, c, out) {
  if (side === 'n') return { x: c, z: s.z0 - out };
  if (side === 's') return { x: c, z: s.z1 + out };
  if (side === 'w') return { x: s.x0 - out, z: c };
  return { x: s.x1 + out, z: c };
}

function trimOpening(B, s, side, o, t, trim) {
  const fw = 0.08, depth = 0.06;
  const y0 = Math.max(0, o.y0), y1 = o.y1;
  const a0 = o.c - o.w / 2, a1 = o.c + o.w / 2;
  const put = (aa0, aa1, yy0, yy1, out) => {
    const d0 = -depth - (out || 0), d1 = 0.01;
    if (side === 'n') B.solid(aa0, yy0, s.z0 + d0, aa1, yy1, s.z0 + d1, trim, null, { shadow: true });
    else if (side === 's') B.solid(aa0, yy0, s.z1 - d1, aa1, yy1, s.z1 - d0, trim, null);
    else if (side === 'w') B.solid(s.x0 + d0, yy0, aa0, s.x0 + d1, yy1, aa1, trim, null);
    else B.solid(s.x1 - d1, yy0, aa0, s.x1 - d0, yy1, aa1, trim, null);
  };
  put(a0 - fw, a0, y0, y1 + fw);
  put(a1, a1 + fw, y0, y1 + fw);
  put(a0 - fw, a1 + fw, y1, y1 + fw);
  if (o.window) put(a0 - 0.14, a1 + 0.14, y0 - 0.07, y0, 0.06);
}

function slabWithHole(B, x0, z0, x1, z1, y0, y1, hole, mat, phys) {
  if (!hole) { B.solid(x0, y0, z0, x1, y1, z1, mat, phys); return; }
  B.solid(x0, y0, z0, x1, y1, hole.z0, mat, phys);
  B.solid(x0, y0, hole.z1, x1, y1, z1, mat, phys);
  B.solid(x0, y0, hole.z0, hole.x0, y1, hole.z1, mat, phys);
  B.solid(hole.x1, y0, hole.z0, x1, y1, hole.z1, mat, phys);
  // Railing on the upper side of the hole (except where the stairs arrive and leave).
  B.solid(hole.x0 + 1.2, y1, hole.z1 - 0.05, hole.x1, y1 + 1.0, hole.z1, 'darkMetal', 'metal');
  // Between the flights only: the landing below needs full headroom.
  B.solid(hole.x0 + 1.2, y1, hole.z0 + 0.3, hole.x0 + 1.3, y1 + 1.0, hole.z1 - 1.25, 'darkMetal', 'metal');
}

// A slab with the stairwell hole (and its railing) plus other holes: the slab is cut into strips
// between every hole edge, and the strips clear of all holes are laid (merged along x).
function slabWithHoles(B, x0, z0, x1, z1, y0, y1, stair, holes, mat) {
  const all = (stair ? [stair] : []).concat(holes).map((h) => ({ x0: Math.max(x0, h.x0), x1: Math.min(x1, h.x1), z0: Math.max(z0, h.z0), z1: Math.min(z1, h.z1) })).filter((h) => h.x1 > h.x0 && h.z1 > h.z0);
  const xs = [...new Set([x0, x1, ...all.flatMap((h) => [h.x0, h.x1])])].sort((a, b) => a - b);
  const zs = [...new Set([z0, z1, ...all.flatMap((h) => [h.z0, h.z1])])].sort((a, b) => a - b);
  for (let j = 0; j < zs.length - 1; j++) {
    let run = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      const open = all.some((h) => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1);
      if (!open && run === null) run = xs[i];
      if ((open || i === xs.length - 2) && run !== null) {
        B.solid(run, y0, zs[j], open ? xs[i] : xs[i + 1], y1, zs[j + 1], mat, 'concrete');
        run = null;
      }
    }
  }
  if (stair) {
    B.solid(stair.x0 + 1.2, y1, stair.z1 - 0.05, stair.x1, y1 + 1.0, stair.z1, 'darkMetal', 'metal');
    B.solid(stair.x0 + 1.2, y1, stair.z0 + 0.3, stair.x0 + 1.3, y1 + 1.0, stair.z1 - 1.25, 'darkMetal', 'metal');
  }
}

// U-shaped stairs: flight A climbs +z on the x0 side, landing, flight B climbs -z on the x1 side.
function stairs(B, sw, y0, H, rise, run) {
  const thick = 0.32;
  for (let i = 1; i <= 9; i++) {
    const top = y0 + i * rise;
    const za = sw.z0 + (i - 1) * run;
    B.solid(sw.x0, top - thick, za, sw.x0 + 1.2, top, za + run, 'concrete', 'concrete');
  }
  const landTop = y0 + 10 * rise;
  B.solid(sw.x0, landTop - 0.25, sw.z0 + 9 * run, sw.x1, landTop, sw.z1, 'concrete', 'concrete');
  for (let i = 1; i <= 9; i++) {
    const top = landTop + i * rise;
    const zb = sw.z0 + 9 * run - i * run;
    B.solid(sw.x1 - 1.2, top - thick, zb, sw.x1, top, zb + run, 'concrete', 'concrete');
  }
  // Nav hints: foot of the stairs, every other step of both flights, the landing, arrival.
  B.hint(sw.x0 + 0.6, y0, sw.z0 - 0.6);
  for (let i = 1; i <= 9; i += 2) {
    B.hint(sw.x0 + 0.6, y0 + i * rise, sw.z0 + (i - 0.5) * run);
    B.hint(sw.x1 - 0.6, landTop + i * rise, sw.z0 + 9 * run - (i - 0.5) * run);
  }
  B.hint(sw.x0 + 0.6, landTop, sw.z1 - 0.6);
  B.hint(sw.x1 - 0.6, landTop, sw.z1 - 0.6);
  B.hint(sw.x1 - 0.6, y0 + H, sw.z0 - 0.6);
}
