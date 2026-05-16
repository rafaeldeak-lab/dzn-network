import { hmacSha256, randomToken } from "./crypto";
import { mockGuilds, mockUser } from "./mock";
import { rankServers } from "./server-ranking";
import type { DiscordGuild, DiscordUser, Env, SessionUser } from "./types";
import type { DiscordTokenResponse } from "./discord";

export const SESSION_COOKIE = "dzn_session";
export const MOCK_USER_ID = "mock-user";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function requireDb(env: Env): D1Database {
  if (!env.DB) throw new Error("D1 DB binding is not configured");
  return env.DB;
}

export async function upsertUser(env: Env, user: DiscordUser) {
  const db = requireDb(env);
  const existing = await db
    .prepare("SELECT id FROM users WHERE discord_id = ?")
    .bind(user.id)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        "UPDATE users SET username = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?",
      )
      .bind(user.username, user.avatar, user.id)
      .run();
    return existing.id;
  }

  const userId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO users (id, discord_id, username, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    )
    .bind(userId, user.id, user.username, user.avatar)
    .run();

  return userId;
}

export async function storeGuilds(env: Env, ownerUserId: string, guilds: DiscordGuild[]) {
  const db = requireDb(env);
  for (const guild of guilds) {
    const iconUrl = guild.icon
      ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
      : null;
    await db
      .prepare(
        `INSERT INTO discord_guilds (
          id, guild_id, owner_user_id, name, icon, icon_url, permissions, is_owner, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(guild_id) DO UPDATE SET
          owner_user_id = excluded.owner_user_id,
          name = excluded.name,
          icon = excluded.icon,
          icon_url = excluded.icon_url,
          permissions = excluded.permissions,
          is_owner = excluded.is_owner,
          updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(crypto.randomUUID(), guild.id, ownerUserId, guild.name, guild.icon, iconUrl, guild.permissions, guild.owner ? 1 : 0)
      .run();
  }
}

export async function storeDiscordOAuthToken(env: Env, userId: string, token: DiscordTokenResponse) {
  const db = requireDb(env);
  await ensureDiscordOAuthTokenTable(env);
  const expiresAt = typeof token.expires_in === "number"
    ? new Date(Date.now() + Math.max(0, token.expires_in - 60) * 1000).toISOString()
    : null;

  await db
    .prepare(
      `INSERT INTO discord_oauth_tokens (
        id, user_id, access_token, refresh_token, token_type, scope, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, discord_oauth_tokens.refresh_token),
        token_type = excluded.token_type,
        scope = excluded.scope,
        expires_at = excluded.expires_at,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      token.access_token,
      token.refresh_token ?? null,
      token.token_type ?? "Bearer",
      token.scope ?? null,
      expiresAt,
    )
    .run();
}

export async function getDiscordOAuthToken(env: Env, userId: string) {
  const db = requireDb(env);
  await ensureDiscordOAuthTokenTable(env);
  return db
    .prepare(
      `SELECT access_token, refresh_token, token_type, scope, expires_at
       FROM discord_oauth_tokens
       WHERE user_id = ?
       LIMIT 1`,
    )
    .bind(userId)
    .first<{
      access_token: string;
      refresh_token: string | null;
      token_type: string | null;
      scope: string | null;
      expires_at: string | null;
    }>();
}

export async function ensureDiscordOAuthTokenTable(env: Env) {
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS discord_oauth_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_type TEXT,
        scope TEXT,
        expires_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_discord_oauth_tokens_user_id ON discord_oauth_tokens(user_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_discord_oauth_tokens_expires_at ON discord_oauth_tokens(expires_at)").run();
}

export async function createSession(env: Env, userId: string) {
  const db = requireDb(env);
  const rawToken = randomToken(48);
  const secret = env.SESSION_SECRET || "dev-session-secret";
  const tokenHash = await hmacSha256(rawToken, secret);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, session_token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
    )
    .bind(crypto.randomUUID(), userId, tokenHash, expiresAt)
    .run();

  return { token: rawToken, maxAge: SESSION_TTL_SECONDS };
}

export async function getSessionUser(env: Env, request: Request): Promise<SessionUser | null> {
  const { readCookie } = await import("./http");
  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (!sessionToken) return null;

  const db = requireDb(env);
  const tokenHash = await hmacSha256(sessionToken, env.SESSION_SECRET || "dev-session-secret");
  return db
    .prepare(
      `SELECT users.id, users.discord_id, users.username, users.avatar
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.session_token_hash = ? AND sessions.expires_at > datetime('now')
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<SessionUser>();
}

export async function destroySession(env: Env, request: Request) {
  const { readCookie } = await import("./http");
  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (!sessionToken || !env.DB) return;
  const tokenHash = await hmacSha256(sessionToken, env.SESSION_SECRET || "dev-session-secret");
  await env.DB.prepare("DELETE FROM sessions WHERE session_token_hash = ?").bind(tokenHash).run();
}

export async function ensureMockUser(env: Env) {
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO users (id, discord_id, username, avatar, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         discord_id = excluded.discord_id,
         username = excluded.username,
         avatar = excluded.avatar,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(MOCK_USER_ID, mockUser.id, mockUser.username, mockUser.avatar)
    .run();

  await storeGuilds(env, MOCK_USER_ID, mockGuilds);
  return { userId: MOCK_USER_ID, user: mockUser };
}

export async function getCurrentLinkedServer(env: Env, userId: string, options: { includePrivateAdmPath?: boolean } = {}) {
  const servers = await getLinkedServersForUser(env, userId, options);
  return servers?.[0] ?? null;
}

export async function getLinkedServersForUser(env: Env, userId: string, options: { includePrivateAdmPath?: boolean } = {}) {
  if (!env.DB) return [];
  await ensureLinkedServerMetadataColumns(env);
  await ensureServerLogConfigTable(env);
  const result = await env.DB
    .prepare(
      `SELECT
        linked_servers.*,
        discord_guilds.name AS guild_name,
        discord_guilds.icon_url AS guild_icon_url,
        server_log_config.adm_path AS adm_path,
        onboarding_checks.adm_logs_found AS adm_logs_found,
        onboarding_checks.last_tested_at AS adm_last_checked_at,
        (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id) AS canonical_kill_count,
        COALESCE(server_stats.unique_players, 0) AS canonical_unique_players
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
       LEFT JOIN onboarding_checks ON onboarding_checks.linked_server_id = linked_servers.id
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       WHERE linked_servers.user_id = ?
         AND lower(COALESCE(linked_servers.status, 'pending')) != 'deleted'
         AND lower(COALESCE(linked_servers.status, 'pending')) != 'merged'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY
         CASE WHEN lower(COALESCE(linked_servers.status, 'pending')) = 'live' THEN 0 ELSE 1 END,
         canonical_kill_count DESC,
         canonical_unique_players DESC,
         linked_servers.updated_at DESC,
         linked_servers.created_at DESC,
         linked_servers.id DESC`,
    )
    .bind(userId)
    .all<Record<string, unknown>>();

  const servers = result.results ?? [];
  const rankingById = await getGlobalServerRankingMap(env).catch(() => new Map());

  for (const server of servers) {
    const ranking = typeof server.id === "string" ? rankingById.get(server.id) : null;
    if (ranking) {
      server.global_rank = ranking.rank;
      server.rank = ranking.rank;
      server.server_score = ranking.score;
      server.score = ranking.score;
      server.score_label = ranking.score_label;
      server.score_breakdown = ranking.score_breakdown;
      server.kd = ranking.kd;
      server.kd_label = ranking.kd_label;
      server.longest_kill = ranking.longest_kill;
      server.stats_sync_active = ranking.stats_sync_active;
    } else {
      server.global_rank = null;
      server.rank = null;
      server.server_score = 0;
      server.score = 0;
      server.score_label = "Pending";
      server.score_breakdown = null;
      server.kd = null;
      server.kd_label = "Awaiting data";
      server.longest_kill = 0;
      server.stats_sync_active = false;
    }

    if (!server.public_slug && typeof server.id === "string") {
      const slug = await ensureLinkedServerPublicSlug(
        env,
        server.id,
        firstString(server.guild_name, server.server_name, server.nitrado_service_name, server.guild_id) ?? "dayz-server",
      );
      server.public_slug = slug;
    }

    const rawAdmPath = typeof server.adm_path === "string" ? server.adm_path : null;
    server.adm_latest_file = rawAdmPath ? rawAdmPath.split("/").filter(Boolean).at(-1) ?? null : null;
    server.adm_status = Number(server.adm_logs_found) === 1
      ? "Connected"
      : rawAdmPath
        ? "Discovered, read pending"
        : "Needs review";
    if (!options.includePrivateAdmPath && rawAdmPath) {
      server.adm_path = maskNitradoApiPath(rawAdmPath);
    }
    server.original_owner_is_current_user = server.user_id === userId;
    if (!options.includePrivateAdmPath) {
      delete server.user_id;
    }
  }

  return servers;
}

type GlobalServerRankingRow = {
  id: string;
  kills: number | null;
  deaths: number | null;
  unique_players: number | null;
  total_joins: number | null;
  longest_kill: number | null;
  stats_active: number | null;
  last_activity_at: string | null;
};

async function getGlobalServerRankingMap(env: Env) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT
        linked_servers.id,
        (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id) AS kills,
        (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id AND kill_events.victim_name IS NOT NULL) AS deaths,
        COALESCE(server_stats.unique_players, (SELECT COUNT(*) FROM player_profiles WHERE player_profiles.linked_server_id = linked_servers.id), 0) AS unique_players,
        COALESCE(server_stats.total_joins, 0) AS total_joins,
        COALESCE((SELECT MAX(distance) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS longest_kill,
        CASE
          WHEN COALESCE(server_stats.total_joins, 0) > 0
            OR COALESCE(server_stats.total_disconnects, 0) > 0
            OR COALESCE(server_stats.total_deaths, 0) > 0
            OR COALESCE(server_stats.total_kills, 0) > 0
            OR COALESCE(server_stats.unique_players, 0) > 0
            OR lower(COALESCE(adm_sync_state.last_sync_status, '')) IN ('completed', 'idle')
          THEN 1 ELSE 0
        END AS stats_active,
        COALESCE(
          server_stats.last_event_at,
          (
            SELECT MAX(COALESCE(kill_events.occurred_at, kill_events.created_at))
            FROM kill_events
            WHERE kill_events.linked_server_id = linked_servers.id
          ),
          linked_servers.updated_at,
          linked_servers.created_at
        ) AS last_activity_at
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       WHERE lower(linked_servers.status) = 'live'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       LIMIT 500`,
    )
    .all<GlobalServerRankingRow>();

  const ranked = rankServers((result.results ?? []).map((row) => {
    const kills = numberOrZero(row.kills);
    const deaths = numberOrZero(row.deaths);
    return {
      id: row.id,
      kills,
      deaths,
      uniquePlayers: numberOrZero(row.unique_players),
      joins: numberOrZero(row.total_joins),
      longestKill: numberOrZero(row.longest_kill),
      statsSyncActive: Number(row.stats_active) === 1,
      lastActivityAt: row.last_activity_at,
      kd: calculateRankKd(kills, deaths).value,
      kd_label: calculateRankKd(kills, deaths).label,
      longest_kill: numberOrZero(row.longest_kill),
    };
  }));

  return new Map(ranked.map((server) => [server.id, server]));
}

function calculateRankKd(kills: number, deaths: number) {
  const safeKills = numberOrZero(kills);
  const safeDeaths = numberOrZero(deaths);
  if (safeKills === 0 && safeDeaths === 0) return { value: null, label: "Awaiting data" };
  if (safeKills > 0 && safeDeaths === 0) return { value: safeKills, label: "Flawless" };
  const value = safeDeaths > 0 ? Math.round((safeKills / safeDeaths) * 100) / 100 : 0;
  return { value, label: value.toFixed(2) };
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

export async function ensureLinkedServerMetadataColumns(env: Env) {
  const db = requireDb(env);
  const columns = await db.prepare("PRAGMA table_info(linked_servers)").all<{ name: string }>();
  const existing = new Set((columns.results ?? []).map((column) => column.name));
  const missingColumns = [
    ["game", "TEXT"],
    ["platform", "TEXT"],
    ["ip_address", "TEXT"],
    ["player_slots", "INTEGER"],
    ["display_name", "TEXT"],
    ["hostname", "TEXT"],
    ["description", "TEXT"],
    ["max_players", "INTEGER"],
    ["current_players", "INTEGER"],
    ["game_port", "INTEGER"],
    ["query_port", "INTEGER"],
    ["map_name", "TEXT"],
    ["mission", "TEXT"],
    ["server_status", "TEXT"],
    ["is_online", "INTEGER DEFAULT 0"],
    ["server_mode", "TEXT"],
    ["server_mode_source", "TEXT"],
    ["metadata_hash", "TEXT"],
    ["metadata_last_checked_at", "TEXT"],
    ["metadata_last_changed_at", "TEXT"],
    ["raw_metadata_json", "TEXT"],
    ["merged_into_server_id", "TEXT"],
    ["merged_at", "TEXT"],
    ["geo_latitude", "REAL"],
    ["geo_longitude", "REAL"],
    ["geo_country", "TEXT"],
    ["geo_region", "TEXT"],
    ["geo_city", "TEXT"],
    ["geo_timezone", "TEXT"],
    ["geo_source", "TEXT"],
    ["geo_last_checked_at", "TEXT"],
    ["public_short_description", "TEXT"],
    ["public_description", "TEXT"],
    ["public_discord_invite", "TEXT"],
    ["public_website_url", "TEXT"],
    ["public_rules", "TEXT"],
    ["public_language", "TEXT"],
    ["public_region_label", "TEXT"],
    ["public_listing_updated_at", "TEXT"],
  ].filter(([name]) => !existing.has(name));

  for (const [name, type] of missingColumns) {
    await db.prepare(`ALTER TABLE linked_servers ADD COLUMN ${name} ${type}`).run();
  }
}

export async function saveServerAdmPath(env: Env, linkedServerId: string, admPath: string) {
  const db = requireDb(env);
  await ensureServerLogConfigTable(env);
  await db
    .prepare(
      `INSERT INTO server_log_config (id, linked_server_id, adm_path, created_at, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(linked_server_id) DO UPDATE SET
         adm_path = excluded.adm_path,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(crypto.randomUUID(), linkedServerId, admPath)
    .run();
}

async function ensureServerLogConfigTable(env: Env) {
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_log_config (
        id TEXT PRIMARY KEY,
        linked_server_id TEXT UNIQUE NOT NULL,
        adm_path TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
      )`,
    )
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_server_log_config_linked_server_id ON server_log_config(linked_server_id)")
    .run();
}

function maskNitradoApiPath(path: string) {
  return path.replace(/(^|\/)games\/[^/]+\/noftp\//i, "$1games/{gameserver-username}/noftp/");
}

async function ensureLinkedServerPublicSlug(env: Env, linkedServerId: string, name: string) {
  const db = requireDb(env);
  const slug = await uniquePublicSlugForDb(db, name, linkedServerId);
  await db
    .prepare("UPDATE linked_servers SET public_slug = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(slug, linkedServerId)
    .run();
  return slug;
}

async function uniquePublicSlugForDb(db: D1Database, name: string, linkedServerId: string) {
  const base = toPublicSlug(name);
  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await db
      .prepare("SELECT id FROM linked_servers WHERE public_slug = ? LIMIT 1")
      .bind(candidate)
      .first<{ id: string }>();
    if (!existing || existing.id === linkedServerId) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function toPublicSlug(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || `server-${Date.now()}`;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
