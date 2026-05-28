import { motion } from "framer-motion";
import type { Board as BoardT, PuzzleFull } from "@p15/shared";
import { SIZE } from "@p15/shared";
import { assetUrl } from "../api";

interface Props {
  puzzle: PuzzleFull;
  board: BoardT;
  size?: number;
  onTileClick?: (tileIndex: number) => void;
  isSolved?: boolean;
}

const TILE_GAP = 8;

export function BoardView({ puzzle, board, size = 480, onTileClick, isSolved }: Props) {
  const cellSize = (size - TILE_GAP * (SIZE + 1)) / SIZE;
  const style = puzzle.style ?? {};

  const bgImg = assetUrl(puzzle.bgImageUrl);
  const completeImg = assetUrl(puzzle.completeImageUrl);

  // Where the tile with value v currently sits (index in board array).
  const positions = new Map<number, number>();
  for (let i = 0; i < board.length; i++) {
    const v = board[i]!;
    if (v !== 0) positions.set(v, i);
  }

  const showNumbers = puzzle.showNumbers;
  const tileImgs = (puzzle.tileImageUrls ?? []).map((u) => assetUrl(u) ?? null);
  const hasAnyTileImage = tileImgs.some((u) => !!u);

  return (
    <div
      className="board"
      style={{
        width: size,
        height: size,
        background: bgImg
          ? `center/cover no-repeat url(${bgImg})`
          : style.boardColor ?? "var(--bg-elev-2)",
        padding: TILE_GAP,
      }}
    >
      {/* If solved AND a complete-image is configured, draw it as a full overlay. */}
      {isSolved && completeImg ? (
        <div
          style={{
            position: "absolute",
            inset: TILE_GAP,
            background: `center/cover no-repeat url(${completeImg})`,
            borderRadius: 8,
          }}
        />
      ) : null}

      {Array.from(positions.entries()).map(([v, idx]) => {
        const r = Math.floor(idx / SIZE);
        const c = idx % SIZE;
        const x = c * (cellSize + TILE_GAP) + TILE_GAP;
        const y = r * (cellSize + TILE_GAP) + TILE_GAP;

        // If using a complete image and the tile is in correct position, the
        // overlay above already covers it. Otherwise draw a tile.
        const tileImg = tileImgs[v - 1] ?? null;

        // If complete image is set: each tile shows its slice of the complete image.
        const sliceR = Math.floor((v - 1) / SIZE);
        const sliceC = (v - 1) % SIZE;
        const sliceSize = cellSize * SIZE;
        const sliceBg = completeImg
          ? {
              backgroundImage: `url(${completeImg})`,
              backgroundSize: `${sliceSize}px ${sliceSize}px`,
              backgroundPosition: `-${sliceC * cellSize}px -${sliceR * cellSize}px`,
            }
          : tileImg
            ? { background: `center/cover no-repeat url(${tileImg})` }
            : {};

        const tileBg =
          completeImg || tileImg
            ? sliceBg
            : {
                background: style.tileColor
                  ? style.tileColor
                  : "var(--tile-bg)",
                color: style.tileTextColor ?? "var(--tile-fg)",
                border: style.tileBorderColor ? `2px solid ${style.tileBorderColor}` : undefined,
              };

        return (
          <motion.div
            key={v}
            className={`tile ${showNumbers ? "" : "no-numbers"}`}
            onClick={() => onTileClick?.(idx)}
            initial={false}
            animate={{ x, y }}
            transition={{ type: "spring", stiffness: 600, damping: 36, mass: 0.6 }}
            style={{
              width: cellSize,
              height: cellSize,
              fontSize: Math.max(20, cellSize * 0.35),
              ...tileBg,
            }}
          >
            {showNumbers ? v : ""}
          </motion.div>
        );
      })}
    </div>
  );
}
