import {
  makeEmptyBoard, setHasMine, hasMine, hasFlag, isRevealed,
  setHasFlag, setIsRevealed, getSurroundingMineCount, reveal,
} from "@taros-minesweeper/lib";
import { GAME_MODES, type GameCell, type GameMode, type GameView } from "../../lib/games-hub";

export type GameRow = {
  user_id: string; id: string; mode: GameMode; board_json: string;
  status: "playing" | "won" | "lost"; version: number; started_at: number; updated_at: number;
};
export const GAME_TTL = 30 * 60 * 1000;

function randomIndex(length: number) {
  const limit = Math.floor(0x100000000 / length) * length;
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % length;
}

export function createGameBoard(mode: GameMode) {
  const { size, mines } = GAME_MODES[mode];
  const board = makeEmptyBoard(size, size);
  const available = Array.from({ length: size * size }, (_, i) => i);
  for (let i = 0; i < mines; i++) {
    const choice = i + randomIndex(available.length - i);
    [available[i], available[choice]] = [available[choice], available[i]];
    const index = available[i];
    board[Math.floor(index / size)][index % size] = setHasMine(0, true);
  }
  return board;
}

export function moveGame(row: GameRow, x: number, y: number, action: "reveal" | "flag") {
  let board = JSON.parse(row.board_json) as number[][];
  const selected = board[y][x];
  if (isRevealed(selected) || (action === "reveal" && hasFlag(selected))) return null;
  let status = row.status;
  if (action === "flag") {
    board[y][x] = setHasFlag(selected, !hasFlag(selected));
  } else {
    // Safe first reveal, including when a player placed flags first.
    if (!board.some(line => line.some(isRevealed)) && hasMine(selected)) {
      const safe = board.flatMap((line, yy) => line.flatMap((cell, xx) => !hasMine(cell) ? [{ x: xx, y: yy }] : []));
      const target = safe[randomIndex(safe.length)];
      board[y][x] = setHasMine(selected, false);
      board[target.y][target.x] = setHasMine(board[target.y][target.x], true);
    }
    if (hasMine(board[y][x])) {
      board[y][x] = setIsRevealed(board[y][x], true);
      status = "lost";
    } else {
      const previous = board;
      board = reveal(board, x, y);
      // The engine flood-fill reveals flagged safe cells; keep explicit player flags intact.
      board = board.map((line, yy) => line.map((cell, xx) => hasFlag(previous[yy][xx]) ? previous[yy][xx] : cell));
      // Engine isWon expects mines revealed too. DZN uses the standard all-safe-cells rule.
      if (board.every(line => line.every(cell => hasMine(cell) || isRevealed(cell)))) status = "won";
    }
  }
  return { board, status };
}

export function gameView(row: GameRow, now: number): GameView {
  const board = JSON.parse(row.board_json) as number[][];
  const status = row.status === "playing" && now >= row.started_at + GAME_TTL ? "expired" : row.status;
  return {
    id: row.id, mode: row.mode, version: row.version, status,
    startedAt: row.started_at, expiresAt: row.started_at + GAME_TTL,
    cells: board.map((line, y) => line.map((cell, x): GameCell => {
      if (status !== "playing" && hasMine(cell)) return "mine";
      if (hasFlag(cell)) return "flag";
      if (!isRevealed(cell)) return "hidden";
      return getSurroundingMineCount(board, x, y);
    })),
  };
}
