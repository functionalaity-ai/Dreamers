// Loot containers: fridges, kitchen cabinets, dressers, wardrobes, wall medicine cabinets, crates,
// metal lockers and desks. Each is a small dynamic object: its body is one mesh per material (the
// geometry is shared by every container of the kind), its doors, drawers or lid hang on their own
// pivots and swing, slide or lift when open() is called. Bodies have colliders; nothing here casts
// the sun's shadow (they all stand indoors).
//
// Local space: origin on the floor (or, for the wall cabinet, the wall's foot) at the middle of
// the container's back, +z out of the front, x across. `yaw` turns it about y.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedBox, worldUV } from '../../core/geometry.js';

export const KINDS = ['fridge', 'cabinet', 'dresser', 'wardrobe', 'medcab', 'crate', 'locker', 'desk'];

// footprint (w across, d deep), height, collider material, and how far in front of it you stand
export const SIZES = {
  fridge: { w: 0.64, d: 0.66, h: 1.74, phys: 'metal' },
  cabinet: { w: 0.92, d: 0.6, h: 0.92, phys: 'wood' },
  dresser: { w: 1.02, d: 0.5, h: 0.86, phys: 'wood' },
  wardrobe: { w: 1.04, d: 0.6, h: 2.02, phys: 'wood' },
  medcab: { w: 0.5, d: 0.17, h: 0.62, phys: 'metal', wall: 1.25 },
  crate: { w: 1.0, d: 0.62, h: 0.58, phys: 'wood' },
  locker: { w: 0.46, d: 0.5, h: 1.86, phys: 'metal' },
  desk: { w: 1.3, d: 0.7, h: 0.77, phys: 'wood' },
};

// --- materials (made once from the world set) ---------------------------------------------------
function containerMaterials(materials) {
  if (materials._containerMats) return materials._containerMats;
  const W = materials.world;
  const liner = new THREE.MeshStandardMaterial({ color: 0xe9e6de, roughness: 0.45, name: 'fridgeLiner' });
  const lit = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.45, emissive: 0xfff0d2, emissiveIntensity: 0.85, name: 'fridgeLit' });
  const plastic = new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.35, name: 'fridgePlastic' });
  const M = {
    enamel: W.carWhite, paint: W.frameWood, wood: W.woodDark, top: W.woodFloor, chrome: W.chrome, dark: W.darkMetal,
    olive: W.carGreen, galv: W.galvanized, red: W.carRed, rubber: W.rubberDark, liner, lit, plastic, sandbag: W.sandbag,
  };
  materials._containerMats = M;
  return M;
}

// --- geometry helpers ---------------------------------------------------------------------------
// bevelled box between two corners (seg 1 is a chamfer, 2 a rounder edge), UVs in metres
function rb(x0, y0, z0, x1, y1, z1, r = 0.008, seg = 1) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const g = roundedBox(w, h, d, r, seg);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return worldUV(g);
}
function bx(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return worldUV(g);
}
function cyl(r, h, x, y, z, axis = 'y', seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return worldUV(g);
}
// a bar handle standing off the face (vertical when len runs along y)
function barHandle(x, y, z, len, vertical = true) {
  const parts = [];
  const r = 0.011;
  if (vertical) {
    parts.push(cyl(r, len, x, y, z + 0.035));
    for (const s of [-1, 1]) parts.push(cyl(0.008, 0.035, x, y + s * (len / 2 - 0.02), z + 0.017, 'z', 6));
  } else {
    parts.push(cyl(r, len, x, y, z + 0.035, 'x'));
    for (const s of [-1, 1]) parts.push(cyl(0.008, 0.035, x + s * (len / 2 - 0.02), y, z + 0.017, 'z', 6));
  }
  return parts;
}
function knob(x, y, z) { const g = new THREE.SphereGeometry(0.018, 10, 6); g.scale(1, 1, 0.7); g.translate(x, y, z + 0.012); return worldUV(g); }

// A part: { kind: 'door'|'drawer'|'lid', pivot: [x, y, z], max (rad or m), sign, geos: { mat: [geo] } }
function part(kind, pivot, max, sign = 1) { return { kind, pivot, max, sign, geos: {} }; }
function add(map, mat, ...geos) { (map[mat] || (map[mat] = [])).push(...geos.flat()); }
// geometry given in local space; a part's own geometry is stored relative to its pivot
function addPart(p, mat, ...geos) { for (const g of geos.flat()) { g.translate(-p.pivot[0], -p.pivot[1], -p.pivot[2]); add(p.geos, mat, g); } }

// --- the designs --------------------------------------------------------------------------------
const DESIGNS = {
  fridge() {
    const { w, d, h } = SIZES.fridge, t = 0.035, body = {}, parts = [], light = {};
    const x0 = -w / 2, x1 = w / 2, zb = 0, zf = d - 0.05;
    // cabinet shell: sides, top, bottom, back, a toe kick
    add(body, 'enamel', rb(x0, 0.06, zb, x0 + t, h, zf, 0.012, 2), rb(x1 - t, 0.06, zb, x1, h, zf, 0.012, 2));
    add(body, 'enamel', rb(x0, h - t, zb, x1, h, zf, 0.012, 2), rb(x0 + t, 0.06, zb, x1 - t, 0.06 + t, zf, 0.006));
    add(body, 'enamel', bx(x0 + t, 0.06, zb, x1 - t, h - t, zb + 0.02));
    add(body, 'dark', bx(x0 + 0.03, 0, zb + 0.04, x1 - 0.03, 0.06, zf - 0.04));
    add(body, 'chrome', bx(x0 + 0.05, 0.012, zf - 0.045, x1 - 0.05, 0.05, zf - 0.04));
    // freezer divider, liner, wire shelves, a crisper drawer
    const yDiv = h - 0.47;
    add(body, 'enamel', bx(x0 + t, yDiv - 0.03, zb + 0.02, x1 - t, yDiv + 0.03, zf - 0.01));
    add(light, 'liner', bx(x0 + t, 0.06 + t, zb + 0.02, x1 - t, yDiv - 0.03, zb + 0.03), bx(x0 + t, 0.06 + t, zb + 0.02, x0 + t + 0.005, yDiv - 0.03, zf - 0.02), bx(x1 - t - 0.005, 0.06 + t, zb + 0.02, x1 - t, yDiv - 0.03, zf - 0.02));
    for (const y of [0.42, 0.72, 1.0]) for (let k = 0; k < 7; k++) add(body, 'galv', cyl(0.004, w - 2 * t, 0, y, zb + 0.07 + k * 0.075, 'x', 5));
    add(body, 'plastic', rb(x0 + t + 0.02, 0.1, zb + 0.06, x1 - t - 0.02, 0.32, zf - 0.06, 0.01));
    add(light, 'liner', bx(-0.06, yDiv - 0.07, zb + 0.03, 0.06, yDiv - 0.03, zb + 0.12));
    // doors hinged on the right edge, swinging out to the right
    for (const [ya, yb, max] of [[0.07, yDiv - 0.015, 1.85], [yDiv + 0.015, h - 0.01, 1.7]]) {
      const p = part('door', [x1, 0, zf], max, 1);
      addPart(p, 'enamel', rb(x0, ya, zf, x1, yb, zf + 0.05, 0.018, 2));
      addPart(p, 'rubber', bx(x0 + 0.02, ya + 0.02, zf - 0.006, x1 - 0.02, yb - 0.02, zf));
      addPart(p, 'liner', bx(x0 + 0.04, ya + 0.04, zf - 0.035, x1 - 0.04, yb - 0.04, zf - 0.006));
      // door bins
      for (let y = ya + 0.2; y < yb - 0.15; y += 0.32) addPart(p, 'plastic', bx(x0 + 0.06, y, zf - 0.11, x1 - 0.06, y + 0.012, zf - 0.035), bx(x0 + 0.06, y, zf - 0.112, x1 - 0.06, y + 0.07, zf - 0.105));
      addPart(p, 'chrome', barHandle(x0 + 0.06, (ya + yb) / 2 + (max > 1.8 ? 0.25 : -0.05), zf + 0.05, max > 1.8 ? 0.36 : 0.18));
      parts.push(p);
    }
    return { body, parts, light };
  },

  cabinet() {
    const { w, d, h } = SIZES.cabinet, body = {}, parts = [];
    const x0 = -w / 2, x1 = w / 2, zf = d - 0.04;
    add(body, 'paint', rb(x0, 0.09, 0, x0 + 0.018, h - 0.04, zf, 0.004), rb(x1 - 0.018, 0.09, 0, x1, h - 0.04, zf, 0.004));
    add(body, 'paint', bx(x0 + 0.018, 0.09, 0, x1 - 0.018, 0.108, zf), bx(x0 + 0.018, 0.09, 0, x1 - 0.018, h - 0.04, 0.012), bx(x0 + 0.018, 0.45, 0.012, x1 - 0.018, 0.466, zf - 0.02));
    add(body, 'dark', bx(x0 + 0.02, 0, 0.04, x1 - 0.02, 0.09, zf - 0.05));
    add(body, 'top', rb(x0 - 0.01, h - 0.04, -0.005, x1 + 0.01, h, d + 0.015, 0.006, 2));
    // contents: a few tins and jars
    for (let i = 0; i < 4; i++) add(body, i % 2 ? 'galv' : 'red', cyl(0.035, 0.11, x0 + 0.15 + i * 0.2, 0.163, 0.2 + (i % 2) * 0.12));
    // drawer front over two doors
    const yD = h - 0.2;
    const dr = part('drawer', [0, 0, zf], 0.32, 1);
    addPart(dr, 'paint', rb(x0 + 0.004, yD, zf, x1 - 0.004, h - 0.045, zf + 0.022, 0.005, 2), bx(x0 + 0.04, yD + 0.02, 0.06, x1 - 0.04, yD + 0.035, zf), bx(x0 + 0.04, yD + 0.02, 0.06, x0 + 0.055, h - 0.07, zf), bx(x1 - 0.055, yD + 0.02, 0.06, x1 - 0.04, h - 0.07, zf));
    addPart(dr, 'chrome', barHandle(0, (yD + h - 0.045) / 2, zf + 0.022, 0.16, false));
    add(body, 'paint', bx(x0 + 0.018, yD - 0.012, 0.012, x1 - 0.018, yD, zf));
    parts.push(dr);
    for (const s of [-1, 1]) {
      const hx = s < 0 ? x0 : x1;
      const p = part('door', [hx, 0, zf], 1.75, s);
      const a0 = s < 0 ? x0 + 0.004 : 0.003, a1 = s < 0 ? -0.003 : x1 - 0.004;
      addPart(p, 'paint', rb(a0, 0.112, zf, a1, yD - 0.015, zf + 0.022, 0.005, 2));
      addPart(p, 'paint', bx(a0 + 0.05, 0.16, zf + 0.022, a1 - 0.05, 0.17, zf + 0.03), bx(a0 + 0.05, yD - 0.075, zf + 0.022, a1 - 0.05, yD - 0.065, zf + 0.03));
      addPart(p, 'chrome', barHandle(s < 0 ? a1 - 0.04 : a0 + 0.04, yD - 0.13, zf + 0.022, 0.12));
      parts.push(p);
    }
    return { body, parts };
  },

  dresser() {
    const { w, d, h } = SIZES.dresser, body = {}, parts = [];
    const x0 = -w / 2, x1 = w / 2, zf = d - 0.03;
    add(body, 'wood', rb(x0, 0.08, 0, x0 + 0.022, h - 0.03, zf, 0.004), rb(x1 - 0.022, 0.08, 0, x1, h - 0.03, zf, 0.004), bx(x0 + 0.022, 0.08, 0, x1 - 0.022, h - 0.03, 0.012));
    add(body, 'top', rb(x0 - 0.02, h - 0.03, -0.01, x1 + 0.02, h, d + 0.01, 0.008, 2));
    // turned feet and a plinth rail
    for (const fx of [x0 + 0.05, x1 - 0.05]) for (const fz of [0.05, zf - 0.04]) add(body, 'wood', cyl(0.028, 0.08, fx, 0.04, fz, 'y', 8));
    add(body, 'wood', bx(x0 + 0.01, 0.08, zf - 0.02, x1 - 0.01, 0.11, zf));
    const n = 3, yA = 0.11, yB = h - 0.035, hh = (yB - yA) / n;
    for (let i = 0; i < n; i++) {
      const y0 = yA + i * hh + 0.006, y1 = yA + (i + 1) * hh - 0.006;
      add(body, 'wood', bx(x0 + 0.022, y0 - 0.006, 0.012, x1 - 0.022, y0, zf));
      const p = part('drawer', [0, 0, zf], 0.3 + 0.03 * (n - i), 1);
      addPart(p, 'wood', rb(x0 + 0.026, y0, zf, x1 - 0.026, y1, zf + 0.024, 0.006, 2), bx(x0 + 0.05, y0 + 0.01, 0.04, x1 - 0.05, y0 + 0.024, zf), bx(x0 + 0.05, y0 + 0.01, 0.04, x0 + 0.064, y1 - 0.03, zf), bx(x1 - 0.064, y0 + 0.01, 0.04, x1 - 0.05, y1 - 0.03, zf), bx(x0 + 0.05, y0 + 0.01, 0.04, x1 - 0.05, y1 - 0.03, 0.054));
      addPart(p, 'chrome', knob(x0 + 0.24, (y0 + y1) / 2, zf + 0.024), knob(x1 - 0.24, (y0 + y1) / 2, zf + 0.024));
      parts.push(p);
    }
    return { body, parts };
  },

  wardrobe() {
    const { w, d, h } = SIZES.wardrobe, body = {}, parts = [];
    const x0 = -w / 2, x1 = w / 2, zf = d - 0.04;
    add(body, 'wood', rb(x0, 0.06, 0, x0 + 0.024, h - 0.06, zf, 0.004), rb(x1 - 0.024, 0.06, 0, x1, h - 0.06, zf, 0.004), bx(x0 + 0.024, 0.06, 0, x1 - 0.024, h - 0.06, 0.014));
    add(body, 'wood', bx(x0 + 0.024, 0.06, 0, x1 - 0.024, 0.09, zf), rb(x0 - 0.025, h - 0.06, -0.01, x1 + 0.025, h, d + 0.01, 0.01, 2), bx(x0 + 0.01, 0, 0.03, x1 - 0.01, 0.06, zf - 0.02));
    add(body, 'chrome', cyl(0.012, w - 0.06, 0, h - 0.3, d / 2, 'x', 8));
    // a couple of coats on hangers
    for (const cx of [-0.22, 0.12]) { add(body, 'sandbag', rb(cx - 0.06, h - 1.25, d / 2 - 0.2, cx + 0.06, h - 0.34, d / 2 + 0.2, 0.04, 2)); add(body, 'dark', bx(cx - 0.004, h - 0.34, d / 2 - 0.004, cx + 0.004, h - 0.29, d / 2 + 0.004)); }
    for (const s of [-1, 1]) {
      const hx = s < 0 ? x0 : x1;
      const p = part('door', [hx, 0, zf], 1.7, s);
      const a0 = s < 0 ? x0 + 0.004 : 0.003, a1 = s < 0 ? -0.003 : x1 - 0.004;
      addPart(p, 'wood', rb(a0, 0.095, zf, a1, h - 0.065, zf + 0.026, 0.006, 2));
      // raised panels
      for (const [pa, pb] of [[0.2, 1.05], [1.15, h - 0.2]]) addPart(p, 'wood', rb(a0 + 0.06, pa, zf + 0.026, a1 - 0.06, pb, zf + 0.04, 0.008, 1));
      addPart(p, 'chrome', knob(s < 0 ? a1 - 0.05 : a0 + 0.05, 1.1, zf + 0.026));
      parts.push(p);
    }
    return { body, parts };
  },

  medcab() {
    const { w, d, h } = SIZES.medcab, body = {}, parts = [];
    const x0 = -w / 2, x1 = w / 2, y0 = SIZES.medcab.wall, y1 = y0 + h, zf = d - 0.025;
    add(body, 'enamel', rb(x0, y0, 0, x0 + 0.014, y1, zf, 0.004), rb(x1 - 0.014, y0, 0, x1, y1, zf, 0.004));
    add(body, 'enamel', rb(x0, y1 - 0.014, 0, x1, y1, zf, 0.004), rb(x0, y0, 0, x1, y0 + 0.014, zf, 0.004), bx(x0 + 0.014, y0, 0, x1 - 0.014, y1, 0.008));
    add(body, 'liner', bx(x0 + 0.014, y0 + 0.24, 0.008, x1 - 0.014, y0 + 0.248, zf - 0.01), bx(x0 + 0.014, y0 + 0.43, 0.008, x1 - 0.014, y0 + 0.438, zf - 0.01));
    for (let i = 0; i < 3; i++) add(body, i === 1 ? 'red' : 'plastic', cyl(0.022, 0.09, x0 + 0.1 + i * 0.13, y0 + 0.293, 0.06));
    const p = part('door', [x0, 0, zf], 1.6, -1);
    addPart(p, 'enamel', rb(x0 + 0.002, y0 + 0.002, zf, x1 - 0.002, y1 - 0.002, zf + 0.022, 0.006, 2));
    // the red cross
    const cy = y0 + h * 0.56;
    addPart(p, 'red', bx(-0.03, cy - 0.1, zf + 0.022, 0.03, cy + 0.1, zf + 0.026), bx(-0.1, cy - 0.03, zf + 0.022, 0.1, cy + 0.03, zf + 0.026));
    addPart(p, 'chrome', knob(x1 - 0.04, y0 + h * 0.5, zf + 0.022));
    parts.push(p);
    return { body, parts };
  },

  crate() {
    const { w, d, h } = SIZES.crate, body = {}, parts = [];
    const x0 = -w / 2, x1 = w / 2, hl = h - 0.07;
    // olive military box: walls with ribs, rope handles; the lid hinges at the back
    add(body, 'olive', rb(x0, 0, 0, x1, 0.03, d, 0.006), rb(x0, 0.03, 0, x0 + 0.025, hl, d, 0.004), rb(x1 - 0.025, 0.03, 0, x1, hl, d, 0.004));
    add(body, 'olive', rb(x0 + 0.025, 0.03, 0, x1 - 0.025, hl, 0.025, 0.004), rb(x0 + 0.025, 0.03, d - 0.025, x1 - 0.025, hl, d, 0.004));
    for (const y of [0.1, hl - 0.06]) add(body, 'olive', rb(x0 - 0.015, y, -0.015, x1 + 0.015, y + 0.05, d + 0.015, 0.006));
    for (const s of [-1, 1]) add(body, 'rubber', cyl(0.012, 0.16, s * (w / 2 + 0.02), hl - 0.16, d / 2, 'z', 6));
    // packed inside: ammo tins
    for (let i = 0; i < 3; i++) add(body, 'olive', rb(x0 + 0.08 + i * 0.29, 0.03, 0.1, x0 + 0.33 + i * 0.29, 0.3, d - 0.1, 0.01));
    const p = part('lid', [0, hl, 0], 1.75, 1);
    addPart(p, 'olive', rb(x0 - 0.01, hl, -0.01, x1 + 0.01, h, d + 0.01, 0.01, 2), rb(x0 + 0.06, h, 0.06, x1 - 0.06, h + 0.012, d - 0.06, 0.004));
    for (const s of [-1, 1]) addPart(p, 'dark', bx(s * 0.3 - 0.04, hl - 0.06, d + 0.01, s * 0.3 + 0.04, hl + 0.03, d + 0.025));
    // stencil band
    addPart(p, 'paint', bx(-0.22, h, d / 2 - 0.05, 0.22, h + 0.014, d / 2 + 0.05));
    parts.push(p);
    return { body, parts };
  },

  locker() {
    const { w, d, h } = SIZES.locker, body = {}, parts = [];
    const x0 = -w / 2, x1 = w / 2, zf = d - 0.025;
    add(body, 'galv', rb(x0, 0.08, 0, x0 + 0.012, h, zf, 0.003), rb(x1 - 0.012, 0.08, 0, x1, h, zf, 0.003), rb(x0, h - 0.012, 0, x1, h, zf, 0.003));
    add(body, 'galv', bx(x0 + 0.012, 0.08, 0, x1 - 0.012, h, 0.01), bx(x0 + 0.012, 0.08, 0, x1 - 0.012, 0.1, zf), bx(x0 + 0.012, h - 0.36, 0.01, x1 - 0.012, h - 0.35, zf));
    add(body, 'dark', bx(x0 + 0.01, 0, 0.02, x1 - 0.01, 0.08, zf - 0.02));
    add(body, 'chrome', cyl(0.008, w - 0.03, 0, h - 0.45, d / 2, 'x', 6));
    add(body, 'olive', rb(x0 + 0.05, 0.1, 0.05, x1 - 0.05, 0.55, zf - 0.08, 0.02, 2));
    const p = part('door', [x0, 0, zf], 1.9, -1);
    addPart(p, 'olive', rb(x0 + 0.002, 0.1, zf, x1 - 0.002, h - 0.002, zf + 0.02, 0.004, 2));
    // vent slots, top and bottom
    for (const yb of [h - 0.3, 0.25]) for (let k = 0; k < 5; k++) addPart(p, 'dark', bx(x0 + 0.1, yb + k * 0.028, zf + 0.02, x1 - 0.1, yb + k * 0.028 + 0.009, zf + 0.023));
    addPart(p, 'chrome', bx(x1 - 0.07, 1.0, zf + 0.02, x1 - 0.04, 1.12, zf + 0.04), knob(x1 - 0.055, 0.95, zf + 0.02));
    // a name card
    addPart(p, 'paint', bx(-0.08, h - 0.45, zf + 0.02, 0.08, h - 0.4, zf + 0.023));
    parts.push(p);
    return { body, parts };
  },

  desk() {
    const { w, d, h } = SIZES.desk, body = {}, parts = [];
    const x0 = -w / 2, x1 = w / 2, top = h - 0.035;
    add(body, 'top', rb(x0, top, 0, x1, h, d, 0.008, 2));
    // a modesty panel and two legs on the left, a drawer pedestal on the right
    add(body, 'wood', bx(x0 + 0.04, 0.25, 0.03, x1 - 0.42, top, 0.05));
    for (const z of [0.05, d - 0.06]) add(body, 'wood', rb(x0 + 0.03, 0, z - 0.025, x0 + 0.08, top, z + 0.025, 0.006));
    const px0 = x1 - 0.42, px1 = x1 - 0.02, zf = d - 0.03;
    add(body, 'wood', rb(px0, 0, 0.02, px0 + 0.02, top, zf, 0.004), rb(px1 - 0.02, 0, 0.02, px1, top, zf, 0.004), bx(px0 + 0.02, 0, 0.02, px1 - 0.02, top, 0.04), bx(px0 + 0.02, 0, 0.02, px1 - 0.02, 0.06, zf));
    // papers, a lamp
    add(body, 'paint', bx(x0 + 0.2, h, 0.25, x0 + 0.5, h + 0.02, 0.47));
    add(body, 'dark', cyl(0.07, 0.02, x0 + 0.12, h + 0.01, 0.15), cyl(0.008, 0.36, x0 + 0.12, h + 0.19, 0.15, 'y', 6), cyl(0.06, 0.1, x0 + 0.12, h + 0.38, 0.24, 'z', 10));
    for (let i = 0; i < 2; i++) {
      const y0 = 0.07 + i * 0.32, y1 = y0 + 0.3;
      const p = part('drawer', [0, 0, zf], 0.36, 1);
      addPart(p, 'wood', rb(px0 + 0.024, y0, zf, px1 - 0.024, y1, zf + 0.022, 0.005, 2), bx(px0 + 0.04, y0 + 0.01, 0.08, px1 - 0.04, y0 + 0.024, zf), bx(px0 + 0.04, y0 + 0.01, 0.08, px0 + 0.054, y1 - 0.04, zf), bx(px1 - 0.054, y0 + 0.01, 0.08, px1 - 0.04, y1 - 0.04, zf));
      addPart(p, 'chrome', barHandle((px0 + px1) / 2, y1 - 0.06, zf + 0.022, 0.12, false));
      parts.push(p);
    }
    return { body, parts };
  },
};

// Merged, shared geometry per kind: { body: [[mat, geo]], parts: [{ ..., meshes: [[mat, geo]] }] }
const TEMPLATES = new Map();
function merged(map, M) {
  const out = [];
  for (const k in map) {
    const geos = map[k].map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(a)) n.deleteAttribute(a); return n; });
    const g = mergeGeometries(geos, false);
    g.computeBoundingSphere();
    out.push([M[k], g]);
  }
  return out;
}
function template(kind, M) {
  if (TEMPLATES.has(kind)) return TEMPLATES.get(kind);
  const d = DESIGNS[kind]();
  const t = { body: merged(d.body, M), light: d.light ? merged(d.light, M) : null, parts: d.parts.map((p) => Object.assign({}, p, { meshes: merged(p.geos, M) })) };
  TEMPLATES.set(kind, t);
  return t;
}

const ease = (t) => { const k = Math.min(1, Math.max(0, t)); return 1 - (1 - k) * (1 - k) * (1 - k); };

let nextId = 1;
export class Container {
  constructor(kind, x, y, z, yaw, tier, M) {
    this.id = nextId++;
    this.kind = kind;
    this.yaw = yaw;
    this.tier = tier;
    this.opened = false;
    this.t = 0;
    const S = SIZES[kind];
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // where you stand to open it: on the floor in front
    this.pos = new THREE.Vector3(x + fx * (S.d + 0.45), y, z + fz * (S.d + 0.45));
    const T = template(kind, M);
    const g = new THREE.Group();
    g.name = 'container:' + kind;
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    const mesh = (mat, geo) => { const m = new THREE.Mesh(geo, mat); m.castShadow = false; m.receiveShadow = true; return m; };
    for (const [mat, geo] of T.body) g.add(mesh(mat, geo));
    this.light = null;
    if (T.light) {
      this.light = T.light.map(([mat, geo]) => mesh(mat, geo));
      for (const m of this.light) g.add(m);
      this.M = M;
    }
    this.parts = T.parts.map((p) => {
      const pivot = new THREE.Group();
      pivot.position.set(p.pivot[0], p.pivot[1], p.pivot[2]);
      for (const [mat, geo] of p.meshes) pivot.add(mesh(mat, geo));
      g.add(pivot);
      return { kind: p.kind, max: p.max, sign: p.sign, o: pivot, base: pivot.position.z };
    });
    this.object = g;
    g.userData.container = this;
  }

  // Starts the doors (drawers, lid) moving; returns false if it was already open.
  open() {
    if (this.opened) return false;
    this.opened = true;
    this.t = 0;
    if (this.light) for (const m of this.light) m.material = this.M.lit;
    return true;
  }

  // Advances the opening animation; true while it is still moving.
  step(dt) {
    if (!this.opened || this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / 0.55);
    this.parts.forEach((p, i) => {
      // drawers run out one after another, doors a little staggered
      const k = ease(this.t * (1 + i * 0.25) - i * 0.12);
      if (p.kind === 'door') p.o.rotation.y = p.sign * k * p.max;
      else if (p.kind === 'lid') p.o.rotation.x = -k * p.max;
      else p.o.position.z = p.base + k * p.max;
    });
    return this.t < 1;
  }
}

// Places containers and owns their animation. physics gets one collider per container.
export class ContainerSet {
  constructor(physics, materials) {
    this.ph = physics;
    this.M = containerMaterials(materials);
    this.list = [];
    this.moving = new Set();
  }

  // x, z: the middle of the container's back, against a wall; yaw: 0 faces +z, π/2 faces +x ...
  add(kind, x, y, z, yaw, tier) {
    const c = new Container(kind, x, y, z, yaw, tier, this.M);
    const S = SIZES[kind];
    // collider: the body's footprint, turned with it (yaw is a quarter turn here)
    const q = Math.round(yaw / (Math.PI / 2)) & 3;
    const fx = [0, 1, 0, -1][q], fz = [1, 0, -1, 0][q];
    const cx = x + fx * S.d / 2, cz = z + fz * S.d / 2;
    const hw = (fx ? S.d : S.w) / 2, hd = (fx ? S.w : S.d) / 2;
    const y0 = y + (S.wall || 0);
    this.ph.add(cx - hw, y0, cz - hd, cx + hw, y0 + S.h, cz + hd, S.phys, { container: true });
    const open = c.open.bind(c);
    c.open = () => { const ok = open(); if (ok) this.moving.add(c); return ok; };
    this.list.push(c);
    return c;
  }

  update(dt) {
    for (const c of this.moving) if (!c.step(dt)) this.moving.delete(c);
  }
}
