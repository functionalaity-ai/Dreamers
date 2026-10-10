// KR-5 Kestrel: a 5.56 AR with a 15-inch M-LOK rail. Every part is a bevelled extrusion of
// its real outline, with the slots, ports and windows cut through, so nothing reads as a box.
import * as THREE from 'three';
import { Q, V, Gun, rb, cz, cy, makeRound, marking, MARK_FONT } from './gunkit.js';
import { outline, hole, slot, circle, rrect, sector, ring, side, along, plate, turned, turnedX, railParts, dome } from '../core/shapes.js';
import { redDot, scope4x, suppressor, compensator, laserModule } from './attachments.js';

const BORE = 0.016;     // barrel axis height
const RAIL_Y = 0.0405;  // top of the receiver and handguard, where the rail's base sits

// --- receivers -----------------------------------------------------------------------------
function upper(g, M) {
  const A = M.anodized, lo = Q.low, B = lo ? 0 : 0.0008;
  const prof = [[0.085, 0.004, 0.002], [0.085, RAIL_Y, 0.0015], [-0.172, RAIL_Y, 0.0015], [-0.172, 0.006, 0.002], [-0.162, 0.002, 0.003], [0.07, 0.002, 0.002]];
  if (lo) { g.s(A, side(outline(prof), 0.0238, 0, { curve: 2, flat: true })); g.s(A, railParts(0.083, -0.172, RAIL_Y, true)); return; }
  // Two halves that overlap inside: the left is solid, the right has the ejection port cut through.
  g.s(A, side(outline(prof), 0.0139, B, { x: -0.00495 }));
  const right = outline(prof);
  right.holes.push(hole([[-0.07, 0.0135, 0.0015], [-0.006, 0.0135, 0.0015], [-0.006, 0.0315, 0.0015], [-0.07, 0.0315, 0.0015]]));
  g.s(A, side(right, 0.0119, B, { x: 0.00595 }));
  // The flat-top's wider shoulder under the rail
  g.s(A, side(outline([[0.083, 0.0302, 0.001], [0.083, RAIL_Y - 0.0004], [-0.17, RAIL_Y - 0.0004], [-0.17, 0.0302, 0.001]]), 0.0252, 0.0006));
  g.s(A, railParts(0.083, -0.172, RAIL_Y));
  // Bolt carrier behind the port, and the bolt face that cycles (hidden inside the walls when back)
  g.s(M.steel, rb(0.0074, 0.0186, 0.066, 0.0058, 0.0225, -0.038, 0.0008));
  g.s(M.steel, turnedX([[0.0021, 0.009], [0.0021, 0.0101], [0.0016, 0.0104], [0, 0.0105]], 10, 0.0255, -0.028)); // cam pin
  const bolt = g.m(M.nickel, rb(0.0014, 0.011, 0.028, 0.0101, 0.0205, -0.052, 0.0005), g.body, 'bolt');
  g.parts.bolt = bolt;
  g.parts.boltRest = bolt.position.clone();
  // Dust cover on a hinge rod, with its stiffening rib
  g.s(M.steel, cz(0.0008, 0.0008, -0.072, -0.004, 0.0121, 0.0126, 8));
  const dc = g.pivot(g.body, 0.01225, 0.0126, -0.038, 'dustCover');
  g.m(A, [side(rrect(0, 0.0101, 0.0676, 0.0198, 0.0012), 0.0011, 0.0003), side(rrect(-0.004, 0.0122, 0.042, 0.004, 0.0015), 0.0017, 0.0005, { x: 0.0003 })], dc);
  g.parts.dustCover = dc;
  // Brass deflector and forward assist (right side, rear)
  g.s(A, side(outline([[0.002, 0.0322, 0.002], [0.024, 0.0372, 0.004], [0.026, 0.0255, 0.006], [0.008, 0.0195, 0.004]]), 0.0068, 0.0009, { x: 0.0152 }));
  g.s(A, turned([[0, 0.028], [0.0034, 0.028], [0.0061, 0.038, 0.002], [0.0061, 0.068], [0.0057, 0.0712], [0, 0.0712]], 22, 0.0124, 0.0285));
  g.s(M.steel, turned([[0, 0.071], [0.0047, 0.071], [0.0051, 0.0722], [0.0047, 0.0734], [0.0051, 0.0746], [0.0047, 0.0758], [0.0051, 0.077], [0.0047, 0.0782], [0.0049, 0.0794], [0.0041, 0.0806], [0, 0.0808]], 22, 0.0124, 0.0285));
  // Charging handle: T-handle with its latch on the left wing
  g.s(A, plate(outline([[-0.0215, 0.0862, 0.0018], [0.0215, 0.0862, 0.0018], [0.0215, 0.0935, 0.003], [0.008, 0.0992, 0.003], [-0.008, 0.0992, 0.003], [-0.0215, 0.0935, 0.003]]), 0.0056, 0.0008, { y: 0.0362 }));
  g.s(A, rb(0.0115, 0.004, 0.018, 0, 0.0355, 0.079, 0.0008));
  g.s(M.steel, rb(0.0075, 0.0032, 0.0085, -0.0165, 0.0398, 0.0915, 0.0008));
  for (let i = 0; i < 3; i++) g.s(M.steel, rb(0.0076, 0.0008, 0.0012, -0.0165, 0.0417, 0.0885 + i * 0.0028, 0.0003));
}

function lower(g, M, fp, finish) {
  const A = M.anodized, S = M.steel, lo = Q.low, B = lo ? 0 : 0.0009;
  // Fire-control housing at the rear; the wider magwell block with the pivot lug at the front.
  const rear = [[0.084, 0.0022, 0.002], [0.084, -0.016, 0.004], [0.064, -0.0265, 0.006], [0.028, -0.0285, 0.004], [-0.047, -0.0285, 0.003], [-0.0555, -0.031, 0.001], [-0.0555, 0.0022, 0.001]];
  g.s(A, side(outline(rear), 0.0222, B, { curve: lo ? 2 : 6, flat: lo }));
  const front = [[-0.054, 0.0022, 0.002], [-0.054, -0.031, 0.001], [-0.127, -0.031, 0.002], [-0.126, -0.022, 0.004], [-0.1315, -0.0165, 0.003], [-0.1315, 0.0022, 0.002]];
  g.s(A, side(outline(front), 0.0262, B, { curve: lo ? 2 : 6, flat: lo }));
  // Magwell: a hollow, slightly wider tube with a flared lip (outlines seen from above, [x, z])
  const well = rrect(0, -0.093, 0.0262, 0.077, 0.003);
  if (!lo) well.holes.push(rrect(0, -0.093, 0.0233, 0.074, 0.0015, new THREE.Path()));
  g.s(A, plate(well, 0.0345, lo ? 0 : 0.0008, { y: -0.04725, flat: lo }));
  const lip = rrect(0, -0.093, 0.0292, 0.0795, 0.0035);
  if (!lo) lip.holes.push(rrect(0, -0.093, 0.0233, 0.074, 0.0015, new THREE.Path()));
  g.s(A, plate(lip, 0.0072, lo ? 0 : 0.0012, { y: -0.0651, flat: lo }));
  // Trigger guard with the finger opening cut through
  const tg = outline([[0.03, -0.0262], [0.0285, -0.0555, 0.009], [-0.05, -0.0585, 0.006], [-0.0548, -0.052, 0.003], [-0.0548, -0.03]]);
  tg.holes.push(hole([[0.0185, -0.031, 0.004], [0.0175, -0.0508, 0.007], [-0.0465, -0.0523, 0.006], [-0.0468, -0.031, 0.002]]));
  g.s(A, side(tg, 0.0126, lo ? 0 : 0.0012, { curve: lo ? 2 : 8, flat: lo }));
  if (lo) return;
  // Mag release button inside its fence (right), bolt catch paddle (left)
  g.s(A, side(sector(0.0058, 0.0079, Math.PI * 0.95, Math.PI * 2.08, 10), 0.003, 0.0006, { x: 0.0118 }).translate(0, -0.0245, -0.048));
  g.s(S, turnedX([[0.0043, 0.0105], [0.0043, 0.0124], [0.0039, 0.0131], [0, 0.0132]], 18, -0.0245, -0.048));
  g.s(A, side(outline([[-0.029, -0.003, 0.0015], [-0.041, -0.003, 0.0015], [-0.0455, -0.0165, 0.003], [-0.0335, -0.0175, 0.002]]), 0.003, 0.0005, { x: -0.0122 }));
  for (let i = 0; i < 4; i++) g.s(A, rb(0.0012, 0.0008, 0.009, -0.0138, -0.0068 - i * 0.0026, -0.0375, 0.0003));
  g.s(A, side(outline([[-0.026, 0.0016, 0.002], [-0.049, 0.0016, 0.002], [-0.049, -0.002, 0.001], [-0.026, -0.002, 0.001]]), 0.003, 0.0005, { x: -0.0118 })); // bolt catch ear
  // Pins: rear takedown, front pivot, hammer and trigger (heads both sides)
  for (const [y, z, r] of [[-0.0062, 0.072, 0.0031], [-0.0085, -0.1255, 0.0031], [-0.0136, 0.0125, 0.0024], [-0.0136, -0.0085, 0.0024]]) {
    g.s(S, turnedX([[0, -0.0118], [r, -0.0117], [r, -0.0111], [r * 0.6, -0.011]], 14, y, z));
    g.s(S, turnedX([[r * 0.6, 0.011], [r, 0.0111], [r, 0.0116], [0, 0.0117]], 14, y, z));
  }
  // Buffer tower: end plate with its QD socket, castle nut, and the receiver extension
  g.s(A, side(rrect(0.0868, 0.0075, 0.004, 0.036, 0.0018), 0.027, 0.0006));
  g.s(S, turnedX([[0, -0.0168], [0.0045, -0.0168], [0.0047, -0.0145], [0.0047, -0.0135], [0, -0.0135]], 14, -0.005, 0.0868));
  g.s(M.rubber, turnedX([[0, -0.0172], [0.0025, -0.0172], [0, -0.0169]], 10, -0.005, 0.0868));
  g.s(S, turned([[0.0155, 0.0888], [0.0168, 0.0888], [0.0185, 0.0892], [0.0185, 0.0968], [0.0168, 0.0975], [0.0155, 0.0975]], 28, 0, 0.012));
  for (const a of [0.5, 2.6, 4.7]) g.s(M.rubber, rb(0.0024, 0.0045, 0.0082, 0.0181, 0, 0, 0.0004).rotateZ(a).translate(0, 0.012, 0.0932));
  if (fp) {
    // Roll mark on the magwell's left wall; selector positions engraved round the selector on both
    // sides (the lever points forward at SAFE, up at SEMI, back at AUTO). Cut through Cerakote the
    // marks show the dark anodising beneath; on bare black anodising they are laser-bleached.
    const style = finish === 'black' ? 'laser' : 'engrave';
    g.body.add(marking('kr-roll', [{ text: 'KR-5 KESTREL', size: 0.74, weight: 700, spacing: 4 }, { text: 'CAL 5.56 NATO', size: 0.6, spacing: 3 }, { text: 'IM 004217', size: 0.6, spacing: 3 }], [512, 176], 0.05, 0.0172, -0.0139, -0.0466, -0.0925, -1, { style }));
    for (const sx of [-1, 1]) {
      for (const [word, z, y] of [['SAFE', 0.0145, -0.0088], ['SEMI', 0.035, -0.0035], ['AUTO', 0.0555, -0.0088]]) {
        g.body.add(marking('kr-' + word, [{ text: word, size: 0.86, weight: 700, spacing: 3 }], [192, 64], 0.0092, 0.0031, sx * 0.0111, y, z, sx, { style }));
      }
    }
  }
}

function controls(g, M) {
  const S = M.steel, lo = Q.low;
  // Trigger (pivots on its pin)
  const trig = g.pivot(g.body, 0, -0.0136, -0.0085, 'trigger');
  g.m(S, side(outline([[0.0025, 0.002, 0.001], [0.0045, -0.006, 0.002], [0.0022, -0.016, 0.004], [-0.0045, -0.0262, 0.003], [-0.0062, -0.0245, 0.0015], [-0.0012, -0.014, 0.004], [-0.0018, -0.004, 0.001]]), 0.0052, lo ? 0 : 0.0006, { curve: lo ? 2 : 6, flat: lo }), trig);
  g.parts.trigger = trig;
  // Fire selector (left side) with its pointer
  const sel = g.pivot(g.body, -0.0125, -0.012, 0.035, 'selector');
  g.m(S, side(outline([[0.004, -0.0022, 0.0012], [0.004, 0.0022, 0.0012], [-0.0135, 0.0026, 0.002], [-0.0158, 0, 0.0016], [-0.0135, -0.0026, 0.002]]), 0.0022, lo ? 0 : 0.0004, { x: -0.0006, flat: lo }), sel);
  g.m(S, turnedX([[0, -0.0024], [0.0046, -0.0024], [0.0049, -0.0012], [0.0049, 0.0008], [0, 0.0008]], 18), sel);
  if (!lo) {
    // the short ambidextrous lever on the right, on the same shaft
    g.m(S, side(outline([[0.003, -0.0019, 0.001], [0.003, 0.0019, 0.001], [-0.0082, 0.0021, 0.0014], [-0.0096, 0, 0.001], [-0.0082, -0.0021, 0.0014]]), 0.0019, 0.0004, { x: 0.0256 }), sel);
    g.m(S, turnedX([[0, 0.0236], [0.0042, 0.0236], [0.0042, 0.0244], [0.0038, 0.0249], [0, 0.0249]], 16), sel);
  }
  g.parts.selector = sel;
}

function furniture(g, M) {
  const P = M.polymer, lo = Q.low;
  const cs = lo ? 3 : 12;
  // Pistol grip: beavertail, a front finger swell, a raised textured panel and a separate cap
  const grip = [[0.021, -0.025, 0.002], [0.062, -0.025, 0.002], [0.0712, -0.031, 0.004], [0.063, -0.038, 0.004], [0.088, -0.12, 0.007], [0.089, -0.133, 0.006], [0.054, -0.141, 0.008], [0.041, -0.129, 0.007], [0.0435, -0.108, 0.01], [0.036, -0.09, 0.012], [0.029, -0.062, 0.008], [0.026, -0.04, 0.004]];
  // moulded faces dome gently; the textured panel rides on the grip's dome
  const gd = lo ? null : dome(outline(grip), 0.0009, 0.008, { curve: cs });
  g.s(P, side(outline(grip), 0.0285, lo ? 0 : 0.0036, { curve: cs, flat: lo, pillow: gd }));
  if (!lo) {
    g.s(P, side(outline([[0.041, -0.051, 0.005], [0.064, -0.049, 0.005], [0.0795, -0.113, 0.007], [0.058, -0.123, 0.007], [0.047, -0.1, 0.008]]), 0.0299, 0.0009, { pillow: gd }));
    g.s(P, side(outline([[0.0525, -0.1386, 0.002], [0.0898, -0.1312, 0.002], [0.0906, -0.1376, 0.003], [0.0565, -0.1452, 0.004]]), 0.0276, 0.0014));
  }
  // Receiver extension (buffer tube) with its adjustment notches
  g.s(M.anodBlack, turned([[0, 0.0975], [0.0156, 0.0975], [0.0156, 0.2665], [0.0146, 0.2695], [0, 0.27]], lo ? 12 : 28, 0, 0.012));
  if (!lo) for (let i = 0; i < 6; i++) g.s(M.rubber, rb(0.006, 0.0016, 0.0042, 0, -0.0034, 0.168 + i * 0.016, 0.0005));
  // Stock: angular SL-style body with a sling slot, a rubber butt pad with ribs, latch and QD cup
  const stock = outline([[0.162, 0.03, 0.006], [0.19, 0.0355, 0.012], [0.284, 0.0375, 0.006], [0.299, 0.033, 0.003], [0.303, -0.087, 0.004], [0.292, -0.096, 0.006], [0.27, -0.091, 0.008], [0.21, -0.05, 0.04], [0.172, -0.021, 0.008], [0.162, -0.012, 0.004]]);
  let sd = null;
  if (!lo) {
    stock.holes.push(slot(0.2775, -0.0705, 0.027, 0.0068, -0.62));
    // a deep recessed panel on each side below the cheek weld
    const recess = [[0.206, -0.006, 0.006], [0.28, 0.014, 0.006], [0.284, -0.052, 0.008], [0.264, -0.066, 0.008], [0.228, -0.044, 0.02]];
    stock.holes.push(hole(recess));
    g.s(P, side(outline(recess), 0.0302, 0.0012, { curve: cs, pillow: dome(outline(recess), 0.0008, 0.007, { curve: cs }) }));
    sd = dome(stock, 0.0012, 0.008, { curve: cs });
    // the maker's mark moulded into both sides, under the cheek weld
    for (const sx of [-1, 1]) g.body.add(marking('kr-logo', drawKestrelLogo, [320, 160], 0.034, 0.017, sx * 0.0195, 0.0212, 0.243, sx, { style: 'mould', dome: sd }));
  }
  g.s(P, side(stock, 0.039, lo ? 0 : 0.0038, { curve: cs, flat: lo, pillow: sd }));
  g.s(M.rubber, side(outline([[0.2975, 0.0362, 0.003], [0.3112, 0.0362, 0.003], [0.3142, -0.0905, 0.004], [0.3005, -0.0948, 0.004]]), 0.0412, lo ? 0 : 0.0021, { curve: cs, flat: lo }));
  if (lo) return;
  for (let i = 0; i < 8; i++) { const y = 0.026 - i * 0.0145; g.s(M.rubber, rb(0.0395, 0.0016, 0.0016, 0, y, 0.3112 + (0.0362 - y) * 0.0237 + 0.0019, 0.0006)); }
  g.s(P, side(outline([[0.165, -0.0155, 0.001], [0.204, -0.0295, 0.003], [0.2025, -0.0345, 0.002], [0.165, -0.0225, 0.001]]), 0.012, 0.0008));
  for (const sx of [-1, 1]) {
    g.s(M.steel, turnedX(sx < 0 ? [[0, -0.0212], [0.0052, -0.0212], [0.0058, -0.0204], [0.0058, -0.0186], [0, -0.0186]] : [[0, 0.0186], [0.0058, 0.0186], [0.0058, 0.0204], [0.0052, 0.0212], [0, 0.0212]], 18, -0.058, 0.262));
    g.s(M.rubber, turnedX(sx < 0 ? [[0, -0.0214], [0.003, -0.0214], [0, -0.021]] : [[0, 0.021], [0.003, 0.0214], [0, 0.0214]], 12, -0.058, 0.262));
  }
}

// The Kestrel Arms mark: a falcon stooping on swept wings, over the name.
function drawKestrelLogo(g, w, h) {
  const cx = w / 2, cy = h * 0.36, s = h * 0.34;
  g.beginPath();
  g.moveTo(cx, cy + s * 0.62);
  g.quadraticCurveTo(cx - s * 0.38, cy + s * 0.08, cx - s * 1.7, cy - s * 0.62);
  g.quadraticCurveTo(cx - s * 0.75, cy - s * 0.1, cx - s * 0.24, cy - s * 0.16);
  g.lineTo(cx, cy - s * 0.58);
  g.lineTo(cx + s * 0.24, cy - s * 0.16);
  g.quadraticCurveTo(cx + s * 0.75, cy - s * 0.1, cx + s * 1.7, cy - s * 0.62);
  g.quadraticCurveTo(cx + s * 0.38, cy + s * 0.08, cx, cy + s * 0.62);
  g.closePath();
  g.fill();
  g.font = '700 ' + Math.round(h * 0.24) + 'px ' + MARK_FONT;
  if ('letterSpacing' in g) g.letterSpacing = '4px';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('KESTREL ARMS', cx, h * 0.82);
}

// --- rail, barrel, muzzle, sights ----------------------------------------------------------------
// Rotate a part built on the right-hand (+X) face of the handguard round to the face at angle th
// (0 = top, clockwise seen from behind), about the bore axis.
function onFace(geo, th) { geo.rotateZ(Math.PI / 2 - th); geo.translate(0, BORE, 0); return geo; }

function handguard(g, M) {
  const A = M.anodized, lo = Q.low;
  const z0 = -0.172, z1 = -0.556;
  const a = 0.0222, t = 0.0022, s = 2 * a * Math.tan(Math.PI / 8);
  if (lo) {
    const hg = new THREE.CylinderGeometry(a / Math.cos(Math.PI / 8), a / Math.cos(Math.PI / 8), z0 - z1, 8, 1);
    hg.rotateX(Math.PI / 2); hg.rotateZ(Math.PI / 8); hg.translate(0, BORE, (z0 + z1) / 2);
    g.s(A, hg);
    g.s(A, rb(s, RAIL_Y - 0.036, z0 - z1, 0, (RAIL_Y + 0.036) / 2, (z0 + z1) / 2, 0.001));
    g.s(A, railParts(z0, z1 + 0.008, RAIL_Y, true));
    return;
  }
  // Seven slotted plates (the top is the rail spine); slot patterns differ per face.
  const pitch = 0.0405;
  for (let i = 1; i < 8; i++) {
    const th = i * Math.PI / 4;
    const face = rrect((z0 + z1) / 2, 0, z0 - z1, s + 0.0006, 0.0006);
    const sidePl = i === 2 || i === 6, lowDiag = i === 3 || i === 5, upDiag = i === 1 || i === 7, bottom = i === 4;
    for (let k = 0; k < 9; k++) {
      const zc = -0.206 - k * pitch;
      if (sidePl) face.holes.push(slot(zc, 0, 0.032, 0.0072));
      else if (lowDiag && k < 8) face.holes.push(slot(zc - pitch / 2, 0, 0.032, 0.0072));
      else if (bottom && k % 2 === 0) face.holes.push(slot(zc, 0, 0.032, 0.0072));
      else if (upDiag && k < 8) face.holes.push(slot(zc - pitch / 2, 0, 0.016, 0.0062));
    }
    const pl = side(face, t, 0.00045, { x: a - t / 2, curve: 6 });
    g.s(A, onFace(pl, th));
  }
  // Rounded corners hide the seams between plates
  for (let i = 0; i < 8; i++) {
    const th = i * Math.PI / 4 + Math.PI / 8, r = a / Math.cos(Math.PI / 8) - 0.0009;
    g.s(A, cz(0.0014, 0.0014, z1 + 0.0004, z0, Math.sin(th) * r, BORE + Math.cos(th) * r, 10));
  }
  // Top spine and rail, continuous with the receiver's
  g.s(A, along(rrect(0, (RAIL_Y + 0.0358) / 2, s + 0.0008, RAIL_Y - 0.0358, 0.0006), z1 + 0.0006, z0, 0.0005));
  g.s(A, railParts(z0, z1 + 0.004, RAIL_Y));
  // QD sling socket on the left side, near the receiver
  g.s(M.steel, onFace(turnedX([[0, a - 0.001], [0.0058, a - 0.001], [0.0058, a + 0.0018], [0.0052, a + 0.0024], [0, a + 0.0024]], 18, 0, -0.1832), Math.PI * 1.5));
  g.s(M.rubber, onFace(turnedX([[0, a + 0.0021], [0.0032, a + 0.0021], [0.0032, a + 0.0027], [0, a + 0.0027]], 12, 0, -0.1832), Math.PI * 1.5));
  // Clamp screws at the rear, on the lower diagonals
  for (const th of [Math.PI * 0.75, Math.PI * 1.25]) for (const zc of [-0.181, -0.192]) {
    g.s(M.steel, onFace(turnedX([[0, a - 0.0004], [0.0026, a - 0.0004], [0.0026, a + 0.0008], [0.0021, a + 0.0012], [0, a + 0.0012]], 14, 0, zc), th));
    g.s(M.rubber, onFace(turnedX([[0, a + 0.0009], [0.0013, a + 0.0009], [0.0013, a + 0.00135], [0, a + 0.00135]], 6, 0, zc), th));
  }
}

function barrel(g, M) {
  const S = M.steel, lo = Q.low;
  g.s(S, turned([[0, -0.6605], [0.0086, -0.6605], [0.0095, -0.6585], [0.0095, -0.52], [0.0099, -0.518], [0.0099, -0.2], [0.0118, -0.196], [0.0118, -0.171], [0, -0.171]], lo ? 10 : 24, 0, BORE));
  if (lo) return;
  g.s(M.rubber, new THREE.CircleGeometry(0.0034, 16).rotateY(Math.PI).translate(0, BORE, -0.6607));
  // Low-profile gas block with set screws, and the gas tube running back over the barrel
  g.s(S, along(outline([[-0.0105, -0.0105, 0.002], [0.0105, -0.0105, 0.002], [0.0105, 0.0095, 0.003], [0.006, 0.0152, 0.003], [-0.006, 0.0152, 0.003], [-0.0105, 0.0095, 0.003]]), -0.536, -0.511, 0.0007, { y: BORE }));
  for (const zc of [-0.519, -0.528]) g.s(M.rubber, cy(0.0016, 0.002, 0, BORE - 0.0106, zc, 8));
  g.s(S, cz(0.0022, 0.0022, -0.512, -0.175, 0, BORE + 0.0122, 10));
}

// A2 birdcage: collar, five tines between open slots (closed underneath), front ring.
function birdcage(g, M, mz) {
  const S = M.steel, lo = Q.low;
  const L = 0.048;
  if (lo) { g.s(S, cz(0.0105, 0.0105, mz, mz - L, 0, BORE, 12)); return L; }
  g.s(S, along(ring(0.0045, 0.0108, 28), mz - 0.012, mz + 0.0005, 0.0005, { y: BORE }));
  const slots = [Math.PI * 0.5, Math.PI * 0.5 + 1.15, Math.PI * 0.5 - 1.15, Math.PI * 0.5 + 2.25, Math.PI * 0.5 - 2.25];
  const w = 0.2;
  const edges = slots.flatMap((c) => [c - w, c + w]).map((v) => ((v % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((p, q) => p - q);
  for (let i = 0; i < edges.length; i += 2) {
    const a0 = edges[(i + 1) % edges.length], a1 = edges[(i + 2) % edges.length] + (i + 2 >= edges.length ? Math.PI * 2 : 0);
    g.s(S, along(sector(0.0058, 0.0105, a0, a1, 6), mz - L + 0.0052, mz - 0.0118, 0.0003, { y: BORE }));
  }
  g.s(S, along(ring(0.0058, 0.0106, 28), mz - L, mz - L + 0.0055, 0.0004, { y: BORE }));
  return L;
}

function sights(g, M, optic) {
  const K = M.anodBlack, lo = Q.low;
  // Bases clamp to the rail and stay put; the towers fold flat when an optic is fitted.
  for (const z of optic === 'scope4x' ? [-0.525] : [-0.525, 0.06]) g.s(K, along(rrect(0, 0.0028, 0.0215, 0.0056, 0.0014), z - 0.012, z + 0.012, lo ? 0 : 0.0005, { y: 0.0466, flat: lo }));
  const front = g.pivot(g.body, 0, 0.049, -0.525, 'frontSight');
  const ears = outline([[-0.0095, 0.002], [0.0095, 0.002], [0.0095, 0.021, 0.0025], [0.0058, 0.0238, 0.0015], [0.0058, 0.0095, 0.0018], [-0.0058, 0.0095, 0.0018], [-0.0058, 0.0238, 0.0015], [-0.0095, 0.021, 0.0025]]);
  g.m(K, along(ears, -0.0028, 0.0028, lo ? 0 : 0.0005, { flat: lo }), front);
  g.m(M.steel, [along(outline([[-0.0009, 0.009], [0.0009, 0.009], [0.0007, 0.0245], [-0.0007, 0.0245]]), -0.0009, 0.0009, 0, { flat: true }), rb(0.005, 0.003, 0.004, 0, 0.0095, 0, 0.0006)], front);
  if (optic === 'scope4x') { front.rotation.x = -Math.PI / 2 * 0.98; front.position.y -= 0.002; return; } // the scope's rings take the rear slot
  const rear = g.pivot(g.body, 0, 0.049, 0.06, 'rearSight');
  const plateShape = outline([[-0.0095, 0.002], [0.0095, 0.002], [0.0095, 0.019, 0.003], [0.0062, 0.0298, 0.003], [-0.0062, 0.0298, 0.003], [-0.0095, 0.019, 0.003]]);
  if (!lo) plateShape.holes.push(circle(0, 0.0245, 0.0021, new THREE.Path(), 20));
  g.m(K, along(plateShape, -0.002, 0.002, lo ? 0 : 0.0005, { flat: lo }), rear);
  if (!lo) g.m(K, turned([[0.0021, -0.0021], [0.0036, -0.0021], [0.0036, 0.0021], [0.0021, 0.0021]], 20, 0, 0.0245), rear);
  if (optic) { front.rotation.x = -Math.PI / 2 * 0.98; rear.rotation.x = Math.PI / 2 * 0.98; front.position.y -= 0.002; }
}

// --- the rifle --------------------------------------------------------------------------------
export function buildKestrel(M, att, opts) {
  const g = new Gun('kestrel', M);
  upper(g, M);
  lower(g, M, opts.fp, opts.finish);
  controls(g, M);
  furniture(g, M);
  handguard(g, M);
  barrel(g, M);
  let muzzleZ = -0.66;
  if (att.muzzle === 'suppressor') muzzleZ -= suppressor(g, M, muzzleZ, BORE);
  else if (att.muzzle === 'compensator') muzzleZ -= compensator(g, M, muzzleZ, BORE);
  else muzzleZ -= birdcage(g, M, muzzleZ);
  g.anchors.muzzle = V(0, BORE, muzzleZ - 0.01);
  const optic = att.optic;
  sights(g, M, optic);
  let sight;
  if (optic === 'reddot') { const o = redDot(g, M, 0.047, 0.01); sight = { y: o.axisY, z: o.eyeZ + 0.11, reticleZ: o.reticleZ, kind: 'dot' }; }
  else if (optic === 'scope4x') { const o = scope4x(g, M, 0.047, 0.0); sight = { y: o.axisY, z: o.eyeZ + o.relief, kind: 'scope', ocular: o.ocular }; }
  else sight = { y: 0.0735, z: 0.06 + 0.19, kind: 'iron' };
  g.sight = sight;
  // Underbarrel
  const P = M.polymer;
  if (att.underbarrel === 'vgrip') {
    g.s(M.anodized, rb(0.02, 0.01, 0.03, 0, -0.011, -0.36, 0.002));
    g.s(P, turnedVertical([[0.0118, -0.105], [0.0128, -0.1], [0.0125, -0.07], [0.0118, -0.03], [0.0112, -0.016]], -0.36));
    if (!Q.low) for (let i = 0; i < 3; i++) g.s(P, turnedVertical([[0.0124, -0.046 - i * 0.02], [0.0132, -0.044 - i * 0.02], [0.0124, -0.042 - i * 0.02]], -0.36));
    g.anchors.fore = V(0, -0.075, -0.36);
    g.foreGrip = 'vertical';
  } else if (att.underbarrel === 'agrip') {
    const ag = outline([[-0.29, -0.006, 0.003], [-0.372, -0.006, 0.003], [-0.378, -0.017, 0.004], [-0.302, -0.047, 0.006], [-0.288, -0.04, 0.004]]);
    g.s(P, side(ag, 0.022, Q.low ? 0 : 0.003, { curve: Q.low ? 2 : 8, flat: Q.low, pillow: Q.low ? null : dome(ag, 0.0007, 0.006) }));
    g.anchors.fore = V(0, -0.03, -0.32);
    g.foreGrip = 'angled';
  } else {
    g.anchors.fore = V(0, -0.012, -0.34);
    g.foreGrip = 'handguard';
  }
  if (att.laser) g.anchors.laser = laserModule(g, M, 0.04, BORE, -0.46);
  g.mag = buildRifleMag(M, att.magazine === 'extmag', opts.fp);
  g.body.add(g.mag.group);
  g.anchors.grip = V(0, -0.06, 0.05);
  g.anchors.eject = V(0.016, 0.022, -0.03);
  g.anchors.magWell = V(0, -0.07, -0.095);
  g.caliber = '556';
  return g;
}

// A grip turned around the vertical axis at z (profile [radius, y] pairs, y increasing).
function turnedVertical(pts, z) {
  const sorted = pts.slice().sort((p, q) => p[1] - q[1]);
  const g = new THREE.LatheGeometry([new THREE.Vector2(0, sorted[0][1]), ...sorted.map(([r, y]) => new THREE.Vector2(r, y)), new THREE.Vector2(0, sorted[sorted.length - 1][1])], Q.low ? 10 : 22);
  g.translate(0, 0, z);
  return g;
}

// PMAG-style magazine: curved polymer body, textured lower shell, floorplate, and a witness
// window cut through both sides that shows the rounds left.
export function buildRifleMag(M, ext, fp) {
  const grp = new THREE.Group();
  grp.name = 'mag';
  const P = M.polymer, lo = Q.low;
  const bottom = ext ? -0.3 : -0.232;
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); grp.add(m); return m; };
  const body = [[-0.124, -0.012, 0.0015], [-0.066, -0.012, 0.0015], [-0.068, -0.08], [-0.074, -0.15, 0.04], [-0.083, bottom + 0.022, 0.012], [-0.087, bottom + 0.006, 0.003], [-0.153, bottom + 0.006, 0.003], [-0.151, bottom + 0.022, 0.012], [-0.142, -0.15, 0.04], [-0.13, -0.08]];
  // window from (zt, yt) down to (zb, yb), leaning forward with the mag's curve
  const winLen = ext ? 0.19 : 0.125, zt = -0.0765, yt = -0.069, zb = zt - 0.0103 * winLen / 0.125, yb = yt - winLen;
  const winC = [(zt + zb) / 2, (yt + yb) / 2], winA = Math.atan2(yb - yt, zb - zt), winL = Math.hypot(yb - yt, zb - zt);
  const shape = outline(body);
  if (fp && !lo) shape.holes.push(slot(winC[0], winC[1], winL, 0.0056, winA));
  // the body's faces dome gently; the shell and its ribs ride on that dome
  const md = lo ? null : dome(shape, 0.0009, 0.009, { curve: 10 });
  add(side(shape, 0.0225, lo ? 0 : 0.0012, { curve: lo ? 2 : 10, flat: lo, pillow: md }), P);
  if (!lo) {
    // Slightly proud textured shell over the lower body, cut for the window too
    const shell = outline([[-0.0675, -0.088], [-0.073, -0.15, 0.04], [-0.082, bottom + 0.024, 0.012], [-0.152, bottom + 0.024, 0.012], [-0.1415, -0.15, 0.04], [-0.1305, -0.088]]);
    // the window's stretch inside the shell (a hole must stay within its outline)
    if (fp) { const y0 = -0.092, z0 = zt + (zb - zt) * (yt - y0) / winLen, c = [(z0 + zb) / 2, (y0 + yb) / 2]; shell.holes.push(slot(c[0], c[1], Math.hypot(yb - y0, zb - z0), 0.0062, winA)); }
    add(side(shell, 0.0235, 0.0007, { curve: 10, pillow: md }), P);
    for (let i = 0; i < 3; i++) {
      const y = bottom + 0.032 + i * 0.011;
      add(side(outline([[-0.083 + i * 0.0012, y, 0.001], [-0.1505 + i * 0.001, y, 0.001], [-0.1505 + i * 0.001, y + 0.003, 0.001], [-0.083 + i * 0.0012, y + 0.003, 0.001]]), 0.0242, 0.0005, { pillow: md }), P);
    }
  }
  add(side(outline([[-0.0855, bottom + 0.0085, 0.003], [-0.1545, bottom + 0.0085, 0.003], [-0.1568, bottom - 0.0022, 0.0035], [-0.0832, bottom - 0.0022, 0.0035]]), 0.0262, lo ? 0 : 0.0015, { curve: lo ? 2 : 8, flat: lo }), P);
  // Top rounds at the feed lips (visible when the mag is out)
  const rounds = [];
  if (fp) {
    for (let i = 0; i < 2; i++) {
      const r = makeRound(M, '556');
      r.position.set(i ? 0.0035 : -0.0035, -0.008 - i * 0.004, -0.07);
      grp.add(r);
      rounds.push(r);
    }
  }
  // The column of cases seen through the window
  const win = [];
  if (fp && !lo) {
    const n = 15;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const y = yt - 0.004 - t * (winLen - 0.008), z = zt + (zb - zt) * (yt - y) / winLen;
      win.push(add(rb(0.0198, 0.0062, 0.0072, 0, y, z, 0.0012), M.brass));
    }
  }
  return {
    group: grp, rounds, window: win, capacity: ext ? 40 : 30,
    setAmmo(n) {
      for (let i = 0; i < rounds.length; i++) rounds[i].visible = n > i;
      const per = win.length ? this.capacity / win.length : 1;
      for (let i = 0; i < win.length; i++) win[i].visible = i < Math.ceil(n / per);
    },
  };
}
