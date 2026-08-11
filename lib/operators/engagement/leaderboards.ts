import { getOperatorRankForXp } from "./ranks";
import type { OperatorLeaderboardPeriod, OperatorLeaderboardRow } from "./types";

type LeaderboardInput = {
  id: string;
  displayName: string;
  publicRef: string;
  xp: number;
  linkedServerSlug: string;
  linkedServerName: string;
};

export function buildOperatorLeaderboardRows(
  players: LeaderboardInput[],
  period: OperatorLeaderboardPeriod,
  currentPlayerId = "rafael",
): OperatorLeaderboardRow[] {
  const periodSalt = periodWeight(period);
  return players
    .map((player) => ({
      ...player,
      xp: Math.max(0, Math.floor(player.xp * periodSalt)),
    }))
    .sort((left, right) => {
      if (right.xp !== left.xp) return right.xp - left.xp;
      if (left.displayName !== right.displayName) return left.displayName.localeCompare(right.displayName);
      return left.id.localeCompare(right.id);
    })
    .map((player, index) => ({
      id: player.id,
      displayName: player.displayName,
      publicRef: player.publicRef,
      rankName: getOperatorRankForXp(player.xp).displayName,
      xp: player.xp,
      position: index + 1,
      operatorCardLabel: `${player.displayName} DZN Operator Card`,
      linkedServerSlug: player.linkedServerSlug,
      linkedServerName: player.linkedServerName,
      highlighted: player.id === currentPlayerId,
    }));
}

function periodWeight(period: OperatorLeaderboardPeriod): number {
  if (period === "weekly") return 0.28;
  if (period === "monthly") return 0.58;
  if (period === "seasonal") return 0.82;
  return 1;
}
