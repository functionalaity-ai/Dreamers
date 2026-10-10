// Visual effects: bullet holes, impact dust, debris and sparks, tracers, muzzle flashes and barrel
// smoke, brass and dropped mags, grenade blasts and scorches. Every system draws from a capped pool,
// and the Mobile preset gets smaller pools and lighter bursts.
import * as THREE from 'three';
import { cartridgeGeo } from '../weapons/gunmodels.js';
import { smokeSheet, flashSheet, scorchTexture, FLASH_CELLS } from '../core/textures.js';
import { SHARED } from '../core/shaderlib.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _r = new THREE.Vector3(), _c = new THREE.Color();
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + (b - a) * Math.random();
const TAU = Math.PI * 2;

// Grey intensity to flame colour: deep red, orange, yellow, then white-hot.
export const HEAT = /* glsl */`
vec3 heat(float t) {
  vec3 c = mix(vec3(0.85, 0.16, 0.03), vec3(1.0, 0.48, 0.1), smoothstep(0.0, 0.35, t));
  c = mix(c, vec3(1.0, 0.8, 0.42), smoothstep(0.3, 0.7, t));
  return mix(c, vec3(1.0, 0.97, 0.9), smoothstep(0.72, 1.0, t));
}`;

// Plain additive or alpha sprites (glows, blood), sized in metres.
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

// Puffs from a sheet of variants, each turning slowly as it grows. LIT smoke is shaded by the sun
// (through its shadow map), the sky and an optional fire glow; FIRE runs intensity through HEAT.
const SPRITE_VERT = /* glsl */`
#include <packing>
attribute float size;
attribute vec4 color;
attribute vec3 extra;
uniform float scale, hasShadow;
uniform vec3 sunDir, sunCol, amb;
uniform sampler2D tShadow;
uniform mat4 shadowMatrix;
varying vec4 vC;
varying vec3 vX;
varying vec3 vL;
varying vec2 vSun;
void main() {
  vC = color; vX = extra;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  #ifdef LIT
    float vis = 1.0;
    if (hasShadow > 0.5) {
      vec4 sc = shadowMatrix * vec4(position, 1.0);
      vec3 s = sc.xyz / sc.w;
      if (s.x > 0.0 && s.y > 0.0 && s.x < 1.0 && s.y < 1.0 && s.z < 1.0) vis = step(s.z - 0.003, unpackRGBAToDepth(texture2D(tShadow, s.xy)));
    }
    vec3 sv = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);
    vSun = sv.xy;
    float into = max(0.0, -sv.z);
    vL = amb + sunCol * vis * (0.55 + 1.1 * into * into);
  #else
    vL = vec3(1.0); vSun = vec2(0.0);
  #endif
  vC.a *= smoothstep(0.12, 0.8, -mv.z);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const SPRITE_FRAG = /* glsl */`
uniform sampler2D map;
uniform vec4 cell;
varying vec4 vC;
varying vec3 vX;
varying vec3 vL;
varying vec2 vSun;
${HEAT}
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  pc.y = -pc.y;
  float c = cos(vX.x), s = sin(vX.x);
  vec2 q = clamp(vec2(c * pc.x - s * pc.y, s * pc.x + c * pc.y) + 0.5, 0.004, 0.996);
  float f = floor(vX.y + 0.5);
  vec4 t = texture2D(map, cell.xy + (vec2(mod(f, cell.w), floor(f / cell.w)) + q) * cell.z);
  #ifdef FIRE
    float I = t.r * vX.z;
    gl_FragColor = vec4(heat(clamp(I, 0.0, 1.0)) * I * vC.rgb, t.a * vC.a);
  #else
    float side = clamp(0.5 + 1.2 * dot(pc, vSun), 0.0, 1.0);
    vec3 col = vC.rgb * vL * t.r * mix(0.72, 1.18, side) + vec3(1.0, 0.42, 0.1) * vX.z * (1.0 - t.a * 0.4);
    gl_FragColor = vec4(col, t.a * vC.a);
  #endif
  if (gl_FragColor.a < 0.003) discard;
}`;

class Sprites {
  constructor(scene, map, { cap, cell, lit, fire }) {
    this.cap = cap;
    this.p = [];
    this.lit = !!lit;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.extra = new Float32Array(cap * 3);
    for (const [k, a, n] of [['position', this.pos, 3], ['color', this.col, 4], ['size', this.size, 1], ['extra', this.extra, 3]]) {
      g.setAttribute(k, new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage));
    }
    this.mat = new THREE.ShaderMaterial({
      defines: fire ? { FIRE: '' } : lit ? { LIT: '' } : {},
      uniforms: {
        map: { value: map }, cell: { value: new THREE.Vector4(...cell) }, scale: { value: 600 },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, amb: { value: new THREE.Color() },
        tShadow: { value: null }, shadowMatrix: { value: new THREE.Matrix4() }, hasShadow: { value: 0 },
      },
      vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG,
      transparent: true, depthWrite: false, blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = fire ? 3 : 2;
    scene.add(this.points);
  }
  emit(o) {
    if (this.p.length >= this.cap) this.p.shift();
    if (o.rot === undefined) o.rot = Math.random() * TAU;
    if (o.frame === undefined) o.frame = Math.floor(Math.random() * 4);
    this.p.push(o);
    return o;
  }
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
      if (p.floor !== undefined && p.y < p.floor) { p.y = p.floor; p.vy = Math.abs(p.vy) * 0.2; }
      p.rot += (p.spin || 0) * dt;
      const k = p.t / p.life;
      const j = w++;
      ps[j] = p;
      this.pos[j * 3] = p.x; this.pos[j * 3 + 1] = p.y; this.pos[j * 3 + 2] = p.z;
      this.col[j * 4] = p.r; this.col[j * 4 + 1] = p.gc; this.col[j * 4 + 2] = p.b;
      this.col[j * 4 + 3] = p.a * (p.fadeIn ? Math.min(1, k * (p.fadeIn > 1 ? p.fadeIn : 6)) : 1) * (1 - Math.pow(k, p.fade || 1.5));
      // smoke billows out fast, then hangs
      this.size[j] = p.s0 + (p.s1 - p.s0) * (1 - Math.pow(1 - k, p.ease || 2));
      this.extra[j * 3] = p.rot; this.extra[j * 3 + 1] = p.frame;
      this.extra[j * 3 + 2] = p.heat !== undefined ? p.heat * Math.pow(1 - k, p.cool || 1.4) : (p.glow || 0) * Math.exp(-p.t * (p.glowFade || 5));
    }
    ps.length = w;
    const g = this.points.geometry;
    g.setDrawRange(0, w);
    for (const k of ['position', 'color', 'size', 'extra']) g.attributes[k].needsUpdate = true;
  }
  light(sun, scale) {
    const u = this.mat.uniforms;
    u.scale.value = scale;
    if (!this.lit || !sun) return;
    const sh = sun.shadow;
    u.hasShadow.value = sh.map ? 1 : 0;
    u.tShadow.value = sh.map ? sh.map.texture : null;
    u.shadowMatrix.value.copy(sh.matrix);
    u.sunDir.value.copy(sun.position).sub(sun.target.position).normalize();
    u.sunCol.value.copy(sun.color).multiplyScalar(sun.intensity * 0.3);
    u.amb.value.copy(SHARED.ambW.value).multiplyScalar(0.42);
  }
}

// Sparks, embers and glints: quads stretched along their velocity, never thinner than a pixel.
class Streaks {
  constructor(scene, cap) {
    this.cap = cap;
    this.p = [];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new Float32Array(cap * 3); this.iVel = new Float32Array(cap * 3);
    this.iCol = new Float32Array(cap * 4); this.iSize = new Float32Array(cap * 2);
    for (const [k, a, n] of [['iPos', this.iPos, 3], ['iVel', this.iVel, 3], ['iCol', this.iCol, 4], ['iSize', this.iSize, 2]]) {
      g.setAttribute(k, new THREE.InstancedBufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage));
    }
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */`
        attribute vec3 iPos, iVel;
        attribute vec4 iCol;
        attribute vec2 iSize;
        varying vec4 vC;
        varying vec2 vQ;
        void main() {
          vec3 head = (modelViewMatrix * vec4(iPos, 1.0)).xyz;
          vec3 tail = (modelViewMatrix * vec4(iPos - iVel * iSize.y, 1.0)).xyz;
          vec3 ax = head - tail;
          if (dot(ax, ax) < 1e-10) ax = vec3(0.0, 1e-5, 0.0);
          float w = max(iSize.x, -head.z * 0.0016);
          vec3 side = normalize(cross(ax, head)) * w;
          vec3 p = mix(tail, head, position.x) + side * position.y + normalize(ax) * w * (position.x * 2.0 - 1.0);
          vC = iCol;
          vC.a *= iSize.x / w;
          vQ = position.xy;
          gl_Position = projectionMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec4 vC;
        varying vec2 vQ;
        void main() { gl_FragColor = vec4(vC.rgb, (1.0 - vQ.y * vQ.y) * mix(0.15, 1.0, vQ.x) * vC.a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  // o: { x, y, z, vx, vy, vz, g, drag, life, w (width m), len (s), hot: [r,g,b], cold: [r,g,b], floor }
  emit(o) { if (this.p.length >= this.cap) this.p.shift(); o.t = 0; this.p.push(o); }
  update(dt) {
    let w = 0;
    for (const p of this.p) {
      p.t += dt;
      if (p.t >= p.life) continue;
      p.vy -= (p.g || 0) * dt;
      const drag = Math.exp(-(p.drag || 0) * dt);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor !== undefined && p.y < p.floor) { p.y = p.floor; p.vy = -p.vy * 0.35; p.vx *= 0.6; p.vz *= 0.6; }
      const k = p.t / p.life, f = (1 - k) * (1 - k);
      const j = w;
      this.p[w++] = p;
      this.iPos[j * 3] = p.x; this.iPos[j * 3 + 1] = p.y; this.iPos[j * 3 + 2] = p.z;
      this.iVel[j * 3] = p.vx; this.iVel[j * 3 + 1] = p.vy; this.iVel[j * 3 + 2] = p.vz;
      for (let c = 0; c < 3; c++) this.iCol[j * 4 + c] = p.hot[c] + (p.cold[c] - p.hot[c]) * k;
      this.iCol[j * 4 + 3] = f;
      this.iSize[j * 2] = p.w; this.iSize[j * 2 + 1] = p.len;
    }
    this.p.length = w;
    const g = this.mesh.geometry;
    g.instanceCount = w;
    this.mesh.visible = w > 0;
    for (const k of ['iPos', 'iVel', 'iCol', 'iSize']) g.attributes[k].needsUpdate = true;
  }
}

// Chips of stone, brick, wood and glass: tumbling bits that bounce, settle and then sink away.
function chunkGeo(seed, flat) {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.75 + 0.5 * (Math.sin(x * 12.9 + y * 78.2 + z * 37.7 + seed) * 0.5 + 0.5);
    p.setXYZ(i, x * k, y * k * (flat ? 0.18 : 0.8), z * k);
  }
  g.computeVertexNormals();
  return g;
}

class Debris {
  constructor(scene, ph, cap) {
    this.ph = ph;
    this.p = [];
    this.cap = cap;
    const make = (geo, mat, n) => {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.count = 0;
      im.frustumCulled = false;
      im.receiveShadow = true;
      im.visible = false;
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(im);
      return im;
    };
    this.glassCap = Math.max(24, cap >> 2);
    this.rough = make(chunkGeo(1, false), new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, name: 'fx_debris' }), cap);
    this.glass = make(chunkGeo(2, true), new THREE.MeshStandardMaterial({ roughness: 0.06, metalness: 0.2, envMapIntensity: 1.4, name: 'fx_shards' }), this.glassCap);
  }
  // o: { p, v, size: [x, y, z], col: [r, g, b], glass, life }
  spawn(o) {
    // a full pool gives up its oldest chip of the same kind
    let count = 0, oldest = -1;
    for (let i = 0; i < this.p.length; i++) if (!!this.p[i].glass === !!o.glass) { if (oldest < 0) oldest = i; count++; }
    if (count >= (o.glass ? this.glassCap : this.cap)) this.p.splice(oldest, 1);
    o.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, TAU), rand(0, TAU), rand(0, TAU)));
    o.w = new THREE.Vector3(rand(-20, 20), rand(-20, 20), rand(-20, 20));
    o.t = 0;
    o.rest = false;
    o.bounces = 0;
    o.floor = this.ph.groundHeight(o.p.x, o.p.z, 0.02, o.p.y + 0.05);
    o.fx = o.p.x; o.fz = o.p.z;
    this.p.push(o);
  }
  update(dt) {
    const n = { rough: 0, glass: 0 };
    let w = 0;
    for (const d of this.p) {
      d.t += dt;
      if (d.t > d.life) continue;
      this.p[w++] = d;
      if (!d.rest) {
        d.v.y -= 9.81 * dt;
        d.p.addScaledVector(d.v, dt);
        const ang = d.w.length();
        if (ang > 1e-3) { _q.setFromAxisAngle(_v.copy(d.w).multiplyScalar(1 / ang), ang * dt); d.q.premultiply(_q); }
        // ground under the chip, re-read only once it has travelled a little
        if (Math.abs(d.p.x - d.fx) + Math.abs(d.p.z - d.fz) > 0.4) { d.floor = this.ph.groundHeight(d.p.x, d.p.z, 0.02, d.p.y + 0.05); d.fx = d.p.x; d.fz = d.p.z; }
        const rest = d.floor + d.size[1] * 0.35;
        if (d.p.y < rest) {
          d.p.y = rest;
          if (Math.abs(d.v.y) > 0.7 && d.bounces < 3) {
            d.v.y = -d.v.y * (d.glass ? 0.2 : 0.38);
            d.v.x *= 0.55; d.v.z *= 0.55;
            d.w.multiplyScalar(0.5);
            d.bounces++;
          } else { d.v.set(0, 0, 0); d.w.set(0, 0, 0); d.rest = true; }
        }
      }
      const im = d.glass ? this.glass : this.rough;
      const i = d.glass ? n.glass++ : n.rough++;
      const sink = Math.min(1, (d.life - d.t) / 0.6);
      _s.set(d.size[0] * sink, d.size[1] * sink, d.size[2] * sink);
      _m.compose(d.p, d.q, _s);
      im.setMatrixAt(i, _m);
      im.setColorAt(i, _c.setRGB(d.col[0], d.col[1], d.col[2]));
    }
    this.p.length = w;
    for (const k of ['rough', 'glass']) {
      const im = this[k];
      im.count = n[k];
      im.visible = n[k] > 0;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

// Third-person muzzle flashes: billboards and barrel-axis petals from the flash sheet, instanced.
class Flashes {
  constructor(scene, map, cap) {
    this.cap = cap;
    this.p = [];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.a = { iPos: new Float32Array(cap * 3), iAxis: new Float32Array(cap * 3), iSize: new Float32Array(cap * 2), iRect: new Float32Array(cap * 4), iMisc: new Float32Array(cap * 4) };
    for (const k in this.a) g.setAttribute(k, new THREE.InstancedBufferAttribute(this.a[k], this.a[k].length / cap).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map } },
      vertexShader: /* glsl */`
        attribute vec3 iPos, iAxis;
        attribute vec2 iSize;
        attribute vec4 iRect, iMisc;
        varying vec2 vUv;
        varying vec2 vI;
        void main() {
          vec3 c = (modelViewMatrix * vec4(iPos, 1.0)).xyz;
          vec2 q = position.xy;
          vec3 p;
          if (iMisc.y < 0.5) {
            float cr = cos(iMisc.x), sr = sin(iMisc.x);
            p = c + vec3(vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y) * iSize, 0.0);
          } else {
            vec3 ax = normalize(mat3(modelViewMatrix) * iAxis);
            vec3 side = cross(ax, normalize(c));
            float sl = length(side);
            side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
            p = c + ax * (q.x + 0.5) * iSize.x + side * q.y * iSize.y;
          }
          vUv = iRect.xy + (q + 0.5) * iRect.zw;
          vI = iMisc.zw;
          gl_Position = projectionMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map;
        varying vec2 vUv;
        varying vec2 vI;
        ${HEAT}
        void main() {
          vec4 t = texture2D(map, vUv);
          float I = t.r * vI.y;
          gl_FragColor = vec4(heat(clamp(I, 0.0, 1.0)) * I * vI.x, t.a * vI.y);
          if (gl_FragColor.a < 0.004) discard;
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  add(pos, axis, w, h, rect, rot, axial, bright, life) {
    if (this.p.length >= this.cap) this.p.shift();
    this.p.push({ x: pos.x, y: pos.y, z: pos.z, ax: axis.x, ay: axis.y, az: axis.z, w, h, rect, rot, axial, bright, life, t: 0 });
  }
  update(dt) {
    let n = 0;
    const A = this.a;
    for (const f of this.p) {
      // a flash gets its first frame at full strength, however long that frame takes
      if (f.seen) f.t += dt;
      if (f.seen && f.t > f.life) continue;
      f.seen = true;
      this.p[n] = f;
      A.iPos.set([f.x, f.y, f.z], n * 3); A.iAxis.set([f.ax, f.ay, f.az], n * 3);
      A.iSize.set([f.w, f.h], n * 2); A.iRect.set(f.rect, n * 4);
      A.iMisc.set([f.rot, f.axial ? 1 : 0, f.bright, Math.max(0.15, 1 - f.t / f.life)], n * 4);
      n++;
    }
    this.p.length = n;
    const g = this.mesh.geometry;
    g.instanceCount = n;
    this.mesh.visible = n > 0;
    for (const k in A) g.attributes[k].needsUpdate = true;
  }
}

// Sheet cell i of a FLASH_CELLS entry, as a uv rectangle [u0, v0, du, dv].
function cellRect(name, i = 0) {
  const [u0, v0, du, dv, cols] = FLASH_CELLS[name];
  if (cols) return [u0 + (i % cols) * du, v0 + Math.floor(i / cols) * dv, du, dv];
  return [u0, v0 + i * dv, du, dv];
}

// Dust colours by surface: a coarse map of the town's wall and ground materials, built once from
// the merged world meshes, so a shot into ochre stucco throws ochre dust and brick throws red.
// Powder is paler than the solid it came from; the chips keep the solid's own tone.
const DUST = {
  plasterCream: [0.78, 0.72, 0.6], plasterOchre: [0.78, 0.64, 0.46], plasterSage: [0.66, 0.7, 0.6], plasterWhite: [0.82, 0.8, 0.76],
  plasterRose: [0.8, 0.66, 0.58], trim: [0.84, 0.82, 0.76], limestone: [0.8, 0.76, 0.67], brick: [0.66, 0.42, 0.32], brickPale: [0.74, 0.58, 0.46],
  concrete: [0.7, 0.69, 0.66, 1], sidewalk: [0.72, 0.71, 0.67, 1], panel: [0.72, 0.7, 0.66, 1], panelPlinth: [0.62, 0.6, 0.56, 1],
  asphalt: [0.42, 0.41, 0.39, 1], cobble: [0.6, 0.58, 0.54, 1], granite: [0.66, 0.66, 0.66, 1], roofTiles: [0.72, 0.48, 0.36], roof: [0.72, 0.48, 0.36],
  woodFloor: [0.62, 0.5, 0.36], woodDark: [0.52, 0.42, 0.3], sandbag: [0.66, 0.58, 0.45],
};
const KIND_DUST = { dust: [0.72, 0.7, 0.66], splinter: [0.62, 0.5, 0.36], dirt: [0.6, 0.52, 0.4], glass: [0.86, 0.88, 0.9], spark: [0.55, 0.55, 0.55] };

class SurfaceTint {
  constructor(scene, ph) {
    this.cs = 0.5;
    this.x0 = ph.minX; this.z0 = ph.minZ;
    this.nx = Math.ceil((ph.maxX - ph.minX) / this.cs); this.nz = Math.ceil((ph.maxZ - ph.minZ) / this.cs);
    const n = this.nx * this.nz;
    this.names = [null];
    this.wall = new Uint8Array(n); this.wallA = new Float32Array(n);
    this.low = new Uint8Array(n); this.lowA = new Float32Array(n);
    this.ground = new Uint8Array(n); this.groundY = new Float32Array(n).fill(-9);
    const world = scene.getObjectByName('world');
    if (world) {
      world.traverse((o) => {
        if (!o.isMesh || !DUST[o.material.name]) return;
        let id = this.names.indexOf(o.material.name);
        if (id < 0) { id = this.names.length; this.names.push(o.material.name); }
        this.add(o.geometry.attributes.position.array, id);
      });
    }
  }
  cell(x, z) {
    const i = Math.floor((x - this.x0) / this.cs), j = Math.floor((z - this.z0) / this.cs);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }
  add(p, id) {
    const cs = this.cs;
    for (let t = 0; t + 8 < p.length; t += 9) {
      const ax = p[t], ay = p[t + 1], az = p[t + 2], bx = p[t + 3], by = p[t + 4], bz = p[t + 5], cx = p[t + 6], cy = p[t + 7], cz = p[t + 8];
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 0.02) continue;
      const area = len / 2, upn = ny / len;
      if (upn > 0.7) {
        // ground-level tops: the highest one under each cell wins
        const y = (ay + by + cy) / 3;
        if (y > 0.6) continue;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - this.x0) / cs)), i1 = Math.min(this.nx - 1, Math.floor((Math.max(ax, bx, cx) - this.x0) / cs));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - this.z0) / cs)), j1 = Math.min(this.nz - 1, Math.floor((Math.max(az, bz, cz) - this.z0) / cs));
        const d = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
        if (Math.abs(d) < 1e-9) continue;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const px = this.x0 + (i + 0.5) * cs, pz = this.z0 + (j + 0.5) * cs;
            const w1 = ((bx - px) * (cz - pz) - (cx - px) * (bz - pz)) / d, w2 = ((cx - px) * (az - pz) - (ax - px) * (cz - pz)) / d;
            if (w1 < -0.02 || w2 < -0.02 || w1 + w2 > 1.02) continue;
            const c = j * this.nx + i;
            if (y >= this.groundY[c] - 1e-3) { this.groundY[c] = y; this.ground[c] = id; }
          }
        }
      } else if (Math.abs(upn) < 0.35) {
        // walls: mark the cells along the triangle's edges, the largest face per cell winning
        const low = Math.max(ay, by, cy) < 0.7;
        const grid = low ? this.low : this.wall, areas = low ? this.lowA : this.wallA;
        const edge = (x0, z0, x1, z1) => {
          const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (cs * 0.5)));
          for (let k = 0; k <= steps; k++) {
            const c = this.cell(x0 + (x1 - x0) * k / steps, z0 + (z1 - z0) * k / steps);
            if (c >= 0 && area >= areas[c]) { areas[c] = area; grid[c] = id; }
          }
        };
        edge(ax, az, bx, bz); edge(bx, bz, cx, cz); edge(cx, cz, ax, az);
      }
    }
  }
  // Linear albedo of the dust a hit throws up, plus 1 in [3] for hard stone that can spark.
  at(point, n, kind) {
    if (kind !== 'dust') return KIND_DUST[kind] || KIND_DUST.dust;
    let id = 0;
    if (n.y > 0.7) {
      const c = this.cell(point.x, point.z);
      if (c >= 0 && Math.abs(this.groundY[c] - point.y) < 0.25) id = this.ground[c];
    } else if (Math.abs(n.y) < 0.5) {
      for (const d of [0.05, -0.15, 0.3]) {
        const c = this.cell(point.x - n.x * d, point.z - n.z * d);
        if (c < 0) continue;
        id = (point.y < 0.65 && this.low[c]) || this.wall[c];
        if (id) break;
      }
    }
    return id ? DUST[this.names[id]] : KIND_DUST.dust;
  }
}

export class Effects {
  constructor(scene, physics, mats, audio) {
    this.scene = scene;
    this.ph = physics;
    this.audio = audio;
    const fx = mats.fx;
    // Phones get smaller pools and lighter bursts.
    this.lite = !!(mats.preset && mats.preset.name === 'Mobile');
    this.k = this.lite ? 0.5 : 1;
    const B = mats.baker;
    this.smokeTex = smokeSheet(B);
    this.flashTex = flashSheet(B);
    this.scorchTex = scorchTexture(B);
    this.sun = scene.children.find((o) => o.isDirectionalLight && o.castShadow) || null;
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
    // Scorch marks from grenades
    const scorch = new THREE.MeshStandardMaterial({ map: this.scorchTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    this.scorches = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), scorch, 12);
    this.scorches.count = 0;
    this.scorches.frustumCulled = false;
    this.scorches.receiveShadow = true;
    this.scorches.renderOrder = 1;
    this.scorchI = 0;
    this.lastScorch = new THREE.Vector3(1e4, 0, 0);
    scene.add(this.scorches);

    const lite = this.lite;
    this.dust = new Sprites(scene, this.smokeTex, { cap: lite ? 380 : 900, cell: [0, 0, 0.5, 2], lit: true });
    this.fire = new Sprites(scene, this.flashTex, { cap: lite ? 90 : 220, cell: [0.5, 0, 0.25, 2], fire: true });
    this.glow = new ParticleSystem(scene, fx.spark, true, lite ? 300 : 700);
    this.blood = new ParticleSystem(scene, fx.blood, false, 200);
    this.sparks = new Streaks(scene, lite ? 140 : 380);
    this.debris = new Debris(scene, physics, lite ? 80 : 220);
    this.flashes = new Flashes(scene, this.flashTex, 64);
    this.emitters = [];
    this.tint = new SurfaceTint(scene, physics);

    // Tracers: short bright streaks
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.012, 1), this.tracerMat, 80);
    this.tracers.count = 0;
    this.tracers.frustumCulled = false;
    this.tracerList = [];
    scene.add(this.tracers);

    // Muzzle flash lights (a fixed pool keeps shader programs stable).
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

  // A burst count for this device.
  n(full) { return Math.max(1, Math.round(full * this.k)); }

  // --- impacts -------------------------------------------------------------------------
  hole(point, normal, size = 0.06) {
    // a grenade's mark on the ground is a scorch, not a bullet hole
    if (size > 0.8) { if (point.distanceTo(this.lastScorch) > 0.6) this.scorch(point, normal, size * 2.2); return; }
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

  scorch(point, normal, size) {
    _q.setFromUnitVectors(Z, normal);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, Math.random() * TAU));
    _v.copy(point).addScaledVector(normal, 0.006);
    _s.set(size * rand(0.9, 1.1), size * rand(0.9, 1.1), 1);
    _m.compose(_v, _q, _s);
    this.scorches.setMatrixAt(this.scorchI, _m);
    this.scorchI = (this.scorchI + 1) % 12;
    this.scorches.count = Math.min(12, this.scorches.count + 1);
    this.scorches.instanceMatrix.needsUpdate = true;
    this.lastScorch.copy(point);
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

  // A puff of lit smoke or dust (albedo col) leaving `at` with velocity v.
  puff(at, v, col, o) {
    return this.dust.emit(Object.assign({ x: at.x, y: at.y, z: at.z, vx: v.x, vy: v.y, vz: v.z, t: 0, r: col[0], gc: col[1], b: col[2], fadeIn: true, spin: rand(-0.6, 0.6) }, o));
  }

  chips(point, dir, count, col, o = {}) {
    for (let i = 0; i < count; i++) {
      const sp = rand(o.min || 2, o.max || 4.5);
      const s = rand(o.s0 || 0.008, o.s1 || 0.022);
      const size = o.shape === 'splinter' ? [s * 0.35, s * 0.35, s * rand(2.2, 3.4)] : o.shape === 'shard' ? [s * 1.2, s * 0.25, s] : [s, s * rand(0.6, 1), s * rand(0.8, 1.3)];
      const k = rand(0.72, 1.08);
      this.debris.spawn({
        p: point.clone(), v: new THREE.Vector3(dir.x + rand(-0.7, 0.7), dir.y + rand(0.1, 1.0), dir.z + rand(-0.7, 0.7)).multiplyScalar(sp),
        size, col: [col[0] * k, col[1] * k, col[2] * k], glass: o.shape === 'shard', life: rand(o.life0 || 2.5, o.life1 || 4),
      });
    }
  }

  spark(point, dir, o = {}) {
    this.sparks.emit({
      x: point.x, y: point.y, z: point.z, vx: dir.x, vy: dir.y, vz: dir.z, g: o.g ?? 9.8, drag: o.drag ?? 1.2,
      life: o.life || rand(0.2, 0.55), w: o.w || rand(0.004, 0.008), len: o.len || 0.028,
      hot: o.hot || [9, 6, 3], cold: o.cold || [2.4, 0.6, 0.12], floor: o.floor,
    });
  }

  impact(kind, point, normal, dir) {
    const n = normal;
    const refl = _r.copy(dir).addScaledVector(n, -2 * dir.dot(n)).normalize();
    const col = this.tint.at(point, n, kind);
    const at = _a.copy(point).addScaledVector(n, 0.02);
    const floor = this.ph.groundHeight(point.x, point.z, 0.05, point.y + 0.05);
    if (kind === 'spark') {
      // metal: a white-hot spray of streaks that bounce off the ground, a pop of light, a wisp
      for (let i = 0; i < this.n(11); i++) {
        const sp = rand(4, 13);
        this.spark(at, _b.set(refl.x + rand(-0.55, 0.55), refl.y + rand(-0.2, 0.7), refl.z + rand(-0.55, 0.55)).normalize().multiplyScalar(sp), { floor });
      }
      this.glow.emit({ x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, t: 0, life: 0.06, r: 3, gc: 2.4, b: 1.5, a: 1, s0: 0.28, s1: 0.1 });
      this.puff(at, _b.copy(n).multiplyScalar(0.6), [0.42, 0.41, 0.4], { g: -0.15, drag: 3, life: rand(0.8, 1.2), a: 0.3, s0: 0.05, s1: 0.32 });
      this.chips(at, n, this.n(2), [0.08, 0.08, 0.08], { s0: 0.004, s1: 0.008, min: 1.5, max: 3 });
      return;
    }
    if (kind === 'glass') {
      this.chips(at, n, this.n(8), [0.75, 0.82, 0.85], { shape: 'shard', s0: 0.01, s1: 0.024, min: 1, max: 3.5, life0: 4, life1: 7 });
      for (let i = 0; i < this.n(4); i++) this.spark(at, _b.set(n.x + rand(-1, 1), n.y + rand(0, 1), n.z + rand(-1, 1)).normalize().multiplyScalar(rand(1, 3)), { g: 4, life: rand(0.12, 0.25), hot: [2.2, 2.4, 2.6], cold: [0.4, 0.5, 0.6], w: 0.003, len: 0.02 });
      this.puff(at, _b.copy(n).multiplyScalar(0.8), [0.82, 0.84, 0.86], { g: -0.05, drag: 3, life: rand(0.6, 1), a: 0.25, s0: 0.04, s1: 0.3 });
      return;
    }
    const wood = kind === 'splinter', dirt = kind === 'dirt';
    // the jet: dense puffs thrown out along the normal and the ricochet at once, then a slow cloud
    const jets = this.n(dirt ? 5 : 4);
    for (let i = 0; i < jets; i++) {
      const sp = rand(1.2, 3.2);
      this.puff(at, _b.set((n.x + refl.x * 0.35 + rand(-0.4, 0.4)) * sp, (n.y + refl.y * 0.35 + rand(0, 0.45)) * sp, (n.z + refl.z * 0.35 + rand(-0.4, 0.4)) * sp), col,
        { g: -0.1, drag: 3.4, life: rand(1.2, 2.2) * (dirt ? 1.2 : 1), a: dirt ? 0.8 : 0.72, s0: 0.12, s1: rand(0.6, 1.0) * (dirt ? 1.4 : 1), fadeIn: 25, ease: 2.6 });
    }
    this.puff(at, _b.copy(n).multiplyScalar(0.45).add(_v.set(0, 0.15, 0)), col, { g: -0.08, drag: 1.5, life: rand(2.6, 3.6), a: 0.34, s0: 0.35, s1: rand(1.2, 1.6), ease: 1.6, fadeIn: 8 });
    // grit raining back down
    for (let i = 0; i < this.n(5); i++) {
      const sp = rand(1.5, 3.5);
      this.dust.emit({ x: at.x, y: at.y, z: at.z, vx: (n.x + rand(-0.7, 0.7)) * sp, vy: (n.y + rand(0, 0.9)) * sp, vz: (n.z + rand(-0.7, 0.7)) * sp, g: 9.8, drag: 0.6, t: 0, life: rand(0.5, 0.8), r: col[0] * 0.7, gc: col[1] * 0.7, b: col[2] * 0.7, a: 0.9, s0: 0.018, s1: 0.012, floor: floor + 0.01, fade: 4, ease: 1 });
    }
    // chunks with gravity and a bounce
    if (wood) this.chips(at, n, this.n(6), [0.48, 0.36, 0.22], { shape: 'splinter', s0: 0.012, s1: 0.022, min: 2, max: 5 });
    else this.chips(at, n, this.n(5), [col[0] * 0.75, col[1] * 0.75, col[2] * 0.75], { s0: dirt ? 0.012 : 0.008, s1: dirt ? 0.03 : 0.024 });
    // hard stone throws the odd spark
    if (col[3] && Math.random() < 0.3) for (let i = 0; i < 2; i++) this.spark(at, _b.set(refl.x + rand(-0.4, 0.4), refl.y + rand(0, 0.5), refl.z + rand(-0.4, 0.4)).normalize().multiplyScalar(rand(4, 9)), { floor, life: rand(0.1, 0.25) });
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

  // The first-person flash: an additive material over the flash sheet; quads carry a brightness.
  flashMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: this.flashTex }, fade: { value: 1 } },
      vertexShader: 'attribute float bright; varying vec2 vUv; varying float vB; void main() { vUv = uv; vB = bright; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: HEAT + `
        uniform sampler2D map;
        uniform float fade;
        varying vec2 vUv;
        varying float vB;
        void main() { vec4 t = texture2D(map, vUv); float I = t.r * fade; gl_FragColor = vec4(heat(clamp(I, 0.0, 1.0)) * I * vB, t.a * fade); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
  }

  // A quad facing +z onto cell i of the flash sheet. radial: a flame tongue whose root is at the
  // origin and which runs out along +y.
  flashQuad(cell, i, w, h, bright, radial) {
    const g = new THREE.PlaneGeometry(w, h);
    const r = cellRect(cell, i);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, r[0] + uv.getX(k) * r[2], r[1] + uv.getY(k) * r[3]);
    g.setAttribute('bright', new THREE.BufferAttribute(new Float32Array(uv.count).fill(bright), 1));
    if (radial) { g.rotateZ(Math.PI / 2); g.translate(0, w / 2, 0); }
    return g;
  }

  // Third person: a star core, a forward plume and side petals along the bore, a warm glow; the
  // gas puff and a thin wisp that, shot after shot, builds into smoke hanging over the muzzle.
  muzzleFlash(pos, dir, scale = 1, suppressed = false) {
    const s = scale;
    if (!suppressed) {
      const life = rand(0.035, 0.05);
      this.flashes.add(pos, dir, rand(0.3, 0.42) * s, rand(0.3, 0.42) * s, cellRect('star', Math.floor(Math.random() * 4)), rand(0, TAU), false, rand(7, 9.5), life);
      this.flashes.add(_a.copy(pos).addScaledVector(dir, 0.01), dir, rand(0.45, 0.65) * s, rand(0.16, 0.22) * s, cellRect('petal', Math.floor(Math.random() * 4)), 0, true, rand(6, 8), life);
      _b.crossVectors(dir, Math.abs(dir.y) < 0.9 ? UP : Z).normalize();
      _r.crossVectors(dir, _b);
      const petals = this.lite ? 2 : 3, a0 = rand(0, TAU);
      for (let i = 0; i < petals; i++) {
        const a = a0 + i * TAU / petals;
        _v.copy(dir).multiplyScalar(0.8).addScaledVector(_b, Math.cos(a)).addScaledVector(_r, Math.sin(a)).normalize();
        this.flashes.add(_a.copy(pos).addScaledVector(dir, 0.02), _v, rand(0.2, 0.32) * s, rand(0.07, 0.11) * s, cellRect('petal', Math.floor(Math.random() * 4)), 0, true, rand(5, 6.5), life);
      }
      this.flashes.add(pos, dir, rand(1.0, 1.3) * s, rand(1.0, 1.3) * s, cellRect('glow'), 0, false, 1.2, life * 1.6);
    } else if (Math.random() < 0.3) {
      this.flashes.add(_a.copy(pos).addScaledVector(dir, 0.03), dir, 0.08 * s, 0.08 * s, cellRect('star', Math.floor(Math.random() * 4)), rand(0, TAU), false, 2, 0.03);
    }
    const L = this.lights.reduce((a, b) => (a.t > b.t ? a : b));
    L.l.position.copy(pos).addScaledVector(dir, 0.2);
    L.t = 0;
    L.peak = suppressed ? 2.5 : 22 * scale;
    // gas puff
    for (let i = 0; i < (suppressed ? 1 : 2); i++) {
      this.puff(pos, _b.set(dir.x * (2 + i * 1.5) + rand(-0.2, 0.2), dir.y * (2 + i * 1.5) + 0.2, dir.z * (2 + i * 1.5) + rand(-0.2, 0.2)), [0.78, 0.76, 0.73],
        { g: -0.3, drag: 5, life: rand(0.5, 0.8), a: suppressed ? 0.12 : 0.2, s0: 0.05, s1: 0.4 * s });
    }
    this.muzzleWisp(_a.copy(pos).addScaledVector(dir, 0.05), dir, suppressed ? 0.8 : 0.55);
  }

  // A thin curl of barrel smoke that rises and fades (k: 0..1 strength); grey-blue, so it reads
  // against both the sky and the walls.
  muzzleWisp(pos, dir, k = 1) {
    if (this.lite && Math.random() < 0.5) return;
    this.puff(pos, _b.set(dir.x * 0.3 + rand(-0.05, 0.05), 0.22 + dir.y * 0.25 + rand(0, 0.1), dir.z * 0.3 + rand(-0.05, 0.05)), [0.62, 0.64, 0.68],
      { g: -0.22, drag: 1.3, life: rand(1.6, 2.6), a: 0.34 * k, s0: 0.04, s1: rand(0.26, 0.42), ease: 1.8, spin: rand(-1, 1), fade: 1.1, fadeIn: 10 });
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

  // Grenade: a white flash, an additive fireball, a dark column of smoke rising out of it, sparks
  // and debris, a ring of dust rolling out along the ground and a scorch left behind.
  explosion(pos) {
    const gy = this.ph.groundHeight(pos.x, pos.z, 0.1, pos.y + 0.2);
    const base = new THREE.Vector3(pos.x, gy, pos.z);
    const ground = this.tint.at(base, UP, 'dust');
    const L = this.lights.reduce((a, b) => (a.t > b.t ? a : b));
    L.l.position.copy(pos).add(_v.set(0, 0.5, 0));
    L.t = 0;
    L.peak = 260;
    this.glow.emit({ x: pos.x, y: gy + 0.5, z: pos.z, vx: 0, vy: 0, vz: 0, t: 0, life: 0.09, r: 3.5, gc: 2.6, b: 1.8, a: 1, s0: 3.2, s1: 4.6 });
    for (let i = 0; i < this.n(22); i++) {
      const a = rand(0, TAU), u = rand(0.15, 1), sp = rand(2, 7);
      this.fire.emit({
        x: pos.x + rand(-0.3, 0.3), y: gy + rand(0.2, 0.8), z: pos.z + rand(-0.3, 0.3),
        vx: Math.cos(a) * sp * (1 - u * 0.4), vy: sp * u * 0.8 + 1.2, vz: Math.sin(a) * sp * (1 - u * 0.4),
        g: -1.5, drag: 4.5, t: 0, life: rand(0.4, 0.85), r: 4.5, gc: 4, b: 3.5, a: 1, s0: 0.7, s1: rand(2.6, 3.8),
        heat: rand(1.1, 1.4), cool: 1.2, spin: rand(-2, 2), ease: 2.4, fade: 2, fadeIn: 30,
      });
    }
    // the column: an initial billow, then smoke welling up for a second more
    const smoke = (t0) => {
      const a = rand(0, TAU), r = rand(0, 0.7);
      const c = rand(0.07, 0.12);
      this.puff(_a.set(pos.x + Math.cos(a) * r, gy + rand(0.3, 1.1), pos.z + Math.sin(a) * r), _b.set(Math.cos(a) * rand(0.2, 0.9), rand(1.4, 3.4), Math.sin(a) * rand(0.2, 0.9)),
        [c, c * 0.96, c * 0.92], { g: -0.55, drag: 0.85, life: rand(5, 8), a: rand(0.8, 0.92), s0: 1.0, s1: rand(4.2, 6), ease: 1.9, glow: t0 < 0.3 ? 1.8 : 0.4, glowFade: 3, fade: 1.3, fadeIn: 14, spin: rand(-0.3, 0.3) });
    };
    for (let i = 0; i < this.n(14); i++) smoke(0);
    this.emitters.push({ t: 0, until: 1.4, every: this.lite ? 0.18 : 0.08, acc: 0, fn: smoke });
    // dust rolling out along the ground
    const dc = [ground[0] * 1.05 + 0.04, ground[1] * 1.05 + 0.04, ground[2] * 1.05 + 0.03];
    for (let i = 0; i < this.n(20); i++) {
      const a = i / this.n(20) * TAU + rand(-0.15, 0.15), sp = rand(7, 11);
      this.puff(_a.set(pos.x + Math.cos(a) * 0.4, gy + rand(0.12, 0.35), pos.z + Math.sin(a) * 0.4), _b.set(Math.cos(a) * sp, rand(0.2, 0.8), Math.sin(a) * sp), dc,
        { g: -0.05, drag: 3.1, life: rand(2, 3), a: 0.62, s0: 0.6, s1: rand(2.4, 3.4), ease: 2.4, floor: gy + 0.1, fadeIn: 14 });
    }
    // embers and sparks
    for (let i = 0; i < this.n(26); i++) {
      const a = rand(0, TAU), up = rand(0.1, 1), sp = rand(6, 17);
      this.spark(_a.set(pos.x, gy + 0.3, pos.z), _b.set(Math.cos(a) * (1 - up * 0.6), up, Math.sin(a) * (1 - up * 0.6)).normalize().multiplyScalar(sp),
        { g: 9.8, drag: 0.8, life: rand(0.4, 1.1), w: rand(0.006, 0.012), len: 0.035, floor: gy, hot: [10, 5.5, 2], cold: [2.5, 0.5, 0.08] });
    }
    // debris: clods and chips of whatever it went off on
    for (let i = 0; i < this.n(24); i++) {
      const a = rand(0, TAU), sp = rand(3, 9);
      const s = rand(0.015, 0.05), k = rand(0.45, 0.95);
      this.debris.spawn({ p: new THREE.Vector3(pos.x, gy + 0.15, pos.z), v: new THREE.Vector3(Math.cos(a) * sp, rand(3.5, 10), Math.sin(a) * sp), size: [s, s * rand(0.6, 1), s * rand(0.8, 1.4)], col: [ground[0] * k, ground[1] * k, ground[2] * k], life: rand(4, 7) });
    }
    this.scorch(base, UP, rand(3.2, 3.8));
  }

  update(dt, camera) {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.t += dt; e.acc += dt;
      while (e.acc >= e.every && e.t <= e.until) { e.acc -= e.every; e.fn(e.t); }
      if (e.t > e.until) this.emitters.splice(i, 1);
    }
    this.dust.update(dt); this.fire.update(dt); this.glow.update(dt); this.blood.update(dt);
    this.sparks.update(dt); this.debris.update(dt); this.flashes.update(dt);
    const sc = camera ? 0.5 * window.innerHeight / Math.tan((camera.fov * Math.PI / 180) / 2) * (window.devicePixelRatio || 1) / 600 : 1;
    for (const ps of [this.glow, this.blood]) ps.points.material.uniforms.scale.value = 600 * sc;
    this.dust.light(this.sun, 600 * sc);
    this.fire.light(null, 600 * sc);
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
