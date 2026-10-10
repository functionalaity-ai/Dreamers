// Golden-hour sky: the Preetham analytic atmosphere (three's Sky) with a drifting layer of
// cumulus lit by the low sun: self-shadowed cores, bright silver linings on the sun side,
// fading into the haze at the horizon. The sun disc is hidden behind thick cloud, so the
// screen-space sun shafts stream through the gaps.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const FRAG = /* glsl */`
varying vec3 vWorldPosition;
varying vec3 vSunDirection;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
uniform float mieDirectionalG;
uniform vec3 up;
uniform sampler2D tCloud;
uniform float uTime, cloudCover, cloudScale, cloudOn, cloudSoft;
uniform vec2 cloudWind;
uniform vec3 cloudSun, cloudAmb;
uniform float rayAmt;
const float pi = 3.141592653589793;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.9999566769464484;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;
float rayleighPhase(float c) { return THREE_OVER_SIXTEENPI * (1.0 + c * c); }
float hgPhase(float c, float g) { float g2 = g * g; return ONE_OVER_FOURPI * ((1.0 - g2) / pow(1.0 - 2.0 * g * c + g2, 1.5)); }

float cloudField(vec2 p) {
  float a = texture2D(tCloud, p).r;
  float b = texture2D(tCloud, p * 2.7 + 0.17).g;
  float c = texture2D(tCloud, p * 8.3 + 0.53).b;
  float n = a * 0.5 + b * 0.4 + c * 0.1;
  return smoothstep(cloudCover, cloudCover + cloudSoft, n);
}

void main() {
  vec3 direction = normalize(vWorldPosition - cameraPosition);
  float zenithAngle = acos(max(0.0, dot(up, direction)));
  float inverse = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
  float sR = rayleighZenithLength * inverse;
  float sM = mieZenithLength * inverse;
  vec3 Fex = exp(-(vBetaR * sR + vBetaM * sM));
  float cosTheta = dot(direction, vSunDirection);
  float rPhase = rayleighPhase(cosTheta * 0.5 + 0.5);
  vec3 betaRTheta = vBetaR * rPhase;
  float mPhase = hgPhase(cosTheta, mieDirectionalG);
  vec3 betaMTheta = vBetaM * mPhase;
  vec3 Lin = pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - dot(up, vSunDirection), 5.0), 0.0, 1.0));
  vec3 L0 = vec3(0.1) * Fex;
  float sundisk = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta);
  float k = 1.0 / (1.2 + 1.2 * vSunfade);
  vec3 sky = pow((Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075), vec3(k));
  vec3 withSun = pow((Lin + L0 + vSunE * 19000.0 * Fex * sundisk) * 0.04 + vec3(0.0, 0.0003, 0.00075), vec3(k));
  vec3 disc = withSun - sky;
  float occ = 1.0;
  if (cloudOn > 0.5 && direction.y > 0.0) {
    float t = 1.0 / max(direction.y, 0.025);
    vec2 p = direction.xz * t * cloudScale + cloudWind * uTime;
    float d = cloudField(p);
    if (d > 0.002) {
      vec2 toSun = normalize(vSunDirection.xz + 1e-5) * 0.014;
      float s = cloudField(p + toSun) + cloudField(p + toSun * 2.3) * 0.8 + cloudField(p + toSun * 4.0) * 0.6;
      float shade = exp(-s * 1.3);
      float cs = max(cosTheta, 0.0);
      float fwd = pow(cs, 5.0) * 0.9 + pow(cs, 40.0) * 2.8;
      float thin = 1.0 - d;
      vec3 lit = cloudSun * (0.18 + 0.82 * shade) * (1.0 + fwd * (0.3 + thin * 2.2));
      vec3 amb = mix(cloudAmb, sky * 0.75, 0.3) * (0.55 + 0.45 * thin);
      vec3 cc = amb + lit;
      float fade = smoothstep(0.012, 0.22, direction.y);
      cc = mix(sky, cc, 0.35 + 0.65 * smoothstep(0.0, 0.18, direction.y));
      float alpha = clamp(d * 1.3, 0.0, 1.0) * fade;
      sky = mix(sky, cc, alpha);
      occ = 1.0 - smoothstep(0.15, 0.6, alpha);
    }
  }
  // crepuscular streaks fanning out from the sun (they also seed the screen-space shafts)
  if (rayAmt > 0.0 && cosTheta > 0.5) {
    vec3 s = vSunDirection;
    vec3 t1 = normalize(cross(s, abs(s.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(s, t1);
    float ang = atan(dot(direction, t2), dot(direction, t1));
    float rays = 0.0;
    vec2 ring = vec2(cos(ang), sin(ang));   // sample round a circle so the pattern has no seam
    rays += texture2D(tCloud, ring * 0.31 + vec2(uTime * 0.0012, 0.0)).b;
    rays += texture2D(tCloud, ring * 0.83 + vec2(0.3, uTime * 0.002 + 0.5)).b * 0.6;
    rays = smoothstep(0.78, 1.18, rays) - 0.35;
    float near = smoothstep(0.55, 0.999, cosTheta);
    sky *= 1.0 + rays * near * near * rayAmt * 0.6 * occ;
  }
  gl_FragColor = vec4(sky + disc * occ, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Tileable cloud noise: R broad billowing shapes (domain-warped fbm), G cauliflower billows
// (inverted Worley), B fine detail.
export function cloudTexture(baker) {
  return baker.raw({
    name: 'clouds', size: 1024, seed: 41,
    raw: /* glsl */`
      vec4 raw(vec2 uv) {
        vec2 w = uv + vec2(fbm(uv, 3.0, 4), fbm(uv + 0.37, 3.0, 4)) * 0.12;
        float a = fbm(w, 4.0, 6) + 0.5;
        vec4 v1 = voronoi(w, vec2(10.0), 1.0);
        vec4 v2 = voronoi(w + 0.31, vec2(23.0), 1.0);
        float b = 1.0 - (v1.x * 0.65 + v2.x * 0.35);
        float c = fbm(uv, 24.0, 4) + 0.5;
        return vec4(a, b, c, 1.0);
      }`,
  });
}

export const SKY = { turbidity: 4.6, rayleigh: 2.3, mieCoefficient: 0.0052, mieDirectionalG: 0.92 };

export function makeSky(sunDir, opts = {}) {
  const sky = new Sky();
  const base = sky.material;
  const mat = new THREE.ShaderMaterial({
    name: 'GoldenSky',
    uniforms: Object.assign(THREE.UniformsUtils.clone(base.uniforms), {
      tCloud: { value: opts.cloudTex || null },
      uTime: { value: 0 },
      cloudCover: { value: 0.47 },
      cloudSoft: { value: 0.16 },
      cloudScale: { value: 0.075 },
      cloudOn: { value: opts.cloudTex ? 1 : 0 },
      cloudWind: { value: new THREE.Vector2(0.0011, 0.0004) },
      cloudSun: { value: new THREE.Color(1.0, 0.7, 0.42).multiplyScalar(1.5) },
      cloudAmb: { value: new THREE.Color(0.36, 0.38, 0.44) },
      rayAmt: { value: 1.25 },
    }),
    vertexShader: base.vertexShader,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  base.dispose();
  sky.material = mat;
  sky.scale.setScalar(4000);
  const u = mat.uniforms;
  for (const k in SKY) u[k].value = SKY[k];
  u.sunPosition.value.copy(sunDir).multiplyScalar(4000);
  return sky;
}
