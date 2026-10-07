/* Keyboard, mouse and touch input. Movement is polled; actions are queued. */
(function (GHV) {
  'use strict';

  const MOVE_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
  };

  function Input(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.keys = {};
    this.queue = [];
    this.hover = null;          // tile under the mouse, if the mouse is in use
    this.mouseActive = false;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.touchMode = false;
    this.bind();
  }

  Input.prototype.push = function (a) { this.queue.push(a); };
  Input.prototype.drain = function () { const q = this.queue; this.queue = []; return q; };

  Input.prototype.move = function () {
    let x = 0, y = 0;
    for (const k in MOVE_KEYS) {
      if (this.keys[k]) { x += MOVE_KEYS[k][0]; y += MOVE_KEYS[k][1]; }
    }
    if (this.stick.id !== null) { x += this.stick.x; y += this.stick.y; }
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  };

  Input.prototype.clear = function () {
    this.keys = {};
    this.stick.id = null;
    this.stick.x = this.stick.y = 0;
    const knob = document.getElementById('stick-knob');
    if (knob) knob.style.transform = '';
  };

  Input.prototype.bind = function () {
    const self = this;

    // Show on-screen controls on touch-first devices, or as soon as anything is touched.
    const coarse = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (coarse) this.enableTouch();
    window.addEventListener('touchstart', function () { self.enableTouch(); }, { passive: true, capture: true });

    window.addEventListener('keydown', function (e) {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Let focused menu buttons and Tab focus navigation behave normally.
      if ((e.code === 'Space' || e.code === 'Enter') && tag === 'BUTTON') return;
      if (e.code === 'Tab' && document.body.classList.contains('modal-open')) return;
      if (MOVE_KEYS[e.code]) {
        self.keys[e.code] = true;
        self.mouseActive = false;
        e.preventDefault();
      }
      if (e.repeat) return;
      switch (e.code) {
        case 'Space': case 'Enter': case 'KeyJ': case 'KeyX': self.push({ type: 'act' }); e.preventDefault(); break;
        case 'KeyF': case 'KeyK': self.push({ type: 'eat' }); break;
        case 'KeyI': case 'Tab': case 'KeyB': self.push({ type: 'inventory' }); e.preventDefault(); break;
        case 'Escape': case 'KeyP': self.push({ type: 'pause' }); e.preventDefault(); break;
        case 'KeyQ': self.push({ type: 'cycle', dir: -1 }); break;
        case 'KeyE': self.push({ type: 'cycle', dir: 1 }); break;
        case 'KeyM': self.push({ type: 'music' }); break;
        default:
          if (/^Digit[0-9]$/.test(e.code)) {
            const n = parseInt(e.code.slice(5), 10);
            self.push({ type: 'slot', n: n === 0 ? 9 : n - 1 });
          }
      }
    });
    window.addEventListener('keyup', function (e) { self.keys[e.code] = false; });
    window.addEventListener('blur', function () { self.clear(); });

    // Mouse: hover picks the target tile; left click acts, right click eats.
    const c = this.canvas;
    c.addEventListener('mousemove', function (e) {
      self.mouseActive = true;
      self.hover = self.renderer.screenToTile(e.clientX, e.clientY);
    });
    c.addEventListener('mouseleave', function () { self.hover = null; });
    c.addEventListener('mousedown', function (e) {
      self.mouseActive = true;
      self.hover = self.renderer.screenToTile(e.clientX, e.clientY);
      if (e.button === 0) self.push({ type: 'act', tile: self.hover });
      if (e.button === 2) self.push({ type: 'eat' });
    });
    c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    c.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.push({ type: 'cycle', dir: e.deltaY > 0 ? 1 : -1 });
    }, { passive: false });

    // Touch: tap the world to act on a nearby tile.
    c.addEventListener('touchstart', function (e) {
      self.enableTouch();
      for (const t of e.changedTouches) {
        self.push({ type: 'act', tile: self.renderer.screenToTile(t.clientX, t.clientY), touch: true });
      }
      e.preventDefault();
    }, { passive: false });

    // Virtual joystick
    const zone = document.getElementById('stick-zone');
    const knob = document.getElementById('stick-knob');
    const base = document.getElementById('stick-base');
    if (zone) {
      const R = 46;
      zone.addEventListener('touchstart', function (e) {
        self.enableTouch();
        const t = e.changedTouches[0];
        self.stick.id = t.identifier;
        const rect = base.getBoundingClientRect();
        self.stick.ox = rect.left + rect.width / 2;
        self.stick.oy = rect.top + rect.height / 2;
        updateStick(t);
        e.preventDefault();
      }, { passive: false });
      const updateStick = function (t) {
        let dx = t.clientX - self.stick.ox, dy = t.clientY - self.stick.oy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
        self.stick.x = dx / R;
        self.stick.y = dy / R;
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      };
      zone.addEventListener('touchmove', function (e) {
        for (const t of e.changedTouches) if (t.identifier === self.stick.id) updateStick(t);
        e.preventDefault();
      }, { passive: false });
      const end = function (e) {
        for (const t of e.changedTouches) {
          if (t.identifier === self.stick.id) {
            self.stick.id = null;
            self.stick.x = self.stick.y = 0;
            knob.style.transform = '';
          }
        }
      };
      zone.addEventListener('touchend', end);
      zone.addEventListener('touchcancel', end);
    }

    const btn = function (id, action) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', function (e) { self.enableTouch(); self.push(action); e.preventDefault(); }, { passive: false });
      el.addEventListener('click', function () { self.push(action); });
    };
    btn('btn-act', { type: 'act' });
    btn('btn-eat', { type: 'eat' });
    btn('btn-bag', { type: 'inventory' });
    btn('btn-menu', { type: 'pause' });
  };

  Input.prototype.enableTouch = function () {
    if (this.touchMode) return;
    this.touchMode = true;
    this.mouseActive = false;
    document.body.classList.add('touch');
  };

  GHV.Input = Input;
})(window.GHV = window.GHV || {});
