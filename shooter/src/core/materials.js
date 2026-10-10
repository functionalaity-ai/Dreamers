// Material library. World geometry carries UVs in metres; each material's textures repeat at
// their real-world tile size. The hero surfaces (stucco, concrete, Soviet panels, brick, setts,
// asphalt, painted timber) are baked on the GPU at load, then weathered in world space.
import * as THREE from 'three';
import * as TX from './textures.js';
import * as SF from './surfaces.js';
import { TexBaker } from './gpu.js';
import { enhance, weatherTexture, SHARED } from './shaderlib.js';

function tiled(set, tileW, tileH, anisotropy) {
  for (const k of ['map', 'normalMap', 'roughnessMap', 'ormMap']) {
    const t = set[k];
    if (!t) continue;
    t.repeat.set(1 / tileW, 1 / (tileH || tileW));
    if (anisotropy) t.anisotropy = anisotropy;
  }
  return set;
}

// A PBR material from a baked set (albedo, normal, AO/roughness/metal).
function baked(set, opts) {
  return new THREE.MeshStandardMaterial(Object.assign({
    map: set.map, normalMap: set.normalMap, roughnessMap: set.ormMap, aoMap: set.ormMap, metalnessMap: set.ormMap,
    roughness: 1, metalness: 1, aoMapIntensity: 1,
  }, opts || {}));
}

export class Materials {
  constructor(preset, renderer) {
    this.preset = preset;
    this.renderer = renderer;
    this.world = {};
    this.gun = {};
    this.char = {};
    this.car = {};
  }

  // Builds everything, yielding between steps so a loading bar can repaint.
  async build(progress) {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const P = this.preset;
    const size = P.textureSize;
    const small = Math.max(256, size / 2);
    const an = P.anisotropy;
    const W = this.world;
    const B = new TexBaker(this.renderer);
    this.baker = B;
    SHARED.tWeather.value = weatherTexture(B);
    const std = function (set, opts) {
      return new THREE.MeshStandardMaterial(Object.assign({
        map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1, metalness: 0,
      }, opts || {}));
    };
    const facadeWeather = { weather: { grime: 0.75, moss: 0.35, streaks: 0.6 }, wrap: { amount: 0.4, tint: 0xffb98a } };
    const steps = [
      () => {
        W.cobble = enhance(baked(tiled(SF.cobble(B, size, 3), 2.4, 2.4, an)), { weather: { grime: 0.15, moss: 0.25, streaks: 0, puddles: 0.55, tone: 0.7 } });
        W.asphalt = enhance(baked(tiled(SF.asphalt(B, size, 4), 6, 6, an)), { weather: { grime: 0, moss: 0, streaks: 0, puddles: 1, tone: 0.8 }, box: true });
      },
      () => {
        W.concrete = enhance(baked(tiled(SF.concrete(B, small, 0xa8a49b, 5, true), 3, 3, an)), facadeWeather);
        W.sidewalk = enhance(baked(tiled(SF.concrete(B, small, 0xb5b0a6, 6, false, 3), 3, 3, an)), { weather: { grime: 0.3, moss: 0.15, streaks: 0, puddles: 0.35 } });
      },
      () => {
        W.brick = enhance(baked(tiled(SF.brick(B, size, false, 7), 1.35, 1.35, an)), facadeWeather);
        W.brickPale = enhance(baked(tiled(SF.brick(B, size, true, 8), 1.35, 1.35, an)), facadeWeather);
      },
      () => {
        W.plasterCream = enhance(baked(tiled(SF.stucco(B, size, 0xd9c6a0, 1), 4, 4, an)), facadeWeather);
        W.plasterOchre = enhance(baked(tiled(SF.stucco(B, size, 0xcf9d5e, 2), 4, 4, an)), facadeWeather);
      },
      () => {
        W.plasterSage = enhance(baked(tiled(SF.stucco(B, size, 0xa7b296, 3), 4, 4, an)), facadeWeather);
        W.plasterWhite = enhance(baked(tiled(SF.stucco(B, size, 0xe4ddd0, 4), 4, 4, an)), facadeWeather);
        W.plasterRose = enhance(baked(tiled(SF.stucco(B, size, 0xd6a690, 9), 4, 4, an)), facadeWeather);
      },
      () => {
        const panel = tiled(SF.sovietPanel(B, size, 0xb3ada2, 10), SF.PANEL.w, SF.PANEL.h, an);
        W.panel = enhance(baked(panel), { weather: { grime: 0.85, moss: 0.45, streaks: 0.9 }, wrap: { amount: 0.4, tint: 0xffb98a } });
        W.panelPlinth = enhance(baked(tiled(SF.concrete(B, small, 0x8f8a80, 11, true), 3, 3, an)), { weather: { grime: 1, moss: 0.6, streaks: 0.6 }, wrap: { amount: 0.3 } });
      },
      () => {
        const green = SF.paintedWood(B, small, 0x3f6a3c, 12, 0.85);
        W.shutter = enhance(baked(tiled(green, 0.8, 0.8, an), { color: 0xffffff }), { weather: { grime: 0.3, moss: 0, streaks: 0.4, tone: 0.5 } });
        const white = SF.paintedWood(B, small, 0xe6e0d2, 13, 0.55);
        W.frameWood = enhance(baked(tiled(white, 0.8, 0.8, an)), { weather: { grime: 0.4, moss: 0, streaks: 0.3, tone: 0.4 } });
        W.rustMetal = baked(tiled(SF.rust(B, small, 14), 1.5, 1.5, an));
      },
      () => { W.woodFloor = std(tiled(TX.woodPlanks(small), 2, 2, an)); W.woodDark = std(tiled(TX.woodPlanks(small, 1), 1.4, 1.4, an)); },
      () => { W.roof = std(tiled(TX.roofTiles(small), 2, 2, an)); },
    ];
    for (let i = 0; i < steps.length; i++) {
      steps[i]();
      if (progress) progress((i + 1) / (steps.length + 3));
      await tick();
    }
    // Glass and windows
    const grime = SF.glassGrime(B, 512, 15);
    this.glassGrime = grime;
    W.glass = enhance(new THREE.MeshPhysicalMaterial({ color: 0x8a8274, roughness: 0.02, metalness: 0, ior: 1.52, side: THREE.DoubleSide }), { glass: { grimeMap: grime, grime: 0.22, transmit: 0.8 }, box: true });
    // Opaque window glass with a room behind it (interior mapping), for buildings you can't enter.
    W.windowRoom = enhance(new THREE.MeshPhysicalMaterial({ color: 0x8a8274, roughness: 0.02, metalness: 0, ior: 1.52 }), { interior: { grimeMap: grime, grime: 0.2, win: [0.7, 1.6], room: [0.88, 1.15, 3.6] }, box: true });
    W.shopRoom = enhance(new THREE.MeshPhysicalMaterial({ color: 0x8a8274, roughness: 0.02, metalness: 0, ior: 1.52 }), { interior: { grimeMap: grime, grime: 0.15, win: [1.6, 2.3], room: [0.5, 0.9, 5.0], shop: true }, box: true });
    // Brushed aluminium frames: anisotropic highlights along the extrusion.
    W.frameAlu = enhance(new THREE.MeshPhysicalMaterial({ color: 0xb9b6ae, metalness: 1, roughness: 0.32, anisotropy: 0.75, anisotropyRotation: 0, normalMap: this.brushed(B), normalScale: new THREE.Vector2(0.15, 0.15) }), { box: true });
    W.frameAluV = W.frameAlu.clone(); W.frameAluV.anisotropyRotation = Math.PI / 2;
    enhance(W.frameAluV, { box: true });
    W.frameBronze = enhance(new THREE.MeshPhysicalMaterial({ color: 0x5a4632, metalness: 1, roughness: 0.38, anisotropy: 0.7, normalMap: W.frameAlu.normalMap, normalScale: new THREE.Vector2(0.15, 0.15) }), { box: true });
    W.sill = enhance(new THREE.MeshStandardMaterial({ color: 0x8c8f90, metalness: 0.85, roughness: 0.55, normalMap: W.concrete.normalMap }), { weather: { grime: 0.5, moss: 0, streaks: 0.6, tone: 0.6 }, box: true });

    W.sandbag = new THREE.MeshStandardMaterial({ color: 0xa08d68, roughness: 0.95, normalMap: W.plasterCream.normalMap, normalScale: new THREE.Vector2(2, 2) });
    W.trim = enhance(baked(tiled(SF.stucco(B, small, 0xe9e3d6, 16), 4, 4, an)), facadeWeather);
    W.roadPaint = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.7, alphaMap: this.wearMask(B), alphaTest: 0.5 });
    W.roadPaint.alphaMap.repeat.set(1 / 2.5, 1 / 2.5);
    W.darkMetal = enhance(new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.55, metalness: 0.8 }), { box: true });
    W.rust = W.rustMetal;
    W.tire = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 });
    W.chrome = enhance(new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.08, metalness: 1 }), { box: true });
    W.burnt = enhance(baked(tiled(SF.rust(B, small, 17, 1), 1.2, 1.2, an)), { weather: { grime: 0.2, moss: 0, streaks: 0.3 } });
    W.carRed = new THREE.MeshPhysicalMaterial({ color: 0x7a1d1a, roughness: 0.38, metalness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    W.carBlue = new THREE.MeshPhysicalMaterial({ color: 0x23384f, roughness: 0.38, metalness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    W.carWhite = new THREE.MeshPhysicalMaterial({ color: 0xc9c6bd, roughness: 0.4, metalness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    W.carGreen = enhance(new THREE.MeshPhysicalMaterial({ color: 0x3c4a35, roughness: 0.45, metalness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25 }), { weather: { grime: 0.5, moss: 0, streaks: 0.5 }, box: true });
    W.leaves = new THREE.MeshStandardMaterial({ color: 0x4a5a2c, roughness: 0.85, flatShading: true });
    W.leavesAutumn = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.85, flatShading: true });
    W.bark = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95, normalMap: W.woodDark.normalMap });
    W.water = enhance(new THREE.MeshStandardMaterial({ color: 0x1d3a3a, roughness: 0.04, metalness: 0.2 }), { box: true });
    W.bronze = enhance(new THREE.MeshStandardMaterial({ color: 0x4f6656, roughness: 0.45, metalness: 0.85 }), { box: true });
    W.canvasGreen = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.95, side: THREE.DoubleSide });
    W.canvasRed = new THREE.MeshStandardMaterial({ color: 0x8a3a2a, roughness: 0.95, side: THREE.DoubleSide });
    W.canvasStripe = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.95, side: THREE.DoubleSide });
    W.fabric = new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.95 });
    W.paper = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.9 });
    W.lampGlow = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffd890, emissiveIntensity: 2.2 });
    W.mastic = new THREE.MeshStandardMaterial({ color: 0x1a1918, roughness: 0.6 });
    W.galvanized = enhance(new THREE.MeshStandardMaterial({ color: 0x9a9c9c, metalness: 0.9, roughness: 0.45, normalMap: W.concrete.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) }), { weather: { grime: 0.6, moss: 0, streaks: 0.8 }, box: true });
    W.balconyRail = enhance(new THREE.MeshStandardMaterial({ color: 0x31352f, metalness: 0.7, roughness: 0.6 }), { weather: { grime: 0.3, moss: 0, streaks: 0.4 } });
    W.corrugated = enhance(new THREE.MeshStandardMaterial({ color: 0x8e8a7e, metalness: 0.6, roughness: 0.6 }), { weather: { grime: 0.6, moss: 0.1, streaks: 0.9 }, box: true });
    // Leaf cards: alpha-tested clusters, with matching depth materials for shadows.
    for (const [key, tint] of [['leafCards', 0], ['leafCardsAutumn', 1]]) {
      const tex = TX.leafCluster(512, tint);
      const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82 });
      m.userData.depth = new THREE.MeshDepthMaterial({ map: tex, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
      W[key] = m;
    }
    for (const k in W) {
      W[k].name = k;
      W[k].envMapIntensity = /glass|window/i.test(k) ? 1.0 : /car|chrome|frame|water|bronze|sill|galv/i.test(k) ? 0.9 : 0.42;
    }
    W.roadPaint.envMapIntensity = 0.3;

    await tick();
    this.buildCarMaterials(B, small);
    await tick();

    // Guns
    const wear = TX.gunWear(256);
    const st = TX.stipple(256);
    for (const t of [wear.map, wear.normalMap, wear.roughnessMap]) { t.repeat.set(6, 6); t.anisotropy = an; }
    st.normalMap.repeat.set(22, 22); st.normalMap.anisotropy = an;
    const G = this.gun;
    const gf = SF.gunFinish(B, P.textureSize >= 2048 ? 1024 : 512, 61);
    for (const t of [gf.map, gf.normalMap, gf.ormMap]) { t.repeat.set(1 / 0.16, 1 / 0.16); t.anisotropy = an; }
    this.gunFinish = gf;
    G.anodized = new THREE.MeshStandardMaterial({ color: 0x343438, metalness: 1, roughness: 1, map: gf.map, roughnessMap: gf.ormMap, metalnessMap: gf.ormMap, normalMap: gf.normalMap, normalScale: new THREE.Vector2(0.5, 0.5) });
    G.fde = new THREE.MeshStandardMaterial({ color: 0x8a7656, metalness: 0.1, roughness: 0.85, roughnessMap: wear.roughnessMap });
    G.steel = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 1, roughness: 0.85, map: gf.map, roughnessMap: gf.ormMap, normalMap: gf.normalMap, normalScale: new THREE.Vector2(0.4, 0.4) });
    G.nickel = new THREE.MeshStandardMaterial({ color: 0xb4b2ac, metalness: 1, roughness: 0.28 });
    G.polymer = new THREE.MeshStandardMaterial({ color: 0x27282a, metalness: 0, roughness: 0.74, normalMap: st.normalMap, normalScale: new THREE.Vector2(0.25, 0.25) });
    G.rubber = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95 });
    G.brass = new THREE.MeshStandardMaterial({ color: 0xc9a35a, metalness: 1, roughness: 0.3 });
    G.copper = new THREE.MeshStandardMaterial({ color: 0xb8733a, metalness: 1, roughness: 0.32 });
    G.shell = new THREE.MeshStandardMaterial({ color: 0x9a2018, roughness: 0.55 });
    G.cerakote = new THREE.MeshStandardMaterial({ color: 0x3b3c37, metalness: 0.25, roughness: 1, map: gf.map, roughnessMap: gf.ormMap, normalMap: gf.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) });
    G.lens = new THREE.MeshStandardMaterial({ color: 0x0c1418, metalness: 1, roughness: 0.04, transparent: true, opacity: 0.55, envMapIntensity: 1.6 });
    G.lensTint = new THREE.MeshStandardMaterial({ color: 0x2a3a30, metalness: 0.8, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false });
    G.reticle = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, depthTest: false, depthWrite: false });
    G.laser = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    G.tritium = new THREE.MeshBasicMaterial({ color: 0x9cff7a });
    G.orange = new THREE.MeshStandardMaterial({ color: 0xc4602a, roughness: 0.6 });
    G.wood = new THREE.MeshStandardMaterial({ color: 0x6a4428, roughness: 0.55, map: this.world.woodDark.map });
    G.gloveTan = new THREE.MeshStandardMaterial({ color: 0x7a6a50, roughness: 0.9 });
    for (const k in G) { G[k].name = 'gun_' + k; if (G[k].isMeshStandardMaterial) G[k].envMapIntensity = k === 'lens' ? 1.4 : 0.75; }
    if (progress) progress((steps.length + 1) / (steps.length + 3));

    // Characters
    for (const scheme of ['msg', 'volk']) {
      const a = TX.characterAtlas(512, scheme);
      a.map.anisotropy = an;
      this.char[scheme] = new THREE.MeshStandardMaterial({ map: a.map, normalMap: a.normalMap, roughnessMap: a.roughnessMap, vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.4 });
    }
    // First-person arms: a dark ripstop sleeve and a fabric/suede glove (baked).
    {
      const rs = SF.ripstop(B, small, 0x3e3d33, 51);
      for (const t of [rs.map, rs.normalMap, rs.ormMap]) { t.repeat.set(1 / 0.18, 1 / 0.18); t.anisotropy = an; }
      G.sleeve = new THREE.MeshStandardMaterial({ map: rs.map, normalMap: rs.normalMap, roughnessMap: rs.ormMap, aoMap: rs.ormMap, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2), name: 'gun_sleeve' });
      const gf = SF.gloveFabric(B, small, 0x2e2b25, 52);
      for (const t of [gf.map, gf.normalMap, gf.ormMap]) { t.repeat.set(1 / 0.12, 1 / 0.12); t.anisotropy = an; }
      G.glove = new THREE.MeshStandardMaterial({ map: gf.map, normalMap: gf.normalMap, roughnessMap: gf.ormMap, aoMap: gf.ormMap, roughness: 1, normalScale: new THREE.Vector2(1.1, 1.1), name: 'gun_glove' });
      G.knuckle = new THREE.MeshStandardMaterial({ color: 0x1c1b19, roughness: 0.55, metalness: 0, normalMap: gf.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), name: 'gun_knuckle' });
      for (const k of ['sleeve', 'glove', 'knuckle']) G[k].envMapIntensity = 0.6;
    }
    // Double-sided variants for open tubes such as sight bodies, shared by every gun build.
    for (const k of ['anodized', 'rubber']) { const m = G[k].clone(); m.side = THREE.DoubleSide; m.name = G[k].name + 'DS'; G[k + 'DS'] = m; }
    // First-person copies: same look, but their sky reflections follow the turning camera.
    this.gunFP = {};
    for (const k in G) {
      const m = G[k];
      if (m.isMeshStandardMaterial) {
        const c = m.clone();
        c.name = m.name + '_fp';
        // Non-enumerable: Material.clone() JSON-copies userData, which must not drag this along.
        Object.defineProperty(c.userData, 'base', { value: m });
        c.envMapIntensity = Math.min(1.3, m.envMapIntensity * 1.35);
        this.gunFP[k] = enhance(c, { viewEnv: true });
      } else this.gunFP[k] = m;
    }
    if (progress) progress(1);

    // Effects
    this.fx = {
      flash: TX.spriteTexture('flash'),
      smoke: TX.spriteTexture('smoke'),
      hole: TX.spriteTexture('hole'),
      spark: TX.spriteTexture('spark'),
      blood: TX.spriteTexture('blood'),
    };
    return this;
  }

  // Fine linear brushing (normal map) for extruded aluminium, along u.
  brushed(B) {
    const t = B.raw({
      name: 'brushed', size: 512, seed: 21,
      raw: /* glsl */`
        vec4 raw(vec2 uv) {
          float a = fbm(uv, vec2(2.0, 400.0), 3);
          float b = fbm(uv, vec2(4.0, 120.0), 2);
          vec3 n = normalize(vec3(0.0, (a * 0.8 + b * 0.4), 1.0));
          return vec4(n * 0.5 + 0.5, 1.0);
        }`,
    });
    t.repeat.set(4, 4);
    return t;
  }

  // Patchy wear for painted road markings (alpha-tested).
  wearMask(B) {
    return B.raw({
      name: 'wear', size: 512, seed: 22,
      raw: /* glsl */`
        vec4 raw(vec2 uv) {
          float n = fbm(uv, 6.0, 5) + fbm(uv, 60.0, 2) * 0.4;
          float a = smoothstep(-0.2, 0.05, n);
          return vec4(a, a, a, a);
        }`,
    });
  }

  buildCarMaterials(B, small) {
    const C = this.car;
    const flakes = SF.flakes(B, 512, 30);
    flakes.repeat.set(1 / 0.12, 1 / 0.12);
    this.flakes = flakes;
    const paint = (hex, metallic = true) => enhance(new THREE.MeshPhysicalMaterial({
      color: hex, metalness: metallic ? 0.55 : 0.05, roughness: metallic ? 0.42 : 0.5,
      clearcoat: 1, clearcoatRoughness: 0.035, normalMap: metallic ? flakes : null, normalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: 1,
    }), { paint: { dirt: 0.6, dust: 0.25 }, box: true });
    C.paint = {
      cherry: paint(0x6e1512), ivory: paint(0xcfc7b0, false), steel: paint(0x4d5a63), olive: paint(0x485036, false),
      sky: paint(0x6e8fa6), mustard: paint(0xb98a2e, false), white: paint(0xd8d6cf, false), green: paint(0x2f4a36),
    };
    C.chrome = enhance(new THREE.MeshPhysicalMaterial({ color: 0xe0e0e0, metalness: 1, roughness: 0.06, envMapIntensity: 1.1 }), { box: true });
    C.satin = enhance(new THREE.MeshPhysicalMaterial({ color: 0x9a9a98, metalness: 1, roughness: 0.3, envMapIntensity: 1 }), { box: true });
    C.blackTrim = enhance(new THREE.MeshPhysicalMaterial({ color: 0x111112, metalness: 0, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 }), { box: true, paint: { dirt: 0.5, dust: 0.3 } });
    C.rubber = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.85 });
    const tr = SF.tread(B, small, 31);
    tiled(tr, 1, 1);
    C.tread = new THREE.MeshStandardMaterial({ map: tr.map, normalMap: tr.normalMap, roughnessMap: tr.ormMap, aoMap: tr.ormMap, roughness: 1, normalScale: new THREE.Vector2(1.4, 1.4) });
    C.sidewall = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.82, normalMap: TX.sidewallNormal(1024) });
    C.steelWheel = enhance(new THREE.MeshPhysicalMaterial({ color: 0x8c8e90, metalness: 0.9, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2 }), { box: true, paint: { dirt: 0.9, dust: 0.2 } });
    C.disc = new THREE.MeshStandardMaterial({ color: 0x5b4a3e, metalness: 0.8, roughness: 0.62 });
    C.glass = enhance(new THREE.MeshPhysicalMaterial({ color: 0x9da89a, roughness: 0.02, metalness: 0, ior: 1.52, side: THREE.DoubleSide }), { glass: { grimeMap: this.glassGrime, grime: 0.5, transmit: 0.72, variant: 'car' }, box: true });
    C.windscreen = enhance(new THREE.MeshPhysicalMaterial({ color: 0x9da89a, roughness: 0.02, metalness: 0, ior: 1.52, side: THREE.DoubleSide }), { glass: { grimeMap: SF.windscreenGrime(B, 512, 33), grime: 0.75, transmit: 0.72, variant: 'car' }, box: true });
    C.mirror = enhance(new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.02 }), { box: true });
    C.lens = enhance(new THREE.MeshPhysicalMaterial({ color: 0xf2f2ee, roughness: 0.04, metalness: 0, ior: 1.5, side: THREE.DoubleSide, opacity: 1, normalMap: this.fluted || (this.fluted = TX.flutedNormal(256)) }), { glass: { grimeMap: this.glassGrime, grime: 0.35, transmit: 0.9, variant: 'lens' }, box: true });
    C.reflector = enhance(new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12 }), { box: true });
    C.tail = enhance(new THREE.MeshPhysicalMaterial({ color: 0x5a0605, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0x300000, normalMap: this.fluted || (this.fluted = TX.flutedNormal(256)), normalScale: new THREE.Vector2(0.6, 0.6) }), { box: true });
    C.amber = enhance(new THREE.MeshPhysicalMaterial({ color: 0xa04f08, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0x180800, normalMap: C.tail.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) }), { box: true });
    C.reverse = enhance(new THREE.MeshPhysicalMaterial({ color: 0xdedcd6, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, normalMap: C.tail.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) }), { box: true });
    C.seat = new THREE.MeshStandardMaterial({ ...(() => { const c = SF.cloth(B, 256, 0x5a4636, 32); tiled(c, 0.25, 0.25); return { map: c.map, normalMap: c.normalMap, roughnessMap: c.ormMap }; })(), roughness: 1 });
    C.dash = new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.7 });
    C.carpet = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1 });
    C.under = new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.95 });
    C.plate = null; // licence plates are made per car (text)
    C.burntShell = this.world.burnt;
    C.char = new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.95 });
    for (const k in C) if (C[k] && C[k].isMaterial) C[k].name = 'car_' + k;
  }
}
