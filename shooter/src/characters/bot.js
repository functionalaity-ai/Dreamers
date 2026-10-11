// AI operator: perception, squad comms, cover, peeking, flanking, investigating and retreating.
import * as THREE from 'three';
import { Humanoid } from './humanoid.js';
import { WeaponState } from '../weapons/weapon.js';
import { buildGun, bakeGun } from '../weapons/gunmodels.js';
import { bodyHitTest, makePoints, pointsFromHumanoid } from './hitbox.js';
import { jitter } from '../weapons/ballistics.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Bot {
  constructor(game, o) {
    this.game = game;
    this.name = o.name;
    this.team = o.team;
    this.isBot = true;
    this.lane = o.lane;
    const faction = o.faction || o.team;   // the uniform; team can be a free-for-all id
    this.h = new Humanoid(game.mats.char[faction], faction, o.seed);
    game.scene.add(this.h.group);
    this.weapon = new WeaponState(o.primary, o.att);
    const gun = buildGun(o.primary, this.weapon.stats.att, game.mats.gun, { shadows: true });
    this.gunMesh = bakeGun(gun);
    this.anchors = gun.anchors;
    this.gunInfo = { id: gun.id, sight: gun.sight };   // what the hold needs (stock, sight height)
    this.h.setGun(this.gunMesh, gun.anchors, this.gunInfo);
    this.h.holdPistol = false;
    this.body = { p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0.32, h: 1.78, step: 0.42, grounded: true };
    this.yaw = 0;
    this.pitch = 0;
    this.eye = new THREE.Vector3();
    this.pts = makePoints();
    this.health = 100;
    this.armor = 100;
    this.alive = false;
    this.stats = { kills: 0, deaths: 0, score: 0, shots: 0, hits: 0, hs: 0 };
    this.state = 'advance';
    this.path = null;
    this.pathI = 0;
    this.goal = null;
    this.target = null;
    this.detect = new Map();
    this.lastKnown = null;
    this.lastSeen = -99;
    this.reaction = 0;
    this.aimErr = new THREE.Vector2();
    this.burst = 0;
    this.burstPause = 0;
    this.percT = Math.random() * 0.2;
    this.thinkT = Math.random() * 0.3;
    this.stateT = 0;
    this.crouch = false;
    this.strafe = 0;
    this.strafeT = 0;
    this.cover = null;
    this.peekT = 0;
    this.peeking = false;
    this.reloadT = 0;
    this.nadeT = rand(8, 16);
    this.nades = 1;
    this.stuckT = 0;
    this.lastPos = new THREE.Vector3();
    this.lastHurt = -99;
    this.calloutT = 0;
  }

  get diff() { return this.game.difficulty; }

  spawn(p, yaw) {
    this.body.p.copy(p);
    this.body.v.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = 100;
    this.armor = 100;
    this.alive = true;
    this.state = 'advance';
    this.path = null;
    this.goal = null;
    this.target = null;
    this.detect.clear();
    this.lastKnown = null;
    this.cover = null;
    this.crouch = false;
    this.reloadT = 0;
    this.nades = 1;
    const s = this.weapon.stats;
    this.weapon.mag = s.mag; this.weapon.chambered = true; this.weapon.reserve = s.reserve; this.weapon.needsPump = false; this.weapon.boltLocked = false;
    this.h.reset();
    this.h.setGun(this.gunMesh, this.anchors, this.gunInfo);
    this.h.group.visible = true;
    this.spawnT = this.game.time;
  }

  hitTest(a, d, len) {
    if (!this.alive) return null;
    // Cheap reject before touching bones
    const dx = this.body.p.x - a.x, dz = this.body.p.z - a.z;
    const t = dx * d.x + dz * d.z;
    if (t < -1 || t > len + 1) return null;
    pointsFromHumanoid(this.h, this.pts);
    return bodyHitTest(this.pts, a, d, len, 1.2); // 20% more forgiving than the body you see
  }

  takeDamage(dmg, info) {
    if (!this.alive) return 0;
    if (this.game.time - this.spawnT < this.game.rules.spawnProtect) return 0;
    let d = dmg;
    if (info.zone === 'chest' && this.armor > 0) {
      const absorbed = d * 0.45;
      this.armor = Math.max(0, this.armor - absorbed * 1.3);
      d -= absorbed;
    }
    this.health -= d;
    this.lastHurt = this.game.time;
    // Flinch
    const local = _v.copy(info.dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    this.h.hitV.x += -local.z * 4 + (info.zone === 'head' ? -3 : 0);
    this.h.hitV.y += local.x * 4;
    // Getting shot reveals the shooter's rough position
    if (info.attacker && info.attacker.alive) this.reveal(info.attacker, 0.6);
    if (this.health <= 0) this.die(info);
    return d;
  }

  die(info) {
    this.alive = false;
    this.health = 0;
    const local = _v.copy(info.dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    this.h.die(local.z < 0 ? -1 : 1);
    // Drop the weapon
    this.h.gunPivot.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    this.h.gunPivot.matrixWorld.decompose(p, q, _v2);
    this.h.gunPivot.remove(this.gunMesh);
    const dropped = this.gunMesh.clone();
    this.game.effects.dropProp(dropped, p, q, new THREE.Vector3(info.dir.x * 1.5, 0.5, info.dir.z * 1.5), 4, 30, 0.03);
    if (this.team !== this.game.player.team) return;
    this.game.callout(this, 'Man down!', true);
  }

  // Become aware of someone, e.g. from being shot or a teammate's call.
  reveal(c, certainty) {
    this.lastKnown = c.body.p.clone().add(new THREE.Vector3(rand(-2, 2) * (1 - certainty), 0, rand(-2, 2) * (1 - certainty)));
    this.lastSeen = this.game.time;
    const cur = this.detect.get(c) || 0;
    this.detect.set(c, Math.max(cur, certainty));
  }

  hear(pos, source) {
    if (!this.alive) return;
    if (this.target && this.game.time - this.lastSeen < 1.5) return;
    this.lastKnown = pos.clone().add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3)));
    this.lastSeen = this.game.time - 1;
    if (this.state === 'advance' || this.state === 'hold') { this.setState('investigate'); this.path = null; }
  }

  setState(s) { if (this.state !== s) { this.state = s; this.stateT = 0; } }

  // --- per frame ------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    if (!this.alive) { this.h.update(dt, {}); return; }
    this.weapon.update(dt);
    this.stateT += dt;
    this.percT -= dt;
    this.thinkT -= dt;
    this.calloutT -= dt;
    if (this.percT <= 0) { this.percT = 0.15; this.perceive(0.15); }
    if (this.thinkT <= 0) { this.thinkT = 0.25; this.think(); }
    // Reloading
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        if (this.weapon.pump) { while (this.weapon.loadShell()) {} if (!this.weapon.chambered) this.weapon.rack(); }
        else { this.weapon.swapMag(); this.weapon.closeBolt(); }
      }
    }
    if (this.weapon.needsPump && this.weapon.cooldown <= 0.5 && this.reloadT <= 0) this.weapon.rack();
    const desired = this.moveIntent(dt);
    this.aimAndFire(dt);
    // Movement
    const b = this.body;
    const accel = b.grounded ? 14 : 2;
    b.v.x += (desired.x - b.v.x) * Math.min(1, dt * accel);
    b.v.z += (desired.z - b.v.z) * Math.min(1, dt * accel);
    g.physics.move(b, dt);
    // Stuck detection
    this.stuckT += dt;
    if (this.stuckT > 1.4) {
      const moved = this.lastPos.distanceTo(b.p);
      if (desired.lengthSq() > 1 && moved < 0.35) { this.path = null; this.goal = null; this.strafe *= -1; }
      this.lastPos.copy(b.p);
      this.stuckT = 0;
    }
    // Animate
    this.h.group.position.copy(b.p);
    this.h.group.rotation.y = this.yaw;
    const sp = Math.hypot(b.v.x, b.v.z);
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const fwd = sp > 0.1 ? (b.v.x * fwdX + b.v.z * fwdZ) / sp : 1;
    const side = sp > 0.1 ? (b.v.x * -fwdZ + b.v.z * fwdX) / sp : 0;
    this.h.update(dt, { speed: sp, fwd, side, crouch: this.crouch, aimPitch: this.pitch, sprint: sp > 4.2 && !this.target, reloading: this.reloadT > 0 });
    this.eye.set(b.p.x, b.p.y + (this.crouch ? 1.12 : 1.62), b.p.z);
  }

  perceive(dt) {
    const g = this.game;
    const D = this.diff;
    let best = null, bestD = Infinity;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    for (const c of g.characters) {
      if (c.team === this.team || !c.alive) continue;
      const to = _v.subVectors(c.eye, this.eye);
      const dist = to.length();
      let m = this.detect.get(c) || 0;
      if (dist > 80) { this.detect.set(c, Math.max(0, m - dt)); continue; }
      const facing = (to.x * fx + to.z * fz) / Math.max(0.01, Math.hypot(to.x, to.z));
      const inFov = facing > Math.cos(68 * DEG) || dist < 4;
      let seen = false;
      if (inFov) {
        seen = g.physics.clear(this.eye, c.eye) || g.physics.clear(this.eye, _v2.set(c.body.p.x, c.body.p.y + 1.1, c.body.p.z));
      }
      if (seen) {
        // Detection falls off steeply with range: seconds to spot ≈ 0.7 at 15 m, 2 at 40 m, 7 at 80 m.
        let rate = D.detect * 2.6 / (1 + (dist / 20) * (dist / 20));
        rate *= c.visibility ? c.visibility() : 1;
        if (facing > Math.cos(25 * DEG)) rate *= 1.6;
        if (dist < 7) rate = 10;
        if (c.firedRecently && c.firedRecently()) rate *= 3;
        m = Math.min(1.2, m + rate * dt);
      } else {
        m = Math.max(0, m - dt * 0.4);
      }
      this.detect.set(c, m);
      if (seen && m >= 1 && dist < bestD) { best = c; bestD = dist; }
    }
    const had = this.target;
    if (best) {
      if (best !== had) {
        this.reaction = D.reaction * rand(0.8, 1.3) * (had ? 0.5 : 1);
        const err = D.aimError * DEG * (1 + bestD / 35);
        this.aimErr.set(rand(-1, 1) * err, rand(-0.6, 1) * err);
        if (this.calloutT <= 0) this.callout(this.contactCall(best));
      }
      this.target = best;
      this.lastKnown = best.body.p.clone();
      this.lastSeen = g.time;
      // Tell the squad
      for (const m of g.characters) if (m.isBot && m.team === this.team && m !== this && m.alive && !m.target && m.body.p.distanceTo(this.body.p) < 45) m.reveal(best, 0.35);
    } else if (had && g.time - this.lastSeen > 0.6) {
      this.target = null;
    }
  }

  contactCall(c) {
    const to = _v.subVectors(c.body.p, this.body.p);
    const ang = Math.atan2(to.x, -to.z);
    const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const d = dirs[(Math.round(ang / (Math.PI / 4)) + 8) % 8];
    const where = c.body.p.y > 2.5 ? ', upstairs' : '';
    return 'Contact ' + d + ', ' + Math.round(to.length()) + ' metres' + where + '!';
  }

  callout(text, force) {
    if (!force && this.calloutT > 0) return;
    this.calloutT = 4;
    this.game.callout(this, text);
  }

  // Decide what to do (4 times a second).
  think() {
    const g = this.game;
    const ws = this.weapon;
    // Reload when empty, or when it's quiet and the mag is low.
    if (this.reloadT <= 0 && ws.reserve > 0 && (ws.loaded === 0 || (!this.target && ws.mag < ws.stats.mag * 0.4 && g.time - this.lastSeen > 2.5))) {
      this.reloadT = ws.reloadTime() + (ws.pump ? ws.stats.reload.shell * (ws.stats.mag - ws.mag - 1) : 0);
      if (this.target || g.time - this.lastSeen < 4) this.callout('Reloading!');
    }
    const hurt = this.health < 38 && g.time - this.lastHurt < 4;
    if (this.target) {
      const dist = this.target.body.p.distanceTo(this.body.p);
      if (hurt && this.state !== 'retreat') { this.findCover(this.target.body.p, 'retreat'); return; }
      // Far away: keep pushing and shoot on the move rather than digging in.
      if (dist > 42 && !hurt) {
        if (this.state !== 'advance' && this.state !== 'hold') { this.setState('advance'); this.path = null; }
        return;
      }
      if (this.state === 'cover' || this.state === 'moveCover' || this.state === 'flank' || this.state === 'retreat') {
        if (this.state === 'cover' && this.stateT > 9 && this.squadCount() >= 2 && Math.random() < 0.35) this.tryFlank();
        return;
      }
      // Exposed: find cover nearby unless the target is very close.
      if (dist > 7 && (this.state !== 'engage' || this.stateT > 1.2)) {
        if (!this.findCover(this.target.body.p, 'moveCover')) this.setState('engage');
      } else this.setState('engage');
      return;
    }
    // No visible target
    const since = g.time - this.lastSeen;
    if (this.lastKnown && since < 8) {
      if (this.state === 'cover' && since < 3) {
        // Hold the angle briefly, maybe throw a grenade at a camper.
        this.tryGrenade();
        return;
      }
      if (this.state !== 'investigate' && this.state !== 'flank') { this.setState('investigate'); this.path = null; }
      return;
    }
    if (this.state !== 'advance' && this.state !== 'hold') { this.setState('advance'); this.path = null; this.goal = null; this.cover = null; }
  }

  squadCount() {
    let n = 0;
    for (const m of this.game.characters) if (m.isBot && m.team === this.team && m.alive) n++;
    return n;
  }

  // EQS-style cover search: hidden from the threat, able to shoot from a peek, close by.
  findCover(threat, mode) {
    const g = this.game, nav = g.nav;
    const threatEye = _v3.set(threat.x, threat.y + 1.55, threat.z);
    let best = null, bestScore = -Infinity;
    let checked = 0;
    const away = mode === 'retreat';
    nav.near(this.body.p, away ? 18 : 14, (n) => {
      if (!n.ok || !n.cover.length || checked > 40) return;
      const dBot = n.p.distanceTo(this.body.p);
      if (dBot > (away ? 18 : 14)) return;
      const toT = _v.subVectors(threat, n.p);
      const dT = Math.hypot(toT.x, toT.z);
      if (dT < 6) return;
      toT.y = 0; toT.normalize();
      let protect = null;
      for (const c of n.cover) if (c.dir.dot(toT) > 0.6) { protect = c; break; }
      if (!protect) return;
      if (g.isClaimed(n, this)) return;
      checked++;
      const hideY = protect.high ? 1.5 : 0.85;
      const hidden = !g.physics.clear(threatEye, _v2.set(n.p.x, n.p.y + hideY, n.p.z));
      if (!hidden) return;
      let peek = null;
      if (!protect.high) {
        if (g.physics.clear(threatEye, _v2.set(n.p.x, n.p.y + 1.45, n.p.z))) peek = { dx: 0, dz: 0, stand: true };
      } else {
        for (const s of [1, -1]) {
          const px = n.p.x - protect.dir.z * 0.75 * s, pz = n.p.z + protect.dir.x * 0.75 * s;
          if (g.physics.clear(threatEye, _v2.set(px, n.p.y + 1.5, pz)) && g.physics.boxFree(px - 0.25, n.p.y + 0.5, pz - 0.25, px + 0.25, n.p.y + 1.7, pz + 0.25)) { peek = { dx: px - n.p.x, dz: pz - n.p.z, stand: false }; break; }
        }
      }
      let score = (peek ? 8 : -4) - dBot * 0.55 - Math.abs(dT - 18) * 0.12;
      if (away) score += dT * 0.5;
      if (score > bestScore) { bestScore = score; best = { node: n, peek, high: protect.high }; }
    });
    if (!best) return false;
    const path = nav.path(this.body.p, best.node.p);
    if (!path) return false;
    g.claim(best.node, this);
    this.cover = best;
    this.path = path;
    this.pathI = 0;
    this.setState(mode);
    if (mode === 'moveCover' && Math.random() < 0.3) this.callout('Moving to cover!');
    return true;
  }

  tryFlank() {
    const g = this.game, nav = g.nav;
    if (!this.lastKnown) return false;
    const T = this.lastKnown;
    const base = Math.atan2(this.body.p.x - T.x, this.body.p.z - T.z);
    const side = Math.random() < 0.5 ? 1 : -1;
    let best = null, bestScore = -Infinity;
    for (const n of nav.coverNodes) {
      const dT = n.p.distanceTo(T);
      if (dT < 8 || dT > 26) continue;
      const a = Math.atan2(n.p.x - T.x, n.p.z - T.z);
      const off = angleDiff(a, base) * side;
      if (off < 50 * DEG || off > 115 * DEG) continue;
      const score = -Math.abs(off - 80 * DEG) * 8 - Math.abs(dT - 15) * 0.3 - n.p.distanceTo(this.body.p) * 0.1;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    if (!best) return false;
    const eye = new THREE.Vector3(T.x, T.y + 1.55, T.z);
    const path = nav.path(this.body.p, best.p, (m) => (g.physics.clear(eye, _v2.set(m.p.x, m.p.y + 1.3, m.p.z)) ? 6 : 0));
    if (!path) return false;
    this.path = path;
    this.pathI = 0;
    this.cover = { node: best, peek: { dx: 0, dz: 0, stand: true } };
    this.setState('flank');
    this.callout(side > 0 ? 'Flanking right!' : 'Flanking left!');
    return true;
  }

  tryGrenade() {
    const g = this.game;
    if (this.nades <= 0 || this.nadeT > 0 || !this.lastKnown) { this.nadeT -= 0.25; return; }
    const d = this.lastKnown.distanceTo(this.body.p);
    if (d < 9 || d > 28) return;
    if (Math.random() > 0.25) return;
    this.nades--;
    this.nadeT = rand(18, 30);
    const from = this.eye.clone();
    const to = this.lastKnown.clone();
    // Lob with a 40° launch angle.
    const flat = Math.hypot(to.x - from.x, to.z - from.z);
    const dy = to.y - from.y;
    const ang = 40 * DEG;
    const v2 = (9.81 * flat * flat) / (2 * Math.cos(ang) ** 2 * (flat * Math.tan(ang) - dy));
    const v = Math.sqrt(Math.max(4, Math.min(400, v2)));
    const dir = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
    const vel = dir.multiplyScalar(Math.cos(ang) * v);
    vel.y = Math.sin(ang) * v;
    g.throwGrenade(this, from, vel);
    this.callout('Frag out!', true);
  }

  // Where to move this frame.
  moveIntent(dt) {
    const g = this.game;
    const out = new THREE.Vector3();
    const s = this.state;
    if (this.evade > 0 && this.evadeDir) {
      this.crouch = false;
      return out.copy(this.evadeDir).multiplyScalar(4.8);
    }
    if (s === 'engage') {
      this.crouch = this.target && this.target.body.p.distanceTo(this.body.p) > 22 && Math.random() < 0.02 ? !this.crouch : this.crouch;
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rand(0.5, 1.4); this.strafe = Math.random() < 0.25 ? 0 : (Math.random() < 0.5 ? -1 : 1); }
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      out.set(rx * this.strafe, 0, rz * this.strafe).multiplyScalar(this.crouch ? 1.6 : 2.6);
      return out;
    }
    if (s === 'cover') {
      const cv = this.cover;
      if (!cv) { this.setState('engage'); return out; }
      this.peekT -= dt;
      if (this.peekT <= 0) {
        this.peeking = !this.peeking && !!cv.peek && this.reloadT <= 0;
        this.peekT = this.peeking ? rand(1.0, 2.2) : rand(0.9, 2.0);
      }
      let tx = cv.node.p.x, tz = cv.node.p.z;
      if (this.peeking && cv.peek) { tx += cv.peek.dx; tz += cv.peek.dz; }
      this.crouch = !cv.high && !this.peeking;
      const dx = tx - this.body.p.x, dz = tz - this.body.p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.08) out.set(dx / d, 0, dz / d).multiplyScalar(Math.min(2.4, d * 6));
      return out;
    }
    // Path-following states
    if (!this.path || this.pathI >= this.path.length) {
      if (s === 'moveCover' || s === 'flank' || s === 'retreat') {
        if (this.cover) { this.setState('cover'); this.peekT = 0.3; this.peeking = false; return out; }
      }
      if (s === 'investigate') {
        if (this.lastKnown && this.lastKnown.distanceTo(this.body.p) > 2 && (!this.path)) {
          this.path = g.nav.path(this.body.p, this.lastKnown);
          this.pathI = 0;
          if (!this.path) { this.setState('advance'); }
        } else if (this.path) { this.lastKnown = null; this.setState('advance'); this.path = null; }
        return out;
      }
      if (s === 'hold') {
        this.crouch = this.holdCrouch;
        if (this.stateT > this.holdTime) { this.setState('advance'); this.path = null; }
        else this.yaw += angleDiff(this.holdYaw, this.yaw) * Math.min(1, dt * 3);
        return out;
      }
      // Advance: pick the next strategic point in this bot's lane, moving towards the enemy.
      if (this.goal && this.goal.distanceTo(this.body.p) < 2.2) {
        if (Math.random() < 0.55) {
          this.setState('hold');
          this.holdTime = rand(4, 10);
          this.holdCrouch = Math.random() < 0.4;
          const enemyX = this.team === 'msg' ? 1 : -1;
          this.holdYaw = Math.atan2(-enemyX, 0) + rand(-0.6, 0.6);
          this.goal = null;
          return out;
        }
        this.goal = null;
      }
      if (!this.goal) this.goal = this.pickGoal();
      this.path = g.nav.path(this.body.p, this.goal);
      this.pathI = 0;
      if (!this.path) { this.goal = null; return out; }
    }
    // Follow waypoints
    const wp = this.path[this.pathI];
    const dx = wp.x - this.body.p.x, dz = wp.z - this.body.p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.45 && Math.abs(wp.y - this.body.p.y) < 1.2) { this.pathI++; return out; }
    const speed = s === 'investigate' ? 3.0 : s === 'flank' ? 4.4 : s === 'retreat' ? 4.4 : this.target ? 3.4 : 4.6;
    this.crouch = false;
    out.set(dx / d, 0, dz / d).multiplyScalar(speed);
    // Separation from squad mates
    for (const m of g.characters) {
      if (m === this || !m.alive || m.team !== this.team) continue;
      const ox = this.body.p.x - m.body.p.x, oz = this.body.p.z - m.body.p.z;
      const od = Math.hypot(ox, oz);
      if (od < 1.1 && od > 0.01) { out.x += (ox / od) * (1.1 - od) * 3; out.z += (oz / od) * (1.1 - od) * 3; }
    }
    return out;
  }

  pickGoal() {
    const pts = this.game.map.points;
    const dir = this.team === 'msg' ? 1 : -1;
    const mine = pts.filter((p) => p.lane === this.lane || Math.random() < 0.25);
    const fwd = mine.filter((p) => (p.p.x - this.body.p.x) * dir > 4);
    const pool = fwd.length && Math.random() < 0.8 ? fwd : mine.length ? mine : pts;
    // Prefer the nearest few forward points so the push is gradual.
    pool.sort((a, b) => a.p.distanceTo(this.body.p) - b.p.distanceTo(this.body.p));
    const pick = pool[Math.floor(Math.random() * Math.min(3, pool.length))];
    return pick.p.clone().add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-1.5, 1.5)));
  }

  aimAndFire(dt) {
    const g = this.game;
    const D = this.diff;
    const ws = this.weapon;
    let aimAt = null;
    if (this.target && this.target.alive) {
      aimAt = _v.copy(this.target.body.p);
      const head = D.name === 'Veteran' && this.target.body.p.distanceTo(this.body.p) < 25;
      aimAt.y += head ? (this.target.eye.y - this.target.body.p.y) + 0.02 : (this.target.eye.y - this.target.body.p.y) * 0.72;
    } else if (this.lastKnown && g.time - this.lastSeen < 5) {
      aimAt = _v.copy(this.lastKnown); aimAt.y += 1.3;
    } else if (this.path && this.pathI < this.path.length) {
      const wp = this.path[Math.min(this.path.length - 1, this.pathI + 1)];
      aimAt = _v.set(wp.x, this.eye.y, wp.z);
    }
    if (aimAt) {
      const dx = aimAt.x - this.eye.x, dy = aimAt.y - this.eye.y, dz = aimAt.z - this.eye.z;
      const yawT = Math.atan2(-dx, -dz) + this.aimErr.x;
      const pitchT = Math.atan2(dy, Math.hypot(dx, dz)) + this.aimErr.y;
      const turn = (this.target ? 220 + D.track * 40 : 260) * DEG * dt;
      const dyaw = angleDiff(yawT, this.yaw);
      this.yaw += Math.max(-turn, Math.min(turn, dyaw));
      this.pitch += Math.max(-turn, Math.min(turn, pitchT - this.pitch));
      // Aim error shrinks as the bot tracks the target.
      if (this.target) this.aimErr.multiplyScalar(Math.exp(-dt * D.track * 0.55));
    }
    if (!this.target || !this.target.alive) return;
    this.reaction -= dt;
    if (this.reaction > 0 || this.reloadT > 0 || !ws.canFire()) return;
    if (this.state === 'cover' && !this.peeking && this.cover && this.cover.peek) return;
    if (this.state === 'moveCover' || this.state === 'retreat') { if (Math.random() > 0.35) return; }
    if (this.burstPause > 0) { this.burstPause -= dt; return; }
    // Only shoot with a clear line.
    const muzzleSafe = g.physics.clear(this.eye, this.target.eye) || g.physics.clear(this.eye, _v2.set(this.target.body.p.x, this.target.body.p.y + 1.1, this.target.body.p.z));
    if (!muzzleSafe) return;
    if (this.burst <= 0) this.burst = Math.round(rand(D.burst[0], D.burst[1]));
    this.shoot();
    this.burst--;
    if (this.burst <= 0 || ws.modeName === 'semi' || ws.pump) this.burstPause = ws.pump ? rand(0.5, 0.9) : ws.modeName === 'semi' ? rand(0.18, 0.4) : rand(0.25, 0.7);
  }

  shoot() {
    const g = this.game;
    const ws = this.weapon;
    const kick = ws.fire();
    this.stats.shots++;
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const spread = (this.crouch ? 0.7 : 1) * 0.35 * DEG;
    jitter(dir, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2);
    // Recoil the bot has to fight
    this.pitch += kick[1] * DEG * 0.45;
    this.yaw += kick[0] * DEG * 0.45;
    this.aimErr.x += (Math.random() - 0.5) * 0.4 * DEG;
    const muzzle = this.h.gunMuzzle.clone();
    g.ballistics.fire(this.eye.clone(), dir, ws.stats, this, { tracer: Math.random() < 0.35, muzzle });
    g.effects.muzzleFlash(muzzle, dir, ws.pump ? 1.4 : 1, ws.stats.suppressed);
    const listener = g.camera.position;
    const dist = muzzle.distanceTo(listener);
    g.audio.gunshot(ws.stats.sound, { pos: muzzle, suppressed: ws.stats.suppressed, indoor: g.isIndoor(muzzle), dist });
    g.noise(muzzle, (ws.stats.suppressed ? 18 : 70), this);
    if (!ws.pump) g.effects.eject(ws.id === 'warden' ? '9mm' : '556', muzzle.clone().addScaledVector(dir, -0.4), new THREE.Vector3(Math.cos(this.yaw) * 2, 1.5, -Math.sin(this.yaw) * 2));
    this.h.recoil = 1;
    this.firedT = g.time;
  }

  visibility() {
    let v = this.crouch ? 0.75 : 1;
    if (this.game.isIndoor(this.body.p)) v *= 0.6;
    if (Math.hypot(this.body.v.x, this.body.v.z) > 3) v *= 1.3;
    return v;
  }
  firedRecently() { return this.game.time - (this.firedT || -9) < 0.5; }
}
