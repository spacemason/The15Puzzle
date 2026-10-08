// Races (the hub's `hub.race`, see diffenderfer-games docs/multiplayer.md
// "Races"): two players get the same scramble — the hub picks a shared seed,
// the creator picks the difficulty — and whoever solves it first wins.
//
// The hub does the matching, the waiting card (code / Invite / Cancel),
// invites, the 3-2-1, the live HUD (both players' moves), the referee, the
// result card and the race history. This module only:
//   - registers `hub.race.define` once at boot (the hub calls `start` when the
//     countdown begins, `end` when the race is decided, `exit` when the player
//     leaves the race screens), and
//   - keeps the current race in a tiny store the Race route renders from.
import { hub } from "./hub/hub";
import type { RaceResult, RaceStart } from "./hub/hub";
import { mulberry32 } from "./rng";

/** Scramble difficulties a racer can pick (game.race.params "scramble" in package.json). */
export const SCRAMBLES = [
  { value: 25, title: "Easy" },
  { value: 60, title: "Medium" },
  { value: 150, title: "Hard" },
] as const;
export const DEFAULT_SCRAMBLE = 60;

export interface RaceSnapshot {
  start: RaceStart | null;
  result: RaceResult | null;
}

let state: RaceSnapshot = { start: null, result: null };
const listeners = new Set<() => void>();

function set(next: Partial<RaceSnapshot>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** The current race (for useSyncExternalStore). */
export const raceStore = {
  get: (): RaceSnapshot => state,
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

/** The scramble's move count from the race params (only declared values reach us). */
export function scrambleOf(start: RaceStart): number {
  const n = Number(start.params.scramble);
  return SCRAMBLES.some((s) => s.value === n) ? n : DEFAULT_SCRAMBLE;
}

/** Same seed + scramble → the same board for every racer. */
export function raceRng(start: RaceStart): () => number {
  return mulberry32(start.seed >>> 0);
}

let defined = false;
/**
 * Register the race handlers once. `go` shows the race screen (the router's
 * navigate). Safe to call before the hub's live runtime has loaded.
 */
export function initRace(go: () => void): void {
  if (defined) return;
  defined = true;
  hub.race.define({
    start: (start) => { set({ start, result: null }); go(); },
    end: (result) => set({ result }),
    exit: () => { set({ start: null, result: null }); go(); },
    hud: { place: "top" },
  });
}
