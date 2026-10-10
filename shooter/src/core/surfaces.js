// Surface recipes for the GPU baker. Heights are in millimetres; every pattern tiles.
import * as THREE from 'three';

const col = (hex) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); }; // linear

// Weathered lime stucco: sand-float grain, trowel undulation, hairline and settlement cracks,
// patches where the render has spalled off to the brick and older plaster underneath.
export function stucco(B, size, color, seed) {
  return B.bake({
    name: 'stucco', size, tile: 4, seed, normalStrength: 1.0, cavity: 1.2,
    uniforms: { uColor: { value: col(color) } },
    fields: /* glsl */`
      vec4 fields(vec2 uv) {
        float grain = fbm(uv, 220.0, 3);
        float trowel = fbm(uv, vec2(10.0, 7.0), 4);
        vec2 w = uv + 0.02 * vec2(fbm(uv, 5.0, 3), fbm(uv + 0.31, 5.0, 3));
        float swirl = fbm(w, 48.0, 2);
        float pn = fbm(uv + 0.04 * vec2(fbm(uv, 9.0, 3), fbm(uv + 0.7, 9.0, 3)), 3.0, 6);
        float patchM = smoothstep(0.245, 0.25, pn);
        vec2 cw = uv + 0.022 * vec2(fbm(uv, 9.0, 5), fbm(uv + 1.7, 9.0, 5));
        vec4 v = voronoi(cw, vec2(4.0), 1.0);
        float cw0 = 0.00018 + 0.00032 * (fbm(uv, 18.0, 2) + 0.5);
        float crack = (1.0 - smoothstep(0.0, cw0, v.y / 4.0)) * smoothstep(0.12, 0.24, fbm(uv + 3.1, 3.0, 4));
        vec4 v2 = voronoi(cw + 0.37, vec2(13.0), 1.0);
        float hair = (1.0 - smoothstep(0.0, 0.00016, v2.y / 13.0)) * smoothstep(0.2, 0.32, fbm(uv + 5.3, 5.0, 3)) * 0.6;
        float h = grain * 0.45 + trowel * 1.6 + swirl * 0.35;
        // under the render: older lime plaster with bits of brick
        float under = -3.5 + fbm(uv, 90.0, 3) * 1.2;
        h = mix(h, under, patchM);
        h -= (crack + hair * 0.5) * 1.2;
        float stain = fbm(uv, vec2(4.0, 2.0), 5);
        return vec4(h, max(crack, hair), patchM, stain);
      }`,
    shade: /* glsl */`
      uniform vec3 uColor;
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        float g = fbm(uv, 160.0, 3);
        vec3 c = uColor * (0.93 + 0.22 * g);
        c *= 0.94 + 0.12 * fbm(uv, 7.0, 4);
        c = mix(c, c * vec3(0.8, 0.79, 0.77), smoothstep(0.02, 0.32, F.w) * 0.55);
        c = mix(c, c * vec3(1.06, 1.05, 1.02), smoothstep(-0.05, -0.3, F.w) * 0.5);
        float brick = smoothstep(0.1, 0.2, fbm(uv + 2.2, 26.0, 3));
        vec3 under = mix(uColor * 0.9 + lin(vec3(0.02, 0.02, 0.02)), lin(vec3(0.5, 0.36, 0.28)), brick * 0.35);
        c = mix(c, under * (0.9 + 0.2 * g), F.z);
        c *= 1.0 - cav * 0.28;
        c = mix(c, c * 0.35, F.y * 0.7);
        alb = c;
        rough = 0.86 + 0.1 * g + F.z * 0.04;
        metal = 0.0;
      }`,
  });
}

// Cast concrete: exposed aggregate, bug holes, a faint formwork board pattern and stains.
export function concrete(B, size, tone, seed, boards, slabs) {
  return B.bake({
    name: 'concrete', size, tile: 3, seed, normalStrength: 1.0, cavity: 1.4,
    uniforms: { uTone: { value: col(tone) }, uBoards: { value: boards ? 1 : 0 }, uSlabs: { value: slabs || 0 } },
    fields: /* glsl */`
      uniform float uBoards, uSlabs;
      vec4 fields(vec2 uv) {
        float fine = fbm(uv, 300.0, 2);
        vec4 a = voronoi(uv, vec2(72.0), 1.0);
        float peb = smoothstep(0.42, 0.18, a.x) * step(0.5, a.z);
        vec4 b = voronoi(uv + 0.5, vec2(48.0), 1.0);
        float bug = smoothstep(0.11, 0.04, b.x) * step(0.93, b.z);
        float board = uBoards * (1.0 - smoothstep(0.0, 0.003, abs(fract(uv.y * 10.0) - 0.5) - 0.497)) * 0.6;
        vec2 cw = uv + 0.01 * vec2(fbm(uv, 12.0, 3), fbm(uv + 2.0, 12.0, 3));
        vec4 v = voronoi(cw, vec2(3.0), 1.0);
        float crack = (1.0 - smoothstep(0.0, 0.0006, v.y / 3.0)) * smoothstep(0.08, 0.2, fbm(uv + 4.0, 3.0, 3));
        float h = fine * 0.35 + peb * 0.5 - bug * 2.0 + fbm(uv, 6.0, 4) * 0.9 - crack * 1.6 - board * 0.5;
        float slab = 0.0;
        if (uSlabs > 0.0) {
          vec2 g = abs(fract(uv * uSlabs + 0.5) - 0.5) / uSlabs * 3.0;
          float jd = min(g.x, g.y);
          slab = 1.0 - smoothstep(0.004, 0.008, jd + fbm(uv, 80.0, 2) * 0.002);
          h -= slab * 6.0;
          float sid = hash12(sd(floor(uv * uSlabs)));
          h += (sid - 0.5) * 1.5;
        }
        return vec4(h, crack + bug + slab, peb * (a.w > 0.5 ? 1.0 : -1.0), fbm(uv, vec2(5.0, 2.0), 5));
      }`,
    shade: /* glsl */`
      uniform vec3 uTone;
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        float g = fbm(uv, 200.0, 2);
        vec3 c = uTone * (0.92 + 0.2 * g) * (0.93 + 0.14 * fbm(uv, 8.0, 4));
        c = mix(c, c * (F.z > 0.0 ? 1.12 : 0.85), abs(F.z) * 0.35);
        c = mix(c, c * vec3(0.78, 0.77, 0.76), smoothstep(0.05, 0.35, F.w) * 0.6);
        c = mix(c, c * 1.12, smoothstep(-0.12, -0.35, F.w) * 0.6);
        c *= 1.0 - cav * 0.55;
        c = mix(c, c * 0.45, clamp(F.y, 0.0, 1.0) * 0.6);
        alb = c;
        rough = 0.82 + 0.12 * g;
        metal = 0.0;
      }`,
  });
}

// Soviet prefabricated wall panel (one panel per tile, 3.2 m × 2.8 m): fine crushed-stone finish,
// recessed joints sealed with smeared black mastic, chipped panel edges and rust bleeding
// from the steel connectors at the top corners.
export const PANEL = { w: 3.2, h: 2.8 };
export function sovietPanel(B, size, tone, seed) {
  return B.bake({
    name: 'panel', size, tile: 3.0, seed, normalStrength: 1.0, cavity: 1.3,
    uniforms: { uTone: { value: col(tone) } },
    fields: /* glsl */`
      vec4 fields(vec2 uv) {
        vec2 m = vec2(${PANEL.w.toFixed(2)}, ${PANEL.h.toFixed(2)});
        vec2 e = min(uv, 1.0 - uv) * m;          // metres to the panel edge
        float dj = min(e.x, e.y);
        float jn = fbm(uv, 30.0, 3);
        float joint = 1.0 - smoothstep(0.011, 0.016, dj + jn * 0.002);
        float mastic = (1.0 - smoothstep(0.013, 0.018 + 0.022 * (fbm(uv, 12.0, 4) + 0.5), dj)) * smoothstep(-0.1, 0.15, fbm(uv + 8.0, 6.0, 3));
        float chip = (1.0 - smoothstep(0.02, 0.05, dj)) * smoothstep(0.18, 0.24, fbm(uv + 1.3, 40.0, 3));
        vec4 a = voronoi(uv, vec2(160.0, 140.0), 1.0);
        float stone = smoothstep(0.5, 0.1, a.x);
        float h = stone * 0.35 + fbm(uv, 400.0, 2) * 0.3 + fbm(uv, 5.0, 4) * 0.8;
        h -= chip * 2.5;
        h = mix(h, -12.0, joint);
        h += mastic * (1.0 - joint) * 0.4;
        // streaks run down from the top joint, strongest under the corner connectors
        float topDist = (1.0 - uv.y) * m.y;
        float corner = exp(-pow((min(uv.x, 1.0 - uv.x) * m.x - 0.35) / 0.12, 2.0));
        float streak = (0.5 + fbm(uv, vec2(60.0, 3.0), 4)) * exp(-topDist * 0.7);
        float rust = clamp(corner * smoothstep(0.35, 0.6, streak + 0.25) * exp(-topDist * 0.9), 0.0, 1.0);
        return vec4(h, joint + mastic * 2.0, rust, streak + a.z * 0.001);
      }`,
    shade: /* glsl */`
      uniform vec3 uTone;
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        float g = fbm(uv, 260.0, 2);
        vec4 a = voronoi(uv, vec2(160.0, 140.0), 1.0);
        vec3 c = uTone * (0.9 + 0.22 * g) * mix(0.85, 1.15, a.z);
        c *= 0.94 + 0.12 * fbm(uv, 6.0, 4);
        float joint = clamp(F.y, 0.0, 1.0), mastic = clamp(F.y - 1.0, 0.0, 2.0) * 0.5;
        c = mix(c, lin(vec3(0.2, 0.19, 0.18)), max(mastic * 0.65, joint * 0.85));
        c = mix(c, c * vec3(0.72, 0.7, 0.68), clamp(F.w - 0.55, 0.0, 1.0) * 0.6);
        c = mix(c, lin(vec3(0.5, 0.3, 0.17)), F.z * 0.5);
        c *= 1.0 - cav * 0.45;
        alb = c;
        rough = mix(0.84 + 0.1 * g, 0.55, max(mastic, joint) * 0.7);
        metal = 0.0;
      }`,
  });
}

// Worn asphalt: aggregate polished by traffic, alligator cracking, tar-sealed cracks and oil.
// F.w is a low-lying mask the ground shader uses for puddles.
export function asphalt(B, size, seed) {
  return B.bake({
    name: 'asphalt', size, tile: 6, seed, normalStrength: 1.0, cavity: 1.0,
    fields: /* glsl */`
      vec4 fields(vec2 uv) {
        vec4 s = voronoi(uv, vec2(260.0), 1.0);
        float stone = smoothstep(0.55, 0.15, s.x);
        float fine = fbm(uv, 700.0, 2);
        vec2 cw = uv + 0.01 * vec2(fbm(uv, 10.0, 4), fbm(uv + 3.0, 10.0, 4));
        vec4 v = voronoi(cw, vec2(9.0), 1.0);
        float alli = smoothstep(0.1, 0.22, fbm(uv + 1.0, 3.0, 4));
        float crack = (1.0 - smoothstep(0.0, 0.0012, v.y / 9.0)) * alli;
        vec4 v2 = voronoi(uv + 0.013 * vec2(fbm(uv, 4.0, 4), fbm(uv + 2.0, 4.0, 4)), vec2(2.0), 1.0);
        float seal = (1.0 - smoothstep(0.004, 0.007, v2.y / 2.0)) * smoothstep(-0.1, 0.05, fbm(uv + 6.0, 2.0, 3));
        float low = fbm(uv, 2.0, 5);
        float h = stone * 0.9 * (0.6 + s.z * 0.8) + fine * 0.3 - crack * 3.0 + seal * 0.4 - low * 2.0;
        return vec4(h, crack, seal, low);
      }`,
    shade: /* glsl */`
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        vec4 s = voronoi(uv, vec2(260.0), 1.0);
        float stone = smoothstep(0.55, 0.15, s.x);
        float wear = 0.5 + fbm(uv, 3.0, 4);
        vec3 bitumen = lin(vec3(0.29, 0.285, 0.28)) * (0.85 + 0.3 * wear);
        vec3 agg = lin(mix(vec3(0.38, 0.37, 0.35), vec3(0.47, 0.45, 0.42), s.w)) * (0.85 + 0.3 * s.z);
        vec3 c = mix(bitumen, agg, stone * (0.25 + 0.4 * wear));
        float oil = smoothstep(0.12, 0.3, fbm(uv + 9.0, vec2(5.0, 3.0), 5));
        c = mix(c, c * 0.45, oil * 0.6);
        c = mix(c, lin(vec3(0.05, 0.05, 0.05)), F.z * 0.9);
        c = mix(c, lin(vec3(0.07, 0.065, 0.06)), F.y);
        c *= 1.0 - cav * 0.3;
        alb = c;
        rough = mix(0.9, 0.62, stone * wear) - F.z * 0.4 - oil * 0.25;
        metal = 0.0;
      }`,
  });
}

// Granite setts in irregular rows: slightly domed and worn, varied in size and tone,
// bedded in sand with dirt and a little moss in the joints.
export function cobble(B, size, seed) {
  return B.bake({
    name: 'cobble', size, tile: 2.4, seed, normalStrength: 0.8, cavity: 0.7,
    fields: /* glsl */`
      vec4 sett(vec2 uv) {
        vec2 w = uv + vec2(fbm(uv, 6.0, 3), fbm(uv + 0.4, 6.0, 3)) * 0.012;
        float R = 18.0;
        float r = floor(w.y * R);
        float y = fract(w.y * R);
        float C = 13.0 + floor(hash12(sd(vec2(r, 3.0))) * 4.0);
        float x = w.x * C + hash12(sd(vec2(r, 7.0))) * C;
        float ci = floor(x);
        float fx = fract(x);
        vec2 q = vec2((fx - 0.5) / C * 2.4, (y - 0.5) / R * 2.4);
        float jit = (hash12(sd(vec2(ci, r))) - 0.5) * 0.006;
        vec2 hs = vec2(1.2 / C, 1.2 / R) - 0.006 + jit;
        vec2 n = vec2(fbm(uv + 0.3, 50.0, 3), fbm(uv + 0.9, 50.0, 3)) * 0.016;
        vec2 dq = abs(q + n) - hs + 0.02;
        float sdf = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - 0.02;
        return vec4(-sdf, mod(ci, C) + r * 31.0, r, 0.0);
      }
      vec4 fields(vec2 uv) {
        vec4 s = sett(uv);
        float inside = smoothstep(0.0, 0.003, s.x);
        float dome = smoothstep(0.0, 0.04, s.x);
        float id = hash12(sd(vec2(s.y, s.z)));
        float tilt = (hash12(sd(vec2(s.y + 1.0, s.z))) - 0.5) * 1.2;
        float h = mix(-4.0 + fbm(uv, 120.0, 2) * 1.5, dome * 2.4 + fbm(uv, 180.0, 3) * 0.7 + tilt * dome, inside);
        float moss = (1.0 - inside) * smoothstep(0.05, 0.3, fbm(uv + 4.0, 5.0, 4));
        return vec4(h, inside, id, moss);
      }`,
    shade: /* glsl */`
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        float id = F.z;
        vec3 grey = lin(vec3(0.56, 0.54, 0.51)), warm = lin(vec3(0.6, 0.52, 0.46)), dark = lin(vec3(0.42, 0.41, 0.4)), blue = lin(vec3(0.5, 0.52, 0.53));
        vec3 c = id < 0.3 ? mix(grey, warm, id / 0.3) : id < 0.7 ? mix(grey, blue, (id - 0.3) / 0.4) : mix(grey, dark, (id - 0.7) / 0.3);
        float speck = smoothstep(0.12, 0.32, fbm(uv, 520.0, 2));
        c *= 0.88 + 0.24 * (fbm(uv, 80.0, 3) + 0.5) * 0.8 + speck * 0.12;
        c *= 0.9 + 0.2 * (fbm(uv, 4.0, 4) + 0.5);
        vec3 joint = mix(lin(vec3(0.45, 0.4, 0.33)), lin(vec3(0.3, 0.33, 0.18)), F.w);
        c = mix(joint * (0.85 + 0.3 * fbm(uv, 200.0, 2)), c, F.y);
        c *= 1.0 - cav * 0.3;
        alb = c;
        rough = mix(0.95, 0.55 + 0.25 * (fbm(uv, 30.0, 3) + 0.5) + cav * 0.2, F.y);
        metal = 0.0;
      }`,
  });
}

// Running-bond brick (6 bricks × 18 courses per 1.35 m tile) with chipped arrises,
// per-brick colour, soot, efflorescence and recessed lime mortar.
export function brick(B, size, pale, seed) {
  return B.bake({
    name: 'brick', size, tile: 1.35, seed, normalStrength: 1.0, cavity: 1.0,
    uniforms: { uPale: { value: pale ? 1 : 0 } },
    fields: /* glsl */`
      vec4 fields(vec2 uv) {
        float rows = 18.0, cols = 6.0;
        float r = floor(uv.y * rows);
        float x = uv.x * cols + mod(r, 2.0) * 0.5;
        float c = floor(x);
        vec2 f = vec2(fract(x), fract(uv.y * rows));
        vec2 q = (f - 0.5) * vec2(0.225, 0.075);
        vec2 nn = vec2(fbm(uv, 70.0, 3), fbm(uv + 0.5, 70.0, 3)) * 0.006;
        vec2 dq = abs(q + nn) - vec2(0.1075, 0.0325) + 0.004;
        float sdf = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - 0.004;
        float brick = smoothstep(0.0, 0.0015, -sdf);
        float id = hash12(sd(vec2(mod(c, cols), r)));
        float spall = smoothstep(0.2, 0.26, fbm(uv + id, 30.0, 3)) * brick;
        float h = mix(-5.0 + fbm(uv, 200.0, 2) * 1.2, fbm(uv, 120.0, 3) * 0.9 + id * 0.6 - spall * 2.5, brick);
        return vec4(h, brick, id, spall);
      }`,
    shade: /* glsl */`
      uniform float uPale;
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        float id = F.z;
        vec3 a = uPale > 0.5 ? lin(vec3(0.72, 0.62, 0.5)) : lin(vec3(0.55, 0.27, 0.19));
        vec3 b = uPale > 0.5 ? lin(vec3(0.62, 0.55, 0.47)) : lin(vec3(0.42, 0.2, 0.15));
        vec3 k = uPale > 0.5 ? lin(vec3(0.48, 0.42, 0.37)) : lin(vec3(0.24, 0.13, 0.11));
        vec3 c = mix(a, b, smoothstep(0.2, 0.8, id));
        c = mix(c, k, step(0.9, id));
        c *= 0.85 + 0.3 * fbm(uv, 150.0, 3);
        c = mix(c, c * 0.55, smoothstep(0.1, 0.4, fbm(uv, vec2(3.0, 6.0), 4)) * 0.4);
        c = mix(c, c * 0.8 + 0.1, F.w * 0.6);
        vec3 mortar = lin(vec3(0.62, 0.6, 0.56)) * (0.85 + 0.3 * fbm(uv, 220.0, 2));
        c = mix(mortar, c, F.y);
        c *= 1.0 - cav * 0.4;
        alb = c;
        rough = mix(0.95, 0.8 + 0.12 * id, F.y);
        metal = 0.0;
      }`,
  });
}

// Painted timber for shutters and window frames: grain runs along u, the paint is chalky,
// crazed and chipped back to grey weathered wood in places.
export function paintedWood(B, size, paint, seed, wear = 1) {
  return B.bake({
    name: 'paintedWood', size, tile: 0.8, seed, normalStrength: 1.0, cavity: 0.8,
    uniforms: { uPaint: { value: col(paint) }, uWear: { value: wear } },
    fields: /* glsl */`
      uniform float uWear;
      vec4 fields(vec2 uv) {
        float fibre = fbm(uv, vec2(6.0, 260.0), 3);
        float ring = sin((uv.y * 18.0 + fbm(uv, vec2(2.0, 4.0), 4) * 3.0) * 6.2831853);
        float grain = fibre * 0.6 + ring * 0.15;
        float pn = fbm(uv, vec2(10.0, 24.0), 5);
        float paint = 1.0 - smoothstep(0.15, 0.17, pn - 0.03 * fibre + (uWear - 1.0) * 0.16);
        vec4 v = voronoi(uv, vec2(40.0, 70.0), 1.0);
        float craze = (1.0 - smoothstep(0.0, 0.03, v.y)) * smoothstep(0.0, 0.2, fbm(uv + 2.0, 4.0, 3)) * paint;
        float h = grain * 0.6 + paint * 0.35 - craze * 0.3;
        return vec4(h, paint, craze, ring);
      }`,
    shade: /* glsl */`
      uniform vec3 uPaint;
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        vec3 wood = lin(vec3(0.46, 0.42, 0.36)) * (0.8 + 0.3 * F.w * 0.5 + 0.3 * fbm(uv, vec2(4.0, 200.0), 3));
        vec3 p = uPaint * (0.9 + 0.2 * fbm(uv, 12.0, 4));
        p = mix(p, p * 1.25 + 0.03, smoothstep(0.0, 0.3, fbm(uv + 5.0, 3.0, 4)) * 0.5);
        vec3 c = mix(wood, p, F.y);
        c *= 1.0 - F.z * 0.5;
        c *= 1.0 - cav * 0.4;
        alb = c;
        rough = mix(0.86, 0.6 + 0.1 * fbm(uv, 40.0, 2), F.y);
        metal = 0.0;
      }`,
  });
}

// Burnt-out sheet metal: scorched paint, flaking rust, soot.
export function rust(B, size, seed, scorched = 0) {
  return B.bake({
    name: 'rust', size, tile: 1.5, seed, normalStrength: 1.0, cavity: 1.0,
    uniforms: { uScorch: { value: scorched } },
    fields: /* glsl */`
      vec4 fields(vec2 uv) {
        float r = fbm(uv, 8.0, 6);
        float flake = smoothstep(0.0, 0.08, fbm(uv, 30.0, 4));
        float h = r * 1.2 + flake * 0.4 + fbm(uv, 300.0, 2) * 0.3;
        return vec4(h, smoothstep(-0.2, 0.2, r), flake, fbm(uv + 3.0, 4.0, 4));
      }`,
    shade: /* glsl */`
      uniform float uScorch;
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        vec3 rustA = lin(vec3(0.42, 0.22, 0.12)), rustB = lin(vec3(0.25, 0.13, 0.08)), soot = lin(vec3(0.06, 0.055, 0.05));
        vec3 c = mix(rustB, rustA, F.y) * (0.8 + 0.4 * fbm(uv, 120.0, 3));
        c = mix(c, soot, smoothstep(-0.1, 0.25, F.w) * 0.8);
        // fire-scorched: ash-grey sheet metal and soot, rust only breaking through in patches
        vec3 ash = lin(vec3(0.36, 0.34, 0.32)) * (0.75 + 0.5 * fbm(uv, 40.0, 3));
        float rb = smoothstep(0.05, 0.25, fbm(uv + 7.0, 5.0, 5));
        vec3 sc = mix(mix(ash, soot * 1.6, smoothstep(-0.15, 0.2, F.w)), mix(rustB, rustA, F.y), rb * 0.8);
        c = mix(c, sc, uScorch);
        c *= 1.0 - cav * 0.4;
        alb = c;
        rough = 0.92;
        metal = 0.15 * (1.0 - F.y);
      }`,
  });
}

// Grime for window glass in window-local UV (not tiling): a dust film thickening towards the
// bottom and the corners, dried rain runs from the top and water-spot rings.
export function glassGrime(B, size, seed) {
  return B.raw({
    name: 'glassGrime', size, seed, clamp: true,
    raw: /* glsl */`
      vec4 raw(vec2 uv) {
        float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        float film = 0.18 + 0.35 * smoothstep(0.5, 0.0, uv.y) + 0.5 * smoothstep(0.12, 0.0, edge);
        film *= 0.7 + 0.6 * (fbm(uv, 6.0, 5) + 0.5);
        float runs = smoothstep(0.15, 0.35, fbm(uv, vec2(40.0, 2.0), 4)) * smoothstep(0.0, 0.6, uv.y) * 0.6;
        vec4 v = voronoi(uv, vec2(26.0), 1.0);
        float spot = smoothstep(0.06, 0.0, abs(v.x - 0.18)) * step(0.65, v.z) * 0.5;
        float smudge = smoothstep(0.1, 0.3, fbm(uv + 7.0, 3.0, 4)) * 0.4;
        return vec4(clamp(film + runs + spot, 0.0, 1.0), runs, spot, smudge);
      }`,
  });
}

// Metallic paint flakes: tiny cells with randomly tilted normals, seen through a smooth clear coat.
export function flakes(B, size, seed) {
  return B.raw({
    name: 'flakes', size, seed,
    raw: /* glsl */`
      vec4 raw(vec2 uv) {
        vec4 v = voronoi(uv, vec2(180.0), 1.0);
        vec2 t = (vec2(v.z, v.w) - 0.5) * 0.55;
        vec3 n = normalize(vec3(t, 1.0));
        return vec4(n * 0.5 + 0.5, 1.0);
      }`,
  });
}

// Tyre tread: blocks with sipes and a centre rib; u wraps around the circumference.
export function tread(B, size, seed) {
  return B.bake({
    name: 'tread', size, tile: 0.3, seed, normalStrength: 1.2, cavity: 1.0,
    fields: /* glsl */`
      vec4 fields(vec2 uv) {
        float u = uv.x * 24.0, v = uv.y;
        float blk = fract(u + (v > 0.5 ? 0.5 : 0.0) + (v - 0.5) * 0.6);
        float groove = 1.0 - smoothstep(0.06, 0.1, min(blk, 1.0 - blk));
        float rib = 1.0 - smoothstep(0.02, 0.035, abs(v - 0.5)) ;
        float shoulder = smoothstep(0.08, 0.02, min(v, 1.0 - v));
        float sipe = (1.0 - smoothstep(0.0, 0.03, abs(fract(u * 3.0 + v * 2.0) - 0.5) - 0.45)) * 0.6;
        float g = max(max(groove, rib), sipe);
        float h = -g * 4.0 - shoulder * 2.0 + fbm(uv, 120.0, 2) * 0.2;
        return vec4(h, g, shoulder, 0.0);
      }`,
    shade: /* glsl */`
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        vec3 c = lin(vec3(0.075, 0.072, 0.07)) * (0.9 + 0.2 * fbm(uv, 60.0, 2));
        c = mix(c, lin(vec3(0.16, 0.14, 0.12)), (1.0 - F.y) * 0.25);
        c *= 1.0 - cav * 0.4;
        alb = c; rough = 0.9 - (1.0 - F.y) * 0.15; metal = 0.0;
      }`,
  });
}

// Woven seat cloth.
export function cloth(B, size, color, seed) {
  return B.bake({
    name: 'cloth', size, tile: 0.25, seed, normalStrength: 0.8, cavity: 0.8,
    uniforms: { uColor: { value: col(color) } },
    fields: /* glsl */`
      vec4 fields(vec2 uv) {
        float a = sin(uv.x * 6.2831853 * 90.0) * 0.5 + 0.5, b = sin(uv.y * 6.2831853 * 90.0) * 0.5 + 0.5;
        float chk = step(0.5, fract(uv.x * 45.0)) == step(0.5, fract(uv.y * 45.0)) ? a : b;
        float h = chk * 0.5 + fbm(uv, 40.0, 3) * 0.2;
        return vec4(h, chk, 0.0, 0.0);
      }`,
    shade: /* glsl */`
      uniform vec3 uColor;
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        float stripe = step(0.5, fract(uv.y * 8.0)) * 0.12;
        alb = uColor * (0.8 + 0.3 * F.y + stripe) * (1.0 - cav * 0.3);
        rough = 0.95; metal = 0.0;
      }`,
  });
}

// Windscreen dust with the two arcs the wipers have cleaned (u across the glass, v upwards).
export function windscreenGrime(B, size, seed) {
  return B.raw({
    name: 'windscreenGrime', size, seed, clamp: true,
    raw: /* glsl */`
      float arc(vec2 uv, float u0) {
        vec2 d = vec2((uv.x - u0) * 1.48, uv.y * 0.94);
        float r = length(d);
        return smoothstep(0.1, 0.13, r) * (1.0 - smoothstep(0.46, 0.5, r));
      }
      float rim(vec2 uv, float u0) {
        vec2 d = vec2((uv.x - u0) * 1.48, uv.y * 0.94);
        float r = length(d);
        return exp(-pow((r - 0.49) / 0.018, 2.0));
      }
      vec4 raw(vec2 uv) {
        float film = 0.55 + 0.35 * (fbm(uv, 5.0, 5) + 0.5) + 0.3 * smoothstep(0.15, 0.0, min(uv.x, 1.0 - uv.x));
        float clean = max(arc(uv, 0.26), arc(uv, 0.6));
        float r = max(rim(uv, 0.26), rim(uv, 0.6));
        float smear = smoothstep(0.1, 0.3, fbm(uv, vec2(3.0, 30.0), 3)) * clean * 0.25;
        float d = mix(film, 0.06 + smear, clean) + r * 0.35;
        vec4 v = voronoi(uv, vec2(30.0), 1.0);
        float spot = smoothstep(0.05, 0.0, abs(v.x - 0.16)) * step(0.7, v.z) * 0.4 * (1.0 - clean * 0.7);
        return vec4(clamp(d + spot, 0.0, 1.0), 0.0, spot, smear);
      }`,
  });
}
