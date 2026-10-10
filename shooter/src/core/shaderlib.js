// Material enhancements injected into three.js's physical shader via onBeforeCompile.
//
//   world     world-space position/normal varyings (used by the others)
//   weather   macro tone variation, rain streaks, ground grime and splash-back, moss low down
//   wrap      soft "subsurface" wrap lighting for porous stone, stucco and concrete
//   box       parallax-corrected (box-projected) reflections from the town's reflection probe
//   glass     physically blended glass: full-strength Fresnel reflections over the scene behind,
//             with a dust film from a grime map
//   interior  fake rooms behind opaque window glass (interior mapping) with sun patches
//   paint     car paint: road dirt on the sills, dust on the roof and bonnet
import * as THREE from 'three';

// Uniforms shared by every patched material (updated in one place).
export const SHARED = {
  tWeather: { value: null },
  sunDirW: { value: new THREE.Vector3(0, 1, 0) },
  sunColorW: { value: new THREE.Color(1, 1, 1) },
  ambW: { value: new THREE.Color(0.3, 0.32, 0.36) },
  probeOn: { value: 0 },
  vmRot: { value: new THREE.Matrix3() },
  tCloud: { value: null },
  // cloud shadows: xy drift offset, z scale, w strength (0 = off)
  cloudShadow: { value: new THREE.Vector4(0, 0, 0.27, 0) },
  probePos: null, boxMin: null, boxMax: null, // linked to the renderer's probe uniforms
};

export function linkProbe(probeUniforms) {
  SHARED.probePos = probeUniforms.probePos;
  SHARED.boxMin = probeUniforms.boxMin;
  SHARED.boxMax = probeUniforms.boxMax;
}

const WORLD_VERT_PARS = 'varying vec3 vWPos;\nvarying vec3 vWNrm;\n';
const WORLD_VERT_NORMAL = /* glsl */`
  {
    vec3 wn = objectNormal;
    #ifdef USE_INSTANCING
      wn = mat3(instanceMatrix) * wn;
    #endif
    vWNrm = normalize(mat3(modelMatrix) * wn);
  }`;
const WORLD_VERT_POS = /* glsl */`
  {
    vec4 wp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
    #endif
    vWPos = (modelMatrix * wp).xyz;
  }`;

function inject(src, anchor, code, after = true) {
  if (src.indexOf(anchor) < 0) throw new Error('shader anchor missing: ' + anchor);
  return src.replace(anchor, after ? anchor + '\n' + code : code + '\n' + anchor);
}

// opts: { weather: {grime, moss, streaks, ground}, wrap: {amount, tint}, box: true, glass: {...},
//         interior: {...}, paint: {...}, uv: true }
export function enhance(mat, opts) {
  mat.userData.enhance = opts;
  const key = Object.keys(opts).sort().join('+');
  const local = {};
  if (opts.weather) {
    const w = opts.weather;
    Object.assign(local, {
      wGrime: { value: w.grime ?? 0.6 }, wMoss: { value: w.moss ?? 0.3 }, wStreak: { value: w.streaks ?? 0.5 },
      wGround: { value: w.ground ?? 0 }, wTone: { value: w.tone ?? 1 }, wPuddle: { value: w.puddles ?? 0 },
    });
  }
  if (opts.wrap) Object.assign(local, { wWrap: { value: opts.wrap.amount ?? 0.35 }, wSSS: { value: new THREE.Color(opts.wrap.tint ?? 0xffb27a) } });
  if (opts.glass) Object.assign(local, { gTransmit: { value: opts.glass.transmit ?? 0.82 }, gGrimeAmt: { value: opts.glass.grime ?? 0.6 }, gGrimeMap: { value: opts.glass.grimeMap || null } });
  if (opts.interior) Object.assign(local, { iGrimeMap: { value: opts.interior.grimeMap || null }, iGrimeAmt: { value: opts.interior.grime ?? 0.5 },
    iWin: { value: new THREE.Vector2(...(opts.interior.win || [0.65, 1.55])) }, iRoom: { value: new THREE.Vector3(...(opts.interior.room || [0.9, 1.15, 3.6])) }, iShop: { value: opts.interior.shop ? 1 : 0 } });
  if (opts.paint) Object.assign(local, { pDirt: { value: opts.paint.dirt ?? 0.6 }, pDust: { value: opts.paint.dust ?? 0.4 } });
  if (opts.parallax) Object.assign(local, { pxDepth: { value: opts.parallax.depth }, pxRepeat: { value: mat.map ? mat.map.repeat.x : 1 } });
  if (opts.uv || opts.glass || opts.interior) { mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' }); }
  if (opts.box) SHARED_PROBE_MATS.add(mat);
  mat.userData.uniforms = local;

  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, local);
    sh.uniforms.tWeather = SHARED.tWeather;
    sh.uniforms.sunDirW = SHARED.sunDirW;
    sh.uniforms.sunColorW = SHARED.sunColorW;
    sh.uniforms.ambW = SHARED.ambW;
    sh.uniforms.probeOn = SHARED.probeOn;
    sh.uniforms.vmRot = SHARED.vmRot;
    sh.uniforms.tCloud = SHARED.tCloud;
    sh.uniforms.cloudShadow = SHARED.cloudShadow;
    if (SHARED.probePos) { sh.uniforms.probePos = SHARED.probePos; sh.uniforms.boxMin = SHARED.boxMin; sh.uniforms.boxMax = SHARED.boxMax; }
    let v = sh.vertexShader, f = sh.fragmentShader;
    // --- vertex: world varyings (+ room space for interiors, local height for paint)
    v = WORLD_VERT_PARS + v;
    v = inject(v, '#include <beginnormal_vertex>', WORLD_VERT_NORMAL);
    v = inject(v, '#include <begin_vertex>', WORLD_VERT_POS);
    if (opts.interior) {
      v = 'varying vec3 vRoomPos;\nvarying vec3 vRoomCam;\nvarying vec3 vRoomSun;\nvarying vec3 vRoomSeed;\nuniform vec3 sunDirW;\n' + v;
      v = inject(v, '#include <begin_vertex>', /* glsl */`
        {
          mat4 inst = mat4(1.0);
          #ifdef USE_INSTANCING
            inst = instanceMatrix;
          #endif
          mat4 toWorld = modelMatrix * inst;
          mat4 toLocal = inverse(toWorld);
          vRoomPos = transformed;
          vRoomCam = (toLocal * vec4(cameraPosition, 1.0)).xyz;
          vRoomSun = normalize(mat3(toLocal) * sunDirW);
          vRoomSeed = toWorld[3].xyz;
        }`);
    }
    if (opts.paint) {
      v = 'varying vec3 vLocal;\nvarying vec3 vLocalN;\n' + v;
      v = inject(v, '#include <begin_vertex>', 'vLocal = transformed; vLocalN = objectNormal;');
    }
    // --- fragment declarations
    let pre = 'varying vec3 vWPos;\nvarying vec3 vWNrm;\nuniform sampler2D tWeather;\nuniform vec3 sunDirW;\nuniform vec3 sunColorW;\nuniform vec3 ambW;\nuniform float probeOn;\n';
    if (opts.box) pre += 'uniform vec3 probePos;\nuniform vec3 boxMin;\nuniform vec3 boxMax;\nfloat gSpecBoost = 1.0;\n';
    else pre += 'float gSpecBoost = 1.0;\n';
    if (opts.weather) pre += 'uniform float wGrime, wMoss, wStreak, wGround, wTone, wPuddle;\n';
    if (opts.wrap) pre += 'uniform float wWrap;\nuniform vec3 wSSS;\n';
    if (opts.glass) pre += 'uniform float gTransmit, gGrimeAmt;\nuniform sampler2D gGrimeMap;\n';
    if (opts.interior) pre += 'uniform float iGrimeAmt, iShop;\nuniform vec2 iWin;\nuniform vec3 iRoom;\nuniform sampler2D iGrimeMap;\nvarying vec3 vRoomPos;\nvarying vec3 vRoomCam;\nvarying vec3 vRoomSun;\nvarying vec3 vRoomSeed;\n' + INTERIOR_FN;
    if (opts.paint) pre += 'uniform float pDirt, pDust;\nvarying vec3 vLocal;\nvarying vec3 vLocalN;\n';
    if (opts.parallax) pre += 'uniform float pxDepth, pxRepeat;\n#define PX_STEPS ' + (opts.parallax.steps || 10) + '\n';
    f = pre + f;

    if (opts.box) {
      const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
        'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );',
        /* glsl */`reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
        if (probeOn > 0.5) {
          vec3 rd = reflectVec;
          vec3 t1 = (boxMax - vWPos) / rd, t2 = (boxMin - vWPos) / rd;
          vec3 tf = max(t1, t2);
          float tb = min(min(tf.x, tf.y), tf.z);
          if (tb > 0.0) reflectVec = normalize(vWPos + rd * tb - probePos);
        }`).replace('vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness );\n\t\t\treturn envMapColor.rgb * envMapIntensity;', 'vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness );\n\t\t\treturn envMapColor.rgb * envMapIntensity * gSpecBoost;');
      f = f.replace('#include <envmap_physical_pars_fragment>', chunk);
    }

    // Cloud shadows: the sun's shadow camera looks straight down the sun's rays, so a cloud
    // pattern laid out in shadow-map space falls exactly where real cloud shadows would.
    // (Not on the first-person gun: its scene has its own small shadow map, and the world sun's
    // visibility, clouds included, already dims its light.)
    if (!opts.viewEnv) f = f.replace('#include <shadowmap_pars_fragment>', CLOUD_SHADE + THREE.ShaderChunk.shadowmap_pars_fragment.replace('return shadow;', 'return shadow * cloudShade( shadowCoord.xy );'));

    if (opts.viewEnv) {
      // First-person weapon: its scene's camera never turns, so rotate the sky lookups instead.
      const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment
        .replace('vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );', 'vec3 worldNormal = vmRot * inverseTransformDirection( normal, viewMatrix );')
        .replace('reflectVec = inverseTransformDirection( reflectVec, viewMatrix );', 'reflectVec = vmRot * inverseTransformDirection( reflectVec, viewMatrix );');
      f = 'uniform mat3 vmRot;\n' + f.replace('#include <envmap_physical_pars_fragment>', chunk);
    }

    if (opts.wrap) {
      const chunk = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
        /* glsl */`float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
        float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + wWrap ) / ( 1.0 + wWrap ) );
        reflectedLight.directDiffuse += ( wrapNL - dotNL ) * directLight.color * wSSS * BRDF_Lambert( material.diffuseColor );`);
      f = f.replace('#include <lights_physical_pars_fragment>', chunk);
    }

    let surf = '';
    if (opts.weather) surf += WEATHER_FRAG;
    if (opts.glass) surf += /* glsl */`
      {
        vec4 gg = texture2D(gGrimeMap, vUv);
        float grime = clamp(gg.r * gGrimeAmt, 0.0, 1.0);
        diffuseColor.rgb *= grime;
        roughnessFactor = mix(roughnessFactor, 0.35, grime * 0.6 + gg.a * 0.1);
        glassGrime = grime;
      }`;
    if (opts.interior) surf += /* glsl */`
      {
        vec4 gg = texture2D(iGrimeMap, vUv);
        float grime = clamp(gg.r * iGrimeAmt, 0.0, 1.0);
        diffuseColor.rgb *= grime;
        roughnessFactor = mix(roughnessFactor, 0.3, grime * 0.6 + gg.a * 0.1);
        glassGrime = grime;
      }`;
    if (opts.paint) surf += PAINT_FRAG;
    if (surf) f = inject(f, '#include <metalnessmap_fragment>', 'float glassGrime = 0.0, puddle = 0.0, paintDirt = 0.0;\n' + surf);
    if (opts.weather && opts.weather.puddles) f = inject(f, '#include <normal_fragment_maps>', 'normal = normalize(mix(normal, nonPerturbedNormal, puddle));');
    // Old glass is never perfectly flat: a faint waviness breaks up the reflections.
    if (opts.interior || (opts.glass && opts.glass.wavy !== false)) f = inject(f, '#include <normal_fragment_maps>', 'normal = normalize(normal + vec3(texture2D(tWeather, vUv * 0.45 + fract(vWPos.xz * 0.013)).rg - 0.5, 0.0) * 0.035);');

    if (opts.interior) {
      f = inject(f, '#include <emissivemap_fragment>', /* glsl */`
        {
          vec3 vdir = normalize(vViewPosition);
          float NdV = saturate(dot(normal, vdir));
          float Fr = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
          vec3 room = roomRadiance(vRoomPos, normalize(vRoomPos - vRoomCam), vRoomSun, vRoomSeed);
          totalEmissiveRadiance += room * (1.0 - Fr) * (1.0 - glassGrime * 0.6) * 0.85;
        }`);
    }
    if (opts.glass) {
      f = f.replace('#include <opaque_fragment>', /* glsl */`
        {
          float NdV = saturate(dot(normal, geometryViewDir));
          float Fr = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
          float a = 1.0 - (1.0 - Fr) * gTransmit * (1.0 - glassGrime * 0.55);
          gl_FragColor = vec4(totalSpecular + totalDiffuse + totalEmissiveRadiance, clamp(a, 0.0, 1.0) * opacity);
        }`);
      f = f.replace('#include <premultiplied_alpha_fragment>', '');
    }
    if (opts.parallax) {
      // every map of a baked set shares one transform, so one offset shifts them all
      f = inject(f, '#include <clipping_planes_fragment>', PARALLAX_FRAG);
      for (const [chunk, uv] of [['map_fragment', 'vMapUv'], ['normal_fragment_maps', 'vNormalMapUv'], ['roughnessmap_fragment', 'vRoughnessMapUv'], ['metalnessmap_fragment', 'vMetalnessMapUv'], ['aomap_fragment', 'vAoMapUv']]) {
        f = f.replace('#include <' + chunk + '>', THREE.ShaderChunk[chunk].split(uv).join('(' + uv + ' + pxOff)'));
      }
    }
    sh.vertexShader = v;
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'enh:' + key + (opts.glass && opts.glass.variant ? opts.glass.variant : '');
  if (opts.glass) {
    mat.transparent = true;
    mat.premultipliedAlpha = true;
    mat.depthWrite = false;
  }
  mat.needsUpdate = true;
  return mat;
}

// Parallax occlusion: march the view ray into the relief stored in the ORM map's alpha. The
// facades and streets use world-projected UVs (see worldUV), so the tangent frame is the world
// axes picked by the dominant normal, exactly as the UVs were.
const PARALLAX_FRAG = /* glsl */`
  vec2 pxOff = vec2(0.0);
  {
    vec3 an = abs(vWNrm);
    vec3 T = vec3(1.0, 0.0, 0.0), Bt = vec3(0.0, 1.0, 0.0);
    if (an.y >= an.x && an.y >= an.z) Bt = vec3(0.0, 0.0, 1.0);
    else if (an.x >= an.z) T = vec3(0.0, 0.0, 1.0);
    vec3 V = normalize(cameraPosition - vWPos);
    float dist = length(cameraPosition - vWPos);
    float fade = 1.0 - smoothstep(9.0, 22.0, dist);
    if (fade > 0.0) {
      float ndv = max(abs(dot(normalize(vWNrm), V)), 0.18);
      vec2 duv = -vec2(dot(V, T), dot(V, Bt)) / ndv * pxDepth * pxRepeat;
      vec2 base = vRoughnessMapUv, gx = dFdx(base), gy = dFdy(base);
      float layer = 1.0 / float(PX_STEPS), depth = 0.0;
      float h = textureGrad(roughnessMap, base, gx, gy).a, prevH = h, prevD = 0.0;
      for (int i = 0; i < PX_STEPS; i++) {
        if (depth >= 1.0 - h) break;
        prevH = h; prevD = depth;
        depth += layer;
        h = textureGrad(roughnessMap, base + duv * depth, gx, gy).a;
      }
      float after = (1.0 - h) - depth, before = (1.0 - prevH) - prevD;
      float w = clamp(after / (after - before - 1e-5), 0.0, 1.0);
      pxOff = duv * mix(depth, prevD, w) * fade;
    }
  }`;

export const SHARED_PROBE_MATS = new Set();

export const CLOUD_SHADE = /* glsl */`
uniform sampler2D tCloud;
uniform vec4 cloudShadow;
float cloudShade(vec2 sc) {
  if (cloudShadow.w <= 0.0) return 1.0;
  vec2 p = sc * vec2(cloudShadow.z, cloudShadow.z * 0.82) + cloudShadow.xy;
  float n = texture2D(tCloud, p).r * 0.5 + texture2D(tCloud, p * 2.7 + 0.17).g * 0.4 + 0.05;
  return 1.0 - smoothstep(0.47, 0.66, n) * cloudShadow.w;
}
`;

// --- weathering -------------------------------------------------------------------------------
const WEATHER_FRAG = /* glsl */`
  {
    vec3 an = abs(vWNrm);
    bool isFlat = an.y > 0.7;
    vec2 wuv = isFlat ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
    vec4 nA = texture2D(tWeather, wuv * 0.031);
    vec4 nB = texture2D(tWeather, wuv * 0.137 + 0.37);
    float h = vWPos.y - wGround;
    float vert = 1.0 - smoothstep(0.4, 0.75, an.y);
    // large-scale tone drift so repeats never line up
    diffuseColor.rgb *= mix(1.0, mix(0.84, 1.12, nA.r), wTone);
    // rain streaks running down vertical faces
    float streak = texture2D(tWeather, vec2(wuv.x * 0.41, wuv.y * 0.028)).b;
    float st = smoothstep(0.5, 0.82, streak) * vert * wStreak * (0.4 + nB.g);
    diffuseColor.rgb *= 1.0 - st * 0.32;
    // splash-back and ground grime on the lowest metre or two
    float splash = (1.0 - smoothstep(0.02, 0.45 + 0.4 * nB.r, h)) * vert;
    float grime = (1.0 - smoothstep(0.0, 1.8 + 2.4 * nA.g, h)) * wGrime;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.6, 0.57, 0.52), clamp(grime * 0.55 + splash * 0.4 * wGrime, 0.0, 0.85));
    // moss: lower floors, ledges and shaded faces, in patches
    float mossH = 1.0 - smoothstep(0.6, 4.5 + 2.0 * nA.b, h);
    float mossN = nB.g * 0.55 + nB.a * 0.55 + max(vWNrm.y, 0.0) * 0.3 + (vWNrm.z < -0.5 ? 0.12 : 0.0);
    float moss = smoothstep(0.62, 0.8, mossN + mossH * 0.25) * mossH * wMoss;
    vec3 mossCol = mix(vec3(0.045, 0.06, 0.022), vec3(0.11, 0.13, 0.045), nB.a);
    diffuseColor.rgb = mix(diffuseColor.rgb, mossCol, moss * 0.85);
    roughnessFactor = clamp(roughnessFactor + grime * 0.04 + moss * 0.2, 0.0, 1.0);
    // puddles on low-lying ground
    if (wPuddle > 0.0 && isFlat) {
      float pm = nA.a * 0.7 + nB.r * 0.45;
      float pud = smoothstep(0.72, 0.76, pm) * wPuddle;
      float wet = smoothstep(0.64, 0.74, pm) * wPuddle;
      diffuseColor.rgb *= 1.0 - wet * 0.35;
      roughnessFactor = mix(roughnessFactor, 0.32, wet);
      roughnessFactor = mix(roughnessFactor, 0.03, pud);
      puddle = pud;
      gSpecBoost = 1.0 + wet * 1.5;
    }
  }`;

// --- interior mapping -------------------------------------------------------------------------
// Window quads span x ∈ [-0.5w, 0.5w], y ∈ [0, h] in local space, facing +z. The room sits behind
// (−z). Its size and furnishing come from a hash of the window's world position.
const INTERIOR_FN = /* glsl */`
float rh(vec3 s, float k) { return fract(sin(dot(s, vec3(12.9898, 78.233, 37.719)) + k * 17.17) * 43758.5453); }
vec2 boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 t1 = (bmin - ro) / rd, t2 = (bmax - ro) / rd;
  vec3 tn = min(t1, t2), tf = max(t1, t2);
  return vec2(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
}
vec3 roomRadiance(vec3 p, vec3 rd, vec3 ls, vec3 seed) {
  float w = max(iWin.x * 2.0 + 1.2, 3.2) + rh(seed, 1.0) * 1.4;
  float depth = iRoom.z + rh(seed, 2.0) * 2.0;
  float y0 = -iRoom.x, y1 = iWin.y + iRoom.y;
  vec3 bmin = vec3(-w * 0.5 + rh(seed, 3.0) * 0.6 - 0.3, y0, -depth), bmax = vec3(bmin.x + w, y1, 0.0);
  vec3 ro = p;
  vec3 t1 = (bmin - ro) / rd, t2 = (bmax - ro) / rd;
  vec3 tf = max(t1, t2);
  float t = min(min(tf.x, tf.y), tf.z);
  vec3 hp = ro + rd * t;
  vec3 n; int surf;
  if (t == tf.x) { surf = 2; n = vec3(-sign(rd.x), 0.0, 0.0); }
  else if (t == tf.y) { surf = rd.y > 0.0 ? 1 : 0; n = vec3(0.0, -sign(rd.y), 0.0); }
  else { surf = 3; n = vec3(0.0, 0.0, 1.0); }
  // Palette: Soviet-flat wallpapers, parquet or linoleum floors.
  float pal = rh(seed, 4.0);
  vec3 wall = pal < 0.25 ? vec3(0.62, 0.55, 0.42) : pal < 0.5 ? vec3(0.5, 0.58, 0.5) : pal < 0.75 ? vec3(0.55, 0.57, 0.62) : vec3(0.66, 0.5, 0.45);
  vec3 col;
  if (surf == 0) {
    float plank = floor(hp.x * 7.0 + rh(seed, 5.0) * 7.0);
    float pz = fract((hp.z + rh(vec3(plank), 1.0)) * 1.1);
    col = mix(vec3(0.3, 0.17, 0.08), vec3(0.42, 0.25, 0.12), rh(vec3(plank, floor(pz * 3.0), 1.0), 2.0)) * (0.85 + 0.15 * step(0.03, pz));
    float rug = step(abs(hp.x - (bmin.x + bmax.x) * 0.5), w * 0.28) * step(abs(hp.z + depth * 0.5), depth * 0.25) * step(0.4, rh(seed, 6.0));
    col = mix(col, vec3(0.42, 0.08, 0.06) * (0.8 + 0.2 * step(0.5, fract(hp.x * 6.0 + hp.z * 6.0))), rug);
  } else if (surf == 1) {
    col = vec3(0.78, 0.76, 0.72);
  } else {
    float stripe = step(0.5, fract((surf == 2 ? hp.z : hp.x) * 6.0));
    col = wall * (0.92 + 0.08 * stripe);
    col *= 0.85 + 0.15 * smoothstep(y0, y0 + 0.12, hp.y);
    if (hp.y < y0 + 0.08) col = vec3(0.25, 0.16, 0.1);
    // a framed picture or a carpet hung on the back wall, as was the custom
    if (surf == 3) {
      vec2 c = vec2(hp.x - (bmin.x + bmax.x) * 0.5 - (rh(seed, 7.0) - 0.5) * w * 0.4, hp.y - 0.6);
      float carpet = step(abs(c.x), 0.75) * step(abs(c.y), 0.55);
      col = mix(col, mix(vec3(0.45, 0.1, 0.07), vec3(0.6, 0.45, 0.2), step(0.5, fract((c.x + c.y) * 5.0))), carpet * step(0.45, rh(seed, 8.0)));
    }
  }
  // furniture: a wardrobe or sideboard against the back wall
  float fw = 0.9 + rh(seed, 9.0) * 0.9, fh = 0.8 + rh(seed, 10.0) * 1.2;
  float fx = mix(bmin.x + fw * 0.5 + 0.1, bmax.x - fw * 0.5 - 0.1, rh(seed, 11.0));
  if (iShop > 0.5) { fw = w * 0.8; fh = 1.9; fx = (bmin.x + bmax.x) * 0.5; }
  vec2 fb = boxHit(ro, rd, vec3(fx - fw * 0.5, y0, -depth), vec3(fx + fw * 0.5, y0 + fh, -depth + 0.55));
  if (fb.x > 0.0 && fb.x < fb.y && fb.x < t) {
    t = fb.x; hp = ro + rd * t;
    vec3 q = (hp - vec3(fx - fw * 0.5, y0, -depth)) / vec3(fw, fh, 0.55);
    n = abs(q.z - 1.0) < 0.01 ? vec3(0.0, 0.0, 1.0) : abs(q.y - 1.0) < 0.01 ? vec3(0.0, 1.0, 0.0) : vec3(sign(q.x - 0.5), 0.0, 0.0);
    col = vec3(0.24, 0.14, 0.08) * (0.9 + 0.1 * step(0.03, abs(q.x - 0.5)));
    if (iShop > 0.5) { float sh = fract(q.y * 4.0); float item = step(0.25, sh) * step(0.3, fract(q.x * 9.0 + floor(q.y * 4.0) * 0.37)); col = mix(vec3(0.5, 0.48, 0.44) * (0.6 + 0.4 * step(0.08, sh)), mix(vec3(0.7, 0.2, 0.1), vec3(0.85, 0.75, 0.3), rh(vec3(floor(q.x * 9.0), floor(q.y * 4.0), 0.0), 3.0)), item); }
    surf = 4;
  }
  // light: skylight through the window falling off with depth, plus the sun patch
  float fromWin = exp(-max(0.0, -hp.z) * 0.32);
  vec3 L = ambW * (0.18 + 0.55 * fromWin) * (0.55 + 0.45 * max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0));
  if (ls.z > 0.02) {
    float s = -hp.z / ls.z;
    vec3 q = hp + ls * s;
    float inWin = step(abs(q.x), iWin.x) * step(0.0, q.y) * step(q.y, iWin.y);
    L += sunColorW * inWin * max(dot(n, ls), 0.0) * 0.55;
  }
  // a lamp left on in a few flats
  if (rh(seed, 12.0) > 0.88 - iShop * 0.6) L += vec3(1.0, 0.72, 0.42) * 0.35 * (0.6 + 0.4 * exp(-length(hp - vec3((bmin.x + bmax.x) * 0.5, y1, -depth * 0.5)) * 0.4));
  vec3 rad = col * L / 3.14159;
  // net curtains and side drapes just behind the glass
  float tulle = step(0.35, rh(seed, 13.0)) * (1.0 - iShop);
  float side = rh(seed, 14.0) * 0.45;
  vec2 cp = p.xy + rd.xy * (-0.12 / rd.z);
  float drape = step(0.5 - side * 0.5, abs(cp.x) / (iWin.x * 2.0)) * step(0.2, rh(seed, 15.0)) * (1.0 - iShop);
  vec3 curtainLit = (ambW * 0.5 + sunColorW * max(ls.z, 0.0) * 0.25) / 3.14159;
  rad = mix(rad, vec3(0.86, 0.84, 0.78) * curtainLit, tulle * 0.45 * (0.85 + 0.15 * sin(cp.x * 60.0)));
  rad = mix(rad, mix(vec3(0.35, 0.2, 0.12), vec3(0.3, 0.32, 0.22), rh(seed, 16.0)) * curtainLit * (0.8 + 0.2 * sin(cp.x * 40.0)), drape * 0.95);
  return rad;
}
`;

// --- car paint ---------------------------------------------------------------------------------
const PAINT_FRAG = /* glsl */`
  {
    vec4 nA = texture2D(tWeather, vLocal.xz * 0.35 + vLocal.y * 0.2);
    vec4 nB = texture2D(tWeather, vec2(vLocal.x * 0.9, vLocal.y * 2.5));
    float sill = (1.0 - smoothstep(0.18, 0.62 + 0.18 * nB.r, vLocal.y)) * pDirt;
    float top = smoothstep(0.55, 0.9, vLocalN.y) * pDust * smoothstep(0.35, 0.75, nA.g);
    float dirt = clamp(sill * (0.55 + 0.6 * nA.a) + top * 0.5, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.17, 0.13), dirt * 0.8);
    roughnessFactor = mix(roughnessFactor, 0.85, dirt);
    paintDirt = dirt;
  }`;

// Weather noise: R low-frequency, G mid, B vertical streaks, A fine blotches.
export function weatherTexture(baker) {
  return baker.raw({
    name: 'weather', size: 512, seed: 5,
    raw: /* glsl */`
      vec4 raw(vec2 uv) {
        return vec4(fbm(uv, 3.0, 5) + 0.5, fbm(uv + 0.3, 6.0, 5) + 0.5, smoothstep(-0.05, 0.3, fbm(uv, vec2(24.0, 2.0), 4)) , fbm(uv + 0.7, 12.0, 4) + 0.5);
      }`,
  });
}
