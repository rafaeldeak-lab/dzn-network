import { requireDb } from "./db";
import {
  publicProfileAttributionFairness,
  readPublicProfileAttributionsByUserIds,
  type PublicProfileAttribution,
  type PublicProfileAttributionFairness,
} from "./public-profile-attribution";
import type { Env } from "./types";

type PublicCommunityServerRow = {
  public_slug: string | null;
  server_name: string | null;
  community_guild_id: string | null;
  community_name: string | null;
  community_icon_url: string | null;
};

type CommunityMemberRow = {
  user_id: string | null;
  role_label: string | null;
  display_order: number | null;
  created_at: string | null;
};

export type PublicCommunityMember = {
  display_name: string;
  role_label: string | null;
  member_since_label: string | null;
  public_profile: PublicProfileAttribution;
};

export type PublicCommunityMemberDirectoryPayload = {
  ok: true;
  available: boolean;
  source: "live" | "not_configured" | "unavailable";
  server: {
    public_slug: string;
    server_name: string;
    href: string;
  };
  community: {
    name: string;
    icon_url: string | null;
    member_count: number;
  };
  members: PublicCommunityMember[];
  message: string | null;
  profile_attribution: ReturnType<typeof publicCommunityMemberDirectorySafeguards>;
  fetched_at: string;
};

export type PublicCommunityMemberDirectoryResult = {
  status: 200 | 404;
  payload:
    | PublicCommunityMemberDirectoryPayload
    | {
        ok: false;
        error: "server_not_found";
        message: string;
      };
};

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 96;

export async function getPublicCommunityMemberDirectoryPayload(
  env: Env,
  serverRef: unknown,
  options: { limit?: number } = {},
): Promise<PublicCommunityMemberDirectoryResult> {
  const ref = cleanServerRef(serverRef);
  if (!ref) {
    return {
      status: 404,
      payload: {
        ok: false,
        error: "server_not_found",
        message: "That public DZN server was not found.",
      },
    };
  }

  const server = await resolvePublicCommunityServer(env, ref);
  if (!server?.public_slug) {
    return {
      status: 404,
      payload: {
        ok: false,
        error: "server_not_found",
        message: "That public DZN server was not found.",
      },
    };
  }

  const base = basePayload(server);
  if (!server.community_guild_id) {
    return {
      status: 200,
      payload: {
        ...base,
        available: false,
        source: "unavailable",
        message: "This public server is not connected to a trusted DZN community bridge yet.",
      },
    };
  }

  const limit = boundedLimit(options.limit);
  let memberRows: CommunityMemberRow[] = [];
  try {
    memberRows = await readCommunityMemberRows(env, server.community_guild_id, limit);
  } catch (error) {
    if (!isMissingCommunityMembersTableError(error)) throw error;
    return {
      status: 200,
      payload: {
        ...base,
        available: false,
        source: "not_configured",
        message: "Community member directory data has not been configured for this server yet.",
      },
    };
  }

  const attributions = await readPublicProfileAttributionsByUserIds(env, memberRows.map((row) => row.user_id));
  const members = memberRows
    .map((row) => projectCommunityMemberForPublicTest(row, row.user_id ? attributions.get(row.user_id) ?? null : null))
    .filter((member): member is PublicCommunityMember => Boolean(member));

  return {
    status: 200,
    payload: {
      ...base,
      available: members.length > 0,
      source: "live",
      community: {
        ...base.community,
        member_count: members.length,
      },
      members,
      message: members.length ? null : "No public community members are visible yet.",
    },
  };
}

export function publicCommunityMemberDirectorySafeguards() {
  return {
    placement: "public_community_member_directory" as const,
    link_mode: "presentation_only" as const,
    trusted_user_bridge: "community_members.community_guild_id + community_members.user_id -> users.id -> player_profile_privacy_preferences.public_handle",
    uses_gamertag_matching: false,
    uses_discord_name_matching: false,
    exposes_private_identifiers: false,
    affects_ctf_scoring_rows: false,
    affects_owner_workflow_rows: false,
    affects_approval_decisions: false,
    affects_bracket_outcomes: false,
    affects_billing: false,
    affects_rankings: false,
    affects_discovery_score: false,
    affects_reviews: false,
    affects_badges: false,
    affects_seasons: false,
    affects_server_wars_scoring: false,
    affects_xp_awards: false,
    affects_calling_card_awards: false,
    affects_competitive_eligibility: false,
    fairness: publicProfileAttributionFairness() as PublicProfileAttributionFairness,
  };
}

export function projectCommunityMemberForPublicTest(
  row: Pick<CommunityMemberRow, "role_label" | "created_at">,
  publicProfile?: PublicProfileAttribution | null,
): PublicCommunityMember | null {
  if (!publicProfile) return null;
  return {
    display_name: publicProfile.display_name,
    role_label: cleanRoleLabel(row.role_label),
    member_since_label: monthLabel(row.created_at),
    public_profile: publicProfile,
  };
}

async function resolvePublicCommunityServer(env: Env, serverRef: string) {
  return requireDb(env)
    .prepare(
      `SELECT linked_servers.public_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
              discord_guilds.id AS community_guild_id,
              discord_guilds.name AS community_name,
              discord_guilds.icon_url AS community_icon_url
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       WHERE (linked_servers.public_slug = ? OR linked_servers.id = ?)
         AND linked_servers.public_slug IS NOT NULL
         AND linked_servers.public_slug != ''
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(serverRef, serverRef)
    .first<PublicCommunityServerRow>();
}

async function readCommunityMemberRows(env: Env, communityGuildId: string, limit: number) {
  const result = await requireDb(env)
    .prepare(
      `SELECT community_members.user_id,
              community_members.role_label,
              community_members.display_order,
              community_members.created_at
       FROM community_members
       INNER JOIN users ON users.id = community_members.user_id
       WHERE community_members.community_guild_id = ?
         AND community_members.public_member_enabled = 1
         AND community_members.source = 'trusted_dzn_bridge'
       ORDER BY COALESCE(community_members.display_order, 0) ASC,
                community_members.created_at ASC,
                users.username ASC
       LIMIT ?`,
    )
    .bind(communityGuildId, limit)
    .all<CommunityMemberRow>();
  return result.results ?? [];
}

function basePayload(server: PublicCommunityServerRow): Omit<PublicCommunityMemberDirectoryPayload, "available" | "source" | "message"> {
  const slug = cleanPublicSlug(server.public_slug) ?? "preview";
  const serverName = cleanDisplayText(server.server_name) ?? "DZN Server";
  return {
    ok: true,
    server: {
      public_slug: slug,
      server_name: serverName,
      href: `/servers/profile?slug=${encodeURIComponent(slug)}`,
    },
    community: {
      name: cleanDisplayText(server.community_name) ?? serverName,
      icon_url: cleanHttpsUrl(server.community_icon_url),
      member_count: 0,
    },
    members: [],
    profile_attribution: publicCommunityMemberDirectorySafeguards(),
    fetched_at: new Date().toISOString(),
  };
}

function boundedLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(parsed), MAX_LIMIT));
}

function cleanServerRef(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = typeof raw === "string" ? raw.trim() : "";
  return text.slice(0, 96);
}

function cleanPublicSlug(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/.test(text) ? text : null;
}

function cleanDisplayText(value: unknown) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text.slice(0, 96) || null;
}

function cleanRoleLabel(value: unknown) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text.slice(0, 36) || null;
}

function cleanHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function monthLabel(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function isMissingCommunityMembersTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table:\s*community_members|community_members.*does not exist|no such column:\s*community_members/i.test(message);
}
