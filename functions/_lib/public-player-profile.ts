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

export type PublicPlayerProfileDirectoryPreviewHighlight = {
  key: "xp" | "challenge_progress" | "calling_cards";
  label: string;
  value: string;
  detail: string | null;
};

export type PublicPlayerProfileDirectoryPreview = {
  source: "published_profile_sections";
  visible_section_count: number;
  highlights: PublicPlayerProfileDirectoryPreviewHighlight[];
  empty_state: "profile_sections_hidden_or_not_earned";
  privacy: {
    uses_visible_profile_sections_only: true;
    hidden_sections: "omitted";
    private_identifiers: "hidden";
    raw_award_evidence: "hidden";
    exact_award_times: "hidden";
  };
  fairness: PlayerProfilePrivacyFairness;
};

export type PublicPlayerProfileSharePreviewMetadata = {
  source: "public_profile_payload" | "generic_fallback";
  title: string;
  description: string;
  fallback_copy: string;
  canonical_href: string;
  image_href: string;
  image_alt: string;
  robots: "index,follow" | "noindex,nofollow";
  open_graph: {
    type: "profile" | "website";
    site_name: "DZN Network";
    title: string;
    description: string;
    url: string;
    image: string;
    image_alt: string;
  };
  twitter: {
    card: "summary_large_image";
    title: string;
    description: string;
    image: string;
    image_alt: string;
  };
  privacy: {
    source: "already_public_profile_payload";
    uses_saved_visibility_preferences: true;
    uses_visible_profile_sections_only: true;
    hidden_sections: "omitted";
    private_identifiers: "hidden";
    raw_award_evidence: "hidden";
    exact_award_times: "hidden";
    share_history: "not_stored";
    server_calls_for_share_activity: "not_performed";
    privacy_setting_writes: "not_performed";
  };
  fairness: PlayerProfilePrivacyFairness;
};

type PublishedPlayerProfileRow = {
  user_id: string;
  username: string | null;
  public_handle: string;
};

type PublishedProfileDirectoryPreviewRow = {
  user_id?: string | null;
  public_handle?: string | null;
  show_xp?: number | boolean | null;
  show_challenge_progress?: number | boolean | null;
  show_calling_cards?: number | boolean | null;
  show_award_dates?: number | boolean | null;
};

type PublishedProfileDirectoryXpRow = {
  user_id?: string | null;
  total_xp?: number | null;
};

type PublishedProfileDirectoryChallengeRow = {
  user_id?: string | null;
  joined_challenges?: number | null;
  completed_challenges?: number | null;
};

type PublishedProfileDirectoryCallingCardCountRow = {
  user_id?: string | null;
  calling_card_count?: number | null;
};

type PublishedProfileDirectoryCallingCardRow = {
  user_id?: string | null;
  calling_card_name?: string | null;
  calling_card_rarity?: string | null;
  awarded_at?: string | null;
};

const MAX_DIRECTORY_PREVIEW_LOOKUP_IDS = 96;
const PUBLIC_PROFILE_SHARE_IMAGE_PATH = "/media/dzn-cinematic-survivor.png";
const PUBLIC_PROFILE_SHARE_IMAGE_ALT = "DZN public player profile preview";
const PUBLIC_PROFILE_SHARE_FALLBACK_TITLE = "DZN Player Profile | DZN Network";
const PUBLIC_PROFILE_SHARE_FALLBACK_DESCRIPTION = "View public DZN player profiles shared by their owners on DZN Network.";
const PUBLIC_PROFILE_SHARE_DESCRIPTION_LIMIT = 180;

export function buildPublicPlayerProfileSharePreviewMetadata(input: {
  response?: PublicPlayerProfileResponse | null;
  requestUrl: string | URL;
}): PublicPlayerProfileSharePreviewMetadata {
  const origin = requestOrigin(input.requestUrl);
  const fallbackCanonical = canonicalRequestHref(input.requestUrl, origin);
  const imageHref = absolutePublicHref(PUBLIC_PROFILE_SHARE_IMAGE_PATH, origin);
  const response = input.response;
  const payload = response?.payload;

  if (!payload?.ok || response?.status !== 200) {
    return publicPlayerProfileSharePreviewMetadata({
      source: "generic_fallback",
      title: PUBLIC_PROFILE_SHARE_FALLBACK_TITLE,
      description: PUBLIC_PROFILE_SHARE_FALLBACK_DESCRIPTION,
      fallbackCopy: PUBLIC_PROFILE_SHARE_FALLBACK_DESCRIPTION,
      canonicalHref: fallbackCanonical,
      imageHref,
      robots: "noindex,nofollow",
    });
  }

  const displayName = cleanPreviewText(payload.profile.display_name, "DZN Player", 80);
  const canonicalHref = absolutePublicHref(safePublicProfilePath(payload.profile.public_href) ?? fallbackCanonical, origin);
  const signals = publicProfileSharePreviewSignals(payload);
  const signalCopy = signals.length
    ? `${displayName}'s public DZN profile: ${signals.join(", ")}.`
    : `${displayName}'s public DZN profile is published on DZN Network. No progression sections are currently visible.`;
  const safetyCopy = "Private identifiers and raw award evidence stay hidden.";
  const description = previewDescription(`${signalCopy} ${safetyCopy}`);

  return publicPlayerProfileSharePreviewMetadata({
    source: "public_profile_payload",
    title: `${displayName} | DZN Player Profile`,
    description,
    fallbackCopy: description,
    canonicalHref,
    imageHref,
    robots: "index,follow",
  });
}

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

export async function readPublicPlayerProfileDirectoryPreviewsByUserIds(
  env: Env,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, PublicPlayerProfileDirectoryPreview>> {
  if (!env.DB) return new Map();
  const ids = uniqueNonEmptyStrings(userIds).slice(0, MAX_DIRECTORY_PREVIEW_LOOKUP_IDS);
  if (!ids.length) return new Map();

  try {
    const publishedRows = await env.DB
      .prepare(
        `SELECT
           users.id AS user_id,
           player_profile_privacy_preferences.public_handle,
           player_profile_privacy_preferences.show_xp,
           player_profile_privacy_preferences.show_challenge_progress,
           player_profile_privacy_preferences.show_calling_cards,
           player_profile_privacy_preferences.show_award_dates
         FROM player_profile_privacy_preferences
         INNER JOIN users ON users.id = player_profile_privacy_preferences.user_id
         WHERE player_profile_privacy_preferences.user_id IN (${placeholders(ids.length)})
           AND player_profile_privacy_preferences.public_profile_enabled = 1
           AND player_profile_privacy_preferences.public_handle IS NOT NULL`,
      )
      .bind(...ids)
      .all<PublishedProfileDirectoryPreviewRow>();
    const rows = (publishedRows.results ?? []).filter((row) => Boolean(row.user_id && normalizePublicProfileHandle(row.public_handle)));
    if (!rows.length) return new Map();

    const xpVisibleIds = rows.filter((row) => dbBoolean(row.show_xp)).map((row) => row.user_id).filter(isNonEmptyString);
    const challengeVisibleIds = rows.filter((row) => dbBoolean(row.show_challenge_progress)).map((row) => row.user_id).filter(isNonEmptyString);
    const callingCardVisibleIds = rows.filter((row) => dbBoolean(row.show_calling_cards)).map((row) => row.user_id).filter(isNonEmptyString);

    const [xpTotals, challengeCounts, callingCardCounts, latestCallingCards] = await Promise.all([
      readPublishedProfileDirectoryXpTotals(env, xpVisibleIds),
      readPublishedProfileDirectoryChallengeCounts(env, challengeVisibleIds),
      readPublishedProfileDirectoryCallingCardCounts(env, callingCardVisibleIds),
      readPublishedProfileDirectoryLatestCallingCards(env, callingCardVisibleIds),
    ]);

    const previews = new Map<string, PublicPlayerProfileDirectoryPreview>();
    for (const row of rows) {
      const userId = isNonEmptyString(row.user_id) ? row.user_id : null;
      if (!userId) continue;
      const showAwardMonth = dbBoolean(row.show_award_dates);
      const totalXp = Math.max(0, Math.trunc(xpTotals.get(userId) ?? 0));
      const level = calculatePlayerProfileLevel(totalXp);
      const challengeCount = challengeCounts.get(userId) ?? { joined_challenges: 0, completed_challenges: 0 };
      const callingCardCount = callingCardCounts.get(userId) ?? 0;
      const latestCard = latestCallingCards.get(userId) ?? null;

      previews.set(userId, publicProfileDirectoryPreview({
        xp: dbBoolean(row.show_xp) ? publicXpSection(totalXp, level) : null,
        challenge_progress: dbBoolean(row.show_challenge_progress) ? {
          joined_challenges: Math.max(0, Math.trunc(challengeCount.joined_challenges)),
          completed_challenges: Math.max(0, Math.trunc(challengeCount.completed_challenges)),
          items: [],
        } : null,
        calling_cards: dbBoolean(row.show_calling_cards) ? {
          count: Math.max(0, Math.trunc(callingCardCount)),
          items: latestCard ? [{
            code: "published_calling_card",
            name: stringOrDefault(latestCard.calling_card_name, "Calling Card"),
            description: null,
            rarity: stringOrDefault(latestCard.calling_card_rarity, "earned"),
            ...(showAwardMonth && latestCard.awarded_at ? { awarded_label: monthLabel(latestCard.awarded_at) } : {}),
          }] : [],
        } : null,
      }));
    }

    return previews;
  } catch {
    return new Map();
  }
}

export function projectPublicPlayerProfileDirectoryPreviewForPublicTest(
  payload: Pick<PublicPlayerProfilePayload, "ok" | "sections"> | null | undefined,
): PublicPlayerProfileDirectoryPreview | null {
  if (!payload?.ok) return null;
  return publicProfileDirectoryPreview({
    xp: payload.sections.xp,
    challenge_progress: payload.sections.challenge_progress,
    calling_cards: payload.sections.calling_cards,
  });
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

function publicProfileDirectoryPreview(input: {
  xp: PublicPlayerProfileXpSection | null;
  challenge_progress: PublicPlayerProfileChallengeSection | null;
  calling_cards: PublicPlayerProfileCallingCardSection | null;
}): PublicPlayerProfileDirectoryPreview {
  const highlights: PublicPlayerProfileDirectoryPreviewHighlight[] = [];
  if (input.xp) {
    highlights.push({
      key: "xp",
      label: "Profile level",
      value: input.xp.level_label,
      detail: `${input.xp.total_xp.toLocaleString("en-GB")} XP`,
    });
  }
  if (input.challenge_progress) {
    highlights.push({
      key: "challenge_progress",
      label: "Challenges",
      value: countLabel(input.challenge_progress.completed_challenges, "challenge completed", "challenges completed"),
      detail: countLabel(input.challenge_progress.joined_challenges, "challenge joined", "challenges joined"),
    });
  }
  if (input.calling_cards) {
    highlights.push({
      key: "calling_cards",
      label: "Calling cards",
      value: countLabel(input.calling_cards.count, "card", "cards"),
      detail: input.calling_cards.items[0]?.name ?? "None published yet",
    });
  }

  return {
    source: "published_profile_sections",
    visible_section_count: highlights.length,
    highlights,
    empty_state: "profile_sections_hidden_or_not_earned",
    privacy: {
      uses_visible_profile_sections_only: true,
      hidden_sections: "omitted",
      private_identifiers: "hidden",
      raw_award_evidence: "hidden",
      exact_award_times: "hidden",
    },
    fairness: playerProfilePrivacyFairness(),
  };
}

function publicPlayerProfileSharePreviewMetadata(input: {
  source: PublicPlayerProfileSharePreviewMetadata["source"];
  title: string;
  description: string;
  fallbackCopy: string;
  canonicalHref: string;
  imageHref: string;
  robots: PublicPlayerProfileSharePreviewMetadata["robots"];
}): PublicPlayerProfileSharePreviewMetadata {
  return {
    source: input.source,
    title: input.title,
    description: input.description,
    fallback_copy: input.fallbackCopy,
    canonical_href: input.canonicalHref,
    image_href: input.imageHref,
    image_alt: PUBLIC_PROFILE_SHARE_IMAGE_ALT,
    robots: input.robots,
    open_graph: {
      type: input.source === "public_profile_payload" ? "profile" : "website",
      site_name: "DZN Network",
      title: input.title,
      description: input.description,
      url: input.canonicalHref,
      image: input.imageHref,
      image_alt: PUBLIC_PROFILE_SHARE_IMAGE_ALT,
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      image: input.imageHref,
      image_alt: PUBLIC_PROFILE_SHARE_IMAGE_ALT,
    },
    privacy: {
      source: "already_public_profile_payload",
      uses_saved_visibility_preferences: true,
      uses_visible_profile_sections_only: true,
      hidden_sections: "omitted",
      private_identifiers: "hidden",
      raw_award_evidence: "hidden",
      exact_award_times: "hidden",
      share_history: "not_stored",
      server_calls_for_share_activity: "not_performed",
      privacy_setting_writes: "not_performed",
    },
    fairness: playerProfilePrivacyFairness(),
  };
}

function publicProfileSharePreviewSignals(payload: PublicPlayerProfilePayload) {
  const signals: string[] = [];
  const xp = payload.visibility.xp ? payload.sections.xp : null;
  if (xp) {
    signals.push(`${cleanPreviewText(xp.level_label, "Foundation Track", 48)} with ${formatPreviewCount(xp.total_xp)} XP`);
  }

  const challengeProgress = payload.visibility.challenge_progress ? payload.sections.challenge_progress : null;
  if (challengeProgress) {
    signals.push(countLabel(challengeProgress.completed_challenges, "challenge completed", "challenges completed"));
  }

  const callingCards = payload.visibility.calling_cards ? payload.sections.calling_cards : null;
  if (callingCards) {
    signals.push(countLabel(callingCards.count, "calling card", "calling cards"));
  }

  return signals.slice(0, 3);
}

function requestOrigin(value: string | URL) {
  try {
    return new URL(value).origin;
  } catch {
    return "https://dzn-network.pages.dev";
  }
}

function canonicalRequestHref(value: string | URL, origin: string) {
  try {
    const url = new URL(value);
    return new URL(url.pathname, origin).toString();
  } catch {
    return new URL("/players/preview", origin).toString();
  }
}

function absolutePublicHref(pathOrHref: string, origin: string) {
  try {
    const url = new URL(pathOrHref, origin);
    if (url.origin !== origin) return new URL("/players/preview", origin).toString();
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return new URL("/players/preview", origin).toString();
  }
}

function safePublicProfilePath(value: unknown) {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/players/") || value.startsWith("//")) return null;
  return value;
}

function previewDescription(value: string) {
  const cleaned = cleanPreviewText(value, PUBLIC_PROFILE_SHARE_FALLBACK_DESCRIPTION, PUBLIC_PROFILE_SHARE_DESCRIPTION_LIMIT + 40);
  if (cleaned.length <= PUBLIC_PROFILE_SHARE_DESCRIPTION_LIMIT) return cleaned;
  return `${cleaned.slice(0, PUBLIC_PROFILE_SHARE_DESCRIPTION_LIMIT - 1).trimEnd()}.`;
}

function cleanPreviewText(value: unknown, fallback: string, maxLength: number) {
  const cleaned = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()
    : "";
  return (cleaned || fallback).slice(0, Math.max(1, maxLength)).trim();
}

function formatPreviewCount(value: unknown) {
  return Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString("en-GB");
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

async function readPublishedProfileDirectoryXpTotals(env: Env, userIds: string[]) {
  const totals = new Map<string, number>();
  if (!userIds.length || !env.DB) return totals;
  const rows = await env.DB
    .prepare(
      `SELECT user_id,
              COALESCE(SUM(xp_amount), 0) AS total_xp
       FROM player_xp_ledger
       WHERE user_id IN (${placeholders(userIds.length)})
       GROUP BY user_id`,
    )
    .bind(...userIds)
    .all<PublishedProfileDirectoryXpRow>();
  for (const row of rows.results ?? []) {
    if (isNonEmptyString(row.user_id)) totals.set(row.user_id, numberOrZero(row.total_xp));
  }
  return totals;
}

async function readPublishedProfileDirectoryChallengeCounts(env: Env, userIds: string[]) {
  const counts = new Map<string, { joined_challenges: number; completed_challenges: number }>();
  if (!userIds.length || !env.DB) return counts;
  const rows = await env.DB
    .prepare(
      `SELECT user_id,
              COUNT(CASE WHEN status IN ('joined', 'completed') THEN 1 END) AS joined_challenges,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed_challenges
       FROM player_challenge_participations
       WHERE user_id IN (${placeholders(userIds.length)})
         AND status IN ('joined', 'completed')
       GROUP BY user_id`,
    )
    .bind(...userIds)
    .all<PublishedProfileDirectoryChallengeRow>();
  for (const row of rows.results ?? []) {
    if (!isNonEmptyString(row.user_id)) continue;
    counts.set(row.user_id, {
      joined_challenges: numberOrZero(row.joined_challenges),
      completed_challenges: numberOrZero(row.completed_challenges),
    });
  }
  return counts;
}

async function readPublishedProfileDirectoryCallingCardCounts(env: Env, userIds: string[]) {
  const counts = new Map<string, number>();
  if (!userIds.length || !env.DB) return counts;
  const rows = await env.DB
    .prepare(
      `SELECT user_id,
              COUNT(*) AS calling_card_count
       FROM player_calling_card_awards
       WHERE user_id IN (${placeholders(userIds.length)})
       GROUP BY user_id`,
    )
    .bind(...userIds)
    .all<PublishedProfileDirectoryCallingCardCountRow>();
  for (const row of rows.results ?? []) {
    if (isNonEmptyString(row.user_id)) counts.set(row.user_id, numberOrZero(row.calling_card_count));
  }
  return counts;
}

async function readPublishedProfileDirectoryLatestCallingCards(env: Env, userIds: string[]) {
  const latest = new Map<string, PublishedProfileDirectoryCallingCardRow>();
  if (!userIds.length || !env.DB) return latest;
  const rows = await env.DB
    .prepare(
      `SELECT
         user_id,
         calling_card_name,
         calling_card_rarity,
         awarded_at
       FROM (
         SELECT
           player_calling_card_awards.user_id,
           player_calling_cards.name AS calling_card_name,
           player_calling_cards.rarity AS calling_card_rarity,
           player_calling_card_awards.awarded_at,
           ROW_NUMBER() OVER (
             PARTITION BY player_calling_card_awards.user_id
             ORDER BY datetime(player_calling_card_awards.awarded_at) DESC
           ) AS row_number
         FROM player_calling_card_awards
         LEFT JOIN player_calling_cards ON player_calling_cards.code = player_calling_card_awards.calling_card_code
         WHERE player_calling_card_awards.user_id IN (${placeholders(userIds.length)})
       )
       WHERE row_number = 1`,
    )
    .bind(...userIds)
    .all<PublishedProfileDirectoryCallingCardRow>();
  for (const row of rows.results ?? []) {
    if (isNonEmptyString(row.user_id) && !latest.has(row.user_id)) latest.set(row.user_id, row);
  }
  return latest;
}

function countLabel(count: number, singular: string, plural: string) {
  const normalized = Math.max(0, Math.trunc(count));
  return `${normalized.toLocaleString("en-GB")} ${normalized === 1 ? singular : plural}`;
}

function dbBoolean(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}
