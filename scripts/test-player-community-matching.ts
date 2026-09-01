import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { storePlayerDiscordCommunityMemberships } from "../functions/_lib/player-community-memberships";
import type { Env, PagesContext } from "../functions/_lib/types";
import { onRequest as playerHubRoute } from "../functions/api/player/hub";

const migration = readFileSync("migrations/0061_player_discord_community_memberships.sql", "utf8");
const migrationFiles = readdirSync("migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const callbackRoute = readFileSync("functions/api/auth/discord/callback.ts", "utf8");
const discordGuildsRoute = readFileSync("functions/api/discord/guilds.ts", "utf8");
const playerHubRouteSource = readFileSync("functions/api/player/hub.ts", "utf8");
const playerHomeSource = readFileSync("components/player/player-home.tsx", "utf8");
const platformSpec = readFileSync("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md", "utf8");
const handoff = readFileSync("docs/DZN_PLAYER_COMMUNITY_MATCHING_BRIDGE_HANDOFF.md", "utf8");
const packageJson = readFileSync("package.json", "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS player_discord_community_memberships/i, "Migration must create the private player membership bridge.");
assert.ok(migrationFiles.includes("0061_player_discord_community_memberships.sql"), "Community matching bridge migration should remain present in this branch.");
assert.match(migration, /UNIQUE\(user_id, guild_id\)/i, "Membership bridge must be unique per player and Discord guild.");
assert.match(migration, /revoked_at TEXT/i, "Membership bridge must revoke stale memberships without destructive deletes.");
assert.match(migration, /FOREIGN KEY\(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/i, "Membership rows must stay owned by DZN users.");
assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE|ALTER TABLE player_profiles|CREATE TABLE IF NOT EXISTS player_stats|account_entitlements|server_reviews|competitive_events|server_war|ctf|xp|calling_card/i, "Migration must stay additive and isolated from protected systems.");

assert.match(callbackRoute, /storePlayerDiscordCommunityMemberships\(env, userId, guilds\)/, "Discord callback must store all current-user guild memberships.");
assert.match(callbackRoute, /storeGuilds\(env, userId, filterAdminGuilds\(guilds\)\)/, "Existing owner/admin guild cache must remain filtered to manageable guilds.");
assert.match(discordGuildsRoute, /storePlayerDiscordCommunityMemberships\(env, user\.id, guilds\)/, "Explicit guild refresh must update player memberships.");
assert.match(discordGuildsRoute, /const manageableGuilds = guilds\.filter\(canManageDiscordGuild\)/, "Owner/setup guild refresh output must still expose manageable guilds only.");

assert.match(playerHubRouteSource, /player_discord_community_memberships/, "Player Hub must read the private ordinary-member bridge.");
assert.match(playerHubRouteSource, /revoked_at IS NULL/, "Player Hub must ignore revoked membership rows.");
assert.match(playerHubRouteSource, /WHERE user_id = \?/, "Player Hub membership reads must scope to the current user.");
assert.match(playerHubRouteSource, /linked_servers\.guild_id IN/, "Player Hub must match ordinary Discord memberships through public server guild ids.");
assert.match(playerHubRouteSource, /discord_guilds/, "Player Hub must preserve manageable guild fallback for older sessions.");
assert.match(playerHubRouteSource, /privateNoStoreHeaders\(\)/, "Player Hub must keep private no-store headers.");
assert.match(playerHubRouteSource, /MAX_COMMUNITY_MATCH_CANDIDATES = 200/, "Player Hub should read a bounded candidate set before filtering to matched public communities.");
assert.match(playerHubRouteSource, /\.filter\(\(community\) => community\.public_server_count > 0\)\s+\.slice\(0, MAX_MATCHED_COMMUNITIES\)/, "Player Hub should cap visible matches only after filtering to public DZN server matches.");
assert.match(playerHubRouteSource, /request\.method !== "GET"/, "Player Hub route must stay read-only.");
assert.doesNotMatch(playerHubRouteSource, /\b(?:INSERT INTO|UPDATE\s+[a-z_]+|DELETE FROM)\b/i, "Player Hub route must not directly write from the read model.");
assert.doesNotMatch(playerHubRouteSource.replace(/public_profile/g, ""), /\b(?:STRIPE|checkout_session|checkout\.session|nitrado_connections|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|server_reviews|review_score|badge_awards|user_badges|dzn_season|server_war_events|ctf_tournaments|xp_award|calling_card_awards|dynamic_visibility_score|network_rank|public_handle|profile_privacy|profile_visibility)\b/i, "Player Hub community matching must stay out of payment, owner, profile-privacy, review, progression, and competitive systems.");

assert.match(playerHomeSource, /player_discord_community_memberships/, "Player Hub UI type must recognise the private membership source.");
assert.match(playerHomeSource, /Private Discord membership matches/i, "Player Hub UI should explain the private membership source.");
assert.match(platformSpec, /Broader Player-Community Matching Model/i, "Master spec must document this slice.");
assert.match(handoff, /private player context/i, "Handoff must document the private-player boundary.");
assert.match(packageJson, /"test:player-community-matching": "tsx scripts\/test-player-community-matching\.ts"/, "Dedicated community matching test script must be registered.");

async function testMembershipStorageAndPlayerHubRuntime() {
  const db = new FakeD1Database();
  db.linkedServers.set("server-member-public", {
    id: "server-member-public",
    user_id: "owner-user",
    guild_id: "300000000000000001",
    discord_guild_id: null,
    public_slug: "member-community",
    display_name: "Member Community",
    hostname: null,
    server_name: "Member Community",
    nitrado_service_name: "Member DayZ",
    server_type: "PVP",
    server_category: "pvp",
    server_mode: "hardcore",
    status: "live",
    listing_visibility: "public",
    merged_into_server_id: null,
    platform: "PS5",
    map_name: "Chernarus",
    public_short_description: "A public ordinary-member matched server.",
    current_players: 16,
    max_players: 70,
    created_at: "2026-08-31T08:00:00.000Z",
    updated_at: "2026-08-31T10:00:00.000Z",
  });
  db.linkedServers.set("server-member-hidden", {
    ...db.linkedServers.get("server-member-public")!,
    id: "server-member-hidden",
    public_slug: "hidden-member-community",
    display_name: "Hidden Member Community",
    listing_visibility: "hidden",
  });
  db.linkedServers.set("server-other-user", {
    ...db.linkedServers.get("server-member-public")!,
    id: "server-other-user",
    guild_id: "300000000000000099",
    public_slug: "other-user-community",
    display_name: "Other User Community",
  });

  const fillerGuilds = Array.from({ length: 10 }, (_, index) => ({
    id: `3000000000000000${String(index + 10).padStart(2, "0")}`,
    name: `A Nonmatching Guild ${String(index).padStart(2, "0")}`,
    icon: null,
    owner: false,
    permissions: "0",
  }));

  await storePlayerDiscordCommunityMemberships({ DB: db } as unknown as Env, "mock-user", [
    ...fillerGuilds,
    { id: "300000000000000001", name: "Ordinary Members", icon: "abcdefgh", owner: false, permissions: "0" },
    { id: "300000000000000002", name: "Admin Crew", icon: null, owner: false, permissions: "8" },
  ]);
  await storePlayerDiscordCommunityMemberships({ DB: db } as unknown as Env, "other-user", [
    { id: "300000000000000099", name: "Other User Guild", icon: null, owner: false, permissions: "0" },
  ]);
  assert.equal(db.playerDiscordCommunityMemberships.get("mock-user:300000000000000001")?.relationship, "member", "Ordinary Discord guilds must be stored as member relationships.");
  assert.equal(db.playerDiscordCommunityMemberships.get("mock-user:300000000000000002")?.relationship, "administrator", "Manageable Discord guilds may be represented as administrator relationships in the private bridge.");

  await storePlayerDiscordCommunityMemberships({ DB: db } as unknown as Env, "mock-user", [
    ...fillerGuilds,
    { id: "300000000000000001", name: "Ordinary Members Renamed", icon: null, owner: false, permissions: "0" },
  ]);
  assert.equal(db.playerDiscordCommunityMemberships.get("mock-user:300000000000000001")?.revoked_at, null, "Current memberships must remain active.");
  assert.notEqual(db.playerDiscordCommunityMemberships.get("mock-user:300000000000000002")?.revoked_at, null, "Missing memberships must be revoked, not shown.");

  const response = await playerHubRoute({
    request: new Request("https://dzn.test/api/player/hub", { method: "GET" }),
    env: { DB: db, MOCK_AUTH: "true" } as unknown as Env,
    params: {},
    data: {},
    waitUntil: () => undefined,
    next: async () => new Response(null, { status: 404 }),
  } satisfies PagesContext) as Response;

  assert.equal(response.status, 200, "Mock authenticated Player Hub read should succeed.");
  assert.equal(response.headers.get("cache-control")?.includes("private, no-store"), true, "Player Hub response must be private no-store.");
  assert.equal(response.headers.get("vary"), "Cookie", "Player Hub response must vary by Cookie.");

  const payload = await response.json() as {
    matched_communities: Array<{
      guild_id: string;
      name: string;
      relationship: string;
      relationship_label: string;
      public_server_count: number;
      matched_servers: Array<{ linked_server_id: string; public_slug: string }>;
    }>;
    sources: { matched_communities: string };
    fairness_boundary: string[];
  };

  assert.equal(payload.sources.matched_communities, "player_discord_community_memberships", "Player Hub should prefer the private membership bridge when it is available.");
  const ordinaryCommunity = payload.matched_communities.find((community) => community.guild_id === "300000000000000001");
  assert.ok(ordinaryCommunity, "Player Hub must include the active current-user ordinary membership.");
  assert.equal(payload.matched_communities.some((community) => community.name.startsWith("A Nonmatching Guild")), false, "Player Hub must not expose unmatched private Discord memberships.");
  assert.equal(payload.matched_communities.every((community) => community.public_server_count > 0), true, "Player Hub must show matched communities only, not a raw Discord guild list.");
  assert.equal(ordinaryCommunity.relationship, "member", "Ordinary member relationship should be visible as presentation context only.");
  assert.equal(ordinaryCommunity.relationship_label, "Member", "Ordinary member label should be safe and clear.");
  assert.deepEqual(ordinaryCommunity.matched_servers.map((server) => server.linked_server_id), ["server-member-public"], "Matched server previews must exclude hidden and other-user membership matches.");
  assert.equal(payload.matched_communities.some((community) => community.guild_id === "300000000000000002"), false, "Revoked memberships must not appear in Player Hub.");
  assert.equal(payload.matched_communities.some((community) => community.guild_id === "300000000000000099"), false, "Other users' memberships must not appear in Player Hub.");
  assert.equal(
    payload.matched_communities.some((community) => community.matched_servers.some((server) => server.linked_server_id === "server-member-hidden")),
    false,
    "Hidden server matches must not appear in Player Hub.",
  );
  assert.ok(payload.fairness_boundary.some((line) => /cannot alter billing/i.test(line)), "Fairness boundary must remain present.");

  const payloadKeys = collectKeys(payload);
  for (const forbiddenKey of [
    "user_id",
    "owner_user_id",
    "permissions",
    "discord_id",
    "public_handle",
    "profile_visibility",
    "billing",
    "rank",
    "score",
    "discoveryScore",
    "eligibility",
  ]) {
    assert.equal(payloadKeys.has(forbiddenKey), false, `Player Hub payload must not expose ${forbiddenKey}.`);
  }
  assert.deepEqual([...db.writeTargets].sort(), ["discord_guilds", "player_discord_community_memberships", "users"], "Runtime writes must be limited to mock auth bootstrap plus explicit membership storage, never Player Hub reads.");
}

function collectKeys(value: unknown, keys = new Set<string>()) {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

type FakeLinkedServer = {
  id: string;
  user_id: string;
  guild_id: string | null;
  discord_guild_id: string | null;
  public_slug: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string;
  nitrado_service_name: string | null;
  server_type: string;
  server_category: string | null;
  server_mode: string | null;
  status: string | null;
  listing_visibility: string | null;
  merged_into_server_id: string | null;
  platform: string | null;
  map_name: string | null;
  public_short_description: string | null;
  current_players: number | null;
  max_players: number | null;
  created_at: string;
  updated_at: string;
};

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
  readonly linkedServers = new Map<string, FakeLinkedServer>();
  readonly playerDiscordCommunityMemberships = new Map<string, FakePlayerDiscordCommunityMembership>();
  readonly discordGuilds = new Map<string, {
    id: string;
    guild_id: string;
    owner_user_id: string;
    name: string;
    icon_url: string | null;
    permissions: string | null;
    is_owner: number | null;
  }>();
  readonly writeTargets = new Set<string>();

  prepare(query: string) {
    return new FakeD1PreparedStatement(this, query);
  }

  batch() {
    throw new Error("Fake D1 batch is not implemented for community matching tests.");
  }

  exec() {
    throw new Error("Fake D1 exec is not implemented for community matching tests.");
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

    if (query.includes("insert into discord_guilds")) {
      this.db.writeTargets.add("discord_guilds");
      const [id, guildId, ownerUserId, name, , iconUrl, permissions, isOwner] = this.bindings;
      const row = {
        id: String(id),
        guild_id: String(guildId),
        owner_user_id: String(ownerUserId),
        name: String(name),
        icon_url: typeof iconUrl === "string" ? iconUrl : null,
        permissions: typeof permissions === "string" ? permissions : String(permissions ?? "0"),
        is_owner: Number(isOwner ?? 0),
      };
      this.db.discordGuilds.set(row.id, row);
      return d1Ok();
    }

    if (query.includes("insert into player_discord_community_memberships")) {
      this.db.writeTargets.add("player_discord_community_memberships");
      const [id, userId, guildId, guildName, guildIcon, guildIconUrl, relationship, source] = this.bindings;
      const key = `${String(userId)}:${String(guildId)}`;
      const existing = this.db.playerDiscordCommunityMemberships.get(key);
      const now = "2026-08-31T12:00:00.000Z";
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
        membership.revoked_at = "2026-08-31T12:01:00.000Z";
        membership.updated_at = "2026-08-31T12:01:00.000Z";
      }
      return d1Ok();
    }

    throw new Error(`Unexpected write in fake D1: ${this.query}`);
  }

  async all<T>() {
    const query = normalizedSql(this.query);

    if (query.includes("from player_saved_servers")) {
      return d1Ok<T>([] as T[]);
    }

    if (query.includes("from player_discord_community_memberships")) {
      const userId = String(this.bindings[0]);
      const limit = Number(this.bindings[1]);
      const rows = [...this.db.playerDiscordCommunityMemberships.values()]
        .filter((membership) => membership.user_id === userId && membership.revoked_at === null)
        .sort((a, b) => a.guild_name.localeCompare(b.guild_name))
        .map((membership) => ({
          guild_id: membership.guild_id,
          name: membership.guild_name,
          icon_url: membership.guild_icon_url,
          relationship: membership.relationship,
          last_seen_at: membership.last_seen_at,
        }))
        .slice(0, Number.isFinite(limit) ? limit : 8);
      return d1Ok<T>(rows as T[]);
    }

    if (query.includes("from discord_guilds")) {
      const userId = String(this.bindings[0]);
      const limit = Number(this.bindings[1]);
      const rows = [...this.db.discordGuilds.values()]
        .filter((guild) => guild.owner_user_id === userId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, Number.isFinite(limit) ? limit : 8);
      return d1Ok<T>(rows as T[]);
    }

    if (query.includes("from linked_servers")) {
      const matchValues = new Set(this.bindings.slice(0, -1).map((value) => String(value)));
      const rows = [...this.db.linkedServers.values()]
        .filter((server) => isPublicServer(server))
        .filter((server) => Boolean((server.discord_guild_id && matchValues.has(server.discord_guild_id)) || (server.guild_id && matchValues.has(server.guild_id))))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((server) => ({
          linked_server_id: server.id,
          discord_guild_id: server.discord_guild_id,
          guild_id: server.guild_id,
          public_slug: server.public_slug,
          server_name: displayServerName(server),
          server_type: server.server_category || server.server_mode || server.server_type,
          platform: server.platform,
          map_name: server.map_name,
          current_players: server.current_players,
          max_players: server.max_players,
        }));
      return d1Ok<T>(rows as T[]);
    }

    if (query.includes("from competitive_events")) {
      return d1Ok<T>([] as T[]);
    }

    throw new Error(`Unexpected read in fake D1: ${this.query}`);
  }

  raw() {
    throw new Error("Fake D1 raw is not implemented for community matching tests.");
  }
}

function isPublicServer(server: FakeLinkedServer) {
  const status = String(server.status ?? "pending").toLowerCase();
  const listingVisibility = String(server.listing_visibility ?? "public").toLowerCase();
  return status !== "deleted"
    && status !== "merged"
    && listingVisibility !== "hidden"
    && !server.merged_into_server_id
    && Boolean(server.public_slug?.trim());
}

function displayServerName(server: FakeLinkedServer) {
  return server.display_name || server.hostname || server.server_name || server.nitrado_service_name || "DZN Server";
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

void testMembershipStorageAndPlayerHubRuntime()
  .then(() => {
    console.log("Player community matching bridge tests passed.");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
