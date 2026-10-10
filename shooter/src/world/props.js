// Props: vehicles, cover, street furniture and interior furniture.
// rot is a quarter-turn count so every collider stays axis-aligned.
import * as THREE from 'three';
import { worldUV, roundedBox } from '../core/geometry.js';
import { monument } from './statue.js';
import { awningParts } from './dressing.js';

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
  // Sloped striped awning with a scalloped valance (visual only)
  for (const [mat, g] of awningParts(canvas, 3.3, 1.9, 0.3, false)) { g.translate(0, 2.53, -0.95); P.geo(mat, g, false); }
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

// Street tree (an old lime): a leaning trunk that forks into 4-6 limbs, each with two or three
// branches and their twigs, all tapered tubes in bark. Leaf sprigs cluster at the tips, facing
// out, with a fill of cards inside so the crown reads as one volume. The cards' normals follow
// the crown's shape, and their vertex colours carry a tint (rgb) and how deep in the crown they
// sit (alpha, shading the ambient light). About 4k triangles a tree.
export function tree(B, x, z, autumn = false, scale = 1) {
  const P = placer(B, x, z, 0);
  const r = mulberryLocal(Math.floor(x * 13 + z * 7) + 1000);
  const s = scale;
  const th = 3.4 * s;
  const V = THREE.Vector3;
  const tips = [];
  // a limb grows in a few straight runs, curving upwards
  const grow = (p0, d0, len, segs, up) => {
    const pts = [p0.clone()];
    const d = d0.clone();
    for (let i = 0; i < segs; i++) {
      d.add(new V((r() - 0.5) * 0.22, up, (r() - 0.5) * 0.22)).normalize();
      pts.push(pts[i].clone().addScaledVector(d, len / segs));
    }
    return pts;
  };
  const along = (pts, u) => {
    const f = Math.min(pts.length - 1.001, u * (pts.length - 1)), i = Math.floor(f);
    return { p: pts[i].clone().lerp(pts[i + 1], f - i), d: pts[i + 1].clone().sub(pts[i]).normalize() };
  };
  // turn d away from itself by ang, about a random axis, with a lift towards the light
  const fork = (d, ang, lift) => {
    const ax = new V().crossVectors(d, new V(r() - 0.5, r() - 0.5, r() - 0.5)).normalize();
    return d.clone().applyAxisAngle(ax, ang).add(new V(0, lift, 0)).normalize();
  };
  const bark = (pts, r0, r1, seg) => P.geo('bark', tube(pts, r0, r1, seg), false);

  const lean = new V((r() - 0.5) * 0.34 * s, 0, (r() - 0.5) * 0.34 * s);
  const trunk = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    trunk.push(new V(lean.x * t * t + (r() - 0.5) * 0.03 * s, 0.25 + (th - 0.25) * t, lean.z * t * t + (r() - 0.5) * 0.03 * s));
  }
  bark(trunk, 0.21 * s, 0.12 * s, 10);
  const nLimbs = 4 + Math.floor(r() * 3);
  for (let i = 0; i < nLimbs; i++) {
    const f = i / (nLimbs - 1), leader = i === nLimbs - 1;
    const az = i * 2.4 + r() * 0.7;
    const el = leader ? 1.25 + r() * 0.2 : 0.38 + f * 0.45 + (r() - 0.5) * 0.25;
    const d = new V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const base = along(trunk, 0.7 + 0.28 * f).p;
    const limb = grow(base, d, (leader ? 1.6 : 1.8 + r() * 0.6) * s, 3, 0.16);
    bark(limb, 0.085 * s, 0.04 * s, 7);
    tips.push({ p: limb[3], d: limb[3].clone().sub(limb[2]).normalize(), k: 1.15 });
    const nBr = 2 + (r() < 0.5 ? 1 : 0);
    for (let j = 0; j < nBr; j++) {
      const a = along(limb, 0.38 + 0.52 * (j + r() * 0.6) / nBr);
      const br = grow(a.p, fork(a.d, 0.55 + r() * 0.35, 0.25), (0.85 + r() * 0.5) * s, 2, 0.14);
      bark(br, 0.042 * s, 0.017 * s, 5);
      tips.push({ p: br[2], d: br[2].clone().sub(br[1]).normalize(), k: 1 });
      for (let k = 0; k < 2; k++) {
        const b = along(br, 0.42 + 0.4 * k + r() * 0.1);
        const tw = grow(b.p, fork(b.d, 0.6 + r() * 0.4, 0.2), (0.35 + r() * 0.25) * s, 1, 0.1);
        bark(tw, 0.017 * s, 0.007 * s, 4);
        tips.push({ p: tw[1], d: tw[1].clone().sub(tw[0]).normalize(), k: 0.8 });
      }
    }
  }
  // Crown: the ellipsoid round the tips (for normals and depth), then the cards.
  const C = new V();
  for (const t of tips) C.add(t.p);
  C.multiplyScalar(1 / tips.length);
  const R = new V(0.4 * s, 0.4 * s, 0.4 * s);
  for (const t of tips) {
    R.x = Math.max(R.x, Math.abs(t.p.x - C.x) + 0.4 * s);
    R.y = Math.max(R.y, Math.abs(t.p.y - C.y) + 0.45 * s);
    R.z = Math.max(R.z, Math.abs(t.p.z - C.z) + 0.4 * s);
  }
  const leaves = { leafCards: new CardSet(), leafCardsAutumn: new CardSet() };
  const crown = { C, R };
  const tint = () => { const l = 0.9 + r() * 0.2; return [l * (0.94 + r() * 0.1), l * (0.95 + r() * 0.08), l * (0.88 + r() * 0.12)]; };
  for (const t of tips) {
    const set = leaves[autumn && r() < 0.4 ? 'leafCardsAutumn' : 'leafCards'];
    const centre = t.p.clone().addScaledVector(t.d, 0.12 * s), rc = 0.5 * s * t.k;
    const n = Math.round(32 * t.k), col = tint();
    for (let i = 0; i < n; i++) {
      const o = randBall(r).multiplyScalar(rc);
      if (o.dot(t.d) < -0.25 * rc) o.addScaledVector(t.d, -2 * o.dot(t.d)); // sprigs grow outwards
      const anchor = centre.clone().addScaledVector(o, 0.75);
      const out = o.clone().addScaledVector(t.d, 0.5 * rc).add(randBall(r).multiplyScalar(0.3 * rc)).normalize();
      set.add(anchor, out, (0.45 + r() * 0.25) * s, r, crown, col);
    }
  }
  // inner fill: bigger, darker cards through the middle of the crown
  for (let i = 0; i < 170; i++) {
    const o = randBall(r);
    const p = new V(C.x + o.x * R.x * 0.72, C.y + o.y * R.y * 0.72, C.z + o.z * R.z * 0.72);
    const out = o.clone().add(randBall(r).multiplyScalar(0.6)).normalize();
    leaves[autumn && r() < 0.35 ? 'leafCardsAutumn' : 'leafCards'].add(p, out, (0.55 + r() * 0.25) * s, r, crown, tint());
  }
  for (const k in leaves) if (leaves[k].count) P.geo(k, leaves[k].build(), false);
  P.col(-0.2, 0, -0.2, 0.2, th, 0.2, 'wood');
  // Planter
  P.box(-0.8, 0, -0.8, 0.8, 0.45, 0.8, 'concrete', 'concrete');
}

// Uniform point in the unit ball.
function randBall(r) {
  for (;;) {
    const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
    if (v.lengthSq() <= 1) return v;
  }
}

// Tapered tube through pts, radius r0 to r1, with a frame carried along the path (no twist) and
// UVs in metres: u round the limb, v along it.
function tube(pts, r0, r1, seg) {
  const n = pts.length, pos = [], nrm = [], uv = [], idx = [];
  let t = pts[1].clone().sub(pts[0]).normalize();
  const nv = new THREE.Vector3(Math.abs(t.y) < 0.9 ? 0 : 1, Math.abs(t.y) < 0.9 ? 1 : 0, 0).cross(t).normalize();
  const b = new THREE.Vector3(), dir = new THREE.Vector3(), q = new THREE.Quaternion();
  const circ = Math.PI * (r0 + r1);
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      len += pts[i].distanceTo(pts[i - 1]);
      const tn = pts[Math.min(n - 1, i + 1)].clone().sub(pts[i - 1]).normalize();
      nv.applyQuaternion(q.setFromUnitVectors(t, tn));
      t = tn;
    }
    b.crossVectors(t, nv);
    const rad = r0 + (r1 - r0) * (i / (n - 1));
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      dir.copy(nv).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      pos.push(pts[i].x + dir.x * rad, pts[i].y + dir.y * rad, pts[i].z + dir.z * rad);
      nrm.push(dir.x, dir.y, dir.z);
      uv.push((j / seg) * circ, len);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, c = a + seg + 1;
      idx.push(a, a + 1, c, c, a + 1, c + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Leaf cards for one material: each a quad with its stalk end at the anchor, reaching outwards,
// textured with one of the atlas's four sprigs.
class CardSet {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.count = 0; }
  add(anchor, out, size, r, crown, tint) {
    // the card plane holds `out`; roll it at random about that line, tipped a little to the sky
    const side = new THREE.Vector3().crossVectors(out, new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5)).normalize();
    const face = new THREE.Vector3().crossVectors(side, out).add(new THREE.Vector3(0, 0.35, 0));
    face.addScaledVector(out, -face.dot(out)).normalize();
    side.crossVectors(out, face).normalize();
    const cell = Math.floor(r() * 4), u0 = (cell % 2) * 0.5 + 0.004, v0 = (1 - (cell >> 1)) * 0.5 + 0.004, du = 0.492;
    const w = size * 0.5, base = anchor.clone().addScaledVector(out, -size * 0.06);
    const { C, R } = crown;
    if (face.dot(anchor.clone().sub(C)) < 0) face.negate();
    for (const [cu, cv] of CARD_QUAD) {
      const p = base.clone().addScaledVector(side, (cu * 2 - 1) * w).addScaledVector(out, cv * size);
      this.pos.push(p.x, p.y, p.z);
      // normal: mostly the crown's outward direction at this point, a little of the card's own
      const ex = (p.x - C.x) / R.x, ey = (p.y - C.y) / R.y, ez = (p.z - C.z) / R.z;
      const nn = new THREE.Vector3(ex / R.x, ey / R.y, ez / R.z).normalize().multiplyScalar(0.68).addScaledVector(face, 0.32).normalize();
      this.nrm.push(nn.x, nn.y, nn.z);
      this.uv.push(u0 + cu * du, v0 + cv * du);
      // depth in the crown: deep and low cards see little of the sky
      const d = Math.min(1, Math.sqrt(ex * ex + ey * ey + ez * ez));
      const ao = (0.3 + 0.7 * smooth(0.2, 1.0, d)) * (0.82 + 0.18 * Math.min(1, Math.max(0, ey * 0.5 + 0.6)));
      this.col.push(tint[0], tint[1], tint[2], ao);
    }
    this.count++;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    return g;
  }
}
const CARD_QUAD = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

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
  const inner = new THREE.CylinderGeometry(3.3, 3.3, 0.05, 40);
  inner.translate(x, 0.45, z);
  B.geo('water', inner);
  monument(B, x, z, -0.98);
  // Colliders: ring of boxes approximating the basin.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const cx = Math.cos(a) * 3.3, cz = Math.sin(a) * 3.3;
    B.collider(x + cx - 0.9, 0, z + cz - 0.9, x + cx + 0.9, 0.82, z + cz + 0.9, 'stone');
  }
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
