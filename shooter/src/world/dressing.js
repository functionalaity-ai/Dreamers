// Street dressing: wrought-iron wall lanterns, window boxes of geraniums, drainpipes with their
// brackets, hopper heads and shoes, sagging cables across the streets, and one decal atlas for
// torn posters, spray-painted tags, enamel street signs and house numbers.
// Pieces are built in face space (x along the wall, y up, z out of it) and placed with a matrix.
import * as THREE from 'three';
import { worldUV } from '../core/geometry.js';

function place(B, mat, g, m, shadow = true) { g.applyMatrix4(m); worldUV(g); B.geo(mat, g, shadow); }
const bar = (x0, y0, z0, x1, y1, z1, r = 0.008) => {
  const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6);
  g.translate(0, a.distanceTo(b) / 2, 0);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())));
  g.translate(x0, y0, z0);
  return g;
};

// A lantern on a scrolled bracket; m is the bracket's base on the wall.
export function lantern(B, m) {
  const iron = 'darkMetal';
  const parts = [
    new THREE.BoxGeometry(0.1, 0.16, 0.02).translate(0, 0, 0.01),          // wall plate
    bar(0, 0.04, 0.02, 0, 0.04, 0.42, 0.011),                              // arm
    bar(0, -0.05, 0.02, 0, 0.04, 0.3, 0.008),                              // brace
  ];
  // the scroll under the arm, as short segments round a spiral
  let prev = null;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, a = Math.PI * 1.6 * t, r = 0.07 * (1 - t * 0.6);
    const p = new THREE.Vector3(0, 0.04 - 0.07 + Math.cos(a) * r, 0.2 + Math.sin(a) * r);
    if (prev) parts.push(bar(prev.x, prev.y, prev.z, p.x, p.y, p.z, 0.006));
    prev = p;
  }
  parts.push(bar(0, 0.04, 0.42, 0, -0.02, 0.42, 0.006));                  // hanger
  for (const g of parts) place(B, iron, g, m);
  // lantern: a tapered cage with glass, a cap and a finial
  const lan = new THREE.Matrix4().makeTranslation(0, -0.27, 0.42);
  const mm = m.clone().multiply(lan);
  const cage = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    cage.push(bar(Math.cos(a) * 0.075, 0.0, Math.sin(a) * 0.075, Math.cos(a) * 0.095, 0.24, Math.sin(a) * 0.095, 0.006));
  }
  cage.push(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 4).rotateY(Math.PI / 4).translate(0, -0.01, 0));
  cage.push(new THREE.CylinderGeometry(0.02, 0.13, 0.08, 4).rotateY(Math.PI / 4).translate(0, 0.28, 0));
  cage.push(new THREE.SphereGeometry(0.02, 6, 4).translate(0, 0.34, 0));
  for (const g of cage) place(B, iron, g, mm);
  place(B, 'glass', new THREE.CylinderGeometry(0.09, 0.072, 0.23, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.12, 0), mm, false);
  place(B, 'lampGlow', new THREE.SphereGeometry(0.03, 8, 6).translate(0, 0.11, 0), mm, false);
}

// A window box of geraniums on the sill; m is the window frame (opening bottom centre).
export function windowBox(B, m, w, rnd) {
  const bw = w + 0.1;
  place(B, 'terracotta', new THREE.BoxGeometry(bw, 0.16, 0.2).translate(0, 0.08, 0.16), m);
  for (const sx of [-1, 1]) place(B, 'darkMetal', new THREE.BoxGeometry(0.02, 0.14, 0.24).translate(sx * (bw / 2 - 0.08), 0.02, 0.16), m);
  const leaves = [], flowers = [];
  const n = Math.round(bw / 0.09);
  for (let i = 0; i < n; i++) {
    const x = -bw / 2 + 0.06 + (bw - 0.12) * (i / (n - 1)) + (rnd() - 0.5) * 0.03;
    const s = 0.06 + rnd() * 0.04;
    leaves.push(new THREE.IcosahedronGeometry(s, 0).scale(1.2, 0.8, 1).translate(x, 0.17 + rnd() * 0.04, 0.16 + (rnd() - 0.5) * 0.08));
    if (rnd() < 0.85) {
      const fx = x + (rnd() - 0.5) * 0.05, fy = 0.24 + rnd() * 0.08, fz = 0.16 + (rnd() - 0.3) * 0.1;
      flowers.push(new THREE.IcosahedronGeometry(0.03 + rnd() * 0.015, 0).translate(fx, fy, fz));
      flowers.push(new THREE.IcosahedronGeometry(0.022, 0).translate(fx + 0.03, fy - 0.02, fz + 0.01));
    }
    if (rnd() < 0.4) leaves.push(new THREE.IcosahedronGeometry(0.04, 0).scale(1, 0.6, 1).translate(x, 0.12, 0.27));
  }
  for (const g of leaves) place(B, 'leaves', g, m);
  for (const g of flowers) place(B, 'geranium', g, m);
}

// A drainpipe from the gutter at `top` to the ground, standing off the wall on brackets,
// with a hopper head, an offset round the plinth and a shoe; m is at the pipe's foot on the wall.
export function drainpipe(B, m, top) {
  const pipe = 'galvanized', d = 0.13;
  const parts = [
    new THREE.CylinderGeometry(0.055, 0.055, top - 0.9, 10).translate(0, 0.62 + (top - 0.9) / 2, d),
    new THREE.CylinderGeometry(0.15, 0.07, 0.24, 4).rotateY(Math.PI / 4).translate(0, top - 0.42, d + 0.02),
    new THREE.BoxGeometry(0.3, 0.06, 0.22).translate(0, top - 0.27, d + 0.02),
    bar(0, 0.62, d, 0, 0.42, d + 0.09, 0.055),
    new THREE.CylinderGeometry(0.055, 0.055, 0.32, 10).translate(0, 0.26, d + 0.09),
    bar(0, 0.12, d + 0.09, 0, 0.04, d + 0.22, 0.06),
  ];
  for (let y = 1.4; y < top - 0.6; y += 1.6) {
    parts.push(new THREE.TorusGeometry(0.062, 0.008, 4, 10).rotateX(Math.PI / 2).translate(0, y, d));
    parts.push(new THREE.BoxGeometry(0.02, 0.025, d).translate(0, y, d / 2));
  }
  for (const g of parts) place(B, pipe, g, m);
}

// A cable sagging between two world points (and a couple of droppers if `lamp`).
export function cable(B, a, b, sag = 0.6, r = 0.012) {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 4, false);
  worldUV(g);
  B.geo('rubberDark', g);
}

// --- decals -----------------------------------------------------------------------------------
// One canvas atlas holds every poster, tag and sign; quads are merged into a single mesh.
const ATLAS = 2048;
export class DecalAtlas {
  constructor() {
    this.regions = {};
    this.quads = [];
    const c = document.createElement('canvas');
    c.width = c.height = ATLAS;
    this.canvas = c;
    this.draw(c.getContext('2d'));
  }

  region(name, x, y, w, h) { this.regions[name] = { x, y, w, h }; }

  draw(g) {
    let seed = 17;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // --- torn posters (portrait, 360 x 512 each, two rows of four)
    const posters = [
      { bg: '#e8dcc0', ink: '#a31d18', head: 'ЦИРК', sub: ['ГАСТРОЛИ', 'с 12 по 30 мая'], art: '#c98a2a' },
      { bg: '#d9d3c4', ink: '#1d2a4a', head: 'КИНО', sub: ['«ПОСЛЕДНИЙ РУБЕЖ»', 'ежедневно 19:00'], art: '#3a5a7a' },
      { bg: '#c9b48a', ink: '#2a2a22', head: 'ВЫБОРЫ', sub: ['ГОЛОСУЙ', 'ЗА ПОРЯДОК'], art: '#7a2a20' },
      { bg: '#efe8d8', ink: '#b8301e', head: 'ТАНЦЫ', sub: ['ДОМ КУЛЬТУРЫ', 'суббота'], art: '#d0a040' },
      { bg: '#b8c4c0', ink: '#22322e', head: 'ВНИМАНИЕ', sub: ['КОМЕНДАНТСКИЙ ЧАС', '22:00 – 06:00'], art: '#4a5a52' },
      { bg: '#e2c9a8', ink: '#5a1a12', head: 'ЛОТО', sub: ['ВЫИГРЫШ', 'КАЖДЫЙ ДЕНЬ'], art: '#9a5a2a' },
      { bg: '#d8d2c6', ink: '#202020', head: 'РОЗЫСК', sub: ['ЗА ИНФОРМАЦИЮ', 'ВОЗНАГРАЖДЕНИЕ'], art: '#6a6258' },
      { bg: '#cfd8c8', ink: '#2a4a20', head: 'МОЛОКО', sub: ['СВЕЖЕЕ', 'с фермы'], art: '#a8b890' },
    ];
    posters.forEach((p, i) => {
      const x = (i % 4) * 512 + 76, y = Math.floor(i / 4) * 512 + 0, w = 360, h = 500;
      this.region('poster' + i, x, y, w, h);
      g.save();
      g.beginPath();
      // ragged, torn outline
      const pts = [];
      for (let k = 0; k <= 24; k++) pts.push([x + (k / 24) * w, y + 6 + rnd() * 14]);
      for (let k = 0; k <= 30; k++) pts.push([x + w - 4 - rnd() * 12, y + (k / 30) * h]);
      for (let k = 24; k >= 0; k--) pts.push([x + (k / 24) * w, y + h - 6 - rnd() * (i % 3 === 0 ? 70 : 16)]);
      for (let k = 30; k >= 0; k--) pts.push([x + 4 + rnd() * 12, y + (k / 30) * h]);
      pts.forEach(([a, b], k) => (k ? g.lineTo(a, b) : g.moveTo(a, b)));
      g.closePath();
      g.clip();
      g.fillStyle = p.bg; g.fillRect(x, y, w, h);
      g.fillStyle = p.art;
      g.beginPath(); g.arc(x + w / 2, y + h * 0.5, w * 0.3, 0, Math.PI * 2); g.fill();
      for (let k = 0; k < 140; k++) { g.globalAlpha = 0.25; g.fillRect(x + rnd() * w, y + h * 0.3 + rnd() * h * 0.4, 4, 4); }
      g.globalAlpha = 1;
      g.fillStyle = p.ink; g.textAlign = 'center';
      g.font = '900 ' + Math.round(w / Math.max(4, p.head.length) * 1.35) + 'px Impact, "Arial Black", sans-serif';
      g.fillText(p.head, x + w / 2, y + h * 0.2);
      g.font = '700 30px "Arial Narrow", Arial, sans-serif';
      p.sub.forEach((t, k) => g.fillText(t, x + w / 2, y + h * 0.82 + k * 36));
      // age: yellowing, stains and paper creases
      const grd = g.createLinearGradient(x, y, x + w, y + h);
      grd.addColorStop(0, 'rgba(120,90,30,0.18)'); grd.addColorStop(1, 'rgba(60,40,10,0.32)');
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(70,50,20,' + (0.08 + rnd() * 0.12) + ')'; g.beginPath(); g.ellipse(x + rnd() * w, y + rnd() * h, 20 + rnd() * 60, 10 + rnd() * 40, rnd() * 3, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y + h * 0.5); g.lineTo(x + w, y + h * 0.48); g.stroke();
      g.restore();
    });
    // --- spray-painted tags (row three)
    const tag = (name, x, y, w, h, fn) => { this.region(name, x, y, w, h); g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); fn(x, y, w, h); g.restore(); };
    const spray = (txt, x, y, w, h, colr, font) => {
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = colr; g.shadowBlur = 10; g.fillStyle = colr;
      g.fillText(txt, x + w / 2, y + h / 2);
      g.shadowBlur = 0;
      // drips
      g.strokeStyle = colr; g.lineWidth = 3;
      for (let k = 0; k < 9; k++) { const dx = x + w * (0.15 + rnd() * 0.7), dy = y + h * (0.55 + rnd() * 0.15); g.globalAlpha = 0.8; g.beginPath(); g.moveTo(dx, dy); g.lineTo(dx + (rnd() - 0.5) * 2, dy + 20 + rnd() * 60); g.stroke(); }
      g.globalAlpha = 1;
    };
    tag('tagVolk', 0, 1024, 1024, 300, (x, y, w, h) => spray('ВОЛК', x, y, w, h, 'rgba(190,30,25,0.92)', 'italic 900 210px Impact, "Arial Black", sans-serif'));
    tag('tagArrow', 1024, 1024, 512, 300, (x, y, w, h) => {
      g.strokeStyle = 'rgba(230,110,30,0.95)'; g.lineWidth = 34; g.lineCap = 'round'; g.shadowColor = 'rgba(230,110,30,1)'; g.shadowBlur = 8;
      g.beginPath(); g.moveTo(x + w * 0.85, y + h * 0.5); g.lineTo(x + w * 0.18, y + h * 0.5); g.moveTo(x + w * 0.38, y + h * 0.22); g.lineTo(x + w * 0.15, y + h * 0.5); g.lineTo(x + w * 0.38, y + h * 0.78); g.stroke();
    });
    tag('tagMsg', 1536, 1024, 512, 300, (x, y, w, h) => {
      g.fillStyle = 'rgba(235,235,225,0.9)'; g.font = '900 150px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('МСГ', x + w / 2, y + h / 2);
      g.fillStyle = 'rgba(0,0,0,1)'; g.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 4; k++) g.fillRect(x + w * (0.2 + k * 0.2), y, 8, h); // stencil bridges
      g.globalCompositeOperation = 'source-over';
    });
    tag('tagCircle', 0, 1324, 300, 300, (x, y, w, h) => {
      g.strokeStyle = 'rgba(30,30,30,0.85)'; g.lineWidth = 22; g.shadowColor = '#000'; g.shadowBlur = 6;
      g.beginPath(); g.arc(x + w / 2, y + h / 2, w * 0.36, 0, Math.PI * 2); g.moveTo(x + w * 0.24, y + h * 0.76); g.lineTo(x + w * 0.76, y + h * 0.24); g.stroke();
    });
    // --- enamel street signs and house numbers (rows four and five)
    const enamel = (name, x, y, w, h, text, small) => {
      this.region(name, x, y, w, h);
      g.save();
      g.fillStyle = '#1f3f7a'; g.beginPath(); g.roundRect ? g.roundRect(x + 4, y + 4, w - 8, h - 8, 18) : g.rect(x + 4, y + 4, w - 8, h - 8); g.fill();
      g.strokeStyle = '#e8e8e0'; g.lineWidth = 8; g.beginPath(); g.roundRect ? g.roundRect(x + 16, y + 16, w - 32, h - 32, 12) : g.rect(x + 16, y + 16, w - 32, h - 32); g.stroke();
      g.fillStyle = '#f1f0e8'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = (small ? '700 ' : '700 ') + Math.round(h * (small ? 0.62 : 0.5)) + 'px "Arial Narrow", Arial, sans-serif';
      g.fillText(text, x + w / 2, y + h / 2 + 4);
      // chips in the enamel
      for (let k = 0; k < 7; k++) { g.fillStyle = 'rgba(30,25,20,' + (0.5 + rnd() * 0.4) + ')'; g.beginPath(); g.arc(x + 10 + rnd() * (w - 20), y + 10 + rnd() * (h - 20), 3 + rnd() * 8, 0, Math.PI * 2); g.fill(); }
      g.restore();
    };
    enamel('street0', 320, 1324, 860, 200, 'УЛ. ГОГОЛЯ');
    enamel('street1', 1180, 1324, 860, 200, 'ПЛ. СВОБОДЫ');
    enamel('street2', 0, 1640, 860, 200, 'УЛ. ЛЕСНАЯ');
    ['12', '7', '21', '3а', '16', '9'].forEach((n, i) => enamel('num' + i, 880 + (i % 6) * 194, 1640, 186, 186, n, true));
    // a sheet of small paper notices
    for (let i = 0; i < 6; i++) {
      const x = i * 340 + 10, y = 1860, w = 300, h = 180;
      this.region('note' + i, x, y, w, h);
      g.fillStyle = ['#efe9d8', '#e3e8ee', '#f0e2c8'][i % 3]; g.fillRect(x, y, w, h);
      g.fillStyle = '#333'; g.font = '600 24px Arial, sans-serif'; g.textAlign = 'left';
      for (let k = 0; k < 5; k++) g.fillRect(x + 20, y + 30 + k * 28, 120 + rnd() * 140, 6);
      for (let k = 0; k < 8; k++) g.fillRect(x + 20 + k * 34, y + h - 34, 4, 26);
    }
  }

  // A quad for `name`, w x h metres, centred on the matrix origin (face space), facing out.
  add(name, m, w, h, lift = 0.012) {
    const r = this.regions[name];
    if (!r) return;
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(0, 0, lift);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (r.x + uv.getX(i) * r.w) / ATLAS, 1 - (r.y + (1 - uv.getY(i)) * r.h) / ATLAS);
    }
    g.applyMatrix4(m);
    this.quads.push(g);
  }

  build(scene) {
    if (!this.quads.length) return null;
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.05, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
    const geo = this.quads.length === 1 ? this.quads[0] : mergeQuads(this.quads);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'decals';
    scene.add(mesh);
    return mesh;
  }
}

function mergeQuads(list) {
  const pos = [], nrm = [], uv = [];
  for (const g of list) {
    const p = g.attributes.position, q = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < g.index.count; i++) {
      const k = g.index.getX(i);
      pos.push(p.getX(k), p.getY(k), p.getZ(k)); nrm.push(q.getX(k), q.getY(k), q.getZ(k)); uv.push(u.getX(k), u.getY(k));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
