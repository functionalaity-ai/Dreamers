/* Boot, main loop, saving and screen flow. */
(function (GHV) {
  'use strict';
  const C = GHV.CONFIG;

  // localStorage can be missing or throw (private mode, blocked storage).
  const Store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  };

  const INTRO = [
    "My dear sprout — if you're reading this, the farm is yours now. The soil is good. The light is better.",
    "There are seeds and tools in your bag. Till the grass with the hoe, plant, and water every single day. The shipping bin by the door pays while you sleep.",
    'And go and see Old Fen by the Great Lantern in the village, east along the lane. He\'ll tell you what the valley needs.',
    '— All my love, Grandma Juniper',
  ];

  const App = {
    mode: 'title',

    init: function () {
      GHV.Sprites.init();
      this.canvas = document.getElementById('world');
      this.game = new GHV.Game();

      // A living backdrop for the title screen: golden hour on the village lane.
      this.backdrop = new GHV.Game().newGame(20241007);
      this.backdrop.state.time = 18 * 60;
      this.backdrop.state.player.x = 20 * C.TILE;
      this.backdrop.state.player.y = 16 * C.TILE + 4;
      this.backdropDir = 1;

      this.renderer = new GHV.Renderer(this.canvas, this.backdrop);
      this.renderer.setWorld(this.backdrop.world);
      this.renderer.showCursor = false;
      this.input = new GHV.Input(this.canvas, this.renderer);
      this.ui = new GHV.UI(this);
      this.loadSettings();
      this.wireGame();

      const self = this;
      window.addEventListener('resize', function () { self.renderer.resize(); });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden && self.mode === 'play' && !self.sleeping) self.save();
      });
      document.getElementById('btn-continue').classList.toggle('hidden', !this.hasSave());

      this.last = performance.now();
      requestAnimationFrame(function loop(ts) {
        self.frame(ts);
        requestAnimationFrame(loop);
      });
    },

    wireGame: function () {
      const self = this, g = this.game, ui = this.ui;
      g.on('toast', function (t) { ui.toast(t.msg, t.kind); });
      g.on('sfx', function (n) { GHV.Audio.play(n); });
      g.on('fx', function (fx) { self.renderer.addFx(fx); });
      g.on('change', function () { ui.refreshHud(); });
      g.on('tick', function () { ui.refreshClock(); });
      g.on('dialog', function (d) { ui.openDialog(d); });
      g.on('confirmSleep', function () { ui.openSleep(); });
      g.on('openShop', function () { ui.openShop(); });
      g.on('openOffering', function () { ui.openOffering(); });
      g.on('gain', function (gn) { if (gn.qty > 0) ui.flashName('+' + gn.qty + ' ' + GHV.ITEMS[gn.id].name); });
      g.on('passOut', function () {
        self.sleeping = true;
        ui.setFade(true);
        setTimeout(function () { g.sleep(true); }, 700);
      });
      g.on('dayEnd', function (sum) {
        self.sleeping = true;
        ui.setFade(true);
        self.save();
        setTimeout(function () {
          self.renderer.snapCamera();
          ui.showSummary(sum);
        }, 500);
      });
      g.on('restored', function () {
        ui.setFade(false);
        setTimeout(function () { ui.showEnding(); }, 1600);
        self.save();
      });
    },

    // ---------------------------------------------------------------------------
    // Flow
    // ---------------------------------------------------------------------------
    hasSave: function () { return !!Store.get(C.SAVE_KEY); },

    newGame: function () {
      this.game.newGame();
      this.startPlaying();
      this.ui.openDialog({ name: "Grandma Juniper's letter", lines: INTRO });
      this.save();
    },

    continueGame: function () {
      let data = null;
      try {
        data = JSON.parse(Store.get(C.SAVE_KEY));
        this.game.load(data);
      } catch (e) {
        this.ui.toast("That save couldn't be read, so here's a fresh farm.", 'warn');
        this.game.newGame();
      }
      this.startPlaying();
      this.ui.toast('Welcome back to Golden Hour Valley.');
    },

    startPlaying: function () {
      this.mode = 'play';
      this.sleeping = false;
      this.renderer.game = this.game;
      this.renderer.setWorld(this.game.world);
      this.renderer.showCursor = true;
      document.getElementById('title').classList.add('hidden');
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      this.ui.showHud(true);
      this.ui.ready = false;
      this.ui.refreshHud();
      this.ui.ready = true;
      this.input.clear();
    },

    quitToTitle: function () {
      this.save();
      this.mode = 'title';
      this.renderer.game = this.backdrop;
      this.renderer.setWorld(this.backdrop.world);
      this.renderer.showCursor = false;
      this.ui.showHud(false);
      this.ui.setPrompt(null);
      document.getElementById('title').classList.remove('hidden');
      document.getElementById('btn-continue').classList.toggle('hidden', !this.hasSave());
    },

    goToSleep: function () {
      const self = this;
      this.sleeping = true;
      GHV.Audio.play('sleep');
      this.ui.setFade(true);
      setTimeout(function () { self.game.sleep(false); }, 650);
    },

    wakeUp: function () {
      const self = this;
      this.sleeping = false;
      this.ui.setFade(false);
      this.ui.refreshHud();
      GHV.Audio.play('day');
      const s = this.game.state, cal = this.game.calendar();
      setTimeout(function () {
        self.ui.toast(cal.season + ' ' + cal.dayOfSeason + ' — ' + (s.weather === 'sunshower' ? 'a sunshower is watering your crops.' : 'clear skies.'));
      }, 400);
    },

    save: function () {
      if (!this.game.state) return false;
      return Store.set(C.SAVE_KEY, JSON.stringify(this.game.serialize()));
    },

    // ---------------------------------------------------------------------------
    // Settings & audio
    // ---------------------------------------------------------------------------
    loadSettings: function () {
      let st = null;
      try { st = JSON.parse(Store.get(C.SETTINGS_KEY)); } catch (e) { st = null; }
      if (st) {
        GHV.Audio.sound = st.sound !== false;
        GHV.Audio.music = st.music !== false;
      }
    },

    saveSettings: function () {
      Store.set(C.SETTINGS_KEY, JSON.stringify({ sound: GHV.Audio.sound, music: GHV.Audio.music }));
    },

    setSound: function (on) { GHV.Audio.setSound(on); this.saveSettings(); },
    setMusic: function (on) {
      GHV.Audio.setMusic(on);
      this.saveSettings();
      this.ui.toast('Music ' + (on ? 'on' : 'off') + '.');
    },
    unlockAudio: function () { GHV.Audio.unlock(); },
    audioClick: function () { GHV.Audio.unlock(); GHV.Audio.play('click'); },

    // ---------------------------------------------------------------------------
    // Loop
    // ---------------------------------------------------------------------------
    frame: function (ts) {
      const dt = Math.min(0.05, Math.max(0, (ts - this.last) / 1000));
      this.last = ts;
      if (this.mode === 'title') {
        this.input.drain();
        this.updateBackdrop(dt);
        this.renderer.render(dt);
        GHV.Audio.updateMusic(dt, 0);
        return;
      }
      const ui = this.ui, g = this.game;
      for (const a of this.input.drain()) this.handle(a);
      ui.updateDialog(dt);
      if (!ui.blocking() && !this.sleeping) {
        g.update(dt, this.input.move());
        const hover = this.input.mouseActive ? this.input.hover : null;
        const target = g.targetTile(hover);
        this.renderer.target = target;
        ui.setPrompt(g.describeTarget(target.x, target.y));
      } else {
        this.renderer.target = null;
        ui.setPrompt(null);
        if (g.state.player.moving) { g.state.player.moving = false; g.state.player.animT = 0; }
      }
      this.renderer.render(dt);
      GHV.Audio.updateMusic(dt, this.renderer.sky ? this.renderer.sky.light : 0);
    },

    handle: function (a) {
      const ui = this.ui, g = this.game;
      if (a.type !== 'music') GHV.Audio.unlock();
      if (ui.dialogData) {
        if (a.type === 'act') ui.advanceDialog();
        else if (a.type === 'pause') ui.closeDialog();
        return;
      }
      if (ui.modal) {
        if (a.type === 'pause') ui.closeModal();
        else if (a.type === 'inventory' && ui.modal === 'inventory') ui.closeModal();
        return;
      }
      if (ui.blocking() || this.sleeping) return;
      switch (a.type) {
        case 'act': {
          if (a.touch) {
            const pt = g.playerTile();
            if (!a.tile || Math.max(Math.abs(a.tile.x - pt.x), Math.abs(a.tile.y - pt.y)) > C.REACH) return;
          }
          const t = g.targetTile(a.tile || (this.input.mouseActive ? this.input.hover : null));
          g.act(t.x, t.y);
          break;
        }
        case 'eat': g.eat(); break;
        case 'inventory': ui.openInventory(); break;
        case 'pause': ui.openPause(); break;
        case 'slot': g.selectSlot(a.n); break;
        case 'cycle': g.cycleSlot(a.dir); break;
        case 'music': this.setMusic(!GHV.Audio.music); break;
      }
    },

    // The title backdrop: a farmer strolling the lane at golden hour.
    updateBackdrop: function (dt) {
      const b = this.backdrop, p = b.state.player;
      if (p.x > 52 * C.TILE) this.backdropDir = -1;
      if (p.x < 9 * C.TILE) this.backdropDir = 1;
      b.update(dt, { x: this.backdropDir * 0.5, y: 0 });
      b.state.time = 18 * 60;
    },
  };

  GHV.App = App;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { App.init(); });
  else App.init();
})(window.GHV = window.GHV || {});
