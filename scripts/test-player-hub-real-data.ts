import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequest as playerHubRoute } from "../functions/api/player/hub";
import type { Env, PagesContext } from "../functions/_lib/types";

const route = readFileSync("functions/api/player/hub.ts", "utf8");
const playerHome = readFileSync("components/player/player-home.tsx", "utf8");
const platformSpec = readFileSync("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md", "utf8");
const packageJson = readFileSync("package.json", "utf8");

assert.match(route, /request\.method !== "GET"/, "Player Hub route must be read-only.");
assert.match(route, /getSessionUser/, "Player Hub route must require a Discord session.");
assert.match(route, /status: 401/, "Player Hub route must deny anonymous API reads.");
assert.match(route, /privateNoStoreHeaders\(\)/, "Player Hub route must return private no-store data.");
assert.match(route, /readPlayerSavedServersForUser/, "Player Hub route must use the canonical saved-server preference layer.");
assert.match(route, /discord_guilds/, "Player Hub route must use cached Discord guild context for community matches.");
assert.match(route, /competitive_events/, "Player Hub route must read public event/tournament suggestions.");
assert.match(route, /readSuggestedEventServerRows/, "Player Hub route must read public event server links for private relevance ordering.");
assert.match(route, /suggestedEventRelevance/, "Player Hub route must label suggested event relevance without changing event systems.");
assert.match(route, /\/pricing\?intent=owner_setup&returnTo=%2Fsetup/, "Owner setup CTA must route through pricing.");
assert.doesNotMatch(route, /\b(?:INSERT INTO|UPDATE\s+[a-z_]+|DELETE FROM)\b/i, "Player Hub route must not contain direct SQL writes.");
assert.doesNotMatch(route, /\b(?:STRIPE|checkout_session|checkout\.session|nitrado_connections|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|server_reviews|review_score|badge_awards|user_badges|dzn_season|server_war_events|ctf_tournaments|xp_award|calling_card_awards|dynamic_visibility_score|network_rank)\b/i, "Player Hub route must stay out of payment, owner, review, progression, and competitive systems.");

assert.match(playerHome, /\/api\/player\/hub/, "Player Hub UI must hydrate from the private hub read model.");
assert.match(playerHome, /Followed Servers/, "Player Hub UI must show followed servers.");
assert.match(playerHome, /Matched Communities/, "Player Hub UI must show matched Discord communities.");
assert.match(playerHome, /Suggested Events/, "Player Hub UI must show suggested public events/tournaments.");
assert.match(playerHome, /event\.relevance\.label/, "Player Hub UI must render suggested event relevance labels from the private API payload.");
assert.match(playerHome, /event\.relevance\.reasons/, "Player Hub UI must render suggested event relevance reasons from the private API payload.");
assert.match(playerHome, /presentation-only/, "Player Hub UI must explain event suggestions remain presentation-only.");
assert.match(playerHome, /Profile Entry Points/, "Player Hub UI must show profile entry points.");
assert.match(playerHome, /Owner Setup Stays Gated/, "Player Hub UI must keep the owner setup boundary visible.");
assert.match(playerHome, /\/pricing\?intent=owner_setup&returnTo=%2Fsetup/, "Player Hub UI owner action must point to pricing, not setup bypass.");
const approvedRefreshStart = playerHome.indexOf("async function refreshCommunityMatches");
const approvedRefreshEnd = playerHome.indexOf("const profileHandlePreview", approvedRefreshStart);
assert.ok(approvedRefreshStart > -1 && approvedRefreshEnd > approvedRefreshStart, "Approved Discord membership refresh action must remain findable.");
const approvedRefreshSource = playerHome.slice(approvedRefreshStart, approvedRefreshEnd);
const playerHomeWithoutApprovedRefresh = `${playerHome.slice(0, approvedRefreshStart)}${playerHome.slice(approvedRefreshEnd)}`;
assert.match(approvedRefreshSource, /fetch\("\/api\/player\/community-memberships\/refresh"/, "Player Hub UI may only send the approved private Discord membership refresh.");
assert.match(approvedRefreshSource, /method: "POST"/, "Approved private Discord membership refresh must use POST.");
assert.doesNotMatch(playerHomeWithoutApprovedRefresh, /\bmethod:\s*"(?:POST|PUT|PATCH|DELETE)"/i, "Player Hub UI must not send unapproved mutations.");
assert.doesNotMatch(playerHome, /\b(?:sendBeacon|analytics|localStorage|sessionStorage)\b/i, "Player Hub UI must not track analytics or store private fallback state.");
assert.doesNotMatch(playerHome, /fetch\([^)]*(?:checkout|STRIPE|nitrado_connections|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns)/i, "Player Hub UI must not call Store/payment/owner runtime routes.");

assert.match(platformSpec, /Player Hub real-data foundation/i, "Master platform spec must track the Player Hub real-data slice.");
assert.match(platformSpec, /Followed\/saved servers/i, "Master platform spec must keep saved/followed servers in the player roadmap.");
assert.match(packageJson, /"test:player-hub-real-data": "tsx scripts\/test-player-hub-real-data\.ts"/, "Dedicated Player Hub real-data test script must be registered.");

async function testPlayerHubRouteRuntimeContract() {
  const db = new FakeD1Database();
  db.linkedServers.set("server-public", {
    id: "server-public",
    user_id: "owner-user",
    guild_id: "200000000000000001",
    discord_guild_id: null,
    public_slug: "pandora-squad",
    display_name: "Pandora Squad",
    hostname: null,
    server_name: "Pandora Squad",
    nitrado_service_name: "Pandora DayZ",
    server_type: "PVP",
    server_category: "pvp",
    server_mode: "hardcore",
    status: "live",
    listing_visibility: "public",
    merged_into_server_id: null,
    platform: "PS5",
    map_name: "Chernarus",
    public_short_description: "A public saved server for Player Hub.",
    current_players: 21,
    max_players: 70,
    created_at: "2026-08-31T08:00:00.000Z",
    updated_at: "2026-08-31T10:00:00.000Z",
  });
  db.linkedServers.set("server-hidden", {
    id: "server-hidden",
    user_id: "owner-user",
    guild_id: "200000000000000001",
    discord_guild_id: null,
    public_slug: "hidden-server",
    display_name: "Hidden Server",
    hostname: null,
    server_name: "Hidden Server",
    nitrado_service_name: "Hidden DayZ",
    server_type: "PVE",
    server_category: "pve",
    server_mode: "vanilla",
    status: "live",
    listing_visibility: "hidden",
    merged_into_server_id: null,
    platform: "PS5",
    map_name: "Livonia",
    public_short_description: "Should stay hidden.",
    current_players: 1,
    max_players: 50,
    created_at: "2026-08-31T08:00:00.000Z",
    updated_at: "2026-08-31T10:00:00.000Z",
  });
  db.linkedServers.set("server-community", {
    id: "server-community",
    user_id: "community-owner",
    guild_id: "200000000000000001",
    discord_guild_id: null,
    public_slug: "community-only",
    display_name: "Community Only",
    hostname: null,
    server_name: "Community Only",
    nitrado_service_name: "Community DayZ",
    server_type: "PVP",
    server_category: "pvp",
    server_mode: "vanilla",
    status: "live",
    listing_visibility: "public",
    merged_into_server_id: null,
    platform: "PC",
    map_name: "Sakhal",
    public_short_description: "A public community match that is not saved by the player.",
    current_players: 12,
    max_players: 60,
    created_at: "2026-08-31T08:30:00.000Z",
    updated_at: "2026-08-31T11:30:00.000Z",
  });
  db.playerSavedServers.push(
    {
      id: "save-current-public",
      user_id: "mock-user",
      linked_server_id: "server-public",
      created_at: "2026-08-31T11:00:00.000Z",
      updated_at: "2026-08-31T11:00:00.000Z",
    },
    {
      id: "save-current-hidden",
      user_id: "mock-user",
      linked_server_id: "server-hidden",
      created_at: "2026-08-31T11:01:00.000Z",
      updated_at: "2026-08-31T11:01:00.000Z",
    },
    {
      id: "save-other-public",
      user_id: "other-user",
      linked_server_id: "server-public",
      created_at: "2026-08-31T11:02:00.000Z",
      updated_at: "2026-08-31T11:02:00.000Z",
    },
  );
  db.competitiveEvents.set("event-public", {
    id: "event-public",
    name: "Survival Showdown",
    slug: "survival-showdown",
    description: "A public test event.",
    category: "pvp",
    event_type: "community_cup",
    status: "upcoming",
    visibility: "public",
    starts_at: "2026-09-03T18:00:00.000Z",
    ends_at: "2026-09-02T21:00:00.000Z",
    server_limit: 16,
    team_limit: null,
    created_at: "2026-08-31T09:00:00.000Z",
    updated_at: "2026-08-31T09:00:00.000Z",
  });
  db.competitiveEvents.set("event-community", {
    id: "event-community",
    name: "Community Night Ops",
    slug: "community-night-ops",
    description: "A public event from a matched community.",
    category: "community",
    event_type: "tournament",
    status: "registration_open",
    visibility: "public",
    starts_at: "2026-09-02T18:00:00.000Z",
    ends_at: "2026-09-03T21:00:00.000Z",
    server_limit: 12,
    team_limit: null,
    created_at: "2026-08-31T09:00:00.000Z",
    updated_at: "2026-08-31T09:00:00.000Z",
  });
  db.competitiveEvents.set("event-general", {
    id: "event-general",
    name: "Open Network Briefing",
    slug: "open-network-briefing",
    description: "A general public event with no private match.",
    category: "community",
    event_type: "community_event",
    status: "live",
    visibility: "public",
    starts_at: "2026-09-01T18:00:00.000Z",
    ends_at: "2026-09-01T19:00:00.000Z",
    server_limit: 20,
    team_limit: null,
    created_at: "2026-08-31T09:00:00.000Z",
    updated_at: "2026-08-31T09:00:00.000Z",
  });
  db.competitiveEvents.set("event-private", {
    id: "event-private",
    name: "Private Owner Draft",
    slug: "private-owner-draft",
    description: "Should not be in Player Hub.",
    category: "pvp",
    event_type: "community_cup",
    status: "registration_open",
    visibility: "private",
    starts_at: "2026-09-03T18:00:00.000Z",
    ends_at: null,
    server_limit: 16,
    team_limit: null,
    created_at: "2026-08-31T09:00:00.000Z",
    updated_at: "2026-08-31T09:00:00.000Z",
  });
  db.competitiveEvents.set("event-draft", {
    id: "event-draft",
    name: "Draft Event",
    slug: "draft-event",
    description: "Should not be in Player Hub.",
    category: "pvp",
    event_type: "community_cup",
    status: "draft",
    visibility: "public",
    starts_at: "2026-09-04T18:00:00.000Z",
    ends_at: null,
    server_limit: 16,
    team_limit: null,
    created_at: "2026-08-31T09:00:00.000Z",
    updated_at: "2026-08-31T09:00:00.000Z",
  });
  db.competitiveEventServers.push(
    { event_id: "event-public", server_id: "server-public" },
    { event_id: "event-community", server_id: "server-community" },
  );

  const anonymous = await callPlayerHubRoute(db, { DB: db } as unknown as Env);
  assert.equal(anonymous.status, 401, "Anonymous Player Hub reads must be denied.");

  const response = await callPlayerHubRoute(db, { DB: db, MOCK_AUTH: "true" } as unknown as Env);
  assert.equal(response.status, 200, "Mock authenticated Player Hub reads should succeed.");
  assert.equal(response.headers.get("cache-control")?.includes("private, no-store"), true, "Player Hub response must be private no-store.");
  assert.equal(response.headers.get("vary"), "Cookie", "Player Hub response must vary by Cookie.");

  const payload = await response.json() as {
    saved_server_ids: string[];
    saved_servers: Array<{ linked_server_id: string; public_slug: string; server_name: string }>;
    matched_communities: Array<{ guild_id: string; name: string; public_server_count: number; matched_servers: Array<{ linked_server_id: string }> }>;
    suggested_events: Array<{
      id: string;
      slug: string;
      status: string;
      relevance: { level: string; label: string; reasons: string[]; presentation_only: boolean };
    }>;
    suggested_event_relevance: { private: boolean; presentation_only: boolean; uses_followed_servers: boolean; uses_matched_communities: boolean };
    owner_setup: { href: string; gated: boolean; requires_entitlement: boolean };
    sources: Record<string, string>;
    fairness_boundary: string[];
  };

  assert.deepEqual(payload.saved_server_ids, ["server-public"], "Player Hub saved ids must include only the current player's public saved servers.");
  assert.deepEqual(payload.saved_servers.map((server) => server.linked_server_id), ["server-public"], "Player Hub saved summaries must hide other-user and hidden saved rows.");
  assert.equal(payload.saved_servers[0]?.public_slug, "pandora-squad", "Saved server summary should expose only the public profile slug.");
  assert.equal(payload.matched_communities.length, 1, "Player Hub should return cached Discord community matches for the current user.");
  assert.equal(payload.matched_communities[0]?.guild_id, "200000000000000001", "Community match must come from the current user's cached guild context.");
  assert.deepEqual(new Set(payload.matched_communities[0]?.matched_servers.map((server) => server.linked_server_id)), new Set(["server-public", "server-community"]), "Community server previews must include only public listed servers.");
  assert.deepEqual(payload.suggested_events.map((event) => event.id), ["event-public", "event-community", "event-general"], "Suggested events must prioritize followed servers, then private community matches, then general public events.");
  assert.equal(payload.suggested_events[0]?.relevance.level, "followed_server", "Followed-server event suggestions should be most relevant in the private Player Hub.");
  assert.deepEqual(payload.suggested_events[0]?.relevance.reasons, [
    "A server you follow is entered.",
    "A public server from one of your private Discord matches is entered.",
  ], "Followed-server event suggestions should explain private relevance without exposing Discord ids.");
  assert.equal(payload.suggested_events[1]?.relevance.level, "matched_community", "Matched-community event suggestions should come before general public events.");
  assert.equal(payload.suggested_events[2]?.relevance.level, "public_network", "General public events should still appear after private relevance matches.");
  assert.equal(payload.suggested_events.every((event) => event.relevance.presentation_only), true, "Suggested event relevance labels must be presentation-only.");
  assert.equal(payload.suggested_event_relevance.private, true, "Suggested event relevance metadata must stay private.");
  assert.equal(payload.suggested_event_relevance.presentation_only, true, "Suggested event relevance metadata must be presentation-only.");
  assert.equal(payload.suggested_event_relevance.uses_followed_servers, true, "Suggested event relevance should declare followed-server input use.");
  assert.equal(payload.suggested_event_relevance.uses_matched_communities, true, "Suggested event relevance should declare matched-community input use.");
  assert.doesNotMatch(JSON.stringify(payload.suggested_events), /200000000000000001|guild_id|discord_guild/i, "Suggested events must not expose raw Discord community identifiers.");
  assert.equal(payload.owner_setup.href, "/pricing?intent=owner_setup&returnTo=%2Fsetup", "Owner setup must stay routed through pricing.");
  assert.equal(payload.owner_setup.gated, true, "Owner setup must stay marked as gated.");
  assert.equal(payload.owner_setup.requires_entitlement, true, "Owner setup must require entitlement after pricing.");
  assert.equal(payload.sources.saved_servers, "player_saved_servers", "Saved source should be the canonical player preference table.");
  assert.ok(payload.fairness_boundary.some((line) => /cannot alter billing/i.test(line)), "Payload should carry the fairness boundary copy.");

  const publicPayloadKeys = collectKeys(payload);
  for (const forbiddenKey of [
    "discord_id",
    "owner_user_id",
    "permissions",
    "nitrado_service_id",
    "encrypted_token",
    "token",
    "rank",
    "score",
    "discoveryScore",
    "plan_key",
    "billing",
    "eligibility",
  ]) {
    assert.equal(publicPayloadKeys.has(forbiddenKey), false, `Player Hub payload must not expose ${forbiddenKey}.`);
  }
  assert.deepEqual([...db.writeTargets].sort(), ["discord_guilds", "users"], "Player Hub route writes must be limited to mock auth bootstrap in tests.");
}

async function callPlayerHubRoute(db: FakeD1Database, env: Env) {
  return playerHubRoute({
    request: new Request("https://dzn.test/api/player/hub", { method: "GET" }),
    env,
    params: {},
    data: {},
    waitUntil: () => undefined,
    next: async () => new Response(null, { status: 404 }),
  } satisfies PagesContext) as Promise<Response>;
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

type FakeDiscordGuild = {
  id: string;
  guild_id: string;
  owner_user_id: string;
  name: string;
  icon_url: string | null;
  permissions: string | null;
  is_owner: number | null;
};

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

type FakeSavedServer = {
  id: string;
  user_id: string;
  linked_server_id: string;
  created_at: string;
  updated_at: string;
};

type FakeCompetitiveEvent = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  event_type: string | null;
  status: string | null;
  visibility: string | null;
  starts_at: string | null;
  ends_at: string | null;
  server_limit: number | null;
  team_limit: number | null;
  created_at: string;
  updated_at: string;
};

type FakeCompetitiveEventServer = {
  event_id: string;
  server_id: string;
};

class FakeD1Database {
  readonly discordGuilds = new Map<string, FakeDiscordGuild>();
  readonly linkedServers = new Map<string, FakeLinkedServer>();
  readonly playerSavedServers: FakeSavedServer[] = [];
  readonly competitiveEvents = new Map<string, FakeCompetitiveEvent>();
  readonly competitiveEventServers: FakeCompetitiveEventServer[] = [];
  readonly writeTargets = new Set<string>();

  prepare(query: string) {
    return new FakeD1PreparedStatement(this, query);
  }

  batch() {
    throw new Error("Fake D1 batch is not implemented for Player Hub tests.");
  }

  exec() {
    throw new Error("Fake D1 exec is not implemented for Player Hub tests.");
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
      const existing = [...this.db.discordGuilds.values()].find((guild) => guild.guild_id === String(guildId));
      const next = {
        id: existing?.id ?? String(id),
        guild_id: String(guildId),
        owner_user_id: String(ownerUserId),
        name: String(name),
        icon_url: typeof iconUrl === "string" ? iconUrl : null,
        permissions: typeof permissions === "string" ? permissions : String(permissions ?? "0"),
        is_owner: Number(isOwner ?? 0),
      };
      this.db.discordGuilds.set(next.id, next);
      return d1Ok();
    }

    throw new Error(`Unexpected write in fake D1: ${this.query}`);
  }

  async all<T>() {
    const query = normalizedSql(this.query);

    if (query.includes("from player_saved_servers")) {
      const userId = String(this.bindings[0]);
      const rows = this.db.playerSavedServers
        .filter((row) => row.user_id === userId)
        .map((saved) => ({ saved, server: this.db.linkedServers.get(saved.linked_server_id) }))
        .filter((row): row is { saved: FakeSavedServer; server: FakeLinkedServer } => Boolean(row.server && isPublicServer(row.server)))
        .sort((a, b) => b.saved.created_at.localeCompare(a.saved.created_at))
        .map(({ saved, server }) => ({
          linked_server_id: saved.linked_server_id,
          public_slug: server.public_slug,
          server_name: displayServerName(server),
          server_type: server.server_type,
          guild_name: null,
          guild_icon_url: null,
          platform: server.platform,
          map_name: server.map_name,
          public_short_description: server.public_short_description,
          current_players: server.current_players,
          max_players: server.max_players,
          saved_at: saved.created_at,
        }));
      return d1Ok<T>(rows as T[]);
    }

    if (query.includes("from discord_guilds")) {
      const userId = String(this.bindings[0]);
      const rows = [...this.db.discordGuilds.values()]
        .filter((guild) => guild.owner_user_id === userId)
        .sort((a, b) => a.name.localeCompare(b.name));
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

    if (query.startsWith("select event_id, server_id from competitive_event_servers")) {
      const eventIds = new Set(this.bindings.slice(0, -1).map((value) => String(value)));
      const rows = this.db.competitiveEventServers
        .filter((row) => eventIds.has(row.event_id))
        .map((row) => ({
          event_id: row.event_id,
          server_id: row.server_id,
        }));
      return d1Ok<T>(rows as T[]);
    }

    if (query.includes("from competitive_events")) {
      const rows = [...this.db.competitiveEvents.values()]
        .filter((event) => String(event.visibility ?? "public").toLowerCase() !== "private")
        .filter((event) => ["live", "registration_open", "upcoming", "standby", "full"].includes(String(event.status ?? "draft").toLowerCase()))
        .sort((a, b) => eventOrder(a) - eventOrder(b) || String(a.starts_at ?? a.created_at).localeCompare(String(b.starts_at ?? b.created_at)))
        .map((event) => ({
          ...event,
          registered_servers: this.db.competitiveEventServers.filter((row) => row.event_id === event.id).length,
        }));
      return d1Ok<T>(rows as T[]);
    }

    throw new Error(`Unexpected read in fake D1: ${this.query}`);
  }

  raw() {
    throw new Error("Fake D1 raw is not implemented for Player Hub tests.");
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

function eventOrder(event: FakeCompetitiveEvent) {
  const status = String(event.status ?? "upcoming").toLowerCase();
  if (status === "live") return 0;
  if (status === "registration_open") return 1;
  if (status === "upcoming") return 2;
  if (status === "standby") return 3;
  if (status === "full") return 4;
  return 5;
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

void testPlayerHubRouteRuntimeContract()
  .then(() => {
    console.log("Player Hub real-data foundation tests passed.");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
