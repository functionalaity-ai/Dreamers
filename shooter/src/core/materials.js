// Material library. World geometry carries UVs in metres; each material's
// textures repeat at their real-world tile size.
import * as THREE from 'three';
import * as TX from './textures.js';

function tiled(set, tileW, tileH, anisotropy) {
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    const t = set[k];
    if (!t) continue;
    t.repeat.set(1 / tileW, 1 / (tileH || tileW));
    t.anisotropy = anisotropy;
  }
  return set;
}

export class Materials {
  constructor(preset) {
    this.preset = preset;
    this.world = {};
    this.gun = {};
    this.char = {};
  }

  // Builds everything, yielding between steps so a loading bar can repaint.
  async build(progress) {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const P = this.preset;
    const size = P.textureSize;
    const an = P.anisotropy;
    const W = this.world;
    const std = function (set, opts) {
      return new THREE.MeshStandardMaterial(Object.assign({
        map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1, metalness: 0,
      }, opts || {}));
    };
    const steps = [
      () => { W.cobble = std(tiled(TX.cobblestone(size), 2.2, 2.2, an), { normalScale: new THREE.Vector2(1.4, 1.4) }); },
      () => { W.asphalt = std(tiled(TX.asphalt(size / 2), 4, 4, an)); },
      () => { const c = TX.concrete(size / 2); W.concrete = std(tiled(c, 3, 3, an)); W.sidewalk = std(tiled(TX.concrete(size / 2, 1.18), 1.5, 1.5, an)); },
      () => { W.brick = std(tiled(TX.brick(size), 1.2, 1.2, an), { normalScale: new THREE.Vector2(1.3, 1.3) }); },
      () => { W.brickPale = std(tiled(TX.brick(size, 1), 1.2, 1.2, an)); },
      () => {
        W.plasterCream = std(tiled(TX.plaster(size / 2, 0xd8c7a3, 1), 3, 3, an));
        W.plasterOchre = std(tiled(TX.plaster(size / 2, 0xc89c62, 2), 3, 3, an));
        W.plasterSage = std(tiled(TX.plaster(size / 2, 0xa9b39a, 3), 3, 3, an));
        W.plasterWhite = std(tiled(TX.plaster(size / 2, 0xe6e1d6, 4), 3, 3, an));
      },
      () => { W.woodFloor = std(tiled(TX.woodPlanks(size / 2), 2, 2, an)); W.woodDark = std(tiled(TX.woodPlanks(size / 2, 1), 1.4, 1.4, an)); },
      () => { W.roof = std(tiled(TX.roofTiles(size / 2), 2, 2, an)); },
      () => {
        W.facadeA = std(tiled(TX.facadeBay(size, 0xcdb894, 0x4f6a52, 5), 3.5, 3.4, an), { roughness: 1 });
        W.facadeB = std(tiled(TX.facadeBay(size, 0xb98f6a, 0x6a4a34, 6), 3.5, 3.4, an), { roughness: 1 });
        W.facadeC = std(tiled(TX.facadeBay(size, 0xc7c3b6, 0x3e5568, 7), 3.5, 3.4, an), { roughness: 1 });
      },
    ];
    for (let i = 0; i < steps.length; i++) {
      steps[i]();
      if (progress) progress((i + 1) / (steps.length + 3));
      await tick();
    }
    W.sandbag = new THREE.MeshStandardMaterial({ color: 0xa08d68, roughness: 0.95, normalMap: W.plasterCream.normalMap, normalScale: new THREE.Vector2(2, 2) });
    W.trim = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.7 });
    W.darkMetal = new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.55, metalness: 0.8 });
    W.rust = new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.9, metalness: 0.4 });
    W.glass = new THREE.MeshStandardMaterial({ color: 0x1a2128, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.2 });
    W.tire = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 });
    W.chrome = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.15, metalness: 1 });
    W.burnt = new THREE.MeshStandardMaterial({ color: 0x2a2522, roughness: 0.95, metalness: 0.3 });
    W.carRed = new THREE.MeshPhysicalMaterial({ color: 0x7a1d1a, roughness: 0.38, metalness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    W.carBlue = new THREE.MeshPhysicalMaterial({ color: 0x23384f, roughness: 0.38, metalness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    W.carWhite = new THREE.MeshPhysicalMaterial({ color: 0xc9c6bd, roughness: 0.4, metalness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    W.carGreen = new THREE.MeshPhysicalMaterial({ color: 0x3c4a35, roughness: 0.45, metalness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    W.leaves = new THREE.MeshStandardMaterial({ color: 0x4a5a2c, roughness: 0.85, flatShading: true });
    W.leavesAutumn = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.85, flatShading: true });
    W.bark = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95, normalMap: W.woodDark.normalMap });
    W.water = new THREE.MeshStandardMaterial({ color: 0x1d3a3a, roughness: 0.04, metalness: 0.2 });
    W.bronze = new THREE.MeshStandardMaterial({ color: 0x4f6656, roughness: 0.45, metalness: 0.85 });
    W.canvasGreen = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.95, side: THREE.DoubleSide });
    W.canvasRed = new THREE.MeshStandardMaterial({ color: 0x8a3a2a, roughness: 0.95, side: THREE.DoubleSide });
    W.canvasStripe = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.95, side: THREE.DoubleSide });
    W.fabric = new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.95 });
    W.paper = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.9 });
    W.lampGlow = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffd890, emissiveIntensity: 2.2 });
    // Leaf cards: alpha-tested clusters, with matching depth materials for shadows.
    for (const [key, tint] of [['leafCards', 0], ['leafCardsAutumn', 1]]) {
      const tex = TX.leafCluster(512, tint);
      const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82 });
      m.userData.depth = new THREE.MeshDepthMaterial({ map: tex, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
      W[key] = m;
    }
    for (const k in W) { W[k].name = k; W[k].envMapIntensity = k === 'glass' ? 1.1 : k.indexOf('car') === 0 || k === 'chrome' ? 0.8 : 0.42; }

    // Guns
    const wear = TX.gunWear(256);
    const st = TX.stipple(256);
    for (const t of [wear.map, wear.normalMap, wear.roughnessMap]) { t.repeat.set(6, 6); t.anisotropy = an; }
    st.normalMap.repeat.set(22, 22); st.normalMap.anisotropy = an;
    const G = this.gun;
    G.anodized = new THREE.MeshStandardMaterial({ color: 0x36363a, metalness: 0.55, roughness: 0.9, roughnessMap: wear.roughnessMap, normalMap: wear.normalMap, normalScale: new THREE.Vector2(0.4, 0.4) });
    G.fde = new THREE.MeshStandardMaterial({ color: 0x8a7656, metalness: 0.1, roughness: 0.85, roughnessMap: wear.roughnessMap });
    G.steel = new THREE.MeshStandardMaterial({ color: 0x2b2c2f, metalness: 0.9, roughness: 1, roughnessMap: wear.roughnessMap, normalMap: wear.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) });
    G.nickel = new THREE.MeshStandardMaterial({ color: 0xb4b2ac, metalness: 1, roughness: 0.28 });
    G.polymer = new THREE.MeshStandardMaterial({ color: 0x27282a, metalness: 0, roughness: 0.74, normalMap: st.normalMap, normalScale: new THREE.Vector2(0.25, 0.25) });
    G.rubber = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95 });
    G.brass = new THREE.MeshStandardMaterial({ color: 0xc9a35a, metalness: 1, roughness: 0.3 });
    G.copper = new THREE.MeshStandardMaterial({ color: 0xb8733a, metalness: 1, roughness: 0.32 });
    G.shell = new THREE.MeshStandardMaterial({ color: 0x9a2018, roughness: 0.55 });
    G.cerakote = new THREE.MeshStandardMaterial({ color: 0x3b3c37, metalness: 0.2, roughness: 0.7, roughnessMap: wear.roughnessMap });
    G.lens = new THREE.MeshStandardMaterial({ color: 0x0c1418, metalness: 1, roughness: 0.04, transparent: true, opacity: 0.55, envMapIntensity: 1.6 });
    G.lensTint = new THREE.MeshStandardMaterial({ color: 0x2a3a30, metalness: 0.8, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false });
    G.reticle = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, depthTest: false, depthWrite: false });
    G.laser = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    G.tritium = new THREE.MeshBasicMaterial({ color: 0x9cff7a });
    G.orange = new THREE.MeshStandardMaterial({ color: 0xc4602a, roughness: 0.6 });
    G.wood = new THREE.MeshStandardMaterial({ color: 0x6a4428, roughness: 0.55, map: this.world.woodDark.map });
    G.glove = new THREE.MeshStandardMaterial({ color: 0x3a3a34, roughness: 0.85, normalMap: st.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) });
    G.gloveTan = new THREE.MeshStandardMaterial({ color: 0x7a6a50, roughness: 0.9 });
    for (const k in G) { G[k].name = 'gun_' + k; if (G[k].isMeshStandardMaterial) G[k].envMapIntensity = k === 'lens' ? 1.4 : 0.75; }
    if (progress) progress((steps.length + 1) / (steps.length + 3));

    // Characters
    for (const scheme of ['msg', 'volk']) {
      const a = TX.characterAtlas(512, scheme);
      a.map.anisotropy = an;
      this.char[scheme] = new THREE.MeshStandardMaterial({ map: a.map, normalMap: a.normalMap, roughnessMap: a.roughnessMap, vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.4 });
    }
    // Sleeves for the first-person arms use the same camo.
    G.sleeve = new THREE.MeshStandardMaterial({ map: this.char.msg.map, normalMap: this.char.msg.normalMap, roughness: 0.95 });
    G.sleeve.map = this.char.msg.map.clone();
    G.sleeve.map.repeat.set(0.5, 0.5);
    G.sleeve.map.offset.set(0, 0.5); // camo lives in the atlas's top-left quadrant
    G.sleeve.map.needsUpdate = true;
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
}
