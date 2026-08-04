"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CatProfile, GameEvent, GameModule, PawEvent } from "@/lib/types";
import { initAudio, setVolume } from "@/lib/audio";
import { updateSkill, loadProfiles, saveProfiles } from "@/lib/profiles";

/** Default hunt length. Cats hunt in short bursts; an endless session is how
 *  you get an over-aroused, frustrated cat rather than a satisfied one. */
const SESSION_SECONDS = 6 * 60;

interface Stats {
  hits: number;
  strikes: number;
  nearMisses: number;
}

export default function GamePlayer({
  module: mod,
  profile: initialProfile,
}: {
  module: GameModule;
  profile: CatProfile;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [remaining, setRemaining] = useState(SESSION_SECONDS);
  const statsRef = useRef<Stats>({ hits: 0, strikes: 0, nearMisses: 0 });
  const [stats, setStats] = useState<Stats>({
    hits: 0,
    strikes: 0,
    nearMisses: 0,
  });
  const profileRef = useRef(initialProfile);
  const profile = initialProfile;

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
    if (!started || done) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const g = canvas.getContext("2d", { alpha: false });
    if (!g) return;

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
    const last = new Map<number, { x: number; y: number; t: number }>();
    const toPaw = (
      ev: PointerEvent,
      phase: PawEvent["phase"],
    ): PawEvent => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const prev = last.get(ev.pointerId);
      const now = performance.now();
      let vx = 0;
      let vy = 0;
      if (prev) {
        const dt = Math.max((now - prev.t) / 1000, 0.001);
        vx = (x - prev.x) / dt;
        vy = (y - prev.y) / dt;
      }
      if (phase === "up") last.delete(ev.pointerId);
      else last.set(ev.pointerId, { x, y, t: now });
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
        setRemaining(Math.max(0, SESSION_SECONDS - Math.floor(elapsed)));
        setStats({ ...statsRef.current });
      }
      // The hunt ends itself. Cats hunt in short bursts, and an app that never
      // stops is the one that leaves them wound up instead of satisfied.
      if (elapsed >= SESSION_SECONDS) {
        finish();
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
  }, [started, done, mod, finish]);

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
    statsRef.current = { hits: 0, strikes: 0, nearMisses: 0 };
    setStats({ hits: 0, strikes: 0, nearMisses: 0 });
    setRemaining(SESSION_SECONDS);
    setDone(false);
    setStarted(true);
  };

  const accuracy = stats.strikes
    ? Math.round((stats.hits / stats.strikes) * 100)
    : 0;

  return (
    <div
      ref={wrapRef}
      className="relative h-dvh w-full touch-none overscroll-none select-none"
      style={{ background: mod.backdrop }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
      />

      {started && !done && (
        <HoldToExit
          onExit={finish}
          remaining={remaining}
        />
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
                  Now go give {profile.name} a treat — finishing the
                  hunt with a meal is what turns it into a satisfying kill
                  rather than an unresolved chase.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-4xl font-semibold text-white">
                  {mod.title}
                </h1>
                <p className="mt-3 text-balance text-white/60">{mod.tagline}</p>
                <p className="mt-6 text-sm text-white/40">
                  Playing as {profile.name} ·{" "}
                  {profile.style} · 6 minute hunt
                </p>
              </>
            )}
            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                onClick={begin}
                className="rounded-full px-8 py-4 text-lg font-medium text-black transition active:scale-95"
                style={{ background: mod.accent }}
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
