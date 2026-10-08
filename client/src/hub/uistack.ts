/**
 * Hub overlay stack — "is the player looking at hub UI right now?"
 *
 * Every piece of hub UI that covers the game (the menu drawer, a dialog, the
 * chat sheet, an interacted-with toast…) pushes an entry while it is showing
 * and pops it when it goes away. The stack turns that into two edges a game
 * can act on (multiplayer.md §5.7, multiplayer-impl.md §7.1):
 *
 *   - `open`  — depth went 0 → 1: pause the game.
 *   - `close` — depth went back to 0: show the pause screen (or resume).
 *
 * Why a stack and not a flag: hub UI nests (drawer → player card → chat), and
 * a game must see ONE open/close pair for the whole visit, not a flicker per
 * dialog.
 *
 * It is a page-wide singleton on `window.__HUB_UI__` because several bundles
 * share it: the canonical `/_hub/hub.js`, a game's vendored copy of the hub
 * client, and the runtime social bundle `/_hub/social.js`. The object carries
 * a `version`: a newer bundle replaces an older, idle instance (adopting its
 * listeners) and keeps using an older one that has UI open — every version
 * implements this interface — so open entries are never orphaned.
 *
 * While the stack is open it also suspends the game's `play` input group (so a
 * paddle doesn't move while the player types), even for games that ignore the
 * events. Calls the game makes to enable/disable `play` during that time are
 * remembered and applied on close, so a game that pauses itself on `open`
 * stays paused afterwards.
 *
 * This module has no imports so it stays trivially vendorable.
 */

/** Why the overlay opened — lets a game word its pause screen. */
export type OverlayReason = 'menu' | 'chat' | 'dialog' | 'keyboard' | 'invite' | 'notify';

/** Payload of `open` / `close` (and of the `hub:overlay-*` window events). */
export interface OverlayEvent {
  /** The reason of the entry that opened (for `open`) or closed last (for `close`). */
  reason: OverlayReason;
  /**
   * False during a live online match (`hub.mp.setBusy(true)`): the game must
   * keep simulating, so it should not pause.
   */
  canPause: boolean;
}

/** Options for {@link UiStack.autoPause}. */
export interface AutoPauseOptions {
  /** Pause exactly the way the game's own pause does. */
  pause(): void;
  /** Resume play. Only called when `resumeOnClose` is true. */
  resume?(): void;
  /**
   * Resume automatically when the hub UI closes. Default false: action games
   * should show their pause screen so the player resumes deliberately;
   * turn-based and idle games may pass true.
   */
  resumeOnClose?: boolean;
}

/** Listener for overlay edges. */
export type OverlayListener = (e: OverlayEvent) => void;

/** State an older, idle stack hands to a newer one replacing it. @internal */
export interface UiStackHandoff {
  listeners: { open: OverlayListener[]; close: OverlayListener[] };
  canPause: boolean;
}

/** The page-wide overlay stack (see module docs). */
export interface UiStack {
  /** Implementation version; a newer bundle replaces an older, idle instance. */
  readonly version: number;
  /** Register a covering piece of UI. Returns its idempotent `pop()`. */
  push(reason: OverlayReason): () => void;
  /** True while any hub UI covers the game. */
  readonly isOpen: boolean;
  /** Number of open entries (nesting depth). */
  readonly depth: number;
  /** Whether the game may pause right now (false during an online match). */
  readonly canPause: boolean;
  /** Subscribe to an edge. Returns an unsubscribe function. */
  on(ev: 'open' | 'close', cb: OverlayListener): () => void;
  /**
   * One-line adoption for games: pause on open (unless `canPause` is false),
   * optionally resume on close. Returns a function that detaches it.
   */
  autoPause(opts: AutoPauseOptions): () => void;
  /** Driven by `hub.mp.setBusy`: false = in a live match that can't pause. */
  setCanPause(v: boolean): void;
  /** Hand listeners to a newer version replacing this (idle) instance. @internal */
  handoff(): UiStackHandoff;
}

/** Bump when the UiStack contract gains behaviour; idle older instances are replaced. */
export const UI_STACK_VERSION = 1;

/** The input group the stack suspends while open. */
const PLAY_GROUP = 'play';

/** The slice of the input system the stack needs (window.__HUB_INPUT__). */
interface GroupSwitch {
  isEnabled(group: string): boolean;
  enable(group: string): void;
  disable(group: string): void;
}

interface HubUiWindow {
  __HUB_UI__?: UiStack;
  __HUB_INPUT__?: unknown;
}

function hubWindow(): (Window & HubUiWindow) | null {
  return typeof window === 'undefined' ? null : (window as Window & HubUiWindow);
}

function isGroupSwitch(v: unknown): v is GroupSwitch {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.isEnabled === 'function' && typeof o.enable === 'function' && typeof o.disable === 'function';
}

/**
 * Holds the `play` group disabled for the duration of an overlay visit. The
 * game's own enable/disable calls for `play` are intercepted (recorded, not
 * applied) and the last requested state wins on release.
 */
class PlaySuspension {
  private desired: boolean;
  /** Own-property descriptors we replaced (undefined = the method lived on the prototype). */
  private readonly saved: Record<'enable' | 'disable', PropertyDescriptor | undefined>;

  constructor(private readonly input: GroupSwitch) {
    this.desired = input.isEnabled(PLAY_GROUP);
    if (this.desired) input.disable(PLAY_GROUP);
    this.saved = {
      enable: Object.getOwnPropertyDescriptor(input, 'enable'),
      disable: Object.getOwnPropertyDescriptor(input, 'disable'),
    };
    const origEnable = input.enable.bind(input);
    const origDisable = input.disable.bind(input);
    // Own-property overrides shadow the real methods until release().
    input.enable = (group: string): void => {
      if (group === PLAY_GROUP) this.desired = true; else origEnable(group);
    };
    input.disable = (group: string): void => {
      if (group === PLAY_GROUP) this.desired = false; else origDisable(group);
    };
  }

  /** Remove the interception and apply the state the game last asked for. */
  release(): void {
    for (const key of ['enable', 'disable'] as const) {
      const d = this.saved[key];
      if (d) Object.defineProperty(this.input, key, d);
      else delete (this.input as unknown as Record<string, unknown>)[key];
    }
    if (this.desired) this.input.enable(PLAY_GROUP);
  }
}

class UiStackImpl implements UiStack {
  readonly version = UI_STACK_VERSION;
  private entries: { reason: OverlayReason }[] = [];
  private listeners = { open: new Set<OverlayListener>(), close: new Set<OverlayListener>() };
  private pausable = true;
  private suspension: PlaySuspension | null = null;

  constructor(from?: UiStackHandoff) {
    if (!from) return;
    from.listeners.open.forEach((cb) => this.listeners.open.add(cb));
    from.listeners.close.forEach((cb) => this.listeners.close.add(cb));
    this.pausable = from.canPause;
  }

  get isOpen(): boolean { return this.entries.length > 0; }
  get depth(): number { return this.entries.length; }
  get canPause(): boolean { return this.pausable; }

  push(reason: OverlayReason): () => void {
    const entry = { reason };
    this.entries.push(entry);
    if (this.entries.length === 1) this.opened(reason);
    let popped = false;
    return () => {
      if (popped) return;
      popped = true;
      const i = this.entries.indexOf(entry);
      if (i < 0) return;
      this.entries.splice(i, 1);
      if (this.entries.length === 0) this.closed(reason);
    };
  }

  on(ev: 'open' | 'close', cb: OverlayListener): () => void {
    this.listeners[ev].add(cb);
    return () => { this.listeners[ev].delete(cb); };
  }

  autoPause(opts: AutoPauseOptions): () => void {
    let pausedByUs = false;
    const onOpen = (e: OverlayEvent): void => {
      if (!e.canPause) return;
      pausedByUs = true;
      opts.pause();
    };
    const onClose = (): void => {
      if (pausedByUs && opts.resumeOnClose && opts.resume) opts.resume();
      pausedByUs = false;
    };
    const offOpen = this.on('open', onOpen);
    const offClose = this.on('close', onClose);
    // Registered while hub UI is already up: pause now, as if it just opened.
    if (this.isOpen) onOpen({ reason: this.entries[0].reason, canPause: this.pausable });
    return () => { offOpen(); offClose(); };
  }

  setCanPause(v: boolean): void { this.pausable = v; }

  handoff(): UiStackHandoff {
    const out: UiStackHandoff = {
      listeners: { open: [...this.listeners.open], close: [...this.listeners.close] },
      canPause: this.pausable,
    };
    this.listeners.open.clear();
    this.listeners.close.clear();
    return out;
  }

  private opened(reason: OverlayReason): void {
    this.suspendPlay();
    this.emit('open', { reason, canPause: this.pausable });
  }

  private closed(reason: OverlayReason): void {
    // Listeners run before the play group is restored, so a game that pauses
    // (disables `play`) in its close handler is honoured.
    this.emit('close', { reason, canPause: this.pausable });
    if (this.suspension) { this.suspension.release(); this.suspension = null; }
  }

  private suspendPlay(): void {
    const input = hubWindow()?.__HUB_INPUT__;
    if (!this.suspension && isGroupSwitch(input)) this.suspension = new PlaySuspension(input);
  }

  private emit(ev: 'open' | 'close', e: OverlayEvent): void {
    for (const cb of [...this.listeners[ev]]) {
      try { cb(e); } catch (err) { console.error('[hub] overlay listener failed', err); }
    }
    const w = hubWindow();
    if (!w) return;
    try { w.dispatchEvent(new CustomEvent(`hub:overlay-${ev}`, { detail: e })); } catch { /* old browsers */ }
  }
}

function isUiStack(v: unknown): v is UiStack {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.version === 'number' && typeof o.push === 'function' && typeof o.on === 'function';
}

let fallback: UiStack | null = null;

/**
 * The page-wide overlay stack (`window.__HUB_UI__`). Created on first use. A
 * newer implementation replaces an older one only while it is idle (adopting
 * its listeners). Outside a browser (SSR/tests without a window) a
 * module-local instance is returned.
 */
export function getUiStack(): UiStack {
  const w = hubWindow();
  if (!w) return fallback ?? (fallback = new UiStackImpl());
  const existing = w.__HUB_UI__;
  if (isUiStack(existing) && (existing.version >= UI_STACK_VERSION || existing.isOpen)) return existing;
  const handoff = isUiStack(existing) && typeof existing.handoff === 'function' ? existing.handoff() : undefined;
  const stack = new UiStackImpl(handoff);
  w.__HUB_UI__ = stack;
  return stack;
}
