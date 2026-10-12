export const RANGER_RANGE_TARGETS = ["ridge", "ruins", "road", "treeline", "tower", "ravine"] as const;
export type RangerRangeTarget = (typeof RANGER_RANGE_TARGETS)[number];

export const RANGER_RANGE_TOTAL_SHOTS = 8;
export const RANGER_RANGE_MAX_MISSES = 2;
export const RANGER_RANGE_REWARD = { xp: 160, parts: 8 } as const;
export const RANGER_RANGE_TTL_MS = 3 * 60 * 1_000;
export const RANGER_RANGE_START_COOLDOWN_MS = 5_000;
export const RANGER_RANGE_TARGET_LEAD_MS = 700;
export const RANGER_RANGE_TARGET_WINDOW_MS = 2_300;
export const RANGER_RANGE_MIN_REACTION_MS = 110;
export const RANGER_RANGE_MIN_ACTION_INTERVAL_MS = 140;

export type RangerRangeStatus = "playing" | "won" | "failed" | "expired";

export type RangerRangeGame = {
  id: string;
  version: number;
  status: RangerRangeStatus;
  shotsCleared: number;
  totalShots: number;
  misses: number;
  maxMisses: number;
  target: RangerRangeTarget | null;
  targetStartsAt: number;
  targetEndsAt: number;
  startedAt: number;
  expiresAt: number;
};

export type RangerRangePayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: RangerRangeGame | null;
};
