import {
  normalizePublicProfileHandle,
  publicPlayerProfileApiHref,
  publicPlayerProfileHref,
  playerProfilePrivacyFairness,
  type PlayerProfilePrivacyPreferences,
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

export type PublicProfileAppearanceLinkState =
  | "visible_when_present"
  | "eligible_when_unique_user_bridge"
  | "hidden_until_public_profile"
  | "hidden_until_generated_handle"
  | "future_safe_extension";

export type PublicProfileAppearancePlacement = {
  key:
    | "public_profile_page"
    | "server_review_author_rows"
    | "event_suggestion_author_rows"
    | "public_event_creator_member_rows"
    | "ctf_event_presentation_roster_rows"
    | "player_challenge_rows"
    | "player_hub_challenge_rows"
    | "safe_leaderboard_mentions"
    | "future_player_safe_member_rosters";
  label: string;
  description: string;
  href: string;
  public_surface: boolean;
  can_show_public_profile_link: boolean;
  link_state: PublicProfileAppearanceLinkState;
  requires_generated_handle: boolean;
  requires_unique_user_bridge: boolean;
  controlled_by: "public_profile_visibility";
  exposes_private_identifiers: false;
  affects_competition: false;
};

export type PublicProfileExcludedAttributionSurface = {
  key: "ctf_event_scoring_rosters" | "event_roster_scoring_and_decision_rows" | "owner_admin_review_tools" | "owner_event_management";
  label: string;
  reason: string;
  public_profile_links_enabled: false;
  affects_competition: false;
};

export type PublicProfileAppearancePreview = {
  public_profile_enabled: boolean;
  ready: boolean;
  public_handle: string | null;
  public_href: string | null;
  public_api_href: string | null;
  settings_href: string;
  control: {
    key: "public_profile_visibility";
    label: "Allow public profile display";
    settings_href: string;
    disables_all_public_attribution_links: true;
  };
  placements: PublicProfileAppearancePlacement[];
  excluded_surfaces: PublicProfileExcludedAttributionSurface[];
  fairness: PublicProfileAttributionFairness;
};

type PublicProfileAttributionRow = {
  user_id?: string | null;
  discord_id?: string | null;
  username?: string | null;
  public_handle?: string | null;
};

type PublicProfileRosterAttributionRow = PublicProfileAttributionRow & {
  linked_server_id?: string | null;
  player_id?: string | null;
  matched_user_count?: number | null;
};

export type PublicProfileRosterPlayerKey = {
  linked_server_id?: string | null;
  player_id?: string | null;
};

const MAX_ATTRIBUTION_LOOKUP_IDS = 100;

export function publicProfileAttributionFairness(): PublicProfileAttributionFairness {
  return playerProfilePrivacyFairness();
}

export function buildPublicProfileAppearancePreview(
  privacy: Pick<
    PlayerProfilePrivacyPreferences,
    "public_profile_enabled" | "public_handle" | "public_href" | "public_api_href" | "settings_href"
  >,
): PublicProfileAppearancePreview {
  const publicHandle = normalizePublicProfileHandle(privacy.public_handle);
  const publicHref = publicPlayerProfileHref(publicHandle);
  const publicApiHref = publicPlayerProfileApiHref(publicHandle);
  const hasGeneratedHandle = Boolean(publicHandle && publicHref && publicApiHref);
  const ready = Boolean(privacy.public_profile_enabled && hasGeneratedHandle);
  const publicProfileLinkState: PublicProfileAppearanceLinkState = ready
    ? "visible_when_present"
    : privacy.public_profile_enabled
      ? "hidden_until_generated_handle"
      : "hidden_until_public_profile";
  const bridgeLinkState: PublicProfileAppearanceLinkState = ready
    ? "eligible_when_unique_user_bridge"
    : publicProfileLinkState;

  return {
    public_profile_enabled: Boolean(privacy.public_profile_enabled),
    ready,
    public_handle: publicHandle,
    public_href: ready ? publicHref : null,
    public_api_href: ready ? publicApiHref : null,
    settings_href: privacy.settings_href,
    control: {
      key: "public_profile_visibility",
      label: "Allow public profile display",
      settings_href: privacy.settings_href,
      disables_all_public_attribution_links: true,
    },
    placements: [
      attributionPlacement({
        key: "public_profile_page",
        label: "Public profile page",
        description: "Your generated DZN player profile route.",
        href: publicHref ?? "/player/profile",
        publicSurface: true,
        ready,
        linkState: publicProfileLinkState,
        requiresUniqueUserBridge: false,
      }),
      attributionPlacement({
        key: "server_review_author_rows",
        label: "Review author rows",
        description: "Approved public server reviews you wrote can link to your profile.",
        href: "/servers",
        publicSurface: true,
        ready,
        linkState: publicProfileLinkState,
        requiresUniqueUserBridge: true,
      }),
      attributionPlacement({
        key: "event_suggestion_author_rows",
        label: "Event suggestion author rows",
        description: "Public community event suggestions you submit can link to your profile.",
        href: "/events/suggest",
        publicSurface: true,
        ready,
        linkState: publicProfileLinkState,
        requiresUniqueUserBridge: true,
      }),
      attributionPlacement({
        key: "public_event_creator_member_rows",
        label: "Public event host/member rows",
        description: "Public event host/member badges can link only through competitive_events.created_by.",
        href: "/events",
        publicSurface: true,
        ready,
        linkState: bridgeLinkState,
        requiresUniqueUserBridge: true,
      }),
      attributionPlacement({
        key: "ctf_event_presentation_roster_rows",
        label: "CTF/event presentation roster rows",
        description: "Read-only roster display rows can link only through an exact server/player account bridge.",
        href: "/dashboard/register-event",
        publicSurface: false,
        ready,
        linkState: bridgeLinkState,
        requiresUniqueUserBridge: true,
      }),
      attributionPlacement({
        key: "player_challenge_rows",
        label: "Challenge participation rows",
        description: "Player-facing challenge participation rows can point back to your profile.",
        href: "/events/challenges",
        publicSurface: false,
        ready,
        linkState: publicProfileLinkState,
        requiresUniqueUserBridge: true,
      }),
      attributionPlacement({
        key: "player_hub_challenge_rows",
        label: "Player Hub challenge rows",
        description: "Your private Player Hub challenge rows can preview the same public profile link.",
        href: "/player",
        publicSurface: false,
        ready,
        linkState: publicProfileLinkState,
        requiresUniqueUserBridge: true,
      }),
      attributionPlacement({
        key: "safe_leaderboard_mentions",
        label: "Safe leaderboard mentions",
        description: "Leaderboard player names can link only when DZN has one trusted user match.",
        href: "/leaderboards",
        publicSurface: true,
        ready,
        linkState: bridgeLinkState,
        requiresUniqueUserBridge: true,
      }),
      {
        key: "future_player_safe_member_rosters",
        label: "Future player-safe member or roster rows",
        description: "New member or roster rows stay off until they prove a unique trusted user bridge.",
        href: "/player/profile",
        public_surface: false,
        can_show_public_profile_link: false,
        link_state: "future_safe_extension",
        requires_generated_handle: true,
        requires_unique_user_bridge: true,
        controlled_by: "public_profile_visibility",
        exposes_private_identifiers: false,
        affects_competition: false,
      },
    ],
    excluded_surfaces: [
      {
        key: "ctf_event_scoring_rosters",
        label: "CTF/event scoring roster gates",
        reason: "Roster writes, scoring checks, eligibility gates, and accepted audit feeds stay excluded; only read-only presentation rows may carry links.",
        public_profile_links_enabled: false,
        affects_competition: false,
      },
      {
        key: "event_roster_scoring_and_decision_rows",
        label: "Event roster scoring and decision rows",
        reason: "Public profile links stay off rows that affect scoring, eligibility, approvals, brackets, owner actions, or event outcomes.",
        public_profile_links_enabled: false,
        affects_competition: false,
      },
      {
        key: "owner_admin_review_tools",
        label: "Owner/admin moderation tools",
        reason: "Excluded from public attribution because these are private management views.",
        public_profile_links_enabled: false,
        affects_competition: false,
      },
      {
        key: "owner_event_management",
        label: "Owner event management",
        reason: "Excluded until a dedicated slice proves links are presentation-only.",
        public_profile_links_enabled: false,
        affects_competition: false,
      },
    ],
    fairness: publicProfileAttributionFairness(),
  };
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

export async function readPublicProfileAttributionsByRosterPlayerKeys(
  env: Env,
  rosterKeys: PublicProfileRosterPlayerKey[],
): Promise<Map<string, PublicProfileAttribution>> {
  if (!env.DB) return new Map();
  const keys = uniqueRosterPlayerKeys(rosterKeys).slice(0, MAX_ATTRIBUTION_LOOKUP_IDS);
  if (!keys.length) return new Map();
  const requested = new Set(keys.map((item) => item.key));
  const where = keys.map(() => "(player_profiles.linked_server_id = ? AND player_profiles.player_id = ?)").join(" OR ");
  const bindings = keys.flatMap((item) => [item.linkedServerId, item.playerId]);

  try {
    const rows = await env.DB
      .prepare(
        `SELECT
           player_profiles.linked_server_id,
           player_profiles.player_id,
           users.username,
           player_profile_privacy_preferences.public_handle,
           COUNT(DISTINCT users.id) AS matched_user_count
         FROM player_profiles
         INNER JOIN users ON users.discord_id = player_profiles.discord_id
         INNER JOIN player_profile_privacy_preferences ON player_profile_privacy_preferences.user_id = users.id
         WHERE (${where})
           AND player_profiles.discord_id IS NOT NULL
           AND player_profiles.discord_id != ''
           AND player_profile_privacy_preferences.public_profile_enabled = 1
           AND player_profile_privacy_preferences.public_handle IS NOT NULL
         GROUP BY player_profiles.linked_server_id, player_profiles.player_id
         HAVING COUNT(DISTINCT users.id) = 1`,
      )
      .bind(...bindings)
      .all<PublicProfileRosterAttributionRow>();
    return rowsToRosterAttributionMap(rows.results ?? [], requested);
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

export function publicProfileRosterPlayerKey(value: PublicProfileRosterPlayerKey) {
  const linkedServerId = cleanRosterLookupText(value.linked_server_id);
  const playerId = cleanRosterLookupText(value.player_id);
  return linkedServerId && playerId ? JSON.stringify([linkedServerId, playerId]) : null;
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

function rowsToRosterAttributionMap(
  rows: PublicProfileRosterAttributionRow[],
  requested: Set<string>,
) {
  const map = new Map<string, PublicProfileAttribution>();
  for (const row of rows) {
    if (Number(row.matched_user_count ?? 1) !== 1) continue;
    const key = publicProfileRosterPlayerKey(row);
    if (!key || !requested.has(key)) continue;
    const attribution = publicProfileAttributionFromRow(row);
    if (attribution) map.set(key, attribution);
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

function uniqueRosterPlayerKeys(values: PublicProfileRosterPlayerKey[]) {
  const map = new Map<string, { key: string; linkedServerId: string; playerId: string }>();
  for (const value of values) {
    const linkedServerId = cleanRosterLookupText(value.linked_server_id);
    const playerId = cleanRosterLookupText(value.player_id);
    if (!linkedServerId || !playerId) continue;
    const key = publicProfileRosterPlayerKey({ linked_server_id: linkedServerId, player_id: playerId });
    if (key && !map.has(key)) map.set(key, { key, linkedServerId, playerId });
  }
  return [...map.values()];
}

function cleanRosterLookupText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function attributionPlacement(input: {
  key: PublicProfileAppearancePlacement["key"];
  label: string;
  description: string;
  href: string;
  publicSurface: boolean;
  ready: boolean;
  linkState: PublicProfileAppearanceLinkState;
  requiresUniqueUserBridge: boolean;
}): PublicProfileAppearancePlacement {
  return {
    key: input.key,
    label: input.label,
    description: input.description,
    href: input.href,
    public_surface: input.publicSurface,
    can_show_public_profile_link: input.ready,
    link_state: input.linkState,
    requires_generated_handle: true,
    requires_unique_user_bridge: input.requiresUniqueUserBridge,
    controlled_by: "public_profile_visibility",
    exposes_private_identifiers: false,
    affects_competition: false,
  };
}
