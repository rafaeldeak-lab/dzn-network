import {
  makeEmptyBoard, setHasMine, hasMine, hasFlag, isRevealed,
  setHasFlag, setIsRevealed, getSurroundingMineCount, reveal,
} from "@taros-minesweeper/lib";
import { GAME_MODES, type GameCell, type GameMode, type GamePhase, type GameScan, type GameView } from "../../lib/games-hub";

export type GameRow = {
  user_id: string; id: string; mode: GameMode; board_json: string;
  status: "playing" | "won" | "lost"; version: number; started_at: number; updated_at: number;
};
export const GAME_TTL = 30 * 60 * 1000;

export type GameState = {
  version: 1;
  cells: number[][];
  scans: GameScan[];
};

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

export function createGameState(mode: GameMode): GameState {
  return { version: 1, cells: createGameBoard(mode), scans: [] };
}

function isBoard(value: unknown): value is number[][] {
  return Array.isArray(value) && value.length > 0 && value.every(row => Array.isArray(row) && row.length === value.length
    && row.every(cell => typeof cell === "number" && Number.isInteger(cell)));
}

function readGameState(serialized: string): GameState {
  const parsed: unknown = JSON.parse(serialized);
  const legacyBoard = isBoard(parsed) ? parsed : null;
  const modern = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as { version?: unknown; cells?: unknown; scans?: unknown } : null;
  const cells = legacyBoard ?? (modern && isBoard(modern.cells) ? modern.cells : null);
  if (!cells) throw new Error("Invalid stored game state.");
  const seen = new Set<string>();
  const scans = Array.isArray(modern?.scans) ? modern.scans.flatMap((value): GameScan[] => {
    if (!value || typeof value !== "object") return [];
    const scan = value as Partial<GameScan>;
    if (!Number.isInteger(scan.x) || !Number.isInteger(scan.y) || !Number.isInteger(scan.threats)
      || scan.x < 0 || scan.y < 0 || scan.x >= cells.length || scan.y >= cells.length || scan.threats < 0 || scan.threats > 9) return [];
    const key = `${scan.x}:${scan.y}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ x: scan.x, y: scan.y, threats: scan.threats }];
  }) : [];
  return { version: 1, cells, scans };
}

export function serializeGameState(state: GameState) {
  return JSON.stringify(state);
}

export function moveGame(row: GameRow, x: number, y: number, action: "reveal" | "flag") {
  const state = readGameState(row.board_json);
  let board = state.cells;
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
  return { board, state: { ...state, cells: board }, status };
}

export function scanGame(row: GameRow, x: number, y: number) {
  const state = readGameState(row.board_json);
  const board = state.cells;
  const selected = board[y]?.[x];
  // The first cleared sector is guaranteed safe. Delay scans until it is established so a later safety relocation can never invalidate a scan report.
  const openingCleared = board.some(line => line.some(cell => !hasMine(cell) && isRevealed(cell)));
  if (!openingCleared || selected === undefined || isRevealed(selected) || hasFlag(selected) || state.scans.length >= GAME_MODES[row.mode].scans
    || state.scans.some(scan => scan.x === x && scan.y === y)) return null;
  let threats = 0;
  for (let yy = Math.max(0, y - 1); yy <= Math.min(board.length - 1, y + 1); yy++) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(board.length - 1, x + 1); xx++) {
      if (hasMine(board[yy][xx])) threats++;
    }
  }
  const scans = [...state.scans, { x, y, threats }];
  return { board, state: { ...state, scans }, status: row.status };
}

export function gameView(row: GameRow, now: number): GameView {
  const state = readGameState(row.board_json);
  const board = state.cells;
  const status = row.status === "playing" && now >= row.started_at + GAME_TTL ? "expired" : row.status;
  const safeTotal = board.flat().filter(cell => !hasMine(cell)).length;
  const safeCleared = board.flat().filter(cell => !hasMine(cell) && isRevealed(cell)).length;
  const progress = safeTotal ? safeCleared / safeTotal : 0;
  const phase: GamePhase = progress < 0.34 ? "triangulate" : progress < 0.76 ? "contain" : "extract";
  return {
    id: row.id, mode: row.mode, version: row.version, status,
    startedAt: row.started_at, expiresAt: row.started_at + GAME_TTL,
    scans: state.scans, scanCharges: GAME_MODES[row.mode].scans, safeCleared, safeTotal, phase,
    cells: board.map((line, y) => line.map((cell, x): GameCell => {
      if (status !== "playing" && hasMine(cell)) return "mine";
      if (hasFlag(cell)) return "flag";
      if (!isRevealed(cell)) return "hidden";
      return getSurroundingMineCount(board, x, y);
    })),
  };
}
