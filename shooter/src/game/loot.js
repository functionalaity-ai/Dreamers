// Battle Royale loot: item types, tier tables for containers and floor spots, the per-character
// inventory, and the loot in the world (ground pickups, container contents, death crates).
import * as THREE from 'three';
import { WEAPONS, ATTACHMENTS } from '../config.js';
import { buildGun, bakeGun } from '../weapons/gunmodels.js';

// --- item data ---------------------------------------------------------------------------------
export const ITEMS = {
  bandage: { name: 'Bandage', kind: 'heal', use: 3, heal: 15, cap: 75, stack: 10 },
  medkit: { name: 'First-aid kit', kind: 'heal', use: 6, heal: 100, cap: 100, stack: 3 },
  painkillers: { name: 'Painkillers', kind: 'boost', use: 4, boost: 40, over: 20, stack: 3 },
  energy: { name: 'Energy drink', kind: 'boost', use: 2, boost: 25, over: 10, stack: 4 },
  plate: { name: 'Armor plate', kind: 'plate', use: 3, armor: 50, stack: 3 },
  frag: { name: 'Frag grenade', kind: 'frag', stack: 3 },
  ammo: { name: 'Ammo', kind: 'ammo' },
  weapon: { name: 'Weapon', kind: 'weapon' },
};
export const MAX_ARMOR = 100;
export const AMMO = {
  '556': { name: '5.56 ammo', box: 30, cap: 300 },
  '9mm': { name: '9 mm ammo', box: 34, cap: 170 },
  '12g': { name: '12-gauge shells', box: 12, cap: 60 },
};
export const CALIBRE = { kestrel: '556', warden: '9mm', bastion: '12g' };
export const KIND_NAMES = {
  fridge: 'Fridge', cabinet: 'Cabinet', dresser: 'Dresser', wardrobe: 'Wardrobe', medcab: 'Medicine cabinet',
  crate: 'Crate', locker: 'Locker', desk: 'Desk', box: 'Supplies',
};
export const TIER_NAMES = ['Common', 'Good', 'Rare'];
const WEAPON_BASE = { warden: 1, bastion: 2.4, kestrel: 3 };

// Weighted tables per container tier (0 common, 1 good, 2 rare): item counts, item weights and how
// many attachments a gun found at this tier carries.
export const TABLES = [
  { count: [1, 2], att: [0, 1], items: { bandage: 26, energy: 8, painkillers: 3, medkit: 4, plate: 9, frag: 5, ammo: 26, warden: 9, bastion: 6, kestrel: 4 } },
  { count: [2, 3], att: [1, 2], items: { bandage: 18, energy: 9, painkillers: 6, medkit: 8, plate: 14, frag: 8, ammo: 20, warden: 4, bastion: 9, kestrel: 9 } },
  { count: [3, 4], att: [2, 4], items: { bandage: 10, energy: 8, painkillers: 9, medkit: 12, plate: 18, frag: 9, ammo: 14, warden: 1, bastion: 9, kestrel: 15 } },
];
// What each kind of container tends to hold (multipliers on the table weights).
const BIAS = {
  medcab: { bandage: 3, medkit: 3, painkillers: 3, energy: 0.5, ammo: 0.15, plate: 0.2, frag: 0.1, warden: 0.1, bastion: 0.05, kestrel: 0.05 },
  fridge: { energy: 5, painkillers: 1.5, ammo: 0.3, plate: 0.3, frag: 0.3, warden: 0.3, bastion: 0.2, kestrel: 0.2 },
  crate: { ammo: 1.5, plate: 1.5, frag: 1.6, kestrel: 1.6, bastion: 1.5, bandage: 0.6 },
  locker: { plate: 1.7, ammo: 1.3, kestrel: 1.3, bastion: 1.3, frag: 1.2 },
  wardrobe: { plate: 1.3, bandage: 1.2, warden: 1.3 },
  desk: { warden: 1.6, ammo: 1.2, painkillers: 1.4 },
};

const pickWeighted = (w, rnd) => {
  let sum = 0;
  for (const k in w) sum += w[k];
  let r = rnd() * sum;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return Object.keys(w)[0];
};
const between = (a, b, rnd) => a + Math.floor(rnd() * (b - a + 1));

// A gun with a few random attachments (one per slot), and sometimes a finish.
export function rollWeapon(id, tier, rnd = Math.random) {
  const T = TABLES[Math.max(0, Math.min(2, tier))];
  const opts = WEAPONS[id].attachments.filter((a) => ATTACHMENTS[a].slot !== 'finish');
  const n = between(T.att[0], T.att[1], rnd);
  const att = {};
  for (let i = 0; i < 12 && Object.keys(att).length < n; i++) {
    const a = opts[Math.floor(rnd() * opts.length)];
    const slot = ATTACHMENTS[a].slot;
    if (!att[slot]) att[slot] = a;
  }
  if (rnd() < 0.3) { const fin = WEAPONS[id].attachments.filter((a) => ATTACHMENTS[a].slot === 'finish'); att.finish = fin[Math.floor(rnd() * fin.length)]; }
  return { type: 'weapon', id, att, tier: Math.min(2, Math.floor(n / 1.5)) };
}

export function ammoItem(cal, boxes = 1) { return { type: 'ammo', cal, n: AMMO[cal].box * boxes }; }

function rollOne(key, tier, rnd) {
  if (WEAPONS[key]) return [rollWeapon(key, tier, rnd), ammoItem(CALIBRE[key])];
  if (key === 'ammo') { const cal = pickWeighted({ '9mm': 4, '556': 4, '12g': 3 }, rnd); return [ammoItem(cal, rnd() < 0.35 ? 2 : 1)]; }
  const n = key === 'bandage' ? between(1, 3, rnd) : key === 'energy' ? between(1, 2, rnd) : 1;
  return [{ type: key, n }];
}

// The contents of a container (kind: 'fridge', 'crate', ...; tier 0..2).
export function rollContainer(tier, kind, rnd = Math.random) {
  const T = TABLES[Math.max(0, Math.min(2, tier))];
  const w = Object.assign({}, T.items);
  const b = BIAS[kind];
  if (b) for (const k in b) if (w[k] !== undefined) w[k] *= b[k];
  const out = [];
  const n = between(T.count[0], T.count[1], rnd);
  for (let i = 0; i < n; i++) out.push(...rollOne(pickWeighted(w, rnd), tier, rnd));
  return merge(out);
}

// One loose item for a floor spot.
export function rollGround(tier, rnd = Math.random) {
  const T = TABLES[Math.max(0, Math.min(2, tier))];
  const items = rollOne(pickWeighted(T.items, rnd), tier, rnd);
  return items;
}

// Stack identical consumables.
export function merge(items) {
  const out = [];
  for (const it of items) {
    const same = it.type !== 'weapon' && out.find((o) => o.type === it.type && o.cal === it.cal);
    if (same) same.n += it.n; else out.push(Object.assign({}, it));
  }
  return out;
}

export function weaponRank(it) {
  if (!it) return 0;
  const att = it.att || {};
  let r = WEAPON_BASE[it.id] || 1;
  for (const k in att) if (k !== 'finish' && att[k]) r += att[k] === 'scope4x' ? 0.35 : 0.25;
  return r;
}

export function itemName(it) {
  if (it.type === 'weapon') return WEAPONS[it.id].name;
  if (it.type === 'ammo') return AMMO[it.cal].name;
  return ITEMS[it.type].name;
}

export function itemLabel(it) {
  if (it.type === 'weapon') {
    const a = Object.keys(it.att || {}).filter((k) => k !== 'finish').map((k) => ATTACHMENTS[it.att[k]].name);
    return WEAPONS[it.id].name + (a.length ? ' · ' + a.join(', ') : '');
  }
  return itemName(it) + (it.n > 1 ? ' ×' + it.n : '');
}

export function itemTier(it) {
  if (it.type === 'weapon') return weaponRank(it) >= WEAPON_BASE[it.id] + 0.6 ? 2 : weaponRank(it) > WEAPON_BASE[it.id] ? 1 : 0;
  if (it.type === 'medkit' || it.type === 'painkillers') return 2;
  if (it.type === 'plate' || it.type === 'frag') return 1;
  return 0;
}

// --- inventory ---------------------------------------------------------------------------------
export class Inventory {
  constructor() { this.reset(); }

  reset() {
    this.items = { bandage: 0, medkit: 0, painkillers: 0, energy: 0, plate: 0, frag: 0 };
    this.ammo = { '556': 0, '9mm': 0, '12g': 0 };
  }

  // Add a consumable or ammo. Returns how much didn't fit (0 = all taken); weapons are not handled here.
  add(it) {
    if (it.type === 'ammo') {
      const room = AMMO[it.cal].cap - this.ammo[it.cal];
      const take = Math.max(0, Math.min(room, it.n));
      this.ammo[it.cal] += take;
      return it.n - take;
    }
    const def = ITEMS[it.type];
    if (!def || it.type === 'weapon') return it.n || 1;
    const room = def.stack - this.items[it.type];
    const take = Math.max(0, Math.min(room, it.n));
    this.items[it.type] += take;
    return it.n - take;
  }

  // The heal to use now, given health (and armor for plates): the smallest one that still helps.
  bestHeal(health) {
    const I = this.items;
    if (health < 50 && I.medkit) return 'medkit';
    if (health < 75 && I.bandage) return 'bandage';
    if (health < 90 && I.painkillers) return 'painkillers';
    if (health < 100 && I.energy) return 'energy';
    if (health < 100 && I.medkit) return 'medkit';
    if (health < 100 && I.painkillers) return 'painkillers';
    return null;
  }

  // Everything as item list (for a death crate).
  dump() {
    const out = [];
    for (const k in this.items) if (this.items[k] > 0) out.push({ type: k, n: this.items[k] });
    for (const c in this.ammo) if (this.ammo[c] > 0) out.push({ type: 'ammo', cal: c, n: this.ammo[c] });
    return out;
  }
}

// What a finished heal or plate does to a character (returns false if it wouldn't help).
export function applyItem(c, type) {
  const def = ITEMS[type];
  if (def.kind === 'heal') {
    if (c.health >= def.cap) return false;
    c.health = Math.min(def.cap, c.health + def.heal);
    return true;
  }
  if (def.kind === 'boost') {
    c.boost = Math.min(100, (c.boost || 0) + def.boost);
    c.boostRate = def.boost / def.over;
    return true;
  }
  if (def.kind === 'plate') {
    if (c.armor >= MAX_ARMOR) return false;
    c.armor = Math.min(MAX_ARMOR, c.armor + def.armor);
    return true;
  }
  return false;
}

// Would this item help right now? (for prompts and "use best heal")
export function canUse(c, type) {
  const def = ITEMS[type];
  if (def.kind === 'heal') return c.health < def.cap;
  if (def.kind === 'boost') return c.health < 100;
  if (def.kind === 'plate') return c.armor < MAX_ARMOR;
  return false;
}

// Boost: health over time.
export function tickBoost(c, dt) {
  if (!c.boost || c.boost <= 0 || !c.alive) return;
  const d = Math.min(c.boost, (c.boostRate || 2) * dt);
  c.boost -= d;
  c.health = Math.min(100, c.health + d);
}

// --- loot in the world --------------------------------------------------------------------------
const RARITY = [0xe2ddd0, 0x5fa8ff, 0xc77dff];
const AMMO_STRIPE = { '556': 0xd9b56a, '9mm': 0x9fc4e8, '12g': 0xd5574a };

class LootModels {
  constructor(mats) {
    this.mats = mats;
    const M = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.05 }, o));
    this.m = {
      white: M(0xe8e4da, { roughness: 0.85 }), red: M(0xb3261e, { roughness: 0.5 }), orange: M(0xd8742a, { roughness: 0.4 }),
      can: M(0x2a8c8f, { roughness: 0.3, metalness: 0.6 }), plate: M(0x3b3f38, { roughness: 0.7, metalness: 0.2 }),
      olive: M(0x4d5638, { roughness: 0.75 }), steel: M(0x8b8f93, { roughness: 0.35, metalness: 0.8 }), dark: M(0x24262a, { roughness: 0.6 }),
      crate: M(0x5d6640, { roughness: 0.8 }), strap: M(0x2a2b26, { roughness: 0.9 }),
    };
    this.stripe = {};
    for (const k in AMMO_STRIPE) this.stripe[k] = M(AMMO_STRIPE[k], { roughness: 0.5 });
    this.ringGeo = new THREE.RingGeometry(0.2, 0.3, 28).rotateX(-Math.PI / 2);
    this.rings = RARITY.map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.6), transparent: true, opacity: 0.5, depthWrite: false }));
    this.guns = new Map();
  }

  mesh(geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }

  // A small model for an item, resting on y = 0, plus a rarity ring.
  build(it) {
    const g = new THREE.Group(), m = this.m;
    const add = (...o) => g.add(...o);
    switch (it.type) {
      case 'bandage': add(this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 16), m.white, 0, 0.045, 0), this.mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 16), m.white, 0.12, 0.035, 0.03)); break;
      case 'medkit': add(this.mesh(new THREE.BoxGeometry(0.34, 0.13, 0.24), m.red, 0, 0.065, 0), this.mesh(new THREE.BoxGeometry(0.14, 0.012, 0.04), m.white, 0, 0.135, 0), this.mesh(new THREE.BoxGeometry(0.04, 0.012, 0.14), m.white, 0, 0.135, 0), this.mesh(new THREE.BoxGeometry(0.12, 0.03, 0.02), m.dark, 0, 0.145, -0.125)); break;
      case 'painkillers': add(this.mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.08, 14), m.orange, 0, 0.04, 0), this.mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.025, 14), m.white, 0, 0.092, 0)); break;
      case 'energy': add(this.mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.125, 16), m.can, 0, 0.0625, 0), this.mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.122, 16), m.can, 0.09, 0.061, 0.04)); break;
      case 'plate': add(this.mesh(new THREE.BoxGeometry(0.25, 0.035, 0.32), m.plate, 0, 0.018, 0), this.mesh(new THREE.BoxGeometry(0.25, 0.035, 0.32), m.plate, 0.03, 0.053, 0.02)); break;
      case 'frag': add(this.mesh(new THREE.SphereGeometry(0.036, 12, 10).scale(1, 1.2, 1), m.olive, 0, 0.043, 0), this.mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.025, 10), m.steel, 0, 0.095, 0)); break;
      case 'ammo': add(this.mesh(new THREE.BoxGeometry(0.22, 0.11, 0.12), m.olive, 0, 0.055, 0), this.mesh(new THREE.BoxGeometry(0.222, 0.025, 0.122), this.stripe[it.cal], 0, 0.08, 0), this.mesh(new THREE.BoxGeometry(0.06, 0.02, 0.03), m.dark, 0, 0.12, 0)); break;
      case 'weapon': {
        const gun = this.gun(it);
        if (gun) add(gun);
        break;
      }
      default: break;
    }
    const ring = new THREE.Mesh(this.ringGeo, this.rings[itemTier(it)]);
    ring.position.y = 0.01;
    ring.renderOrder = 2;
    if (it.type === 'weapon') ring.scale.setScalar(2.2);
    g.add(ring);
    return g;
  }

  // A third-person gun lying on its side (built once per attachment set, then shared).
  gun(it) {
    const key = it.id + JSON.stringify(it.att || {});
    let base = this.guns.get(key);
    if (!base) {
      try {
        base = bakeGun(buildGun(it.id, it.att || {}, this.mats.gun, { shadows: true }));
      } catch (e) { console.warn('loot gun model skipped:', e); return null; }
      this.guns.set(key, base);
    }
    const g = base.clone();
    g.rotation.set(0, 0, Math.PI / 2);
    g.position.y = 0.03;
    const wrap = new THREE.Group();
    wrap.add(g);
    return wrap;
  }

  // A drop crate for a dead character's gear.
  crate() {
    const g = new THREE.Group(), m = this.m;
    g.add(this.mesh(new THREE.BoxGeometry(0.85, 0.42, 0.52), m.crate, 0, 0.21, 0));
    g.add(this.mesh(new THREE.BoxGeometry(0.88, 0.06, 0.55), m.olive, 0, 0.45, 0));
    for (const x of [-0.25, 0.25]) g.add(this.mesh(new THREE.BoxGeometry(0.05, 0.5, 0.56), m.strap, x, 0.24, 0));
    const ring = new THREE.Mesh(this.ringGeo, this.rings[2]);
    ring.scale.setScalar(2.6);
    ring.position.y = 0.01;
    g.add(ring);
    return g;
  }
}

const _box = new THREE.Box3(), _ray = new THREE.Ray(), _p = new THREE.Vector3(), _c = new THREE.Vector3();

export class LootWorld {
  constructor(game) {
    this.g = game;
    this.models = new LootModels(game.mats);
    this.root = new THREE.Group();
    this.root.name = 'loot';
    game.scene.add(this.root);
    this.pickups = [];
    this.boxes = [];
    this.claims = new Map();
    this.cullT = 0;
  }

  get containers() { return this.g.map.containers || []; }

  reset(rnd = Math.random) {
    for (const p of this.pickups) this.root.remove(p.object);
    for (const b of this.boxes) this.root.remove(b.object);
    this.pickups = [];
    this.boxes = [];
    this.claims.clear();
    for (const c of this.containers) {
      if (c.opened && c.close) c.close();
      c.opened = false;
      c.items = null;
      c.looted = false;
    }
    for (const s of this.g.map.groundLoot || []) {
      if (rnd() > 0.8) continue;
      const items = rollGround(s.tier || 0, rnd);
      items.forEach((it, i) => this.addPickup(it, new THREE.Vector3(s.x + i * 0.35, s.y, s.z + i * 0.2)));
    }
  }

  contents(c) {
    if (!c.items) c.items = rollContainer(c.tier || 0, c.kind, Math.random);
    return c.items;
  }

  addPickup(it, pos) {
    const p = { kind: 'pickup', item: Object.assign({}, it), pos: pos.clone(), object: null, spin: Math.random() * Math.PI * 2 };
    this.place(p);
    this.pickups.push(p);
    return p;
  }

  place(p) {
    if (p.object) this.root.remove(p.object);
    p.object = this.models.build(p.item);
    p.object.position.copy(p.pos);
    p.object.rotation.y = p.spin;
    this.root.add(p.object);
  }

  removePickup(p) {
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
    this.root.remove(p.object);
    this.claims.delete(p);
  }

  // A crate with a dead character's gear, where they fell.
  dropBox(c, items) {
    if (!items.length) return null;
    const ph = this.g.physics;
    const y = ph.groundHeight(c.body.p.x, c.body.p.z, 0.3, c.body.p.y + 0.5);
    const b = { kind: 'box', name: c.name, items: merge(items), pos: new THREE.Vector3(c.body.p.x, y, c.body.p.z), object: this.models.crate(), opened: true, tier: 2 };
    b.object.position.copy(b.pos);
    b.object.rotation.y = Math.random() * Math.PI;
    this.root.add(b.object);
    this.boxes.push(b);
    return b;
  }

  removeBox(b) {
    const i = this.boxes.indexOf(b);
    if (i >= 0) this.boxes.splice(i, 1);
    this.root.remove(b.object);
    this.claims.delete(b);
  }

  // Remove a source's empty item list (container: mark looted; crate: take it away).
  tidy(src) {
    if (src.items && src.items.length) return;
    if (src.kind === 'box') this.removeBox(src);
    else src.looted = true;
  }

  // What the viewer at `eye`, looking along `dir`, with feet at `feet`, can interact with.
  target(eye, dir, feet) {
    let best = null, bestS = Infinity;
    _ray.set(eye, dir);
    const consider = (ref, type, center, box, range) => {
      const dx = ref.pos.x - feet.x, dz = ref.pos.z - feet.z;
      const flat = Math.hypot(dx, dz);
      if (flat > range || Math.abs(ref.pos.y - feet.y) > 1.7) return;
      _c.copy(center).sub(eye);
      const dist = _c.length();
      const ang = Math.acos(Math.max(-1, Math.min(1, _c.dot(dir) / Math.max(1e-4, dist))));
      const hit = box ? _ray.intersectsBox(box) : false;
      if (!hit && ang > (type === 'pickup' ? 0.32 : 0.45)) return;
      const s = (hit ? 0 : ang * 2) + dist * 0.15;
      if (s < bestS) { bestS = s; best = { type, ref, dist }; }
    };
    const far = (q, r) => Math.abs(q.x - feet.x) > r || Math.abs(q.z - feet.z) > r;
    for (const c of this.containers) {
      if (c.looted || far(c.pos, 2)) continue;
      if (!c._box) { c._box = new THREE.Box3().setFromObject(c.object).expandByScalar(0.12); c._center = c._box.getCenter(new THREE.Vector3()); }
      consider(c, 'container', c._center, c._box, 1.6);
    }
    for (const b of this.boxes) {
      if (far(b.pos, 2.2)) continue;
      if (!b._box) { b._box = new THREE.Box3().setFromObject(b.object).expandByScalar(0.1); b._center = b._box.getCenter(new THREE.Vector3()); }
      consider(b, 'box', b._center, b._box, 1.9);
    }
    for (const p of this.pickups) {
      if (far(p.pos, 2.2)) continue;
      _box.setFromCenterAndSize(_p.copy(p.pos).setY(p.pos.y + 0.08), _c.set(0.5, 0.3, 0.5));
      consider(p, 'pickup', _p.clone(), _box.clone(), 2.0);
    }
    return best;
  }

  // Nearest unclaimed loot for a bot: unopened containers, crates and pickups within radius.
  nearestFor(bot, radius, want) {
    const p = bot.body.p;
    let best = null, bestD = radius;
    const ok = (ref) => {
      if (bot.visited && bot.visited.has(ref)) return false;
      const c = this.claims.get(ref);
      return !c || c === bot || !c.alive;
    };
    const check = (ref, d) => { if (d < bestD && ok(ref)) { bestD = d; best = ref; } };
    for (const c of this.containers) if (!c.looted && (!c.opened || (c.items && c.items.length))) check(c, c.pos.distanceTo(p) + Math.abs(c.pos.y - p.y) * 3);
    for (const b of this.boxes) check(b, b.pos.distanceTo(p));
    for (const q of this.pickups) if (!want || want(q.item)) check(q, q.pos.distanceTo(p) + Math.abs(q.pos.y - p.y) * 3);
    if (best) this.claims.set(best, bot);
    return best;
  }

  update(dt, camera) {
    this.cullT -= dt;
    if (this.cullT <= 0) {
      this.cullT = 0.3;
      const cp = camera.position;
      for (const p of this.pickups) p.object.visible = p.pos.distanceToSquared(cp) < 70 * 70;
      for (const b of this.boxes) b.object.visible = b.pos.distanceToSquared(cp) < 140 * 140;
    }
    for (const p of this.pickups) if (p.object.visible && p.item.type !== 'weapon') { p.spin += dt * 0.6; p.object.rotation.y = p.spin; }
  }
}
