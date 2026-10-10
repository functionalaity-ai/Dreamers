// Weapon state shared by the player and bots: chamber + magazine, reserve, fire timing,
// fire modes, reloads (tactical keeps the chambered round) and the recoil pattern index.
import { weaponStats } from '../config.js';

export class WeaponState {
  constructor(id, att) {
    this.id = id;
    this.stats = weaponStats(id, att);
    const s = this.stats;
    this.mag = s.mag;              // rounds in the magazine (or tube)
    this.chambered = true;
    this.reserve = s.reserve;
    this.mode = 0;
    this.cooldown = 0;
    this.shotIndex = 0;            // position in the recoil pattern
    this.sinceShot = 9;
    this.needsPump = false;
    this.boltLocked = false;
  }

  get modeName() { return this.stats.modes[this.mode]; }
  get loaded() { return this.mag + (this.chambered ? 1 : 0); }
  get pump() { return this.stats.modes[0] === 'pump'; }

  toggleMode() {
    if (this.stats.modes.length < 2) return false;
    this.mode = (this.mode + 1) % this.stats.modes.length;
    return true;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceShot += dt;
    if (this.sinceShot > 0.35) this.shotIndex = Math.max(0, this.shotIndex - dt * 30);
  }

  canFire() { return this.cooldown <= 0 && this.chambered && !this.needsPump; }

  // Consume the chambered round. Returns the recoil kick [yaw, pitch].
  fire() {
    const s = this.stats;
    this.chambered = false;
    this.cooldown = 60 / s.rpm;
    this.sinceShot = 0;
    const pat = s.recoil.pattern;
    const idx = Math.floor(this.shotIndex);
    const kick = pat[idx < pat.length ? idx : pat.length - 8 + (idx % 8)];
    this.shotIndex += 1;
    if (this.pump) {
      this.needsPump = true;
    } else if (this.mag > 0) {
      this.mag--;
      this.chambered = true;
    } else {
      this.boltLocked = true;
    }
    return kick;
  }

  // Shotgun: rack the slide. Returns true if a shell was ejected.
  rack() {
    const ejected = !this.chambered;
    this.needsPump = false;
    if (this.mag > 0) { this.mag--; this.chambered = true; }
    return ejected;
  }

  canReload() {
    if (this.reserve <= 0) return false;
    if (this.pump) return this.mag < this.stats.mag;
    return this.mag < this.stats.mag || !this.chambered;
  }

  reloadTime() {
    const r = this.stats.reload;
    if (this.pump) return r.start + r.shell;
    return this.chambered ? r.tactical : r.empty;
  }

  // Swap magazines (rifle/pistol). The old magazine's rounds go back into reserve.
  swapMag() {
    const total = this.reserve + this.mag;
    const take = Math.min(this.stats.mag, total);
    this.reserve = total - take;
    this.mag = take;
  }

  // After an empty reload, close the bolt on a fresh round.
  closeBolt() {
    this.boltLocked = false;
    if (!this.chambered && this.mag > 0) { this.mag--; this.chambered = true; }
  }

  // Shotgun: load one shell into the tube.
  loadShell() {
    if (this.reserve <= 0 || this.mag >= this.stats.mag) return false;
    this.reserve--;
    this.mag++;
    return true;
  }

  // Rough mag-check text, as you'd judge it by feel.
  magCheck() {
    const f = this.mag / this.stats.mag;
    if (this.mag === 0) return this.chambered ? 'One in the chamber' : 'Empty';
    if (f > 0.9) return 'Full';
    if (f > 0.65) return 'Mostly full';
    if (f > 0.35) return 'About half';
    if (f > 0.12) return 'Low';
    return 'Nearly empty';
  }
}
