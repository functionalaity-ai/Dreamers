/* Procedural pixel art. Everything is drawn with fillRect at 1 art pixel per
 * unit into small offscreen canvases, then cached — no image files needed. */
(function (GHV) {
  'use strict';
  const T = GHV.CONFIG.TILE;
  const hash2 = GHV.util.hash2;

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return { c: c, g: g };
  }
  function px(g, x, y, color, w, h) {
    g.fillStyle = color;
    g.fillRect(x, y, w === undefined ? 1 : w, h === undefined ? 1 : h);
  }

  // Shaded blob: fills the union of discs, lit from the upper-left (the low western sun).
  function blob(g, discs, pal, seed, outline) {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const d of discs) {
      minX = Math.min(minX, d[0] - d[2]); maxX = Math.max(maxX, d[0] + d[2]);
      minY = Math.min(minY, d[1] - d[2]); maxY = Math.max(maxY, d[1] + d[2]);
    }
    const inside = function (x, y) {
      for (const d of discs) {
        const dx = x + 0.5 - d[0], dy = y + 0.5 - d[1];
        if (dx * dx + dy * dy <= d[2] * d[2]) return true;
      }
      return false;
    };
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const rx = (maxX - minX) / 2 || 1, ry = (maxY - minY) / 2 || 1;
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        if (!inside(x, y)) continue;
        const edge = !inside(x, y + 1) || !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y - 1);
        const n = hash2(x, y, seed);
        let l = -((x - cx) / rx) * 0.55 - ((y - cy) / ry) * 0.6 + (n - 0.5) * 0.55;
        let c;
        if (edge && outline && (y > cy || n < 0.3)) c = pal[0];
        else if (l > 0.55) c = pal[3];
        else if (l > 0.1) c = pal[2];
        else if (l > -0.45) c = pal[1];
        else c = pal[0];
        px(g, x, y, c);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Palettes
  // ---------------------------------------------------------------------------
  const PAL = {
    grass: ['#5e8a33', '#76a03f', '#8fb64e', '#aacb63'],
    path: ['#a8834f', '#c49f68', '#d6b47f', '#e6c995'],
    sand: ['#cdb27a', '#e0c58e', '#ebd4a2', '#f5e4bd'],
    plaza: ['#9c8b72', '#bba98d', '#cbbb9f', '#ddd0b8'],
    water: ['#2f6f8f', '#3d84a3', '#5aa0bb', '#9fd0dc'],
    bridge: ['#6a4428', '#8e5f36', '#a8743f', '#c48b52'],
    soil: ['#6e4526', '#8a5a33', '#a06b40'],
    wetSoil: ['#3f2716', '#5a3a22', '#6e4a2c'],
    canopy: [
      ['#3f6328', '#5e8a33', '#86ad45', '#b8cf62'],   // green-gold
      ['#8a5a1f', '#b9822b', '#dca443', '#f3cf6a'],   // amber
      ['#7a3a1c', '#b25529', '#d9793a', '#f0a65a'],   // ember
    ],
    pine: ['#24432a', '#33603a', '#4b7c47', '#6e9a55'],
    bush: ['#3d6230', '#55803b', '#75a04a', '#9cbf5c'],
    trunk: ['#4a2d18', '#6b4426', '#8a5a33'],
    rock: ['#64605a', '#86817a', '#a7a298', '#cbc6ba'],
    wood: ['#5a3a20', '#7d5230', '#a57442', '#c8955a'],
    stone: ['#7d7263', '#9e927f', '#b8ab95', '#d4c8b2'],
  };

  // ---------------------------------------------------------------------------
  // Ground
  // ---------------------------------------------------------------------------
  function grassTile(g, ox, oy, tx, ty) {
    const P = PAL.grass;
    px(g, ox, oy, P[1], T, T);
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(hash2(tx, ty, i * 3 + 1) * T);
      const y = Math.floor(hash2(tx, ty, i * 3 + 2) * T);
      const r = hash2(tx, ty, i * 3 + 3);
      if (r < 0.4) px(g, ox + x, oy + y, P[0]);
      else if (r < 0.8) { px(g, ox + x, oy + y, P[2]); if (y > 0) px(g, ox + x, oy + y - 1, P[2]); }
      else px(g, ox + x, oy + y, P[3]);
    }
  }

  function speckleTile(g, ox, oy, tx, ty, P, n) {
    px(g, ox, oy, P[1], T, T);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(hash2(tx, ty, i * 5 + 7) * T);
      const y = Math.floor(hash2(tx, ty, i * 5 + 8) * T);
      const r = hash2(tx, ty, i * 5 + 9);
      px(g, ox + x, oy + y, r < 0.45 ? P[0] : r < 0.85 ? P[2] : P[3]);
    }
  }

  function plazaTile(g, ox, oy, tx, ty) {
    const P = PAL.plaza;
    px(g, ox, oy, P[2], T, T);
    for (let row = 0; row < 2; row++) {
      const off = (ty + row) % 2 ? 4 : 0;
      const y = oy + row * 8;
      px(g, ox, y, P[0], T, 1);
      for (let bx = -8; bx < T; bx += 8) {
        const x = ox + bx + off;
        if (x >= ox && x < ox + T) px(g, x, y, P[0], 1, 8);
        const shade = hash2(tx * 2 + (bx + 8) / 8, ty * 2 + row, 4);
        const sx = Math.max(ox, x + 1), ex = Math.min(ox + T, x + 8);
        if (ex > sx) {
          if (shade < 0.3) px(g, sx, y + 1, P[1], ex - sx, 7);
          px(g, sx, y + 1, P[3], ex - sx, 1);
        }
      }
    }
  }

  function bridgeTile(g, ox, oy, tx, ty, leftEdge, rightEdge) {
    const P = PAL.bridge;
    px(g, ox, oy, P[2], T, T);
    for (let y = 0; y < T; y += 4) {
      px(g, ox, oy + y + 3, P[0], T, 1);
      px(g, ox, oy + y, P[3], T, 1);
      const knot = Math.floor(hash2(tx, ty + y, 9) * 14);
      px(g, ox + knot, oy + y + 1, P[1], 2, 1);
    }
    if (leftEdge) { px(g, ox, oy, P[0], 2, T); px(g, ox + 1, oy, P[1], 1, T); }
    if (rightEdge) { px(g, ox + T - 2, oy, P[0], 2, T); px(g, ox + T - 2, oy, P[1], 1, T); }
  }

  const FLOWERS = ['#f5d04a', '#f08a5d', '#fff4e0', '#c78bd6'];
  function flowers(g, ox, oy, tx, ty, variant) {
    const n = 1 + Math.floor(hash2(tx, ty, 31) * 3);
    for (let i = 0; i < n; i++) {
      const x = ox + 3 + Math.floor(hash2(tx, ty, 40 + i) * 10);
      const y = oy + 4 + Math.floor(hash2(tx, ty, 50 + i) * 9);
      const c = FLOWERS[(variant + i) % FLOWERS.length];
      px(g, x, y + 2, '#4f7a2c', 1, 2);
      px(g, x - 1, y, c); px(g, x + 1, y, c); px(g, x, y - 1, c); px(g, x, y + 1, c);
      px(g, x, y, '#f9e7a8');
    }
  }

  // Bakes the whole static ground layer into one canvas.
  function renderGround(world) {
    const G = GHV.World.G;
    const W = world.w, H = world.h;
    const out = mk(W * T, H * T);
    const g = out.g;
    const at = function (x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return -1;
      return world.ground[y * W + x];
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = at(x, y), ox = x * T, oy = y * T;
        if (t === G.GRASS) grassTile(g, ox, oy, x, y);
        else if (t === G.PATH) speckleTile(g, ox, oy, x, y, PAL.path, 10);
        else if (t === G.SAND) speckleTile(g, ox, oy, x, y, PAL.sand, 12);
        else if (t === G.PLAZA) plazaTile(g, ox, oy, x, y);
        else if (t === G.WATER) px(g, ox, oy, PAL.water[1], T, T);
        else if (t === G.BRIDGE) bridgeTile(g, ox, oy, x, y, at(x - 1, y) !== G.BRIDGE, at(x + 1, y) !== G.BRIDGE);
      }
    }
    // Soft edges where paths, sand and plaza meet grass: grass blades poke over.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = at(x, y);
        if (t !== G.PATH && t !== G.SAND && t !== G.PLAZA) continue;
        const ox = x * T, oy = y * T;
        const dark = t === G.PLAZA ? PAL.plaza[0] : t === G.SAND ? PAL.sand[0] : PAL.path[0];
        const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (const s of sides) {
          if (at(x + s[0], y + s[1]) !== G.GRASS) continue;
          for (let k = 0; k < T; k++) {
            const r = hash2(x * 31 + k, y * 17 + s[0] * 3 + s[1], 61);
            let gx, gy, dx, dy;
            if (s[1] === -1) { gx = ox + k; gy = oy; dx = 0; dy = 1; }
            else if (s[1] === 1) { gx = ox + k; gy = oy + T - 1; dx = 0; dy = -1; }
            else if (s[0] === -1) { gx = ox; gy = oy + k; dx = 1; dy = 0; }
            else { gx = ox + T - 1; gy = oy + k; dx = -1; dy = 0; }
            px(g, gx, gy, r < 0.65 ? PAL.grass[1] : PAL.grass[2]);
            if (r < 0.3) px(g, gx + dx, gy + dy, PAL.grass[r < 0.15 ? 2 : 1]);
            else if (r > 0.75) px(g, gx + dx, gy + dy, dark);
          }
        }
      }
    }
    for (let i = 0; i < world.decor.length; i++) {
      if (!world.decor[i]) continue;
      const x = i % W, y = (i - x) / W;
      flowers(g, x * T, y * T, x, y, world.decor[i] - 1);
    }
    return out.c;
  }

  // ---------------------------------------------------------------------------
  // Objects
  // ---------------------------------------------------------------------------
  function makeTree(variant) {
    const s = mk(32, 40), g = s.g;
    const TP = PAL.trunk;
    px(g, 14, 26, TP[1], 4, 13);
    px(g, 14, 26, TP[2], 1, 13);
    px(g, 17, 26, TP[0], 1, 13);
    px(g, 12, 37, TP[1], 8, 2);
    px(g, 12, 38, TP[0], 8, 1);
    blob(g, [[16, 14, 11.5], [9, 19, 7], [23, 19, 7], [16, 7.5, 7.5], [11, 11, 6], [21, 11, 6]], PAL.canopy[variant], 100 + variant, true);
    return s.c;
  }

  function makePine() {
    const s = mk(32, 40), g = s.g;
    const TP = PAL.trunk, P = PAL.pine;
    px(g, 14, 30, TP[1], 4, 9);
    px(g, 14, 30, TP[2], 1, 9);
    px(g, 12, 38, TP[0], 8, 1);
    const tiers = [[3, 13, 6], [10, 22, 10], [17, 32, 13]];
    for (const t of tiers) {
      for (let y = t[0]; y <= t[1]; y++) {
        const half = Math.round(((y - t[0]) / (t[1] - t[0])) * t[2]) + 1;
        for (let x = 16 - half; x < 16 + half; x++) {
          const n = hash2(x, y, 77);
          const lit = (16 - x) / half * 0.6 - (y - t[0]) / (t[1] - t[0]) * 0.5 + (n - 0.5) * 0.5;
          px(g, x, y, y === t[1] ? P[0] : lit > 0.35 ? P[3] : lit > -0.05 ? P[2] : lit > -0.45 ? P[1] : P[0]);
        }
      }
    }
    px(g, 15, 1, P[2], 2, 2);
    return s.c;
  }

  function makeBush() {
    const s = mk(16, 16), g = s.g;
    blob(g, [[8, 9, 6.5], [4.5, 11, 4], [11.5, 11, 4]], PAL.bush, 55, true);
    px(g, 5, 8, '#f3cf6a'); px(g, 10, 10, '#f08a5d'); px(g, 8, 6, '#f3cf6a');
    return s.c;
  }

  function makeRock(v) {
    const s = mk(16, 16), g = s.g;
    blob(g, v ? [[8, 10, 5.5], [11, 11, 4]] : [[8, 10, 6], [5, 11, 4]], PAL.rock, 33 + v, true);
    px(g, 6, 7, PAL.rock[3], 2, 1);
    return s.c;
  }

  // A scruffy, darker clump with seed heads, so it reads clearly against the grass.
  function makeWeed(v) {
    const s = mk(16, 16), g = s.g;
    blob(g, v ? [[8, 11, 4.5], [5, 12, 3], [11.5, 12, 3]] : [[8, 11.5, 4], [4.5, 12.5, 3], [11, 11.5, 3.5]],
      ['#2f4a1c', '#3f6326', '#567f30', '#73a03c'], 70 + v, true);
    const blades = v ? [[5, 5], [8, 3], [11, 6]] : [[4, 6], [7, 3], [10, 4], [12, 7]];
    for (const b of blades) {
      px(g, b[0], b[1] + 2, '#3f6326', 1, 6);
      px(g, b[0], b[1], v ? '#e8e0c8' : '#c9a03a', 1, 2);
      px(g, b[0] - 1, b[1] + 1, v ? '#cfc6ad' : '#a77d2a');
    }
    return s.c;
  }

  // mask: 1 = connect left, 2 = right, 4 = up, 8 = down
  function makeFence(mask) {
    const s = mk(16, 24), g = s.g;
    const P = PAL.wood;
    if (mask & 1) { px(g, 0, 11, P[2], 8, 2); px(g, 0, 17, P[2], 8, 2); px(g, 0, 13, P[0], 8, 1); px(g, 0, 19, P[0], 8, 1); }
    if (mask & 2) { px(g, 8, 11, P[2], 8, 2); px(g, 8, 17, P[2], 8, 2); px(g, 8, 13, P[0], 8, 1); px(g, 8, 19, P[0], 8, 1); }
    if (mask & 4) { px(g, 7, 0, P[2], 2, 10); px(g, 9, 0, P[0], 1, 10); }
    if (mask & 8) { px(g, 7, 20, P[2], 2, 4); px(g, 9, 20, P[0], 1, 4); }
    px(g, 6, 8, P[2], 4, 15);
    px(g, 6, 8, P[3], 1, 15);
    px(g, 9, 8, P[0], 1, 15);
    px(g, 6, 7, P[3], 4, 1);
    px(g, 6, 22, P[0], 4, 1);
    return s.c;
  }

  function makeLamp() {
    const s = mk(16, 32), g = s.g;
    px(g, 7, 10, '#3b3530', 2, 20);
    px(g, 7, 10, '#5a5048', 1, 20);
    px(g, 5, 29, '#3b3530', 6, 2);
    px(g, 4, 2, '#3b3530', 8, 1);
    px(g, 5, 1, '#3b3530', 6, 1);
    px(g, 4, 3, '#3b3530', 1, 6); px(g, 11, 3, '#3b3530', 1, 6);
    px(g, 5, 3, '#f6dc8a', 6, 6);
    px(g, 5, 3, '#fff1c2', 2, 3);
    px(g, 4, 9, '#3b3530', 8, 1);
    return s.c;
  }

  function makeBench() {
    const s = mk(16, 16), g = s.g;
    const P = PAL.wood;
    px(g, 1, 4, P[2], 14, 2); px(g, 1, 6, P[0], 14, 1);
    px(g, 1, 8, P[3], 14, 2); px(g, 1, 10, P[1], 14, 1);
    px(g, 2, 11, '#3b3530', 2, 4); px(g, 12, 11, '#3b3530', 2, 4);
    return s.c;
  }

  function makeSign() {
    const s = mk(16, 16), g = s.g;
    const P = PAL.wood;
    px(g, 7, 9, P[1], 2, 7);
    px(g, 2, 2, P[0], 12, 8);
    px(g, 3, 3, P[2], 10, 6);
    px(g, 3, 3, P[3], 10, 1);
    px(g, 4, 5, P[0], 6, 1); px(g, 4, 7, P[0], 8, 1);
    return s.c;
  }

  function makeBin() {
    const s = mk(16, 18), g = s.g;
    const P = PAL.wood;
    px(g, 1, 6, P[0], 14, 11);
    px(g, 2, 7, P[2], 12, 9);
    px(g, 2, 10, P[1], 12, 1); px(g, 2, 13, P[1], 12, 1);
    px(g, 0, 2, P[0], 16, 5);
    px(g, 1, 3, P[3], 14, 3);
    px(g, 1, 3, '#f6dc8a', 14, 1);
    px(g, 7, 5, '#d9a23f', 2, 3);
    px(g, 7, 6, '#f2c14e', 2, 1);
    return s.c;
  }

  function makeSprinkler() {
    const s = mk(16, 16), g = s.g;
    px(g, 4, 11, '#7a5a20', 8, 3);
    px(g, 5, 10, '#c9a03a', 6, 3);
    px(g, 7, 5, '#c9a03a', 2, 6);
    px(g, 7, 5, '#f2d27a', 1, 6);
    px(g, 5, 4, '#9a7428', 6, 2);
    px(g, 5, 4, '#f2d27a', 6, 1);
    px(g, 4, 3, '#7cc0d4'); px(g, 11, 3, '#7cc0d4'); px(g, 3, 2, '#9fd0dc'); px(g, 12, 2, '#9fd0dc');
    return s.c;
  }

  function makePoppy() {
    const s = mk(16, 16), g = s.g;
    px(g, 7, 7, '#4f7a2c', 1, 7); px(g, 5, 11, '#6f9e3a', 2, 1); px(g, 8, 10, '#6f9e3a', 2, 1);
    px(g, 5, 3, '#f2b62c', 5, 4); px(g, 6, 2, '#f2b62c', 3, 6);
    px(g, 5, 3, '#ffd96a', 2, 2);
    px(g, 7, 4, '#a3541c', 1, 2);
    return s.c;
  }

  function makeGlowcap() {
    const s = mk(16, 16), g = s.g;
    px(g, 7, 9, '#efe3c6', 2, 5); px(g, 7, 9, '#fff6e0', 1, 5);
    px(g, 4, 6, '#e6a23a', 8, 3); px(g, 5, 5, '#e6a23a', 6, 1); px(g, 6, 4, '#f6c95c', 4, 1);
    px(g, 5, 6, '#ffe48a', 2, 1); px(g, 9, 7, '#fff1c2');
    px(g, 4, 8, '#b56f22', 8, 1);
    px(g, 11, 11, '#e6a23a', 2, 1); px(g, 12, 12, '#efe3c6', 1, 2);
    return s.c;
  }

  // ---------------------------------------------------------------------------
  // Crops (16x24, base at the bottom of the canvas)
  // ---------------------------------------------------------------------------
  const LEAF = ['#3f6a2a', '#5f9a35', '#86c04f'];
  function leaf(g, x, y, dir, len) {
    for (let i = 0; i < len; i++) px(g, x + dir * i, y - Math.floor(i / 2), i === len - 1 ? LEAF[2] : LEAF[1]);
    px(g, x, y + 1, LEAF[0]);
  }

  function makeCrop(id, stage) {
    const s = mk(16, 24), g = s.g;
    const base = 21;
    if (stage === 0) {
      px(g, 5, base - 1, '#6e4526', 6, 2);
      px(g, 6, base - 2, '#6e4526', 4, 1);
      px(g, 6, base - 2, '#e8d39a'); px(g, 9, base - 1, '#e8d39a');
      return s.c;
    }
    if (stage === 1) {
      px(g, 7, base - 4, LEAF[1], 1, 4);
      leaf(g, 6, base - 4, -1, 3); leaf(g, 8, base - 4, 1, 3);
      return s.c;
    }
    if (id === 'sunwheat') {
      const gold = stage === 3;
      const stalk = gold ? '#c9a03a' : LEAF[1], head = gold ? '#f6dc7a' : LEAF[2], dark = gold ? '#a77d2a' : LEAF[0];
      const h = gold ? 15 : 10;
      for (const sx of [4, 7, 10, 12]) {
        const hh = h - (sx % 3);
        px(g, sx, base - hh, stalk, 1, hh);
        if (gold) { px(g, sx - 1, base - hh, head, 3, 4); px(g, sx, base - hh - 1, head); px(g, sx + 1, base - hh + 3, dark); }
      }
      if (!gold) { leaf(g, 6, base - 5, -1, 4); leaf(g, 11, base - 6, 1, 3); }
      return s.c;
    }
    if (id === 'amber_carrot') {
      const n = stage === 3 ? 6 : 4;
      for (let i = 0; i < n; i++) {
        const x = 4 + i * 2, h = 6 + (i % 2) * 3 + (stage === 3 ? 2 : 0);
        px(g, x, base - h, LEAF[i % 2 ? 1 : 2], 1, h);
        px(g, x - 1, base - h, LEAF[2]); px(g, x + 1, base - h + 2, LEAF[1]);
      }
      if (stage === 3) { px(g, 5, base - 1, '#e88a2f', 6, 2); px(g, 6, base - 1, '#f6b05a', 2, 1); }
      return s.c;
    }
    if (id === 'duskberry') {
      blob(g, stage === 3 ? [[8, base - 6, 6], [4.5, base - 3, 4], [11.5, base - 3, 4]] : [[8, base - 4, 4.5]], PAL.bush, 21, true);
      if (stage === 3) {
        for (const b of [[4, base - 7], [9, base - 9], [11, base - 5], [6, base - 3], [8, base - 6], [12, base - 8]]) {
          px(g, b[0], b[1], '#6a3f9a', 2, 2); px(g, b[0], b[1], '#a77bd3');
        }
      }
      return s.c;
    }
    if (id === 'honey_melon') {
      leaf(g, 3, base - 2, -1, 3); leaf(g, 12, base - 2, 1, 3);
      px(g, 4, base - 1, LEAF[0], 9, 1);
      if (stage === 3) {
        blob(g, [[8, base - 4, 5.5]], ['#b07a2a', '#d9a23f', '#f2c35a', '#ffe39a'], 9, true);
        px(g, 6, base - 8, '#c48d34', 1, 7); px(g, 10, base - 8, '#c48d34', 1, 7);
        px(g, 8, base - 10, LEAF[1], 1, 2);
      } else {
        blob(g, [[8, base - 4, 4]], PAL.bush, 12, true);
      }
      return s.c;
    }
    if (id === 'ember_pumpkin') {
      leaf(g, 2, base - 3, -1, 3); leaf(g, 13, base - 3, 1, 3);
      if (stage === 3) {
        blob(g, [[8, base - 5, 6.5], [4.5, base - 4, 4.5], [11.5, base - 4, 4.5]], ['#8a2f12', '#c24a1e', '#e8692c', '#f8a050'], 5, true);
        px(g, 7, base - 10, '#c24a1e', 1, 8); px(g, 10, base - 9, '#c24a1e', 1, 7); px(g, 4, base - 7, '#c24a1e', 1, 5);
        px(g, 7, base - 13, '#4f6a22', 2, 3); px(g, 9, base - 13, '#6f8f2e');
      } else {
        blob(g, [[8, base - 5, 5], [4, base - 3, 3.5], [12, base - 3, 3.5]], PAL.bush, 15, true);
      }
      return s.c;
    }
    return s.c;
  }

  // ---------------------------------------------------------------------------
  // Buildings
  // ---------------------------------------------------------------------------
  function makeHouse(roofPal, chimney) {
    const s = mk(80, 80), g = s.g;
    const W = PAL.wood;
    // Walls
    px(g, 3, 40, '#efdcb4', 74, 34);
    px(g, 3, 40, '#f8ead0', 74, 2);
    px(g, 3, 66, '#e2cba0', 74, 8);
    for (const x of [3, 27, 51, 75]) px(g, x, 40, W[1], 2, 34);
    px(g, 3, 52, W[1], 74, 2);
    px(g, 1, 73, '#8f8578', 78, 7);
    px(g, 1, 73, '#b0a596', 78, 2);
    for (let x = 1; x < 79; x += 6) px(g, x, 76, '#7a7064', 1, 4);
    // Door
    px(g, 33, 54, W[0], 14, 20);
    px(g, 35, 56, '#7d4b2a', 10, 18);
    px(g, 35, 56, '#955c34', 10, 2);
    px(g, 39, 58, W[0], 2, 14);
    px(g, 42, 65, '#f2c14e', 2, 2);
    px(g, 31, 73, '#c4a26a', 18, 2);
    // Windows
    for (const wx of [10, 56]) {
      px(g, wx, 55, W[0], 14, 12);
      px(g, wx + 1, 56, '#7fa6bf', 12, 10);
      px(g, wx + 1, 56, '#a9cadb', 5, 4);
      px(g, wx + 6, 56, W[0], 1, 10);
      px(g, wx + 1, 60, W[0], 12, 1);
      px(g, wx - 1, 67, W[1], 16, 3);
      for (let k = 0; k < 6; k++) px(g, wx + 1 + k * 2, 66, k % 2 ? '#e35d5b' : '#f2c14e');
    }
    // Roof
    for (let y = 4; y < 42; y++) {
      const inset = Math.max(0, Math.round((42 - y) * 0.42) - 2);
      const row = Math.floor((y - 4) / 4);
      for (let x = inset; x < 80 - inset; x++) {
        const n = hash2(x >> 2, row, 13);
        let c = roofPal[1];
        if ((y - 4) % 4 === 3) c = roofPal[0];
        else if ((x + (row % 2) * 3) % 6 === 0) c = roofPal[0];
        else if (n < 0.25) c = roofPal[2];
        if (x < inset + 2) c = roofPal[0];
        if (y < 8) c = (y === 4 ? roofPal[3] : roofPal[2]);
        px(g, x, y, c);
      }
    }
    px(g, 0, 40, roofPal[0], 80, 2);
    // Light catching the roof's west slope.
    for (let y = 6; y < 40; y += 4) {
      const inset = Math.max(0, Math.round((42 - y) * 0.42) - 2);
      px(g, inset + 2, y, roofPal[3], 3, 1);
    }
    if (chimney) {
      px(g, 58, 0, '#7e3c2b', 8, 14);
      px(g, 59, 1, '#9a4a35', 6, 12);
      px(g, 57, 0, '#5d2b1f', 10, 2);
      for (let y = 4; y < 14; y += 3) px(g, 59, y, '#7e3c2b', 6, 1);
    }
    return s.c;
  }

  // Market stall: back (awning, shelves) and front (counter) so Mabel stands between.
  function makeStall() {
    const back = mk(80, 64), g = back.g;
    const W = PAL.wood;
    px(g, 4, 18, '#7d5230', 72, 26);
    for (let y = 22; y < 44; y += 8) {
      px(g, 6, y + 5, W[3], 68, 2);
      for (let x = 8; x < 72; x += 6) {
        const r = hash2(x, y, 3);
        const col = r < 0.33 ? '#f2c14e' : r < 0.66 ? '#e88a2f' : '#a77bd3';
        px(g, x, y, '#efe3c6', 4, 5); px(g, x + 1, y + 1, col, 2, 3); px(g, x, y - 1, W[0], 4, 1);
      }
    }
    px(g, 2, 14, W[1], 4, 34); px(g, 74, 14, W[1], 4, 34);
    px(g, 2, 14, W[2], 1, 34); px(g, 74, 14, W[2], 1, 34);
    // Striped awning with a scalloped edge.
    for (let x = 0; x < 80; x++) {
      const stripe = Math.floor(x / 8) % 2 === 0;
      const top = 4 + Math.round(Math.abs(40 - x) / 40 * 2);
      for (let y = top; y < 18; y++) px(g, x, y, stripe ? (y < 7 ? '#ffd770' : '#f2c14e') : (y < 7 ? '#fffaf0' : '#fff3d6'));
      const sc = 18 + (x % 8 < 4 ? (x % 4 === 0 || x % 4 === 3 ? 1 : 2) : 0);
      for (let y = 18; y < sc; y++) px(g, x, y, stripe ? '#d9a23f' : '#efe3c6');
    }
    px(g, 0, 3, '#c48d34', 80, 1);
    px(g, 30, 8, '#7d5230', 20, 7);
    px(g, 31, 9, '#fff3d6', 18, 5);
    px(g, 33, 11, '#7d5230', 14, 1);
    const front = mk(80, 64), f = front.g;
    px(f, 0, 40, W[0], 80, 24);
    px(f, 1, 41, W[3], 78, 4);
    px(f, 1, 41, '#e6b878', 78, 1);
    px(f, 1, 45, W[2], 78, 18);
    for (let x = 1; x < 79; x += 8) px(f, x, 45, W[1], 1, 18);
    px(f, 1, 52, W[1], 78, 1);
    // Produce on the counter.
    px(f, 8, 36, '#c24a1e', 9, 5); px(f, 9, 35, '#e8692c', 7, 2); px(f, 12, 34, '#4f6a22', 1, 2);
    px(f, 22, 37, '#f2c35a', 7, 4); px(f, 23, 36, '#ffe39a', 4, 1);
    px(f, 60, 35, '#efe3c6', 6, 6); px(f, 61, 37, '#f2c14e', 4, 3); px(f, 60, 34, W[0], 6, 1);
    px(f, 68, 36, '#efe3c6', 5, 5); px(f, 69, 37, '#a77bd3', 3, 3);
    return { back: back.c, front: front.c };
  }

  function makeLantern(lit) {
    const s = mk(32, 64), g = s.g;
    const S = PAL.stone;
    // Pedestal
    px(g, 1, 52, S[0], 30, 12); px(g, 2, 53, S[2], 28, 10); px(g, 2, 53, S[3], 28, 2);
    px(g, 4, 44, S[0], 24, 9); px(g, 5, 45, S[2], 22, 8); px(g, 5, 45, S[3], 22, 1);
    px(g, 7, 48, S[1], 18, 2);
    for (let x = 8; x < 24; x += 4) px(g, x, 48, lit ? '#f2c14e' : S[0], 2, 2);
    // Column
    px(g, 11, 26, S[0], 10, 19); px(g, 12, 26, S[2], 8, 19); px(g, 12, 26, S[3], 2, 19); px(g, 19, 26, S[1], 1, 19);
    // Lantern cage
    const metal = '#4f4033', glass = lit ? '#ffe9a3' : '#cdbf96', inner = lit ? '#fff8dc' : '#b8a878';
    px(g, 6, 6, metal, 20, 20);
    px(g, 8, 8, glass, 16, 16);
    px(g, 15, 8, metal, 2, 16); px(g, 8, 15, metal, 16, 2);
    px(g, 9, 9, inner, 5, 5);
    px(g, 4, 4, metal, 24, 3); px(g, 8, 1, metal, 16, 3); px(g, 14, 0, metal, 4, 2);
    px(g, 4, 25, metal, 24, 2);
    // Flame
    if (lit) { px(g, 13, 11, '#ffb43a', 6, 10); px(g, 14, 9, '#ffd770', 4, 10); px(g, 15, 12, '#fffbe8', 2, 6); }
    else { px(g, 14, 17, '#b56f22', 4, 4); px(g, 15, 16, '#d9a23f', 2, 4); }
    return s.c;
  }

  // ---------------------------------------------------------------------------
  // Characters
  // ---------------------------------------------------------------------------
  const LOOKS = {
    player: { h: 24, skin: '#f1c7a1', hair: '#6b3f22', shirt: '#f4efe3', pants: '#3e6aa8', pantsDark: '#2f5288', boots: '#5a3a22', hat: 'straw', overalls: true },
    mabel: { h: 23, skin: '#e8b892', hair: '#d8d2c8', shirt: '#b5523b', pants: '#b5523b', pantsDark: '#93402d', boots: '#4a3020', apron: '#f4efe3', bun: true, dress: true },
    fen: { h: 24, skin: '#d9a77f', hair: '#ece7dc', shirt: '#4a5f7a', pants: '#4a5f7a', pantsDark: '#394b62', boots: '#3a2a1e', beard: true, dress: true, cane: true },
    pip: { h: 19, skin: '#f0c49c', hair: '#3a2a1e', shirt: '#f2c14e', pants: '#4a6fa8', pantsDark: '#3a5a8a', boots: '#7d3a2a', hat: 'cap' },
  };

  // Draws a character with its feet at (x, y). frame: 0..3 walk cycle.
  function drawCharacter(g, x, y, look, facing, frame, swing) {
    const L = LOOKS[look];
    if (facing === 'left') {
      g.save();
      g.translate(x * 2 + 1, 0);
      g.scale(-1, 1);
      drawCharacterRight(g, x, y, L, frame, swing);
      g.restore();
      return;
    }
    if (facing === 'right') return drawCharacterRight(g, x, y, L, frame, swing);
    drawCharacterFront(g, x, y, L, facing === 'up', frame);
  }

  function drawCharacterFront(g, x, y, L, back, frame) {
    const small = L.h < 22;
    const top = y - L.h;
    const bob = frame % 2 === 1 ? -1 : 0;
    const headH = small ? 6 : 7;
    const headY = top + 3 + bob;
    const bodyY = headY + headH;
    const bodyH = small ? 5 : 7;
    const legY = bodyY + bodyH;
    const legH = y - legY;
    // Legs and boots
    const lLift = frame === 1 ? 1 : 0, rLift = frame === 3 ? 1 : 0;
    if (L.dress) {
      px(g, x - 5, bodyY + 3, L.pants, 10, legH + bodyH - 4);
      px(g, x - 5, y - 3, L.pantsDark, 10, 1);
      px(g, x - 3, y - 2 - lLift, L.boots, 2, 2); px(g, x + 1, y - 2 - rLift, L.boots, 2, 2);
    } else {
      px(g, x - 3, legY, L.pants, 3, legH - 2 - lLift); px(g, x, legY, L.pants, 3, legH - 2 - rLift);
      px(g, x - 1, legY, L.pantsDark, 1, legH - 2);
      px(g, x - 3, y - 2 - lLift, L.boots, 3, 2); px(g, x, y - 2 - rLift, L.boots, 3, 2);
    }
    // Torso and arms
    px(g, x - 4, bodyY, L.shirt, 8, bodyH);
    if (L.overalls) {
      px(g, x - 3, bodyY + 3, L.pants, 6, bodyH - 3);
      if (!back) { px(g, x - 3, bodyY, L.pants, 1, 3); px(g, x + 2, bodyY, L.pants, 1, 3); px(g, x - 3, bodyY + 3, '#f2c14e'); px(g, x + 2, bodyY + 3, '#f2c14e'); }
    }
    if (L.apron && !back) { px(g, x - 3, bodyY + 2, L.apron, 6, bodyH + 4); px(g, x - 3, bodyY + 2, '#ffffff', 6, 1); }
    const armSwing = frame === 1 ? 1 : frame === 3 ? -1 : 0;
    px(g, x - 6, bodyY + 1 + armSwing, L.shirt, 2, bodyH - 2); px(g, x + 4, bodyY + 1 - armSwing, L.shirt, 2, bodyH - 2);
    px(g, x - 6, bodyY + bodyH - 1 + armSwing, L.skin, 2, 1); px(g, x + 4, bodyY + bodyH - 1 - armSwing, L.skin, 2, 1);
    if (L.cane) { px(g, x + 6, bodyY + 2, '#7d5230', 1, y - bodyY - 2); px(g, x + 5, bodyY + 2, '#7d5230', 2, 1); }
    // Head
    px(g, x - 4, headY, L.skin, 8, headH);
    if (back) {
      px(g, x - 4, headY, L.hair, 8, headH - 1);
    } else {
      px(g, x - 4, headY, L.hair, 8, 2);
      px(g, x - 4, headY, L.hair, 1, 4); px(g, x + 3, headY, L.hair, 1, 4);
      px(g, x - 2, headY + 3, '#2b1d14'); px(g, x + 1, headY + 3, '#2b1d14');
      px(g, x - 3, headY + 4, '#f0a08a'); px(g, x + 2, headY + 4, '#f0a08a');
      if (L.beard) { px(g, x - 3, headY + 4, L.hair, 6, 3); px(g, x - 2, headY + 7, L.hair, 4, 2); px(g, x - 1, headY + 5, '#c99a75', 2, 1); }
    }
    if (L.bun) { px(g, x - 2, headY - 2, L.hair, 4, 2); px(g, x - 1, headY - 3, L.hair, 2, 1); }
    drawHat(g, x, headY, L, back);
  }

  function drawCharacterRight(g, x, y, L, frame, swing) {
    const small = L.h < 22;
    const top = y - L.h;
    const bob = frame % 2 === 1 ? -1 : 0;
    const headH = small ? 6 : 7;
    const headY = top + 3 + bob;
    const bodyY = headY + headH;
    const bodyH = small ? 5 : 7;
    const legY = bodyY + bodyH;
    const legH = y - legY;
    const stride = frame === 1 ? 2 : frame === 3 ? -2 : 0;
    if (L.dress) {
      px(g, x - 4, bodyY + 3, L.pants, 8, legH + bodyH - 4);
      px(g, x - 4, y - 3, L.pantsDark, 8, 1);
      px(g, x - 1 + stride, y - 2, L.boots, 3, 2); px(g, x - 2 - stride, y - 2, L.boots, 3, 2);
    } else {
      px(g, x - 2 - stride, legY, L.pantsDark, 3, legH - 2); px(g, x - 2 - stride, y - 2, L.boots, 3, 2);
      px(g, x - 1 + stride, legY, L.pants, 3, legH - 2); px(g, x - 1 + stride, y - 2, L.boots, 4, 2);
    }
    px(g, x - 3, bodyY, L.shirt, 7, bodyH);
    if (L.overalls) px(g, x - 3, bodyY + 3, L.pants, 7, bodyH - 3);
    if (L.apron) px(g, x + 2, bodyY + 2, L.apron, 2, bodyH + 4);
    // Arm (raised forward while using a tool)
    if (swing) {
      px(g, x, bodyY + 1, L.shirt, 5, 2); px(g, x + 5, bodyY + 1, L.skin, 1, 2);
    } else {
      const a = frame === 1 ? 1 : frame === 3 ? -1 : 0;
      px(g, x - 1 + a, bodyY + 1, L.shirt, 2, bodyH - 2); px(g, x - 1 + a, bodyY + bodyH - 1, L.skin, 2, 1);
    }
    if (L.cane) { px(g, x + 5, bodyY + 2, '#7d5230', 1, y - bodyY - 2); px(g, x + 4, bodyY + 2, '#7d5230', 2, 1); }
    px(g, x - 3, headY, L.skin, 7, headH);
    px(g, x - 3, headY, L.hair, 7, 2); px(g, x - 3, headY, L.hair, 3, headH - 2);
    px(g, x + 2, headY + 3, '#2b1d14');
    px(g, x + 1, headY + 4, '#f0a08a');
    if (L.beard) { px(g, x, headY + 4, L.hair, 4, 4); px(g, x + 1, headY + 8, L.hair, 2, 1); }
    if (L.bun) { px(g, x - 5, headY + 1, L.hair, 2, 3); }
    drawHat(g, x, headY, L, false, true);
  }

  function drawHat(g, x, headY, L, back, side) {
    if (L.hat === 'straw') {
      px(g, x - 6, headY + 1, '#c99a3a', 12, 1);
      px(g, x - 6, headY, '#e8c25a', 12, 1);
      px(g, x - 3, headY - 3, '#e8c25a', 6, 3);
      px(g, x - 3, headY - 3, '#f6dc8a', 6, 1);
      px(g, x - 3, headY - 1, '#c4583a', 6, 1);
    } else if (L.hat === 'cap') {
      px(g, x - 4, headY - 1, '#d9453a', 8, 2);
      px(g, x - 3, headY - 2, '#e8665a', 6, 1);
      if (side) px(g, x + 3, headY, '#a83228', 3, 1);
      else if (!back) px(g, x - 4, headY + 1, '#a83228', 8, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Item icons (16x16), also used for held tools.
  // ---------------------------------------------------------------------------
  function seedPacket(g, col, accent) {
    px(g, 3, 2, '#b8a37a', 10, 13);
    px(g, 4, 3, '#f4e6c4', 8, 11);
    px(g, 4, 3, col, 8, 3);
    px(g, 4, 3, accent, 8, 1);
    px(g, 6, 8, col, 4, 4); px(g, 7, 7, accent, 2, 1);
    px(g, 5, 13, '#d8c69e', 6, 1);
  }

  function makeIcon(id) {
    const s = mk(16, 16), g = s.g;
    const W = PAL.wood;
    switch (id) {
      case 'hoe':
        for (let i = 0; i < 11; i++) px(g, 3 + i, 13 - i, i < 1 ? W[0] : W[2]);
        for (let i = 0; i < 10; i++) px(g, 4 + i, 13 - i, W[1]);
        px(g, 10, 2, '#9aa3ad', 5, 3); px(g, 13, 5, '#7a838d', 2, 2); px(g, 10, 2, '#cfd6dc', 5, 1);
        break;
      case 'can':
        px(g, 3, 7, '#2f7a6d', 9, 7); px(g, 4, 8, '#45a08f', 7, 5); px(g, 4, 8, '#7cc7b6', 2, 3);
        px(g, 5, 4, '#2f7a6d', 5, 1); px(g, 4, 5, '#2f7a6d', 1, 2); px(g, 10, 5, '#2f7a6d', 1, 2);
        px(g, 12, 9, '#2f7a6d', 1, 2); px(g, 13, 8, '#2f7a6d', 1, 2); px(g, 14, 6, '#45a08f', 1, 3);
        break;
      case 'sickle':
        for (let i = 0; i < 6; i++) px(g, 3 + i, 14 - i, W[2], 2, 1);
        px(g, 8, 8, '#cfd6dc', 1, 1); px(g, 9, 6, '#cfd6dc', 1, 2); px(g, 10, 4, '#cfd6dc', 2, 2);
        px(g, 12, 3, '#cfd6dc', 2, 1); px(g, 13, 4, '#9aa3ad', 1, 3); px(g, 12, 7, '#9aa3ad');
        break;
      case 'pickaxe':
        for (let i = 0; i < 10; i++) px(g, 3 + i, 14 - i, W[2]);
        for (let i = 0; i < 10; i++) px(g, 4 + i, 14 - i, W[1]);
        px(g, 6, 2, '#9aa3ad', 3, 2); px(g, 9, 3, '#9aa3ad', 3, 2); px(g, 12, 5, '#9aa3ad', 2, 3); px(g, 13, 8, '#7a838d', 1, 2);
        px(g, 4, 2, '#7a838d', 2, 1); px(g, 6, 2, '#cfd6dc', 3, 1);
        break;
      case 'sunwheat_seed': seedPacket(g, '#e8c45a', '#f6dc7a'); break;
      case 'carrot_seed': seedPacket(g, '#e88a2f', '#f6b05a'); break;
      case 'duskberry_seed': seedPacket(g, '#7a4fa8', '#a77bd3'); break;
      case 'melon_seed': seedPacket(g, '#d9a23f', '#ffe39a'); break;
      case 'pumpkin_seed': seedPacket(g, '#c24a1e', '#f8a050'); break;
      case 'sunwheat':
        for (const x of [5, 7, 9, 11]) { px(g, x, 6, '#c9a03a', 1, 9); px(g, x - 1, 2 + (x % 3), '#f6dc7a', 3, 4); }
        px(g, 4, 10, '#c4583a', 9, 2);
        break;
      case 'amber_carrot':
        for (let i = 0; i < 8; i++) px(g, 4 + i, 6 + i, '#e88a2f', 3 - Math.floor(i / 4), 2);
        px(g, 5, 6, '#f6b05a', 2, 1);
        px(g, 3, 2, LEAF[1], 2, 4); px(g, 5, 1, LEAF[2], 2, 5); px(g, 2, 4, LEAF[2], 2, 2);
        break;
      case 'duskberry':
        for (const b of [[4, 7], [8, 5], [9, 9], [5, 11], [11, 7]]) { px(g, b[0], b[1], '#6a3f9a', 3, 3); px(g, b[0], b[1], '#a77bd3'); }
        px(g, 7, 2, LEAF[1], 3, 2);
        break;
      case 'honey_melon':
        blob(g, [[8, 9, 6]], ['#b07a2a', '#d9a23f', '#f2c35a', '#ffe39a'], 9, true);
        px(g, 8, 2, LEAF[1], 1, 2);
        break;
      case 'ember_pumpkin':
        blob(g, [[8, 10, 5], [5, 10, 4], [11, 10, 4]], ['#8a2f12', '#c24a1e', '#e8692c', '#f8a050'], 5, true);
        px(g, 7, 3, '#4f6a22', 2, 3);
        break;
      case 'poppy': return makePoppy();
      case 'glowcap': return makeGlowcap();
      case 'stone': blob(g, [[8, 9, 5], [5, 10, 3.5]], PAL.rock, 3, true); break;
      case 'fiber':
        for (let i = 0; i < 4; i++) px(g, 4 + i * 2, 3, '#86ad45', 1, 11);
        px(g, 3, 8, '#c4a26a', 10, 2);
        break;
      case 'honey_bun':
        blob(g, [[8, 9, 5.5]], ['#8a5a20', '#c48434', '#dca04a', '#f6cf7a'], 4, true);
        px(g, 5, 6, '#fff1c2', 5, 1); px(g, 6, 7, '#f2c14e', 4, 1);
        break;
      case 'sun_tea':
        px(g, 4, 3, '#cfe4ea', 8, 12); px(g, 5, 6, '#d9822b', 6, 8); px(g, 5, 6, '#f2b05a', 2, 3);
        px(g, 4, 2, '#8a5a33', 8, 2); px(g, 10, 7, '#7cbf4a', 1, 2);
        break;
      case 'sprinkler': return makeSprinkler();
      default:
        px(g, 4, 4, '#ff00ff', 8, 8);
    }
    return s.c;
  }

  // ---------------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------------
  const S = {};

  function init() {
    S.tree = [makeTree(0), makeTree(1), makeTree(2)];
    S.pine = makePine();
    S.bush = makeBush();
    S.rock = [makeRock(0), makeRock(1)];
    S.weed = [makeWeed(0), makeWeed(1)];
    S.fence = [];
    for (let m = 0; m < 16; m++) S.fence.push(makeFence(m));
    S.lamp = makeLamp();
    S.bench = makeBench();
    S.sign = makeSign();
    S.bin = makeBin();
    S.sprinkler = makeSprinkler();
    S.poppy = makePoppy();
    S.glowcap = makeGlowcap();
    S.crops = {};
    for (const id in GHV.CROPS) S.crops[id] = [0, 1, 2, 3].map(function (st) { return makeCrop(id, st); });
    S.house = makeHouse(['#8a3a24', '#c4583a', '#d96a46', '#f0956a'], true);
    S.cottage = {
      rose: makeHouse(['#8a3f4e', '#c96a7a', '#dd8a96', '#f0b2b8'], true),
      teal: makeHouse(['#22524f', '#3f8f8a', '#55a7a0', '#86cbc1'], false),
    };
    S.stall = makeStall();
    S.lantern = [makeLantern(false), makeLantern(true)];
    S.icons = {};
    S.iconUrls = {};
    for (const id in GHV.ITEMS) {
      S.icons[id] = makeIcon(id);
      S.iconUrls[id] = S.icons[id].toDataURL();
    }
    return S;
  }

  GHV.Sprites = {
    init: init,
    S: S,
    PAL: PAL,
    renderGround: renderGround,
    drawCharacter: drawCharacter,
    px: px,
  };
})(window.GHV = window.GHV || {});
