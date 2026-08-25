import { getEventsListPayload } from "../../_lib/events";
import { json, methodNotAllowed } from "../../_lib/http";
import { pricingUrlForOwnerAccess, getRequestSessionUser } from "../../_lib/owner-access";
import { getPlayerChallengesPayload, type PlayerProgressSummary } from "../../_lib/player-progression";
import { getPlayerProfilePrivacyPreferences, type PlayerProfilePrivacyPreferences } from "../../_lib/player-profile-privacy";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";
import { getPlayerCommunitiesPayload, type PlayerCommunitySummary } from "./communities";

type PlayerHubServerRow = {
  linked_server_id: string;
  public_slug: string | null;
  server_name: string | null;
  server_type: string | null;
  server_category: string | null;
  platform: string | null;
  map_name: string | null;
  current_players: number | null;
  max_players: number | null;
  public_short_description: string | null;
  public_discord_invite: string | null;
  status: string | null;
  listing_visibility: string | null;
  guild_name: string | null;
  guild_icon_url: string | null;
  saved_at?: string | null;
};

type PlayerHubServerSummary = {
  linked_server_id: string;
  public_slug: string | null;
  server_name: string;
  server_type: string | null;
  server_category: string | null;
  platform: string | null;
  map_name: string | null;
  current_players: number | null;
  max_players: number | null;
  public_short_description: string | null;
  public_discord_invite: string | null;
  status: string | null;
  listing_visibility: string | null;
  guild_name: string | null;
  guild_icon_url: string | null;
  saved_at: string | null;
  href: string;
};

type PlayerHubCommunitySummary = Omit<PlayerCommunitySummary, "matched_servers"> & {
  matched_servers: PlayerHubServerSummary[];
};

type PlayerHubEventSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  category_label: string | null;
  event_type: string | null;
  event_type_label: string | null;
  status: string | null;
  status_label: string | null;
  starts_at: string | null;
  registered_servers: number;
  total_participants: number;
  href: string;
};

type SavedServerSection = {
  source: "saved" | "not_configured" | "unavailable";
  servers: PlayerHubServerSummary[];
};

type SuggestedServerSection = {
  source: "live" | "display_fallback" | "unavailable";
  servers: PlayerHubServerSummary[];
};

type SuggestedEventSection = {
  source: string;
  events: PlayerHubEventSummary[];
  tournaments: PlayerHubEventSummary[];
};

type PlayerHubPublicProfileSummary = {
  public_profile_enabled: boolean;
  public_handle: string | null;
  public_href: string | null;
  public_api_href: string | null;
  settings_href: string;
};

const OWNER_SETUP_RETURN_TO = "/setup";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await getRequestSessionUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const [communitiesResult, savedServers, suggestedServers, suggestedEvents, playerChallenges, profilePrivacy] = await Promise.all([
    getPlayerCommunitiesPayload(env, user).catch(() => ({
      status: 200 as const,
      payload: {
        ok: true as const,
        communities: [],
        needs_discord_refresh: true,
        matched_guild_count: 0,
        matched_server_count: 0,
        fetched_at: new Date().toISOString(),
        error: "Discord communities could not be refreshed right now.",
      },
    })),
    readSavedServers(env, user),
    readSuggestedServers(env),
    readSuggestedEvents(env, user),
    getPlayerChallengesPayload(env, user).catch(() => ({
      ok: true as const,
      source: "not_configured" as const,
      challenges: [],
      player_progress: emptyPlayerProgress("not_configured"),
      fetched_at: new Date().toISOString(),
    })),
    getPlayerProfilePrivacyPreferences(env, user),
  ]);

  return json({
    ok: true,
    user: publicUser(user),
    access: {
      role: "player",
      can_use_player_surfaces: true,
      owner_setup_href: pricingUrlForOwnerAccess(OWNER_SETUP_RETURN_TO),
      owner_setup_requires_entitlement: true,
    },
    communities: communitiesResult.payload.communities.map(toHubCommunity),
    communities_status: {
      needs_discord_refresh: communitiesResult.payload.needs_discord_refresh,
      matched_guild_count: communitiesResult.payload.matched_guild_count,
      matched_server_count: communitiesResult.payload.matched_server_count,
      error: communitiesResult.payload.error ?? null,
    },
    saved_servers: savedServers,
    suggested_servers: suggestedServers,
    suggested_events: suggestedEvents,
    player_progress: playerChallenges.player_progress,
    public_profile: toPublicProfileSummary(profilePrivacy),
    profile_entry_points: profileEntryPoints(profilePrivacy),
    fetched_at: new Date().toISOString(),
  });
};

function publicUser(user: SessionUser) {
  return {
    id: user.id,
    discord_id: user.discord_id,
    username: user.username,
    avatar: user.avatar,
  };
}

function toHubCommunity(community: PlayerCommunitySummary): PlayerHubCommunitySummary {
  return {
    ...community,
    matched_servers: community.matched_servers.map((server) => {
      const slug = safeSlug(server.public_slug);
      return {
        linked_server_id: server.linked_server_id,
        public_slug: slug,
        server_name: stringOrDefault(server.server_name, "DZN Server"),
        server_type: nullableString(server.server_type),
        server_category: nullableString(server.server_category),
        platform: nullableString(server.platform),
        map_name: nullableString(server.map_name),
        current_players: nullableNumber(server.current_players),
        max_players: nullableNumber(server.max_players),
        public_short_description: nullableString(server.public_short_description),
        public_discord_invite: nullableString(server.public_discord_invite),
        status: nullableString(server.status),
        listing_visibility: nullableString(server.listing_visibility),
        guild_name: community.guild_name,
        guild_icon_url: community.guild_icon_url,
        saved_at: null,
        href: slug ? `/servers/profile?slug=${encodeURIComponent(slug)}` : "/servers",
      };
    }),
  };
}

async function readSavedServers(env: Env, user: SessionUser): Promise<SavedServerSection> {
  if (!env.DB) return { source: "unavailable", servers: [] };
  try {
    const rows = await env.DB
      .prepare(
        `SELECT
           player_saved_servers.created_at AS saved_at,
           linked_servers.id AS linked_server_id,
           linked_servers.public_slug,
           COALESCE(
             linked_servers.display_name,
             linked_servers.hostname,
             linked_servers.server_name,
             linked_servers.nitrado_service_name,
             'DZN Server'
           ) AS server_name,
           linked_servers.server_type,
           linked_servers.server_category,
           linked_servers.platform,
           linked_servers.map_name,
           linked_servers.current_players,
           linked_servers.max_players,
           linked_servers.public_short_description,
           linked_servers.public_discord_invite,
           linked_servers.status,
           linked_servers.listing_visibility,
           discord_guilds.name AS guild_name,
           discord_guilds.icon_url AS guild_icon_url
         FROM player_saved_servers
         INNER JOIN linked_servers ON linked_servers.id = player_saved_servers.linked_server_id
         LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
         WHERE player_saved_servers.user_id = ?
           AND lower(COALESCE(linked_servers.status, 'pending')) != 'deleted'
           AND lower(COALESCE(linked_servers.status, 'pending')) != 'merged'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         ORDER BY datetime(COALESCE(player_saved_servers.updated_at, player_saved_servers.created_at)) DESC
         LIMIT 8`,
      )
      .bind(user.id)
      .all<PlayerHubServerRow>();

    return {
      source: "saved",
      servers: (rows.results ?? []).map(toHubServer),
    };
  } catch {
    return { source: "not_configured", servers: [] };
  }
}

async function readSuggestedServers(env: Env): Promise<SuggestedServerSection> {
  if (!env.DB) return { source: "display_fallback", servers: demoSuggestedServers() };
  try {
    const rows = await env.DB
      .prepare(
        `SELECT
           linked_servers.id AS linked_server_id,
           linked_servers.public_slug,
           COALESCE(
             linked_servers.display_name,
             linked_servers.hostname,
             linked_servers.server_name,
             linked_servers.nitrado_service_name,
             'DZN Server'
           ) AS server_name,
           linked_servers.server_type,
           linked_servers.server_category,
           linked_servers.platform,
           linked_servers.map_name,
           linked_servers.current_players,
           linked_servers.max_players,
           linked_servers.public_short_description,
           linked_servers.public_discord_invite,
           linked_servers.status,
           linked_servers.listing_visibility,
           discord_guilds.name AS guild_name,
           discord_guilds.icon_url AS guild_icon_url
         FROM linked_servers
         LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
         WHERE lower(COALESCE(linked_servers.status, 'pending')) != 'deleted'
           AND lower(COALESCE(linked_servers.status, 'pending')) != 'merged'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         ORDER BY
           CASE WHEN lower(COALESCE(linked_servers.status, 'pending')) = 'live' THEN 0 ELSE 1 END,
           COALESCE(linked_servers.current_players, 0) DESC,
           datetime(COALESCE(linked_servers.updated_at, linked_servers.created_at)) DESC
         LIMIT 8`,
      )
      .all<PlayerHubServerRow>();

    const servers = (rows.results ?? []).map(toHubServer);
    return {
      source: servers.length ? "live" : "display_fallback",
      servers: servers.length ? servers : demoSuggestedServers(),
    };
  } catch {
    return { source: "display_fallback", servers: demoSuggestedServers() };
  }
}

async function readSuggestedEvents(env: Env, user: SessionUser): Promise<SuggestedEventSection> {
  try {
    const payload = await getEventsListPayload(env, user, { status: "upcoming", limit: 8 });
    const rows = Array.isArray((payload as { events?: unknown }).events)
      ? (payload as { events: unknown[] }).events
      : [];
    const events = rows.map(toHubEvent).filter((event): event is PlayerHubEventSummary => Boolean(event));
    return {
      source: stringOrDefault((payload as { source?: unknown }).source, "unavailable"),
      events: events.slice(0, 4),
      tournaments: events.filter(isTournamentLikeEvent).slice(0, 4),
    };
  } catch {
    return { source: "unavailable", events: [], tournaments: [] };
  }
}

function toHubServer(row: PlayerHubServerRow): PlayerHubServerSummary {
  const slug = safeSlug(row.public_slug);
  return {
    linked_server_id: row.linked_server_id,
    public_slug: slug,
    server_name: stringOrDefault(row.server_name, "DZN Server"),
    server_type: nullableString(row.server_type),
    server_category: nullableString(row.server_category),
    platform: nullableString(row.platform),
    map_name: nullableString(row.map_name),
    current_players: nullableNumber(row.current_players),
    max_players: nullableNumber(row.max_players),
    public_short_description: nullableString(row.public_short_description),
    public_discord_invite: nullableString(row.public_discord_invite),
    status: nullableString(row.status),
    listing_visibility: nullableString(row.listing_visibility),
    guild_name: nullableString(row.guild_name),
    guild_icon_url: nullableString(row.guild_icon_url),
    saved_at: nullableString(row.saved_at),
    href: slug ? `/servers/profile?slug=${encodeURIComponent(slug)}` : "/servers",
  };
}

function toHubEvent(value: unknown): PlayerHubEventSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const slug = stringOrDefault(record.slug, "");
  const name = stringOrDefault(record.name, "");
  if (!slug || !name) return null;
  return {
    id: stringOrDefault(record.id, slug),
    name,
    slug,
    description: nullableString(record.description),
    category: nullableString(record.category),
    category_label: nullableString(record.category_label),
    event_type: nullableString(record.event_type),
    event_type_label: nullableString(record.event_type_label),
    status: nullableString(record.status),
    status_label: nullableString(record.status_label),
    starts_at: nullableString(record.starts_at),
    registered_servers: numberOrZero(record.registered_servers),
    total_participants: numberOrZero(record.total_participants),
    href: `/events/${encodeURIComponent(slug)}`,
  };
}

function isTournamentLikeEvent(event: PlayerHubEventSummary) {
  const haystack = `${event.event_type ?? ""} ${event.event_type_label ?? ""} ${event.name}`.toLowerCase();
  return haystack.includes("tournament")
    || haystack.includes("cup")
    || haystack.includes("war")
    || haystack.includes("flag")
    || haystack.includes("season");
}

function toPublicProfileSummary(privacy: PlayerProfilePrivacyPreferences): PlayerHubPublicProfileSummary {
  return {
    public_profile_enabled: privacy.public_profile_enabled,
    public_handle: privacy.public_handle,
    public_href: privacy.public_href,
    public_api_href: privacy.public_api_href,
    settings_href: privacy.settings_href,
  };
}

function profileEntryPoints(privacy: PlayerProfilePrivacyPreferences) {
  const publicProfileReady = privacy.public_profile_enabled && privacy.public_href;
  return [
    {
      key: "activity",
      label: "DZN Pulse",
      href: "/dzn-pulse",
      description: "Notifications and community activity.",
    },
    {
      key: "leaderboards",
      label: "Leaderboards",
      href: "/leaderboards",
      description: "Player and server competitive records.",
    },
    {
      key: "events",
      label: "Events",
      href: "/events",
      description: "Tournaments, brackets and community event discovery.",
    },
    {
      key: "challenges",
      label: "Challenges",
      href: "/events/challenges",
      description: "Challenge participation, XP and calling cards.",
    },
    {
      key: "profile",
      label: "Player Profile",
      href: "/player/profile",
      description: "Profile, calling cards and earned progression entry point.",
    },
    {
      key: "public_profile",
      label: publicProfileReady ? "Public Profile" : "Public Profile Settings",
      href: publicProfileReady ? privacy.public_href! : "/player/profile",
      description: publicProfileReady ? "Open and share your published DZN player profile." : "Choose which player profile sections can be public.",
    },
    {
      key: "owner_setup",
      label: "Add Server",
      href: pricingUrlForOwnerAccess(OWNER_SETUP_RETURN_TO),
      description: "Owner setup stays behind Starter or Pro.",
      owner_entitlement_required: true,
    },
  ];
}

function emptyPlayerProgress(source: PlayerProgressSummary["source"]): PlayerProgressSummary {
  return {
    source,
    total_xp: 0,
    available_challenges: 0,
    joined_challenges: 0,
    completed_challenges: 0,
    calling_cards: [],
    recent_challenges: [],
    href: "/events/challenges",
  };
}

function demoSuggestedServers(): PlayerHubServerSummary[] {
  return [
    {
      linked_server_id: "demo-pandora-dayz",
      public_slug: "pandora-dayz",
      server_name: "Pandora DayZ",
      server_type: "PVP",
      server_category: "pvp",
      platform: "PlayStation",
      map_name: "Chernarus",
      current_players: 42,
      max_players: 60,
      public_short_description: "High-pop PvP community with DZN event support.",
      public_discord_invite: null,
      status: "live",
      listing_visibility: "public",
      guild_name: "Pandora Community",
      guild_icon_url: null,
      saved_at: null,
      href: "/servers/profile?slug=pandora-dayz",
    },
    {
      linked_server_id: "demo-warlords-pvp",
      public_slug: "warlords-pvp",
      server_name: "Warlords PvP",
      server_type: "DEATHMATCH",
      server_category: "deathmatch",
      platform: "Xbox",
      map_name: "Livonia",
      current_players: 31,
      max_players: 70,
      public_short_description: "Fast fights, ranked players and event-ready squads.",
      public_discord_invite: null,
      status: "live",
      listing_visibility: "public",
      guild_name: "Warlords Community",
      guild_icon_url: null,
      saved_at: null,
      href: "/servers/profile?slug=warlords-pvp",
    },
  ];
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeSlug(value: unknown) {
  const text = stringOrDefault(value, "");
  return /^[a-z0-9][a-z0-9-]{0,95}$/.test(text) ? text : null;
}

function nullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
