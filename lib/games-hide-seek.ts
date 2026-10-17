export const HIDE_SEEK_REWARD = { xp: 60, parts: 2 } as const;
export const HIDE_SEEK_TARGET_COUNT = 4;
export const HIDE_SEEK_MAX_MISSES = 6;
export type HideSeekScene = "legacy" | "recon-v2";

export type HideSeekSignalBrief = {
  slot: number;
  clue: string;
  found: boolean;
};

export type HideSeekRecoveredSignal = {
  slot: number;
  x: number;
  y: number;
};

export type HideSeekGame = {
  id: string;
  version: number;
  status: "playing" | "won" | "failed" | "expired";
  foundCount: number;
  misses: number;
  maxMisses: number;
  startedAt: number;
  expiresAt: number;
  scene: HideSeekScene;
  targetCount: number;
  clues: HideSeekSignalBrief[];
  recoveredSignals: HideSeekRecoveredSignal[];
  lastScan: "signal-acquired" | "empty" | null;
};

export type HideSeekPayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: HideSeekGame | null;
};
