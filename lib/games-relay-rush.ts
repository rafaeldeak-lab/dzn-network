export const RELAY_RUSH_LANES = ["left", "centre", "right"] as const;
export type RelayRushLane = (typeof RELAY_RUSH_LANES)[number];

export const RELAY_RUSH_REWARD = { xp: 90, parts: 3 } as const;
export const RELAY_RUSH_TOTAL_PULSES = 12;
export const RELAY_RUSH_MAX_MISSES = 3;
export const RELAY_RUSH_START_DELAY_MS = 1_000;
export const RELAY_RUSH_PULSE_INTERVAL_MS = 900;
export const RELAY_RUSH_MIN_ACTION_INTERVAL_MS = 500;
export const RELAY_RUSH_TTL_MS = 2 * 60 * 1_000;

export type RelayRushGame = {
  id: string;
  version: number;
  status: "playing" | "won" | "failed" | "expired";
  pulsesCleared: number;
  totalPulses: number;
  misses: number;
  maxMisses: number;
  nextLane: RelayRushLane | null;
  nextAt: number | null;
  startedAt: number;
  expiresAt: number;
};

export type RelayRushPayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: RelayRushGame | null;
};
