export const RANGER_RANGE_TARGETS = ["ridge", "ruins", "road", "treeline", "tower", "ravine"] as const;
export type RangerRangeTarget = (typeof RANGER_RANGE_TARGETS)[number];
export const RANGER_RANGE_WINDS = ["left", "calm", "right"] as const;
export type RangerRangeWind = (typeof RANGER_RANGE_WINDS)[number];
export const RANGER_RANGE_SIGHTS = ["left", "centre", "right"] as const;
export type RangerRangeSight = (typeof RANGER_RANGE_SIGHTS)[number];

export const RANGER_RANGE_WIND_META: Record<RangerRangeWind, { label: string; correction: RangerRangeSight; instruction: string }> = {
  left: { label: "Crosswind from left", correction: "right", instruction: "Hold right" },
  calm: { label: "Still air", correction: "centre", instruction: "Hold centre" },
  right: { label: "Crosswind from right", correction: "left", instruction: "Hold left" },
};

export function rangerRangeSightForWind(wind: RangerRangeWind): RangerRangeSight {
  return RANGER_RANGE_WIND_META[wind].correction;
}

export const RANGER_RANGE_TOTAL_SHOTS = 8;
export const RANGER_RANGE_MAX_MISSES = 2;
export const RANGER_RANGE_REWARD = { xp: 160, parts: 8 } as const;
export const RANGER_RANGE_TTL_MS = 3 * 60 * 1_000;
export const RANGER_RANGE_START_COOLDOWN_MS = 5_000;
export const RANGER_RANGE_TARGET_LEAD_MS = 700;
export const RANGER_RANGE_TARGET_WINDOW_MS = 2_300;
export const RANGER_RANGE_MIN_REACTION_MS = 110;
export const RANGER_RANGE_MIN_ACTION_INTERVAL_MS = 140;

export type RangerRangeIntensity = "calibration" | "pressure" | "blackout";

export function rangerRangeIntensity(shotIndex: number, totalShots = RANGER_RANGE_TOTAL_SHOTS): RangerRangeIntensity {
  const progress = totalShots > 0 ? shotIndex / totalShots : 0;
  return progress < 0.3 ? "calibration" : progress < 0.7 ? "pressure" : "blackout";
}

/** The API, rather than the browser, owns the escalating target deadline. */
export function rangerRangeTargetWindowMs(shotIndex: number, totalShots = RANGER_RANGE_TOTAL_SHOTS) {
  switch (rangerRangeIntensity(shotIndex, totalShots)) {
    case "pressure": return 1_850;
    case "blackout": return 1_450;
    default: return RANGER_RANGE_TARGET_WINDOW_MS;
  }
}

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
  wind: RangerRangeWind | null;
  targetStartsAt: number;
  targetEndsAt: number;
  intensity: RangerRangeIntensity;
  startedAt: number;
  expiresAt: number;
};

export type RangerRangePayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: RangerRangeGame | null;
};
