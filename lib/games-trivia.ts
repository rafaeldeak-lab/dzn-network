export const TRIVIA_DIFFICULTIES = {
  recruit: { label: "Recruit", passMark: 4, xp: 40, parts: 1 },
  operator: { label: "Operator", passMark: 4, xp: 80, parts: 2 },
  specialist: { label: "Specialist", passMark: 5, xp: 120, parts: 3 },
} as const;

export type TriviaDifficulty = keyof typeof TRIVIA_DIFFICULTIES;
export type TriviaQuestionView = { number: number; total: number; prompt: string; choices: string[] };
export type TriviaGameView = {
  id: string;
  difficulty: TriviaDifficulty;
  version: number;
  status: "playing" | "passed" | "failed" | "expired";
  correct: number;
  question: TriviaQuestionView | null;
  startedAt: number;
  expiresAt: number;
};
export type TriviaPayload = {
  serverTime: number;
  game: TriviaGameView | null;
  rewardedToday: TriviaDifficulty[];
};
