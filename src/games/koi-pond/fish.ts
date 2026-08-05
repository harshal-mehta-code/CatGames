import { rand, randInt, chance, clamp, TAU, damp, angleLerp } from "@/lib/rng";

/**
 * Koi, moving as a school.
 *
 * Every other game here has prey that acts alone. Fish don't: they align with
 * their neighbours, and a paw landing in the middle of a shoal makes the whole
 * thing burst apart and re-form. That collective reaction is a much bigger
 * pay-off for a single swat than one animal bolting, and it's the reason this
 * one is worth building as boids rather than as more independent wanderers.
 */

export interface Genome {
  /** Base body colour — amber or blue-violet, the bands a cat resolves. */
  hue: number;
  sat: number;
  light: number;
  patchHue: number;
  patches: { at: number; r: number; off: number }[];
  len: number;
  girth: number;
  /** Tail beat frequency multiplier. */
  cadence: number;
  speed: number;
  /** How readily it comes up to the surface, where it can be caught. */
  boldness: number;
}

export function makeGenome(big = false): Genome {
  const hue = chance(0.62) ? rand(46, 22) : rand(228, 198);
  return {
    hue,
    sat: rand(88, 55),
    light: rand(78, 55),
    // Koi are patched with a contrasting colour; pull it to the other band.
    patchHue: hue > 150 ? rand(52, 30) : rand(226, 200),
    patches: Array.from({ length: randInt(4, 1) }, () => ({
      at: rand(0.85, 0.15),
      r: rand(0.42, 0.2),
      off: rand(0.35, -0.35),
    })),
    len: rand(88, 62) * (big ? 1.55 : 1),
    girth: rand(0.4, 0.3),
    cadence: rand(1.3, 0.75),
    speed: rand(78, 44) * (big ? 0.78 : 1),
    boldness: rand(0.85, 0.3),
  };
}

export interface PondWorld {
  w: number;
  h: number;
  threats: { x: number; y: number; r: number }[];
  /** Lily pads: fish under one are hidden from above. */
  pads: { x: number; y: number; r: number }[];
  speedScale: number;
  /** Multiplies how long a fish loiters at the surface. */
  surfaceScale: number;
  fleeRadius: number;
}

export type FishState = "cruise" | "rise" | "surface" | "dive" | "caught" | "gone";

export class Fish {
  g: Genome;
  x: number;
  y: number;
  a: number;
  v: number;
  /** 0 = breaking the surface, 1 = deep. Only shallow fish are catchable. */
  z = 1;
  zGoal = 1;
  state: FishState = "cruise";
  stateT = 0;
  big: boolean;
  /** Phase offset so a school doesn't beat its tails in unison. */
  phase = rand(TAU);
  caught = false;
  caughtT = 0;
  /** Scatter impulse from a nearby strike. */
  panic = 0;

  constructor(g: Genome, x: number, y: number, big = false) {
    this.g = g;
    this.x = x;
    this.y = y;
    this.big = big;
    this.a = rand(TAU);
    this.v = g.speed;
  }

  /** Rendered position. Water bends the view, so deep fish sit offset. */
  get viewX() {
    return this.x + this.z * 13;
  }
  get viewY() {
    return this.y + this.z * 17;
  }

  get catchable() {
    return !this.caught && this.z < 0.42 && this.state !== "gone";
  }

  get hitRadius() {
    return this.g.len * 0.42;
  }

  hidden(world: PondWorld) {
    for (const p of world.pads) {
      if (Math.hypot(p.x - this.viewX, p.y - this.viewY) < p.r * 0.82) return true;
    }
    return false;
  }

  /** A near miss: bolts, dives, and drags its neighbours with it. */
  scatter(fromX: number, fromY: number, hard: boolean) {
    this.panic = Math.max(this.panic, hard ? 1 : 0.6);
    this.a = Math.atan2(this.y - fromY, this.x - fromX) + rand(0.5, -0.5);
    if (hard) {
      this.zGoal = 1;
      this.state = "dive";
      this.stateT = 0;
    }
  }

  /**
   * Terminal catch. Pinned against the surface, it thrashes and goes still.
   * As everywhere else here, the hunt has to be winnable and it has to end.
   */
  pin() {
    if (this.caught) return false;
    this.caught = true;
    this.state = "caught";
    this.caughtT = 0;
    this.z = 0;
    return true;
  }

  get struggle() {
    return this.caughtT < 0.45 ? 1 : clamp(1 - (this.caughtT - 0.45) / 1.1, 0, 1);
  }
  get fade() {
    return clamp(1 - (this.caughtT - 2.2) / 0.8, 0, 1);
  }

  update(dt: number, world: PondWorld, school: Fish[]) {
    this.stateT += dt;
    this.panic = Math.max(0, this.panic - dt * 0.85);

    if (this.state === "caught") {
      this.caughtT += dt;
      // Thrashing on the spot, slowing to nothing.
      this.a += Math.sin(this.caughtT * 34) * this.struggle * 0.4;
      this.x += Math.cos(this.a) * this.struggle * 26 * dt;
      this.y += Math.sin(this.a) * this.struggle * 26 * dt;
      if (this.caughtT > 3) this.state = "gone";
      return;
    }

    // --- Depth behaviour --------------------------------------------------
    switch (this.state) {
      case "cruise":
        // Coming up to feed is the catchable window, so it has to happen
        // often enough to be worth waiting for.
        if (this.stateT > rand(9, 3) / (this.g.boldness + 0.2)) {
          this.state = "rise";
          this.stateT = 0;
          this.zGoal = rand(0.28, 0.02);
        }
        break;
      case "rise":
        if (this.z < this.zGoal + 0.06) {
          this.state = "surface";
          this.stateT = 0;
        }
        break;
      case "surface":
        if (this.stateT > rand(3.4, 1.4) * world.surfaceScale) {
          this.state = "dive";
          this.stateT = 0;
          this.zGoal = rand(1, 0.55);
        }
        break;
      case "dive":
        if (this.z > this.zGoal - 0.06) {
          this.state = "cruise";
          this.stateT = 0;
        }
        break;
    }
    // Panic always overrides: a startled fish goes deep.
    if (this.panic > 0.5) this.zGoal = 1;
    this.z = damp(this.z, this.zGoal, this.panic > 0.5 ? 0.16 : 0.55, dt);
    this.z = clamp(this.z, 0, 1);

    // --- Schooling --------------------------------------------------------
    // Classic three rules, weighted so the shoal stays loose enough that
    // individual fish are still trackable — a tight blob is one target, and
    // one target is much less interesting than twelve.
    let sepX = 0;
    let sepY = 0;
    let alignA = this.a;
    let cohX = 0;
    let cohY = 0;
    let n = 0;
    for (const o of school) {
      if (o === this || o.caught) continue;
      const dx = o.x - this.x;
      const dy = o.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 150 || d < 1e-3) continue;
      // Neighbours at similar depth school together; a deep fish doesn't
      // align with one at the surface.
      const zw = 1 - Math.min(1, Math.abs(o.z - this.z) * 2.2);
      if (zw <= 0) continue;
      if (d < this.g.len * 1.25) {
        sepX -= (dx / d) * (1 - d / (this.g.len * 1.25));
        sepY -= (dy / d) * (1 - d / (this.g.len * 1.25));
      }
      alignA = angleLerp(alignA, o.a, 0.12 * zw);
      cohX += dx * zw;
      cohY += dy * zw;
      n++;
    }

    let want = this.a;
    if (n > 0) {
      cohX /= n;
      cohY /= n;
      const cohA = Math.atan2(cohY, cohX);
      want = angleLerp(want, alignA, 0.5);
      want = angleLerp(want, cohA, 0.16);
    }
    if (sepX || sepY) {
      want = angleLerp(want, Math.atan2(sepY, sepX), 0.55);
    }

    // --- Threats ----------------------------------------------------------
    // A paw on the glass is a shadow overhead. Fish react to it from further
    // away the shallower they are, which is honest and also keeps a surfaced
    // fish genuinely hard to land.
    for (const t of world.threats) {
      const d = Math.hypot(t.x - this.viewX, t.y - this.viewY);
      const reach = (120 + (1 - this.z) * 90) * world.fleeRadius;
      if (d < reach) {
        const away = Math.atan2(this.y - t.y, this.x - t.x);
        want = angleLerp(want, away, clamp(1 - d / reach, 0, 1) * 0.7);
        this.panic = Math.max(this.panic, (1 - d / reach) * 0.9);
      }
    }

    // Wander, so a calm pond still drifts.
    want += Math.sin(this.stateT * 0.9 + this.phase) * 0.35 * dt * 60 * 0.02;

    // Turn away from the banks rather than bouncing off them.
    const m = 60;
    if (this.x < m) want = angleLerp(want, 0, 0.1);
    if (this.x > world.w - m) want = angleLerp(want, Math.PI, 0.1);
    if (this.y < m) want = angleLerp(want, Math.PI / 2, 0.1);
    if (this.y > world.h - m) want = angleLerp(want, -Math.PI / 2, 0.1);

    this.a = angleLerp(this.a, want, 1 - Math.pow(0.02, dt));

    const target =
      this.g.speed * world.speedScale * (1 + this.panic * 2.1) *
      // Fish loitering at the surface idle along slowly; that's the moment
      // worth waiting for.
      (this.state === "surface" ? 0.5 : 1);
    this.v = damp(this.v, target, 0.22, dt);
    this.x += Math.cos(this.a) * this.v * dt;
    this.y += Math.sin(this.a) * this.v * dt;
    this.x = clamp(this.x, 12, world.w - 12);
    this.y = clamp(this.y, 12, world.h - 12);
  }
}

/**
 * Draw one koi. Depth drives size, contrast and softness — a deep fish is a
 * dim smudge, a surfaced one is sharp and unmistakably a target.
 */
export function drawFish(g: CanvasRenderingContext2D, f: Fish, t: number) {
  const z = f.z;
  const gm = f.g;
  // Perspective: deeper is smaller and much dimmer, since the point is that
  // surfacing is what makes a fish worth swatting at.
  const scale = 1 - z * 0.42;
  // Deep fish fade almost out. Concealment has to be real for a surfacing to
  // register as an emergence rather than as a fish getting slightly brighter —
  // and something appearing from nowhere is the strongest trigger there is.
  const alpha = (f.caught ? f.fade : 1) * (1 - z * 0.8);
  const L = gm.len * scale;
  // Half-width. Girth is a fraction of length, so this has to be halved again
  // or the body comes out about 1.5:1 — a blob, not a fish.
  const W = L * gm.girth * 0.5;

  const beat = f.caught
    ? Math.sin(t * 30) * f.struggle
    : Math.sin(t * 6 * gm.cadence + f.phase) * (0.5 + f.v / 140);

  g.save();
  g.globalAlpha = alpha;
  g.translate(f.viewX, f.viewY);
  g.rotate(f.a);

  // Soft halo standing in for the blur of looking through water. Cheaper than
  // a real filter and reads correctly at a glance.
  if (z > 0.15) {
    const halo = g.createRadialGradient(0, 0, 0, 0, 0, L * 0.85);
    halo.addColorStop(0, `hsla(${gm.hue} ${gm.sat}% ${gm.light}% / ${0.3 * z})`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = halo;
    g.beginPath();
    g.arc(0, 0, L * 0.85, 0, TAU);
    g.fill();
  }

  // Forked caudal fin: two lobes sweeping off the same root. A single
  // tapering spike — which is what a naive tail path gives you — reads as an
  // insect, not a fish, and the silhouette is most of what a cat has to go on.
  const root = -L * 0.45;
  const tipX = -L * 0.98;
  const sweep = beat * W * 1.5;
  g.fillStyle = `hsla(${gm.hue} ${gm.sat}% ${gm.light * 0.8}% / 0.72)`;
  g.beginPath();
  g.moveTo(root, 0);
  for (const side of [1, -1]) {
    g.quadraticCurveTo(
      -L * 0.72,
      sweep * 0.55,
      tipX,
      sweep + side * W * 2.1,
    );
    g.quadraticCurveTo(-L * 0.68, sweep * 0.3 + side * W * 0.2, root, 0);
  }
  g.fill();

  // Pectoral fins.
  g.fillStyle = `hsla(${gm.hue} ${gm.sat}% ${Math.min(92, gm.light + 12)}% / 0.6)`;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(
      L * 0.06,
      side * W * 0.75,
      L * 0.17,
      W * 0.3,
      side * (0.5 + beat * 0.25),
      0,
      TAU,
    );
    g.fill();
  }

  // Body.
  const body = g.createLinearGradient(0, -W, 0, W);
  body.addColorStop(0, `hsl(${gm.hue} ${gm.sat}% ${Math.min(94, gm.light + 18)}%)`);
  body.addColorStop(1, `hsl(${gm.hue} ${gm.sat}% ${gm.light * 0.62}%)`);
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(0, 0, L * 0.52, W, 0, 0, TAU);
  g.fill();

  // Dorsal fin — a small thing, but it's the other half of "this is a fish".
  g.fillStyle = `hsla(${gm.hue} ${gm.sat}% ${gm.light * 0.75}% / 0.6)`;
  g.beginPath();
  g.moveTo(L * 0.1, -W * 0.85);
  g.quadraticCurveTo(-L * 0.05, -W * 1.55 - beat * W * 0.3, -L * 0.28, -W * 0.8);
  g.closePath();
  g.fill();

  // Patches. Clipped to the body so a koi looks marked rather than spotty.
  g.save();
  g.beginPath();
  g.ellipse(0, 0, L * 0.5, W, 0, 0, TAU);
  g.clip();
  g.fillStyle = `hsl(${gm.patchHue} ${gm.sat}% ${Math.min(90, gm.light + 10)}%)`;
  for (const p of gm.patches) {
    g.beginPath();
    g.ellipse(
      (p.at - 0.5) * L,
      p.off * W,
      L * p.r * 0.5,
      W * p.r * 1.5,
      0,
      0,
      TAU,
    );
    g.fill();
  }
  g.restore();

  // Eye — only worth drawing when near enough the surface to read.
  if (z < 0.55) {
    g.globalAlpha = alpha * (1 - z / 0.55);
    g.fillStyle = "rgba(10,12,16,0.85)";
    g.beginPath();
    g.arc(L * 0.33, -W * 0.42, Math.max(1.1, L * 0.045), 0, TAU);
    g.fill();
  }

  g.restore();
}
