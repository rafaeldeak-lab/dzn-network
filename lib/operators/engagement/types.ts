export type OperatorChallengeCategory = "daily" | "weekly" | "seasonal" | "community";
export type OperatorChallengeStatus = "locked" | "active" | "completed" | "claimed";
export type OperatorProgressPrivacy = "public_aggregate" | "public_profile" | "private_preview";
export type OperatorChallengeSource = "website" | "future_adm" | "future_event_platform" | "future_server_aggregate";
export type OperatorLeaderboardPeriod = "weekly" | "monthly" | "seasonal" | "all_time";
export type OperatorRewardKind = "xp" | "title" | "frame" | "background" | "pose" | "emblem" | "profile_accent" | "showcase_slot";

export type OperatorChallengeMetric =
  | "operator_daily_check_in"
  | "operators_page_visit"
  | "character_studio_visit"
  | "operator_profile_view"
  | "operator_leaderboard_view"
  | "confirmed_kills"
  | "confirmed_deaths"
  | "longest_kill_m"
  | "distance_travelled_m"
  | "on_foot_distance_m"
  | "explored_cells"
  | "server_session_minutes"
  | "event_entries"
  | "event_completions"
  | "event_wins"
  | "pvp_encounters"
  | "server_community_kills"
  | "server_community_distance_m"
  | "server_community_event_entries";

export type OperatorReward = {
  id: string;
  displayName: string;
  description: string;
  kind: OperatorRewardKind;
  exactContents: string;
  cosmeticOnly: true;
  accessibilityLabel: string;
};

export type OperatorChallenge = {
  id: string;
  title: string;
  description: string;
  category: OperatorChallengeCategory;
  metric: OperatorChallengeMetric;
  target: number;
  xpReward: number;
  reward?: OperatorReward;
  reset: "daily_utc" | "weekly_utc" | "seasonal_utc";
  startsAt: string;
  endsAt: string;
  privacy: OperatorProgressPrivacy;
  source: OperatorChallengeSource;
  accessibilityLabel: string;
};

export type OperatorChallengeProgress = {
  challengeId: string;
  value: number;
  completedAt?: string;
  claimedAt?: string;
};

export type OperatorEngagementEvent = {
  id: string;
  metric: OperatorChallengeMetric;
  amount: number;
  occurredAt: string;
  source: OperatorChallengeSource;
};

export type OperatorXpLedgerEntry = {
  id: string;
  sourceId: string;
  xp: number;
  awardedAt: string;
  label: string;
};

export type OperatorRank = {
  id: string;
  displayName: string;
  level: number;
  minXp: number;
  iconTreatment: string;
  accessibilityLabel: string;
  reward: OperatorReward;
};

export type OperatorRankProgress = {
  currentRank: OperatorRank;
  nextRank: OperatorRank | null;
  totalXp: number;
  progressPercent: number;
  xpRemaining: number;
  nextReward: OperatorReward | null;
};

export type OperatorRewardClaim = {
  rewardId: string;
  claimedAt: string;
};

export type OperatorDailyStreak = {
  current: number;
  longest: number;
  lastCheckInDate: string | null;
  claimedCycleDays: number[];
};

export type OperatorRecentActivity = {
  id: string;
  label: string;
  occurredAt: string;
  type: "challenge_completed" | "reward_claimed" | "rank_reached" | "profile_viewed" | "check_in";
};

export type OperatorAchievement = {
  id: string;
  title: string;
  description: string;
  iconTreatment: string;
  unlockCondition: string;
  accessibilityLabel: string;
};

export type OperatorEngagementState = {
  version: 1;
  note: "preview_only_non_authoritative";
  playerId: string;
  xp: number;
  challengeProgress: Record<string, OperatorChallengeProgress>;
  completedChallengeIds: string[];
  claimedRewardIds: string[];
  dailyStreak: OperatorDailyStreak;
  xpLedger: OperatorXpLedgerEntry[];
  recentActivity: OperatorRecentActivity[];
  selectedLeaderboardPeriod: OperatorLeaderboardPeriod;
  processedEventIds: string[];
  serverCommunityId: string;
};

export type OperatorLeaderboardRow = {
  id: string;
  displayName: string;
  publicRef: string;
  rankName: string;
  xp: number;
  position: number;
  operatorCardLabel: string;
  linkedServerSlug: string;
  linkedServerName: string;
  highlighted?: boolean;
};

export type OperatorPlayerProfile = {
  id: string;
  displayName: string;
  publicRef: string;
  linkedServerName: string;
  linkedServerSlug: string;
  totalXp: number;
  currentStreak: number;
  favouriteLoadoutLabel: string;
  earnedTitles: string[];
  achievements: OperatorAchievement[];
  recentActivity: OperatorRecentActivity[];
  dailyCompletionPercent: number;
  weeklyCompletionPercent: number;
  seasonalCompletionPercent: number;
  leaderboardPositions: Partial<Record<OperatorLeaderboardPeriod, number>>;
  combatSummary: {
    confirmedKills: number;
    confirmedDeaths: number;
    longestKillM: number;
    travelKm: number;
    exploredCells: number;
  };
};

export type OperatorCommunityChallenge = {
  id: string;
  title: string;
  metric: OperatorChallengeMetric;
  target: number;
  progress: number;
  reward: OperatorReward;
  reset: "weekly_utc" | "seasonal_utc";
  source: "future_server_aggregate";
};

export type OperatorServerCommunityProfile = {
  slug: string;
  serverName: string;
  mapName: string;
  category: string;
  playerSlots: string;
  communityRank: string;
  seasonPosition: number;
  weeklyXp: number;
  seasonalXp: number;
  activeOperators: number;
  topOperators: OperatorLeaderboardRow[];
  communityChallenges: OperatorCommunityChallenge[];
  recentAchievements: OperatorAchievement[];
  publicServerHref: string;
};

export const OPERATOR_ENGAGEMENT_PROHIBITED_KEYS = [
  "scoreMultiplier",
  "xpMultiplier",
  "premiumXpMultiplier",
  "rankingBoost",
  "matchmakingWeight",
  "voteMultiplier",
  "rewardOdds",
  "probability",
  "cashReward",
  "monetaryValue",
  "paidSkip",
  "streakProtectionPurchase",
  "spinWheel",
  "lootBox",
] as const;
