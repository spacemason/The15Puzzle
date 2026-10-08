import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Board, PuzzleFull } from "@p15/shared";
import { SIZE, applyMove, areAdjacent, findZero, isSolved, neighborForDirection, scramble } from "@p15/shared";
import { hub } from "../hub/hub";
import type { RaceStart, RoomInfo } from "../hub/hub";
import { BoardView } from "../components/Board";
import { ensureDailyInput } from "./DailyPlay";
import { DEFAULT_SCRAMBLE, SCRAMBLES, raceRng, raceStore, scrambleOf } from "../race";

/**
 * Race a friend (the hub's `hub.race`): pick a scramble, start a race (the
 * hub shows the waiting card with Invite / code / Cancel) or join an open
 * one. When the countdown starts, both racers get the same board from the
 * hub's shared seed; the hub's HUD shows both players' moves live, and the
 * first to solve wins. No 15-puzzle account needed — the hub account races.
 */
export function RacePage() {
  const { start } = useSyncExternalStore(raceStore.subscribe, raceStore.get);
  return start ? <RaceBoard key={`${start.roomId}:${start.round}`} start={start} /> : <RaceMenu />;
}

// ---------------------------------------------------------------------------
// The race menu: difficulty picker, start / join, open races, history.
// ---------------------------------------------------------------------------

function RaceMenu() {
  const [scrambleMoves, setScramble] = useState<number>(DEFAULT_SCRAMBLE);
  const [privateRace, setPrivate] = useState(false);
  const [open, setOpen] = useState<RoomInfo[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Open races in this game, refreshed while the menu is up.
  useEffect(() => {
    let alive = true;
    const load = () => hub.race.list().then((r) => { if (alive) setOpen(r); }, () => { if (alive) setOpen([]); });
    void load();
    const t = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const startRace = async () => {
    setBusy(true);
    setError("");
    try {
      await hub.race.create({ params: { scramble: scrambleMoves }, public: !privateRace });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a race.");
    } finally {
      setBusy(false);
    }
  };
  const join = async (code: string) => {
    setError("");
    try { await hub.race.join(code); } catch (err) { setError(err instanceof Error ? err.message : "Couldn't join."); }
  };
  const titleOf = (n: unknown) => SCRAMBLES.find((s) => s.value === n)?.title ?? "";

  return (
    <div className="race-page">
      <div className="card race-card">
        <h2 className="race-title">🏁 Race a friend</h2>
        <p className="race-sub">Same scramble for both of you. First to solve it wins.</p>

        <div className="race-label">Scramble</div>
        <div className="race-seg" role="group" aria-label="Scramble" data-testid="race-scrambles">
          {SCRAMBLES.map((s) => (
            <button
              key={s.value}
              className={`btn ${scrambleMoves === s.value ? "btn-primary" : ""}`}
              aria-pressed={scrambleMoves === s.value}
              data-testid={`race-scramble-${s.title.toLowerCase()}`}
              onClick={() => setScramble(s.value)}
            >
              {s.title}
            </button>
          ))}
        </div>

        <label className="toggle-row race-private">
          <span>Private race (invite a friend or share the code)</span>
          <button
            type="button"
            className={`toggle ${privateRace ? "on" : ""}`}
            aria-pressed={privateRace}
            aria-label="Private race"
            data-testid="race-private"
            onClick={() => setPrivate((v) => !v)}
          />
        </label>

        <div className="race-actions">
          <button className="btn btn-primary" disabled={busy} data-testid="race-start" onClick={startRace}>
            Start a race
          </button>
          <button className="btn" data-testid="race-browse" onClick={() => hub.race.browse()}>Join with a code</button>
          <button className="btn btn-ghost" data-testid="race-history" onClick={() => hub.race.openHistory()}>📜 Your races</button>
        </div>
        {error ? <div className="race-error" role="alert">{error}</div> : null}
      </div>

      <div className="card race-card">
        <h3 className="race-h3">Open races</h3>
        {open === null ? (
          <div className="race-dim">Looking for races…</div>
        ) : open.length === 0 ? (
          <div className="race-dim">No open races right now. Start one, and anyone playing can join it here.</div>
        ) : (
          <ul className="race-list" data-testid="race-open">
            {open.map((r) => {
              const host = r.seats.find((s) => s.userId === r.hostId) ?? r.seats[0];
              return (
                <li key={r.id}>
                  <button className="race-name" onClick={() => host && hub.social.openPlayer({ userId: host.userId })}>
                    {host ? host.name : "Racer"}
                  </button>
                  <span className="race-dim">{titleOf(r.race?.params.scramble)} · {r.seats.length}/{r.maxPlayers}</span>
                  <button className="btn btn-primary race-join" onClick={() => join(r.code)}>Join</button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The race board: the shared scramble, locked until the go.
// ---------------------------------------------------------------------------

/** Sum of every tile's distance from home: 0 when solved. */
function distance(b: Board): number {
  let d = 0;
  for (let i = 0; i < b.length; i++) {
    const v = b[i]!;
    if (v === 0) continue;
    const home = v - 1;
    d += Math.abs(Math.floor(home / SIZE) - Math.floor(i / SIZE)) + Math.abs((home % SIZE) - (i % SIZE));
  }
  return d;
}

function placed(b: Board): number {
  let n = 0;
  for (let i = 0; i < b.length; i++) if (b[i] !== 0 && b[i] === i + 1) n++;
  return n;
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function RaceBoard({ start }: { start: RaceStart }) {
  const { result } = useSyncExternalStore(raceStore.subscribe, raceStore.get);
  const [board, setBoard] = useState<Board>(() => scramble(scrambleOf(start), raceRng(start)));
  const startDist = useRef(Math.max(1, distance(board)));
  const [moves, setMoves] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [solvedAt, setSolvedAt] = useState<number | null>(null);
  const [out, setOut] = useState(false);
  const [iWon, setIWon] = useState(false);
  const live = now >= start.startAt && solvedAt == null && !result && !out;
  // Read-only hook for the hub race tests (tests/hub/race.test.mjs).
  (window as unknown as { __P15_RACE__?: unknown }).__P15_RACE__ = { board, moves, live, seed: start.seed, startAt: start.startAt };

  useEffect(() => {
    if (solvedAt != null || result) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [solvedAt, result]);

  // A resumed race (page reload) starts from the beginning of the same board.
  const tryMove = useCallback(
    (tileIdx: number) => {
      if (!live) return;
      const z = findZero(board);
      if (!areAdjacent(tileIdx, z)) return;
      const next = applyMove(board, tileIdx);
      const nextMoves = moves + 1;
      setBoard(next);
      setMoves(nextMoves);
      const stats = { moves: nextMoves, placed: placed(next) };
      if (isSolved(next)) {
        setSolvedAt(Date.now());
        void hub.race.finish(stats).then((r) => setIWon(Boolean(r)), () => {});
      } else {
        hub.race.status(stats, Math.max(0, 1 - distance(next) / startDist.current));
      }
    },
    [board, moves, live],
  );

  // Keyboard / d-pad / gamepad slides, like the daily board.
  const moveRef = useRef({ board, tryMove });
  moveRef.current = { board, tryMove };
  useEffect(() => {
    ensureDailyInput();
    hub.input.enable("play");
    let raf = 0;
    const dirs = ["up", "down", "left", "right"] as const;
    const loop = () => {
      const { board: b, tryMove: move } = moveRef.current;
      for (const dir of dirs) {
        if (hub.input.down(dir)) {
          const target = neighborForDirection(b, dir);
          if (target != null) move(target);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); hub.input.disable("play"); };
  }, []);

  const giveUp = () => {
    setOut(true);
    void hub.race.forfeit().catch(() => {});
  };

  const puzzle: PuzzleFull = {
    id: -2, name: "Race", difficulty: scrambleOf(start), optimalMoves: 0,
    builtIn: true, creatorId: null, creatorName: null, showNumbers: true,
    hasBgImage: false, hasCompleteImage: false, hasTileImages: false, solved: false,
    initialBoard: board, style: {}, bgImageUrl: null, completeImageUrl: null,
    tileImageUrls: Array(15).fill(null),
  };
  // The clock stops when I solve it, or when the race is decided without me.
  const frozen = solvedAt != null ? solvedAt - start.startAt : result ? result.durationMs : null;
  const elapsed = frozen ?? Math.max(0, now - start.startAt);
  const scrambleTitle = SCRAMBLES.find((s) => s.value === scrambleOf(start))?.title ?? "";

  return (
    <div className="play-page race-board-page">
      <div className="play-side">
        <div className="card">
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>🏁 Race</div>
          <div style={{ color: "var(--fg-dim)", fontSize: 13 }}>{scrambleTitle} scramble · same board for everyone</div>
        </div>
        <div className="stat"><span className="label">Moves</span><span className="value" data-testid="race-moves">{moves}</span></div>
        <div className="stat"><span className="label">Time</span><span className="value">{fmtMs(elapsed)}</span></div>
      </div>

      <div className="board-frame">
        <BoardView
          puzzle={puzzle}
          board={board}
          size={Math.min(480, Math.floor(window.innerWidth - 100))}
          onTileClick={tryMove}
          isSolved={solvedAt != null}
        />
        {now < start.startAt ? <div className="race-lock">Get ready…</div> : null}
        {solvedAt != null ? (
          <div className="solved-overlay">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 44 }}>✓</div>
              <div>{iWon ? "You won!" : "Solved!"}</div>
              <div style={{ fontSize: 14, opacity: 0.85 }}>{moves} moves</div>
            </div>
          </div>
        ) : result || out ? (
          <div className="race-lock race-over">Race over</div>
        ) : null}
      </div>

      <div className="play-side">
        {live ? <button className="btn" data-testid="race-giveup" onClick={giveUp}>🏳️ Give up</button> : null}
      </div>
    </div>
  );
}
