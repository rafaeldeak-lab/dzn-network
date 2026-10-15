export const NIGHT_RUN_LANES = ["left", "centre", "right"] as const;
export type NightRunLane = (typeof NIGHT_RUN_LANES)[number];

export const NIGHT_RUN_TOTAL_GATES = 9;
export const NIGHT_RUN_MAX_COLLISIONS = 2;
export const NIGHT_RUN_REWARD = { xp: 180, parts: 9 } as const;
export const NIGHT_RUN_TTL_MS = 3 * 60 * 1_000;
export const NIGHT_RUN_START_COOLDOWN_MS = 5_000;
export const NIGHT_RUN_GATE_LEAD_MS = 650;
export const NIGHT_RUN_GATE_WINDOW_MS = 2_450;
export const NIGHT_RUN_MIN_REACTION_MS = 120;
export const NIGHT_RUN_MIN_ACTION_INTERVAL_MS = 145;

export type NightRunStatus = "playing" | "won" | "failed" | "expired";

export type NightRunGame = {
  id: string;
  version: number;
  status: NightRunStatus;
  gatesCleared: number;
  totalGates: number;
  collisions: number;
  maxCollisions: number;
  safeLane: NightRunLane | null;
  gateStartsAt: number;
  gateEndsAt: number;
  startedAt: number;
  expiresAt: number;
};

export type NightRunPayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: NightRunGame | null;
};
