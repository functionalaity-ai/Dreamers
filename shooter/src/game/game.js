// Game orchestrator: world, characters, ballistics, grenades, scoring and Team Deathmatch rules.
import * as THREE from 'three';
import { Physics } from '../core/physics.js';
import { buildOldTown, BOUNDS } from '../world/oldtown.js';
import { NavGraph } from '../world/navmesh.js';
import { Effects } from '../world/effects.js';
import { Ballistics } from '../weapons/ballistics.js';
import { Viewmodel } from '../weapons/viewmodel.js';
import { Player } from '../characters/player.js';
import { Bot } from '../characters/bot.js';
import { MATCH, DIFFICULTY, MATERIALS, THROWABLES, FACTIONS } from '../config.js';
import { textDecal } from '../core/textures.js';
import { SUN_DIR } from '../core/renderer.js';

const ROSTER = {
  msg: [
    { name: 'Reyes', primary: 'kestrel', att: { optic: 'reddot', underbarrel: 'vgrip' }, lane: 0 },
    { name: 'Kowalski', primary: 'kestrel', att: { optic: 'scope4x', muzzle: 'suppressor' }, lane: 2 },
    { name: 'Okafor', primary: 'bastion', att: { laser: 'laser' }, lane: 1 },
  ],
  volk: [
    { name: 'Dragan', primary: 'kestrel', att: { optic: 'reddot' }, lane: 0 },
    { name: 'Ilya', primary: 'kestrel', att: { muzzle: 'compensator' }, lane: 1 },
    { name: 'Marek', primary: 'bastion', att: {}, lane: 2 },
    { name: 'Bogdan', primary: 'kestrel', att: { optic: 'scope4x' }, lane: 1 },
  ],
};

export class Game {
  constructor(renderer, mats, audio) {
    this.R = renderer;
    this.scene = renderer.scene;
    this.camera = renderer.camera;
    this.mats = mats;
    this.audio = audio;
    this.time = 0;
    this.rules = MATCH;
    this.difficulty = DIFFICULTY.regular;
    this.characters = [];
    this.bots = [];
    this.grenades = [];
    this.claims = new Map();
    this.hud = null; // set by the UI
    this.state = 'menu';
    this.shake = 0;
    this.indoorF = 0;
  }

  load() {
    const ph = new Physics(BOUNDS.minX, BOUNDS.minZ, BOUNDS.maxX, BOUNDS.maxZ);
    this.physics = ph;
    this.map = buildOldTown(ph, this.mats, this.scene);
    // Invisible map boundary
    ph.add(-53, 0, -46, 53, 40, -42, 'concrete', { boundary: true }); ph.add(-53, 0, 42, 53, 40, 46, 'concrete', { boundary: true });
    for (const l of this.map.lights) {
      const pl = new THREE.PointLight(0xffd29a, 7, 11, 2);
      pl.position.copy(l);
      this.scene.add(pl);
    }
    for (const s of this.map.signs) this.addSign(s);
    this.nav = new NavGraph(ph, BOUNDS).build(this.map.hints, { minX: -51, maxX: 51, minZ: -36, maxZ: 36 });
    this.effects = new Effects(this.scene, ph, this.mats, this.audio);
    this.ballistics = new Ballistics(this);
    this.vm = new Viewmodel(this.R, this.mats, this.effects, this.audio);
    this.player = new Player(this);
    this.characters.push(this.player);
    let seed = 3;
    for (const team of ['msg', 'volk']) {
      for (const r of ROSTER[team]) {
        const b = new Bot(this, Object.assign({ team, seed: seed++ * 7919 }, r));
        b.h.group.visible = false;
        this.bots.push(b);
        this.characters.push(b);
      }
    }
    this.laser = this.makeLaser();
  }

  addSign(s) {
    const tex = textDecal([{ text: s.text, size: 0.62, font: '600 serif' }], 1024, 128, s.color);
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = s.bg; g.fillRect(0, 0, 1024, 128);
    g.strokeStyle = s.color; g.lineWidth = 6; g.strokeRect(10, 10, 1004, 108);
    g.drawImage(tex.image, 48, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.08 }));
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.rot;
    this.scene.add(m);
  }

  makeLaser() {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2), this.mats.gun.laser);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.4, 0.3) }));
    beam.visible = dot.visible = false;
    this.scene.add(beam, dot);
    return { beam, dot };
  }

  // --- match flow ------------------------------------------------------------------------
  start(loadout, difficultyKey) {
    this.difficulty = DIFFICULTY[difficultyKey] || DIFFICULTY.regular;
    this.scores = { msg: 0, volk: 0 };
    this.timeLeft = MATCH.timeLimit;
    this.respawns = [];
    this.over = false;
    this.player.loadout = loadout;
    for (const c of this.characters) Object.assign(c.stats, { kills: 0, deaths: 0, score: 0, shots: 0, hits: 0, hs: 0 });
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades = [];
    this.ballistics.list = [];
    this.claims.clear();
    this.spawn(this.player);
    for (const b of this.bots) this.spawn(b);
    this.state = 'playing';
    this.streak = 0;
    this.lastKillT = -99;
    this.hud.reset();
    this.hud.banner('Team Deathmatch', 'First to ' + MATCH.scoreLimit + ' · Old Town');
  }

  spawnPoint(team) {
    const pts = this.map.spawns[team];
    const enemies = this.characters.filter((c) => c.alive && c.team !== team);
    const scored = pts.map((p) => {
      let near = 999;
      for (const e of enemies) near = Math.min(near, e.body.p.distanceTo(p));
      let friends = 0;
      for (const c of this.characters) if (c.alive && c.team === team && c.body.p.distanceTo(p) < 1.5) friends++;
      return { p, s: Math.min(near, 40) - friends * 30 + Math.random() * 6 };
    });
    scored.sort((a, b) => b.s - a.s);
    return scored[0].p;
  }

  spawn(c) {
    const p = this.spawnPoint(c.team).clone();
    p.x += (Math.random() - 0.5) * 1.2; p.z += (Math.random() - 0.5) * 1.2;
    const yaw = c.team === 'msg' ? -Math.PI / 2 : Math.PI / 2;
    c.spawn(p, yaw);
  }

  kill(attacker, victim, info) {
    victim.stats.deaths++;
    for (const [k, v] of this.claims) if (v === victim) this.claims.delete(k);
    if (attacker && attacker !== victim) {
      attacker.stats.kills++;
      attacker.stats.score += 100 + (info.zone === 'head' ? 50 : 0);
      if (info.zone === 'head') attacker.stats.hs++;
      this.scores[attacker.team]++;
    }
    this.hud.killfeed(attacker, victim, info);
    if (attacker === this.player && victim !== this.player) {
      // kills within four seconds of each other chain into a streak
      this.streak = this.time - (this.lastKillT ?? -99) < 4 ? (this.streak || 1) + 1 : 1;
      this.lastKillT = this.time;
      this.hud.confirmKill(victim, info, 100 + (info.zone === 'head' ? 50 : 0), this.streak);
    }
    if (victim === this.player) this.hud.died(attacker, info, MATCH.respawn);
    this.respawns.push({ c: victim, t: MATCH.respawn });
    if (!this.over && attacker && this.scores[attacker.team] >= MATCH.scoreLimit) this.end(attacker.team);
  }

  end(winner) {
    if (this.over) return;
    this.over = true;
    this.state = 'over';
    this.winner = winner;
    this.hud.matchOver(winner);
  }

  // --- combat events -----------------------------------------------------------------------
  onHit(char, dmg, info) {
    const wasAlive = char.alive;
    const dealt = char.takeDamage(dmg, info);
    if (dealt <= 0) return;
    if (info.attacker) info.attacker.stats.hits++;
    this.effects.bloodHit(info.point, info.dir);
    const behind = this.physics.raycast(info.point, info.dir, 2.5);
    if (behind) this.effects.splat(behind.point, behind.normal);
    const killed = wasAlive && !char.alive;
    if (info.attacker === this.player) {
      this.hud.hitmarker(info.zone === 'head', killed);
      this.audio.foley(killed ? 'kill' : info.zone === 'head' ? 'headshot' : 'hit');
    }
    if (killed) this.kill(info.attacker, char, info);
  }

  onImpact(point, normal, dir, mat) {
    const M = MATERIALS[mat] || MATERIALS.concrete;
    this.effects.hole(point, normal, mat === 'metal' ? 0.035 : mat === 'glass' ? 0.08 : 0.055);
    this.effects.impact(M.impact, point, normal, dir);
    this.audio.impact(point, M.tone);
  }

  noise(pos, radius, source) {
    for (const b of this.bots) {
      if (!b.alive || b.team === source.team) continue;
      if (b.body.p.distanceTo(pos) < radius) b.hear(pos, source);
    }
  }

  callout(bot, text) {
    if (bot.team !== this.player.team || !this.hud) return;
    this.hud.comms(bot.name, text);
    this.audio.foley('radio');
  }

  claim(node, bot) {
    for (const [k, v] of this.claims) if (v === bot) this.claims.delete(k);
    this.claims.set(node.id, bot);
  }
  isClaimed(node, bot) { const c = this.claims.get(node.id); return c && c !== bot && c.alive; }

  isIndoor(p) {
    for (const v of this.map.indoor) {
      if (p.x > v.min[0] && p.x < v.max[0] && p.z > v.min[2] && p.z < v.max[2] && p.y < v.max[1] - 0.3) return true;
    }
    return false;
  }

  surfaceAt(p) { return this.isIndoor(p) && p.y > -0.1 ? 'wood' : 'stone'; }

  // --- grenades -------------------------------------------------------------------------------
  throwGrenade(owner, pos, vel) {
    const G = this.mats.gun;
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10).scale(1, 1.2, 1), new THREE.MeshStandardMaterial({ color: 0x3a4232, roughness: 0.6, metalness: 0.3 }));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.025, 10).translate(0, 0.045, 0), G.steel);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.004).translate(0.02, 0.02, 0), G.steel);
    mesh.add(body, top, lever);
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.grenades.push({ p: pos.clone(), v: vel.clone(), owner, fuse: THROWABLES.frag.fuse, age: 0, mesh, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10) });
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.age += dt;
      g.fuse -= dt;
      for (let s = 0; s < 3; s++) {
        const sdt = dt / 3;
        g.v.y -= 9.81 * sdt;
        const step = g.v.clone().multiplyScalar(sdt);
        const len = step.length();
        if (len > 1e-5) {
          const dir = step.clone().multiplyScalar(1 / len);
          const hit = this.physics.raycast(g.p, dir, len + 0.04);
          if (hit) {
            g.p.copy(hit.point).addScaledVector(hit.normal, 0.04);
            const vn = g.v.dot(hit.normal);
            g.v.addScaledVector(hit.normal, -1.38 * vn).multiplyScalar(0.62);
            if (Math.abs(vn) > 2) this.audio.foley('bounce', g.p);
            g.spin.multiplyScalar(0.6);
          } else g.p.add(step);
        }
      }
      g.mesh.position.copy(g.p);
      g.mesh.rotation.x += g.spin.x * dt; g.mesh.rotation.z += g.spin.z * dt;
      // Bots scatter from grenades they can see land near them.
      if (g.age > 0.5) {
        for (const b of this.bots) {
          if (!b.alive || b.evade > 0) continue;
          const d = b.body.p.distanceTo(g.p);
          if (d < 6.5 && this.physics.clear(b.eye, g.p.clone().add(new THREE.Vector3(0, 0.1, 0)))) {
            b.evade = 1.6;
            b.evadeDir = b.body.p.clone().sub(g.p).setY(0).normalize();
            if (b.team === this.player.team) b.callout('Grenade!', true);
          }
        }
      }
      if (g.fuse <= 0) {
        this.explode(g);
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  explode(g) {
    const p = g.p;
    const F = THROWABLES.frag;
    this.effects.explosion(p);
    this.effects.hole(new THREE.Vector3(p.x, this.physics.groundHeight(p.x, p.z, 0.1, p.y + 0.2) + 0.01, p.z), new THREE.Vector3(0, 1, 0), 1.6);
    this.audio.explosion(p, p.distanceTo(this.camera.position));
    const near = p.distanceTo(this.camera.position);
    this.shake = Math.max(this.shake, Math.max(0, 1 - near / 25));
    const from = p.clone().add(new THREE.Vector3(0, 0.3, 0));
    for (const c of this.characters) {
      if (!c.alive) continue;
      const chest = c.body.p.clone().add(new THREE.Vector3(0, 1.1, 0));
      const d = chest.distanceTo(from);
      if (d > F.radius) continue;
      if (!this.physics.clear(from, chest) && !this.physics.clear(from, c.eye)) continue;
      const friendly = c.team === g.owner.team && c !== g.owner;
      if (friendly) continue;
      const dmg = F.damage * Math.pow(1 - d / F.radius, 1.3);
      this.onHit(c, dmg, { zone: 'stomach', point: chest, dir: chest.clone().sub(from).normalize(), attacker: g.owner, weapon: { name: 'Frag grenade' }, dist: d, explosive: true });
    }
    this.noise(p, 90, g.owner);
  }

  // --- per frame ---------------------------------------------------------------------------------
  update(dt, input, settings) {
    if (this.state !== 'playing' && this.state !== 'over') return;
    this.time += dt;
    if (this.state === 'playing') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.end(this.scores.msg === this.scores.volk ? 'draw' : this.scores.msg > this.scores.volk ? 'msg' : 'volk'); }
      for (let i = this.respawns.length - 1; i >= 0; i--) {
        const r = this.respawns[i];
        r.t -= dt;
        if (r.t <= 0) { this.respawns.splice(i, 1); this.spawn(r.c); if (r.c === this.player) { this.hud.respawned(); this.audio.foley('respawn'); } }
      }
    }
    if (this.player.alive && this.state === 'playing') this.player.update(dt, input, settings);
    else this.deathCam(dt);
    for (const b of this.bots) {
      if (b.evade > 0) b.evade -= dt;
      b.update(dt);
    }
    this.updateGrenades(dt);
    this.ballistics.update(dt);
    this.effects.update(dt, this.camera);
    this.updateLaser();
    // Camera shake from explosions
    if (this.shake > 0.001) {
      this.camera.rotation.x += (Math.random() - 0.5) * this.shake * 0.04;
      this.camera.rotation.y += (Math.random() - 0.5) * this.shake * 0.04;
      this.shake *= Math.exp(-dt * 5);
    }
    this.camera.fov = settings.fov * (1 - this.vm.adsT * (1 - this.player.ws.stats.zoomFov));
    if (this.player.ws.stats.scoped) this.camera.fov *= 1 - this.vm.adsT * 0.08;
    this.camera.updateProjectionMatrix();
    const indoor = this.isIndoor(this.player.body.p) ? 1 : 0;
    this.indoorF += (indoor - this.indoorF) * Math.min(1, dt * 3);
    this.R.setIndoor(this.indoorF);
    // Is the sun reaching the weapon? One ray from the eye towards the sun.
    const sunHit = this.physics.raycast(this.camera.position, SUN_DIR, 160, (b) => !b.flags.boundary);
    const sunTarget = sunHit ? 0 : this.R.cloudShadeAt(this.camera.position);
    this.sunF = this.sunF === undefined ? sunTarget : this.sunF + (sunTarget - this.sunF) * Math.min(1, dt * 5);
    this.R.setViewSun(this.sunF);
    this.audio.setListener(this.camera);
  }

  deathCam(dt) {
    const cam = this.camera;
    if (!this.player.alive) {
      // Slump to the ground and look at the killer.
      const p = this.player.body.p;
      cam.position.y += (p.y + 0.35 - cam.position.y) * Math.min(1, dt * 3);
      cam.rotation.z += (0.5 - cam.rotation.z) * Math.min(1, dt * 2);
      const k = this.hud.killer;
      if (k && k.alive) {
        const dir = k.eye.clone().sub(cam.position);
        const yaw = Math.atan2(-dir.x, -dir.z);
        cam.rotation.y += ((yaw - cam.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 2);
      }
      this.vm.rig.visible = false;
      for (const o of [this.vm.handL, this.vm.handR, this.vm.foreL, this.vm.foreR]) o.visible = false;
    }
  }

  showViewmodel(v) {
    this.vm.rig.visible = v;
    for (const o of [this.vm.handL, this.vm.handR, this.vm.foreL, this.vm.foreR]) o.visible = v;
  }

  updateLaser() {
    const L = this.laser;
    const vm = this.vm;
    const on = this.player.alive && vm.gun && vm.gun.anchors.laser && !this.player.sprint && this.state === 'playing';
    L.beam.visible = L.dot.visible = !!on;
    if (!on) return;
    const from = vm.gunToWorld(vm.gun.anchors.laser, this.camera);
    const q = new THREE.Quaternion();
    vm.gun.root.getWorldQuaternion(q);
    q.premultiply(this.camera.quaternion);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const hit = this.physics.raycast(from, dir, 120);
    const len = hit ? hit.t : 120;
    L.beam.position.copy(from);
    L.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    L.beam.scale.set(1, 1, len);
    L.dot.visible = !!hit;
    if (hit) L.dot.position.copy(hit.point).addScaledVector(hit.normal, 0.01);
  }
}

export { FACTIONS };
