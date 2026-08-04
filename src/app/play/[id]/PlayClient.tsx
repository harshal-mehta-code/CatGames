"use client";

import { useMemo } from "react";
import GamePlayer, { SESSION_SECONDS } from "@/components/GamePlayer";
import { getGame } from "@/lib/registry";
import { buildShuffle } from "@/lib/shuffle";
import { useActiveProfile } from "@/lib/useProfiles";

export default function PlayClient({ id }: { id: string }) {
  const { profile } = useActiveProfile();
  const shuffled = id === "shuffle";
  const mod = shuffled ? null : getGame(id);

  // The plan has to be a stable reference — it drives the render loop's
  // effect, and a fresh array each render would restart the game every time
  // the clock ticks. Rebuilt only when the cat changes, which also re-rolls
  // the rotation for a genuinely different hunt each visit.
  const plan = useMemo(
    () =>
      shuffled
        ? buildShuffle(profile, SESSION_SECONDS)
        : mod
          ? [{ game: mod, seconds: SESSION_SECONDS }]
          : [],
    [shuffled, mod, profile],
  );

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
