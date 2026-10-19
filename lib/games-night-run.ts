export const NIGHT_RUN_LANES = ["left", "centre", "right"] as const;
export type NightRunLane = (typeof NIGHT_RUN_LANES)[number];

export const NIGHT_RUN_TOTAL_GATES = 9;
export const NIGHT_RUN_MAX_COLLISIONS = 2;
export const NIGHT_RUN_REWARD = { xp: 180, parts: 9 } as const;
export const NIGHT_RUN_TTL_MS = 3 * 60 * 1_000;
export const NIGHT_RUN_START_COOLDOWN_MS = 5_000;
export const NIGHT_RUN_GATE_LEAD_MS = 650;
export const NIGHT_RUN_GATE_WINDOW_MS = 2_450;
export const NIGHT_RUN_RECON_SCAN_GRACE_MS = 700;
export const NIGHT_RUN_SIGNAL_BURST_MS = 900;
export const NIGHT_RUN_MIN_REACTION_MS = 120;
export const NIGHT_RUN_MIN_ACTION_INTERVAL_MS = 145;

export type NightRunIntensity = "recon" | "pursuit" | "lockdown";
export type NightRunRouteSupport = "decoy" | "burst";

export function nightRunIntensity(gateIndex: number, totalGates = NIGHT_RUN_TOTAL_GATES): NightRunIntensity {
  const progress = totalGates > 0 ? gateIndex / totalGates : 0;
  return progress < 0.28 ? "recon" : progress < 0.64 ? "pursuit" : "lockdown";
}

/** The API sends the deadline derived by this difficulty curve. */
export function nightRunGateWindowMs(gateIndex: number, totalGates = NIGHT_RUN_TOTAL_GATES) {
  switch (nightRunIntensity(gateIndex, totalGates)) {
    case "pursuit": return 1_900;
    case "lockdown": return 1_450;
    default: return NIGHT_RUN_GATE_WINDOW_MS;
  }
}

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
  requiresRecon: boolean;
  scannerAvailable: boolean;
  routeControlAvailable: boolean;
  decoyAvailable: boolean;
  decoyArmed: boolean;
  decoySpent: boolean;
  burstAvailable: boolean;
  burstActive: boolean;
  burstSpent: boolean;
  gateStartsAt: number;
  gateEndsAt: number;
  intensity: NightRunIntensity;
  startedAt: number;
  expiresAt: number;
};

export type NightRunPayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: NightRunGame | null;
};
