"use client";

import { useState } from "react";
import type { CatProfile, PlayStyle } from "@/lib/types";
import {
  PROFILE_HUES,
  addProfile,
  removeProfile,
  setActiveId,
  updateProfile,
} from "@/lib/profiles";
import { useActiveProfile } from "@/lib/useProfiles";

/**
 * Cat profiles. Mason and Muffin ship as a starting point, but they're just
 * data — anyone can delete them and add their own.
 *
 * The play style isn't cosmetic: it drives prey speed, how densely the board
 * is populated, and how long prey holds still before moving, so it's worth
 * asking for rather than inferring.
 */

const STYLES: { id: PlayStyle; label: string; blurb: string }[] = [
  {
    id: "pouncer",
    label: "Pouncer",
    blurb: "Commits fast and often. Gets quicker prey, more of it, shorter pauses.",
  },
  {
    id: "watcher",
    label: "Watcher",
    blurb: "Stalks and waits. Gets slower, sparser prey that holds still longer.",
  },
];

export default function CatManager() {
  const { profiles, activeId } = useActiveProfile();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-3">
        {profiles.map((p) => (
          <div key={p.id} className="relative">
            <button
              onClick={() => setActiveId(p.id)}
              onDoubleClick={() => setEditing(p.id)}
              className={`w-full rounded-2xl border px-5 py-4 text-left transition ${
                p.id === activeId
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
            <button
              onClick={() => setEditing(editing === p.id ? null : p.id)}
              aria-label={`Edit ${p.name}`}
              className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full text-white/25 transition hover:bg-white/10 hover:text-white/70"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                <path d="M11.5 1.5 14.5 4.5 5.5 13.5 1.5 14.5 2.5 10.5z" />
              </svg>
            </button>
          </div>
        ))}

        <button
          onClick={() => {
            setAdding(true);
            setEditing(null);
          }}
          className="rounded-2xl border border-dashed border-white/15 px-5 py-4 text-left text-white/45 transition hover:border-white/30 hover:text-white/75"
        >
          <div className="text-lg font-medium">+ Add a cat</div>
          <div className="mt-1 text-xs text-white/30">Name and play style</div>
        </button>
      </div>

      {adding && (
        <CatForm
          onCancel={() => setAdding(false)}
          onSave={({ name, style, hue }) => {
            addProfile(name, style, hue);
            setAdding(false);
          }}
        />
      )}

      {editing && (
        <CatForm
          key={editing}
          existing={profiles.find((p) => p.id === editing)}
          onCancel={() => setEditing(null)}
          onSave={({ name, style, hue }) => {
            updateProfile(editing, { name, style, hue });
            setEditing(null);
          }}
          onDelete={() => {
            removeProfile(editing);
            setEditing(null);
          }}
        />
      )}

      {!profiles.length && !adding && (
        <p className="mt-4 text-sm text-white/40">
          No cats yet. Add one to start a hunt.
        </p>
      )}
    </div>
  );
}

function CatForm({
  existing,
  onSave,
  onCancel,
  onDelete,
}: {
  existing?: CatProfile;
  onSave: (v: { name: string; style: PlayStyle; hue: number }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [style, setStyle] = useState<PlayStyle>(existing?.style ?? "pouncer");
  // Lazy initialiser: the random default is picked once when the form mounts,
  // not re-rolled on every render.
  const [hue, setHue] = useState(
    () =>
      existing?.hue ??
      PROFILE_HUES[Math.floor(Math.random() * PROFILE_HUES.length)],
  );
  const valid = name.trim().length > 0;

  return (
    <div className="mt-4 rounded-2xl border border-white/12 bg-white/[0.04] p-5">
      <label className="block text-xs uppercase tracking-[0.25em] text-white/35">
        Name
      </label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid) onSave({ name, style, hue });
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Your cat's name"
        maxLength={24}
        className="mt-2 w-full rounded-xl border border-white/12 bg-black/40 px-4 py-3 text-lg text-white outline-none placeholder:text-white/25 focus:border-white/35"
      />

      <div className="mt-5 text-xs uppercase tracking-[0.25em] text-white/35">
        Play style
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {STYLES.map((s) => (
          <button
            key={s.id}
            onClick={() => setStyle(s.id)}
            className={`rounded-xl border px-4 py-3 text-left transition ${
              style === s.id
                ? "border-white/40 bg-white/10"
                : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
            }`}
          >
            <div className="font-medium text-white">{s.label}</div>
            <div className="mt-1 text-xs leading-relaxed text-white/40">
              {s.blurb}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-5 text-xs uppercase tracking-[0.25em] text-white/35">
        Colour
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {PROFILE_HUES.map((h) => (
          <button
            key={h}
            onClick={() => setHue(h)}
            aria-label={`Colour ${h}`}
            className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-[#07090d] transition ${
              hue === h ? "ring-2 ring-white/70" : "ring-0 hover:opacity-80"
            }`}
            style={{ background: `hsl(${h} 80% 60%)` }}
          />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          disabled={!valid}
          onClick={() => onSave({ name, style, hue })}
          className="rounded-full bg-white px-6 py-2.5 font-medium text-black transition active:scale-95 disabled:opacity-30"
        >
          {existing ? "Save" : "Add cat"}
        </button>
        <button
          onClick={onCancel}
          className="text-sm text-white/45 underline-offset-4 hover:underline"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            className="ml-auto text-sm text-red-300/60 underline-offset-4 hover:underline"
          >
            Delete {existing?.name}
          </button>
        )}
      </div>
    </div>
  );
}
