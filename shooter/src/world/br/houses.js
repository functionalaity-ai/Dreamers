// Lootable buildings for the big map: enterable houses, flats, shops, offices, a school and a
// clinic built with the town's building() (stairs, floors, drywall rooms, open windows with green
// shutters), planned into rooms, furnished, stocked with loot containers, and, for about a third
// of them, bombed: the top storey gone to jagged walls over an exposed floor, wall sections and
// corners blown out, slabs fallen in, rubble heaped inside and out, soot over the openings.
// Every building also leaves a cheap proxy (shell, roof, window quads) for the far view.
import * as THREE from 'three';
import { building } from '../builder.js';
import { tileRoof } from '../ornament.js';
import { faceMatrix } from '../facades.js';
import * as P from '../props.js';
import { SIZES } from './containers.js';

const T = 0.3;            // building() wall thickness
const STAIR_D = 9 * 0.28 + 1.2;

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

// Window centres building() puts along a wall (same rule), for keeping tall furniture off them.
function windowCentres(a0, a1, spacing) {
  const n = Math.max(1, Math.floor((a1 - a0 - 1) / spacing)), span = (a1 - a0) / n, out = [];
  for (let i = 0; i < n; i++) out.push(a0 + span * (i + 0.5));
  return out;
}

// --- rubble ---------------------------------------------------------------------------------------
// A heap of broken masonry: terraced colliders (each step within stepping height, so you can
// climb it) under a scatter of chunks, slabs of render and a broken joist or two.
export function rubbleHeap(B, x, z, w, d, h, y = 0, rnd = Math.random, mats = ['concrete', 'brick', 'plasterCream']) {
  const steps = Math.max(1, Math.round(h / 0.38));
  for (let i = 0; i < steps; i++) {
    const k = 1 - i / steps, hw = w / 2 * (0.35 + 0.65 * k), hd = d / 2 * (0.35 + 0.65 * k);
    B.collider(x - hw, y, z - hd, x + hw, y + h * (i + 1) / steps, z + hd, 'concrete');
  }
  const n = Math.round(6 + w * d * 2.2);
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, v = rnd() * 2 - 1, r = Math.max(Math.abs(u), Math.abs(v));
    const top = h * (1 - r * r) * (0.75 + rnd() * 0.3);
    const s = (0.18 + rnd() * 0.4) * Math.min(1.4, 0.6 + h * 0.5);
    const g = new THREE.DodecahedronGeometry(s, 0);
    g.scale(1 + rnd() * 0.6, 0.45 + rnd() * 0.4, 1 + rnd() * 0.5);
    g.rotateY(rnd() * 6.28); g.rotateX((rnd() - 0.5) * 0.6);
    g.translate(x + u * w * 0.48, y + Math.max(0.05, top - s * 0.3), z + v * d * 0.48);
    B.geo(mats[Math.floor(rnd() * mats.length)], g);
  }
  // the heap's body: a squashed dome of broken stuff
  const dome = new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = dome.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + (rnd() - 0.5) * 0.25), p.getY(i) * (1 + (rnd() - 0.5) * 0.3), p.getZ(i) * (1 + (rnd() - 0.5) * 0.25));
  dome.scale(w * 0.52, h * 0.92, d * 0.52);
  dome.translate(x, y - 0.02, z);
  dome.computeVertexNormals();
  B.geo(mats[0] === 'concrete' ? 'soot' : mats[0], dome);
  for (let i = 0; i < Math.min(3, Math.round(w * d / 6)); i++) {
    const j = new THREE.BoxGeometry(Math.min(w, 2.6) * (0.6 + rnd() * 0.4), 0.14, 0.12);
    j.rotateZ((rnd() - 0.5) * 0.7); j.rotateY(rnd() * 6.28);
    j.translate(x + (rnd() - 0.5) * w * 0.4, y + h * (0.4 + rnd() * 0.5), z + (rnd() - 0.5) * d * 0.4);
    B.geo('woodDark', j);
  }
}

// Broken wall stubs standing on a floor along the footprint's edge: what is left of a storey.
function ruinStorey(B, s, y, H, mat, rnd, ctx) {
  const sides = [['n', s.x0, s.x1], ['s', s.x0, s.x1], ['w', s.z0 + T, s.z1 - T], ['e', s.z0 + T, s.z1 - T]];
  let hPrev = H * 0.6;
  for (const [side, a0, a1] of sides) {
    let a = a0;
    while (a < a1 - 0.05) {
      const len = Math.min(a1 - a, 0.6 + rnd() * 1.3);
      // a ragged skyline: heights wander, with the odd gap blown right through
      hPrev = Math.max(0.25, Math.min(H * 0.95, hPrev + (rnd() - 0.5) * 1.6));
      const gap = rnd() < 0.16;
      const h = gap ? 0.1 + rnd() * 0.35 : hPrev;
      if (side === 'n') B.solid(a, y, s.z0, a + len, y + h, s.z0 + T, mat, 'brick');
      else if (side === 's') B.solid(a, y, s.z1 - T, a + len, y + h, s.z1, mat, 'brick');
      else if (side === 'w') B.solid(s.x0, y, a, s.x0 + T, y + h, a + len, mat, 'brick');
      else B.solid(s.x1 - T, y, a, s.x1, y + h, a + len, mat, 'brick');
      if (!gap && h > 1.4 && rnd() < 0.35 && ctx.atlas) soot(ctx, s, side, a + len / 2, y + h * 0.55, Math.min(1.6, len), h * 0.8);
      a += len;
    }
  }
}

// A soot plume on a facade (from the road atlas), just off the wall.
function soot(ctx, s, side, a, y, w, h) {
  const f = side === 'n' ? { axis: 'x', p: s.z0, out: -1 } : side === 's' ? { axis: 'x', p: s.z1, out: 1 } : side === 'w' ? { axis: 'z', p: s.x0, out: -1 } : { axis: 'z', p: s.x1, out: 1 };
  const m = faceMatrix(f, a, y, 0.012);
  ctx.atlas.face('soot', m, w, h, 3, [0.85, 0.85, 0.85, 0.9]);
}

// --- plans ------------------------------------------------------------------------------------------
// Rooms of one storey: a stair strip at one end (stairs at the back, a hall in front of them) and
// the rest cut into up to four rooms by drywall partitions with doors.
function plan(s, rnd) {
  const west = s.stairEnd !== 'e';
  const swx0 = west ? s.x0 + T + 0.02 : s.x1 - T - 2.52;
  const sw = { x0: swx0, x1: swx0 + 2.5, z0: s.z1 - T - 0.02 - STAIR_D, z1: s.z1 - T - 0.02 };
  const xs = west ? sw.x1 + 0.12 : sw.x0 - 0.12;
  const main = west ? { x0: xs + 0.06, x1: s.x1 - T } : { x0: s.x0 + T, x1: xs - 0.06 };
  const hall = { x0: west ? s.x0 + T : xs + 0.06, x1: west ? xs - 0.06 : s.x1 - T, z0: s.z0 + T, z1: sw.z0 };
  const Wm = main.x1 - main.x0, Dm = s.z1 - s.z0 - 2 * T;
  const zIn0 = s.z0 + T, zIn1 = s.z1 - T;
  const splitZ = Dm >= 7.4 ? zIn0 + Dm * (0.46 + rnd() * 0.08) : null;
  const splitX = Wm >= 8.6 ? main.x0 + Wm * (0.44 + rnd() * 0.12) : null;
  const inner = [];
  // the stair strip's partition, with a door from the hall into the front rooms
  const hz1 = Math.min(hall.z1, splitZ !== null ? splitZ : hall.z1) - 0.7;
  const hallDoor = Math.max(hall.z0 + 0.7, Math.min(hz1, (hall.z0 + hz1) / 2));
  inner.push({ axis: 'z', at: xs, from: zIn0, to: zIn1, doors: [hallDoor] });
  const cols = splitX !== null ? [[main.x0, splitX - 0.06], [splitX + 0.06, main.x1]] : [[main.x0, main.x1]];
  const rows = splitZ !== null ? [[zIn0, splitZ - 0.06], [splitZ + 0.06, zIn1]] : [[zIn0, zIn1]];
  const doorsZ = [], doorsX = [];
  if (splitZ !== null) {
    for (const [c0, c1] of cols) doorsZ.push(Math.max(c0 + 0.7, Math.min(c1 - 0.7, c0 + 0.8 + rnd() * (c1 - c0 - 1.6))));
    inner.push({ axis: 'x', at: splitZ, from: main.x0, to: main.x1, doors: doorsZ });
  }
  if (splitX !== null) {
    for (const [r0, r1] of rows) doorsX.push(Math.max(r0 + 0.7, Math.min(r1 - 0.7, r0 + 0.8 + rnd() * (r1 - r0 - 1.6))));
    inner.push({ axis: 'z', at: splitX, from: zIn0, to: zIn1, doors: doorsX });
  }
  const rooms = [];
  for (const [c0, c1] of cols) for (const [r0, r1] of rows) rooms.push({ x0: c0, x1: c1, z0: r0, z1: r1 });
  // doors seen from each room (centre along the wall, width), by side
  for (const r of rooms) {
    r.doors = { n: [], s: [], e: [], w: [] };
    r.ext = { n: Math.abs(r.z0 - zIn0) < 0.01, s: Math.abs(r.z1 - zIn1) < 0.01, w: Math.abs(r.x0 - (s.x0 + T)) < 0.01, e: Math.abs(r.x1 - (s.x1 - T)) < 0.01 };
    if (splitZ !== null) for (const d of doorsZ) { if (d > r.x0 && d < r.x1) { if (Math.abs(r.z1 - (splitZ - 0.06)) < 0.01) r.doors.s.push(d); if (Math.abs(r.z0 - (splitZ + 0.06)) < 0.01) r.doors.n.push(d); } }
    if (splitX !== null) for (const d of doorsX) { if (d > r.z0 && d < r.z1) { if (Math.abs(r.x1 - (splitX - 0.06)) < 0.01) r.doors.e.push(d); if (Math.abs(r.x0 - (splitX + 0.06)) < 0.01) r.doors.w.push(d); } }
    if (hallDoor > r.z0 && hallDoor < r.z1) { if (west && Math.abs(r.x0 - main.x0) < 0.01) r.doors.w.push(hallDoor); if (!west && Math.abs(r.x1 - main.x1) < 0.01) r.doors.e.push(hallDoor); }
  }
  return { west, sw, stair: { x: sw.x0, z: sw.z0 }, xs, main, hall, inner, rooms, splitX, splitZ };
}

// Front door (and maybe a back door) on the ground floor; registered with the rooms they open into.
function exteriorDoors(s, pl, rnd) {
  const doors = [];
  const mid = pl.rooms[0];
  const side = s.front || 's';
  if (side === 'n' || side === 's') {
    // into a front room, clear of the stair strip
    const rs = pl.rooms.filter((r) => (side === 'n' ? r.ext.n : r.ext.s));
    const r = rs[Math.floor(rnd() * rs.length)] || mid;
    doors.push({ side, c: Math.max(r.x0 + 0.9, Math.min(r.x1 - 0.9, (r.x0 + r.x1) / 2 + (rnd() - 0.5) * 1.2)), w: s.style === 'shop' ? 1.8 : 1.3, h: 2.4 });
  } else {
    const intoHall = (side === 'w') === pl.west;
    if (intoHall) doors.push({ side, c: (pl.hall.z0 + Math.min(pl.hall.z1, pl.hall.z0 + 3)) / 2, w: 1.2, h: 2.3 });
    else {
      const rs = pl.rooms.filter((r) => (side === 'w' ? r.ext.w : r.ext.e));
      const r = rs[0] || mid;
      doors.push({ side, c: Math.max(r.z0 + 0.9, Math.min(r.z1 - 0.9, (r.z0 + r.z1) / 2)), w: 1.3, h: 2.4 });
    }
  }
  // a back door on the long side opposite (houses mostly)
  const back = { n: 's', s: 'n', e: 'w', w: 'e' }[side];
  if (rnd() < 0.55 && (back === 'n' || back === 's')) {
    const rs = pl.rooms.filter((r) => (back === 'n' ? r.ext.n : r.ext.s));
    const r = rs[rs.length - 1];
    if (r && r.x1 - r.x0 > 2.2) doors.push({ side: back, c: (r.x0 + r.x1) / 2 + (rnd() - 0.5) * 0.6, w: 1.1, h: 2.2 });
  }
  return doors;
}

// --- roles and contents -----------------------------------------------------------------------------
const ROLES = {
  house: (f, n) => (f === 0 ? ['kitchen', 'living', 'bath', 'living'] : ['bedroom', 'bedroom', 'bath', 'kitchen']).slice(0, n),
  flat: (f, n) => ['kitchen', 'bedroom', 'living', 'bath'].slice(0, n),
  shop: (f, n) => (f === 0 ? ['shop', 'store', 'shop', 'kitchen'] : ['kitchen', 'bedroom', 'bath', 'living']).slice(0, n),
  office: (f, n) => ['office', 'office', 'store', 'bath'].slice(0, n),
  school: (f, n) => ['classroom', 'office', 'classroom', 'store'].slice(0, n),
  clinic: (f, n) => ['ward', 'office', 'ward', 'store'].slice(0, n),
};
// containers wanted per room role (first ones first), and props
const STOCK = {
  kitchen: ['fridge', 'cabinet', 'cabinet'], living: ['dresser', 'desk'], bedroom: ['wardrobe', 'dresser'], bath: ['medcab'],
  shop: ['cabinet', 'crate'], store: ['crate', 'locker', 'crate'], office: ['desk', 'locker'], classroom: ['desk', 'locker'],
  ward: ['medcab', 'cabinet', 'locker'],
};
const TALL = new Set(['fridge', 'wardrobe', 'locker']);

function tierFor(ctx, kind, floor, destroyed, industrial) {
  let p1 = 0.22, p2 = 0.04;
  if (destroyed) { p1 += 0.08; p2 += 0.06; }
  if (floor >= 2) { p1 += 0.05; p2 += 0.03; }
  if (industrial) { p1 += 0.1; p2 += 0.08; }
  if (kind === 'crate') p2 += 0.05;
  if (kind === 'medcab') p1 += 0.15;
  const r = ctx.rnd();
  return r < p2 ? 2 : r < p2 + p1 ? 1 : 0;
}

// Tries to stand an item against one of the room's walls. size: { w (along the wall), d (out from
// it), tall }. Returns { side, a, x, z, yaw } (x, z: middle of the back, on the wall) or null.
function fitAgainstWall(room, size, rnd, s, y, opts = {}) {
  const sides = ['n', 's', 'e', 'w'].sort(() => rnd() - 0.5);
  for (const side of sides) {
    if (opts.inner && room.ext[side]) continue;
    const alongX = side === 'n' || side === 's';
    const a0 = (alongX ? room.x0 : room.z0) + 0.12, a1 = (alongX ? room.x1 : room.z1) - 0.12;
    if (a1 - a0 < size.w) continue;
    const blocked = room.doors[side].map((c) => [c - 0.5 - 0.25, c + 0.5 + 0.25]);
    if (room.ext[side] && (size.tall || opts.window)) {
      const spacing = s.windowSpacing || 2.8;
      const ws = alongX ? windowCentres(s.x0, s.x1, spacing) : windowCentres(s.z0, s.z1, spacing);
      for (const c of ws) blocked.push([c - 0.72, c + 0.72]);
    }
    if (room.ext[side] && room.extDoors) for (const d of room.extDoors.filter((e) => e.side === side)) blocked.push([d.c - d.w / 2 - 0.3, d.c + d.w / 2 + 0.3]);
    for (let k = 0; k < 6; k++) {
      const a = a0 + size.w / 2 + rnd() * (a1 - a0 - size.w);
      if (blocked.some(([b0, b1]) => a + size.w / 2 > b0 && a - size.w / 2 < b1)) continue;
      const inward = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[side];
      const wx = side === 'w' ? room.x0 : side === 'e' ? room.x1 : a, wz = side === 'n' ? room.z0 : side === 's' ? room.z1 : a;
      const depth = size.d + (opts.clear ?? 0.65);
      const fx0 = alongX ? a - size.w / 2 : Math.min(wx, wx + inward[0] * depth), fx1 = alongX ? a + size.w / 2 : Math.max(wx, wx + inward[0] * depth);
      const fz0 = alongX ? Math.min(wz, wz + inward[1] * depth) : a - size.w / 2, fz1 = alongX ? Math.max(wz, wz + inward[1] * depth) : a + size.w / 2;
      const rect = { x0: fx0, x1: fx1, z0: fz0, z1: fz1 };
      if (room.used.some((u) => overlaps(u, rect))) continue;
      room.used.push(rect);
      const yaw = { n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 }[side];
      return { side, a, x: wx + inward[0] * 0.012, z: wz + inward[1] * 0.012, yaw, inward, y };
    }
  }
  return null;
}

function furnishRoom(ctx, B, room, role, y, s, f) {
  const rnd = ctx.rnd;
  const rot = { e: 0, s: 1, w: 2, n: 3 };          // bed: headboard to the wall
  const rotBack = { s: 0, w: 1, n: 2, e: 3 };      // sofa, shelf: back to the wall
  const big = (room.x1 - room.x0) * (room.z1 - room.z0);
  const place = (w, d, inner) => fitAgainstWall(room, { w, d }, rnd, s, y, { clear: 0.3, inner });
  if (role === 'bedroom' && big > 7) {
    const p = place(1.5, 2.0); if (p) { P.bed(B, p.x + p.inward[0] * 1.0, p.z + p.inward[1] * 1.0, rot[p.side], y); }
  }
  if (role === 'living' && big > 8) {
    const p = place(2.0, 0.86); if (p) P.sofa(B, p.x + p.inward[0] * 0.43, p.z + p.inward[1] * 0.43, rotBack[p.side], y);
  }
  if ((role === 'store' || role === 'shop') && big > 6) {
    const p = place(2.0, 0.44, true); if (p) P.shelf(B, p.x + p.inward[0] * 0.22, p.z + p.inward[1] * 0.22, rotBack[p.side], y, 2.0);
  }
  if (role === 'shop' && f === 0 && big > 14) {
    const cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2, rect = { x0: cx - 1.6, x1: cx + 1.6, z0: cz - 0.5, z1: cz + 0.5 };
    if (!room.used.some((u) => overlaps(u, rect))) { room.used.push(rect); P.counter(B, cx, cz, 0, y, 2.6); }
  }
  if ((role === 'kitchen' || role === 'living' || role === 'classroom' || role === 'office') && big > 10) {
    const cx = (room.x0 + room.x1) / 2 + (rnd() - 0.5), cz = (room.z0 + room.z1) / 2 + (rnd() - 0.5);
    const rect = { x0: cx - 0.85, x1: cx + 0.85, z0: cz - 0.55, z1: cz + 0.55 };
    if (!room.used.some((u) => overlaps(u, rect))) { room.used.push(rect); P.table(B, cx, cz, 0, y, 1.3, 0.8); }
  }
}

function stockRoom(ctx, room, role, y, f, s, destroyed, budget) {
  const want = (STOCK[role] || ['crate']).slice();
  let n = 0;
  for (const kind of want) {
    if (budget.left <= 0) break;
    if (n >= 2 || (n >= 1 && ctx.rnd() < 0.35)) break;
    const S = SIZES[kind];
    const p = fitAgainstWall(room, { w: S.w + 0.06, d: kind === 'medcab' ? 0.3 : S.d, tall: TALL.has(kind) }, ctx.rnd, s, y, { inner: kind === 'medcab' || kind === 'fridge' || kind === 'wardrobe', clear: kind === 'medcab' ? 0.3 : 0.7 });
    if (!p) continue;
    const c = ctx.cs.add(kind, p.x, y, p.z, p.yaw, tierFor(ctx, kind, f, destroyed, s.style === 'industrial'));
    ctx.place(c, s);
    n++;
    budget.left--;
  }
  return n;
}

function lootSpots(ctx, room, y, k) {
  for (let i = 0; i < k; i++) {
    for (let tries = 0; tries < 6; tries++) {
      const x = room.x0 + 0.6 + ctx.rnd() * (room.x1 - room.x0 - 1.2), z = room.z0 + 0.6 + ctx.rnd() * (room.z1 - room.z0 - 1.2);
      const rect = { x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 };
      if (room.used.some((u) => overlaps(u, rect))) continue;
      room.used.push(rect);
      ctx.loot.push({ x, y: y + 0.02, z, tier: ctx.rnd() < 0.15 ? 2 : ctx.rnd() < 0.4 ? 1 : 0 });
      break;
    }
  }
}

// --- the building -----------------------------------------------------------------------------------
// s: { x0, z0, x1, z1, floors, H, front, style, mats: [ground, upper], roof: 'tile'|'flat',
//      destroyed: 0 | 1 | 2, stairEnd: 'w'|'e', seed, name, sign }
export function lootBuilding(ctx, s) {
  const B = ctx.B;
  const rnd = ctx.rnd = rng(s.seed || 1);
  const H = s.H || 3.2;
  const style = s.style || 'house';
  const destroyed = s.destroyed || 0;
  const pl = plan(s, rnd);
  const ext = exteriorDoors(s, pl, rnd);
  const intact = destroyed ? Math.max(1, s.floors - (destroyed === 2 && s.floors > 2 ? 2 : 1)) : s.floors;
  const mats = s.mats || ['plasterCream', 'plasterCream'];
  const upper = destroyed === 2 ? mats[1] + 'Burnt' : mats[1];
  B.own((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
  const lights = B.lights.length;
  // destruction: blown sections and a collapsed corner (away from the stairs), fallen-in slabs
  const breaches = { n: {}, s: {}, e: {}, w: {} };
  const holes = {};
  const heaps = [];
  if (destroyed) {
    const far = pl.west ? 'e' : 'w';
    const cornerZ = rnd() < 0.5 ? 'n' : 's';
    const nb = 1 + Math.floor(rnd() * 2) + (destroyed === 2 ? 1 : 0);
    for (let i = 0; i < nb; i++) {
      const side = ['n', 's', far][Math.floor(rnd() * 3)];
      const f = Math.floor(rnd() * intact);
      const alongX = side === 'n' || side === 's';
      const a0 = alongX ? pl.main.x0 + 1 : s.z0 + 1, a1 = alongX ? pl.main.x1 - 1 : s.z1 - 1;
      if (a1 - a0 < 2.5) continue;
      const w = 1.6 + rnd() * 2.0, c = a0 + w / 2 + rnd() * Math.max(0, a1 - a0 - w);
      if (f === 0 && ext.some((d) => d.side === side && Math.abs(d.c - c) < w / 2 + 1)) continue;
      (breaches[side][f] || (breaches[side][f] = [])).push({ c, w, y0: f === 0 ? 0 : 0.0, y1: H - 0.25 - rnd() * 0.6 });
      if (f === 0) heaps.push({ side, c, w });
    }
    if (destroyed === 2 || rnd() < 0.4) {
      // the far corner: both walls and every slab over it gone
      const cw = 2.6 + rnd() * 1.4, cd = 2.4 + rnd() * 1.2;
      const xc = far === 'e' ? s.x1 : s.x0, zc = cornerZ === 'n' ? s.z0 : s.z1;
      for (let f = 0; f < intact; f++) {
        (breaches[cornerZ][f] || (breaches[cornerZ][f] = [])).push({ c: far === 'e' ? xc - cw / 2 + 0.2 : xc + cw / 2 - 0.2, w: cw + 0.4, y0: 0, y1: H });
        (breaches[far][f] || (breaches[far][f] = [])).push({ c: cornerZ === 'n' ? zc + cd / 2 - 0.2 : zc - cd / 2 + 0.2, w: cd + 0.4, y0: 0, y1: H });
        (holes[f] || (holes[f] = [])).push({ x0: far === 'e' ? xc - cw : xc - 0.3, x1: far === 'e' ? xc + 0.3 : xc + cw, z0: cornerZ === 'n' ? zc - 0.3 : zc - cd, z1: cornerZ === 'n' ? zc + cd : zc + 0.3 });
      }
      heaps.push({ corner: true, x: far === 'e' ? xc - cw * 0.45 : xc + cw * 0.45, z: cornerZ === 'n' ? zc + cd * 0.45 : zc - cd * 0.45, w: cw * 1.3, d: cd * 1.3, h: 1.0 + intact * 0.35 });
    }
    // part of the exposed top floor has fallen in, onto the storey below
    if (intact >= 1) {
      const m = pl.main, hw = (m.x1 - m.x0) * (0.3 + rnd() * 0.15), hd = (s.z1 - s.z0) * (0.3 + rnd() * 0.15);
      const hx = far === 'e' ? m.x1 - hw - 0.4 : m.x0 + 0.4, hz = cornerZ === 'n' ? s.z1 - T - hd - 0.3 : s.z0 + T + 0.3;
      const rect = { x0: hx, x1: hx + hw, z0: hz, z1: hz + hd };
      if (!overlaps(rect, { x0: pl.sw.x0 - 0.6, x1: pl.sw.x1 + 0.6, z0: pl.sw.z0 - 1.5, z1: pl.sw.z1 })) {
        (holes[intact - 1] || (holes[intact - 1] = [])).push(rect);
        heaps.push({ inside: true, x: hx + hw / 2, z: hz + hd / 2, w: hw * 0.95, d: hd * 0.95, h: Math.min(1.6, H * 0.45), y: (intact - 1) * H, rect });
      }
    }
  }
  const roomsByFloor = [];
  const spec = {
    x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, floors: intact, H,
    mats: [mats[0], intact > 1 && destroyed === 2 ? upper : mats[1]], base: s.base || 'concrete', trim: s.trim || 'trim',
    doors: ext, windowSpacing: s.windowSpacing || 2.8, stair: pl.stair, inner: pl.inner,
    floorMat: s.floorMat, groundFloorMat: s.groundFloorMat, innerMat: s.innerMat,
    openTop: destroyed ? true : undefined,
    breach: destroyed ? (side, f) => breaches[side][f] || [] : undefined,
    holes: destroyed ? (f) => holes[f] || [] : undefined,
    furnish(B2, f, y) {
      const rooms = pl.rooms.map((r) => Object.assign({}, r, { used: [], doors: r.doors, extDoors: f === 0 ? ext : [] }));
      // keep clear: fallen-in floor above, the collapsed corner, the stair approach
      for (const h of holes[f] || []) for (const r of rooms) r.used.push(h);
      if (f > 0) for (const h of holes[f - 1] || []) for (const r of rooms) r.used.push(h);
      for (const r of rooms) if (destroyed) for (const hp of heaps) if (hp.corner) r.used.push({ x0: hp.x - hp.w / 2, x1: hp.x + hp.w / 2, z0: hp.z - hp.d / 2, z1: hp.z + hp.d / 2 });
      roomsByFloor[f] = rooms;
      const roles = ROLES[style] ? ROLES[style](f, rooms.length) : ROLES.house(f, rooms.length);
      rooms.forEach((r, i) => { r.role = roles[i] || 'living'; furnishRoom(ctx, B2, r, r.role, y, s, f); });
    },
  };
  building(B, spec);
  B.lights.length = lights; // the big map keeps its point lights to the town
  const top = intact * H;
  // contents: 3..8 containers over the floors, then a few loose loot spots
  const budget = { left: 3 + Math.floor(rnd() * (destroyed ? 5 : 6)) };
  const before = ctx.cs.list.length;
  for (let pass = 0; pass < 2 && budget.left > 0; pass++) {
    for (let f = 0; f < intact && budget.left > 0; f++) {
      for (const r of roomsByFloor[f] || []) { if (budget.left <= 0) break; stockRoom(ctx, r, pass ? 'store' : r.role, f * H, f, s, destroyed, budget); }
    }
  }
  for (let f = 0; f < intact; f++) for (const r of roomsByFloor[f] || []) lootSpots(ctx, r, f * H + (f === 0 ? 0.02 : 0), rnd() < 0.55 ? 1 : 0);
  // ruins: what's left of the storey above, rubble, soot
  if (destroyed) {
    const ruinMat = (mats[1].startsWith('panel') ? 'panel' : mats[1]) + 'Burnt';
    if (s.floors > intact) ruinStorey(B, s, top, H, ruinMat, rnd, ctx);
    for (const hp of heaps) {
      if (hp.inside) rubbleHeap(B, hp.x, hp.z, hp.w, hp.d, hp.h, hp.y + 0.0, rnd, ['soot', 'brick', mats[1]]);
      else if (hp.corner) rubbleHeap(B, hp.x, hp.z, hp.w, hp.d, hp.h, 0, rnd, ['soot', 'brick', mats[0]]);
      else {
        const out = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[hp.side];
        const alongX = hp.side === 'n' || hp.side === 's';
        const x = alongX ? hp.c : (hp.side === 'w' ? s.x0 : s.x1) + out[0] * 0.9, z = alongX ? (hp.side === 'n' ? s.z0 : s.z1) + out[1] * 0.9 : hp.c;
        rubbleHeap(B, x, z, alongX ? hp.w * 1.2 : 1.8, alongX ? 1.8 : hp.w * 1.2, 0.7, 0, rnd, ['soot', 'brick', mats[0]]);
      }
    }
    // a crate in the open on the exposed floor (worth the climb)
    const r = (roomsByFloor[intact - 1] || [])[0];
    if (r) {
      const room = Object.assign({}, r, { used: (holes[intact - 1] || []).slice(), doors: { n: [], s: [], e: [], w: [] }, ext: { n: false, s: false, e: false, w: false } });
      const p = fitAgainstWall(room, { w: 1.06, d: 0.62 }, rnd, s, top, { clear: 0.7 });
      if (p) ctx.place(ctx.cs.add('crate', p.x + p.inward[0] * 0.3, top, p.z + p.inward[1] * 0.3, p.yaw, 1 + (rnd() < 0.35 ? 1 : 0)), s);
    }
    if (ctx.atlas) {
      // soot over the blown sections, kept on the wall that is left above them
      for (const side of ['n', 's', 'e', 'w']) for (const f in breaches[side]) for (const b of breaches[side][f]) if (b.y1 < H - 0.4 && +f < intact) soot(ctx, s, side, b.c, +f * H + (b.y1 + H) / 2, b.w + 0.8, H - b.y1 - 0.1);
      ctx.atlas.flat('soot', (s.x0 + s.x1) / 2, 0.004, (s.z0 + s.z1) / 2 + (s.z1 - s.z0) / 2 + 1.4, 0, Math.min(8, s.x1 - s.x0), 3.4, 3, [1, 1, 1, 0.7]);
    }
  } else if (s.roof === 'tile') {
    B.collider(s.x0, top, s.z0, s.x1, top + 0.3, s.z1, 'brick');
    tileRoof(B, s, top, mats[1], { rnd });
  } else if (s.roof === 'flat' || !s.roof) {
    // parapet and roof clutter
    B.solid(s.x0, top, s.z0, s.x1, top + 0.6, s.z0 + 0.22, mats[1], 'brick');
    B.solid(s.x0, top, s.z1 - 0.22, s.x1, top + 0.6, s.z1, mats[1], 'brick');
    B.solid(s.x0, top, s.z0 + 0.22, s.x0 + 0.22, top + 0.6, s.z1 - 0.22, mats[1], 'brick');
    B.solid(s.x1 - 0.22, top, s.z0 + 0.22, s.x1, top + 0.6, s.z1 - 0.22, mats[1], 'brick');
    if (rnd() < 0.6) P.acUnit(B, s.x0 + 1.4 + rnd() * (s.x1 - s.x0 - 2.8), s.z0 + 1.2, 0, top);
  }
  if (s.sign) {
    const f = s.front || 's';
    const p = f === 's' ? { x: (s.x0 + s.x1) / 2, z: s.z1 + 0.08, rot: 0 } : f === 'n' ? { x: (s.x0 + s.x1) / 2, z: s.z0 - 0.08, rot: Math.PI } : f === 'e' ? { x: s.x1 + 0.08, z: (s.z0 + s.z1) / 2, rot: Math.PI / 2 } : { x: s.x0 - 0.08, z: (s.z0 + s.z1) / 2, rot: -Math.PI / 2 };
    B.signs.push({ text: s.sign, x: p.x, y: 2.95, z: p.z, w: Math.min(5, (f === 'n' || f === 's' ? s.x1 - s.x0 : s.z1 - s.z0) * 0.6), h: 0.5, rot: p.rot, color: '#f1e6c8', bg: s.signBg || '#2a3a2c' });
  }
  // the far view
  const ptop = destroyed ? top + H * 0.45 : top;
  proxyShell(B, s, ptop, destroyed ? (mats[1].startsWith('panel') ? 'panel' : mats[1]) + 'Burnt' : mats[1], destroyed ? null : (s.roof || 'flat'), H, intact, s.windowSpacing || 2.8, mats[0]);
  B.own(null);
  ctx.buildings.push({ x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1, floors: s.floors, destroyed: !!destroyed, enterable: true, name: s.name || style, containers: ctx.cs.list.length - before });
  return { top, plan: pl };
}

// Proxy: the shell in its wall material, a roof, and the windows as dark quads.
export function proxyShell(B, s, top, mat, roof, H, floors, spacing = 2.8, baseMat) {
  if (baseMat && baseMat !== mat && floors > 1) {
    B.proxyBox(s.x0, 0, s.z0, s.x1, H, s.z1, baseMat);
    B.proxyBox(s.x0, H, s.z0, s.x1, top, s.z1, mat);
  } else B.proxyBox(s.x0, 0, s.z0, s.x1, top, s.z1, mat);
  if (roof === 'tile') {
    const alongZ = s.z1 - s.z0 > s.x1 - s.x0, span = alongZ ? s.x1 - s.x0 : s.z1 - s.z0, len = alongZ ? s.z1 - s.z0 : s.x1 - s.x0;
    const rise = Math.tan(0.42) * span / 2;
    const sh = new THREE.Shape();
    sh.moveTo(-span / 2 - 0.4, -0.15); sh.lineTo(span / 2 + 0.4, -0.15); sh.lineTo(0, rise); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: len + 0.2, bevelEnabled: false });
    g.translate(0, 0, -(len + 0.2) / 2);
    if (!alongZ) g.rotateY(Math.PI / 2);
    g.translate((s.x0 + s.x1) / 2, top, (s.z0 + s.z1) / 2);
    g.computeVertexNormals();
    B.proxyGeo('roofTiles', worldUVFlat(g));
  } else if (roof) {
    B.proxyBox(s.x0, top, s.z0, s.x1, top + 0.6, s.z1, mat);
  }
  // windows: one quad each
  const quads = [];
  for (let f = 0; f < floors; f++) {
    const y = f * H + 0.95;
    for (const [side, a0, a1] of [['n', s.x0, s.x1], ['s', s.x0, s.x1], ['w', s.z0, s.z1], ['e', s.z0, s.z1]]) {
      for (const c of windowCentres(a0, a1, spacing)) {
        const q = new THREE.PlaneGeometry(1.2, 1.45);
        q.translate(0, 0.72, 0);
        if (side === 'n') q.rotateY(Math.PI).translate(c, y, s.z0 - 0.03);
        else if (side === 's') q.translate(c, y, s.z1 + 0.03);
        else if (side === 'w') q.rotateY(-Math.PI / 2).translate(s.x0 - 0.03, y, c);
        else q.rotateY(Math.PI / 2).translate(s.x1 + 0.03, y, c);
        quads.push(q);
      }
    }
  }
  for (const q of quads) B.proxyGeo('windowRoom', q);
}

function worldUVFlat(g) {
  const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
  const nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const ny = Math.abs(nrm.getY(i));
    uv[i * 2] = pos.getX(i) + pos.getZ(i) * (ny > 0.3 ? 0 : 1);
    uv[i * 2 + 1] = ny > 0.3 ? pos.getZ(i) / Math.max(0.3, ny) : pos.getY(i);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
