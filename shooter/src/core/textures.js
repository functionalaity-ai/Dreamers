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

function hexToRgb(h) {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}

// Tileable Voronoi: returns { f1, f2, id } distances in cell units.
function voronoiSetup(seed, n) {
  const r = mulberry(seed);
  const pts = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push([i + 0.15 + r() * 0.7, j + 0.15 + r() * 0.7, r()]);
  return { n, pts };
}
function voronoi(vs, u, v) {
  const n = vs.n;
  const x = u * n, y = v * n;
  const ci = Math.floor(x), cj = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      const wi = ((i % n) + n) % n, wj = ((j % n) + n) % n;
      const pt = vs.pts[wj * n + wi];
      const px = pt[0] + (i - wi), py = pt[1] + (j - wj);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; id = pt[2]; } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, id };
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

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------
export function cobblestone(size) {
  const vs = voronoiSetup(11, 10);
  const nz = makeNoises(3, 4, 5);
  const fine = makeNoises(9, 32, 2);
  return build(size, (u, v) => {
    const c = voronoi(vs, u, v);
    const edge = c.f2 - c.f1;
    const stone = clamp(edge * 6, 0, 1);
    const dome = Math.sqrt(stone);
    const n = fbm(nz, u, v, 4), f = fbm(fine, u, v, 32);
    const tint = c.id;
    const base = [mix(122, 160, tint), mix(110, 144, tint), mix(92, 120, tint)];
    const grout = [58, 54, 50];
    const k = stone > 0.08 ? 1 : 0;
    const shade = 0.75 + n * 0.35 + f * 0.12;
    const cav = 0.55 + dome * 0.45;
    const col = k ? base.map((x) => x * shade * cav) : grout.map((x) => x * (0.8 + f * 0.4));
    return [col[0], col[1], col[2], dome * 0.9 + f * 0.08, k ? 0.62 + n * 0.25 : 0.95];
  }, { normal: 3.2 });
}

export function brick(size, tint = 0) {
  const rows = 16, cols = 4;
  const nz = makeNoises(5 + tint, 8, 4);
  const fine = makeNoises(15, 64, 2);
  const r = mulberry(77 + tint);
  const shades = [];
  for (let i = 0; i < rows * cols * 2; i++) shades.push(r());
  return build(size, (u, v) => {
    const row = Math.floor(v * rows);
    const off = row % 2 ? 0.5 / cols : 0;
    const cu = ((u + off) % 1) * cols;
    const col = Math.floor(cu);
    const fu = cu - col, fv = v * rows - row;
    const mortar = fu < 0.03 || fv < 0.11;
    const sh = shades[(row * cols + col) % shades.length];
    const n = fbm(nz, u, v, 8), f = fbm(fine, u, v, 64);
    if (mortar) {
      const m = 150 + f * 40;
      return [m * 0.95, m * 0.92, m * 0.86, 0.1 + f * 0.05, 0.95];
    }
    const base = tint ? [mix(120, 165, sh), mix(104, 140, sh), mix(88, 110, sh)] : [mix(130, 170, sh), mix(62, 86, sh), mix(46, 60, sh)];
    const s = 0.78 + n * 0.32 + f * 0.1;
    return [base[0] * s, base[1] * s, base[2] * s, 0.6 + n * 0.25 + f * 0.1, 0.8 + f * 0.15];
  }, { normal: 2.6 });
}

export function plaster(size, color = 0xd9c9a8, seed = 1) {
  const rgb = hexToRgb(color);
  const nz = makeNoises(20 + seed, 4, 5);
  const fine = makeNoises(40 + seed, 64, 2);
  const stain = makeNoises(60 + seed, 2, 3);
  return build(size, (u, v) => {
    const n = fbm(nz, u, v, 4), f = fbm(fine, u, v, 64);
    const st = fbm(stain, u, v * 0.5, 2);
    // Water streaks running down from the top of each tile.
    const streak = Math.max(0, st - 0.55) * 2.2 * (1 - v * 0.6);
    const chip = n > 0.8 ? 1 : 0;
    const s = (0.86 + n * 0.18 + f * 0.06) * (1 - streak * 0.35);
    let c = rgb.map((x) => x * s);
    if (chip) c = [c[0] * 0.9, c[1] * 0.86, c[2] * 0.82];
    return [c[0], c[1], c[2], n * 0.35 + f * 0.25 - chip * 0.3, 0.88 + f * 0.1];
  }, { normal: 1.6 });
}

export function concrete(size, tone = 1) {
  const nz = makeNoises(31, 4, 5);
  const fine = makeNoises(32, 64, 2);
  const pores = makeNoises(33, 128, 1);
  return build(size, (u, v) => {
    const n = fbm(nz, u, v, 4), f = fbm(fine, u, v, 64), p = pores[0].at(u * 128, v * 128);
    const pit = p > 0.86 ? 1 : 0;
    const g = (120 + n * 50 + f * 18 - pit * 30) * tone;
    return [g * 1.0, g * 0.98, g * 0.94, n * 0.3 + f * 0.2 - pit * 0.4, 0.82 + f * 0.12];
  }, { normal: 1.8 });
}

export function asphalt(size) {
  const nz = makeNoises(41, 8, 4);
  const grit = makeNoises(42, 256, 1);
  return build(size, (u, v) => {
    const n = fbm(nz, u, v, 8), g = grit[0].at(u * 256, v * 256);
    const stone = g > 0.78 ? (g - 0.78) * 4 : 0;
    const c = 44 + n * 22 + stone * 60;
    return [c, c * 0.98, c * 0.96, n * 0.2 + stone * 0.6, 0.86 - stone * 0.2];
  }, { normal: 2 });
}

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

// One facade bay (3.5 m wide x 3.4 m tall): plaster wall with a shuttered window.
export function facadeBay(size, wall = 0xcdb894, shutter = 0x4f6a52, seed = 1) {
  const pl = plaster(size, wall, seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.drawImage(pl.map.image, 0, 0);
  const W = size, s = size / 3.5;
  const wx = 1.1 * s, wy = 0.7 * s, ww = 1.3 * s, wh = 1.8 * s;
  // Frame and sill
  g.fillStyle = '#e9e2d2';
  g.fillRect(wx - 0.09 * s, wy - 0.09 * s, ww + 0.18 * s, wh + 0.18 * s);
  g.fillStyle = '#bdb3a0';
  g.fillRect(wx - 0.16 * s, wy + wh + 0.06 * s, ww + 0.32 * s, 0.09 * s);
  // Glass with a sky reflection
  const grad = g.createLinearGradient(0, wy, 0, wy + wh);
  grad.addColorStop(0, '#5b6f80');
  grad.addColorStop(0.45, '#2c3640');
  grad.addColorStop(1, '#1a1f24');
  g.fillStyle = grad;
  g.fillRect(wx, wy, ww, wh);
  g.fillStyle = 'rgba(255,240,210,0.12)';
  g.beginPath(); g.moveTo(wx, wy + wh * 0.2); g.lineTo(wx + ww * 0.5, wy); g.lineTo(wx + ww * 0.75, wy); g.lineTo(wx, wy + wh * 0.6); g.fill();
  g.fillStyle = '#e9e2d2';
  g.fillRect(wx + ww / 2 - 0.03 * s, wy, 0.06 * s, wh);
  g.fillRect(wx, wy + wh * 0.38, ww, 0.05 * s);
  // Shutters (louvred)
  const sc = '#' + shutter.toString(16).padStart(6, '0');
  for (const sx of [wx - 0.62 * s, wx + ww + 0.08 * s]) {
    g.fillStyle = sc;
    g.fillRect(sx, wy - 0.04 * s, 0.54 * s, wh + 0.08 * s);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let k = wy; k < wy + wh; k += 0.08 * s) g.fillRect(sx + 0.04 * s, k, 0.46 * s, 0.025 * s);
  }
  // Floor band
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.fillRect(0, W - 0.12 * s, W, 0.12 * s);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  // Height/roughness from a second canvas so frames protrude and glass is glossy.
  const hc = document.createElement('canvas');
  hc.width = hc.height = size;
  const hg = hc.getContext('2d');
  hg.fillStyle = '#e0e0e0'; hg.fillRect(0, 0, W, W);
  hg.fillStyle = '#ffffff'; hg.fillRect(wx - 0.09 * s, wy - 0.09 * s, ww + 0.18 * s, wh + 0.18 * s);
  hg.fillStyle = '#202020'; hg.fillRect(wx, wy, ww, wh);
  const rough = new THREE.CanvasTexture(hc);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  return { map, normalMap: pl.normalMap, roughnessMap: rough };
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
