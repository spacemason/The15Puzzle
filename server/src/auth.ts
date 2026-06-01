import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { db, tx, HUB_MODE, HUB_URL } from "./db.js";

declare module "hono" {
  interface ContextVariableMap {
    user?: SessionUser;
  }
}

export const SESSION_COOKIE = "p15_session";
const SESSION_TTL_DAYS = 30;

export interface SessionUser {
  id: number;
  username: string;
  theme: "light" | "dark";
  hideTimer: boolean;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function createSession(userId: number): { token: string; expiresAt: number } {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(token, userId, now, expiresAt);
  return { token, expiresAt };
}

export function deleteSession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function getSessionUser(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.theme, u.hide_timer, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as
    | { id: number; username: string; theme: string; hide_timer: number; expires_at: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession(token);
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    theme: row.theme === "light" ? "light" : "dark",
    hideTimer: !!row.hide_timer,
  };
}

// ---------------------------------------------------------------------------
// Hub mode: resolve the shared `hub_session` against the host's /_api/me and
// map it to a LOCAL mirror user (keyed by hub_user_id, never reusing the hub
// id). Standalone mode is untouched.
// ---------------------------------------------------------------------------

const HUB_SESSION_COOKIE = "hub_session";
// Short cache: smooths bursts (e.g. move-saves) without making identity
// changes (a guest claiming a real name) linger noticeably.
const HUB_CACHE_MS = 5_000;

interface HubUser {
  id: number | string;
  username: string;
  guest?: boolean;
}

const hubCache = new Map<string, { user: HubUser | null; at: number }>();

async function resolveHubUser(token: string, cookieHeader: string): Promise<HubUser | null> {
  const cached = hubCache.get(token);
  if (cached && Date.now() - cached.at < HUB_CACHE_MS) return cached.user;
  try {
    const res = await fetch(`${HUB_URL}/_api/me`, { headers: { cookie: cookieHeader } });
    if (!res.ok) {
      hubCache.delete(token);
      return null;
    }
    const body = (await res.json()) as { user: HubUser | null };
    const user = body.user ?? null;
    hubCache.set(token, { user, at: Date.now() });
    return user;
  } catch {
    return null; // hub unreachable — treat as logged out for this request
  }
}

/** Find (or lazily create) the local mirror row for a hub user id. */
function findOrCreateMirror(hubId: string, username: string): SessionUser {
  const sel = db.prepare(
    "SELECT id, username, theme, hide_timer FROM users WHERE hub_user_id = ?",
  );
  let row = sel.get(hubId) as
    | { id: number; username: string; theme: string; hide_timer: number }
    | undefined;
  if (!row) {
    try {
      tx(() => {
        const taken = (n: string) => !!db.prepare("SELECT 1 FROM users WHERE username = ?").get(n);
        let name = username || "Player";
        if (taken(name)) name = `${name}-${hubId}`;
        if (taken(name)) name = `${name}-${Date.now()}`;
        db.prepare(
          `INSERT INTO users (username, password_hash, theme, hide_timer, hub_user_id, created_at)
           VALUES (?, '', 'dark', 0, ?, ?)`,
        ).run(name, hubId, Date.now());
      });
    } catch {
      // UNIQUE(hub_user_id) race — another request created it; re-select below.
    }
    row = sel.get(hubId) as typeof row;
  } else if (row.username !== username && username) {
    // The hub username changed (e.g. a guest claimed a real name) — keep the
    // mirror (and thus the in-app leaderboard + header) in sync. Best-effort:
    // ignore a collision with some other local row.
    try {
      db.prepare("UPDATE users SET username = ? WHERE hub_user_id = ?").run(username, hubId);
      row.username = username;
    } catch {
      /* name taken locally — keep the existing mirror name */
    }
  }
  if (!row) throw new Error("failed to resolve hub mirror user");
  return {
    id: row.id,
    username: row.username,
    theme: row.theme === "light" ? "light" : "dark",
    hideTimer: !!row.hide_timer,
  };
}

export const sessionMiddleware: MiddlewareHandler = async (c, next) => {
  if (HUB_MODE) {
    const token = getCookie(c, HUB_SESSION_COOKIE);
    if (token) {
      const hubUser = await resolveHubUser(token, c.req.header("cookie") ?? "");
      if (hubUser) c.set("user", findOrCreateMirror(String(hubUser.id), hubUser.username));
    }
    await next();
    return;
  }
  // Standalone — unchanged.
  const token = getCookie(c, SESSION_COOKIE);
  const user = getSessionUser(token);
  if (user) c.set("user", user);
  await next();
};

export function requireUser(c: Context): SessionUser {
  const user = c.get("user");
  if (!user) {
    throw new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return user;
}
