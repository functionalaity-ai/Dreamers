// Visual effects: bullet holes, particles, tracers, muzzle flashes, brass and dropped mags.
import * as THREE from 'three';
import { cartridgeGeo } from '../weapons/gunmodels.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

class ParticleSystem {
  constructor(scene, tex, additive, cap = 700) {
    this.cap = cap;
    this.n = 0;
    this.p = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb * t.rgb, t.a * vC.a); if (gl_FragColor.a < 0.004) discard; }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }
  emit(o) { if (this.p.length >= this.cap) this.p.shift(); this.p.push(o); }
  update(dt) {
    const ps = this.p;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.t += dt;
      if (p.t >= p.life) continue;
      p.vy -= (p.g || 0) * dt;
      const drag = Math.exp(-(p.drag || 0) * dt);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor !== undefined && p.y < p.floor) { p.y = p.floor; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      ps[w++] = p;
      const k = p.t / p.life;
      const j = w - 1;
      this.pos[j * 3] = p.x; this.pos[j * 3 + 1] = p.y; this.pos[j * 3 + 2] = p.z;
      this.col[j * 4] = p.r; this.col[j * 4 + 1] = p.gc; this.col[j * 4 + 2] = p.b;
      this.col[j * 4 + 3] = p.a * (p.fadeIn ? Math.min(1, k * 6) : 1) * (1 - Math.pow(k, p.fade || 1.5));
      this.size[j] = p.s0 + (p.s1 - p.s0) * k;
    }
    ps.length = w;
    const g = this.points.geometry;
    g.setDrawRange(0, w);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, physics, mats, audio) {
    this.scene = scene;
    this.ph = physics;
    this.audio = audio;
    const fx = mats.fx;
    // Bullet holes
    this.holeCap = 420;
    const holeMat = new THREE.MeshStandardMaterial({ map: fx.hole, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.holes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), holeMat, this.holeCap);
    this.holes.count = 0;
    this.holes.frustumCulled = false;
    this.holes.receiveShadow = true;
    this.holeI = 0;
    scene.add(this.holes);
    const blood = new THREE.MeshStandardMaterial({ map: fx.blood, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    this.splats = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), blood, 60);
    this.splats.count = 0;
    this.splats.frustumCulled = false;
    this.splatI = 0;
    scene.add(this.splats);

    this.dust = new ParticleSystem(scene, fx.smoke, false, 900);
    this.glow = new ParticleSystem(scene, fx.spark, true, 700);
    this.blood = new ParticleSystem(scene, fx.blood, false, 200);

    // Tracers: short bright streaks
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.012, 1), this.tracerMat, 80);
    this.tracers.count = 0;
    this.tracers.frustumCulled = false;
    this.tracerList = [];
    scene.add(this.tracers);

    // Muzzle flashes and their lights (a fixed pool keeps shader programs stable).
    this.flashMat = new THREE.MeshBasicMaterial({ map: fx.flash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flashes = [];
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffb45a, 0, 9, 2);
      scene.add(l);
      this.lights.push({ l, t: 1 });
    }

    // Brass, shells and dropped magazines
    this.casings = {};
    for (const kind of ['556', '9mm', 'shell']) {
      const c = cartridgeGeo(kind);
      const geo = kind === 'shell' ? mergeTwo(c.brass, c.tip) : c.brass;
      const mat = kind === 'shell' ? new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.55, metalness: 0.1 }) : mats.gun.brass;
      const im = new THREE.InstancedMesh(geo, mat, 160);
      im.count = 0;
      im.castShadow = false;
      im.frustumCulled = false;
      scene.add(im);
      this.casings[kind] = { im, list: [], i: 0 };
    }
    this.props = []; // dropped mags and guns
  }

  // --- impacts -------------------------------------------------------------------------
  hole(point, normal, size = 0.06) {
    _q.setFromUnitVectors(Z, normal);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, Math.random() * Math.PI * 2));
    _v.copy(point).addScaledVector(normal, 0.004);
    _s.setScalar(size * (0.8 + Math.random() * 0.4));
    _m.compose(_v, _q, _s);
    this.holes.setMatrixAt(this.holeI, _m);
    this.holeI = (this.holeI + 1) % this.holeCap;
    this.holes.count = Math.min(this.holeCap, this.holes.count + 1);
    this.holes.instanceMatrix.needsUpdate = true;
  }

  splat(point, normal) {
    _q.setFromUnitVectors(Z, normal);
    _v.copy(point).addScaledVector(normal, 0.005);
    _s.setScalar(0.35 + Math.random() * 0.4);
    _m.compose(_v, _q, _s);
    this.splats.setMatrixAt(this.splatI, _m);
    this.splatI = (this.splatI + 1) % 60;
    this.splats.count = Math.min(60, this.splats.count + 1);
    this.splats.instanceMatrix.needsUpdate = true;
  }

  impact(kind, point, normal, dir) {
    const n = normal;
    const refl = _v.copy(dir).addScaledVector(n, -2 * dir.dot(n)).normalize();
    if (kind === 'spark') {
      for (let i = 0; i < 9; i++) {
        const sp = 3 + Math.random() * 6;
        this.glow.emit({ x: point.x, y: point.y, z: point.z, vx: (refl.x + (Math.random() - 0.5)) * sp, vy: (refl.y + Math.random() * 0.8) * sp, vz: (refl.z + (Math.random() - 0.5)) * sp, g: 9, drag: 1.5, t: 0, life: 0.18 + Math.random() * 0.25, r: 1, gc: 0.78, b: 0.42, a: 1, s0: 0.035, s1: 0.01, fade: 2 });
      }
      this.glow.emit({ x: point.x, y: point.y, z: point.z, vx: 0, vy: 0, vz: 0, t: 0, life: 0.06, r: 1, gc: 0.85, b: 0.6, a: 1, s0: 0.3, s1: 0.1 });
    }
    const dustCol = kind === 'splinter' ? [0.52, 0.4, 0.28] : kind === 'dirt' ? [0.5, 0.44, 0.34] : kind === 'glass' ? [0.8, 0.85, 0.9] : [0.66, 0.62, 0.56];
    const puffs = kind === 'spark' ? 3 : 6;
    for (let i = 0; i < puffs; i++) {
      const sp = 0.5 + Math.random() * 1.6;
      this.dust.emit({ x: point.x, y: point.y, z: point.z, vx: (n.x + (Math.random() - 0.5) * 0.8) * sp, vy: (n.y + Math.random() * 0.5) * sp, vz: (n.z + (Math.random() - 0.5) * 0.8) * sp, g: -0.15, drag: 3, t: 0, life: 0.9 + Math.random() * 0.9, r: dustCol[0], gc: dustCol[1], b: dustCol[2], a: 0.55, s0: 0.08, s1: 0.5 + Math.random() * 0.3, fade: 1.2, fadeIn: true });
    }
    // Chips: small fast debris
    for (let i = 0; i < 5; i++) {
      const sp = 2 + Math.random() * 3.5;
      this.dust.emit({ x: point.x, y: point.y, z: point.z, vx: (n.x + (Math.random() - 0.5) * 1.4) * sp, vy: (n.y + Math.random()) * sp, vz: (n.z + (Math.random() - 0.5) * 1.4) * sp, g: 9.8, drag: 0.5, t: 0, life: 0.6, r: dustCol[0] * 0.6, gc: dustCol[1] * 0.6, b: dustCol[2] * 0.6, a: 1, s0: 0.022, s1: 0.016, floor: 0.01, fade: 4 });
    }
  }

  bloodHit(point, dir) {
    for (let i = 0; i < 7; i++) {
      const sp = 0.8 + Math.random() * 2;
      this.blood.emit({ x: point.x, y: point.y, z: point.z, vx: (dir.x + (Math.random() - 0.5)) * sp, vy: (dir.y + Math.random() * 0.4) * sp, vz: (dir.z + (Math.random() - 0.5)) * sp, g: 6, drag: 2.5, t: 0, life: 0.45, r: 0.5, gc: 0.05, b: 0.04, a: 0.75, s0: 0.06, s1: 0.22 });
    }
  }

  // --- weapons -----------------------------------------------------------------------------
  tracer(from, to) {
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    this.tracerList.push({ a: from.clone(), b: to.clone(), t: 0, life: 0.05 });
  }

  muzzleFlash(pos, dir, scale = 1, suppressed = false) {
    const s = scale * (suppressed ? 0.25 : 1);
    if (!suppressed || Math.random() < 0.3) {
      for (let i = 0; i < 2; i++) {
        const m = new THREE.Mesh(this.flashGeo || (this.flashGeo = new THREE.PlaneGeometry(1, 1)), this.flashMat);
        m.position.copy(pos);
        m.quaternion.setFromUnitVectors(Z, dir);
        m.rotateZ(Math.random() * Math.PI);
        if (i === 1) { m.rotateX(Math.PI / 2); m.scale.set(0.18 * s, 0.45 * s, 1); m.position.addScaledVector(dir, 0.12 * s); } else m.scale.setScalar(0.28 * s);
        this.scene.add(m);
        this.flashes.push({ m, t: 0, life: 0.035 });
      }
    }
    const L = this.lights.reduce((a, b) => (a.t > b.t ? a : b));
    L.l.position.copy(pos).addScaledVector(dir, 0.2);
    L.t = 0;
    L.peak = suppressed ? 2.5 : 22 * scale;
    // Gas puff
    for (let i = 0; i < (suppressed ? 1 : 3); i++) {
      this.dust.emit({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * (2 + i) + (Math.random() - 0.5) * 0.4, vy: dir.y * (2 + i) + 0.2, vz: dir.z * (2 + i) + (Math.random() - 0.5) * 0.4, g: -0.3, drag: 5, t: 0, life: 0.7, r: 0.8, gc: 0.78, b: 0.74, a: 0.25, s0: 0.05, s1: 0.4, fadeIn: true });
    }
  }

  // Spent casing with simple rigid-body motion; persists on the ground.
  eject(kind, pos, vel) {
    const c = this.casings[kind];
    const o = { p: pos.clone(), v: vel.clone(), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3)), w: new THREE.Vector3((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40), rest: false, bounces: 0, kind };
    if (c.list.length >= 160) c.list.shift();
    c.list.push(o);
  }

  dropProp(mesh, pos, quat, vel, spin = 6, life = 60, restH = 0.012) {
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    this.scene.add(mesh);
    const o = { mesh, v: vel.clone(), w: new THREE.Vector3((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin), rest: false, t: 0, life, restH };
    this.props.push(o);
    if (this.props.length > 14) { const old = this.props.shift(); this.scene.remove(old.mesh); }
    return o;
  }

  explosion(pos) {
    const L = this.lights.reduce((a, b) => (a.t > b.t ? a : b));
    L.l.position.copy(pos).add(_v.set(0, 0.5, 0));
    L.t = 0;
    L.peak = 260;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      const sp = 3 + Math.random() * 9;
      this.glow.emit({ x: pos.x, y: pos.y + 0.2, z: pos.z, vx: Math.cos(a) * sp * (1 - u * 0.5), vy: sp * u, vz: Math.sin(a) * sp * (1 - u * 0.5), g: 9, drag: 2, t: 0, life: 0.3 + Math.random() * 0.5, r: 1, gc: 0.7, b: 0.3, a: 1, s0: 0.08, s1: 0.02 });
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 4;
      this.dust.emit({ x: pos.x, y: pos.y + 0.3, z: pos.z, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 3, vz: Math.sin(a) * sp, g: -0.2, drag: 1.6, t: 0, life: 2.5 + Math.random() * 2, r: 0.32, gc: 0.29, b: 0.26, a: 0.7, s0: 0.6, s1: 3.5, fadeIn: true });
    }
    this.glow.emit({ x: pos.x, y: pos.y + 0.4, z: pos.z, vx: 0, vy: 0, vz: 0, t: 0, life: 0.14, r: 1, gc: 0.75, b: 0.4, a: 1, s0: 4, s1: 6 });
  }

  update(dt, camera) {
    this.dust.update(dt); this.glow.update(dt); this.blood.update(dt);
    const sc = camera ? 0.5 * window.innerHeight / Math.tan((camera.fov * Math.PI / 180) / 2) * (window.devicePixelRatio || 1) / 600 : 1;
    for (const ps of [this.dust, this.glow, this.blood]) ps.points.material.uniforms.scale.value = 600 * sc;
    // Flashes
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      if (f.t >= f.life) { this.scene.remove(f.m); this.flashes.splice(i, 1); }
    }
    for (const L of this.lights) {
      L.t += dt;
      L.l.intensity = L.t < 0.06 ? (L.peak || 0) * (1 - L.t / 0.06) : 0;
    }
    // Tracers
    let n = 0;
    for (let i = this.tracerList.length - 1; i >= 0; i--) {
      const t = this.tracerList[i];
      t.t += dt;
      if (t.t > t.life) { this.tracerList.splice(i, 1); continue; }
      const k0 = Math.max(0, t.t / t.life - 0.35), k1 = Math.min(1, t.t / t.life + 0.35);
      const a = _v.lerpVectors(t.a, t.b, k0), b = new THREE.Vector3().lerpVectors(t.a, t.b, k1);
      const len = a.distanceTo(b);
      if (len < 0.01 || n >= 80) continue;
      _q.setFromUnitVectors(Z, b.clone().sub(a).normalize());
      _m.compose(a.clone().add(b).multiplyScalar(0.5), _q, _s.set(1, 1, len));
      this.tracers.setMatrixAt(n++, _m);
    }
    this.tracers.count = n;
    this.tracers.instanceMatrix.needsUpdate = true;
    // Casings
    for (const kind in this.casings) {
      const c = this.casings[kind];
      let i = 0;
      for (const o of c.list) {
        if (!o.rest) this.stepBody(o, dt, kind === 'shell' ? 0.011 : 0.005, true, Math.random() * Math.PI * 2);
        _m.compose(o.p, o.q, _s.set(1, 1, 1));
        c.im.setMatrixAt(i++, _m);
      }
      c.im.count = i;
      c.im.instanceMatrix.needsUpdate = true;
    }
    for (const o of this.props) {
      if (o.rest) continue;
      const fake = { p: o.mesh.position, v: o.v, q: o.mesh.quaternion, w: o.w, rest: false, bounces: o.bounces || 0 };
      this.stepBody(fake, dt, o.restH || 0.012, false, Math.PI / 2);
      o.rest = fake.rest;
      o.bounces = fake.bounces;
    }
  }

  // settleZ: roll applied when the body comes to rest (casings roll freely, mags lie on their side).
  stepBody(o, dt, rest, tink, settleZ) {
    o.v.y -= 9.81 * dt;
    o.p.addScaledVector(o.v, dt);
    const ang = o.w.length();
    if (ang > 1e-3) { _q.setFromAxisAngle(_v.copy(o.w).multiplyScalar(1 / ang), ang * dt); o.q.premultiply(_q); }
    const floor = this.ph.groundHeight(o.p.x, o.p.z, 0.01, o.p.y + 0.05) + rest;
    if (o.p.y < floor) {
      o.p.y = floor;
      if (Math.abs(o.v.y) > 0.6 && o.bounces < 3) {
        o.v.y = -o.v.y * 0.32;
        o.v.x *= 0.55; o.v.z *= 0.55;
        o.w.multiplyScalar(0.5);
        o.bounces++;
        if (tink && this.audio) this.audio.tink(o.p, o.kind);
      } else {
        // Settle lying flat, keeping the heading it landed with.
        o.v.set(0, 0, 0);
        o.w.set(0, 0, 0);
        const e = new THREE.Euler().setFromQuaternion(o.q, 'YXZ');
        o.q.setFromEuler(new THREE.Euler(0, e.y, settleZ, 'YXZ'));
        o.rest = true;
      }
    }
  }
}

function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  const A = a.index ? a.toNonIndexed() : a, Bg = b.index ? b.toNonIndexed() : b;
  const pa = A.attributes.position.array, pb = Bg.attributes.position.array;
  const na = A.attributes.normal.array, nb = Bg.attributes.normal.array;
  const pos = new Float32Array(pa.length + pb.length); pos.set(pa); pos.set(pb, pa.length);
  const nrm = new Float32Array(na.length + nb.length); nrm.set(na); nrm.set(nb, na.length);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}
