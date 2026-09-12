export const GAME_MODES = {
  recon: { label: "Recon", size: 10, mines: 15, xp: 50, parts: 1 },
  patrol: { label: "Patrol", size: 15, mines: 40, xp: 100, parts: 2 },
  survival: { label: "Survival", size: 20, mines: 80, xp: 150, parts: 3 },
} as const;
export type GameMode = keyof typeof GAME_MODES;
export type GameCell = "hidden" | "flag" | "mine" | number;
export type GameView = {
  id: string; mode: GameMode; version: number;
  status: "playing" | "won" | "lost" | "expired";
  cells: GameCell[][]; startedAt: number; expiresAt: number;
};
export const WORKSHOP_PART_COST = 12;
export const WORKSHOP_STAGES = ["Power unit", "Signal array", "Field relay"] as const;
export const HUB_BADGES = [
  { name: "First Signal", xp: 50, position: "0% 0%" },
  { name: "Field Engineer", xp: 150, position: "50% 0%" },
  { name: "Pathfinder", xp: 450, position: "100% 0%" },
  { name: "Storm Runner", xp: 900, position: "0% 100%" },
  { name: "Relay Commander", xp: 1800, position: "50% 100%" },
  { name: "Network Legend", xp: 3600, position: "100% 100%" },
] as const;
export type HubSummary = {
  username: string; xp: number; parts: number; streak: number; assemblies: number;
  today: GameMode[]; resetAt: number;
  history: { kind: string; xp: number; parts: number; created_at: number }[];
};
export type HubPayload = { serverTime: number; summary: HubSummary; game: GameView | null };
