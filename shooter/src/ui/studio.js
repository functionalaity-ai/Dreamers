// Gunsmith turntable: a lit studio with soft-box reflections and drag-to-rotate.
import * as THREE from 'three';
import { buildGun } from '../weapons/gunmodels.js';

export class Studio {
  constructor(renderer, mats) {
    this.R = renderer;
    this.M = mats;
    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    // Background: dark vignette
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(256, 230, 20, 256, 256, 380);
    grad.addColorStop(0, '#5a564c'); grad.addColorStop(0.5, '#25262a'); grad.addColorStop(1, '#0b0c0d');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
    const bg = new THREE.CanvasTexture(c);
    bg.colorSpace = THREE.SRGBColorSpace;
    scene.background = bg;
    // Studio environment: a dark room with three soft boxes.
    const room = new THREE.Scene();
    room.add(new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: 0x5a5a5e, side: THREE.BackSide })));
    const panel = (w, h, x, y, z, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k * 0.96), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      room.add(m);
    };
    // Product-shot soft boxes: a big overhead strip, two side strips and a rim.
    panel(10, 3, 0, 5.5, 0, 26);
    panel(3, 7, -7, 1, 3, 16);
    panel(3, 7, 7, 1, -3, 18);
    panel(12, 1.6, 0, -2.5, -8, 6);
    panel(8, 2.5, 0, 0.8, 8, 9);
    const pm = new THREE.PMREMGenerator(renderer.r);
    scene.environment = pm.fromScene(room, 0.03).texture;
    pm.dispose();
    const key = new THREE.DirectionalLight(0xfff2e0, 14);
    key.position.set(-1, 2, 1.4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 5);
    fill.position.set(1.6, 0.4, 1.2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xc8dcff, 9);
    rim.position.set(0.5, 1.2, -2);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 2.2));
    this.turn = new THREE.Group();
    scene.add(this.turn);
    this.rotY = -Math.PI / 2 + 0.45;
    this.rotX = 0.12;
    this.zoom = 1;
    this.gun = null;
    this.drag = null;
  }

  bind(el) {
    el.addEventListener('pointerdown', (e) => { if (!this.active) return; this.drag = { x: e.clientX, y: e.clientY, ry: this.rotY, rx: this.rotX }; });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.rotY = this.drag.ry + (e.clientX - this.drag.x) * 0.008;
      this.rotX = Math.max(-0.6, Math.min(0.8, this.drag.rx + (e.clientY - this.drag.y) * 0.006));
    });
    window.addEventListener('pointerup', () => { this.drag = null; });
    el.addEventListener('wheel', (e) => { if (this.active) this.zoom = Math.max(0.45, Math.min(1.6, this.zoom * (e.deltaY > 0 ? 1.08 : 0.92))); }, { passive: true });
  }

  show(id, att) {
    if (this.gun) { this.turn.remove(this.gun.root); }
    this.gun = buildGun(id, att, this.M.gun, { fp: true });
    this.gun.mag.setAmmo(99);
    this.turn.add(this.gun.root);
    const box = new THREE.Box3().setFromObject(this.gun.root);
    const c = box.getCenter(new THREE.Vector3());
    this.gun.root.position.sub(c);
    this.size = box.getSize(new THREE.Vector3()).length();
    // Light the optic reticle when an optic is fitted.
  }

  render() {
    const cam = this.camera;
    const w = this.R.width, h = this.R.height;
    cam.aspect = w / h;
    // Frame the gun in the middle third of the screen.
    const dist = (this.size / 2) / Math.tan((cam.fov * Math.PI / 180) / 2) * 1.0 * this.zoom * Math.max(1, 1.25 / cam.aspect);
    cam.position.set(0, 0.02, dist);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    if (!this.drag) this.rotY += 0.0015;
    this.turn.rotation.set(this.rotX, this.rotY, 0, 'YXZ');
    this.R.render({ scene: this.scene, camera: cam });
  }
}
