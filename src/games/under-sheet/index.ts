import type { GameModule, GameHost, GameInstance, PawEvent } from "@/lib/types";
import { styleTuning } from "@/lib/profiles";
import {
  rand,
  randInt,
  chance,
  clamp,
  damp,
  gauss,
  levyStep,
  angleLerp,
  pick,
  TAU,
} from "@/lib/rng";
import * as sfx from "@/lib/audio";
import { Cloth, FABRICS, type Dome, type Fabric } from "./cloth";

type CritterState = "roam" | "freeze" | "flee" | "stunned";

interface TailSeg {
  x: number;
  y: number;
}

/**
 * The thing under the sheet. The player never sees its body — only the bump
 * it makes in the cloth, and its tail, which has slipped out and lies on top.
 */
class Critter {
  x: number;
  y: number;
  a = rand(TAU);
  targetA = this.a;
  v = 0;
  targetV = 0;
  state: CritterState = "roam";
  stateT = 0;
  burstLen = rand(0.5, 0.2);
  freezeLen = 1;
  /** Body size — drives how big a lump it makes. */
  size: number;
  /** Peak lift applied to the cloth. */
  lift: number;
  speed: number;
  tail: TailSeg[] = [];
  tailLen: number;
  /** Lateral whip phase, so the tail flicks rather than just trailing. */
  whip = rand(TAU);
  stun = 0;
  caught = false;
  revealT = 0;
  /** Appearance genes — every animal revealed is a different one. */
  hue: number;
  earScale: number;
  plump: number;
  snout: number;

  constructor(x: number, y: number, big = false) {
    this.x = x;
    this.y = y;
    this.size = rand(62, 46) * (big ? 1.45 : 1);
    this.lift = rand(26, 19) * (big ? 1.3 : 1);
    this.speed = rand(150, 95) * (big ? 0.82 : 1);
    this.hue = chance(0.5) ? rand(45, 28) : rand(228, 200);
    this.earScale = rand(1.3, 0.65);
    this.plump = rand(1.15, 0.85);
    this.snout = rand(1.25, 0.8);
    this.tailLen = rand(9, 6);
    for (let i = 0; i < this.tailLen; i++) this.tail.push({ x, y });
  }

  get radius() {
    return this.size;
  }

  spook(fromX: number, fromY: number) {
    this.a = Math.atan2(this.y - fromY, this.x - fromX) + gauss(0, 0.35);
    this.targetA = this.a;
    this.state = "flee";
    this.stateT = 0;
    this.v = this.speed * 2.9;
  }

  /** A tail grab. It squirms loose and bolts — a real but partial win. */
  graze(fromX: number, fromY: number) {
    this.state = "stunned";
    this.stateT = 0;
    this.stun = 1;
    this.v = 0;
    this.a = Math.atan2(this.y - fromY, this.x - fromX);
    this.targetA = this.a;
  }

  /**
   * Pinned through the sheet. This is a terminal capture: the hunt resolves,
   * the sheet slides off, and the cat finally sees what it has been chasing.
   * Without this the game is an unwinnable chase — the exact thing that makes
   * laser pointers bad for cats.
   */
  pin(fromX: number, fromY: number) {
    if (this.caught) return false;
    this.caught = true;
    this.revealT = 0;
    this.v = 0;
    this.targetV = 0;
    this.a = Math.atan2(this.y - fromY, this.x - fromX);
    this.targetA = this.a;
    return true;
  }

  /** Cloth lift. Bunches up as it's pinned, then drops away as it's revealed. */
  get domeAmp() {
    if (!this.caught) return this.lift * (1 + this.stun * 0.7);
    if (this.revealT < 0.35) {
      return this.lift * (1 + (this.revealT / 0.35) * 0.8);
    }
    return this.lift * 1.8 * clamp(1 - (this.revealT - 0.35) / 0.3, 0, 1);
  }

  /** Opacity of the revealed animal sitting on top of the sheet. */
  get revealAlpha() {
    if (!this.caught) return 0;
    const inn = clamp((this.revealT - 0.28) / 0.22, 0, 1);
    const out = clamp(1 - (this.revealT - 2.4) / 0.7, 0, 1);
    return inn * out;
  }

  /** How hard it's still fighting — drives the squirm and the tail thrash. */
  get struggle() {
    if (!this.caught) return 0;
    return this.revealT < 0.5 ? 1 : clamp(1 - (this.revealT - 0.5) / 1.2, 0, 1);
  }

  get dead() {
    return this.caught && this.revealT > 3.1;
  }

  update(
    dt: number,
    w: number,
    h: number,
    threats: { x: number; y: number; r: number }[],
    tune: { speedScale: number; freezeScale: number; fleeRadius: number },
  ) {
    this.stateT += dt;
    this.stun = damp(this.stun, 0, 0.2, dt);

    // Once pinned it stops hunting and plays out the capture.
    if (this.caught) {
      this.revealT += dt;
      this.whip += dt * 14 * this.struggle;
      this.updateTail(dt);
      return;
    }

    for (const t of threats) {
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (
        d < (t.r + this.size + 40) * tune.fleeRadius &&
        this.state !== "flee" &&
        this.state !== "stunned"
      ) {
        this.spook(t.x, t.y);
      }
    }

    switch (this.state) {
      case "roam": {
        this.targetA += gauss(0, 1.9) * dt;
        if (this.stateT > this.burstLen) {
          this.stateT = 0;
          this.burstLen = levyStep(0.36, 5);
          this.targetA += gauss(0, 1.0);
          this.targetV = this.speed * rand(1.4, 0.55);
          // Freezing under the sheet is the money moment: a still lump that a
          // cat can line up on and commit to.
          if (chance(0.4)) {
            this.state = "freeze";
            this.stateT = 0;
            this.freezeLen = rand(2.4, 0.7) * tune.freezeScale;
            this.targetV = 0;
          } else if (chance(0.16)) {
            // Occasional flat-out dash straight across the sheet.
            this.state = "flee";
            this.stateT = 0;
            this.v = this.speed * 2.6;
          }
        }
        this.targetV = Math.max(this.targetV, this.speed * 0.3);
        break;
      }
      case "freeze": {
        this.targetV = 0;
        // Never perfectly still — a tiny shift keeps it alive-looking.
        if (chance(dt * 1.6)) this.targetA += gauss(0, 0.6);
        if (this.stateT > this.freezeLen) {
          this.state = "roam";
          this.stateT = 0;
          this.targetV = this.speed;
        }
        break;
      }
      case "flee": {
        this.targetV = this.speed * 2.7;
        this.targetA += gauss(0, 2.6) * dt;
        if (this.stateT > rand(1.1, 0.5)) {
          this.state = "freeze";
          this.stateT = 0;
          this.freezeLen = rand(1.5, 0.4) * tune.freezeScale;
          this.targetV = 0;
        }
        break;
      }
      case "stunned": {
        this.targetV = 0;
        this.v = 0;
        if (this.stateT > 0.8) {
          this.state = "flee";
          this.stateT = 0;
          this.v = this.speed * 3.2;
        }
        break;
      }
    }

    this.v = damp(this.v, this.targetV, 0.11, dt);
    this.a = angleLerp(this.a, this.targetA, 1 - Math.pow(0.001, dt));
    const sp = this.v * tune.speedScale;
    this.x += Math.cos(this.a) * sp * dt;
    this.y += Math.sin(this.a) * sp * dt;

    // The sheet is tucked in at the edges, so the critter turns back rather
    // than escaping. Nothing ever leaves the field of play.
    const m = this.size + 26;
    if (this.x < m || this.x > w - m || this.y < m || this.y > h - m) {
      this.x = clamp(this.x, m, w - m);
      this.y = clamp(this.y, m, h - m);
      this.targetA = Math.atan2(h / 2 - this.y, w / 2 - this.x) + gauss(0, 0.7);
      this.a = angleLerp(this.a, this.targetA, 0.4);
    }

    this.updateTail(dt);
  }

  private updateTail(dt: number) {
    this.whip += dt * (4 + this.v * 0.03);
    const seg = this.size * 0.36;
    // The tail emerges from behind the body and trails on top of the cloth.
    const bx = this.x - Math.cos(this.a) * this.size * 0.55;
    const by = this.y - Math.sin(this.a) * this.size * 0.55;
    this.tail[0].x = damp(this.tail[0].x, bx, 0.03, dt);
    this.tail[0].y = damp(this.tail[0].y, by, 0.03, dt);

    // Each joint may only bend so far relative to the one before it. Without
    // this the whip term can fold a segment back on itself and the tail ties
    // itself into a knot.
    const MAX_BEND = 0.5;
    let prevDir = this.a + Math.PI;
    for (let i = 1; i < this.tail.length; i++) {
      const p = this.tail[i - 1];
      const s = this.tail[i];
      const dx = s.x - p.x;
      const dy = s.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      // Lateral whip, applied perpendicular to the segment so the tail flicks
      // instead of merely trailing.
      const t = i / this.tail.length;
      const amp =
        (this.caught
          ? 34 * this.struggle
          : this.state === "stunned"
            ? 22
            : 5 + this.v * 0.045) * t;
      const wob = Math.sin(this.whip - i * 0.75) * amp * dt * 12;
      let dir = Math.atan2(uy * seg + ux * wob, ux * seg - uy * wob);
      let bend = ((dir - prevDir + Math.PI) % TAU) - Math.PI;
      if (bend < -Math.PI) bend += TAU;
      dir = prevDir + clamp(bend, -MAX_BEND, MAX_BEND);
      s.x = p.x + Math.cos(dir) * seg;
      s.y = p.y + Math.sin(dir) * seg;
      prevDir = dir;
    }
  }

  /** Closest distance from a point to the tail, for hit tests. */
  tailDistance(x: number, y: number) {
    let best = Infinity;
    for (let i = 1; i < this.tail.length; i++) {
      const a = this.tail[i - 1];
      const b = this.tail[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = dx * dx + dy * dy || 1;
      const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / len, 0, 1);
      best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
    }
    return best;
  }
}

interface PressPoint {
  x: number;
  y: number;
  r: number;
  t: number;
}

class UnderSheet implements GameInstance {
  private host: GameHost;
  private w: number;
  private h: number;
  private cloth: Cloth;
  private fabric: Fabric;
  private critters: Critter[] = [];
  private threats: { x: number; y: number; r: number }[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private presses: PressPoint[] = [];
  private idleT = 0;
  private respawnT = 0;
  private rustleT = 0;
  private timeScale = 1;
  private streak = 0;
  /** Pale colour for the tail, chosen to contrast whatever fabric we rolled. */
  private tailColor: string;
  private tailDark: string;

  constructor(host: GameHost) {
    this.host = host;
    this.w = host.width;
    this.h = host.height;
    this.fabric = pick(FABRICS);
    this.cloth = new Cloth(this.w, this.h, this.fabric);

    // Warm fabric gets a cool tail and vice versa, so the tail never
    // disappears into the sheet.
    const [r, , b] = this.fabric.rgb;
    const warm = r > b;
    this.tailColor = warm ? "hsl(205 70% 78%)" : "hsl(42 85% 74%)";
    this.tailDark = warm ? "hsl(205 55% 46%)" : "hsl(38 60% 44%)";

    for (let i = 0; i < this.population(); i++) this.spawn();
  }

  private get tuning() {
    const t = styleTuning(this.host.profile.style);
    const skill = this.host.profile.skill;
    return {
      speedScale: t.speed * (0.7 + skill * 0.6),
      freezeScale: t.freeze * (1.3 - skill * 0.45),
      fleeRadius: t.fleeRadius * (0.55 + skill * 0.7),
      density: t.density,
    };
  }

  private population() {
    // Deliberately sparse. This game is about one lump you're locked onto,
    // not a field of targets — that focus is the whole point of it.
    return this.host.profile.style === "pouncer" ? 2 : 1;
  }

  private spawn(big = false) {
    const m = 90;
    this.critters.push(
      new Critter(rand(this.w - m, m), rand(this.h - m, m), big),
    );
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.cloth.resize(w, h);
    for (const c of this.critters) {
      c.x = clamp(c.x, 60, w - 60);
      c.y = clamp(c.y, 60, h - 60);
    }
  }

  paw(e: PawEvent) {
    this.idleT = 0;
    const pan = (e.x / this.w) * 2 - 1;
    const reach = Math.max(e.r, 30) + 8;

    if (e.phase === "up") {
      this.pointers.delete(e.id);
      this.syncThreats();
      return;
    }
    this.pointers.set(e.id, { x: e.x, y: e.y });
    this.syncThreats();

    if (e.phase === "move") {
      // A paw dragged across the sheet keeps denting it and throwing off
      // ripples. Cats will play with just this, before they notice the lump.
      const sp = Math.hypot(e.vx, e.vy);
      this.cloth.poke(e.x, e.y, -110 - Math.min(sp * 0.36, 240), reach * 1.5);
      if (sp > 260 && this.rustleT <= 0) {
        this.rustleT = 0.12;
        sfx.rustle(pan, clamp(sp / 900, 0.3, 1));
      }
      return;
    }

    // --- A strike ---------------------------------------------------------
    this.host.report({ type: "engage" });
    this.cloth.poke(e.x, e.y, -1150, reach * 1.9);
    this.presses.push({ x: e.x, y: e.y, r: reach, t: 0 });
    sfx.thump(pan, 0.6 + e.force * 0.6);

    let caught: Critter | null = null;
    let viaTail = false;
    let bestD = Infinity;
    for (const c of this.critters) {
      if (c.caught) continue;
      const dBody = Math.hypot(c.x - e.x, c.y - e.y);
      const dTail = c.tailDistance(e.x, e.y);
      // Pinning the body is the real catch; the tail is a wider, easier target
      // that still pays out. Two difficulty tiers on the same animal.
      const bodyHit = dBody < reach + c.size * 0.75;
      const tailHit = dTail < reach + 10;
      if (bodyHit && dBody < bestD) {
        bestD = dBody;
        caught = c;
        viaTail = false;
      } else if (tailHit && !caught) {
        caught = c;
        viaTail = true;
      }
    }

    if (caught) {
      this.onCatch(caught, viaTail, e.x, e.y, pan);
      return;
    }

    this.streak = 0;
    this.host.report({ type: "miss" });
    let spooked = false;
    for (const c of this.critters) {
      if (c.caught) continue;
      if (Math.hypot(c.x - e.x, c.y - e.y) < reach * 3.4) {
        c.spook(e.x, e.y);
        spooked = true;
      }
    }
    if (spooked) {
      this.host.report({ type: "near-miss" });
      sfx.rustle(pan, 1);
    }
  }

  private syncThreats() {
    this.threats = [...this.pointers.values()].map((p) => ({
      x: p.x,
      y: p.y,
      r: 26,
    }));
  }

  private onCatch(
    c: Critter,
    viaTail: boolean,
    x: number,
    y: number,
    pan: number,
  ) {
    if (viaTail) {
      // Caught it by the tail: it squirms loose and bolts. A partial win, and
      // the cat still visibly made something happen.
      c.graze(x, y);
      this.host.report({ type: "hit", value: 1 });
      sfx.squeak(pan, true);
      sfx.rustle(pan, 1);
      this.cloth.poke(c.x, c.y, 1100, c.size * 2.2);
      this.timeScale = 0.55;
      return;
    }
    if (!c.pin(x, y)) return;
    this.streak++;
    this.host.report({ type: "hit", value: 3 });
    sfx.squeak(pan, false);
    sfx.rustle(pan, 1);
    sfx.thump(pan, 1);
    // The whole sheet jumps, then slides off it.
    this.cloth.poke(c.x, c.y, 1600, c.size * 2.6);
    this.timeScale = 0.3;
  }

  update(dt: number) {
    this.timeScale = damp(this.timeScale, 1, 0.2, dt);
    const sdt = Math.min(dt * this.timeScale, 0.05);
    this.idleT += dt;
    this.rustleT -= dt;

    const tune = this.tuning;
    for (const c of this.critters) {
      c.update(sdt, this.w, this.h, this.threats, tune);
      // A fast body still nudges the surrounding cloth, but only enough to
      // suggest disturbance — not enough to trail a wake.
      if (c.v > 90) {
        this.cloth.poke(
          c.x + Math.cos(c.a) * c.size * 1.3,
          c.y + Math.sin(c.a) * c.size * 1.3,
          c.v * 0.04 * sdt * 60,
          c.size,
        );
      }
    }

    // Sustained paw pressure keeps the dent while the paw rests on the glass.
    for (const t of this.threats) this.cloth.poke(t.x, t.y, -155 * dt * 60, 46);

    this.cloth.update(dt);

    for (const p of this.presses) p.t += dt;
    this.presses = this.presses.filter((p) => p.t < 0.45);

    // Muffled scurrying, panned to the lump.
    if (this.rustleT <= 0 && sfx.audioReady()) {
      let fastest: Critter | null = null;
      let bv = 0;
      for (const c of this.critters) {
        if (c.caught) continue;
        if (c.v > bv) {
          bv = c.v;
          fastest = c;
        }
      }
      if (fastest && bv > 55) {
        this.rustleT = rand(0.35, 0.14);
        sfx.rustle((fastest.x / this.w) * 2 - 1, clamp(bv / 380, 0.25, 0.9));
      }
    }

    // Re-hook: send the lump across the middle once, with a squeak.
    if (this.idleT > 11) {
      this.idleT = rand(6, 3);
      const live = this.critters.filter((x) => !x.caught);
      const c = live[randInt(live.length)];
      if (c) {
        c.state = "flee";
        c.stateT = 0;
        c.targetA = Math.atan2(this.h / 2 - c.y, this.w / 2 - c.x);
        c.a = c.targetA;
        c.v = c.speed * 2.8;
        sfx.squeak((c.x / this.w) * 2 - 1, true);
      }
    }

    // Clear finished captures, then let the sheet sit empty for a beat before
    // the next one arrives. The pause is what makes a catch feel like it
    // actually ended something.
    const before = this.critters.length;
    this.critters = this.critters.filter((c) => !c.dead);
    if (this.critters.length < before) this.respawnT = rand(2.4, 1.2);

    if (this.respawnT > 0) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        // After a good run, what comes back is bigger.
        this.spawn(this.streak >= 3 && chance(0.4));
        if (this.streak >= 3) this.streak = 0;
      }
    } else if (this.critters.filter((c) => !c.caught).length < this.population()) {
      this.respawnT = rand(2.2, 1.0);
    }
  }

  private domes(): Dome[] {
    return this.critters.map((c) => ({
      x: c.x,
      y: c.y,
      rx: c.size * 1.25,
      ry: c.size * 0.85,
      a: c.a,
      amp: c.domeAmp,
    }));
  }

  render(g: CanvasRenderingContext2D) {
    this.cloth.render(g, this.domes());

    // Tails ride on top of the sheet, and so does anything we've uncovered.
    for (const c of this.critters) this.drawTail(g, c);
    for (const c of this.critters) {
      if (c.revealAlpha > 0.01) this.drawRevealed(g, c);
    }

    // Paw press feedback.
    for (const p of this.presses) {
      const t = p.t / 0.45;
      g.globalAlpha = (1 - t) * 0.5;
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x, p.y, p.r * (0.6 + t * 1.6), 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /**
   * The payoff. For the whole hunt the cat only ever sees a lump, so actually
   * uncovering the animal is the reward — and because its proportions and
   * colour are generated per critter, it's a different one every time.
   */
  private drawRevealed(g: CanvasRenderingContext2D, c: Critter) {
    const alpha = c.revealAlpha;
    const st = c.struggle;
    const L = c.size * 1.15;
    const W = c.size * 0.78 * c.plump;
    const body = `hsl(${c.hue} 42% 66%)`;
    const dark = `hsl(${c.hue} 38% 40%)`;
    const belly = `hsl(${c.hue} 35% 82%)`;

    g.save();
    g.globalAlpha = alpha;
    g.translate(c.x, c.y);
    // Thrashing while it still has fight in it, then it goes limp.
    g.rotate(c.a + Math.sin(c.revealT * 21) * 0.26 * st);
    // A slump as the struggle dies out.
    g.scale(1, 1 - (1 - st) * 0.12);

    // Shadow on the cloth.
    g.save();
    g.translate(4, 7);
    g.fillStyle = "rgba(0,0,0,0.42)";
    g.filter = "blur(6px)";
    g.beginPath();
    g.ellipse(0, 0, L * 0.55, W * 0.5, 0, 0, TAU);
    g.fill();
    g.restore();

    // Legs, kicking in opposed pairs while it fights.
    g.strokeStyle = dark;
    g.lineCap = "round";
    g.lineWidth = Math.max(2, c.size * 0.075);
    for (let i = 0; i < 4; i++) {
      const fore = i < 2 ? 1 : -1;
      const side = i % 2 === 0 ? 1 : -1;
      const kick = Math.sin(c.revealT * 24 + i * 1.9) * 0.5 * st;
      const bx = fore * L * 0.26;
      const by = side * W * 0.36;
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(
        bx + fore * L * 0.2 + kick * 10,
        by + side * (W * 0.42 + Math.abs(kick) * 12),
      );
      g.stroke();
    }

    // Body, then a lighter belly to give it some roundness.
    const grad = g.createLinearGradient(0, -W * 0.6, 0, W * 0.6);
    grad.addColorStop(0, belly);
    grad.addColorStop(0.5, body);
    grad.addColorStop(1, dark);
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(-L * 0.08, 0, L * 0.52, W * 0.5, 0, 0, TAU);
    g.fill();

    // Head and snout.
    const hx = L * 0.42;
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(hx, 0, L * 0.2 * c.snout, W * 0.32, 0, 0, TAU);
    g.fill();
    g.fillStyle = dark;
    g.beginPath();
    g.arc(hx + L * 0.19 * c.snout, 0, Math.max(1.5, c.size * 0.045), 0, TAU);
    g.fill();

    // Ears — the silhouette detail that makes it read as a small mammal.
    const er = W * 0.24 * c.earScale;
    for (const side of [-1, 1]) {
      const ex = hx - L * 0.16;
      const ey = side * (W * 0.34 + er * 0.5);
      g.fillStyle = dark;
      g.beginPath();
      g.ellipse(ex, ey, er, er * 0.88, side * 0.4, 0, TAU);
      g.fill();
      g.fillStyle = belly;
      g.beginPath();
      g.ellipse(ex, ey, er * 0.5, er * 0.44, side * 0.4, 0, TAU);
      g.fill();
    }

    // Eye. Open while struggling, closed once it goes still.
    g.fillStyle = "rgba(20,20,24,0.9)";
    if (st > 0.25) {
      g.beginPath();
      g.arc(hx, -W * 0.12, Math.max(1.6, c.size * 0.05), 0, TAU);
      g.fill();
    } else {
      g.strokeStyle = "rgba(20,20,24,0.75)";
      g.lineWidth = Math.max(1.4, c.size * 0.032);
      g.beginPath();
      g.moveTo(hx - c.size * 0.05, -W * 0.12);
      g.lineTo(hx + c.size * 0.05, -W * 0.12);
      g.stroke();
    }

    g.restore();
    g.globalAlpha = 1;
  }

  private drawTail(g: CanvasRenderingContext2D, c: Critter) {
    const pts = c.tail;
    if (pts.length < 2) return;

    const stroke = (
      width: number,
      color: string,
      ox = 0,
      oy = 0,
      alpha = 1,
    ) => {
      g.globalAlpha = alpha;
      g.strokeStyle = color;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(pts[0].x + ox, pts[0].y + oy);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        g.quadraticCurveTo(pts[i].x + ox, pts[i].y + oy, mx + ox, my + oy);
      }
      g.stroke();
    };

    // Shadow first — it's what sells the tail as lying *on* the cloth rather
    // than floating over it.
    const w0 = c.size * 0.19;
    stroke(w0 * 1.1, "rgba(0,0,0,0.45)", 3, 5, 0.6);
    stroke(w0, this.tailDark);
    stroke(w0 * 0.55, this.tailColor);

    // Pale tip, the bit that catches the eye when it flicks.
    const tip = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    g.globalAlpha = 1;
    g.strokeStyle = this.tailColor;
    g.lineWidth = w0 * 0.75;
    g.beginPath();
    g.moveTo(prev.x, prev.y);
    g.lineTo(tip.x, tip.y);
    g.stroke();
    g.fillStyle = this.tailColor;
    g.beginPath();
    g.arc(tip.x, tip.y, w0 * 0.42, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
  }
}

export const underSheet: GameModule = {
  id: "under-sheet",
  title: "Under the Sheet",
  tagline:
    "Something is moving under the blanket, and its tail is still sticking out. Pin it and the sheet slides off — the only way to see what it was.",
  suits: ["watcher", "pouncer"],
  backdrop: "#141824",
  accent: "#8fc7ff",
  create: (host) => new UnderSheet(host),
};
