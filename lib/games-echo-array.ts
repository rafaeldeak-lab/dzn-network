export const ECHO_ARRAY_NODES = ["north", "east", "south", "west"] as const;
export type EchoArrayNode = (typeof ECHO_ARRAY_NODES)[number];

export const ECHO_ARRAY_STAGE_LENGTHS = [4, 6, 8] as const;
export const ECHO_ARRAY_MAX_ERRORS = 2;
export const ECHO_ARRAY_REWARD = { xp: 110, parts: 5 } as const;
export const ECHO_ARRAY_TTL_MS = 3 * 60 * 1_000;
export const ECHO_ARRAY_START_COOLDOWN_MS = 5_000;
export const ECHO_ARRAY_CUE_LEAD_MS = 600;
export const ECHO_ARRAY_CUE_INTERVAL_MS = 540;
export const ECHO_ARRAY_CUE_TAIL_MS = 700;
export const ECHO_ARRAY_MIN_INPUT_INTERVAL_MS = 180;

export type EchoArrayIntensity = "scan" | "echo" | "blackout";

export function echoArrayIntensity(stage: number): EchoArrayIntensity {
  if (stage >= ECHO_ARRAY_STAGE_LENGTHS.length) return "blackout";
  return stage === 2 ? "echo" : "scan";
}

/** The API controls each stage's reveal tempo; the browser only renders it. */
export function echoArrayCueIntervalMs(stage: number) {
  switch (echoArrayIntensity(stage)) {
    case "echo": return 430;
    case "blackout": return 330;
    default: return ECHO_ARRAY_CUE_INTERVAL_MS;
  }
}

export type EchoArrayStatus = "playing" | "won" | "failed" | "expired";
export type EchoArrayPhase = "revealing" | "input";

export type EchoArrayGame = {
  id: string;
  version: number;
  status: EchoArrayStatus;
  phase: EchoArrayPhase | null;
  stage: number;
  totalStages: number;
  sequenceLength: number;
  intensity: EchoArrayIntensity;
  cueIntervalMs: number;
  inputIndex: number;
  errors: number;
  maxErrors: number;
  cue: EchoArrayNode[] | null;
  cueStartedAt: number;
  cueEndsAt: number;
  startedAt: number;
  expiresAt: number;
};

export type EchoArrayPayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: EchoArrayGame | null;
};
