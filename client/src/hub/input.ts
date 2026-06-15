/**
 * Generic input system for diffenderfer.games — desktop + touch + gamepad.
 *
 * A game declares named inputs (e.g. "moveLeft", "shoot", "jump") that each
 * read as a scalar 0..1, and maps each to keyboard / mouse / touch / gamepad
 * sources. The system handles:
 *   - frame-based edges (isDown / isUp), axes [-1,1] and vectors {x,y,mag<=1}
 *   - device detection + mouse<->gamepad arbitration (last-used wins; keyboard
 *     always on; touch latches like a touch device)
 *   - virtual on-screen controls for touch (DOM overlay; works over Pixi & HTML)
 *   - navigable UI groups (gamepad/keys traverse + act on DOM or registered
 *     Pixi elements, with focus/blur/act events and a highlight ring)
 *   - an on-screen keyboard for text fields
 *   - player remapping + virtual-control customization, persisted
 *   - a zero-config fallback (catalog/menu navigation + keyboard synth) so games
 *     that never call define() still get controller support.
 *
 * All hub-drawn UI lives in one style-isolated shadow root layered over the
 * game, so it is renderer-agnostic.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type InputSource = 'keyboard' | 'mouse' | 'gamepad' | 'touch';

export interface MouseMapping {
  button?: number;            // held while this mouse button is down
  dblclick?: boolean;         // 1 for one frame on double-click
  /** Position relative to screen centre on an axis maps to 0..1 on one side. */
  centerAxis?: 'x' | 'y';
  centerSide?: '+' | '-';     // which side of centre fills 0..1 (default '+')
  /** Relative movement on an axis, scaled by `moveScale` (default 0.1). */
  moveAxis?: 'x' | 'y';
  moveSign?: '+' | '-';
  moveScale?: number;
  wheel?: '+' | '-';          // wheel delta in a direction (decays)
}

export interface GamepadMapping {
  button?: number;            // standard-gamepad button index (0/1 or trigger 0..1)
  /** Axis index + which half: '+' positive, '-' negative, '±' absolute value. */
  axis?: [number, '+' | '-' | '±'];
}

export interface TouchMapping {
  button?: string;            // id of a virtual button that drives this input
  stick?: string;             // id of a virtual joystick
  axis?: 'x+' | 'x-' | 'y+' | 'y-' | 'x' | 'y'; // which half/axis of that stick
  tap?: boolean;              // 1 for one frame on a tap anywhere on the surface
  centerAxis?: 'x' | 'y';
  centerSide?: '+' | '-';
}

export interface InputDef {
  keys?: string[];            // KeyboardEvent.key values (case-insensitive)
  mouse?: MouseMapping;
  gamepad?: GamepadMapping;
  touch?: TouchMapping;
}

export interface AxisDef {
  /** Single input → 0..1 mapped to -1..1 isn't possible; use [neg,pos] pair, or
   *  a single input name meaning -1..1 directly (already-signed source). */
  x?: string | [string, string];
  y?: string | [string, string];
}

export type Anchor =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

export interface VirtualDef {
  id: string;
  type: 'button' | 'joystick' | 'dpad' | 'tap';
  place: Anchor;
  size?: number;              // px (joystick/button diameter; or width if w/h given)
  width?: number;             // px — overrides size for width (non-square controls)
  height?: number;            // px — overrides size for height
  shape?: 'round' | 'circle' | 'square' | 'pill'; // default circle for sticks, round for buttons
  opacity?: number;           // 0..1
  color?: string;             // accent colour (border, knob, pressed fill)
  bg?: string;                // resting background colour
  text?: string;              // label text colour
  label?: string;             // text on a button
  html?: string;              // raw HTML inside the control
  /** For dpad/button: which input(s) this control drives. Joysticks drive the
   *  inputs that reference them via touch.stick. */
  inputs?: { up?: string; down?: string; left?: string; right?: string; press?: string };
}

export interface NavElement {
  id?: string;
  kind?: 'button' | 'text' | 'range' | 'custom';
  el?: HTMLElement;                       // DOM-backed: bounds + click/focus auto
  getBounds?: () => { x: number; y: number; width: number; height: number };
  onFocus?: () => void;
  onBlur?: () => void;
  onAct?: () => void;
}

export interface NavigableDef {
  prev?: string; next?: string;           // traverse inputs (edge)
  up?: string; down?: string;             // optional directional (edge)
  act: string;                            // engage input (edge)
  /** Re-queried after every interaction — DOM can change. */
  elements: () => Array<HTMLElement | NavElement>;
  wrap?: boolean;                         // wrap around at ends (default true)
}

export interface GroupDef {
  inputs: Record<string, InputDef>;
  axes?: Record<string, AxisDef>;
  virtual?: VirtualDef[];
  navigable?: NavigableDef;
  /** Start enabled (default false; call enable() yourself). */
  enabled?: boolean;
}

export interface InputConfig {
  groups: Record<string, GroupDef>;
}

export interface InputReading { value: number; raw: number; isDown: boolean; isUp: boolean; }
export interface Vector { x: number; y: number; mag: number; }

export interface InputOverrides {
  bindings?: Record<string, Partial<InputDef>>;
  virtual?: Record<string, Partial<VirtualDef> & { x?: number; y?: number }>;
  showVirtual?: boolean;
}

/** What the input system needs from the hub to persist remaps. */
export interface InputHost {
  slug: string | null;
  loadOverrides(): InputOverrides | null;
  saveOverrides(o: InputOverrides): void;
  /** Optional menu bridge for the zero-config fallback + Controls launch. */
  menu?: {
    toggle: () => boolean;
    isOpen: () => boolean;
    close: () => void;
    root: ShadowRoot | null;
  } | null;
  /** Legacy game.controls map (window.__HUB__.controls) for zero-config mode. */
  legacyControls?: any;
}

// ---------------------------------------------------------------------------
// Constants reused from the standalone gamepad adapter
// ---------------------------------------------------------------------------

const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
const AXIS_DEADZONE = 0.35;
const NAV_FIRST_DELAY = 320;
const NAV_REPEAT = 130;

const CODE_KEY: Record<string, [string, number]> = {
  ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
  Space: [' ', 32], Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], Backspace: ['Backspace', 8],
  ShiftLeft: ['Shift', 16], ControlLeft: ['Control', 17], AltLeft: ['Alt', 18],
};
for (let c = 65; c <= 90; c += 1) { const L = String.fromCharCode(c); CODE_KEY[`Key${L}`] = [L.toLowerCase(), c]; }
for (let d = 0; d <= 9; d += 1) CODE_KEY[`Digit${d}`] = [String(d), 48 + d];

function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n; }
function now(): number { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

// ---------------------------------------------------------------------------
// Input system
// ---------------------------------------------------------------------------

interface RuntimeInput { def: InputDef; raw: number; prev: number; }

export class InputSystem {
  private host: InputHost;
  private config: InputConfig | null = null;
  private overrides: InputOverrides = {};
  private defined = false;

  private inputs = new Map<string, RuntimeInput>();      // name -> runtime
  private inputGroup = new Map<string, string>();        // input name -> group
  private groupEnabled = new Map<string, boolean>();
  private axes = new Map<string, { group: string; def: AxisDef }>();

  // raw source state (updated by events; sampled each frame)
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private mouseX = 0; private mouseY = 0; private mouseMoved = false;
  private moveDelta = { x: 0, y: 0 };
  private wheelDelta = { x: 0, y: 0 };
  private pulses = new Map<string, number>();            // pulse id -> frame-stamp
  private frame = 0;

  private sticks = new Map<string, { outX: number; outY: number; active: boolean }>();
  private vbuttons = new Set<string>();                  // pressed virtual button ids
  private touchUsed = false;

  private activeSource: InputSource = 'keyboard';
  private gamepadActive = false;

  private listeners = new Map<string, Set<(e: any) => void>>();
  private overlay: Overlay | null = null;
  private nav = new Map<string, NavState>();             // group -> nav state
  private raf = 0;
  private showVirtualOverride: boolean | null = null;    // user/menu toggle
  private menuNav: NavState | null = null;               // built-in nav over the hub menu
  private _selPrev = false; private _actPrev = false; private _backPrev = false;
  private autoNavSel: (() => Array<HTMLElement | NavElement>) | null = null; // game's own menu (opt-in)
  private autoNavState: NavState | null = null;
  private autoNavBack: (() => void) | null = null;

  readonly touchDevice: boolean =
    typeof navigator !== 'undefined' && ((navigator as any).maxTouchPoints > 0 || 'ontouchstart' in window);

  constructor(host: InputHost) {
    this.host = host;
    this.overrides = host.loadOverrides() || {};
    if (this.overrides.showVirtual != null) this.showVirtualOverride = this.overrides.showVirtual;
    this.installGlobalListeners();
    this.start();
  }

  // ---- definition ----

  define(config: InputConfig): void {
    this.config = config;
    this.defined = true;
    this.inputs.clear(); this.inputGroup.clear(); this.axes.clear();
    for (const [gname, g] of Object.entries(config.groups)) {
      if (!this.groupEnabled.has(gname)) this.groupEnabled.set(gname, g.enabled ?? false);
      for (const [iname, def] of Object.entries(g.inputs)) {
        const merged = this.applyBinding(iname, def);
        this.inputs.set(iname, { def: merged, raw: 0, prev: 0 });
        this.inputGroup.set(iname, gname);
      }
      for (const [aname, adef] of Object.entries(g.axes || {})) {
        this.axes.set(aname, { group: gname, def: adef });
      }
      if (g.navigable) this.nav.set(gname, new NavState(g.navigable));
    }
    this.ensureOverlay();
    this.overlay!.build(config, this.overrides, {
      onVButtonDown: (id) => { this.vbuttons.add(id); this.touchActivity(); },
      onVButtonUp: (id) => { this.vbuttons.delete(id); },
      onStick: (id, x, y) => { this.sticks.set(id, { outX: x, outY: y, active: x !== 0 || y !== 0 }); this.touchActivity(); },
      onTap: () => { this.pulse('tap'); this.touchActivity(); },
    });
    this.syncVirtualVisibility();
    // Tell the zero-config layer to stand down — the game owns input now.
    (window as any).__HUB_INPUT_ACTIVE__ = true;
  }

  private applyBinding(name: string, def: InputDef): InputDef {
    const o = this.overrides.bindings && this.overrides.bindings[name];
    return o ? { ...def, ...o } : { ...def };
  }

  // ---- group control ----

  /** Provide the hub menu bridge (called by the injected menu) for the
   *  zero-config menu toggle/navigation and the Controls launcher. */
  attachMenu(bridge: InputHost['menu']): void { this.host.menu = bridge; }
  setLegacyControls(controls: any): void { this.host.legacyControls = controls; }

  enable(group: string): void { this.groupEnabled.set(group, true); this.syncVirtualVisibility(); this.refreshNav(group); }
  disable(group: string): void {
    this.groupEnabled.set(group, false);
    // zero held inputs in this group
    for (const [name, gi] of this.inputGroup) if (gi === group) { const ri = this.inputs.get(name)!; ri.raw = 0; }
    this.syncVirtualVisibility();
    const ns = this.nav.get(group); if (ns) ns.blur(this.overlay);
  }
  isEnabled(group: string): boolean { return this.groupEnabled.get(group) === true; }
  /** True once the game has declared its inputs via define(). */
  get isDefined(): boolean { return this.defined; }

  // ---- reads ----

  value(name: string): number { const ri = this.inputs.get(name); return ri ? ri.raw : 0; }
  get(name: string): InputReading {
    const ri = this.inputs.get(name);
    if (!ri) return { value: 0, raw: 0, isDown: false, isUp: false };
    return { value: ri.raw, raw: ri.raw, isDown: ri.prev < 0.5 && ri.raw >= 0.5, isUp: ri.prev >= 0.5 && ri.raw < 0.5 };
  }
  down(name: string): boolean { const ri = this.inputs.get(name); return !!ri && ri.prev < 0.5 && ri.raw >= 0.5; }
  up(name: string): boolean { const ri = this.inputs.get(name); return !!ri && ri.prev >= 0.5 && ri.raw < 0.5; }
  pressed(name: string): boolean { return this.value(name) >= 0.5; }

  /** A named axis (or an ad-hoc [neg,pos] pair) as -1..1. */
  axis(name: string, pos?: string): number {
    if (pos !== undefined) return clamp01(this.value(pos)) - clamp01(this.value(name));
    const a = this.axes.get(name);
    if (!a) { const ri = this.inputs.get(name); return ri ? ri.raw : 0; }
    return axisFrom(a.def.x, (n) => this.value(n));
  }
  vector(name: string): Vector {
    const a = this.axes.get(name);
    if (!a) return { x: 0, y: 0, mag: 0 };
    let x = axisFrom(a.def.x, (n) => this.value(n));
    let y = axisFrom(a.def.y, (n) => this.value(n));
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y, mag: Math.min(m, 1) };
  }

  get source(): InputSource { return this.activeSource; }

  // ---- events ----

  on(event: 'focus' | 'blur' | 'act' | 'sourcechange' | 'navigate', cb: (e: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)!.delete(cb);
  }
  private emit(event: string, detail?: any): void {
    const set = this.listeners.get(event);
    if (set) for (const cb of set) { try { cb(detail); } catch { /* ignore */ } }
  }

  // ---- virtual visibility ----

  showVirtual(v: boolean): void { this.showVirtualOverride = v; this.overrides.showVirtual = v; this.persist(); this.syncVirtualVisibility(); }
  toggleVirtual(): void { this.showVirtual(!this.virtualVisible()); }
  private virtualVisible(): boolean {
    if (this.showVirtualOverride != null) return this.showVirtualOverride;
    return this.touchDevice && !this.gamepadActive;
  }
  private syncVirtualVisibility(): void {
    if (!this.overlay) return;
    const vis = this.virtualVisible();
    const enabledGroups = new Set<string>();
    for (const [g, on] of this.groupEnabled) if (on) enabledGroups.add(g);
    this.overlay.setVirtualVisible(vis, enabledGroups);
  }

  // ---- persistence + Controls UI ----

  private persist(): void { try { this.host.saveOverrides(this.overrides); } catch { /* ignore */ } }
  rebind(inputName: string, patch: Partial<InputDef>): void {
    this.overrides.bindings = this.overrides.bindings || {};
    this.overrides.bindings[inputName] = { ...(this.overrides.bindings[inputName] || {}), ...patch };
    const ri = this.inputs.get(inputName);
    if (ri && this.config) {
      const gname = this.inputGroup.get(inputName)!;
      ri.def = this.applyBinding(inputName, this.config.groups[gname].inputs[inputName]);
    }
    this.persist();
  }
  setVirtual(id: string, patch: Partial<VirtualDef> & { x?: number; y?: number }): void {
    this.overrides.virtual = this.overrides.virtual || {};
    this.overrides.virtual[id] = { ...(this.overrides.virtual[id] || {}), ...patch };
    this.persist();
    if (this.overlay && this.config) this.overlay.build(this.config, this.overrides, this.overlay.callbacks);
    this.syncVirtualVisibility();
  }
  openControls(): void { this.ensureOverlay(); this.overlay!.openControls(this.config, this.overrides, this); }
  resetControls(): void { this.overrides = {}; this.showVirtualOverride = null; this.persist(); if (this.config) this.define(this.config); }

  // ---- the frame loop ----

  private start(): void { if (!this.raf) this.raf = requestAnimationFrame(() => this.tick()); }

  private tick(): void {
    this.frame += 1;
    this.pollGamepads();

    const menu = this.host.menu;
    const menuOpen = !!(menu && menu.isOpen());
    // Select/Back (button 8) toggles the hub menu from anywhere (all modes).
    if (menu && this.gpEdge('_selPrev', this.gpAny((gp) => !!(gp.buttons[BTN.SELECT] && gp.buttons[BTN.SELECT].pressed)))) {
      menu.toggle();
    }

    if (menuOpen) {
      // The menu takes over input: zero the game's inputs while it's open, and
      // make the menu itself navigable so controller-only play can use it.
      if (this.defined) for (const [, ri] of this.inputs) { ri.prev = ri.raw; ri.raw = 0; }
      this.processMenuNav(menu!);
    } else {
      if (this.menuNav) { this.menuNav.blur(this.overlay); this.menuNav = null; }
      if (this.defined) {
        for (const [name, ri] of this.inputs) {
          ri.prev = ri.raw;
          const group = this.inputGroup.get(name)!;
          ri.raw = this.groupEnabled.get(group) ? clamp01(this.computeRaw(ri.def)) : 0;
        }
        this.processNavigation();
      } else {
        this.legacyTick();
      }
      // The game's own menus (opt-in via autoNavigate): when any are visible and
      // a gamepad is in use, make them navigable. The game's existing pause gates
      // gameplay, so we don't suppress inputs here.
      if (this.autoNavSel && this.activeSource === 'gamepad' && this.autoNavVisible()) {
        this.processAutoNav();
      } else if (this.autoNavState) {
        this.autoNavState.blur(this.overlay); this.autoNavState = null;
      }
    }

    // decay relative/wheel accumulators each frame
    this.moveDelta.x = 0; this.moveDelta.y = 0;
    this.wheelDelta.x *= 0.6; this.wheelDelta.y *= 0.6;
    if (this.overlay) this.overlay.afterFrame();
    this.raf = requestAnimationFrame(() => this.tick());
  }

  // ---- built-in hub-menu navigation (gamepad-only play) ----

  private gpAny(pred: (gp: Gamepad) => boolean): boolean {
    for (const gp of this.gpCache) { if (gp && pred(gp)) return true; }
    return false;
  }
  private gpEdge(field: string, pressed: boolean): boolean {
    const was = (this as any)[field]; (this as any)[field] = pressed; return pressed && !was;
  }
  private gpUp() { return this.gpAny((gp) => ((gp.axes[1] || 0) < -AXIS_DEADZONE) || !!(gp.buttons[BTN.UP] && gp.buttons[BTN.UP].pressed)); }
  private gpDown() { return this.gpAny((gp) => ((gp.axes[1] || 0) > AXIS_DEADZONE) || !!(gp.buttons[BTN.DOWN] && gp.buttons[BTN.DOWN].pressed)); }
  private gpLeft() { return this.gpAny((gp) => ((gp.axes[0] || 0) < -AXIS_DEADZONE) || !!(gp.buttons[BTN.LEFT] && gp.buttons[BTN.LEFT].pressed)); }
  private gpRight() { return this.gpAny((gp) => ((gp.axes[0] || 0) > AXIS_DEADZONE) || !!(gp.buttons[BTN.RIGHT] && gp.buttons[BTN.RIGHT].pressed)); }
  private menuFocusables(root: ShadowRoot | null): HTMLElement[] {
    if (!root) return [];
    return (Array.from(root.querySelectorAll('a[href], button:not([disabled]), input, [tabindex]')) as HTMLElement[])
      .filter((el) => el.getClientRects().length > 0);
  }
  private processMenuNav(menu: NonNullable<InputHost['menu']>): void {
    // Only drive the menu with the highlight ring when a gamepad is in use;
    // mouse/touch/keyboard users interact with the menu directly.
    if (this.activeSource !== 'gamepad') { if (this.overlay) this.overlay.hideHighlight(); return; }
    this.ensureOverlay();
    if (!this.menuNav) this.menuNav = new NavState({ act: '', elements: () => this.menuFocusables(menu.root) } as unknown as NavigableDef);
    const F = (e: any) => this.emit('focus', e); const B = (e: any) => this.emit('blur', e);
    this.menuNav.requery(this.overlay, F);
    const t = now();
    if (this.navEdge('m:u', this.gpUp(), t)) this.menuNav.moveDir('up', this.overlay, F, B);
    else if (this.navEdge('m:d', this.gpDown(), t)) this.menuNav.moveDir('down', this.overlay, F, B);
    else if (this.navEdge('m:l', this.gpLeft(), t)) this.menuNav.moveDir('left', this.overlay, F, B);
    else if (this.navEdge('m:r', this.gpRight(), t)) this.menuNav.moveDir('right', this.overlay, F, B);
    if (this.gpEdge('_actPrev', this.gpAny((gp) => !!(gp.buttons[0] && gp.buttons[0].pressed)))) this.menuNav.act(this.overlay, (e) => this.emit('act', e));
    if (this.gpEdge('_backPrev', this.gpAny((gp) => !!(gp.buttons[1] && gp.buttons[1].pressed)))) menu.close();
    this.menuNav.position(this.overlay);
  }

  // ---- a game's own menus (opt-in via autoNavigate) ----

  /**
   * Make a game's own on-screen menu gamepad-navigable. Pass a CSS selector (or
   * a function returning elements). While any match is VISIBLE and a gamepad is
   * the active device, the d-pad/stick move a highlight across them and A
   * activates (clicks) the focused one; B calls `opts.back` if given. It
   * re-queries every frame, so it follows menus showing/hiding — call it once.
   * No-op for mouse/touch/keyboard (use those menus natively).
   */
  autoNavigate(selector: string | (() => Array<HTMLElement | NavElement>), opts?: { back?: () => void }): void {
    this.autoNavSel = typeof selector === 'string'
      ? () => (Array.from(document.querySelectorAll(selector)) as HTMLElement[]).filter((e) => e.getClientRects().length > 0)
      : selector;
    this.autoNavBack = (opts && opts.back) || null;
    this.autoNavState = null;
  }
  clearAutoNavigate(): void {
    this.autoNavSel = null;
    if (this.autoNavState) { this.autoNavState.blur(this.overlay); this.autoNavState = null; }
  }
  private autoNavVisible(): boolean { return !!this.autoNavSel && this.autoNavSel().length > 0; }
  private processAutoNav(): void {
    this.ensureOverlay();
    if (!this.autoNavState) this.autoNavState = new NavState({ act: '', elements: this.autoNavSel! } as unknown as NavigableDef);
    const F = (e: any) => this.emit('focus', e); const B = (e: any) => this.emit('blur', e);
    this.autoNavState.requery(this.overlay, F);
    const t = now();
    if (this.navEdge('an:u', this.gpUp(), t)) this.autoNavState.moveDir('up', this.overlay, F, B);
    else if (this.navEdge('an:d', this.gpDown(), t)) this.autoNavState.moveDir('down', this.overlay, F, B);
    else if (this.navEdge('an:l', this.gpLeft(), t)) this.autoNavState.moveDir('left', this.overlay, F, B);
    else if (this.navEdge('an:r', this.gpRight(), t)) this.autoNavState.moveDir('right', this.overlay, F, B);
    if (this.gpEdge('_actPrev', this.gpAny((gp) => !!(gp.buttons[0] && gp.buttons[0].pressed)))) this.autoNavState.act(this.overlay, (e) => this.emit('act', e));
    if (this.gpEdge('_backPrev', this.gpAny((gp) => !!(gp.buttons[1] && gp.buttons[1].pressed))) && this.autoNavBack) this.autoNavBack();
    this.autoNavState.position(this.overlay);
  }

  private computeRaw(def: InputDef): number {
    let v = 0;
    // keyboard — always on
    if (def.keys) for (const k of def.keys) if (this.keys.has(k.toLowerCase())) { v = Math.max(v, 1); break; }
    // mouse — only when mouse is the active pointer
    if (def.mouse && this.activeSource === 'mouse') v = Math.max(v, this.mouseValue(def.mouse));
    // gamepad — only when gamepad is the active pointer
    if (def.gamepad && this.activeSource === 'gamepad') v = Math.max(v, this.gamepadValue(def.gamepad));
    // touch / virtual — always contributes (outputs are 0 when hidden)
    if (def.touch) v = Math.max(v, this.touchValue(def.touch));
    return v;
  }

  private mouseValue(m: MouseMapping): number {
    let v = 0;
    if (m.button != null && this.mouseButtons.has(m.button)) v = Math.max(v, 1);
    if (m.dblclick && this.pulseActive('mouse:dbl')) v = Math.max(v, 1);
    if (m.centerAxis) {
      const c = m.centerAxis === 'x' ? (this.mouseX / window.innerWidth) : (this.mouseY / window.innerHeight);
      const signed = (c - 0.5) * 2; // -1..1
      const side = m.centerSide === '-' ? -signed : signed;
      v = Math.max(v, clamp01(side));
    }
    if (m.moveAxis) {
      const d = m.moveAxis === 'x' ? this.moveDelta.x : this.moveDelta.y;
      const dir = (m.moveSign === '-' ? -d : d) * (m.moveScale || 0.1);
      v = Math.max(v, clamp01(dir));
    }
    if (m.wheel) { const d = m.wheel === '-' ? -this.wheelDelta.y : this.wheelDelta.y; v = Math.max(v, clamp01(d)); }
    return v;
  }

  private gpCache: (Gamepad | null)[] = [];
  private gamepadValue(g: GamepadMapping): number {
    let v = 0;
    for (const gp of this.gpCache) {
      if (!gp) continue;
      if (g.button != null) { const b = gp.buttons[g.button]; if (b) v = Math.max(v, b.value || (b.pressed ? 1 : 0)); }
      if (g.axis) {
        const raw = gp.axes[g.axis[0]] || 0;
        const half = g.axis[1];
        const val = half === '±' ? Math.abs(raw) : half === '+' ? Math.max(0, raw) : Math.max(0, -raw);
        if (Math.abs(raw) > AXIS_DEADZONE) v = Math.max(v, clamp01(val));
      }
    }
    return v;
  }

  private touchValue(t: TouchMapping): number {
    let v = 0;
    if (t.button && this.vbuttons.has(t.button)) v = Math.max(v, 1);
    if (t.tap && this.pulseActive('tap')) v = Math.max(v, 1);
    if (t.stick) {
      const s = this.sticks.get(t.stick);
      if (s) {
        const ax = t.axis;
        let val = 0;
        if (ax === 'x+') val = Math.max(0, s.outX);
        else if (ax === 'x-') val = Math.max(0, -s.outX);
        else if (ax === 'y+') val = Math.max(0, s.outY);
        else if (ax === 'y-') val = Math.max(0, -s.outY);
        else if (ax === 'x') val = Math.abs(s.outX);
        else if (ax === 'y') val = Math.abs(s.outY);
        v = Math.max(v, clamp01(val));
      }
    }
    if (t.centerAxis) {
      // last touch position relative to centre (mouseX/Y is updated by touch too)
      const c = t.centerAxis === 'x' ? (this.mouseX / window.innerWidth) : (this.mouseY / window.innerHeight);
      const signed = (c - 0.5) * 2;
      const side = t.centerSide === '-' ? -signed : signed;
      v = Math.max(v, clamp01(side));
    }
    return v;
  }

  // ---- pulses ----
  private pulse(id: string): void { this.pulses.set(id, this.frame); }
  private pulseActive(id: string): boolean { const f = this.pulses.get(id); return f === this.frame || f === this.frame - 1; }

  // ---- gamepad polling + arbitration ----

  private pollGamepads(): void {
    const list = (navigator.getGamepads && navigator.getGamepads()) || [];
    this.gpCache = Array.from(list);
    let any = false; let activity = false;
    for (const gp of this.gpCache) {
      if (!gp) continue;
      any = true;
      for (const b of gp.buttons) if (b && (b.pressed || b.value > 0.5)) activity = true;
      for (const ax of gp.axes) if (Math.abs(ax) > AXIS_DEADZONE) activity = true;
    }
    this.gamepadActive = any;
    if (activity && this.activeSource !== 'gamepad') this.setSource('gamepad');
  }

  private setSource(s: InputSource): void {
    if (s === this.activeSource) return;
    this.activeSource = s;
    this.emit('sourcechange', s);
    this.syncVirtualVisibility();
  }
  private touchActivity(): void { this.touchUsed = true; this.setSource('touch'); }

  // ---- DOM event wiring ----

  private installGlobalListeners(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (this.defined && this.isGameKey(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('mousemove', (e) => {
      this.moveDelta.x += e.movementX || 0; this.moveDelta.y += e.movementY || 0;
      this.mouseX = e.clientX; this.mouseY = e.clientY; this.mouseMoved = true;
      this.setSource('mouse');
    });
    window.addEventListener('mousedown', (e) => { this.mouseButtons.add(e.button); this.setSource('mouse'); });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    window.addEventListener('dblclick', () => this.pulse('mouse:dbl'));
    window.addEventListener('wheel', (e) => { this.wheelDelta.x += Math.sign(e.deltaX); this.wheelDelta.y += Math.sign(e.deltaY); }, { passive: true });
    // focus loss → clear held state (avoids stuck keys/buttons)
    const clear = () => { this.keys.clear(); this.mouseButtons.clear(); this.vbuttons.clear(); for (const s of this.sticks.values()) { s.outX = 0; s.outY = 0; s.active = false; } };
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    window.addEventListener('gamepadconnected', () => { this.gamepadActive = true; this.syncVirtualVisibility(); });
    window.addEventListener('gamepaddisconnected', () => { this.syncVirtualVisibility(); });
  }
  private isGameKey(k: string): boolean {
    return k === ' ' || k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright';
  }

  private ensureOverlay(): void { if (!this.overlay) this.overlay = new Overlay(); }

  // ---- navigable processing ----

  private refreshNav(group: string): void { const ns = this.nav.get(group); if (ns && this.groupEnabled.get(group)) ns.requery(this.overlay, (e) => this.emit('focus', e)); }

  private processNavigation(): void {
    for (const [group, ns] of this.nav) {
      if (!this.groupEnabled.get(group)) continue;
      const def = ns.def;
      const t = now();
      const stepPrev = def.prev && this.navEdge('np:' + group, this.pressed(def.prev), t);
      const stepNext = def.next && this.navEdge('nn:' + group, this.pressed(def.next), t);
      const up = def.up && this.navEdge('nu:' + group, this.pressed(def.up), t);
      const down = def.down && this.navEdge('nd:' + group, this.pressed(def.down), t);
      const act = def.act && this.down(def.act);
      if (stepNext) ns.move(+1, this.overlay, (e) => this.emit('focus', e), (e) => this.emit('blur', e));
      else if (stepPrev) ns.move(-1, this.overlay, (e) => this.emit('focus', e), (e) => this.emit('blur', e));
      else if (up) ns.moveDir('up', this.overlay, (e) => this.emit('focus', e), (e) => this.emit('blur', e));
      else if (down) ns.moveDir('down', this.overlay, (e) => this.emit('focus', e), (e) => this.emit('blur', e));
      if (act) ns.act(this.overlay, (e) => this.emit('act', e));
      ns.position(this.overlay);
    }
  }
  private navTimers = new Map<string, { prev: boolean; next: number }>();
  private navEdge(key: string, pressed: boolean, t: number): boolean {
    let s = this.navTimers.get(key);
    if (!s) { s = { prev: false, next: 0 }; this.navTimers.set(key, s); }
    if (!pressed) { s.prev = false; return false; }
    if (!s.prev) { s.prev = true; s.next = t + NAV_FIRST_DELAY; return true; }
    if (t >= s.next) { s.next = t + NAV_REPEAT; return true; }
    return false;
  }

  // ---- zero-config fallback (no define) — mirrors the old gamepad.js ----

  private legacyInit = false;
  private legacyTick(): void {
    // Only runs until a game calls define(). Provides catalog/menu navigation
    // and keyboard synthesis from window.__HUB__.controls.
    if ((window as any).__HUB_INPUT_ACTIVE__) return;
    legacyFrame(this);
  }

  // exposed for the legacy module
  _gamepads(): (Gamepad | null)[] { return this.gpCache; }
  _menu() { return this.host.menu; }
  _legacyControls() { return this.host.legacyControls; }
  _navEdge(key: string, pressed: boolean): boolean { return this.navEdge(key, pressed, now()); }
}

// ---------------------------------------------------------------------------
// Axis helper
// ---------------------------------------------------------------------------

function axisFrom(def: string | [string, string] | undefined, val: (n: string) => number): number {
  if (!def) return 0;
  if (Array.isArray(def)) return clamp01(val(def[1])) - clamp01(val(def[0]));
  // single name: treat its 0..1 as 0..1 (already-signed sources are rare); use directly
  return val(def);
}

// ---------------------------------------------------------------------------
// Navigable state
// ---------------------------------------------------------------------------

class NavState {
  def: NavigableDef;
  private list: NavElement[] = [];
  private index = -1;
  constructor(def: NavigableDef) { this.def = def; }

  private resolve(): NavElement[] {
    return (this.def.elements() || []).map((e) =>
      (e instanceof HTMLElement) ? ({ el: e, kind: navKind(e) } as NavElement) : e);
  }
  requery(overlay: Overlay | null, onFocus: (e: any) => void): void {
    this.list = this.resolve();
    if (this.index >= this.list.length) this.index = this.list.length - 1;
    if (this.index < 0 && this.list.length) { this.index = 0; this.focus(overlay, onFocus); }
    this.position(overlay);
  }
  private boundsOf(n: NavElement) {
    if (n.getBounds) return n.getBounds();
    if (n.el) { const r = n.el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  private focus(overlay: Overlay | null, onFocus: (e: any) => void): void {
    const n = this.list[this.index]; if (!n) return;
    if (n.el && n.el.focus) try { n.el.focus({ preventScroll: false } as any); } catch { /* */ }
    if (n.onFocus) n.onFocus();
    onFocus({ id: n.id, el: n.el, kind: n.kind, index: this.index });
  }
  blur(overlay: Overlay | null): void {
    const n = this.list[this.index];
    if (n && n.onBlur) n.onBlur();
    this.index = -1; if (overlay) overlay.hideHighlight();
  }
  move(dir: number, overlay: Overlay | null, onFocus: (e: any) => void, onBlur: (e: any) => void): void {
    this.list = this.resolve();
    if (!this.list.length) return;
    const prev = this.list[this.index]; if (prev && prev.onBlur) prev.onBlur(), onBlur({ id: prev.id, index: this.index });
    const wrap = this.def.wrap !== false;
    let i = this.index + dir;
    if (i < 0) i = wrap ? this.list.length - 1 : 0;
    if (i >= this.list.length) i = wrap ? 0 : this.list.length - 1;
    this.index = i; this.focus(overlay, onFocus); this.position(overlay);
  }
  /** Nearest element strictly in `dir` from `fromIndex`, or -1 if none. */
  private findInDir(fromIndex: number, dir: 'up' | 'down' | 'left' | 'right'): number {
    const from = this.boundsOf(this.list[fromIndex]);
    const cx = from.x + from.width / 2, cy = from.y + from.height / 2;
    let best = -1, bestScore = Infinity;
    this.list.forEach((n, i) => {
      if (i === fromIndex) return;
      const b = this.boundsOf(n); const bx = b.x + b.width / 2, by = b.y + b.height / 2;
      const dx = bx - cx, dy = by - cy;
      const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4;
      if (!ok) return;
      const along = (dir === 'up' || dir === 'down') ? Math.abs(dy) : Math.abs(dx);
      const across = (dir === 'up' || dir === 'down') ? Math.abs(dx) : Math.abs(dy);
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    return best;
  }
  moveDir(dir: 'up' | 'down' | 'left' | 'right', overlay: Overlay | null, onFocus: (e: any) => void, onBlur: (e: any) => void): void {
    this.list = this.resolve();
    if (!this.list.length) return;
    if (this.index < 0) { this.index = 0; this.focus(overlay, onFocus); this.position(overlay); return; }
    let best = this.findInDir(this.index, dir);
    if (best < 0) {
      // Nothing directly that way → spill over so columns never dead-end:
      // up falls through to the previous element (left), down to the next (right).
      const fallback = dir === 'up' ? 'left' : dir === 'down' ? 'right' : null;
      if (fallback) best = this.findInDir(this.index, fallback);
    }
    if (best >= 0) {
      const prev = this.list[this.index]; if (prev && prev.onBlur) prev.onBlur(), onBlur({ id: prev.id, index: this.index });
      this.index = best; this.focus(overlay, onFocus); this.position(overlay);
    }
  }
  act(overlay: Overlay | null, onAct: (e: any) => void): void {
    this.list = this.resolve();
    const n = this.list[this.index]; if (!n) return;
    if (n.kind === 'text') {
      if (overlay) overlay.openKeyboard(n.el as HTMLInputElement | null);
    } else if (n.el && (n.el.tagName === 'A' || n.el.tagName === 'BUTTON' || (n.el as any).click)) {
      (n.el as HTMLElement).click();
    }
    if (n.onAct) n.onAct();
    onAct({ id: n.id, el: n.el, kind: n.kind, index: this.index });
    // elements can change after acting → re-query next frame
    this.list = this.resolve(); this.position(overlay);
  }
  position(overlay: Overlay | null): void {
    if (!overlay) return;
    const n = this.list[this.index];
    if (!n) { overlay.hideHighlight(); return; }
    overlay.showHighlight(this.boundsOf(n));
  }
}

function navKind(el: HTMLElement): NavElement['kind'] {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type;
    if (t === 'range') return 'range';
    if (t === 'text' || t === 'search' || t === 'email' || t === 'password' || t === 'number') return 'text';
  }
  if (tag === 'textarea') return 'text';
  return 'button';
}

// ---------------------------------------------------------------------------
// DOM overlay: virtual controls, highlight ring, on-screen keyboard, Controls UI
// (Implemented in overlay.ts and imported here to keep this file focused.)
// ---------------------------------------------------------------------------

import { Overlay } from './overlay';
import { legacyFrame } from './legacy';
export { Overlay } from './overlay';
