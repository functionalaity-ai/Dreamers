// The Battle Royale map: 420 m square, Old Town in the middle with its ends opened, eight named
// districts round it on a street grid, about sixty lootable buildings (a third of them bombed),
// loot containers and loose loot, built region by region with a detailed and a proxy version of
// each region (see lod.js).
//
//            x -210        -140   -72  -60     60  72    140        210
//   z -210  ┌──────────────┬──────┬──────────────┬──────┬──────────────┐
//           │ ZARYA ESTATE (panel blocks)│ NORTH FIELDS │ RAIL YARD    │
//   z -136  ├──── outer north road ──────┼── polyclinic ┼──────────────┤
//   z  -54  ├════ north ring ═══════════════════════════════════════════┤
//           │ LIPKI (houses)      │ west │  OLD TOWN   │east│ MARKET QUARTER│
//   z   54  ├════ south ring ═══════════════════════════════════════════┤
//           │ CHURCH & SCHOOL     │ ave  │ SADOVAYA    │ave │ PETROL & FARMS│
//   z  210  └─────────────────────┴──────┴─────────────┴────┴───────────────┘
import * as THREE from 'three';
import { buildOldTown } from '../oldtown.js';
import { sovietBlock } from '../facades.js';
import { DecalAtlas } from '../dressing.js';
import * as VH from '../vehicles.js';
import * as P from '../props.js';
import { Regions, RegionBuilder, RegionKit, LODSwitch } from './lod.js';
import { ContainerSet } from './containers.js';
import { brMaterials } from './ground.js';
import { Streets } from './streets.js';
import { lootBuilding, proxyShell, rubbleHeap, rng } from './houses.js';
import { shed, fence, garageRow, railTrack, wagon, petrolStation, belfry, field, haystack, barricade, outerLand } from './brprops.js';

export const BR_BOUNDS = { minX: -210, minZ: -210, maxX: 210, maxZ: 210 };

// Old Town's blocks for the far view: x0, x1, z0, z1, height, wall material, roof
const OLD_TOWN_PROXY = [
  [-52, -23.2, -36, -22, 14.8, 'panel', 'flat'], [-52, -23.2, -42, -36, 2.6, 'panelPlinth'],
  [-23.2, -12, -38, -22, 13.9, 'plasterOchre', 'tile'], [-12, 12, -42, -34, 13.9, 'plasterCream', 'tile'],
  [12, 20, -42, -22, 10.6, 'plasterRose', 'tile'], [20, 38, -42, -38, 10.2, 'plasterCream'],
  [38, 52, -42, -22, 13.9, 'plasterSage', 'tile'],
  [-52, -38, 22, 42, 13.9, 'plasterCream', 'tile'], [-31, -20, 22, 42, 10.6, 'plasterSage', 'tile'], [-20, -8, 22, 42, 7.3, 'plasterWhite', 'tile'],
  [-8, 10, 33.5, 42, 7.3, 'plasterOchre', 'tile'], [10, 24, 22, 42, 10.6, 'plasterOchre', 'tile'], [30, 37.6, 22, 42, 13.9, 'plasterRose', 'tile'],
  [37.6, 53.6, 22, 36, 14.8, 'panel', 'flat'], [37.6, 53.6, 36, 42, 2.6, 'panelPlinth'],
  [-10, 10, -31.5, -21.5, 10.2, 'plasterCream', 'flat'], [-6, 8, 22, 31, 6.8, 'plasterWhite', 'flat'],
  [24, 38, -38, -26, 11, 'brickPale', 'tile'], [20, 24.6, -30, -24, 24, 'brickPale'],
];

// Records soot decals until the road atlas exists (it is made with Old Town's road dressing).
class DecalQueue {
  constructor() { this.q = []; }
  face(...a) { this.q.push(['face', a]); }
  flat(...a) { this.q.push(['flat', a]); }
  flush(atlas) { for (const [k, a] of this.q) atlas[k](...a); this.q.length = 0; }
}

export function buildBRMap(physics, materials, scene, opts = {}) {
  const t0 = performance.now();
  brMaterials(materials);
  const regions = new Regions(BR_BOUNDS, 70);
  const B = new RegionBuilder(physics, materials, regions);
  const kit = new RegionKit(materials.world, B, { seed: 77 });
  B.kit = kit;
  B.decals = new DecalAtlas();
  const cs = new ContainerSet(physics, materials);
  const containerGroups = regions.list.map((r) => { const g = new THREE.Group(); g.name = 'containers:' + r.name; return g; });
  const decals = new DecalQueue();
  const ctx = {
    B, cs, rnd: Math.random, loot: [], buildings: [], atlas: decals,
    place(c) {
      const r = B.owner !== null ? B.owner : regions.at(c.object.position.x, c.object.position.z);
      containerGroups[r].add(c.object);
    },
  };
  const R = rng(opts.seed || 4242);
  const landmarks = [];
  const mark = (name, x, z) => landmarks.push({ name, x, z });

  // --- ground: dry grass everywhere, the streets on top ---------------------------------------------
  // (the grass sits 4 cm under the street surfaces, its proxy 30 cm: enough depth precision at range)
  B.solid(BR_BOUNDS.minX, -0.1, BR_BOUNDS.minZ, BR_BOUNDS.maxX, -0.04, BR_BOUNDS.maxZ, 'grass', null, { shadow: false });
  B.proxyBox(BR_BOUNDS.minX, -0.4, BR_BOUNDS.minZ, BR_BOUNDS.maxX, -0.3, BR_BOUNDS.maxZ, 'grass');
  const S = new Streets(B);
  S.add(-210, -20, -52, -13, { name: 'Northern Street' }); S.add(52, -20, 210, -13);
  S.add(-210, 13, -52, 20, { name: 'Southern Street' }); S.add(52, 13, 210, 20);
  S.add(-210, -58, 210, -50, { name: 'North Ring' }); S.add(-210, 50, 210, 58, { name: 'South Ring' });
  S.add(-72, -210, -64, 210, { name: 'West Avenue' }); S.add(64, -210, 72, 210, { name: 'East Avenue' });
  S.add(-146, -210, -140, 210, { walk: 1.5 }); S.add(140, -210, 146, 210, { walk: 1.5 });
  S.add(-210, -136, 210, -130, { walk: 1.5 }); S.add(-210, 130, 210, 136, { walk: 1.5 });
  S.add(-38, 42, -31, 50, { walk: 0, paint: false }); S.add(24, 42, 30, 50, { walk: 0, paint: false });
  S.add(-4, -130, 4, -58, { walk: 0 });
  S.build([{ x0: -52, x1: 52, z0: -46, z1: 46 }]);
  for (const r of S.list) {
    B.proxyBox(r.x0, -0.05, r.z0, r.x1, 0.0, r.z1, 'asphalt');
    if (r.walk > 0) {
      const ax = r.x1 - r.x0 > r.z1 - r.z0;
      if (ax) { B.proxyBox(r.x0, 0, r.z0 - r.walk, r.x1, 0.13, r.z0, 'sidewalk'); B.proxyBox(r.x0, 0, r.z1, r.x1, 0.13, r.z1 + r.walk, 'sidewalk'); } else { B.proxyBox(r.x0 - r.walk, 0, r.z0, r.x0, 0.13, r.z1, 'sidewalk'); B.proxyBox(r.x1, 0, r.z0, r.x1 + r.walk, 0.13, r.z1, 'sidewalk'); }
    }
  }
  // the square runs on where Old Town's end blocks stood
  B.solid(52, -0.05, -13, 60, 0.0, 13, 'cobble', null, { shadow: false });
  B.solid(-60, -0.05, -13, -52, 0.0, 13, 'cobble', null, { shadow: false });
  for (const sx of [-1, 1]) { B.proxyBox(sx < 0 ? -60 : 52, -0.05, -13, sx < 0 ? -52 : 60, 0, 13, 'cobble'); }

  const H = (spec) => lootBuilding(ctx, spec);
  const tree = (x, z, autumn = false, s = 1) => P.tree(B, x, z, autumn, s);
  const car = (x, z, rot, paint, o = {}) => VH.saloon(B, materials, x, z, rot, paint, o);
  const burntSpots = [];
  const burnt = (x, z, rot, yaw = 0) => { car(x, z, rot, null, { burnt: true, yaw }); burntSpots.push([x, z]); };

  // --- LIPKI: residential stucco streets (west) -----------------------------------------------------
  mark('Lipki', -110, 0);
  H({ x0: -136, x1: -124, z0: -33, z1: -23.5, floors: 2, front: 's', roof: 'tile', mats: ['plasterOchre', 'plasterCream'], seed: 101 });
  H({ x0: -120, x1: -108, z0: -34, z1: -23.5, floors: 3, front: 's', roof: 'flat', mats: ['concrete', 'plasterSage'], destroyed: 1, seed: 102 });
  H({ x0: -104, x1: -91, z0: -33, z1: -23.5, floors: 2, front: 's', roof: 'tile', style: 'shop', mats: ['plasterWhite', 'plasterRose'], sign: 'ХЛЕБ · BAKERY', seed: 103 });
  H({ x0: -88, x1: -77, z0: -33, z1: -23.5, floors: 3, front: 's', mats: ['plasterCream', 'plasterOchre'], destroyed: 2, seed: 104 });
  H({ x0: -134, x1: -122, z0: -9.5, z1: 0, floors: 2, front: 'n', roof: 'tile', mats: ['plasterSage', 'plasterWhite'], seed: 105 });
  H({ x0: -116, x1: -102, z0: -9.5, z1: 1, floors: 3, front: 'n', roof: 'flat', style: 'flat', mats: ['brick', 'brick'], seed: 106 });
  H({ x0: -98, x1: -87, z0: 0, z1: 9.5, floors: 2, front: 's', roof: 'tile', mats: ['plasterRose', 'plasterRose'], destroyed: 1, seed: 107 });
  H({ x0: -134, x1: -123, z0: 23.5, z1: 32, floors: 2, front: 'n', roof: 'tile', mats: ['plasterCream', 'plasterCream'], seed: 108 });
  H({ x0: -116, x1: -100, z0: 23.5, z1: 33, floors: 3, front: 'n', roof: 'flat', style: 'office', mats: ['concrete', 'plasterWhite'], sign: 'ПОЧТА · POST OFFICE', seed: 109 });
  H({ x0: -94, x1: -83, z0: 23.5, z1: 33, floors: 2, front: 'n', mats: ['plasterOchre', 'plasterOchre'], destroyed: 1, seed: 110 });
  H({ x0: -170, x1: -158, z0: -33, z1: -23.5, floors: 2, front: 's', roof: 'tile', mats: ['plasterWhite', 'plasterSage'], seed: 111 });
  H({ x0: -196, x1: -184, z0: -34, z1: -23.5, floors: 2, front: 's', mats: ['brickPale', 'brickPale'], destroyed: 2, seed: 112 });
  H({ x0: -186, x1: -174, z0: 23.5, z1: 33, floors: 2, front: 'n', roof: 'tile', mats: ['plasterRose', 'plasterCream'], seed: 113 });
  H({ x0: -178, x1: -166, z0: -9, z1: 1, floors: 2, front: 'n', roof: 'tile', mats: ['plasterOchre', 'plasterWhite'], seed: 114 });
  for (const [x, z] of [[-128, -42], [-112, -44], [-96, -41], [-150, 4], [-118, 6], [-84, -4], [-128, 40], [-108, 41], [-90, 42], [-160, -42], [-190, 42], [-200, 2]]) tree(x, z, R() < 0.4, 0.9 + R() * 0.2);
  for (const z0 of [-46, 35]) fence(B, -136, z0 + 1, -77, z0 + 1, R, { picket: true });
  car(-118, -18.5, 0, 'olive'); burnt(-95, -15.3, 0, 0.1); car(-160, 17.5, 2, 'sky'); burnt(-128, 15.6, 2, -0.15);
  barricade(B, -84, 16.5, false, 7, R);
  rubbleHeap(B, -103, -21.0, 3, 1.6, 0.6, 0.13, R);

  // --- MARKET QUARTER (east) ---------------------------------------------------------------------------
  mark('Market Quarter', 110, 0);
  H({ x0: 78, x1: 92, z0: -34, z1: -23.5, floors: 3, front: 's', roof: 'flat', style: 'shop', mats: ['plasterWhite', 'plasterOchre'], sign: 'ПРОДУКТЫ · GROCER', seed: 201 });
  H({ x0: 96, x1: 108, z0: -33, z1: -23.5, floors: 2, front: 's', roof: 'tile', style: 'shop', mats: ['plasterSage', 'plasterCream'], sign: 'АПТЕКА · PHARMACY', signBg: '#1f5a3a', destroyed: 1, seed: 202 });
  H({ x0: 112, x1: 126, z0: -34, z1: -23.5, floors: 3, front: 's', style: 'shop', mats: ['plasterRose', 'plasterRose'], sign: 'УНИВЕРМАГ', destroyed: 2, seed: 203 });
  shed(ctx, { x0: 110, x1: 134, z0: -9, z1: 9, h: 6.2, mat: 'brickPale', doors: [{ side: 'w', c: 0, w: 4.5 }, { side: 'e', c: -2, w: 4 }, { side: 'n', c: 122, w: 3 }], seed: 204, name: 'market hall' });
  for (let i = 0; i < 6; i++) P.stall(B, 82 + (i % 3) * 8, i < 3 ? -5.5 : 5.5, i < 3 ? 0 : 2, ['canvasStripe', 'canvasRed', 'canvasGreen'][i % 3]);
  for (let i = 0; i < 4; i++) ctx.loot.push({ x: 82 + i * 6, y: 0.02, z: 0, tier: i === 2 ? 1 : 0 });
  H({ x0: 78, x1: 94, z0: 23.5, z1: 33, floors: 3, front: 'n', roof: 'flat', style: 'office', mats: ['concrete', 'plasterCream'], sign: 'БАНК · BANK', signBg: '#2a2f3a', seed: 205 });
  H({ x0: 100, x1: 112, z0: 23.5, z1: 32, floors: 2, front: 'n', roof: 'tile', style: 'shop', mats: ['plasterOchre', 'plasterOchre'], sign: 'КАФЕ · CAFÉ', signBg: '#5a2a1f', seed: 206 });
  H({ x0: 118, x1: 130, z0: 23.5, z1: 33, floors: 2, front: 'n', mats: ['plasterWhite', 'plasterWhite'], destroyed: 1, seed: 207 });
  H({ x0: 152, x1: 168, z0: -34, z1: -23.5, floors: 4, front: 's', roof: 'flat', style: 'flat', mats: ['panelPlinth', 'panel'], seed: 208 });
  shed(ctx, { x0: 160, x1: 190, z0: -8, z1: 8, h: 6, mat: 'brick', doors: [{ side: 'w', c: 0, w: 5 }, { side: 's', c: 182, w: 4 }], destroyed: true, seed: 209, name: 'bus depot' });
  H({ x0: 156, x1: 168, z0: 23.5, z1: 33, floors: 2, front: 'n', roof: 'tile', mats: ['plasterCream', 'plasterSage'], destroyed: 1, seed: 210 });
  H({ x0: 180, x1: 192, z0: 23.5, z1: 32, floors: 2, front: 'n', roof: 'tile', mats: ['plasterRose', 'plasterWhite'], seed: 211 });
  for (const [x, z] of [[104, 0], [79, 40], [100, 42], [128, 41], [150, 2], [200, -40], [176, 40], [196, 12]]) tree(x, z, R() < 0.5, 1);
  VH.minibus(B, materials, 96, 17.3, 2, 'mustard'); burnt(120, -15.5, 0, 0.12); car(176, -18.7, 0, 'white'); burnt(150, 15.5, 2);
  barricade(B, 90, -16.5, false, 7, R);
  VH.wreckedBus(B, materials, 175, 12, 1, { yaw: 0.05 });

  // --- ZARYA ESTATE: panel blocks (north-west) --------------------------------------------------------
  mark('Zarya Estate', -140, -100);
  const panelBlock = (x0, z0, z1, face, seed, ent) => {
    B.own(x0 + 16, (z0 + z1) / 2);
    const top = sovietBlock(B, kit, { x0, x1: x0 + 32, z0, z1, face, floors: 5, entrances: ent, balconies: [1, 5, 8], seed });
    proxyShell(B, { x0, x1: x0 + 32, z0, z1 }, top, 'panel', 'flat', 2.8, 5, 3.2, 'panelPlinth');
    B.own(null);
    ctx.buildings.push({ x0, z0, x1: x0 + 32, z1, floors: 5, destroyed: false, enterable: false, name: 'panel block' });
  };
  panelBlock(-132, -100, -88, 's', 31, [2, 7]);
  panelBlock(-196, -100, -88, 's', 32, [3]);
  panelBlock(-132, -186, -174, 'n', 33, [4]);
  panelBlock(-116, -78, -66, 's', 34, [2, 6]);
  H({ x0: -120, x1: -104, z0: -124, z1: -113, floors: 4, front: 'n', roof: 'flat', style: 'flat', mats: ['panelPlinth', 'panel'], seed: 301 });
  H({ x0: -190, x1: -174, z0: -124, z1: -113, floors: 4, front: 'n', style: 'flat', mats: ['panelPlinth', 'panel'], destroyed: 2, seed: 302 });
  H({ x0: -100, x1: -84, z0: -204, z1: -192, floors: 3, front: 's', roof: 'flat', style: 'flat', mats: ['panelPlinth', 'panel'], seed: 303 });
  H({ x0: -192, x1: -172, z0: -176, z1: -164, floors: 3, front: 's', style: 'flat', mats: ['panelPlinth', 'panel'], destroyed: 1, seed: 304 });
  H({ x0: -166, x1: -152, z0: -78, z1: -66, floors: 2, front: 's', roof: 'flat', style: 'shop', mats: ['concrete', 'concrete'], sign: 'ГАСТРОНОМ', seed: 305 });
  garageRow(B, -186, -160, 5, 1, R);
  garageRow(B, -124, -158, 6, -1, R);
  for (const [x, z] of [[-140, -108], [-150, -118], [-160, -82], [-180, -146], [-96, -150], [-110, -170], [-200, -140]]) tree(x, z, true, 1.1);
  burnt(-150, -96, 1, 0.1); car(-160, -106, 0, 'steel'); burnt(-100, -142, 0, -0.2);
  rubbleHeap(B, -170, -104, 4, 3, 1.1, 0, R);

  // --- NORTH FIELDS and the polyclinic ------------------------------------------------------------------
  mark('Polyclinic', -25, -84);
  mark('North Fields', 0, -170);
  H({ x0: -40, x1: -10, z0: -90, z1: -78, floors: 3, front: 's', roof: 'flat', style: 'clinic', mats: ['plasterWhite', 'plasterWhite'], sign: 'ПОЛИКЛИНИКА · CLINIC', signBg: '#1f3a5a', windowSpacing: 3.0, seed: 401 });
  H({ x0: 12, x1: 26, z0: -88, z1: -77, floors: 2, front: 's', mats: ['plasterCream', 'plasterOchre'], destroyed: 1, seed: 402 });
  VH.minibus(B, materials, -22, -73, 0, 'white');
  H({ x0: 20, x1: 32, z0: -122, z1: -112, floors: 2, front: 's', roof: 'tile', mats: ['plasterWhite', 'plasterWhite'], seed: 403, name: 'farmhouse' });
  shed(ctx, { x0: 38, x1: 56, z0: -124, z1: -110, h: 5.2, mat: 'brickPale', doors: [{ side: 's', c: 47, w: 4.5 }], seed: 404, name: 'barn' });
  field(B, -60, -205, -8, -142); field(B, 8, -205, 60, -142); field(B, -60, -126, -12, -100);
  for (let i = 0; i < 9; i++) haystack(B, -50 + R() * 100, -195 + R() * 45, R);
  for (const [x, z] of [[-55, -66], [-45, -66], [40, -66], [50, -66], [8, -100], [-8, -110]]) tree(x, z, false, 1);
  burnt(0, -96, 1, 0.08);

  // --- RAIL YARD: bombed industry (north-east) ----------------------------------------------------------
  mark('Rail Yard', 140, -100);
  railTrack(B, 74, 210, -95); railTrack(B, 74, 210, -101);
  shed(ctx, { x0: 80, x1: 110, z0: -125, z1: -108, h: 7, mat: 'brick', doors: [{ side: 's', c: 92, w: 5 }, { side: 'w', c: -116, w: 4 }], destroyed: true, seed: 501, name: 'warehouse 1' });
  shed(ctx, { x0: 116, x1: 136, z0: -125, z1: -110, h: 6, mat: 'concrete', doors: [{ side: 's', c: 126, w: 5 }], destroyed: true, seed: 502, name: 'warehouse 2' });
  shed(ctx, { x0: 152, x1: 184, z0: -125, z1: -108, h: 7, mat: 'brickPale', doors: [{ side: 's', c: 160, w: 5 }, { side: 'e', c: -116, w: 4 }], seed: 503, name: 'warehouse 3' });
  shed(ctx, { x0: 80, x1: 104, z0: -86, z1: -66, h: 6, mat: 'brick', doors: [{ side: 'n', c: 92, w: 5 }, { side: 's', c: 86, w: 3 }], seed: 504, name: 'goods shed' });
  H({ x0: 150, x1: 166, z0: -84, z1: -72, floors: 3, front: 'n', roof: 'flat', style: 'office', mats: ['brick', 'brick'], sign: 'ДЕПО · DEPOT', destroyed: 2, seed: 505 });
  shed(ctx, { x0: 90, x1: 130, z0: -190, z1: -165, h: 8, mat: 'concrete', doors: [{ side: 's', c: 110, w: 7 }], destroyed: true, seed: 506, name: 'hangar' });
  shed(ctx, { x0: 160, x1: 190, z0: -185, z1: -160, h: 7, mat: 'brick', doors: [{ side: 's', c: 175, w: 6 }, { side: 'w', c: -172, w: 4 }], seed: 507, name: 'workshop' });
  wagon(B, 100, -95, R, false); wagon(B, 128, -95, R, true); wagon(B, 172, -101, R, false); wagon(B, 196, -95, R, true);
  for (let i = 0; i < 8; i++) P.crate(B, 114 + (i % 4) * 1.3, -140 - Math.floor(i / 4) * 1.3, 0, 1.2, 1 + (i % 3 === 0 ? 1 : 0));
  rubbleHeap(B, 140, -112, 5, 4, 1.4, 0, R, ['soot', 'brick', 'concrete']);
  burnt(120, -150, 1); VH.wreckedBus(B, materials, 196, -80, 0, { yaw: -0.06 });
  barricade(B, 68, -88, false, 8, R);

  // --- CHURCH & SCHOOL (south-west) --------------------------------------------------------------------
  mark('Church & School', -140, 110);
  H({ x0: -130, x1: -100, z0: 72, z1: 84, floors: 2, front: 'n', roof: 'flat', style: 'school', mats: ['plasterOchre', 'plasterCream'], sign: 'ШКОЛА №3 · SCHOOL', signBg: '#3a2a20', windowSpacing: 3.0, seed: 601 });
  H({ x0: -180, x1: -164, z0: 74, z1: 88, floors: 1, H: 5.2, front: 'n', roof: 'tile', style: 'office', mats: ['brickPale', 'brickPale'], seed: 602, name: 'chapel' });
  belfry(B, -185, 74, 4.6, 17);
  H({ x0: -120, x1: -108, z0: 100, z1: 110, floors: 2, front: 'n', roof: 'tile', mats: ['plasterCream', 'plasterRose'], destroyed: 1, seed: 603 });
  H({ x0: -200, x1: -188, z0: 104, z1: 114, floors: 2, front: 'n', roof: 'tile', mats: ['plasterSage', 'plasterSage'], seed: 604 });
  H({ x0: -170, x1: -158, z0: 150, z1: 160, floors: 2, front: 'n', mats: ['plasterWhite', 'plasterOchre'], destroyed: 2, seed: 605 });
  H({ x0: -120, x1: -108, z0: 150, z1: 160, floors: 2, front: 'n', roof: 'tile', mats: ['plasterOchre', 'plasterOchre'], seed: 606 });
  fence(B, -132, 88, -98, 88, R, { gaps: 0.2 });
  for (const [x, z] of [[-150, 70], [-158, 96], [-172, 100], [-136, 100], [-96, 112], [-190, 160], [-140, 170], [-100, 190], [-180, 190]]) tree(x, z, true, 1.1);
  burnt(-150, 53.5, 0, 0.1); car(-88, 92, 1, 'green');

  // --- SADOVAYA: dachas and allotments (south) ------------------------------------------------------------
  mark('Sadovaya', 0, 100);
  H({ x0: -50, x1: -41, z0: 70, z1: 78, floors: 2, front: 'n', roof: 'tile', mats: ['plasterCream', 'plasterCream'], seed: 701 });
  H({ x0: -20, x1: -11, z0: 72, z1: 80, floors: 2, front: 'n', mats: ['plasterSage', 'plasterSage'], destroyed: 1, seed: 702 });
  H({ x0: 14, x1: 23, z0: 70, z1: 78, floors: 2, front: 'n', roof: 'tile', mats: ['plasterRose', 'plasterWhite'], seed: 703 });
  H({ x0: 40, x1: 49, z0: 74, z1: 82, floors: 2, front: 'n', mats: ['brick', 'brick'], destroyed: 2, seed: 704 });
  H({ x0: -30, x1: -21, z0: 100, z1: 108, floors: 2, front: 'n', roof: 'tile', mats: ['plasterOchre', 'plasterCream'], seed: 705 });
  H({ x0: 20, x1: 29, z0: 102, z1: 110, floors: 2, front: 'n', roof: 'tile', mats: ['plasterWhite', 'plasterSage'], seed: 706 });
  H({ x0: -10, x1: 2, z0: 150, z1: 160, floors: 2, front: 'n', roof: 'tile', mats: ['plasterCream', 'plasterRose'], seed: 707 });
  for (const [x0, z0] of [[-56, 86], [-36, 86], [-2, 86], [30, 88], [-50, 114], [36, 116], [-40, 160], [20, 160]]) field(B, x0, z0, x0 + 14, z0 + 9);
  fence(B, -58, 68, -58, 124, R); fence(B, 58, 68, 58, 124, R);
  for (const [x, z] of [[-6, 70], [6, 92], [-44, 100], [44, 100], [0, 120], [-20, 140], [24, 140], [-50, 190], [40, 190], [0, 200]]) tree(x, z, R() < 0.6, 0.9 + R() * 0.3);
  burnt(-34.5, 46, 1, 0.1);

  // --- PETROL STATION and farms (south-east) ---------------------------------------------------------------
  mark('Petrol Station', 90, 75);
  mark('Farms', 160, 160);
  petrolStation(B, 90, 75, R);
  H({ x0: 104, x1: 116, z0: 66, z1: 76, floors: 1, H: 3.6, front: 'w', roof: 'flat', style: 'shop', mats: ['plasterWhite', 'plasterWhite'], sign: 'МАГАЗИН · SHOP', seed: 801 });
  H({ x0: 160, x1: 172, z0: 92, z1: 102, floors: 2, front: 'w', roof: 'tile', mats: ['plasterWhite', 'plasterCream'], seed: 802, name: 'farmhouse' });
  shed(ctx, { x0: 178, x1: 200, z0: 88, z1: 104, h: 6, mat: 'brickPale', doors: [{ side: 'w', c: 96, w: 4.5 }], destroyed: true, seed: 803, name: 'barn' });
  H({ x0: 100, x1: 112, z0: 110, z1: 120, floors: 2, front: 'n', mats: ['plasterOchre', 'plasterSage'], destroyed: 1, seed: 804 });
  H({ x0: 120, x1: 132, z0: 160, z1: 170, floors: 2, front: 'n', roof: 'tile', mats: ['plasterRose', 'plasterRose'], seed: 805 });
  field(B, 150, 140, 205, 205); field(B, 78, 145, 115, 205); field(B, 150, 64, 205, 84, 'soil');
  for (let i = 0; i < 7; i++) haystack(B, 155 + R() * 45, 145 + R() * 55, R);
  for (const [x, z] of [[120, 92], [140, 100], [176, 120], [196, 124], [90, 130], [130, 190], [200, 70]]) tree(x, z, true, 1);
  burnt(86, 72, 0, 0.3); car(96, 79, 2, 'cherry', { steer: 0.2 }); burnt(150, 54, 0);
  barricade(B, 68, 80, false, 8, R);

  // --- Old Town in the middle, opened up -------------------------------------------------------------------
  mark('Old Town', 0, 0);
  const ot = buildOldTown(physics, materials, scene, { builder: B, kit, open: true, burnt: burntSpots });
  decals.flush(ot.roads.atlas);
  oldTownLoot(ctx, cs);
  for (const [x0, x1, z0, z1, h, mat, roof] of OLD_TOWN_PROXY) proxyShell(B, { x0, x1, z0, z1 }, h, mat, roof || null, h > 12 ? 3.3 : 3.4, roof ? Math.max(1, Math.round(h / 3.4)) : 0, 3.0);
  B.proxyBox(-52, -0.05, -13, 52, 0, 13, 'cobble');
  B.proxyBox(-52, -0.05, -20, 52, 0, -13, 'asphalt'); B.proxyBox(-52, -0.05, 13, 52, 0, 20, 'asphalt');
  B.proxyBox(-52, -0.05, -42, 52, 0, -20, 'concrete'); B.proxyBox(-52, -0.05, 20, 52, 0, 42, 'concrete');
  ctx.buildings.push({ x0: -10, z0: -31.5, x1: 10, z1: -21.5, floors: 3, destroyed: false, enterable: true, name: 'Hotel Meridian' });
  ctx.buildings.push({ x0: -6, z0: 22, x1: 8, z1: 31, floors: 2, destroyed: false, enterable: true, name: 'pharmacy' });
  // loose loot in the streets
  for (let i = 0; i < 70; i++) {
    const r = S.list[Math.floor(R() * S.list.length)];
    const x = r.x0 + R() * (r.x1 - r.x0), z = r.z0 + R() * (r.z1 - r.z0);
    if (Math.abs(x) < 60 && Math.abs(z) < 46) continue;
    if (!physics.boxFree(x - 0.3, 0.05, z - 0.3, x + 0.3, 1.5, z + 0.3)) continue;
    ctx.loot.push({ x, y: 0.02, z, tier: R() < 0.1 ? 1 : 0 });
  }
  for (const [x, z] of [[-4, 4], [6, -3], [-20, -16.5], [22, 16.5], [-30, 3], [30, -3], [0, 30], [-1, -32.5]]) ctx.loot.push({ x, y: 0.02, z, tier: 0 });

  // invisible walls at the edge
  const E = BR_BOUNDS;
  physics.add(E.minX - 4, 0, E.minZ - 4, E.maxX + 4, 60, E.minZ, 'concrete', { boundary: true });
  physics.add(E.minX - 4, 0, E.maxZ, E.maxX + 4, 60, E.maxZ + 4, 'concrete', { boundary: true });
  physics.add(E.minX - 4, 0, E.minZ, E.minX, 60, E.maxZ, 'concrete', { boundary: true });
  physics.add(E.maxX, 0, E.minZ, E.maxX + 4, 60, E.maxZ, 'concrete', { boundary: true });
  const tGen = performance.now();

  // --- meshes --------------------------------------------------------------------------------------------------
  const group = B.build(scene);
  kit.build(scene);
  const decalMesh = B.decals.build(scene);
  ot.roads.build(scene);
  const cRoot = new THREE.Group();
  cRoot.name = 'brContainers';
  cRoot.userData.dynamic = true;
  for (const g of containerGroups) cRoot.add(g);
  scene.add(cRoot);
  for (const c of cs.list) { c.object.visible = false; c.object.updateMatrixWorld(true); }
  const outer = outerLand(scene, materials, BR_BOUNDS, R);
  void decalMesh;

  // --- level of detail ----------------------------------------------------------------------------------------
  const lod = new LODSwitch(regions, { near: opts.lodNear || 155 });
  regions.list.forEach((r) => {
    lod.add(r.id, B.parts[r.id].detail, B.parts[r.id].proxy);
    lod.addTier(r.id, B.parts[r.id].fine, opts.fineNear || 75);
    if (kit.byRegion.has(r.id)) lod.addTier(r.id, kit.byRegion.get(r.id), opts.windowNear || 125);
  });
  // containers are drawn only within CONTAINER_NEAR of the camera (they all stand indoors)
  const cNear2 = (opts.containerNear || 38) ** 2, cFar2 = ((opts.containerNear || 38) + 4) ** 2;
  let cTick = 0;
  const cullContainers = (p, all) => {
    let changed = false;
    for (let i = (all ? 0 : cTick % 4); i < cs.list.length; i += (all ? 1 : 4)) {
      const o = cs.list[i].object, d2 = (o.position.x - p.x) ** 2 + (o.position.y - p.y) ** 2 + (o.position.z - p.z) ** 2;
      const v = o.visible ? d2 < cFar2 : d2 < cNear2;
      if (v !== o.visible) { o.visible = v; changed = true; }
    }
    cTick++;
    return changed;
  };
  const map = {
    group, bounds: BR_BOUNDS, containers: cs.list, groundLoot: ctx.loot, buildings: ctx.buildings,
    roads: S.rects().concat([{ x0: -52, z0: -20, x1: 52, z1: -13 }, { x0: -52, z0: 13, x1: 52, z1: 20 }]),
    landmarks, hints: B.hints, indoor: B.indoor, lights: B.lights.slice(), signs: B.signs, points: B.points, spawns: B.spawns,
    regions, lod, builder: B, kit, outer, containerRoot: cRoot,
    renderer: opts.renderer || null,
    // the reflection probe for this map: its box must hold every reflecting surface (the town's
    // box is only Old Town's square; outside it the box projection turns dark)
    probe: { position: new THREE.Vector3(2, 6, 9), box: new THREE.Box3(new THREE.Vector3(BR_BOUNDS.minX - 2, -0.2, BR_BOUNDS.minZ - 2), new THREE.Vector3(BR_BOUNDS.maxX + 2, 90, BR_BOUNDS.maxZ + 2)) },
    // coarser bounce-light bake for a map this size (see bakeBounce)
    bake: { step: 4, layers: 4, rays: 12, albedoCell: 2, albedoRoots: B.parts.map((p) => p.proxy).concat([outer]) },
    // the nav graph at a sensible resolution for 420 m (see NavGraph.build)
    nav: { area: { minX: BR_BOUNDS.minX + 2, maxX: BR_BOUNDS.maxX - 2, minZ: BR_BOUNDS.minZ + 2, maxZ: BR_BOUNDS.maxZ - 2 }, opts: { sp: 2.5, link: 3.6, maxY: 14, maxIter: 30000, fast: true } },
    stats: { genMs: Math.round(tGen - t0), meshMs: Math.round(performance.now() - tGen) },
    update(camera, dt = 0) {
      const R2 = map.renderer;
      if (lod.update(camera) && R2) R2.shadowCacheOK = false;
      cullContainers(camera.position, false);
      if (R2 && R2.followShadow) R2.followShadow(camera.position);
      cs.update(dt);
    },
  };
  const start = new THREE.Vector3(0, 1.7, 0);
  lod.update({ position: start });
  cullContainers(start, true);
  map.cullContainers = cullContainers;
  return map;
}

// Containers and loose loot in Old Town's two enterable buildings (placed round their furniture).
function oldTownLoot(ctx, cs) {
  const put = (kind, x, y, z, yaw, tier) => ctx.place(cs.add(kind, x, y, z, yaw, tier));
  const W = -Math.PI / 2, E = Math.PI / 2, N = Math.PI, S = 0;
  // Hotel Meridian: kitchen behind the lobby, three rooms upstairs, the sandbagged top floor
  put('fridge', 3.8, 0, -27.06, N, 0); put('dresser', -5.6, 0, -26.94, S, 0);
  put('wardrobe', -2.06, 3.4, -25, W, 0); put('wardrobe', 2.94, 3.4, -25, W, 1); put('wardrobe', 9.64, 3.4, -25, W, 0);
  put('crate', -6, 6.8, -31.18, S, 2); put('locker', 2.5, 6.8, -31.18, S, 1);
  // Pharmacy: medicine cabinets on the counter wall, a locker in the store, a flat upstairs
  put('medcab', 0.5, 0, 28.34, N, 1); put('medcab', -4.4, 0, 28.34, N, 1); put('locker', 1.6, 0, 30.68, N, 0);
  put('fridge', 0.56, 3.4, 24, E, 0); put('wardrobe', 0.44, 3.4, 23.5, W, 0); put('dresser', -1.0, 3.4, 22.32, S, 0);
  for (const [x, y, z] of [[2, 0, -24], [-3, 3.4, -23.5], [7, 6.8, -26], [3, 0, 24], [-2, 3.4, 27]]) ctx.loot.push({ x, y: y + 0.02, z, tier: 1 });
}
