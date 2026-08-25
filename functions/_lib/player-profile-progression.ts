import {
  getPlayerChallengesPayload,
  type PlayerCallingCardAwardSummary,
  type PlayerChallengeSource,
  type PlayerChallengeSummary,
  type PlayerProgressSummary,
} from "./player-progression";
import { getPlayerProfilePrivacyPreferences, type PlayerProfilePrivacyPreferences } from "./player-profile-privacy";
import type { Env, SessionUser } from "./types";

export type PlayerProfileProgressionPayload = {
  ok: true;
  source: PlayerChallengeSource;
  user: {
    username: string;
    avatar: string | null;
  };
  profile: {
    display_name: string;
    avatar_url: string | null;
    profile_level: number;
    level_label: string;
    total_xp: number;
    xp_to_next_level: number;
    completed_challenges: number;
    joined_challenges: number;
    available_challenges: number;
    calling_card_count: number;
    showcase_href: string;
  };
  privacy: {
    mode: "private_viewer";
    public_handle: PlayerProfilePrivacyPreferences["public_handle"];
    public_href: PlayerProfilePrivacyPreferences["public_href"];
    public_api_href: PlayerProfilePrivacyPreferences["public_api_href"];
    public_profile_enabled: PlayerProfilePrivacyPreferences["public_profile_enabled"];
    persistence: PlayerProfilePrivacyPreferences["persistence"];
    settings_href: PlayerProfilePrivacyPreferences["settings_href"];
    updated_at: PlayerProfilePrivacyPreferences["updated_at"];
    controls: PlayerProfilePrivacyPreferences["controls"];
    public_safe_preview: PlayerProfilePrivacyPreferences["public_safe_preview"];
  };
  progression: {
    total_xp: number;
    available_challenges: number;
    joined_challenges: number;
    completed_challenges: number;
    calling_cards: PlayerProfileCallingCard[];
    challenge_progress: PlayerProfileChallengeProgress[];
    timeline: PlayerProfileProgressionTimelineItem[];
    challenges_href: string;
  };
  fairness: {
    paid_plan_influence: false;
    ranking_influence: false;
    discovery_score_influence: false;
    review_score_influence: false;
    badge_influence: false;
    season_influence: false;
    event_influence: false;
    server_wars_influence: false;
    xp_award_influence: false;
    calling_card_award_influence: false;
    competitive_eligibility_influence: false;
  };
  fetched_at: string;
};

export type PlayerProfileCallingCard = {
  code: string;
  name: string;
  description: string | null;
  rarity: string;
  awarded_at: string;
};

export type PlayerProfileChallengeProgress = {
  id: string;
  slug: string;
  title: string;
  category: string;
  status: "not_joined" | "joined" | "completed" | "abandoned";
  progress_value: number;
  target_value: number;
  progress_percent: number;
  xp_awarded: number;
  reward_xp: number;
  calling_card_code: string | null;
  calling_card_name: string | null;
  calling_card_awarded: string | null;
  joined_at: string | null;
  completed_at: string | null;
};

export type PlayerProfileProgressionTimelineItem = {
  id: string;
  kind: "calling_card" | "challenge";
  label: string;
  detail: string;
  occurred_at: string | null;
};

const PROFILE_HREF = "/player/profile";
const CHALLENGES_HREF = "/events/challenges";
const LEVEL_THRESHOLDS = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5600, 7300, 9300];

export async function getPlayerProfileProgressionPayload(
  env: Env,
  user: SessionUser,
): Promise<PlayerProfileProgressionPayload> {
  const [payload, privacy] = await Promise.all([
    getPlayerChallengesPayload(env, user),
    getPlayerProfilePrivacyPreferences(env, user),
  ]);
  const progress = normalizeProgress(payload.player_progress);
  const totalXp = safeNumber(progress.total_xp);
  const level = calculatePlayerProfileLevel(totalXp);
  const callingCards = (progress.calling_cards ?? []).map(toProfileCallingCard);
  const challengeProgress = payload.challenges.map(toProfileChallengeProgress).sort(compareProfileChallengeProgress);

  return {
    ok: true,
    source: payload.source,
    user: {
      username: displayName(user.username),
      avatar: nullableString(user.avatar),
    },
    profile: {
      display_name: displayName(user.username),
      avatar_url: nullableString(user.avatar),
      profile_level: level.level,
      level_label: level.label,
      total_xp: totalXp,
      xp_to_next_level: level.xpToNextLevel,
      completed_challenges: safeNumber(progress.completed_challenges),
      joined_challenges: safeNumber(progress.joined_challenges),
      available_challenges: safeNumber(progress.available_challenges),
      calling_card_count: callingCards.length,
      showcase_href: PROFILE_HREF,
    },
    privacy: {
      mode: "private_viewer",
      public_handle: privacy.public_handle,
      public_href: privacy.public_href,
      public_api_href: privacy.public_api_href,
      public_profile_enabled: privacy.public_profile_enabled,
      persistence: privacy.persistence,
      settings_href: privacy.settings_href,
      updated_at: privacy.updated_at,
      controls: privacy.controls,
      public_safe_preview: privacy.public_safe_preview,
    },
    progression: {
      total_xp: totalXp,
      available_challenges: safeNumber(progress.available_challenges),
      joined_challenges: safeNumber(progress.joined_challenges),
      completed_challenges: safeNumber(progress.completed_challenges),
      calling_cards: callingCards,
      challenge_progress: challengeProgress,
      timeline: buildProgressionTimeline(progress, challengeProgress, callingCards),
      challenges_href: CHALLENGES_HREF,
    },
    fairness: {
      paid_plan_influence: false,
      ranking_influence: false,
      discovery_score_influence: false,
      review_score_influence: false,
      badge_influence: false,
      season_influence: false,
      event_influence: false,
      server_wars_influence: false,
      xp_award_influence: false,
      calling_card_award_influence: false,
      competitive_eligibility_influence: false,
    },
    fetched_at: new Date().toISOString(),
  };
}

export function calculatePlayerProfileLevel(totalXp: number) {
  const xp = safeNumber(totalXp);
  let level = 1;
  for (let index = 0; index < LEVEL_THRESHOLDS.length; index += 1) {
    if (xp >= LEVEL_THRESHOLDS[index]) level = index + 1;
  }
  const nextThreshold = LEVEL_THRESHOLDS[level] ?? null;
  return {
    level,
    label: levelLabel(level),
    xpToNextLevel: nextThreshold === null ? 0 : Math.max(0, nextThreshold - xp),
  };
}

function normalizeProgress(progress: PlayerProgressSummary): PlayerProgressSummary {
  return {
    source: progress.source,
    total_xp: safeNumber(progress.total_xp),
    available_challenges: safeNumber(progress.available_challenges),
    joined_challenges: safeNumber(progress.joined_challenges),
    completed_challenges: safeNumber(progress.completed_challenges),
    calling_cards: Array.isArray(progress.calling_cards) ? progress.calling_cards : [],
    recent_challenges: Array.isArray(progress.recent_challenges) ? progress.recent_challenges : [],
    href: typeof progress.href === "string" && progress.href ? progress.href : CHALLENGES_HREF,
  };
}

function toProfileCallingCard(card: PlayerCallingCardAwardSummary): PlayerProfileCallingCard {
  return {
    code: stringOrDefault(card.code, "calling_card"),
    name: stringOrDefault(card.name, titleFromToken(card.code)),
    description: nullableString(card.description),
    rarity: stringOrDefault(card.rarity, "earned"),
    awarded_at: stringOrDefault(card.awarded_at, new Date(0).toISOString()),
  };
}

function toProfileChallengeProgress(challenge: PlayerChallengeSummary): PlayerProfileChallengeProgress {
  const state = challenge.player_state;
  return {
    id: stringOrDefault(challenge.id, "challenge"),
    slug: stringOrDefault(challenge.slug, "challenge"),
    title: stringOrDefault(challenge.title, "DZN Challenge"),
    category: stringOrDefault(challenge.category, "community"),
    status: state.status ?? "not_joined",
    progress_value: safeNumber(state.progress_value),
    target_value: Math.max(1, safeNumber(state.target_value)),
    progress_percent: clampPercent(state.progress_percent),
    xp_awarded: safeNumber(state.xp_awarded),
    reward_xp: safeNumber(challenge.reward?.xp),
    calling_card_code: nullableString(challenge.reward?.calling_card?.code),
    calling_card_name: nullableString(challenge.reward?.calling_card?.name),
    calling_card_awarded: nullableString(state.calling_card_awarded),
    joined_at: nullableString(state.joined_at),
    completed_at: nullableString(state.completed_at),
  };
}

function buildProgressionTimeline(
  progress: PlayerProgressSummary,
  challenges: PlayerProfileChallengeProgress[],
  callingCards: PlayerProfileCallingCard[],
): PlayerProfileProgressionTimelineItem[] {
  const items: PlayerProfileProgressionTimelineItem[] = [];
  for (const card of callingCards) {
    items.push({
      id: `card-${card.code}`,
      kind: "calling_card",
      label: card.name,
      detail: `${titleFromToken(card.rarity)} calling card earned from verified DZN activity.`,
      occurred_at: card.awarded_at,
    });
  }
  const recentChallengeIds = new Set((progress.recent_challenges ?? []).map((challenge) => challenge.id));
  for (const challenge of challenges) {
    if (challenge.status === "not_joined" && !recentChallengeIds.has(challenge.id)) continue;
    items.push({
      id: `challenge-${challenge.id}`,
      kind: "challenge",
      label: challenge.title,
      detail: challenge.status === "completed"
        ? `${challenge.xp_awarded || challenge.reward_xp} XP challenge completed.`
        : `${challenge.progress_percent}% challenge progress.`,
      occurred_at: challenge.completed_at ?? challenge.joined_at,
    });
  }
  return items
    .sort((a, b) => dateValue(b.occurred_at) - dateValue(a.occurred_at))
    .slice(0, 8);
}

function compareProfileChallengeProgress(a: PlayerProfileChallengeProgress, b: PlayerProfileChallengeProgress) {
  const weight = (status: PlayerProfileChallengeProgress["status"]) => {
    if (status === "completed") return 0;
    if (status === "joined") return 1;
    if (status === "abandoned") return 2;
    return 3;
  };
  const stateDiff = weight(a.status) - weight(b.status);
  if (stateDiff !== 0) return stateDiff;
  return b.progress_percent - a.progress_percent || a.title.localeCompare(b.title);
}

function levelLabel(level: number) {
  if (level >= 10) return "Legend Track";
  if (level >= 7) return "Veteran Track";
  if (level >= 4) return "Survivor Track";
  return "Foundation Track";
}

function dateValue(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampPercent(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function displayName(value: unknown) {
  return stringOrDefault(value, "DZN Player").slice(0, 80);
}

function titleFromToken(value: unknown) {
  return stringOrDefault(value, "earned")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Earned";
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
