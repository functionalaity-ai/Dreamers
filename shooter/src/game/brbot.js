// Battle Royale bot: the TDM bot's perception and combat, plus a loot phase after landing, healing
// and plates when it's quiet, and moving into the zone. Every bot is its own team (free for all).
import * as THREE from 'three';
import { Bot } from '../characters/bot.js';
import { WeaponState } from '../weapons/weapon.js';
import { buildGun, bakeGun } from '../weapons/gunmodels.js';
import { Inventory, ITEMS, CALIBRE, weaponRank, applyItem, canUse, tickBoost } from './loot.js';

const rand = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3();

export class BRBot extends Bot {
  constructor(game, o) {
    super(game, Object.assign({ primary: 'warden', att: {}, lane: 0 }, o));
    this.inv = new Inventory();
    this.gunItem = { type: 'weapon', id: 'warden', att: {} };
    this.h.holdPistol = true;
    this.heal = null;
    this.looted = 0;
    this.boost = 0;
    this.visited = new Set();   // containers, crates and pickups already gone through
  }

  // Hold a different gun (rebuilds the third-person model).
  equip(it, mag) {
    if (this.gunMesh && this.gunMesh.parent) this.gunMesh.parent.remove(this.gunMesh);
    this.weapon = new WeaponState(it.id, it.att);
    const gun = buildGun(it.id, this.weapon.stats.att, this.game.mats.gun, { shadows: true });
    this.gunMesh = bakeGun(gun);
    this.anchors = gun.anchors;
    this.gunInfo = { id: gun.id, sight: gun.sight };
    this.h.setGun(this.gunMesh, gun.anchors, this.gunInfo);
    this.h.holdPistol = it.id === 'warden';
    if (mag !== undefined) this.weapon.mag = Math.min(this.weapon.stats.mag, mag);
    this.weapon.reserve = this.inv.ammo[CALIBRE[it.id]];
    this.gunItem = { type: 'weapon', id: it.id, att: Object.assign({}, this.weapon.stats.att) };
    this.reloadT = 0;
  }

  // Start of a match: the drop kit (pistol and one spare magazine), no armor.
  brSpawn(p, yaw) {
    if (this.gunItem.id !== 'warden' || Object.keys(this.gunItem.att).length) this.equip({ type: 'weapon', id: 'warden', att: {} });
    this.spawn(p, yaw);
    this.h.holdPistol = true;
    this.armor = 0;
    this.nades = 0;
    this.inv.reset();
    this.inv.ammo['9mm'] = this.weapon.stats.mag;
    this.weapon.mag = this.weapon.stats.mag;
    this.weapon.chambered = true;
    this.weapon.reserve = this.inv.ammo['9mm'];
    this.boost = 0;
    this.heal = null;
    this.looted = 0;
    this.visited.clear();
    this.lootTarget = null;
    this.direct = false;
    this.landT = null;
  }

  // Everything this bot carries, for its crate.
  gear() {
    const out = [Object.assign({ mag: this.weapon.mag }, this.gunItem)];
    return out.concat(this.inv.dump());
  }

  update(dt) {
    if (!this.alive) { super.update(dt); return; }
    const g = this.game;
    let cal = CALIBRE[this.weapon.id];
    this.weapon.reserve = this.inv.ammo[cal];
    this.nades = this.inv.items.frag;
    tickBoost(this, dt);
    if (this.heal) {
      this.heal.t -= dt;
      if (this.target && g.time - this.lastSeen < 0.5) this.heal = null;
      else if (this.heal.t <= 0) {
        if (this.inv.items[this.heal.type] > 0 && applyItem(this, this.heal.type)) this.inv.items[this.heal.type]--;
        this.heal = null;
      }
    }
    const lt = this.lootTarget;
    if (lt) {
      const gone = lt.kind === 'pickup' ? g.loot.pickups.indexOf(lt) < 0 : lt.kind === 'box' ? g.loot.boxes.indexOf(lt) < 0 : lt.looted;
      if (gone) { this.lootTarget = null; if (this.goal) { this.goal = null; this.path = null; } }
      else if (Math.hypot(lt.pos.x - this.body.p.x, lt.pos.z - this.body.p.z) < 1.9 && Math.abs(lt.pos.y - this.body.p.y) < 1.3) {
        this.lootFrom(lt);
        this.lootTarget = null;
        this.goal = null; this.path = null; this.direct = false;
      }
    }
    super.update(dt);
    cal = CALIBRE[this.weapon.id];
    this.inv.ammo[cal] = this.weapon.reserve;
    this.inv.items.frag = this.nades;
  }

  // --- looting --------------------------------------------------------------------------------
  lootFrom(src) {
    const L = this.game.loot;
    this.visited.add(src);
    if (src.kind === 'pickup') {
      const left = this.take(src.item, (old) => L.addPickup(old, src.pos));
      if (left === 0) L.removePickup(src); else if (left > 0) src.item.n = left;
    } else {
      if (!src.opened && src.open) src.open();
      const items = src.kind === 'box' ? src.items : L.contents(src);
      for (let i = items.length - 1; i >= 0; i--) {
        const left = this.take(items[i], (old) => items.push(old));
        if (left === 0) items.splice(i, 1); else if (left > 0) items[i].n = left;
      }
      L.tidy(src);
    }
    this.looted++;
  }

  // Take an item if it's useful. Returns what's left of it (0 all, -1 not taken).
  take(it, putBack) {
    if (it.type === 'weapon') {
      if (weaponRank(it) <= weaponRank(this.gunItem) + 0.1) return -1;
      const old = Object.assign({ mag: this.weapon.mag }, this.gunItem);
      this.equip(it, it.mag);
      putBack(old);
      return 0;
    }
    const left = this.inv.add(it);
    return left === it.n ? -1 : left;
  }

  // What it still wants: a gun, armor, heals or ammo.
  wants() {
    const I = this.inv.items;
    return this.gunItem.id === 'warden' || this.armor < 50 || I.bandage + I.medkit < 2 || this.inv.ammo[CALIBRE[this.weapon.id]] < this.weapon.stats.mag;
  }

  // --- decisions -------------------------------------------------------------------------------
  think() {
    const g = this.game, z = g.zone;
    const outside = !z.insideSafe(this.body.p, 3);
    if (outside && (this.state === 'hold' || (this.goal && !z.insideSafe(this.goal, 1)))) {
      if (this.state === 'hold') this.setState('advance');
      this.goal = null; this.path = null; this.direct = false; this.lootTarget = null;
    }
    // Heal or plate up when nobody is around.
    if (!this.heal && !this.target && g.time - this.lastSeen > 3 && this.reloadT <= 0) {
      const I = this.inv.items;
      let type = null;
      if (this.armor < 50 && I.plate) type = 'plate';
      else if (this.health < 80) type = this.inv.bestHeal(this.health);
      const zoneHurts = !z.inside(this.body.p);
      if (type && canUse(this, type) && (!zoneHurts || this.health < 30)) this.heal = { type, t: ITEMS[type].use };
    }
    super.think();
  }

  moveIntent(dt) {
    const g = this.game;
    if (this.heal) { this.crouch = true; return new THREE.Vector3(); }
    if (this.state !== 'advance') return super.moveIntent(dt);
    // Path done: pick the next leg (sometimes pause to look around).
    if (this.path && this.pathI >= this.path.length) {
      this.path = null; this.goal = null; this.direct = false;
      if (Math.random() < 0.2 && g.zone.insideSafe(this.body.p, 6) && !this.lootTarget) {
        this.setState('hold');
        this.holdTime = rand(1.5, 4); this.holdCrouch = Math.random() < 0.3; this.holdYaw = this.yaw + rand(-1.2, 1.2);
        return new THREE.Vector3();
      }
    }
    if (this.direct) {
      this.directT -= dt;
      if (!this.goal || this.directT <= 0 || Math.hypot(this.goal.x - this.body.p.x, this.goal.z - this.body.p.z) < 1.6) { this.goal = null; this.direct = false; }
    }
    if (!this.goal) {
      this.goal = this.pickGoal();
      if (!this.goal) return new THREE.Vector3();
      this.path = g.nav.path(this.body.p, this.goal);
      this.pathI = 0;
      this.direct = !this.path;
      this.directT = 5;
    }
    if (this.direct) {
      // no route on the graph (open ground, or far away): walk straight there
      const dx = this.goal.x - this.body.p.x, dz = this.goal.z - this.body.p.z, d = Math.hypot(dx, dz) || 1;
      this.crouch = false;
      return new THREE.Vector3(dx / d, 0, dz / d).multiplyScalar(this.target ? 3.4 : 4.6);
    }
    return super.moveIntent(dt);
  }

  // Where to go next: into the zone, to loot, towards a far target, or a short roam.
  pickGoal() {
    const g = this.game, p = this.body.p, s = g.zone.safe;
    const ds = Math.hypot(p.x - s.x, p.z - s.z);
    if (ds > s.r - 4) {
      // a point well inside the safe circle, at most 40 m away per leg
      const inR = Math.max(0, s.r * 0.55);
      const tx = s.x + (p.x - s.x) / (ds || 1) * inR, tz = s.z + (p.z - s.z) / (ds || 1) * inR;
      return this.leg(tx, tz, 40);
    }
    if (this.target) return this.target.body.p.clone();
    if (this.wants() || this.looted < 3) {
      const t = g.loot.nearestFor(this, this.looted < 3 ? 45 : 30, (it) => it.type !== 'weapon' || weaponRank(it) > weaponRank(this.gunItem) + 0.1);
      if (t && g.zone.insideSafe(t.pos, 1)) { this.lootTarget = t; return t.pos.clone(); }
    }
    // roam towards a random point in the safe circle
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s.r * 0.7;
    return this.leg(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, 28);
  }

  // A goal towards (tx, tz), at most `max` metres away, snapped onto the nav graph when possible.
  leg(tx, tz, max) {
    const p = this.body.p;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    const k = d > max ? max / d : 1;
    _v.set(p.x + dx * k, 0, p.z + dz * k);
    const n = this.game.nav.nearest(_v, 6);
    return n ? n.p.clone() : _v.clone();
  }
}
