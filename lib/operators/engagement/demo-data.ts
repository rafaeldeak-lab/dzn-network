import { buildOperatorLeaderboardRows } from "./leaderboards";
import { createOperatorEngagementState } from "./progress";
import { OPERATOR_ACHIEVEMENTS } from "./rewards";
import type { OperatorCommunityChallenge, OperatorEngagementState, OperatorLeaderboardPeriod, OperatorServerCommunityProfile } from "./types";

export const OPERATOR_DEMO_NOW = "2026-06-01T12:00:00.000Z";

export const DEMO_OPERATOR_PLAYERS = [
  { id: "rafael", displayName: "Rafael", publicRef: "op-rafael", xp: 4860, linkedServerSlug: "pandora-dayz", linkedServerName: "Pandora DayZ" },
  { id: "viperx", displayName: "ViperX", publicRef: "op-viperx", xp: 8220, linkedServerSlug: "nuketown-deathmatch", linkedServerName: "NukeTown Deathmatch" },
  { id: "ironwolf", displayName: "IronWolf", publicRef: "op-ironwolf", xp: 7440, linkedServerSlug: "pandora-dayz", linkedServerName: "Pandora DayZ" },
  { id: "ghostz", displayName: "GhostZ", publicRef: "op-ghostz", xp: 4860, linkedServerSlug: "chernarus-traders", linkedServerName: "Chernarus Traders" },
  { id: "nightshade", displayName: "NightShade", publicRef: "op-nightshade", xp: 10880, linkedServerSlug: "pandora-dayz", linkedServerName: "Pandora DayZ" },
];

export const DEMO_OPERATOR_STATE: OperatorEngagementState = createOperatorEngagementState({
  playerId: "rafael",
  xp: 4860,
  completedChallengeIds: ["daily-check-in", "daily-open-studio", "daily-view-leaderboard", "weekly-profile-views"],
  claimedRewardIds: ["streak-day-1-xp", "streak-day-2-title", "rank-recruit-reward", "rank-scout-reward"],
  dailyStreak: {
    current: 4,
    longest: 9,
    lastCheckInDate: "2026-06-01",
    claimedCycleDays: [1, 2, 3, 4],
  },
  challengeProgress: {
    "daily-check-in": { challengeId: "daily-check-in", value: 1, completedAt: OPERATOR_DEMO_NOW },
    "daily-open-studio": { challengeId: "daily-open-studio", value: 1, completedAt: OPERATOR_DEMO_NOW },
    "daily-view-profile": { challengeId: "daily-view-profile", value: 0 },
    "daily-view-leaderboard": { challengeId: "daily-view-leaderboard", value: 1, completedAt: OPERATOR_DEMO_NOW },
    "daily-confirmed-kills": { challengeId: "daily-confirmed-kills", value: 3 },
    "weekly-profile-views": { challengeId: "weekly-profile-views", value: 3, completedAt: OPERATOR_DEMO_NOW },
    "weekly-25-kills": { challengeId: "weekly-25-kills", value: 18 },
    "seasonal-30-dailies": { challengeId: "seasonal-30-dailies", value: 12 },
    "community-kills": { challengeId: "community-kills", value: 340 },
  },
  recentActivity: [
    { id: "activity-rank", label: "Reached Sentinel watch range preview", occurredAt: "2026-06-01T11:00:00.000Z", type: "rank_reached" },
    { id: "activity-challenge", label: "Completed View an Operator leaderboard", occurredAt: "2026-06-01T10:30:00.000Z", type: "challenge_completed" },
    { id: "activity-profile", label: "Viewed IronWolf Operator profile", occurredAt: "2026-06-01T10:00:00.000Z", type: "profile_viewed" },
  ],
});

export function getDemoLeaderboardRows(period: OperatorLeaderboardPeriod = "weekly") {
  return buildOperatorLeaderboardRows(DEMO_OPERATOR_PLAYERS, period, "rafael");
}

export function getDemoCommunityChallenges(): OperatorCommunityChallenge[] {
  return [
    {
      id: "pandora-community-kills",
      title: "Pandora confirmed-kill signal",
      metric: "server_community_kills",
      target: 500,
      progress: 340,
      reward: {
        id: "pandora-signal-emblem",
        displayName: "Pandora Signal Emblem",
        description: "Fixed community DZN Operator Reward.",
        kind: "emblem",
        exactContents: "Pandora Signal Emblem",
        cosmeticOnly: true,
        accessibilityLabel: "Pandora Signal Emblem, fixed cosmetic community reward.",
      },
      reset: "weekly_utc",
      source: "future_server_aggregate",
    },
    {
      id: "pandora-community-travel",
      title: "Pandora route sweep",
      metric: "server_community_distance_m",
      target: 1_000_000,
      progress: 645_000,
      reward: {
        id: "pandora-grid-background",
        displayName: "Pandora Grid Background",
        description: "Fixed community DZN Field Pack.",
        kind: "background",
        exactContents: "Pandora Grid Background",
        cosmeticOnly: true,
        accessibilityLabel: "Pandora Grid Background, fixed cosmetic community reward.",
      },
      reset: "weekly_utc",
      source: "future_server_aggregate",
    },
  ];
}

export function getDemoServerProfiles(): OperatorServerCommunityProfile[] {
  const rows = getDemoLeaderboardRows("seasonal");
  return [
    {
      slug: "pandora-dayz",
      serverName: "Pandora DayZ",
      mapName: "Chernarus",
      category: "Survival",
      playerSlots: "60 slots",
      communityRank: "Network Champion",
      seasonPosition: 2,
      weeklyXp: 18420,
      seasonalXp: 77200,
      activeOperators: 48,
      topOperators: rows.filter((row) => row.linkedServerSlug === "pandora-dayz").slice(0, 3),
      communityChallenges: getDemoCommunityChallenges(),
      recentAchievements: OPERATOR_ACHIEVEMENTS.slice(0, 3),
      publicServerHref: "/servers/pandora-dayz",
    },
    {
      slug: "nuketown-deathmatch",
      serverName: "NukeTown Deathmatch",
      mapName: "Deathmatch Arena",
      category: "PvP",
      playerSlots: "32 slots",
      communityRank: "Sentinel",
      seasonPosition: 5,
      weeklyXp: 9400,
      seasonalXp: 42100,
      activeOperators: 27,
      topOperators: rows.filter((row) => row.linkedServerSlug === "nuketown-deathmatch").slice(0, 3),
      communityChallenges: getDemoCommunityChallenges().slice(0, 1),
      recentAchievements: OPERATOR_ACHIEVEMENTS.slice(3, 5),
      publicServerHref: "/servers/nuketown-deathmatch",
    },
  ];
}
