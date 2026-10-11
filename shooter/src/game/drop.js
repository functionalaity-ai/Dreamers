// STUB — replaced at merge. A bare-bones stand-in for the drop crew's plane and parachute module,
// written against the Drop contract: the plane flies the path, riders jump (bots at the point
// nearest their target), fall straight down at a fixed speed while drifting towards it, and touch
// down. No canopy, no third-person body: the player's camera just rides along.
import * as THREE from 'three';

const FALL = 55;        // m/s straight down
const DRIFT = 14;       // m/s sideways steering while falling
const _v = new THREE.Vector3();

export class Drop {
  constructor(game) {
    this.game = game;
    this.riders = new Map();
    this.onLand = () => {};
    this.plane = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 22), new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.6, metalness: 0.4 }));
    const wing = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 4), this.plane.material);
    this.plane.add(wing);
    this.plane.visible = false;
    game.scene.add(this.plane);
    this.flying = false;
    this.pos = new THREE.Vector3();
  }

  begin(path, riders) {
    this.path = { a: path.a.clone(), b: path.b.clone() };
    this.len = this.path.a.distanceTo(this.path.b);
    this.planeSpeed = Math.max(25, this.len / 30);   // about 30 s across, whatever the map size
    this.t = 0;
    this.flying = true;
    this.plane.visible = true;
    this.dir = this.path.b.clone().sub(this.path.a).normalize();
    this.plane.rotation.y = Math.atan2(-this.dir.x, -this.dir.z);
    this.riders.clear();
    for (const c of riders) this.riders.set(c, { state: 'plane', jumpAt: 2, target: null, v: new THREE.Vector3() });
    this.pos.copy(this.path.a);
  }

  jump(c) {
    const r = this.riders.get(c);
    if (!r || r.state !== 'plane') return;
    r.state = 'freefall';
    c.body.p.copy(this.pos).add(_v.set((Math.random() - 0.5) * 3, -3, (Math.random() - 0.5) * 3));
    c.body.v.set(0, -FALL, 0);
    if (c === this.game.player) this.game.audio.foley('jump');
  }

  // Jump where the flight line passes closest to the target.
  plan(c, target) {
    const r = this.riders.get(c);
    if (!r) return;
    r.target = { x: target.x, z: target.z };
    const a = this.path.a, d = this.dir;
    const s = (target.x - a.x) * d.x + (target.z - a.z) * d.z;
    r.jumpAt = Math.max(0.03, Math.min(0.97, s / this.len + (Math.random() - 0.5) * 0.04));
  }

  update(dt, input) {
    const g = this.game;
    if (this.flying) {
      this.t += dt * this.planeSpeed / this.len;
      this.pos.lerpVectors(this.path.a, this.path.b, Math.min(1, this.t));
      this.plane.position.copy(this.pos);
      if (this.t >= 1.15) { this.flying = false; this.plane.visible = false; }
    }
    for (const [c, r] of this.riders) {
      if (r.state === 'plane') {
        c.body.p.copy(this.pos);
        if ((c.isBot && this.t >= r.jumpAt) || this.t >= 1) this.jump(c);
        continue;
      }
      if (r.state !== 'freefall') continue;
      // steer: bots towards their target, the player with the movement keys
      let sx = 0, sz = 0;
      if (c.isBot && r.target) {
        const dx = r.target.x - c.body.p.x, dz = r.target.z - c.body.p.z, d = Math.hypot(dx, dz);
        if (d > 0.5) { const k = Math.min(DRIFT, d * 2) / d; sx = dx * k; sz = dz * k; }
      } else if (c === g.player && input) {
        const fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0), str = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
        const f = input.stick ? input.stick.y : fwd, s = input.stick ? input.stick.x : str;
        const y = c.yaw;
        sx = (-Math.sin(y) * f + Math.cos(y) * s) * DRIFT;
        sz = (-Math.cos(y) * f - Math.sin(y) * s) * DRIFT;
      }
      c.body.v.set(sx, -FALL, sz);
      const b = g.bounds;
      c.body.p.x = Math.max(b.minX + 2, Math.min(b.maxX - 2, c.body.p.x + sx * dt));
      c.body.p.z = Math.max(b.minZ + 2, Math.min(b.maxZ - 2, c.body.p.z + sz * dt));
      const ny = c.body.p.y - FALL * dt;
      const ground = g.physics.groundHeight(c.body.p.x, c.body.p.z, 0.3, c.body.p.y);
      if (ny <= ground) {
        c.body.p.y = ground;
        c.body.v.set(0, 0, 0);
        c.body.grounded = true;
        r.state = 'landed';
        if (c === g.player) g.audio.foley('land');
        this.onLand(c);
      } else c.body.p.y = ny;
      if (c.h) { c.h.group.position.copy(c.body.p); c.h.group.visible = true; }
    }
    // the player's camera while in the plane or falling
    const p = g.player, r = this.riders.get(p);
    if (r && r.state !== 'landed') {
      if (input) {
        p.yaw -= input.mouse.dx * 0.0022;
        p.pitch = Math.max(-1.5, Math.min(1.2, p.pitch - input.mouse.dy * 0.0022));
      }
      const cam = g.camera;
      cam.rotation.order = 'YXZ';
      cam.rotation.set(p.pitch, p.yaw, 0);
      if (r.state === 'plane') cam.position.copy(this.pos).add(_v.set(0, 6, 0)).addScaledVector(this.dir, -26);
      else cam.position.copy(p.body.p).add(_v.set(0, 1.6, 0));
    }
  }

  state(c) { const r = this.riders.get(c); return r ? r.state : 'landed'; }

  get active() {
    if (this.flying) return true;
    for (const r of this.riders.values()) if (r.state !== 'landed') return true;
    return false;
  }

  // readouts for the HUD, about the player
  get altitude() {
    const p = this.game.player;
    return Math.max(0, p.body.p.y - this.game.physics.groundHeight(p.body.p.x, p.body.p.z, 0.3, p.body.p.y));
  }

  get speed() {
    const r = this.riders.get(this.game.player);
    if (r && r.state === 'plane') return this.flying ? this.planeSpeed : 0;
    return this.game.player.body.v.length();
  }
}
