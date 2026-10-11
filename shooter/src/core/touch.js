// Touch controls for phones and tablets: a floating thumbstick on the left, swipe-to-look on
// the right and a cluster of on-screen buttons. Everything is written into the same Input
// object the keyboard and mouse use, so the game reads one set of controls.
const LOOK = 1.7;          // touch pixels to mouse-pixel equivalents when looking
const STICK_R = 56;        // thumbstick travel (CSS px)
const DEAD = 0.12;         // dead zone, as a fraction of the travel
const SPRINT_AT = 0.9;     // push this far, roughly forwards, to sprint
const HOLD = 0.42;         // seconds before a press counts as a hold

export function isTouchDevice() {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

const svg = (body) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
const ICONS = {
  fire: svg('<path d="M9.5 21h5M9.5 18h5V9.5c0-3-1-5.5-2.5-7.5-1.5 2-2.5 4.5-2.5 7.5z"/>'),
  ads: svg('<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>'),
  jump: svg('<path d="M5 16l7-7 7 7"/>'),
  crouch: svg('<path d="M5 8l7 7 7-7M5 20h14"/>'),
  reload: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v4.5H15"/>'),
  frag: svg('<circle cx="11" cy="14.5" r="5.5"/><path d="M9 9.2V6.5h4.5l2.5 3M13.5 6.5l3.5-2.5"/>'),
  swap: svg('<path d="M4 8.5h14l-3.5-3.5M20 15.5H6l3.5 3.5"/>'),
  board: svg('<path d="M5 7h14M5 12h14M5 17h14"/>'),
  pause: svg('<path d="M9 6v12M15 6v12"/>'),
  interact: svg('<path d="M4 9.5l8-4.5 8 4.5v8L12 22l-8-4.5zM4 9.5l8 4.5 8-4.5M12 14v8"/>'),
  heal: svg('<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z"/>'),
  map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>'),
};
// [action, label for screen readers, icon or text]
const BUTTONS = [
  ['fire', 'Fire', ICONS.fire], ['fire2', 'Fire', ICONS.fire], ['ads', 'Aim down sights', ICONS.ads],
  ['jump', 'Jump', ICONS.jump], ['crouch', 'Crouch (hold for prone)', ICONS.crouch], ['reload', 'Reload (hold for mag check)', ICONS.reload],
  ['frag', 'Throw frag', ICONS.frag], ['swap', 'Switch weapon', ICONS.swap], ['mode', 'Fire mode', '<span>MODE</span>'],
  ['board', 'Scoreboard', ICONS.board], ['pause', 'Pause', ICONS.pause],
  // Battle Royale only (shown by css/br.css): loot, heal (hold: armor plate), map
  ['interact', 'Interact, loot', ICONS.interact], ['heal', 'Heal (hold for an armor plate)', ICONS.heal], ['map', 'Map', ICONS.map],
];

export class TouchControls {
  constructor(input, opts = {}) {
    this.input = input;
    this.onPause = opts.onPause || (() => {});
    this.proneKey = 'KeyZ';     // Battle Royale moves prone off Z (its armor-plate key)
    const root = document.createElement('div');
    root.id = 'touch';
    root.hidden = true;
    root.innerHTML = '<div class="stick"><i class="base"></i><i class="knob"></i></div>' +
      BUTTONS.map(([act, label, inner]) => '<div class="tb ' + act + '" data-act="' + act + '" role="button" aria-label="' + label + '">' + inner + '</div>').join('');
    document.body.appendChild(root);
    this.root = root;
    this.base = root.querySelector('.base');
    this.knob = root.querySelector('.knob');
    this.btn = {};
    root.querySelectorAll('[data-act]').forEach((el) => { this.btn[el.dataset.act] = el; });
    this.touches = new Map();   // touch identifier -> what it is doing
    this.clear();
    const opt = { passive: false };
    root.addEventListener('touchstart', (e) => this.start(e), opt);
    root.addEventListener('touchmove', (e) => this.move(e), opt);
    root.addEventListener('touchend', (e) => this.end(e), opt);
    root.addEventListener('touchcancel', (e) => this.end(e), opt);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.placeStick());
  }

  clear() {
    this.touches.clear();
    this.stick = null;          // { x, y } in -1..1, y forward
    this.sprint = false;
    this.fires = 0;
    this.ads = false;
    this.board = false;
    this.ownShift = false;
    for (const el of Object.values(this.btn)) el.classList.remove('down', 'on');
    this.root.classList.remove('board-on', 'sprinting');
    this.placeStick();
  }

  setVisible(v) {
    if (this.root.hidden === !v) return;
    this.root.hidden = !v;
    this.clear();
    if (!v) {
      const inp = this.input;
      inp.stick = null;
      inp.mouse.left = inp.mouse.right = false;
      if (this.ownShift) inp.keys.delete('ShiftLeft');
      inp.keys.delete('Tab');
    }
  }

  // The idle thumbstick rests bottom left; while held it sits where the thumb came down.
  placeStick(x, y) {
    const idle = x === undefined;
    if (idle) { x = 118; y = window.innerHeight - 112; }
    this.home = { x, y };
    this.base.style.transform = 'translate(' + (x - STICK_R) + 'px,' + (y - STICK_R) + 'px)';
    this.knob.style.transform = 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%)';
    this.root.classList.toggle('steering', !idle);
  }

  start(e) {
    if (e.cancelable) e.preventDefault(); // touch-action: none already stops scrolling and zoom
    if (!this.input.enabled) return;
    for (const t of e.changedTouches) {
      const el = t.target && t.target.closest ? t.target.closest('[data-act]') : null;
      if (el) { this.press(el.dataset.act, t); continue; }
      const roles = [...this.touches.values()].map((r) => r.kind);
      if (t.clientX < window.innerWidth * 0.45 && roles.indexOf('stick') === -1) {
        this.touches.set(t.identifier, { kind: 'stick' });
        this.placeStick(t.clientX, t.clientY);
        this.steer(t.clientX, t.clientY);
      } else if (roles.indexOf('look') === -1) {
        this.touches.set(t.identifier, { kind: 'look', x: t.clientX, y: t.clientY });
      }
    }
  }

  move(e) {
    if (e.cancelable) e.preventDefault();
    for (const t of e.changedTouches) {
      const r = this.touches.get(t.identifier);
      if (!r) continue;
      if (r.kind === 'stick') this.steer(t.clientX, t.clientY);
      else if (r.kind === 'look' || r.act === 'fire') {
        // the big fire button doubles as a look pad, so you can track a target while shooting
        if (r.x !== undefined) {
          this.input.mouse.dx += (t.clientX - r.x) * LOOK;
          this.input.mouse.dy += (t.clientY - r.y) * LOOK;
        }
        r.x = t.clientX; r.y = t.clientY;
      }
    }
  }

  end(e) {
    if (e.cancelable) e.preventDefault();
    for (const t of e.changedTouches) {
      const r = this.touches.get(t.identifier);
      if (!r) continue;
      this.touches.delete(t.identifier);
      if (r.kind === 'stick') { this.stick = null; this.setSprint(false); this.placeStick(); }
      if (r.kind === 'btn') this.release(r, t);
    }
  }

  steer(x, y) {
    let dx = (x - this.home.x) / STICK_R, dy = (this.home.y - y) / STICK_R;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const l = Math.min(1, len);
    this.knob.style.transform = 'translate(' + (this.home.x + dx * STICK_R) + 'px,' + (this.home.y - dy * STICK_R) + 'px) translate(-50%,-50%)';
    if (l < DEAD) { this.stick = { x: 0, y: 0 }; this.setSprint(false); return; }
    const k = (l - DEAD) / (1 - DEAD) / l;
    this.stick = { x: dx * k, y: dy * k };
    // sprint when pushed to the rim within about 40 degrees of straight ahead
    this.setSprint(l >= SPRINT_AT && dy / l > 0.76);
  }

  setSprint(v) {
    if (v === this.sprint) return;
    this.sprint = v;
    this.root.classList.toggle('sprinting', v);
    if (v) {
      // a fresh Shift press each time, so pushing to the rim twice quickly gives a tactical sprint
      this.input.justPressed.add('ShiftLeft');
      this.setAds(false);
    }
  }

  setAds(v) {
    this.ads = v;
    this.btn.ads.classList.toggle('on', v);
  }

  press(act, t) {
    const inp = this.input, el = this.btn[act];
    el.classList.add('down');
    const r = { kind: 'btn', act, t0: performance.now(), held: false };
    this.touches.set(t.identifier, r);
    switch (act) {
      case 'fire': r.x = t.clientX; r.y = t.clientY; // falls through: the big button also looks
      case 'fire2': this.fires++; inp.mouse.left = true; inp.mouse.leftPressed = true; break;
      case 'ads': this.setAds(!this.ads); break;
      case 'jump': inp.justPressed.add('Space'); break;
      case 'crouch': inp.justPressed.add('KeyC'); break;
      case 'frag': inp.justPressed.add('KeyG'); break;
      case 'swap': inp.mouse.wheel += 1; this.setAds(false); break;
      case 'mode': inp.justPressed.add('KeyB'); break;
      case 'board': this.board = !this.board; el.classList.toggle('on', this.board); this.root.classList.toggle('board-on', this.board); break;
      case 'pause': this.onPause(); break;
      case 'interact': inp.justPressed.add('KeyE'); break;
      case 'map': inp.justPressed.add('KeyM'); break;
      default: break;
    }
  }

  release(r) {
    const inp = this.input;
    const el = this.btn[r.act];
    if (![...this.touches.values()].some((o) => o.act === r.act)) el.classList.remove('down');
    if (r.act === 'fire' || r.act === 'fire2') {
      this.fires = Math.max(0, this.fires - 1);
      if (!this.fires) inp.mouse.left = false;
    }
    // reload fires on release, so holding it can ask for a mag check instead
    if (r.act === 'reload' && !r.held) inp.justPressed.add('KeyR');
    if (r.act === 'heal' && !r.held) inp.justPressed.add('KeyH');
  }

  // Once per frame before the game reads input: re-assert held states (the game may reset
  // its input on pause and resume) and turn long presses into their hold actions.
  update(alive) {
    const inp = this.input;
    if (this.root.hidden || !inp.enabled) return;
    if (!alive && this.ads) this.setAds(false);
    inp.stick = this.stick;
    inp.mouse.right = this.ads;
    if (this.fires) inp.mouse.left = true;
    // Shooting or aiming from a full-forward stick walks instead of fighting the sprint.
    if (this.sprint && !this.fires && !this.ads) { inp.keys.add('ShiftLeft'); this.ownShift = true; }
    else if (this.ownShift) { inp.keys.delete('ShiftLeft'); this.ownShift = false; }
    if (this.board) inp.keys.add('Tab'); else inp.keys.delete('Tab');
    const now = performance.now();
    for (const r of this.touches.values()) {
      if (r.kind !== 'btn' || r.held || now - r.t0 < HOLD * 1000) continue;
      r.held = true;
      if (r.act === 'crouch') inp.justPressed.add(this.proneKey);
      if (r.act === 'heal') inp.justPressed.add('KeyZ');
      if (r.act === 'reload') inp.justPressed.add('KeyT');
    }
  }
}
