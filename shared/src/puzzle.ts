import { Board, CELLS, Direction, GOAL, SIZE } from "./types.js";

export function cloneBoard(b: Board): Board {
  return b.slice();
}

export function isSolved(b: Board): boolean {
  for (let i = 0; i < CELLS; i++) if (b[i] !== GOAL[i]) return false;
  return true;
}

export function findZero(b: Board): number {
  return b.indexOf(0);
}

// Returns the index that would swap with zero for a given direction.
// Direction describes which tile the user is sliding into the empty cell.
// "left" = tile to the right of zero slides left into zero.
export function neighborForDirection(b: Board, dir: Direction): number | null {
  const z = findZero(b);
  const r = Math.floor(z / SIZE);
  const c = z % SIZE;
  let nr = r;
  let nc = c;
  switch (dir) {
    case "up":
      nr = r + 1;
      break;
    case "down":
      nr = r - 1;
      break;
    case "left":
      nc = c + 1;
      break;
    case "right":
      nc = c - 1;
      break;
  }
  if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) return null;
  return nr * SIZE + nc;
}

export function applyMove(b: Board, tileIndex: number): Board {
  // Move the tile at tileIndex into the adjacent zero, if adjacent.
  const z = findZero(b);
  if (!areAdjacent(z, tileIndex)) return b;
  const out = cloneBoard(b);
  out[z] = out[tileIndex]!;
  out[tileIndex] = 0;
  return out;
}

export function areAdjacent(a: number, b: number): boolean {
  const ar = Math.floor(a / SIZE);
  const ac = a % SIZE;
  const br = Math.floor(b / SIZE);
  const bc = b % SIZE;
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}

export function neighbors(idx: number): number[] {
  const r = Math.floor(idx / SIZE);
  const c = idx % SIZE;
  const out: number[] = [];
  if (r > 0) out.push((r - 1) * SIZE + c);
  if (r < SIZE - 1) out.push((r + 1) * SIZE + c);
  if (c > 0) out.push(r * SIZE + (c - 1));
  if (c < SIZE - 1) out.push(r * SIZE + (c + 1));
  return out;
}

// Returns true when the board has a valid sequence of moves to the goal.
// 15-puzzle solvability rule: parity of inversion count + (row of blank counted from bottom) must be even.
export function isSolvable(b: Board): boolean {
  let inv = 0;
  const tiles = b.filter((x) => x !== 0);
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if (tiles[i]! > tiles[j]!) inv++;
    }
  }
  const z = findZero(b);
  const rowFromBottom = SIZE - Math.floor(z / SIZE);
  return (inv + rowFromBottom) % 2 === 0;
}

// Scramble by applying N random moves from the goal state — guarantees solvability
// and gives us an upper-bound difficulty proxy.
export function scramble(moveCount: number, rng: () => number = Math.random): Board {
  const board = cloneBoard(GOAL);
  let prevZ = -1;
  for (let step = 0; step < moveCount; step++) {
    const z = findZero(board);
    const opts = neighbors(z).filter((n) => n !== prevZ);
    const pick = opts[Math.floor(rng() * opts.length)]!;
    board[z] = board[pick]!;
    board[pick] = 0;
    prevZ = z;
  }
  return board;
}
