/* Small helpers shared by the game core and the renderer. */
(function (GHV) {
  'use strict';

  // Deterministic PRNG (mulberry32). Returns a function producing [0, 1).
  function makeRng(seed) {
    let a = seed >>> 0;
    const rng = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.state = function () { return a; };
    rng.int = function (min, max) { return min + Math.floor(rng() * (max - min + 1)); };
    rng.pick = function (arr) { return arr[Math.floor(rng() * arr.length)]; };
    return rng;
  }

  // Stable per-position hash in [0, 1) — used for decoration variants.
  function hash2(x, y, salt) {
    let h = (x * 374761393 + y * 668265263 + (salt || 0) * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  // Interpolate between two [r, g, b, a] arrays.
  function lerpColor(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t), lerp(c1[3], c2[3], t)];
  }

  function rgba(c, alphaMul) {
    const a = c[3] * (alphaMul === undefined ? 1 : alphaMul);
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a.toFixed(3) + ')';
  }

  // Sample a keyframe track [{t, ...values}] at time t, interpolating numeric/array fields.
  function sampleTrack(track, t) {
    if (t <= track[0].t) return track[0];
    for (let i = 1; i < track.length; i++) {
      const b = track[i];
      if (t <= b.t) {
        const a = track[i - 1];
        const k = smoothstep((t - a.t) / (b.t - a.t));
        const out = { t: t };
        for (const key in a) {
          if (key === 't') continue;
          if (Array.isArray(a[key])) out[key] = lerpColor(a[key], b[key], k);
          else out[key] = lerp(a[key], b[key], k);
        }
        return out;
      }
    }
    return track[track.length - 1];
  }

  // 370 -> "6:10 AM"; values past midnight wrap (1500 -> "1:00 AM").
  function formatTime(minutes) {
    const m = Math.floor(minutes / 10) * 10;
    let h = Math.floor(m / 60) % 24;
    const mm = m % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return h + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
  }

  GHV.util = {
    makeRng: makeRng,
    hash2: hash2,
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    lerpColor: lerpColor,
    rgba: rgba,
    sampleTrack: sampleTrack,
    formatTime: formatTime,
  };
})(window.GHV = window.GHV || {});
