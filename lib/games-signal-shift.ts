export const SIGNAL_SHIFT_GRID_SIZE = 4;
export const SIGNAL_SHIFT_TILE_COUNT = SIGNAL_SHIFT_GRID_SIZE * SIGNAL_SHIFT_GRID_SIZE;
export const SIGNAL_SHIFT_MAX_MOVES = 64;
export const SIGNAL_SHIFT_LEGACY_MAX_MOVES = 72;
export const SIGNAL_SHIFT_REWARD = { xp: 130, parts: 6 } as const;
export const SIGNAL_SHIFT_TTL_MS = 5 * 60 * 1_000;
export const SIGNAL_SHIFT_START_COOLDOWN_MS = 5_000;
export const SIGNAL_SHIFT_MIN_MOVE_INTERVAL_MS = 100;

export type SignalShiftStatus = "playing" | "won" | "failed" | "expired";
export type SignalShiftIntensity = "calibration" | "pressure" | "blackout";

export function signalShiftIntensity(moves: number): SignalShiftIntensity {
  if (moves >= 44) return "blackout";
  if (moves >= 22) return "pressure";
  return "calibration";
}

export type SignalShiftGame = {
  id: string;
  version: number;
  status: SignalShiftStatus;
  gridSize: number;
  tiles: number[];
  moves: number;
  maxMoves: number;
  intensity: SignalShiftIntensity;
  startedAt: number;
  expiresAt: number;
};

export type SignalShiftPayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: SignalShiftGame | null;
};
