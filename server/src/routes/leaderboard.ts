import { Hono } from "hono";
import { db } from "../db.js";

const app = new Hono();

app.get("/", (c) => {
  const rows = db
    .prepare(
      `SELECT u.id as user_id, u.username,
              COUNT(s.id) as solve_count,
              MIN(s.duration_ms) as best_time_ms,
              AVG(CAST(s.optimal_moves AS REAL) / CAST(s.moves AS REAL)) as avg_accuracy
       FROM users u
       LEFT JOIN solves s ON s.user_id = u.id
       GROUP BY u.id
       ORDER BY solve_count DESC, best_time_ms ASC
       LIMIT 50`,
    )
    .all() as Array<{
      user_id: number;
      username: string;
      solve_count: number;
      best_time_ms: number | null;
      avg_accuracy: number | null;
    }>;

  return c.json({
    entries: rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      solveCount: r.solve_count,
      bestTimeMs: r.best_time_ms,
      avgAccuracy: r.avg_accuracy,
    })),
  });
});

export default app;
