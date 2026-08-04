"use client";

import type { CatProfile, GameModule } from "./types";
import { GAMES } from "./registry";
import { getAffinity, NEUTRAL_RATE } from "./affinity";
import { clamp, rand } from "./rng";

/**
 * The Shuffle: one hunt made of several short rounds in different games.
 *
 * This is the anti-habituation layer, and it matters more than any single
 * game. A cat that plays the same thing for six minutes every day stops
 * responding to it within a week or two — the prey becomes predictable, and
 * predictable prey isn't prey. Rotating on a timer the cat can't anticipate,
 * with a dark rest beat between rounds, keeps every round an opening move.
 *
 * The rest beats aren't padding either. Real hunting is bursts separated by
 * stillness; running a cat flat out for six unbroken minutes is how you end
 * up with an over-aroused cat instead of a satisfied one.
 */

export interface Round {
  game: GameModule;
  seconds: number;
}

/** Dark pause between rounds, so a swat can't carry into the next game. */
export const REST_SECONDS = 4;

/**
 * How interesting a game looks for this cat right now.
 *
 * Three things move it: whether it suits their play style, how hard they
 * actually swatted last time they played it, and how long it's been. The
 * recency term is what stops a favourite from crowding everything else out —
 * a game the cat loves but played an hour ago is worth less than the same
 * game untouched for a week.
 */
function weight(game: GameModule, cat: CatProfile) {
  const a = getAffinity(cat.id, game.id);
  let w = 1;
  if (game.suits.includes(cat.style)) w *= 1.6;

  // Engagement, relative to the neutral prior. Clamped hard: this should tilt
  // the odds, never turn the shuffle into a single-game rut.
  w *= clamp(a.rate / NEUTRAL_RATE, 0.55, 1.9);

  // Novelty. Never played is a real draw; played minutes ago is a real penalty.
  if (a.rounds === 0) w *= 1.5;
  else {
    const hours = (Date.now() - a.last) / 3.6e6;
    w *= clamp(0.45 + hours / 12, 0.45, 1.35);
  }
  return w;
}

function weightedPick(pool: GameModule[], cat: CatProfile) {
  const ws = pool.map((g) => weight(g, cat));
  let r = Math.random() * ws.reduce((s, x) => s + x, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= ws[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * Build a rotation filling roughly `total` seconds of actual play.
 *
 * Round lengths are jittered on purpose. A fixed 90-second rotation is
 * something a cat learns to sit out; an unpredictable one isn't.
 */
export function buildShuffle(cat: CatProfile, total: number): Round[] {
  const pool = GAMES.filter((g) => g.create);
  if (!pool.length) return [];

  // Pouncers burn hot and lose interest fast, so give them shorter rounds and
  // more switches. Watchers need time to settle in before they commit.
  const [lo, hi] =
    cat.style === "pouncer" ? [62, 96] : [95, 140];

  const rounds: Round[] = [];
  let left = total;
  let prev: GameModule | null = null;

  while (left > 25) {
    // Avoid an immediate repeat where there's anything else to play.
    const choices = pool.length > 1 ? pool.filter((g) => g !== prev) : pool;
    const game = weightedPick(choices, cat);
    const seconds = Math.min(left, Math.round(rand(hi, lo)));
    // Don't leave a stub round; fold a short remainder into this one.
    rounds.push({ game, seconds: left - seconds < 25 ? left : seconds });
    left -= rounds[rounds.length - 1].seconds;
    prev = game;
  }
  return rounds;
}
