import type { Genome } from "./genome";
import {
  rand,
  chance,
  levyStep,
  clamp,
  damp,
  angleLerp,
  gauss,
  TAU,
} from "@/lib/rng";

export type BugState = "roam" | "freeze" | "flee" | "under" | "dying" | "gone";

export interface Foot {
  /** Planted world position. */
  x: number;
  y: number;
  /** Swing origin + target, used while the leg is in the air. */
  ox: number;
  oy: number;
  tx: number;
  ty: number;
  /** 0..1 swing progress; >= 1 means planted. */
  sw: number;
  /** Per-leg stride threshold, staggered so legs alternate naturally. */
  stride: number;
  side: number;
  index: number;
}

export interface Cover {
  x: number;
  y: number;
  r: number;
  rot: number;
  kind: number;
  /** Per-lobe radius jitter, baked once so the silhouette is stable. */
  lobes: number[];
}

export interface Threat {
  x: number;
  y: number;
  r: number;
}

export interface BugWorld {
  w: number;
  h: number;
  cover: Cover[];
  threats: Threat[];
  /** Speed multiplier from cat profile + adaptive difficulty. */
  speedScale: number;
  freezeScale: number;
  fleeRadius: number;
  peekScale: number;
}

let nextId = 1;

export class Bug {
  id = nextId++;
  g: Genome;
  rare: boolean;
  x: number;
  y: number;
  a: number; // heading
  /** Current speed along heading, px/s. */
  v = 0;
  targetV = 0;
  targetA: number;
  state: BugState = "roam";
  stateT = 0;
  feet: Foot[] = [];
  /** Antenna sweep spring. */
  antA = 0;
  antV = 0;
  /** Body squash on impact / dying. */
  squash = 1;
  /** 0 = fully on the surface, 1 = fully hidden under cover. */
  depth = 0;
  glowPhase = rand(TAU);
  /** Set when a paw lands close but misses — drives the startle flash. */
  startle = 0;
  deathT = 0;
  splatSeed = rand(1000);
  /** How long since this bug was last near a paw; used to bias re-approach. */
  boredom = 0;

  constructor(g: Genome, x: number, y: number, rare = false) {
    this.g = g;
    this.rare = rare;
    this.x = x;
    this.y = y;
    this.a = rand(TAU);
    this.targetA = this.a;
    this.initFeet();
  }

  get scale() {
    return this.g.size;
  }

  /** Body radius used for hit tests and cover checks. */
  get radius() {
    return ((this.g.bodyLen + this.g.bodyW) / 4) * this.scale;
  }

  private initFeet() {
    const { legPairs, legLen, bodyLen, legSpread } = this.g;
    const s = this.scale;
    this.feet = [];
    for (let i = 0; i < legPairs; i++) {
      for (const side of [-1, 1]) {
        const t = legPairs === 1 ? 0.5 : i / (legPairs - 1);
        const ax = (0.32 - t * 0.72) * bodyLen * s;
        const ay = side * this.g.bodyW * 0.45 * s;
        const [wx, wy] = this.toWorld(ax + legLen * s * 0.5 * legSpread, ay * 2);
        this.feet.push({
          x: wx,
          y: wy,
          ox: wx,
          oy: wy,
          tx: wx,
          ty: wy,
          sw: 1,
          // Stagger thresholds: adjacent legs on opposite sides lift at
          // different extensions, which is what produces a tripod-ish gait
          // without hand-authoring one.
          stride: legLen * s * (0.5 + ((i + (side > 0 ? 1 : 0)) % 2) * 0.28),
          side,
          index: i,
        });
      }
    }
  }

  private toWorld(lx: number, ly: number): [number, number] {
    const c = Math.cos(this.a);
    const sn = Math.sin(this.a);
    return [this.x + lx * c - ly * sn, this.y + lx * sn + ly * c];
  }

  /** Local anchor for a leg, in body space. */
  private legAnchor(f: Foot): [number, number] {
    const { legPairs, legLen, bodyLen, bodyW, legSpread } = this.g;
    const s = this.scale;
    const t = legPairs === 1 ? 0.5 : f.index / (legPairs - 1);
    const lx = (0.34 - t * 0.78) * bodyLen * s + legLen * s * 0.45;
    const ly = f.side * (bodyW * 0.4 + legLen * 0.62 * legSpread) * s;
    return this.toWorld(lx, ly);
  }

  private updateFeet(dt: number) {
    const swingTime = clamp(0.16 - this.v * 0.00022, 0.045, 0.16);
    for (const f of this.feet) {
      if (f.sw < 1) {
        f.sw = Math.min(1, f.sw + dt / swingTime);
        const e = f.sw * f.sw * (3 - 2 * f.sw);
        f.x = f.ox + (f.tx - f.ox) * e;
        f.y = f.oy + (f.ty - f.oy) * e;
        continue;
      }
      const [ax, ay] = this.legAnchor(f);
      const dx = ax - f.x;
      const dy = ay - f.y;
      if (dx * dx + dy * dy > f.stride * f.stride) {
        // Re-plant slightly ahead of the anchor so the leg has room to pull.
        const lead = Math.min(this.v * 0.06, f.stride * 0.8);
        f.ox = f.x;
        f.oy = f.y;
        f.tx = ax + Math.cos(this.a) * lead;
        f.ty = ay + Math.sin(this.a) * lead;
        f.sw = 0;
      }
    }
  }

  /** True while any leg is off the ground — used for the skitter sound. */
  get striding() {
    return this.feet.some((f) => f.sw < 1);
  }

  private nearestCover(world: BugWorld): Cover | null {
    let best: Cover | null = null;
    let bd = Infinity;
    for (const c of world.cover) {
      const d = (c.x - this.x) ** 2 + (c.y - this.y) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  private insideCover(world: BugWorld) {
    for (const c of world.cover) {
      const d = Math.hypot(c.x - this.x, c.y - this.y);
      if (d < c.r * 0.85) return c;
    }
    return null;
  }

  kill() {
    if (this.state === "dying" || this.state === "gone") return false;
    this.state = "dying";
    this.stateT = 0;
    this.deathT = 0;
    this.squash = 0.45;
    this.v = 0;
    return true;
  }

  /** A paw landed nearby but missed. Startle, then bolt. */
  spook(fromX: number, fromY: number, hard = true) {
    if (this.state === "dying" || this.state === "gone") return;
    this.startle = 1;
    this.a = Math.atan2(this.y - fromY, this.x - fromX) + gauss(0, 0.4);
    this.targetA = this.a;
    this.state = "flee";
    this.stateT = 0;
    this.v = this.cruise * (hard ? 3.4 : 2.2);
    this.antV += rand(14, -14);
  }

  get cruise() {
    return 62 * this.g.speed * this.scale;
  }

  update(dt: number, world: BugWorld) {
    this.stateT += dt;
    this.boredom += dt;
    this.startle = damp(this.startle, 0, 0.12, dt);
    this.glowPhase += dt * 1.6;

    if (this.state === "gone") return;

    if (this.state === "dying") {
      this.deathT += dt;
      this.squash = damp(this.squash, 1, 0.18, dt);
      // Legs curl inward.
      for (const f of this.feet) {
        f.x = damp(f.x, this.x, 0.25, dt);
        f.y = damp(f.y, this.y, 0.25, dt);
      }
      if (this.deathT > 2.6) this.state = "gone";
      return;
    }

    // --- Threat response ------------------------------------------------
    let nearestThreat = Infinity;
    for (const t of world.threats) {
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      nearestThreat = Math.min(nearestThreat, d);
      const react = (t.r + this.radius + 46) * world.fleeRadius;
      if (d < react && this.state !== "flee") {
        this.spook(t.x, t.y, d < react * 0.6);
      }
    }
    if (nearestThreat < 220) this.boredom = 0;

    switch (this.state) {
      case "roam":
        this.roam(dt, world);
        break;
      case "freeze":
        this.freeze(dt, world);
        break;
      case "flee":
        this.flee(dt, world);
        break;
      case "under":
        this.under(dt, world);
        break;
    }

    // --- Integrate -------------------------------------------------------
    this.v = damp(this.v, this.targetV, 0.09, dt);
    this.a = angleLerp(this.a, this.targetA, 1 - Math.pow(0.0008, dt));
    const sp = this.v * world.speedScale;
    this.x += Math.cos(this.a) * sp * dt;
    this.y += Math.sin(this.a) * sp * dt;

    this.bounds(world);
    this.updateFeet(dt);
    this.updateAntennae(dt);
    this.squash = damp(this.squash, 1, 0.1, dt);

    // Depth follows whether we're actually inside a cover patch.
    const inside = this.insideCover(world);
    const wantDepth = this.state === "under" && inside ? 1 : 0;
    this.depth = damp(this.depth, wantDepth, 0.09, dt);
  }

  private updateAntennae(dt: number) {
    // Loose spring driven by turn rate and speed — antennae lag the body and
    // sweep when the bug stops, which is a strong "this is alive" cue.
    const drive =
      this.state === "freeze"
        ? Math.sin(this.stateT * 5.5) * 0.55
        : -Math.sin(this.stateT * 13) * 0.18 * (this.v / (this.cruise + 1));
    const k = 55;
    this.antV += (drive - this.antA) * k * dt;
    this.antV *= Math.pow(0.02, dt);
    this.antA += this.antV * dt;
    this.antA = clamp(this.antA, -1.1, 1.1);
  }

  private bounds(world: BugWorld) {
    const m = this.radius + 6;
    let hit = false;
    if (this.x < m) {
      this.x = m;
      hit = true;
    }
    if (this.x > world.w - m) {
      this.x = world.w - m;
      hit = true;
    }
    if (this.y < m) {
      this.y = m;
      hit = true;
    }
    if (this.y > world.h - m) {
      this.y = world.h - m;
      hit = true;
    }
    if (hit) {
      // Turn along the wall rather than bouncing off it like a screensaver.
      const toCenter = Math.atan2(world.h / 2 - this.y, world.w / 2 - this.x);
      this.targetA = toCenter + gauss(0, 0.9);
      this.a = angleLerp(this.a, this.targetA, 0.35);
    }
  }

  private roam(dt: number, world: BugWorld) {
    // Levy bursts: mostly short scoots, occasionally a long dash. Heading
    // wanders continuously so nothing ever travels in a straight line.
    this.targetA += gauss(0, this.g.jitter * 2.4) * dt;

    if (this.stateT > this.burstLen) {
      this.stateT = 0;
      this.burstLen = levyStep(0.32, 6) * this.g.burst;
      this.targetA += gauss(0, 1.1);
      this.targetV = this.cruise * rand(1.5, 0.5);

      // Decide whether to stop dead. Freezing is the single most important
      // behaviour here: a frozen bug is what a cat commits to pouncing on.
      const freezeChance = 0.42 * this.g.freezeBias;
      if (chance(freezeChance)) {
        this.state = "freeze";
        this.stateT = 0;
        this.freezeLen =
          rand(2.2, 0.5) * this.g.freezeBias * world.freezeScale;
        this.targetV = 0;
        return;
      }
      // Or duck under cover, then peek back out. Prey that disappears behind
      // something and re-emerges holds attention far longer than prey in the
      // open — it's the core of how a wand toy actually works.
      if (chance(0.16 * this.g.shy * world.peekScale)) {
        const c = this.nearestCover(world);
        if (c && Math.hypot(c.x - this.x, c.y - this.y) < 340) {
          this.targetA = Math.atan2(c.y - this.y, c.x - this.x);
          this.state = "under";
          this.stateT = 0;
          this.underLen = rand(2.4, 0.7) * world.peekScale;
          this.targetV = this.cruise * 1.3;
          return;
        }
      }
    }
    this.targetV = Math.max(this.targetV, this.cruise * 0.25);
  }
  private burstLen = rand(0.5, 0.15);
  private freezeLen = 1;
  private underLen = 1;

  private freeze(dt: number, world: BugWorld) {
    this.targetV = 0;
    // Tiny twitches while frozen — the bug is never perfectly static.
    if (chance(dt * 1.4)) {
      this.targetA += gauss(0, 0.5);
      this.squash = 0.93;
    }
    if (this.stateT > this.freezeLen) {
      this.state = "roam";
      this.stateT = 0;
      this.burstLen = levyStep(0.3, 6) * this.g.burst;
      this.targetV = this.cruise * rand(2, 0.9);
      void world;
    }
  }

  private flee(dt: number, world: BugWorld) {
    this.targetV = this.cruise * 2.6;
    this.targetA += gauss(0, 3.5) * dt;
    if (this.stateT > rand(0.9, 0.45)) {
      // After bolting, freeze — the classic prey response, and it hands the
      // cat a second chance rather than an endlessly fleeing target.
      this.state = chance(0.65) ? "freeze" : "roam";
      this.stateT = 0;
      this.freezeLen = rand(1.4, 0.35) * world.freezeScale;
      this.targetV = 0;
    }
  }

  private under(dt: number, world: BugWorld) {
    const c = this.insideCover(world);
    if (c) {
      // Wander under the leaf as a moving bump.
      this.targetV = this.cruise * 0.75;
      this.targetA += gauss(0, 2.2) * dt;
      const d = Math.hypot(c.x - this.x, c.y - this.y);
      if (d > c.r * 0.72) this.targetA = Math.atan2(c.y - this.y, c.x - this.x);
    } else {
      this.targetV = this.cruise * 1.2;
    }
    if (this.stateT > this.underLen) {
      // Burst back into the open — the payoff for waiting.
      this.state = "flee";
      this.stateT = 0;
      this.v = this.cruise * 2.4;
      if (c) this.targetA = Math.atan2(this.y - c.y, this.x - c.x);
    }
  }
}
