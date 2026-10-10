// Props: vehicles, cover, street furniture and interior furniture.
// rot is a quarter-turn count so every collider stays axis-aligned.
import * as THREE from 'three';
import { worldUV, roundedBox } from '../core/geometry.js';

function placer(B, x, z, rot, y = 0) {
  const c = [1, 0, -1, 0][rot & 3], s = [0, 1, 0, -1][rot & 3];
  const tf = (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c];
  const m = new THREE.Matrix4().makeRotationY(-(rot & 3) * Math.PI / 2).setPosition(x, y, z);
  return {
    box(x0, y0, z0, x1, y1, z1, mat, phys = null) {
      const a = tf(x0, z0), b = tf(x1, z1);
      B.solid(Math.min(a[0], b[0]), y + y0, Math.min(a[1], b[1]), Math.max(a[0], b[0]), y + y1, Math.max(a[1], b[1]), mat, phys);
    },
    col(x0, y0, z0, x1, y1, z1, phys) {
      const a = tf(x0, z0), b = tf(x1, z1);
      B.collider(Math.min(a[0], b[0]), y + y0, Math.min(a[1], b[1]), Math.max(a[0], b[0]), y + y1, Math.max(a[1], b[1]), phys);
    },
    geo(mat, g, uv = true) {
      g.applyMatrix4(m);
      if (uv) worldUV(g);
      B.geo(mat, g);
    },
  };
}

function wheel(P, lx, lz, r = 0.33, w = 0.22, mat = 'tire') {
  const g = new THREE.CylinderGeometry(r, r, w, 18);
  g.rotateX(Math.PI / 2);
  g.translate(lx, r, lz);
  P.geo(mat, g);
  const hub = new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 12);
  hub.rotateX(Math.PI / 2);
  hub.translate(lx, r, lz);
  P.geo(mat === 'tire' ? 'chrome' : 'burnt', hub);
}

export function car(B, x, z, rot, paint = 'carRed', burnt = false) {
  const P = placer(B, x, z, rot);
  const body = burnt ? 'burnt' : paint;
  const L = 2.25, W = 0.88;
  P.box(-L, 0.32, -W, L, 0.92, W, body, null);
  P.box(-L - 0.06, 0.34, -W + 0.06, -L, 0.6, W - 0.06, burnt ? 'burnt' : 'darkMetal', null);
  P.box(L, 0.34, -W + 0.06, L + 0.06, 0.6, W - 0.06, burnt ? 'burnt' : 'darkMetal', null);
  // Cabin: pillars + glass
  P.box(-1.15, 0.92, -W + 0.08, 1.05, 1.42, W - 0.08, burnt ? 'burnt' : 'glass', null);
  P.box(-1.2, 1.4, -W + 0.05, 1.1, 1.46, W - 0.05, body, null);
  for (const px of [-1.2, -0.05, 1.0]) P.box(px, 0.92, -W + 0.04, px + 0.1, 1.42, W - 0.04, body, null);
  if (!burnt) {
    P.box(L - 0.02, 0.62, -W + 0.12, L + 0.03, 0.76, -W + 0.42, 'lampGlow', null);
    P.box(L - 0.02, 0.62, W - 0.42, L + 0.03, 0.76, W - 0.12, 'lampGlow', null);
  }
  for (const wx of [-1.45, 1.45]) for (const wz of [-W + 0.08, W - 0.08]) wheel(P, wx, wz, 0.33, 0.24, burnt ? 'burnt' : 'tire');
  P.col(-L, 0.05, -W, L, 1.0, W, 'metal');
  P.col(-1.2, 1.0, -W + 0.05, 1.1, 1.46, W - 0.05, 'metal');
}

export function bus(B, x, z, rot) {
  const P = placer(B, x, z, rot);
  const L = 5.6, W = 1.25;
  P.box(-L, 0.45, -W, L, 1.4, W, 'burnt', null);
  P.box(-L, 1.4, -W, L, 2.6, W, 'glass', null);
  for (let px = -L; px <= L; px += 1.4) P.box(px, 1.4, -W - 0.01, px + 0.12, 2.6, W + 0.01, 'rust', null);
  P.box(-L, 2.6, -W, L, 3.0, W, 'rust', null);
  for (const wx of [-3.8, 3.4]) for (const wz of [-W + 0.1, W - 0.1]) wheel(P, wx, wz, 0.48, 0.3, 'burnt');
  P.col(-L, 0.1, -W, L, 3.0, W, 'metal');
}

export function van(B, x, z, rot, paint = 'carWhite') {
  const P = placer(B, x, z, rot);
  const L = 2.6, W = 0.98;
  P.box(-L, 0.38, -W, L - 0.9, 2.3, W, paint, null);
  P.box(L - 0.9, 0.38, -W, L, 1.2, W, paint, null);
  P.box(L - 0.9, 1.2, -W + 0.06, L - 0.2, 1.95, W - 0.06, 'glass', null);
  P.box(L - 0.95, 1.95, -W, L - 0.6, 2.3, W, paint, null);
  for (const wx of [-1.7, 1.75]) for (const wz of [-W + 0.08, W - 0.08]) wheel(P, wx, wz, 0.36, 0.25);
  P.col(-L, 0.05, -W, L, 2.3, W, 'metal');
}

export function sandbags(B, x, z, rot, len = 3, rows = 3, y = 0) {
  const P = placer(B, x, z, rot, y);
  const bagL = 0.6, bagH = 0.17, bagD = 0.36;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bagL / 2 : 0;
    for (let lx = -len / 2 + off; lx < len / 2 - 0.05; lx += bagL) {
      const g = roundedBox(bagL - 0.03, bagH, bagD, 0.07, 2);
      g.translate(lx + bagL / 2, r * (bagH - 0.02) + bagH / 2, 0);
      P.geo('sandbag', g);
    }
  }
  P.col(-len / 2, 0, -bagD / 2, len / 2, rows * (bagH - 0.02) + 0.02, bagD / 2, 'sandbag');
}

export function jersey(B, x, z, rot) {
  const P = placer(B, x, z, rot);
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.08); s.lineTo(0.12, 0.3); s.lineTo(0.09, 0.82); s.lineTo(-0.09, 0.82); s.lineTo(-0.12, 0.3); s.lineTo(-0.3, 0.08);
  const g = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: false });
  g.translate(0, 0, -1.5);
  g.rotateY(Math.PI / 2);
  P.geo('concrete', g);
  P.col(-1.5, 0, -0.3, 1.5, 0.82, 0.3, 'concrete');
}

export function crate(B, x, z, rot, s = 1.0, stack = 1, y = 0) {
  const P = placer(B, x, z, rot, y);
  for (let i = 0; i < stack; i++) {
    const o = i * s;
    P.box(-s / 2, o, -s / 2, s / 2, o + s, s / 2, 'woodDark', null);
    // Battens
    P.box(-s / 2 - 0.02, o + 0.04, -s / 2 - 0.02, s / 2 + 0.02, o + 0.12, s / 2 + 0.02, 'woodFloor', null);
    P.box(-s / 2 - 0.02, o + s - 0.12, -s / 2 - 0.02, s / 2 + 0.02, o + s - 0.04, s / 2 + 0.02, 'woodFloor', null);
  }
  P.col(-s / 2, 0, -s / 2, s / 2, s * stack, s / 2, 'wood');
}

export function dumpster(B, x, z, rot) {
  const P = placer(B, x, z, rot);
  P.box(-0.95, 0.15, -0.6, 0.95, 1.2, 0.6, 'carGreen', null);
  P.box(-1.0, 1.2, -0.65, 1.0, 1.28, 0.65, 'darkMetal', null);
  for (const wx of [-0.75, 0.75]) for (const wz of [-0.45, 0.45]) wheel(P, wx, wz, 0.08, 0.06);
  P.col(-0.95, 0.05, -0.6, 0.95, 1.28, 0.6, 'metal');
}

export function stall(B, x, z, rot, canvas = 'canvasStripe') {
  const P = placer(B, x, z, rot);
  P.box(-1.4, 0, -0.6, 1.4, 0.95, 0.6, 'woodDark', 'wood');
  P.box(-1.5, 0.95, -0.7, 1.5, 1.0, 0.7, 'woodFloor', null);
  for (const px of [-1.45, 1.35]) for (const pz of [-0.65, 0.55]) P.box(px, 1.0, pz, px + 0.1, 2.3, pz + 0.1, 'woodDark', null);
  // Sloped awning (visual only)
  const g = new THREE.BoxGeometry(3.3, 0.04, 1.9);
  g.rotateX(0.18);
  g.translate(0, 2.35, 0.1);
  P.geo(canvas, g);
  // Goods on the counter
  for (let i = 0; i < 5; i++) {
    const b = roundedBox(0.4, 0.25, 0.35, 0.03);
    b.translate(-1.1 + i * 0.55, 1.12, -0.1);
    P.geo(i % 2 ? 'woodFloor' : 'fabric', b);
  }
}

export function bench(B, x, z, rot) {
  const P = placer(B, x, z, rot);
  P.box(-0.9, 0.42, -0.22, 0.9, 0.47, 0.22, 'woodFloor', null);
  P.box(-0.9, 0.55, 0.18, 0.9, 0.85, 0.22, 'woodFloor', null);
  for (const px of [-0.8, 0.75]) P.box(px, 0, -0.2, px + 0.05, 0.85, 0.22, 'darkMetal', null);
  P.col(-0.9, 0, -0.22, 0.9, 0.5, 0.22, 'wood');
}

export function lampPost(B, x, z) {
  const P = placer(B, x, z, 0);
  const g = new THREE.CylinderGeometry(0.06, 0.09, 4.2, 10);
  g.translate(0, 2.1, 0);
  P.geo('darkMetal', g);
  const arm = new THREE.BoxGeometry(0.7, 0.05, 0.05);
  arm.translate(0.32, 4.1, 0);
  P.geo('darkMetal', arm);
  const head = new THREE.CylinderGeometry(0.12, 0.2, 0.25, 8);
  head.translate(0.62, 3.98, 0);
  P.geo('darkMetal', head);
  const bulb = new THREE.SphereGeometry(0.08, 8, 6);
  bulb.translate(0.62, 3.84, 0);
  P.geo('lampGlow', bulb, false);
  P.col(-0.09, 0, -0.09, 0.09, 4.2, 0.09, 'metal');
}

export function tree(B, x, z, autumn = false, scale = 1) {
  const P = placer(B, x, z, 0);
  const r = mulberryLocal(Math.floor(x * 13 + z * 7) + 1000);
  const th = 3.4 * scale;
  const trunk = new THREE.CylinderGeometry(0.11 * scale, 0.2 * scale, th, 9);
  trunk.translate(0, th / 2, 0);
  P.geo('bark', trunk);
  // A few limbs leaving the trunk
  for (let i = 0; i < 5; i++) {
    const len = (1.1 + r() * 0.8) * scale;
    const limb = new THREE.CylinderGeometry(0.035 * scale, 0.07 * scale, len, 6);
    limb.translate(0, len / 2, 0);
    limb.rotateZ(0.6 + r() * 0.5);
    limb.rotateY(r() * Math.PI * 2);
    limb.translate(0, th * (0.72 + r() * 0.25), 0);
    P.geo('bark', limb);
  }
  // Crown: alpha-tested leaf cards scattered through an ellipsoid.
  const cards = 34;
  for (let i = 0; i < cards; i++) {
    const s = (1.2 + r() * 0.7) * scale;
    const g = new THREE.PlaneGeometry(s, s);
    g.rotateX(r() * Math.PI); g.rotateY(r() * Math.PI); g.rotateZ(r() * Math.PI);
    const a = r() * Math.PI * 2, u = r() * 2 - 1, d = Math.cbrt(r());
    const rr = Math.sqrt(1 - u * u) * d;
    g.translate(Math.cos(a) * rr * 1.9 * scale, th + 0.9 * scale + u * d * 1.35 * scale, Math.sin(a) * rr * 1.9 * scale);
    P.geo(autumn && i % 3 === 0 ? 'leafCardsAutumn' : 'leafCards', g, false);
  }
  P.col(-0.2, 0, -0.2, 0.2, th, 0.2, 'wood');
  // Planter
  P.box(-0.8, 0, -0.8, 0.8, 0.45, 0.8, 'concrete', 'concrete');
}

function mulberryLocal(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fountain(B, x, z) {
  const P = placer(B, x, z, 0);
  const outer = new THREE.CylinderGeometry(3.4, 3.5, 0.7, 32, 1, true);
  outer.translate(0, 0.35, 0);
  P.geo('stone' in B.M ? 'stone' : 'concrete', outer);
  const rim = new THREE.TorusGeometry(3.42, 0.14, 8, 40);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.72, 0);
  P.geo('concrete', rim);
  const inner = new THREE.CylinderGeometry(3.3, 3.3, 0.05, 32);
  inner.translate(0, 0.45, 0);
  P.geo('water', inner);
  const ped = new THREE.CylinderGeometry(0.9, 1.1, 1.8, 16);
  ped.translate(0, 1.2, 0);
  P.geo('concrete', ped);
  const plinth = new THREE.BoxGeometry(1.1, 0.5, 1.1);
  plinth.translate(0, 2.35, 0);
  P.geo('concrete', plinth);
  // A bronze rider statue, roughly sketched in primitives.
  const horse = roundedBox(1.6, 0.7, 0.5, 0.2, 3);
  horse.translate(0, 3.15, 0);
  P.geo('bronze', horse, false);
  const neck = roundedBox(0.35, 0.9, 0.3, 0.12, 2);
  neck.rotateZ(-0.6);
  neck.translate(0.8, 3.6, 0);
  P.geo('bronze', neck, false);
  const head = roundedBox(0.55, 0.25, 0.22, 0.08, 2);
  head.translate(1.12, 3.95, 0);
  P.geo('bronze', head, false);
  for (const lx of [-0.6, 0.6]) for (const lz of [-0.15, 0.15]) {
    const leg = new THREE.CylinderGeometry(0.07, 0.06, 0.75, 6);
    leg.translate(lx, 2.6 + 0.375, lz);
    P.geo('bronze', leg, false);
  }
  const rider = roundedBox(0.35, 0.8, 0.3, 0.1, 2);
  rider.translate(-0.05, 3.85, 0);
  P.geo('bronze', rider, false);
  const rhead = new THREE.SphereGeometry(0.14, 12, 8);
  rhead.translate(-0.05, 4.4, 0);
  P.geo('bronze', rhead, false);
  // Colliders: ring of boxes approximating the basin, plus the pedestal.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const cx = Math.cos(a) * 3.3, cz = Math.sin(a) * 3.3;
    B.collider(x + cx - 0.9, 0, z + cz - 0.9, x + cx + 0.9, 0.82, z + cz + 0.9, 'stone');
  }
  B.collider(x - 1.0, 0, z - 1.0, x + 1.0, 4.6, z + 1.0, 'stone');
  B.collider(x - 2.6, 0, z - 2.6, x + 2.6, 0.5, z + 2.6, 'stone');
}

// --- Interior furniture -------------------------------------------------------
export function table(B, x, z, rot, y = 0, w = 1.4, d = 0.8) {
  const P = placer(B, x, z, rot, y);
  P.box(-w / 2, 0.72, -d / 2, w / 2, 0.76, d / 2, 'woodFloor', null);
  for (const lx of [-w / 2 + 0.05, w / 2 - 0.1]) for (const lz of [-d / 2 + 0.05, d / 2 - 0.1]) P.box(lx, 0, lz, lx + 0.05, 0.72, lz + 0.05, 'woodDark', null);
  P.col(-w / 2, 0.6, -d / 2, w / 2, 0.76, d / 2, 'wood');
}

export function counter(B, x, z, rot, y = 0, len = 3) {
  const P = placer(B, x, z, rot, y);
  P.box(-len / 2, 0, -0.35, len / 2, 1.05, 0.35, 'woodDark', 'wood');
  P.box(-len / 2 - 0.03, 1.05, -0.4, len / 2 + 0.03, 1.1, 0.4, 'concrete', null);
}

export function shelf(B, x, z, rot, y = 0, len = 2) {
  const P = placer(B, x, z, rot, y);
  for (let k = 0; k < 4; k++) P.box(-len / 2, 0.1 + k * 0.5, -0.2, len / 2, 0.14 + k * 0.5, 0.2, 'woodFloor', null);
  P.box(-len / 2, 0, 0.18, len / 2, 2.0, 0.22, 'woodDark', null);
  for (let k = 0; k < 3; k++) for (let i = 0; i < Math.floor(len / 0.3); i++) {
    if ((i * 7 + k * 3) % 5 === 0) continue;
    const b = new THREE.BoxGeometry(0.18, 0.28, 0.2);
    b.translate(-len / 2 + 0.2 + i * 0.3, 0.3 + k * 0.5, 0);
    P.geo(i % 3 === 0 ? 'paper' : i % 3 === 1 ? 'fabric' : 'canvasRed', b);
  }
  P.col(-len / 2, 0, -0.22, len / 2, 2.0, 0.22, 'wood');
}

export function sofa(B, x, z, rot, y = 0) {
  const P = placer(B, x, z, rot, y);
  const seat = roundedBox(2.0, 0.42, 0.85, 0.08);
  seat.translate(0, 0.21, 0);
  P.geo('fabric', seat);
  const back = roundedBox(2.0, 0.5, 0.22, 0.08);
  back.translate(0, 0.62, 0.32);
  P.geo('fabric', back);
  P.col(-1.0, 0, -0.42, 1.0, 0.85, 0.42, 'wood');
}

export function bed(B, x, z, rot, y = 0) {
  const P = placer(B, x, z, rot, y);
  P.box(-1.0, 0, -0.75, 1.0, 0.35, 0.75, 'woodDark', null);
  const m = roundedBox(1.95, 0.2, 1.45, 0.06);
  m.translate(0, 0.45, 0);
  P.geo('paper', m);
  P.box(0.9, 0, -0.75, 1.0, 1.0, 0.75, 'woodDark', null);
  P.col(-1.0, 0, -0.75, 1.0, 0.55, 0.75, 'wood');
}

export function cabinet(B, x, z, rot, y = 0) {
  const P = placer(B, x, z, rot, y);
  P.box(-0.45, 0, -0.3, 0.45, 1.3, 0.3, 'darkMetal', 'metal');
  for (let k = 0; k < 3; k++) P.box(-0.4, 0.15 + k * 0.4, -0.31, 0.4, 0.45 + k * 0.4, -0.3, 'chrome', null);
}

export function rubble(B, x, z, s = 1, y = 0) {
  const r = mulberryLocal(Math.floor(x * 31 + z * 17));
  const P = placer(B, x, z, 0, y);
  for (let i = 0; i < 9; i++) {
    const g = new THREE.DodecahedronGeometry((0.15 + r() * 0.35) * s, 0);
    g.translate((r() - 0.5) * 1.6 * s, 0.1 * s, (r() - 0.5) * 1.6 * s);
    P.geo(i % 3 ? 'concrete' : 'brick', g);
  }
  P.col(-0.6 * s, 0, -0.6 * s, 0.6 * s, 0.35 * s, 0.6 * s, 'concrete');
}

export function acUnit(B, x, z, rot, y) {
  const P = placer(B, x, z, rot, y);
  P.box(-0.5, 0, -0.4, 0.5, 0.9, 0.4, 'trim', 'metal');
  const fan = new THREE.CylinderGeometry(0.3, 0.3, 0.02, 16);
  fan.translate(0, 0.91, 0);
  P.geo('darkMetal', fan);
}

export function waterTank(B, x, z, y) {
  const P = placer(B, x, z, 0, y);
  const g = new THREE.CylinderGeometry(0.9, 0.9, 1.8, 18);
  g.translate(0, 1.5, 0);
  P.geo('rust', g);
  for (const px of [-0.6, 0.6]) for (const pz of [-0.6, 0.6]) P.box(px - 0.05, 0, pz - 0.05, px + 0.05, 0.6, pz + 0.05, 'darkMetal', null);
  P.col(-0.9, 0, -0.9, 0.9, 2.4, 0.9, 'metal');
}
