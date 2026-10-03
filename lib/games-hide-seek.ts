export const HIDE_SEEK_REWARD = { xp: 60, parts: 2 } as const;
export const HIDE_SEEK_TARGET_COUNT = 4;
export const HIDE_SEEK_MAX_MISSES = 6;

export type HideSeekTarget = {
  id: string;
  x: number;
  y: number;
  found: boolean;
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
  targets: HideSeekTarget[];
};

export type HideSeekPayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: HideSeekGame | null;
};
