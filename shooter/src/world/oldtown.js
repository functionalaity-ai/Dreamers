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
import { WindowKit, stuccoBlock, sovietBlock } from './facades.js';
import { DecalAtlas, cable } from './dressing.js';
import { ROAD, sidewalk, roadDetail } from './roads.js';
import * as VH from './vehicles.js';
import * as P from './props.js';

export const BOUNDS = { minX: -60, minZ: -46, maxX: 60, maxZ: 46 };

// opts (all optional; Team Deathmatch passes none):
//   builder, kit   build into these instead (the caller then builds the meshes: see the return value)
//   open           open the town up for a bigger map: the blocks closing the east and west ends of
//                  the square and the yard walls at the end of the south side streets are left out
//   burnt          more burnt-out car spots for the road dressing ([[x, z], ...])
export function buildOldTown(physics, materials, scene, opts = {}) {
  const B = opts.builder || new Builder(physics, materials);
  const kit = opts.kit || new WindowKit(materials.world, { seed: 77 });
  B.kit = kit;
  B.decals = B.decals || new DecalAtlas();
  const open = !!opts.open;

  // --- Ground surfaces (visual; the physics ground is y = 0) ---------------------
  B.solid(-52, -0.05, -13, 52, 0.0, 13, 'cobble', null, { shadow: false });
  // The asphalt stops short of the kerbs and the square: sett gutters run along the kerbs and a
  // granite edging (roads.js) frames the square.
  B.solid(-52, -0.05, -20 + ROAD.gutter, 52, 0.0, -13 - ROAD.edge, 'asphalt', null, { shadow: false });
  B.solid(-52, -0.05, 13 + ROAD.edge, 52, 0.0, 20 - ROAD.gutter, 'asphalt', null, { shadow: false });
  B.solid(-52, -0.05, -20, 52, 0.0, -20 + ROAD.gutter, 'cobble', null, { shadow: false });
  B.solid(-52, -0.05, 20 - ROAD.gutter, 52, 0.0, 20, 'cobble', null, { shadow: false });
  B.solid(-52, -0.05, -42, 52, 0.0, -20, 'concrete', null, { shadow: false });
  B.solid(-52, -0.05, 20, 52, 0.0, 42, 'concrete', null, { shadow: false });
  // Raised sidewalks (step-able) with granite kerbs, skipping the building fronts.
  const walk = (x0, x1, z0, z1) => sidewalk(B, x0, x1, z0, z1);
  walk(-52, -10, -22, -20); walk(10, 52, -22, -20); walk(-10, 10, -21.5, -20);
  walk(-52, -6, 20, 22); walk(8, 52, 20, 22); walk(-6, 8, 20, 22);
  // Road markings
  for (let x = -48; x < 48; x += 4.5) {
    B.solid(x, 0.0, -16.6, x + 2.4, 0.012, -16.45, 'roadPaint', null, { shadow: false });
    B.solid(x, 0.0, 16.45, x + 2.4, 0.012, 16.6, 'roadPaint', null, { shadow: false });
  }
  // Pedestrian crossings into the plaza
  for (const zc of [-16.5, 16.5]) for (let i = 0; i < 7; i++) B.solid(-3.2 + i * 0.95, 0, zc - 2.4, -2.7 + i * 0.95, 0.012, zc + 2.4, 'roadPaint', null, { shadow: false });

  // --- Perimeter blocks ----------------------------------------------------------------
  // North row (street faces south, into the sun).
  sovietBlock(B, kit, { x0: -52, x1: -23.2, z0: -36, z1: -22, face: 's', floors: 5, entrances: [2, 6], balconies: [0, 4, 8], seed: 11 });
  B.solid(-52, 0, -42, -23.2, 2.6, -36, 'panelPlinth', 'concrete'); // garages behind the block
  stuccoBlock(B, kit, { x0: -23.2, x1: -12, z0: -38, z1: -22, floors: 4, mat: 'plasterOchre', faces: ['s'], shops: true, signs: ['ХЛЕБ · BAKERY', 'ОБУВЬ · SHOES'], seed: 21 });
  stuccoBlock(B, kit, { x0: -12, x1: 12, z0: -42, z1: -34, floors: 4, mat: 'plasterCream', faces: ['s'], shops: false, seed: 22 });
  stuccoBlock(B, kit, { x0: 12, x1: 20, z0: -42, z1: -22, floors: 3, mat: 'plasterRose', faces: ['s'], shops: true, signs: ['КАФЕ · CAFÉ'], seed: 23 });
  B.solid(20, 0, -42, 38, 10.2, -38, 'plasterCream', 'brick');
  stuccoBlock(B, kit, { x0: 38, x1: 52, z0: -42, z1: -22, floors: 4, mat: 'plasterSage', faces: ['s'], shops: true, signs: ['ПРОДУКТЫ · GROCER', 'ЧАСЫ · WATCHES'], seed: 24 });
  // South row (street faces north, in shade) with two side streets that let the low sun through.
  stuccoBlock(B, kit, { x0: -52, x1: -38, z0: 22, z1: 42, floors: 4, mat: 'plasterCream', faces: ['n', 'e'], shops: true, signs: ['ГАСТРОНОМ', 'АПТЕКА №2'], seed: 31 });
  stuccoBlock(B, kit, { x0: -31, x1: -20, z0: 22, z1: 42, floors: 3, mat: 'plasterSage', faces: ['n', 'w'], shops: true, signs: ['РЕМОНТ · REPAIRS'], seed: 32 });
  stuccoBlock(B, kit, { x0: -20, x1: -8, z0: 22, z1: 42, floors: 2, mat: 'plasterWhite', faces: ['n'], shops: true, signs: ['ПОЧТА · POST'], seed: 33 });
  stuccoBlock(B, kit, { x0: -8, x1: 10, z0: 33.5, z1: 42, floors: 2, mat: 'plasterOchre', faces: [], seed: 34 });
  stuccoBlock(B, kit, { x0: 10, x1: 24, z0: 22, z1: 42, floors: 3, mat: 'plasterOchre', faces: ['n', 'e'], shops: true, signs: ['КНИГИ · BOOKS', 'МЯСО · BUTCHER'], seed: 35 });
  stuccoBlock(B, kit, { x0: 30, x1: 37.6, z0: 22, z1: 42, floors: 4, mat: 'plasterRose', faces: ['n', 'w'], shops: true, signs: ['ТАБАК'], seed: 36 });
  // A second panel block, backlit by the low sun (its x0 keeps the panel joints in step).
  sovietBlock(B, kit, { x0: 37.6, x1: 53.6, z0: 22, z1: 36, face: 'n', floors: 5, entrances: [2], balconies: [0, 4], seed: 12 });
  B.solid(37.6, 0, 36, 53.6, 2.6, 42, 'panelPlinth', 'concrete');
  // Ends of the square (left open on the big map, where the streets run on).
  if (!open) {
    stuccoBlock(B, kit, { x0: -60, x1: -52, z0: -22, z1: 22, floors: 4, mat: 'plasterOchre', faces: ['e'], shops: true, signs: ['УНИВЕРМАГ', 'ФОТО'], seed: 41 });
    stuccoBlock(B, kit, { x0: 52, x1: 60, z0: -22, z1: 22, floors: 4, mat: 'plasterRose', faces: ['w'], shops: true, signs: ['РЕСТОРАН', 'ЧАЙ · TEA'], seed: 42 });
  }
  // Side streets: barricaded halfway, closed by a yard wall (on the big map the barricade has a
  // gap and the yard wall is gone).
  for (const [sx0, sx1] of [[-38, -31], [24, 30]]) {
    if (!open) {
      B.solid(sx0, 0, 40.5, sx1, 3.2, 42, 'brick', 'brick');
      B.solid(sx0, 3.2, 40.4, sx1, 3.35, 42, 'concrete', null);
    }
    if (!open) {
      P.jersey(B, (sx0 + sx1) / 2 - 1.6, 29, 0); P.jersey(B, (sx0 + sx1) / 2 + 1.6, 29.4, 0);
      P.sandbags(B, (sx0 + sx1) / 2, 30.2, 0, 3, 4);
      B.collider(sx0, 0, 30.6, sx1, 3, 31, 'concrete');
    } else {
      P.jersey(B, sx0 + 1.6, 29, 0);
      P.sandbags(B, sx1 - 1.5, 30.2, 0, 2.4, 4);
    }
  }
  P.rubble(B, -34, 34, 1.4); P.rubble(B, 27, 36, 1.2);
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
  VH.saloon(B, materials, -30, -17.6, 0, 'cherry', { yaw: 0.03 });
  VH.saloon(B, materials, 30, 17.6, 2, 'sky', { yaw: -0.02, steer: 0.25 });
  VH.saloon(B, materials, -14, -15.4, 0, null, { burnt: true, yaw: 0.12 });
  VH.saloon(B, materials, 14, 15.4, 2, null, { burnt: true, yaw: -0.1 });
  P.jersey(B, -3.5, -18.2, 0); P.jersey(B, 3.5, 18.2, 0);
  VH.minibus(B, materials, 22, -17.3, 2, 'ivory');
  VH.minibus(B, materials, -22, 17.3, 0, 'mustard');
  VH.saloon(B, materials, 37, -15.5, 1, 'olive', { steer: -0.3 });
  VH.saloon(B, materials, -37, 15.5, 3, 'steel');
  VH.saloon(B, materials, -45, -18.9, 0, 'white', { yaw: -0.02 });
  VH.saloon(B, materials, 44, 18.9, 2, 'green', { yaw: 0.02 });
  VH.saloon(B, materials, -34.5, 25.2, 1, null, { burnt: true, yaw: 0.08 });
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
  VH.wreckedBus(B, materials, -28, 4.2, 0, { yaw: 0.02 }); VH.wreckedBus(B, materials, 28, -4.2, 2, { yaw: -0.03 });
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

  // Cables strung across the streets between the facades
  for (const [x, z0, z1, y0, y1] of [[-30, -22.3, -13.4, 6.2, 5.6], [-6, -21.3, 21.8, 8.8, 6.4], [26, -22.3, 22.3, 7.6, 7.2], [-44, -22.3, 22.3, 6.8, 7.4], [41, -22.3, 21.7, 7.1, 6.6]]) {
    cable(B, new THREE.Vector3(x, y0, z0), new THREE.Vector3(x + 1.2, y1, z1), 0.9);
    cable(B, new THREE.Vector3(x + 0.4, y0 - 0.35, z0), new THREE.Vector3(x + 1.5, y1 - 0.3, z1), 1.2, 0.009);
  }

  // Kerbs, covers, repairs, stains, leaves and litter (after every prop, so placement can avoid them).
  const roads = roadDetail(B, materials, { burnt: [[-14, -15.4], [14, 15.4], [-34.5, 25.2]].concat(opts.burnt || []) });
  if (opts.builder) return { builder: B, roads, kit, spawns: B.spawns, points: B.points, hints: B.hints, indoor: B.indoor, lights: B.lights, signs: B.signs };

  const group = B.build(scene);
  kit.build(scene);
  B.decals.build(scene);
  roads.build(scene);
  return { builder: B, group, spawns: B.spawns, points: B.points, hints: B.hints, indoor: B.indoor, lights: B.lights, signs: B.signs };
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
