/**
 * The DOM overlay for the input system: virtual touch controls, the navigation
 * highlight ring, the on-screen keyboard, and the Controls (remap/customize)
 * screen. Everything lives in one style-isolated shadow root layered over the
 * game, so it works identically for fully-Pixi and HTML+Pixi games.
 */

import type { InputConfig, InputOverrides, VirtualDef, Anchor } from './input';

interface VCallbacks {
  onVButtonDown: (id: string) => void;
  onVButtonUp: (id: string) => void;
  onStick: (id: string, x: number, y: number) => void;
  onTap: () => void;
}

interface Rect { x: number; y: number; width: number; height: number; }

/** Px insets from each viewport edge. */
export interface Insets { top: number; right: number; bottom: number; left: number; }

const ACCENT = '#ff5f3b';

export class Overlay {
  private host: HTMLDivElement;
  private root: ShadowRoot;
  private controlsLayer!: HTMLDivElement;
  private highlightEl!: HTMLDivElement;
  private kbEl: HTMLDivElement | null = null;
  private panelEl: HTMLDivElement | null = null;
  callbacks: VCallbacks = { onVButtonDown() {}, onVButtonUp() {}, onStick() {}, onTap() {} };

  private controls: Array<{ def: VirtualDef; group: string; el: HTMLElement }> = [];
  private groupVisible = new Set<string>();
  private globalVisible = true;
  private editMode = false;

  // keyboard gamepad-nav state
  private kbTarget: HTMLInputElement | HTMLTextAreaElement | null = null;
  private kbKeys: HTMLElement[] = [];
  private kbIndex = 0;
  private kbShift = false;
  private kbNavTimer = { prev: false, next: 0 };

  constructor() {
    this.host = document.createElement('div');
    this.host.id = 'hub-input-root';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${CSS}</style>
      <div class="layer controls"></div>
      <div class="ring" hidden></div>`;
    this.controlsLayer = this.root.querySelector('.controls') as HTMLDivElement;
    this.highlightEl = this.root.querySelector('.ring') as HTMLDivElement;
    (document.body || document.documentElement).appendChild(this.host);
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 200));
    // Keep top/bottom controls clear of the hub's race HUD while it shows.
    window.addEventListener('hub:race-hud', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const top = d.visible ? Number(d.top) || 0 : 0, bottom = d.visible ? Number(d.bottom) || 0 : 0;
      if (top === this.raceHud.top && bottom === this.raceHud.bottom) return;
      this.raceHud = { top, bottom }; this.layout();
    });
  }

  // ---- virtual controls ----

  build(config: InputConfig, overrides: InputOverrides, cb: VCallbacks): void {
    this.callbacks = cb;
    this.overrides = overrides;
    this.controlsLayer.innerHTML = '';
    this.controls = [];
    for (const [group, g] of Object.entries(config.groups)) {
      for (const def of g.virtual || []) {
        const ov = (overrides.virtual && overrides.virtual[def.id]) || {};
        const merged: VirtualDef = { ...def, ...ov };
        const el = this.makeControl(merged, overrides);
        (el as any).__group = group; (el as any).__id = def.id;
        this.controlsLayer.appendChild(el);
        this.controls.push({ def: merged, group, el });
      }
    }
    this.layout();
  }

  private makeControl(def: VirtualDef, _overrides: InputOverrides): HTMLElement {
    const isStick = def.type === 'joystick' || def.type === 'dpad';
    const base = def.size || (def.type === 'button' ? 72 : 130);
    const w = def.width || base; const h = def.height || base;
    const wrap = document.createElement('div');
    wrap.className = `vc vc-${def.type}`;
    wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
    if (def.opacity != null) wrap.style.opacity = String(def.opacity);
    wrap.style.setProperty('--vc-color', def.color || ACCENT);
    if (def.bg) wrap.style.setProperty('--vc-bg', def.bg);
    if (def.text) wrap.style.color = def.text;
    // Shape → border radius (default: circle for sticks, rounded rect for buttons).
    const shape = def.shape || (isStick ? 'circle' : 'round');
    const radius = shape === 'circle' ? '50%' : shape === 'pill' ? '999px' : shape === 'square' ? '0' : '16px';
    wrap.style.borderRadius = radius;

    if (def.type === 'joystick' || def.type === 'dpad') {
      wrap.innerHTML = '<div class="base"></div><div class="knob"></div>';
      (wrap.querySelector('.base') as HTMLElement).style.borderRadius = radius;
      // Keep the knob a circle sized to the short edge (so a wide pill stick
      // gets a round knob that slides, not a stretched ellipse). Single-axis
      // sticks get a bigger knob that mostly fills the short edge; 2D sticks
      // keep a smaller knob so it has room to travel in both directions.
      const knobEl = wrap.querySelector('.knob') as HTMLElement;
      const single = def.axis === 'x' || def.axis === 'y';
      const kd = Math.round(Math.min(w, h) * (single ? 0.92 : 0.5));
      knobEl.style.width = kd + 'px'; knobEl.style.height = kd + 'px';
      this.bindJoystick(def.id, wrap, def.type === 'dpad', def.axis || 'both');
    } else { // button | tap
      wrap.innerHTML = def.html ? def.html : `<span>${def.label || ''}</span>`;
      if (def.type === 'tap') wrap.classList.add('vc-transparent');
      this.bindButton(def.id, wrap);
    }
    // drag-to-move in edit mode
    this.bindEditDrag(def.id, wrap);
    return wrap;
  }

  private bindButton(id: string, el: HTMLElement): void {
    const down = (e: Event) => { if (this.editMode) return; e.preventDefault(); el.classList.add('pressed'); this.callbacks.onVButtonDown(id); if (el.classList.contains('vc-transparent')) this.callbacks.onTap(); };
    const up = (e: Event) => { e.preventDefault(); el.classList.remove('pressed'); this.callbacks.onVButtonUp(id); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
  }

  private bindJoystick(id: string, wrap: HTMLElement, discrete: boolean, axisMode: 'x' | 'y' | 'both' = 'both'): void {
    const knob = wrap.querySelector('.knob') as HTMLElement;
    let touchId = -1; let cx = 0, cy = 0, maxX = 1, maxY = 1;
    const measure = () => {
      const r = wrap.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      const knobR = (knob.getBoundingClientRect().width / 2) || Math.min(r.width, r.height) * 0.25;
      maxX = Math.max(1, r.width / 2 - knobR);
      maxY = Math.max(1, r.height / 2 - knobR);
    };
    const set = (sx: number, sy: number) => {
      let dx = axisMode === 'y' ? 0 : sx - cx;
      let dy = axisMode === 'x' ? 0 : sy - cy;
      if (axisMode === 'both') {
        const m = Math.min(maxX, maxY); const d = Math.hypot(dx, dy);
        if (d > m) { dx = dx * m / d; dy = dy * m / d; }
      } else {
        dx = dx > maxX ? maxX : dx < -maxX ? -maxX : dx;
        dy = dy > maxY ? maxY : dy < -maxY ? -maxY : dy;
      }
      let ox = maxX ? dx / maxX : 0, oy = maxY ? dy / maxY : 0;
      if (discrete) { ox = Math.abs(ox) > 0.4 ? Math.sign(ox) : 0; oy = Math.abs(oy) > 0.4 ? Math.sign(oy) : 0; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.callbacks.onStick(id, ox, oy);
    };
    const end = () => { touchId = -1; knob.style.transform = 'translate(0,0)'; this.callbacks.onStick(id, 0, 0); };
    wrap.addEventListener('touchstart', (e: TouchEvent) => {
      if (this.editMode) return; e.preventDefault(); measure();
      const t = e.changedTouches[0]; touchId = t.identifier; set(t.clientX, t.clientY);
    }, { passive: false });
    wrap.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) { const t = e.changedTouches[i]; if (t.identifier === touchId) set(t.clientX, t.clientY); }
    }, { passive: false });
    wrap.addEventListener('touchend', end, { passive: false });
    wrap.addEventListener('touchcancel', end, { passive: false });
    // mouse drag (desktop testing)
    let mdown = false;
    wrap.addEventListener('mousedown', (e) => { if (this.editMode) return; measure(); mdown = true; set(e.clientX, e.clientY); });
    window.addEventListener('mousemove', (e) => { if (mdown) set(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (mdown) { mdown = false; end(); } });
  }

  /** Replace a button/tap control's inner content at runtime (e.g. an SVG that
   *  reflects game state). Listeners live on the wrapper, so they survive. */
  setControlHtml(id: string, html: string): void {
    const c = this.controls.find((x) => (x.el as any).__id === id);
    if (c && (c.def.type === 'button' || c.def.type === 'tap')) c.el.innerHTML = html;
  }

  setVirtualVisible(globalVis: boolean, enabledGroups: Set<string> | null): void {
    this.globalVisible = globalVis; this.groupVisible = enabledGroups || new Set();
    const allGroups = !enabledGroups;   // null → show controls of every group (editing)
    for (const c of this.controls) {
      const show = globalVis && (allGroups || enabledGroups!.has(c.group));
      c.el.style.display = show ? '' : 'none';
    }
  }

  /** Game-set insets (px) that auto-placed controls keep clear of, e.g. a top
   *  HUD bar. See `hub.input.setInsets`. */
  setInsets(ins: Partial<Insets>): void {
    this.gameInsets = { ...this.gameInsets, ...ins };
    this.layout();
  }

  /** Re-place every control for the current viewport. Player overrides (the
   *  last ones passed to build) are kept and re-clamped on-screen, so a resize
   *  or rotation never snaps a customized layout back to the defaults. */
  layout(): void {
    if (typeof window === 'undefined' || !this.controls.length) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const safe = this.readSafeArea();
    const gi = this.gameInsets;
    const rh = this.raceHud;
    const insets: Insets = {
      top: (gi.top || 0) + rh.top, right: gi.right || 0,
      bottom: (gi.bottom || 0) + rh.bottom, left: gi.left || 0,
    };
    const items: LayoutItem[] = this.controls.map((c) => {
      const id = (c.el as any).__id as string;
      const ov = this.overrides.virtual && this.overrides.virtual[id];
      const { w, h } = controlSize(c.def);
      return {
        id, type: c.def.type, place: c.def.place || 'bottom-left', w, h,
        pos: c.def.pos, offset: c.def.offset,
        override: ov && ov.x != null && ov.y != null ? { x: ov.x, y: ov.y } : undefined,
      };
    });
    const boxes = layoutControls(items, vw, vh, { insets, safe });
    for (const c of this.controls) {
      const b = boxes[(c.el as any).__id]; if (!b) continue;
      clearPos(c.el); c.el.style.left = b.x + 'px'; c.el.style.top = b.y + 'px';
    }
  }

  private gameInsets: Partial<Insets> = {};
  private raceHud = { top: 0, bottom: 0 };
  private overrides: InputOverrides = {};
  private safeProbe: HTMLDivElement | null = null;

  /** The device safe-area insets (notch, home bar), via a probe element. */
  private readSafeArea(): Insets {
    try {
      if (!this.safeProbe) {
        const p = document.createElement('div'); p.className = 'safe-probe';
        this.root.appendChild(p); this.safeProbe = p;
      }
      const cs = getComputedStyle(this.safeProbe);
      return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
        bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    } catch { return { top: 0, right: 0, bottom: 0, left: 0 }; }
  }

  // ---- highlight ring ----

  showHighlight(b: Rect): void {
    const el = this.highlightEl;
    el.hidden = false;
    el.style.left = b.x + 'px'; el.style.top = b.y + 'px';
    el.style.width = b.width + 'px'; el.style.height = b.height + 'px';
  }
  hideHighlight(): void { this.highlightEl.hidden = true; }

  // ---- on-screen keyboard ----

  openKeyboard(target: HTMLInputElement | HTMLTextAreaElement | null): void {
    this.closeKeyboard();
    this.kbTarget = target;
    this.kbShift = false; this.kbIndex = 0;
    const el = document.createElement('div');
    el.className = 'kb';
    const rows = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    const mk = (label: string, key: string, cls = '') => `<button class="k ${cls}" data-k="${key}">${label}</button>`;
    let html = '<div class="kb-rows">';
    for (const r of rows) html += '<div class="kb-row">' + [...r].map((ch) => mk(ch, ch)).join('') + '</div>';
    html += '<div class="kb-row">'
      + mk('⇧', 'shift', 'wide') + mk('space', ' ', 'space') + mk('⌫', 'back', 'wide')
      + mk('↵', 'enter', 'wide') + mk('✕', 'close', 'wide') + '</div></div>';
    el.innerHTML = html;
    this.root.appendChild(el);
    this.kbEl = el;
    this.kbKeys = Array.from(el.querySelectorAll('.k')) as HTMLElement[];
    el.querySelectorAll('.k').forEach((k) => {
      k.addEventListener('mousedown', (e) => { e.preventDefault(); this.kbPress((k as HTMLElement).dataset.k!); });
      k.addEventListener('touchstart', (e) => { e.preventDefault(); this.kbPress((k as HTMLElement).dataset.k!); }, { passive: false });
    });
    this.kbHighlight();
  }
  closeKeyboard(): void { if (this.kbEl) { this.kbEl.remove(); this.kbEl = null; this.kbTarget = null; this.kbKeys = []; } }
  private kbPress(key: string): void {
    const t = this.kbTarget;
    if (key === 'close') { this.closeKeyboard(); return; }
    if (key === 'enter') { this.closeKeyboard(); return; }
    if (key === 'shift') { this.kbShift = !this.kbShift; return; }
    if (!t) return;
    if (key === 'back') { t.value = t.value.slice(0, -1); }
    else { t.value += this.kbShift ? key.toUpperCase() : key; }
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }
  private kbHighlight(): void {
    this.kbKeys.forEach((k, i) => k.classList.toggle('kfocus', i === this.kbIndex));
  }
  /** Called each frame while open; drives gamepad navigation of the keyboard. */
  private kbGamepad(): void {
    if (!this.kbEl) return;
    const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
    let lx = 0, ly = 0, act = false, close = false;
    for (const gp of pads) { if (!gp) continue;
      lx += gp.axes[0] || 0; ly += gp.axes[1] || 0;
      if (gp.buttons[14]?.pressed) lx -= 1; if (gp.buttons[15]?.pressed) lx += 1;
      if (gp.buttons[12]?.pressed) ly -= 1; if (gp.buttons[13]?.pressed) ly += 1;
      if (gp.buttons[0]?.pressed) act = true;
      if (gp.buttons[1]?.pressed || gp.buttons[9]?.pressed) close = true;
    }
    const t = performance.now();
    const dir = Math.abs(lx) > 0.5 || Math.abs(ly) > 0.5;
    if (dir) {
      if (!this.kbNavTimer.prev || t >= this.kbNavTimer.next) {
        this.kbNavTimer.prev = true; this.kbNavTimer.next = t + (this.kbNavTimer.prev ? 140 : 320);
        this.kbMoveNearest(lx, ly);
      }
    } else this.kbNavTimer.prev = false;
    if (act && !this._kbActPrev) this.kbPress(this.kbKeys[this.kbIndex].dataset.k!);
    this._kbActPrev = act;
    if (close && !this._kbClosePrev) this.closeKeyboard();
    this._kbClosePrev = close;
  }
  private _kbActPrev = false; private _kbClosePrev = false;
  private kbMoveNearest(dx: number, dy: number): void {
    const cur = this.kbKeys[this.kbIndex].getBoundingClientRect();
    const cx = cur.left + cur.width / 2, cy = cur.top + cur.height / 2;
    const horiz = Math.abs(dx) > Math.abs(dy); const sgn = horiz ? Math.sign(dx) : Math.sign(dy);
    let best = -1, bestScore = Infinity;
    this.kbKeys.forEach((k, i) => {
      if (i === this.kbIndex) return;
      const r = k.getBoundingClientRect(); const bx = r.left + r.width / 2, by = r.top + r.height / 2;
      const ddx = bx - cx, ddy = by - cy;
      const ok = horiz ? Math.sign(ddx) === sgn && Math.abs(ddx) > 4 : Math.sign(ddy) === sgn && Math.abs(ddy) > 4;
      if (!ok) return;
      const along = horiz ? Math.abs(ddx) : Math.abs(ddy); const across = horiz ? Math.abs(ddy) : Math.abs(ddx);
      const s = along + across * 2; if (s < bestScore) { bestScore = s; best = i; }
    });
    if (best >= 0) { this.kbIndex = best; this.kbHighlight(); }
  }

  // ---- per-frame ----
  afterFrame(): void { if (this.kbEl) this.kbGamepad(); }
  get keyboardOpen(): boolean { return !!this.kbEl; }

  // ---- Controls (remap / customize) UI ----

  openControls(config: InputConfig | null, overrides: InputOverrides, sys: any): void {
    if (!config) return;
    if (this.panelEl) { this.closeControls(); return; }
    const p = document.createElement('div'); p.className = 'panel';
    let rows = '';
    for (const [group, g] of Object.entries(config.groups)) {
      rows += `<h4>${esc(group)}</h4>`;
      for (const name of Object.keys(g.inputs)) {
        rows += `<div class="cr"><span>${esc(name)}</span><b class="bind" data-i="${esc(name)}">${esc(bindingLabel(sys, name))}</b><button class="rb" data-i="${esc(name)}">Rebind</button></div>`;
      }
    }
    p.innerHTML = `
      <div class="panel-card">
        <h3>Controls</h3>
        <label class="chk"><input type="checkbox" class="showv"> Show on-screen controls</label>
        <button class="btn editlayout">Edit touch layout</button>
        <div class="crs">${rows}</div>
        <div class="panel-actions">
          <button class="btn reset">Reset to defaults</button>
          <button class="btn done">Done</button>
        </div>
        <p class="hint"></p>
        <div class="edit-bar"><span>Drag a control to move it</span><button class="btn editdone">Done</button></div>
      </div>`;
    this.root.appendChild(p); this.panelEl = p;
    const showv = p.querySelector('.showv') as HTMLInputElement;
    showv.checked = !!sys.showingVirtual;
    showv.addEventListener('change', () => { sys.showVirtual(showv.checked); });
    p.querySelector('.editlayout')!.addEventListener('click', () => { this.setEditMode(!this.editMode, sys); });
    p.querySelector('.reset')!.addEventListener('click', () => { sys.resetControls(); this.closeControls(); });
    p.querySelector('.done')!.addEventListener('click', () => { this.setEditMode(false, sys); this.closeControls(); });
    p.querySelector('.editdone')!.addEventListener('click', () => { this.setEditMode(false, sys); });
    p.querySelectorAll('.rb').forEach((b) => b.addEventListener('click', () => this.captureRebind((b as HTMLElement).dataset.i!, sys, p)));
  }
  private closeControls(): void { if (this.panelEl) { this.panelEl.remove(); this.panelEl = null; } }

  private captureRebind(name: string, sys: any, panel: HTMLElement): void {
    const hint = panel.querySelector('.hint') as HTMLElement;
    hint.textContent = `Press a key or gamepad button for "${name}"…`;
    const finish = (patch: any, label: string) => {
      sys.rebind(name, patch);
      const b = panel.querySelector(`.bind[data-i="${cssEsc(name)}"]`); if (b) b.textContent = label;
      hint.textContent = ''; cleanup();
    };
    const onKey = (e: KeyboardEvent) => { e.preventDefault(); finish({ keys: [e.key] }, e.key); };
    let raf = 0; const t0 = performance.now();
    const pollPad = () => {
      const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
      for (const gp of pads) { if (!gp) continue; for (let i = 0; i < gp.buttons.length; i++) if (gp.buttons[i].pressed) { finish({ gamepad: { button: i } }, `Pad ${i}`); return; } }
      if (performance.now() - t0 > 8000) { hint.textContent = ''; cleanup(); return; }
      raf = requestAnimationFrame(pollPad);
    };
    const cleanup = () => { window.removeEventListener('keydown', onKey, true); if (raf) cancelAnimationFrame(raf); };
    window.addEventListener('keydown', onKey, true);
    raf = requestAnimationFrame(pollPad);
  }

  private setEditMode(on: boolean, sys: any): void {
    this.editMode = on;
    this.host.classList.toggle('editing', on);
    // Force the controls visible for editing without touching the player's
    // show/hide preference (so the "Show on-screen controls" toggle stays in
    // sync). On exit, visibility reverts to that preference.
    sys.setVirtualEditing(on);
  }
  private bindEditDrag(id: string, el: HTMLElement): void {
    // The control keeps its grab point under the finger and stays fully
    // on-screen; the saved spot is its top-left corner as % of the viewport.
    let dragging = false; let gx = 0, gy = 0;
    const start = (px: number, py: number) => {
      if (!this.editMode) return; dragging = true;
      const r = el.getBoundingClientRect(); gx = px - r.left; gy = py - r.top;
      (el as any).__pos = null;
    };
    const move = (px: number, py: number) => {
      if (!dragging) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const x = Math.max(0, Math.min(vw - el.offsetWidth, px - gx));
      const y = Math.max(0, Math.min(vh - el.offsetHeight, py - gy));
      clearPos(el); el.style.left = x + 'px'; el.style.top = y + 'px';
      (el as any).__pos = { x: (x / vw) * 100, y: (y / vh) * 100 };
    };
    el.addEventListener('mousedown', (e) => start(e.clientX, e.clientY));
    el.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; start(t.clientX, t.clientY); }, { passive: true });
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    window.addEventListener('touchmove', (e) => { if (!dragging) return; const t = e.changedTouches[0]; move(t.clientX, t.clientY); });
    const end = () => {
      if (!dragging) return; dragging = false;
      const pos = (el as any).__pos; if (pos && (window as any).__HUB_INPUT__) (window as any).__HUB_INPUT__.setVirtual(id, { x: pos.x, y: pos.y });
    };
    window.addEventListener('mouseup', end); window.addEventListener('touchend', end);
  }
}

// ---- auto layout (pure: no DOM, unit-tested in test/unit/client-input-layout.test.mjs) ----

/** One control as the layout engine sees it (its rendered px size). */
export interface LayoutItem {
  id: string;
  type: VirtualDef['type'];
  place: Anchor;
  w: number;
  h: number;
  pos?: VirtualDef['pos'];
  offset?: VirtualDef['offset'];
  /** The player's dragged spot: the control's top-left corner as % of the viewport. */
  override?: { x: number; y: number };
}

/** A placed control: top-left corner + size, in viewport px. */
export interface LayoutBox { x: number; y: number; w: number; h: number; }

export interface LayoutOptions {
  /** Game insets (a HUD bar…): auto-placed controls keep clear of them. */
  insets?: Partial<Insets>;
  /** Device safe area (notch, home bar): every control stays inside it. */
  safe?: Partial<Insets>;
  /** Distance from the edges for auto-placed controls (default 22). */
  margin?: number;
  /** Space between auto-placed controls (default 14). */
  gap?: number;
}

/** The rendered size of a control: buttons and taps draw a 2px border outside
 *  their declared size; sticks draw theirs inside. */
export function controlSize(def: Pick<VirtualDef, 'type' | 'size' | 'width' | 'height'>): { w: number; h: number } {
  const base = def.size || (def.type === 'button' ? 72 : 130);
  const border = isStickType(def.type) ? 0 : 4;
  return { w: (def.width || base) + border, h: (def.height || base) + border };
}

function isStickType(t: VirtualDef['type']): boolean { return t === 'joystick' || t === 'dpad'; }

interface Sides { h: 'left' | 'right' | 'mid'; v: 'top' | 'bottom' | 'mid'; }
function anchorSides(a: Anchor): Sides {
  return {
    h: a.endsWith('left') ? 'left' : a.endsWith('right') ? 'right' : 'mid',
    v: a.startsWith('top') ? 'top' : a.startsWith('bottom') ? 'bottom' : 'mid',
  };
}

/** Do two boxes overlap (or come closer than `pad` px)? */
export function boxesTouch(a: LayoutBox, b: LayoutBox, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function clampN(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

/**
 * Place every control for a `vw`×`vh` viewport. Returns each control's box.
 *
 * 1. A game `pos` is honoured as given. A player-dragged control keeps its
 *    spot (as % of the viewport, re-clamped on-screen inside the safe area),
 *    nudged to the nearest free spot if it would land on (or within `gap` of)
 *    a stick's full box.
 * 2. Sticks sit in their anchor's corner, side by side inward.
 * 3. Buttons cluster *beside* their corner's sticks, stacked in columns (the
 *    classic layout). If any cluster doesn't fit (it would leave the safe area
 *    or touch another control, e.g. two sticks + buttons on a narrow portrait
 *    phone), every corner cluster that has sticks moves into rows *above*
 *    (below, for top corners) its sticks instead, first-declared button
 *    innermost. Any button that still collides moves to the nearest free spot.
 *
 * Auto-placed controls never overlap each other or a fixed control when there
 * is room for them, and always stay inside the safe area minus the game insets.
 */
export function layoutControls(items: LayoutItem[], vw: number, vh: number, opts: LayoutOptions = {}): Record<string, LayoutBox> {
  const m = opts.margin ?? 22, gap = opts.gap ?? 14, pad = 6;
  const sa: Insets = { top: 0, right: 0, bottom: 0, left: 0, ...opts.safe };
  const gi: Insets = { top: 0, right: 0, bottom: 0, left: 0, ...opts.insets };
  // Auto-placed controls live inside [L,R]×[T,B].
  const L = sa.left + gi.left + m, T = sa.top + gi.top + m;
  const R = vw - sa.right - gi.right - m, B = vh - sa.bottom - gi.bottom - m;
  const out: Record<string, LayoutBox> = {};
  // Obstacles (tap regions don't count). A stick's whole box is its touch
  // area, so everything keeps a full `gap` from it (a thumb on the rim must not
  // catch a button); other controls just must not touch (`pad`).
  const placed: LayoutBox[] = [];
  const stickBoxes = new Set<LayoutBox>();
  const commit = (it: LayoutItem, b: LayoutBox) => {
    out[it.id] = b; if (it.type === 'tap') return;
    placed.push(b); if (isStickType(it.type)) stickBoxes.add(b);
  };
  const inside = (b: LayoutBox) => b.x >= L - 0.5 && b.y >= T - 0.5 && b.x + b.w <= R + 0.5 && b.y + b.h <= B + 0.5;
  const free = (b: LayoutBox, others: LayoutBox[] = placed) =>
    !others.some((p) => boxesTouch(b, p, stickBoxes.has(p) ? gap : pad));
  const off = (it: LayoutItem) => ({ x: (it.offset && it.offset.x) || 0, y: (it.offset && it.offset.y) || 0 });

  // 1. Fixed spots. Player-dragged ones wait until the sticks are down (below).
  const auto: LayoutItem[] = [];
  const dragged: Array<{ it: LayoutItem; want: LayoutBox }> = [];
  for (const it of items) {
    const { w, h } = it;
    if (it.override) {
      dragged.push({ it, want: {
        x: clampN((it.override.x / 100) * vw, sa.left, vw - sa.right - w),
        y: clampN((it.override.y / 100) * vh, sa.top, vh - sa.bottom - h), w, h,
      } });
    } else if (it.pos) {
      const p = it.pos, s = anchorSides(it.place);
      const x = p.left != null ? p.left : p.right != null ? vw - p.right - w
        : s.h === 'left' ? L : s.h === 'right' ? R - w : (vw - w) / 2;
      const y = p.top != null ? p.top : p.bottom != null ? vh - p.bottom - h
        : s.v === 'top' ? T : s.v === 'bottom' ? B - h : (vh - h) / 2;
      commit(it, { x: clampN(x, 0, vw - w), y: clampN(y, 0, vh - h), w, h });
    } else auto.push(it);
  }

  const anchors = new Map<Anchor, LayoutItem[]>();
  for (const it of auto) {
    const a = it.place || 'bottom-left';
    if (!anchors.has(a)) anchors.set(a, []);
    anchors.get(a)!.push(it);
  }

  // 2. Sticks in their corner, side by side inward.
  const sticksOf = new Map<Anchor, { span: LayoutBox | null; reserve: number }>();
  for (const [a, list] of anchors) {
    const s = anchorSides(a);
    let reserve = 0; let span: LayoutBox | null = null;
    for (const it of list) {
      if (!isStickType(it.type)) continue;
      const o = off(it);
      const x = s.h === 'left' ? L + reserve + o.x : s.h === 'right' ? R - reserve - it.w - o.x : (vw - it.w) / 2 + o.x;
      const y = s.v === 'top' ? T + o.y : s.v === 'bottom' ? B - it.h - o.y : (vh - it.h) / 2 + o.y;
      const b = { x, y, w: it.w, h: it.h };
      commit(it, b);
      span = span ? unionBox(span, b) : { ...b };
      reserve += it.w + gap;
    }
    sticksOf.set(a, { span, reserve });
  }
  // A dragged control keeps its spot unless that now lands on a stick or
  // another fixed control (e.g. after a rotation): then it moves to the
  // nearest free spot on-screen.
  for (const { it, want } of dragged) {
    if (it.type === 'tap' || free(want)) { commit(it, want); continue; }
    commit(it, nearestFree(want, sa.left, sa.top, vw - sa.right, vh - sa.bottom, (b) => free(b)) || want);
  }

  // 3a. The classic cluster for every anchor's buttons.
  const primary = new Map<string, LayoutBox>();
  for (const [a, list] of anchors) {
    const btns = list.filter((it) => !isStickType(it.type));
    if (btns.length) clusterBeside(btns, anchorSides(a), sticksOf.get(a)!, primary);
  }
  // Does every cluster fit? (inside the safe area, clear of sticks, fixed
  // controls and the other buttons)
  const primBoxes = auto.filter((it) => !isStickType(it.type) && it.type !== 'tap').map((it) => primary.get(it.id)!);
  const compact = auto.some((it) => {
    if (isStickType(it.type) || it.type === 'tap') return false;
    const b = primary.get(it.id)!;
    return !inside(b) || !free(b) || !free(b, primBoxes.filter((p) => p !== b));
  });

  // 3b. Commit: classic spots, or rows over the sticks in compact mode. Taps
  // keep their spot (they're invisible hit regions, meant to overlap).
  const lost: Array<{ it: LayoutItem; want: LayoutBox }> = [];
  for (const [a, list] of anchors) {
    const btns = list.filter((it) => !isStickType(it.type));
    if (!btns.length) continue;
    const s = anchorSides(a), st = sticksOf.get(a)!;
    const rows = compact && st.span && s.h !== 'mid' && s.v !== 'mid'
      ? rowsBeyondSticks(btns.filter((it) => it.type !== 'tap'), s, st.span) : null;
    for (const it of btns) {
      const want = (rows && rows.get(it.id)) || primary.get(it.id)!;
      if (it.type === 'tap' || (inside(want) && free(want))) commit(it, want);
      else lost.push({ it, want });
    }
  }
  // 3c. Anything still colliding goes to the nearest free spot.
  for (const { it, want } of lost) commit(it, nearestFree(want, L, T, R, B, (b) => free(b)) || clampBox(want, L, T, R, B));
  return out;

  /** Columns beside the corner's sticks (or a centred row for top/bottom). */
  function clusterBeside(btns: LayoutItem[], s: Sides, st: { span: LayoutBox | null; reserve: number }, into: Map<string, LayoutBox>): void {
    const availH = B - T, availW = R - L;
    if (s.h === 'mid') {
      // Centred rows along the edge (past a stick sharing the anchor).
      const rows: LayoutItem[][] = []; let cur: LayoutItem[] = [], curW = 0;
      for (const it of btns) {
        const w = cur.length ? curW + gap + it.w : it.w;
        if (cur.length && w > availW) { rows.push(cur); cur = [it]; curW = it.w; } else { cur.push(it); curW = w; }
      }
      if (cur.length) rows.push(cur);
      const rowH = rows.map((r) => Math.max(...r.map((it) => it.h)));
      const totalH = rowH.reduce((n, h) => n + h, 0) + gap * (rows.length - 1);
      let along = st.span ? st.span.h + gap : 0;
      rows.forEach((row, i) => {
        const rowW = row.reduce((n, it) => n + it.w, 0) + gap * (row.length - 1);
        let x = (vw - rowW) / 2;
        for (const it of row) {
          const o = off(it);
          const cy = s.v === 'top' ? T + along + rowH[i] / 2 + o.y : s.v === 'bottom' ? B - along - rowH[i] / 2 - o.y
            : (vh - totalH) / 2 + along + rowH[i] / 2 + o.y;
          into.set(it.id, { x: x + o.x, y: cy - it.h / 2, w: it.w, h: it.h });
          x += it.w + gap;
        }
        along += rowH[i] + gap;
      });
      return;
    }
    // Columns inset past any stick, stacked along the vertical edge with
    // cumulative real heights; a new inward column after 3 or when too tall.
    let col = st.span ? st.reserve : 0, along = 0, colW = 0, count = 0, colIdx = 0;
    const cells: Array<{ it: LayoutItem; col: number; along: number; colIdx: number }> = [];
    const colH: number[] = [];
    for (const it of btns) {
      if (count > 0 && (count >= 3 || along + it.h > availH)) { col += colW + gap; along = 0; colW = 0; count = 0; colIdx += 1; }
      cells.push({ it, col, along, colIdx });
      colH[colIdx] = along + it.h;
      along += it.h + gap; colW = Math.max(colW, it.w); count += 1;
    }
    for (const c of cells) {
      const { it } = c, o = off(it);
      const x = s.h === 'left' ? L + c.col + o.x : R - c.col - it.w - o.x;
      const y = s.v === 'top' ? T + c.along + o.y : s.v === 'bottom' ? B - c.along - it.h - o.y
        : (vh - colH[c.colIdx]) / 2 + c.along + o.y;
      into.set(it.id, { x, y, w: it.w, h: it.h });
    }
  }

  /** Rows just past the corner's sticks (above them for bottom corners),
   *  first-declared button innermost, each row at most half the screen wide. */
  function rowsBeyondSticks(btns: LayoutItem[], s: Sides, span: LayoutBox): Map<string, LayoutBox> {
    const res = new Map<string, LayoutBox>();
    const maxW = s.h === 'left' ? vw / 2 - gap / 2 - L : R - (vw / 2 + gap / 2);
    const rows: LayoutItem[][] = []; let cur: LayoutItem[] = [], curW = 0;
    for (const it of btns) {
      const w = cur.length ? curW + gap + it.w : it.w;
      if (cur.length && w > maxW) { rows.push(cur); cur = [it]; curW = it.w; } else { cur.push(it); curW = w; }
    }
    if (cur.length) rows.push(cur);
    let along = 0;
    for (const row of rows) {
      const rowW = row.reduce((n, it) => n + it.w, 0) + gap * (row.length - 1);
      const rowH = Math.max(...row.map((it) => it.h));
      // Flush with the sticks' inner edge when the row fits over them, else
      // from the outer edge inward.
      let x = s.h === 'left'
        ? (rowW <= span.w ? span.x + span.w - rowW : L)
        : (rowW <= span.w ? span.x : R - rowW);
      const ordered = s.h === 'left' ? [...row].reverse() : row;   // innermost = first declared
      for (const it of ordered) {
        const o = off(it);
        const cy = s.v === 'bottom' ? span.y - gap - along - rowH / 2 - o.y : span.y + span.h + gap + along + rowH / 2 + o.y;
        res.set(it.id, { x: x + (s.h === 'left' ? o.x : -o.x), y: cy - it.h / 2, w: it.w, h: it.h });
        x += it.w + gap;
      }
      along += rowH + gap;
    }
    return res;
  }
}

function unionBox(a: LayoutBox, b: LayoutBox): LayoutBox {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
function clampBox(b: LayoutBox, L: number, T: number, R: number, B: number): LayoutBox {
  return { ...b, x: clampN(b.x, L, R - b.w), y: clampN(b.y, T, B - b.h) };
}
/** The free spot (inside [L,R]×[T,B]) closest to `want`, on a 4px grid. */
function nearestFree(want: LayoutBox, L: number, T: number, R: number, B: number, ok: (b: LayoutBox) => boolean): LayoutBox | null {
  let best: LayoutBox | null = null, bestD = Infinity;
  const step = 4;
  for (let y = T; y <= B - want.h + 0.01; y += step) {
    for (let x = L; x <= R - want.w + 0.01; x += step) {
      const d = (x - want.x) ** 2 + (y - want.y) ** 2;
      if (d >= bestD) continue;
      const b = { x, y, w: want.w, h: want.h };
      if (ok(b)) { best = b; bestD = d; }
    }
  }
  return best;
}

function bindingLabel(sys: any, name: string): string {
  const ri = sys['inputs']?.get?.(name); const def = ri?.def || {};
  const parts: string[] = [];
  if (def.keys && def.keys.length) parts.push(def.keys.join('/'));
  if (def.gamepad && def.gamepad.button != null) parts.push('Pad ' + def.gamepad.button);
  if (def.gamepad && def.gamepad.axis) parts.push('Axis ' + def.gamepad.axis[0] + def.gamepad.axis[1]);
  return parts.join(' · ') || '—';
}
function clearPos(el: HTMLElement): void {
  el.style.left = el.style.right = el.style.top = el.style.bottom = ''; el.style.transform = '';
}
function esc(s: string): string { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]); }
function cssEsc(s: string): string { return s.replace(/["\\]/g, '\\$&'); }

const CSS = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font-family: 'Space Mono', ui-monospace, monospace; }
.vc { position: fixed; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none;
      display: grid; place-items: center; color: #fff; }
.vc-button, .vc-tap { background: var(--vc-bg, rgba(20,22,30,.55)); border: 2px solid var(--vc-color);
      font: 700 15px/1 monospace; box-shadow: 0 2px 10px rgba(0,0,0,.4); }
.vc-button.pressed, .vc-tap.pressed { background: var(--vc-color); color: #0d0f14; }
.vc-transparent { background: transparent; border-color: transparent; }
.vc-joystick .base, .vc-dpad .base { position: absolute; inset: 0; background: var(--vc-bg, rgba(20,22,30,.4)); border: 2px solid var(--vc-color); }
.vc-joystick .knob, .vc-dpad .knob { position: absolute; width: 44%; height: 44%; border-radius: 50%; background: var(--vc-color); opacity: .9; }
:host(.editing) .vc { outline: 2px dashed #38d6ff; cursor: move; }
/* While editing the layout the panel shrinks to a small bar at the top so the
   controls underneath can be dragged. */
.edit-bar { display: none; }
:host(.editing) .panel { background: transparent; pointer-events: none; place-items: start center; }
:host(.editing) .panel-card { pointer-events: auto; width: auto; margin-top: max(10px, env(safe-area-inset-top, 0px)); padding: 8px 10px; }
:host(.editing) .panel-card > :not(.edit-bar) { display: none; }
:host(.editing) .edit-bar { display: flex; align-items: center; gap: 10px; font-size: 13px; }
:host(.editing) .edit-bar .btn { margin: 0; }
.safe-probe { position: fixed; left: 0; top: 0; width: 0; height: 0; visibility: hidden; pointer-events: none;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
.ring { position: fixed; pointer-events: none; z-index: 2147483200; border: 3px solid ${ACCENT}; border-radius: 8px;
        box-shadow: 0 0 0 2px rgba(0,0,0,.4); transition: left .08s, top .08s, width .08s, height .08s; }
.ring[hidden] { display: none; }
.kb { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483400; background: #0d0f14ee; padding: 10px;
      pointer-events: auto; border-top: 1px solid #2a3142; }
.kb-rows { display: flex; flex-direction: column; gap: 6px; max-width: 760px; margin: 0 auto; }
.kb-row { display: flex; gap: 6px; justify-content: center; }
.kb .k { flex: 1; min-width: 0; max-width: 64px; height: 46px; border-radius: 8px; border: 1px solid #2a3142;
         background: #11141c; color: #e8e6df; font: 16px monospace; cursor: pointer; }
.kb .k.space { max-width: 280px; } .kb .k.wide { max-width: 90px; }
.kb .k.kfocus { border-color: ${ACCENT}; box-shadow: 0 0 0 2px ${ACCENT}; }
.panel { position: fixed; inset: 0; z-index: 2147483500; display: grid; place-items: center; background: rgba(0,0,0,.6); pointer-events: auto;
         font-family: 'Space Mono', ui-monospace, monospace; }
.panel-card { background: #0d0f14; color: #e8e6df; border: 1px solid #2a3142; border-radius: 12px; padding: 18px;
         width: min(420px, 92vw); max-height: 86vh; overflow: auto; box-shadow: 0 12px 44px rgba(0,0,0,.6); }
.panel-card h3 { margin: 0 0 12px; } .panel-card h4 { margin: 14px 0 6px; color: #6f7787; text-transform: uppercase; font-size: 11px; letter-spacing: .08em; }
.cr { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 0; border-bottom: 1px solid #1a1f2b; }
.cr span { flex: 1; } .cr .bind { color: #4ade80; } .cr .rb { background: transparent; color: ${ACCENT}; border: 1px solid #2a3142; border-radius: 6px; padding: 3px 8px; cursor: pointer; font: 11px monospace; }
.chk { display: flex; gap: 8px; align-items: center; font-size: 13px; margin-bottom: 10px; }
.btn { background: ${ACCENT}; color: #0d0f14; border: 0; border-radius: 8px; padding: 8px 12px; font: 13px monospace; cursor: pointer; margin: 4px 4px 0 0; }
.btn.editlayout, .btn.reset { background: transparent; color: #e8e6df; border: 1px solid #2a3142; }
.panel-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.hint { color: #38d6ff; font-size: 12px; min-height: 1em; }
`;
