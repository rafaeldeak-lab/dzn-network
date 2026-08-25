import {
  normalizePublicProfileHandle,
  publicPlayerProfileApiHref,
  publicPlayerProfileHref,
  playerProfilePrivacyFairness,
  type PlayerProfilePrivacyFairness,
} from "./player-profile-privacy";
import type { Env, SessionUser } from "./types";

export type PublicProfileAttribution = {
  display_name: string;
  public_handle: string;
  public_href: string;
  public_api_href: string;
};

export type PublicProfileAttributionFairness = PlayerProfilePrivacyFairness;

type PublicProfileAttributionRow = {
  user_id?: string | null;
  discord_id?: string | null;
  username?: string | null;
  public_handle?: string | null;
};

const MAX_ATTRIBUTION_LOOKUP_IDS = 100;

export function publicProfileAttributionFairness(): PublicProfileAttributionFairness {
  return playerProfilePrivacyFairness();
}

export async function readPublicProfileAttributionsByUserIds(
  env: Env,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, PublicProfileAttribution>> {
  if (!env.DB) return new Map();
  const ids = uniqueNonEmptyStrings(userIds).slice(0, MAX_ATTRIBUTION_LOOKUP_IDS);
  if (!ids.length) return new Map();

  try {
    const rows = await env.DB
      .prepare(
        `SELECT
           users.id AS user_id,
           users.username,
           player_profile_privacy_preferences.public_handle
         FROM player_profile_privacy_preferences
         INNER JOIN users ON users.id = player_profile_privacy_preferences.user_id
         WHERE player_profile_privacy_preferences.user_id IN (${placeholders(ids.length)})
           AND player_profile_privacy_preferences.public_profile_enabled = 1
           AND player_profile_privacy_preferences.public_handle IS NOT NULL`,
      )
      .bind(...ids)
      .all<PublicProfileAttributionRow>();
    return rowsToAttributionMap(rows.results ?? [], "user_id");
  } catch {
    return new Map();
  }
}

export async function readPublicProfileAttributionsByDiscordIds(
  env: Env,
  discordIds: Array<string | null | undefined>,
): Promise<Map<string, PublicProfileAttribution>> {
  if (!env.DB) return new Map();
  const ids = uniqueNonEmptyStrings(discordIds).slice(0, MAX_ATTRIBUTION_LOOKUP_IDS);
  if (!ids.length) return new Map();

  try {
    const rows = await env.DB
      .prepare(
        `SELECT
           users.discord_id,
           users.username,
           player_profile_privacy_preferences.public_handle
         FROM player_profile_privacy_preferences
         INNER JOIN users ON users.id = player_profile_privacy_preferences.user_id
         WHERE users.discord_id IN (${placeholders(ids.length)})
           AND player_profile_privacy_preferences.public_profile_enabled = 1
           AND player_profile_privacy_preferences.public_handle IS NOT NULL`,
      )
      .bind(...ids)
      .all<PublicProfileAttributionRow>();
    return rowsToAttributionMap(rows.results ?? [], "discord_id");
  } catch {
    return new Map();
  }
}

export async function readPublicProfileAttributionForSessionUser(
  env: Env,
  user: SessionUser,
): Promise<PublicProfileAttribution | null> {
  const attributions = await readPublicProfileAttributionsByUserIds(env, [user.id]);
  return attributions.get(user.id) ?? null;
}

export function publicProfileAttributionFromRow(row: {
  username?: string | null;
  public_handle?: string | null;
}): PublicProfileAttribution | null {
  const publicHandle = normalizePublicProfileHandle(row.public_handle);
  const publicHref = publicPlayerProfileHref(publicHandle);
  const publicApiHref = publicPlayerProfileApiHref(publicHandle);
  if (!publicHandle || !publicHref || !publicApiHref) return null;
  return {
    display_name: publicAttributionDisplayName(row.username),
    public_handle: publicHandle,
    public_href: publicHref,
    public_api_href: publicApiHref,
  };
}

export function publicAttributionDisplayName(value: unknown) {
  const displayName = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return displayName.slice(0, 48) || "DZN Player";
}

function rowsToAttributionMap(
  rows: PublicProfileAttributionRow[],
  key: "user_id" | "discord_id",
) {
  const map = new Map<string, PublicProfileAttribution>();
  for (const row of rows) {
    const id = key === "user_id" ? row.user_id : row.discord_id;
    if (!id) continue;
    const attribution = publicProfileAttributionFromRow(row);
    if (attribution) map.set(id, attribution);
  }
  return map;
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(
    values
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean),
  ));
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}
