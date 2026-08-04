import { rand, randInt, pick, chance } from "@/lib/rng";

/**
 * A bug species is generated, not authored. Each session rolls 2-3 fresh
 * genomes, so the cats are never hunting the same animal twice. This is the
 * main defence against habituation — the reason most cat apps stop working
 * after about a week is that the prey is a fixed sprite.
 */

export type ShellPattern = "plain" | "stripes" | "spots" | "ridge" | "iridescent";
export type BodyPlan = "beetle" | "roach" | "spider" | "cricket" | "firefly";

export interface Genome {
  plan: BodyPlan;
  /** Overall scale in CSS px — roughly real insect size on a 11" iPad. */
  size: number;
  bodyLen: number;
  bodyW: number;
  headR: number;
  segments: number;
  legPairs: number;
  legLen: number;
  legSpread: number;
  antennaLen: number;
  /** Hue in the blue / amber-green band cats actually discriminate. */
  hue: number;
  sat: number;
  light: number;
  gloss: number;
  pattern: ShellPattern;
  patternHue: number;
  /** Base cruise speed multiplier. */
  speed: number;
  /** Levy step scale — how far a single dash carries. */
  burst: number;
  /** Heading noise. High = frantic, low = purposeful. */
  jitter: number;
  /** Multiplier on how long it holds still. Freezes are what trigger pounces. */
  freezeBias: number;
  /** Leg cadence in cycles/sec at cruise. */
  cadence: number;
  /** Emissive glow, fireflies only. */
  glow: number;
  /** How readily it dives under cover. */
  shy: number;
}

/**
 * Cats are dichromats: they resolve blue-violet and yellow-green well and are
 * effectively red-blind. Every colour we generate sits in one of those two
 * bands so the prey is genuinely high-contrast to *them*, not just to us.
 */
const CAT_VISIBLE_HUES = [
  [200, 250], // blue - violet
  [45, 95], // amber - yellow-green
] as const;

function catHue() {
  const [lo, hi] = pick(CAT_VISIBLE_HUES);
  return rand(hi, lo);
}

const PLANS: BodyPlan[] = ["beetle", "roach", "spider", "cricket", "firefly"];

export function makeGenome(plan: BodyPlan = pick(PLANS)): Genome {
  const size = rand(1.7, 1.15);
  const hue = catHue();

  const base: Genome = {
    plan,
    size,
    bodyLen: 26,
    bodyW: 15,
    headR: 5,
    segments: 3,
    legPairs: 3,
    legLen: 15,
    legSpread: 0.85,
    antennaLen: 14,
    hue,
    sat: rand(88, 58),
    light: rand(78, 56),
    gloss: rand(0.9, 0.35),
    pattern: pick<ShellPattern>([
      "plain",
      "stripes",
      "spots",
      "ridge",
      "iridescent",
    ]),
    // Pattern colour is pulled to the *other* visible band for real contrast.
    patternHue: hue > 150 ? rand(90, 45) : rand(250, 200),
    speed: rand(1.2, 0.75),
    burst: rand(1.3, 0.7),
    jitter: rand(1.3, 0.5),
    freezeBias: rand(1.4, 0.6),
    cadence: rand(9, 5),
    glow: 0,
    shy: rand(0.8, 0.15),
  };

  switch (plan) {
    case "beetle":
      return {
        ...base,
        bodyLen: 30,
        bodyW: 21,
        segments: 2,
        legLen: 13,
        antennaLen: 9,
        speed: base.speed * 0.8,
        burst: base.burst * 0.8,
        gloss: rand(1, 0.6),
        freezeBias: base.freezeBias * 1.3,
        cadence: base.cadence * 0.8,
      };
    case "roach":
      return {
        ...base,
        bodyLen: 32,
        bodyW: 16,
        segments: 5,
        legLen: 18,
        legSpread: 1.0,
        antennaLen: 26,
        speed: base.speed * 1.45,
        burst: base.burst * 1.5,
        jitter: base.jitter * 1.4,
        freezeBias: base.freezeBias * 0.7,
        cadence: base.cadence * 1.4,
        shy: Math.min(1, base.shy + 0.35),
      };
    case "spider":
      return {
        ...base,
        bodyLen: 20,
        bodyW: 18,
        segments: 2,
        legPairs: 4,
        legLen: 26,
        legSpread: 1.2,
        antennaLen: 0,
        speed: base.speed * 1.1,
        burst: base.burst * 1.6,
        freezeBias: base.freezeBias * 1.6, // long stalls, then a sudden dash
        cadence: base.cadence * 1.2,
      };
    case "cricket":
      return {
        ...base,
        bodyLen: 27,
        bodyW: 13,
        segments: 4,
        legLen: 16,
        antennaLen: 30,
        speed: base.speed * 0.9,
        burst: base.burst * 2.2, // hops
        freezeBias: base.freezeBias * 1.5,
        cadence: base.cadence * 0.9,
      };
    case "firefly":
      return {
        ...base,
        bodyLen: 24,
        bodyW: 12,
        segments: 3,
        legLen: 12,
        antennaLen: 12,
        hue: rand(160, 110), // the one green cats see best
        sat: 80,
        light: 55,
        speed: base.speed * 0.85,
        burst: base.burst * 0.9,
        glow: rand(1, 0.6),
        freezeBias: base.freezeBias * 1.2,
        shy: 0.05,
      };
  }
}

/** A session's cast: a couple of common species plus one rare showpiece. */
export function makeSpeciesSet(): { common: Genome[]; rare: Genome } {
  const n = chance(0.5) ? 2 : 3;
  const plans = [...PLANS].sort(() => Math.random() - 0.5);
  const common = Array.from({ length: n }, (_, i) =>
    makeGenome(plans[i % plans.length]),
  );
  const rare = makeGenome(plans[(n + randInt(2)) % plans.length]);
  // The rare one is bigger, glossier and slower — a deliberately catchable
  // trophy that pays out a bigger reward moment.
  rare.size *= rand(1.9, 1.55);
  rare.gloss = 1;
  rare.speed *= 0.7;
  rare.freezeBias *= 1.4;
  return { common, rare };
}
