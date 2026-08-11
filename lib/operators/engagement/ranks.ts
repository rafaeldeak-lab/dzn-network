import { reward } from "./rewards";
import type { OperatorRank, OperatorRankProgress } from "./types";

export const OPERATOR_RANKS: OperatorRank[] = [
  rank("recruit", "Recruit", 1, 0, "cyan-dot", "DZN Recruit title"),
  rank("scout", "Scout", 2, 250, "cyan-scan", "Scout profile accent"),
  rank("tracker", "Tracker", 3, 650, "emerald-footprint", "Tracker emblem"),
  rank("pathfinder", "Pathfinder", 4, 1200, "emerald-path", "Pathfinder pose"),
  rank("vanguard", "Vanguard", 5, 2000, "orange-chevron", "Vanguard frame"),
  rank("warden", "Warden", 6, 3100, "orange-shield", "Warden background"),
  rank("sentinel", "Sentinel", 7, 4550, "violet-watch", "Sentinel title"),
  rank("commander", "Commander", 8, 6400, "violet-command", "Commander emblem"),
  rank("elite-commander", "Elite Commander", 9, 8700, "cyan-crown", "Elite Commander frame"),
  rank("network-champion", "Network Champion", 10, 11500, "emerald-crown", "Network Champion showcase slot"),
  rank("network-legend", "Network Legend", 11, 15000, "violet-halo", "Network Legend background"),
  rank("dzn-icon", "DZN Icon", 12, 19500, "white-halo", "DZN Icon profile accent"),
];

export function getOperatorRankForXp(xp: number): OperatorRank {
  const safeXp = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  return OPERATOR_RANKS.reduce((current, rankEntry) => (rankEntry.minXp <= safeXp ? rankEntry : current), OPERATOR_RANKS[0]);
}

export function getNextOperatorRank(xp: number): OperatorRank | null {
  const safeXp = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  return OPERATOR_RANKS.find((rankEntry) => rankEntry.minXp > safeXp) ?? null;
}

export function getOperatorRankProgress(xp: number): OperatorRankProgress {
  const safeXp = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  const currentRank = getOperatorRankForXp(safeXp);
  const nextRank = getNextOperatorRank(safeXp);
  const currentFloor = currentRank.minXp;
  const nextFloor = nextRank?.minXp ?? currentFloor;
  const span = Math.max(1, nextFloor - currentFloor);
  const progressPercent = nextRank ? Math.min(100, Math.max(0, Math.round(((safeXp - currentFloor) / span) * 100))) : 100;

  return {
    currentRank,
    nextRank,
    totalXp: safeXp,
    progressPercent,
    xpRemaining: nextRank ? Math.max(0, nextRank.minXp - safeXp) : 0,
    nextReward: nextRank?.reward ?? null,
  };
}

function rank(id: string, displayName: string, level: number, minXp: number, iconTreatment: string, exactReward: string): OperatorRank {
  return {
    id,
    displayName,
    level,
    minXp,
    iconTreatment,
    accessibilityLabel: `${displayName} Operator rank begins at ${minXp} XP.`,
    reward: reward(`rank-${id}-reward`, `${displayName} DZN Rank Reward`, exactReward, rewardKindFor(exactReward), exactReward),
  };
}

function rewardKindFor(value: string) {
  if (/frame/i.test(value)) return "frame" as const;
  if (/background/i.test(value)) return "background" as const;
  if (/pose/i.test(value)) return "pose" as const;
  if (/emblem/i.test(value)) return "emblem" as const;
  if (/accent/i.test(value)) return "profile_accent" as const;
  if (/slot/i.test(value)) return "showcase_slot" as const;
  return "title" as const;
}
