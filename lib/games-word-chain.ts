export const WORD_CHAIN_REWARD = { xp: 25, parts: 1 } as const;

export type WordChainEntry = {
  id: string;
  word: string;
  player: string;
  turn: number;
  createdAt: number;
};

export type WordChainRound = {
  id: string;
  currentWord: string;
  requiredLetter: string;
  version: number;
  canPlay: boolean;
  entries: WordChainEntry[];
};

export type WordChainPayload = {
  serverTime: number;
  rewardedToday: boolean;
  round: WordChainRound;
};
