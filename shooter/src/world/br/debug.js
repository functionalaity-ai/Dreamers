// Dev-only viewer for the Battle Royale map (brdebug.html): boots the renderer and materials the
// way main.js does, builds the map, bakes the bounce light and the nav graph, then exposes
// window.__br for automated views. Not part of the game.
import * as THREE from 'three';
import { Renderer, SUN_DIR } from '../../core/renderer.js';
import { Materials } from '../../core/materials.js';
import { Physics } from '../../core/physics.js';
import { PRESETS } from '../../config.js';
import { SHARED, SHARED_PROBE_MATS, linkProbe } from '../../core/shaderlib.js';
import { cloudTexture } from '../../core/sky.js';
import { bakeBounce } from '../../core/bounce.js';
import { NavGraph } from '../navmesh.js';
import { buildBRMap, BR_BOUNDS } from './brmap.js';

const log = (t) => { const el = document.getElementById('log'); if (el) el.textContent = t; };

async function boot() {
  const q = new URLSearchParams(location.search);
  let key = q.get('preset');
  if (!key) { try { key = (JSON.parse(localStorage.getItem('iron-meridian-settings-v1')) || {}).preset; } catch (e) { key = null; } }
  const preset = PRESETS[key] || PRESETS.medium;
  const R = new Renderer(document.getElementById('view'));
  linkProbe(R.probe.uniforms);
  SHARED.sunDirW.value.copy(SUN_DIR);
  SHARED.sunColorW.value.copy(R.sun.color).multiplyScalar(R.sun.intensity);
  SHARED.ambW.value.setRGB(0.55, 0.62, 0.75);
  log('materials');
  const mats = await new Materials(preset, R.r).build();
  R.setClouds(cloudTexture(mats.baker));
  log('map');
  const ph = new Physics(BR_BOUNDS.minX, BR_BOUNDS.minZ, BR_BOUNDS.maxX, BR_BOUNDS.maxZ);
  const before = new Set(R.scene.children);
  const t0 = performance.now();
  const map = buildBRMap(ph, mats, R.scene, { preset, renderer: R });
  const buildMs = performance.now() - t0;
  R.freezeStatic(R.scene.children.filter((o) => !before.has(o)));
  for (const l of map.lights) { const pl = new THREE.PointLight(0xffd29a, 7, 11, 2); pl.position.copy(l); R.scene.add(pl); }
  R.vol.setIndoor(map.indoor);
  log('nav');
  const tn = performance.now();
  const nav = new NavGraph(ph, BR_BOUNDS).build(map.hints, map.nav.area, map.nav.opts);
  const navMs = performance.now() - tn;
  log('lighting');
  const tb = performance.now();
  let gi = null;
  try { gi = await bakeBounce(R, { physics: ph, map, mats }, preset); } catch (e) { console.warn('bake failed', e); }
  const bakeMs = performance.now() - tb;
  R.applyPreset(preset);
  R.captureProbe(map.probe.position, map.probe.box, []);
  for (const m of SHARED_PROBE_MATS) { m.envMap = R.probe.texture; m.needsUpdate = true; }
  SHARED.probeOn.value = 1;
  const cam = R.camera;
  const view = (x, y, z, lx, ly, lz, fov = 75) => {
    cam.position.set(x, y, z);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.lookAt(lx, ly, lz);
    cam.updateMatrixWorld();
    // the containers cull a quarter per call: run a few so all of them are current
    for (let i = 0; i < 4; i++) map.update(cam, 0.016);
  };
  const frame = () => {
    const t = performance.now();
    R.render();
    const gl = R.r.getContext(), px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const inf = R.r.info.render;
    return { ms: Math.round(performance.now() - t), calls: inf.calls, tris: inf.triangles };
  };
  window.__br = {
    R, map, ph, nav, view, frame, THREE,
    stats: {
      buildMs: Math.round(buildMs), navMs: Math.round(navMs), bakeMs: Math.round(bakeMs), bake: gi && gi.stats,
      navNodes: nav.nodes.length, buildings: map.buildings.length, destroyed: map.buildings.filter((b) => b.destroyed).length,
      containers: map.containers.length, groundLoot: map.groundLoot.length, boxes: ph.boxes.length,
    },
    ready: true,
  };
  log('ready');
  const loop = () => { if (!window.__br.manual) { view(cam.position.x || 60, 1.7, cam.position.z || 16, -60, 1.6, 16); R.render(); } requestAnimationFrame(loop); };
  if (!q.has('static')) { cam.position.set(60, 1.7, 16); requestAnimationFrame(loop); }
}

boot().catch((e) => { console.error(e); log('failed: ' + e.message); window.__brError = String(e && e.stack || e); });
