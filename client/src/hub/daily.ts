/**
 * Daily challenges — client side.
 *
 * A daily-enabled game calls `hub.daily.define({ play })` once at load. `play`
 * receives a `DailyChallenge` ({ day, seed, token }) and should set up + start
 * that exact challenge (derive difficulty/level from `seed`). When the player
 * finishes, the game calls `hub.daily.complete({ score, ... })`.
 *
 * The system is a page-wide singleton (window.__HUB_DAILY__) shared between the
 * game's bundled client and the injected menu, so the menu can start a day
 * (`startAndPlay`) on the same instance the game registered its `play` on.
 * Deep links (`/<slug>/?daily=YYYY-MM-DD` from the home hub) auto-start on load.
 */

export interface DailyChallenge {
  day: string;
  seed: number;
  token: string;
  alreadyCompleted?: boolean;
}

/** One completed day: when (server clock, ms) + the metadata the game sent. */
export interface DailyCompletion {
  completedAt: number;
  meta: unknown;
}

/** A game's completions keyed by calendar day 'YYYY-MM-DD'. The client owns the
 *  calendar/window using its *local* date, so the server just reports which
 *  days are done. */
export type DailyCompletions = Record<string, DailyCompletion>;

export interface DailyStatus {
  enabled: boolean;
  today: string; // UTC 'today' hint; the client uses its own local date
  completions: DailyCompletions;
}

export interface DailyGameStatus {
  slug: string;
  title: string;
  completions: DailyCompletions;
}

export interface DailyAll {
  today: string;
  games: DailyGameStatus[];
  global: Array<{ rank: number; userId: number; username: string; score: number }>;
}

export interface DailyStartResponse {
  token: string;
  day: string;
  seed: number;
  expiresAt: number;
  alreadyCompleted: boolean;
  completedAt: number | null;
  meta: unknown;
}

export interface DailyCompleteResponse {
  ok: boolean;
  day: string;
  count: number;
  rank: number | null;
}

/** What the DailySystem needs from the hub client (the HTTP calls + emit). */
export interface DailyHost {
  slug: string | null;
  status(): Promise<DailyStatus>;
  all(): Promise<DailyAll>;
  start(day: string): Promise<DailyStartResponse>;
  complete(day: string, token: string, meta: unknown): Promise<DailyCompleteResponse>;
  emit(name: string, detail?: unknown): void;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class DailySystem {
  private host: DailyHost;
  private playFn: ((c: DailyChallenge) => void) | null = null;
  private pendingDay: string | null = null;

  /** The challenge currently in progress (set by start, cleared by complete).
   *  A game's win handler checks this: `if (hub.daily.active) hub.daily.complete(...)`. */
  active: DailyChallenge | null = null;

  constructor(host: DailyHost) {
    this.host = host;
    if (typeof window !== 'undefined') {
      // The injected menu (a different module instance) asks us to start a day.
      window.addEventListener('hub:daily-start', (e) => {
        const day = (e as CustomEvent).detail && (e as CustomEvent).detail.day;
        if (typeof day === 'string') void this.startAndPlay(day);
      });
    }
  }

  /** Has a game registered a daily-challenge handler on this page? */
  get isDefined(): boolean { return this.playFn != null; }

  /**
   * Register the game's challenge runner. Called once at game load. If the page
   * was deep-linked with `?daily=DATE` (or a start was requested before define),
   * that day auto-starts now.
   */
  define(opts: { play: (challenge: DailyChallenge) => void }): void {
    this.playFn = opts.play;
    const deep = this.deepLinkDay();
    if (deep) { void this.startAndPlay(deep); return; }
    if (this.pendingDay) {
      const d = this.pendingDay;
      this.pendingDay = null;
      void this.startAndPlay(d);
    }
  }

  private deepLinkDay(): string | null {
    if (typeof location === 'undefined') return null;
    try {
      const d = new URL(location.href).searchParams.get('daily');
      return d && DAY_RE.test(d) ? d : null;
    } catch { return null; }
  }

  /**
   * Fetch the signed token for `day`, set it active, and invoke the game's
   * `play`. If `define` hasn't run yet, the day is stashed and played then.
   * No-op (beyond stashing) without a registered handler — so the menu's own
   * instance never fetches a token; only the game's instance plays.
   */
  async startAndPlay(day: string): Promise<void> {
    if (!this.playFn) { this.pendingDay = day; return; }
    try {
      const r = await this.host.start(day);
      this.active = { day: r.day, seed: r.seed, token: r.token, alreadyCompleted: r.alreadyCompleted };
      this.host.emit('hub:daily-started', { day: r.day, seed: r.seed, alreadyCompleted: r.alreadyCompleted });
      this.playFn({ day: r.day, seed: r.seed, token: r.token, alreadyCompleted: r.alreadyCompleted });
    } catch (err) {
      this.host.emit('hub:daily-error', { day, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Record completion of the active challenge with optional metadata
   * (`{ score, difficulty, timeMs, ... }`). Returns the server result (new
   * completion count + rank) or null if no challenge is active.
   */
  async complete(meta?: Record<string, unknown>): Promise<DailyCompleteResponse | null> {
    const a = this.active;
    if (!a) return null;
    try {
      const res = await this.host.complete(a.day, a.token, meta ?? {});
      this.active = null;
      this.host.emit('hub:daily-complete', { day: a.day, count: res.count, rank: res.rank, meta: meta ?? {} });
      return res;
    } catch (err) {
      this.host.emit('hub:daily-error', { day: a.day, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /** Abandon the active challenge without recording it (e.g. player quit). */
  cancel(): void { this.active = null; }

  /** This game's window + the player's completion state. */
  status(): Promise<DailyStatus> { return this.host.status(); }

  /** Every daily-enabled game + the global standings (for the home hub). */
  all(): Promise<DailyAll> { return this.host.all(); }
}
