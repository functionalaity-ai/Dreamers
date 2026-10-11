// Battle Royale: 16 players (you and 15 bots, every one their own team) drop from a plane over the
// map, loot what they can, and fight inside a shrinking zone until one is left.
import * as THREE from 'three';
import { Game } from './game.js';
import { Physics } from '../core/physics.js';
import { NavGraph } from '../world/navmesh.js';
import { Effects } from '../world/effects.js';
import { Ballistics } from '../weapons/ballistics.js';
import { Viewmodel } from '../weapons/viewmodel.js';
import { WeaponState } from '../weapons/weapon.js';
import { Player } from '../characters/player.js';
import { buildBRMap, BR_BOUNDS } from '../world/br/brmap.js';
import { Drop } from './drop.js';
import { Zone, ZONE_TOTAL } from './zone.js';
import { LootWorld, Inventory, ITEMS, CALIBRE, KIND_NAMES, itemLabel, weaponRank, applyItem, tickBoost } from './loot.js';
import { BRBot } from './brbot.js';
import { MATCH, DIFFICULTY } from '../config.js';
import { SUN_DIR } from '../core/renderer.js';

export const BR_PLAYERS = 16;
export const PLANE_ALT = 420;
const NAMES = ['Reyes', 'Kowalski', 'Okafor', 'Dragan', 'Ilya', 'Marek', 'Bogdan', 'Hale', 'Novak', 'Petrov', 'Sato', 'Varga', 'Lindqvist', 'Moreau', 'Adeyemi'];
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

export class BRGame extends Game {
  constructor(renderer, mats, audio) {
    super(renderer, mats, audio);
    this.mode = 'br';
    this.rules = Object.assign({}, MATCH, { spawnProtect: 0 });
    this.proneKey = 'KeyX';           // Z is the armor plate in Battle Royale
    this.noRegen = true;              // health comes back only from heals
    this.all = [];
    this.scores = { msg: 0, volk: 0 };
    this.timeLeft = ZONE_TOTAL;
    this.use = null;
    this.eBlock = false;
    if (typeof window !== 'undefined') window.addEventListener('keyup', (e) => { if (e.code === 'KeyE') this.eBlock = false; });
  }

  load() {
    const B = BR_BOUNDS;
    const ph = new Physics(B.minX, B.minZ, B.maxX, B.maxZ);
    this.physics = ph;
    const before = new Set(this.scene.children);
    this.map = buildBRMap(ph, this.mats, this.scene, { preset: this.preset });
    const b = this.bounds = this.map.bounds || B;
    // The map is static (cached shadow, no matrix updates), except the containers, which animate.
    const dyn = new Set((this.map.containers || []).map((c) => c.object));
    this.R.freezeStatic(this.scene.children.filter((o) => !before.has(o) && !dyn.has(o)));
    this.map.indoor = (this.map.indoor || []).map((v) => (v.min ? v : { min: [v.x0, v.y0, v.z0], max: [v.x1, v.y1, v.z1] }));
    this.map.points = this.map.points || [];
    // Invisible walls round the edge of the map
    const fl = { boundary: true };
    ph.add(b.minX, 0, b.minZ, b.maxX, 60, b.minZ + 1, 'concrete', fl); ph.add(b.minX, 0, b.maxZ - 1, b.maxX, 60, b.maxZ, 'concrete', fl);
    ph.add(b.minX, 0, b.minZ, b.minX + 1, 60, b.maxZ, 'concrete', fl); ph.add(b.maxX - 1, 0, b.minZ, b.maxX, 60, b.maxZ, 'concrete', fl);
    // interior lamps: a dozen at most (each point light costs every lit pixel)
    for (const l of (this.map.lights || []).slice(0, 12)) {
      const pl = new THREE.PointLight(0xffd29a, 7, 11, 2);
      pl.position.copy(l);
      this.scene.add(pl);
    }
    for (const s of this.map.signs || []) this.addSign(s);
    this.nav = new NavGraph(ph, b).build(this.map.hints || [], { minX: b.minX + 1.5, maxX: b.maxX - 1.5, minZ: b.minZ + 1.5, maxZ: b.maxZ - 1.5 });
    this.groundNodes = this.nav.nodes.filter((n) => n.ok && n.p.y < 0.5);
    this.effects = new Effects(this.scene, ph, this.mats, this.audio);
    this.ballistics = new Ballistics(this);
    this.vm = new Viewmodel(this.R, this.mats, this.effects, this.audio);
    this.player = new Player(this);
    this.player.team = 'ffa0';
    this.player.inv = new Inventory();
    this.all.push(this.player);
    for (let i = 0; i < BR_PLAYERS - 1; i++) {
      const bot = new BRBot(this, { name: NAMES[i % NAMES.length], team: 'ffa' + (i + 1), faction: i % 2 ? 'volk' : 'msg', seed: (i + 3) * 7919 });
      bot.h.group.visible = false;
      this.bots.push(bot);
      this.all.push(bot);
    }
    this.characters = this.all.slice();
    this.zone = new Zone(this, { pickCenter: (cur, r) => this.zoneCenter(cur, r) });
    this.loot = new LootWorld(this);
    this.drop = new Drop(this);
    this.drop.onLand = (c) => this.onLand(c);
    this.laser = this.makeLaser();
    // reflection probe over the middle of the map
    const pr = this.map.probe;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    this.probeSpot = pr
      ? { pos: new THREE.Vector3().fromArray(pr.pos), box: new THREE.Box3(new THREE.Vector3().fromArray(pr.box[0]), new THREE.Vector3().fromArray(pr.box[1])) }
      : { pos: new THREE.Vector3(cx, 3.2, cz), box: new THREE.Box3(new THREE.Vector3(b.minX + 4, -0.2, b.minZ + 4), new THREE.Vector3(b.maxX - 4, 30, b.maxZ - 4)) };
  }

  // Next zone centres sit on walkable ground, so the last circle can't close inside a building.
  zoneCenter(cur, r) {
    const room = Math.max(0, cur.r - r) * 0.92;
    const pool = this.groundNodes;
    for (let i = 0; i < 40 && pool.length; i++) {
      const n = pool[Math.floor(Math.random() * pool.length)];
      if (Math.hypot(n.p.x - cur.x, n.p.z - cur.z) <= room) return { x: n.p.x, z: n.p.z };
    }
    return null;
  }

  // --- match flow ------------------------------------------------------------------------------
  start(loadout, difficultyKey) {
    this.difficulty = DIFFICULTY[difficultyKey] || DIFFICULTY.regular;
    this.over = false;
    this.winner = null;
    this.result = null;
    this.state = 'playing';
    this.t0 = this.time;
    this.respawns = [];
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades = [];
    this.ballistics.list = [];
    this.claims.clear();
    for (const c of this.all) { Object.assign(c.stats, { kills: 0, deaths: 0, score: 0, shots: 0, hits: 0, hs: 0, dmg: 0 }); c.place = null; c.diedAt = null; }
    this.zone.reset();
    this.loot.reset();
    this.use = null;
    this.landedAt = null;
    this.streak = 0;
    this.lastKillT = -99;
    this.zoneTick = 0;
    // you: the pistol and one spare magazine
    const p = this.player;
    p.loadout = { name: 'Drop kit', primary: 'warden', secondary: 'warden', att: {} };
    p.spawn(_v.set(0, PLANE_ALT, 0), 0);
    p.inv.reset();
    p.weapons = [null, new WeaponState('warden', {})];
    p.cur = 1;
    p.inv.ammo['9mm'] = p.ws.stats.mag;
    p.ws.reserve = p.inv.ammo['9mm'];
    p.frags = 0; p.armor = 0; p.boost = 0;
    this.vm.setWeapon(p.ws);
    this.showViewmodel(false);
    for (const bot of this.bots) {
      bot.brSpawn(_v.set(0, PLANE_ALT, 0), 0);
      bot.h.group.visible = false;
    }
    this.path = this.planePath();
    this.drop.begin(this.path, this.all.slice());
    for (const bot of this.bots) this.drop.plan(bot, this.landingTarget());
    this.characters = [];
    this.timeLeft = ZONE_TOTAL;
    this.hud.reset();
    if (this.brhud) this.brhud.reset();
    this.hud.banner('Battle Royale', BR_PLAYERS + ' players · last one standing');
  }

  // A straight flight line across the map at altitude, in a random direction.
  planePath() {
    const b = this.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, hx = (b.maxX - b.minX) / 2, hz = (b.maxZ - b.minZ) / 2;
    const ang = Math.random() * Math.PI * 2;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const off = (Math.random() - 0.5) * 0.6 * Math.min(hx, hz);
    const ox = cx - dz * off, oz = cz + dx * off;
    const L = Math.max(hx, hz) * 1.25;
    return { a: new THREE.Vector3(ox - dx * L, PLANE_ALT, oz - dz * L), b: new THREE.Vector3(ox + dx * L, PLANE_ALT, oz + dz * L) };
  }

  // Bots pick a landmark or a building to land at (landmarks and enterable buildings weigh more),
  // snapped onto walkable ground.
  landingTarget() {
    const m = this.map, opts = [];
    for (const l of m.landmarks || []) opts.push({ x: l.x, z: l.z, w: 3 });
    for (const bd of m.buildings || []) {
      if (bd.destroyed) continue;
      const area = Math.abs((bd.x1 - bd.x0) * (bd.z1 - bd.z0));
      opts.push({ x: (bd.x0 + bd.x1) / 2, z: (bd.z0 + bd.z1) / 2, w: (bd.enterable ? 2.5 : 0.4) * Math.min(2, Math.sqrt(area) / 12) });
    }
    let sum = 0;
    for (const o of opts) sum += o.w;
    let r = Math.random() * sum, pick = opts[0];
    for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    const b = this.bounds;
    const t = pick ? { x: pick.x + (Math.random() - 0.5) * 16, z: pick.z + (Math.random() - 0.5) * 16 } : { x: b.minX + Math.random() * (b.maxX - b.minX), z: b.minZ + Math.random() * (b.maxZ - b.minZ) };
    let n = this.nav.nearest(_v.set(t.x, 0, t.z), 10);
    if (!n && this.groundNodes.length) {
      let bd = Infinity;
      for (let i = 0; i < 200; i++) { const q = this.groundNodes[Math.floor(Math.random() * this.groundNodes.length)]; const d = Math.hypot(q.p.x - t.x, q.p.z - t.z); if (d < bd) { bd = d; n = q; } }
    }
    return n ? { x: n.p.x, z: n.p.z } : t;
  }

  onLand(c) {
    c.body.v.set(0, 0, 0);
    c.body.grounded = true;
    if (c === this.player) {
      this.landedAt = this.time;
      this.showViewmodel(true);
      this.vm.setWeapon(c.ws);
      this.vm.startDraw();
      this.hud.notice('Landed · loot up');
      if (this.brhud) this.brhud.landed();
      return;
    }
    c.landT = this.time;
    c.lastPos.copy(c.body.p);
    c.path = null; c.goal = null; c.direct = false;
    c.setState('advance');
    c.h.group.position.copy(c.body.p);
    c.h.group.visible = true;
  }

  alive() { let n = 0; for (const c of this.all) if (c.alive) n++; return n; }

  kill(attacker, victim, info) {
    victim.stats.deaths++;
    for (const [k, v] of this.claims) if (v === victim) this.claims.delete(k);
    if (attacker && attacker !== victim) {
      attacker.stats.kills++;
      attacker.stats.score += 100 + (info.zone === 'head' ? 50 : 0);
      if (info.zone === 'head') attacker.stats.hs++;
    }
    this.hud.killfeed(attacker, victim, info);
    if (attacker === this.player && victim !== this.player) {
      this.streak = this.time - (this.lastKillT ?? -99) < 4 ? (this.streak || 1) + 1 : 1;
      this.lastKillT = this.time;
      this.hud.confirmKill(victim, info, 100 + (info.zone === 'head' ? 50 : 0), this.streak);
    }
    const left = this.alive();
    victim.place = left + 1;
    victim.diedAt = this.time;
    this.use = victim === this.player ? null : this.use;
    this.loot.dropBox(victim, this.gearOf(victim));
    if (this.brhud) this.brhud.eliminated(victim, attacker, left);
    if (victim === this.player) {
      this.hud.killer = attacker;
      this.end(false);
    } else if (left <= 1 && this.player.alive) {
      this.player.place = 1;
      this.end(true);
    }
  }

  gearOf(c) {
    if (c !== this.player) return c.gear ? c.gear() : [];
    const out = [];
    for (const w of c.weapons) if (w) out.push({ type: 'weapon', id: w.id, att: Object.assign({}, w.stats.att), mag: w.mag });
    c.inv.items.frag = c.frags;
    return out.concat(c.inv.dump());
  }

  end(won) {
    if (this.over) return;
    this.over = true;
    this.state = 'over';
    const p = this.player;
    this.winner = won ? p.team : 'field';
    this.result = { won, place: won ? 1 : p.place || this.alive() + 1, of: BR_PLAYERS, kills: p.stats.kills, dmg: Math.round(p.stats.dmg || 0), time: ((p.diedAt ?? this.time) - this.t0) };
    this.hud.matchOver(this.result);
  }

  // --- combat --------------------------------------------------------------------------------
  onHit(char, dmg, info) {
    const wasAlive = char.alive;
    const dealt = char.takeDamage(dmg, info);
    if (dealt <= 0) return;
    if (info.attacker) { info.attacker.stats.hits++; info.attacker.stats.dmg = (info.attacker.stats.dmg || 0) + dealt; }
    if (char === this.player && this.use) { this.use = null; this.hud.notice('Interrupted'); }
    if (char.heal) char.heal = null;
    this.effects.bloodHit(info.point, info.dir);
    const behind = this.physics.raycast(info.point, info.dir, 2.5);
    if (behind) this.effects.splat(behind.point, behind.normal);
    const killed = wasAlive && !char.alive;
    if (info.attacker === this.player) {
      this.hud.hitmarker(info.zone === 'head', killed);
      this.audio.foley(killed ? 'kill' : info.zone === 'head' ? 'headshot' : 'hit');
    }
    if (killed) this.kill(info.attacker, char, info);
  }

  noise(pos, radius, source) {
    for (const b of this.bots) {
      if (!b.alive || b.team === source.team || this.drop.state(b) !== 'landed') continue;
      if (b.body.p.distanceTo(pos) < radius) b.hear(pos, source);
    }
  }

  // Outside the zone: damage once a second, more each phase, straight to health.
  zoneDamage(dt) {
    this.zoneTick += dt;
    if (this.zoneTick < 1) return;
    this.zoneTick -= 1;
    const dps = this.zone.dps;
    for (const c of this.characters) {
      if (!c.alive || this.zone.inside(c.body.p)) continue;
      const info = { zone: 'stomach', dir: _d.set(0, -1, 0).clone(), point: c.body.p.clone(), attacker: null, weapon: { name: 'Zone' }, zoneDamage: true };
      const wasAlive = c.alive;
      c.takeDamage(dps, info);
      if (c === this.player && this.use) { this.use = null; this.hud.notice('Interrupted'); }
      if (wasAlive && !c.alive) this.kill(null, c, info);
    }
  }

  // --- the player's loot and heals -----------------------------------------------------------
  emptySlot(p) { return p.weapons[0] ? (p.weapons[1] ? -1 : 1) : 0; }

  // Equip a gun item (an empty slot first, else in place of the one in hand). Returns the gun given up.
  giveWeapon(p, it) {
    const slot = this.emptySlot(p) >= 0 ? this.emptySlot(p) : p.cur;
    const old = p.weapons[slot];
    const ws = new WeaponState(it.id, it.att);
    if (it.mag !== undefined) ws.mag = Math.min(ws.stats.mag, it.mag);
    ws.reserve = p.inv.ammo[CALIBRE[it.id]];
    p.weapons[slot] = ws;
    p.cur = slot;
    this.use = null;
    this.vm.setWeapon(ws);
    this.vm.startDraw();
    if (this.hud.icons) this.hud.icons.render(ws.id, ws.stats.att);
    this.hud.refreshAmmo();
    this.hud.notice(ws.stats.name);
    return old ? { type: 'weapon', id: old.id, att: Object.assign({}, old.stats.att), mag: old.mag } : null;
  }

  // Consumables and ammo; returns what didn't fit.
  giveItem(p, it) {
    if (it.type === 'frag') {
      const room = ITEMS.frag.stack - p.frags;
      const take = Math.max(0, Math.min(room, it.n));
      p.frags += take; p.inv.items.frag = p.frags;
      return it.n - take;
    }
    return p.inv.add(it);
  }

  // Take everything that fits. Guns only go into an empty slot (swap them with F or a click).
  takeAll(src) {
    const p = this.player, items = src.kind === 'box' ? src.items : this.loot.contents(src);
    let took = 0, full = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type === 'weapon') {
        if (this.emptySlot(p) < 0) continue;
        this.giveWeapon(p, it);
        items.splice(i--, 1); took++;
        continue;
      }
      const left = this.giveItem(p, it);
      if (left < it.n) took++;
      if (left > 0) { it.n = left; full = true; } else items.splice(i--, 1);
    }
    if (took) this.audio.foley('click');
    if (full) this.hud.notice('Inventory full');
    this.loot.tidy(src);
    return took;
  }

  // Take one item from a container or crate (a gun swaps with the one in hand).
  takeOne(src, i) {
    const p = this.player, items = src.kind === 'box' ? src.items : this.loot.contents(src);
    const it = items[i];
    if (!it) return;
    if (it.type === 'weapon') {
      const old = this.giveWeapon(p, it);
      items.splice(i, 1);
      if (old) items.push(old);
    } else {
      const left = this.giveItem(p, it);
      if (left >= it.n) this.hud.notice('Inventory full');
      if (left > 0) it.n = left; else items.splice(i, 1);
    }
    this.audio.foley('click');
    this.loot.tidy(src);
  }

  pickUp(q) {
    const p = this.player, it = q.item;
    if (it.type === 'weapon') {
      const old = this.giveWeapon(p, it);
      this.loot.removePickup(q);
      if (old) this.loot.addPickup(old, q.pos);
    } else {
      const left = this.giveItem(p, it);
      if (left >= it.n) { this.hud.notice('Inventory full'); return; }
      if (left > 0) { q.item.n = left; this.loot.place(q); } else this.loot.removePickup(q);
      this.hud.notice(itemLabel(Object.assign({}, it, { n: it.n - left })));
    }
    this.audio.foley('click');
  }

  // The interaction prompt and what E / F do.
  interact(input) {
    const p = this.player, cam = this.camera;
    const dir = cam.getWorldDirection(_d);
    const t = this.loot.target(cam.position, dir, p.body.p);
    this.look = t;
    let panel = null;
    if (t && (t.type === 'box' || (t.type === 'container' && t.ref.opened && t.ref.items && t.ref.items.length))) panel = t.ref;
    // keep the panel of what we just opened while we stay next to it
    if (!panel && this.panel && Math.hypot(this.panel.pos.x - p.body.p.x, this.panel.pos.z - p.body.p.z) < 2.2 && this.panel.items && this.panel.items.length && (this.panel.kind !== 'box' || this.loot.boxes.includes(this.panel))) panel = this.panel;
    this.panel = panel;
    const pressE = input.pressed('KeyE') && !this.eBlock;
    if (t && input.down('KeyE')) { this.eBlock = true; input.keys.delete('KeyE'); }   // E loots instead of leaning
    if (this.eBlock) input.keys.delete('KeyE');
    if (pressE && t) {
      if (t.type === 'container' && !t.ref.opened) {
        t.ref.open();
        this.loot.contents(t.ref);
        this.audio.foley('click');
        this.panel = t.ref;
        if (!t.ref.items.length) { this.hud.notice('Empty'); this.loot.tidy(t.ref); }
      } else if (t.type === 'pickup') this.pickUp(t.ref);
      else this.takeAll(t.ref);
    } else if (pressE && this.panel) this.takeAll(this.panel);
    if (input.pressed('KeyF') && this.panel) {
      const i = this.panel.items.findIndex((it) => it.type === 'weapon');
      if (i >= 0) this.takeOne(this.panel, i);
    }
  }

  // Heals (H or 4) and plates (Z): a few seconds each, cancelled by sprinting, firing, jumping or switching.
  handleUse(dt, input) {
    const p = this.player, inv = p.inv;
    const heal = input.pressed('KeyH') || input.pressed('Digit4'), plate = input.pressed('KeyZ');
    if (this.use) {
      const stop = p.sprint || input.mouse.left || input.pressed('Space') || input.pressed('Digit1') || input.pressed('Digit2') || input.mouse.wheel || ((heal || plate) && this.use.t > 0.15);
      if (stop) { this.use = null; this.hud.notice('Cancelled'); return; }
      this.use.t += dt;
      if (this.use.t >= this.use.dur) {
        if (inv.items[this.use.type] > 0 && applyItem(p, this.use.type)) inv.items[this.use.type]--;
        this.audio.foley(this.use.type === 'plate' ? 'land' : 'click');
        this.use = null;
      }
      return;
    }
    let type = null;
    if (heal) {
      type = inv.bestHeal(p.health);
      if (!type) this.hud.notice(p.health >= 100 ? 'Health full' : inv.items.bandage && p.health >= 75 ? 'Bandages heal to 75' : 'No heals');
    } else if (plate) {
      if (!inv.items.plate) this.hud.notice('No armor plates');
      else if (p.armor >= 100) this.hud.notice('Armor full');
      else type = 'plate';
    }
    if (type) { this.use = { type, t: 0, dur: ITEMS[type].use }; this.audio.foley('pin'); }
  }

  playerTurn(dt, input, settings) {
    const p = this.player, inv = p.inv;
    for (const w of p.weapons) if (w) w.reserve = inv.ammo[CALIBRE[w.id]];
    p.frags = inv.items.frag;
    tickBoost(p, dt);
    this.interact(input);
    this.handleUse(dt, input);
    // empty weapon slots can't be switched to
    if (input.mouse.wheel && !p.weapons[1 - p.cur]) input.mouse.wheel = 0;
    if (input.pressed('Digit1') && !p.weapons[0]) input.consume('Digit1');
    if (input.pressed('Digit2') && !p.weapons[1]) input.consume('Digit2');
    p.update(dt, input, settings);
    if (p.ws) inv.ammo[CALIBRE[p.ws.id]] = p.ws.reserve;
    inv.items.frag = p.frags;
  }

  // --- per frame -------------------------------------------------------------------------------
  update(dt, input, settings) {
    if (this.state !== 'playing' && this.state !== 'over') return;
    this.time += dt;
    const p = this.player, drop = this.drop;
    this.characters = this.all.filter((c) => drop.state(c) === 'landed');
    const landed = drop.state(p) === 'landed';
    if (this.state === 'playing') {
      this.zone.update(dt, this.camera, landed && p.alive && !this.zone.inside(p.body.p));
      this.timeLeft = Math.max(0, ZONE_TOTAL - (this.time - this.t0));
    } else this.zone.update(0, this.camera, false);
    if (drop.state(p) === 'plane' && p.alive && (input.pressed('Space') || input.pressed('KeyF'))) { drop.jump(p); input.consume('Space'); input.consume('KeyF'); }
    if (drop.active) drop.update(dt, input);
    if (landed && p.alive && this.state === 'playing') this.playerTurn(dt, input, settings);
    else if (!p.alive) this.deathCam(dt);
    for (const b of this.bots) {
      const st = drop.state(b);
      if (st !== 'landed') { if (st === 'plane') b.h.group.visible = false; continue; }
      if (b.evade > 0) b.evade -= dt;
      b.update(dt);
    }
    if (this.state === 'playing') this.zoneDamage(dt);
    this.updateGrenades(dt);
    this.ballistics.update(dt);
    this.effects.update(dt, this.camera);
    this.updateLaser();
    this.loot.update(dt, this.camera);
    if (this.map.update) this.map.update(this.camera, dt);
    if (this.shake > 0.001) {
      this.camera.rotation.x += (Math.random() - 0.5) * this.shake * 0.04;
      this.camera.rotation.y += (Math.random() - 0.5) * this.shake * 0.04;
      this.shake *= Math.exp(-dt * 5);
    }
    const ws = p.ws;
    this.camera.fov = settings.fov * (landed ? 1 - this.vm.adsT * (1 - ws.stats.zoomFov) : 1);
    if (landed && ws.stats.scoped) this.camera.fov *= 1 - this.vm.adsT * 0.08;
    this.camera.updateProjectionMatrix();
    const indoor = this.isIndoor(p.body.p) ? 1 : 0;
    this.indoorF += (indoor - this.indoorF) * Math.min(1, dt * 3);
    this.R.setIndoor(this.indoorF);
    const sunHit = this.physics.raycast(this.camera.position, SUN_DIR, 160, (bx) => !bx.flags.boundary);
    const sunTarget = sunHit ? 0 : this.R.cloudShadeAt(this.camera.position);
    this.sunF = this.sunF === undefined ? sunTarget : this.sunF + (sunTarget - this.sunF) * Math.min(1, dt * 5);
    this.R.setViewSun(this.sunF);
    this.audio.setListener(this.camera);
    if (this.brhud) this.brhud.update(dt, input);
  }

  // The menu backdrop: a slow orbit high over the map.
  menuView(cam, t) {
    const b = this.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, r = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.55;
    const a = t * 0.03;
    cam.position.set(cx + Math.cos(a) * r, r * 0.55, cz + Math.sin(a) * r);
    cam.fov = 50;
    cam.updateProjectionMatrix();
    cam.lookAt(cx, 0, cz);
  }
}

export { KIND_NAMES, weaponRank };
