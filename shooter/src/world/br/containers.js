// STUB — replaced at merge. Minimal loot containers for the match crew to build against: a box
// with a hinged door that swings open. The real module (map crew) models fridges, cabinets, etc.
import * as THREE from 'three';

const COLORS = { fridge: 0xd8d8d0, cabinet: 0x7a5a3a, dresser: 0x6b4a2e, wardrobe: 0x5a4028, medcab: 0xe8e8e8, crate: 0x5d6640, locker: 0x55606a, desk: 0x6e5236 };
const SIZES = { fridge: [0.7, 1.7, 0.65], wardrobe: [1.1, 1.9, 0.6], locker: [0.5, 1.8, 0.5], medcab: [0.6, 0.7, 0.25], crate: [0.9, 0.6, 0.6], cabinet: [0.9, 0.9, 0.5], dresser: [1.0, 0.85, 0.5], desk: [1.2, 0.76, 0.6] };

let nextId = 1;

export class Container {
  // pos: floor point in front of it; yaw: the way its front faces (-Z turned by yaw), towards pos
  constructor(kind, pos, yaw, tier) {
    this.id = nextId++;
    this.kind = kind;
    this.pos = pos.clone();
    this.yaw = yaw;
    this.tier = tier;
    this.opened = false;
    this.anim = 0;
    const [w, h, d] = SIZES[kind] || SIZES.crate;
    const mat = new THREE.MeshStandardMaterial({ color: COLORS[kind] || 0x777777, roughness: 0.7, metalness: kind === 'locker' || kind === 'fridge' ? 0.3 : 0.05 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.98, d), mat);
    body.position.y = h * 0.49;
    body.castShadow = body.receiveShadow = true;
    // the door hangs on one edge of the front face (local -Z, which faces pos)
    this.lid = new THREE.Group();
    this.lid.position.set(-w / 2, 0, -d / 2);
    const door = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), new THREE.MeshStandardMaterial({ color: new THREE.Color(COLORS[kind] || 0x777777).multiplyScalar(0.8), roughness: 0.6 }));
    door.position.set(w / 2, h / 2, -0.02);
    door.castShadow = true;
    this.lid.add(door);
    g.add(body, this.lid);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    g.position.set(pos.x - fx * (0.35 + d / 2), pos.y, pos.z - fz * (0.35 + d / 2));
    g.rotation.y = yaw;
    this.object = g;
  }

  open() {
    if (this.opened) return;
    this.opened = true;
  }

  close() { this.opened = false; this.anim = 0; this.lid.rotation.y = 0; }

  update(dt) {
    if (!this.opened || this.anim >= 1) return;
    this.anim = Math.min(1, this.anim + dt * 2.5);
    this.lid.rotation.y = 1.9 * (1 - Math.pow(1 - this.anim, 3));
  }
}
