import type { GameModule, GameHost, GameInstance, PawEvent } from "@/lib/types";
import { styleTuning } from "@/lib/profiles";
import { rand, randInt, chance, clamp, TAU, damp } from "@/lib/rng";
import * as sfx from "@/lib/audio";
import { PawField } from "@/lib/paw";
import { Tempo } from "@/lib/tempo";
import {
  GROUNDS,
  drawHole,
  makeBurrow,
  makeGround,
  pickGround,
  alongTunnel,
  type Burrow,
  type Ground,
} from "./burrow";
import { Mouse, drawMouse, type MouseWorld } from "./mouse";

interface Dirt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  t: number;
  life: number;
}

class MouseHole implements GameInstance {
  private host: GameHost;
  private w: number;
  private h: number;
  private ground: Ground;
  private burrow: Burrow;
  private baked: HTMLCanvasElement | null = null;
  private mice: Mouse[] = [];
  private dirt: Dirt[] = [];
  /** Every touch throws up soil, landed or not. */
  private field = new PawField({
    ring: "168,146,110",
    bloom: "120,102,74",
    hue: [28, 54],
    grit: 15,
    spread: 0.8,
  });
  private tempo = new Tempo();

  private t = 0;
  private idleT = 0;
  private respawnT = 0;
  private rustleT = 0;
  private timeScale = 1;
  private streak = 0;

  constructor(host: GameHost) {
    this.host = host;
    this.w = host.width;
    this.h = host.height;
    this.ground = pickGround();
    this.burrow = makeBurrow(this.w, this.h, this.holeCount());
    this.baked = makeGround(this.w, this.h, host.dpr, this.ground, this.burrow);
    for (let i = 0; i < this.targetPopulation(); i++) this.spawn();
  }

  private holeCount() {
    const area = (this.w * this.h) / (1024 * 768);
    return clamp(Math.round(4 + area * 2.4), 4, 9);
  }

  private targetPopulation() {
    // Deliberately sparse. Several mice at once turns tracking one animal
    // through the tunnels into visual noise, and tracking is the whole game.
    return this.host.profile.style === "pouncer" ? 2 : 1;
  }

  private get tuning() {
    const t = styleTuning(this.host.profile.style);
    const skill = this.host.profile.skill;
    return {
      speedScale: t.speed * (0.7 + skill * 0.6) * this.tempo.speed,
      // A less skilled cat gets longer, more tempting holds in the hole mouth.
      freezeScale: t.freeze * (1.4 - skill * 0.55) * this.tempo.freeze,
      // And sees the mouse commit to the open more often, where it's easiest.
      boldScale: clamp(1.5 - skill * 0.7, 0.6, 1.5) * t.peek,
      fleeRadius: t.fleeRadius * (0.55 + skill * 0.7),
    };
  }

  private get world(): MouseWorld {
    const t = this.tuning;
    return {
      burrow: this.burrow,
      threats: this.field.threats,
      speedScale: t.speedScale,
      freezeScale: t.freezeScale,
      boldScale: t.boldScale,
      fleeRadius: t.fleeRadius,
    };
  }

  private spawn() {
    const open = this.burrow.holes
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h.blocked <= 0);
    const start = open.length
      ? open[randInt(open.length)].i
      : randInt(this.burrow.holes.length);
    this.mice.push(new Mouse(this.world, start));
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    // Rebuilding the network on rotation is fine — it's a fresh burrow, which
    // is a feature rather than a loss of state.
    this.burrow = makeBurrow(w, h, this.holeCount());
    this.baked = makeGround(w, h, this.host.dpr, this.ground, this.burrow);
    this.mice = [];
    for (let i = 0; i < this.targetPopulation(); i++) this.spawn();
  }

  private burst(x: number, y: number, n: number, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(TAU);
      const sp = rand(280, 50) * power;
      this.dirt.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: rand(3.4, 1),
        t: 0,
        life: rand(0.8, 0.3),
      });
    }
  }

  paw(e: PawEvent) {
    this.idleT = 0;
    const pan = (e.x / this.w) * 2 - 1;

    const reach = this.field.paw(e);
    if (e.phase !== "down") return;
    this.host.report({ type: "engage" });
    sfx.thump(pan, 0.6 + e.force * 0.6);

    // --- A mouse that has shown itself: a real, terminal catch --------------
    let target: Mouse | null = null;
    let bestD = Infinity;
    for (const m of this.mice) {
      if (!m.exposed || m.caught) continue;
      const d = Math.hypot(m.x - e.x, m.y - e.y);
      if (d < reach + m.hitRadius && d < bestD) {
        bestD = d;
        target = m;
      }
    }
    if (target) {
      // Catching one still half in the hole is the harder shot: a smaller
      // target and a shorter window, so it pays more.
      const value = target.state === "peek" ? 3 : 2;
      if (target.pin()) {
        this.streak++;
        this.host.report({ type: "hit", value });
        sfx.crunch(pan);
        sfx.squeak(pan, false);
        this.timeScale = 0.4;
        this.burst(target.x, target.y, 18, 1.2);
        this.field.strike(target.x, target.y, reach, 1.2);
      }
      return;
    }

    this.streak = 0;
    this.host.report({ type: "miss" });
    let reacted = false;

    // --- A hole: swatting it caves the entrance in -------------------------
    // The mouse then has to route around it. This is the piece that rewards a
    // cat for watching the network rather than only the animal.
    // Never let more than a third of the network be shut at once. A cat that
    // swats everything would otherwise seal every exit, leaving the mouse
    // circling underground with nothing to surface for — an unwinnable hunt,
    // which is the one outcome this whole project exists to avoid.
    const blockedNow = this.burrow.holes.filter((x) => x.blocked > 0).length;
    const canBlock = blockedNow < Math.floor(this.burrow.holes.length / 3);

    for (const hole of this.burrow.holes) {
      if (Math.hypot(hole.x - e.x, hole.y - e.y) > hole.r * 1.15) continue;
      if (hole.blocked <= 0 && canBlock) {
        hole.blocked = rand(7, 4);
        this.burst(hole.x, hole.y, 12, 0.8);
        sfx.rustle(pan, 1);
        reacted = true;
      }
      for (const m of this.mice) {
        if (!m.caught && m.at === this.burrow.holes.indexOf(hole)) {
          m.flush(this.world);
          reacted = true;
        }
      }
    }

    // --- A tunnel: a hit on the roof over a passing mouse -------------------
    for (const m of this.mice) {
      if (m.caught || m.state !== "travel") continue;
      const d = Math.hypot(m.x - e.x, m.y - e.y);
      if (d < reach + m.size * 1.6) {
        m.flush(this.world);
        this.burst(m.x, m.y, 9, 0.7);
        sfx.squeak(pan, true);
        reacted = true;
      }
    }

    // --- Anything close by bolts ------------------------------------------
    for (const m of this.mice) {
      if (m.caught) continue;
      if (Math.hypot(m.x - e.x, m.y - e.y) < reach * 2.8) {
        m.flush(this.world);
        reacted = true;
      }
    }

    if (reacted) {
      this.host.report({ type: "near-miss" });
      sfx.skitter(pan, 1, 0.28);
    }
  }

  update(dt: number) {
    this.tempo.update(dt);
    this.field.update(dt);
    this.timeScale = damp(this.timeScale, 1, 0.18, dt);
    const sdt = Math.min(dt * this.timeScale, 0.05);
    this.t += sdt;
    this.idleT += dt;

    for (const hole of this.burrow.holes)
      if (hole.blocked > 0) hole.blocked -= dt;

    const world = this.world;
    for (const m of this.mice) {
      m.update(sdt, world);
      // Loose soil kicked up as it moves along a tunnel — the tell that
      // something is under there.
      if (m.state === "travel" && chance(sdt * 9)) {
        this.dirt.push({
          x: m.x + rand(8, -8),
          y: m.y + rand(8, -8),
          vx: rand(30, -30),
          vy: rand(30, -30),
          r: rand(2, 0.6),
          t: 0,
          life: rand(0.5, 0.2),
        });
      }
    }
    // An unheralded scramble: the whole burrow moves at once.
    if (this.tempo.takeBurst()) {
      for (const m of this.mice) {
        if (m.caught) continue;
        m.flush(world);
      }
      if (sfx.audioReady()) sfx.rustle(rand(1, -1), 0.9);
    }

    this.mice = this.mice.filter((m) => m.state !== "gone");

    // Repopulate on a pause, so a catch reads as having ended something.
    this.respawnT -= dt;
    if (this.mice.length < this.targetPopulation()) {
      if (this.respawnT <= 0) {
        this.respawnT = rand(2.8, 1.4);
        this.spawn();
      }
    } else {
      this.respawnT = rand(2.8, 1.4);
    }

    // --- Audio ------------------------------------------------------------
    this.rustleT -= dt;
    if (this.rustleT <= 0 && sfx.audioReady()) {
      this.rustleT = rand(0.75, 0.3);
      const m = this.mice.find((x) => !x.caught);
      if (m) {
        const pan = (m.x / this.w) * 2 - 1;
        // Underground is muffled; out in the open it's a dry skitter.
        if (m.state === "travel") sfx.rustle(pan, 0.55);
        else if (m.state === "surface" && m.runPause <= 0)
          sfx.skitter(pan, 0.8, rand(0.26, 0.1));
      }
    }

    // --- Re-hook a disengaged cat -----------------------------------------
    // Once, not on a loop. A repeating attractor is nagging, and nagging is
    // how you get a cat to leave the room.
    if (this.idleT > 11) {
      this.idleT = rand(6, 3);
      const m = this.mice[randInt(this.mice.length)];
      if (m && !m.caught) {
        // Send it up out of the nearest hole and into the open.
        m.state = "peek";
        m.stateT = 999;
        m.bold = 1;
        sfx.chirp((m.x / this.w) * 2 - 1);
      }
    }

    // --- Effects -----------------------------------------------------------
    for (const p of this.dirt) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.02, dt);
      p.vy *= Math.pow(0.02, dt);
    }
    this.dirt = this.dirt.filter((p) => p.t < p.life);

  }

  /**
   * The moving lump underground. Deliberately dim and soft-edged: it should be
   * clearly *under* the soil, readable enough to follow and predict, but never
   * as sharp as the animal itself once it surfaces. If the underground read
   * were as good as the surface read there'd be no reason to wait for it.
   */
  private drawUnderground(g: CanvasRenderingContext2D, m: Mouse) {
    const t = m.tunnel;
    if (!t) return;
    const base = m.from === t.a ? m.dist : t.len - m.dist;
    const dir = m.from === t.a ? 1 : -1;

    g.save();
    // A short wake behind it, so the direction of travel is unmistakable.
    for (let i = 3; i >= 0; i--) {
      const p = alongTunnel(t, base - dir * i * m.size * 0.85);
      const f = 1 - i / 4.2;
      const r = m.size * (1.7 - i * 0.18);
      const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `hsla(${m.hue} ${m.sat}% ${m.light}% / ${0.4 * f})`);
      grad.addColorStop(0.55, `hsla(${m.hue} ${m.sat}% ${m.light * 0.6}% / ${0.16 * f})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, TAU);
      g.fill();
    }

    // A hint of the body inside the lump — enough shape to read as an animal
    // rather than a glowing dot.
    const p = alongTunnel(t, base);
    g.globalAlpha = 0.3;
    g.fillStyle = `hsl(${m.hue} ${m.sat}% ${m.light * 0.85}%)`;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(dir > 0 ? p.a : p.a + Math.PI);
    g.beginPath();
    g.ellipse(0, 0, m.size * 0.9, m.size * 0.5, 0, 0, TAU);
    g.fill();
    g.restore();
    g.restore();
  }

  render(g: CanvasRenderingContext2D) {
    if (this.baked) g.drawImage(this.baked, 0, 0, this.w, this.h);
    else {
      g.fillStyle = this.ground.base;
      g.fillRect(0, 0, this.w, this.h);
    }

    // Underground first: it belongs beneath the hole mouths.
    for (const m of this.mice) if (m.state === "travel") this.drawUnderground(g, m);

    for (const hole of this.burrow.holes) drawHole(g, hole, this.ground);

    // Mice at a hole are clipped so the hole swallows their back half — that's
    // what makes a peek read as emerging rather than as sitting on top.
    for (const m of this.mice) {
      if (m.state === "travel" || m.state === "gone") continue;
      const alpha = m.caught ? m.fade : 1;
      const emerging = m.out < 0.92 && m.state !== "caught";
      if (emerging) {
        const hole = this.burrow.holes[m.at];
        g.save();
        g.beginPath();
        g.rect(0, 0, this.w, this.h);
        g.ellipse(hole.x, hole.y, hole.r, hole.r * hole.squash, hole.rot, 0, TAU);
        // Even-odd leaves everything *except* the hole mouth visible.
        g.clip("evenodd");
        drawMouse(g, m, this.t, alpha);
        g.restore();
      } else {
        drawMouse(g, m, this.t, alpha);
      }
    }

    this.field.render(g);

    for (const p of this.dirt) {
      const a = 1 - p.t / p.life;
      g.globalAlpha = a * 0.8;
      g.fillStyle = this.ground.rim;
      g.beginPath();
      g.arc(p.x, p.y, p.r * a, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}

export const mouseHole: GameModule = {
  id: "mouse-hole",
  title: "Mouse Hole",
  tagline:
    "A burrow you can see into. Track the mouse through the tunnels, work out which hole it is heading for, and be waiting when it surfaces.",
  suits: ["watcher", "pouncer"],
  backdrop: GROUNDS[0].base,
  accent: "#c9a06a",
  create: (host) => new MouseHole(host),
};
