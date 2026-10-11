// Set pieces for the big map's districts: warehouses and sheds (lootable), garage rows, fences,
// rail track with goods wagons, a petrol station, a chapel tower, field furrows, haystacks, and the
// land and tree line beyond the edge of the map.
import * as THREE from 'three';
import * as P from '../props.js';
import { rubbleHeap, rng, proxyShell } from './houses.js';
import { SIZES } from './containers.js';

// --- warehouse / shed (enterable, lootable: lockers and crates) ---------------------------------
// s: { x0, z0, x1, z1, h, mat, doors: [{ side, c, w }], destroyed, seed, name }
export function shed(ctx, s) {
  const B = ctx.B, rnd = ctx.rnd = rng(s.seed || 5);
  const h = s.h || 5.6, t = 0.35, mat = s.mat || 'brick';
  B.own((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
  const ops = { n: [], s: [], e: [], w: [] };
  for (const d of s.doors || []) ops[d.side].push({ c: d.c, w: d.w || 4, y0: -1, y1: d.h || 3.6 });
  // high strip windows
  for (const [side, a0, a1] of [['n', s.x0, s.x1], ['s', s.x0, s.x1], ['w', s.z0, s.z1], ['e', s.z0, s.z1]]) {
    for (let a = a0 + 2.5; a < a1 - 2; a += 4.2) if (!ops[side].some((o) => Math.abs(o.c - a) < o.w / 2 + 1)) ops[side].push({ c: a, w: 2.2, y0: h - 2.0, y1: h - 0.8 });
  }
  if (s.destroyed) {
    const side = rnd() < 0.5 ? 'n' : 's';
    const c = s.x0 + 3 + rnd() * (s.x1 - s.x0 - 6);
    if (!ops[side].some((o) => o.y0 < 0 && Math.abs(o.c - c) < o.w / 2 + 2.5)) ops[side].push({ c, w: 3 + rnd() * 2, y0: -1, y1: h - 1.2 - rnd() });
  }
  const W = (side) => ops[side];
  B.wall('x', s.x0, s.x1, s.z0, s.z0 + t, 0, h, W('n'), mat, 'brick');
  B.wall('x', s.x0, s.x1, s.z1 - t, s.z1, 0, h, W('s'), mat, 'brick');
  B.wall('z', s.z0 + t, s.z1 - t, s.x0, s.x0 + t, 0, h, W('w'), mat, 'brick');
  B.wall('z', s.z0 + t, s.z1 - t, s.x1 - t, s.x1, 0, h, W('e'), mat, 'brick');
  for (const side of ['n', 's', 'e', 'w']) for (const o of ops[side]) if (o.y0 < 0) {
    const out = side === 'n' ? -1.2 : side === 's' ? 1.2 : side === 'w' ? -1.2 : 1.2;
    if (side === 'n' || side === 's') B.hint(o.c, 0, (side === 'n' ? s.z0 : s.z1) + out); else B.hint((side === 'w' ? s.x0 : s.x1) + out, 0, o.c);
  }
  B.solid(s.x0 + t, 0, s.z0 + t, s.x1 - t, 0.03, s.z1 - t, 'concrete', null, { shadow: false });
  // roof: corrugated sheets on steel trusses; bombed ones have bays missing
  const bays = Math.max(2, Math.round((s.x1 - s.x0) / 5));
  const bw = (s.x1 - s.x0) / bays;
  const missing = new Set();
  if (s.destroyed) { const k = Math.floor(rnd() * bays); missing.add(k); if (rnd() < 0.6 && k + 1 < bays) missing.add(k + 1); }
  for (let i = 0; i < bays; i++) {
    const a = s.x0 + i * bw, b = a + bw;
    B.solid(a + 0.05, h - 0.35, s.z0, a + 0.25, h, s.z1, 'darkMetal', 'metal');
    if (missing.has(i)) {
      // hanging torn sheet
      const g = new THREE.BoxGeometry(bw * 0.6, 0.02, 2.4);
      g.rotateX(0.9); g.translate((a + b) / 2, h - 1.0, s.z0 + 1.2 + rnd() * (s.z1 - s.z0 - 2.4));
      B.geo('corrugated', g);
      rubbleHeap(B, (a + b) / 2, (s.z0 + s.z1) / 2 + (rnd() - 0.5) * 3, bw * 0.8, Math.min(6, (s.z1 - s.z0) * 0.4), 1.1, 0, rnd, ['soot', 'brick', 'concrete']);
      continue;
    }
    B.solid(a, h, s.z0 - 0.3, b, h + 0.06, s.z1 + 0.3, 'corrugated', 'metal');
  }
  B.solid(s.x1 - 0.25, h - 0.35, s.z0, s.x1 - 0.05, h, s.z1, 'darkMetal', 'metal');
  // contents
  const before = ctx.cs.list.length;
  const inner = { x0: s.x0 + t, x1: s.x1 - t, z0: s.z0 + t, z1: s.z1 - t };
  const n = 4 + Math.floor(rnd() * 4);
  const used = [];
  const doorBand = (x, z) => ['n', 's', 'e', 'w'].some((side) => ops[side].some((o) => o.y0 < 0 && (side === 'n' || side === 's' ? Math.abs(x - o.c) < o.w / 2 + 1.2 && Math.abs(z - (side === 'n' ? s.z0 : s.z1)) < 3 : Math.abs(z - o.c) < o.w / 2 + 1.2 && Math.abs(x - (side === 'w' ? s.x0 : s.x1)) < 3)));
  for (let i = 0, tries = 0; i < n && tries < 40; tries++) {
    const kind = rnd() < 0.55 ? 'crate' : rnd() < 0.7 ? 'locker' : 'desk';
    const S = SIZES[kind];
    const side = ['n', 's'][Math.floor(rnd() * 2)];
    const x = inner.x0 + 0.8 + rnd() * (inner.x1 - inner.x0 - 1.6), z = side === 'n' ? inner.z0 + 0.01 : inner.z1 - 0.01;
    const rect = { x0: x - S.w / 2 - 0.2, x1: x + S.w / 2 + 0.2, z0: side === 'n' ? z : z - S.d - 0.8, z1: side === 'n' ? z + S.d + 0.8 : z };
    if (doorBand(x, z) || used.some((u) => u.x0 < rect.x1 && u.x1 > rect.x0 && u.z0 < rect.z1 && u.z1 > rect.z0)) continue;
    used.push(rect);
    const tierRoll = rnd();
    ctx.place(ctx.cs.add(kind, x, 0, z, side === 'n' ? 0 : Math.PI, tierRoll < 0.15 ? 2 : tierRoll < 0.5 ? 1 : 0), s);
    i++;
  }
  // stacked cargo and shelving in the middle
  for (let i = 0; i < 3; i++) {
    const x = inner.x0 + 3 + rnd() * (inner.x1 - inner.x0 - 6), z = inner.z0 + 3 + rnd() * (inner.z1 - inner.z0 - 6);
    const rect = { x0: x - 1.2, x1: x + 1.2, z0: z - 1.2, z1: z + 1.2 };
    if (used.some((u) => u.x0 < rect.x1 && u.x1 > rect.x0 && u.z0 < rect.z1 && u.z1 > rect.z0)) continue;
    used.push(rect);
    if (rnd() < 0.5) P.crate(B, x, z, Math.floor(rnd() * 4), 1.1, 1 + Math.floor(rnd() * 2)); else P.shelf(B, x, z, 0, 0, 2.4);
    ctx.loot.push({ x: x + 1.6, y: 0.03, z, tier: rnd() < 0.3 ? 1 : 0 });
  }
  B.indoor.push({ min: [s.x0, 0, s.z0], max: [s.x1, h, s.z1] });
  proxyShell(B, s, h, s.destroyed ? mat + 'Burnt' : mat, null, h, 0);
  B.proxyBox(s.x0, h, s.z0 - 0.3, s.x1, h + 0.06, s.z1 + 0.3, 'corrugated');
  B.own(null);
  ctx.buildings.push({ x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1, floors: 1, destroyed: !!s.destroyed, enterable: true, name: s.name || 'warehouse', containers: ctx.cs.list.length - before });
}

// --- fences, garages ------------------------------------------------------------------------------
// A low picket/board fence from (x0, z0) to (x1, z1) (axis-aligned), with gaps.
export function fence(B, x0, z0, x1, z1, rnd, opts = {}) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1), a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1), c = alongX ? z0 : x0;
  const h = opts.h || 1.05, mat = opts.mat || 'woodDark';
  let a = a0;
  while (a < a1 - 0.2) {
    const len = Math.min(a1 - a, 2.4);
    if (rnd() < (opts.gaps ?? 0.12)) { a += len; continue; }
    const put = (p, q, y0, y1, d) => { if (alongX) B.solid(p, y0, c - d, q, y1, c + d, mat, null); else B.solid(c - d, y0, p, c + d, y1, q, mat, null); };
    put(a, a + 0.1, 0, h + 0.1, 0.05);
    put(a, a + len, 0.25, 0.33, 0.025); put(a, a + len, h - 0.25, h - 0.17, 0.025);
    for (let p = a + 0.15; p < a + len - 0.05; p += 0.16) put(p, p + 0.1, 0.08, h - (opts.picket ? 0.02 : 0.1), 0.012);
    if (alongX) B.collider(a, 0, c - 0.06, a + len, h, c + 0.06, 'wood'); else B.collider(c - 0.06, 0, a, c + 0.06, h, a + len, 'wood');
    a += len;
  }
}

// A row of lock-up garages facing +z or -z (face: 1 / -1), some doors hanging open.
export function garageRow(B, x0, z0, n, face, rnd) {
  const w = 3.4, d = 6, h = 2.7;
  const z1 = z0 + d;
  B.solid(x0, 0, z0, x0 + n * w, h, z1, 'panelPlinth', 'concrete');
  B.solid(x0 - 0.1, h, z0 - 0.15, x0 + n * w + 0.1, h + 0.12, z1 + 0.15, 'concrete', null);
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w + 0.35, b = x0 + (i + 1) * w - 0.35;
    const zf = face > 0 ? z1 + 0.02 : z0 - 0.02;
    const open = rnd() < 0.3;
    if (!open) B.solid(a, 0.05, Math.min(zf, zf + face * 0.05), b, 2.3, Math.max(zf, zf + face * 0.05), rnd() < 0.5 ? 'carGreen' : 'rustMetal', null);
    else { const g = new THREE.BoxGeometry((b - a) / 2, 2.25, 0.05); g.translate(-(b - a) / 4, 1.17, 0); g.rotateY(face * 1.9); g.translate(a, 0, zf); B.geo('carGreen', g); }
  }
  B.proxyBox(x0, 0, z0, x0 + n * w, h + 0.12, z1, 'panelPlinth');
}

// --- rail -----------------------------------------------------------------------------------------
export function railTrack(B, x0, x1, z) {
  B.solid(x0, -0.06, z - 1.6, x1, 0.12, z + 1.6, 'gravel', null, { shadow: false });
  B.collider(x0, 0, z - 1.6, x1, 0.12, z + 1.6, 'stone');
  for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.65) B.solid(x, 0.1, z - 1.25, x + 0.24, 0.2, z + 1.25, 'woodDark', null);
  for (const s of [-0.72, 0.72]) {
    B.solid(x0, 0.2, z + s - 0.035, x1, 0.33, z + s + 0.035, 'darkMetal', null);
    B.solid(x0, 0.2, z + s - 0.07, x1, 0.23, z + s + 0.07, 'rustMetal', null);
  }
  B.proxyBox(x0, -0.06, z - 1.6, x1, 0.14, z + 1.6, 'gravel');
}

// A goods wagon (boxcar) on the track at x; burnt ones are rust and soot. Climbable via its buffers? No: cover.
export function wagon(B, x, z, rnd, burnt) {
  const L = 12, W = 2.9, y0 = 1.05, H = 3.0;
  const body = burnt ? 'burnt' : rnd() < 0.5 ? 'rustMetal' : 'carGreen';
  B.solid(x - L / 2, y0, z - W / 2, x + L / 2, y0 + H, z + W / 2, body, 'metal');
  B.solid(x - L / 2 - 0.1, y0 + H, z - W / 2 - 0.08, x + L / 2 + 0.1, y0 + H + 0.18, z + W / 2 + 0.08, burnt ? 'burnt' : 'corrugated', null);
  // ribs, sliding door, under-frame, bogies
  for (let k = -5; k <= 5; k += 1) if (Math.abs(k) > 1) for (const s of [-1, 1]) B.solid(x + k * 1.05 - 0.05, y0, z + s * W / 2 - 0.03, x + k * 1.05 + 0.05, y0 + H, z + s * W / 2 + 0.03, 'darkMetal', null);
  B.solid(x - 1.3, y0 + 0.1, z + W / 2, x + 1.3, y0 + H - 0.2, z + W / 2 + 0.06, burnt ? 'burnt' : 'rustMetal', null);
  B.solid(x - L / 2 + 0.3, 0.6, z - 1.0, x + L / 2 - 0.3, y0, z + 1.0, 'darkMetal', 'metal');
  for (const bx of [-L / 2 + 2, L / 2 - 2]) {
    for (const ax of [-0.9, 0.9]) for (const s of [-0.72, 0.72]) {
      const g = new THREE.CylinderGeometry(0.45, 0.45, 0.14, 14); g.rotateX(Math.PI / 2); g.translate(x + bx + ax, 0.78, z + s);
      B.geo('darkMetal', g);
    }
    B.solid(x + bx - 1.4, 0.55, z - 1.0, x + bx + 1.4, 0.75, z + 1.0, 'darkMetal', null);
  }
  for (const s of [-1, 1]) for (const zz of [-0.85, 0.85]) {
    const g = new THREE.CylinderGeometry(0.18, 0.18, 0.4, 10); g.rotateZ(Math.PI / 2); g.translate(x + s * (L / 2 + 0.2), y0 - 0.1, z + zz);
    B.geo('chrome', g);
  }
  B.proxyBox(x - L / 2, 0.6, z - W / 2, x + L / 2, y0 + H + 0.18, z + W / 2, body);
}

// --- petrol station --------------------------------------------------------------------------------
export function petrolStation(B, x, z, rnd) {
  // forecourt slab, canopy on four columns, two pump islands
  B.solid(x - 12, 0, z - 8, x + 12, 0.04, z + 8, 'concrete', null, { shadow: false });
  for (const [cx, cz] of [[-7, -4], [7, -4], [-7, 4], [7, 4]]) B.solid(x + cx - 0.25, 0, z + cz - 0.25, x + cx + 0.25, 5.2, z + cz + 0.25, 'trim', 'concrete');
  B.solid(x - 10, 5.2, z - 6, x + 10, 6.0, z + 6, 'trim', 'concrete');
  B.solid(x - 10.05, 5.4, z - 6.05, x + 10.05, 5.95, z - 5.95, 'carRed', null);
  B.solid(x - 10.05, 5.4, z + 5.95, x + 10.05, 5.95, z + 6.05, 'carRed', null);
  // a corner of the canopy has come down
  const g = new THREE.BoxGeometry(6, 0.7, 4.5); g.rotateZ(0.5); g.translate(x + 7.5, 3.4, z + 4); B.geo('trim', g);
  B.collider(x + 4.5, 0, z + 2, x + 10, 2.4, z + 6, 'concrete');
  for (const pz of [-1.6, 1.6]) {
    B.solid(x - 4, 0, z + pz - 0.6, x + 4, 0.18, z + pz + 0.6, 'concrete', 'concrete');
    for (const px of [-2.2, 2.2]) {
      B.solid(x + px - 0.45, 0.18, z + pz - 0.3, x + px + 0.45, 1.9, z + pz + 0.3, rnd() < 0.5 ? 'carWhite' : 'carRed', 'metal');
      B.solid(x + px - 0.4, 1.4, z + pz - 0.31, x + px + 0.4, 1.75, z + pz - 0.29, 'glass', null);
      B.solid(x + px + 0.45, 0.8, z + pz - 0.05, x + px + 0.55, 1.2, z + pz + 0.05, 'darkMetal', null);
    }
  }
  B.proxyBox(x - 10, 5.2, z - 6, x + 10, 6.0, z + 6, 'trim');
  for (const [cx, cz] of [[-7, -4], [7, -4], [-7, 4], [7, 4]]) B.proxyBox(x + cx - 0.25, 0, z + cz - 0.25, x + cx + 0.25, 5.2, z + cz + 0.25, 'trim');
  B.signs.push({ text: 'БЕНЗИН · PETROL', x, y: 5.6, z: z + 6.08, w: 5, h: 0.5, rot: 0, color: '#ffe9b0', bg: '#7a1d1a' });
}

// --- chapel tower (the nave is a lootable building) ---------------------------------------------------
export function belfry(B, x0, z0, w, h) {
  B.solid(x0, 0, z0, x0 + w, h, z0 + w, 'brickPale', 'brick');
  B.solid(x0 - 0.2, h - 0.4, z0 - 0.2, x0 + w + 0.2, h, z0 + w + 0.2, 'trim', null);
  for (const y of [h * 0.4, h * 0.72]) B.solid(x0 - 0.05, y, z0 - 0.05, x0 + w + 0.05, y + 0.3, z0 + w + 0.05, 'trim', null);
  const sp = new THREE.ConeGeometry(w * 0.72, w * 2.2, 4); sp.rotateY(Math.PI / 4); sp.translate(x0 + w / 2, h + w * 1.1, z0 + w / 2);
  B.geo('roof', sp);
  B.proxyBox(x0, 0, z0, x0 + w, h, z0 + w, 'brickPale');
  const sp2 = sp.clone(); B.proxyGeo('roof', sp2);
}

// --- farmland -------------------------------------------------------------------------------------------
export function field(B, x0, z0, x1, z1, mat = 'soil') {
  B.solid(x0, -0.06, z0, x1, -0.005, z1, mat, null, { shadow: false });
  B.proxyBox(x0, -0.06, z0, x1, -0.005, z1, mat);
}

export function haystack(B, x, z, rnd) {
  const g = new THREE.CylinderGeometry(0.75, 0.75, 1.5, 14); g.rotateZ(Math.PI / 2); g.rotateY(rnd() * 3); g.translate(x, 0.74, z);
  B.geo('sandbag', g);
  B.collider(x - 0.75, 0, z - 0.75, x + 0.75, 1.45, z + 0.75, 'sandbag');
}

// --- barricades ------------------------------------------------------------------------------------------
// A street barricade across x..x+len (along x or z), with a gap to walk through.
export function barricade(B, x, z, alongX, len, rnd) {
  const n = Math.max(2, Math.round(len / 3.4));
  const gap = Math.floor(rnd() * n);
  for (let i = 0; i < n; i++) {
    if (i === gap) continue;
    const a = -len / 2 + (i + 0.5) * (len / n);
    const k = rnd();
    const px = alongX ? x + a : x, pz = alongX ? z : z + a;
    if (k < 0.45) P.jersey(B, px, pz, alongX ? 0 : 1);
    else if (k < 0.8) P.sandbags(B, px, pz, alongX ? 0 : 1, 2.6, 4);
    else P.crate(B, px, pz, Math.floor(rnd() * 4), 1.0, rnd() < 0.5 ? 2 : 1);
  }
}

// --- beyond the edge ------------------------------------------------------------------------------------
// Fields and a dark tree line out to the horizon (seen from the plane and from the edge streets).
export function outerLand(scene, mats, bounds, rnd) {
  const W = mats.world, group = new THREE.Group();
  group.name = 'brOuter';
  const R = 1600;
  const ring = [];
  // a ground slab round the map (the map's own ground covers the middle)
  const g = new THREE.PlaneGeometry(2 * R, 2 * R, 1, 1);
  g.rotateX(-Math.PI / 2); g.translate(0, -0.09, 0);
  const uv = g.attributes.uv; const p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
  const ground = new THREE.Mesh(g, W.grass);
  ground.receiveShadow = true;
  group.add(ground);
  // field strips just outside the map in the soil colour, to break the grass up
  const strips = [];
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, d = 260 + rnd() * 500, w = 60 + rnd() * 120, l = 40 + rnd() * 90;
    const b = new THREE.PlaneGeometry(w, l); b.rotateX(-Math.PI / 2); b.rotateY(Math.round(rnd() * 4) * Math.PI / 2); b.translate(Math.cos(a) * d, -0.07, Math.sin(a) * d);
    const u = b.attributes.uv, q = b.attributes.position; for (let k = 0; k < u.count; k++) u.setXY(k, q.getX(k), q.getZ(k));
    strips.push(b);
  }
  // tree line: low blobs of leaves
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2, d = bounds.maxX + 45 + rnd() * 160;
    const s = 4 + rnd() * 5;
    const b = new THREE.IcosahedronGeometry(s, 0); b.scale(1, 0.8 + rnd() * 0.5, 1); b.translate(Math.cos(a) * d, s * 0.7, Math.sin(a) * d);
    ring.push(b);
  }
  const merge = (list) => { const out = list.map((x) => x.index ? x.toNonIndexed() : x); return out; };
  const mk = (list, mat) => {
    let n = 0; for (const x of list) n += (x.index ? x.index.count : x.attributes.position.count);
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
    let o = 0;
    for (const x0 of merge(list)) {
      if (!x0.attributes.normal) x0.computeVertexNormals();
      pos.set(x0.attributes.position.array, o * 3); nrm.set(x0.attributes.normal.array, o * 3);
      if (x0.attributes.uv) uvs.set(x0.attributes.uv.array, o * 2);
      o += x0.attributes.position.count;
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); gg.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); gg.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    gg.computeBoundingSphere();
    const m = new THREE.Mesh(gg, mat); m.receiveShadow = true; return m;
  };
  group.add(mk(strips, W.soil));
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x3b4a26, roughness: 0.95, flatShading: true, name: 'treeLine' });
  group.add(mk(ring, treeMat));
  group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  scene.add(group);
  return group;
}
