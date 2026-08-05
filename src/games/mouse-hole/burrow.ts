import { rand, randInt, pick, clamp, TAU } from "@/lib/rng";

/**
 * A procedurally generated burrow: holes on the surface joined by curved
 * tunnels running underneath.
 *
 * The tunnels are the whole design. Whack-a-mole gives a cat nothing to do
 * between pop-ups, so it plays as a series of unconnected surprises. Here the
 * mouse is faintly visible travelling underground, which means a cat can
 * *track* it, work out which hole it's heading for, and be sitting over that
 * hole when it surfaces. That's stalking, not reacting — and it's the part of
 * the predatory sequence that a watcher like a calico actually wants.
 */

export interface Hole {
  x: number;
  y: number;
  r: number;
  /** Slight per-hole irregularity so they don't read as drilled circles. */
  squash: number;
  rot: number;
  /** Seconds of collapse remaining. A swatted hole is unusable for a while. */
  blocked: number;
  edges: number[];
}

export interface Tunnel {
  a: number;
  b: number;
  /** Sampled centreline, world space. */
  pts: { x: number; y: number }[];
  /** Cumulative arc length at each sample. */
  cum: number[];
  len: number;
}

export interface Ground {
  name: string;
  /** Earth colour. Kept very dark: cats resolve high contrast on dark best. */
  base: string;
  grain: string;
  /** Tunnel fill — barely lighter than the earth, on purpose. */
  tunnel: string;
  rim: string;
}

export const GROUNDS: Ground[] = [
  {
    name: "Loam",
    base: "#0c0a08",
    grain: "rgba(122,98,68,0.16)",
    tunnel: "rgba(126,104,74,0.20)",
    rim: "rgba(158,132,94,0.55)",
  },
  {
    name: "Moss Floor",
    base: "#080d09",
    grain: "rgba(96,128,86,0.16)",
    tunnel: "rgba(96,132,88,0.20)",
    rim: "rgba(126,164,112,0.5)",
  },
  {
    name: "Cold Clay",
    base: "#080a0e",
    grain: "rgba(92,110,138,0.15)",
    tunnel: "rgba(94,116,146,0.20)",
    rim: "rgba(126,150,184,0.5)",
  },
  {
    name: "Ash",
    base: "#0a0a0b",
    grain: "rgba(126,126,130,0.14)",
    tunnel: "rgba(120,122,128,0.20)",
    rim: "rgba(154,156,162,0.5)",
  },
];

export const pickGround = () => pick(GROUNDS);

export interface Burrow {
  holes: Hole[];
  tunnels: Tunnel[];
}

/** Point on a quadratic bezier. */
function qbez(
  p0: { x: number; y: number },
  c: { x: number; y: number },
  p1: { x: number; y: number },
  t: number,
) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

/**
 * Jittered-grid placement. Pure random scatter clumps badly, and two holes
 * on top of each other makes the "which exit is it heading for?" read
 * impossible — which is the one thing this game has to get right.
 */
function placeHoles(w: number, h: number, count: number): Hole[] {
  const cols = Math.ceil(Math.sqrt(count * (w / h)));
  const rows = Math.ceil(count / cols);
  const cells: { cx: number; cy: number }[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) cells.push({ cx: i, cy: j });
  cells.sort(() => Math.random() - 0.5);

  const cw = w / cols;
  const ch = h / rows;
  const margin = Math.min(w, h) * 0.09;
  return cells.slice(0, count).map(({ cx, cy }) => {
    // Holes are kept a little smaller than the mouse is long, so a peeking
    // animal is genuinely legible sticking out of one rather than being
    // swallowed by the mouth.
    const r = rand(33, 24);
    return {
      x: clamp(cx * cw + rand(cw - r, r), margin, w - margin),
      y: clamp(cy * ch + rand(ch - r, r), margin, h - margin),
      r,
      squash: rand(1.25, 0.8),
      rot: rand(TAU),
      blocked: 0,
      edges: [],
    };
  });
}

export function makeBurrow(w: number, h: number, count: number): Burrow {
  const holes = placeHoles(w, h, clamp(count, 4, 9));
  const tunnels: Tunnel[] = [];
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const made = new Set<string>();

  const connect = (a: number, b: number) => {
    if (a === b || made.has(key(a, b))) return;
    made.add(key(a, b));
    const p0 = holes[a];
    const p1 = holes[b];
    // Bow the tunnel sideways so the network reads as dug, not as a diagram.
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const d = Math.hypot(dx, dy) || 1;
    const bow = rand(0.3, -0.3) * d;
    const c = { x: mx - (dy / d) * bow, y: my + (dx / d) * bow };

    const steps = Math.max(12, Math.round(d / 14));
    const pts: { x: number; y: number }[] = [];
    const cum: number[] = [0];
    for (let i = 0; i <= steps; i++) {
      const p = qbez(p0, c, p1, i / steps);
      pts.push(p);
      if (i > 0) {
        const q = pts[i - 1];
        cum.push(cum[i - 1] + Math.hypot(p.x - q.x, p.y - q.y));
      }
    }
    const idx = tunnels.length;
    tunnels.push({ a, b, pts, cum, len: cum[cum.length - 1] });
    holes[a].edges.push(idx);
    holes[b].edges.push(idx);
  };

  // Connect along a greedy nearest-neighbour tour. This guarantees every hole
  // is reachable (a dead-end hole is one the cat learns to ignore) while
  // keeping the tunnels short and local — joining holes in arbitrary order
  // produces long edges criss-crossing the whole board, which looks like a
  // constellation diagram and destroys any sense of a dug burrow.
  const order: number[] = [0];
  const left = new Set(holes.map((_, i) => i));
  left.delete(0);
  while (left.size) {
    const cur = holes[order[order.length - 1]];
    let best = -1;
    let bd = Infinity;
    for (const i of left) {
      const d = Math.hypot(holes[i].x - cur.x, holes[i].y - cur.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    order.push(best);
    left.delete(best);
  }
  for (let i = 0; i < order.length; i++)
    connect(order[i], order[(i + 1) % order.length]);

  // Then a couple of short chords for genuine choice at each junction.
  const extra = randInt(3, 1);
  for (let n = 0; n < extra; n++) {
    const a = randInt(holes.length);
    let best = -1;
    let bd = Infinity;
    for (let b = 0; b < holes.length; b++) {
      if (b === a || made.has(key(a, b))) continue;
      const d = Math.hypot(holes[b].x - holes[a].x, holes[b].y - holes[a].y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best >= 0) connect(a, best);
  }

  return { holes, tunnels };
}

/** Position and heading at an arc-length distance along a tunnel. */
export function alongTunnel(t: Tunnel, dist: number) {
  const d = clamp(dist, 0, t.len);
  let i = 1;
  while (i < t.cum.length - 1 && t.cum[i] < d) i++;
  const seg = t.cum[i] - t.cum[i - 1] || 1;
  const f = (d - t.cum[i - 1]) / seg;
  const p = t.pts[i - 1];
  const q = t.pts[i];
  return {
    x: p.x + (q.x - p.x) * f,
    y: p.y + (q.y - p.y) * f,
    a: Math.atan2(q.y - p.y, q.x - p.x),
  };
}

/**
 * Bake the earth and the static tunnel traces. The tunnels are drawn very
 * faint: they should be legible as structure without competing with the
 * moving disturbance, which is the thing the cat is meant to lock onto.
 */
export function makeGround(
  w: number,
  h: number,
  dpr: number,
  ground: Ground,
  burrow: Burrow,
) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.floor(w * dpr));
  c.height = Math.max(1, Math.floor(h * dpr));
  const g = c.getContext("2d");
  if (!g) return c;
  g.scale(dpr, dpr);

  g.fillStyle = ground.base;
  g.fillRect(0, 0, w, h);

  // Soil grain.
  g.fillStyle = ground.grain;
  const grains = Math.round((w * h) / 900);
  for (let i = 0; i < grains; i++) {
    const r = rand(1.5, 0.3);
    g.globalAlpha = rand(0.55, 0.12);
    g.beginPath();
    g.arc(rand(w), rand(h), r, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;

  // Tunnels, as soft excavated channels.
  for (const t of burrow.tunnels) {
    g.strokeStyle = ground.tunnel;
    g.lineCap = "round";
    g.lineJoin = "round";
    // Very faint. The tunnels are there to be *followed*, not looked at — if
    // the network is as loud as the animal moving through it, the cat has
    // nothing to lock onto.
    for (const [width, alpha] of [
      [26, 0.14],
      [12, 0.2],
    ] as const) {
      g.globalAlpha = alpha;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(t.pts[0].x, t.pts[0].y);
      for (const p of t.pts) g.lineTo(p.x, p.y);
      g.stroke();
    }
  }
  g.globalAlpha = 1;

  // Vignette, so the eye is pulled to the middle of the board.
  const vg = g.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.3,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.72,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.6)");
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  return c;
}

/** A hole: dark mouth, lit soil rim on the upper-left to read as a pit. */
export function drawHole(
  g: CanvasRenderingContext2D,
  hole: Hole,
  ground: Ground,
) {
  g.save();
  g.translate(hole.x, hole.y);
  g.rotate(hole.rot);
  g.scale(1, hole.squash);

  const r = hole.r;
  // Spoil heap around the mouth.
  const rim = g.createRadialGradient(0, 0, r * 0.75, 0, 0, r * 1.42);
  rim.addColorStop(0, ground.rim);
  rim.addColorStop(1, "rgba(0,0,0,0)");
  g.globalAlpha = 0.5;
  g.fillStyle = rim;
  g.beginPath();
  g.arc(0, 0, r * 1.42, 0, TAU);
  g.fill();
  g.globalAlpha = 1;

  // The mouth itself. Offset the dark centre down-right so the lit lip sits
  // upper-left, matching the light direction used everywhere else.
  const mouth = g.createRadialGradient(r * 0.18, r * 0.2, 0, 0, 0, r);
  mouth.addColorStop(0, "#000");
  mouth.addColorStop(0.72, "#000");
  mouth.addColorStop(1, "rgba(0,0,0,0.25)");
  g.fillStyle = mouth;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();

  g.strokeStyle = ground.rim;
  g.globalAlpha = 0.65;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, r * 0.98, Math.PI * 0.85, Math.PI * 1.95);
  g.stroke();
  g.globalAlpha = 1;

  // A collapsed hole is visibly filled in, so the cat can see it did that.
  if (hole.blocked > 0) {
    const f = clamp(hole.blocked / 0.4, 0, 1);
    g.globalAlpha = 0.9 * f;
    g.fillStyle = ground.grain;
    g.beginPath();
    g.arc(0, 0, r * 0.92, 0, TAU);
    g.fill();
    g.fillStyle = ground.rim;
    g.globalAlpha = 0.5 * f;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + hole.rot;
      const d = r * rand(0.6, 0.1);
      g.beginPath();
      g.arc(Math.cos(a) * d, Math.sin(a) * d, r * rand(0.22, 0.09), 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  g.restore();
}
