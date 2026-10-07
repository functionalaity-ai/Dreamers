/* Synthesised sound effects and a gentle generative tune (Web Audio, no files). */
(function (GHV) {
  'use strict';

  const SCALE = [0, 2, 4, 7, 9];            // major pentatonic
  const ROOT = 293.66;                      // D4
  function note(step, octave) {
    const n = SCALE[((step % 5) + 5) % 5] + 12 * (octave + Math.floor(step / 5));
    return ROOT * Math.pow(2, n / 12);
  }

  const Audio = {
    ctx: null,
    master: null,
    sfxBus: null,
    musicBus: null,
    sound: true,
    music: true,
    musicTimer: 0,
    step: 0,
    nightFactor: 0,

    // Must be called from a user gesture (browsers block audio until then).
    unlock: function () {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (e) {
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(c.destination);
      this.sfxBus = c.createGain();
      this.sfxBus.gain.value = this.sound ? 0.55 : 0;
      this.sfxBus.connect(this.master);
      // Music runs through a soft feedback delay for a warm, roomy sound.
      this.musicBus = c.createGain();
      this.musicBus.gain.value = this.music ? 0.22 : 0;
      const delay = c.createDelay(1);
      delay.delayTime.value = 0.42;
      const fb = c.createGain();
      fb.gain.value = 0.38;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      this.musicBus.connect(this.master);
      this.musicBus.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(this.master);
      this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    },

    setSound: function (on) {
      this.sound = on;
      if (this.sfxBus) this.sfxBus.gain.value = on ? 0.55 : 0;
    },

    setMusic: function (on) {
      this.music = on;
      if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.3);
    },

    tone: function (freq, dur, opts) {
      if (!this.ctx) return;
      opts = opts || {};
      const c = this.ctx, t = c.currentTime + (opts.delay || 0);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = opts.type || 'triangle';
      o.frequency.setValueAtTime(freq, t);
      if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
      const vol = opts.vol === undefined ? 0.3 : opts.vol;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.008));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(opts.bus || this.sfxBus);
      o.start(t);
      o.stop(t + dur + 0.05);
    },

    noise: function (dur, opts) {
      if (!this.ctx) return;
      opts = opts || {};
      const c = this.ctx, t = c.currentTime + (opts.delay || 0);
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = opts.filter || 'lowpass';
      f.frequency.setValueAtTime(opts.freq || 1000, t);
      if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, t + dur);
      f.Q.value = opts.q || 1;
      const g = c.createGain();
      g.gain.setValueAtTime(opts.vol || 0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.sfxBus);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.05);
    },

    play: function (name) {
      if (!this.ctx || !this.sound) return;
      const self = this;
      const arp = function (steps, oct, gap, type, vol) {
        steps.forEach(function (s, i) { self.tone(note(s, oct), 0.35, { delay: i * gap, type: type || 'triangle', vol: vol || 0.22 }); });
      };
      switch (name) {
        case 'till': this.noise(0.14, { freq: 700, vol: 0.5 }); this.tone(110, 0.1, { type: 'square', vol: 0.08, slide: 60 }); break;
        case 'water': this.noise(0.3, { filter: 'bandpass', freq: 1400, sweep: 700, q: 2, vol: 0.35 }); break;
        case 'refill':
          this.noise(0.45, { freq: 900, vol: 0.3 });
          for (let i = 0; i < 4; i++) this.tone(300 + Math.random() * 300, 0.08, { delay: i * 0.08, type: 'sine', vol: 0.12, slide: 700 });
          break;
        case 'cut': this.noise(0.09, { filter: 'highpass', freq: 2500, vol: 0.35 }); this.noise(0.06, { filter: 'highpass', freq: 3500, vol: 0.2, delay: 0.05 }); break;
        case 'rock': this.tone(160, 0.12, { type: 'square', vol: 0.12, slide: 70 }); this.noise(0.12, { freq: 1600, vol: 0.4 }); break;
        case 'plant': this.tone(520, 0.08, { type: 'sine', vol: 0.18 }); this.tone(780, 0.1, { type: 'sine', vol: 0.15, delay: 0.06 }); break;
        case 'harvest': arp([0, 2, 4, 5], 1, 0.06); break;
        case 'pick': this.tone(880, 0.15, { type: 'sine', vol: 0.2, slide: 1320 }); break;
        case 'coin': this.tone(988, 0.08, { type: 'square', vol: 0.06 }); this.tone(1319, 0.25, { type: 'square', vol: 0.06, delay: 0.07 }); break;
        case 'ship': this.tone(330, 0.12, { vol: 0.2 }); this.tone(440, 0.2, { vol: 0.2, delay: 0.08 }); this.noise(0.15, { freq: 500, vol: 0.2 }); break;
        case 'eat': this.noise(0.07, { freq: 900, vol: 0.4 }); this.noise(0.07, { freq: 800, vol: 0.4, delay: 0.12 }); this.tone(660, 0.15, { type: 'sine', vol: 0.12, delay: 0.25, slide: 990 }); break;
        case 'error': this.tone(220, 0.1, { type: 'square', vol: 0.08 }); this.tone(165, 0.16, { type: 'square', vol: 0.08, delay: 0.09 }); break;
        case 'click': this.tone(1200, 0.04, { type: 'sine', vol: 0.12 }); break;
        case 'open': this.tone(660, 0.08, { type: 'sine', vol: 0.12 }); this.tone(990, 0.1, { type: 'sine', vol: 0.1, delay: 0.05 }); break;
        case 'talk': this.tone(520 + Math.random() * 120, 0.05, { type: 'triangle', vol: 0.08 }); break;
        case 'offer': arp([0, 2, 4, 5, 7, 9], 1, 0.07, 'sine', 0.2); break;
        case 'restore':
          arp([0, 2, 4, 5, 7, 9, 10, 12], 0, 0.12, 'triangle', 0.22);
          [0, 4, 7].forEach(function (s) { self.tone(note(s, 0), 2.6, { delay: 1, type: 'sine', vol: 0.12, attack: 0.6 }); });
          break;
        case 'sleep': arp([7, 4, 2, 0], 0, 0.22, 'sine', 0.2); break;
        case 'day': arp([0, 4, 7], 1, 0.1, 'triangle', 0.16); break;
      }
    },

    // Called every frame; drops a soft note every so often. Slower and lower at night.
    updateMusic: function (dt, night) {
      if (!this.ctx || !this.music) return;
      this.musicTimer -= dt;
      if (this.musicTimer > 0) return;
      const beat = night > 0.5 ? 0.9 : 0.6;
      this.musicTimer = beat * (Math.random() < 0.3 ? 2 : 1);
      this.step++;
      // A slow chord every 16 steps.
      if (this.step % 16 === 1) {
        const roots = [0, 3, 1, 4];
        const r = roots[Math.floor(this.step / 16) % roots.length];
        [r, r + 2, r + 4].forEach((s) => this.tone(note(s, -1), 4.5, { type: 'sine', vol: 0.08, attack: 0.9, bus: this.musicBus }));
      }
      if (Math.random() < (night > 0.5 ? 0.35 : 0.55)) {
        const s = Math.floor(Math.random() * 8);
        this.tone(note(s, night > 0.5 ? 0 : 1), 1.4, { type: 'triangle', vol: 0.09, attack: 0.02, bus: this.musicBus });
      }
    },
  };

  GHV.Audio = Audio;
})(window.GHV = window.GHV || {});
