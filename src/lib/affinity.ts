"use client";

/**
 * What each cat actually engages with, learned from play.
 *
 * A game's tagline can't tell you whether Muffin will sit and watch it. The
 * only honest signal is how hard she works during a round, so we record swats
 * per minute per cat per game and let the shuffle weight itself off that.
 *
 * Kept as an exponential moving average: a cat that goes off a game for a
 * fortnight should drift back toward neutral rather than being written off
 * forever on the strength of one bad afternoon.
 */

const KEY = "catgames.affinity.v1";

export interface Affinity {
  /** Swats per minute, smoothed. Neutral prior is NEUTRAL_RATE. */
  rate: number;
  /** Rounds played, so early noisy samples can be discounted. */
  rounds: number;
  /** Epoch ms of the last round, for the recency penalty. */
  last: number;
}

/** A middling engagement rate, used as the prior for an unplayed game. */
export const NEUTRAL_RATE = 14;

type Table = Record<string, Record<string, Affinity>>;

let cache: Table | null = null;

function load(): Table {
  if (typeof window === "undefined") return {};
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Table) : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function getAffinity(catId: string, gameId: string): Affinity {
  const t = load()[catId]?.[gameId];
  return t ?? { rate: NEUTRAL_RATE, rounds: 0, last: 0 };
}

/**
 * Fold one round's result in. `strikes` is every deliberate swat, which is a
 * better engagement measure than hits — a cat batting furiously at something
 * it keeps missing is having a great time.
 */
export function recordRound(
  catId: string,
  gameId: string,
  strikes: number,
  seconds: number,
) {
  if (seconds < 20) return; // too short to mean anything
  const t = load();
  const prev = getAffinity(catId, gameId);
  const observed = (strikes / seconds) * 60;
  // Weight early rounds more heavily so a new game finds its level quickly,
  // then settle down and stop chasing noise.
  const alpha = prev.rounds === 0 ? 1 : Math.max(0.25, 1 / (prev.rounds + 1));
  const next: Affinity = {
    rate: prev.rate + (observed - prev.rate) * alpha,
    rounds: prev.rounds + 1,
    last: Date.now(),
  };
  t[catId] = { ...(t[catId] ?? {}), [gameId]: next };
  cache = t;
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* private mode — the shuffle just stays unweighted */
  }
}

export function clearAffinity() {
  cache = {};
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
