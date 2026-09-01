import { requireDb } from "./db";
import type { Env, SessionUser } from "./types";

export type PlayerPublicProfilePreferences = {
  public_profile_enabled: boolean;
  show_display_name: boolean;
  show_gameplay_summary: boolean;
  show_featured_server: boolean;
  show_xp_progress: boolean;
  show_challenge_progress: boolean;
  show_calling_cards: boolean;
  show_award_dates: boolean;
};

export type PlayerPublicProfileHandle = {
  handle: string;
  href: string;
  status: "active" | "disabled";
  created_at: string | null;
  updated_at: string | null;
};

export type PublicProfileLink = {
  handle: string;
  href: string;
};

export type PublicPlayerProfilePayload = {
  ok: true;
  handle: string;
  href: string;
  display_name: string;
  published_at: string | null;
  updated_at: string | null;
  sections: {
    display_name: {
      visible: boolean;
      value: string | null;
    };
    gameplay_summary: {
      visible: boolean;
      totals: {
        kills: number;
        deaths: number;
        suicides: number;
        longest_kill_distance: number;
        linked_public_servers: number;
      } | null;
      last_seen_at: string | null;
    };
    featured_server: {
      visible: boolean;
      server: {
        public_slug: string;
        href: string;
        server_name: string;
        server_type: string;
        platform: string | null;
        map_name: string | null;
        kills: number;
        deaths: number;
        longest_kill_distance: number;
        last_seen_at: string | null;
      } | null;
    };
    xp_progress: {
      visible: boolean;
      status: "not_available_yet" | "hidden";
      message: string;
    };
    challenge_progress: {
      visible: boolean;
      status: "not_available_yet" | "hidden";
      message: string;
    };
    calling_cards: {
      visible: boolean;
      status: "not_available_yet" | "hidden";
      message: string;
    };
    award_dates: {
      visible: boolean;
      status: "not_available_yet" | "hidden";
      message: string;
    };
  };
  privacy: {
    public_profile_enabled: true;
    visible_sections: string[];
  };
  safety: {
    public_safe: true;
    read_only: true;
    presentation_only: true;
    private_identifiers_exposed: false;
    raw_award_evidence_exposed: false;
  };
  fairness_boundary: string[];
};

type ExistingPublicProfileRow = {
  handle: string;
  status: "active" | "disabled" | null;
  created_at: string | null;
  updated_at: string | null;
};

type PublicPlayerProfileOwnerRow = ExistingPublicProfileRow & {
  user_id: string;
  discord_id: string;
  username: string | null;
  public_profile_enabled: number | null;
  show_display_name: number | null;
  show_gameplay_summary: number | null;
  show_featured_server: number | null;
  show_xp_progress: number | null;
  show_challenge_progress: number | null;
  show_calling_cards: number | null;
  show_award_dates: number | null;
  preferences_updated_at: string | null;
};

type PublicPlayerAggregateRow = {
  linked_public_servers: number | null;
  kills: number | null;
  deaths: number | null;
  suicides: number | null;
  longest_kill_distance: number | null;
  last_seen_at: string | null;
};

type PublicPlayerFeaturedServerRow = {
  public_slug: string;
  server_name: string | null;
  server_type: string | null;
  platform: string | null;
  map_name: string | null;
  kills: number | null;
  deaths: number | null;
  longest_kill_distance: number | null;
  last_seen_at: string | null;
};

const fallbackHandlePrefix = "dzn-player";
const maxPublicProfileLinkLookupIds = 100;
const publicProfileLinkLookupChunkSize = 50;
const publicServerWhere = `
  lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
  AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
  AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
  AND linked_servers.public_slug IS NOT NULL
  AND trim(linked_servers.public_slug) != ''
`;

export function publicProfileHref(handle: string) {
  return `/players/${handle}`;
}

export async function readPublicProfileLinksByDiscordIds(
  env: Env,
  discordIds: Array<string | null | undefined>,
): Promise<Map<string, PublicProfileLink>> {
  const ids = uniqueDiscordIds(discordIds).slice(0, maxPublicProfileLinkLookupIds);
  const links = new Map<string, PublicProfileLink>();
  if (ids.length === 0 || !env.DB) return links;

  const db = requireDb(env);
  for (let index = 0; index < ids.length; index += publicProfileLinkLookupChunkSize) {
    const chunk = ids.slice(index, index + publicProfileLinkLookupChunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await db
      .prepare(
        `SELECT
          users.discord_id,
          player_public_profiles.handle
         FROM users
         INNER JOIN player_public_profiles ON player_public_profiles.user_id = users.id
         INNER JOIN player_profile_privacy_preferences
           ON player_profile_privacy_preferences.user_id = users.id
         WHERE users.discord_id IN (${placeholders})
           AND player_public_profiles.status = 'active'
           AND player_profile_privacy_preferences.public_profile_enabled = 1`,
      )
      .bind(...chunk)
      .all<{ discord_id: string | null; handle: string | null }>()
      .catch(() => null);

    if (!rows) return links;

    for (const row of rows.results ?? []) {
      if (!row.discord_id || !row.handle) continue;
      links.set(row.discord_id, {
        handle: row.handle,
        href: publicProfileHref(row.handle),
      });
    }
  }

  return links;
}

export function normalizePublicProfileHandle(value: unknown) {
  return normalizeHandleToken(value, 48);
}

function normalizeHandleToken(value: unknown, maxLength: number) {
  const source = typeof value === "string" ? value : "";
  const boundedMaxLength = Math.max(3, Math.min(Math.trunc(maxLength), 48));
  const normalized = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, boundedMaxLength)
    .replace(/^-+|-+$/g, "");
  return normalized.length >= 3 ? normalized : fallbackHandlePrefix;
}

function uniqueDiscordIds(values: Array<string | null | undefined>) {
  const ids = new Set<string>();
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) ids.add(trimmed);
  }
  return [...ids];
}

export async function readCurrentPublicProfileHandle(env: Env, userId: string): Promise<PlayerPublicProfileHandle | null> {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT handle, status, created_at, updated_at
       FROM player_public_profiles
       WHERE user_id = ?
       LIMIT 1`,
    )
    .bind(userId)
    .first<ExistingPublicProfileRow>();

  if (!row?.handle) return null;
  return {
    handle: row.handle,
    href: publicProfileHref(row.handle),
    status: row.status === "disabled" ? "disabled" : "active",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function ensureCurrentPublicProfileHandle(env: Env, user: SessionUser): Promise<PlayerPublicProfileHandle> {
  const existing = await readCurrentPublicProfileHandle(env, user.id);
  if (existing?.status === "active") return existing;

  const db = requireDb(env);
  const baseHandle = normalizeHandleToken(user.username, 39);
  const now = new Date().toISOString();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomUUID().slice(0, attempt === 0 ? 6 : 8).toLowerCase();
    const candidate = normalizePublicProfileHandle(`${baseHandle}-${suffix}`);
    const existingHandle = await db
      .prepare("SELECT user_id FROM player_public_profiles WHERE handle = ? LIMIT 1")
      .bind(candidate)
      .first<{ user_id: string }>();
    if (existingHandle && existingHandle.user_id !== user.id) continue;

    try {
      await db
        .prepare(
          `INSERT INTO player_public_profiles (
            id,
            user_id,
            handle,
            status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, 'active', ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            status = 'active',
            updated_at = excluded.updated_at`,
        )
        .bind(crypto.randomUUID(), user.id, candidate, now, now)
        .run();
    } catch (error) {
      if (attempt < 9 && isHandleCollision(error)) continue;
      throw error;
    }

    const handle = await readCurrentPublicProfileHandle(env, user.id);
    if (handle) return handle;
  }

  throw new Error("public_profile_handle_unavailable");
}

function isHandleCollision(error: unknown) {
  return error instanceof Error && /unique constraint failed: player_public_profiles\.handle|constraint failed/i.test(error.message);
}

export async function readPublicPlayerProfileByHandle(env: Env, rawHandle: unknown): Promise<PublicPlayerProfilePayload | null> {
  const handle = normalizeLookupHandle(rawHandle);
  if (!handle) return null;

  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT
        player_public_profiles.user_id,
        player_public_profiles.handle,
        player_public_profiles.status,
        player_public_profiles.created_at,
        player_public_profiles.updated_at,
        users.discord_id,
        users.username,
        player_profile_privacy_preferences.public_profile_enabled,
        player_profile_privacy_preferences.show_display_name,
        player_profile_privacy_preferences.show_gameplay_summary,
        player_profile_privacy_preferences.show_featured_server,
        player_profile_privacy_preferences.show_xp_progress,
        player_profile_privacy_preferences.show_challenge_progress,
        player_profile_privacy_preferences.show_calling_cards,
        player_profile_privacy_preferences.show_award_dates,
        player_profile_privacy_preferences.updated_at AS preferences_updated_at
       FROM player_public_profiles
       INNER JOIN users ON users.id = player_public_profiles.user_id
       INNER JOIN player_profile_privacy_preferences
         ON player_profile_privacy_preferences.user_id = player_public_profiles.user_id
       WHERE player_public_profiles.handle = ?
         AND player_public_profiles.status = 'active'
         AND player_profile_privacy_preferences.public_profile_enabled = 1
       LIMIT 1`,
    )
    .bind(handle)
    .first<PublicPlayerProfileOwnerRow>();

  if (!row?.discord_id || row.public_profile_enabled !== 1) return null;

  const preferences = rowToPreferences(row);
  const [aggregate, featuredServer] = await Promise.all([
    preferences.show_gameplay_summary ? readPublicPlayerAggregate(db, row.discord_id) : Promise.resolve(null),
    preferences.show_featured_server ? readPublicPlayerFeaturedServer(db, row.discord_id) : Promise.resolve(null),
  ]);

  const visibleSections = visiblePublicProfileSections(preferences);
  const displayName = preferences.show_display_name ? safeDisplayName(row.username) : "DZN Player";

  return {
    ok: true,
    handle: row.handle,
    href: publicProfileHref(row.handle),
    display_name: displayName,
    published_at: row.created_at,
    updated_at: latestDateString(row.updated_at, row.preferences_updated_at),
    sections: {
      display_name: {
        visible: preferences.show_display_name,
        value: preferences.show_display_name ? displayName : null,
      },
      gameplay_summary: {
        visible: preferences.show_gameplay_summary,
        totals: preferences.show_gameplay_summary ? {
          kills: numberOrZero(aggregate?.kills),
          deaths: numberOrZero(aggregate?.deaths),
          suicides: numberOrZero(aggregate?.suicides),
          longest_kill_distance: numberOrZero(aggregate?.longest_kill_distance),
          linked_public_servers: numberOrZero(aggregate?.linked_public_servers),
        } : null,
        last_seen_at: preferences.show_gameplay_summary ? aggregate?.last_seen_at ?? null : null,
      },
      featured_server: {
        visible: preferences.show_featured_server,
        server: preferences.show_featured_server && featuredServer ? {
          public_slug: featuredServer.public_slug,
          href: `/servers/profile?slug=${encodeURIComponent(featuredServer.public_slug)}`,
          server_name: featuredServer.server_name || "DZN Server",
          server_type: featuredServer.server_type || "DayZ",
          platform: featuredServer.platform,
          map_name: featuredServer.map_name,
          kills: numberOrZero(featuredServer.kills),
          deaths: numberOrZero(featuredServer.deaths),
          longest_kill_distance: numberOrZero(featuredServer.longest_kill_distance),
          last_seen_at: featuredServer.last_seen_at,
        } : null,
      },
      xp_progress: futureEarnedSection(preferences.show_xp_progress, "XP progress is not published until trusted award sources exist."),
      challenge_progress: futureEarnedSection(preferences.show_challenge_progress, "Challenge progress is not published until challenge participation exists."),
      calling_cards: futureEarnedSection(preferences.show_calling_cards, "Calling cards are not published until account-bound earned cards exist."),
      award_dates: futureEarnedSection(preferences.show_award_dates, "Award dates are not published until public-safe award records exist."),
    },
    privacy: {
      public_profile_enabled: true,
      visible_sections: visibleSections,
    },
    safety: {
      public_safe: true,
      read_only: true,
      presentation_only: true,
      private_identifiers_exposed: false,
      raw_award_evidence_exposed: false,
    },
    fairness_boundary: [
      "Public player profiles are opt-in display surfaces only.",
      "Hidden profile sections are omitted from this response.",
      "No Discord IDs, DZN user IDs, raw player IDs, raw award evidence, payment state, or owner state is returned.",
      "Profile visibility cannot alter billing, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, or competitive eligibility.",
    ],
  };
}

function normalizeLookupHandle(value: unknown) {
  if (typeof value !== "string") return null;
  const handle = value.trim().toLowerCase();
  if (handle.length < 3 || handle.length > 48) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(handle)) return null;
  if (handle.includes("--")) return null;
  return handle;
}

function rowToPreferences(row: PublicPlayerProfileOwnerRow): PlayerPublicProfilePreferences {
  return {
    public_profile_enabled: row.public_profile_enabled === 1,
    show_display_name: row.show_display_name !== 0,
    show_gameplay_summary: row.show_gameplay_summary !== 0,
    show_featured_server: row.show_featured_server !== 0,
    show_xp_progress: row.show_xp_progress !== 0,
    show_challenge_progress: row.show_challenge_progress !== 0,
    show_calling_cards: row.show_calling_cards !== 0,
    show_award_dates: row.show_award_dates === 1,
  };
}

async function readPublicPlayerAggregate(db: D1Database, discordId: string) {
  const result = await db
    .prepare(
      `SELECT
        COUNT(DISTINCT player_profiles.linked_server_id) AS linked_public_servers,
        COALESCE(SUM(COALESCE(player_profiles.kills, 0)), 0) AS kills,
        COALESCE(SUM(COALESCE(player_profiles.deaths, 0)), 0) AS deaths,
        COALESCE(SUM(COALESCE(player_profiles.suicides, 0)), 0) AS suicides,
        COALESCE(MAX(COALESCE(player_profiles.longest_kill_distance, 0)), 0) AS longest_kill_distance,
        MAX(COALESCE(player_profiles.last_seen_at, player_profiles.updated_at, player_profiles.created_at)) AS last_seen_at
       FROM player_profiles
       INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
       WHERE player_profiles.discord_id = ?
         AND ${publicServerWhere}`,
    )
    .bind(discordId)
    .first<PublicPlayerAggregateRow>();

  return result ?? null;
}

async function readPublicPlayerFeaturedServer(db: D1Database, discordId: string) {
  const result = await db
    .prepare(
      `SELECT
        linked_servers.public_slug,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        COALESCE(NULLIF(linked_servers.server_category, ''), NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
        linked_servers.platform,
        linked_servers.map_name,
        player_profiles.kills,
        player_profiles.deaths,
        player_profiles.longest_kill_distance,
        COALESCE(player_profiles.last_seen_at, player_profiles.updated_at, player_profiles.created_at) AS last_seen_at
       FROM player_profiles
       INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
       WHERE player_profiles.discord_id = ?
         AND ${publicServerWhere}
       ORDER BY COALESCE(player_profiles.kills, 0) DESC,
         COALESCE(player_profiles.longest_kill_distance, 0) DESC,
         datetime(COALESCE(player_profiles.last_seen_at, player_profiles.updated_at, player_profiles.created_at)) DESC
       LIMIT 1`,
    )
    .bind(discordId)
    .first<PublicPlayerFeaturedServerRow>();

  return result ?? null;
}

function futureEarnedSection(visible: boolean, visibleMessage: string) {
  return {
    visible,
    status: visible ? "not_available_yet" as const : "hidden" as const,
    message: visible ? visibleMessage : "This section is hidden by the player's saved profile preferences.",
  };
}

function visiblePublicProfileSections(preferences: PlayerPublicProfilePreferences) {
  const sections: string[] = [];
  if (preferences.show_display_name) sections.push("display_name");
  if (preferences.show_gameplay_summary) sections.push("gameplay_summary");
  if (preferences.show_featured_server) sections.push("featured_server");
  if (preferences.show_xp_progress) sections.push("xp_progress");
  if (preferences.show_challenge_progress) sections.push("challenge_progress");
  if (preferences.show_calling_cards) sections.push("calling_cards");
  if (preferences.show_award_dates) sections.push("award_dates");
  return sections;
}

function safeDisplayName(value: string | null) {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  return trimmed || "DZN Player";
}

function latestDateString(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime)) return right;
  if (!Number.isFinite(rightTime)) return left;
  return rightTime > leftTime ? right : left;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}
