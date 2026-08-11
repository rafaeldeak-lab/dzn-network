import { OPERATOR_STREAK_REWARDS } from "./rewards";
import { daysBetweenUtcDates, getUtcDateKey, isFutureTimestamp } from "./reset-windows";
import type { OperatorDailyStreak, OperatorEngagementState } from "./types";

export function calculateOperatorDailyStreak(state: OperatorEngagementState, now: string | Date): OperatorDailyStreak {
  const today = getUtcDateKey(now);
  const last = state.dailyStreak.lastCheckInDate;
  if (!today || !last) return { ...state.dailyStreak };
  const delta = daysBetweenUtcDates(last, today);
  if (delta === null || delta <= 1) return { ...state.dailyStreak };
  return {
    current: 0,
    longest: Math.max(0, state.dailyStreak.longest),
    lastCheckInDate: last,
    claimedCycleDays: [],
  };
}

export function recordOperatorDailyCheckIn(state: OperatorEngagementState, now: string | Date): OperatorEngagementState {
  const today = getUtcDateKey(now);
  if (!today || isFutureTimestamp(`${today}T00:00:00.000Z`, now)) return state;

  const last = state.dailyStreak.lastCheckInDate;
  if (last === today) return state;

  const delta = last ? daysBetweenUtcDates(last, today) : null;
  const nextCurrent = delta === 1 ? state.dailyStreak.current + 1 : 1;
  const cycleDay = ((nextCurrent - 1) % OPERATOR_STREAK_REWARDS.length) + 1;
  const reward = OPERATOR_STREAK_REWARDS[cycleDay - 1];
  const rewardIds = reward ? appendUnique(state.claimedRewardIds, reward.id) : state.claimedRewardIds;
  const xpBonus = reward?.kind === "xp" ? Number.parseInt(reward.exactContents, 10) || 0 : 0;

  return {
    ...state,
    xp: Math.max(0, state.xp + xpBonus),
    claimedRewardIds: rewardIds,
    dailyStreak: {
      current: nextCurrent,
      longest: Math.max(nextCurrent, state.dailyStreak.longest),
      lastCheckInDate: today,
      claimedCycleDays: appendUniqueNumber(delta === 1 ? state.dailyStreak.claimedCycleDays : [], cycleDay),
    },
    recentActivity: boundActivity([
      {
        id: `check-in-${today}`,
        label: `Daily check-in claimed: ${reward?.displayName ?? "DZN Field Signal"}`,
        occurredAt: `${today}T00:00:00.000Z`,
        type: "check_in",
      },
      ...state.recentActivity,
    ]),
  };
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function appendUniqueNumber(values: number[], value: number): number[] {
  return values.includes(value) ? values : [...values, value];
}

function boundActivity<T>(items: T[]): T[] {
  return items.slice(0, 12);
}
