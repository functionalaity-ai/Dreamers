// The player: movement (sprint, tactical sprint, crouch, slide, prone, lean, mantle),
// first-person camera, weapons and grenades.
import * as THREE from 'three';
import { PLAYER, MATCH } from '../config.js';
import { WeaponState } from '../weapons/weapon.js';
import { jitter } from '../weapons/ballistics.js';
import { bodyHitTest, makePoints, pointsFromStance } from './hitbox.js';

const DEG = Math.PI / 180;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Player {
  constructor(game) {
    this.game = game;
    this.name = 'You';
    this.team = 'msg';
    this.isBot = false;
    this.body = { p: new THREE.Vector3(), v: new THREE.Vector3(), r: PLAYER.radius, h: PLAYER.height, step: PLAYER.step, grounded: true, onLand: (s) => this.onLand(s) };
    this.yaw = 0; this.pitch = 0;
    this.eye = new THREE.Vector3();
    this.eyeH = PLAYER.eye;
    this.stance = 'stand';
    this.stamina = PLAYER.stamina;
    this.staminaT = 0;
    this.sprint = false; this.tac = 0;
    this.slide = 0; this.slideDir = new THREE.Vector3();
    this.lean = 0;
    this.mantle = null;
    this.health = 100; this.armor = 100; this.alive = false;
    this.stats = { kills: 0, deaths: 0, score: 0, shots: 0, hits: 0, hs: 0 };
    this.weapons = [];
    this.cur = 0;
    this.frags = 2;
    this.kick = new THREE.Vector2();     // camera recoil offset (yaw, pitch)
    this.dip = 0;                       // landing dip
    this.stepDist = 0;
    this.lastHurt = -99;
    this.firedT = -9;
    this.sprintBlock = 0;
    this.pts = makePoints();
    this.lastShift = -9;
    this.sprintT = -9;
  }

  get ws() { return this.weapons[this.cur]; }

  setLoadout(lo) {
    this.loadout = lo;
    this.weapons = [new WeaponState(lo.primary, (lo.att || {})[lo.primary]), new WeaponState(lo.secondary, (lo.att || {})[lo.secondary])];
    this.cur = 0;
  }

  spawn(p, yaw) {
    this.body.p.copy(p);
    this.body.v.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.health = 100; this.armor = 100; this.alive = true;
    this.stance = 'stand'; this.eyeH = PLAYER.eye; this.body.h = PLAYER.height;
    this.stamina = PLAYER.stamina; this.slide = 0; this.lean = 0; this.mantle = null; this.tac = 0;
    this.setLoadout(this.loadout);
    this.frags = 2;
    this.spawnT = this.game.time;
    this.game.vm.setWeapon(this.ws);
    this.game.vm.startDraw();
    this.game.showViewmodel(true);
  }

  // --- damage ------------------------------------------------------------------------
  hitTest(a, d, len) {
    if (!this.alive) return null;
    pointsFromStance(this.body.p, this.eye.y, this.yaw, this.pts);
    return bodyHitTest(this.pts, a, d, len);
  }

  takeDamage(dmg, info) {
    if (!this.alive) return 0;
    if (this.game.time - this.spawnT < MATCH.spawnProtect) return 0;
    let d = dmg;
    if (info.zone === 'chest' && this.armor > 0) {
      const absorbed = d * 0.45;
      this.armor = Math.max(0, this.armor - absorbed * 1.3);
      d -= absorbed;
    }
    this.health -= d;
    this.lastHurt = this.game.time;
    this.kick.y += 0.6 * DEG; this.kick.x += (Math.random() - 0.5) * 1.2 * DEG;
    this.game.hud.damage(info.attacker ? info.attacker.body.p : null, d);
    this.game.audio.foley('hurt');
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    return d;
  }

  visibility() {
    let v = this.stance === 'prone' ? 0.45 : this.stance === 'crouch' ? 0.75 : 1;
    if (this.game.isIndoor(this.body.p)) v *= 0.6;
    const sp = Math.hypot(this.body.v.x, this.body.v.z);
    if (sp > 5) v *= 1.4; else if (sp > 1) v *= 1.15;
    return v;
  }
  firedRecently() { return this.game.time - this.firedT < 0.5; }

  onLand(speed) {
    const h = speed * speed / (2 * PLAYER.gravity);
    this.dip = Math.min(0.12, speed * 0.012);
    if (speed > 4) this.game.audio.foley('land');
    if (h > PLAYER.fallSafe && this.alive) {
      this.takeDamage((h - PLAYER.fallSafe) * PLAYER.fallDamage, { zone: 'leg', dir: new THREE.Vector3(0, -1, 0) });
    }
  }

  // --- per frame ------------------------------------------------------------------------
  update(dt, input, settings) {
    const g = this.game;
    const vm = g.vm;
    if (!this.alive) return;
    // Look
    const sens = 0.0022 * settings.sens * (vm.adsT > 0.5 ? settings.adsSens * (this.ws.stats.scoped ? 0.55 : 0.85) : 1);
    this.yaw -= input.mouse.dx * sens;
    this.pitch -= input.mouse.dy * sens * (settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    this.handleStance(dt, input);
    this.handleMove(dt, input);
    this.handleWeapon(dt, input);
    // Regenerate health after a pause
    if (!g.noRegen && g.time - this.lastHurt > MATCH.regenDelay && this.health < 100) this.health = Math.min(100, this.health + MATCH.regenRate * dt);
    this.updateCamera(dt);
    vm.update(dt, {
      adsTarget: input.mouse.right && !this.mantle,
      speed: Math.hypot(this.body.v.x, this.body.v.z), sprint: this.sprint && this.slide <= 0, tac: this.tac > 0,
      crouch: this.stance !== 'stand', look: { x: input.mouse.dx, y: input.mouse.dy },
      camera: g.camera, playerVel: this.body.v, grounded: this.body.grounded,
    });
  }

  handleStance(dt, input) {
    const ph = this.game.physics;
    const p = this.body.p;
    const canStand = (h) => ph.boxFree(p.x - 0.28, p.y + 0.4, p.z - 0.28, p.x + 0.28, p.y + h, p.z + 0.28);
    const sp = Math.hypot(this.body.v.x, this.body.v.z);
    if (input.pressed('KeyC') || input.pressed('ControlLeft')) {
      if (this.sprint && sp > 5 && this.body.grounded && this.slide <= 0) {
        this.slide = 0.8;
        this.slideDir.set(this.body.v.x, 0, this.body.v.z).normalize();
        this.stance = 'crouch';
        this.game.audio.foley('land');
      } else if (this.stance === 'crouch') { if (canStand(PLAYER.height)) this.stance = 'stand'; }
      else this.stance = 'crouch';
    }
    if (input.pressed(this.game.proneKey || 'KeyZ')) {
      if (this.stance === 'prone') { if (canStand(PLAYER.crouchHeight)) this.stance = 'crouch'; }
      else if (this.body.grounded) this.stance = 'prone';
    }
    if (this.stance !== 'stand' && (input.pressed('Space')) && !this.mantle) {
      const h = this.stance === 'prone' ? PLAYER.crouchHeight : PLAYER.height;
      if (canStand(h)) { this.stance = this.stance === 'prone' ? 'crouch' : 'stand'; input.consume('Space'); }
    }
    this.body.h = this.stance === 'prone' ? PLAYER.proneHeight : this.stance === 'crouch' ? PLAYER.crouchHeight : PLAYER.height;
    let target = this.stance === 'prone' ? PLAYER.proneEye : this.stance === 'crouch' ? PLAYER.crouchEye : PLAYER.eye;
    if (this.slide > 0) target = PLAYER.slideEye;
    this.eyeH += (target - this.eyeH) * Math.min(1, dt * 10);
    // Lean with a wall check
    const want = (input.down('KeyE') ? 1 : 0) - (input.down('KeyQ') ? 1 : 0);
    let lim = 1;
    if (want !== 0) {
      const right = _v.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(want);
      const hit = ph.raycast(_v2.set(p.x, p.y + this.eyeH, p.z), right, 0.6);
      if (hit) lim = Math.max(0, (hit.t - 0.2) / 0.4);
    }
    this.lean += (want * lim - this.lean) * Math.min(1, dt * 9);
  }

  handleMove(dt, input) {
    const g = this.game, b = this.body;
    if (this.mantle) {
      const m = this.mantle;
      m.t += dt / 0.42;
      const k = Math.min(1, m.t);
      const e = k * k * (3 - 2 * k);
      b.p.lerpVectors(m.from, m.to, e);
      b.p.y = m.from.y + (m.to.y - m.from.y) * Math.min(1, e * 1.6);
      b.v.set(0, 0, 0);
      if (k >= 1) { this.mantle = null; b.grounded = true; }
      return;
    }
    let fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    let str = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    // The touch thumbstick is analog: a light push walks slowly.
    if (input.stick) { fwd = input.stick.y; str = input.stick.x; }
    const sx = -Math.sin(this.yaw), sz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const wish = _v.set(sx * fwd + rx * str, 0, sz * fwd + rz * str);
    if (wish.lengthSq() > 1) wish.normalize();
    // Sprint (double tap Shift while sprinting for a short tactical sprint). The second tap
    // lands just after the first one's sprint ended, so look back a moment for it.
    if (input.pressed('ShiftLeft')) {
      if (g.time - this.sprintT < 0.3 && this.stamina > 25 && g.time - this.lastShift < 0.45) this.tac = 3;
      this.lastShift = g.time;
    }
    const canSprint = fwd > 0 && this.stance === 'stand' && this.stamina > 1 && this.sprintBlock <= 0 && !input.mouse.right;
    this.sprint = input.down('ShiftLeft') && canSprint;
    if (this.sprint) this.sprintT = g.time;
    if (!this.sprint) this.tac = 0;
    if (this.tac > 0) { this.tac -= dt; this.stamina -= PLAYER.tacDrain * dt; if (this.stamina <= 0) this.tac = 0; }
    else if (this.sprint) this.stamina -= PLAYER.sprintDrain * dt;
    if (this.sprint) this.staminaT = 0; else { this.staminaT += dt; if (this.staminaT > 1) this.stamina = Math.min(PLAYER.stamina, this.stamina + PLAYER.staminaRegen * dt); }
    this.stamina = Math.max(0, this.stamina);
    this.sprintBlock -= dt;
    let speed = this.stance === 'prone' ? PLAYER.prone : this.stance === 'crouch' ? PLAYER.crouch : this.tac > 0 ? PLAYER.tacSprint : this.sprint ? PLAYER.sprint : PLAYER.walk;
    if (g.vm.adsT > 0.3) speed *= PLAYER.adsMul;
    speed *= 1 - Math.max(0, this.ws.stats.weight - 1) * 0.035;
    if (this.slide > 0) {
      this.slide -= dt;
      const sp = 3 + 5.2 * Math.max(0, this.slide / 0.8);
      b.v.x = this.slideDir.x * sp; b.v.z = this.slideDir.z * sp;
    } else {
      const accel = b.grounded ? 11 : 1.6;
      b.v.x += (wish.x * speed - b.v.x) * Math.min(1, dt * accel);
      b.v.z += (wish.z * speed - b.v.z) * Math.min(1, dt * accel);
    }
    // Jump or mantle
    if (input.pressed('Space') && b.grounded && this.stance === 'stand') {
      const m = this.findMantle(sx, sz);
      if (m) { this.mantle = m; g.audio.foley('jump'); }
      else { b.v.y = PLAYER.jump; b.grounded = false; g.audio.foley('jump'); }
    }
    g.physics.move(b, dt);
    // Footsteps (and the noise bots hear)
    const sp = Math.hypot(b.v.x, b.v.z);
    if (b.grounded && sp > 0.5) {
      this.stepDist += sp * dt;
      const stride = this.sprint ? 2.3 : this.stance === 'crouch' ? 1.4 : 1.9;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const surf = g.surfaceAt(b.p);
        if (this.stance === 'stand') g.audio.footstep(null, surf, this.sprint);
        if (this.sprint) g.noise(b.p, 13, this);
        else if (this.stance === 'stand' && sp > 3) g.noise(b.p, 6, this);
      }
    }
  }

  // Vault onto/over an obstacle between knee and chest height in front of us.
  findMantle(sx, sz) {
    const ph = this.game.physics, p = this.body.p;
    for (const dist of [0.45, 0.75]) {
      const x = p.x + sx * dist, z = p.z + sz * dist;
      const top = ph.groundHeight(x, z, 0.15, p.y + 1.35);
      const rise = top - p.y;
      if (rise < 0.5 || rise > 1.35) continue;
      if (!ph.boxFree(x - 0.28, top + 0.05, z - 0.28, x + 0.28, top + 1.75, z + 0.28)) continue;
      if (!ph.boxFree(p.x - 0.25, p.y + 0.4, p.z - 0.25, p.x + 0.25, top + 1.7, p.z + 0.25)) continue;
      return { t: 0, from: p.clone(), to: new THREE.Vector3(x + sx * 0.25, top, z + sz * 0.25) };
    }
    return null;
  }

  updateCamera(dt) {
    const cam = this.game.camera;
    // Recoil recovers towards zero
    const rec = this.ws.stats.recoil.recover;
    this.kick.multiplyScalar(Math.exp(-dt * rec));
    this.dip *= Math.exp(-dt * 8);
    const leanOff = this.lean * 0.34;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.eye.set(this.body.p.x + rx * leanOff, this.body.p.y + this.eyeH - this.dip - Math.abs(this.lean) * 0.06, this.body.p.z + rz * leanOff);
    cam.position.copy(this.eye);
    cam.rotation.set(0, 0, 0, 'YXZ');
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + this.kick.x;
    cam.rotation.x = this.pitch + this.kick.y;
    cam.rotation.z = -this.lean * 9 * DEG;
  }

  handleWeapon(dt, input) {
    const g = this.game, vm = g.vm;
    for (const w of this.weapons) w.update(dt);
    const ws = this.ws;
    // Switch weapons
    let sw = -1;
    if (input.pressed('Digit1')) sw = 0;
    if (input.pressed('Digit2')) sw = 1;
    if (input.mouse.wheel) sw = 1 - this.cur;
    if (sw >= 0 && sw !== this.cur && (!vm.busy() || vm.action.name === 'shotgunReload')) {
      vm.startHolster(() => { this.cur = sw; vm.setWeapon(this.ws); vm.startDraw(); });
      return;
    }
    if (input.pressed('KeyB') && ws.toggleMode()) { g.audio.foley('selector'); g.hud.notice(ws.modeName === 'auto' ? 'Full auto' : 'Semi-auto'); if (vm.gun.parts.selector) vm.gun.parts.selector.rotation.x = ws.modeName === 'auto' ? -1.4 : -0.7; }
    if (input.pressed('KeyR') && ws.canReload() && !vm.busy()) {
      vm.startReload((ev) => { if (ev === 'rack') ws.rack(); g.hud.refreshAmmo(); });
    }
    if (input.pressed('KeyT') && !vm.busy()) vm.startMagCheck((ev) => { if (ev === 'magCheck') g.hud.notice('Mag check: ' + ws.magCheck()); });
    if (input.pressed('KeyG') && this.frags > 0 && !vm.busy()) {
      this.frags--;
      g.audio.foley('pin');
      vm.startThrow(() => {
        const cam = g.camera;
        const f = cam.getWorldDirection(new THREE.Vector3());
        const vel = f.clone().multiplyScalar(15).add(new THREE.Vector3(0, 3, 0)).add(this.body.v);
        g.throwGrenade(this, this.eye.clone().addScaledVector(f, 0.4), vel);
      });
    }
    // Pump after a shotgun shot
    if (ws.pump && ws.needsPump && ws.cooldown <= 0.15 && !vm.busy() && !input.mouse.left) vm.startPump((ev) => { if (ev === 'rack') ws.rack(); });
    // Fire
    const wantFire = ws.modeName === 'auto' ? input.mouse.left : input.mouse.leftPressed;
    if (input.mouse.leftPressed && vm.action && vm.action.name === 'shotgunReload') vm.cancelReload();
    if (wantFire) {
      if (this.sprint) { this.sprint = false; this.tac = 0; this.sprintBlock = 0.35; return; }
      if (vm.busy() || this.mantle) return;
      if (ws.loaded === 0 || (!ws.chambered && !ws.pump)) {
        if (input.mouse.leftPressed) { g.audio.foley('dry'); if (ws.canReload()) vm.startReload((ev) => { if (ev === 'rack') ws.rack(); g.hud.refreshAmmo(); }); }
        return;
      }
      if (ws.canFire()) this.fire();
    }
  }

  fire() {
    const g = this.game, vm = g.vm, ws = this.ws, s = ws.stats;
    const kick = ws.fire();
    this.firedT = g.time;
    this.stats.shots++;
    const ads = vm.adsT;
    const recoilMul = (this.stance === 'prone' ? 0.55 : this.stance === 'crouch' ? 0.8 : 1) * (1 - ads * 0.15);
    this.kick.x += kick[0] * DEG * recoilMul;
    this.kick.y += kick[1] * DEG * recoilMul;
    // Recoil also nudges where you're actually looking (partially recovered by kick decay).
    this.pitch += kick[1] * DEG * 0.35 * recoilMul;
    vm.onFire();
    // Spread: hip-fire cone shrinks as you aim down sights.
    const moving = Math.hypot(this.body.v.x, this.body.v.z) > 0.8;
    let spread = s.hipSpread * (1 - ads) + s.adsSpread * ads;
    if (moving) spread += s.moveSpread * (1 - ads * 0.7);
    if (!this.body.grounded) spread *= 2;
    spread *= this.stance === 'prone' ? 0.6 : this.stance === 'crouch' ? 0.8 : 1;
    const cam = g.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const r = Math.sqrt(Math.random()) * spread * DEG, a = Math.random() * Math.PI * 2;
    jitter(dir, Math.cos(a) * r, Math.sin(a) * r);
    const muzzle = vm.muzzleWorld(cam);
    g.ballistics.fire(this.eye.clone(), dir, s, this, { tracer: ws.shotIndex % 4 < 1, muzzle });
    const L = g.effects.lights.reduce((x, y) => (x.t > y.t ? x : y));
    L.l.position.copy(muzzle); L.t = 0; L.peak = s.suppressed ? 1.5 : 14;
    g.audio.gunshot(s.sound, { suppressed: s.suppressed, indoor: g.isIndoor(this.body.p) });
    g.noise(this.eye, s.suppressed ? 20 : 75, this);
    g.hud.refreshAmmo();
    g.hud.bloom(spread);
  }
}
