// Final pass: exposure, white balance, ACES filmic tone curve, sRGB encode, then a warm
// cinematic grade (split toning, contrast, saturation), vignette, fine film grain and
// dithering so smooth haze gradients never band.
import * as THREE from 'three';

export function makeGradeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      exposure: { value: 0.85 },
      whiteBalance: { value: new THREE.Vector3(1.07, 1.0, 0.89) },
      shadowTint: { value: new THREE.Vector3(1.0, 0.985, 0.97) },
      highTint: { value: new THREE.Vector3(1.05, 0.995, 0.9) },
      contrast: { value: 0.22 },
      saturation: { value: 0.98 },
      vignette: { value: 0.46 },
      grain: { value: 0.016 },
      time: { value: 0 },
      aspect: { value: 1.6 },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float exposure, contrast, saturation, vignette, aspect, grain, time;
      uniform vec3 whiteBalance, shadowTint, highTint;
      varying vec2 vUv;
      vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 aces(vec3 c) {
        const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        c = I * c; c = RRTAndODTFit(c); c = O * c; return clamp(c, 0.0, 1.0);
      }
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        c = max(c, 0.0) * whiteBalance * (exposure / 0.6);
        c = toSRGB(aces(c));
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c *= mix(shadowTint, highTint, smoothstep(0.15, 0.75, l));
        c = mix(c, c * c * (3.0 - 2.0 * c), contrast);
        l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, saturation);
        vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
        c *= 1.0 - vignette * pow(clamp(length(q) * 0.95, 0.0, 1.0), 2.4);
        // a slight filmic toe and fine luminance grain, strongest in the mid-tones
        c = c * 0.975 + 0.01;
        float gn = fract(sin(dot(gl_FragCoord.xy + fract(time * 13.7) * 91.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        c += gn * grain * (1.0 - abs(l - 0.5) * 1.4);
        c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
}
