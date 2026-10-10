// Ambient life: ash and soot flakes drifting close to the camera (soft, out of focus), and a
// flock of pigeons wheeling over the square.
import * as THREE from 'three';

export class Ash {
  constructor(scene, count = 70, box = 12) {
    this.box = box;
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * box; pos[i * 3 + 1] = Math.random() * box * 0.7; pos[i * 3 + 2] = Math.random() * box;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { camPos: { value: new THREE.Vector3() }, box: { value: box }, time: { value: 0 }, pxScale: { value: 600 }, light: { value: new THREE.Color(1, 0.8, 0.6) } },
      vertexShader: /* glsl */`
        attribute float seed;
        uniform float box, time, pxScale;
        uniform vec3 camPos;
        varying float vA, vBlur, vSeed;
        void main() {
          vec3 drift = vec3(sin(time * 0.3 + seed * 30.0) * 0.8 + time * 0.25, -time * (0.12 + seed * 0.18) + sin(time * 0.9 + seed * 17.0) * 0.15, cos(time * 0.27 + seed * 21.0) * 0.8 + time * 0.1);
          vec3 base = camPos - vec3(box * 0.5, box * 0.3, box * 0.5);
          vec3 h = vec3(box, box * 0.7, box);
          vec3 p = base + mod(position + drift - base, h);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          // focus at ~6 m: nearer and farther flakes blur into soft discs
          vBlur = clamp(abs(dist - 6.0) / 5.0, 0.0, 1.0);
          vA = smoothstep(0.4, 1.5, dist) * smoothstep(box * 0.55, box * 0.3, length(p.xz - camPos.xz)) * (0.35 + 0.4 * (1.0 - vBlur));
          vSeed = seed;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(pxScale * (0.012 + seed * 0.016) * (1.0 + vBlur * 1.6) / max(dist, 0.2), 1.0, 40.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 light;
        varying float vA, vBlur, vSeed;
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          q.x *= 1.0 + vSeed * 0.8;
          float r = dot(q, q);
          float a = (1.0 - smoothstep(mix(0.35, 0.0, vBlur), 1.0, r)) * vA;
          vec3 c = mix(vec3(0.05, 0.045, 0.04), light * 0.12, step(0.85, vSeed) * 0.6);
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  update(dt, camera, heightPx) {
    const u = this.mat.uniforms;
    u.time.value += dt;
    u.camPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.pxScale.value = heightPx / (2 * Math.tan(camera.fov * Math.PI / 360));
  }
}

// Pigeons: a body, two flapping wings and a tail per bird, instanced.
export class Flock {
  constructor(scene, count = 16, centre = new THREE.Vector3(0, 26, 0)) {
    this.n = count;
    this.centre = centre;
    const mat = new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.85, side: THREE.DoubleSide });
    const body = new THREE.SphereGeometry(0.09, 8, 6);
    body.scale(1, 0.9, 2.1);
    const head = new THREE.SphereGeometry(0.055, 8, 6);
    head.translate(0, 0.05, -0.2);
    const tail = new THREE.BufferGeometry();
    tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.01, 0.16, -0.08, 0, 0.36, 0.08, 0, 0.36], 3));
    tail.computeVertexNormals();
    const merge = (list) => {
      const out = new THREE.BufferGeometry();
      const pos = [];
      for (const g of list) { const gg = g.index ? g.toNonIndexed() : g; pos.push(...gg.attributes.position.array); }
      out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      out.computeVertexNormals();
      return out;
    };
    this.bodyGeo = merge([body, head, tail]);
    // wing: a tapered quad from the shoulder outwards (+x), mirrored for the left wing
    const wing = (s) => {
      const g = new THREE.BufferGeometry();
      const v = [0, 0, -0.07, s * 0.34, 0, -0.03, s * 0.34, 0, 0.08, 0, 0, -0.07, s * 0.34, 0, 0.08, 0, 0, 0.09];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.computeVertexNormals();
      return g;
    };
    this.meshes = [this.bodyGeo, wing(1), wing(-1)].map((g) => {
      const m = new THREE.InstancedMesh(g, mat, count);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    this.birds = [];
    for (let i = 0; i < count; i++) {
      this.birds.push({
        r: 18 + Math.random() * 22, h: Math.random() * 8 - 2, w: (0.16 + Math.random() * 0.06) * (i % 5 === 0 ? -1 : 1),
        a: Math.random() * Math.PI * 2, ph: Math.random() * 10, glide: Math.random(),
      });
    }
    this.t = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
  }

  update(dt) {
    this.t += dt;
    const [bodyM, wR, wL] = this.meshes;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.n; i++) {
      const b = this.birds[i];
      b.a += b.w * dt;
      const wob = Math.sin(this.t * 0.4 + b.ph) * 4;
      const r = b.r + wob;
      const p = this._p.set(this.centre.x + Math.cos(b.a) * r, this.centre.y + b.h + Math.sin(this.t * 0.7 + b.ph) * 1.5, this.centre.z + Math.sin(b.a) * r * 0.8);
      const dir = new THREE.Vector3(-Math.sin(b.a) * Math.sign(b.w), 0, Math.cos(b.a) * 0.8 * Math.sign(b.w)).normalize();
      const bank = -Math.sign(b.w) * 0.35;
      this._q.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, up));
      this._q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), bank));
      this._m.compose(p, this._q, this._s);
      bodyM.setMatrixAt(i, this._m);
      // flap in bursts, then glide
      const gliding = Math.sin(this.t * 0.6 + b.ph * 3) > 0.55 - b.glide * 0.4;
      const flap = gliding ? 0.12 : Math.sin(this.t * 14 + b.ph) * 0.9;
      for (const [mesh, s] of [[wR, 1], [wL, -1]]) {
        const q = this._q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s * flap));
        mesh.setMatrixAt(i, new THREE.Matrix4().compose(p, q, this._s));
      }
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}
