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
  'Double-tap Shift while sprinting for a short tactical sprint.',
];

class App {
  async boot() {
    $('load-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    this.settings = Object.assign({}, DEFAULT_SETTINGS, store.get(SETTINGS_KEY, {}));
    if (!PRESETS[this.settings.preset]) this.settings.preset = 'high';
    if (typeof this.settings.loadout !== 'number') this.settings.loadout = 0;
    this.loadouts = store.get(LOADOUTS_KEY, null) || JSON.parse(JSON.stringify(DEFAULT_LOADOUTS));
    const canvas = $('view');
    this.R = new Renderer(canvas);
    const preset = PRESETS[this.settings.preset];
    const step = (t, label) => { $('load-bar').style.width = Math.round(t * 100) + '%'; if (label) $('load-step').textContent = label; };
    step(0.02, 'textures');
    await frame();
    linkProbe(this.R.probe.uniforms);
    SHARED.sunDirW.value.copy(SUN_DIR);
    SHARED.sunColorW.value.copy(this.R.sun.color).multiplyScalar(this.R.sun.intensity);
    SHARED.ambW.value.setRGB(0.55, 0.62, 0.75);
    this.mats = await new Materials(preset, this.R.r).build((t) => step(t * 0.7, 'textures'));
    step(0.72, 'streets and buildings'); await frame();
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume);
    this.game = new Game(this.R, this.mats, this.audio);
    this.game.load();
    this.R.vol.setIndoor(this.game.map.indoor);
    step(0.8, 'reflections'); await frame();
    this.captureReflections();
    step(0.9, 'operators'); await frame();
    this.hud = new HUD(this.game, this.settings);
    this.game.hud = this.hud;
    this.hud.matchOver = (w) => this.matchOver(w);
    this.studio = new Studio(this.R, this.mats);
    this.studio.bind(canvas);
    this.input = new Input(canvas);
    this.input.onUnlock = () => { if (this.mode === 'playing') this.pause(); };
    this.menus = new Menus(this);
    this.buildLineup();
    this.game.vm.setScopeRes(preset.scopeRes);
    window.addEventListener('resize', () => this.R.resize());
    step(1, 'ready'); await frame();
    $('loading').hidden = true;
    this.mode = 'menu';
    this.menus.show('menu');
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.mode === 'playing') { this.pause(); this.input.unlock(); }
    });
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: false });
    this.last = performance.now();
    window.__app = this;
    requestAnimationFrame((t) => this.loop(t));
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
      h.setGun(bakeGun(gun), gun.anchors);
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

  deploy() {
    this.audio.unlock();
    this.game.start(JSON.parse(JSON.stringify(this.loadout())), this.settings.difficulty);
    for (const h of this.lineup) h.group.visible = false;
    for (const b of this.game.bots) b.h.group.visible = true;
    this.menus.hideAll();
    this.hud.show(true);
    this.mode = 'playing';
    this.input.enabled = true;
    this.input.reset();
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
    this.input.lock();
    this.checkLock();
  }

  toMenu() {
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
    const dt = Math.min(0.05, Math.max(0.0001, (t - this.last) / 1000));
    this.last = t;
    const g = this.game, R = this.R;
    if (this.mode === 'test') { requestAnimationFrame((tt) => this.loop(tt)); return; } // driven externally by automated tests
    if (this.mode === 'gunsmith') {
      this.studio.render();
    } else {
      if (this.mode === 'playing' || this.mode === 'over') {
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
