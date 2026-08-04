"use client";

import Link from "next/link";
import { GAMES } from "@/lib/registry";
import { setActiveId } from "@/lib/profiles";
import { useActiveProfile } from "@/lib/useProfiles";

export default function Home() {
  const { profiles, activeId: active, profile: current } = useActiveProfile();
  const choose = (id: string) => setActiveId(id);

  return (
    <main className="min-h-dvh flex-1 bg-[#07090d] px-6 py-12 text-white">
      <div className="mx-auto w-full max-w-3xl">
        <header>
          <p className="text-xs uppercase tracking-[0.35em] text-white/35">
            Cat Games
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            Who&apos;s hunting?
          </h1>
        </header>

        <div className="mt-6 flex flex-wrap gap-3">
          {profiles.map((p) => {
            const on = p.id === active;
            return (
              <button
                key={p.id}
                onClick={() => choose(p.id)}
                className={`rounded-2xl border px-5 py-4 text-left transition ${
                  on
                    ? "border-white/40 bg-white/10"
                    : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: `hsl(${p.hue} 80% 60%)` }}
                  />
                  <span className="text-lg font-medium">{p.name}</span>
                </div>
                <div className="mt-1 text-xs capitalize text-white/40">
                  {p.style} · difficulty {Math.round(p.skill * 100)}%
                </div>
              </button>
            );
          })}
        </div>

        {/* The shuffle leads, because rotation is what keeps any of this
            working past the second week. A single game played daily stops
            being prey once the cat can predict it. */}
        <Link
          href="/play/shuffle"
          className="group relative mt-10 block overflow-hidden rounded-3xl border border-white/15 bg-white/[0.04] p-7 transition hover:border-white/30 hover:bg-white/[0.07]"
        >
          <div className="absolute -right-10 -top-20 h-56 w-56 rounded-full bg-[conic-gradient(from_180deg,#7dd3fc,#fbbf24,#4ade80,#7dd3fc)] opacity-20 blur-3xl transition group-hover:opacity-30" />
          <p className="text-xs uppercase tracking-[0.35em] text-white/35">
            Recommended
          </p>
          <h3 className="mt-2 text-3xl font-semibold">The Shuffle</h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-white/50">
            One hunt, several rounds. The game switches before{" "}
            {current ? current.name : "your cat"} can settle into a pattern,
            with a dark beat of rest between each — and it learns which games
            actually get {current ? current.name : "them"} swatting.
          </p>
        </Link>

        <section className="mt-12">
          <h2 className="text-xs uppercase tracking-[0.35em] text-white/35">
            Or pick one
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {GAMES.map((g) => {
              const suited = current ? g.suits.includes(current.style) : false;
              return (
                <Link
                  key={g.id}
                  href={`/play/${g.id}`}
                  className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/25 hover:bg-white/[0.06]"
                >
                  <div
                    className="absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-20 blur-2xl transition group-hover:opacity-35"
                    style={{ background: g.accent }}
                  />
                  <h3 className="text-2xl font-semibold">{g.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/50">
                    {g.tagline}
                  </p>
                  <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-white/35">
                    <span className="rounded-full bg-white/10 px-2.5 py-1 capitalize">
                      {g.suits.join(" · ")}
                    </span>
                    {suited && current && (
                      <span className="rounded-full bg-white/10 px-2.5 py-1">
                        good for {current.name}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <footer className="mt-16 space-y-2 border-t border-white/10 pt-6 text-xs leading-relaxed text-white/30">
          <p>
            Built around how cats actually hunt: prey they can catch, sessions
            that end, and a treat at the finish. No red — cats barely see it.
            No endless unwinnable chase — that is what makes laser pointers a
            bad idea.
          </p>
          <p>Put a screen protector on the iPad. Trim the claws.</p>
        </footer>
      </div>
    </main>
  );
}
