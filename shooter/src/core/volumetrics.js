// Volumetric light: a raymarched, sun-shadowed height fog that produces god rays wherever
// sunlight slips between buildings, plus dust motes that only show up inside the light shafts.
//
// Pipeline (all at a reduced resolution except the composite):
//   march    → in-scattered light (rgb) and transmittance (a) per pixel, jittered per frame
//   resolve  → blends with the reprojected previous frame, clamped to the local neighbourhood
//   blur     → separable, depth-aware (bilateral) blur
//   composite→ full-res: colour * T + S, upsampled with depth weights so edges stay sharp
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CLOUD_SHADE, SHARED } from './shaderlib.js';

// Tileable 3D value-noise fbm for the fog's density variation.
function noise3D(size = 64) {
  const N = size, data = new Uint8Array(N * N * N);
  const lat = (P, seed) => {
    const v = new Float32Array(P * P * P);
    let s = seed >>> 0;
    for (let i = 0; i < v.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; v[i] = s / 4294967296; }
    return v;
  };
  const octs = [[8, lat(8, 11)], [16, lat(16, 23)], [32, lat(32, 37)]];
  const sm = (t) => t * t * (3 - 2 * t);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let sum = 0, amp = 0.55, norm = 0;
    for (const [P, v] of octs) {
      const fx = x / N * P, fy = y / N * P, fz = z / N * P;
      const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      const tx = sm(fx - ix), ty = sm(fy - iy), tz = sm(fz - iz);
      const at = (a, b, c) => v[((c % P) * P + (b % P)) * P + (a % P)];
      const l = (a, b, t) => a + (b - a) * t;
      const n = l(
        l(l(at(ix, iy, iz), at(ix + 1, iy, iz), tx), l(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx), ty),
        l(l(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx), l(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx), ty), tz);
      sum += n * amp; norm += amp; amp *= 0.5;
    }
    data[(z * N + y) * N + x] = Math.round(255 * Math.min(1, Math.max(0, (sum / norm - 0.5) * 1.6 + 0.5)));
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RedFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Shared helpers for reconstructing positions from the depth buffer.
const DEPTH_PARS = /* glsl */`
#include <packing>
uniform sampler2D tDepth;
uniform mat4 invProj;
uniform float cNear, cFar;
float linDepth(float d) { return -perspectiveDepthToViewZ(d, cNear, cFar); }
vec3 viewPosAt(vec2 uv, float d) { vec4 c = invProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return c.xyz / c.w; }
`;

const MARCH_FRAG = /* glsl */`
precision highp sampler3D;
${DEPTH_PARS}
${CLOUD_SHADE}
uniform sampler2D tShadow;
uniform sampler3D tNoise;
uniform mat4 shadowMatrix, camWorld;
uniform vec3 camPos, sunDir, sunColor, ambColor, wind;
uniform float hasShadow, density, heightFalloff, groundMist, maxDist, time, frame, gForward, sunBoost;
uniform vec3 indoorMin[4];
uniform vec3 indoorMax[4];
uniform int indoorCount;
varying vec2 vUv;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.5663706 * pow(max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5)); }

float sunVis(vec3 p) {
  if (hasShadow < 0.5) return 1.0;
  vec4 sc = shadowMatrix * vec4(p, 1.0);
  vec3 s = sc.xyz / sc.w;
  if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  return step(s.z - 0.0012, unpackRGBAToDepth(texture2D(tShadow, s.xy))) * cloudShade(s.xy);
}

float indoor(vec3 p) {
  for (int i = 0; i < 4; i++) {
    if (i >= indoorCount) break;
    if (all(greaterThan(p, indoorMin[i])) && all(lessThan(p, indoorMax[i]))) return 1.0;
  }
  return 0.0;
}

float densityAt(vec3 p, out float inside) {
  inside = indoor(p);
  float h = exp(-max(p.y, 0.0) * heightFalloff);
  float n = texture(tNoise, p * vec3(0.028, 0.05, 0.028) + wind * time).r;
  float n2 = texture(tNoise, p * vec3(0.09, 0.14, 0.09) - wind * time * 1.6).r;
  float v = 0.45 + 1.1 * n * (0.6 + 0.8 * n2);
  float d = density * h * v + groundMist * exp(-max(p.y, 0.0) * 1.1) * n2;
  return d * mix(1.0, 7.5, inside);
}

// Optical depth of the height fog along a ray of length R, analytically.
float heightOD(float y0, float rdy, float R) {
  float k = heightFalloff;
  float a = density * exp(-k * max(y0, 0.0));
  if (abs(rdy) < 1e-3) return a * R;
  return a * (1.0 - exp(-k * rdy * R)) / (k * rdy);
}

void main() {
  float d = texture2D(tDepth, vUv).x;
  bool sky = d >= 0.9999999;
  vec3 vp = viewPosAt(vUv, sky ? 0.9999 : d);
  vec3 wp = (camWorld * vec4(vp, 1.0)).xyz;
  vec3 rd = normalize(wp - camPos);
  float L = sky ? 1e6 : length(wp - camPos);
  float Lm = min(L, maxDist);
  float jitter = fract(ign(gl_FragCoord.xy) + frame * 0.6180339);
  float c = dot(rd, sunDir);
  float ph = mix(hg(c, gForward), hg(c, -0.25), 0.22) * sunBoost + 0.035;
  vec3 S = vec3(0.0);
  float T = 1.0;
  float prev = 0.0;
  for (int i = 1; i <= STEPS; i++) {
    float f = float(i) / float(STEPS);
    float t1 = Lm * f * f;
    float dt = t1 - prev;
    vec3 p = camPos + rd * (prev + dt * jitter);
    prev = t1;
    float inside;
    float de = densityAt(p, inside);
    if (de <= 0.0) continue;
    float vis = sunVis(p);
    vec3 Li = sunColor * vis * ph + ambColor * (1.0 - inside * 0.8);
    float Tr = exp(-de * dt);
    S += T * Li * (1.0 - Tr);
    T *= Tr;
  }
  // Beyond the marched range: unshadowed analytic height fog (horizon haze and the sky).
  float R = sky ? (rd.y > 0.0 ? 4000.0 : 600.0) : max(0.0, L - Lm);
  if (R > 0.0) {
    vec3 p0 = camPos + rd * Lm;
    float od = heightOD(p0.y, rd.y, min(R, 4000.0)) * (sky ? 0.16 : 0.8);
    float Tr = exp(-od);
    S += T * (sunColor * ph * 0.85 + ambColor) * (1.0 - Tr);
    T *= Tr;
  }
  gl_FragColor = vec4(S, T);
}`;

// Temporal resolve: reproject last frame's fog by the surface position and clamp it to
// the current neighbourhood so moving silhouettes don't smear.
const RESOLVE_FRAG = /* glsl */`
${DEPTH_PARS}
uniform sampler2D tCur, tHist;
uniform mat4 camWorld, prevViewProj;
uniform vec2 texel;
uniform float blend, valid;
varying vec2 vUv;
void main() {
  vec4 cur = texture2D(tCur, vUv);
  vec4 mn = cur, mx = cur;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec4 s = texture2D(tCur, vUv + vec2(x, y) * texel);
    mn = min(mn, s); mx = max(mx, s);
  }
  float d = texture2D(tDepth, vUv).x;
  vec3 wp = (camWorld * vec4(viewPosAt(vUv, min(d, 0.9999)), 1.0)).xyz;
  vec4 pc = prevViewProj * vec4(wp, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  vec4 hist = texture2D(tHist, puv);
  hist = clamp(hist, mn, mx);
  float ok = valid * step(0.0, puv.x) * step(0.0, puv.y) * step(puv.x, 1.0) * step(puv.y, 1.0);
  gl_FragColor = mix(cur, hist, blend * ok);
}`;

const BLUR_FRAG = /* glsl */`
${DEPTH_PARS}
uniform sampler2D tFog;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  float z0 = linDepth(texture2D(tDepth, vUv).x);
  vec4 sum = vec4(0.0); float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + dir * float(i);
    float z = linDepth(texture2D(tDepth, uv).x);
    float w = exp(-float(i * i) / 10.0) * exp(-abs(z - z0) / (0.04 * z0 + 0.05) );
    sum += texture2D(tFog, uv) * w; wsum += w;
  }
  gl_FragColor = sum / max(wsum, 1e-4);
}`;

const COMPOSITE_FRAG = /* glsl */`
${DEPTH_PARS}
uniform sampler2D tColor, tFog, tShafts;
uniform vec3 shaftColor;
uniform vec2 lowSize;
varying vec2 vUv;
void main() {
  vec4 col = texture2D(tColor, vUv);
  float z0 = linDepth(texture2D(tDepth, vUv).x);
  vec2 p = vUv * lowSize - 0.5;
  vec2 i0 = floor(p), f = p - i0;
  vec4 sum = vec4(0.0); float wsum = 0.0;
  for (int y = 0; y <= 1; y++) for (int x = 0; x <= 1; x++) {
    vec2 uv = (i0 + vec2(x, y) + 0.5) / lowSize;
    float z = linDepth(texture2D(tDepth, uv).x);
    float bw = (x == 0 ? 1.0 - f.x : f.x) * (y == 0 ? 1.0 - f.y : f.y);
    float w = bw * exp(-abs(z - z0) / (0.03 * z0 + 0.03)) + 1e-5 * bw;
    sum += texture2D(tFog, uv) * w; wsum += w;
  }
  vec4 fog = sum / max(wsum, 1e-6);
  vec3 shafts = texture2D(tShafts, vUv).r * shaftColor;
  gl_FragColor = vec4(col.rgb * fog.a + fog.rgb + shafts * fog.a, col.a);
}`;

// Screen-space sun shafts: sky pixels near the sun, smeared radially towards it (three passes of
// a 16-tap blur at quarter resolution), added over the volumetric haze for crisp streaks
// through leaves and past rooflines when you face the sun.
const SHAFT_MASK_FRAG = /* glsl */`
${DEPTH_PARS}
uniform sampler2D tColor;
uniform vec2 sunUV;
uniform float aspect;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).x;
  float sky = step(0.9999999, d);
  vec2 q = (vUv - sunUV) * vec2(aspect, 1.0);
  float fall = pow(max(0.0, 1.0 - length(q) / 1.5), 1.6);
  vec3 c = texture2D(tColor, vUv).rgb;
  float lum = min(dot(c, vec3(0.3, 0.5, 0.2)), 4.0);
  gl_FragColor = vec4(vec3(sky * fall * smoothstep(0.15, 1.6, lum) * (0.5 + 0.5 * min(lum, 3.0))), 1.0);
}`;

const SHAFT_BLUR_FRAG = /* glsl */`
uniform sampler2D tIn;
uniform vec2 sunUV;
uniform float stepScale;
varying vec2 vUv;
void main() {
  vec2 dir = (sunUV - vUv) * stepScale / 24.0;
  vec2 uv = vUv;
  float acc = 0.0, w = 1.0, ws = 0.0;
  for (int i = 0; i < 24; i++) {
    acc += texture2D(tIn, uv).r * w;
    ws += w;
    w *= 0.968;
    uv += dir;
  }
  gl_FragColor = vec4(vec3(acc / ws), 1.0);
}`;

function mat(frag, uniforms, defines) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines: defines || {}, depthTest: false, depthWrite: false });
}

export class Volumetrics {
  constructor(renderer, scene, camera, sun) {
    this.r = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;
    this.noise = noise3D(64);
    this.frame = 0;
    this.time = 0;
    this.steps = 40;
    this.scale = 0.5;
    this.prevViewProj = new THREE.Matrix4();
    this.hasHistory = false;
    this.indoor = [];
    this.params = {
      density: 0.006, heightFalloff: 0.07, groundMist: 0.004, maxDist: 120, gForward: 0.45, sunBoost: 1.6,
      ambColor: new THREE.Color(0.3, 0.36, 0.46).multiplyScalar(0.28),
      wind: new THREE.Vector3(0.0035, 0.0006, 0.0016),
    };
    const common = () => ({
      tDepth: { value: null }, invProj: { value: new THREE.Matrix4() }, cNear: { value: 0.05 }, cFar: { value: 900 },
    });
    this.march = mat(MARCH_FRAG, Object.assign(common(), {
      tShadow: { value: null }, tNoise: { value: this.noise }, shadowMatrix: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() },
      camPos: { value: new THREE.Vector3() }, sunDir: { value: new THREE.Vector3() }, sunColor: { value: new THREE.Color() }, ambColor: { value: new THREE.Color() },
      wind: { value: new THREE.Vector3() }, hasShadow: { value: 0 }, density: { value: 0 }, heightFalloff: { value: 0 }, groundMist: { value: 0 },
      maxDist: { value: 0 }, time: { value: 0 }, frame: { value: 0 }, gForward: { value: 0.6 }, sunBoost: { value: 1 },
      tCloud: SHARED.tCloud, cloudShadow: SHARED.cloudShadow,
      indoorMin: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, indoorMax: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, indoorCount: { value: 0 },
    }), { STEPS: this.steps });
    this.resolve = mat(RESOLVE_FRAG, Object.assign(common(), {
      tCur: { value: null }, tHist: { value: null }, camWorld: { value: new THREE.Matrix4() }, prevViewProj: { value: new THREE.Matrix4() },
      texel: { value: new THREE.Vector2() }, blend: { value: 0.88 }, valid: { value: 0 },
    }));
    this.blur = mat(BLUR_FRAG, Object.assign(common(), { tFog: { value: null }, dir: { value: new THREE.Vector2() } }));
    this.composite = mat(COMPOSITE_FRAG, Object.assign(common(), { tColor: { value: null }, tFog: { value: null }, tShafts: { value: null }, shaftColor: { value: new THREE.Color() }, lowSize: { value: new THREE.Vector2() } }));
    this.shaftMask = mat(SHAFT_MASK_FRAG, Object.assign(common(), { tColor: { value: null }, sunUV: { value: new THREE.Vector2() }, aspect: { value: 1 } }));
    this.shaftBlur = mat(SHAFT_BLUR_FRAG, { tIn: { value: null }, sunUV: { value: new THREE.Vector2() }, stepScale: { value: 1 } });
    this.shaftStrength = 1.35;
    this.quad = new FullScreenQuad(this.march);
    const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rtMarch = rt(); this.rtA = rt(); this.rtB = rt(); this.rtHist = [rt(), rt()];
    this.rtS1 = rt(); this.rtS2 = rt();
    this._v = new THREE.Vector3();
    this.hi = 0;
  }

  setIndoor(boxes) {
    this.indoor = boxes.slice(0, 4);
    const u = this.march.uniforms;
    u.indoorCount.value = this.indoor.length;
    this.indoor.forEach((b, i) => { u.indoorMin.value[i].fromArray(b.min); u.indoorMax.value[i].fromArray(b.max); });
  }

  configure(preset) {
    const v = preset.volumetric || { steps: 32, scale: 0.5 };
    this.scale = v.scale;
    if (v.steps !== this.steps) { this.steps = v.steps; this.march.defines.STEPS = v.steps; this.march.needsUpdate = true; }
    this.hasHistory = false;
  }

  setSize(w, h) {
    const lw = Math.max(1, Math.round(w * this.scale)), lh = Math.max(1, Math.round(h * this.scale));
    for (const t of [this.rtMarch, this.rtA, this.rtB, ...this.rtHist]) t.setSize(lw, lh);
    this.rtS1.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4))); this.rtS2.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
    this.aspect = w / h;
    this.low = new THREE.Vector2(lw, lh);
    this.hasHistory = false;
  }

  // depthTex: the world pass's depth; input: its colour; output: the target to write.
  render(dt, depthTex, input, output) {
    const cam = this.camera, P = this.params;
    this.time += dt;
    this.frame = (this.frame + 1) % 64;
    for (const m of [this.march, this.resolve, this.blur, this.composite]) {
      m.uniforms.tDepth.value = depthTex;
      m.uniforms.invProj.value.copy(cam.projectionMatrixInverse);
      m.uniforms.cNear.value = cam.near; m.uniforms.cFar.value = cam.far;
    }
    const u = this.march.uniforms;
    const sh = this.sun.shadow;
    u.hasShadow.value = sh.map ? 1 : 0;
    u.tShadow.value = sh.map ? sh.map.texture : null;
    u.shadowMatrix.value.copy(sh.matrix);
    u.camWorld.value.copy(cam.matrixWorld);
    u.camPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.sunDir.value.copy(this.sun.position).sub(this.sun.target.position).normalize();
    u.sunColor.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    u.ambColor.value.copy(P.ambColor);
    u.wind.value.copy(P.wind);
    u.density.value = P.density; u.heightFalloff.value = P.heightFalloff; u.groundMist.value = P.groundMist;
    u.maxDist.value = P.maxDist; u.gForward.value = P.gForward; u.sunBoost.value = P.sunBoost;
    u.time.value = this.time; u.frame.value = this.frame;
    // 1. march
    this.draw(this.march, this.rtMarch);
    // 2. temporal resolve into the history ping-pong
    const prev = this.rtHist[this.hi], next = this.rtHist[1 - this.hi];
    const ru = this.resolve.uniforms;
    ru.tCur.value = this.rtMarch.texture;
    ru.tHist.value = prev.texture;
    ru.camWorld.value.copy(cam.matrixWorld);
    ru.prevViewProj.value.copy(this.prevViewProj);
    ru.texel.value.set(1 / this.low.x, 1 / this.low.y);
    ru.valid.value = this.hasHistory ? 1 : 0;
    this.draw(this.resolve, next);
    this.hi = 1 - this.hi;
    this.hasHistory = true;
    this.prevViewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    // 3. bilateral blur
    const bu = this.blur.uniforms;
    bu.tFog.value = next.texture; bu.dir.value.set(1 / this.low.x, 0);
    this.draw(this.blur, this.rtA);
    bu.tFog.value = this.rtA.texture; bu.dir.value.set(0, 1 / this.low.y);
    this.draw(this.blur, this.rtB);
    // 4. sun shafts (only when the sun is in front of the camera)
    const cu = this.composite.uniforms;
    const sp = this._v.copy(u.sunDir.value).multiplyScalar(1000).add(u.camPos.value).project(cam);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).dot(u.sunDir.value);
    const vis = facing > 0 ? Math.max(0, 1 - Math.max(Math.abs(sp.x), Math.abs(sp.y)) / 1.6) : 0;
    if (vis > 0.001) {
      const suv = new THREE.Vector2(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      const mu = this.shaftMask.uniforms;
      mu.tColor.value = input.texture; mu.sunUV.value.copy(suv); mu.aspect.value = this.aspect || 1;
      this.draw(this.shaftMask, this.rtS1);
      const bu2 = this.shaftBlur.uniforms;
      bu2.sunUV.value.copy(suv);
      let src = this.rtS1, dst = this.rtS2;
      for (const k of [1.0, 0.5, 0.25]) {
        bu2.tIn.value = src.texture; bu2.stepScale.value = k;
        this.draw(this.shaftBlur, dst);
        [src, dst] = [dst, src];
      }
      cu.tShafts.value = src.texture;
      cu.shaftColor.value.copy(u.sunColor.value).multiplyScalar(this.shaftStrength * vis);
    } else {
      cu.tShafts.value = this.rtS1.texture;
      cu.shaftColor.value.setRGB(0, 0, 0);
    }
    // 5. composite at full resolution
    cu.tColor.value = input.texture; cu.tFog.value = this.rtB.texture; cu.lowSize.value.copy(this.low);
    this.draw(this.composite, output);
  }

  draw(m, target) {
    this.quad.material = m;
    this.r.setRenderTarget(target);
    this.quad.render(this.r);
  }
}

// Dust motes drifting around the camera. They are lit only where the sun reaches them
// (a shadow-map lookup per mote), so they sparkle inside god rays and vanish in shade.
export class DustMotes {
  constructor(scene, sun, count = 3000, box = 26) {
    this.sun = sun;
    this.box = box;
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * box; pos[i * 3 + 1] = Math.random() * box * 0.45; pos[i * 3 + 2] = Math.random() * box;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tShadow: { value: null }, hasShadow: { value: 0 }, shadowMatrix: { value: new THREE.Matrix4() }, sunDir: { value: new THREE.Vector3() },
        sunColor: { value: new THREE.Color() }, camPos: { value: new THREE.Vector3() }, box: { value: box }, time: { value: 0 }, pxScale: { value: 600 },
      },
      vertexShader: /* glsl */`
        #include <packing>
        attribute float seed;
        uniform sampler2D tShadow;
        uniform float hasShadow, box, time, pxScale;
        uniform mat4 shadowMatrix;
        uniform vec3 sunDir, sunColor, camPos;
        varying vec3 vCol;
        varying float vA;
        void main() {
          vec3 drift = vec3(sin(time * 0.11 + seed * 40.0) * 0.6 + time * 0.05, sin(time * 0.07 + seed * 23.0) * 0.5 + time * 0.012, cos(time * 0.09 + seed * 31.0) * 0.6 + time * 0.02);
          vec3 base = camPos - vec3(box * 0.5, 1.2, box * 0.5);
          vec3 h = vec3(box, box * 0.45, box);
          vec3 p = base + mod(position + drift - base, h);
          float vis = 1.0;
          if (hasShadow > 0.5) {
            vec4 sc = shadowMatrix * vec4(p, 1.0);
            vec3 s = sc.xyz / sc.w;
            if (s.x > 0.0 && s.y > 0.0 && s.x < 1.0 && s.y < 1.0) vis = step(s.z - 0.0015, unpackRGBAToDepth(texture2D(tShadow, s.xy)));
          }
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          vec3 v = normalize(p - camPos);
          float fwd = pow(max(0.0, dot(v, sunDir)) * 0.5 + 0.5, 6.0);
          float edge = smoothstep(box * 0.5, box * 0.3, length(p.xz - camPos.xz)) * smoothstep(0.25, 1.2, dist);
          float tw = 0.55 + 0.45 * sin(time * (1.5 + seed * 3.0) + seed * 60.0);
          vA = vis * edge * tw * (0.2 + 1.8 * fwd);
          vCol = sunColor * 0.11;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(pxScale * (0.006 + seed * 0.008) / max(dist, 0.1), 0.0, 6.0);
          if (vA < 0.002) gl_PointSize = 0.0;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol;
        varying float vA;
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float a = smoothstep(1.0, 0.0, dot(q, q)) * vA;
          gl_FragColor = vec4(vCol * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  setCount(n) { this.points.geometry.setDrawRange(0, n); }

  update(dt, camera, heightPx) {
    const u = this.mat.uniforms, sh = this.sun.shadow;
    u.time.value += dt;
    u.hasShadow.value = sh.map ? 1 : 0;
    u.tShadow.value = sh.map ? sh.map.texture : null;
    u.shadowMatrix.value.copy(sh.matrix);
    u.sunDir.value.copy(this.sun.position).sub(this.sun.target.position).normalize();
    u.sunColor.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    u.camPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.pxScale.value = heightPx / (2 * Math.tan(camera.fov * Math.PI / 360));
  }
}
