// Board is a flat array of 16 cells, row-major. 0 is the empty cell.
// Goal state: [1,2,3,4, 5,6,7,8, 9,10,11,12, 13,14,15,0]
export type Board = number[];

export const SIZE = 4;
export const CELLS = SIZE * SIZE;

export const GOAL: Board = Array.from({ length: CELLS }, (_, i) =>
  i === CELLS - 1 ? 0 : i + 1,
);

export type Direction = "up" | "down" | "left" | "right";

export interface UserPublic {
  id: number;
  username: string;
  theme: "light" | "dark";
  hideTimer: boolean;
}

export interface PuzzleStyle {
  bgColor?: string;
  boardColor?: string;
  tileColor?: string;
  tileBorderColor?: string;
  tileTextColor?: string;
  pattern?: "none" | "dots" | "grid" | "diagonal";
}

export interface PuzzleSummary {
  id: number;
  name: string;
  difficulty: number; // scramble move count
  optimalMoves: number;
  builtIn: boolean;
  creatorId: number | null;
  creatorName: string | null;
  showNumbers: boolean;
  hasBgImage: boolean;
  hasCompleteImage: boolean;
  hasTileImages: boolean;
  solved: boolean;
}

export interface PuzzleFull extends PuzzleSummary {
  initialBoard: Board;
  style: PuzzleStyle;
  bgImageUrl: string | null;
  completeImageUrl: string | null;
  tileImageUrls: (string | null)[]; // length 15, index 0 = tile "1"
}

export interface ActiveGame {
  puzzleId: number;
  board: Board;
  moves: number;
  startedAt: number; // unix ms
  lastUpdated: number;
}

export interface SolveRecord {
  id: number;
  userId: number;
  username: string;
  puzzleId: number;
  puzzleName: string;
  moves: number;
  optimalMoves: number;
  durationMs: number;
  completedAt: number;
}

export interface LeaderboardEntry {
  userId: number;
  username: string;
  solveCount: number;
  bestTimeMs: number | null;
  avgAccuracy: number | null; // 0..1
}
