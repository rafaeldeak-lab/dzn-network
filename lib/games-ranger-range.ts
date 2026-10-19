export const RANGER_RANGE_TARGETS = ["ridge", "ruins", "road", "treeline", "tower", "ravine"] as const;
export type RangerRangeTarget = (typeof RANGER_RANGE_TARGETS)[number];
export const RANGER_RANGE_WINDS = ["left", "calm", "right"] as const;
export type RangerRangeWind = (typeof RANGER_RANGE_WINDS)[number];
export const RANGER_RANGE_SIGHTS = ["left", "centre", "right"] as const;
export type RangerRangeSight = (typeof RANGER_RANGE_SIGHTS)[number];
export const RANGER_RANGE_COURSES = ["wayfinder", "gale", "blackout"] as const;
export type RangerRangeCourse = (typeof RANGER_RANGE_COURSES)[number];

export const RANGER_RANGE_COURSE_META: Record<RangerRangeCourse, {
  label: string;
  fieldNote: string;
  briefing: string;
  windowAdjustmentMs: number;
  revealDelayMs: number;
}> = {
  wayfinder: {
    label: "Wayfinder circuit",
    fieldNote: "Balanced windows / field calibration",
    briefing: "Learn the valley plates in clear sequence. Wind calls begin calm before the range develops crosswind.",
    windowAdjustmentMs: 0,
    revealDelayMs: 0,
  },
  gale: {
    label: "Gale traverse",
    fieldNote: "Crosswind from the first plate",
    briefing: "Every plate is carried by live wind. Read the correction quickly and release before the gust shifts.",
    windowAdjustmentMs: -170,
    revealDelayMs: 0,
  },
  blackout: {
    label: "Blackout watch",
    fieldNote: "Late plate reveal / reduced sightline",
    briefing: "The lantern line fails after each call. Stay nocked, wait for the marker to resolve, then commit a clean shot.",
    windowAdjustmentMs: -110,
    revealDelayMs: 460,
  },
};

export const RANGER_RANGE_WIND_META: Record<RangerRangeWind, { label: string; correction: RangerRangeSight; instruction: string }> = {
  // A wind from the left pushes an arrow right, so the player holds left to compensate.
  left: { label: "Crosswind from left", correction: "left", instruction: "Hold left" },
  calm: { label: "Still air", correction: "centre", instruction: "Hold centre" },
  right: { label: "Crosswind from right", correction: "right", instruction: "Hold right" },
};

export function rangerRangeSightForWind(wind: RangerRangeWind): RangerRangeSight {
  return RANGER_RANGE_WIND_META[wind].correction;
}

export function rangerRangeTargetRevealDelayMs(course: RangerRangeCourse | "legacy", shotIndex: number) {
  if (course !== "blackout") return 0;
  // The first plate establishes the range; later plates appear only after the lantern call.
  return shotIndex === 0 ? 0 : RANGER_RANGE_COURSE_META.blackout.revealDelayMs;
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
export function rangerRangeTargetWindowMs(shotIndex: number, totalShots = RANGER_RANGE_TOTAL_SHOTS, course: RangerRangeCourse | "legacy" = "legacy") {
  const base = (() => {
    switch (rangerRangeIntensity(shotIndex, totalShots)) {
      case "pressure": return 1_850;
      case "blackout": return 1_450;
      default: return RANGER_RANGE_TARGET_WINDOW_MS;
    }
  })();
  const adjustment = course === "legacy" ? 0 : RANGER_RANGE_COURSE_META[course].windowAdjustmentMs;
  return Math.max(900, base + adjustment);
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
  course: RangerRangeCourse | "legacy";
  targetStartsAt: number;
  targetRevealsAt: number;
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
