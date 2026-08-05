import { rand, randInt, chance, clamp, TAU, damp, angleLerp } from "@/lib/rng";
import { alongTunnel, type Burrow, type Tunnel } from "./burrow";

/**
 * One mouse in the burrow.
 *
 * Every mouse is generated: colour, size, ear size, tail, nerve and boldness.
 * A fixed sprite is what makes most cat apps stop working after a week — the
 * animal becomes a known quantity and stops being prey.
 */

export type MouseState =
  | "travel"
  | "peek"
  | "surface"
  | "dive"
  | "caught"
  | "gone";

export interface MouseWorld {
  burrow: Burrow;
  threats: { x: number; y: number; r: number }[];
  /** Multiplies travel and run speed. */
  speedScale: number;
  /** Multiplies how long a peek is held. Long holds are what draw a pounce. */
  freezeScale: number;
  /** How readily it comes fully out into the open. */
  boldScale: number;
  fleeRadius: number;
}

/**
 * How far clear of a hole's centre an emerging mouse sits. Big enough that the
 * head, shoulders and ears clear the mouth — otherwise the hole clip simply
 * eats the animal and leaves a couple of whiskers showing.
 */
export const emergePush = (holeR: number, out: number) =>
  holeR * (0.25 + 0.9 * out);

export class Mouse {
  state: MouseState = "travel";
  stateT = 0;

  // --- Genes ---------------------------------------------------------------
  /** Amber or blue-violet — the two bands a dichromat cat actually resolves. */
  hue = chance(0.55) ? rand(44, 26) : rand(226, 202);
  sat = rand(58, 26);
  light = rand(82, 62);
  size = rand(26, 20);
  earScale = rand(1.35, 0.7);
  plump = rand(1.18, 0.86);
  tailLen = rand(1.5, 0.95);
  /** Base speed in px/s. */
  cruise = rand(240, 155);
  /** How long it will sit in a hole mouth before committing. */
  nerve = rand(1.7, 0.6);
  /** Probability of fully leaving the hole rather than ducking back under. */
  bold = rand(0.7, 0.25);

  // --- Position ------------------------------------------------------------
  x = 0;
  y = 0;
  a = 0;
  /** 0 = fully underground, 1 = fully out on the surface. */
  out = 0;

  // Tunnel travel
  tunnel: Tunnel | null = null;
  /** Node index the mouse entered the current tunnel from. */
  from = 0;
  dist = 0;
  /** Node it is currently at, when not in a tunnel. */
  at = 0;

  // Surface running
  targetHole = 0;
  runPause = 0;

  // Capture
  caught = false;
  revealT = 0;
  /** Squirming after a near-miss: faster, more erratic, for a few seconds. */
  flushed = 0;

  constructor(world: MouseWorld, startHole: number) {
    this.at = startHole;
    const h = world.burrow.holes[startHole];
    this.x = h.x;
    this.y = h.y;
    this.enterTunnel(world);
  }

  private get speed() {
    return this.cruise * (this.flushed > 0 ? 1.6 : 1);
  }

  /** Pick an onward tunnel from the current node, preferring not to backtrack. */
  private enterTunnel(world: MouseWorld) {
    const hole = world.burrow.holes[this.at];
    const opts = hole.edges.filter((e) => world.burrow.tunnels[e] !== this.tunnel);
    const pool = opts.length ? opts : hole.edges;
    if (!pool.length) return;
    const t = world.burrow.tunnels[pool[randInt(pool.length)]];
    this.tunnel = t;
    this.from = this.at;
    this.dist = 0;
    this.state = "travel";
    this.stateT = 0;
    this.out = 0;
  }

  private tunnelPose() {
    const t = this.tunnel;
    if (!t) return { x: this.x, y: this.y, a: this.a };
    // Distance is always measured from `from`, so flip when travelling b→a.
    const d = this.from === t.a ? this.dist : t.len - this.dist;
    const p = alongTunnel(t, d);
    return {
      x: p.x,
      y: p.y,
      a: this.from === t.a ? p.a : p.a + Math.PI,
    };
  }

  /** The node at the far end of the current tunnel. */
  private get destination() {
    const t = this.tunnel;
    if (!t) return this.at;
    return this.from === t.a ? t.b : t.a;
  }

  update(dt: number, world: MouseWorld) {
    this.stateT += dt;
    this.flushed = Math.max(0, this.flushed - dt);

    if (this.state === "caught") {
      this.revealT += dt;
      if (this.revealT > 3.1) this.state = "gone";
      return;
    }

    const nearestThreat = () => {
      let best: { x: number; y: number; d: number } | null = null;
      for (const t of world.threats) {
        const d = Math.hypot(t.x - this.x, t.y - this.y);
        if (!best || d < best.d) best = { x: t.x, y: t.y, d };
      }
      return best;
    };

    switch (this.state) {
      case "travel": {
        const t = this.tunnel;
        if (!t) {
          this.enterTunnel(world);
          break;
        }
        this.dist += this.speed * world.speedScale * dt;
        const pose = this.tunnelPose();
        this.x = pose.x;
        this.y = pose.y;
        this.a = angleLerp(this.a, pose.a, 1 - Math.pow(0.001, dt));
        if (this.dist >= t.len) {
          this.at = this.destination;
          this.dist = t.len;
          const hole = world.burrow.holes[this.at];
          // A collapsed hole can't be used as an exit — turn round and take
          // another tunnel. This is what makes swatting a hole meaningful.
          if (hole.blocked > 0) {
            this.enterTunnel(world);
          } else {
            this.state = "peek";
            this.stateT = 0;
            this.x = hole.x;
            this.y = hole.y;
            // Face out of the hole, toward wherever it might run next —
            // arriving still pointed down the tunnel would have it peek out
            // backwards.
            const nxt = world.burrow.holes[this.pickTarget(world)];
            this.a = Math.atan2(nxt.y - hole.y, nxt.x - hole.x);
          }
        }
        break;
      }

      case "peek": {
        const hole = world.burrow.holes[this.at];
        // Rise to about half out — head and shoulders clear of the mouth.
        this.out = damp(this.out, 0.55, 0.12, dt);
        // Position is the *drawn* position, not the hole centre, so that a paw
        // landing on what the cat can see actually counts as a hit.
        const push = emergePush(hole.r, this.out);
        this.x = hole.x + Math.cos(this.a) * push;
        this.y = hole.y + Math.sin(this.a) * push;

        const threat = nearestThreat();
        const hold = this.nerve * world.freezeScale;
        // A paw hovering over the hole sends it straight back down. That's the
        // honest behaviour, and it teaches the cat to wait rather than loom.
        if (threat && threat.d < hole.r * 2.4 * world.fleeRadius) {
          this.state = "dive";
          this.stateT = 0;
        } else if (this.stateT > hold) {
          if (chance(this.bold * world.boldScale)) {
            this.state = "surface";
            this.stateT = 0;
            this.runPause = 0;
            this.targetHole = this.pickTarget(world);
            this.a = Math.atan2(
              world.burrow.holes[this.targetHole].y - this.y,
              world.burrow.holes[this.targetHole].x - this.x,
            );
          } else {
            this.state = "dive";
            this.stateT = 0;
          }
        }
        break;
      }

      case "surface": {
        this.out = damp(this.out, 1, 0.09, dt);
        const target = world.burrow.holes[this.targetHole];
        const threat = nearestThreat();

        // Being swatted at while in the open makes it break for the nearest
        // hole rather than continuing its errand.
        if (threat && threat.d < 150 * world.fleeRadius) {
          this.targetHole = this.nearestHole(world, true);
          this.runPause = 0;
        }

        let tx = target.x;
        let ty = target.y;
        if (this.targetHole !== undefined) {
          const t2 = world.burrow.holes[this.targetHole];
          tx = t2.x;
          ty = t2.y;
        }

        // Scampering: short dashes with abrupt stops. Continuous smooth motion
        // reads as a screensaver; stop-start reads as alive.
        this.runPause -= dt;
        if (this.runPause > 0) {
          // Frozen mid-run, glancing about. Prime pouncing target.
          this.a = angleLerp(this.a, this.a + rand(0.5, -0.5), dt * 2);
        } else {
          const want = Math.atan2(ty - this.y, tx - this.x);
          this.a = angleLerp(this.a, want + rand(0.35, -0.35), 1 - Math.pow(0.02, dt));
          const sp = this.speed * world.speedScale;
          this.x += Math.cos(this.a) * sp * dt;
          this.y += Math.sin(this.a) * sp * dt;
          if (chance(dt * 0.9)) this.runPause = rand(0.55, 0.15) * world.freezeScale;
        }

        if (Math.hypot(tx - this.x, ty - this.y) < world.burrow.holes[this.targetHole].r * 0.7) {
          this.at = this.targetHole;
          this.state = "dive";
          this.stateT = 0;
        }
        // Don't let a surfaced mouse loiter forever in the open.
        if (this.stateT > 7) {
          this.targetHole = this.nearestHole(world, true);
        }
        break;
      }

      case "dive": {
        const hole = world.burrow.holes[this.at];
        this.out = damp(this.out, 0, 0.07, dt);
        const push = emergePush(hole.r, this.out);
        this.x = damp(this.x, hole.x + Math.cos(this.a) * push, 0.08, dt);
        this.y = damp(this.y, hole.y + Math.sin(this.a) * push, 0.08, dt);
        if (this.out < 0.04) {
          this.x = hole.x;
          this.y = hole.y;
          this.enterTunnel(world);
        }
        break;
      }
    }
  }

  private pickTarget(world: MouseWorld) {
    const open = world.burrow.holes
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => i !== this.at && h.blocked <= 0);
    if (!open.length) return this.at;
    return open[randInt(open.length)].i;
  }

  private nearestHole(world: MouseWorld, openOnly: boolean) {
    let best = this.at;
    let bd = Infinity;
    world.burrow.holes.forEach((h, i) => {
      if (openOnly && h.blocked > 0) return;
      const d = Math.hypot(h.x - this.x, h.y - this.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** Radius a paw has to land within. Scales with how exposed it is. */
  get hitRadius() {
    return this.size * (0.85 + this.out * 0.75);
  }

  /** Catchable only when it has actually shown itself. */
  get exposed() {
    return (this.state === "peek" || this.state === "surface" || this.state === "dive") && this.out > 0.18;
  }

  /**
   * Missed, but close enough to matter: it bolts, and moves faster for a few
   * seconds. The cat visibly caused something, which is the compensation a
   * laser pointer never pays out.
   */
  flush(world: MouseWorld) {
    this.flushed = rand(3.5, 2);
    if (this.state === "peek" || this.state === "surface") {
      this.at = this.state === "peek" ? this.at : this.nearestHole(world, true);
      this.state = "dive";
      this.stateT = 0;
    }
  }

  /**
   * Terminal capture. The hunt has to be winnable and it has to resolve —
   * that's the whole reason this project exists rather than using a laser.
   */
  pin() {
    if (this.caught) return false;
    this.caught = true;
    this.state = "caught";
    this.revealT = 0;
    this.out = 1;
    return true;
  }

  get struggle() {
    return this.revealT < 0.5 ? 1 : clamp(1 - (this.revealT - 0.5) / 1.2, 0, 1);
  }

  get fade() {
    return clamp(1 - (this.revealT - 2.4) / 0.7, 0, 1);
  }
}

/**
 * Top-down mouse. Drawn from primitives so its proportions come from its
 * genes — there is no sprite to memorise.
 *
 * `reveal` scales the legs/tail thrashing after a capture.
 */
export function drawMouse(
  g: CanvasRenderingContext2D,
  m: Mouse,
  t: number,
  alpha = 1,
) {
  const s = m.size;
  const L = s * 2.0 * m.plump;
  const W = s * 1.18 * m.plump;
  const fur = `hsl(${m.hue} ${m.sat}% ${m.light}%)`;
  const dark = `hsl(${m.hue} ${m.sat}% ${m.light * 0.5}%)`;

  // How much of it is above ground. A peeking mouse is clipped to its hole.
  const show = clamp(m.out, 0, 1);
  const moving = m.state === "surface" && m.runPause <= 0;
  const kick = m.state === "caught" ? m.struggle : 0;

  g.save();
  g.globalAlpha = alpha;
  g.translate(m.x, m.y);
  g.rotate(m.a);

  // Contact shadow, only once it's actually out on the surface.
  if (show > 0.6) {
    g.globalAlpha = alpha * (show - 0.6) * 1.4;
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.beginPath();
    g.ellipse(-L * 0.05, W * 0.16, L * 0.6, W * 0.62, 0, 0, TAU);
    g.fill();
    g.globalAlpha = alpha;
  }

  // Tail: a trailing curve that whips when running and thrashes when pinned.
  // It carries a permanent resting S-bend — a tail that only bends when the
  // animal moves reads as a wire stuck to its back.
  const tl = L * 0.95 * m.tailLen;
  const whip = (moving ? 0.5 : 0.16) + kick * 1.1;
  const rest = Math.sin(m.hue) * 0.35;
  const b1 = rest + Math.sin(t * (moving ? 11 : 3) + m.hue) * whip * 0.55;
  const b2 = -rest * 1.4 + Math.sin(t * (moving ? 9 : 2.4) + m.hue + 1.4) * whip * 0.8;
  g.strokeStyle = dark;
  g.lineCap = "round";
  g.lineWidth = Math.max(1.6, s * 0.13);
  g.beginPath();
  g.moveTo(-L * 0.5, 0);
  g.bezierCurveTo(
    -L * 0.5 - tl * 0.35,
    b1 * tl * 0.45,
    -L * 0.5 - tl * 0.72,
    b2 * tl * 0.5,
    -L * 0.5 - tl,
    (b1 + b2) * tl * 0.32,
  );
  g.stroke();

  // Legs, in opposed pairs. Lighter than the tail so they stay readable
  // against very dark earth.
  g.lineWidth = Math.max(1.4, s * 0.12);
  g.strokeStyle = `hsl(${m.hue} ${m.sat}% ${m.light * 0.66}%)`;
  for (const side of [-1, 1]) {
    for (const [i, ox] of [L * 0.26, -L * 0.24].entries()) {
      const ph = t * (moving ? 15 : 4) + (i + (side > 0 ? 1 : 0)) * Math.PI;
      const sw = (moving ? 0.45 : 0.1) + kick * 0.9;
      const ex = ox + Math.cos(ph) * s * 0.42 * sw;
      const ey = side * (W * 0.62 + Math.abs(Math.sin(ph)) * s * 0.3 * sw);
      g.beginPath();
      g.moveTo(ox, side * W * 0.34);
      g.lineTo(ex, ey);
      g.stroke();
    }
  }

  // Body.
  const bg = g.createLinearGradient(0, -W, 0, W);
  bg.addColorStop(0, `hsl(${m.hue} ${m.sat}% ${Math.min(92, m.light + 16)}%)`);
  bg.addColorStop(1, dark);
  g.fillStyle = bg;
  g.beginPath();
  g.ellipse(-L * 0.06, 0, L * 0.52, W * 0.62, 0, 0, TAU);
  g.fill();

  // Head.
  const hx = L * 0.44;
  g.fillStyle = fur;
  g.beginPath();
  g.ellipse(hx, 0, L * 0.24, W * 0.42, 0, 0, TAU);
  g.fill();

  // Ears, set well back on the skull and slightly behind the head's widest
  // point. Placed forward, a pair of discs on a face reads unmistakably as
  // goggles rather than as ears.
  const er = W * 0.27 * m.earScale;
  const ex = hx - L * 0.26;
  for (const side of [-1, 1]) {
    g.fillStyle = dark;
    g.beginPath();
    g.arc(ex, side * (W * 0.36 + er * 0.4), er, 0, TAU);
    g.fill();
    g.fillStyle = `hsl(${m.hue} ${m.sat + 10}% ${m.light * 0.78}%)`;
    g.beginPath();
    g.arc(ex + er * 0.1, side * (W * 0.36 + er * 0.45), er * 0.5, 0, TAU);
    g.fill();
  }

  // Snout and eye.
  g.fillStyle = `hsl(${m.hue} ${m.sat + 20}% ${Math.min(88, m.light + 22)}%)`;
  g.beginPath();
  g.arc(hx + L * 0.2, 0, s * 0.11, 0, TAU);
  g.fill();

  g.fillStyle = "rgba(8,10,14,0.9)";
  if (m.state === "caught" && m.struggle < 0.25) {
    // Limp. Closed eye, so the kill actually reads as a kill.
    g.strokeStyle = "rgba(8,10,14,0.9)";
    g.lineWidth = Math.max(1.2, s * 0.09);
    g.beginPath();
    g.moveTo(hx + L * 0.02, -W * 0.16);
    g.lineTo(hx + L * 0.14, -W * 0.16);
    g.stroke();
  } else {
    g.beginPath();
    g.arc(hx + L * 0.08, -W * 0.17, s * 0.1, 0, TAU);
    g.fill();
  }

  // Whiskers.
  g.strokeStyle = `hsla(${m.hue} 30% 92% / 0.4)`;
  g.lineWidth = 1;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      g.beginPath();
      g.moveTo(hx + L * 0.18, side * W * 0.08);
      g.lineTo(hx + L * 0.42, side * (W * 0.3 + i * W * 0.22));
      g.stroke();
    }
  }

  g.restore();
}
