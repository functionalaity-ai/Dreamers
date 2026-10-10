// Edge wear and specular anti-aliasing for the gun finishes, patched into three.js's physical
// shader after whatever patch a material already carries (the first-person copies have one).
//
// Wear: curvature, how fast the interpolated normal turns per metre of surface, picks out the
// rolled edges; noise in object space breaks it into rubbed patches that stay put as the gun
// sways, and it fades out past a few metres, where a third-person gun would only shimmer. Each
// finish wears through to what lies beneath: hard anodising to bare aluminium, Cerakote first to
// the dark anodising under it and then to aluminium, parkerised steel to bright steel, polymer to
// a smoother, slightly lighter polish. Rubber doesn't wear.
//
// Specular AA: roughness widened by the screen-space variance of the final shading normal
// (Kaplanyan and Hoffman), so rail teeth and small bevels stop sparkling into white dots.
import * as THREE from 'three';

// Worn layers: [colour (sRGB), metalness, roughness] where the edge first wears (a) and where it
// wears deepest (b). k: the curvature band (1/m) between untouched and fully worn.
const FINISHES = {
  anodised: { a: [0x7d8086, 1, 0.38], b: [0xaeb1b6, 1, 0.28], amount: 1, k: [260, 1150] },
  cerakote: { a: [0x2c2d31, 0.8, 0.5], b: [0xa9acb1, 1, 0.3], amount: 0.95, k: [240, 1100] },
  coated: { a: [0x46484c, 0.9, 0.46], b: [0x9a9da2, 1, 0.3], amount: 0.8, k: [240, 1100] },
  steel: { a: [0x6f7276, 1, 0.36], b: [0x989ba0, 1, 0.27], amount: 0.75, k: [280, 1250] },
  polymer: { poly: true, amount: 0.7, k: [90, 420] },
};

// Gun material keys and the finish each one wears like.
const KINDS = {
  anodized: 'anodised', anodBlack: 'anodised', anodizedDS: 'anodised',
  fdeMetal: 'cerakote', odgMetal: 'cerakote', fdeMetalDS: 'cerakote', odgMetalDS: 'cerakote',
  cerakote: 'coated', steel: 'steel',
  polymer: 'polymer', fdePoly: 'polymer', odgPoly: 'polymer',
};

const FADE = 3.5; // metres: worn edges fade out between 70 % of this and this distance

const VERT_PARS = 'varying vec3 vWearObj;\n';
const FRAG_PARS = /* glsl */`
varying vec3 vWearObj;
uniform vec3 wearColA, wearColB;
uniform vec4 wearPbr;
uniform vec4 wearCfg;
float wearHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float wearNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wearHash(i), wearHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(wearHash(i + vec3(0.0, 1.0, 0.0)), wearHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(wearHash(i + vec3(0.0, 0.0, 1.0)), wearHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(wearHash(i + vec3(0.0, 1.0, 1.0)), wearHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`;
// Runs once diffuse colour, roughness, metalness and the shading normal are final.
const FRAG_MAIN = /* glsl */`
  {
    // Curvature: how far the normal turns per metre along the pixel's two screen directions,
    // signed so that only convex edges wear (inside corners are where dirt collects, not wear).
    #ifdef FLAT_SHADED
      float wK = 0.0;
    #else
      vec3 wN = normalize(vNormal) * faceDirection;
      vec3 wPx = dFdx(vViewPosition), wPy = dFdy(vViewPosition);
      float wK = -dot(dFdx(wN), wPx) / max(dot(wPx, wPx), 1e-14) - dot(dFdy(wN), wPy) / max(dot(wPy, wPy), 1e-14);
    #endif
    float wFade = 1.0 - smoothstep(wearCfg.w * 0.7, wearCfg.w, length(vViewPosition));
    float wEdge = smoothstep(wearCfg.y, wearCfg.z, wK) * wFade;
    if (wEdge > 0.0) {
      // patches a few millimetres long along the edges, rubbed through more in some regions
      vec3 wp = vWearObj;
      float wn = wearNoise(wp * 900.0) * 0.18 + wearNoise(wp * 260.0 + 7.3) * 0.47 + wearNoise(wp * 55.0 + 3.1) * 0.35;
      float wD = wEdge * smoothstep(0.4, 0.66, wn) * 1.3 * wearCfg.x;
      float wA = smoothstep(0.3, 0.5, wD), wB = smoothstep(0.85, 1.05, wD);
      #ifdef WEAR_POLY
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.16 + 0.005, wA);
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.72, wA);
      #else
        diffuseColor.rgb = mix(mix(diffuseColor.rgb, wearColA, wA), wearColB, wB);
        metalnessFactor = mix(mix(metalnessFactor, wearPbr.x, wA), wearPbr.z, wB);
        roughnessFactor = mix(mix(roughnessFactor, wearPbr.y, wA), wearPbr.w, wB);
      #endif
      // the finish's grain goes with the coating: worn metal is smooth
      normal = normalize(mix(normal, nonPerturbedNormal, wA * 0.75));
    }
    // Specular AA: widen the lobe by the shading normal's variance across the pixel footprint.
    vec3 wDu = dFdx(normal), wDv = dFdy(normal);
    float wKernel = min(0.4 * (dot(wDu, wDu) + dot(wDv, wDv)), 0.2);
    float wAlpha = roughnessFactor * roughnessFactor;
    roughnessFactor = sqrt(sqrt(clamp(wAlpha * wAlpha + wKernel, 0.0, 1.0)));
  }
`;

// Insert code at the first anchor present (after it, or before it with a leading '<'); null if none.
function inject(src, anchors, code) {
  for (const a of anchors) {
    const before = a[0] === '<', anchor = before ? a.slice(1) : a;
    if (src.indexOf(anchor) >= 0) return src.replace(anchor, before ? code + '\n' + anchor : anchor + '\n' + code);
  }
  return null;
}

// Add wear of the given finish to one material, chained after any patch it already has.
export function addWear(mat, finish) {
  const F = FINISHES[finish];
  if (!F || mat.userData.wearPatched) return mat;
  const col = (v) => new THREE.Color(v ? v[0] : 0);
  const uniforms = {
    wearColA: { value: col(F.a) }, wearColB: { value: col(F.b) },
    wearPbr: { value: new THREE.Vector4(F.a ? F.a[1] : 0, F.a ? F.a[2] : 0, F.b ? F.b[1] : 0, F.b ? F.b[2] : 0) },
    wearCfg: { value: new THREE.Vector4(F.amount, F.k[0], F.k[1], FADE) },
  };
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  const own = prev !== THREE.Material.prototype.onBeforeCompile;
  mat.onBeforeCompile = function (sh, renderer) {
    if (own) prev.call(this, sh, renderer);
    // (a fallback vertex anchor in case an earlier patch has replaced begin_vertex)
    const v = inject(sh.vertexShader, ['#include <begin_vertex>', '<#include <project_vertex>'], 'vWearObj = transformed;');
    const f = inject(sh.fragmentShader, ['<#include <lights_physical_fragment>'], FRAG_MAIN);
    if (!v || !f) return; // not a physical shader: leave it alone
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = VERT_PARS + v;
    sh.fragmentShader = (F.poly ? '#define WEAR_POLY\n' : '') + FRAG_PARS + f;
  };
  mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|wear' + (F.poly ? 'P' : 'M'); };
  // non-enumerable, so Material.clone()'s JSON copy of userData skips it
  Object.defineProperty(mat.userData, 'wearPatched', { value: true });
  mat.needsUpdate = true;
  return mat;
}

// Patch every worn finish in the gun material sets (world and first-person copies).
export function applyWear(...sets) {
  for (const set of sets) for (const k in KINDS) if (set[k] && set[k].isMeshStandardMaterial) addWear(set[k], KINDS[k]);
}
