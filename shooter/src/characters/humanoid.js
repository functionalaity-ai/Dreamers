// Procedural operator: one SkinnedMesh (see body.js) on a simple skeleton, animated procedurally:
// locomotion, crouch, a shouldered long-gun hold (bladed torso, butt in the shoulder pocket, cheek
// on the stock) that eases into a sprint carry and a reload, two-bone arm IK onto the weapon, hit
// reactions and death. Bone pitch follows the right-hand rule: +x tips a bone that points up
// backwards, and swings one that points down forwards.
import * as THREE from 'three';
import { buildBody, EYE } from './body.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _e = new THREE.Euler();

const BONES = [
  ['root', -1, [0, 0, 0]],
  ['hips', 0, [0, 0.97, 0]],
  ['spine', 1, [0, 0.12, 0]],
  ['chest', 2, [0, 0.2, 0]],
  ['neck', 3, [0, 0.22, 0]],
  ['head', 4, [0, 0.1, 0]],
  ['armL', 3, [-0.205, 0.17, 0]],
  ['foreL', 6, [0, -0.31, 0]],
  ['handL', 7, [0, -0.29, 0]],
  ['armR', 3, [0.205, 0.17, 0]],
  ['foreR', 9, [0, -0.31, 0]],
  ['handR', 10, [0, -0.29, 0]],
  ['thighL', 1, [-0.095, -0.05, 0]],
  ['shinL', 12, [0, -0.43, 0]],
  ['footL', 13, [0, -0.42, 0]],
  ['thighR', 1, [0.095, -0.05, 0]],
  ['shinR', 15, [0, -0.43, 0]],
  ['footR', 16, [0, -0.42, 0]],
];
const B = {};
BONES.forEach((b, i) => { B[b[0]] = i; });
const ARM_UP = 0.31, ARM_LO = 0.29;

// Long guns: the butt pad's centre in gun space; how far the torso turns toward the support side
// (a longer stock needs more); how much lower the butt seats when the sights stand taller over
// it; and how far back along the gun the support hand may ride from its fore anchor when the
// arm can't reach, settling onto the underside of the rail or pump (`rail`, gun-space y), so a
// vertical or angled grip becomes a hand stop.
const STOCKS = {
  kestrel: { butt: new THREE.Vector3(0, -0.028, 0.314), twist: -0.55, drop: 0, slide: 0.12, rail: -0.012 },
  bastion: { butt: new THREE.Vector3(0, -0.035, 0.455), twist: -0.82, drop: 0.018, slide: 0.08, rail: -0.012 },
};
// The shouldered hold, in chest space: the right shoulder pocket the butt seats in (high, as an
// AR's straight stock and tall sights want), how far the firing shoulder rolls in to form it and
// the support shoulder reaches forward, and how far the neck juts forward onto the stock.
const POCKET = new THREE.Vector3(0.085, 0.232, -0.125);
const ROLL_R = new THREE.Vector3(-0.012, 0.012, -0.02);
const REACH = new THREE.Vector3(0.012, 0.004, -0.042);
const JUT = new THREE.Vector3(0, -0.008, -0.035);
// The upper body leans over the gun a little.
const OVER = -0.04;
// Where the eye rides on the stock (ahead of the butt pad), and the face's cant onto it.
const EYE_BACK = 0.078, TILT = -0.24;
const EYE_R = new THREE.Vector3(...EYE);
const NECK = BONES[B.head][2][1];   // neck joint to head joint

function restPositions() {
  const out = [];
  BONES.forEach((b, i) => {
    const p = new THREE.Vector3(...b[2]);
    if (b[1] >= 0) p.add(out[b[1]]);
    out[i] = p;
  });
  return out;
}
const REST = restPositions();

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quatOf = (x, y, z, out = new THREE.Quaternion()) => out.setFromEuler(_e.set(x, y, z, 'YXZ'));
const ONE = new THREE.Vector3(1, 1, 1);

// Skydiving poses (see Humanoid.pose). Torso and legs as euler angles per bone (the right-hand
// rule above: +x tips an upward bone back and swings a downward one forward); the hands as
// targets in the chest's frame (x right, y up, z back), reached by two-bone IK with the elbow
// pulled toward `pole`. Leg z angles are for the left leg (mirrored for the right).
const POSES = {
  freefall: {
    spine: [0.2, 0, 0], chest: [0.14, 0, 0], neck: [0.32, 0, 0], head: [0.42, 0, 0],
    thigh: [-0.12, 0, -0.2], shin: [-1.45, 0, 0], foot: [0.35, 0, 0],
    hand: [-0.5, 0.46, 0.1], pole: [-1, -0.7, 0.35],
  },
  dive: {
    spine: [0.02, 0, 0], chest: [0, 0, 0], neck: [0.22, 0, 0], head: [0.3, 0, 0],
    thigh: [-0.03, 0, -0.04], shin: [-0.08, 0, 0], foot: [-0.75, 0, 0],
    hand: [-0.33, -0.42, 0.16], pole: [-0.3, 0, 1],
  },
  canopy: {
    spine: [-0.06, 0, 0], chest: [0.02, 0, 0], neck: [0.04, 0, 0], head: [-0.12, 0, 0],
    thigh: [0.32, 0, -0.06], shin: [-0.42, 0, 0], foot: [-0.3, 0, 0],
    hand: [-0.25, 0.6, 0.03], pole: [-1, -0.25, 0.35],
  },
};

function poseTargets(name, T, o) {
  const out = poseTargets.out || (poseTargets.out = {});
  const lean = o.lean || 0, legs = o.legs || 0;
  const q = (n, x, y, z) => quatOf(x, y, z, out[n] || (out[n] = new THREE.Quaternion()));
  q('hips', 0, 0, 0);
  q('spine', T.spine[0], T.spine[1], T.spine[2] + lean * 0.12);
  q('chest', T.chest[0], T.chest[1], T.chest[2] + lean * 0.08);
  q('neck', T.neck[0], T.neck[1], -lean * 0.1);
  q('head', T.head[0], T.head[1], -lean * 0.1);
  for (const [key, sx] of [['L', 1], ['R', -1]]) {
    // legs: under canopy, `legs` brings the knees up and the feet together for the landing
    q('thigh' + key, T.thigh[0] + legs * 0.45, T.thigh[1], (T.thigh[2] + legs * 0.04) * sx + lean * 0.08);
    q('shin' + key, T.shin[0] - legs * 0.55, 0, 0);
    q('foot' + key, T.foot[0] + legs * 0.2, 0, 0);
    // arms: IK from the shoulder to the hand target, in the chest's frame
    const tog = key === 'L' ? o.toggleL || 0 : o.toggleR || 0;
    const sh = _v.copy(REST[B['arm' + key]]).sub(REST[B.chest]);
    const hand = _v2.set(T.hand[0] * sx, T.hand[1], T.hand[2]);
    if (name === 'canopy') hand.add(_v4.set(-0.06 * sx * tog, -0.82 * tog, -0.1 * tog));
    const pole = _v3.set(T.pole[0] * sx, T.pole[1], T.pole[2]).normalize();
    const to = hand.sub(sh);
    const d = Math.max(0.08, Math.min(ARM_UP + ARM_LO - 0.002, to.length()));
    to.normalize();
    const A = Math.acos(Math.max(-1, Math.min(1, (ARM_UP * ARM_UP + d * d - ARM_LO * ARM_LO) / (2 * ARM_UP * d))));
    const w = pole.addScaledVector(to, -pole.dot(to));
    if (w.lengthSq() < 1e-6) w.set(0, -1, 0);
    w.normalize();
    const elbow = _v4.copy(sh).addScaledVector(to, Math.cos(A) * ARM_UP).addScaledVector(w, Math.sin(A) * ARM_UP);
    const dirU = elbow.clone().sub(sh).normalize();
    const dirF = sh.addScaledVector(to, d).sub(elbow).normalize();
    const qU = (out['arm' + key] || (out['arm' + key] = new THREE.Quaternion())).setFromUnitVectors(DOWN, dirU);
    const qF = _q.setFromUnitVectors(DOWN, dirF);
    (out['fore' + key] || (out['fore' + key] = new THREE.Quaternion())).copy(qU).invert().multiply(qF);
    q('hand' + key, name === 'dive' ? 0.2 : -0.2, 0, 0);
  }
  return out;
}

export class Humanoid {
  constructor(material, faction, seed) {
    this.group = new THREE.Group();
    const bones = BONES.map((b) => {
      const bone = new THREE.Bone();
      bone.name = b[0];
      return bone;
    });
    BONES.forEach((b, i) => {
      const p = new THREE.Vector3(...b[2]);
      bones[i].position.copy(p);
      if (b[1] >= 0) bones[b[1]].add(bones[i]);
    });
    this.bones = bones;
    this.b = {};
    BONES.forEach((b, i) => { this.b[b[0]] = bones[i]; });
    const geo = buildBody(faction, seed, B, REST, mulberry(seed));
    const mesh = new THREE.SkinnedMesh(geo, material);
    mesh.add(bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.group.add(mesh);
    this.gunPivot = new THREE.Group();   // weapon transform in model space
    this.group.add(this.gunPivot);
    this.gun = null;
    this.gunMuzzle = new THREE.Vector3();
    this.phase = seed % 7;
    this.crouch = 0;
    // hold blend: sprint carry and reload ease in and out of the shouldered hold
    this.carry = 0;
    this.reloading = 0;
    this.still = 1;
    this.settled = false;     // the first update snaps straight to its pose
    this.dead = false;
    this.deathT = 0;
    this.fallDir = 1;
    this.hit = new THREE.Vector2();
    this.hitV = new THREE.Vector2();
    this.recoil = 0;
    this.lean = 0;
    this.droppedGun = null;
    this.aimW = 1;
    this.shouldered = new THREE.Matrix4();   // the gun as shouldered, which the head settles against
    this.stock = Object.assign({}, STOCKS.kestrel);
    this.sightY = 0.075;
  }

  // gun: the built Gun; its id picks the stock and its sight height sets where the eye goes.
  setGun(obj, anchors, gun) {
    if (this.gun) this.gunPivot.remove(this.gun);
    this.gun = obj;
    this.anchors = anchors;
    this.gunPivot.add(obj);
    const st = gun && STOCKS[gun.id];
    // without a known stock, assume a carbine's butt behind the pistol grip
    const butt = anchors.butt || (st ? st.butt : anchors.grip.clone().add(new THREE.Vector3(0, 0.032, 0.264)));
    this.stock = st ? Object.assign({}, st, { butt }) : { butt, twist: -0.55, drop: 0, slide: 0.1, rail: anchors.fore.y };
    this.sightY = gun && gun.sight ? gun.sight.y : 0.075;
  }

  // s: { speed, fwd, side, crouch, aimPitch, sprint, reloading, lean, raise (lifts the butt) }
  update(dt, s) {
    const b = this.b;
    if (this.dead) { this.updateDeath(dt); return; }
    const ease = (cur, to, rate) => (this.settled ? cur + (to - cur) * Math.min(1, dt * rate) : to);
    this.crouch = ease(this.crouch, s.crouch ? 1 : 0, 8);
    this.carry = ease(this.carry, s.sprint ? 1 : 0, 7);
    this.reloading = ease(this.reloading, s.reloading ? 1 : 0, 7);
    const c = this.crouch;
    const rel = this.reloading * (1 - this.carry);
    const aim = Math.max(0, 1 - this.carry - rel);
    this.aimW = aim;
    const speed = s.speed || 0;
    const run = Math.min(1, speed / 6);
    this.phase += dt * (speed > 0.2 ? (2.2 + speed * 1.35) * (s.fwd < -0.3 ? -1 : 1) : 0);
    const ph = this.phase;
    const amp = speed > 0.2 ? Math.min(1, speed / 2.5) : 0;
    const swing = (0.42 + run * 0.32) * amp * (1 - c * 0.55);
    const stance = 1 - amp;
    // Standing behind a shouldered gun: support foot forward, hips turned a little with the torso.
    this.still = ease(this.still, amp < 0.05 ? 1 : 0, 6);
    this.settled = true;
    const stagger = this.still * aim * (1 - c);
    // Hips: bob and crouch
    b.hips.position.y = REST[B.hips].y - c * 0.36 - Math.abs(Math.sin(ph)) * 0.035 * amp + 0.015 * amp - stagger * 0.012;
    const hipYaw = -0.12 * stagger;
    b.hips.rotation.set(0, hipYaw, 0);
    const side = s.side || 0;
    const bend = c * 1.15;
    for (const [key, sign] of [['L', 1], ['R', -1]]) {
      const t = b['thigh' + key], sh = b['shin' + key], f = b['foot' + key];
      const a = Math.sin(ph + (sign > 0 ? 0 : Math.PI));
      // lead (left) leg reaches forward, the rear one steps back; feet stay flat
      const st = sign > 0 ? [0.15, -0.08, -0.07] : [-0.1, -0.12, 0.22];
      t.rotation.set(a * swing + bend + stance * 0.12 + st[0] * stagger, 0, side * 0.25 * amp * sign * -1 + sign * (0.07 * stance + 0.02));
      sh.rotation.set(-Math.max(0, -Math.cos(ph + (sign > 0 ? 0 : Math.PI))) * swing * 1.4 - bend * 1.6 - stance * 0.24 + st[1] * stagger, 0, 0);
      f.rotation.set(bend * 0.45 - a * swing * 0.25 + stance * 0.12 + st[2] * stagger, -hipYaw * (sign > 0 ? 0.6 : 0.3), -sign * 0.07 * stance);
    }
    // Torso: bladed toward the target when shouldered, leaning in behind the gun (and into a
    // sprint or a crouch); aiming up or down tips the whole upper body so the cheek weld holds.
    const pitch = s.aimPitch || 0;
    const twist = (this.holdPistol ? 0 : this.stock.twist) * aim - 0.25 * rel - hipYaw;
    const lean = -(aim * 0.06 + this.carry * 0.14 * Math.min(1, speed / 3) + c * 0.12) + this.recoil * 0.035 - this.hit.x * 0.6;
    b.spine.rotation.set(lean + pitch * 0.3 * (0.5 + aim * 0.5), twist * 0.45 + this.hit.y * 0.5, this.lean * 0.5 + OVER * aim);
    b.chest.rotation.set(pitch * 0.3 * (0.5 + aim * 0.5) + c * 0.04 - rel * 0.06, twist * 0.55, this.lean * 0.4);
    // Neck and head when not shouldered (poseGun swings them onto the stock when aiming).
    b.neck.rotation.set(pitch * 0.2 + this.carry * 0.08 - rel * 0.22, 0, 0);
    b.head.rotation.set(pitch * 0.2 + this.carry * 0.06 + c * 0.06 - rel * 0.2, 0, 0);
    // Hit reactions: damped spring
    this.hitV.x += (-this.hit.x * 90 - this.hitV.x * 12) * dt;
    this.hitV.y += (-this.hit.y * 90 - this.hitV.y * 12) * dt;
    this.hit.x += this.hitV.x * dt;
    this.hit.y += this.hitV.y * dt;
    this.recoil *= Math.exp(-dt * 14);
    this.group.updateMatrixWorld(true);
    this.poseGun(pitch, s);
  }

  // Place the weapon, settle the head onto the stock, then bend both arms onto the gun.
  poseGun(pitch, s) {
    const b = this.b;
    const chest = b.chest;
    chest.updateWorldMatrix(true, false);
    const local = this.group.matrixWorld.clone().invert();
    const chestM = new THREE.Matrix4().multiplyMatrices(local, chest.matrixWorld);
    const chestQ = new THREE.Quaternion().setFromRotationMatrix(chestM);
    const pos = this.gunPivot.position, quat = this.gunPivot.quaternion;
    const aim = this.holdPistol ? 0 : this.aimW;
    if (this.holdPistol) {
      pos.set(0.02, 0.12 - this.carry * 0.12, -0.42).applyMatrix4(chestM);
      quat.copy(chestQ).multiply(quatOf(this.carry * 0.7 + this.reloading * 0.3 + pitch * 0.55 + this.recoil * 0.08, this.carry * 0.6, 0, _q));
    } else {
      // Shouldered: the gun points where the operator aims with its butt in the pocket (the
      // recoil drives the shoulder back and the muzzle up).
      const aimQ = quatOf(pitch + this.recoil * 0.07, 0, 0, _q);
      const aimP = _v.copy(POCKET).add(_v4.set(0, (s.raise || 0) - this.stock.drop, this.recoil * 0.02)).applyMatrix4(chestM)
        .sub(_v2.copy(this.stock.butt).applyQuaternion(aimQ));
      // Carried at port arms for a sprint; canted in front of the chest for a reload.
      const carryP = _v2.set(0.09, 0.01, -0.2).applyMatrix4(chestM);
      const carryQ = _q2.copy(chestQ).multiply(quatOf(0.7 + pitch * 0.2, 0.6, 0, _q3));
      const relP = _v3.set(0.075, 0.045, -0.25).applyMatrix4(chestM);
      const relQ = new THREE.Quaternion().copy(chestQ).multiply(quatOf(0.32, 0.42, -0.38, _q3));
      // the head settles against the shouldered gun even while easing in or out of it
      this.shouldered.compose(aimP, aimQ, ONE).premultiply(this.group.matrixWorld);
      pos.copy(aimP).lerp(relP, this.reloading).lerp(carryP, this.carry);
      quat.copy(aimQ).slerp(relQ, this.reloading).slerp(carryQ, this.carry);
    }
    this.gunPivot.scale.set(1, 1, 1);
    this.gunPivot.updateMatrixWorld(true);
    // Behind a shouldered gun the neck juts forward, the firing shoulder rolls in round the butt
    // and the support shoulder reaches.
    b.neck.position.copy(REST[B.neck]).sub(REST[B.chest]).addScaledVector(JUT, aim);
    b.armL.position.copy(REST[B.armL]).sub(REST[B.chest]).addScaledVector(REACH, aim);
    b.armR.position.copy(REST[B.armR]).sub(REST[B.chest]).addScaledVector(ROLL_R, aim);
    chest.updateWorldMatrix(false, true);
    this.settleHead(pitch, aim, this.shouldered);
    if (!this.anchors) return;
    const gw = this.gunPivot.matrixWorld;
    const gq = new THREE.Quaternion();
    this.gunPivot.getWorldQuaternion(gq);
    const grip = this.anchors.grip.clone().applyMatrix4(gw);
    const fore = this.anchors.fore.clone().applyMatrix4(gw);
    // Out of reach, the support hand rides back along the rail or pump (onto its underside).
    const sh = b.armL.getWorldPosition(_v);
    const d = _v2.subVectors(fore, sh), reach = ARM_UP + ARM_LO - 0.012;
    if (!this.holdPistol && d.length() > reach) {
      const axis = _v3.set(0, 0, 1).transformDirection(gw);
      const da = d.dot(axis), disc = da * da - d.lengthSq() + reach * reach;
      const t = Math.max(0, Math.min(this.stock.slide, -da - Math.sqrt(Math.max(0, disc))));
      const onRail = Math.min(1, t / 0.03);
      fore.copy(this.anchors.fore).add(_v4.set(0, (this.stock.rail - this.anchors.fore.y) * onRail, t)).applyMatrix4(gw);
    }
    if (this.reloading > 0.001) fore.lerp(this.anchors.magWell.clone().applyMatrix4(gw), this.reloading);
    this.solveArm('R', grip, gq, 1, aim);
    this.solveArm('L', fore, gq, -1, aim);
    this.gunMuzzle.copy(this.anchors.muzzle).applyMatrix4(gw);
  }

  // Shouldered, the face looks down the gun (undoing the torso's twist), canted onto the stock,
  // with the right eye on the sight line a little ahead of the butt. The face's pitch is what
  // gives: it settles where the head joint sits one neck length from the neck joint, and the
  // neck turns to put it there. `gunW` is the shouldered gun; `aim` blends from the free pose.
  settleHead(pitch, aim, gunW) {
    if (aim < 0.001) { this.facePitch = undefined; return; }
    const b = this.b;
    const freeNeck = b.neck.quaternion.clone(), freeHead = b.head.quaternion.clone();
    const groupQ = this.group.getWorldQuaternion(new THREE.Quaternion());
    const N = b.neck.getWorldPosition(new THREE.Vector3());
    const eye = _v3.set(0, this.sightY + 0.006, this.stock.butt.z - EYE_BACK).applyMatrix4(gunW);
    const faceW = new THREE.Quaternion(), H = new THREE.Vector3();
    const gap = (p) => {
      faceW.copy(groupQ).multiply(quatOf(p, 0, TILT, _q));
      return H.copy(EYE_R).applyQuaternion(faceW).negate().add(eye).distanceTo(N) - NECK;
    };
    const bisect = (p0, g0, p1, steps) => {
      for (let k = 0; k < steps; k++) { const m = (p0 + p1) / 2; if (Math.sign(gap(m)) === Math.sign(g0)) p0 = m; else p1 = m; }
      return (p0 + p1) / 2;
    };
    // Usually last frame's pitch is a close bracket; otherwise scan for the pitches where the gap
    // closes, bisect each and keep the one nearest last frame's (so the head doesn't hop between
    // solutions), or the nearest miss when out of reach.
    const want = this.facePitch !== undefined ? this.facePitch : pitch - 0.25;
    let best = null;
    if (this.facePitch !== undefined) {
      const g0 = gap(want - 0.05), g1 = gap(want + 0.05);
      if (Math.sign(g0) !== Math.sign(g1)) best = bisect(want - 0.05, g0, want + 0.05, 8);
    }
    if (best === null) {
      const lo = pitch - 0.8, hi = pitch + 0.2, n = 12;
      let near = hi, nearG = Infinity, prevP = 0, prevG = 0;
      for (let i = 0; i <= n; i++) {
        const p = lo + (hi - lo) * (i / n), g = gap(p);
        if (Math.abs(g) < nearG) { nearG = Math.abs(g); near = p; }
        if (i > 0 && Math.sign(g) !== Math.sign(prevG)) {
          const r = bisect(prevP, prevG, p, 12);
          if (best === null || Math.abs(r - want) < Math.abs(best - want)) best = r;
        }
        prevP = p; prevG = g;
      }
      if (best === null) best = near;
    }
    gap(best);
    this.facePitch = best;
    const dir = H.sub(N).normalize();
    // the neck sits halfway between chest and face, turned to point at the head joint
    const chestW = b.chest.getWorldQuaternion(new THREE.Quaternion());
    const neckW = chestW.clone().slerp(faceW, 0.5);
    neckW.premultiply(_q2.setFromUnitVectors(_v4.set(0, 1, 0).applyQuaternion(neckW), dir));
    b.neck.quaternion.copy(freeNeck).slerp(chestW.invert().multiply(neckW), aim);
    b.head.quaternion.copy(freeHead).slerp(neckW.invert().multiply(faceW), aim);
  }

  solveArm(side, target, gunQuat, sx, aim) {
    const arm = this.b['arm' + side], fore = this.b['fore' + side], hand = this.b['hand' + side];
    arm.rotation.set(0, 0, 0);
    fore.rotation.set(0, 0, 0);
    arm.updateWorldMatrix(true, false);
    const S = _v.setFromMatrixPosition(arm.matrixWorld);
    const toT = _v2.subVectors(target, S);
    let d = toT.length();
    const a = ARM_UP, c = ARM_LO;
    d = Math.max(0.08, Math.min(a + c - 0.002, d));
    toT.normalize();
    const cosA = (a * a + d * d - c * c) / (2 * a * d);
    const angA = Math.acos(Math.max(-1, Math.min(1, cosA)));
    // Elbows hang down and slightly out; behind a shouldered gun the firing elbow lifts out
    // to the side and the support elbow tucks under the gun.
    const rootQ = new THREE.Quaternion();
    this.group.getWorldQuaternion(rootQ);
    const pole = sx > 0 ? _v3.set(0.6 + aim * 0.35, -1 + aim * 0.3, 0.15 + aim * 0.15) : _v3.set(-0.6 + aim * 0.35, -1, 0.15 - aim * 0.1);
    pole.applyQuaternion(rootQ).normalize();
    const w = _v4.copy(pole).addScaledVector(toT, -pole.dot(toT));
    if (w.lengthSq() < 1e-6) w.set(0, -1, 0);
    w.normalize();
    const elbow = S.clone().addScaledVector(toT, Math.cos(angA) * a).addScaledVector(w, Math.sin(angA) * a);
    const dirU = elbow.clone().sub(S).normalize();
    const dirF = target.clone().sub(elbow).normalize();
    const parentQ = new THREE.Quaternion();
    arm.parent.getWorldQuaternion(parentQ);
    const qU = new THREE.Quaternion().setFromUnitVectors(DOWN, dirU);
    arm.quaternion.copy(parentQ.clone().invert().multiply(qU));
    arm.updateWorldMatrix(false, false);
    const qF = new THREE.Quaternion().setFromUnitVectors(DOWN, dirF);
    fore.quaternion.copy(qU.clone().invert().multiply(qF));
    fore.updateWorldMatrix(false, false);
    // Hand follows the gun's orientation (fingers forward along the weapon).
    const handQ = gunQuat.clone().multiply(_q.setFromEuler(_e.set(Math.PI / 2, 0, 0)));
    hand.quaternion.copy(qF.clone().invert().multiply(handQ));
  }

  die(dir) {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.fallDir = dir >= 0 ? 1 : -1;
    this.fallSide = (Math.random() - 0.5) * 0.6;
    this.limp = Math.random();
    this.twistAtDeath = this.b.spine.rotation.y + this.b.chest.rotation.y;
  }

  // fallDir 1: hit from the front, so the body folds backwards.
  updateDeath(dt) {
    const b = this.b;
    this.group.updateMatrixWorld(true);
    this.deathT = Math.min(1, this.deathT + dt * 1.25);
    const t = this.deathT;
    const k = t * t * (3 - 2 * t);
    const fall = Math.min(1, t * t * 1.6);
    const unwind = (this.twistAtDeath || 0) * (1 - k);
    // Knees give way first, then the body tips over.
    b.hips.position.y = REST[B.hips].y - 0.25 * Math.min(1, t * 3) - 0.62 * fall;
    b.hips.rotation.set(this.fallDir * 1.45 * fall, this.fallSide, this.fallSide * fall);
    for (const key of ['L', 'R']) {
      b['thigh' + key].rotation.set(0.9 * Math.min(1, t * 2.5) * (1 - fall * 0.6), 0, (key === 'L' ? 0.15 : -0.15) * k);
      b['shin' + key].rotation.set(-1.5 * Math.min(1, t * 2.5) * (1 - fall * 0.7), 0, 0);
      b['foot' + key].rotation.set(0, 0, 0);
    }
    b.spine.rotation.set(this.fallDir * 0.2 * k, unwind * 0.45, 0);
    b.chest.rotation.set(-0.1 * k, unwind * 0.55, 0);
    b.neck.position.copy(REST[B.neck]).sub(REST[B.chest]);
    b.neck.quaternion.slerp(_q.identity(), Math.min(1, dt * 6));
    b.head.rotation.set(-0.4 * k, 0.4 * this.fallSide, 0);
    for (const [key, sx] of [['L', -1], ['R', 1]]) {
      b['arm' + key].position.copy(REST[B['arm' + key]]).sub(REST[B.chest]);
      b['arm' + key].quaternion.setFromEuler(_e.set(-this.fallDir * (0.6 + this.limp) * k, 0, sx * (0.4 + k * 0.9)));
      b['fore' + key].rotation.set(0.5 * k, 0, 0);
      b['hand' + key].rotation.set(0, 0, 0);
    }
  }

  // Skydiving poses for the drop (game/drop.js), used in place of update() while airborne:
  //   'freefall' belly to earth in a box arch: arms out with the elbows bent, knees bent, head up
  //   'dive'     head down: arms swept back along the body, legs straight, toes pointed
  //   'canopy'   hanging in the harness with the hands up on the toggles and the legs hanging
  // k eases every bone from where it is toward the pose (1 snaps), so calls stack:
  // pose('freefall', 1); pose('dive', 0.4) is a 40% dive. o: { toggleL, toggleR (0..1, hands
  // pulled down on the toggles), legs (0..1, knees up and together for landing), lean (-1..1,
  // side lean) }. Laying the body flat or upright is the caller's job (the group's transform);
  // the weapon is hidden, and the next update() snaps straight back into the normal pose.
  pose(name, k = 1, o = {}) {
    const b = this.b, T = POSES[name];
    if (!T) return;
    const P = poseTargets(name, T, o);
    for (const n in P) {
      if (k >= 1) b[n].quaternion.copy(P[n]);
      else b[n].quaternion.slerp(P[n], k);
    }
    b.hips.position.copy(REST[B.hips]);
    for (const n of ['neck', 'armL', 'armR']) b[n].position.copy(REST[B[n]]).sub(REST[B.chest]);
    this.gunPivot.visible = false;
    this.settled = false;
    this.facePitch = undefined;
    this.group.updateMatrixWorld(true);
  }

  reset() {
    this.dead = false;
    this.deathT = 0;
    this.hit.set(0, 0);
    this.hitV.set(0, 0);
    this.crouch = 0;
    this.settled = false;
    this.gunPivot.visible = true;
  }

  // Positions of hitboxes in world space (approximate, for bullet tests).
  headPos(out) { this.b.head.updateWorldMatrix(true, false); return this.b.head.localToWorld(out.set(0, 0.078, -0.008)); }
  chestPos(out) { return this.b.chest.getWorldPosition(out).add(_v.set(0, 0.06, 0)); }
}
