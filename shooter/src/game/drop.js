// Battle royale insertion: everyone rides a transport aircraft across the map, jumps from the
// open ramp, freefalls, opens a ram-air canopy and flies it down to a landing (rooftops count).
//
//   const drop = new Drop(game);         // game: scene, R, mats, physics, bounds, audio, player, camera
//   drop.onLand = (char, info) => { ... };   // once per character on touchdown
//   drop.begin({ a, b }, riders);        // a → b: the aircraft's line at altitude (y ≈ 420)
//   drop.plan(bot, { x, z });            // bots: where to land (before or after begin)
//   each frame: drop.update(dt, input)   // after the game's own update: it owns the camera
//                                        // while the player is aboard or airborne
// While drop.state(char) !== 'landed', don't run that character's normal update: the Drop sets
// `char.airborne = true` (Player.update returns early on it; skip Bot.update yourselves) and
// clears it on touchdown, when the player's first-person view and viewmodel come back.
//
// Physics (SI units, real gravity): freefall has quadratic drag to a ~55 m/s belly-to-earth
// terminal (~70 m/s head down), the aircraft's forward throw bleeding off, and tracking forces
// of up to ~20 m/s horizontal. The opening runs pilot chute → bag → line stretch → inflation over
// ~2.5 s with a 3–4 g peak. The canopy flies at ~11 m/s and sinks at ~5 m/s, with toggles for
// turns and brakes, front risers for speed and a flare that trades speed for a soft landing.
// A light wind drifts everyone.
//
// Controls (player): aboard: Space/F jump (when the jump light is green), mouse orbits the view.
// Freefall: mouse turns, W dives head down and tracks forward, S slows/backslides, A/D side
// slide, Space/F opens the canopy (below 400 m above the ground; it opens itself at 140 m).
// Canopy: A/D left/right toggle (turn), S brakes, W front risers (faster), Space/F flare,
// mouse looks around.
import * as THREE from 'three';
import { Aircraft } from '../world/aircraft.js';
import { Parachute, SCHEMES, CANOPY } from '../characters/parachute.js';
import { Humanoid } from '../characters/humanoid.js';

const G = 9.81;
const K_BELLY = G / (55 * 55), K_DIVE = G / (70 * 70), K_SLOW = G / (49 * 49);
const TRACK = 20, SIDE = 9, BACK = 5;
export const DEPLOY_MAX = 400, AUTO_DEPLOY = 140;
const V_GLIDE = 11, W_GLIDE = 5.1;
const HIPS = 0.97;                 // hips above the feet, standing
const HARNESS = 0.5;               // shoulders (risers) above the hips
const STEP = 1 / 60;
const LINE_STRETCH = 0.85, INFLATE = 2.0;   // seconds after the pull
const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const fwdOf = (yaw, out) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
const yawOf = (x, z) => Math.atan2(-x, -z);

export class Drop {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.mats = game.mats;
    this.audio = game.audio;
    this.riders = new Map();
    this.plans = new Map();
    this.plane = null;
    this.wind = new THREE.Vector3(1.6, 0, 0.9);
    this.sens = 1;                     // mouse sensitivity (the match can copy settings.sens)
    this.onLand = () => {};
    this.time = 0;
    this.cam = { yaw: 0.5, pitch: -0.3, off: new THREE.Vector3(), ready: false, lookYaw: 0, idle: 0 };
    this.chutes = [];                  // collapsing canopies left on the ground
    this.scheme = 0;
    this._tmp = [];
  }

  get active() {
    if (this.plane) return true;
    for (const r of this.riders.values()) if (r.state !== 'landed') return true;
    return false;
  }

  // --- public queries ------------------------------------------------------------------------
  // the plane, for the map screen: is it still flying, and where it is
  get flying() { return !!this.plane; }
  get pos() { return this.plane ? this.plane.group.position : null; }
  state(c) { const r = this.riders.get(c); return r ? r.state : 'landed'; }
  canJump(c) { const r = this.riders.get(c); return !!(r && r.state === 'plane' && this.plane && this.plane.overMap); }
  canDeploy(c) { const r = this.riders.get(c); return !!(r && r.state === 'freefall' && r.pull < 0 && this.agl(r) < DEPLOY_MAX); }
  // Height of the feet above the world datum (y = 0), m.
  altitude(c) { const r = this.riders.get(c); return r && r.state !== 'landed' ? this.feet(r).y : c.body.p.y; }
  // Height of the feet above whatever is below (ground or a roof), m.
  distanceToGround(c) {
    const r = this.riders.get(c);
    if (r && r.state !== 'landed') return this.agl(r);
    const p = c.body.p;
    return Math.max(0, p.y - this.ground(p.x, p.z, p.y + 0.05));
  }
  // Speed through the air, m/s (aboard: the aircraft's).
  speed(c) {
    const r = this.riders.get(c);
    if (!r || r.state === 'landed') return Math.hypot(c.body.v.x, c.body.v.y, c.body.v.z);
    if (r.state === 'plane') return this.plane ? this.plane.speed : 0;
    return r.v.length();
  }
  verticalSpeed(c) { const r = this.riders.get(c); return r && (r.state === 'freefall' || r.state === 'canopy') ? -r.v.y : 0; }
  gLoad(c) { const r = this.riders.get(c); return r ? r.g : 1; }
  // Where the rider is in the opening: 0 not pulled .. 1 canopy flying.
  opening(c) { const r = this.riders.get(c); return r && r.pull >= 0 ? clamp(r.pull / (LINE_STRETCH + INFLATE), 0, 1) : 0; }

  // --- setup -----------------------------------------------------------------------------------
  begin(path, riders) {
    this.dispose();
    const g = this.game;
    this.path = { a: path.a.clone(), b: path.b.clone() };
    this.plane = new Aircraft(this.mats);
    this.plane.setPath(this.path.a, this.path.b, path.speed || 70, path.lead !== undefined ? path.lead : 150);
    this.scene.add(this.plane.group);
    this.time = 0;
    this.cam.ready = false;
    riders.forEach((c, i) => {
      const r = {
        c, state: 'plane', seat: i, p: new THREE.Vector3(), v: new THREE.Vector3(), yaw: 0, t: 0, pull: -1,
        dive: 0, slow: 0, g: 1, chute: null, h: c.h || null, own: false,
        tog: { L: 0, R: 0 }, fr: 0, flare: 0, bank: 0, sway: 0, swayV: 0, turn: 0, heading: 0, legs: 0,
        plan: null, hidden: false,
      };
      this.riders.set(c, r);
      c.airborne = true;
      if (c.h) c.h.group.visible = false;
      if (c.body) { c.body.v.set(0, 0, 0); c.body.grounded = false; }
      if (this.plans.has(c)) this.plan(c, this.plans.get(c));
      else if (c.isBot) this.plan(c, this.randomTarget());
    });
    if (riders.includes(g.player) && g.showViewmodel) g.showViewmodel(false);
    this.placeAboard();
  }

  randomTarget() {
    const B = this.game.bounds || { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    return { x: B.minX + (B.maxX - B.minX) * (0.1 + 0.8 * Math.random()), z: B.minZ + (B.maxZ - B.minZ) * (0.1 + 0.8 * Math.random()) };
  }

  // Bots: land near target {x, z}. Jump where the forward throw carries the jumper level with
  // the target, then track and glide to it.
  plan(c, target) {
    this.plans.set(c, target);
    const r = this.riders.get(c);
    if (!r || !this.plane) return;
    const P = this.plane, a = this.path.a;
    const along = (target.x - a.x) * P.dir.x + (target.z - a.z) * P.dir.z;
    const carry = 115;
    r.plan = { target: { x: target.x, z: target.z }, jumpS: clamp(along - carry + (Math.random() - 0.5) * 30, 2, P.len - 2), deployK: 0.9 + Math.random() * 0.25 };
  }

  // --- leaving the aircraft --------------------------------------------------------------------
  jump(c) {
    const r = this.riders.get(c);
    if (!r || r.state !== 'plane' || !this.plane) return false;
    const P = this.plane;
    P.rampPoint(1.02, r.p, (Math.random() - 0.5) * 1.4);
    r.p.y += HIPS * 0.4;
    r.v.copy(P.vel).addScaledVector(P.dir, -2).add(_v.set(0, -1.5, 0));
    r.yaw = yawOf(P.dir.x, P.dir.z) + (Math.random() - 0.5) * 0.3;
    r.state = 'freefall';
    r.t = 0;
    if (!r.h) { r.h = this.makeBody(c); r.own = true; }
    r.h.group.visible = true;
    r.h.pose('freefall', 1);
    if (c === this.game.player) {
      this.cam.ready = false;
      this.blip({ freq: 700, dur: 0.5, vol: 0.35, filter: 'lowpass' });
    }
    this.syncChar(r);
    return true;
  }

  // The player has no third-person body: borrow an operator for the descent.
  makeBody(c) {
    const faction = c.team === 'volk' ? 'volk' : 'msg';
    const mat = (this.mats.char && (this.mats.char[c.team] || this.mats.char[faction])) || new THREE.MeshStandardMaterial({ vertexColors: true });
    const h = new Humanoid(mat, faction, 4242);
    this.scene.add(h.group);
    return h;
  }

  // --- per frame -----------------------------------------------------------------------------------
  update(dt, input) {
    dt = Math.min(0.05, Math.max(0, dt));
    this.time += dt;
    const g = this.game, P = this.plane;
    if (P) {
      P.update(dt);
      P.sound(this.audio, g.camera, dt);
      this.placeAboard();
      // the jump window ends with the map: anyone still aboard goes out the door
      const end = P.s >= P.len;
      let i = 0;
      for (const r of this.riders.values()) {
        if (r.state !== 'plane') continue;
        const bot = r.c !== g.player;
        if (end) { if (!r.stagger) r.stagger = this.time + (i++) * 0.18; if (this.time >= r.stagger) this.jump(r.c); continue; }
        if (bot && r.plan && P.overMap && P.s >= r.plan.jumpS) this.jump(r.c);
      }
      if (P.s > P.len + 900 && !this.anyAboard()) { P.dispose(); this.plane = null; }
    }
    const pr = this.riders.get(g.player);
    if (pr && pr.state === 'plane' && input && P && P.overMap && (input.pressed('Space') || input.pressed('KeyF'))) {
      this.jump(g.player);
      input.consume('Space');
    }
    for (const r of this.riders.values()) {
      if (r.state === 'freefall' || r.state === 'canopy') {
        const ctl = r.c === g.player ? this.playerControl(r, input, dt) : this.botControl(r, dt);
        this.simulate(r, ctl, dt);
      } else if (r.state === 'landed' && r.chute) {
        this.collapse(r, dt);
      }
    }
    if (pr && pr.state !== 'landed') this.camera(pr, input, dt);
    this.sounds(pr, dt);
  }

  anyAboard() { for (const r of this.riders.values()) if (r.state === 'plane') return true; return false; }

  // Riders aboard ride in the hold (their positions stay meaningful for maps and radars).
  placeAboard() {
    if (!this.plane) return;
    for (const r of this.riders.values()) {
      if (r.state !== 'plane') continue;
      this.plane.holdPoint(r.seat, r.p);
      r.v.copy(this.plane.vel);
      const c = r.c;
      if (c.body) { c.body.p.copy(r.p); c.body.v.copy(r.v); }
      if (c.eye) c.eye.copy(r.p).add(_v.set(0, 1.5, 0));
    }
  }

  // --- control ----------------------------------------------------------------------------------
  playerControl(r, input, dt) {
    const ctl = { fwd: 0, side: 0, turn: 0, pull: false, togL: 0, togR: 0, fr: 0, flare: false };
    if (!input) return ctl;
    let fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    let side = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    if (input.stick) { fwd = input.stick.y; side = input.stick.x; }
    const sp = input.pressed('Space') || input.pressed('KeyF');
    const hold = input.down('Space') || input.down('KeyF');
    if (r.state === 'freefall') {
      ctl.fwd = fwd; ctl.side = side;
      ctl.turn = -input.mouse.dx * 0.0022 * this.sens / Math.max(dt, 1e-3);
      ctl.pull = sp;
      if (sp) input.consume('Space');
    } else {
      ctl.togL = Math.max(side < 0 ? -side : 0, fwd < 0 ? -fwd * 0.85 : 0);
      ctl.togR = Math.max(side > 0 ? side : 0, fwd < 0 ? -fwd * 0.85 : 0);
      ctl.fr = fwd > 0 ? fwd : 0;
      // a tap flares for a moment (touch has no held jump), holding keeps it
      if (sp) r.flareHold = 0.9;
      r.flareHold = Math.max(0, (r.flareHold || 0) - dt);
      ctl.flare = hold || r.flareHold > 0;
      if (sp) input.consume('Space');
    }
    return ctl;
  }

  botControl(r, dt) {
    const ctl = { fwd: 0, side: 0, turn: 0, pull: false, togL: 0, togR: 0, fr: 0, flare: false };
    const c = r.c;
    if (c.alive === false || !r.plan) return ctl;
    const T = r.plan.target;
    const dx = T.x - r.p.x, dz = T.z - r.p.z, dist = Math.hypot(dx, dz);
    const agl = this.agl(r);
    const want = yawOf(dx, dz);
    const err = angleDiff(want, r.yaw);
    if (r.state === 'freefall') {
      ctl.turn = clamp(err * 2, -1.6, 1.6);
      const glide = V_GLIDE / W_GLIDE;
      // track toward the target; slow down when the aircraft's throw would carry past it
      const close = Math.hypot(r.v.x - this.wind.x, r.v.z - this.wind.z) * (dx * r.v.x + dz * r.v.z > 0 ? 1 : -1);
      ctl.fwd = Math.abs(err) < 0.7 ? clamp(dist / 80, 0, 1) : 0;
      if (close > dist / 4 + 8) ctl.fwd = -1;
      // an opening costs ~110 m; then the canopy glides about 2.2 : 1
      // (bots open no lower than ~200 m, leaving canopy time to fix their aim)
      const need = clamp((dist / glide + 125) * r.plan.deployK, 190 * r.plan.deployK, DEPLOY_MAX - 6);
      if (agl < need) ctl.pull = true;
    } else {
      // glide slope: brake or circle when too high for the distance, full glide when short;
      // a straight final approach, and a flare at the bottom
      const req = dist / Math.max(1, agl - 6);
      let head = want, brakes = 0;
      if (agl > 24 && req < 1.0) {
        // too high: orbit the target at ~12 m (inward when outside, outward when inside)
        if (dist < 70) head = want + Math.PI / 2 - clamp((dist - 12) / 20, -1, 1) * 1.2;
        else brakes = 0.8;
      } else if (req < 1.9) brakes = clamp((1.9 - req) / 0.8, 0, 0.7);
      if (agl < 10) brakes = 0;
      const e = angleDiff(head, r.yaw);
      const d = clamp(-e * (agl < 30 ? 0.8 : 1.2), -1, 1);
      ctl.togL = Math.max(brakes, d < 0 ? -d : 0);
      ctl.togR = Math.max(brakes, d > 0 ? d : 0);
      ctl.flare = agl < 4.6 + Math.max(0, -r.v.y - 4) * 0.5;
    }
    void dt;
    return ctl;
  }

  // --- physics --------------------------------------------------------------------------------------
  simulate(r, ctl, dt) {
    const n = Math.max(1, Math.ceil(dt / STEP)), h = dt / n;
    for (let i = 0; i < n; i++) {
      if (r.state === 'freefall') this.freefall(r, ctl, h);
      else if (r.state === 'canopy') this.flyCanopy(r, ctl, h);
      if (r.state === 'landed') return;
    }
    this.pose(r, ctl, dt);
    this.syncChar(r);
  }

  freefall(r, ctl, dt) {
    if (r.pull >= 0) { this.flyCanopy(r, ctl, dt); return; }
    r.t += dt;
    r.yaw += ctl.turn * dt;
    const wantDive = ctl.fwd > 0 ? ctl.fwd : 0, wantSlow = ctl.fwd < 0 ? -ctl.fwd : 0;
    r.dive += (wantDive - r.dive) * Math.min(1, dt * 1.4);
    r.slow += (wantSlow - r.slow) * Math.min(1, dt * 1.8);
    r.side = (r.side || 0) + ((ctl.side || 0) - (r.side || 0)) * Math.min(1, dt * 2);
    const k = (K_BELLY + (K_DIVE - K_BELLY) * r.dive) * (1 - r.slow) + K_SLOW * r.slow;
    const air = _v.copy(r.v).sub(this.wind);
    const sp = air.length();
    const acc = _v2.set(0, -G, 0).addScaledVector(air, -k * sp);
    // tracking: the body's shape drives it across the sky (up to ~0.7 g of "lift")
    const f = fwdOf(r.yaw, _v3);
    const des = new THREE.Vector3(f.x * (TRACK * r.dive - BACK * r.slow) + f.z * -SIDE * r.side, 0, f.z * (TRACK * r.dive - BACK * r.slow) - f.x * -SIDE * r.side);
    const trk = des.clone().multiplyScalar(k * sp).add(des.clone().sub(_v3.set(air.x, 0, air.z)).multiplyScalar(0.8));
    if (trk.length() > 7) trk.setLength(7);
    acc.add(trk);
    r.g = Math.hypot(acc.x, acc.y + G, acc.z) / G;
    r.v.addScaledVector(acc, dt);
    r.p.addScaledVector(r.v, dt);
    this.collide(r, dt);
    const agl = this.agl(r);
    if ((ctl.pull && agl < DEPLOY_MAX) || agl < AUTO_DEPLOY) this.pull(r);
    if (agl <= 0) this.land(r);
  }

  pull(r) {
    if (r.pull >= 0) return;
    r.pull = 0;
    r.heading = r.yaw + (Math.random() - 0.5) * 0.25;
    // the player's canopy is navy, white and yellow; the bots' cycle through the other schemes
    const bots = SCHEMES.map((s, i) => i).filter((i) => i !== 2);
    r.chute = new Parachute({ scheme: r.c === this.game.player ? 2 : bots[this.scheme++ % bots.length] });
    r.chute.group.visible = false;
    this.scene.add(r.chute.group);
    r.tog.L = r.tog.R = 0.45;   // the brakes are set on the pack: released once flying
    r.stowed = true;
    if (r.c === this.game.player) { this.blip({ freq: 2200, dur: 0.03, vol: 0.3 }); this.blip({ freq: 500, dur: 0.9, vol: 0.25, filter: 'lowpass', delay: 0.15 }); }
  }

  flyCanopy(r, ctl, dt) {
    r.t += dt;
    r.pull += dt;
    const tau = r.pull;
    const air = _v.copy(r.v).sub(this.wind);
    const sp = air.length();
    if (tau > LINE_STRETCH && r.state === 'freefall') {
      r.state = 'canopy';
      if (r.c === this.game.player) { this.blip({ freq: 900, dur: 0.07, vol: 0.6 }); this.blip({ freq: 260, dur: 0.7, vol: 0.55, filter: 'lowpass', delay: 0.05 }); }
    }
    // toggles: ease toward the inputs (stowed brakes release once the canopy flies)
    const open = clamp((tau - LINE_STRETCH) / INFLATE, 0, 1);
    if (r.stowed && open >= 1 && (r.c !== this.game.player || ctl.togL + ctl.togR + (ctl.flare ? 1 : 0) > 0 || tau > LINE_STRETCH + INFLATE + 1.2)) r.stowed = false;
    const fl = ctl.flare && open >= 1 ? 1 : 0;
    r.flare += (fl - r.flare) * Math.min(1, dt * (fl ? 5 : 1.4));
    const tL = r.stowed ? 0.45 : Math.max(ctl.togL, r.flare), tR = r.stowed ? 0.45 : Math.max(ctl.togR, r.flare);
    r.tog.L += (tL - r.tog.L) * Math.min(1, dt * 4);
    r.tog.R += (tR - r.tog.R) * Math.min(1, dt * 4);
    r.fr += ((r.flare > 0.1 ? 0 : ctl.fr) - r.fr) * Math.min(1, dt * 2.5);
    const brakes = Math.min(r.tog.L, r.tog.R), d = r.tog.R - r.tog.L;
    // glide polar: brakes slow it and flatten the sink a little, front risers speed it up,
    // turning (one toggle) steepens it
    let V = V_GLIDE - 5.6 * brakes + 2.6 * r.fr;
    let W = W_GLIDE - 1.2 * brakes + 2.2 * r.fr + 2.4 * Math.abs(d);
    const hd = fwdOf(r.heading, _v2);
    const vf = air.x * hd.x + air.z * hd.z;
    if (r.flare > 0.01) {
      // the flare: the canopy pitches up and turns the airspeed that is left into lift
      const L = clamp(vf / V_GLIDE, 0, 1.2);
      V = V + (2.4 - V) * r.flare;
      W = Math.max(-0.4, W * (1 - r.flare * 1.3 * L) + r.flare * (1 - L) * 0.8);
    }
    const turnRate = -0.85 * d * clamp(vf / V_GLIDE, 0.3, 1.2);
    if (open > 0.6) r.heading += turnRate * dt * smooth((open - 0.6) / 0.4);
    r.bank += (Math.atan(clamp(vf, 0, 15) * turnRate / G) - r.bank) * Math.min(1, dt * 2.2);
    r.yaw = r.heading;
    // acceleration toward the polar, limited by how much canopy there is: the opening shock
    const rateH = r.flare > 0.1 ? 1.0 : 1.1, rateV = r.flare > 0.1 ? 4 : 2.4;
    const acc = _v3.set((hd.x * V - air.x) * rateH, (-W - air.y) * rateV, (hd.z * V - air.z) * rateH);
    let aMax = 30;
    if (open < 1) {
      const x = clamp((tau - LINE_STRETCH) / INFLATE, 0, 1);
      aMax = tau < LINE_STRETCH ? 0 : 3 + 25 * Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.1)), 0.8);
      if (x > 0.87) aMax = Math.max(aMax, 30 * (x - 0.87) / 0.13);
    }
    // until line stretch: still falling, with a little pilot chute drag
    const k = K_BELLY * (1 + 0.15 * smooth(tau / 0.4));
    const free = new THREE.Vector3(0, -G, 0).addScaledVector(air, -k * sp);
    if (acc.length() > aMax) acc.setLength(aMax);
    const w = smooth((tau - LINE_STRETCH) / 0.35);
    const a = free.multiplyScalar(1 - w).addScaledVector(acc, w);
    r.g = Math.hypot(a.x, a.y + G, a.z) / G;
    // pendulum: the jumper swings fore and aft under the canopy as it speeds up and slows
    const along = a.x * hd.x + a.z * hd.z;
    r.swayV += (-1.72 * r.sway - 0.9 * r.swayV - along * 0.035 * w) * dt;
    r.sway += r.swayV * dt;
    r.v.addScaledVector(a, dt);
    r.p.addScaledVector(r.v, dt);
    this.collide(r, dt);
    const agl = this.agl(r);
    r.legs += ((agl < 12 ? 1 : 0) - r.legs) * Math.min(1, dt * 2);
    if (agl <= 0) this.land(r);
  }

  // Keep out of walls (slide down them) and inside the map.
  collide(r, dt) {
    const ph = this.game.physics;
    const sp = Math.hypot(r.v.x, r.v.z);
    if (ph && sp > 0.1 && r.p.y < 120) {
      const d = _v2.set(r.v.x / sp, 0, r.v.z / sp);
      const hit = ph.raycast(_v3.copy(r.p), d, sp * dt + 0.45, (b) => !b.flags || !b.flags.boundary);
      if (hit && hit.box) {
        const vn = r.v.dot(hit.normal);
        if (vn < 0) r.v.addScaledVector(hit.normal, -vn * 1.1);
        r.p.addScaledVector(hit.normal, Math.max(0, 0.45 - hit.t) * 0.5);
      }
    }
    const B = this.game.bounds;
    if (B) {
      for (const [k, lo, hi] of [['x', B.minX + 2, B.maxX - 2], ['z', B.minZ + 2, B.maxZ - 2]]) {
        if (r.p[k] < lo) { r.p[k] = lo; if (r.v[k] < 0) r.v[k] *= -0.2; }
        if (r.p[k] > hi) { r.p[k] = hi; if (r.v[k] > 0) r.v[k] *= -0.2; }
      }
    }
  }

  feet(r) { return _v.set(r.p.x, r.p.y - HIPS, r.p.z); }
  agl(r) {
    if (r.state === 'plane' && this.plane) return r.p.y - this.ground(r.p.x, r.p.z, r.p.y - 3);
    const fy = r.p.y - HIPS;
    r.gy = this.ground(r.p.x, r.p.z, fy + 0.6);
    return fy - r.gy;
  }

  // Highest surface under (x, z) not above maxY: the ground (y = 0) or a roof, slab, car...
  ground(x, z, maxY) {
    const ph = this.game.physics;
    if (!ph) return 0;
    let best = 0;
    const list = ph.overlap(x - 0.25, -1, z - 0.25, x + 0.25, maxY + 1e-3, z + 0.25, this._tmp);
    for (const b of list) if ((!b.flags || !b.flags.boundary) && b.max[1] <= maxY + 1e-3 && b.max[1] > best) best = b.max[1];
    return best;
  }

  // --- touchdown -----------------------------------------------------------------------------------
  land(r) {
    if (r.state === 'landed') return;
    const c = r.c, g = this.game;
    const gy = r.gy !== undefined ? r.gy : this.ground(r.p.x, r.p.z, r.p.y);
    const info = { speed: r.v.length(), vSpeed: -r.v.y, hSpeed: Math.hypot(r.v.x, r.v.z), flared: r.flare > 0.5, canopy: r.pull >= 0, roof: gy > 0.5, point: new THREE.Vector3(r.p.x, gy, r.p.z) };
    info.hard = info.vSpeed > 4 || info.hSpeed > 8;
    r.state = 'landed';
    r.landT = 0;
    r.p.y = gy + HIPS;
    if (r.chute) {
      r.chuteAt = new THREE.Vector3(r.p.x, gy + HIPS + HARNESS, r.p.z);
      r.chuteQ = new THREE.Quaternion().setFromAxisAngle(UP, r.heading);
    }
    if (c.body) {
      c.body.p.set(r.p.x, gy, r.p.z);
      c.body.v.set(0, 0, 0);
      c.body.grounded = true;
    }
    c.yaw = r.yaw;
    c.pitch = 0;
    c.airborne = false;
    if (r.own) { this.scene.remove(r.h.group); r.h = null; r.own = false; }
    else if (r.h) {
      r.h.group.position.set(r.p.x, gy, r.p.z);
      r.h.group.quaternion.setFromAxisAngle(UP, r.yaw);
      r.h.gunPivot.visible = true;
      r.h.settled = false;
    }
    if (c.eye) c.eye.set(r.p.x, gy + 1.62, r.p.z);
    if (c === g.player) {
      // back to first person
      const cam = g.camera;
      c.eyeH = c.eyeH || 1.66;
      if (c.dip !== undefined) c.dip = Math.min(0.12, info.vSpeed * 0.025);
      cam.position.set(r.p.x, gy + (c.eyeH || 1.66), r.p.z);
      cam.rotation.set(0, r.yaw, 0, 'YXZ');
      if (c.weapons && c.weapons.length && g.showViewmodel) { g.showViewmodel(true); if (g.vm && g.vm.startDraw) g.vm.startDraw(); }
      if (this.audio) { this.audio.foley('land'); if (info.hard) this.blip({ freq: 120, dur: 0.25, vol: 0.6, filter: 'lowpass' }); }
    }
    this.onLand(c, info);
  }

  // A landed canopy deflates and falls over, then goes.
  collapse(r, dt) {
    r.landT += dt;
    const ch = r.chute;
    ch.group.position.copy(r.chuteAt);
    ch.group.quaternion.copy(r.chuteQ);
    ch.update(dt, { bag: 1, pc: 1 - smooth(r.landT / 1.5) * 0.8, k: 1, slider: 1, brakeL: 0, brakeR: 0, collapse: smooth(r.landT / 1.8), shoulderL: null, shoulderR: null, handL: null, handR: null });
    if (r.landT > 3.6) ch.group.position.y -= (r.landT - 3.6) * 1.2;
    if (r.landT > 5) { ch.dispose(); r.chute = null; }
  }

  // --- bodies ---------------------------------------------------------------------------------------
  pose(r, ctl, dt) {
    const h = r.h;
    if (!h) return;
    const tau = r.pull;
    const upright = tau < 0 ? 0 : smooth((tau - 0.45) / 0.7);
    // body attitude: belly to earth (or head down when diving), swung upright by the snatch
    const pitchFF = -Math.PI / 2 - 1.15 * r.dive + 0.18 * r.slow;
    const bodyPitch = pitchFF * (1 - upright) + (-r.sway * 0.6 + 0.06) * upright;
    const roll = (r.side || 0) * -0.25 * (1 - upright) + r.bank * 0.85 * upright;
    const q = _q.setFromAxisAngle(UP, r.yaw).multiply(_q2.setFromAxisAngle(Z, -roll)).multiply(_q2.setFromAxisAngle(X, bodyPitch));
    h.group.quaternion.copy(q);
    h.group.position.copy(r.p).sub(_v.set(0, HIPS, 0).applyQuaternion(q));
    const blend = Math.min(1, dt * 6);
    h.pose('freefall', upright > 0.5 ? blend : 1, { lean: r.side || 0 });
    if (r.dive > 0.01 && upright < 0.5) h.pose('dive', r.dive);
    if (upright > 0) {
      const tog = { toggleL: r.tog.L, toggleR: r.tog.R, legs: r.legs, lean: -r.bank * 0.5 };
      h.pose('canopy', upright, tog);
    }
    // the canopy: rides on the harness, its frame turned into the relative wind until it flies
    const ch = r.chute;
    if (!ch) return;
    h.group.updateMatrixWorld(true);
    const shL = h.b.armL.getWorldPosition(new THREE.Vector3()), shR = h.b.armR.getWorldPosition(new THREE.Vector3());
    const harness = shL.clone().add(shR).multiplyScalar(0.5);
    const handL = h.b.handL.getWorldPosition(new THREE.Vector3()), handR = h.b.handR.getWorldPosition(new THREE.Vector3());
    const open = clamp((tau - LINE_STRETCH) / INFLATE, 0, 1);
    const air = _v.copy(r.v).sub(this.wind);
    const wind = air.lengthSq() > 1 ? air.clone().normalize().negate() : UP.clone();
    const up = wind.lerp(UP, smooth((open - 0.15) / 0.75)).normalize();
    const fwd = fwdOf(r.heading, _v2);
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = _v3.crossVectors(fwd, up).normalize();
    _m.makeBasis(right, up, fwd.clone().negate());
    const qc = new THREE.Quaternion().setFromRotationMatrix(_m);
    qc.multiply(_q2.setFromAxisAngle(Z, -r.bank * 0.15)).multiply(_q2.setFromAxisAngle(X, r.sway * 0.5 + Math.sin(this.time * 0.9 + r.seat) * 0.025 * open));
    ch.group.position.copy(harness);
    ch.group.quaternion.copy(qc);
    ch.group.visible = true;
    ch.update(dt, {
      pc: clamp(tau / 0.35, 0, 1), bag: clamp((tau - 0.25) / (LINE_STRETCH - 0.25), 0, 1),
      k: tau < LINE_STRETCH ? 0 : 1 - Math.pow(1 - open, 2.2), slider: smooth((tau - LINE_STRETCH - 0.3) / (INFLATE - 0.2)),
      brakeL: r.tog.L, brakeR: r.tog.R, collapse: 0, shoulderL: shL, shoulderR: shR, handL, handR,
    });
  }

  // Keep the character's own fields in step (radar, hit tests, the HUD).
  syncChar(r) {
    const c = r.c;
    if (c.body) { c.body.p.set(r.p.x, r.p.y - HIPS, r.p.z); c.body.v.copy(r.v); }
    if (c.eye) c.eye.copy(r.p).add(_v.set(0, 0.6, 0));
    c.yaw = r.yaw;
  }

  // --- camera ----------------------------------------------------------------------------------------
  camera(r, input, dt) {
    const cam = this.game.camera, C = this.cam;
    const mdx = input ? input.mouse.dx : 0, mdy = input ? input.mouse.dy : 0;
    const sens = 0.0022 * this.sens;
    if (r.state === 'plane') {
      if (!this.plane) return;
      // orbit the aircraft: behind and above by default, the map below
      C.yaw -= mdx * sens; C.pitch = clamp(C.pitch - mdy * sens, -1.2, 0.35);
      const D = 38;
      const P = this.plane.group;
      const off = _v.set(-Math.cos(C.yaw) * Math.cos(C.pitch) * D, -Math.sin(C.pitch) * D + 3, Math.sin(C.yaw) * Math.cos(C.pitch) * D);
      cam.position.copy(P.localToWorld(off));
      cam.up.set(0, 1, 0);
      cam.lookAt(P.localToWorld(_v2.set(-2, -2, 0)));
      cam.fov = 60;
      cam.updateProjectionMatrix();
      this.listen(cam);
      return;
    }
    // chase: behind and above the jumper; under canopy the mouse looks round and drifts back
    const canopy = r.state === 'canopy' ? smooth((r.pull - LINE_STRETCH) / 1.5) : 0;
    if (!C.ready) { C.lookYaw = 0; C.pitch = -0.55; C.idle = 0; }
    if (canopy > 0) {
      C.lookYaw -= mdx * sens;
      C.idle = Math.abs(mdx) + Math.abs(mdy) > 0 ? 0 : C.idle + dt;
      if (C.idle > 1.5) C.lookYaw *= Math.exp(-dt * 1.2);
    } else C.lookYaw *= Math.exp(-dt * 3);
    C.pitch = clamp(C.pitch - mdy * sens, -1.3, 0.2);
    const pitch = C.pitch * (1 - canopy) + clamp(C.pitch * 0.6 - 0.22, -1.0, 0.1) * canopy;
    const yaw = r.yaw + C.lookYaw;
    const D = 4.6 + 5.0 * canopy;
    const target = _v2.copy(r.p).add(_v3.set(0, 0.2 + 2.6 * canopy, 0));
    const f = fwdOf(yaw, new THREE.Vector3());
    const want = new THREE.Vector3().addScaledVector(f, -Math.cos(pitch) * D).add(_v.set(0, -Math.sin(pitch) * D + 0.6, 0));
    if (!C.ready) { C.off.copy(want); C.ready = true; }
    C.off.lerp(want, Math.min(1, dt * 4));
    const pos = target.clone().add(C.off);
    // don't put the camera inside a building or under the ground
    const ph = this.game.physics;
    if (ph) {
      const dir = pos.clone().sub(target), len = dir.length();
      if (len > 0.01) {
        dir.multiplyScalar(1 / len);
        const hit = ph.raycast(target, dir, len, (b) => !b.flags || !b.flags.boundary);
        if (hit) pos.copy(target).addScaledVector(dir, Math.max(0.6, hit.t - 0.35));
      }
      const gy = this.ground(pos.x, pos.z, pos.y + 0.5);
      if (pos.y < gy + 0.4) pos.y = gy + 0.4;
    }
    // the opening shock jolts the view
    const shake = Math.max(0, r.g - 1.3) * 0.03;
    pos.x += (Math.random() - 0.5) * shake; pos.y += (Math.random() - 0.5) * shake; pos.z += (Math.random() - 0.5) * shake;
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(target.addScaledVector(f, 1.5 * (1 - canopy)).add(_v.set(0, -0.6 * (1 - canopy), 0)));
    const sp = r.v.length();
    cam.fov = (68 + clamp(sp - 40, 0, 30) * 0.35) * (1 - canopy) + 66 * canopy;
    cam.updateProjectionMatrix();
    this.listen(cam);
  }

  listen(cam) { if (this.audio && this.audio.setListener) this.audio.setListener(cam); }

  // --- sound ------------------------------------------------------------------------------------------
  blip(o) { if (this.audio && this.audio.ctx) this.audio.blip(o); }

  // Wind rush scaled with airspeed (the player's ears), canopy fabric flutter.
  sounds(r, dt) {
    const A = this.audio;
    if (!A || !A.ctx || !r) return;
    const c = A.ctx;
    if (!this.snd) {
      const src = c.createBufferSource();
      src.buffer = A.noise; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.5; bp.frequency.value = 600;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
      const gain = c.createGain(); gain.gain.value = 0;
      src.connect(bp).connect(lp).connect(gain).connect(A.master);
      const fsrc = c.createBufferSource();
      fsrc.buffer = A.noise; fsrc.loop = true;
      const ff = c.createBiquadFilter(); ff.type = 'lowpass'; ff.frequency.value = 700;
      const fg = c.createGain(); fg.gain.value = 0;
      const lfo = c.createOscillator(); lfo.frequency.value = 7.5;
      const lfoG = c.createGain(); lfoG.gain.value = 0;
      lfo.connect(lfoG).connect(fg.gain);
      fsrc.connect(ff).connect(fg).connect(A.master);
      src.start(); fsrc.start(); lfo.start();
      this.snd = { src, bp, lp, gain, fsrc, fg, lfo, lfoG };
    }
    const S = this.snd, t = c.currentTime;
    let sp = 0, flutter = 0;
    if (r.state === 'plane') sp = 12;
    else if (r.state === 'freefall' || r.state === 'canopy') {
      sp = _v.copy(r.v).sub(this.wind).length();
      if (r.state === 'canopy') flutter = 0.06 + 0.05 * Math.min(1, sp / 12);
    }
    const g = r.state === 'landed' ? 0 : Math.min(0.75, Math.pow(sp / 55, 2) * 0.6 + (sp > 1 ? 0.02 : 0));
    S.gain.gain.setTargetAtTime(g, t, 0.15);
    S.bp.frequency.setTargetAtTime(250 + sp * 22, t, 0.2);
    S.lp.frequency.setTargetAtTime(1200 + sp * 60, t, 0.2);
    S.fg.gain.setTargetAtTime(flutter * 0.5, t, 0.2);
    S.lfoG.gain.setTargetAtTime(flutter * 0.5, t, 0.2);
    S.lfo.frequency.setTargetAtTime(6 + sp * 0.25, t, 0.3);
    void dt;
  }

  stopSounds() {
    if (!this.snd) return;
    try { this.snd.src.stop(); this.snd.fsrc.stop(); this.snd.lfo.stop(); } catch (e) { /* already stopped */ }
    this.snd.gain.disconnect(); this.snd.fg.disconnect();
    this.snd = null;
  }

  // Everything off the scene (the aircraft, bodies, canopies); characters keep their state.
  dispose() {
    if (this.plane) { this.plane.dispose(); this.plane = null; }
    for (const r of this.riders.values()) {
      if (r.chute) { r.chute.dispose(); r.chute = null; }
      if (r.own && r.h) { this.scene.remove(r.h.group); r.h = null; }
      r.c.airborne = false;
    }
    this.riders.clear();
    this.stopSounds();
  }
}

export { CANOPY };
