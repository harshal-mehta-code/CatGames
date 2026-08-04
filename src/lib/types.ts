/** Contract every game module implements. Keep this small — it's the thing
 *  that lets the library grow without the shell needing to know anything. */

export type PawPhase = "down" | "move" | "up";

export interface PawEvent {
  id: number;
  x: number;
  y: number;
  /** Contact radius in CSS px. Real paw pads report ~20-45px on an iPad. */
  r: number;
  /** 0..1 where available, else 0.5. iPadOS only reports this for Pencil. */
  force: number;
  phase: PawPhase;
  /** Speed of the contact in px/s — a fast swat reads differently to a rest. */
  vx: number;
  vy: number;
}

/** Reported upward so the shuffle layer can learn what each cat likes. */
export type GameEvent =
  | { type: "hit"; value?: number }
  | { type: "miss" }
  | { type: "near-miss" }
  | { type: "engage" };

export type PlayStyle = "pouncer" | "watcher";

export interface CatProfile {
  id: string;
  name: string;
  /** Hue used for that cat's UI accent. Chosen from the blue/amber band. */
  hue: number;
  style: PlayStyle;
  /** 0..1, nudged automatically by hit rate during play. */
  skill: number;
}

export interface GameHost {
  width: number;
  height: number;
  dpr: number;
  profile: CatProfile;
  report: (e: GameEvent) => void;
}

export interface GameInstance {
  update: (dt: number, t: number) => void;
  render: (g: CanvasRenderingContext2D) => void;
  paw: (e: PawEvent) => void;
  resize: (w: number, h: number) => void;
  dispose?: () => void;
}

export interface GameModule {
  id: string;
  title: string;
  /** One line for the human picking a game. */
  tagline: string;
  /** Which cat this suits, used to order the launcher and weight shuffle. */
  suits: PlayStyle[];
  /** Background colour behind the canvas while loading. */
  backdrop: string;
  accent: string;
  create: (host: GameHost) => GameInstance;
}
