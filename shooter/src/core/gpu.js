// GPU texture baking. Surfaces are described as two small GLSL functions:
//   vec4 fields(vec2 uv)   height (mm) plus three masks, tileable over the unit square
//   void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal)
// The baker renders the fields once, then derives albedo (sRGB), a tangent-space normal map
// and an AO/roughness/metalness map from them, all mipmapped and tileable.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Periodic noise library: every function tiles over uv ∈ [0,1) when frequencies are whole numbers.
export const NOISE = /* glsl */`
uniform float uSeed;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
vec2 sd(vec2 c) { return c + uSeed * vec2(17.13, 31.71); }
// Gradient noise on a lattice with period P (in cells). Roughly in [-0.7, 0.7].
float gnoise(vec2 p, vec2 P) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 a = hash22(sd(mod(i, P))) * 2.0 - 1.0;
  vec2 b = hash22(sd(mod(i + vec2(1.0, 0.0), P))) * 2.0 - 1.0;
  vec2 c = hash22(sd(mod(i + vec2(0.0, 1.0), P))) * 2.0 - 1.0;
  vec2 d = hash22(sd(mod(i + vec2(1.0, 1.0), P))) * 2.0 - 1.0;
  return mix(mix(dot(a, f), dot(b, f - vec2(1.0, 0.0)), u.x), mix(dot(c, f - vec2(0.0, 1.0)), dot(d, f - vec2(1.0)), u.x), u.y);
}
// Fractal sum; freq may differ per axis for streaky or grainy patterns. Roughly [-0.5, 0.5].
float fbm(vec2 uv, vec2 freq, int oct) {
  float s = 0.0, a = 0.5;
  vec2 f = freq;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * gnoise(uv * f + float(i) * 7.31, f);
    f *= 2.0; a *= 0.5;
  }
  return s;
}
float fbm(vec2 uv, float freq, int oct) { return fbm(uv, vec2(freq), oct); }
float ridge(vec2 uv, float freq, int oct) {
  float s = 0.0, a = 0.5, f = freq;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * (1.0 - abs(gnoise(uv * f + float(i) * 3.7, vec2(f)) * 1.6));
    f *= 2.0; a *= 0.5;
  }
  return s;
}
// Periodic Voronoi with N cells per tile: x = distance to the nearest point, y = distance to
// the nearest cell border (in cell units), z,w = two random values for that cell.
vec4 voronoi(vec2 uv, vec2 N, float jit) {
  vec2 p = uv * N;
  vec2 ip = floor(p), fp = fract(p);
  vec2 mg = vec2(0.0), mr = vec2(0.0), mid = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 id = mod(ip + g, N);
    vec2 o = 0.5 + (hash22(sd(id)) - 0.5) * jit;
    vec2 r = g + o - fp;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; mid = id; }
  }
  float ed = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 id = mod(ip + g, N);
    vec2 o = 0.5 + (hash22(sd(id)) - 0.5) * jit;
    vec2 r = g + o - fp;
    if (dot(mr - r, mr - r) > 1e-5) ed = min(ed, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec4(sqrt(md), ed, hash12(sd(mid) + 0.37), hash12(sd(mid) * 1.31 + 5.1));
}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
`;

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class TexBaker {
  constructor(renderer) {
    this.r = renderer;
    this.quad = new FullScreenQuad(null);
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  target(size, opts) {
    const rt = new THREE.WebGLRenderTarget(size, size, Object.assign({
      depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    }, opts || {}));
    return rt;
  }

  run(material, rt) {
    this.quad.material = material;
    const prev = this.r.getRenderTarget();
    this.r.setRenderTarget(rt);
    this.quad.render(this.r);
    this.r.setRenderTarget(prev);
  }

  // spec: { size, tile (metres the texture spans), fields, shade, uniforms, seed, aniso, normalStrength }
  bake(spec) {
    const size = spec.size || 1024;
    const uniforms = Object.assign({ uSeed: { value: spec.seed || 0 } }, spec.uniforms || {});
    const fieldsRT = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    });
    const fieldsMat = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT,
      fragmentShader: NOISE + spec.fields + '\nvarying vec2 vUv;\nvoid main() { gl_FragColor = fields(vUv); }',
    });
    this.run(fieldsMat, fieldsRT);
    fieldsMat.dispose();
    const texel = 1 / size;
    // metres per texel → slope from a height difference in millimetres
    const slope = (spec.normalStrength || 1) * 0.001 / ((spec.tile || 1) / size);
    const shadeU = Object.assign({}, uniforms, {
      tF: { value: fieldsRT.texture }, texel: { value: texel }, slope: { value: slope }, mode: { value: 0 },
      cavScale: { value: spec.cavity || 1 },
    });
    const shadeMat = new THREE.ShaderMaterial({
      uniforms: shadeU, vertexShader: VERT,
      fragmentShader: NOISE + spec.shade + /* glsl */`
        uniform sampler2D tF;
        uniform float texel, slope, mode, cavScale;
        varying vec2 vUv;
        float H(vec2 uv) { return texture2D(tF, uv).x; }
        void main() {
          vec4 F = texture2D(tF, vUv);
          if (mode < 0.5 || mode > 1.5) {
            // Cavity: how far the surface sits below its surroundings at a few radii.
            float h0 = F.x, cav = 0.0;
            for (int r = 0; r < 3; r++) {
              float rad = texel * (r == 0 ? 2.0 : r == 1 ? 6.0 : 16.0);
              float acc = 0.0;
              for (int k = 0; k < 8; k++) {
                float a = float(k) * 0.785398 + float(r) * 0.39;
                acc += max(0.0, H(vUv + vec2(cos(a), sin(a)) * rad) - h0);
              }
              cav += acc / 8.0 / (r == 0 ? 0.6 : r == 1 ? 1.2 : 2.4);
            }
            cav = clamp(cav * 0.5 * cavScale, 0.0, 1.0);
            vec3 alb; float rough, metal;
            shade(vUv, F, cav, alb, rough, metal);
            if (mode < 0.5) gl_FragColor = vec4(clamp(alb, 0.0, 1.0), 1.0);
            else gl_FragColor = vec4(clamp(1.0 - cav * 0.85, 0.0, 1.0), clamp(rough, 0.03, 1.0), clamp(metal, 0.0, 1.0), 1.0);
          } else {
            float hx = H(vUv + vec2(texel, 0.0)) - H(vUv - vec2(texel, 0.0));
            float hy = H(vUv + vec2(0.0, texel)) - H(vUv - vec2(0.0, texel));
            vec3 n = normalize(vec3(-hx * slope * 0.5, -hy * slope * 0.5, 1.0));
            gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
          }
        }`,
    });
    const aniso = Math.min(this.maxAniso, spec.aniso || 8);
    const out = {};
    const make = (key, mode, colorSpace) => {
      const rt = this.target(size, { colorSpace });
      rt.texture.anisotropy = aniso;
      shadeU.mode.value = mode;
      this.run(shadeMat, rt);
      rt.texture.name = (spec.name || 'baked') + '.' + key;
      out[key] = rt.texture;
      out[key + 'RT'] = rt;
    };
    make('map', 0, THREE.SRGBColorSpace);
    make('normalMap', 1, THREE.NoColorSpace);
    make('ormMap', 2, THREE.NoColorSpace);
    shadeMat.dispose();
    fieldsRT.dispose();
    return out;
  }

  // A single linear RGBA texture straight from a GLSL function `vec4 raw(vec2 uv)`.
  raw(spec) {
    const size = spec.size || 512;
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uSeed: { value: spec.seed || 0 } }, spec.uniforms || {}), vertexShader: VERT,
      fragmentShader: NOISE + spec.raw + '\nvarying vec2 vUv;\nvoid main() { gl_FragColor = raw(vUv); }',
    });
    const rt = this.target(size, { colorSpace: spec.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace, wrapS: spec.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping, wrapT: spec.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping });
    rt.texture.anisotropy = Math.min(this.maxAniso, spec.aniso || 4);
    this.run(m, rt);
    m.dispose();
    rt.texture.name = spec.name || 'raw';
    rt.texture.userData.rt = rt;
    return rt.texture;
  }
}
