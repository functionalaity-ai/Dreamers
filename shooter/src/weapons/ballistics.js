// Projectile ballistics: muzzle velocity, gravity drop, travel time, material penetration,
// ricochets, hit zones, damage falloff and near-miss cracks.
import * as THREE from 'three';
import { MATERIALS, HITZONES } from '../config.js';

const G = 9.81;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
const _cu = new THREE.Vector3(), _cw = new THREE.Vector3();

// Segment (a + t*d, t in [0, len]) against a sphere. Returns t or -1.
export function segSphere(a, d, len, c, r) {
  const ox = a.x - c.x, oy = a.y - c.y, oz = a.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t >= 0 && t <= len ? t : -1;
}

// Segment against a capsule p0-p1 of radius r (approximate: closest-approach test).
export function segCapsule(a, d, len, p0, p1, r) {
  const u = _cu.subVectors(p1, p0);
  const w = _cw.subVectors(a, p0);
  const uu = u.dot(u), ud = u.dot(d), uw = u.dot(w), dw = d.dot(w);
  const den = uu - ud * ud;
  let t = den > 1e-8 ? (ud * uw - uu * dw) / den : 0;
  t = Math.max(0, Math.min(len, t));
  let s = uu > 1e-8 ? (uw + ud * t) / uu : 0;
  s = Math.max(0, Math.min(1, s));
  // Re-solve t for the clamped s
  const qx = p0.x + u.x * s, qy = p0.y + u.y * s, qz = p0.z + u.z * s;
  t = Math.max(0, Math.min(len, (qx - a.x) * d.x + (qy - a.y) * d.y + (qz - a.z) * d.z));
  const dx = a.x + d.x * t - qx, dy = a.y + d.y * t - qy, dz = a.z + d.z * t - qz;
  if (dx * dx + dy * dy + dz * dz > r * r) return -1;
  // Back off to the entry point
  const back = Math.sqrt(Math.max(0, r * r - (dx * dx + dy * dy + dz * dz)));
  return Math.max(0, t - back);
}

export class Ballistics {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  // stats: resolved weapon stats; owner: character. dir must be normalised.
  fire(origin, dir, stats, owner, opts = {}) {
    const pellets = stats.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const d = dir.clone();
      if (pellets > 1) {
        const sp = (stats.pelletSpread || 3) * Math.PI / 180;
        const r = Math.sqrt(Math.random()) * sp, a = Math.random() * Math.PI * 2;
        jitter(d, Math.cos(a) * r, Math.sin(a) * r);
      }
      this.list.push({
        p: origin.clone(), v: d.multiplyScalar(stats.velocity), power: stats.power, power0: stats.power,
        dist: 0, owner, stats, life: 0, cracked: false,
        tracer: opts.tracer && i === 0 ? { from: (opts.muzzle || origin).clone() } : null,
        zero: opts.zero || 0,
      });
    }
  }

  update(dt) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.life += dt;
      let remaining = dt;
      let alive = true;
      let steps = 0;
      while (alive && remaining > 1e-6 && steps++ < 4) {
        const step = remaining;
        // Gravity drop
        _a.copy(b.p);
        b.v.y -= G * step * (1 - b.zero);
        _b.copy(b.p).addScaledVector(b.v, step);
        _d.subVectors(_b, _a);
        const len = _d.length();
        if (len < 1e-6) break;
        _d.multiplyScalar(1 / len);
        const res = this.trace(b, _a, _d, len);
        remaining = 0;
        if (res === 'stop') alive = false;
        else if (res && res.redirect) {
          b.p.copy(res.point);
          b.v.copy(res.dir).multiplyScalar(b.v.length() * 0.6);
          remaining = step * (1 - res.t / len);
        } else {
          b.p.copy(_b);
          b.dist += len;
        }
      }
      if (b.tracer && b.life > 0.012) {
        g.effects.tracer(b.tracer.from, b.p);
        b.tracer = null;
      }
      if (!alive || b.life > 2.2 || b.power <= 0.02 || Math.abs(b.p.x) > 70 || Math.abs(b.p.z) > 55 || b.p.y < -1 || b.p.y > 80) {
        this.list.splice(i, 1);
      }
    }
  }

  // Walks one segment: characters and world boxes in order of distance.
  trace(b, a, d, len) {
    const g = this.game;
    const events = [];
    for (const c of g.characters) {
      if (!c.alive || c === b.owner || c.team === b.owner.team) continue;
      const hit = c.hitTest(a, d, len);
      if (hit) events.push({ t: hit.t, char: c, zone: hit.zone });
    }
    const boxes = g.physics.pierce(a, d, len);
    for (const h of boxes) events.push({ t: h.tIn, box: h });
    events.sort((x, y) => x.t - y.t);
    // Near-miss crack for the player
    if (!b.cracked && b.owner !== g.player && g.player.alive && b.v.length() > 343) {
      const eye = g.player.eye;
      const w = _p.subVectors(eye, a);
      const t = Math.max(0, Math.min(len, w.dot(d)));
      const cx = a.x + d.x * t - eye.x, cy = a.y + d.y * t - eye.y, cz = a.z + d.z * t - eye.z;
      const miss = cx * cx + cy * cy + cz * cz;
      if (miss < 2.2 * 2.2 && miss > 0.15 * 0.15) {
        b.cracked = true;
        g.audio.crack(new THREE.Vector3(a.x + d.x * t, a.y + d.y * t, a.z + d.z * t));
        g.onNearMiss && g.onNearMiss(b);
      }
    }
    for (const e of events) {
      const point = new THREE.Vector3().copy(a).addScaledVector(d, e.t);
      if (e.char) {
        const dist = b.dist + e.t;
        const s = b.stats;
        const k = Math.max(0, Math.min(1, (dist - s.falloff[0]) / (s.falloff[1] - s.falloff[0])));
        const base = s.damage[0] + (s.damage[1] - s.damage[0]) * k;
        const dmg = base * HITZONES[e.zone] * (b.power / b.power0);
        g.onHit(e.char, dmg, { zone: e.zone, point, dir: d.clone(), attacker: b.owner, weapon: s, dist });
        return 'stop';
      }
      const h = e.box;
      const mat = MATERIALS[h.mat] || MATERIALS.concrete;
      const thick = Math.max(0.01, h.tOut - h.tIn);
      const cosI = Math.abs(d.dot(h.normal));
      g.onImpact(point, h.normal, d, h.mat);
      // Ricochet off hard surfaces at grazing angles
      if (mat.ricochet && cosI < 0.2 && Math.random() < 0.65) {
        const r = d.clone().addScaledVector(h.normal, -2 * d.dot(h.normal));
        jitter(r, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12);
        b.power *= 0.5;
        b.dist += e.t;
        return { redirect: true, point: point.addScaledVector(h.normal, 0.01), dir: r.normalize(), t: e.t };
      }
      const loss = mat.resist * thick / Math.max(0.35, cosI);
      if (b.power - loss > 0.04) {
        b.power -= loss;
        // Exit hole on the far side
        const exit = new THREE.Vector3().copy(a).addScaledVector(d, Math.min(len, h.tOut));
        if (h.box && thick < 0.6) g.effects.hole(exit, h.normal.clone().negate(), 0.07);
        continue;
      }
      return 'stop';
    }
    return null;
  }
}

// Rotate a direction by small angles around two perpendicular axes.
export function jitter(d, ax, ay) {
  const up = Math.abs(d.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const r = new THREE.Vector3().crossVectors(d, up).normalize();
  const u = new THREE.Vector3().crossVectors(r, d).normalize();
  d.addScaledVector(r, Math.tan(ax)).addScaledVector(u, Math.tan(ay)).normalize();
  return d;
}
