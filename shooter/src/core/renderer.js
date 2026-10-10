// Renderer: sky, sun, image-based lighting, shadows and the post-processing stack.
// The first-person weapon renders in its own pass (cleared depth) so it never clips walls.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { Sky } from 'three/addons/objects/Sky.js';

export const SUN_DIR = new THREE.Vector3(-0.72, 0.36, 0.52).normalize();

export class Renderer {
  constructor(canvas) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
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
    this.composer = null;
    this.extraScene = null; // e.g. the gunsmith studio
    this.setupSky();
  }

  setupSky() {
    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = 5.5;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.86;
    u.sunPosition.value.copy(SUN_DIR).multiplyScalar(4000);
    this.scene.add(sky);
    this.sky = sky;

    // Image-based lighting from the same sky.
    const pm = new THREE.PMREMGenerator(this.r);
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(4000);
    sky2.material.uniforms.turbidity.value = 5.5;
    sky2.material.uniforms.rayleigh.value = 1.6;
    sky2.material.uniforms.mieCoefficient.value = 0.006;
    sky2.material.uniforms.mieDirectionalG.value = 0.86;
    sky2.material.uniforms.sunPosition.value.copy(SUN_DIR).multiplyScalar(4000);
    envScene.add(sky2);
    // A warm "ground bounce" disc so reflections aren't lit from below by the sky.
    const ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 16), new THREE.MeshBasicMaterial({ color: 0x3a3028 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -10;
    envScene.add(ground);
    this.env = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();
    this.scene.environment = this.env;
    this.vScene.environment = this.env;

    this.scene.fog = new THREE.FogExp2(0xd2b893, 0.0034);

    const sun = new THREE.DirectionalLight(0xffd6a6, 4.6);
    sun.position.copy(SUN_DIR).multiplyScalar(140);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -78; sc.right = 78; sc.top = 62; sc.bottom = -62; sc.near = 20; sc.far = 320;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.hemi = new THREE.HemisphereLight(0xb7c6d8, 0x5d4c3c, 0.42);
    this.scene.add(this.hemi);

    // First-person weapon lighting mirrors the world's.
    this.vSun = new THREE.DirectionalLight(0xffdcb0, 2.6);
    this.vSun.position.copy(SUN_DIR);
    this.vScene.add(this.vSun);
    this.vHemi = new THREE.HemisphereLight(0xb7c6d8, 0x5d4c3c, 0.7);
    this.vScene.add(this.vHemi);
    this.vScene.add(this.vCamera);
  }

  // Indoors the weapon should not be sunlit.
  setIndoor(f) {
    this.vSun.intensity = 2.6 * (1 - f * 0.85);
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
    this.scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } });
    this.resize();
  }

  buildComposer() {
    const P = this.preset;
    const w = this.width, h = this.height;
    if (this.composer) this.composer.dispose();
    const c = new EffectComposer(this.r);
    this.mainPass = new RenderPass(this.scene, this.camera);
    c.addPass(this.mainPass);
    this.gtao = null;
    if (P.ao) {
      const s = P.aoRes || 1;
      const g = new GTAOPass(this.scene, this.camera, Math.round(w * s), Math.round(h * s));
      g.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.6, thickness: 1.2, scale: 1.25, samples: P.aoRes >= 1 ? 16 : 10, distanceFallOff: 1, screenSpaceRadius: false });
      g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      g.blendIntensity = 0.9;
      c.addPass(g);
      this.gtao = g;
    }
    this.viewPass = new RenderPass(this.vScene, this.vCamera);
    this.viewPass.clear = false;
    this.viewPass.clearDepth = true;
    c.addPass(this.viewPass);
    if (P.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.24, 0.45, 0.93));
    c.addPass(new OutputPass());
    const pr = this.r.getPixelRatio();
    if (P.aa === 'smaa') c.addPass(new SMAAPass(w * pr, h * pr));
    else if (P.aa === 'fxaa') {
      const f = new ShaderPass(FXAAShader);
      f.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
      c.addPass(f);
    }
    this.composer = c;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.width = w; this.height = h;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vCamera.aspect = w / h;
    this.vCamera.updateProjectionMatrix();
    if (this.preset) this.buildComposer();
  }

  // Swap in a different scene (gunsmith studio) without the world passes.
  render(alt) {
    this.r.info.reset();
    if (alt) {
      this.r.setRenderTarget(null);
      this.r.render(alt.scene, alt.camera);
      return;
    }
    this.composer.render();
  }
}
