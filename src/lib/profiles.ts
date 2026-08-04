"use client";

import type { CatProfile, PlayStyle } from "./types";
import { clamp } from "./rng";

const KEY = "catgames.profiles.v1";
const ACTIVE = "catgames.activeProfile.v1";

export const DEFAULT_PROFILES: CatProfile[] = [
  { id: "mason", name: "Mason", hue: 38, style: "pouncer", skill: 0.55 },
  { id: "muffin", name: "Muffin", hue: 205, style: "watcher", skill: 0.4 },
];

/**
 * Backed by localStorage but exposed as a proper external store, so React can
 * subscribe to it with useSyncExternalStore instead of setting state from an
 * effect on mount. getSnapshot has to return a stable reference, hence the
 * caches.
 */
const listeners = new Set<() => void>();
let profileCache: CatProfile[] | null = null;
let activeCache: string | null = null;

const emit = () => listeners.forEach((l) => l());

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function loadProfiles(): CatProfile[] {
  if (typeof window === "undefined") return DEFAULT_PROFILES;
  if (profileCache) return profileCache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as CatProfile[]) : null;
    profileCache =
      Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PROFILES;
  } catch {
    profileCache = DEFAULT_PROFILES;
  }
  return profileCache;
}

export function saveProfiles(ps: CatProfile[]) {
  profileCache = ps;
  try {
    localStorage.setItem(KEY, JSON.stringify(ps));
  } catch {
    /* private mode — profiles just won't persist */
  }
  emit();
}

export function getActiveId(): string {
  if (typeof window === "undefined") return DEFAULT_PROFILES[0].id;
  if (activeCache === null) {
    activeCache = localStorage.getItem(ACTIVE) ?? DEFAULT_PROFILES[0].id;
  }
  return activeCache;
}

export function setActiveId(id: string) {
  activeCache = id;
  try {
    localStorage.setItem(ACTIVE, id);
  } catch {
    /* ignore */
  }
  emit();
}

export const serverProfiles = () => DEFAULT_PROFILES;
export const serverActiveId = () => DEFAULT_PROFILES[0].id;

/**
 * Nudge a cat's skill toward the observed hit rate. We target ~45% success:
 * high enough that the hunt feels winnable (an unwinnable hunt is the whole
 * problem with laser pointers), low enough that it stays worth doing.
 */
export function updateSkill(p: CatProfile, hits: number, attempts: number) {
  if (attempts < 6) return p;
  const rate = hits / attempts;
  const next = clamp(p.skill + (rate - 0.45) * 0.25, 0.05, 1);
  return { ...p, skill: next };
}

/** Per-style tuning knobs consumed by game modules. */
export function styleTuning(style: PlayStyle) {
  return style === "pouncer"
    ? {
        // Fast, dense, short pauses. Rewards a cat that commits.
        speed: 1.25,
        density: 1.35,
        freeze: 0.6,
        peek: 0.5,
        fleeRadius: 1.0,
      }
    : {
        // Slower, sparser, long tempting freezes and lots of peeking in and
        // out of cover — a watcher needs time to build to a pounce.
        speed: 0.78,
        density: 0.7,
        freeze: 1.7,
        peek: 1.5,
        fleeRadius: 0.8,
      };
}
