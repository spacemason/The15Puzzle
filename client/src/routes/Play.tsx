import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import type { Board, PuzzleFull } from "@p15/shared";
import { applyMove, areAdjacent, findZero, isSolved, neighborForDirection, solve } from "@p15/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { BoardView } from "../components/Board";
import { GiveUpModal } from "../components/GiveUpModal";
import { ParticleBurst } from "../components/ParticleBurst";

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function PlayPage() {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const nav = useNavigate();
  const { user, setUser } = useAuth();

  const [puzzle, setPuzzle] = useState<PuzzleFull | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [moves, setMoves] = useState(0);
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());
  const [solvedAt, setSolvedAt] = useState<number | null>(null);
  const [autoSolving, setAutoSolving] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [giveUpOpen, setGiveUpOpen] = useState(false);
  const [particleOrigin, setParticleOrigin] = useState<{ x: number; y: number } | undefined>();
  const [error, setError] = useState<string | null>(null);

  const boardRef = useRef<HTMLDivElement | null>(null);

  // Tick the timer
  useEffect(() => {
    if (solvedAt != null || gaveUp) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [solvedAt, gaveUp]);

  // Load puzzle + active state
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { puzzle: p } = await api.getPuzzle(id);
        if (!alive) return;
        setPuzzle(p);
        const { active } = await api.getActive(id);
        if (!alive) return;
        if (active && !isSolved(active.board)) {
          setBoard(active.board);
          setMoves(active.moves);
          setStartedAt(active.startedAt);
        } else {
          setBoard(p.initialBoard.slice());
          const s = Date.now();
          setStartedAt(s);
          setMoves(0);
          // Persist a fresh active state so refresh keeps the start time stable.
          api.putActive(id, { board: p.initialBoard, moves: 0, startedAt: s }).catch(() => {});
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Save active state after every move (debounced via direct call — frequent saves are fine)
  const saveActive = useCallback(
    (b: Board, m: number, s: number) => {
      if (!puzzle) return;
      api.putActive(puzzle.id, { board: b, moves: m, startedAt: s }).catch(() => {});
    },
    [puzzle],
  );

  const recordSolveOnServer = useCallback(
    async (totalMoves: number, durationMs: number) => {
      if (!puzzle) return;
      try {
        await api.recordSolve(puzzle.id, totalMoves, durationMs);
      } catch {
        // ignore — UI already reflects solved
      }
    },
    [puzzle],
  );

  const handleSolved = useCallback(
    (totalMoves: number, finalBoard: Board) => {
      const at = Date.now();
      setSolvedAt(at);
      const dur = at - startedAt;
      // Trigger particles centered on the board
      const rect = boardRef.current?.getBoundingClientRect();
      if (rect) {
        setParticleOrigin({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }
      recordSolveOnServer(totalMoves, dur);
      void finalBoard;
    },
    [startedAt, recordSolveOnServer],
  );

  const tryMove = useCallback(
    (tileIdx: number) => {
      if (!board || solvedAt != null || autoSolving) return;
      const z = findZero(board);
      if (!areAdjacent(tileIdx, z)) return;
      const next = applyMove(board, tileIdx);
      const nextMoves = moves + 1;
      setBoard(next);
      setMoves(nextMoves);
      saveActive(next, nextMoves, startedAt);
      if (isSolved(next)) {
        handleSolved(nextMoves, next);
      }
    },
    [board, moves, solvedAt, autoSolving, saveActive, startedAt, handleSolved],
  );

  // Keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!board || solvedAt != null || autoSolving) return;
      let dir: "up" | "down" | "left" | "right" | null = null;
      if (e.key === "ArrowUp" || e.key === "w") dir = "up";
      else if (e.key === "ArrowDown" || e.key === "s") dir = "down";
      else if (e.key === "ArrowLeft" || e.key === "a") dir = "left";
      else if (e.key === "ArrowRight" || e.key === "d") dir = "right";
      if (!dir) return;
      e.preventDefault();
      const target = neighborForDirection(board, dir);
      if (target != null) tryMove(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board, solvedAt, autoSolving, tryMove]);

  // Give up = run solver, animate the moves, mark as not-counted
  const beginAutoSolve = useCallback(async () => {
    if (!board || !puzzle) return;
    setGiveUpOpen(false);
    setAutoSolving(true);
    // Yield so React paints the "Solving…" state before the synchronous solver runs.
    await new Promise((r) => setTimeout(r, 0));
    const { moves: seq } = solve(board);
    let cur = board.slice();
    for (let i = 0; i < seq.length; i++) {
      const tileValue = seq[i]!;
      const idx = cur.indexOf(tileValue);
      cur = applyMove(cur, idx);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 140));
      setBoard(cur.slice());
    }
    await api.deleteActive(puzzle.id).catch(() => {});
    setAutoSolving(false);
    setGaveUp(true);
  }, [board, puzzle]);

  if (error) return <div className="empty-state">Could not load puzzle: {error}</div>;
  if (!puzzle || !board) return <div className="empty-state">Loading…</div>;

  const elapsed = solvedAt != null ? solvedAt - startedAt : now - startedAt;
  const accuracy =
    moves > 0 ? Math.min(1, puzzle.optimalMoves / moves) : 0;
  const hideTimer = user?.hideTimer ?? false;

  const toggleHideTimer = async () => {
    if (!user) return;
    const next = !user.hideTimer;
    try {
      const { user: u } = await api.updateMe({ hideTimer: next });
      setUser(u);
    } catch {
      // ignore
    }
  };

  return (
    <div className="play-page">
      <div className="play-side">
        <div className="card">
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>{puzzle.name}</div>
          <div style={{ color: "var(--fg-dim)", fontSize: 13 }}>
            scramble {puzzle.difficulty} · optimal {puzzle.optimalMoves}
          </div>
        </div>
        <div className="stat">
          <span className="label">Moves</span>
          <span className="value">{moves}</span>
        </div>
        <div className="stat">
          <span className="label">Accuracy</span>
          <span className="value">{moves > 0 ? `${Math.round(accuracy * 100)}%` : "—"}</span>
        </div>
        <div className="toggle-row">
          <span style={{ fontSize: 13, color: "var(--fg-dim)" }}>Hide timer</span>
          <div
            className={`toggle ${user?.hideTimer ? "on" : ""}`}
            onClick={toggleHideTimer}
            role="button"
            tabIndex={0}
          />
        </div>
      </div>

      <motion.div
        className="board-frame"
        ref={boardRef as any}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <BoardView
          puzzle={puzzle}
          board={board}
          size={Math.min(480, Math.floor(window.innerWidth - 60))}
          onTileClick={tryMove}
          isSolved={solvedAt != null}
        />
        {solvedAt != null ? (
          <motion.div
            className="solved-overlay"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 44 }}>✓</div>
              <div>Solved in {fmtMs(elapsed)}</div>
              <div style={{ fontSize: 14, color: "var(--good)", opacity: 0.85 }}>
                {moves} moves · {Math.round(accuracy * 100)}% accuracy
              </div>
            </div>
          </motion.div>
        ) : null}
      </motion.div>

      <div className="play-side">
        <div className="stat">
          <span className="label">Time</span>
          <span className="value">{hideTimer && solvedAt == null ? "—" : fmtMs(elapsed)}</span>
        </div>
        <button className="btn" onClick={() => nav("/puzzles")}>
          ← Back to puzzles
        </button>
        {solvedAt == null && !autoSolving && !gaveUp ? (
          <button className="btn btn-danger" onClick={() => setGiveUpOpen(true)}>
            Give up
          </button>
        ) : null}
        {autoSolving ? <div className="stat"><span className="label">Status</span><span className="value">Solving…</span></div> : null}
        {gaveUp ? (
          <div className="stat" style={{ borderColor: "var(--warn)" }}>
            <span className="label">Status</span>
            <span className="value" style={{ color: "var(--warn)" }}>Gave up — didn’t count</span>
          </div>
        ) : null}
      </div>

      <GiveUpModal
        open={giveUpOpen}
        onCancel={() => setGiveUpOpen(false)}
        onConfirm={beginAutoSolve}
      />
      <ParticleBurst active={solvedAt != null} origin={particleOrigin} />
    </div>
  );
}
