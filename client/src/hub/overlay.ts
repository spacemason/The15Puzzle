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
  }

  // ---- virtual controls ----

  build(config: InputConfig, overrides: InputOverrides, cb: VCallbacks): void {
    this.callbacks = cb;
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
    this.layout(overrides);
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
      // gets a round knob that slides, not a stretched ellipse).
      const knobEl = wrap.querySelector('.knob') as HTMLElement;
      const kd = Math.round(Math.min(w, h) * 0.5);
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

  setVirtualVisible(globalVis: boolean, enabledGroups: Set<string> | null): void {
    this.globalVisible = globalVis; this.groupVisible = enabledGroups || new Set();
    const allGroups = !enabledGroups;   // null → show controls of every group (editing)
    for (const c of this.controls) {
      const show = globalVis && (allGroups || enabledGroups!.has(c.group));
      c.el.style.display = show ? '' : 'none';
    }
  }

  private layout(overrides?: InputOverrides): void {
    const m = 22, gap = 14;
    const byAnchor = new Map<string, Array<{ def: VirtualDef; el: HTMLElement }>>();
    for (const c of this.controls) {
      const ov = overrides && overrides.virtual && overrides.virtual[(c.el as any).__id];
      if (ov && ov.x != null && ov.y != null) {           // explicit player override
        clearPos(c.el); c.el.style.left = ov.x + '%'; c.el.style.top = ov.y + '%';
        continue;
      }
      const a = (c.def.place || 'bottom-left');
      if (!byAnchor.has(a)) byAnchor.set(a, []);
      byAnchor.get(a)!.push(c);
    }
    for (const [a, list] of byAnchor) this.layoutAnchor(a as Anchor, list, m, gap);
  }

  /** Lay out one anchor's controls so action buttons cluster *beside* (not on
   *  top of) any joystick/d-pad sharing that corner. Sticks sit at the corner;
   *  buttons are inset past the sticks and stacked, wrapping into columns. */
  private layoutAnchor(a: Anchor, list: Array<{ def: VirtualDef; el: HTMLElement }>, m: number, gap: number): void {
    const sticks = list.filter((c) => c.def.type === 'joystick' || c.def.type === 'dpad');
    const buttons = list.filter((c) => c.def.type === 'button' || c.def.type === 'tap');
    const onTop = a.startsWith('top');
    const onLeft = a.endsWith('left'), onRight = a.endsWith('right');
    const midX = a === 'top' || a === 'bottom' || a === 'center';
    const midY = a === 'left' || a === 'right' || a === 'center';
    const vEdge = onTop ? 'top' : 'bottom';
    const hEdge = onRight ? 'right' : 'left';

    let reserve = m;
    sticks.forEach((c, i) => {
      const s = c.def.size || 130; const st = c.el.style; clearPos(c.el);
      if (midY) { st.top = '50%'; } else { (st as any)[vEdge] = m + 'px'; }
      if (midX) { st.left = '50%'; st.transform = `translate(-50%, ${midY ? '-50%' : '0'})`; }
      else { (st as any)[hEdge] = (m + i * (s + gap)) + 'px'; if (midY) st.transform = 'translateY(-50%)'; }
      reserve = Math.max(reserve, m + (i + 1) * (s + gap));
    });

    const baseInset = sticks.length ? reserve : m;
    const perCol = 3;
    buttons.forEach((c, i) => {
      const s = c.def.size || 72; const st = c.el.style; clearPos(c.el);
      const col = Math.floor(i / perCol), row = i % perCol;
      const inset = baseInset + col * (s + gap);
      const along = m + row * (s + gap);
      (st as any)[vEdge] = along + 'px';
      if (midX) { st.left = '50%'; st.transform = 'translateX(-50%)'; }
      else { (st as any)[hEdge] = inset + 'px'; }
    });
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
      </div>`;
    this.root.appendChild(p); this.panelEl = p;
    const showv = p.querySelector('.showv') as HTMLInputElement;
    showv.checked = !!sys.showingVirtual;
    showv.addEventListener('change', () => { sys.showVirtual(showv.checked); });
    p.querySelector('.editlayout')!.addEventListener('click', () => { this.setEditMode(!this.editMode, sys); });
    p.querySelector('.reset')!.addEventListener('click', () => { sys.resetControls(); this.closeControls(); });
    p.querySelector('.done')!.addEventListener('click', () => { this.setEditMode(false, sys); this.closeControls(); });
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
    let dragging = false; let sx = 0, sy = 0;
    const start = (px: number, py: number) => { if (!this.editMode) return; dragging = true; sx = px; sy = py; };
    const move = (px: number, py: number, sysRef?: any) => {
      if (!dragging) return;
      const xPct = Math.max(2, Math.min(96, (px / window.innerWidth) * 100));
      const yPct = Math.max(2, Math.min(94, (py / window.innerHeight) * 100));
      el.style.left = xPct + '%'; el.style.right = ''; el.style.top = yPct + '%'; el.style.bottom = ''; el.style.transform = '';
      (el as any).__pos = { x: xPct, y: yPct };
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
