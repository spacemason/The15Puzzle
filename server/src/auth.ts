import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { db } from "./db.js";

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

export const sessionMiddleware: MiddlewareHandler = async (c, next) => {
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
