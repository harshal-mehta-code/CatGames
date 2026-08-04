import type { GameModule, GameHost, GameInstance, PawEvent } from "@/lib/types";
import { styleTuning } from "@/lib/profiles";
import { rand, randInt, chance, clamp, TAU, damp } from "@/lib/rng";
import * as sfx from "@/lib/audio";
import { Bug, type Cover, type BugWorld } from "./bug";
import { makeSpeciesSet, type Genome } from "./genome";
import {
  BIOMES,
  drawBug,
  drawBump,
  drawCover,
  makeSubstrate,
  pickBiome,
  type Biome,
} from "./draw";

interface Splat {
  x: number;
  y: number;
  r: number;
  hue: number;
  t: number;
  blobs: { dx: number; dy: number; r: number }[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  t: number;
  life: number;
  hue: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  t: number;
  hit: boolean;
}

const MIN_BUGS = 2;

class BugHunt implements GameInstance {
  private host: GameHost;
  private w: number;
  private h: number;
  private biome: Biome;
  private substrate: HTMLCanvasElement | null = null;
  private cover: Cover[] = [];
  private bugs: Bug[] = [];
  private splats: Splat[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private species: { common: Genome[]; rare: Genome };
  private threats: { x: number; y: number; r: number }[] = [];
  private pointers = new Map<number, { x: number; y: number }>();

  private skitterTimer = 0;
  private idleT = 0;
  private spawnTimer = 0;
  /** Slow-motion after a catch, so the cat sees it happen. */
  private timeScale = 1;
  private hits = 0;
  private attempts = 0;
  private streak = 0;

  constructor(host: GameHost) {
    this.host = host;
    this.w = host.width;
    this.h = host.height;
    this.biome = pickBiome();
    this.species = makeSpeciesSet();
    this.buildScene();
  }

  private get tuning() {
    const t = styleTuning(this.host.profile.style);
    const skill = this.host.profile.skill;
    // Skill scales prey difficulty, but only within a band — we never want a
    // hunt that has become genuinely uncatchable.
    return {
      speedScale: t.speed * (0.72 + skill * 0.62),
      freezeScale: t.freeze * (1.35 - skill * 0.5),
      fleeRadius: t.fleeRadius * (0.6 + skill * 0.7),
      peekScale: t.peek,
      density: t.density,
    };
  }

  private get world(): BugWorld {
    const t = this.tuning;
    return {
      w: this.w,
      h: this.h,
      cover: this.cover,
      threats: this.threats,
      speedScale: t.speedScale,
      freezeScale: t.freezeScale,
      fleeRadius: t.fleeRadius,
      peekScale: t.peekScale,
    };
  }

  private targetPopulation() {
    const area = (this.w * this.h) / (1024 * 768);
    return clamp(
      Math.round((2.4 + area * 1.9) * this.tuning.density),
      MIN_BUGS,
      9,
    );
  }

  private buildScene() {
    this.substrate = makeSubstrate(this.w, this.h, this.host.dpr, this.biome);
    this.cover = [];
    const n = randInt(6, 3);
    for (let i = 0; i < n; i++) {
      const r = rand(Math.min(this.w, this.h) * 0.17, 60);
      const lobeCount = randInt(9, 6);
      this.cover.push({
        x: rand(this.w - r * 1.2, r * 1.2),
        y: rand(this.h - r * 1.2, r * 1.2),
        r,
        rot: rand(TAU),
        kind: randInt(3),
        lobes: Array.from({ length: lobeCount }, () => rand(1.1, 0.82)),
      });
    }
    this.bugs = [];
    for (let i = 0; i < this.targetPopulation(); i++) this.spawn();
  }

  private spawn(rare = false) {
    const g = rare
      ? this.species.rare
      : this.species.common[randInt(this.species.common.length)];
    // Spawn from under cover where possible — bugs should appear from
    // somewhere, not blink into existence in open ground.
    const c = this.cover.length
      ? this.cover[randInt(this.cover.length)]
      : null;
    const x = c ? c.x + rand(c.r * 0.6, -c.r * 0.6) : rand(this.w);
    const y = c ? c.y + rand(c.r * 0.5, -c.r * 0.5) : rand(this.h);
    const b = new Bug(g, clamp(x, 30, this.w - 30), clamp(y, 30, this.h - 30), rare);
    this.bugs.push(b);
    return b;
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.substrate = makeSubstrate(w, h, this.host.dpr, this.biome);
    for (const c of this.cover) {
      c.x = clamp(c.x, c.r, w - c.r);
      c.y = clamp(c.y, c.r, h - c.r);
    }
    for (const b of this.bugs) {
      b.x = clamp(b.x, 20, w - 20);
      b.y = clamp(b.y, 20, h - 20);
    }
  }

  paw(e: PawEvent) {
    this.idleT = 0;
    const pan = (e.x / this.w) * 2 - 1;

    if (e.phase === "up") {
      this.pointers.delete(e.id);
      this.threats = [...this.pointers.values()].map((p) => ({
        x: p.x,
        y: p.y,
        r: 26,
      }));
      return;
    }

    this.pointers.set(e.id, { x: e.x, y: e.y });
    this.threats = [...this.pointers.values()].map((p) => ({
      x: p.x,
      y: p.y,
      r: 26,
    }));

    if (e.phase !== "down") return;

    // A real paw pad covers a lot of glass. Use the reported contact radius
    // where iPadOS gives us one, with a generous floor — being stingy here is
    // what makes these games feel unfair to an animal that can't aim at pixels.
    const reach = Math.max(e.r, 30) + 8;
    this.host.report({ type: "engage" });
    this.attempts++;
    sfx.thump(pan, 0.6 + e.force * 0.6);

    let caught: Bug | null = null;
    let bestD = Infinity;
    for (const b of this.bugs) {
      if (b.state === "dying" || b.state === "gone") continue;
      const d = Math.hypot(b.x - e.x, b.y - e.y);
      // Hidden bugs are harder to hit but not impossible — swatting the bump
      // under the leaf has to work, or the cover mechanic teaches helplessness.
      const tolerance = reach + b.radius * (b.depth > 0.5 ? 0.5 : 1);
      if (d < tolerance && d < bestD) {
        bestD = d;
        caught = b;
      }
    }

    if (caught) {
      this.onCatch(caught, pan);
      this.rings.push({ x: e.x, y: e.y, r: reach, t: 0, hit: true });
      return;
    }

    this.rings.push({ x: e.x, y: e.y, r: reach, t: 0, hit: false });
    this.streak = 0;
    this.host.report({ type: "miss" });

    // Near miss: everything close by bolts. This is the compensation for a
    // failed strike — the cat still visibly caused something to happen, which
    // is precisely what a laser pointer never provides.
    let spooked = false;
    for (const b of this.bugs) {
      const d = Math.hypot(b.x - e.x, b.y - e.y);
      if (d < reach * 3.2) {
        b.spook(e.x, e.y, d < reach * 1.8);
        spooked = true;
      }
    }
    if (spooked) {
      this.host.report({ type: "near-miss" });
      sfx.skitter(pan, 1, 0.3);
    }
  }

  private onCatch(b: Bug, pan: number) {
    if (!b.kill()) return;
    this.hits++;
    this.streak++;
    this.host.report({ type: "hit", value: b.rare ? 3 : 1 });
    sfx.crunch(pan);
    sfx.squeak(pan, false);
    // Brief slow-motion so the catch is legible rather than instantaneous.
    this.timeScale = b.rare ? 0.25 : 0.45;

    this.splats.push({
      x: b.x,
      y: b.y,
      r: b.radius * rand(1.5, 1.0),
      hue: b.g.hue,
      t: 0,
      blobs: Array.from({ length: randInt(6, 3) }, () => ({
        dx: rand(1, -1),
        dy: rand(1, -1),
        r: rand(0.55, 0.15),
      })),
    });

    const n = b.rare ? 26 : 14;
    for (let i = 0; i < n; i++) {
      const a = rand(TAU);
      const sp = rand(320, 60) * (b.rare ? 1.4 : 1);
      this.particles.push({
        x: b.x,
        y: b.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: rand(4, 1.2),
        t: 0,
        life: rand(0.9, 0.35),
        hue: chance(0.6) ? b.g.hue : b.g.patternHue,
      });
    }
  }

  update(dt: number) {
    // Ease back out of the catch slow-motion.
    this.timeScale = damp(this.timeScale, 1, 0.18, dt);
    const sdt = Math.min(dt * this.timeScale, 0.05);
    this.idleT += dt;

    const world = this.world;
    for (const b of this.bugs) b.update(sdt, world);
    this.bugs = this.bugs.filter((b) => b.state !== "gone");

    // Repopulate on a delay so catches feel consequential rather than
    // instantly undone.
    this.spawnTimer -= dt;
    const want = this.targetPopulation();
    if (this.bugs.length < want && this.spawnTimer <= 0) {
      this.spawnTimer = rand(2.6, 0.9);
      // Occasionally send in the trophy bug after a good run.
      this.spawn(this.streak >= 3 && chance(0.25));
    }

    // --- Skitter audio, throttled and panned ------------------------------
    this.skitterTimer -= dt;
    if (this.skitterTimer <= 0 && sfx.audioReady()) {
      this.skitterTimer = rand(0.4, 0.13);
      let loudest: Bug | null = null;
      let bv = 0;
      for (const b of this.bugs) {
        if (b.state === "dying" || !b.striding) continue;
        const v = b.v * (1 - b.depth);
        if (v > bv) {
          bv = v;
          loudest = b;
        }
      }
      if (loudest && bv > 25) {
        const pan = (loudest.x / this.w) * 2 - 1;
        if (loudest.depth > 0.4) sfx.rustle(pan, 0.9);
        else sfx.skitter(pan, clamp(bv / 260, 0.25, 1), rand(0.3, 0.12));
      }
    }

    // --- Re-hook a disengaged cat ----------------------------------------
    // If nobody has touched the glass for a while, make something happen near
    // the middle of the screen and chirp once. Once — a looping attractor is
    // nagging, and nagging is how you get a cat to leave the room.
    if (this.idleT > 11) {
      this.idleT = rand(6, 3);
      const b = this.bugs[randInt(this.bugs.length)];
      if (b) {
        b.state = "flee";
        b.stateT = 0;
        b.targetA = Math.atan2(this.h / 2 - b.y, this.w / 2 - b.x);
        b.a = b.targetA;
        b.v = b.cruise * 2.4;
        sfx.chirp((b.x / this.w) * 2 - 1);
      }
    }

    // --- Effects ----------------------------------------------------------
    for (const p of this.particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.02, dt);
      p.vy *= Math.pow(0.02, dt);
    }
    this.particles = this.particles.filter((p) => p.t < p.life);

    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < 0.5);

    for (const s of this.splats) s.t += dt;
    this.splats = this.splats.filter((s) => s.t < 26);
    if (this.splats.length > 14) this.splats.shift();
  }

  render(g: CanvasRenderingContext2D) {
    if (this.substrate) {
      g.drawImage(this.substrate, 0, 0, this.w, this.h);
    } else {
      g.fillStyle = this.biome.base;
      g.fillRect(0, 0, this.w, this.h);
    }

    // Splats sit on the ground, under everything else.
    for (const s of this.splats) {
      const a = clamp(1 - (s.t - 16) / 10, 0, 1) * 0.75;
      g.globalAlpha = a;
      g.fillStyle = `hsl(${s.hue} 60% 34%)`;
      for (const bl of s.blobs) {
        g.beginPath();
        g.arc(s.x + bl.dx * s.r, s.y + bl.dy * s.r, s.r * bl.r, 0, TAU);
        g.fill();
      }
      g.beginPath();
      g.arc(s.x, s.y, s.r * 0.5, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;

    // Bugs that are out in the open, then cover, then bumps under the cover.
    for (const b of this.bugs) if (b.depth < 0.98) drawBug(g, b);

    for (const c of this.cover) {
      let lift = 0;
      for (const b of this.bugs) {
        if (b.depth < 0.2) continue;
        if (Math.hypot(b.x - c.x, b.y - c.y) < c.r) lift = Math.max(lift, b.depth);
      }
      drawCover(g, c, this.biome, lift);
    }
    for (const b of this.bugs) if (b.depth > 0.02) drawBump(g, b);

    // Paw feedback rings.
    for (const r of this.rings) {
      const t = r.t / 0.5;
      g.globalAlpha = (1 - t) * 0.75;
      g.strokeStyle = r.hit ? "#ffd479" : "rgba(190,215,255,0.85)";
      g.lineWidth = r.hit ? 4 : 2;
      g.beginPath();
      g.arc(r.x, r.y, r.r * (0.55 + t * 1.5), 0, TAU);
      g.stroke();
      if (r.hit) {
        g.globalAlpha = (1 - t) * 0.35;
        g.beginPath();
        g.arc(r.x, r.y, r.r * (0.3 + t * 0.9), 0, TAU);
        g.stroke();
      }
    }
    g.globalAlpha = 1;

    for (const p of this.particles) {
      const a = 1 - p.t / p.life;
      g.globalAlpha = a;
      g.fillStyle = `hsl(${p.hue} 70% ${45 + a * 25}%)`;
      g.beginPath();
      g.arc(p.x, p.y, p.r * a, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}

export const bugHunt: GameModule = {
  id: "bug-hunt",
  title: "Bug Hunt",
  tagline:
    "Procedurally generated insects that scuttle, freeze, and hide under leaves. New species every session.",
  suits: ["pouncer", "watcher"],
  backdrop: BIOMES[0].base,
  accent: "#ffd479",
  create: (host) => new BugHunt(host),
};
