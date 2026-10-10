// First-person weapon rig: gun + gloved hands in camera space, poses and animations.
import * as THREE from 'three';
import { buildGun, buildRifleMag } from './gunmodels.js';
import { roundedBox } from '../core/geometry.js';

const HIP = {
  kestrel: { pos: [0.13, -0.148, -0.37], rot: [0.0, 0.03, 0.0] },
  bastion: { pos: [0.13, -0.15, -0.35], rot: [0.0, 0.03, 0.0] },
  warden: { pos: [0.115, -0.13, -0.43], rot: [0.02, 0.035, 0.0] },
};
const KICK = { kestrel: [0.018, 0.035], warden: [0.03, 0.09], bastion: [0.06, 0.16] };

const smooth = (t) => t * t * (3 - 2 * t);
// Keyframe track: [[u, v], ...] with smoothstep easing between keys.
function track(keys, u) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      return a[1] + (b[1] - a[1]) * smooth((u - a[0]) / (b[0] - a[0]));
    }
  }
  return keys[keys.length - 1][1];
}

// Reload choreography per weapon. Each value track is sampled over u in [0, 1].
const ANIMS = {
  rifleTac: {
    roll: [[0, 0], [0.12, 0.38], [0.8, 0.38], [0.95, 0]], pitch: [[0, 0], [0.12, 0.12], [0.8, 0.1], [0.95, 0]], lift: [[0, 0], [0.12, 0.025], [0.8, 0.02], [0.95, 0]],
    magY: [[0, 0], [0.14, 0], [0.3, -0.3], [0.5, -0.55], [0.56, -0.3], [0.68, -0.03], [0.72, 0]], magZ: [[0, 0], [0.3, 0.06], [0.56, 0.06], [0.7, 0]], magRot: [[0, 0], [0.3, 0.4], [0.56, 0.3], [0.7, 0]],
    hand: [[0, 0], [0.1, 1], [0.78, 1], [0.92, 0]],
    events: [[0.13, 'magOut'], [0.5, 'swap'], [0.7, 'magIn'], [0.76, 'magTap']],
  },
  rifleEmpty: {
    roll: [[0, 0], [0.1, 0.4], [0.84, 0.36], [0.96, 0]], pitch: [[0, 0], [0.1, 0.12], [0.84, 0.08], [0.96, 0]], lift: [[0, 0], [0.1, 0.025], [0.84, 0.02], [0.96, 0]],
    magY: [[0, 0], [0.1, 0], [0.12, -0.7], [0.4, -0.7], [0.42, -0.4], [0.58, -0.03], [0.62, 0]], magZ: [[0, 0], [0.4, 0.05], [0.6, 0]], magRot: [[0, 0], [0.4, 0.3], [0.6, 0]],
    hand: [[0, 0], [0.08, 1], [0.64, 1], [0.94, 0]], bolt: [[0, 0], [0.64, 0], [0.72, 1], [0.8, 1], [0.86, 0]],
    events: [[0.1, 'drop'], [0.62, 'magIn'], [0.78, 'boltRelease']],
  },
  pistolTac: {
    roll: [[0, 0], [0.15, 0.28], [0.8, 0.25], [0.95, 0]], pitch: [[0, 0], [0.15, 0.18], [0.8, 0.15], [0.95, 0]], lift: [[0, 0], [0.15, 0.03], [0.8, 0.03], [0.95, 0]],
    magY: [[0, 0], [0.15, 0], [0.32, -0.2], [0.5, -0.45], [0.56, -0.2], [0.68, -0.02], [0.72, 0]], magZ: [[0, 0], [0.5, 0], [0.7, 0]], magRot: [[0, 0], [0.32, 0.2], [0.7, 0]],
    hand: [[0, 0], [0.12, 1], [0.76, 1], [0.92, 0]],
    events: [[0.16, 'magOut'], [0.5, 'swap'], [0.7, 'magIn']],
  },
  pistolEmpty: {
    roll: [[0, 0], [0.12, 0.3], [0.84, 0.26], [0.96, 0]], pitch: [[0, 0], [0.12, 0.18], [0.84, 0.14], [0.96, 0]], lift: [[0, 0], [0.12, 0.03], [0.84, 0.03], [0.96, 0]],
    magY: [[0, 0], [0.12, 0], [0.14, -0.6], [0.42, -0.6], [0.44, -0.25], [0.6, -0.02], [0.64, 0]], magZ: [[0, 0], [0.6, 0]], magRot: [[0, 0], [0.6, 0]],
    hand: [[0, 0], [0.1, 1], [0.66, 1], [0.92, 0]], bolt: [[0, 0], [0.7, 0], [0.76, 1], [0.84, 1], [0.88, 0]],
    events: [[0.12, 'drop'], [0.64, 'magIn'], [0.8, 'boltRelease']],
  },
  magCheck: {
    roll: [[0, 0], [0.2, 0.55], [0.75, 0.55], [1, 0]], pitch: [[0, 0], [0.2, 0.2], [0.75, 0.2], [1, 0]], lift: [[0, 0], [0.2, 0.03], [0.75, 0.03], [1, 0]],
    magY: [[0, 0], [0.25, 0], [0.38, -0.05], [0.65, -0.05], [0.75, 0]], magZ: [[0, 0], [1, 0]], magRot: [[0, 0], [0.38, 0.12], [0.65, 0.12], [0.75, 0]],
    hand: [[0, 0], [0.2, 1], [0.78, 1], [0.95, 0]],
    events: [[0.42, 'magCheck'], [0.74, 'magTap']],
  },
};

export class Viewmodel {
  constructor(renderer, mats, effects, audio) {
    this.R = renderer;
    this.M = mats;
    this.fx = effects;
    this.audio = audio;
    this.scene = renderer.vScene;
    this.cam = renderer.vCamera;
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.gun = null;
    this.action = null;
    this.adsT = 0;
    this.kick = new THREE.Vector3();      // spring state: z back, rotX up, rotY
    this.kickV = new THREE.Vector3();
    this.sway = new THREE.Vector2();
    this.swayV = new THREE.Vector2();
    this.bob = 0;
    this.boltT = 1;  // time since the last shot, for bolt/slide animation
    this.pumpT = 1;
    this.lowered = 0;
    this.sprintT = 0;
    this.tacT = 0;
    this.buildArms();
    this.buildFlash();
    this.buildScope();
  }

  // --- construction ----------------------------------------------------------------
  buildArms() {
    const G = this.M.gun;
    const mkHand = (left) => {
      const h = new THREE.Group();
      const palm = new THREE.Mesh(roundedBox(0.03, 0.085, 0.075, 0.012, 2), G.glove);
      h.add(palm);
      // Curled fingers wrapping forward of the palm
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(roundedBox(0.026, 0.02, 0.05, 0.009, 2), G.glove);
        f.position.set(left ? 0.024 : -0.024, 0.03 - i * 0.021, -0.02);
        f.rotation.y = left ? -0.9 : 0.9;
        h.add(f);
      }
      const thumb = new THREE.Mesh(roundedBox(0.022, 0.02, 0.05, 0.009, 2), G.glove);
      thumb.position.set(left ? -0.004 : 0.004, 0.045, -0.03);
      thumb.rotation.set(0.5, left ? 0.5 : -0.5, 0);
      h.add(thumb);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.05, 14), G.glove);
      cuff.position.set(0, -0.055, 0.02);
      h.add(cuff);
      this.scene.add(h);
      return h;
    };
    const mkFore = () => {
      const g = new THREE.CylinderGeometry(0.036, 0.044, 1, 16);
      g.translate(0, 0.5, 0);
      const m = new THREE.Mesh(g, G.sleeve);
      this.scene.add(m);
      return m;
    };
    this.handR = mkHand(false);
    this.handL = mkHand(true);
    this.foreR = mkFore();
    this.foreL = mkFore();
  }

  buildFlash() {
    const mat = new THREE.MeshBasicMaterial({ map: this.M.fx.flash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: 0xffffff });
    this.flash = new THREE.Group();
    const a = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mat);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.24), mat);
    b.rotation.x = Math.PI / 2; b.position.z = -0.06;
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.24), mat);
    c.rotation.set(Math.PI / 2, 0, Math.PI / 2); c.position.z = -0.06;
    this.flash.add(a, b, c);
    this.flash.visible = false;
    this.flashT = 1;
  }

  // Picture-in-picture scope: renders the world through a narrow camera into the ocular.
  buildScope() {
    this.scopeCam = new THREE.PerspectiveCamera(13, 1, 0.1, 900);
    this.scopeRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
    this.pipMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.scopeRT.texture }, align: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D map; uniform float align; varying vec2 vUv;
        void main(){
          vec2 p = vUv - 0.5; float r = length(p) * 2.0;
          vec3 col = texture2D(map, vUv).rgb;
          float vig = (1.0 - smoothstep(0.78, 1.0, r)) * align;
          // Duplex reticle with mil-dots
          float ax = abs(p.x), ay = abs(p.y);
          float thin = 0.0016, thick = 0.008;
          float lineX = (ay < thin && ax < 0.18) || (ay < thick && ax > 0.18 && ax < 0.48) ? 1.0 : 0.0;
          float lineY = (ax < thin && ay < 0.18) || (ax < thick && ay > 0.18 && ay < 0.48) ? 1.0 : 0.0;
          float dots = 0.0;
          for (int i = 1; i <= 4; i++) {
            float d = float(i) * 0.04;
            dots += step(length(vec2(ax - d, ay)), 0.0045) + step(length(vec2(ax, ay - d)), 0.0045);
          }
          float ret = clamp(lineX + lineY + dots, 0.0, 1.0);
          col = mix(col, vec3(0.0), ret);
          gl_FragColor = vec4(col * vig, 1.0);
        }`,
    });
  }

  setScopeRes(n) { this.scopeRT.setSize(n, n); }

  // (Re)build the first-person gun for a weapon state.
  setWeapon(ws) {
    if (this.gun) { this.rig.remove(this.gun.root); this.gun.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    this.ws = ws;
    this.gun = buildGun(ws.id, ws.stats.att, this.M.gun, { fp: true });
    this.rig.add(this.gun.root);
    this.gun.root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    this.hip = HIP[ws.id];
    const sight = this.gun.sight;
    this.ads = { pos: [0, -sight.y, -sight.z], rot: [0, 0, 0] };
    this.magRest = this.gun.mag.group.position.clone();
    this.magRestRot = this.gun.mag.group.rotation.x;
    // Red-dot reticle
    if (this.reticle) { this.reticle.parent && this.reticle.parent.remove(this.reticle); this.reticle = null; }
    if (sight.kind === 'dot') {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.25), transparent: true, depthTest: false, depthWrite: false });
      this.reticle = new THREE.Mesh(new THREE.CircleGeometry(0.0009, 16), mat);
      this.reticle.renderOrder = 10;
      this.reticle.position.set(0, sight.y, sight.reticleZ);
      (sight.onSlide ? this.gun.parts.slide : this.gun.body).add(this.reticle);
    }
    this.ocular = sight.kind === 'scope' ? sight.ocular : null;
    this.ocularMat = this.ocular ? this.ocular.material : null;
    this.gun.body.add(this.flash);
    this.flash.position.copy(this.gun.anchors.muzzle);
    if (this.gun.parts.dustCover) this.gun.parts.dustCover.rotation.z = 0;
    this.gun.mag.setAmmo(ws.mag);
    this.updateSaddle(ws);
    this.action = null;
    this.boltT = 1;
    this.pumpT = 1;
    this.kick.set(0, 0, 0);
    this.kickV.set(0, 0, 0);
  }

  updateSaddle(ws) {
    if (!this.gun.saddle) return;
    this.gun.saddle.forEach((s, i) => { s.visible = i < Math.min(4, ws.reserve); });
  }

  // --- actions ----------------------------------------------------------------------
  busy() { return !!this.action; }
  play(name, dur, opts = {}) { this.action = Object.assign({ name, t: 0, dur, fired: new Set() }, opts); }

  startReload(onEvent) {
    const ws = this.ws;
    if (ws.pump) {
      this.play('shotgunReload', 9, { onEvent, stage: 'start', st: 0 });
      return;
    }
    const pistol = ws.id === 'warden';
    const empty = !ws.chambered;
    const anim = ANIMS[(pistol ? 'pistol' : 'rifle') + (empty ? 'Empty' : 'Tac')];
    this.play('reload', ws.reloadTime(), { anim, onEvent });
  }

  startPump(onEvent) { this.play('pump', this.ws.stats.reload.pump, { onEvent }); }
  startMagCheck(onEvent) { if (!this.ws.pump) this.play('magCheck', 1.25, { anim: ANIMS.magCheck, onEvent }); }
  startDraw() { this.play('draw', this.ws.stats.draw); this.audio.foley('draw'); }
  startHolster(done) { this.play('holster', 0.22, { done }); }
  startThrow(onRelease) { this.play('throw', 0.8, { onRelease }); }
  cancelReload() { if (this.action && this.action.name === 'shotgunReload') this.action.cancel = true; }

  onFire() {
    const g = this.gun;
    this.boltT = 0;
    this.flashT = 0;
    this.flash.visible = !this.ws.stats.suppressed || Math.random() < 0.25;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(this.ws.stats.suppressed ? 0.3 : 0.8 + Math.random() * 0.5);
    const k = KICK[this.ws.id];
    const ads = 1 - this.adsT * 0.45;
    this.kickV.z += k[0] * 28 * ads;
    this.kickV.x += k[1] * 30 * ads;
    this.kickV.y += (Math.random() - 0.5) * k[1] * 10;
    if (g.parts.dustCover) g.parts.dustCover.rotation.z = -1.75;
    if (g.parts.trigger) g.parts.trigger.rotation.x = 0.35;
    this.gun.mag.setAmmo(this.ws.mag);
    this.ejectPending = !this.ws.pump;
  }

  // World position/velocity for something at a gun-local point (brass, mags).
  gunToWorld(local, camera) {
    const p = this.gun.root.localToWorld(local.clone());
    return camera.localToWorld(p);
  }

  muzzleWorld(camera) { return this.gunToWorld(this.gun.anchors.muzzle, camera); }

  // --- per frame -----------------------------------------------------------------------
  // c: { adsTarget, speed, sprint, tac, crouch, look: {x,y}, camera, playerVel, grounded, indoor }
  update(dt, c) {
    const g = this.gun;
    if (!g) return;
    const ws = this.ws;
    const blocked = this.action && ['reload', 'shotgunReload', 'draw', 'holster', 'throw', 'magCheck'].includes(this.action.name);
    const adsTarget = c.adsTarget && !blocked && !c.sprint ? 1 : 0;
    const adsSpeed = 1 / Math.max(0.08, ws.stats.adsTime);
    this.adsT += Math.sign(adsTarget - this.adsT) * Math.min(Math.abs(adsTarget - this.adsT), dt * adsSpeed);
    const a = smooth(this.adsT);
    this.sprintT += ((c.sprint && !c.tac ? 1 : 0) - this.sprintT) * Math.min(1, dt * 9);
    this.tacT += ((c.tac ? 1 : 0) - this.tacT) * Math.min(1, dt * 9);
    // Sway lags behind mouse movement; springs back.
    this.swayV.x += (-c.look.x * 0.00055 - this.sway.x * 60 - this.swayV.x * 11) * dt;
    this.swayV.y += (-c.look.y * 0.00055 - this.sway.y * 60 - this.swayV.y * 11) * dt;
    this.sway.addScaledVector(this.swayV, dt);
    // Recoil spring
    this.kickV.addScaledVector(this.kick, -220 * dt).multiplyScalar(Math.exp(-dt * 18));
    this.kick.addScaledVector(this.kickV, dt);
    // Bob
    const moving = c.grounded ? Math.min(1, c.speed / 4.5) : 0;
    this.bob += dt * (6 + c.speed * 1.3) * (moving > 0.05 ? 1 : 0);
    const bobAmp = moving * (1 - a * 0.85) * (c.crouch ? 0.6 : 1);
    const breath = Math.sin(performance.now() * 0.0016) * 0.0012 * (1 - a * 0.7);
    // Base pose: hip <-> ADS
    const P = this.hip.pos, Q = this.ads.pos;
    const pos = new THREE.Vector3(P[0] + (Q[0] - P[0]) * a, P[1] + (Q[1] - P[1]) * a, P[2] + (Q[2] - P[2]) * a);
    const rot = new THREE.Euler(this.hip.rot[0] * (1 - a), this.hip.rot[1] * (1 - a), this.hip.rot[2] * (1 - a), 'YXZ');
    pos.x += Math.sin(this.bob) * 0.008 * bobAmp + this.sway.x * (1 - a * 0.8);
    pos.y += -Math.abs(Math.cos(this.bob)) * 0.006 * bobAmp + breath + this.sway.y * (1 - a * 0.8);
    rot.z += Math.sin(this.bob) * 0.012 * bobAmp;
    rot.y += this.sway.x * 2.5;
    rot.x += this.sway.y * 2.5;
    // Sprint and tactical sprint poses
    pos.x += this.sprintT * -0.02; pos.y += this.sprintT * -0.045; pos.z += this.sprintT * 0.02;
    rot.y += this.sprintT * 0.62; rot.x += this.sprintT * -0.18; rot.z += this.sprintT * 0.28;
    pos.y += this.tacT * 0.02; pos.x += this.tacT * -0.04;
    rot.x += this.tacT * 1.05; rot.z += this.tacT * -0.25;
    // Crouch tilt
    if (c.crouch) rot.z += 0.03 * (1 - a);
    // Recoil
    pos.z += this.kick.z;
    rot.x += this.kick.x;
    rot.y += this.kick.y;
    // Actions
    let handBlend = 0, handTarget = null, magY = 0, magZ = 0, magRot = 0, boltOverride = -1;
    const act = this.action;
    if (act) {
      act.t += dt;
      const u = Math.min(1, act.t / act.dur);
      if (act.anim) {
        const A = act.anim;
        rot.z += track(A.roll, u); rot.x += track(A.pitch, u); pos.y += track(A.lift, u);
        magY = track(A.magY, u); magZ = track(A.magZ, u); magRot = track(A.magRot, u);
        handBlend = track(A.hand, u);
        if (A.bolt) boltOverride = track(A.bolt, u);
        for (const [eu, name] of A.events) {
          if (u >= eu && !act.fired.has(eu)) { act.fired.add(eu); this.event(name, act, c); }
        }
        handTarget = 'mag';
        if (act.name === 'reload' && A.bolt && u > 0.64 && u < 0.86) handTarget = 'bolt';
      } else if (act.name === 'pump') {
        const z = track([[0, 0], [0.4, 0.085], [0.5, 0.085], [0.9, 0]], u);
        g.parts.pump.position.z = z;
        rot.x += track([[0, 0], [0.3, 0.05], [0.9, 0]], u);
        if (u > 0.15 && !act.fired.has('b')) { act.fired.add('b'); this.audio.foley('pumpBack'); }
        if (u > 0.4 && !act.fired.has('e')) { act.fired.add('e'); this.event('ejectShell', act, c); }
        if (u > 0.82 && !act.fired.has('f')) { act.fired.add('f'); this.audio.foley('pumpFwd'); act.onEvent && act.onEvent('rack'); }
      } else if (act.name === 'shotgunReload') {
        this.updateShotgunReload(act, dt, rot, pos, c);
        handBlend = act.hand || 0;
        handTarget = 'port';
      } else if (act.name === 'draw') {
        pos.y += track([[0, -0.22], [1, 0]], u);
        rot.x += track([[0, -0.7], [1, 0]], u);
      } else if (act.name === 'holster') {
        pos.y += track([[0, 0], [1, -0.25]], u);
        rot.x += track([[0, 0], [1, -0.7]], u);
      } else if (act.name === 'throw') {
        pos.y += track([[0, 0], [0.25, -0.3], [0.62, -0.3], [1, 0]], u);
        rot.x += track([[0, 0], [0.25, -0.5], [0.62, -0.5], [1, 0]], u);
        if (u > 0.42 && !act.fired.has('r')) { act.fired.add('r'); act.onRelease && act.onRelease(); }
      }
      if (u >= 1 && act.name !== 'shotgunReload') {
        this.action = null;
        if (act.done) act.done();
      }
    }
    this.rig.position.copy(pos);
    this.rig.quaternion.setFromEuler(rot);
    // Magazine motion
    const mag = g.mag.group;
    mag.position.set(this.magRest.x, this.magRest.y + magY, this.magRest.z + magZ);
    mag.rotation.x = this.magRestRot + magRot;
    mag.visible = magY > -0.65;
    // Bolt / slide cycling
    this.boltT += dt;
    const cyc = Math.max(0.03, 60 / ws.stats.rpm * 0.85);
    const pulse = this.boltT < cyc ? Math.sin(Math.min(1, this.boltT / cyc) * Math.PI) : 0;
    const locked = ws.boltLocked ? 1 : 0;
    let back = Math.max(pulse, locked);
    if (boltOverride >= 0) back = locked ? 1 - boltOverride : back;
    if (g.parts.bolt) g.parts.bolt.position.z = g.parts.boltRest.z + back * 0.055;
    if (g.parts.slide) g.parts.slide.position.z = back * 0.032;
    if (g.parts.trigger) g.parts.trigger.rotation.x *= Math.exp(-dt * 25);
    if (this.ejectPending && this.boltT > cyc * 0.45) { this.ejectPending = false; this.ejectBrass(c, ws.id === 'warden' ? '9mm' : '556'); }
    // Flash
    this.flashT += dt;
    if (this.flashT > 0.035) this.flash.visible = false;
    // Reticle and scope
    if (this.reticle) this.reticle.material.opacity = Math.max(0, (a - 0.55) / 0.45);
    if (this.ocular) {
      const on = a > 0.35;
      this.ocular.material = on ? this.pipMat : this.ocularMat;
      this.pipMat.uniforms.align.value = Math.max(0, (a - 0.35) / 0.65);
    }
    this.cam.fov = 52 - a * (this.ocular ? 6 : 8);
    this.cam.updateProjectionMatrix();
    this.placeArms(handBlend, handTarget);
  }

  updateShotgunReload(act, dt, rot, pos, c) {
    const ws = this.ws;
    const r = ws.stats.reload;
    act.st += dt;
    rot.z += -0.45 * Math.min(1, act.st / 0.25) * (act.stage === 'end' ? Math.max(0, 1 - act.endT / 0.3) : 1);
    rot.x += 0.12 * (act.stage === 'end' ? Math.max(0, 1 - act.endT / 0.3) : Math.min(1, act.st / 0.25));
    pos.y += 0.02;
    if (act.stage === 'start') {
      act.hand = Math.min(1, act.st / r.start);
      if (act.st >= r.start) { act.stage = 'shell'; act.shellT = 0; }
    } else if (act.stage === 'shell') {
      act.shellT += dt;
      const u = act.shellT / r.shell;
      act.hand = 1;
      act.handDip = Math.sin(Math.min(1, u) * Math.PI);
      if (u >= 0.62 && !act.loaded) {
        act.loaded = true;
        if (ws.loadShell()) { this.audio.foley('shellIn'); this.updateSaddle(ws); act.onEvent && act.onEvent('shell'); }
      }
      if (u >= 1) {
        act.loaded = false;
        act.shellT = 0;
        if (act.cancel || ws.mag >= ws.stats.mag || ws.reserve <= 0) { act.stage = 'end'; act.endT = 0; }
      }
    } else {
      act.endT += dt;
      act.hand = Math.max(0, 1 - act.endT / 0.3);
      if (act.endT >= 0.32) {
        this.action = null;
        if (!ws.chambered) { this.startPump(act.onEvent); }
        act.onEvent && act.onEvent('done');
      }
    }
  }

  event(name, act, c) {
    const ws = this.ws;
    const cb = act.onEvent;
    if (name === 'magOut' || name === 'magIn' || name === 'magTap' || name === 'boltRelease') this.audio.foley(name);
    if (name === 'swap') { ws.swapMag(); this.gun.mag.setAmmo(ws.mag); }
    if (name === 'magIn' && !act.fired.has(0.5) && !act.anim.events.some((e) => e[1] === 'swap')) { ws.swapMag(); this.gun.mag.setAmmo(ws.mag); }
    if (name === 'boltRelease') { ws.closeBolt(); this.gun.mag.setAmmo(ws.mag); }
    if (name === 'drop') {
      this.audio.foley('magOut');
      this.dropMag(c);
    }
    if (name === 'ejectShell') this.ejectBrass(c, 'shell');
    if (cb) cb(name);
  }

  dropMag(c) {
    const g = this.gun;
    let mesh;
    if (this.ws.id === 'kestrel') mesh = buildRifleMag(this.M.gun, this.ws.stats.mag > 30, false).group;
    else mesh = g.mag.group.clone();
    mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    const world = new THREE.Vector3();
    const q = new THREE.Quaternion();
    g.mag.group.updateWorldMatrix(true, false);
    world.setFromMatrixPosition(g.mag.group.matrixWorld);
    c.camera.localToWorld(world);
    q.copy(c.camera.quaternion);
    const v = new THREE.Vector3(0.2, -1.2, 0.3).applyQuaternion(c.camera.quaternion).add(c.playerVel || new THREE.Vector3());
    this.fx.dropProp(mesh, world, q, v, 5, 60, 0.012);
  }

  ejectBrass(c, kind) {
    const g = this.gun;
    const p = this.gunToWorld(g.anchors.eject, c.camera);
    const cq = c.camera.quaternion;
    const v = new THREE.Vector3(2.4 + Math.random() * 0.8, 1.3 + Math.random() * 0.6, 0.6).applyQuaternion(cq);
    if (kind === 'shell') v.multiplyScalar(0.7);
    if (c.playerVel) v.add(c.playerVel);
    this.fx.eject(kind, p, v);
  }

  // Gloved hands on the grip and the support position; forearms reach back off-screen.
  placeArms(blend, target) {
    const g = this.gun;
    const root = g.root;
    root.updateWorldMatrix(true, true);
    const qGun = new THREE.Quaternion();
    root.getWorldQuaternion(qGun);
    const grip = root.localToWorld(g.anchors.grip.clone());
    const qR = qGun.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.32, 0, 0.12)));
    this.handR.position.copy(grip).add(new THREE.Vector3(0.004, 0, 0).applyQuaternion(qGun));
    this.handR.quaternion.copy(qR);
    // Support hand
    let fore = g.anchors.fore.clone();
    if (g.parts.pump && (!this.action || this.action.name === 'pump')) fore.z += g.parts.pump.position.z;
    if (blend > 0 && target) {
      let t;
      if (target === 'mag') { g.mag.group.updateWorldMatrix(true, false); t = new THREE.Vector3(0, -0.07, -0.1).applyMatrix4(g.mag.group.matrix); }
      else if (target === 'bolt') t = new THREE.Vector3(-0.02, -0.01, -0.035);
      else t = g.anchors.magWell.clone().add(new THREE.Vector3(0, -0.04 - (this.action && this.action.handDip ? (1 - this.action.handDip) * 0.12 : 0.12), 0));
      fore.lerp(t, blend);
    }
    const foreW = root.localToWorld(fore);
    this.handL.position.copy(foreW);
    const vertical = g.foreGrip === 'vertical' && blend < 0.2;
    const qL = qGun.clone().multiply(new THREE.Quaternion().setFromEuler(vertical ? new THREE.Euler(-0.2, 0, 0) : new THREE.Euler(-1.2, 0.2, -0.5)));
    this.handL.quaternion.copy(qL);
    this.aimFore(this.foreR, this.handR, new THREE.Vector3(0.28, -0.46, 0.12), qR);
    this.aimFore(this.foreL, this.handL, new THREE.Vector3(-0.16, -0.5, -0.12), qL);
  }

  aimFore(fore, hand, elbow, q) {
    const wrist = new THREE.Vector3(0, -0.07, 0.03).applyQuaternion(q).add(hand.position);
    const dir = new THREE.Vector3().subVectors(elbow, wrist);
    const len = dir.length();
    fore.position.copy(wrist);
    fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    fore.scale.set(1, len, 1);
  }
}
