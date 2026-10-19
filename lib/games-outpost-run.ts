export const OUTPOST_RUN_GRID_SIZE = 5;
export const OUTPOST_RUN_MAX_ENERGY = 3;
export const OUTPOST_RUN_MAX_MOVES = 10;
export const OUTPOST_RUN_REWARD = { xp: 125, parts: 6 } as const;
export const OUTPOST_RUN_TTL_MS = 4 * 60 * 1_000;
export const OUTPOST_RUN_START_COOLDOWN_MS = 5_000;
export const OUTPOST_RUN_MIN_MOVE_INTERVAL_MS = 180;

export const OUTPOST_RUN_DIRECTIONS = ["north", "east", "south", "west"] as const;
export const OUTPOST_RUN_CONTRACTS = ["survey", "intercept", "recovery"] as const;
export type OutpostRunDirection = (typeof OUTPOST_RUN_DIRECTIONS)[number];
export type OutpostRunContract = (typeof OUTPOST_RUN_CONTRACTS)[number];
export type OutpostRunCellKind = "start" | "clear" | "hazard" | "beacon" | "cache" | "relay";
export type OutpostRunStatus = "playing" | "won" | "failed" | "expired";
export type OutpostRunIntensity = "calibration" | "pressure" | "blackout";
export type OutpostRunSupport = "recon" | "shield";
export type OutpostRunObjective = "beacon" | "cache" | "relay";

export function outpostRunIntensity(moves: number): OutpostRunIntensity {
  if (moves >= 7) return "blackout";
  if (moves >= 3) return "pressure";
  return "calibration";
}

export type OutpostRunCell = {
  row: number;
  column: number;
  kind: OutpostRunCellKind;
};

export type OutpostRunGame = {
  id: string;
  version: number;
  status: OutpostRunStatus;
  gridSize: number;
  row: number;
  column: number;
  energy: number;
  maxEnergy: number;
  moves: number;
  maxMoves: number;
  intensity: OutpostRunIntensity;
  contract: OutpostRunContract | "legacy";
  objective: OutpostRunObjective;
  objectivesCompleted: number;
  objectivesTotal: number;
  beaconSecured: boolean;
  cacheSecured: boolean;
  scanHint: string | null;
  scanAvailable: boolean;
  reconAvailable: boolean;
  shieldAvailable: boolean;
  shieldArmed: boolean;
  reconCells: number;
  visibleCells: OutpostRunCell[];
  startedAt: number;
  expiresAt: number;
};

export type OutpostRunPayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: OutpostRunGame | null;
};
