import { rand, chance, pick } from "./rng";

/**
 * Session tempo — the anti-pattern layer.
 *
 * Bug Hunt and Koi Pond started to feel predictable, and the reason is that
 * everything in them was drawn from a fixed distribution: each animal had one
 * speed for its whole life, and the population as a whole never changed
 * character. Individually random, collectively uniform. Watch it for two
 * minutes and you've seen the whole range.
 *
 * Real prey doesn't work like that. A field goes quiet, then something spooks
 * and everything moves at once, then it settles. So the world runs through
 * moods of unequal length, individual animals drift their own speed around
 * the mood, and occasional bursts fire without any warning.
 */

export type Mood = "calm" | "restless" | "frantic";

const MOODS: Record<Mood, { mul: number; min: number; max: number }> = {
  // Long and slow. Stillness is what builds a pounce, and it also makes the
  // frantic stretches land much harder by contrast.
  calm: { mul: 0.62, min: 7, max: 17 },
  restless: { mul: 1.0, min: 6, max: 14 },
  // Deliberately short: this is the pay-off, not the baseline.
  frantic: { mul: 1.7, min: 2.5, max: 6 },
};

export class Tempo {
  mood: Mood = "restless";
  private left = 0;
  /** Smoothed multiplier, so mood changes ramp rather than snap. */
  private cur = 1;
  private burstIn: number;

  constructor() {
    this.pickMood();
    this.burstIn = rand(16, 6);
  }

  private pickMood() {
    // Never repeat a mood back-to-back — that's how you get long stretches of
    // sameness, which is the exact problem this is here to solve.
    const opts = (Object.keys(MOODS) as Mood[]).filter((m) => m !== this.mood);
    this.mood = pick(opts);
    const m = MOODS[this.mood];
    this.left = rand(m.max, m.min);
  }

  update(dt: number) {
    this.left -= dt;
    if (this.left <= 0) this.pickMood();
    const target = MOODS[this.mood].mul;
    // Ease toward the new mood over roughly a second.
    this.cur += (target - this.cur) * Math.min(1, dt * 1.6);
    this.burstIn -= dt;
  }

  /** Multiply speeds, spawn rates and aggression by this. */
  get speed() {
    return this.cur;
  }

  /** Shorter freezes when the world is worked up, longer when it's calm. */
  get freeze() {
    return 1 / Math.max(0.35, this.cur);
  }

  /**
   * Fires once at unpredictable intervals: a sudden collective event with no
   * build-up. Sample it every frame; it self-rearms.
   */
  takeBurst() {
    if (this.burstIn > 0) return false;
    this.burstIn = rand(24, 9);
    return true;
  }
}

/**
 * Per-animal speed drift. Each animal wanders its own multiplier around the
 * shared tempo, so a shoal or a swarm never moves as one uniform mass and no
 * single animal keeps a constant pace long enough to be predicted.
 */
export class Drift {
  private v: number;
  private target: number;
  private left: number;
  private lo: number;
  private hi: number;

  constructor(lo = 0.6, hi = 1.5) {
    this.lo = lo;
    this.hi = hi;
    this.v = rand(hi, lo);
    this.target = this.v;
    this.left = rand(4, 1);
  }

  update(dt: number) {
    this.left -= dt;
    if (this.left <= 0) {
      this.left = rand(5, 0.8);
      // Occasionally jump rather than ease — a sudden change of pace is far
      // more arresting than a smooth one.
      this.target = rand(this.hi, this.lo);
      if (chance(0.25)) this.v = this.target;
    }
    this.v += (this.target - this.v) * Math.min(1, dt * 1.1);
    return this.v;
  }

  get value() {
    return this.v;
  }
}
