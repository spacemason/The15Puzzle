# CLAUDE.md — agent notes for The 15 Puzzle

A process app (`server/` + `client/` + `shared/` workspaces) served by the
diffenderfer.games hub (the sibling `diffenderfer-games` repo). The hub's
`HANDOFF.md`, `docs/hub.md` and `docs/multiplayer.md` are the canonical game
contract and hub API.

- **Never stage `server/data.db*`** (tracked SQLite + WAL files that change whenever
  the server runs). `git add` only the files you changed. Tests set `P15_DB_PATH`
  to a throwaway database.
- **The hub client is vendored** in `client/src/hub/` (`hub.ts input.ts overlay.ts
  legacy.ts daily.ts uistack.ts` + `social/rt-types.ts`). Never edit it here:
  re-copy it from the hub's `clients/` when the hub changes it, then `npm run build`.
- Player-facing notes go in `package.json` `game.changes` (the hub's What's new).

## Races (multiplayer by racing) — implemented

The 15 Puzzle is the hub's first race game (hub docs: `docs/multiplayer.md` §14,
design + contract `docs/plans/race.md`).

- **Manifest:** `game.race` in `package.json`: 2 players, param `scramble`
  (Easy 25 / Medium 60 / Hard 150 random moves from solved), stats `moves`
  ("Moves") and `placed` ("Placed": tiles home), `minMs` 3000.
- **Code:** `client/src/race.ts` registers `hub.race.define` once (from `App.tsx`)
  and keeps the current race in a tiny store; `client/src/routes/Race.tsx` is the
  Race screen (scramble picker, Private toggle, Start a race, Join with a code,
  Your races, the Open races list) and the race board. The Landing page has the
  **🏁 Race** button. `?race=lobby` (race invites / Join) routes to `/race`
  keeping the query so the hub can read its launch token.
- **Fairness:** the board is `scramble(n, mulberry32(seed))` (`client/src/rng.ts`),
  the same for both racers. Progress = 1 − manhattan distance ÷ the start's.
  The board is fixed at 4×4 (`SIZE` in `shared/src/types.ts`); a board-size param
  would need that to become variable.
- **The hub draws** the waiting card, countdown, the live HUD (both players' moves),
  Give up, the result card and the race history. The game reports
  `hub.race.status({moves, placed}, progress)` and `hub.race.finish(...)`, and has
  its own Give up button (`hub.race.forfeit()`).
- **Tests:** `npm run test:hub` (`tests/hub/race.test.mjs`) boots a real hub with
  this game linked in (needs the sibling `diffenderfer-games` checkout, or
  `DG_HOST=<path>`) and races two browsers end to end.
