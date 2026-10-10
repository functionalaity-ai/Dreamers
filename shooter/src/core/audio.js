// Synthesised, spatial audio. Gunshots are layered (transient, body, thump, room tail),
// distant shots arrive late (speed of sound) and lose their highs.
const SPEED_OF_SOUND = 343;

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.002;
    this.comp.release.value = 0.18;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.comp);
    this.comp.connect(c.destination);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.irOut = this.makeIR(2.2, 0.55, [0.09, 0.21, 0.36, 0.55]);
    this.irIn = this.makeIR(0.7, 0.16, [0.02, 0.045]);
    this.revOut = c.createConvolver(); this.revOut.buffer = this.irOut;
    this.revIn = c.createConvolver(); this.revIn.buffer = this.irIn;
    this.revOutGain = c.createGain(); this.revOutGain.gain.value = 0.55;
    this.revInGain = c.createGain(); this.revInGain.gain.value = 0.7;
    this.revOut.connect(this.revOutGain).connect(this.master);
    this.revIn.connect(this.revInGain).connect(this.master);
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  // Impulse response: exponentially decaying noise plus discrete urban echoes.
  makeIR(len, tau, echoes) {
    const c = this.ctx;
    const n = Math.floor(c.sampleRate * len);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / c.sampleRate;
        const x = (Math.random() * 2 - 1) * Math.exp(-t / tau) * 0.5;
        lp += (x - lp) * Math.max(0.05, 0.6 - t * 0.5);
        d[i] = lp;
      }
      for (const e of echoes) {
        const i0 = Math.floor((e + (ch ? 0.007 : 0)) * c.sampleRate);
        for (let k = 0; k < 600 && i0 + k < n; k++) d[i0 + k] += (Math.random() * 2 - 1) * 0.35 * Math.exp(-k / 120) * Math.exp(-e / (tau * 1.3));
      }
    }
    return buf;
  }

  setListener(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const p = cam.position;
    const f = cam.getWorldDirection(this._f || (this._f = cam.position.clone()));
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t); L.forwardY.setValueAtTime(f.y, t); L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
    this.listenerPos = p;
  }

  // Output node: either straight to the mix (player) or through a 3D panner.
  out(pos, ref = 3, rolloff = 1) {
    const c = this.ctx;
    const g = c.createGain();
    if (!pos) { g.connect(this.master); return g; }
    const p = c.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 400;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    g.connect(p).connect(this.master);
    return g;
  }

  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 1.5, dur + 0.05);
    return s;
  }

  env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // w: weapon sound profile. opts: { pos (null = player), suppressed, indoor, dist }
  gunshot(w, opts = {}) {
    if (!this.ctx) return;
    const c = this.ctx;
    const dist = opts.dist || 0;
    const t = c.currentTime + Math.min(1.5, dist / SPEED_OF_SOUND);
    const sup = opts.suppressed;
    const out = this.out(opts.pos, sup ? 2 : 7, 1);
    const far = c.createBiquadFilter();
    far.type = 'lowpass';
    far.frequency.value = Math.max(700, 18000 * Math.exp(-dist / 70)) * (sup ? 0.35 : 1);
    far.connect(out);
    const send = c.createGain();
    send.gain.value = (sup ? 0.25 : 0.9) * w.tail * Math.min(1.6, 0.6 + dist / 40);
    send.connect(opts.indoor ? this.revIn : this.revOut);
    // Transient crack
    const tr = this.noiseSrc(t, 0.01);
    const trf = c.createBiquadFilter(); trf.type = 'highpass'; trf.frequency.value = 2500;
    const trg = c.createGain(); this.env(trg, t, (sup ? 0.12 : 0.9) * w.crack, 0.0008, 0.012);
    tr.connect(trf).connect(trg).connect(far);
    // Body
    const body = this.noiseSrc(t, 0.25);
    const bf = c.createBiquadFilter(); bf.type = 'lowpass';
    bf.frequency.setValueAtTime(4200 * w.pitch * (sup ? 0.3 : 1), t);
    bf.frequency.exponentialRampToValueAtTime(450, t + 0.16 * w.body);
    const bg = c.createGain(); this.env(bg, t, (sup ? 0.25 : 1.0) * w.body, 0.002, 0.14 * w.body);
    body.connect(bf).connect(bg);
    bg.connect(far); bg.connect(send);
    // Low thump
    const o = c.createOscillator();
    o.frequency.setValueAtTime(120 * w.pitch, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const og = c.createGain(); this.env(og, t, (sup ? 0.35 : 0.9) * w.body, 0.002, 0.13);
    o.connect(og).connect(far);
    og.connect(send);
    o.start(t); o.stop(t + 0.3);
    // Mechanical action (heard up close)
    if (!opts.pos || dist < 12) {
      const m = this.noiseSrc(t + 0.03, 0.03);
      const mf = c.createBiquadFilter(); mf.type = 'bandpass'; mf.frequency.value = 2200; mf.Q.value = 2;
      const mg = c.createGain(); this.env(mg, t + 0.03, sup ? 0.35 : 0.18, 0.001, 0.03);
      m.connect(mf).connect(mg).connect(out);
    }
  }

  explosion(pos, dist) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + Math.min(1.5, dist / SPEED_OF_SOUND);
    const out = this.out(pos, 10, 1);
    const n = this.noiseSrc(t, 1.6);
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(160, t + 1.2);
    const g = c.createGain(); this.env(g, t, 1.4, 0.004, 1.3);
    n.connect(f).connect(g).connect(out);
    g.connect(this.revOut);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    const og = c.createGain(); this.env(og, t, 1.2, 0.005, 0.7);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 1);
  }

  // Short filtered noise/tone events used for foley.
  blip(opts) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + (opts.delay || 0);
    const out = this.out(opts.pos, opts.ref || 1.5, 1.2);
    if (opts.tone) {
      const o = c.createOscillator();
      o.type = opts.type || 'sine';
      o.frequency.setValueAtTime(opts.freq, t);
      if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t + opts.dur);
      const g = c.createGain(); this.env(g, t, opts.vol, 0.002, opts.dur);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + opts.dur + 0.05);
      return;
    }
    const n = this.noiseSrc(t, opts.dur);
    const f = c.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.value = opts.freq || 1500;
    f.Q.value = opts.q || 1.2;
    const g = c.createGain(); this.env(g, t, opts.vol, 0.001, opts.dur);
    n.connect(f).connect(g).connect(out);
  }

  // Foley library
  foley(name, pos) {
    const B = (o) => this.blip(Object.assign({ pos }, o));
    switch (name) {
      case 'magOut': B({ freq: 1400, dur: 0.05, vol: 0.35 }); B({ freq: 600, dur: 0.12, vol: 0.25, delay: 0.04, filter: 'lowpass' }); break;
      case 'magIn': B({ freq: 2200, dur: 0.03, vol: 0.5 }); B({ freq: 900, dur: 0.06, vol: 0.4, delay: 0.015 }); break;
      case 'magTap': B({ freq: 1200, dur: 0.03, vol: 0.3 }); break;
      case 'boltRelease': B({ freq: 2600, dur: 0.05, vol: 0.55 }); B({ freq: 620, type: 'triangle', dur: 0.12, vol: 0.25, tone: true, delay: 0.005 }); break;
      case 'charge': B({ freq: 1800, dur: 0.08, vol: 0.35 }); B({ freq: 2400, dur: 0.05, vol: 0.45, delay: 0.14 }); break;
      case 'pumpBack': B({ freq: 1300, dur: 0.07, vol: 0.45 }); B({ freq: 700, dur: 0.1, vol: 0.3, filter: 'lowpass', delay: 0.03 }); break;
      case 'pumpFwd': B({ freq: 1900, dur: 0.06, vol: 0.5 }); break;
      case 'shellIn': B({ freq: 1600, dur: 0.04, vol: 0.35 }); B({ freq: 500, dur: 0.06, vol: 0.25, filter: 'lowpass', delay: 0.02 }); break;
      case 'slideRelease': B({ freq: 2800, dur: 0.04, vol: 0.5 }); break;
      case 'dry': B({ freq: 3200, dur: 0.02, vol: 0.3 }); break;
      case 'selector': B({ freq: 3000, dur: 0.015, vol: 0.25 }); break;
      case 'draw': B({ freq: 900, dur: 0.12, vol: 0.18, filter: 'lowpass' }); B({ freq: 2400, dur: 0.03, vol: 0.2, delay: 0.1 }); break;
      case 'aim': B({ freq: 600, dur: 0.06, vol: 0.08, filter: 'lowpass' }); break;
      case 'hit': B({ freq: 2600, dur: 0.035, vol: 0.32, tone: true }); break;
      case 'headshot': B({ freq: 3400, dur: 0.05, vol: 0.32, tone: true }); B({ freq: 1800, dur: 0.06, vol: 0.2, delay: 0.02, tone: true }); break;
      case 'kill': B({ freq: 880, dur: 0.09, vol: 0.22, tone: true, type: 'triangle' }); B({ freq: 1320, dur: 0.14, vol: 0.2, delay: 0.07, tone: true, type: 'triangle' }); break;
      case 'hurt': B({ freq: 200, dur: 0.18, vol: 0.6, filter: 'lowpass' }); B({ freq: 90, dur: 0.2, vol: 0.4, tone: true }); break;
      case 'radio': B({ freq: 1400, dur: 0.12, vol: 0.12, q: 0.6 }); B({ freq: 1200, dur: 0.05, vol: 0.1, tone: true, type: 'square', delay: 0.11 }); break;
      case 'click': B({ freq: 1800, dur: 0.02, vol: 0.15, tone: true }); break;
      case 'pin': B({ freq: 3000, dur: 0.03, vol: 0.3 }); B({ freq: 1200, dur: 0.05, vol: 0.2, delay: 0.25 }); break;
      case 'bounce': B({ freq: 900, dur: 0.05, vol: 0.4, ref: 3 }); break;
      case 'land': B({ freq: 300, dur: 0.12, vol: 0.4, filter: 'lowpass' }); break;
      case 'jump': B({ freq: 500, dur: 0.06, vol: 0.12, filter: 'lowpass' }); break;
      case 'respawn': B({ freq: 660, dur: 0.15, vol: 0.15, tone: true, type: 'triangle' }); B({ freq: 990, dur: 0.2, vol: 0.12, tone: true, type: 'triangle', delay: 0.12 }); break;
    }
  }

  footstep(pos, surface, loud) {
    const freq = surface === 'wood' ? 380 : surface === 'metal' ? 1500 : 700;
    this.blip({ pos, freq, dur: 0.07, vol: (loud ? 0.4 : 0.22) * (pos ? 1.6 : 1), filter: surface === 'metal' ? 'bandpass' : 'lowpass', q: 1, ref: loud ? 3 : 1.5 });
  }

  tink(pos, kind) {
    if (!this.ctx || !this.listenerPos) return;
    const d = Math.hypot(pos.x - this.listenerPos.x, pos.y - this.listenerPos.y, pos.z - this.listenerPos.z);
    if (d > 20) return;
    if (kind === 'shell') { this.blip({ pos, freq: 500, dur: 0.06, vol: 0.25, filter: 'lowpass' }); return; }
    const f = 3800 + Math.random() * 2500;
    this.blip({ pos, freq: f, dur: 0.09, vol: 0.07, tone: true, ref: 1 });
    this.blip({ pos, freq: f * 1.51, dur: 0.05, vol: 0.04, tone: true, ref: 1, delay: 0.002 });
  }

  impact(pos, tone) {
    if (!this.ctx || !this.listenerPos) return;
    const d = Math.hypot(pos.x - this.listenerPos.x, pos.y - this.listenerPos.y, pos.z - this.listenerPos.z);
    if (d > 45) return;
    if (tone === 'metal') { this.blip({ pos, freq: 1200 + Math.random() * 1400, dur: 0.25, vol: 0.18, tone: true, type: 'triangle', ref: 3 }); this.blip({ pos, freq: 3000, dur: 0.03, vol: 0.3, ref: 3 }); }
    else if (tone === 'wood') this.blip({ pos, freq: 420, dur: 0.07, vol: 0.4, filter: 'lowpass', ref: 3 });
    else if (tone === 'soft') this.blip({ pos, freq: 300, dur: 0.06, vol: 0.35, filter: 'lowpass', ref: 3 });
    else if (tone === 'glass') this.blip({ pos, freq: 5200, dur: 0.12, vol: 0.25, filter: 'highpass', ref: 3 });
    else this.blip({ pos, freq: 1800 + Math.random() * 600, dur: 0.045, vol: 0.4, ref: 3 });
  }

  // A supersonic bullet passing close by.
  crack(pos) {
    this.blip({ pos, freq: 4200, dur: 0.012, vol: 0.9, filter: 'highpass', ref: 1 });
    this.blip({ pos, freq: 1800, dur: 0.05, vol: 0.25, q: 0.7, ref: 1, delay: 0.004 });
  }
}
