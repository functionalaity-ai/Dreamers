// M12 Bastion: a 12-gauge pump. A split receiver with a real ejection port, a vent rib on
// bevelled posts, a grooved pump on action bars, a knurled magazine cap and a side saddle.
import * as THREE from 'three';
import { Q, V, Gun, rb, cy, makeRound, marking } from './gunkit.js';
import { outline, hole, slot as slotPath, rrect, side, along, turned, turnedX, railParts, dome } from '../core/shapes.js';
import { redDot, laserModule } from './attachments.js';

const BORE = 0.034;   // barrel axis
const TUBE = -0.0005; // magazine tube axis

function receiver(g, M, fp) {
  const S = M.steel, A = M.anodized, lo = Q.low, B = lo ? 0 : 0.0012;
  // Side profile: a gentle hump at the rear where it meets the stock, flat bottom with the
  // loading port, rounded front where the barrel and tube enter.
  const prof = [[0.07, -0.006, 0.004], [0.07, 0.044, 0.006], [0.052, 0.0515, 0.004], [-0.122, 0.0515, 0.003], [-0.131, 0.045, 0.004], [-0.131, -0.0015, 0.005], [-0.12, -0.007, 0.003], [0.06, -0.007, 0.003]];
  if (lo) { g.s(S, side(outline(prof), 0.031, 0, { curve: 2, flat: true })); return; }
  g.s(S, side(outline(prof), 0.0175, B, { x: -0.00675 }));
  const right = outline(prof);
  right.holes.push(hole([[-0.076, 0.0155, 0.002], [-0.006, 0.0155, 0.002], [-0.006, 0.0415, 0.002], [-0.076, 0.0415, 0.002]]));
  g.s(S, side(right, 0.0155, B, { x: 0.00775 }));
  // Bolt face and elevator seen through the ports
  g.s(M.rubber, rb(0.012, 0.024, 0.07, 0.004, 0.0285, -0.041, 0.001));
  g.s(M.nickel, rb(0.0018, 0.012, 0.03, 0.0098, 0.03, -0.024, 0.0006));
  g.s(M.rubber, rb(0.022, 0.0012, 0.082, 0, -0.0068, -0.04, 0.0004)); // loading port
  // Raised machined panels ahead of the port, both sides
  for (const sx of [-1, 1]) g.s(S, side(rrect(-0.096, 0.026, 0.028, 0.0335, 0.004), 0.0016, 0.0004, { x: sx * 0.01555 }));
  // Top rail for an optic; receiver pins; cross-bolt safety in the trigger guard; action release
  g.s(A, railParts(-0.112, 0.048, 0.0515, false, 0.92));
  for (const [y, z] of [[0.004, 0.052], [0.004, -0.102]]) for (const sx of [-1, 1]) g.s(S, turnedX(sx < 0 ? [[0, -0.0163], [0.0026, -0.0163], [0.0026, -0.0154], [0, -0.0153]] : [[0, 0.0153], [0.0026, 0.0154], [0.0026, 0.0163], [0, 0.0163]], 12, y, z));
  g.s(S, side(outline([[-0.012, 0.0028, 0.001], [-0.026, 0.0035, 0.002], [-0.028, -0.004, 0.002], [-0.014, -0.0035, 0.001]]), 0.0028, 0.0005, { x: -0.0164 }));
  if (fp) {
    // The roll mark goes on the right, behind the ejection port (the side saddle covers the left);
    // the serial number sits on the left, behind the saddle.
    g.body.add(marking('m12-roll', [{ text: 'M12 BASTION · 12 GA', size: 0.8, weight: 700, spacing: 4 }, { text: '2¾" & 3" SHELLS', size: 0.62, spacing: 3 }], [512, 120], 0.056, 0.0118, 0.0155, 0.0292, 0.0335, 1));
    g.body.add(marking('m12-sn', [{ text: 'SN M12-207514', size: 0.78, spacing: 3 }], [384, 56], 0.034, 0.0045, -0.0155, 0.0262, 0.0435, -1));
  }
}

function trigger(g, M) {
  const A = M.anodBlack, S = M.steel, lo = Q.low;
  const tg = outline([[0.072, -0.006], [0.07, -0.024, 0.008], [-0.012, -0.026, 0.006], [-0.02, -0.018, 0.004], [-0.02, -0.006]]);
  if (!lo) tg.holes.push(hole([[0.06, -0.0085, 0.003], [0.059, -0.0198, 0.006], [-0.006, -0.0208, 0.005], [-0.0118, -0.0145, 0.003], [-0.012, -0.0085, 0.002]]));
  g.s(A, side(tg, 0.0135, lo ? 0 : 0.0012, { curve: lo ? 2 : 8, flat: lo }));
  if (!lo) g.s(S, turnedX([[0, -0.0098], [0.003, -0.0098], [0.003, 0.0098], [0, 0.0098]], 14, -0.0035, 0.056)); // cross-bolt
  const trig = g.pivot(g.body, 0, -0.005, 0.03, 'trigger');
  g.m(S, side(outline([[0.0018, 0.002, 0.001], [0.004, -0.006, 0.002], [0.0016, -0.0135, 0.003], [-0.0042, -0.0215, 0.002], [-0.0058, -0.0195, 0.001], [-0.0018, -0.0105, 0.003], [-0.0018, -0.002, 0.001]]), 0.0052, lo ? 0 : 0.0006, { curve: lo ? 2 : 6, flat: lo }), trig);
  g.parts.trigger = trig;
}

function barrelAndTube(g, M, att) {
  const S = M.steel, lo = Q.low;
  g.s(S, turned([[0, -0.6005], [0.0108, -0.6005], [0.0118, -0.599], [0.0118, -0.14], [0.0136, -0.136], [0.0136, -0.125], [0, -0.125]], lo ? 10 : 26, 0, BORE));
  if (!lo) g.s(M.rubber, new THREE.CircleGeometry(0.0094, 20).rotateY(Math.PI).translate(0, BORE, -0.6008));
  // Vent rib: a chamfered strip on posts with real gaps between them, beads front and middle
  const rib = outline([[-0.0042, 0], [0.0042, 0], [0.0036, 0.0028, 0.0006], [-0.0036, 0.0028, 0.0006]]);
  g.s(S, along(rib, -0.592, -0.145, lo ? 0 : 0.0004, { y: BORE + 0.0138, flat: lo }));
  if (!lo) for (let z = -0.155; z > -0.59; z -= 0.032) g.s(S, along(outline([[-0.0022, 0], [0.0022, 0], [0.0018, 0.0034], [-0.0018, 0.0034]]), z - 0.004, z, 0.0003, { y: BORE + 0.0108, flat: true }));
  g.s(S, rb(0.0045, 0.009, 0.007, 0, BORE + 0.02, -0.589, 0.001));
  g.s(M.brass, new THREE.SphereGeometry(0.0024, 12, 10).translate(0, BORE + 0.0262, -0.589));
  if (!lo) g.s(M.nickel, new THREE.SphereGeometry(0.0013, 8, 6).translate(0, BORE + 0.0172, -0.37));
  let muzzleZ = -0.6;
  if (att.muzzle === 'choke') {
    g.s(S, turned([[0, -0.636], [0.0122, -0.636], [0.0128, -0.634], [0.0128, -0.6], [0, -0.6]], lo ? 10 : 24, 0, BORE));
    if (!lo) for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) g.s(M.rubber, rb(0.0022, 0.0062, 0.0048, sx * 0.0122, BORE + 0.003, -0.607 - i * 0.0072, 0.0008));
    muzzleZ = -0.636;
  }
  g.anchors.muzzle = V(0, BORE, muzzleZ - 0.01);
  // Magazine tube, knurled cap, barrel clamp with a sling loop
  const ext = att.magazine === 'extmag';
  const tubeEnd = ext ? -0.58 : -0.52;
  g.s(S, turned([[0, tubeEnd], [0.0112, tubeEnd], [0.0112, -0.13], [0, -0.13]], lo ? 10 : 22, 0, TUBE));
  const cap = [[0, tubeEnd - 0.021], [0.009, tubeEnd - 0.021], [0.0118, tubeEnd - 0.018]];
  if (!lo) for (let i = 0; i < 6; i++) { const z = tubeEnd - 0.016 + i * 0.0026; cap.push([0.0124, z], [0.0119, z + 0.0013]); }
  cap.push([0.0122, tubeEnd], [0, tubeEnd]);
  g.s(S, turned(cap, lo ? 10 : 24, 0, TUBE));
  g.s(S, side(outline([[tubeEnd + 0.012, BORE + 0.0105, 0.003], [tubeEnd + 0.03, BORE + 0.0105, 0.003], [tubeEnd + 0.03, TUBE - 0.012, 0.004], [tubeEnd + 0.012, TUBE - 0.012, 0.004]]), 0.012, lo ? 0 : 0.001, { flat: lo }));
  if (!lo) g.s(S, turnedX([[0, -0.0072], [0.0028, -0.0072], [0.0028, 0.0072], [0, 0.0072]], 10, TUBE - 0.0155, tubeEnd + 0.021));
}

function pump(g, M) {
  const P = M.polymer, S = M.steel, lo = Q.low;
  const pp = g.pivot(g.body, 0, 0, 0, 'pump');
  // grooved forend turned round the tube; the action bars run back to the receiver
  // (its moulded end faces dome slightly instead of being flat discs)
  const prof = lo ? [[0, -0.362], [0.0185, -0.362], [0.0212, -0.357]] : [[0, -0.3636], [0.01, -0.3632], [0.0185, -0.362], [0.0212, -0.357]];
  for (let i = 0; i < (lo ? 0 : 10); i++) { const z = -0.348 + i * 0.0135; prof.push([0.0212, z - 0.0035], [0.0198, z - 0.0018], [0.0198, z + 0.0018], [0.0212, z + 0.0035]); }
  prof.push([0.0212, -0.206], [0.019, -0.2]);
  if (!lo) prof.push([0.01, -0.1994]);
  prof.push([0, lo ? -0.2 : -0.199]);
  const fg = turned(prof, lo ? 10 : 28, 0, -0.002);
  fg.scale(1, 1.08, 1);
  g.m(P, fg, pp);
  if (!lo) for (const sx of [-1, 1]) g.m(S, rb(0.0022, 0.0042, 0.17, sx * 0.0128, TUBE + 0.002, -0.13 - 0.085 + 0.01, 0.0006), pp);
  g.parts.pump = pp;
}

function stock(g, M) {
  const P = M.polymer, lo = Q.low;
  const cs = lo ? 2 : 12;
  const pts = [[0.068, 0.049, 0.004], [0.068, -0.006, 0.004], [0.112, -0.028, 0.01], [0.142, -0.07, 0.012], [0.1665, -0.076, 0.006], [0.172, -0.064, 0.006], [0.168, -0.042, 0.01], [0.42, -0.086, 0.01], [0.433, -0.091, 0.004], [0.434, 0.023, 0.004], [0.412, 0.03, 0.006], [0.17, 0.036, 0.04], [0.09, 0.05, 0.006]];
  const body = outline(pts);
  let sd = null;
  if (!lo) {
    // a long recessed panel on each side, and a sling slot through the toe
    const recess = [[0.205, 0.012, 0.01], [0.398, -0.004, 0.012], [0.402, -0.06, 0.012], [0.24, -0.042, 0.016], [0.198, -0.022, 0.01]];
    body.holes.push(hole(recess));
    g.s(P, side(outline(recess), 0.032, 0.0012, { curve: cs, pillow: dome(outline(recess), 0.0008, 0.008, { curve: cs }) }));
    body.holes.push(slotPath(0.405, -0.075, 0.026, 0.0068, -0.18));
    // the moulded faces dome gently; the stippled grip panels ride on the dome
    sd = dome(body, 0.0013, 0.009, { curve: cs });
  }
  g.s(P, side(body, 0.04, lo ? 0 : 0.0052, { curve: cs, flat: lo, pillow: sd }));
  if (lo) { g.s(M.rubber, rb(0.042, 0.122, 0.024, 0, -0.034, 0.444, 0.005)); return; }
  // Stippled grip panels, the recoil pad with its ribs, and a sling stud
  g.s(P, side(outline([[0.104, -0.026, 0.006], [0.134, -0.02, 0.006], [0.16, -0.062, 0.006], [0.144, -0.068, 0.006], [0.124, -0.05, 0.008]]), 0.0412, 0.0008, { pillow: sd }));
  g.s(M.rubber, side(outline([[0.432, 0.0262, 0.003], [0.452, 0.0262, 0.004], [0.4545, -0.0952, 0.005], [0.432, -0.0945, 0.003]]), 0.0428, 0.0024, { curve: 8 }));
  for (let i = 0; i < 9; i++) g.s(M.rubber, rb(0.04, 0.0016, 0.0018, 0, 0.018 - i * 0.0128, 0.4552 + i * 0.0003, 0.0006));
  g.s(M.steel, cy(0.0034, 0.009, 0, -0.0835, 0.392, 12)); // sling stud
}

function saddle(g, M) {
  const P = M.polymer, lo = Q.low;
  const plate = rrect(-0.03, 0.026, 0.092, 0.034, 0.003);
  g.s(P, side(plate, 0.008, lo ? 0 : 0.0012, { x: -0.0195, flat: lo }));
  const shells = [];
  for (let i = 0; i < 4; i++) {
    const r = makeRound(M, 'shell');
    r.rotation.x = -Math.PI / 2; // hanging brass-up, below the sight line
    r.position.set(-0.033, 0.044, -0.062 + i * 0.022);
    g.body.add(r);
    shells.push(r);
    if (!lo) g.s(P, side(rrect(-0.062 + i * 0.022, 0.012, 0.004, 0.026, 0.0012), 0.012, 0.0006, { x: -0.0262 }));
  }
  g.saddle = shells;
}

export function buildBastion(M, att, opts) {
  const g = new Gun('bastion', M);
  receiver(g, M, opts.fp);
  trigger(g, M);
  barrelAndTube(g, M, att);
  pump(g, M);
  stock(g, M);
  saddle(g, M);
  if (att.optic === 'reddot') { const o = redDot(g, M, 0.058, -0.03); g.sight = { y: o.axisY, z: o.eyeZ + 0.13, reticleZ: o.reticleZ, kind: 'dot' }; }
  else g.sight = { y: 0.065, z: 0.4, kind: 'iron' };
  if (att.laser) g.anchors.laser = laserModule(g, M, 0.03, 0.0, -0.48);
  // A shell that appears in the port as it cycles
  const ejectShell = makeRound(M, 'shell');
  ejectShell.rotation.y = Math.PI / 2;
  ejectShell.position.set(0.006, 0.028, -0.04);
  ejectShell.visible = false;
  g.body.add(ejectShell);
  g.parts.portShell = ejectShell;
  g.mag = { group: new THREE.Group(), rounds: [], window: [], capacity: att.magazine === 'extmag' ? 8 : 6, setAmmo() {} };
  g.anchors.grip = V(0, -0.045, 0.15);
  g.anchors.fore = V(0, -0.012, -0.29);
  g.foreGrip = 'pump';
  g.anchors.eject = V(0.018, 0.03, -0.04);
  g.anchors.magWell = V(0, -0.01, -0.05);
  g.caliber = 'shell';
  return g;
}
