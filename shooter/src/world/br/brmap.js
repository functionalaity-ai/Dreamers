// STUB — replaced at merge. Old Town standing in for the Battle Royale map, with a handful of fake
// loot containers and ground-loot spots, so the match crew can build against the map contract
// (buildBRMap / Container) before the real Outskirts map lands.
import * as THREE from 'three';
import { buildOldTown } from '../oldtown.js';
import { Container } from './containers.js';

export const BR_BOUNDS = { minX: -60, minZ: -46, maxX: 60, maxZ: 46 };   // STUB: Old Town's extent

const H = 3.4;
// [kind, x, floor, z, yaw (front faces the floor point), tier]
const CONTAINERS = [
  ['fridge', 4.5, 0, -30.2, Math.PI, 0], ['cabinet', -8.6, 0, -23, -Math.PI / 2, 0],
  ['wardrobe', -8.5, 1, -25, -Math.PI / 2, 1], ['dresser', 1.8, 1, -25.2, Math.PI / 2, 0], ['locker', 8.6, 1, -25, Math.PI / 2, 1],
  ['crate', 4, 2, -28.5, Math.PI, 2],
  ['medcab', -3.5, 0, 22.8, Math.PI, 1], ['locker', 6.5, 0, 30, Math.PI / 2, 1], ['fridge', 6.8, 1, 28, Math.PI / 2, 0],
  ['crate', -33, 0, 6, 0, 0], ['crate', 33, 0, -6, Math.PI, 0], ['crate', 8, 0, 10.5, 0, 1],
  ['locker', -48, 0, -10, -Math.PI / 2, 0], ['crate', 45, 0, 5, Math.PI / 2, 1], ['desk', -6, 0, -33.2, 0, 0],
];
const GROUND = [
  [-20, 0, -5, 0], [-10, 0, 12, 0], [10, 0, -12, 0], [25, 0, 10, 1], [-40, 0, 5, 0], [40, 0, -5, 0],
  [-5, 0, -25, 1], [6, 1, -24, 1], [-6, 2, -26, 2], [-3, 0, 25, 1], [-1, 1, 26, 1],
  [-45, 0, -17, 0], [45, 0, 17, 0], [-30, 0, 12, 0], [30, 0, -12, 0], [0, 0, 8, 1],
];

export function buildBRMap(physics, materials, scene) {
  const ot = buildOldTown(physics, materials, scene);
  const floorY = (x, z, f) => physics.groundHeight(x, z, 0.15, f * H + 0.6);
  const containers = CONTAINERS.map(([kind, x, f, z, yaw, tier]) => {
    const c = new Container(kind, new THREE.Vector3(x, floorY(x, z, f), z), yaw, tier);
    scene.add(c.object);
    return c;
  });
  const groundLoot = GROUND.map(([x, f, z, tier]) => ({ x, y: floorY(x, z, f), z, tier }));
  const B = (x0, z0, x1, z1, floors, enterable) => ({ x0, z0, x1, z1, floors, destroyed: false, enterable: !!enterable });
  const buildings = [
    B(-52, -36, -23.2, -22, 5), B(-52, -42, -23.2, -36, 1), B(-23.2, -38, -12, -22, 4), B(-12, -42, 12, -34, 4), B(12, -42, 20, -22, 3),
    B(20, -42, 38, -38, 3), B(38, -42, 52, -22, 4), B(24, -38, 38, -26, 3), B(20, -30, 24.6, -24, 7), B(-10, -31.5, 10, -21.5, 3, true),
    B(-52, 22, -38, 42, 4), B(-31, 22, -20, 42, 3), B(-20, 22, -8, 42, 2), B(-8, 33.5, 10, 42, 2), B(10, 22, 24, 42, 3), B(30, 22, 37.6, 42, 4),
    B(37.6, 22, 53.6, 36, 5), B(37.6, 36, 53.6, 42, 1), B(-6, 22, 8, 31, 2, true), B(-60, -22, -52, 22, 4), B(52, -22, 60, 22, 4),
  ];
  const roads = [{ x0: -52, z0: -20, x1: 52, z1: -13 }, { x0: -52, z0: 13, x1: 52, z1: 20 }, { x0: -38, z0: 22, x1: -31, z1: 40 }, { x0: 24, z0: 22, x1: 30, z1: 40 }];
  const landmarks = [
    { name: 'Hotel Meridian', x: 0, z: -26 }, { name: 'Pharmacy', x: 1, z: 26 }, { name: 'Church', x: 29, z: -32 },
    { name: 'Plaza', x: 0, z: 0 }, { name: 'West Avenue', x: -32, z: 0 }, { name: 'East Avenue', x: 32, z: 0 },
  ];
  return {
    group: ot.group, bounds: BR_BOUNDS, containers, groundLoot, buildings, roads, landmarks,
    hints: ot.hints, indoor: ot.indoor, lights: ot.lights, signs: ot.signs, points: ot.points,
    spawns: { msg: [], volk: [] },
    update(camera, dt) { for (const c of containers) c.update(dt); },
  };
}
