"use client";

import GamePlayer from "@/components/GamePlayer";
import { getGame } from "@/lib/registry";
import { useActiveProfile } from "@/lib/useProfiles";

export default function PlayClient({ id }: { id: string }) {
  const mod = getGame(id);
  const { profile } = useActiveProfile();

  if (!mod) {
    return (
      <main className="grid min-h-dvh flex-1 place-items-center bg-[#07090d] text-white/60">
        No game called “{id}”.
      </main>
    );
  }
  // Keyed on the cat so switching profiles rebuilds the world with their
  // tuning rather than mutating a running hunt.
  return <GamePlayer key={profile.id} module={mod} profile={profile} />;
}
