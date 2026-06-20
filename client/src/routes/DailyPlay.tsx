import { useCallback, useEffect, useRef, useState } from "react";
import type { Board, PuzzleFull } from "@p15/shared";
import { applyMove, areAdjacent, findZero, isSolved, neighborForDirection, scramble } from "@p15/shared";
import { hub } from "../hub/hub";
import { BoardView } from "../components/Board";

/**
 * Daily challenge — a self-contained seeded sliding-puzzle board, separate from
 * the server's puzzle library. The day's `seed` (from hub.daily.active) drives a
 * deterministic scramble, so everyone gets the same board; solving it records
 * the day via hub.daily.complete(). No server puzzle/solve, no account required
 * (the hub guest carries the completion).
 */

// Seeded PRNG so the scramble is identical for everyone on a given day.
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reuse the same 'play' input group as the normal play screen (keyboard / d-pad
// / gamepad slide the blank). Guarded so repeated mounts don't redefine.
let dailyInputReady = false;
function ensureDailyInput(): void {
  if (dailyInputReady) return;
  dailyInputReady = true;
  hub.input.define({
    groups: {
      play: {
        inputs: {
          up: { keys: ["w", "arrowup"], gamepad: { button: 12 }, touch: { stick: "dpad", axis: "y-" } },
          down: { keys: ["s", "arrowdown"], gamepad: { button: 13 }, touch: { stick: "dpad", axis: "y+" } },
          left: { keys: ["a", "arrowleft"], gamepad: { button: 14 }, touch: { stick: "dpad", axis: "x-" } },
          right: { keys: ["d", "arrowright"], gamepad: { button: 15 }, touch: { stick: "dpad", axis: "x+" } },
        },
        virtual: [],
      },
    },
  });
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function DailyPlay() {
  const active = hub.daily.active;
  // No active challenge (e.g. a direct refresh of /daily) — send them home.
  useEffect(() => {
    if (!active) window.location.href = import.meta.env.BASE_URL || "/";
  }, [active]);
  if (!active) return <div className="empty-state">Loading daily challenge…</div>;

  return <DailyBoard day={active.day} seed={active.seed} />;
}

function DailyBoard({ day, seed }: { day: string; seed: number }) {
  // Difficulty scales with the seed: 40..119 scramble moves. scramble() applies
  // real moves from the solved state, so the board is always solvable.
  const [board, setBoard] = useState<Board>(() => scramble(40 + (seed % 80), mulberry32(seed >>> 0)));
  const [moves, setMoves] = useState(0);
  const [startedAt] = useState<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());
  const [solvedAt, setSolvedAt] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (solvedAt != null) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [solvedAt]);

  const tryMove = useCallback(
    (tileIdx: number) => {
      if (solvedAt != null) return;
      const z = findZero(board);
      if (!areAdjacent(tileIdx, z)) return;
      const next = applyMove(board, tileIdx);
      const nextMoves = moves + 1;
      setBoard(next);
      setMoves(nextMoves);
      if (isSolved(next)) {
        const at = Date.now();
        setSolvedAt(at);
        void hub.daily.complete({ moves: nextMoves, timeMs: at - startedAt });
      }
    },
    [board, moves, solvedAt, startedAt],
  );

  // Directional slides via the hub input system, read each frame off our own loop.
  const moveRef = useRef({ board, solvedAt, tryMove });
  moveRef.current = { board, solvedAt, tryMove };
  useEffect(() => {
    ensureDailyInput();
    hub.input.enable("play");
    let raf = 0;
    const dirs = ["up", "down", "left", "right"] as const;
    const loop = () => {
      const { board: b, solvedAt: solved, tryMove: move } = moveRef.current;
      if (b && solved == null) {
        for (const dir of dirs) {
          if (hub.input.down(dir)) {
            const target = neighborForDirection(b, dir);
            if (target != null) move(target);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      hub.input.disable("play");
    };
  }, []);

  // A numbers-only puzzle stub (no server images) for BoardView.
  const puzzle: PuzzleFull = {
    id: -1, name: `Daily — ${day}`, difficulty: 40 + (seed % 80), optimalMoves: 0,
    builtIn: true, creatorId: null, creatorName: null, showNumbers: true,
    hasBgImage: false, hasCompleteImage: false, hasTileImages: false, solved: false,
    initialBoard: board, style: {}, bgImageUrl: null, completeImageUrl: null,
    tileImageUrls: Array(15).fill(null),
  };

  const elapsed = (solvedAt ?? now) - startedAt;

  return (
    <div className="play-page">
      <div className="play-side">
        <div className="card">
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>Daily challenge</div>
          <div style={{ color: "var(--fg-dim)", fontSize: 13 }}>{day}</div>
        </div>
        <div className="stat"><span className="label">Moves</span><span className="value">{moves}</span></div>
        <div className="stat"><span className="label">Time</span><span className="value">{fmtMs(elapsed)}</span></div>
      </div>

      <div className="board-frame" ref={boardRef}>
        <BoardView
          puzzle={puzzle}
          board={board}
          size={Math.min(480, Math.floor(window.innerWidth - 60))}
          onTileClick={tryMove}
          isSolved={solvedAt != null}
        />
        {solvedAt != null ? (
          <div className="solved-overlay">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 44 }}>✓</div>
              <div>Daily solved in {fmtMs(elapsed)}</div>
              <div style={{ fontSize: 14, color: "var(--good)", opacity: 0.85 }}>{moves} moves</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="play-side">
        <button className="btn" onClick={() => { window.location.href = "/"; }}>← All games</button>
      </div>
    </div>
  );
}
