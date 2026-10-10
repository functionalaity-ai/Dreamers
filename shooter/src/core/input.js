// Keyboard and mouse input with pointer lock. Per-frame "pressed" sets are cleared by endFrame().
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, wheel: 0 };
    this.locked = false;   // real pointer lock
    this.free = false;     // fallback: read raw mouse movement without a lock
    this.enabled = false;
    this.onUnlock = null;
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.indexOf('Arrow') === 0 || e.code === 'ControlLeft') e.preventDefault();
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.free) return;
      // Ignore the occasional huge spike some browsers report when locking.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { if (this.enabled) { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked && this.onUnlock) this.onUnlock();
    });
  }

  lock() {
    try {
      const r = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) { /* not available */ } });
    } catch (e) { /* not available (e.g. sandboxed frame) */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.justPressed.has(code); }
  consume(code) { this.justPressed.delete(code); }

  endFrame() {
    this.justPressed.clear();
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.mouse.leftPressed = false;
    this.mouse.wheel = 0;
  }

  reset() { this.keys.clear(); this.justPressed.clear(); this.mouse.left = this.mouse.right = false; this.endFrame(); }
}
