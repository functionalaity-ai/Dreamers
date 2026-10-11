// Battle Royale zone: a shrinking safe circle. Six phases of wait-then-shrink over about twelve
// minutes; the next circle is announced at the start of each wait; standing outside hurts more each
// phase. ZoneLogic is pure (no rendering) so it can be checked in node; Zone adds the wall.
import * as THREE from 'three';

// wait / shrink in seconds, the circle's radius as a fraction of the first one, damage per second.
export const PHASES = [
  { wait: 120, shrink: 75, frac: 0.62, dps: 1 },
  { wait: 90, shrink: 60, frac: 0.4, dps: 2 },
  { wait: 75, shrink: 50, frac: 0.25, dps: 4 },
  { wait: 60, shrink: 45, frac: 0.14, dps: 6 },
  { wait: 45, shrink: 35, frac: 0.06, dps: 9 },
  { wait: 35, shrink: 30, frac: 0, dps: 14 },
];
export const ZONE_TOTAL = PHASES.reduce((s, p) => s + p.wait + p.shrink, 0);

export class ZoneLogic {
  // pickCenter(cur, r) may return a preferred centre {x, z} for the next circle (e.g. on walkable ground)
  constructor(bounds, opts = {}) {
    this.b = bounds;
    this.rnd = opts.rnd || Math.random;
    this.pickCenter = opts.pickCenter || null;
    this.phases = opts.phases || PHASES;
    this.reset();
  }

  reset() {
    const b = this.b;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    this.r0 = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 * 1.02;
    this.cur = { x: cx, z: cz, r: this.r0 };
    this.from = Object.assign({}, this.cur);
    this.phase = 0;            // index of the phase in progress
    this.stage = 'wait';       // 'wait' | 'shrink' | 'closed'
    this.t = 0;
    this.next = this.makeNext(0);
  }

  makeNext(i) {
    const r = this.r0 * this.phases[i].frac;
    const cur = this.cur, room = Math.max(0, cur.r - r);
    let c = this.pickCenter ? this.pickCenter(cur, r) : null;
    if (!c || Math.hypot(c.x - cur.x, c.z - cur.z) > room) {
      const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * room;
      c = { x: cur.x + Math.cos(a) * d, z: cur.z + Math.sin(a) * d };
    }
    // keep circles over the map
    const b = this.b, m = Math.min(r * 0.6, (b.maxX - b.minX) / 3);
    c.x = Math.max(b.minX + m, Math.min(b.maxX - m, c.x));
    c.z = Math.max(b.minZ + m, Math.min(b.maxZ - m, c.z));
    return { x: c.x, z: c.z, r };
  }

  get def() { return this.phases[Math.min(this.phase, this.phases.length - 1)]; }

  update(dt) {
    if (this.stage === 'closed') return;
    this.t += dt;
    const P = this.def;
    if (this.stage === 'wait') {
      if (this.t >= P.wait) { this.stage = 'shrink'; this.t = 0; this.from = Object.assign({}, this.cur); }
      return;
    }
    const k = Math.min(1, this.t / P.shrink);
    const f = this.from, n = this.next;
    this.cur = { x: f.x + (n.x - f.x) * k, z: f.z + (n.z - f.z) * k, r: f.r + (n.r - f.r) * k };
    if (k >= 1) {
      this.cur = Object.assign({}, n);
      this.phase++;
      this.t = 0;
      if (this.phase >= this.phases.length) { this.stage = 'closed'; this.phase = this.phases.length - 1; this.next = null; }
      else { this.stage = 'wait'; this.next = this.makeNext(this.phase); }
    }
  }

  // Damage per second outside: rises with each closed phase.
  get dps() { return this.phases[Math.min(this.phases.length - 1, this.phase + (this.stage === 'closed' ? 1 : 0))].dps * (this.stage === 'closed' ? 1.5 : 1); }

  // Seconds left in the current wait or shrink.
  get left() { return this.stage === 'closed' ? 0 : Math.max(0, (this.stage === 'wait' ? this.def.wait : this.def.shrink) - this.t); }

  dist(p) { return Math.hypot(p.x - this.cur.x, p.z - this.cur.z); }
  inside(p, margin = 0) { return this.dist(p) <= this.cur.r - margin; }
  // the circle to head for: the announced next one, or the current one at the end
  get safe() { return this.next || this.cur; }
  insideSafe(p, margin = 0) { const s = this.safe; return Math.hypot(p.x - s.x, p.z - s.z) <= s.r - margin; }
}

const WALL_VS = `
varying vec3 vW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const WALL_FS = `
uniform float uTime, uR, uRed, uAlpha;
uniform vec3 uCam;
varying vec3 vW;
varying vec2 vUv;
void main() {
  float u = vUv.x * 6.2832 * uR;                 // metres around the circle
  float y = vW.y;
  // a slow upward drift of horizontal bands, with fine vertical ribs and a bright foot
  float bands = smoothstep(0.82, 1.0, fract(y * 0.11 - uTime * 0.12)) * 0.7;
  float ribs = smoothstep(0.93, 1.0, fract(u * 0.125)) * 0.35;
  float shimmer = 0.5 + 0.5 * sin(u * 0.05 + y * 0.03 + uTime * 0.8);
  float foot = exp(-max(0.0, y) * 0.12);
  float high = exp(-max(0.0, y) * 0.0025);
  float lines = max(bands, ribs);
  vec3 blue = vec3(0.3, 0.75, 2.0), red = vec3(2.0, 0.4, 0.3);
  vec3 col = mix(blue, red, uRed) * (1.1 + 1.3 * lines + 0.5 * shimmer + 0.9 * foot);
  // fade out right in front of the camera so walking through it doesn't flash the screen
  float near = smoothstep(1.5, 9.0, distance(vW, uCam));
  float a = uAlpha * (0.42 + 0.45 * lines + 0.35 * foot) * high * near;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
}`;

export class Zone extends ZoneLogic {
  constructor(game, opts) {
    super(game.bounds, opts);
    this.game = game;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 160, 1, true).translate(0, 0.5, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: WALL_VS, fragmentShader: WALL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uR: { value: 1 }, uRed: { value: 0 }, uAlpha: { value: 0.6 }, uCam: { value: new THREE.Vector3() } },
    });
    this.wall = new THREE.Mesh(geo, this.mat);
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 5;
    this.wall.name = 'zone-wall';
    game.scene.add(this.wall);
    this.height = 460;
    this.sync();
  }

  sync() {
    const c = this.cur;
    this.wall.visible = c.r > 0.5;
    this.wall.position.set(c.x, -4, c.z);
    this.wall.scale.set(Math.max(0.5, c.r), this.height, Math.max(0.5, c.r));
    this.mat.uniforms.uR.value = Math.max(0.5, c.r);
  }

  update(dt, camera, outside) {
    super.update(dt);
    const u = this.mat.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(camera.position);
    const red = (outside ? 0.85 : 0) + (this.stage === 'shrink' ? 0.25 + 0.15 * Math.sin(u.uTime.value * 3) : 0);
    u.uRed.value += (Math.min(1, red) - u.uRed.value) * Math.min(1, dt * 3);
    this.sync();
  }
}
