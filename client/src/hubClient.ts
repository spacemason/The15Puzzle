// Thin client for the diffenderfer-games hub API (/_api). Used ONLY when the
// game runs inside the host, which injects `window.__HUB__` and serves the
// hub at the same origin. Standalone builds never reach this (see `hubMode`),
// so the app keeps using its own server.
//
// Paths here are absolute `/_api/...` from the origin root — they must NOT go
// through `apiUrl()` (which prefixes import.meta.env.BASE_URL for the app's
// own `/the15puzzle/api/...` calls).

interface HubConfig {
  slug?: string;
  apiBase?: string;
  menu?: string;
}

function hubConfig(): HubConfig {
  if (typeof window === "undefined") return {};
  return (window as unknown as { __HUB__?: HubConfig }).__HUB__ ?? {};
}

/** True when running inside the host with the hub available. */
export const hubMode: boolean =
  typeof window !== "undefined" && !!(window as unknown as { __HUB__?: unknown }).__HUB__;

const apiBase = (hubConfig().apiBase || "/_api").replace(/\/$/, "");
const slug = hubConfig().slug || "the15puzzle";
const gamePath = () => `/games/${encodeURIComponent(slug)}`;

async function hreq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase + path, {
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
      // non-JSON error
    }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface HubUser {
  id: number | string;
  username: string;
  guest?: boolean;
}

/** Current hub user (or null). */
export const hubMe = () => hreq<{ user: HubUser | null }>("/me");

/** Ensure a session exists, minting a guest if needed. */
export const hubEnsureGuest = () =>
  hreq<{ user: HubUser }>("/auth/guest", { method: "POST", body: "{}" });

/** Read a hub save slot for this game. */
export const hubGetSave = <T>(slot: string) =>
  hreq<{ save: { slot: string; label: string | null; data: T; updatedAt: number } | null }>(
    `${gamePath()}/saves/${encodeURIComponent(slot)}`,
  );

/** Write a hub save slot for this game. */
export const hubPutSave = (slot: string, data: unknown) =>
  hreq<{ ok: true; updatedAt: number }>(`${gamePath()}/saves/${encodeURIComponent(slot)}`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  });

/** Delete a hub save slot for this game. */
export const hubDeleteSave = (slot: string) =>
  hreq<{ ok: true }>(`${gamePath()}/saves/${encodeURIComponent(slot)}`, { method: "DELETE" });
