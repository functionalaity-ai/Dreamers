// Renderer: sky, golden-hour sun, image-based lighting, shadows and the post-processing chain.
//
// Frame graph (render targets are explicit so the world's depth survives for the effects):
//   world   → sceneRT (HDR colour + depth texture)
//   GTAO    → ambient occlusion from that depth
//   volume  → raymarched god rays and height haze (see volumetrics.js)
//   weapon  → the first-person viewmodel, drawn on a cleared depth so it never clips walls
//   bloom   → soft highlights
//   grade   → filmic tone curve, split toning, vignette, dither
//   AA      → SMAA or FXAA to the screen
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Volumetrics, DustMotes } from './volumetrics.js';
import { makeGradeMaterial } from './grade.js';

// A low late-afternoon sun from the south-south-west, raking the north side of the square.
export const SUN_DIR = new THREE.Vector3(-0.42, 0.37, 0.86).normalize();
const SUN_COLOR = 0xffc98f;
const SKY = { turbidity: 6.5, rayleigh: 2.1, mieCoefficient: 0.0075, mieDirectionalG: 0.88 };

export class Renderer {
  constructor(canvas) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    // Only the gunsmith studio renders straight to the screen; the world is graded by hand.
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.85;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.info.autoReset = false;
    this.r = r;
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(90, 1, 0.05, 900);
    this.vScene = new THREE.Scene();
    this.vCamera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
    this.preset = null;
    this.extraScene = null;
    this.size = new THREE.Vector2();
    this.clock = performance.now();
    this.setupSky();
    this.vol = new Volumetrics(r, this.scene, this.camera, this.sun);
    this.dust = new DustMotes(this.scene, this.sun, 5000);
    this.grade = makeGradeMaterial();
    this.quad = new FullScreenQuad(this.grade);
    // The box-projected reflection probe (filled in by captureProbe once the town is built).
    this.probe = {
      texture: null,
      uniforms: { probePos: { value: new THREE.Vector3() }, boxMin: { value: new THREE.Vector3(-1e4, -1e4, -1e4) }, boxMax: { value: new THREE.Vector3(1e4, 1e4, 1e4) } },
      materials: [],
    };
  }

  setupSky() {
    const makeSky = () => {
      const sky = new Sky();
      sky.scale.setScalar(4000);
      const u = sky.material.uniforms;
      for (const k in SKY) u[k].value = SKY[k];
      u.sunPosition.value.copy(SUN_DIR).multiplyScalar(4000);
      return sky;
    };
    this.sky = makeSky();
    this.scene.add(this.sky);

    // Image-based lighting from the same sky, with a warm ground bounce below the horizon.
    const pm = new THREE.PMREMGenerator(this.r);
    const envScene = new THREE.Scene();
    envScene.add(makeSky());
    const ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 16), new THREE.MeshBasicMaterial({ color: 0x3d3128 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -10;
    envScene.add(ground);
    this.env = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();
    this.scene.environment = this.env;
    this.vScene.environment = this.env;

    // Fallback distance fog, used where the volumetric pass doesn't run (the scope's view, reflections).
    this.fogDensity = 0.0042;
    this.scene.fog = new THREE.FogExp2(0xc9ab84, this.fogDensity);

    const sun = new THREE.DirectionalLight(SUN_COLOR, 5.2);
    sun.position.copy(SUN_DIR).multiplyScalar(140);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -80; sc.right = 80; sc.top = 66; sc.bottom = -66; sc.near = 20; sc.far = 330;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 2;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.hemi = new THREE.HemisphereLight(0xa9bdd6, 0x6a5240, 0.4);
    this.scene.add(this.hemi);
    // Warm bounce from the sunlit north facades back into the shaded side of the square.
    this.bounce = new THREE.DirectionalLight(0xffc896, 0.55);
    this.bounce.position.set(0.15, 0.35, -1).multiplyScalar(100);
    this.scene.add(this.bounce);

    // First-person weapon lighting mirrors the world's.
    this.vSun = new THREE.DirectionalLight(0xffd0a0, 2.8);
    this.vSun.position.copy(SUN_DIR);
    this.vScene.add(this.vSun);
    this.vHemi = new THREE.HemisphereLight(0xb7c6d8, 0x5d4c3c, 0.7);
    this.vScene.add(this.vHemi);
    this.vScene.add(this.vCamera);
  }

  // Indoors the weapon should not be sunlit.
  setIndoor(f) {
    this.vSun.intensity = 2.8 * (1 - f * 0.85);
    this.vHemi.intensity = 0.7 * (1 - f * 0.45);
  }

  applyPreset(preset) {
    this.preset = preset;
    const pr = Math.min(window.devicePixelRatio || 1, preset.pixelRatio);
    this.r.setPixelRatio(pr);
    this.r.shadowMap.type = preset.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.r.shadowMap.needsUpdate = true;
    this.vol.configure(preset);
    this.dust.setCount(preset.dust || 2000);
    // Window frames and shutter louvres are the densest shadow casters; Medium skips them.
    const win = this.scene.getObjectByName('windows');
    if (win) win.traverse((o) => { if (o.isInstancedMesh) o.castShadow = preset.windowShadows !== false && !o.material.transparent && o.userData.cast !== false; });
    this.scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } });
    this.resize();
  }

  buildPipeline() {
    const P = this.preset;
    this.r.getDrawingBufferSize(this.size);
    const w = this.size.x, h = this.size.y;
    for (const k of ['sceneRT', 'rtA', 'rtB', 'rtLDR']) if (this[k]) this[k].dispose();
    if (this.gtao) this.gtao.dispose();
    if (this.bloom) this.bloom.dispose();
    if (this.aa) this.aa.dispose && this.aa.dispose();
    const hdr = (depthTexture) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: depthTexture || null, depthBuffer: true });
    const depth = new THREE.DepthTexture(w, h);
    depth.type = THREE.UnsignedIntType;
    this.sceneRT = hdr(depth);
    this.rtA = hdr();
    this.rtB = hdr();
    this.rtLDR = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
    this.gtao = null;
    if (P.ao) {
      const s = P.aoRes || 1;
      const g = new GTAOPass(this.scene, this.camera, Math.round(w * s), Math.round(h * s));
      g.setGBuffer(depth, undefined); // reuse the world pass's depth; normals are rebuilt from it
      g.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.6, thickness: 1.4, scale: 1.3, samples: s >= 1 ? 16 : 12, distanceFallOff: 1, screenSpaceRadius: false });
      g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      g.blendIntensity = 1.0;
      this.gtao = g;
    }
    this.vol.setSize(w, h);
    this.bloom = P.bloom ? new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.5, 1.1) : null;
    this.aa = null;
    if (P.aa === 'smaa') this.aa = new SMAAPass(w, h);
    else if (P.aa === 'fxaa') {
      this.aa = new ShaderPass(FXAAShader);
      this.aa.material.uniforms.resolution.value.set(1 / w, 1 / h);
    }
    if (this.aa) this.aa.renderToScreen = true;
    this.grade.uniforms.aspect.value = w / h;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.width = w; this.height = h;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vCamera.aspect = w / h;
    this.vCamera.updateProjectionMatrix();
    if (this.preset) this.buildPipeline();
  }

  // Bakes a reflection cube of the finished town for glass, car paint and chrome.
  // Reflections are box-projected against `box` so they line up with the street walls.
  captureProbe(position, box, hide = []) {
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    this.dust.points.visible = false;
    const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cam = new THREE.CubeCamera(0.1, 600, cubeRT);
    cam.position.copy(position);
    this.scene.add(cam);
    cam.update(this.r, this.scene);
    this.scene.remove(cam);
    const pm = new THREE.PMREMGenerator(this.r);
    const tex = pm.fromCubemap(cubeRT.texture).texture;
    pm.dispose();
    cubeRT.dispose();
    hide.forEach((o, i) => { o.visible = vis[i]; });
    this.dust.points.visible = true;
    const u = this.probe.uniforms;
    u.probePos.value.copy(position);
    u.boxMin.value.copy(box.min);
    u.boxMax.value.copy(box.max);
    this.probe.texture = tex;
    for (const m of this.probe.materials) { m.envMap = tex; m.needsUpdate = true; }
  }

  // Swap in a different scene (gunsmith studio) without the world passes.
  render(alt) {
    const r = this.r;
    r.info.reset();
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.clock) / 1000);
    this.clock = now;
    if (alt) {
      r.setRenderTarget(null);
      r.render(alt.scene, alt.camera);
      return;
    }
    this.dust.update(dt, this.camera, this.size.y);
    // World: the volumetric pass replaces the distance fog.
    this.scene.fog.density = 0;
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, this.camera);
    this.scene.fog.density = this.fogDensity;
    let cur = this.sceneRT;
    if (this.gtao) { this.gtao.render(r, this.rtA, this.sceneRT); cur = this.rtA; }
    const out = cur === this.rtA ? this.rtB : this.rtA;
    this.vol.render(dt, this.sceneRT.depthTexture, cur, out);
    cur = out;
    // First-person weapon on top, with its own depth.
    r.setRenderTarget(cur);
    r.autoClear = false;
    r.clearDepth();
    r.render(this.vScene, this.vCamera);
    r.autoClear = true;
    if (this.bloom) this.bloom.render(r, null, cur, dt, false);
    // Grade, then anti-alias to the screen.
    this.grade.uniforms.tDiffuse.value = cur.texture;
    this.quad.material = this.grade;
    r.setRenderTarget(this.aa ? this.rtLDR : null);
    this.quad.render(r);
    if (this.aa) this.aa.render(r, null, this.rtLDR);
  }
}
