// Extra surfaces the big map needs beyond the town's: dry autumn grass, ploughed soil, gravel
// (rail ballast and farm tracks), and soot-darkened copies of the facade materials for the bombed
// buildings. They are baked once, on the same GPU baker as the town's, and added to
// materials.world under new names (the town's own materials are not touched).
import * as THREE from 'three';
import { enhance } from '../../core/shaderlib.js';
import { concrete } from '../../core/surfaces.js';

function tiled(set, tile, an) {
  for (const k of ['map', 'normalMap', 'ormMap']) { const t = set[k]; if (!t) continue; t.repeat.set(1 / tile, 1 / tile); if (an) t.anisotropy = an; }
  return set;
}
function baked(set) {
  return new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.ormMap, aoMap: set.ormMap, metalnessMap: set.ormMap, roughness: 1, metalness: 1 });
}

function grass(B, size) {
  return B.bake({
    name: 'grass', size, tile: 3, seed: 61, normalStrength: 0.8, cavity: 1.2,
    fields: /* glsl */`
      vec4 fields(vec2 uv) {
        vec2 w = uv + 0.01 * vec2(fbm(uv, 30.0, 2), fbm(uv + 0.4, 30.0, 2));
        float blades = fbm(w, vec2(260.0, 90.0), 3) + fbm(w + 0.3, vec2(90.0, 260.0), 3);
        float tufts = smoothstep(-0.1, 0.35, fbm(uv, 14.0, 4));
        float bare = smoothstep(0.12, 0.3, fbm(uv + 2.7, 3.0, 5));
        vec4 v = voronoi(uv, vec2(40.0), 1.0);
        float stone = smoothstep(0.22, 0.12, v.x) * step(0.9, v.z) * bare;
        float h = blades * 2.2 * (1.0 - bare * 0.7) + tufts * 1.5 + stone * 2.0;
        return vec4(h, bare, stone, fbm(uv, 5.0, 4));
      }`,
    shade: /* glsl */`
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        float g = fbm(uv, 180.0, 3);
        vec3 green = mix(lin(vec3(0.3, 0.4, 0.15)), lin(vec3(0.42, 0.47, 0.2)), smoothstep(-0.3, 0.3, F.w));
        vec3 straw = lin(vec3(0.55, 0.5, 0.3));
        vec3 c = mix(green, straw, smoothstep(0.0, 0.4, fbm(uv + 1.3, 9.0, 4)) * 0.35);
        c *= 0.8 + 0.4 * (g + 0.5);
        vec3 soil = lin(vec3(0.3, 0.24, 0.18)) * (0.85 + 0.3 * fbm(uv, 90.0, 2));
        c = mix(c, soil, F.y * 0.6);
        c = mix(c, lin(vec3(0.5, 0.48, 0.44)), F.z);
        c *= 1.0 - cav * 0.4;
        alb = c;
        rough = 0.95;
        metal = 0.0;
      }`,
  });
}

function soil(B, size) {
  return B.bake({
    name: 'soil', size, tile: 4, seed: 62, normalStrength: 1.0, cavity: 1.3,
    fields: /* glsl */`
      vec4 fields(vec2 uv) {
        // furrows 0.5 m apart across v, with clods and stubble
        float f = sin(uv.y * 6.2831853 * 8.0 + fbm(uv, 6.0, 3) * 2.0);
        vec4 v = voronoi(uv, vec2(60.0), 1.0);
        float clod = smoothstep(0.5, 0.1, v.x);
        float stub = smoothstep(0.35, 0.5, fbm(uv, vec2(220.0, 60.0), 2)) * (0.5 + 0.5 * f);
        float h = f * 9.0 + clod * 3.0 + fbm(uv, 40.0, 3) * 2.0 + stub * 1.5;
        return vec4(h, stub, clod, fbm(uv, 4.0, 4));
      }`,
    shade: /* glsl */`
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        vec3 c = mix(lin(vec3(0.27, 0.21, 0.16)), lin(vec3(0.38, 0.3, 0.22)), smoothstep(-0.3, 0.3, F.w));
        c *= 0.85 + 0.3 * (fbm(uv, 120.0, 2) + 0.5);
        c = mix(c, lin(vec3(0.6, 0.52, 0.34)), F.y * 0.55);
        c *= 1.0 - cav * 0.5;
        alb = c;
        rough = 0.97;
        metal = 0.0;
      }`,
  });
}

function gravel(B, size) {
  return B.bake({
    name: 'gravel', size, tile: 1.5, seed: 63, normalStrength: 1.1, cavity: 1.6,
    fields: /* glsl */`
      vec4 fields(vec2 uv) {
        vec4 a = voronoi(uv, vec2(70.0), 1.0);
        vec4 b = voronoi(uv + 0.37, vec2(110.0), 1.0);
        float s = max(smoothstep(0.0, 0.18, a.y) * (0.6 + 0.4 * a.z), smoothstep(0.0, 0.15, b.y) * 0.7 * b.z);
        return vec4(s * 7.0 + fbm(uv, 20.0, 3), a.z, b.w, fbm(uv, 4.0, 4));
      }`,
    shade: /* glsl */`
      void shade(vec2 uv, vec4 F, float cav, out vec3 alb, out float rough, out float metal) {
        vec3 c = mix(lin(vec3(0.42, 0.4, 0.37)), lin(vec3(0.56, 0.52, 0.47)), F.y);
        c = mix(c, lin(vec3(0.4, 0.3, 0.22)), step(0.85, F.z) * 0.6);
        c *= 0.85 + 0.3 * (F.w + 0.5);
        c *= 1.0 - cav * 0.6;
        alb = c;
        rough = 0.9;
        metal = 0.0;
      }`,
  });
}

// Adds grass, soil, gravel, soot and the burnt facade variants to materials.world (once).
export function brMaterials(materials) {
  const W = materials.world;
  if (W.grass && W.grass.userData.br) return W;
  const B = materials.baker, P = materials.preset || {};
  const size = Math.max(256, (P.textureSize || 1024) / 2), an = P.anisotropy || 4;
  const add = (k, m) => { m.name = k; m.userData.br = true; m.envMapIntensity = 0.42; W[k] = m; };
  add('grass', enhance(baked(tiled(grass(B, size), 3, an)), { weather: { grime: 0.1, moss: 0.2, streaks: 0, puddles: 0.25, tone: 0.6 } }));
  add('soil', enhance(baked(tiled(soil(B, size), 4, an)), { weather: { grime: 0, moss: 0, streaks: 0, puddles: 0.45, tone: 0.6 } }));
  add('gravel', enhance(baked(tiled(gravel(B, size), 1.5, an)), { weather: { grime: 0.2, moss: 0.1, streaks: 0, puddles: 0.2, tone: 0.6 } }));
  add('soot', enhance(baked(tiled(concrete(B, size, 0x332e29, 64, false), 2.5, an)), { weather: { grime: 0.4, moss: 0, streaks: 0.6 } }));
  // bombed facades: the same plaster and brick, scorched and grimed
  for (const k of ['plasterCream', 'plasterOchre', 'plasterSage', 'plasterWhite', 'plasterRose', 'brick', 'brickPale', 'panel', 'concrete', 'trim', 'woodFloor']) {
    const src = W[k];
    if (!src) continue;
    const m = src.clone();
    m.color = src.color.clone().multiply(new THREE.Color(0.55, 0.52, 0.5));
    if (src.userData.enhance) enhance(m, src.userData.enhance);
    add(k + 'Burnt', m);
    m.envMapIntensity = src.envMapIntensity;
  }
  return W;
}
