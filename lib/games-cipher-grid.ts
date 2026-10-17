export const CIPHER_GRID_WORD_LENGTH = 5;
export const CIPHER_GRID_MAX_ATTEMPTS = 5;
export const CIPHER_GRID_LEGACY_MAX_ATTEMPTS = 6;
export const CIPHER_GRID_SPECIALIST_WORD_LENGTH = 6;
export const CIPHER_GRID_SPECIALIST_MAX_ATTEMPTS = 4;
export const CIPHER_GRID_REWARD = { xp: 100, parts: 4 } as const;
export const CIPHER_GRID_TTL_MS = 5 * 60 * 1_000;

export type CipherGridMark = "correct" | "present" | "absent";
export type CipherGridDifficulty = "field" | "specialist";
export type CipherGridAttempt = { guess: string; marks: CipherGridMark[] };
export type CipherGridGame = {
  id: string;
  version: number;
  status: "playing" | "won" | "failed" | "expired";
  attempts: CipherGridAttempt[];
  answerLength: number;
  maxAttempts: number;
  difficulty: CipherGridDifficulty;
  startedAt: number;
  expiresAt: number;
};
export type CipherGridPayload = {
  serverTime: number;
  rewardedToday: boolean;
  rewardGranted: boolean;
  game: CipherGridGame | null;
};
