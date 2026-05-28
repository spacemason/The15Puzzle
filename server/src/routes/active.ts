import { Hono } from "hono";
import { db } from "../db.js";
import { requireUser } from "../auth.js";
import type { Board, ActiveGame } from "@p15/shared";

const app = new Hono();

app.get("/:puzzleId", (c) => {
  const user = requireUser(c);
  const puzzleId = Number(c.req.param("puzzleId"));
  const row = db
    .prepare(
      `SELECT board, moves, started_at, last_updated
       FROM active_games WHERE user_id = ? AND puzzle_id = ?`,
    )
    .get(user.id, puzzleId) as
    | { board: string; moves: number; started_at: number; last_updated: number }
    | undefined;
  if (!row) return c.json({ active: null });
  const active: ActiveGame = {
    puzzleId,
    board: JSON.parse(row.board) as Board,
    moves: row.moves,
    startedAt: row.started_at,
    lastUpdated: row.last_updated,
  };
  return c.json({ active });
});

app.put("/:puzzleId", async (c) => {
  const user = requireUser(c);
  const puzzleId = Number(c.req.param("puzzleId"));
  const body = (await c.req.json()) as {
    board?: Board;
    moves?: number;
    startedAt?: number;
  };
  if (!Array.isArray(body.board) || body.board.length !== 16)
    return c.json({ error: "Invalid board." }, 400);
  if (typeof body.moves !== "number" || body.moves < 0)
    return c.json({ error: "Invalid moves." }, 400);
  const startedAt = typeof body.startedAt === "number" ? body.startedAt : Date.now();
  const now = Date.now();

  db.prepare(
    `INSERT INTO active_games (user_id, puzzle_id, board, moves, started_at, last_updated)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, puzzle_id) DO UPDATE SET
       board = excluded.board,
       moves = excluded.moves,
       last_updated = excluded.last_updated`,
  ).run(user.id, puzzleId, JSON.stringify(body.board), body.moves, startedAt, now);

  return c.json({ ok: true });
});

app.delete("/:puzzleId", (c) => {
  const user = requireUser(c);
  const puzzleId = Number(c.req.param("puzzleId"));
  db.prepare("DELETE FROM active_games WHERE user_id = ? AND puzzle_id = ?").run(
    user.id,
    puzzleId,
  );
  return c.json({ ok: true });
});

export default app;
