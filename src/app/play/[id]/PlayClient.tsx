"use client";

import { useMemo } from "react";
import Link from "next/link";
import GamePlayer, { SESSION_SECONDS } from "@/components/GamePlayer";
import { getGame } from "@/lib/registry";
import { buildShuffle } from "@/lib/shuffle";
import { useActiveProfile, useHydrated } from "@/lib/useProfiles";

export default function PlayClient({ id }: { id: string }) {
  const { profile } = useActiveProfile();
  const hydrated = useHydrated();
  const shuffled = id === "shuffle";
  const mod = shuffled ? null : getGame(id);

  // The plan has to be a stable reference — it drives the render loop's
  // effect, and a fresh array each render would restart the game every time
  // the clock ticks. Rebuilt only when the cat changes, which also re-rolls
  // the rotation for a genuinely different hunt each visit.
  const plan = useMemo(
    () =>
      !profile || !hydrated
        ? []
        : shuffled
          ? buildShuffle(profile, SESSION_SECONDS)
          : mod
            ? [{ game: mod, seconds: SESSION_SECONDS }]
            : [],
    [shuffled, mod, profile, hydrated],
  );

  // The shuffle picks its rotation randomly, so it can't be generated until
  // after hydration — see useHydrated.
  if (!hydrated) {
    return <main className="min-h-dvh flex-1 bg-[#07090d]" />;
  }

  // Every hunt is tuned to a specific cat, so there's nothing to run without
  // one — reachable if someone deletes all their profiles mid-session.
  if (!profile) {
    return (
      <main className="grid min-h-dvh flex-1 place-items-center bg-[#07090d] px-6 text-center text-white/60">
        <p>
          Add a cat on the{" "}
          <Link href="/" className="underline underline-offset-4">
            home screen
          </Link>{" "}
          to start a hunt.
        </p>
      </main>
    );
  }

  if (!plan.length) {
    return (
      <main className="grid min-h-dvh flex-1 place-items-center bg-[#07090d] text-white/60">
        No game called “{id}”.
      </main>
    );
  }
  // Keyed on the cat so switching profiles rebuilds the world with their
  // tuning rather than mutating a running hunt.
  return (
    <GamePlayer
      key={profile.id}
      plan={plan}
      profile={profile}
      shuffled={shuffled}
    />
  );
}
