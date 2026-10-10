// Menus: main, loadouts, gunsmith, settings, controls, pause and end of match.
import { WEAPONS, ATTACHMENTS, ATTACHMENT_SLOTS, SLOT_NAMES, PRESETS, weaponStats, statBars, FACTIONS } from '../config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SCREENS = ['menu', 'loadouts', 'gunsmith', 'settings', 'controls', 'pause', 'over', 'clicktoplay'];

export class Menus {
  constructor(app) {
    this.app = app;
    this.stack = [];
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (!go) return;
      app.audio.foley('click');
      const to = go.getAttribute('data-go');
      if (to === 'deploy') { app.deploy(); return; }
      if (to === 'back') { this.show(this.stack.pop() || 'menu', true); return; }
      this.show(to);
    });
    document.querySelectorAll('#diff-seg button').forEach((b) => {
      b.addEventListener('click', () => { app.settings.difficulty = b.dataset.diff; app.saveSettings(); this.renderDiff(); });
    });
    $('resume').addEventListener('click', () => app.resume());
    $('leave').addEventListener('click', () => app.toMenu());
    $('again').addEventListener('click', () => app.deploy());
    $('to-menu').addEventListener('click', () => app.toMenu());
    $('clicktoplay').addEventListener('click', () => app.resume());
  }

  show(name, isBack) {
    const cur = this.current;
    if (!isBack && cur && cur !== name && (name === 'settings' || name === 'controls' || name === 'gunsmith')) this.stack.push(cur);
    if (name === 'menu' || name === 'loadouts') this.stack = name === 'loadouts' ? ['menu'] : [];
    for (const s of SCREENS) $(s).hidden = s !== name;
    this.current = name;
    this.app.onScreen(name);
    if (name === 'menu') { this.renderMenuLoadout(); this.renderDiff(); }
    if (name === 'loadouts') this.renderLoadouts();
    if (name === 'settings') this.renderSettings();
    if (name === 'controls') this.renderControls();
    if (name === 'gunsmith') this.renderGunsmith();
  }

  hideAll() { for (const s of SCREENS) $(s).hidden = true; this.current = null; }

  renderDiff() {
    document.querySelectorAll('#diff-seg button').forEach((b) => b.classList.toggle('on', b.dataset.diff === this.app.settings.difficulty));
  }

  attText(id, att) {
    const names = Object.values(att || {}).map((a) => ATTACHMENTS[a] && ATTACHMENTS[a].name).filter(Boolean);
    return names.length ? names.join(' · ') : 'No attachments';
  }

  renderMenuLoadout() {
    const lo = this.app.loadout();
    $('menu-loadout').innerHTML = '<h3>Loadout · ' + esc(lo.name) + '</h3><div class="lo-sum">' +
      ['primary', 'secondary'].map((slot) => {
        const id = lo[slot], w = WEAPONS[id];
        return '<div class="w"><span>' + slot + '</span><b>' + esc(w.name) + '</b><em>' + esc(this.attText(id, lo.att[id])) + '</em></div>';
      }).join('') + '<div class="w"><span>Gear</span><b>2× Frag · Plate carrier</b></div></div>';
  }

  renderLoadouts() {
    const app = this.app;
    const grid = $('lo-grid');
    grid.innerHTML = '';
    app.loadouts.forEach((lo, i) => {
      const card = document.createElement('div');
      card.className = 'panel lo-card' + (i === app.settings.loadout ? ' on' : '');
      const prim = Object.values(WEAPONS).filter((w) => w.slot === 'primary');
      card.innerHTML = '<h3>' + esc(lo.name) + (i === app.settings.loadout ? '<small>EQUIPPED</small>' : '') + '</h3>' +
        '<div class="lbl" style="color:var(--muted);font-size:13px;letter-spacing:.1em">PRIMARY</div>' +
        '<div class="pick">' + prim.map((w) => '<button class="chip' + (lo.primary === w.id ? ' on' : '') + '" data-p="' + w.id + '">' + esc(w.name) + '</button>').join('') + '</div>' +
        '<div class="atts">' + esc(this.attText(lo.primary, lo.att[lo.primary])) + '</div>' +
        '<button class="mbtn" data-smith="primary">Gunsmith · ' + esc(WEAPONS[lo.primary].name) + '</button>' +
        '<div class="lbl" style="color:var(--muted);font-size:13px;letter-spacing:.1em;margin-top:12px">SECONDARY</div>' +
        '<div class="atts">' + esc(WEAPONS[lo.secondary].name) + ' — ' + esc(this.attText(lo.secondary, lo.att[lo.secondary])) + '</div>' +
        '<button class="mbtn" data-smith="secondary">Gunsmith · ' + esc(WEAPONS[lo.secondary].name) + '</button>' +
        '<button class="mbtn primary" data-equip="1" style="margin-top:12px">' + (i === app.settings.loadout ? 'Equipped' : 'Equip') + '</button>';
      card.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); lo.primary = b.dataset.p; lo.att[lo.primary] = lo.att[lo.primary] || {}; app.saveLoadouts(); this.renderLoadouts(); }));
      card.querySelectorAll('[data-smith]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.smith = { lo: i, slot: b.dataset.smith }; this.show('gunsmith'); }));
      card.querySelector('[data-equip]').addEventListener('click', (e) => { e.stopPropagation(); app.settings.loadout = i; app.saveSettings(); this.renderLoadouts(); });
      grid.appendChild(card);
    });
  }

  renderGunsmith() {
    const app = this.app;
    const sm = this.smith || { lo: app.settings.loadout, slot: 'primary' };
    const lo = app.loadouts[sm.lo];
    const id = lo[sm.slot];
    const w = WEAPONS[id];
    lo.att[id] = lo.att[id] || {};
    const att = lo.att[id];
    $('gs-title').textContent = 'Gunsmith · ' + lo.name;
    $('gs-name').textContent = w.name;
    app.studio.show(id, att);
    // Slots
    const slots = $('gs-slots');
    slots.innerHTML = '';
    for (const slot of ATTACHMENT_SLOTS) {
      const opts = w.attachments.filter((a) => ATTACHMENTS[a].slot === slot);
      if (!opts.length) continue;
      const box = document.createElement('div');
      box.className = 'slot';
      box.innerHTML = '<h4>' + SLOT_NAMES[slot] + '</h4><div class="opts"></div>';
      const list = box.querySelector('.opts');
      for (const a of [null].concat(opts)) {
        const b = document.createElement('button');
        b.className = 'opt' + ((att[slot] || null) === a ? ' on' : '');
        b.innerHTML = a ? esc(ATTACHMENTS[a].name) + '<small>' + esc(ATTACHMENTS[a].desc) + '</small>' : 'None<small>' + (slot === 'optic' ? 'Iron sights' : slot === 'muzzle' ? (id === 'kestrel' ? 'A2-style flash hider' : 'Bare muzzle') : slot === 'magazine' ? WEAPONS[id].mag + ' rounds' : '—') + '</small>';
        b.addEventListener('click', () => {
          if (a) att[slot] = a; else delete att[slot];
          app.saveLoadouts();
          app.audio.foley('selector');
          this.renderGunsmith();
        });
        list.appendChild(b);
      }
      slots.appendChild(box);
    }
    // Stats with deltas against the bare weapon
    const base = statBars(weaponStats(id, {}));
    const s = weaponStats(id, att);
    const cur = statBars(s);
    $('gs-spec').innerHTML = [
      ['Type', w.type], ['Calibre', w.caliber], ['Rate', s.rpm + ' rpm'], ['Capacity', s.mag + ' + 1'],
      ['Velocity', Math.round(s.velocity) + ' m/s'], ['Weight', s.weight.toFixed(2) + ' kg'], ['ADS', Math.round(s.adsTime * 1000) + ' ms'],
      ['Reload', (s.reload.tactical ? s.reload.tactical.toFixed(2) + ' s / ' + s.reload.empty.toFixed(2) + ' s' : s.reload.shell.toFixed(2) + ' s per shell')],
    ].map((r) => '<span>' + r[0] + '</span><b>' + esc(r[1]) + '</b>').join('');
    let html = '';
    for (const k in cur) {
      const d = cur[k] - base[k];
      const lo2 = Math.min(cur[k], base[k]), hi = Math.max(cur[k], base[k]);
      html += '<div class="stat"><div class="top"><span>' + k + '</span><em class="' + (d > 0.005 ? 'up' : d < -0.005 ? 'down' : '') + '">' + (Math.abs(d) > 0.005 ? (d > 0 ? '+' : '−') + Math.round(Math.abs(d) * 100) : '') + '</em></div>' +
        '<div class="sbar"><i style="width:' + (lo2 * 100).toFixed(1) + '%"></i>' + (Math.abs(d) > 0.005 ? '<i class="' + (d > 0 ? 'delta-up' : 'delta-down') + '" style="left:' + (lo2 * 100).toFixed(1) + '%;width:' + ((hi - lo2) * 100).toFixed(1) + '%"></i>' : '') + '</div></div>';
    }
    $('gs-stats').innerHTML = html;
  }

  renderSettings() {
    const app = this.app, s = app.settings;
    const f = $('settings-form');
    f.innerHTML = `
      <label for="set-preset">Graphics</label>
      <select id="set-preset">${Object.keys(PRESETS).map((k) => `<option value="${k}" ${s.preset === k ? 'selected' : ''}>${PRESETS[k].name}</option>`).join('')}</select>
      <label for="set-fov">Field of view</label>
      <div><input id="set-fov" type="range" min="60" max="120" step="1" value="${s.fov}"><span class="val" id="v-fov">${s.fov}°</span></div>
      <label for="set-sens">Mouse sensitivity</label>
      <div><input id="set-sens" type="range" min="0.2" max="3" step="0.05" value="${s.sens}"><span class="val" id="v-sens">${s.sens.toFixed(2)}</span></div>
      <label for="set-ads">Aiming sensitivity</label>
      <div><input id="set-ads" type="range" min="0.3" max="1.5" step="0.05" value="${s.adsSens}"><span class="val" id="v-ads">${s.adsSens.toFixed(2)}</span></div>
      <label for="set-inv">Invert Y</label>
      <select id="set-inv"><option value="0" ${!s.invertY ? 'selected' : ''}>Off</option><option value="1" ${s.invertY ? 'selected' : ''}>On</option></select>
      <label for="set-vol">Volume</label>
      <div><input id="set-vol" type="range" min="0" max="1" step="0.05" value="${s.volume}"><span class="val" id="v-vol">${Math.round(s.volume * 100)}%</span></div>
      <label for="set-ammo">Ammo display</label>
      <select id="set-ammo"><option value="numeric" ${s.ammoDisplay === 'numeric' ? 'selected' : ''}>Exact count</option><option value="magcheck" ${s.ammoDisplay === 'magcheck' ? 'selected' : ''}>By feel (mag check)</option></select>
      <label for="set-fps">Performance readout</label>
      <select id="set-fps"><option value="0" ${!s.showFps ? 'selected' : ''}>Hidden</option><option value="1" ${s.showFps ? 'selected' : ''}>Shown</option></select>`;
    const bind = (id, fn) => { const el = $(id); el.addEventListener('input', () => { fn(el.value); app.saveSettings(); }); };
    bind('set-preset', (v) => { s.preset = v; app.applyPreset(); });
    bind('set-fov', (v) => { s.fov = +v; $('v-fov').textContent = v + '°'; });
    bind('set-sens', (v) => { s.sens = +v; $('v-sens').textContent = (+v).toFixed(2); });
    bind('set-ads', (v) => { s.adsSens = +v; $('v-ads').textContent = (+v).toFixed(2); });
    bind('set-inv', (v) => { s.invertY = v === '1'; });
    bind('set-vol', (v) => { s.volume = +v; $('v-vol').textContent = Math.round(v * 100) + '%'; app.audio.setVolume(+v); });
    bind('set-ammo', (v) => { s.ammoDisplay = v; app.game.hud.refreshAmmo(); });
    bind('set-fps', (v) => { s.showFps = v === '1'; });
  }

  renderControls() {
    const rows = [
      ['W A S D', 'Move'], ['Mouse', 'Look'], ['Left click', 'Fire'], ['Right click (hold)', 'Aim down sights'],
      ['Shift (hold)', 'Sprint — double-tap for tactical sprint'], ['C / Ctrl', 'Crouch — while sprinting: slide'], ['Z', 'Prone'],
      ['Q / E (hold)', 'Lean left / right'], ['Space', 'Jump · vault and mantle ledges'], ['R', 'Reload (tactical keeps one in the chamber)'],
      ['T', 'Mag check'], ['B', 'Fire mode'], ['1 / 2 / wheel', 'Switch weapon'], ['G', 'Throw frag'], ['Tab (hold)', 'Scoreboard'], ['Esc', 'Pause'],
    ];
    $('keys').innerHTML = rows.map((r) => '<kbd>' + esc(r[0]) + '</kbd><span>' + esc(r[1]) + '</span>').join('');
  }

  renderOver(winner) {
    const g = this.app.game;
    const won = winner === g.player.team;
    $('over-title').textContent = winner === 'draw' ? 'Draw' : won ? 'Victory' : 'Defeat';
    $('over-sub').textContent = (winner === 'draw' ? 'Time ran out with the score level.' : FACTIONS[winner].name + ' takes Old Town.') + '  MSG ' + g.scores.msg + ' – ' + g.scores.volk + ' Volk';
    $('over-board').innerHTML = g.hud.board();
    this.show('over');
  }
}
