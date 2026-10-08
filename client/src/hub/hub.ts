/**
 * Typed client for the diffenderfer.games hub API.
 *
 * Drop this file into a game's source (e.g. `src/hub.ts`) and talk to the
 * shared backend — accounts, saves, stats, leaderboards, analytics — with
 * full types and no dependencies.
 *
 *     import { hub } from './hub';
 *
 *     const { user } = await hub.me();
 *     await hub.putSave('auto', { level: 7, gold: 120 });
 *     await hub.submitScore('highscore', 9001, { title: 'High Score' });
 *
 * When the game is hosted in the catalog, the slug and API base are detected
 * automatically (from the injected `window.__HUB__`, falling back to the URL
 * path). Override them by constructing your own instance:
 *
 *     import { Hub } from './hub';
 *     const hub = new Hub({ slug: 'my-game', apiBase: '/_api' });
 *
 * Every call throws {@link HubError} on failure (network or HTTP). The
 * analytics helpers (`recordPlay`, `heartbeat`, `event`) are the exception:
 * they are fire-and-forget and never throw.
 */

import { InputSystem } from './input';
import type { InputOverrides } from './input';
export * from './input';
import { DailySystem } from './daily';
import type { DailyHost } from './daily';
export * from './daily';
import { getUiStack } from './uistack';
import type { UiStack } from './uistack';
export * from './uistack';
// Types only: the live social client is the runtime bundle /_hub/social.js, so
// a vendored copy of this file never needs its code (multiplayer-impl.md §7.2).
import type {
  ChatMode, FriendEntry, HubRoom, InviteResult, JoinInfoEvent, Launch, Party, PlayerRef,
  PresenceInput, RealtimeApi, RoomCreateOptions, RoomEvents, RoomInfo, SocialCounts, SocialEvents,
  RaceCreateOptions, RaceDefinition, RaceEvents, RaceHistory, RaceHistoryQuery, RaceParams, RaceResult,
  RaceRuntimeApi, RaceStats,
} from './social/rt-types';
export type * from './social/rt-types';

// ---------------------------------------------------------------------------
// Wire types — these mirror the JSON the API returns.
// ---------------------------------------------------------------------------

export interface User {
  id: number;
  username: string;
  /** True for an auto-created guest (no password yet — can be claimed). */
  guest?: boolean;
}

export interface ProfileSummary {
  game: string;
  displayName: string | null;
}

export interface MeResponse {
  user: User | null;
  profiles: ProfileSummary[];
}

export interface Profile<TData = unknown> {
  game: string;
  displayName: string | null;
  data: TData;
  updatedAt: number;
}

export interface SaveMeta {
  slot: string;
  label: string | null;
  updatedAt: number;
}

export interface Save<TData = unknown> {
  slot: string;
  label: string | null;
  data: TData;
  updatedAt: number;
}

export type Stats = Record<string, number>;

export type SortDir = 'asc' | 'desc';

export interface Board {
  key: string;
  title: string;
  sortDir: SortDir;
}

export interface LeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  score: number;
  meta: unknown | null;
}

export interface SubmitScoreResult {
  board: Board;
  best: number | null;
  rank: number | null;
}

export interface LeaderboardResult {
  board: Board;
  entries: LeaderboardEntry[];
}

export interface BoardWithTop extends Board {
  top: LeaderboardEntry[];
}

export interface GameLeaderboards {
  slug: string;
  title: string;
  boards: BoardWithTop[];
}

export interface Metrics {
  totalPlays: number;
  uniquePlayers: number;
  activeNow: number;
}

export type GameAnalytics = Metrics & { slug: string };

export interface GlobalAnalytics {
  global: Metrics;
  games: (Metrics & { slug: string; title: string })[];
}

export interface GameInfo {
  slug: string;
  title: string;
  path: string;
  kind: 'static' | 'process';
  hasImage: boolean;
  hubEnabled: boolean;
}

export interface SubmitScoreOptions {
  /** Title for the board; only used the first time a board key is created. */
  title?: string;
  /** Sort direction; only used on board creation. Default 'desc'. */
  sort?: SortDir;
  /** Arbitrary JSON stored alongside the entry (e.g. character, run seed). */
  meta?: unknown;
}

export interface HubOptions {
  /** Game slug. Defaults to window.__HUB__.slug, then the first URL segment. */
  slug?: string;
  /** API base. Defaults to window.__HUB__.apiBase, then '/_api'. */
  apiBase?: string;
  /** Inject a custom fetch (testing / non-browser). Defaults to global fetch. */
  fetch?: typeof fetch;
  /**
   * How to behave when the hub backend isn't running:
   *   'auto'   (default) — try the network; on a connection failure fall back
   *                        to localStorage so the app keeps working offline.
   *   'always' — never touch the network; use localStorage only. Handy for
   *              developing an app's hub integration without running the hub.
   *   'never'  — never fall back; every call hits the network and throws if
   *              it can't (the original, strict behaviour).
   */
  offline?: 'auto' | 'always' | 'never';
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Machine-readable extras the server attaches to error bodies
 * (`{error, code, reason, hint, retryAfterMs}`, multiplayer-impl.md §0).
 */
export interface HubErrorDetails {
  /** Stable error code, e.g. 'content_rejected', 'rate_limited', 'suspended', 'claim_required'. */
  code?: string;
  /** Why content was refused, e.g. 'link', 'language', 'muted', 'chat_off'. */
  reason?: string;
  /** A kid-friendly sentence to show the player. */
  hint?: string;
  /** How long to wait before retrying (rate limits, mutes). */
  retryAfterMs?: number;
}

/**
 * Thrown by every hub call that fails. `status` is the HTTP status when the
 * server responded (e.g. 401 = not signed in, 404 = unknown game/board, 413 =
 * too large), or `undefined` for a transport failure (offline / no host).
 * Social/multiplayer errors also carry {@link HubErrorDetails}.
 */
export class HubError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly reason?: string;
  readonly hint?: string;
  readonly retryAfterMs?: number;
  constructor(message: string, status?: number, details: HubErrorDetails = {}) {
    super(message);
    this.name = 'HubError';
    this.status = status;
    this.code = details.code;
    this.reason = details.reason;
    this.hint = details.hint;
    this.retryAfterMs = details.retryAfterMs;
  }
  /** True when the failure was a network/transport error, not an HTTP status. */
  get isOffline(): boolean {
    return this.status === undefined;
  }
}

/** Thrown when an action that genuinely needs the server is attempted offline. */
export class OfflineError extends HubError {
  constructor(message = 'This needs a connection.') {
    super(message);
    this.name = 'OfflineError';
  }
}

/**
 * Text was refused by the safety filter (HTTP 422 / a WS ack with
 * `code:'content_rejected'`). Keep the player's draft and show `hint`; when
 * `reason` is 'muted' or 'rate_limited', `retryAfterMs` says how long to wait.
 */
export class ContentRejectedError extends HubError {
  constructor(message: string, status: number | undefined, details: HubErrorDetails) {
    super(message, status, details);
    this.name = 'ContentRejectedError';
  }
}

/** Narrow an unknown JSON error body to the fields we understand. */
function errorDetails(body: unknown): HubErrorDetails & { error?: string } {
  if (!body || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  return {
    error: str(b.error),
    code: str(b.code),
    reason: str(b.reason),
    hint: str(b.hint),
    retryAfterMs: typeof b.retryAfterMs === 'number' ? b.retryAfterMs : undefined,
  };
}

/** Build the right error class for a failed response (422 → ContentRejectedError). */
function errorFor(message: string, status: number | undefined, details: HubErrorDetails): HubError {
  return status === 422 || details.code === 'content_rejected'
    ? new ContentRejectedError(message, status, details)
    : new HubError(message, status, details);
}

// ---------------------------------------------------------------------------
// Offline mutation queue
//
// Writes apply optimistically to the local store and enqueue a durable op;
// when connectivity returns the queue replays in order, merging into the
// server. Ops collapse on enqueue (a save's last write wins, incrs sum, maxes
// keep the largest, a board keeps its best, a profile patch merges) so the
// backlog stays bounded.
// ---------------------------------------------------------------------------

export type QueueOp =
  | { id: string; ts: number; kind: 'putSave'; slot: string; data: unknown; label: string | null }
  | { id: string; ts: number; kind: 'deleteSave'; slot: string }
  | { id: string; ts: number; kind: 'setStat'; key: string; value: number }
  | { id: string; ts: number; kind: 'maxStat'; key: string; value: number }
  | { id: string; ts: number; kind: 'incrStat'; key: string; amount: number }
  | { id: string; ts: number; kind: 'submitScore'; key: string; score: number; opts: SubmitScoreOptions }
  | { id: string; ts: number; kind: 'setProfile'; patch: { displayName?: string | null; data?: unknown } };

/** A queued op before it's been stamped with an id/timestamp. */
type QueueOpInput =
  | Omit<Extract<QueueOp, { kind: 'putSave' }>, 'id' | 'ts'>
  | Omit<Extract<QueueOp, { kind: 'deleteSave' }>, 'id' | 'ts'>
  | Omit<Extract<QueueOp, { kind: 'setStat' }>, 'id' | 'ts'>
  | Omit<Extract<QueueOp, { kind: 'maxStat' }>, 'id' | 'ts'>
  | Omit<Extract<QueueOp, { kind: 'incrStat' }>, 'id' | 'ts'>
  | Omit<Extract<QueueOp, { kind: 'submitScore' }>, 'id' | 'ts'>
  | Omit<Extract<QueueOp, { kind: 'setProfile' }>, 'id' | 'ts'>;

interface BufferedEvent { type: string; ts: number; }

/** Connection/sync status passed to onStatus subscribers. */
export interface HubStatus { online: boolean; offline: boolean; pending: number; }

const EVENT_CAP = 100;

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

interface InjectedConfig {
  slug?: string;
  apiBase?: string;
}

function injected(): InjectedConfig {
  if (typeof window === 'undefined') return {};
  const cfg = (window as unknown as { __HUB__?: InjectedConfig }).__HUB__;
  return cfg ?? {};
}

function detectSlug(): string | null {
  const fromConfig = injected().slug;
  if (fromConfig) return fromConfig;
  if (typeof location === 'undefined') return null;
  return location.pathname.split('/').filter(Boolean)[0] ?? null;
}

function detectApiBase(): string {
  const base = injected().apiBase ?? '/_api';
  const origin = typeof location !== 'undefined' ? location.origin : 'http://localhost';
  return new URL(base, origin).toString().replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// Local (offline) backing store
//
// When the hub backend is unreachable, the client falls back to this so an
// app keeps working — saves persist in localStorage, and the rest return
// sensible empty/default values instead of throwing.
// ---------------------------------------------------------------------------

interface KV {
  get(k: string): string | null;
  set(k: string, v: string): void;
  remove(k: string): void;
  keys(): string[];
}

function makeKV(): KV {
  try {
    if (typeof localStorage !== 'undefined') {
      return {
        get: (k) => localStorage.getItem(k),
        set: (k, v) => localStorage.setItem(k, v),
        remove: (k) => localStorage.removeItem(k),
        keys: () => Object.keys(localStorage),
      };
    }
  } catch {
    /* localStorage can throw (privacy mode / disabled) — fall through */
  }
  const m = new Map<string, string>(); // in-memory (SSR / tests / no storage)
  return {
    get: (k) => (m.has(k) ? (m.get(k) as string) : null),
    set: (k, v) => { m.set(k, v); },
    remove: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

class LocalStore {
  private readonly kv = makeKV();
  private readonly prefix: string;
  private readonly slugName: string;

  constructor(slug: string) {
    this.slugName = slug;
    this.prefix = `hub:${slug}:`;
  }

  private read<T>(key: string, fallback: T): T {
    const raw = this.kv.get(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }

  private write(key: string, value: unknown): void {
    this.kv.set(key, JSON.stringify(value));
  }

  // User is global (shared across games), like the real session.
  getUser(): User | null { return this.read<User | null>('hub:user', null); }
  setUser(u: User): void { this.write('hub:user', u); }
  clearUser(): void { this.kv.remove('hub:user'); }

  getProfile<T>(): Profile<T> | null {
    return this.read<Profile<T> | null>(`${this.prefix}profile`, null);
  }
  setProfile<T>(game: string, displayName: string | null, data: T): Profile<T> {
    const p: Profile<T> = { game, displayName, data, updatedAt: Date.now() };
    this.write(`${this.prefix}profile`, p);
    return p;
  }

  listSaves(): SaveMeta[] {
    const out: SaveMeta[] = [];
    for (const k of this.kv.keys()) {
      if (!k.startsWith(`${this.prefix}save:`)) continue;
      const s = this.read<Save | null>(k, null);
      if (s) out.push({ slot: s.slot, label: s.label, updatedAt: s.updatedAt });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  getSave<T>(slot: string): Save<T> | null {
    return this.read<Save<T> | null>(`${this.prefix}save:${slot}`, null);
  }
  putSave<T>(slot: string, data: T, label?: string): number {
    const updatedAt = Date.now();
    this.write(`${this.prefix}save:${slot}`, { slot, label: label ?? null, data, updatedAt });
    return updatedAt;
  }
  deleteSave(slot: string): void { this.kv.remove(`${this.prefix}save:${slot}`); }

  getStats(): Stats { return this.read<Stats>(`${this.prefix}stats`, {}); }
  updateStat(key: string, value: number, mode: 'set' | 'incr' | 'max'): number {
    const stats = this.getStats();
    const cur = stats[key] ?? 0;
    stats[key] = mode === 'incr' ? cur + value : mode === 'max' ? Math.max(cur, value) : value;
    this.write(`${this.prefix}stats`, stats);
    return stats[key];
  }

  // Offline leaderboards can only know this player's own best.
  listBoards(): Board[] {
    const out: Board[] = [];
    for (const k of this.kv.keys()) {
      if (!k.startsWith(`${this.prefix}lb:`)) continue;
      const b = this.read<{ board: Board } | null>(k, null);
      if (b) out.push(b.board);
    }
    return out;
  }
  getBoard(key: string): { board: Board; best: number } | null {
    return this.read<{ board: Board; best: number } | null>(`${this.prefix}lb:${key}`, null);
  }
  submitScore(key: string, score: number, opts: SubmitScoreOptions): { board: Board; best: number } {
    const existing = this.getBoard(key);
    const sortDir: SortDir = existing ? existing.board.sortDir : (opts.sort === 'asc' ? 'asc' : 'desc');
    const better = !existing ? true
      : sortDir === 'asc' ? score < existing.best : score > existing.best;
    const board: Board = existing ? existing.board
      : { key, title: opts.title || key, sortDir };
    const best = better ? score : existing!.best;
    this.write(`${this.prefix}lb:${key}`, { board, best });
    return { board, best };
  }

  // --- mutation queue (durable, replayed on reconnect) ---

  getQueue(): QueueOp[] { return this.read<QueueOp[]>(`${this.prefix}queue`, []); }
  setQueue(q: QueueOp[]): void { this.write(`${this.prefix}queue`, q); }
  queueLength(): number { return this.getQueue().length; }

  private seq = 0;
  /** Append an op, collapsing it with any compatible op already queued. */
  enqueue(input: QueueOpInput): void {
    this.seq += 1;
    const op = { ...input, id: `${Date.now()}-${this.seq}`, ts: Date.now() } as QueueOp;
    let q = this.getQueue();
    switch (op.kind) {
      case 'putSave':
      case 'deleteSave':
        q = q.filter((o) => !((o.kind === 'putSave' || o.kind === 'deleteSave') && o.slot === op.slot));
        q.push(op);
        break;
      case 'incrStat': {
        const prev = q.find((o) => o.kind === 'incrStat' && o.key === op.key) as Extract<QueueOp, { kind: 'incrStat' }> | undefined;
        if (prev) prev.amount += op.amount; else q.push(op);
        break;
      }
      case 'maxStat': {
        const prev = q.find((o) => o.kind === 'maxStat' && o.key === op.key) as Extract<QueueOp, { kind: 'maxStat' }> | undefined;
        if (prev) prev.value = Math.max(prev.value, op.value); else q.push(op);
        break;
      }
      case 'setStat': {
        const prev = q.find((o) => o.kind === 'setStat' && o.key === op.key) as Extract<QueueOp, { kind: 'setStat' }> | undefined;
        if (prev) prev.value = op.value; else q.push(op);
        break;
      }
      case 'submitScore': {
        const prev = q.find((o) => o.kind === 'submitScore' && o.key === op.key) as Extract<QueueOp, { kind: 'submitScore' }> | undefined;
        if (prev) {
          const asc = op.opts.sort === 'asc';
          prev.score = asc ? Math.min(prev.score, op.score) : Math.max(prev.score, op.score);
          prev.opts = op.opts;
        } else q.push(op);
        break;
      }
      case 'setProfile': {
        const prev = q.find((o) => o.kind === 'setProfile') as Extract<QueueOp, { kind: 'setProfile' }> | undefined;
        if (prev) {
          if (op.patch.displayName !== undefined) prev.patch.displayName = op.patch.displayName;
          if (op.patch.data !== undefined) prev.patch.data = op.patch.data;
        } else q.push(op);
        break;
      }
      default:
        q.push(op);
    }
    this.setQueue(q);
  }

  // --- buffered analytics events ---

  getEvents(): BufferedEvent[] { return this.read<BufferedEvent[]>(`${this.prefix}events`, []); }
  setEvents(e: BufferedEvent[]): void { this.write(`${this.prefix}events`, e); }
  bufferEvent(type: string): void {
    let events = this.getEvents();
    events.push({ type, ts: Date.now() });
    if (events.length > EVENT_CAP) {
      const hb = events.filter((e) => e.type === 'heartbeat');
      while (events.length > EVENT_CAP && hb.length) {
        const i = events.indexOf(hb.shift()!);
        if (i >= 0) events.splice(i, 1); else break;
      }
      if (events.length > EVENT_CAP) events = events.slice(events.length - EVENT_CAP);
    }
    this.setEvents(events);
  }

  // --- prefetch hydration ---

  /** Fan a /me/snapshot response out across every game's local keys. */
  hydrate(snap: SnapshotResponse): void {
    if (snap.user) this.setUser(snap.user);
    for (const [slug, g] of Object.entries(snap.games || {})) {
      const p = `hub:${slug}:`;
      if (g.profile) this.kv.set(`${p}profile`, JSON.stringify(g.profile));
      for (const s of g.saves || []) this.kv.set(`${p}save:${s.slot}`, JSON.stringify(s));
      if (g.stats) this.kv.set(`${p}stats`, JSON.stringify(g.stats));
      if (g.inventory) this.kv.set(`${p}inventory`, JSON.stringify(g.inventory));
    }
    for (const rg of snap.records || []) {
      for (const rec of rg.records || []) {
        this.kv.set(`hub:${rg.slug}:lb:${rec.key}`, JSON.stringify({
          board: { key: rec.key, title: rec.title, sortDir: rec.sortDir }, best: rec.score,
        }));
      }
    }
    this.kv.set('hub:records', JSON.stringify(snap.records || []));
    this.kv.set('hub:leaderboards', JSON.stringify(snap.leaderboards || []));
  }
}

/** Shape of GET /_api/me/snapshot — used to warm the offline cache for all games. */
export interface SnapshotResponse {
  user: User | null;
  games: Record<string, {
    profile: Profile | null;
    saves: Save[];
    stats: Stats;
    inventory: { items: { key: string; qty: number }[]; coins: number };
  }>;
  records: { slug: string; title: string; records: { key: string; title: string; score: number; sortDir: SortDir; rank: number }[] }[];
  leaderboards: GameLeaderboards[];
}

// Favorites are site-wide (not per game), so they live under one global key
// rather than in the per-slug LocalStore.
const FAVORITES_KEY = 'hub:favorites';
function readLocalFavorites(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}
function writeLocalFavorites(games: string[]): void {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(games)); } catch { /* storage full/blocked */ }
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export class Hub {
  /** This client's game slug (null if it could not be determined). */
  readonly slug: string | null;
  /** Absolute base URL of the API, e.g. "https://diffenderfer.games/_api". */
  readonly apiBase: string;

  private readonly fetchImpl: typeof fetch;
  private readonly mode: 'auto' | 'always' | 'never';
  private online = true;
  private readonly store: LocalStore;
  private readonly statusListeners = new Set<(s: HubStatus) => void>();
  private flushing = false;
  private lastPrefetch = 0;

  constructor(opts: HubOptions = {}) {
    this.slug = opts.slug ?? detectSlug();
    this.apiBase = opts.apiBase
      ? new URL(opts.apiBase, typeof location !== 'undefined' ? location.origin : 'http://localhost')
        .toString().replace(/\/$/, '')
      : detectApiBase();
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.mode = opts.offline ?? 'auto';
    this.store = new LocalStore(this.slug ?? 'app');

    // Seed from and subscribe to the browser's connectivity signal.
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) this.online = navigator.onLine;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.setOnline(true));
      window.addEventListener('offline', () => this.setOnline(false));
    }
  }

  /** True when calls are being served from local storage rather than the hub. */
  get isOffline(): boolean {
    return this.mode === 'always' || (this.mode === 'auto' && !this.online);
  }

  /** True while the hub backend is reachable. */
  get isOnline(): boolean { return this.online; }

  /** The generic input system (desktop/touch/gamepad). Lazy singleton — see
   *  the input module. Use `hub.input.define({...})`, `hub.input.value('jump')`. */
  get input(): InputSystem { return getInput(); }

  /** Show/hide the injected hub menu button (e.g. hide it during active play so
   *  it doesn't cover the game, show it on pause/menus). Page-wide; see
   *  {@link HubMenuControl}. */
  get menu(): HubMenuControl { return hubMenu; }

  /** Hub UI covering the game (menu, dialogs, chat): open/close events and
   *  `autoPause`. Page-wide; see {@link UiStack}. */
  get overlay(): UiStack { return getUiStack(); }

  /** Tell friends what you're doing in this game. See {@link HubPresenceApi}. */
  get presence(): HubPresenceApi { return social.presence; }

  /** Friends, players and the hub's social dialogs. See {@link HubSocialApi}. */
  get social(): HubSocialApi { return social.social; }

  /** Invites, launches, the leave guard and game tickets. See {@link HubMpApi}. */
  get mp(): HubMpApi { return social.mp; }

  /** Hub relay rooms for games without a server. See {@link HubRoomsApi}. */
  get rooms(): HubRoomsApi { return social.rooms; }

  /** Toast behaviour during intense play. See {@link HubNotifyApi}. */
  get notify(): HubNotifyApi { return social.notify; }

  /** Races: single-player games become multiplayer by racing. See {@link HubRaceApi}. */
  get race(): HubRaceApi { return social.race; }

  private _daily: DailySystem | null = null;
  /** Daily challenges. A game calls `hub.daily.define({ play })` once at load;
   *  on finish, `hub.daily.complete({...})`. Page-wide singleton shared with the
   *  injected menu (which can `startAndPlay` a clicked date on this instance). */
  get daily(): DailySystem {
    if (typeof window !== 'undefined' && (window as any).__HUB_DAILY__) {
      return (window as any).__HUB_DAILY__ as DailySystem;
    }
    if (this._daily) return this._daily;
    const sys = new DailySystem(this.makeDailyHost());
    this._daily = sys;
    if (typeof window !== 'undefined') (window as any).__HUB_DAILY__ = sys;
    return sys;
  }

  private makeDailyHost(): DailyHost {
    const self = this;
    return {
      get slug() { return self.slug; },
      status() { return self.req(`${self.game()}/daily`); },
      all() { return self.req('/daily'); },
      start(day: string) { return self.post(`${self.game()}/daily/${encodeURIComponent(day)}/start`); },
      complete(day: string, token: string, meta: unknown) {
        return self.post(`${self.game()}/daily/${encodeURIComponent(day)}/complete`, { token, meta });
      },
      emit(name: string, detail?: unknown) { self.emit(name, detail); },
    };
  }

  /** Queued mutations + buffered analytics events awaiting sync. */
  pending(): number { return this.store.queueLength() + this.store.getEvents().length; }

  /** Subscribe to connection/sync status changes. Returns an unsubscribe fn. */
  onStatus(cb: (s: HubStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => { this.statusListeners.delete(cb); };
  }

  private emit(name: string, detail?: unknown): void {
    if (typeof window === 'undefined') return;
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* ignore */ }
  }

  private notifyStatus(): void {
    const info: HubStatus = { online: this.online, offline: this.isOffline, pending: this.pending() };
    this.statusListeners.forEach((cb) => { try { cb(info); } catch { /* ignore */ } });
    this.emit('hub:status', info);
  }

  private setOnline(v: boolean): void {
    if (v === this.online) return;
    this.online = v;
    this.emit(v ? 'hub:online' : 'hub:offline', { pending: this.pending() });
    this.notifyStatus();
    if (v) { void this.sync(); void this.prefetchAll(); }
  }

  // --- low-level ---

  /**
   * Run the networked implementation, falling back to a local one when the
   * hub is unreachable (per the configured offline mode). Real API errors
   * (those carrying an HTTP status) always propagate.
   */
  private async call<T>(net: () => Promise<T>, local: () => T): Promise<T> {
    if (this.isOffline) return local();
    try {
      return await net();
    } catch (err) {
      if (err instanceof HubError && !err.isOffline) throw err; // real API error
      if (this.mode === 'never') throw err;                     // caller forbids fallback
      this.setOnline(false);                                    // remember we're offline
      return local();
    }
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.apiBase + path, {
        credentials: 'same-origin',
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers as object) },
      });
    } catch (err) {
      throw new HubError(
        `Hub unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Any response at all means the network is up again.
    if (!this.online) this.setOnline(true);
    if (!res.ok) {
      let details: ReturnType<typeof errorDetails> = {};
      try {
        details = errorDetails(await res.json());
      } catch {
        /* non-JSON error body */
      }
      throw errorFor(details.error || `Request failed (${res.status})`, res.status, details);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.req<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  }

  /** Path prefix for this game's scoped endpoints. Throws if slug is unknown. */
  private game(): string {
    if (!this.slug) throw new HubError('Hub: could not determine the game slug.');
    return `/games/${encodeURIComponent(this.slug)}`;
  }

  // --- mutation queue ---

  /** Turn one queued op into its network call. */
  private sendOp(op: QueueOp): Promise<unknown> {
    switch (op.kind) {
      case 'putSave':
        return this.req(`${this.game()}/saves/${encodeURIComponent(op.slot)}`, {
          method: 'PUT', body: JSON.stringify({ data: op.data, label: op.label }),
        });
      case 'deleteSave':
        return this.req(`${this.game()}/saves/${encodeURIComponent(op.slot)}`, { method: 'DELETE' });
      case 'setStat':
        return this.post(`${this.game()}/stats`, { key: op.key, value: op.value, mode: 'set' });
      case 'maxStat':
        return this.post(`${this.game()}/stats`, { key: op.key, value: op.value, mode: 'max' });
      case 'incrStat':
        return this.post(`${this.game()}/stats`, { key: op.key, value: op.amount, mode: 'incr' });
      case 'submitScore':
        return this.post(`${this.game()}/leaderboards/${encodeURIComponent(op.key)}/scores`, {
          score: op.score, title: op.opts.title, sort: op.opts.sort, meta: op.opts.meta,
        });
      case 'setProfile':
        return this.req(`${this.game()}/profile`, { method: 'PUT', body: JSON.stringify(op.patch) });
      default:
        return Promise.resolve(null);
    }
  }

  /**
   * Apply a mutation optimistically to the local store, then either send it now
   * (online with an empty queue) or enqueue it so the flush drains in order.
   * Returns the optimistic local result on the queued path, the server result
   * on the fast path.
   */
  private async mutateQueued<T>(input: QueueOpInput, local: () => T): Promise<T> {
    const result = local();
    if (this.isOffline || this.store.queueLength() > 0) {
      this.store.enqueue(input);
      this.notifyStatus();
      if (!this.isOffline) void this.sync();
      return result;
    }
    try {
      await this.sendOp({ ...input, id: '', ts: 0 } as QueueOp);
      return result;
    } catch (err) {
      if (err instanceof HubError && err.isOffline) {
        this.setOnline(false);
        this.store.enqueue(input);
        this.notifyStatus();
        return result;
      }
      throw err; // real API error — surface it, don't queue
    }
  }

  /**
   * Replay the queue (then buffered analytics) in order. Stops on the first
   * transport failure (offline again — keep the rest); a real API rejection
   * drops just that op and records a conflict.
   */
  async sync(): Promise<{ flushed: number; conflicts: { op: QueueOp; error?: string }[] }> {
    if (this.flushing || this.isOffline || !this.slug) return { flushed: 0, conflicts: [] };
    this.flushing = true;
    let flushed = 0;
    const conflicts: { op: QueueOp; error?: string }[] = [];
    try {
      let q = this.store.getQueue();
      while (q.length) {
        const op = q[0];
        let died = false;
        try {
          await this.sendOp(op);
          flushed += 1;
        } catch (err) {
          if (err instanceof HubError && err.isOffline) died = true;
          else conflicts.push({ op, error: err instanceof Error ? err.message : String(err) });
        }
        if (died) break;
        q = q.slice(1);
        this.store.setQueue(q);
      }
      await this.flushEvents();
    } finally {
      this.flushing = false;
    }
    this.emit('hub:sync', { pending: this.pending(), flushed, conflicts });
    this.notifyStatus();
    return { flushed, conflicts };
  }

  private async flushEvents(): Promise<void> {
    if (!this.slug) return;
    let events = this.store.getEvents();
    while (events.length) {
      try {
        await this.post(`${this.game()}/events`, { type: events[0].type });
      } catch (err) {
        if (err instanceof HubError && err.isOffline) break; // keep the rest
        // non-network rejection: drop this event, telemetry must never block
      }
      events = events.slice(1);
      this.store.setEvents(events);
    }
  }

  /**
   * Warm the local cache for *every* game the user has touched, in one request,
   * so going offline later still shows complete progress. Throttled; pass force
   * to override. No-op offline.
   */
  async prefetchAll(force = false): Promise<SnapshotResponse | null> {
    if (this.isOffline) return null;
    if (!force && Date.now() - this.lastPrefetch < 30_000) return null;
    let snap: SnapshotResponse;
    try {
      snap = await this.req<SnapshotResponse>('/me/snapshot');
    } catch (err) {
      if (err instanceof HubError && err.isOffline) return null;
      throw err;
    }
    this.lastPrefetch = Date.now();
    this.store.hydrate(snap);
    this.emit('hub:prefetch', { games: Object.keys(snap.games || {}).length });
    return snap;
  }

  // --- auth ---

  /** The current user (or null) and the games they have a profile in. */
  me(): Promise<MeResponse> {
    return this.call(
      () => this.req<MeResponse>('/me'),
      () => {
        const user = this.store.getUser();
        const profile = this.store.getProfile();
        return {
          user,
          profiles: profile ? [{ game: profile.game, displayName: profile.displayName }] : [],
        };
      },
    );
  }

  /**
   * Ensure a session exists, creating a guest (random name, no password) if
   * the player isn't signed in. Lets progress save without an explicit
   * sign-in. Idempotent. Offline: a local guest user is used.
   */
  ensureGuest(): Promise<{ user: User }> {
    return this.call(
      () => this.post<{ user: User }>('/auth/guest', {}),
      () => {
        let u = this.store.getUser();
        if (!u) { u = { id: 0, username: 'Guest-local', guest: true }; this.store.setUser(u); }
        return { user: u };
      },
    );
  }

  /**
   * Turn the current guest into a registered account (same identity, so all
   * progress carries over). Throws 409 if already registered or the name is
   * taken — in which case the player should `login` instead.
   */
  claim(username: string, password: string): Promise<{ user: User }> {
    return this.call(
      () => this.post<{ user: User }>('/auth/claim', { username, password }),
      () => { const u = { id: 0, username, guest: false }; this.store.setUser(u); return { user: u }; },
    );
  }

  /** Create an account and sign in. (Offline: a local dev user is stored.) */
  signup(username: string, password: string): Promise<{ user: User }> {
    return this.call(
      () => this.post<{ user: User }>('/auth/signup', { username, password }),
      () => { const user = { id: 0, username }; this.store.setUser(user); return { user }; },
    );
  }

  /** Sign in. (Offline: records a local dev user so logged-in flows work.) */
  login(username: string, password: string): Promise<{ user: User }> {
    return this.call(
      () => this.post<{ user: User }>('/auth/login', { username, password }),
      () => { const user = { id: 0, username }; this.store.setUser(user); return { user }; },
    );
  }

  /** Sign out (clears the shared session). */
  logout(): Promise<{ ok: true }> {
    return this.call(
      () => this.post<{ ok: true }>('/auth/logout'),
      () => { this.store.clearUser(); return { ok: true as const }; },
    );
  }

  // --- profile (per game) ---

  /** This game's profile for the current user, or `profile: null`. */
  getProfile<TData = unknown>(): Promise<{ profile: Profile<TData> | null }> {
    return this.call(
      () => this.req(`${this.game()}/profile`),
      () => ({ profile: this.store.getProfile<TData>() }),
    );
  }

  /** Create or update this game's profile for the current user. */
  setProfile<TData = unknown>(
    patch: { displayName?: string | null; data?: TData },
  ): Promise<{ profile: Profile<TData> }> {
    return this.mutateQueued(
      { kind: 'setProfile', patch: { ...patch } },
      () => ({
        profile: this.store.setProfile<TData>(
          this.slug ?? 'app', patch.displayName ?? null, (patch.data ?? {}) as TData,
        ),
      }),
    );
  }

  // --- saves (per game, multi-slot) ---

  /** Metadata for every save slot (no payloads). */
  listSaves(): Promise<{ saves: SaveMeta[] }> {
    return this.call(
      () => this.req(`${this.game()}/saves`),
      () => ({ saves: this.store.listSaves() }),
    );
  }

  /** One slot's full contents, or `save: null` if the slot is empty. */
  getSave<TData = unknown>(slot: string): Promise<{ save: Save<TData> | null }> {
    return this.call(
      () => this.req(`${this.game()}/saves/${encodeURIComponent(slot)}`),
      () => ({ save: this.store.getSave<TData>(slot) }),
    );
  }

  /** Create or overwrite a save slot. `data` is any JSON up to 64 KB. */
  putSave<TData = unknown>(
    slot: string, data: TData, label?: string,
  ): Promise<{ ok: true; updatedAt: number }> {
    return this.mutateQueued(
      { kind: 'putSave', slot, data, label: label ?? null },
      () => ({ ok: true as const, updatedAt: this.store.putSave(slot, data, label) }),
    );
  }

  /** Delete a save slot. */
  deleteSave(slot: string): Promise<{ ok: true }> {
    return this.mutateQueued(
      { kind: 'deleteSave', slot },
      () => { this.store.deleteSave(slot); return { ok: true as const }; },
    );
  }

  // --- stats (per game) ---

  /** Numeric stats for the current user, or another user via `userId`. */
  getStats(userId?: number): Promise<{ stats: Stats }> {
    const q = userId != null ? `?user=${encodeURIComponent(userId)}` : '';
    return this.call(
      () => this.req(`${this.game()}/stats${q}`),
      () => ({ stats: this.store.getStats() }),
    );
  }

  /** Overwrite a stat. */
  setStat(key: string, value: number): Promise<{ key: string; value: number }> {
    return this.mutateQueued(
      { kind: 'setStat', key, value },
      () => ({ key, value: this.store.updateStat(key, value, 'set') }),
    );
  }

  /** Add to a stat (creating it at `amount` if absent). */
  incrStat(key: string, amount = 1): Promise<{ key: string; value: number }> {
    return this.mutateQueued(
      { kind: 'incrStat', key, amount },
      () => ({ key, value: this.store.updateStat(key, amount, 'incr') }),
    );
  }

  /** Keep the larger of the stored and given value. */
  maxStat(key: string, value: number): Promise<{ key: string; value: number }> {
    return this.mutateQueued(
      { kind: 'maxStat', key, value },
      () => ({ key, value: this.store.updateStat(key, value, 'max') }),
    );
  }

  // --- leaderboards ---

  /** Submit a score. The board is created on first use; only a best score sticks. */
  submitScore(
    boardKey: string, score: number, opts: SubmitScoreOptions = {},
  ): Promise<SubmitScoreResult> {
    return this.mutateQueued(
      { kind: 'submitScore', key: boardKey, score, opts },
      () => { const { board, best } = this.store.submitScore(boardKey, score, opts); return { board, best, rank: 1 }; },
    );
  }

  /** A single board's ranked entries. */
  getLeaderboard(boardKey: string, limit = 50): Promise<LeaderboardResult> {
    return this.call(
      () => this.req(
        `${this.game()}/leaderboards/${encodeURIComponent(boardKey)}?limit=${encodeURIComponent(limit)}`,
      ),
      () => {
        const local = this.store.getBoard(boardKey);
        if (!local) {
          return { board: { key: boardKey, title: boardKey, sortDir: 'desc' }, entries: [] };
        }
        const user = this.store.getUser();
        return {
          board: local.board,
          entries: [{
            rank: 1, userId: user?.id ?? 0, username: user?.username ?? 'you',
            score: local.best, meta: null,
          }],
        };
      },
    );
  }

  /** The boards this game owns (titles/keys, no entries). */
  listLeaderboards(): Promise<{ boards: Board[] }> {
    return this.call(
      () => this.req(`${this.game()}/leaderboards`),
      () => ({ boards: this.store.listBoards() }),
    );
  }

  /** Every board across every game, each with its top entries. */
  allLeaderboards(top = 5): Promise<{ games: GameLeaderboards[] }> {
    return this.call(
      () => this.req(`/leaderboards?top=${encodeURIComponent(top)}`),
      () => ({ games: [] }),
    );
  }

  // --- analytics (fire-and-forget — never throw) ---

  /** Record a "play". Call once when your game starts. */
  recordPlay(): Promise<void> {
    return this.event('play');
  }

  /** Record a "heartbeat". Call periodically while the game is active. */
  heartbeat(): Promise<void> {
    return this.event('heartbeat');
  }

  /** Record a custom event. Swallows errors — telemetry must not break a game.
   *  Offline events are buffered and flushed on reconnect. */
  async event(type: string): Promise<void> {
    if (!this.slug) return;
    if (this.isOffline) { this.store.bufferEvent(type); this.notifyStatus(); return; }
    try {
      await this.post(`${this.game()}/events`, { type });
    } catch (err) {
      if (err instanceof HubError && err.isOffline) { this.setOnline(false); this.store.bufferEvent(type); }
    }
  }

  /** This game's analytics totals. */
  analytics(): Promise<GameAnalytics> {
    return this.call(
      () => this.req(`${this.game()}/analytics`),
      () => ({ slug: this.slug ?? 'app', totalPlays: 0, uniquePlayers: 0, activeNow: 0 }),
    );
  }

  /** Catalog-wide analytics (global totals + per-game breakdown). */
  globalAnalytics(): Promise<GlobalAnalytics> {
    return this.call(
      () => this.req('/analytics'),
      () => ({ global: { totalPlays: 0, uniquePlayers: 0, activeNow: 0 }, games: [] }),
    );
  }

  // --- catalog ---

  /** The list of games, for "jump to another game" style navigation. */
  listGames(): Promise<{ games: GameInfo[] }> {
    return this.call(
      () => this.req('/games'),
      () => ({ games: [] }),
    );
  }

  // --- favorites ---

  /**
   * Starred games (slugs), shown first in the menu's game list. Server-backed
   * per account, mirrored to localStorage so the list still renders offline.
   */
  favorites(): Promise<{ games: string[] }> {
    return this.call(
      async () => {
        const r = await this.req<{ games: string[] }>('/favorites');
        writeLocalFavorites(r.games);
        return r;
      },
      () => ({ games: readLocalFavorites() }),
    );
  }

  /** Star (`on = true`) or unstar a game. Needs a connection. */
  async setFavorite(slug: string, on: boolean): Promise<{ games: string[] }> {
    const r = await this.req<{ games: string[] }>(`/favorites/${encodeURIComponent(slug)}`, {
      method: 'PUT', body: JSON.stringify({ on }),
    });
    writeLocalFavorites(r.games);
    return r;
  }

  // --- records ---

  /** This user's leaderboard standings, grouped by game (all games, or one via
   *  `forSlug`). Empty offline / logged out. */
  myRecords(forSlug?: string): Promise<{ games: Array<{ slug: string; title: string; records: Array<{ key: string; title: string; score: number; sortDir: SortDir; rank: number }> }> }> {
    const q = forSlug ? `?game=${encodeURIComponent(forSlug)}` : '';
    return this.call(() => this.req(`/me/records${q}`), () => ({ games: [] }));
  }

  // --- inventory & economy (per game) ---

  /** This game's inventory + coin balance for the current user. */
  getInventory(): Promise<{ items: Array<{ key: string; qty: number }>; coins: number }> {
    return this.call(() => this.req(`${this.game()}/inventory`), () => ({ items: [], coins: 0 }));
  }
  /** Another player's available holdings (for composing a trade). */
  playerInventory(userId: number): Promise<{ items: Array<{ key: string; qty: number }>; coins: number }> {
    return this.call(() => this.req(`${this.game()}/players/${encodeURIComponent(userId)}/inventory`), () => ({ items: [], coins: 0 }));
  }
  /** Add goods to the caller (gameplay rewards). Returns the new snapshot. */
  grant(bundle: { items?: Record<string, number>; coins?: number }): Promise<{ items: Array<{ key: string; qty: number }>; coins: number }> {
    return this.post(`${this.game()}/inventory/grant`, bundle);
  }
  /** Atomic swap with the house: remove `take`, add `give`. */
  exchange(take?: unknown, give?: unknown): Promise<{ items: Array<{ key: string; qty: number }>; coins: number }> {
    return this.post(`${this.game()}/inventory/exchange`, { take, give });
  }
  sell(items: Record<string, number>, coins: number): Promise<unknown> { return this.post(`${this.game()}/inventory/exchange`, { take: { items }, give: { coins } }); }
  buy(coins: number, items: Record<string, number>): Promise<unknown> { return this.post(`${this.game()}/inventory/exchange`, { take: { coins }, give: { items } }); }
  /** Wipe this user's progress for this game (saves/stats/inventory/coins). */
  resetGame(): Promise<{ ok: true }> { return this.post(`${this.game()}/reset`); }

  // --- trades (per game, async player-to-player) ---

  listPlayers(): Promise<{ players: unknown[] }> { return this.call(() => this.req(`${this.game()}/trades/players`), () => ({ players: [] })); }
  listTrades(opts: { box?: string; status?: string } = {}): Promise<{ offers?: unknown[]; trades?: unknown[] }> {
    const q = new URLSearchParams();
    if (opts.box) q.set('box', opts.box);
    if (opts.status) q.set('status', opts.status);
    const s = q.toString();
    return this.call(() => this.req(`${this.game()}/trades${s ? `?${s}` : ''}`), () => ({ offers: [] }));
  }
  createTrade(toUser: string | number, give?: unknown, want?: unknown, opts: { note?: string } = {}): Promise<unknown> {
    return this.post(`${this.game()}/trades`, { toUser, give, want, note: opts.note });
  }
  acceptTrade(id: string | number): Promise<unknown> { return this.post(`${this.game()}/trades/${encodeURIComponent(String(id))}/accept`); }
  declineTrade(id: string | number): Promise<unknown> { return this.post(`${this.game()}/trades/${encodeURIComponent(String(id))}/decline`); }
  cancelTrade(id: string | number): Promise<unknown> { return this.post(`${this.game()}/trades/${encodeURIComponent(String(id))}/cancel`); }
  counterTrade(id: string | number, give?: unknown, want?: unknown, opts: { note?: string } = {}): Promise<unknown> {
    return this.post(`${this.game()}/trades/${encodeURIComponent(String(id))}/counter`, { give, want, note: opts.note });
  }
}

// ---------------------------------------------------------------------------
// Injected-menu visibility. The menu (/_hub/menu.js) may load before or after
// the game, and a vendored game bundles its own copy of this client, so the
// shared state is a window global + a window event rather than an object:
//   window.__HUB_MENU_VISIBLE__  (boolean, absent = visible)
//   'hub:menu-visibility'        (CustomEvent, detail: { visible: boolean })
// menu.js reads the global on boot and listens for the event.
// ---------------------------------------------------------------------------

/** Control over the injected hub menu button. */
export interface HubMenuControl {
  /** Show (true) or hide (false) the menu button. Hidden = faded out, not
   *  focusable, `aria-hidden`; an open drawer stays open until closed, and the
   *  gamepad Select button still opens it. A tiny corner hotspot peeks it back
   *  for a few seconds on hover/tap so players can always reach it. */
  setVisible(visible: boolean): void;
  show(): void;
  hide(): void;
  /** The last requested visibility (true unless a game hid it). */
  readonly visible: boolean;
}

const hubMenu: HubMenuControl = {
  setVisible(visible: boolean): void {
    if (typeof window === 'undefined') return;
    const v = !!visible;
    const w = window as any;
    if (w.__HUB_MENU_VISIBLE__ === v || (w.__HUB_MENU_VISIBLE__ === undefined && v)) return;
    w.__HUB_MENU_VISIBLE__ = v;
    try { window.dispatchEvent(new CustomEvent('hub:menu-visibility', { detail: { visible: v } })); } catch { /* */ }
  },
  show(): void { this.setVisible(true); },
  hide(): void { this.setVisible(false); },
  get visible(): boolean {
    return typeof window === 'undefined' || (window as any).__HUB_MENU_VISIBLE__ !== false;
  },
};

// ---------------------------------------------------------------------------
// Social & multiplayer namespaces (multiplayer-impl.md §7.2).
//
// The live implementation is the runtime bundle /_hub/social.js, which the
// injected menu loads and which installs `window.__HUB_RT__` (then fires the
// window event 'hub:rt-ready'). These namespaces are deliberately thin so a
// vendored copy of this file never goes stale:
//
//   - listeners (social.on, mp.onLaunch, mp.onJoinInfo) are kept here and
//     attached whenever the runtime appears — they never expire;
//   - "latest state" calls (presence.set/clear, mp.setBusy, notify.setQuiet)
//     are remembered and replayed when the runtime appears;
//   - UI openers (social.open*) wait up to RT_WAIT_MS, then are dropped
//     silently (no-op);
//   - calls that return data (social.friends, mp.invite/ticket/setJoinInfo,
//     rooms.*) wait up to RT_WAIT_MS, then reject with OfflineError;
//   - synchronous reads (social.counts/chatMode, mp.party) return neutral
//     values (zeros / 'off' / null) until the runtime is up.
//
// With no `window.__HUB__` (a page the hub didn't inject: `hub:false`, local
// dev) the runtime can never arrive, so waits end immediately.
// ---------------------------------------------------------------------------

/** How long data/UI calls wait for /_hub/social.js before giving up. */
const RT_WAIT_MS = 15_000;

interface RtWindow { __HUB_RT__?: RealtimeApi; __HUB__?: unknown }

/** Resolves the runtime social API, waiting for it to load when necessary. */
class RtBridge {
  private readyCbs: Array<(rt: RealtimeApi) => void> = [];

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('hub:rt-ready', () => this.flush());
  }

  /** The runtime API if it has loaded. */
  current(): RealtimeApi | null {
    if (typeof window === 'undefined') return null;
    return (window as unknown as RtWindow).__HUB_RT__ ?? null;
  }

  /** Run `cb` as soon as the runtime exists (now, or whenever it loads). */
  onReady(cb: (rt: RealtimeApi) => void): void {
    const rt = this.current();
    if (rt) cb(rt); else this.readyCbs.push(cb);
  }

  /** The runtime, waiting up to RT_WAIT_MS; rejects with OfflineError. */
  whenReady(): Promise<RealtimeApi> {
    const rt = this.current();
    if (rt) return Promise.resolve(rt);
    if (typeof window === 'undefined' || !(window as unknown as RtWindow).__HUB__) {
      return Promise.reject(new OfflineError('Online features are not available on this page.'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.readyCbs.indexOf(done);
        if (i >= 0) this.readyCbs.splice(i, 1);
        reject(new OfflineError('Online features did not load.'));
      }, RT_WAIT_MS);
      const done = (r: RealtimeApi): void => { clearTimeout(timer); resolve(r); };
      this.readyCbs.push(done);
    });
  }

  /** Attach a listener now or on load; the returned function detaches it. */
  subscribe(attach: (rt: RealtimeApi) => () => void): () => void {
    let off: (() => void) | null = null;
    let cancelled = false;
    this.onReady((rt) => { if (!cancelled) off = attach(rt); });
    return () => { cancelled = true; if (off) off(); };
  }

  /** Call the runtime (waiting for it) and re-wrap its errors as this file's classes. */
  async call<T>(fn: (rt: RealtimeApi) => Promise<T>): Promise<T> {
    const rt = await this.whenReady();
    try { return await fn(rt); } catch (err) { throw toHubError(err); }
  }

  private flush(): void {
    const rt = this.current();
    if (!rt) return;
    const cbs = this.readyCbs;
    this.readyCbs = [];
    cbs.forEach((cb) => { try { cb(rt); } catch (err) { console.error('[hub] social runtime callback failed', err); } });
  }
}

/**
 * Errors from the runtime bundle are a different class (it is a separate
 * bundle), so re-create them as this file's HubError / ContentRejectedError /
 * OfflineError to make `instanceof` work in games.
 */
function toHubError(err: unknown): HubError {
  if (err instanceof HubError) return err;
  if (!err || typeof err !== 'object') return new HubError(String(err));
  const e = err as Record<string, unknown>;
  const message = typeof e.message === 'string' ? e.message : 'Request failed';
  const status = typeof e.status === 'number' ? e.status : undefined;
  if (e.code === 'offline') return new OfflineError(message);
  return errorFor(message, status, errorDetails(e));
}

/** `hub.presence` — what you're doing, shown to friends (privacy is automatic). */
export interface HubPresenceApi {
  /** Report an activity, e.g. `{kind:'playing', detail:'Level 3'}`. Coalesced; safe to call often. */
  set(p: PresenceInput): void;
  /** Back to "in the menu". */
  clear(): void;
}

/** `hub.social` — friends and the hub's social dialogs. */
export interface HubSocialApi {
  /** Open a player card (add friend / message / invite / block / report). */
  openPlayer(ref: PlayerRef): void;
  /** Open the hub menu on the Friends section. */
  openFriends(): void;
  /** Open the chat with a friend. */
  openChat(userId: number): void;
  /** Open the invite picker (current game by default). */
  openInvite(opts?: { userId?: number; mode?: string }): void;
  /** Open the game-suggestion form + board. */
  openSuggest(): void;
  /** Open notification settings, optionally focused on a game's lobby bell. */
  openNotify(opts?: { game?: string }): void;
  /** Friends with live presence. Rejects with OfflineError without the runtime. */
  friends(): Promise<FriendEntry[]>;
  /** Live counts; all zero until the runtime is up. */
  counts(): SocialCounts;
  /** Effective chat mode (with these players); 'off' until the runtime is up. */
  chatMode(userIds?: number[]): ChatMode;
  /** Subscribe to social events; works before the runtime loads. */
  on<E extends keyof SocialEvents>(ev: E, cb: (d: SocialEvents[E]) => void): () => void;
}

/** `hub.mp` — the multiplayer lifecycle (multiplayer.md §7). */
export interface HubMpApi {
  /** Invite/join/watch arrivals. Call at boot; launches that arrived earlier are buffered. */
  onLaunch(cb: (l: Launch) => void): () => void;
  /** The party leader published join info (e.g. a room code). */
  onJoinInfo(cb: (e: JoinInfoEvent) => void): () => void;
  /** Invite a friend to this game. Rejects with HubError/OfflineError. */
  invite(userId: number, opts?: { mode?: string }): Promise<InviteResult>;
  /**
   * A live match is in progress: the hub confirms before navigating away and
   * overlay events carry `canPause:false`.
   */
  setBusy(busy: boolean, opts?: { label?: string }): void;
  /** A 60-second identity ticket for your own game server. */
  ticket(): Promise<string>;
  /** Host side, own-server games: tell the party where to connect. */
  setJoinInfo(partyId: string, info: Record<string, string>): Promise<void>;
  /** My current party, or null (also null until the runtime is up). */
  party(): Party | null;
}

/** `hub.rooms` — hub relay rooms (static games, no server). */
export interface HubRoomsApi {
  create(opts?: RoomCreateOptions): Promise<HubRoom>;
  join(codeOrId: string, opts?: { spectate?: boolean }): Promise<HubRoom>;
  /** Public rooms in the lobby phase for this game. */
  list(opts?: { mode?: string }): Promise<RoomInfo[]>;
}

/** `hub.notify` — toast behaviour. */
export interface HubNotifyApi {
  /** Quiet = toasts collapse into the menu badge; invites still show as a small pill. */
  setQuiet(quiet: boolean): void;
}

/**
 * `hub.race` — races (docs/multiplayer.md "Races"). Declare `game.race` in
 * package.json, call `define` at boot, put a Race button on your menu that
 * calls `create({params})` (or `browse()`), and report `status` / `finish` /
 * `lose`. The hub does the matching, the waiting card, invites, the
 * countdown, the live HUD, the referee, the result card and the history.
 */
export interface HubRaceApi {
  /** Register how the hub starts/ends your race. Call once at boot (works before the runtime loads). */
  define(def: RaceDefinition): void;
  /** Create a race with these params; the hub shows the waiting card. Rejects with HubError/OfflineError. */
  create(opts?: RaceCreateOptions): Promise<RoomInfo>;
  /** Join a race by code (or watch: `{ spectate: true }`). */
  join(code: string, opts?: { spectate?: boolean }): Promise<RoomInfo>;
  /** Public races in this game waiting for a racer. */
  list(): Promise<RoomInfo[]>;
  /** Open the hub's "Open races" sheet (join one, or type a code). */
  browse(): void;
  /** Open the hub's race history (this game by default). */
  openHistory(opts?: { game?: string | null; with?: number }): void;
  /** The signed-in player's races. */
  history(q?: RaceHistoryQuery): Promise<RaceHistory>;
  /** Live stats for the HUD (+ optional 0..1 progress). Throttled and coalesced: call it on every change. */
  status(stats: RaceStats, progress?: number): void;
  /** I finished: resolves with the result if I won, null if someone was first. */
  finish(stats?: RaceStats): Promise<RaceResult | null>;
  /** I'm out (game over / no lives): the others race on, the last one in wins. */
  lose(stats?: RaceStats): Promise<void>;
  /** Give up. */
  forfeit(): Promise<void>;
  /** Leave the race (a forfeit if it's running). */
  leave(): Promise<void>;
  /** Ask for another round after a race. */
  rematch(params?: RaceParams): Promise<void>;
  /** The race this page is in (RoomInfo with `.race`), or null. */
  current(): RoomInfo | null;
  /** Subscribe to race events; works before the runtime loads. */
  on<E extends keyof RaceEvents>(ev: E, cb: (d: RaceEvents[E]) => void): () => void;
}

/** Wraps a runtime room so its rejections use this file's error classes. */
class RoomHandle implements HubRoom {
  constructor(private readonly room: HubRoom) {}
  get info(): RoomInfo { return this.room.info; }
  get state(): Record<string, unknown> { return this.room.state; }
  get me(): HubRoom['me'] { return this.room.me; }
  on<E extends keyof RoomEvents>(ev: E, cb: (d: RoomEvents[E]) => void): () => void { return this.room.on(ev, cb); }
  ready(ready: boolean): Promise<void> { return wrap(this.room.ready(ready)); }
  seat(data: unknown): Promise<void> { return wrap(this.room.seat(data)); }
  start(): Promise<void> { return wrap(this.room.start()); }
  send(data: unknown, opts?: { to?: number }): Promise<void> { return wrap(this.room.send(data, opts)); }
  setState(patch: Record<string, unknown>, opts?: { replace?: boolean }): Promise<void> { return wrap(this.room.setState(patch, opts)); }
  chat(text: string): Promise<string> { return wrap(this.room.chat(text)); }
  quick(phraseId: string): Promise<void> { return wrap(this.room.quick(phraseId)); }
  kick(userId: number): Promise<void> { return wrap(this.room.kick(userId)); }
  leave(): Promise<void> { return wrap(this.room.leave()); }
  end(results?: unknown): Promise<void> { return wrap(this.room.end(results)); }
}

function wrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => { throw toHubError(err); });
}

/** One JSON POST to the hub API (same-origin cookie), mapped to hub errors. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(detectApiBase() + path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch {
    throw new OfflineError();
  }
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty / non-JSON body */ }
  if (!res.ok) {
    const d = errorDetails(json);
    throw errorFor(d.error || `Request failed (${res.status})`, res.status, d);
  }
  return json as T;
}

/**
 * A 60-second identity ticket for this game's own server (POST /mp/ticket).
 *
 * Deliberately a direct request rather than a call into the live social
 * runtime: a game's "Play online" must not depend on /_hub/social.js having
 * loaded (on the first visit after a deploy the service worker can still
 * serve an older menu that never loads it). If the page has no session yet,
 * a guest one is created and the request retried once.
 */
async function fetchTicket(): Promise<string> {
  const slug = detectSlug();
  if (!slug) throw new HubError('Hub: could not determine the game slug.');
  try {
    return (await postJson<{ ticket: string }>('/mp/ticket', { slug })).ticket;
  } catch (err) {
    if (!(err instanceof HubError) || err.status !== 401) throw err;
    await postJson('/auth/guest', {});
    return (await postJson<{ ticket: string }>('/mp/ticket', { slug })).ticket;
  }
}

/**
 * A minimal top-centre notice for when the social runtime (which owns the real
 * toasts) isn't available. Plain DOM with inline styles in the hub palette;
 * one at a time; auto-hides after `ms` (0 = until replaced or hidden).
 */
const FALLBACK_ID = 'hub-fallback-notice';
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
function fallbackNotice(text: string, ms = 0): void {
  if (typeof document === 'undefined' || !document.body) return;
  let el = document.getElementById(FALLBACK_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = FALLBACK_ID;
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;'
      + 'max-width:min(92vw,420px);padding:10px 14px;border-radius:10px;font:13px/1.4 "Space Mono",ui-monospace,monospace;'
      + 'background:#11141c;color:#e8e6df;border:1px solid #2a3142;box-shadow:0 8px 24px rgba(0,0,0,.5);pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = text;
  if (fallbackTimer) clearTimeout(fallbackTimer);
  fallbackTimer = ms > 0 ? setTimeout(hideFallbackNotice, ms) : null;
}
/** Why the live social runtime failed to load on this page (set by menu.js), or ''. */
function runtimeError(): string {
  if (typeof window === 'undefined') return '';
  const e = (window as unknown as { __HUB_RT_ERROR__?: unknown }).__HUB_RT_ERROR__;
  return typeof e === 'string' ? e.slice(0, 120) : '';
}

function hideFallbackNotice(): void {
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  if (typeof document !== 'undefined') document.getElementById(FALLBACK_ID)?.remove();
}

/** Build the page's social namespaces around one bridge. */
function makeSocialNamespaces(bridge: RtBridge) {
  // Latest-state calls replay on load: only the last value matters.
  let presence: PresenceInput | null = null;
  let busy: { busy: boolean; label?: string } | null = null;
  let quiet: boolean | null = null;
  bridge.onReady((rt) => {
    if (presence) rt.presence.set(presence);
    if (busy) rt.mp.setBusy(busy.busy, { label: busy.label });
    if (quiet !== null) rt.notify.setQuiet(quiet);
  });
  // Openers wait for the runtime. A tap must never look dead, so if it isn't
  // there within a moment say so, and if it never arrives say how to recover.
  const failed = (): void => {
    const why = runtimeError();
    fallbackNotice(`Friends couldn't load${why ? ` (${why})` : ''}. Reload the page to try again.`, 8000);
  };
  const open = (fn: (rt: RealtimeApi) => void): void => {
    if (bridge.current()) { bridge.whenReady().then(fn, () => {}); return; }
    // The menu already knows the runtime failed (see menu.js wireSocial).
    if (runtimeError()) { failed(); return; }
    const slow = setTimeout(() => fallbackNotice('Friends are still loading…'), 1500);
    let settled = false;
    const onFailed = (): void => { if (!settled) { settled = true; clearTimeout(slow); failed(); } };
    if (typeof window !== 'undefined') window.addEventListener('hub:rt-failed', onFailed, { once: true });
    bridge.whenReady().then((rt) => {
      if (settled) return;
      settled = true; clearTimeout(slow); hideFallbackNotice(); fn(rt);
    }, onFailed);
  };

  const presenceApi: HubPresenceApi = {
    set(p) { presence = { ...p }; bridge.current()?.presence.set(presence); },
    clear() { presence = { kind: 'menu' }; bridge.current()?.presence.clear(); },
  };

  const socialApi: HubSocialApi = {
    openPlayer: (ref) => open((rt) => rt.social.openPlayer(ref)),
    openFriends: () => open((rt) => rt.social.openFriends()),
    openChat: (userId) => open((rt) => rt.social.openChat(userId)),
    openInvite: (opts) => open((rt) => rt.social.openInvite(opts)),
    openSuggest: () => open((rt) => rt.social.openSuggest()),
    openNotify: (opts) => open((rt) => rt.social.openNotify(opts)),
    friends: () => bridge.call((rt) => rt.social.friends()),
    counts: () => bridge.current()?.social.counts() ?? { online: 0, inGame: 0, friendsOnline: 0 },
    chatMode: (userIds) => bridge.current()?.social.chatMode(userIds) ?? 'off',
    on: (ev, cb) => bridge.subscribe((rt) => rt.social.on(ev, cb)),
  };

  const mpApi: HubMpApi = {
    onLaunch: (cb) => bridge.subscribe((rt) => rt.mp.onLaunch(cb)),
    onJoinInfo: (cb) => bridge.subscribe((rt) => rt.mp.onJoinInfo(cb)),
    invite: (userId, opts) => bridge.call((rt) => rt.mp.invite(userId, opts)),
    setBusy(b, opts) {
      busy = { busy: !!b, label: opts?.label };
      // The overlay stack is local, so "can't pause" works even without the runtime.
      getUiStack().setCanPause(!b);
      bridge.current()?.mp.setBusy(busy.busy, { label: busy.label });
    },
    ticket: () => fetchTicket(),
    setJoinInfo: (partyId, info) => bridge.call((rt) => rt.mp.setJoinInfo(partyId, info)),
    party: () => bridge.current()?.mp.party() ?? null,
  };

  const roomsApi: HubRoomsApi = {
    create: (opts) => bridge.call(async (rt) => new RoomHandle(await rt.rooms.create(opts))),
    join: (codeOrId, opts) => bridge.call(async (rt) => new RoomHandle(await rt.rooms.join(codeOrId, opts))),
    list: (opts) => bridge.call((rt) => rt.rooms.list(opts)),
  };

  const notifyApi: HubNotifyApi = {
    setQuiet(q) { quiet = !!q; bridge.current()?.notify.setQuiet(quiet); },
  };

  // Races live in the runtime too; an old cached runtime (RT_VERSION 1) has
  // none, which reads as "not available" rather than a crash.
  let raceDef: RaceDefinition | null = null;
  bridge.onReady((rt) => { if (raceDef) rt.race?.define(raceDef); });
  const needRace = (rt: RealtimeApi): RaceRuntimeApi => {
    if (!rt.race) throw new OfflineError('Races need the latest hub — reload the page.');
    return rt.race;
  };
  const raceApi: HubRaceApi = {
    define(def) { raceDef = def; bridge.current()?.race?.define(def); },
    create: (opts) => bridge.call((rt) => needRace(rt).create(opts)),
    join: (code, opts) => bridge.call((rt) => needRace(rt).join(code, opts)),
    list: () => bridge.call((rt) => needRace(rt).list()),
    browse: () => open((rt) => rt.race?.browse()),
    openHistory: (opts) => open((rt) => rt.race?.openHistory(opts)),
    history: (q) => bridge.call((rt) => needRace(rt).history(q)),
    status: (stats, progress) => { bridge.current()?.race?.status(stats, progress); },
    finish: (stats) => bridge.call((rt) => needRace(rt).finish(stats)),
    lose: (stats) => bridge.call((rt) => needRace(rt).lose(stats)),
    forfeit: () => bridge.call((rt) => needRace(rt).forfeit()),
    leave: () => bridge.call((rt) => needRace(rt).leave()),
    rematch: (params) => bridge.call((rt) => needRace(rt).rematch(params)),
    current: () => bridge.current()?.race?.current() ?? null,
    on: (ev, cb) => bridge.subscribe((rt) => (rt.race ? rt.race.on(ev, cb) : () => {})),
  };

  return { presence: presenceApi, social: socialApi, mp: mpApi, rooms: roomsApi, notify: notifyApi, race: raceApi };
}

const social = makeSocialNamespaces(new RtBridge());

/** A ready-to-use client with slug and API base auto-detected. */
export const hub = new Hub();

/** Construct a fresh client (back-compat with the old createHub factory). */
export function createHub(opts: HubOptions = {}): Hub { return new Hub(opts); }

// ---------------------------------------------------------------------------
// Input system singleton — one per page, shared whether the game vendors this
// client or loads the injected /_hub/hub.js. Persists remaps to localStorage
// (offline-safe) and mirrors them to the cloud via a reserved save slot.
// ---------------------------------------------------------------------------

function makeInputHost() {
  const slug = hub.slug;
  return {
    slug,
    loadOverrides(): InputOverrides | null {
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(`hub:${slug}:input`) : null;
        return raw ? (JSON.parse(raw) as InputOverrides) : null;
      } catch { return null; }
    },
    saveOverrides(o: InputOverrides): void {
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(`hub:${slug}:input`, JSON.stringify(o)); } catch { /* */ }
      try { if (slug) void hub.putSave('__controls', o as unknown).catch(() => {}); } catch { /* */ }
    },
    menu: null as any,
    legacyControls: (typeof window !== 'undefined' && (window as any).__HUB__ && (window as any).__HUB__.controls) || null,
  };
}

let _input: InputSystem | null = null;
/** Get (or lazily create) the page-wide input system. */
export function getInput(): InputSystem {
  if (typeof window !== 'undefined' && (window as any).__HUB_INPUT__) return (window as any).__HUB_INPUT__ as InputSystem;
  const sys = new InputSystem(makeInputHost());
  _input = sys;
  if (typeof window !== 'undefined') (window as any).__HUB_INPUT__ = sys;
  return sys;
}

if (typeof window !== 'undefined') {
  (window as any).HubSDK = { hub, createHub, Hub, HubError, OfflineError, ContentRejectedError };
}
