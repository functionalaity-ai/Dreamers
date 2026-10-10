// Hit zones as spheres and capsules around a skeleton's joints.
import * as THREE from 'three';
import { segSphere, segCapsule } from '../weapons/ballistics.js';

const _c0 = new THREE.Vector3(), _c1 = new THREE.Vector3();

// pts: { head, neck, chest, hips, kneeL, kneeR, footL, footR, shL, shR, elL, elR, haL, haR, hipL, hipR }
export function bodyHitTest(pts, a, d, len) {
  // Broad phase: one fat capsule around the whole body.
  _c0.copy(pts.footL).add(pts.footR).multiplyScalar(0.5);
  _c1.copy(pts.head).y += 0.12;
  if (segCapsule(a, d, len, _c0, _c1, 0.55) < 0) return null;
  let best = null;
  const test = (t, zone) => { if (t >= 0 && (!best || t < best.t)) best = { t, zone }; };
  test(segSphere(a, d, len, pts.head, 0.125), 'head');
  test(segCapsule(a, d, len, pts.chest, pts.neck, 0.19), 'chest');
  test(segCapsule(a, d, len, pts.hips, pts.chest, 0.17), 'stomach');
  test(segCapsule(a, d, len, pts.hipL, pts.kneeL, 0.095), 'leg');
  test(segCapsule(a, d, len, pts.hipR, pts.kneeR, 0.095), 'leg');
  test(segCapsule(a, d, len, pts.kneeL, pts.footL, 0.075), 'leg');
  test(segCapsule(a, d, len, pts.kneeR, pts.footR, 0.075), 'leg');
  test(segCapsule(a, d, len, pts.shL, pts.elL, 0.065), 'arm');
  test(segCapsule(a, d, len, pts.shR, pts.elR, 0.065), 'arm');
  test(segCapsule(a, d, len, pts.elL, pts.haL, 0.055), 'arm');
  test(segCapsule(a, d, len, pts.elR, pts.haR, 0.055), 'arm');
  // A head hit through the chest capsule is still a head hit if it reached the sphere first.
  return best;
}

export function makePoints() {
  const p = {};
  for (const k of ['head', 'neck', 'chest', 'hips', 'kneeL', 'kneeR', 'footL', 'footR', 'shL', 'shR', 'elL', 'elR', 'haL', 'haR', 'hipL', 'hipR']) p[k] = new THREE.Vector3();
  return p;
}

// Fill points from a Humanoid's bones.
export function pointsFromHumanoid(h, p) {
  const b = h.b;
  // the skull's centre, following the head as it tilts onto a stock
  b.head.updateWorldMatrix(true, false);
  b.head.localToWorld(p.head.set(0, 0.078, -0.008));
  b.neck.getWorldPosition(p.neck);
  b.chest.getWorldPosition(p.chest); p.chest.y += 0.02;
  b.hips.getWorldPosition(p.hips);
  b.thighL.getWorldPosition(p.hipL); b.thighR.getWorldPosition(p.hipR);
  b.shinL.getWorldPosition(p.kneeL); b.shinR.getWorldPosition(p.kneeR);
  b.footL.getWorldPosition(p.footL); b.footR.getWorldPosition(p.footR);
  b.armL.getWorldPosition(p.shL); b.armR.getWorldPosition(p.shR);
  b.foreL.getWorldPosition(p.elL); b.foreR.getWorldPosition(p.elR);
  b.handL.getWorldPosition(p.haL); b.handR.getWorldPosition(p.haR);
  return p;
}

// The player has no visible body, so build points from feet position, eye and yaw.
export function pointsFromStance(feet, eyeY, yaw, p) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const rx = c, rz = -s; // right vector
  const h = eyeY - feet.y;
  const k = h / 1.66;
  p.head.set(feet.x, eyeY + 0.04, feet.z);
  p.neck.set(feet.x, feet.y + h * 0.9, feet.z);
  p.chest.set(feet.x, feet.y + h * 0.78, feet.z);
  p.hips.set(feet.x, feet.y + h * 0.57, feet.z);
  for (const [side, sx] of [['L', -1], ['R', 1]]) {
    p['hip' + side].set(feet.x + rx * 0.1 * sx, feet.y + h * 0.55, feet.z + rz * 0.1 * sx);
    p['knee' + side].set(feet.x + rx * 0.1 * sx, feet.y + 0.5 * k, feet.z + rz * 0.1 * sx);
    p['foot' + side].set(feet.x + rx * 0.1 * sx, feet.y + 0.08, feet.z + rz * 0.1 * sx);
    p['sh' + side].set(feet.x + rx * 0.2 * sx, feet.y + h * 0.86, feet.z + rz * 0.2 * sx);
    p['el' + side].set(feet.x + rx * 0.22 * sx, feet.y + h * 0.7, feet.z + rz * 0.22 * sx);
    p['ha' + side].set(feet.x + rx * 0.1 * sx, feet.y + h * 0.75, feet.z + rz * 0.1 * sx);
  }
  return p;
}
