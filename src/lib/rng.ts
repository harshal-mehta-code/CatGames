/** Small deterministic-ish helpers. Nothing here needs crypto quality. */

export const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
export const randInt = (a: number, b = 0) => Math.floor(rand(a, b));
export const pick = <T,>(xs: readonly T[]) => xs[randInt(xs.length)];
export const chance = (p: number) => Math.random() < p;

/** Gaussian-ish via sum of uniforms. Cheap, good enough for jitter. */
export const gauss = (mean = 0, sd = 1) =>
  mean + ((Math.random() + Math.random() + Math.random() - 1.5) / 1.5) * sd;

/**
 * Levy-flight step length. Real foraging insects produce many short moves
 * punctuated by rare long dashes — this is what makes motion read as "alive"
 * rather than as a screensaver, and it's the single biggest lever on whether
 * a cat keeps watching.
 */
export const levyStep = (scale: number, cap = 12) =>
  Math.min(scale / Math.pow(Math.random(), 0.55), scale * cap);

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Frame-rate independent smoothing. `half` = half-life in seconds. */
export const damp = (a: number, b: number, half: number, dt: number) =>
  lerp(a, b, 1 - Math.pow(2, -dt / half));

export const TAU = Math.PI * 2;

export const angleLerp = (a: number, b: number, t: number) => {
  let d = ((b - a + Math.PI) % TAU) - Math.PI;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
};
