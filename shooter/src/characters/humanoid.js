// Procedural operator: one SkinnedMesh with rigid-skinned body parts on a simple skeleton,
// animated procedurally (locomotion, crouch, two-bone arm IK onto the weapon, aim, death).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedBox } from '../core/geometry.js';

const REGION = { camo: [0, 0.5], fabric: [0.5, 0.5], skin: [0, 0], rubber: [0.5, 0] };
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();

const BONES = [
  ['root', -1, [0, 0, 0]],
  ['hips', 0, [0, 0.97, 0]],
  ['spine', 1, [0, 0.12, 0]],
  ['chest', 2, [0, 0.2, 0]],
  ['neck', 3, [0, 0.22, 0]],
  ['head', 4, [0, 0.1, 0]],
  ['armL', 3, [-0.205, 0.17, 0]],
  ['foreL', 6, [0, -0.29, 0]],
  ['handL', 7, [0, -0.26, 0]],
  ['armR', 3, [0.205, 0.17, 0]],
  ['foreR', 9, [0, -0.29, 0]],
  ['handR', 10, [0, -0.26, 0]],
  ['thighL', 1, [-0.095, -0.05, 0]],
  ['shinL', 12, [0, -0.43, 0]],
  ['footL', 13, [0, -0.42, 0]],
  ['thighR', 1, [0.095, -0.05, 0]],
  ['shinR', 15, [0, -0.43, 0]],
  ['footR', 16, [0, -0.42, 0]],
];
const B = {};
BONES.forEach((b, i) => { B[b[0]] = i; });
const ARM_UP = 0.29, ARM_LO = 0.26;

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

// Gear tints per faction.
const KIT = {
  msg: { gear: [0.62, 0.55, 0.42], helmet: 'camo', dark: [0.22, 0.2, 0.17], boots: [0.36, 0.28, 0.2] },
  volk: { gear: [0.2, 0.22, 0.21], helmet: 'fabricDark', dark: [0.12, 0.12, 0.12], boots: [0.1, 0.1, 0.1] },
};
const SKIN = [[0.86, 0.68, 0.56], [0.72, 0.53, 0.4], [0.55, 0.38, 0.27], [0.92, 0.76, 0.64], [0.42, 0.29, 0.21]];

class PartBuilder {
  constructor() { this.geos = []; }
  add(geo, bone, region, color, at) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (at) g.translate(at[0], at[1], at[2]);
    const n = g.attributes.position.count;
    const uv = g.attributes.uv;
    const off = REGION[region] || REGION.fabric;
    for (let i = 0; i < n; i++) uv.setXY(i, (uv.getX(i) % 1) * 0.49 + off[0] + 0.005, (uv.getY(i) % 1) * 0.49 + off[1] + 0.005);
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const lin = color.map((c) => Math.pow(c, 2.2)); // colours are authored in sRGB
    for (let i = 0; i < n; i++) {
      col[i * 3] = lin[0]; col[i * 3 + 1] = lin[1]; col[i * 3 + 2] = lin[2];
      si[i * 4] = bone; sw[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.geos.push(g);
  }
  build() { return mergeGeometries(this.geos, false); }
}

function rb(w, h, d, r = 0.02) { return roundedBox(w, h, d, r, 2); }
function cyl(r0, r1, h, seg = 12) { const g = new THREE.CylinderGeometry(r1, r0, h, seg); return g; }

function buildBody(faction, seed) {
  const kit = KIT[faction];
  const rnd = mulberry(seed);
  const skin = SKIN[Math.floor(rnd() * SKIN.length)];
  const W = [1, 1, 1];
  const P = new PartBuilder();
  const R = REST;
  const at = (bone, dx = 0, dy = 0, dz = 0) => [R[bone].x + dx, R[bone].y + dy, R[bone].z + dz];
  // Head and face
  const head = new THREE.SphereGeometry(0.1, 18, 14);
  head.scale(0.9, 1.12, 1.0);
  P.add(head, B.head, 'skin', skin, at(B.head, 0, 0.075, -0.005));
  P.add(new THREE.BoxGeometry(0.026, 0.045, 0.03), B.head, 'skin', skin, at(B.head, 0, 0.065, -0.1));
  P.add(new THREE.BoxGeometry(0.15, 0.018, 0.025), B.head, 'skin', skin.map((c) => c * 0.92), at(B.head, 0, 0.105, -0.088));
  for (const sx of [-0.035, 0.035]) P.add(new THREE.SphereGeometry(0.011, 8, 6), B.head, 'rubber', [0.08, 0.07, 0.06], at(B.head, sx, 0.088, -0.091));
  for (const sx of [-0.092, 0.092]) P.add(new THREE.BoxGeometry(0.02, 0.05, 0.035), B.head, 'skin', skin, at(B.head, sx, 0.075, 0));
  const covered = faction === 'volk' ? rnd() < 0.7 : rnd() < 0.25;
  if (covered) {
    // Balaclava over the lower face
    const bal = new THREE.SphereGeometry(0.104, 16, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55);
    bal.scale(0.92, 1.12, 1.02);
    P.add(bal, B.head, 'fabric', kit.dark, at(B.head, 0, 0.07, -0.006));
  } else if (rnd() < 0.6) {
    const beard = new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.4);
    beard.scale(0.92, 1.0, 1.02);
    P.add(beard, B.head, 'fabric', [0.2, 0.15, 0.11], at(B.head, 0, 0.068, -0.012));
  }
  // Helmet with rails, NVG shroud and a headset
  const helmet = new THREE.SphereGeometry(0.124, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  helmet.scale(1.0, 0.92, 1.1);
  const hreg = kit.helmet === 'camo' ? 'camo' : 'fabric';
  const hcol = kit.helmet === 'camo' ? W : [0.24, 0.25, 0.24];
  P.add(helmet, B.head, hreg, hcol, at(B.head, 0, 0.105, 0.005));
  P.add(new THREE.CylinderGeometry(0.125, 0.128, 0.02, 20, 1, true).scale(1, 1, 1.1), B.head, hreg, hcol.map((c) => c * 0.85), at(B.head, 0, 0.1, 0.005));
  for (const sx of [-1, 1]) {
    P.add(rb(0.012, 0.03, 0.11, 0.004), B.head, 'rubber', kit.dark, at(B.head, sx * 0.118, 0.115, 0.0));
    P.add(cyl(0.035, 0.035, 0.03, 14).rotateZ(Math.PI / 2), B.head, 'rubber', [0.12, 0.12, 0.12], at(B.head, sx * 0.105, 0.07, 0.005));
  }
  P.add(rb(0.05, 0.03, 0.025, 0.006), B.head, 'rubber', [0.1, 0.1, 0.1], at(B.head, 0, 0.17, -0.12));
  // Neck
  P.add(cyl(0.056, 0.05, 0.12, 12), B.neck, 'skin', skin, at(B.neck, 0, 0.03, 0));
  // Torso (shirt) and plate carrier
  P.add(rb(0.38, 0.32, 0.22, 0.07), B.chest, 'camo', W, at(B.chest, 0, 0.07, 0));
  P.add(rb(0.34, 0.24, 0.2, 0.06), B.spine, 'camo', W, at(B.spine, 0, 0.08, 0));
  P.add(rb(0.36, 0.19, 0.22, 0.06), B.hips, 'camo', W, at(B.hips, 0, -0.01, 0));
  P.add(rb(0.35, 0.05, 0.22, 0.015), B.hips, 'rubber', kit.dark, at(B.hips, 0, 0.065, 0));
  P.add(rb(0.3, 0.33, 0.05, 0.015), B.chest, 'fabric', kit.gear, at(B.chest, 0, 0.06, -0.115));
  P.add(rb(0.3, 0.34, 0.05, 0.015), B.chest, 'fabric', kit.gear, at(B.chest, 0, 0.07, 0.115));
  for (const sx of [-1, 1]) {
    P.add(rb(0.04, 0.16, 0.22, 0.012), B.chest, 'fabric', kit.gear, at(B.chest, sx * 0.165, -0.02, 0));
    P.add(rb(0.07, 0.03, 0.26, 0.01), B.chest, 'fabric', kit.gear, at(B.chest, sx * 0.1, 0.235, 0));
  }
  for (let i = 0; i < 3; i++) {
    P.add(rb(0.078, 0.11, 0.045, 0.01), B.chest, 'fabric', kit.gear.map((c) => c * 0.92), at(B.chest, -0.09 + i * 0.09, -0.02, -0.15));
    P.add(rb(0.08, 0.03, 0.05, 0.008), B.chest, 'fabric', kit.gear.map((c) => c * 0.8), at(B.chest, -0.09 + i * 0.09, 0.04, -0.152));
  }
  P.add(rb(0.12, 0.07, 0.04, 0.01), B.chest, 'fabric', kit.gear.map((c) => c * 0.95), at(B.chest, 0, 0.13, -0.15));
  P.add(rb(0.06, 0.14, 0.05, 0.01), B.chest, 'rubber', [0.12, 0.12, 0.12], at(B.chest, -0.19, 0.05, 0.02));
  P.add(cyl(0.004, 0.004, 0.18, 6), B.chest, 'rubber', [0.08, 0.08, 0.08], at(B.chest, -0.2, 0.2, 0.03));
  if (rnd() < 0.7) P.add(rb(0.27, 0.34, 0.13, 0.04), B.chest, 'fabric', kit.gear.map((c) => c * 0.88), at(B.chest, 0, 0.04, 0.2));
  // Arms
  for (const side of ['L', 'R']) {
    const arm = B['arm' + side], fore = B['fore' + side], hand = B['hand' + side];
    P.add(cyl(0.068, 0.056, ARM_UP, 12), arm, 'camo', W, at(arm, 0, -ARM_UP / 2, 0));
    P.add(new THREE.SphereGeometry(0.074, 12, 8), arm, 'camo', W, at(arm, 0, 0, 0));
    P.add(new THREE.SphereGeometry(0.057, 10, 8), fore, 'camo', W, at(fore, 0, 0, 0));
    P.add(cyl(0.056, 0.045, ARM_LO, 12), fore, 'camo', W, at(fore, 0, -ARM_LO / 2, 0));
    P.add(cyl(0.05, 0.05, 0.05, 12), fore, 'rubber', kit.dark, at(fore, 0, -ARM_LO + 0.02, 0));
    P.add(rb(0.07, 0.1, 0.035, 0.015), hand, 'rubber', kit.dark, at(hand, 0, -0.05, 0));
    P.add(rb(0.025, 0.05, 0.03, 0.01), hand, 'rubber', kit.dark, at(hand, side === 'L' ? 0.04 : -0.04, -0.03, -0.01));
  }
  // Legs
  for (const side of ['L', 'R']) {
    const th = B['thigh' + side], sh = B['shin' + side], ft = B['foot' + side];
    P.add(new THREE.SphereGeometry(0.098, 12, 8), th, 'camo', W, at(th, 0, -0.02, 0));
    P.add(cyl(0.098, 0.075, 0.43, 12), th, 'camo', W, at(th, 0, -0.215, 0));
    P.add(new THREE.SphereGeometry(0.074, 10, 8), sh, 'camo', W, at(sh, 0, 0, 0));
    P.add(cyl(0.072, 0.056, 0.42, 12), sh, 'camo', W, at(sh, 0, -0.21, 0));
    P.add(rb(0.1, 0.12, 0.05, 0.02), sh, 'fabric', kit.dark, at(sh, 0, -0.02, -0.06));
    P.add(rb(0.11, 0.12, 0.28, 0.03), ft, 'rubber', kit.boots, at(ft, 0, -0.0, -0.05));
    P.add(rb(0.115, 0.025, 0.29, 0.008), ft, 'rubber', [0.08, 0.07, 0.06], at(ft, 0, -0.062, -0.05));
  }
  P.add(rb(0.05, 0.16, 0.08, 0.01), B.thighR, 'rubber', kit.dark, at(B.thighR, 0.085, -0.13, 0.0));
  return P.build();
}

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
    const geo = buildBody(faction, seed);
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
    this.dead = false;
    this.deathT = 0;
    this.fallDir = 1;
    this.hit = new THREE.Vector2();
    this.hitV = new THREE.Vector2();
    this.recoil = 0;
    this.lean = 0;
    this.droppedGun = null;
  }

  setGun(obj, anchors) {
    if (this.gun) this.gunPivot.remove(this.gun);
    this.gun = obj;
    this.anchors = anchors;
    this.gunPivot.add(obj);
  }

  // s: { speed, fwd, side, crouch, aimPitch, sprint, reloading, lean, shoot }
  update(dt, s) {
    const b = this.b;
    if (this.dead) { this.updateDeath(dt); return; }
    this.crouch += ((s.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
    const c = this.crouch;
    const speed = s.speed || 0;
    const run = Math.min(1, speed / 6);
    this.phase += dt * (speed > 0.2 ? (2.2 + speed * 1.35) * (s.fwd < -0.3 ? -1 : 1) : 0);
    const ph = this.phase;
    const amp = speed > 0.2 ? Math.min(1, speed / 2.5) : 0;
    const swing = (0.42 + run * 0.32) * amp * (1 - c * 0.55);
    // Hips: bob and crouch
    b.hips.position.y = REST[B.hips].y - c * 0.36 - Math.abs(Math.sin(ph)) * 0.035 * amp + 0.015 * amp;
    b.hips.rotation.set(0, 0, 0);
    const side = s.side || 0;
    const bend = c * 1.15;
    for (const [key, sign] of [['L', 1], ['R', -1]]) {
      const t = b['thigh' + key], sh = b['shin' + key], f = b['foot' + key];
      const a = Math.sin(ph + (sign > 0 ? 0 : Math.PI));
      const stance = 1 - amp;
      t.rotation.set(a * swing + bend + stance * 0.12, 0, side * 0.25 * amp * sign * -1 + sign * (0.07 * stance + 0.02));
      sh.rotation.set(-Math.max(0, -Math.cos(ph + (sign > 0 ? 0 : Math.PI))) * swing * 1.4 - bend * 1.6 - stance * 0.24, 0, 0);
      f.rotation.set(bend * 0.45 - a * swing * 0.25 + stance * 0.12, 0, -sign * 0.07 * stance);
    }
    // Torso: lean into sprint, counter the crouch
    const pitch = s.aimPitch || 0;
    b.spine.rotation.set(c * 0.25 + (s.sprint ? 0.15 : 0) + this.hit.x * 0.6, this.hit.y * 0.5, this.lean * 0.5);
    b.chest.rotation.set(-pitch * 0.45 - c * 0.12, 0, this.lean * 0.4);
    b.neck.rotation.set(-pitch * 0.25, 0, 0);
    b.head.rotation.set(-pitch * 0.2, 0, 0);
    // Hit reactions: damped spring
    this.hitV.x += (-this.hit.x * 90 - this.hitV.x * 12) * dt;
    this.hitV.y += (-this.hit.y * 90 - this.hitV.y * 12) * dt;
    this.hit.x += this.hitV.x * dt;
    this.hit.y += this.hitV.y * dt;
    this.recoil *= Math.exp(-dt * 14);
    this.group.updateMatrixWorld(true);
    this.poseGun(pitch, s);
  }

  // Place the weapon relative to the chest, then bend both arms onto it.
  poseGun(pitch, s) {
    const b = this.b;
    const chest = b.chest;
    chest.updateWorldMatrix(true, false);
    const local = this.group.matrixWorld.clone().invert();
    const chestM = new THREE.Matrix4().multiplyMatrices(local, chest.matrixWorld);
    const lowered = s.sprint ? 1 : s.reloading ? 0.45 : 0;
    const gunM = new THREE.Matrix4();
    const off = this.holdPistol ? new THREE.Vector3(0.02, 0.12, -0.42) : new THREE.Vector3(0.09, 0.13 - lowered * 0.12, -0.2 - this.recoil * 0.04);
    const rot = new THREE.Euler(lowered * 0.7 - pitch * 0.55 + this.recoil * 0.08, lowered * 0.6, 0, 'YXZ');
    gunM.compose(off, new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(1, 1, 1));
    gunM.premultiply(chestM);
    gunM.decompose(this.gunPivot.position, this.gunPivot.quaternion, this.gunPivot.scale);
    this.gunPivot.updateMatrixWorld(true);
    if (!this.anchors) return;
    const grip = this.anchors.grip.clone().applyMatrix4(this.gunPivot.matrixWorld);
    const fore = (s.reloading ? this.anchors.magWell : this.anchors.fore).clone().applyMatrix4(this.gunPivot.matrixWorld);
    const gq = new THREE.Quaternion();
    this.gunPivot.getWorldQuaternion(gq);
    this.solveArm('R', grip, gq, 1);
    this.solveArm('L', fore, gq, -1);
    this.gunMuzzle.copy(this.anchors.muzzle).applyMatrix4(this.gunPivot.matrixWorld);
  }

  solveArm(side, target, gunQuat, sx) {
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
    // Elbows hang down and slightly outwards.
    const rootQ = new THREE.Quaternion();
    this.group.getWorldQuaternion(rootQ);
    const pole = _v3.set(sx * 0.6, -1, 0.15).applyQuaternion(rootQ).normalize();
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
    const handQ = gunQuat.clone().multiply(_q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
    hand.quaternion.copy(qF.clone().invert().multiply(handQ));
  }

  die(dir) {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.fallDir = dir >= 0 ? 1 : -1;
    this.fallSide = (Math.random() - 0.5) * 0.6;
    this.limp = Math.random();
  }

  updateDeath(dt) {
    const b = this.b;
    this.group.updateMatrixWorld(true);
    this.deathT = Math.min(1, this.deathT + dt * 1.25);
    const t = this.deathT;
    const k = t * t * (3 - 2 * t);
    const fall = Math.min(1, t * t * 1.6);
    // Knees give way first, then the body tips over.
    b.hips.position.y = REST[B.hips].y - 0.25 * Math.min(1, t * 3) - 0.62 * fall;
    b.hips.rotation.set(-this.fallDir * 1.45 * fall, this.fallSide, this.fallSide * fall);
    for (const key of ['L', 'R']) {
      b['thigh' + key].rotation.set(0.9 * Math.min(1, t * 2.5) * (1 - fall * 0.6), 0, (key === 'L' ? 0.15 : -0.15) * k);
      b['shin' + key].rotation.set(-1.5 * Math.min(1, t * 2.5) * (1 - fall * 0.7), 0, 0);
    }
    b.spine.rotation.set(-this.fallDir * 0.2 * k, 0, 0);
    b.chest.rotation.set(0.1 * k, 0, 0);
    b.head.rotation.set(0.4 * k, 0.4 * this.fallSide, 0);
    for (const [key, sx] of [['L', -1], ['R', 1]]) {
      b['arm' + key].quaternion.setFromEuler(new THREE.Euler(-this.fallDir * (0.6 + this.limp) * k, 0, sx * (0.4 + k * 0.9)));
      b['fore' + key].rotation.set(-0.5 * k, 0, 0);
      b['hand' + key].rotation.set(0, 0, 0);
    }
  }

  reset() {
    this.dead = false;
    this.deathT = 0;
    this.hit.set(0, 0);
    this.hitV.set(0, 0);
    this.crouch = 0;
    this.gunPivot.visible = true;
  }

  // Positions of hitboxes in world space (approximate, for bullet tests).
  headPos(out) { return this.b.head.getWorldPosition(out).add(_v.set(0, 0.075, 0)); }
  chestPos(out) { return this.b.chest.getWorldPosition(out).add(_v.set(0, 0.06, 0)); }
}
