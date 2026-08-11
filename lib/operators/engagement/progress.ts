import { getOperatorChallengeCatalog } from "./challenges";
import { getOperatorRankProgress } from "./ranks";
import { OPERATOR_STREAK_REWARDS } from "./rewards";
import { isFutureTimestamp } from "./reset-windows";
import type {
  OperatorChallenge,
  OperatorChallengeProgress,
  OperatorChallengeStatus,
  OperatorEngagementEvent,
  OperatorEngagementState,
  OperatorReward,
} from "./types";

export const EMPTY_OPERATOR_ENGAGEMENT_STATE: OperatorEngagementState = {
  version: 1,
  note: "preview_only_non_authoritative",
  playerId: "rafael",
  xp: 0,
  challengeProgress: {},
  completedChallengeIds: [],
  claimedRewardIds: [],
  dailyStreak: {
    current: 0,
    longest: 0,
    lastCheckInDate: null,
    claimedCycleDays: [],
  },
  xpLedger: [],
  recentActivity: [],
  selectedLeaderboardPeriod: "weekly",
  processedEventIds: [],
  serverCommunityId: "pandora-dayz",
};

export function createOperatorEngagementState(overrides: Partial<OperatorEngagementState> = {}): OperatorEngagementState {
  return normalizeOperatorEngagementState({
    ...EMPTY_OPERATOR_ENGAGEMENT_STATE,
    ...overrides,
    dailyStreak: {
      ...EMPTY_OPERATOR_ENGAGEMENT_STATE.dailyStreak,
      ...overrides.dailyStreak,
    },
  });
}

export function normalizeOperatorEngagementState(state: OperatorEngagementState): OperatorEngagementState {
  const catalogIds = new Set(getOperatorChallengeCatalog().map((challenge) => challenge.id));
  const progress = Object.fromEntries(
    Object.entries(state.challengeProgress)
      .filter(([challengeId]) => catalogIds.has(challengeId))
      .map(([challengeId, value]) => [challengeId, normalizeProgress(challengeId, value)]),
  );

  return {
    version: 1,
    note: "preview_only_non_authoritative",
    playerId: cleanId(state.playerId, "rafael"),
    xp: Math.max(0, Math.floor(Number.isFinite(state.xp) ? state.xp : 0)),
    challengeProgress: progress,
    completedChallengeIds: unique(state.completedChallengeIds.filter((id) => catalogIds.has(id))),
    claimedRewardIds: unique(state.claimedRewardIds.filter(Boolean)).slice(0, 120),
    dailyStreak: {
      current: Math.max(0, Math.floor(state.dailyStreak.current || 0)),
      longest: Math.max(0, Math.floor(state.dailyStreak.longest || 0)),
      lastCheckInDate: /^\d{4}-\d{2}-\d{2}$/.test(state.dailyStreak.lastCheckInDate ?? "") ? state.dailyStreak.lastCheckInDate : null,
      claimedCycleDays: uniqueNumbers(state.dailyStreak.claimedCycleDays.filter((day) => day >= 1 && day <= 7)),
    },
    xpLedger: state.xpLedger.slice(0, 200),
    recentActivity: state.recentActivity.slice(0, 12),
    selectedLeaderboardPeriod: state.selectedLeaderboardPeriod ?? "weekly",
    processedEventIds: unique(state.processedEventIds.filter(Boolean)).slice(-200),
    serverCommunityId: cleanId(state.serverCommunityId, "pandora-dayz"),
  };
}

export function applyOperatorEngagementEvent(
  state: OperatorEngagementState,
  event: OperatorEngagementEvent,
  now: string | Date = event.occurredAt,
): OperatorEngagementState {
  const safeState = normalizeOperatorEngagementState(state);
  if (!event.id || safeState.processedEventIds.includes(event.id)) return safeState;
  if (!Number.isFinite(event.amount) || event.amount <= 0) return safeState;
  if (!Date.parse(event.occurredAt) || isFutureTimestamp(event.occurredAt, now)) return safeState;

  let nextState = {
    ...safeState,
    processedEventIds: [...safeState.processedEventIds, event.id].slice(-200),
    challengeProgress: { ...safeState.challengeProgress },
  };

  for (const challenge of getOperatorChallengeCatalog().filter((candidate) => candidate.metric === event.metric)) {
    const current = nextState.challengeProgress[challenge.id] ?? { challengeId: challenge.id, value: 0 };
    const beforeCompleted = current.value >= challenge.target || nextState.completedChallengeIds.includes(challenge.id);
    const nextProgress = calculateChallengeProgress(challenge, {
      ...current,
      value: current.value + event.amount,
      completedAt: current.completedAt,
    });
    const afterCompleted = nextProgress.value >= challenge.target;
    nextState.challengeProgress[challenge.id] = nextProgress;

    if (afterCompleted && !beforeCompleted) {
      nextState = awardChallengeCompletion(nextState, challenge, event.occurredAt);
    }
  }

  return normalizeOperatorEngagementState(nextState);
}

export function calculateChallengeProgress(challenge: OperatorChallenge, progress: OperatorChallengeProgress): OperatorChallengeProgress {
  const value = Math.min(challenge.target, Math.max(0, Math.floor(Number.isFinite(progress.value) ? progress.value : 0)));
  return {
    challengeId: challenge.id,
    value,
    completedAt: value >= challenge.target ? progress.completedAt ?? challenge.endsAt : progress.completedAt,
    claimedAt: progress.claimedAt,
  };
}

export function getChallengeCompletionState(challenge: OperatorChallenge, progress?: OperatorChallengeProgress): OperatorChallengeStatus {
  if (!progress) return "active";
  if (progress.claimedAt) return "claimed";
  if (progress.value >= challenge.target) return "completed";
  return "active";
}

export function calculateOperatorXp(state: OperatorEngagementState): number {
  return Math.max(0, Math.floor(Number.isFinite(state.xp) ? state.xp : 0));
}

export function getClaimableOperatorRewards(state: OperatorEngagementState): OperatorReward[] {
  const completed = new Set(state.completedChallengeIds);
  const claimed = new Set(state.claimedRewardIds);
  const challengeRewards = getOperatorChallengeCatalog()
    .filter((challenge) => completed.has(challenge.id) && challenge.reward && !claimed.has(challenge.reward.id))
    .map((challenge) => challenge.reward as OperatorReward);
  const rankReward = getOperatorRankProgress(state.xp).nextReward;
  const streakRewards = OPERATOR_STREAK_REWARDS.filter((reward) => !claimed.has(reward.id) && state.dailyStreak.current >= OPERATOR_STREAK_REWARDS.indexOf(reward) + 1);
  return [...challengeRewards, ...streakRewards, ...(rankReward && !claimed.has(rankReward.id) ? [rankReward] : [])];
}

export function claimOperatorRewardPreview(state: OperatorEngagementState, rewardId: string, now = "2026-06-01T00:00:00.000Z"): OperatorEngagementState {
  const safeState = normalizeOperatorEngagementState(state);
  if (!rewardId || safeState.claimedRewardIds.includes(rewardId)) return safeState;
  const knownRewardIds = new Set([
    ...getOperatorChallengeCatalog().flatMap((challenge) => (challenge.reward ? [challenge.reward.id] : [])),
    ...OPERATOR_STREAK_REWARDS.map((reward) => reward.id),
    getOperatorRankProgress(safeState.xp).currentRank.reward.id,
    getOperatorRankProgress(safeState.xp).nextReward?.id ?? "",
  ]);
  if (!knownRewardIds.has(rewardId)) return safeState;
  return normalizeOperatorEngagementState({
    ...safeState,
    claimedRewardIds: [...safeState.claimedRewardIds, rewardId],
    recentActivity: [
      {
        id: `claimed-${rewardId}`,
        label: `Reward claimed: ${rewardId}`,
        occurredAt: now,
        type: "reward_claimed" as const,
      },
      ...safeState.recentActivity,
    ].slice(0, 12),
  });
}

export function assertNoEngagementCompetitiveFields(value: unknown): void {
  const prohibited = ["scoreMultiplier", "xpMultiplier", "rankingBoost", "voteMultiplier", "matchmakingWeight", "rewardOdds", "probability", "cashReward", "spinWheel", "lootBox"];
  const seen = new Set<unknown>();
  function visit(node: unknown, path: string) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (prohibited.includes(key)) throw new Error(`Prohibited engagement field detected at ${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  }
  visit(value, "engagement");
}

function awardChallengeCompletion(state: OperatorEngagementState, challenge: OperatorChallenge, awardedAt: string): OperatorEngagementState {
  if (state.completedChallengeIds.includes(challenge.id)) return state;
  return {
    ...state,
    xp: Math.max(0, state.xp + challenge.xpReward),
    completedChallengeIds: [...state.completedChallengeIds, challenge.id],
    xpLedger: [
      {
        id: `xp-${challenge.id}`,
        sourceId: challenge.id,
        xp: challenge.xpReward,
        awardedAt,
        label: challenge.title,
      },
      ...state.xpLedger,
    ].slice(0, 200),
    recentActivity: [
      {
        id: `completed-${challenge.id}`,
        label: `Challenge completed: ${challenge.title}`,
        occurredAt: awardedAt,
        type: "challenge_completed" as const,
      },
      ...state.recentActivity,
    ].slice(0, 12),
  };
}

function normalizeProgress(challengeId: string, progress: OperatorChallengeProgress): OperatorChallengeProgress {
  return {
    challengeId,
    value: Math.max(0, Math.floor(Number.isFinite(progress.value) ? progress.value : 0)),
    completedAt: cleanOptionalIso(progress.completedAt),
    claimedAt: cleanOptionalIso(progress.claimedAt),
  };
}

function cleanId(value: string, fallback: string): string {
  return /^[a-z0-9-]{2,80}$/.test(value) ? value : fallback;
}

function cleanOptionalIso(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}
