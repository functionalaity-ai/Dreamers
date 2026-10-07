/* Golden Hour Valley — game core.
 * Holds all game state and rules. It never touches the DOM: the UI and
 * renderer listen for events (toast, sfx, fx, dialog, shop, ...) instead. */
(function (GHV) {
  'use strict';
  const C = GHV.CONFIG;
  const ITEMS = GHV.ITEMS;
  const CROPS = GHV.CROPS;
  const World = GHV.World;
  const Inv = GHV.Inventory;
  const U = GHV.util;
  const T = C.TILE;

  const FACING = {
    down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  };
  const TOOL_TIME = 0.28;

  // ---------------------------------------------------------------------------
  // Pure helpers
  // ---------------------------------------------------------------------------
  function cropTotalDays(cropId) {
    return CROPS[cropId].stages.reduce(function (a, b) { return a + b; }, 0);
  }

  function isMature(crop) {
    return crop.days >= cropTotalDays(crop.id);
  }

  // 0 = seed … stages.length = mature.
  function cropStage(crop) {
    const stages = CROPS[crop.id].stages;
    let acc = 0;
    for (let i = 0; i < stages.length; i++) {
      acc += stages[i];
      if (crop.days < acc) return i;
    }
    return stages.length;
  }

  function sellPrice(id) {
    const it = ITEMS[id];
    if (!it) return 0;
    if (it.sell !== undefined) return it.sell;
    if (it.price !== undefined) return Math.floor(it.price / 2);
    return 0;
  }

  function calendar(day) {
    const d = day - 1;
    return {
      year: Math.floor(d / (GHV.SEASON_LENGTH * 4)) + 1,
      season: GHV.SEASONS[Math.floor(d / GHV.SEASON_LENGTH) % 4],
      dayOfSeason: (d % GHV.SEASON_LENGTH) + 1,
    };
  }

  // ---------------------------------------------------------------------------
  // NPCs
  // ---------------------------------------------------------------------------
  const NPC_DEFS = [
    { id: 'mabel', name: 'Mabel', home: { x: 42, y: 6 }, area: null, from: 8 * 60, to: 20 * 60, speed: 0 },
    { id: 'fen', name: 'Old Fen', home: { x: 48, y: 17 }, area: { x0: 44, y0: 16, x1: 51, y1: 20 }, from: 7 * 60, to: 22 * 60, speed: 18 },
    { id: 'pip', name: 'Pip', home: { x: 41, y: 17 }, area: { x0: 33, y0: 15, x1: 53, y1: 22 }, from: 8 * 60, to: 19 * 60 + 30, speed: 40 },
  ];

  function makeNpc(def) {
    return {
      id: def.id, name: def.name, def: def,
      x: def.home.x * T + 8, y: def.home.y * T + 12,
      facing: 'down', visible: false, moving: false, animT: 0,
      target: null, wait: 1 + Math.random() * 2,
    };
  }

  // ---------------------------------------------------------------------------
  // Game
  // ---------------------------------------------------------------------------
  function Game() {
    this.listeners = {};
    this.world = null;
    this.state = null;
    this.rng = null;
    this.npcs = [];
  }

  Game.prototype.on = function (evt, fn) {
    (this.listeners[evt] = this.listeners[evt] || []).push(fn);
    return this;
  };

  Game.prototype.emit = function (evt, data) {
    const ls = this.listeners[evt];
    if (ls) for (const fn of ls) fn(data);
  };

  Game.prototype.toast = function (msg, kind) { this.emit('toast', { msg: msg, kind: kind || 'info' }); };
  Game.prototype.sfx = function (name) { this.emit('sfx', name); };
  Game.prototype.fx = function (type, x, y) { this.emit('fx', { type: type, x: x, y: y }); };
  Game.prototype.changed = function () { this.emit('change'); };

  Game.prototype.newGame = function (seed) {
    seed = seed === undefined ? (Date.now() ^ (Math.random() * 1e9)) >>> 0 : seed >>> 0;
    this.rng = U.makeRng(seed);
    this.world = World.create();
    World.scatterDebris(this.world, this.rng);
    const inv = Inv.create(C.INVENTORY_SIZE);
    for (const s of GHV.STARTING_INVENTORY) Inv.add(inv, s.id, s.qty);
    this.state = {
      v: 1,
      seed: seed,
      day: 1,
      time: C.DAY_START,
      gold: C.START_GOLD,
      energy: C.MAX_ENERGY,
      maxEnergy: C.MAX_ENERGY,
      canLevel: 0,
      canWater: GHV.CAN_LEVELS[0].capacity,
      player: this.spawnPlayer(),
      inv: inv,
      sel: 0,
      soil: {},
      weather: 'clear',
      tomorrow: 'clear',
      shipping: [],
      offering: {},
      restored: false,
      upgrades: {},
      flags: { lateWarned: false },
      stats: { earned: 0, shipped: 0, harvested: 0, restoredOnDay: 0 },
    };
    this.npcs = NPC_DEFS.map(makeNpc);
    this.spawnForage(8);
    this.updateNpcVisibility(true);
    return this;
  };

  Game.prototype.spawnPlayer = function () {
    const sp = this.world.spawn;
    return { x: sp.x * T + 8, y: sp.y * T + 12, facing: 'down', moving: false, animT: 0, tool: null, toolT: 0 };
  };

  // ---------------------------------------------------------------------------
  // Save / load
  // ---------------------------------------------------------------------------
  Game.prototype.serialize = function () {
    const s = this.state;
    return JSON.parse(JSON.stringify({
      v: 1,
      seed: s.seed,
      rng: this.rng.state(),
      day: s.day, time: s.time, gold: s.gold,
      energy: s.energy, maxEnergy: s.maxEnergy,
      canLevel: s.canLevel, canWater: s.canWater,
      player: { x: s.player.x, y: s.player.y, facing: s.player.facing },
      inv: s.inv, sel: s.sel, soil: s.soil,
      weather: s.weather, tomorrow: s.tomorrow,
      shipping: s.shipping, offering: s.offering, restored: s.restored,
      upgrades: s.upgrades, flags: s.flags, stats: s.stats,
      obj: World.encodeObjects(this.world),
    }));
  };

  Game.prototype.load = function (data) {
    if (!data || data.v !== 1) throw new Error('Unsupported save');
    this.newGame(data.seed);
    const s = this.state;
    this.rng = U.makeRng(data.rng >>> 0);
    this.world = World.create();
    if (!World.decodeObjects(this.world, data.obj)) throw new Error('Corrupt save (objects)');
    s.day = data.day; s.time = data.time; s.gold = data.gold;
    s.energy = data.energy; s.maxEnergy = data.maxEnergy || C.MAX_ENERGY;
    s.canLevel = data.canLevel || 0;
    s.canWater = U.clamp(data.canWater, 0, GHV.CAN_LEVELS[s.canLevel].capacity);
    s.player = this.spawnPlayer();
    if (data.player) { s.player.x = data.player.x; s.player.y = data.player.y; s.player.facing = data.player.facing || 'down'; }
    s.inv = Inv.create(C.INVENTORY_SIZE);
    (data.inv || []).forEach(function (slot, i) {
      if (slot && ITEMS[slot.id] && i < C.INVENTORY_SIZE) s.inv[i] = { id: slot.id, qty: slot.qty };
    });
    s.sel = U.clamp(data.sel | 0, 0, C.HOTBAR_SIZE - 1);
    s.soil = {};
    for (const k in data.soil || {}) {
      const so = data.soil[k];
      s.soil[k] = { watered: !!so.watered, crop: so.crop && CROPS[so.crop.id] ? { id: so.crop.id, days: so.crop.days | 0 } : null };
    }
    s.weather = data.weather || 'clear';
    s.tomorrow = data.tomorrow || 'clear';
    s.shipping = data.shipping || [];
    s.offering = data.offering || {};
    s.restored = !!data.restored;
    s.upgrades = data.upgrades || {};
    s.flags = Object.assign({ lateWarned: false }, data.flags || {});
    s.stats = Object.assign({ earned: 0, shipped: 0, harvested: 0, restoredOnDay: 0 }, data.stats || {});
    this.npcs = NPC_DEFS.map(makeNpc);
    this.updateNpcVisibility(true);
    return this;
  };

  // ---------------------------------------------------------------------------
  // Queries used by the renderer and UI
  // ---------------------------------------------------------------------------
  Game.prototype.idx = function (x, y) { return y * this.world.w + x; };
  Game.prototype.held = function () { return this.state.inv[this.state.sel]; };
  Game.prototype.heldItem = function () { const h = this.held(); return h ? ITEMS[h.id] : null; };
  Game.prototype.canCapacity = function () { return GHV.CAN_LEVELS[this.state.canLevel].capacity; };
  Game.prototype.calendar = function () { return calendar(this.state.day); };
  Game.prototype.shopOpen = function () { return this.state.time >= C.SHOP_OPEN && this.state.time < C.SHOP_CLOSE; };

  Game.prototype.playerTile = function () {
    const p = this.state.player;
    return { x: Math.floor(p.x / T), y: Math.floor((p.y - 3) / T) };
  };

  // The tile the player will act on: the hovered tile if within reach, else the one ahead.
  Game.prototype.targetTile = function (hover) {
    const pt = this.playerTile();
    if (hover && Math.max(Math.abs(hover.x - pt.x), Math.abs(hover.y - pt.y)) <= C.REACH) {
      return { x: hover.x, y: hover.y };
    }
    const f = FACING[this.state.player.facing];
    return { x: pt.x + f.x, y: pt.y + f.y };
  };

  Game.prototype.npcAt = function (tx, ty) {
    for (const n of this.npcs) {
      if (!n.visible || n.id === 'mabel') continue;
      const cx = tx * T + 8, cy = ty * T + 8;
      if (Math.abs(n.x - cx) < 12 && Math.abs(n.y - 4 - cy) < 14) return n;
    }
    return null;
  };

  Game.prototype.offeringProgress = function () {
    let have = 0, need = 0;
    for (const req of GHV.OFFERING) {
      need += req.qty;
      have += Math.min(req.qty, this.state.offering[req.item] || 0);
    }
    return need ? have / need : 0;
  };

  // Short label describing what the action button would do on a tile (for the HUD prompt).
  Game.prototype.describeTarget = function (tx, ty) {
    const w = this.world, s = this.state;
    if (!World.inBounds(w, tx, ty)) return null;
    const npc = this.npcAt(tx, ty);
    if (npc) return 'Talk to ' + npc.name;
    const st = World.structureAt(w, tx, ty);
    if (st) {
      if (st.type === 'house') return 'Go to bed';
      if (st.type === 'stall') return this.shopOpen() ? "Shop at Mabel's" : 'Stall closed';
      if (st.type === 'lantern') return s.restored ? 'The Great Lantern' : 'Make an offering';
      if (st.type === 'cottage') return 'Knock';
    }
    const i = this.idx(tx, ty);
    const o = w.obj[i];
    if (o === 'bin') {
      const h = this.held();
      return h && ITEMS[h.id].kind !== 'tool' ? 'Ship ' + ITEMS[h.id].name : 'Shipping bin';
    }
    if (o === 'sign') return 'Read sign';
    if (o === 'poppy' || o === 'glowcap') return 'Pick ' + ITEMS[o].name;
    const soil = s.soil[i];
    if (soil && soil.crop && isMature(soil.crop)) return 'Harvest ' + CROPS[soil.crop.id].name;
    const h = this.held();
    if (!h) return null;
    const it = ITEMS[h.id];
    if (h.id === 'can' && World.isWater(w, tx, ty)) return 'Refill can';
    if (h.id === 'can' && soil && !soil.watered) return 'Water';
    if (h.id === 'hoe' && !soil && !o && World.isFarmable(w, tx, ty)) return 'Till';
    if (h.id === 'sickle' && o === 'weed') return 'Cut weeds';
    if (h.id === 'pickaxe' && o === 'rock') return 'Break rock';
    if (h.id === 'pickaxe' && o === 'sprinkler') return 'Pick up sprinkler';
    if (it.kind === 'seed' && soil && !soil.crop) return 'Plant';
    if (it.kind === 'placeable' && !o && !soil && World.isFarmable(w, tx, ty)) return 'Place';
    if (it.kind === 'food') return 'Eat ' + it.name;
    return null;
  };

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------
  // input: { x, y } movement vector, each in [-1, 1].
  Game.prototype.update = function (dt, input) {
    const s = this.state;
    const before = Math.floor(s.time / 10);
    s.time += dt * C.GAME_MINUTES_PER_SECOND;
    if (Math.floor(s.time / 10) !== before) {
      this.emit('tick');
      this.updateNpcVisibility(false);
    }
    if (s.time >= 24 * 60 && !s.flags.lateWarned) {
      s.flags.lateWarned = true;
      this.toast("It's midnight. You'll pass out at 2 AM if you don't get to bed.", 'warn');
    }
    if (s.time >= C.PASS_OUT) {
      // The app fades out first if it's listening; otherwise sleep right away.
      if (this.listeners.passOut) {
        if (!this.passingOut) { this.passingOut = true; this.emit('passOut'); }
      } else {
        this.sleep(true);
      }
      return;
    }
    this.updatePlayer(dt, input || { x: 0, y: 0 });
    for (const n of this.npcs) this.updateNpc(n, dt);
  };

  Game.prototype.boxBlocked = function (x, y) {
    const x0 = Math.floor((x - 5) / T), x1 = Math.floor((x + 5) / T);
    const y0 = Math.floor((y - 6) / T), y1 = Math.floor((y - 1) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (World.isSolid(this.world, tx, ty)) return true;
      }
    }
    return false;
  };

  Game.prototype.updatePlayer = function (dt, input) {
    const p = this.state.player;
    if (p.toolT > 0) {
      p.toolT -= dt;
      if (p.toolT <= 0) { p.toolT = 0; p.tool = null; }
      p.moving = false;
      return;
    }
    let mx = input.x, my = input.y;
    const len = Math.hypot(mx, my);
    if (len < 0.15) { p.moving = false; p.animT = 0; return; }
    if (len > 1) { mx /= len; my /= len; }
    if (Math.abs(mx) > Math.abs(my)) p.facing = mx > 0 ? 'right' : 'left';
    else p.facing = my > 0 ? 'down' : 'up';
    const step = C.WALK_SPEED * dt;
    const nx = p.x + mx * step;
    if (!this.boxBlocked(nx, p.y)) p.x = nx;
    const ny = p.y + my * step;
    if (!this.boxBlocked(p.x, ny)) p.y = ny;
    p.moving = true;
    p.animT += dt;
  };

  Game.prototype.updateNpcVisibility = function (reset) {
    const t = this.state.time;
    for (const n of this.npcs) {
      const vis = t >= n.def.from && t < n.def.to;
      if (vis && (!n.visible || reset)) {
        n.x = n.def.home.x * T + 8;
        n.y = n.def.home.y * T + 12;
        n.target = null;
      }
      n.visible = vis;
    }
  };

  Game.prototype.updateNpc = function (n, dt) {
    if (!n.visible || !n.def.area || n.talking) { n.moving = false; return; }
    if (n.wait > 0) { n.wait -= dt; n.moving = false; return; }
    if (!n.target) {
      const a = n.def.area;
      for (let tries = 0; tries < 10; tries++) {
        const tx = a.x0 + Math.floor(Math.random() * (a.x1 - a.x0 + 1));
        const ty = a.y0 + Math.floor(Math.random() * (a.y1 - a.y0 + 1));
        if (!World.isSolid(this.world, tx, ty)) { n.target = { x: tx * T + 8, y: ty * T + 12 }; break; }
      }
      if (!n.target) { n.wait = 1; return; }
    }
    const dx = n.target.x - n.x, dy = n.target.y - n.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1.5) { n.target = null; n.wait = 1.5 + Math.random() * 4; n.moving = false; return; }
    const step = Math.min(dist, n.def.speed * dt);
    const nx = n.x + (dx / dist) * step, ny = n.y + (dy / dist) * step;
    if (this.boxBlocked(nx, ny)) { n.target = null; n.wait = 0.5; return; }
    n.x = nx; n.y = ny;
    n.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    n.moving = true;
    n.animT += dt;
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  Game.prototype.busy = function () { return this.state.player.toolT > 0; };

  Game.prototype.faceTile = function (tx, ty) {
    const p = this.state.player, pt = this.playerTile();
    const dx = tx - pt.x, dy = ty - pt.y;
    if (dx === 0 && dy === 0) return;
    if (Math.abs(dx) >= Math.abs(dy)) p.facing = dx > 0 ? 'right' : 'left';
    else p.facing = dy > 0 ? 'down' : 'up';
  };

  Game.prototype.swing = function (tool) {
    const p = this.state.player;
    p.tool = tool;
    p.toolT = TOOL_TIME;
  };

  Game.prototype.spend = function (itemId) {
    const cost = ITEMS[itemId].cost || 0;
    if (this.state.energy < cost) {
      this.toast("You're exhausted. Eat something or head to bed.", 'warn');
      this.sfx('error');
      return false;
    }
    this.state.energy -= cost;
    return true;
  };

  // The one "use" button: talk, interact, harvest, or use the held item.
  Game.prototype.act = function (tx, ty) {
    if (this.busy()) return;
    const w = this.world, s = this.state;
    if (!World.inBounds(w, tx, ty)) return;
    this.faceTile(tx, ty);

    const npc = this.npcAt(tx, ty);
    if (npc) return this.talk(npc);

    const st = World.structureAt(w, tx, ty);
    if (st) return this.useStructure(st);

    const i = this.idx(tx, ty);
    const o = w.obj[i];
    if (o === 'bin') return this.shipHeld();
    if (o === 'sign') return this.emit('dialog', { name: 'Sign', lines: [w.signs[i]] });
    if (o === 'lamp') return this.emit('dialog', { name: '', lines: [s.time >= 18 * 60 ? 'The lamp hums softly.' : 'An iron lamp post. Old Fen lights them at dusk.'] });
    if (o === 'poppy' || o === 'glowcap') return this.pickForage(i, tx, ty, o);

    const soil = s.soil[i];
    if (soil && soil.crop && isMature(soil.crop)) return this.harvest(i, tx, ty);

    const h = this.held();
    if (!h) return;
    const it = ITEMS[h.id];
    if (h.id === 'hoe') return this.useHoe(i, tx, ty);
    if (h.id === 'can') return this.useCan(i, tx, ty);
    if (h.id === 'sickle') return this.useSickle(i, tx, ty);
    if (h.id === 'pickaxe') return this.usePickaxe(i, tx, ty);
    if (it.kind === 'seed') return this.plant(i, tx, ty, h.id);
    if (it.kind === 'placeable') return this.place(i, tx, ty, h.id);
    if (it.kind === 'food') return this.eat();
  };

  Game.prototype.useStructure = function (st) {
    if (st.type === 'house') return this.emit('confirmSleep');
    if (st.type === 'stall') {
      if (this.shopOpen()) return this.emit('openShop');
      return this.emit('dialog', { name: '', lines: ["Mabel's stall is shuttered for the night. A chalk sign reads: \"Open 8 AM – 8 PM. Go to bed. — M\""] });
    }
    if (st.type === 'lantern') return this.emit('openOffering');
    if (st.id === 'mabel_home') return this.emit('dialog', { name: '', lines: ["Mabel's cottage. It smells like honey buns and lavender polish."] });
    if (st.id === 'fen_home') return this.emit('dialog', { name: '', lines: ["Old Fen's cottage. Dozens of unlit candles line the windowsill, waiting."] });
  };

  Game.prototype.useHoe = function (i, tx, ty) {
    const s = this.state, w = this.world, o = w.obj[i];
    this.swing('hoe');
    if (s.soil[i]) return this.toast(s.soil[i].crop ? 'Something is growing here.' : 'Already tilled.');
    if (o === 'weed') return this.toast('Clear the weeds with your sickle first.');
    if (o === 'rock') return this.toast('Break the rock with your pickaxe first.');
    if (o) return;
    if (!World.isFarmable(w, tx, ty)) {
      if (!World.inFarm(tx, ty)) this.toast('You can only till soil on your farm.');
      return;
    }
    if (!this.spend('hoe')) return;
    s.soil[i] = { watered: s.weather === 'sunshower', crop: null };
    this.sfx('till');
    this.fx('dirt', tx, ty);
    this.changed();
  };

  Game.prototype.useCan = function (i, tx, ty) {
    const s = this.state, w = this.world;
    this.swing('can');
    if (World.isWater(w, tx, ty)) {
      s.canWater = this.canCapacity();
      this.sfx('refill');
      this.fx('splash', tx, ty);
      this.toast('Watering can filled (' + s.canWater + ').');
      return this.changed();
    }
    const soil = s.soil[i];
    if (!soil) return;
    if (soil.watered) return;
    if (s.canWater <= 0) {
      this.sfx('error');
      return this.toast('Your watering can is empty. Refill it at the pond or river.', 'warn');
    }
    if (!this.spend('can')) return;
    s.canWater--;
    soil.watered = true;
    this.sfx('water');
    this.fx('water', tx, ty);
    this.changed();
  };

  Game.prototype.useSickle = function (i, tx, ty) {
    const s = this.state, w = this.world;
    this.swing('sickle');
    if (w.obj[i] === 'weed') {
      if (!this.spend('sickle')) return;
      w.obj[i] = null;
      this.sfx('cut');
      this.fx('leaf', tx, ty);
      if (this.rng() < 0.4) this.give('fiber', 1);
      return this.changed();
    }
    const soil = s.soil[i];
    if (soil && soil.crop) this.toast("It isn't ready yet.");
  };

  Game.prototype.usePickaxe = function (i, tx, ty) {
    const s = this.state, w = this.world, o = w.obj[i];
    this.swing('pickaxe');
    if (o === 'rock') {
      if (!this.spend('pickaxe')) return;
      w.obj[i] = null;
      this.sfx('rock');
      this.fx('stone', tx, ty);
      this.give('stone', this.rng() < 0.3 ? 2 : 1);
      return this.changed();
    }
    if (o === 'sprinkler') {
      if (Inv.room(s.inv, 'sprinkler') < 1) return this.toast('Your bag is full.', 'warn');
      w.obj[i] = null;
      Inv.add(s.inv, 'sprinkler', 1);
      this.sfx('pick');
      return this.changed();
    }
    const soil = s.soil[i];
    if (soil && soil.crop) return this.toast('That would destroy the crop.');
    if (soil) {
      if (!this.spend('pickaxe')) return;
      delete s.soil[i];
      this.sfx('till');
      this.fx('dirt', tx, ty);
      this.changed();
    }
  };

  Game.prototype.plant = function (i, tx, ty, seedId) {
    const s = this.state, soil = s.soil[i];
    if (!soil) {
      return this.toast(World.isFarmable(this.world, tx, ty) && !this.world.obj[i]
        ? 'Till the soil with your hoe first.' : 'Seeds need tilled farm soil.');
    }
    if (soil.crop) return this.toast('Something is already planted here.');
    soil.crop = { id: ITEMS[seedId].crop, days: 0 };
    Inv.removeAt(s.inv, s.sel, 1);
    this.sfx('plant');
    this.fx('dirt', tx, ty);
    this.changed();
  };

  Game.prototype.place = function (i, tx, ty, id) {
    const s = this.state, w = this.world;
    if (w.obj[i] || s.soil[i] || !World.isFarmable(w, tx, ty)) return this.toast("You can't place that here.");
    const pt = this.playerTile();
    if (pt.x === tx && pt.y === ty) return this.toast("You're standing there.");
    w.obj[i] = id;
    Inv.removeAt(s.inv, s.sel, 1);
    this.sfx('plant');
    this.changed();
  };

  Game.prototype.give = function (id, qty) {
    const left = Inv.add(this.state.inv, id, qty);
    if (left > 0) this.toast('Your bag is full! ' + left + ' ' + ITEMS[id].name + ' left behind.', 'warn');
    this.emit('gain', { id: id, qty: qty - left });
    return qty - left;
  };

  Game.prototype.harvest = function (i, tx, ty) {
    const s = this.state, soil = s.soil[i], crop = CROPS[soil.crop.id];
    const qty = crop.yield[0] + Math.floor(this.rng() * (crop.yield[1] - crop.yield[0] + 1));
    if (Inv.room(s.inv, crop.product) < qty) return this.toast('Your bag is full.', 'warn');
    this.give(crop.product, qty);
    s.stats.harvested += qty;
    if (crop.regrow) soil.crop.days = cropTotalDays(soil.crop.id) - crop.regrow;
    else soil.crop = null;
    this.swing('hands');
    this.sfx('harvest');
    this.fx('sparkle', tx, ty);
    this.changed();
  };

  Game.prototype.pickForage = function (i, tx, ty, id) {
    const s = this.state;
    if (Inv.room(s.inv, id) < 1) return this.toast('Your bag is full.', 'warn');
    this.world.obj[i] = null;
    this.give(id, 1);
    this.swing('hands');
    this.sfx('pick');
    this.fx('sparkle', tx, ty);
    this.changed();
  };

  Game.prototype.eat = function (slot) {
    const s = this.state;
    slot = slot === undefined ? s.sel : slot;
    const h = s.inv[slot];
    if (!h) return false;
    const it = ITEMS[h.id];
    if (!it.energy) { this.toast("You can't eat that."); return false; }
    if (s.energy >= s.maxEnergy) { this.toast("You're full of energy already."); return false; }
    s.energy = Math.min(s.maxEnergy, s.energy + it.energy);
    Inv.removeAt(s.inv, slot, 1);
    this.sfx('eat');
    this.toast('Ate ' + it.name + ' (+' + it.energy + ' energy).');
    this.changed();
    return true;
  };

  Game.prototype.shipHeld = function () {
    const s = this.state, h = this.held();
    if (!h) return this.toast('Hold something to ship it. Payment arrives overnight.');
    const it = ITEMS[h.id];
    if (it.kind === 'tool') return this.toast("Grandma's tools aren't for sale.");
    const price = sellPrice(h.id);
    s.shipping.push({ id: h.id, qty: h.qty });
    s.inv[s.sel] = null;
    this.sfx('ship');
    this.toast('Shipped ' + h.qty + ' ' + it.name + ' — ' + (price * h.qty) + 'g arrives overnight.');
    this.changed();
  };

  Game.prototype.selectSlot = function (n) {
    this.state.sel = U.clamp(n, 0, C.HOTBAR_SIZE - 1);
    this.changed();
  };

  Game.prototype.cycleSlot = function (dir) {
    this.state.sel = (this.state.sel + dir + C.HOTBAR_SIZE) % C.HOTBAR_SIZE;
    this.changed();
  };

  // ---------------------------------------------------------------------------
  // Talking
  // ---------------------------------------------------------------------------
  Game.prototype.talk = function (npc) {
    const p = this.state.player;
    const dx = p.x - npc.x, dy = p.y - npc.y;
    npc.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    npc.target = null;
    npc.wait = 3;
    this.emit('dialog', { name: npc.name, npc: npc.id, lines: this.npcLines(npc) });
  };

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  Game.prototype.npcLines = function (npc) {
    const s = this.state, prog = this.offeringProgress();
    if (npc.id === 'fen') {
      if (!s.flags.fenIntro) {
        s.flags.fenIntro = true;
        return [
          "Ah. Juniper's grandchild. You've got her squint — the kind you get from looking into the sun too long.",
          "That's the Great Lantern behind me. For a hundred years it has held the valley in its golden hour. Lately it's been… dimming.",
          'The old way to wake it is an offering of the valley\'s own harvest. The list is carved into the pedestal.',
          "Grow it, gather it, bring it here. No hurry. The sun's been setting for a hundred years — it can wait for you.",
        ];
      }
      if (s.restored) {
        return [pick([
          "Look at it. Juniper would have cried. I'm not crying. It's the light.",
          'Folk are saying the valley feels warmer. I say it feels like it remembers itself.',
          "The lantern's blessing is on your fields now. Don't let it make you lazy.",
        ])];
      }
      let line;
      if (prog === 0) line = 'The offering list is on the pedestal. Sunwheat is a fine place to start.';
      else if (prog < 0.35) line = 'The lantern flickered when you walked past. It knows you.';
      else if (prog < 0.75) line = "It's brighter than it was. I've started sleeping with the curtains open.";
      else line = 'Nearly there. I can almost read by it.';
      return [line, pick([
        'Glowcaps grow south of the river, in the shade. They keep sunlight in their caps.',
        "Water every day. Plants are like people — they don't grow on promises.",
        "Ember Pumpkins take their time. Plant them early or you'll be waiting at the end.",
        'Duskberries keep giving, if you keep watering. Like friendship.',
        "Mabel sells sprinklers. Juniper called them 'brass grandchildren'.",
      ])];
    }
    if (npc.id === 'pip') {
      if (s.restored) return [pick(["The lantern's on! I can see my shadow at night now!", 'Old Fen hummed today. HUMMED. Is he sick?'])];
      if (s.weather === 'sunshower') return ["Sunshowers mean a fox is getting married somewhere. That's what Mabel says."];
      return [pick([
        'Race you to the bridge! …You\'re slow.',
        'Mabel lets me lick the honey spoon if I sweep the stall.',
        'The fish in the river are gold at sunset. They\'re not really. It\'s the light.',
        'Grandma Juniper used to give me duskberries. Do you have duskberries? …Just asking.',
        "I found a glowcap once and it glowed in my pocket all night. Mum was not happy.",
        "Old Fen says the lantern is a hundred years old. Old Fen is TWO hundred years old.",
      ])];
    }
    return ['…'];
  };

  // ---------------------------------------------------------------------------
  // Shop & offering
  // ---------------------------------------------------------------------------
  Game.prototype.buy = function (id, qty) {
    const s = this.state, it = ITEMS[id];
    qty = qty || 1;
    if (!it || it.price === undefined) return { ok: false, msg: 'Not for sale.' };
    const cost = it.price * qty;
    if (s.gold < cost) { this.sfx('error'); return { ok: false, msg: 'Not enough gold.' }; }
    if (Inv.room(s.inv, id) < qty) { this.sfx('error'); return { ok: false, msg: 'Your bag is full.' }; }
    s.gold -= cost;
    Inv.add(s.inv, id, qty);
    this.sfx('coin');
    this.changed();
    return { ok: true, msg: 'Bought ' + qty + ' ' + it.name + '.' };
  };

  Game.prototype.upgradeAvailable = function (up) {
    const s = this.state;
    if (s.upgrades[up.id]) return false;
    if (up.requires && !s.upgrades[up.requires]) return false;
    return true;
  };

  Game.prototype.buyUpgrade = function (upId) {
    const s = this.state;
    const up = GHV.UPGRADES.find(function (u) { return u.id === upId; });
    if (!up || !this.upgradeAvailable(up)) return { ok: false, msg: 'Not available.' };
    if (s.gold < up.price) { this.sfx('error'); return { ok: false, msg: 'Not enough gold.' }; }
    s.gold -= up.price;
    s.upgrades[up.id] = true;
    if (up.canLevel !== undefined) {
      s.canLevel = Math.max(s.canLevel, up.canLevel);
      s.canWater = this.canCapacity();
    }
    if (up.maxEnergy) {
      s.maxEnergy += up.maxEnergy;
      s.energy += up.maxEnergy;
    }
    this.sfx('coin');
    this.changed();
    return { ok: true, msg: up.name + ' — done!' };
  };

  // Moves every needed item from the bag into the lantern. Returns how many were offered.
  Game.prototype.offerAll = function () {
    const s = this.state;
    let total = 0;
    for (const req of GHV.OFFERING) {
      const have = s.offering[req.item] || 0;
      const need = req.qty - have;
      if (need <= 0) continue;
      const n = Math.min(need, Inv.count(s.inv, req.item));
      if (n > 0) {
        Inv.remove(s.inv, req.item, n);
        s.offering[req.item] = have + n;
        total += n;
      }
    }
    if (total > 0) {
      this.sfx('offer');
      this.changed();
    }
    if (!s.restored && this.offeringProgress() >= 1) this.restore();
    return total;
  };

  Game.prototype.restore = function () {
    const s = this.state;
    s.restored = true;
    s.stats.restoredOnDay = s.day;
    s.gold += C.LANTERN_REWARD;
    this.sfx('restore');
    this.changed();
    this.emit('restored');
  };

  // ---------------------------------------------------------------------------
  // Sleeping and the new day
  // ---------------------------------------------------------------------------
  Game.prototype.sleep = function (passedOut) {
    const s = this.state;
    this.passingOut = false;
    const summary = { day: s.day, items: [], earned: 0, passedOut: !!passedOut, lost: 0 };

    if (passedOut) {
      summary.lost = Math.min(C.PASS_OUT_PENALTY_CAP, Math.floor(s.gold * C.PASS_OUT_PENALTY));
      s.gold -= summary.lost;
    }

    // Payment for shipped goods.
    const merged = {};
    for (const sh of s.shipping) merged[sh.id] = (merged[sh.id] || 0) + sh.qty;
    for (const id in merged) {
      const value = sellPrice(id) * merged[id];
      summary.items.push({ id: id, qty: merged[id], value: value });
      summary.earned += value;
      s.stats.shipped += merged[id];
    }
    s.gold += summary.earned;
    s.stats.earned += summary.earned;
    s.shipping = [];

    // Rest.
    if (passedOut) s.energy = Math.floor(s.maxEnergy * 0.5);
    else if (s.time >= 24 * 60) s.energy = Math.floor(s.maxEnergy * 0.75);
    else s.energy = s.maxEnergy;

    this.startNewDay();
    summary.newDay = s.day;
    summary.weather = s.weather;
    this.emit('dayEnd', summary);
    return summary;
  };

  Game.prototype.startNewDay = function () {
    const s = this.state, w = this.world;
    s.day++;
    s.time = C.DAY_START;
    s.flags.lateWarned = false;

    // Crops grow if they were watered yesterday.
    for (const k in s.soil) {
      const soil = s.soil[k];
      if (soil.crop && soil.watered && !isMature(soil.crop)) {
        soil.crop.days++;
        if (s.restored && !isMature(soil.crop) && this.rng() < C.BLESSING_CHANCE) soil.crop.days++;
      }
      soil.watered = false;
    }

    // Weather.
    s.weather = s.tomorrow;
    s.tomorrow = this.rng() < C.SUNSHOWER_CHANCE ? 'sunshower' : 'clear';
    if (s.weather === 'sunshower') for (const k in s.soil) s.soil[k].watered = true;

    // Sprinklers water the 8 tiles around them.
    for (let i = 0; i < w.obj.length; i++) {
      if (w.obj[i] !== 'sprinkler') continue;
      const x = i % w.w, y = (i - x) / w.w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const so = s.soil[this.idx(x + dx, y + dy)];
          if (so) so.watered = true;
        }
      }
    }

    this.spawnWeeds(C.WEEDS_PER_NIGHT);
    this.spawnForage(5);
    s.player = this.spawnPlayer();
    this.updateNpcVisibility(true);
    this.changed();
  };

  Game.prototype.spawnWeeds = function (n) {
    const s = this.state, w = this.world, F = World.FARM;
    for (let k = 0, tries = 0; k < n && tries < 60; tries++) {
      const x = F.x0 + Math.floor(this.rng() * (F.x1 - F.x0 + 1));
      const y = F.y0 + Math.floor(this.rng() * (F.y1 - F.y0 + 1));
      const i = this.idx(x, y);
      if (!World.isFarmable(w, x, y) || w.obj[i] || s.soil[i] || World.nearPath(w, x, y, 1)) continue;
      w.obj[i] = 'weed';
      k++;
    }
  };

  Game.prototype.spawnForage = function (n) {
    const w = this.world;
    let count = 0;
    for (const o of w.obj) if (o === 'poppy' || o === 'glowcap') count++;
    n = Math.min(n, C.MAX_FORAGE - count);
    const southY = World.RIVER.y1 + 1;
    for (let k = 0, tries = 0; k < n && tries < 200; tries++) {
      const x = 2 + Math.floor(this.rng() * (w.w - 4));
      const y = 2 + Math.floor(this.rng() * (w.h - 4));
      const i = this.idx(x, y);
      if (w.ground[i] !== World.G.GRASS || w.obj[i] || World.inFarm(x, y) || World.structureAt(w, x, y)) continue;
      if (World.nearPath(w, x, y, 0)) continue;
      const south = y > southY;
      w.obj[i] = this.rng() < (south ? 0.7 : 0.1) ? 'glowcap' : 'poppy';
      k++;
    }
  };

  GHV.Game = Game;
  GHV.Rules = {
    cropTotalDays: cropTotalDays,
    cropStage: cropStage,
    isMature: isMature,
    sellPrice: sellPrice,
    calendar: calendar,
    FACING: FACING,
  };
})(window.GHV = window.GHV || {});
