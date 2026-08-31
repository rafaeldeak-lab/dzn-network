import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { onRequest as savedServersRoute } from "../functions/api/player/saved-servers";
import type { Env, PagesContext } from "../functions/_lib/types";

const migrationFiles = readdirSync("migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const migrationName = "0060_player_saved_servers.sql";
const migration = readFileSync(`migrations/${migrationName}`, "utf8");
const route = readFileSync("functions/api/player/saved-servers.ts", "utf8");
const helper = readFileSync("functions/_lib/player-saved-servers.ts", "utf8");
const publicServersApi = readFileSync("functions/api/public/servers.ts", "utf8");
const publicNetwork = readFileSync("components/network/public-network.tsx", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const forbiddenSideEffectTokens = /\b(?:owner_billing_accounts|account_entitlements|server_subscriptions|STRIPE_SECRET|STRIPE_PRICE|checkout_session|checkout-session|nitrado_connections|nitrado_|server_reviews|event_|tournament|leaderboard|rank|score|discovery|badge_awards|user_badges|dzn_season|server_war|ctf|earned_xp|xp_award|calling_card|eligibility|competitive_eligibility)\b/i;

assert.equal(migrationFiles.at(-1), migrationName, "Player saved servers migration should be the latest numbered migration in this branch.");
assert.match(migration, /CREATE TABLE IF NOT EXISTS player_saved_servers/i, "Migration must create the private player saved servers table.");
assert.match(migration, /user_id TEXT NOT NULL/i, "Saved server rows must be owned by a DZN user.");
assert.match(migration, /linked_server_id TEXT NOT NULL/i, "Saved server rows must target a linked server.");
assert.match(migration, /UNIQUE\(user_id, linked_server_id\)/i, "A player/server pair must be idempotent.");
assert.match(migration, /FOREIGN KEY\(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/i, "Saved state should be removed with the owning user.");
assert.match(migration, /FOREIGN KEY\(linked_server_id\) REFERENCES linked_servers\(id\) ON DELETE CASCADE/i, "Saved state should be removed with the linked server.");
assert.match(migration, /idx_player_saved_servers_user_created/i, "User-owned reads need a bounded index.");
assert.match(migration, /idx_player_saved_servers_linked_server/i, "Linked-server cleanup/audit reads need an index.");
assert.doesNotMatch(migration, /rank|score|discover|billing|price|plan|owner|review|event|season|server_war|ctf|xp|badge|eligib/i, "Saved server storage must not encode ranking, billing, ownership, review, event, progression, or eligibility state.");

assert.match(route, /getSessionUser/, "Saved-server route must require a logged-in Discord session.");
assert.match(route, /status: 401/, "Saved-server route must deny anonymous requests.");
assert.match(route, /request\.method === "POST"/, "Saved-server route must expose a save action.");
assert.match(route, /request\.method === "DELETE"/, "Saved-server route must expose a remove action.");
assert.match(route, /request\.method === "GET"/, "Saved-server route must expose a private read model for UI state.");
assert.match(route, /isSameOriginMutation/, "Saved-server POST/DELETE should reject mismatched Origin headers when present.");
assert.match(route, /private, no-store, no-cache, must-revalidate/, "Saved-server route must be private and uncached.");
assert.match(route, /vary: "Cookie"/, "Saved-server responses must vary by Cookie.");
assert.doesNotMatch(route, forbiddenSideEffectTokens, "Saved-server route must not touch owner billing, Nitrado, reviews, events, rankings, progression, or competitive systems.");

const sqlWrites = [...helper.matchAll(/\b(INSERT INTO|UPDATE(?!\s+SET)|DELETE FROM)\s+([a-z_]+)/gi)].map((match) => `${match[1].toUpperCase()} ${match[2]}`);
assert.deepEqual(sqlWrites, ["INSERT INTO player_saved_servers", "DELETE FROM player_saved_servers"], "Saved-server helper may only write player_saved_servers rows.");
assert.match(helper, /player_saved_servers\.user_id = \?/, "Private reads must be scoped to the current user.");
assert.match(helper, /WHERE user_id = \?\s+AND linked_server_id = \?/i, "Deletes must be scoped to current user and server id.");
assert.match(helper, /lower\(COALESCE\(linked_servers\.listing_visibility, 'public'\)\) != 'hidden'/i, "Players must not save hidden public listings.");
assert.match(helper, /linked_servers\.public_slug IS NOT NULL/i, "Players should save only servers with public profile routes.");
assert.doesNotMatch(helper, forbiddenSideEffectTokens, "Saved-server helper must stay out of monetisation and competitive systems.");

assert.doesNotMatch(publicServersApi, /player_saved_servers|saved_server|viewer_saved/i, "Public server payload/cache must not include private saved-state data.");
const sortStart = publicServersApi.indexOf("export function sortPublicServersForDiscovery");
const sortEnd = publicServersApi.indexOf("function publicPlanKey", sortStart);
assert.ok(sortStart > -1 && sortEnd > sortStart, "Discovery sort block should remain findable.");
const sortBlock = publicServersApi.slice(sortStart, sortEnd);
assert.doesNotMatch(sortBlock, /saved|follow|preference/i, "Private saved/followed state must not influence public discovery ordering.");

assert.match(publicNetwork, /SavedServersContext/, "Public server UI should keep saved-state wiring scoped.");
assert.match(publicNetwork, /\/api\/player\/saved-servers\?server_ids=/, "Public server UI should read saved state from the private player endpoint.");
assert.match(publicNetwork, /method: currentlySaved \? "DELETE" : "POST"/, "Public server UI should toggle saves through POST/DELETE only.");
assert.match(publicNetwork, /aria-pressed=\{isSaved\}/, "Saved button must expose toggle state to assistive tech.");
assert.match(publicNetwork, /Login to Save/, "Logged-out visitors should get a login path, not a failed save.");
const savedButtonStart = publicNetwork.indexOf("function SavedServerButton");
const savedButtonEnd = publicNetwork.indexOf("function ServerCard", savedButtonStart);
assert.ok(savedButtonStart > -1 && savedButtonEnd > savedButtonStart, "Saved server button component should remain findable.");
const savedButtonBlock = publicNetwork.slice(savedButtonStart, savedButtonEnd);
assert.doesNotMatch(savedButtonBlock, /trackPromotionEvent|sendBeacon|analytics|localStorage|sessionStorage/i, "Saving a server must not create tracking calls or local fallback storage.");
assert.match(packageJson, /"test:player-saved-servers": "tsx scripts\/test-player-saved-servers\.ts"/, "Dedicated player saved servers test script must be registered.");

async function testSavedServerRouteRuntimeContract() {
  const db = new FakeD1Database();
  const liveServerId = "server-live-1";
  const hiddenServerId = "server-hidden-1";
  db.linkedServers.set(liveServerId, {
    id: liveServerId,
    public_slug: "pandora-squad",
    server_name: "Pandora Squad",
    server_type: "PVP",
    status: "live",
    listing_visibility: "public",
    merged_into_server_id: null,
    discord_guild_id: null,
    platform: "PS5",
    map_name: "Chernarus",
    public_short_description: "A public test listing.",
    current_players: 12,
    max_players: 60,
  });
  db.linkedServers.set(hiddenServerId, {
    id: hiddenServerId,
    public_slug: "hidden-server",
    server_name: "Hidden Server",
    server_type: "PVE",
    status: "live",
    listing_visibility: "hidden",
    merged_into_server_id: null,
    discord_guild_id: null,
    platform: "PS5",
    map_name: "Livonia",
    public_short_description: "Should not be saved.",
    current_players: 0,
    max_players: 40,
  });

  const anonymousGet = await callSavedServersRoute(db, "GET", "https://dzn.test/api/player/saved-servers");
  assert.equal(anonymousGet.status, 401, "Anonymous saved-server reads must be denied.");

  const authenticatedEnv = { DB: db, MOCK_AUTH: "true" } as unknown as Env;
  const crossOriginSave = await callSavedServersRoute(db, "POST", "https://dzn.test/api/player/saved-servers", authenticatedEnv, { linked_server_id: liveServerId }, { origin: "https://evil.example" });
  assert.equal(crossOriginSave.status, 403, "Cross-origin saved-server mutations should be denied when Origin is present.");
  assert.equal(db.playerSavedServers.length, 0, "Cross-origin denied saves must not create private preference rows.");

  const save = await callSavedServersRoute(db, "POST", "https://dzn.test/api/player/saved-servers", authenticatedEnv, { linked_server_id: liveServerId });
  assert.equal(save.status, 200, "Authenticated players should be able to save a public listed server.");
  assert.equal(db.playerSavedServers.filter((row) => row.user_id === "mock-user" && row.linked_server_id === liveServerId).length, 1, "First save should create one private row.");

  const secondSave = await callSavedServersRoute(db, "POST", "https://dzn.test/api/player/saved-servers", authenticatedEnv, { linked_server_id: liveServerId });
  assert.equal(secondSave.status, 200, "Repeated saves should be idempotent.");
  assert.equal(db.playerSavedServers.filter((row) => row.user_id === "mock-user" && row.linked_server_id === liveServerId).length, 1, "Repeated saves must not duplicate the player/server preference.");

  db.playerSavedServers.push({
    id: "other-user-save",
    user_id: "other-user",
    linked_server_id: liveServerId,
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  });
  const read = await callSavedServersRoute(db, "GET", `https://dzn.test/api/player/saved-servers?server_ids=${encodeURIComponent(liveServerId)}`, authenticatedEnv);
  assert.equal(read.status, 200, "Authenticated private reads should succeed.");
  const readPayload = await read.json() as { saved_server_ids?: string[]; saved_servers?: Array<{ linked_server_id: string }> };
  assert.deepEqual(readPayload.saved_server_ids, [liveServerId], "Private saved ids should include only the current player's saved rows.");
  assert.deepEqual(readPayload.saved_servers?.map((server) => server.linked_server_id), [liveServerId], "Private saved summaries should be scoped to the current player.");

  const hiddenSave = await callSavedServersRoute(db, "POST", "https://dzn.test/api/player/saved-servers", authenticatedEnv, { linked_server_id: hiddenServerId });
  assert.equal(hiddenSave.status, 404, "Hidden public listings must not be saveable through the player route.");

  const remove = await callSavedServersRoute(db, "DELETE", "https://dzn.test/api/player/saved-servers", authenticatedEnv, { linked_server_id: liveServerId });
  assert.equal(remove.status, 200, "Authenticated players should be able to remove their saved server.");
  assert.equal(db.playerSavedServers.some((row) => row.user_id === "mock-user" && row.linked_server_id === liveServerId), false, "Delete must remove only the current player's private row.");
  assert.equal(db.playerSavedServers.some((row) => row.user_id === "other-user" && row.linked_server_id === liveServerId), true, "Delete must not remove another player's saved preference.");

  assert.deepEqual([...db.writeTargets].sort(), ["discord_guilds", "player_saved_servers", "users"], "Runtime route writes must stay limited to mock user bootstrap plus player_saved_servers.");
}

async function callSavedServersRoute(db: FakeD1Database, method: string, url: string, env: Env = { DB: db } as unknown as Env, body?: unknown, headers?: HeadersInit) {
  const request = new Request(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await savedServersRoute({
    request,
    env,
    params: {},
    data: {},
    waitUntil: () => undefined,
    next: async () => new Response(null, { status: 404 }),
  } satisfies PagesContext);
  return response;
}

type FakeLinkedServer = {
  id: string;
  public_slug: string | null;
  server_name: string;
  server_type: string;
  status: string | null;
  listing_visibility: string | null;
  merged_into_server_id: string | null;
  discord_guild_id: string | null;
  platform: string | null;
  map_name: string | null;
  public_short_description: string | null;
  current_players: number | null;
  max_players: number | null;
};

type FakeSavedServer = {
  id: string;
  user_id: string;
  linked_server_id: string;
  created_at: string;
  updated_at: string;
};

class FakeD1Database {
  readonly linkedServers = new Map<string, FakeLinkedServer>();
  readonly playerSavedServers: FakeSavedServer[] = [];
  readonly writeTargets = new Set<string>();

  prepare(query: string) {
    return new FakeD1PreparedStatement(this, query);
  }

  batch() {
    throw new Error("Fake D1 batch is not implemented for player saved server tests.");
  }

  exec() {
    throw new Error("Fake D1 exec is not implemented for player saved server tests.");
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
    if (this.query.includes("SELECT linked_servers.id")) {
      const linkedServerId = String(this.bindings[0]);
      const server = this.db.linkedServers.get(linkedServerId);
      return (server && isSavableServer(server) ? { id: linkedServerId } : null) as T | null;
    }
    return null;
  }

  async run() {
    if (this.query.includes("INSERT INTO users")) {
      this.db.writeTargets.add("users");
      return d1Ok();
    }

    if (this.query.includes("INSERT INTO discord_guilds")) {
      this.db.writeTargets.add("discord_guilds");
      return d1Ok();
    }

    if (this.query.includes("INSERT INTO player_saved_servers")) {
      this.db.writeTargets.add("player_saved_servers");
      const [id, userId, linkedServerId, createdAt, updatedAt] = this.bindings.map((value) => String(value));
      const existing = this.db.playerSavedServers.find((row) => row.user_id === userId && row.linked_server_id === linkedServerId);
      if (existing) {
        existing.updated_at = updatedAt;
      } else {
        this.db.playerSavedServers.push({ id, user_id: userId, linked_server_id: linkedServerId, created_at: createdAt, updated_at: updatedAt });
      }
      return d1Ok();
    }

    if (this.query.includes("DELETE FROM player_saved_servers")) {
      this.db.writeTargets.add("player_saved_servers");
      const [userId, linkedServerId] = this.bindings.map((value) => String(value));
      for (let index = this.db.playerSavedServers.length - 1; index >= 0; index -= 1) {
        const row = this.db.playerSavedServers[index];
        if (row.user_id === userId && row.linked_server_id === linkedServerId) {
          this.db.playerSavedServers.splice(index, 1);
        }
      }
      return d1Ok();
    }

    throw new Error(`Unexpected write in fake D1: ${this.query}`);
  }

  async all<T>() {
    if (!this.query.includes("FROM player_saved_servers")) return d1Ok<T>([]);

    const userId = String(this.bindings[0]);
    const hasRequestedIds = this.query.includes("linked_server_id IN");
    const requestedIds = hasRequestedIds
      ? new Set(this.bindings.slice(1, -1).map((value) => String(value)))
      : null;
    const rows = this.db.playerSavedServers
      .filter((row) => row.user_id === userId)
      .filter((row) => !requestedIds || requestedIds.has(row.linked_server_id))
      .map((row) => ({ saved: row, server: this.db.linkedServers.get(row.linked_server_id) }))
      .filter((row): row is { saved: FakeSavedServer; server: FakeLinkedServer } => Boolean(row.server && isSavableServer(row.server)))
      .map(({ saved, server }) => ({
        linked_server_id: saved.linked_server_id,
        public_slug: server.public_slug,
        server_name: server.server_name,
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

  raw() {
    throw new Error("Fake D1 raw is not implemented for player saved server tests.");
  }
}

function isSavableServer(server: FakeLinkedServer) {
  const status = String(server.status ?? "pending").toLowerCase();
  const listingVisibility = String(server.listing_visibility ?? "public").toLowerCase();
  return status !== "deleted"
    && status !== "merged"
    && listingVisibility !== "hidden"
    && !server.merged_into_server_id
    && Boolean(server.public_slug?.trim());
}

function d1Ok<T = unknown>(results: T[] = []) {
  return {
    results,
    success: true,
    meta: {},
  };
}

void testSavedServerRouteRuntimeContract()
  .then(() => {
    console.log("Player saved servers foundation tests passed.");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
