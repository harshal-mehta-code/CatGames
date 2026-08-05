import type { GameModule, GameHost, GameInstance, PawEvent } from "@/lib/types";
import { styleTuning } from "@/lib/profiles";
import { rand, randInt, pick, chance, clamp, TAU, damp } from "@/lib/rng";
import * as sfx from "@/lib/audio";
import { Rope } from "./rope";
import { PawField } from "@/lib/paw";
import { Drift } from "@/lib/tempo";

/**
 * The Wand.
 *
 * Modelled on how a good wand session is actually run, which is the opposite
 * of how most cat apps move things. Prey does not fly at the cat: it moves
 * *away*, it disappears behind something, it goes completely still at the
 * worst possible moment, and it bolts the instant the cat commits. Dangling
 * a toy in a cat's face makes it back off; dragging it out of sight makes it
 * pounce. So the toy here spends its time fleeing, hiding off the edge of
 * the board and freezing.
 *
 * The string is a real Verlet simulation rather than a drawn curve, because
 * the lag and whip of actual string is most of why cats care about it.
 */

type Phase = "sweep" | "dart" | "still" | "hide" | "peek" | "caught";

interface Floor {
  name: string;
  base: string;
  grain: string;
}

const FLOORS: Floor[] = [
  { name: "Dark Oak", base: "#0b0908", grain: "rgba(150,110,70,0.10)" },
  { name: "Slate", base: "#08090c", grain: "rgba(120,140,170,0.09)" },
  { name: "Rug", base: "#0a0b09", grain: "rgba(120,150,110,0.10)" },
];

type ToyKind = "feather" | "pom" | "ribbon";

interface Toy {
  kind: ToyKind;
  hue: number;
  hue2: number;
  sat: number;
  light: number;
  /** Overall scale in px. */
  size: number;
  barbs: number;
  barbLen: number;
  streamers: { len: number; wob: number; hue: number }[];
}

function makeToy(): Toy {
  // Blue-violet or amber/yellow-green: the two bands a dichromat cat resolves.
  const hue = chance(0.5) ? rand(52, 30) : rand(232, 198);
  const kind = pick<ToyKind>(["feather", "pom", "ribbon"]);
  return {
    kind,
    hue,
    // Contrast colour pulled to the opposite band.
    hue2: hue > 150 ? rand(60, 38) : rand(230, 200),
    sat: rand(80, 45),
    light: rand(80, 58),
    size: rand(52, 38) * (kind === "pom" ? 1.15 : 1),
    barbs: randInt(20, 12),
    barbLen: rand(1.5, 0.85),
    streamers: Array.from({ length: randInt(5, 3) }, () => ({
      len: rand(70, 34),
      wob: rand(2.4, 0.8),
      hue: chance(0.5) ? hue : hue > 150 ? rand(60, 38) : rand(230, 200),
    })),
  };
}

function makeFloor(w: number, h: number, dpr: number, f: Floor) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.floor(w * dpr));
  c.height = Math.max(1, Math.floor(h * dpr));
  const g = c.getContext("2d");
  if (!g) return c;
  g.scale(dpr, dpr);
  g.fillStyle = f.base;
  g.fillRect(0, 0, w, h);

  g.strokeStyle = f.grain;
  g.lineWidth = 1;
  for (let i = 0; i < 220; i++) {
    const y = rand(h);
    const x = rand(w);
    const len = rand(190, 50);
    g.globalAlpha = rand(0.5, 0.1);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + len * 0.5, y + rand(4, -4), x + len, y + rand(3, -3));
    g.stroke();
  }
  g.globalAlpha = 1;

  const vg = g.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.28,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.62)");
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  return c;
}

class Wand implements GameInstance {
  private host: GameHost;
  private w: number;
  private h: number;
  private floor: Floor;
  private baked: HTMLCanvasElement | null = null;

  private rope!: Rope;
  private toy: Toy = makeToy();
  private anchor = { x: 0, y: 0 };
  /** Where the toy is trying to get to, and how fast. */
  private goal = { x: 0, y: 0 };
  private toyV = 0;

  private phase: Phase = "sweep";
  private phaseT = 0;
  private phaseLen = 1;
  private caughtT = 0;
  private respawnT = 0;

  private t = 0;
  private idleT = 0;
  private whipT = 0;
  private timeScale = 1;
  /** Where the cat last touched — prey flees from here. */
  private lastPaw: { x: number; y: number } | null = null;
  /** Every touch scuffs the floor, whether or not it catches anything. */
  private field = new PawField({
    ring: "200,210,230",
    bloom: "150,165,195",
    hue: [30, 210],
    grit: 9,
    spread: 0.7,
  });
  /** Wanders the toy's pace so no phase runs at a constant speed. */
  private drift = new Drift(0.7, 1.5);

  constructor(host: GameHost) {
    this.host = host;
    this.w = host.width;
    this.h = host.height;
    this.floor = pick(FLOORS);
    this.baked = makeFloor(this.w, this.h, host.dpr, this.floor);
    this.reset();
  }

  private get tuning() {
    const t = styleTuning(this.host.profile.style);
    const skill = this.host.profile.skill;
    return {
      speed: t.speed * (0.75 + skill * 0.55),
      // A watcher gets much longer freezes; that stillness is what builds a
      // pounce, and cutting it short is the commonest way to lose them.
      still: t.freeze * (1.3 - skill * 0.45),
      hide: t.peek,
    };
  }

  private reset() {
    // Long enough to trail right across the board, so the handle can sit off
    // the edge and the toy still reach the middle.
    const seg = 16;
    const n = Math.round(clamp(Math.min(this.w, this.h) / seg, 22, 40));
    const x = this.w * 0.5;
    const y = this.h * 0.5;
    this.rope = new Rope(n, seg, x, y);
    this.anchor = { x: -70, y };
    this.goal = { x, y };
    this.toy = makeToy();
    this.setPhase("sweep");
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.baked = makeFloor(w, h, this.host.dpr, this.floor);
    this.reset();
  }

  /** A point well inside the board, biased away from the cat's last paw. */
  private fleePoint(minDist = 0) {
    let best = { x: rand(this.w), y: rand(this.h) };
    let bestScore = -Infinity;
    for (let i = 0; i < 12; i++) {
      const p = {
        x: rand(this.w * 0.9, this.w * 0.1),
        y: rand(this.h * 0.88, this.h * 0.12),
      };
      const tip = this.rope.tip;
      const travel = Math.hypot(p.x - tip.x, p.y - tip.y);
      if (travel < minDist) continue;
      // Prefer somewhere far from the paw. Prey that runs toward the cat is
      // the single most common mistake in toys like this, and cats disengage
      // from it fast.
      const away = this.lastPaw
        ? Math.hypot(p.x - this.lastPaw.x, p.y - this.lastPaw.y)
        : 0;
      const score = away * 1.3 + travel * 0.6;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  /**
   * Where the hand should sit for a given toy position: just outside the
   * nearest edge, so the string always reads as running off-frame to whoever
   * is holding it rather than stopping at a floating endpoint on the floor.
   */
  private handFor(target: { x: number; y: number }) {
    const out = 70;
    const d = [
      { x: -out, y: target.y, d: target.x },
      { x: this.w + out, y: target.y, d: this.w - target.x },
      { x: target.x, y: -out, d: target.y },
      { x: target.x, y: this.h + out, d: this.h - target.y },
    ].sort((a, b) => a.d - b.d)[0];
    return { x: d.x, y: d.y };
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
    const tune = this.tuning;

    switch (p) {
      case "sweep": {
        this.goal = this.fleePoint(180);
        this.toyV = rand(360, 210) * tune.speed;
        this.phaseLen = rand(2.6, 1.4);
        break;
      }
      case "dart": {
        this.goal = this.fleePoint(280);
        this.toyV = rand(1150, 780) * tune.speed;
        this.phaseLen = rand(0.7, 0.35);
        break;
      }
      case "still": {
        // Stop dead wherever it is. The long stall is the invitation to
        // pounce, and cutting it short is the commonest way to lose a cat.
        this.goal = { x: this.rope.tip.x, y: this.rope.tip.y };
        this.toyV = 0;
        this.phaseLen = rand(2.4, 1.1) * tune.still;
        break;
      }
      case "hide": {
        // Drag the toy right off the edge. Out of sight is the strongest move
        // there is — a cat will commit to something it can't see.
        const side = randInt(4);
        const off = 150;
        this.goal =
          side === 0
            ? { x: -off, y: rand(this.h) }
            : side === 1
              ? { x: this.w + off, y: rand(this.h) }
              : side === 2
                ? { x: rand(this.w), y: -off }
                : { x: rand(this.w), y: this.h + off };
        this.toyV = rand(900, 620) * tune.speed;
        // Clamped, unlike the other phases: a hide has to last long enough to
        // actually travel off the edge and then be gone for a beat. Scaled
        // down by style tuning it finished before the toy had left the board,
        // which loses the entire effect.
        this.phaseLen = rand(2.4, 1.4) * clamp(tune.hide, 0.8, 1.4);
        break;
      }
      case "peek": {
        // Just barely back into view, quivering at the edge.
        this.goal = {
          x: clamp(this.rope.tip.x, this.w * 0.06, this.w * 0.94),
          y: clamp(this.rope.tip.y, this.h * 0.08, this.h * 0.92),
        };
        this.toyV = rand(260, 130) * tune.speed;
        this.phaseLen = rand(1.6, 0.8) * tune.still;
        break;
      }
      case "caught":
        this.goal = { x: this.rope.tip.x, y: this.rope.tip.y };
        this.toyV = 0;
        this.phaseLen = 1.5;
        break;
    }
  }

  /** What to do next, weighted like a person who knows how to use a wand. */
  private nextPhase() {
    const r = Math.random();
    switch (this.phase) {
      case "hide":
        // Coming out of hiding is always a peek, never a charge.
        return this.setPhase("peek");
      case "peek":
        return this.setPhase(r < 0.55 ? "dart" : r < 0.8 ? "still" : "sweep");
      case "still":
        return this.setPhase(r < 0.6 ? "dart" : r < 0.85 ? "sweep" : "hide");
      case "dart":
        return this.setPhase(r < 0.45 ? "still" : r < 0.75 ? "sweep" : "hide");
      default:
        return this.setPhase(r < 0.35 ? "still" : r < 0.6 ? "dart" : r < 0.85 ? "sweep" : "hide");
    }
  }

  paw(e: PawEvent) {
    this.idleT = 0;
    const pan = (e.x / this.w) * 2 - 1;
    this.lastPaw = { x: e.x, y: e.y };

    const reach = this.field.paw(e);
    if (e.phase !== "down") return;
    this.host.report({ type: "engage" });
    sfx.thump(pan, 0.6 + e.force * 0.6);

    if (this.phase === "caught") return;

    const tip = this.rope.tip;
    const d = Math.hypot(tip.x - e.x, tip.y - e.y);
    if (d < reach + this.toy.size * 0.9) {
      // Pinned the toy itself. Terminal: the hunt resolves, the string goes
      // slack, and the toy is dead rather than snatched away forever.
      this.host.report({ type: "hit", value: 2 });
      sfx.crunch(pan);
      sfx.squeak(pan, false);
      this.timeScale = 0.42;
      this.field.strike(tip.x, tip.y, reach, 1.2);
      this.caughtT = 0;
      this.setPhase("caught");
      return;
    }

    this.host.report({ type: "miss" });
    // Caught the string but not the toy: it whips, and the toy bolts. A real
    // partial win — the cat visibly did something.
    if (this.rope.push(e.x, e.y, reach * 1.5, 0.9)) {
      this.host.report({ type: "near-miss" });
      sfx.rustle(pan, 0.7);
      if (chance(0.7)) this.setPhase("dart");
    } else if (d < reach * 4) {
      this.setPhase("dart");
      this.host.report({ type: "near-miss" });
    }
  }

  update(dt: number) {
    this.field.update(dt);
    this.drift.update(dt);
    this.timeScale = damp(this.timeScale, 1, 0.2, dt);
    const sdt = Math.min(dt * this.timeScale, 0.05);
    this.t += sdt;
    this.idleT += dt;
    this.phaseT += sdt;

    if (this.phase === "caught") {
      this.caughtT += dt;
      // Let it lie dead a moment, then the string drags it away and a fresh
      // toy comes in. The pause is what makes the catch feel like an ending.
      if (this.caughtT > 1.5 && this.respawnT <= 0) {
        // Dragged off by whoever is holding the wand, then a fresh one comes
        // in. The pause is what makes the catch read as an ending.
        this.respawnT = rand(2.6, 1.5);
        this.goal = { x: this.anchor.x, y: this.anchor.y };
        this.toyV = 700;
      }
      if (this.respawnT > 0) {
        this.respawnT -= dt;
        if (this.respawnT <= 0) {
          this.reset();
          sfx.chirp(0);
        }
      }
    } else if (this.phaseT >= this.phaseLen) {
      this.nextPhase();
    }

    // The hand follows the toy round to whichever edge is nearest, so the
    // string always trails off-frame instead of ending in mid-air.
    const hand = this.handFor(this.rope.tip);
    this.anchor.x = damp(this.anchor.x, hand.x, 0.5, dt);
    this.anchor.y = damp(this.anchor.y, hand.y, 0.5, dt);

    // A hand is never perfectly steady, and the tiny tremor during a freeze is
    // what keeps a stalled toy alive rather than looking switched off.
    const quiver = this.phase === "still" || this.phase === "peek" ? 3.5 : 1;
    const jx = Math.sin(this.t * 21 + 1.3) * quiver;
    const jy = Math.cos(this.t * 17) * quiver;

    this.rope.step(
      sdt,
      { x: this.anchor.x + jx, y: this.anchor.y + jy },
      { x: this.goal.x + jx, y: this.goal.y + jy },
      // Drift keeps the pace wandering inside every phase, so even a long
      // sweep never travels at one steady speed.
      this.toyV * this.drift.value,
      this.w,
      this.h,
    );

    // A paw resting on the string keeps deflecting it, so a cat can pin and
    // drag the line, not just strike it.
    for (const p of this.field.threats)
      this.rope.push(p.x, p.y, p.r * 1.3, 0.55);

    // --- Audio -------------------------------------------------------------
    this.whipT -= dt;
    const sp = this.rope.tipSpeed(sdt);
    if (this.whipT <= 0 && sfx.audioReady() && this.phase !== "caught") {
      if (sp > 900) {
        this.whipT = rand(0.4, 0.2);
        sfx.skitter((this.rope.tip.x / this.w) * 2 - 1, 1, 0.2);
      } else if (sp > 260) {
        this.whipT = rand(0.7, 0.35);
        sfx.rustle((this.rope.tip.x / this.w) * 2 - 1, 0.5);
      }
    }

    // --- Re-hook a disengaged cat -----------------------------------------
    if (this.idleT > 11 && this.phase !== "caught") {
      this.idleT = rand(6, 3);
      this.setPhase("dart");
      sfx.chirp((this.rope.tip.x / this.w) * 2 - 1);
    }
  }

  private drawToy(g: CanvasRenderingContext2D) {
    const pts = this.rope.pts;
    const tip = pts[pts.length - 1];
    const prev = pts[pts.length - 3] ?? pts[0];
    const a = Math.atan2(tip.y - prev.y, tip.x - prev.x);
    const toy = this.toy;
    const dead = this.phase === "caught";
    const s = toy.size;

    g.save();
    g.translate(tip.x, tip.y);
    g.rotate(a);

    // Contact shadow, so the toy sits on the floor rather than floating.
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.beginPath();
    g.ellipse(-s * 0.1, s * 0.22, s * 0.85, s * 0.6, 0, 0, TAU);
    g.fill();

    const main = `hsl(${toy.hue} ${toy.sat}% ${toy.light}%)`;
    const alt = `hsl(${toy.hue2} ${toy.sat}% ${toy.light * 0.85}%)`;

    if (toy.kind === "feather") {
      // Quill plus barbs, splayed by how fast it's moving.
      const flare = dead ? 0.45 : 1;

      // A soft vane behind the barbs. Barbs alone read as a comb; the filled
      // outline is what makes the silhouette a feather.
      g.fillStyle = `hsla(${toy.hue} ${toy.sat}% ${toy.light}% / 0.3)`;
      g.beginPath();
      for (const side of [-1, 1]) {
        for (let i = 0; i <= toy.barbs; i++) {
          const f = side < 0 ? i / toy.barbs : 1 - i / toy.barbs;
          const bx = -s * 0.9 + f * s * 1.7;
          const spread = Math.sin(f * Math.PI) * s * toy.barbLen * flare;
          const px = bx - s * 0.5;
          const py = side * spread;
          if (side < 0 && i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
      }
      g.closePath();
      g.fill();

      g.strokeStyle = alt;
      g.lineWidth = Math.max(1.4, s * 0.07);
      g.lineCap = "round";
      for (let i = 0; i < toy.barbs; i++) {
        const f = i / (toy.barbs - 1);
        const bx = -s * 0.9 + f * s * 1.7;
        const spread = Math.sin(f * Math.PI) * s * toy.barbLen * flare;
        const wob = Math.sin(this.t * 9 + i * 0.7) * s * 0.1 * flare;
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(bx, 0);
          g.quadraticCurveTo(
            bx - s * 0.25,
            side * spread * 0.55 + wob,
            bx - s * 0.5,
            side * spread + wob,
          );
          g.stroke();
        }
      }
      g.strokeStyle = main;
      g.lineWidth = Math.max(1.8, s * 0.1);
      g.beginPath();
      g.moveTo(-s * 1.0, 0);
      g.lineTo(s * 0.85, 0);
      g.stroke();
    } else if (toy.kind === "pom") {
      // A fuzzy ball: many short strands, plus a solid core.
      g.strokeStyle = alt;
      g.lineWidth = Math.max(1.2, s * 0.055);
      const n = toy.barbs * 3;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + Math.sin(this.t * 3 + i) * 0.06;
        const len = s * (dead ? 0.72 : 0.95) * rand(1.05, 0.72);
        g.beginPath();
        g.moveTo(Math.cos(ang) * s * 0.25, Math.sin(ang) * s * 0.25);
        g.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
        g.stroke();
      }
      const grad = g.createRadialGradient(-s * 0.15, -s * 0.15, 0, 0, 0, s * 0.6);
      grad.addColorStop(0, `hsl(${toy.hue} ${toy.sat}% ${Math.min(94, toy.light + 18)}%)`);
      grad.addColorStop(1, main);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, s * 0.55, 0, TAU);
      g.fill();
    } else {
      // Ribbons: long streamers that lag behind the head.
      g.lineCap = "round";
      for (const [i, st] of toy.streamers.entries()) {
        g.strokeStyle = `hsl(${st.hue} ${toy.sat}% ${toy.light}%)`;
        g.lineWidth = Math.max(1.6, s * 0.11);
        const sway = dead ? 0.25 : 1;
        const p1 = Math.sin(this.t * 7 + i * 1.7) * st.len * 0.35 * st.wob * sway;
        const p2 = Math.sin(this.t * 5.5 + i * 2.1) * st.len * 0.5 * st.wob * sway;
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(
          -st.len * 0.4,
          p1,
          -st.len * 0.75,
          p2,
          -st.len,
          (p1 + p2) * 0.4,
        );
        g.stroke();
      }
      g.fillStyle = main;
      g.beginPath();
      g.arc(0, 0, s * 0.4, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  render(g: CanvasRenderingContext2D) {
    if (this.baked) g.drawImage(this.baked, 0, 0, this.w, this.h);
    else {
      g.fillStyle = this.floor.base;
      g.fillRect(0, 0, this.w, this.h);
    }

    const pts = this.rope.pts;

    // The string, drawn as a smooth curve through the simulated points and
    // faded out toward the handle so it reads as running off-frame rather
    // than stopping at a floating endpoint.
    const mid = (i: number) => ({
      x: (pts[i].x + pts[i + 1].x) / 2,
      y: (pts[i].y + pts[i + 1].y) / 2,
    });
    for (const [width, alpha] of [
      [5, 0.16],
      [2.2, 0.62],
    ] as const) {
      const grad = g.createLinearGradient(
        pts[0].x,
        pts[0].y,
        pts[pts.length - 1].x,
        pts[pts.length - 1].y,
      );
      grad.addColorStop(0, `rgba(210,220,235,0)`);
      grad.addColorStop(0.35, `rgba(210,220,235,${alpha * 0.5})`);
      grad.addColorStop(1, `rgba(225,235,250,${alpha})`);
      g.strokeStyle = grad;
      g.lineWidth = width;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const m = mid(i);
        g.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
      }
      g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      g.stroke();
    }

    this.drawToy(g);
    this.field.render(g);
  }
}

export const wand: GameModule = {
  id: "wand",
  title: "The Wand",
  tagline:
    "A real string, simulated. The toy runs away, hides off the edge, and freezes at the worst moment — never straight at the cat. Pin it and it goes limp.",
  suits: ["pouncer", "watcher"],
  backdrop: FLOORS[0].base,
  accent: "#9fd0ff",
  create: (host) => new Wand(host),
};
