// Old Town: the vertical-slice map. x runs west→east, z runs north→south.
//
//   z -42 ┌───────── facades ─────────┬─ alley ─┬──── church ────┐
//         │  NW block   │ gap │ HOTEL MERIDIAN │ gap │ NE block    │
//   z -22 ├─────────── north sidewalk / north street ─────────────┤  lane 1
//   z -13 │ MSG spawn │ west avenue │  PLAZA + fountain │ east │ VOLK│  lane 2
//   z  13 ├─────────── south street / south sidewalk ─────────────┤  lane 3
//   z  22 │  SW block   │ gap │ PHARMACY (roof) │ gap │ SE block  │
//   z  42 └───────────────── facades ─────────────────────────────┘
import * as THREE from 'three';
import { Builder, building } from './builder.js';
import * as P from './props.js';

export const BOUNDS = { minX: -60, minZ: -46, maxX: 60, maxZ: 46 };

export function buildOldTown(physics, materials, scene) {
  const B = new Builder(physics, materials);

  // --- Ground surfaces (visual; the physics ground is y = 0) ---------------------
  B.solid(-52, -0.05, -13, 52, 0.0, 13, 'cobble', null, { shadow: false });
  B.solid(-52, -0.05, -20, 52, 0.0, -13, 'asphalt', null, { shadow: false });
  B.solid(-52, -0.05, 13, 52, 0.0, 20, 'asphalt', null, { shadow: false });
  B.solid(-52, -0.05, -42, 52, 0.0, -20, 'concrete', null, { shadow: false });
  B.solid(-52, -0.05, 20, 52, 0.0, 42, 'concrete', null, { shadow: false });
  // Raised sidewalks with curbs (step-able), skipping the building fronts.
  const walk = (x0, x1, z0, z1) => B.solid(x0, 0, z0, x1, 0.13, z1, 'sidewalk', 'concrete');
  walk(-52, -10, -22, -20); walk(10, 52, -22, -20); walk(-10, 10, -21.5, -20);
  walk(-52, -6, 20, 22); walk(8, 52, 20, 22); walk(-6, 8, 20, 22);
  // Road markings
  for (let x = -48; x < 48; x += 4.5) {
    B.solid(x, 0.0, -16.6, x + 2.4, 0.012, -16.45, 'trim', null, { shadow: false });
    B.solid(x, 0.0, 16.45, x + 2.4, 0.012, 16.6, 'trim', null, { shadow: false });
  }
  // Pedestrian crossings into the plaza
  for (const zc of [-16.5, 16.5]) for (let i = 0; i < 7; i++) B.solid(-3.2 + i * 0.95, 0, zc - 2.4, -2.7 + i * 0.95, 0.012, zc + 2.4, 'trim', null, { shadow: false });

  // --- Perimeter facade blocks -------------------------------------------------------
  const blocks = [
    // north row
    [-52, -42, -38, -22, 17, 'facadeC'], [-38, -42, -24, -22, 13.6, 'facadeA'], [-24, -42, -12, -22, 10.2, 'facadeB'],
    [-12, -42, 12, -34, 13.6, 'facadeC'],
    [12, -42, 20, -22, 10.2, 'facadeA'], [20, -42, 38, -38, 10.2, 'facadeB'], [38, -42, 52, -22, 13.6, 'facadeB'],
    // south row
    [-52, 22, -36, 42, 13.6, 'facadeB'], [-36, 22, -20, 42, 17, 'facadeC'], [-20, 22, -8, 42, 10.2, 'facadeA'],
    [-8, 33.5, 10, 42, 13.6, 'facadeB'],
    [10, 22, 24, 42, 10.2, 'facadeC'], [24, 22, 38, 42, 13.6, 'facadeA'], [38, 22, 52, 42, 17, 'facadeB'],
    // ends
    [-60, -22, -52, 22, 13.6, 'facadeA'], [52, -22, 60, 22, 13.6, 'facadeC'],
  ];
  for (const b of blocks) facadeBlock(B, b[0], b[1], b[2], b[3], b[4], b[5]);
  church(B);
  // Churchyard between the nave and the street
  B.solid(20, 0, -26, 38, 0.13, -22, 'cobble', 'concrete');
  P.tree(B, 31, -24, true, 0.9);
  P.rubble(B, 25.5, -23.5, 1.2, 0.13);

  // --- Hotel Meridian (3 storeys, enterable) ----------------------------------------
  const H = 3.4;
  building(B, {
    x0: -10, x1: 10, z0: -31.5, z1: -21.5, floors: 3, H,
    mats: ['plasterOchre', 'plasterCream'], base: 'concrete', trim: 'trim',
    doors: [{ side: 's', c: 0, w: 2.4, h: 2.6 }, { side: 'n', c: -5, w: 1.2 }, { side: 'e', c: -28, w: 1.2 }],
    windowSpacing: 2.9,
    stair: { x: -9.6, z: -29.6 },
    inner: [
      { axis: 'x', at: -27, from: -6.9, to: 9.7, floors: [0], doors: [0, 6] },
      { axis: 'x', at: -28.6, from: -6.9, to: 9.7, floors: [1], doors: [-4.5, 0.5, 5.5] },
      { axis: 'z', at: -2, from: -28.6, to: -21.8, floors: [1] },
      { axis: 'z', at: 3, from: -28.6, to: -21.8, floors: [1] },
    ],
    furnish(B, f, y) {
      if (f === 0) {
        P.counter(B, 0, -24.6, 0, y, 3.6);
        P.sofa(B, -4.6, -22.6, 0, y); P.sofa(B, 5, -22.6, 0, y);
        P.table(B, 6.5, -29.4, 0, y); P.table(B, 2.5, -29.6, 1, y, 1.2, 0.7);
        P.shelf(B, -3, -30.9, 0, y, 2.4); P.cabinet(B, 9.1, -30.5, 1, y);
        P.crate(B, -5.5, -29, 0, 0.8, 1, y);
      } else if (f === 1) {
        for (const rx of [-4.4, 0.5, 6.4]) { P.bed(B, rx, -27.4, 0, y); P.table(B, rx + 0.6, -22.7, 0, y, 1.0, 0.6); }
        P.cabinet(B, 9.1, -30.5, 1, y);
      } else {
        P.sandbags(B, -4.5, -22.25, 0, 2.4, 5, y);
        P.sandbags(B, 4.2, -22.25, 0, 2.4, 5, y);
        P.crate(B, 8.3, -29.5, 0, 0.9, 2, y); P.crate(B, 7.2, -30.4, 1, 0.8, 1, y);
        P.table(B, 0, -26.5, 1, y, 1.6, 0.8); P.bed(B, -3, -29.8, 0, y);
      }
    },
  });
  B.signs.push({ text: 'HOTEL MERIDIAN', x: 0, y: 3.05, z: -21.32, w: 4.4, h: 0.55, rot: 0, color: '#e9d9a6', bg: '#2a2620' });

  // --- Pharmacy with an apartment and roof access --------------------------------------
  building(B, {
    x0: -6, x1: 8, z0: 22, z1: 31, floors: 2, H,
    mats: ['plasterSage', 'plasterWhite'], base: 'concrete', trim: 'trim',
    doors: [{ side: 'n', c: 1, w: 2.0, h: 2.5 }, { side: 's', c: 0, w: 1.1 }],
    windowSpacing: 2.8,
    stair: { x: 5.1, z: 23.6, toRoof: true },
    inner: [
      { axis: 'x', at: 28.4, from: -5.7, to: 4.9, floors: [0], doors: [-2.5] },
      { axis: 'z', at: 0.5, from: 22.3, to: 28.4, floors: [1], doors: [26.5] },
    ],
    furnish(B, f, y) {
      if (f === 0) {
        P.counter(B, -0.8, 26.4, 0, y, 4);
        P.shelf(B, -5.45, 24.8, 1, y, 3); P.shelf(B, 3.6, 30.45, 0, y, 2.4);
        P.crate(B, -4.6, 30, 0, 0.8, 2, y); P.cabinet(B, -1.5, 30.4, 0, y);
      } else {
        P.bed(B, -3.6, 29.6, 0, y); P.sofa(B, -3.4, 23.0, 2, y);
        P.table(B, 2.6, 25, 0, y); P.counter(B, 2.4, 30.3, 0, y, 3);
      }
    },
  });
  const roofY = 2 * H;
  P.waterTank(B, -3.8, 29.2, roofY);
  P.acUnit(B, -4.6, 23.3, 0, roofY); P.acUnit(B, 1.4, 29.9, 0, roofY);
  B.signs.push({ text: '✚ APTEKA · PHARMACY', x: 1, y: 2.9, z: 21.82, w: 4.6, h: 0.55, rot: Math.PI, color: '#dff3dc', bg: '#1f5a3a' });

  // --- Streets ---------------------------------------------------------------------------
  // North street (lane 1) and its mirror in the south street (lane 3).
  P.car(B, -30, -17.6, 0, 'carRed'); P.car(B, 30, 17.6, 2, 'carBlue');
  P.car(B, -14, -15.4, 0, 'carRed', true); P.car(B, 14, 15.4, 2, 'carRed', true);
  P.jersey(B, -3.5, -18.2, 0); P.jersey(B, 3.5, 18.2, 0);
  P.van(B, 22, -17.3, 2, 'carWhite'); P.van(B, -22, 17.3, 0, 'carWhite');
  P.car(B, 37, -15.5, 1, 'carGreen'); P.car(B, -37, 15.5, 3, 'carGreen');
  P.dumpster(B, 11, -24.2, 1); P.dumpster(B, -9, 24.2, 1);
  P.crate(B, -10.9, -33, 0, 0.9, 2); P.crate(B, 9.1, 32.3, 0, 0.9, 2);
  P.dumpster(B, 6, -33, 0); P.dumpster(B, -4, 32.4, 0);

  // Plaza (lane 2)
  P.fountain(B, 0, 0);
  P.stall(B, -12, -7, 0, 'canvasStripe'); P.stall(B, 12, 7, 2, 'canvasStripe');
  P.stall(B, -12, 7.5, 0, 'canvasRed'); P.stall(B, 12, -7.5, 2, 'canvasGreen');
  P.sandbags(B, -6.5, 4.5, 1, 3, 4); P.sandbags(B, 6.5, -4.5, 1, 3, 4);
  for (const [tx, tz] of [[-17, -10], [17, 10], [-17, 10], [17, -10]]) P.tree(B, tx, tz, tz > 0, 1);
  P.bench(B, -4, 7, 0); P.bench(B, 4, -7, 2); P.bench(B, -9, 0, 1); P.bench(B, 9, 0, 3);
  P.rubble(B, -19.5, -12, 1.1); P.rubble(B, 19.5, 12, 1.1);

  // West and east avenues
  P.bus(B, -28, 4.2, 0); P.bus(B, 28, -4.2, 2);
  P.crate(B, -30.5, -6.5, 0, 1.0, 2); P.crate(B, 30.5, 6.5, 0, 1.0, 2);
  P.crate(B, -24, -9.5, 1, 1.0, 1); P.crate(B, 24, 9.5, 1, 1.0, 1);
  P.sandbags(B, -35, -1.5, 1, 3.6, 4); P.sandbags(B, 35, 1.5, 1, 3.6, 4);
  P.jersey(B, -40.5, -9.5, 1); P.jersey(B, 40.5, 9.5, 1); P.jersey(B, -40.5, 9.5, 1); P.jersey(B, 40.5, -9.5, 1);

  // Lamp posts
  for (let x = -44; x <= 44; x += 11) { P.lampPost(B, x, -20.6); P.lampPost(B, -x, 20.6); }

  // --- Spawns & strategic points ------------------------------------------------------------
  for (const z of [-16, -9, -3, 3, 9, 16]) {
    B.spawns.msg.push(new THREE.Vector3(-47, 0, z));
    B.spawns.volk.push(new THREE.Vector3(47, 0, -z));
  }
  B.points.push(
    { p: new THREE.Vector3(-4, 0, 1), lane: 1 }, { p: new THREE.Vector3(4, 0, -1), lane: 1 },
    { p: new THREE.Vector3(-14, 0, -16.5), lane: 0 }, { p: new THREE.Vector3(14, 0, 16.5), lane: 2 },
    { p: new THREE.Vector3(0, 3.4, -23), lane: 0 }, { p: new THREE.Vector3(5, 6.8, -23), lane: 0 },
    { p: new THREE.Vector3(1, 6.8, 23.5), lane: 2 }, { p: new THREE.Vector3(-2, 0, 25), lane: 2 },
    { p: new THREE.Vector3(-26, 0, -2), lane: 1 }, { p: new THREE.Vector3(26, 0, 2), lane: 1 },
    { p: new THREE.Vector3(-22, 0, 15), lane: 2 }, { p: new THREE.Vector3(22, 0, -15), lane: 0 },
    { p: new THREE.Vector3(0, 0, -32.8), lane: 0 }, { p: new THREE.Vector3(1, 0, 32.2), lane: 2 },
  );

  const group = B.build(scene);
  return { builder: B, group, spawns: B.spawns, points: B.points, hints: B.hints, indoor: B.indoor, lights: B.lights, signs: B.signs };
}

// A non-enterable city block with a facade texture, roof slab and shopfronts.
function facadeBlock(B, x0, z0, x1, z1, h, mat) {
  B.solid(x0, 0, z0, x1, h, z1, mat, 'brick');
  B.solid(x0 - 0.25, h, z0 - 0.25, x1 + 0.25, h + 0.35, z1 + 0.25, 'trim', 'brick');
  B.solid(x0 + 0.4, h + 0.35, z0 + 0.4, x1 - 0.4, h + 0.9, z1 - 0.4, 'concrete', 'brick');
  // Ground-floor shopfronts on street-facing sides
  const front = z0 === -22 ? z0 : z1 === 22 ? z1 : null;
  if (front !== null) {
    const dir = front === z0 ? -1 : 1;
    for (let x = x0 + 1.2; x + 3.4 < x1; x += 4.7) {
      const zf = front + dir * 0.02;
      const zo = front + dir * 0.12;
      B.solid(x, 0.45, Math.min(zf, zo), x + 3.2, 2.7, Math.max(zf, zo), 'glass', null);
      B.solid(x - 0.12, 0.35, Math.min(front, zo + dir * 0.04), x + 3.32, 0.45, Math.max(front, zo + dir * 0.04), 'trim', null);
      B.solid(x - 0.12, 2.7, Math.min(front, zo + dir * 0.04), x + 3.32, 2.95, Math.max(front, zo + dir * 0.04), 'darkMetal', null);
      // Awning
      const g = new THREE.BoxGeometry(3.4, 0.05, 1.3);
      g.rotateX(dir * -0.32);
      g.translate(x + 1.6, 3.15, front + dir * 0.62);
      B.geo(((x * 7) | 0) % 3 === 0 ? 'canvasRed' : ((x * 7) | 0) % 3 === 1 ? 'canvasGreen' : 'canvasStripe', g);
    }
  }
}

function church(B) {
  // Nave
  B.solid(24, 0, -38, 38, 11, -26, 'brickPale', 'brick');
  const s = new THREE.Shape();
  s.moveTo(-6.4, 0); s.lineTo(6.4, 0); s.lineTo(0, 5.2); s.lineTo(-6.4, 0);
  const roof = new THREE.ExtrudeGeometry(s, { depth: 14.4, bevelEnabled: false });
  roof.rotateY(Math.PI / 2);
  roof.translate(23.8, 11, -32);
  B.geo('roof', roof);
  // Gothic windows along the nave's south side
  for (let x = 26; x < 37; x += 2.6) B.solid(x, 3, -26.02, x + 1.1, 8.2, -25.9, 'glass', null);
  // Tower with a spire and clock
  B.solid(20, 0, -30, 24.6, 24, -24, 'brickPale', 'brick');
  B.solid(19.8, 23.6, -30.2, 24.8, 24.4, -23.8, 'trim', 'brick');
  for (const y of [8, 16]) B.solid(19.85, y, -30.15, 24.75, y + 0.3, -23.85, 'trim', null);
  const spire = new THREE.ConeGeometry(3.4, 10, 4);
  spire.rotateY(Math.PI / 4);
  spire.translate(22.3, 29.4, -27);
  B.geo('roof', spire);
  const clock = new THREE.CylinderGeometry(1.1, 1.1, 0.1, 24);
  clock.rotateX(Math.PI / 2);
  clock.translate(22.3, 19, -23.92);
  B.geo('trim', clock);
  for (const y of [12.5, 20.8]) B.solid(21.6, y, -24.06, 23.0, y + 2.2, -23.94, 'glass', null);
}
