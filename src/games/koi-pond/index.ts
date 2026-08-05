import type { GameModule, GameHost, GameInstance, PawEvent } from "@/lib/types";
import { styleTuning } from "@/lib/profiles";
import { rand, randInt, chance, clamp, TAU, damp } from "@/lib/rng";
import * as sfx from "@/lib/audio";
import { Fish, drawFish, makeGenome, type Genome, type PondWorld } from "./fish";
import {
  PONDS,
  drawPad,
  drawRipple,
  makeBed,
  makeCausticTile,
  makePads,
  pickPond,
  type Pad,
  type Pond,
  type Ripple,
} from "./water";

interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  t: number;
  life: number;
}

class KoiPond implements GameInstance {
  private host: GameHost;
  private w: number;
  private h: number;
  private pond: Pond;
  private bed: HTMLCanvasElement | null = null;
  private caustic: HTMLCanvasElement | null = null;
  private causticPattern: CanvasPattern | null = null;
  private pads: Pad[] = [];
  private fish: Fish[] = [];
  private species: Genome[] = [];
  private ripples: Ripple[] = [];
  private splashes: Splash[] = [];
  private threats: { x: number; y: number; r: number }[] = [];
  private pointers = new Map<number, { x: number; y: number }>();

  private t = 0;
  private idleT = 0;
  private respawnT = 0;
  private timeScale = 1;

  constructor(host: GameHost) {
    this.host = host;
    this.w = host.width;
    this.h = host.height;
    this.pond = pickPond();
    this.build();
  }

  private get tuning() {
    const t = styleTuning(this.host.profile.style);
    const skill = this.host.profile.skill;
    return {
      speedScale: t.speed * (0.72 + skill * 0.6),
      // A less skilled cat gets fish that linger at the surface much longer.
      surfaceScale: t.freeze * (1.45 - skill * 0.55),
      fleeRadius: t.fleeRadius * (0.55 + skill * 0.75),
      density: t.density,
    };
  }

  private get world(): PondWorld {
    const t = this.tuning;
    return {
      w: this.w,
      h: this.h,
      threats: this.threats,
      pads: this.pads,
      speedScale: t.speedScale,
      surfaceScale: t.surfaceScale,
      fleeRadius: t.fleeRadius,
    };
  }

  private targetPopulation() {
    const area = (this.w * this.h) / (1024 * 768);
    // A school needs numbers to read as a school at all.
    return clamp(Math.round((7 + area * 4) * this.tuning.density), 5, 16);
  }

  private build() {
    this.bed = makeBed(this.w, this.h, this.host.dpr, this.pond);
    this.caustic = makeCausticTile(this.pond);
    this.causticPattern = null;
    this.pads = makePads(this.w, this.h);
    // Two or three species per session, plus one big old koi worth more.
    this.species = Array.from({ length: randInt(4, 2) }, () => makeGenome());
    this.fish = [];
    for (let i = 0; i < this.targetPopulation(); i++) this.spawn();
    this.spawn(true);
  }

  private spawn(big = false) {
    const g = big
      ? makeGenome(true)
      : this.species[randInt(this.species.length)];
    const f = new Fish(
      g,
      rand(this.w * 0.85, this.w * 0.15),
      rand(this.h * 0.85, this.h * 0.15),
      big,
    );
    // Start deep and staggered, so they surface at different times.
    f.z = rand(1, 0.5);
    f.zGoal = f.z;
    f.stateT = rand(6);
    this.fish.push(f);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.bed = makeBed(w, h, this.host.dpr, this.pond);
    this.pads = makePads(w, h);
    for (const f of this.fish) {
      f.x = clamp(f.x, 20, w - 20);
      f.y = clamp(f.y, 20, h - 20);
    }
  }

  private splash(x: number, y: number, n: number, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(TAU);
      const sp = rand(300, 60) * power;
      this.splashes.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: rand(3.5, 1),
        t: 0,
        life: rand(0.7, 0.25),
      });
    }
  }

  paw(e: PawEvent) {
    this.idleT = 0;
    const pan = (e.x / this.w) * 2 - 1;

    if (e.phase === "up") this.pointers.delete(e.id);
    else this.pointers.set(e.id, { x: e.x, y: e.y });
    this.threats = [...this.pointers.values()].map((p) => ({
      x: p.x,
      y: p.y,
      r: 26,
    }));
    if (e.phase !== "down") return;

    const reach = Math.max(e.r, 30) + 8;
    this.host.report({ type: "engage" });
    sfx.thump(pan, 0.5 + e.force * 0.5);
    this.ripples.push({
      x: e.x,
      y: e.y,
      r: reach * 0.5,
      t: 0,
      life: 1.15,
      strength: 0.6 + e.force * 0.6,
    });
    this.splash(e.x, e.y, 7, 0.6);

    // --- A fish at the surface: a real catch -------------------------------
    let target: Fish | null = null;
    let bestD = Infinity;
    for (const f of this.fish) {
      if (!f.catchable || f.hidden(this.world)) continue;
      const d = Math.hypot(f.viewX - e.x, f.viewY - e.y);
      if (d < reach + f.hitRadius && d < bestD) {
        bestD = d;
        target = f;
      }
    }
    if (target && target.pin()) {
      this.host.report({ type: "hit", value: target.big ? 3 : 2 });
      sfx.crunch(pan);
      sfx.squeak(pan, false);
      this.timeScale = target.big ? 0.3 : 0.45;
      this.splash(target.viewX, target.viewY, 24, 1.5);
      this.ripples.push({
        x: target.viewX,
        y: target.viewY,
        r: 20,
        t: 0,
        life: 1.5,
        strength: 1.2,
      });
      // The rest of the shoal sees it happen and bolts.
      for (const f of this.fish) {
        if (f === target || f.caught) continue;
        const d = Math.hypot(f.x - target.x, f.y - target.y);
        if (d < 320) f.scatter(target.x, target.y, d < 170);
      }
      return;
    }

    this.host.report({ type: "miss" });

    // --- A miss still breaks the school apart ------------------------------
    // This is the compensation for a failed strike, and with a shoal it's a
    // far bigger reaction than one animal bolting: the whole formation bursts
    // and then re-forms, all from one swat.
    let scattered = false;
    for (const f of this.fish) {
      if (f.caught) continue;
      const d = Math.hypot(f.viewX - e.x, f.viewY - e.y);
      if (d < reach * 5) {
        f.scatter(e.x, e.y, d < reach * 2.2);
        scattered = true;
      }
    }
    if (scattered) {
      this.host.report({ type: "near-miss" });
      sfx.rustle(pan, 0.6);
    }
  }

  update(dt: number) {
    this.timeScale = damp(this.timeScale, 1, 0.2, dt);
    const sdt = Math.min(dt * this.timeScale, 0.05);
    this.t += sdt;
    this.idleT += dt;

    const world = this.world;
    for (const f of this.fish) f.update(sdt, world, this.fish);

    // A fish breaking the surface dimples the water above it.
    for (const f of this.fish) {
      if (f.caught || f.z > 0.12) continue;
      if (chance(sdt * 1.4)) {
        this.ripples.push({
          x: f.viewX,
          y: f.viewY,
          r: f.g.len * 0.3,
          t: 0,
          life: 1.4,
          strength: 0.32,
        });
      }
    }

    this.fish = this.fish.filter((f) => f.state !== "gone");
    this.respawnT -= dt;
    if (this.fish.length < this.targetPopulation()) {
      if (this.respawnT <= 0) {
        this.respawnT = rand(3.2, 1.6);
        this.spawn();
      }
    } else this.respawnT = rand(3.2, 1.6);

    // --- Re-hook a disengaged cat -----------------------------------------
    if (this.idleT > 11) {
      this.idleT = rand(6, 3);
      // Bring somebody up into the middle rather than chirping into the void.
      const f = this.fish[randInt(this.fish.length)];
      if (f && !f.caught) {
        f.state = "rise";
        f.stateT = 0;
        f.zGoal = 0.05;
        f.a = Math.atan2(this.h / 2 - f.y, this.w / 2 - f.x);
        sfx.chirp((f.x / this.w) * 2 - 1);
      }
    }

    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < r.life);

    for (const s of this.splashes) {
      s.t += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.pow(0.03, dt);
      s.vy *= Math.pow(0.03, dt);
    }
    this.splashes = this.splashes.filter((s) => s.t < s.life);
  }

  render(g: CanvasRenderingContext2D) {
    if (this.bed) g.drawImage(this.bed, 0, 0, this.w, this.h);
    else {
      g.fillStyle = this.pond.deep;
      g.fillRect(0, 0, this.w, this.h);
    }

    // Caustics: two scrolling copies of one tile, blended additively at
    // different scales so no repeat is visible.
    if (!this.causticPattern && this.caustic)
      this.causticPattern = g.createPattern(this.caustic, "repeat");
    if (this.causticPattern) {
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const [scale, sx, sy, alpha] of [
        [1, 9, 5, 0.26],
        [1.7, -6, 8, 0.16],
      ] as const) {
        g.save();
        g.globalAlpha = alpha;
        g.scale(scale, scale);
        g.translate(
          (Math.sin(this.t * 0.13) * 40 + this.t * sx) % 220,
          (Math.cos(this.t * 0.11) * 40 + this.t * sy) % 220,
        );
        g.fillStyle = this.causticPattern;
        g.fillRect(
          -240,
          -240,
          this.w / scale + 480,
          this.h / scale + 480,
        );
        g.restore();
      }
      g.restore();
    }

    // Deep fish first so shallower ones overlap them correctly.
    const sorted = [...this.fish].sort((a, b) => b.z - a.z);
    for (const f of sorted) drawFish(g, f, this.t);

    // Pads float on the surface, above everything in the water.
    for (const p of this.pads) drawPad(g, p, this.t);

    for (const r of this.ripples) drawRipple(g, r);

    for (const s of this.splashes) {
      const a = 1 - s.t / s.life;
      g.globalAlpha = a * 0.9;
      g.fillStyle = "rgba(220,245,255,0.9)";
      g.beginPath();
      g.arc(s.x, s.y, s.r * a, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;

    // A faint moving sheen on the surface, tying the whole thing together.
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.05;
    const sheen = g.createLinearGradient(
      0,
      Math.sin(this.t * 0.2) * this.h * 0.3,
      this.w,
      this.h,
    );
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.5, "rgba(210,240,255,1)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sheen;
    g.fillRect(0, 0, this.w, this.h);
    g.restore();
  }
}

export const koiPond: GameModule = {
  id: "koi-pond",
  title: "Koi Pond",
  tagline:
    "A school of koi under the surface. They move together, so one swat bursts the whole shoal apart. Wait for one to rise — only a fish at the surface can be caught.",
  suits: ["watcher", "pouncer"],
  backdrop: PONDS[0].deep,
  accent: "#7fe3c4",
  create: (host) => new KoiPond(host),
};
