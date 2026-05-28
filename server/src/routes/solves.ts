import { Hono } from "hono";
import { db } from "../db.js";
import { requireUser } from "../auth.js";

const app = new Hono();

// POST /api/solves  — record a solve (idempotent; if already solved, returns existing)
app.post("/", async (c) => {
  const user = requireUser(c);
  const body = (await c.req.json()) as {
    puzzleId?: number;
    moves?: number;
    durationMs?: number;
  };
  const puzzleId = Number(body.puzzleId);
  const moves = Number(body.moves);
  const durationMs = Math.max(0, Number(body.durationMs ?? 0));
  if (!puzzleId || !moves || moves <= 0)
    return c.json({ error: "Invalid solve payload." }, 400);

  const puzzle = db
    .prepare("SELECT optimal_moves FROM puzzles WHERE id = ?")
    .get(puzzleId) as { optimal_moves: number } | undefined;
  if (!puzzle) return c.json({ error: "Puzzle not found." }, 404);

  const existing = db
    .prepare("SELECT id FROM solves WHERE user_id = ? AND puzzle_id = ?")
    .get(user.id, puzzleId) as { id: number } | undefined;
  if (existing) {
    // Already solved — community rule: once per user per puzzle. No-op.
    db.prepare(
      "DELETE FROM active_games WHERE user_id = ? AND puzzle_id = ?",
    ).run(user.id, puzzleId);
    return c.json({ ok: true, alreadySolved: true });
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO solves (user_id, puzzle_id, moves, optimal_moves, duration_ms, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(user.id, puzzleId, moves, puzzle.optimal_moves, durationMs, now);

  db.prepare("DELETE FROM active_games WHERE user_id = ? AND puzzle_id = ?").run(
    user.id,
    puzzleId,
  );

  return c.json({ ok: true, alreadySolved: false, optimalMoves: puzzle.optimal_moves });
});

// GET /api/solves/me  — list my solves
app.get("/me", (c) => {
  const user = requireUser(c);
  const rows = db
    .prepare(
      `SELECT s.id, s.puzzle_id, p.name as puzzle_name, s.moves, s.optimal_moves,
              s.duration_ms, s.completed_at
       FROM solves s
       JOIN puzzles p ON p.id = s.puzzle_id
       WHERE s.user_id = ?
       ORDER BY s.completed_at DESC`,
    )
    .all(user.id) as Array<{
      id: number;
      puzzle_id: number;
      puzzle_name: string;
      moves: number;
      optimal_moves: number;
      duration_ms: number;
      completed_at: number;
    }>;
  return c.json({
    solves: rows.map((r) => ({
      id: r.id,
      puzzleId: r.puzzle_id,
      puzzleName: r.puzzle_name,
      moves: r.moves,
      optimalMoves: r.optimal_moves,
      durationMs: r.duration_ms,
      completedAt: r.completed_at,
    })),
  });
});

export default app;
