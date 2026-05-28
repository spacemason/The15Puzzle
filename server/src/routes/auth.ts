import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db.js";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  hashPassword,
  requireUser,
  verifyPassword,
} from "../auth.js";
import { installBuiltInsFor } from "../puzzleGen.js";
import { getCookie } from "hono/cookie";

const app = new Hono();

function setSessionCookie(c: any, token: string, expiresAt: number) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

app.post("/signup", async (c) => {
  const body = (await c.req.json()) as { username?: unknown; password?: unknown };
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (username.length < 2 || username.length > 24)
    return c.json({ error: "Username must be 2–24 characters." }, 400);
  if (!/^[A-Za-z0-9_\- ]+$/.test(username))
    return c.json({ error: "Username can use letters, numbers, _, -, and spaces." }, 400);
  if (password.length < 4)
    return c.json({ error: "Password must be at least 4 characters." }, 400);

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return c.json({ error: "That username is taken." }, 409);

  const now = Date.now();
  const info = db
    .prepare(
      "INSERT INTO users (username, password_hash, theme, hide_timer, created_at) VALUES (?, ?, 'dark', 0, ?)",
    )
    .run(username, hashPassword(password), now);
  const userId = Number(info.lastInsertRowid);

  installBuiltInsFor(userId);

  const { token, expiresAt } = createSession(userId);
  setSessionCookie(c, token, expiresAt);

  return c.json({
    user: { id: userId, username, theme: "dark", hideTimer: false },
  });
});

app.post("/login", async (c) => {
  const body = (await c.req.json()) as { username?: unknown; password?: unknown };
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  const row = db
    .prepare(
      "SELECT id, username, password_hash, theme, hide_timer FROM users WHERE username = ?",
    )
    .get(username) as
    | { id: number; username: string; password_hash: string; theme: string; hide_timer: number }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash))
    return c.json({ error: "Invalid username or password." }, 401);

  const { token, expiresAt } = createSession(row.id);
  setSessionCookie(c, token, expiresAt);

  return c.json({
    user: {
      id: row.id,
      username: row.username,
      theme: row.theme === "light" ? "light" : "dark",
      hideTimer: !!row.hide_timer,
    },
  });
});

app.post("/logout", (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) deleteSession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/me", (c) => {
  const user = c.get("user");
  if (!user) return c.json({ user: null });
  return c.json({ user });
});

app.patch("/me", async (c) => {
  const user = requireUser(c);
  const body = (await c.req.json()) as { theme?: unknown; hideTimer?: unknown };
  const updates: string[] = [];
  const params: (string | number)[] = [];
  if (body.theme === "light" || body.theme === "dark") {
    updates.push("theme = ?");
    params.push(body.theme);
  }
  if (typeof body.hideTimer === "boolean") {
    updates.push("hide_timer = ?");
    params.push(body.hideTimer ? 1 : 0);
  }
  if (!updates.length) return c.json({ ok: true });
  params.push(user.id);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  const row = db
    .prepare("SELECT id, username, theme, hide_timer FROM users WHERE id = ?")
    .get(user.id) as { id: number; username: string; theme: string; hide_timer: number };
  return c.json({
    user: {
      id: row.id,
      username: row.username,
      theme: row.theme === "light" ? "light" : "dark",
      hideTimer: !!row.hide_timer,
    },
  });
});

export default app;
