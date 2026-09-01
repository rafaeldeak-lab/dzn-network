import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import type { Env, PagesContext } from "../functions/_lib/types";
import { onRequest as refreshRoute } from "../functions/api/player/community-memberships/refresh";

const refreshRouteSource = readFileSync("functions/api/player/community-memberships/refresh.ts", "utf8");
const hubRouteSource = readFileSync("functions/api/player/hub.ts", "utf8");
const playerHomeSource = readFileSync("components/player/player-home.tsx", "utf8");
const discordGuildsRouteSource = readFileSync("functions/api/discord/guilds.ts", "utf8");
const discordOauthSource = readFileSync("functions/_lib/discord-oauth.ts", "utf8");
const platformSpec = readFileSync("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const migrationFiles = readdirSync("migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

assert.match(refreshRouteSource, /request\.method !== "POST"/, "Membership refresh route must be POST-only.");
assert.match(refreshRouteSource, /isSameOriginMutation\(request\)/, "Membership refresh route must reject cross-origin mutation attempts.");
assert.match(refreshRouteSource, /getSessionUser\(env, request\)/, "Membership refresh route must use the current Discord session.");
assert.match(refreshRouteSource, /getUsableDiscordAccessToken\(env, userId\)/, "Membership refresh route must use the saved Discord OAuth token.");
assert.match(refreshRouteSource, /fetchDiscordGuilds\(accessToken\)/, "Membership refresh route must call Discord guilds with the current user's token.");
assert.match(refreshRouteSource, /storePlayerDiscordCommunityMemberships\(env, user\.id, guilds\)/, "Membership refresh route must update only the private player membership bridge.");
assert.match(refreshRouteSource, /privateNoStoreHeaders\(\)/, "Membership refresh route must return private no-store responses.");
assert.match(refreshRouteSource, /source: "player_discord_community_memberships"/, "Membership refresh response must identify the private player bridge source.");
assert.match(refreshRouteSource, /presentation_only: true/, "Membership refresh response must keep the match contract presentation-only.");
assert.match(refreshRouteSource, /DISCORD_RECONNECT_REQUIRED/, "Membership refresh route must have a reconnect path for expired Discord permissions.");
assert.doesNotMatch(
  refreshRouteSource,
  /\b(?:storeGuilds|INSERT INTO discord_guilds|UPDATE discord_guilds|DELETE FROM discord_guilds|STRIPE|checkout_session|account_entitlements|server_subscriptions|nitrado_|server_reviews|review_score|dynamic_visibility_score|network_rank|leaderboard_write|badge_awards|user_badges|dzn_season|server_war|ctf|xp_award|calling_card_awards|public_handle|profile_visibility|profile_privacy|sendBeacon|analytics|localStorage|sessionStorage)\b/i,
  "Membership refresh route must not touch owner guild cache, payment, profile publication, analytics, or competitive systems.",
);

assert.match(discordOauthSource, /getDiscordOAuthToken\(env, userId\)/, "Shared Discord OAuth helper must read the saved token.");
assert.match(discordOauthSource, /refreshDiscordAccessToken\(env, token\.refresh_token\)/, "Shared Discord OAuth helper must refresh expired saved tokens.");
assert.match(discordOauthSource, /storeDiscordOAuthToken\(env, userId, refreshed\)/, "Shared Discord OAuth helper must persist refreshed OAuth tokens.");
assert.match(discordGuildsRouteSource, /getUsableDiscordAccessToken/, "Existing owner guild route should reuse the shared OAuth helper.");
assert.match(discordGuildsRouteSource, /const manageableGuilds = guilds\.filter\(canManageDiscordGuild\)/, "Existing owner guild route must still expose manageable guilds only.");
assert.match(discordGuildsRouteSource, /storeGuilds\(env, user\.id, manageableGuilds\)/, "Owner guild cache writes must remain limited to manageable guilds in the existing owner route.");

assert.match(hubRouteSource, /discord_membership_status/, "Player Hub payload must include Discord membership status metadata.");
assert.match(hubRouteSource, /refresh_href: communityMembershipRefreshHref/, "Player Hub status must advertise the refresh route.");
assert.match(hubRouteSource, /refresh_method: "POST"/, "Player Hub status must advertise a POST refresh method.");
assert.match(hubRouteSource, /last_checked_at: communities\.lastCheckedAt/, "Player Hub status must expose only the current user's last membership check timestamp.");
assert.match(hubRouteSource, /presentation_only: true/, "Player Hub status must preserve the presentation-only boundary.");
assert.match(hubRouteSource, /latestCommunityMembershipSeenAt/, "Player Hub must derive status from private bridge last-seen timestamps.");
assert.match(hubRouteSource, /request\.method !== "GET"/, "Player Hub route must remain a read-only GET route.");
assert.doesNotMatch(hubRouteSource, /\b(?:INSERT INTO|UPDATE\s+[a-z_]+|DELETE FROM)\b/i, "Player Hub read route must not write while reporting status.");

const refreshFunctionStart = playerHomeSource.indexOf("async function refreshCommunityMatches");
const refreshFunctionEnd = playerHomeSource.indexOf("const profileHandlePreview", refreshFunctionStart);
assert.ok(refreshFunctionStart > -1 && refreshFunctionEnd > refreshFunctionStart, "Player Hub refresh function must remain findable.");
const refreshFunctionSource = playerHomeSource.slice(refreshFunctionStart, refreshFunctionEnd);

const refreshControlStart = playerHomeSource.indexOf("function CommunityRefreshControl");
const refreshControlEnd = playerHomeSource.indexOf("function EmptyList", refreshControlStart);
assert.ok(refreshControlStart > -1 && refreshControlEnd > refreshControlStart, "Player Hub refresh control must remain findable.");
const refreshControlSource = playerHomeSource.slice(refreshControlStart, refreshControlEnd);

assert.match(refreshFunctionSource, /fetch\("\/api\/player\/community-memberships\/refresh"/, "Player Hub UI must call the membership refresh route.");
assert.match(refreshFunctionSource, /method: "POST"/, "Player Hub refresh action must use POST.");
assert.match(refreshFunctionSource, /credentials: "include"/, "Player Hub refresh action must use the current logged-in session.");
assert.match(refreshFunctionSource, /requestPlayerHub\(\)/, "Player Hub refresh action must reload the private Hub read model after success.");
assert.match(refreshControlSource, /Discord Membership Status/, "Refresh UI must clearly label the Discord membership status.");
assert.match(refreshControlSource, /Refresh Matches/, "Refresh UI must expose a clear refresh button.");
assert.match(refreshControlSource, /Reconnect Discord/, "Refresh UI must guide players when Discord permissions need refreshing.");
assert.match(refreshControlSource, /formatCommunityCheckedAt/, "Refresh UI must show a clear last-checked state.");
assert.doesNotMatch(
  refreshFunctionSource + refreshControlSource,
  /\b(?:\/setup|owner_setup|checkout|STRIPE|account_entitlements|server_subscriptions|nitrado_|server_reviews|review_score|dynamic_visibility_score|network_rank|leaderboard_write|badge_awards|user_badges|dzn_season|server_war|ctf|xp_award|calling_card_awards|public_handle|profile_visibility|profile_privacy|sendBeacon|analytics|localStorage|sessionStorage)\b/i,
  "Refresh UI must not touch owner, payment, profile-publication, analytics, or competitive systems.",
);

assert.equal(migrationFiles.at(-1), "0061_player_discord_community_memberships.sql", "Refresh/status UX slice must not add another migration.");
assert.match(platformSpec, /Player Hub Discord Membership Refresh\/Status UX/i, "Master spec must document the refresh/status slice.");
assert.match(packageJson, /"test:player-community-refresh-status": "tsx scripts\/test-player-community-refresh-status\.ts"/, "Dedicated refresh/status test script must be registered.");

async function testRefreshRouteRuntime() {
  const anonymousDb = new FakeD1Database();
  const anonymous = await callRefreshRoute(anonymousDb, { MOCK_AUTH: "false" } as unknown as Env);
  assert.equal(anonymous.status, 401, "Anonymous players must not refresh Discord community matches.");
  assert.deepEqual([...anonymousDb.writeTargets], [], "Anonymous denial must not write private membership rows.");

  const crossOriginDb = new FakeD1Database();
  const crossOrigin = await callRefreshRoute(crossOriginDb, { MOCK_AUTH: "true" } as unknown as Env, "https://evil.example");
  assert.equal(crossOrigin.status, 403, "Cross-origin refresh attempts must be rejected.");
  assert.deepEqual([...crossOriginDb.writeTargets], [], "Cross-origin denial must not bootstrap mock users or write memberships.");

  const methodDb = new FakeD1Database();
  const methodResponse = await refreshRoute(makeContext(new Request("https://dzn.test/api/player/community-memberships/refresh", { method: "GET" }), methodDb, { MOCK_AUTH: "true" } as unknown as Env)) as Response;
  assert.equal(methodResponse.status, 405, "Membership refresh route must reject non-POST methods.");

  const refreshDb = new FakeD1Database();
  const response = await callRefreshRoute(refreshDb, { MOCK_AUTH: "true" } as unknown as Env);
  assert.equal(response.status, 200, "Mock authenticated refresh should succeed.");
  assert.equal(response.headers.get("cache-control")?.includes("private, no-store"), true, "Refresh response must be private no-store.");
  assert.equal(response.headers.get("vary"), "Cookie", "Refresh response must vary by Cookie.");

  const payload = await response.json() as Record<string, unknown>;
  assert.equal(payload.ok, true, "Refresh payload should report success.");
  assert.equal(payload.source, "player_discord_community_memberships", "Refresh payload should identify the private player bridge.");
  assert.equal(payload.private, true, "Refresh payload should identify private status.");
  assert.equal(payload.presentation_only, true, "Refresh payload should identify presentation-only status.");
  assert.equal(typeof payload.refreshed_at, "string", "Refresh payload should include a timestamp.");
  assert.equal(Object.hasOwn(payload, "guilds"), false, "Refresh payload must not expose raw Discord guilds.");
  assert.equal(Object.hasOwn(payload, "permissions"), false, "Refresh payload must not expose Discord permission bits.");
  assert.deepEqual([...refreshDb.writeTargets].sort(), ["player_discord_community_memberships", "users"], "Refresh route writes must stay limited to mock user bootstrap and private memberships.");
  assert.equal(refreshDb.playerDiscordCommunityMemberships.size, 1, "Mock refresh should store the mock Discord membership.");
  assert.equal([...refreshDb.playerDiscordCommunityMemberships.values()][0]?.user_id, "mock-user", "Stored memberships must be current-user scoped.");
}

async function callRefreshRoute(db: FakeD1Database, env: Env, origin = "https://dzn.test") {
  return refreshRoute(makeContext(
    new Request("https://dzn.test/api/player/community-memberships/refresh", {
      method: "POST",
      headers: { origin },
    }),
    db,
    env,
  )) as Promise<Response>;
}

function makeContext(request: Request, db: FakeD1Database, env: Env): PagesContext {
  return {
    request,
    env: { ...env, DB: db } as unknown as Env,
    params: {},
    data: {},
    waitUntil: () => undefined,
    next: async () => new Response(null, { status: 404 }),
  };
}

type FakePlayerDiscordCommunityMembership = {
  id: string;
  user_id: string;
  guild_id: string;
  guild_name: string;
  guild_icon: string | null;
  guild_icon_url: string | null;
  relationship: string;
  source: string;
  first_seen_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

class FakeD1Database {
  readonly playerDiscordCommunityMemberships = new Map<string, FakePlayerDiscordCommunityMembership>();
  readonly writeTargets = new Set<string>();

  prepare(query: string) {
    return new FakeD1PreparedStatement(this, query);
  }

  batch() {
    throw new Error("Fake D1 batch is not implemented for refresh/status tests.");
  }

  exec() {
    throw new Error("Fake D1 exec is not implemented for refresh/status tests.");
  }
}

class FakeD1PreparedStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async first<T>() {
    return null as T | null;
  }

  async run() {
    const query = normalizedSql(this.query);

    if (query.includes("insert into users")) {
      this.db.writeTargets.add("users");
      return d1Ok();
    }

    if (query.includes("insert into player_discord_community_memberships")) {
      this.db.writeTargets.add("player_discord_community_memberships");
      const [id, userId, guildId, guildName, guildIcon, guildIconUrl, relationship, source] = this.bindings;
      const key = `${String(userId)}:${String(guildId)}`;
      const existing = this.db.playerDiscordCommunityMemberships.get(key);
      const now = "2026-09-01T09:00:00.000Z";
      this.db.playerDiscordCommunityMemberships.set(key, {
        id: existing?.id ?? String(id),
        user_id: String(userId),
        guild_id: String(guildId),
        guild_name: String(guildName),
        guild_icon: typeof guildIcon === "string" ? guildIcon : null,
        guild_icon_url: typeof guildIconUrl === "string" ? guildIconUrl : null,
        relationship: String(relationship),
        source: String(source),
        first_seen_at: existing?.first_seen_at ?? now,
        last_seen_at: now,
        revoked_at: null,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });
      return d1Ok();
    }

    if (query.includes("update player_discord_community_memberships")) {
      this.db.writeTargets.add("player_discord_community_memberships");
      const userId = String(this.bindings[0]);
      const activeGuildIds = new Set(this.bindings.slice(1).map((value) => String(value)));
      for (const membership of this.db.playerDiscordCommunityMemberships.values()) {
        if (membership.user_id !== userId || membership.revoked_at) continue;
        if (activeGuildIds.size && activeGuildIds.has(membership.guild_id)) continue;
        membership.revoked_at = "2026-09-01T09:01:00.000Z";
        membership.updated_at = "2026-09-01T09:01:00.000Z";
      }
      return d1Ok();
    }

    throw new Error(`Unexpected write in fake D1: ${this.query}`);
  }

  async all<T>() {
    return d1Ok<T>([] as T[]);
  }

  raw() {
    throw new Error("Fake D1 raw is not implemented for refresh/status tests.");
  }
}

function normalizedSql(query: string) {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

function d1Ok<T = unknown>(results: T[] = []) {
  return {
    results,
    success: true,
    meta: {},
  };
}

void testRefreshRouteRuntime()
  .then(() => {
    console.log("Player community refresh/status tests passed.");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
