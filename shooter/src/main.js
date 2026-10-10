// Iron Meridian — boot, screens and the main loop.
import * as THREE from 'three';
import { Renderer } from './core/renderer.js';
import { Materials } from './core/materials.js';
import { Audio } from './core/audio.js';
import { Input } from './core/input.js';
import { Game } from './game/game.js';
import { HUD } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { Studio } from './ui/studio.js';
import { Humanoid } from './characters/humanoid.js';
import { buildGun, bakeGun } from './weapons/gunmodels.js';
import { PRESETS, DEFAULT_SETTINGS, DEFAULT_LOADOUTS } from './config.js';
import { SHARED, SHARED_PROBE_MATS, linkProbe } from './core/shaderlib.js';
import { SUN_DIR } from './core/renderer.js';
import { cloudTexture } from './core/sky.js';
import { bakeBounce } from './core/bounce.js';
import { TouchControls, isTouchDevice } from './core/touch.js';
import { renderKeyArt, ART_ASPECT } from './ui/keyart.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const SETTINGS_KEY = 'iron-meridian-settings-v1', LOADOUTS_KEY = 'iron-meridian-loadouts-v1';
const TIPS = [
  'Interior walls are drywall. Bullets go through them; brick and concrete stop them.',
  'Tactical reloads keep a round in the chamber: 30 + 1.',
  'Enemies hear unsuppressed shots from 70 m away. A suppressor cuts that to about 20.',
  'Shots far away arrive late: sound travels at 343 metres per second.',
  'Inside buildings you are harder to spot. Crouch or go prone to stay hidden longer.',
  'Shallow-angle hits on stone and metal can ricochet.',
];
const SPRINT_TIP = {
  keys: 'Double-tap Shift while sprinting for a short tactical sprint.',
  touch: 'Push the thumbstick to the rim twice in quick succession for a short tactical sprint.',
};

class App {
  async boot() {
    // Phones and tablets get thumb controls instead of pointer lock (also switched on by a first touch).
    this.touchMode = false;
    if (isTouchDevice()) this.enableTouch();
    window.addEventListener('touchstart', () => this.enableTouch(), { once: true, passive: true });
    const tips = TIPS.concat(this.touchMode ? SPRINT_TIP.touch : SPRINT_TIP.keys);
    $('load-tip').textContent = tips[Math.floor(Math.random() * tips.length)];
    const saved = store.get(SETTINGS_KEY, {});
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    if (!saved.preset && this.touchMode) this.settings.preset = 'mobile';
    if (!PRESETS[this.settings.preset]) this.settings.preset = 'high';
    if (![1, 1.5, 2].includes(this.settings.superSample)) this.settings.superSample = 1;
    if (typeof this.settings.loadout !== 'number') this.settings.loadout = 0;
    this.loadouts = store.get(LOADOUTS_KEY, null) || JSON.parse(JSON.stringify(DEFAULT_LOADOUTS));
    const canvas = $('view');
    this.R = new Renderer(canvas);
    this.R.superSample = this.settings.superSample;
    const preset = PRESETS[this.settings.preset];
    this.embers();
    const ring = $('load-ring'), pct = $('load-pct');
    const step = (t, label) => {
      const p = Math.round(t * 100);
      $('load-bar').style.width = p + '%';
      if (ring) ring.style.strokeDashoffset = (131.95 * (1 - t)).toFixed(2);
      if (pct) pct.textContent = p + '%';
      if (label) $('load-step').textContent = label;
    };
    step(0.02, 'operators');
    await frame();
    linkProbe(this.R.probe.uniforms);
    SHARED.sunDirW.value.copy(SUN_DIR);
    SHARED.sunColorW.value.copy(this.R.sun.color).multiplyScalar(this.R.sun.intensity);
    SHARED.ambW.value.setRGB(0.55, 0.62, 0.75);
    this.mats = await new Materials(preset, this.R.r).build((t) => step(t * 0.7, 'textures'), (m) => this.keyArt(m));
    this.R.setClouds(cloudTexture(this.mats.baker));
    step(0.72, 'streets and buildings'); await frame();
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume);
    this.game = new Game(this.R, this.mats, this.audio);
    this.game.load();
    this.R.vol.setIndoor(this.game.map.indoor);
    // bounce light, baked once the town exists (and before the reflections, which then show it)
    step(0.74, 'lighting'); await frame();
    try {
      await bakeBounce(this.R, this.game, preset, (t) => step(0.74 + 0.06 * t, 'lighting'));
    } catch (e) {
      console.warn('Bounce light skipped:', e);
    }
    step(0.8, 'reflections'); await frame();
    this.captureReflections();
    step(0.9, 'operators'); await frame();
    this.hud = new HUD(this.game, this.settings);
    this.game.hud = this.hud;
    const banner = this.hud.matchOver.bind(this.hud);
    this.hud.matchOver = (w) => { banner(w); this.matchOver(w); };
    this.studio = new Studio(this.R, this.mats);
    this.studio.bind($('gunsmith'));
    this.input = new Input(canvas);
    this.input.onUnlock = () => { if (this.mode === 'playing') this.pause(); };
    this.touch = new TouchControls(this.input, { onPause: () => this.pause() });
    this.menus = new Menus(this);
    this.buildLineup();
    this.game.vm.setScopeRes(preset.scopeRes);
    step(0.97, 'shaders'); await frame();
    this.prewarm();
    // Rebuilding the render targets is heavy; wait for a rotation or window drag to settle.
    let resizeT = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => this.R.resize(), 120); });
    step(1, 'ready'); await frame();
    // let the poster be seen for a moment, then fade into the menu
    if (this.artShown) { const left = 2400 - (performance.now() - this.artShown); if (left > 0) await new Promise((r) => setTimeout(r, left)); }
    $('loading').classList.add('done');
    setTimeout(() => { $('loading').hidden = true; }, 750);
    this.mode = 'menu';
    this.menus.show('menu');
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.mode === 'playing') { this.pause(); this.input.unlock(); }
    });
    window.addEventListener('pointerdown', (e) => { this.lastPointer = e.pointerType; this.audio.unlock(); });
    window.addEventListener('touchend', () => this.audio.unlock(), { passive: true });
    // Leaving the app, or turning a phone upright, pauses the match.
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'playing') { this.pause(); this.input.unlock(); } });
    const portrait = window.matchMedia('(orientation: portrait)');
    const onTurn = () => { if (portrait.matches && this.touchPlay && this.mode === 'playing') this.pause(); };
    if (portrait.addEventListener) portrait.addEventListener('change', onTurn); else portrait.addListener(onTurn);
    this.last = performance.now();
    window.__app = this;
    requestAnimationFrame((t) => this.loop(t));
  }

  // Drifting embers over the loading art (CSS-animated, so they keep moving while the main
  // thread is busy baking).
  embers() {
    const box = $('ld-embers');
    if (!box) return;
    const r = (a, b) => (a + Math.random() * (b - a)).toFixed(1);
    for (let i = 0; i < 28; i++) {
      const e = document.createElement('i');
      e.style.cssText = `left:${r(0, 100)}%;--s:${r(1.5, 4)}px;--d:${r(4, 9)}s;--t:-${r(0, 9)}s;--x:-${r(6, 22)}vw`;
      box.appendChild(e);
    }
  }

  // The loading poster, rendered with the operators and guns as soon as their materials exist.
  async keyArt(mats) {
    const stage = $('ld-stage');
    if (!stage) return;
    try {
      const box = stage.parentElement.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cap = PRESETS[this.settings.preset].textureSize <= 512 ? 1280 : 1920;
      const w = Math.round(Math.max(960, Math.min(cap, box.width * dpr)) / 2) * 2;
      const art = await renderKeyArt(this.R, mats, w, Math.round(w / ART_ASPECT));
      art.canvas.className = 'ld-shot base';
      art.flash.className = 'ld-shot flash';
      stage.append(art.canvas, art.flash);
      await frame();
      stage.classList.add('ready');
      this.artShown = performance.now();
    } catch (e) {
      console.warn('Loading art skipped:', e);
    }
  }

  enableTouch() {
    if (this.touchMode) return;
    this.touchMode = true;
    document.documentElement.classList.add('touch');
    const hint = document.querySelector('#gunsmith .hint');
    if (hint) hint.textContent = 'Drag to rotate · pinch to zoom';
    const rot = document.createElement('div');
    rot.id = 'rotate';
    rot.innerHTML = '<div><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="15" y="6" width="18" height="36" rx="3"/><path d="M21.5 37h5"/></svg>' +
      '<b>Turn your phone sideways</b><span>Iron Meridian plays in landscape.</span></div>';
    document.body.appendChild(rot);
  }

  // Phones: go fullscreen and hold landscape where the browser allows it (it needs the tap that deployed).
  goFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    try {
      const p = el.requestFullscreen({ navigationUI: 'hide' });
      if (p && p.then) p.then(() => { const o = window.screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); }).catch(() => {});
    } catch (e) { /* not allowed in this frame */ }
  }

  // Compile every material now, hidden effects included, so the first shot, blast or kill doesn't
  // stall a frame while its shader links.
  prewarm() {
    const R = this.R, r = R.r, hidden = [];
    for (const s of [R.scene, R.vScene]) s.traverse((o) => { if (!o.visible) { o.visible = true; hidden.push(o); } });
    r.setRenderTarget(R.sceneRT); // the world and the weapon both draw into the HDR targets
    try {
      r.compile(R.scene, R.camera);
      r.compile(R.vScene, R.vCamera);
    } catch (e) { console.warn('Shader warm-up incomplete:', e); }
    for (const o of hidden) o.visible = false;
    r.setRenderTarget(null);
  }

  // One reflection probe over the main streets; glass, paint and metal are box-projected into it.
  captureReflections() {
    const R = this.R;
    R.applyPreset(PRESETS[this.settings.preset]);
    const hide = this.game.characters.map((c) => c.h ? c.h.group : null).filter(Boolean);
    R.captureProbe(new THREE.Vector3(2, 3.2, 9), new THREE.Box3(new THREE.Vector3(-56, -0.2, -22.2), new THREE.Vector3(56, 30, 22.2)), hide);
    for (const m of SHARED_PROBE_MATS) { m.envMap = R.probe.texture; m.needsUpdate = true; }
    SHARED.probeOn.value = 1;
  }

  loadout() { return this.loadouts[this.settings.loadout] || this.loadouts[0]; }
  saveSettings() { store.set(SETTINGS_KEY, this.settings); }
  saveLoadouts() { store.set(LOADOUTS_KEY, this.loadouts); }
  applyPreset() { const p = PRESETS[this.settings.preset]; this.R.applyPreset(p); this.game.vm.setScopeRes(p.scopeRes); }

  // Three operators at low ready, posed by the fountain for the menu backdrop.
  buildLineup() {
    this.lineup = [];
    const spots = [[-2.6, 6.2, 2.75], [-1.2, 6.9, 3.05], [0.1, 6.3, 3.4]];
    spots.forEach((s, i) => {
      const h = new Humanoid(this.mats.char.msg, 'msg', 101 + i * 37);
      const gun = buildGun(i === 2 ? 'bastion' : 'kestrel', i === 1 ? { optic: 'scope4x', muzzle: 'suppressor' } : { optic: 'reddot' }, this.mats.gun, { shadows: true });
      h.setGun(bakeGun(gun), gun.anchors, gun);
      h.group.position.set(s[0], 0, s[1]);
      h.group.rotation.y = s[2];
      this.R.scene.add(h.group);
      this.lineup.push(h);
    });
  }

  onScreen(name) {
    this.studio.active = name === 'gunsmith';
    if (name === 'gunsmith') { this.mode = 'gunsmith'; return; }
    if (this.mode === 'gunsmith') this.mode = 'menu';
  }

  // Cut to black and fade back in, for the jumps between the menu and a match.
  fadeIn() {
    const f = $('fade');
    if (!f) return;
    f.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
  }

  deploy() {
    this.fadeIn();
    this.audio.unlock();
    this.game.start(JSON.parse(JSON.stringify(this.loadout())), this.settings.difficulty);
    for (const h of this.lineup) h.group.visible = false;
    for (const b of this.game.bots) b.h.group.visible = true;
    this.menus.hideAll();
    this.hud.show(true);
    this.mode = 'playing';
    this.input.enabled = true;
    this.input.reset();
    this.capture();
  }

  // Mouse aiming captures the pointer; thumbs don't need it. A touchscreen laptop deployed with
  // the mouse still gets pointer lock.
  capture() {
    this.touchPlay = this.touchMode && this.lastPointer !== 'mouse';
    if (this.touchPlay) { this.goFullscreen(); return; }
    this.input.lock();
    this.checkLock();
  }

  // Some embedded frames refuse pointer lock; fall back to raw mouse movement.
  checkLock() {
    this.input.free = false;
    setTimeout(() => {
      if (this.mode === 'playing' && !this.input.locked) this.input.free = true;
    }, 400);
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.enabled = false;
    this.input.free = false;
    this.input.reset();
    this.menus.show('pause');
  }

  resume() {
    this.menus.hideAll();
    this.mode = 'playing';
    this.input.enabled = true;
    this.input.reset();
    this.capture();
  }

  toMenu() {
    this.fadeIn();
    this.input.unlock();
    this.input.enabled = false;
    this.mode = 'menu';
    this.game.state = 'menu';
    this.hud.show(false);
    for (const b of this.game.bots) b.h.group.visible = false;
    for (const h of this.lineup) h.group.visible = true;
    this.game.showViewmodel(false);
    this.menus.show('menu');
  }

  matchOver(winner) {
    setTimeout(() => {
      this.input.unlock();
      this.input.enabled = false;
      this.mode = 'over';
      this.menus.renderOver(winner);
    }, 2200);
  }

  loop(t) {
    const raw = (t - this.last) / 1000;
    const dt = Math.min(0.05, Math.max(0.0001, raw));
    this.last = t;
    this.adapt(raw);
    const g = this.game, R = this.R;
    if (this.mode === 'test') { requestAnimationFrame((tt) => this.loop(tt)); return; } // driven externally by automated tests
    this.touch.setVisible(this.touchPlay && this.mode === 'playing');
    if (this.mode === 'gunsmith') {
      this.studio.render();
    } else {
      if (this.mode === 'playing' || this.mode === 'over') {
        if (this.mode === 'playing') this.touch.update(g.player.alive);
        g.update(dt, this.input, this.settings);
        this.hud.update(dt, this.input);
      } else if (this.mode === 'menu' || this.mode === 'paused') {
        if (this.mode === 'menu') this.menuCamera(dt);
        g.effects.update(dt, R.camera);
      }
      this.renderScope();
      R.render();
    }
    this.input.endFrame();
    requestAnimationFrame((tt) => this.loop(tt));
  }

  // Mobile preset: lower the render resolution while frames run slow, raise it again with headroom.
  adapt(raw) {
    if (!PRESETS[this.settings.preset].adaptive || this.mode !== 'playing') { this.adaptT = 0; return; }
    const f = Math.min(0.1, Math.max(0, raw)); // a shader-compile hitch counts as one slow frame
    this.frameAvg = this.frameAvg ? this.frameAvg * 0.95 + f * 0.05 : f;
    this.adaptT = (this.adaptT || 0) + f;
    if (this.adaptT < 2.5) return;
    this.adaptT = 0;
    const s = this.R.renderScale;
    if (this.frameAvg > 1 / 26 && s > 0.56) this.R.setRenderScale(Math.max(0.55, s * 0.85));
    else if (this.frameAvg < 1 / 50 && s < 1) this.R.setRenderScale(Math.min(1, s * 1.12));
  }

  menuCamera(dt) {
    this.menuT = (this.menuT || 0) + dt;
    const t = this.menuT * 0.05;
    const cam = this.R.camera;
    cam.position.set(-1.3 + Math.sin(t) * 1.6, 1.55 + Math.sin(t * 1.7) * 0.08, 10.8 + Math.cos(t) * 0.8);
    cam.fov = 48;
    cam.updateProjectionMatrix();
    cam.lookAt(-1.6 + Math.sin(t * 0.7) * 0.4, 1.25, 4.5);
    for (const h of this.lineup) h.update(dt, { speed: 0, sprint: true, aimPitch: -0.15 });
    this.game.showViewmodel(false);
    this.audio.setListener(cam);
  }

  // Picture-in-picture: render the world through the scope's narrow camera.
  renderScope() {
    const vm = this.game.vm;
    if ((this.mode !== 'playing' && this.mode !== 'test') || !vm.ocular || vm.adsT < 0.35) return;
    const cam = this.R.camera;
    vm.scopeCam.position.copy(cam.position);
    vm.scopeCam.quaternion.copy(cam.quaternion);
    vm.scopeCam.fov = 55 / 4;
    vm.scopeCam.aspect = 1;
    vm.scopeCam.updateProjectionMatrix();
    const r = this.R.r;
    r.setRenderTarget(vm.scopeRT);
    r.render(this.R.scene, vm.scopeCam);
    r.setRenderTarget(null);
  }
}

function frame() { return new Promise((r) => requestAnimationFrame(() => r())); }

new App().boot().catch((e) => {
  console.error(e);
  $('load-step').textContent = 'failed to start: ' + e.message;
});
