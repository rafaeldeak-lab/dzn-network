export const CIRCUIT_FORGE_GRID_SIZE = 5;
export const CIRCUIT_FORGE_TILE_COUNT = CIRCUIT_FORGE_GRID_SIZE * CIRCUIT_FORGE_GRID_SIZE;
export const CIRCUIT_FORGE_MAX_ROTATIONS = 64;
export const CIRCUIT_FORGE_REWARD = { xp: 140, parts: 7 } as const;
export const CIRCUIT_FORGE_TTL_MS = 5 * 60 * 1_000;
export const CIRCUIT_FORGE_START_COOLDOWN_MS = 5_000;
export const CIRCUIT_FORGE_MIN_ROTATION_INTERVAL_MS = 120;

export type CircuitForgeStatus = "playing" | "won" | "failed" | "expired";

export type CircuitForgeTile = {
  mask: number;
  powered: boolean;
  core: boolean;
};

export type CircuitForgeGame = {
  id: string;
  version: number;
  status: CircuitForgeStatus;
  gridSize: number;
  tiles: CircuitForgeTile[];
  poweredCount: number;
  rotations: number;
  maxRotations: number;
  startedAt: number;
  expiresAt: number;
};

export type CircuitForgePayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: CircuitForgeGame | null;
};
