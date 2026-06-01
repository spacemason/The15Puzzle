import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "..", "data.db");

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  theme         TEXT NOT NULL DEFAULT 'dark',
  hide_timer    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS puzzles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  creator_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  built_in_for    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  initial_board   TEXT NOT NULL,
  difficulty      INTEGER NOT NULL,
  optimal_moves   INTEGER NOT NULL,
  show_numbers    INTEGER NOT NULL DEFAULT 1,
  style_json      TEXT NOT NULL DEFAULT '{}',
  bg_image        TEXT,
  complete_image  TEXT,
  tile_images     TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_puzzles_builtin ON puzzles(built_in_for);
CREATE INDEX IF NOT EXISTS idx_puzzles_creator ON puzzles(creator_id);

CREATE TABLE IF NOT EXISTS solves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id     INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  moves         INTEGER NOT NULL,
  optimal_moves INTEGER NOT NULL,
  duration_ms   INTEGER NOT NULL,
  completed_at  INTEGER NOT NULL,
  UNIQUE(user_id, puzzle_id)
);
CREATE INDEX IF NOT EXISTS idx_solves_user ON solves(user_id);
CREATE INDEX IF NOT EXISTS idx_solves_puzzle ON solves(puzzle_id);

CREATE TABLE IF NOT EXISTS active_games (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id     INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  board         TEXT NOT NULL,
  moves         INTEGER NOT NULL,
  started_at    INTEGER NOT NULL,
  last_updated  INTEGER NOT NULL,
  PRIMARY KEY (user_id, puzzle_id)
);
`);

// Dual-mode: when running inside the diffenderfer-games host with the hub
// available, HUB_URL points at the host's internal API. Absent => standalone,
// and everything below behaves exactly as before.
export const HUB_URL = process.env.HUB_URL ?? "";
export const HUB_MODE = HUB_URL !== "";

// Additive migration: a mirror of the hub's user id so hub identities map to
// LOCAL user rows (never reusing the hub's id, which would collide with
// standalone users). Only used in hub mode; ignored standalone. ADD COLUMN is
// not idempotent, so guard on the current columns.
{
  const cols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "hub_user_id")) {
    db.exec("ALTER TABLE users ADD COLUMN hub_user_id TEXT");
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_hub ON users(hub_user_id) WHERE hub_user_id IS NOT NULL",
  );
}

// Helper for transactions — node:sqlite has no built-in wrapper.
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
}
