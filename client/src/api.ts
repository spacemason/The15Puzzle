import type {
  ActiveGame,
  Board,
  LeaderboardEntry,
  PuzzleFull,
  PuzzleStyle,
  PuzzleSummary,
  UserPublic,
} from "@p15/shared";

// Prefix a server path (e.g. "/api/foo" or "/uploads/x.png") with Vite's
// BASE_URL so requests resolve correctly when the app is mounted under a
// catalog prefix like "/the15puzzle/". Pass through absolute URLs.
export function assetUrl(p: string | null | undefined): string | undefined {
  if (!p) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.startsWith("data:")) return p;
  return import.meta.env.BASE_URL + p.replace(/^\/+/, "");
}

function apiUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\/+/, "");
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(url), {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      msg = body.error ?? msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => req<{ user: UserPublic | null }>("/api/auth/me"),
  signup: (username: string, password: string) =>
    req<{ user: UserPublic }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    req<{ user: UserPublic }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => req<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  updateMe: (patch: { theme?: "light" | "dark"; hideTimer?: boolean }) =>
    req<{ user: UserPublic }>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  listPuzzles: () =>
    req<{ builtIns: PuzzleSummary[]; community: PuzzleSummary[] }>("/api/puzzles/list"),
  getPuzzle: (id: number) => req<{ puzzle: PuzzleFull }>(`/api/puzzles/${id}`),
  regenerate: () => req<{ ok: true }>("/api/puzzles/regenerate", { method: "POST" }),
  createPuzzle: (form: FormData) =>
    fetch(apiUrl("/api/puzzles"), { method: "POST", body: form, credentials: "same-origin" }).then(
      async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `${r.status}`);
        }
        return (await r.json()) as { id: number };
      },
    ),

  getActive: (puzzleId: number) =>
    req<{ active: ActiveGame | null }>(`/api/active/${puzzleId}`),
  putActive: (puzzleId: number, body: { board: Board; moves: number; startedAt: number }) =>
    req<{ ok: true }>(`/api/active/${puzzleId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteActive: (puzzleId: number) =>
    req<{ ok: true }>(`/api/active/${puzzleId}`, { method: "DELETE" }),

  recordSolve: (puzzleId: number, moves: number, durationMs: number) =>
    req<{ ok: true; alreadySolved: boolean; optimalMoves?: number }>("/api/solves", {
      method: "POST",
      body: JSON.stringify({ puzzleId, moves, durationMs }),
    }),

  leaderboard: () => req<{ entries: LeaderboardEntry[] }>("/api/leaderboard"),
};

export type { PuzzleStyle };
