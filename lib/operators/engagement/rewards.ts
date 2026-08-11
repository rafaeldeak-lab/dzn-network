import type { OperatorAchievement, OperatorReward } from "./types";

export const OPERATOR_STREAK_REWARDS = [
  reward("streak-day-1-xp", "Day 1 Field Signal", "50 Operator XP", "xp", "50 Operator XP"),
  reward("streak-day-2-title", "DZN Recruit Title", "DZN Recruit title", "title", "DZN Recruit title"),
  reward("streak-day-3-xp", "Day 3 Field Signal", "100 Operator XP", "xp", "100 Operator XP"),
  reward("streak-day-4-background", "Signal Grid Background", "Signal Grid background", "background", "Signal Grid background"),
  reward("streak-day-5-xp", "Day 5 Field Signal", "150 Operator XP", "xp", "150 Operator XP"),
  reward("streak-day-6-pose", "Pathfinder Pose", "Pathfinder pose", "pose", "Pathfinder pose"),
  reward("streak-day-7-frame", "Seven-Day Vanguard Frame", "Seven-Day Vanguard frame", "frame", "Seven-Day Vanguard frame"),
] as const satisfies readonly OperatorReward[];

export const OPERATOR_ACHIEVEMENTS: OperatorAchievement[] = [
  achievement("first-check-in", "First Check-In", "Checked in to DZN Operators for the first time.", "cyan-ring", "Complete one daily check-in."),
  achievement("seven-day-vanguard", "Seven-Day Vanguard", "Completed the seven-day Operator streak cycle.", "emerald-chevron", "Claim the day-seven streak reward."),
  achievement("challenge-runner", "Challenge Runner", "Completed a set of daily Operator challenges.", "orange-grid", "Complete five daily challenges."),
  achievement("achievement-pathfinder", "Pathfinder", "Built consistent exploration progress.", "violet-path", "Reach 100 aggregate explored cells in a season."),
  achievement("event-entrant", "Event Entrant", "Entered DZN competitive events through the season.", "amber-bracket", "Enter two DZN events."),
  achievement("community-contributor", "Community Contributor", "Contributed to a server community target.", "emerald-signal", "Contribute to a server community challenge."),
  achievement("network-regular", "Network Regular", "Returned across multiple reset windows.", "cyan-pulse", "Check in across four UTC weeks."),
  achievement("operator-spotlight", "Operator Spotlight", "Earned a presentation-only DZN Spotlight.", "white-star", "Finish in a weekly top Operator row."),
];

export function reward(
  id: string,
  displayName: string,
  description: string,
  kind: OperatorReward["kind"],
  exactContents: string,
): OperatorReward {
  return {
    id,
    displayName,
    description,
    kind,
    exactContents,
    cosmeticOnly: true,
    accessibilityLabel: `${displayName}: ${exactContents}. Cosmetic only.`,
  };
}

function achievement(
  id: string,
  title: string,
  description: string,
  iconTreatment: string,
  unlockCondition: string,
): OperatorAchievement {
  return {
    id,
    title,
    description,
    iconTreatment,
    unlockCondition,
    accessibilityLabel: `${title}: ${unlockCondition}. Cosmetic-only achievement.`,
  };
}
