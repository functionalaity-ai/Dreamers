// Weapon silhouettes for the HUD (kill feed and weapon panel): each gun is drawn side-on through an
// orthographic camera, then turned into a clean white shape with soft inner edges and a
// transparent background. The render goes to the hidden game canvas and is copied out with
// drawImage (no pixel read-back from WebGL); it carries the view-space normal in red and green and
// coverage in blue, so one pass gives both the mask and the edge shading.
import * as THREE from 'three';
import { buildGun } from '../weapons/gunmodels.js';
import { WEAPONS } from '../config.js';

// Generic icons use a typical fit; the player's own guns are redrawn with their loadout.
const TYPICAL = { kestrel: { optic: 'reddot' }, warden: {}, bastion: {} };
const OUT_H = 120;  // icon height in pixels (CSS scales it down)
const SS = 2;       // supersampling for the render

const NORMAL_MAT = new THREE.ShaderMaterial({
  vertexShader: 'varying vec3 vN; void main() { vN = normalMatrix * normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'varying vec3 vN; void main() { vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0); gl_FragColor = vec4(n.xy * 0.5 + 0.5, 1.0, 1.0); }',
  side: THREE.DoubleSide,
});

const NAMES = {};
for (const k in WEAPONS) NAMES[WEAPONS[k].name.toLowerCase()] = k;

// A stable key for a gun's shape: its id and the attachments that change the outline.
function keyOf(id, att) {
  const a = att || {};
  return id + ':' + Object.keys(a).filter((k) => k !== 'finish' && a[k]).sort().map((k) => k + '=' + a[k]).join(',');
}

export class GunIcons {
  constructor(R, mats) {
    this.R = R;
    this.mats = mats;
    this.cache = new Map();
    this.generic = {};
    for (const id in TYPICAL) this.generic[id] = this.render(id, TYPICAL[id]);
    this.frag = drawFrag();
  }

  // The icon for a gun with these attachments (drawn on first use).
  render(id, att) {
    const key = keyOf(id, att);
    if (this.cache.has(key)) return this.cache.get(key);
    let icon = null;
    try { icon = drawGun(this.R.r, buildGun(id, att || {}, this.mats.gun, { fp: true })); } catch (e) { console.warn('weapon icon skipped:', e); }
    if (icon) icon.name = WEAPONS[id].name;
    this.cache.set(key, icon);
    return icon;
  }

  // The icon for a weapon as it travels in hit info (resolved stats, or { name } for a grenade).
  forWeapon(w, explosive) {
    if (!w && !explosive) return null;
    const name = (w && w.name) || '';
    if (explosive || /frag|grenade/i.test(name)) return this.frag;
    const id = (w.id && WEAPONS[w.id]) ? w.id : NAMES[name.toLowerCase()];
    if (!id) return null;
    return (w.att && this.cache.get(keyOf(id, w.att))) || this.generic[id] || null;
  }
}

// Draw a gun side-on (right side, muzzle to the right) into an icon { url, w, h }.
function drawGun(r, gun) {
  const root = gun.root;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material.transparent) { o.visible = false; return; } // lenses and markings
    if (o.visible) box.expandByObject(o);
  });
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const pad = 1.04, hw = size.z / 2 * pad, hh = size.y / 2 * pad;
  const h = OUT_H, w = Math.max(16, Math.round(OUT_H * hw / hh));
  const W = w * SS, H = h * SS;
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.01, 10);
  cam.position.set(c.x + 2, c.y, c.z);
  cam.lookAt(c.x, c.y, c.z);
  const scene = new THREE.Scene();
  scene.overrideMaterial = NORMAL_MAT;
  scene.add(root);
  // render into the game canvas at icon size, copy it out, then put everything back
  const prev = { size: r.getSize(new THREE.Vector2()), ratio: r.getPixelRatio(), target: r.getRenderTarget(), clear: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), autoClear: r.autoClear };
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g2 = cv.getContext('2d', { willReadFrequently: true });
  try {
    r.setPixelRatio(1);
    r.setSize(W, H, false);
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    r.autoClear = true;
    r.render(scene, cam);
    g2.drawImage(r.domElement, 0, 0, W, H);
  } finally {
    r.setClearColor(prev.clear, prev.alpha);
    r.autoClear = prev.autoClear;
    r.setPixelRatio(prev.ratio);
    r.setSize(prev.size.x, prev.size.y, false);
    r.setRenderTarget(prev.target);
    root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  return finish(g2.getImageData(0, 0, W, H), w, h);
}

// Normals + coverage → white silhouette: faces lit softly from the upper left, darker where the
// normal turns sharply (part edges, bevels), alpha from the supersampled coverage.
function finish(img, w, h) {
  const W = img.width, H = img.height, src = img.data;
  const nx = new Float32Array(W * H), ny = new Float32Array(W * H), m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    m[i] = src[i * 4 + 2] > 127 ? 1 : 0;
    nx[i] = src[i * 4] / 127.5 - 1; ny[i] = src[i * 4 + 1] / 127.5 - 1;
  }
  const L = [-0.35, 0.62, 0.7];
  const shade = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!m[i]) continue;
    const a = nx[i], b = ny[i], cz = Math.sqrt(Math.max(0, 1 - a * a - b * b));
    let edge = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const j = Y * W + X;
      if (m[j]) edge = Math.max(edge, Math.hypot(nx[j] - a, ny[j] - b));
    }
    const lit = Math.max(0, a * L[0] + b * L[1] + cz * L[2]);
    const e = Math.min(1, Math.max(0, (edge - 0.1) / 0.45));
    shade[i] = (0.84 + 0.16 * lit) * (1 - 0.42 * e);
  }
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d');
  const o = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let cov = 0, s = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const i = (y * SS + sy) * W + x * SS + sx;
      if (m[i]) { cov++; s += shade[i]; }
    }
    const k = (y * w + x) * 4, v = cov ? Math.round(255 * s / cov) : 255;
    o.data[k] = v; o.data[k + 1] = v; o.data[k + 2] = v; o.data[k + 3] = Math.round(255 * cov / (SS * SS));
  }
  g.putImageData(o, 0, 0);
  return { url: out.toDataURL('image/png'), w, h };
}

// The frag grenade: an M67-style body with its fuze, spoon and pin ring, drawn with canvas paths.
function drawFrag() {
  const w = 96, h = OUT_H, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = g.lineJoin = 'round';
  // the body, the tapered fuze and its cap
  g.beginPath(); g.arc(44, 80, 34, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(31, 52); g.lineTo(35, 30); g.lineTo(53, 30); g.lineTo(57, 52); g.closePath(); g.fill();
  g.fillRect(31, 21, 26, 11);
  // the spoon, hugging the body's right side
  g.beginPath();
  g.moveTo(50, 21); g.quadraticCurveTo(77, 21, 83, 46); g.quadraticCurveTo(87, 72, 81, 105); g.lineTo(72, 104);
  g.quadraticCurveTo(77, 72, 73, 49); g.quadraticCurveTo(68, 32, 50, 32); g.closePath(); g.fill();
  // the pin ring
  g.lineWidth = 6;
  g.beginPath(); g.arc(16, 27, 10.5, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(26, 27); g.lineTo(32, 27); g.stroke();
  // soft shading and inner edges, only on what is already drawn
  g.globalCompositeOperation = 'source-atop';
  const rg = g.createRadialGradient(32, 64, 4, 44, 80, 42);
  rg.addColorStop(0, 'rgba(0, 0, 0, 0)');
  rg.addColorStop(1, 'rgba(0, 0, 0, 0.24)');
  g.fillStyle = rg;
  g.beginPath(); g.arc(44, 80, 34, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(0, 0, 0, 0.42)';
  g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(71, 104); g.quadraticCurveTo(76, 72, 72, 49); g.quadraticCurveTo(67, 33, 50, 33); g.stroke(); // spoon on the body
  g.beginPath(); g.moveTo(31, 52.5); g.lineTo(57, 52.5); g.moveTo(31, 32.5); g.lineTo(52, 32.5); g.stroke();           // fuze collar and cap
  return { url: c.toDataURL('image/png'), w, h, name: 'Frag grenade' };
}
