import { Board, CELLS, SIZE } from "./types.js";
import { cloneBoard, isSolved, neighbors } from "./puzzle.js";

const GOAL_ROW = new Int8Array(CELLS);
const GOAL_COL = new Int8Array(CELLS);
for (let v = 1; v < CELLS; v++) {
  GOAL_ROW[v] = Math.floor((v - 1) / SIZE);
  GOAL_COL[v] = (v - 1) % SIZE;
}
GOAL_ROW[0] = SIZE - 1;
GOAL_COL[0] = SIZE - 1;

export function heuristic(b: Board): number {
  let h = 0;
  for (let i = 0; i < CELLS; i++) {
    const v = b[i]!;
    if (v === 0) continue;
    const r = (i / SIZE) | 0;
    const c = i % SIZE;
    h += Math.abs(r - GOAL_ROW[v]!) + Math.abs(c - GOAL_COL[v]!);
  }
  // Linear conflict — rows
  for (let r = 0; r < SIZE; r++) {
    for (let c1 = 0; c1 < SIZE; c1++) {
      const v1 = b[r * SIZE + c1]!;
      if (v1 === 0 || GOAL_ROW[v1] !== r) continue;
      for (let c2 = c1 + 1; c2 < SIZE; c2++) {
        const v2 = b[r * SIZE + c2]!;
        if (v2 === 0 || GOAL_ROW[v2] !== r) continue;
        if (v1 > v2) h += 2;
      }
    }
  }
  // Linear conflict — cols
  for (let c = 0; c < SIZE; c++) {
    for (let r1 = 0; r1 < SIZE; r1++) {
      const v1 = b[r1 * SIZE + c]!;
      if (v1 === 0 || GOAL_COL[v1] !== c) continue;
      for (let r2 = r1 + 1; r2 < SIZE; r2++) {
        const v2 = b[r2 * SIZE + c]!;
        if (v2 === 0 || GOAL_COL[v2] !== c) continue;
        if (v1 > v2) h += 2;
      }
    }
  }
  return h;
}

export interface SolveResult {
  // Sequence of tile values to slide into the empty cell, in order.
  moves: number[];
  nodes: number;
  truncated: boolean;
}

const DEFAULT_NODE_LIMIT = 5_000_000;

// IDA* solver. Returns the sequence of tile values that, when slid into the
// blank in order, transforms `start` into the goal state.
export function solve(start: Board, nodeLimit = DEFAULT_NODE_LIMIT): SolveResult {
  if (isSolved(start)) return { moves: [], nodes: 0, truncated: false };

  const board = cloneBoard(start);
  const path: number[] = [];
  let nodes = 0;
  let truncated = false;

  // Precompute neighbor tables so we don't recompute on every step.
  const nbrTable: number[][] = [];
  for (let i = 0; i < CELLS; i++) nbrTable.push(neighbors(i));

  let bound = heuristic(board);

  const dfs = (g: number, lastZ: number): number => {
    if (nodes > nodeLimit) {
      truncated = true;
      return -2;
    }
    nodes++;
    const h = heuristic(board);
    const f = g + h;
    if (f > bound) return f;
    if (h === 0) return -1;

    let z = -1;
    for (let i = 0; i < CELLS; i++) if (board[i] === 0) { z = i; break; }

    let min = Infinity;
    const nbrs = nbrTable[z]!;
    for (let i = 0; i < nbrs.length; i++) {
      const n = nbrs[i]!;
      if (n === lastZ) continue;
      const tileVal = board[n]!;
      board[z] = tileVal;
      board[n] = 0;
      path.push(tileVal);
      const t = dfs(g + 1, z);
      if (t === -1) return -1;
      if (t === -2) return -2;
      if (t < min) min = t;
      board[n] = tileVal;
      board[z] = 0;
      path.pop();
    }
    return min;
  };

  while (true) {
    const t = dfs(0, -1);
    if (t === -1) return { moves: path, nodes, truncated };
    if (t === -2) return { moves: [], nodes, truncated: true };
    if (t === Infinity) return { moves: [], nodes, truncated: false };
    bound = t;
  }
}
