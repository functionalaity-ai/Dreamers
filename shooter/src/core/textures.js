// Procedural, tileable PBR textures (albedo + normal + roughness) drawn on canvases.
import * as THREE from 'three';

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

// Tileable value noise on a lattice of `period` cells.
class Noise {
  constructor(seed, period) {
    const r = mulberry(seed);
    this.p = period;
    this.v = new Float32Array(period * period);
    for (let i = 0; i < this.v.length; i++) this.v[i] = r();
  }
  at(x, y) {
    const p = this.p;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
    const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = this.v[y0 * p + x0], b = this.v[y0 * p + x1], c = this.v[y1 * p + x0], d = this.v[y1 * p + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

// Fractal noise in [0,1], tileable over the unit square (u, v in [0,1)).
function fbm(noises, u, v, base) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < noises.length; i++) {
    const f = base << i;
    sum += noises[i].at(u * f, v * f) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

function makeNoises(seed, base, octaves) {
  const out = [];
  for (let i = 0; i < octaves; i++) out.push(new Noise(seed * 31 + i * 7, base << i));
  return out;
}



// Builds a texture set from a per-pixel function: fn(u, v) -> [r, g, b, height, roughness]
function build(size, fn, opts = {}) {
  const albedo = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  const rough = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const o = fn(x / size, y / size, x, y);
      albedo[i * 4] = o[0]; albedo[i * 4 + 1] = o[1]; albedo[i * 4 + 2] = o[2]; albedo[i * 4 + 3] = 255;
      height[i] = o[3];
      const rr = Math.max(0, Math.min(255, o[4] * 255));
      rough[i * 4] = rr; rough[i * 4 + 1] = rr; rough[i * 4 + 2] = rr; rough[i * 4 + 3] = 255;
    }
  }
  const strength = opts.normal === undefined ? 2 : opts.normal;
  const nrm = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size;
      const yu = (y - 1 + size) % size, yd = (y + 1) % size;
      const dx = (height[y * size + xr] - height[y * size + xl]) * strength;
      const dy = (height[yd * size + x] - height[yu * size + x]) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      nrm[i] = (nx * 0.5 + 0.5) * 255; nrm[i + 1] = (ny * 0.5 + 0.5) * 255; nrm[i + 2] = (nz * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
    }
  }
  const toTex = function (data, srgb) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.putImageData(new ImageData(data, size, size), 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: toTex(albedo, true), normalMap: toTex(nrm, false), roughnessMap: toTex(rough, false) };
}

const mix = (a, b, t) => a + (b - a) * t;

export function woodPlanks(size, dark = 0) {
  const boards = 6;
  const grain = makeNoises(51 + dark, 8, 4);
  const fine = makeNoises(52, 64, 2);
  const r = mulberry(53 + dark);
  const tints = [];
  for (let i = 0; i < boards * 4; i++) tints.push(r());
  return build(size, (u, v) => {
    const b = Math.floor(u * boards);
    const fu = u * boards - b;
    const seam = fu < 0.025 || fu > 0.975;
    const seg = Math.floor(v * 2 + tints[b] * 2);
    const endSeam = Math.abs(((v * 2 + tints[b] * 2) % 1)) < 0.012;
    const t = tints[(b * 2 + seg) % tints.length];
    const gr = fbm(grain, u * 0.25 + t, v * 4, 8);
    const ring = Math.sin((gr * 18 + u * 40) * 1.0) * 0.5 + 0.5;
    const f = fbm(fine, u, v, 64);
    const base = dark ? [92, 64, 44] : [150, 108, 70];
    const s = (0.72 + t * 0.32) * (0.85 + ring * 0.2) * (0.92 + f * 0.1);
    if (seam || endSeam) return [base[0] * 0.35, base[1] * 0.33, base[2] * 0.3, 0, 0.9];
    return [base[0] * s, base[1] * s, base[2] * s, 0.5 + ring * 0.12 + f * 0.05, 0.62 + f * 0.2];
  }, { normal: 1.8 });
}

export function roofTiles(size) {
  const rows = 10, cols = 8;
  const nz = makeNoises(61, 8, 4);
  const r = mulberry(62);
  const sh = [];
  for (let i = 0; i < rows * cols; i++) sh.push(r());
  return build(size, (u, v) => {
    const row = Math.floor(v * rows);
    const off = row % 2 ? 0.5 / cols : 0;
    const cu = ((u + off) % 1) * cols;
    const col = Math.floor(cu);
    const fv = v * rows - row, fu = cu - col;
    const s = sh[(row * cols + col) % sh.length];
    const n = fbm(nz, u, v, 8);
    const lip = fv;
    const curve = Math.sin(fu * Math.PI);
    const c = [mix(140, 176, s), mix(64, 88, s), mix(44, 56, s)].map((x) => x * (0.65 + lip * 0.35) * (0.85 + n * 0.25));
    return [c[0], c[1], c[2], lip * 0.6 + curve * 0.3, 0.7 + n * 0.2];
  }, { normal: 3 });
}

// Camouflage atlas for characters: 4 quadrants (camo, fabric, skin, rubber).
export function characterAtlas(size, scheme) {
  const half = size / 2;
  const nz = makeNoises(scheme === 'volk' ? 88 : 81, 4, 4);
  const nz2 = makeNoises(scheme === 'volk' ? 89 : 82, 8, 3);
  const weave = makeNoises(83, 128, 1);
  const pal = scheme === 'volk'
    ? [[78, 82, 86], [104, 108, 110], [58, 60, 64], [132, 134, 132]]
    : [[150, 132, 100], [118, 108, 78], [96, 84, 62], [174, 158, 124], [84, 92, 64]];
  return build(size, (u, v, x, y) => {
    const qx = x < half ? 0 : 1, qy = y < half ? 0 : 1;
    const lu = (u * 2) % 1, lv = (v * 2) % 1;
    const w = weave[0].at(u * 128, v * 128);
    const wv = (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.5 + 0.5;
    if (qx === 0 && qy === 0) {
      const a = fbm(nz, lu, lv, 4), b = fbm(nz2, lu + 0.3, lv, 8);
      let c;
      if (scheme === 'volk') c = a > 0.6 ? pal[2] : a > 0.48 ? pal[0] : b > 0.55 ? pal[3] : pal[1];
      else c = a > 0.62 ? pal[2] : a > 0.5 ? pal[1] : b > 0.6 ? pal[4] : b < 0.38 ? pal[3] : pal[0];
      const s = 0.9 + w * 0.12;
      return [c[0] * s, c[1] * s, c[2] * s, wv * 0.3 + w * 0.2, 0.9];
    }
    if (qx === 1 && qy === 0) {
      const s = 200 + w * 40 + wv * 12;
      return [s, s, s, wv * 0.4, 0.88];
    }
    if (qx === 0 && qy === 1) {
      const n = fbm(nz, lu, lv, 4);
      const s = 225 + n * 30;
      return [s, s * 0.97, s * 0.95, n * 0.15, 0.55];
    }
    const s = 190 + w * 50;
    return [s, s, s, w * 0.3, 0.75];
  }, { normal: 1.4 });
}

// Small, crisp maps for guns: subtle wear in roughness, stipple in the normal map.
export function gunWear(size) {
  const nz = makeNoises(91, 8, 4);
  const scratch = makeNoises(92, 64, 1);
  return build(size, (u, v) => {
    const n = fbm(nz, u, v, 8);
    const sc = Math.abs(Math.sin((u * 0.7 + v * 0.3) * 180 + scratch[0].at(u * 64, v * 64) * 4)) > 0.985 ? 1 : 0;
    const g = 128 + n * 60 + sc * 50;
    return [g, g, g, n * 0.2 - sc * 0.15, 0.4 + n * 0.25 - sc * 0.18];
  }, { normal: 0.8 });
}

export function stipple(size) {
  const dots = makeNoises(95, 128, 1);
  return build(size, (u, v) => {
    const d = dots[0].at(u * 128, v * 128);
    return [40, 40, 40, d, 0.8 + d * 0.1];
  }, { normal: 2.4 });
}

// A cluster of leaves on a transparent card, for alpha-tested tree crowns.
export function leafCluster(size, autumn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = mulberry(autumn ? 202 : 201);
  const greens = autumn ? ['#7a5a22', '#9a6e2a', '#6a5a28', '#8a7a34', '#5a4a1e'] : ['#3d5226', '#4a6230', '#56702f', '#34481f', '#61793a'];
  // Twigs
  g.strokeStyle = '#3a2e22';
  g.lineWidth = size / 160;
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.moveTo(size / 2, size / 2);
    g.lineTo(size * (0.1 + r() * 0.8), size * (0.1 + r() * 0.8));
    g.stroke();
  }
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * size * 0.44;
    const x = size / 2 + Math.cos(a) * d, y = size / 2 + Math.sin(a) * d;
    const l = size * (0.03 + r() * 0.025);
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI * 2);
    g.fillStyle = greens[Math.floor(r() * greens.length)];
    g.beginPath();
    g.ellipse(0, 0, l, l * 0.45, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,220,0.12)';
    g.beginPath();
    g.ellipse(-l * 0.2, -l * 0.1, l * 0.5, l * 0.18, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Striped awning canvas: one 0.6 m repeat across u (two stripes with sewn seams), a fine weave and
// a little weathering towards the top. scallopMask is the valance's alpha: two lobes per repeat.
export function awningCanvas(a, b) {
  const W = 128, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, W / 2, H);
  g.fillStyle = b; g.fillRect(W / 2, 0, W / 2, H);
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(W / 2 - 1, 0, 2, H); g.fillRect(0, 0, 1, H); g.fillRect(W - 1, 0, 1, H);
  const r = mulberry(77);
  for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(0,0,0,${(0.03 + r() * 0.04).toFixed(3)})`; g.fillRect(0, y, W, 1); }
  for (let x = 0; x < W; x += 2) { g.fillStyle = `rgba(255,255,255,${(0.02 + r() * 0.03).toFixed(3)})`; g.fillRect(x, 0, 1, H); }
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(40,30,20,0.22)'); grad.addColorStop(0.5, 'rgba(40,30,20,0.05)'); grad.addColorStop(1, 'rgba(40,30,20,0.12)');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function scallopMask() {
  const W = 128, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H * 0.45);
  for (let i = 0; i < 2; i++) {
    g.beginPath();
    g.ellipse(W / 4 + i * W / 2, H * 0.45, W / 4, H * 0.52, 0, 0, Math.PI);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Simple canvas sprites
export function spriteTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (kind === 'flash') {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,230,1)');
    grad.addColorStop(0.2, 'rgba(255,214,120,0.95)');
    grad.addColorStop(0.5, 'rgba(255,140,40,0.35)');
    grad.addColorStop(1, 'rgba(255,100,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(255,220,150,0.7)';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      g.lineWidth = 6 - (i % 3) * 1.5;
      g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); g.stroke();
    }
  } else if (kind === 'smoke') {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  } else if (kind === 'hole') {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(8,6,5,1)');
    grad.addColorStop(0.18, 'rgba(20,16,12,0.95)');
    grad.addColorStop(0.32, 'rgba(60,52,44,0.6)');
    grad.addColorStop(0.6, 'rgba(90,80,70,0.18)');
    grad.addColorStop(1, 'rgba(90,80,70,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(30,24,20,0.5)';
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * (22 + Math.random() * 20), 64 + Math.sin(a) * (22 + Math.random() * 20)); g.stroke();
    }
  } else if (kind === 'spark') {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,250,220,1)');
    grad.addColorStop(0.3, 'rgba(255,190,90,0.8)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  } else if (kind === 'blood') {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(110,10,8,0.9)');
    grad.addColorStop(0.5, 'rgba(90,8,6,0.45)');
    grad.addColorStop(1, 'rgba(80,6,5,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// GPU-baked effect sheets (linear, clamped). The flash and fire cells hold intensity in rgb and
// coverage in alpha; the effect shaders turn intensity into colour through a heat ramp.

// Smoke: four billowing fbm puffs (2 x 2) with warped, lobed edges; rgb is self-shadowing (the
// dense heart darker than the thin rim), alpha the density.
export function smokeSheet(baker) {
  return baker.raw({
    name: 'smokeSheet', size: 512, seed: 13, clamp: true,
    raw: /* glsl */`
      vec4 raw(vec2 uv) {
        vec2 cell = floor(uv * 2.0), p = fract(uv * 2.0);
        vec2 o = cell * vec2(0.37, 0.61) + cell.yx * 0.23;
        vec2 w = vec2(fbm(p + o, 3.0, 4), fbm(p + o + 5.2, 3.0, 4)) * 0.25;
        float r = length(p - 0.5 + w) * 2.0;
        float n = fbm(p + o + w * 1.5, 5.0, 5) + 0.5;
        float d = smoothstep(1.0, 0.15, r + (0.5 - n) * 0.75);
        float a = smoothstep(0.08, 0.7, d) * smoothstep(0.98, 0.84, length(p - 0.5) * 2.0);
        float lit = 0.6 + 0.4 * smoothstep(0.9, 0.2, d) + 0.12 * fbm(p + o + 9.0, 12.0, 3);
        return vec4(vec3(lit), a);
      }`,
  });
}

// Muzzle flash and fire, one 1024 sheet: four ragged stars (top left, 2 x 2), four flame tongues
// running along u from root to tip (top right, stacked), a soft glow and an ember (bottom left),
// and four fireball puffs (bottom right, 2 x 2).
export const FLASH_CELLS = {
  star: [0, 0.5, 0.25, 0.25, 2], petal: [0.5, 0.5, 0.5, 0.125, 0], glow: [0, 0.25, 0.25, 0.25, 0],
  ember: [0.25, 0.375, 0.125, 0.125, 0], fire: [0.5, 0, 0.25, 0.25, 2],
};
export function flashSheet(baker) {
  return baker.raw({
    name: 'flashSheet', size: 1024, seed: 29, clamp: true,
    raw: /* glsl */`
      vec4 star(vec2 p, float v) {
        vec2 q = (p - 0.5) * 2.0;
        float r = length(q), a = atan(q.y, q.x);
        float n = fbm(p + v * 0.31, 6.0, 4) + 0.5;
        float prong = 0.0;
        for (int i = 0; i < 7; i++) {
          float fi = float(i);
          if (fi > 3.0 + floor(v * 0.5) + mod(v, 2.0)) break;
          float ang = fi * 6.2831853 / (4.0 + floor(v * 0.5) + mod(v, 2.0)) + (hash12(vec2(fi, v)) - 0.5) * 0.7 + v;
          float len = 0.62 + 0.36 * hash12(vec2(fi, v + 7.0));
          float wid = 0.24 + 0.2 * hash12(vec2(fi, v + 3.0));
          float da = abs(mod(a - ang + 3.14159265, 6.2831853) - 3.14159265);
          float w = wid * max(0.0, 1.0 - r / len) * (0.65 + 0.7 * n);
          prong = max(prong, smoothstep(w, w * 0.2, da) * smoothstep(len, len * 0.5, r));
        }
        // a white-hot heart inside a ragged ball of flame, prongs bursting out of it
        float core = smoothstep(0.5, 0.0, r) * (0.85 + 0.3 * n);
        float body = smoothstep(0.78, 0.18, r + (0.5 - n) * 0.55) * 0.6;
        float I = max(max(core, body), prong * (0.5 + 0.6 * n) * (1.0 - r * 0.5));
        I *= smoothstep(1.0, 0.85, r);
        return vec4(vec3(clamp(I, 0.0, 1.0)), clamp(I * 1.6, 0.0, 1.0));
      }
      vec4 petal(vec2 p, float v) {
        float x = p.x, y = (p.y - 0.5) * 2.0;
        float n = fbm(vec2(x * 1.5 + v * 0.37, p.y * 0.5 + v * 0.13), vec2(6.0, 2.0), 4) + 0.5;
        float w = 0.9 * pow(max(0.0, sin(3.14159265 * pow(x, 0.65))), 0.9) * (0.65 + 0.55 * n) + 0.02;
        float body = smoothstep(w, w * 0.35, abs(y + (n - 0.5) * 0.3 * x));
        float root = smoothstep(0.16, 0.0, x) * smoothstep(0.7, 0.0, abs(y));
        float I = body * (1.0 - x * 0.7) * (0.55 + 0.55 * n) + root * 0.6;
        I *= smoothstep(1.0, 0.85, x) * smoothstep(0.0, 0.03, x);
        return vec4(vec3(clamp(I, 0.0, 1.0)), clamp(I * 1.5, 0.0, 1.0));
      }
      vec4 fire(vec2 p, float v) {
        float r = length(p - 0.5) * 2.0;
        float n = fbm(p + v * 0.29, 4.0, 5) + 0.5;
        float m = fbm(p * 2.0 + v * 0.7, 9.0, 3) + 0.5;
        float body = smoothstep(0.98, 0.35, r + (n - 0.5) * 0.55);
        float I = body * (0.35 + 0.65 * smoothstep(0.75, 0.0, r + (m - 0.5) * 0.4)) * (0.7 + 0.45 * n);
        return vec4(vec3(clamp(I, 0.0, 1.0)), clamp(body * 1.25, 0.0, 1.0) * smoothstep(1.0, 0.9, r));
      }
      vec4 raw(vec2 uv) {
        if (uv.y >= 0.5 && uv.x < 0.5) { vec2 c = floor(uv * 4.0); return star(fract(uv * 4.0), c.x + (c.y - 2.0) * 2.0 + 1.0); }
        if (uv.y >= 0.5) { float k = floor((uv.y - 0.5) * 8.0); return petal(vec2(fract(uv.x * 2.0), fract(uv.y * 8.0)), k + 1.0); }
        if (uv.x >= 0.5) { vec2 c = floor(uv * 4.0); return fire(fract(uv * 4.0), c.x + c.y * 2.0 + 1.0); }
        if (uv.y >= 0.25 && uv.x < 0.25) {
          float r = length(fract(uv * 4.0) - 0.5) * 2.0;
          float I = exp(-r * r * 3.2) * smoothstep(1.0, 0.8, r);
          return vec4(vec3(I), I);
        }
        if (uv.y >= 0.375 && uv.x < 0.375) {
          float r = length(fract(uv * 8.0) - 0.5) * 2.0;
          float I = smoothstep(1.0, 0.0, r);
          I *= I;
          return vec4(vec3(I), I);
        }
        return vec4(0.0);
      }`,
  });
}

// Grenade scorch: soot burnt into the ground, darkest in the middle, raying outwards.
export function scorchTexture(baker) {
  return baker.raw({
    name: 'scorch', size: 512, seed: 31, clamp: true,
    raw: /* glsl */`
      vec4 raw(vec2 uv) {
        vec2 q = (uv - 0.5) * 2.0;
        float r = length(q), a = atan(q.y, q.x);
        float n = fbm(uv, 5.0, 5) + 0.5;
        float rays = fbm(vec2(a / 6.2831853 + 0.5, r * 0.35), vec2(22.0, 3.0), 4) + 0.5;
        float body = smoothstep(0.9, 0.2, r + (n - 0.5) * 0.45);
        float streak = smoothstep(1.0, 0.3, r) * smoothstep(0.5, 0.8, rays);
        float alpha = clamp(body * 0.92 + streak * 0.55, 0.0, 1.0) * smoothstep(1.0, 0.8, r);
        vec3 c = mix(vec3(0.012, 0.011, 0.01), vec3(0.06, 0.052, 0.045), smoothstep(0.25, 0.85, r));
        float ash = smoothstep(0.14, 0.32, fbm(uv + 2.0, 14.0, 3)) * smoothstep(0.6, 0.15, r);
        c = mix(c, vec3(0.16, 0.15, 0.14), ash * 0.55);
        return vec4(c, alpha);
      }`,
  });
}

// Text decal (serial numbers, markings) on a transparent background.
export function textDecal(lines, w = 512, h = 128, color = 'rgba(210,210,200,0.75)') {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.textBaseline = 'middle';
  const lh = h / lines.length;
  lines.forEach(function (l, i) {
    g.font = (l.size || 0.5) * lh + 'px ' + (l.font || 'monospace');
    g.fillText(l.text, l.x || 8, lh * (i + 0.5));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Normal map from a height drawn into a canvas (white = raised).
function canvasHeightToNormal(c, strength) {
  const w = c.width, h = c.height;
  const src = c.getContext('2d').getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = src[i * 4] / 255;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1);
    const dx = (H[y * w + xr] - H[y * w + xl]) * strength, dy = (H[yd * w + x] - H[yu * w + x]) * strength;
    let nx = -dx, ny = dy, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const i = (y * w + x) * 4;
    out[i] = (nx / l * 0.5 + 0.5) * 255; out[i + 1] = (ny / l * 0.5 + 0.5) * 255; out[i + 2] = (nz / l * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  const o = document.createElement('canvas');
  o.width = w; o.height = h;
  o.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  const t = new THREE.CanvasTexture(o);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

// Tyre sidewall lettering and ribs, laid out for a ring with planar UVs.
export function sidewallNormal(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  const cx = size / 2;
  // concentric ribs near the rim and the tread shoulder
  g.strokeStyle = '#5a5a5a'; g.lineWidth = size * 0.003;
  for (const r of [0.33, 0.345, 0.47, 0.485]) { g.beginPath(); g.arc(cx, cx, r * size, 0, Math.PI * 2); g.stroke(); }
  const ring = (text, r, px, start) => {
    g.save();
    g.translate(cx, cx);
    g.font = '700 ' + px + 'px "Arial Narrow", Arial, sans-serif';
    g.fillStyle = '#d8d8d8';
    let a = start;
    for (const ch of text) {
      const w = g.measureText(ch).width;
      a += (w / 2) / (r * size);
      g.save(); g.rotate(a); g.translate(0, -r * size); g.fillText(ch, -w / 2, px * 0.35); g.restore();
      a += (w / 2) / (r * size) + 0.004;
    }
    g.restore();
  };
  ring('MERIDIAN  ·  RADIAL  M+S', 0.41, size * 0.05, -0.6);
  ring('165/80 R13  82T  ·  TUBELESS', 0.41, size * 0.034, 2.35);
  g.filter = 'blur(' + (size * 0.0012) + 'px)';
  g.drawImage(c, 0, 0);
  return canvasHeightToNormal(c, 3);
}

// Fluted prism pattern for lamp lenses.
export function flutedNormal(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const n = 12;
  for (let i = 0; i < n; i++) {
    const grad = g.createLinearGradient(i * size / n, 0, (i + 1) * size / n, 0);
    grad.addColorStop(0, '#000'); grad.addColorStop(0.5, '#fff'); grad.addColorStop(1, '#000');
    g.fillStyle = grad; g.fillRect(i * size / n, 0, size / n, size);
  }
  g.globalCompositeOperation = 'multiply';
  for (let j = 0; j < 6; j++) {
    const grad = g.createLinearGradient(0, j * size / 6, 0, (j + 1) * size / 6);
    grad.addColorStop(0, '#888'); grad.addColorStop(0.5, '#fff'); grad.addColorStop(1, '#888');
    g.fillStyle = grad; g.fillRect(0, j * size / 6, size, size / 6);
  }
  const t = canvasHeightToNormal(c, 1.5);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Licence plate in the old Soviet style: black characters on white, with a pressed border.
export function plateTexture(text, region) {
  const c = document.createElement('canvas');
  c.width = 520; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = '#e6e3d8'; g.fillRect(0, 0, 520, 112);
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 6; g.strokeRect(6, 6, 508, 100);
  g.fillStyle = '#141414';
  g.font = '700 74px "DejaVu Sans Mono", "Courier New", monospace';
  g.textBaseline = 'middle';
  g.fillText(text, 26, 60);
  g.font = '700 30px "DejaVu Sans Mono", monospace';
  g.fillText(region, 430, 40);
  g.fillText('SU', 440, 82);
  // grime and rust at the bolts
  for (const x of [60, 460]) { g.fillStyle = 'rgba(90,50,20,0.6)'; g.beginPath(); g.arc(x, 18, 7, 0, Math.PI * 2); g.fill(); }
  const grad = g.createLinearGradient(0, 0, 0, 112);
  grad.addColorStop(0, 'rgba(60,50,40,0.05)'); grad.addColorStop(1, 'rgba(60,50,40,0.35)');
  g.fillStyle = grad; g.fillRect(0, 0, 520, 112);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
