/* Renderer: draws the world, long golden-hour shadows, lighting and particles. */
(function (GHV) {
  'use strict';
  const C = GHV.CONFIG;
  const T = C.TILE;
  const U = GHV.util;
  const World = GHV.World;
  const Rules = GHV.Rules;

  // Sky over the day (minutes after midnight). mul tints the scene via multiply,
  // haze adds a soft glow, light switches lamps on, sun is the shadow strength.
  const SKY = [
    { t: 0,    mul: [62, 72, 132, 1],   haze: [40, 40, 90, 0],      light: 1,    sun: 0 },
    { t: 330,  mul: [70, 78, 140, 1],   haze: [80, 60, 120, 0],     light: 1,    sun: 0 },
    { t: 375,  mul: [214, 170, 176, 1], haze: [255, 170, 150, 0.2], light: 0.55, sun: 0.4 },
    { t: 450,  mul: [250, 232, 208, 1], haze: [255, 214, 160, 0.1], light: 0,    sun: 0.8 },
    { t: 720,  mul: [255, 250, 238, 1], haze: [255, 236, 190, 0.05], light: 0,   sun: 0.7 },
    { t: 900,  mul: [255, 236, 202, 1], haze: [255, 204, 120, 0.13], light: 0,   sun: 0.9 },
    { t: 1080, mul: [255, 208, 150, 1], haze: [255, 172, 72, 0.26], light: 0,    sun: 1 },
    { t: 1170, mul: [236, 158, 142, 1], haze: [255, 118, 92, 0.22], light: 0.3,  sun: 0.75 },
    { t: 1260, mul: [128, 108, 168, 1], haze: [190, 100, 160, 0.1], light: 0.8,  sun: 0.15 },
    { t: 1350, mul: [66, 76, 138, 1],   haze: [60, 50, 110, 0],     light: 1,    sun: 0 },
    { t: 1440, mul: [62, 72, 132, 1],   haze: [40, 40, 90, 0],      light: 1,    sun: 0 },
  ];
  const SUNSHOWER_MUL = [0.88, 0.9, 0.95];

  function sky(time, weather) {
    const s = U.sampleTrack(SKY, ((time % 1440) + 1440) % 1440);
    if (weather === 'sunshower') {
      s.mul = [s.mul[0] * SUNSHOWER_MUL[0], s.mul[1] * SUNSHOWER_MUL[1], s.mul[2] * SUNSHOWER_MUL[2], 1];
      s.sun *= 0.55;
    }
    return s;
  }

  // Shadow direction per art-pixel of height: long to the west at dawn, east at dusk.
  function shadowDir(time) {
    const a = U.clamp((time - 720) / 720, -1, 1) * (Math.PI / 2) * 1.05;
    const len = 0.35 + Math.pow(Math.abs(Math.sin(a)), 3) * 1.9;
    return { x: Math.sin(a) * len, y: -Math.cos(a) * 0.45 * len - 0.12 };
  }

  function Renderer(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.S = GHV.Sprites.S;
    this.ground = null;
    this.cam = { x: 0, y: 0 };
    this.time = 0;
    this.particles = [];
    this.ambient = [];
    this.rain = [];
    this.hover = null;
    this.showCursor = true;
    this.silCache = new WeakMap();
    this.shadowCanvas = document.createElement('canvas');
    this.lightCanvas = document.createElement('canvas');
    this.resize();
  }

  Renderer.prototype.setWorld = function (world) {
    this.ground = GHV.Sprites.renderGround(world);
    this.particles = [];
    this.ambient = [];
    this.snapCamera();
  };

  Renderer.prototype.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = window.innerWidth, ch = window.innerHeight;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    const cssTile = U.clamp(Math.min(cw / 20, ch / 12), 34, 72);
    this.scale = Math.max(1, Math.round((cssTile * dpr) / T));
    this.dpr = dpr;
    this.viewW = this.canvas.width / this.scale;
    this.viewH = this.canvas.height / this.scale;
    this.shadowCanvas.width = this.canvas.width;
    this.shadowCanvas.height = this.canvas.height;
    this.lightCanvas.width = Math.ceil(this.canvas.width / 4);
    this.lightCanvas.height = Math.ceil(this.canvas.height / 4);
  };

  Renderer.prototype.snapCamera = function () {
    if (!this.game.state) return;
    const p = this.game.state.player;
    this.cam.x = p.x - this.viewW / 2;
    this.cam.y = p.y - 8 - this.viewH / 2;
    this.clampCamera();
  };

  Renderer.prototype.clampCamera = function () {
    const ww = this.game.world.w * T, wh = this.game.world.h * T;
    this.cam.x = this.viewW >= ww ? (ww - this.viewW) / 2 : U.clamp(this.cam.x, 0, ww - this.viewW);
    this.cam.y = this.viewH >= wh ? (wh - this.viewH) / 2 : U.clamp(this.cam.y, 0, wh - this.viewH);
  };

  // CSS pixel position -> tile coordinates.
  Renderer.prototype.screenToTile = function (sx, sy) {
    const wx = (sx * this.dpr) / this.scale + this.cam.x;
    const wy = (sy * this.dpr) / this.scale + this.cam.y;
    return { x: Math.floor(wx / T), y: Math.floor(wy / T) };
  };

  Renderer.prototype.worldToScreen = function (wx, wy) {
    return { x: ((wx - this.cam.x) * this.scale) / this.dpr, y: ((wy - this.cam.y) * this.scale) / this.dpr };
  };

  Renderer.prototype.silhouette = function (img) {
    let s = this.silCache.get(img);
    if (!s) {
      s = document.createElement('canvas');
      s.width = img.width; s.height = img.height;
      const g = s.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#000';
      g.fillRect(0, 0, s.width, s.height);
      this.silCache.set(img, s);
    }
    return s;
  };

  // ---------------------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------------------
  const FX_COLORS = {
    dirt: ['#8a5a33', '#a06b40', '#6e4526'],
    water: ['#7cc0d4', '#9fd0dc', '#d8f0f5'],
    splash: ['#9fd0dc', '#d8f0f5', '#ffffff'],
    leaf: ['#5f9a35', '#86c04f', '#3f6a2a'],
    stone: ['#86817a', '#a7a298', '#cbc6ba'],
    sparkle: ['#fff1c2', '#ffd770', '#ffffff'],
  };

  Renderer.prototype.addFx = function (fx) {
    const cx = fx.x * T + 8, cy = fx.y * T + 10;
    const cols = FX_COLORS[fx.type] || FX_COLORS.sparkle;
    const n = fx.type === 'sparkle' ? 10 : 9;
    for (let i = 0; i < n; i++) {
      const p = {
        x: cx + (Math.random() - 0.5) * 8, y: cy + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * 50, vy: -20 - Math.random() * 45,
        g: 140, life: 0.45 + Math.random() * 0.35, color: cols[i % cols.length], size: 1 + (Math.random() < 0.3 ? 1 : 0), glow: false,
      };
      if (fx.type === 'water') { p.y = cy - 12 - Math.random() * 4; p.vy = 20 + Math.random() * 30; p.vx *= 0.3; p.g = 160; }
      if (fx.type === 'sparkle') { p.vy = -25 - Math.random() * 25; p.g = -10; p.glow = true; p.life = 0.8 + Math.random() * 0.4; }
      this.particles.push(p);
    }
  };

  Renderer.prototype.updateParticles = function (dt, sk) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    // Ambient: golden dust motes by day, fireflies after dusk.
    const night = sk.light > 0.35;
    const target = night ? 26 : Math.round(10 + sk.haze[3] * 90);
    const am = this.ambient;
    for (let i = am.length - 1; i >= 0; i--) {
      const a = am[i];
      a.life -= dt;
      a.t += dt;
      if (a.life <= 0 || a.kind !== (night ? 'firefly' : 'mote')) { am.splice(i, 1); continue; }
      if (a.kind === 'firefly') {
        a.x += Math.sin(a.t * a.f + a.seed) * 10 * dt + a.vx * dt;
        a.y += Math.cos(a.t * a.f * 0.7 + a.seed) * 8 * dt;
      } else {
        a.x += a.vx * dt;
        a.y += a.vy * dt + Math.sin(a.t * 1.3 + a.seed) * 2 * dt;
      }
    }
    while (am.length < target) {
      am.push({
        kind: night ? 'firefly' : 'mote',
        x: this.cam.x + Math.random() * this.viewW, y: this.cam.y + Math.random() * this.viewH,
        vx: night ? (Math.random() - 0.5) * 4 : 3 + Math.random() * 5, vy: -1 - Math.random() * 3,
        t: 0, life: 4 + Math.random() * 6, seed: Math.random() * 10, f: 1 + Math.random() * 2,
      });
    }
    if (this.game.state.weather === 'sunshower') {
      while (this.rain.length < 140) this.rain.push({ x: Math.random(), y: Math.random(), s: 0.7 + Math.random() * 0.6 });
      for (const r of this.rain) {
        r.y += dt * 1.6 * r.s;
        r.x += dt * 0.25 * r.s;
        if (r.y > 1) { r.y -= 1.05; r.x = Math.random(); }
        if (r.x > 1) r.x -= 1;
      }
    } else if (this.rain.length) {
      this.rain = [];
    }
  };

  // ---------------------------------------------------------------------------
  // Main draw
  // ---------------------------------------------------------------------------
  Renderer.prototype.render = function (dt) {
    const game = this.game, s = game.state, w = game.world;
    if (!s || !this.ground) return;
    this.time += dt;
    const ctx = this.ctx, sc = this.scale;
    const sk = sky(s.time, s.weather);
    this.sky = sk;

    // Camera follows the player smoothly.
    const p = s.player;
    const tx = p.x - this.viewW / 2, ty = p.y - 8 - this.viewH / 2;
    const k = 1 - Math.pow(0.0001, dt);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    this.clampCamera();
    const camX = Math.round(this.cam.x * sc) / sc, camY = Math.round(this.cam.y * sc) / sc;

    this.updateParticles(dt, sk);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1d1a2a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(sc, 0, 0, sc, -camX * sc, -camY * sc);

    const x0 = Math.max(0, Math.floor(camX / T) - 1), y0 = Math.max(0, Math.floor(camY / T) - 1);
    const x1 = Math.min(w.w - 1, Math.ceil((camX + this.viewW) / T) + 1), y1 = Math.min(w.h - 1, Math.ceil((camY + this.viewH) / T) + 1);

    // Ground
    const gx = x0 * T, gy = y0 * T, gw = (x1 - x0 + 1) * T, gh = (y1 - y0 + 1) * T;
    ctx.drawImage(this.ground, gx, gy, gw, gh, gx, gy, gw, gh);
    this.drawWater(ctx, x0, y0, x1, y1, sk);
    this.drawSoil(ctx, x0, y0, x1, y1);

    // Entities (y-sorted)
    const ents = this.collectEntities(x0, y0, x1, y1 + 3);
    this.drawShadows(ents, camX, camY, sk);
    ents.sort(function (a, b) { return a.y - b.y; });
    for (const e of ents) e.draw(ctx);

    // Lit particles
    for (const pt of this.particles) {
      if (pt.glow) continue;
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
    }

    this.drawLighting(ctx, sk, camX, camY, x0, y0, x1, y1);

    // Glowing particles drawn over the light pass.
    ctx.setTransform(sc, 0, 0, sc, -camX * sc, -camY * sc);
    ctx.globalCompositeOperation = 'lighter';
    for (const pt of this.particles) {
      if (!pt.glow) continue;
      ctx.globalAlpha = U.clamp(pt.life * 1.5, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), 1, 1);
    }
    for (const a of this.ambient) {
      const fade = Math.min(1, a.t, a.life);
      if (a.kind === 'firefly') {
        const blink = 0.5 + 0.5 * Math.sin(a.t * 3 + a.seed * 4);
        ctx.globalAlpha = fade * blink * 0.9;
        ctx.fillStyle = '#e8ff9a';
        ctx.fillRect(Math.round(a.x), Math.round(a.y), 1, 1);
        ctx.globalAlpha = fade * blink * 0.25;
        ctx.fillRect(Math.round(a.x) - 1, Math.round(a.y) - 1, 3, 3);
      } else {
        ctx.globalAlpha = fade * (0.35 + 0.35 * Math.sin(a.t * 2 + a.seed));
        ctx.fillStyle = '#ffe2a0';
        ctx.fillRect(Math.round(a.x), Math.round(a.y), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    this.drawCursor(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawRain(ctx);
    this.drawVignette(ctx, sk);
  };

  // ---------------------------------------------------------------------------
  // Ground layers
  // ---------------------------------------------------------------------------
  Renderer.prototype.drawWater = function (ctx, x0, y0, x1, y1, sk) {
    const w = this.game.world, t = this.time;
    const golden = U.clamp(sk.haze[3] * 4, 0, 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (w.ground[y * w.w + x] !== World.G.WATER) continue;
        const ox = x * T, oy = y * T;
        // Deeper colour away from the banks.
        const shore = !World.isWater(w, x, y - 1) || !World.isWater(w, x - 1, y) || !World.isWater(w, x + 1, y) || !World.isWater(w, x, y + 1);
        if (!shore) { ctx.fillStyle = '#2f7393'; ctx.fillRect(ox, oy, T, T); }
        // Drifting glints that pick up the sky.
        for (let i = 0; i < 3; i++) {
          const hx = U.hash2(x, y, i + 1), hy = U.hash2(x, y, i + 9);
          const phase = t * (0.6 + hx * 0.6) + hx * 10;
          const len = 2 + Math.round(2 + Math.sin(phase) * 2);
          if (len <= 2) continue;
          const gxp = ox + Math.floor(((hx * T + t * 3 * (0.5 + hy)) % T));
          const gyp = oy + 2 + Math.floor(hy * 12);
          ctx.fillStyle = Math.sin(phase * 1.3) > 0.2 ? (golden > 0.4 ? '#ffd98a' : '#9fd0dc') : '#5aa0bb';
          ctx.fillRect(Math.min(gxp, ox + T - len), gyp, len, 1);
        }
        // Foam along the top bank.
        if (!World.isWater(w, x, y - 1)) {
          ctx.fillStyle = 'rgba(232,246,240,0.85)';
          for (let k = 0; k < T; k++) if (Math.sin(t * 2 + (ox + k) * 0.6) > -0.3) ctx.fillRect(ox + k, oy, 1, 1);
          ctx.fillStyle = 'rgba(232,246,240,0.35)';
          for (let k = 0; k < T; k++) if (Math.sin(t * 2.4 + (ox + k) * 0.45) > 0.4) ctx.fillRect(ox + k, oy + 1, 1, 1);
        }
      }
    }
  };

  Renderer.prototype.drawSoil = function (ctx, x0, y0, x1, y1) {
    const s = this.game.state, w = this.game.world;
    const P = GHV.Sprites.PAL;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const so = s.soil[y * w.w + x];
        if (!so) continue;
        const pal = so.watered ? P.wetSoil : P.soil;
        const ox = x * T, oy = y * T;
        ctx.fillStyle = pal[0];
        ctx.fillRect(ox + 1, oy + 1, T - 2, T - 2);
        ctx.fillStyle = pal[1];
        ctx.fillRect(ox + 1, oy + 1, T - 2, T - 3);
        ctx.fillStyle = pal[0];
        for (let r = 4; r < T - 2; r += 5) ctx.fillRect(ox + 2, oy + r, T - 4, 1);
        ctx.fillStyle = pal[2];
        for (let r = 3; r < T - 2; r += 5) ctx.fillRect(ox + 2, oy + r, T - 4, 1);
        if (so.watered) {
          ctx.fillStyle = 'rgba(160,210,230,0.35)';
          ctx.fillRect(ox + 3 + ((x * 7 + y) % 6), oy + 6, 2, 1);
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Entities
  // ---------------------------------------------------------------------------
  Renderer.prototype.collectEntities = function (x0, y0, x1, y1) {
    const game = this.game, s = game.state, w = game.world, S = this.S;
    const ents = [];
    const self = this;
    const img = function (image, dx, dy, sortY, shadow) {
      ents.push({
        y: sortY, img: image, dx: dx, dy: dy, shadow: shadow !== false,
        draw: function (ctx) { ctx.drawImage(image, dx, dy); },
      });
    };

    for (let ty = Math.max(0, y0 - 1); ty <= y1 && ty < w.h; ty++) {
      for (let tx = Math.max(0, x0 - 2); tx <= Math.min(w.w - 1, x1 + 2); tx++) {
        const i = ty * w.w + tx;
        const o = w.obj[i];
        const bx = tx * T, by = ty * T;
        if (o) {
          switch (o) {
            case 'tree': {
              const h = U.hash2(tx, ty, 5);
              const inFarmOrVillage = !World.inFarm(tx, ty) || h < 0.6;
              const v = h < 0.45 ? 0 : h < 0.8 || !inFarmOrVillage ? 1 : 2;
              img(S.tree[v], bx - 8, by + T - 40, by + 14);
              break;
            }
            case 'pine': img(S.pine, bx - 8, by + T - 40, by + 14); break;
            case 'bush': img(S.bush, bx, by, by + 13); break;
            case 'rock': img(S.rock[U.hash2(tx, ty, 2) < 0.5 ? 0 : 1], bx, by, by + 13); break;
            case 'weed': img(S.weed[U.hash2(tx, ty, 8) < 0.5 ? 0 : 1], bx, by, by + 12); break;
            case 'fence': {
              let m = 0;
              if (tx > 0 && w.obj[i - 1] === 'fence') m |= 1;
              if (tx < w.w - 1 && w.obj[i + 1] === 'fence') m |= 2;
              if (ty > 0 && w.obj[i - w.w] === 'fence') m |= 4;
              if (ty < w.h - 1 && w.obj[i + w.w] === 'fence') m |= 8;
              img(S.fence[m], bx, by - 8, by + 14);
              break;
            }
            case 'lamp': img(S.lamp, bx, by + T - 32, by + 14); break;
            case 'bench': img(S.bench, bx, by, by + 12); break;
            case 'sign': img(S.sign, bx, by, by + 14); break;
            case 'bin': img(S.bin, bx, by - 2, by + 14); break;
            case 'sprinkler': img(S.sprinkler, bx, by, by + 12); break;
            case 'poppy': img(S.poppy, bx, by, by + 10, false); break;
            case 'glowcap': img(S.glowcap, bx, by, by + 12, false); break;
          }
        }
        const so = s.soil[i];
        if (so && so.crop) {
          const stage = Rules.cropStage(so.crop);
          const ready = stage >= GHV.CROPS[so.crop.id].stages.length;
          const im = S.crops[so.crop.id][Math.min(stage, 3)];
          if (ready) {
            ents.push({
              y: by + 12, img: im, dx: bx, dy: by - 8, shadow: true,
              draw: function (ctx) {
                // Ripe crops sway gently and sparkle so they're easy to spot.
                const sway = Math.round(Math.sin(self.time * 2 + tx) * 0.6);
                ctx.drawImage(im, bx + sway, by - 8);
                if (Math.sin(self.time * 3 + tx * 1.7 + ty) > 0.93) {
                  ctx.fillStyle = '#fff6d0';
                  ctx.fillRect(bx + 4 + ((tx * 5) % 8), by - 2 + ((ty * 3) % 6), 1, 1);
                }
              },
            });
          } else {
            img(im, bx, by - 8, by + 11);
          }
        }
      }
    }

    // Buildings
    for (const st of w.structures) {
      if (st.x + st.w < x0 - 2 || st.x > x1 + 2 || st.y > y1 + 1 || st.y + st.h < y0 - 3) continue;
      const bx = st.x * T, bottom = (st.y + st.h) * T;
      if (st.type === 'house') img(S.house, bx, bottom - 80, bottom - 1);
      else if (st.type === 'cottage') img(S.cottage[st.roof], bx, bottom - 80, bottom - 1);
      else if (st.type === 'stall') {
        img(S.stall.back, bx, bottom - 64, (st.y + 1) * T + 4);
        img(S.stall.front, bx, bottom - 64, bottom, false);
      } else if (st.type === 'lantern') {
        img(S.lantern[s.restored ? 1 : 0], bx, bottom - 64, bottom - 1);
      }
      if (st.type === 'house' || st.type === 'cottage') this.pushWindows(ents, bx, bottom - 80, bottom);
    }

    // People
    for (const n of game.npcs) {
      if (!n.visible) continue;
      const frame = n.moving ? Math.floor(n.animT * 6) % 4 : 0;
      const nx = Math.round(n.x), ny = Math.round(n.y);
      ents.push({
        y: n.y, person: true, px: nx, py: ny, h: 22,
        draw: function (ctx) { GHV.Sprites.drawCharacter(ctx, nx, ny, n.id, n.facing, frame, false); },
      });
    }
    const p = s.player;
    const pframe = p.moving ? Math.floor(p.animT * 8) % 4 : 0;
    const ppx = Math.round(p.x), ppy = Math.round(p.y);
    ents.push({
      y: p.y + 0.5, person: true, px: ppx, py: ppy, h: 24,
      draw: function (ctx) { self.drawPlayer(ctx, ppx, ppy, p, pframe); },
    });
    return ents;
  };

  // Windows glow warmly after dusk.
  Renderer.prototype.pushWindows = function (ents, bx, by, bottom) {
    const self = this;
    ents.push({
      y: bottom - 0.5, shadow: false,
      draw: function (ctx) {
        const l = self.sky ? self.sky.light : 0;
        if (l < 0.05) return;
        ctx.globalAlpha = Math.min(1, l * 1.2);
        for (const wx of [10, 56]) {
          ctx.fillStyle = '#ffd56e';
          ctx.fillRect(bx + wx + 1, by + 56, 12, 10);
          ctx.fillStyle = '#fff1b8';
          ctx.fillRect(bx + wx + 1, by + 56, 5, 4);
          ctx.fillStyle = '#5a3a20';
          ctx.fillRect(bx + wx + 6, by + 56, 1, 10);
          ctx.fillRect(bx + wx + 1, by + 60, 12, 1);
        }
        ctx.globalAlpha = 1;
      },
    });
  };

  const TOOL_POSE = {
    right: { hx: 5, hy: -12 },
    left: { hx: -5, hy: -12 },
    down: { hx: 4, hy: -9 },
    up: { hx: -4, hy: -13 },
  };

  Renderer.prototype.drawPlayer = function (ctx, x, y, p, frame) {
    const swinging = p.tool && p.tool !== 'hands';
    const hop = p.tool === 'hands' ? -1 : 0;
    const drawTool = () => {
      if (!swinging) return;
      const icon = this.S.icons[p.tool];
      if (!icon) return;
      const prog = 1 - p.toolT / 0.28;
      const pose = TOOL_POSE[p.facing];
      ctx.save();
      ctx.translate(x + pose.hx, y + pose.hy);
      if (p.facing === 'left') ctx.scale(-1, 1);
      let ang;
      if (p.tool === 'can') ang = U.lerp(-0.2, 0.7, U.smoothstep(prog * 2));
      else ang = U.lerp(-1.9, 0.5, U.smoothstep(prog * 1.6));
      if (p.facing === 'down') ang += 0.6;
      if (p.facing === 'up') ang -= 0.4;
      ctx.rotate(ang);
      ctx.drawImage(icon, -4, -12);
      ctx.restore();
    };
    if (p.facing === 'up') drawTool();
    GHV.Sprites.drawCharacter(ctx, x, y + hop, 'player', p.facing, frame, swinging);
    if (p.facing !== 'up') drawTool();
  };

  // Long shadows: every sprite's silhouette is sheared along the sun direction.
  Renderer.prototype.drawShadows = function (ents, camX, camY, sk) {
    const sc = this.scale;
    const sg = this.shadowCanvas.getContext('2d');
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, this.shadowCanvas.width, this.shadowCanvas.height);
    sg.imageSmoothingEnabled = false;
    const dir = shadowDir(this.game.state.time);
    const sun = sk.sun;
    sg.fillStyle = '#000';
    for (const e of ents) {
      if (e.person) {
        // Contact shadow plus a stretched body shadow.
        sg.setTransform(sc, 0, 0, sc, (e.px - camX) * sc, (e.py - camY) * sc);
        sg.beginPath();
        sg.ellipse(0, -1, 5, 2, 0, 0, Math.PI * 2);
        sg.fill();
        if (sun > 0.05) {
          sg.save();
          sg.transform(1, 0, -dir.x, -dir.y, 0, 0);
          sg.fillRect(-3, -e.h + 4, 6, e.h - 5);
          sg.beginPath();
          sg.ellipse(0, -e.h + 5, 4, 4, 0, 0, Math.PI * 2);
          sg.fill();
          sg.restore();
        }
        continue;
      }
      if (!e.img || !e.shadow) continue;
      const sil = this.silhouette(e.img);
      const baseY = e.dy + e.img.height - (e.img.height > 30 ? 1 : 3);
      sg.setTransform(sc, 0, 0, sc, (e.dx - camX) * sc, (baseY - camY) * sc);
      if (sun > 0.05) {
        sg.save();
        sg.transform(1, 0, -dir.x, -dir.y, 0, 0);
        sg.drawImage(sil, 0, -e.img.height + (e.img.height > 30 ? 1 : 3));
        sg.restore();
      }
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.18 + sun * 0.17;
    ctx.globalCompositeOperation = 'multiply';
    // Tint shadows a cool violet: complementary to the golden light.
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = '#2b1840';
    sg.fillRect(0, 0, this.shadowCanvas.width, this.shadowCanvas.height);
    sg.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.shadowCanvas, 0, 0);
    ctx.restore();
  };

  // ---------------------------------------------------------------------------
  // Lighting
  // ---------------------------------------------------------------------------
  Renderer.prototype.collectLights = function (sk, x0, y0, x1, y1) {
    const game = this.game, s = game.state, w = game.world;
    const L = [];
    const night = sk.light;
    const inView = function (x, y, r) {
      return x + r > x0 * T && x - r < (x1 + 1) * T && y + r > y0 * T && y - r < (y1 + 1) * T;
    };
    if (night > 0.02) {
      for (const lp of w.lamps) {
        const lx = lp.x * T + 8, ly = lp.y * T - 10;
        if (inView(lx, ly, 80)) L.push({ x: lx, y: ly, r: 78, c: [255, 196, 120], a: night * (0.95 + Math.sin(this.time * 7 + lp.x) * 0.03) });
      }
      for (const st of w.structures) {
        if (st.type !== 'house' && st.type !== 'cottage') continue;
        const top = (st.y + st.h) * T - 80;
        for (const wx of [17, 63]) {
          const lx = st.x * T + wx, ly = top + 64;
          if (inView(lx, ly, 50)) L.push({ x: lx, y: ly, r: 46, c: [255, 186, 104], a: night * 0.85 });
        }
      }
      // A little lantern-light around the player so night work is possible.
      L.push({ x: s.player.x, y: s.player.y - 8, r: 62, c: [255, 222, 170], a: night * 0.55 });
    }
    // The Great Lantern: faint until restored, then a beacon.
    const lan = w.structures.find(function (st) { return st.type === 'lantern'; });
    if (lan) {
      const lx = lan.x * T + 16, ly = (lan.y + lan.h) * T - 50;
      const prog = game.offeringProgress();
      const strength = s.restored ? 1 : 0.15 + prog * 0.55;
      const flicker = s.restored ? 1 : 0.85 + Math.sin(this.time * 9) * 0.1 + Math.sin(this.time * 23) * 0.05;
      const r = s.restored ? 210 : 50 + prog * 90;
      if (inView(lx, ly, r)) L.push({ x: lx, y: ly, r: r, c: [255, 214, 130], a: Math.max(night, 0.25) * strength * flicker });
    }
    // Glowcaps and ripe ember pumpkins hold sunlight.
    if (night > 0.1) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w.w + x;
          if (w.obj[i] === 'glowcap') L.push({ x: x * T + 8, y: y * T + 8, r: 20, c: [255, 196, 90], a: night * 0.8 });
          const so = s.soil[i];
          if (so && so.crop && so.crop.id === 'ember_pumpkin' && Rules.isMature(so.crop)) {
            L.push({ x: x * T + 8, y: y * T + 6, r: 22, c: [255, 128, 56], a: night * 0.8 });
          }
        }
      }
    }
    return L;
  };

  Renderer.prototype.drawLighting = function (ctx, sk, camX, camY, x0, y0, x1, y1) {
    const lc = this.lightCanvas, lg = lc.getContext('2d');
    const k = this.scale / 4;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'source-over';
    lg.fillStyle = U.rgba(sk.mul);
    lg.fillRect(0, 0, lc.width, lc.height);
    const lights = this.collectLights(sk, x0, y0, x1, y1);
    lg.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      const x = (l.x - camX) * k, y = (l.y - camY) * k, r = l.r * k;
      const grad = lg.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(' + l.c[0] + ',' + l.c[1] + ',' + l.c[2] + ',' + l.a.toFixed(3) + ')');
      grad.addColorStop(0.45, 'rgba(' + l.c[0] + ',' + Math.round(l.c[1] * 0.8) + ',' + Math.round(l.c[2] * 0.6) + ',' + (l.a * 0.45).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      lg.fillStyle = grad;
      lg.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lc, 0, 0, lc.width * 4, lc.height * 4);
    // Golden haze, strongest on the side the sun is setting.
    const W = this.canvas.width, H = this.canvas.height;
    if (sk.haze[3] > 0.005) {
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = U.rgba(sk.haze, 0.5);
      ctx.fillRect(0, 0, W, H);
      const evening = this.game.state.time > 720;
      const grad = ctx.createLinearGradient(evening ? 0 : W, 0, evening ? W : 0, H * 0.4);
      grad.addColorStop(0, U.rgba(sk.haze, 1.4));
      grad.addColorStop(0.6, U.rgba(sk.haze, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      this.drawRays(ctx, sk, evening);
    }
    // Soft bloom around strong lights.
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (l.r < 40 && l.a < 0.5) continue;
      const x = (l.x - camX) * this.scale, y = (l.y - camY) * this.scale, r = l.r * this.scale * 0.45;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,214,140,' + (0.22 * l.a).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  };

  // Slow diagonal shafts of light during the golden hour.
  Renderer.prototype.drawRays = function (ctx, sk, evening) {
    const strength = U.clamp((sk.haze[3] - 0.1) * 4, 0, 1) * (this.game.state.weather === 'sunshower' ? 0.5 : 1);
    if (strength <= 0) return;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.save();
    if (!evening) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    for (let i = 0; i < 4; i++) {
      const x = ((i * 0.31 + this.time * 0.006 * (i % 2 ? 1 : -0.6)) % 1.2) * W - W * 0.1;
      const wdt = W * (0.05 + (i % 3) * 0.03);
      ctx.fillStyle = 'rgba(255,214,140,' + (0.045 * strength).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(x, -10);
      ctx.lineTo(x + wdt, -10);
      ctx.lineTo(x + wdt + H * 0.7, H + 10);
      ctx.lineTo(x + H * 0.7, H + 10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  Renderer.prototype.drawRain = function (ctx) {
    if (!this.rain.length) return;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.strokeStyle = 'rgba(255,236,190,0.55)';
    ctx.lineWidth = Math.max(1, this.scale / 3);
    ctx.beginPath();
    for (const r of this.rain) {
      const x = r.x * W, y = r.y * H;
      ctx.moveTo(x, y);
      ctx.lineTo(x + 3 * this.scale * r.s, y + 9 * this.scale * r.s);
    }
    ctx.stroke();
  };

  Renderer.prototype.drawVignette = function (ctx, sk) {
    const W = this.canvas.width, H = this.canvas.height;
    const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, sk.light > 0.5 ? 'rgba(10,8,30,0.45)' : 'rgba(70,30,20,0.28)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  };

  Renderer.prototype.drawCursor = function (ctx) {
    if (!this.showCursor || !this.target) return;
    const t = this.target;
    const a = 0.55 + Math.sin(this.time * 6) * 0.25;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#fff6d8';
    const x = t.x * T, y = t.y * T;
    // Corner brackets
    ctx.fillRect(x, y, 4, 1); ctx.fillRect(x, y, 1, 4);
    ctx.fillRect(x + T - 4, y, 4, 1); ctx.fillRect(x + T - 1, y, 1, 4);
    ctx.fillRect(x, y + T - 1, 4, 1); ctx.fillRect(x, y + T - 4, 1, 4);
    ctx.fillRect(x + T - 4, y + T - 1, 4, 1); ctx.fillRect(x + T - 1, y + T - 4, 1, 4);
    ctx.globalAlpha = 1;
  };

  GHV.Renderer = Renderer;
  GHV.Sky = { sky: sky, shadowDir: shadowDir };
})(window.GHV = window.GHV || {});
