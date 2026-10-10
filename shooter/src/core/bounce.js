// Baked bounce light. The sun never moves, so once the town is built we gather, over the whole
// map, how much sky each point sees and how much sunlight comes back off the surfaces around it.
// The world shaders add it as indirect light (GI_FRAG in shaderlib.js).
//
//   probes  2 m apart across the map, one layer per storey (3.4 m) from 1.7 m up, so each floor
//           of the enterable buildings has its own layer and ceilings keep the sky out
//   rays    a spherical Fibonacci set, turned about y per probe, traced against the physics boxes
//           (sorted into their own 3D grid, so a ray only tests the boxes it passes)
//   albedo  every world triangle splats its material's average colour into a 1 m grid; a hit
//           reads the cell just behind the surface, so plaster, brick and asphalt bounce as such
//   hits    a sunlit hit returns sun x albedo x cos, plus the indoor lamps' light; walls also
//           return some skylight; open ground (any open upward face) counts as sky, since the
//           environment map already has a ground below the horizon; a multi-bounce factor per
//           probe stands in for the light that keeps going round a street or a room
//   output  three half-float 3D textures, linearly filtered (L0 = mean, L1 = mean x direction):
//           0  bounce radiance L0 (rgb) + sky visibility L0
//           1  bounce L1 over its luminance
//           2  sky visibility L1
//
// The work runs in slices of ~30 ms between loading-screen frames.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SHARED, giPatch } from './shaderlib.js';

const QUALITY = {
  Mobile: { step: 3, layers: 4, rays: 20 },
  Medium: { step: 2, layers: 5, rays: 24 },
  High: { step: 2, layers: 5, rays: 32 },
  Ultra: { step: 2, layers: 5, rays: 48 },
};
const LAYER = 3.4;    // storey height of the hotel and the pharmacy
const CELL = 2;       // ray grid cell (m)
const SLICE = 30;     // ms of work before letting a frame through
const MAX_T = 90;     // a ray that runs this far without a hit is sky
// Skylight on a wall, as a share of the interior ambient (SHARED.ambW). An open wall gets about
// twice ambW from the sky and the hemisphere light; a street's walls see roughly half the sky.
const WALL_SKY = 0.8;
// Share of the light reflected inside a street or room that comes back round (multi-bounce).
const MULTI = 0.9;
// Albedo by collider tag, for the rare hit with no render surface behind it.
const TAG_ALBEDO = { brick: [0.42, 0.3, 0.2], concrete: [0.36, 0.35, 0.33], stone: [0.33, 0.32, 0.3], plaster: [0.6, 0.57, 0.52], wood: [0.25, 0.17, 0.11], metal: [0.15, 0.15, 0.15], sandbag: [0.34, 0.29, 0.21], glass: [0.06, 0.06, 0.06], ground: [0.16, 0.15, 0.14] };

const now = () => performance.now();
const pause = () => new Promise((r) => setTimeout(r, 0));

// --- ray grid -------------------------------------------------------------------------------
class BoxGrid {
  constructor(physics) {
    const list = physics.boxes.filter((b) => !(b.flags && b.flags.boundary));
    const n = list.length;
    const bx = new Float32Array(n * 6);
    let top = 2;
    list.forEach((b, i) => {
      bx[i * 6] = b.min[0]; bx[i * 6 + 1] = b.min[1]; bx[i * 6 + 2] = b.min[2];
      bx[i * 6 + 3] = b.max[0]; bx[i * 6 + 4] = b.max[1]; bx[i * 6 + 5] = b.max[2];
      top = Math.max(top, b.max[1]);
    });
    this.bx = bx;
    this.tag = list.map((b) => b.mat);
    this.x0 = physics.minX; this.z0 = physics.minZ; this.y0 = 0;
    const nx = this.nx = Math.ceil((physics.maxX - physics.minX) / CELL);
    const nz = this.nz = Math.ceil((physics.maxZ - physics.minZ) / CELL);
    const ny = this.ny = Math.ceil(Math.min(top, 60) / CELL);
    this.x1 = this.x0 + nx * CELL; this.y1 = ny * CELL; this.z1 = this.z0 + nz * CELL;
    const span = (lo, hi, o, m) => [Math.max(0, Math.min(m - 1, Math.floor((lo - o) / CELL))), Math.max(0, Math.min(m - 1, Math.floor((hi - o) / CELL)))];
    const ranges = new Int32Array(n * 6);
    const count = new Int32Array(nx * ny * nz + 1);
    for (let i = 0; i < n; i++) {
      const [a0, a1] = span(bx[i * 6], bx[i * 6 + 3], this.x0, nx);
      const [b0, b1] = span(bx[i * 6 + 1], bx[i * 6 + 4], 0, ny);
      const [c0, c1] = span(bx[i * 6 + 2], bx[i * 6 + 5], this.z0, nz);
      ranges.set([a0, a1, b0, b1, c0, c1], i * 6);
      for (let z = c0; z <= c1; z++) for (let y = b0; y <= b1; y++) for (let x = a0; x <= a1; x++) count[(z * ny + y) * nx + x + 1]++;
    }
    for (let c = 1; c < count.length; c++) count[c] += count[c - 1];
    const items = new Int32Array(count[count.length - 1]);
    const fill = count.slice(0, count.length - 1);
    for (let i = 0; i < n; i++) {
      const r = ranges.subarray(i * 6, i * 6 + 6);
      for (let z = r[4]; z <= r[5]; z++) for (let y = r[2]; y <= r[3]; y++) for (let x = r[0]; x <= r[1]; x++) items[fill[(z * ny + y) * nx + x]++] = i;
    }
    this.start = count;
    this.items = items;
    this.mail = new Uint32Array(n);
    this.stamp = 0;
    // last hit: t, axis, normal sign, box (-1 = the ground plane)
    this.t = 0; this.axis = 0; this.sign = 1; this.box = -1;
  }

  // Walks the cells along o + d t and tests their boxes. any: stop at the first hit.
  // Returns true on a hit (filling t/axis/sign/box); the ground plane y = 0 counts.
  cast(ox, oy, oz, dx, dy, dz, tMax, any) {
    if (dx > -1e-9 && dx < 1e-9) dx = 1e-9;
    if (dy > -1e-9 && dy < 1e-9) dy = 1e-9;
    if (dz > -1e-9 && dz < 1e-9) dz = 1e-9;
    let tEnd = tMax, ground = false;
    if (dy < 0) { const tg = -oy / dy; if (tg < tEnd) { tEnd = tg; ground = true; } }
    const idx = 1 / dx, idy = 1 / dy, idz = 1 / dz;
    let t0 = 0, t1 = tEnd, a, b;
    a = (this.x0 - ox) * idx; b = (this.x1 - ox) * idx; if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
    a = (this.y0 - oy) * idy; b = (this.y1 - oy) * idy; if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
    a = (this.z0 - oz) * idz; b = (this.z1 - oz) * idz; if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
    let best = tEnd, bestBox = -1, bestAxis = 1;
    if (t0 <= t1) {
      const nx = this.nx, ny = this.ny, nz = this.nz, bx = this.bx, start = this.start, items = this.items, mail = this.mail;
      let stamp = ++this.stamp;
      if (stamp >= 0xfffffff0) { mail.fill(0); stamp = this.stamp = 1; }
      const px = ox + dx * t0, py = oy + dy * t0, pz = oz + dz * t0;
      let ix = Math.max(0, Math.min(nx - 1, Math.floor((px - this.x0) / CELL)));
      let iy = Math.max(0, Math.min(ny - 1, Math.floor(py / CELL)));
      let iz = Math.max(0, Math.min(nz - 1, Math.floor((pz - this.z0) / CELL)));
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      let tmx = (this.x0 + (ix + (dx > 0 ? 1 : 0)) * CELL - ox) * idx;
      let tmy = ((iy + (dy > 0 ? 1 : 0)) * CELL - oy) * idy;
      let tmz = (this.z0 + (iz + (dz > 0 ? 1 : 0)) * CELL - oz) * idz;
      const tdx = CELL * Math.abs(idx), tdy = CELL * Math.abs(idy), tdz = CELL * Math.abs(idz);
      for (;;) {
        const c = (iz * ny + iy) * nx + ix;
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          const i = items[k];
          if (mail[i] === stamp) continue;
          mail[i] = stamp;
          const o = i * 6;
          let tn = (bx[o] - ox) * idx, tf = (bx[o + 3] - ox) * idx, ax = 0;
          if (tn > tf) { const s = tn; tn = tf; tf = s; }
          let u = (bx[o + 1] - oy) * idy, w = (bx[o + 4] - oy) * idy;
          if (u > w) { const s = u; u = w; w = s; }
          if (u > tn) { tn = u; ax = 1; }
          if (w < tf) tf = w;
          u = (bx[o + 2] - oz) * idz; w = (bx[o + 5] - oz) * idz;
          if (u > w) { const s = u; u = w; w = s; }
          if (u > tn) { tn = u; ax = 2; }
          if (w < tf) tf = w;
          if (tn <= tf && tn > 1e-4 && tn < best) {
            best = tn; bestBox = i; bestAxis = ax;
            if (any) { this.t = best; this.box = i; return true; }
          }
        }
        const tExit = Math.min(tmx, tmy, tmz);
        if (best <= tExit || tExit >= t1) break;
        if (tmx <= tmy && tmx <= tmz) { ix += sx; if (ix < 0 || ix >= nx) break; tmx += tdx; } else if (tmy <= tmz) { iy += sy; if (iy < 0 || iy >= ny) break; tmy += tdy; } else { iz += sz; if (iz < 0 || iz >= nz) break; tmz += tdz; }
      }
    }
    if (bestBox >= 0) {
      this.t = best; this.box = bestBox; this.axis = bestAxis;
      this.sign = (bestAxis === 0 ? dx : bestAxis === 1 ? dy : dz) > 0 ? -1 : 1;
      return true;
    }
    if (ground) { this.t = tEnd; this.box = -1; this.axis = 1; this.sign = 1; return true; }
    return false;
  }

  inside(x, y, z, m) {
    const ix = Math.floor((x - this.x0) / CELL), iy = Math.floor(y / CELL), iz = Math.floor((z - this.z0) / CELL);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) return false;
    const c = (iz * this.ny + iy) * this.nx + ix, bx = this.bx;
    for (let k = this.start[c], e = this.start[c + 1]; k < e; k++) {
      const o = this.items[k] * 6;
      if (x > bx[o] - m && x < bx[o + 3] + m && y > bx[o + 1] - m && y < bx[o + 4] + m && z > bx[o + 2] - m && z < bx[o + 5] + m) return true;
    }
    return false;
  }
}

// --- albedo grid ----------------------------------------------------------------------------
// 1 m cells from y = -1 (the ground's own top face sits just below 0).
class AlbedoGrid {
  constructor(x0, z0, nx, nz, ny) {
    Object.assign(this, { x0, z0, nx, nz, ny, y0: -1 });
    this.acc = new Float32Array(nx * ny * nz * 4);
  }
  index(x, y, z) {
    const ix = Math.floor(x - this.x0), iy = Math.floor(y - this.y0), iz = Math.floor(z - this.z0);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) return -1;
    return ((iz * this.ny + iy) * this.nx + ix) * 4;
  }
  add(x, y, z, r, g, b, w) {
    const i = this.index(x, y, z);
    if (i < 0) return;
    const a = this.acc;
    a[i] += r * w; a[i + 1] += g * w; a[i + 2] += b * w; a[i + 3] += w;
  }
  finish() {
    const a = this.acc;
    for (let i = 0; i < a.length; i += 4) if (a[i + 3] > 0) { const k = 1 / a[i + 3]; a[i] *= k; a[i + 1] *= k; a[i + 2] *= k; }
  }
  // Mean albedo of the cell (false if nothing was splatted there).
  get(x, y, z, out) {
    const i = this.index(x, y, z);
    if (i < 0 || this.acc[i + 3] <= 0) return false;
    out[0] = this.acc[i]; out[1] = this.acc[i + 1]; out[2] = this.acc[i + 2];
    return true;
  }
}

// Average colour of each texture (linear) and how much of it is opaque. Image-data textures are
// averaged here on the CPU; the rest (baked surfaces, canvases, whose CPU readback would stall
// the same way) are drawn small, side by side, into one target and read back once.
function textureMeans(renderer, textures) {
  const out = new Map(), gpu = [];
  const s2l = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const average = (d, step, srgb) => {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * step) {
      const w = d[i + 3] / 255;
      r += (srgb ? s2l(d[i]) : d[i] / 255) * w; g += (srgb ? s2l(d[i + 1]) : d[i + 1] / 255) * w; b += (srgb ? s2l(d[i + 2]) : d[i + 2] / 255) * w;
      a += w; n++;
    }
    return a > 0 ? { r: r / a, g: g / a, b: b / a, a: a / n } : { r: 0.5, g: 0.5, b: 0.5, a: 0 };
  };
  for (const t of textures) {
    const img = t.image, srgb = t.colorSpace === THREE.SRGBColorSpace;
    // (canvases go to the GPU too: reading one back on the CPU stalls just the same)
    if (img && img.data && img.width) out.set(t, average(img.data, 7, srgb));
    else gpu.push(t);
  }
  if (!gpu.length) return out;
  const S = 16;
  const rt = new THREE.WebGLRenderTarget(S * gpu.length, S, { depthBuffer: false });
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, lod: { value: 0 } },
    vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D map;\nuniform float lod;\nvarying vec2 vUv;\nvoid main() { vec4 c = textureLod(map, vUv, lod); gl_FragColor = vec4(sqrt(clamp(c.rgb, 0.0, 1.0)), c.a); }',
  });
  const quad = new FullScreenQuad(mat);
  const prev = renderer.getRenderTarget(), clear = renderer.autoClear;
  renderer.autoClear = false; // each block is drawn whole; a clear would wipe the others
  gpu.forEach((t, i) => {
    const img = t.image || {};
    mat.uniforms.map.value = t;
    mat.uniforms.lod.value = Math.max(0, Math.log2(Math.max(img.width || 256, img.height || 256) / S));
    rt.viewport.set(i * S, 0, S, S);
    renderer.setRenderTarget(rt);
    quad.render(renderer);
  });
  renderer.autoClear = clear;
  const buf = new Uint8Array(S * gpu.length * S * 4);
  const tr = now();
  renderer.readRenderTargetPixels(rt, 0, 0, S * gpu.length, S, buf);
  out.readMs = now() - tr;
  renderer.setRenderTarget(prev);
  gpu.forEach((t, i) => {
    // the values were written as sqrt(linear)
    let r = 0, g = 0, b = 0, a = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const o = (y * S * gpu.length + i * S + x) * 4, w = buf[o + 3] / 255;
        r += (buf[o] / 255) ** 2 * w; g += (buf[o + 1] / 255) ** 2 * w; b += (buf[o + 2] / 255) ** 2 * w; a += w;
      }
    }
    out.set(t, a > 0 ? { r: r / a, g: g / a, b: b / a, a: a / (S * S) } : { r: 0.5, g: 0.5, b: 0.5, a: 0 });
  });
  quad.dispose(); mat.dispose(); rt.dispose();
  return out;
}

// Diffuse albedo of a material as seen from a few metres away, and how much of it is there.
function albedoOf(mat, means) {
  const c = mat.color ? mat.color.clone() : new THREE.Color(0.5, 0.5, 0.5);
  let cover = 1;
  if (mat.map && means.has(mat.map)) { const m = means.get(mat.map); c.r *= m.r; c.g *= m.g; c.b *= m.b; cover = m.a; }
  const e = mat.userData.enhance || {};
  if (e.glass || e.interior || mat.transparent) c.multiplyScalar(0.25); // glass is mostly mirror
  else if (!mat.metalnessMap && mat.metalness > 0.5) c.multiplyScalar(1.1 - mat.metalness); // bare metal has little diffuse
  if (mat.vertexColors) c.multiplyScalar(0.6);
  if (mat.alphaMap) cover *= 0.6;
  c.multiplyScalar(0.85); // the weather pass darkens most surfaces a little
  return { c, cover };
}

const _m = new THREE.Matrix4();

// Splats one mesh's triangles into the albedo grid, area-weighted, a hair behind each face.
// Big triangles are split so every half square metre lands in its own cell; small ones are
// sampled (kept in proportion to their area, weighted back up), since there are a great many.
function splatMesh(A, mesh, alb, rnd) {
  const g = mesh.geometry, pos = g.attributes.position;
  if (!pos || pos.isInterleavedBufferAttribute) return 0;
  const idx = g.index ? g.index.array : null, P = pos.array;
  const tris = idx ? idx.length / 3 : pos.count / 3;
  mesh.updateWorldMatrix(true, false);
  const count = mesh.isInstancedMesh ? mesh.count : 1;
  const IM = mesh.isInstancedMesh ? mesh.instanceMatrix.array : null, IC = mesh.instanceColor ? mesh.instanceColor.array : null;
  const SMALL = 0.02, w0 = alb.cover;
  for (let inst = 0; inst < count; inst++) {
    if (IM) _m.fromArray(IM, inst * 16).premultiply(mesh.matrixWorld); else _m.copy(mesh.matrixWorld);
    const e = _m.elements;
    let r = alb.c.r, gg = alb.c.g, bb = alb.c.b;
    if (IC) { r *= IC[inst * 3]; gg *= IC[inst * 3 + 1]; bb *= IC[inst * 3 + 2]; }
    for (let t = 0; t < tris; t++) {
      const i0 = (idx ? idx[t * 3] : t * 3) * 3, i1 = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3, i2 = (idx ? idx[t * 3 + 2] : t * 3 + 2) * 3;
      let x = P[i0], y = P[i0 + 1], z = P[i0 + 2];
      const ax = e[0] * x + e[4] * y + e[8] * z + e[12], ay = e[1] * x + e[5] * y + e[9] * z + e[13], az = e[2] * x + e[6] * y + e[10] * z + e[14];
      x = P[i1]; y = P[i1 + 1]; z = P[i1 + 2];
      const ux = e[0] * x + e[4] * y + e[8] * z + e[12] - ax, uy = e[1] * x + e[5] * y + e[9] * z + e[13] - ay, uz = e[2] * x + e[6] * y + e[10] * z + e[14] - az;
      x = P[i2]; y = P[i2 + 1]; z = P[i2 + 2];
      const vx = e[0] * x + e[4] * y + e[8] * z + e[12] - ax, vy = e[1] * x + e[5] * y + e[9] * z + e[13] - ay, vz = e[2] * x + e[6] * y + e[10] * z + e[14] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz), area = len * 0.5;
      if (area < 1e-7) continue;
      const k = 0.04 / len, ox = nx * k, oy = ny * k, oz = nz * k;
      if (area < SMALL) {
        if (rnd() * SMALL > area) continue;
        A.add(ax + (ux + vx) / 3 - ox, ay + (uy + vy) / 3 - oy, az + (uz + vz) / 3 - oz, r, gg, bb, SMALL * w0);
        continue;
      }
      const m = area > 0.5 ? Math.min(40, Math.ceil(Math.sqrt(area / 0.5))) : 1;
      const w = area / (m * m) * w0;
      for (let i = 0; i < m; i++) {
        for (let j = 0; j < m - i; j++) {
          // the upright sub-triangle at (i, j), and the inverted one beside it
          for (let q = 0; q < (j < m - i - 1 ? 2 : 1); q++) {
            const a = (i + (q ? 2 : 1) / 3) / m, b = (j + (q ? 2 : 1) / 3) / m;
            A.add(ax + ux * a + vx * b - ox, ay + uy * a + vy * b - oy, az + uz * a + vz * b - oz, r, gg, bb, w);
          }
        }
      }
    }
  }
  return tris * count;
}

// Spherical Fibonacci directions: even coverage for any count.
function sphereDirs(n) {
  const d = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963229728653;
    d[i * 3] = Math.cos(a) * r; d[i * 3 + 1] = y; d[i * 3 + 2] = Math.sin(a) * r;
  }
  return d;
}

function texture3D(data, nx, ny, nz) {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const t = new THREE.Data3DTexture(half, nx, ny, nz);
  t.format = THREE.RGBAFormat;
  t.type = THREE.HalfFloatType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

// The baked volume, kept on the CPU too so the first-person weapon can be lit from it.
class LightVolume {
  constructor(x0, z0, step, nx, ny, nz, t0) {
    Object.assign(this, { x0, z0, step, nx, ny, nz, t0 });
  }
  // Trilinear sample of the L0 terms at p: { vis, r, g, b } (bounce as irradiance).
  sample(p, out = {}) {
    const fx = Math.max(0, Math.min(this.nx - 1, (p.x - this.x0) / this.step - 0.5));
    const fy = Math.max(0, Math.min(this.ny - 1, p.y / LAYER - 0.5));
    const fz = Math.max(0, Math.min(this.nz - 1, (p.z - this.z0) / this.step - 0.5));
    const ix = Math.min(this.nx - 2, Math.floor(fx)), iy = Math.min(this.ny - 2, Math.floor(fy)), iz = Math.min(this.nz - 2, Math.floor(fz));
    const ux = fx - ix, uy = fy - iy, uz = fz - iz;
    let v = 0, r = 0, g = 0, b = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
      const w = (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
      const i = (((iz + dz) * this.ny + iy + dy) * this.nx + ix + dx) * 4;
      r += this.t0[i] * w; g += this.t0[i + 1] * w; b += this.t0[i + 2] * w; v += this.t0[i + 3] * w;
    }
    out.vis = v; out.r = r * Math.PI; out.g = g * Math.PI; out.b = b * Math.PI;
    return out;
  }
}

// Bakes the volume and switches the world over to it. onProgress(0..1) feeds the loading bar.
export async function bakeBounce(R, game, preset, onProgress) {
  if (!R.r.capabilities.isWebGL2) return null;
  const T0 = now();
  const Q = QUALITY[preset && preset.name] || QUALITY.High;
  const ph = game.physics;
  const G = new BoxGrid(ph);
  const progress = (t) => { if (onProgress) onProgress(Math.min(1, t)); };

  // Albedo: the world's merged meshes and the window kit.
  const roots = [game.map.group, R.scene.getObjectByName('windows')].filter(Boolean);
  const meshes = [];
  for (const root of roots) root.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.material && !Array.isArray(o.material)) meshes.push(o); });
  const maps = new Set();
  for (const m of meshes) if (m.material.map) maps.add(m.material.map);
  const means = textureMeans(R.r, maps);
  const Tm = now();
  const A = new AlbedoGrid(ph.minX, ph.minZ, Math.ceil(ph.maxX - ph.minX), Math.ceil(ph.maxZ - ph.minZ), 41);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let tris = 0, t = now();
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    tris += splatMesh(A, m, albedoOf(m.material, means), rnd);
    if (now() - t > SLICE) { progress(0.15 * i / meshes.length); await pause(); t = now(); }
  }
  A.finish();
  const T1 = now();

  // Probes
  const step = Q.step, nx = Math.ceil((ph.maxX - ph.minX) / step), nz = Math.ceil((ph.maxZ - ph.minZ) / step), ny = Q.layers;
  const N = nx * ny * nz, R0 = Q.rays;
  const dirs = sphereDirs(R0);
  const out0 = new Float32Array(N * 4), out1 = new Float32Array(N * 4), out2 = new Float32Array(N * 4);
  const valid = new Uint8Array(N);
  const L = SHARED.sunDirW.value, sun = SHARED.sunColorW.value, amb = SHARED.ambW.value;
  const Lx = L.x, Ly = L.y, Lz = L.z;
  // clouds hide the sun for part of the time; the bake sees the average
  const sunR = sun.r * 0.9, sunG = sun.g * 0.9, sunB = sun.b * 0.9;
  const alb = [0, 0, 0];
  const lamps = [];
  R.scene.traverse((o) => {
    if (!o.isPointLight || !o.visible || o.intensity <= 0) return;
    o.updateWorldMatrix(true, false);
    const q = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    lamps.push({ x: q.x, y: q.y, z: q.z, r: o.color.r * o.intensity, g: o.color.g * o.intensity, b: o.color.b * o.intensity, cut2: (o.distance || 40) ** 2, decay: o.decay });
  });
  const moves = [];
  for (const d of [0.3, 0.6, 0.9]) for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) moves.push([x * d, y * d, z * d]);
  let rays = 0;
  t = now();
  for (let p = 0; p < N; p++) {
    const ix = p % nx, iy = Math.floor(p / nx) % ny, iz = Math.floor(p / (nx * ny));
    let px = ph.minX + (ix + 0.5) * step, py = (iy + 0.5) * LAYER, pz = ph.minZ + (iz + 0.5) * step;
    // a probe inside a wall moves to the nearest free spot; one deep inside a block stays empty
    if (G.inside(px, py, pz, 0.08)) {
      const mv = moves.find(([x, y, z]) => !G.inside(px + x, py + y, pz + z, 0.08));
      if (!mv) continue;
      px += mv[0]; py += mv[1]; pz += mv[2];
    }
    valid[p] = 1;
    const ang = ((p * 0.61803398875) % 1) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
    let v0 = 0, vx = 0, vy = 0, vz = 0, br = 0, bg = 0, bb = 0, lx = 0, ly = 0, lz = 0, rho = 0;
    for (let k = 0; k < R0; k++) {
      const fx = dirs[k * 3], fy = dirs[k * 3 + 1], fz = dirs[k * 3 + 2];
      const dx = fx * ca - fz * sa, dy = fy, dz = fx * sa + fz * ca;
      rays++;
      if (!G.cast(px, py, pz, dx, dy, dz, MAX_T, false)) { v0 += 1; vx += dx; vy += dy; vz += dz; continue; }
      const th = G.t, box = G.box, ax = G.axis, sg = G.sign;
      const hx = px + dx * th, hy = py + dy * th, hz = pz + dz * th;
      const nX = ax === 0 ? sg : 0, nY = ax === 1 ? sg : 0, nZ = ax === 2 ? sg : 0;
      if (!A.get(hx - nX * 0.05, hy - nY * 0.05, hz - nZ * 0.05, alb) && !A.get(hx - nX * 0.6, hy - nY * 0.6, hz - nZ * 0.6, alb)) {
        const ta = TAG_ALBEDO[box < 0 ? 'ground' : G.tag[box]] || TAG_ALBEDO.concrete;
        alb[0] = ta[0]; alb[1] = ta[1]; alb[2] = ta[2];
      }
      rho += 0.2126 * alb[0] + 0.7152 * alb[1] + 0.0722 * alb[2];
      let er = 0, eg = 0, eb = 0;
      const ndl = nX * Lx + nY * Ly + nZ * Lz;
      if (ndl > 0) {
        rays++;
        if (!G.cast(hx + nX * 0.03, hy + nY * 0.03, hz + nZ * 0.03, Lx, Ly, Lz, 400, true)) { er = sunR * ndl; eg = sunG * ndl; eb = sunB * ndl; }
      }
      // the lamps left on indoors light the walls and floors round them too
      for (let li = 0; li < lamps.length; li++) {
        const lp = lamps[li];
        const qx = lp.x - hx, qy = lp.y - hy, qz = lp.z - hz, d2 = qx * qx + qy * qy + qz * qz;
        if (d2 >= lp.cut2) continue;
        const d = Math.sqrt(d2), cos = (nX * qx + nY * qy + nZ * qz) / d;
        if (cos <= 0) continue;
        rays++;
        if (G.cast(hx + nX * 0.03, hy + nY * 0.03, hz + nZ * 0.03, qx / d, qy / d, qz / d, d - 0.15, true)) continue;
        const win = Math.max(0, 1 - (d2 * d2) / (lp.cut2 * lp.cut2));
        const f = cos * win * win / Math.max(Math.pow(d, lp.decay), 0.01);
        er += lp.r * f; eg += lp.g * f; eb += lp.b * f;
      }
      if (nY > 0.5) {
        // Open ground (and pavements, steps, roofs) counts as sky: the environment's ground below
        // the horizon stands in for its skylight. Covered floors only bounce the sun and lamps.
        rays++;
        if (!G.cast(hx, hy + 0.05, hz, 0.013, 1, 0.021, 60, true)) { v0 += 1; vx += dx; vy += dy; vz += dz; }
      } else {
        const sky = WALL_SKY * (1 + 0.6 * nY);
        er += amb.r * sky; eg += amb.g * sky; eb += amb.b * sky;
      }
      const r = alb[0] * er / Math.PI, g = alb[1] * eg / Math.PI, b = alb[2] * eb / Math.PI;
      br += r; bg += g; bb += b;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lx += lum * dx; ly += lum * dy; lz += lum * dz;
    }
    // Light keeps bouncing between the walls of a street or a room: for a place that is closed
    // off by a fraction h of surfaces with mean albedo rho, all the bounces add up to 1 / (1 - rho h).
    const k = 1 / R0, o = p * 4;
    const multi = Math.min(2.5, 1 / (1 - rho * k * MULTI));
    out0[o] = br * k * multi; out0[o + 1] = bg * k * multi; out0[o + 2] = bb * k * multi; out0[o + 3] = v0 * k;
    const lum0 = Math.max(1e-6, (0.2126 * br + 0.7152 * bg + 0.0722 * bb) * k);
    out1[o] = lx * k / lum0; out1[o + 1] = ly * k / lum0; out1[o + 2] = lz * k / lum0;
    out2[o] = vx * k; out2[o + 1] = vy * k; out2[o + 2] = vz * k;
    if ((p & 15) === 0 && now() - t > SLICE) { progress(0.15 + 0.8 * p / N); await pause(); t = now(); }
  }
  const T2 = now(), traced = valid.reduce((s, v) => s + v, 0);

  // Probes buried in solid blocks take their neighbours' values, so a wall that blends one in
  // with the probe in front of it still reads the street.
  const nb = [1, -1, nx, -nx, nx * ny, -nx * ny];
  const outs = [out0, out1, out2];
  for (let it = 0; it < 8; it++) {
    const add = [];
    for (let p = 0; p < N; p++) {
      if (valid[p]) continue;
      const ix = p % nx, iy = Math.floor(p / nx) % ny, iz = Math.floor(p / (nx * ny));
      const acc = new Float32Array(12);
      let n = 0;
      for (let j = 0; j < 6; j++) {
        if ((j === 0 && ix === nx - 1) || (j === 1 && ix === 0) || (j === 2 && iy === ny - 1) || (j === 3 && iy === 0) || (j === 4 && iz === nz - 1) || (j === 5 && iz === 0)) continue;
        const q = p + nb[j];
        if (valid[q] !== 1) continue;
        for (let c = 0; c < 12; c++) acc[c] += outs[c >> 2][q * 4 + (c & 3)];
        n++;
      }
      if (n) add.push([p, acc, n]);
    }
    if (!add.length) break;
    for (const [p, acc, n] of add) { for (let c = 0; c < 12; c++) outs[c >> 2][p * 4 + (c & 3)] = acc[c] / n; valid[p] = 2; }
    for (const [p] of add) valid[p] = 1;
  }

  const t0 = texture3D(out0, nx, ny, nz), t1 = texture3D(out1, nx, ny, nz), t2 = texture3D(out2, nx, ny, nz);
  SHARED.giTex0.value = t0; SHARED.giTex1.value = t1; SHARED.giTex2.value = t2;
  SHARED.giMin.value.set(ph.minX, 0, ph.minZ);
  SHARED.giInvExt.value.set(1 / (nx * step), 1 / (ny * LAYER), 1 / (nz * step));
  SHARED.giOff.value.set(step * 0.45, LAYER * 0.45, step * 0.45);
  SHARED.giOn.value = 1;
  // Everything else lit by the sky gets the same treatment: props, cars, decals and operators.
  const mats = game.mats;
  const patch = (m) => { if (m && m.isMeshStandardMaterial) giPatch(m); };
  for (const set of [mats.world, mats.car, mats.char]) for (const k in set) patch(set[k]);
  if (mats.car && mats.car.paint) for (const k in mats.car.paint) patch(mats.car.paint[k]);
  R.scene.traverse((o) => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(patch); });
  const vol = new LightVolume(ph.minX, ph.minZ, step, nx, ny, nz, out0);
  R.useBakedLight(vol);
  progress(1);
  const stats = { probes: N, traced, rays, tris, meansMs: Math.round(Tm - T0), albedoMs: Math.round(T1 - Tm), traceMs: Math.round(T2 - T1), totalMs: Math.round(now() - T0), maps: maps.size, readMs: Math.round(means.readMs || 0) };
  vol.stats = stats;
  return vol;
}
