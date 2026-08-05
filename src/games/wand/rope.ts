import { clamp } from "@/lib/rng";

/**
 * A Verlet-integrated string.
 *
 * This is the point of the game. Cats respond to string because it moves
 * like nothing else: it lags, it whips, it goes slack, it drags along behind
 * a change of direction. Scripted or tweened motion never produces that, and
 * a cat can tell. So the string is actually simulated, the toy on the end is
 * just the last point of it, and the paw pushes the real points around.
 */

export interface Point {
  x: number;
  y: number;
  /** Previous position — Verlet stores velocity implicitly as the delta. */
  px: number;
  py: number;
}

const SUBSTEP = 1 / 180;

export class Rope {
  pts: Point[] = [];
  /** Rest length between points. */
  seg: number;
  private acc = 0;

  constructor(count: number, seg: number, x: number, y: number) {
    this.seg = seg;
    for (let i = 0; i < count; i++) {
      this.pts.push({ x: x + i * seg, y, px: x + i * seg, py: y });
    }
  }

  get tip() {
    return this.pts[this.pts.length - 1];
  }

  /** Velocity of the free end, px/s — used for audio and whip detection. */
  tipSpeed(dt: number) {
    const t = this.tip;
    return Math.hypot(t.x - t.px, t.y - t.py) / Math.max(dt, 1e-4);
  }

  /**
   * Shove points away from a paw. Contact is applied to the positions only:
   * Verlet turns the displacement into momentum on its own, which is what
   * makes a swat send a visible wave down the string.
   */
  push(x: number, y: number, r: number, strength = 1) {
    let touched = false;
    for (const p of this.pts) {
      const dx = p.x - x;
      const dy = p.y - y;
      const d = Math.hypot(dx, dy);
      if (d > r || d < 1e-4) continue;
      const f = (1 - d / r) * strength;
      p.x += (dx / d) * f * (r - d);
      p.y += (dy / d) * f * (r - d);
      touched = true;
    }
    return touched;
  }

  step(
    dt: number,
    anchor: { x: number; y: number },
    goal: { x: number; y: number },
    speed: number,
    w: number,
    h: number,
  ) {
    this.acc += Math.min(dt, 0.05);
    while (this.acc >= SUBSTEP) {
      this.acc -= SUBSTEP;
      this.integrate(SUBSTEP, anchor, goal, speed, w, h);
    }
  }

  private integrate(
    dt: number,
    anchor: { x: number; y: number },
    goal: { x: number; y: number },
    speed: number,
    w: number,
    h: number,
  ) {
    // Steer the toy end toward where it's meant to be going. Without this the
    // rope is only a chain being dragged: with no gravity there's nothing to
    // pull the far end anywhere, so the toy just crumples and trails off the
    // board. The chain still does the interesting work — it goes taut, it
    // whips, it lags — but something has to be driving the toy.
    {
      const t = this.tip;
      const vx = t.x - t.px;
      const vy = t.y - t.py;
      const dx = goal.x - t.x;
      const dy = goal.y - t.y;
      const d = Math.hypot(dx, dy);
      // Ease off on arrival so it settles instead of buzzing around the goal.
      const want = Math.min(1, d / 40) * speed * dt;
      const tvx = d > 1e-3 ? (dx / d) * want : 0;
      const tvy = d > 1e-3 ? (dy / d) * want : 0;
      const k = 0.16;
      t.px = t.x - (vx + (tvx - vx) * k);
      t.py = t.y - (vy + (tvy - vy) * k);
    }

    // Drag. Without it the string never settles and the toy jitters forever,
    // which is visually noisy rather than alive.
    const damp = 0.995;
    for (const p of this.pts) {
      const vx = (p.x - p.px) * damp;
      const vy = (p.y - p.py) * damp;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy;
    }

    // The handle end is held by whoever is off-screen swinging it.
    this.pts[0].x = anchor.x;
    this.pts[0].y = anchor.y;

    for (let k = 0; k < 8; k++) this.constrain();

    // The toy may leave the board — being dragged out of sight is the whole
    // point of the hide phase — but not so far that it can't get back.
    const t = this.tip;
    t.x = clamp(t.x, -w * 0.25, w * 1.25);
    t.y = clamp(t.y, -h * 0.25, h * 1.25);
  }

  private constrain() {
    const { pts, seg } = this;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-4;
      const diff = (d - seg) / d;
      const ax = dx * 0.5 * diff;
      const ay = dy * 0.5 * diff;
      // Point 0 is pinned to the hand, so the first segment corrects entirely
      // from the far side.
      if (i === 0) {
        b.x -= ax * 2;
        b.y -= ay * 2;
      } else {
        a.x += ax;
        a.y += ay;
        b.x -= ax;
        b.y -= ay;
      }
    }
  }
}
