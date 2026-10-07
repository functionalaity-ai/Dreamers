/* The valley map: ground tiles, objects, buildings and zones.
 * Layout is hand-placed; decoration is seeded so every new game looks the same
 * while weeds and rocks on the farm come from the save's own seed. */
(function (GHV) {
  'use strict';
  const C = GHV.CONFIG;
  const hash2 = GHV.util.hash2;

  const G = { GRASS: 0, PATH: 1, WATER: 2, SAND: 3, PLAZA: 4, BRIDGE: 5 };

  // Objects that block movement.
  const SOLID_OBJ = {
    tree: true, pine: true, bush: true, rock: true, fence: true, lamp: true,
    bench: true, sign: true, bin: true, sprinkler: true,
  };

  // Objects that are part of the map and never change (not saved).
  const STATIC_OBJ = { tree: 1, pine: 1, bush: 1, fence: 1, lamp: 1, bench: 1, sign: 1, bin: 1 };

  const FARM = { x0: 2, y0: 2, x1: 30, y1: 31 };          // inside the fence
  const PLAZA = { x0: 40, y0: 10, x1: 53, y1: 21 };
  const RIVER = { y0: 34, y1: 36 };
  const BRIDGE_X = [44, 45];

  function inRect(r, x, y) { return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }

  function create() {
    const W = C.MAP_W, H = C.MAP_H;
    const world = {
      w: W, h: H,
      ground: new Uint8Array(W * H),
      obj: new Array(W * H).fill(null),
      decor: new Uint8Array(W * H),
      structures: [],
      signs: {},
      lamps: [],
      spawn: { x: 7, y: 8 },
    };
    const idx = function (x, y) { return y * W + x; };
    const setG = function (x, y, g) { if (x >= 0 && y >= 0 && x < W && y < H) world.ground[idx(x, y)] = g; };
    const setO = function (x, y, o) { if (x >= 0 && y >= 0 && x < W && y < H) world.obj[idx(x, y)] = o; };
    const fillG = function (x0, y0, x1, y1, g) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setG(x, y, g);
    };

    // --- River, banks and bridge -------------------------------------------
    fillG(0, RIVER.y0, W - 1, RIVER.y1, G.WATER);
    fillG(0, RIVER.y0 - 1, W - 1, RIVER.y0 - 1, G.SAND);
    fillG(0, RIVER.y1 + 1, W - 1, RIVER.y1 + 1, G.SAND);
    fillG(BRIDGE_X[0], RIVER.y0, BRIDGE_X[1], RIVER.y1, G.BRIDGE);

    // --- Farm pond -----------------------------------------------------------
    for (let y = 22; y <= 30; y++) {
      for (let x = 3; x <= 11; x++) {
        const dx = (x - 6.5) / 3.2, dy = (y - 26) / 2.6;
        if (dx * dx + dy * dy <= 1) setG(x, y, G.WATER);
      }
    }

    // --- Paths -------------------------------------------------------------------
    fillG(7, 7, 8, 14, G.PATH);                  // farmhouse door down to the lane
    fillG(7, 15, 39, 16, G.PATH);                // lane east to the village
    fillG(10, 6, 12, 7, G.PATH);                 // little apron by the shipping bin
    fillG(PLAZA.x0, PLAZA.y0, PLAZA.x1, PLAZA.y1, G.PLAZA);
    fillG(40, 8, 44, 9, G.PATH);                 // stall front
    fillG(51, 7, 53, 9, G.PATH);                 // Mabel's cottage door
    fillG(54, 15, 58, 16, G.PATH);               // to Fen's cottage
    fillG(57, 15, 59, 15, G.PATH);
    fillG(44, 22, 45, RIVER.y0 - 1, G.PATH);     // plaza down to the bridge
    fillG(44, RIVER.y1 + 1, 45, 39, G.PATH);     // into the south meadow

    // --- Buildings -------------------------------------------------------------
    const addStructure = function (s) {
      world.structures.push(s);
      for (let y = s.y; y < s.y + s.h; y++) {
        for (let x = s.x; x < s.x + s.w; x++) setG(x, y, s.ground === undefined ? G.GRASS : s.ground);
      }
    };
    addStructure({ id: 'house', type: 'house', x: 5, y: 3, w: 5, h: 4, door: { x: 7, y: 6 } });
    addStructure({ id: 'stall', type: 'stall', x: 40, y: 5, w: 5, h: 3 });
    addStructure({ id: 'lantern', type: 'lantern', x: 46, y: 13, w: 2, h: 3, ground: G.PLAZA });
    addStructure({ id: 'mabel_home', type: 'cottage', roof: 'rose', x: 50, y: 3, w: 5, h: 4, door: { x: 52, y: 6 } });
    addStructure({ id: 'fen_home', type: 'cottage', roof: 'teal', x: 56, y: 11, w: 5, h: 4, door: { x: 58, y: 14 } });

    // --- Map border: dense woods --------------------------------------------------
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const edge = x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2;
        if (edge && world.ground[idx(x, y)] !== G.WATER && world.ground[idx(x, y)] !== G.SAND) {
          setO(x, y, hash2(x, y, 7) < 0.5 ? 'pine' : 'tree');
        }
      }
    }
    // Rivers run off the edge of the map: block the banks there with bushes.
    for (const y of [RIVER.y0 - 1, RIVER.y1 + 1]) {
      setO(0, y, 'bush'); setO(1, y, 'bush'); setO(W - 1, y, 'bush'); setO(W - 2, y, 'bush');
    }

    // --- Farm fence (east and south sides, gap for the lane) ----------------------
    for (let y = 2; y <= 32; y++) if (y !== 15 && y !== 16) setO(31, y, 'fence');
    for (let x = 2; x <= 31; x++) setO(x, 32, 'fence');

    // --- Fixed props ------------------------------------------------------------------
    setO(11, 6, 'bin');
    setO(12, 13, 'sign'); world.signs[idx(12, 13)] = 'Juniper Farm — "Plant at dawn, harvest at golden hour."';
    setO(36, 14, 'sign'); world.signs[idx(36, 14)] = 'East: Golden Hour Village. Mabel\'s Stall is open 8 AM – 8 PM.';
    setO(46, 31, 'sign'); world.signs[idx(46, 31)] = 'South: Glowcap Meadow. Mushrooms like the shade of old trees.';
    setO(4, 15, 'sign'); world.signs[idx(4, 15)] = 'Water anything you plant every day. Rain does it for you.';
    for (const p of [[40, 10], [53, 10], [40, 21], [53, 21], [33, 14], [43, 31], [10, 8]]) {
      setO(p[0], p[1], 'lamp');
      world.lamps.push({ x: p[0], y: p[1] });
    }
    setO(43, 19, 'bench'); setO(50, 19, 'bench'); setO(43, 11, 'bench'); setO(50, 11, 'bench');

    // --- Seeded decoration: trees, bushes and flowers -----------------------------
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const i = idx(x, y);
        if (world.ground[i] !== G.GRASS || world.obj[i] || structureAt(world, x, y) || nearStructure(world, x, y)) continue;
        const r = hash2(x, y, 11);
        const farm = inRect(FARM, x, y);
        const south = y > RIVER.y1 + 1;
        if (farm) {
          // A few old trees around the farm edges, clear in the middle.
          const nearEdge = x <= 3 || y <= 3 || x >= 29;
          if (nearEdge && r < 0.25 && !(y >= 13 && y <= 18)) setO(x, y, hash2(x, y, 3) < 0.5 ? 'tree' : 'bush');
        } else if (south) {
          if (r < 0.16 && Math.abs(x - 44.5) > 2) setO(x, y, hash2(x, y, 3) < 0.6 ? 'tree' : 'pine');
          else if (r < 0.2 && Math.abs(x - 44.5) > 2) setO(x, y, 'bush');
        } else if (!nearPath(world, x, y, 2)) {
          if (r < 0.07) setO(x, y, hash2(x, y, 3) < 0.7 ? 'tree' : 'pine');
          else if (r < 0.1) setO(x, y, 'bush');
        }
        if (!world.obj[i] && hash2(x, y, 19) < (farm ? 0.03 : 0.09)) world.decor[i] = 1 + Math.floor(hash2(x, y, 23) * 4);
      }
    }

    return world;
  }

  // Scatter weeds and rocks over the untouched farm field (new games only).
  function scatterDebris(world, rng) {
    for (let y = FARM.y0 + 1; y <= FARM.y1; y++) {
      for (let x = FARM.x0 + 1; x < FARM.x1; x++) {
        if (!isFarmable(world, x, y) || world.obj[y * world.w + x]) continue;
        if (Math.abs(x - world.spawn.x) + Math.abs(y - world.spawn.y) < 4) continue;
        if (nearPath(world, x, y, 1)) continue;
        const r = rng();
        if (r < 0.12) world.obj[y * world.w + x] = 'weed';
        else if (r < 0.165) world.obj[y * world.w + x] = 'rock';
      }
    }
  }

  function inBounds(world, x, y) { return x >= 0 && y >= 0 && x < world.w && y < world.h; }

  function structureAt(world, x, y) {
    for (const s of world.structures) {
      if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return s;
    }
    return null;
  }

  function nearStructure(world, x, y) {
    for (const s of world.structures) {
      if (x >= s.x - 1 && x <= s.x + s.w && y >= s.y - 1 && y <= s.y + s.h) return true;
    }
    return false;
  }

  function nearPath(world, x, y, r) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(world, nx, ny)) continue;
        const g = world.ground[ny * world.w + nx];
        if (g === G.PATH || g === G.PLAZA || g === G.BRIDGE) return true;
      }
    }
    return false;
  }

  function isSolid(world, x, y) {
    if (!inBounds(world, x, y)) return true;
    const i = y * world.w + x;
    if (world.ground[i] === G.WATER) return true;
    const o = world.obj[i];
    if (o && SOLID_OBJ[o]) return true;
    return !!structureAt(world, x, y);
  }

  function inFarm(x, y) { return inRect(FARM, x, y); }

  // Grass inside the farm fence that isn't covered by a building.
  function isFarmable(world, x, y) {
    if (!inFarm(x, y) || !inBounds(world, x, y)) return false;
    if (world.ground[y * world.w + x] !== G.GRASS) return false;
    return !structureAt(world, x, y);
  }

  function isWater(world, x, y) {
    return inBounds(world, x, y) && world.ground[y * world.w + x] === G.WATER;
  }

  // Breadth-first reachability over walkable tiles (used by tests and NPC sanity checks).
  function reachable(world, from, to) {
    const W = world.w, seen = new Uint8Array(W * world.h);
    const q = [from.y * W + from.x];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.shift();
      const x = i % W, y = (i - x) / W;
      if (x === to.x && y === to.y) return true;
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + d[0], ny = y + d[1];
        if (!inBounds(world, nx, ny)) continue;
        const j = ny * W + nx;
        if (seen[j]) continue;
        seen[j] = 1;
        if (nx === to.x && ny === to.y) return true;
        if (!isSolid(world, nx, ny)) q.push(j);
      }
    }
    return false;
  }

  // Compact encoding of the mutable object layer for save files.
  const CODES = { weed: 'w', rock: 'r', poppy: 'p', glowcap: 'g', sprinkler: 's' };
  const DECODE = {};
  for (const k in CODES) DECODE[CODES[k]] = k;

  function encodeObjects(world) {
    let out = '';
    for (let i = 0; i < world.obj.length; i++) {
      const o = world.obj[i];
      out += (o && CODES[o]) || '.';
    }
    return out;
  }

  function decodeObjects(world, str) {
    if (typeof str !== 'string' || str.length !== world.obj.length) return false;
    for (let i = 0; i < str.length; i++) {
      const cur = world.obj[i];
      if (cur && STATIC_OBJ[cur]) continue;
      world.obj[i] = DECODE[str[i]] || null;
    }
    return true;
  }

  GHV.World = {
    G: G,
    FARM: FARM,
    PLAZA: PLAZA,
    RIVER: RIVER,
    SOLID_OBJ: SOLID_OBJ,
    create: create,
    scatterDebris: scatterDebris,
    inBounds: inBounds,
    isSolid: isSolid,
    isWater: isWater,
    inFarm: inFarm,
    isFarmable: isFarmable,
    structureAt: structureAt,
    nearPath: nearPath,
    reachable: reachable,
    encodeObjects: encodeObjects,
    decodeObjects: decodeObjects,
  };
})(window.GHV = window.GHV || {});
