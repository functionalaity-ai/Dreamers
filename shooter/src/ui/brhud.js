// Battle Royale HUD: players alive, kills, the zone clock, a compass marker to the safe zone, the
// inventory bar, the interaction prompt and loot panel, heal/plate progress, a minimap and the
// full-screen map (with the flight line during the drop), the airborne readout and the end screen.
import { WEAPONS } from '../config.js';
import { ITEMS, AMMO, CALIBRE, KIND_NAMES, itemLabel, itemTier } from '../game/loot.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (t) => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const RING = 2 * Math.PI * 26;
const INV = [
  ['bandage', 'Bandage', 'H'], ['medkit', 'Med kit', ''], ['painkillers', 'Pills', ''], ['energy', 'Drink', ''], ['plate', 'Plates', 'Z'], ['frag', 'Frags', 'G'],
];

export class BRHud {
  constructor(game, hud) {
    this.g = game;
    this.hud = hud;
    this.mapOpen = false;
    document.documentElement.classList.add('br');
    const root = document.createElement('div');
    root.id = 'br-hud';
    root.innerHTML = `
      <div id="br-top">
        <div class="cell"><b id="br-alive">16</b><span>Alive</span></div>
        <div class="cell"><b id="br-kills">0</b><span>Kills</span></div>
        <div class="cell zone"><b id="br-ztime">0:00</b><span id="br-zlabel">Zone</span></div>
      </div>
      <canvas id="br-mini" width="168" height="168"></canvas>
      <div id="br-warn" hidden><b>Outside the zone</b><span id="br-warn-sub">Get into the safe area</span></div>
      <div id="br-edge"></div>
      <div id="br-prompt" hidden></div>
      <div id="br-use" hidden><svg viewBox="0 0 60 60"><circle class="trk" cx="30" cy="30" r="26"/><circle class="val" id="br-use-ring" cx="30" cy="30" r="26"/></svg><span id="br-use-t"></span><b id="br-use-name"></b></div>
      <div id="br-inv"></div>
      <div id="br-slots"></div>
      <div id="br-air" hidden><div class="rd"><b id="br-alt">0</b><small>m altitude</small></div><div class="rd"><b id="br-spd">0</b><small>m/s</small></div><div class="hint" id="br-jump">Press <kbd>Space</kbd> / <kbd>F</kbd> to jump</div></div>
      <div id="br-map" hidden><div class="frame"><canvas id="br-map-c"></canvas><div class="mhead"><b>The Outskirts</b><span id="br-map-sub"></span></div><div class="mfoot" id="br-map-foot"></div></div></div>`;
    $('hud').appendChild(root);
    // the loot panel takes taps and clicks, so it sits above the touch controls
    const panel = document.createElement('div');
    panel.id = 'br-loot';
    panel.hidden = true;
    document.body.appendChild(panel);
    this.lootEl = panel;
    panel.addEventListener('click', (e) => {
      const li = e.target.closest('[data-i]');
      const all = e.target.closest('[data-all]');
      if (!this.g.panel) return;
      if (li) this.g.takeOne(this.g.panel, +li.dataset.i);
      else if (all) this.g.takeAll(this.g.panel);
      this.lootKey = null;
    });
    // the safe-zone marker on the compass
    const mark = document.createElement('i');
    mark.id = 'br-zmark';
    $('compass').appendChild(mark);
    this.mini = $('br-mini').getContext('2d');
    this.big = $('br-map-c');
    this.buildStatic();
    hud.board = () => this.board();
    this.frame = 0;
  }

  reset() {
    this.mapOpen = true;   // the plane phase opens on the map
    this.invKey = this.lootKey = this.promptKey = null;
    this.lootEl.hidden = true;
  }

  landed() { this.mapOpen = false; }
  jumped() { this.mapOpen = false; }

  // --- the map, drawn once ---------------------------------------------------------------------
  buildStatic() {
    const g = this.g, b = g.bounds, m = g.map;
    const w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    const s = this.s = Math.min(6, 1800 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * s); c.height = Math.ceil(h * s);
    const x = c.getContext('2d');
    const X = (v) => (v - b.minX) * s, Z = (v) => (v - b.minZ) * s;
    x.fillStyle = '#3b3f33'; x.fillRect(0, 0, c.width, c.height);
    // faint 50 m grid
    x.strokeStyle = 'rgba(233,230,220,0.06)'; x.lineWidth = 1;
    for (let gx = Math.ceil(b.minX / 50) * 50; gx < b.maxX; gx += 50) { x.beginPath(); x.moveTo(X(gx), 0); x.lineTo(X(gx), c.height); x.stroke(); }
    for (let gz = Math.ceil(b.minZ / 50) * 50; gz < b.maxZ; gz += 50) { x.beginPath(); x.moveTo(0, Z(gz)); x.lineTo(c.width, Z(gz)); x.stroke(); }
    x.fillStyle = '#5b5c58';
    for (const r of m.roads || []) x.fillRect(X(Math.min(r.x0, r.x1)), Z(Math.min(r.z0, r.z1)), Math.abs(r.x1 - r.x0) * s, Math.abs(r.z1 - r.z0) * s);
    for (const bd of m.buildings || []) {
      const x0 = X(Math.min(bd.x0, bd.x1)), z0 = Z(Math.min(bd.z0, bd.z1)), bw = Math.abs(bd.x1 - bd.x0) * s, bh = Math.abs(bd.z1 - bd.z0) * s;
      x.fillStyle = bd.destroyed ? '#57504a' : bd.enterable ? '#b3a37c' : '#8a8371';
      x.fillRect(x0, z0, bw, bh);
      x.strokeStyle = 'rgba(10,12,14,0.55)'; x.lineWidth = Math.max(1, s * 0.25);
      x.strokeRect(x0 + 0.5, z0 + 0.5, bw - 1, bh - 1);
    }
    this.staticMap = c;
    this.X = X; this.Z = Z;
  }

  // --- events ------------------------------------------------------------------------------
  eliminated() {
    const el = $('br-alive');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  matchOver(r) {
    if (r.won) this.hud.banner('#1 Victory', 'Last one standing', 'win');
    else this.hud.banner('Eliminated', 'You placed #' + r.place + ' of ' + r.of, 'lose');
  }

  renderOver() {
    const r = this.g.result || { place: 16, of: 16, kills: 0, dmg: 0, time: 0 };
    $('over-title').textContent = r.won ? '#1 Victory' : 'You placed #' + r.place + ' of ' + r.of;
    $('over-sub').textContent = r.won ? 'Last one standing in the Outskirts.' : (this.hud.killer ? 'Eliminated by ' + this.hud.killer.name : 'Eliminated by the zone');
    $('over-board').innerHTML = '<div class="br-stats">' + [
      ['Placement', '#' + r.place], ['Kills', r.kills], ['Damage', r.dmg], ['Survived', clock(r.time)],
    ].map(([k, v]) => '<div><b>' + esc(v) + '</b><span>' + k + '</span></div>').join('') + '</div>';
  }

  board() {
    const g = this.g;
    const list = g.all.slice().sort((a, b) => (b.alive - a.alive) || ((a.place || 0) - (b.place || 0)) || b.stats.kills - a.stats.kills);
    let h = '<table class="sb"><tr><th>Player</th><th>K</th><th>Dmg</th><th>Status</th></tr>';
    for (const c of list) {
      h += '<tr class="' + (c === g.player ? 'you' : '') + (c.alive ? '' : ' dead') + '"><td>' + (c === g.player ? 'You' : esc(c.name)) + '</td><td>' + c.stats.kills + '</td><td>' + Math.round(c.stats.dmg || 0) + '</td><td>' + (c.alive ? 'Alive' : '#' + c.place) + '</td></tr>';
    }
    return h + '</table>';
  }

  // --- per frame ----------------------------------------------------------------------------
  update(dt, input) {
    const g = this.g, p = g.player, z = g.zone, drop = g.drop;
    this.frame++;
    if (input.pressed('KeyM')) this.mapOpen = !this.mapOpen;
    const st = drop.state(p);
    const air = st !== 'landed';
    // top bar
    $('br-alive').textContent = g.alive();
    $('br-kills').textContent = p.stats.kills;
    $('br-ztime').textContent = z.stage === 'closed' ? '—' : clock(z.left);
    $('br-zlabel').textContent = z.stage === 'closed' ? 'Final zone' : z.stage === 'shrink' ? 'Zone ' + (z.phase + 1) + '/' + z.phases.length + ' closing' : 'Zone ' + (z.phase + 1) + '/' + z.phases.length + ' shrinks in';
    $('br-top').classList.toggle('shrinking', z.stage === 'shrink');
    // outside the zone
    const out = !air && p.alive && !z.inside(p.body.p);
    $('br-warn').hidden = !out;
    $('br-edge').classList.toggle('on', out);
    if (out) $('br-warn-sub').textContent = 'Get into the safe area · ' + Math.round(z.dps) + ' HP/s';
    // compass marker towards the safe zone
    const s = z.safe;
    const bearing = Math.atan2(s.x - p.body.p.x, -(s.z - p.body.p.z)) * 180 / Math.PI;
    const heading = -p.yaw * 180 / Math.PI;
    let rel = ((bearing - heading) % 360 + 540) % 360 - 180;
    const mk = $('br-zmark');
    const inSafe = z.insideSafe(p.body.p);
    mk.classList.toggle('in', inSafe);
    mk.classList.toggle('edge', Math.abs(rel) > 43);
    rel = Math.max(-43, Math.min(43, rel));
    mk.style.left = (180 + rel * 4) + 'px';
    // airborne readout
    $('br-air').hidden = !air || !p.alive;
    if (air) {
      $('br-alt').textContent = Math.round(drop.altitude ?? p.body.p.y);
      $('br-spd').textContent = Math.round(drop.speed ?? p.body.v.length());
      $('br-jump').hidden = st !== 'plane';
    }
    this.inventory(p);
    this.prompt(g, p, air);
    this.panel(g);
    this.useRing(g);
    if (this.frame % 2 === 0) this.drawMini(p, z, air);
    const showMap = this.mapOpen && g.state !== 'over';
    $('br-map').hidden = !showMap;
    if (showMap && (this.frame % 3 === 0 || this.frame - (this.bigFrame || -9) > 3)) { this.bigFrame = this.frame; this.drawBig(p, z, st); }
  }

  inventory(p) {
    const inv = p.inv, I = inv.items, ws = p.ws;
    const cal = ws ? CALIBRE[ws.id] : null;
    const key = JSON.stringify(I) + JSON.stringify(inv.ammo) + p.frags + cal + (p.weapons.map((w) => w && w.id).join());
    if (key === this.invKey) return;
    this.invKey = key;
    let h = INV.map(([k, label, kb]) => {
      const n = k === 'frag' ? p.frags : I[k];
      return '<div class="it ' + k + (n ? '' : ' none') + '"><i></i><b>' + n + '</b><span>' + label + (kb ? ' <kbd>' + kb + '</kbd>' : '') + '</span></div>';
    }).join('');
    h += '<div class="sep"></div>' + Object.keys(AMMO).map((c) => '<div class="it ammo a' + c + (c === cal ? ' cur' : '') + (inv.ammo[c] ? '' : ' none') + '"><i></i><b>' + inv.ammo[c] + '</b><span>' + (c === '556' ? '5.56' : c === '9mm' ? '9 mm' : '12 ga') + '</span></div>').join('');
    $('br-inv').innerHTML = h;
    $('br-slots').innerHTML = p.weapons.map((w, i) => '<div class="' + (i === p.cur ? 'cur' : '') + (w ? '' : ' none') + '"><kbd>' + (i + 1) + '</kbd>' + (w ? esc(WEAPONS[w.id].name) : 'Empty') + '</div>').join('');
  }

  prompt(g, p, air) {
    const t = !air && p.alive ? g.look : null;
    const el = $('br-prompt');
    let text = '';
    if (t) {
      if (t.type === 'container') text = t.ref.opened ? '<kbd>E</kbd> Take all' : '<kbd>E</kbd> Search ' + esc(KIND_NAMES[t.ref.kind] || 'container');
      else if (t.type === 'box') text = '<kbd>E</kbd> Take all · ' + esc(t.ref.name) + '’s crate';
      else {
        const it = t.ref.item;
        text = it.type === 'weapon'
          ? '<kbd>E</kbd> ' + (g.emptySlot(p) >= 0 ? 'Pick up ' : 'Swap for ') + esc(WEAPONS[it.id].name)
          : '<kbd>E</kbd> Pick up ' + esc(itemLabel(it));
      }
    }
    if (text !== this.promptKey) { this.promptKey = text; el.innerHTML = text; el.hidden = !text; }
  }

  panel(g) {
    const src = g.state === 'playing' && g.player.alive ? g.panel : null;
    const el = this.lootEl;
    if (!src || !src.items || !src.items.length) { if (!el.hidden) el.hidden = true; this.lootKey = null; return; }
    const key = src.id + ':' + JSON.stringify(src.items) + g.emptySlot(g.player);
    if (key === this.lootKey && !el.hidden) return;
    this.lootKey = key;
    const title = src.kind === 'box' ? src.name + '’s crate' : KIND_NAMES[src.kind] || 'Container';
    const hasGun = src.items.some((it) => it.type === 'weapon');
    el.innerHTML = '<h4>' + esc(title) + '</h4><ul>' + src.items.map((it, i) => '<li data-i="' + i + '" class="t' + itemTier(it) + ' ' + it.type + '"><i></i>' + esc(itemLabel(it)) + '</li>').join('') + '</ul>' +
      '<div class="keys"><button data-all="1"><kbd>E</kbd> Take all</button>' + (hasGun ? '<span><kbd>F</kbd> ' + (g.emptySlot(g.player) >= 0 ? 'Take' : 'Swap') + ' weapon</span>' : '') + '</div>';
    el.hidden = false;
  }

  useRing(g) {
    const u = g.use;
    const el = $('br-use');
    if (!u) { if (!el.hidden) el.hidden = true; return; }
    el.hidden = false;
    $('br-use-ring').style.strokeDashoffset = (RING * (1 - u.t / u.dur)).toFixed(1);
    $('br-use-t').textContent = Math.max(0, u.dur - u.t).toFixed(1);
    $('br-use-name').textContent = ITEMS[u.type].name;
  }

  drawMini(p, z, air) {
    const x = this.mini, W = 168, b = this.g.bounds;
    const span = air ? Math.max(b.maxX - b.minX, b.maxZ - b.minZ) : 110;   // metres across
    const k = W / span;
    const cx = air ? (b.minX + b.maxX) / 2 : p.body.p.x, cz = air ? (b.minZ + b.maxZ) / 2 : p.body.p.z;
    x.fillStyle = '#23261f';
    x.fillRect(0, 0, W, W);
    const s = this.s;
    x.drawImage(this.staticMap, (cx - span / 2 - b.minX) * s, (cz - span / 2 - b.minZ) * s, span * s, span * s, 0, 0, W, W);
    const M = (wx, wz) => [(wx - cx) * k + W / 2, (wz - cz) * k + W / 2];
    this.zoneOverlay(x, M, k, W, W, z);
    if (air) this.flightLine(x, M);
    this.marker(x, M(p.body.p.x, p.body.p.z), p.yaw, 6);
  }

  zoneOverlay(x, M, k, W, H, z) {
    const c = z.cur, [zx, zy] = M(c.x, c.z);
    x.save();
    x.beginPath();
    x.rect(0, 0, W, H);
    x.arc(zx, zy, Math.max(0, c.r * k), 0, Math.PI * 2, true);
    x.fillStyle = 'rgba(40, 70, 160, 0.32)';
    x.fill('evenodd');
    x.lineWidth = 2;
    x.strokeStyle = 'rgba(110, 170, 255, 0.95)';
    x.beginPath(); x.arc(zx, zy, Math.max(0, c.r * k), 0, Math.PI * 2); x.stroke();
    if (z.next) {
      const [nx, ny] = M(z.next.x, z.next.z);
      x.setLineDash([6, 4]);
      x.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      x.beginPath(); x.arc(nx, ny, Math.max(1, z.next.r * k), 0, Math.PI * 2); x.stroke();
      x.setLineDash([]);
    }
    x.restore();
  }

  flightLine(x, M) {
    const g = this.g, path = g.path;
    if (!path) return;
    const [ax, ay] = M(path.a.x, path.a.z), [bx, by] = M(path.b.x, path.b.z);
    x.save();
    x.setLineDash([8, 6]);
    x.lineWidth = 2;
    x.strokeStyle = 'rgba(255, 210, 122, 0.9)';
    x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
    x.restore();
    const d = g.drop;
    if (d.flying && d.pos) {
      const [px, py] = M(d.pos.x, d.pos.z);
      x.save();
      x.translate(px, py);
      x.rotate(Math.atan2(by - ay, bx - ax));
      x.fillStyle = '#ffd27a';
      x.beginPath(); x.moveTo(9, 0); x.lineTo(-6, -7); x.lineTo(-3, 0); x.lineTo(-6, 7); x.closePath(); x.fill();
      x.restore();
    }
  }

  // The player: an arrow pointing where they look (north up).
  marker(x, [mx, my], yaw, r) {
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    const a = Math.atan2(dz, dx);
    x.save();
    x.translate(mx, my);
    x.rotate(a);
    x.fillStyle = '#d9b56a';
    x.strokeStyle = '#16130c';
    x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(r * 1.6, 0); x.lineTo(-r, -r); x.lineTo(-r * 0.4, 0); x.lineTo(-r, r); x.closePath();
    x.fill(); x.stroke();
    x.restore();
  }

  drawBig(p, z, st) {
    const g = this.g, b = g.bounds, c = this.big;
    const w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    const avail = Math.min(window.innerWidth * 0.86, window.innerHeight * 0.74);
    const k = avail / Math.max(w, h);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(w * k), H = Math.round(h * k);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = W + 'px'; c.style.height = H + 'px';
    }
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.drawImage(this.staticMap, 0, 0, W, H);
    const M = (wx, wz) => [(wx - b.minX) * k, (wz - b.minZ) * k];
    this.zoneOverlay(x, M, k, W, H, z);
    if (st === 'plane' || g.drop.flying) this.flightLine(x, M);
    // place names
    x.font = '600 ' + Math.max(11, Math.min(15, k * 4)) + 'px "Saira Condensed", sans-serif';
    x.textAlign = 'center';
    for (const l of g.map.landmarks || []) {
      const [lx, ly] = M(l.x, l.z);
      x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillText(l.name.toUpperCase(), lx + 1, ly + 1);
      x.fillStyle = '#efe9d8'; x.fillText(l.name.toUpperCase(), lx, ly);
    }
    if (p.alive) this.marker(x, M(p.body.p.x, p.body.p.z), p.yaw, 8);
    $('br-map-sub').textContent = st === 'plane' ? 'Choose where to jump' : z.stage === 'closed' ? 'Final zone' : 'Zone ' + (z.phase + 1) + ' · ' + (z.stage === 'wait' ? 'shrinks in ' : 'closing · ') + clock(z.left);
    $('br-map-foot').innerHTML = (st === 'plane' ? '<b>Press <kbd>Space</kbd> / <kbd>F</kbd> to jump</b> · ' : '') + '<span class="lg cur"></span> Zone <span class="lg next"></span> Next zone <span class="lg path"></span> Flight line · <kbd>M</kbd> close';
  }
}
