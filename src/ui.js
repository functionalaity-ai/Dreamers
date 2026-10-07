/* HUD, dialogue and menus (plain DOM). */
(function (GHV) {
  'use strict';
  const C = GHV.CONFIG;
  const ITEMS = GHV.ITEMS;
  const U = GHV.util;
  const Inv = GHV.Inventory;
  const Rules = GHV.Rules;

  const $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const MABEL_GREETINGS = [
    "Come in, come in, love. Everything's fresh — even me.",
    'Seeds by the scoop, buns by the dozen.',
    'Sprinklers are worth every coin. Your gran swore by them.',
    'You look peaky, petal. Honey bun?',
    "Duskberries are my favourite. They keep on giving, like a good neighbour.",
    'Ember Pumpkins take their time. Best plant them early.',
  ];

  function UI(app) {
    this.app = app;
    this.game = app.game;
    this.modal = null;
    this.dialogData = null;
    this.dialogLine = 0;
    this.dialogChars = 0;
    this.dialogTimer = 0;
    this.shopTab = 'goods';
    this.picked = null;
    this.promptText = null;
    this.nameTimer = null;
    this.slots = [];
    this.build();
  }

  UI.prototype.build = function () {
    const self = this;
    // Hotbar
    const hb = $('hotbar');
    for (let i = 0; i < C.HOTBAR_SIZE; i++) {
      const b = this.makeSlot(i);
      b.tabIndex = -1;
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { self.app.audioClick(); self.game.selectSlot(i); });
      b.addEventListener('touchstart', function (e) { self.game.selectSlot(i); e.preventDefault(); }, { passive: false });
      hb.appendChild(b);
      this.slots.push(b);
    }

    // Generic data-act buttons
    document.addEventListener('click', function (e) {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      self.app.audioClick();
      self.handleAct(t.getAttribute('data-act'));
    });

    $('dialog').addEventListener('click', function () { self.advanceDialog(); });
    $('lantern-chip').tabIndex = -1;
    $('lantern-chip').addEventListener('mousedown', function (e) { e.preventDefault(); });
    $('lantern-chip').addEventListener('click', function () {
      if (!self.blocking()) self.toast(self.lanternHint());
    });
    $('btn-new').addEventListener('click', function () {
      self.app.unlockAudio();
      if (self.app.hasSave()) self.openModal('confirm-new');
      else self.app.newGame();
    });
    $('btn-continue').addEventListener('click', function () { self.app.unlockAudio(); self.app.continueGame(); });
    $('btn-howto').addEventListener('click', function () { self.app.unlockAudio(); self.openModal('howto'); });
    $('btn-keep-farming').addEventListener('click', function () {
      $('ending').classList.add('hidden');
      self.toast('The valley glows a little warmer now. Keep farming as long as you like.');
    });

    document.querySelectorAll('#m-shop .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        self.shopTab = tab.getAttribute('data-tab');
        document.querySelectorAll('#m-shop .tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
        self.renderShop();
      });
    });

    // Portraits drawn with the same pixel routines as the world.
    const portrait = document.createElement('canvas');
    portrait.width = 20; portrait.height = 20;
    const pg = portrait.getContext('2d');
    pg.fillStyle = '#f6dc8a';
    pg.fillRect(0, 0, 20, 20);
    GHV.Sprites.drawCharacter(pg, 10, 30, 'mabel', 'down', 0, false);
    document.querySelector('.portrait.mabel').style.backgroundImage = 'url(' + portrait.toDataURL() + ')';
  };

  UI.prototype.makeSlot = function (i) {
    const b = el('button', 'slot');
    b.type = 'button';
    b.appendChild(el('div', 'icon'));
    b.appendChild(el('span', 'qty'));
    if (i < C.HOTBAR_SIZE) b.appendChild(el('span', 'num', String((i + 1) % 10)));
    return b;
  };

  UI.prototype.fillSlot = function (b, slot, extra) {
    const icon = b.querySelector('.icon'), qty = b.querySelector('.qty');
    const oldBar = b.querySelector('.bar');
    if (oldBar) oldBar.remove();
    if (!slot) {
      icon.style.backgroundImage = '';
      qty.textContent = '';
      b.title = '';
      b.setAttribute('aria-label', 'Empty slot');
      return;
    }
    icon.style.backgroundImage = 'url(' + GHV.Sprites.S.iconUrls[slot.id] + ')';
    qty.textContent = slot.qty > 1 ? slot.qty : '';
    b.title = ITEMS[slot.id].name;
    b.setAttribute('aria-label', ITEMS[slot.id].name + (slot.qty > 1 ? ' ×' + slot.qty : ''));
    if (slot.id === 'can' && extra) {
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = Math.round(extra.water * 100) + '%';
      bar.appendChild(fill);
      b.appendChild(bar);
    }
  };

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  UI.prototype.showHud = function (on) { $('hud').classList.toggle('hidden', !on); };

  UI.prototype.refreshClock = function () {
    const s = this.game.state;
    if (!s) return;
    const cal = this.game.calendar();
    $('hud-date').textContent = cal.season + ' ' + cal.dayOfSeason + (cal.year > 1 ? ' · Y' + cal.year : '');
    $('hud-time').textContent = U.formatTime(s.time);
    const wx = GHV.WEATHER[s.weather];
    $('hud-weather').textContent = wx.icon;
    $('hud-weather').title = wx.name;
    $('hud-time').style.color = s.time >= 24 * 60 ? 'var(--danger)' : '';
  };

  UI.prototype.refreshHud = function () {
    const g = this.game, s = g.state;
    if (!s) return;
    this.refreshClock();
    $('hud-gold').textContent = s.gold.toLocaleString();
    const e = s.energy / s.maxEnergy;
    const ef = $('energy-fill');
    ef.style.width = Math.round(e * 100) + '%';
    ef.classList.toggle('low', e < 0.25);
    $('water-fill').style.width = Math.round((s.canWater / g.canCapacity()) * 100) + '%';
    const prog = g.offeringProgress();
    $('hud-lantern').textContent = s.restored ? 'Lantern lit' : 'Lantern ' + Math.floor(prog * 100) + '%';
    $('lantern-chip').style.setProperty('--glow', String(0.15 + prog * 0.85));
    for (let i = 0; i < C.HOTBAR_SIZE; i++) {
      this.fillSlot(this.slots[i], s.inv[i], { water: s.canWater / g.canCapacity() });
      this.slots[i].classList.toggle('sel', i === s.sel);
    }
    const held = s.inv[s.sel];
    const key = held ? held.id : null;
    if (key !== this.lastHeld) {
      this.lastHeld = key;
      if (held && this.ready) this.flashName(ITEMS[held.id].name);
    }
    if (this.modal === 'inventory') this.renderInventory();
    if (this.modal === 'shop') $('shop-gold').textContent = s.gold.toLocaleString();
  };

  UI.prototype.flashName = function (text) {
    const n = $('item-name');
    n.textContent = text;
    n.classList.remove('hidden');
    clearTimeout(this.nameTimer);
    this.nameTimer = setTimeout(function () { n.classList.add('hidden'); }, 1300);
  };

  UI.prototype.setPrompt = function (text) {
    if (text === this.promptText) return;
    this.promptText = text;
    const p = $('prompt');
    if (!text) { p.classList.add('hidden'); return; }
    p.innerHTML = '';
    const touch = document.body.classList.contains('touch');
    p.appendChild(el('span', 'key', touch ? 'Use' : 'Space'));
    p.appendChild(document.createTextNode(text));
    p.classList.remove('hidden');
  };

  UI.prototype.toast = function (msg, kind) {
    const box = $('toasts');
    const t = el('div', 'toast panel' + (kind === 'warn' ? ' warn' : ''), msg);
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { t.classList.add('out'); }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  };

  UI.prototype.lanternHint = function () {
    const g = this.game, s = g.state;
    if (s.restored) return 'The Great Lantern is lit. Its blessing helps your crops grow.';
    const missing = GHV.OFFERING.filter(function (r) { return (s.offering[r.item] || 0) < r.qty; })
      .map(function (r) { return (r.qty - (s.offering[r.item] || 0)) + ' ' + ITEMS[r.item].name; });
    return 'The Lantern still needs: ' + missing.join(', ') + '.';
  };

  // ---------------------------------------------------------------------------
  // Blocking state
  // ---------------------------------------------------------------------------
  UI.prototype.blocking = function () {
    return !!this.modal || !!this.dialogData || !$('title').classList.contains('hidden') ||
      !$('ending').classList.contains('hidden') || $('fade').classList.contains('on');
  };

  UI.prototype.openModal = function (name) {
    if (this.modal) this.closeModal(true);
    this.modal = name;
    $('modal-backdrop').classList.remove('hidden');
    const m = $('m-' + name);
    m.classList.remove('hidden');
    document.body.classList.add('modal-open');
    this.app.input.clear();
    const focus = m.querySelector('.btn.primary') || m.querySelector('.btn');
    if (focus && !document.body.classList.contains('touch')) focus.focus({ preventScroll: true });
  };

  UI.prototype.closeModal = function (quiet) {
    if (!this.modal) return;
    const name = this.modal;
    $('m-' + name).classList.add('hidden');
    this.modal = null;
    this.picked = null;
    $('modal-backdrop').classList.add('hidden');
    document.body.classList.remove('modal-open');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (!quiet && name === 'summary') this.app.wakeUp();
  };

  UI.prototype.handleAct = function (act) {
    const g = this.game;
    switch (act) {
      case 'close': this.closeModal(); break;
      case 'sleep-yes': this.closeModal(); this.app.goToSleep(); break;
      case 'summary-ok': this.closeModal(); break;
      case 'save':
        this.toast(this.app.save() ? 'Game saved.' : "Couldn't save — browser storage is unavailable.", 'info');
        break;
      case 'howto': this.openModal('howto'); break;
      case 'toggle-sound': this.app.setSound(!GHV.Audio.sound); this.refreshOptions(); break;
      case 'toggle-music': this.app.setMusic(!GHV.Audio.music); this.refreshOptions(); break;
      case 'quit': this.closeModal(); this.app.quitToTitle(); break;
      case 'new-yes': this.closeModal(); this.app.newGame(); break;
      case 'offer': this.doOffer(); break;
      default:
        if (act.indexOf('buy:') === 0) {
          const parts = act.split(':');
          const r = g.buy(parts[1], parseInt(parts[2], 10));
          $('shop-msg').textContent = r.msg;
          this.renderShop();
        } else if (act.indexOf('up:') === 0) {
          const r2 = g.buyUpgrade(act.slice(3));
          $('shop-msg').textContent = r2.msg;
          this.renderShop();
        } else if (act.indexOf('eat:') === 0) {
          g.eat(parseInt(act.slice(4), 10));
          this.renderInventory();
        }
    }
  };

  UI.prototype.refreshOptions = function () {
    $('opt-sound').textContent = 'Sound: ' + (GHV.Audio.sound ? 'on' : 'off');
    $('opt-music').textContent = 'Music: ' + (GHV.Audio.music ? 'on' : 'off');
  };

  UI.prototype.openPause = function () {
    this.refreshOptions();
    this.openModal('pause');
  };

  UI.prototype.openSleep = function () {
    const t = this.game.state.time;
    $('sleep-text').textContent = t < 17 * 60
      ? "It's only " + U.formatTime(t) + '. Sleep now and wake at 6 AM?'
      : 'Call it a day and wake up at 6 AM.';
    this.openModal('sleep');
  };

  // ---------------------------------------------------------------------------
  // Dialogue
  // ---------------------------------------------------------------------------
  UI.prototype.openDialog = function (data) {
    this.dialogData = data;
    this.dialogLine = 0;
    this.dialogChars = 0;
    $('dialog-name').textContent = data.name || '';
    $('dialog').classList.remove('hidden');
    this.app.input.clear();
    this.renderDialog();
    GHV.Audio.play('open');
  };

  UI.prototype.renderDialog = function () {
    const line = this.dialogData.lines[this.dialogLine] || '';
    $('dialog-text').textContent = line.slice(0, Math.floor(this.dialogChars));
    $('dialog-next').style.visibility = this.dialogChars >= line.length ? 'visible' : 'hidden';
  };

  UI.prototype.updateDialog = function (dt) {
    if (!this.dialogData) return;
    const line = this.dialogData.lines[this.dialogLine] || '';
    if (this.dialogChars >= line.length) return;
    const before = Math.floor(this.dialogChars);
    this.dialogChars = Math.min(line.length, this.dialogChars + dt * 55);
    if (this.dialogData.npc && Math.floor(this.dialogChars / 4) !== Math.floor(before / 4)) GHV.Audio.play('talk');
    this.renderDialog();
  };

  UI.prototype.advanceDialog = function () {
    if (!this.dialogData) return;
    const line = this.dialogData.lines[this.dialogLine] || '';
    if (this.dialogChars < line.length) {
      this.dialogChars = line.length;
      this.renderDialog();
      return;
    }
    this.dialogLine++;
    this.dialogChars = 0;
    if (this.dialogLine >= this.dialogData.lines.length) this.closeDialog();
    else this.renderDialog();
  };

  UI.prototype.closeDialog = function () {
    const done = this.dialogData && this.dialogData.onClose;
    this.dialogData = null;
    $('dialog').classList.add('hidden');
    if (done) done();
  };

  // ---------------------------------------------------------------------------
  // Shop
  // ---------------------------------------------------------------------------
  UI.prototype.openShop = function () {
    const s = this.game.state;
    let greet = MABEL_GREETINGS[Math.floor(Math.random() * MABEL_GREETINGS.length)];
    if (s.restored && Math.random() < 0.5) greet = 'Did you see the lantern? I cried into the bread dough. Twice.';
    else if (s.time >= 18 * 60) greet = 'Last orders, love — I shut at eight!';
    $('shop-greet').textContent = greet;
    $('shop-msg').textContent = '';
    this.openModal('shop');
    this.renderShop();
    GHV.Audio.play('open');
  };

  UI.prototype.renderShop = function () {
    const g = this.game, s = g.state, list = $('shop-list');
    $('shop-gold').textContent = s.gold.toLocaleString();
    list.innerHTML = '';
    const iconUrls = GHV.Sprites.S.iconUrls;
    const row = function (iconId, name, desc, price, buttons, owned) {
      const r = el('div', 'shop-row' + (owned ? ' owned' : ''));
      const ic = el('div', 'icon');
      ic.style.backgroundImage = 'url(' + iconUrls[iconId] + ')';
      r.appendChild(ic);
      const mid = el('div');
      mid.appendChild(el('div', 'name', name));
      mid.appendChild(el('div', 'desc', desc));
      r.appendChild(mid);
      const buy = el('div', 'buy');
      buy.appendChild(el('span', 'price', price));
      for (const b of buttons) buy.appendChild(b);
      r.appendChild(buy);
      list.appendChild(r);
    };
    const button = function (label, act, disabled) {
      const b = el('button', 'btn', label);
      b.type = 'button';
      b.setAttribute('data-act', act);
      b.disabled = !!disabled;
      return b;
    };
    if (this.shopTab === 'goods') {
      for (const id of GHV.SHOP_STOCK) {
        const it = ITEMS[id];
        const have = Inv.count(s.inv, id);
        row(id, it.name + (have ? '  (have ' + have + ')' : ''), it.desc, it.price + 'g', [
          button('Buy', 'buy:' + id + ':1', s.gold < it.price),
          button('×5', 'buy:' + id + ':5', s.gold < it.price * 5),
        ]);
      }
    } else {
      for (const up of GHV.UPGRADES) {
        const owned = !!s.upgrades[up.id];
        const avail = g.upgradeAvailable(up);
        const icon = up.canLevel !== undefined ? 'can' : 'honey_bun';
        const desc = up.desc + (!owned && !avail && up.requires ? ' (needs the Copper can first)' : '');
        row(icon, up.name, desc, owned ? 'Owned' : up.price.toLocaleString() + 'g', owned ? [] : [
          button('Buy', 'up:' + up.id, !avail || s.gold < up.price),
        ], owned);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------------
  UI.prototype.openInventory = function () {
    this.picked = null;
    this.openModal('inventory');
    this.renderInventory();
    this.picked = null;
  };

  UI.prototype.renderInventory = function () {
    const self = this, g = this.game, s = g.state;
    const grid = $('inv-grid');
    $('inv-gold').textContent = s.gold.toLocaleString();
    grid.innerHTML = '';
    for (let i = 0; i < C.INVENTORY_SIZE; i++) {
      if (i === C.HOTBAR_SIZE) grid.appendChild(el('div', 'divider'));
      const b = this.makeSlot(i);
      this.fillSlot(b, s.inv[i], { water: s.canWater / g.canCapacity() });
      if (i === s.sel) b.classList.add('sel');
      if (i === this.picked) b.classList.add('picked');
      b.addEventListener('click', function () { self.clickInvSlot(i); });
      grid.appendChild(b);
    }
    const detail = $('inv-detail');
    detail.innerHTML = '';
    const focus = this.picked !== null ? s.inv[this.picked] : s.inv[s.sel];
    const focusIdx = this.picked !== null ? this.picked : s.sel;
    if (!focus) {
      detail.appendChild(el('div', 'desc', this.picked !== null ? 'Empty slot.' : 'Select an item to see what it does.'));
      return;
    }
    const it = ITEMS[focus.id];
    const ic = el('div', 'icon');
    ic.style.cssText = 'width:40px;height:40px;flex:none;background-size:contain;background-repeat:no-repeat;image-rendering:pixelated;background-image:url(' + GHV.Sprites.S.iconUrls[focus.id] + ')';
    detail.appendChild(ic);
    const txt = el('div');
    txt.appendChild(el('div', 'name', it.name + (focus.qty > 1 ? ' ×' + focus.qty : '')));
    let desc = it.desc || '';
    if (focus.id === 'can') desc += ' Holds ' + g.canCapacity() + '; ' + s.canWater + ' left.';
    const price = Rules.sellPrice(focus.id);
    if (it.kind !== 'tool' && price) desc += ' Sells for ' + price + 'g.';
    txt.appendChild(el('div', 'desc', desc));
    detail.appendChild(txt);
    if (it.energy) {
      const b = el('button', 'btn', 'Eat (+' + it.energy + ')');
      b.type = 'button';
      b.setAttribute('data-act', 'eat:' + focusIdx);
      detail.appendChild(b);
    }
  };

  UI.prototype.clickInvSlot = function (i) {
    const g = this.game, s = g.state;
    GHV.Audio.play('click');
    if (this.picked === null) {
      if (!s.inv[i]) { if (i < C.HOTBAR_SIZE) g.selectSlot(i); this.renderInventory(); return; }
      this.picked = i;
    } else if (this.picked === i) {
      if (i < C.HOTBAR_SIZE) g.selectSlot(i);
      this.picked = null;
    } else {
      Inv.moveSlot(s.inv, this.picked, i);
      this.picked = null;
      g.changed();
    }
    this.renderInventory();
  };

  // ---------------------------------------------------------------------------
  // Lantern offering
  // ---------------------------------------------------------------------------
  UI.prototype.openOffering = function () {
    $('offering-msg').textContent = '';
    this.openModal('offering');
    this.renderOffering();
    GHV.Audio.play('open');
  };

  UI.prototype.renderOffering = function () {
    const g = this.game, s = g.state;
    const prog = g.offeringProgress();
    let lore;
    if (s.restored) lore = 'The Great Lantern blazes gold. Its warmth reaches every field in the valley — your crops sometimes grow an extra day overnight.';
    else if (prog === 0) lore = 'A great iron lantern on a carved stone pedestal. Its flame is a tired ember. Words are carved into the stone: "Feed me the valley\'s harvest and I will hold the light."';
    else if (prog < 0.5) lore = 'The flame stirs whenever you come close. The carved list waits.';
    else lore = 'The glass has started to glow amber. Folk stop to look on their way past.';
    $('offering-lore').textContent = lore;
    const list = $('offering-list');
    list.innerHTML = '';
    let canOffer = false;
    for (const req of GHV.OFFERING) {
      const have = Math.min(req.qty, s.offering[req.item] || 0);
      const inBag = Inv.count(s.inv, req.item);
      if (have < req.qty && inBag > 0) canOffer = true;
      const r = el('div', 'offer-row' + (have >= req.qty ? ' done' : ''));
      const ic = el('div', 'icon');
      ic.style.backgroundImage = 'url(' + GHV.Sprites.S.iconUrls[req.item] + ')';
      r.appendChild(ic);
      const mid = el('div');
      mid.appendChild(el('div', 'label', ITEMS[req.item].name + (have >= req.qty ? ' ✓' : '')));
      mid.appendChild(el('div', 'count', have + ' / ' + req.qty + (inBag && have < req.qty ? '   (' + inBag + ' in bag)' : '')));
      const mini = el('div', 'mini');
      const fill = el('i');
      fill.style.width = Math.round((have / req.qty) * 100) + '%';
      mini.appendChild(fill);
      mid.appendChild(mini);
      r.appendChild(mid);
      list.appendChild(r);
    }
    $('offering-bar').style.width = Math.round(prog * 100) + '%';
    $('btn-offer').disabled = s.restored || !canOffer;
    $('btn-offer').textContent = s.restored ? 'The lantern is lit' : 'Offer from my bag';
  };

  UI.prototype.doOffer = function () {
    const n = this.game.offerAll();
    if (this.game.state.restored) {
      this.closeModal();
      return;
    }
    $('offering-msg').textContent = n > 0
      ? 'You offer ' + n + ' item' + (n === 1 ? '' : 's') + '. The flame leans toward you, brighter.'
      : "You don't have anything it still needs.";
    this.renderOffering();
  };

  // ---------------------------------------------------------------------------
  // End of day
  // ---------------------------------------------------------------------------
  UI.prototype.showSummary = function (sum) {
    $('summary-title').textContent = sum.passedOut ? 'You passed out…' : 'Day ' + sum.day + ' is done';
    $('summary-note').textContent = sum.passedOut
      ? 'Pip found you asleep in the grass and fetched help. The doctor charged ' + sum.lost + 'g.'
      : sum.items.length ? 'Mabel collected your shipment overnight.' : 'Nothing was shipped today.';
    const box = $('summary-items');
    box.innerHTML = '';
    for (const it of sum.items) {
      const r = el('div', 'summary-row');
      const ic = el('div', 'icon');
      ic.style.backgroundImage = 'url(' + GHV.Sprites.S.iconUrls[it.id] + ')';
      r.appendChild(ic);
      r.appendChild(el('div', '', ITEMS[it.id].name + ' ×' + it.qty));
      r.appendChild(el('div', '', it.value + 'g'));
      box.appendChild(r);
    }
    $('summary-total').textContent = sum.earned.toLocaleString() + 'g';
    const wx = GHV.WEATHER[sum.weather];
    $('summary-forecast').textContent = 'Today: ' + wx.icon + ' ' + wx.name + (sum.weather === 'sunshower' ? ' — your crops are watered.' : '.');
    this.openModal('summary');
  };

  UI.prototype.setFade = function (on) { $('fade').classList.toggle('on', on); };

  UI.prototype.showEnding = function () {
    const s = this.game.state;
    $('ending-text').textContent = 'On the evening of day ' + s.stats.restoredOnDay + ', the Great Lantern flared gold and the whole valley turned to look. Old Fen says Juniper would be proud. Mabel says she is.';
    const stats = $('ending-stats');
    stats.innerHTML = '';
    const add = function (label, value) {
      const d = el('div');
      d.appendChild(el('b', '', value));
      d.appendChild(document.createTextNode(label));
      stats.appendChild(d);
    };
    add('days', String(s.stats.restoredOnDay));
    add('gold earned', s.stats.earned.toLocaleString() + 'g');
    add('crops harvested', String(s.stats.harvested));
    add('items shipped', String(s.stats.shipped));
    $('ending').classList.remove('hidden');
    $('btn-keep-farming').focus({ preventScroll: true });
  };

  GHV.UI = UI;
})(window.GHV = window.GHV || {});
