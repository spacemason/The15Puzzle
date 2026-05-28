import { scramble, solve } from "@p15/shared";
import type { Board } from "@p15/shared";
import { db, tx } from "./db.js";

// Difficulty levels (scramble move counts) for the 10 built-in puzzles.
// Optimal-solution length will be at most this; IDA* with linear conflict
// solves all of these very quickly.
const DIFFICULTIES = [8, 12, 16, 22, 28, 35, 42, 50, 60, 70];

function difficultyLabel(d: number): string {
  if (d <= 12) return "Easy";
  if (d <= 22) return "Casual";
  if (d <= 35) return "Medium";
  if (d <= 50) return "Hard";
  return "Brutal";
}

interface GeneratedPuzzle {
  name: string;
  board: Board;
  difficulty: number;
  optimalMoves: number;
}

export function generateBuiltInPuzzles(): GeneratedPuzzle[] {
  const out: GeneratedPuzzle[] = [];
  for (let i = 0; i < DIFFICULTIES.length; i++) {
    const d = DIFFICULTIES[i]!;
    const board = scramble(d);
    const { moves } = solve(board);
    out.push({
      name: `Puzzle ${i + 1} — ${difficultyLabel(d)}`,
      board,
      difficulty: d,
      optimalMoves: moves.length,
    });
  }
  return out;
}

export function ensureBuiltInsFor(userId: number): void {
  const row = db
    .prepare("SELECT COUNT(*) as c FROM puzzles WHERE built_in_for = ?")
    .get(userId) as { c: number };
  if (row.c > 0) return;
  installBuiltInsFor(userId);
}

export function installBuiltInsFor(userId: number): void {
  const puzzles = generateBuiltInPuzzles();
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO puzzles (name, creator_id, built_in_for, initial_board, difficulty, optimal_moves, show_numbers, style_json, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, 1, '{}', ?)`,
  );
  tx(() => {
    for (const p of puzzles) {
      insert.run(p.name, userId, JSON.stringify(p.board), p.difficulty, p.optimalMoves, now);
    }
  });
}

export function regenerateBuiltInsFor(userId: number): void {
  tx(() => {
    db.prepare(
      `DELETE FROM puzzles
       WHERE built_in_for = ?
         AND id NOT IN (SELECT puzzle_id FROM solves WHERE user_id = ?)`,
    ).run(userId, userId);
    installBuiltInsFor(userId);
  });
}
