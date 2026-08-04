import { clamp } from "@/lib/rng";

/**
 * A height-field cloth. Not a decorative blob under a texture — an actual
 * wave equation on a grid, lit per-cell from its own surface normals. That's
 * what makes a paw press push the fabric down, send ripples outward, and have
 * a creature underneath read as genuinely *underneath* something.
 *
 * The grid is coarse (~14px cells) and rendered into a small ImageData that
 * gets scaled up with smoothing, which is both very fast and gives the soft
 * gradients real cloth has.
 */

export interface Fabric {
  name: string;
  /** Base fabric colour, RGB 0-255. Kept in the blue / amber bands. */
  rgb: [number, number, number];
  /** Sheen strength — satin vs cotton. */
  spec: number;
  weave: "linen" | "knit" | "satin";
}

export const FABRICS: Fabric[] = [
  { name: "Indigo Linen", rgb: [46, 62, 112], spec: 0.35, weave: "linen" },
  { name: "Teal Knit", rgb: [30, 84, 88], spec: 0.25, weave: "knit" },
  { name: "Ochre Cotton", rgb: [104, 82, 38], spec: 0.3, weave: "linen" },
  { name: "Slate Satin", rgb: [48, 56, 76], spec: 0.75, weave: "satin" },
  { name: "Moss Blanket", rgb: [52, 74, 44], spec: 0.2, weave: "knit" },
];

const CELL = 14;
/** Wave stiffness. Sets ripple speed at sqrt(C) * CELL px/s. */
const C = 760;
/** Pull back toward flat, so the sheet settles instead of ringing forever. */
const K = 9;
const SUBSTEP = 1 / 140;
/** Central difference spans two cells; heights are in px, so must x. */
const GRAD = 1 / (2 * CELL);

/** A body pressing up under the cloth from below. */
export interface Dome {
  x: number;
  y: number;
  /** Radii along / across the heading. */
  rx: number;
  ry: number;
  a: number;
  amp: number;
}

export class Cloth {
  cols = 0;
  rows = 0;
  private h!: Float32Array;
  private v!: Float32Array;
  private eff!: Float32Array;
  private img!: ImageData;
  private buf!: HTMLCanvasElement;
  private bufCtx!: CanvasRenderingContext2D;
  private weaveTile: CanvasPattern | null = null;
  private acc = 0;
  fabric: Fabric;
  w = 0;
  screenH = 0;

  constructor(w: number, h: number, fabric: Fabric) {
    this.fabric = fabric;
    this.resize(w, h);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.screenH = h;
    this.cols = Math.max(8, Math.ceil(w / CELL) + 1);
    this.rows = Math.max(8, Math.ceil(h / CELL) + 1);
    const n = this.cols * this.rows;
    this.h = new Float32Array(n);
    this.v = new Float32Array(n);
    this.eff = new Float32Array(n);
    this.buf = document.createElement("canvas");
    this.buf.width = this.cols;
    this.buf.height = this.rows;
    this.bufCtx = this.buf.getContext("2d")!;
    this.img = this.bufCtx.createImageData(this.cols, this.rows);
    this.weaveTile = null;
  }

  private idx(cx: number, cy: number) {
    return cy * this.cols + cx;
  }

  /** Height at a world position, for gameplay queries. */
  heightAt(x: number, y: number) {
    const cx = clamp(Math.round(x / CELL), 0, this.cols - 1);
    const cy = clamp(Math.round(y / CELL), 0, this.rows - 1);
    return this.h[this.idx(cx, cy)];
  }

  /**
   * Push the cloth at a world position. Positive lifts (something underneath),
   * negative presses down (a paw on top).
   */
  poke(x: number, y: number, amount: number, radius: number) {
    const r = Math.max(1, radius / CELL);
    const cx = x / CELL;
    const cy = y / CELL;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.cols - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.rows - 1, Math.ceil(cy + r));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.hypot(i - cx, j - cy) / r;
        if (d > 1) continue;
        // Smooth falloff, so pokes never make a hard-edged cone.
        const f = 0.5 + 0.5 * Math.cos(d * Math.PI);
        this.v[this.idx(i, j)] += amount * f;
      }
    }
  }

  /**
   * Composite the domes into a scratch height field. Bodies are kept out of
   * the wave simulation on purpose: injecting a moving lump into the solver
   * makes it trail a huge chaotic wake that swamps the very thing the cat is
   * supposed to be tracking. Analytic domes stay crisp and readable, and the
   * wave field is left to do what it's good at — paw ripples.
   */
  private composite(domes: Dome[]) {
    const { h, eff, cols, rows } = this;
    eff.set(h);
    for (const d of domes) {
      const ca = Math.cos(-d.a);
      const sa = Math.sin(-d.a);
      const reach = Math.max(d.rx, d.ry);
      const cx = d.x / CELL;
      const cy = d.y / CELL;
      const rc = reach / CELL;
      const x0 = Math.max(0, Math.floor(cx - rc));
      const x1 = Math.min(cols - 1, Math.ceil(cx + rc));
      const y0 = Math.max(0, Math.floor(cy - rc));
      const y1 = Math.min(rows - 1, Math.ceil(cy + rc));
      for (let j = y0; j <= y1; j++) {
        for (let i = x0; i <= x1; i++) {
          const wx = i * CELL - d.x;
          const wy = j * CELL - d.y;
          // Rotate into the body's frame so the lump is elongated along its
          // heading — a creature shape, not a ball.
          const lx = (wx * ca - wy * sa) / d.rx;
          const ly = (wx * sa + wy * ca) / d.ry;
          const t = Math.sqrt(lx * lx + ly * ly);
          if (t >= 1) continue;
          const f = 0.5 + 0.5 * Math.cos(t * Math.PI);
          eff[j * cols + i] += d.amp * f * f;
        }
      }
    }
    return eff;
  }

  update(dt: number) {
    this.acc += Math.min(dt, 0.05);
    const damp = Math.pow(0.06, SUBSTEP);
    while (this.acc >= SUBSTEP) {
      this.acc -= SUBSTEP;
      const { cols, rows, h, v } = this;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i;
          // Edges are pinned: the sheet is tucked in at the screen border.
          if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) {
            h[k] = 0;
            v[k] = 0;
            continue;
          }
          const lap =
            h[k - 1] + h[k + 1] + h[k - cols] + h[k + cols] - 4 * h[k];
          v[k] += (lap * C - h[k] * K) * SUBSTEP;
          v[k] *= damp;
        }
      }
      for (let k = 0; k < h.length; k++) h[k] += v[k] * SUBSTEP;
    }
  }

  private buildWeave(g: CanvasRenderingContext2D) {
    const t = document.createElement("canvas");
    t.width = 8;
    t.height = 8;
    const c = t.getContext("2d")!;
    c.clearRect(0, 0, 8, 8);
    c.strokeStyle = "rgba(255,255,255,0.055)";
    c.lineWidth = 1;
    if (this.fabric.weave === "linen") {
      for (let i = 0; i < 8; i += 2) {
        c.beginPath();
        c.moveTo(i + 0.5, 0);
        c.lineTo(i + 0.5, 8);
        c.moveTo(0, i + 0.5);
        c.lineTo(8, i + 0.5);
        c.stroke();
      }
    } else if (this.fabric.weave === "knit") {
      c.strokeStyle = "rgba(255,255,255,0.07)";
      for (let i = 0; i < 8; i += 4) {
        c.beginPath();
        c.arc(i + 2, 2, 2, 0, Math.PI);
        c.arc(i + 4, 6, 2, 0, Math.PI);
        c.stroke();
      }
    } else {
      c.strokeStyle = "rgba(255,255,255,0.04)";
      for (let i = -8; i < 8; i += 3) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i + 8, 8);
        c.stroke();
      }
    }
    this.weaveTile = g.createPattern(t, "repeat");
  }

  render(g: CanvasRenderingContext2D, domes: Dome[] = []) {
    const { cols, rows, img } = this;
    const h = this.composite(domes);
    const d = img.data;
    const [br, bg, bb] = this.fabric.rgb;
    const spec = this.fabric.spec;

    // Light from the upper-left, the direction every human reads as "lit",
    // and the one that makes a raised bump unmistakable.
    const lx = -0.48;
    const ly = -0.66;
    const lz = 0.58;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const l = i > 0 ? h[k - 1] : h[k];
        const r = i < cols - 1 ? h[k + 1] : h[k];
        const u = j > 0 ? h[k - cols] : h[k];
        const dn = j < rows - 1 ? h[k + cols] : h[k];

        // Surface normal from the height gradient, in real units: heights are
        // in pixels, so the central difference has to be divided by the two
        // cells it spans. Skip that and the normals tip nearly horizontal, the
        // shaded flank crushes to black, and a raised dome reads as a hole
        // punched in the sheet rather than a body under it.
        let nx = (l - r) * GRAD;
        let ny = (u - dn) * GRAD;
        let nz = 1;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        nx *= inv;
        ny *= inv;
        nz *= inv;

        const diff = Math.max(0, nx * lx + ny * ly + nz * lz);
        // Blinn-ish highlight gives satin its sheen without a real shader.
        const hs = Math.max(0, nz * 0.86 + diff * 0.5 - 0.55);
        const s = spec * hs * hs * hs * 255;

        // Height itself brightens slightly: a raised fold catches more light,
        // and it keeps the bump legible even when it's moving straight at the
        // light source.
        const amb = 0.40 + clamp(h[k] * 0.010, -0.14, 0.16);
        const shade = amb + diff * 0.82;

        const o = k * 4;
        d[o] = clamp(br * shade + s, 0, 255);
        d[o + 1] = clamp(bg * shade + s, 0, 255);
        d[o + 2] = clamp(bb * shade + s, 0, 255);
        d[o + 3] = 255;
      }
    }

    this.bufCtx.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(this.buf, 0, 0, this.w, this.screenH);

    // Weave, laid over the lit fabric so the texture reads at full res rather
    // than being blurred up from the grid.
    if (!this.weaveTile) this.buildWeave(g);
    if (this.weaveTile) {
      g.save();
      g.globalAlpha = 0.5;
      g.fillStyle = this.weaveTile;
      g.fillRect(0, 0, this.w, this.screenH);
      g.restore();
    }

    // Tucked-in edge shading.
    const vg = g.createRadialGradient(
      this.w / 2,
      this.screenH / 2,
      Math.min(this.w, this.screenH) * 0.32,
      this.w / 2,
      this.screenH / 2,
      Math.max(this.w, this.screenH) * 0.7,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = vg;
    g.fillRect(0, 0, this.w, this.screenH);
  }
}

export const CLOTH_CELL = CELL;
