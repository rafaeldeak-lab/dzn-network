import { reward } from "./rewards";
import { OPERATOR_SEASON_END, OPERATOR_SEASON_START } from "./reset-windows";
import type { OperatorChallenge, OperatorChallengeCategory, OperatorChallengeMetric } from "./types";

const DAILY_START = "2026-06-01T00:00:00.000Z";
const DAILY_END = "2026-06-02T00:00:00.000Z";
const WEEKLY_END = "2026-06-08T00:00:00.000Z";

export const OPERATOR_CHALLENGES: OperatorChallenge[] = [
  daily("daily-check-in", "Check in to DZN Operators", "Return to DZN Operators and claim a daily signal.", "operator_daily_check_in", 1, 50, "website"),
  daily("daily-open-studio", "Open Character Studio", "Open the DZN Character Studio and inspect your loadout.", "character_studio_visit", 1, 35, "website"),
  daily("daily-view-profile", "View an Operator profile", "Visit a public Operator profile page.", "operator_profile_view", 1, 35, "website"),
  daily("daily-view-leaderboard", "View an Operator leaderboard", "Check the weekly Operator standings.", "operator_leaderboard_view", 1, 35, "website"),
  daily("daily-server-time", "Play on a linked DZN server for 30 minutes", "Future ADM telemetry target for linked-server session time.", "server_session_minutes", 30, 80, "future_adm"),
  daily("daily-confirmed-kills", "Get 5 confirmed kills", "Future ADM telemetry target for confirmed kills.", "confirmed_kills", 5, 90, "future_adm"),
  daily("daily-travel", "Travel 10 kilometres", "Future ADM aggregate movement target.", "distance_travelled_m", 10_000, 70, "future_adm"),
  daily("daily-explore-cells", "Explore 5 aggregate map cells", "Future map exploration target using aggregate cells only.", "explored_cells", 5, 70, "future_adm"),
  weekly("weekly-five-dailies", "Complete 5 daily challenges", "Finish five daily Operator challenges in the UTC week.", "operator_daily_check_in", 5, 240, "website"),
  weekly("weekly-25-kills", "Get 25 confirmed kills", "Future ADM weekly confirmed-kill target.", "confirmed_kills", 25, 320, "future_adm"),
  weekly("weekly-50km", "Travel 50 kilometres", "Future ADM weekly aggregate travel target.", "distance_travelled_m", 50_000, 280, "future_adm"),
  weekly("weekly-two-events", "Enter 2 DZN events", "Future event-platform entry target.", "event_entries", 2, 260, "future_event_platform"),
  weekly("weekly-profile-views", "View 3 different Operator profiles", "Inspect three public Operator identity pages.", "operator_profile_view", 3, 180, "website"),
  seasonal("seasonal-30-dailies", "Complete 30 daily challenges", "Complete 30 daily Operator challenges this season.", "operator_daily_check_in", 30, 900, "website"),
  seasonal("seasonal-250-kills", "Get 250 confirmed kills", "Future ADM seasonal confirmed-kill target.", "confirmed_kills", 250, 1200, "future_adm"),
  seasonal("seasonal-500km", "Travel 500 kilometres", "Future ADM seasonal aggregate travel target.", "distance_travelled_m", 500_000, 1100, "future_adm"),
  seasonal("seasonal-100-cells", "Explore 100 aggregate cells", "Future aggregate exploration target without raw coordinates.", "explored_cells", 100, 1000, "future_adm"),
  seasonal("seasonal-10-events", "Enter 10 DZN events", "Future event-platform seasonal entry target.", "event_entries", 10, 1000, "future_event_platform"),
  seasonal("seasonal-5-encounters", "Win or complete 5 competitive encounters", "Future event-platform completion and win target.", "event_completions", 5, 1150, "future_event_platform"),
  community("community-kills", "Reach a server-wide confirmed-kill target", "Server community aggregate confirmed-kill target.", "server_community_kills", 500, 700),
  community("community-travel", "Reach a server-wide travel target", "Server community aggregate travel target.", "server_community_distance_m", 1_000_000, 650),
  community("community-events", "Reach a server-wide event-entry target", "Server community aggregate event-entry target.", "server_community_event_entries", 60, 650),
  community("community-active-operators", "Reach a server-wide active-operator target", "Server community active Operator target.", "operator_daily_check_in", 40, 550),
];

export function getOperatorChallengeCatalog(): OperatorChallenge[] {
  return OPERATOR_CHALLENGES.map((challenge) => ({ ...challenge }));
}

export function getChallengesForCategory(category: OperatorChallengeCategory): OperatorChallenge[] {
  return getOperatorChallengeCatalog().filter((challenge) => challenge.category === category);
}

export function getOperatorChallenge(challengeId: string): OperatorChallenge | null {
  return OPERATOR_CHALLENGES.find((challenge) => challenge.id === challengeId) ?? null;
}

function daily(
  id: string,
  title: string,
  description: string,
  metric: OperatorChallengeMetric,
  target: number,
  xpReward: number,
  source: OperatorChallenge["source"],
): OperatorChallenge {
  return makeChallenge(id, title, description, "daily", metric, target, xpReward, "daily_utc", DAILY_START, DAILY_END, source);
}

function weekly(
  id: string,
  title: string,
  description: string,
  metric: OperatorChallengeMetric,
  target: number,
  xpReward: number,
  source: OperatorChallenge["source"],
): OperatorChallenge {
  return makeChallenge(id, title, description, "weekly", metric, target, xpReward, "weekly_utc", DAILY_START, WEEKLY_END, source);
}

function seasonal(
  id: string,
  title: string,
  description: string,
  metric: OperatorChallengeMetric,
  target: number,
  xpReward: number,
  source: OperatorChallenge["source"],
): OperatorChallenge {
  return makeChallenge(id, title, description, "seasonal", metric, target, xpReward, "seasonal_utc", OPERATOR_SEASON_START, OPERATOR_SEASON_END, source);
}

function community(id: string, title: string, description: string, metric: OperatorChallengeMetric, target: number, xpReward: number): OperatorChallenge {
  return makeChallenge(id, title, description, "community", metric, target, xpReward, "weekly_utc", DAILY_START, WEEKLY_END, "future_server_aggregate");
}

function makeChallenge(
  id: string,
  title: string,
  description: string,
  category: OperatorChallengeCategory,
  metric: OperatorChallengeMetric,
  target: number,
  xpReward: number,
  reset: OperatorChallenge["reset"],
  startsAt: string,
  endsAt: string,
  source: OperatorChallenge["source"],
): OperatorChallenge {
  return {
    id,
    title,
    description,
    category,
    metric,
    target,
    xpReward,
    reward: category === "daily" ? undefined : reward(`${id}-reward`, `${title} DZN Operator Reward`, "Fixed DZN Reward Pack", "emblem", "Fixed DZN Reward Pack"),
    reset,
    startsAt,
    endsAt,
    privacy: category === "community" ? "public_aggregate" : "public_profile",
    source,
    accessibilityLabel: `${title}: ${target} ${metric}, ${xpReward} Operator XP. Source ${source}.`,
  };
}
