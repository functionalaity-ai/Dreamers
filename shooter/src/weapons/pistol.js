// P9 Warden: a striker-fired 9 mm with a polymer frame. The slide is built from cross-sections
// (chamfered top edges, cut serrations, an open ejection port); the frame from bevelled side
// profiles (trigger guard opening, beavertail, stippled panels, accessory rail).
import * as THREE from 'three';
import { Q, V, Gun, rb, cz, makeRound, marking } from './gunkit.js';
import { outline, hole, rrect, side, along, turned, turnedX, railParts, dome } from '../core/shapes.js';
import { redDot, suppressor, laserModule } from './attachments.js';

const SY = 0.051;          // slide centre height
const BORE_Y = SY - 0.003; // barrel axis

// Slide cross-section at width w (narrower in the serration grooves), optionally with the
// ejection port's notch cut from the top right.
function slideSection(w = 0.01275, port = false) {
  const pts = [[-w, 0.0362, 0.0008], [w, 0.0362, 0.0008]];
  if (port) pts.push([w, 0.0488, 0.0004], [0.0012, 0.0488, 0.0006], [0.0012, 0.0662, 0.0004]);
  else pts.push([w, 0.0578, 0.001], [w - 0.0032, 0.0662, 0.0022]);
  pts.push([-(w - 0.0032), 0.0662, 0.0022], [-w, 0.0578, 0.001]);
  return outline(pts);
}

function slide(g, M, fp) {
  const S = M.steel, lo = Q.low;
  const sl = g.pivot(g.body, 0, 0, 0, 'slide');
  g.parts.slide = sl;
  if (lo) { g.m(S, along(slideSection(), -0.1555, 0.0295, 0, { flat: true, curve: 2 }), sl); return sl; }
  const parts = [];
  const seg = (z0, z1, sec) => parts.push(along(sec, z0, z1, 0.0005, { curve: 4 }));
  // rear serrations, plain section, ejection port, plain section, front serrations, nose
  let z = 0.0295;
  seg(0.0255, z, slideSection());
  z = 0.0255;
  for (let i = 0; i < 7; i++) { seg(z - 0.0012, z, slideSection(0.0118)); seg(z - 0.0028, z - 0.0012, slideSection()); z -= 0.0028; }
  // the plain sections reach into the port's further than both bevels, so each bevel hides in the
  // other section and the flanks run on without a seam
  seg(-0.0245, z, slideSection());
  seg(-0.0565, -0.023, slideSection(0.01275, true));
  seg(-0.112, -0.055, slideSection());
  z = -0.112;
  for (let i = 0; i < 5; i++) { seg(z - 0.0012, z, slideSection(0.0118)); seg(z - 0.0028, z - 0.0012, slideSection()); z -= 0.0028; }
  seg(-0.1555, z, slideSection());
  g.m(S, parts, sl);
  // Rear cover plate, extractor, sights with tritium dots, and the bore at the muzzle
  g.m(M.anodized, along(rrect(0, 0.047, 0.013, 0.017, 0.002), 0.0293, 0.0302, 0.0003), sl);
  g.m(S, rb(0.0016, 0.0042, 0.026, 0.01285, 0.0505, -0.036, 0.0006), sl);
  g.m(M.anodBlack, along(outline([[-0.0098, 0.0655], [0.0098, 0.0655], [0.0098, 0.0715, 0.0012], [0.0021, 0.0715], [0.0021, 0.0688, 0.0005], [-0.0021, 0.0688, 0.0005], [-0.0021, 0.0715], [-0.0098, 0.0715, 0.0012]]), 0.0165, 0.0265, 0.0004), sl);
  for (const sx of [-0.0055, 0.0055]) g.m(M.tritium, cz(0.0011, 0.0011, 0.0262, 0.0267, sx, 0.0702, 8), sl);
  g.m(M.anodBlack, along(outline([[-0.0017, 0.0655], [0.0017, 0.0655], [0.0015, 0.0722, 0.0006], [-0.0015, 0.0722, 0.0006]]), -0.149, -0.142, 0.0003), sl);
  g.m(M.tritium, cz(0.0011, 0.0011, -0.1418, -0.1414, 0, 0.0712, 8), sl);
  g.m(M.rubber, cz(0.0045, 0.0045, -0.1558, -0.1562, 0, BORE_Y, 14), sl);
  if (fp) {
    // engraved on the slide's left flank, between the front serrations and the port's section
    sl.add(marking('p9-roll', [{ text: 'P9 WARDEN · 9×19', size: 0.8, weight: 700, spacing: 5 }], [512, 56], 0.047, 0.0046, -0.01325, SY - 0.0045, -0.0843, -1));
    sl.add(marking('p9-sn', [{ text: 'WDN 118402', size: 0.78, weight: 600, spacing: 4 }], [384, 56], 0.024, 0.0031, 0.01325, SY - 0.0085, -0.0845, 1));
  }
  return sl;
}

function frame(g, M) {
  const P = M.polymer, S = M.steel, lo = Q.low;
  const cs = lo ? 2 : 10;
  // Dust cover and trigger guard (opening cut through)
  const fr = outline([[0.03, 0.0358, 0.002], [-0.1515, 0.0358, 0.001], [-0.1535, 0.0275, 0.003], [-0.153, 0.0195, 0.002], [-0.064, 0.0165, 0.004], [-0.0605, 0.004, 0.006], [-0.052, -0.0055, 0.008], [-0.02, -0.0055, 0.006], [-0.012, 0.004, 0.006], [0.0, 0.016, 0.004], [0.03, 0.022, 0.004]]);
  if (!lo) fr.holes.push(hole([[-0.0545, 0.0135, 0.004], [-0.0525, 0.0022, 0.005], [-0.0465, -0.0012, 0.004], [-0.0222, -0.0012, 0.004], [-0.0168, 0.0058, 0.004], [-0.0112, 0.0152, 0.003]]));
  g.s(P, side(fr, 0.024, lo ? 0 : 0.0015, { curve: cs, flat: lo }));
  // Grip with beavertail and a flared magwell; raised stippled panels on both sides
  const grip = [[-0.002, 0.016, 0.003], [0.036, 0.0245, 0.004], [0.0435, 0.0215, 0.003], [0.04, 0.012, 0.004], [0.0532, -0.08, 0.004], [0.0545, -0.0912, 0.003], [0.0115, -0.0935, 0.003], [0.0078, -0.085, 0.004], [0.0042, -0.058, 0.006], [0.0062, -0.038, 0.01], [0.0005, -0.022, 0.006], [0.0028, -0.004, 0.004]];
  // the grip's moulded faces dome gently; its stippled panels and the flare ride on the dome
  const gd = lo ? null : dome(outline(grip), 0.0009, 0.007, { curve: cs });
  g.s(P, side(outline(grip), 0.0292, lo ? 0 : 0.0042, { curve: cs, flat: lo, pillow: gd }));
  if (lo) return;
  g.s(P, side(outline([[0.012, -0.012, 0.004], [0.034, -0.008, 0.004], [0.0455, -0.076, 0.005], [0.018, -0.08, 0.005], [0.0125, -0.052, 0.006]]), 0.0304, 0.0009, { pillow: gd }));
  g.s(P, side(outline([[0.0145, -0.0868, 0.002], [0.0548, -0.0842, 0.002], [0.0552, -0.0935, 0.003], [0.0118, -0.0952, 0.003]]), 0.0318, 0.0012, { pillow: gd })); // magwell flare
  // Accessory rail under the dust cover (teeth pointing down)
  const rail = railParts(-0.142, -0.098, 0, false, 0.82).map((r) => r.rotateZ(Math.PI).translate(0, 0.0198, 0));
  g.s(P, rail);
  // Slide stop (left), takedown lever (both sides), mag release (left), trigger pins
  g.s(S, side(outline([[-0.012, 0.0318, 0.001], [-0.056, 0.0332, 0.002], [-0.061, 0.0298, 0.002], [-0.052, 0.0262, 0.002], [-0.014, 0.0275, 0.001]]), 0.0025, 0.0004, { x: -0.0128 }));
  for (const sx of [-1, 1]) g.s(S, side(rrect(-0.068, 0.0296, 0.009, 0.0036, 0.0012), 0.0015, 0.0003, { x: sx * 0.0124 }));
  g.s(P, side(rrect(0.0035, 0.0105, 0.0072, 0.0072, 0.0016), 0.003, 0.0006, { x: -0.0122 }));
  for (const [y, z] of [[0.0255, -0.044], [0.024, -0.008]]) for (const sx of [-1, 1]) g.s(S, turnedX(sx < 0 ? [[0, -0.0125], [0.0013, -0.0125], [0.0013, -0.0118], [0, -0.0117]] : [[0, 0.0117], [0.0013, 0.0118], [0.0013, 0.0125], [0, 0.0125]], 10, y, z));
}

export function buildWarden(M, att, opts) {
  const g = new Gun('warden', M);
  const S = M.steel, lo = Q.low;
  const sl = slide(g, M, opts.fp);
  frame(g, M);
  // Barrel: hood in the port, crown at the muzzle
  if (!lo) {
    g.s(M.nickel, rb(0.0108, 0.0066, 0.033, 0.0058, 0.0532, -0.0395, 0.0012));
    g.s(S, turned([[0, -0.1557], [0.0055, -0.1557], [0.0058, -0.1545], [0.0058, -0.06], [0, -0.06]], 18, 0, BORE_Y));
  }
  // Trigger with its centre safety blade
  const trig = g.pivot(g.body, 0, 0.012, -0.03, 'trigger');
  g.m(M.polymer, side(outline([[0.0015, 0.002, 0.001], [0.0035, -0.006, 0.002], [0.0012, -0.013, 0.003], [-0.004, -0.0185, 0.002], [-0.0055, -0.0165, 0.001], [-0.0016, -0.0085, 0.003], [-0.0015, -0.001, 0.001]]), 0.0062, lo ? 0 : 0.0007, { curve: lo ? 2 : 6, flat: lo }), trig);
  if (!lo) g.m(S, side(outline([[0.0005, -0.004], [0.0018, -0.006], [-0.0012, -0.0145, 0.0008], [-0.0024, -0.0135]]), 0.0016, 0.0002), trig);
  g.parts.trigger = trig;
  let muzzleZ = -0.156;
  if (att.muzzle === 'suppressor') {
    g.s(S, cz(0.0055, 0.0055, -0.156, -0.168, 0, BORE_Y, 14));
    muzzleZ = -0.168 - suppressor(g, M, -0.168, BORE_Y, 0.016, 0.14);
  }
  g.anchors.muzzle = V(0, BORE_Y, muzzleZ - 0.008);
  // Optic (slide-mounted, moves with the slide)
  if (att.optic === 'reddot') {
    const o = redDot({ body: sl }, M, SY + 0.015, -0.005, true);
    g.sight = { y: o.axisY, z: 0.22, reticleZ: o.reticleZ, kind: 'dot', onSlide: true };
  } else {
    g.sight = { y: SY + 0.0205, z: 0.25, kind: 'iron' };
  }
  if (att.laser) g.anchors.laser = laserModule(g, M, 0, 0.002, -0.11);
  g.mag = buildPistolMag(M, att.magazine === 'extmag', opts.fp);
  g.body.add(g.mag.group);
  g.anchors.grip = V(0, -0.04, 0.028);
  g.anchors.fore = V(-0.004, -0.05, 0.012);
  g.foreGrip = 'cup';
  g.anchors.eject = V(0.012, SY + 0.012, -0.035);
  g.anchors.magWell = V(0, -0.1, 0.03);
  g.caliber = '9mm';
  return g;
}

function buildPistolMag(M, ext, fp) {
  const grp = new THREE.Group();
  grp.name = 'mag';
  const lo = Q.low;
  const bottom = ext ? -0.112 : -0.094;
  const body = outline([[0.0085, 0.014, 0.002], [0.036, 0.02, 0.002], [0.048, bottom + 0.004, 0.002], [0.0165, bottom + 0.002, 0.002], [0.0065, -0.03, 0.004]]);
  grp.add(new THREE.Mesh(side(body, 0.02, lo ? 0 : 0.0012, { curve: lo ? 2 : 6, flat: lo }), M.steel));
  // polymer base plate with a finger lip
  grp.add(new THREE.Mesh(side(outline([[0.0135, bottom + 0.0045, 0.002], [0.0505, bottom + 0.0065, 0.002], [0.0535, bottom - (ext ? 0.014 : 0.006), 0.003], [0.0105, bottom - (ext ? 0.016 : 0.008), 0.003]]), 0.0312, lo ? 0 : 0.0018, { curve: lo ? 2 : 6, flat: lo }), M.polymer));
  const rounds = [];
  if (fp) {
    const r = makeRound(M, '9mm');
    r.position.set(0, 0.022, 0.03);
    grp.add(r);
    rounds.push(r);
  }
  return { group: grp, rounds, window: [], capacity: ext ? 21 : 17, setAmmo(n) { for (const r of rounds) r.visible = n > 0; } };
}
