// Headless tests for the game core. Run with: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load the DOM-free scripts into a sandbox that stands in for `window`.
function loadCore() {
  const sandbox = { console: console, Math: Math, Date: Date, JSON: JSON };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['config.js', 'util.js', 'world.js', 'inventory.js', 'game.js']) {
    const file = path.join(__dirname, '..', 'src', f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  return sandbox.GHV;
}

const GHV = loadCore();
const { World, Inventory: Inv, Rules, CONFIG: C } = GHV;
const T = C.TILE;

function freshGame(seed) {
  const g = new GHV.Game().newGame(seed === undefined ? 42 : seed);
  g.events = [];
  for (const e of ['toast', 'dialog', 'openShop', 'openOffering', 'confirmSleep', 'dayEnd', 'restored']) {
    g.on(e, (d) => g.events.push({ e, d }));
  }
  return g;
}

// Put the player on tile (x, y) facing a direction and select an item.
function stand(g, x, y, facing) {
  g.state.player.x = x * T + 8;
  g.state.player.y = y * T + 12;
  g.state.player.facing = facing || 'right';
  g.state.player.toolT = 0;
}
function hold(g, id) {
  let slot = g.state.inv.findIndex((s) => s && s.id === id);
  if (slot === -1) {
    Inv.add(g.state.inv, id, 1);
    slot = g.state.inv.findIndex((s) => s && s.id === id);
  }
  if (slot >= C.HOTBAR_SIZE) {
    Inv.moveSlot(g.state.inv, slot, 9);
    slot = 9;
  }
  g.selectSlot(slot);
}
function act(g, x, y) {
  g.state.player.toolT = 0;
  g.act(x, y);
}
// Objects created inside the sandbox have a different realm; compare plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));

// A tile in the middle of a clear 5x3 patch of farmland (debris removed).
function findPlot(g) {
  const w = g.world;
  for (let y = 11; y < 27; y++) {
    for (let x = 16; x < 27; x++) {
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) ok = World.isFarmable(w, x + dx, y + dy);
      if (!ok) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) w.obj[(y + dy) * w.w + x + dx] = null;
      return { x, y };
    }
  }
  throw new Error('no plot');
}

test('map: key places are reachable from the spawn point', () => {
  const g = freshGame();
  const w = g.world;
  const from = w.spawn;
  assert.equal(World.isSolid(w, from.x, from.y), false, 'spawn is walkable');
  const lantern = w.structures.find((s) => s.type === 'lantern');
  const stall = w.structures.find((s) => s.type === 'stall');
  assert.ok(World.reachable(w, from, { x: 7, y: 6 }), 'farmhouse door');
  assert.ok(World.reachable(w, from, { x: 11, y: 6 }), 'shipping bin');
  assert.ok(World.reachable(w, from, { x: stall.x + 2, y: stall.y + stall.h - 1 }), "Mabel's counter");
  assert.ok(World.reachable(w, from, { x: lantern.x, y: lantern.y + lantern.h - 1 }), 'the Great Lantern');
  assert.ok(World.reachable(w, from, { x: 44, y: 40 }), 'south meadow across the bridge');
  assert.ok(World.reachable(w, from, { x: 6, y: 24 }), 'farm pond');
});

test('map: NPC homes are walkable', () => {
  const g = freshGame();
  for (const n of g.npcs) {
    if (n.id === 'mabel') continue;
    const tx = Math.floor(n.x / T), ty = Math.floor(n.y / T);
    assert.equal(World.isSolid(g.world, tx, ty), false, n.id + ' home tile');
  }
});

test('inventory: stacking, removal and swapping', () => {
  const inv = Inv.create(4);
  assert.equal(Inv.add(inv, 'sunwheat', 120), 0);
  assert.deepEqual(plain(inv.map((s) => s && s.qty)), [99, 21, null, null]);
  assert.equal(Inv.add(inv, 'hoe', 1), 0);
  assert.equal(Inv.add(inv, 'can', 1), 0);
  assert.equal(Inv.add(inv, 'pickaxe', 1), 1, 'no room left');
  assert.equal(Inv.room(inv, 'sunwheat'), 78);
  assert.equal(Inv.remove(inv, 'sunwheat', 200), false);
  assert.equal(Inv.count(inv, 'sunwheat'), 120, 'failed removal changes nothing');
  assert.equal(Inv.remove(inv, 'sunwheat', 30), true);
  assert.equal(Inv.count(inv, 'sunwheat'), 90);
  Inv.moveSlot(inv, 0, 3);
  assert.equal(inv[0].id, 'can');
  assert.equal(inv[3].id, 'sunwheat');
});

test('farming: till, plant, water, grow and harvest', () => {
  const g = freshGame();
  const p = findPlot(g);
  stand(g, p.x - 1, p.y, 'right');
  const i = g.idx(p.x, p.y);

  hold(g, 'hoe');
  act(g, p.x, p.y);
  assert.ok(g.state.soil[i], 'tilled');
  assert.equal(g.state.energy, C.MAX_ENERGY - GHV.ITEMS.hoe.cost);

  hold(g, 'sunwheat_seed');
  const seeds = Inv.count(g.state.inv, 'sunwheat_seed');
  act(g, p.x, p.y);
  assert.equal(g.state.soil[i].crop.id, 'sunwheat');
  assert.equal(Inv.count(g.state.inv, 'sunwheat_seed'), seeds - 1);

  const total = Rules.cropTotalDays('sunwheat');
  for (let d = 0; d < total; d++) {
    g.state.weather = 'clear';
    hold(g, 'can');
    act(g, p.x, p.y);
    assert.equal(g.state.soil[i].watered, true);
    g.state.tomorrow = 'clear';
    g.sleep(false);
    stand(g, p.x - 1, p.y, 'right');
  }
  assert.ok(Rules.isMature(g.state.soil[i].crop), 'mature after ' + total + ' watered days');
  const before = Inv.count(g.state.inv, 'sunwheat');
  act(g, p.x, p.y);
  assert.ok(Inv.count(g.state.inv, 'sunwheat') > before, 'harvested');
  assert.equal(g.state.soil[i].crop, null, 'single-harvest crop is gone');
  assert.ok(g.state.soil[i], 'soil stays tilled');
});

test('farming: unwatered crops do not grow; sunshowers water everything', () => {
  const g = freshGame();
  const p = findPlot(g);
  const i = g.idx(p.x, p.y);
  g.state.soil[i] = { watered: false, crop: { id: 'amber_carrot', days: 0 } };
  g.state.tomorrow = 'clear';
  g.sleep(false);
  assert.equal(g.state.soil[i].crop.days, 0);
  g.state.tomorrow = 'sunshower';
  g.sleep(false);
  assert.equal(g.state.weather, 'sunshower');
  assert.equal(g.state.soil[i].watered, true, 'rain waters the soil for today');
  g.sleep(false);
  assert.equal(g.state.soil[i].crop.days, 1);
});

test('farming: duskberries regrow after harvest', () => {
  const g = freshGame();
  const p = findPlot(g);
  const i = g.idx(p.x, p.y);
  const total = Rules.cropTotalDays('duskberry');
  g.state.soil[i] = { watered: false, crop: { id: 'duskberry', days: total } };
  stand(g, p.x - 1, p.y, 'right');
  act(g, p.x, p.y);
  assert.ok(Inv.count(g.state.inv, 'duskberry') >= 2);
  assert.equal(g.state.soil[i].crop.days, total - GHV.CROPS.duskberry.regrow);
  assert.equal(Rules.isMature(g.state.soil[i].crop), false);
});

test('crop stages advance with watered days', () => {
  const crop = { id: 'ember_pumpkin', days: 0 };
  const stages = [];
  for (let d = 0; d <= Rules.cropTotalDays('ember_pumpkin'); d++) {
    crop.days = d;
    stages.push(Rules.cropStage(crop));
  }
  assert.deepEqual(stages, [0, 0, 1, 1, 1, 2, 2, 2, 2, 3]);
});

test('tools: sickle clears weeds, pickaxe breaks rocks, can refills at water', () => {
  const g = freshGame();
  const p = findPlot(g);
  const i = g.idx(p.x, p.y);
  stand(g, p.x - 1, p.y, 'right');
  g.world.obj[i] = 'weed';
  hold(g, 'hoe');
  act(g, p.x, p.y);
  assert.equal(g.state.soil[i], undefined, "can't till over weeds");
  hold(g, 'sickle');
  act(g, p.x, p.y);
  assert.equal(g.world.obj[i], null);
  g.world.obj[i] = 'rock';
  hold(g, 'pickaxe');
  act(g, p.x, p.y);
  assert.equal(g.world.obj[i], null);
  assert.ok(Inv.count(g.state.inv, 'stone') >= 1);

  g.state.canWater = 0;
  stand(g, 6, 23, 'down');
  hold(g, 'can');
  act(g, 6, 24);
  assert.ok(World.isWater(g.world, 6, 24));
  assert.equal(g.state.canWater, g.canCapacity());
});

test('energy: tools stop working when exhausted; food restores it', () => {
  const g = freshGame();
  const p = findPlot(g);
  stand(g, p.x - 1, p.y, 'right');
  g.state.energy = 1;
  hold(g, 'hoe');
  act(g, p.x, p.y);
  assert.equal(g.state.soil[g.idx(p.x, p.y)], undefined);
  hold(g, 'honey_bun');
  assert.equal(g.eat(), true);
  assert.equal(g.state.energy, 1 + GHV.ITEMS.honey_bun.energy);
  hold(g, 'sickle');
  assert.equal(g.eat(), false, 'tools are not food');
});

test('shipping pays out overnight', () => {
  const g = freshGame();
  Inv.add(g.state.inv, 'honey_melon', 3);
  hold(g, 'honey_melon');
  stand(g, 11, 7, 'up');
  const gold = g.state.gold;
  act(g, 11, 6);
  assert.equal(Inv.count(g.state.inv, 'honey_melon'), 0);
  assert.equal(g.state.gold, gold, 'not paid yet');
  const sum = g.sleep(false);
  assert.equal(sum.earned, 3 * GHV.ITEMS.honey_melon.sell);
  assert.equal(g.state.gold, gold + sum.earned);
  hold(g, 'hoe');
  act(g, 11, 6);
  assert.equal(Inv.count(g.state.inv, 'hoe'), 1, 'tools cannot be shipped');
});

test('shop: buying seeds and upgrades', () => {
  const g = freshGame();
  g.state.gold = 100;
  assert.equal(g.buy('carrot_seed', 5).ok, true);
  assert.equal(g.state.gold, 0);
  assert.equal(g.buy('carrot_seed', 1).ok, false);
  g.state.gold = 5000;
  assert.equal(g.buyUpgrade('can2').ok, false, 'needs copper first');
  assert.equal(g.buyUpgrade('can1').ok, true);
  assert.equal(g.canCapacity(), 45);
  assert.equal(g.state.canWater, 45);
  assert.equal(g.buyUpgrade('can1').ok, false, 'only once');
  assert.equal(g.buyUpgrade('can2').ok, true);
  assert.equal(g.canCapacity(), 80);
  const max = g.state.maxEnergy;
  assert.equal(g.buyUpgrade('energy1').ok, true);
  assert.equal(g.state.maxEnergy, max + 30);
});

test('shop is only open during the day', () => {
  const g = freshGame();
  const stall = g.world.structures.find((s) => s.type === 'stall');
  g.state.time = 10 * 60;
  act(g, stall.x + 2, stall.y + stall.h - 1);
  assert.ok(g.events.some((e) => e.e === 'openShop'));
  g.events = [];
  g.state.time = 21 * 60;
  act(g, stall.x + 2, stall.y + stall.h - 1);
  assert.ok(!g.events.some((e) => e.e === 'openShop'));
  assert.ok(g.events.some((e) => e.e === 'dialog'));
});

test('sprinklers water the 8 tiles around them each morning', () => {
  const g = freshGame();
  const p = findPlot(g);
  const w = g.world;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 2; dx++) g.state.soil[g.idx(p.x + dx, p.y + dy)] = { watered: false, crop: null };
  }
  // Sprinkler goes on the untilled tile left of p; the player stands two tiles left.
  delete g.state.soil[g.idx(p.x - 1, p.y)];
  stand(g, p.x - 2, p.y, 'right');
  hold(g, 'sprinkler');
  act(g, p.x - 1, p.y);
  assert.equal(w.obj[g.idx(p.x - 1, p.y)], 'sprinkler');
  g.state.tomorrow = 'clear';
  g.sleep(false);
  assert.equal(g.state.soil[g.idx(p.x, p.y)].watered, true, 'right neighbour');
  assert.equal(g.state.soil[g.idx(p.x, p.y - 1)].watered, true, 'diagonal neighbour');
  assert.equal(g.state.soil[g.idx(p.x - 1, p.y + 1)].watered, true, 'tile below');
  assert.equal(g.state.soil[g.idx(p.x + 1, p.y)].watered, false, 'two tiles away is out of range');
});

test('passing out at 2 AM costs gold and energy', () => {
  const g = freshGame();
  g.state.gold = 1000;
  g.state.time = C.PASS_OUT - 1;
  g.update(1, { x: 0, y: 0 });
  const sum = g.events.find((e) => e.e === 'dayEnd').d;
  assert.equal(sum.passedOut, true);
  assert.equal(sum.lost, 100);
  assert.equal(g.state.gold, 900);
  assert.equal(g.state.energy, Math.floor(g.state.maxEnergy / 2));
  assert.equal(g.state.day, 2);
  assert.equal(g.state.time, C.DAY_START);
});

test('the Great Lantern offering restores the valley', () => {
  const g = freshGame();
  for (const req of GHV.OFFERING) Inv.add(g.state.inv, req.item, Math.ceil(req.qty / 2));
  assert.ok(g.offerAll() > 0);
  assert.ok(g.offeringProgress() > 0.4 && g.offeringProgress() < 1);
  assert.equal(g.state.restored, false);
  for (const req of GHV.OFFERING) Inv.add(g.state.inv, req.item, req.qty);
  const gold = g.state.gold;
  g.offerAll();
  assert.equal(g.offeringProgress(), 1);
  assert.equal(g.state.restored, true);
  assert.equal(g.state.gold, gold + C.LANTERN_REWARD);
  assert.ok(g.events.some((e) => e.e === 'restored'));
  // Only what was still needed is taken; the rest stays in the bag.
  for (const req of GHV.OFFERING) assert.equal(Inv.count(g.state.inv, req.item), Math.ceil(req.qty / 2));
});

test('save and load round-trip', () => {
  const g = freshGame(7);
  const p = findPlot(g);
  g.state.soil[g.idx(p.x, p.y)] = { watered: true, crop: { id: 'honey_melon', days: 3 } };
  g.world.obj[g.idx(p.x + 1, p.y)] = 'sprinkler';
  g.state.gold = 1234;
  g.state.offering.sunwheat = 5;
  g.state.day = 9;
  const data = JSON.parse(JSON.stringify(g.serialize()));
  const h = new GHV.Game().load(data);
  assert.equal(h.state.gold, 1234);
  assert.equal(h.state.day, 9);
  assert.deepEqual(plain(h.state.soil[g.idx(p.x, p.y)]), { watered: true, crop: { id: 'honey_melon', days: 3 } });
  assert.equal(h.world.obj[g.idx(p.x + 1, p.y)], 'sprinkler');
  assert.equal(h.state.offering.sunwheat, 5);
  assert.deepEqual(plain(h.state.inv), plain(g.state.inv));
  assert.equal(World.encodeObjects(h.world), World.encodeObjects(g.world));
  // Both continue identically.
  g.state.tomorrow = h.state.tomorrow;
  g.sleep(false);
  h.sleep(false);
  assert.equal(World.encodeObjects(h.world), World.encodeObjects(g.world));
});

test('movement: the player cannot walk through solid tiles', () => {
  const g = freshGame();
  stand(g, 7, 8, 'up');
  for (let k = 0; k < 120; k++) g.update(1 / 60, { x: 0, y: -1 });
  const pt = g.playerTile();
  assert.ok(pt.y >= 7, 'stopped by the farmhouse wall, at row ' + pt.y);
  assert.equal(g.state.player.facing, 'up');
});

test('describeTarget explains what the action button will do', () => {
  const g = freshGame();
  assert.equal(g.describeTarget(7, 6), 'Go to bed');
  hold(g, 'sunwheat');
  assert.equal(g.describeTarget(11, 6), 'Ship Sunwheat');
});
