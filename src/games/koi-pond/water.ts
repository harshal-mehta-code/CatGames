import { rand, randInt, pick, TAU } from "@/lib/rng";

/**
 * The pond itself: bed, caustics, ripples and lily pads.
 *
 * The caustics are the thing that sells it as water rather than a coloured
 * background, and they're cheap — one procedurally drawn tile scrolled at two
 * different scales and blended additively. Real per-pixel water would cost far
 * more than it's worth on an iPad that also has to run a school of fish.
 */

export interface Pond {
  name: string;
  /** Deep water. Kept dark so the fish are the brightest thing on screen. */
  deep: string;
  shallow: string;
  bed: string;
  /** Caustic light colour. */
  light: string;
}

export const PONDS: Pond[] = [
  {
    name: "Green Pool",
    deep: "#04120f",
    shallow: "#0c2a24",
    bed: "rgba(120,150,110,0.10)",
    light: "rgba(180,255,225,0.5)",
  },
  {
    name: "Blue Deep",
    deep: "#04101c",
    shallow: "#0a2338",
    bed: "rgba(110,140,180,0.10)",
    light: "rgba(190,230,255,0.5)",
  },
  {
    name: "Tea Water",
    deep: "#12100a",
    shallow: "#2a2312",
    bed: "rgba(170,140,90,0.10)",
    light: "rgba(255,235,180,0.45)",
  },
];

export const pickPond = () => pick(PONDS);

export interface Pad {
  x: number;
  y: number;
  r: number;
  rot: number;
  /** Where the classic lily-pad notch points. */
  notch: number;
  lobes: number[];
  bloom: boolean;
  bloomHue: number;
}

export function makePads(w: number, h: number): Pad[] {
  const n = randInt(6, 3);
  const pads: Pad[] = [];
  for (let i = 0; i < n; i++) {
    const r = rand(Math.min(w, h) * 0.15, 52);
    let x = 0;
    let y = 0;
    // A few tries to avoid stacking pads on top of each other; overlapping
    // cover just makes one big dead zone the fish can hide under forever.
    for (let k = 0; k < 12; k++) {
      x = rand(w - r * 1.1, r * 1.1);
      y = rand(h - r * 1.1, r * 1.1);
      if (pads.every((p) => Math.hypot(p.x - x, p.y - y) > (p.r + r) * 0.85))
        break;
    }
    pads.push({
      x,
      y,
      r,
      rot: rand(TAU),
      notch: rand(TAU),
      lobes: Array.from({ length: randInt(9, 6) }, () => rand(1.08, 0.9)),
      bloom: Math.random() < 0.35,
      bloomHue: rand(58, 34),
    });
  }
  return pads;
}

/** Pond bed: dark water with a depth gradient and scattered grit. */
export function makeBed(w: number, h: number, dpr: number, p: Pond) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.floor(w * dpr));
  c.height = Math.max(1, Math.floor(h * dpr));
  const g = c.getContext("2d");
  if (!g) return c;
  g.scale(dpr, dpr);

  // Shallower at the edges, deep in the middle — reads as a basin.
  const grad = g.createRadialGradient(
    w / 2,
    h / 2,
    0,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.72,
  );
  grad.addColorStop(0, p.deep);
  grad.addColorStop(1, p.shallow);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  g.fillStyle = p.bed;
  for (let i = 0; i < Math.round((w * h) / 1400); i++) {
    g.globalAlpha = rand(0.5, 0.08);
    g.beginPath();
    g.ellipse(rand(w), rand(h), rand(7, 1.5), rand(5, 1.2), rand(TAU), 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;

  const vg = g.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.3,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.5)");
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  return c;
}

/**
 * One tile of caustic veins. Drawn with a heavy shadow blur so the light has
 * soft edges; tiling two scrolling copies of this is what produces the moving
 * net of light on the bed.
 */
export function makeCausticTile(p: Pond) {
  const S = 220;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d");
  if (!g) return c;
  g.strokeStyle = p.light;
  g.shadowColor = p.light;
  // Heavy blur and few, fat, faint strokes. Thin bright lines read as
  // scratches on the screen rather than light on the bed.
  g.shadowBlur = 18;
  g.lineCap = "round";
  for (let i = 0; i < 22; i++) {
    const x = rand(S);
    const y = rand(S);
    g.globalAlpha = rand(0.22, 0.06);
    g.lineWidth = rand(9, 3);
    g.beginPath();
    g.moveTo(x, y);
    // Wrapped by the pattern repeat, so the exact shapes don't matter much —
    // what matters is that the network is irregular and has no visible grid.
    g.quadraticCurveTo(
      x + rand(70, -70),
      y + rand(70, -70),
      x + rand(110, -110),
      y + rand(110, -110),
    );
    g.stroke();
  }
  return c;
}

export interface Ripple {
  x: number;
  y: number;
  r: number;
  t: number;
  life: number;
  strength: number;
}

export function drawRipple(g: CanvasRenderingContext2D, r: Ripple) {
  const f = r.t / r.life;
  const rad = r.r + f * r.r * 5.5;
  const a = (1 - f) * (1 - f) * r.strength;
  g.strokeStyle = `rgba(225,245,255,${a * 0.55})`;
  g.lineWidth = 2.5 * (1 - f) + 0.6;
  g.beginPath();
  g.arc(r.x, r.y, rad, 0, TAU);
  g.stroke();
  // A second, slower ring gives the spreading a bit of body.
  g.strokeStyle = `rgba(200,235,255,${a * 0.28})`;
  g.lineWidth = 1.4;
  g.beginPath();
  g.arc(r.x, r.y, rad * 0.62, 0, TAU);
  g.stroke();
}

export function drawPad(g: CanvasRenderingContext2D, p: Pad, t: number) {
  // Pads drift very slightly, which keeps the pond from looking frozen.
  const bob = Math.sin(t * 0.5 + p.notch) * 3;
  g.save();
  g.translate(p.x + bob, p.y + Math.cos(t * 0.42 + p.notch) * 2.5);
  g.rotate(p.rot + Math.sin(t * 0.3 + p.notch) * 0.04);

  const path = (scale: number) => {
    g.beginPath();
    const n = p.lobes.length;
    // A narrow cleft, and crucially it stops short of the middle and curves
    // in. Straight edges running to dead centre turn the pad into a pie chart.
    const gap = 0.26;
    const start = p.notch + gap / 2;
    const end = p.notch + TAU - gap / 2;
    const inner = p.r * scale * 0.16;
    const ix = Math.cos(p.notch) * inner;
    const iy = Math.sin(p.notch) * inner;
    g.moveTo(ix, iy);
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const ang = start + (end - start) * f;
      const rr = p.r * scale * p.lobes[i % n];
      const x = Math.cos(ang) * rr;
      const y = Math.sin(ang) * rr;
      if (i === 0) {
        g.quadraticCurveTo(
          Math.cos(start) * rr * 0.55,
          Math.sin(start) * rr * 0.55,
          x,
          y,
        );
      } else {
        const mid = ang - (end - start) / (2 * n);
        g.quadraticCurveTo(Math.cos(mid) * rr * 1.07, Math.sin(mid) * rr * 1.07, x, y);
      }
    }
    const lastR = p.r * scale * p.lobes[0];
    g.quadraticCurveTo(
      Math.cos(end) * lastR * 0.55,
      Math.sin(end) * lastR * 0.55,
      ix,
      iy,
    );
    g.closePath();
  };

  // Shadow cast down into the water.
  g.globalAlpha = 0.45;
  g.fillStyle = "rgba(0,0,0,0.85)";
  g.save();
  g.translate(7, 10);
  path(1);
  g.fill();
  g.restore();
  g.globalAlpha = 1;

  // Muted and dark. A bright saturated green pulls the eye away from the
  // fish, which are the only thing on screen the cat is supposed to track.
  const grad = g.createLinearGradient(-p.r, -p.r, p.r, p.r);
  grad.addColorStop(0, "hsl(122 22% 19%)");
  grad.addColorStop(1, "hsl(126 24% 10%)");
  g.fillStyle = grad;
  path(1);
  g.fill();

  // Veins radiate from the cleft, not the geometric centre, and stop short of
  // the rim.
  const cx = Math.cos(p.notch) * p.r * 0.14;
  const cy = Math.sin(p.notch) * p.r * 0.14;
  g.strokeStyle = "hsla(115 35% 52% / 0.16)";
  g.lineWidth = 1.1;
  const n = p.lobes.length;
  for (let i = 0; i < n; i++) {
    const ang = p.notch + 0.55 + ((TAU - 1.1) * i) / (n - 1);
    g.beginPath();
    g.moveTo(cx, cy);
    g.quadraticCurveTo(
      Math.cos(ang) * p.r * 0.45,
      Math.sin(ang) * p.r * 0.45,
      Math.cos(ang) * p.r * 0.84 * p.lobes[i],
      Math.sin(ang) * p.r * 0.84 * p.lobes[i],
    );
    g.stroke();
  }

  // Wet rim catching the light.
  g.strokeStyle = "hsla(110 40% 60% / 0.18)";
  g.lineWidth = 1.6;
  path(0.99);
  g.stroke();

  if (p.bloom) {
    const bx = p.r * 0.32;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * TAU;
      g.fillStyle = `hsl(${p.bloomHue} 70% ${68 - i * 1.5}%)`;
      g.beginPath();
      g.ellipse(
        bx + Math.cos(ang) * p.r * 0.1,
        Math.sin(ang) * p.r * 0.1,
        p.r * 0.17,
        p.r * 0.075,
        ang,
        0,
        TAU,
      );
      g.fill();
    }
    g.fillStyle = `hsl(${p.bloomHue + 12} 80% 82%)`;
    g.beginPath();
    g.arc(bx, 0, p.r * 0.07, 0, TAU);
    g.fill();
  }

  g.restore();
}
