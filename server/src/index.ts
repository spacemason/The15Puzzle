import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "./db.js";
import { sessionMiddleware } from "./auth.js";
import auth from "./routes/auth.js";
import puzzles from "./routes/puzzles.js";
import active from "./routes/active.js";
import solves from "./routes/solves.js";
import leaderboard from "./routes/leaderboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new Hono();

app.use("*", sessionMiddleware);

app.onError((err, c) => {
  if (err instanceof Response) return err;
  console.error("[server error]", err);
  return c.json({ error: "Internal server error." }, 500);
});

app.route("/api/auth", auth);
app.route("/api/puzzles", puzzles);
app.route("/api/active", active);
app.route("/api/solves", solves);
app.route("/api/leaderboard", leaderboard);

// Serve uploaded images
app.use(
  "/uploads/*",
  serveStatic({
    root: path.relative(process.cwd(), path.resolve(__dirname, "..")),
  }),
);

// Serve the built client (if present)
const clientDist = path.resolve(__dirname, "..", "..", "client", "dist");
app.use(
  "/*",
  serveStatic({
    root: path.relative(process.cwd(), clientDist),
  }),
);
// SPA fallback
app.get("*", serveStatic({ path: path.relative(process.cwd(), path.join(clientDist, "index.html")) }));

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
});
