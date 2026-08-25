import {
  calculatePlayerProfileLevel,
  getPlayerProfileProgressionPayload,
  type PlayerProfileCallingCard,
  type PlayerProfileChallengeProgress,
  type PlayerProfileProgressionTimelineItem,
} from "./player-profile-progression";
import {
  normalizePublicProfileHandle,
  playerProfilePrivacyFairness,
  publicPlayerProfileApiHref,
  publicPlayerProfileHref,
  type PlayerProfilePrivacyFairness,
} from "./player-profile-privacy";
import type { Env, SessionUser } from "./types";

export type PublicPlayerProfileResponse = {
  status: 200 | 400 | 404 | 503;
  payload: PublicPlayerProfilePayload | PublicPlayerProfileErrorPayload;
};

export type PublicPlayerProfilePayload = {
  ok: true;
  profile: {
    handle: string;
    display_name: string;
    avatar_initial: string;
    public_href: string;
    public_api_href: string;
  };
  visibility: {
    mode: "public_viewer";
    xp: boolean;
    challenge_progress: boolean;
    calling_cards: boolean;
    award_dates: "month" | "hidden";
    private_identifiers: "hidden";
    raw_award_evidence: "hidden";
    exact_award_times: "hidden";
  };
  sections: {
    xp: PublicPlayerProfileXpSection | null;
    challenge_progress: PublicPlayerProfileChallengeSection | null;
    calling_cards: PublicPlayerProfileCallingCardSection | null;
    timeline: PublicPlayerProfileTimelineItem[];
  };
  fairness: PlayerProfilePrivacyFairness;
  fetched_at: string;
};

export type PublicPlayerProfileErrorPayload = {
  ok: false;
  error: "INVALID_PUBLIC_PROFILE" | "PUBLIC_PROFILE_NOT_FOUND" | "PUBLIC_PROFILE_UNAVAILABLE";
  message: string;
  fairness: PlayerProfilePrivacyFairness;
};

type PublicPlayerProfileXpSection = {
  total_xp: number;
  profile_level: number;
  level_label: string;
  xp_to_next_level: number;
};

type PublicPlayerProfileChallengeSection = {
  joined_challenges: number;
  completed_challenges: number;
  items: PublicPlayerProfileChallenge[];
};

type PublicPlayerProfileCallingCardSection = {
  count: number;
  items: PublicPlayerProfileCallingCard[];
};

type PublicPlayerProfileCallingCard = {
  code: string;
  name: string;
  description: string | null;
  rarity: string;
  awarded_label?: string;
};

type PublicPlayerProfileChallenge = {
  slug: string;
  title: string;
  category: string;
  status: "joined" | "completed";
  progress_percent: number;
  completed_label?: string;
};

type PublicPlayerProfileTimelineItem = {
  kind: "calling_card" | "challenge";
  label: string;
  detail: string;
  occurred_label?: string;
};

type PublishedPlayerProfileRow = {
  user_id: string;
  username: string | null;
  public_handle: string;
};

export async function getPublicPlayerProfilePayload(
  env: Env,
  handle: unknown,
): Promise<PublicPlayerProfileResponse> {
  const publicHandle = normalizePublicProfileHandle(handle);
  if (!publicHandle) {
    return publicPlayerProfileError(400, "INVALID_PUBLIC_PROFILE", "Invalid public player profile handle.");
  }
  if (!env.DB) {
    return publicPlayerProfileError(503, "PUBLIC_PROFILE_UNAVAILABLE", "Public player profiles are not available right now.");
  }

  let row: PublishedPlayerProfileRow | null = null;
  try {
    row = await env.DB
      .prepare(
        `SELECT
           users.id AS user_id,
           users.username,
           player_profile_privacy_preferences.public_handle
         FROM player_profile_privacy_preferences
         INNER JOIN users ON users.id = player_profile_privacy_preferences.user_id
         WHERE player_profile_privacy_preferences.public_handle = ?
           AND player_profile_privacy_preferences.public_profile_enabled = 1
         LIMIT 1`,
      )
      .bind(publicHandle)
      .first<PublishedPlayerProfileRow>();
  } catch {
    return publicPlayerProfileError(503, "PUBLIC_PROFILE_UNAVAILABLE", "Public player profiles are not available right now.");
  }

  if (!row) {
    return publicPlayerProfileError(404, "PUBLIC_PROFILE_NOT_FOUND", "That DZN player profile is not public.");
  }

  const targetUser: SessionUser = {
    id: row.user_id,
    discord_id: "",
    username: displayName(row.username),
    avatar: null,
  };
  const privatePayload = await getPlayerProfileProgressionPayload(env, targetUser);
  if (!privatePayload.privacy.public_profile_enabled) {
    return publicPlayerProfileError(404, "PUBLIC_PROFILE_NOT_FOUND", "That DZN player profile is not public.");
  }

  const controls = privatePayload.privacy.controls;
  const totalXp = Math.max(0, Math.trunc(privatePayload.progression.total_xp));
  const level = calculatePlayerProfileLevel(totalXp);
  const showAwardMonth = controls.show_award_dates;
  const visibleChallenges = privatePayload.progression.challenge_progress
    .filter((challenge) => challenge.status === "joined" || challenge.status === "completed")
    .slice(0, 12);
  const visibleCards = privatePayload.progression.calling_cards.slice(0, 12);

  return {
    status: 200,
    payload: {
      ok: true,
      profile: {
        handle: publicHandle,
        display_name: displayName(row.username),
        avatar_initial: avatarInitial(row.username),
        public_href: publicPlayerProfileHref(publicHandle) ?? `/players/${publicHandle}`,
        public_api_href: publicPlayerProfileApiHref(publicHandle) ?? `/api/public/player-profiles/${publicHandle}`,
      },
      visibility: {
        mode: "public_viewer",
        xp: controls.show_xp,
        challenge_progress: controls.show_challenge_progress,
        calling_cards: controls.show_calling_cards,
        award_dates: showAwardMonth ? "month" : "hidden",
        private_identifiers: "hidden",
        raw_award_evidence: "hidden",
        exact_award_times: "hidden",
      },
      sections: {
        xp: controls.show_xp ? publicXpSection(totalXp, level) : null,
        challenge_progress: controls.show_challenge_progress
          ? publicChallengeSection(visibleChallenges, showAwardMonth)
          : null,
        calling_cards: controls.show_calling_cards
          ? publicCallingCardSection(visibleCards, showAwardMonth)
          : null,
        timeline: publicTimeline(privatePayload.progression.timeline, controls, showAwardMonth),
      },
      fairness: playerProfilePrivacyFairness(),
      fetched_at: new Date().toISOString(),
    },
  };
}

function publicPlayerProfileError(
  status: PublicPlayerProfileResponse["status"],
  error: PublicPlayerProfileErrorPayload["error"],
  message: string,
): PublicPlayerProfileResponse {
  return {
    status,
    payload: {
      ok: false,
      error,
      message,
      fairness: playerProfilePrivacyFairness(),
    },
  };
}

function publicXpSection(totalXp: number, level: ReturnType<typeof calculatePlayerProfileLevel>): PublicPlayerProfileXpSection {
  return {
    total_xp: totalXp,
    profile_level: level.level,
    level_label: level.label,
    xp_to_next_level: level.xpToNextLevel,
  };
}

function publicChallengeSection(
  challenges: PlayerProfileChallengeProgress[],
  showAwardMonth: boolean,
): PublicPlayerProfileChallengeSection {
  const items = challenges.map((challenge) => {
    const publicChallenge: PublicPlayerProfileChallenge = {
      slug: stringOrDefault(challenge.slug, "challenge"),
      title: stringOrDefault(challenge.title, "DZN Challenge"),
      category: stringOrDefault(challenge.category, "community"),
      status: challenge.status === "completed" ? "completed" : "joined",
      progress_percent: clampPercent(challenge.progress_percent),
    };
    if (showAwardMonth && challenge.completed_at) {
      publicChallenge.completed_label = monthLabel(challenge.completed_at);
    }
    return publicChallenge;
  });

  return {
    joined_challenges: items.filter((challenge) => challenge.status === "joined" || challenge.status === "completed").length,
    completed_challenges: items.filter((challenge) => challenge.status === "completed").length,
    items,
  };
}

function publicCallingCardSection(
  cards: PlayerProfileCallingCard[],
  showAwardMonth: boolean,
): PublicPlayerProfileCallingCardSection {
  return {
    count: cards.length,
    items: cards.map((card) => {
      const publicCard: PublicPlayerProfileCallingCard = {
        code: stringOrDefault(card.code, "calling_card"),
        name: stringOrDefault(card.name, "Calling Card"),
        description: nullableString(card.description),
        rarity: stringOrDefault(card.rarity, "earned"),
      };
      if (showAwardMonth) publicCard.awarded_label = monthLabel(card.awarded_at);
      return publicCard;
    }),
  };
}

function publicTimeline(
  items: PlayerProfileProgressionTimelineItem[],
  controls: {
    show_xp: boolean;
    show_challenge_progress: boolean;
    show_calling_cards: boolean;
  },
  showAwardMonth: boolean,
): PublicPlayerProfileTimelineItem[] {
  return items
    .filter((item) => {
      if (item.kind === "calling_card") return controls.show_calling_cards;
      return controls.show_challenge_progress;
    })
    .slice(0, 8)
    .map((item) => {
      const publicItem: PublicPlayerProfileTimelineItem = {
        kind: item.kind,
        label: stringOrDefault(item.label, "DZN Progress"),
        detail: controls.show_xp ? stringOrDefault(item.detail, "Verified DZN player progress.") : detailWithoutXp(item.detail),
      };
      if (showAwardMonth && item.occurred_at) publicItem.occurred_label = monthLabel(item.occurred_at);
      return publicItem;
    });
}

function detailWithoutXp(value: unknown) {
  const detail = stringOrDefault(value, "Verified DZN player progress.");
  return detail.replace(/\b\d[\d,]*\s*XP\b/gi, "Verified").replace(/\s+/g, " ").trim();
}

function displayName(value: unknown) {
  return stringOrDefault(value, "DZN Player").slice(0, 80);
}

function avatarInitial(value: unknown) {
  return displayName(value).slice(0, 1).toUpperCase() || "D";
}

function clampPercent(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function monthLabel(value: unknown) {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return `${month} ${date.getUTCFullYear()}`;
}
