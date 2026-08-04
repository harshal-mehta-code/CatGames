import type { Bug, Cover } from "./bug";
import { rand, pick, TAU, clamp } from "@/lib/rng";

/**
 * Everything is drawn as vectors at runtime — no sprite sheets, no image
 * assets, nothing to load. That keeps the deploy free and tiny, and it means
 * a newly generated species is drawable without anyone having to author art.
 */

export interface Biome {
  name: string;
  base: string;
  base2: string;
  grain: string;
  coverA: string;
  coverB: string;
  coverVein: string;
  /** Cover silhouette style. */
  coverKind: "leaf" | "stone" | "board" | "grass";
}

/**
 * Backgrounds stay dark and desaturated. A cat's retina is rod-heavy: high
 * contrast against a dim field is far more legible to them than a bright,
 * busy scene, and a dark screen is also gentler for the crepuscular hours
 * when they actually want to hunt.
 */
export const BIOMES: Biome[] = [
  {
    name: "Cellar Floor",
    base: "#0b0d10",
    base2: "#15191f",
    grain: "rgba(150,170,190,0.05)",
    coverA: "#1b2129",
    coverB: "#0e1216",
    coverVein: "rgba(160,180,200,0.16)",
    coverKind: "stone",
  },
  {
    name: "Leaf Litter",
    base: "#0a0d09",
    base2: "#161b12",
    grain: "rgba(180,200,120,0.05)",
    coverA: "#243016",
    coverB: "#101707",
    coverVein: "rgba(190,220,130,0.2)",
    coverKind: "leaf",
  },
  {
    name: "Old Deck",
    base: "#0c0a08",
    base2: "#1a1510",
    grain: "rgba(210,180,140,0.05)",
    coverA: "#2a2116",
    coverB: "#130e09",
    coverVein: "rgba(220,190,140,0.14)",
    coverKind: "board",
  },
  {
    name: "Night Lawn",
    base: "#07100c",
    base2: "#0e1c14",
    grain: "rgba(140,220,170,0.05)",
    coverA: "#14301f",
    coverB: "#07160e",
    coverVein: "rgba(150,230,180,0.18)",
    coverKind: "grass",
  },
  {
    name: "Blue Hour",
    base: "#070a14",
    base2: "#101728",
    grain: "rgba(150,180,255,0.05)",
    coverA: "#182444",
    coverB: "#0a0f1e",
    coverVein: "rgba(160,190,255,0.16)",
    coverKind: "stone",
  },
];

export const pickBiome = () => pick(BIOMES);

/** Bake the ground into an offscreen canvas once; it never changes. */
export function makeSubstrate(
  w: number,
  h: number,
  dpr: number,
  biome: Biome,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.floor(w * dpr));
  c.height = Math.max(1, Math.floor(h * dpr));
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);

  const grad = g.createRadialGradient(
    w * 0.5,
    h * 0.42,
    Math.min(w, h) * 0.05,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.78,
  );
  grad.addColorStop(0, biome.base2);
  grad.addColorStop(1, biome.base);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  // Grain: short strokes rather than pixel noise, so it survives the retina
  // scale-up and reads as a real surface.
  g.strokeStyle = biome.grain;
  g.lineWidth = 1;
  const strokes = Math.floor((w * h) / 900);
  if (biome.coverKind === "board") {
    // Long horizontal wood grain plus plank seams.
    for (let i = 0; i < strokes; i++) {
      const y = Math.random() * h;
      const x = Math.random() * w;
      const len = rand(160, 30);
      g.globalAlpha = rand(1, 0.2);
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + len / 2, y + rand(3, -3), x + len, y);
      g.stroke();
    }
    g.globalAlpha = 0.5;
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.lineWidth = 2;
    for (let y = rand(140, 90); y < h; y += rand(190, 120)) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  } else {
    for (let i = 0; i < strokes; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const a = rand(TAU);
      const len = rand(14, 2);
      g.globalAlpha = rand(1, 0.15);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
  }
  g.globalAlpha = 1;

  // Vignette keeps the eye (and the cat) in the middle of the screen.
  const vg = g.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.3,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.72,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  return c;
}

function coverPath(g: CanvasRenderingContext2D, c: Cover) {
  const n = c.lobes.length;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const r = c.r * c.lobes[i];
    pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.72]);
  }
  // Smooth closed curve: run the curve *through* the midpoints and use each
  // vertex as the control point. Passing through the vertices instead gives
  // the faceted polygon look we don't want.
  const mid = (i: number): [number, number] => {
    const a = pts[i % n];
    const b = pts[(i + 1) % n];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  g.beginPath();
  const [sx, sy] = mid(n - 1);
  g.moveTo(sx, sy);
  for (let i = 0; i < n; i++) {
    const [mx, my] = mid(i);
    g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  g.closePath();
}

export function drawCover(
  g: CanvasRenderingContext2D,
  c: Cover,
  biome: Biome,
  lift: number,
) {
  g.save();
  g.translate(c.x, c.y);
  g.rotate(c.rot);

  // Drop shadow, pushed out while something is moving underneath.
  g.save();
  g.translate(3 + lift * 5, 5 + lift * 7);
  g.fillStyle = "rgba(0,0,0,0.5)";
  g.filter = "blur(6px)";
  coverPath(g, c);
  g.fill();
  g.restore();

  const grad = g.createLinearGradient(-c.r, -c.r, c.r, c.r);
  grad.addColorStop(0, biome.coverA);
  grad.addColorStop(1, biome.coverB);
  g.fillStyle = grad;
  coverPath(g, c);
  g.fill();

  g.save();
  coverPath(g, c);
  g.clip();
  g.strokeStyle = biome.coverVein;
  g.lineWidth = 1.2;
  if (biome.coverKind === "leaf") {
    g.beginPath();
    g.moveTo(-c.r, 0);
    g.lineTo(c.r, 0);
    g.stroke();
    for (let i = -5; i <= 5; i++) {
      const x = (i / 6) * c.r;
      g.beginPath();
      g.moveTo(x, 0);
      g.quadraticCurveTo(x + c.r * 0.18, c.r * 0.2, x + c.r * 0.26, c.r * 0.45);
      g.moveTo(x, 0);
      g.quadraticCurveTo(
        x + c.r * 0.18,
        -c.r * 0.2,
        x + c.r * 0.26,
        -c.r * 0.45,
      );
      g.stroke();
    }
  } else if (biome.coverKind === "grass") {
    for (let i = 0; i < 14; i++) {
      const x = rand(c.r, -c.r);
      g.beginPath();
      g.moveTo(x, c.r * 0.6);
      g.quadraticCurveTo(x + rand(30, -30), 0, x + rand(50, -50), -c.r * 0.7);
      g.stroke();
    }
  } else {
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(rand(c.r, -c.r), -c.r);
      g.lineTo(rand(c.r, -c.r), c.r);
      g.stroke();
    }
  }
  g.restore();

  // Rim light along the top edge so the cover reads as raised.
  g.strokeStyle = "rgba(255,255,255,0.10)";
  g.lineWidth = 1.5;
  coverPath(g, c);
  g.stroke();
  g.restore();
}

/** The bulge a hidden bug makes as it travels under a leaf. */
export function drawBump(g: CanvasRenderingContext2D, b: Bug) {
  const r = b.radius * 1.9;
  const a = b.depth;
  g.save();
  g.translate(b.x, b.y);
  const grad = g.createRadialGradient(-r * 0.3, -r * 0.4, 0, 0, 0, r);
  grad.addColorStop(0, `rgba(255,255,255,${0.16 * a})`);
  grad.addColorStop(0.55, `rgba(255,255,255,${0.05 * a})`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(0, 0, r, r * 0.8, b.a, 0, TAU);
  g.fill();
  g.fillStyle = `rgba(0,0,0,${0.3 * a})`;
  g.beginPath();
  g.ellipse(r * 0.25, r * 0.35, r * 0.7, r * 0.5, b.a, 0, TAU);
  g.fill();
  g.restore();
}

export function drawBug(g: CanvasRenderingContext2D, b: Bug) {
  if (b.state === "gone") return;
  const gm = b.g;
  const s = b.scale;
  const dead = b.state === "dying";
  const fade = dead ? clamp(1 - (b.deathT - 1.6) / 1, 0, 1) : 1;
  const surface = 1 - b.depth;
  if (surface <= 0.02) return;

  const alpha = fade * surface;
  const body = `hsl(${gm.hue} ${gm.sat}% ${gm.light}%)`;
  const dark = `hsl(${gm.hue} ${gm.sat}% ${gm.light * 0.35}%)`;
  const patt = `hsl(${gm.patternHue} ${gm.sat + 10}% ${gm.light * 1.25}%)`;

  g.save();
  g.globalAlpha = alpha;

  // --- Contact shadow ---------------------------------------------------
  g.save();
  g.translate(b.x + 3, b.y + 5);
  g.rotate(b.a);
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.filter = "blur(4px)";
  g.beginPath();
  g.ellipse(0, 0, gm.bodyLen * 0.55 * s, gm.bodyW * 0.5 * s, 0, 0, TAU);
  g.fill();
  g.restore();

  // --- Legs (world-space feet, body-space joints) ------------------------
  g.strokeStyle = dark;
  g.lineCap = "round";
  g.lineJoin = "round";
  const c = Math.cos(b.a);
  const sn = Math.sin(b.a);
  for (const f of b.feet) {
    const t = gm.legPairs === 1 ? 0.5 : f.index / (gm.legPairs - 1);
    const jx = (0.3 - t * 0.7) * gm.bodyLen * s;
    const jy = f.side * gm.bodyW * 0.4 * s;
    const hx = b.x + jx * c - jy * sn;
    const hy = b.y + jx * sn + jy * c;

    // Knee is pushed outward (away from the body) and the segment lengths
    // stay fixed, so a stretched leg straightens instead of stretching.
    const dx = f.x - hx;
    const dy = f.y - hy;
    const d = Math.hypot(dx, dy) || 1;
    const seg = gm.legLen * s * 0.72;
    const half = Math.min(d / 2, seg * 0.98);
    const out = Math.sqrt(Math.max(0, seg * seg - half * half));
    const mx = hx + dx * 0.5;
    const my = hy + dy * 0.5;
    const px = (-dy / d) * f.side;
    const py = (dx / d) * f.side;
    const kx = mx + px * out;
    const ky = my + py * out;

    const lift = f.sw < 1 ? Math.sin(f.sw * Math.PI) : 0;
    g.lineWidth = Math.max(1, 2.1 * s);
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(kx - lift * 3, ky - lift * 5);
    g.lineTo(f.x, f.y - lift * 6);
    g.stroke();

    // Tarsus tick — tiny, but it's what stops legs looking like sticks.
    g.lineWidth = Math.max(0.8, 1.2 * s);
    g.beginPath();
    g.moveTo(f.x, f.y - lift * 6);
    g.lineTo(f.x + dx * 0.06, f.y + dy * 0.06 - lift * 6);
    g.stroke();
  }

  // --- Body --------------------------------------------------------------
  g.translate(b.x, b.y);
  g.rotate(b.a);
  g.scale(1 / b.squash, b.squash);

  const L = gm.bodyLen * s;
  const W = gm.bodyW * s;

  // Abdomen
  const bodyGrad = g.createLinearGradient(0, -W * 0.6, 0, W * 0.6);
  bodyGrad.addColorStop(0, `hsl(${gm.hue} ${gm.sat}% ${gm.light * 1.3}%)`);
  bodyGrad.addColorStop(0.55, body);
  bodyGrad.addColorStop(1, dark);
  g.fillStyle = bodyGrad;
  g.beginPath();
  g.ellipse(-L * 0.12, 0, L * 0.5, W * 0.5, 0, 0, TAU);
  g.fill();

  // Shell pattern, clipped to the abdomen.
  g.save();
  g.beginPath();
  g.ellipse(-L * 0.12, 0, L * 0.5, W * 0.5, 0, 0, TAU);
  g.clip();
  g.globalAlpha = alpha * 0.85;
  if (gm.pattern === "stripes") {
    g.fillStyle = patt;
    for (let i = 0; i < gm.segments; i++) {
      const x = -L * 0.6 + (i / gm.segments) * L * 0.95;
      g.fillRect(x, -W, L * 0.06, W * 2);
    }
  } else if (gm.pattern === "spots") {
    g.fillStyle = patt;
    for (let i = 0; i < gm.segments + 2; i++) {
      const x = -L * 0.5 + rand(L * 0.8);
      const y = rand(W * 0.35, -W * 0.35);
      g.beginPath();
      g.arc(x, y, W * rand(0.16, 0.07), 0, TAU);
      g.fill();
    }
  } else if (gm.pattern === "ridge") {
    g.strokeStyle = patt;
    g.lineWidth = 1.4 * s;
    for (let i = 1; i < gm.segments + 2; i++) {
      const x = -L * 0.6 + (i / (gm.segments + 2)) * L;
      g.beginPath();
      g.moveTo(x, -W * 0.5);
      g.quadraticCurveTo(x - L * 0.05, 0, x, W * 0.5);
      g.stroke();
    }
  } else if (gm.pattern === "iridescent") {
    const ir = g.createLinearGradient(-L * 0.6, 0, L * 0.4, 0);
    ir.addColorStop(0, `hsla(${gm.patternHue} 90% 70% / 0.55)`);
    ir.addColorStop(0.5, "hsla(0 0% 100% / 0.12)");
    ir.addColorStop(1, `hsla(${gm.hue} 90% 65% / 0.5)`);
    g.fillStyle = ir;
    g.fillRect(-L, -W, L * 2, W * 2);
  }
  // Elytra seam down the middle — reads instantly as "beetle".
  g.globalAlpha = alpha * 0.6;
  g.strokeStyle = "rgba(0,0,0,0.6)";
  g.lineWidth = 1.3 * s;
  g.beginPath();
  g.moveTo(-L * 0.6, 0);
  g.lineTo(L * 0.3, 0);
  g.stroke();
  g.restore();
  g.globalAlpha = alpha;

  // Thorax
  g.fillStyle = dark;
  g.beginPath();
  g.ellipse(L * 0.26, 0, L * 0.18, W * 0.42, 0, 0, TAU);
  g.fill();

  // Head
  g.fillStyle = `hsl(${gm.hue} ${gm.sat}% ${gm.light * 0.55}%)`;
  g.beginPath();
  g.arc(L * 0.44, 0, gm.headR * s, 0, TAU);
  g.fill();

  // Eyes — two tiny specular dots. Cheap, and they make it look sentient.
  g.fillStyle = "rgba(255,255,255,0.75)";
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(L * 0.47, side * gm.headR * s * 0.55, Math.max(0.8, 1.1 * s), 0, TAU);
    g.fill();
  }

  // Antennae — spring-driven, they lag the body and sweep during freezes.
  if (gm.antennaLen > 0) {
    g.strokeStyle = dark;
    g.lineWidth = Math.max(0.9, 1.5 * s);
    const AL = gm.antennaLen * s;
    for (const side of [-1, 1]) {
      const sweep = b.antA * side + side * 0.55;
      g.beginPath();
      g.moveTo(L * 0.48, side * gm.headR * s * 0.4);
      g.quadraticCurveTo(
        L * 0.48 + AL * 0.6,
        side * gm.headR * s + sweep * AL * 0.45,
        L * 0.48 + AL * Math.cos(sweep * 0.5),
        side * gm.headR * s + sweep * AL,
      );
      g.stroke();
    }
  }

  // Gloss: a hard specular streak that slides as the bug turns.
  if (gm.gloss > 0.1 && !dead) {
    g.globalAlpha = alpha * gm.gloss * 0.5;
    g.fillStyle = "#fff";
    g.beginPath();
    g.ellipse(-L * 0.18, -W * 0.24, L * 0.2, W * 0.1, -0.3, 0, TAU);
    g.fill();
    g.globalAlpha = alpha;
  }

  // Firefly lantern.
  if (gm.glow > 0) {
    const pulse = (Math.sin(b.glowPhase) * 0.5 + 0.5) ** 2;
    const gr = g.createRadialGradient(-L * 0.5, 0, 0, -L * 0.5, 0, W * 4.5);
    gr.addColorStop(0, `hsla(${gm.hue} 100% 70% / ${0.85 * pulse * gm.glow})`);
    gr.addColorStop(1, "hsla(0 0% 0% / 0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(-L * 0.5, 0, W * 4.5, 0, TAU);
    g.fill();
  }

  // Startle flash — confirms to the cat that a near miss *did* something.
  if (b.startle > 0.02) {
    g.globalAlpha = alpha * b.startle * 0.6;
    g.strokeStyle = "#fff";
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(0, 0, L * 0.6, W * 0.62, 0, 0, TAU);
    g.stroke();
  }

  g.restore();
}
