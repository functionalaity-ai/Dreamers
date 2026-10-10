// Loading-screen key art: three MSG operators pushing up a burning street at dusk. It is rendered
// once, with the game's own character and weapon models, into an HDR target; then it gets a wet
// street mirror, bokeh depth of field, bloom and a teal-and-amber grade, and is handed to the
// loading screen as a 2D canvas (plus where the muzzle flash and the fires sit, for CSS flicker).
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Humanoid } from '../characters/humanoid.js';
import { buildGun, bakeGun } from '../weapons/gunmodels.js';
import { cartridgeGeo } from '../weapons/gunkit.js';
import * as TX from '../core/textures.js';
import * as SF from '../core/surfaces.js';

export const ART_ASPECT = 2.35;

const FOG = new THREE.Color(0x2c3d42);
const FOG_DENSITY = 0.034;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Storm sky: teal overhead, a fire-lit band down the street, smoke banks drifting across it.
const SKY_FRAG = /* glsl */`
  uniform vec3 uZenith, uHorizon, uGlow, uGlowDir;
  uniform float uScale;
  varying vec3 vDir;
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n3(p); p *= 2.03; a *= 0.5; } return s; }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.55, h));
    float g = max(dot(d, uGlowDir), 0.0);
    float low = smoothstep(0.45, -0.04, h);
    col += uGlow * (pow(g, 5.0) * 0.9 + pow(g, 28.0) * 2.6) * low;
    float smoke = fbm3(d * vec3(3.0, 5.5, 3.0) + vec3(0.0, 0.0, 1.7));
    float bank = smoothstep(0.38, 0.75, smoke);
    col = mix(col, col * vec3(0.42, 0.4, 0.4) + uGlow * 0.08 * low * g, bank * 0.8);
    gl_FragColor = vec4(col * uScale, 1.0);
  }`;

// Standing water: a mirror of the scene with ripples, Fresnel and the same fog as the world.
const PUDDLE_VERT = /* glsl */`
  uniform mat4 uTexMat;
  varying vec4 vProj;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vProj = uTexMat * w;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const PUDDLE_FRAG = /* glsl */`
  uniform sampler2D tRefl, tMask;
  uniform vec3 uFog;
  uniform float uFogDensity;
  varying vec4 vProj;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vec4 m = texture2D(tMask, vUv);
    float wet = smoothstep(0.02, 0.22, m.r);
    if (wet < 0.01) discard;
    vec3 V = normalize(cameraPosition - vWorld);
    float F = 0.02 + 0.98 * pow(1.0 - max(V.y, 0.0), 5.0);
    vec2 rip = (m.gb - 0.5) * 0.035;
    vec3 refl = texture2DProj(tRefl, vProj + vec4(rip * vProj.w, 0.0, 0.0)).rgb;
    vec3 col = refl * mix(0.3, 1.0, F) + vec3(0.004, 0.006, 0.007);
    float d = length(cameraPosition - vWorld) * uFogDensity;
    col = mix(col, uFog, 1.0 - exp(-d * d));
    gl_FragColor = vec4(col, wet * 0.94);
  }`;

// Single-pass bokeh: golden-angle spiral gather, with farther samples clamped to this pixel's own
// circle of confusion so a sharp subject doesn't smear over its background.
const DOF_FRAG = /* glsl */`
  uniform sampler2D tColor, tDepth;
  uniform vec2 texel;
  uniform float uNear, uFar, uFocus, uScale, uMaxR;
  varying vec2 vUv;
  float lin(vec2 uv) {
    float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
    return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
  }
  float coc(float d) { return min(uMaxR, abs(1.0 / uFocus - 1.0 / d) * uScale); }
  void main() {
    float d0 = lin(vUv);
    float c0 = coc(d0);
    vec3 col = texture2D(tColor, vUv).rgb;
    float tot = 1.0;
    float rad = 0.8;
    float ang = 0.0;
    for (int i = 0; i < 220; i++) {
      if (rad >= uMaxR) break;
      vec2 tc = vUv + vec2(cos(ang), sin(ang)) * texel * rad;
      vec3 sc = texture2D(tColor, tc).rgb;
      float sd = lin(tc);
      float ss = coc(sd);
      if (sd > d0) ss = clamp(ss, 0.0, c0 * 2.0);
      float m = smoothstep(rad - 0.5, rad + 0.5, ss);
      col += mix(col / tot, sc, m);
      tot += 1.0;
      rad += 0.8 / rad;
      ang += 2.39996323;
    }
    gl_FragColor = vec4(col / tot, 1.0);
  }`;

// Poster grade: exposure, split toning, ACES, sRGB, lens fringing, vignette and grain.
const GRADE_FRAG = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 res;
  uniform float uExposure;
  varying vec2 vUv;
  vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main() {
    vec2 dc = vUv - 0.5;
    float ca = dot(dc, dc) * 0.012;
    vec3 c = vec3(texture2D(tSrc, vUv - dc * ca).r, texture2D(tSrc, vUv).g, texture2D(tSrc, vUv + dc * ca).b);
    c *= uExposure;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, c * vec3(0.78, 1.0, 1.14), smoothstep(0.35, 0.0, l) * 0.65);
    c = mix(c, c * vec3(1.14, 0.97, 0.8), smoothstep(0.25, 2.0, l) * 0.55);
    c = aces(c);
    c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    c = mix(c, smoothstep(0.0, 1.0, c), 0.25);
    vec2 v = dc * vec2(1.0, 0.62);
    c *= 1.0 - smoothstep(0.22, 0.62, length(v)) * 0.6;
    c += (hash(vUv * res) - 0.5) * 0.045;
    gl_FragColor = vec4(c, 1.0);
  }`;

function quadPass(frag, uniforms) {
  return new FullScreenQuad(new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VERT, fragmentShader: frag, depthTest: false, depthWrite: false }));
}

function canvasTexture(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soft discs and streaks for embers, glints and out-of-focus lights.
function glowTexture() {
  return canvasTexture(64, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

// A licking flame tongue, hot at its root.
function flameTexture() {
  return canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s * 0.72, 2, s / 2, s * 0.6, s * 0.5);
    grad.addColorStop(0, 'rgba(255,248,220,1)');
    grad.addColorStop(0.25, 'rgba(255,200,110,0.9)');
    grad.addColorStop(0.6, 'rgba(255,110,30,0.45)');
    grad.addColorStop(1, 'rgba(200,50,10,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.02);
    g.bezierCurveTo(s * 0.62, s * 0.3, s * 0.95, s * 0.5, s * 0.82, s * 0.85);
    g.quadraticCurveTo(s * 0.5, s * 1.02, s * 0.18, s * 0.85);
    g.bezierCurveTo(s * 0.05, s * 0.5, s * 0.38, s * 0.3, s * 0.5, s * 0.02);
    g.fill();
  });
}

function smokeTexture(B) {
  return B.raw({
    name: 'keyartSmoke', size: 256, seed: 5, clamp: true, srgb: false,
    raw: /* glsl */`
      vec4 raw(vec2 uv) {
        vec2 p = uv - 0.5;
        float r = length(p) * 2.0;
        float n = fbm(uv + vec2(0.13, 0.0), 4.0, 5) + 0.5;
        float m = fbm(uv * 1.0 + 3.1, 2.0, 3) + 0.5;
        float a = smoothstep(1.0, 0.15, r) * smoothstep(0.3, 0.72, n * 0.75 + m * 0.35 + (1.0 - r) * 0.25);
        return vec4(1.0, 1.0, 1.0, a);
      }`,
  });
}

// Puddle mask (r) and ripple offsets (gb), tiling across the street.
function puddleTexture(B) {
  const t = B.raw({
    name: 'keyartPuddles', size: 512, seed: 9,
    raw: /* glsl */`
      vec4 raw(vec2 uv) {
        float w = fbm(uv, vec2(5.0, 9.0), 5) + fbm(uv + 0.37, 18.0, 3) * 0.35;
        float m = smoothstep(0.02, 0.16, w);
        float rx = fbm(uv * 1.0 + 1.3, 48.0, 2), ry = fbm(uv * 1.0 + 5.7, 48.0, 2);
        return vec4(m, rx + 0.5, ry + 0.5, 1.0);
      }`,
  });
  return t;
}

// Street-front silhouettes: plain blocks carry cornices, string courses, balconies with rails,
// chimneys and lit windows; fog and depth of field turn them into layered shapes against the glow.
function buildStreet(scene, rand, M) {
  const solid = [], dark = [], lit = [];
  const box = (arr, w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); arr.push(g); };
  for (const side of [-1, 1]) {
    let z = 6;
    while (z > -110) {
      const len = 6 + rand() * 7;
      const ht = 8 + rand() * 9 + (z < -40 ? 3 : 0);
      const front = 5.6 + rand() * 0.5 + (z < -50 ? rand() * 1.5 : 0);
      const cz = z - len / 2;
      const x = side * (front + 4);
      box(solid, 8, ht, len - 0.12, x, ht / 2, cz);
      // cornice and string courses
      box(solid, 0.55, 0.38, len + 0.3, side * (front + 0.12), ht - 0.25, cz);
      const floors = Math.floor(ht / 3.2);
      for (let f = 1; f < floors; f++) box(solid, 0.18, 0.14, len, side * (front + 0.04), f * 3.2, cz);
      // windows: dark recesses, a few lit rooms
      const cols = Math.max(2, Math.floor(len / 2.4));
      for (let f = 0; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          const wz = z - (c + 0.5) * (len / cols);
          const wy = f * 3.2 + (f === 0 ? 1.3 : 1.75);
          const wh = f === 0 ? 2.4 : 1.55;
          if (rand() < 0.09 && f > 0) box(lit, 0.04, wh, 0.95, side * (front - 0.01), wy, wz);
          else box(dark, 0.06, wh, 0.95, side * (front - 0.005), wy, wz);
          if (f > 0 && rand() < 0.22) {
            box(solid, 1.0, 0.12, 1.7, side * (front - 0.45), wy - wh / 2 - 0.08, wz);
            for (let k = 0; k < 7; k++) box(solid, 0.025, 0.95, 0.025, side * (front - 0.92), wy - wh / 2 + 0.4, wz - 0.8 + k * 0.266);
            box(solid, 0.05, 0.05, 1.7, side * (front - 0.92), wy - wh / 2 + 0.88, wz);
          }
        }
      }
      if (rand() < 0.6) box(solid, 0.7, 1.6, 0.9, side * (front + 2 + rand() * 3), ht + 0.8, cz + (rand() - 0.5) * len * 0.6);
      // roof: a low gable along the street
      const roof = new THREE.CylinderGeometry(0.01, 4.6, 1.8, 4, 1, false, Math.PI / 4);
      roof.scale(1.25, 1, len / 6.5);
      roof.translate(x, ht + 0.9, cz);
      solid.push(roof);
      z -= len;
    }
  }
  // street lamps and sagging cables
  const lampHeads = [];
  for (let i = 0; i < 9; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -3 - i * 9 - rand() * 3;
    const x = side * 4.9;
    box(solid, 0.1, 4.6, 0.1, x, 2.3, z);
    box(solid, 1.0, 0.06, 0.06, x - side * 0.5, 4.55, z);
    lampHeads.push(new THREE.Vector3(x - side * 0.95, 4.45, z));
  }
  const cables = [];
  for (let i = 0; i < 6; i++) {
    const z = -6 - i * 11 - rand() * 4;
    const y = 6 + rand() * 3;
    const pts = [];
    for (let k = 0; k <= 16; k++) { const t = k / 16; pts.push(new THREE.Vector3(-5.6 + t * 11.2, y - Math.sin(t * Math.PI) * (0.9 + rand() * 0.2), z + (rand() - 0.5) * 0.1)); }
    cables.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 4, false));
  }
  scene.add(new THREE.Mesh(mergeGeometries(solid.concat(cables), false), M.wall));
  scene.add(new THREE.Mesh(mergeGeometries(dark, false), M.window));
  scene.add(new THREE.Mesh(mergeGeometries(lit, false), M.lit));
  return lampHeads;
}

// Jersey barrier: a concrete safety-shape profile extruded across the street.
function barrier(len) {
  const s = new THREE.Shape();
  const half = [[0.3, 0], [0.3, 0.08], [0.22, 0.33], [0.08, 0.81], [0.08, 0.82]];
  s.moveTo(-half[0][0], 0);
  for (const [x, y] of half) s.lineTo(x, y);
  for (let i = half.length - 1; i >= 0; i--) s.lineTo(-half[i][0], half[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

function chunk(rand, size) {
  const g = new THREE.IcosahedronGeometry(size, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.6 + rand() * 0.8), p.getY(i) * (0.5 + rand() * 0.7), p.getZ(i) * (0.6 + rand() * 0.8));
  g.computeVertexNormals();
  return g;
}

// Pose an operator. A few updates let the crouch blend settle; `phase` freezes a stride.
function operator(mats, seed, gunId, att, pos, yaw, pose) {
  const h = new Humanoid(mats.char.msg, 'msg', seed);
  const gun = buildGun(gunId, att, mats.gun, { fp: true, shadows: true });
  h.setGun(bakeGun(gun), gun.anchors);
  h.group.position.set(pos[0], 0, pos[2]);
  h.group.rotation.y = yaw;
  h.lean = pose.lean || 0;
  for (let i = 0; i < 40; i++) h.update(1 / 30, pose);
  if (pose.phase !== undefined) { h.phase = pose.phase; h.update(0.0001, pose); }
  if (pose.recoil) { h.recoil = pose.recoil; h.update(0.0001, pose); }
  if (pose.bend) { h.crouch = pose.bend; h.update(0.0001, pose); }
  if (pose.stance) {
    // a fighting stance: lead leg forward, rear leg back, knees soft
    const b = h.b, k = pose.stance;
    b.thighL.rotation.x -= 0.32 * k; b.shinL.rotation.x += 0.12 * k; b.footL.rotation.x += 0.18 * k;
    b.thighR.rotation.x += 0.24 * k; b.shinR.rotation.x -= 0.2 * k; b.footR.rotation.x -= 0.05 * k;
    b.thighL.rotation.z -= 0.08 * k; b.thighR.rotation.z += 0.08 * k;
    b.hips.position.y -= 0.035 * k;
    h.group.updateMatrixWorld(true);
    h.poseGun(pose.aimPitch || 0, pose);
  }
  if (pose.cheek) { h.b.neck.rotation.x -= pose.cheek * 0.6; h.b.head.rotation.x -= pose.cheek * 0.4; h.b.head.rotation.z -= pose.cheek * 0.25; h.group.updateMatrixWorld(true); }
  h.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { h, gun };
}

/**
 * Render the key art at w × h (aspect ART_ASPECT) and return { canvas, flash, muzzle, glows }:
 * the frame without and with the muzzle flash, and where the flash and fires sit (fractions).
 */
export async function renderKeyArt(R, mats, w, h) {
  const r = R.r;
  const rand = rng(1907);
  const disposables = [];
  const keep = (o) => { disposables.push(o); return o; };
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG.getHex(), FOG_DENSITY);
  const cam = new THREE.PerspectiveCamera(22, w / h, 0.1, 420);
  cam.position.set(0, 0.78, 8.6);
  cam.up.set(Math.sin(-0.03), Math.cos(0.03), 0);
  cam.lookAt(0, 1.86, 0);
  cam.updateMatrixWorld();

  // Sky and its reflection environment
  const skyMat = keep(new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(0x0a1820) }, uHorizon: { value: new THREE.Color(0x3d5a60) },
      uGlow: { value: new THREE.Color(1.5, 0.55, 0.18) }, uGlowDir: { value: new THREE.Vector3(0.08, 0.04, -1).normalize() }, uScale: { value: 0.3 },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(380, 48, 24)), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(sky.geometry, skyMat));
  const pm = new THREE.PMREMGenerator(r);
  // a dim capture: the street is lit by its fires, not by the sky
  const env = keep(pm.fromScene(envScene, 0.04));
  pm.dispose();
  skyMat.uniforms.uScale.value = 1;
  scene.environment = env.texture;
  scene.add(sky);

  // Materials for the set
  const B = mats.baker;
  const cob = SF.cobble(B, 512, 3);
  for (const t of [cob.map, cob.normalMap, cob.ormMap]) { t.repeat.set(160 / 2.4, 160 / 2.4); t.anisotropy = 8; }
  for (const k of ['mapRT', 'normalMapRT', 'ormMapRT']) keep(cob[k]);
  const M = {
    ground: keep(new THREE.MeshStandardMaterial({ map: cob.map, normalMap: cob.normalMap, roughnessMap: cob.ormMap, aoMap: cob.ormMap, color: 0x8c8780, roughness: 0.82, metalness: 0, envMapIntensity: 0.55 })),
    wall: keep(new THREE.MeshStandardMaterial({ color: 0x6b5e52, roughness: 0.92, envMapIntensity: 0.4 })),
    window: keep(new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 0.6, envMapIntensity: 0.22 })),
    lit: keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.5, 0.18) })),
    concrete: keep(new THREE.MeshStandardMaterial({ color: 0x86827a, roughness: 0.9, normalMap: cob.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) })),
    rubble: keep(new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 0.95, flatShading: true })),
    burnt: keep(new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.8, metalness: 0.3 })),
  };
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(160, 160)), M.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const lampHeads = buildStreet(scene, rand, M);
  for (const o of scene.children) if (o.isMesh && o !== sky && o !== ground) { keep(o.geometry); o.receiveShadow = true; o.castShadow = true; }

  // Lights: a cold moonlit key from camera right, a fire rim from down the street
  scene.add(new THREE.HemisphereLight(0x5b7680, 0x1a120c, 0.22));
  const key = new THREE.DirectionalLight(0x7fb0c8, 0.45);
  key.position.set(4, 3, 12);
  scene.add(key, key.target);
  // a cold edge from up the street on the right, and the fire behind as the main back light
  const rim2 = new THREE.DirectionalLight(0x6fb6d6, 2.6);
  rim2.position.set(4.5, 4, -10);
  rim2.target.position.set(0.6, 1.2, 4.6);
  scene.add(rim2, rim2.target);
  const rim = new THREE.DirectionalLight(0xff9a52, 7.5);
  rim.position.set(0.4, 5, -14);
  rim.target.position.set(0.6, 0.5, 4.4);
  rim.castShadow = true;
  rim.shadow.mapSize.set(2048, 2048);
  Object.assign(rim.shadow.camera, { left: -8, right: 8, top: 7, bottom: -5, near: 2, far: 40 });
  rim.shadow.bias = -0.0004;
  rim.shadow.normalBias = 0.02;
  scene.add(rim, rim.target);
  const fires = [
    [new THREE.Vector3(4.5, 1.1, -9.4), 2.2],
    [new THREE.Vector3(-3.6, 0.8, -31), 3.4],
    [new THREE.Vector3(1.0, 5.5, -62), 8],
  ];
  for (const [p, s] of fires) {
    const l = new THREE.PointLight(0xff7a2c, 7 * s, 0, 2);
    l.position.copy(p).add(new THREE.Vector3(0, 0.6, 0));
    scene.add(l);
  }

  // The three operators
  const hero = operator(mats, 211, 'kestrel', { optic: 'reddot', muzzle: 'compensator', underbarrel: 'agrip', finish: 'fde' },
    [0.62, 0, 4.6], Math.PI / 2 + 0.35, { speed: 0, aimPitch: 0.05, recoil: 0.55, lean: 0.05, raise: 0.075, cheek: 0.32, stance: 1, bend: 0.22 });
  const runner = operator(mats, 340, 'kestrel', { optic: 'scope4x', muzzle: 'suppressor', finish: 'black' },
    [-1.4, 0, -1.0], -2.84, { speed: 5.4, sprint: true, phase: 1.05 });
  const kneel = operator(mats, 477, 'bastion', { optic: 'reddot' },
    [-2.7, 0, -4.4], 1.62, { crouch: true, aimPitch: 0.02 });
  for (const o of [hero, runner, kneel]) {
    scene.add(o.h.group);
    o.h.group.traverse((m) => { if (m.isMesh && m.geometry) keep(m.geometry); });
  }

  // Cover and rubble
  const jb = new THREE.Mesh(keep(barrier(3.2)), M.concrete);
  jb.position.set(-3.35, 0, -4.25);
  jb.rotation.y = 1.5;
  jb.castShadow = jb.receiveShadow = true;
  scene.add(jb);
  const rubble = [];
  for (let i = 0; i < 140; i++) {
    const g = chunk(rand, 0.03 + rand() * rand() * 0.22);
    const a = rand() * Math.PI * 2, d = rand() * 9;
    g.rotateX(rand() * 6); g.rotateY(rand() * 6);
    g.translate(-0.5 + Math.cos(a) * d * 0.9, 0.02, -2 + Math.sin(a) * d - rand() * 10);
    rubble.push(g);
  }
  const rub = new THREE.Mesh(keep(mergeGeometries(rubble, false)), M.rubble);
  rub.castShadow = rub.receiveShadow = true;
  scene.add(rub);
  // burnt-out car, still burning
  const car = [];
  const cb = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); car.push(g); };
  cb(1.75, 0.62, 4.2, 0, 0.62, 0); cb(1.55, 0.5, 2.0, 0, 1.16, -0.2);
  for (const [x, z] of [[-0.82, 1.3], [0.82, 1.3], [-0.82, -1.3], [0.82, -1.3]]) { const g = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14); g.rotateZ(Math.PI / 2); g.translate(x, 0.3, z); car.push(g); }
  const carMesh = new THREE.Mesh(keep(mergeGeometries(car, false)), M.burnt);
  carMesh.position.set(4.7, 0, -9.9);
  carMesh.rotation.y = 0.35;
  carMesh.castShadow = carMesh.receiveShadow = true;
  scene.add(carMesh);

  // Debris blasted off the street by incoming rounds, beside the lead operator
  const deb = [];
  const burst = new THREE.Vector3(1.75, 0.05, 3.7);
  for (let i = 0; i < 46; i++) {
    const g = chunk(rand, 0.004 + rand() * rand() * 0.022);
    g.rotateX(rand() * 6); g.rotateZ(rand() * 6);
    const a = rand() * Math.PI * 2, up = Math.pow(rand(), 0.7);
    g.translate(burst.x + Math.cos(a) * (0.1 + rand() * 0.7) * (1 - up * 0.5), burst.y + up * 1.6, burst.z + Math.sin(a) * 0.45);
    deb.push(g);
  }
  const debris = new THREE.Mesh(keep(mergeGeometries(deb, false)), M.rubble);
  debris.castShadow = true;
  scene.add(debris);

  // Brass in the air from the hero's ejection port
  const brassGeo = keep(cartridgeGeo('556').brass);
  const port = hero.gun.anchors.eject.clone().applyMatrix4(hero.h.gunPivot.matrixWorld);
  const gq = new THREE.Quaternion();
  hero.h.gunPivot.getWorldQuaternion(gq);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(gq);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(gq);
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(brassGeo, mats.gun.brass);
    m.position.copy(port).addScaledVector(right, 0.12 + i * 0.16).add(new THREE.Vector3(0, 0.05 + i * 0.07 - i * i * 0.03, 0)).addScaledVector(fwd, 0.04 * i);
    m.rotation.set(rand() * 6, rand() * 6, rand() * 6);
    scene.add(m);
  }

  // Sprites: smoke, fire, embers, lamp bokeh, muzzle flash
  const smokeTex = smokeTexture(B);
  keep(smokeTex.userData.rt);
  const glowTex = keep(glowTexture());
  const flameTex = keep(flameTexture());
  const flashTex = keep(TX.spriteTexture('flash'));
  const fx = new THREE.Scene();
  const sprite = (tex, color, opacity, additive, x, y, z, sx, sy, rot = 0, into = scene) => {
    const m = keep(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: !additive, rotation: rot }));
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z);
    s.scale.set(sx, sy || sx, 1);
    into.add(s);
    return s;
  };
  // rising plumes, lit from below by the fires
  for (const [fp, size] of fires) {
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const c = new THREE.Color().setRGB(0.07 + (1 - t) * 0.45, 0.065 + (1 - t) * 0.16, 0.065 + (1 - t) * 0.04);
      sprite(smokeTex, c, 0.55 - t * 0.2, false, fp.x + (rand() - 0.5) * size * (0.6 + t * 1.5) + t * size * 0.8, fp.y + 0.6 + t * size * 3.2, fp.z - rand() * 2, size * (1.1 + t * 2.2), 0, rand() * 6);
    }
    for (let i = 0; i < 7; i++) {
      const s = sprite(flameTex, new THREE.Color(6, 3.2, 1.3), 0.95, true, fp.x + (rand() - 0.5) * size * 0.7, fp.y + rand() * size * 0.3, fp.z + (rand() - 0.5) * 0.6, size * (0.35 + rand() * 0.35), size * (0.6 + rand() * 0.6));
      s.material.rotation = (rand() - 0.5) * 0.4;
    }
  }
  // low haze drifting across the street, and dust from the impacts
  for (let i = 0; i < 22; i++) sprite(smokeTex, new THREE.Color(0.07, 0.085, 0.085), 0.25, false, (rand() - 0.5) * 12, 0.6 + rand() * 1.6, -6 - rand() * 30, 6 + rand() * 6, 0, rand() * 6);
  for (let i = 0; i < 9; i++) sprite(smokeTex, new THREE.Color(0.3, 0.22, 0.16), 0.4, false, burst.x + (rand() - 0.5) * 0.7, 0.12 + rand() * 0.8, burst.z - 0.2 - rand() * 0.5, 0.45 + rand() * 0.7, 0, rand() * 6);
  // embers: bright points the depth of field turns into discs
  for (let i = 0; i < 240; i++) {
    const z = 6.5 - Math.pow(rand(), 0.8) * 36;
    const k = 0.6 + rand() * 1.6;
    sprite(glowTex, new THREE.Color(5 * k, 1.9 * k, 0.5 * k), 1, true, (rand() - 0.45) * (4 + (8 - z) * 0.45), 0.2 + rand() * 6.5, z, 0.012 + rand() * 0.035);
  }
  {
    const streak = keep(new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(3.4, 1.3, 0.35), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    const sg = keep(new THREE.PlaneGeometry(1, 1));
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(sg, streak);
      const a = rand() * Math.PI * 2, up = 0.2 + rand() * 0.8;
      m.position.set(burst.x + Math.cos(a) * 0.35 * rand(), 0.05 + up * 0.9, burst.z + Math.sin(a) * 0.25);
      m.scale.set(0.006 + rand() * 0.006, 0.05 + rand() * 0.12, 1);
      m.lookAt(cam.position);
      m.rotateZ((rand() - 0.5) * 1.6);
      fx.add(m);
    }
  }
  for (const p of lampHeads) sprite(glowTex, new THREE.Color(3.2, 2.2, 1.3), 1, true, p.x, p.y, p.z, 0.45);

  // Muzzle flash and its light
  const muzzle = hero.h.gunMuzzle.clone();
  const fc = muzzle.clone().addScaledVector(fwd, 0.1);
  const flashGroup = new THREE.Group();
  fx.add(flashGroup);
  sprite(flashTex, new THREE.Color(7, 4.6, 2.4), 1, true, fc.x, fc.y, fc.z, 0.26, 0.26, rand() * 6, flashGroup);
  sprite(glowTex, new THREE.Color(2.2, 1.1, 0.4), 1, true, fc.x, fc.y, fc.z, 0.55, 0.55, 0, flashGroup);
  {
    // side-on petals along the bore, turned to face the camera about the barrel axis
    const pet = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.4, 0.11)), keep(new THREE.MeshBasicMaterial({ map: flameTex, color: new THREE.Color(8, 4.6, 2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })));
    pet.geometry.rotateZ(-Math.PI / 2);
    const toCam = cam.position.clone().sub(fc).normalize();
    const n = toCam.clone().addScaledVector(fwd, -toCam.dot(fwd)).normalize();
    const yAxis = new THREE.Vector3().crossVectors(n, fwd).normalize();
    pet.matrixAutoUpdate = false;
    pet.matrix.makeBasis(fwd, yAxis, n).setPosition(fc.clone().addScaledVector(fwd, 0.15));
    flashGroup.add(pet);
  }
  const ml = new THREE.PointLight(0xffa456, 0.7, 0, 2);
  ml.position.copy(fc);
  scene.add(ml);

  if (r.compileAsync) await r.compileAsync(scene, cam);

  // --- Render: mirror for the puddles, then the scene, depth of field, bloom and grade ---
  const prev = { target: r.getRenderTarget(), autoClear: r.autoClear };
  const ss = Math.min(1.5, 2400 / w);   // supersample the scene for clean edges
  const sw = Math.round(w * ss), sh = Math.round(h * ss);
  const sceneRT = keep(new THREE.WebGLRenderTarget(sw, sh, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(sw, sh, THREE.UnsignedIntType) }));
  keep(sceneRT.depthTexture);
  const mirrorRT = keep(new THREE.WebGLRenderTarget(Math.round(w / 2), Math.round(h / 2), { type: THREE.HalfFloatType }));
  const mirrorCam = cam.clone();
  {
    const look = new THREE.Vector3();
    cam.getWorldDirection(look);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    mirrorCam.position.set(cam.position.x, -cam.position.y, cam.position.z);
    mirrorCam.up.set(camUp.x, -camUp.y, camUp.z);
    mirrorCam.lookAt(mirrorCam.position.clone().add(new THREE.Vector3(look.x, -look.y, look.z)));
    mirrorCam.updateMatrixWorld();
  }
  const texMat = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    .multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
  const puddleTex = puddleTexture(B);
  keep(puddleTex.userData.rt);
  const puddle = new THREE.Mesh(keep(new THREE.PlaneGeometry(26, 44)), keep(new THREE.ShaderMaterial({
    uniforms: { tRefl: { value: mirrorRT.texture }, tMask: { value: puddleTex }, uTexMat: { value: texMat }, uFog: { value: FOG }, uFogDensity: { value: FOG_DENSITY } },
    vertexShader: PUDDLE_VERT, fragmentShader: PUDDLE_FRAG, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })));
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(0, 0.002, -12);
  scene.add(puddle);

  r.shadowMap.needsUpdate = true;
  puddle.visible = false;
  r.setRenderTarget(mirrorRT);
  r.clear();
  r.render(scene, mirrorCam);
  puddle.visible = true;
  r.setRenderTarget(sceneRT);
  r.clear();
  r.render(scene, cam);

  const dofRT = keep(new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }));
  const focus = cam.position.distanceTo(hero.h.group.position) - 0.25;
  const dof = quadPass(DOF_FRAG, {
    tColor: { value: sceneRT.texture }, tDepth: { value: sceneRT.depthTexture }, texel: { value: new THREE.Vector2(1 / w, 1 / h) },
    uNear: { value: cam.near }, uFar: { value: cam.far }, uFocus: { value: focus }, uScale: { value: focus * w / 115 }, uMaxR: { value: w / 92 },
  });
  r.setRenderTarget(dofRT);
  dof.render(r);
  // Two finishes: with and without the muzzle flash, so the loading screen can strobe a burst.
  // The flash and the sparks sit on the focal plane, so they go on sharp, after the blur.
  const lit = keep(new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }));
  const copy = quadPass('uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSrc, vUv); }', { tSrc: { value: dofRT.texture } });
  r.setRenderTarget(lit);
  copy.render(r);
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.6, 1.4);
  const grade = quadPass(GRADE_FRAG, { tSrc: { value: null }, res: { value: new THREE.Vector2(w, h) }, uExposure: { value: 1.05 } });
  // The graded frame goes to the (hidden) game canvas and is copied out on the GPU, which
  // avoids a synchronous pixel read-back.
  const size = r.getSize(new THREE.Vector2()), ratio = r.getPixelRatio();
  r.setPixelRatio(1);
  r.setSize(w, h, false);
  const finish = (rt, flash) => {
    flashGroup.visible = flash;
    r.setRenderTarget(rt);
    r.autoClear = false;
    r.render(fx, cam);
    r.autoClear = true;
    bloom.render(r, null, rt, 0, false);
    grade.material.uniforms.tSrc.value = rt.texture;
    r.setRenderTarget(null);
    grade.render(r);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(r.domElement, 0, 0, w, h);
    return c;
  };
  const canvas = finish(dofRT, false);
  const flash = finish(lit, true);
  r.setPixelRatio(ratio);
  r.setSize(size.x, size.y, false);
  r.setRenderTarget(prev.target);
  r.autoClear = prev.autoClear;

  // Where the bright bits landed, for the loading screen's CSS flicker
  const onScreen = (p) => { const v = p.clone().project(cam); return [v.x * 0.5 + 0.5, 0.5 - v.y * 0.5]; };
  const out = { canvas, flash, muzzle: onScreen(fc), glows: fires.map(([p]) => onScreen(p)) };

  bloom.dispose();
  dof.material.dispose(); dof.dispose();
  grade.material.dispose(); grade.dispose();
  copy.material.dispose(); copy.dispose();
  scene.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); });
  for (const d of disposables) if (d && d.dispose) d.dispose();
  for (const l of scene.children) if (l.isLight && l.shadow && l.shadow.map) l.shadow.map.dispose();
  return out;
}
