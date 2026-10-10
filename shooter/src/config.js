// Iron Meridian — game data and tuning. Units: metres, seconds, degrees.

export const GAME_NAME = 'Iron Meridian';

// Learnable recoil: per-shot [yaw, pitch] kicks in degrees. After the pattern ends
// the last 8 entries repeat.
function pattern(n, pitch, drift) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const yaw = Math.sin(i * 0.55) * drift + (i > 10 ? Math.cos(i * 0.31) * drift * 0.8 : 0);
    out.push([yaw, pitch * (i < 3 ? 1.25 : i < 12 ? 1 : 0.8)]);
  }
  return out;
}

export const WEAPONS = {
  kestrel: {
    id: 'kestrel', name: 'KR-5 Kestrel', type: 'Assault rifle', caliber: '5.56×45mm', slot: 'primary',
    rpm: 780, modes: ['auto', 'semi'], mag: 30, extMag: 40, reserve: 150, chamber: true,
    velocity: 910, damage: [31, 23], falloff: [30, 75], power: 1.0, pellets: 1,
    hipSpread: 2.4, adsSpread: 0.05, moveSpread: 1.8,
    recoil: { v: 0.58, h: 0.24, recover: 7, pattern: pattern(30, 0.58, 0.32) },
    adsTime: 0.24, reload: { tactical: 2.1, empty: 2.7 }, draw: 0.6, weight: 3.4,
    zoomFov: 0.8, sound: { crack: 1.0, body: 1.0, pitch: 1.0, tail: 1.0 },
    attachments: ['reddot', 'scope4x', 'suppressor', 'compensator', 'vgrip', 'agrip', 'extmag', 'laser', 'black', 'fde', 'odg'], finish: 'fde',
  },
  bastion: {
    id: 'bastion', name: 'M12 Bastion', type: 'Pump shotgun', caliber: '12 gauge 00 buck', slot: 'primary',
    rpm: 72, modes: ['pump'], mag: 6, extMag: 8, reserve: 36, chamber: true,
    velocity: 400, damage: [15, 5], falloff: [8, 26], power: 0.3, pellets: 9,
    hipSpread: 4.2, adsSpread: 3.0, moveSpread: 0.8, pelletSpread: 3.2,
    recoil: { v: 3.2, h: 0.8, recover: 5, pattern: pattern(8, 3.2, 0.6) },
    adsTime: 0.3, reload: { shell: 0.52, start: 0.35, pump: 0.55 }, draw: 0.7, weight: 3.6,
    zoomFov: 0.85, sound: { crack: 0.8, body: 1.6, pitch: 0.7, tail: 1.3 },
    attachments: ['reddot', 'choke', 'extmag', 'laser', 'black', 'fde', 'odg'], finish: 'black',
  },
  warden: {
    id: 'warden', name: 'P9 Warden', type: 'Pistol', caliber: '9×19mm', slot: 'secondary',
    rpm: 450, modes: ['semi'], mag: 17, extMag: 21, reserve: 68, chamber: true,
    velocity: 370, damage: [28, 17], falloff: [12, 35], power: 0.42, pellets: 1,
    hipSpread: 1.8, adsSpread: 0.25, moveSpread: 1.2,
    recoil: { v: 1.1, h: 0.35, recover: 9, pattern: pattern(17, 1.1, 0.4) },
    adsTime: 0.16, reload: { tactical: 1.45, empty: 1.85 }, draw: 0.35, weight: 0.9,
    zoomFov: 0.88, sound: { crack: 0.75, body: 0.6, pitch: 1.35, tail: 0.7 },
    attachments: ['reddot', 'suppressor', 'extmag', 'laser', 'black', 'fde', 'odg'], finish: 'black',
  },
};

export const ATTACHMENT_SLOTS = ['optic', 'muzzle', 'underbarrel', 'magazine', 'laser', 'finish'];
export const SLOT_NAMES = { optic: 'Optic', muzzle: 'Muzzle', underbarrel: 'Underbarrel', magazine: 'Magazine', laser: 'Laser', finish: 'Finish' };

// mods are added to (or multiply, for *Mul) the weapon's base stats.
export const ATTACHMENTS = {
  reddot: { slot: 'optic', name: 'Haldane RDS', desc: '1× red dot. Fast, clean sight picture.', mods: { adsTime: 0.015 } },
  scope4x: { slot: 'optic', name: 'Talon 4× scope', desc: '4× magnified optic with a true picture-in-picture view.', mods: { adsTime: 0.09, weight: 0.45 }, zoom: 4 },
  suppressor: { slot: 'muzzle', name: 'Hush suppressor', desc: 'Much quieter. Enemies hear you from a third of the distance.', mods: { recoilVMul: -0.06, adsTime: 0.03, weight: 0.4, velocityMul: 0.03 }, noise: 0.33 },
  compensator: { slot: 'muzzle', name: 'Brace compensator', desc: 'Tames sideways kick. Louder.', mods: { recoilHMul: -0.35, recoilVMul: -0.05 }, noise: 1.15 },
  choke: { slot: 'muzzle', name: 'Full choke', desc: 'Tighter pellet spread for longer reach.', mods: { pelletSpreadMul: -0.32, adsTime: 0.01, weight: 0.15 } },
  vgrip: { slot: 'underbarrel', name: 'Vertical foregrip', desc: 'Steadies vertical recoil.', mods: { recoilVMul: -0.14, adsTime: 0.02, weight: 0.15 } },
  agrip: { slot: 'underbarrel', name: 'Angled foregrip', desc: 'Faster to aim, light recoil help.', mods: { adsTime: -0.035, recoilVMul: -0.05, weight: 0.1 } },
  extmag: { slot: 'magazine', name: 'Extended magazine', desc: 'More rounds, slower reloads.', mods: { reloadMul: 0.14, adsTime: 0.02, weight: 0.3 }, extMag: true },
  laser: { slot: 'laser', name: 'LA-2 laser', desc: 'Tighter hip-fire. The beam can give you away.', mods: { hipSpreadMul: -0.3, weight: 0.08 } },
  // Finishes are cosmetic: receiver metal and polymer furniture.
  black: { slot: 'finish', name: 'Black', desc: 'Hard-anodised receiver, black polymer.', mods: {} },
  fde: { slot: 'finish', name: 'Flat Dark Earth', desc: 'Tan Cerakote receiver and matching furniture.', mods: {} },
  odg: { slot: 'finish', name: 'OD Green', desc: 'Olive drab Cerakote receiver and furniture.', mods: {} },
};

export const THROWABLES = {
  frag: { name: 'M67-style frag', fuse: 3.2, radius: 7, damage: 140, count: 2 },
};

// Penetration resistance: bullet power lost per metre of material.
export const MATERIALS = {
  concrete: { resist: 34, ricochet: true, impact: 'dust', tone: 'hard' },
  brick: { resist: 20, ricochet: true, impact: 'dust', tone: 'hard' },
  stone: { resist: 34, ricochet: true, impact: 'dust', tone: 'hard' },
  plaster: { resist: 3.4, impact: 'dust', tone: 'soft' },
  wood: { resist: 5.5, impact: 'splinter', tone: 'wood' },
  metal: { resist: 2.2, ricochet: true, impact: 'spark', tone: 'metal' },
  sandbag: { resist: 14, impact: 'dirt', tone: 'soft' },
  glass: { resist: 0.4, impact: 'glass', tone: 'glass' },
  ground: { resist: 99, ricochet: true, impact: 'dust', tone: 'hard' },
};

export const HITZONES = { head: 2.6, chest: 1, stomach: 0.95, arm: 0.72, leg: 0.72 };

export const FACTIONS = {
  msg: { id: 'msg', name: 'Meridian Security Group', short: 'MSG', color: '#7fb4e8' },
  volk: { id: 'volk', name: 'Volk Group', short: 'VOLK', color: '#ef6b5b' },
};

export const DIFFICULTY = {
  recruit: { name: 'Recruit', reaction: 0.75, aimError: 3.2, track: 2.2, burst: [2, 4], detect: 0.7 },
  regular: { name: 'Regular', reaction: 0.45, aimError: 2.1, track: 3.4, burst: [3, 6], detect: 1 },
  veteran: { name: 'Veteran', reaction: 0.28, aimError: 1.3, track: 5, burst: [3, 7], detect: 1.35 },
};

export const MATCH = {
  teamSize: 4,             // player + 3 allies vs 4 enemies
  scoreLimit: 30,
  timeLimit: 8 * 60,
  respawn: 4,
  spawnProtect: 2.5,
  regenDelay: 6,
  regenRate: 22,
};

export const PLAYER = {
  eye: 1.66, crouchEye: 1.12, proneEye: 0.42, slideEye: 0.95,
  radius: 0.32, height: 1.8, crouchHeight: 1.25, proneHeight: 0.6,
  walk: 4.4, sprint: 6.6, tacSprint: 7.8, crouch: 2.4, prone: 1.0, adsMul: 0.62,
  jump: 4.8, gravity: 22, step: 0.42,
  stamina: 100, sprintDrain: 11, tacDrain: 30, staminaRegen: 20,
  fallSafe: 3.5, fallDamage: 18,
};

export const PRESETS = {
  // Phones and tablets: native-size pixels, light haze, no AO or bloom, shadows redrawn every other
  // frame, and the resolution drops (down to 55%) whenever frames run slow.
  mobile: { name: 'Mobile', pixelRatio: 1, shadowSize: 2048, softShadows: false, ao: false, bloom: false, aa: 'fxaa', anisotropy: 2, scopeRes: 256, textureSize: 512, volumetric: { steps: 16, scale: 0.4 }, dust: 600, windowShadows: false, shadowEvery: 2, adaptive: true },
  medium: { name: 'Medium', pixelRatio: 1, shadowSize: 2048, softShadows: false, ao: false, bloom: false, aa: 'fxaa', anisotropy: 4, scopeRes: 384, textureSize: 512, volumetric: { steps: 24, scale: 0.5 }, dust: 1500, windowShadows: false },
  high: { name: 'High', pixelRatio: 1.5, shadowSize: 4096, softShadows: true, ao: true, aoRes: 0.5, bloom: true, aa: 'smaa', anisotropy: 8, scopeRes: 512, textureSize: 1024, volumetric: { steps: 40, scale: 0.5 }, dust: 3000, vmShadows: true, parallax: 10 },
  ultra: { name: 'Ultra', pixelRatio: 2, shadowSize: 4096, softShadows: true, ao: true, aoRes: 1, bloom: true, aa: 'smaa', anisotropy: 16, scopeRes: 1024, textureSize: 2048, volumetric: { steps: 64, scale: 0.5 }, dust: 5000, vmShadows: true, parallax: 16 },
};

export const DEFAULT_SETTINGS = {
  preset: 'high', fov: 90, sens: 1, adsSens: 0.8, invertY: false, volume: 0.8,
  ammoDisplay: 'numeric', showFps: false, difficulty: 'regular', superSample: 1,
};

export const DEFAULT_LOADOUTS = [
  { name: 'Rifleman', primary: 'kestrel', secondary: 'warden', att: { kestrel: { optic: 'reddot', underbarrel: 'vgrip' }, warden: {} } },
  { name: 'Marksman', primary: 'kestrel', secondary: 'warden', att: { kestrel: { optic: 'scope4x', muzzle: 'suppressor', magazine: 'extmag' }, warden: { muzzle: 'suppressor' } } },
  { name: 'Breacher', primary: 'bastion', secondary: 'warden', att: { bastion: { laser: 'laser', muzzle: 'choke' }, warden: { optic: 'reddot', magazine: 'extmag' } } },
];

// Resolve a weapon's final stats from its attachments.
export function weaponStats(id, att) {
  const base = WEAPONS[id];
  const s = JSON.parse(JSON.stringify(base));
  s.att = Object.assign({}, att || {});
  s.noise = 1;
  s.zoom = 1;
  let reloadMul = 1, rv = 1, rh = 1, hip = 1, pel = 1, vel = 1;
  for (const slot in s.att) {
    const a = ATTACHMENTS[s.att[slot]];
    if (!a || base.attachments.indexOf(s.att[slot]) === -1) { delete s.att[slot]; continue; }
    const m = a.mods || {};
    if (m.adsTime) s.adsTime += m.adsTime;
    if (m.weight) s.weight += m.weight;
    if (m.reloadMul) reloadMul += m.reloadMul;
    if (m.recoilVMul) rv += m.recoilVMul;
    if (m.recoilHMul) rh += m.recoilHMul;
    if (m.hipSpreadMul) hip += m.hipSpreadMul;
    if (m.pelletSpreadMul) pel += m.pelletSpreadMul;
    if (m.velocityMul) vel += m.velocityMul;
    if (a.noise) s.noise *= a.noise;
    if (a.zoom) s.zoom = a.zoom;
    if (a.extMag) s.mag = base.extMag;
  }
  s.recoil.v *= rv;
  s.recoil.h *= rh;
  s.recoil.pattern = s.recoil.pattern.map(function (p) { return [p[0] * rh, p[1] * rv]; });
  s.hipSpread *= hip;
  if (s.pelletSpread) s.pelletSpread *= pel;
  s.velocity *= vel;
  for (const k in s.reload) s.reload[k] *= reloadMul;
  s.suppressed = s.att.muzzle === 'suppressor';
  s.scoped = s.att.optic === 'scope4x';
  return s;
}

// 0..1 ratings for the gunsmith's stat bars.
export function statBars(s) {
  const clamp = function (v) { return Math.max(0.03, Math.min(1, v)); };
  return {
    Damage: clamp((s.damage[0] * s.pellets) / 140),
    Range: clamp(s.falloff[1] / 90),
    'Fire rate': clamp(s.rpm / 900),
    'Recoil control': clamp(1 - s.recoil.v / 3.6),
    Handling: clamp(1.15 - s.adsTime * 2.6),
    Mobility: clamp(1.1 - s.weight / 5),
    Accuracy: clamp(1 - s.hipSpread / 5),
  };
}
