import type { PawEvent } from "./types";
import { rand, clamp, TAU } from "./rng";

/**
 * Shared paw-disturbance layer.
 *
 * Mason went for Under the Sheet and merely watched the rest, and the clearest
 * difference is that the sheet reacts *physically to every touch* — a miss
 * still deforms a large area and sends ripples. Everywhere else a miss
 * produced a small ring and nothing else, so a strike that didn't connect had
 * no visible consequence at all. For a cat that's the difference between
 * acting on the world and batting at a picture.
 *
 * So: every contact, hit or miss, press or drag, throws out a large
 * disturbance scaled to the paw. Each game supplies its own palette so the
 * same physics reads as dust, water, grass or soil.
 */

export interface Wave {
  x: number;
  y: number;
  /** Starting radius — the paw's own footprint. */
  r0: number;
  t: number;
  life: number;
  strength: number;
}

export interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  t: number;
  life: number;
  hue: number;
}

export interface PawStyle {
  /** Ring colour, as "r,g,b". */
  ring: string;
  /** Filled bloom under the contact point, as "r,g,b". */
  bloom: string;
  /** Debris hue range. */
  hue: [number, number];
  /** Scales how far the disturbance spreads. Water carries; soil doesn't. */
  spread?: number;
  /** Debris thrown per strike. */
  grit?: number;
}

/** How far a paw has to travel before a drag sheds another wave. */
const TRAIL_STEP = 26;

export class PawField {
  private pointers = new Map<number, { x: number; y: number; r: number }>();
  private trail = new Map<number, { x: number; y: number }>();
  waves: Wave[] = [];
  debris: Debris[] = [];
  /** Contacts, for prey to flee from. Replaces the per-game bookkeeping. */
  threats: { x: number; y: number; r: number }[] = [];

  private style: PawStyle;

  constructor(style: PawStyle) {
    this.style = style;
  }

  /**
   * Feed every paw event through here. Returns the contact radius so callers
   * can use the same reach for their own hit tests.
   */
  paw(e: PawEvent) {
    // A real paw pad covers a lot of glass; be generous, because a cat cannot
    // aim at pixels.
    const reach = Math.max(e.r, 30) + 8;

    if (e.phase === "up") {
      this.pointers.delete(e.id);
      this.trail.delete(e.id);
    } else {
      this.pointers.set(e.id, { x: e.x, y: e.y, r: reach });
    }
    this.threats = [...this.pointers.values()];

    if (e.phase === "down") {
      this.strike(e.x, e.y, reach, 0.75 + e.force * 0.6);
      this.trail.set(e.id, { x: e.x, y: e.y });
    } else if (e.phase === "move") {
      // A drag keeps disturbing the surface. This is most of what makes a
      // resting or sweeping paw feel like it's touching something.
      const last = this.trail.get(e.id);
      const speed = Math.hypot(e.vx, e.vy);
      if (!last || Math.hypot(e.x - last.x, e.y - last.y) > TRAIL_STEP) {
        this.trail.set(e.id, { x: e.x, y: e.y });
        this.strike(e.x, e.y, reach * 0.8, clamp(speed / 900, 0.16, 0.6), 0.35);
      }
    }
    return reach;
  }

  /** Throw a disturbance manually — a body hitting the ground, say. */
  strike(x: number, y: number, r: number, strength: number, gritScale = 1) {
    const spread = this.style.spread ?? 1;
    this.waves.push({
      x,
      y,
      r0: r,
      t: 0,
      // Long enough to still be spreading when the cat looks up from its own
      // paw — a disturbance that's gone in half a second is one it never sees.
      life: rand(1.5, 1.0) * spread,
      strength,
    });
    const n = Math.round((this.style.grit ?? 10) * strength * gritScale);
    for (let i = 0; i < n; i++) {
      const a = rand(TAU);
      const sp = rand(300, 70) * strength;
      this.debris.push({
        x: x + Math.cos(a) * r * 0.4,
        y: y + Math.sin(a) * r * 0.4,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: rand(3.4, 0.9),
        t: 0,
        life: rand(0.75, 0.28),
        hue: rand(this.style.hue[1], this.style.hue[0]),
      });
    }
  }

  update(dt: number) {
    for (const w of this.waves) w.t += dt;
    this.waves = this.waves.filter((w) => w.t < w.life);
    // Cap: a cat that hammers the glass shouldn't be able to tank the frame
    // rate, and past a point more rings don't read as more anyway.
    if (this.waves.length > 26) this.waves.splice(0, this.waves.length - 26);

    for (const d of this.debris) {
      d.t += dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= Math.pow(0.02, dt);
      d.vy *= Math.pow(0.02, dt);
    }
    this.debris = this.debris.filter((d) => d.t < d.life);
  }

  /**
   * 0..1 disturbance at a point, concentrated in the moving wavefront. Games
   * use this to shove their own contents around — bending grass, tilting
   * prey — so the disturbance isn't just an overlay.
   */
  intensityAt(x: number, y: number) {
    let v = 0;
    for (const w of this.waves) {
      const f = w.t / w.life;
      const rad = w.r0 * (1 + f * 5.5);
      const d = Math.abs(Math.hypot(x - w.x, y - w.y) - rad);
      const band = w.r0 * 0.9;
      if (d < band) v += (1 - d / band) * (1 - f) * w.strength;
    }
    return clamp(v, 0, 1);
  }

  /** Direction to push something at a point, away from the nearest wave centre. */
  pushAt(x: number, y: number) {
    let bx = 0;
    let by = 0;
    for (const w of this.waves) {
      const f = w.t / w.life;
      const rad = w.r0 * (1 + f * 5.5);
      const dx = x - w.x;
      const dy = y - w.y;
      const dist = Math.hypot(dx, dy) || 1e-4;
      const d = Math.abs(dist - rad);
      const band = w.r0 * 0.9;
      if (d < band) {
        const s = (1 - d / band) * (1 - f) * w.strength;
        bx += (dx / dist) * s;
        by += (dy / dist) * s;
      }
    }
    return { x: bx, y: by };
  }

  render(g: CanvasRenderingContext2D) {
    const { ring, bloom } = this.style;

    // Soft pressure bloom under every resting contact, so a paw that is simply
    // sitting on the glass is still visibly touching something.
    for (const p of this.pointers.values()) {
      const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.2);
      grad.addColorStop(0, `rgba(${bloom},0.22)`);
      grad.addColorStop(1, `rgba(${bloom},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.x, p.y, p.r * 2.2, 0, TAU);
      g.fill();
    }

    for (const w of this.waves) {
      const f = w.t / w.life;
      const rad = w.r0 * (1 + f * 5.5);
      const a = (1 - f) * (1 - f) * w.strength;
      g.strokeStyle = `rgba(${ring},${a * 0.6})`;
      g.lineWidth = w.r0 * 0.22 * (1 - f) + 1;
      g.beginPath();
      g.arc(w.x, w.y, rad, 0, TAU);
      g.stroke();
      // Trailing inner ring gives the front some body rather than a hoop.
      g.strokeStyle = `rgba(${ring},${a * 0.26})`;
      g.lineWidth = w.r0 * 0.12 * (1 - f) + 1;
      g.beginPath();
      g.arc(w.x, w.y, rad * 0.68, 0, TAU);
      g.stroke();
    }

    for (const d of this.debris) {
      const a = 1 - d.t / d.life;
      g.globalAlpha = a * 0.9;
      g.fillStyle = `hsl(${d.hue} 55% ${45 + a * 30}%)`;
      g.beginPath();
      g.arc(d.x, d.y, d.r * a, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}
