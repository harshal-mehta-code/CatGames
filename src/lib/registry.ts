import type { GameModule } from "./types";
import { bugHunt } from "@/games/bug-hunt";
import { underSheet } from "@/games/under-sheet";
import { mouseHole } from "@/games/mouse-hole";

/** Add a module here and it appears in the launcher and the shuffle. */
export const GAMES: GameModule[] = [bugHunt, underSheet, mouseHole];

export const getGame = (id: string) => GAMES.find((g) => g.id === id);
