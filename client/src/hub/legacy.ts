/**
 * Zero-config fallback for games that never call hub.input.define(). Mirrors
 * the old standalone gamepad adapter: drive the catalog launcher, pop/navigate
 * the hub menu, and synthesize keyboard events from window.__HUB__.controls so
 * a controller works in any game out of the box. Runs only while no game has
 * taken over input (the InputSystem calls this each frame until define()).
 */

const CODE_KEY: Record<string, [string, number]> = {
  ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
  Space: [' ', 32], Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], Backspace: ['Backspace', 8],
  ShiftLeft: ['Shift', 16], ControlLeft: ['Control', 17], AltLeft: ['Alt', 18],
};
for (let c = 65; c <= 90; c += 1) { const L = String.fromCharCode(c); CODE_KEY[`Key${L}`] = [L.toLowerCase(), c]; }
for (let d = 0; d <= 9; d += 1) CODE_KEY[`Digit${d}`] = [String(d), 48 + d];

const BTN = { A: 0, B: 1, X: 2, Y: 3, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEAD = 0.5;
const DEFAULT = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  buttons: { 0: 'Space', 1: 'Enter', 2: 'KeyZ', 3: 'KeyX', 9: 'Enter', 8: 'Escape' } as Record<number, string> };

function controlsFor(controls: any, i: number) {
  const base = controls && (Array.isArray(controls.players) ? (controls.players[i] || controls.players[0]) : controls);
  const b = base || {};
  return { up: b.up || DEFAULT.up, down: b.down || DEFAULT.down, left: b.left || DEFAULT.left, right: b.right || DEFAULT.right,
    buttons: { ...DEFAULT.buttons, ...(b.buttons || {}) } };
}
function fireKey(type: string, code: string) {
  const [key, keyCode] = CODE_KEY[code] || [code, 0];
  const active = document.activeElement as HTMLElement | null;
  const target = (active && active !== document.body) ? active : (document.body || document);
  const ev = new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true } as any);
  try { Object.defineProperty(ev, 'keyCode', { get: () => keyCode }); Object.defineProperty(ev, 'which', { get: () => keyCode }); } catch { /* */ }
  target.dispatchEvent(ev);
}

let styled = false;
function ensureStyle(root: ShadowRoot | null) {
  const css = '.gp-focus{outline:3px solid #ff5f3b !important;outline-offset:2px;border-radius:4px;}';
  if (!styled && !document.getElementById('gp-focus-style')) {
    const s = document.createElement('style'); s.id = 'gp-focus-style'; s.textContent = css;
    (document.head || document.documentElement).appendChild(s); styled = true;
  }
  if (root && !(root as any).getElementById?.('gp-focus-style')) {
    const s = document.createElement('style'); s.id = 'gp-focus-style'; s.textContent = css; root.appendChild(s);
  }
}

const held = new Map<number, Set<string>>();

function btn(gp: Gamepad, i: number) { return !!(gp.buttons[i] && gp.buttons[i].pressed); }
function dirs(gp: Gamepad) {
  const ax = gp.axes;
  return {
    up: (ax[1] != null && ax[1] < -DEAD) || btn(gp, BTN.UP),
    down: (ax[1] != null && ax[1] > DEAD) || btn(gp, BTN.DOWN),
    left: (ax[0] != null && ax[0] < -DEAD) || btn(gp, BTN.LEFT),
    right: (ax[0] != null && ax[0] > DEAD) || btn(gp, BTN.RIGHT),
  };
}

// Called by the InputSystem each frame only while the hub menu is CLOSED and no
// game has called hub.input.define(). The menu (and the Select toggle) are
// handled by the InputSystem itself, so this only covers catalog navigation and
// keyboard synthesis inside a zero-config game.
export function legacyFrame(sys: any): void {
  const gps = (sys._gamepads() as (Gamepad | null)[]).filter(Boolean) as Gamepad[];
  if (!gps.length) return;
  ensureStyle(null);

  const slug = sys.host?.slug ?? (window as any).__HUB__?.slug ?? null;
  if (slug) { gameFrame(sys, gps); return; }   // in a game → synthesize keyboard

  // catalog launcher navigation
  const cd = { up: false, down: false, left: false, right: false };
  let accept = false;
  for (const gp of gps) {
    const d = dirs(gp);
    cd.up = cd.up || d.up; cd.down = cd.down || d.down; cd.left = cd.left || d.left; cd.right = cd.right || d.right;
    accept = accept || btn(gp, BTN.A) || btn(gp, BTN.START);
  }
  const up = sys._navEdge('lu', cd.up); const down = sys._navEdge('ld', cd.down);
  const left = sys._navEdge('ll', cd.left); const right = sys._navEdge('lr', cd.right);
  const doAccept = sys._navEdge('la', accept) && accept;
  catalogNav({ up, down, left, right, accept: doAccept });
}

function gameFrame(sys: any, gps: Gamepad[]): void {
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) { releaseAll(); return; }
  const controls = sys._legacyControls();
  gps.forEach((gp, i) => {
    const map = controlsFor(controls, i);
    const d = dirs(gp);
    const desired = new Set<string>();
    if (d.up) desired.add(map.up); if (d.down) desired.add(map.down);
    if (d.left) desired.add(map.left); if (d.right) desired.add(map.right);
    for (const [idx, code] of Object.entries(map.buttons)) if (code && btn(gp, Number(idx))) desired.add(code as string);
    const cur = held.get(i) || new Set<string>();
    for (const code of desired) if (!cur.has(code)) fireKey('keydown', code);
    for (const code of cur) if (!desired.has(code)) fireKey('keyup', code);
    held.set(i, desired);
  });
}
function releaseAll(): void { for (const [i, set] of held) { for (const code of set) fireKey('keyup', code); held.set(i, new Set()); } }

function tiles(): HTMLElement[] { return Array.from(document.querySelectorAll('.grid .card')).filter((c) => (c as HTMLElement).offsetParent !== null) as HTMLElement[]; }
function catalogNav(d: { up: boolean; down: boolean; left: boolean; right: boolean; accept: boolean }): void {
  const cards = tiles(); if (!cards.length) return;
  let idx = cards.findIndex((c) => c.classList.contains('gp-focus'));
  if (idx < 0) { highlight(cards, 0); return; }
  if (d.accept) { const el = cards[idx]; const href = el.getAttribute('href'); if (href) location.href = href; else el.click(); return; }
  const dir = d.up ? 'up' : d.down ? 'down' : d.left ? 'left' : d.right ? 'right' : null;
  if (!dir) return; const next = nearest(cards, idx, dir); if (next >= 0) highlight(cards, next);
}
function highlight(cards: HTMLElement[], idx: number): void { cards.forEach((c) => c.classList.remove('gp-focus')); const el = cards[idx]; el.classList.add('gp-focus'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
function nearest(cards: HTMLElement[], from: number, dir: string): number {
  const r = cards[from].getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = -1, bestScore = Infinity;
  cards.forEach((c, i) => { if (i === from) return; const b = c.getBoundingClientRect(); const bx = b.left + b.width / 2, by = b.top + b.height / 2; const dx = bx - cx, dy = by - cy;
    const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4; if (!ok) return;
    const along = (dir === 'up' || dir === 'down') ? Math.abs(dy) : Math.abs(dx); const across = (dir === 'up' || dir === 'down') ? Math.abs(dx) : Math.abs(dy);
    const s = along + across * 2; if (s < bestScore) { bestScore = s; best = i; } });
  return best;
}

