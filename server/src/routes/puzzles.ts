import { Hono } from "hono";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.js";
import { requireUser } from "../auth.js";
import { ensureBuiltInsFor, regenerateBuiltInsFor } from "../puzzleGen.js";
import type { PuzzleFull, PuzzleStyle, PuzzleSummary } from "@p15/shared";
import { isSolvable, isSolved, scramble, solve } from "@p15/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function saveUpload(file: File): Promise<string> {
  const ext = ALLOWED_EXT[file.type] ?? "png";
  const id = crypto.randomBytes(8).toString("hex");
  const name = `${Date.now()}_${id}.${ext}`;
  const dest = path.join(uploadDir, name);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return `/uploads/${name}`;
}

interface PuzzleRow {
  id: number;
  name: string;
  creator_id: number | null;
  built_in_for: number | null;
  initial_board: string;
  difficulty: number;
  optimal_moves: number;
  show_numbers: number;
  style_json: string;
  bg_image: string | null;
  complete_image: string | null;
  tile_images: string | null;
  creator_name?: string | null;
  solved_at?: number | null;
}

function rowToSummary(row: PuzzleRow): PuzzleSummary {
  const tileImgs: (string | null)[] = row.tile_images ? JSON.parse(row.tile_images) : [];
  return {
    id: row.id,
    name: row.name,
    difficulty: row.difficulty,
    optimalMoves: row.optimal_moves,
    builtIn: row.built_in_for !== null,
    creatorId: row.creator_id,
    creatorName: row.creator_name ?? null,
    showNumbers: !!row.show_numbers,
    hasBgImage: !!row.bg_image,
    hasCompleteImage: !!row.complete_image,
    hasTileImages: tileImgs.some((x) => !!x),
    solved: !!row.solved_at,
  };
}

function rowToFull(row: PuzzleRow): PuzzleFull {
  const tileImgs: (string | null)[] = row.tile_images
    ? JSON.parse(row.tile_images)
    : new Array(15).fill(null);
  while (tileImgs.length < 15) tileImgs.push(null);
  return {
    ...rowToSummary(row),
    initialBoard: JSON.parse(row.initial_board),
    style: JSON.parse(row.style_json) as PuzzleStyle,
    bgImageUrl: row.bg_image,
    completeImageUrl: row.complete_image,
    tileImageUrls: tileImgs,
  };
}

const app = new Hono();

app.get("/list", (c) => {
  const user = requireUser(c);
  ensureBuiltInsFor(user.id);

  // user's built-ins
  const builtIns = db
    .prepare(
      `SELECT p.*, NULL as creator_name, s.completed_at as solved_at
       FROM puzzles p
       LEFT JOIN solves s ON s.puzzle_id = p.id AND s.user_id = ?
       WHERE p.built_in_for = ?
       ORDER BY p.difficulty ASC, p.id ASC`,
    )
    .all(user.id, user.id) as unknown as PuzzleRow[];

  // community puzzles (not built-in for anyone; created by others or self)
  const community = db
    .prepare(
      `SELECT p.*, u.username as creator_name, s.completed_at as solved_at
       FROM puzzles p
       LEFT JOIN users u ON u.id = p.creator_id
       LEFT JOIN solves s ON s.puzzle_id = p.id AND s.user_id = ?
       WHERE p.built_in_for IS NULL
       ORDER BY p.created_at DESC
       LIMIT 200`,
    )
    .all(user.id) as unknown as PuzzleRow[];

  return c.json({
    builtIns: builtIns.map(rowToSummary),
    community: community.map(rowToSummary),
  });
});

app.post("/regenerate", (c) => {
  const user = requireUser(c);
  regenerateBuiltInsFor(user.id);
  return c.json({ ok: true });
});

app.get("/:id", (c) => {
  const user = requireUser(c);
  const id = Number(c.req.param("id"));
  const row = db
    .prepare(
      `SELECT p.*, u.username as creator_name, s.completed_at as solved_at
       FROM puzzles p
       LEFT JOIN users u ON u.id = p.creator_id
       LEFT JOIN solves s ON s.puzzle_id = p.id AND s.user_id = ?
       WHERE p.id = ?`,
    )
    .get(user.id, id) as PuzzleRow | undefined;
  if (!row) return c.json({ error: "Puzzle not found." }, 404);
  // Only allow access if it's a community puzzle, or this user's built-in.
  if (row.built_in_for !== null && row.built_in_for !== user.id)
    return c.json({ error: "Puzzle not found." }, 404);
  return c.json({ puzzle: rowToFull(row) });
});

app.post("/", async (c) => {
  const user = requireUser(c);
  const form = await c.req.formData();

  const name = String(form.get("name") ?? "").trim() || `Custom puzzle`;
  const difficulty = Math.max(4, Math.min(80, Number(form.get("difficulty") ?? 25)));
  const showNumbers = form.get("showNumbers") === "true" || form.get("showNumbers") === "1";
  let style: PuzzleStyle = {};
  const rawStyle = form.get("style");
  if (typeof rawStyle === "string" && rawStyle.length) {
    try {
      style = JSON.parse(rawStyle);
    } catch {
      style = {};
    }
  }

  // Scramble a fresh board with the requested difficulty.
  let board = scramble(difficulty);
  if (isSolved(board) || !isSolvable(board)) board = scramble(difficulty + 1);
  const optimalMoves = solve(board).moves.length;

  // Optional images
  const bgFile = form.get("bgImage");
  const completeFile = form.get("completeImage");
  const bgImage = bgFile instanceof File && bgFile.size > 0 ? await saveUpload(bgFile) : null;
  const completeImage =
    completeFile instanceof File && completeFile.size > 0
      ? await saveUpload(completeFile)
      : null;

  // 15 tile images, fields tileImage0..tileImage14 (representing tiles 1..15)
  const tileImages: (string | null)[] = [];
  for (let i = 0; i < 15; i++) {
    const f = form.get(`tileImage${i}`);
    if (f instanceof File && f.size > 0) {
      tileImages.push(await saveUpload(f));
    } else {
      tileImages.push(null);
    }
  }

  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO puzzles
        (name, creator_id, built_in_for, initial_board, difficulty, optimal_moves,
         show_numbers, style_json, bg_image, complete_image, tile_images, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name.slice(0, 60),
      user.id,
      JSON.stringify(board),
      difficulty,
      optimalMoves,
      showNumbers ? 1 : 0,
      JSON.stringify(style),
      bgImage,
      completeImage,
      JSON.stringify(tileImages),
      now,
    );

  const id = Number(info.lastInsertRowid);
  return c.json({ id });
});

export default app;
