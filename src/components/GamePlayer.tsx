"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CatProfile, GameEvent, PawEvent } from "@/lib/types";
import type { Round } from "@/lib/shuffle";
import { REST_SECONDS } from "@/lib/shuffle";
import { initAudio, setVolume, chirp } from "@/lib/audio";
import { updateSkill, loadProfiles, saveProfiles } from "@/lib/profiles";
import { recordRound } from "@/lib/affinity";

/** Default hunt length. Cats hunt in short bursts; an endless session is how
 *  you get an over-aroused, frustrated cat rather than a satisfied one. */
export const SESSION_SECONDS = 6 * 60;

interface Stats {
  hits: number;
  strikes: number;
  nearMisses: number;
}

const ZERO: Stats = { hits: 0, strikes: 0, nearMisses: 0 };

export default function GamePlayer({
  plan,
  profile,
  shuffled = false,
}: {
  /** One round for a single game, several for a shuffle. */
  plan: Round[];
  profile: CatProfile;
  shuffled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [round, setRound] = useState(0);
  /** Dark beat between rounds. Also covers the new game's first frame. */
  const [resting, setResting] = useState(false);

  const total = useMemo(
    () => plan.reduce((s, r) => s + r.seconds, 0),
    [plan],
  );
  const [remaining, setRemaining] = useState(total);
  const statsRef = useRef<Stats>({ ...ZERO });
  const [stats, setStats] = useState<Stats>(ZERO);
  const profileRef = useRef(profile);
  /** Play seconds completed in rounds already finished. */
  const bankedRef = useRef(0);
  /** Cumulative strikes at the current round's start, for affinity scoring. */
  const roundBaseRef = useRef(0);

  const current = plan[Math.min(round, plan.length - 1)];
  const last = round >= plan.length - 1;

  /** Fold this session's hit rate back into the cat's stored difficulty. */
  const finish = useCallback(() => {
    const s = statsRef.current;
    const updated = updateSkill(profileRef.current, s.hits, s.strikes);
    const all = loadProfiles().map((p) => (p.id === updated.id ? updated : p));
    saveProfiles(all);
    setStats({ ...s });
    setDone(true);
  }, []);

  useEffect(() => {
    if (!started || done || resting) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const g = canvas.getContext("2d", { alpha: false });
    if (!g) return;

    const mod = current.game;
    const limit = current.seconds;
    roundBaseRef.current = statsRef.current.strikes;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    let w = wrap.clientWidth;
    let h = wrap.clientHeight;

    const report = (e: GameEvent) => {
      const s = statsRef.current;
      if (e.type === "hit") s.hits += e.value ?? 1;
      else if (e.type === "near-miss") s.nearMisses++;
      else if (e.type === "engage") s.strikes++;
    };

    const size = () => {
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();

    const game = mod.create({
      width: w,
      height: h,
      dpr,
      profile: profileRef.current,
      report,
    });

    const ro = new ResizeObserver(() => {
      size();
      game.resize(w, h);
    });
    ro.observe(wrap);

    // --- Input ------------------------------------------------------------
    const seen = new Map<number, { x: number; y: number; t: number }>();
    const toPaw = (ev: PointerEvent, phase: PawEvent["phase"]): PawEvent => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const prev = seen.get(ev.pointerId);
      const now = performance.now();
      let vx = 0;
      let vy = 0;
      if (prev) {
        const dt = Math.max((now - prev.t) / 1000, 0.001);
        vx = (x - prev.x) / dt;
        vy = (y - prev.y) / dt;
      }
      if (phase === "up") seen.delete(ev.pointerId);
      else seen.set(ev.pointerId, { x, y, t: now });
      return {
        id: ev.pointerId,
        x,
        y,
        // PointerEvent width/height are the contact geometry in CSS px. Safari
        // reports a real footprint for touch, which is how we size a paw.
        r: Math.max(ev.width, ev.height) / 2 || 22,
        force: ev.pressure || 0.5,
        phase,
        vx,
        vy,
      };
    };

    const down = (e: PointerEvent) => {
      e.preventDefault();
      game.paw(toPaw(e, "down"));
    };
    const move = (e: PointerEvent) => {
      e.preventDefault();
      game.paw(toPaw(e, "move"));
    };
    const up = (e: PointerEvent) => {
      e.preventDefault();
      game.paw(toPaw(e, "up"));
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", up);

    // --- Loop --------------------------------------------------------------
    let raf = 0;
    let prev = performance.now();
    let acc = 0;
    let elapsed = 0;
    const tick = (now: number) => {
      // Clamp dt so a backgrounded tab doesn't teleport every bug at once.
      const dt = Math.min((now - prev) / 1000, 1 / 20);
      prev = now;
      elapsed += dt;
      acc += dt;
      if (acc >= 1) {
        acc -= 1;
        setRemaining(
          Math.max(0, total - Math.floor(bankedRef.current + elapsed)),
        );
        setStats({ ...statsRef.current });
      }
      // The round ends itself. Cats hunt in short bursts, and an app that
      // never stops is the one that leaves them wound up instead of satisfied.
      if (elapsed >= limit) {
        bankedRef.current += limit;
        recordRound(
          profileRef.current.id,
          mod.id,
          statsRef.current.strikes - roundBaseRef.current,
          limit,
        );
        if (last) finish();
        else setResting(true);
        return;
      }
      game.update(dt, now / 1000);
      game.render(g);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", up);
      game.dispose?.();
    };
  }, [started, done, resting, current, last, total, finish]);

  /**
   * The rest beat. The screen goes dark and quiet for a few seconds, then the
   * next game opens with a single chirp — a fresh stimulus to re-orient on,
   * rather than one game dissolving into another while the cat is mid-swat.
   */
  useEffect(() => {
    if (!resting) return;
    const id = setTimeout(() => {
      setRound((r) => r + 1);
      setResting(false);
      chirp();
    }, REST_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [resting]);

  // Keep the iPad awake during a hunt.
  useEffect(() => {
    if (!started || done) return;
    let lock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> };
    };
    nav.wakeLock
      ?.request("screen")
      .then((l) => (lock = l))
      .catch(() => {});
    return () => {
      void lock?.release().catch(() => {});
    };
  }, [started, done]);

  const begin = async () => {
    initAudio();
    setVolume(0.5);
    try {
      await wrapRef.current?.requestFullscreen?.();
    } catch {
      /* iOS Safari doesn't allow this outside of PWA mode; not fatal */
    }
    statsRef.current = { ...ZERO };
    bankedRef.current = 0;
    setStats(ZERO);
    setRemaining(total);
    setRound(0);
    setResting(false);
    setDone(false);
    setStarted(true);
  };

  const accuracy = stats.strikes
    ? Math.round((stats.hits / stats.strikes) * 100)
    : 0;
  const mins = Math.round(total / 60);

  return (
    <div
      ref={wrapRef}
      className="relative h-dvh w-full touch-none overscroll-none select-none"
      style={{ background: current.game.backdrop }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
      />

      {started && !done && (
        <HoldToExit onExit={finish} remaining={remaining} />
      )}

      {/* Rest beat. Deliberately near-black and empty: the point is that
          there is nothing to chase for a moment. */}
      {started && !done && resting && (
        <div className="absolute inset-0 grid place-items-center bg-black transition-opacity duration-500">
          <p className="text-xs uppercase tracking-[0.35em] text-white/15">
            {plan[Math.min(round + 1, plan.length - 1)].game.title}
          </p>
        </div>
      )}

      {(!started || done) && (
        <div className="absolute inset-0 grid place-items-center bg-black/85 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md text-center">
            {done ? (
              <>
                <p className="text-sm uppercase tracking-[0.3em] text-white/40">
                  Hunt complete
                </p>
                <h1 className="mt-3 text-3xl font-semibold text-white">
                  {profile.name} caught {stats.hits}
                </h1>
                <div className="mt-6 grid grid-cols-3 gap-3 text-white">
                  <Stat label="Strikes" value={stats.strikes} />
                  <Stat label="Accuracy" value={`${accuracy}%`} />
                  <Stat label="Flushed out" value={stats.nearMisses} />
                </div>
                {/* Closing the predatory sequence with food is the part most
                    cat apps skip, and it's the part that actually leaves the
                    cat settled instead of wound up. */}
                <p className="mt-6 text-balance text-white/70">
                  Now go give {profile.name} a treat — finishing the hunt with a
                  meal is what turns it into a satisfying kill rather than an
                  unresolved chase.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-4xl font-semibold text-white">
                  {shuffled ? "The Shuffle" : current.game.title}
                </h1>
                <p className="mt-3 text-balance text-white/60">
                  {shuffled
                    ? "A hunt in rounds. The game changes before it gets predictable, with a dark beat of rest in between."
                    : current.game.tagline}
                </p>
                {shuffled && (
                  <ol className="mt-6 flex flex-col items-center gap-1.5 text-sm text-white/45">
                    {plan.map((r, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: r.game.accent }}
                        />
                        {r.game.title}
                        <span className="text-white/25">
                          {Math.round(r.seconds / 60) >= 1
                            ? `${Math.round(r.seconds / 60)} min`
                            : `${r.seconds}s`}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="mt-6 text-sm text-white/40">
                  Playing as {profile.name} · {profile.style} · {mins} minute
                  hunt
                </p>
              </>
            )}
            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                onClick={begin}
                className="rounded-full px-8 py-4 text-lg font-medium text-black transition active:scale-95"
                style={{ background: current.game.accent }}
              >
                {done ? "Hunt again" : "Start the hunt"}
              </button>
              <Link
                href="/"
                className="text-sm text-white/40 underline-offset-4 hover:underline"
              >
                Back to the library
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-widest text-white/40">
        {label}
      </div>
    </div>
  );
}

/**
 * Cats will absolutely hit a button. Exiting requires a deliberate 1.2s hold,
 * which a paw strike won't produce.
 */
function HoldToExit({
  onExit,
  remaining,
}: {
  onExit: () => void;
  remaining: number;
}) {
  const [held, setHeld] = useState(0);
  const raf = useRef(0);
  const start = useRef(0);

  const begin = () => {
    start.current = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - start.current) / 1200);
      setHeld(p);
      if (p >= 1) return onExit();
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  const end = () => {
    cancelAnimationFrame(raf.current);
    setHeld(0);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="pointer-events-none absolute left-0 top-0 flex items-center gap-3 p-3">
      <button
        onPointerDown={begin}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        className="pointer-events-auto relative grid h-11 w-11 place-items-center rounded-full bg-black/35 text-white/50 backdrop-blur-sm"
        aria-label="Hold to exit"
      >
        <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
          <circle
            cx="22"
            cy="22"
            r="19"
            fill="none"
            stroke="white"
            strokeOpacity="0.9"
            strokeWidth="3"
            strokeDasharray={`${held * 119.4} 119.4`}
            strokeLinecap="round"
          />
        </svg>
        <span className="text-lg leading-none">×</span>
      </button>
      <span className="rounded-full bg-black/25 px-2.5 py-1 font-mono text-xs text-white/35 backdrop-blur-sm">
        {mm}:{ss}
      </span>
    </div>
  );
}
