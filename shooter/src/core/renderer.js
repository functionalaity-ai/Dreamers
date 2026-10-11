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
import { makeSky } from './sky.js';
import { SHARED } from './shaderlib.js';
import { Volumetrics, DustMotes } from './volumetrics.js';
import { Ash, Flock } from './ambient.js';
import { makeGradeMaterial } from './grade.js';

// A low late-afternoon sun from the south-south-west, raking the north side of the square.
export const SUN_DIR = new THREE.Vector3(-0.42, 0.37, 0.86).normalize();
const SUN_COLOR = 0xffc98f;

// Materials whose shadows move with the wind (never cached).
const SWAY = /^(bark|leafCards)/;

export class Renderer {
  constructor(canvas) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    // Only the gunsmith studio renders straight to the screen; the world is graded by hand.
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.85;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    // The sun's shadow map is redrawn when render() asks for it, not on every render call
    // (the scope's picture-in-picture would otherwise draw it twice a frame).
    r.shadowMap.autoUpdate = false;
    r.info.autoReset = false;
    this.r = r;
    this.canvas = canvas;
    this.renderScale = 1;
    this.superSample = 1;
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
    this.ash = new Ash(this.scene);
    this.flock = new Flock(this.scene);
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
    this.sky = makeSky(SUN_DIR);
    this.scene.add(this.sky);

    // Image-based lighting from the same sky, with a warm ground bounce below the horizon.
    this.envScene = new THREE.Scene();
    this.envSky = makeSky(SUN_DIR);
    this.envScene.add(this.envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 16), new THREE.MeshBasicMaterial({ color: 0x3d3128 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -10;
    this.envScene.add(ground);
    this.buildEnv();

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
    this.installShadowCache();
    this.sun = sun;
    this.hemi = new THREE.HemisphereLight(0xa9bdd6, 0x6a5240, 0.4);
    this.scene.add(this.hemi);
    // Warm bounce from the sunlit north facades back into the shaded side of the square.
    // (Both are stand-ins until the baked bounce light takes over: see useBakedLight.)
    this.bounce = new THREE.DirectionalLight(0xffc896, 0.55);
    this.bounce.position.set(0.15, 0.35, -1).multiplyScalar(100);
    this.scene.add(this.bounce);
    this.gi = null;

    // First-person weapon lighting mirrors the world's.
    this.vSun = new THREE.DirectionalLight(0xffd0a0, 2.8);
    this.vSun.position.copy(SUN_DIR);
    this.vScene.add(this.vSun);
    // Self-shadowing for the gun and hands: a small frustum around where the weapon sits.
    this.vSun.target.position.set(0.06, -0.12, -0.34);
    this.vScene.add(this.vSun.target);
    const vs = this.vSun.shadow;
    vs.mapSize.set(1024, 1024);
    Object.assign(vs.camera, { left: -0.42, right: 0.42, top: 0.42, bottom: -0.42, near: 0.05, far: 3 });
    vs.bias = -0.0004;
    vs.normalBias = 0.0025;
    this.vHemi = new THREE.HemisphereLight(0xb7c6d8, 0x5d4c3c, 0.7);
    this.vScene.add(this.vHemi);
    this.vScene.add(this.vCamera);
  }

  buildEnv() {
    const pm = new THREE.PMREMGenerator(this.r);
    const old = this.env;
    this.env = pm.fromScene(this.envScene, 0.02).texture;
    pm.dispose();
    this.scene.environment = this.env;
    this.vScene.environment = this.env;
    if (old) old.dispose();
  }

  // Clouds need the GPU baker, which exists once the materials are being built.
  setClouds(tex) {
    for (const s of [this.sky, this.envSky]) { s.material.uniforms.tCloud.value = tex; s.material.uniforms.cloudOn.value = 1; }
    this.buildEnv();
    SHARED.tCloud.value = tex;
    SHARED.cloudShadow.value.w = 0.5;
    // a CPU copy so the first-person weapon can tell when a cloud covers the sun
    const rt = tex.userData.rt;
    if (rt) {
      this.cloudCPU = { w: rt.width, h: rt.height, data: new Uint8Array(rt.width * rt.height * 4) };
      this.r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, this.cloudCPU.data);
    }
  }

  // Cloud shadow at a world position (1 = clear sun), mirroring the shader's cloudShade().
  cloudShadeAt(p) {
    const C = this.cloudCPU, cs = SHARED.cloudShadow.value;
    if (!C || cs.w <= 0) return 1;
    const v = p.clone().applyMatrix4(this.sun.shadow.matrix);
    const fetch = (u, w, ch) => {
      const x = ((Math.floor((u * C.w)) % C.w) + C.w) % C.w, y = ((Math.floor((w * C.h)) % C.h) + C.h) % C.h;
      return C.data[(y * C.w + x) * 4 + ch] / 255;
    };
    const px = v.x * cs.z + cs.x, py = v.y * cs.z * 0.82 + cs.y;
    const n = fetch(px, py, 0) * 0.5 + fetch(px * 2.7 + 0.17, py * 2.7 + 0.17, 1) * 0.4 + 0.05;
    const t = Math.min(1, Math.max(0, (n - 0.47) / 0.19));
    return 1 - t * t * (3 - 2 * t) * cs.w;
  }

  // The baked volume (bounce.js) now carries the bounce and the sky's occlusion: the flat fill
  // lights step back to what's left, a little sky and no fixed bounce direction. The bounce
  // is lifted a touch over its physical value so the shade stays readable.
  useBakedLight(gi) {
    this.gi = gi;
    this.hemi.intensity = 0.36;
    this.hemi.groundColor.setHex(0x3a3028);
    this.bounce.intensity = 0;
    SHARED.giBounce.value = 1.4;
  }

  // The weapon is drawn in its own scene: point its lights the way the real sun and sky lie
  // relative to the camera, and dim the sun when you stand in shadow or indoors.
  setIndoor(f) { this.indoorF = f; }
  setViewSun(v) { this.viewSun = v; }
  syncViewLights() {
    const cam = this.camera;
    const qi = cam.quaternion.clone().invert();
    this.vSun.position.copy(SUN_DIR).applyQuaternion(qi).multiplyScalar(1.4).add(this.vSun.target.position);
    this.vHemi.position.set(0, 1, 0).applyQuaternion(qi);
    const f = this.indoorF || 0, sv = this.viewSun === undefined ? 1 : this.viewSun;
    this.vSun.intensity = 3.4 * (1 - f * 0.9) * (0.08 + 0.92 * sv);
    this.vHemi.intensity = 1.05 * (1 - f * 0.45);
    if (this.gi) {
      // the sky and the bounce where you stand, eased so walking past a doorway doesn't flicker
      const s = this.gi.sample(cam.position, this._giS || (this._giS = {}));
      const k = this._giK || (this._giK = { vis: s.vis, warm: 0, at: cam.position.clone() });
      const warm = Math.min(1, (s.r * 0.6 + s.g * 0.3) * 0.9);
      // a respawn (or any jump) starts afresh rather than fading over from the last place
      const e = k.at.distanceToSquared(cam.position) > 9 ? 1 : 0.08;
      k.at.copy(cam.position);
      k.vis += (s.vis - k.vis) * e;
      k.warm += (warm - k.warm) * e;
      this.vHemi.intensity *= 0.65 + 0.4 * k.vis;
      this.vHemi.groundColor.setRGB(0.11 + 0.19 * k.warm, 0.072 + 0.1 * k.warm, 0.045 + 0.035 * k.warm);
    }
    SHARED.vmRot.value.setFromMatrix4(cam.matrixWorld);
  }

  // The town never moves, the sun never moves, and the sun's shadow camera is fixed over the whole
  // map. So the town's shadow is drawn once into a cache, and each frame the cache is copied into
  // the sun's shadow map (colour and depth) and only what can move (characters, swaying trees,
  // effects) is drawn on top: the same shadow map, without re-drawing millions of triangles.
  // freezeStatic also stops the per-frame matrix updates under the town's groups.
  // Roots flagged userData.dynamic (the big map's loot containers) are left out.
  freezeStatic(roots) {
    const list = [];
    for (const root of roots) {
      if (root.userData && root.userData.dynamic) continue;
      root.updateMatrixWorld(true);
      root.matrixWorldAutoUpdate = false;
      root.traverse((o) => { if (o.isMesh && !(o.material && SWAY.test(o.material.name))) list.push(o); });
    }
    this.statics = list;
    this.staticCast = new Array(list.length);
    this.staticSet = new Set(list);
    this.shadowCacheOK = false;
  }

  // The big map: the sun's shadow box (the same size as over the town) follows `center`, snapped
  // to a 32 m grid so the cached static shadow is redrawn only when the snap moves.
  followShadow(center) {
    const sun = this.sun, sx = Math.round(center.x / 32) * 32, sz = Math.round(center.z / 32) * 32;
    if (this._shadowAt && this._shadowAt.x === sx && this._shadowAt.z === sz) return false;
    this._shadowAt = { x: sx, z: sz };
    sun.target.position.set(sx, 0, sz);
    sun.position.copy(SUN_DIR).multiplyScalar(140).add(sun.target.position);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    this.shadowCacheOK = false;
    return true;
  }

  installShadowCache() {
    const r = this.r, sm = r.shadowMap;
    const render = sm.render.bind(sm), clear = r.clear.bind(r);
    // inside the sun's shadow pass, "clear" becomes "copy the cached town shadow in"
    r.clear = (color = true, depth = true, stencil = true) => {
      if (this.shadowFill && r.getRenderTarget() === this.sun.shadow.map) { this.shadowFill(); return; }
      clear(color, depth, stencil);
    };
    sm.render = (lights, scene, camera) => {
      const sun = this.sun, map = sun && sun.shadow.map, cache = this.shadowCache;
      if (!this.statics || lights.length !== 1 || lights[0] !== sun || !map || !cache || this.shadowCacheMap !== map) return render(lights, scene, camera);
      if (!this.shadowCacheOK) {
        // draw the town alone, keep it
        const hidden = [];
        scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && o.castShadow && !this.staticSet.has(o)) { o.castShadow = false; hidden.push(o); } });
        render(lights, scene, camera);
        for (const o of hidden) o.castShadow = true;
        this.blitRT(map, cache);
        this.shadowCacheOK = true;
        sm.needsUpdate = true;
      }
      const st = this.statics, cs = this.staticCast;
      for (let i = 0; i < st.length; i++) { cs[i] = st[i].castShadow; st[i].castShadow = false; }
      this.shadowFill = () => this.blitRT(cache, map);
      render(lights, scene, camera);
      this.shadowFill = null;
      for (let i = 0; i < st.length; i++) st[i].castShadow = cs[i];
    };
  }

  // Copy colour and depth between two same-sized render targets.
  blitRT(src, dst) {
    const r = this.r, gl = r.getContext(), P = r.properties;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, P.get(src).__webglFramebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, P.get(dst).__webglFramebuffer);
    gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, dst.width, dst.height, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    const cur = r.getRenderTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur ? P.get(cur).__webglFramebuffer : null);
  }

  // A cache target matching the sun's current shadow map (it is remade when a preset changes).
  syncShadowCache() {
    const map = this.sun.shadow.map;
    if (!this.statics || !map || this.shadowCacheMap === map) return;
    if (this.shadowCache) this.shadowCache.dispose();
    this.shadowCache = new THREE.WebGLRenderTarget(map.width, map.height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.r.setRenderTarget(this.shadowCache); // allocates its framebuffer
    this.shadowCacheMap = map;
    this.shadowCacheOK = false;
  }

  applyPreset(preset) {
    this.preset = preset;
    if (!preset.adaptive) this.renderScale = 1;
    this.r.shadowMap.type = preset.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.shadowCacheOK = false;
    this.r.shadowMap.needsUpdate = true;
    this.vol.configure(preset);
    this.vSun.castShadow = !!preset.vmShadows;
    this.dust.setCount(preset.dust || 2000);
    // Window frames and shutter louvres are the densest shadow casters; Medium skips them.
    const win = this.scene.getObjectByName('windows');
    if (win) win.traverse((o) => { if (o.isInstancedMesh) o.castShadow = preset.windowShadows !== false && !o.material.transparent && o.userData.cast !== false; });
    this.scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } });
    this.resize();
  }

  // Dynamic resolution (Mobile preset): trade sharpness for frame rate.
  setRenderScale(s) {
    if (Math.abs(s - this.renderScale) < 0.01) return;
    this.renderScale = s;
    this.resize();
  }

  // Supersampling: draw above the screen's resolution and let the browser scale it down
  // (200% on a 4K screen renders every frame at 7680×4320). The adaptive Mobile preset ignores it.
  setSuperSample(s) {
    this.superSample = s;
    if (this.preset) this.resize();
  }

  // Drawing-buffer pixels per CSS pixel, held to 8K and to the GPU's largest render target.
  pixelRatio(w, h) {
    const P = this.preset;
    let k = Math.min(window.devicePixelRatio || 1, P.pixelRatio) * this.renderScale;
    if (!P.adaptive) k *= this.superSample;
    if (!this.maxSide) {
      const gl = this.r.getContext();
      this.maxSide = Math.min(this.r.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    }
    return Math.min(k, Math.sqrt((7680 * 4320) / (w * h)), this.maxSide / Math.max(w, h));
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
    this.bloom = P.bloom ? new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.62, 1.0) : null;
    if (this.bloom) this.bloom.bloomTintColors.forEach((t, i) => t.set(1.0, 0.86 - i * 0.02, 0.66 - i * 0.03));
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
    if (this.preset) this.r.setPixelRatio(this.pixelRatio(w, h));
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
    this.ash.points.visible = false;
    for (const m of this.flock.meshes) m.visible = false;
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
    this.ash.points.visible = true;
    for (const m of this.flock.meshes) m.visible = true;
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
      // the studio isn't in the town: keep the town's baked light off its guns
      const gi = SHARED.giOn.value;
      SHARED.giOn.value = 0;
      r.setRenderTarget(null);
      r.render(alt.scene, alt.camera);
      SHARED.giOn.value = gi;
      return;
    }
    this.dust.update(dt, this.camera, this.size.y);
    this.ash.update(dt, this.camera, this.size.y);
    this.flock.update(dt);
    this.sky.material.uniforms.uTime.value += dt;
    SHARED.time.value += dt;
    SHARED.cloudShadow.value.x += 0.0016 * dt;
    SHARED.cloudShadow.value.y += 0.0006 * dt;
    this.syncViewLights();
    this.frameNo = (this.frameNo || 0) + 1;
    if (this.frameNo % ((this.preset && this.preset.shadowEvery) || 1) === 0) r.shadowMap.needsUpdate = true;
    this.syncShadowCache();
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
    if (this.vSun.castShadow) r.shadowMap.needsUpdate = true;
    r.render(this.vScene, this.vCamera);
    r.autoClear = true;
    if (this.bloom) this.bloom.render(r, null, cur, dt, false);
    // Grade, then anti-alias to the screen.
    this.grade.uniforms.tDiffuse.value = cur.texture;
    this.grade.uniforms.time.value += dt;
    this.quad.material = this.grade;
    r.setRenderTarget(this.aa ? this.rtLDR : null);
    this.quad.render(r);
    if (this.aa) this.aa.render(r, null, this.rtLDR);
    // Last, straight to the screen: the red-dot reticle (layer 2), ungraded and unbloomed.
    const vl = this.vCamera.layers.mask;
    this.vCamera.layers.set(2);
    r.setRenderTarget(null);
    r.autoClear = false;
    r.render(this.vScene, this.vCamera);
    r.autoClear = true;
    this.vCamera.layers.mask = vl;
  }
}
