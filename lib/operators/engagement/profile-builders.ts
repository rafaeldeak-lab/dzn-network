import { getDemoLeaderboardRows, getDemoServerProfiles, OPERATOR_DEMO_NOW } from "./demo-data";
import { getOperatorRankProgress } from "./ranks";
import { OPERATOR_ACHIEVEMENTS } from "./rewards";
import type { OperatorPlayerProfile, OperatorServerCommunityProfile } from "./types";

export function buildOperatorPlayerProfile(playerId: string): OperatorPlayerProfile | null {
  const rows = getDemoLeaderboardRows("all_time");
  const row = rows.find((candidate) => candidate.id === playerId || candidate.publicRef === playerId);
  if (!row) return null;
  const rank = getOperatorRankProgress(row.xp);

  return {
    id: row.id,
    displayName: row.displayName,
    publicRef: row.publicRef,
    linkedServerName: row.linkedServerName,
    linkedServerSlug: row.linkedServerSlug,
    totalXp: row.xp,
    currentStreak: row.id === "rafael" ? 4 : 2 + row.position,
    favouriteLoadoutLabel: `${row.displayName} Signal Loadout`,
    earnedTitles: [rank.currentRank.displayName, "DZN Field Regular"],
    achievements: OPERATOR_ACHIEVEMENTS.slice(0, Math.min(5, 2 + row.position)),
    recentActivity: [
      { id: `${row.id}-activity-1`, label: "Completed a fixed Operator challenge", occurredAt: OPERATOR_DEMO_NOW, type: "challenge_completed" },
      { id: `${row.id}-activity-2`, label: "Viewed DZN Operator leaderboard", occurredAt: "2026-06-01T09:00:00.000Z", type: "profile_viewed" },
    ],
    dailyCompletionPercent: Math.min(100, 40 + row.position * 8),
    weeklyCompletionPercent: Math.min(100, 30 + row.position * 7),
    seasonalCompletionPercent: Math.min(100, 24 + row.position * 5),
    leaderboardPositions: {
      weekly: getDemoLeaderboardRows("weekly").find((candidate) => candidate.id === row.id)?.position,
      monthly: getDemoLeaderboardRows("monthly").find((candidate) => candidate.id === row.id)?.position,
      seasonal: getDemoLeaderboardRows("seasonal").find((candidate) => candidate.id === row.id)?.position,
      all_time: row.position,
    },
    combatSummary: {
      confirmedKills: 42 + row.position * 18,
      confirmedDeaths: 8 + row.position * 3,
      longestKillM: 320 + row.position * 24,
      travelKm: 18 + row.position * 11,
      exploredCells: 12 + row.position * 9,
    },
  };
}

export function buildOperatorServerCommunityProfile(serverSlug: string): OperatorServerCommunityProfile | null {
  return getDemoServerProfiles().find((server) => server.slug === serverSlug) ?? null;
}
