// HUD: crosshair, hit markers, damage arcs, compass, vitals, ammo, kill feed, comms, death and scoreboard.
import { FACTIONS, MATCH } from '../config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class HUD {
  constructor(game, settings) {
    this.g = game;
    this.settings = settings;
    this.root = $('hud');
    this.spread = 0;
    this.hitT = 9;
    this.noticeT = 9;
    this.killer = null;
    this.deathT = 0;
    this.buildCompass();
    this.fpsT = 0; this.frames = 0;
  }

  show(v) { this.root.hidden = !v; }

  reset() {
    $('killfeed').innerHTML = '';
    $('confirm').innerHTML = '';
    $('comms').innerHTML = '';
    $('death').hidden = true;
    $('scoreboard').hidden = true;
    $('limit').textContent = 'FIRST TO ' + MATCH.scoreLimit;
    this.killer = null;
    this.refreshAmmo();
  }

  buildCompass() {
    const strip = $('compass-strip');
    const PX = 4; // pixels per degree
    let html = '';
    const cards = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -180; d <= 540; d += 15) {
      const deg = ((d % 360) + 360) % 360;
      const label = cards[deg] || (deg % 45 === 0 ? '' : deg % 15 === 0 ? String(deg) : '');
      html += '<span class="' + (cards[deg] ? 'card' : '') + '" style="left:' + (d + 180) * PX + 'px">' + (cards[deg] || label) + '</span>';
    }
    strip.innerHTML = html;
    this.compassPx = PX;
  }

  // --- events -------------------------------------------------------------------------
  bloom(spread) { this.spread = Math.min(40, this.spread + spread * 2.2); }

  hitmarker(head, kill) {
    const h = $('hitmarker');
    h.classList.toggle('head', head);
    h.classList.toggle('kill', kill);
    this.hitT = 0;
  }

  damage(fromPos, amount) {
    $('vignette').style.opacity = String(Math.min(1, 0.35 + amount / 50));
    this.vigT = 0;
    if (!fromPos) return;
    const p = this.g.player;
    const ang = Math.atan2(fromPos.x - p.body.p.x, fromPos.z - p.body.p.z);
    const rel = ang - (p.yaw + Math.PI);
    const el = document.createElement('div');
    el.className = 'dmg';
    el.style.transform = 'rotate(' + (-rel) + 'rad)';
    $('damage').appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; setTimeout(() => { el.style.opacity = '0'; }, 250); });
    setTimeout(() => el.remove(), 1600);
  }

  notice(text) {
    const n = $('notice');
    n.textContent = text;
    n.style.opacity = '1';
    this.noticeT = 0;
  }

  nameOf(c) {
    if (c === this.g.player) return '<span class="you">You</span>';
    return '<span class="' + c.team + '">' + esc(c.name) + '</span>';
  }

  killfeed(a, v, info) {
    const el = document.createElement('div');
    el.className = 'kf';
    const w = info.weapon && info.weapon.name ? info.weapon.name : '';
    el.innerHTML = (a ? this.nameOf(a) : '') + ' <span class="w">' + esc(w) + (info.dist ? ' · ' + Math.round(info.dist) + 'm' : '') + '</span>' + (info.zone === 'head' && !info.explosive ? ' <span class="hs">HEADSHOT</span>' : '') + ' ' + this.nameOf(v);
    const kf = $('killfeed');
    kf.prepend(el);
    while (kf.children.length > 5) kf.lastChild.remove();
    setTimeout(() => el.remove(), 7000);
  }

  // Your own kills: who went down, the points, and a medal for quick multi-kills.
  confirmKill(victim, info, points, streak) {
    const box = $('confirm');
    const el = document.createElement('div');
    el.className = 'kc';
    const head = info.zone === 'head' && !info.explosive;
    el.innerHTML = '<span class="lbl">' + (head ? 'Headshot' : 'Eliminated') + '</span><span>' + esc(victim.name) + '</span><span class="pts">+' + points + '</span>';
    box.appendChild(el);
    setTimeout(() => el.remove(), 3000);
    const lines = box.querySelectorAll('.kc:not(.medal)');
    for (let i = 0; i < lines.length - 3; i++) lines[i].remove();
    if (streak > 1) {
      // one medal at a time, always on top
      const old = box.querySelector('.medal');
      if (old) old.remove();
      const m = document.createElement('div');
      m.className = 'kc medal';
      m.textContent = streak === 2 ? 'Double kill' : streak === 3 ? 'Triple kill' : 'Multi kill';
      box.prepend(m);
      setTimeout(() => m.remove(), 3000);
    }
  }

  // A centred title card: match start, victory, defeat.
  banner(title, sub, cls = '') {
    const b = $('banner');
    b.className = cls;
    b.innerHTML = '<b>' + esc(title) + '</b><span>' + esc(sub) + '</span>';
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth; // restart the animation
    b.style.animation = '';
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => { b.hidden = true; }, 3700);
  }

  comms(name, text) {
    const el = document.createElement('div');
    el.className = 'cm';
    el.innerHTML = '<span class="radio">RADIO</span><b>' + esc(name) + '</b>' + esc(text);
    const c = $('comms');
    c.appendChild(el);
    while (c.children.length > 4) c.firstChild.remove();
    setTimeout(() => el.remove(), 5500);
  }

  died(killer, info, t) {
    this.killer = killer;
    this.deathT = t;
    const d = $('death');
    d.hidden = false;
    const w = info.weapon && info.weapon.name ? info.weapon.name : '';
    $('death-line').innerHTML = killer && killer !== this.g.player
      ? 'Killed by ' + this.nameOf(killer) + ' <span class="w">' + esc(w) + (info.dist ? ' · ' + Math.round(info.dist) + ' m' : '') + (info.zone === 'head' && !info.explosive ? ' · headshot' : '') + '</span>'
      : 'You died.';
    $('crosshair').style.opacity = '0';
  }

  respawned() {
    $('death').hidden = true;
    this.killer = null;
    $('crosshair').style.opacity = '1';
    this.refreshAmmo();
  }

  matchOver(winner) {
    const win = winner === this.g.player.team;
    this.banner(win ? 'Victory' : 'Defeat', (FACTIONS[winner] ? FACTIONS[winner].name : winner) + ' holds Old Town', win ? 'win' : 'lose');
  }

  refreshAmmo() {
    const p = this.g.player;
    if (!p.weapons.length) return;
    const ws = p.ws, s = ws.stats;
    $('w-name').textContent = s.name;
    $('w-cal').textContent = s.caliber;
    $('w-mode').textContent = ws.modeName.toUpperCase();
    const mag = $('ammo-mag');
    if (this.settings.ammoDisplay === 'magcheck') {
      mag.textContent = ws.magCheck();
      mag.className = 'text';
      $('ammo-ch').textContent = '';
      $('ammo-res').textContent = '';
    } else {
      mag.textContent = ws.mag;
      mag.className = ws.mag <= Math.ceil(s.mag * 0.2) ? 'low' : '';
      $('ammo-ch').textContent = ws.chambered ? '+1' : '';
      $('ammo-res').textContent = '/ ' + ws.reserve;
    }
    $('frags').textContent = '⬤'.repeat(p.frags) + '◯'.repeat(Math.max(0, 2 - p.frags));
  }

  // --- per frame ------------------------------------------------------------------------
  update(dt, input) {
    const g = this.g, p = g.player;
    // Crosshair: hidden when aiming, opens with movement and firing.
    const ws = p.weapons.length ? p.ws : null;
    if (ws) {
      const moving = Math.hypot(p.body.v.x, p.body.v.z);
      const base = ws.stats.hipSpread * 4 + (moving > 0.5 ? ws.stats.moveSpread * 5 : 0) + (p.stance === 'crouch' ? -2 : 0);
      this.spread += (0 - this.spread) * Math.min(1, dt * 6);
      const gap = Math.max(3, base + this.spread);
      const ch = $('crosshair');
      ch.style.setProperty('--gap', gap.toFixed(1) + 'px');
      if (p.alive) ch.style.opacity = String(Math.max(0, 1 - g.vm.adsT * 2.5) * (p.sprint ? 0.25 : 1));
    }
    this.hitT += dt;
    $('hitmarker').style.opacity = String(Math.max(0, 1 - this.hitT / 0.22));
    this.noticeT += dt;
    if (this.noticeT > 1.6) $('notice').style.opacity = '0';
    if (this.vigT !== undefined) {
      this.vigT += dt;
      const low = p.health < 35 ? 0.35 + Math.sin(g.time * 6) * 0.1 : 0;
      $('vignette').style.opacity = String(Math.max(low, 1 - this.vigT / 0.9));
    }
    // Vitals
    $('hp-fill').style.width = p.health + '%';
    $('hp-fill').parentElement.classList.toggle('low', p.health < 35);
    $('hp-num').textContent = Math.ceil(p.health);
    $('ar-fill').style.width = p.armor + '%';
    $('ar-num').textContent = Math.ceil(p.armor);
    $('st-fill').style.width = p.stamina + '%';
    $('stance').textContent = p.slide > 0 ? 'SLIDE' : p.mantle ? 'VAULT' : p.stance.toUpperCase();
    // Scores and clock
    $('score-msg').textContent = g.scores.msg;
    $('score-volk').textContent = g.scores.volk;
    const t = Math.ceil(g.timeLeft);
    $('timer').textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    // Compass: heading 0 = north (-Z)
    const heading = ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360;
    $('compass-strip').style.transform = 'translateX(' + (180 - (heading + 180) * this.compassPx) + 'px)';
    $('protect').hidden = !(p.alive && g.time - p.spawnT < MATCH.spawnProtect);
    if (!p.alive && this.deathT > 0) {
      this.deathT -= dt;
      $('death-timer').textContent = Math.max(0, Math.ceil(this.deathT));
    }
    if (p.alive && ws) {
      // Keep ammo fresh (reload animations change it mid-way).
      if (this._lastAmmo !== ws.mag + ':' + ws.reserve + ':' + ws.chambered + ':' + p.cur + ':' + p.frags) { this._lastAmmo = ws.mag + ':' + ws.reserve + ':' + ws.chambered + ':' + p.cur + ':' + p.frags; this.refreshAmmo(); }
    }
    // Scoreboard
    const sb = $('scoreboard');
    const showSb = input.down('Tab') || g.state === 'over';
    if (showSb && g.state !== 'over') { sb.hidden = false; sb.innerHTML = this.board(); }
    else sb.hidden = true;
    // FPS
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) {
      const f = $('fps');
      f.hidden = !this.settings.showFps;
      const info = g.R.r.info.render;
      f.textContent = Math.round(this.frames / this.fpsT) + ' fps · ' + info.calls + ' draws · ' + Math.round(info.triangles / 1000) + 'k tris';
      this.frames = 0; this.fpsT = 0;
    }
  }

  board() {
    const g = this.g;
    let h = '<table class="sb"><tr><th>Operator</th><th>K</th><th>D</th><th>HS</th><th>Acc</th><th>Score</th></tr>';
    for (const team of ['msg', 'volk']) {
      h += '<tr class="team ' + team + '"><td colspan="6">' + FACTIONS[team].name.toUpperCase() + ' — ' + g.scores[team] + '</td></tr>';
      const list = g.characters.filter((c) => c.team === team).sort((a, b) => b.stats.score - a.stats.score);
      for (const c of list) {
        const acc = c.stats.shots ? Math.round((c.stats.hits / c.stats.shots) * 100) + '%' : '–';
        h += '<tr class="' + (c === g.player ? 'you' : '') + (c.alive ? '' : ' dead') + '"><td>' + (c === g.player ? 'You' : esc(c.name)) + '</td><td>' + c.stats.kills + '</td><td>' + c.stats.deaths + '</td><td>' + c.stats.hs + '</td><td>' + acc + '</td><td>' + c.stats.score + '</td></tr>';
      }
    }
    return h + '</table>';
  }
}
